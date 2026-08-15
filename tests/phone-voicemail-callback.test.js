// C2 (Goal 20) — a missed call leaves a message, and you can ring them back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newGame, snapshot } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import {
  golfOperationsTick, callBackRequest, ringingPhoneRequest, bookReservation, daySheet,
  PHONE_RING_MINUTES,
} from '../src/sim/reservations.js';
import { ensurePhone, playVoicemail, callById, unheardVoicemailCount } from '../src/sim/phone.js';

// Plant a phone request that is about to ring out, exactly as the roller makes
// them, and let the tick miss it.
function missedCall(state, { holder = 'Dana Whitfield', partySize = 2, dayAhead = 1, minute = null } = {}) {
  const now = Math.floor(state.clock.minutes);
  const book = state.reservations;
  book.requests = Array.isArray(book.requests) ? book.requests : [];
  book.nextRequestId = (book.nextRequestId || 1) + 1;
  const dayAbs = calendarOf(now).dayAbs + dayAhead;
  // Ask for a slot that is genuinely FREE. The first version picked 14:00 out
  // of the air; the club's opening diary had already booked it on some seeds,
  // so a test about "the slot was taken while the phone rang" was sometimes
  // starting from a slot that was taken before the phone rang at all.
  const free = daySheet(state, dayAbs).find((s) => s.available);
  const request = {
    id: `req_test_${book.nextRequestId}`,
    channel: 'phone',
    holder,
    partySize,
    dayAbs,
    minute: minute ?? free?.minute ?? 8 * 60,
    createdAtAbs: now,
    expiresAtAbs: now + PHONE_RING_MINUTES,
    status: 'pending',
  };
  book.requests.push(request);
  // let it ring out
  const after = now + PHONE_RING_MINUTES + 1;
  state.clock.minutes = after;
  golfOperationsTick(state, after);
  return request;
}

function openGame(seed) {
  const state = newGame('relaxed', seed);
  if (state.campaign) state.campaign.businessOpen = true;
  const now = Math.floor(state.clock.minutes);
  golfOperationsTick(state, now); // seed the diary
  return state;
}

test('a caller who rings out leaves a voicemail tied to their request', () => {
  const state = openGame(1201);
  const request = missedCall(state);
  const calls = ensurePhone(state).calls;
  const call = calls.find((c) => c.name === 'Dana Whitfield');
  assert.ok(call, 'the missed call must reach the log');
  assert.equal(call.outcome, 'missed');
  assert.equal(call.voicemail, true, 'a missed caller leaves a message');
  assert.equal(call.voicemailPlayed, false);
  assert.equal(call.requestId, request.id, 'the log must remember WHICH request rang out');
  assert.equal(unheardVoicemailCount(state), 1);

  const played = playVoicemail(state, call.id);
  assert.ok(played);
  assert.equal(callById(state, call.id).voicemailPlayed, true);
  assert.equal(unheardVoicemailCount(state), 0);
  // playing twice is harmless
  assert.ok(playVoicemail(state, call.id));
});

test('calling back re-opens the request, and the phone rings again', () => {
  const state = openGame(1202);
  const request = missedCall(state);
  const call = ensurePhone(state).calls.find((c) => c.requestId === request.id);
  assert.equal(ringingPhoneRequest(state), null, 'precondition: nothing is ringing');

  const result = callBackRequest(state, call.id);
  assert.equal(result.ok, true, `call back failed: ${result.code}`);
  assert.equal(result.request.status, 'pending');
  assert.equal(callById(state, call.id).calledBack, true);

  const ringing = ringingPhoneRequest(state);
  assert.ok(ringing, 'after calling back, the caller is on the line');
  assert.equal(ringing.id, request.id);
  assert.ok(ringing.expiresAtAbs > Math.floor(state.clock.minutes),
    'they hold the line long enough to be answered');
});

test('calling back fails honestly, with a reason, when it should', () => {
  const state = openGame(1203);
  const request = missedCall(state);
  const call = ensurePhone(state).calls.find((c) => c.requestId === request.id);

  // somebody else took the slot while the phone rang out
  const booked = bookReservation(state, {
    dayAbs: request.dayAbs,
    minute: request.minute,
    partySize: 4,
    name: 'Someone Else',
  });
  assert.ok(booked.ok || booked.res, 'precondition: the slot could be filled');
  const taken = callBackRequest(state, call.id);
  assert.equal(taken.ok, false);
  assert.equal(taken.code, 'slot-taken');

  // a call with no request behind it, and an id that does not exist
  assert.equal(callBackRequest(state, 99999).code, 'no-call');

  // and one whose tee time has come and gone
  const late = openGame(1204);
  const lateReq = missedCall(late, { holder: 'Omar Reyes', dayAhead: 0, minute: 23 * 60 });
  const lateCall = ensurePhone(late).calls.find((c) => c.requestId === lateReq.id);
  const past = (calendarOf(late.clock.minutes).dayAbs) * 1440 + 23 * 60;
  late.clock.minutes = past;
  assert.equal(callBackRequest(late, lateCall.id).code, 'tee-time-passed');
});

test('the voicemail fields survive a save and load', () => {
  const state = openGame(1205);
  const request = missedCall(state);
  const before = ensurePhone(state).calls.find((c) => c.requestId === request.id);
  playVoicemail(state, before.id);

  // snapshot() is an explicit field allowlist, and ensurePhone REBUILDS every
  // row it heals, so this round trip is where a field that nobody named goes
  // missing.
  const revived = ensurePhone(JSON.parse(JSON.stringify(snapshot(state))));
  const after = revived.calls.find((c) => c.name === before.name);
  assert.ok(after, 'the call survived');
  // The healer REBUILDS every row, so a field it does not name is dropped on
  // the first load. That would leave a save full of missed calls nobody can
  // ring back, with no error anywhere.
  assert.equal(after.requestId, request.id);
  assert.equal(after.voicemail, true);
  assert.equal(after.voicemailPlayed, true);
});

test('the phone UI actually calls both verbs', () => {
  // Guards the zero-call-sites trap: a tested sim function no screen reaches is
  // the same as no function at all.
  const ui = fs.readFileSync(new URL('../src/ui/phone.js', import.meta.url), 'utf8');
  assert.match(ui, /playVoicemail\(/, 'the calls app must be able to play a message');
  assert.match(ui, /callBackRequest\(/, 'the calls app must be able to ring back');
  assert.match(ui, /el\('button', \{\s*class: 'phone-row'/,
    'an actionable missed call has to be a button, or the arrow-key focus cannot reach it');
});
