import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  createTx, scanItem, requestPayment, acceptCash, openDrawer, depositTendered,
  takeFromDrawer, handOverChange, printReceipt, takeReceipt, packReceipt, bagItem,
  handOverGoods, completeSale, voidTx, newDrawer, makeChange, stackTotal,
  drawerContents, cashTotalOf, changeDue, retailTransactionId,
} from '../src/sim/register.js';
import { pickFromShelf, returnToShelf, heldUnits } from '../src/sim/checkout.js';
import { capacityOf } from '../src/data/fixtureSlots.js';
import { allocateCustomerIdentity } from '../src/sim/customerIdentity.js';
import {
  INVENTORY_STAGE,
  moveInventory,
  reconcileInventory,
  submitPurchaseOrders,
} from '../src/sim/inventoryLifecycle.js';

const round2 = (value) => Math.round(value * 100) / 100;

function hold(state, item) {
  const inv = state.shop.inventory[item.skuId];
  if (inv.shelf <= 0) inv.shelf = 1;
  assert.equal(pickFromShelf(state, item.skuId, item.uid).ok, true);
}

function countOut(tx, drawer, amount) {
  for (const [denom, count] of Object.entries(makeChange(amount))) {
    for (let i = 0; i < count; i += 1) {
      assert.equal(takeFromDrawer(tx, drawer, Number(denom)).ok, true);
    }
  }
}

function cashTx(state, {
  price = 10,
  tendered = 20,
  change = tendered - cashTotalOf({
    method: 'cash',
    discount: 0,
    items: [{ price, scanned: true }],
  }),
  mode = 'realistic',
  uid = 'cash-unit',
} = {}) {
  const item = { uid, skuId: 'balls3', name: 'Tour dozen', price };
  hold(state, item);
  if (!state.shop.drawer) state.shop.drawer = newDrawer();
  const tx = createTx({ items: [item], mode, prefer: 'cash', rng: () => 0.9 });
  scanItem(tx, uid);
  requestPayment(tx);
  tx.tendered = makeChange(tendered);
  acceptCash(tx);
  openDrawer(tx);
  depositTendered(tx, state.shop.drawer);
  countOut(tx, state.shop.drawer, change);
  const handed = handOverChange(tx, state.shop.drawer);
  assert.equal(handed.ok, true);
  return tx;
}

function finishPhysicalSale(tx) {
  const printed = printReceipt(tx);
  assert.equal(printed.ok, true);
  takeReceipt(tx);
  packReceipt(tx);
  for (const item of tx.items) bagItem(tx, item.uid);
  handOverGoods(tx);
  return printed.receipt;
}

test('rendered retail transaction identity survives reload and advances with ticket sequence', () => {
  const state = newGame('relaxed', 110);
  state.shop.nextTransactionNo = 7;
  const first = retailTransactionId(state);
  const reloaded = deserialize(serialize(state));
  assert.equal(retailTransactionId(reloaded), first,
    'the same persisted ticket keeps the same exact-once identity after reload');

  reloaded.shop.nextTransactionNo = 8;
  assert.notEqual(retailTransactionId(reloaded), first,
    'the next completed sale receives a fresh exact-once identity');
  assert.match(first, /:7$/);
});

test('cash stays transaction-local, then commits with cent-exact total and original tender on the receipt', () => {
  const state = newGame('relaxed', 101);
  state.shop.drawer = newDrawer();
  const opening = stackTotal(state.shop.drawer);
  const cashBefore = state.cash;
  const tx = cashTx(state, { price: 12.13, tendered: 20, change: 7.87, mode: 'relaxed' });

  assert.equal(cashTotalOf(tx), 12.13);
  assert.equal(changeDue(tx), 7.87);
  assert.equal(stackTotal(state.shop.drawer), opening, 'saved drawer is still the opening float');
  assert.equal(stackTotal(drawerContents(tx, state.shop.drawer)), round2(opening + 12.13));

  const receipt = finishPhysicalSale(tx);
  assert.equal(receipt.total, 12.13, 'cash receipt uses the exact amount due');
  assert.equal(receipt.tendered, 20, 'depositing pieces did not erase the printed tender');
  assert.equal(receipt.change, 7.87);
  assert.equal(receipt.rounding, 0);

  const result = completeSale(state, tx, 'Cash customer');
  assert.equal(result.ok, true);
  assert.equal(result.total, 12.13);
  assert.equal(result.cash, 12.13);
  assert.equal(stackTotal(state.shop.drawer), round2(opening + 12.13));
  assert.equal(round2(state.cash - cashBefore), 12.13);
  assert.deepEqual(heldUnits(state), []);
});

test('object customer identities stay readable across ticket and ledger postings', () => {
  const state = newGame('relaxed', 111);
  state.shop.drawer = newDrawer();
  const customer = allocateCustomerIdentity(state, {
    sourceId: 'register-integrity-rhea',
    legacy: { name: 'Rhea Osborne', customerId: 'customer-rhea' },
  });
  const tx = cashTx(state, { uid: 'named-customer-unit' });
  finishPhysicalSale(tx);

  const result = completeSale(state, tx, customer);
  assert.equal(result.ok, true);

  const postings = state.ledger.entries.filter((entry) => entry.relatedId === tx.id);
  assert.equal(postings.length, 2, 'the sale retains revenue and non-cash COGS postings');
  assert.equal(postings.find((entry) => entry.category === 'shopSales')?.description,
    'Register sale - Rhea Osborne');
  assert.equal(postings.find((entry) => entry.category === 'costOfGoods')?.description,
    'Cost of goods - Rhea Osborne');
  assert.equal(state.shop.transactionHistory[0].customer, 'Rhea Osborne');
  assert.equal(state.shop.transactionHistory[0].customerId, 'customer-rhea');
  assert.equal(state.shop.transactionHistory[0].transactionId, tx.id,
    'the durable ticket retains the exact ledger/idempotency transaction identity');
});

test('an unresolved customer event is rejected before stock, drawer, or money moves', () => {
  const state = newGame('relaxed', 112);
  state.shop.drawer = newDrawer();
  const tx = cashTx(state, { uid: 'unknown-customer-unit' });
  finishPhysicalSale(tx);
  const before = {
    cash: state.cash,
    drawer: JSON.stringify(state.shop.drawer),
    held: JSON.stringify(heldUnits(state)),
    history: state.shop.transactionHistory.length,
    ledger: state.ledger.entries.length,
  };

  const result = completeSale(state, tx, {
    name: 'Unresolved Customer',
    customerId: 'customer-does-not-exist',
  });
  assert.equal(result.ok, false);
  assert.match(result.diagnostic || result.reason, /unknown customer identity/i);
  assert.notEqual(tx.banked, true);
  assert.equal(state.cash, before.cash);
  assert.equal(JSON.stringify(state.shop.drawer), before.drawer);
  assert.equal(JSON.stringify(heldUnits(state)), before.held);
  assert.equal(state.shop.transactionHistory.length, before.history);
  assert.equal(state.ledger.entries.length, before.ledger);
});

test('void and save-like JSON reload cannot persist an in-progress drawer mutation', () => {
  const state = newGame('realistic', 102);
  state.shop.drawer = newDrawer();
  const openingDrawer = JSON.stringify(state.shop.drawer);
  const cashBefore = state.cash;
  const tx = cashTx(state, { price: 10, tendered: 20, change: 15 });

  assert.notEqual(JSON.stringify(drawerContents(tx, state.shop.drawer)), openingDrawer);
  assert.equal(JSON.stringify(state.shop.drawer), openingDrawer);

  const reloaded = deserialize(serialize(state));
  assert.equal(JSON.stringify(reloaded.shop.drawer), openingDrawer, 'only the committed float reached disk');
  assert.equal(reloaded.cash, cashBefore);
  assert.deepEqual(heldUnits(reloaded), [], 'reload recovered the still-held product');

  const roundTrippedTx = JSON.parse(JSON.stringify(tx));
  assert.ok(roundTrippedTx.drawerPending, 'the local journal itself is JSON-safe');
  voidTx(roundTrippedTx);
  assert.equal(roundTrippedTx.stage, 'voided');
  assert.equal(roundTrippedTx.drawerStart, null);
  assert.equal(roundTrippedTx.drawerPending, null);

  voidTx(tx);
  assert.equal(JSON.stringify(state.shop.drawer), openingDrawer);
  assert.equal(state.cash, cashBefore);
  assert.equal(returnToShelf(state, 'balls3', 'cash-unit').ok, true);
});

test('realistic over-change reduces cash and books a cash-over-short expense', () => {
  const state = newGame('realistic', 103);
  state.shop.drawer = newDrawer();
  const opening = stackTotal(state.shop.drawer);
  const cashBefore = state.cash;
  const tx = cashTx(state, { price: 10, tendered: 20, change: 15 });
  assert.equal(tx.lost, 5);
  finishPhysicalSale(tx);

  const result = completeSale(state, tx, 'Over-change customer');
  assert.equal(result.ok, true);
  assert.equal(result.total, 10);
  assert.equal(result.cash, 5);
  assert.equal(round2(stackTotal(state.shop.drawer) - opening), 5);
  assert.equal(round2(state.cash - cashBefore), 5);
  assert.equal(state.ledger.today.revenue.shopSales, 10);
  assert.equal(state.ledger.today.expense.cashOverShort, 5);
  assert.equal(state.shop.salesLive.revenue, 10, 'sales analytics retain the ticket value');
});

test('short-changing the customer is impossible in every mode - the handover refuses', () => {
  const state = newGame('realistic', 104);
  state.shop.drawer = newDrawer();
  const item = { uid: 'cash-unit', skuId: 'balls3', name: 'Tour dozen', price: 10 };
  hold(state, item);
  const tx = createTx({ items: [item], mode: 'realistic', prefer: 'cash', rng: () => 0.9 });
  scanItem(tx, 'cash-unit');
  requestPayment(tx);
  tx.tendered = makeChange(20);
  acceptCash(tx);
  openDrawer(tx);
  depositTendered(tx, state.shop.drawer);
  countOut(tx, state.shop.drawer, 5); // $10 due out of $20 — this is $5 short

  const refused = handOverChange(tx, state.shop.drawer);
  assert.equal(refused.ok, false, 'under-giving never completes, not even in realistic');
  assert.match(refused.reason, /not enough/i);
  assert.equal(tx.stage, 'cash-drawer', 'the drawer stays open for a recount');
  assert.equal(tx.lost, 0, 'nothing was booked');

  // topping up to the exact amount completes normally
  countOut(tx, state.shop.drawer, 5);
  const handed = handOverChange(tx, state.shop.drawer);
  assert.equal(handed.ok, true);
  assert.equal(handed.lost, 0);
  finishPhysicalSale(tx);
  const result = completeSale(state, tx, 'Recounted customer');
  assert.equal(result.ok, true);
  assert.equal(result.cash, 10);
});

test('a bad held UID rejects the whole sale before stock or money can partially bank', () => {
  const state = newGame('relaxed', 105);
  const cashBefore = state.cash;
  const items = [
    { uid: 'a', skuId: 'balls3', name: 'Tour dozen', price: 10 },
    // UID b is really a glove in the held ledger; the transaction must not relabel it.
    { uid: 'b', skuId: 'balls3', name: 'Another dozen', price: 10 },
  ];
  hold(state, items[0]);
  state.shop.inventory.glove1.shelf = 1;
  pickFromShelf(state, 'glove1', 'b');

  const tx = createTx({ items, prefer: 'card', rng: () => 0.9 });
  for (const item of tx.items) scanItem(tx, item.uid);
  requestPayment(tx);
  tx.stage = 'receipt';
  finishPhysicalSale(tx);

  const beforeHeld = structuredClone(heldUnits(state));
  const result = completeSale(state, tx, 'Invalid basket');
  assert.equal(result.ok, false);
  assert.match(result.diagnostic || result.reason, /does not match/i);
  assert.deepEqual(heldUnits(state), beforeHeld, 'the valid first UID was not partially consumed');
  assert.equal(state.cash, cashBefore);
  assert.equal((state.shop.salesLive || {}).units || 0, 0);
  assert.notEqual(tx.banked, true);
});

test('reload recovery respects per-SKU fixture capacity and sends overflow to back stock', () => {
  const state = newGame('relaxed', 106);
  state.cash = 100000;
  state.shop.progression.tier = 'premium';
  state.shop.unlockedTier = 3;
  const capacity = capacityOf('bag1');
  const inv = state.shop.inventory.bag1;
  const supplied = submitPurchaseOrders(state, {
    lines: [{ skuId: 'bag1', quantity: capacity + 1 }],
    idempotencyKey: 'register-recovery:bag-capacity-stock',
  });
  assert.equal(supplied.ok, true);
  const order = supplied.orders[0];
  const line = order.lines[0];
  const stockShelf = moveInventory(state, {
    from: INVENTORY_STAGE.IN_TRANSIT,
    to: INVENTORY_STAGE.SHELF,
    skuId: 'bag1',
    orderId: order.id,
    lineId: line.id,
    quantity: capacity,
    reason: 'Register recovery fixture setup',
  });
  assert.equal(stockShelf.ok, true);
  inv.shelf += capacity;
  const stockReserve = moveInventory(state, {
    from: INVENTORY_STAGE.IN_TRANSIT,
    to: INVENTORY_STAGE.RESERVE,
    skuId: 'bag1',
    orderId: order.id,
    lineId: line.id,
    quantity: 1,
    reason: 'Register recovery reserve setup',
  });
  assert.equal(stockReserve.ok, true);
  inv.back += 1;
  assert.equal(reconcileInventory(state).ok, true);

  assert.equal(pickFromShelf(state, 'bag1', 'bag-held').ok, true);
  assert.equal(inv.shelf, capacity - 1);

  // The display was replenished while the shopper still had the original bag.
  const replenished = moveInventory(state, {
    from: INVENTORY_STAGE.RESERVE,
    to: INVENTORY_STAGE.SHELF,
    skuId: 'bag1',
    quantity: 1,
    reason: 'Replenished bag display during checkout',
  });
  assert.equal(replenished.ok, true);
  inv.back -= 1;
  inv.shelf += 1;
  const reloaded = deserialize(serialize(state));

  assert.equal(reloaded.shop.inventory.bag1.shelf, capacity, 'the physical fixture did not overfill');
  assert.equal(reloaded.shop.inventory.bag1.back, 1, 'the recovered unit remained owned in back stock');
  assert.deepEqual(heldUnits(reloaded), []);
  assert.equal(reconcileInventory(reloaded).ok, true);
});
