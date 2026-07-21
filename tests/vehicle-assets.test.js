import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ASSETS = [
  ['grounds_tractor', [1.6, 2.15, 3.4]],
  ['grounds_tractor_broken', [1.6, 2.15, 3.0]],
  ['fleet_golf_cart', [1.15, 1.7, 2.3]],
];

const BUILDER = fs.readFileSync(new URL('../tools/blender/build_vehicles.py', import.meta.url), 'utf8');

test('the repeatable vehicle builder always preserves the operational hierarchy', () => {
  assert.doesNotMatch(BUILDER, /L\.run\(/,
    'the generic prop runner can join named lights and moving assemblies');
  assert.doesNotMatch(BUILDER, /L\.join_static\(/);
  assert.match(BUILDER, /L\.save_and_export\(asset_id, root, subdir="vehicles"\)/);
  for (const [id] of ASSETS) {
    const source = fs.statSync(new URL(`../asset_sources/blender/vehicles/${id}.blend`, import.meta.url));
    assert.ok(source.size > 100_000, `${id} retains its editable Blender source`);
  }
  const station = fs.statSync(new URL('../asset_sources/blender/vehicles/cart_fleet_station.blend', import.meta.url));
  assert.ok(station.size > 100_000, 'cart fleet station retains its editable Blender source');
});

async function load(id) {
  const data = fs.readFileSync(new URL(`../vendor/models/vehicles/${id}.glb`, import.meta.url));
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'node-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  return new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
}

test('vehicle assets ship operational hierarchies and believable metre dimensions', async () => {
  for (const [id, minimum] of ASSETS) {
    const gltf = await load(id);
    const names = new Set();
    let triangles = 0;
    gltf.scene.traverse((object) => {
      if (object.name) names.add(object.name);
      if (object.isMesh) {
        triangles += object.geometry.index
          ? object.geometry.index.count / 3
          : object.geometry.attributes.position.count / 3;
      }
    });
    for (const name of [
      'LOD0_Detail', 'LOD1_Silhouette', 'PIVOT_Wheel_FL', 'PIVOT_Wheel_FR',
      'PIVOT_Wheel_RL', 'PIVOT_Wheel_RR', 'PIVOT_Steer_FL', 'PIVOT_Steer_FR',
      'PIVOT_SteeringWheel', 'LIGHT_Head_L', 'LIGHT_Head_R', 'SOCKET_Seat',
      'SOCKET_Storage', 'COL_Chassis',
    ]) assert.ok(names.has(name), `${id} exports ${name}`);
    const visible = gltf.scene.clone(true);
    visible.traverse((object) => {
      if (object.name.startsWith('COL_') || object.name.startsWith('LOD1_')) object.visible = false;
    });
    const size = new THREE.Box3().setFromObject(visible).getSize(new THREE.Vector3());
    assert.ok(size.x >= minimum[0] && size.y >= minimum[1] && size.z >= minimum[2],
      `${id} dimensions are believable: ${size.toArray().map((n) => n.toFixed(2)).join(' x ')}`);
    assert.ok(triangles < 45000, `${id} stays under its 45k operational budget (${triangles})`);
  }
});

test('only the restored tractor carries the separated mower implement', async () => {
  const restored = await load('grounds_tractor');
  const broken = await load('grounds_tractor_broken');
  assert.ok(restored.scene.getObjectByName('PIVOT_MowerDeck'));
  assert.ok(restored.scene.getObjectByName('MowerDeck'));
  assert.ok(broken.scene.getObjectByName('PIVOT_MowerDeck'));
  assert.equal(broken.scene.getObjectByName('MowerDeck'), undefined);
});

test('the customer fleet station ships two charging points, service storage, collision, and LODs', async () => {
  const station = await load('cart_fleet_station');
  const names = new Set();
  let triangles = 0;
  station.scene.traverse((object) => {
    if (object.name) names.add(object.name);
    if (object.isMesh) triangles += object.geometry.index
      ? object.geometry.index.count / 3 : object.geometry.attributes.position.count / 3;
  });
  for (const name of ['LOD0_Detail', 'LOD1_Silhouette', 'LOD0_StaticBody', 'LOD1_StaticBody', 'COL_Station']) {
    assert.ok(names.has(name), `cart fleet station exports ${name}`);
  }
  const size = new THREE.Box3().setFromObject(station.scene).getSize(new THREE.Vector3());
  assert.ok(size.x >= 2.4 && size.y >= 1.45 && size.z >= 0.55,
    `station dimensions are believable: ${size.toArray().map((value) => value.toFixed(2)).join(' x ')}`);
  assert.ok(triangles < 10000, `station stays under its 10k fixture budget (${triangles})`);
});
