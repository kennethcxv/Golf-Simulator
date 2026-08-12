import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { activeState } from '../src/sim/empire.js';
import { buildShedEmpire } from '../src/sim/shedScene.js';
import {
  collectRenderableResources,
  mergeRenderableResources,
} from '../src/render3d/clubhouse/resourceLifecycle.js';
import { clearGltfCache } from '../src/render3d/gltfCache.js';

function fakeCanvas() {
  const canvas = {
    width: 1600,
    height: 900,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    requestPointerLock() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1600, height: 900, right: 1600, bottom: 900 };
    },
  };
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
    get(target, property) {
      return property in target ? target[property] : () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  canvas.getContext = () => context;
  return canvas;
}

function fakeDocument(primaryCanvas) {
  const classList = { add() {}, remove() {}, toggle() {} };
  const imageElement = () => ({
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, crossOrigin: null, src: '',
  });
  return {
    body: { classList },
    pointerLockElement: null,
    createElement: (tag) => (tag === 'canvas'
      ? fakeCanvas()
      : {
        style: {}, classList, addEventListener() {}, removeEventListener() {}, appendChild() {},
      }),
    createElementNS: () => imageElement(),
    querySelector: (selector) => (selector === 'canvas' ? primaryCanvas : null),
    addEventListener() {},
    removeEventListener() {},
    exitPointerLock() {},
    hasFocus: () => true,
  };
}

function observe(resources) {
  const records = [];
  for (const [kind, values] of Object.entries(resources)) {
    for (const value of values) {
      const record = { kind, value, count: 0 };
      value.addEventListener('dispose', () => { record.count += 1; });
      records.push(record);
    }
  }
  return records;
}

test('production shed clubhouse teardown delegates every nested render resource exactly once', async () => {
  const canvas = fakeCanvas();
  const previousDocument = globalThis.document;
  globalThis.document = fakeDocument(canvas);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const originalLoad = GLTFLoader.prototype.load;

  const decodedImage = { closes: 0, close() { this.closes += 1; } };
  const sharedKitTexture = new THREE.Texture(decodedImage);
  const sharedKitMaterial = new THREE.MeshStandardMaterial({
    color: 0x6a5946,
    map: sharedKitTexture,
    roughness: 0.8,
  });
  const sharedKitGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const sharedKitDisposals = { geometry: 0, material: 0, texture: 0 };
  sharedKitGeometry.addEventListener('dispose', () => { sharedKitDisposals.geometry += 1; });
  sharedKitMaterial.addEventListener('dispose', () => { sharedKitDisposals.material += 1; });
  sharedKitTexture.addEventListener('dispose', () => { sharedKitDisposals.texture += 1; });

  GLTFLoader.prototype.load = function loadFixture(url, onLoad, _onProgress, onError) {
    const root = new THREE.Group();
    root.name = String(url).split('/').pop()?.replace(/\.glb$/i, '') || 'FixtureRoot';
    if (String(url).includes('vendor/models/shed/')) {
      root.add(
        new THREE.Mesh(sharedKitGeometry, sharedKitMaterial),
        new THREE.Mesh(sharedKitGeometry, sharedKitMaterial),
      );
      onLoad({ scene: root, animations: [] });
    } else {
      onError?.(new Error(`fixture intentionally unavailable: ${url}`));
    }
    return this;
  };

  let clubhouse = null;
  try {
    clearGltfCache();
    const [{ makeClubhouse }] = await Promise.all([
      import('../src/render3d/clubhouse.js'),
    ]);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 500);
    scene.add(camera);
    clubhouse = makeClubhouse({
      scene,
      camera,
      state: activeState(buildShedEmpire(2411)),
      center: { x: 0, z: 0 },
      heightAt: () => 0,
      walkProps: [],
      propColliders: [],
      walk: {
        x: 0, z: 0, yaw: 0, pitch: 0, eye: 1.65, radius: 0.35,
        active: false, moving: false,
      },
      hooks: {},
      canvas,
      focusOn() {},
      clearFocus() {},
    });

    const readiness = await clubhouse.firstDoorVisibilityReady;
    assert.equal(readiness.safeToPrewarm, true);
    const shedLayer = clubhouse.interior.getObjectByName('ShedInteriorLayer');
    const grimePlane = scene.getObjectByName('ShedDirtGrimePlane');
    const films = [0, 1]
      .map((index) => scene.getObjectByName(`ShedDirtWindowFilm_${index}`))
      .filter(Boolean);
    assert.ok(shedLayer, 'the real shed interior owner is mounted under the clubhouse interior');
    assert.ok(grimePlane, 'the real shed grime owner is mounted under the clubhouse graph');
    assert.equal(films.length, 2, 'both real shed window films are mounted under shell holders');

    const nestedResources = mergeRenderableResources(
      collectRenderableResources(shedLayer),
      collectRenderableResources([grimePlane, ...films]),
    );
    const records = observe(nestedResources);
    assert.ok(nestedResources.geometries.size > 10);
    assert.ok(nestedResources.materials.size > 5);
    assert.ok(nestedResources.textures.size >= 2);

    const firstSummary = clubhouse.dispose();
    assert.deepEqual(sharedKitDisposals, { geometry: 1, material: 1, texture: 1 });
    assert.equal(decodedImage.closes, 1, 'the shared raw-GLTF decoded image closes once');
    for (const record of records) {
      assert.equal(record.count, 1,
        `${record.kind} ${record.value.name || record.value.uuid} must have one production owner`);
    }
    assert.ok(firstSummary.shedInterior);
    assert.equal(firstSummary.shedInterior.authoredKitResources.geometries, 1);
    assert.ok(firstSummary.shedDirt);

    const repeatedSummary = clubhouse.dispose();
    assert.equal(repeatedSummary, firstSummary, 'clubhouse teardown is idempotent');
    assert.deepEqual(sharedKitDisposals, { geometry: 1, material: 1, texture: 1 });
    assert.equal(decodedImage.closes, 1);
    assert.ok(records.every((record) => record.count === 1));
  } finally {
    clubhouse?.dispose();
    clearGltfCache();
    GLTFLoader.prototype.load = originalLoad;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
