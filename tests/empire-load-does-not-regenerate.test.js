// LOADING A HEALTHY SAVE MUST NOT BUILD A WHOLE NEW EMPIRE TO GET ITS FALLBACKS.
//
// deserializeEmpireWithReport used to call newEmpire(mode, seed) unconditionally,
// purely to have a `defaults` object -- which it then read exactly twice, for a
// market that a healthy save already carries and a cash fallback a healthy save
// never needs. Measured on the owner's own autosave with performance marks
// (tools/qa/boot-mark-breakdown.js): 2,117.6 ms of a 2,195.7 ms deserialize, on
// every single launch, discarded untouched.
//
// The assertion is RELATIVE, not a millisecond threshold, so it cannot go flaky
// on a slow or contended machine: whatever newEmpire costs here and now,
// deserializing a healthy save must cost a fraction of it. Before the fix that
// was impossible by construction -- the deserialize CONTAINED a newEmpire call,
// so it could only ever be slower.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newEmpire,
  serializeEmpire,
  deserializeEmpireWithReport,
} from '../src/sim/empire.js';

const median = (xs) => {
  const v = xs.slice().sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};

test('deserializing a healthy empire save does not pay for a generated empire', () => {
  // One real empire, serialized the way the game saves it.
  const source = newEmpire('relaxed', 12345);
  const raw = serializeEmpire(source);

  // Warm both paths once so neither measurement carries first-call JIT.
  newEmpire('relaxed', 999);
  deserializeEmpireWithReport(raw);

  const buildCost = [];
  for (let i = 0; i < 3; i += 1) {
    const t0 = performance.now();
    newEmpire('relaxed', 1000 + i);
    buildCost.push(performance.now() - t0);
  }
  const loadCost = [];
  for (let i = 0; i < 3; i += 1) {
    const t0 = performance.now();
    deserializeEmpireWithReport(raw);
    loadCost.push(performance.now() - t0);
  }

  const build = median(buildCost);
  const load = median(loadCost);
  // A generous ratio: the point is that the load does not CONTAIN a build, not
  // that it is fast in absolute terms. Before the fix this ratio was >= 1.
  assert.ok(
    load < build * 0.5,
    `deserializing a healthy save took ${load.toFixed(1)} ms against ${build.toFixed(1)} ms `
    + 'to generate an empire — a healthy load must not be generating one',
  );
});

test('a save missing its market still gets a regenerated one', () => {
  // The lazy fallback must still BE a fallback: the generated empire is built
  // on demand, so the one case that needs it must still work.
  const source = newEmpire('relaxed', 4242);
  const parsed = JSON.parse(serializeEmpire(source));
  delete parsed.market;
  const loaded = deserializeEmpireWithReport(JSON.stringify(parsed));
  assert.ok(Array.isArray(loaded.empire.market), 'the market is restored');
  assert.ok(
    loaded.report.repairs.some((r) => String(r.path || r) .includes('market')
      || String(r.note || '').includes('market')),
    'the repair is reported rather than done silently',
  );
});

test('a save with unusable cash falls back to the generated default', () => {
  const source = newEmpire('relaxed', 77);
  const parsed = JSON.parse(serializeEmpire(source));
  parsed.cash = 'not a number';
  const loaded = deserializeEmpireWithReport(JSON.stringify(parsed));
  assert.equal(typeof loaded.empire.cash, 'number');
  assert.ok(Number.isFinite(loaded.empire.cash), 'cash is a finite number');
});
