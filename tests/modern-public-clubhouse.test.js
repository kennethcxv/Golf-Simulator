import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as THREE from 'three';

import {
  MODERN_CLUBHOUSE_BUILDING_WIDTH_METERS,
  MODERN_CLUBHOUSE_CART_BARN_X_METERS,
  MODERN_CLUBHOUSE_MAIN_DOOR_X_METERS,
  MODERN_CLUBHOUSE_ROOM_DOORS,
  MODERN_CLUBHOUSE_SERVICE_DOOR_WIDTH_METERS,
  MODERN_CLUBHOUSE_METERS_TO_YARDS,
  batchModernClubhouseStaticGeometry,
  createModernPublicClubhouse,
  restrainModernStorefrontGlass,
} from '../src/render3d/clubhouse/modernPublicClubhouse.js';

function assetScene(kind) {
  const root = new THREE.Group();
  root.name = kind === 'building' ? 'MODERN_PUBLIC_CLUBHOUSE' : 'MODERN_PUBLIC_CLUBHOUSE_SITE';
  const material = new THREE.MeshStandardMaterial({ name: 'M_SageSiding' });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.2), material);
  mesh.name = kind === 'building' ? 'MODULE_WallSystem' : 'MODULE_ParkingLot_52Space';
  mesh.userData.module_family = kind === 'building' ? 'wall-system' : 'parking-lot';
  root.add(mesh);
  const collision = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  collision.name = `COL_${kind}`;
  collision.userData.collision_proxy = true;
  root.add(collision);
  if (kind === 'building') {
    for (const name of [
      'PIVOT_MainEntranceLeft', 'PIVOT_MainEntranceRight', 'PIVOT_RearServiceDoor',
      ...MODERN_CLUBHOUSE_ROOM_DOORS.map((entry) => entry.pivotName),
    ]) {
      const pivot = new THREE.Group();
      pivot.name = name;
      if (name === 'PIVOT_RearServiceDoor') pivot.rotation.y = 1.1;
      root.add(pivot);
    }
  }
  return root;
}

test('municipal storefront glass keeps transmission without player-camera sun pin lights', () => {
  const root = new THREE.Group();
  const storefront = new THREE.MeshPhysicalMaterial({
    name: 'MAT_MCP_ClearStorefrontGlass',
    roughness: 0.10,
    transmission: 0.78,
    envMapIntensity: 1,
  });
  const cooler = new THREE.MeshPhysicalMaterial({
    name: 'MAT_PH_CoolerGlass',
    roughness: 0.10,
    transmission: 0.82,
    envMapIntensity: 1,
  });
  root.add(
    new THREE.Mesh(new THREE.PlaneGeometry(1, 1), storefront),
    new THREE.Mesh(new THREE.PlaneGeometry(1, 1), storefront),
    new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cooler),
  );

  assert.equal(restrainModernStorefrontGlass(root), 1);
  assert.equal(storefront.roughness, 0.34);
  assert.equal(storefront.envMapIntensity, 0.20);
  assert.equal(storefront.transmission, 0.78);
  assert.equal(cooler.roughness, 0.10);
  assert.equal(cooler.envMapIntensity, 1);
});

test('modern runtime batches immutable modules while retaining pivots and source hierarchy', () => {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ name: 'M_ReusableSiding' });
  for (const x of [-1, 0, 1]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1, 0.1), material);
    mesh.position.x = x;
    mesh.name = `MODULE_Siding_${x}`;
    root.add(mesh);
  }
  const pivot = new THREE.Group();
  pivot.name = 'PIVOT_MainEntranceLeft';
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.08), material);
  leaf.name = 'MainEntranceLeaf';
  pivot.add(leaf);
  root.add(pivot);

  const result = batchModernClubhouseStaticGeometry(root, 'test');
  assert.equal(result.batchedSourceDrawCalls, 3);
  assert.equal(result.batchedDrawCalls, 1);
  assert.equal(result.drawCallsSaved, 2);
  assert.ok(root.getObjectByName('RUNTIME_ModernClubhouseStaticBatches_test'));
  assert.ok(root.getObjectByName('PIVOT_MainEntranceLeft'));
  assert.equal(leaf.visible, true);
  assert.deepEqual(root.children.slice(0, 3).map((entry) => entry.visible), [false, false, false]);
});

test('modern clubhouse replaces legacy and built-in door presentation while retaining pivot state', async () => {
  const mount = new THREE.Group();
  const sheetRoots = new Map();
  for (let number = 51; number <= 60; number++) sheetRoots.set(number, new THREE.Group());
  const fallbacks = Object.fromEntries([
    'exteriorShellStructure', 'apertureTrim', 'porchVisuals', 'windowVisuals',
    'renovatedFloor', 'ceilingVisuals', 'wainscotPanels', 'interiorTrim',
  ].map((key) => [key, { visible: true, setVisible(value) { this.visible = value; } }]));
  const doors = [
    { mainLeaf: 'left', angle: 0.42 },
    { mainLeaf: 'right', angle: -0.36 },
    { name: 'Receiving door', angle: 0.27 },
  ];
  const legacyPartitionColliders = [
    { id: 'legacy-spine' },
    { id: 'legacy-cross-west' },
    { id: 'legacy-cross-east' },
  ];
  const colliders = [...legacyPartitionColliders];
  const roomDoorCalls = [];
  let roomDoorUnbinds = 0;
  const loader = {
    load(url, onLoad) {
      onLoad({ scene: assetScene(url.includes('_site_') ? 'site' : 'building') });
    },
  };
  const modern = createModernPublicClubhouse({
    group: mount,
    sheet06: {
      ready: Promise.resolve(),
      getRoot: (number) => sheetRoots.get(number),
      getAssemblyRoot: (number) => sheetRoots.get(number),
    },
    shellFallbacks: fallbacks,
    legacyPartitionColliders,
    doors,
    doorApi: {
      bindModernRoomDoorVisuals(root, specs) {
        roomDoorCalls.push({ root, specs });
        return { ok: true, bound: specs.length };
      },
      unbindModernRoomDoorVisuals() {
        roomDoorUnbinds += 1;
        return { removed: 3 };
      },
    },
    addCollider: (collider) => {
      colliders.push(collider);
      return collider;
    },
    removeCollider: (collider) => {
      const index = colliders.indexOf(collider);
      if (index >= 0) colliders.splice(index, 1);
    },
    colBoxAt: (x, z, width, depth) => ({ x, z, width, depth }),
    replacementDoorPresentation: true,
    loader,
  });

  const ready = await modern.ready;
  assert.equal(ready.lifecycle, 'active');
  assert.equal(ready.footprintSquareFeet, 1898.8);
  assert.equal(ready.parkingSpaces, 52);
  assert.equal(ready.interiorFurnishedByAsset, false);
  assert.equal(ready.modularConstruction, true);
  assert.equal(ready.synchronizedDoorPivots, 3);
  assert.deepEqual(ready.modernRoomDoorBinding, { ok: true, bound: 3 });
  assert.equal(ready.replacedLegacyPartitionColliders, 3);
  assert.equal(ready.interiorPartitionColliderCount, 10);
  assert.equal(ready.restroomFixtureColliderCount, 2);
  assert.equal(ready.permanentRestroomFitout, true);
  assert.equal(ready.suppressedBuiltInDoorNodes, 3);
  assert.equal(colliders.length, 23);
  assert.equal(roomDoorCalls.length, 1);
  assert.deepEqual(roomDoorCalls[0].specs.map((entry) => entry.name), [
    'Employee door', 'Storage door', 'Restroom door',
  ]);
  assert.deepEqual([...sheetRoots.values()].map((entry) => entry.visible), Array(10).fill(false));
  assert.deepEqual(Object.values(fallbacks).map((entry) => entry.visible), Array(8).fill(false));

  modern.update();
  const building = modern.roots().building;
  assert.equal(building.scale.x, MODERN_CLUBHOUSE_METERS_TO_YARDS);
  assert.equal(building.getObjectByName('COL_building').visible, false);
  assert.equal(modern.roots().site.getObjectByName('COL_site').visible, false);
  assert.equal(building.getObjectByName('PIVOT_MainEntranceLeft').rotation.y, 0.42);
  assert.equal(building.getObjectByName('PIVOT_MainEntranceRight').rotation.y, -0.36);
  assert.ok(Math.abs(building.getObjectByName('PIVOT_RearServiceDoor').rotation.y - 1.37) < 1e-9);
  assert.equal(building.getObjectByName('PIVOT_MainEntranceLeft').visible, false);
  assert.equal(building.getObjectByName('PIVOT_MainEntranceRight').visible, false);
  assert.equal(building.getObjectByName('PIVOT_RearServiceDoor').visible, false);

  const disposed = modern.dispose();
  assert.equal(disposed.alreadyDisposed, false);
  assert.deepEqual(colliders, legacyPartitionColliders);
  assert.equal(roomDoorUnbinds, 1);
  assert.deepEqual([...sheetRoots.values()].map((entry) => entry.visible), Array(10).fill(true));
  assert.deepEqual(Object.values(fallbacks).map((entry) => entry.visible), Array(8).fill(true));
});

test('modern clubhouse source and exports retain production dimensions and provenance', () => {
  assert.equal(MODERN_CLUBHOUSE_BUILDING_WIDTH_METERS, 16.80);
  assert.equal(MODERN_CLUBHOUSE_CART_BARN_X_METERS, 24.50);
  assert.equal(MODERN_CLUBHOUSE_MAIN_DOOR_X_METERS, -0.73152);
  assert.equal(MODERN_CLUBHOUSE_SERVICE_DOOR_WIDTH_METERS, 1.3716);
  const repo = process.cwd();
  const files = [
    'tools/blender/build_modern_public_clubhouse.py',
    'asset_sources/blender/clubhouse/modern_public_clubhouse_v1.blend',
    'asset_sources/blender/clubhouse/modern_public_clubhouse_site_v1.blend',
    'vendor/models/clubhouse/modern_public_clubhouse_v1.glb',
    'vendor/models/clubhouse/modern_public_clubhouse_site_v1.glb',
    'qa/clubhouse-modern/blender/modern_public_clubhouse_v1_manifest.json',
    'qa/clubhouse-modern/blender/modern_public_clubhouse_site_v1_manifest.json',
    'qa/clubhouse-modern/blender/modern_public_clubhouse_v1_reimport.json',
  ].map((entry) => path.join(repo, entry));
  for (const file of files) assert.ok(fs.statSync(file).size > 0, file);

  const source = fs.readFileSync(files[0], 'utf8');
  assert.match(source, /Project-owned original; no external assets/);
  assert.match(source, /furnished=False/);
  assert.match(source, /expected_parking=52/);
  assert.match(source, /grade_openings/);
  assert.match(source, /door_apertures_clipped/);
  assert.match(source, /"Porch_Soffit"/);
  assert.match(source, /"Porch_RearGableInfill"/);
  assert.doesNotMatch(source, /pivot="base-center"/);
  const buildingManifest = JSON.parse(fs.readFileSync(files[5], 'utf8'));
  const siteManifest = JSON.parse(fs.readFileSync(files[6], 'utf8'));
  assert.equal(buildingManifest.dimensionsMeters.conditionedAreaSquareFeet, 1898.8);
  assert.equal(buildingManifest.interior.intentionallyEmpty, false);
  assert.deepEqual(buildingManifest.interior.permanentFurniture, [
    'restroom-toilet', 'restroom-hand-basin', 'restroom-mirror',
  ]);
  assert.deepEqual(buildingManifest.interior.serviceRooms, ['employee', 'storage', 'restroom']);
  const reimport = JSON.parse(fs.readFileSync(files[7], 'utf8'));
  assert.equal(reimport.porchRoofClosure.complete, true);
  assert.deepEqual(reimport.porchRoofClosure.nodes, ['Porch_Soffit', 'Porch_RearGableInfill']);
  assert.equal(reimport.permanentRestroom.complete, true);
  assert.deepEqual(reimport.permanentRestroom.fixtures, ['toilet', 'hand-basin', 'mirror', 'light']);
  assert.equal(siteManifest.site.parkingSpaces, 52);
  assert.deepEqual(siteManifest.site.cartBarnMeters, [12, 8.4]);
  assert.deepEqual(MODERN_CLUBHOUSE_ROOM_DOORS.map((entry) => entry.key), [
    'employee', 'storage', 'restroom',
  ]);
});
