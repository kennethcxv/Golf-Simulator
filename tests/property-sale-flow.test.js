import test from 'node:test';
import assert from 'node:assert/strict';

import {
  newEmpire, buyProperty, activeState, requestPropertyAppraisal, confirmPropertySale,
  serializeEmpire, deserializeEmpire,
} from '../src/sim/empire.js';
import { empireUpdate } from '../src/sim/empire.js';
import { PROPERTY_TIER_ORDER, PROPERTY_TIERS } from '../src/sim/propertyProgression.js';

function restoreRealState(state) {
  state.shop.reno.grime.fill(0);
  state.shop.reno.windows.fill(0);
  for (const item of state.shop.reno.clutter) item.cleared = true;
  const exterior = state.shop.reno.exterior;
  if (exterior) {
    exterior.weeds.fill(0);
    exterior.gutter = 0;
    exterior.cobwebs = 0;
    exterior.light = 0;
  }
  for (const surface of Object.values(state.shop.reno.wash || {})) surface.grime.fill(0);
  for (const item of state.props.litter) item.cleared = true;
  state.props.teeSignFixed = true;
  state.tractor.repaired = true;
}

test('the four property tiers are data-driven and ordered', () => {
  assert.deepEqual(PROPERTY_TIER_ORDER, ['neglectedPublic', 'establishedLocal', 'resortStyle', 'premiumPrivate']);
  for (const id of PROPERTY_TIER_ORDER) {
    const tier = PROPERTY_TIERS[id];
    for (const key of ['purchasePrice', 'startingCondition', 'holeCount', 'customerDemand', 'maintenanceComplexity', 'clubhouseScale', 'upgradeCapacity', 'reputationExpectation', 'operatingCostMultiplier', 'potentialValue']) {
      assert.notEqual(tier[key], undefined, `${id}.${key}`);
    }
  }
});

test('a fresh purchase cannot be flipped immediately for guaranteed profit', () => {
  const empire = newEmpire('relaxed', 1204);
  buyProperty(empire, 'willow-creek');
  const appraisal = requestPropertyAppraisal(empire, 'willow-creek').appraisal;
  assert.equal(appraisal.eligible, false);
  assert.equal(appraisal.status, 'information');
  const cash = empire.cash;
  const attempted = confirmPropertySale(empire, 'willow-creek', appraisal.id, true);
  assert.equal(attempted.ok, false);
  assert.equal(empire.cash, cash);
  assert.equal(empire.holdings.length, 1);
});

test('appraisal is persisted but cannot destroy a property without explicit confirmation', () => {
  const empire = newEmpire('relaxed', 1201);
  assert.equal(buyProperty(empire, 'willow-creek').ok, true);
  empireUpdate(empire, 3 * 1440);
  restoreRealState(activeState(empire));
  const requested = requestPropertyAppraisal(empire, 'willow-creek');
  assert.equal(requested.ok, true);
  assert.equal(requested.appraisal.eligible, true);
  const holdings = empire.holdings.length;
  const cash = empire.cash;
  const refused = confirmPropertySale(empire, 'willow-creek', requested.appraisal.id, false);
  assert.equal(refused.ok, false);
  assert.equal(empire.holdings.length, holdings);
  assert.equal(empire.cash, cash);

  const loaded = deserializeEmpire(serializeEmpire(empire));
  const loadedAppraisal = loaded.progression.appraisals.find((item) => item.id === requested.appraisal.id);
  assert.equal(loadedAppraisal.offer, requested.appraisal.offer);
  assert.equal(loadedAppraisal.netProceeds, requested.appraisal.netProceeds);
});

test('requesting a new appraisal supersedes the old offer', () => {
  const empire = newEmpire('relaxed', 1203);
  buyProperty(empire, 'willow-creek');
  empireUpdate(empire, 3 * 1440);
  restoreRealState(activeState(empire));
  const first = requestPropertyAppraisal(empire, 'willow-creek').appraisal;
  const second = requestPropertyAppraisal(empire, 'willow-creek').appraisal;
  assert.equal(first.status, 'superseded');
  assert.equal(second.status, 'offered');
  const cash = empire.cash;
  const stale = confirmPropertySale(empire, 'willow-creek', first.id, true);
  assert.equal(stale.ok, false);
  assert.equal(empire.cash, cash);
  assert.equal(empire.holdings.length, 1);
});

test('confirmed sale writes a backup, pays net once, and never resurrects on load', () => {
  const empire = newEmpire('relaxed', 1202);
  buyProperty(empire, 'willow-creek');
  empireUpdate(empire, 3 * 1440);
  restoreRealState(activeState(empire));
  const appraisal = requestPropertyAppraisal(empire, 'willow-creek').appraisal;
  const cashBefore = empire.cash;
  const sold = confirmPropertySale(empire, 'willow-creek', appraisal.id, true);
  assert.equal(sold.ok, true, sold.reason);
  assert.equal(empire.cash, Math.round((cashBefore + appraisal.netProceeds) * 100) / 100);
  assert.equal(empire.holdings.some((holding) => holding.property.id === 'willow-creek'), false);
  assert.equal(empire.progression.saleBackups.length, 1);
  assert.equal(empire.progression.completedSales.length, 1);

  const cashAfter = empire.cash;
  const replay = confirmPropertySale(empire, 'willow-creek', appraisal.id, true);
  assert.equal(replay.ok, false);
  assert.equal(replay.duplicate, true);
  assert.equal(empire.cash, cashAfter);

  const loaded = deserializeEmpire(serializeEmpire(empire));
  assert.equal(loaded.holdings.some((holding) => holding.property.id === 'willow-creek'), false);
  assert.equal(loaded.cash, cashAfter);
  assert.equal(loaded.progression.processedSaleIds[`sale:${appraisal.id}`].netProceeds, appraisal.netProceeds);
});
