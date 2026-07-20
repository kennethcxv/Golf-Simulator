import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { SHOP_CATALOG, RETAIL_CATS } from '../src/data/shopItems.js';
import { boxKindFor } from '../src/data/boxes.js';
import {
  PACKAGING_LAYOUTS,
  dimensionsFitUnderRotation,
  productPackagingFor,
} from '../src/data/productPackaging.js';
import {
  buildCatalogProductProxy,
  catalogCheckoutLayout,
  catalogProductVisual,
  drawProductThumbnail,
  explicitCatalogVisualIds,
} from '../src/render3d/clubhouse/catalogProductVisual.js';
import {
  deliveryBoxVisualConfig,
  deliveryContentContract,
  selectDeliveryContentLayout,
} from '../src/render3d/clubhouse/deliveryBoxVisual.js';
import { createRegisterItemResources } from '../src/render3d/clubhouse/registerItemResources.js';
import { createMerch } from '../src/render3d/clubhouse/merch.js';

const retail = SHOP_CATALOG.filter((sku) => RETAIL_CATS.has(sku.cat));
const RAW_TWO_HAND_SKUS = Object.freeze(['vac1', 'board1', 'rug1', 'lounge1']);

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

async function loadScenes(models) {
  const scenes = new Map();
  for (const model of models) {
    const bytes = await readFile(new URL(`../vendor/models/clubhouse/${model}.glb`, import.meta.url));
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
    scenes.set(model, gltf.scene);
  }
  return scenes;
}

async function loadProductScenes() {
  // Original provisions retain embedded brand art and are validated by the
  // dedicated binary/reimport suite. Node's GLTFLoader has no browser image
  // decoder, so this structural checkout-family loader covers non-textured GLBs.
  const models = [...new Set(retail
    .map((sku) => catalogProductVisual(sku))
    .filter((visual) => !visual.raw)
    .map((visual) => visual.model))];
  models.push('checkout_product_headcover');
  return loadScenes(models);
}

async function glbNodeNames(model) {
  const bytes = await readFile(new URL(`../vendor/models/clubhouse/${model}.glb`, import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${model} is a GLB`);
  assert.equal(bytes.readUInt32LE(4), 2, `${model} uses glTF 2`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${model} GLB is complete`);
  let json = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(bytes.subarray(offset + 8, offset + 8 + chunkLength).toString('utf8'));
    }
    offset += 8 + chunkLength;
  }
  assert.ok(json, `${model} has a JSON chunk`);
  return new Set((json.nodes || []).map((node) => node.name).filter(Boolean));
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

test('all 41 catalog SKUs resolve explicit physical descriptors aligned to exact delivery contracts', () => {
  const catalogIds = SHOP_CATALOG.map((sku) => sku.id).sort();
  assert.equal(SHOP_CATALOG.length, 41, 'the audited catalog count changed');
  assert.deepEqual(explicitCatalogVisualIds().sort(), catalogIds,
    'explicit visuals neither omit a catalog SKU nor retain a stale generic entry');

  for (const sku of SHOP_CATALOG) {
    const visual = catalogProductVisual(sku);
    const packaging = productPackagingFor(sku.id);
    const kind = boxKindFor(sku);
    const boxVisual = deliveryBoxVisualConfig(kind.id);
    const delivery = deliveryContentContract({ id: `coverage-${sku.id}`, skuId: sku.id, box: kind.id });

    assert.notEqual(visual.kind, 'unknown-product', `${sku.id} cannot use the unknown cube fallback`);
    assert.ok(String(visual.model).length > 5 || (sku.campaign && visual.kind.startsWith('packed-')),
      `${sku.id} names a physical GLB or an explicit campaign flat-pack proxy`);
    assert.equal(visual.size.length, 3, `${sku.id} declares three runtime dimensions`);
    assert.ok(visual.size.every((value) => Number.isFinite(value) && value > 0),
      `${sku.id} dimensions are finite and positive`);
    assert.ok(['club-tag', 'hang-tag', 'apparel-tag', 'package-side', 'package-back'].includes(visual.barcodeSurface),
      `${sku.id} declares a real barcode surface`);
    assert.ok(['small', 'medium', 'two-hand'].includes(visual.gripMode), `${sku.id} declares a grip mode`);

    // Sellable goods render their real unpacked product bounds. Equipment and
    // decor deliberately render the exact packed assembly removed from freight.
    const expectedDimensions = packaging.retail
      ? packaging.physicalDimensions
      : packaging.packing.dimensions;
    assert.deepEqual(visual.size, [expectedDimensions.w, expectedDimensions.h, expectedDimensions.d],
      `${sku.id} visual dimensions agree with its ${packaging.retail ? 'physical' : 'packed'} contract`);

    assert.equal(kind.modelId, packaging.box.modelId, `${sku.id} box kind preserves the contract model`);
    assert.equal(boxVisual.model, packaging.box.modelId, `${sku.id} renderer selects the exact authored shell`);
    assert.equal(delivery.familyId, packaging.familyId, `${sku.id} family alignment`);
    assert.equal(delivery.layoutId, packaging.layoutId, `${sku.id} socket layout alignment`);
    assert.equal(delivery.shellId, packaging.box.shellId, `${sku.id} shell alignment`);
    assert.equal(delivery.modelId, packaging.box.modelId, `${sku.id} delivery model alignment`);
    assert.equal(delivery.packingState, packaging.packing.state, `${sku.id} packed-state alignment`);
    assert.equal(delivery.packingOrientation, packaging.packing.orientation, `${sku.id} orientation alignment`);
    assert.equal(delivery.capacity, packaging.unitsPerBox, `${sku.id} exact quantity alignment`);
    assert.equal(delivery.contentScale, 1, `${sku.id} forbids a shrink fallback`);
  }

  assert.equal(catalogProductVisual({ id: 'future-unmapped' }).kind, 'unknown-product',
    'unknown products remain visibly exceptional instead of masquerading as an authored SKU');
});

test('all 41 SKU selections satisfy their shipped carton layout metadata at runtime', async () => {
  const models = [...new Set(SHOP_CATALOG.map((sku) => productPackagingFor(sku.id).box.modelId))];
  const cartonScenes = await loadScenes(models);
  for (const sku of SHOP_CATALOG) {
    const contract = productPackagingFor(sku.id);
    const scene = cartonScenes.get(contract.box.modelId).clone(true);
    const selected = selectDeliveryContentLayout(scene, contract.layoutId, contract.unitsPerBox, {
      skuId: sku.id,
      shellId: contract.box.shellId,
      modelId: contract.box.modelId,
      packingState: contract.packing.state,
      allowScale: false,
    });
    assert.equal(selected.layoutRoot.name, `CONTENT_LAYOUT_${contract.layoutId}`);
    assert.equal(selected.sockets.length, contract.unitsPerBox);
  }
});

test('every raw catalog model ships its authored pickup target and barcode anchor where applicable', async () => {
  const rawSkus = SHOP_CATALOG.filter((sku) => {
    const visual = catalogProductVisual(sku);
    return visual.raw && visual.model;
  });
  assert.deepEqual(rawSkus.map((sku) => sku.id).sort(),
    ['board1', 'light1', 'lounge1', 'plant1', 'poster1', 'rug1', 'snack1', 'vac1', 'water1']);

  for (const sku of rawSkus) {
    const visual = catalogProductVisual(sku);
    const names = await glbNodeNames(visual.model);
    assert.ok(names.has('PICKUP_TARGET'), `${sku.id}/${visual.model} retains its authored pickup target`);
    if (visual.kind === 'packed-furniture') {
      assert.equal(visual.barcodeSurface, 'package-back', `${sku.id} explicitly requests a runtime freight label`);
    } else {
      assert.ok(names.has('BARCODE_AREA'), `${sku.id}/${visual.model} retains its authored barcode area`);
    }
  }
});

test('raw two-hand freight preserves PICKUP_TARGET and synthesizes only the support hand', async () => {
  const models = RAW_TWO_HAND_SKUS.map((id) => (
    catalogProductVisual(SHOP_CATALOG.find((sku) => sku.id === id)).model
  ));
  const scenes = await loadScenes(models);
  const merch = merchFrom(scenes);

  for (const id of RAW_TWO_HAND_SKUS) {
    const sku = SHOP_CATALOG.find((entry) => entry.id === id);
    const resources = createRegisterItemResources();
    const built = buildCatalogProductProxy({ sku, merch, resources });
    const authoredPickup = built.root.getObjectByName('PICKUP_TARGET');
    const support = built.root.getObjectByName('ANCHOR_ProductGripSecondary');

    assert.ok(authoredPickup, `${id} has its shipped PICKUP_TARGET at runtime`);
    assert.equal(built.gripAnchors.primary, authoredPickup, `${id} keeps the authored target as primary`);
    assert.equal(built.root.userData.gripPrimary, authoredPickup, `${id} exposes that same primary to interaction`);
    assert.equal(built.gripAnchors.secondary, support, `${id} exposes one synthesized support hand`);
    assert.equal(support.parent, built.root, `${id} support hand is runtime-owned`);
    const authoredProduct = built.root.children[0];
    assert.equal(authoredProduct.userData.catalogRuntimeScalePolicy, 'authored-1:1',
      `${id} honors the shipped allow_runtime_scale=false policy`);
    assert.deepEqual(authoredProduct.scale.toArray(), [1, 1, 1],
      `${id} exact raw assembly bypasses fitAuthored scaling`);
    const spacing = authoredPickup.getWorldPosition(new THREE.Vector3()).distanceTo(
      support.getWorldPosition(new THREE.Vector3()),
    );
    assert.ok(spacing >= 0.08 && spacing <= 0.241,
      `${id} support-hand spacing is practical (${spacing}m)`);

    resources.dispose(built.root);
  }
});

test('exact raw product metadata bypasses runtime fitting without losing anchors', () => {
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
  const built = buildCatalogProductProxy({ sku, merch, resources, context: 'delivery-packed' });

  assert.equal(built.root.children[0], source, 'the exact raw hierarchy is attached directly, not through a fitter');
  assert.deepEqual(source.scale.toArray(), [1, 1, 1]);
  assert.equal(source.userData.catalogRuntimeScalePolicy, 'authored-1:1');
  assert.equal(built.barcodeAnchor.position.distanceTo(barcode.position), 0,
    'the raw authored barcode area remains the logical label location');
  assert.equal(built.gripAnchors.primary, pickup, 'the raw authored pickup target remains primary');
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
      assert.ok(built.barcodeAnchor, `${sku.id} retains a runtime barcode contract during decoder fallback`);
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

test('delivery-packed proxies omit checkout swing tags and preserve exact socket-fit contracts', async () => {
  const ids = ['glove1', 'cap1', 'range2', 'umb1'];
  const skus = ids.map((id) => SHOP_CATALOG.find((sku) => sku.id === id));
  const scenes = await loadScenes(skus.map((sku) => catalogProductVisual(sku).model));
  const merch = merchFrom(scenes);

  for (const sku of skus) {
    const checkoutResources = createRegisterItemResources();
    const checkout = buildCatalogProductProxy({ sku, merch, resources: checkoutResources });
    assert.ok(checkout.root.getObjectByName('ProductSwingTag'),
      `${sku.id} keeps its checkout swing tag by default`);

    const deliveryResources = createRegisterItemResources();
    const packed = buildCatalogProductProxy({
      sku,
      merch,
      resources: deliveryResources,
      context: 'delivery-packed',
    });
    assert.equal(packed.root.userData.catalogProductContext, 'delivery-packed');
    assert.equal(packed.root.getObjectByName('ProductSwingTag'), undefined,
      `${sku.id} has no generated checkout tag inside its carton`);
    assert.deepEqual(packed.root.scale.toArray(), [1, 1, 1],
      `${sku.id} delivery wrapper remains at authored scale`);

    const visual = catalogProductVisual(sku);
    const actual = visibleBounds(packed.root).getSize(new THREE.Vector3());
    for (const [axis, target] of Object.entries({ x: visual.size[0], y: visual.size[1], z: visual.size[2] })) {
      const ratio = actual[axis] / target;
      assert.ok(ratio >= 0.92 && ratio <= 1.08,
        `${sku.id} actual ${axis} bounds remain physical at 1:1 (${actual[axis]}m versus ${target}m)`);
    }

    const contract = productPackagingFor(sku.id);
    const layout = PACKAGING_LAYOUTS[contract.layoutId];
    assert.equal(
      dimensionsFitUnderRotation(contract.packing.dimensions, layout.slotMaxDimensions),
      true,
      `${sku.id} packed occupied bounds fit the exact ${contract.layoutId} socket without scaling`,
    );

    checkoutResources.dispose(checkout.root);
    deliveryResources.dispose(packed.root);
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
