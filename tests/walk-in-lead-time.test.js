// D2 (Goal 20) — a walk-in asks for a time that correlates with the clock.
//
// The owner's report: "It was 6:44 am in the clubhouse and people were teeing
// up for 8:30." The lead was `45 + rng.int(300)` — up to five hours — so a
// golfer who had walked through the door at 6:46 could ask for a slot two hours
// out and then, presumably, wait for it. Anybody planning that far ahead rings
// up, which is the channel C1 made worth having.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import {
  planCustomerArrivals, customerSimulationOf,
  CUSTOMER_INTENT, WALK_IN_ASK_MIN, WALK_IN_ASK_MAX, walkInAskFrom,
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

// THE SECOND GENERATOR, found by Verifier 1 AFTER the first fix had already
// been committed and reported as done. A golfer who spawns on the shop floor
// takes an ask from clubhouse.js, not from the arrival planner above, and that
// path had its own rule: the nearest TEN slots ahead, biased toward soon. On a
// thirty-minute grid that is five hours. The planner fix did nothing for it,
// and the test that passed only ever measured the planner — two populations,
// one measured.
test('D2 second generator: an ask taken off the slot grid stays inside the window', () => {
  const grid = [];
  for (let m = 7 * 60; m <= 18 * 60; m += 30) grid.push(m);
  const now = 10 * 60 + 58; // the moment Verifier 1 photographed
  for (let i = 0; i <= 20; i += 1) {
    const roll = i / 20;
    const ask = walkInAskFrom(now, grid, roll);
    assert.ok(ask !== null, `no ask at roll ${roll}`);
    const lead = ask - now;
    assert.ok(lead >= WALK_IN_ASK_MIN - 30, `roll ${roll} asked ${lead} minutes ahead: the past`);
    assert.ok(lead <= WALK_IN_ASK_MAX + 30,
      `roll ${roll} asked ${lead} minutes ahead; the rule this replaces reached 300`);
  }
  // the exact case the verifier reported: 10:58 must never produce 12:30
  const asks = new Set();
  for (let i = 0; i <= 50; i += 1) asks.add(walkInAskFrom(now, grid, i / 50));
  assert.equal(asks.has(12 * 60 + 30), false, '12:30 is still reachable from 10:58');
});

test('D2 second generator: a sparse sheet takes the next slot, not nothing', () => {
  // a nearly-full day with one gap far out: the window is empty, and refusing
  // to ask at all would leave the walk-in mute at the desk
  const sparse = [7 * 60, 12 * 60];
  assert.equal(walkInAskFrom(8 * 60, sparse, 0.9), 12 * 60,
    'with nothing inside the window, take the next slot that exists');
  // ...but never a slot that has already gone
  assert.equal(walkInAskFrom(13 * 60, sparse, 0.5), null);
  // past the end of the day there is simply nothing to ask for
  const full = [];
  for (let m = 7 * 60; m <= 18 * 60; m += 30) full.push(m);
  assert.equal(walkInAskFrom(19 * 60, full, 0.5), null);
  assert.equal(walkInAskFrom(10 * 60, [], 0.5), null);
});

test('D2: both generators are the same rule, so neither can drift again', () => {
  // The structural half of the fix. clubhouse.js used to carry its own copy of
  // this arithmetic; now it calls the sim's, which is why there is one place to
  // change and one place to test.
  const clubhouse = readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');
  assert.match(clubhouse, /walkInAskFrom\(/, 'the floor spawner must use the shared rule');
  assert.doesNotMatch(clubhouse, /Math\.min\(grid\.length, 10\)/,
    'the ten-slot reach must be gone, not merely unused');
});
