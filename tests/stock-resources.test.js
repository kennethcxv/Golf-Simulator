import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedStockResources } from '../src/render3d/clubhouse/stockResources.js';

const disposable = () => ({
  disposeCalls: 0,
  dispose() { this.disposeCalls++; },
});

const tree = (...objects) => ({
  traverse(visitor) {
    for (const object of objects) visitor(object);
  },
});

test('stock replacement disposes baked clones but preserves source/cache geometry', () => {
  const resources = createOwnedStockResources();
  const cachedGeometry = disposable();
  const bakedGeometry = disposable();
  const source = tree({ isMesh: true, geometry: cachedGeometry });
  const sourceGeometries = resources.snapshotGeometries(source);
  const baked = tree(
    { isMesh: true, geometry: cachedGeometry },
    { isMesh: true, geometry: bakedGeometry },
  );

  resources.ownNewGeometries(baked, sourceGeometries);
  const disposed = resources.dispose(baked);

  assert.deepEqual(disposed, { geometries: 1, materials: 0 });
  assert.equal(bakedGeometry.disposeCalls, 1);
  assert.equal(cachedGeometry.disposeCalls, 0);
});

test('owned stock resources shared within one display are disposed exactly once', () => {
  const resources = createOwnedStockResources();
  const geometry = resources.geometry(disposable());
  const material = resources.material(disposable());
  const cachedMaterial = disposable();
  const display = tree(
    { isMesh: true, geometry, material: [material, cachedMaterial] },
    { isMesh: true, geometry, material },
  );

  assert.deepEqual(resources.dispose(display), { geometries: 1, materials: 1 });
  assert.equal(geometry.disposeCalls, 1);
  assert.equal(material.disposeCalls, 1);
  assert.equal(cachedMaterial.disposeCalls, 0);
  assert.deepEqual(resources.dispose(display), { geometries: 0, materials: 0 });
});
