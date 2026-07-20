// Asset Sheet 05, ref 45: production contract for the delivery pallet jack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { auditGlb } from '../tools/qa/glb-audit.mjs';

const SPEC = Object.freeze({
  id: 'delivery_pallet_jack',
  reference: '45',
  // Three.js is Y-up: 1.55 m length X, 1.20 m height Y, .70 m width Z.
  dimensions: Object.freeze([1.55, 1.20, 0.70]),
  budget: Object.freeze({
    triangles: Object.freeze([2000, 10000]),
    materials: Object.freeze([6, 9]),
    textures: Object.freeze([0, 0]),
    nodes: Object.freeze([55, 80]),
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

function isHelper(object) {
  return /^COL(?:_|LISION_)/.test(String(object?.name || ''));
}

function visibleBounds(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry || isHelper(object)) return;
    object.geometry.computeBoundingBox?.();
    if (object.geometry.boundingBox) {
      bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return bounds;
}

function trianglesOf(object) {
  const count = object.geometry?.index?.count || object.geometry?.attributes?.position?.count || 0;
  return Math.floor(count / 3);
}

test('ref 45 pallet jack loads with exact provenance, dimensions, and production budgets', async () => {
  const { gltf, root, audit } = await loadAsset();
  const data = root.userData || {};
  assert.ok(gltf.scene, 'Three.js scene exists');
  assert.equal(data.asset_id, SPEC.id);
  assert.equal(String(data.reference_id), SPEC.reference);
  assert.match(String(data.units || ''), /^(m|metres?|meters?)$/i);
  assert.deepEqual(Array.from(data.target_dimensions_m || [], Number), SPEC.dimensions);
  assert.match(String(data.source || ''), /original|pinehollow|in-repository/i);
  assert.match(String(data.license || ''), /project-owned|unlicensed/i);
  assert.equal(Number(data.rated_capacity_kg), 2000);
  assert.equal(data.paint_finish, 'restrained industrial safety yellow painted steel');
  assert.equal(data.paint_color_name, 'industrial safety yellow');
  assert.deepEqual(Array.from(data.paint_base_color_linear_rgba || [], Number), [0.58, 0.36, 0.01, 1]);
  assert.deepEqual(Array.from(data.paint_dark_color_linear_rgba || [], Number), [0.2, 0.095, 0.003, 1]);
  assert.equal(String(data.external_assets), 'none');
  assert.equal(String(data.external_textures), 'none');
  assert.equal(data.runtime_up_axis, '+Y');
  assert.match(String(data.runtime_axis_map), /Three\.js \+X,-Z,\+Y/);

  const size = visibleBounds(root).getSize(new THREE.Vector3()).toArray();
  size.forEach((value, index) => assert.ok(
    Math.abs(value - SPEC.dimensions[index]) <= 0.004,
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
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(Math.abs(object.scale[axis] - 1) < 1e-5, `${object.name} applied ${axis} scale`);
    }
  });
});

test('ref 45 keeps two tapered load forks and rollers on the hydraulic lift slide', async () => {
  const { root } = await loadAsset();
  const lift = exactNode(root, 'FORK_LIFT_SLIDE');
  const frame = exactNode(root, 'FORK_FRAME');
  assert.equal(frame.parent, lift);
  assert.equal(lift.userData.component, 'hydraulic_lift_carriage');
  assert.equal(lift.userData.motion_axis, '+Z');
  assert.equal(lift.userData.motion_axis_runtime, '+Y');
  assert.ok(Number(lift.userData.maximum_z_m) > Number(lift.userData.minimum_z_m));

  for (const label of ['LEFT', 'RIGHT']) {
    const fork = exactNode(root, `FORK_${label}`);
    const pivot = exactNode(root, `LOAD_WHEEL_PIVOT_${label}`);
    const wheel = exactNode(root, `LOAD_WHEEL_${label}`);
    assert.equal(fork.parent, frame);
    assert.equal(fork.material.name, 'M_PalletJackSafetyYellow');
    assert.equal(fork.userData.component, 'load_fork');
    assert.ok(Number(fork.userData.fork_length_m) >= 1.13);
    assert.equal(pivot.parent, frame);
    assert.equal(wheel.parent, pivot);
    assert.match(String(pivot.userData.rotation_axis), /Y/);
    assert.equal(pivot.userData.rotation_axis_runtime, '+/-Z');
    assert.equal(Number(pivot.userData.wheel_radius_m), 0.034);
    assert.equal(Number(fork.userData.insertion_section_height_m), 0.05);
    assert.equal(Number(fork.userData.compatible_runner_gap_m), 0.073);
    assert.ok(Number(fork.userData.minimum_runner_clearance_m) >= 0.008);
    exactNode(root, `FORK_WEAR_PAD_${label}`);
    exactNode(root, `FORK_SAFETY_INLAY_${label}`);
  }
  const coupling = exactNode(root, 'PALLET_COUPLING_SOCKET');
  assert.equal(coupling.userData.anchor_kind, 'pallet_coupling');
  assert.equal(coupling.userData.target_semantics, 'pallet_center');
  assert.equal(coupling.userData.approach_anchor, 'PALLET_JACK_ENTRY');
  assert.deepEqual(
    coupling.getWorldPosition(new THREE.Vector3()).toArray().map((value) => Number(value.toFixed(3))),
    [-0.275, 0.078, 0],
  );
});

test('ref 45 preserves true steering, handle, and wheel pivots as separate components', async () => {
  const { root } = await loadAsset();
  const steering = exactNode(root, 'STEERING_YAW_PIVOT');
  const handle = exactNode(root, 'HANDLE_TILT_PIVOT');
  assert.equal(steering.parent, root);
  assert.equal(steering.userData.rotation_axis, '+Z');
  assert.equal(steering.userData.rotation_axis_runtime, '+Y');
  assert.deepEqual(Array.from(steering.userData.steering_range_degrees || [], Number), [-105, 105]);
  assert.equal(handle.parent, steering);
  assert.match(String(handle.userData.rotation_axis), /Y/);
  assert.equal(handle.userData.rotation_axis_runtime, '+/-Z');
  assert.deepEqual(Array.from(handle.userData.working_range_degrees || [], Number), [-52, 18]);
  assert.equal(exactNode(root, 'HANDLE_STEM').parent, handle);
  assert.equal(exactNode(root, 'HANDLE_GRIP').parent, handle);
  assert.equal(exactNode(root, 'HANDLE_GRIP_TARGET').parent, handle);

  for (const label of ['LEFT', 'RIGHT']) {
    const pivot = exactNode(root, `STEER_WHEEL_PIVOT_${label}`);
    const wheel = exactNode(root, `STEER_WHEEL_${label}`);
    assert.equal(pivot.parent, steering);
    assert.equal(wheel.parent, pivot);
    assert.match(String(pivot.userData.rotation_axis), /Y/);
    assert.equal(pivot.userData.rotation_axis_runtime, '+/-Z');
    assert.equal(Number(pivot.userData.wheel_radius_m), 0.1);
    exactNode(root, `STEER_WHEEL_HUB_${label}`);
    exactNode(root, `STEER_WHEEL_HUBCAP_${label}`);
  }
});

test('ref 45 exposes a serviceable hydraulic unit, controls, and interaction anchors', async () => {
  const { root } = await loadAsset();
  const power = exactNode(root, 'HYDRAULIC_POWER_UNIT');
  assert.equal(power.userData.serviceable, true);
  for (const name of [
    'PUMP_HOUSING', 'PUMP_HOUSING_SHADOW', 'HYDRAULIC_RAM', 'HYDRAULIC_RAM_CAP',
    'PRESSURE_RELEASE_VALVE', 'RELEASE_CONTROL_ROD', 'RELEASE_CONTROL_PADDLE',
    'PARKING_SKID', 'BRAND_PLATE', 'BRAND_MONOGRAM',
  ]) exactNode(root, name);
  assert.equal(exactNode(root, 'INTERACTION_TARGET').userData.anchor_kind, 'pallet_jack_interaction');
  assert.equal(exactNode(root, 'HANDLE_GRIP_TARGET').userData.anchor_kind, 'operator_grip');
  assert.equal(exactNode(root, 'FORK_LOAD_CONTACT_LEFT').userData.anchor_kind, 'fork_load_contact');
  assert.equal(exactNode(root, 'FORK_LOAD_CONTACT_RIGHT').userData.anchor_kind, 'fork_load_contact');
  assert.equal(exactNode(root, 'FLOOR_CONTACT').userData.anchor_kind, 'floor_contact');
});

test('ref 45 exports clearance-safe collision proxies under their moving pivots', async () => {
  const { root } = await loadAsset();
  const group = exactNode(root, 'COLLISION_PROXIES');
  assert.equal(group.userData.helper, true);
  assert.equal(group.userData.registry_only, true);
  for (const name of ['COL_FORK_LEFT', 'COL_FORK_RIGHT', 'COL_POWER_UNIT', 'COL_HANDLE']) {
    const collision = exactNode(root, name);
    assert.ok(collision.isMesh);
    assert.equal(collision.userData.helper, true);
    assert.equal(collision.userData.collision_proxy, true);
    assert.ok(trianglesOf(collision) <= 24, `${name} remains a simple collision box`);
  }
  const frame = exactNode(root, 'FORK_FRAME');
  for (const name of ['COL_FORK_LEFT', 'COL_FORK_RIGHT']) {
    const collision = exactNode(root, name);
    assert.equal(collision.parent, frame);
    assert.equal(collision.userData.follows_pivot, 'FORK_LIFT_SLIDE');
    const size = new THREE.Box3().setFromObject(collision).getSize(new THREE.Vector3()).toArray();
    assert.ok(Math.abs(size[1] - 0.060) <= 0.002, `${name} proxy height ${size[1]}`);
    assert.ok(Math.abs(size[2] - 0.136) <= 0.002, `${name} proxy width ${size[2]}`);
    assert.ok(size[1] < 0.073, `${name} clears the Ref 44 runner gap`);
    assert.ok(size[2] <= 0.140, `${name} clears the Ref 44 fork channel width`);
  }
  assert.equal(exactNode(root, 'COL_POWER_UNIT').parent, exactNode(root, 'HYDRAULIC_POWER_UNIT'));
  assert.equal(exactNode(root, 'COL_HANDLE').parent, exactNode(root, 'HANDLE_TILT_PIVOT'));
  assert.equal(exactNode(root, 'COL_HANDLE').userData.follows_pivots,
    'STEERING_YAW_PIVOT,HANDLE_TILT_PIVOT');
});
