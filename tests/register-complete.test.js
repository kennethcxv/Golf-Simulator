// CLOSING THE SALE — and the two ways it can go wrong.
//
// The brief's hard rules: money moves only when payment succeeds, inventory
// moves only when payment succeeds, and a game saved mid-sale must come back to
// a safe state with no product and no money duplicated or destroyed.
//
// That last one was a REAL BUG before this file existed. `pickFromShelf` debits
// the shelf the instant a shopper lifts an item, and the day-rollover autosave
// (main.js) snapshots `state` live — so a save taken while someone was at the
// counter persisted the missing stock but not the pending sale. On reload the
// shopper was gone, `checkoutSale` never ran, and the units were simply gone.
// The fix is to make "in a shopper's hands" a real, saved location: `shop.held`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { snapshot, deserialize, serialize } from '../src/sim/state.js';
import {
  createTx, scanItem, requestPayment, presentCard, insertCard,
  submitCardAmount, enterCardDigit, runCard,
  printReceipt, takeReceipt, packReceipt, bagItem, allBagged, handOverGoods,
  canComplete, completeSale, voidTx, totalOf,
} from '../src/sim/register.js';
import { pickFromShelf, returnToShelf, heldUnits, recoverCheckout } from '../src/sim/checkout.js';

const rngFor = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

// The reader opens at 0.00; the operator keys the figure before confirming.
const confirmExactAmount = (tx) => {
  for (const digit of String(Math.round(totalOf(tx) * 100))) enterCardDigit(tx, Number(digit));
  return submitCardAmount(tx);
};

const holdForSale = (state, tx) => {
  for (const item of tx.items) {
    if (heldUnits(state).some((unit) => unit.uid === item.uid)) continue;
    const inv = state.shop.inventory[item.skuId];
    if (inv.shelf <= 0) inv.shelf = 1;
    assert.equal(pickFromShelf(state, item.skuId, item.uid).ok, true);
  }
};

const paidTx = (mode = 'relaxed') => {
  const tx = createTx({
    items: [
      { uid: 'a', skuId: 'balls3', name: 'Pro-V dozen', price: 47 },
      { uid: 'b', skuId: 'glove1', name: 'Cabretta glove', price: 19 },
    ],
    mode,
    rng: rngFor([0.1, 0.9]), // card, approved
  });
  for (const it of tx.items) scanItem(tx, it.uid);
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  confirmExactAmount(tx);
  runCard(tx);
  return tx;
};

test('the receipt prints, then it has to be taken off the printer', () => {
  const tx = paidTx();
  assert.equal(tx.stage, 'receipt');
  assert.equal(tx.receiptPrinted, false);

  const r = printReceipt(tx);
  assert.equal(r.ok, true);
  assert.equal(tx.receiptPrinted, true);
  assert.equal(r.receipt.total, totalOf(tx));
  assert.equal(r.receipt.lines.length, 2);
  assert.equal(r.receipt.method, 'card');

  assert.equal(takeReceipt(tx).ok, true);
  assert.equal(tx.stage, 'bagging');
});

test('every item has to go in the bag before the customer gets it', () => {
  const tx = paidTx();
  printReceipt(tx);
  takeReceipt(tx);

  assert.equal(allBagged(tx), false);
  assert.equal(handOverGoods(tx).ok, false, 'cannot hand over a half-packed bag');

  assert.equal(bagItem(tx, 'a').ok, true);
  assert.equal(bagItem(tx, 'a').ok, false, 'it is already in the bag');
  assert.equal(allBagged(tx), false);
  assert.equal(bagItem(tx, 'b').ok, true);
  assert.equal(allBagged(tx), true);

  const missingReceipt = handOverGoods(tx);
  assert.equal(missingReceipt.ok, false, 'the receipt is part of the physical bag');
  assert.match(missingReceipt.reason, /receipt/i);
  assert.equal(packReceipt(tx).ok, true);
  assert.equal(packReceipt(tx).ok, false, 'the same receipt cannot be packed twice');

  const done = handOverGoods(tx);
  assert.equal(done.ok, true);
  assert.equal(tx.stage, 'done');
  assert.equal(canComplete(tx), true);
});

test('voiding clears the packed-receipt checkpoint', () => {
  const tx = paidTx();
  printReceipt(tx);
  takeReceipt(tx);
  assert.equal(packReceipt(tx).ok, true);
  assert.equal(tx.receiptPacked, true);

  voidTx(tx);
  assert.equal(tx.receiptPacked, false);
  assert.equal(canComplete(tx), false);
});

test('REVENUE moves only when the sale completes - not when it is scanned or paid', () => {
  const st = newGame('relaxed', 3);
  st.shop.inventory.balls3.shelf = 4;
  pickFromShelf(st, 'balls3', 'a');
  const before = st.shop.salesLive ? st.shop.salesLive.revenue : 0;

  const tx = createTx({
    items: [{ uid: 'a', skuId: 'balls3', name: 'Pro-V dozen', price: 47 }],
    rng: rngFor([0.1, 0.9]),
  });
  holdForSale(st, tx);
  scanItem(tx, 'a');
  assert.equal((st.shop.salesLive || {}).revenue || 0, before, 'scanning banks nothing');

  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  confirmExactAmount(tx);
  runCard(tx);
  assert.equal(tx.stage, 'receipt', 'approved');
  assert.equal((st.shop.salesLive || {}).revenue || 0, before, 'an approval alone banks nothing');

  printReceipt(tx);
  takeReceipt(tx);
  packReceipt(tx);
  bagItem(tx, 'a');
  handOverGoods(tx);

  const res = completeSale(st, tx, 'A customer');
  assert.equal(res.ok, true);
  assert.equal(res.total, 47);
  assert.equal(st.shop.salesLive.revenue, before + 47, 'banked exactly once, at the end');
});

test('a sale cannot be completed twice', () => {
  const st = newGame('relaxed', 3);
  st.shop.inventory.balls3.shelf = 4;
  st.shop.inventory.glove1.shelf = 4;
  pickFromShelf(st, 'balls3', 'a');
  pickFromShelf(st, 'glove1', 'b');
  const tx = paidTx();
  holdForSale(st, tx);
  printReceipt(tx);
  takeReceipt(tx);
  packReceipt(tx);
  for (const it of tx.items) bagItem(tx, it.uid);
  handOverGoods(tx);

  assert.equal(completeSale(st, tx, 'A').ok, true);
  assert.equal(st.shop.transactionHistory.length, 1, 'one physical handoff writes one transaction record');
  assert.deepEqual(
    {
      number: st.shop.transactionHistory[0].number,
      customer: st.shop.transactionHistory[0].customer,
      method: st.shop.transactionHistory[0].method,
      total: st.shop.transactionHistory[0].total,
      itemUids: st.shop.transactionHistory[0].items.map((item) => item.uid),
    },
    { number: 1, customer: 'A', method: 'card', total: 66, itemUids: ['a', 'b'] },
  );
  const reloaded = deserialize(serialize(st));
  assert.equal(reloaded.shop.transactionHistory.length, 1, 'the ticket survives save/load');
  assert.equal(reloaded.shop.nextTransactionNo, 2, 'the next number is preserved by the save');
  const banked = st.shop.salesLive.revenue;
  const twice = completeSale(st, tx, 'A');
  assert.equal(twice.ok, false, 'the second call is refused');
  assert.equal(st.shop.salesLive.revenue, banked, 'and it banks nothing');
  assert.equal(st.shop.transactionHistory.length, 1, 'and it cannot duplicate the transaction record');
});

test('a sale cannot be completed before the goods are handed over', () => {
  const st = newGame('relaxed', 3);
  const tx = paidTx();
  assert.equal(packReceipt(tx).ok, false, 'paper cannot be packed before it is printed and taken');
  assert.equal(completeSale(st, tx, 'A').ok, false, 'receipt not even printed');
  printReceipt(tx);
  assert.equal(packReceipt(tx).ok, false, 'paper still in the printer cannot be packed');
  takeReceipt(tx);
  assert.equal(completeSale(st, tx, 'A').ok, false, 'nothing bagged');
  assert.equal((st.shop.salesLive || {}).revenue || 0, 0);
});

// --- held stock: the location that used to be a hole in the books ------------------

test('a unit a shopper is holding is TRACKED, not just missing from the shelf', () => {
  const st = newGame('relaxed', 3);
  st.shop.inventory.balls3.shelf = 4;

  const pick = pickFromShelf(st, 'balls3', 'unit-1');
  assert.equal(pick.ok, true);
  assert.equal(st.shop.inventory.balls3.shelf, 3, 'off the shelf');
  assert.deepEqual(heldUnits(st), [{ uid: 'unit-1', skuId: 'balls3' }], 'but accounted for');
});

test('putting it back clears the held record', () => {
  const st = newGame('relaxed', 3);
  st.shop.inventory.balls3.shelf = 4;
  pickFromShelf(st, 'balls3', 'unit-1');
  returnToShelf(st, 'balls3', 'unit-1');
  assert.equal(st.shop.inventory.balls3.shelf, 4);
  assert.deepEqual(heldUnits(st), []);
});

test('completing the sale consumes the held units - they are sold, not returned', () => {
  const st = newGame('relaxed', 3);
  st.shop.inventory.balls3.shelf = 4;
  st.shop.inventory.glove1.shelf = 4;
  pickFromShelf(st, 'balls3', 'a');
  pickFromShelf(st, 'glove1', 'b');
  assert.equal(heldUnits(st).length, 2);

  const tx = paidTx();
  printReceipt(tx);
  takeReceipt(tx);
  packReceipt(tx);
  for (const it of tx.items) bagItem(tx, it.uid);
  handOverGoods(tx);
  completeSale(st, tx, 'A');

  assert.deepEqual(heldUnits(st), [], 'they left with the goods');
  assert.equal(st.shop.inventory.balls3.shelf, 3, 'and the shelf stays down - it was sold');
  assert.equal(st.shop.inventory.glove1.shelf, 3);
});

test('SAVE MID-SALE: reloading returns the held goods to the shelf and banks nothing', () => {
  const st = newGame('relaxed', 3);
  st.shop.inventory.balls3.shelf = 4;
  st.shop.inventory.glove1.shelf = 4;
  const cashBefore = st.cash;

  // a shopper is at the counter, half-scanned, holding two units
  pickFromShelf(st, 'balls3', 'a');
  pickFromShelf(st, 'glove1', 'b');
  assert.equal(st.shop.inventory.balls3.shelf, 3);
  assert.equal(heldUnits(st).length, 2);

  // ...and the day rolls over, which autosaves. The units in flight go TO DISK —
  // that is the whole fix; before this they were simply absent from the save.
  const json = serialize(st);
  assert.equal(JSON.parse(json).shop.held.length, 2, 'the save knew stock was in flight');

  // Reloading recovers on its own: deserialize() calls recoverCheckout(), because
  // every shopper lives in the renderer and none of them survive the reload.
  const reloaded = deserialize(json);
  assert.equal(reloaded.shop.inventory.balls3.shelf, 4, 'back on the shelf, automatically');
  assert.equal(reloaded.shop.inventory.glove1.shelf, 4);
  assert.deepEqual(heldUnits(reloaded), [], 'nothing left in limbo');
  assert.equal(reloaded.cash, cashBefore, 'and no money was invented');
  assert.equal((reloaded.shop.salesLive || {}).revenue || 0, 0, 'the sale never happened');
});

test('recovery is idempotent - loading twice does not duplicate stock', () => {
  const st = newGame('relaxed', 3);
  st.shop.inventory.balls3.shelf = 4;
  pickFromShelf(st, 'balls3', 'a');
  recoverCheckout(st);
  assert.equal(st.shop.inventory.balls3.shelf, 4);
  const again = recoverCheckout(st);
  assert.equal(again.returned, 0);
  assert.equal(st.shop.inventory.balls3.shelf, 4, 'still four, not five');
});

test('a voided transaction has moved no money and can never complete', () => {
  const st = newGame('relaxed', 3);
  const tx = paidTx();
  voidTx(tx);
  assert.equal(tx.stage, 'voided');
  assert.equal(completeSale(st, tx, 'A').ok, false);
  assert.equal((st.shop.salesLive || {}).revenue || 0, 0);
  // and no verb works on it any more
  assert.equal(scanItem(tx, 'a').ok, false);
  assert.equal(printReceipt(tx).ok, false);
});

test('the held ledger reaches the snapshot - without it, recovery has nothing to go on', () => {
  const st = newGame('relaxed', 3);
  st.shop.inventory.balls3.shelf = 4;
  pickFromShelf(st, 'balls3', 'u1');
  const snap = snapshot(st);
  assert.deepEqual(snap.shop.held, [{ uid: 'u1', skuId: 'balls3' }]);
});
