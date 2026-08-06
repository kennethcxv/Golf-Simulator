import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { skuById } from '../src/data/shopItems.js';
import { createDeliveryBoxVisual } from '../src/render3d/clubhouse/deliveryBoxVisual.js';

const WATER_CARTON_COUNT = 20;
const REVIEWER_BASELINE_PER_CARTON = Object.freeze({
  objects: 781,
  meshes: 643,
  triangles: 83268,
});
// TAGS (2026-08-06): 81360 before the water bottle's printed barcode came off.
// The bottles are instanced per carton, so removing a cream backing plus
// thirteen charcoal bars from ONE product took 3,168 triangles off every
// carton — 63,360 across the twenty this test builds.
const EFFECTIVELY_VISIBLE_TRIANGLES_PER_CARTON = 78192;

// The carton shell itself remains an authored hierarchy. These gates isolate
// the avoidable contents multiplier while leaving headroom for metadata nodes:
// <=120 objects and <=64 meshes per carton, plus one common census root.
const WORST_CASE_BUDGET = Object.freeze({
  objects: WATER_CARTON_COUNT * 120 + 1,
  meshes: WATER_CARTON_COUNT * 64,
  visibleMeshes: WATER_CARTON_COUNT * 45,
  contentBatches: WATER_CARTON_COUNT * 7,
  geometries: 180,
  materials: 16,
  uniqueGeometryTriangles: 140000,
  triangles: WATER_CARTON_COUNT * REVIEWER_BASELINE_PER_CARTON.triangles,
});

const ASSETS = Object.freeze({
  delivery_bulk_provisions_carton: fileURLToPath(new URL(
    '../vendor/models/clubhouse/delivery_bulk_provisions_carton.glb',
    import.meta.url,
  )),
  provisions_fairway_spring_water: fileURLToPath(new URL(
    '../vendor/models/clubhouse/provisions_fairway_spring_water.glb',
    import.meta.url,
  )),
});

async function parseGlb(path) {
  const bytes = await readFile(path);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

async function productionMerchStub() {
  const prototypes = new Map(await Promise.all(Object.entries(ASSETS).map(async ([id, path]) => (
    [id, await parseGlb(path)]
  ))));
  return {
    prototypes,
    merch: {
      has: (id) => prototypes.has(id),
      instantiate: (id) => prototypes.get(id)?.clone(true) || null,
      instantiateRaw: (id) => prototypes.get(id)?.clone(true) || null,
    },
  };
}

function trianglesFor(object) {
  const count = object.geometry?.index?.count
    ?? object.geometry?.attributes?.position?.count
    ?? 0;
  return count / 3 * (object.isInstancedMesh ? object.count : 1);
}

function census(root, { visibleOnly = false } = {}) {
  const geometries = new Set();
  const materials = new Set();
  const totals = {
    objects: 0,
    meshes: 0,
    instancedMeshes: 0,
    drawSubmissions: 0,
    contentPlaceholders: 0,
    triangles: 0,
  };
  const visit = (object) => {
    totals.objects += 1;
    if (object.userData?.deliveryContentPlaceholder) totals.contentPlaceholders += 1;
    if (!object.isMesh) return;
    totals.meshes += 1;
    if (object.isInstancedMesh) totals.instancedMeshes += 1;
    if (!object.isInstancedMesh || object.count > 0) {
      totals.drawSubmissions += Array.isArray(object.material)
        ? Math.max(1, object.geometry?.groups?.length || object.material.length)
        : 1;
    }
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) materials.add(material);
    }
    totals.triangles += trianglesFor(object);
  };
  if (visibleOnly) root.traverseVisible(visit);
  else root.traverse(visit);
  return {
    ...totals,
    geometries: geometries.size,
    materials: materials.size,
    uniqueGeometryTriangles: [...geometries].reduce((sum, geometry) => (
      sum + (geometry.index?.count ?? geometry.attributes?.position?.count ?? 0) / 3
    ), 0),
  };
}

function matrixNearlyEqual(actual, expected, message) {
  actual.elements.forEach((value, index) => {
    assert.ok(Math.abs(value - expected.elements[index]) <= 1e-6,
      `${message} matrix[${index}] ${value} != ${expected.elements[index]}`);
  });
}

function openWaterBox(id) {
  return {
    id,
    box: 'provisions',
    skuId: 'water1',
    qty: 12,
    initialQty: 12,
    cap: 12,
    lifecycle: 'OPEN',
    tape: 1,
    flapProgress: [1, 1, 1, 1],
  };
}

test('twenty full open water cartons batch exact contents within deterministic resource budgets', async () => {
  const { merch, prototypes } = await productionMerchStub();
  const sku = skuById('water1');
  const scene = new THREE.Group();
  const visuals = [];
  for (let index = 0; index < WATER_CARTON_COUNT; index += 1) {
    const result = createDeliveryBoxVisual({
      box: openWaterBox(8100 + index),
      sku,
      merch,
      mats: null,
    });
    assert.ok(result?.authored);
    scene.add(result.root);
    visuals.push(result);
  }

  const ownedBatchGeometries = new Set(visuals.flatMap((visual) => (
    visual.contentBatches.map((batch) => batch.geometry)
  )));
  const batchDisposeCounts = new Map();
  const geometryDisposeCounts = new Map();
  for (const visual of visuals) {
    for (const batch of visual.contentBatches) {
      batchDisposeCounts.set(batch, 0);
      batch.addEventListener('dispose', () => {
        batchDisposeCounts.set(batch, batchDisposeCounts.get(batch) + 1);
      });
    }
  }
  for (const geometry of ownedBatchGeometries) {
    geometryDisposeCounts.set(geometry, 0);
    geometry.addEventListener('dispose', () => {
      geometryDisposeCounts.set(geometry, geometryDisposeCounts.get(geometry) + 1);
    });
  }

  const prototypeResources = { geometries: new Set(), materials: new Set() };
  for (const prototype of prototypes.values()) {
    prototype.traverse((object) => {
      if (object.geometry) prototypeResources.geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material) prototypeResources.materials.add(material);
      }
    });
  }
  let prototypeDisposals = 0;
  const notePrototypeDisposal = () => { prototypeDisposals += 1; };
  for (const resource of [...prototypeResources.geometries, ...prototypeResources.materials]) {
    resource.addEventListener('dispose', notePrototypeDisposal);
  }

  try {
    const all = census(scene);
    const visible = census(scene, { visibleOnly: true });
    // TAGS (2026-08-06): the water bottle's printed barcode — a cream backing
    // plus thirteen charcoal bars — is gone, and since the bottles are
    // instanced per carton the saving multiplies: 20 fewer instanced meshes,
    // 20 fewer geometries, one fewer material, and 63,360 fewer triangles
    // across twenty cartons. The census is exact on purpose, so it moved.
    assert.deepEqual(all, {
      objects: 2301,
      meshes: 1200,
      instancedMeshes: 100,
      drawSubmissions: 1200,
      contentPlaceholders: 240,
      triangles: 1599120,
      geometries: 155,
      materials: 13,
      uniqueGeometryTriangles: 129428,
    });
    assert.deepEqual(visible, {
      objects: 1641,
      meshes: 820,
      instancedMeshes: 100,
      drawSubmissions: 820,
      contentPlaceholders: 240,
      triangles: WATER_CARTON_COUNT * EFFECTIVELY_VISIBLE_TRIANGLES_PER_CARTON,
      geometries: 136,
      materials: 11,
      uniqueGeometryTriangles: 127664,
    });
    assert.ok(all.objects <= WORST_CASE_BUDGET.objects);
    assert.ok(all.meshes <= WORST_CASE_BUDGET.meshes);
    assert.ok(visible.meshes <= WORST_CASE_BUDGET.visibleMeshes);
    assert.ok(all.instancedMeshes <= WORST_CASE_BUDGET.contentBatches);
    assert.ok(all.geometries <= WORST_CASE_BUDGET.geometries);
    assert.ok(all.materials <= WORST_CASE_BUDGET.materials);
    assert.ok(all.uniqueGeometryTriangles <= WORST_CASE_BUDGET.uniqueGeometryTriangles);
    assert.ok(all.triangles <= WORST_CASE_BUDGET.triangles);
    assert.ok(all.objects <= WATER_CARTON_COUNT * REVIEWER_BASELINE_PER_CARTON.objects * 0.16,
      'object count is at least 84% below the reviewer baseline');
    assert.ok(all.meshes <= WATER_CARTON_COUNT * REVIEWER_BASELINE_PER_CARTON.meshes * 0.10,
      'mesh count is at least 90% below the reviewer baseline');

    const authoredCarton = prototypes.get('delivery_bulk_provisions_carton');
    for (let index = 1; index <= 12; index += 1) {
      const suffix = String(index).padStart(2, '0');
      const expectedSocket = authoredCarton.getObjectByName(`CONTENT_SLOT_DRINK12_${suffix}`);
      const actualSocket = visuals[0].root.getObjectByName(`CONTENT_SLOT_DRINK12_${suffix}`);
      const placeholder = visuals[0].root.getObjectByName(`BOX_CONTENT_${suffix}_water1`);
      expectedSocket.updateMatrix();
      actualSocket.updateMatrix();
      matrixNearlyEqual(actualSocket.matrix, expectedSocket.matrix, `socket ${suffix}`);
      assert.equal(placeholder.parent, actualSocket);
      assert.deepEqual(placeholder.scale.toArray(), [1, 1, 1]);
      assert.equal(placeholder.visible, true);
    }

    for (const visual of visuals) {
      // Five, not six, since 2026-08-06: the charcoal the water bottle's
      // printed barcode bars used was that product's ONLY use of it, so
      // removing the code removed a whole batch as well as its triangles.
      assert.equal(visual.contentBatches.length, 5,
        'the visible source meshes merge to the five visible authored materials');
      // 34, not 48: the fourteen meshes of the bottle's printed barcode (a
      // cream backing plus thirteen charcoal bars) are gone from the source.
      assert.equal(visual.contentBatches
        .reduce((sum, batch) => sum + batch.userData.deliveryContentSourceMeshCount, 0), 34);
      assert.equal(visual.contentBatches.reduce((sum, batch) => (
        sum + (batch.geometry.index?.count ?? batch.geometry.attributes.position.count) / 3
      ), 0), 6184, 'one exact visible water unit retains all non-collision triangles');
      assert.ok(visual.contentBatches.every((batch) => batch.count === 12));
    }

    const first = visuals[0];
    first.contentBatchRoot.updateWorldMatrix(true, true);
    const batchInverse = first.contentBatchRoot.matrixWorld.clone().invert();
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 12; index += 1) {
      const suffix = String(index + 1).padStart(2, '0');
      const placeholder = first.root.getObjectByName(`BOX_CONTENT_${suffix}_water1`);
      placeholder.updateWorldMatrix(true, false);
      const expected = new THREE.Matrix4().multiplyMatrices(batchInverse, placeholder.matrixWorld);
      first.contentBatches[0].getMatrixAt(index, matrix);
      matrixNearlyEqual(matrix, expected, `water instance ${suffix}`);
    }

    first.update({ ...openWaterBox(8100), qty: 5, lifecycle: 'PARTIALLY_EMPTIED' });
    const placeholderVisibility = Array.from({ length: 12 }, (_, index) => (
      first.root.getObjectByName(`BOX_CONTENT_${String(index + 1).padStart(2, '0')}_water1`).visible
    ));
    assert.deepEqual(placeholderVisibility, [
      false, false, false, false, false, false, false, true, true, true, true, true,
    ]);
    assert.ok(first.contentBatches.every((batch) => batch.count === 5));
    first.update({ ...openWaterBox(8100), lifecycle: 'SEALED', tape: 0, flapProgress: [0, 0, 0, 0] });
    assert.equal(first.contentBatchRoot.visible, false);
    assert.ok(first.contentBatches.every((batch) => batch.count === 0));
    first.update({ ...openWaterBox(8100), qty: 0, lifecycle: 'EMPTY' });
    assert.equal(first.contentBatchRoot.visible, false);
    assert.ok(first.contentBatches.every((batch) => batch.count === 0));
  } finally {
    for (const visual of visuals) {
      visual.dispose();
      visual.dispose();
    }
  }

  assert.equal(scene.children.length, 0);
  assert.ok([...batchDisposeCounts.values()].every((count) => count === 1),
    'each InstancedMesh releases its instance buffer exactly once');
  assert.ok([...geometryDisposeCounts.values()].every((count) => count === 1),
    'each per-carton merged geometry releases exactly once');
  assert.equal(prototypeDisposals, 0,
    'carton and product prototype geometry/material ownership remains with the merch loader');
});
