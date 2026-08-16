import assert from 'node:assert/strict';
import test from 'node:test';

import { newStarterEmpire, serializeEmpire, deserializeEmpireWithReport } from '../src/sim/empire.js';
import { ensureCourseMaintenance } from '../src/sim/courseMaintenance.js';

// GOAL 28 P3 — the New Game worker hands the RUNTIME empire object across the
// thread boundary by structured clone (src/workers/newGameGeneration.js), and
// the main thread adopts it without revalidation, on the argument that it is
// the same-origin product of the same code and seed the synchronous path
// would build. That argument holds only while the empire is pure structured-
// clonable data and the clone is byte-faithful under the save serializer.
// The day someone parks a function, a Map with exotic keys, or a class
// instance on empire state, this test fails BEFORE the worker path starts
// silently degrading to its 2-second JSON fallback in production.
test('a fresh empire survives structured clone byte-faithfully, both modes', () => {
  for (const mode of ['relaxed', 'realistic']) {
    const empire = newStarterEmpire(mode, 424242);
    const clone = structuredClone(empire); // throws on any non-data content
    assert.equal(serializeEmpire(clone), serializeEmpire(empire),
      `${mode}: structured clone must serialize identically to the original`);
  }
});

// Serialize-equality is BLIND to non-enumerable properties — the first
// clone-path build shipped green on the test above and then died on its
// first visuals frame, because courseMaintenance keeps its runtime
// (dirtyRows and friends) as a non-enumerable that structured clone drops.
// This sweep walks every own property name in the state graph and demands
// the runtime slot is the ONLY casualty, and that ensureCourseMaintenance
// heals it — which is exactly what the adopt path in main.js does. A new
// non-enumerable anywhere in sim state fails HERE, in the suite, not on the
// player's first frame.
test('structured clone drops exactly the known runtime slot, and ensure heals it', () => {
  const empire = newStarterEmpire('relaxed', 424242);
  const clone = structuredClone(empire);
  const dropped = [];
  const seen = new Set();
  const walk = (a, b, path, depth) => {
    if (depth > 7 || !a || typeof a !== 'object' || seen.has(a)) return;
    seen.add(a);
    for (const key of Object.getOwnPropertyNames(a)) {
      const has = b && typeof b === 'object' && Object.prototype.hasOwnProperty.call(b, key);
      if (!has) { dropped.push(`${path}.${key}`); continue; }
      const desc = Object.getOwnPropertyDescriptor(a, key);
      if (desc.enumerable && a[key] && typeof a[key] === 'object'
          && !ArrayBuffer.isView(a[key]) && !(a[key] instanceof Map) && !(a[key] instanceof Set)) {
        walk(a[key], b[key], `${path}.${key}`, depth + 1);
      }
    }
  };
  walk(empire, clone, 'empire', 0);
  assert.deepEqual(dropped, ['empire.holdings.0.state.courseMaintenance.runtime'],
    'structured clone must drop exactly the known non-enumerable runtime slot');
  for (const holding of clone.holdings) ensureCourseMaintenance(holding.state);
  assert.ok(clone.holdings[0].state.courseMaintenance.runtime, 'ensure must rebuild the runtime in place');
});

// The worker's DataCloneError fallback leg revives through the save
// machinery; a fresh empire must round-trip it with a CLEAN report — zero
// migrations, zero repairs — or the fallback would silently ship a healed
// variant of a brand-new game.
test('a fresh empire round-trips its own save envelope with a clean report', () => {
  const empire = newStarterEmpire('relaxed', 424242);
  const loaded = deserializeEmpireWithReport(serializeEmpire(empire));
  assert.equal(loaded.report.migrations.length, 0, 'no migrations on a same-build fresh empire');
  assert.equal(loaded.report.recovered, false, 'no repairs on a same-build fresh empire');
  assert.equal(loaded.empire.activeId, empire.activeId);
  assert.equal(loaded.empire.holdings.length, empire.holdings.length);
});
