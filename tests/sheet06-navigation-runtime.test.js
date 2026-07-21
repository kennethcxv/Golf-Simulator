import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import {
  SHEET06_ASSET54_NAVIGATION_METRICS,
  createSheet06Asset54FrontRailColliders,
  createSheet06NavigationContract,
  resolveSheet06GroundY,
} from '../src/render3d/assets51to100/sheet06Navigation.js';
import { SHEET06_AUTHORED_FRONT_Z_YARDS } from '../src/render3d/assets51to100/sheet06ClubhouseAdapter.js';
import {
  createSheet06ProductionLayout,
  createSheet06ProductionRuntime,
} from '../src/render3d/assets51to100/sheet06ProductionRuntime.js';
import { METERS_TO_YARDS } from '../src/render3d/assets51to100/units.js';
import { LOUNGE } from '../src/data/shopLayout.js';

const SUPPRESSIONS = Object.freeze({
  51: Object.freeze([
    'MESH_MainDoor_CreamCasing',
    'MESH_WindowMid_CreamCasing',
    'MESH_WindowWest_CreamCasing',
  ]),
  52: Object.freeze([
    'MESH_AlignedFrontWeatherSkin',
    'MESH_AlignedBackWeatherSkin',
    'MESH_AlignedEastWeatherSkin',
    'MESH_AlignedWestWeatherSkin',
    'MESH_FoundationDampBandFront',
    'MESH_FoundationDampBandBack',
  ]),
});

const FALLBACK_KEYS = Object.freeze([
  'exteriorShellStructure', 'porchVisuals', 'windowVisuals', 'apertureTrim',
  'wainscotPanels', 'interiorTrim', 'ceilingVisuals', 'renovatedFloor',
]);

function close(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`);
}

function effectiveGroundAt({ z, floorY, terrainY }) {
  const legacy = z >= 6.5 && z <= 10.35 ? floorY : null;
  return resolveSheet06GroundY({
    worldX: -0.8,
    worldZ: z,
    centerX: 0,
    centerZ: 0,
    floorY,
    terrainY,
    legacyGroundY: legacy,
  }) ?? terrainY;
}

test('Asset 54 analytic blockers match both visible front rail spans exactly', () => {
  const frame = { centerX: 120, centerZ: -35, floorY: 4.2 };
  const colliders = createSheet06Asset54FrontRailColliders(frame);
  assert.equal(colliders.length, 2);
  assert.deepEqual(colliders.map(({ id }) => id), [
    'sheet06-asset54-front-rail-west',
    'sheet06-asset54-front-rail-east',
  ]);
  assert.ok(colliders.every((collider) => (
    collider.assetNumber === 54
    && collider.collisionAuthority === 'ANALYTIC_LAYOUT'
    && collider.glbCollision === false
  )));

  const [west, east] = colliders;
  close(west.minX, frame.centerX - 1 - 5.30 * METERS_TO_YARDS);
  close(west.maxX, frame.centerX - 1 - 2.82 * METERS_TO_YARDS);
  close(east.minX, frame.centerX - 1 + 2.82 * METERS_TO_YARDS);
  close(east.maxX, frame.centerX - 1 + 5.30 * METERS_TO_YARDS);
  for (const collider of colliders) {
    close(collider.maxX - collider.minX, 2.48 * METERS_TO_YARDS);
    close(collider.maxZ - collider.minZ, 0.11 * METERS_TO_YARDS);
    close(
      (collider.minZ + collider.maxZ) / 2,
      frame.centerZ + SHEET06_AUTHORED_FRONT_Z_YARDS + 1.42 * METERS_TO_YARDS,
    );
    assert.ok(collider.minY > frame.floorY);
    assert.ok(collider.maxY > collider.minY);
  }
  close(east.minX - west.maxX, 5.64 * METERS_TO_YARDS,
    1e-9, 'central authored stair opening stays clear');
  assert.equal(SHEET06_ASSET54_NAVIGATION_METRICS.activateGlbCollision, false);
  assert.equal(SHEET06_ASSET54_NAVIGATION_METRICS.glbNavigationAuthority, 'NONE');
});

test('Asset 54 ramp replaces the abrupt porch step with <= 0.18 yd adjacent height changes', () => {
  const floorY = -1.9873497009277343;
  const samples = [];
  const legacySamples = [];
  for (let z = 10.55; z >= 8.20; z -= 0.17) {
    const terrainY = -2.533 + (10.55 - z) * 0.047;
    samples.push(effectiveGroundAt({ z, floorY, terrainY }));
    legacySamples.push((z >= 6.5 && z <= 10.35) ? floorY : terrainY);
  }
  const maxStep = (values) => Math.max(...values.slice(1).map((value, index) => (
    Math.abs(value - values[index])
  )));
  assert.ok(maxStep(legacySamples) > 0.5, 'fixture reproduces the rejected abrupt porch transition');
  assert.ok(maxStep(samples) <= 0.18, `smooth transition max adjacent step was ${maxStep(samples)}`);
  assert.ok(samples.every(Number.isFinite));

  const innerZ = SHEET06_AUTHORED_FRONT_Z_YARDS + 1.50 * METERS_TO_YARDS;
  close(effectiveGroundAt({ z: innerZ, floorY, terrainY: -2.4 }), floorY);
  const outerZ = SHEET06_AUTHORED_FRONT_Z_YARDS + 3.29 * METERS_TO_YARDS;
  close(effectiveGroundAt({ z: outerZ, floorY, terrainY: -2.52 }), -2.52);
  assert.equal(resolveSheet06GroundY({
    worldX: 8,
    worldZ: 9,
    floorY,
    terrainY: -2.4,
    legacyGroundY: floorY,
  }), floorY, 'outside the authored stair width, legacy porch authority is preserved');
});

test('navigation contract registers two blockers idempotently and removes exact identities', () => {
  const shared = [];
  const removed = [];
  const navigation = createSheet06NavigationContract({
    centerX: -360,
    centerZ: 4,
    floorY: -1.9873497009277343,
    terrainHeightAt: (_x, z) => -2.5 + z * 0.001,
    addCollider(collider) { shared.push(collider); return collider; },
    removeCollider(collider) {
      removed.push(collider);
      const index = shared.indexOf(collider);
      if (index >= 0) shared.splice(index, 1);
    },
  });
  assert.equal(navigation.diagnostics().active, false);
  assert.equal(navigation.diagnostics().glbCollisionObjectsActivated, 0);
  assert.equal(navigation.activate().railColliderCount, 2);
  assert.equal(shared.length, 2);
  assert.equal(navigation.activate().railColliderCount, 2);
  assert.equal(shared.length, 2, 'repeat activation cannot duplicate shared collision entries');
  assert.equal(navigation.deactivate().railColliderCount, 0);
  assert.equal(shared.length, 0);
  assert.deepEqual(removed, [...navigation.descriptors].reverse(),
    'teardown removes the same registered identities in reverse order');
  assert.equal(navigation.deactivate().railColliderCount, 0);
  assert.equal(removed.length, 2);
});

test('lounge damage remains visible with a player-width route through the live furniture layout', () => {
  const site = createSheet06ProductionLayout().damageSites
    .find(({ id }) => id === 'damage-lounge');
  assert.deepEqual(site, { id: 'damage-lounge', x: 2.25, z: -3.45, rotationY: Math.PI });
  const playerRadius = 0.34;
  const furniture = [
    { id: 'sofa', ...LOUNGE.chairA, w: 2.4, d: 1.15 },
    { id: 'armchair', ...LOUNGE.chairB, w: 1.05, d: 1.05 },
    { id: 'coffee-table', ...LOUNGE.coffee, w: 1.1, d: 1.1 },
    { id: 'trophy-cabinet', ...LOUNGE.trophy, w: 0.58, d: 1.82 },
  ];
  const route = { x: site.x, minZ: site.z - 0.82, maxZ: site.z + 1.02 };
  for (const blocker of furniture) {
    const overlapsInflatedAabb = Math.abs(site.x - blocker.x) < blocker.w / 2 + playerRadius
      && Math.abs(site.z - blocker.z) < blocker.d / 2 + playerRadius;
    assert.equal(overlapsInflatedAabb, false, `${site.id} clears ${blocker.id} plus player radius`);
    const minX = blocker.x - blocker.w / 2 - playerRadius;
    const maxX = blocker.x + blocker.w / 2 + playerRadius;
    const minZ = blocker.z - blocker.d / 2 - playerRadius;
    const maxZ = blocker.z + blocker.d / 2 + playerRadius;
    const blocksRoute = route.x > minX && route.x < maxX
      && route.maxZ > minZ && route.minZ < maxZ;
    assert.equal(blocksRoute, false, `player-width route clears ${blocker.id}`);
  }
  assert.ok(site.z >= -4.0 && site.z <= -3.2, 'site remains in the authored lounge-approach aisle');
});

function rootFor(number) {
  const root = new THREE.Group();
  for (const name of SUPPRESSIONS[number] || []) {
    const child = new THREE.Group();
    child.name = name;
    root.add(child);
  }
  if (number === 53) {
    for (const name of ['PIVOT_DoorLeft', 'PIVOT_DoorRight']) {
      const child = new THREE.Group();
      child.name = name;
      root.add(child);
    }
  }
  if (number === 52) {
    for (const name of ['MESH_BoardedApertureDamage', 'MESH_BoardedApertureFasteners']) {
      const child = new THREE.Group();
      child.name = name;
      root.add(child);
    }
  }
  return root;
}

function navigationRuntimeFixture() {
  const roots = new Map(Array.from({ length: 10 }, (_, index) => [51 + index, rootFor(51 + index)]));
  const fallbacks = Object.fromEntries(FALLBACK_KEYS.map((key) => [key, {
    visible: true,
    getVisible() { return this.visible; },
    setVisible(value) { this.visible = Boolean(value); },
  }]));
  const adapterFactory = ({ group, interior }) => {
    for (const [number, root] of roots) (number <= 55 ? group : interior).add(root);
    return {
      ready: Promise.resolve(),
      getRoot: (number) => roots.get(number),
      diagnostics: () => ({}),
      borrowedResources: () => ({}),
      update: () => 0,
      applyState: async () => ({}),
      dispose: () => ({}),
    };
  };
  const assemblyFactory = () => ({
    diagnostics: () => ({
      glbCollisionObjectsActivated: 0,
      kits: Array.from({ length: 6 }, (_, index) => ({ assetNumber: 55 + index, status: 'assembled' })),
    }),
    getRoot: () => null,
    update: () => 0,
    applyState: async () => ({}),
    dispose: () => ({}),
  });
  const doorApi = {
    bindMainEntranceVisual: () => ({ ok: true }),
    unbindMainEntranceVisual: () => ({ wasBound: true }),
    syncMainEntranceFromState: () => ({ ok: true }),
    mainEntranceDiagnostics: () => ({}),
  };
  return { adapterFactory, assemblyFactory, doorApi, fallbacks };
}

test('production runtime activates and tears down analytic navigation with its visual transaction', async () => {
  const group = new THREE.Group();
  const interior = new THREE.Group();
  const fixture = navigationRuntimeFixture();
  const calls = [];
  let navActive = false;
  const navigationApi = {
    activate() {
      calls.push('activate');
      navActive = true;
      return { active: true, railColliderCount: 2, glbCollisionObjectsActivated: 0 };
    },
    deactivate() { calls.push('deactivate'); navActive = false; },
    diagnostics: () => ({ active: navActive, railColliderCount: navActive ? 2 : 0 }),
  };
  const runtime = createSheet06ProductionRuntime({
    group,
    interior,
    state: {},
    shellFallbacks: fixture.fallbacks,
    doorApi: fixture.doorApi,
    navigationApi,
    adapterFactory: fixture.adapterFactory,
    assemblyFactory: fixture.assemblyFactory,
  });
  const activated = await runtime.ready;
  assert.equal(activated.actualSharedGameIntegrated, true);
  assert.deepEqual(calls, ['activate']);
  assert.deepEqual(activated.navigation, { active: true, railColliderCount: 2 });
  runtime.dispose();
  assert.deepEqual(calls, ['activate', 'deactivate']);
  assert.equal(runtime.diagnostics().navigation.active, false);
});
