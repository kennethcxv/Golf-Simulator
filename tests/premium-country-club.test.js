import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as THREE from 'three';

import {
  PREMIUM_COUNTRY_CLUB_AREA_SQUARE_FEET,
  PREMIUM_COUNTRY_CLUB_DEPTH_METERS,
  PREMIUM_COUNTRY_CLUB_WIDTH_METERS,
  batchPremiumCountryClubStaticGeometry,
  createPremiumCountryClub,
} from '../src/render3d/clubhouse/premiumCountryClub.js';

function testScene() {
  const scene = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ name: 'MAT_PC_Warm_Limestone' });
  for (const x of [-2, 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.25), material);
    wall.position.x = x;
    scene.add(wall);
  }
  const collision = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  collision.name = 'COL_PremiumTest';
  scene.add(collision);
  const entrance = new THREE.Group();
  entrance.name = 'Front_Ground_Center_MemberEntrance';
  for (const side of ['Left', 'Right']) {
    const pivot = new THREE.Group();
    pivot.name = `PIVOT_MOD_MEMBER_Door_${side}Leaf_Hinge`;
    pivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.4, 0.12), material));
    entrance.add(pivot);
  }
  scene.add(entrance);
  const lightingGroups = [
    ['Front_Facade_Sconce_Test', 4],
    ['Rear_Facade_Sconce_Test', 3],
    ['Arrival_PremiumFountain', 4],
    ['Parking_West_Light_Test', 3],
    ['ARCH_EmptyInterior', 4],
  ];
  for (const [name, count] of lightingGroups) {
    const group = new THREE.Group();
    group.name = name;
    for (let index = 0; index < count; index += 1) {
      const socket = new THREE.Group();
      socket.name = name.includes('PremiumFountain')
        ? `SOCKET_UnderwaterLight_${String(index).padStart(2, '0')}`
        : `SOCKET_Light_${String(index).padStart(2, '0')}`;
      group.add(socket);
    }
    scene.add(group);
  }
  return scene;
}

test('premium static batching preserves all pivot descendants and hides collision proxies', () => {
  const scene = testScene();
  const result = batchPremiumCountryClubStaticGeometry(scene);
  assert.equal(result.sourceDrawCalls, 2);
  assert.equal(result.batchedDrawCalls, 1);
  assert.equal(result.drawCallsSaved, 1);
  assert.equal(result.hiddenCollisionCount, 1);
  assert.equal(scene.getObjectByName('COL_PremiumTest').visible, false);
  assert.equal(scene.getObjectByName('PIVOT_MOD_MEMBER_Door_LeftLeaf_Hinge').children[0].visible, true);
  assert.ok(scene.getObjectByName('RUNTIME_PremiumCountryClubStaticBatches'));
});

test('premium private presentation is tier-gated, capped, collidable, and mirrors member doors', async () => {
  const mount = new THREE.Group();
  const competing = new THREE.Group();
  const sheetRoots = new Map([51, 52, 53, 54, 55, 58].map((number) => [number, new THREE.Group()]));
  const fallbacks = Object.fromEntries([
    'exteriorShellStructure', 'apertureTrim', 'porchVisuals', 'windowVisuals', 'ceilingVisuals',
  ].map((key) => [key, { visible: true, setVisible(value) { this.visible = value; } }]));
  const doors = [
    { mainLeaf: 'left', angle: 0.42 },
    { mainLeaf: 'right', angle: -0.31 },
  ];
  const activeColliders = [];
  const addCollider = (collider) => { activeColliders.push(collider); return collider; };
  const removeCollider = (collider) => activeColliders.splice(activeColliders.indexOf(collider), 1);
  const colBoxAt = (x, z, width, depth) => ({
    minX: x - width / 2, maxX: x + width / 2,
    minZ: z - depth / 2, maxZ: z + depth / 2,
  });
  const loader = { load(_url, onLoad) { onLoad({ scene: testScene() }); } };
  const premium = createPremiumCountryClub({
    group: mount,
    shellFallbacks: fallbacks,
    sheet06Production: {
      ready: Promise.resolve(),
      getRoot: (number) => sheetRoots.get(number),
    },
    doors,
    floorTop: 0.3,
    facadeDoorZ: 7,
    entranceCenterX: -0.4,
    competingRoots: [competing],
    addCollider,
    removeCollider,
    colBoxAt,
    loader,
  });
  assert.equal((await premium.ready).ok, true);
  premium.update();
  const root = premium.root();
  assert.equal(root.getObjectByName('PIVOT_MOD_MEMBER_Door_LeftLeaf_Hinge').rotation.y, 0.42);
  assert.equal(root.getObjectByName('PIVOT_MOD_MEMBER_Door_RightLeaf_Hinge').rotation.y, -0.31);
  assert.equal(competing.visible, false);
  assert.deepEqual([...sheetRoots.values()].map((entry) => entry.visible), Array(6).fill(false));
  assert.deepEqual(Object.values(fallbacks).map((entry) => entry.visible), Array(5).fill(false));
  assert.equal(premium.diagnostics().conditionedAreaSquareFeet, PREMIUM_COUNTRY_CLUB_AREA_SQUARE_FEET);
  assert.equal(premium.diagnostics().runtimeLightCount, 12);
  assert.equal(premium.setTimeMood(14 * 60), 0.08);
  assert.equal(premium.diagnostics().runtimeLightFactor, 0.08);
  assert.equal(premium.setTimeMood(21 * 60), 1);
  assert.equal(premium.diagnostics().runtimeLightFactor, 1);
  assert.ok(premium.diagnostics().colliderCount >= 10);
  assert.equal(activeColliders.length, premium.diagnostics().colliderCount);
  premium.dispose();
  assert.equal(activeColliders.length, 0);
  assert.equal(competing.visible, true);
});

test('premium source, modular kit, export, and validation manifest are reproducible', () => {
  const root = process.cwd();
  const source = path.join(root, 'asset_sources/blender/premium_clubhouse/premium_clubhouse_architecture.blend');
  const canonical = path.join(root, 'Assets/premium_clubhouse/glb/premium_clubhouse_architecture.glb');
  const runtime = path.join(root, 'vendor/models/premium_clubhouse/premium_clubhouse_architecture.glb');
  const kit = path.join(root, 'Assets/premium_clubhouse/glb/premium_clubhouse_modular_kit.glb');
  const runtimeKit = path.join(root, 'vendor/models/premium_clubhouse/premium_clubhouse_modular_kit.glb');
  const manifestPath = path.join(root, 'Assets/premium_clubhouse/glb/premium_clubhouse_manifest.json');
  for (const file of [source, canonical, runtime, kit, runtimeKit, manifestPath]) {
    assert.ok(fs.statSync(file).size > 0, file);
  }
  assert.deepEqual(fs.readFileSync(canonical), fs.readFileSync(runtime));
  assert.deepEqual(fs.readFileSync(kit), fs.readFileSync(runtimeKit));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.validation.ok, true);
  assert.equal(manifest.validation.dimensions.enclosedWidthM, PREMIUM_COUNTRY_CLUB_WIDTH_METERS);
  assert.equal(manifest.validation.dimensions.enclosedDepthM, PREMIUM_COUNTRY_CLUB_DEPTH_METERS);
  assert.ok(Math.abs(manifest.validation.dimensions.enclosedAreaFt2 - PREMIUM_COUNTRY_CLUB_AREA_SQUARE_FEET) < 0.01);
  assert.equal(manifest.validation.emptyInterior, true);
  assert.deepEqual(manifest.sourceLicense.externalDownloads, []);
  assert.ok(manifest.validation.counts.moduleTemplates >= 30);
  assert.ok(manifest.validation.counts.collisionMeshes >= 30);
  assert.ok(manifest.validation.counts.pivots >= 10);
});
