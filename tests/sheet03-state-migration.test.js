import test from 'node:test';
import assert from 'node:assert/strict';

import { SAVE_VERSION, deserialize, newGame, serialize } from '../src/sim/state.js';
import { capacityOf, homeFixture } from '../src/data/fixtureSlots.js';
import { SHOP_CATALOG } from '../src/data/shopItems.js';
import { reconcileInventory } from '../src/sim/inventoryLifecycle.js';
import { placedFixtures, storeObject } from '../src/sim/layout.js';

const SHEET03_CAPACITIES = Object.freeze({
  driver1: 6,
  driver2: 6,
  driver3: 6,
  irons1: 5,
  irons2: 5,
  wedge1: 5,
  wedge2: 5,
  putter1: 6,
  putter2: 6,
  balls1: 15,
  balls2: 15,
  balls3: 15,
  polo2: 6,
  cap1: 4,
  glove1: 6,
  sock1: 6,
  shoe1: 6,
  tees1: 6,
  marker1: 6,
  towel1: 6,
  range2: 6,
  umb1: 6,
  bag1: 4,
  water1: 8,
  snack1: 8,
});

test('fresh Sheet-03 inventory obeys authored capacities without losing starter stock', () => {
  const state = newGame('relaxed', 30301);

  for (const [skuId, expected] of Object.entries(SHEET03_CAPACITIES)) {
    assert.equal(capacityOf(skuId), expected, `${skuId} exposes ${expected} physical positions`);
    assert.ok(state.shop.inventory[skuId].shelf <= expected, `${skuId} does not overfill its display`);
  }

  assert.deepEqual(state.shop.inventory.tees1, { shelf: 6, back: 8 },
    'starter tee bags beyond the six physical positions move to back stock');
  assert.equal(state.shop.inventory.tees1.shelf + state.shop.inventory.tees1.back, 14,
    'all fourteen starter tee bags remain owned');
});

test('deserialize moves every authored-capacity overflow to back stock and conserves held units', () => {
  const raw = JSON.parse(serialize(newGame('relaxed', 30302)));
  raw.shop.progression.tier = 'luxury';
  const overfull = Object.fromEntries(SHOP_CATALOG.map((sku, index) => [sku.id, {
    shelf: capacityOf(sku.id) + 1 + (index % 4),
    back: index % 3,
  }]));
  Object.assign(raw.shop.inventory, structuredClone(overfull));
  delete raw.shop.inventoryLifecycle;
  raw.shop.held = [{ uid: 'sheet03-held-rangefinder', skuId: 'range2' }];

  const totalsBefore = Object.fromEntries(Object.entries(overfull).map(([skuId, inventory]) => [
    skuId,
    inventory.shelf + inventory.back + (skuId === 'range2' ? 1 : 0),
  ]));
  const loaded = deserialize(JSON.stringify(raw));

  assert.deepEqual(loaded.shop.held, [], 'checkout recovery returns the held rangefinder exactly once');
  for (const [skuId, totalBefore] of Object.entries(totalsBefore)) {
    const inventory = loaded.shop.inventory[skuId];
    assert.equal(inventory.shelf, capacityOf(skuId), `${skuId} shelf stops at its authored capacity`);
    assert.equal(inventory.shelf + inventory.back, totalBefore, `${skuId} total inventory is conserved`);
  }
  assert.equal(reconcileInventory(loaded).ok, true,
    'legacy capacity repair relocates the matching lifecycle lots');

  const loadedAgain = deserialize(serialize(loaded));
  for (const skuId of Object.keys(overfull)) {
    assert.deepEqual(loadedAgain.shop.inventory[skuId], loaded.shop.inventory[skuId],
      `${skuId} capacity repair is round-trip idempotent`);
  }
});

test('load-time stored-fixture repair moves the physical projection and lifecycle ledger together', () => {
  const state = newGame('relaxed', 30305);
  assert.equal(storeObject(state, 'shelf_balls').ok, true);
  assert.equal(state.shop.inventory.balls1.shelf, 10);
  assert.equal(reconcileInventory(state).ok, true,
    'the deliberately interrupted pre-load state still projects stock on the now-stored display');

  const loaded = deserialize(serialize(state));
  assert.deepEqual(loaded.shop.inventory.balls1, { shelf: 0, back: 10 });
  assert.equal(reconcileInventory(loaded).ok, true,
    'load repair relocates the same units in both inventory authorities');

  const loadedAgain = deserialize(serialize(loaded));
  assert.deepEqual(loadedAgain.shop.inventory.balls1, loaded.shop.inventory.balls1);
  assert.equal(reconcileInventory(loadedAgain).ok, true, 'the repair is round-trip idempotent');
});

test('v7 stored feature migrates back to range2 visibility while v8 intentional stow persists', () => {
  const legacyRaw = JSON.parse(serialize(newGame('relaxed', 30303)));
  legacyRaw.version = 7;
  delete legacyRaw.shop.progression;
  legacyRaw.shop.layout = {
    moved: {},
    stored: ['feature', 'table_polos'],
    extra: [],
  };
  legacyRaw.shop.inventory.range2 = { shelf: 6, back: 3 };

  const migrated = deserialize(JSON.stringify(legacyRaw));
  assert.equal(migrated.version, SAVE_VERSION);
  assert.equal(homeFixture('range2')?.id, 'shelf_acc', 'range2 has one authored home');
  assert.ok(placedFixtures(migrated).some((fixture) => fixture.id === 'feature'),
    'the legacy decorative feature is restored');
  assert.ok(!migrated.shop.layout.stored.includes('feature'));
  assert.ok(migrated.shop.layout.stored.includes('table_polos'),
    'the migration does not restore unrelated fixtures');
  assert.equal(migrated.shop.inventory.range2.shelf + migrated.shop.inventory.range2.back, 9,
    'restoring the legacy fixture neither mints nor loses rangefinders');

  const current = newGame('relaxed', 30304);
  current.shop.progression.tier = 'premium';
  current.shop.unlockedTier = 3;
  current.shop.layout = { moved: {}, stored: ['feature'], extra: [] };
  current.shop.inventory.range2 = { shelf: 0, back: 3 };
  const intentionallyStored = deserialize(serialize(current));
  assert.ok(intentionallyStored.shop.layout.stored.includes('feature'),
    'a current-schema intentional stow remains authoritative');
  assert.ok(!placedFixtures(intentionallyStored).some((fixture) => fixture.id === 'feature'));
  assert.deepEqual(intentionallyStored.shop.inventory.range2, { shelf: 0, back: 3 });
});
