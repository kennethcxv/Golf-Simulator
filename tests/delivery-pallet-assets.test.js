// Asset Sheet 05, ref 44: production contract for the wooden delivery pallet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { auditGlb } from '../tools/qa/glb-audit.mjs';

const SPEC = Object.freeze({
  id: 'delivery_wooden_pallet',
  reference: '44',
  dimensions: Object.freeze([1.20, 0.14, 1.00]),
  budget: Object.freeze({ triangles: [500, 5000], materials: [3, 8], textures: [0, 0], nodes: [35, 60] }),
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

test('ref 44 pallet loads with exact provenance, dimensions, and production budgets', async () => {
  const { gltf, root, audit } = await loadAsset();
  const data = root.userData || {};
  assert.ok(gltf.scene, 'Three.js scene exists');
  assert.equal(data.asset_id, SPEC.id);
  assert.equal(String(data.reference_id), SPEC.reference);
  assert.match(String(data.units || ''), /^(m|metres?|meters?)$/i);
  assert.deepEqual(Array.from(data.target_dimensions_m || [], Number), SPEC.dimensions);
  assert.ok(String(data.source || '').trim(), 'source provenance');
  assert.ok(String(data.license || '').trim(), 'license provenance');
  assert.equal(data.rated_box_slots, 6);

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
});

test('ref 44 preserves seven authored deck boards, wear, grain, and fasteners', async () => {
  const { root } = await loadAsset();
  const deck = exactNode(root, 'PALLET_DECK');
  for (let index = 1; index <= 7; index += 1) {
    const board = exactNode(root, `TOP_BOARD_${String(index).padStart(2, '0')}`);
    assert.equal(board.parent, deck, `${board.name} belongs directly to PALLET_DECK`);
    assert.ok(board.isMesh);
    assert.ok(board.geometry.attributes.normal);
    assert.ok(board.geometry.attributes.uv);
  }
  const nails = exactNode(root, 'NAILS');
  assert.ok(nails.isMesh);
  assert.equal(Number(nails.userData.fastener_count), 42, 'two nail heads at three supports on seven boards');
  assert.equal(String(nails.userData.fastener_kind), 'inset_darkened_nail_head');
  assert.ok(exactNode(root, 'WEAR_MARKS').isMesh);
  assert.ok(exactNode(root, 'END_GRAIN_MARKS').isMesh);
});

test('ref 44 keeps load blocks, runners, and two functional fork channels', async () => {
  const { root } = await loadAsset();
  for (const label of ['LEFT', 'CENTER', 'RIGHT']) {
    const group = exactNode(root, `STRINGER_GROUP_${label}`);
    for (const name of [
      `STRINGER_CAP_${label}`,
      `LOWER_BOARD_${label}`,
      `BLOCK_${label}_FRONT`,
      `BLOCK_${label}_CENTER`,
      `BLOCK_${label}_BACK`,
    ]) assert.equal(exactNode(root, name).parent, group, `${name} remains in ${group.name}`);
  }

  for (const label of ['LEFT', 'RIGHT']) {
    const channel = exactNode(root, `FORK_CHANNEL_${label}`);
    assert.equal(channel.userData.anchor_kind, 'fork_channel');
    assert.ok(Number(channel.userData.clear_width_m) >= 0.29);
    assert.ok(Number(channel.userData.clear_height_m) >= 0.09);
    assert.match(String(channel.userData.channel_axis), /Y/i);
  }
  assert.equal(exactNode(root, 'PALLET_JACK_ENTRY').userData.anchor_kind, 'pallet_jack_entry');
});

test('ref 44 exposes six bounded delivery sockets and simplified collision pieces', async () => {
  const { root } = await loadAsset();
  const seen = new Set();
  for (let index = 1; index <= 6; index += 1) {
    const socket = exactNode(root, `DELIVERY_SOCKET_${String(index).padStart(2, '0')}`);
    assert.equal(socket.userData.anchor_kind, 'delivery_box_socket');
    assert.equal(socket.userData.allowed_category, 'delivery_box');
    assert.ok(Number(socket.userData.max_w) > 0);
    assert.ok(Number(socket.userData.max_d) > 0);
    assert.ok(Number(socket.userData.max_h) > 0);
    const key = `${socket.position.x.toFixed(3)}|${socket.position.z.toFixed(3)}`;
    assert.ok(!seen.has(key), `${socket.name} has a distinct deck location`);
    seen.add(key);
  }
  assert.equal(exactNode(root, 'INTERACTION_TARGET').userData.anchor_kind, 'pallet_interaction');
  for (const name of ['COL_PALLET', 'COL_PALLET_LEFT', 'COL_PALLET_CENTER', 'COL_PALLET_RIGHT']) {
    const collision = exactNode(root, name);
    assert.ok(collision.isMesh);
    assert.equal(collision.userData.helper, true);
    assert.ok(trianglesOf(collision) <= 24, `${name} remains a simplified collision box`);
  }
});
