// THE GREEN TASK TRAYS ARE GONE (checkout-physicality round 2026-07-30).
//
// Per the TCG reference (Designs/CashRegister/Final): goods rest on the bare
// counter and counted change accumulates as a flat pile on the bare top at
// REGISTER.changeHandoff. Both authored tray props — the product staging tray
// and the change handoff tray — were deleted from the production build:
// nothing instantiates them, nothing preloads them, and the checkout bake no
// longer produces a task-surface batch. These tests hold that removal open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

import { COUNTER, REGISTER } from '../src/data/shopLayout.js';
import { buildCheckout } from '../src/render3d/clubhouse/fixtures.js';

const TRAY_IDS = Object.freeze([
  'checkout_product_staging_tray',
  'checkout_change_handoff_tray',
]);

test('no production source instantiates or preloads the deleted trays', async () => {
  for (const relative of [
    '../src/render3d/clubhouse/fixtures.js',
    '../src/render3d/clubhouse/merch.js',
    '../src/render3d/clubhouse/simplifiedRegisterMode.js',
  ]) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    for (const id of TRAY_IDS) {
      assert.ok(!source.includes(`'${id}'`),
        `${relative} still references the deleted ${id}`);
    }
  }
});

test('the counted-change pile zone is fully supported, reachable, and keeps its footprint', () => {
  const pile = REGISTER.changeHandoff;
  const minX = pile.x - pile.w / 2;
  const maxX = pile.x + pile.w / 2;
  const minZ = pile.z - pile.d / 2;
  const maxZ = pile.z + pile.d / 2;
  assert.ok(minX >= COUNTER.x - COUNTER.len / 2 && maxX <= COUNTER.x + COUNTER.len / 2);
  assert.ok(minZ >= COUNTER.z - COUNTER.depth / 2 && maxZ <= COUNTER.z + COUNTER.depth / 2);
  assert.ok(Math.hypot(pile.x - REGISTER.stand.x, pile.z - REGISTER.stand.z) <= 1.55,
    'the cashier can reach the change pile without leaving the fixed station');
  assert.deepEqual([pile.w, pile.d], [0.38, 0.20]);
});

test('the replaceable checkout shell bakes without any task-surface tray batch', () => {
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
      assert.ok(!TRAY_IDS.includes(name), `buildCheckout instantiated deleted ${name}`);
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

  assert.equal(bakes.length, 2,
    'only the static return and the replaceable shell are baked — no tray batch');
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
  const deskReturn = interior.getObjectByName('PineHillsFrontDeskReturn');
  const shell = interior.getObjectByName('LegacyCheckoutProductionCounter');
  assert.ok(deskReturn, 'the baked return retains its canonical runtime lookup name');
  assert.equal(deskReturn.userData.authoredSource, 'pine_hills_front_desk_return_v1');
  assert.ok(shell, 'the production shell remains independently removable by Asset 61');
  assert.equal(interior.getObjectByName('CheckoutTaskSurfaceVisual'), undefined,
    'no task-surface tray visual survives in the interior');
  assert.equal(shell.children[0].receiveShadow, false, 'shell batching preserves cast-only state');
  assert.equal(made.slice(0, 2).some((object) => object.parent === interior), false,
    'the unbatched counter is not left in the live interior');
});
