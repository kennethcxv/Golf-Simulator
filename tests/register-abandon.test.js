// WALKING OUT. The brief's list of things that must never happen:
//
//   Do not: duplicate products · delete products · duplicate money
//           leave a customer permanently frozen · leave register mode locked
//
// All five are the same failure wearing different hats: a transaction that outlives
// the person it belongs to. A shopper can leave the counter half-served in four
// different ways — patience runs out, they reach the exit, the shop shuts at eight,
// or the scene is torn down — and every one of them has to make the sale unfinishable.
//
// This bit the renderer for real. abandon() was wired into customerGiveUp only, so a
// shopper removed by any OTHER route left the register holding a live transaction over
// goods that had already been put back on the shelf. Completing it would have banked
// revenue for stock that was no longer sold.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import {
  createTx, scanItem, requestPayment, presentCard, insertCard,
  submitCardAmount, runCard,
  printReceipt, takeReceipt, packReceipt, bagItem, handOverGoods, completeSale, voidTx,
  openDrawer, takeFromDrawer, handOverChange, newDrawer, stackTotal,
} from '../src/sim/register.js';
import { pickFromShelf, returnToShelf, heldUnits } from '../src/sim/checkout.js';

const rngFor = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };
const confirmExactAmount = (tx) => submitCardAmount(tx);
const items = () => ([
  { uid: 'a', skuId: 'balls3', name: 'Pro-V dozen', price: 47 },
  { uid: 'b', skuId: 'glove1', name: 'Cabretta glove', price: 19 },
]);

test('a sale abandoned MID-SCAN banks nothing and cannot be resumed', () => {
  const st = newGame('relaxed', 5);
  const tx = createTx({ items: items() });
  scanItem(tx, 'a');

  voidTx(tx);

  assert.equal(scanItem(tx, 'b').ok, false, 'no more scanning');
  assert.equal(requestPayment(tx).ok, false, 'no payment');
  assert.equal(completeSale(st, tx, 'Ghost').ok, false, 'and it can never bank');
  assert.equal((st.shop.salesLive || {}).revenue || 0, 0);
});

test('a sale abandoned AFTER AN APPROVED CARD still banks nothing', () => {
  // this is the dangerous one: the money "worked", so it feels like a sale
  const st = newGame('relaxed', 5);
  const tx = createTx({ items: items(), rng: rngFor([0.1, 0.9]) });
  for (const it of tx.items) scanItem(tx, it.uid);
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  confirmExactAmount(tx);
  assert.equal(runCard(tx).result, 'approved');
  assert.equal(tx.stage, 'receipt');

  voidTx(tx);

  assert.equal(printReceipt(tx).ok, false);
  assert.equal(completeSale(st, tx, 'Ghost').ok, false);
  assert.equal((st.shop.salesLive || {}).revenue || 0, 0, 'an approval is not a sale');
});

test('a sale abandoned with the DRAWER OPEN leaves no money in the hand', () => {
  const st = newGame('relaxed', 5);
  const drawer = newDrawer();
  const before = stackTotal(drawer);
  const tx = createTx({ items: items(), rng: rngFor([0.9, 0.9]) });
  for (const it of tx.items) scanItem(tx, it.uid);
  requestPayment(tx);
  tx.tendered = { 100: 0, 50: 1, 20: 1 };
  tx.tenderedTotal = 70;
  tx.stage = 'cash-drawer';
  openDrawer(tx);
  takeFromDrawer(tx, drawer, 5);
  assert.equal(stackTotal(tx.hand), 5, 'a five is in the hand');

  voidTx(tx);

  assert.deepEqual(tx.hand, {}, 'the hand is empty');
  assert.equal(tx.drawerOpen, false, 'and the till is shut');
  assert.equal(handOverChange(tx, drawer).ok, false, 'no change can be given');
  assert.equal(completeSale(st, tx, 'Ghost').ok, false);
});

test('the goods a walked-out shopper was holding go back on the shelf, exactly once', () => {
  const st = newGame('relaxed', 5);
  st.shop.inventory.balls3.shelf = 6;
  st.shop.inventory.glove1.shelf = 6;

  pickFromShelf(st, 'balls3', 'a');
  pickFromShelf(st, 'glove1', 'b');
  assert.equal(st.shop.inventory.balls3.shelf, 5);
  assert.equal(heldUnits(st).length, 2);

  const tx = createTx({ items: items() });
  scanItem(tx, 'a');
  voidTx(tx);

  // this is what removeCustomer does
  for (const it of items()) returnToShelf(st, it.skuId, it.uid);

  assert.equal(st.shop.inventory.balls3.shelf, 6, 'back where it came from');
  assert.equal(st.shop.inventory.glove1.shelf, 6);
  assert.deepEqual(heldUnits(st), [], 'and off the held ledger');
  assert.equal((st.shop.salesLive || {}).revenue || 0, 0, 'no money was made or lost');
});

test('a finished sale cannot then be abandoned INTO a second bank', () => {
  const st = newGame('relaxed', 5);
  st.shop.inventory.balls3.shelf = 1;
  st.shop.inventory.glove1.shelf = 1;
  pickFromShelf(st, 'balls3', 'a');
  pickFromShelf(st, 'glove1', 'b');
  const tx = createTx({ items: items(), rng: rngFor([0.1, 0.9]) });
  for (const it of tx.items) scanItem(tx, it.uid);
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  confirmExactAmount(tx);
  runCard(tx);
  printReceipt(tx);
  takeReceipt(tx);
  packReceipt(tx);
  for (const it of tx.items) bagItem(tx, it.uid);
  handOverGoods(tx);
  assert.equal(completeSale(st, tx, 'Real').ok, true);
  const banked = st.shop.salesLive.revenue;
  assert.equal(banked, 66);

  // the customer object is torn down afterwards and abandon() runs on the way out
  voidTx(tx);
  assert.equal(completeSale(st, tx, 'Real').ok, false);
  assert.equal(st.shop.salesLive.revenue, banked, 'still banked exactly once');
});
