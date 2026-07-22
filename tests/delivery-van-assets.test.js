// Asset Sheet 05, ref 41: production contract for the Pinehollow delivery van.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { auditGlb } from '../tools/qa/glb-audit.mjs';

const SPEC = Object.freeze({
  id: 'delivery_van', reference: '41', dimensions: Object.freeze([5.50, 2.40, 2.00]),
  budget: Object.freeze({ triangles: [5000, 20000], materials: [8, 12], textures: [0, 0], nodes: [90, 130] }),
});

let loaded;

function makeLoader() {
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'node-texture-stub', loadTexture: async () => new THREE.Texture() }));
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
      assert.ok(root, `${SPEC.id} exposes an exact named root`);
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

test('ref 41 van loads with exact original provenance, dimensions, and budgets', async () => {
  const { gltf, root, audit } = await loadAsset();
  const data = root.userData || {};
  assert.ok(gltf.scene);
  assert.equal(data.asset_id, SPEC.id);
  assert.equal(String(data.reference_id), SPEC.reference);
  assert.match(String(data.units || ''), /^(m|metres?|meters?)$/i);
  assert.deepEqual(Array.from(data.target_dimensions_m || [], Number), SPEC.dimensions);
  assert.match(String(data.source), /Original Pinehollow/i);
  assert.match(String(data.license), /Project-owned/i);
  assert.match(String(data.brand), /Pinehollow Golf/i);
  assert.equal(data.runtime_up_axis, '+Y');
  assert.match(String(data.runtime_axis_map), /Three\.js \+X,-Z,\+Y/);
  assert.equal(Number(data.cargo_socket_count), 6);
  const size = visibleBounds(root).getSize(new THREE.Vector3()).toArray();
  size.forEach((value, index) => assert.ok(
    Math.abs(value - SPEC.dimensions[index]) <= 0.008,
    `runtime axis ${index} is ${value.toFixed(5)}m instead of ${SPEC.dimensions[index]}m`,
  ));
  for (const metric of ['triangles', 'materials', 'textures', 'nodes']) {
    const [min, max] = SPEC.budget[metric];
    assert.ok(audit[metric] >= min && audit[metric] <= max,
      `${metric} ${audit[metric]} outside [${min}, ${max}]`);
  }
  assert.equal(audit.images, 0);
  assert.equal(audit.animations, 0);
  assert.equal(audit.cameras, 0);
  assert.equal(audit.lights, 0);
});

test('ref 41 preserves a real right-side opening and exercised sliding-door transform', async () => {
  const { root } = await loadAsset();
  const shell = exactNode(root, 'VAN_BODY_SHELL');
  assert.match(String(shell.userData.real_openings), /right sliding door/i);
  const pivot = exactNode(root, 'SLIDING_CARGO_DOOR_RIGHT_PIVOT');
  const panel = exactNode(root, 'SLIDING_CARGO_DOOR_RIGHT');
  assert.equal(panel.parent, pivot);
  assert.equal(pivot.userData.motion, 'slide');
  assert.equal(pivot.userData.slide_axis_blender, '+X');
  assert.equal(pivot.userData.slide_axis_runtime, '+X');
  assert.equal(Number(pivot.userData.travel_m), 1.32);
  assert.deepEqual(Array.from(pivot.userData.closed_position_runtime_m || [], Number), [0.52, 1.36, 0.92]);
  assert.equal(pivot.userData.pivot_exercise_passed, true);
  assert.equal(panel.userData.real_opening_behind, true);
  assert.equal(exactNode(root, 'RIGHT_DOOR_CREST_SHIELD').userData.external_artwork, false);
  assert.equal(exactNode(root, 'RIGHT_DOOR_BRAND').userData.component, 'project_owned_brand_wordmark');
  assert.equal(exactNode(root, 'RIGHT_DOOR_SLOGAN').userData.component, 'project_owned_slogan');
});

test('ref 41 rear doors retain outer hinge pivots and functional cargo openings', async () => {
  const { root } = await loadAsset();
  for (const [label, expectedZ] of [['LEFT', -0.835], ['RIGHT', 0.835]]) {
    const pivot = exactNode(root, `REAR_CARGO_DOOR_${label}_HINGE_PIVOT`);
    const panel = exactNode(root, `REAR_CARGO_DOOR_${label}`);
    assert.equal(panel.parent, pivot);
    assert.equal(pivot.userData.motion, 'hinge');
    assert.equal(pivot.userData.hinge_axis_blender, '+Z');
    assert.equal(pivot.userData.hinge_axis_runtime, '+Y');
    assert.equal(pivot.userData.pivot_exercise_passed, true);
    assert.equal(panel.userData.real_opening_behind, true);
    const world = pivot.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(world.x - 2.635) <= 0.0001);
    assert.ok(Math.abs(world.z - expectedZ) <= 0.0001, `${label} runtime hinge width coordinate`);
  }
});

test('ref 41 maintains four wheel spin pivots and front steering pivots at true centers', async () => {
  const { root } = await loadAsset();
  const positions = {
    FRONT_LEFT: [-1.72, 0.405, -0.91], FRONT_RIGHT: [-1.72, 0.405, 0.91],
    REAR_LEFT: [1.72, 0.405, -0.91], REAR_RIGHT: [1.72, 0.405, 0.91],
  };
  for (const [label, expected] of Object.entries(positions)) {
    const pivot = exactNode(root, `WHEEL_${label}_PIVOT`);
    const tire = exactNode(root, `WHEEL_${label}_TIRE`);
    assert.equal(tire.parent, pivot);
    assert.equal(pivot.userData.moving_part, true);
    assert.equal(pivot.userData.spin_axis_blender, '+Y');
    assert.equal(pivot.userData.pivot_exercise_passed, true);
    const center = pivot.getWorldPosition(new THREE.Vector3()).toArray();
    center.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 0.0001));
    assert.ok(tire.getWorldPosition(new THREE.Vector3()).distanceTo(pivot.getWorldPosition(new THREE.Vector3())) <= 0.0001);
  }
  for (const label of ['FRONT_LEFT', 'FRONT_RIGHT']) {
    const steer = exactNode(root, `WHEEL_${label}_STEER_PIVOT`);
    assert.equal(steer.userData.steer_axis_blender, '+Z');
    assert.equal(steer.userData.steer_axis_runtime, '+Y');
    assert.equal(steer.userData.pivot_exercise_passed, true);
  }
});

test('ref 41 exposes sockets, cargo openings, moving doors, glazing, and simple shell collisions', async () => {
  const { root } = await loadAsset();
  for (let index = 1; index <= 6; index += 1) {
    const socket = exactNode(root, `CARGO_BOX_SOCKET_${String(index).padStart(2, '0')}`);
    assert.equal(socket.userData.anchor_kind, 'delivery_box_socket');
    assert.equal(socket.userData.allowed_category, 'delivery_box');
    assert.ok(Number(socket.userData.max_w) > 0);
    assert.ok(Number(socket.userData.max_h) > 0);
  }
  assert.equal(exactNode(root, 'REAR_LOADING_ANCHOR').userData.anchor_kind, 'van_loading');
  assert.equal(exactNode(root, 'RIGHT_DOOR_LOADING_ANCHOR').userData.anchor_kind, 'van_side_loading');
  for (const name of [
    'WINDSHIELD_LEFT', 'WINDSHIELD_RIGHT', 'CAB_WINDOW_LEFT', 'CAB_WINDOW_RIGHT',
    'MIRROR_HOUSING_LEFT', 'MIRROR_HOUSING_RIGHT',
    'HEADLIGHT_LEFT', 'HEADLIGHT_RIGHT', 'TAIL_LIGHT_LEFT', 'TAIL_LIGHT_RIGHT',
  ]) assert.ok(exactNode(root, name).isMesh, `${name} is authored geometry`);
  assert.equal(root.getObjectByName('COL_VAN_CARGO_BODY'), undefined,
    'no solid collision volume seals the modeled cargo bay');
  for (const name of [
    'COL_VAN_CARGO_FLOOR', 'COL_VAN_CARGO_ROOF', 'COL_VAN_CARGO_LEFT_WALL',
    'COL_VAN_CARGO_RIGHT_FRONT_PILLAR', 'COL_VAN_CARGO_RIGHT_REAR_PILLAR',
    'COL_VAN_CAB', 'COL_VAN_NOSE',
    'COL_WHEEL_FRONT_LEFT', 'COL_WHEEL_FRONT_RIGHT', 'COL_WHEEL_REAR_LEFT', 'COL_WHEEL_REAR_RIGHT',
  ]) {
    const collision = exactNode(root, name);
    assert.equal(collision.userData.helper, true);
    assert.ok(trianglesOf(collision) <= 24, `${name} remains a simple convex box`);
  }
  const slidingCollision = exactNode(root, 'COL_SLIDING_CARGO_DOOR_RIGHT');
  assert.equal(slidingCollision.parent, exactNode(root, 'SLIDING_CARGO_DOOR_RIGHT_PIVOT'));
  for (const label of ['LEFT', 'RIGHT']) {
    const collision = exactNode(root, `COL_REAR_CARGO_DOOR_${label}`);
    assert.equal(collision.parent, exactNode(root, `REAR_CARGO_DOOR_${label}_HINGE_PIVOT`));
    assert.ok(trianglesOf(collision) <= 24);
  }
});
