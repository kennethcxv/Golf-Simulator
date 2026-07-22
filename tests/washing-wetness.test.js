import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WASH_WET_DRY_SEC, applyWashWetness, fadeWashWetness,
} from '../src/render3d/clubhouse/washing.js';

const surface = {
  size: { w: 4, h: 2 },
  grid: { w: 16, h: 8 },
};

test('pressure-washer wetness is surface-local with a soft footprint', () => {
  const wet = new Float32Array(surface.grid.w * surface.grid.h);
  const touched = applyWashWetness(wet, surface, 0.5, 0.5, 0.45);
  assert.ok(touched > 1);
  const centre = wet[4 * surface.grid.w + 8];
  assert.ok(centre > 0.5);
  assert.equal(wet[0], 0);
  assert.equal(wet.at(-1), 0);
});

test('pressure-washer wetness visibly fades before it disappears', () => {
  const wet = new Float32Array(surface.grid.w * surface.grid.h);
  applyWashWetness(wet, surface, 0.5, 0.5, 0.45);
  const before = Math.max(...wet);
  const halfway = fadeWashWetness(wet, WASH_WET_DRY_SEC / 2);
  assert.equal(halfway.changed, true);
  assert.ok(halfway.activeCells > 0);
  assert.ok(halfway.max > 0 && halfway.max < before);
});

test('pressure-washer wet feedback dries completely and retires', () => {
  const wet = new Float32Array(surface.grid.w * surface.grid.h);
  applyWashWetness(wet, surface, 0.5, 0.5, 0.45);
  const dry = fadeWashWetness(wet, WASH_WET_DRY_SEC + 0.1);
  assert.equal(dry.activeCells, 0);
  assert.equal(dry.total, 0);
  assert.equal(dry.max, 0);
  assert.ok(wet.every((value) => value === 0));
});
