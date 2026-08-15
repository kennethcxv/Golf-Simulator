// PAYING FOR TIME.
//
// Lead times were set against nothing in particular. Two changes since have
// attacked the wait from both ends: the leads halved (2026-07-29 morning) and
// the DAY quartered (2026-07-29 overnight, gameMinutesPerRealSecond 1/30 ->
// 4/30). A game day is now 3 real hours at 1x, 45 minutes at 4x, ~11 at 16x. It
// was twelve real hours at 1x, and a four-day club order was therefore 3 real
// hours at the fastest speed the game offered: several sessions between
// deciding to stock something and being able to sell it.
//
// Halved and floored at one day, with express taking one more day off for two
// and a half times the freight. Standard is usually "tomorrow", express is
// usually "today", and that is the whole sentence.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { LEAD_DAYS } from '../src/data/shopItems.js';
import {
  SUPPLIERS, SHIPPING_SPEEDS, shipFee, shippingLeadDays, shippingSpeed,
} from '../src/data/suppliers.js';
import { quotePurchaseOrders, submitPurchaseOrders } from '../src/sim/inventoryLifecycle.js';

function shop() {
  const state = newGame('relaxed', 20260729);
  state.cash = 500000;
  return state;
}

test('no line takes more than two days, and none takes less than one', () => {
  for (const [cat, days] of Object.entries(LEAD_DAYS)) {
    assert.ok(days >= 1, `${cat} arrives in ${days} days - same-day standard leaves express nothing to sell`);
    assert.ok(days <= 2, `${cat} takes ${days} days: more than one night is more than one session`);
  }
});

test('express takes exactly one day off, and never goes below same-day', () => {
  assert.equal(shippingLeadDays(2, 'express'), 1);
  assert.equal(shippingLeadDays(1, 'express'), 0);
  assert.equal(shippingLeadDays(0, 'express'), 0, 'there is no day before today to buy');
  assert.equal(shippingLeadDays(2, 'standard'), 2, 'standard changes nothing');
});

test('express freight is 2.5x standard, per supplier and per box', () => {
  for (const supplier of Object.values(SUPPLIERS)) {
    for (const boxes of [1, 2, 5]) {
      const standard = shipFee(supplier, boxes, 'standard');
      const express = shipFee(supplier, boxes, 'express');
      assert.equal(express, Math.round(standard * 2.5 * 100) / 100,
        `${supplier.id} x${boxes}: ${standard} -> ${express}`);
      assert.ok(express > standard, 'buying time has to cost something');
    }
  }
});

test('an unknown service falls back to standard rather than throwing', () => {
  assert.equal(shippingSpeed('overnight-rocket').id, 'standard');
  assert.equal(shipFee(SUPPLIERS.fairway, 2, undefined), shipFee(SUPPLIERS.fairway, 2, 'standard'));
});

test('the quote prices both services from the same cart', () => {
  const state = shop();
  const lines = [{ skuId: 'balls1', quantity: 24 }];
  const standard = quotePurchaseOrders(state, lines, 'standard');
  const express = quotePurchaseOrders(state, lines, 'express');
  assert.equal(standard.ok, true);
  assert.equal(express.ok, true);
  assert.equal(standard.goods, express.goods, 'the stock costs the same either way');
  assert.ok(express.freight > standard.freight, 'only the freight moves');
  assert.equal(express.leadDays, standard.leadDays - 1);
  assert.equal(standard.leadDays, LEAD_DAYS.balls);
});

test('the quoted lead is the slowest line in the cart', () => {
  const state = shop();
  // driver1 is clubs (2 days); a same-supplier cart of faster lines would hide
  // it behind an average and promise stock that is not there yet.
  const quote = quotePurchaseOrders(state, [
    { skuId: 'driver1', quantity: 1 },
    { skuId: 'putter1', quantity: 1 },
  ], 'standard');
  assert.equal(quote.leadDays, LEAD_DAYS.clubs);
});

test('an express order really is charged and scheduled as express', () => {
  const state = shop();
  const lines = [{ skuId: 'balls1', quantity: 24 }];
  const quoteStd = quotePurchaseOrders(state, lines, 'standard');
  const before = state.cash;
  const result = submitPurchaseOrders(state, { idempotencyKey: 'exp-1', lines, shipping: 'express' });
  assert.equal(result.ok, true, result.reason);
  const order = state.shop.orders[state.shop.orders.length - 1];
  assert.equal(order.shippingSpeed, 'express');
  assert.equal(order.leadDays, quoteStd.leadDays - 1);
  assert.equal(order.standardLeadDays, quoteStd.leadDays, 'the order remembers what it skipped');
  assert.ok(order.shippingCost > quoteStd.freight);
  assert.ok(before - state.cash > quoteStd.total, 'the premium was actually charged');
});

test('an order defaults to standard when no service is named', () => {
  const state = shop();
  const result = submitPurchaseOrders(state, {
    idempotencyKey: 'default-1',
    lines: [{ skuId: 'balls1', quantity: 12 }],
  });
  assert.equal(result.ok, true, result.reason);
  const order = state.shop.orders[state.shop.orders.length - 1];
  assert.equal(order.shippingSpeed, 'standard');
  assert.equal(order.leadDays, LEAD_DAYS.balls);
});

test('the same idempotency key cannot buy standard and then be replayed as express', () => {
  // The service is part of what was ordered. Without it in the fingerprint, the
  // replay would hand back the standard order and quietly pocket the premium.
  const state = shop();
  const lines = [{ skuId: 'balls1', quantity: 12 }];
  const first = submitPurchaseOrders(state, { idempotencyKey: 'dup', lines, shipping: 'standard' });
  assert.equal(first.ok, true, first.reason);
  const second = submitPurchaseOrders(state, { idempotencyKey: 'dup', lines, shipping: 'express' });
  assert.equal(second.ok, false, 'a different service under the same key must not be a silent replay');
});

test('a replay of the identical express order is still idempotent', () => {
  const state = shop();
  const lines = [{ skuId: 'balls1', quantity: 12 }];
  const first = submitPurchaseOrders(state, { idempotencyKey: 'same', lines, shipping: 'express' });
  const cashAfterFirst = state.cash;
  const second = submitPurchaseOrders(state, { idempotencyKey: 'same', lines, shipping: 'express' });
  assert.equal(first.ok, true, first.reason);
  assert.equal(second.ok, true, second.reason);
  assert.equal(second.replayed, true);
  assert.equal(state.cash, cashAfterFirst, 'a replay must not charge twice');
});

test('both services are offered, and only two', () => {
  assert.deepEqual(Object.keys(SHIPPING_SPEEDS), ['standard', 'express']);
  assert.equal(SHIPPING_SPEEDS.standard.feeMultiplier, 1);
  assert.equal(SHIPPING_SPEEDS.standard.daysSaved, 0);
});
