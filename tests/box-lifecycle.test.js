import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  BOX_LIFECYCLE,
  BOX_SCHEMA_VERSION,
  DELIVERIES_SCHEMA_VERSION,
  arriveOrder,
  boxesOf,
  boxLifecycleState,
  canTransitionBoxState,
  cutTape,
  openFlap,
  takeFromBox,
  flattenBox,
  recycleBox,
} from '../src/sim/deliveries.js';
import { storeInBack } from '../src/sim/stocking.js';

function landed(skuId = 'polo1', qty = 8) {
  const state = newGame('relaxed', 4701);
  for (const inventory of Object.values(state.shop.inventory)) {
    inventory.shelf = 0;
    inventory.back = 0;
  }
  arriveOrder(state, { id: 41, skuId, qty });
  return state;
}

function openFully(state, box) {
  assert.ok(cutTape(state, box.id, 1).ok);
  assert.ok(openFlap(state, box.id).ok);
  assert.ok(openFlap(state, box.id).ok);
  assert.ok(openFlap(state, box.id).ok);
}

test('hero box follows the legal sealed-to-cut-complete lifecycle with three persisted tape segments', () => {
  const state = landed();
  const box = boxesOf(state)[0];

  assert.equal(box.schemaVersion, BOX_SCHEMA_VERSION);
  assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.SEALED);
  assert.ok(canTransitionBoxState(BOX_LIFECYCLE.SEALED, BOX_LIFECYCLE.CUTTING));
  assert.equal(canTransitionBoxState(BOX_LIFECYCLE.SEALED, BOX_LIFECYCLE.OPEN), false);
  assert.equal(openFlap(state, box.id).ok, false, 'opening cannot skip the cut');
  assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.SEALED);

  cutTape(state, box.id, 0.3);
  assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.CUTTING);
  assert.equal(box.cutProgress, 0.3);
  assert.equal(box.tapeSegments.centre, 0.5);
  assert.equal(box.tapeSegments.left, 0);
  assert.equal(box.tapeSegments.right, 0);

  cutTape(state, box.id, 0.5);
  assert.equal(box.tapeSegments.centre, 1);
  assert.equal(box.tapeSegments.left, 1);
  assert.equal(box.tapeSegments.right, 0);
  const finished = cutTape(state, box.id, 0.2);
  assert.ok(finished.done);
  assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.CUT_COMPLETE);
  assert.deepEqual(box.tapeSegments, { centre: 1, left: 1, right: 1 });
});

test('front, back, then side opening phases persist all four physical flaps', () => {
  const state = landed();
  const box = boxesOf(state)[0];
  cutTape(state, box.id, 1);

  const first = openFlap(state, box.id);
  assert.deepEqual(first.physicalFlaps, [0]);
  assert.deepEqual(box.flapProgress, [1, 0, 0, 0]);
  assert.deepEqual(box.flaps, [1, 0], 'the shipped two-input mirror remains compatible');
  assert.equal(box.openingProgress, 0.25);
  assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.OPENING);

  const second = openFlap(state, box.id);
  assert.deepEqual(second.physicalFlaps, [1]);
  assert.deepEqual(box.flapProgress, [1, 1, 0, 0]);
  assert.deepEqual(box.flaps, [1, 1]);
  assert.equal(box.openingProgress, 0.5);
  assert.equal(second.done, false);

  const third = openFlap(state, box.id);
  assert.deepEqual(third.physicalFlaps, [2, 3]);
  assert.ok(third.done);
  assert.deepEqual(box.flapProgress, [1, 1, 1, 1]);
  assert.equal(box.openingProgress, 1);
  assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.OPEN);
});

test('partial depletion and emptying conserve every unit while advancing explicit states', () => {
  const state = landed('polo1', 8);
  const box = boxesOf(state)[0];
  const shipped = box.qty;
  openFully(state, box);

  const first = takeFromBox(state, box.id, 1);
  assert.equal(first.taken, 1);
  assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.PARTIALLY_EMPTIED);
  assert.equal(box.qty, shipped - 1);
  assert.equal(box.qty + state.shop.carry.qty + state.shop.inventory.polo1.back, shipped);
  storeInBack(state);

  let guard = 20;
  while (box.qty > 0 && guard-- > 0) {
    assert.ok(takeFromBox(state, box.id).ok);
    storeInBack(state);
  }
  assert.equal(box.qty, 0);
  assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.EMPTY);
  assert.equal(state.shop.inventory.polo1.back, shipped);
});

test('empty carton persists flattening progress and reaches discarded exactly once', () => {
  const state = landed('polo1', 1);
  const box = boxesOf(state)[0];
  openFully(state, box);
  takeFromBox(state, box.id);
  storeInBack(state);

  const halfway = flattenBox(state, box.id, 0.4);
  assert.equal(halfway.done, false);
  assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.FLATTENING);
  assert.equal(box.flattenProgress, 0.4);
  assert.equal(box.flat, false);
  assert.equal(recycleBox(state, box.id).ok, false, 'partial folding cannot be discarded');

  const loaded = deserialize(serialize(state));
  const restored = boxesOf(loaded)[0];
  assert.equal(restored.flattenProgress, 0.4);
  assert.equal(boxLifecycleState(restored), BOX_LIFECYCLE.FLATTENING);
  assert.ok(flattenBox(loaded, restored.id, 0.6).done);
  const discarded = recycleBox(loaded, restored.id);
  assert.ok(discarded.ok);
  assert.equal(discarded.state, BOX_LIFECYCLE.DISCARDED);
  assert.equal(discarded.box.lifecycle, BOX_LIFECYCLE.DISCARDED);
  assert.equal(boxesOf(loaded).length, 0);
  assert.equal(loaded.shop.deliveries.recycled, 1);
  assert.equal(recycleBox(loaded, restored.id).ok, false, 'discard is idempotent');
});

test('pre-schema saves migrate cut progress and two flap values without resealing', () => {
  const state = landed();
  const raw = JSON.parse(serialize(state));
  raw.shop.deliveries = {
    boxes: [
      {
        id: 7, skuId: 'polo1', orderId: 41, qty: 5, cap: 8, loc: 'stock',
        box: 'apparel', tape: 1, flaps: [1, 0.25], flat: false,
      },
      {
        id: 8, skuId: 'polo1', orderId: 41, qty: 8, cap: 8, loc: 'pad',
        box: 'apparel', tape: 0.7, flaps: [0, 0], flat: false,
      },
    ],
    nextBoxId: 9,
    trash: 0,
    recycled: 0,
    shipments: [],
  };

  const loaded = deserialize(raw);
  const [opening, cutting] = boxesOf(loaded);
  assert.equal(loaded.shop.deliveries.schemaVersion, DELIVERIES_SCHEMA_VERSION);
  assert.equal(opening.schemaVersion, BOX_SCHEMA_VERSION);
  assert.deepEqual(opening.flapProgress, [1, 0.25, 1, 0.25]);
  assert.deepEqual(opening.flaps, [1, 0.25]);
  assert.equal(opening.openingProgress, 0.625);
  assert.equal(boxLifecycleState(opening), BOX_LIFECYCLE.OPENING);

  assert.equal(cutting.cutProgress, 0.7);
  assert.equal(cutting.tapeSegments.centre, 1);
  assert.ok(Math.abs(cutting.tapeSegments.left - 0.5) < 1e-9);
  assert.equal(cutting.tapeSegments.right, 0);
  assert.equal(boxLifecycleState(cutting), BOX_LIFECYCLE.CUTTING);

  const roundTrip = deserialize(serialize(loaded));
  assert.deepEqual(roundTrip.shop.deliveries, loaded.shop.deliveries);
});

test('an order arrives exactly once and carries supplier plus original pack metadata', () => {
  const state = landed('polo1', 8);
  const before = boxesOf(state);
  assert.equal(before.length, 1);
  assert.equal(before[0].initialQty, 8);
  assert.ok(before[0].supplier, 'physical carton retains its supplier label authority');

  const again = arriveOrder(state, { id: 41, skuId: 'polo1', qty: 8 });
  assert.equal(again.length, 1, 'duplicate arrival resolves to the original physical carton');
  assert.equal(boxesOf(state).length, 1, 'duplicate tick cannot mint more stock');
  assert.deepEqual(state.shop.deliveries.arrivedOrderIds, [41]);
});

test('current-schema box reads do not remigrate or allocate new progress mirrors', () => {
  const state = landed('polo1', 8);
  const box = boxesOf(state)[0];
  const tapeSegments = box.tapeSegments;
  const flapProgress = box.flapProgress;
  const legacyFlaps = box.flaps;

  for (let i = 0; i < 100; i++) boxesOf(state);

  assert.strictEqual(box.tapeSegments, tapeSegments);
  assert.strictEqual(box.flapProgress, flapProgress);
  assert.strictEqual(box.flaps, legacyFlaps);
});
