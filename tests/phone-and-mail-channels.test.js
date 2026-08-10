// A (Goal 19) — the phone and the email are REAL SYSTEMS with durable traces.
//
// Last night's seed (Goal 18 D3) created requests and a chip; this pins the
// full channel plumbing: an email request IS a mail message the moment it
// exists, a rung-out phone IS a missed call on the phone's own log, answering
// books through the one bookSlot path with the channel recorded, the
// alternative-offer verb books or declines deterministically, a supplier
// order confirms itself by mail, and BOTH new stores survive snapshot() —
// the save allowlist is exactly where fields silently vanish
// (state.js snapshot() is an explicit field list; watched fail with the
// phone/mail lines removed from it: "phone store lost by snapshot()").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, update, snapshot } from '../src/sim/state.js';
import {
  acceptBookingRequest, declineBookingRequest, proposeAlternativeBooking,
  pendingBookingRequests, PHONE_RING_MINUTES,
} from '../src/sim/reservations.js';
import { ensurePhone, missedCallCount, phoneBadgeCount, contactsOf } from '../src/sim/phone.js';
import { ensureMail, unreadMailCount } from '../src/sim/mail.js';
import { placeOrder } from '../src/sim/shop.js';
import { SHOP_CATALOG } from '../src/data/shopItems.js';

function stateAtMorning(seed = 4242) {
  const state = newGame('relaxed', seed);
  state.club.reputation = 60;
  state.clock.minutes = 8 * 60;
  return state;
}

function injectRequest(state, { channel, dayAbs = null, minute = 9 * 60, holder = 'Rory Vale', partySize = 2 }) {
  const book = state.reservations;
  book.requests = Array.isArray(book.requests) ? book.requests : [];
  const nowAbs = Math.floor(state.clock.minutes);
  const day = dayAbs ?? Math.floor(nowAbs / 1440) + 1;
  const request = {
    id: `req_test_${(book.nextRequestId = (book.nextRequestId || 1) + 1)}`,
    channel,
    holder,
    partySize,
    dayAbs: day,
    minute,
    createdAtAbs: nowAbs,
    expiresAtAbs: channel === 'phone' ? nowAbs + PHONE_RING_MINUTES : day * 1440 + minute - 60,
    status: 'pending',
  };
  book.requests.push(request);
  return request;
}

test('phone and mail stores survive snapshot()', () => {
  const state = stateAtMorning();
  const request = injectRequest(state, { channel: 'phone' });
  acceptBookingRequest(state, request.id);
  assert.ok(ensurePhone(state).calls.length >= 1, 'precondition: a call is on the log');
  const snap = snapshot(state);
  assert.ok(snap.phone && Array.isArray(snap.phone.calls) && snap.phone.calls.length >= 1,
    'phone store lost by snapshot() — the save field allowlist swallowed it');
  injectRequest(state, { channel: 'email', holder: 'June Reeves' });
  // deliver a mail row directly through the roll path's shape
  const snap2 = snapshot(state);
  assert.ok(snap2.mail !== undefined, 'mail store lost by snapshot()');
});

test('a rung-out phone is a MISSED CALL on the log, and badges until seen', () => {
  const state = stateAtMorning();
  const request = injectRequest(state, { channel: 'phone', holder: 'Ada Vance' });
  // let the ring window pass, then read — expiry is lazy at the read
  state.clock.minutes += PHONE_RING_MINUTES + 1;
  const pending = pendingBookingRequests(state, 'phone');
  assert.equal(pending.length, 0, 'the rung-out request still reads as pending');
  assert.equal(request.status, 'missed');
  const calls = ensurePhone(state).calls;
  assert.equal(calls.length, 1, 'no call-log entry for the missed call');
  assert.equal(calls[0].outcome, 'missed');
  assert.equal(calls[0].name, 'Ada Vance');
  assert.equal(missedCallCount(state), 1);
  assert.ok(phoneBadgeCount(state) >= 1, 'the badge does not carry the missed call');
});

test('answering books through bookSlot with the channel recorded, and texts back', () => {
  const state = stateAtMorning();
  const request = injectRequest(state, { channel: 'phone', holder: 'Leah Everett', partySize: 3 });
  const result = acceptBookingRequest(state, request.id);
  assert.equal(result.ok, true, `accept failed: ${result.reason || ''}`);
  assert.equal(result.res.source, 'phone', 'the reservation does not record its channel');
  const phone = ensurePhone(state);
  assert.equal(phone.calls[0].outcome, 'booked');
  assert.equal(phone.texts.length, 1, 'no confirmation text arrived');
  assert.equal(phone.texts[0].kind, 'bookingConfirmed');
  assert.equal(phone.texts[0].from, 'Leah Everett');
  // the caller is now a CONTACT with history
  const contacts = contactsOf(state);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, 'Leah Everett');
  assert.equal(contacts[0].booked, 1);
});

test('the alternative offer: near slots book, far slots are turned down', () => {
  const state = stateAtMorning();
  const near = injectRequest(state, { channel: 'phone', holder: 'Marcus Hale', minute: 9 * 60 });
  const nearResult = proposeAlternativeBooking(state, near.id, near.dayAbs, 10 * 60);
  assert.equal(nearResult.ok, true);
  assert.equal(nearResult.accepted, true, 'a 60-minute shift should be accepted');
  assert.equal(nearResult.res.minute, 10 * 60, 'the booking is not at the PROPOSED slot');
  assert.equal(nearResult.res.source, 'phone');
  const far = injectRequest(state, { channel: 'phone', holder: 'Iris Bell', minute: 9 * 60 });
  const farResult = proposeAlternativeBooking(state, far.id, far.dayAbs, 15 * 60);
  assert.equal(farResult.ok, true);
  assert.equal(farResult.accepted, false, 'a six-hour shift should be refused');
  assert.equal(far.status, 'declined');
});

test('an email request is mail; decline stamps the row and keeps it as history', () => {
  const state = stateAtMorning();
  // drive real sim hours so rollBookingRequests runs through the production
  // path; requests trickle ~one per two daytime hours
  let emailRequest = null;
  for (let hour = 0; hour < 30 && !emailRequest; hour += 1) {
    update(state, 60);
    emailRequest = (state.reservations.requests || [])
      .find((entry) => entry.channel === 'email' && entry.status === 'pending');
  }
  assert.ok(emailRequest, 'no email request rolled in 30 game-hours — the trickle is dead');
  const mail = ensureMail(state);
  const row = mail.messages.find((msg) => msg.kind === 'booking-request'
    && msg.data.requestId === emailRequest.id);
  assert.ok(row, 'the email request never landed in the inbox');
  assert.equal(row.read, false, 'a fresh request arrives unread');
  assert.ok(unreadMailCount(state) >= 1);
  const declined = declineBookingRequest(state, emailRequest.id);
  assert.equal(declined.ok, true);
  assert.equal(row.resolved, 'declined', 'the mail row does not carry the resolution');
  assert.ok(mail.messages.includes(row), 'resolving a request must not delete its mail');
});

test('a placed supplier order confirms itself by mail', () => {
  const state = stateAtMorning();
  state.cash = 50_000;
  // retail categories gate on shop progression; the legacy supplier override
  // (tutorial complete + tier 3) opens ordering without walking the campaign
  state.tutorial = { ...(state.tutorial || {}), complete: true };
  state.shop.unlockedTier = 3;
  const sku = SHOP_CATALOG.find((entry) => entry.cost > 0 && (entry.tier ?? 1) <= 3) || SHOP_CATALOG[0];
  const result = placeOrder(state, sku.id, 2);
  assert.equal(result.ok, true, `order refused: ${result.reason || ''}`);
  const mail = ensureMail(state);
  const row = mail.messages.find((msg) => msg.kind === 'supplier-order');
  assert.ok(row, 'no supplier confirmation mail');
  assert.equal(row.data.qty, 2);
  assert.ok(row.data.cost > 0);
});

test('healing: mangled phone and mail stores come back usable', () => {
  const state = stateAtMorning();
  state.phone = { calls: [{ junk: true }, { id: 3, name: 'Kept Caller', outcome: 'booked' }], texts: 'nonsense' };
  state.mail = { messages: [null, { id: 9, kind: 'supplier-order', data: { orderId: 1 } }, { kind: 'no-id' }] };
  const phone = ensurePhone(state);
  const mail = ensureMail(state);
  assert.equal(phone.calls.length, 1, 'healing kept the malformed call row');
  assert.equal(phone.calls[0].name, 'Kept Caller');
  assert.ok(Array.isArray(phone.texts));
  assert.equal(mail.messages.length, 1, 'healing kept the malformed mail rows');
  assert.ok(phone.nextCallId > 3, 'nextCallId must clear the surviving ids');
});
