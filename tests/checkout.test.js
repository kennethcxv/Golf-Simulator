// PLAYER-OPERATED CHECKOUT — live customers pick REAL items off REAL shelves
// (the count drops the moment it leaves the display), queue at the register,
// and the PLAYER scans them through. Additive on top of the statistical daily
// accrual, same precedent as tee-time reservations (documented in DEV_LOG).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { pickFromShelf, returnToShelf, checkoutSale, liveSales } from '../src/sim/checkout.js';
import { priceFor } from '../src/sim/shop.js';
import { skuById } from '../src/data/shopItems.js';

test('a live pick physically leaves the shelf; an empty shelf refuses the pick', () => {
  const st = newGame('relaxed', 42);
  st.shop.inventory.balls2.shelf = 2;
  assert.ok(pickFromShelf(st, 'balls2').ok, 'first pick works');
  assert.equal(st.shop.inventory.balls2.shelf, 1, 'the display lost the unit at pick time');
  pickFromShelf(st, 'balls2');
  assert.equal(pickFromShelf(st, 'balls2').ok, false, 'nothing left to pick');
  assert.equal(st.shop.inventory.balls2.shelf, 0, 'never goes negative');
});

test('an abandoned pick goes back on the display', () => {
  const st = newGame('relaxed', 42);
  st.shop.inventory.glove1.shelf = 3;
  pickFromShelf(st, 'glove1');
  returnToShelf(st, 'glove1');
  assert.equal(st.shop.inventory.glove1.shelf, 3, 'the glove is back on the shelf');
});

test('ringing a sale pays real revenue into the books and logs it', () => {
  const st = newGame('relaxed', 42);
  st.shop.inventory.balls2.shelf = 4;
  st.shop.inventory.cap1.shelf = 4;
  pickFromShelf(st, 'balls2');
  pickFromShelf(st, 'cap1');
  const cashBefore = st.cash;
  const items = [
    { skuId: 'balls2', price: priceFor(skuById('balls2'), 1, null) },
    { skuId: 'cap1', price: priceFor(skuById('cap1'), 1, null) },
  ];
  const res = checkoutSale(st, items, 'Walk-in');
  assert.ok(res.ok);
  const total = items.reduce((a, i) => a + i.price, 0);
  assert.ok(Math.abs(res.total - total) < 0.01, 'the register total is the sum of the basket');
  assert.ok(Math.abs(st.cash - cashBefore - total) < 0.01, 'cash landed');
  assert.ok((st.ledger.today.revenue.shopSales || 0) >= total - 0.01, 'booked under shopSales');
  const live = liveSales(st);
  assert.equal(live.units, 2, 'live counter tracks the units');
  assert.ok(st.shop.log.length > 0, 'notable-sales log heard about it');
});

test('an empty basket cannot be rung up', () => {
  const st = newGame('relaxed', 42);
  assert.equal(checkoutSale(st, [], 'Nobody').ok, false);
});
