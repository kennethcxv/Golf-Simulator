import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { activeState } from '../src/sim/empire.js';
import { buildShedEmpire } from '../src/sim/shedScene.js';
import { createShedInterior } from '../src/render3d/clubhouse/shedInterior.js';

function fakeCanvas() {
  const canvas = { width: 1, height: 1, style: {} };
  const gradient = { addColorStop() {} };
  const known = {
    canvas,
    measureText: (value) => ({ width: String(value ?? '').length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    getImageData: (_x, _y, width = canvas.width, height = canvas.height) => ({
      data: new Uint8ClampedArray(Math.max(0, width * height * 4)), width, height,
    }),
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(Math.max(0, width * height * 4)), width, height,
    }),
  };
  const context = new Proxy(known, {
    get(target, property) { return property in target ? target[property] : () => {}; },
    set(target, property, value) { target[property] = value; return true; },
  });
  canvas.getContext = () => context;
  return canvas;
}

class ControlledLoader {
  requests = [];

  load(url, onLoad, _onProgress, onError) {
    this.requests.push({ url, onLoad, onError });
  }
}

test('shed interior readiness waits for every authored kit mount and reports safe fallback settlement', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : { style: {} }),
  };
  const loader = new ControlledLoader();
  let runtime = null;
  try {
    const state = activeState(buildShedEmpire(2401));
    runtime = createShedInterior({
      interior: new THREE.Group(),
      state,
      addProp() {},
      removeProp() {},
      addCol: (collider) => collider,
      colBoxAt: (x, z, width, depth) => ({
        minX: x - width / 2,
        maxX: x + width / 2,
        minZ: z - depth / 2,
        maxZ: z + depth / 2,
      }),
      loader,
    });

    assert.equal(loader.requests.length, 8,
      'rack, two windows, door, parks, and three clutter mounts all join readiness');
    let settled = false;
    runtime.ready.then(() => { settled = true; });

    for (const request of loader.requests.slice(0, -1)) {
      request.onLoad({ scene: new THREE.Group() });
    }
    await Promise.resolve();
    assert.equal(settled, false, 'readiness cannot settle while one kit can still mount');

    loader.requests.at(-1).onError(new Error('clutter unavailable'));
    const report = await runtime.ready;
    assert.equal(report.lifecycle, 'fallback');
    assert.equal(report.expected, 8);
    assert.equal(report.loaded, 7);
    assert.equal(report.failed, 1);
    assert.equal(report.settlements.length, 8);
    assert.equal(report.failures[0].error, 'clutter unavailable');
    assert.equal(Object.isFrozen(report), true);

    assert.deepEqual(runtime.diagnostics().authoredKit, {
      expected: 8,
      settled: 8,
      loaded: 7,
      failed: 1,
      failures: [report.failures[0]],
    });
  } finally {
    runtime?.dispose();
    globalThis.document = previousDocument;
  }
});

test('shed interior disposes shared authored-kit resources and decoded images exactly once', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : { style: {} }),
  };
  const loader = new ControlledLoader();
  let runtime = null;
  try {
    const state = activeState(buildShedEmpire(2404));
    runtime = createShedInterior({
      interior: new THREE.Group(),
      state,
      addProp() {},
      removeProp() {},
      addCol: (collider) => collider,
      colBoxAt: (x, z, width, depth) => ({
        minX: x - width / 2,
        maxX: x + width / 2,
        minZ: z - depth / 2,
        maxZ: z + depth / 2,
      }),
      loader,
    });

    const disposedCounts = { geometries: [0, 0], material: 0, texture: 0, image: 0 };
    const geometries = [
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.SphereGeometry(0.5, 8, 6),
    ];
    geometries.forEach((geometry, index) => {
      geometry.dispose = () => { disposedCounts.geometries[index] += 1; };
    });
    const decodedImage = { close: () => { disposedCounts.image += 1; } };
    const texture = new THREE.Texture(decodedImage);
    texture.dispose = () => { disposedCounts.texture += 1; };
    const material = new THREE.MeshStandardMaterial({ map: texture });
    material.dispose = () => { disposedCounts.material += 1; };
    const sharedRoot = new THREE.Group();
    sharedRoot.add(
      new THREE.Mesh(geometries[0], material),
      new THREE.Mesh(geometries[1], material),
    );

    loader.requests[0].onLoad({ scene: sharedRoot });
    for (const request of loader.requests.slice(1)) request.onLoad({ scene: new THREE.Group() });
    const report = await runtime.ready;
    assert.equal(report.lifecycle, 'ready');

    const disposal = runtime.dispose();
    assert.deepEqual(disposedCounts, {
      geometries: [1, 1],
      material: 1,
      texture: 1,
      image: 1,
    });
    assert.deepEqual(disposal.authoredKitResources, {
      geometries: 2,
      materials: 1,
      textures: 1,
    });
    assert.equal(sharedRoot.parent, null);

    const repeatedDisposal = runtime.dispose();
    assert.deepEqual(disposedCounts, {
      geometries: [1, 1],
      material: 1,
      texture: 1,
      image: 1,
    }, 'idempotent teardown cannot double-release a shared kit resource');
    assert.equal(repeatedDisposal.alreadyDisposed, true);
  } finally {
    runtime?.dispose();
    globalThis.document = previousDocument;
  }
});

test('shed interior releases late success resources once and treats late errors as disposed', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : { style: {} }),
  };
  const loader = new ControlledLoader();
  let runtime = null;
  try {
    const state = activeState(buildShedEmpire(2402));
    runtime = createShedInterior({
      interior: new THREE.Group(),
      state,
      addProp() {},
      removeProp() {},
      addCol: (collider) => collider,
      colBoxAt: (x, z, width, depth) => ({
        minX: x - width / 2,
        maxX: x + width / 2,
        minZ: z - depth / 2,
        maxZ: z + depth / 2,
      }),
      loader,
    });

    const firstDisposal = runtime.dispose();
    const repeatedDisposal = runtime.dispose();
    assert.equal(firstDisposal.alreadyDisposed, false);
    assert.deepEqual(repeatedDisposal, { ...firstDisposal, alreadyDisposed: true });

    const disposedCounts = { geometry: 0, material: 0, texture: 0 };
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.dispose = () => { disposedCounts.geometry += 1; };
    const texture = new THREE.Texture();
    texture.dispose = () => { disposedCounts.texture += 1; };
    const material = new THREE.MeshStandardMaterial({ map: texture });
    material.dispose = () => { disposedCounts.material += 1; };
    const lateRoot = new THREE.Group();
    lateRoot.add(new THREE.Mesh(geometry, material));

    loader.requests[0].onLoad({ scene: lateRoot });
    assert.deepEqual(disposedCounts, { geometry: 1, material: 1, texture: 1 },
      'detached late-success resources release before readiness settlement');
    loader.requests[0].onLoad({ scene: lateRoot });
    assert.deepEqual(disposedCounts, { geometry: 1, material: 1, texture: 1 },
      'a repeated success callback cannot double-dispose its detached tree');

    loader.requests[1].onError(new Error('late window error'));
    for (const request of loader.requests.slice(2)) request.onError(new Error('late load error'));
    const report = await runtime.ready;

    assert.equal(report.lifecycle, 'disposed');
    assert.equal(report.loaded, 0);
    assert.equal(report.failed, 0,
      'errors after disposal are lifecycle settlements, not presentation fallbacks');
    assert.ok(report.settlements.every((entry) => entry.status === 'disposed'));
    assert.deepEqual(runtime.diagnostics().authoredKit, {
      expected: 8,
      settled: 8,
      loaded: 0,
      failed: 0,
      failures: [],
    });
  } finally {
    runtime?.dispose();
    globalThis.document = previousDocument;
  }
});

test('shed interior rolls back and releases a GLTF when post-mount processing throws', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : { style: {} }),
  };
  const loader = new ControlledLoader();
  let runtime = null;
  try {
    const state = activeState(buildShedEmpire(2403));
    runtime = createShedInterior({
      interior: new THREE.Group(),
      state,
      addProp() {},
      removeProp() {},
      addCol: (collider) => collider,
      colBoxAt: (x, z, width, depth) => ({
        minX: x - width / 2,
        maxX: x + width / 2,
        minZ: z - depth / 2,
        maxZ: z + depth / 2,
      }),
      loader,
    });

    const disposedCounts = { geometry: 0, material: 0, texture: 0 };
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.dispose = () => { disposedCounts.geometry += 1; };
    const texture = new THREE.Texture();
    texture.dispose = () => { disposedCounts.texture += 1; };
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 });
    material.dispose = () => { disposedCounts.material += 1; };
    Object.defineProperty(material, 'roughness', {
      configurable: true,
      enumerable: true,
      get: () => 0.5,
      set: () => { throw new Error('parks finish failed'); },
    });
    const failedRoot = new THREE.Group();
    failedRoot.add(new THREE.Mesh(geometry, material));

    // Request 4 is the parks kit; its onReady roughness pass runs only after
    // the GLTF has been mounted, so this exercises rollback of a partial adopt.
    loader.requests[4].onLoad({ scene: failedRoot });
    assert.equal(failedRoot.parent, null, 'failed GLTF root is detached from the live shed');
    assert.deepEqual(disposedCounts, { geometry: 1, material: 1, texture: 1 });
    loader.requests[4].onLoad({ scene: failedRoot });
    assert.deepEqual(disposedCounts, { geometry: 1, material: 1, texture: 1 },
      'a repeated callback cannot release failed-adoption resources twice');

    loader.requests.forEach((request, index) => {
      if (index !== 4) request.onLoad({ scene: new THREE.Group() });
    });
    const report = await runtime.ready;

    assert.equal(report.lifecycle, 'fallback');
    assert.equal(report.loaded, 7);
    assert.equal(report.failed, 1);
    assert.equal(report.settlements[4].status, 'fallback');
    assert.equal(report.failures[0].part, 'parks');
    assert.equal(report.failures[0].error, 'parks finish failed');
    assert.equal(runtime.group.getObjectById(failedRoot.id), undefined,
      'failed partial geometry is absent from the runtime hierarchy');
  } finally {
    runtime?.dispose();
    globalThis.document = previousDocument;
  }
});
