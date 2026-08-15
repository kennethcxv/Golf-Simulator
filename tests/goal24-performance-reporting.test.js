import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareLockedEvaluationGates,
  compareMatrixFrameTiming,
  runMarkdown,
  validateMatrixRun,
} from '../tools/qa/goal24-interaction-performance.mjs';
import { LOCKED_INTERACTION_PERFORMANCE_PROTOCOL }
  from '../tools/qa/locked-performance-contract.mjs';

const matrixNames = [
  'matrix-1080p-windowed',
  'matrix-1440p-windowed',
  'matrix-4k-windowed',
  'matrix-4k-fullscreen',
];

function cadence(overrides = {}) {
  return {
    sampleCount: 120,
    medianMs: 10,
    p95Ms: 20,
    worstMs: 30,
    framesOver33Ms: 2,
    framesOver50Ms: 1,
    ...overrides,
  };
}

function thermalSummary(eventCount) {
  return {
    eventCount,
    interactionDuration: {
      sampleCount: eventCount,
      medianMs: 40,
      p95Ms: 50,
      worstMs: 60,
    },
    displayCadence: cadence(),
    renderCadence: cadence({ medianMs: 9, p95Ms: 18, worstMs: 28 }),
    eventsWithFrameOver33Ms: 2,
    eventsWithFrameOver50Ms: 1,
  };
}

function evaluation() {
  return {
    gates: LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.map((scenario) => ({
      scenario,
      ok: true,
      warmAcceptance: { applicable: true, targetWorstUnder33Pass: true },
      summary: {
        cold: thermalSummary(2),
        warm: thermalSummary(4),
      },
      ...(scenario === 'ledgerTurns50Stress' ? {
        resources: {
          metrics: {
            drawCallCount: {
              start: 80, end: 100, delta: 20, minimum: 78, maximum: 120,
              slopePerIteration: 0.4, persistent: false,
            },
            renderedTriangleCount: {
              start: 8_000, end: 10_000, delta: 2_000, minimum: 7_900, maximum: 12_000,
              slopePerIteration: 40, persistent: false,
            },
          },
        },
      } : {}),
    })),
  };
}

function reportFor(sourceEvaluation, prefix, runCountOverrides = {}) {
  return {
    scenarios: sourceEvaluation.gates.map((gate) => ({
      id: gate.scenario,
      events: ['cold', 'warm'].flatMap((thermalState) => {
        const count = gate.summary[thermalState]?.eventCount ?? 0;
        const distinctRuns = runCountOverrides[`${gate.scenario}:${thermalState}`]
          ?? Math.min(2, count);
        return Array.from({ length: count }, (_, index) => ({
          temperature: thermalState,
          source: { runId: `${prefix}-${thermalState}-${index % distinctRuns}` },
        }));
      }),
    })),
  };
}

function frameTimingRoutes() {
  return Object.fromEntries(['idle', 'indoorWalk', 'capLadder'].map((route) => [route, {
    labels: [`${route}-route`],
    cpuSubmit: { count: 120, p50: 1, p95: 2, worst: 3 },
    gpu: { count: 120, p50: 2, p95: 4, worst: 5 },
  }]));
}

function serializedMatrixEntry(name) {
  const counts = {
    displayFramesOver33Ms: 2,
    displayFramesOver50Ms: 1,
    renderFramesOver33Ms: 1,
    renderFramesOver50Ms: 0,
  };
  return {
    run: { name, leg: 'matrix' },
    matrix: {
      refreshHz: 60,
      indoorWalk: { ...counts },
      capLadder: {
        events: [60, 144, 0].map((requestedCap) => ({
          requestedCap,
          appliedCap: requestedCap,
          ...counts,
        })),
        skipped: [{ cap: 120, reason: '60 Hz display' }],
      },
      frameTiming: { routes: frameTimingRoutes() },
    },
  };
}

function rawMatrixFixture() {
  const metrics = (displayOver33 = 4, displayOver50 = 2, renderOver33 = 3,
    renderOver50 = 1) => ({
    displayRaf: {
      samples: 300,
      averageFps: 60,
      onePercentLowFps: 55,
      medianMs: 16,
      p95Ms: 17,
      worstMs: 52,
      over33: displayOver33,
      over50: displayOver50,
    },
    actualRender: {
      samples: 300,
      averageFps: 60,
      onePercentLowFps: 54,
      medianMs: 15.5,
      p95Ms: 17.2,
      worstMs: 51,
      over33: renderOver33,
      over50: renderOver50,
    },
  });
  const sampleDefinitions = [
    ['idle', 'idle-route'],
    ['indoorWalk', 'indoorWalk-route'],
    ['capLadder', 'capLadder-route'],
  ];
  const timingSamples = (offset) => sampleDefinitions.map(([scenario, label], index) => ({
    frameSequence: index + 1,
    durationMs: offset + index / 10,
    metadata: { scenario, label },
  }));
  return {
    windowRequest: { requested: { width: 1920, height: 1080, fullscreen: false } },
    gpuFrameTiming: {
      install: { requested: true, installed: true },
      evidence: {
        schemaVersion: 1,
        source: 'synchronous render hook',
        context: {
          version: 'WebGL 2.0',
          unmaskedVendor: 'GPU vendor',
          unmaskedRenderer: 'GPU renderer',
          drawingBufferWidth: 1920,
          drawingBufferHeight: 1080,
          proof: {
            webgl2VersionClaim: true,
            queryApiComplete: true,
            timerQueryExtensionAvailable: true,
          },
        },
        cpuSubmit: { validity: { valid: true }, rawSamples: timingSamples(1) },
        gpu: { validity: { valid: true }, rawSamples: timingSamples(0.5) },
        lifecycle: { disposed: true },
        cleanup: { leakFree: true, queriesCreated: 3, queriesDeleted: 3 },
        errors: [],
      },
    },
    scenarios: {
      idle: {
        events: [{
          durationMs: 5_000,
          metrics: metrics(),
          discriminator: { stationary: true, displacementYards: 0 },
        }],
      },
      indoorWalk: {
        events: [{
          durationMs: 60_000,
          metrics: metrics(8, 3, 6, 2),
          discriminator: {
            pathYards: 12,
            insidePct: 100,
            distinctPositionChanges: 120,
            trustedMovementKeydowns: 2,
          },
        }],
      },
      capLadder: {
        displayRefreshHz: 60,
        events: [60, 144, 0].map((requestedCap, index) => ({
          durationMs: 5_000,
          metrics: metrics(4 + index, 2 + index, 3 + index, 1 + index),
          discriminator: { requestedCap, appliedCap: requestedCap },
        })),
        skipped: [{ cap: 120, reason: '60 Hz display' }],
      },
    },
  };
}

function matrixEnvelope() {
  return {
    runner: {
      readbacks: {
        afterDriver: {
          renderer: {
            viewport: { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 },
          },
          main: {
            window: { mode: 'windowed' },
            display: {
              id: 7,
              bounds: { x: 0, y: 0, width: 1920, height: 1080 },
              workArea: { x: 0, y: 0, width: 1920, height: 1040 },
              scaleFactor: 1,
              displayFrequency: 60,
              rotation: 0,
              touchSupport: 'unknown',
            },
          },
        },
      },
    },
  };
}

test('comparison JSON retains complete cold/warm evidence and explicit deltas', () => {
  const reference = evaluation();
  const current = structuredClone(reference);
  const door = current.gates.find(({ scenario }) => scenario === 'doorApproach');
  door.summary.cold.eventCount = 3;
  Object.assign(door.summary.cold.displayCadence, {
    medianMs: 11,
    p95Ms: 22,
    worstMs: 32,
    framesOver33Ms: 1,
    framesOver50Ms: 0,
  });
  door.summary.cold.eventsWithFrameOver33Ms = 1;
  door.summary.cold.eventsWithFrameOver50Ms = 0;
  const currentStress = current.gates.find(({ scenario }) => scenario === 'ledgerTurns50Stress');
  currentStress.resources.metrics.drawCallCount = { end: 90, maximum: 108 };
  currentStress.resources.metrics.renderedTriangleCount = { end: 9_000, maximum: 11_000 };

  const comparison = compareLockedEvaluationGates(reference, current, {
    referenceReport: reportFor(reference, 'baseline'),
    currentReport: reportFor(current, 'candidate', { 'doorApproach:cold': 1 }),
  });
  const evidence = comparison.gates.find(
    ({ scenario }) => scenario === 'doorApproach',
  ).thermalComparisons.cold;
  assert.deepEqual(evidence.runCount, {
    before: 2,
    after: 1,
    absoluteDelta: -1,
    percentDelta: -50,
    percentDeltaStatus: 'defined',
  });
  assert.deepEqual(evidence.eventCount, {
    before: 2,
    after: 3,
    absoluteDelta: 1,
    percentDelta: 50,
    percentDeltaStatus: 'defined',
  });
  assert.equal(evidence.displayCadence.medianMs.absoluteDelta, 1);
  assert.equal(evidence.displayCadence.p95Ms.percentDelta, 10);
  assert.equal(evidence.displayCadence.worstMs.after, 32);
  assert.equal(evidence.displayCadence.framesOver33Ms.absoluteDelta, -1);
  assert.equal(evidence.displayCadence.framesOver50Ms.percentDelta, -100);
  assert.equal(evidence.recurringEvents.eventsWithFrameOver50Ms.after, 0);
  const drawCalls = comparison.gates.find(
    ({ scenario }) => scenario === 'ledgerTurns50Stress',
  ).resourceRows.find(({ metric }) => metric === 'drawCallCount');
  assert.equal(drawCalls.endComparison.absoluteDelta, -10);
  assert.equal(drawCalls.endComparison.percentDelta, -10);
  assert.equal(drawCalls.maximumComparison.absoluteDelta, -12);
});

test('comparison rejects an adversarial recurring >50 ms regression', () => {
  const reference = evaluation();
  const current = structuredClone(reference);
  const door = current.gates.find(({ scenario }) => scenario === 'doorApproach');
  door.summary.warm.displayCadence.framesOver50Ms = 2;
  door.summary.warm.eventsWithFrameOver50Ms = 2;
  const comparison = compareLockedEvaluationGates(reference, current, {
    referenceReport: reportFor(reference, 'baseline'),
    currentReport: reportFor(current, 'candidate'),
  });
  const row = comparison.gates.find(({ scenario }) => scenario === 'doorApproach');
  assert.equal(comparison.ok, false);
  assert.equal(row.warmDisplayCadence.framesOver50Pass, false);
  assert.equal(row.warmRecurringFramePass, false);
  assert.equal(
    row.thermalComparisons.warm.displayCadence.framesOver50Ms.absoluteDelta,
    1,
  );
});

test('matrix serialization retains walk and cap display/render hitch counts', () => {
  const matrix = validateMatrixRun(rawMatrixFixture(), matrixEnvelope(), {
    id: 'matrix-counts',
    name: 'matrix-1080p-windowed',
    leg: 'matrix',
    width: 1920,
    height: 1080,
    mode: 'windowed',
    env: {
      GOAL24_PERF_WALK_MS: '60000',
      GOAL24_PERF_GPU_FRAME_TIMING: '1',
    },
  });
  assert.equal(matrix.indoorWalk.displayFramesOver33Ms, 8);
  assert.equal(matrix.indoorWalk.displayFramesOver50Ms, 3);
  assert.equal(matrix.indoorWalk.renderFramesOver33Ms, 6);
  assert.equal(matrix.indoorWalk.renderFramesOver50Ms, 2);
  assert.equal(matrix.capLadder.events[1].displayFramesOver33Ms, 5);
  assert.equal(matrix.capLadder.events[1].displayFramesOver50Ms, 3);
  assert.equal(matrix.capLadder.events[1].renderFramesOver33Ms, 4);
  assert.equal(matrix.capLadder.events[1].renderFramesOver50Ms, 2);
});

test('matrix validation rejects missing and internally inconsistent hitch counts', () => {
  const missing = rawMatrixFixture();
  delete missing.scenarios.indoorWalk.events[0].metrics.displayRaf.over50;
  assert.throws(() => validateMatrixRun(missing, matrixEnvelope(), {
    id: 'matrix-missing-count',
    name: 'matrix-1080p-windowed',
    leg: 'matrix',
    width: 1920,
    height: 1080,
    mode: 'windowed',
    env: {
      GOAL24_PERF_WALK_MS: '60000',
      GOAL24_PERF_GPU_FRAME_TIMING: '1',
    },
  }), /over50 frame count is not measured/);

  const inconsistent = rawMatrixFixture();
  inconsistent.scenarios.capLadder.events[0].metrics.actualRender.over33 = 0;
  inconsistent.scenarios.capLadder.events[0].metrics.actualRender.over50 = 1;
  assert.throws(() => validateMatrixRun(inconsistent, matrixEnvelope(), {
    id: 'matrix-inconsistent-count',
    name: 'matrix-1080p-windowed',
    leg: 'matrix',
    width: 1920,
    height: 1080,
    mode: 'windowed',
    env: {
      GOAL24_PERF_WALK_MS: '60000',
      GOAL24_PERF_GPU_FRAME_TIMING: '1',
    },
  }), />50 ms count exceeds its >33 ms count/);
});

test('matrix comparison gates baseline/candidate >33 and >50 counts', () => {
  const reference = matrixNames.map(serializedMatrixEntry);
  const current = structuredClone(reference);
  const passing = compareMatrixFrameTiming(reference, current, {
    requireCadenceFrameCounts: true,
  });
  assert.equal(passing.ok, true);
  assert.equal(passing.rows.length, 4 * 3 * 2);
  assert.equal(passing.cadenceFrameCounts.rows.length, 4 * 4 * 2);

  current[2].matrix.capLadder.events[0].renderFramesOver50Ms = 1;
  const regression = compareMatrixFrameTiming(reference, current, {
    requireCadenceFrameCounts: true,
  });
  const row = regression.cadenceFrameCounts.rows.find((entry) => (
    entry.matrix === matrixNames[2]
      && entry.event === 'cap-60'
      && entry.stream === 'render'
  ));
  assert.equal(regression.ok, false);
  assert.equal(row.framesOver33Pass, true);
  assert.equal(row.framesOver50Pass, false);
  assert.equal(row.framesOver50Ms.absoluteDelta, 1);
  assert.equal(row.framesOver50Ms.percentDelta, null);
  assert.equal(row.framesOver50Ms.percentDeltaStatus, 'undefined-zero-baseline');
});

test('aggregate Markdown visibly reports all comparison and renderer-resource evidence', () => {
  const reference = evaluation();
  const current = structuredClone(reference);
  const currentStress = current.gates.find(({ scenario }) => scenario === 'ledgerTurns50Stress');
  currentStress.resources.metrics.drawCallCount.end = 90;
  currentStress.resources.metrics.renderedTriangleCount.end = 9_000;
  const comparison = compareLockedEvaluationGates(reference, current, {
    referenceReport: reportFor(reference, 'baseline'),
    currentReport: reportFor(current, 'candidate'),
  });
  comparison.matrixFrameTiming = compareMatrixFrameTiming(
    matrixNames.map(serializedMatrixEntry),
    matrixNames.map(serializedMatrixEntry),
    { requireCadenceFrameCounts: true },
  );
  const traceRun = {
    run: {
      ordinal: 5,
      leg: 'trace',
      id: 'trace-diagnostic',
      instrumentation: 'cdp-trace',
      width: 1920,
      height: 1080,
      mode: 'windowed',
    },
    ok: true,
    traceAttribution: {
      interactions: [{
        id: 'start-game-1',
        scenario: 'startGame',
        traceWindow: { durationMs: 812.5 },
        longestMainThreadTask: { durationMs: 47.25 },
        attribution: {
          cause: 'shader-material-warmup',
          confidence: 'strong',
          evidence: { category: 'gpu', name: 'CompileProgram' },
        },
      }],
    },
  };
  const markdown = runMarkdown({
    sessionId: 'reporting-test',
    phase: 'comparison',
    acceptance: { status: 'pass', evaluation: current },
    comparison,
    runs: [...matrixNames.map(serializedMatrixEntry), traceRun],
  });
  assert.match(markdown, /Source runs/);
  assert.match(markdown, /Frame median ms/);
  assert.match(markdown, /Frames >33 ms/);
  assert.match(markdown, /Frames >50 ms/);
  assert.match(markdown, /Recurring events >50 ms/);
  assert.match(markdown, /drawCallCount/);
  assert.match(markdown, /renderedTriangleCount/);
  assert.match(markdown, /100 \/ 90 \/ -10 \/ -10%/);
  assert.match(markdown, /Cap \| Display >33 \/ >50 \| Render >33 \/ >50/);
  assert.match(markdown, /Frames >50 baseline\/candidate\/absolute\/% delta/);
  assert.match(markdown, /Diagnostic Chromium trace attribution/);
  assert.match(markdown, /start-game-1 \| startGame \| 812\.5 \| 47\.25/);
  assert.match(markdown, /shader-material-warmup \| strong \| gpu \/ CompileProgram/);
});

test('baseline Markdown reports complete cold/warm, trace, and standalone resource evidence', () => {
  const baselineEvaluation = evaluation();
  const baselineReport = reportFor(baselineEvaluation, 'baseline');
  const traceRun = {
    run: {
      ordinal: 14,
      leg: 'trace',
      id: 'baseline-trace',
      instrumentation: 'cdp-trace',
      width: 1920,
      height: 1080,
      mode: 'windowed',
    },
    ok: true,
    traceAttribution: {
      interactions: [{
        id: 'start-game-1',
        scenario: 'startGame',
        traceWindow: { durationMs: 900 },
        longestMainThreadTask: { durationMs: 44.5 },
        attribution: {
          cause: 'navmesh-generation-query',
          confidence: 'strong',
          evidence: { category: 'renderer.scheduler', name: 'Recast navmesh build' },
        },
      }],
    },
  };
  const markdown = runMarkdown({
    sessionId: 'baseline-reporting-test',
    phase: 'baseline',
    acceptance: {
      status: 'pass',
      evaluation: baselineEvaluation,
      report: baselineReport,
    },
    comparison: null,
    runs: [traceRun],
  });
  assert.match(markdown, /Scenario \| State \| Source runs \| Events \| Interaction median ms/);
  assert.match(markdown, /Recurring events >33 ms \| Recurring events >50 ms/);
  assert.match(markdown, /startToControllable \| cold \| 2 \| 2 \| 40 \| 50 \| 60 \| 2 \| 1 \| 44\.5 \| navmesh-generation-query/);
  assert.match(markdown, /Scenario \| State \| Cadence \| Frame median ms \| Frame p95 ms \| Frame worst ms \| Frames >33 ms \| Frames >50 ms/);
  assert.match(markdown, /startToControllable \| cold \| display \| 10 \| 20 \| 30 \| 2 \| 1/);
  assert.match(markdown, /Scenario \| Resource \| Start \| End \| Delta \| Minimum \| Maximum \| Slope \/ iteration/);
  assert.match(markdown, /ledgerTurns50Stress \| drawCallCount \| 80 \| 100 \| 20 \| 78 \| 120 \| 0\.4 \| false/);
});
