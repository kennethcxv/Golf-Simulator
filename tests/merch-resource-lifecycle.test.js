import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { createMerch } from '../src/render3d/clubhouse/merch.js';

function withLoaderStub(load, run) {
  const original = GLTFLoader.prototype.load;
  GLTFLoader.prototype.load = load;
  try {
    return run();
  } finally {
    GLTFLoader.prototype.load = original;
  }
}

function disposeSpy(resource, counter, key) {
  const original = resource.dispose.bind(resource);
  resource.dispose = () => {
    counter[key] += 1;
    original();
  };
  return resource;
}

test('visible-only bake excludes hidden and collision geometry and releases only owned output', () => {
  withLoaderStub((_url, onLoad) => onLoad({ scene: new THREE.Group(), animations: [] }), () => {
    const merch = createMerch({});
    assert.equal(merch.isReady(), true);

    const material = new THREE.MeshStandardMaterial({ color: 0x987654 });
    let materialDisposals = 0;
    const originalMaterialDispose = material.dispose.bind(material);
    material.dispose = () => { materialDisposals += 1; originalMaterialDispose(); };

    const source = new THREE.Group();
    const first = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    second.position.x = 2;
    const accidentalCollision = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), material);
    accidentalCollision.name = 'COL_VISIBLE_ACCIDENT';
    accidentalCollision.position.x = 50;
    const hidden = new THREE.Group();
    hidden.visible = false;
    const hiddenMesh = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), material);
    hiddenMesh.position.x = 100;
    hidden.add(hiddenMesh);
    source.add(first, second, accidentalCollision, hidden);

    const originalGeometryDispose = THREE.BufferGeometry.prototype.dispose;
    let intermediateDisposals = 0;
    THREE.BufferGeometry.prototype.dispose = function disposeIntermediate() {
      intermediateDisposals += 1;
      return originalGeometryDispose.call(this);
    };
    let baked;
    try {
      baked = merch.bake(source, { visibleOnly: true });
    } finally {
      THREE.BufferGeometry.prototype.dispose = originalGeometryDispose;
    }

    assert.notEqual(baked, source);
    assert.equal(baked.userData.merchBaked, true);
    assert.equal(baked.userData.merchBakeVisibleOnly, true);
    assert.equal(intermediateDisposals, 2,
      'the two temporary visible clones are disposed after their successful merge');
    const meshes = [];
    baked.traverse((object) => { if (object.isMesh) meshes.push(object); });
    assert.equal(meshes.length, 1, 'one shared material becomes one visible draw mesh');
    const bounds = new THREE.Box3().setFromObject(baked);
    assert.ok(bounds.min.x >= -0.51 && bounds.max.x <= 2.51,
      `hidden/helper bounds stay absent (${bounds.min.x}..${bounds.max.x})`);

    let bakedDisposals = 0;
    const bakedGeometry = meshes[0].geometry;
    const originalBakedDispose = bakedGeometry.dispose.bind(bakedGeometry);
    bakedGeometry.dispose = () => { bakedDisposals += 1; originalBakedDispose(); };
    assert.equal(merch.disposeBaked(baked), 1);
    assert.equal(merch.disposeBaked(baked), 0, 'repeat release is a no-op');
    assert.equal(bakedDisposals, 1);
    assert.equal(materialDisposals, 0, 'baked output never owns the shared material');

    first.geometry.dispose();
    second.geometry.dispose();
    accidentalCollision.geometry.dispose();
    hiddenMesh.geometry.dispose();
    material.dispose();
    merch.dispose();
  });
});

test('createMerch disposal is idempotent and leaves caller material ownership intact', () => {
  const disposed = { geometries: 0, materials: 0, textures: 0, tint: 0, base: 0 };
  let loadCount = 0;
  withLoaderStub((url, onLoad) => {
    loadCount += 1;
    const texture = disposeSpy(new THREE.Texture(), disposed, 'textures');
    const material = disposeSpy(new THREE.MeshStandardMaterial({ map: texture }), disposed, 'materials');
    material.name = url.includes('checkout_product_driver') ? 'M_SKUAccent' : 'M_fabric';
    const geometry = disposeSpy(new THREE.BoxGeometry(1, 1, 1), disposed, 'geometries');
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(geometry, material));
    onLoad({ scene, animations: [] });
  }, () => {
    const base = new THREE.MeshStandardMaterial({ color: 0x334455 });
    const originalBaseDispose = base.dispose.bind(base);
    base.dispose = () => { disposed.base += 1; originalBaseDispose(); };
    const tint = new THREE.MeshStandardMaterial({ color: 0x556677 });
    const originalTintDispose = tint.dispose.bind(tint);
    tint.dispose = () => { disposed.tint += 1; originalTintDispose(); };
    base.clone = () => tint;

    const merch = createMerch({ merchPlastic: base });
    assert.equal(merch.isReady(), true);
    assert.ok(merch.instantiate('checkout_product_driver', { tint: 0x78957e }));
    const owned = merch.ownedResources();
    assert.equal(owned.geometries.size, loadCount);
    assert.equal(owned.materials.size, loadCount + 1);
    assert.equal(owned.textures.size, loadCount,
      'the caller-owned texture inherited by a tint is not claimed by the loader');

    const first = merch.dispose();
    const second = merch.dispose();
    assert.deepEqual(first, {
      bakedGeometries: 0,
      tintMaterials: 1,
      prototypeTextures: loadCount,
      prototypeMaterials: loadCount,
      prototypeGeometries: loadCount,
      alreadyDisposed: false,
    });
    assert.equal(second.alreadyDisposed, true);
    assert.deepEqual({ ...second, alreadyDisposed: false }, first,
      'repeat disposal reports the same ownership totals without disposing twice');
    assert.equal(disposed.geometries, loadCount);
    assert.equal(disposed.materials, loadCount);
    assert.equal(disposed.textures, loadCount);
    assert.equal(disposed.tint, 1);
    assert.equal(disposed.base, 0, 'the caller-owned base material remains live');
    assert.equal(merch.isReady(), false);
    assert.equal(merch.has('checkout_product_driver'), false);
    assert.equal(merch.instantiate('checkout_product_driver'), null);
  });
});

test('late loader completions after disposal cannot resurrect prototypes or callbacks', () => {
  const pending = [];
  withLoaderStub((url, onLoad) => { pending.push({ url, onLoad }); }, () => {
    const merch = createMerch({});
    let readyCallbacks = 0;
    merch.onReady(() => { readyCallbacks += 1; });
    const summary = merch.dispose();
    assert.equal(summary.prototypeGeometries, 0);

    const disposed = { geometries: 0, materials: 0, textures: 0 };
    for (const request of pending) {
      const texture = disposeSpy(new THREE.Texture(), disposed, 'textures');
      const material = disposeSpy(new THREE.MeshStandardMaterial({ map: texture }), disposed, 'materials');
      const geometry = disposeSpy(new THREE.BoxGeometry(1, 1, 1), disposed, 'geometries');
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(geometry, material));
      request.onLoad({ scene, animations: [] });
    }

    assert.equal(disposed.geometries, pending.length);
    assert.equal(disposed.materials, pending.length);
    assert.equal(disposed.textures, pending.length);
    assert.equal(readyCallbacks, 0);
    assert.equal(merch.isReady(), false);
    assert.equal(merch.has('delivery_wooden_pallet'), false);
  });
});
