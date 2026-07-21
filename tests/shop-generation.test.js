import test from 'node:test';
import assert from 'node:assert/strict';

import { placeableSpecBySkuId } from '../src/data/placeableItems.js';
import { newEmpire, initPropertyState } from '../src/sim/empire.js';
import {
  buyFixtureReplacement,
  commitPlacement,
  fixtureOwnershipEntries,
  placedFixtures,
  restoreFixture,
  routesIntact,
  sellStoredFixture,
  storeFixture,
} from '../src/sim/layout.js';
import { resolvedOfficeLayout } from '../src/data/shopLayout.js';
import { ownedPlaceableItem, propertyInventoryTotals } from '../src/sim/propertyInventory.js';
import { removeDecorPlacement, sellStoredDecor } from '../src/sim/shop.js';
import { initializeGeneratedShop } from '../src/sim/shopGeneration.js';
import { shopPropertyImprovementValue } from '../src/sim/shopProgression.js';
import {
  COURSE_SHOP_LEVELS,
  COURSE_SHOP_PROFILES,
  SHOP_REFERENCE_SOURCES,
  generateShopDefinition,
} from '../src/sim/shopGenerator.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';

test('the same property seed produces the exact same hand-composed shop', () => {
  const input = { seed: 73192, propertyId: 'repeatable-lodge', courseLevel: 3 };
  assert.deepEqual(generateShopDefinition(input), generateShopDefinition(input));
});

test('all five course profiles carry distinct authored identities and use all supplied references', () => {
  const generated = COURSE_SHOP_LEVELS.map((courseLevel) => (
    generateShopDefinition({ seed: 8123, propertyId: `course-${courseLevel}`, courseLevel })
  ));
  assert.equal(new Set(generated.map((entry) => entry.layoutFamily)).size, 5);
  assert.equal(new Set(generated.map((entry) => entry.profileId)).size, 5);
  assert.equal(new Set(generated.map((entry) => entry.checkout.variant)).size, 5);
  assert.equal(new Set(generated.map((entry) => entry.fingerprint)).size, 5);
  for (const entry of generated) {
    assert.deepEqual(entry.referenceFiles, SHOP_REFERENCE_SOURCES.map((source) => source.file));
    assert.ok(entry.rooms.office.variant);
    assert.ok(entry.rooms.storage.variant);
    assert.ok(entry.palette.wall !== entry.palette.accent);
    assert.ok(entry.lighting.family);
  }
});

test('seeded variation does not collapse properties back onto a repeated layout', () => {
  for (const courseLevel of COURSE_SHOP_LEVELS) {
    const fingerprints = new Set();
    const poseSignatures = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const generated = generateShopDefinition({
        seed: seed * 7919,
        propertyId: `level-${courseLevel}-property-${seed}`,
        courseLevel,
      });
      fingerprints.add(generated.fingerprint);
      poseSignatures.add(JSON.stringify(generated.fixturePoses));
    }
    assert.equal(fingerprints.size, 40, `course ${courseLevel} has unique whole-shop fingerprints`);
    assert.ok(poseSignatures.size >= 20, `course ${courseLevel} varies physical fixture placement`);
  }
});

test('the reference quality ladder drives increasingly complete starting merchandising', () => {
  const generated = COURSE_SHOP_LEVELS.map((courseLevel) => (
    generateShopDefinition({ seed: 99117, propertyId: `ladder-${courseLevel}`, courseLevel })
  ));
  for (let index = 1; index < generated.length; index++) {
    assert.ok(
      generated[index].merchandising.productLineCount > generated[index - 1].merchandising.productLineCount,
      `course ${index + 1} starts with more product lines than course ${index}`,
    );
    assert.ok(
      generated[index].lighting.fixtureCount > generated[index - 1].lighting.fixtureCount,
      `course ${index + 1} has a richer light plan than course ${index}`,
    );
  }
  assert.match(COURSE_SHOP_PROFILES[1].furnitureStory, /old|painted|wire/i);
  assert.match(COURSE_SHOP_PROFILES[3].furnitureStory, /walnut|timber|stone/i);
  assert.match(COURSE_SHOP_PROFILES[5].furnitureStory, /bespoke|brass|executive/i);
});

test('course identity controls starting cleanup and guarantees visible hero product lines', () => {
  const averages = [];
  for (const courseLevel of COURSE_SHOP_LEVELS) {
    const state = newGame('relaxed', 61000 + courseLevel, { propertyId: `condition-${courseLevel}` });
    const generated = initializeGeneratedShop(state, {
      id: `condition-${courseLevel}`, seed: 62000 + courseLevel, shopLevel: courseLevel,
    });
    averages.push(state.shop.reno.grime.reduce((sum, value) => sum + value, 0) / state.shop.reno.grime.length);
    if (courseLevel >= 2) {
      assert.equal(state.shop.reno.debrisSeeded, true);
      assert.deepEqual(state.shop.reno.debris, []);
    }
    if (courseLevel >= 3) assert.equal(state.shop.reno.clutter.every((pile) => pile.cleared), true);
    const shelf = generated.merchandising.shelfInventory;
    assert.ok(shelf.balls1 || shelf.balls2 || shelf.balls3);
    assert.ok(shelf.cap1);
    if (courseLevel >= 3) {
      assert.ok(shelf.polo2);
      assert.ok(shelf.jacket2);
      assert.ok(shelf.range2);
    }
  }
  for (let index = 1; index < averages.length; index++) {
    assert.ok(averages[index] < averages[index - 1]);
  }
});

test('every course-level shop installs through normal layout safety with a distinct live floor', () => {
  const signatures = new Set();
  for (const courseLevel of COURSE_SHOP_LEVELS) {
    const state = newGame('relaxed', 22000 + courseLevel, { propertyId: `safe-${courseLevel}` });
    const generated = initializeGeneratedShop(state, {
      id: `safe-${courseLevel}`,
      seed: 33000 + courseLevel,
      shopLevel: courseLevel,
    });
    assert.equal(generated.courseLevel, courseLevel);
    assert.equal(generated.audit.routesIntact, true);
    assert.equal(routesIntact(state), true);
    assert.ok(generated.audit.acceptedFixturePoses.length >= 1);
    signatures.add(JSON.stringify(placedFixtures(state).map(({ id, x, z, ry }) => ({ id, x, z, ry }))));
  }
  assert.equal(signatures.size, 5);
});

test('the launch marketplace maps real properties onto all five course shop identities', () => {
  const empire = newEmpire('relaxed', 424242);
  assert.deepEqual(
    [...new Set(empire.market.map((property) => property.shopLevel))].sort(),
    COURSE_SHOP_LEVELS,
  );
  const willow = empire.market.find((property) => property.id === 'willow-creek');
  const lodge = empire.market.find((property) => property.id === 'bent-pines');
  const resort = empire.market.find((property) => property.id === 'saltgrass-point');
  const boutique = empire.market.find((property) => property.id === 'thornbury-estate');
  assert.equal(willow.shopLevel, 1);
  assert.equal(lodge.shopLevel, 3);
  assert.equal(resort.shopLevel, 4);
  assert.equal(boutique.shopLevel, 5);
});

test('generated decor enters real property ownership and can be packed, sold, and replaced', () => {
  const state = newGame('relaxed', 55443, { propertyId: 'decor-boutique' });
  const generated = initializeGeneratedShop(state, {
    id: 'decor-boutique', seed: 55443, shopLevel: 5,
  });
  const entry = generated.decor[0];
  const placementId = generated.audit.decorPlacements[0];
  const item = ownedPlaceableItem(state, entry.skuId);
  assert.ok(item);
  assert.equal(item.quantityPlaced, 1);
  assert.equal(propertyInventoryTotals(state).placed, generated.decor.length);

  const packed = removeDecorPlacement(state, placementId);
  assert.equal(packed.ok, true);
  assert.equal(item.quantityPlaced, 0);
  assert.equal(item.quantityStored, 1);
  const beforeCash = state.cash;
  const sold = sellStoredDecor(state, entry.skuId, 'generated-decor-sale');
  assert.equal(sold.ok, true);
  assert.equal(sold.payout, placeableSpecBySkuId(entry.skuId).sellValue);
  assert.equal(state.cash, beforeCash + sold.payout);

  // The production supplier catalog remains the replacement source after the
  // conveyed item is sold; it is not a one-off generator-only object.
  const replacement = placeableSpecBySkuId(entry.skuId);
  assert.ok(replacement.purchasePrice > replacement.sellValue);
  assert.equal(replacement.assetId, item.assetId);
});

test('generated fixtures can be stored, sold, bought back, and returned to the floor', () => {
  const state = newGame('relaxed', 73113, { propertyId: 'fixture-ownership' });
  initializeGeneratedShop(state, { id: 'fixture-ownership', seed: 73113, shopLevel: 5 });
  const fixture = placedFixtures(state).find((entry) => entry.skus.length === 0);
  assert.ok(fixture);
  assert.equal(storeFixture(state, fixture.id), true);
  const stored = fixtureOwnershipEntries(state).find((entry) => entry.id === fixture.id);
  assert.equal(stored.status, 'stored');

  const cashBeforeSale = state.cash;
  const sold = sellStoredFixture(state, fixture.id, 'fixture-sale-once');
  assert.equal(sold.ok, true);
  assert.equal(state.cash, cashBeforeSale + stored.sellValue);
  const replay = sellStoredFixture(state, fixture.id, 'fixture-sale-once');
  assert.equal(replay.replay, true);
  assert.equal(state.cash, cashBeforeSale + stored.sellValue);
  assert.equal(fixtureOwnershipEntries(state).find((entry) => entry.id === fixture.id).status, 'sold');

  const replacement = fixtureOwnershipEntries(state).find((entry) => entry.id === fixture.id);
  const bought = buyFixtureReplacement(state, fixture.id, 'fixture-buy-once');
  assert.equal(bought.ok, true);
  assert.equal(bought.cost, replacement.purchasePrice);
  assert.equal(fixtureOwnershipEntries(state).find((entry) => entry.id === fixture.id).status, 'stored');
  assert.ok(restoreFixture(state, fixture.id));
  assert.ok(placedFixtures(state).some((entry) => entry.id === fixture.id));

  const loaded = deserialize(serialize(state));
  assert.ok(placedFixtures(loaded).some((entry) => entry.id === fixture.id));
  assert.equal(fixtureOwnershipEntries(loaded).find((entry) => entry.id === fixture.id).status, 'placed');
});

test('generated service rooms convey owned office furniture and a movable packing bench', () => {
  const state = newGame('relaxed', 88421, { propertyId: 'owned-service-rooms' });
  const generated = initializeGeneratedShop(state, {
    id: 'owned-service-rooms', seed: 88421, shopLevel: 5,
  });
  const serviceIds = ['office_desk', 'office_chair', 'office_filing', 'packing_bench'];
  const placed = new Map(placedFixtures(state).map((fixture) => [fixture.id, fixture]));
  const ownership = new Map(fixtureOwnershipEntries(state).map((entry) => [entry.id, entry]));
  for (const id of serviceIds) {
    assert.ok(placed.has(id), `${id} is physically installed`);
    assert.equal(placed.get(id).x * 4, Math.round(placed.get(id).x * 4), `${id} x is build-grid native`);
    assert.equal(placed.get(id).z * 4, Math.round(placed.get(id).z * 4), `${id} z is build-grid native`);
    assert.equal(ownership.get(id)?.status, 'placed', `${id} is owned`);
    assert.ok(
      generated.generatedObjects.some((entry) => entry.sourceId === id && entry.sellable && entry.replaceable),
      `${id} is declared sellable and replaceable`,
    );
  }

  const before = resolvedOfficeLayout(state);
  commitPlacement(state, 'office_desk', before.desk.x + 0.25, before.desk.z, before.desk.ry);
  const moved = resolvedOfficeLayout(state);
  const movedBy = moved.desk.x - before.desk.x;
  assert.notEqual(movedBy, 0);
  assert.equal(moved.laptop.x, before.laptop.x + movedBy, 'the laptop follows the owned desk');
  assert.equal(moved.lamp.x, before.lamp.x + movedBy, 'desk dressing follows the owned desk');
  assert.equal(moved.phone.x, before.phone.x + movedBy, 'the telephone follows the owned desk');
});

test('the conveyed starting shop does not create an instant appraisal windfall', () => {
  const empire = newEmpire('relaxed', 424242);
  for (const property of empire.market) {
    const state = initPropertyState(property, 'relaxed');
    assert.equal(
      shopPropertyImprovementValue(state),
      0,
      `${property.id} starts with its generated shop already included in the conveyance`,
    );
  }
});

test('generated layout, stock, decor ownership, and fingerprint survive save/load exactly', () => {
  const empire = newEmpire('relaxed', 90125);
  const property = empire.market.find((entry) => entry.id === 'bent-pines');
  const state = initPropertyState(property, 'relaxed');
  const before = {
    generation: structuredClone(state.shop.generation),
    fixtures: placedFixtures(state),
    totals: propertyInventoryTotals(state),
    shelf: Object.fromEntries(Object.entries(state.shop.inventory).map(([id, entry]) => [id, entry.shelf])),
  };
  const loaded = deserialize(serialize(state));
  assert.deepEqual(loaded.shop.generation, before.generation);
  assert.deepEqual(placedFixtures(loaded), before.fixtures);
  assert.deepEqual(propertyInventoryTotals(loaded), before.totals);
  assert.deepEqual(
    Object.fromEntries(Object.entries(loaded.shop.inventory).map(([id, entry]) => [id, entry.shelf])),
    before.shelf,
  );
  assert.equal(routesIntact(loaded), true);
});
