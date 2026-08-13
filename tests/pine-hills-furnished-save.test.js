import test from 'node:test';
import assert from 'node:assert/strict';

// shopLayout resolves the shipping clubhouse variant at module evaluation.
// Set the same renderer-visible launch flag Electron uses before importing any
// state/campaign module that consumes its authored fixture plan.
globalThis.fairwayNative = { launchArgs: ['--fw-clubhouse=pine-hills-v2'] };

const {
  CLUBHOUSE_LAYOUT_VARIANT,
  FIXTURES,
} = await import('../src/data/shopLayout.js');
const {
  activeState,
  deserializeEmpireWithReport,
  newStarterEmpire,
  serializeEmpire,
} = await import('../src/sim/empire.js');
const {
  FURNISHED_START_FIXTURES,
} = await import('../src/sim/campaign.js');
const {
  placedFixtures,
  routesIntact,
  validatePlacement,
} = await import('../src/sim/layout.js');

const furnishedIds = new Set(FURNISHED_START_FIXTURES);

function furnishedLayout(state) {
  return placedFixtures(state)
    .filter((fixture) => furnishedIds.has(fixture.id))
    .map((fixture) => ({
      id: fixture.id,
      x: fixture.x,
      z: fixture.z,
      ry: fixture.ry || 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

test('fresh Pine Hills furnished layout is safe and current-schema canonical', () => {
  assert.equal(CLUBHOUSE_LAYOUT_VARIANT, 'pine-hills-v2');
  const empire = newStarterEmpire('relaxed', 92401);
  const before = activeState(empire);
  const authored = furnishedLayout(before);

  assert.ok(authored.length > 0, 'the variant exposes its furnished fixture plan');
  assert.deepEqual(before.shop.layout.moved, {},
    'campaign construction does not masquerade as player fixture moves');
  assert.equal(routesIntact(before), true, 'the furnished floor preserves every required route');

  const first = deserializeEmpireWithReport(serializeEmpire(empire));
  const afterFirst = activeState(first.empire);
  assert.equal(first.report.recovered, false);
  assert.deepEqual(first.report.repairs, []);
  assert.deepEqual(furnishedLayout(afterFirst), authored,
    'the intended furnished positions survive the first round trip exactly');
  assert.deepEqual(afterFirst.shop.layout.moved, {});
  assert.equal(routesIntact(afterFirst), true);

  const second = deserializeEmpireWithReport(serializeEmpire(first.empire));
  const afterSecond = activeState(second.empire);
  assert.equal(second.report.recovered, false,
    'a canonical current-schema save remains repair-free on its next load');
  assert.deepEqual(second.report.repairs, []);
  assert.deepEqual(furnishedLayout(afterSecond), authored);
  assert.deepEqual(afterSecond.shop.layout.moved, {});
  assert.equal(routesIntact(afterSecond), true);
});

test('an unsafe player fixture override is still rejected and heals idempotently', () => {
  const empire = newStarterEmpire('relaxed', 92402);
  const state = activeState(empire);
  const fixtureId = 'shelf_balls';
  const unsafe = { x: 100, z: 100, ry: 0 };
  const rejected = validatePlacement(state, fixtureId, unsafe.x, unsafe.z, unsafe.ry);
  assert.equal(rejected.ok, false, 'normal player placement rejects the off-site fixture');
  assert.ok(rejected.codes.includes('wall-collision'));

  // Model a hand-edited/current-schema player override consistently in both
  // the legacy sparse projection and the authoritative v2 object record.
  const raw = JSON.parse(serializeEmpire(empire));
  const holding = raw.holdings.find((entry) => entry.property?.id === 'willow-creek');
  assert.ok(holding, 'the starter holding exists');
  const layout = holding.state.shop.layout;
  layout.moved[fixtureId] = { ...unsafe };
  layout.objects[fixtureId].transform = {
    ...layout.objects[fixtureId].transform,
    ...unsafe,
    y: 0,
    surface: 'floor',
    attachment: null,
  };

  const repaired = deserializeEmpireWithReport(JSON.stringify(raw));
  const healed = activeState(repaired.empire);
  assert.equal(repaired.report.recovered, true);
  assert.ok(repaired.report.repairs.some((entry) => (
    entry.path === '$.holdings[0].state.shop.layout.moved'
      && /unsafe fixture pose\(s\) removed/.test(entry.message)
  )), 'the existing load safety gate attributes the unsafe player override');
  assert.equal(healed.shop.layout.moved[fixtureId], undefined);
  const restored = placedFixtures(healed).find((fixture) => fixture.id === fixtureId);
  const authored = FIXTURES.find((fixture) => fixture.id === fixtureId);
  assert.deepEqual(
    { x: restored.x, z: restored.z, ry: restored.ry || 0 },
    { x: authored.x, z: authored.z, ry: authored.ry || 0 },
    'the rejected override falls back to the authored safe position',
  );
  assert.equal(routesIntact(healed), true);

  const canonical = deserializeEmpireWithReport(serializeEmpire(repaired.empire));
  assert.equal(canonical.report.recovered, false,
    'repair output is canonical rather than repairing on every load');
  assert.deepEqual(canonical.report.repairs, []);
  assert.equal(routesIntact(activeState(canonical.empire)), true);
});
