// I7 — the test broom-feel-config.test.js always CLAIMED existed ("where that
// would be caught") and never did. The 1.247 handle reach was a hand-typed
// measurement of the shipped FP broom with no authority: re-export the asset
// and every dependent test silently measures the wrong broom.
//
// Now: tools/gen/extract-broom-metrics.mjs measures the GLB and generates
// src/data/broomMetrics.js with the value and the file's SHA-256. This test
// re-derives BOTH from the asset on disk, so the three parties — the GLB, the
// generated constant, and the dependent feel math — cannot disagree quietly.
//
// If this fails after an asset re-export: run `npm run gen:broom-metrics`,
// then LOOK at what moved before accepting it — a reach change re-solves the
// grip anchor, it does not just re-record the number.

import test from 'node:test';
import assert from 'node:assert/strict';
import { measureBroom, SOURCE_GLB } from '../tools/gen/extract-broom-metrics.mjs';
import { BROOM_METRICS } from '../src/data/broomMetrics.js';

const measured = measureBroom();

test('the generated metrics match the GLB on disk (hash and value)', () => {
  assert.equal(BROOM_METRICS.sourceGlb, SOURCE_GLB,
    'the generated file must name the same asset this test measures');
  assert.equal(BROOM_METRICS.sourceSha256, measured.sha256,
    `the FP broom GLB changed on disk without regenerating broomMetrics - `
    + 'run npm run gen:broom-metrics and re-solve anything that depends on the reach');
  assert.ok(Math.abs(BROOM_METRICS.gripToFloorYd - measured.gripToFloorYd) < 1e-6,
    `generated ${BROOM_METRICS.gripToFloorYd} vs measured ${measured.gripToFloorYd}`);
});

test('the measured quantity IS the recorded one: GripPrimary→FloorContact ≈ 1.247', () => {
  // 1.247 was the hand-typed value the project ran on. The extractor agreeing
  // with it (1.2472…) is what promotes it from folklore to measurement. If the
  // asset is deliberately re-authored this tolerance moves WITH the regenerated
  // file — the previous assert catches the un-regenerated case first.
  assert.ok(Math.abs(measured.gripToFloorYd - 1.247) < 0.002,
    `GripPrimary→FloorContact measures ${measured.gripToFloorYd.toFixed(4)} yd; `
    + 'the recorded 1.247 no longer describes the shipped asset');
});

test('the extractor is sensitive to the node pair (negative control, permanent)', () => {
  // Pointing at the wrong socket must produce a different number — an
  // extractor that returns 1.247 for ANY pair measures nothing.
  const wrong = measureBroom(undefined, { gripName: 'SOCKET_GripSupport' });
  assert.ok(Math.abs(wrong.gripToFloorYd - measured.gripToFloorYd) > 0.1,
    `GripSupport→FloorContact (${wrong.gripToFloorYd.toFixed(4)}) should differ clearly `
    + `from GripPrimary→FloorContact (${measured.gripToFloorYd.toFixed(4)})`);
});
