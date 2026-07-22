import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScenarioComparison,
  median,
} from '../tools/qa/sheet06-performance-comparison.mjs';

const boundaryMedians = ({ ui = 0 } = {}) => ({
  averageFps: 100,
  onePercentLowFps: 80,
  worstFrameMs: 40,
  drawCalls: 100,
  renderedTriangles: 100,
  eventListeners: 10,
  sceneNodes: 100,
  geometriesInMemory: 100,
  materialCount: 100,
  textureCount: 100,
  uiMutationsPerSecond: ui,
});

test('median is deterministic for odd and even finite samples', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([8, 2, 4, 6]), 5);
  assert.throws(() => median([]), /at least one value/);
  assert.throws(() => median([1, Number.NaN]), /finite number/);
});

test('Sheet 6 common gates pass at their exact declared boundaries', () => {
  const before = boundaryMedians();
  const after = {
    ...before,
    averageFps: 85,
    onePercentLowFps: 60,
    worstFrameMs: 60,
    drawCalls: 120,
    renderedTriangles: 125,
    sceneNodes: 600,
    geometriesInMemory: 279,
    materialCount: 159,
    textureCount: 124,
  };
  const result = buildScenarioComparison('idle', before, after);
  assert.equal(result.pass, true);
  assert.equal(result.comparisons.length, 10);
  assert.ok(result.comparisons.every((comparison) => comparison.pass));
});

test('scenario-specific UI gates keep vacuum bounded and washer exact', () => {
  const vacuumBefore = boundaryMedians({ ui: 8 });
  const vacuumAfter = boundaryMedians({ ui: 9.22 });
  const vacuum = buildScenarioComparison('vacuum', vacuumBefore, vacuumAfter);
  assert.equal(vacuum.comparisons.find(({ metric }) => metric === 'uiMutationsPerSecond').pass, true);

  const washerBefore = boundaryMedians({ ui: 0 });
  const washerAfter = boundaryMedians({ ui: 0 });
  const washer = buildScenarioComparison('washer', washerBefore, washerAfter);
  const washerUi = washer.comparisons.find(({ metric }) => metric === 'uiMutationsPerSecond');
  assert.equal(washerUi.pass, true);
  assert.equal(washerUi.deltaPercent, null);

  washerAfter.uiMutationsPerSecond = 0.001;
  assert.equal(
    buildScenarioComparison('washer', washerBefore, washerAfter)
      .comparisons.find(({ metric }) => metric === 'uiMutationsPerSecond').pass,
    false,
  );
});
