import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { auditGlb } from '../tools/qa/glb-audit.mjs';
import { COUNTER, REGISTER } from '../src/data/shopLayout.js';
import { buildCheckout } from '../src/render3d/clubhouse/fixtures.js';

const SPECS = Object.freeze([
  Object.freeze({
    id: 'checkout_product_staging_tray',
    anchor: 'ANCHOR_ProductStagingSurface',
    collision: 'COL_ProductStagingTray',
    dimensions: Object.freeze([0.82, 0.029, 0.38]),
    maxTriangles: 2200,
    requiredNodes: Object.freeze([
      'ProductStagingTrayBase',
      'ProductStagingTrayInset',
      'ProductStagingTrayRailFront',
      'ProductStagingTrayBrassFastener_01',
      'ProductStagingCapacityMarker_05',
    ]),
  }),
  Object.freeze({
    id: 'checkout_change_handoff_tray',
    anchor: 'ANCHOR_ChangeHandoffSurface',
    collision: 'COL_ChangeHandoffTray',
    dimensions: Object.freeze([0.38, 0.029, 0.20]),
    maxTriangles: 1000,
    requiredNodes: Object.freeze([
      'ChangeHandoffTrayBase',
      'ChangeHandoffTrayFelt',
      'ChangeHandoffTrayRailBack',
      'ChangeHandoffTrayBrassFastener_01',
      'ANCHOR_ChangePickup',
    ]),
  }),
]);

async function load(spec) {
  const url = new URL(`../vendor/models/clubhouse/${spec.id}.glb`, import.meta.url);
  const bytes = await readFile(url);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
  const root = gltf.scene.getObjectByName(spec.id);
  assert.ok(root, `${spec.id} exposes an exact named root`);
  return { root, audit: auditGlb(fileURLToPath(url)) };
}

function visibleBounds(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  root.traverse((object) => {
    if (!object.isMesh || object.name.startsWith('COL_')) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
  });
  return bounds.getSize(new THREE.Vector3());
}

test('authored checkout task trays retain metre-scale surfaces, anchors and collisions', async () => {
  for (const spec of SPECS) {
    const { root, audit } = await load(spec);
    for (const name of spec.requiredNodes) assert.ok(root.getObjectByName(name), `${spec.id} missing ${name}`);
    const anchor = root.getObjectByName(spec.anchor);
    const collision = root.getObjectByName(spec.collision);
    assert.ok(anchor, `${spec.id} missing surface anchor`);
    assert.ok(collision, `${spec.id} missing collision proxy`);
    assert.equal(anchor.userData.anchor, true);
    assert.equal(anchor.userData.anchor_kind, 'surface');
    assert.equal(collision.userData.collision_proxy, true);

    const size = visibleBounds(root);
    spec.dimensions.forEach((expected, index) => {
      assert.ok(Math.abs(size.getComponent(index) - expected) <= 0.002,
        `${spec.id} dimension ${index} is ${size.getComponent(index)}, expected ${expected}`);
    });
    assert.ok(audit.triangles <= spec.maxTriangles, `${spec.id} exceeds its close-range triangle budget`);
    // Four visible slots plus the hidden collision material.
    assert.ok(audit.materials <= 5, `${spec.id} exceeds its material budget`);
    assert.equal(audit.textures, 0);
    assert.equal(audit.cameras, 0);
    assert.equal(audit.lights, 0);
    assert.deepEqual(audit.flags, []);
  }
});

test('the counted-change tray is fully supported, reachable, and uses its authored footprint', () => {
  const tray = REGISTER.changeHandoff;
  const minX = tray.x - tray.w / 2;
  const maxX = tray.x + tray.w / 2;
  const minZ = tray.z - tray.d / 2;
  const maxZ = tray.z + tray.d / 2;
  assert.ok(minX >= COUNTER.x - COUNTER.len / 2 && maxX <= COUNTER.x + COUNTER.len / 2);
  assert.ok(minZ >= COUNTER.z - COUNTER.depth / 2 && maxZ <= COUNTER.z + COUNTER.depth / 2);
  assert.ok(Math.hypot(tray.x - REGISTER.stand.x, tray.z - REGISTER.stand.z) <= 1.55,
    'the cashier can reach the handoff tray without leaving the fixed station');
  assert.deepEqual([tray.w, tray.d], [0.38, 0.20]);
});

test('the static checkout counter and task trays share one root-local render batch', () => {
  const interior = new THREE.Group();
  interior.position.set(12, 3, -8);
  const mats = {
    walnut: new THREE.MeshStandardMaterial(),
    walnutDark: new THREE.MeshStandardMaterial(),
    brass: new THREE.MeshStandardMaterial(),
  };
  const made = [];
  let baked = null;
  const merch = {
    onReady(callback) { callback(); },
    instantiate(name) {
      const object = new THREE.Group();
      object.name = name;
      made.push(object);
      return object;
    },
    instantiateKit() { return null; },
    bake(group, options) {
      baked = { group, options, parentAtBake: group.parent };
      const output = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mats.walnut);
      mesh.receiveShadow = true;
      output.add(mesh);
      return output;
    },
  };

  buildCheckout({
    interior,
    mats,
    merch,
    addCol() {},
    colBoxAt() { return {}; },
    register: { simplified: true },
  });

  assert.ok(baked, 'checkout island is passed through the merchandise batcher');
  assert.equal(baked.parentAtBake, null, 'the batch source remains outside the translated interior root');
  assert.deepEqual(baked.options, { visibleOnly: true });
  assert.deepEqual(
    baked.group.children.map((object) => object.name),
    ['checkout_counter', 'checkout_product_staging_tray', 'checkout_change_handoff_tray'],
  );
  const visual = interior.getObjectByName('CheckoutIslandStaticVisual');
  assert.ok(visual, 'one named static visual replaces the three authored roots');
  assert.equal(visual.children[0].receiveShadow, false, 'batching preserves the authored cast-only state');
  assert.equal(made.slice(0, 3).some((object) => object.parent === interior), false,
    'the unbatched counter and trays are not left in the live interior');
});
