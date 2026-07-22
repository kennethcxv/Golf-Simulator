import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOP_CATALOG } from '../src/data/shopItems.js';
import {
  CARRY, carryCategory, basketCompatible, selectedUnit,
  stageUnit, abandonUnit, sellUnit, visibleBasketSlots,
} from '../src/sim/customerBasket.js';

const sku = (id) => SHOP_CATALOG.find((item) => item.id === id);

test('small shop goods fit baskets while clubs and large bags do not', () => {
  assert.equal(carryCategory(sku('balls2')), CARRY.BASKET);
  assert.equal(carryCategory(sku('cap1')), CARRY.BASKET);
  assert.equal(carryCategory(sku('driver1')), CARRY.TWO_HAND);
  assert.equal(carryCategory(sku('bag1')), CARRY.SPECIAL);
  assert.equal(carryCategory(sku('jacket2')), CARRY.HANGER);
  assert.equal(basketCompatible(sku('shoe1')), true);
});

test('a selected SKU stays reserved through basket and counter, then becomes sold', () => {
  const unit = selectedUnit({ uid: 'unit-7', skuId: 'balls2', price: 28, container: 'basket' });
  assert.deepEqual(visibleBasketSlots([unit]), [unit]);
  assert.equal(stageUnit(unit), true);
  assert.equal(unit.reserved, true, 'staging cannot consume stock');
  assert.equal(unit.checkoutState, 'staged');
  assert.equal(sellUnit(unit), true);
  assert.equal(unit.reserved, false);
  assert.equal(unit.container, 'purchase-bag');
  assert.equal(unit.sold, true);
});

test('abandonment returns presentation state to the shelf and cannot later sell', () => {
  const unit = selectedUnit({ uid: 'unit-8', skuId: 'glove1', price: 19, container: 'basket' });
  assert.equal(abandonUnit(unit), true);
  assert.equal(unit.checkoutState, 'abandoned');
  assert.equal(unit.container, 'shelf');
  assert.equal(unit.reserved, false);
  assert.equal(sellUnit(unit), false);
});

test('basket visuals are limited sockets, never a free-physics inventory', () => {
  const units = [0, 1, 2, 3].map((i) => selectedUnit({ uid: `u${i}`, skuId: 'tees1', price: 6, container: 'basket' }));
  assert.deepEqual(visibleBasketSlots(units).map((item) => item.uid), ['u0', 'u1', 'u2']);
});

