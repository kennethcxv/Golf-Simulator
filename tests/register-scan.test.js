// SCANNING. The brief's rejected behaviour was a sale that completed through one
// button, so the rules that make a scan *mean* something are the ones under test:
//
//   - every item is scanned individually
//   - the same PHYSICAL item cannot be scanned twice
//   - payment cannot start while anything is unscanned
//
// Double-scan prevention is structural, not a guard: each item carries a unique
// `uid` and its own `scanned` flag. Two identical Pro-V dozens are two uids. You
// cannot express "scan the same one twice" and have it count twice, because the
// flag is on the piece, not on a tally.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTx, scanItem, unscannedCount, allScanned,
  subtotal, discountOf, totalOf, cashTotalOf, requestPayment,
} from '../src/sim/register.js';

const items = () => ([
  { uid: 'a', skuId: 'balls3', name: 'Pro-V dozen', price: 47 },
  { uid: 'b', skuId: 'balls3', name: 'Pro-V dozen', price: 47 },   // a SECOND, identical dozen
  { uid: 'c', skuId: 'glove1', name: 'Cabretta glove', price: 19.55 },
]);

test('a new transaction starts with nothing scanned and no payment method', () => {
  const tx = createTx({ items: items() });
  assert.equal(tx.stage, 'scanning');
  assert.equal(tx.method, null);
  assert.equal(unscannedCount(tx), 3);
  assert.equal(allScanned(tx), false);
  for (const it of tx.items) assert.equal(it.scanned, false);
});

test('scanning is per item - three items need three scans', () => {
  const tx = createTx({ items: items() });
  assert.equal(scanItem(tx, 'a').ok, true);
  assert.equal(unscannedCount(tx), 2);
  assert.equal(scanItem(tx, 'b').ok, true);
  assert.equal(unscannedCount(tx), 1);
  assert.equal(allScanned(tx), false, 'still one to go');
  assert.equal(scanItem(tx, 'c').ok, true);
  assert.equal(allScanned(tx), true);
});

test('the SAME physical item cannot be scanned twice', () => {
  const tx = createTx({ items: items() });
  assert.equal(scanItem(tx, 'a').ok, true);
  const again = scanItem(tx, 'a');
  assert.equal(again.ok, false);
  assert.match(again.reason, /already/i);
  assert.equal(unscannedCount(tx), 2, 'the re-scan did not advance the count');
  // its identical twin is still perfectly scannable — they are different pieces
  assert.equal(scanItem(tx, 'b').ok, true);
  assert.equal(unscannedCount(tx), 1);
});

test('scanning an item that is not on this order is refused', () => {
  const tx = createTx({ items: items() });
  const res = scanItem(tx, 'not-on-the-counter');
  assert.equal(res.ok, false);
  assert.equal(unscannedCount(tx), 3);
});

test('the running total only counts what has actually been scanned', () => {
  const tx = createTx({ items: items() });
  assert.equal(subtotal(tx), 0, 'nothing scanned yet, nothing owed');
  scanItem(tx, 'a');
  assert.equal(subtotal(tx), 47);
  scanItem(tx, 'c');
  assert.equal(subtotal(tx), 66.55);
  scanItem(tx, 'b');
  assert.equal(subtotal(tx), 113.55);
});

test('a member discount comes off the total, and cash remains cent-accurate', () => {
  const tx = createTx({ items: items(), discount: 0.1 });
  for (const it of tx.items) scanItem(tx, it.uid);
  assert.equal(subtotal(tx), 113.55);
  assert.equal(discountOf(tx), 11.36);           // 10% of 113.55, to the cent
  assert.equal(totalOf(tx), 102.19);             // what a CARD is charged, exactly
  assert.equal(cashTotalOf(tx), 102.19);         // CASH and card share the exact cent total
});

test('with no discount the card total and the subtotal agree', () => {
  const tx = createTx({ items: items() });
  for (const it of tx.items) scanItem(tx, it.uid);
  assert.equal(discountOf(tx), 0);
  assert.equal(totalOf(tx), 113.55);
  assert.equal(cashTotalOf(tx), 113.55);
});

test('payment cannot start while anything is unscanned', () => {
  const tx = createTx({ items: items() });
  scanItem(tx, 'a');
  scanItem(tx, 'b');
  const early = requestPayment(tx);
  assert.equal(early.ok, false);
  assert.match(early.reason, /scan/i);
  assert.equal(tx.stage, 'scanning', 'still scanning');
  assert.equal(tx.method, null, 'no method was chosen');

  scanItem(tx, 'c');
  const ok = requestPayment(tx);
  assert.equal(ok.ok, true);
  assert.ok(tx.method === 'cash' || tx.method === 'card');
});

test('an empty order cannot be paid for', () => {
  const tx = createTx({ items: [] });
  const res = requestPayment(tx);
  assert.equal(res.ok, false);
});
