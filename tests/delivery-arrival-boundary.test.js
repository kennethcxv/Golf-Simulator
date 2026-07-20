import test from 'node:test';
import assert from 'node:assert/strict';

import { BOX_KINDS, planShipment } from '../src/data/boxes.js';
import { skuById } from '../src/data/shopItems.js';
import { arriveOrder } from '../src/sim/deliveries.js';
import { newGame } from '../src/sim/state.js';

function assertRejectedWithoutMutation(state, order, label) {
  const before = structuredClone(state);
  const nextBoxId = state.shop.deliveries.nextBoxId;
  assert.deepEqual(arriveOrder(state, order), [], `${label}: rejected`);
  assert.equal(state.shop.deliveries.nextBoxId, nextBoxId, `${label}: no box ID consumed`);
  assert.deepEqual(state, before, `${label}: state is byte-for-byte unchanged`);
}

function manifestOrder(overrides = {}) {
  const skuId = 'balls2';
  const qty = 12;
  return {
    id: 700,
    skuId,
    qty,
    manifest: structuredClone(planShipment(skuById(skuId), qty)),
    ...overrides,
  };
}

test('direct arrival rejects malformed order quantities and unknown SKUs without state mutation', () => {
  const state = newGame('relaxed', 700);
  const invalidQuantities = [NaN, Infinity, -Infinity, 1.5, 0, -1, '12'];
  for (const qty of invalidQuantities) {
    assertRejectedWithoutMutation(
      state,
      { id: `bad-qty-${String(qty)}`, skuId: 'balls2', qty },
      `quantity ${String(qty)}`,
    );
  }
  assertRejectedWithoutMutation(
    state,
    { id: 'missing-sku', skuId: 'catalog-does-not-have-this', qty: 12 },
    'unknown SKU',
  );
  assertRejectedWithoutMutation(state, null, 'missing order');
});

test('malformed manifest boxes cannot mint cartons, shipments, notifications, or IDs', () => {
  const state = newGame('relaxed', 701);
  const cases = [
    ['missing boxes', (order) => { delete order.manifest.boxes; }],
    ['empty boxes', (order) => { order.manifest.boxes = []; order.manifest.boxCount = 0; }],
    ['box-count mismatch', (order) => { order.manifest.boxCount += 1; }],
    ['non-finite box quantity', (order) => { order.manifest.boxes[0].qty = Infinity; }],
    ['fractional box quantity', (order) => { order.manifest.boxes[0].qty = 11.5; }],
    ['zero box quantity', (order) => { order.manifest.boxes[0].qty = 0; }],
    ['negative box quantity', (order) => { order.manifest.boxes[0].qty = -1; }],
    ['quantity total mismatch', (order) => { order.manifest.boxes[0].qty = 11; }],
    ['unknown box kind', (order) => { order.manifest.boxes[0].kind = 'mystery-crate'; }],
    ['prototype-named box kind', (order) => { order.manifest.boxes[0].kind = 'toString'; }],
    ['partial dimensions', (order) => { delete order.manifest.boxes[0].d; }],
    ['non-finite dimensions', (order) => { order.manifest.boxes[0].w = NaN; }],
    ['non-positive dimensions', (order) => { order.manifest.boxes[0].h = 0; }],
    ['dimensions inconsistent with kind', (order) => { order.manifest.boxes[0].d += 0.01; }],
  ];

  for (const [label, corrupt] of cases) {
    const order = manifestOrder({ id: `bad-manifest-${label}` });
    corrupt(order);
    assertRejectedWithoutMutation(state, order, label);
  }
});

test('valid planned and compact legacy manifests still land unchanged', () => {
  const plannedState = newGame('relaxed', 702);
  const order = manifestOrder({ id: 'planned-valid' });
  const manifestBefore = structuredClone(order.manifest);
  const firstId = plannedState.shop.deliveries.nextBoxId;
  const made = arriveOrder(plannedState, order);

  assert.deepEqual(order.manifest, manifestBefore, 'arrival never rewrites the promised manifest');
  assert.deepEqual(
    made.map((box) => ({ id: box.id, qty: box.qty, box: box.box, lb: box.lb, loc: box.loc })),
    manifestBefore.boxes.map((box, index) => ({
      id: firstId + index,
      qty: box.qty,
      box: box.kind,
      lb: box.lb,
      loc: 'pad',
    })),
  );
  assert.equal(plannedState.shop.deliveries.nextBoxId, firstId + made.length);
  assert.equal(plannedState.shop.deliveries.shipments.length, 1);

  const compactState = newGame('relaxed', 703);
  const compact = manifestOrder({ id: 'compact-valid' });
  for (const box of compact.manifest.boxes) {
    delete box.w;
    delete box.h;
    delete box.d;
  }
  delete compact.manifest.boxCount;
  const compactMade = arriveOrder(compactState, compact);
  assert.equal(compactMade.length, compact.manifest.boxes.length,
    'legacy compact manifests derive dimensions from their registered kinds');
  assert.ok(compactMade.every((box) => BOX_KINDS[box.box]));
});

test('duplicate arrival replay remains idempotent and precedes payload validation', () => {
  const state = newGame('relaxed', 704);
  const first = arriveOrder(state, manifestOrder({ id: 'replayed-arrival' }));
  const beforeReplay = structuredClone(state);
  const replay = arriveOrder(state, {
    id: 'replayed-arrival',
    skuId: 'now-corrupt',
    qty: NaN,
    manifest: { boxes: null },
  });

  assert.deepEqual(replay.map((box) => box.id), first.map((box) => box.id));
  assert.deepEqual(state, beforeReplay, 'a duplicate retry cannot mint or mutate delivery state');
});
