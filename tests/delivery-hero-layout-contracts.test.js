import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { auditGlb } from '../tools/qa/glb-audit.mjs';
import {
  PACKAGING_LAYOUTS,
  PACKAGING_SHELLS,
  PRODUCT_PACKAGING,
} from '../src/data/productPackaging.js';

const ASSETS = Object.freeze({
  delivery_generic_merchandise_box: Object.freeze({
    layouts: Object.freeze(['CAP_NEST8']),
    legacyCapacity: 8,
  }),
  delivery_apparel_box: Object.freeze({
    layouts: Object.freeze(['APPAREL8', 'FLAT8']),
    legacyCapacity: 8,
  }),
  delivery_golf_club_box: Object.freeze({
    layouts: Object.freeze(['CLUB2']),
    legacyCapacity: 2,
  }),
});

function makeLoader() {
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'node-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader;
}

const cache = new Map();

function loadAsset(modelId) {
  if (!cache.has(modelId)) {
    cache.set(modelId, (async () => {
      const url = new URL(`../vendor/models/clubhouse/${modelId}.glb`, import.meta.url);
      const bytes = await readFile(url);
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const gltf = await new Promise((resolve, reject) => makeLoader().parse(data, '', resolve, reject));
      const root = gltf.scene.getObjectByName(modelId);
      assert.ok(root, `${modelId} exposes its exact root`);
      root.updateMatrixWorld(true);
      return { root, audit: auditGlb(fileURLToPath(url)) };
    })());
  }
  return cache.get(modelId);
}

function exactNode(root, name) {
  const matches = [];
  root.traverse((candidate) => { if (candidate.name === name) matches.push(candidate); });
  assert.equal(matches.length, 1, `${root.name} exposes exactly one ${name}`);
  return matches[0];
}

function parseJsonArray(value, label) {
  const result = Array.isArray(value) ? value : JSON.parse(String(value || '[]'));
  assert.ok(Array.isArray(result), `${label} is an array`);
  return result;
}

function contractedSkus(layoutId) {
  return Object.values(PRODUCT_PACKAGING)
    .filter((entry) => entry.layoutId === layoutId)
    .map((entry) => entry.skuId)
    .sort();
}

function approx(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 1e-6, `${label}: ${actual} != ${expected}`);
}

test('three hero cartons cleanly import with only their declared exact layouts and legacy aliases', async () => {
  for (const [modelId, spec] of Object.entries(ASSETS)) {
    const { root, audit } = await loadAsset(modelId);
    assert.deepEqual(parseJsonArray(root.userData.content_layouts, `${modelId} content_layouts`), spec.layouts);
    assert.equal(Number(root.userData.content_scale), 1, `${modelId} root content scale`);
    assert.equal(root.userData.allow_scale, false, `${modelId} root forbids shrink fallback`);
    const declaredShellIds = [...new Set(spec.layouts.map((layoutId) => PACKAGING_LAYOUTS[layoutId].shellId))];
    assert.deepEqual(declaredShellIds, [root.userData.packaging_shell_id], `${modelId} exact packaging shell id`);
    assert.equal(audit.cameras, 0, `${modelId} has no exported camera`);
    assert.equal(audit.lights, 0, `${modelId} has no exported light`);

    for (let index = 1; index <= spec.legacyCapacity; index += 1) {
      const legacy = exactNode(root, `CONTENT_SLOT_${String(index).padStart(2, '0')}`);
      assert.equal(legacy.parent, root, `${legacy.name} remains a direct compatibility alias`);
    }
  }
});

test('layout roots and sockets exactly mirror productPackaging quantity, fit and SKU contracts at scale 1', async () => {
  for (const [modelId, spec] of Object.entries(ASSETS)) {
    const { root } = await loadAsset(modelId);
    for (const layoutId of spec.layouts) {
      const contract = PACKAGING_LAYOUTS[layoutId];
      const shell = PACKAGING_SHELLS[contract.shellId];
      assert.equal(shell.modelId, modelId, `${layoutId} belongs to ${modelId}`);

      const layout = exactNode(root, `CONTENT_LAYOUT_${layoutId}`);
      assert.equal(layout.isMesh, undefined, `${layout.name} is a transform group`);
      assert.equal(layout.parent, root, `${layout.name} is directly under its physical shell`);
      assert.equal(layout.userData.layout_id, layoutId, `${layoutId} id metadata`);
      assert.equal(Number(layout.userData.capacity), contract.capacity, `${layoutId} capacity`);
      assert.equal(Number(layout.userData.content_scale), 1, `${layoutId} content scale`);
      assert.equal(layout.userData.allow_scale, false, `${layoutId} forbids shrink fallback`);
      assert.equal(layout.userData.packaging_shell_id, contract.shellId, `${layoutId} packaging shell id`);
      assert.equal(
        layout.userData.selection_rule,
        'exact_sku_category_quantity_dimensions_packaging_state',
        `${layoutId} strict selection rule`,
      );
      assert.deepEqual(
        parseJsonArray(layout.userData.allowed_skus, `${layoutId} allowed_skus`).sort(),
        contractedSkus(layoutId),
        `${layoutId} includes every and only contracted SKU`,
      );

      const verticalInset = (shell.dimensions.h - shell.innerDimensions.h) / 2;
      const verticalMin = verticalInset;
      const verticalMax = shell.dimensions.h - verticalInset;
      for (let index = 1; index <= contract.capacity; index += 1) {
        const name = `CONTENT_SLOT_${layoutId}_${String(index).padStart(2, '0')}`;
        const socket = exactNode(root, name);
        assert.equal(socket.parent, layout, `${name} is directly under ${layout.name}`);
        assert.equal(socket.isMesh, undefined, `${name} is a transform socket`);
        assert.equal(socket.userData.layout_id, layoutId, `${name} layout id`);
        assert.equal(Number(socket.userData.slot_index), index, `${name} slot index`);
        assert.equal(Number(socket.userData.stack_order), index, `${name} deterministic stack order`);
        assert.ok(Number.isInteger(Number(socket.userData.stack_column)), `${name} stack column`);
        assert.ok(Number.isInteger(Number(socket.userData.stack_layer)), `${name} stack layer`);
        assert.equal(Number(socket.userData.content_scale), 1, `${name} content scale`);
        assert.equal(socket.userData.allow_scale, false, `${name} forbids shrink fallback`);
        assert.equal(socket.userData.packaging_shell_id, contract.shellId, `${name} packaging shell id`);
        assert.deepEqual(
          parseJsonArray(socket.userData.allowed_skus, `${name} allowed_skus`).sort(),
          contractedSkus(layoutId),
          `${name} SKU contract`,
        );
        approx(Number(socket.userData.max_w), contract.slotMaxDimensions.w, `${name} width clearance`);
        approx(Number(socket.userData.max_h), contract.slotMaxDimensions.h, `${name} height clearance`);
        approx(Number(socket.userData.max_d), contract.slotMaxDimensions.d, `${name} depth clearance`);
        approx(socket.scale.x, 1, `${name} X scale`);
        approx(socket.scale.y, 1, `${name} Y scale`);
        approx(socket.scale.z, 1, `${name} Z scale`);

        assert.ok(
          Math.abs(socket.position.x) + contract.slotMaxDimensions.w / 2 <= shell.innerDimensions.w / 2 + 1e-6,
          `${name} width envelope stays inside ${contract.shellId}`,
        );
        assert.ok(
          Math.abs(socket.position.z) + contract.slotMaxDimensions.d / 2 <= shell.innerDimensions.d / 2 + 1e-6,
          `${name} depth envelope stays inside ${contract.shellId}`,
        );
        assert.ok(
          socket.position.y - contract.slotMaxDimensions.h / 2 >= verticalMin - 1e-6
            && socket.position.y + contract.slotMaxDimensions.h / 2 <= verticalMax + 1e-6,
          `${name} height envelope stays inside ${contract.shellId}`,
        );
      }
    }
  }
});

test('CAP_NEST8 is two stacks by four nested layers, apparel layouts stay distinct, and CLUB2 opposes heads', async () => {
  const { root: generic } = await loadAsset('delivery_generic_merchandise_box');
  const capSockets = Array.from({ length: 8 }, (_, index) =>
    exactNode(generic, `CONTENT_SLOT_CAP_NEST8_${String(index + 1).padStart(2, '0')}`));
  assert.deepEqual(
    [...new Set(capSockets.map((socket) => Number(socket.userData.stack_column)))],
    [1, 2],
    'CAP_NEST8 uses two side-by-side cap stacks',
  );
  for (const column of [1, 2]) {
    assert.deepEqual(
      capSockets.filter((socket) => Number(socket.userData.stack_column) === column)
        .map((socket) => Number(socket.userData.stack_layer)),
      [1, 2, 3, 4],
      `CAP_NEST8 stack ${column} has four nested crown layers`,
    );
  }

  const { root: apparel } = await loadAsset('delivery_apparel_box');
  const apparelSockets = Array.from({ length: 8 }, (_, index) =>
    exactNode(apparel, `CONTENT_SLOT_APPAREL8_${String(index + 1).padStart(2, '0')}`));
  const flatSockets = Array.from({ length: 8 }, (_, index) =>
    exactNode(apparel, `CONTENT_SLOT_FLAT8_${String(index + 1).padStart(2, '0')}`));
  assert.equal(new Set(apparelSockets.map((socket) => socket.position.x.toFixed(3))).size, 2,
    'APPAREL8 has two full-width garment stacks');
  assert.equal(new Set(apparelSockets.map((socket) => socket.position.y.toFixed(3))).size, 4,
    'APPAREL8 has four soft-good layers');
  assert.equal(new Set(flatSockets.map((socket) => socket.position.x.toFixed(3))).size, 2,
    'FLAT8 has two width columns');
  assert.equal(new Set(flatSockets.map((socket) => socket.position.z.toFixed(3))).size, 2,
    'FLAT8 has two depth rows');
  assert.equal(new Set(flatSockets.map((socket) => socket.position.y.toFixed(3))).size, 2,
    'FLAT8 has two vertical layers');

  const { root: club } = await loadAsset('delivery_golf_club_box');
  assert.deepEqual(
    parseJsonArray(exactNode(club, 'CONTENT_SLOT_CLUB2_01').userData.authored_rotation_rad, 'CLUB2 first rotation'),
    [0, 0, 0],
  );
  assert.deepEqual(
    parseJsonArray(exactNode(club, 'CONTENT_SLOT_CLUB2_02').userData.authored_rotation_rad, 'CLUB2 second rotation'),
    [0, 0, 3.141593],
    'the second protected club reverses so its head occupies the opposite end',
  );
});
