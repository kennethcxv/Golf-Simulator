// Three.js load validation for the Prime Fairways pro-shop retail kit
// (assets/pro_shop/glb).  Mirrors tests/checkout-kit-assets.test.js: loads every
// GLB through the game's real GLTFLoader with a node texture stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = new URL('../assets/pro_shop/', import.meta.url);
const MANIFEST = JSON.parse(await readFile(new URL('manifests/placement_manifest.json', BASE), 'utf8'));

async function list(kind) {
  return (await readdir(new URL(`glb/${kind}/`, BASE))).filter((f) => f.endsWith('.glb')).map((f) => f.replace(/\.glb$/, ''));
}

function makeLoader() {
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'node-texture-stub', loadTexture: async () => new THREE.Texture() }));
  return loader;
}

async function load(kind, name) {
  const bytes = await readFile(new URL(`glb/${kind}/${name}.glb`, BASE));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => makeLoader().parse(data, '', resolve, reject));
}

function names(root) {
  const set = new Set();
  root.traverse((o) => set.add(o.name.split('.')[0]));
  return set;
}

function sizeOf(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh || o.name.startsWith('COL_')) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box.getSize(new THREE.Vector3());
}

function trisOf(root) {
  let tris = 0;
  root.traverse((o) => {
    if (o.isMesh && !o.name.startsWith('COL_')) {
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    }
  });
  return tris;
}

const products = await list('products');
const fixtures = await list('fixtures');
const gltfs = new Map();

test('every pro-shop GLB parses in three.js', async () => {
  assert.ok(products.length >= 110, `expected 110+ product GLBs, got ${products.length}`);
  assert.ok(fixtures.length >= 16, `expected 16 fixture GLBs, got ${fixtures.length}`);
  for (const [kind, ids] of [['products', products], ['fixtures', fixtures]]) {
    for (const id of ids) {
      const gltf = await load(kind, id);
      assert.ok(gltf.scene, `${id} has a scene`);
      gltfs.set(id, gltf);
    }
  }
});

test('no cameras/lights; all texture images embedded', () => {
  for (const [id, gltf] of gltfs) {
    const json = gltf.parser.json;
    for (const img of json.images || []) {
      assert.ok(Number.isInteger(img.bufferView), `${id}: image ${img.name || ''} embedded`);
    }
    assert.ok(!(json.cameras || []).length, `${id} has no cameras`);
    assert.ok(!json.extensionsUsed?.includes('KHR_lights_punctual'), `${id} has no lights`);
  }
});

test('every product exposes PICKUP_SOCKET + collision + sane size', () => {
  for (const id of products) {
    const scene = gltfs.get(id).scene;
    const n = names(scene);
    assert.ok(n.has('PICKUP_SOCKET'), `${id} PICKUP_SOCKET`);
    assert.ok([...n].some((x) => x.startsWith('COL_')), `${id} collision`);
    const s = sizeOf(scene);
    const maxDim = Math.max(s.x, s.y, s.z);
    assert.ok(maxDim > 0.005 && maxDim < 1.6, `${id} size ${maxDim.toFixed(3)}m in range`);
  }
});

test('clubs keep full real-world length (no shortened clubs)', () => {
  const mins = { pf_driver: 1.10, pf_wood: 0.97, pf_hybrid: 0.95, pf_iron: 0.90, pf_wedge: 0.86, pf_putter: 0.83 };
  for (const id of products) {
    const pref = Object.keys(mins).find((p) => id.startsWith(p));
    if (!pref) continue;
    const s = sizeOf(gltfs.get(id).scene);   // GLB is Y-up: club length = y
    assert.ok(s.y >= mins[pref], `${id} length ${s.y.toFixed(3)} >= ${mins[pref]}`);
  }
});

test('fixtures expose their named placement slots with capacity extras', () => {
  const want = {
    pf_fixture_apparel_wall: ['APPAREL_HANGER_SLOT_01', 'APPAREL_HANGER_SLOT_12', 'APPAREL_FOLDED_SLOT_01'],
    pf_fixture_hat_wall: ['HAT_SLOT_01', 'HAT_SLOT_16'],
    pf_fixture_accessory_slatwall: ['HOOK_SLOT_01', 'HOOK_SLOT_21', 'SHELF_SLOT_A01'],
    pf_fixture_club_rack: ['CLUB_SLOT_01', 'CLUB_SLOT_18', 'CLUB_HEAD_SLOT_01', 'CLUB_SHAFT_SLOT_18', 'CLUB_GRIP_SLOT_09'],
    pf_fixture_bag_display: ['BAG_SLOT_01', 'BAG_SLOT_08'],
    pf_fixture_ball_shelf: ['SHELF_SLOT_A01', 'SHELF_SLOT_D06', 'SHELF_SLOT_Z01'],
    pf_fixture_shoe_display: ['SHOE_LEFT_SLOT_01', 'SHOE_RIGHT_SLOT_01'],
    pf_fixture_center_table: ['TABLE_SLOT_01', 'SHELF_SLOT_L04'],
    pf_fixture_freestanding_gondola: ['HOOK_SLOT_30', 'BARREL_SLOT_01', 'TABLE_SLOT_T01'],
  };
  for (const [fx, slots] of Object.entries(want)) {
    const scene = gltfs.get(fx).scene;
    const n = names(scene);
    for (const s of slots) assert.ok(n.has(s), `${fx} missing ${s}`);
    let checked = 0;
    scene.traverse((o) => {
      if (o.userData?.slot) {
        assert.ok(o.userData.max_w > 0 && o.userData.max_h > 0, `${fx}/${o.name} capacity extras`);
        assert.ok(typeof o.userData.accepts === 'string' && o.userData.accepts.length, `${fx}/${o.name} accepts`);
        checked++;
      }
    });
    assert.ok(checked >= slots.length, `${fx} has slot extras (${checked})`);
  }
});

test('placement manifest products exist, fit and sit at scale 1', () => {
  assert.ok(MANIFEST.placements.length >= 250, `placements ${MANIFEST.placements.length}`);
  for (const p of MANIFEST.placements) {
    assert.ok(gltfs.has(p.product), `placed product ${p.product} exists as GLB`);
    assert.deepEqual(p.scale, [1, 1, 1], `${p.fixture}/${p.slot} scale 1`);
    assert.ok(p.fits_capacity, `${p.fixture}/${p.slot}/${p.product} fits capacity`);
  }
});

test('tri budgets: no runaway product meshes', () => {
  for (const id of products) {
    const tris = trisOf(gltfs.get(id).scene);
    assert.ok(tris < 40000, `${id} tris ${tris}`);
  }
  for (const id of fixtures) {
    const tris = trisOf(gltfs.get(id).scene);
    assert.ok(tris < 60000, `${id} tris ${tris}`);
  }
});
