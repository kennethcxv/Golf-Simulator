// The player must never be permanently trapped.
//
// The collision system only ever asked "may I move INTO that?" — it had no notion of already
// being inside something. Once overlapped (a door sweeping shut, a box set down at your feet,
// a fixture placed on you, a bad spawn) every candidate move was rejected and the only way out
// was to restart. Measured: a player inside the fixture cluster holding W for 1.2 s travelled
// 0.227 yd; unobstructed they would cover ~5 yd.
//
// So: push out of overlaps every frame, remember where it was last safe, notice when the player
// is pinned anyway, and escalate until they are free.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOverlaps, createStuckMonitor, createSafeTrail, nearestFree,
} from '../src/core/unstick.js';

const box = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ });
const R = 0.35; // player radius

test('a player standing inside a shelf is pushed out to its nearest face', () => {
  // shelf occupies x 0..4, z 0..1. Player at (2, 0.8) — deepest into the +z face.
  const out = resolveOverlaps(2, 0.8, R, [[box(0, 4, 0, 1)]]);
  assert.equal(out.pushed, true);
  assert.equal(+out.x.toFixed(3), 2, 'the short way out does not slide you sideways');
  assert.ok(out.z >= 1 + R - 1e-6, `pushed clear of the face (z=${out.z})`);
  assert.equal(+out.z.toFixed(3), +(1 + R).toFixed(3), 'and exactly clear, not flung');
});

test('the push always takes the shortest axis out', () => {
  // player just inside the -x face of a tall box
  const out = resolveOverlaps(0.1, 5, R, [[box(0, 10, 0, 10)]]);
  assert.equal(+out.x.toFixed(3), +(0 - R).toFixed(3), 'out through the near wall, not up 5 yd');
  assert.equal(+out.z.toFixed(3), 5, 'z untouched');
});

test('a player inside a round collider is pushed along the radius', () => {
  const out = resolveOverlaps(10.2, 10, R, [[{ x: 10, z: 10, r: 1 }]]);
  assert.equal(out.pushed, true);
  const d = Math.hypot(out.x - 10, out.z - 10);
  assert.ok(Math.abs(d - (1 + R)) < 1e-6, `pushed to the circle's edge (d=${d})`);
});

test('a player at the exact centre of a round collider still gets out (no divide by zero)', () => {
  const out = resolveOverlaps(10, 10, R, [[{ x: 10, z: 10, r: 1 }]]);
  assert.equal(out.pushed, true);
  assert.ok(Number.isFinite(out.x) && Number.isFinite(out.z), 'no NaN');
  const d = Math.hypot(out.x - 10, out.z - 10);
  assert.ok(Math.abs(d - (1 + R)) < 1e-6, 'still lands on the edge');
});

test('a wedge between two colliders resolves both, not just one', () => {
  // corner: pushed out of A lands you inside B, so it has to iterate
  const cols = [[box(0, 4, 0, 1), box(0, 1, 0, 4)]];
  const out = resolveOverlaps(0.5, 0.5, R, cols);
  const insideA = out.x + R > 0 && out.x - R < 4 && out.z + R > 0 && out.z - R < 1;
  const insideB = out.x + R > 0 && out.x - R < 1 && out.z + R > 0 && out.z - R < 4;
  assert.equal(insideA, false, 'clear of A');
  assert.equal(insideB, false, 'clear of B');
});

test('standing in the clear is left alone', () => {
  const out = resolveOverlaps(50, 50, R, [[box(0, 4, 0, 1)]]);
  assert.equal(out.pushed, false);
  assert.equal(out.x, 50);
  assert.equal(out.z, 50);
});

test('the stuck monitor escalates only while the player is actually pinned', () => {
  const m = createStuckMonitor({ softMs: 700, hardMs: 1800 });
  // walking normally: never fires
  for (let i = 0; i < 200; i++) {
    assert.equal(m.update(16, { wantsToMove: true, moved: 0.08, overlapping: false }), null);
  }
  // standing still on purpose: never fires either
  for (let i = 0; i < 200; i++) {
    assert.equal(m.update(16, { wantsToMove: false, moved: 0, overlapping: false }), null);
  }
});

test('the stuck monitor escalates: last safe first, then nearest free', () => {
  const m = createStuckMonitor({ softMs: 700, hardMs: 1800 });
  const pinned = { wantsToMove: true, moved: 0, overlapping: true };
  const fired = [];
  for (let t = 0; t < 2400; t += 16) {
    const r = m.update(16, pinned);
    if (r) fired.push({ pinnedMs: m.stuckMs, r }); // elapsed *pinned* time, not wall clock
  }
  assert.deepEqual(fired.map((f) => f.r), ['lastSafe', 'nearestFree']);
  assert.ok(fired[0].pinnedMs >= 700 && fired[0].pinnedMs < 730, `soft recovery at ~700ms (was ${fired[0].pinnedMs})`);
  assert.ok(fired[1].pinnedMs >= 1800 && fired[1].pinnedMs < 1830, `hard recovery at ~1800ms (was ${fired[1].pinnedMs})`);
});

test('getting free resets the monitor so it can catch the next trap', () => {
  const m = createStuckMonitor({ softMs: 700, hardMs: 1800 });
  for (let t = 0; t < 800; t += 16) m.update(16, { wantsToMove: true, moved: 0, overlapping: true });
  assert.ok(m.stuckMs > 700);
  m.update(16, { wantsToMove: true, moved: 0.09, overlapping: false }); // free again
  assert.equal(m.stuckMs, 0);
});

test('the safe trail hands back the most recent spot that is still free', () => {
  const trail = createSafeTrail(8);
  trail.record(1, 1);
  trail.record(2, 2);
  trail.record(3, 3); // this one has since been built on
  const isFree = (x) => x !== 3;
  const p = trail.recall(isFree);
  assert.deepEqual({ x: p.x, z: p.z }, { x: 2, z: 2 }, 'walks back until it finds solid ground');
});

test('the safe trail is bounded', () => {
  const trail = createSafeTrail(4);
  for (let i = 0; i < 50; i++) trail.record(i, i);
  assert.equal(trail.size, 4);
});

test('nearest-free spirals outward to the closest open spot', () => {
  // everything within 1yd of the origin is solid
  const isFree = (x, z) => Math.hypot(x, z) > 1;
  const p = nearestFree(0, 0, isFree, 0.25, 40);
  assert.ok(p, 'found somewhere');
  assert.ok(isFree(p.x, p.z), 'and it really is free');
  assert.ok(Math.hypot(p.x, p.z) < 1.6, `and it is close by (${Math.hypot(p.x, p.z).toFixed(2)}yd)`);
});

test('nearest-free gives up rather than lying when everything is solid', () => {
  assert.equal(nearestFree(0, 0, () => false, 0.25, 10), null);
});
