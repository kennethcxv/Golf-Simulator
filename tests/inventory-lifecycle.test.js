import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import { capacityOf } from '../src/data/fixtureSlots.js';
import {
  INVENTORY_STAGE,
  ORDER_STATE,
  cancelPurchaseOrder,
  ensureInventoryLifecycle,
  inventoryPosition,
  moveInventory,
  openBoxInventory,
  receiveBoxInventory,
  reconcileInventory,
  reorderSuggestion,
  submitPurchaseOrders,
  takeBoxInventory,
} from '../src/sim/inventoryLifecycle.js';

function setup(seed = 41) {
  const state = newGame('relaxed', seed);
  state.cash = 100000;
  state.shop.unlockedTier = 3;
  ensureInventoryLifecycle(state);
  return state;
}

test('fresh-state migration captures physical opening stock without changing it', () => {
  const state = setup();
  const lifecycle = state.shop.inventoryLifecycle;
  const expectedOpening = (skuId) => {
    const projection = state.shop.inventory[skuId];
    const total = projection.shelf + projection.back;
    const shelf = Math.min(total, capacityOf(skuId));
    return { total, shelf, reserve: total - shelf };
  };
  const balls = expectedOpening('balls1');
  const tees = expectedOpening('tees1');
  const ballsPosition = inventoryPosition(state, 'balls1');
  const teesPosition = inventoryPosition(state, 'tees1');

  assert.equal(lifecycle.schemaVersion, 1);
  assert.equal(ballsPosition.shelf, balls.shelf);
  assert.equal(ballsPosition.reserve, balls.reserve);
  assert.equal(ballsPosition.onHand, balls.total);
  assert.equal(teesPosition.shelf, tees.shelf);
  assert.equal(teesPosition.reserve, tees.reserve);
  assert.equal(teesPosition.onHand, tees.total);
  assert.equal(reconcileInventory(state).ok, true);

  // Ensuring twice is a pure normalization pass, not a second opening balance.
  const lots = lifecycle.lots.length;
  ensureInventoryLifecycle(state);
  assert.equal(lifecycle.lots.length, lots);
});

test('one basket becomes one rich order per supplier and charges exactly once', () => {
  const state = setup();
  const cash = state.cash;
  const expense = state.ledger.today.expense.shopOrders;
  const input = {
    idempotencyKey: 'laptop-basket-1',
    lines: [
      { skuId: 'balls1', quantity: 13 },
      { skuId: 'tees1', quantity: 5 },
      { skuId: 'driver1', quantity: 2 },
      { skuId: 'polo1', quantity: 3 },
    ],
  };

  const placed = submitPurchaseOrders(state, input);
  assert.equal(placed.ok, true);
  assert.equal(placed.orders.length, 3, 'fairway, ironwood, and sunday each get one order');
  assert.equal(new Set(placed.orders.map((order) => order.supplierId)).size, 3);
  assert.equal(state.cash, cash - placed.cost);
  assert.equal(state.ledger.today.expense.shopOrders, expense + placed.cost);

  const fairway = placed.orders.find((order) => order.supplierId === 'fairway');
  assert.equal(fairway.lines.length, 2, 'same-supplier lines share freight and dispatch');
  assert.equal(fairway.manifest.boxes.reduce((sum, box) => sum + box.qty, 0), 18);
  assert.equal(fairway.remainingUnreceivedQuantity, 18);
  assert.equal(fairway.state, ORDER_STATE.SUBMITTED);
  assert.equal(fairway.charged, true);
  assert.ok(fairway.window.open < fairway.window.close);
  assert.ok(Number.isFinite(fairway.deliveryEtaMin));

  const cashAfterFirst = state.cash;
  const expenseAfterFirst = state.ledger.today.expense.shopOrders;
  const replay = submitPurchaseOrders(state, input);
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.charged, 0);
  assert.deepEqual(replay.orders.map((order) => order.id), placed.orders.map((order) => order.id));
  assert.equal(state.cash, cashAfterFirst);
  assert.equal(state.ledger.today.expense.shopOrders, expenseAfterFirst);
  assert.equal(state.shop.orders.length, 3, 'retry created no duplicate active orders');
  assert.equal(reconcileInventory(state).ok, true);
});

test('an idempotency key cannot be reused with a different payload', () => {
  const state = setup();
  const first = submitPurchaseOrders(state, {
    idempotencyKey: 'same-click',
    lines: [{ skuId: 'balls1', quantity: 2 }],
  });
  assert.equal(first.ok, true);
  const cash = state.cash;

  const conflict = submitPurchaseOrders(state, {
    idempotencyKey: 'same-click',
    lines: [{ skuId: 'balls1', quantity: 3 }],
  });
  assert.equal(conflict.ok, false);
  assert.match(conflict.reason, /already used/i);
  assert.equal(state.cash, cash);
  assert.equal(state.shop.orders.length, 1);
});

test('failed orders are archived as Failed and never charge cash or inventory', () => {
  const state = setup();
  state.cash = 1;
  const expense = state.ledger.today.expense.shopOrders;
  const result = submitPurchaseOrders(state, {
    idempotencyKey: 'cannot-afford',
    lines: [{ skuId: 'driver3', quantity: 4 }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.orders[0].state, ORDER_STATE.FAILED);
  assert.equal(result.orders[0].charged, false);
  assert.equal(state.cash, 1);
  assert.equal(state.ledger.today.expense.shopOrders, expense);
  assert.equal(state.shop.orders.length, 0);
  assert.equal(inventoryPosition(state, 'driver3').inTransit, 0);

  const replay = submitPurchaseOrders(state, {
    idempotencyKey: 'cannot-afford',
    lines: [{ skuId: 'driver3', quantity: 4 }],
  });
  assert.equal(replay.replayed, true);
  assert.equal(state.cash, 1);
});

test('stage moves are atomic and a refused overdraw changes no lot', () => {
  const state = setup();
  submitPurchaseOrders(state, {
    idempotencyKey: 'atomic',
    lines: [{ skuId: 'balls2', quantity: 12 }],
  });

  const received = moveInventory(state, {
    from: INVENTORY_STAGE.IN_TRANSIT,
    to: INVENTORY_STAGE.DELIVERED_UNOPENED,
    skuId: 'balls2',
    quantity: 7,
    referenceId: 'receive-part',
  });
  assert.equal(received.ok, true);
  assert.equal(inventoryPosition(state, 'balls2').inTransit, 5);
  assert.equal(inventoryPosition(state, 'balls2').deliveredUnopened, 7);

  const before = structuredClone(state.shop.inventoryLifecycle.lots);
  const refused = moveInventory(state, {
    from: INVENTORY_STAGE.IN_TRANSIT,
    to: INVENTORY_STAGE.DELIVERED_UNOPENED,
    skuId: 'balls2',
    quantity: 6,
  });
  assert.equal(refused.ok, false);
  assert.deepEqual(state.shop.inventoryLifecycle.lots, before);

  const replay = moveInventory(state, {
    from: INVENTORY_STAGE.IN_TRANSIT,
    to: INVENTORY_STAGE.DELIVERED_UNOPENED,
    skuId: 'balls2',
    quantity: 7,
    referenceId: 'receive-part',
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(inventoryPosition(state, 'balls2').deliveredUnopened, 7);
});

test('box receipt, opening, and partial removal retain exact lot allocations', () => {
  const state = setup();
  const placed = submitPurchaseOrders(state, {
    idempotencyKey: 'box-flow',
    lines: [{ skuId: 'balls2', quantity: 12 }],
  });
  const order = placed.orders[0];
  const manifestBox = order.manifest.boxes[0];
  const box = {
    id: 900,
    persistentId: 'box-900',
    orderId: order.id,
    skuId: manifestBox.skuId,
    qty: manifestBox.qty,
    remainingQuantity: manifestBox.qty,
    tape: 0,
    flaps: [0, 0],
    loc: 'pad',
  };

  const receipt = receiveBoxInventory(state, order.id, box.id, [{
    lineId: manifestBox.lineId,
    skuId: manifestBox.skuId,
    quantity: manifestBox.qty,
  }]);
  assert.equal(receipt.ok, true);
  box.contents = receipt.contents;
  state.shop.deliveries.boxes.push(box);
  assert.equal(box.contents.reduce((sum, content) => sum + content.remainingQuantity, 0), 12);
  assert.equal(inventoryPosition(state, 'balls2').deliveredUnopened, 12);

  assert.equal(openBoxInventory(state, box).ok, true);
  assert.equal(inventoryPosition(state, 'balls2').deliveredUnopened, 0);
  assert.equal(inventoryPosition(state, 'balls2').openedBox, 12);
  assert.equal(openBoxInventory(state, box).ok, false, 'cannot open inventory twice');

  const take = takeBoxInventory(state, box, 'balls2', 5, 'take-box-900-1');
  assert.equal(take.ok, true);
  assert.equal(box.qty, 7);
  assert.equal(box.remainingQuantity, 7);
  assert.equal(box.contents[0].remainingQuantity, 7);
  assert.equal(inventoryPosition(state, 'balls2').openedBox, 7);
  assert.equal(inventoryPosition(state, 'balls2').reserve, 5);

  // Mirror the successful ledger movement in the existing physical carry
  // projection, then the full cross-system reconciliation is exact.
  state.shop.carry = { skuId: 'balls2', qty: 5, allocations: take.allocations };
  box.tape = 1;
  box.inventoryOpened = true;
  assert.equal(reconcileInventory(state).ok, true);
});

test('cancellation unwinds one charge, retires lots, and cannot refund twice', () => {
  const state = setup();
  const cash = state.cash;
  const placed = submitPurchaseOrders(state, {
    idempotencyKey: 'cancel-me',
    lines: [{ skuId: 'polo1', quantity: 6 }],
  });
  const order = placed.orders[0];
  assert.equal(state.cash, cash - placed.cost);

  const cancelled = cancelPurchaseOrder(state, order.id);
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.refund, placed.cost);
  assert.equal(state.cash, cash);
  assert.equal(order.state, ORDER_STATE.CANCELLED);
  assert.equal(inventoryPosition(state, 'polo1').inTransit, 0);

  const cashAfterRefund = state.cash;
  assert.equal(cancelPurchaseOrder(state, order.id).ok, false);
  assert.equal(state.cash, cashAfterRefund);
});

test('reconciliation reports and QA-logs discrepancies without repairing them', () => {
  const state = setup();
  const lifecycle = state.shop.inventoryLifecycle;
  const shelfBefore = state.shop.inventory.balls1.shelf;
  state.shop.inventory.balls1.shelf -= 1;

  const quiet = reconcileInventory(state);
  assert.equal(quiet.ok, false);
  assert.equal(lifecycle.discrepancies.length, 0, 'production check does not grow QA logs');
  assert.equal(state.shop.inventory.balls1.shelf, shelfBefore - 1, 'no silent repair');

  const qa = reconcileInventory(state, { qa: true, context: 'unit-test' });
  assert.equal(qa.ok, false);
  assert.ok(lifecycle.discrepancies.some((entry) => entry.context === 'unit-test'));
  assert.equal(state.shop.inventory.balls1.shelf, shelfBefore - 1);
});

test('low-stock advice includes real inbound quantity, supplier, and ETA without auto-ordering', () => {
  const state = setup();
  state.shop.salesWindow = [
    { balls1: 4 }, { balls1: 5 }, { balls1: 3 },
  ];
  const before = state.shop.orders.length;
  submitPurchaseOrders(state, {
    idempotencyKey: 'reorder-inbound',
    lines: [{ skuId: 'balls1', quantity: 12 }],
  });
  const suggestion = reorderSuggestion(state, 'balls1');

  assert.equal(suggestion.supplierId, 'fairway');
  assert.equal(suggestion.incoming, 12);
  assert.ok(Number.isFinite(suggestion.earliestEtaMin));
  assert.equal(state.shop.orders.length, before + 1, 'reading advice did not place another order');
});
