import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_BOX_SURFACE_ID } from '../src/data/boxPlacementSurfaces.js';
import { FIXTURES } from '../src/data/shopLayout.js';
import { newGame, deserialize, serialize } from '../src/sim/state.js';
import {
  STARTER_CARTON_SPECS,
  STARTER_RESTOCK_VERSION,
  STARTER_RETAIL_ENTITLEMENT,
  STARTER_RETAIL_GROUPS,
  STARTER_RETAIL_SKU_IDS,
  STARTER_TIPPED_PACKAGES,
  ensureStarterRetailStock,
  starterRetailPresentation,
  starterRetailPresentationSnapshot,
  starterRetailQuantity,
} from '../src/sim/clubhouseStarterStock.js';
import { restorationSnapshot } from '../src/sim/clubhouseRestoration.js';
import { laptopReadiness, openingReadiness } from '../src/sim/campaign.js';
import { previewBoxPlacement } from '../src/sim/boxPlacement.js';
import { INVENTORY_STAGE } from '../src/sim/inventoryLifecycle.js';
import { routesIntact } from '../src/sim/layout.js';
import {
  cutTape,
  openFlap,
  takeFromBox,
} from '../src/sim/deliveries.js';
import { storeInBack } from '../src/sim/stocking.js';

const campaignState = (seed = 4811) => newGame('relaxed', seed, { campaign: true });

function authoredFixtureSkus(...fixtureIds) {
  return fixtureIds.flatMap((fixtureId) => {
    const fixture = FIXTURES.find((entry) => entry.id === fixtureId);
    assert.ok(fixture, `${fixtureId} remains an authored retail fixture`);
    return fixture.skus;
  });
}

function persistedStarterAuthority(state) {
  return {
    shelf: Object.fromEntries(STARTER_RETAIL_SKU_IDS.map((skuId) => [
      skuId,
      state.shop.inventory[skuId].shelf,
    ])),
    totals: Object.fromEntries(STARTER_RETAIL_SKU_IDS.map((skuId) => [
      skuId,
      starterRetailQuantity(state, skuId),
    ])),
    cartons: state.shop.deliveries.boxes
      .filter((box) => box.starterRestockVersion === STARTER_RESTOCK_VERSION)
      .map((box) => ({
        starterCartonId: box.starterCartonId,
        starterCartonOrdinal: box.starterCartonOrdinal,
        starterCartonCount: box.starterCartonCount,
        assortmentLabel: box.assortmentLabel,
        qty: box.qty,
        loc: box.loc,
        surfaceId: box.surfaceId,
        x: box.x,
        z: box.z,
        ry: box.ry,
        starterPlacement: box.starterPlacement,
        contents: box.contents.map((line) => ({
          lineId: line.lineId,
          skuId: line.skuId,
          quantity: line.quantity,
          remainingQuantity: line.remainingQuantity,
        })),
      })),
    lots: state.shop.inventoryLifecycle.lots
      .filter((lot) => typeof lot.lineId === 'string' && lot.lineId.startsWith('pine-hills-starter-'))
      .map((lot) => ({
        lineId: lot.lineId,
        skuId: lot.skuId,
        orderedQuantity: lot.orderedQuantity,
        buckets: { ...lot.buckets },
      })),
    presentation: starterRetailPresentationSnapshot(state),
  };
}

test('starter entitlement covers every SKU socket in its six authored retail groups', () => {
  assert.deepEqual(STARTER_RETAIL_GROUPS.balls, authoredFixtureSkus('shelf_balls'));
  assert.deepEqual(
    [...STARTER_RETAIL_GROUPS.accessories].sort(),
    authoredFixtureSkus('shelf_acc', 'member_station', 'feature').sort(),
  );
  assert.deepEqual(STARTER_RETAIL_GROUPS.headwear, authoredFixtureSkus('hatstand'));
  assert.deepEqual(
    STARTER_RETAIL_GROUPS.apparel,
    authoredFixtureSkus('shelf_small', 'table_polos', 'rail_outer'),
  );
  assert.deepEqual(STARTER_RETAIL_GROUPS.cooler, authoredFixtureSkus('cold_drinks'));
  assert.deepEqual(STARTER_RETAIL_GROUPS.snacks, authoredFixtureSkus('snackrack'));
});

test('fresh Pine Hills starts furnished with exact half-stock and three conserved cartons', () => {
  const state = campaignState();
  assert.equal(state.campaign.businessOpen, false);
  assert.equal(laptopReadiness(state).ready, true);
  assert.ok(Object.values(state.shop.reno.facilities).every(Boolean));
  assert.equal(state.shop.reno.starterRestockVersion, STARTER_RESTOCK_VERSION);

  for (const skuId of STARTER_RETAIL_SKU_IDS) {
    assert.equal(
      state.shop.inventory[skuId].shelf,
      Math.floor(STARTER_RETAIL_ENTITLEMENT[skuId] * 0.5),
      `${skuId} starts at half of its real fixture capacity`,
    );
    assert.equal(
      starterRetailQuantity(state, skuId),
      STARTER_RETAIL_ENTITLEMENT[skuId],
      `${skuId} entitlement is conserved across shelf and cartons`,
    );
  }

  for (const [groupId, skuIds] of Object.entries(STARTER_RETAIL_GROUPS)) {
    const shelfQuantity = skuIds.reduce((sum, skuId) => (
      sum + state.shop.inventory[skuId].shelf
    ), 0);
    const halfCapacity = skuIds.reduce((sum, skuId) => (
      sum + Math.floor(STARTER_RETAIL_ENTITLEMENT[skuId] * 0.5)
    ), 0);
    assert.equal(shelfQuantity, halfCapacity, `${groupId} starts at its integer half-capacity`);
  }

  const presentation = starterRetailPresentationSnapshot(state);
  const visibleInventory = STARTER_RETAIL_SKU_IDS.reduce((sum, skuId) => (
    sum + state.shop.inventory[skuId].shelf
  ), 0);
  assert.equal(presentation.visibleQuantity, visibleInventory);
  assert.equal(presentation.tippedPackages.length, 2);
  assert.deepEqual(
    presentation.tippedPackages.map(({ skuId, unitIndex }) => ({ skuId, unitIndex })),
    STARTER_TIPPED_PACKAGES.map(({ skuId, unitIndex }) => ({ skuId, unitIndex })),
  );
  for (const line of presentation.lines) {
    assert.equal(line.visibleQuantity, state.shop.inventory[line.skuId].shelf);
    assert.equal(new Set(line.slotIndices).size, line.visibleQuantity);
    assert.ok(line.slotIndices.every((slotIndex) => slotIndex >= 0 && slotIndex < line.capacity));
    const occupied = new Set(line.slotIndices);
    assert.ok(
      line.slotIndices.some((slotIndex) => slotIndex + 1 < line.capacity && !occupied.has(slotIndex + 1)),
      `${line.skuId} half-stock leaves a deliberate internal gap`,
    );
    const full = starterRetailPresentation(state, line.skuId, line.capacity);
    assert.deepEqual(
      [...full.slotIndices].sort((a, b) => a - b),
      Array.from({ length: line.capacity }, (_, slotIndex) => slotIndex),
      `${line.skuId} normal restocking fills every authored socket`,
    );
  }
  assert.equal(starterRetailPresentation(state, 'balls1', 0).items.some((item) => item.tip), false);

  const cartons = state.shop.deliveries.boxes.filter((box) => (
    box.starterRestockVersion === STARTER_RESTOCK_VERSION
  ));
  assert.equal(cartons.length, 3);
  assert.deepEqual(cartons.map((box) => box.starterCartonId), STARTER_CARTON_SPECS.map((spec) => spec.id));
  assert.deepEqual(cartons.map((box) => box.starterCartonOrdinal), [1, 2, 3]);
  assert.ok(cartons.every((box) => box.starterCartonCount === 3));
  assert.deepEqual(cartons.map((box) => box.assortmentLabel), STARTER_CARTON_SPECS.map((spec) => spec.label));
  assert.ok(cartons.every((box) => (
    box.loc === 'world'
    && box.inventoryOpened === false
    && box.cutProgress === 0
    && box.contents.length > 1
    && box.contents.reduce((sum, line) => sum + line.remainingQuantity, 0) === box.qty
  )));
  const lotById = new Map(state.shop.inventoryLifecycle.lots.map((lot) => [lot.id, lot]));
  const fixtureById = new Map(FIXTURES.map((fixture) => [fixture.id, fixture]));
  for (const carton of cartons) {
    const spec = STARTER_CARTON_SPECS.find((entry) => entry.id === carton.starterCartonId);
    assert.equal(carton.surfaceId, FLOOR_BOX_SURFACE_ID);
    assert.deepEqual(carton.starterPlacement, {
      kind: 'retail-adjacent-floor',
      validated: true,
      nearFixtureIds: spec.nearFixtureIds,
    });
    const distanceToRetail = Math.min(...spec.nearFixtureIds.map((fixtureId) => {
      const fixture = fixtureById.get(fixtureId);
      return Math.hypot(carton.x - fixture.x, carton.z - fixture.z);
    }));
    assert.ok(distanceToRetail <= 1.75, `${carton.starterCartonId} stays beside its retail group`);
    const placement = previewBoxPlacement(state, carton, {
      kind: 'surface',
      surfaceId: carton.surfaceId,
      x: carton.x,
      z: carton.z,
      ry: carton.ry,
    });
    assert.equal(placement.ok, true, placement.reason);
    for (const content of carton.contents) {
      const lot = lotById.get(content.lotId);
      assert.ok(lot, `${content.lineId} retains its inventory lot`);
      assert.equal(lot.skuId, content.skuId);
      assert.equal(
        lot.buckets[INVENTORY_STAGE.DELIVERED_UNOPENED],
        content.remainingQuantity,
        `${content.skuId} carton quantity is backed by its unopened lifecycle bucket`,
      );
    }
  }
  assert.equal(routesIntact(state), true);
  const readiness = openingReadiness(state);
  const routeRequirement = readiness.requirements.find((entry) => entry.id === 'routes');
  assert.equal(routeRequirement?.ok, true, routeRequirement?.reason);
  assert.deepEqual(readiness.blockingBoxes, []);
  assert.equal(restorationSnapshot(state).counts.restockCompleted, 0);
});

test('starter entitlement is idempotent through direct ensure and save/load', () => {
  const state = campaignState(4812);
  const authorityBeforeSave = persistedStarterAuthority(state);
  const before = JSON.stringify({
    inventory: state.shop.inventory,
    boxes: state.shop.deliveries.boxes,
    lots: state.shop.inventoryLifecycle.lots,
  });
  const cashBefore = state.cash;
  assert.equal(ensureStarterRetailStock(state).changed, false);
  assert.equal(state.cash, cashBefore, 'the conveyed entitlement never debits or credits operating cash');
  assert.equal(JSON.stringify({
    inventory: state.shop.inventory,
    boxes: state.shop.deliveries.boxes,
    lots: state.shop.inventoryLifecycle.lots,
  }), before);

  const loaded = deserialize(serialize(state));
  assert.deepEqual(
    persistedStarterAuthority(loaded),
    authorityBeforeSave,
    'save/load preserves every shelf projection, lifecycle bucket, total, and starter carton',
  );
  assert.equal(ensureStarterRetailStock(loaded).changed, false);
  assert.equal(
    loaded.shop.deliveries.boxes.filter((box) => box.starterRestockVersion === 1).length,
    3,
  );
  for (const skuId of STARTER_RETAIL_SKU_IDS) {
    assert.equal(starterRetailQuantity(loaded, skuId), STARTER_RETAIL_ENTITLEMENT[skuId]);
  }
});

test('starter cartons remain placement-valid across deterministic neglected-shop seeds', () => {
  for (const seed of [4, 37, 9999]) {
    const state = campaignState(seed);
    const cartons = state.shop.deliveries.boxes.filter((box) => (
      box.starterRestockVersion === STARTER_RESTOCK_VERSION
    ));
    assert.equal(cartons.length, 3, `seed ${seed}`);
    for (const carton of cartons) {
      assert.equal(carton.starterPlacement?.validated, true, `${seed}:${carton.starterCartonId}`);
      const result = previewBoxPlacement(state, carton, {
        kind: 'surface',
        surfaceId: carton.surfaceId,
        x: carton.x,
        z: carton.z,
        ry: carton.ry,
      });
      assert.equal(result.ok, true, `${seed}:${carton.starterCartonId}: ${result.reason}`);
    }
    assert.equal(routesIntact(state), true, `seed ${seed} preserves required routes`);
  }
});

test('mixed starter cartons expose one conserved SKU at a time through normal unboxing', () => {
  const state = campaignState(4813);
  const box = state.shop.deliveries.boxes.find((entry) => entry.starterCartonId === 'balls-accessories');
  assert.ok(box);
  assert.equal(cutTape(state, box.id, 1).ok, true);
  for (let flap = 0; flap < 2; flap += 1) {
    assert.equal(openFlap(state, box.id, 1).ok, true);
  }

  const firstSkuId = box.contents.find((entry) => entry.remainingQuantity > 0).skuId;
  const firstQuantity = box.contents
    .filter((entry) => entry.skuId === firstSkuId)
    .reduce((sum, entry) => sum + entry.remainingQuantity, 0);
  let removed = 0;
  while (removed < firstQuantity) {
    const result = takeFromBox(state, box.id);
    assert.equal(result.ok, true);
    assert.equal(result.skuId, firstSkuId);
    removed += result.taken;
    assert.equal(storeInBack(state).ok, true);
  }

  const nextSkuId = box.contents.find((entry) => entry.remainingQuantity > 0).skuId;
  assert.notEqual(nextSkuId, firstSkuId);
  const next = takeFromBox(state, box.id, 1);
  assert.equal(next.ok, true);
  assert.equal(next.skuId, nextSkuId);
  assert.equal(next.taken, 1);
});
