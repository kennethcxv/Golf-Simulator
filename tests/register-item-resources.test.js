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
  const material = resources.material(new THREE.MeshStandardMaterial({ color: 0x224433 }));
  const geometryDisposals = disposeCounter(geometry);
  const materialDisposals = disposeCounter(material);
  root.add(new THREE.Mesh(geometry, material));

  assert.deepEqual(resources.dispose(root), { geometries: 1, materials: 1 });
  assert.deepEqual(resources.dispose(root), { geometries: 0, materials: 0 });
  assert.equal(geometryDisposals(), 1);
  assert.equal(materialDisposals(), 1);
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
