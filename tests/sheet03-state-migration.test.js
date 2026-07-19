import test from 'node:test';
import assert from 'node:assert/strict';

import { SAVE_VERSION, deserialize, newGame, serialize } from '../src/sim/state.js';
import { capacityOf, homeFixture } from '../src/data/fixtureSlots.js';
import { SHOP_CATALOG } from '../src/data/shopItems.js';
import { placedFixtures } from '../src/sim/layout.js';

const SHEET03_CAPACITIES = Object.freeze({
  driver1: 6,
  driver2: 6,
  driver3: 6,
  irons1: 5,
  irons2: 5,
  wedge1: 5,
  wedge2: 5,
  putter1: 10,
  putter2: 10,
  balls1: 15,
  balls2: 15,
  balls3: 15,
  polo2: 12,
  cap1: 16,
  glove1: 12,
  sock1: 12,
  shoe1: 12,
  tees1: 12,
  marker1: 12,
  towel1: 12,
  range2: 6,
  umb1: 8,
  bag1: 5,
  water1: 14,
  snack1: 10,
});

test('fresh Sheet-03 inventory obeys authored capacities without losing starter stock', () => {
  const state = newGame('relaxed', 30301);

  for (const [skuId, expected] of Object.entries(SHEET03_CAPACITIES)) {
    assert.equal(capacityOf(skuId), expected, `${skuId} exposes ${expected} physical positions`);
    assert.ok(state.shop.inventory[skuId].shelf <= expected, `${skuId} does not overfill its display`);
  }

  assert.deepEqual(state.shop.inventory.tees1, { shelf: 12, back: 2 },
    'the two starter tee bags beyond the twelve-slot fixture move to back stock');
  assert.equal(state.shop.inventory.tees1.shelf + state.shop.inventory.tees1.back, 14,
    'all fourteen starter tee bags remain owned');
});

test('deserialize moves every authored-capacity overflow to back stock and conserves held units', () => {
  const raw = JSON.parse(serialize(newGame('relaxed', 30302)));
  const overfull = Object.fromEntries(SHOP_CATALOG.map((sku, index) => [sku.id, {
    shelf: capacityOf(sku.id) + 1 + (index % 4),
    back: index % 3,
  }]));
  Object.assign(raw.shop.inventory, structuredClone(overfull));
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

  const loadedAgain = deserialize(serialize(loaded));
  for (const skuId of Object.keys(overfull)) {
    assert.deepEqual(loadedAgain.shop.inventory[skuId], loaded.shop.inventory[skuId],
      `${skuId} capacity repair is round-trip idempotent`);
  }
});

test('v7 stored feature migrates back to range2 visibility while v8 intentional stow persists', () => {
  const legacyRaw = JSON.parse(serialize(newGame('relaxed', 30303)));
  legacyRaw.version = 7;
  legacyRaw.shop.layout = {
    moved: {},
    stored: ['feature', 'table_polos'],
    extra: [],
  };
  legacyRaw.shop.inventory.range2 = { shelf: 6, back: 3 };

  const migrated = deserialize(JSON.stringify(legacyRaw));
  assert.equal(migrated.version, SAVE_VERSION);
  assert.equal(homeFixture('range2')?.id, 'feature', 'range2 has one authored home');
  assert.ok(placedFixtures(migrated).some((fixture) => fixture.id === 'feature'),
    'the legacy decorative stow is healed so rangefinders remain visible');
  assert.ok(!migrated.shop.layout.stored.includes('feature'));
  assert.ok(migrated.shop.layout.stored.includes('table_polos'),
    'the migration does not restore unrelated fixtures');
  assert.equal(migrated.shop.inventory.range2.shelf + migrated.shop.inventory.range2.back, 9,
    'restoring the legacy fixture neither mints nor loses rangefinders');

  const current = newGame('relaxed', 30304);
  current.shop.layout = { moved: {}, stored: ['feature'], extra: [] };
  current.shop.inventory.range2 = { shelf: 0, back: 3 };
  const intentionallyStored = deserialize(serialize(current));
  assert.ok(intentionallyStored.shop.layout.stored.includes('feature'),
    'a current-schema intentional stow remains authoritative');
  assert.ok(!placedFixtures(intentionallyStored).some((fixture) => fixture.id === 'feature'));
  assert.deepEqual(intentionallyStored.shop.inventory.range2, { shelf: 0, back: 3 });
});
