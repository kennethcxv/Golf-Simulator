import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { SHOP_CATALOG, RETAIL_CATS } from '../src/data/shopItems.js';
import {
  buildCatalogProductProxy,
  catalogCheckoutLayout,
  catalogProductVisual,
  drawProductThumbnail,
  explicitCatalogVisualIds,
} from '../src/render3d/clubhouse/catalogProductVisual.js';
import { createRegisterItemResources } from '../src/render3d/clubhouse/registerItemResources.js';
import { createMerch } from '../src/render3d/clubhouse/merch.js';

const retail = SHOP_CATALOG.filter((sku) => RETAIL_CATS.has(sku.cat));

function visibleBounds(root, { excludeRuntimeTag = false } = {}) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  root.traverse((object) => {
    if (!object.isMesh || object.visible === false || !object.geometry || object.name.startsWith('COL_')) return;
    if (excludeRuntimeTag && object.name === 'ProductSwingTag') return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
  });
  return bounds;
}

async function loadProductScenes() {
  // Original provisions retain embedded brand art and are validated separately.
  // Node's GLTFLoader has no browser image decoder, so this structural family
  // loader covers the non-textured checkout GLBs and skips raw products.
  const models = [...new Set(retail
    .map((sku) => catalogProductVisual(sku))
    .filter((visual) => !visual.raw)
    .map((visual) => visual.model))];
  models.push('checkout_product_headcover');
  const scenes = new Map();
  for (const model of models) {
    const bytes = await readFile(new URL(`../vendor/models/clubhouse/${model}.glb`, import.meta.url));
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
    scenes.set(model, gltf.scene);
  }
  return scenes;
}

function merchFrom(scenes) {
  return {
    has: (name) => scenes.has(name),
    instantiate(name) {
      const clone = scenes.get(name)?.clone(true) || null;
      if (clone) clone.traverse((object) => {
        if (object.name.startsWith('COL_') || object.name.startsWith('VOLUME_')) object.visible = false;
      });
      return clone;
    },
    instantiateRaw(name) { return this.instantiate(name); },
  };
}

function fakeCanvasContext() {
  const calls = [];
  const ctx = { calls };
  for (const method of ['save', 'restore', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc', 'ellipse', 'fillText']) {
    ctx[method] = (...args) => calls.push([method, ...args]);
  }
  return ctx;
}

test('every sellable catalog SKU has an explicit physical family, barcode surface and grip', () => {
  const ids = new Set(explicitCatalogVisualIds());
  assert.equal(retail.length, 27);
  for (const sku of retail) {
    const visual = catalogProductVisual(sku);
    assert.ok(ids.has(sku.id), `${sku.id} has an explicit checkout visual`);
    assert.notEqual(visual.kind, 'unknown-product', `${sku.id} never falls through to a box`);
    assert.ok(
      visual.model?.startsWith('checkout_product_') || (visual.raw && visual.model?.startsWith('provisions_')),
      `${sku.id} prefers its explicit Blender GLB`,
    );
    assert.ok(visual.barcodeSurface, `${sku.id} has a logical barcode/tag surface`);
    assert.ok(['small', 'medium', 'two-hand'].includes(visual.gripMode), `${sku.id} has a grip class`);
  }
  assert.equal(catalogProductVisual({ id: 'future-headcover', name: 'Driver head cover' }).kind, 'headcover');
});

test('exact raw provisions metadata bypasses runtime fitting without losing anchors', () => {
  const sku = SHOP_CATALOG.find((entry) => entry.id === 'water1');
  const descriptor = catalogProductVisual(sku);
  const source = new THREE.Group();
  source.name = descriptor.model;
  source.userData.allow_runtime_scale = false;
  const body = new THREE.Mesh(new THREE.BoxGeometry(...descriptor.size), new THREE.MeshStandardMaterial());
  body.position.y = descriptor.size[1] / 2;
  source.add(body);
  const barcode = new THREE.Object3D();
  barcode.name = 'BARCODE_AREA';
  source.add(barcode);
  const pickup = new THREE.Object3D();
  pickup.name = 'PICKUP_TARGET';
  source.add(pickup);
  const merch = {
    has: (model) => model === descriptor.model,
    instantiateRaw: () => source,
  };
  const resources = createRegisterItemResources();
  const built = buildCatalogProductProxy({ sku, merch, resources });

  assert.equal(built.root.children[0], source, 'the raw hierarchy is attached directly');
  assert.deepEqual(source.scale.toArray(), [1, 1, 1]);
  assert.equal(source.userData.catalogRuntimeScalePolicy, 'authored-1:1');
  assert.equal(built.barcodeAnchor.position.distanceTo(barcode.position), 0,
    'the authored barcode area remains the logical label location');
  assert.equal(built.gripAnchors.primary, pickup, 'the authored pickup target remains primary');
  resources.dispose(built.root);
});

test('POS thumbnails are product silhouettes, never category-initial text tiles', () => {
  const kinds = new Set();
  for (const sku of retail) {
    const ctx = fakeCanvasContext();
    kinds.add(drawProductThumbnail(ctx, sku, 0, 0, true, 16));
    assert.equal(ctx.calls.some(([method]) => method === 'fillText'), false, `${sku.id} icon draws no category initials`);
    assert.ok(ctx.calls.some(([method]) => ['lineTo', 'arc', 'ellipse', 'strokeRect'].includes(method)), `${sku.id} draws a real silhouette`);
  }
  assert.ok(kinds.size >= 16, `catalog exposes ${kinds.size} distinct product silhouettes`);
});

test('size-aware layout keeps oversize products flat and separated from compact goods', () => {
  const items = [
    { sku: SHOP_CATALOG.find((sku) => sku.id === 'driver1') },
    { sku: SHOP_CATALOG.find((sku) => sku.id === 'balls1') },
    { sku: SHOP_CATALOG.find((sku) => sku.id === 'bag1') },
  ];
  const staging = { minX: 2.3, maxX: 3.1, minZ: 3.78, maxZ: 4.12 };
  const poses = catalogCheckoutLayout(items, staging, 1.067);
  assert.deepEqual(poses.map((pose) => pose.sizeClass), ['oversize', 'compact', 'oversize']);
  assert.equal(poses[0].x, (staging.minX + staging.maxX) / 2);
  assert.equal(poses[2].x, poses[0].x);
  assert.ok(poses[1].z > poses[0].z, 'compact item uses the clear row behind long goods');
});

test('shipped family GLBs retain authored anchors, collisions, dimensions and tint slots', async () => {
  const scenes = await loadProductScenes();
  for (const [model, scene] of scenes) {
    assert.ok(scene.getObjectByName('ANCHOR_ProductBarcode'), `${model} barcode anchor`);
    assert.ok(scene.getObjectByName('ANCHOR_ProductGripPrimary'), `${model} primary grip`);
    assert.ok(scene.getObjectByName('COL_Product'), `${model} simplified collision`);
    const bounds = visibleBounds(scene);
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.x > 0.02 && size.y > 0.02 && size.z > 0.015, `${model} has non-degenerate authored bounds`);
    scene.traverse((object) => {
      if (!object.isMesh) return;
      assert.ok(Math.abs(object.scale.x - 1) < 1e-5, `${model}/${object.name} applied scale x`);
      assert.ok(Math.abs(object.scale.y - 1) < 1e-5, `${model}/${object.name} applied scale y`);
      assert.ok(Math.abs(object.scale.z - 1) < 1e-5, `${model}/${object.name} applied scale z`);
      assert.ok(object.geometry.attributes.uv, `${model}/${object.name} has UVs`);
    });
  }
  for (const model of ['checkout_product_driver', 'checkout_product_iron_set', 'checkout_product_putter', 'checkout_product_wedge', 'checkout_product_ball_carton']) {
    const names = new Set();
    scenes.get(model).traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material) names.add(material.name);
    });
    assert.ok(names.has('M_SKUAccent'), `${model} exposes one cache-tinted SKU identity slot`);
  }
});

test('sibling SKU tiers use distinct identity tints backed by one cached material per tint', () => {
  const drivers = ['driver1', 'driver2', 'driver3'].map((id) => catalogProductVisual(retail.find((sku) => sku.id === id)));
  assert.equal(new Set(drivers.map((visual) => visual.tint)).size, 3, 'driver tiers declare three visual identities');

  const originalLoad = GLTFLoader.prototype.load;
  try {
    GLTFLoader.prototype.load = function loadStub(url, onLoad) {
      const scene = new THREE.Group();
      const source = new THREE.MeshStandardMaterial({ color: 0x666666 });
      source.name = url.includes('checkout_product_driver') ? 'M_SKUAccent' : 'M_fabric';
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), source));
      onLoad({ scene, animations: [] });
    };
    const accentBase = new THREE.MeshStandardMaterial({ color: 0x777777 });
    const fabricBase = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const merch = createMerch({ merchPlastic: accentBase, merchFabric: fabricBase, charcoal: fabricBase });
    assert.equal(merch.isReady(), true);

    const first = merch.instantiate('checkout_product_driver', { tint: drivers[0].tint });
    const sibling = merch.instantiate('checkout_product_driver', { tint: drivers[0].tint });
    const nextTier = merch.instantiate('checkout_product_driver', { tint: drivers[1].tint });
    const firstMesh = first.getObjectByProperty('isMesh', true);
    const siblingMesh = sibling.getObjectByProperty('isMesh', true);
    const nextTierMesh = nextTier.getObjectByProperty('isMesh', true);
    assert.equal(firstMesh.geometry, siblingMesh.geometry, 'sibling instances share authored GLB geometry');
    assert.equal(firstMesh.material, siblingMesh.material, 'same tier reuses one stable cached tint material');
    assert.notEqual(firstMesh.material, nextTierMesh.material, 'different tiers receive distinct cached tint materials');
    assert.equal(firstMesh.material.color.getHex(), drivers[0].tint);
    assert.equal(nextTierMesh.material.color.getHex(), drivers[1].tint);
    assert.equal(accentBase.color.getHex(), 0x777777, 'shared base material is never mutated');
  } finally {
    GLTFLoader.prototype.load = originalLoad;
  }
});

test('GLB-preferred proxies fit declared dimensions and use authored barcode positions with logical scan orientation', async () => {
  const scenes = await loadProductScenes();
  const merch = merchFrom(scenes);
  for (const sku of retail) {
    const visual = catalogProductVisual(sku);
    const resources = createRegisterItemResources();
    const built = buildCatalogProductProxy({ sku, merch, resources });
    const coreBounds = visibleBounds(built.root, { excludeRuntimeTag: true });
    const coreSize = coreBounds.getSize(new THREE.Vector3());
    const fullSize = visibleBounds(built.root).getSize(new THREE.Vector3());
    const target = visual.size;
    const axes = ['x', 'y', 'z'];
    for (let axis = 0; axis < axes.length; axis++) {
      const ratio = coreSize[axes[axis]] / target[axis];
      assert.ok(
        ratio >= 0.92 && ratio <= 1.08,
        `${sku.id} authored ${axes[axis]} axis remains within 8% of ${target[axis]}m (got ${coreSize[axes[axis]]}m, ratio ${ratio})`,
      );
    }
    const majorRatio = Math.max(...coreSize.toArray()) / Math.max(...target);
    assert.ok(majorRatio >= 0.92 && majorRatio <= 1.08, `${sku.id} major axis does not collapse during Three Y-up fit`);

    // A physical 78x46 mm swing tag may protrude beyond thin softgoods. This
    // clearance is measured separately so it cannot mask product-scale collapse.
    for (const axis of axes) {
      assert.ok(
        fullSize[axis] - coreSize[axis] <= 0.05,
        `${sku.id} physical tag protrusion on ${axis} stays within 50mm (core ${coreSize[axis]}m, full ${fullSize[axis]}m)`,
      );
    }

    const authoredBarcode = built.root.getObjectByName('ANCHOR_ProductBarcode');
    if (visual.raw) {
      assert.ok(built.barcodeAnchor, `${sku.id} retains a barcode contract during decoder fallback`);
    } else {
      assert.ok(authoredBarcode, `${sku.id} retains authored barcode anchor`);
      const sourcePoint = authoredBarcode.getWorldPosition(new THREE.Vector3());
      const runtimePoint = built.barcodeAnchor.getWorldPosition(new THREE.Vector3());
      assert.ok(sourcePoint.distanceTo(runtimePoint) < 1e-6, `${sku.id} runtime label uses authored position`);
    }

    const initialNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(built.barcodeAnchor.getWorldQuaternion(new THREE.Quaternion()));
    if (visual.barcodeSurface !== 'package-back') assert.ok(initialNormal.z < -0.98, `${sku.id} label initially faces cashier-side -Z`);
    built.root.rotation.x = -Math.PI / 2;
    const scanNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(built.barcodeAnchor.getWorldQuaternion(new THREE.Quaternion()));
    if (visual.barcodeSurface !== 'package-back') assert.ok(scanNormal.y < -0.98, `${sku.id} one physical quarter-turn faces scanner glass`);

    assert.equal(built.gripAnchors.primary, built.root.getObjectByName('ANCHOR_ProductGripPrimary'));
    if (visual.gripMode === 'two-hand') {
      assert.equal(built.gripAnchors.secondary, built.root.getObjectByName('ANCHOR_ProductGripSecondary'));
      assert.ok(built.gripAnchors.primary.getWorldPosition(new THREE.Vector3()).distanceTo(
        built.gripAnchors.secondary.getWorldPosition(new THREE.Vector3()),
      ) > 0.08, `${sku.id} has distinct support-hand spacing`);
    }
    resources.dispose(built.root);
  }
});

test('owned runtime tag resources dispose once while shared GLB geometry and materials survive', async () => {
  const scenes = await loadProductScenes();
  const sharedGeometry = scenes.get('checkout_product_driver').getObjectByProperty('isMesh', true).geometry;
  const sharedMaterial = scenes.get('checkout_product_driver').getObjectByProperty('isMesh', true).material;
  let geometryDisposals = 0;
  let materialDisposals = 0;
  sharedGeometry.addEventListener('dispose', () => { geometryDisposals++; });
  sharedMaterial.addEventListener('dispose', () => { materialDisposals++; });
  const resources = createRegisterItemResources();
  const built = buildCatalogProductProxy({
    sku: SHOP_CATALOG.find((sku) => sku.id === 'driver1'),
    merch: merchFrom(scenes),
    resources,
  });
  const first = resources.dispose(built.root);
  assert.ok(first.geometries >= 1, 'runtime swing-tag backing is owned');
  assert.deepEqual(resources.dispose(built.root), { geometries: 0, materials: 0 });
  assert.equal(geometryDisposals, 0, 'shared GLB geometry survives transaction cleanup');
  assert.equal(materialDisposals, 0, 'shared GLB material survives transaction cleanup');
});
