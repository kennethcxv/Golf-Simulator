// Asset Sheet 05, ref 42: production contract for the manual delivery hand truck.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { auditGlb } from '../tools/qa/glb-audit.mjs';

const SPEC = Object.freeze({
  id: 'delivery_hand_truck',
  reference: '42',
  dimensions: Object.freeze([0.50, 1.20, 0.45]),
  budget: Object.freeze({ triangles: [1200, 9000], materials: [5, 8], textures: [0, 0], nodes: [45, 85] }),
});

let loaded;

function makeLoader() {
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'node-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader;
}

async function loadAsset() {
  if (!loaded) {
    loaded = (async () => {
      const url = new URL(`../vendor/models/clubhouse/${SPEC.id}.glb`, import.meta.url);
      const bytes = await readFile(url);
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const gltf = await new Promise((resolve, reject) => makeLoader().parse(data, '', resolve, reject));
      const root = gltf.scene.getObjectByName(SPEC.id);
      assert.ok(root, `${SPEC.id} exposes an exact named asset root`);
      return { gltf, root, audit: auditGlb(fileURLToPath(url)) };
    })();
  }
  return loaded;
}

function exactNode(root, name) {
  const object = root.getObjectByName(name);
  assert.ok(object, `${root.name} missing ${name}`);
  return object;
}

function visibleBounds(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry || object.name.startsWith('COL_')) return;
    object.geometry.computeBoundingBox?.();
    if (object.geometry.boundingBox) bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
  });
  return bounds;
}

function trianglesOf(object) {
  const count = object.geometry?.index?.count || object.geometry?.attributes?.position?.count || 0;
  return Math.floor(count / 3);
}

test('ref 42 hand truck loads with exact provenance, dimensions, and production budgets', async () => {
  const { gltf, root, audit } = await loadAsset();
  const data = root.userData || {};
  assert.ok(gltf.scene, 'Three.js scene exists');
  assert.equal(data.asset_id, SPEC.id);
  assert.equal(String(data.reference_id), SPEC.reference);
  assert.match(String(data.units || ''), /^(m|metres?|meters?)$/i);
  assert.deepEqual(Array.from(data.target_dimensions_m || [], Number), SPEC.dimensions);
  assert.ok(String(data.source || '').trim(), 'source provenance');
  assert.ok(String(data.license || '').trim(), 'license provenance');
  assert.equal(Number(data.rated_load_kg), 160);
  assert.match(String(data.moving_components), /WHEEL_LEFT_PIVOT/);

  const size = visibleBounds(root).getSize(new THREE.Vector3()).toArray();
  size.forEach((value, index) => assert.ok(
    Math.abs(value - SPEC.dimensions[index]) <= 0.006,
    `runtime axis ${index} is ${value.toFixed(5)}m instead of ${SPEC.dimensions[index]}m`,
  ));
  for (const metric of ['triangles', 'materials', 'textures', 'nodes']) {
    const [min, max] = SPEC.budget[metric];
    assert.ok(audit[metric] >= min && audit[metric] <= max,
      `${metric} ${audit[metric]} outside [${min}, ${max}]`);
  }
  assert.equal(audit.cameras, 0);
  assert.equal(audit.lights, 0);
  assert.equal(audit.animations, 0);
});

test('ref 42 preserves independent wheel pivots, true centers, and axle hierarchy', async () => {
  const { root } = await loadAsset();
  const axle = exactNode(root, 'AXLE_ASSEMBLY');
  assert.equal(axle.userData.pivot_role, 'axle_centerline');
  assert.equal(axle.userData.axis_blender, '+X');
  for (const [label, expectedX] of [['LEFT', -0.218], ['RIGHT', 0.218]]) {
    const pivot = exactNode(root, `WHEEL_${label}_PIVOT`);
    const tire = exactNode(root, `WHEEL_${label}_TIRE`);
    const hub = exactNode(root, `WHEEL_${label}_HUB`);
    assert.equal(pivot.parent, axle, `${pivot.name} belongs directly to axle assembly`);
    assert.equal(tire.parent, pivot);
    assert.equal(hub.parent, pivot);
    assert.equal(pivot.userData.moving_part, true);
    assert.equal(pivot.userData.pivot_exercise_passed, true);
    assert.equal(Number(pivot.userData.pivot_exercise_degrees), 37);
    assert.equal(pivot.userData.spin_axis_blender, '+X');
    const world = pivot.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(world.x - expectedX) <= 0.0001);
    assert.ok(Math.abs(world.y - 0.135) <= 0.0001, 'runtime wheel center is 13.5 cm high');
    assert.ok(Math.abs(world.z + 0.015) <= 0.0001, 'runtime depth preserves Blender +Y to glTF -Z');
    assert.ok(tire.getWorldPosition(new THREE.Vector3()).distanceTo(world) <= 0.0001);
  }
});

test('ref 42 keeps fixed handles at true grip centers and exposes functional anchors', async () => {
  const { root } = await loadAsset();
  const handles = exactNode(root, 'HANDLE_ASSEMBLY');
  assert.equal(handles.userData.motion, 'fixed');
  for (const label of ['LEFT', 'RIGHT']) {
    const pivot = exactNode(root, `HANDLE_${label}_PIVOT`);
    const grip = exactNode(root, `HANDLE_${label}_GRIP`);
    const anchor = exactNode(root, `HAND_GRIP_${label}`);
    assert.equal(pivot.userData.pivot_role, 'true_grip_center');
    assert.equal(grip.parent, pivot);
    assert.equal(anchor.userData.anchor_kind, 'hand_grip');
    assert.equal(Number(anchor.userData.grip_length_m), 0.16);
    assert.ok(grip.getWorldPosition(new THREE.Vector3()).distanceTo(pivot.getWorldPosition(new THREE.Vector3())) <= 0.0001);
  }
  assert.equal(exactNode(root, 'LOAD_ORIGIN').userData.anchor_kind, 'load_origin');
  assert.equal(exactNode(root, 'INTERACTION_TARGET').userData.anchor_kind, 'hand_truck_interaction');
  assert.equal(exactNode(root, 'CENTER_OF_MASS').userData.anchor_kind, 'center_of_mass');
});

test('ref 42 retains load structure, softened meshes, UVs, and simple collision pieces', async () => {
  const { root } = await loadAsset();
  const plate = exactNode(root, 'LOAD_PLATE');
  assert.equal(plate.userData.component, 'load_plate');
  assert.equal(Number(plate.userData.rated_load_kg), 160);
  assert.deepEqual(Array.from(plate.userData.load_surface_dimensions_m || [], Number), [0.5, 0.4]);
  assert.deepEqual(Array.from(plate.userData.centered_carton_dimensions_m || [], Number), [0.6, 0.4]);
  assert.equal(Number(plate.userData.maximum_side_overhang_each_m), 0.05);
  const plateSize = new THREE.Box3().setFromObject(plate).getSize(new THREE.Vector3()).toArray();
  assert.ok(Math.abs(plateSize[0] - 0.50) <= 0.002, `plate width ${plateSize[0]}`);
  assert.ok(Math.abs(plateSize[2] - 0.40) <= 0.002, `plate depth ${plateSize[2]}`);
  const load = exactNode(root, 'LOAD_ORIGIN');
  assert.deepEqual(load.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))), [0, 0.026, 0.12]);
  assert.equal(Number(load.userData.max_load_width_m), 0.60);
  assert.equal(Number(load.userData.max_load_depth_m), 0.40);
  assert.equal(Number(load.userData.plate_width_m), 0.50);
  assert.equal(Number(load.userData.plate_depth_m), 0.40);
  assert.equal(Number(load.userData.maximum_side_overhang_each_m), 0.05);
  assert.equal(load.userData.centered_load, true);
  for (let index = 1; index <= 4; index += 1) {
    const crossbar = exactNode(root, `FRAME_CROSSBAR_${String(index).padStart(2, '0')}`);
    assert.ok(crossbar.isMesh);
    assert.ok(crossbar.geometry.attributes.normal);
    assert.ok(crossbar.geometry.attributes.uv);
  }
  for (const name of [
    'COL_HAND_TRUCK_FRAME', 'COL_HAND_TRUCK_LOAD_PLATE',
    'COL_HAND_TRUCK_WHEEL_LEFT', 'COL_HAND_TRUCK_WHEEL_RIGHT',
  ]) {
    const collision = exactNode(root, name);
    assert.ok(collision.isMesh);
    assert.equal(collision.userData.helper, true);
    assert.ok(trianglesOf(collision) <= 24, `${name} remains a simplified convex box`);
  }
  const plateCollision = exactNode(root, 'COL_HAND_TRUCK_LOAD_PLATE');
  const collisionSize = new THREE.Box3().setFromObject(plateCollision).getSize(new THREE.Vector3()).toArray();
  assert.ok(Math.abs(collisionSize[0] - 0.50) <= 0.002);
  assert.ok(Math.abs(collisionSize[2] - 0.40) <= 0.002);
});
