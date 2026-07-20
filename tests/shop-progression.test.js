import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { placedFixtures, commitPlacement, routesIntact, shopExpansionLayoutSafety } from '../src/sim/layout.js';
import { placeOrder } from '../src/sim/shop.js';
import { appraiseProperty } from '../src/sim/valuation.js';
import {
  SHOP_TIERS,
  beginShopExpansion,
  shopCategoryUnlocked,
  shopCustomerCapacity,
  shopProductCapacity,
  tickShopProgressionDaily,
  tryCompleteShopExpansion,
} from '../src/sim/shopProgression.js';

test('a new property opens as a compact BASIC retail operation', () => {
  const state = newGame('relaxed', 12001);
  assert.equal(state.shop.progression.tier, 'basic');
  assert.equal(state.shop.unlockedTier, 1);
  assert.equal(shopCustomerCapacity(state), 2);
  assert.deepEqual(
    placedFixtures(state).map((fixture) => fixture.id).sort(),
    ['backcounter', 'backshelf_n', 'hatstand', 'shelf_acc', 'shelf_balls', 'shelf_small'].sort(),
  );
  assert.equal(routesIntact(state), true);
  assert.equal(shopCategoryUnlocked(state, 'clubs'), false);
  assert.equal(shopCategoryUnlocked(state, 'provisions'), false);
  assert.equal(shopCategoryUnlocked(state, 'balls'), true);
});

test('locked categories cannot create paid orders before their floor exists', () => {
  const state = newGame('relaxed', 12002);
  const cash = state.cash;
  const result = placeOrder(state, 'driver1', 1);
  assert.equal(result.ok, false);
  assert.match(result.reason, /STANDARD shop/i);
  assert.equal(state.cash, cash);
  assert.equal(state.shop.orders.length, 0);
});

test('STANDARD construction costs money, takes two days, and activates physical capacity', () => {
  const state = newGame('relaxed', 12003);
  const beforeCash = state.cash;
  const beforeCapacity = shopProductCapacity(state);
  const beforeValue = appraiseProperty(state);
  const started = beginShopExpansion(state, 'standard');
  assert.equal(started.ok, true);
  assert.equal(state.cash, beforeCash - SHOP_TIERS.standard.cost);
  assert.equal(state.shop.progression.pending.daysLeft, 2);
  assert.equal(state.shop.progression.tier, 'basic', 'purchase is not instant construction');

  tickShopProgressionDaily(state, shopExpansionLayoutSafety);
  assert.equal(state.shop.progression.pending.daysLeft, 1);
  tickShopProgressionDaily(state, shopExpansionLayoutSafety);

  assert.equal(state.shop.progression.tier, 'standard');
  assert.equal(state.shop.progression.pending, null);
  assert.equal(state.shop.unlockedTier, 2);
  assert.equal(shopCustomerCapacity(state), 4);
  assert.ok(shopProductCapacity(state) > beforeCapacity);
  assert.equal(appraiseProperty(state), beforeValue + SHOP_TIERS.standard.propertyValue);
  assert.equal(shopCategoryUnlocked(state, 'clubs'), true);
  assert.equal(routesIntact(state), true);
});

test('construction state and remaining days survive save/load', () => {
  const state = newGame('relaxed', 12004);
  beginShopExpansion(state, 'standard');
  tickShopProgressionDaily(state, shopExpansionLayoutSafety);
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.shop.progression.tier, 'basic');
  assert.deepEqual(loaded.shop.progression.pending, state.shop.progression.pending);
  assert.equal(loaded.shop.progression.pending.daysLeft, 1);
  assert.equal(shopProductCapacity(loaded), shopProductCapacity(state));
});

test('future authored fixtures cannot activate into a player-created collision', () => {
  const state = newGame('relaxed', 12005);
  state.cash = 100000;
  beginShopExpansion(state, 'standard');
  tickShopProgressionDaily(state, shopExpansionLayoutSafety);
  tickShopProgressionDaily(state, shopExpansionLayoutSafety);
  assert.equal(state.shop.progression.tier, 'standard');

  // The putter studio is not installed at STANDARD, so its saved future pose
  // may coexist until the PREMIUM contractor tries to reveal that footprint.
  commitPlacement(state, 'rack_putters', -6.9, -6.15, 0);
  beginShopExpansion(state, 'premium');
  for (let day = 0; day < SHOP_TIERS.premium.days; day++) {
    tickShopProgressionDaily(state, shopExpansionLayoutSafety);
  }
  assert.equal(state.shop.progression.tier, 'standard');
  assert.equal(state.shop.progression.pending.daysLeft, 0);
  assert.equal(state.shop.progression.pending.blocked, true);
  assert.match(state.shop.progression.pending.blocker, /overlap/i);

  delete state.shop.layout.moved.rack_putters;
  const completed = tryCompleteShopExpansion(state, shopExpansionLayoutSafety);
  assert.equal(completed.ok, true);
  assert.equal(state.shop.progression.tier, 'premium');
  assert.equal(routesIntact(state), true);
});

test('legacy saves keep their existing full floor and tier-2 supplier access', () => {
  const current = newGame('relaxed', 12006);
  const raw = JSON.parse(serialize(current));
  raw.version = 11;
  delete raw.shop.progression;
  raw.shop.unlockedTier = 2;
  const migrated = deserialize(raw);
  assert.equal(migrated.shop.progression.tier, 'standard');
  assert.equal(migrated.shop.progression.legacyFullLayout, true);
  assert.equal(migrated.shop.unlockedTier, 2);
  assert.equal(placedFixtures(migrated).length, 18);
  assert.equal(routesIntact(migrated), true);
});
