// CARD AUTHORIZATION OVERRIDES (domain diagnostics).
//
// Normal gameplay approves after the cashier enters the exact amount. Explicit
// force outcomes remain available to focused domain tests so decline and retry
// recovery can still be exercised deterministically.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTx, scanItem, requestPayment,
  presentCard, insertCard, submitCardAmount, enterCardDigit, totalOf, runCard,
} from '../src/sim/register.js';

const basket = () => ([
  { uid: 'a', skuId: 'balls3', name: 'Pro-V dozen', price: 47 },
  { uid: 'b', skuId: 'glove1', name: 'Cabretta glove', price: 19.55 },
]);

const toCardBusy = (rng) => {
  const tx = createTx({ items: basket(), prefer: 'card', rng });
  for (const it of tx.items) scanItem(tx, it.uid);
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  // the reader opens at 0.00 — key the total before confirming
  for (const digit of String(Math.round(totalOf(tx) * 100))) enterCardDigit(tx, Number(digit));
  submitCardAmount(tx);
  return tx;
};

test('force:approved retains an explicit approval diagnostic', () => {
  const tx = toCardBusy(() => 0);
  const res = runCard(tx, { force: 'approved' });
  assert.equal(res.ok, true);
  assert.equal(res.result, 'approved');
  assert.equal(tx.stage, 'receipt');
});

test('force:declined retains an explicit decline recovery diagnostic', () => {
  const tx = toCardBusy(() => 0.99);
  const res = runCard(tx, { force: 'declined' });
  assert.equal(res.ok, true);
  assert.equal(res.result, 'declined');
  assert.equal(tx.stage, 'card-declined');
});

test('normal gameplay approves deterministically after exact amount entry', () => {
  const approve = toCardBusy(() => 0.99);
  assert.equal(runCard(approve).result, 'approved');
  const formerlyDecliningSeed = toCardBusy(() => 0);
  assert.equal(runCard(formerlyDecliningSeed).result, 'approved');
});
