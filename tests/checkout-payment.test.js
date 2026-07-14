// Manual checkout payment: after the player scans everything, the customer
// presents cash or card. Cash needs real change math (Relaxed highlights the
// right amount, Realistic penalizes a miscount); cards can decline and retry.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startPayment, cashTender, changeDue, giveChange, processCard, DENOMS,
} from '../src/sim/checkout.js';

const rngFor = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

test('cash tender covers the total using real bill denominations', () => {
  for (const total of [1, 7, 12, 28, 43, 99, 222]) {
    const t = cashTender(total, rngFor([0.9]));
    assert.ok(t >= total, `tender ${t} covers ${total}`);
    // composable from bills
    let left = t;
    for (const d of DENOMS) left -= Math.floor(left / d) * d;
    assert.equal(left, 0, `tender ${t} is a bill amount`);
  }
});

test('a payment starts as cash or card and knows its change', () => {
  const cash = startPayment(28, 'relaxed', rngFor([0.9, 0.9])); // >0.35 → cash
  assert.equal(cash.method, 'cash');
  assert.ok(cash.tendered >= 28);
  assert.equal(changeDue(cash), cash.tendered - 28);
  const card = startPayment(28, 'relaxed', rngFor([0.1]));
  assert.equal(card.method, 'card');
  assert.equal(card.tendered, null);
});

test('correct change completes the sale in both modes', () => {
  for (const mode of ['relaxed', 'realistic']) {
    const tx = startPayment(28, mode, rngFor([0.9, 0.9]));
    const res = giveChange(tx, changeDue(tx));
    assert.ok(res.ok);
    assert.equal(tx.stage, 'receipt');
    assert.equal(res.lost, 0);
  }
});

test('wrong change: relaxed refuses and lets you recount, realistic eats the loss', () => {
  const relaxed = startPayment(28, 'relaxed', rngFor([0.9, 0.9]));
  const due = changeDue(relaxed);
  const r1 = giveChange(relaxed, due + 5);
  assert.equal(r1.ok, false);
  assert.equal(relaxed.stage, 'change', 'still at the drawer');
  assert.ok(giveChange(relaxed, due).ok, 'recount succeeds');

  const real = startPayment(28, 'realistic', rngFor([0.9, 0.9]));
  const due2 = changeDue(real);
  const r2 = giveChange(real, due2 + 5);
  assert.ok(r2.ok, 'realistic accepts the mistake');
  assert.equal(r2.lost, 5, 'the till is short five');
  assert.equal(real.stage, 'receipt');
});

test('cards can decline once and approve on retry', () => {
  const tx = startPayment(50, 'relaxed', rngFor([0.1, 0.01, 0.9]));
  assert.equal(tx.method, 'card');
  const first = processCard(tx);
  assert.equal(first.approved, false);
  assert.equal(tx.stage, 'declined');
  const second = processCard(tx);
  assert.ok(second.approved);
  assert.equal(tx.stage, 'receipt');
});
