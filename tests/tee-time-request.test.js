// TEE TIMES MATCH THE ASK, AND A CHECK-IN CAN TURN INTO A PURCHASE.
//
// Walk report B6 (decision granted: "extend the scheduler"): "fix tee times to match the
// requested slot (a 4:00 request currently returns 8:30), with a nearest-slot offer within
// ±1 hour the customer accepts or declines, leaving if nothing fits" — and "add visits that
// combine a tee-time check-in with a purchase."
//
// The 8:30 bug had two halves: no entity ever CARRIED an ask, and the desk defaulted to the
// first open slot of the day. These tests hold the scheduler's three answers, the walk-in
// decline, the ask riding the arrival plan, and the combined-visit transition.
import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import {
  availableSlots, bookSlot, createWalkInBooking, fmtSlot, resolveTeeTimeRequest,
} from '../src/sim/reservations.js';
import { TEE_OFFER, teeTimeOffers } from '../src/sim/teeTimeOffer.js';
import {
  CUSTOMER_INTENT, CUSTOMER_STATE, customerSimulationOf, planCustomerArrivals,
  transitionCustomer, walkInRequestDeclined,
} from '../src/sim/customerSimulation.js';

const clubAt = (minuteOfDay, seed = 4242) => {
  const st = newGame('relaxed', seed);
  st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + minuteOfDay;
  return st;
};

test('an open requested slot resolves EXACT — a 4:00 ask books 4:00, not 8:30', () => {
  const st = clubAt(9 * 60);
  const cal = calendarOf(st.clock.minutes);
  const open = availableSlots(st, cal.dayAbs, { partySize: 2, walkIn: true });
  const fourPm = open.find((slot) => slot.minute === 16 * 60)
    || open.find((slot) => slot.minute >= 15 * 60);
  assert.ok(fourPm, 'the afternoon has open slots on a fresh club');
  const resolved = resolveTeeTimeRequest(st, cal.dayAbs, fourPm.minute, { partySize: 2 });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.exact, true);
  assert.equal(resolved.slot.minute, fourPm.minute, 'the answer is the asked slot itself');
  assert.equal(resolved.deltaMin, 0);
});

test('a taken slot resolves to the NEAREST within the hour, with a signed delta', () => {
  const st = clubAt(9 * 60);
  const cal = calendarOf(st.clock.minutes);
  const open = availableSlots(st, cal.dayAbs, { partySize: 1, walkIn: true });
  const target = open.find((slot) => slot.minute >= 14 * 60);
  assert.ok(target, 'an afternoon slot exists');
  // Fill the asked slot completely so the resolver has to offer a neighbour.
  const config = st.reservations.config;
  for (let seat = 0; seat < 4; seat += config.maxPartySize) {
    const booked = bookSlot(st, cal.dayAbs, target.minute, {
      name: `Blocker ${seat}`, partySize: Math.min(4 - seat, config.maxPartySize),
    });
    if (!booked.ok) break;
  }
  const stillOpen = availableSlots(st, cal.dayAbs, { partySize: 1, walkIn: true })
    .some((slot) => slot.minute === target.minute);
  assert.equal(stillOpen, false, 'the asked slot is genuinely full');
  const resolved = resolveTeeTimeRequest(st, cal.dayAbs, target.minute, { partySize: 1 });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.exact, false, 'this is an OFFER, not the ask');
  assert.ok(Math.abs(resolved.deltaMin) > 0 && Math.abs(resolved.deltaMin) <= 60,
    `the offer sits within the hour (got ${resolved.deltaMin})`);
  assert.equal(resolved.slot.minute - target.minute, resolved.deltaMin, 'the delta is signed and honest');
});

test('nothing within the window resolves NONE, naming the nearest for the record', () => {
  const st = clubAt(9 * 60);
  const cal = calendarOf(st.clock.minutes);
  // Ask for 4:00 PM but shrink the window to zero substitutes: windowMin 0 with
  // the exact slot filled means nothing qualifies.
  const open = availableSlots(st, cal.dayAbs, { partySize: 1, walkIn: true });
  const target = open.find((slot) => slot.minute >= 14 * 60);
  const config = st.reservations.config;
  for (let seat = 0; seat < 4; seat += config.maxPartySize) {
    const booked = bookSlot(st, cal.dayAbs, target.minute, {
      name: `Blocker ${seat}`, partySize: Math.min(4 - seat, config.maxPartySize),
    });
    if (!booked.ok) break;
  }
  const resolved = resolveTeeTimeRequest(st, cal.dayAbs, target.minute, { partySize: 1, windowMin: 0 });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.none, false, 'slots exist, just not inside the window');
  assert.ok(resolved.nearest, 'the nearest open time is still reported');
  assert.match(resolved.reason, /closest open time/);
});

// B4 (2026-08-03) moved this from an hour to the stated half hour, and — more
// importantly — from a wall to an offer. "If nothing is free within 30 minutes
// either side, the player OFFERS the nearest available time and the customer
// accepts or declines." So past the window the answer belongs to the customer,
// who carries how far they will stretch, rather than to a constant.
test('a slot outside the window is an OFFER: some customers take it, some pass', () => {
  const st = clubAt(9 * 60);
  const cal = calendarOf(st.clock.minutes);
  const open = availableSlots(st, cal.dayAbs, { partySize: 1, walkIn: true });
  const morning = open[0];
  const afternoonAsk = 16 * 60;
  assert.ok(afternoonAsk - morning.minute > TEE_OFFER.windowMin,
    'the fixture really is outside the window');

  // No flexibility stated: they hold to the window and pass.
  const passed = createWalkInBooking(st, {
    holder: 'Dale Whitfield',
    partySize: 1,
    dayAbs: cal.dayAbs,
    minute: morning.minute,
    requestedMinute: afternoonAsk,
  });
  assert.equal(passed.ok, false);
  assert.equal(passed.declined, true, 'this is the customer passing, not a validation error');
  assert.match(passed.reason, /asked for 4:00 PM/);
  assert.equal(passed.askedMinute, afternoonAsk, 'the refusal says what they asked for');
  assert.equal(passed.offeredMinute, morning.minute, '…and what they were offered');

  // The same offer to somebody with the afternoon free is ACCEPTED.
  const relaxed = createWalkInBooking(st, {
    holder: 'Marguerite Ash',
    partySize: 1,
    dayAbs: cal.dayAbs,
    minute: morning.minute,
    requestedMinute: afternoonAsk,
    teeFlexibilityMin: Math.abs(afternoonAsk - morning.minute) + 30,
  });
  assert.equal(relaxed.ok, true, relaxed.reason);
  assert.equal(relaxed.res.minute, morning.minute, 'they take the time they were offered');
});

test('a slot inside the window needs no persuading', () => {
  const st = clubAt(9 * 60);
  const cal = calendarOf(st.clock.minutes);
  const open = availableSlots(st, cal.dayAbs, { partySize: 1, walkIn: true });
  const ask = 16 * 60;
  const nearAsk = open.find((slot) => Math.abs(slot.minute - ask) <= TEE_OFFER.windowMin);
  assert.ok(nearAsk, 'a fresh club has an afternoon slot near 4:00');
  const accepted = createWalkInBooking(st, {
    holder: 'Dale Whitfield',
    partySize: 1,
    dayAbs: cal.dayAbs,
    minute: nearAsk.minute,
    requestedMinute: ask,
  });
  assert.equal(accepted.ok, true, accepted.reason);
  assert.equal(accepted.res.minute, nearAsk.minute, 'the booked slot is the one offered');
});

test('the desk offers times CLUSTERED around the ask, nearest first', () => {
  // The bug this replaces: the dropdown was every open slot across the whole
  // horizon sorted by clock, so a 1:00 ask produced a list starting at this
  // morning. The right answer was in it, and so was every wrong one.
  const st = clubAt(9 * 60);
  const cal = calendarOf(st.clock.minutes);
  const open = availableSlots(st, cal.dayAbs, { partySize: 1, walkIn: true });
  const asked = 13 * 60;
  const offered = teeTimeOffers(open, asked, { partySize: 1 });
  assert.equal(offered.none, false);
  assert.ok(offered.offers.length > 0, 'a fresh club has something to offer at 1:00');
  assert.equal(offered.beyondWindow, false, 'and it is genuinely near the ask');
  for (const entry of offered.offers) {
    assert.ok(Math.abs(entry.deltaMin) <= TEE_OFFER.windowMin,
      `${fmtSlot(entry.slot.minute)} is ${entry.deltaMin} min from the ask, outside the window`);
    assert.ok(open.some((slot) => slot.minute === entry.slot.minute),
      'every offered slot is one that is actually available');
  }
  // nearest first
  const distances = offered.offers.map((entry) => Math.abs(entry.deltaMin));
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b),
    'the list is ordered by how close it is to what they asked for');

  // …and with nothing near, the nearest single time comes back FLAGGED rather
  // than an empty list, because the player is meant to offer it.
  const impossible = teeTimeOffers(open, 3 * 60, { partySize: 1 });
  assert.equal(impossible.beyondWindow, true);
  assert.equal(impossible.offers.length, 1, 'one offer to make, not a sheet to browse');
});

test('walk-in arrivals carry a half-hour-snapped ask; shoppers carry none', () => {
  const st = clubAt(7 * 60, 909);
  const cal = calendarOf(st.clock.minutes);
  // Several seeds, because one day's plan can roll few walk-ins by chance.
  for (const day of [cal.dayAbs, cal.dayAbs + 1, cal.dayAbs + 2]) planCustomerArrivals(st, day);
  const sim = customerSimulationOf(st);
  const walkIns = (sim.scheduled || []).filter((a) => a.intent === CUSTOMER_INTENT.WALK_IN_TEE_TIME);
  const shoppers = (sim.scheduled || []).filter((a) => a.intent === CUSTOMER_INTENT.PRO_SHOP_SHOPPER);
  assert.ok(walkIns.length > 0, 'the day plan includes walk-in golfers');
  for (const arrival of walkIns) {
    assert.ok(Number.isFinite(arrival.requestedTeeMinute), `${arrival.name} arrives with no ask`);
    assert.equal(arrival.requestedTeeMinute % 30, 0, 'people ask for round times');
    assert.ok(arrival.requestedTeeMinute <= 19 * 60, 'nobody asks for a slot after close');
  }
  for (const arrival of shoppers) {
    assert.ok(arrival.requestedTeeMinute == null, 'a shopper has no tee-time ask');
  }
});

test('a declined walk-in leaves, with the reason on the record', () => {
  const st = clubAt(9 * 60, 909);
  const sim = customerSimulationOf(st);
  sim.active.push({
    id: 'walkin-test-1',
    name: 'Dale Whitfield',
    intent: CUSTOMER_INTENT.WALK_IN_TEE_TIME,
    state: CUSTOMER_STATE.FRONT_DESK_INQUIRY,
    stateEnteredAt: st.clock.minutes,
    stateHistory: [],
    cart: [],
    reasons: [],
    experience: {},
    requestedTeeMinute: 16 * 60,
  });
  const result = walkInRequestDeclined(st, 'walkin-test-1', 'nothing within an hour of 4:00 PM');
  assert.equal(result.ok, true);
  const entity = sim.active.find((c) => c.id === 'walkin-test-1');
  assert.equal(entity.state, CUSTOMER_STATE.LEAVING);
  assert.ok(entity.reasons.some((reason) => /4:00 PM/.test(reason)));
});

test('CHECK_IN may legally flow into shopping — the combined visit transition', () => {
  const st = clubAt(9 * 60, 909);
  const sim = customerSimulationOf(st);
  sim.active.push({
    id: 'combined-test-1',
    name: 'Rhea Osborne',
    intent: CUSTOMER_INTENT.RESERVATION_CHECK_IN,
    state: CUSTOMER_STATE.CHECK_IN,
    stateEnteredAt: st.clock.minutes,
    stateHistory: [],
    cart: [],
    reasons: [],
    experience: {},
  });
  const toShop = transitionCustomer(
    st, sim.active.find((c) => c.id === 'combined-test-1'),
    CUSTOMER_STATE.CHOOSING_ACTIVITY, 'picking up a few things before the round', st.clock.minutes,
  );
  assert.equal(toShop.ok, true, 'CHECK_IN -> CHOOSING_ACTIVITY is a legal transition');
  // The old table only allowed LEAVING; a regression here silently kills the
  // combined visit, so the legality IS the contract.
});
