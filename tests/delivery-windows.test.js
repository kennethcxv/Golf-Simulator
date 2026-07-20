// Orders ship with a deterministic, pace-sized delivery window and the truck
// lands at its promised minute. Statuses progress
// (received → processing → out for delivery → arriving), notifications fire
// exactly once, and the parked-property reconcile still force-delivers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { placeOrder, deliverOrdersDue, tickDeliveries } from '../src/sim/shop.js';
import { calendarOf } from '../src/sim/time.js';

function orderUp(state) {
  const res = placeOrder(state, 'balls1', 12);
  assert.ok(res.ok, 'order placed');
  return state.shop.orders[state.shop.orders.length - 1];
}

test('a placed order carries a useful window around its promised arrival', () => {
  const state = newGame('relaxed', 7);
  const o = orderUp(state);
  assert.ok(o.window, 'window exists');
  assert.ok(o.window.close - o.window.open >= 30, 'wide enough to be an honest window');
  assert.ok(o.window.close - o.window.open <= 90, 'not so wide that it is useless');
  const day = Math.floor(o.window.open / 1440);
  assert.equal(day, o.arrivesDay, 'window sits on the arrival day');
  assert.ok(o.deliveryMin >= o.window.open && o.deliveryMin < o.window.close, 'truck minute inside the window');
  assert.equal(o.status, 'received');
});

test('the truck lands at its minute — not before, exactly once', () => {
  const state = newGame('relaxed', 7);
  const o = orderUp(state);
  const before = state.shop.deliveries.boxes.length;
  tickDeliveries(state, o.deliveryMin - 30);
  assert.equal(state.shop.deliveries.boxes.length, before, 'nothing early');
  assert.ok(state.shop.orders.includes(o), 'still pending');
  const events = tickDeliveries(state, o.deliveryMin + 1);
  assert.ok(events.some((e) => e.kind === 'arrived' && e.order.id === o.id), 'arrival event');
  assert.ok(state.shop.deliveries.boxes.length > before, 'boxes on the pad');
  assert.ok(!state.shop.orders.includes(o), 'order fulfilled');
  const again = tickDeliveries(state, o.deliveryMin + 2);
  assert.ok(!again.some((e) => e.kind === 'arrived'), 'no double arrival');
});

test('dispatch and arriving-soon updates fire exactly once, statuses progress', () => {
  const state = newGame('relaxed', 7);
  const o = orderUp(state);
  const dispatched = o.timing.dispatchMin;
  const e1 = tickDeliveries(state, dispatched);
  assert.ok(e1.some((e) => e.kind === 'dispatched' && e.order.id === o.id), 'dispatch update');
  assert.ok(!tickDeliveries(state, dispatched + 10).some((e) => e.kind === 'dispatched'), 'dispatch fires once');

  // "Arriving soon" still means the final half hour, not the whole estimate.
  tickDeliveries(state, o.deliveryMin - 40);
  assert.equal(o.status, 'out', 'forty minutes out: still on the van');
  const soonAt = o.deliveryMin - 25;
  const e2 = tickDeliveries(state, soonAt);
  assert.ok(e2.some((e) => e.kind === 'soon' && e.order.id === o.id), 'arriving-soon update');
  assert.equal(o.status, 'arriving', 'inside half an hour: arriving soon');
  tickDeliveries(state, o.deliveryMin - 10);
  assert.equal(o.status, 'arriving', 'ten minutes out: now it is arriving');
  tickDeliveries(state, o.deliveryMin + 1);
  assert.ok(!state.shop.orders.includes(o), 'and then it is here');
});

test('parked-property reconcile still force-delivers everything due', () => {
  const state = newGame('relaxed', 7);
  const o = orderUp(state);
  deliverOrdersDue(state, o.arrivesDay + 2);
  assert.ok(!state.shop.orders.includes(o), 'delivered on reconcile');
  assert.ok(state.shop.deliveries.boxes.some((b) => b.orderId === o.id), 'boxes exist');
});
