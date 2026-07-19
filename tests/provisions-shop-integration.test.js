import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SHOP_CATALOG, LEAD_DAYS, SHELF_CAP, RETAIL_CATS, skuById,
} from '../src/data/shopItems.js';
import { SUPPLIERS, supplierFor } from '../src/data/suppliers.js';
import { FIXTURES, FIXTURE_HALF } from '../src/data/shopLayout.js';
import {
  SNACKRACK_AUTHORED_SLOTS, slotsFor, capacityOf, homeFixture,
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
    assert.deepEqual(packaging.allowedStocking.fixtureIds, ['snackrack']);
  }
});

test('provisions explicitly ship from Fairway Supply', () => {
  assert.equal(SUPPLIERS.fairway.cats.includes('provisions'), true);
  for (const id of PROVISION_IDS) assert.strictEqual(supplierFor(skuById(id)), SUPPLIERS.fairway);
});

test('one movable logical snack rack owns both SKUs and every retail line has exactly one fixture', () => {
  const racks = FIXTURES.filter((fixture) => fixture.id === 'snackrack');
  assert.equal(racks.length, 1);
  assert.deepEqual(racks[0], {
    id: 'snackrack', kind: 'snackrack', x: -6.6, z: 6.02, ry: Math.PI,
    skus: PROVISION_IDS, title: 'Grab & Go', zone: 'provisions',
  });
  assert.deepEqual(FIXTURE_HALF.snackrack, [0.53, 0.25]);

  const fixtureCount = new Map();
  for (const fixture of FIXTURES) {
    for (const id of fixture.skus) fixtureCount.set(id, (fixtureCount.get(id) || 0) + 1);
  }
  for (const sku of SHOP_CATALOG.filter((entry) => RETAIL_CATS.has(entry.cat))) {
    assert.equal(fixtureCount.get(sku.id), 1, `${sku.id} maps to exactly one logical fixture`);
  }
});

function expectedSockets(prefix, xs, ys, z) {
  return ys.flatMap((y, row) => xs.map((x, col) => ({
    socket: `${prefix}_${String(row * xs.length + col + 1).padStart(2, '0')}`,
    socketName: `${prefix}_${String(row * xs.length + col + 1).padStart(2, '0')}`,
    x, y, z, ry: 0,
  })));
}

test('provisions capacity is the exact authored DRINK_SLOT and SNACK_SLOT mapping', () => {
  const water = expectedSockets(
    'DRINK_SLOT', [-0.39, -0.26, -0.13, 0, 0.13, 0.26, 0.39], [0.174, 0.574], 0.055,
  );
  const snack = expectedSockets(
    'SNACK_SLOT', [-0.35, -0.175, 0, 0.175, 0.35], [0.954, 1.284], 0.03,
  );

  assert.deepEqual(slotsFor('water1'), water);
  assert.deepEqual(slotsFor('snack1'), snack);
  assert.strictEqual(slotsFor('water1'), SNACKRACK_AUTHORED_SLOTS.water1);
  assert.strictEqual(slotsFor('snack1'), SNACKRACK_AUTHORED_SLOTS.snack1);
  assert.equal(Object.isFrozen(SNACKRACK_AUTHORED_SLOTS.water1), true);
  assert.equal(Object.isFrozen(SNACKRACK_AUTHORED_SLOTS.snack1), true);
  assert.equal(capacityOf('water1'), 14);
  assert.equal(capacityOf('snack1'), 10);
  assert.equal(shelfCapacity(skuById('water1')), 14);
  assert.equal(shelfCapacity(skuById('snack1')), 10);
  for (const id of PROVISION_IDS) assert.equal(homeFixture(id).id, 'snackrack');
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

test('provisions armfuls stock only the snack rack, respect capacity, and retain leftovers', () => {
  const state = newGame('relaxed', 1802);
  assert.equal(armfulOf(skuById('water1')), 6);
  assert.equal(armfulOf(skuById('snack1')), 12);

  state.shop.inventory.water1.back = 20;
  assert.equal(takeFromBack(state, 'water1').taken, 6);
  const wrong = stockFixture(state, 'shelf_balls', 99);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.invalid, true);
  assert.deepEqual(carriedGoods(state), { skuId: 'water1', qty: 6 });
  assert.equal(stockFixture(state, 'snackrack', 99).moved, 6);

  assert.equal(takeFromBack(state, 'water1').taken, 6);
  assert.equal(stockFixture(state, 'snackrack', 99).moved, 6);
  assert.equal(takeFromBack(state, 'water1').taken, 6);
  const waterFull = stockFixture(state, 'snackrack', 99);
  assert.deepEqual(
    { moved: waterFull.moved, onShelf: waterFull.onShelf, capacity: waterFull.capacity, left: waterFull.left },
    { moved: 2, onShelf: 14, capacity: 14, left: 4 },
  );
  assert.equal(state.shop.inventory.water1.shelf + state.shop.inventory.water1.back + carriedGoods(state).qty, 20);

  state.shop.carry = null;
  state.shop.inventory.snack1.back = 12;
  assert.equal(takeFromBack(state, 'snack1').taken, 12);
  const snackFull = stockFixture(state, 'snackrack', 99);
  assert.deepEqual(
    { moved: snackFull.moved, onShelf: snackFull.onShelf, capacity: snackFull.capacity, left: snackFull.left },
    { moved: 10, onShelf: 10, capacity: 10, left: 2 },
  );
});

test('provisions orders use one-day Fairway delivery and exact twelve-unit carton layouts', () => {
  const state = newGame('relaxed', 1803);
  const day = calendarOf(state.clock.minutes).dayAbs;
  const expectations = { water1: 'DRINK12', snack1: 'SNACK12' };

  for (const [id, layoutId] of Object.entries(expectations)) {
    const before = { ...state.shop.inventory[id] };
    const result = placeOrder(state, id, 12);
    assert.equal(result.ok, true);
    assert.equal(result.supplier, 'Fairway Supply Co.');
    assert.equal(result.order.arrivesDay, day + 1);
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
