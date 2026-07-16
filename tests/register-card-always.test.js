// CARD ALWAYS APPROVES (gameplay).
//
// The player-facing card flow never declines: the customer hands the card, it
// auto-inserts, the player types the total, and it approves. The decline logic
// stays in register.js (and register-payment.test.js still covers it rng-driven),
// but the live renderer drives runCard with { force: 'approved' } so gameplay is
// deterministic. These tests lock that capability.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTx, scanItem, requestPayment, totalOf,
  presentCard, insertCard, enterCardDigit, submitCardAmount, runCard,
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
  for (const digit of String(Math.round(totalOf(tx) * 100))) enterCardDigit(tx, Number(digit));
  submitCardAmount(tx);
  return tx;
};

test('force:approved approves even when the rng would decline', () => {
  // rng()===0 is below DECLINE_CHANCE, so an un-forced run would decline.
  const tx = toCardBusy(() => 0);
  const res = runCard(tx, { force: 'approved' });
  assert.equal(res.ok, true);
  assert.equal(res.result, 'approved');
  assert.equal(tx.stage, 'receipt');
});

test('force:declined declines even when the rng would approve', () => {
  // rng()===0.99 is above DECLINE_CHANCE, so an un-forced run would approve.
  const tx = toCardBusy(() => 0.99);
  const res = runCard(tx, { force: 'declined' });
  assert.equal(res.ok, true);
  assert.equal(res.result, 'declined');
  assert.equal(tx.stage, 'card-declined');
});

test('no force preserves the rng-driven outcome', () => {
  const approve = toCardBusy(() => 0.99);
  assert.equal(runCard(approve).result, 'approved');
  const decline = toCardBusy(() => 0);
  assert.equal(runCard(decline).result, 'declined');
});
