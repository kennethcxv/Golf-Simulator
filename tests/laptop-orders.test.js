// CANCELLING AN ORDER MUST NOT INVENT MONEY.
//
// The Orders application has to be able to cancel — a management screen that can watch an order
// and not stop it is a readout, not an application. But an order was PAID FOR when it was placed
// (addExpense 'shopOrders'), so cancelling has to give that money back, and giving money back is
// where refunds go wrong.
//
// The rule: cancelling reverses the original booking. Cash returns to exactly what it was, the
// expense line returns to exactly what it was, and a cancelled order leaves NO trace in the day's
// books — because it never happened. And it can only happen once.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { placeOrder, cancelOrder } from '../src/sim/shop.js';

const setup = () => {
  const s = newGame(1);
  s.cash = 50000;
  s.shop.unlockedTier = 3;
  s.shop.progression.tier = 'luxury';
  return s;
};

test('cancelling an order puts the money back exactly', () => {
  const s = setup();
  const cash0 = s.cash;
  const spent0 = s.ledger.today.expense.shopOrders || 0;

  const p = placeOrder(s, 'balls1', 4);
  assert.ok(p.ok, 'order placed');
  assert.equal(s.cash, cash0 - p.cost, 'it was paid for up front');

  const id = s.shop.orders[0].id;
  const c = cancelOrder(s, id);
  assert.ok(c.ok, 'cancelled');
  assert.equal(c.refund, p.cost, 'refunded what was actually paid');
  assert.equal(s.cash, cash0, 'cash is exactly back where it started');
  assert.equal(s.ledger.today.expense.shopOrders || 0, spent0, 'and the books show no trace of it');
  assert.equal(s.shop.orders.length, 0, 'the order is gone');
});

test('an order cannot be cancelled twice - that is how you print money', () => {
  const s = setup();
  placeOrder(s, 'balls1', 4);
  const id = s.shop.orders[0].id;
  const cashAfterPlacing = s.cash;

  const first = cancelOrder(s, id);
  assert.ok(first.ok);
  const cashAfterRefund = s.cash;

  const second = cancelOrder(s, id);
  assert.equal(second.ok, false, 'the second cancel refuses');
  assert.equal(s.cash, cashAfterRefund, 'and not a penny moves');
  assert.ok(cashAfterRefund > cashAfterPlacing, '(the first one really did refund)');
});

test('the van at the door cannot be turned away', () => {
  const s = setup();
  placeOrder(s, 'balls1', 2);
  const o = s.shop.orders[0];
  o.status = 'arriving'; // it is in its delivery window; the goods hit the pad any minute
  const cash = s.cash;
  const res = cancelOrder(s, o.id);
  assert.equal(res.ok, false, 'refused');
  assert.match(res.reason, /too late|door/i);
  assert.equal(s.cash, cash, 'no refund');
  assert.equal(s.shop.orders.length, 1, 'and the order is still coming');
});

test('a blocked van can be turned away so paid stock cannot become a permanent soft-lock', () => {
  const s = setup();
  const cash0 = s.cash;
  const p = placeOrder(s, 'bag1', 9);
  assert.ok(p.ok, 'largest valid single manifest was paid for');
  const o = s.shop.orders[0];
  o.status = 'arriving';
  o.blocked = true; // the driver explicitly unloaded nothing

  const res = cancelOrder(s, o.id);

  assert.equal(res.ok, true);
  assert.equal(res.refund, p.cost);
  assert.equal(s.cash, cash0, 'the exact paid amount was restored');
  assert.equal(s.shop.orders.length, 0);
});

test('cancelling an order that never existed refuses quietly', () => {
  const s = setup();
  const cash = s.cash;
  const res = cancelOrder(s, 9999);
  assert.equal(res.ok, false);
  assert.equal(s.cash, cash);
});

test('an order still in processing can be stopped', () => {
  const s = setup();
  placeOrder(s, 'polo1', 3);
  const o = s.shop.orders[0];
  o.status = 'processing';
  assert.ok(cancelOrder(s, o.id).ok, 'processing is still cancellable');
});
