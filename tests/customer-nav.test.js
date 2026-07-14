// Customer navigation: paths must route AROUND colliders (no more walking
// through the hat stand), re-route when the world changes, and survive
// degenerate goals. The nav module is pure, so this runs headless.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeNav } from '../src/render3d/clubhouse/nav.js';

const AREA = { minX: -10, maxX: 10, minZ: -10, maxZ: 10, cell: 0.3, radius: 0.32 };
const box = (x, z, hw, hd) => ({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });

function pathHitsBox(path, from, b, radius) {
  // sample every leg — no sample point may fall inside the inflated box
  let prev = from;
  for (const p of path) {
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.z - prev.z) / 0.1));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = prev.x + (p.x - prev.x) * t;
      const z = prev.z + (p.z - prev.z) * t;
      if (x > b.minX - radius * 0.6 && x < b.maxX + radius * 0.6
        && z > b.minZ - radius * 0.6 && z < b.maxZ + radius * 0.6) return true;
    }
    prev = p;
  }
  return false;
}

test('a path routes around an obstacle instead of through it', () => {
  const nav = makeNav(AREA);
  const obstacle = box(0, 0, 1.5, 0.5);
  nav.rebuild([obstacle]);
  const from = { x: -4, z: 0 };
  const path = nav.path(from.x, from.z, 4, 0);
  assert.ok(path && path.length >= 2, 'a detour path exists');
  assert.ok(!pathHitsBox(path, from, obstacle, AREA.radius), 'no leg crosses the obstacle');
  const end = path[path.length - 1];
  assert.ok(Math.hypot(end.x - 4, end.z - 0) < 0.5, 'lands at the goal');
});

test('open ground gives a single direct leg', () => {
  const nav = makeNav(AREA);
  nav.rebuild([]);
  const path = nav.path(-6, -6, 6, 6);
  assert.equal(path.length, 1);
  assert.equal(path[0].x, 6);
  assert.equal(path[0].z, 6);
});

test('rebuilding with a new collider re-routes the same trip', () => {
  const nav = makeNav(AREA);
  nav.rebuild([]);
  assert.equal(nav.path(-4, 2, 4, 2).length, 1, 'direct before the obstacle exists');
  const wall = box(0, 2, 0.4, 3.0);
  nav.rebuild([wall]);
  const path = nav.path(-4, 2, 4, 2);
  assert.ok(path.length >= 2, 'detour after the obstacle appears');
  assert.ok(!pathHitsBox(path, { x: -4, z: 2 }, wall, AREA.radius), 'detour avoids the new wall');
});

test('a goal inside a collider snaps to the nearest free spot', () => {
  const nav = makeNav(AREA);
  const b = box(3, 3, 0.8, 0.8);
  nav.rebuild([b]);
  const path = nav.path(-3, -3, 3, 3);
  assert.ok(path && path.length >= 1, 'still returns a usable path');
  const end = path[path.length - 1];
  assert.ok(Math.hypot(end.x - 3, end.z - 3) < 2.2, 'ends near the intended goal');
});

test('surrounded goals fail cleanly (caller falls back to a straight line)', () => {
  const nav = makeNav({ ...AREA, minX: -3, maxX: 3, minZ: -3, maxZ: 3 });
  nav.rebuild([box(0, 0, 2.9, 2.9)]); // nearly the whole grid
  const path = nav.path(-2.8, -2.8, 0, 0);
  // either no route or a route that stays out of the block — never a crash
  assert.ok(path === null || Array.isArray(path));
});
