// MULTI-LINE ORDERS. The laptop lets the player build a cart of several SKUs
// and place it as one order. Until 2026-07-29 that order could never arrive.
//
// buildOrderDraft records `skuId: lines.length === 1 ? lines[0].skuId : null`,
// and validatedArrival — the gate every arrival passes through — began with
// `const sku = skuById(order.skuId); if (!sku) return null;`. So a two-line
// order was rejected on every tick, returned zero boxes, never decremented
// remainingUnreceivedQuantity, and therefore never left state.shop.orders. It
// was retried forever: a permanent zombie in the delivery queue, and a shop
// that could only ever be restocked one SKU at a time.
//
// The manifest always had what was needed — buildOrderDraft tags every box with
// its own skuId and lineId, and arriveOrder's box loop already reads
// manifestBox.skuId first. Only the gate was single-SKU.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { arriveOrder, ensureDeliveries, boxesOf } from '../src/sim/deliveries.js';
import { submitPurchaseOrders } from '../src/sim/inventoryLifecycle.js';

function shop() {
  const state = newGame('relaxed', 20260729);
  state.cash = 500000;
  ensureDeliveries(state);
  return state;
}

// submitPurchaseOrders groups the cart BY SUPPLIER and drafts one order per
// supplier, so a genuinely multi-line order needs SKUs that share one. balls1,
// tees1 and towel1 are all Fairway Supply; glove1 is Sunday Apparel and would
// have quietly produced two single-line orders instead — which is how a
// multi-line test can pass while testing nothing.
const order = (state, lines) => {
  const before = state.shop.orders.length;
  const result = submitPurchaseOrders(state, {
    idempotencyKey: `test:${lines.map((l) => `${l.skuId}x${l.quantity}`).join(',')}`,
    lines,
  });
  assert.equal(result.ok, true, `order rejected: ${result.reason}`);
  const made = state.shop.orders.slice(before);
  assert.equal(made.length, 1, `expected one order, got ${made.length} — check the suppliers match`);
  return made[0];
};

test('a single-line order still arrives, unchanged', () => {
  const state = shop();
  const placed = order(state, [{ skuId: 'balls1', quantity: 24 }]);
  const boxes = arriveOrder(state, placed);
  assert.ok(boxes.length > 0, 'a one-SKU order must produce cartons');
  assert.ok(boxes.every((b) => b.skuId === 'balls1'));
});

test('a multi-line order arrives, and every line is represented', () => {
  const state = shop();
  const placed = order(state, [
    { skuId: 'balls1', quantity: 24 },
    { skuId: 'towel1', quantity: 6 },
  ]);
  assert.equal(placed.skuId, null, 'the order record has no single sku — that is the point');
  assert.ok(placed.lines.length === 2);

  const boxes = arriveOrder(state, placed);
  assert.ok(boxes.length > 0, 'a multi-SKU order produced NO cartons — the zombie defect');

  const bySku = new Set(boxes.map((b) => b.skuId));
  assert.ok(bySku.has('balls1'), 'the balls line never landed');
  assert.ok(bySku.has('towel1'), 'the towels line never landed');
  assert.equal(bySku.size, 2);

  // Every carton has to know which line it belongs to, or receiving cannot
  // credit the right line and the order never completes.
  assert.ok(boxes.every((b) => typeof b.skuId === 'string' && b.skuId.length > 0));
  const units = boxes.reduce((sum, b) => sum + b.qty, 0);
  assert.equal(units, 30, 'every ordered unit must arrive in a carton');
});

test('a multi-line order actually completes and leaves the queue', () => {
  // The player-visible half: an order that arrives but never reports itself
  // complete stays in the delivery list forever.
  const state = shop();
  const placed = order(state, [
    { skuId: 'balls1', quantity: 12 },
    { skuId: 'tees1', quantity: 20 },
  ]);
  arriveOrder(state, placed);
  const landed = state.shop.orders.find((o) => o.id === placed.id) || placed;
  assert.equal(landed.remainingUnreceivedQuantity, 0, 'the order never finished receiving');
});

test('arriving a multi-line order twice is idempotent', () => {
  const state = shop();
  const placed = order(state, [
    { skuId: 'balls1', quantity: 12 },
    { skuId: 'tees1', quantity: 20 },
  ]);
  const first = arriveOrder(state, placed);
  const second = arriveOrder(state, placed);
  assert.equal(second.length, first.length, 'a replay must not mint new cartons');
  assert.equal(boxesOf(state).length, first.length);
});

test('a corrupt multi-line manifest is still rejected', () => {
  // Widening the gate must not open it. A manifest whose boxes do not add up to
  // the ordered quantity is not a delivery.
  const state = shop();
  const placed = order(state, [
    { skuId: 'balls1', quantity: 24 },
    { skuId: 'towel1', quantity: 6 },
  ]);
  placed.manifest.boxes[0] = { ...placed.manifest.boxes[0], qty: 999 };
  assert.deepEqual(arriveOrder(state, placed), [], 'an inconsistent manifest must not land');
});

test('a multi-line manifest with a bad sku on one box is rejected', () => {
  const state = shop();
  const placed = order(state, [
    { skuId: 'balls1', quantity: 24 },
    { skuId: 'towel1', quantity: 6 },
  ]);
  placed.manifest.boxes[0] = { ...placed.manifest.boxes[0], skuId: 'no-such-sku' };
  assert.deepEqual(arriveOrder(state, placed), [], 'a carton for a sku that does not exist must not land');
});
