// Orders ship with a real delivery window — a two-hour span on the arrival
// day — and the truck lands at a specific minute inside it. Statuses progress
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

test('a placed order carries a two-hour window on its arrival day', () => {
  const state = newGame('relaxed', 7);
  const o = orderUp(state);
  assert.ok(o.window, 'window exists');
  assert.equal(o.window.close - o.window.open, 120, 'two hours wide');
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

test('morning and one-hour heads-up fire exactly once, statuses progress', () => {
  const state = newGame('relaxed', 7);
  const o = orderUp(state);
  const morning = o.arrivesDay * 1440 + 6 * 60 + 5;
  const e1 = tickDeliveries(state, morning);
  assert.ok(e1.some((e) => e.kind === 'morning' && e.order.id === o.id), 'morning heads-up');
  assert.ok(!tickDeliveries(state, morning + 10).some((e) => e.kind === 'morning'), 'morning fires once');
  const soonAt = o.window.open - 45;
  const e2 = tickDeliveries(state, soonAt);
  assert.ok(e2.some((e) => e.kind === 'soon' && e.order.id === o.id), 'one-hour warning');
  assert.ok(['out', 'arriving'].includes(o.status), 'truck is out');

  // "Arriving soon" now means SOON — the last half hour — not "somewhere in the next two hours".
  // The window opens at 8 and the van lands at 8:37; the old rule flipped the order to "Arriving
  // now" at 8:00 and then left it saying that for thirty-seven minutes, which is a status telling
  // you to go and stand at a pad where nothing is happening.
  tickDeliveries(state, o.window.open + 1);
  assert.equal(o.status, 'out', 'inside the window but half an hour out: still on the van');
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
