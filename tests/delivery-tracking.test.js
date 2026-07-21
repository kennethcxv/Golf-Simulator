import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import {
  cancelOrder,
  deliveryTracking,
  expediteOrder,
  placeOrder,
  priorityDeliveryQuote,
  tickDeliveries,
} from '../src/sim/shop.js';

function setup() {
  const state = newGame('relaxed', 71287);
  state.cash = 50000;
  state.shop.unlockedTier = 3;
  state.shop.progression.tier = 'luxury';
  return state;
}

function placeTrackedOrder(state) {
  const placed = placeOrder(state, 'balls1', 12);
  assert.ok(placed.ok, 'tracked order placed');
  return placed;
}

test('delivery tracking derives monotonic ETA, progress, and milestone state from the clock', () => {
  const state = setup();
  const { order } = placeTrackedOrder(state);
  const samples = [
    order.placedMin,
    order.placedMin + (order.deliveryMin - order.placedMin) * 0.35,
    order.deliveryMin - 90,
    order.deliveryMin - 15,
  ].map((minute) => deliveryTracking(order, minute));

  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].etaMinutes <= samples[i - 1].etaMinutes, 'ETA never increases');
    assert.ok(samples[i].progress >= samples[i - 1].progress, 'progress never reverses');
    const previousDone = samples[i - 1].milestones.filter((m) => m.state === 'done').length;
    const currentDone = samples[i].milestones.filter((m) => m.state === 'done').length;
    assert.ok(currentDone >= previousDone, 'completed milestones never reopen');
  }
  assert.deepEqual(samples[0].milestones.map((m) => m.label), ['Ordered', 'Packed', 'On road', 'Arriving']);
  assert.equal(samples.at(-1).status, 'arriving');
});

test('priority dispatch bills once, persists its earlier appointment, and arrives exactly once', () => {
  const state = setup();
  const { order } = placeTrackedOrder(state);
  const originalDeliveryMin = order.deliveryMin;
  const cashBeforePriority = state.cash;
  const quote = priorityDeliveryQuote(state, order.id);
  assert.ok(quote.ok, quote.reason);
  assert.ok(quote.minutesSaved > 0, 'quote saves real time');

  const result = expediteOrder(state, order.id);
  assert.ok(result.ok, result.reason);
  assert.equal(state.cash, Math.round((cashBeforePriority - result.fee) * 100) / 100, 'priority fee billed once');
  assert.ok(result.order.deliveryMin < originalDeliveryMin, 'actual appointment moved earlier');
  assert.equal(expediteOrder(state, order.id).ok, false, 'cannot bill the same order twice');

  const saved = JSON.parse(JSON.stringify(state));
  const savedOrder = saved.shop.orders.find((o) => o.id === order.id);
  assert.equal(savedOrder.priority, true);
  assert.equal(savedOrder.deliveryMin, result.order.deliveryMin, 'new appointment survives save/load');
  const first = tickDeliveries(saved, savedOrder.deliveryMin);
  assert.equal(first.filter((e) => e.kind === 'arrived').length, 1, 'one arrival at the priority minute');
  assert.equal(tickDeliveries(saved, savedOrder.deliveryMin + 1).filter((e) => e.kind === 'arrived').length, 0, 'no duplicate arrival');
});

test('cancelling a priority order reverses goods, freight, and priority fee exactly', () => {
  const state = setup();
  const startingCash = state.cash;
  const startingExpense = state.ledger.today.expense.shopOrders || 0;
  const { order } = placeTrackedOrder(state);
  const priority = expediteOrder(state, order.id);
  assert.ok(priority.ok, priority.reason);

  const cancelled = cancelOrder(state, order.id);
  assert.ok(cancelled.ok, cancelled.reason);
  assert.equal(state.cash, startingCash, 'all supplier spending returned to the penny');
  assert.equal(state.ledger.today.expense.shopOrders || 0, startingExpense, 'ledger has no cancelled-order residue');
  assert.equal(state.shop.orders.length, 0);
});

test('morning and soon milestones create persistent, deduplicated delivery notifications', () => {
  const state = setup();
  const { order } = placeTrackedOrder(state);
  const morning = order.arrivesDay * 1440 + 6 * 60 + 1;
  const soon = order.deliveryMin - 45;

  tickDeliveries(state, morning);
  tickDeliveries(state, morning + 1);
  tickDeliveries(state, soon);
  tickDeliveries(state, soon + 1);

  const relevant = state.notifications.items.filter((item) => item.dedupeKey && item.dedupeKey.includes(`:${order.id}`));
  assert.equal(relevant.filter((item) => item.dedupeKey === `delivery-morning:${order.id}`).length, 1);
  assert.equal(relevant.filter((item) => item.dedupeKey === `delivery-soon:${order.id}`).length, 1);
  const saved = JSON.parse(JSON.stringify(state));
  assert.equal(saved.notifications.items.filter((item) => item.dedupeKey === `delivery-morning:${order.id}`).length, 1);
  assert.equal(saved.notifications.items.filter((item) => item.dedupeKey === `delivery-soon:${order.id}`).length, 1);
});
