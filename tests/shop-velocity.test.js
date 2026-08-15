// WHAT ACTUALLY SOLD, LINE BY LINE.
//
// The Inventory application wants sales velocity and days of supply; Analytics wants best
// sellers and sellouts. The shop only ever recorded an AGGREGATE — `salesYesterday: {units,
// revenue}` — so every one of those numbers would have had to be invented. A management screen
// that invents its numbers is worse than one that admits it does not know: you make decisions on
// it.
//
// So the shop now keeps a per-SKU tally, rolled into a seven-day window at each day's close.
// Both selling paths feed it — the offline day simulation AND the physical register — because a
// velocity that only counts half the sales is a velocity that lies.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { recordSale, rollSalesWindow, velocity, daysOfSupply } from '../src/sim/shop.js';

test('velocity averages over the days we actually have, not a hardcoded week', () => {
  const s = newGame(1);
  // two days: 6 dozen, then 2 dozen
  recordSale(s, 'balls1', 6);
  rollSalesWindow(s);
  recordSale(s, 'balls1', 2);
  rollSalesWindow(s);
  assert.equal(velocity(s, 'balls1'), 4, '(6 + 2) / 2 days');
  // a third, quiet day drags it down — it does not divide by a phantom seven
  rollSalesWindow(s);
  assert.equal(velocity(s, 'balls1'), 8 / 3);
});

test('the window is seven days long and the eighth falls off the back', () => {
  const s = newGame(1);
  for (let d = 0; d < 9; d++) {
    recordSale(s, 'balls1', d === 0 ? 100 : 1); // a huge first day, long ago
    rollSalesWindow(s);
  }
  assert.equal(s.shop.salesWindow.length, 7, 'seven days kept');
  assert.equal(velocity(s, 'balls1'), 1, 'and the ancient spike no longer counts');
});

test('days of supply is what is on hand divided by what goes out', () => {
  const s = newGame(1);
  s.shop.inventory.balls1.shelf = 8;
  s.shop.inventory.balls1.back = 4;
  recordSale(s, 'balls1', 3);
  rollSalesWindow(s);
  assert.equal(velocity(s, 'balls1'), 3);
  assert.equal(daysOfSupply(s, 'balls1'), 4, '12 on hand at 3 a day');
});

test('a line that never sells has infinite supply, not a divide-by-zero', () => {
  const s = newGame(1);
  s.shop.inventory.balls1.shelf = 5;
  s.shop.inventory.balls1.back = 0;
  rollSalesWindow(s);
  assert.equal(velocity(s, 'balls1'), 0);
  assert.equal(daysOfSupply(s, 'balls1'), Infinity, 'dead stock lasts forever - that IS the finding');
});

test('and a line with nothing on hand and nothing moving is simply out', () => {
  const s = newGame(1);
  s.shop.inventory.balls1.shelf = 0;
  s.shop.inventory.balls1.back = 0;
  rollSalesWindow(s);
  assert.equal(daysOfSupply(s, 'balls1'), 0);
});

test('today is not yet in the window - it is still today', () => {
  const s = newGame(1);
  recordSale(s, 'balls1', 5);
  assert.equal(velocity(s, 'balls1'), 0, 'no closed days yet');
  assert.equal(s.shop.salesToday.balls1, 5, 'but today is being counted');
  rollSalesWindow(s);
  assert.equal(velocity(s, 'balls1'), 5, 'and it lands when the day closes');
  assert.deepEqual(s.shop.salesToday, {}, 'today starts empty again');
});

test('a fresh shop reports zeroes rather than exploding', () => {
  const s = newGame(1);
  assert.equal(velocity(s, 'balls1'), 0);
  assert.equal(velocity(s, 'nonesuch'), 0);
  assert.equal(daysOfSupply(s, 'nonesuch'), 0);
});
