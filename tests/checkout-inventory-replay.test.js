import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import {
  checkoutSale,
  consumeHeldBatch,
  heldUnits,
  pickFromShelf,
} from '../src/sim/checkout.js';

function makeHeldBasket(seed, items) {
  const state = newGame('relaxed', seed);
  for (const item of items) {
    assert.equal(pickFromShelf(state, item.skuId, item.uid).ok, true);
  }
  return state;
}

function checkoutOperationKey(state) {
  return state.shop.inventoryLifecycle.operationKeys.find((key) => (
    key.startsWith('checkout-sale-batch:v2:')
  ));
}

function interruptAfterLifecycleMove(seed, items, transactionId) {
  const state = makeHeldBasket(seed, items);
  const heldBefore = structuredClone(heldUnits(state));
  const allocationsBefore = structuredClone(state.shop.inventoryLifecycle.heldAllocations);
  const first = consumeHeldBatch(state, items, transactionId);
  assert.equal(first.ok, true);
  assert.equal(first.recovered, false);
  return { state, heldBefore, allocationsBefore, first };
}

function addSameSkuSoldLot(state, sourceLotId, lotId, quantity = 1) {
  const lifecycle = state.shop.inventoryLifecycle;
  const source = lifecycle.lots.find((lot) => lot.id === sourceLotId);
  assert.ok(source, `source lot ${sourceLotId} exists`);
  const buckets = Object.fromEntries(
    Object.keys(source.buckets).map((bucket) => [bucket, 0]),
  );
  buckets.sold = quantity;
  lifecycle.lots.push({
    ...structuredClone(source),
    id: lotId,
    buckets,
  });
  return lotId;
}

test('checkout batch identities cannot collide through UID separators', () => {
  const firstItems = [
    { uid: 'a', skuId: 'balls1', price: 15 },
    { uid: 'b|c', skuId: 'balls1', price: 15 },
  ];
  const secondItems = [
    { uid: 'a|b', skuId: 'balls1', price: 15 },
    { uid: 'c', skuId: 'balls1', price: 15 },
  ];
  assert.equal(
    firstItems.map((item) => item.uid).sort().join('|'),
    secondItems.map((item) => item.uid).sort().join('|'),
    'the former delimiter-joined identity collides',
  );

  const firstState = makeHeldBasket(1811, firstItems);
  const secondState = makeHeldBasket(1812, secondItems);
  assert.equal(checkoutSale(firstState, firstItems, 'First customer', 'same-transaction').ok, true);
  assert.equal(checkoutSale(secondState, secondItems, 'Second customer', 'same-transaction').ok, true);

  const firstKey = checkoutOperationKey(firstState);
  const secondKey = checkoutOperationKey(secondState);
  assert.ok(firstKey);
  assert.ok(secondKey);
  assert.notEqual(firstKey, secondKey);
  assert.match(firstKey, /"transactionId":"same-transaction"/);
});

test('consumeHeldBatch identity is order-stable and transaction-scoped when supplied', () => {
  const items = [
    { uid: 'stable-b', skuId: 'glove1' },
    { uid: 'stable-a', skuId: 'balls1' },
  ];
  const firstState = makeHeldBasket(1814, items);
  const reorderedState = makeHeldBasket(1815, [...items].reverse());
  const otherTransactionState = makeHeldBasket(1816, items);

  const first = consumeHeldBatch(firstState, items, 'transaction-a');
  const reordered = consumeHeldBatch(reorderedState, [...items].reverse(), 'transaction-a');
  const otherTransaction = consumeHeldBatch(otherTransactionState, items, 'transaction-b');
  assert.equal(first.ok, true);
  assert.equal(reordered.ok, true);
  assert.equal(otherTransaction.ok, true);
  assert.equal(first.referenceId, reordered.referenceId);
  assert.notEqual(first.referenceId, otherTransaction.referenceId);
});

test('consumeHeldBatch validates malformed and duplicate identities before replay lookup', () => {
  const item = { uid: 'valid-held-unit', skuId: 'balls1' };
  const state = makeHeldBasket(1813, [item]);
  const operations = state.shop.inventoryLifecycle.operations;
  state.shop.inventoryLifecycle.operations = new Proxy(operations, {
    get() {
      throw new Error('replay lookup happened before input validation');
    },
  });

  const malformed = [
    [null],
    [{}],
    [{ uid: '', skuId: 'balls1' }],
    [{ uid: 'missing-sku' }],
    [{ uid: 'blank-sku', skuId: '   ' }],
    [item, { ...item }],
  ];
  const heldBefore = structuredClone(heldUnits(state));
  const allocationsBefore = structuredClone(state.shop.inventoryLifecycle.heldAllocations);
  for (const basket of malformed) {
    let result;
    assert.doesNotThrow(() => {
      result = consumeHeldBatch(state, basket, 'malformed-transaction');
    });
    assert.equal(result.ok, false);
  }
  assert.deepEqual(heldUnits(state), heldBefore);
  assert.deepEqual(state.shop.inventoryLifecycle.heldAllocations, allocationsBefore);
  state.shop.inventoryLifecycle.operations = operations;
});

test('consumeHeldBatch rejects corrupt replay checkpoints without changing projections', () => {
  const corruptions = [
    (operation) => { operation.ok = false; },
    (operation) => { operation.from = 'shelf'; },
    (operation) => { operation.to = 'reserve'; },
    (operation) => { operation.moved += 1; },
    (operation) => { operation.allocations[0].quantity += 1; },
    (operation) => { operation.allocations[0].lotId = 'missing-lot'; },
  ];

  for (let index = 0; index < corruptions.length; index += 1) {
    const items = [
      { uid: `corrupt-${index}-a`, skuId: 'balls1' },
      { uid: `corrupt-${index}-b`, skuId: 'glove1' },
    ];
    const transactionId = `corrupt-replay-${index}`;
    const { state, heldBefore, allocationsBefore, first } = interruptAfterLifecycleMove(
      1820 + index,
      items,
      transactionId,
    );
    state.shop.held = heldBefore;
    state.shop.inventoryLifecycle.heldAllocations = allocationsBefore;
    corruptions[index](state.shop.inventoryLifecycle.operations[first.referenceId]);
    const projectionBefore = structuredClone(state.shop.held);
    const lifecycleBefore = structuredClone(state.shop.inventoryLifecycle);

    const replay = consumeHeldBatch(state, items, transactionId);
    assert.equal(replay.ok, false);
    assert.match(replay.diagnostic || replay.reason, /checkpoint is corrupt/i);
    assert.deepEqual(state.shop.held, projectionBefore);
    assert.deepEqual(state.shop.inventoryLifecycle, lifecycleBefore);
  }
});

test('replay validates every live held row before removing any row', () => {
  const items = [
    { uid: 'late-mismatch-a', skuId: 'balls1' },
    { uid: 'late-mismatch-b', skuId: 'glove1' },
  ];
  const transactionId = 'late-mismatch-transaction';
  const { state, allocationsBefore } = interruptAfterLifecycleMove(1831, items, transactionId);
  // Reverse the projection so the exact row would have been removed before the
  // later mismatch by the former mutate-as-you-scan replay implementation.
  state.shop.held = [
    { uid: items[1].uid, skuId: 'cap1' },
    { uid: items[0].uid, skuId: items[0].skuId },
  ];
  state.shop.inventoryLifecycle.heldAllocations = allocationsBefore;
  const heldBefore = structuredClone(state.shop.held);
  const allocationsSnapshot = structuredClone(state.shop.inventoryLifecycle.heldAllocations);

  const replay = consumeHeldBatch(state, items, transactionId);
  assert.equal(replay.ok, false);
  assert.match(replay.diagnostic || replay.reason, /does not match/);
  assert.deepEqual(state.shop.held, heldBefore);
  assert.deepEqual(state.shop.inventoryLifecycle.heldAllocations, allocationsSnapshot);
});

test('replay clears exact live rows and allocations for already-missing rows once', () => {
  const items = [
    { uid: 'projection-replay-a', skuId: 'balls1' },
    { uid: 'projection-replay-b', skuId: 'glove1' },
  ];
  const transactionId = 'projection-replay-transaction';
  const { state, heldBefore, allocationsBefore, first } = interruptAfterLifecycleMove(
    1832,
    items,
    transactionId,
  );
  state.shop.held = [heldBefore[0]];
  state.shop.inventoryLifecycle.heldAllocations = allocationsBefore;

  const replay = consumeHeldBatch(state, items, transactionId);
  assert.equal(replay.ok, true);
  assert.equal(replay.recovered, true);
  assert.equal(replay.referenceId, first.referenceId);
  assert.equal(replay.consumed, 2);
  assert.equal(replay.projectedRowsRemoved, 1);
  assert.deepEqual(state.shop.held, []);
  assert.equal(state.shop.inventoryLifecycle.heldAllocations[items[0].uid], undefined);
  assert.equal(state.shop.inventoryLifecycle.heldAllocations[items[1].uid], undefined);

  const secondReplay = consumeHeldBatch(state, items, transactionId);
  assert.equal(secondReplay.ok, true);
  assert.equal(secondReplay.recovered, true);
  assert.equal(secondReplay.projectedRowsRemoved, 0);
});

test('replay rejects a sold checkpoint from the wrong same-SKU lot without removing its held row', () => {
  const item = { uid: 'same-sku-wrong-lot-unit', skuId: 'balls1' };
  const transactionId = 'same-sku-wrong-lot-transaction';
  const { state, heldBefore, allocationsBefore, first } = interruptAfterLifecycleMove(
    1833,
    [item],
    transactionId,
  );
  state.shop.held = heldBefore;
  state.shop.inventoryLifecycle.heldAllocations = allocationsBefore;
  const sourceLotId = allocationsBefore[item.uid][0].lotId;
  const wrongLotId = addSameSkuSoldLot(state, sourceLotId, 'same-sku-wrong-sold-lot');
  state.shop.inventoryLifecycle.operations[first.referenceId].allocations = [
    { lotId: wrongLotId, quantity: 1 },
  ];
  const heldSnapshot = structuredClone(state.shop.held);
  const lifecycleSnapshot = structuredClone(state.shop.inventoryLifecycle);

  const replay = consumeHeldBatch(state, [item], transactionId);
  assert.equal(replay.ok, false);
  assert.match(replay.diagnostic || replay.reason, /checkpoint is corrupt/i);
  assert.deepEqual(state.shop.held, heldSnapshot,
    'same-SKU provenance cannot authorize removal from a different lot');
  assert.deepEqual(state.shop.inventoryLifecycle, lifecycleSnapshot);
});

test('duplicate same-lot live allocations cannot double-count prior replay coverage', () => {
  const items = [
    { uid: 'duplicate-live-coverage-a', skuId: 'balls1' },
    { uid: 'duplicate-live-coverage-b', skuId: 'balls1' },
  ];
  const transactionId = 'duplicate-live-coverage-transaction';
  const { state, heldBefore, allocationsBefore, first } = interruptAfterLifecycleMove(
    1834,
    items,
    transactionId,
  );
  state.shop.held = heldBefore;
  const sourceLotId = allocationsBefore[items[0].uid][0].lotId;
  state.shop.inventoryLifecycle.heldAllocations = {
    [items[0].uid]: [{ lotId: sourceLotId, quantity: 1 }],
    [items[1].uid]: [{ lotId: sourceLotId, quantity: 1 }],
  };
  const otherLotId = addSameSkuSoldLot(state, sourceLotId, 'same-sku-other-covered-lot');
  state.shop.inventoryLifecycle.operations[first.referenceId].allocations = [
    { lotId: sourceLotId, quantity: 1 },
    { lotId: otherLotId, quantity: 1 },
  ];
  const heldSnapshot = structuredClone(state.shop.held);
  const lifecycleSnapshot = structuredClone(state.shop.inventoryLifecycle);

  const replay = consumeHeldBatch(state, items, transactionId);
  assert.equal(replay.ok, false);
  assert.match(replay.diagnostic || replay.reason, /checkpoint is corrupt/i);
  assert.deepEqual(state.shop.held, heldSnapshot,
    'one committed lot unit cannot cover two live held allocation rows');
  assert.deepEqual(state.shop.inventoryLifecycle, lifecycleSnapshot);
});
