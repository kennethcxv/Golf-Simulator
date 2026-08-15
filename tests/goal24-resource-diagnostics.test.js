import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  GOAL24_PRODUCTION_FRAME_LOOP_OWNER,
  GOAL24_RESOURCE_DIAGNOSTICS_SCHEMA_VERSION,
  GOAL24_RESOURCE_QUALIFICATIONS,
  assessProductionFrameLoopDiagnostics,
  assembleGoal24ResourceSnapshot,
  captureGoal24AudioContextEvidence,
  captureGoal24EventListenerCensus,
  captureGoal24ResourceSnapshot,
  createGoal24ResourceDiagnostics,
  deriveRenderLoopInvariant,
  estimateRgba8MipChainBytes,
  summarizeGoal24ComposedFrames,
  validateGoal24ResourceSnapshot,
} from '../tools/qa/lib/goal24-resource-diagnostics.mjs';

function frameLoopFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    ownerToken: GOAL24_PRODUCTION_FRAME_LOOP_OWNER,
    rootStartCount: 1,
    scheduleCount: 101,
    callbackCount: 100,
    pendingCallbackCount: 1,
    maximumPendingCallbackCount: 1,
    schedulingFailureCount: 0,
    pendingUnderflowCount: 0,
    firstRootStartAtMs: 1,
    lastCallbackAtMs: 1600,
    accountingConsistent: true,
    invariantHolds: true,
    ...overrides,
  };
}

function workloadContextFixture(overrides = {}) {
  return {
    schemaVersion: 2,
    appScreen: 'game',
    prewarming: false,
    camera: {
      fov: 64,
      aspect: 16 / 9,
      near: 0.05,
      far: 2400,
      position: { x: 12, y: 1.65, z: -8 },
      quaternion: { x: 0, y: 0.707107, z: 0, w: 0.707107 },
    },
    walk: {
      active: true,
      x: 12,
      z: -8,
      yaw: Math.PI / 2,
      pitch: 0,
      eye: 1.65,
      fov: 64,
    },
    heldTool: 'sponge',
    ledger: {
      open: false,
      visualOpen: false,
      state: 'closed',
      spread: 0,
      pageCount: 8,
      turning: false,
    },
    ...overrides,
  };
}

function composedSample(overrides = {}) {
  return {
    timestampMs: 0,
    rendererFrame: 100,
    composedRenders: 40,
    productionCallbackCount: 80,
    calls: 0,
    triangles: 0,
    lines: 0,
    points: 0,
    rendererInfoAutoReset: false,
    shadowBakes: 8,
    workloadContext: workloadContextFixture(),
    ...overrides,
  };
}

function productionFixture(
  rendererFrames = Array.from({ length: 13 }, (_, index) => 100 + index * 4),
  schedulerOverrides = {},
  sampleTransform = (sample) => sample,
) {
  const calls = [0, 900, 910, 570, 574, 580, 575, 576, 577, 578, 579, 571, 572];
  const triangles = [
    0, 190000, 191000, 120000, 123456, 124000, 126000,
    121000, 122000, 123000, 124500, 120500, 119000,
  ];
  return {
    renderSamples: rendererFrames.map((rendererFrame, index) => sampleTransform({
      timestampMs: index * 16.667,
      rendererFrame,
      composedRenders: 40 + index,
      productionCallbackCount: 80 + index,
      calls: calls[index] ?? 570 + index,
      triangles: triangles[index] ?? 120000 + index,
      lines: index,
      points: 0,
      rendererInfoAutoReset: false,
      shadowBakes: index <= 2 ? 8 + index : 10,
      workloadContext: workloadContextFixture(),
    }, index)),
    frameLoopDiagnostics: frameLoopFixture(schedulerOverrides),
    scene: {
      source: 'scene fixture',
      objects: 900,
      meshes: 838,
      instancedMeshes: 4,
      geometries: 420,
      materials: 290,
      textures: 88,
      visibleMeshes: 650,
      visibleGeometries: 350,
      visibleMaterials: 220,
      visibleTextures: 64,
      visibleTextureSurfaces: 69,
      textureDimensionsKnown: 62,
      textureDimensionsUnknown: 2,
      sceneTextureDimensionsKnown: 80,
      sceneTextureDimensionsUnknown: 8,
      sceneTrianglesBeforeFrustumCulling: 200000,
      estimatedVisibleTextureBytes: 16_777_216,
      rendererMemory: {
        source: 'THREE renderer memory fixture',
        geometries: 450,
        textures: 101,
        programs: 17,
      },
    },
  };
}

function listenersFixture() {
  return {
    source: 'CDP listener fixture',
    limitation: 'non-DOM targets are unmeasured',
    targetCount: 12,
    targetsInspected: 12,
    targetsFailed: 0,
    complete: true,
    total: 54,
    byType: { click: 10, keydown: 44 },
  };
}

function audioFixture() {
  return {
    source: 'app debugStats + CDP queryObjects fixture',
    limitation: 'main renderer wrappers only',
    count: 1,
    app: { available: true, value: { initialized: true, contextState: 'running' } },
    runtime: { available: true, count: 1, contexts: [{ state: 'running' }] },
    agreement: true,
  };
}

test('RGBA8 estimate includes exact integer mip levels, faces, and layers', () => {
  assert.equal(estimateRgba8MipChainBytes({ width: 4, height: 4 }), 84);
  assert.equal(estimateRgba8MipChainBytes({
    width: 4, height: 4, faces: 6,
  }), 504);
  assert.equal(estimateRgba8MipChainBytes({
    width: 4, height: 4, layers: 3, includeMipChain: false,
  }), 192);
  assert.equal(estimateRgba8MipChainBytes({ width: 0, height: 4 }), null);
  assert.match(GOAL24_RESOURCE_QUALIFICATIONS.textureMemory, /Exact GPU memory is unavailable/);
  assert.match(GOAL24_RESOURCE_QUALIFICATIONS.textureMemory, /RGBA8/);
});

test('render-loop invariant combines absolute shipping scheduler proof with renderer progress', () => {
  const stableProduction = productionFixture();
  const stable = deriveRenderLoopInvariant(stableProduction.renderSamples, {
    productionSchedulerDiagnostics: stableProduction.frameLoopDiagnostics,
  });
  assert.equal(stable.invariantHolds, true);
  assert.equal(stable.absoluteProductionSchedulerProof, true);
  assert.equal(stable.renderCallbackCount, 1);
  assert.equal(stable.renderLoopCount, 1);
  assert.equal(stable.baselineInternalRendererInvocations, 4);
  assert.equal(stable.modalInternalRendererInvocations, 4);
  assert.match(stable.calibration, /diagnostic-only/);
  assert.match(stable.source, /scheduleProductionFrame/);
  assert.match(stable.source, /WebGLRenderer\.info\.render\.frame/);
  assert.match(stable.source, /composedRenders/);
  assert.match(stable.source, /shadowBakes/);
  assert.match(stable.limitation, /production frame scheduler/);

  const rendererAnomalyProduction = productionFixture([100, 104, 112, 116]);
  const internalPassVariation = deriveRenderLoopInvariant(rendererAnomalyProduction.renderSamples, {
    productionSchedulerDiagnostics: rendererAnomalyProduction.frameLoopDiagnostics,
  });
  assert.equal(internalPassVariation.invariantHolds, true,
    'internal THREE pass variation is not evidence of duplicate composed renders');
  assert.equal(internalPassVariation.duplicateProgressionObserved, false);
  assert.equal(internalPassVariation.maximumProgressionsPerBoundary, 1);

  const laterProduction = productionFixture([100, 108, 116, 124]);
  const laterSessionCheckpoint = deriveRenderLoopInvariant(
    laterProduction.renderSamples,
    {
      referenceInternalRendererInvocations: 4,
      productionSchedulerDiagnostics: laterProduction.frameLoopDiagnostics,
    },
  );
  assert.match(laterSessionCheckpoint.calibration, /diagnostic-only/);
  assert.equal(laterSessionCheckpoint.localBaselineInternalRendererInvocations, 8);
  assert.equal(laterSessionCheckpoint.baselineInternalRendererInvocations, 4);
  assert.equal(laterSessionCheckpoint.renderLoopCount, 1);
  assert.equal(laterSessionCheckpoint.invariantHolds, true);

  const steadyDuplicateProduction = productionFixture(
    [100, 104, 108, 112],
    {},
    (sample, index) => ({ ...sample, composedRenders: 40 + index * 2 }),
  );
  const steadyDuplicate = deriveRenderLoopInvariant(steadyDuplicateProduction.renderSamples, {
    productionSchedulerDiagnostics: steadyDuplicateProduction.frameLoopDiagnostics,
  });
  assert.equal(steadyDuplicate.invariantHolds, false);
  assert.equal(steadyDuplicate.duplicateComposedRenderObserved, true);
  assert.equal(steadyDuplicate.duplicateProgressionObserved, true);
  assert.throws(
    () => summarizeGoal24ComposedFrames(steadyDuplicateProduction.renderSamples),
    /duplicate composed renders/,
  );
});

test('composed-frame summary stratifies shadow bakes and retains independent peak frames', () => {
  const summary = summarizeGoal24ComposedFrames([
    composedSample(),
    composedSample({ timestampMs: 16, rendererFrame: 104, composedRenders: 41,
      productionCallbackCount: 81, calls: 900, triangles: 190000, shadowBakes: 9 }),
    composedSample({ timestampMs: 32, rendererFrame: 108, composedRenders: 42,
      productionCallbackCount: 82, calls: 570, triangles: 120000, lines: 1, shadowBakes: 9 }),
    composedSample({ timestampMs: 48, rendererFrame: 112, composedRenders: 43,
      productionCallbackCount: 83, calls: 610, triangles: 130000, lines: 2, shadowBakes: 9 }),
    composedSample({ timestampMs: 64, rendererFrame: 116, composedRenders: 44,
      productionCallbackCount: 84, calls: 590, triangles: 150000, lines: 1, shadowBakes: 9 }),
  ]);

  assert.equal(summary.observedFrameCount, 4);
  assert.equal(summary.nonShadowFrameCount, 3);
  assert.equal(summary.shadowBakeFrameCount, 1);
  assert.equal(summary.totalShadowBakeDelta, 1);
  assert.equal(summary.unclassifiedFrameCount, 0);
  assert.equal(summary.representative.drawCalls, 610);
  assert.equal(summary.representative.renderedTriangles, 150000);
  assert.equal(summary.representative.statistic,
    'independent-peak-non-shadow-frames');
  assert.equal(summary.peakNonShadowDrawCalls, 610);
  assert.equal(summary.peakNonShadowRenderedTriangles, 150000);
  assert.equal(summary.peakDrawCallFrame.sampleIndex, 3);
  assert.equal(summary.peakDrawCallFrame.drawCalls, 610);
  assert.equal(summary.peakRenderedTriangleFrame.sampleIndex, 4);
  assert.equal(summary.peakRenderedTriangleFrame.renderedTriangles, 150000);
  assert.deepEqual(summary.workloadContext, workloadContextFixture());
  assert.deepEqual(summary.frames.map(({ frameClass }) => frameClass), [
    'shadow-bake', 'non-shadow', 'non-shadow', 'non-shadow',
  ]);
});

test('composed-frame summary fails closed without a calm production frame or exact counters', () => {
  const allShadow = [
    composedSample(),
    composedSample({ timestampMs: 16, rendererFrame: 104, composedRenders: 41,
      productionCallbackCount: 81, calls: 900, triangles: 190000, shadowBakes: 9 }),
    composedSample({ timestampMs: 32, rendererFrame: 108, composedRenders: 42,
      productionCallbackCount: 82, calls: 910, triangles: 191000, shadowBakes: 10 }),
  ];
  assert.throws(() => summarizeGoal24ComposedFrames(allShadow),
    /at least one production frame proven not to bake shadows/);
  assert.throws(() => summarizeGoal24ComposedFrames([
    allShadow[0],
    { ...allShadow[1], rendererInfoAutoReset: true, shadowBakes: 8 },
  ]), /must explicitly prove renderer\.info\.autoReset === false/);
  const missingAutoReset = { ...allShadow[1], shadowBakes: 8 };
  delete missingAutoReset.rendererInfoAutoReset;
  assert.throws(() => summarizeGoal24ComposedFrames([
    allShadow[0], missingAutoReset,
  ]), /must explicitly prove renderer\.info\.autoReset === false/);
  assert.throws(() => summarizeGoal24ComposedFrames([
    allShadow[0],
    { ...allShadow[1], calls: Number.NaN, shadowBakes: 8 },
  ]), /render counters 1 are incomplete/);
  assert.throws(() => summarizeGoal24ComposedFrames([
    allShadow[0],
    { ...allShadow[1], shadowBakes: 10 },
    { ...allShadow[2], shadowBakes: 10 },
  ]), /more shadow bakes than composed renders/);
});

test('a sparse non-shadow workload spike cannot be hidden by calm frames', () => {
  const samples = [composedSample()];
  for (let index = 1; index <= 12; index += 1) {
    samples.push(composedSample({
      timestampMs: index * 16,
      rendererFrame: 100 + index * 4,
      composedRenders: 40 + index,
      productionCallbackCount: 80 + index,
      calls: index === 7 ? 10_000 : 100,
      triangles: index === 9 ? 1_000_000 : 10_000,
      shadowBakes: 8,
    }));
  }
  const summary = summarizeGoal24ComposedFrames(samples);
  assert.equal(summary.representative.drawCalls, 10_000);
  assert.equal(summary.representative.renderedTriangles, 1_000_000);
  assert.equal(summary.peakDrawCallFrame.sampleIndex, 7);
  assert.equal(summary.peakRenderedTriangleFrame.sampleIndex, 9);
});

test('composed-frame evidence rejects workload-context drift during capture', () => {
  const samples = [
    composedSample(),
    composedSample({
      timestampMs: 16,
      rendererFrame: 104,
      composedRenders: 41,
      productionCallbackCount: 81,
      calls: 100,
      triangles: 10_000,
      workloadContext: workloadContextFixture({ heldTool: 'pressure-washer' }),
    }),
  ];
  assert.throws(() => summarizeGoal24ComposedFrames(samples),
    /workload context changed during the observation window/);
});

test('workload context rejects nonphysical cameras and incomplete or inconsistent ledger state', () => {
  const summaryFor = (context) => summarizeGoal24ComposedFrames([
    composedSample({ workloadContext: context }),
    composedSample({
      timestampMs: 16,
      rendererFrame: 104,
      composedRenders: 41,
      productionCallbackCount: 81,
      calls: 100,
      triangles: 10_000,
      workloadContext: context,
    }),
  ]);

  const nonUnitQuaternion = structuredClone(workloadContextFixture());
  nonUnitQuaternion.camera.quaternion = { x: 0, y: 0, z: 0, w: 0.5 };
  assert.throws(() => summaryFor(nonUnitQuaternion), /quaternion must be normalized/);

  const invalidClipping = structuredClone(workloadContextFixture());
  invalidClipping.camera.near = invalidClipping.camera.far;
  assert.throws(() => summaryFor(invalidClipping), /clipping planes are physically invalid/);

  const incompleteLedger = structuredClone(workloadContextFixture());
  incompleteLedger.ledger.pageCount = null;
  assert.throws(() => summaryFor(incompleteLedger), /ledger is incomplete/);

  const inconsistentClosedLedger = structuredClone(workloadContextFixture());
  inconsistentClosedLedger.ledger.open = true;
  assert.throws(() => summaryFor(inconsistentClosedLedger),
    /ledger flags are inconsistent with its production state/);

  const validOpeningLedger = structuredClone(workloadContextFixture());
  Object.assign(validOpeningLedger.ledger, {
    open: true,
    visualOpen: true,
    state: 'opening',
  });
  assert.equal(summaryFor(validOpeningLedger).observedFrameCount, 1);
});

test('absolute scheduler proof fails synthetic duplicate roots and duplicate pending callbacks', () => {
  const duplicateRoot = assessProductionFrameLoopDiagnostics(frameLoopFixture({
    rootStartCount: 2,
    scheduleCount: 102,
    callbackCount: 100,
    pendingCallbackCount: 2,
    maximumPendingCallbackCount: 2,
  }));
  assert.equal(duplicateRoot.absoluteProductionSchedulerProof, true);
  assert.equal(duplicateRoot.duplicateStartObserved, true);
  assert.equal(duplicateRoot.duplicatePendingObserved, true);
  assert.equal(duplicateRoot.invariantHolds, false);

  const duplicatePendingProduction = productionFixture(undefined, {
    scheduleCount: 102,
    callbackCount: 100,
    pendingCallbackCount: 2,
    maximumPendingCallbackCount: 2,
  });
  const duplicatePending = deriveRenderLoopInvariant(
    duplicatePendingProduction.renderSamples,
    { productionSchedulerDiagnostics: duplicatePendingProduction.frameLoopDiagnostics },
  );
  assert.equal(duplicatePending.absoluteProductionSchedulerProof, true);
  assert.equal(duplicatePending.productionScheduler.duplicateStartObserved, false);
  assert.equal(duplicatePending.productionScheduler.duplicatePendingObserved, true);
  assert.equal(duplicatePending.renderLoopCount, 1);
  assert.equal(duplicatePending.renderCallbackCount, 2);
  assert.equal(duplicatePending.invariantHolds, false);
});

test('CDP listener census covers window, document, and current elements then releases objects', async () => {
  const calls = [];
  const listeners = new Map([
    ['window-id', [{ type: 'keydown', scriptId: '7', lineNumber: 10, columnNumber: 2,
      handler: { description: 'function onKey() {}' } }]],
    ['document-id', [{ type: 'click', scriptId: '8', lineNumber: 20, columnNumber: 3,
      originalHandler: { description: 'function onClick() {}' } }]],
    ['html-id', []],
    ['body-id', [{ type: 'click', scriptId: '8', lineNumber: 20, columnNumber: 3,
      originalHandler: { description: 'function onClick() {}' } }]],
  ]);
  const cdp = {
    async send(method, params) {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') return { result: { objectId: 'target-array' } };
      if (method === 'Runtime.getProperties') {
        return {
          result: [...listeners.keys()].map((objectId, index) => ({
            name: String(index), value: { objectId },
          })),
        };
      }
      if (method === 'DOMDebugger.getEventListeners') {
        return { listeners: listeners.get(params.objectId) };
      }
      if (method === 'Runtime.releaseObjectGroup') return {};
      throw new Error(`unexpected ${method}`);
    },
  };
  const result = await captureGoal24EventListenerCensus(cdp, { batchSize: 2 });
  assert.equal(result.total, 3);
  assert.equal(result.targetCount, 4);
  assert.equal(result.lightDomElementsEnumerated, 2);
  assert.equal(result.complete, true);
  assert.deepEqual(result.byType, { click: 2, keydown: 1 });
  assert.match(result.source, /DOMDebugger\.getEventListeners/);
  assert.match(result.scope, /window, document/);
  assert.match(result.limitation, /non-DOM EventTargets/);
  assert.equal(calls.filter(({ method }) => method === 'Runtime.releaseObjectGroup').length, 1);
});

test('listener census releases its object group even when enumeration fails', async () => {
  const calls = [];
  const cdp = {
    async send(method) {
      calls.push(method);
      if (method === 'Runtime.evaluate') return { result: { objectId: 'target-array' } };
      if (method === 'Runtime.getProperties') throw new Error('target closed');
      if (method === 'Runtime.releaseObjectGroup') return {};
      throw new Error(`unexpected ${method}`);
    },
  };
  await assert.rejects(captureGoal24EventListenerCensus(cdp), /target closed/);
  assert.equal(calls.at(-1), 'Runtime.releaseObjectGroup');
});

test('audio evidence combines app debugStats with read-only Runtime.queryObjects state', async () => {
  const calls = [];
  const page = {
    async evaluate() {
      return {
        available: true,
        value: { initialized: true, contextState: 'running', createdToolLoopCount: 1 },
        error: null,
      };
    },
  };
  const cdp = {
    async send(method) {
      calls.push(method);
      if (method === 'Runtime.evaluate') return { result: { objectId: 'audio-prototype' } };
      if (method === 'Runtime.queryObjects') return { objects: { objectId: 'audio-contexts' } };
      if (method === 'Runtime.callFunctionOn') {
        return { result: { value: [{ state: 'running', sampleRate: 48000 }] } };
      }
      if (method === 'Runtime.releaseObjectGroup') return {};
      throw new Error(`unexpected ${method}`);
    },
  };
  const result = await captureGoal24AudioContextEvidence(page, cdp);
  assert.equal(result.count, 1);
  assert.equal(result.agreement, true);
  assert.equal(result.app.value.contextState, 'running');
  assert.deepEqual(result.runtime.contexts, [{ state: 'running', sampleRate: 48000 }]);
  assert.ok(calls.includes('Runtime.queryObjects'));
  assert.equal(calls.at(-1), 'Runtime.releaseObjectGroup');
  assert.match(result.limitation, /other renderer isolates/);
});

test('resource assembly maps counts to locked metric names with exact provenance', () => {
  const result = assembleGoal24ResourceSnapshot({
    capturedAt: '2026-08-11T20:00:00.000Z',
    label: 'ledger-iteration-50',
    gcCompleted: true,
    heap: { usedSize: 50_000_000, totalSize: 80_000_000 },
    dom: { documents: 1, nodes: 1200, jsEventListeners: 54 },
    listeners: listenersFixture(),
    audio: audioFixture(),
    production: productionFixture(),
  });
  assert.equal(result.schemaVersion, GOAL24_RESOURCE_DIAGNOSTICS_SCHEMA_VERSION);
  assert.equal(result.capturedOutsideTimedInteraction, true);
  assert.equal(result.gcCompleted, true);
  assert.deepEqual(result.metrics, {
    jsHeapUsedBytes: 50_000_000,
    domNodeCount: 1200,
    sceneObjectCount: 900,
    meshCount: 838,
    materialCount: 290,
    geometryCount: 420,
    textureCount: 88,
    rendererGeometryAllocationCount: 450,
    rendererTextureAllocationCount: 101,
    rendererProgramCount: 17,
    textureDimensionsUnknownCount: 8,
    activeEventListenerCount: 54,
    renderCallbackCount: 1,
    renderLoopCount: 1,
    audioContextCount: 1,
    drawCallCount: 580,
    renderedTriangleCount: 126000,
    estimatedTextureBytes: 16_777_216,
    observedComposedFrameCount: 12,
    shadowBakeFrameCount: 2,
    shadowBakeCount: 2,
  });
  assert.equal(result.metricSources.estimatedTextureBytes.unit, 'bytes');
  assert.equal(result.metricSources.estimatedTextureBytes.estimated, true);
  assert.match(
    result.metricSources.estimatedTextureBytes.limitations,
    /Exact GPU memory is unavailable from WebGL/,
  );
  assert.deepEqual(result.diagnostics.rendererMemory, {
    source: 'THREE renderer memory fixture', geometries: 450, textures: 101, programs: 17,
  });
  assert.equal(result.diagnostics.renderLoop.absoluteProductionSchedulerProof, true);
  assert.equal(result.diagnostics.renderLoop.productionScheduler.rootStartCount, 1);
  assert.equal(result.metricSources.renderLoopCount.absoluteProductionSchedulerProof, true);
  assert.equal(result.metricSources.renderLoopCount.pendingCallbackCount, 1);
  assert.equal(result.metricSources.renderLoopCount.maximumPendingCallbackCount, 1);
  assert.equal(result.metricSources.renderLoopCount.schedulerAccountingConsistent, true);
  assert.equal(result.metricSources.drawCallCount.statistic,
    'peak-non-shadow-draw-calls');
  assert.equal(result.metricSources.renderedTriangleCount.statistic,
    'peak-non-shadow-rendered-triangles');
  assert.match(result.metricSources.drawCallCount.stratification, /shadowBakes/);
  assert.equal(result.diagnostics.composedFrameSummary.nonShadowFrameCount, 10);
  assert.equal(result.diagnostics.composedFrameSummary.totalShadowBakeDelta, 2);
  assert.equal(result.diagnostics.composedFrameSummary.peakNonShadowDrawCalls, 580);
  assert.equal(result.diagnostics.composedFrameSummary.peakNonShadowRenderedTriangles, 126000);
  assert.equal(result.diagnostics.composedFrameSummary.peakDrawCallFrame.sampleIndex, 5);
  assert.equal(result.diagnostics.composedFrameSummary.peakRenderedTriangleFrame.sampleIndex, 6);
  assert.deepEqual(result.diagnostics.workloadContext, workloadContextFixture());
  assert.equal(result.measurementEvidence.production.renderSamples.length, 13);
  assert.equal(validateGoal24ResourceSnapshot(result), true);
  assert.equal(result.instrumentation.persistentHooksInstalled, false);
  assert.equal(result.instrumentation.shippingFunctionsPatched, false);
  assert.match(result.instrumentation.shippingSchedulerDiagnostics, /production-owned/);
  assert.equal(result.instrumentation.mutationObserversInstalled, false);

  const laterProduction = productionFixture(undefined, {}, (sample, index) => ({
    ...sample,
    calls: index === 8 ? 600 : sample.calls,
    triangles: index === 9 ? 130000 : sample.triangles,
    shadowBakes: index === 0 ? 8 : 9,
  }));
  const later = assembleGoal24ResourceSnapshot({
    capturedAt: '2026-08-11T20:01:00.000Z',
    label: 'ledger-iteration-100',
    gcCompleted: true,
    heap: { usedSize: 50_100_000, totalSize: 80_000_000 },
    dom: { documents: 1, nodes: 1200, jsEventListeners: 54 },
    listeners: listenersFixture(),
    audio: audioFixture(),
    production: laterProduction,
  });
  assert.deepEqual(later.metricSources, result.metricSources,
    'observed frame mix must remain diagnostics, not drift checkpoint provenance');
});

test('pure snapshot validation rejects fabricated metrics, provenance, and dropped raw evidence', () => {
  const snapshot = assembleGoal24ResourceSnapshot({
    capturedAt: '2026-08-11T20:00:00.000Z',
    label: 'adversarial-resource-checkpoint',
    gcCompleted: true,
    heap: { usedSize: 50_000_000, totalSize: 80_000_000 },
    dom: { documents: 1, nodes: 1200, jsEventListeners: 54 },
    listeners: listenersFixture(),
    audio: audioFixture(),
    production: productionFixture(),
  });
  assert.equal(validateGoal24ResourceSnapshot(snapshot), true);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.measurementEvidence.production.renderSamples), true);
  assert.equal('capturedAtPerformanceMs' in snapshot.measurementEvidence.production, false);
  assert.equal(
    'simulationMinute' in snapshot.measurementEvidence.production.renderSamples[0],
    false,
  );
  assert.equal('calls' in snapshot.measurementEvidence.production.renderSamples[0], false);

  const fabricatedMetric = structuredClone(snapshot);
  fabricatedMetric.metrics.drawCallCount = 1;
  assert.throws(() => validateGoal24ResourceSnapshot(fabricatedMetric),
    /differs from recomputed raw measurement evidence/);

  const fabricatedProvenance = structuredClone(snapshot);
  fabricatedProvenance.metricSources.drawCallCount.source = 'self-declared cheap frame';
  assert.throws(() => validateGoal24ResourceSnapshot(fabricatedProvenance),
    /differs from recomputed raw measurement evidence/);

  const mutatedRawSample = structuredClone(snapshot);
  mutatedRawSample.measurementEvidence.production.renderSamples[5].calls = 50_000;
  assert.throws(() => validateGoal24ResourceSnapshot(mutatedRawSample),
    /differs from recomputed raw measurement evidence/);

  const mutatedRawScheduler = structuredClone(snapshot);
  mutatedRawScheduler.measurementEvidence.production.frameLoopDiagnostics.lastCallbackAtMs += 1;
  assert.throws(() => validateGoal24ResourceSnapshot(mutatedRawScheduler),
    /differs from recomputed raw measurement evidence/);

  const mutatedRawContext = structuredClone(snapshot);
  mutatedRawContext.measurementEvidence.production.renderSamples[0]
    .workloadContext.camera.position.x += 1;
  assert.throws(() => validateGoal24ResourceSnapshot(mutatedRawContext),
    /workload context changed during the observation window/);

  const droppedDerivedFrames = structuredClone(snapshot);
  delete droppedDerivedFrames.diagnostics.composedFrames;
  assert.throws(() => validateGoal24ResourceSnapshot(droppedDerivedFrames),
    /differs from recomputed raw measurement evidence/);

  const droppedRawSamples = structuredClone(snapshot);
  delete droppedRawSamples.measurementEvidence.production.renderSamples;
  assert.throws(() => validateGoal24ResourceSnapshot(droppedRawSamples),
    /production resource evidence is incomplete/);
});

test('resource assembly fails closed on partial listeners or unavailable/disagreeing audio evidence', () => {
  const base = {
    capturedAt: '2026-08-11T20:00:00.000Z',
    label: 'resource-checkpoint',
    gcCompleted: true,
    heap: { usedSize: 50_000_000, totalSize: 80_000_000 },
    dom: { documents: 1, nodes: 1200, jsEventListeners: 54 },
    listeners: listenersFixture(),
    audio: audioFixture(),
    production: productionFixture(),
  };
  assert.throws(() => assembleGoal24ResourceSnapshot({
    ...base,
    listeners: { ...base.listeners, complete: false, targetsFailed: 1 },
  }), /Incomplete CDP event-listener census/);
  assert.throws(() => assembleGoal24ResourceSnapshot({
    ...base,
    audio: { ...base.audio, count: null, agreement: null },
  }), /invalid Goal 24 resource metric audioContextCount/i);
  assert.throws(() => assembleGoal24ResourceSnapshot({
    ...base,
    audio: { ...base.audio, agreement: false },
  }), /audio debugStats and CDP AudioContext evidence disagree/);
  assert.throws(() => assembleGoal24ResourceSnapshot({
    ...base,
    production: { ...base.production, frameLoopDiagnostics: null },
  }), /production resource evidence is incomplete/);
  const missingPrograms = productionFixture();
  missingPrograms.scene.rendererMemory.programs = null;
  assert.throws(() => assembleGoal24ResourceSnapshot({
    ...base,
    production: missingPrograms,
  }), /rendererProgramCount/);
  const missingTextureDimensions = productionFixture();
  missingTextureDimensions.scene.sceneTextureDimensionsUnknown = null;
  assert.throws(() => assembleGoal24ResourceSnapshot({
    ...base,
    production: missingTextureDimensions,
  }), /textureDimensionsUnknownCount/);
});

test('snapshot API refuses to run inside or ambiguously outside a timed interaction', async () => {
  let touched = false;
  const page = { evaluate: async () => { touched = true; } };
  const cdp = { send: async () => { touched = true; } };
  await assert.rejects(
    captureGoal24ResourceSnapshot(page, { cdp }),
    /outsideTimedInteraction: true/,
  );
  await assert.rejects(
    captureGoal24ResourceSnapshot(page, { cdp, outsideTimedInteraction: false }),
    /checkpoint-only/,
  );
  assert.equal(touched, false);
});

test('diagnostics lifecycle detaches only an owned CDP session and cleanup is idempotent', async () => {
  let detachCount = 0;
  const owned = { send: async () => ({}), detach: async () => { detachCount += 1; } };
  const page = {
    evaluate: async () => ({}),
    context: () => ({ newCDPSession: async () => owned }),
  };
  const diagnostics = await createGoal24ResourceDiagnostics(page);
  assert.equal(await diagnostics.dispose(), true);
  assert.equal(await diagnostics.dispose(), false);
  assert.equal(detachCount, 1);
  assert.throws(() => diagnostics.snapshot({ outsideTimedInteraction: true }), /disposed/);

  const borrowed = { send: async () => ({}), detach: async () => { detachCount += 10; } };
  const borrowedDiagnostics = await createGoal24ResourceDiagnostics(page, { cdp: borrowed });
  assert.equal(await borrowedDiagnostics.dispose(), true);
  assert.equal(detachCount, 1);
});

test('source contract uses read-only checkpoint instruments and no persistent hook machinery', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/lib/goal24-resource-diagnostics.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /DOMDebugger\.getEventListeners/);
  assert.match(source, /Runtime\.releaseObjectGroup/);
  assert.match(source, /Runtime\.queryObjects/);
  assert.match(source, /audio\?\.debugStats/);
  assert.match(source, /WebGLRenderer\.info/);
  assert.match(source, /outsideTimedInteraction !== true/);
  assert.doesNotMatch(source, /new\s+MutationObserver\s*\(/);
  assert.doesNotMatch(source, /new\s+PerformanceObserver\s*\(/);
  assert.doesNotMatch(source, /addEventListener\s*\(/);
  assert.doesNotMatch(source, /(?:requestAnimationFrame|AudioContext)\s*=/);
  assert.doesNotMatch(source, /\.render\s*=\s*(?:function|\()/);

  const mainSource = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal((mainSource.match(/startProductionFrameLoop\(\);/g) || []).length, 1);
  assert.equal((mainSource.match(/requestAnimationFrame\(runProductionFrame\)/g) || []).length, 1);
  assert.doesNotMatch(mainSource, /requestAnimationFrame\(frame\)/);
  assert.match(mainSource, /Object\.defineProperty\(app, 'frameLoopDiagnostics'/);
  assert.match(mainSource, /configurable: false/);
  assert.match(mainSource, /writable: false/);

  const courseSource = fs.readFileSync(
    new URL('../src/render3d/courseScene.js', import.meta.url),
    'utf8',
  );
  assert.match(courseSource, /let composedRenders = 0/);
  assert.equal((courseSource.match(/composedRenders \+= 1/g) || []).length, 1);
  assert.match(courseSource, /Object\.defineProperty\(postApi, 'stats'/);
  assert.match(courseSource, /value: \(\) => Object\.freeze\(\{ shadowBakes, composedRenders \}\)/);
  assert.match(source, /composedRenders: Number\(postStats\?\.composedRenders\)/);
  assert.match(source, /productionCallbackCount: Number\(frameLoop\?\.callbackCount\)/);
});
