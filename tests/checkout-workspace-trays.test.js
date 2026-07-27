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

test('the replaceable checkout shell stays separate from persistent task-surface batching', () => {
  const interior = new THREE.Group();
  interior.position.set(12, 3, -8);
  const mats = {
    walnut: new THREE.MeshStandardMaterial(),
    walnutDark: new THREE.MeshStandardMaterial(),
    brass: new THREE.MeshStandardMaterial(),
  };
  const made = [];
  const bakes = [];
  const merch = {
    onReady(callback) { callback(); },
    instantiateRaw(name) {
      if (name !== 'pine_hills_front_desk_return_v1') return null;
      const object = new THREE.Group();
      object.name = name;
      const visible = new THREE.Mesh(new THREE.BoxGeometry(), mats.walnut);
      visible.name = 'MESH_ReturnFront';
      const collision = new THREE.Mesh(new THREE.BoxGeometry(), mats.walnut);
      collision.name = 'COL_ReturnFront';
      object.add(visible, collision);
      made.push(object);
      return object;
    },
    instantiate(name) {
      const object = new THREE.Group();
      object.name = name;
      made.push(object);
      return object;
    },
    instantiateKit() { return null; },
    bake(group, options) {
      bakes.push({ group, options, parentAtBake: group.parent });
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

  assert.equal(bakes.length, 3,
    'the static return, replaceable shell, and persistent trays use distinct batches');
  assert.ok(bakes.every((bake) => bake.parentAtBake === null),
    'batch sources remain outside the translated interior root');
  assert.ok(bakes.every((bake) => bake.options.visibleOnly === true));
  assert.deepEqual(
    bakes[0].group.children.map((object) => object.name),
    ['pine_hills_front_desk_return_v1'],
  );
  assert.equal(
    bakes[0].group.getObjectByName('COL_ReturnFront').visible,
    false,
    'the authored collision proxy is hidden before visible-only batching',
  );
  assert.deepEqual(
    bakes[1].group.children.map((object) => object.name),
    ['checkout_counter'],
  );
  assert.deepEqual(
    bakes[2].group.children.map((object) => object.name),
    ['checkout_product_staging_tray', 'checkout_change_handoff_tray'],
  );
  const deskReturn = interior.getObjectByName('PineHillsFrontDeskReturn');
  const shell = interior.getObjectByName('LegacyCheckoutProductionCounter');
  const taskSurfaces = interior.getObjectByName('CheckoutTaskSurfaceVisual');
  assert.ok(deskReturn, 'the baked return retains its canonical runtime lookup name');
  assert.equal(deskReturn.userData.authoredSource, 'pine_hills_front_desk_return_v1');
  assert.ok(shell, 'the production shell remains independently removable by Asset 61');
  assert.ok(taskSurfaces, 'the transaction trays remain after Asset 61 retires the old shell');
  assert.equal(shell.children[0].receiveShadow, false, 'shell batching preserves cast-only state');
  assert.equal(taskSurfaces.children[0].receiveShadow, false, 'tray batching preserves cast-only state');
  assert.equal(made.slice(0, 3).some((object) => object.parent === interior), false,
    'the unbatched counter and trays are not left in the live interior');
});
