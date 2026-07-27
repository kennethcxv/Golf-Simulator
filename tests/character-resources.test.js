import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { makeCharacter } from '../src/render3d/characterAsset.js';

function resourcesUnder(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) if (material) materials.add(material);
  });
  return { geometries, materials };
}

function countDisposeEvents(resources) {
  const counts = new Map();
  for (const resource of resources) {
    counts.set(resource, 0);
    resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  }
  return counts;
}

test('character disposes every intrinsic geometry and material exactly once', () => {
  const character = makeCharacter();
  const intrinsic = resourcesUnder(character.root);
  const geometryDisposals = countDisposeEvents(intrinsic.geometries);
  const materialDisposals = countDisposeEvents(intrinsic.materials);

  assert.ok(intrinsic.geometries.size > 1);
  assert.ok(intrinsic.materials.size > 1);
  assert.equal(character.dispose(), true);
  assert.equal(character.dispose(), false);

  for (const count of geometryDisposals.values()) assert.equal(count, 1);
  for (const count of materialDisposals.values()) assert.equal(count, 1);
});

test('character disposal leaves resources attached after construction untouched', () => {
  const character = makeCharacter();
  const sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sharedMaterial = new THREE.MeshStandardMaterial({ color: 0x336644 });
  const foreignProxy = new THREE.Mesh(sharedGeometry, sharedMaterial);
  const geometryDisposals = countDisposeEvents([sharedGeometry]);
  const materialDisposals = countDisposeEvents([sharedMaterial]);

  character.root.add(foreignProxy);
  assert.equal(character.dispose(), true);
  assert.equal(character.dispose(), false);
  assert.equal(geometryDisposals.get(sharedGeometry), 0);
  assert.equal(materialDisposals.get(sharedMaterial), 0);

  sharedGeometry.dispose();
  sharedMaterial.dispose();
});

test('impatient mode produces a restrained and deterministic visible pose', () => {
  const character = makeCharacter();
  const handPose = () => {
    character.root.updateMatrixWorld(true);
    return ['L', 'R'].flatMap((side) => character.hand(side).getWorldPosition(new THREE.Vector3()).toArray());
  };

  const idle = handPose();
  character.setMode('Impatient');
  character.update(0.625);
  const impatient = handPose();
  const movement = Math.hypot(...impatient.map((value, index) => value - idle[index]));
  assert.ok(movement > 0.08, 'the reaction moves both hands enough to read across the counter');
  assert.ok(movement < 1, 'the reaction stays compact rather than becoming a broad gesture');

  character.setMode('Idle');
  character.update(0.2);
  character.setMode('Impatient');
  character.update(0.625);
  assert.deepEqual(handPose(), impatient, 're-entering the mode reproduces the same authored beat');

  character.dispose();
});
