import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { FIXTURES, fixtureRect } from '../src/data/shopLayout.js';
import { buildBuildMode, fixtureGhostProfile } from '../src/render3d/clubhouse/buildMode.js';
import { setTrackedFixtureCollidersActive } from '../src/render3d/clubhouse/fixtures.js';
import { newGame } from '../src/sim/state.js';

function modeHarness(fixtureMoveBlocker, options = {}) {
  const state = newGame('relaxed', 6);
  state.shop.progression.tier = 'luxury';
  const fixture = FIXTURES.find((entry) => entry.id === (options.fixtureId || 'table_polos'));
  const toasts = [];
  const anchor = new THREE.Group();
  const mode = buildBuildMode({
    interior: new THREE.Group(),
    state,
    hooks: { toast: (...args) => toasts.push(args) },
    walk: {
      x: fixture.x,
      z: fixture.z,
      yaw: 0,
      pitch: -Math.PI / 2,
      eye: 1.6,
    },
    W2L: (x, z) => ({ x, z }),
    L2W: (x, z) => ({ x, z }),
    FLOOR_TOP: 0,
  }, {
    rebuildLayout: options.rebuildLayout || (() => {}),
    fixtureAnchors: new Map([[fixture.id, anchor]]),
    fixtureMoveBlocker,
    setFixtureStockVisible: options.setFixtureStockVisible,
    setFixtureCollidersActive: options.setFixtureCollidersActive,
    fixtureColliderDiagnostics: options.fixtureColliderDiagnostics,
  });
  return { mode, fixture, state, anchor, toasts };
}

test('build mode refuses to lift a fixture while a persisted carton occupies it', () => {
  const { mode, fixture, toasts } = modeHarness((id) => (
    id === fixture.id ? { reason: 'Move the carton off the apparel table first.' } : null
  ));

  mode.enter();
  assert.equal(mode.interact(), true);
  assert.equal(mode.isCarrying(), null);
  assert.match(toasts.at(-1)[0], /move the carton/i);
  assert.equal(toasts.at(-1)[1], 'warn');
});

test('build mode rechecks occupancy before stowing a carried fixture', () => {
  let blocked = false;
  const { mode, fixture, toasts } = modeHarness((id) => (
    blocked && id === fixture.id ? 'Remove the saved carton first.' : null
  ));

  mode.enter();
  assert.equal(mode.interact(), true, 'fixture pickup succeeds while clear');
  assert.equal(mode.isCarrying(), fixture.id);

  blocked = true;
  assert.equal(mode.stow(), true, 'the handled key is consumed');
  assert.equal(mode.isCarrying(), fixture.id, 'fixture remains in the player\'s hands');
  assert.match(toasts.at(-1)[0], /remove the saved carton/i);
});

test('build mode hides separate fixture stock while carrying and restores it on cancel', () => {
  const visibility = [];
  const { mode, fixture, anchor } = modeHarness(undefined, {
    setFixtureStockVisible: (...args) => visibility.push(args),
  });

  mode.enter();
  assert.equal(mode.interact(), true);
  assert.equal(mode.isCarrying(), fixture.id);
  assert.equal(anchor.visible, false, 'the fixture geometry is hidden while its ghost is carried');
  assert.deepEqual(visibility, [[fixture.id, false]], 'separately-rendered stock is hidden with it');

  assert.equal(mode.cancel(), true);
  assert.equal(anchor.visible, true);
  assert.deepEqual(visibility, [[fixture.id, false], [fixture.id, true]], 'cancel restores its stock');
});

test('build-mode ghost exactly matches an asymmetric custom footprint through rotation', () => {
  const fixture = {
    ...FIXTURES.find((entry) => entry.id === 'shoerack'),
    footprint: { minX: -1.23, maxX: 1.23, minZ: -0.18, maxZ: 1.18 },
  };
  const candidate = { ...fixture, x: 1.75, z: -2.25, ry: Math.PI / 2 };
  const profile = fixtureGhostProfile(candidate);
  assert.ok(Math.abs(profile.width - 2.46) < 1e-9);
  assert.ok(Math.abs(profile.depth - 1.36) < 1e-9);
  assert.ok(Math.abs(profile.offsetX) < 1e-9);
  assert.ok(Math.abs(profile.offsetZ - 0.5) < 1e-9);

  const c = Math.cos(candidate.ry);
  const s = Math.sin(candidate.ry);
  const halfW = profile.width / 2;
  const halfD = profile.depth / 2;
  const ghostCorners = [
    [-halfW, -halfD], [-halfW, halfD], [halfW, -halfD], [halfW, halfD],
  ].map(([dx, dz]) => {
    const lx = profile.offsetX + dx;
    const lz = profile.offsetZ + dz;
    return {
      x: candidate.x + lx * c + lz * s,
      z: candidate.z - lx * s + lz * c,
    };
  });
  const ghostRect = {
    minX: Math.min(...ghostCorners.map((point) => point.x)),
    maxX: Math.max(...ghostCorners.map((point) => point.x)),
    minZ: Math.min(...ghostCorners.map((point) => point.z)),
    maxZ: Math.max(...ghostCorners.map((point) => point.z)),
  };
  const expected = fixtureRect(candidate);
  for (const key of ['minX', 'maxX', 'minZ', 'maxZ']) {
    assert.ok(Math.abs(ghostRect[key] - expected[key]) < 1e-9, `${key} matches fixtureRect`);
  }
});

test('carrying unregisters a fixture collider and cancel restores it exactly once', () => {
  const collisions = [];
  const { mode, fixture } = modeHarness(undefined, {
    setFixtureCollidersActive: (...args) => collisions.push(args),
  });

  mode.enter();
  assert.equal(mode.interact(), true);
  assert.deepEqual(collisions, [[fixture.id, false]], 'pickup removes the live collision footprint');
  assert.equal(mode.cancel(), true);
  assert.deepEqual(collisions, [
    [fixture.id, false],
    [fixture.id, true],
  ], 'cancel restores the original fixture collider');
});

test('a legal commit rebuilds the fixture collider without leaving a carried blocker', () => {
  const collisions = [];
  let rebuilds = 0;
  const { mode, fixture } = modeHarness(undefined, {
    setFixtureCollidersActive: (...args) => collisions.push(args),
    rebuildLayout: () => { rebuilds++; },
  });
  // Replace the no-op through the callback surface exercised by build mode.
  // The real relay atomically replaces every fixture collider before the final
  // `true` call, while this harness records the lifecycle contract.
  mode.enter();
  assert.equal(mode.interact(), true);
  assert.equal(mode.interact(), true, 'the unchanged authored placement is legal');
  assert.equal(mode.isCarrying(), null);
  assert.equal(rebuilds, 1);
  assert.deepEqual(collisions, [
    [fixture.id, false],
    [fixture.id, true],
  ]);
});

test('stowing an empty carried fixture leaves no collider registered on the floor', () => {
  const collisions = [];
  const { mode, fixture, state } = modeHarness(undefined, {
    fixtureId: 'feature',
    setFixtureCollidersActive: (...args) => collisions.push(args),
  });
  for (const skuId of fixture.skus) state.shop.inventory[skuId].shelf = 0;

  mode.enter();
  assert.equal(mode.interact(), true);
  assert.equal(mode.stow(), true);
  assert.equal(mode.isCarrying(), null);
  assert.ok(state.shop.layout.stored.includes(fixture.id));
  assert.deepEqual(collisions, [
    [fixture.id, false],
    [fixture.id, true],
  ], 'the post-rebuild activation hook is safe when the stored fixture has no new colliders');
});

test('fixture collider registration toggles are idempotent and fixture-scoped', () => {
  const shoeA = { fixtureLayoutId: 'shoerack', fixtureColliderActive: true };
  const shoeB = { fixtureLayoutId: 'shoerack', fixtureColliderActive: true };
  const hat = { fixtureLayoutId: 'hatstand', fixtureColliderActive: true };
  const colliders = [shoeA, shoeB, hat];
  const added = [];
  const removed = [];
  const add = (collider) => added.push(collider);
  const remove = (collider) => removed.push(collider);

  assert.equal(setTrackedFixtureCollidersActive(colliders, 'shoerack', false, add, remove), 2);
  assert.deepEqual(removed, [shoeA, shoeB]);
  assert.equal(hat.fixtureColliderActive, true, 'unrelated fixtures remain collidable');
  assert.equal(setTrackedFixtureCollidersActive(colliders, 'shoerack', false, add, remove), 0);
  assert.equal(setTrackedFixtureCollidersActive(colliders, 'shoerack', true, add, remove), 2);
  assert.deepEqual(added, [shoeA, shoeB]);
  assert.equal(setTrackedFixtureCollidersActive(colliders, 'shoerack', true, add, remove), 0);
});

test('public build diagnostics prove asymmetric ghost pose, validation, and disabled carried collider', () => {
  let colliderActive = true;
  const { mode, fixture } = modeHarness(undefined, {
    fixtureId: 'shoerack',
    setFixtureCollidersActive: (id, active) => {
      assert.equal(id, fixture.id);
      colliderActive = active;
    },
    fixtureColliderDiagnostics: (id) => ({
      fixtureId: id,
      total: 1,
      activeCount: colliderActive ? 1 : 0,
      inactiveCount: colliderActive ? 0 : 1,
      active: colliderActive,
    }),
  });

  mode.enter();
  assert.equal(mode.interact(), true);
  mode.update();
  const diagnostics = mode.diagnostics();
  assert.equal(diagnostics.active, true);
  assert.equal(diagnostics.carrying, fixture.id);
  assert.equal(diagnostics.ghost.visible, true);
  assert.deepEqual(
    diagnostics.ghost.position,
    { x: 5.25, y: 0, z: -0.25 },
    'diagnostics expose the same quarter-yard snapped local pose the ghost renders',
  );
  assert.equal(diagnostics.ghost.rotationY, fixture.ry);
  assert.ok(Math.abs(diagnostics.ghost.profile.width - 2.6) < 1e-9);
  assert.ok(Math.abs(diagnostics.ghost.profile.depth - 0.8) < 1e-9);
  assert.ok(Math.abs(diagnostics.ghost.profile.offsetZ) < 1e-9);
  assert.equal(diagnostics.validation.ok, true);
  assert.deepEqual(diagnostics.validation.reasons, []);
  assert.equal(diagnostics.colliderActive, false);
  assert.deepEqual(diagnostics.colliders, {
    fixtureId: fixture.id,
    total: 1,
    activeCount: 0,
    inactiveCount: 1,
    active: false,
  });

  assert.equal(mode.cancel(), true);
  const cancelled = mode.diagnostics();
  assert.equal(cancelled.carrying, null);
  assert.equal(cancelled.ghost.visible, false);
  assert.equal(cancelled.colliderActive, null);
});

test('stocked fixtures can be lifted and moved but cannot be stored in the back', () => {
  const visibility = [];
  const { mode, fixture, state, toasts } = modeHarness(undefined, {
    fixtureId: 'rack_irons',
    setFixtureStockVisible: (...args) => visibility.push(args),
  });
  const stockedSku = fixture.skus.at(-1);
  state.shop.inventory[stockedSku].shelf = 3;

  mode.enter();
  assert.equal(mode.interact(), true, 'stock does not prevent moving the fixture');
  assert.equal(mode.isCarrying(), fixture.id);
  assert.deepEqual(visibility, [[fixture.id, false]]);

  assert.equal(mode.stow(), true, 'the stow key is handled');
  assert.equal(mode.isCarrying(), fixture.id, 'the stocked fixture stays in the player\'s hands');
  assert.equal(state.shop.layout.stored.includes(fixture.id), false, 'save state is not mutated');
  assert.match(toasts.at(-1)[0], /empty this fixture.*3 shelf items.*on display/i);
  assert.equal(toasts.at(-1)[1], 'warn');

  assert.equal(mode.cancel(), true);
  assert.deepEqual(visibility, [[fixture.id, false], [fixture.id, true]]);
});

test('a customer-held unit prevents stowing its now-empty home fixture', () => {
  const { mode, fixture, state, toasts } = modeHarness(undefined, {
    fixtureId: 'shelf_acc',
  });
  for (const skuId of fixture.skus) state.shop.inventory[skuId].shelf = 0;
  state.shop.held = [{ uid: 'qa-rangefinder-1', skuId: 'range2' }];

  mode.enter();
  assert.equal(mode.interact(), true);
  assert.equal(mode.isCarrying(), fixture.id);
  assert.equal(mode.stow(), true);
  assert.equal(mode.isCarrying(), fixture.id, 'held recovery cannot orphan inventory on a stored fixture');
  assert.equal(state.shop.layout.stored.includes(fixture.id), false);
  assert.match(toasts.at(-1)[0], /held item.*sold or returned/i);
  assert.equal(toasts.at(-1)[1], 'warn');
});
