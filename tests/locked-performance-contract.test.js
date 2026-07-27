import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  LOCKED_PERFORMANCE_PROTOCOL,
  LOCKED_PERFORMANCE_SCHEMA_VERSION,
  evaluateLockedPerformanceReport,
  median,
  summarizeScenarioRuns,
} from '../tools/qa/locked-performance-contract.mjs';

function run(runIndex, averageFps = 60, onePercentLowFps = 30) {
  return {
    run: runIndex,
    fixture: {},
    sample: {
      durationMs: 5_000 + runIndex,
      frameCount: 300,
      averageFps,
      onePercentLowFps,
      worstFrameMs: 20 + runIndex,
      framesOver33Ms: runIndex - 1,
      framesOver50Ms: 0,
      drawCalls: 100 + runIndex,
      renderedTriangles: 100_000 + runIndex,
      materialCount: 40 + runIndex,
      rendererGeometryCount: 300 + runIndex,
      rendererTextureCount: 20 + runIndex,
      textureMemoryBytes: 50_000_000 + runIndex,
      jsHeapUsedBytes: 100_000_000 + runIndex,
      activeEventListeners: 50 + runIndex,
      trackedEventListeners: 45 + runIndex,
      uiMutationsPerSecond: runIndex,
      domNodes: 2_000 + runIndex,
      domNodeDelta: runIndex - 2,
    },
  };
}

function report(runFactory = () => [run(1), run(2), run(3)]) {
  return {
    schemaVersion: LOCKED_PERFORMANCE_SCHEMA_VERSION,
    protocol: {
      viewport: { ...LOCKED_PERFORMANCE_PROTOCOL.viewport },
      qualityPreset: LOCKED_PERFORMANCE_PROTOCOL.qualityPreset,
      scenarios: [...LOCKED_PERFORMANCE_PROTOCOL.scenarios],
      runsPerScenario: LOCKED_PERFORMANCE_PROTOCOL.runsPerScenario,
      aggregation: LOCKED_PERFORMANCE_PROTOCOL.aggregation,
      thresholds: { ...LOCKED_PERFORMANCE_PROTOCOL.thresholds },
    },
    environment: { devicePixelRatio: 1 },
    scenarios: Object.fromEntries(LOCKED_PERFORMANCE_PROTOCOL.scenarios.map((key) => [
      key,
      { runs: runFactory(key) },
    ])),
  };
}

test('locked performance protocol is exactly 1080p DPR1, five scenarios, and three runs', () => {
  assert.deepEqual(LOCKED_PERFORMANCE_PROTOCOL.viewport, {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
  });
  assert.deepEqual(LOCKED_PERFORMANCE_PROTOCOL.scenarios, [
    'idle',
    'walk',
    'cleaning',
    'checkout',
    'tenCustomers',
  ]);
  assert.equal(LOCKED_PERFORMANCE_PROTOCOL.runsPerScenario, 3);
  assert.equal(LOCKED_PERFORMANCE_PROTOCOL.aggregation, 'median');
  assert.deepEqual(LOCKED_PERFORMANCE_PROTOCOL.thresholds, {
    minimumAverageFps: 60,
    minimumOnePercentLowFps: 30,
  });
  assert.ok(Object.isFrozen(LOCKED_PERFORMANCE_PROTOCOL));
  assert.ok(Object.isFrozen(LOCKED_PERFORMANCE_PROTOCOL.viewport));
  assert.ok(Object.isFrozen(LOCKED_PERFORMANCE_PROTOCOL.scenarios));
  assert.ok(Object.isFrozen(LOCKED_PERFORMANCE_PROTOCOL.thresholds));
});

test('scenario summary uses the median of exactly three ordered runs', () => {
  const runs = [run(1, 30, 10), run(2, 60, 30), run(3, 120, 90)];
  const summary = summarizeScenarioRuns(runs);
  assert.equal(summary.averageFps, 60);
  assert.equal(summary.onePercentLowFps, 30);
  assert.equal(summary.worstFrameMs, 22);
  assert.equal(summary.activeEventListenerGrowth, 2);
  assert.equal(summary.trackedEventListenerGrowth, 2);
  assert.equal(summary.domNodeGrowth, 2);
  assert.equal(summary.jsHeapGrowthBytes, 2);
  assert.equal(median([30, 60, 120]), 60);
  assert.throws(() => summarizeScenarioRuns(runs.slice(0, 2)), /exactly 3 runs/);
  assert.throws(() => summarizeScenarioRuns([runs[1], runs[0], runs[2]]), /out of order/);
});

test('scenario summary fails closed when required resource instrumentation is unavailable', () => {
  const missingHeap = [run(1), run(2), run(3)];
  missingHeap[1].sample.jsHeapUsedBytes = null;
  assert.throws(() => summarizeScenarioRuns(missingHeap), /run 2 has invalid jsHeapUsedBytes/);

  const missingRendererCount = [run(1), run(2), run(3)];
  delete missingRendererCount[2].sample.rendererGeometryCount;
  assert.throws(
    () => summarizeScenarioRuns(missingRendererCount),
    /run 3 has invalid rendererGeometryCount/,
  );

  const invalidFrameSpikes = [run(1), run(2), run(3)];
  invalidFrameSpikes[0].sample.framesOver33Ms = -1;
  assert.throws(() => summarizeScenarioRuns(invalidFrameSpikes), /invalid framesOver33Ms/);
});

test('locked performance gates accept inclusive 60 average and 30 one-percent-low medians', () => {
  const result = evaluateLockedPerformanceReport(report(() => [
    run(1, 30, 10),
    run(2, 60, 30),
    run(3, 120, 90),
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.gates.length, 5);
  assert.ok(result.gates.every((gate) => gate.ok));
});

test('locked performance gates fail strictly below either absolute median threshold', () => {
  const candidate = report((key) => key === 'walk'
    ? [run(1, 59.999, 29.999), run(2, 59.999, 29.999), run(3, 120, 90)]
    : [run(1), run(2), run(3)]);
  const result = evaluateLockedPerformanceReport(candidate);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /walk: median average FPS 59\.999 < 60/);
  assert.match(result.failures.join('\n'), /walk: median 1% low FPS 29\.999 < 30/);
});

test('locked performance contract fails closed on protocol or scenario drift', () => {
  const floatingDpr = report();
  floatingDpr.environment.devicePixelRatio = 1.00000003;
  assert.equal(evaluateLockedPerformanceReport(floatingDpr).ok, true);

  const candidate = report();
  candidate.protocol.viewport.width = 1600;
  candidate.protocol.runsPerScenario = 4;
  candidate.protocol.aggregation = 'average';
  candidate.protocol.thresholds.minimumAverageFps = 59;
  candidate.environment.devicePixelRatio = 2;
  delete candidate.scenarios.checkout;
  const result = evaluateLockedPerformanceReport(candidate);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /1920x1080 at DPR 1/);
  assert.match(result.failures.join('\n'), /runsPerScenario must be 3/);
  assert.match(result.failures.join('\n'), /aggregation must be median/);
  assert.match(result.failures.join('\n'), /average FPS >= 60/);
  assert.match(result.failures.join('\n'), /measured browser devicePixelRatio must be 1/);
  assert.match(result.failures.join('\n'), /scenario results must contain exactly/);
});

test('browser driver is wired to the locked contract and normal scenario controls', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/locked-performance-acceptance.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /locked-performance-contract\.mjs/);
  assert.match(source, /page\.setViewportSize\(\{/);
  assert.match(source, /for \(const scenarioKey of protocol\.scenarios\)/);
  assert.match(source, /run <= protocol\.runsPerScenario/);
  assert.match(source, /async function captureEvidence\(scenarioKey\)/);
  assert.match(source, /page\.screenshot\(\{ path: screenshot, fullPage: false \}\)/);
  assert.match(source, /screenshot: screenshotPaths\[scenarioKey\]/);
  assert.match(source, /page\.keyboard\.down\(key\)/);
  assert.match(source, /cycleTool\('vacuum'/);
  assert.match(source, /page\.mouse\.down\(\{ button: 'left' \}\)/);
  assert.match(source, /page\.keyboard\.press\('e'\)/);
  assert.match(source, /async function checkoutControls\(run\)/);
  assert.match(source, /page\.mouse\.click\(point\.x, point\.y\)/);
  assert.match(source, /outcome: 'scanned-and-staged'/);
  assert.match(source, /while \(customersOf\(\)\.length < 10\)/);
  assert.match(source, /fixture\.activeCustomers !== 10/);
  assert.match(source, /async function tenCustomerControls\(run\)/);
  assert.match(source, /const key = left \? 'a' : 'd'/);
  assert.match(source, /activeCustomers !== 10/);
});

test('browser driver fails closed on unavailable resources and browser diagnostics', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/locked-performance-acceptance.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /jsHeapUsedBytes: Number\.isFinite\(performance\.memory\?\.usedJSHeapSize\)/);
  assert.match(source, /page\.on\('response'/);
  assert.match(source, /response\.status\(\) >= 400/);
  assert.match(source, /unexpectedWarnings/);
  assert.match(source, /diagnostics\.requestFailures\.map/);
  assert.match(source, /diagnostics\.httpErrors\.map/);
});
