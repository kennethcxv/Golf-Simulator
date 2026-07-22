// ORGANIC NORMAL-PLAY CHECKOUT.
// These tests exercise the same pure helpers used by clubhouse customers; no
// sendToCounter shortcut and no renderer-only state mutation is involved.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planOrganicOrder,
  reconcileCustomerItemMeshes,
  createSequentialPlacement, createSequentialPlacementRecovery,
  stepSequentialPlacement,
  checkoutStagingPose,
  CUSTOMER_IMPATIENT_BEAT_SECONDS,
  createCustomerImpatientBeat,
  stepCustomerImpatientBeat,
} from '../src/render3d/clubhouse/customerFlow.js';

const zeroRng = { int: () => 0 };

test('an organic shopper can plan a three-item order across real stocked fixtures', () => {
  const fixtures = [
    { id: 'balls', skus: ['balls3'] },
    { id: 'gloves', skus: ['glove1'] },
    { id: 'caps', skus: ['cap1'] },
  ];
  const inventory = {
    balls3: { shelf: 2 },
    glove1: { shelf: 1 },
    cap1: { shelf: 4 },
  };

  const order = planOrganicOrder(fixtures, inventory, zeroRng, 3);

  assert.equal(order.target, 3);
  assert.equal(order.picks.length, 3);
  assert.deepEqual(order.picks.map((pick) => pick.fixture.id), ['balls', 'gloves', 'caps']);
  assert.deepEqual(order.picks.map((pick) => pick.skuId), ['balls3', 'glove1', 'cap1']);
});

test('reconciling a growing cart never duplicates a carried mesh', () => {
  const customer = { cart: [], itemMeshes: new Map() };
  const carried = [];
  let creates = 0;
  const io = {
    create: (item) => ({ uid: item.uid, parent: null }),
    attach: (mesh) => {
      creates += 1;
      mesh.parent = carried;
      carried.push(mesh);
    },
    detach: (mesh) => {
      const i = carried.indexOf(mesh);
      if (i >= 0) carried.splice(i, 1);
      mesh.parent = null;
    },
  };

  for (const uid of ['a', 'b', 'c']) {
    customer.cart.push({ uid, skuId: uid });
    reconcileCustomerItemMeshes(customer, io);
    reconcileCustomerItemMeshes(customer, io); // the per-frame-safe repeat
  }

  assert.equal(creates, 3, 'one mesh was created for each of the three units');
  assert.equal(customer.itemMeshes.size, 3);
  assert.equal(carried.length, 3);
  assert.equal(new Set(carried).size, 3, 'the visible carry contains no repeated object');
  assert.deepEqual(carried.map((mesh) => mesh.uid), ['a', 'b', 'c']);

  customer.cart = customer.cart.filter((item) => item.uid !== 'b');
  reconcileCustomerItemMeshes(customer, io);
  assert.equal(customer.itemMeshes.size, 2);
  assert.deepEqual(carried.map((mesh) => mesh.uid), ['a', 'c'], 'a removed unit leaves no stale carried child');
});

test('three products are placed in order and never finish in the same frame', () => {
  const placement = createSequentialPlacement([{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }]);
  const events = [];

  events.push(stepSequentialPlacement(placement, 10)); // starts a; long dt cannot also finish it
  events.push(stepSequentialPlacement(placement, 10)); // finishes a only
  events.push(stepSequentialPlacement(placement, 10)); // starts b only
  events.push(stepSequentialPlacement(placement, 10)); // finishes b only
  events.push(stepSequentialPlacement(placement, 10)); // starts c only
  events.push(stepSequentialPlacement(placement, 10)); // finishes c only

  assert.deepEqual(events.filter((event) => event.started).map((event) => event.started), ['a', 'b', 'c']);
  assert.deepEqual(events.filter((event) => event.placed).map((event) => event.placed), ['a', 'b', 'c']);
  assert.ok(events.every((event) => !(event.started && event.placed)), 'a frame cannot place one item and start another');
  assert.equal(placement.complete, true);

  const staging = { minX: 1, maxX: 2.2, minZ: 3, maxZ: 3.6 };
  const poses = [0, 1, 2].map((i) => checkoutStagingPose(i, 3, staging, 1.1));
  assert.equal(new Set(poses.map((pose) => `${pose.x},${pose.z}`)).size, 3, 'each product owns a separate counter pose');
});

test('placement recovery preserves only durable counter poses and rebuilds unique unfinished work', () => {
  const items = [
    { uid: 'placed', placed: true, placedAt: { x: 1, y: 2, z: 3, ry: 0.4 } },
    { uid: 'interrupted', placed: false, placedAt: { x: 4, y: 5, z: 6, ry: 0.7 } },
    { uid: 'missing-pose', placed: true },
    { uid: 'interrupted', placed: false },
    null,
  ];

  const recovered = createSequentialPlacementRecovery(items);

  assert.deepEqual(recovered.placedUids, ['placed']);
  assert.deepEqual(recovered.unplacedUids, ['interrupted', 'missing-pose']);
  assert.deepEqual(recovered.placement.uids, ['interrupted', 'missing-pose']);
  assert.equal(recovered.placement.index, 0);
  assert.equal(recovered.placement.complete, false);
  assert.equal(stepSequentialPlacement(recovered.placement, 10).started, 'interrupted');
  assert.equal(stepSequentialPlacement(recovered.placement, 10).placed, 'interrupted');
  assert.equal(stepSequentialPlacement(recovered.placement, 10).started, 'missing-pose');
  assert.equal(stepSequentialPlacement(recovered.placement, 10).placed, 'missing-pose');
  assert.equal(recovered.placement.complete, true);
});

test('a shelf with fewer than two available units produces a browse visit, not a one-item checkout', () => {
  const order = planOrganicOrder([{ id: 'balls', skus: ['balls3'] }], { balls3: { shelf: 1 } }, zeroRng, 4);
  assert.deepEqual(order, { target: 0, picks: [] });
});

test('an impatient customer holds a deterministic beat before terminal cleanup is allowed', () => {
  const beat = createCustomerImpatientBeat();

  assert.deepEqual(stepCustomerImpatientBeat(beat, -1), { complete: false, progress: 0 });
  const halfway = stepCustomerImpatientBeat(beat, CUSTOMER_IMPATIENT_BEAT_SECONDS / 2);
  assert.equal(halfway.complete, false);
  assert.equal(halfway.progress, 0.5);

  const almost = stepCustomerImpatientBeat(beat, CUSTOMER_IMPATIENT_BEAT_SECONDS / 2 - 0.001);
  assert.equal(almost.complete, false, 'cleanup remains blocked before the authored beat ends');
  assert.ok(almost.progress < 1);

  assert.deepEqual(stepCustomerImpatientBeat(beat, 0.001), { complete: true, progress: 1 });
  assert.deepEqual(
    stepCustomerImpatientBeat(beat, 10),
    { complete: true, progress: 1 },
    'completion is stable and cannot trigger a second terminal transition',
  );
});
