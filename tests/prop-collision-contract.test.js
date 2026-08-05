// BLOCKER 6 — the collision and parenting sweep, as a standing contract.
//
// Fifth instance of one class: an object whose collider is missing, or is
// somewhere the object is not. The sweep that found them is a live probe
// (tools/qa/proshop-collision-parenting-sweep.js, 7 findings on 2026-07-29:
// 6 solids the player walked through, 1 collider standing in empty air). This
// file pins the half of it that a Node test can actually decide — the data
// contract underneath.
//
// The root cause was not six independent mistakes. PROP_PLACEMENTS declares a
// `collision` owner for every placed asset, and NOTHING READ IT: no code
// anywhere referenced placement.collision. Eleven placements declared a hull
// and none of them got one, so whatever colliders those assets had came from
// hand-written boxes elsewhere — which is why the fitting room and the lounge
// coffee table were solid in neither room while the lounge armchair was solid
// in only one. A field that looks like a contract and has no consumer is worse
// than no field, because it reads as covered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PROP_PLACEMENTS } from '../src/render3d/assets51to100/runtimeManifest.js';
import { collisionIsOwnedElsewhere } from '../src/render3d/assets51to100/propPlacement.js';

test('every placement declares who owns its collider', () => {
  for (const placement of PROP_PLACEMENTS) {
    assert.equal(
      typeof placement.collision, 'string',
      `asset ${placement.n} has no collision declaration - silence reads as "none" and gets no hull`,
    );
  }
});

test('the ownership rule sorts the declarations the way the manifest means them', () => {
  // 'none'           nothing needed
  // 'fixture-anchor' the fixture system already put a box here
  // 'existing-*'     the analytic layout already put a box here
  // anything else    this placement needs its own hull
  assert.equal(collisionIsOwnedElsewhere('none'), true);
  assert.equal(collisionIsOwnedElsewhere('fixture-anchor'), true);
  assert.equal(collisionIsOwnedElsewhere('existing-office-desk'), true);
  assert.equal(collisionIsOwnedElsewhere('existing-checkout-island'), true);
  assert.equal(collisionIsOwnedElsewhere('lounge-armchair'), false);
  assert.equal(collisionIsOwnedElsewhere('fitting-room-hull'), false);
});

test('an unrecognised declaration defaults to needing a hull, not to nothing', () => {
  // The whole defect was a declaration that quietly meant nothing. A new asset
  // arriving with `collision: 'display-case'` must get a hull by default —
  // over-colliding is a bug you walk into and notice, under-colliding is a bug
  // you walk through and do not.
  assert.equal(collisionIsOwnedElsewhere('display-case'), false);
  assert.equal(collisionIsOwnedElsewhere('anything-new'), false);
});

test('an absent or empty declaration is treated as none, deliberately', () => {
  // Only because the test above requires every placement to declare one, so
  // this branch is unreachable from shipped data and exists for robustness.
  assert.equal(collisionIsOwnedElsewhere(undefined), true);
  assert.equal(collisionIsOwnedElsewhere(''), true);
  assert.equal(collisionIsOwnedElsewhere(null), true);
});

test('the placements that need their own hull are the ones the sweep found', () => {
  const needHull = PROP_PLACEMENTS
    .filter((p) => !collisionIsOwnedElsewhere(p.collision))
    .map((p) => p.n)
    .sort((a, b) => a - b);
  // 63 fitting room, 67 lounge sofa, 68 armchair, 69 coffee table, 70 trophy
  // cabinet. If this list changes, a new asset has started declaring a hull and
  // the live sweep is the thing to re-run.
  assert.deepEqual(needHull, [63, 67, 68, 69, 70]);
});

test('nothing declares a hull it cannot be given', () => {
  // A hull is fitted to the loaded mesh, so a placement that needs one has to
  // actually place a mesh — a socket-mounted tool hanging off another asset
  // cannot carry a floor collider sensibly.
  for (const placement of PROP_PLACEMENTS) {
    if (collisionIsOwnedElsewhere(placement.collision)) continue;
    assert.notEqual(
      placement.mount, 'socket',
      `asset ${placement.n} is socket-mounted and declares a hull (${placement.collision})`,
    );
  }
});
