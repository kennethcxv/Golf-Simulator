// Doors must swing AWAY from whoever opens them; architecturally one-way doors
// keep their fixed direction. Angle sign convention matches the hinge groups:
// 'x'-aligned + rotation sweeps the slab toward -z; 'z'-aligned + sweeps toward +x.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSwingAngle, SWING } from '../src/data/doorMath.js';

const stock = { along: 'x', lx: 8.34, lz: 2.0, fixedSwing: 0 }; // partition door
const recv = { along: 'z', lx: 10.375, lz: -4.26, fixedSwing: 0 }; // east wall door
const main = { along: 'x', lx: -1.61, lz: 6.625, fixedSwing: SWING }; // entry, inward only

test('x-aligned service door swings away from the opener on either side', () => {
  // opener south of the partition (office side, +z): slab sweeps north (-z) = +SWING
  assert.equal(chooseSwingAngle(stock, 8.9, 3.0), SWING);
  // opener north (stockroom side): slab sweeps south = -SWING
  assert.equal(chooseSwingAngle(stock, 8.9, 1.0), -SWING);
});

test('z-aligned service door swings away from the opener on either side', () => {
  // opener east of the wall (outside, +x): slab sweeps west (inside) = -SWING
  assert.equal(chooseSwingAngle(recv, 12.0, -3.6), -SWING);
  // opener west (inside): slab sweeps east (outside) = +SWING
  assert.equal(chooseSwingAngle(recv, 9.0, -3.6), SWING);
});

test('entry door is architecturally inward regardless of the opener side', () => {
  assert.equal(chooseSwingAngle(main, -0.8, 9.0), SWING); // from the porch
  assert.equal(chooseSwingAngle(main, -0.8, 4.0), SWING); // from inside
});
