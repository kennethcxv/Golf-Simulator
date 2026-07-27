// The anti-180-spin contract for first-person look. A single pointer-lock event
// — however large its (possibly synthetic or reacquisition-inflated) delta —
// can never whip the view around. Yaw stays wrapped, pitch stays clamped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMouseLook, MOUSE_DELTA_MAX } from '../src/render3d/mouseLook.js';

test('a normal mouse move turns the view a small, proportional amount', () => {
  const a = applyMouseLook(0, 0, 20, 0, 1);
  assert.ok(Math.abs(a.yaw) > 0 && Math.abs(a.yaw) < 0.1, `small yaw step (${a.yaw})`);
  const b = applyMouseLook(0, 0, 40, 0, 1);
  assert.ok(Math.abs(b.yaw) > Math.abs(a.yaw), 'a bigger move turns more');
});

test('an enormous reacquisition delta is clamped — no 180 whip', () => {
  const huge = applyMouseLook(0, 0, 8000, 0, 1);
  const capped = applyMouseLook(0, 0, MOUSE_DELTA_MAX, 0, 1);
  assert.equal(huge.yaw, capped.yaw, 'a 8000px jump lands exactly where the cap does');
  // and the cap itself is well under a half turn
  assert.ok(Math.abs(capped.yaw) < Math.PI / 2, `capped step is under a quarter turn (${capped.yaw})`);
  const hugeNeg = applyMouseLook(0, 0, -8000, 0, 1);
  assert.equal(hugeNeg.yaw, applyMouseLook(0, 0, -MOUSE_DELTA_MAX, 0, 1).yaw);
});

test('yaw stays wrapped to [-PI, PI] across the seam', () => {
  // near +PI, a small further turn wraps to negative rather than growing unbounded
  const near = applyMouseLook(Math.PI - 0.02, 0, -60, 0, 1); // -movementX increases yaw
  assert.ok(near.yaw <= Math.PI && near.yaw >= -Math.PI, `yaw stays in range (${near.yaw})`);
  const near2 = applyMouseLook(-Math.PI + 0.02, 0, 60, 0, 1);
  assert.ok(near2.yaw <= Math.PI && near2.yaw >= -Math.PI, `yaw stays in range (${near2.yaw})`);
});

test('pitch is clamped so you cannot flip over the top or bottom', () => {
  // starting near the limit, a big (clamped) delta cannot push past it
  const up = applyMouseLook(0, 1.30, 0, -100000, 1);
  const down = applyMouseLook(0, -1.30, 0, 100000, 1);
  assert.equal(up.pitch, 1.35, 'pitch pins at the top limit');
  assert.equal(down.pitch, -1.35, 'pitch pins at the bottom limit');
  // and a single event from level can never reach the limit (the delta is clamped)
  const one = applyMouseLook(0, 0, 0, -100000, 1);
  assert.ok(Math.abs(one.pitch) < 0.35, `one event moves pitch only a little (${one.pitch})`);
});

test('sensitivity scales the step but the clamp still bounds it', () => {
  const slow = applyMouseLook(0, 0, 30, 0, 0.5);
  const fast = applyMouseLook(0, 0, 30, 0, 2);
  assert.ok(Math.abs(fast.yaw) > Math.abs(slow.yaw), 'higher sensitivity turns more per px');
  // even at high sensitivity, a clamped delta cannot exceed the capped step
  const hugeFast = applyMouseLook(0, 0, 9000, 0, 3);
  const cappedFast = applyMouseLook(0, 0, MOUSE_DELTA_MAX, 0, 3);
  assert.equal(hugeFast.yaw, cappedFast.yaw);
});

test('a garbage delta (NaN/undefined) never corrupts the view', () => {
  const a = applyMouseLook(0.3, 0.1, undefined, undefined, 1);
  assert.equal(a.yaw, 0.3);
  assert.equal(a.pitch, 0.1);
});
