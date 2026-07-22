import test from 'node:test';
import assert from 'node:assert/strict';
import { furnitureById } from '../src/data/furnitureCatalog.js';
import { placeableById } from '../src/data/placeableCatalog.js';
import {
  ensureFurnitureCatalogState, furnitureCatalogAvailability, furnitureEffects,
  furnitureUnlockStatus, installFurniture, installedFurnitureByFamily, purchaseFurniture,
  purchasedFurnitureInstances, uninstallFurniture,
} from '../src/sim/furnitureCatalog.js';
import {
  commitObjectPlacement, objectById, placedObjects, sellObject, soldObjects, storedObjects,
} from '../src/sim/layout.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';

function fundedState(seed = 7101) {
  const state = newGame('relaxed', seed);
  state.cash = 1_000_000;
  state.club.reputation = 100;
  return state;
}

test('fresh and legacy states receive an empty level-one furniture ownership record', () => {
  const state = newGame('relaxed', 7100);
  assert.deepEqual(ensureFurnitureCatalogState(state), {
    version: 1,
    level: 1,
    xp: 0,
    nextSerial: 1,
    lifetimeSpend: 0,
    purchaseCount: 0,
    purchases: [],
  });
  assert.equal(purchasedFurnitureInstances(state).length, 0);
  assert.equal(storedObjects(state).some((object) => object.catalogSku), false,
    'catalog definitions never become free starting inventory');

  const raw = JSON.parse(serialize(state));
  delete raw.shop.furnitureCatalog;
  const migrated = deserialize(raw);
  assert.equal(migrated.shop.furnitureCatalog.level, 1);
  assert.equal(migrated.shop.furnitureCatalog.nextSerial, 1);
});

test('level and reputation gates stage all five progression tiers', () => {
  const state = fundedState(7102);
  state.club.reputation = 0;
  const furniture = ensureFurnitureCatalogState(state);
  const basic = furnitureById('apparel-rack-basic');
  const commercial = furnitureById('apparel-rack-commercial');
  const luxury = furnitureById('apparel-rack-luxury');
  assert.equal(furnitureUnlockStatus(state, basic).unlocked, true);
  assert.deepEqual(furnitureUnlockStatus(state, commercial).reasons, [
    'Renovation level 5 required.',
    '12 reputation required.',
  ]);

  furniture.level = 35;
  state.club.reputation = 78;
  assert.equal(furnitureUnlockStatus(state, luxury).unlocked, true);
  const available = furnitureCatalogAvailability(state);
  assert.equal(available.length, 310);
  assert.equal(available.every((entry) => entry.unlocked), true);
});

test('purchasing deducts cash and creates distinct dynamic storage objects', () => {
  const state = fundedState(7103);
  const item = furnitureById('lounge-armchair-basic');
  const cashBefore = state.cash;
  const purchase = purchaseFurniture(state, item.id, { quantity: 3 });
  assert.equal(purchase.ok, true);
  assert.equal(state.cash, cashBefore - item.price * 3);
  assert.equal(new Set(purchase.instanceIds).size, 3);
  assert.equal(state.shop.furnitureCatalog.purchaseCount, 3);
  assert.equal(state.shop.furnitureCatalog.lifetimeSpend, item.price * 3);
  assert.ok(state.shop.furnitureCatalog.level > 1, 'renovation XP advances progression');

  const owned = purchasedFurnitureInstances(state, { states: ['stored'] });
  assert.deepEqual(owned.map((entry) => entry.id), purchase.instanceIds);
  const stored = storedObjects(state).filter((object) => purchase.instanceIds.includes(object.id));
  assert.equal(stored.length, 3);
  for (const object of stored) {
    assert.equal(object.catalogSku, item.id);
    assert.equal(object.price, item.price);
    assert.equal(object.quality, item.quality);
    assert.equal(object.brandTier, item.brandTier);
    assert.equal(object.thumbnail, item.thumbnail);
    assert.equal(object.category, item.category);
    assert.match(object.render.path, /lounge-armchair_basic\.glb$/);
  }
});

test('flooring purchases charge the fitted room package rather than one square foot', () => {
  const state = fundedState(7107);
  const item = furnitureById('flooring-basic');
  const cashBefore = state.cash;
  const purchase = purchaseFurniture(state, item.id);
  assert.equal(purchase.ok, true);
  assert.equal(purchase.total, 4800);
  assert.equal(state.cash, cashBefore - item.purchaseCost);
  assert.equal(state.shop.layout.objects[purchase.instanceIds[0]].purchasedPrice, item.purchaseCost);
  assert.equal(state.shop.furnitureCatalog.lifetimeSpend, item.purchaseCost);
  assert.deepEqual(state.shop.furnitureCatalog.purchases[0], {
    skuId: item.id,
    instanceIds: purchase.instanceIds,
    quantity: 1,
    unitPrice: item.purchaseCost,
    catalogRate: item.price,
    packageQuantity: item.packageQuantity,
    total: item.purchaseCost,
    levelAfter: state.shop.furnitureCatalog.level,
    layoutRevision: state.shop.layout.revision,
  });
});

test('dynamic catalog objects use placement metadata and survive placement, sale and save/load', () => {
  const state = fundedState(7104);
  const purchase = purchaseFurniture(state, 'coffee-table-basic');
  const id = purchase.instanceIds[0];
  const meta = placeableById(id);
  assert.equal(meta.id, id);
  assert.deepEqual(meta.surfaceRules.allowed, ['floor']);
  assert.ok(meta.bounds.width > 1 && meta.bounds.depth > 0.5);

  const placement = commitObjectPlacement(state, id, {
    x: -4.4, y: 0, z: 3.2, ry: 0, surface: 'floor', attachment: null, room: 'sales',
  }, { skipValidation: true });
  assert.equal(placement.ok, true);
  assert.equal(objectById(state, id).state, 'placed');
  assert.equal(placedObjects(state).some((object) => object.id === id), true);

  const loaded = deserialize(serialize(state));
  const loadedObject = objectById(loaded, id);
  assert.equal(loadedObject.state, 'placed');
  assert.equal(loadedObject.catalogSku, 'coffee-table-basic');
  assert.deepEqual(loadedObject.transform, placement.object.transform);
  assert.equal(loaded.shop.furnitureCatalog.purchaseCount, 1);

  const cashBeforeSale = loaded.cash;
  const sale = sellObject(loaded, id);
  assert.equal(sale.ok, true);
  assert.equal(loaded.cash, cashBeforeSale + meta.sellValue);
  assert.equal(soldObjects(loaded).some((object) => object.id === id), true);
  assert.equal(sellObject(loaded, id).repeated, true, 'a reload-safe sale cannot mint money twice');
});

test('installations are swappable, remain owned, and contribute clubhouse values', () => {
  const state = fundedState(7105);
  const first = purchaseFurniture(state, 'flooring-basic').instanceIds[0];
  ensureFurnitureCatalogState(state).level = 5;
  const second = purchaseFurniture(state, 'flooring-commercial').instanceIds[0];
  const chair = purchaseFurniture(state, 'lounge-armchair-basic').instanceIds[0];
  commitObjectPlacement(state, chair, {
    x: -4, y: 0, z: 3, ry: 0, surface: 'floor', attachment: null, room: 'sales',
  }, { skipValidation: true });

  assert.equal(installFurniture(state, first).ok, true);
  assert.equal(installFurniture(state, second).ok, true);
  assert.equal(objectById(state, first).state, 'stored', 'the previous finish returns to storage');
  assert.equal(objectById(state, second).state, 'installed');
  const effects = furnitureEffects(state);
  const expected = [furnitureById('flooring-commercial'), furnitureById('lounge-armchair-basic')];
  assert.deepEqual(effects, {
    maintenanceValue: expected.reduce((sum, item) => sum + item.maintenanceValue, 0),
    comfortValue: expected.reduce((sum, item) => sum + item.comfortValue, 0),
    prestigeValue: expected.reduce((sum, item) => sum + item.prestigeValue, 0),
    placedCount: 1,
    installedCount: 1,
  });
  assert.equal(installedFurnitureByFamily(state).flooring.id, 'flooring-commercial');
  assert.equal(uninstallFurniture(state, second).ok, true);
  assert.equal(installedFurnitureByFamily(state).flooring, undefined);
  assert.equal(objectById(state, second).state, 'stored');
});

test('purchase failures never mutate ownership or cash', () => {
  const state = fundedState(7106);
  const cashBefore = state.cash;
  const locked = purchaseFurniture(state, 'apparel-rack-luxury');
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, true);
  assert.equal(state.cash, cashBefore);
  assert.equal(purchasedFurnitureInstances(state).length, 0);

  state.shop.furnitureCatalog.level = 35;
  state.club.reputation = 100;
  state.cash = 1;
  const poor = purchaseFurniture(state, 'apparel-rack-luxury');
  assert.equal(poor.ok, false);
  assert.equal(state.cash, 1);
  assert.equal(purchasedFurnitureInstances(state).length, 0);
});
