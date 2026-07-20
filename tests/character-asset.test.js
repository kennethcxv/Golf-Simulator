import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeCharacter } from '../src/render3d/characterAsset.js';

test('character disposal releases owned primitives without touching later attachments', () => {
  const char = makeCharacter();
  const ownedMeshes = [];
  char.root.traverse((node) => { if (node.isMesh) ownedMeshes.push(node); });
  assert.ok(ownedMeshes.length > 0);

  const ownedGeometries = new Set(ownedMeshes.map((mesh) => mesh.geometry));
  const ownedMaterials = new Set(ownedMeshes.map((mesh) => mesh.material));
  let ownedGeometryDisposals = 0;
  let ownedMaterialDisposals = 0;
  for (const geometry of ownedGeometries) geometry.addEventListener('dispose', () => { ownedGeometryDisposals++; });
  for (const material of ownedMaterials) material.addEventListener('dispose', () => { ownedMaterialDisposals++; });

  const sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sharedMaterial = new THREE.MeshStandardMaterial();
  const laterAttachment = new THREE.Mesh(sharedGeometry, sharedMaterial);
  let sharedGeometryDisposals = 0;
  let sharedMaterialDisposals = 0;
  sharedGeometry.addEventListener('dispose', () => { sharedGeometryDisposals++; });
  sharedMaterial.addEventListener('dispose', () => { sharedMaterialDisposals++; });
  char.carryAnchor.add(laterAttachment);

  char.dispose();
  assert.equal(ownedGeometryDisposals, ownedGeometries.size);
  assert.equal(ownedMaterialDisposals, ownedMaterials.size);
  assert.equal(sharedGeometryDisposals, 0);
  assert.equal(sharedMaterialDisposals, 0);

  char.dispose();
  assert.equal(ownedGeometryDisposals, ownedGeometries.size, 'disposal is idempotent');
});

test('Blender character parts are shared across figures and survive figure disposal', () => {
  const shared = new THREE.BoxGeometry(1, 1, 1);
  const names = [
    'torso', 'pelvis', 'upper_arm', 'forearm_hand', 'thigh', 'calf', 'shoe',
    'head', 'face_details', 'cap', 'hair',
  ];
  const parts = Object.fromEntries(names.map((name) => [name, shared]));
  let sharedDisposals = 0;
  let materialDisposals = 0;
  shared.addEventListener('dispose', () => { sharedDisposals++; });

  const char = makeCharacter({ parts });
  assert.equal(char.assetKind, 'blender');
  const meshes = [];
  char.root.traverse((node) => { if (node.isMesh) meshes.push(node); });
  assert.ok(meshes.length > 0);
  assert.ok(meshes.every((mesh) => mesh.userData.sharedCharacterGeometry));
  assert.deepEqual(
    [...new Set(meshes.filter((mesh) => mesh.castShadow).map((mesh) => mesh.name))].sort(),
    ['calf', 'head', 'pelvis', 'thigh', 'torso'],
  );
  const materials = new Set(meshes.map((mesh) => mesh.material));
  for (const material of materials) {
    material.addEventListener('dispose', () => { materialDisposals++; });
  }

  char.dispose();
  assert.equal(sharedDisposals, 0);
  assert.equal(materialDisposals, 0);
  shared.dispose();
});
