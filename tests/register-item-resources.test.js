import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createRegisterItemResources } from '../src/render3d/clubhouse/registerItemResources.js';

function disposeCounter(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => { count++; });
  return () => count;
}

test('register item cleanup disposes owned fallback geometry and barcode material once', () => {
  const resources = createRegisterItemResources();
  const root = new THREE.Group();
  const geometry = resources.geometry(new THREE.BoxGeometry(1, 1, 1));
  const texture = resources.texture(new THREE.Texture());
  const material = resources.material(new THREE.MeshStandardMaterial({ color: 0x224433, map: texture }));
  const geometryDisposals = disposeCounter(geometry);
  const materialDisposals = disposeCounter(material);
  const textureDisposals = disposeCounter(texture);
  root.add(new THREE.Mesh(geometry, material));

  assert.deepEqual(resources.dispose(root), { geometries: 1, materials: 1 });
  assert.deepEqual(resources.dispose(root), { geometries: 0, materials: 0 });
  assert.equal(geometryDisposals(), 1);
  assert.equal(materialDisposals(), 1);
  assert.equal(textureDisposals(), 1);
});

test('register item cleanup preserves shared GLB geometry, cached material and texture', () => {
  const resources = createRegisterItemResources();
  const root = new THREE.Group();
  const sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sharedTexture = new THREE.Texture();
  const sharedMaterial = new THREE.MeshStandardMaterial({ map: sharedTexture });
  const geometryDisposals = disposeCounter(sharedGeometry);
  const materialDisposals = disposeCounter(sharedMaterial);
  const textureDisposals = disposeCounter(sharedTexture);
  root.add(new THREE.Mesh(sharedGeometry, sharedMaterial));

  assert.deepEqual(resources.dispose(root), { geometries: 0, materials: 0 });
  assert.equal(geometryDisposals(), 0);
  assert.equal(materialDisposals(), 0);
  assert.equal(textureDisposals(), 0);

  sharedGeometry.dispose();
  sharedMaterial.dispose();
  sharedTexture.dispose();
});

test('register item cleanup reports one owned failure and still releases every sibling', () => {
  const resources = createRegisterItemResources();
  const root = new THREE.Group();
  const brokenGeometry = resources.geometry(new THREE.BoxGeometry(1, 1, 1));
  const goodGeometry = resources.geometry(new THREE.SphereGeometry(1));
  const goodTexture = resources.texture(new THREE.Texture());
  const goodMaterial = resources.material(new THREE.MeshStandardMaterial({ map: goodTexture }));
  const sharedGeometry = new THREE.ConeGeometry(1, 2);
  const sharedMaterial = new THREE.MeshStandardMaterial();
  const counts = {
    goodGeometry: 0, goodMaterial: 0, goodTexture: 0,
    sharedGeometry: 0, sharedMaterial: 0,
  };
  goodGeometry.addEventListener('dispose', () => { counts.goodGeometry += 1; });
  goodMaterial.addEventListener('dispose', () => { counts.goodMaterial += 1; });
  goodTexture.addEventListener('dispose', () => { counts.goodTexture += 1; });
  sharedGeometry.addEventListener('dispose', () => { counts.sharedGeometry += 1; });
  sharedMaterial.addEventListener('dispose', () => { counts.sharedMaterial += 1; });
  brokenGeometry.dispose = () => { throw new Error('synthetic geometry disposal failure'); };
  root.add(
    new THREE.Mesh(brokenGeometry, goodMaterial),
    new THREE.Mesh(goodGeometry, goodMaterial),
    new THREE.Mesh(sharedGeometry, sharedMaterial),
  );
  const failures = [];

  assert.deepEqual(resources.dispose(root, { onError: (failure) => failures.push(failure) }), {
    geometries: 1,
    materials: 1,
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, 'geometry');
  assert.deepEqual(counts, {
    goodGeometry: 1, goodMaterial: 1, goodTexture: 1,
    sharedGeometry: 0, sharedMaterial: 0,
  });

  sharedGeometry.dispose();
  sharedMaterial.dispose();
});

test('register item cleanup defers an unhandled failure until every owned sibling is attempted', () => {
  const resources = createRegisterItemResources();
  const root = new THREE.Group();
  const brokenGeometry = resources.geometry(new THREE.BoxGeometry(1, 1, 1));
  const goodGeometry = resources.geometry(new THREE.SphereGeometry(1));
  const goodTexture = resources.texture(new THREE.Texture());
  const goodMaterial = resources.material(new THREE.MeshStandardMaterial({ map: goodTexture }));
  const counts = { broken: 0, geometry: 0, material: 0, texture: 0 };
  const originalBrokenDispose = brokenGeometry.dispose.bind(brokenGeometry);
  brokenGeometry.dispose = () => {
    counts.broken += 1;
    if (counts.broken === 1) throw new Error('synthetic transferred geometry failure');
    originalBrokenDispose();
  };
  goodGeometry.addEventListener('dispose', () => { counts.geometry += 1; });
  goodMaterial.addEventListener('dispose', () => { counts.material += 1; });
  goodTexture.addEventListener('dispose', () => { counts.texture += 1; });
  root.add(
    new THREE.Mesh(brokenGeometry, goodMaterial),
    new THREE.Mesh(goodGeometry, goodMaterial),
  );

  assert.throws(
    () => resources.dispose(root),
    (error) => error instanceof AggregateError
      && /after exhausting owned siblings/.test(error.message)
      && error.errors.some((entry) => /transferred geometry/.test(entry.message)),
  );
  assert.deepEqual(counts, { broken: 1, geometry: 1, material: 1, texture: 1 },
    'the first failure cannot skip later geometries, materials, or textures');
  assert.deepEqual(resources.status(), {
    retainedGeometries: 1,
    retainedMaterials: 0,
    retainedTextures: 0,
    retainedResources: 1,
    disposalErrors: 1,
  }, 'the failed identity remains strongly owned after production drops its product root');

  assert.deepEqual(resources.retry(), { geometries: 1, materials: 0 });
  assert.deepEqual(counts, { broken: 2, geometry: 1, material: 1, texture: 1 },
    'rootless teardown retry touches only the identity that failed before');
  assert.equal(resources.status().retainedResources, 0);
});

test('a throwing disposal reporter is contained until every owned sibling is attempted', () => {
  const resources = createRegisterItemResources();
  const root = new THREE.Group();
  const brokenGeometry = resources.geometry(new THREE.BoxGeometry(1, 1, 1));
  const goodMaterial = resources.material(new THREE.MeshStandardMaterial());
  const goodTexture = resources.texture(new THREE.Texture());
  goodMaterial.map = goodTexture;
  goodMaterial.needsUpdate = true;
  const counts = { material: 0, texture: 0, reports: 0 };
  brokenGeometry.dispose = () => { throw new Error('synthetic geometry failure'); };
  goodMaterial.addEventListener('dispose', () => { counts.material += 1; });
  goodTexture.addEventListener('dispose', () => { counts.texture += 1; });
  root.add(new THREE.Mesh(brokenGeometry, goodMaterial));

  const result = resources.dispose(root, {
    onError: () => {
      counts.reports += 1;
      throw new Error('synthetic reporter failure');
    },
  });
  assert.deepEqual(result, { geometries: 0, materials: 1 });
  assert.deepEqual(counts, { material: 1, texture: 1, reports: 1 });
});
