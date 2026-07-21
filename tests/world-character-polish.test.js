import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { makeCharacter } from '../src/render3d/characterAsset.js';

const BUILDER = fs.readFileSync(
  new URL('../tools/blender/build_world_polish.py', import.meta.url),
  'utf8',
);
const COURSE_SOURCE = fs.readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);

async function loadWorldAsset(id) {
  const bytes = fs.readFileSync(new URL(`../vendor/models/world/${id}.glb`, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'world-polish-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  return new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
}

function geometrySet(root) {
  const resources = new Set();
  root.traverse((object) => { if (object.geometry) resources.add(object.geometry); });
  return resources;
}

test('world polish assets keep repeatable editable Blender sources', () => {
  assert.match(BUILDER, /maintenance_yard_dressing/);
  assert.match(BUILDER, /SOCKET_Grip/);
  assert.match(BUILDER, /L\.save_and_export\(asset_id, root, subdir="world"\)/);
  for (const id of ['maintenance_yard_dressing', 'golfer_iron']) {
    const source = fs.statSync(new URL(`../asset_sources/blender/world/${id}.blend`, import.meta.url));
    assert.ok(source.size > 100_000, `${id} retains its editable Blender source`);
  }
});

test('maintenance yard ships true-scale dressing, sockets, and simple collision', async () => {
  const gltf = await loadWorldAsset('maintenance_yard_dressing');
  const names = new Set();
  let triangles = 0;
  gltf.scene.traverse((object) => {
    if (object.name) names.add(object.name);
    if (object.isMesh) triangles += object.geometry.index
      ? object.geometry.index.count / 3
      : object.geometry.attributes.position.count / 3;
  });
  for (const name of [
    'SOCKET_TractorBay', 'SOCKET_ServiceBay', 'COL_BackFence', 'COL_EastFence',
    'COL_GroundsRack', 'COL_GroundsSign',
  ]) assert.ok(names.has(name), `maintenance yard exports ${name}`);
  const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
  assert.ok(size.x >= 9.2 && size.z >= 7.8 && size.y >= 1.45,
    `maintenance yard uses believable metres: ${size.toArray().map((n) => n.toFixed(2)).join(' x ')}`);
  assert.ok(triangles < 16000, `yard stays under its 16k static budget (${triangles})`);
});

test('golfer iron has a true grip pivot and a production-scale silhouette', async () => {
  const gltf = await loadWorldAsset('golfer_iron');
  const grip = gltf.scene.getObjectByName('SOCKET_Grip');
  const face = gltf.scene.getObjectByName('SOCKET_ClubFace');
  assert.ok(grip, 'club exports the articulated hand socket');
  assert.ok(face, 'club exports the impact-face socket');
  gltf.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new THREE.Vector3());
  const gripWorld = grip.getWorldPosition(new THREE.Vector3());
  assert.ok(size.y >= 1.0 && size.y <= 1.12, `club length is believable (${size.y.toFixed(3)} m)`);
  assert.ok(Math.abs(gripWorld.y - bounds.max.y) < 0.01,
    'the root hand socket sits at the physical top of the grip');
});

test('same-outfit characters share immutable geometry until the final owner disposes', () => {
  const first = makeCharacter();
  const second = makeCharacter();
  const firstGeometry = geometrySet(first.root);
  const secondGeometry = geometrySet(second.root);
  const shared = [...firstGeometry].filter((geometry) => secondGeometry.has(geometry));
  assert.ok(shared.length >= firstGeometry.size * 0.9,
    `expected at least 90% shared geometry (${shared.length}/${firstGeometry.size})`);
  let disposals = 0;
  shared[0].addEventListener('dispose', () => { disposals += 1; });
  first.dispose();
  assert.equal(disposals, 0, 'one departing customer cannot invalidate a live customer');
  second.dispose();
  assert.equal(disposals, 1, 'the final owner releases the shared GPU geometry');
});

test('mode changes blend from the visible pose and golf equipment follows its context', () => {
  const char = makeCharacter();
  char.update(0.3);
  const before = char.hand('R').getWorldPosition(new THREE.Vector3());
  char.setMode('Swing');
  char.update(0);
  char.root.updateMatrixWorld(true);
  assert.ok(char.hand('R').getWorldPosition(new THREE.Vector3()).distanceTo(before) < 1e-8,
    'the first transition frame does not snap the wrist');

  const club = new THREE.Group();
  char.attachEquipment(club, { kind: 'golf-club' });
  char.update(1.22);
  char.root.updateMatrixWorld(true);
  assert.equal(club.visible, true, 'club is visible during the swing');
  assert.ok(char.carryGrip('L').getWorldPosition(new THREE.Vector3()).distanceTo(
    char.carryGrip('R').getWorldPosition(new THREE.Vector3()),
  ) < 0.16, 'both hands meet around the club grip through the backswing');
  assert.ok(club.rotation.z > 1.5, 'the club rises into a visible backswing arc');
  char.setMode('Drive');
  char.update(0.3);
  assert.equal(club.visible, false, 'club is stowed while seated in a cart');
  char.setMode('Walk');
  char.update(0.3);
  assert.equal(club.visible, true, 'club returns to the golfer hand on foot');
  char.dispose();
});

test('the live course binds both new GLBs and converts authored collision proxies', () => {
  assert.match(COURSE_SOURCE, /vendor\/models\/world\/maintenance_yard_dressing\.glb/);
  assert.match(COURSE_SOURCE, /vendor\/models\/world\/golfer_iron\.glb/);
  assert.match(COURSE_SOURCE, /object\.name\.startsWith\('COL_'\)/);
  assert.match(COURSE_SOURCE, /char\.attachEquipment\(club, \{ side: 'R', kind: 'golf-club' \}\)/);
});
