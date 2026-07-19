import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { resolveAuthoredFixtureSlot } from '../src/render3d/clubhouse.js';
import { MOVABLE_FIXTURE_CORE_MODELS } from '../src/render3d/clubhouse/fixtureCoreBatching.js';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { commitPlacement, placedFixtures } from '../src/sim/layout.js';
import { pickFromShelf } from '../src/sim/checkout.js';

const fixtureSource = readFileSync(new URL('../src/render3d/clubhouse/fixtures.js', import.meta.url), 'utf8');
const clubhouseSource = readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');
const merchSource = readFileSync(new URL('../src/render3d/clubhouse/merch.js', import.meta.url), 'utf8');

function loadBinaryGltf(relativeUrl) {
  const bytes = readFileSync(new URL(relativeUrl, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
}

test('Asset 20 runtime replaces one matching fallback with one authored module', () => {
  const start = fixtureSource.indexOf('function railUnit');
  const end = fixtureSource.indexOf('function hatstandUnit', start);
  const railUnit = fixtureSource.slice(start, end);
  assert.ok(start >= 0 && end > start, 'railUnit source is present');
  assert.equal([...railUnit.matchAll(/model: 'apparel_wall'/g)].length, 1);
  assert.ok(MOVABLE_FIXTURE_CORE_MODELS.includes('apparel_wall'));
  assert.doesNotMatch(railUnit, /const modules|m\.position\.x/, 'no duplicated module offsets');
  assert.match(railUnit, /fixtureRect\(f\)/, 'collider derives from the layout footprint');
});

test('jacket stock uses authored hanging/folded models and resolves both bake and flight slots', () => {
  assert.match(clubhouseSource, /checkout_product_hanging_jacket/);
  assert.match(clubhouseSource, /checkout_product_folded_jacket/);
  assert.match(
    clubhouseSource,
    /function bakeStockGroup\(group\)[\s\S]*?merch\.bake\(group, \{ visibleOnly: true \}\)/,
    'stock batching preserves hidden collision/helper visibility',
  );
  assert.equal(
    [...clubhouseSource.matchAll(/\.map\(\(slot\) => resolveAuthoredFixtureSlot\(anchor, slot\)\)/g)].length,
    2,
    'stock rebuild and stock flight both use the authored socket resolver',
  );
});

test('authored hanging jacket keeps a finite hook-root transform through the runtime loader', async () => {
  const gltf = await loadBinaryGltf('../vendor/models/clubhouse/checkout_product_hanging_jacket.glb');
  const root = gltf.scene.getObjectByName('checkout_product_hanging_jacket');
  assert.ok(root, 'hanging jacket root is named');
  assert.equal(root.userData.pivot, undefined, 'reserved numeric pivot metadata is not repurposed');
  assert.equal(root.userData.pivot_description, 'hanger hook / rail contact at local origin');
  assert.ok(root.position.toArray().every(Number.isFinite), 'root translation is finite');
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    assert.equal(object.userData.pivot, undefined, `${object.name} does not repurpose reserved pivot metadata`);
    assert.ok(object.matrixWorld.elements.every(Number.isFinite), `${object.name} world matrix is finite`);
  });
});

test('Asset 21 uses a compact authored polo with stable hook pivot and readable garment parts', async () => {
  assert.match(clubhouseSource, /checkout_product_hanging_polo/);
  assert.match(merchSource, /'checkout_product_hanging_polo'/, 'runtime preload owns the authored polo');
  const gltf = await loadBinaryGltf('../vendor/models/clubhouse/checkout_product_hanging_polo.glb');
  const root = gltf.scene.getObjectByName('checkout_product_hanging_polo');
  assert.ok(root, 'hanging polo root is named');
  assert.equal(root.userData.asset_version, 3);
  assert.equal(root.userData.pivot, undefined, 'reserved numeric pivot metadata is not repurposed');
  assert.equal(root.userData.pivot_description, 'hanger hook / waterfall-arm contact at local origin');
  for (const name of [
    'HangingPoloBody', 'HangingPoloCollar_L', 'HangingPoloCollar_R',
    'HangingPoloPlacket', 'HangingPoloHanger', 'HangingPoloHook',
    'HANGER_SOCKET', 'COL_HangingPolo',
  ]) {
    assert.ok(root.getObjectByName(name), `${name} survives GLB export`);
  }
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    assert.ok(object.matrixWorld.elements.every(Number.isFinite), `${object.name} world matrix is finite`);
  });
});

test('authored socket resolution returns anchor-local coordinates without mutating fallback data', () => {
  const world = new THREE.Group();
  world.position.set(7, 2, -3);
  world.rotation.y = 0.37;
  const anchor = new THREE.Group();
  anchor.position.set(-1, 0.4, 2);
  anchor.rotation.y = -0.72;
  world.add(anchor);
  const model = new THREE.Group();
  model.position.set(0.2, 0.4, -0.3);
  model.rotation.y = Math.PI / 2;
  anchor.add(model);
  const socket = new THREE.Object3D();
  socket.name = 'APPAREL_FOLD_SLOT_01';
  socket.position.set(0.1, 0.2, 0.3);
  model.add(socket);

  const fallback = Object.freeze({
    x: -0.27, y: 0.332, z: 0.03, folded: true,
    socketName: socket.name, tint: 0x365f85,
  });
  const resolved = resolveAuthoredFixtureSlot(anchor, fallback);
  assert.notEqual(resolved, fallback);
  assert.ok(new THREE.Vector3(resolved.x, resolved.y, resolved.z)
    .distanceTo(new THREE.Vector3(0.5, 0.6, -0.4)) < 1e-9);
  assert.deepEqual(fallback, {
    x: -0.27, y: 0.332, z: 0.03, folded: true,
    socketName: socket.name, tint: 0x365f85,
  });
  const missing = { x: 1, y: 2, z: 3, socketName: 'ABSENT' };
  assert.equal(resolveAuthoredFixtureSlot(anchor, missing), missing, 'missing socket preserves fallback identity');
});

test('Asset 20 inventory and moved fixture identity survive save/load recovery', () => {
  const state = newGame('relaxed', 20260717);
  state.shop.inventory.jacket2.shelf = 8;
  state.shop.inventory.jacket2.back = 3;
  commitPlacement(state, 'rail_outer', -2.15, 1.35, Math.PI / 2);
  const moved = structuredClone(state.shop.layout.moved.rail_outer);
  assert.deepEqual(pickFromShelf(state, 'jacket2', 'asset20-held'), { ok: true });
  assert.equal(state.shop.inventory.jacket2.shelf, 7);

  const loaded = deserialize(serialize(state));
  assert.equal(loaded.shop.inventory.jacket2.shelf, 8, 'held unit returns to its display');
  assert.equal(loaded.shop.inventory.jacket2.back, 3);
  assert.deepEqual(loaded.shop.held, []);
  assert.deepEqual(loaded.shop.layout.moved.rail_outer, moved);
  const rail = placedFixtures(loaded).find((fixture) => fixture.id === 'rail_outer');
  assert.equal(rail.kind, 'rail');
  assert.deepEqual(rail.skus, ['jacket2']);
  assert.deepEqual({ x: rail.x, z: rail.z, ry: rail.ry }, moved);
});
