import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SHOP_CATALOG, LEAD_DAYS, SHELF_CAP, RETAIL_CATS, skuById,
} from '../src/data/shopItems.js';
import { SUPPLIERS, supplierFor } from '../src/data/suppliers.js';
import { FIXTURES, FIXTURE_HALF } from '../src/data/shopLayout.js';
import {
  slotsFor, capacityOf, homeFixture,
} from '../src/data/fixtureSlots.js';
import { productPackagingFor } from '../src/data/productPackaging.js';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import { demandWeight, placeOrder, shelfCapacity } from '../src/sim/shop.js';
import {
  armfulOf, carriedGoods, stockFixture, takeFromBack,
} from '../src/sim/stocking.js';

const PROVISION_IDS = ['water1', 'snack1'];

test('Fairway Spring and Bunker Bites are coherent tier-one retail provisions', () => {
  const water = skuById('water1');
  const snack = skuById('snack1');

  assert.deepEqual(water, {
    id: 'water1', cat: 'provisions', tier: 1, brand: 'FAIRWAY SPRING',
    name: 'Fairway Spring Water', cost: 0.85, msrp: 2.50, lb: 1.1,
  });
  assert.deepEqual(snack, {
    id: 'snack1', cat: 'provisions', tier: 1, brand: 'BUNKER BITES',
    name: 'Bunker Bites Potato Chips', cost: 0.90, msrp: 2.75, lb: 0.12,
  });
  assert.equal(RETAIL_CATS.has('provisions'), true);
  assert.equal(LEAD_DAYS.provisions, 1);
  assert.equal(SHELF_CAP.provisions, 14);

  for (const sku of [water, snack]) {
    assert.ok(sku.cost < sku.msrp, `${sku.id} has a viable retail margin`);
    const packaging = productPackagingFor(sku.id);
    assert.equal(packaging.catalogCategory, sku.cat);
    assert.equal(packaging.unitWeightLb, sku.lb);
    assert.equal(packaging.retail, true);
    assert.deepEqual(
      packaging.allowedStocking.fixtureIds,
      [sku.id === 'water1' ? 'cold_drinks' : 'snack_rack'],
    );
  }
});

test('provisions explicitly ship from Fairway Supply', () => {
  assert.equal(SUPPLIERS.fairway.cats.includes('provisions'), true);
  for (const id of PROVISION_IDS) assert.strictEqual(supplierFor(skuById(id)), SUPPLIERS.fairway);
});

test('production drinks and snacks have separate movable homes and every retail line has one fixture', () => {
  const drinks = FIXTURES.find((fixture) => fixture.id === 'cold_drinks');
  const snacks = FIXTURES.find((fixture) => fixture.id === 'snack_rack');
  assert.ok(drinks.skus.includes('water1'));
  assert.ok(snacks.skus.includes('snack1'));
  assert.deepEqual(FIXTURE_HALF.fridge, [0.48, 0.48]);
  assert.deepEqual(FIXTURE_HALF.snackrack, [0.75, 0.38]);

  const fixtureCount = new Map();
  for (const fixture of FIXTURES) {
    for (const id of fixture.skus) fixtureCount.set(id, (fixtureCount.get(id) || 0) + 1);
  }
  for (const sku of SHOP_CATALOG.filter((entry) => RETAIL_CATS.has(entry.cat))) {
    assert.equal(fixtureCount.get(sku.id), 1, `${sku.id} maps to exactly one logical fixture`);
  }
});

test('provisions capacity is the exact production facing mapping', () => {
  const water = slotsFor('water1');
  const snack = slotsFor('snack1');
  assert.equal(water.length, 8);
  assert.equal(snack.length, 8);
  assert.deepEqual([...new Set(water.map((slot) => slot.y))], [0.35, 0.7, 1.05, 1.4]);
  assert.deepEqual([...new Set(snack.map((slot) => slot.y))], [0.28, 0.55, 0.82, 1.09]);
  assert.equal(capacityOf('water1'), 8);
  assert.equal(capacityOf('snack1'), 8);
  assert.equal(shelfCapacity(skuById('water1')), 8);
  assert.equal(shelfCapacity(skuById('snack1')), 8);
  assert.equal(homeFixture('water1').id, 'cold_drinks');
  assert.equal(homeFixture('snack1').id, 'snack_rack');
});

test('fresh games and old saves gain provisions without disturbing existing shop values', () => {
  const fresh = newGame('relaxed', 1801);
  assert.deepEqual(fresh.shop.inventory.water1, { shelf: 0, back: 0 });
  assert.deepEqual(fresh.shop.inventory.snack1, { shelf: 0, back: 0 });
  assert.equal(fresh.shop.markup.provisions, 1.0);

  const old = JSON.parse(serialize(fresh));
  old.shop.inventory.balls1 = { shelf: 7, back: 3 };
  old.shop.markup.balls = 1.23;
  delete old.shop.inventory.water1;
  delete old.shop.inventory.snack1;
  delete old.shop.markup.provisions;

  const migrated = deserialize(JSON.stringify(old));
  assert.deepEqual(migrated.shop.inventory.water1, { shelf: 0, back: 0 });
  assert.deepEqual(migrated.shop.inventory.snack1, { shelf: 0, back: 0 });
  assert.deepEqual(migrated.shop.inventory.balls1, { shelf: 7, back: 3 });
  assert.equal(migrated.shop.markup.balls, 1.23);
  assert.equal(migrated.shop.markup.provisions, 1.0);

  const twice = deserialize(serialize(migrated));
  assert.deepEqual(twice.shop.inventory.water1, migrated.shop.inventory.water1);
  assert.deepEqual(twice.shop.inventory.snack1, migrated.shop.inventory.snack1);
  assert.deepEqual(twice.shop.markup, migrated.shop.markup);
});

test('provisions armfuls stock only their refreshment fixtures, respect capacity, and retain leftovers', () => {
  const state = newGame('relaxed', 1802);
  state.shop.progression.tier = 'standard';
  assert.equal(armfulOf(skuById('water1')), 6);
  assert.equal(armfulOf(skuById('snack1')), 12);

  state.shop.inventory.water1.back = 20;
  assert.equal(takeFromBack(state, 'water1').taken, 6);
  const wrong = stockFixture(state, 'shelf_balls', 99);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.invalid, true);
  assert.deepEqual(
    { skuId: carriedGoods(state).skuId, qty: carriedGoods(state).qty },
    { skuId: 'water1', qty: 6 },
  );
  assert.equal(stockFixture(state, 'cold_drinks', 99).moved, 6);

  assert.equal(takeFromBack(state, 'water1').taken, 6);
  const waterFull = stockFixture(state, 'cold_drinks', 99);
  assert.deepEqual(
    { moved: waterFull.moved, onShelf: waterFull.onShelf, capacity: waterFull.capacity, left: waterFull.left },
    { moved: 2, onShelf: 8, capacity: 8, left: 4 },
  );
  assert.equal(state.shop.inventory.water1.shelf + state.shop.inventory.water1.back + carriedGoods(state).qty, 20);

  state.shop.carry = null;
  state.shop.inventory.snack1.back = 12;
  assert.equal(takeFromBack(state, 'snack1').taken, 12);
  const snackFull = stockFixture(state, 'snack_rack', 99);
  assert.deepEqual(
    { moved: snackFull.moved, onShelf: snackFull.onShelf, capacity: snackFull.capacity, left: snackFull.left },
    { moved: 8, onShelf: 8, capacity: 8, left: 4 },
  );
});

test('provisions orders use the live Fairway ETA and exact twelve-unit carton layouts', () => {
  const state = newGame('relaxed', 1803);
  state.shop.progression.tier = 'standard';
  state.shop.unlockedTier = 2;
  const day = calendarOf(state.clock.minutes).dayAbs;
  const expectations = { water1: 'DRINK12', snack1: 'SNACK12' };

  for (const [id, layoutId] of Object.entries(expectations)) {
    const before = { ...state.shop.inventory[id] };
    const result = placeOrder(state, id, 12);
    assert.equal(result.ok, true);
    assert.equal(result.supplier, 'Fairway Supply Co.');
    assert.equal(result.order.arrivesDay, calendarOf(result.order.deliveryMin).dayAbs);
    assert.ok(result.order.arrivesDay >= day);
    assert.equal(result.order.pace, 'starter');
    assert.equal(result.order.manifest.supplierId, 'fairway');
    assert.equal(result.order.manifest.boxCount, 1);
    assert.deepEqual(result.order.manifest.boxes.map((box) => ({
      qty: box.qty, layoutId: box.layoutId, shellId: box.shellId, modelId: box.modelId,
    })), [{
      qty: 12, layoutId, shellId: 'BULK_PROVISIONS', modelId: 'delivery_bulk_provisions_carton',
    }]);
    assert.deepEqual(state.shop.inventory[id], before, 'ordering does not materialize stock before delivery');
  }
});

test('provisions demand peaks in summer and laptop order/pricing controls present the category', () => {
  assert.ok(demandWeight('provisions', 1) > demandWeight('provisions', 3) * 2);

  const source = readFileSync(new URL('../src/ui/laptop.js', import.meta.url), 'utf8');
  assert.match(source, /provisions: 'Drinks & snacks'/);
  assert.match(source, /provisions: '🥤'/u);
  assert.match(source, /const cats = \[[^\n]+provisions[^\n]+\]/);
  assert.match(source, /const markups = \[[^\n]+provisions[^\n]+\]\.map/);
});
