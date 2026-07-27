import assert from 'node:assert/strict';
import test from 'node:test';

import { comparePerformanceRuns } from '../tools/qa/compare-performance-runs.mjs';

function report(overrides = {}) {
  return {
    ok: true,
    cases: [{
      key: '1600x900@60',
      performance: { averageFps: 100, onePercentLowFps: 60, worstFrameMs: 20 },
      renderer: { drawCalls: 100, triangles: 100_000 },
      scene: { materialCount: 40, estimatedTextureMipBytes: 50_000_000 },
      heapBytes: 100_000_000,
      activeListeners: 100,
      ...overrides,
    }],
  };
}

test('performance comparison accepts bounded measurement noise', () => {
  const result = comparePerformanceRuns(report(), report({
    performance: { averageFps: 94, onePercentLowFps: 55, worstFrameMs: 23 },
    renderer: { drawCalls: 104, triangles: 104_000 },
    scene: { materialCount: 41, estimatedTextureMipBytes: 52_000_000 },
    heapBytes: 110_000_000,
    activeListeners: 101,
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.regressions, []);
});

test('performance comparison fails closed on material frame and listener growth', () => {
  const result = comparePerformanceRuns(report(), report({
    performance: { averageFps: 75, onePercentLowFps: 40, worstFrameMs: 40 },
    renderer: { drawCalls: 120, triangles: 140_000 },
    scene: { materialCount: 47, estimatedTextureMipBytes: 60_000_000 },
    heapBytes: 140_000_000,
    activeListeners: 108,
  }));
  assert.equal(result.ok, false);
  assert.match(result.regressions.join('\n'), /average FPS/);
  assert.match(result.regressions.join('\n'), /active listeners/);
});

test('performance comparison classifies an uncorroborated cadence spike as noise', () => {
  const result = comparePerformanceRuns(report(), report({
    performance: { averageFps: 96, onePercentLowFps: 40, worstFrameMs: 30 },
  }));
  assert.equal(result.ok, true);
  assert.match(result.noiseWarnings.join('\n'), /uncorroborated/);
});
