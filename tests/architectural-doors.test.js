import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  ARCHITECTURAL_DOOR_TIERS,
  METERS_TO_YARDS,
  architecturalDoorPath,
  architecturalDoorScaleForOpening,
  architecturalDoorTierForQuality,
  validateArchitecturalDoorMount,
} from '../src/data/architecturalDoors.js';
import {
  architecturalDoorMountPlan,
  createClubhouseArchitecturalDoorInstallation,
} from '../src/render3d/clubhouse/architecturalDoorInstallation.js';
import {
  batchArchitecturalDoorMeshes,
  lodLevelForDistance,
} from '../src/render3d/clubhouse/architecturalDoorVisuals.js';

test('architectural door catalog exposes five progressive runtime tiers', () => {
  assert.deepEqual(Object.keys(ARCHITECTURAL_DOOR_TIERS), [
    'basic', 'standard', 'premium', 'high-end', 'luxury',
  ]);
  assert.equal(ARCHITECTURAL_DOOR_TIERS.luxury.leafCount, 2);
  assert.equal(ARCHITECTURAL_DOOR_TIERS['high-end'].arched, true);
  assert.equal(architecturalDoorPath('high-end'), 'vendor/models/architecture/doors/door_high_end.glb');
  assert.equal(architecturalDoorTierForQuality('municipal'), 'basic');
  assert.equal(architecturalDoorTierForQuality('luxury'), 'premium');
});

test('fixed clubhouse openings produce valid, bounded architectural mount plans', () => {
  const main = architecturalDoorMountPlan('luxury', 1.8 * METERS_TO_YARDS, 2.45 * METERS_TO_YARDS);
  assert.equal(main.ok, true);
  assert.ok(Math.abs(main.fitScale - (1.8 / 1.874)) < 1e-12);
  const highEndService = architecturalDoorMountPlan('high-end', 1.3, 2.5);
  assert.equal(highEndService.ok, true);
  assert.ok(highEndService.fitScale >= 0.9 && highEndService.fitScale < 1);
  assert.equal(
    architecturalDoorScaleForOpening('high-end', 0.4, 0.4, { allowDownscale: true }),
    null,
  );
});

test('placement validation rejects bad orientation, floor, wall, opening and clearance', () => {
  const invalid = validateArchitecturalDoorMount({
    tier: 'high-end',
    openingWidthM: 0.7,
    openingHeightM: 2,
    wallDepthM: 0.1,
    floorOffsetM: 0.03,
    upsideDown: true,
    cornerClearanceM: 0.01,
    swingClearanceM: 0.3,
    ceilingHeightM: 2.1,
  });
  assert.equal(invalid.ok, false);
  assert.deepEqual(new Set(invalid.errors), new Set([
    'upside-down',
    'floor-misaligned',
    'opening-too-narrow',
    'opening-too-short',
    'unsupported-wall-depth',
    'too-close-to-corner',
    'swing-blocked',
    'ceiling-too-low',
  ]));
});

test('all five tiers validate their supported thin and thick wall installations', () => {
  for (const [tier, spec] of Object.entries(ARCHITECTURAL_DOOR_TIERS)) {
    for (const wallDepthM of [spec.wallDepthMinM, spec.wallDepthMaxM]) {
      const result = validateArchitecturalDoorMount({
        tier,
        openingWidthM: spec.openingWidthM,
        openingHeightM: spec.openingHeightM,
        wallDepthM,
        floorOffsetM: 0,
        cornerClearanceM: Infinity,
        swingClearanceM: spec.leafWidthM,
        ceilingHeightM: spec.openingHeightM,
      });
      assert.equal(result.ok, true, `${tier} should fit a ${wallDepthM} m wall`);
      assert.deepEqual(result.errors, []);
    }
  }
});

test('door LOD selection uses the authored 0, 8 and 18 metre thresholds', () => {
  assert.equal(lodLevelForDistance(0), 0);
  assert.equal(lodLevelForDistance(7.99), 0);
  assert.equal(lodLevelForDistance(8), 1);
  assert.equal(lodLevelForDistance(17.99), 1);
  assert.equal(lodLevelForDistance(18), 2);
});

test('runtime batching merges only meshes sharing one LOD articulation root and material', () => {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.name = 'PIVOT_Door';
  const lod0 = new THREE.Group();
  lod0.name = 'LOD0_DoorLeaf_Single';
  lod0.userData.lod_level = 0;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  for (let index = 0; index < 3; index += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.3), material);
    mesh.position.x = index * 0.25;
    lod0.add(mesh);
  }
  pivot.add(lod0);
  root.add(pivot);
  const summary = batchArchitecturalDoorMeshes(root);
  assert.equal(summary.sourceMeshes, 3);
  assert.equal(summary.batchedMeshes, 1);
  assert.equal(summary.reducedBy, 2);
  assert.equal(lod0.children.filter((child) => child.isMesh).length, 1);
  assert.equal(root.getObjectByName('PIVOT_Door'), pivot, 'articulation pivot remains intact');
  lod0.children[0].geometry.dispose();
  material.dispose();
});

test('runtime batching keeps hero shadows and removes distant LOD shadow passes', () => {
  const root = new THREE.Group();
  const lod0 = new THREE.Group();
  const lod1 = new THREE.Group();
  lod0.name = 'LOD0_Frame';
  lod1.name = 'LOD1_Frame';
  lod0.userData.lod_level = 0;
  lod1.userData.lod_level = 1;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const hero = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), material);
  const distant = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), material);
  hero.castShadow = true;
  distant.castShadow = true;
  lod0.add(hero);
  lod1.add(distant);
  root.add(lod0, lod1);

  batchArchitecturalDoorMeshes(root);

  assert.equal(hero.castShadow, true);
  assert.equal(distant.castShadow, false);
  hero.geometry.dispose();
  distant.geometry.dispose();
  material.dispose();
});

function fakeDoorVisualRuntime() {
  const holders = [];
  return {
    holders,
    instantiate(tier, options) {
      const holder = new THREE.Group();
      holder.name = options.name;
      holder.position.copy(options.position);
      holder.rotation.y = options.rotationY;
      holder.scale.setScalar(options.scale);
      holder.visible = options.visible;
      holder.userData.architecturalDoorTier = tier;
      holder.userData.loaded = true;
      holder.userData.rig = { lodLevel: 0 };
      holder.userData.controller = {
        setLod(level) { holder.userData.rig.lodLevel = level; },
        update(_dt, distanceM) { holder.userData.rig.lodLevel = lodLevelForDistance(distanceM); },
      };
      options.parent?.add(holder);
      holders.push(holder);
      holder.userData.ready = Promise.resolve(holder);
      return holder;
    },
    diagnostics() {
      return {
        failedCount: 0,
        instanceCount: holders.length,
        loadedCount: holders.length,
      };
    },
    ownedResources() {
      return { geometries: new Set(), materials: new Set(), textures: new Set() };
    },
    dispose() { return { instances: holders.length }; },
  };
}

test('clubhouse installation binds Luxury main, live service tier changes, and exact stress mix', async () => {
  const group = new THREE.Group();
  const receivingSign = new THREE.Group();
  receivingSign.name = 'DeliveryReceivingExteriorSign';
  receivingSign.position.y = 3.22;
  group.add(receivingSign);
  const state = { shop: { reno: {} } };
  const binds = [];
  const doorApi = {
    bindArchitecturalMainEntranceVisual(root, options) {
      binds.push({ which: 'main', root, ...options });
      return { ok: true };
    },
    bindArchitecturalServiceDoorVisual(which, root, options) {
      binds.push({ which, root, ...options });
      return { ok: true };
    },
    unbindArchitecturalServiceDoorVisual() { return { ok: true }; },
    mainEntranceDiagnostics() { return { authoredBound: true }; },
    serviceDoorDiagnostics() {
      return { stockroom: { authoredBound: true }, receiving: { authoredBound: true } };
    },
  };
  const visualRuntime = fakeDoorVisualRuntime();
  const installation = createClubhouseArchitecturalDoorInstallation({
    group,
    state,
    doorApi,
    floorTop: 0.3,
    halfWidth: 11.35,
    halfDepth: 7.13,
    camera: { position: new THREE.Vector3() },
    visualRuntime,
  });
  await installation.ready;

  assert.deepEqual(binds.slice(0, 3).map(({ which, tier }) => [which, tier]), [
    ['main', 'luxury'], ['stockroom', 'basic'], ['receiving', 'basic'],
  ]);
  assert.equal(binds.find(({ which }) => which === 'receiving').root.rotation.y, Math.PI / 2);
  assert.equal(installation.diagnostics().ready, true);
  assert.equal(receivingSign.position.y, 3.22);

  state.shop.reno.constructionFinishes.installed.doors.qualityId = 'high-end';
  const sync = await installation.syncServiceDoors();
  assert.deepEqual(sync, { changed: true, tier: 'high-end' });
  assert.deepEqual(binds.slice(-2).map(({ which, tier }) => [which, tier]), [
    ['stockroom', 'high-end'], ['receiving', 'high-end'],
  ]);
  assert.ok(Math.abs(receivingSign.position.y - 3.46) < 1e-12);
  assert.deepEqual(installation.diagnostics().receivingSign, { found: true, offsetY: 0.24 });

  state.shop.reno.constructionFinishes.installed.doors.qualityId = 'standard';
  await installation.syncServiceDoors();
  assert.equal(receivingSign.position.y, 3.22, 'non-arched tiers restore the authored sign datum');

  await installation.createStressSet({ visible: false });
  const stress = installation.diagnostics().stress;
  assert.equal(stress.requestedCount, 53);
  assert.equal(stress.loadedCount, 53);
  assert.deepEqual(stress.tiers, {
    basic: 15, standard: 15, premium: 10, 'high-end': 8, luxury: 5,
  });
  installation.forceStressLod(2);
  installation.setStressVisible(true);
  installation.update(1 / 60);
  assert.deepEqual(installation.diagnostics().stress.lods, { 2: 53 });
  assert.equal(installation.dispose().alreadyDisposed, false);
});
