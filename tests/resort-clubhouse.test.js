import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as THREE from 'three';

import {
  RESORT_CLUBHOUSE_AREA_SQUARE_FEET,
  RESORT_CLUBHOUSE_DEPTH_METERS,
  RESORT_CLUBHOUSE_WIDTH_METERS,
  batchResortStaticGeometry,
  createResortClubhouse,
  resortMaterialCastsShadow,
  resortMaterialIsDoubleSided,
} from '../src/render3d/clubhouse/resortClubhouse.js';

function testScene() {
  const scene = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ name: 'M_StuccoCream' });
  for (const x of [-2, 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.25), material);
    wall.position.x = x;
    scene.add(wall);
  }
  const collision = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  collision.name = 'COL_Test';
  scene.add(collision);
  for (const side of ['Left', 'Right']) {
    const pivot = new THREE.Group();
    pivot.name = `PIVOT_Door${side}`;
    pivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.4, 0.12), material));
    scene.add(pivot);
  }
  return scene;
}

test('resort static batching preserves modular doors and hides collision proxies', () => {
  const scene = testScene();
  const result = batchResortStaticGeometry(scene);
  assert.equal(result.sourceDrawCalls, 2);
  assert.equal(result.batchedDrawCalls, 1);
  assert.equal(result.drawCallsSaved, 1);
  assert.equal(scene.getObjectByName('COL_Test').visible, false);
  assert.equal(scene.getObjectByName('PIVOT_DoorLeft').children[0].visible, true);
  assert.ok(scene.getObjectByName('RUNTIME_ResortStaticBatches'));
});

test('resort shadow policy keeps architecture grounded without resubmitting fine transparent detail', () => {
  assert.equal(resortMaterialCastsShadow({ name: 'M_Stucco_WarmCream' }), true);
  assert.equal(resortMaterialCastsShadow({ name: 'M_ClayTile_Terracotta' }), true);
  assert.equal(resortMaterialCastsShadow({ name: 'M_PalmLeafLight' }), false);
  assert.equal(resortMaterialCastsShadow({ name: 'M_WindowGlass' }), false);
  assert.equal(resortMaterialCastsShadow({ name: 'M_Water_ResortBlue' }), false);
});

test('resort botanical planes remain readable from both sides of the player camera', () => {
  assert.equal(resortMaterialIsDoubleSided({ name: 'M_PalmLeaf' }), true);
  assert.equal(resortMaterialIsDoubleSided({ name: 'M_PalmLeafLight' }), true);
  assert.equal(resortMaterialIsDoubleSided({ name: 'M_Bougainvillea' }), true);
  assert.equal(resortMaterialIsDoubleSided({ name: 'M_Stucco_WarmCream' }), false);
});

test('resort presentation is tier-gated, suppresses competing shells, and mirrors doors', async () => {
  const mount = new THREE.Group();
  const legacyShell = new THREE.Group();
  legacyShell.name = 'LegacyShell';
  mount.add(legacyShell);
  const legacyInterior = new THREE.Group();
  const fixedCheckout = new THREE.Group();
  fixedCheckout.name = 'FixedLegacyCheckout';
  const playerFurniture = new THREE.Group();
  playerFurniture.name = 'PlayerPlacedFurniture';
  playerFurniture.userData.playerPlacedFurniture = true;
  legacyInterior.add(fixedCheckout, playerFurniture);
  const competing = new THREE.Group();
  const sheetRoots = new Map([51, 52, 53, 54, 55, 58].map((number) => [number, new THREE.Group()]));
  const fallbacks = Object.fromEntries([
    'exteriorShellStructure', 'apertureTrim', 'porchVisuals', 'windowVisuals', 'ceilingVisuals',
  ].map((key) => [key, { visible: true, setVisible(value) { this.visible = value; } }]));
  const doors = [
    { mainLeaf: 'left', angle: 0.45 },
    { mainLeaf: 'right', angle: -0.35 },
  ];
  const activeColliders = [];
  const addCollider = (collider) => { activeColliders.push(collider); return collider; };
  const removeCollider = (collider) => activeColliders.splice(activeColliders.indexOf(collider), 1);
  const colBoxAt = (x, z, width, depth) => ({
    minX: x - width / 2, maxX: x + width / 2,
    minZ: z - depth / 2, maxZ: z + depth / 2,
  });
  const loader = { load(_url, onLoad) { onLoad({ scene: testScene() }); } };
  const resort = createResortClubhouse({
    group: mount,
    legacyInterior,
    shellFallbacks: fallbacks,
    sheet06Production: {
      ready: Promise.resolve(),
      getRoot: (number) => sheetRoots.get(number),
    },
    doors,
    floorTop: 0.3,
    facadeDoorZ: 7,
    entranceCenterX: -0.8,
    competingRoots: [competing],
    addCollider,
    removeCollider,
    colBoxAt,
    loader,
  });
  const ready = await resort.ready;
  assert.equal(ready.ok, true);
  assert.equal(resort.enabled(), true);
  resort.update();
  const root = resort.root();
  assert.equal(root.getObjectByName('PIVOT_DoorLeft').rotation.y, 0.45);
  assert.equal(root.getObjectByName('PIVOT_DoorRight').rotation.y, -0.35);
  assert.equal(competing.visible, false);
  assert.equal(legacyShell.visible, false);
  assert.equal(fixedCheckout.visible, false);
  assert.equal(playerFurniture.visible, true);
  assert.deepEqual([...sheetRoots.values()].map((entry) => entry.visible), Array(6).fill(false));
  assert.deepEqual(Object.values(fallbacks).map((entry) => entry.visible), Array(5).fill(false));
  assert.equal(resort.diagnostics().conditionedAreaSquareFeet, RESORT_CLUBHOUSE_AREA_SQUARE_FEET);
  assert.equal(resort.diagnostics().runtimeBatch.batchedDrawCalls, 1);
  assert.ok(resort.diagnostics().colliderCount >= 10);
  assert.equal(activeColliders.length, resort.diagnostics().colliderCount);
  resort.dispose();
  assert.equal(activeColliders.length, 0);
  assert.equal(competing.visible, true);
  assert.equal(legacyShell.visible, true);
  assert.equal(fixedCheckout.visible, true);
  assert.equal(playerFurniture.visible, true);
});

test('resort source/export/manifest remain reproducible and dimensionally correct', () => {
  const root = process.cwd();
  const source = path.join(root, 'asset_sources/blender/clubhouse_resort_4000/clubhouse_resort_4000.blend');
  const canonical = path.join(root, 'Assets/clubhouse_resort_4000/glb/clubhouse_resort_4000.glb');
  const runtime = path.join(root, 'vendor/models/clubhouse/clubhouse_resort_4000.glb');
  const manifestPath = path.join(root, 'qa/clubhouse_resort/blender/clubhouse_resort_4000_manifest.json');
  for (const file of [source, canonical, runtime, manifestPath]) assert.ok(fs.statSync(file).size > 0, file);
  assert.notEqual(fs.statSync(runtime).size, fs.statSync(canonical).size);
  assert.ok(fs.statSync(runtime).size < 25 * 1024 * 1024);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.dimensionsMeters.width, RESORT_CLUBHOUSE_WIDTH_METERS);
  assert.equal(manifest.dimensionsMeters.depth, RESORT_CLUBHOUSE_DEPTH_METERS);
  assert.ok(Math.abs(manifest.conditionedArea.squareFeet - RESORT_CLUBHOUSE_AREA_SQUARE_FEET) < 0.01);
  assert.equal(manifest.interior.intentionallyEmpty, true);
  assert.deepEqual(manifest.interior.permanentFurniture, []);
  assert.deepEqual(manifest.unappliedScaleObjects, []);
  assert.ok(manifest.collisionProxyCount >= 10);
  assert.ok(Object.keys(manifest.modules).length >= 7);
  assert.ok(manifest.runtimeOptimization.sourceMeshes > manifest.runtimeOptimization.runtimeMeshes);
  assert.ok(manifest.runtimeOptimization.staticBatches <= 24);
  assert.equal(manifest.runtimeOptimization.preservedDoorNodes >= 20, true);
  assert.equal(manifest.runtimeOptimization.preservedSockets, 9);
});
