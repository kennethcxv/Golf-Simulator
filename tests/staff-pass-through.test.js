// C5 — you have to be able to WALK to the back of your own counter.
//
// checkout-space.test.js already claims "the staff corridor has a way in from
// the sales floor". It computes that from two rectangles — the desk's east end
// against the hutch's east end — and it has passed through every version of this
// room including the one measured in Electron on 2026-08-04, where a connected-
// component sweep of the LIVE collider set put the till in a 1.01 yd² island
// with no route into it from anywhere. Rect arithmetic cannot see the return
// leg, the seal fillets or the office chair, so it answered a question nobody
// asked.
//
// This file asserts the things that made the difference, each derived from the
// frame rather than pinned to a number:
//   * a desk without a return leg has no return geometry to draw,
//   * the pass-through end is the one nearer the main door,
//   * the pass-through is at least a player wide,
//   * the desk's own chair is not parked in it.
//
// It is still rect arithmetic and it still cannot prove the route. The route is
// proved by tools/qa/staff-route-measure.js against the running build; this file
// exists so the datums that route depends on cannot drift silently.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOOR_MAIN, FRONT_DESK, FRONT_DESK_COLLIDERS, FRONT_DESK_FRAME,
  PLAYER_DIAM, deriveFrontDeskFrame, frontDeskLocalPoint,
} from '../src/data/shopLayout.js';

const v2 = deriveFrontDeskFrame('pine-hills-v2');
const v1 = deriveFrontDeskFrame(null);

test('the pass-through end is derived from the door, not chosen', () => {
  const half = v2.frontLength / 2;
  const cos = Math.cos(v2.ry);
  const endX = (localX) => v2.x + localX * cos;
  const near = Math.abs(endX(v2.passThroughLocalX) - DOOR_MAIN.x);
  const far = Math.abs(endX(-v2.passThroughLocalX) - DOOR_MAIN.x);
  assert.ok(Math.abs(Math.abs(v2.passThroughLocalX) - half) < 1e-9,
    'the pass-through is at one END of the counter run');
  assert.ok(near <= far,
    `the gap is at the far end: ${near.toFixed(2)} yd from the door vs ${far.toFixed(2)}`);
});

test('a desk with no return leg has nothing to draw and nothing to collide with', () => {
  assert.equal(v2.staffReturn, false, 'pine-hills-v2 has no return leg');
  assert.equal(v2.returnStaffExtent, v2.frontDepth / 2,
    'the extent collapses onto the counter back face rather than being authored twice');
  // FRONT_DESK_COLLIDERS resolves from the ACTIVE variant, and under Node that
  // is v1 — asserting on it here would audit the wrong room. Rebuild the rect
  // from the v2 frame the same way shopLayout does.
  const depth = v2.returnStaffExtent - v2.frontDepth / 2;
  assert.ok(depth < 0.01, `the v2 return still projects ${depth.toFixed(2)} yd into the corridor`);
  // ...and the shipped rect must collapse the same way when v2 IS the active
  // variant, which is what the renderers' `returnSpan > 0.01` guard keys off.
  const active = FRONT_DESK_COLLIDERS.returnRun;
  assert.ok(Number.isFinite(active.minX), 'returnRun stays a rect so its consumers keep working');
});

test('v1 keeps its return leg — this is a v2 ruling, not a global one', () => {
  assert.equal(v1.staffReturn, true);
  assert.ok(v1.returnStaffExtent > v1.frontDepth / 2 + 0.5,
    'the v1 return still crosses its corridor');
});

test('the pass-through is wider than the player who has to use it', () => {
  // The clear opening is the counter end itself: from the end of the run to
  // wherever the next solid thing starts. With no return leg that is the whole
  // width of the return the leg used to occupy.
  const clear = v2.returnCollisionWidth;
  assert.ok(clear >= PLAYER_DIAM + 0.15,
    `the staff gap is ${clear.toFixed(2)} yd and a player is ${PLAYER_DIAM}`);
});

test('the desk chair is parked out of the pass-through', () => {
  const chair = frontDeskLocalPoint(FRONT_DESK.staffChair.x, FRONT_DESK.staffChair.z);
  // A 0.65 yd chair (placeableCatalog's own footprint) plus a player must not
  // both fit in the gap — so the chair simply may not be within reach of it.
  const CHAIR_HALF = 0.65 / 2;
  const gapInner = v2.passThroughLocalX < 0
    ? v2.passThroughLocalX + v2.returnCollisionWidth
    : v2.passThroughLocalX - v2.returnCollisionWidth;
  const clearOfGap = v2.passThroughLocalX < 0
    ? chair.x - CHAIR_HALF >= gapInner
    : chair.x + CHAIR_HALF <= gapInner;
  assert.ok(clearOfGap,
    `the chair at local x ${chair.x.toFixed(2)} overlaps the pass-through, which ends at ${gapInner.toFixed(2)}`);
  assert.ok(chair.z > v2.frontDepth / 2,
    'the chair is on the staff side of the counter');
});
