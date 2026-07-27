import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import {
  PRO_SHOP_FURNITURE_CATEGORIES,
  PRO_SHOP_FURNITURE_PIECE_COUNT,
  PRO_SHOP_FURNITURE_PLACEABLES,
  PRO_SHOP_FURNITURE_SKUS,
  PRO_SHOP_FURNITURE_TIERS,
  CHAIR_TIER_SPECS,
  CLOTHING_RACK_TIER_SPECS,
  OFFICE_DESK_TIER_SPECS,
  RETAIL_SHELF_TIER_SPECS,
} from '../src/data/proShopFurniture.js';
import { PLACEABLE_ITEM_CATALOG } from '../src/data/placeableItems.js';
import { placeableById } from '../src/data/placeableCatalog.js';

test('the pro-shop library contains all 25 categories at all five physical tiers', () => {
  assert.equal(PRO_SHOP_FURNITURE_CATEGORIES.length, 25);
  assert.deepEqual(PRO_SHOP_FURNITURE_TIERS.map((tier) => tier.id), [
    'basic', 'standard', 'premium', 'luxury', 'executive',
  ]);
  assert.equal(PRO_SHOP_FURNITURE_PIECE_COUNT, 125);
  assert.equal(PRO_SHOP_FURNITURE_SKUS.length, 125);
  assert.equal(PRO_SHOP_FURNITURE_PLACEABLES.length, 125);
  assert.equal(new Set(PRO_SHOP_FURNITURE_SKUS.map((sku) => sku.modelPath)).size, 125);
});

test('every tier advances its authored geometry and non-reference families grow physically', () => {
  assert.ok(PRO_SHOP_FURNITURE_TIERS.every((tier) => tier.heightScale <= 1.10), 'tier heights remain ergonomic');
  for (const category of PRO_SHOP_FURNITURE_CATEGORIES) {
    const family = PRO_SHOP_FURNITURE_SKUS.filter((sku) => sku.furnitureCategory === category.id);
    assert.equal(family.length, 5, category.id);
    for (let index = 1; index < family.length; index += 1) {
      const before = family[index - 1];
      const after = family[index];
      assert.ok(after.dimensionsM[0] > before.dimensionsM[0], `${category.id} width tier ${index}`);
      if (category.id === 'chairs') {
        // The last two tiers intentionally become lower, deeper club chairs.
        assert.deepEqual(after.dimensionsM, CHAIR_TIER_SPECS[after.furnitureTierId].dimensionsM);
      } else if (category.id === 'clothing-racks') {
        // These exact reference-matched footprints are intentionally not a
        // uniform scale series (Premium is shallower than Standard).
        assert.deepEqual(after.dimensionsM, CLOTHING_RACK_TIER_SPECS[after.furnitureTierId].dimensionsM);
      } else if (category.id === 'freestanding-shelving') {
        // Premium intentionally returns to an ergonomic boutique height before
        // the built-in wall tiers become taller architectural millwork.
        assert.deepEqual(after.dimensionsM, RETAIL_SHELF_TIER_SPECS[after.furnitureTierId].dimensionsM);
      } else if (category.id === 'office-desks') {
        assert.ok(after.dimensionsM[1] >= before.dimensionsM[1], `${category.id} ergonomic height tier ${index}`);
      } else {
        assert.ok(after.dimensionsM[1] > before.dimensionsM[1], `${category.id} height tier ${index}`);
      }
      if (category.id !== 'clothing-racks') {
        assert.ok(after.dimensionsM[2] > before.dimensionsM[2], `${category.id} depth tier ${index}`);
      }
      assert.notEqual(after.geometryProfile, before.geometryProfile, `${category.id} geometry tier ${index}`);
      assert.ok(after.cost > before.cost, `${category.id} price tier ${index}`);
      assert.ok(PRO_SHOP_FURNITURE_TIERS[index].widthScale > PRO_SHOP_FURNITURE_TIERS[index - 1].widthScale);
      assert.ok(PRO_SHOP_FURNITURE_TIERS[index].heightScale > PRO_SHOP_FURNITURE_TIERS[index - 1].heightScale);
      assert.ok(PRO_SHOP_FURNITURE_TIERS[index].depthScale > PRO_SHOP_FURNITURE_TIERS[index - 1].depthScale);
    }
    if (!['clothing-racks', 'freestanding-shelving'].includes(category.id)) {
      assert.ok(family.at(-1).dimensionsM[1] <= category.dimensionsM[1] * 1.101, `${category.id} executive height`);
    }
  }
});

test('office desk runtime tiers map exactly to the five authored reference designs', () => {
  const desks = PRO_SHOP_FURNITURE_SKUS.filter((sku) => sku.furnitureCategory === 'office-desks');
  assert.deepEqual(desks.map((desk) => desk.name), [
    'Basic Office Desk',
    'Standard Office Desk',
    'Premium Office Desk',
    'High-End Office Desk',
    'Luxury Office Desk',
  ]);
  assert.deepEqual(desks.map((desk) => desk.dimensionsM),
    Object.values(OFFICE_DESK_TIER_SPECS).map((spec) => spec.dimensionsM));
  assert.deepEqual(desks.map((desk) => desk.geometryProfile.split(':')[1]),
    Object.values(OFFICE_DESK_TIER_SPECS).map((spec) => spec.assetName));
  for (const desk of desks) {
    assert.deepEqual(desk.authoredLodDistancesM, [0, 8, 18]);
    assert.equal(desk.authoredLodModelPaths.length, 3);
    assert.ok(desk.authoredLodModelPaths.every((model) => existsSync(model)), desk.name);
  }
});

test('chair runtime ids map exactly to the five authored seating designs', () => {
  const chairs = PRO_SHOP_FURNITURE_SKUS.filter((sku) => sku.furnitureCategory === 'chairs');
  const specs = Object.values(CHAIR_TIER_SPECS);
  assert.deepEqual(chairs.map((chair) => chair.name), [
    'Basic Chair',
    'Standard Chair',
    'Premium Chair',
    'High-End Chair',
    'Luxury Chair',
  ]);
  assert.deepEqual(chairs.map((chair) => chair.authoredTierId), specs.map((spec) => spec.assetTierId));
  assert.deepEqual(chairs.map((chair) => chair.dimensionsM), specs.map((spec) => spec.dimensionsM));
  assert.deepEqual(chairs.map((chair) => chair.functionalProfile.chairKind), [
    'office', 'office', 'office', 'lounge', 'lounge',
  ]);
  assert.deepEqual(chairs.map((chair) => chair.functionalProfile.swivels), [true, true, true, false, false]);
  assert.deepEqual(chairs.map((chair) => chair.functionalProfile.casters), [true, true, true, false, false]);
  assert.deepEqual(chairs.map((chair) => chair.functionalProfile.reclineDegrees), [0, 12, 18, 0, 0]);
  for (const chair of chairs) {
    assert.ok(existsSync(chair.modelPath), chair.modelPath);
    assert.deepEqual(chair.authoredLodDistancesM, [0, 8, 18]);
    assert.equal(chair.functionalProfile.seatNode, 'SEAT_ANCHOR');
    assert.equal(chair.functionalProfile.entryNodes.length, 2);
    assert.equal(chair.functionalProfile.exitNodes.length, 2);
  }
});

test('clothing rack runtime ids map to the five authored designs and production GLBs', () => {
  const racks = PRO_SHOP_FURNITURE_SKUS.filter((sku) => sku.furnitureCategory === 'clothing-racks');
  const specs = Object.values(CLOTHING_RACK_TIER_SPECS);
  assert.deepEqual(racks.map((rack) => rack.name), [
    'Basic Clothing Rack',
    'Standard Clothing Rack',
    'Premium Clothing Rack',
    'High-End Clothing Rack',
    'Luxury Clothing Rack',
  ]);
  assert.deepEqual(racks.map((rack) => rack.authoredTierId), specs.map((spec) => spec.assetTierId));
  assert.deepEqual(racks.map((rack) => rack.dimensionsM), specs.map((spec) => spec.dimensionsM));
  assert.deepEqual(racks.map((rack) => rack.functionalProfile.hangZones), [1, 1, 1, 3, 3]);
  assert.deepEqual(racks.map((rack) => rack.functionalProfile.shelfZones), [0, 1, 4, 9, 12]);
  assert.deepEqual(racks.map((rack) => rack.functionalProfile.lightNodes), [0, 0, 0, 3, 6]);
  for (const rack of racks) {
    assert.ok(existsSync(rack.modelPath), rack.modelPath);
    assert.deepEqual(rack.authoredLodDistancesM, [0, 8, 18]);
  }
});

test('freestanding shelving runtime ids map to the five functional reference assets', () => {
  const shelves = PRO_SHOP_FURNITURE_SKUS.filter((sku) => sku.furnitureCategory === 'freestanding-shelving');
  const specs = Object.values(RETAIL_SHELF_TIER_SPECS);
  assert.deepEqual(shelves.map((shelf) => shelf.name), [
    'Basic Freestanding Shelving',
    'Standard Freestanding Shelving',
    'Premium Freestanding Shelving',
    'High-End Freestanding Shelving',
    'Luxury Freestanding Shelving',
  ]);
  assert.deepEqual(shelves.map((shelf) => shelf.authoredTierId), specs.map((spec) => spec.assetTierId));
  assert.deepEqual(shelves.map((shelf) => shelf.dimensionsM), specs.map((spec) => spec.dimensionsM));
  assert.deepEqual(shelves.map((shelf) => shelf.functionalProfile.shelfZones), [3, 3, 3, 15, 15]);
  assert.deepEqual(shelves.map((shelf) => shelf.functionalProfile.shelfCapacity), [24, 30, 36, 90, 120]);
  assert.deepEqual(shelves.map((shelf) => shelf.functionalProfile.cabinetDoors), [0, 0, 0, 6, 6]);
  assert.deepEqual(shelves.map((shelf) => shelf.wallSnap.enabled), [false, false, false, true, true]);
  for (const shelf of shelves) {
    assert.ok(existsSync(shelf.modelPath), shelf.modelPath);
    assert.deepEqual(shelf.authoredLodDistancesM, [0, 8, 18]);
  }
});

test('all 125 pieces are supplier items, owned placeables, and GLB placeables', () => {
  const itemAssets = new Set(PLACEABLE_ITEM_CATALOG.map((item) => item.assetId));
  for (const sku of PRO_SHOP_FURNITURE_SKUS) {
    assert.equal(sku.cat, 'decor');
    assert.ok(itemAssets.has(sku.placeableAssetId), sku.placeableAssetId);
    const placeable = placeableById(sku.placeableAssetId);
    assert.equal(placeable?.render?.kind, 'glb');
    assert.equal(placeable?.render?.path, sku.modelPath);
    assert.equal(placeable?.defaultState, 'sold');
  }
});
