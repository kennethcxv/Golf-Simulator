// Wetness dries. Solution is a real prerequisite, not decoration.
//
// The spray-then-wipe loop only exists if the cloth is genuinely unable to work on a dry surface.
// If spraying is optional, the two tools collapse into one button and the sequence in the
// reference art is a lie.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureWet, wetAt, wetLevel, solutionAt, solutionLevel, consumeSolution, dryTick,
  meanWet, WET_DRY_SEC, SOLUTION_DRY_SEC, SOLUTION_MIN,
} from '../src/sim/cleaningWet.js';

// 13 x 8 yards at quarter-yard cells = 1,664 cells. The shipped interior grime grid was 13 x 8
// CELLS — 104 for the whole floor — which is why vacuuming read as "everything near me vanished".
const GEOM = { w: 52, h: 32, cell: 0.25 };

function floor() {
  const state = { shop: { reno: {} } };
  ensureWet(state, GEOM.w, GEOM.h);
  return state;
}

test('the mop leaves water where it was actually worked, and nowhere else', () => {
  const s = floor();
  wetAt(s, GEOM, 3, 3, 0.4);
  assert.ok(wetLevel(s, GEOM, 3, 3) > 0.5, 'the stroke leaves the floor wet');
  assert.equal(wetLevel(s, GEOM, 9, 9), 0, 'the far side of the room stays dry');
});

test('wetness has a soft edge rather than a stamped disc', () => {
  const s = floor();
  wetAt(s, GEOM, 4, 4, 0.9);
  const centre = wetLevel(s, GEOM, 4, 4);
  const edge = wetLevel(s, GEOM, 4.75, 4);
  assert.ok(centre > edge, 'the middle of the stroke must be wetter than its edge');
  assert.ok(edge > 0, 'the edge must feather out, not end on a hard circle');
});

test('a wet floor dries on its own', () => {
  const s = floor();
  wetAt(s, GEOM, 3, 3, 0.4);
  const start = wetLevel(s, GEOM, 3, 3);
  dryTick(s, WET_DRY_SEC * 0.5);
  const half = wetLevel(s, GEOM, 3, 3);
  assert.ok(half < start, 'it should be drying');
  dryTick(s, WET_DRY_SEC);
  assert.equal(wetLevel(s, GEOM, 3, 3), 0, 'and eventually be dry');
});

test('dryTick reports whether anything moved, so a dry floor costs nothing to repaint', () => {
  const s = floor();
  assert.equal(dryTick(s, 1), false, 'a dry floor reports no change');
  wetAt(s, GEOM, 2, 2, 0.4);
  assert.equal(dryTick(s, 1), true, 'a wet floor reports change');
});

test('the spray lays solution only where it is aimed', () => {
  const s = floor();
  solutionAt(s, GEOM, 5, 2, 0.3);
  assert.ok(solutionLevel(s, GEOM, 5, 2) > SOLUTION_MIN, 'solution lands where you sprayed');
  assert.equal(solutionLevel(s, GEOM, 1, 7), 0, 'and not on the other side of the room');
});

test('solution flashes off faster than water, so you cannot spray the whole room and wander off', () => {
  const s = floor();
  solutionAt(s, GEOM, 5, 2, 0.3);
  wetAt(s, GEOM, 5, 2, 0.3);
  dryTick(s, SOLUTION_DRY_SEC + 1);
  assert.equal(solutionLevel(s, GEOM, 5, 2), 0, 'the solution has gone off');
  assert.ok(wetLevel(s, GEOM, 5, 2) > 0, 'but the water has not fully dried yet');
});

test('wiping uses the solution up', () => {
  const s = floor();
  solutionAt(s, GEOM, 4, 4, 0.3);
  const before = solutionLevel(s, GEOM, 4, 4);
  consumeSolution(s, GEOM, 4, 4, 0.22, 0.5);
  const after = solutionLevel(s, GEOM, 4, 4);
  assert.ok(after < before, 'the cloth takes the solution with the dirt');
});

test('the whole-floor average tracks the work done', () => {
  const s = floor();
  assert.equal(meanWet(s), 0);
  for (let i = 0; i < 6; i++) wetAt(s, GEOM, 2 + i, 4, 0.5);
  assert.ok(meanWet(s) > 0, 'mopping registers across the floor');
});

test('the healer gives a legacy save valid fields and survives a round trip', () => {
  const legacy = { shop: { reno: {} } };
  ensureWet(legacy, GEOM.w, GEOM.h);
  assert.equal(legacy.shop.reno.wet.length, GEOM.w * GEOM.h);
  assert.equal(legacy.shop.reno.solution.length, GEOM.w * GEOM.h);

  wetAt(legacy, GEOM, 3, 3, 0.4);
  const before = wetLevel(legacy, GEOM, 3, 3);
  const round = JSON.parse(JSON.stringify(legacy));
  ensureWet(round, GEOM.w, GEOM.h);
  assert.equal(wetLevel(round, GEOM, 3, 3), before, 'a reload preserves the wet floor exactly');
});

test('the healer scrubs NaNs rather than letting them poison the field', () => {
  const s = { shop: { reno: { wet: [NaN, 0.5, undefined], solution: [1, NaN] } } };
  ensureWet(s, GEOM.w, GEOM.h);
  for (const v of s.shop.reno.wet) assert.ok(Number.isFinite(v));
  for (const v of s.shop.reno.solution) assert.ok(Number.isFinite(v));
});
