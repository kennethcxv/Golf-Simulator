import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  collectMaterialResources, collectRenderableResources, disposeRenderableResources,
  mergeRenderableResources,
} from '../src/render3d/clubhouse/resourceLifecycle.js';

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
