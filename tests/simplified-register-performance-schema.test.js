import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERFORMANCE_SCHEMA_VERSION,
  HEAP_TRANSIENT_EXCESS_BUDGET_MIB,
  HEAP_TRACE_COVERAGE_TOLERANCE_MS,
  RENDER_CAPTURE_FRAME_COUNT,
  REQUIRED_DYNAMIC_PHASES,
  REQUIRED_DYNAMIC_WINDOWS,
  REQUIRED_PERFORMANCE_GATE_KEYS,
  buildDynamicGateReport,
  buildStaticPerformanceGateReport,
  buildMatchedHeapCalibration,
  buildStoredBaselineComparison,
  captureNormalizedTransactionBoundary,
  qualifyHeapControl,
  resolvePerformanceConfig,
  startDynamicProbe,
  summarizeHeapTrace,
  summarizeRenderFrameDistribution,
  transactionStabilityReport,
  validatePerformanceResultSchema,
} from '../tools/qa/simplified-register-performance.mjs';

const STATIC_SCENES = [
  'idleMonitor',
  'activeMonitor',
  'scanner',
  'card',
  'cardEntry',
  'cash',
  'cashDrawer',
];

function staticScene(overrides = {}) {
  const frameTimesMs = Array.from({ length: 20 }, () => 16.667);
  return {
    screenshot: 'static-scene.png',
    camera: {
      position: { x: 1, y: 2, z: 3 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      fovDegrees: 50,
      near: 0.1,
      far: 1000,
      ...overrides.camera,
    },
    samples: [{
      index: 1,
      summary: {
        avgFps: 59.999,
        onePercentLowFps: 59.999,
        worstFrameMs: 16.667,
      },
      frameTimesMs,
    }],
    aggregate: {
      avgFps: 59.999,
      onePercentLowFps: 59.999,
      p95FrameMs: 16.667,
      p99FrameMs: 16.667,
      worstFrameMs: 16.667,
      ...overrides.aggregate,
    },
    render: {
      drawCalls: 100,
      renderedTriangles: 1000,
      uniqueVisibleGeometries: 20,
      uniqueVisibleMaterials: 12,
      uniqueVisibleTextures: 8,
      estimatedVisibleTextureMiB: 32,
      frameDistribution: { frameCount: RENDER_CAPTURE_FRAME_COUNT },
      ...overrides.render,
    },
    heap: { jsHeapUsedMiB: 36, ...overrides.heap },
    listeners: { total: 10, ...overrides.listeners },
    dom: { elements: 20, ...overrides.dom },
    liveSceneResources: {
      objects: 100,
      meshes: 50,
      geometries: 25,
      materials: 15,
      textures: 8,
      rendererMemory: { geometries: 30, textures: 9 },
      ...overrides.liveSceneResources,
    },
    ui: {
      perSecond: {
        frontDeskMonitor: 0,
        scannerStatus: 0,
        cashWorkspace: 0,
        cardTerminal: 0,
      },
      ...overrides.ui,
    },
  };
}

function dynamicPhase(overrides = {}) {
  const frameTimesMs = Array.from({ length: 20 }, () => 16.667);
  const stateTimeline = frameTimesMs.map((frameTimeMs, index) => ({
    frameTimeMs,
    atMs: 1000 + (index + 1) * frameTimeMs,
  }));
  return {
    screenshot: 'dynamic-phase.png',
    aggregate: {
      frameCount: 20,
      avgFps: 60,
      onePercentLowFps: 45,
      p95FrameMs: 20,
      p99FrameMs: 30,
      worstFrameMs: 40,
      ...overrides.aggregate,
    },
    render: {
      drawCalls: 100,
      renderedTriangles: 1000,
      uniqueVisibleGeometries: 20,
      uniqueVisibleMaterials: 12,
      uniqueVisibleTextures: 8,
      frameDistribution: { frameCount: RENDER_CAPTURE_FRAME_COUNT },
      ...overrides.render,
    },
    resources: { before: {}, afterPostGc: {} },
    stability: { postGcHeapMiB: 0, listeners: 0, domElements: 0 },
    frameTimesMs,
    stateTimeline,
    heapTimeline: [
      { elapsedMs: 0, usedHeapBytes: 32 * 1048576, boundary: 'start' },
      ...Array.from({ length: 18 }, (_, index) => ({
        elapsedMs: (index + 1) * 50,
        usedHeapBytes: (32 + (index + 1) / 20) * 1048576,
        boundary: null,
      })),
      { elapsedMs: 1000, usedHeapBytes: 33 * 1048576, boundary: 'stop' },
    ],
    heapHighWater: {
      durationMs: 1000,
      samples: 20,
      startBytes: 32 * 1048576,
      endBytes: 33 * 1048576,
      peakBytes: 33 * 1048576,
      peakGrowthMiB: 1,
      endGrowthMiB: 1,
      maxDrawupMiB: 1,
      calibration: {
        dynamicDurationMs: 1000,
        controlDurationMs: 16000,
        durationMatched: true,
        controlStateStable: true,
        traceCoverageToleranceMs: HEAP_TRACE_COVERAGE_TOLERANCE_MS,
        actionTraceStrictlyIncreasing: true,
        controlTraceStrictlyIncreasing: true,
        actionTraceStartsAtZero: true,
        controlTraceStartsAtZero: true,
        actionTraceCoversDuration: true,
        controlTraceBoundaryBracketed: true,
        controlTraceCoversDuration: true,
        controlTraceCoversDeclaredDuration: true,
        traceCoverageMatched: true,
        actionTraceStartAtMs: 0,
        actionTraceEndAtMs: 1000,
        matchedControlStartAtMs: 0,
        matchedControlEndAtMs: 1000,
        matchedControlNextAtMs: 1000,
        actionTraceCoverageMs: 1000,
        controlTraceCoverageMs: 1000,
        controlFullTraceCoverageMs: 16000,
        qualified: true,
        actionMaxDrawupMiB: 3,
        controlMaxDrawupMiB: 2,
        excessMaxDrawupMiB: 1,
        budgetMiB: HEAP_TRANSIENT_EXCESS_BUDGET_MIB,
        matchedControlSamples: 20,
        actionSamples: 20,
      },
    },
    ui: { counts: {}, perSecond: {} },
    ...overrides,
  };
}

function dynamicWindow(overrides = {}) {
  const phase = dynamicPhase();
  return {
    ...phase,
    screenshot: 'dynamic-window.png',
    aggregate: { ...phase.aggregate, ...overrides.aggregate },
    longTasks: {
      supported: true,
      count: 0,
      totalDurationMs: 0,
      entries: [],
      ...overrides.longTasks,
    },
    ...overrides,
    aggregate: { ...phase.aggregate, ...overrides.aggregate },
    longTasks: {
      supported: true,
      count: 0,
      totalDurationMs: 0,
      entries: [],
      ...overrides.longTasks,
    },
  };
}

function normalizedTransactionBoundary(overrides = {}) {
  return {
    heap: {
      explicitGcRequested: true,
      explicitGcImmediatelyBeforeRead: true,
      jsHeapUsedMiB: 40,
    },
    heapNormalization: {
      kind: 'clear-diagnostics-precollect-settle-final-immediate-gc',
      settleMs: 600,
      dynamicDiagnosticsAvailable: true,
      dynamicDiagnosticsCleared: true,
      dynamicDiagnosticsWasRunning: false,
      clearedFrameSamples: 10,
      clearedStateSamples: 10,
      clearedHeapSamples: 12,
      preSettleExplicitGcSucceeded: true,
      finalExplicitGcImmediatelyBeforeRead: true,
    },
    listeners: { total: 10 },
    dom: { elements: 20 },
    liveSceneResources: {
      objects: 100,
      meshes: 50,
      geometries: 25,
      materials: 15,
      textures: 8,
      rendererMemory: { geometries: 30, textures: 9 },
    },
    state: {
      active: true,
      workspace: 'monitor',
      transactionNumber: null,
      transactionStage: null,
      customerCount: 0,
      drawerOpen: false,
    },
    ...overrides,
  };
}

function transactionDelta(overrides = {}) {
  return {
    postGcHeapMiB: 0,
    listeners: 0,
    domElements: 0,
    liveSceneObjects: 0,
    liveSceneMeshes: 0,
    liveGeometries: 0,
    liveMaterials: 0,
    liveTextures: 0,
    rendererGeometries: 0,
    rendererTextures: 0,
    ...overrides,
  };
}

function reentrySample(cycle, overrides = {}) {
  return {
    cycle,
    heap: { jsHeapUsedMiB: 40 },
    listeners: { total: 10 },
    dom: { elements: 20 },
    liveSceneResources: {
      geometries: 25,
      materials: 15,
      textures: 8,
      rendererMemory: { geometries: 30, textures: 9 },
    },
    ...overrides,
  };
}

function completeResult() {
  const start = normalizedTransactionBoundary();
  start.heapNormalization.dynamicDiagnosticsCleared = false;
  start.heapNormalization.clearedFrameSamples = 0;
  start.heapNormalization.clearedStateSamples = 0;
  start.heapNormalization.clearedHeapSamples = 0;
  const methodMatchedDelta = transactionDelta();
  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    protocol: {
      profile: 'master',
      browserMode: 'headed',
      viewport: { width: 1600, height: 900 },
      sampleCount: 1,
      reentryCycles: 20,
      heapControlMs: 16000,
      gcSettleMs: 600,
    },
    scenes: Object.fromEntries(STATIC_SCENES.map((key) => [key, staticScene()])),
    heapIdleControl: {
      stateStable: true,
      qualification: {
        qualified: true,
        endpointStateComplete: true,
        endpointStateStable: true,
        timelineStateComplete: true,
        timelineStateStable: true,
        cameraStable: true,
        drawerPrewarmStable: true,
        cashGpuPrewarmStable: true,
        prewarmReady: true,
        resourcesStable: true,
        listenerStable: true,
        domStable: true,
        timelineSamples: 2,
      },
      aggregate: { frameCount: 2 },
      frameTimesMs: [16, 16],
      stateTimeline: [
        { frameTimeMs: 16, atMs: 16 },
        { frameTimeMs: 16, atMs: 32 },
      ],
      stability: { listeners: 0, domElements: 0 },
      heapTimeline: [
        { elapsedMs: 0, usedHeapBytes: 32 * 1048576, boundary: 'start' },
        { elapsedMs: 16000, usedHeapBytes: 33 * 1048576, boundary: 'stop' },
      ],
      heapHighWater: {
        durationMs: 16000,
        samples: 2,
        startBytes: 32 * 1048576,
        endBytes: 33 * 1048576,
        peakBytes: 34 * 1048576,
        peakGrowthMiB: 2,
        endGrowthMiB: 1,
        maxDrawupMiB: 2,
      },
    },
    dynamicPhases: Object.fromEntries(REQUIRED_DYNAMIC_PHASES.map((key) => [key, dynamicPhase()])),
    dynamicWindows: Object.fromEntries(REQUIRED_DYNAMIC_WINDOWS.map((key) => [key, dynamicWindow()])),
    reentryLeak: {
      cycles: 20,
      samples: [reentrySample(0), reentrySample(20)],
      delta: {
        heapMiB: 0,
        listeners: 0,
        domElements: 0,
        liveGeometries: 0,
        liveMaterials: 0,
        liveTextures: 0,
        rendererGeometries: 0,
        rendererTextures: 0,
      },
    },
    transactionStability: {
      start,
      afterFirstSale: normalizedTransactionBoundary(),
      afterWarmSale: normalizedTransactionBoundary(),
      end: normalizedTransactionBoundary(),
      firstUseDelta: transactionDelta(),
      pathWarmupDelta: transactionDelta(),
      methodMatchedDelta,
      repeatSaleDelta: methodMatchedDelta,
      totalDelta: transactionDelta(),
      delta: methodMatchedDelta,
    },
    storedBaselineComparison: { available: true },
    errors: {
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      httpErrors: [],
      nonBenignRequestFailures: [],
    },
    build: {
      measuredFiles: [{
        path: 'tools/qa/simplified-register-performance.mjs',
        exists: true,
        sha256: '2'.repeat(64),
      }],
    },
    productionBuildHashes: { 'src/main.js': '0'.repeat(64) },
    productionBuildSnapshot: {
      schemaVersion: 2,
      algorithm: 'sha256',
      beforeAggregateHash: '1'.repeat(64),
      afterAggregateHash: '1'.repeat(64),
      beforeFileCount: 1,
      afterFileCount: 1,
      unchanged: true,
      changedFiles: [],
    },
  };
}

test('performance profiles are explicit and smoke preserves the dynamic route', () => {
  assert.equal(PERFORMANCE_SCHEMA_VERSION, 4);
  assert.equal(REQUIRED_DYNAMIC_WINDOWS.length, 6);
  assert.ok(REQUIRED_PERFORMANCE_GATE_KEYS.includes('dynamic_transactionRepeatRendererResidency'));
  const master = resolvePerformanceConfig({}, {});
  assert.equal(master.profile, 'master');
  assert.deepEqual(
    {
      sampleCount: master.sampleCount,
      sampleMs: master.sampleMs,
      warmupMs: master.warmupMs,
      gcSettleMs: master.gcSettleMs,
      reentryCycles: master.reentryCycles,
      heapControlMs: master.heapControlMs,
    },
    {
      sampleCount: 3,
      sampleMs: 2500,
      warmupMs: 1500,
      gcSettleMs: 600,
      reentryCycles: 20,
      heapControlMs: 24000,
    },
  );
  const smoke = resolvePerformanceConfig({ profile: 'smoke' }, {});
  assert.equal(smoke.sampleCount, 1);
  assert.equal(smoke.reentryCycles, 2);
  assert.equal(REQUIRED_DYNAMIC_PHASES.length, 15,
    'smoke changes sampling density, not required transition coverage');
  assert.equal(RENDER_CAPTURE_FRAME_COUNT, 24);
  assert.equal(resolvePerformanceConfig({ baselinePath: 'off' }, {}).baselinePath, null);
  assert.equal(resolvePerformanceConfig({ baselinePath: '' }, {}).baselinePath, null);
  assert.equal(resolvePerformanceConfig({}, {}).allocationSampling, false);
  assert.equal(resolvePerformanceConfig({}, { REGISTER_PERF_ALLOCATION_SAMPLING: '1' }).allocationSampling, true);
  assert.equal(resolvePerformanceConfig({}, { REGISTER_PERF_HEAP_CONTROL_MS: '17000' }).heapControlMs, 17000);
  assert.throws(() => resolvePerformanceConfig({ sampleMs: 100 }, {}), /sampleMs/);
  assert.throws(() => resolvePerformanceConfig({ gcSettleMs: 0 }, {}), /gcSettleMs/);
  assert.throws(() => resolvePerformanceConfig({ heapControlMs: 999 }, {}), /heapControlMs/);
});

test('dynamic recorder rejects a stale first rAF without seeding the accepted frame timeline', async () => {
  const descriptors = new Map([
    ['window', Object.getOwnPropertyDescriptor(globalThis, 'window')],
    ['performance', Object.getOwnPropertyDescriptor(globalThis, 'performance')],
    ['requestAnimationFrame', Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')],
    ['PerformanceObserver', Object.getOwnPropertyDescriptor(globalThis, 'PerformanceObserver')],
  ]);
  const restoreGlobals = () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
  const scheduledFrames = [];
  const heapBytes = 32 * 1048576;
  try {
    Object.defineProperties(globalThis, {
      window: {
        configurable: true,
        value: {
          __fw: { scene3d: { scene: { children: [] } } },
          __simplifiedRegisterPerf: {
            counters: {},
            reset() {},
          },
        },
      },
      performance: {
        configurable: true,
        value: {
          memory: { usedJSHeapSize: heapBytes },
          now: () => 1000,
        },
      },
      requestAnimationFrame: {
        configurable: true,
        value: (callback) => scheduledFrames.push(callback),
      },
      PerformanceObserver: {
        configurable: true,
        value: undefined,
      },
    });

    await startDynamicProbe({ evaluate: async (callback) => callback() });
    const state = globalThis.window.__simplifiedRegisterPerf.dynamic;
    const runScheduledFrame = (timestamp) => {
      const callback = scheduledFrames.shift();
      assert.equal(typeof callback, 'function', `expected a scheduled rAF for ${timestamp}`);
      callback(timestamp);
    };

    assert.equal(state.startedAt, 1000);
    assert.equal(state.previousAt, null);
    assert.equal(state.heapSampleTimeline.length, 1, 'only the explicit start boundary exists initially');

    runScheduledFrame(997);
    assert.equal(state.previousAt, null, 'the rejected pre-boundary callback cannot become a frame baseline');
    assert.deepEqual(state.frameTimesMs, []);
    assert.deepEqual(state.stateTimeline, []);
    assert.equal(state.heapSampleTimeline.length, 1, 'a rejected callback cannot become a heap sample');

    runScheduledFrame(1008);
    assert.equal(state.previousAt, 1008, 'the first accepted callback establishes the frame baseline');
    assert.deepEqual(state.frameTimesMs, []);
    assert.deepEqual(state.stateTimeline, []);
    assert.equal(state.heapSampleTimeline.length, 2, 'the first accepted callback remains a heap sample');

    runScheduledFrame(1024);
    assert.deepEqual(state.frameTimesMs, [16]);
    assert.equal(state.stateTimeline.length, state.frameTimesMs.length);
    assert.equal(state.stateTimeline[0].frameTimeMs, state.frameTimesMs[0]);
    assert.equal(state.stateTimeline[0].atMs, 1024);
    assert.equal(state.heapSampleTimeline.length, 3);
  } finally {
    restoreGlobals();
  }
});

test('transaction boundaries clear finished recorder arrays and bracket the read with successful collections', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const dynamic = {
    running: false,
    frameTimesMs: [16, 17],
    stateTimeline: [{}, {}],
    heapSampleTimeline: [{}, {}, {}],
  };
  const gcCalls = [];
  const settleCalls = [];
  const snapshotOptions = [];
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __simplifiedRegisterPerf: { dynamic } },
    });
    const page = {
      evaluate: async (callback) => callback(),
      waitForTimeout: async (milliseconds) => settleCalls.push(milliseconds),
    };
    const cdp = {
      send: async (method) => {
        gcCalls.push(method);
        return {};
      },
    };
    const captureSnapshot = async (_page, innerCdp, options) => {
      snapshotOptions.push(options);
      await innerCdp.send('HeapProfiler.collectGarbage');
      return normalizedTransactionBoundary({
        heap: {
          explicitGcRequested: true,
          explicitGcImmediatelyBeforeRead: true,
          jsHeapUsedMiB: 41,
        },
      });
    };

    const boundary = await captureNormalizedTransactionBoundary(page, cdp, {
      settleMs: 750,
      captureSnapshot,
    });
    assert.equal(globalThis.window.__simplifiedRegisterPerf.dynamic, null);
    assert.deepEqual(gcCalls, [
      'HeapProfiler.collectGarbage',
      'HeapProfiler.collectGarbage',
    ]);
    assert.deepEqual(settleCalls, [750]);
    assert.deepEqual(snapshotOptions, [{ collectGarbage: true }]);
    assert.deepEqual(
      {
        cleared: boundary.heapNormalization.dynamicDiagnosticsCleared,
        frames: boundary.heapNormalization.clearedFrameSamples,
        states: boundary.heapNormalization.clearedStateSamples,
        heap: boundary.heapNormalization.clearedHeapSamples,
        preGc: boundary.heapNormalization.preSettleExplicitGcSucceeded,
        finalGc: boundary.heapNormalization.finalExplicitGcImmediatelyBeforeRead,
      },
      { cleared: true, frames: 2, states: 2, heap: 3, preGc: true, finalGc: true },
    );

    globalThis.window.__simplifiedRegisterPerf.dynamic = { running: true };
    await assert.rejects(
      () => captureNormalizedTransactionBoundary(page, cdp, { captureSnapshot }),
      /dynamic probe is running/,
    );
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else delete globalThis.window;
  }
});

test('transaction stability gates the method-matched approved-card boundary pair', () => {
  const boundary = (heapMiB, listeners, objects, rendererGeometries) => (
    normalizedTransactionBoundary({
      heap: {
        explicitGcRequested: true,
        explicitGcImmediatelyBeforeRead: true,
        jsHeapUsedMiB: heapMiB,
      },
      listeners: { total: listeners },
      liveSceneResources: {
        ...normalizedTransactionBoundary().liveSceneResources,
        objects,
        rendererMemory: { geometries: rendererGeometries, textures: 9 },
      },
    })
  );
  const start = boundary(40, 10, 100, 30);
  const afterFirstSale = boundary(50, 10, 105, 35);
  const afterWarmSale = boundary(46, 10, 101, 31);
  const end = boundary(47.5, 10, 102, 32);
  const report = transactionStabilityReport(start, afterFirstSale, afterWarmSale, end);

  assert.equal(report.firstUseDelta.postGcHeapMiB, 10);
  assert.equal(report.pathWarmupDelta.postGcHeapMiB, -4);
  assert.equal(report.methodMatchedDelta.postGcHeapMiB, 1.5);
  assert.equal(report.methodMatchedDelta.liveSceneObjects, 1);
  assert.equal(report.methodMatchedDelta.rendererGeometries, 1);
  assert.strictEqual(report.repeatSaleDelta, report.methodMatchedDelta);
  assert.strictEqual(report.delta, report.methodMatchedDelta);
  assert.equal(report.totalDelta.postGcHeapMiB, 7.5);
});

test('render snapshots use the non-shadow median and retain the scheduled-bake tail', () => {
  const ordinary = Array.from({ length: 20 }, (_, index) => ({
    calls: 1000 + (index % 3),
    triangles: 2000 + (index % 3),
    lines: 0,
    points: 0,
    scheduledShadowBake: false,
  }));
  const shadow = Array.from({ length: 4 }, () => ({
    calls: 5000,
    triangles: 9000,
    lines: 0,
    points: 0,
    scheduledShadowBake: true,
  }));
  const summary = summarizeRenderFrameDistribution([...ordinary, ...shadow]);
  assert.equal(summary.drawCalls, 1001);
  assert.equal(summary.renderedTriangles, 2001);
  assert.equal(summary.frameDistribution.frameCount, RENDER_CAPTURE_FRAME_COUNT);
  assert.equal(summary.frameDistribution.typicalFrameCount, 20);
  assert.equal(summary.frameDistribution.scheduledShadowFrameCount, 4);
  assert.equal(summary.frameDistribution.calls.max, 5000);
  assert.equal(summary.frameDistribution.scheduledShadowCalls.median, 5000);
});

test('matched heap calibration removes ambient GC sawtooth but still fails a real transient excess', () => {
  const mib = (value) => value * 1048576;
  const trace = (values) => values.map(([elapsedMs, value]) => ({
    elapsedMs,
    usedHeapBytes: mib(value),
  }));
  const control = trace([
    [0, 100],
    [200, 90],
    [500, 108],
    [800, 80],
    [1000, 110],
    [2000, 180],
    [16000, 100],
  ]);
  const ordinaryAction = trace([
    [0, 102],
    [200, 88],
    [600, 112],
    [800, 81],
    [1000, 121],
  ]);
  const raw = summarizeHeapTrace(ordinaryAction);
  assert.equal(raw.peakGrowthMiB, 19);
  assert.equal(raw.maxDrawupMiB, 40,
    'draw-up starts at the latest sampled trough rather than an arbitrary first sample');

  const calibrated = buildMatchedHeapCalibration(ordinaryAction, control, {
    dynamicDurationMs: 1000,
    controlDurationMs: 16000,
    controlStateStable: true,
  });
  assert.equal(calibrated.controlMaxDrawupMiB, 30,
    'the later unmatched control spike is excluded by the exact-duration prefix');
  assert.equal(calibrated.excessMaxDrawupMiB, 10);
  assert.equal(calibrated.pass, true);

  const regression = buildMatchedHeapCalibration(trace([
    [0, 102],
    [200, 80],
    [1000, 127],
  ]), control, {
    dynamicDurationMs: 1000,
    controlDurationMs: 16000,
    controlStateStable: true,
  });
  assert.equal(regression.excessMaxDrawupMiB, 17);
  assert.equal(regression.pass, false,
    'a transient allocation more than 16 MiB above ambient remains a hard failure');

  assert.equal(buildMatchedHeapCalibration(ordinaryAction, control, {
    dynamicDurationMs: 1000,
    controlDurationMs: 999,
    controlStateStable: true,
  }).qualified, false, 'short control coverage fails closed');
  assert.equal(buildMatchedHeapCalibration(ordinaryAction, control, {
    dynamicDurationMs: 1000,
    controlDurationMs: 16000,
    controlStateStable: false,
  }).qualified, false, 'a changing control state fails closed');

  assert.equal(calibrated.traceCoverageToleranceMs, HEAP_TRACE_COVERAGE_TOLERANCE_MS);
  assert.equal(calibrated.traceCoverageMatched, true);
  assert.equal(calibrated.actionTraceCoverageMs, 1000);
  assert.equal(calibrated.controlTraceCoverageMs, 1000);

  const truncatedControl = buildMatchedHeapCalibration(ordinaryAction, trace([
    [0, 100],
    [500, 110],
  ]), {
    dynamicDurationMs: 1000,
    controlDurationMs: 16000,
    controlStateStable: true,
  });
  assert.equal(truncatedControl.controlTraceCoversDuration, false);
  assert.equal(truncatedControl.qualified, false,
    'declared control metadata cannot substitute for actual sampled trace coverage');

  const shortenedDeclaredControl = buildMatchedHeapCalibration(ordinaryAction, trace([
    [0, 100],
    [1000, 110],
    [2000, 120],
  ]), {
    dynamicDurationMs: 1000,
    controlDurationMs: 16000,
    controlStateStable: true,
  });
  assert.equal(shortenedDeclaredControl.controlTraceCoversDuration, true);
  assert.equal(shortenedDeclaredControl.controlTraceCoversDeclaredDuration, false);
  assert.equal(shortenedDeclaredControl.qualified, false,
    'a control prefix cannot qualify when the full declared control capture is truncated');

  const unbracketedControl = buildMatchedHeapCalibration(ordinaryAction, trace([
    [0, 100],
    [950, 110],
    [16000, 120],
  ]), {
    dynamicDurationMs: 1000,
    controlDurationMs: 16000,
    controlStateStable: true,
  });
  assert.equal(unbracketedControl.matchedControlEndAtMs, 950);
  assert.equal(unbracketedControl.controlTraceBoundaryBracketed, false);
  assert.equal(unbracketedControl.qualified, false,
    'a near sample before the boundary is insufficient without a near sample after it');

  const missingActionEndpoint = buildMatchedHeapCalibration(trace([
    [0, 100],
    [899, 110],
  ]), control, {
    dynamicDurationMs: 1000,
    controlDurationMs: 16000,
    controlStateStable: true,
  });
  assert.equal(missingActionEndpoint.actionTraceCoversDuration, false);
  assert.equal(missingActionEndpoint.qualified, false,
    'an action trace ending outside the stated final-sample tolerance fails closed');

  const duplicateTimestamp = buildMatchedHeapCalibration(trace([
    [0, 100],
    [500, 105],
    [500, 106],
    [1000, 110],
  ]), control, {
    dynamicDurationMs: 1000,
    controlDurationMs: 16000,
    controlStateStable: true,
  });
  assert.equal(duplicateTimestamp.actionTraceStrictlyIncreasing, false);
  assert.equal(duplicateTimestamp.qualified, false,
    'duplicate sample timestamps fail strict trace ordering');

  const duplicateControlTimestamp = buildMatchedHeapCalibration(ordinaryAction, trace([
    [0, 100],
    [500, 105],
    [500, 106],
    [1000, 110],
    [16000, 120],
  ]), {
    dynamicDurationMs: 1000,
    controlDurationMs: 16000,
    controlStateStable: true,
  });
  assert.equal(duplicateControlTimestamp.controlTraceStrictlyIncreasing, false);
  assert.equal(duplicateControlTimestamp.qualified, false,
    'duplicate control timestamps fail strict trace ordering');

  const nonzeroStart = buildMatchedHeapCalibration(trace([
    [1, 100],
    [1000, 110],
  ]), control, {
    dynamicDurationMs: 1000,
    controlDurationMs: 16000,
    controlStateStable: true,
  });
  assert.equal(nonzeroStart.actionTraceStartsAtZero, false);
  assert.equal(nonzeroStart.qualified, false,
    'a missing explicit start-boundary sample fails closed');

  const nonzeroControlStart = buildMatchedHeapCalibration(ordinaryAction, trace([
    [1, 100],
    [1000, 110],
    [16000, 120],
  ]), {
    dynamicDurationMs: 1000,
    controlDurationMs: 16000,
    controlStateStable: true,
  });
  assert.equal(nonzeroControlStart.controlTraceStartsAtZero, false);
  assert.equal(nonzeroControlStart.qualified, false,
    'a control trace without an explicit zero-time sample fails closed');
});

test('heap control qualification audits every state sample, prewarm readiness, and resources', () => {
  const state = {
    active: true,
    workspace: 'monitor',
    transactionNumber: 7,
    transactionStage: 'scan',
    checkoutFlowState: 'Scanning',
    deliveryPhase: null,
    drawerOpen: false,
    tenderDeposited: false,
    customerCount: 1,
    sceneChildren: 8,
    drawerPrewarm: { complete: true, pendingTextures: 0 },
    cashGpuPrewarm: { ready: true, complete: true, built: 8 },
  };
  const camera = {
    position: { x: 1, y: 2, z: 3 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    fovDegrees: 48,
  };
  const resources = {
    objects: 100,
    meshes: 60,
    geometries: 40,
    materials: 30,
    textures: 20,
    rendererMemory: { geometries: 45, textures: 22 },
  };
  const timelineState = Object.fromEntries(Object.entries(state).filter(
    ([key]) => !['drawerPrewarm', 'cashGpuPrewarm'].includes(key),
  ));
  const control = {
    stateBefore: structuredClone(state),
    stateAfter: structuredClone(state),
    cameraBefore: structuredClone(camera),
    cameraAfter: structuredClone(camera),
    stateTimeline: [
      { ...timelineState, atMs: 16, frameTimeMs: 16 },
      { ...timelineState, atMs: 32, frameTimeMs: 16 },
    ],
    resources: {
      before: structuredClone(resources),
      after: structuredClone(resources),
    },
    stability: { listeners: 0, domElements: 0 },
  };
  assert.equal(qualifyHeapControl(control).qualified, true);

  const transientState = structuredClone(control);
  transientState.stateTimeline[0].workspace = 'cash';
  const transientQualification = qualifyHeapControl(transientState);
  assert.equal(transientQualification.endpointStateStable, true);
  assert.equal(transientQualification.timelineStateStable, false);
  assert.equal(transientQualification.qualified, false,
    'returning to the same endpoint cannot hide a transient control-state change');

  const pendingPrewarm = structuredClone(control);
  pendingPrewarm.stateAfter.drawerPrewarm.complete = false;
  assert.equal(qualifyHeapControl(pendingPrewarm).qualified, false,
    'changing or incomplete prewarm state fails control qualification');

  const resourceGrowth = structuredClone(control);
  resourceGrowth.resources.after.geometries += 1;
  assert.equal(qualifyHeapControl(resourceGrowth).qualified, false,
    'live resource growth during the no-action window fails control qualification');

  const listenerGrowth = structuredClone(control);
  listenerGrowth.stability.listeners = 1;
  const listenerQualification = qualifyHeapControl(listenerGrowth);
  assert.equal(listenerQualification.listenerStable, false);
  assert.equal(listenerQualification.domStable, true);
  assert.equal(listenerQualification.qualified, false,
    'listener growth during the no-action window fails control qualification');

  const domGrowth = structuredClone(control);
  domGrowth.stability.domElements = 1;
  const domQualification = qualifyHeapControl(domGrowth);
  assert.equal(domQualification.listenerStable, true);
  assert.equal(domQualification.domStable, false);
  assert.equal(domQualification.qualified, false,
    'DOM growth during the no-action window fails control qualification');
});

test('schema requires every static resource metric and critical dynamic phase', () => {
  const valid = completeResult();
  assert.deepEqual(validatePerformanceResultSchema(valid), { valid: true, issues: [] });

  delete valid.dynamicPhases.cashDeposit;
  delete valid.scenes.card.render.uniqueVisibleTextures;
  valid.scenes.cash.render.frameDistribution.frameCount = 1;
  valid.dynamicPhases.cardInsertion.heapHighWater.peakGrowthMiB = null;
  delete valid.dynamicPhases.cardResult.heapHighWater.calibration.traceCoverageMatched;
  valid.dynamicPhases.cardHandoff.heapTimeline.at(-1).boundary = null;
  const invalid = validatePerformanceResultSchema(valid);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => issue.includes('dynamicPhases.cashDeposit')));
  assert.ok(invalid.issues.some((issue) => issue.includes('scenes.card.render.uniqueVisibleTextures')));
  assert.ok(invalid.issues.some((issue) => issue.includes('scenes.cash.render.frameDistribution.frameCount')));
  assert.ok(invalid.issues.some((issue) => issue.includes('dynamicPhases.cardInsertion.heapHighWater.peakGrowthMiB')));
  assert.ok(invalid.issues.some((issue) => issue.includes('dynamicPhases.cardResult.heapHighWater.calibration')));
  assert.ok(invalid.issues.some((issue) => issue.includes('dynamicPhases.cardHandoff.heapTimeline')));

  const missingCalibration = completeResult();
  delete missingCalibration.dynamicPhases.cardInsertion.heapHighWater.calibration;
  delete missingCalibration.heapIdleControl.qualification;
  const missingCalibrationResult = validatePerformanceResultSchema(missingCalibration);
  assert.equal(missingCalibrationResult.valid, false);
  assert.ok(missingCalibrationResult.issues.some((issue) => issue.includes('heapHighWater.calibration')));
  assert.ok(missingCalibrationResult.issues.some((issue) => issue.includes('heapIdleControl.qualification')));

  const missingBoundary = completeResult();
  delete missingBoundary.transactionStability.afterFirstSale;
  delete missingBoundary.transactionStability.afterWarmSale;
  delete missingBoundary.transactionStability.methodMatchedDelta;
  delete missingBoundary.transactionStability.repeatSaleDelta;
  const missingBoundaryResult = validatePerformanceResultSchema(missingBoundary);
  assert.equal(missingBoundaryResult.valid, false);
  assert.ok(missingBoundaryResult.issues.some((issue) => issue.includes('afterFirstSale')));
  assert.ok(missingBoundaryResult.issues.some((issue) => issue.includes('afterWarmSale')));
  assert.ok(missingBoundaryResult.issues.some((issue) => issue.includes('methodMatchedDelta')));
  assert.ok(missingBoundaryResult.issues.some((issue) => issue.includes('repeatSaleDelta')));

  const incompleteOverlayEvidence = completeResult();
  delete incompleteOverlayEvidence.protocol.viewport;
  delete incompleteOverlayEvidence.scenes.activeMonitor.screenshot;
  delete incompleteOverlayEvidence.dynamicWindows.cardApprovedRepeat;
  delete incompleteOverlayEvidence.reentryLeak;
  delete incompleteOverlayEvidence.build.measuredFiles;
  const incompleteOverlayEvidenceResult = validatePerformanceResultSchema(incompleteOverlayEvidence);
  assert.equal(incompleteOverlayEvidenceResult.valid, false);
  for (const expected of [
    'protocol.viewport.width',
    'scenes.activeMonitor.screenshot',
    'dynamicWindows.cardApprovedRepeat',
    'reentryLeak',
    'build.measuredFiles',
  ]) {
    assert.ok(incompleteOverlayEvidenceResult.issues.some((issue) => issue.includes(expected)), expected);
  }

  const invalidNormalization = completeResult();
  invalidNormalization.transactionStability.afterWarmSale.heap.explicitGcImmediatelyBeforeRead = false;
  invalidNormalization.transactionStability.end.heapNormalization.preSettleExplicitGcSucceeded = false;
  const invalidNormalizationResult = validatePerformanceResultSchema(invalidNormalization);
  assert.equal(invalidNormalizationResult.valid, false);
  assert.ok(invalidNormalizationResult.issues.some((issue) => (
    issue.includes('afterWarmSale.heap must prove a successful explicit GC')
  )));
  assert.ok(invalidNormalizationResult.issues.some((issue) => (
    issue.includes('end.heapNormalization')
  )));

  const normalizedStartWithoutPriorRecorder = completeResult();
  assert.equal(
    normalizedStartWithoutPriorRecorder.transactionStability.start
      .heapNormalization.dynamicDiagnosticsCleared,
    false,
  );
  assert.deepEqual(
    validatePerformanceResultSchema(normalizedStartWithoutPriorRecorder),
    { valid: true, issues: [] },
    'the start boundary is valid before any dynamic recorder exists',
  );

  const unclearedDiagnostics = completeResult();
  unclearedDiagnostics.transactionStability.afterFirstSale.heapNormalization.dynamicDiagnosticsCleared = false;
  const unclearedDiagnosticsResult = validatePerformanceResultSchema(unclearedDiagnostics);
  assert.equal(unclearedDiagnosticsResult.valid, false);
  assert.ok(unclearedDiagnosticsResult.issues.some((issue) => (
    issue.includes('afterFirstSale.heapNormalization')
  )));

  for (const [field, value] of [
    ['dynamicDiagnosticsAvailable', false],
    ['dynamicDiagnosticsWasRunning', true],
    ['finalExplicitGcImmediatelyBeforeRead', false],
  ]) {
    const invalidProof = completeResult();
    invalidProof.transactionStability.afterWarmSale.heapNormalization[field] = value;
    const invalidProofResult = validatePerformanceResultSchema(invalidProof);
    assert.equal(invalidProofResult.valid, false, `${field} must fail closed`);
    assert.ok(invalidProofResult.issues.some((issue) => (
      issue.includes('afterWarmSale.heapNormalization')
    )), `${field} must produce a boundary-specific issue`);
  }

  const driftedAliases = completeResult();
  driftedAliases.transactionStability.repeatSaleDelta = { postGcHeapMiB: 3 };
  driftedAliases.transactionStability.delta = { postGcHeapMiB: 4 };
  const driftedAliasesResult = validatePerformanceResultSchema(driftedAliases);
  assert.equal(driftedAliasesResult.valid, false);
  assert.ok(driftedAliasesResult.issues.some((issue) => issue.includes('repeatSaleDelta must alias')));
  assert.ok(driftedAliasesResult.issues.some((issue) => issue.includes('delta must alias')));

  const missingDeltaEvidence = completeResult();
  missingDeltaEvidence.transactionStability.methodMatchedDelta.postGcHeapMiB = null;
  const missingDeltaEvidenceResult = validatePerformanceResultSchema(missingDeltaEvidence);
  assert.equal(missingDeltaEvidenceResult.valid, false);
  assert.ok(missingDeltaEvidenceResult.issues.some((issue) => (
    issue.includes('methodMatchedDelta.postGcHeapMiB must be finite')
  )));

  const malformedBoundaryEvidence = completeResult();
  malformedBoundaryEvidence.transactionStability.end.liveSceneResources.rendererMemory.textures = -1;
  malformedBoundaryEvidence.transactionStability.end.heapNormalization.clearedFrameSamples = 1.5;
  const malformedBoundaryEvidenceResult = validatePerformanceResultSchema(malformedBoundaryEvidence);
  assert.equal(malformedBoundaryEvidenceResult.valid, false);
  assert.ok(malformedBoundaryEvidenceResult.issues.some((issue) => (
    issue.includes('end.liveSceneResources.rendererMemory.textures')
  )));
  assert.ok(malformedBoundaryEvidenceResult.issues.some((issue) => (
    issue.includes('end.heapNormalization.clearedFrameSamples')
  )));

  const emptyRecorderProof = completeResult();
  emptyRecorderProof.transactionStability.afterWarmSale.heapNormalization.clearedFrameSamples = 0;
  emptyRecorderProof.transactionStability.afterWarmSale.heapNormalization.clearedStateSamples = 0;
  emptyRecorderProof.transactionStability.afterWarmSale.heapNormalization.clearedHeapSamples = 0;
  const emptyRecorderProofResult = validatePerformanceResultSchema(emptyRecorderProof);
  assert.equal(emptyRecorderProofResult.valid, false);
  assert.ok(emptyRecorderProofResult.issues.some((issue) => (
    issue.includes('non-empty completed recorder timelines')
  )));

  const spoofedMethodMatchedDelta = completeResult();
  spoofedMethodMatchedDelta.transactionStability.methodMatchedDelta.postGcHeapMiB = 2;
  const spoofedMethodMatchedDeltaResult = validatePerformanceResultSchema(spoofedMethodMatchedDelta);
  assert.equal(spoofedMethodMatchedDeltaResult.valid, false);
  assert.ok(spoofedMethodMatchedDeltaResult.issues.some((issue) => (
    issue.includes('methodMatchedDelta.postGcHeapMiB must equal the boundary-derived delta')
  )));

  const dirtyMethodMatchedBoundary = completeResult();
  dirtyMethodMatchedBoundary.transactionStability.afterWarmSale.state.customerCount = 1;
  const dirtyMethodMatchedBoundaryResult = validatePerformanceResultSchema(dirtyMethodMatchedBoundary);
  assert.equal(dirtyMethodMatchedBoundaryResult.valid, false);
  assert.ok(dirtyMethodMatchedBoundaryResult.issues.some((issue) => (
    issue.includes('afterWarmSale.state must be the clean active monitor')
  )));

  const truncatedControl = completeResult();
  truncatedControl.heapIdleControl.heapTimeline[1].elapsedMs = 8000;
  const truncatedControlResult = validatePerformanceResultSchema(truncatedControl);
  assert.equal(truncatedControlResult.valid, false);
  assert.ok(truncatedControlResult.issues.some((issue) => issue.includes('declared duration')));

  const mismatchedFrameTimeline = completeResult();
  mismatchedFrameTimeline.dynamicPhases.cardInsertion.stateTimeline.pop();
  mismatchedFrameTimeline.dynamicPhases.cashDeposit.frameTimesMs[0] = 0;
  mismatchedFrameTimeline.dynamicPhases.cardResult.aggregate.frameCount = 19;
  const mismatchedFrameTimelineResult = validatePerformanceResultSchema(mismatchedFrameTimeline);
  assert.equal(mismatchedFrameTimelineResult.valid, false);
  assert.ok(mismatchedFrameTimelineResult.issues.some(
    (issue) => issue.includes('dynamicPhases.cardInsertion.frameTimesMs and stateTimeline'),
  ));
  assert.ok(mismatchedFrameTimelineResult.issues.some(
    (issue) => issue.includes('dynamicPhases.cashDeposit.frameTimesMs and stateTimeline'),
  ));
  assert.ok(mismatchedFrameTimelineResult.issues.some(
    (issue) => issue.includes('dynamicPhases.cardResult.aggregate.frameCount'),
  ));
});

test('schema binds the declared heap-control protocol to measured control evidence', () => {
  const nonfiniteProtocol = completeResult();
  delete nonfiniteProtocol.protocol.heapControlMs;
  let validation = validatePerformanceResultSchema(nonfiniteProtocol);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.includes('protocol.heapControlMs must be finite')));

  const missingGcSettle = completeResult();
  delete missingGcSettle.protocol.gcSettleMs;
  validation = validatePerformanceResultSchema(missingGcSettle);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.includes('protocol.gcSettleMs must be finite')));

  const mismatchedGcSettle = completeResult();
  mismatchedGcSettle.transactionStability.afterWarmSale.heapNormalization.settleMs = 601;
  validation = validatePerformanceResultSchema(mismatchedGcSettle);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => (
    issue.includes('afterWarmSale.heapNormalization.settleMs must equal protocol.gcSettleMs')
  )));

  const nonpositiveProtocol = completeResult();
  nonpositiveProtocol.protocol.heapControlMs = 0;
  validation = validatePerformanceResultSchema(nonpositiveProtocol);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.includes('protocol.heapControlMs must be positive')));

  const measuredControlMismatch = completeResult();
  measuredControlMismatch.heapIdleControl.heapHighWater.durationMs = 15000;
  measuredControlMismatch.heapIdleControl.heapTimeline.at(-1).elapsedMs = 15000;
  validation = validatePerformanceResultSchema(measuredControlMismatch);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some(
    (issue) => issue.includes('heapIdleControl.heapHighWater.durationMs must match protocol.heapControlMs'),
  ));

  const calibrationMismatch = completeResult();
  calibrationMismatch.dynamicPhases.cardInsertion.heapHighWater.calibration.controlDurationMs = 15000;
  validation = validatePerformanceResultSchema(calibrationMismatch);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some(
    (issue) => issue.includes('dynamicPhases.cardInsertion.heapHighWater.calibration.controlDurationMs'),
  ));

  const incompleteControlFrames = completeResult();
  incompleteControlFrames.heapIdleControl.stateTimeline.pop();
  validation = validatePerformanceResultSchema(incompleteControlFrames);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some(
    (issue) => issue.includes('heapIdleControl.frameTimesMs and stateTimeline'),
  ));
  assert.ok(validation.issues.some(
    (issue) => issue.includes('heapIdleControl.qualification.timelineSamples'),
  ));

  const unstableControl = completeResult();
  unstableControl.heapIdleControl.stability.listeners = 1;
  unstableControl.heapIdleControl.stability.domElements = 1;
  validation = validatePerformanceResultSchema(unstableControl);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.includes('stability.listeners must be zero')));
  assert.ok(validation.issues.some((issue) => issue.includes('stability.domElements must be zero')));

  const withinTolerance = completeResult();
  withinTolerance.protocol.heapControlMs += HEAP_TRACE_COVERAGE_TOLERANCE_MS;
  assert.deepEqual(validatePerformanceResultSchema(withinTolerance), { valid: true, issues: [] },
    'the declared and measured durations may differ by exactly the existing coverage tolerance');
});

test('schema requires the complete cashier production snapshot v2 envelope', () => {
  const stalePerformanceSchema = completeResult();
  stalePerformanceSchema.schemaVersion = PERFORMANCE_SCHEMA_VERSION - 1;
  let validation = validatePerformanceResultSchema(stalePerformanceSchema);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.includes('schemaVersion must be')));

  const missingHashes = completeResult();
  delete missingHashes.productionBuildHashes;
  validation = validatePerformanceResultSchema(missingHashes);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.includes('productionBuildHashes')));

  const wrongVersion = completeResult();
  wrongVersion.productionBuildSnapshot.schemaVersion = 1;
  validation = validatePerformanceResultSchema(wrongVersion);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => (
    issue.includes('productionBuildSnapshot.schemaVersion')
  )));

  const truncatedMap = completeResult();
  truncatedMap.productionBuildSnapshot.beforeFileCount = 2;
  validation = validatePerformanceResultSchema(truncatedMap);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.includes('every before-snapshot file')));

  const malformedHash = completeResult();
  malformedHash.productionBuildHashes['src/main.js'] = 'not-a-sha256';
  validation = validatePerformanceResultSchema(malformedHash);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.includes('lowercase SHA-256')));
});

test('stored baseline comparison judges only matched static protocols', () => {
  const makeRun = () => ({
    generatedAt: '2026-07-18T00:00:00.000Z',
    protocol: {
      viewport: { width: 1600, height: 900 },
      browserMode: 'headless',
      sampleCount: 3,
      sampleMs: 2500,
      warmupMs: 1500,
      gcSettleMs: 600,
    },
    environment: {
      devicePixelRatio: 1,
      browserVersion: '150.0.0',
      hardwareConcurrency: 16,
      webglRenderer: 'matched-gpu',
    },
    scenes: Object.fromEntries(STATIC_SCENES.map((key) => [key, staticScene()])),
  });
  const baseline = makeRun();
  const current = makeRun();
  const matched = buildStoredBaselineComparison(baseline, current, { path: 'baseline.json' });
  assert.equal(matched.qualified, true);
  assert.equal(matched.pass, true);
  assert.equal(matched.dynamicComparison.available, false,
    'legacy pre-tray data must not be presented as a dynamic comparison');

  current.scenes.scanner.render.drawCalls = 300;
  assert.equal(buildStoredBaselineComparison(baseline, current).pass, false);
  current.protocol.browserMode = 'headed';
  const unmatched = buildStoredBaselineComparison(baseline, current);
  assert.equal(unmatched.qualified, false);
  assert.equal(unmatched.pass, null);
  assert.ok(unmatched.rows.every((row) => row.pass == null));

  current.protocol.browserMode = 'headless';
  delete baseline.scenes.card.aggregate.p99FrameMs;
  const incomplete = buildStoredBaselineComparison(baseline, current);
  assert.equal(incomplete.qualification.metricSchemaComplete, false);
  assert.equal(incomplete.qualified, false);
});

test('dynamic gate report enforces transition tails and method-matched three-sale cleanup stability', () => {
  const phases = Object.fromEntries(REQUIRED_DYNAMIC_PHASES.map((key) => [key, dynamicPhase()]));
  const windows = Object.fromEntries(REQUIRED_DYNAMIC_WINDOWS.map((key) => [key, dynamicWindow()]));
  const stability = {
    start: { state: { active: true, workspace: 'monitor', customerCount: 0 } },
    afterFirstSale: { state: { active: true, workspace: 'monitor', customerCount: 0 } },
    afterWarmSale: { state: { active: true, workspace: 'monitor', customerCount: 0 } },
    end: {
      state: {
        active: true,
        workspace: 'monitor',
        transactionNumber: null,
        transactionStage: null,
        customerCount: 0,
        drawerOpen: false,
      },
    },
    methodMatchedDelta: {
      postGcHeapMiB: 0.5,
      listeners: 0,
      domElements: 0,
      liveSceneObjects: 0,
      liveSceneMeshes: 0,
      liveGeometries: 0,
      liveMaterials: 0,
      liveTextures: 0,
      rendererGeometries: 0,
      rendererTextures: 0,
    },
    totalDelta: { rendererGeometries: 120, rendererTextures: 8 },
  };
  stability.repeatSaleDelta = stability.methodMatchedDelta;
  stability.delta = stability.methodMatchedDelta;
  const baseline = { available: true, qualified: true, pass: true };
  assert.equal(buildDynamicGateReport(phases, stability, baseline, windows).pass, true);

  stability.totalDelta.rendererGeometries = 201;
  assert.equal(
    buildDynamicGateReport(phases, stability, baseline, windows).details.transactionRendererResidency.pass,
    false,
    'first-use renderer residency is judged across the total envelope',
  );
  stability.totalDelta.rendererGeometries = 120;

  stability.methodMatchedDelta.rendererGeometries = 3;
  assert.equal(
    buildDynamicGateReport(phases, stability, baseline, windows)
      .details.transactionRepeatRendererResidency.pass,
    false,
    'method-matched renderer residency is judged independently of cold first-use residency',
  );
  stability.methodMatchedDelta.rendererGeometries = 0;

  phases.cardInsertion.frameTimesMs = Array.from({ length: 20 }, (_, index) => (
    index === 19 ? 280 : 36
  ));
  const failed = buildDynamicGateReport(phases, stability, baseline, windows);
  assert.equal(failed.pass, false);
  assert.equal(failed.details.dynamicAverageFps.pass, false);
  assert.equal(failed.details.dynamicP99Frame.pass, false);
  assert.equal(failed.details.dynamicWorstFrame.pass, false);
});

test('dynamic retained-heap and high-water gates are one-sided and fail closed', () => {
  const phases = Object.fromEntries(REQUIRED_DYNAMIC_PHASES.map((key) => [key, dynamicPhase()]));
  const windows = Object.fromEntries(REQUIRED_DYNAMIC_WINDOWS.map((key) => [key, dynamicWindow()]));
  const stability = {
    end: {
      state: {
        active: true,
        workspace: 'monitor',
        transactionNumber: null,
        transactionStage: null,
        customerCount: 0,
        drawerOpen: false,
      },
    },
    methodMatchedDelta: {
      postGcHeapMiB: -4.32,
      listeners: 0,
      domElements: 0,
      liveSceneObjects: 0,
      liveSceneMeshes: 0,
      liveGeometries: 0,
      liveMaterials: 0,
      liveTextures: 0,
    },
    totalDelta: { rendererGeometries: 0, rendererTextures: 0 },
  };
  stability.delta = stability.methodMatchedDelta;
  const baseline = { available: false, qualified: false, pass: null };

  assert.equal(buildDynamicGateReport(phases, stability, baseline, windows).details.transactionPostGcHeap.pass, true,
    'a forced-GC heap decrease is not a retained-memory regression');
  stability.delta.postGcHeapMiB = 4;
  assert.equal(buildDynamicGateReport(phases, stability, baseline, windows).details.transactionPostGcHeap.pass, true);
  stability.delta.postGcHeapMiB = 4.001;
  assert.equal(buildDynamicGateReport(phases, stability, baseline, windows).details.transactionPostGcHeap.pass, false);
  for (const missing of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
    stability.methodMatchedDelta.postGcHeapMiB = missing;
    assert.equal(buildDynamicGateReport(phases, stability, baseline, windows).details.transactionPostGcHeap.pass, false);
  }

  stability.methodMatchedDelta.postGcHeapMiB = 0;
  phases.cardInsertion.heapHighWater.peakGrowthMiB = 1000;
  phases.cardInsertion.heapHighWater.calibration.excessMaxDrawupMiB = 16;
  assert.equal(buildDynamicGateReport(phases, stability, baseline, windows).details.dynamicHeapHighWater.pass, true);
  phases.cardInsertion.heapHighWater.calibration.excessMaxDrawupMiB = 16.001;
  assert.equal(buildDynamicGateReport(phases, stability, baseline, windows).details.dynamicHeapHighWater.pass, false);
  for (const missing of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
    phases.cardInsertion.heapHighWater.calibration.excessMaxDrawupMiB = missing;
    assert.equal(buildDynamicGateReport(phases, stability, baseline, windows).details.dynamicHeapHighWater.pass, false);
  }
  phases.cardInsertion.heapHighWater.calibration.excessMaxDrawupMiB = 0;
  phases.cardInsertion.heapHighWater.calibration.durationMatched = false;
  assert.equal(buildDynamicGateReport(phases, stability, baseline, windows).details.dynamicHeapHighWater.pass, false);
  phases.cardInsertion.heapHighWater.calibration.durationMatched = true;
  phases.cardInsertion.heapHighWater.calibration.controlStateStable = false;
  assert.equal(buildDynamicGateReport(phases, stability, baseline, windows).details.dynamicHeapHighWater.pass, false);
  phases.cardInsertion.heapHighWater.calibration.controlStateStable = true;
  phases.cardInsertion.heapHighWater.calibration.traceCoverageMatched = false;
  assert.equal(buildDynamicGateReport(phases, stability, baseline, windows).details.dynamicHeapHighWater.pass, false);
});
