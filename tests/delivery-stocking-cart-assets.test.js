// Asset Sheet 05, ref 43: production contract for the stocking cart GLB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { auditGlb } from '../tools/qa/glb-audit.mjs';

const SPEC = Object.freeze({
  id: 'delivery_stocking_cart',
  reference: '43',
  dimensions: Object.freeze([1.00, 0.95, 0.50]),
  budget: Object.freeze({
    triangles: Object.freeze([4000, 12000]),
    materials: Object.freeze([6, 9]),
    textures: Object.freeze([0, 0]),
    nodes: Object.freeze([70, 100]),
  }),
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

function directChild(parent, name) {
  const child = exactNode(parent, name);
  assert.equal(child.parent, parent, `${name} must be parented directly to ${parent.name}`);
  return child;
}

function isHelper(object) {
  return object.name.startsWith('COL_') || object.userData?.helper === true;
}

function visibleBounds(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry || isHelper(object)) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
  });
  return bounds;
}

function trianglesOf(object) {
  let triangles = 0;
  object.traverse((candidate) => {
    if (!candidate.isMesh || !candidate.geometry) return;
    const count = candidate.geometry.index?.count
      || candidate.geometry.attributes.position?.count
      || 0;
    triangles += Math.floor(count / 3);
  });
  return triangles;
}

test('ref 43 stocking cart loads with exact provenance, scale, and budgets', async () => {
  const { gltf, root, audit } = await loadAsset();
  const data = root.userData || {};
  assert.ok(gltf.scene, 'Three.js scene exists');
  assert.equal(data.asset_id, SPEC.id);
  assert.equal(String(data.reference_id), SPEC.reference);
  assert.match(String(data.units || ''), /^(m|metres?|meters?)$/i);
  assert.deepEqual(Array.from(data.target_dimensions_m || [], Number), SPEC.dimensions);
  assert.equal(Number(data.shelf_count), 3);
  assert.equal(Number(data.caster_count), 4);
  assert.equal(data.runtime_up_axis, '+Y');
  assert.match(String(data.runtime_axis_map), /Three\.js \+X,-Z,\+Y/);
  assert.ok(String(data.source || '').trim(), 'source provenance');
  assert.ok(String(data.license || '').trim(), 'license provenance');

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

  root.traverse((object) => {
    if (!object.isMesh || isHelper(object)) return;
    assert.ok(object.geometry.attributes.normal, `${object.name} has normals`);
    assert.ok(object.geometry.attributes.uv, `${object.name} has UVs`);
    assert.ok(Math.abs(object.scale.x - 1) < 1e-5, `${object.name} applied X scale`);
    assert.ok(Math.abs(object.scale.y - 1) < 1e-5, `${object.name} applied Y scale`);
    assert.ok(Math.abs(object.scale.z - 1) < 1e-5, `${object.name} applied Z scale`);
  });
});

test('ref 43 preserves three lipped shelves and six bounded stock sockets', async () => {
  const { root } = await loadAsset();
  for (const label of ['LOWER', 'MIDDLE', 'TOP']) {
    const shelf = exactNode(root, `SHELF_${label}`);
    assert.equal(shelf.userData.component, 'stocking_shelf');
    directChild(shelf, `SHELF_BASE_${label}`);
    directChild(shelf, `SHELF_INSET_${label}`);
    for (const edge of ['FRONT', 'BACK', 'REAR', 'NOSE']) {
      const rail = directChild(shelf, `SHELF_RAIL_${label}_${edge}`);
      assert.equal(rail.userData.structural_role, 'tray_retaining_rail');
    }
  }

  const locations = new Set();
  for (let index = 1; index <= 6; index += 1) {
    const socket = exactNode(root, `STOCK_SOCKET_${String(index).padStart(2, '0')}`);
    const data = socket.userData || {};
    assert.equal(data.anchor_kind, 'stocking_cart_item_socket');
    assert.equal(data.allowed_category, 'delivery_goods');
    assert.ok(Number(data.max_w) > 0 && Number(data.max_d) > 0 && Number(data.max_h) > 0);
    assert.ok(Number.isInteger(Number(data.shelf)));
    assert.ok(Number.isInteger(Number(data.stack_order)));
    assert.equal(data.occupancy, 'empty');
    const key = socket.getWorldPosition(new THREE.Vector3()).toArray().map((v) => v.toFixed(3)).join('|');
    assert.ok(!locations.has(key), `${socket.name} uses a distinct shelf position`);
    locations.add(key);
  }
  const topBox = exactNode(root, 'STOCK_BOX_SOCKET_TOP');
  assert.equal(topBox.userData.anchor_kind, 'stocking_cart_box_socket');
  assert.equal(topBox.userData.allowed_category, 'delivery_box');
  assert.deepEqual(
    [topBox.userData.max_w, topBox.userData.max_d, topBox.userData.max_h].map(Number),
    [0.62, 0.42, 0.50],
  );
  assert.equal(topBox.userData.conflicts_with, 'STOCK_SOCKET_05,STOCK_SOCKET_06');
  assert.equal(topBox.userData.exclusive_group, 'stocking_cart_top_deck');
  for (const id of ['STOCK_SOCKET_05', 'STOCK_SOCKET_06']) {
    assert.equal(exactNode(root, id).userData.conflicts_with, 'STOCK_BOX_SOCKET_TOP');
  }
  assert.deepEqual(
    topBox.getWorldPosition(new THREE.Vector3()).toArray().map((value) => Number(value.toFixed(3))),
    [0, 0.803, 0],
  );
});

test('ref 43 keeps four articulated caster and wheel pivots with rear brakes', async () => {
  const { root } = await loadAsset();
  for (const label of ['REAR_LEFT', 'REAR_RIGHT', 'FRONT_LEFT', 'FRONT_RIGHT']) {
    const swivel = exactNode(root, `CASTER_SWIVEL_${label}`);
    assert.equal(swivel.isMesh, undefined, `${swivel.name} is a transform pivot`);
    assert.equal(swivel.userData.component, 'caster_swivel_pivot');
    assert.equal(swivel.userData.pivot_axis, 'local_Z');
    assert.equal(swivel.userData.pivot_axis_runtime, 'local_Y');

    const axle = directChild(swivel, `CASTER_AXLE_${label}`);
    assert.equal(axle.isMesh, undefined, `${axle.name} is a transform pivot`);
    assert.equal(axle.userData.component, 'wheel_axle_pivot');
    assert.equal(axle.userData.pivot_axis, 'local_Y');
    assert.equal(axle.userData.pivot_axis_runtime, 'local_-Z');
    assert.ok(Number(axle.userData.wheel_radius_m) > 0.05);
    assert.ok(directChild(axle, `CASTER_WHEEL_${label}`).isMesh);
    assert.ok(directChild(axle, `CASTER_HUB_${label}`).isMesh);

    directChild(swivel, `CASTER_YOKE_${label}`);
    directChild(swivel, `CASTER_YOKE_ARM_${label}_LEFT`);
    directChild(swivel, `CASTER_YOKE_ARM_${label}_RIGHT`);
  }
  for (const label of ['REAR_LEFT', 'REAR_RIGHT']) {
    const swivel = exactNode(root, `CASTER_SWIVEL_${label}`);
    const brake = directChild(swivel, `CASTER_BRAKE_PIVOT_${label}`);
    assert.equal(brake.isMesh, undefined, `${brake.name} is a transform pivot`);
    assert.equal(brake.userData.component, 'caster_brake_hinge');
    assert.equal(brake.userData.pivot_axis, 'local_Y');
    assert.equal(brake.userData.pivot_axis_runtime, 'local_-Z');
    assert.ok(directChild(brake, `CASTER_BRAKE_PEDAL_${label}`).isMesh);
  }
});

test('ref 43 exposes the handle hinge, project badge, interactions, and simple collisions', async () => {
  const { root } = await loadAsset();
  const handle = exactNode(root, 'HANDLE_PIVOT');
  assert.equal(handle.isMesh, undefined, 'handle pivot is a transform');
  assert.equal(handle.userData.component, 'push_handle_hinge');
  assert.equal(handle.userData.pivot_axis, 'local_Y');
  assert.equal(handle.userData.pivot_axis_runtime, 'local_-Z');
  assert.ok(directChild(handle, 'HANDLE_GRIP').isMesh);
  assert.equal(directChild(handle, 'PUSH_GRIP_TARGET').userData.anchor_kind, 'stocking_cart_push_grip');

  const badge = exactNode(root, 'BRAND_BADGE');
  assert.equal(badge.userData.component, 'project_brand_mark');
  assert.ok(directChild(badge, 'BRAND_BADGE_PLATE').isMesh);
  assert.equal(exactNode(root, 'INTERACTION_TARGET').userData.anchor_kind, 'stocking_cart_interaction');

  for (const name of ['COL_CART_BODY', 'COL_CART_HANDLE']) {
    const collision = exactNode(root, name);
    assert.ok(collision.isMesh);
    assert.equal(collision.userData.helper, true);
    assert.ok(trianglesOf(collision) <= 24, `${name} remains a simplified collision box`);
  }
});
