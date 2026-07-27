import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { characterYawToward, makeCharacter } from '../src/render3d/characterAsset.js';

test('character facing math points the authored +Z front toward travel', () => {
  const cases = [
    { from: [0, 0], to: [0, 4] },
    { from: [0, 0], to: [3, 0] },
    { from: [2, -1], to: [-4, -5] },
  ];
  for (const { from, to } of cases) {
    const yaw = characterYawToward(from[0], from[1], to[0], to[1]);
    const front = new THREE.Vector3(0, 0, 1)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const travel = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
    assert.ok(front.dot(travel) > 0.999999, `front follows travel for ${from} -> ${to}`);
  }
});

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

test('far presentation hides only micro-detail and restores it at checkout range', () => {
  const character = makeCharacter();
  const fine = [];
  const structural = [];
  character.root.traverse((object) => {
    if (!object.isMesh) return;
    if (object.userData.characterPresentationDetail === 'fine') fine.push(object);
    else structural.push(object);
  });

  assert.ok(fine.length >= 20, 'the far LOD removes enough individual micro-detail draws to matter');
  assert.ok(structural.length >= 30, 'the articulated silhouette remains fully modeled');
  assert.equal(character.setPresentationDetail('far'), true);
  assert.equal(character.presentationDetail(), 'far');
  assert.ok(fine.every((object) => object.visible === false));
  assert.ok(structural.every((object) => object.visible !== false));
  assert.equal(character.setPresentationDetail('far'), false, 'stable distance does no hierarchy work');
  assert.equal(character.setPresentationDetail('full'), true);
  assert.ok(fine.every((object) => object.visible === true));
  character.dispose();
});
