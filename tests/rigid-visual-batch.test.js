import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { batchRigidVisualsByPbrResponse } from '../src/render3d/clubhouse/rigidVisualBatch.js';
import { CHECKOUT_RIGID_BATCH_HARDWARE } from '../src/render3d/clubhouse/fixtures.js';

function part(name, color, { metalness = 0, roughness = 0.8, emissive = 0 } = {}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.1),
    new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive }),
  );
  mesh.name = name;
  return mesh;
}

test('rigid PBR batching preserves anchors and dynamic feedback while merging colours', () => {
  const parent = new THREE.Group();
  const device = new THREE.Group();
  parent.add(device);
  const sources = [
    part('BodyA', 0x332211),
    part('BodyB', 0x775533),
    part('BodyC', 0x1d3b2b),
    part('TrimA', 0xb9974e, { metalness: 0.7, roughness: 0.3 }),
    part('TrimB', 0x554422, { metalness: 0.7, roughness: 0.3 }),
  ];
  const led = part('Scanner_LED', 0xff0000, { emissive: 0xff0000 });
  const socket = new THREE.Object3D();
  socket.name = 'SCAN_RAY_ORIGIN';
  device.add(...sources, led, socket);

  const result = batchRigidVisualsByPbrResponse(parent, device, {
    excludeNames: ['Scanner_LED'],
  });

  assert.ok(result);
  assert.equal(result.diagnostics.sourceDrawCalls, 5);
  assert.equal(result.diagnostics.batchDrawCalls, 2);
  assert.equal(result.diagnostics.drawCallsSaved, 3);
  assert.ok(sources.every((mesh) => mesh.layers.mask === 0));
  assert.notEqual(led.layers.mask, 0);
  assert.equal(device.getObjectByName('SCAN_RAY_ORIGIN'), socket);
  assert.equal(result.root.children.every((mesh) => mesh.material.vertexColors), true);

  assert.equal(result.dispose(), true);
  assert.ok(sources.every((mesh) => mesh.layers.mask !== 0));
  assert.equal(result.dispose(), false);
});

test('rigid PBR batching leaves textured and transparent surfaces on their authored path', () => {
  const parent = new THREE.Group();
  const root = new THREE.Group();
  parent.add(root);
  const plainA = part('PlainA', 0x111111);
  const plainB = part('PlainB', 0x222222);
  const textured = part('LiveScreenBacking', 0xffffff);
  textured.material.map = new THREE.Texture();
  const glass = part('Glass', 0xffffff);
  glass.material.transparent = true;
  glass.material.opacity = 0.5;
  root.add(plainA, plainB, textured, glass);

  const result = batchRigidVisualsByPbrResponse(parent, root);

  assert.ok(result);
  assert.equal(result.diagnostics.sourceDrawCalls, 2);
  assert.equal(textured.layers.mask, 1);
  assert.equal(glass.layers.mask, 1);
  result.dispose();
});

async function loadCheckoutKit(name) {
  const bytes = await readFile(new URL(`../assets/checkout/glb/${name}.glb`, import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'node-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  const gltf = await new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = false;
    if (object.name.startsWith('COL_')) object.visible = false;
  });
  return gltf.scene;
}

test('the production checkout hardware collapses real authored rigid draws', async (t) => {
  const names = [
    'pos_monitor',
    'payment_terminal',
    'barcode_scanner',
    'receipt_printer',
    'customer_display',
  ];
  assert.equal(CHECKOUT_RIGID_BATCH_HARDWARE.includes('payment_terminal'), false,
    'the raycast-authoritative terminal root is never admitted to the rigid batch');
  assert.ok(CHECKOUT_RIGID_BATCH_HARDWARE.includes('pos_monitor'));
  assert.ok(CHECKOUT_RIGID_BATCH_HARDWARE.includes('barcode_scanner'));

  const loadedRoots = await Promise.all(names.map(loadCheckoutKit));
  const rootsByName = new Map(names.map((name, index) => [name, loadedRoots[index]]));
  const parent = new THREE.Group();
  loadedRoots.forEach((root, index) => {
    root.position.x = index * 0.4;
    parent.add(root);
  });
  for (const paperName of ['ReceiptPaper', 'Receipt_Paper']) {
    const paper = parent.getObjectByName(paperName);
    if (paper) paper.visible = false;
  }

  const batchRoots = CHECKOUT_RIGID_BATCH_HARDWARE
    .map((name) => rootsByName.get(name))
    .filter(Boolean);
  const result = batchRigidVisualsByPbrResponse(parent, batchRoots, {
    name: 'ProductionCheckoutHardwareBatch',
    excludeNames: ['Scanner_Window', 'Scanner_LED', 'Scanner_CashierLED'],
  });

  assert.ok(result, 'the shipped checkout kit must contain batchable rigid PBR parts');
  assert.ok(result.diagnostics.sourceDrawCalls > result.diagnostics.batchDrawCalls);
  assert.ok(result.diagnostics.drawCallsSaved >= 3,
    `expected non-terminal checkout hardware batching to retain meaningful draw-call savings, got ${JSON.stringify(result.diagnostics)}`);
  assert.notEqual(parent.getObjectByName('Scanner_Window').layers.mask, 0);
  assert.notEqual(parent.getObjectByName('Scanner_LED').layers.mask, 0);
  assert.notEqual(parent.getObjectByName('Scanner_CashierLED').layers.mask, 0);
  const terminalMeshes = [];
  rootsByName.get('payment_terminal').traverse((object) => {
    if (object.isMesh) terminalMeshes.push(object);
  });
  assert.ok(terminalMeshes.length > 0);
  assert.equal(terminalMeshes.every((mesh) => mesh.layers.mask !== 0), true,
    'visible batched siblings never remove terminal chassis raycast reach');
  assert.ok(parent.getObjectByName('SCAN_RAY_ORIGIN'));
  assert.ok(parent.getObjectByName('CARD_INSERT_SOCKET'));
  assert.ok(parent.getObjectByName('RECEIPT_OUTPUT_SOCKET'));
  t.diagnostic(JSON.stringify(result.diagnostics));
  result.dispose();
});
