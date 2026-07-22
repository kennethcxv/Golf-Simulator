import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCharacter } from '../src/render3d/characterAsset.js';

test('disposing a character releases each owned geometry and material exactly once', () => {
  const character = makeCharacter();
  const geometries = new Set();
  const materials = new Set();
  character.root.traverse((object) => {
    if (!object.isMesh) return;
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (material) materials.add(material);
    }
  });

  let disposedGeometries = 0;
  let disposedMaterials = 0;
  for (const geometry of geometries) geometry.addEventListener('dispose', () => disposedGeometries++);
  for (const material of materials) material.addEventListener('dispose', () => disposedMaterials++);

  character.dispose();
  character.dispose();

  assert.equal(disposedGeometries, geometries.size);
  assert.equal(disposedMaterials, materials.size);
});
