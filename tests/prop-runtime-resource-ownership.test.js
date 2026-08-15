import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { buildProps } from '../src/render3d/assets51to100/propPlacement.js';

function cachedPrototypeFixture() {
  const disposals = {
    geometry: 0,
    material: 0,
    texture: 0,
    image: 0,
  };
  const image = { close() { disposals.image += 1; } };
  const texture = new THREE.Texture(image);
  const material = new THREE.MeshStandardMaterial({
    color: 0x6b5b49,
    emissive: 0x24180e,
    map: texture,
    roughness: 0.72,
  });
  const geometry = new THREE.BoxGeometry(0.24, 0.2, 0.18);
  geometry.addEventListener('dispose', () => { disposals.geometry += 1; });
  material.addEventListener('dispose', () => { disposals.material += 1; });
  texture.addEventListener('dispose', () => { disposals.texture += 1; });

  const scene = new THREE.Group();
  const socket = new THREE.Object3D();
  socket.name = 'SOCKET_PLACEMENT';
  const first = new THREE.Mesh(geometry, material);
  first.name = 'CachedPrototypeMeshA';
  first.position.x = -0.14;
  const second = new THREE.Mesh(geometry, material);
  second.name = 'CachedPrototypeMeshB';
  second.position.x = 0.14;
  scene.add(socket, first, second);

  return { scene, geometry, material, texture, disposals };
}

function cloneLoader(prototype) {
  return {
    load(_url, onLoad) {
      onLoad({ scene: prototype.clone(true), animations: [] });
    },
  };
}

function deferredCloneLoader() {
  const requests = [];
  return {
    requests,
    load(url, onLoad, _onProgress, onError) {
      requests.push({ url, onLoad, onError });
    },
  };
}

function runtimeBatchMerch() {
  return {
    bake() {
      const visual = new THREE.Group();
      visual.userData.merchBaked = true;
      visual.add(new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.18, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x756653, roughness: 0.76 }),
      ));
      return visual;
    },
    disposeBaked() {},
  };
}

function assertCachedResourcesIntact(fixture, message) {
  assert.deepEqual(fixture.disposals, {
    geometry: 0,
    material: 0,
    texture: 0,
    image: 0,
  }, message);
}

test('disposing one prop runtime does not poison cached resources reused by a second runtime', async () => {
  const fixture = cachedPrototypeFixture();
  const loader = cloneLoader(fixture.scene);
  const firstInterior = new THREE.Group();
  const first = buildProps({
    interior: firstInterior,
    loader,
    merch: runtimeBatchMerch(),
  });
  await first.ready;

  const firstMesh = first.getRoot(61).getObjectByName('CachedPrototypeMeshA');
  assert.equal(firstMesh.geometry, fixture.geometry);
  assert.equal(firstMesh.material, fixture.material);
  const firstGlobalBatch = firstInterior.getObjectByName('Assets61to100PlacedStaticBatch');
  assert.ok(firstGlobalBatch, 'the fixture creates the production global static batch');
  const firstGlobalMesh = firstGlobalBatch.getObjectByProperty('isMesh', true);
  let globalGeometryDisposals = 0;
  let globalMaterialDisposals = 0;
  firstGlobalMesh.geometry.addEventListener('dispose', () => { globalGeometryDisposals += 1; });
  firstGlobalMesh.material.addEventListener('dispose', () => { globalMaterialDisposals += 1; });

  const firstSummary = first.dispose();
  assertCachedResourcesIntact(fixture,
    'runtime one teardown leaves loader-cache geometry, material, texture, and image intact');
  assert.equal(globalGeometryDisposals, 1,
    'runtime one still releases its final merged batch geometry');
  assert.equal(globalMaterialDisposals, 1,
    'runtime one still releases its final merged batch material');
  assert.ok(firstSummary.geometries > 0);
  assert.ok(firstSummary.materials > 0);
  assert.ok(firstSummary.protectedGeometries >= 1);
  assert.ok(firstSummary.protectedMaterials >= 1);
  assert.ok(firstSummary.protectedTextures >= 1);

  const secondInterior = new THREE.Group();
  const second = buildProps({
    interior: secondInterior,
    loader,
    merch: runtimeBatchMerch(),
  });
  await second.ready;
  const secondMesh = second.getRoot(61).getObjectByName('CachedPrototypeMeshA');
  assert.equal(secondMesh.geometry, fixture.geometry,
    'runtime two receives the still-live cached geometry identity');
  assert.equal(secondMesh.material, fixture.material,
    'runtime two receives the still-live cached material identity');
  assert.equal(secondMesh.material.map, fixture.texture,
    'runtime two receives the still-live cached texture identity');
  assertCachedResourcesIntact(fixture,
    'constructing runtime two observes no cache-resource disposal from runtime one');

  second.dispose();
  assertCachedResourcesIntact(fixture,
    'runtime two teardown also respects the loader cache ownership boundary');
});

test('late cached-loader success drops its hierarchy without disposing borrowed resources', async () => {
  const fixture = cachedPrototypeFixture();
  const loader = deferredCloneLoader();
  const interior = new THREE.Group();
  const props = buildProps({ interior, loader });
  assert.equal(loader.requests.length, 40);

  props.dispose();
  for (const request of loader.requests) {
    request.onLoad({ scene: fixture.scene.clone(true), animations: [] });
  }
  const ready = await props.ready;

  assert.deepEqual(ready, { placed: 0, instances: 0, superseded: [] });
  assert.equal(interior.children.length, 0,
    'late clone hierarchies never mount into the disposed scene');
  assertCachedResourcesIntact(fixture,
    'late clone resources remain owned by the cache for a reload-only recovery');
  const diagnostics = props.diagnostics();
  assert.equal(diagnostics.lateLoaderSuccesses, 40);
  assert.deepEqual(diagnostics.lateLoaderResourcesDisposed, {
    geometries: 0,
    materials: 0,
    textures: 0,
  });
  assert.deepEqual(diagnostics.lateLoaderBorrowedResourcesRetained, {
    geometries: 40,
    materials: 40,
    textures: 40,
  });
  assert.deepEqual(diagnostics.borrowedRenderableResources, {
    geometries: 1,
    materials: 1,
    textures: 1,
  });
});
