// CARD AUTHORIZATION OVERRIDES (domain diagnostics).
//
// Normal gameplay uses the rng-driven authorization path, including decline and
// replacement-card retry. Explicit force outcomes remain available to focused
// domain tests so approval and decline settlement can be exercised deterministically.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTx, scanItem, requestPayment,
  presentCard, insertCard, submitCardAmount, runCard,
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
