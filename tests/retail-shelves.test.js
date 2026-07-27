import test from 'node:test';
import assert from 'node:assert/strict';

import { placeableSpecBySkuId } from '../src/data/placeableItems.js';
import { INTERIOR } from '../src/data/shopLayout.js';
import { homeFixture } from '../src/data/fixtureSlots.js';
import {
  placementRetailShelfStock,
  placementRetailShelfStorage,
  placedPropertyItems,
  setPlacementLightPower,
} from '../src/sim/propertyInventory.js';
import { snapPlaceablePose, validatePlaceablePlacement } from '../src/sim/propertyPlacement.js';
import {
  retailShelfAssignedUnits,
  retailShelfAssignments,
  retailShelfPlacementSummary,
  retailShelfStorageAssignments,
  retailShelfStorageSummary,
  storeRetailShelfCabinet,
  stockRetailShelf,
  takeFromRetailShelfCabinet,
  takeFromRetailShelf,
} from '../src/sim/retailShelfStocking.js';
import { moveInventory, adoptExternalInventory, INVENTORY_STAGE } from '../src/sim/inventoryLifecycle.js';
import { setCarry } from '../src/sim/stocking.js';
import { placeDecorFree, removeDecorPlacement } from '../src/sim/shop.js';
import { storeFixture } from '../src/sim/layout.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';

const BASIC_SHELF_SKU = 'furn-freestanding-shelving-basic';
const HIGH_END_SHELF_SKU = 'furn-freestanding-shelving-luxury';
const LUXURY_SHELF_SKU = 'furn-freestanding-shelving-executive';

function placeShelf(state, skuId = BASIC_SHELF_SKU) {
  state.shop.inventory[skuId].back = 1;
  const result = placeDecorFree(state, skuId, {
    area: 'clubhouse', mount: 'floor', x: -4, y: 0, z: 0,
    ry: 0, surfaceId: 'clubhouse:floor', authoredSpot: null,
  });
  assert.equal(result.ok, true);
  return result.placement;
}

function carryExternal(state, skuId, quantity) {
  const adopted = adoptExternalInventory(state, {
    skuId, quantity, stage: INVENTORY_STAGE.RESERVE,
    note: 'Retail shelving test product',
  });
  assert.equal(adopted.ok, true);
  setCarry(state, skuId, quantity, adopted.allocations);
}

test('placed retail shelves conserve carried inventory and persist authored zone assignments', () => {
  const state = newGame('relaxed', 7711);
  const placement = placeShelf(state);
  carryExternal(state, 'balls2', 2);
  const before = state.shop.inventory.balls2.shelf;

  const stocked = stockRetailShelf(state, placement.id, 1);
  assert.equal(stocked.ok, true);
  assert.equal(stocked.zoneName, 'SHELF_ZONE_01');
  assert.equal(state.shop.inventory.balls2.shelf, before + 1);
  assert.equal(state.shop.carry.qty, 1);
  assert.equal(retailShelfAssignedUnits(state, 'balls2'), 1);
  assert.deepEqual(retailShelfPlacementSummary(state, placement.id), {
    units: 1, capacity: 24, usedZones: 1, zoneCount: 3,
  });

  // The dynamic shelf remains a physical display even if the product's legacy
  // fixed fixture is stored before the save.
  assert.equal(storeFixture(state, homeFixture('balls2').id), true);

  const loaded = deserialize(serialize(state));
  const loadedPlacement = placedPropertyItems(loaded).find((entry) => entry.id === placement.id);
  assert.ok(loadedPlacement);
  assert.deepEqual(retailShelfAssignments(loaded, placement.id), [{
    zoneName: 'SHELF_ZONE_01', skuId: 'balls2', quantity: 1, capacity: 8,
  }]);
  assert.equal(placementRetailShelfStock(loaded, placement.id).schemaVersion, 1);
  assert.equal(loaded.shop.inventory.balls2.shelf, before + 1);

  const taken = takeFromRetailShelf(loaded, placement.id, 1);
  assert.equal(taken.ok, true);
  assert.equal(loaded.shop.inventory.balls2.shelf, before);
  assert.equal(loaded.shop.carry.qty, 2);
  assert.equal(retailShelfAssignedUnits(loaded, 'balls2'), 0);
});

test('stocked furniture cannot be packed and specialized club merchandise is refused', () => {
  const state = newGame('relaxed', 7712);
  const placement = placeShelf(state);
  carryExternal(state, 'range2', 1);
  assert.equal(stockRetailShelf(state, placement.id, 1).ok, true);
  const blocked = removeDecorPlacement(state, placement.id);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /empty this shelf/i);

  // Move the test rangefinder back to reserve, then prove tall clubs retain
  // their specialized rack contract rather than being shrunk onto a shelf.
  assert.equal(takeFromRetailShelf(state, placement.id, 1).ok, true);
  const current = state.shop.carry;
  const parked = moveInventory(state, {
    from: INVENTORY_STAGE.RESERVE, to: INVENTORY_STAGE.DISPOSED_LOST,
    quantity: current.qty, skuId: current.skuId, allocations: current.allocations,
    reason: 'Test cleanup',
  });
  assert.equal(parked.ok, true);
  setCarry(state, current.skuId, 0);
  carryExternal(state, 'driver1', 1);
  const refused = stockRetailShelf(state, placement.id, 1);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /specialized display/i);
});

test('display-wall cabinets conserve reserve inventory, persist authored storage zones, and block packing', () => {
  const state = newGame('relaxed', 7715);
  const placement = placeShelf(state, HIGH_END_SHELF_SKU);
  carryExternal(state, 'balls2', 2);
  const beforeBack = state.shop.inventory.balls2.back;

  const stored = storeRetailShelfCabinet(
    state, placement.id, 'STORAGE_ZONE_Bay02_Level01', 1,
  );
  assert.equal(stored.ok, true);
  assert.equal(stored.zoneName, 'STORAGE_ZONE_Bay02_Level01');
  assert.equal(state.shop.inventory.balls2.back, beforeBack + 1);
  assert.equal(state.shop.carry.qty, 1);
  assert.deepEqual(retailShelfStorageSummary(state, placement.id), {
    units: 1, capacity: 36, usedZones: 1, zoneCount: 6,
  });
  assert.deepEqual(placementRetailShelfStorage(state, placement.id).zones, {
    STORAGE_ZONE_Bay02_Level01: { skuId: 'balls2', quantity: 1, capacity: 6 },
  });
  const blocked = removeDecorPlacement(state, placement.id);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /cabinet product/i);

  const loaded = deserialize(serialize(state));
  assert.deepEqual(retailShelfStorageAssignments(loaded, placement.id), [{
    zoneName: 'STORAGE_ZONE_Bay02_Level01', skuId: 'balls2', quantity: 1, capacity: 6,
  }]);
  const taken = takeFromRetailShelfCabinet(
    loaded, placement.id, 'STORAGE_ZONE_Bay02_Level01', 1,
  );
  assert.equal(taken.ok, true);
  assert.equal(loaded.shop.inventory.balls2.back, beforeBack);
  assert.equal(loaded.shop.carry.qty, 2);
  assert.deepEqual(retailShelfStorageAssignments(loaded, placement.id), []);
});

test('built-in display lighting exposes a saved off/on state', () => {
  const state = newGame('relaxed', 7716);
  const placement = placeShelf(state, LUXURY_SHELF_SKU);
  const spec = placeableSpecBySkuId(LUXURY_SHELF_SKU);
  assert.equal(spec.lightingProfile.runtimeLights, 3);
  assert.equal(placement.lightState.isOn, true);
  assert.equal(setPlacementLightPower(state, placement.id, false).ok, true);
  const loaded = deserialize(serialize(state));
  const restored = placedPropertyItems(loaded).find((entry) => entry.id === placement.id);
  assert.equal(restored.lightState.isOn, false);
  assert.equal(setPlacementLightPower(loaded, placement.id, true).ok, true);
  assert.equal(restored.lightState.isOn, true);
});

test('high-end display walls snap their authored rear anchor to usable wall segments', () => {
  const state = newGame('relaxed', 7713);
  const spec = placeableSpecBySkuId(HIGH_END_SHELF_SKU);
  assert.equal(spec.wallSnap.enabled, true);
  const pose = snapPlaceablePose(spec, { x: -5, z: -6.35 }, 0.7);
  assert.equal(pose.mount, 'floor');
  assert.match(pose.surfaceId, /^wall:north:/);
  assert.equal(pose.ry, 0);
  const northWall = -INTERIOR.d / 2 + 0.02;
  assert.ok(Math.abs(pose.z - (
    northWall + spec.wallSnap.surfaceOffset + spec.wallSnap.anchorDepth
  )) < 1e-9);

  const tampered = { ...pose, z: pose.z + 0.2 };
  const invalid = validatePlaceablePlacement(state, spec, tampered);
  assert.ok(invalid.reasons.some((reason) => /not flush/i.test(reason)));
});

test('luxury wall snap keeps its complete authored envelope inside the clubhouse', () => {
  const state = newGame('relaxed', 7714);
  const spec = placeableSpecBySkuId(LUXURY_SHELF_SKU);
  const pose = snapPlaceablePose(spec, { x: -0.5, z: -6.35 }, 0.7);
  const validation = validatePlaceablePlacement(state, spec, pose);
  assert.equal(validation.reasons.some((reason) => /wall/i.test(reason)), false,
    validation.reasons.join('; '));
  assert.ok(validation.rect.minZ >= -INTERIOR.d / 2);
});
