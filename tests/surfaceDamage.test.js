import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE } from '../src/sim/constants.js';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  SURFACE_DAMAGE_CAP, repairSurfaceDamageAt, surfaceDamageDaily,
} from '../src/sim/surfaceDamage.js';

test('actual rounds create bounded divots and ball marks on appropriate surfaces', () => {
  const state = newGame('realistic', 5101);
  state.turf.divots.fill(0);
  state.turf.ballMarks.fill(0);
  state.club.lastRounds = 70;
  const result = surfaceDamageDaily(state);
  assert.equal(result.divots, 23);
  assert.equal(result.ballMarks, 13);
  assert.ok(state.turf.divots.some((value) => value > 0));
  assert.ok(state.turf.ballMarks.some((value) => value > 0));
  for (let i = 0; i < state.course.zones.length; i++) {
    if (state.turf.divots[i] > 0) assert.ok(state.course.zones[i] === ZONE.TEE || state.course.zones[i] === ZONE.FAIRWAY);
    if (state.turf.ballMarks[i] > 0) assert.equal(state.course.zones[i], ZONE.GREEN);
  }
  for (let day = 0; day < 80; day++) surfaceDamageDaily(state);
  assert.ok(Math.max(...state.turf.divots) <= SURFACE_DAMAGE_CAP);
  assert.ok(Math.max(...state.turf.ballMarks) <= SURFACE_DAMAGE_CAP);
});

test('manual repair is localized and reduces explicit damage plus wear', () => {
  const state = newGame('realistic', 5102);
  const tee = state.sections.find((section) => section.zone === ZONE.TEE);
  const cell = tee.cells[0];
  const neighbor = tee.cells[1];
  state.turf.divots[cell] = 3;
  state.turf.divots[neighbor] = 2;
  state.turf.wear[cell] = 30;
  const result = repairSurfaceDamageAt(state, cell, 1);
  assert.equal(result.ok, true);
  assert.ok(state.turf.divots[cell] < 3);
  assert.equal(state.turf.divots[neighbor], 2);
  assert.ok(state.turf.wear[cell] < 30);
});

test('surface damage survives save/load exactly and legacy saves allocate full arrays', () => {
  const state = newGame('realistic', 5103);
  state.club.lastRounds = 35;
  surfaceDamageDaily(state);
  const loaded = deserialize(serialize(state));
  assert.deepEqual(Array.from(loaded.turf.divots, (v) => Math.round(v * 10) / 10),
    Array.from(state.turf.divots, (v) => Math.round(v * 10) / 10));
  assert.deepEqual(Array.from(loaded.turf.ballMarks, (v) => Math.round(v * 10) / 10),
    Array.from(state.turf.ballMarks, (v) => Math.round(v * 10) / 10));

  const legacy = JSON.parse(serialize(state));
  delete legacy.turf.divots;
  delete legacy.turf.ballMarks;
  const migrated = deserialize(legacy);
  assert.equal(migrated.turf.divots.length, migrated.course.w * migrated.course.h);
  assert.equal(migrated.turf.ballMarks.length, migrated.course.w * migrated.course.h);
  assert.ok(migrated.turf.divots.every((value) => value === 0));
});
