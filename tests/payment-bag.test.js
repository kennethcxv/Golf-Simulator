// THE BALANCED PAYMENT BAG. Over any complete batch exactly half the draws are
// cash and half are card, the order is shuffled, a customer's draw is permanent,
// and a half-used batch survives save/load byte-for-byte.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  drawPaymentMethod, refillPaymentBag, ensurePaymentBag,
  paymentDistributionReport, PAYMENT_BAG_BATCH,
} from '../src/sim/paymentBag.js';
import { createTx, requestPayment, scanItem } from '../src/sim/register.js';
import { makeRng } from '../src/core/utils.js';

const rngFn = (seed) => {
  const rng = makeRng(seed);
  return () => rng.next();
};

test('a full batch is exactly half cash and half card', () => {
  const state = newGame('relaxed', 900);
  const draws = [];
  const rng = rngFn(1);
  for (let i = 0; i < PAYMENT_BAG_BATCH; i += 1) draws.push(drawPaymentMethod(state, rng));
  assert.equal(draws.length, PAYMENT_BAG_BATCH);
  assert.equal(draws.filter((m) => m === 'cash').length, PAYMENT_BAG_BATCH / 2);
  assert.equal(draws.filter((m) => m === 'card').length, PAYMENT_BAG_BATCH / 2);
});

test('every complete batch stays balanced across many refills', () => {
  const state = newGame('relaxed', 901);
  const rng = rngFn(7);
  for (let batch = 0; batch < 20; batch += 1) {
    const draws = [];
    for (let i = 0; i < PAYMENT_BAG_BATCH; i += 1) draws.push(drawPaymentMethod(state, rng));
    assert.equal(draws.filter((m) => m === 'cash').length, PAYMENT_BAG_BATCH / 2, `batch ${batch} balanced`);
  }
});

test('the order is shuffled, not a fixed alternation', () => {
  const state = newGame('relaxed', 902);
  const rng = rngFn(11);
  const sequences = new Set();
  for (let batch = 0; batch < 12; batch += 1) {
    const draws = [];
    for (let i = 0; i < PAYMENT_BAG_BATCH; i += 1) draws.push(drawPaymentMethod(state, rng));
    sequences.add(draws.join(','));
  }
  assert.ok(sequences.size > 1, 'different batches produce different orders');
  const alternating = 'cash,card,cash,card,cash,card,cash,card,cash,card';
  assert.ok(
    [...sequences].some((sequence) => sequence !== alternating),
    'the bag is not a deterministic alternation',
  );
});

test('a half-used batch survives save/load and keeps its balance guarantee', () => {
  const state = newGame('relaxed', 903);
  const rng = rngFn(13);
  const before = [];
  for (let i = 0; i < 4; i += 1) before.push(drawPaymentMethod(state, rng));
  const bagAtSave = [...state.shop.paymentBag];

  const reloaded = deserialize(serialize(state));
  assert.deepEqual(reloaded.shop.paymentBag, bagAtSave, 'the remaining bag is intact');

  const after = [];
  for (let i = 0; i < PAYMENT_BAG_BATCH - 4; i += 1) after.push(drawPaymentMethod(reloaded, rng));
  const whole = [...before, ...after];
  assert.equal(whole.filter((m) => m === 'cash').length, PAYMENT_BAG_BATCH / 2, 'the split batch still lands 50/50');
});

test('a corrupted bag heals instead of breaking a draw', () => {
  const state = newGame('relaxed', 904);
  state.shop.paymentBag = ['cash', 'gold-doubloons', null, 42, 'card'];
  const bag = ensurePaymentBag(state);
  assert.deepEqual(bag, ['cash', 'card']);
  const method = drawPaymentMethod(state, rngFn(17));
  assert.ok(method === 'cash' || method === 'card');
});

test('a customer preference cannot change once the transaction begins', () => {
  const state = newGame('relaxed', 905);
  const method = drawPaymentMethod(state, rngFn(19));
  // the draw is stored on the customer; the transaction copies it as `prefer`
  const tx = createTx({
    items: [{ uid: 'u1', skuId: 'balls3', name: 'Tour dozen', price: 10 }],
    prefer: method,
    rng: () => (method === 'cash' ? 0.1 : 0.9), // adversarial rng that would flip it
  });
  scanItem(tx, 'u1');
  const started = requestPayment(tx);
  assert.equal(started.ok, true);
  assert.equal(started.method, method, 'requestPayment honours the stored preference');
  assert.equal(tx.method, method);
  // a JSON round-trip (save/load of an in-flight customer record) keeps it too
  const roundTripped = JSON.parse(JSON.stringify(tx));
  assert.equal(roundTripped.prefer, method);
});

test('the bag regenerates a fresh balanced batch when it empties', () => {
  const state = newGame('relaxed', 906);
  const rng = rngFn(23);
  refillPaymentBag(state, rng);
  for (let i = 0; i < PAYMENT_BAG_BATCH; i += 1) drawPaymentMethod(state, rng);
  assert.equal(state.shop.paymentBag.length, 0, 'batch exhausted');
  const next = drawPaymentMethod(state, rng);
  assert.ok(next === 'cash' || next === 'card');
  assert.equal(state.shop.paymentBag.length, PAYMENT_BAG_BATCH - 1, 'a new batch was minted');
  const remaining = state.shop.paymentBag;
  const cashLeft = remaining.filter((m) => m === 'cash').length + (next === 'cash' ? 1 : 0);
  assert.equal(cashLeft, PAYMENT_BAG_BATCH / 2, 'the new batch is balanced too');
});

test('the development diagnostic reports bag, draw, and banked tallies', () => {
  const state = newGame('relaxed', 907);
  const rng = rngFn(29);
  for (let i = 0; i < 6; i += 1) drawPaymentMethod(state, rng);
  const report = paymentDistributionReport(state);
  assert.equal(report.last100Draws.cash + report.last100Draws.card, 6);
  assert.equal(report.assigned.cash + report.assigned.card, 6);
  assert.equal(report.bag.length + 6, PAYMENT_BAG_BATCH);
  assert.ok(Number.isFinite(report.last100Banked.cash));
  assert.ok(Number.isFinite(report.last100Banked.card));
});
