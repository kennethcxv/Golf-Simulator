import test from 'node:test';
import assert from 'node:assert/strict';
import { createTx, scanItem } from '../src/sim/register.js';
import { registerGuidance } from '../src/ui/registerGuidance.js';

const txFor = () => createTx({
  items: [
    { uid: 'a', skuId: 'balls3', name: 'Pro-V dozen', price: 47 },
    { uid: 'b', skuId: 'glove1', name: 'Cabretta glove', price: 19 },
  ],
});
const keys = (guidance) => guidance.controls.map((control) => control.key);

test('scanning guidance shows one relevant gesture, not future-stage keys', () => {
  const tx = txFor();
  const guidance = registerGuidance(tx, { customerName: 'Morgan W.' });
  assert.equal(guidance.title, 'Scan the order');
  assert.match(guidance.detail, /0\/2/);
  assert.deepEqual(keys(guidance), ['Mouse', 'Esc']);
  assert.equal(guidance.customer, 'Morgan W.');
  assert.equal(guidance.total, '$0.00', 'the header reflects the scanned subtotal, not unscanned goods');
  assert.equal(guidance.controls.at(-1).label, 'Leave register');
});

test('the total key appears only after every item has scanned', () => {
  const tx = txFor();
  tx.items.forEach((item) => scanItem(tx, item.uid));
  const guidance = registerGuidance(tx);
  assert.equal(guidance.title, 'Order ready to total');
  assert.equal(guidance.tone, 'ready');
  assert.deepEqual(keys(guidance), ['T', 'Esc']);
});

test('card failures become the primary visible instruction without a click bypass', () => {
  const tx = txFor();
  tx.stage = 'card-ready';
  tx.method = 'card';
  const guidance = registerGuidance(tx, { swipeFeedback: 'Complete the swipe' });
  assert.equal(guidance.progress, 1);
  assert.equal(guidance.title, 'Complete the swipe');
  assert.equal(guidance.tone, 'warn');
  assert.deepEqual(keys(guidance), ['Mouse', 'Esc']);
  assert.match(guidance.detail, /all the way down/);
});

test('cash guidance follows tender, drawer, deposit, count, and handoff state', () => {
  const tx = txFor();
  tx.items.forEach((item) => scanItem(tx, item.uid));
  tx.method = 'cash';
  tx.stage = 'cash-tender';
  tx.tendered = { 50: 1, 20: 1, 10: 1 };
  assert.deepEqual(keys(registerGuidance(tx)), ['Mouse', 'Esc']);

  tx.stage = 'cash-drawer';
  tx.tenderedTotal = 80;
  tx.tendered = {};
  assert.deepEqual(keys(registerGuidance(tx)), ['D', 'Esc']);

  tx.drawerOpen = true;
  assert.equal(registerGuidance(tx).title, 'Put the tender in the till');

  tx.deposited = true;
  tx.hand = { 10: 1 };
  assert.equal(registerGuidance(tx).title, 'Count $14.00 change');
  tx.hand = { 10: 1, 1: 4 };
  assert.equal(registerGuidance(tx).title, 'Hand back $14.00');
  assert.equal(registerGuidance(tx).tone, 'ready');
});

test('receipt, bagging, and handoff advance the five-step progress strip', () => {
  const tx = txFor();
  tx.stage = 'receipt';
  assert.equal(registerGuidance(tx).progress, 2);
  assert.equal(registerGuidance(tx).tone, 'busy');
  tx.receiptPrinted = true;
  assert.deepEqual(keys(registerGuidance(tx)), ['Mouse', 'Esc']);
  assert.equal(registerGuidance(tx, { receiptReady: false }).title, 'Printing receipt');
  assert.deepEqual(keys(registerGuidance(tx, { receiptReady: false })), ['Esc']);

  tx.stage = 'bagging';
  assert.equal(registerGuidance(tx).progress, 3);
  tx.items.forEach((item) => { item.bagged = true; });
  const handoff = registerGuidance(tx);
  assert.equal(handoff.progress, 4);
  assert.equal(handoff.title, 'Hand over the order');
  assert.deepEqual(keys(handoff), ['Mouse', 'Esc']);
});

test('visual handoff stays busy until the carrier reaches the customer', () => {
  const tx = txFor();
  tx.stage = 'done';
  const moving = registerGuidance(tx, { handoffPending: true });
  assert.equal(moving.title, 'Handing over the order');
  assert.equal(moving.tone, 'busy');
  assert.deepEqual(keys(moving), ['Esc']);
});
