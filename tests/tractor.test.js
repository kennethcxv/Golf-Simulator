// THE EARNED TRACTOR — a broken machine by the shed, three honest chores
// (clear the junk, fuel it, fit a belt), then a real repair. Additive state
// (state.tractor) with save migration: pre-repair saves already HAD a working
// tractor, so they migrate to repaired rather than losing the keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  TRACTOR_STEPS, tractorStep, repairTractor, tractorRemaining, ensureTractor,
  setTractorLocation, recordTractorUse,
} from '../src/sim/tractor.js';

test('a fresh game starts with the tractor broken and all chores open', () => {
  const state = newGame('relaxed', 42);
  assert.ok(state.tractor, 'tractor state exists');
  assert.equal(state.tractor.repaired, false, 'starts broken');
  for (const s of TRACTOR_STEPS) assert.equal(state.tractor.steps[s], false, `${s} not done`);
  assert.equal(tractorRemaining(state).length, TRACTOR_STEPS.length, 'everything remains');
  assert.equal(state.tractor.attachment, null);
  assert.equal(state.tractor.location, null);
  assert.ok(state.tractor.condition > 0 && state.tractor.condition < 0.5);
});

test('each chore completes once; junk names are refused', () => {
  const state = newGame('relaxed', 42);
  assert.ok(tractorStep(state, 'cleared').ok, 'clearing the junk works');
  assert.equal(tractorStep(state, 'cleared').ok, false, 'a chore cannot be done twice');
  assert.equal(tractorStep(state, 'paintItGold').ok, false, 'unknown chores refused');
  assert.equal(tractorRemaining(state).length, TRACTOR_STEPS.length - 1);
});

test('the repair needs every chore done, then flips exactly once', () => {
  const state = newGame('relaxed', 42);
  assert.equal(repairTractor(state).ok, false, 'no repair with chores open');
  tractorStep(state, 'cleared');
  tractorStep(state, 'fuel');
  assert.equal(repairTractor(state).ok, false, 'still missing the belt');
  tractorStep(state, 'belt');
  const res = repairTractor(state);
  assert.ok(res.ok, 'all chores done — she runs');
  assert.equal(state.tractor.repaired, true);
  assert.equal(state.tractor.attachment, 'mower');
  assert.equal(state.tractor.fuel, 1);
  assert.equal(repairTractor(state).ok, false, 'cannot repair twice');
});

test('tractor state survives save/load; pre-tractor saves keep their working machine', () => {
  const state = newGame('relaxed', 42);
  tractorStep(state, 'fuel');
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.tractor.steps.fuel, true, 'progress round-trips');
  assert.equal(loaded.tractor.repaired, false);

  const raw = JSON.parse(serialize(state));
  delete raw.tractor; // a save from before the repair arc existed
  const migrated = deserialize(JSON.stringify(raw));
  assert.ok(migrated.tractor, 'old saves gain tractor state');
  assert.equal(migrated.tractor.repaired, true,
    'old saves already had a drivable tractor — migration must not take it away');
});

test('ensureTractor is a no-op when state exists', () => {
  const state = newGame('relaxed', 42);
  tractorStep(state, 'belt');
  const ref = state.tractor;
  ensureTractor(state, { legacyRepaired: true });
  assert.equal(state.tractor, ref, 'existing progress untouched');
  assert.equal(state.tractor.repaired, false, 'legacy flag only applies when creating');
});

test('position, condition, fuel, attachment and engine hours survive save/load', () => {
  const state = newGame('relaxed', 42);
  for (const step of TRACTOR_STEPS) tractorStep(state, step);
  repairTractor(state);
  assert.ok(recordTractorUse(state, { x: 14.2349, z: -8.7654, yaw: 1.23456, seconds: 180, mowing: true }).ok);
  const loaded = deserialize(serialize(state));
  assert.deepEqual(loaded.tractor.location, { x: 14.235, z: -8.765, yaw: 1.2346 });
  assert.equal(loaded.tractor.attachment, 'mower');
  assert.ok(loaded.tractor.condition < 0.88);
  assert.ok(loaded.tractor.fuel < 1);
  assert.equal(loaded.tractor.engineHours, 0.05);
});

test('runtime transform rejects broken tractors and bad coordinates', () => {
  const state = newGame('relaxed', 42);
  assert.equal(setTractorLocation(state, 1, 2, 3).ok, false);
  for (const step of TRACTOR_STEPS) tractorStep(state, step);
  repairTractor(state);
  assert.equal(setTractorLocation(state, NaN, 2, 3).ok, false);
  assert.equal(setTractorLocation(state, 1, 2, 3).ok, true);
});
