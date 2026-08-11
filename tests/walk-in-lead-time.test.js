// D2 (Goal 20) — a walk-in asks for a time that correlates with the clock.
//
// The owner's report: "It was 6:44 am in the clubhouse and people were teeing
// up for 8:30." The lead was `45 + rng.int(300)` — up to five hours — so a
// golfer who had walked through the door at 6:46 could ask for a slot two hours
// out and then, presumably, wait for it. Anybody planning that far ahead rings
// up, which is the channel C1 made worth having.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import {
  planCustomerArrivals, customerSimulationOf,
  CUSTOMER_INTENT, WALK_IN_ASK_MIN, WALK_IN_ASK_MAX,
} from '../src/sim/customerSimulation.js';

function walkInsFor(seed) {
  const state = newGame('relaxed', seed);
  if (state.campaign) state.campaign.businessOpen = true;
  const dayAbs = calendarOf(state.clock.minutes).dayAbs;
  planCustomerArrivals(state, dayAbs);
  return customerSimulationOf(state).scheduled
    .filter((a) => a.intent === CUSTOMER_INTENT.WALK_IN_TEE_TIME
      && Number.isFinite(a.requestedTeeMinute))
    .map((a) => ({
      arriveMinute: a.scheduledMinute % 1440,
      askMinute: a.requestedTeeMinute,
      lead: a.requestedTeeMinute - (a.scheduledMinute % 1440),
    }));
}

test('a walk-in asks for the next hour, not the next five', () => {
  const all = [];
  for (const seed of [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010]) all.push(...walkInsFor(seed));
  assert.ok(all.length >= 12, `only ${all.length} walk-ins across ten seeds`);

  // The ask is snapped to the half hour, so the realised lead can sit up to 15
  // minutes either side of the drawn window. Anything beyond that is somebody
  // making an advance booking in person, which is the fault.
  const SNAP = 15;
  const worst = all.reduce((a, w) => (w.lead > a.lead ? w : a), all[0]);
  assert.ok(worst.lead <= WALK_IN_ASK_MAX + SNAP,
    `a walk-in arriving at ${worst.arriveMinute} asked for ${worst.askMinute}, `
    + `${worst.lead} minutes ahead (cap ${WALK_IN_ASK_MAX + SNAP})`);

  // ...and they are not asking for a slot they have already missed
  const soonest = all.reduce((a, w) => (w.lead < a.lead ? w : a), all[0]);
  assert.ok(soonest.lead >= WALK_IN_ASK_MIN - SNAP,
    `a walk-in asked for ${soonest.lead} minutes ahead, which is the past`);

  // THE OWNER'S CASE, stated as the number it was: an early-morning arrival
  // must not be asking for a mid-morning slot. Before this change the window
  // reached 345 minutes.
  const early = all.filter((w) => w.arriveMinute < 8 * 60);
  if (early.length) {
    const worstEarly = early.reduce((a, w) => (w.askMinute > a.askMinute ? w : a), early[0]);
    assert.ok(worstEarly.askMinute <= 9 * 60,
      `someone arriving at ${worstEarly.arriveMinute} asked to tee off at ${worstEarly.askMinute}`);
  }
});

test('the ask is still on the half hour, which is how the question is phrased', () => {
  for (const w of walkInsFor(505)) {
    assert.equal(w.askMinute % 30, 0, `asked for ${w.askMinute}, not a half hour`);
  }
});

test('the lead window is a named constant, not buried in an expression', () => {
  // It reached five hours because it was written inline and nobody re-read it.
  assert.equal(typeof WALK_IN_ASK_MIN, 'number');
  assert.equal(typeof WALK_IN_ASK_MAX, 'number');
  assert.ok(WALK_IN_ASK_MAX > WALK_IN_ASK_MIN);
  assert.ok(WALK_IN_ASK_MAX <= 90, 'a walk-in who waits over 90 minutes is not walking in');
});
