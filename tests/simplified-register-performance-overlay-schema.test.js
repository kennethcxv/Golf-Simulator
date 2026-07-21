import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const overlaySource = readFileSync(
  new URL('../tools/qa/simplified-register-performance-overlay.js', import.meta.url),
  'utf8',
);
const performanceSource = readFileSync(
  new URL('../tools/qa/simplified-register-performance.mjs', import.meta.url),
  'utf8',
);

test('Capture #38 accepts only schema-valid authoritative master PASS results', () => {
  assert.equal(typeof Function(`return (${overlaySource});`)(), 'function');
  assert.match(overlaySource, /result\.protocol\.profile !== 'master'/);
  assert.match(overlaySource, /result\.schemaVersion !== PERFORMANCE_SCHEMA_VERSION/);
  assert.match(overlaySource, /result\.schemaValidation\?\.valid !== true/);
  assert.match(overlaySource, /validatePerformanceResultSchema\(result\)/);
  assert.match(overlaySource, /currentSchemaValidation\.valid !== true/);
  assert.match(overlaySource, /REQUIRED_PERFORMANCE_GATE_KEYS\.some/);
  assert.match(overlaySource, /result\.ok !== true \|\| result\.gates\.pass !== true/);
  assert.match(overlaySource, /entry\?\.pass !== true/);
  assert.match(overlaySource, /result\.gates\.pass \? 'PASS' : 'FAIL'/);
});

test('performance master brackets the full v2 production build without replacing harness hashes', () => {
  assert.match(performanceSource, /from '\.\/cashier-build-snapshot\.mjs';/);
  assert.match(performanceSource, /const productionBuildBefore = captureCashierBuildSnapshot\(\);/);
  assert.match(performanceSource, /const productionBuildAfter = captureCashierBuildSnapshot\(\{ allowMissing: true \}\);/);
  assert.match(performanceSource, /compareCashierBuildSnapshots\(\s*productionBuildBefore,\s*productionBuildAfter,/);
  assert.match(performanceSource, /gateDetails\.productionBuildUnchanged = gate\(/);
  assert.match(performanceSource, /result\.productionBuildHashes = \{ \.\.\.productionBuildBefore\.productionBuildHashes \};/);
  assert.match(performanceSource, /result\.productionBuildSnapshot = \{/);
  assert.match(performanceSource, /'tools\/qa\/cashier-build-snapshot\.mjs'/);
  assert.match(performanceSource, /const measuredFiles = \[/,
    'the smaller QA harness hash list must remain separate from the full production map');
  for (const currentHotspot of [
    'src/render3d/clubhouse/simplifiedRegisterMode.js',
    'src/data/fixtureSlots.js',
    'src/render3d/clubhouse/resourceLifecycle.js',
    'vendor/three.module.js',
  ]) {
    assert.match(performanceSource, new RegExp(currentHotspot.replaceAll('/', '\\/')));
  }
  assert.match(performanceSource, /discoverMeasuredFiles\('src\/render3d\/assets51to100'/);
  assert.match(performanceSource, /discoverMeasuredFiles\('vendor\/models\/checkout'/);
  assert.equal(
    performanceSource.match(/await captureNormalizedTransactionBoundary\(page, cdp\)/g)?.length,
    5,
    'the live route must normalize four fixed boundaries plus one bounded convergence boundary',
  );
  assert.match(performanceSource, /dynamicWindows\.cardApprovedRepeat = await captureDynamicPhase\(/);
  assert.match(performanceSource, /for \(let attempt = 1; attempt <= TRANSACTION_RENDERER_RESIDENCY_ATTEMPTS; attempt\+\+\)/);
  assert.match(performanceSource, /isRetryableTransactionRendererResidency\(attemptDelta\)/);
  assert.match(performanceSource, /if \(!retryableRendererGrowth \|\| attempt === TRANSACTION_RENDERER_RESIDENCY_ATTEMPTS\) break;/,
    'transaction convergence must remain bounded and fail through the final judged delta');
  assert.match(performanceSource, /transactionStabilityReport\(\s*transactionStart,\s*transactionAfterFirstSale,\s*transactionPairStart,\s*transactionEnd,\s*\)/);
  assert.match(performanceSource, /two complete approved-card sales plus bounded renderer-residency convergence sales/);
  assert.doesNotMatch(performanceSource, /plus one approved card completion/);
  assert.match(performanceSource, /path\.join\(OUT, 'transaction-stability\.json'\)[\s\S]*schemaVersion: PERFORMANCE_SCHEMA_VERSION,[\s\S]*generatedAt,[\s\S]*protocol: \{ gcSettleMs: protocol\.gcSettleMs \}/);
  assert.match(performanceSource, /if \(now - state\.startedAt < 0\.001\) \{\s*requestAnimationFrame\(frame\);\s*return;/,
    'the first persisted rAF timestamp must serialize after the explicit zero-time heap boundary');
  assert.doesNotMatch(performanceSource, /if \(now - state\.startedAt < 0\.001\) \{\s*state\.previousAt\s*=/,
    'a rejected pre-boundary or sub-microsecond rAF must not seed the accepted frame timeline');
});

test('Capture #38 requires and re-brackets the exact authoritative full v2 map', () => {
  assert.match(overlaySource, /CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION/);
  assert.match(overlaySource, /authoritativeBuild\.unchanged !== true/);
  assert.match(overlaySource, /authoritativeBuild\.beforeAggregateHash !== authoritativeBuild\.afterAggregateHash/);
  assert.match(overlaySource, /productionBuildBefore\.aggregateHash !== authoritativeBuild\.afterAggregateHash/);
  assert.match(overlaySource, /const productionBuildAfter = captureCashierBuildSnapshot\(\{ allowMissing: true \}\);/);
  assert.match(overlaySource, /const overlayBuildComparison = compareCashierBuildSnapshots\(/);
  assert.match(overlaySource, /overlayBuildComparison\.unchanged/);
  assert.match(overlaySource, /finalAuthoritativeComparison\.unchanged/);
  assert.match(overlaySource, /production build changed during overlay generation/);
});

test('Capture #38 binds every displayed metric family to authoritative JSON fields', () => {
  for (const contract of [
    /result\.scenes\.activeMonitor/,
    /result\.storedBaselineComparison/,
    /result\.dynamicPhases/,
    /result\.dynamicWindows/,
    /result\.reentryLeak\?\.delta/,
    /result\.transactionStability\.methodMatchedDelta/,
    /result\.gates\.details/,
    /result\.build\?\.measuredFiles/,
  ]) {
    assert.match(overlaySource, contract);
  }
  assert.doesNotMatch(overlaySource, /transactionStability\?\.repeatSaleDelta/,
    'schema-v4 overlays must bind the canonical method-matched delta without a stale-v3 fallback');
  assert.match(overlaySource, /const repeat = result\.transactionStability\.methodMatchedDelta;/);
  assert.match(overlaySource, /repeatSale: 'transactionStability\.methodMatchedDelta'/);
  assert.match(overlaySource, /No direct GPU timer in the authoritative master protocol/);
  assert.match(overlaySource, /dynamic_transactionRendererResidency/);
  assert.match(overlaySource, /dynamic_transactionRepeatRendererResidency/);
  assert.match(overlaySource, /dynamic_transactionPostGcHeap/);
});

test('Capture #38 uses same-run gameplay and emits hash-level provenance', () => {
  assert.match(overlaySource, /result\.scenes\.activeMonitor\.screenshot/);
  assert.match(overlaySource, /active-register screenshot captured inside the same authoritative performance run/);
  assert.match(overlaySource, /sha256\(rawBytes\)/);
  assert.match(overlaySource, /sha256\(backgroundBytes\)/);
  assert.match(overlaySource, /sha256\(overlayToolBytes\)/);
  assert.match(overlaySource, /sha256\(outputBytes\)/);
  assert.match(overlaySource, /raw JSON is authoritative/);
  assert.match(overlaySource, /temporary QA-only performance overlay; no production UI was added/);
  assert.match(overlaySource, /const provenance = \{[\s\S]*productionBuildHashes:/);
  assert.match(overlaySource, /const provenance = \{[\s\S]*productionBuildSnapshot:/);
  assert.match(overlaySource, /authoritativeProductionBuildUnchanged: true/);
  assert.match(overlaySource, /overlayProductionBuildUnchanged: true/);
  assert.match(overlaySource, /sourceHashes: 'build\.measuredFiles'/,
    'overlay provenance must retain the QA harness hash path');
});
