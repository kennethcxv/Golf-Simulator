// BUNKER FOOTPRINTS — play traffic roughs up the sand (wear on BUNKER cells),
// the hand rake smooths it back. Additive module: turf.js untouched — bunker
// wear is inert in the health/condition math (verified read-only) and rides
// the existing wear array + its natural daily recovery.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { ZONE } from '../src/sim/constants.js';
import { bunkerDailyMess, BUNKER_MESS } from '../src/sim/bunkers.js';

const bunkerCells = (state) => {
  const out = [];
  for (let i = 0; i < state.course.zones.length; i++) {
    if (state.course.zones[i] === ZONE.BUNKER) out.push(i);
  }
  return out;
};

test('play traffic footprints the sand, up to a cap; quiet days leave it alone', () => {
  const state = newGame('relaxed', 42);
  const cells = bunkerCells(state);
  assert.ok(cells.length > 0, 'the starting course has bunkers');

  state.club.lastRounds = 0;
  bunkerDailyMess(state);
  assert.ok(cells.every((i) => state.turf.wear[i] === 0), 'no rounds, no footprints');

  state.club.lastRounds = 20;
  bunkerDailyMess(state);
  const after = state.turf.wear[cells[0]];
  assert.ok(after > 0, 'a busy day roughs up the sand');

  for (let d = 0; d < 60; d++) bunkerDailyMess(state);
  assert.ok(cells.every((i) => state.turf.wear[i] <= BUNKER_MESS.cap), 'footprints cap out');
  assert.equal(state.turf.wear[cells[0]], BUNKER_MESS.cap, 'a season of neglect hits the cap');
});

test('footprints land on sand only — turf wear is untouched', () => {
  const state = newGame('relaxed', 42);
  const fairwayIdx = state.course.zones.findIndex((z) => z === ZONE.FAIRWAY);
  const before = state.turf.wear[fairwayIdx];
  state.club.lastRounds = 25;
  bunkerDailyMess(state);
  assert.equal(state.turf.wear[fairwayIdx], before, 'fairway wear belongs to the turf sim');
});
