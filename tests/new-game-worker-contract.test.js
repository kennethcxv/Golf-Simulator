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

// THE CARRY: runtime is not just cache. runtime.coarseShadow holds the coarse
// values as of the last fine-import, so the first tick can land the coarse
// drift that generation-time systems wrote after that capture. A heal that
// recaptures from current cells zeroes that pending import — serialize-equal,
// value-different, and the goldens caught it as floor-grime drift on every
// worker-path New Game (2026-08-16). So the worker aliases runtime enumerably
// (runtimeCarry), the adopter moves it back non-enumerable, and this test
// value-diffs the ENTIRE graph — runtime included — against the sync product.
// Removing the carry turns this red with named paths, not a pixel diff.
test('the worker protocol (carry, clone, adopt) is value-identical to sync generation', () => {
  const original = newStarterEmpire('relaxed', 424242);
  for (const holding of original.holdings) {
    const model = holding?.state?.courseMaintenance;
    if (model?.runtime) model.runtimeCarry = model.runtime; // worker side
  }
  const clone = structuredClone(original);
  for (const holding of original.holdings) delete holding?.state?.courseMaintenance?.runtimeCarry;
  for (const holding of clone.holdings) { // adopter side (main.js)
    const model = holding?.state?.courseMaintenance;
    if (!model) continue;
    if (model.runtimeCarry) {
      Object.defineProperty(model, 'runtime', {
        configurable: true, enumerable: false, value: model.runtimeCarry,
      });
      delete model.runtimeCarry;
    }
    ensureCourseMaintenance(holding.state);
  }
  const model = clone.holdings[0].state.courseMaintenance;
  assert.equal(Object.getOwnPropertyDescriptor(model, 'runtime').enumerable, false,
    'the adopted runtime must return to its non-enumerable slot');
  assert.ok(!('runtimeCarry' in model), 'the enumerable alias must not survive adoption');
  assert.equal(serializeEmpire(clone), serializeEmpire(original),
    'adoption must leave the save serialization untouched');

  const diffs = [];
  const seen = new Set();
  const walk = (a, b, path, depth) => {
    if (diffs.length >= 25 || depth > 14 || a === b) return;
    const ta = Object.prototype.toString.call(a);
    const tb = Object.prototype.toString.call(b);
    if (ta !== tb) { diffs.push(`${path}: type ${ta} vs ${tb}`); return; }
    if (ArrayBuffer.isView(a)) {
      if (a.length !== b.length) { diffs.push(`${path}: typed length ${a.length} vs ${b.length}`); return; }
      for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) { diffs.push(`${path}[${i}]: ${a[i]} vs ${b[i]}`); return; }
      }
      return;
    }
    if (a === null || typeof a !== 'object') {
      if (!(Number.isNaN(a) && Number.isNaN(b))) diffs.push(`${path}: ${String(a)} vs ${String(b)}`);
      return;
    }
    if (seen.has(a)) return;
    seen.add(a);
    if (a instanceof Map) {
      if (a.size !== b.size) { diffs.push(`${path}: Map size ${a.size} vs ${b.size}`); return; }
      for (const [k, v] of a) walk(v, b.get(k), `${path}.get(${k})`, depth + 1);
      return;
    }
    if (a instanceof Set) {
      if (a.size !== b.size) diffs.push(`${path}: Set size ${a.size} vs ${b.size}`);
      return;
    }
    const bKeys = new Set(Object.getOwnPropertyNames(b));
    for (const key of Object.getOwnPropertyNames(a)) {
      if (!bKeys.delete(key)) { diffs.push(`${path}.${key}: missing after adoption`); continue; }
      walk(a[key], b[key], `${path}.${key}`, depth + 1);
    }
    for (const key of bKeys) diffs.push(`${path}.${key}: extra after adoption`);
  };
  walk(original, clone, 'empire', 0);
  assert.deepEqual(diffs, [],
    `the adopted worker product must be value-identical to sync generation:\n  ${diffs.join('\n  ')}`);
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
