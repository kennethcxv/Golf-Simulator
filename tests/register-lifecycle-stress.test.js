// CASHIER LIFECYCLE SAFETY
//
// The renderer owns the current customer and transaction; the save owns stock,
// books, and the committed drawer.  These tests hammer both sides of that
// boundary: completed sales must settle exactly once, while a save taken at any
// unbanked checkout stage must recover held stock and leave money untouched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  createTx,
  scanItem,
  requestPayment,
  presentCard,
  insertCard,
  submitCardAmount,
  runCard,
  acceptCash,
  openDrawer,
  depositTendered,
  takeFromDrawer,
  handOverChange,
  printReceipt,
  takeReceipt,
  packReceipt,
  bagItem,
  handOverGoods,
  completeSale,
  newDrawer,
  makeChange,
  stackTotal,
  cashTotalOf,
  changeDue,
} from '../src/sim/register.js';
import { pickFromShelf, heldUnits } from '../src/sim/checkout.js';
import { restockShelfFromBackroom } from '../src/sim/shop.js';

const cents = (value) => Math.round(value * 100);

function must(result, action) {
  assert.equal(result.ok, true, `${action}: ${result.reason || 'failed'}`);
  return result;
}

function scanAll(tx) {
  for (const item of tx.items) must(scanItem(tx, item.uid), `scan ${item.uid}`);
}

function finishGoods(tx) {
  must(printReceipt(tx), 'print receipt');
  must(takeReceipt(tx), 'take receipt');
  must(packReceipt(tx), 'pack receipt');
  for (const item of tx.items) must(bagItem(tx, item.uid), `bag ${item.uid}`);
  must(handOverGoods(tx), 'hand over goods');
}

function approveCard(tx) {
  must(requestPayment(tx), 'request card payment');
  must(presentCard(tx), 'present card');
  must(insertCard(tx), 'insert card');
  must(submitCardAmount(tx), 'confirm exact card total');
  const result = must(runCard(tx, { force: 'approved' }), 'approve card');
  assert.equal(result.result, 'approved');
}

function settleCash(tx, drawer) {
  must(requestPayment(tx), 'request cash payment');
  // Exact tender keeps the long stress run focused on settlement invariants;
  // the change-window edge cases have their own focused register tests.
  tx.tendered = makeChange(cashTotalOf(tx));
  must(acceptCash(tx), 'take cash');
  must(openDrawer(tx), 'open drawer');
  must(depositTendered(tx, drawer), 'deposit cash');
  assert.equal(changeDue(tx), 0);
  must(handOverChange(tx, drawer), 'confirm zero change');
}

function persistentCheckpoint(state) {
  return {
    cash: cents(state.cash),
    drawer: cents(stackTotal(state.shop.drawer)),
    revenue: cents(state.shop.salesLive?.revenue || 0),
    units: state.shop.salesLive?.units || 0,
    shopSales: cents(state.ledger.today.revenue.shopSales || 0),
    history: state.shop.transactionHistory.length,
    nextTransactionNo: state.shop.nextTransactionNo,
    log: state.shop.log.length,
    txLog: state.ledger.txLog.length,
    held: heldUnits(state).length,
  };
}

test('120 alternating card/cash sales settle once, reset cleanly, and keep persistent structures bounded', () => {
  const SALE_COUNT = 120;
  let state = newGame('relaxed', 12001);
  state.shop.drawer = newDrawer();

  const skuIds = ['balls1', 'tees1', 'glove1'];
  for (const skuId of skuIds) {
    state.shop.inventory[skuId].shelf = 0;
    state.shop.inventory[skuId].back = SALE_COUNT;
    must(restockShelfFromBackroom(state, skuId), `initial restock ${skuId}`);
  }

  const openingCashCents = cents(state.cash);
  const openingDrawerCents = cents(stackTotal(state.shop.drawer));
  let expectedRevenueCents = 0;
  let expectedDrawerGainCents = 0;

  for (let index = 0; index < SALE_COUNT; index += 1) {
    const skuId = skuIds[index % skuIds.length];
    const uid = `stress-${index + 1}`;
    const priceCents = 450 + ((index * 137) % 3200);
    const price = priceCents / 100;
    const method = index % 2 === 0 ? 'card' : 'cash';
    const item = { uid, skuId, name: `Stress item ${index + 1}`, price };

    if (state.shop.inventory[skuId].shelf === 0) {
      must(restockShelfFromBackroom(state, skuId), `restock ${skuId}`);
    }
    must(pickFromShelf(state, skuId, uid), `hold ${uid}`);
    const tx = createTx({
      items: [item],
      mode: 'relaxed',
      prefer: method,
      rng: () => 0.99,
    });

    assert.equal(tx.stage, 'scanning', 'each customer starts at a fresh register stage');
    assert.equal(tx.method, null);
    assert.equal(tx.banked, undefined);
    assert.deepEqual(tx.hand, {});
    assert.equal(tx.drawerStart, null);
    assert.equal(tx.drawerPending, null);

    scanAll(tx);
    if (method === 'card') approveCard(tx);
    else settleCash(tx, state.shop.drawer);
    finishGoods(tx);

    expectedRevenueCents += priceCents;
    if (method === 'cash') expectedDrawerGainCents += priceCents;

    const first = must(completeSale(state, tx, `Customer ${index + 1}`), 'complete sale');
    assert.equal(cents(first.total), priceCents);
    assert.equal(tx.banked, true);
    assert.equal(tx.stage, 'done');
    assert.equal(tx.number, index + 1);
    assert.equal(tx.drawerStart, null, 'a completed sale releases its opening drawer journal');
    assert.equal(tx.drawerPending, null, 'a completed sale releases its working drawer journal');
    assert.equal(tx.drawerOpen, false);
    assert.deepEqual(tx.hand, {});
    assert.deepEqual(heldUnits(state), [], 'no sold unit remains in the held ledger');

    const beforeDuplicate = persistentCheckpoint(state);
    const duplicate = completeSale(state, tx, `Customer ${index + 1}`);
    assert.equal(duplicate.ok, false, 'the same transaction cannot settle twice');
    assert.match(duplicate.reason, /not finished|already banked/i);
    assert.deepEqual(persistentCheckpoint(state), beforeDuplicate,
      'a duplicate completion attempt changes no stock, drawer, books, or bounded log');

    // Continue the same workload through a real save/load boundary.  There is no
    // live held stock here, so recovery must be a no-op and numbering must resume.
    if (index === 59) {
      const beforeReload = persistentCheckpoint(state);
      state = deserialize(serialize(state));
      assert.deepEqual(persistentCheckpoint(state), beforeReload);
    }
  }

  assert.equal(cents(state.cash) - openingCashCents, expectedRevenueCents);
  assert.equal(cents(state.ledger.today.revenue.shopSales), expectedRevenueCents);
  assert.equal(cents(state.shop.salesLive.revenue), expectedRevenueCents);
  assert.equal(state.shop.salesLive.units, SALE_COUNT);
  assert.equal(cents(stackTotal(state.shop.drawer)) - openingDrawerCents, expectedDrawerGainCents,
    'the physical drawer gains cash sales only, while card sales leave it alone');
  assert.equal(state.shop.salesToday.balls1, 40);
  assert.equal(state.shop.salesToday.tees1, 40);
  assert.equal(state.shop.salesToday.glove1, 40);
  assert.deepEqual(heldUnits(state), []);

  assert.equal(state.shop.transactionHistory.length, 100, 'ticket history keeps its documented cap');
  assert.equal(new Set(state.shop.transactionHistory.map((ticket) => ticket.number)).size, 100,
    'every retained ticket number is unique');
  assert.equal(state.shop.transactionHistory[0].number, SALE_COUNT);
  assert.equal(state.shop.transactionHistory.at(-1).number, SALE_COUNT - 99);
  assert.equal(state.shop.nextTransactionNo, SALE_COUNT + 1);
  assert.equal(state.shop.log.length, 8, 'shop flavor log stays bounded');
  assert.equal(state.ledger.txLog.length, 80, 'economy transaction log stays bounded');

  const loaded = deserialize(serialize(state));
  assert.equal(cents(loaded.cash), openingCashCents + expectedRevenueCents);
  assert.equal(cents(stackTotal(loaded.shop.drawer)), openingDrawerCents + expectedDrawerGainCents);
  assert.equal(loaded.shop.transactionHistory.length, 100);
  assert.equal(loaded.shop.nextTransactionNo, SALE_COUNT + 1);
  assert.deepEqual(heldUnits(loaded), []);
});

function advanceCard(tx, target) {
  if (target === 'scanning-unscanned') return;
  scanAll(tx);
  if (target === 'scanning-scanned') return;
  must(requestPayment(tx), 'request card payment');
  if (target === 'card-present') return;
  must(presentCard(tx), 'present card');
  if (target === 'card-ready') return;
  must(insertCard(tx), 'insert card');
  if (target === 'card-entry') return;
  must(submitCardAmount(tx), 'confirm card total');
  if (target === 'card-busy') return;
  if (target === 'card-declined') {
    must(runCard(tx, { force: 'declined' }), 'decline card');
    return;
  }
  must(runCard(tx, { force: 'approved' }), 'approve card');
  if (target === 'card-receipt') return;
  must(printReceipt(tx), 'print receipt');
  if (target === 'card-receipt-printed') return;
  must(takeReceipt(tx), 'take receipt');
  if (target === 'card-bagging') return;
  must(packReceipt(tx), 'pack receipt');
  for (const item of tx.items) must(bagItem(tx, item.uid), `bag ${item.uid}`);
  must(handOverGoods(tx), 'hand over goods');
}

function takeExactChange(tx, drawer) {
  for (const [denom, count] of Object.entries(makeChange(changeDue(tx)))) {
    for (let index = 0; index < count; index += 1) {
      must(takeFromDrawer(tx, drawer, Number(denom)), `take ${denom} change`);
    }
  }
}

function advanceCash(tx, drawer, target) {
  scanAll(tx);
  must(requestPayment(tx), 'request cash payment');
  if (target === 'cash-tender') return;
  tx.tendered = makeChange(20);
  must(acceptCash(tx), 'take customer cash');
  if (target === 'cash-drawer-accepted') return;
  must(openDrawer(tx), 'open drawer');
  if (target === 'cash-drawer-open') return;
  must(depositTendered(tx, drawer), 'deposit tender');
  if (target === 'cash-drawer-deposited') return;
  takeExactChange(tx, drawer);
  if (target === 'cash-drawer-counted') return;
  must(handOverChange(tx, drawer), 'hand over change');
  if (target === 'cash-receipt') return;
  must(printReceipt(tx), 'print receipt');
  if (target === 'cash-receipt-printed') return;
  must(takeReceipt(tx), 'take receipt');
  if (target === 'cash-bagging') return;
  must(packReceipt(tx), 'pack receipt');
  for (const item of tx.items) must(bagItem(tx, item.uid), `bag ${item.uid}`);
  must(handOverGoods(tx), 'hand over goods');
}

const ROLLBACK_STAGES = [
  { target: 'scanning-unscanned', expectedStage: 'scanning', method: 'card' },
  { target: 'scanning-scanned', expectedStage: 'scanning', method: 'card' },
  { target: 'card-present', expectedStage: 'card-present', method: 'card' },
  { target: 'card-ready', expectedStage: 'card-ready', method: 'card' },
  { target: 'card-entry', expectedStage: 'card-entry', method: 'card' },
  { target: 'card-busy', expectedStage: 'card-busy', method: 'card' },
  { target: 'card-declined', expectedStage: 'card-declined', method: 'card' },
  { target: 'card-receipt', expectedStage: 'receipt', method: 'card' },
  { target: 'card-receipt-printed', expectedStage: 'receipt', method: 'card' },
  { target: 'card-bagging', expectedStage: 'bagging', method: 'card' },
  { target: 'card-done-unbanked', expectedStage: 'done', method: 'card' },
  { target: 'cash-tender', expectedStage: 'cash-tender', method: 'cash' },
  { target: 'cash-drawer-accepted', expectedStage: 'cash-drawer', method: 'cash' },
  { target: 'cash-drawer-open', expectedStage: 'cash-drawer', method: 'cash' },
  { target: 'cash-drawer-deposited', expectedStage: 'cash-drawer', method: 'cash' },
  { target: 'cash-drawer-counted', expectedStage: 'cash-drawer', method: 'cash' },
  { target: 'cash-receipt', expectedStage: 'receipt', method: 'cash' },
  { target: 'cash-receipt-printed', expectedStage: 'receipt', method: 'cash' },
  { target: 'cash-bagging', expectedStage: 'bagging', method: 'cash' },
  { target: 'cash-done-unbanked', expectedStage: 'done', method: 'cash' },
];

test('save/load rolls every meaningful unbanked checkout stage back without stock or money loss', async (t) => {
  for (let stageIndex = 0; stageIndex < ROLLBACK_STAGES.length; stageIndex += 1) {
    const spec = ROLLBACK_STAGES[stageIndex];
    await t.test(spec.target, () => {
      const state = newGame('relaxed', 13000 + stageIndex);
      state.shop.drawer = newDrawer();
      state.shop.inventory.balls1.shelf = 6;
      state.shop.inventory.balls1.back = 2;
      const item = {
        uid: `rollback-${stageIndex}`,
        skuId: 'balls1',
        name: 'Rollback dozen',
        price: 12.13,
      };
      const openingCash = state.cash;
      const openingDrawer = structuredClone(state.shop.drawer);

      must(pickFromShelf(state, item.skuId, item.uid), 'hold rollback item');
      assert.equal(state.shop.inventory.balls1.shelf, 5);
      assert.deepEqual(heldUnits(state), [{ uid: item.uid, skuId: item.skuId }]);

      const tx = createTx({
        items: [item],
        mode: 'relaxed',
        prefer: spec.method,
        rng: () => 0.99,
      });
      if (spec.method === 'card') advanceCard(tx, spec.target);
      else advanceCash(tx, state.shop.drawer, spec.target);
      assert.equal(tx.stage, spec.expectedStage, 'the matrix reached the intended live stage');
      assert.notEqual(tx.banked, true, 'the matrix contains only unbanked checkpoints');

      // Cash handling is a transaction-local journal until completeSale().
      assert.deepEqual(state.shop.drawer, openingDrawer, 'the committed drawer never changed mid-sale');
      assert.equal(state.cash, openingCash);
      assert.equal(state.ledger.today.revenue.shopSales, 0);
      assert.equal(state.shop.salesLive?.revenue || 0, 0);
      assert.equal(state.shop.transactionHistory.length, 0);

      const json = serialize(state);
      const persisted = JSON.parse(json);
      assert.deepEqual(persisted.shop.held, [{ uid: item.uid, skuId: item.skuId }],
        'the save records the unit that is still in the ephemeral checkout');
      assert.deepEqual(persisted.shop.drawer, openingDrawer,
        'only the committed drawer, never the transaction-local journal, reaches disk');
      assert.equal(persisted.cash, openingCash);

      const loaded = deserialize(json);
      assert.deepEqual(heldUnits(loaded), [], 'reload clears the abandoned held ledger');
      assert.equal(loaded.shop.inventory.balls1.shelf, 6, 'reload returns the product to its fixture');
      assert.equal(loaded.shop.inventory.balls1.back, 2);
      assert.equal(loaded.cash, openingCash, 'an approval or prepared cash drawer never banks early');
      assert.equal(loaded.ledger.today.revenue.shopSales, 0);
      assert.equal(loaded.shop.salesLive?.revenue || 0, 0);
      assert.equal(loaded.shop.salesLive?.units || 0, 0);
      assert.equal(loaded.shop.transactionHistory.length, 0);
      assert.equal(loaded.shop.nextTransactionNo, 1);
      assert.deepEqual(loaded.shop.drawer, openingDrawer);

      const loadedAgain = deserialize(serialize(loaded));
      assert.deepEqual(heldUnits(loadedAgain), []);
      assert.equal(loadedAgain.shop.inventory.balls1.shelf, 6,
        'a second recovery cannot duplicate the returned unit');
      assert.equal(loadedAgain.shop.inventory.balls1.back, 2);
      assert.equal(loadedAgain.cash, openingCash);
      assert.deepEqual(loadedAgain.shop.drawer, openingDrawer);
    });
  }
});
