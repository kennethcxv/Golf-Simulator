import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { FIXTURES } from '../src/data/shopLayout.js';
import { SHOP_CATALOG } from '../src/data/shopItems.js';
import { buildBuildMode } from '../src/render3d/clubhouse/buildMode.js';
import { placedFixtures } from '../src/sim/layout.js';
import {
  restockShelfFromBackroom,
  restockShelvesByStaff,
  shopDailyAccrual,
  shopOpenStock,
} from '../src/sim/shop.js';
import { ROLE } from '../src/sim/staff.js';
import { SAVE_VERSION, deserialize, newGame, serialize } from '../src/sim/state.js';

function stowFeatureThroughBuildMode(state) {
  const fixture = FIXTURES.find((entry) => entry.id === 'feature');
  const mode = buildBuildMode({
    interior: new THREE.Group(),
    state,
    hooks: {},
    walk: {
      x: fixture.x,
      z: fixture.z,
      yaw: 0,
      pitch: -Math.PI / 2,
      eye: 1.6,
    },
    W2L: (x, z) => ({ x, z }),
    L2W: (x, z) => ({ x, z }),
    FLOOR_TOP: 0,
  }, {
    rebuildLayout: () => {},
    fixtureAnchors: new Map([[fixture.id, new THREE.Group()]]),
  });

  mode.enter();
  assert.equal(mode.interact(), true, 'normal E interaction lifts the empty feature display');
  assert.equal(mode.isCarrying(), fixture.id);
  assert.equal(mode.stow(), true, 'normal build-mode stow input is handled');
  assert.equal(mode.isCarrying(), null);
  assert.ok(state.shop.layout.stored.includes(fixture.id));
  assert.ok(!placedFixtures(state).some((entry) => entry.id === fixture.id));
}

function clearInventory(state) {
  for (const inventory of Object.values(state.shop.inventory)) {
    inventory.shelf = 0;
    inventory.back = 0;
  }
}

test('staff never restock an intentionally stored empty display from back stock', () => {
  const state = newGame('relaxed', 30331);
  clearInventory(state);
  state.shop.inventory.range2.back = 7;
  state.staff.employees.push({
    id: 30331,
    name: 'Fixture Safety Pro',
    role: ROLE.PROSHOP,
    skill: 5,
    wage: 100,
    trainingDays: 0,
  });

  stowFeatureThroughBuildMode(state);
  const moved = restockShelvesByStaff(state);

  assert.equal(moved, 0);
  assert.deepEqual(state.shop.inventory.range2, { shelf: 0, back: 7 });
  assert.deepEqual(
    restockShelfFromBackroom(state, 'range2'),
    { ok: false, reason: 'That display is stored.' },
    'the direct shelf command obeys the same physical-display rule',
  );
});

test('daily passive demand cannot sell shelf counts whose authored display is absent', () => {
  const state = newGame('relaxed', 30332);
  clearInventory(state);
  state.shop.unlockedTier = 3;
  state.club.lastRounds = 180;
  state.club.reputation = 100;
  state.shop.rentalFleet.sets = 0;
  stowFeatureThroughBuildMode(state);
  // A malformed/interrupted in-memory state must still never turn an absent
  // physical display into statistical sales.
  state.shop.inventory.range2.shelf = 6;

  assert.equal(shopOpenStock(state), 0, 'invisible units do not improve the open-shop stock score');
  shopDailyAccrual(state);

  assert.equal(state.shop.inventory.range2.shelf, 6, 'the invisible shelf ledger is not depleted');
  assert.equal(state.shop.salesYesterday.units, 0, 'no passive sale is recorded');
  assert.equal(state.shop.salesToday.range2 || 0, 0, 'no rangefinder velocity is fabricated');
});

test('load recovery sends hidden shelf and held units to back stock exactly once', () => {
  const state = newGame('relaxed', 30333);
  clearInventory(state);
  state.shop.inventory.range2.back = 3;
  stowFeatureThroughBuildMode(state);

  // Model an interrupted/crafted save written with two invisible shelf units
  // and one customer-held unit. All six units are still owned.
  state.shop.inventory.range2.shelf = 2;
  state.shop.held = [{ uid: 'stored-feature-held-rangefinder', skuId: 'range2' }];
  const loaded = deserialize(serialize(state));

  assert.ok(loaded.shop.layout.stored.includes('feature'), 'the modern intentional stow survives');
  assert.deepEqual(loaded.shop.held, [], 'the departed shopper ledger is fully recovered');
  assert.deepEqual(loaded.shop.inventory.range2, { shelf: 0, back: 6 });

  const loadedAgain = deserialize(serialize(loaded));
  assert.deepEqual(loadedAgain.shop.inventory.range2, { shelf: 0, back: 6 },
    'a second round trip neither mints nor loses inventory');
  assert.ok(loadedAgain.shop.layout.stored.includes('feature'));
});

test('rangefinder merchandising migrates the old balls default without clobbering future choices', () => {
  const fresh = newGame('relaxed', 30334);
  assert.equal(fresh.shop.featureCategory, 'accessories',
    'fresh economy attention agrees with the authored rangefinder display');

  const currentLegacy = JSON.parse(serialize(fresh));
  currentLegacy.version = 8;
  currentLegacy.shop.featureCategory = 'balls';
  assert.equal(deserialize(currentLegacy).shop.featureCategory, 'accessories',
    'the v8 persisted default migrates once');

  for (const explicitCategory of ['clubs', 'balls']) {
    const future = JSON.parse(serialize(fresh));
    future.version = SAVE_VERSION;
    future.shop.featureCategory = explicitCategory;
    assert.equal(deserialize(future).shop.featureCategory, explicitCategory,
      `current-schema explicit ${explicitCategory} merchandising remains authoritative`);
  }

  assert.ok(SHOP_CATALOG.find((sku) => sku.id === 'range2' && sku.cat === 'accessories'));
});
