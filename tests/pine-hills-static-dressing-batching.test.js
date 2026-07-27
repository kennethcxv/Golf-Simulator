import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  PINE_HILLS_CLEANUP_POSES,
  PINE_HILLS_CLEANUP_VISUAL_POSES,
  PINE_HILLS_STATIC_DRESSING_KEYS,
  PINE_HILLS_SIGN_DATUM,
  PINE_HILLS_TOURNAMENT_POSTER_POSE,
  batchPineHillsStaticDressing,
  createPineHillsLeafLitter,
  pineHillsRestorationObjectName,
  createPineHillsOfficeDoorReveal,
  pineHillsInteractionWorldY,
} from '../src/render3d/clubhouse/pineHillsInterior.js';

test('Pine Hills restoration scene names preserve target-id punctuation consistently', () => {
  assert.equal(
    pineHillsRestorationObjectName('entry:leaves-trash'),
    'RestorationTarget_entry_leaves-trash',
  );
  assert.equal(
    pineHillsRestorationObjectName('corner:cobweb-nw'),
    'RestorationTarget_corner_cobweb-nw',
  );
});
import { INTERIOR, MODERN_PUBLIC_INTERIOR } from '../src/data/shopLayout.js';

function opaqueMesh(name, material, x) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.2), material);
  mesh.name = name;
  mesh.position.x = x;
  mesh.receiveShadow = true;
  return mesh;
}

test('Pine Hills signs sit on the modern public wall faces instead of the legacy shell', () => {
  assert.ok(PINE_HILLS_SIGN_DATUM.westInteriorX > -MODERN_PUBLIC_INTERIOR.w / 2 - 0.05);
  assert.ok(PINE_HILLS_SIGN_DATUM.westInteriorX < -MODERN_PUBLIC_INTERIOR.w / 2 + 0.30);
  assert.ok(PINE_HILLS_SIGN_DATUM.courseInteriorZ > MODERN_PUBLIC_INTERIOR.d / 2 + 0.04);
  // The municipal Blender shell is fractionally deeper than the legacy
  // gameplay collision envelope.  Keep both plaques straddling that authored
  // partition instead of comparing the inner plaque to the older shell wall.
  assert.ok(PINE_HILLS_SIGN_DATUM.courseInteriorZ < PINE_HILLS_SIGN_DATUM.courseExteriorZ);
  assert.ok(PINE_HILLS_SIGN_DATUM.courseExteriorZ > PINE_HILLS_SIGN_DATUM.courseInteriorZ + 0.35);
  assert.ok(PINE_HILLS_SIGN_DATUM.servicePartitionPublicX < 5.35 / 0.9144 - 0.19);
  assert.ok(PINE_HILLS_SIGN_DATUM.officePublicZ > 2.20);
  assert.ok(PINE_HILLS_SIGN_DATUM.serviceDoorSignY < 2.6 / 0.9144);
});

test('the tournament poster occupies a clear partition bay instead of a room door', () => {
  const posterHalfWidth = PINE_HILLS_TOURNAMENT_POSTER_POSE.width / 2;
  const roomDoorCenters = [3.70, -0.20, -4.18].map((meters) => -meters / 0.9144);
  const roomDoorHalfWidth = (0.92 / 0.9144) / 2;
  for (const centerZ of roomDoorCenters) {
    const edgeGap = Math.abs(PINE_HILLS_TOURNAMENT_POSTER_POSE.z - centerZ)
      - posterHalfWidth - roomDoorHalfWidth;
    assert.ok(edgeGap >= 0.45,
      `poster must leave a visible wall margin beside room door at z=${centerZ}`);
  }
  assert.ok(Math.abs(
    PINE_HILLS_TOURNAMENT_POSTER_POSE.x - PINE_HILLS_SIGN_DATUM.servicePartitionPublicX,
  ) < 1e-9, 'poster is mounted on the public face of the service partition');
});

test('every Pine Hills cleanup contact stays safely inside the playable room', () => {
  const interactionInset = 0.25;
  for (const [targetId, pose] of Object.entries(PINE_HILLS_CLEANUP_POSES)) {
    assert.ok(Math.abs(pose.x) <= INTERIOR.w / 2 - interactionInset,
      `${targetId} x=${pose.x} must leave room for a first-person tool contact`);
    assert.ok(Math.abs(pose.z) <= INTERIOR.d / 2 - interactionInset,
      `${targetId} z=${pose.z} must leave room for a first-person tool contact`);
  }
});

test('the overflow bin is reachable through the trash bag normal swing envelope', () => {
  const pose = PINE_HILLS_CLEANUP_POSES['desk:overflow-bin'];
  assert.ok(pose.radius >= 1.30,
    `overflow-bin radius ${pose.radius} must reach past the front-desk collision stop`);
  assert.ok(pose.radius <= 1.40,
    `overflow-bin radius ${pose.radius} must remain a deliberate local pickup zone`);
});

test('wall cleanup visuals stay mounted at their authored wall faces', () => {
  for (const targetId of ['corner:cobweb-nw', 'corner:cobweb-ne']) {
    assert.ok(Math.abs(
      Math.abs(PINE_HILLS_CLEANUP_VISUAL_POSES[targetId].z) - INTERIOR.d / 2,
    ) < 0.20, `${targetId} remains visibly seated at the north wall`);
  }
  assert.ok(Math.abs(
    Math.abs(PINE_HILLS_CLEANUP_VISUAL_POSES['wall:scuff-west'].x) - INTERIOR.w / 2,
  ) < 0.20, 'west scuff remains visibly seated at the west wall');
  assert.equal(PINE_HILLS_CLEANUP_VISUAL_POSES['wall:scuff-east'].x, 5.35,
    'east scuff remains seated at the public service partition');
});

test('the office reveal seals the municipal door opening and adapts to later door upgrades', () => {
  const group = new THREE.Group();
  const state = { shop: { reno: {} } };
  const reveal = createPineHillsOfficeDoorReveal(group, state);
  const municipal = { ...reveal.root.userData };

  assert.equal(reveal.root.name, 'PineHillsOfficeDoorFinishedReveal');
  assert.ok(municipal.sideWidth > 0.17);
  assert.ok(municipal.headerHeight > 0.24);
  assert.equal(reveal.root.getObjectByName('PineHillsOfficeReveal_LeftInfill').visible, true);
  assert.equal(reveal.root.getObjectByName('PineHillsOfficeReveal_RightInfill').visible, true);
  assert.equal(reveal.root.getObjectByName('PineHillsOfficeReveal_HeaderInfill').visible, true);

  state.shop.reno.constructionFinishes.installed.doors.qualityId = 'premium';
  const premium = reveal.refresh();
  assert.ok(premium.installedWidth > municipal.installedWidth);
  assert.ok(premium.installedHeight > municipal.installedHeight);
  assert.ok(premium.sideWidth < municipal.sideWidth);
  assert.ok(premium.headerHeight < municipal.headerHeight);
});

test('Pine Hills whitelist contains only immutable dressing assets', () => {
  assert.deepEqual(PINE_HILLS_STATIC_DRESSING_KEYS, [
    'golfTv',
    'waterCooler',
    'wasteBin',
    'floorPlant',
    'counterPlant',
  ]);
  for (const statefulKey of [
    'frontDeskReturn',
    'openingCooler',
    'overflowBin',
    'deskClutter',
    'loungeLitter',
    'fallenFrame',
  ]) {
    assert.equal(PINE_HILLS_STATIC_DRESSING_KEYS.includes(statefulKey), false, statefulKey);
  }
});

test('Pine Hills interaction aim heights are converted from clubhouse-local to world space', () => {
  const sceneRoot = new THREE.Group();
  sceneRoot.position.y = -4.25;
  const interior = new THREE.Group();
  interior.position.y = 1.30;
  sceneRoot.add(interior);

  assert.ok(Math.abs(pineHillsInteractionWorldY(interior, 1.64) - (-1.31)) < 1e-9);
  assert.equal(pineHillsInteractionWorldY(interior, null), null);
});

test('the immutable entrance leaf target is one merged draw with all 18 authored leaves', () => {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const litter = createPineHillsLeafLitter(material);

  assert.equal(litter.isMesh, true);
  assert.equal(litter.userData.sourceLeafCount, 18);
  assert.equal(litter.geometry.index.count / 3, 18 * 5);
  assert.equal(litter.material, material);

  litter.geometry.dispose();
  material.dispose();
});

test('static dressing batch preserves hierarchy, authored resources, and cleanup visibility', () => {
  const parent = new THREE.Group();
  parent.position.set(3, 0.4, -2);

  const materialA = new THREE.MeshStandardMaterial({
    name: 'M_PineHills_Walnut',
    color: 0x6f4732,
    roughness: 0.64,
  });
  const materialB = new THREE.MeshStandardMaterial({
    name: 'M_PineHills_Walnut',
    color: 0x6f4732,
    roughness: 0.64,
  });
  const staticA = new THREE.Group();
  staticA.name = 'PineHills_floorPlant';
  staticA.position.set(-1, 0, 0.5);
  const sourceA = opaqueMesh('PlantPot_A', materialA, -0.3);
  const socket = new THREE.Group();
  socket.name = 'SOCKET_PLACEMENT';
  staticA.add(sourceA, socket);

  const staticB = new THREE.Group();
  staticB.name = 'PineHills_floorPlant_2';
  staticB.position.set(1.2, 0, -0.4);
  staticB.rotation.y = 0.4;
  const sourceB = opaqueMesh('PlantPot_B', materialB, 0.25);
  staticB.add(sourceB);
  parent.add(staticA, staticB);

  const transparentMaterial = new THREE.MeshStandardMaterial({
    name: 'M_PineHills_Glass',
    transparent: true,
    opacity: 0.45,
  });
  const transparent = opaqueMesh('AuthoredTransparentDetail', transparentMaterial, 0.6);
  staticA.add(transparent);

  const cleanupMaterial = new THREE.MeshStandardMaterial({ name: 'M_CleanupTarget' });
  const cleanupRoot = new THREE.Group();
  cleanupRoot.name = 'RestorationTarget_desk_overflow_bin';
  const cleanupMesh = opaqueMesh('OverflowDebris', cleanupMaterial, 0);
  cleanupRoot.add(cleanupMesh);
  cleanupRoot.visible = false;
  parent.add(cleanupRoot);

  let sourceGeometryDisposals = 0;
  let sourceMaterialDisposals = 0;
  sourceA.geometry.addEventListener('dispose', () => { sourceGeometryDisposals += 1; });
  sourceB.geometry.addEventListener('dispose', () => { sourceGeometryDisposals += 1; });
  materialA.addEventListener('dispose', () => { sourceMaterialDisposals += 1; });
  materialB.addEventListener('dispose', () => { sourceMaterialDisposals += 1; });

  const result = batchPineHillsStaticDressing(parent, [staticA, staticB]);
  assert.equal(result.sourceDrawCalls, 2);
  assert.equal(result.batchedSourceDrawCalls, 2);
  assert.equal(result.batchedDrawCalls, 1);
  assert.equal(result.drawCallsSaved, 1);
  assert.equal(result.canonicalMaterials, 1);
  assert.equal(result.materialCanonicalizations, 1);
  assert.equal(result.sourceTriangles, result.batchedTriangles);

  const batchMesh = result.root.children[0];
  assert.ok(batchMesh?.isMesh);
  assert.equal(batchMesh.material, materialA, 'generated draw reuses one authored canonical material');
  assert.equal(sourceA.material, materialA, 'source material identity remains untouched');
  assert.equal(sourceB.material, materialB, 'second source material identity remains untouched');
  assert.equal(sourceA.layers.mask, 0);
  assert.equal(sourceB.layers.mask, 0);
  assert.notEqual(transparent.layers.mask, 0, 'transparent authored detail remains independent');
  assert.equal(cleanupRoot.visible, false, 'cleanup target visibility remains unchanged');
  assert.notEqual(cleanupMesh.layers.mask, 0, 'cleanup target render layer remains unchanged');
  assert.equal(staticA.getObjectByName('SOCKET_PLACEMENT'), socket, 'named socket stays in hierarchy');

  let batchGeometryDisposals = 0;
  batchMesh.geometry.addEventListener('dispose', () => { batchGeometryDisposals += 1; });
  assert.deepEqual(result.dispose(), { geometries: 1, restoredSourceMeshes: 2 });
  assert.equal(result.root.parent, null);
  assert.notEqual(sourceA.layers.mask, 0);
  assert.notEqual(sourceB.layers.mask, 0);
  assert.equal(sourceA.material, materialA);
  assert.equal(sourceB.material, materialB);
  assert.equal(batchGeometryDisposals, 1, 'owned merged geometry is released exactly once');
  assert.equal(sourceGeometryDisposals, 0, 'borrowed source geometry is not released');
  assert.equal(sourceMaterialDisposals, 0, 'borrowed authored materials are not released');
  assert.deepEqual(result.dispose(), { geometries: 0, restoredSourceMeshes: 0 });
  assert.equal(batchGeometryDisposals, 1, 'repeat disposal is idempotent');

  sourceA.geometry.dispose();
  sourceB.geometry.dispose();
  transparent.geometry.dispose();
  cleanupMesh.geometry.dispose();
  materialA.dispose();
  materialB.dispose();
  transparentMaterial.dispose();
  cleanupMaterial.dispose();
});

test('external lifecycle disposal is detected and never repeated by the batch owner', () => {
  const parent = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ name: 'M_PineHills_Static' });
  const first = opaqueMesh('Static_A', material, -1);
  const second = opaqueMesh('Static_B', material, 1);
  parent.add(first, second);

  const result = batchPineHillsStaticDressing(parent, [first, second]);
  const merged = result.root.children[0].geometry;
  let mergedDisposals = 0;
  merged.addEventListener('dispose', () => { mergedDisposals += 1; });
  merged.dispose();

  assert.deepEqual(result.dispose(), { geometries: 0, restoredSourceMeshes: 2 });
  assert.equal(mergedDisposals, 1);
  assert.notEqual(first.layers.mask, 0);
  assert.notEqual(second.layers.mask, 0);

  first.geometry.dispose();
  second.geometry.dispose();
  material.dispose();
});
