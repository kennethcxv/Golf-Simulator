import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { PRO_SHOP_EQUIPMENT_CATALOG } from '../src/data/proShopEquipment.js';
import { proShopEquipmentShowcaseLayout } from '../src/render3d/clubhouse/proShopEquipmentShowcase.js';


function makeLoader() {
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'node-equipment-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader;
}


async function load(entry) {
  const bytes = await readFile(new URL(`..${entry.glb}`, import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => makeLoader().parse(data, '', resolve, reject));
}


test('the real Three.js loader imports every shipped equipment tier', async () => {
  for (const entry of PRO_SHOP_EQUIPMENT_CATALOG) {
    const gltf = await load(entry);
    const names = new Set();
    let visibleMeshes = 0;
    let collisionMeshes = 0;
    gltf.scene.traverse((object) => {
      names.add(object.name);
      if (!object.isMesh) return;
      if (object.name.startsWith('COL_') || object.userData?.collision_proxy) collisionMeshes += 1;
      else visibleMeshes += 1;
    });
    assert.ok(visibleMeshes > 0, `${entry.id} has no runtime render mesh`);
    assert.ok(collisionMeshes > 0, `${entry.id} has no runtime collision mesh`);
    const root = gltf.scene.children.find((object) => object.userData?.asset_id === entry.id);
    assert.ok(root, `${entry.id} lost its asset root extras`);

    if (entry.familyId === 'pos_terminal') assert.ok(names.has('POS_Screen'), `${entry.id} POS screen contract`);
    if (entry.familyId === 'card_reader') {
      for (const name of ['Terminal_Screen', 'CARD_INSERT_SOCKET', 'Terminal_Key_0', 'Terminal_BackButton']) {
        assert.ok(names.has(name), `${entry.id} missing ${name}`);
      }
    }
    if (entry.familyId === 'receipt_printer') {
      assert.ok(names.has('ReceiptPaper'), `${entry.id} receipt contract`);
      assert.ok(names.has('RECEIPT_OUTPUT_SOCKET'), `${entry.id} receipt output contract`);
    }
    if (entry.familyId === 'cash_drawer') assert.ok(names.has('DrawerSlide'), `${entry.id} drawer contract`);
  }
});


test('the in-game inspection yard covers every family once at true scale', () => {
  const layout = proShopEquipmentShowcaseLayout();
  assert.equal(layout.length, 24);
  assert.equal(new Set(layout.map((entry) => entry.familyId)).size, 24);
  assert.ok(layout.every((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z)));
});
