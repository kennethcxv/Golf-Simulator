import test from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY } from '../src/sim/constants.js';
import {
  PROPERTY_INSPECTION_COST, PROPERTY_MANAGER_TIERS, REMOTE_PROPERTY_UTILITIES_PER_DAY,
  passiveOperationsProjection,
} from '../src/sim/propertyOperations.js';
import {
  newEmpire, buyProperty, inspectPropertyListing, assignPropertyManager,
  empireUpdate, serializeEmpire, deserializeEmpire, switchProperty,
} from '../src/sim/empire.js';

function ownTwo(seed = 42) {
  const empire = newEmpire('relaxed', seed);
  empire.cash = 1_000_000;
  buyProperty(empire, 'willow-creek');
  buyProperty(empire, 'bent-pines');
  return empire;
}

test('an inspection charges once and reveals a stable bounded report without exposing an exact value', () => {
  const empire = newEmpire('relaxed', 42);
  const listing = empire.market.find((entry) => entry.id === 'willow-creek');
  const before = empire.cash;
  const result = inspectPropertyListing(empire, listing.id);
  assert.equal(result.ok, true, result.reason);
  assert.equal(empire.cash, before - PROPERTY_INSPECTION_COST);
  assert.ok(result.report.valueLow < listing.trueValue);
  assert.ok(result.report.valueHigh > listing.trueValue);
  assert.ok(result.report.maintenanceReserve > 0);
  assert.ok(result.report.risks.length > 0);
  assert.ok(result.report.opportunities.length > 0);

  const repeat = inspectPropertyListing(empire, listing.id);
  assert.equal(repeat.already, true);
  assert.equal(empire.cash, before - PROPERTY_INSPECTION_COST, 'opening an existing report never charges twice');
  assert.deepEqual(repeat.report, result.report);
});

test('inspection and management commands refuse missing targets and unaffordable contracts', () => {
  const empire = newEmpire('realistic', 42);
  assert.equal(inspectPropertyListing(empire, 'gone').ok, false);
  empire.cash = PROPERTY_INSPECTION_COST - 1;
  assert.equal(inspectPropertyListing(empire, 'willow-creek').ok, false);

  empire.cash = 1_000_000;
  buyProperty(empire, 'willow-creek');
  empire.cash = 10;
  empire.holdings[0].state.cash = 10;
  assert.equal(assignPropertyManager(empire, 'willow-creek', 'director').ok, false);
  assert.equal(assignPropertyManager(empire, 'not-owned', 'manager').ok, false);
  assert.equal(assignPropertyManager(empire, 'willow-creek', 'imaginary').ok, false);
});

test('buying transfers the paid inspection into the holding acquisition record', () => {
  const empire = newEmpire('relaxed', 42);
  empire.cash = 1_000_000;
  const inspected = inspectPropertyListing(empire, 'willow-creek').report;
  const bought = buyProperty(empire, 'willow-creek');
  assert.equal(bought.ok, true);
  assert.deepEqual(empire.holdings[0].operations.acquisition.inspection, inspected);
  assert.equal(empire.holdings[0].operations.managerTier, 'caretaker');
  assert.equal(empire.inspections['willow-creek'], undefined, 'market-only report is removed after closing');
});

test('a manager contract charges the shared wallet and persists the named assignment', () => {
  const empire = ownTwo();
  const before = empire.cash;
  const result = assignPropertyManager(empire, 'bent-pines', 'manager');
  assert.equal(result.ok, true, result.reason);
  assert.equal(empire.cash, before - PROPERTY_MANAGER_TIERS.manager.hireCost);
  assert.equal(empire.holdings[0].state.cash, empire.cash, 'active state remains wallet authority');
  const holding = empire.holdings.find((entry) => entry.property.id === 'bent-pines');
  assert.equal(holding.operations.managerTier, 'manager');
  assert.match(holding.operations.managerName, /\w+ \w+/);
  assert.equal(holding.operations.managementFeesPaid, PROPERTY_MANAGER_TIERS.manager.hireCost);

  const repeat = assignPropertyManager(empire, 'bent-pines', 'manager');
  assert.equal(repeat.already, true);
  assert.equal(empire.cash, before - PROPERTY_MANAGER_TIERS.manager.hireCost);
});

test('remote management materially slows healthy-course decline but never restores a wreck for free', () => {
  const caretakerEmpire = ownTwo(42);
  const managedEmpire = ownTwo(42);
  const caretaker = caretakerEmpire.holdings.find((entry) => entry.property.id === 'bent-pines');
  const managed = managedEmpire.holdings.find((entry) => entry.property.id === 'bent-pines');
  caretaker.passive.conditionEst = 90;
  managed.passive.conditionEst = 90;
  assignPropertyManager(managedEmpire, managed.property.id, 'director');

  for (let day = 0; day < 40; day++) {
    empireUpdate(caretakerEmpire, MINUTES_PER_DAY);
    empireUpdate(managedEmpire, MINUTES_PER_DAY);
  }
  assert.ok(managed.passive.conditionEst > caretaker.passive.conditionEst + 20,
    `director protects the asset: ${managed.passive.conditionEst} vs ${caretaker.passive.conditionEst}`);
  assert.equal(managed.passive.managerTier, 'director');
  assert.ok(managed.passive.lastOperatingCost > caretaker.passive.lastOperatingCost);

  managed.passive.conditionEst = 28;
  empireUpdate(managedEmpire, 20 * MINUTES_PER_DAY);
  assert.equal(managed.passive.conditionEst, 28, 'delegation preserves operations; it does not perform the restoration loop');
});

test('management projections reflect property scale and every operations field round-trips', () => {
  const empire = ownTwo(79);
  assignPropertyManager(empire, 'bent-pines', 'manager');
  inspectPropertyListing(empire, 'flatiron-meadows');
  const holding = empire.holdings.find((entry) => entry.property.id === 'bent-pines');
  const projection = passiveOperationsProjection(holding);
  assert.equal(projection.protectedCondition, PROPERTY_MANAGER_TIERS.manager.conditionFloor);
  assert.equal(
    projection.dailyManagementCost,
    PROPERTY_MANAGER_TIERS.manager.dailyCostPerNine + projection.propertyOverhead
      + REMOTE_PROPERTY_UTILITIES_PER_DAY,
  );

  const back = deserializeEmpire(serializeEmpire(empire));
  assert.deepEqual(back.inspections, empire.inspections);
  assert.deepEqual(
    back.holdings.find((entry) => entry.property.id === 'bent-pines').operations,
    holding.operations,
  );
  switchProperty(back, 'bent-pines');
  switchProperty(back, 'willow-creek');
  assert.equal(back.holdings.find((entry) => entry.property.id === 'bent-pines').operations.managerTier, 'manager');
});

test('a pre-operations empire save migrates every holding to a valid caretaker contract', () => {
  const empire = ownTwo(91);
  const old = JSON.parse(serializeEmpire(empire));
  old.empireVersion = 2;
  delete old.inspections;
  for (const holding of old.holdings) delete holding.operations;
  const migrated = deserializeEmpire(old);
  assert.deepEqual(migrated.inspections, {});
  assert.ok(migrated.holdings.every((holding) => holding.operations.managerTier === 'caretaker'));
});
