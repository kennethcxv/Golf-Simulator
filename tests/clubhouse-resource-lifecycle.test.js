import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  closeTextureImages, collectMaterialResources, collectRenderableResources, disposeRenderableResources,
  mergeRenderableResources,
} from '../src/render3d/clubhouse/resourceLifecycle.js';
import { clearGltfCache } from '../src/render3d/gltfCache.js';

function spy(resource, counts, key) {
  const original = resource.dispose.bind(resource);
  resource.dispose = () => {
    counts[key] += 1;
    original();
  };
  return resource;
}

test('clubhouse resource release deduplicates shared render resources', () => {
  const counts = { geometries: 0, materials: 0, textures: 0 };
  const texture = spy(new THREE.Texture(), counts, 'textures');
  const material = spy(new THREE.MeshStandardMaterial({ map: texture }), counts, 'materials');
  const geometry = spy(new THREE.BoxGeometry(1, 1, 1), counts, 'geometries');
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));

  const resources = collectRenderableResources(root);
  assert.deepEqual({
    geometries: resources.geometries.size,
    materials: resources.materials.size,
    textures: resources.textures.size,
  }, { geometries: 1, materials: 1, textures: 1 });
  assert.deepEqual(disposeRenderableResources(resources), {
    geometries: 1, materials: 1, textures: 1,
  });
  assert.deepEqual(counts, { geometries: 1, materials: 1, textures: 1 });
});

test('clubhouse resource release preserves resources that predate its ownership boundary', () => {
  const counts = { geometries: 0, materials: 0, textures: 0 };
  const borrowedTexture = spy(new THREE.Texture(), counts, 'textures');
  const borrowedMaterial = spy(
    new THREE.MeshStandardMaterial({ map: borrowedTexture }), counts, 'materials',
  );
  const borrowedGeometry = spy(new THREE.BoxGeometry(1, 1, 1), counts, 'geometries');
  const existingScene = new THREE.Group();
  existingScene.add(new THREE.Mesh(borrowedGeometry, borrowedMaterial));
  const protectedResources = collectRenderableResources(existingScene);

  const ownedTexture = spy(new THREE.Texture(), counts, 'textures');
  const ownedMaterial = spy(new THREE.MeshStandardMaterial({ map: ownedTexture }), counts, 'materials');
  const ownedGeometry = spy(new THREE.SphereGeometry(1), counts, 'geometries');
  const clubhouse = new THREE.Group();
  clubhouse.add(
    new THREE.Mesh(borrowedGeometry, borrowedMaterial),
    new THREE.Mesh(ownedGeometry, ownedMaterial),
  );

  assert.deepEqual(
    disposeRenderableResources(collectRenderableResources(clubhouse), protectedResources),
    { geometries: 1, materials: 1, textures: 1 },
  );
  assert.deepEqual(counts, { geometries: 1, materials: 1, textures: 1 });

  borrowedTexture.dispose();
  borrowedMaterial.dispose();
  borrowedGeometry.dispose();
});

test('material-kit and object-tree resources merge without double disposal', () => {
  const counts = { geometries: 0, materials: 0, textures: 0 };
  const texture = spy(new THREE.Texture(), counts, 'textures');
  const unusedTexture = spy(new THREE.Texture(), counts, 'textures');
  const material = spy(new THREE.MeshStandardMaterial({ map: texture }), counts, 'materials');
  const geometry = spy(new THREE.BoxGeometry(1, 1, 1), counts, 'geometries');
  const root = new THREE.Mesh(geometry, material);
  const resources = mergeRenderableResources(
    collectRenderableResources(root),
    collectMaterialResources({ material, unusedTexture }),
  );

  assert.deepEqual(disposeRenderableResources(resources), {
    geometries: 1, materials: 1, textures: 2,
  });
  assert.deepEqual(counts, { geometries: 1, materials: 1, textures: 2 });
});

test('owned ImageBitmap backing is closed once and protected backing stays open', () => {
  const ownedImage = { closes: 0, close() { this.closes += 1; } };
  const borrowedImage = { closes: 0, close() { this.closes += 1; } };
  const ownedA = new THREE.Texture(ownedImage);
  const ownedB = new THREE.Texture(ownedImage);
  const borrowed = new THREE.Texture(borrowedImage);
  const resources = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set([ownedA, ownedB, borrowed]),
  };
  disposeRenderableResources(resources, { textures: new Set([borrowed]) });
  assert.equal(ownedImage.closes, 1);
  assert.equal(borrowedImage.closes, 0);

  const closed = new Set();
  assert.equal(closeTextureImages(borrowed, closed), 1);
  assert.equal(closeTextureImages(borrowed, closed), 0);
  assert.equal(borrowedImage.closes, 1);
});

function fakeCanvas() {
  const canvas = {
    width: 1,
    height: 1,
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
      data: new Uint8ClampedArray(Math.max(0, width * height * 4)),
      width,
      height,
    }),
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(Math.max(0, width * height * 4)),
      width,
      height,
    }),
  };
  const context = new Proxy(known, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
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
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    crossOrigin: null,
    src: '',
  });
  return {
    body: { classList },
    pointerLockElement: null,
    createElement: (tag) => (tag === 'canvas'
      ? fakeCanvas()
      : {
        style: {}, classList, addEventListener() {}, removeEventListener() {}, appendChild() {},
      }),
    createElementNS: (_namespace, tag) => (tag === 'img' ? imageElement() : imageElement()),
    querySelector: (selector) => (selector === 'canvas' ? primaryCanvas : null),
    addEventListener() {},
    removeEventListener() {},
    exitPointerLock() {},
    hasFocus: () => true,
  };
}

function observeDispose(resource, records, label) {
  let record = records.get(resource);
  if (!record) {
    record = { labels: [], count: 0 };
    records.set(resource, record);
    resource.addEventListener('dispose', () => { record.count += 1; });
  }
  record.labels.push(label);
}

test('makeClubhouse teardown releases receiving resources once and leaves loader resources to merchandise ownership', async () => {
  const canvas = fakeCanvas();
  const previousDocument = globalThis.document;
  globalThis.document = fakeDocument(canvas);

  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const originalLoad = GLTFLoader.prototype.load;
  const borrowedGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const borrowedTexture = new THREE.Texture();
  const borrowedMaterial = new THREE.MeshStandardMaterial({ map: borrowedTexture });
  // `M_tape` is intentionally preserved by createMerch instead of being
  // remapped onto the caller-owned clubhouse material kit.
  borrowedMaterial.name = 'M_tape';
  const borrowedDisposals = { geometry: 0, material: 0, texture: 0 };
  borrowedGeometry.addEventListener('dispose', () => { borrowedDisposals.geometry += 1; });
  borrowedMaterial.addEventListener('dispose', () => { borrowedDisposals.material += 1; });
  borrowedTexture.addEventListener('dispose', () => { borrowedDisposals.texture += 1; });
  const modernGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const modernTexture = new THREE.Texture();
  const modernMaterial = new THREE.MeshStandardMaterial({ map: modernTexture });
  const modernDisposals = { geometry: 0, material: 0, texture: 0 };
  modernGeometry.addEventListener('dispose', () => { modernDisposals.geometry += 1; });
  modernMaterial.addEventListener('dispose', () => { modernDisposals.material += 1; });
  modernTexture.addEventListener('dispose', () => { modernDisposals.texture += 1; });
  const architecturalDoorGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const architecturalDoorTexture = new THREE.Texture();
  const architecturalDoorMaterial = new THREE.MeshStandardMaterial({ map: architecturalDoorTexture });
  const architecturalDoorDisposals = { geometry: 0, material: 0, texture: 0 };
  architecturalDoorGeometry.addEventListener('dispose', () => { architecturalDoorDisposals.geometry += 1; });
  architecturalDoorMaterial.addEventListener('dispose', () => { architecturalDoorDisposals.material += 1; });
  architecturalDoorTexture.addEventListener('dispose', () => { architecturalDoorDisposals.texture += 1; });
  const sheet06Geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const sheet06Texture = new THREE.Texture();
  const sheet06Material = new THREE.MeshStandardMaterial({ map: sheet06Texture });
  const sheet06Disposals = { geometry: 0, material: 0, texture: 0 };
  sheet06Geometry.addEventListener('dispose', () => { sheet06Disposals.geometry += 1; });
  sheet06Material.addEventListener('dispose', () => { sheet06Disposals.material += 1; });
  sheet06Texture.addEventListener('dispose', () => { sheet06Disposals.texture += 1; });
  const pendingLoads = [];
  const latePropResources = [];
  let lateMode = false;

  GLTFLoader.prototype.load = function loadFixture(url, onLoad, _onProgress, onError) {
    const source = String(url);
    pendingLoads.push({
      source,
      canFail: typeof onError === 'function',
      succeed() {
      const id = source.split('/').pop().replace(/\.glb$/i, '');
      const root = new THREE.Group();
      root.name = id;
        let resources;
        if (lateMode) {
          const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
          const texture = new THREE.Texture();
          const material = new THREE.MeshStandardMaterial({ map: texture });
          const record = { source, geometry: 0, material: 0, texture: 0 };
          geometry.addEventListener('dispose', () => { record.geometry += 1; });
          material.addEventListener('dispose', () => { record.material += 1; });
          texture.addEventListener('dispose', () => { record.texture += 1; });
          if (/\/assets_51_100\/.*\/asset_(?:0(?:6[1-9]|[7-9][0-9])|100)_/i.test(source)) {
            latePropResources.push(record);
          }
          resources = [geometry, material];
        } else {
          resources = source.includes('/assets_51_100/')
            ? [sheet06Geometry, sheet06Material]
            : source.includes('/architecture/doors/')
              ? [architecturalDoorGeometry, architecturalDoorMaterial]
              : source.includes('/clubhouse/modern_public_clubhouse')
                ? [modernGeometry, modernMaterial]
                : [borrowedGeometry, borrowedMaterial];
        }
      root.add(new THREE.Mesh(...resources));
      onLoad({ scene: root, animations: [] });
      },
      fail() {
        onError?.(new Error(`deferred loader failure: ${source}`));
      },
    });
    return this;
  };

  let clubhouse = null;
  let lateClubhouse = null;
  try {
    const [{ makeClubhouse }, { newGame }] = await Promise.all([
      import('../src/render3d/clubhouse.js'),
      import('../src/sim/state.js'),
    ]);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 500);
    scene.add(camera);
    const state = newGame('relaxed', 14245);
    const walk = {
      x: 0, z: 0, yaw: 0, pitch: 0, eye: 1.65, radius: 0.35,
      active: false, moving: false,
    };
    clubhouse = makeClubhouse({
      scene,
      camera,
      state,
      center: { x: 0, z: 0 },
      heightAt: () => 0,
      walkProps: [],
      propColliders: [],
      walk,
      hooks: {},
      canvas,
      focusOn() {},
      clearFocus() {},
    });
    for (const request of pendingLoads.splice(0)) request.succeed();
    await Promise.resolve();

    const namedObjects = [
      'DeliveryReceivingSlab',
      'DeliveryReceivingBayMarkings',
      'DeliveryReceivingThresholdConnector',
      'DeliveryReceivingDrainageChannel',
      'DeliveryVanServiceBay',
      'DeliveryVanServiceBayMarkings',
      'DeliveryApronVanBayTransferStrip',
      'DeliveryVanApproachTrackLeft',
      'DeliveryVanApproachTrackRight',
      'DeliveryVanDepartureTrackLeft',
      'DeliveryVanDepartureTrackRight',
      'DeliveryReceivingExteriorSignBack',
      'DeliveryReceivingExteriorSignFace',
      'BackroomOperationsBoard',
      'HandTruckSafetyPlacard',
    ];
    const records = new Map();
    for (const name of namedObjects) {
      const object = scene.getObjectByName(name);
      assert.ok(object?.isMesh, `${name} is mounted as a procedural mesh`);
      observeDispose(object.geometry, records, `${name}:geometry`);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        observeDispose(material, records, `${name}:material`);
        for (const value of Object.values(material)) {
          if (value?.isTexture) observeDispose(value, records, `${name}:texture`);
        }
      }
    }
    assert.ok(
      [...records.values()].some((record) => record.labels.includes('DeliveryReceivingBayMarkings:texture')),
      'receiving bay canvas texture is observed',
    );
    assert.ok(
      [...records.values()].some((record) => record.labels.includes('DeliveryReceivingExteriorSignFace:texture')),
      'receiving sign canvas texture is observed',
    );
    assert.ok(
      [...records.values()].some((record) => record.labels.includes('DeliveryVanServiceBayMarkings:texture')),
      'delivery service-bay canvas texture is observed',
    );
    assert.ok(
      [...records.values()].some((record) => record.labels.includes('BackroomOperationsBoard:texture')),
      'operations board canvas texture is observed',
    );
    assert.ok(
      [...records.values()].some((record) => record.labels.includes('HandTruckSafetyPlacard:texture')),
      'hand-truck safety canvas texture is observed',
    );
    assert.equal(records.has(borrowedGeometry), false);
    assert.equal(records.has(borrowedMaterial), false);
    assert.equal(records.has(borrowedTexture), false);

    const first = clubhouse.dispose();
    for (const record of records.values()) {
      assert.equal(record.count, 1, `${record.labels.join(', ')} disposed exactly once`);
    }
    assert.deepEqual(first.deliveryEquipment.resourcesDisposed, {
      geometries: 0, materials: 0, textures: 0,
    });
    assert.equal(first.merchandise.prototypeGeometries, 1);
    assert.equal(first.merchandise.prototypeMaterials, 1);
    assert.equal(first.merchandise.prototypeTextures, 1);
    assert.equal(first.register.cardTextures.disposedTextures, 6,
      'every finite customer-card canvas is released by the register cache owner');
    assert.equal(first.register.cardTextures.entries, 0);
    assert.equal(first.register.cardTextures.alreadyDisposed, false);
    assert.equal(first.register.paymentPrewarm.released, true);
    assert.equal(first.register.paymentPrewarm.aborted, true,
      'teardown before the opaque draw uses the explicit abort cleanup path');
    assert.deepEqual(borrowedDisposals, { geometry: 1, material: 1, texture: 1 },
      'borrowed clone resources bypass procedural teardown and are released once by createMerch');
    assert.deepEqual(modernDisposals, { geometry: 1, material: 1, texture: 1 },
      'modern clubhouse loader resources are released exactly once by its presentation owner');
    assert.deepEqual(architecturalDoorDisposals, { geometry: 1, material: 1, texture: 1 },
      'architectural door loader resources are released exactly once by the door visual runtime');
    assert.deepEqual(sheet06Disposals, { geometry: 1, material: 1, texture: 1 },
      'failed Sheet-6 prototypes release their isolated cache resources exactly once');

    clubhouse.dispose();
    for (const record of records.values()) assert.equal(record.count, 1);
    assert.deepEqual(borrowedDisposals, { geometry: 1, material: 1, texture: 1 });
    assert.deepEqual(modernDisposals, { geometry: 1, material: 1, texture: 1 });
    assert.deepEqual(architecturalDoorDisposals, { geometry: 1, material: 1, texture: 1 });
    assert.deepEqual(sheet06Disposals, { geometry: 1, material: 1, texture: 1 });

    // Exercise the shipping teardown path before any loader settles. A direct
    // prop-runtime unit test is insufficient here: reload-only recovery calls
    // makeClubhouse.dispose(), so this proves that caller flips the guard and
    // that both late success and late error callbacks remain inert.
    clearGltfCache();
    lateMode = true;
    const lateScene = new THREE.Scene();
    const lateCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 500);
    lateScene.add(lateCamera);
    const lateWalkProps = [];
    const lateColliders = [];
    lateClubhouse = makeClubhouse({
      scene: lateScene,
      camera: lateCamera,
      state: newGame('relaxed', 14246),
      center: { x: 0, z: 0 },
      heightAt: () => 0,
      walkProps: lateWalkProps,
      propColliders: lateColliders,
      walk: {
        x: 0, z: 0, yaw: 0, pitch: 0, eye: 1.65, radius: 0.35,
        active: false, moving: false,
      },
      hooks: {},
      canvas,
      focusOn() {},
      clearFocus() {},
    });
    const lateSummary = lateClubhouse.dispose();
    assert.ok(lateSummary.props61to100,
      'production clubhouse teardown invokes the prop runtime ownership boundary');

    const lateRequests = pendingLoads.splice(0);
    let latePropIndex = 0;
    for (const request of lateRequests) {
      const isProp = /\/assets_51_100\/.*\/asset_(?:0(?:6[1-9]|[7-9][0-9])|100)_/i.test(request.source);
      if (isProp) {
        if (latePropIndex % 2 === 0) request.succeed();
        else request.fail();
        latePropIndex += 1;
      } else if (request.canFail) request.fail();
      else request.succeed();
    }
    await lateClubhouse.props71to100.ready;
    const lateDiagnostics = lateClubhouse.props71to100.diagnostics();
    assert.equal(lateDiagnostics.disposed, true);
    assert.equal(lateDiagnostics.placed, 0);
    assert.equal(lateDiagnostics.failed, 0,
      'late loader errors do not mutate failure diagnostics after disposal');
    assert.ok(lateDiagnostics.lateLoaderSuccesses > 0);
    assert.ok(lateDiagnostics.lateLoaderErrors > 0,
      JSON.stringify({ latePropIndex, lateDiagnostics, lateSources: lateRequests
        .map((request) => request.source) }));
    assert.equal(lateWalkProps.length, 0);
    assert.equal(lateColliders.length, 0);
    assert.equal(lateScene.getObjectByName('Assets61to100Runtime'), undefined);
    assert.ok(latePropResources.length > 0);
    for (const record of latePropResources) {
      assert.deepEqual(
        { geometry: record.geometry, material: record.material, texture: record.texture },
        { geometry: 0, material: 0, texture: 0 },
        `late prop success retains cache-owned ${record.source} resources for the next runtime`,
      );
    }
  } finally {
    if (lateClubhouse) lateClubhouse.dispose();
    if (clubhouse) clubhouse.dispose();
    clearGltfCache();
    GLTFLoader.prototype.load = originalLoad;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
