import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLACEABLE_ITEM_CATALOG,
  placeableSpecBySkuId,
} from '../src/data/placeableItems.js';
import { arriveOrder, openBox } from '../src/sim/deliveries.js';
import {
  placeDecor, placeDecorFree, placeOrder, cancelOrder, removeDecor,
} from '../src/sim/shop.js';
import { reconcileInventory } from '../src/sim/inventoryLifecycle.js';
import { deserialize, newGame, serialize, snapshot, SAVE_VERSION } from '../src/sim/state.js';
import {
  bindPropertyInventory,
  ensurePropertyInventory,
  ownedPlaceableItem,
  placedPropertyItems,
  propertyInventoryTotals,
  sellOwnedItem,
  setPlacementComponentState,
} from '../src/sim/propertyInventory.js';

function assertConserved(state, label = 'property inventory') {
  for (const item of ensurePropertyInventory(state).items) {
    assert.equal(
      item.quantityOwned,
      item.quantityStored + item.quantityPlaced + item.quantityInTransit,
      `${label}: ${item.assetId} conserves every owned unit`,
    );
  }
}

test('the production placeable catalog separates durable property assets from retail stock', () => {
  assert.ok(PLACEABLE_ITEM_CATALOG.length >= 127);
  for (const spec of PLACEABLE_ITEM_CATALOG) {
    assert.match(spec.assetId, /^(shop-decor:|pro-shop-furniture:|ceiling-light:)/);
    assert.ok(spec.displayName.length > 3);
    assert.ok(spec.category.length > 3);
    assert.ok(spec.purchasePrice > 0);
    assert.ok(spec.sellValue > 0 && spec.sellValue < spec.purchasePrice);
    assert.equal(spec.variants.length, 1);
    assert.ok(spec.placementRestrictions.mounts.length >= 1);
    assert.deepEqual(spec.placementRestrictions.propertyAreas, ['clubhouse']);
    assert.equal(spec.deliveryRequirement.physicalReceiving, true);
    assert.ok(spec.unlockRequirement.shopTier >= 1);
  }
  assert.equal(PLACEABLE_ITEM_CATALOG.filter((spec) => spec.assetId.startsWith('shop-decor:')).length, 6);
  assert.equal(PLACEABLE_ITEM_CATALOG.filter((spec) => spec.assetId.startsWith('ceiling-light:')).length, 6);
});

test('a paid decor order enters property ownership in transit and cancellation unwinds it once', () => {
  const state = newGame('relaxed', 111);
  state.cash = 10000;
  const beforeCash = state.cash;
  const ordered = placeOrder(state, 'rug1', 1);
  assert.equal(ordered.ok, true);

  const item = ownedPlaceableItem(state, 'rug1');
  assert.ok(item.id.startsWith('owned-item:'));
  assert.equal(item.quantityOwned, 1);
  assert.equal(item.quantityInTransit, 1);
  assert.equal(item.quantityStored, 0);
  assert.equal(item.quantityPlaced, 0);
  assert.equal(item.propertyId, 'property:111');
  assertConserved(state);

  const cancelled = cancelOrder(state, ordered.order.id);
  assert.equal(cancelled.ok, true);
  assert.equal(state.cash, beforeCash);
  assert.equal(item.quantityOwned, 0);
  assert.equal(item.quantityInTransit, 0);
  assert.equal(cancelOrder(state, ordered.order.id).ok, false, 'the same order cannot refund twice');
  assertConserved(state);
});

test('physical receiving moves a property item from transit to storage before authored placement', () => {
  const state = newGame('relaxed', 222);
  state.cash = 10000;
  const ordered = placeOrder(state, 'plant1', 1);
  assert.equal(ordered.ok, true);

  // The production delivery tick removes the order before unloading it.
  state.shop.orders = state.shop.orders.filter((entry) => entry.id !== ordered.order.id);
  const [box] = arriveOrder(state, ordered.order);
  assert.ok(box);
  let item = ownedPlaceableItem(state, 'plant1');
  assert.equal(item.quantityInTransit, 1, 'a sealed carton is not selectable storage');
  assert.equal(state.shop.inventory.plant1.back, 0);

  const opened = openBox(state, box.id);
  assert.equal(opened.ok, true);
  item = ownedPlaceableItem(state, 'plant1');
  assert.equal(item.quantityInTransit, 0);
  assert.equal(item.quantityStored, 1);
  assert.equal(state.shop.inventory.plant1.back, 1);
  assert.equal(
    reconcileInventory(state, { qa: true, context: 'employee-placeable-unpack' }).ok,
    true,
    'staff unpacking and the lot ledger must agree before the carton is discarded',
  );

  const placed = placeDecor(state, 'plant1', 0);
  assert.equal(placed.ok, true);
  assert.match(placed.placement.id, /^placement:/);
  assert.equal(item.quantityStored, 0);
  assert.equal(item.quantityPlaced, 1);
  assert.equal(state.shop.inventory.plant1.back, 0);
  assert.equal(state.shop.reno.decor[0].placementId, placed.placement.id);

  const packed = removeDecor(state, 'plant1', 0);
  assert.equal(packed.ok, true);
  assert.equal(item.quantityStored, 1);
  assert.equal(item.quantityPlaced, 0);
  assert.equal(state.shop.inventory.plant1.back, 1);
  assertConserved(state);
});

test('placement identity, property ownership, and counts survive save/load', () => {
  const state = newGame('relaxed', 333, { propertyId: 'cedar-ridge' });
  state.shop.inventory.board1.back = 1; // compatibility import from an old physical backroom count
  const placed = placeDecor(state, 'board1', 1);
  assert.equal(placed.ok, true);
  const placementId = placed.placement.id;

  const loaded = deserialize(serialize(state));
  const inventory = ensurePropertyInventory(loaded);
  const item = ownedPlaceableItem(loaded, 'board1');
  assert.equal(loaded.version, SAVE_VERSION);
  assert.equal(loaded.property.id, 'cedar-ridge');
  assert.equal(inventory.propertyId, 'cedar-ridge');
  assert.equal(item.propertyId, 'cedar-ridge');
  assert.equal(item.quantityOwned, 1);
  assert.equal(item.quantityPlaced, 1);
  assert.equal(item.quantityStored, 0);
  assert.equal(placedPropertyItems(loaded)[0].id, placementId);
  assert.equal(loaded.shop.reno.decor[0].placementId, placementId);
  assertConserved(loaded, 'reloaded property inventory');
});

test('multiple free furniture placements retain their render links across save/load', () => {
  const state = newGame('relaxed', 335, { propertyId: 'willow-creek' });
  state.shop.inventory.plant1.back = 2;
  const first = placeDecorFree(state, 'plant1', {
    area: 'clubhouse', mount: 'floor', x: -2, y: 0, z: 1, ry: 0,
    surfaceId: 'test:free-placement:first', authoredSpot: null,
  });
  const second = placeDecorFree(state, 'plant1', {
    area: 'clubhouse', mount: 'floor', x: 2, y: 0, z: 1, ry: Math.PI / 2,
    surfaceId: 'test:free-placement:second', authoredSpot: null,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const loaded = deserialize(serialize(state));
  assert.deepEqual(
    loaded.shop.reno.decor.map(({ skuId, spot, placementId }) => ({ skuId, spot, placementId })),
    state.shop.reno.decor.map(({ skuId, spot, placementId }) => ({ skuId, spot, placementId })),
  );
  assert.deepEqual(
    placedPropertyItems(loaded).map(({ id, pose }) => ({ id, pose })),
    placedPropertyItems(state).map(({ id, pose }) => ({ id, pose })),
  );
});

test('authored furniture component states are sanitized and survive save/load', () => {
  const state = newGame('relaxed', 334);
  state.shop.inventory.board1.back = 1;
  const placed = placeDecor(state, 'board1', 0);
  assert.equal(placed.ok, true);
  assert.equal(setPlacementComponentState(
    state, placed.placement.id, 'Drawer_Left_Top', true,
  ).ok, true);
  assert.equal(setPlacementComponentState(
    state, placed.placement.id, 'CabinetDoor_Left', false,
  ).ok, true);
  assert.equal(setPlacementComponentState(
    state, placed.placement.id, '../unsafe', true,
  ).ok, false);

  const loaded = deserialize(serialize(state));
  assert.deepEqual(placedPropertyItems(loaded)[0].componentStates, {
    Drawer_Left_Top: true,
    CabinetDoor_Left: false,
  });
});

test('selling a stored property item pays once and records the dedicated ledger line', () => {
  const state = newGame('relaxed', 444);
  state.shop.inventory.rug1.back = 1;
  const imported = placeDecor(state, 'rug1', 0);
  assert.equal(imported.ok, true);
  assert.equal(removeDecor(state, 'rug1', 0).ok, true);
  const item = ownedPlaceableItem(state, 'rug1');
  const beforeCash = state.cash;

  const sold = sellOwnedItem(state, item.id, { operationId: 'sell:rug:1' });
  assert.equal(sold.ok, true);
  assert.equal(sold.payout, placeableSpecBySkuId('rug1').sellValue);
  assert.equal(state.cash, beforeCash + sold.payout);
  assert.equal(state.ledger.today.revenue.assetSales, sold.payout);
  assert.equal(item.quantityOwned, 0);
  assert.equal(item.quantityStored, 0);

  const replay = sellOwnedItem(state, item.id, { operationId: 'sell:rug:1' });
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(state.cash, beforeCash + sold.payout, 'idempotent replay cannot pay twice');
  assert.equal(sellOwnedItem(state, item.id).ok, false, 'no physical unit remains to sell');
  assertConserved(state);
});

test('v10 decor, backroom stock, pending orders, and rent state migrate without duplication', () => {
  const source = newGame('relaxed', 555);
  source.cash = 10000;
  const pending = placeOrder(source, 'lounge1', 1);
  assert.equal(pending.ok, true);
  const raw = snapshot(source);
  raw.version = 10;
  delete raw.propertyInventory;
  raw.property = {
    id: 'legacy-willow',
    nextDueDay: 23,
    arrears: 170,
    missedTotal: 2,
    warnedFor: 21,
    paidTotal: 900,
  };
  raw.shop.inventory.plant1.back = 2;
  raw.shop.reno.decor = [{ skuId: 'plant1', spot: 0 }];

  const loaded = deserialize(raw);
  const plant = ownedPlaceableItem(loaded, 'plant1');
  const lounge = ownedPlaceableItem(loaded, 'lounge1');
  assert.equal(loaded.property.nextDueDay, 23, 'the existing rent schedule is preserved');
  assert.equal(loaded.property.arrears, 170);
  assert.equal(loaded.property.id, 'legacy-willow');
  assert.equal(plant.quantityOwned, 3);
  assert.equal(plant.quantityStored, 2);
  assert.equal(plant.quantityPlaced, 1);
  assert.equal(lounge.quantityOwned, 1);
  assert.equal(lounge.quantityInTransit, 1);
  assert.equal(ensurePropertyInventory(loaded).pendingDeliveries.length, 1);
  assert.match(loaded.shop.reno.decor[0].placementId, /^placement:/);

  const again = deserialize(serialize(loaded));
  assert.deepEqual(propertyInventoryTotals(again), propertyInventoryTotals(loaded));
  assert.equal(placedPropertyItems(again).length, 1);
  assertConserved(again, 'twice-loaded migrated inventory');
});

test('binding a holding rewrites every property ownership reference together', () => {
  const state = newGame('relaxed', 666);
  state.shop.inventory.poster1.back = 1;
  assert.equal(placeDecor(state, 'poster1', 0).ok, true);
  const inventory = bindPropertyInventory(state, 'international:scotland-01');
  assert.equal(state.property.id, 'international:scotland-01');
  assert.equal(inventory.propertyId, 'international:scotland-01');
  assert.ok(inventory.items.every((item) => item.propertyId === inventory.propertyId));
  assert.ok(inventory.placements.every((placement) => placement.propertyId === inventory.propertyId));
  assertConserved(state);
});

