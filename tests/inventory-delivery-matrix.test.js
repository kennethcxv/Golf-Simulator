import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { skuById } from '../src/data/shopItems.js';
import { capacityOf } from '../src/data/fixtureSlots.js';
import { exposedDeliveryPadBoxIds } from '../src/data/deliveryStaging.js';
import { PACKING_STATION_BOX_SURFACE_ID } from '../src/data/boxPlacementSurfaces.js';
import {
  INVENTORY_STAGE,
  ORDER_STATE,
  disposeInventory,
  ensureInventoryLifecycle,
  inventoryPosition,
  purchaseOrderById,
  reconcileInventory,
  reorderSuggestion,
  submitPurchaseOrders,
} from '../src/sim/inventoryLifecycle.js';
import {
  FALLBACK_CAPACITY,
  PAD_CAPACITY,
  arriveOrder,
  boxesOf,
  carriedBox,
  cutTape,
  fallbackCount,
  flattenBox,
  flapsOpen,
  openFlap,
  padCount,
  pickUpBox,
  putDownBox,
  recycleBox,
  takeFromBox,
} from '../src/sim/deliveries.js';
import { tickDeliveries } from '../src/sim/shop.js';
import {
  carriedGoods,
  homeOf,
  stockFixture,
  storeInBack,
  takeFromBack,
} from '../src/sim/stocking.js';
import {
  checkoutSale,
  pickFromShelf,
  returnToShelf,
} from '../src/sim/checkout.js';

function setup(seed = 7100) {
  const state = newGame('relaxed', seed);
  state.cash = 10_000_000;
  state.shop.unlockedTier = 3;
  state.__qaMode = true;
  ensureInventoryLifecycle(state);
  return state;
}

function assertReconciled(state, context) {
  const result = reconcileInventory(state, { qa: true, context });
  assert.equal(result.ok, true, `${context}: ${JSON.stringify(result.discrepancies)}`);
  return result;
}

function submit(state, lines, key) {
  const result = submitPurchaseOrders(state, { lines, idempotencyKey: key });
  assert.equal(result.ok, true, result.reason);
  assertReconciled(state, `${key}:submitted`);
  return result;
}

function openPhysicalBox(state, box) {
  assert.equal(cutTape(state, box.id, 0.45).ok, true);
  assert.ok(box.tape > 0 && box.tape < 1, 'partial cut is retained');
  assert.equal(cutTape(state, box.id, 1).ok, true);
  assert.equal(openFlap(state, box.id).ok, true);
  assert.equal(openFlap(state, box.id).ok, true);
  assert.equal(openFlap(state, box.id).ok, true);
  assert.equal(flapsOpen(box), true);
}

function drainBoxToReserve(state, box) {
  if (box.tape < 1 || !flapsOpen(box)) openPhysicalBox(state, box);
  while (box.qty > 0) {
    const taken = takeFromBox(state, box.id);
    assert.equal(taken.ok, true, taken.reason);
    assert.equal(storeInBack(state).ok, true);
  }
  assert.equal(flattenBox(state, box.id).ok, true);
  assert.equal(recycleBox(state, box.id).ok, true);
}

test('matrix: one SKU/box, ten boxes, multiple SKUs and suppliers quote and land exactly', () => {
  const state = setup(7101);
  const cash = state.cash;
  const one = submit(state, [{ skuId: 'bag1', quantity: 1 }], 'matrix-one-box');
  assert.equal(one.orders.length, 1);
  assert.equal(one.boxes, 1);
  assert.equal(one.orders[0].manifest.boxCount, 1);

  const ten = submit(state, [{ skuId: 'balls2', quantity: 120 }], 'matrix-ten-boxes');
  assert.equal(ten.boxes, 10);
  assert.equal(ten.orders[0].manifest.boxes.reduce((sum, box) => sum + box.qty, 0), 120);

  const mixed = submit(state, [
    { skuId: 'balls1', quantity: 7 },
    { skuId: 'tees1', quantity: 9 },
    { skuId: 'polo2', quantity: 5 },
    { skuId: 'driver2', quantity: 2 },
  ], 'matrix-mixed-suppliers');
  assert.equal(mixed.orders.length, 3);
  assert.equal(new Set(mixed.orders.map((order) => order.supplierId)).size, 3);
  assert.equal(mixed.orders.reduce((sum, order) => sum + order.lines.length, 0), 4);
  assert.equal(state.cash, cash - one.cost - ten.cost - mixed.cost);

  const landed = arriveOrder(state, ten.orders[0]);
  assert.equal(landed.length, 10);
  assert.equal(padCount(state), PAD_CAPACITY);
  assert.equal(fallbackCount(state), 1);
  assert.equal(landed.reduce((sum, box) => sum + box.qty, 0), 120);
  assert.equal(new Set(landed.map((box) => box.persistentId)).size, 10);
  assertReconciled(state, 'matrix-ten-boxes-landed');
});

test('matrix: simultaneous arrivals reserve pad and fallback, block safely, then recover', () => {
  const state = setup(7102);
  const orders = [];
  for (let index = 0; index < 23; index += 1) {
    const placed = submit(state, [{ skuId: 'bag1', quantity: 1 }], `capacity-order-${index}`);
    const order = placed.orders[0];
    // One accelerated tick sees every order due at once.
    order.deliveryMin = 2000;
    order.window.open = 1900;
    order.window.close = 2020;
    orders.push(order);
  }
  const events = tickDeliveries(state, 2001);
  assert.equal(padCount(state), PAD_CAPACITY);
  assert.equal(fallbackCount(state), FALLBACK_CAPACITY);
  assert.equal(boxesOf(state).length, PAD_CAPACITY + FALLBACK_CAPACITY);
  assert.equal(
    new Set(boxesOf(state).filter((box) => box.loc === 'pad').map((box) => box.receivingSlot)).size,
    PAD_CAPACITY,
    'every occupied pad bay has a unique stable slot',
  );
  assert.equal(
    new Set(boxesOf(state).filter((box) => box.loc === 'receiving-fallback').map((box) => box.receivingSlot)).size,
    FALLBACK_CAPACITY,
    'every occupied fallback bay has a unique stable slot',
  );
  assert.equal(events.filter((event) => event.kind === 'arrived').length, 21);
  assert.equal(events.filter((event) => event.kind === 'blocked').length, 2);
  assert.equal(state.shop.orders.length, 2, 'blocked orders remain on their vans');
  for (const order of state.shop.orders) {
    assert.equal(inventoryPosition(state, 'bag1').inTransit >= 2, true);
    assert.equal(order.state, ORDER_STATE.ARRIVING);
  }
  assertReconciled(state, 'receiving-full');

  const padBoxes = boxesOf(state).filter((box) => box.loc === 'pad');
  const exposedIds = exposedDeliveryPadBoxIds(padBoxes);
  const cleared = padBoxes.find((box) => exposedIds.has(box.id));
  assert.equal(pickUpBox(state, cleared.id).ok, true);
  assert.equal(putDownBox(state, cleared.id, { x: 6.4, z: -4.4, ry: 0 }).ok, true);
  const recovered = tickDeliveries(state, 2002);
  assert.equal(recovered.some((event) => event.kind === 'arrived'), true);
  assert.equal(padCount(state), PAD_CAPACITY);
  assert.deepEqual(
    boxesOf(state).filter((box) => box.loc === 'pad').map((box) => box.receivingSlot).sort((a, b) => a - b),
    Array.from({ length: PAD_CAPACITY }, (_, index) => index),
    'the recovered arrival fills the vacated bay instead of duplicating another transform',
  );
  assert.equal(state.shop.orders.length, 1);
  assertReconciled(state, 'receiving-recovered');
});

test('matrix: delivery while away and every required save point preserve identity and quantity', () => {
  let state = setup(7103);
  const placed = submit(state, [{ skuId: 'balls2', quantity: 12 }], 'save-stage-order');
  const orderId = placed.orders[0].id;
  const charge = placed.cost;
  const cashAfterOrder = state.cash;

  state = deserialize(serialize(state));
  assert.equal(state.cash, cashAfterOrder);
  assert.equal(inventoryPosition(state, 'balls2').inTransit, 12);
  const replay = submitPurchaseOrders(state, {
    lines: [{ skuId: 'balls2', quantity: 12 }],
    idempotencyKey: 'save-stage-order',
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.charged, 0);
  assert.equal(state.cash, cashAfterOrder, `save-before-arrival did not repeat the ${charge} charge`);

  const due = state.shop.orders.find((order) => order.id === orderId);
  const awayEvents = tickDeliveries(state, due.deliveryMin + 1);
  assert.equal(awayEvents.some((event) => event.kind === 'arrived'), true);
  assert.equal(state.shop.orders.some((order) => order.id === orderId), false);
  let box = boxesOf(state).find((candidate) => candidate.orderId === orderId);
  const boxId = box.persistentId;
  assertReconciled(state, 'save-after-away-arrival');

  state = deserialize(serialize(state));
  box = boxesOf(state).find((candidate) => candidate.persistentId === boxId);
  assert.ok(box);
  assert.equal(box.qty, 12);
  assert.deepEqual(box.contents.map((content) => content.remainingQuantity), [12]);

  assert.equal(cutTape(state, box.id, 0.43).ok, true);
  assertReconciled(state, 'save-mid-cut-before-reload');
  state = deserialize(serialize(state));
  box = boxesOf(state).find((candidate) => candidate.persistentId === boxId);
  assert.equal(box.tape, 0.43, 'save during opening preserves the seam progress');
  assertReconciled(state, 'save-mid-cut-after-reload');
  assert.equal(cutTape(state, box.id, 1).ok, true);
  openFlap(state, box.id);
  openFlap(state, box.id);
  openFlap(state, box.id);
  assert.equal(takeFromBox(state, box.id, 5).ok, true);
  assert.equal(box.qty, 7);

  state = deserialize(serialize(state));
  box = boxesOf(state).find((candidate) => candidate.persistentId === boxId);
  assert.equal(box.qty, 7);
  assert.equal(box.contents.reduce((sum, content) => sum + content.remainingQuantity, 0), 7);
  assert.equal(carriedGoods(state).qty, 5, 'save with a partial box preserves carried products');
  assertReconciled(state, 'save-partial-box-and-product-carry');

  assert.equal(storeInBack(state).ok, true);
  assert.equal(pickUpBox(state, box.id).ok, true);
  assert.equal(carriedBox(state).persistentId, boxId);
  state = deserialize(serialize(state));
  assert.equal(carriedBox(state).persistentId, boxId, 'save while carrying preserves the same box');
  assert.equal(putDownBox(state, carriedBox(state).id, {
    kind: 'surface', surfaceId: PACKING_STATION_BOX_SURFACE_ID, x: 0, z: 0, ry: 0,
  }).ok, true);
  state = deserialize(serialize(state));
  box = boxesOf(state).find((candidate) => candidate.persistentId === boxId);
  assert.deepEqual(
    { x: box.x, z: box.z, surfaceId: box.surfaceId },
    { x: 0, z: 0, surfaceId: PACKING_STATION_BOX_SURFACE_ID },
  );
  assertReconciled(state, 'save-worktable-transform');
});

test('matrix: partial/full shelf, leftovers, abandonment and paid sale stay conserved', () => {
  const state = setup(7104);
  const openingShelf = state.shop.inventory.balls2.shelf;
  const openingBack = state.shop.inventory.balls2.back;
  const placed = submit(state, [{ skuId: 'balls2', quantity: 30 }], 'shelf-customer-flow');
  const newBoxes = arriveOrder(state, placed.orders[0]);
  assert.equal(newBoxes.length, 3);
  for (const box of [...newBoxes]) drainBoxToReserve(state, box);
  assert.equal(inventoryPosition(state, 'balls2').reserve, 30);
  assertReconciled(state, 'reserve-before-stock');

  const home = homeOf('balls2');
  const cap = capacityOf('balls2');
  let observedPartial = false;
  while (state.shop.inventory.balls2.shelf < cap) {
    const take = takeFromBack(state, 'balls2');
    assert.equal(take.ok, true);
    const stock = stockFixture(state, home.id, 999);
    assert.equal(stock.ok, true);
    if (stock.onShelf > 0 && stock.onShelf < cap) observedPartial = true;
  }
  assert.equal(observedPartial, true);
  assert.equal(state.shop.inventory.balls2.shelf, cap);
  const expectedReserve = openingBack + 30 - (cap - openingShelf);
  assert.equal(state.shop.inventory.balls2.back + carriedGoods(state).qty, expectedReserve);
  assert.equal(carriedGoods(state).qty, 3, 'the final over-capacity armful stays in the player’s hands');
  assert.equal(storeInBack(state).ok, true);
  assert.equal(state.shop.inventory.balls2.back, expectedReserve);
  assert.equal(carriedGoods(state), null);
  assertReconciled(state, 'full-shelf-leftovers');

  const beforeAbandon = inventoryPosition(state, 'balls2');
  assert.equal(pickFromShelf(state, 'balls2', 'abandon-1').ok, true);
  assert.equal(inventoryPosition(state, 'balls2').customerHeld, beforeAbandon.customerHeld + 1);
  assert.equal(returnToShelf(state, 'balls2', 'abandon-1').ok, true);
  assert.equal(state.shop.inventory.balls2.shelf, cap);
  assertReconciled(state, 'customer-abandonment');

  assert.equal(pickFromShelf(state, 'balls2', 'sale-a').ok, true);
  assert.equal(pickFromShelf(state, 'balls2', 'sale-b').ok, true);
  const cash = state.cash;
  const sale = checkoutSale(state, [
    { uid: 'sale-a', skuId: 'balls2', price: 28 },
    { uid: 'sale-b', skuId: 'balls2', price: 28 },
  ], 'Matrix customer');
  assert.equal(sale.ok, true);
  assert.equal(sale.total, 56);
  assert.equal(state.cash, cash + 56);
  assert.equal(inventoryPosition(state, 'balls2').sold, 2);
  assert.equal(inventoryPosition(state, 'balls2').customerHeld, 0);
  assertReconciled(state, 'successful-mixed-item-sale');

  const cashAfterSale = state.cash;
  const repeated = checkoutSale(state, [
    { uid: 'sale-a', skuId: 'balls2', price: 28 },
    { uid: 'sale-b', skuId: 'balls2', price: 28 },
  ], 'Repeated customer');
  assert.equal(repeated.ok, false);
  assert.equal(state.cash, cashAfterSale, 'a repeated checkout cannot create revenue');
  assert.equal(inventoryPosition(state, 'balls2').sold, 2, 'a repeated checkout cannot sell twice');
});

test('matrix: stale/unheld checkout refuses the whole basket before revenue or stock mutation', () => {
  const state = setup(7105);
  assert.equal(pickFromShelf(state, 'balls1', 'valid-held').ok, true);
  const cash = state.cash;
  const held = structuredClone(state.shop.held);
  const position = inventoryPosition(state, 'balls1');
  const result = checkoutSale(state, [
    { uid: 'valid-held', skuId: 'balls1', price: 15 },
    { uid: 'missing-held', skuId: 'balls1', price: 15 },
  ]);
  assert.equal(result.ok, false);
  assert.equal(state.cash, cash);
  assert.deepEqual(state.shop.held, held);
  assert.deepEqual(inventoryPosition(state, 'balls1'), position);
  assertReconciled(state, 'atomic-checkout-refusal');
});

test('matrix: reorder remains advisory and explicit loss/disposal is auditable', () => {
  const state = setup(7106);
  state.shop.salesWindow = [{ balls1: 5 }, { balls1: 4 }, { balls1: 6 }];
  const orders = state.shop.orders.length;
  const advice = reorderSuggestion(state, 'balls1');
  assert.equal(advice.shelfLow, false);
  assert.equal(state.shop.orders.length, orders, 'reading the suggestion never auto-orders');
  assert.equal(advice.supplierAvailable, true);
  assert.equal(advice.supplierId, 'fairway');

  const before = inventoryPosition(state, 'balls1');
  state.shop.inventory.balls1.shelf -= 1;
  const disposed = disposeInventory(state, {
    from: INVENTORY_STAGE.SHELF,
    skuId: 'balls1',
    quantity: 1,
    reason: 'QA damaged package write-off',
    referenceId: 'qa-disposal-1',
  });
  assert.equal(disposed.ok, true);
  assert.equal(inventoryPosition(state, 'balls1').disposedLost, before.disposedLost + 1);
  assert.equal(inventoryPosition(state, 'balls1').shelf, before.shelf - 1);
  assertReconciled(state, 'explicit-disposal');
});

test('matrix: 100 accelerated deliveries conserve exactly 1,000 ordered product units', () => {
  const state = setup(7107);
  const opening = inventoryPosition(state, 'balls2');
  const openingTotal = Object.values(INVENTORY_STAGE)
    .reduce((sum, stage) => sum + opening[stage], 0);
  let ordered = 0;
  let deliveredBoxes = 0;

  for (let index = 0; index < 100; index += 1) {
    const placed = submit(state, [{ skuId: 'balls2', quantity: 10 }], `accelerated-${index}`);
    const order = placed.orders[0];
    ordered += order.quantity;
    const events = tickDeliveries(state, order.deliveryMin + 1);
    const arrival = events.find((event) => event.kind === 'arrived');
    assert.ok(arrival, `delivery ${index} arrived`);
    deliveredBoxes += arrival.boxes.length;
    for (const box of [...arrival.boxes]) drainBoxToReserve(state, box);
    assert.equal(boxesOf(state).length, 0, `delivery ${index} left no empty carton behind`);
    if (index % 10 === 0) assertReconciled(state, `accelerated-checkpoint-${index}`);
  }

  assert.equal(ordered, 1000);
  assert.equal(deliveredBoxes, 100);
  assert.equal(state.shop.orders.length, 0);
  assert.equal(boxesOf(state).length, 0);
  assert.equal(inventoryPosition(state, 'balls2').reserve, opening.reserve + 1000);
  const final = inventoryPosition(state, 'balls2');
  const finalTotal = Object.values(INVENTORY_STAGE)
    .reduce((sum, stage) => sum + final[stage], 0);
  assert.equal(finalTotal - openingTotal, 1000);
  const reconciliation = assertReconciled(state, 'accelerated-final');
  assert.equal(reconciliation.orderedQuantity, 1000);
  assert.equal(state.shop.inventoryLifecycle.operationKeys.length <= 2500, true);
  assert.equal(state.shop.inventoryLifecycle.events.length <= 300, true);
  assert.equal(state.shop.deliveries.recycled, 100);
  assert.equal(purchaseOrderById(state, 100).completionState, ORDER_STATE.FULLY_UNPACKED);
  assert.equal(skuById('balls2').name, 'Tour-soft dozen');
});
