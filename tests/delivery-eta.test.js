import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { placeOrder, cancelOrder, orderStatusAt, tickDeliveries } from '../src/sim/shop.js';
import { skuById } from '../src/data/shopItems.js';
import { boxesOf, PAD_CAPACITY, FALLBACK_CAPACITY } from '../src/sim/deliveries.js';
import {
  quoteDelivery, deliveryEtaText, deliveryQuoteText, expressFeeFor,
} from '../src/sim/deliveryEta.js';

const setup = ({ tutorialComplete = false } = {}) => {
  const state = newGame('relaxed', 7301);
  state.cash = 200000;
  state.shop.unlockedTier = 3;
  state.shop.progression.tier = 'premium';
  state.tutorial.complete = tutorialComplete;
  return state;
};

test('the campaign-critical opening order is a short same-day promise', () => {
  const state = setup();
  const quote = quoteDelivery(state, skuById('balls1'), 12);
  const result = placeOrder(state, 'balls1', 12);
  assert.ok(result.ok);
  assert.equal(result.order.pace, 'starter');
  assert.ok(result.order.deliveryMin - result.order.placedMin >= 120);
  assert.ok(result.order.deliveryMin - result.order.placedMin <= 210);
  assert.equal(result.order.deliveryMin, quote.deliveryMin, 'pre-confirmation quote becomes the saved promise');
  assert.match(deliveryQuoteText(quote), /game hours|game minutes/);
});

test('normal merchandise and large equipment have distinct, useful pacing', () => {
  const state = setup({ tutorialComplete: true });
  const local = quoteDelivery(state, skuById('polo1'), 8);
  const equipment = quoteDelivery(state, skuById('lounge1'), 1, { orderId: state.shop.nextOrderId + 1 });
  const localSpan = local.deliveryMin - local.placedMin;
  const equipmentSpan = equipment.deliveryMin - equipment.placedMin;
  assert.equal(local.pace, 'local');
  assert.ok(localSpan >= 240 && localSpan <= 420);
  assert.equal(equipment.pace, 'equipment');
  assert.ok(equipmentSpan >= 480 && equipmentSpan <= 780);
  assert.ok(equipmentSpan > localSpan, 'large equipment really takes longer');
});

test('express costs meaningful money, halves the wait, and is never instant', () => {
  const standardState = setup({ tutorialComplete: true });
  const expressState = setup({ tutorialComplete: true });
  const sku = skuById('driver1');
  const standard = quoteDelivery(standardState, sku, 4, { service: 'standard' });
  const express = quoteDelivery(expressState, sku, 4, { service: 'express', goods: sku.cost * 4, freight: 20 });
  assert.equal(express.deliveryMin - express.placedMin, Math.max(75, Math.round((standard.deliveryMin - standard.placedMin) * 0.5 / 15) * 15));
  assert.ok(express.deliveryMin - express.placedMin >= 75);
  assert.equal(express.expressFee, expressFeeFor(sku.cost * 4, 20));
  assert.ok(express.expressFee >= 18);

  const cash = expressState.cash;
  const placed = placeOrder(expressState, sku.id, 4, { service: 'express' });
  assert.ok(placed.ok);
  assert.equal(placed.order.service, 'express');
  assert.equal(placed.cost, placed.goods + placed.fee + placed.expressFee);
  assert.equal(expressState.cash, cash - placed.cost);
  assert.equal(cancelOrder(expressState, placed.order.id).refund, placed.cost, 'express surcharge is refundable before dispatch');
});

test('ETA and stage timing survive save/load without acceleration or duplication', () => {
  const state = setup({ tutorialComplete: true });
  placeOrder(state, 'balls2', 24);
  const original = state.shop.orders[0];
  const saved = JSON.stringify(state);
  const loaded = JSON.parse(saved);
  const order = loaded.shop.orders[0];
  assert.equal(order.deliveryMin, original.deliveryMin);
  assert.deepEqual(order.timing, original.timing);

  const pausedAt = order.placedMin + 5;
  tickDeliveries(loaded, pausedAt);
  const status = order.status;
  tickDeliveries(loaded, pausedAt);
  assert.equal(order.status, status, 'repeating the paused clock changes nothing');
  assert.equal(boxesOf(loaded).filter((b) => b.orderId === order.id).length, 0);

  tickDeliveries(loaded, order.deliveryMin + 1);
  const landed = boxesOf(loaded).filter((b) => b.orderId === order.id).length;
  tickDeliveries(loaded, order.deliveryMin + 2);
  assert.ok(landed > 0);
  assert.equal(boxesOf(loaded).filter((b) => b.orderId === order.id).length, landed, 'repeated ticks cannot duplicate cartons');
});

test('processing, dispatch, transit and player-facing ETA all update from one clock', () => {
  const state = setup({ tutorialComplete: true });
  placeOrder(state, 'polo1', 8);
  const o = state.shop.orders[0];
  assert.equal(o.timing.processingMinutes + o.timing.transitMinutes, o.deliveryMin - o.placedMin);
  assert.equal(orderStatusAt(o, o.placedMin), 'received');
  assert.equal(orderStatusAt(o, o.timing.dispatchMin), 'shipped');
  assert.match(deliveryEtaText(o, o.placedMin), /approximately|Expected/);
  o.status = 'arriving';
  assert.equal(deliveryEtaText(o, o.deliveryMin - 10), 'Arriving soon');
  o.status = 'received';
  o.blocked = true;
  assert.equal(deliveryEtaText(o, o.deliveryMin + 1), 'Delayed — receiving area blocked');
});

test('multiple orders queue at the receiving pad and blocked ETA explains the action', () => {
  const state = setup({ tutorialComplete: true });
  for (let i = 0; i < PAD_CAPACITY; i++) {
    boxesOf(state).push({ id: 700 + i, skuId: 'tees1', qty: 1, cap: 1, orderId: 0, loc: 'pad', box: 'carton' });
  }
  for (let i = 0; i < FALLBACK_CAPACITY; i++) {
    boxesOf(state).push({ id: 800 + i, skuId: 'tees1', qty: 1, cap: 1, orderId: 0, loc: 'receiving-fallback', box: 'carton' });
  }
  placeOrder(state, 'balls1', 12);
  placeOrder(state, 'polo1', 8);
  const due = Math.max(...state.shop.orders.map((o) => o.deliveryMin)) + 1;
  tickDeliveries(state, due);
  assert.equal(state.shop.orders.length, 2);
  assert.ok(state.shop.orders.every((o) => o.blocked));
  assert.ok(state.shop.orders.every((o) => deliveryEtaText(o, due) === 'Delayed — receiving area blocked'));
});
