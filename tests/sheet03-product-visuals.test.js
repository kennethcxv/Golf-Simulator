import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function loadBinaryGltf(stem) {
  const bytes = readFileSync(new URL(`../vendor/models/clubhouse/${stem}.glb`, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
}

const AUDITED = Object.freeze({
  checkout_product_cap: {
    required: ['CapCrown', 'CapBrim', 'CapBrimUnder', 'CapTopButton', 'CapCrest', 'COL_Product'],
  },
  checkout_product_rangefinder: {
    required: [
      'RangefinderBody', 'RangefinderObjectiveGlass', 'RangefinderObjectiveBezel',
      'RangefinderTopScreen', 'RangefinderButton_1', 'RangefinderLanyard', 'COL_Product',
    ],
  },
  checkout_product_stand_bag: {
    required: [
      'StandBagBody', 'StandBagDividerFrontBack', 'StandBagDividerLeftRight',
      'StandBagPocket', 'StandBagPocketZip', 'StandBagShoulderStrap',
      'StandLegFoot_1', 'StandLegFoot_2', 'COL_Product',
    ],
  },
  checkout_product_shoe_pair: {
    required: [
      'LeftSole', 'LeftMidsole', 'LeftUpper', 'LeftTongue', 'LeftSaddle',
      'LeftQuarterPiping', 'RightSole', 'RightMidsole', 'RightUpper',
      'RightTongue', 'RightSaddle', 'RightQuarterPiping', 'COL_Product',
    ],
  },
});

for (const [stem, contract] of Object.entries(AUDITED)) {
  test(`${stem} retains the Sheet 3 authored visual contract`, async () => {
    const gltf = await loadBinaryGltf(stem);
    const root = gltf.scene.getObjectByName(stem);
    assert.ok(root, `${stem} root is named`);
    assert.equal(root.userData.asset_version, 3);
    assert.equal(root.userData.source, 'Original Pinehollow Golf geometry generated in-repository');
    assert.equal(root.userData.target_dimensions_m.length, 3);
    for (const name of contract.required) {
      assert.ok(root.getObjectByName(name), `${stem}: ${name} survives GLB export`);
    }

    root.updateWorldMatrix(true, true);
    let triangles = 0;
    root.traverse((object) => {
      assert.ok(object.matrixWorld.elements.every(Number.isFinite), `${stem}: ${object.name} matrix is finite`);
      if (!object.isMesh || !object.geometry) return;
      triangles += object.geometry.index
        ? object.geometry.index.count / 3
        : (object.geometry.attributes.position?.count || 0) / 3;
    });
    assert.ok(triangles > 150, `${stem}: authored detail is not a flat primitive (${triangles} tris)`);
    assert.ok(triangles < 50_000, `${stem}: repeated shelf product stays within budget (${triangles} tris)`);

    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.toArray().every(Number.isFinite), `${stem}: finite exported bounds`);
    assert.ok(size.toArray().every((dimension) => dimension > 0), `${stem}: non-zero exported bounds`);
  });
}
