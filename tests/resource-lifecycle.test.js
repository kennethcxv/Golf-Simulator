import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeOwnedTree, ownGeometry, ownMaterial } from '../src/render3d/resourceLifecycle.js';

test('dynamic tree disposal preserves cached geometry and materials', () => {
  const root = new THREE.Group();
  const ownedGeo = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const ownedMat = ownMaterial(new THREE.MeshStandardMaterial());
  const sharedGeo = new THREE.SphereGeometry(1);
  const sharedMat = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(ownedGeo, ownedMat), new THREE.Mesh(sharedGeo, sharedMat));

  let ownedGeoDisposals = 0;
  let ownedMatDisposals = 0;
  let sharedGeoDisposals = 0;
  let sharedMatDisposals = 0;
  ownedGeo.addEventListener('dispose', () => { ownedGeoDisposals++; });
  ownedMat.addEventListener('dispose', () => { ownedMatDisposals++; });
  sharedGeo.addEventListener('dispose', () => { sharedGeoDisposals++; });
  sharedMat.addEventListener('dispose', () => { sharedMatDisposals++; });

  assert.deepEqual(disposeOwnedTree(root), { geometries: 1, materials: 1 });
  assert.deepEqual(disposeOwnedTree(root), { geometries: 0, materials: 0 });
  assert.equal(ownedGeoDisposals, 1);
  assert.equal(ownedMatDisposals, 1);
  assert.equal(sharedGeoDisposals, 0);
  assert.equal(sharedMatDisposals, 0);
});
