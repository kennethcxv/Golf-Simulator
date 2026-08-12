import { isDeepStrictEqual } from 'node:util';

import {
  GOAL24_SUPPORTED_TOOL_IDS,
  goal24ToolChainFailures,
  goal24ToolManifestFailures,
  goal24WarmedToolCycleFailures,
} from './lib/goal24-tool-manifest.mjs';
import {
  GOAL24_DOOR_SCENARIOS,
  validateGoal24DoorEvidenceAggregate,
  validateGoal24DoorRouteSignature,
  validateGoal24DoorwayRenderEvidenceStructure,
} from './lib/goal24-door-evidence.mjs';
import {
  GOAL24_RESOURCE_DIAGNOSTICS_SCHEMA_VERSION,
  validateGoal24ResourceSnapshot,
} from './lib/goal24-resource-diagnostics.mjs';

const freeze = (value) => Object.freeze(value);

export const LOCKED_PERFORMANCE_SCHEMA_VERSION = 1;

export const LOCKED_PERFORMANCE_PROTOCOL = freeze({
  viewport: freeze({ width: 1920, height: 1080, deviceScaleFactor: 1 }),
  qualityPreset: 'high',
  scenarios: freeze(['idle', 'walk', 'cleaning', 'checkout', 'tenCustomers']),
  runsPerScenario: 3,
  aggregation: 'median',
  thresholds: freeze({
    minimumAverageFps: 60,
    minimumOnePercentLowFps: 30,
    maximumMedianFramesOver50Ms: 0,
    maximumActiveEventListenerGrowth: 0,
    maximumTrackedEventListenerGrowth: 0,
    maximumDomNodeGrowth: 0,
    maximumJsHeapGrowthBytes: 8 * 1024 * 1024,
    maximumMaterialGrowth: 0,
    maximumRendererGeometryGrowth: 0,
    maximumRendererTextureGrowth: 0,
    maximumEstimatedTextureMemoryGrowthBytes: 0,
  }),
});

const finite = (value) => Number.isFinite(value);
const approximately = (value, expected, tolerance = 1e-6) => (
  finite(value) && Math.abs(value - expected) <= tolerance
);
const round = (value, digits = 3) => Number(value.toFixed(digits));

export function median(values) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !finite(value))) {
    throw new TypeError('median requires a non-empty array of finite numbers');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeScenarioRuns(runs) {
  if (!Array.isArray(runs) || runs.length !== LOCKED_PERFORMANCE_PROTOCOL.runsPerScenario) {
    throw new TypeError(
      `scenario requires exactly ${LOCKED_PERFORMANCE_PROTOCOL.runsPerScenario} runs`,
    );
  }
  const metrics = runs.map((run, index) => {
    if (run?.run !== index + 1) throw new TypeError(`run ${index + 1} is missing or out of order`);
    const sample = run.sample;
    for (const key of [
      'durationMs',
      'averageFps',
      'onePercentLowFps',
      'worstFrameMs',
      'drawCalls',
      'renderedTriangles',
      'materialCount',
      'rendererGeometryCount',
      'jsHeapUsedBytes',
      'domNodes',
    ]) {
      if (!finite(sample?.[key]) || sample[key] <= 0) {
        throw new TypeError(`run ${index + 1} has invalid ${key}`);
      }
    }
    for (const key of [
      'textureMemoryBytes',
      'rendererTextureCount',
      'activeEventListeners',
      'trackedEventListeners',
      'uiMutationsPerSecond',
      'domNodeDelta',
    ]) {
      if (!finite(sample?.[key])) throw new TypeError(`run ${index + 1} has invalid ${key}`);
    }
    for (const key of ['framesOver33Ms', 'framesOver50Ms']) {
      if (!Number.isInteger(sample?.[key]) || sample[key] < 0) {
        throw new TypeError(`run ${index + 1} has invalid ${key}`);
      }
    }
    if (!Number.isInteger(sample.frameCount) || sample.frameCount < 1) {
      throw new TypeError(`run ${index + 1} has invalid frameCount`);
    }
    return sample;
  });
  return {
    durationMs: round(median(metrics.map((sample) => sample.durationMs))),
    frameCount: round(median(metrics.map((sample) => sample.frameCount))),
    averageFps: median(metrics.map((sample) => sample.averageFps)),
    onePercentLowFps: median(metrics.map((sample) => sample.onePercentLowFps)),
    worstFrameMs: round(median(metrics.map((sample) => sample.worstFrameMs))),
    framesOver33Ms: round(median(metrics.map((sample) => sample.framesOver33Ms))),
    framesOver50Ms: round(median(metrics.map((sample) => sample.framesOver50Ms))),
    drawCalls: round(median(metrics.map((sample) => sample.drawCalls))),
    renderedTriangles: round(median(metrics.map((sample) => sample.renderedTriangles))),
    materialCount: round(median(metrics.map((sample) => sample.materialCount))),
    rendererGeometryCount: round(median(metrics.map((sample) => sample.rendererGeometryCount))),
    rendererTextureCount: round(median(metrics.map((sample) => sample.rendererTextureCount))),
    textureMemoryBytes: round(median(metrics.map((sample) => sample.textureMemoryBytes))),
    jsHeapUsedBytes: round(median(metrics.map((sample) => sample.jsHeapUsedBytes))),
    activeEventListeners: round(median(metrics.map((sample) => sample.activeEventListeners))),
    trackedEventListeners: round(median(metrics.map((sample) => sample.trackedEventListeners))),
    uiMutationsPerSecond: round(median(metrics.map((sample) => sample.uiMutationsPerSecond))),
    domNodes: round(median(metrics.map((sample) => sample.domNodes))),
    domNodeDelta: round(median(metrics.map((sample) => sample.domNodeDelta))),
    activeEventListenerGrowth:
      metrics[metrics.length - 1].activeEventListeners - metrics[0].activeEventListeners,
    trackedEventListenerGrowth:
      metrics[metrics.length - 1].trackedEventListeners - metrics[0].trackedEventListeners,
    domNodeGrowth: metrics[metrics.length - 1].domNodes - metrics[0].domNodes,
    jsHeapGrowthBytes:
      metrics[metrics.length - 1].jsHeapUsedBytes - metrics[0].jsHeapUsedBytes,
    materialGrowth: metrics[metrics.length - 1].materialCount - metrics[0].materialCount,
    rendererGeometryGrowth:
      metrics[metrics.length - 1].rendererGeometryCount - metrics[0].rendererGeometryCount,
    rendererTextureGrowth:
      metrics[metrics.length - 1].rendererTextureCount - metrics[0].rendererTextureCount,
    textureMemoryGrowthBytes:
      metrics[metrics.length - 1].textureMemoryBytes - metrics[0].textureMemoryBytes,
  };
}

function protocolFailures(report) {
  const failures = [];
  const expected = LOCKED_PERFORMANCE_PROTOCOL;
  const actual = report?.protocol;
  if (report?.schemaVersion !== LOCKED_PERFORMANCE_SCHEMA_VERSION) {
    failures.push(`schemaVersion must be ${LOCKED_PERFORMANCE_SCHEMA_VERSION}`);
  }
  if (actual?.viewport?.width !== expected.viewport.width
    || actual?.viewport?.height !== expected.viewport.height
    || actual?.viewport?.deviceScaleFactor !== expected.viewport.deviceScaleFactor) {
    failures.push('viewport must be 1920x1080 at DPR 1');
  }
  if (!approximately(report?.environment?.devicePixelRatio, expected.viewport.deviceScaleFactor)) {
    failures.push('measured browser devicePixelRatio must be 1');
  }
  if (actual?.qualityPreset !== expected.qualityPreset) failures.push('quality preset must be high');
  if (actual?.runsPerScenario !== expected.runsPerScenario) failures.push('runsPerScenario must be 3');
  if (actual?.aggregation !== expected.aggregation) failures.push('aggregation must be median');
  if (actual?.thresholds?.minimumAverageFps !== expected.thresholds.minimumAverageFps
    || actual?.thresholds?.minimumOnePercentLowFps
      !== expected.thresholds.minimumOnePercentLowFps
    || JSON.stringify(actual?.thresholds) !== JSON.stringify(expected.thresholds)) {
    failures.push('thresholds must match the complete locked performance and resource gate');
  }
  if (JSON.stringify(actual?.scenarios) !== JSON.stringify(expected.scenarios)) {
    failures.push(`scenario order must be ${expected.scenarios.join(', ')}`);
  }
  const scenarioKeys = Object.keys(report?.scenarios || {});
  if (JSON.stringify(scenarioKeys) !== JSON.stringify(expected.scenarios)) {
    failures.push(`scenario results must contain exactly ${expected.scenarios.join(', ')}`);
  }
  return failures;
}

export function evaluateLockedPerformanceReport(report) {
  const failures = protocolFailures(report);
  const gates = [];
  for (const scenarioKey of LOCKED_PERFORMANCE_PROTOCOL.scenarios) {
    const scenario = report?.scenarios?.[scenarioKey];
    if (!scenario) continue;
    let summary;
    try {
      summary = summarizeScenarioRuns(scenario.runs);
    } catch (error) {
      failures.push(`${scenarioKey}: ${error.message}`);
      continue;
    }
    const averageFpsPass = summary.averageFps
      >= LOCKED_PERFORMANCE_PROTOCOL.thresholds.minimumAverageFps;
    const onePercentLowFpsPass = summary.onePercentLowFps
      >= LOCKED_PERFORMANCE_PROTOCOL.thresholds.minimumOnePercentLowFps;
    const resourceChecks = {
      medianFramesOver50Ms: summary.framesOver50Ms
        <= LOCKED_PERFORMANCE_PROTOCOL.thresholds.maximumMedianFramesOver50Ms,
      activeEventListenerGrowth: summary.activeEventListenerGrowth
        <= LOCKED_PERFORMANCE_PROTOCOL.thresholds.maximumActiveEventListenerGrowth,
      trackedEventListenerGrowth: summary.trackedEventListenerGrowth
        <= LOCKED_PERFORMANCE_PROTOCOL.thresholds.maximumTrackedEventListenerGrowth,
      domNodeGrowth: summary.domNodeGrowth
        <= LOCKED_PERFORMANCE_PROTOCOL.thresholds.maximumDomNodeGrowth,
      jsHeapGrowthBytes: summary.jsHeapGrowthBytes
        <= LOCKED_PERFORMANCE_PROTOCOL.thresholds.maximumJsHeapGrowthBytes,
      materialGrowth: summary.materialGrowth
        <= LOCKED_PERFORMANCE_PROTOCOL.thresholds.maximumMaterialGrowth,
      rendererGeometryGrowth: summary.rendererGeometryGrowth
        <= LOCKED_PERFORMANCE_PROTOCOL.thresholds.maximumRendererGeometryGrowth,
      rendererTextureGrowth: summary.rendererTextureGrowth
        <= LOCKED_PERFORMANCE_PROTOCOL.thresholds.maximumRendererTextureGrowth,
      textureMemoryGrowthBytes: summary.textureMemoryGrowthBytes
        <= LOCKED_PERFORMANCE_PROTOCOL.thresholds.maximumEstimatedTextureMemoryGrowthBytes,
    };
    const resourceStabilityPass = Object.values(resourceChecks).every(Boolean);
    const gate = {
      scenario: scenarioKey,
      median: summary,
      averageFpsPass,
      onePercentLowFpsPass,
      resourceChecks,
      resourceStabilityPass,
      ok: averageFpsPass && onePercentLowFpsPass && resourceStabilityPass,
    };
    gates.push(gate);
    if (!averageFpsPass) {
      failures.push(
        `${scenarioKey}: median average FPS ${summary.averageFps} < 60`,
      );
    }
    if (!onePercentLowFpsPass) {
      failures.push(
        `${scenarioKey}: median 1% low FPS ${summary.onePercentLowFps} < 30`,
      );
    }
    for (const [metric, pass] of Object.entries(resourceChecks)) {
      if (!pass) failures.push(`${scenarioKey}: resource gate failed for ${metric} (${summary[metric]})`);
    }
  }
  return { ok: failures.length === 0, failures, gates };
}

// Goal 24 interaction-performance extension.
//
// This intentionally lives beside the original locked scene-throughput contract. The
// original schema and evaluator above remain version 1 and byte-for-byte compatible
// with their existing callers; interaction traces have their own explicit version so
// a driver can never pass one report shape to the other evaluator by accident.
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const LOCKED_INTERACTION_PERFORMANCE_SCHEMA_VERSION = 1;

const INTERACTION_SCENARIOS = [
  {
    id: 'coldLaunch',
    triggerEvidencePolicy: 'launcher-process',
    markerNames: ['electron-launch-requested', 'main-menu-interactive'],
    markerClock: 'launcher',
    cadencePolicy: 'duration-only-before-page-context',
    eventCount: { minimum: 7 },
    temperature: { policy: 'cold-only', minimumCold: 7, minimumWarm: 0 },
    gradeWarm: false,
    discriminatorKeys: [
      'processInstanceId', 'userDataProfileId', 'userDataDirectory', 'freshProcess',
      'mainMenuInteractive', 'shaderCachePolicy', 'gpuCachePolicy',
    ],
  },
  {
    id: 'startToControllable',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['start-control-activated', 'first-controllable-display-boundary'],
    markerClock: 'launcher',
    cadencePolicy: 'display-and-render-after-instrumentation-ready',
    eventCount: { minimum: 7 },
    temperature: { policy: 'cold-only', minimumCold: 7, minimumWarm: 0 },
    gradeWarm: false,
    discriminatorKeys: [
      'processInstanceId', 'menuControl', 'controlActivated', 'gameplayControllable',
      'movementProbeAccepted', 'instrumentationReadyBeforeControl',
      'firstControllableDisplayBoundaryObserved', 'firstControllableRenderObserved',
      'instrumentationReadyAtMs', 'firstControllableDisplayBoundaryAtMs',
      'firstControllableRenderAtMs', 'renderInstrumentationAttachedAtMs',
    ],
  },
  {
    id: 'doorApproach',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['door-approach-start', 'door-approach-threshold'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { minimum: 10 },
    temperature: { policy: 'cold-block-then-warm', minimumCold: 7, minimumWarm: 3 },
    gradeWarm: true,
    gradeCold: true,
    discriminatorKeys: [
      'doorId', 'processInstanceId', 'freshProcess', 'startZone', 'endZone',
      'startDistanceYards', 'thresholdCrossed',
    ],
  },
  {
    id: 'doorFirstOpen',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['door-first-open-input', 'door-first-open-swing-observed'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { minimum: 7 },
    temperature: { policy: 'cold-only', minimumCold: 7, minimumWarm: 0 },
    gradeWarm: false,
    gradeCold: true,
    discriminatorKeys: [
      'doorId', 'processInstanceId', 'freshProcess', 'focusTargetDoorId',
      'interactKey', 'desiredState', 'desiredStateApplied', 'opened',
      'openSwingObserved', 'openSwingRadians', 'productionDoorSignal',
      'productionDoorSignalAtMs',
    ],
  },
  {
    id: 'doorCrossingOutsideToInside',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['outside-crossing-start', 'inside-crossing-complete'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { minimum: 10 },
    temperature: { policy: 'cold-block-then-warm', minimumCold: 7, minimumWarm: 3 },
    gradeWarm: true,
    gradeCold: true,
    discriminatorKeys: [
      'doorId', 'processInstanceId', 'freshProcess', 'fromZone', 'toZone',
       'boundaryCrossed', 'normalMovement', 'noPriorInteriorThresholdCrossing',
       'interiorVisibilityObserved', 'productionVisibilityMarker',
       'productionVisibilityAtMs', 'detailVisibilityTransition',
       'detailVisibilitySequenceDelta',
    ],
  },
  {
    id: 'doorCrossingInsideToOutside',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['inside-crossing-start', 'outside-crossing-complete'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { minimum: 3 },
    temperature: { policy: 'warm-only', minimumCold: 0, minimumWarm: 3 },
    gradeWarm: true,
    discriminatorKeys: ['doorId', 'fromZone', 'toZone', 'boundaryCrossed', 'normalMovement'],
  },
  {
    id: 'ledgerOpen',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['ledger-open-input', 'ledger-open-readable'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { minimum: 4 },
    temperature: { policy: 'cold-then-warm', minimumCold: 1, minimumWarm: 3 },
    gradeWarm: true,
    discriminatorKeys: [
      'fromState', 'toState', 'readable', 'ledgerOwnsInput', 'firstOpen',
      'entryKey', 'interactKey',
    ],
  },
  {
    id: 'ledgerPageTurns10',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['ledger-page-input', 'ledger-page-content-ready'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { exact: 10 },
    temperature: { policy: 'warm-only', minimumCold: 0, minimumWarm: 10 },
    gradeWarm: true,
    discriminatorKeys: [
      'direction', 'fromPage', 'toPage', 'bookAlreadyOpen', 'contentReady',
    ],
  },
  {
    id: 'ledgerClose',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['ledger-close-input', 'walk-control-restored'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { minimum: 3 },
    temperature: { policy: 'warm-only', minimumCold: 0, minimumWarm: 3 },
    gradeWarm: true,
    discriminatorKeys: ['fromState', 'toState', 'walkControlRestored'],
  },
  {
    id: 'toolFirstUseByTool',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['tool-first-equip-input', 'tool-first-viewmodel-ready'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { matchesEnvironmentToolIds: true },
    temperature: { policy: 'cold-only', minimumCold: 1, minimumWarm: 0 },
    gradeWarm: false,
    gradeCold: true,
    discriminatorKeys: [
      'toolId', 'supportedToolIds', 'processInstanceId', 'fromTool', 'toTool',
      'equipKey', 'changed', 'viewmodelReady', 'firstUse', 'heldToolVisible',
      'equipAnimationSettled', 'productionEquipSequenceBase',
      'productionEquipSequence', 'productionEquipSignal', 'productionEquipAtMs',
    ],
  },
  {
    id: 'toolChanges20',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['tool-change-input', 'tool-viewmodel-ready'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { exact: 20 },
    temperature: { policy: 'warm-only', minimumCold: 0, minimumWarm: 20 },
    gradeWarm: true,
    discriminatorKeys: [
      'processInstanceId', 'fromTool', 'toTool', 'equipKey', 'changed', 'viewmodelReady',
      'firstUse', 'productionEquipSequence', 'productionEquipSignal', 'productionEquipAtMs',
    ],
  },
  {
    id: 'npcNavActivation',
    triggerEvidencePolicy: 'production-lifecycle',
    markerNames: ['organic-footfall-window-start', 'first-route-resolved'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { minimum: 1 },
    temperature: { policy: 'cold-only', minimumCold: 1, minimumWarm: 0 },
    gradeWarm: false,
    gradeCold: true,
    discriminatorKeys: [
      'customerActivated', 'routeRequested', 'routeResolved', 'routeRequestId',
      'lifecycleWindowStartedAtMs', 'routeRequestedAtMs', 'routeResolvedAtMs',
      'sceneLoaded', 'sceneLoadedAtMs', 'navCreateDurationMs',
      'navPerformanceBefore', 'navPerformanceAfter', 'navPerformanceAtObservation',
      'navPerformanceDelta',
    ],
  },
  {
    id: 'ledgerTurns50Stress',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['ledger-stress-turn-input', 'ledger-stress-content-ready'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { exact: 50 },
    temperature: { policy: 'warm-only', minimumCold: 0, minimumWarm: 50 },
    gradeWarm: true,
    stress: { iterations: 50 },
    discriminatorKeys: [
      'direction', 'fromPage', 'toPage', 'bookAlreadyOpen', 'contentReady',
    ],
  },
  {
    id: 'toolSwitches100Stress',
    triggerEvidencePolicy: 'trusted-user-input',
    markerNames: ['tool-stress-switch-input', 'tool-stress-viewmodel-ready'],
    markerClock: 'renderer',
    cadencePolicy: 'display-and-render',
    eventCount: { exact: 100 },
    temperature: { policy: 'warm-only', minimumCold: 0, minimumWarm: 100 },
    gradeWarm: true,
    stress: { iterations: 100 },
    discriminatorKeys: [
      'processInstanceId', 'fromTool', 'toTool', 'equipKey', 'changed', 'viewmodelReady',
      'firstUse', 'productionEquipSequence', 'productionEquipSignal', 'productionEquipAtMs',
    ],
  },
];

const RESOURCE_METRICS = [
  'jsHeapUsedBytes',
  'domNodeCount',
  'sceneObjectCount',
  'meshCount',
  'materialCount',
  'geometryCount',
  'textureCount',
  'rendererGeometryAllocationCount',
  'rendererTextureAllocationCount',
  'rendererProgramCount',
  'textureDimensionsUnknownCount',
  'activeEventListenerCount',
  'renderCallbackCount',
  'renderLoopCount',
  'audioContextCount',
  'drawCallCount',
  'renderedTriangleCount',
  'estimatedTextureBytes',
  'observedComposedFrameCount',
  'shadowBakeFrameCount',
  'shadowBakeCount',
];

const NON_PERSISTENT_RESOURCE_METRICS = Object.freeze([
  'drawCallCount',
  'renderedTriangleCount',
  'observedComposedFrameCount',
  'shadowBakeFrameCount',
  'shadowBakeCount',
]);

const PERSISTENT_RESOURCE_METRICS = RESOURCE_METRICS.filter(
  (key) => !NON_PERSISTENT_RESOURCE_METRICS.includes(key),
);

const DETERMINISTIC_PERSISTENT_RESOURCE_METRICS = PERSISTENT_RESOURCE_METRICS.filter(
  (key) => key !== 'jsHeapUsedBytes',
);

const RESOURCE_METRIC_UNITS = Object.fromEntries(
  RESOURCE_METRICS.map((key) => [
    key,
    key === 'jsHeapUsedBytes' || key === 'estimatedTextureBytes' ? 'bytes' : 'count',
  ]),
);

export const LOCKED_INTERACTION_PERFORMANCE_PROTOCOL = deepFreeze({
  id: 'golf-flipper/goal-24-locked-interaction-performance',
  version: 1,
  scenarioOrder: INTERACTION_SCENARIOS.map(({ id }) => id),
  scenarios: INTERACTION_SCENARIOS,
  cadence: {
    display: 'requestAnimationFrame',
    render: 'actual-render-callback',
    runtimeClock: 'performance.now',
    launcherClock: 'epoch-bridged-runner-monotonic-clock',
    maximumBoundaryGapMs: 50,
    maximumEndpointToleranceMs: 0.001,
    maximumMarkerDurationToleranceMs: 1,
    maximumInputDeliveryLatencyMs: 1000,
    maximumClockBridgeUncertaintyMs: 100,
  },
  thresholds: {
    warmP95FrameMsExclusive: 20,
    warmTargetWorstFrameMsExclusive: 33,
    maximumWarmFramesOver50Ms: 0,
    recurringFrameGateScenarioIds: [
      'doorApproach', 'doorCrossingOutsideToInside', 'doorCrossingInsideToOutside',
      'ledgerOpen', 'ledgerPageTurns10', 'ledgerClose', 'toolChanges20',
      'ledgerTurns50Stress', 'toolSwitches100Stress',
    ],
    maximumWarmEventsWithFramesOver33Ms: 1,
    framesOver33MsExclusive: 33,
    framesOver50MsExclusive: 50,
    coldP95FrameMsExclusive: 33,
    coldMaximumFrameMsInclusive: 50,
    maximumColdFramesOver50Ms: 0,
    maximumColdInteractionDurationMs: {
      doorApproach: 5000,
      doorFirstOpen: 8000,
      doorCrossingOutsideToInside: 3500,
      toolFirstUseByTool: 6000,
      npcNavActivation: 40000,
    },
    maximumWarmInteractionDurationMs: {
      doorApproach: 5000,
      doorCrossingOutsideToInside: 3500,
      doorCrossingInsideToOutside: 3500,
      ledgerOpen: 2500,
      ledgerPageTurns10: 1500,
      ledgerClose: 2500,
      toolChanges20: 1000,
      ledgerTurns50Stress: 1500,
      toolSwitches100Stress: 1000,
    },
  },
  coldPolicy: 'report-separately-and-never-grade-as-warm',
  inputEvidence: {
    journal: 'per-event-trigger-records-with-scenario-specific-trust-policy',
    eventLink: 'event.input.recordId',
    policies: {
      trustedUserInput: 'raw-DOM-event-isTrusted-with-timestamp-code-target',
      launcherProcess: 'runner-process-spawn-anchor-no-DOM-trust-claim',
      productionLifecycle: 'production-lifecycle-or-QA-entrypoint-no-direct-state-mutation',
    },
    consumptionProof: 'distinct-production-handler-signal',
    outcomeProof: 'independently-observed-transition-linked-to-end-marker',
    ordering: 'requested-delivered-consumed-outcome',
  },
  negativeControl: {
    kind: 'busy-main-thread-stall',
    injectedDurationMs: 80,
    minimumObservedFrameMs: 50,
    minimumElapsedRatio: 0.9,
  },
  stress: {
    minimumResourceCheckpoints: 6,
    resourceDiagnosticsSchemaVersion: GOAL24_RESOURCE_DIAGNOSTICS_SCHEMA_VERSION,
    productionFrameLoopOwnerToken: 'golf-flipper/src/main.js:production-frame-loop:v1',
    resourceMetrics: RESOURCE_METRICS,
    persistentResourceMetrics: PERSISTENT_RESOURCE_METRICS,
    deterministicPersistentResourceMetrics: DETERMINISTIC_PERSISTENT_RESOURCE_METRICS,
    resourceMetricUnits: RESOURCE_METRIC_UNITS,
    resourceProvenanceFields: ['source', 'unit'],
    observedComposedFrameCount: { exact: 12 },
    jsHeapTolerance: {
      minimumBytes: 2 * 1024 * 1024,
      relativeFraction: 0.05,
      policy: 'maximum-of-two-MiB-or-five-percent-of-reference',
    },
    workloadContextComparison: {
      semanticFields: 'exact',
      numericPoseTolerance: 0.001,
      matchingKey: 'scenario-and-iteration',
    },
    resourceLimits: {
      renderCallbackCount: { minimum: 1, maximum: 1 },
      renderLoopCount: { minimum: 1, maximum: 1 },
      audioContextCount: { minimum: 0, maximum: 1 },
      observedComposedFrameCount: { minimum: 12, maximum: 12 },
    },
    maximumEndDelta: {
      domNodeCount: 0,
      sceneObjectCount: 0,
      meshCount: 0,
      materialCount: 0,
      geometryCount: 0,
      textureCount: 0,
      rendererGeometryAllocationCount: 0,
      rendererTextureAllocationCount: 0,
      rendererProgramCount: 0,
      textureDimensionsUnknownCount: 0,
      estimatedTextureBytes: 0,
      activeEventListenerCount: 0,
      renderCallbackCount: 0,
      renderLoopCount: 0,
      audioContextCount: 0,
    },
    sustainedGrowthNoise: {
      jsHeapUsedBytes: 2 * 1024 * 1024,
      estimatedTextureBytes: 0,
      countMetrics: 0,
    },
    nonPersistentWorkloadMetrics: NON_PERSISTENT_RESOURCE_METRICS,
    checkpointPolicy: 'post-gc-start-periodic-end',
    growthPolicy: 'no-positive-regression-and-net-growth-above-metric-noise-across-post-gc-checkpoints',
  },
});

const interactionScenarioById = new Map(
  LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios.map((scenario) => [scenario.id, scenario]),
);

const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const positiveFinite = (value) => finite(value) && value > 0;
const nonNegativeFinite = (value) => finite(value) && value >= 0;
const allowedTemperature = (value) => value === 'cold' || value === 'warm';

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function timingDistribution(values, label, includeFrameCounts = false) {
  if (!Array.isArray(values) || values.length === 0
    || values.some((value) => !positiveFinite(value))) {
    throw new TypeError(`${label} requires a non-empty array of positive finite numbers`);
  }
  const result = {
    sampleCount: values.length,
    medianMs: round(median(values)),
    p95Ms: round(percentile(values, 0.95)),
    worstMs: round(Math.max(...values)),
  };
  if (includeFrameCounts) {
    result.framesOver33Ms = values.filter((value) => value > 33).length;
    result.framesOver50Ms = values.filter((value) => value > 50).length;
  }
  return result;
}

function validateGenericInteractionEvent(event, index) {
  const prefix = `event ${index + 1}`;
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError(`${prefix} must be an object`);
  }
  if (event.sequence !== index + 1) {
    throw new TypeError(`${prefix} sequence must be ${index + 1}`);
  }
  if (!allowedTemperature(event.temperature)) {
    throw new TypeError(`${prefix} temperature must be cold or warm`);
  }
  const input = event.input;
  if (!nonEmptyString(input?.kind) || !nonEmptyString(input?.control)
    || !nonEmptyString(input?.delivery) || !nonEmptyString(input?.recordId)
    || !['trusted-user-input', 'launcher-process', 'production-lifecycle']
      .includes(input?.evidencePolicy)) {
    throw new TypeError(
      `${prefix} requires input kind, control, delivery, evidence policy, and raw record linkage`,
    );
  }
  if (input.productionPath !== true || input.directStateMutation !== false) {
    throw new TypeError(`${prefix} must prove production input with no direct state mutation`);
  }
  const start = event.markers?.start;
  const end = event.markers?.end;
  if (!nonEmptyString(start?.name) || !nonEmptyString(end?.name)
    || !['launcher', 'renderer'].includes(start?.clock) || end?.clock !== start.clock
    || !nonNegativeFinite(start?.atMs) || !positiveFinite(end?.atMs)
    || end.atMs <= start.atMs) {
    throw new TypeError(`${prefix} has invalid ordered same-clock start/end markers`);
  }
  const coverage = event.sampleCoverage;
  const durationMs = end.atMs - start.atMs;
  if (!coverage || coverage.complete !== true
    || coverage.droppedDisplaySamples !== 0
    || coverage.droppedRenderSamples !== 0
    || coverage.droppedSubmissionSamples !== 0
    || !nonNegativeFinite(coverage.windowDurationMs)
    || Math.abs(coverage.windowDurationMs - durationMs)
      > LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.cadence.maximumMarkerDurationToleranceMs) {
    throw new TypeError(`${prefix} requires complete zero-drop cadence coverage`);
  }
  const cadenceShapes = [
    {
      cadenceKey: 'display',
      intervalsKey: 'displayFrameIntervalsMs',
      endpointsKey: 'displayCadenceIntervals',
      firstOffsetKey: 'displayFirstBoundaryOffsetMs',
      lastGapKey: 'displayLastBoundaryBeforeEndMs',
    },
    {
      cadenceKey: 'render',
      intervalsKey: 'renderFrameIntervalsMs',
      endpointsKey: 'renderCadenceIntervals',
      firstOffsetKey: 'renderFirstBoundaryOffsetMs',
      lastGapKey: 'renderLastBoundaryBeforeEndMs',
    },
  ];
  for (const shape of cadenceShapes) {
    const {
      cadenceKey, intervalsKey, endpointsKey, firstOffsetKey, lastGapKey,
    } = shape;
    const availability = event.cadenceAvailability?.[cadenceKey];
    const intervals = event[intervalsKey];
    const endpoints = event[endpointsKey];
    if (availability?.status === 'unavailable') {
      if (!Array.isArray(intervals) || intervals.length !== 0
        || !Array.isArray(endpoints) || endpoints.length !== 0
        || !nonEmptyString(availability.reason)) {
        throw new TypeError(
          `${prefix} unavailable ${cadenceKey} cadence requires empty duration and endpoint arrays and a reason`,
        );
      }
      if (coverage[firstOffsetKey] !== null || coverage[lastGapKey] !== null) {
        throw new TypeError(`${prefix} unavailable ${cadenceKey} cadence cannot claim boundary coverage`);
      }
      continue;
    }
    if (availability?.status !== 'measured') {
      throw new TypeError(`${prefix} ${cadenceKey} cadence availability is required`);
    }
    timingDistribution(intervals, `${prefix} ${intervalsKey}`, true);
    if (!Array.isArray(endpoints) || endpoints.length !== intervals.length) {
      throw new TypeError(
        `${prefix} ${cadenceKey} cadence requires one interval-endpoint record per duration sample`,
      );
    }
    const tolerance = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.cadence
      .maximumEndpointToleranceMs;
    if (!nonNegativeFinite(availability.priorBoundaryAtMs)
      || !nonEmptyString(availability.priorBoundarySource)
      || Math.abs(availability.priorBoundaryAtMs - endpoints[0]?.startAtMs) > tolerance) {
      throw new TypeError(
        `${prefix} ${cadenceKey} cadence requires a documented prior boundary`,
      );
    }
    endpoints.forEach((entry, endpointIndex) => {
      const previous = endpoints[endpointIndex - 1];
      const malformed = !nonNegativeFinite(entry?.startAtMs)
        || !positiveFinite(entry?.endAtMs)
        || entry.endAtMs <= entry.startAtMs
        || !positiveFinite(entry?.durationMs)
        || Math.abs((entry.endAtMs - entry.startAtMs) - entry.durationMs) > tolerance
        || Math.abs(entry.durationMs - intervals[endpointIndex]) > tolerance
        || (previous && Math.abs(entry.startAtMs - previous.endAtMs) > tolerance);
      if (malformed) {
        throw new TypeError(
          `${prefix} ${cadenceKey} cadence endpoint ${endpointIndex + 1} must be ordered, contiguous, and duration-equal`,
        );
      }
      if (entry.endAtMs - end.atMs > tolerance
        || (endpointIndex > 0 && entry.startAtMs < start.atMs - tolerance)) {
        throw new TypeError(`${prefix} ${cadenceKey} cadence contains samples outside the graded window`);
      }
    });
    const first = endpoints[0];
    const last = endpoints.at(-1);
    const lastGap = end.atMs - last.endAtMs;
    const startRenderCadence = event.scenarioId === 'startToControllable'
      && cadenceKey === 'render';
    if (startRenderCadence) {
      const measurementStartedAtMs = availability.measurementStartedAtMs;
      const renderInstrumentationAttachedAtMs = event.discriminator
        ?.renderInstrumentationAttachedAtMs;
      const firstOffset = measurementStartedAtMs - start.atMs;
      if (!nonNegativeFinite(measurementStartedAtMs)
        || !nonEmptyString(availability.preMeasurementReason)
        || Math.abs(measurementStartedAtMs - first.startAtMs) > tolerance
        || measurementStartedAtMs < start.atMs - tolerance
        || measurementStartedAtMs >= end.atMs
        || !nonNegativeFinite(renderInstrumentationAttachedAtMs)
        || renderInstrumentationAttachedAtMs - measurementStartedAtMs > tolerance
        || lastGap < -tolerance
        || lastGap > LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.cadence.maximumBoundaryGapMs
        || !approximately(coverage[firstOffsetKey], firstOffset, tolerance)
        || !approximately(coverage[lastGapKey], lastGap, tolerance)) {
        throw new TypeError(
          `${prefix} start render cadence must begin at its documented first observed production-render boundary after instrumentation attachment and cover the exact graded end`,
        );
      }
      continue;
    }
    const firstOffset = first.endAtMs - start.atMs;
    if (!(first.startAtMs < start.atMs && first.endAtMs > start.atMs)
      || firstOffset > LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.cadence.maximumBoundaryGapMs
      || lastGap < -tolerance
      || lastGap > LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.cadence.maximumBoundaryGapMs
      || !approximately(coverage[firstOffsetKey], firstOffset, tolerance)
      || !approximately(coverage[lastGapKey], lastGap, tolerance)) {
      throw new TypeError(
        `${prefix} ${cadenceKey} cadence must straddle the start marker from its documented prior boundary and cover the exact graded end`,
      );
    }
  }
  if (!event.discriminator || typeof event.discriminator !== 'object'
    || Array.isArray(event.discriminator)) {
    throw new TypeError(`${prefix} requires a discriminator object`);
  }
  return end.atMs - start.atMs;
}

function summarizeEventSubset(entries) {
  if (entries.length === 0) return null;
  const displayIntervals = entries.flatMap(({ event }) => event.displayFrameIntervalsMs);
  const renderIntervals = entries.flatMap(({ event }) => event.renderFrameIntervalsMs);
  return {
    eventCount: entries.length,
    interactionDuration: timingDistribution(
      entries.map(({ durationMs }) => durationMs),
      'interaction durations',
    ),
    displayCadence: displayIntervals.length > 0
      ? timingDistribution(displayIntervals, 'display cadence', true)
      : null,
    renderCadence: renderIntervals.length > 0
      ? timingDistribution(renderIntervals, 'render cadence', true)
      : null,
    eventsWithFrameOver33Ms: entries.filter(({ event }) => (
      event.displayFrameIntervalsMs.some((value) => value > 33)
      || event.renderFrameIntervalsMs.some((value) => value > 33)
    )).length,
    eventsWithFrameOver50Ms: entries.filter(({ event }) => (
      event.displayFrameIntervalsMs.some((value) => value > 50)
      || event.renderFrameIntervalsMs.some((value) => value > 50)
    )).length,
  };
}

export function summarizeInteractionEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new TypeError('interaction events require a non-empty array');
  }
  const entries = events.map((event, index) => ({
    event,
    durationMs: validateGenericInteractionEvent(event, index),
  }));
  return {
    eventCount: entries.length,
    all: summarizeEventSubset(entries),
    cold: summarizeEventSubset(entries.filter(({ event }) => event.temperature === 'cold')),
    warm: summarizeEventSubset(entries.filter(({ event }) => event.temperature === 'warm')),
  };
}

function protocolInteractionFailures(report) {
  const failures = [];
  const expected = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL;
  const actual = report?.protocol;
  if (report?.schemaVersion !== LOCKED_INTERACTION_PERFORMANCE_SCHEMA_VERSION) {
    failures.push(
      `schemaVersion must be ${LOCKED_INTERACTION_PERFORMANCE_SCHEMA_VERSION}`,
    );
  }
  try {
    validateGoal24DoorEvidenceAggregate(report?.doorEvidence);
  } catch (error) {
    failures.push(`doorEvidence: ${error?.message || error}`);
  }
  if (actual?.id !== expected.id || actual?.version !== expected.version) {
    failures.push(`protocol must be ${expected.id} version ${expected.version}`);
  }
  if (JSON.stringify(actual?.scenarioOrder) !== JSON.stringify(expected.scenarioOrder)) {
    failures.push(`scenario order must be ${expected.scenarioOrder.join(', ')}`);
  }
  for (const key of [
    'cadence', 'thresholds', 'inputEvidence', 'negativeControl', 'stress',
  ]) {
    if (JSON.stringify(actual?.[key]) !== JSON.stringify(expected[key])) {
      failures.push(`protocol.${key} does not match the locked interaction protocol`);
    }
  }
  if (actual?.coldPolicy !== expected.coldPolicy) {
    failures.push(`protocol.coldPolicy must be ${expected.coldPolicy}`);
  }
  return failures;
}

function inputRecordFailures(inputRecords, scenarios) {
  const failures = [];
  if (!Array.isArray(inputRecords)) {
    return ['inputRecords must be an array of per-event trigger evidence'];
  }
  const recordsById = new Map();
  inputRecords.forEach((record, index) => {
    if (!nonEmptyString(record?.recordId)) {
      failures.push(`inputRecords[${index}].recordId is required`);
      return;
    }
    if (recordsById.has(record.recordId)) {
      failures.push(`inputRecords has duplicate recordId ${record.recordId}`);
      return;
    }
    recordsById.set(record.recordId, record);
  });
  const linkedIds = new Set();
  const events = scenarios.flatMap((scenario) => (
    Array.isArray(scenario?.events)
      ? scenario.events.map((event) => ({
        scenarioId: scenario.id,
        spec: interactionScenarioById.get(scenario.id),
        event,
      }))
      : []
  ));
  for (const { scenarioId, spec, event } of events) {
    const prefix = `${scenarioId}: event ${event?.sequence ?? '?'}`;
    const recordId = event?.input?.recordId;
    const record = recordsById.get(recordId);
    if (!record) {
      failures.push(`${prefix} has no linked raw input record ${recordId ?? '(missing)'}`);
      continue;
    }
    linkedIds.add(recordId);
    const start = event.markers?.start;
    const end = event.markers?.end;
    if (record.scenarioId !== scenarioId || record.eventSequence !== event.sequence) {
      failures.push(`${prefix} raw input record scenario/sequence linkage does not match`);
    }
    if (record.kind !== event.input.kind || record.control !== event.input.control
      || record.delivery !== event.input.delivery
      || record.evidencePolicy !== event.input.evidencePolicy
      || record.evidencePolicy !== spec?.triggerEvidencePolicy) {
      failures.push(`${prefix} raw trigger kind/control/delivery/evidence policy does not match the event`);
    }
    if (record.clock !== start?.clock
      || !nonNegativeFinite(record.requestedAtMs)
      || !nonNegativeFinite(record.deliveredAtMs)
      || record.requestedAtMs > record.deliveredAtMs
      || record.deliveredAtMs < start?.atMs
      || record.deliveredAtMs > end?.atMs) {
      failures.push(`${prefix} raw input timestamps are not ordered inside the event markers`);
    }
    if (!nonEmptyString(record.raw?.eventType)
      || !nonEmptyString(record.raw?.target) || !nonEmptyString(record.raw?.source)
      || record.raw?.atMs !== record.deliveredAtMs) {
      failures.push(`${prefix} requires raw trigger timestamp/target/source evidence`);
    } else if (record.evidencePolicy === 'trusted-user-input') {
      const request = record.request;
      const expectedAction = record.raw.eventType === 'keyup' ? 'up'
        : record.raw.eventType === 'keydown-sequence' ? 'down'
          : record.raw.eventType === 'click' ? 'click' : 'down';
      const requestInsideWindow = event.scenarioId === 'startToControllable'
        ? request?.atMs >= event.discriminator?.instrumentationReadyAtMs
        : request?.atMs >= start?.atMs;
      if (request?.atMs !== record.requestedAtMs
        || request?.source !== (event.scenarioId === 'startToControllable'
          ? 'driver-immediately-before-Playwright-primary-menu-click'
          : 'driver-immediately-before-Playwright-input-call')
        || request?.kind !== record.kind
        || !nonEmptyString(request?.actualControl)
        || request?.action !== expectedAction
        || request?.scenarioId !== event.scenarioId
        || request?.rawScenario !== event.scenarioId
        || !requestInsideWindow
        || record.deliveredAtMs - request.atMs
          > LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.cadence.maximumInputDeliveryLatencyMs) {
        failures.push(`${prefix} requires bounded recorder-owned pre-input request evidence`);
      }
      if (record.raw.isTrusted !== true || record.raw.trustBasis !== 'browser-isTrusted') {
        failures.push(`${prefix} trusted user input requires browser isTrusted evidence`);
      }
      const keyboard = /^key(?:down|up)$/u.test(record.raw.eventType)
        && nonEmptyString(record.raw.code) && nonEmptyString(record.raw.key);
    const pointer = /^(?:pointerdown|pointerup|click|wheel)$/u.test(record.raw.eventType)
        && Number.isFinite(record.raw.clientX) && Number.isFinite(record.raw.clientY)
        && Number.isInteger(record.raw.button);
      const expectedLedgerSteps = [
        { phase: 'raise-book', control: event.discriminator?.entryKey },
        { phase: 'open-cover', control: event.discriminator?.interactKey },
      ];
      const keyboardSequence = record.raw.eventType === 'keydown-sequence'
        && event.scenarioId === 'ledgerOpen'
        && Array.isArray(record.raw.steps)
        && record.raw.steps.length === expectedLedgerSteps.length
        && record.raw.steps.every((entry, sequenceIndex) => {
          const expectedStep = expectedLedgerSteps[sequenceIndex];
          const previous = record.raw.steps[sequenceIndex - 1];
          return entry?.eventType === 'keydown'
            && entry.phase === expectedStep.phase
            && String(entry.control || '').toLowerCase() === String(expectedStep.control || '').toLowerCase()
            && String(entry.key || '').toLowerCase() === String(expectedStep.control || '').toLowerCase()
            && nonEmptyString(entry.code)
            && entry.isTrusted === true
            && entry.trustBasis === 'browser-isTrusted'
            && nonNegativeFinite(entry.eventTimestampMs)
            && nonNegativeFinite(entry.observedAtMs)
            && entry.observedAtMs === entry.deliveredAtMs
            && nonNegativeFinite(entry.requestedAtMs)
            && entry.requestSource === 'driver-immediately-before-Playwright-input-call'
            && entry.requestKind === 'keyboard'
            && entry.requestedAtMs <= entry.deliveredAtMs
            && entry.deliveredAtMs >= start?.atMs
            && entry.deliveredAtMs <= end?.atMs
            && entry.consumed?.signal
            && nonNegativeFinite(entry.consumed?.atMs)
            && entry.consumed.atMs >= entry.deliveredAtMs
            && entry.consumed.atMs <= end?.atMs
            && (sequenceIndex === 0 || (
              entry.requestedAtMs >= previous.deliveredAtMs
              && previous.consumed.atMs <= entry.requestedAtMs
            ));
        })
        && record.requestedAtMs === record.raw.steps[0].requestedAtMs
        && record.deliveredAtMs === record.raw.steps[1].deliveredAtMs
        && record.raw.atMs === record.raw.steps[1].deliveredAtMs;
      if (!keyboard && !pointer && !keyboardSequence) {
        failures.push(
          `${prefix} trusted input must provide keyboard key/code or pointer button/coordinates`,
        );
      }
      if (event.scenarioId === 'startToControllable'
        && (record.request?.actualControl !== event.discriminator?.menuControl
          || record.raw?.targetControlLabel !== event.discriminator?.menuControl
          || record.raw?.targetElement?.tag !== 'button'
          || !String(record.raw?.targetElement?.text || '').toLowerCase()
            .includes(String(event.discriminator?.menuControl || '').toLowerCase()))) {
        failures.push(`${prefix} start input must target the exact requested primary menu button`);
      }
      if (event.scenarioId === 'doorFirstOpen'
        && (event.input.kind !== 'keyboard'
          || event.input.control !== 'door-interact-binding'
          || String(record.raw?.key || '').toLowerCase()
            !== String(event.discriminator?.interactKey || '').toLowerCase()
          || String(record.request?.actualControl || '').toLowerCase()
            !== String(event.discriminator?.interactKey || '').toLowerCase())) {
        failures.push(`${prefix} first door open requires the exact trusted interact key`);
      }
      if (['toolFirstUseByTool', 'toolChanges20', 'toolSwitches100Stress']
        .includes(event.scenarioId)
        && (event.input.kind !== 'keyboard'
          || event.input.control !== 'tool-belt-binding'
          || String(record.raw?.key || '').toLowerCase()
            !== String(event.discriminator?.equipKey || '').toLowerCase()
          || String(record.request?.actualControl || '').toLowerCase()
            !== String(event.discriminator?.equipKey || '').toLowerCase())) {
        failures.push(`${prefix} tool equip requires the exact trusted tool-belt key`);
      }
      if (!nonNegativeFinite(record.raw.eventTimestampMs)
        || !nonNegativeFinite(record.raw.observedAtMs)
        || record.raw.observedAtMs !== record.raw.atMs) {
        failures.push(`${prefix} trusted input requires native and listener-observed timestamps`);
      }
    } else {
      const expectedTrustBasis = record.evidencePolicy === 'launcher-process'
        ? 'launcher-process-anchor' : 'production-lifecycle-observation';
      if (record.raw.isTrusted !== null || record.raw.trustBasis !== expectedTrustBasis) {
        failures.push(
          `${prefix} ${record.evidencePolicy} must explicitly avoid a DOM isTrusted claim`,
        );
      }
    }
    if (!nonEmptyString(record.consumed?.signal)
      || record.consumed?.productionHandlerObserved !== true
      || !nonNegativeFinite(record.consumed?.atMs)
      || record.consumed.atMs < record.deliveredAtMs
      || record.consumed.atMs > end?.atMs) {
      failures.push(`${prefix} requires a separately observed production-handler signal`);
    }
    if (event.scenarioId === 'doorFirstOpen'
      && (record.consumed?.signal !== event.discriminator?.productionDoorSignal
        || record.consumed?.atMs !== event.discriminator?.productionDoorSignalAtMs)) {
      failures.push(`${prefix} production door signal must match the consumed shipping edge`);
    }
    if (['toolFirstUseByTool', 'toolChanges20', 'toolSwitches100Stress']
      .includes(event.scenarioId)
      && (record.consumed?.signal !== event.discriminator?.productionEquipSignal
        || record.consumed?.atMs !== event.discriminator?.productionEquipAtMs)) {
      failures.push(`${prefix} production equip signal must match the consumed shipping edge`);
    }
    if (record.outcome?.observed !== true || !nonEmptyString(record.outcome?.signal)
      || !nonEmptyString(record.outcome?.observationSource)
      || record.outcome?.markerName !== end?.name || record.outcome?.atMs !== end?.atMs
      || record.outcome?.signal === record.consumed?.signal
      || record.outcome?.atMs < record.consumed?.atMs) {
      failures.push(`${prefix} requires an independent ordered outcome linked to the end marker`);
    }
  }
  for (const record of inputRecords) {
    if (nonEmptyString(record?.recordId) && !linkedIds.has(record.recordId)) {
      failures.push(`inputRecords contains unlinked recordId ${record.recordId}`);
    }
  }
  if (inputRecords.length !== events.length) {
    failures.push(`inputRecords must contain exactly one linked record for each event`);
  }
  return failures;
}

function environmentInteractionFailures(environment) {
  const failures = [];
  const requireStrings = (owner, label, keys) => {
    for (const key of keys) {
      if (!nonEmptyString(owner?.[key])) failures.push(`${label}.${key} is required`);
    }
  };
  requireStrings(environment?.renderer, 'environment.renderer', ['name', 'api', 'version']);
  if (environment?.renderer?.hardwareAccelerated !== true) {
    failures.push('environment.renderer.hardwareAccelerated must be true');
  }
  if (environment?.renderer?.contextLost !== false) {
    failures.push('environment.renderer.contextLost must be false');
  }
  requireStrings(environment?.gpu, 'environment.gpu', ['vendor', 'renderer', 'backend']);
  if (!positiveFinite(environment?.window?.innerWidth)
    || !positiveFinite(environment?.window?.innerHeight)
    || !positiveFinite(environment?.window?.outerWidth)
    || !positiveFinite(environment?.window?.outerHeight)) {
    failures.push('environment.window requires positive inner and outer dimensions');
  }
  if (environment?.window?.innerWidth !== 1920 || environment?.window?.innerHeight !== 1080) {
    failures.push('acceptance environment.window inner size must be exactly 1920x1080');
  }
  if (!['windowed', 'fullscreen'].includes(environment?.window?.mode)) {
    failures.push('environment.window.mode must be windowed or fullscreen');
  }
  if (environment?.window?.focused !== true || environment?.window?.visible !== true) {
    failures.push('environment.window must be focused and visible');
  }
  if (!positiveFinite(environment?.devicePixelRatio)) {
    failures.push('environment.devicePixelRatio must be a positive finite number');
  } else if (!approximately(environment.devicePixelRatio, 1)) {
    failures.push('acceptance environment.devicePixelRatio must be exactly 1');
  }
  requireStrings(environment?.quality, 'environment.quality', ['preset']);
  if (!positiveFinite(environment?.quality?.renderScale)) {
    failures.push('environment.quality.renderScale must be a positive finite number');
  }
  if (environment?.quality?.preset !== 'high'
    || !approximately(environment?.quality?.renderScale, 1)) {
    failures.push('acceptance quality must be high at renderScale 1');
  }
  for (const key of ['shadows', 'ambientOcclusion', 'bloom']) {
    if (typeof environment?.quality?.[key] !== 'boolean') {
      failures.push(`environment.quality.${key} must be boolean`);
    } else if (environment.quality[key] !== true) {
      failures.push(`acceptance environment.quality.${key} must be true`);
    }
  }
  requireStrings(environment?.profile, 'environment.profile', [
    'name', 'saveFixture', 'cameraRoute', 'userDataDirectory',
    'userDataPolicy', 'coldRunProfileRoot', 'shaderCachePolicy', 'gpuCachePolicy',
    'processInstanceId', 'userDataProfileId',
  ]);
  if (!nonNegativeFinite(environment?.profile?.electronLaunchRequestedAtEpochMs)) {
    failures.push('environment.profile.electronLaunchRequestedAtEpochMs is required');
  }
  if (environment?.profile?.userDataPolicy !== 'isolated-fresh-per-cold-process') {
    failures.push(
      'environment.profile.userDataPolicy must be isolated-fresh-per-cold-process',
    );
  }
  if (!Number.isInteger(environment?.profile?.seed)) {
    failures.push('environment.profile.seed must be an integer');
  }
  failures.push(...goal24ToolManifestFailures(environment?.toolManifest).map(
    (failure) => `environment.toolManifest ${failure}`,
  ));
  const supportedToolIds = environment?.profile?.supportedToolIds;
  if (JSON.stringify(supportedToolIds) !== JSON.stringify(GOAL24_SUPPORTED_TOOL_IDS)) {
    failures.push(
      'environment.profile.supportedToolIds must exactly match the independently pinned shipping tool set/order',
    );
  }
  const instrumentation = environment?.instrumentation;
  if (instrumentation?.mode !== 'low-overhead' || instrumentation?.gradeEligible !== true) {
    failures.push('environment.instrumentation must be low-overhead and gradeEligible');
  }
  const expectedCadence = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.cadence;
  for (const [key, expected] of [
    ['displayCadenceSource', expectedCadence.display],
    ['renderCadenceSource', expectedCadence.render],
    ['runtimeClock', expectedCadence.runtimeClock],
    ['launcherClock', expectedCadence.launcherClock],
  ]) {
    if (instrumentation?.[key] !== expected) {
      failures.push(`environment.instrumentation.${key} must be ${expected}`);
    }
  }
  for (const key of ['tracing', 'overlay', 'video']) {
    if (instrumentation?.[key] !== false) {
      failures.push(`environment.instrumentation.${key} must be false for acceptance grading`);
    }
  }
  if (instrumentation?.gcBeforeResourceCheckpoint !== true) {
    failures.push('environment.instrumentation.gcBeforeResourceCheckpoint must be true');
  }
  const bridge = instrumentation?.clockBridge;
  if (!nonEmptyString(bridge?.source)
    || bridge?.domain !== 'unix-epoch-milliseconds'
    || !nonNegativeFinite(bridge?.captureStartedAtEpochMs)
    || !nonNegativeFinite(bridge?.rendererSampledAtEpochMs)
    || !nonNegativeFinite(bridge?.captureCompletedAtEpochMs)
    || bridge.rendererSampledAtEpochMs < bridge.captureStartedAtEpochMs
    || bridge.rendererSampledAtEpochMs > bridge.captureCompletedAtEpochMs
    || !nonNegativeFinite(bridge?.maximumUncertaintyMs)
    || Math.abs(
      bridge.maximumUncertaintyMs
        - (bridge.captureCompletedAtEpochMs - bridge.captureStartedAtEpochMs)
    ) > 0.001
    || bridge.maximumUncertaintyMs
      > LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.cadence.maximumClockBridgeUncertaintyMs) {
    failures.push(
      'environment.instrumentation.clockBridge must provide a bounded runner capture bracket containing the renderer sample',
    );
  }
  return failures;
}

const GOAL24_NAV_PERFORMANCE_SOURCE =
  'shipping-clubhouse-makeNav-and-navFresh-monotonic-counters';

export function goal24NpcNavEvidenceFailures(event) {
  const discriminator = event?.discriminator || {};
  const before = discriminator.navPerformanceBefore;
  const after = discriminator.navPerformanceAfter;
  const atObservation = discriminator.navPerformanceAtObservation;
  const delta = discriminator.navPerformanceDelta;
  const routeObserved = discriminator.routeObserved;
  const route = routeObserved?.route;
  const routeAfter = route?.navPerformanceAtResolution;
  const failures = [];
  const fail = (message) => failures.push(message);
  const validSnapshotBase = (snapshot, label) => {
    if (!snapshot || snapshot.schemaVersion !== 1
      || snapshot.source !== GOAL24_NAV_PERFORMANCE_SOURCE) {
      fail(`${label} must come from the shipping navPerformanceDiagnostics snapshot`);
      return false;
    }
    if (!nonNegativeFinite(snapshot.navCreateStartedAtMs)
      || !nonNegativeFinite(snapshot.capturedAtMs)
      || !nonNegativeFinite(snapshot.navCreatedAtMs)
      || !nonNegativeFinite(snapshot.navCreateDurationMs)
      || snapshot.navCreatedAtMs < snapshot.navCreateStartedAtMs
      || Math.abs(
        (snapshot.navCreatedAtMs - snapshot.navCreateStartedAtMs)
          - snapshot.navCreateDurationMs
      ) > 0.001
      || !Number.isInteger(snapshot.navFreshCallCount) || snapshot.navFreshCallCount < 0
      || !Number.isInteger(snapshot.navRebuildCount) || snapshot.navRebuildCount < 0
      || !nonNegativeFinite(snapshot.navRebuildTotalDurationMs)
      || !nonNegativeFinite(snapshot.navRebuildMaximumDurationMs)
      || !Number.isInteger(snapshot.colliderVersion)
      || !Number.isInteger(snapshot.builtColliderVersion)) {
      fail(`${label} contains invalid shipping navigation counters or timings`);
      return false;
    }
    if (snapshot.capturedAtMs < snapshot.navCreatedAtMs
      || snapshot.navFreshCallCount < snapshot.navRebuildCount
      || snapshot.navRebuildTotalDurationMs < snapshot.navRebuildMaximumDurationMs
      || (snapshot.navRebuildCount === 0 && (
        snapshot.navRebuildTotalDurationMs !== 0
        || snapshot.navRebuildMaximumDurationMs !== 0
        || snapshot.navLastRebuildDurationMs !== null
        || snapshot.navLastRebuildAtMs !== null
      ))
      || (snapshot.navRebuildCount > 0 && (
        !nonNegativeFinite(snapshot.navLastRebuildDurationMs)
        || !nonNegativeFinite(snapshot.navLastRebuildAtMs)
        || snapshot.navRebuildMaximumDurationMs < snapshot.navLastRebuildDurationMs
        || snapshot.navLastRebuildAtMs > snapshot.capturedAtMs
      ))) {
      fail(`${label} contains internally inconsistent shipping navigation evidence`);
      return false;
    }
    if (snapshot.navRebuildCount === 1 && (
      Math.abs(snapshot.navRebuildTotalDurationMs - snapshot.navLastRebuildDurationMs) > 0.001
      || Math.abs(
        snapshot.navRebuildMaximumDurationMs - snapshot.navLastRebuildDurationMs
      ) > 0.001
    )) {
      fail(`${label}: one shipping rebuild must have equal total, maximum, and last durations`);
      return false;
    }
    return true;
  };
  const beforeBaseValid = validSnapshotBase(before, 'navPerformanceBefore');
  const afterBaseValid = validSnapshotBase(after, 'navPerformanceAfter');
  const observationBaseValid = validSnapshotBase(
    atObservation,
    'navPerformanceAtObservation',
  );
  if (!isDeepStrictEqual(routeAfter, after)) {
    fail('navPerformanceAfter must be the snapshot owned by the exact resolved production route');
  }
  if (!isDeepStrictEqual(routeObserved?.navPerformance, atObservation)) {
    fail('navPerformanceAtObservation must exactly retain the later production diagnostic poll');
  }
  if (afterBaseValid && (
    after.routeRequestId !== discriminator.routeRequestId
    || after.routeRequestId !== route?.requestId
    || after.customerId !== discriminator.customerId
    || after.customerId !== route?.customerId
    || after.customerId !== routeObserved?.customerId
    || after.lifecycleBoundaryId !== discriminator.lifecycleBoundaryId
    || after.lifecycleBoundaryId !== route?.lifecycleBoundaryId
    || after.capturedAtMs !== discriminator.routeResolvedAtMs
    || after.capturedAtMs !== route?.resolvedAtMs
  )) {
    fail('exact route snapshot must own matching request, customer, lifecycle, and resolution identities');
  }
  if (beforeBaseValid && (before.navFreshCallCount !== 0 || before.navRebuildCount !== 0
    || before.builtColliderVersion === before.colliderVersion
    || before.navRebuildTotalDurationMs !== 0 || before.navRebuildMaximumDurationMs !== 0
    || before.navLastRebuildDurationMs !== null || before.navLastRebuildAtMs !== null)) {
    fail('first organic route must begin before any navFresh call or collider-grid prewarm');
  }
  if (beforeBaseValid && (
    before.capturedAtMs > discriminator.lifecycleWindowStartedAtMs
    || before.capturedAtMs > discriminator.routeRequestedAtMs
    || before.capturedAtMs > after?.capturedAtMs
  )) {
    fail('navPerformanceBefore must be captured before the organic lifecycle and exact route');
  }
  if (afterBaseValid && (!nonNegativeFinite(after.navLastRebuildDurationMs)
    || !nonNegativeFinite(after.navLastRebuildAtMs))) {
    fail('navPerformanceAfter requires finite first-rebuild duration and timestamp evidence');
  }
  if (beforeBaseValid && afterBaseValid) {
    if (after.navFreshCallCount !== before.navFreshCallCount + 1
      || after.navRebuildCount !== before.navRebuildCount + 1
      || after.builtColliderVersion !== after.colliderVersion
      || after.colliderVersion !== before.colliderVersion) {
      fail('first organic route must perform exactly one shipping navFresh call and one collider-grid rebuild');
    }
    if (after.navCreateStartedAtMs !== before.navCreateStartedAtMs
      || after.navCreatedAtMs !== before.navCreatedAtMs
      || Math.abs(after.navCreateDurationMs - before.navCreateDurationMs) > 0.001) {
      fail('before/after snapshots must identify the same shipping navigation grid creation');
    }
  }
  if (afterBaseValid && observationBaseValid && (
    atObservation.capturedAtMs < after.capturedAtMs
    || atObservation.capturedAtMs > routeObserved?.atMs
    || atObservation.navCreateStartedAtMs !== after.navCreateStartedAtMs
    || atObservation.navCreatedAtMs !== after.navCreatedAtMs
    || Math.abs(atObservation.navCreateDurationMs - after.navCreateDurationMs) > 0.001
    || atObservation.navFreshCallCount < after.navFreshCallCount
    || atObservation.navRebuildCount < after.navRebuildCount
    || atObservation.navRebuildTotalDurationMs < after.navRebuildTotalDurationMs
    || atObservation.navRebuildMaximumDurationMs < after.navRebuildMaximumDurationMs
    || atObservation.navLastRebuildAtMs < after.navLastRebuildAtMs
  )) {
    fail('later production navigation poll must monotonically follow the exact route snapshot');
  }
  if (afterBaseValid && observationBaseValid
    && atObservation.navRebuildCount === after.navRebuildCount
    && (Math.abs(
      atObservation.navRebuildTotalDurationMs - after.navRebuildTotalDurationMs
    ) > 0.001
      || Math.abs(
        atObservation.navRebuildMaximumDurationMs - after.navRebuildMaximumDurationMs
      ) > 0.001
      || atObservation.navLastRebuildDurationMs !== after.navLastRebuildDurationMs
      || atObservation.navLastRebuildAtMs !== after.navLastRebuildAtMs
      || atObservation.builtColliderVersion !== after.builtColliderVersion)) {
    fail('later poll without another rebuild must retain exact rebuild timing and version evidence');
  }
  if (discriminator.sceneLoaded !== true
    || !nonNegativeFinite(discriminator.sceneLoadedAtMs)
    || !nonNegativeFinite(discriminator.navCreateDurationMs)
    || discriminator.sceneLoadedAtMs !== before?.navCreatedAtMs
    || Math.abs(discriminator.navCreateDurationMs - Number(before?.navCreateDurationMs)) > 0.001
    || discriminator.sceneLoadedAtMs > discriminator.lifecycleWindowStartedAtMs) {
    fail('scene-loaded evidence must be sourced from makeNav before the organic lifecycle edge');
  }
  const durationDelta = Number(after?.navRebuildTotalDurationMs)
    - Number(before?.navRebuildTotalDurationMs);
  if (!delta || delta.navFreshCallCount !== 1 || delta.navRebuildCount !== 1
    || !nonNegativeFinite(delta.navRebuildTotalDurationMs)
    || Math.abs(delta.navRebuildTotalDurationMs - durationDelta) > 0.001) {
    fail('navPerformanceDelta must exactly bind the one-call/one-rebuild before/after change');
  }
  if (afterBaseValid && (!nonNegativeFinite(discriminator.routeRequestedAtMs)
    || !nonNegativeFinite(discriminator.routeResolvedAtMs)
    || after.navLastRebuildAtMs < discriminator.routeRequestedAtMs
    || after.navLastRebuildAtMs > discriminator.routeResolvedAtMs
    || after.navRebuildMaximumDurationMs < after.navLastRebuildDurationMs
    || after.navRebuildTotalDurationMs < after.navLastRebuildDurationMs)) {
    fail('first nav rebuild timing must be finite and ordered inside the same route request');
  }
  return failures;
}

function validateScenarioDiscriminator(scenarioId, event, index, failures) {
  const discriminator = event.discriminator;
  const fail = (message) => failures.push(`${scenarioId}: event ${index + 1} ${message}`);
  const requireTrue = (...keys) => {
    for (const key of keys) if (discriminator[key] !== true) fail(`${key} must be true`);
  };
  const requireString = (...keys) => {
    for (const key of keys) if (!nonEmptyString(discriminator[key])) fail(`${key} is required`);
  };
  switch (scenarioId) {
    case 'coldLaunch':
      requireString(
        'processInstanceId', 'userDataProfileId', 'userDataDirectory',
        'shaderCachePolicy', 'gpuCachePolicy',
      );
      requireTrue('freshProcess', 'mainMenuInteractive');
      break;
    case 'startToControllable':
      requireString('processInstanceId', 'menuControl');
      requireTrue(
        'controlActivated', 'gameplayControllable', 'movementProbeAccepted',
        'instrumentationReadyBeforeControl', 'firstControllableDisplayBoundaryObserved',
        'firstControllableRenderObserved',
      );
      if (!nonNegativeFinite(discriminator.instrumentationReadyAtMs)
        || !nonNegativeFinite(discriminator.renderInstrumentationAttachedAtMs)
        || !nonNegativeFinite(discriminator.firstControllableDisplayBoundaryAtMs)
        || !positiveFinite(discriminator.firstControllableRenderAtMs)
        || discriminator.instrumentationReadyAtMs > event.markers.start.atMs
        || discriminator.firstControllableDisplayBoundaryAtMs < event.markers.start.atMs
        || discriminator.firstControllableRenderAtMs < event.markers.start.atMs
        || discriminator.renderInstrumentationAttachedAtMs
          > discriminator.firstControllableRenderAtMs
        || discriminator.firstControllableRenderAtMs
          > discriminator.firstControllableDisplayBoundaryAtMs
        || discriminator.firstControllableDisplayBoundaryAtMs > event.markers.end.atMs
        || discriminator.firstControllableRenderAtMs > event.markers.end.atMs) {
        fail('instrumentation-ready and independently observed display/render boundary timestamps are invalid');
      }
      break;
    case 'doorApproach':
      requireString('doorId', 'processInstanceId');
      if (discriminator.startZone !== 'outside' || discriminator.endZone !== 'outside') {
        fail('must remain outside through the approach threshold');
      }
      if (!finite(discriminator.startDistanceYards) || discriminator.startDistanceYards < 3) {
        fail('startDistanceYards must be at least 3');
      }
      requireTrue('thresholdCrossed');
      if (discriminator.freshProcess !== (event.temperature === 'cold')) {
        fail('freshProcess must distinguish cold fresh-process and warmed approaches');
      }
      break;
    case 'doorFirstOpen':
      requireString(
        'doorId', 'processInstanceId', 'focusTargetDoorId', 'interactKey',
        'productionDoorSignal',
      );
      requireTrue(
        'freshProcess', 'desiredStateApplied', 'opened', 'openSwingObserved',
      );
      if (discriminator.focusTargetDoorId !== discriminator.doorId) {
        fail('focusTargetDoorId must identify the production door being opened');
      }
      if (discriminator.desiredState !== 'open') {
        fail('desiredState must be open');
      }
      if (!finite(discriminator.openSwingRadians) || discriminator.openSwingRadians < 0.2) {
        fail('openSwingRadians must prove a visible production swing of at least 0.2 radians');
      }
      if (!nonNegativeFinite(discriminator.productionDoorSignalAtMs)
        || discriminator.productionDoorSignalAtMs < event.markers.start.atMs
        || discriminator.productionDoorSignalAtMs > event.markers.end.atMs) {
        fail('productionDoorSignalAtMs must be ordered inside the first-open markers');
      }
      break;
    case 'doorCrossingOutsideToInside': {
      requireString('doorId', 'processInstanceId', 'productionVisibilityMarker');
      if (discriminator.fromZone !== 'outside' || discriminator.toZone !== 'inside') {
        fail('fromZone/toZone do not prove the required crossing direction');
      }
      requireTrue('boundaryCrossed', 'normalMovement', 'interiorVisibilityObserved');
      const cold = event.temperature === 'cold';
      if (discriminator.freshProcess !== cold
        || discriminator.noPriorInteriorThresholdCrossing !== cold) {
        fail('freshProcess and noPriorInteriorThresholdCrossing must identify only cold first crossings');
      }
      const detailTransition = discriminator.detailVisibilityTransition;
      if (discriminator.productionVisibilityMarker
          !== 'assets51to100-detail-visibility-false-to-true'
        || !nonNegativeFinite(discriminator.productionVisibilityAtMs)
        || discriminator.productionVisibilityAtMs < event.markers.start.atMs
        || discriminator.productionVisibilityAtMs > event.markers.end.atMs
        || detailTransition?.from !== false
        || detailTransition?.to !== true
        || detailTransition?.atMs !== discriminator.productionVisibilityAtMs
        || discriminator.detailVisibilitySequenceDelta !== 1) {
        fail('production visibility evidence must prove the exact false-to-true detail transition inside the crossing markers');
      }
      break;
    }
    case 'doorCrossingInsideToOutside': {
      requireString('doorId');
      if (discriminator.fromZone !== 'inside' || discriminator.toZone !== 'outside') {
        fail('fromZone/toZone do not prove the required crossing direction');
      }
      requireTrue('boundaryCrossed', 'normalMovement');
      break;
    }
    case 'ledgerOpen':
      if (discriminator.fromState !== 'closed' || discriminator.toState !== 'open') {
        fail('must prove closed-to-open state');
      }
      requireTrue('readable', 'ledgerOwnsInput');
      requireString('entryKey', 'interactKey');
      if (String(discriminator.entryKey).toLowerCase()
        === String(discriminator.interactKey).toLowerCase()) {
        fail('entryKey and interactKey must identify two distinct controls');
      }
      if (discriminator.firstOpen !== (event.temperature === 'cold')) {
        fail('firstOpen must distinguish the cold first open from warmed opens');
      }
      break;
    case 'ledgerPageTurns10':
    case 'ledgerTurns50Stress':
      if (!['left', 'right'].includes(discriminator.direction)) {
        fail('direction must be left or right');
      }
      if (!Number.isInteger(discriminator.fromPage) || !Number.isInteger(discriminator.toPage)
        || discriminator.fromPage === discriminator.toPage) {
        fail('fromPage/toPage must be distinct integers');
      }
      requireTrue('bookAlreadyOpen', 'contentReady');
      break;
    case 'ledgerClose':
      if (discriminator.fromState !== 'open' || discriminator.toState !== 'walking') {
        fail('must prove open-to-walking state');
      }
      requireTrue('walkControlRestored');
      break;
    case 'toolFirstUseByTool':
      requireString(
        'toolId', 'processInstanceId', 'fromTool', 'toTool', 'equipKey',
        'productionEquipSignal',
      );
      requireTrue(
        'changed', 'viewmodelReady', 'firstUse', 'heldToolVisible',
        'equipAnimationSettled',
      );
      if (!Array.isArray(discriminator.supportedToolIds)
        || discriminator.toolId !== discriminator.toTool
        || !Number.isInteger(discriminator.productionEquipSequenceBase)
        || discriminator.productionEquipSequenceBase < 0
        || !Number.isInteger(discriminator.productionEquipSequence)
        || discriminator.productionEquipSequence < 1
        || !nonNegativeFinite(discriminator.productionEquipAtMs)
        || discriminator.productionEquipAtMs < event.markers.start.atMs
        || discriminator.productionEquipAtMs > event.markers.end.atMs) {
        fail('requires an exact supported tool ID and ordered production equip edge');
      }
      break;
    case 'toolChanges20':
    case 'toolSwitches100Stress':
      requireString(
        'processInstanceId', 'fromTool', 'toTool', 'equipKey', 'productionEquipSignal',
      );
      if (discriminator.fromTool === discriminator.toTool) {
        fail('fromTool and toTool must differ');
      }
      requireTrue('changed', 'viewmodelReady');
      if (discriminator.firstUse !== false) {
        fail('warmed switches must all be firstUse=false events');
      }
      if (!Number.isInteger(discriminator.productionEquipSequence)
        || discriminator.productionEquipSequence < 1
        || !nonNegativeFinite(discriminator.productionEquipAtMs)
        || discriminator.productionEquipAtMs < event.markers.start.atMs
        || discriminator.productionEquipAtMs > event.markers.end.atMs) {
        fail('requires an ordered production equip edge inside the measured window');
      }
      break;
    case 'npcNavActivation':
      requireString('routeRequestId');
      requireTrue('customerActivated', 'routeRequested', 'routeResolved');
      if (!nonNegativeFinite(discriminator.lifecycleWindowStartedAtMs)
        || !nonNegativeFinite(discriminator.routeRequestedAtMs)
        || !positiveFinite(discriminator.routeResolvedAtMs)
        || discriminator.routeRequestedAtMs < discriminator.lifecycleWindowStartedAtMs
        || discriminator.routeResolvedAtMs < discriminator.routeRequestedAtMs
        || discriminator.lifecycleWindowStartedAtMs < event.markers.start.atMs
        || discriminator.routeResolvedAtMs > event.markers.end.atMs) {
        fail('scene load and first route timestamps must be finite and ordered');
      }
      for (const message of goal24NpcNavEvidenceFailures(event)) fail(message);
      break;
    default:
      fail('uses an unknown scenario discriminator');
  }
}

function scenarioInteractionFailures(spec, scenario, summary) {
  const failures = [];
  const events = scenario.events;
  if (spec.eventCount.exact != null && events.length !== spec.eventCount.exact) {
    failures.push(`${spec.id}: requires exactly ${spec.eventCount.exact} events`);
  }
  if (spec.eventCount.minimum != null && events.length < spec.eventCount.minimum) {
    failures.push(`${spec.id}: requires at least ${spec.eventCount.minimum} events`);
  }
  const coldCount = summary.cold?.eventCount || 0;
  const warmCount = summary.warm?.eventCount || 0;
  if (coldCount < spec.temperature.minimumCold || warmCount < spec.temperature.minimumWarm) {
    failures.push(
      `${spec.id}: requires at least ${spec.temperature.minimumCold} cold and `
      + `${spec.temperature.minimumWarm} warm events`,
    );
  }
  if (spec.temperature.policy === 'cold-only' && warmCount !== 0) {
    failures.push(`${spec.id}: all events must be cold`);
  }
  if (spec.temperature.policy === 'warm-only' && coldCount !== 0) {
    failures.push(`${spec.id}: all events must be warm`);
  }
  if (spec.temperature.policy === 'cold-then-warm'
    && (events[0]?.temperature !== 'cold'
      || events.slice(1).some((event) => event.temperature !== 'warm'))) {
    failures.push(`${spec.id}: first event must be cold and every later event warm`);
  }
  if (spec.temperature.policy === 'cold-block-then-warm') {
    const firstWarm = events.findIndex((event) => event.temperature === 'warm');
    if (firstWarm < spec.temperature.minimumCold
      || events.slice(0, firstWarm).some((event) => event.temperature !== 'cold')
      || events.slice(firstWarm).some((event) => event.temperature !== 'warm')) {
      failures.push(
        `${spec.id}: at least ${spec.temperature.minimumCold} cold events must precede `
        + 'a separate contiguous warm block',
      );
    }
  }
  events.forEach((event, index) => {
    if (event.scenarioId !== spec.id) {
      failures.push(`${spec.id}: event ${index + 1} scenarioId must be ${spec.id}`);
    }
    if (event.input?.evidencePolicy !== spec.triggerEvidencePolicy) {
      failures.push(
        `${spec.id}: event ${index + 1} input.evidencePolicy must be ${spec.triggerEvidencePolicy}`,
      );
    }
    if (event.markers.start.name !== spec.markerNames[0]
      || event.markers.end.name !== spec.markerNames[1]) {
      failures.push(
        `${spec.id}: event ${index + 1} markers must be ${spec.markerNames.join(' -> ')}`,
      );
    }
    if (event.markers.start.clock !== spec.markerClock) {
      failures.push(`${spec.id}: event ${index + 1} markers must use ${spec.markerClock} clock`);
    }
    const expectedCadenceStatus = spec.cadencePolicy === 'duration-only-before-page-context'
      ? 'unavailable'
      : 'measured';
    for (const cadenceKey of ['display', 'render']) {
      if (event.cadenceAvailability[cadenceKey].status !== expectedCadenceStatus) {
        failures.push(
          `${spec.id}: event ${index + 1} ${cadenceKey} cadence must be `
          + `${expectedCadenceStatus} for ${spec.cadencePolicy}`,
        );
      }
    }
    for (const key of spec.discriminatorKeys) {
      if (event.discriminator[key] == null) {
        failures.push(`${spec.id}: event ${index + 1} discriminator.${key} is required`);
      }
    }
    if (GOAL24_DOOR_SCENARIOS.includes(spec.id)) {
      try {
        validateGoal24DoorRouteSignature(
          event.discriminator?.routeSignature,
          `${spec.id}: event ${index + 1}`,
        );
        validateGoal24DoorwayRenderEvidenceStructure(
          event.doorwayRenderEvidence,
          `${spec.id}: event ${index + 1}`,
        );
      } catch (error) {
        failures.push(`${spec.id}: event ${index + 1} ${error?.message || error}`);
      }
    }
    validateScenarioDiscriminator(spec.id, event, index, failures);
  });
  if (spec.id === 'ledgerPageTurns10' || spec.id === 'ledgerTurns50Stress') {
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].discriminator.direction === events[index - 1].discriminator.direction) {
        failures.push(`${spec.id}: page directions must alternate at event ${index + 1}`);
      }
    }
  }
  return failures;
}

function coldProcessLinkFailures(scenarios, environment) {
  const failures = [];
  const eventsFor = (id) => (
    scenarios.find((scenario) => scenario?.id === id)?.events || []
  );
  const launches = eventsFor('coldLaunch').filter((event) => event?.temperature === 'cold');
  const starts = eventsFor('startToControllable').filter((event) => event?.temperature === 'cold');
  const approaches = eventsFor('doorApproach').filter((event) => event?.temperature === 'cold');
  const firstOpens = eventsFor('doorFirstOpen').filter((event) => event?.temperature === 'cold');
  const firstCrossings = eventsFor('doorCrossingOutsideToInside')
    .filter((event) => event?.temperature === 'cold');
  const launchIds = launches.map((event) => event.discriminator?.processInstanceId);
  const startIds = starts.map((event) => event.discriminator?.processInstanceId);
  const approachIds = approaches.map((event) => event.discriminator?.processInstanceId);
  const firstOpenIds = firstOpens.map((event) => event.discriminator?.processInstanceId);
  const firstCrossingIds = firstCrossings.map((event) => event.discriminator?.processInstanceId);
  if (new Set(launchIds).size !== launchIds.length
    || new Set(launches.map((event) => event.discriminator?.userDataProfileId)).size
      !== launches.length
    || new Set(launches.map((event) => event.discriminator?.userDataDirectory)).size
      !== launches.length) {
    failures.push(
      'coldLaunch requires distinct fresh process IDs, profile IDs, and user-data directories',
    );
  }
  if (JSON.stringify(startIds) !== JSON.stringify(launchIds)
    || JSON.stringify(approachIds) !== JSON.stringify(launchIds)
    || JSON.stringify(firstOpenIds) !== JSON.stringify(launchIds)
    || JSON.stringify(firstCrossingIds) !== JSON.stringify(launchIds)) {
    failures.push(
      'cold launch, start-to-controllable, door approach, first open, and first interior crossing must link '
      + 'the same fresh process IDs in the same order',
    );
  }
  for (let index = 0; index < launchIds.length; index += 1) {
    const approach = approaches[index];
    const firstOpen = firstOpens[index];
    const firstCrossing = firstCrossings[index];
    if (approach?.markers?.end?.clock !== 'renderer'
      || firstOpen?.markers?.start?.clock !== 'renderer'
      || firstCrossing?.markers?.start?.clock !== 'renderer'
      || !finite(approach?.markers?.end?.atMs)
      || approach.markers.end.atMs > firstOpen?.markers?.start?.atMs
      || !finite(firstOpen?.markers?.end?.atMs)
      || firstOpen.markers.end.atMs > firstCrossing?.markers?.start?.atMs) {
      failures.push(
        `cold process ${launchIds[index] ?? index + 1} must order door approach, first open, then first interior crossing`,
      );
    }
  }
  for (const event of launches) {
    if (event.discriminator?.shaderCachePolicy !== environment?.profile?.shaderCachePolicy
      || event.discriminator?.gpuCachePolicy !== environment?.profile?.gpuCachePolicy) {
      failures.push('cold launch shader/GPU cache policy must match the pinned profile metadata');
      break;
    }
  }
  return failures;
}

function toolFirstUseFailures(scenarios, environment) {
  const failures = [];
  const supportedToolIds = GOAL24_SUPPORTED_TOOL_IDS;
  const scenarioFor = (id) => scenarios.find((scenario) => scenario?.id === id);
  const firstUses = scenarioFor('toolFirstUseByTool')?.events || [];
  failures.push(...goal24ToolChainFailures(firstUses));
  firstUses.forEach((event, index) => {
    if (event?.discriminator?.processInstanceId !== environment?.profile?.processInstanceId) {
      failures.push(
        `toolFirstUseByTool: event ${index + 1} must link the acceptance process instance`,
      );
    }
  });
  const firstUseByTool = new Map(firstUses.map((event) => [
    event?.discriminator?.toolId,
    event,
  ]));
  const lastFirstUse = firstUses.at(-1);
  const warmedEvents = ['toolChanges20', 'toolSwitches100Stress']
    .flatMap((scenarioId) => scenarioFor(scenarioId)?.events || []);
  failures.push(...goal24WarmedToolCycleFailures(warmedEvents, {
    initialTool: supportedToolIds.at(-1),
    initialProductionEquipSequence: lastFirstUse?.discriminator?.productionEquipSequence,
  }));
  let priorEvent = lastFirstUse;
  for (const scenarioId of ['toolChanges20', 'toolSwitches100Stress']) {
    const events = scenarioFor(scenarioId)?.events || [];
    events.forEach((event, index) => {
      const toTool = event?.discriminator?.toTool;
      if (toTool !== 'empty-hands' && !supportedToolIds.includes(toTool)) {
        failures.push(
          `${scenarioId}: event ${index + 1} cannot be warm before its toTool has exact first-use evidence; the stop is not canonical`,
        );
      }
      const firstUse = toTool === 'empty-hands' ? lastFirstUse : firstUseByTool.get(toTool);
      if (event?.discriminator?.processInstanceId !== environment?.profile?.processInstanceId
        || firstUse?.markers?.end?.clock !== event?.markers?.start?.clock
        || !finite(firstUse?.markers?.end?.atMs)
        || firstUse.markers.end.atMs > event?.markers?.start?.atMs) {
        failures.push(
          `${scenarioId}: event ${index + 1} must occur in the same process after its tool's first-use evidence`,
        );
      }
      if (event?.discriminator?.firstUse !== false) {
        failures.push(`${scenarioId}: event ${index + 1} cannot be mislabeled as a warm first use`);
      }
      if (event?.discriminator?.equipKey !== firstUses[0]?.discriminator?.equipKey) {
        failures.push(`${scenarioId}: event ${index + 1} must use the pinned first-use tool-belt binding`);
      }
      if (priorEvent?.markers?.end?.clock !== event?.markers?.start?.clock
        || !finite(priorEvent?.markers?.end?.atMs)
        || priorEvent.markers.end.atMs > event?.markers?.start?.atMs) {
        failures.push(
          `${scenarioId}: event ${index + 1} must follow the prior production belt event in order`,
        );
      }
      priorEvent = event;
    });
  }
  return failures;
}

function linearSlope(samples, key) {
  const xs = samples.map((sample) => sample.iteration);
  const ys = samples.map((sample) => sample.metrics[key]);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const denominator = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  if (denominator === 0) return 0;
  return ys.reduce(
    (sum, value, index) => sum + (xs[index] - meanX) * (value - meanY),
    0,
  ) / denominator;
}

function validateResourceMetricProvenance(metricSources) {
  for (const key of RESOURCE_METRICS) {
    const provenance = metricSources?.[key];
    if (!nonEmptyString(provenance?.source)
      || provenance?.unit !== RESOURCE_METRIC_UNITS[key]) {
      throw new TypeError(
        `resource ${key} requires a source and unit ${RESOURCE_METRIC_UNITS[key]}`,
      );
    }
    if (key === 'estimatedTextureBytes'
      && (provenance.estimated !== true || !nonEmptyString(provenance.limitations))) {
      throw new TypeError(
        'resource estimatedTextureBytes must be marked estimated with explicit limitations',
      );
    }
    if (key === 'activeEventListenerCount' && provenance.complete !== true) {
      throw new TypeError('resource activeEventListenerCount requires a complete census');
    }
    if ((key === 'drawCallCount' || key === 'renderedTriangleCount')
      && (provenance.statistic
          !== (key === 'drawCallCount'
            ? 'peak-non-shadow-draw-calls'
            : 'peak-non-shadow-rendered-triangles')
        || provenance.stratification
          !== 'scene3d.post.stats().shadowBakes monotonic production counter')) {
      throw new TypeError(
        `resource ${key} requires the locked like-for-like non-shadow composed-frame statistic`,
      );
    }
    if ((key === 'renderCallbackCount' || key === 'renderLoopCount')
      && (provenance.invariant !== true || provenance.invariantHolds !== true
        || provenance.duplicateProgressionObserved !== false
        || !positiveFinite(provenance.baselineInternalRendererInvocations)
        || provenance.absoluteProductionSchedulerProof !== true
        || provenance.ownerToken
          !== LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.productionFrameLoopOwnerToken
        || provenance.rootStartCount !== 1
        || provenance.pendingCallbackCount !== 1
        || provenance.maximumPendingCallbackCount !== 1
        || provenance.schedulerAccountingConsistent !== true)) {
      throw new TypeError(
        `resource ${key} requires a positively proven production render-loop invariant`,
      );
    }
  }
  return true;
}

function validatedResourceCheckpoint(sample, index, owner) {
  if (!sample || typeof sample !== 'object'
    || !isDeepStrictEqual(Object.keys(sample).sort(), ['elapsedMs', 'iteration', 'snapshot'])) {
    throw new TypeError(
      `${owner} resource checkpoint ${index + 1} must retain exactly iteration, elapsedMs, and the full snapshot`,
    );
  }
  try {
    validateGoal24ResourceSnapshot(sample.snapshot);
  } catch (error) {
    throw new TypeError(
      `${owner} resource checkpoint ${index + 1} failed raw snapshot validation: ${error.message}`,
      { cause: error },
    );
  }
  if (sample.snapshot.schemaVersion
      !== LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.resourceDiagnosticsSchemaVersion) {
    throw new TypeError(`${owner} resource checkpoint ${index + 1} has the wrong snapshot schema`);
  }
  if (sample.snapshot.capturedOutsideTimedInteraction !== true
    || sample.snapshot.gcCompleted !== true) {
    throw new TypeError(
      `${owner} resource checkpoint ${index + 1} must be post-GC and outside timed interactions`,
    );
  }
  return {
    iteration: sample.iteration,
    elapsedMs: sample.elapsedMs,
    metrics: sample.snapshot.metrics,
    metricSources: sample.snapshot.metricSources,
    label: sample.snapshot.label,
    workloadContext: sample.snapshot.diagnostics?.workloadContext,
  };
}

function validateResourceCheckpointSequence(samples, owner) {
  samples.forEach((sample, index) => {
    if (!Number.isInteger(sample?.iteration) || sample.iteration < 0
      || (index > 0 && sample.iteration <= samples[index - 1].iteration)) {
      throw new TypeError(`${owner} resource checkpoint ${index + 1} has invalid iteration order`);
    }
    if (!nonNegativeFinite(sample.elapsedMs)
      || (index > 0 && sample.elapsedMs <= samples[index - 1].elapsedMs)) {
      throw new TypeError(`${owner} resource checkpoint ${index + 1} has invalid elapsedMs order`);
    }
    for (const key of RESOURCE_METRICS) {
      const value = sample.metrics?.[key];
      const mustBePositive = key === 'jsHeapUsedBytes' || key === 'estimatedTextureBytes';
      if (!(mustBePositive ? positiveFinite(value) : nonNegativeFinite(value))
        || (key !== 'jsHeapUsedBytes' && !Number.isInteger(value))) {
        throw new TypeError(`${owner} resource checkpoint ${index + 1} has invalid ${key}`);
      }
    }
    const expectedObservedFrames = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress
      .observedComposedFrameCount.exact;
    if (sample.metrics.observedComposedFrameCount !== expectedObservedFrames) {
      throw new TypeError(
        `${owner} resource checkpoint ${index + 1} must observe exactly ${expectedObservedFrames} composed frames`,
      );
    }
    if (sample.metrics.shadowBakeFrameCount !== sample.metrics.shadowBakeCount) {
      throw new TypeError(
        `${owner} resource checkpoint ${index + 1} shadow frame/count evidence must be equal`,
      );
    }
  });
}

function summarizeResourceMetrics(samples, iterations) {
  return Object.fromEntries(RESOURCE_METRICS.map((key) => {
    const values = samples.map((sample) => sample.metrics[key]);
    const start = values[0];
    const end = values.at(-1);
    const slopePerIteration = linearSlope(samples, key);
    const persistent = PERSISTENT_RESOURCE_METRICS.includes(key);
    const noise = key === 'jsHeapUsedBytes'
      ? LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.sustainedGrowthNoise.jsHeapUsedBytes
      : key === 'estimatedTextureBytes'
        ? LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.sustainedGrowthNoise.estimatedTextureBytes
        : LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.sustainedGrowthNoise.countMetrics;
    const firstHalf = values.slice(0, Math.ceil(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    const firstHalfMedian = median(firstHalf);
    const secondHalfMedian = median(secondHalf);
    const sustainedGrowth = persistent
      && end - start > noise
      && secondHalfMedian - firstHalfMedian > noise
      && slopePerIteration > noise / Math.max(1, iterations);
    return [key, {
      start,
      end,
      delta: end - start,
      minimum: Math.min(...values),
      maximum: Math.max(...values),
      slopePerIteration: round(slopePerIteration, 6),
      persistent,
      growthNoise: noise,
      firstHalfMedian,
      secondHalfMedian,
      sustainedGrowth,
      continuousGrowth: sustainedGrowth,
    }];
  }));
}

function resourceEndDeltaViolations(metrics) {
  const violations = [];
  for (const [key, maximum] of Object.entries(
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.maximumEndDelta,
  )) {
    if (metrics[key].delta > maximum) {
      violations.push({ metric: key, observedDelta: metrics[key].delta, maximum });
    }
  }
  const heap = metrics.jsHeapUsedBytes;
  const heapPolicy = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.jsHeapTolerance;
  const heapMaximum = Math.max(
    heapPolicy.minimumBytes,
    heap.start * heapPolicy.relativeFraction,
  );
  heap.allowedIncrease = heapMaximum;
  heap.tolerancePolicy = heapPolicy.policy;
  if (heap.delta > heapMaximum) {
    violations.push({
      metric: 'jsHeapUsedBytes',
      observedDelta: heap.delta,
      maximum: heapMaximum,
    });
  }
  return violations;
}

function summarizeStressResources(spec, resources) {
  const rawSamples = resources?.samples;
  if (!Array.isArray(rawSamples)
    || rawSamples.length < LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.minimumResourceCheckpoints) {
    throw new TypeError(
      `requires at least ${LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.minimumResourceCheckpoints} resource checkpoints`,
    );
  }
  const expectedRawSource = spec.id === 'ledgerTurns50Stress' ? 'ledgerStress' : 'toolStress';
  if (!isDeepStrictEqual(resources?.rawSource, { scenario: expectedRawSource })) {
    throw new TypeError(`${spec.id} resources require the exact raw checkpoint source`);
  }
  const samples = rawSamples.map((sample, index) => (
    validatedResourceCheckpoint(sample, index, spec.id)
  ));
  validateResourceCheckpointSequence(samples, spec.id);
  validateResourceMetricProvenance(samples[0].metricSources);
  samples.slice(1).forEach((sample, index) => {
    if (!isDeepStrictEqual(sample.metricSources, samples[0].metricSources)) {
      throw new TypeError(`${spec.id} resource checkpoint ${index + 2} provenance drifted`);
    }
  });
  if (samples[0].iteration !== 0 || samples.at(-1).iteration !== spec.stress.iterations) {
    throw new TypeError(
      `resource checkpoints must span iteration 0 through ${spec.stress.iterations}`,
    );
  }
  const metrics = summarizeResourceMetrics(samples, spec.stress.iterations);
  const limitViolations = [];
  for (const [key, limit] of Object.entries(
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.resourceLimits,
  )) {
    if (metrics[key].minimum < limit.minimum || metrics[key].maximum > limit.maximum) {
      limitViolations.push({
        metric: key,
        observedMinimum: metrics[key].minimum,
        observedMaximum: metrics[key].maximum,
        requiredMinimum: limit.minimum,
        requiredMaximum: limit.maximum,
      });
    }
  }
  const endDeltaViolations = resourceEndDeltaViolations(metrics);
  return {
    checkpointCount: samples.length,
    checkpoints: samples.map(({ iteration, elapsedMs, label, workloadContext, metrics: sampleMetrics }) => ({
      iteration,
      elapsedMs,
      label,
      workloadContext: JSON.parse(JSON.stringify(workloadContext)),
      metrics: JSON.parse(JSON.stringify(sampleMetrics)),
    })),
    provenance: cloneResourceProvenance(samples[0].metricSources),
    metrics,
    limitViolations,
    endDeltaViolations,
  };
}

function cloneResourceProvenance(metricSources) {
  return Object.fromEntries(RESOURCE_METRICS.map((key) => [
    key,
    JSON.parse(JSON.stringify(metricSources[key])),
  ]));
}

function summarizeRunResources(report) {
  const rawSamples = [report?.resourceBaseline, report?.resourceFinal];
  const samples = rawSamples.map((sample, index) => (
    validatedResourceCheckpoint(sample, index, 'run')
  ));
  validateResourceCheckpointSequence(samples, 'run');
  if (samples[0].iteration !== 0 || samples[0].elapsedMs !== 0
    || samples[0].label !== 'run-resource-baseline') {
    throw new TypeError('run resource baseline must be the exact iteration-zero checkpoint');
  }
  if (samples[1].iteration !== 1 || !(samples[1].elapsedMs > 0)
    || samples[1].label !== 'run-resource-final') {
    throw new TypeError('run resource final must be the exact positive-elapsed final checkpoint');
  }
  validateResourceMetricProvenance(samples[0].metricSources);
  if (!isDeepStrictEqual(samples[1].metricSources, samples[0].metricSources)) {
    throw new TypeError('run resource baseline/final provenance drifted');
  }
  const capturedAt = rawSamples.map(({ snapshot }) => Date.parse(snapshot.capturedAt));
  if (capturedAt.some((value) => !finite(value)) || capturedAt[1] <= capturedAt[0]) {
    throw new TypeError('run resource baseline/final capture timestamps must be ordered');
  }
  const metrics = summarizeResourceMetrics(samples, 1);
  const limitViolations = [];
  for (const [key, limit] of Object.entries(
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.resourceLimits,
  )) {
    if (metrics[key].minimum < limit.minimum || metrics[key].maximum > limit.maximum) {
      limitViolations.push({
        metric: key,
        observedMinimum: metrics[key].minimum,
        observedMaximum: metrics[key].maximum,
        requiredMinimum: limit.minimum,
        requiredMaximum: limit.maximum,
      });
    }
  }
  return {
    checkpointCount: samples.length,
    checkpoints: samples.map(({ iteration, elapsedMs, label, workloadContext, metrics: sampleMetrics }) => ({
      iteration,
      elapsedMs,
      label,
      workloadContext: JSON.parse(JSON.stringify(workloadContext)),
      metrics: JSON.parse(JSON.stringify(sampleMetrics)),
    })),
    provenance: cloneResourceProvenance(samples[0].metricSources),
    metrics,
    limitViolations,
  };
}

function evaluateNegativeControl(control) {
  const expected = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.negativeControl;
  const failures = [];
  if (control?.kind !== expected.kind) failures.push(`negativeControl.kind must be ${expected.kind}`);
  if (control?.injectedDurationMs !== expected.injectedDurationMs) {
    failures.push(`negativeControl.injectedDurationMs must be ${expected.injectedDurationMs}`);
  }
  if (control?.sameInstrumentation !== true) {
    failures.push('negativeControl.sameInstrumentation must be true');
  }
  const start = control?.markers?.start;
  const end = control?.markers?.end;
  if (start?.name !== 'busy-stall-begin' || end?.name !== 'busy-stall-end'
    || start?.clock !== 'renderer' || end?.clock !== 'renderer'
    || !nonNegativeFinite(start?.atMs) || !positiveFinite(end?.atMs)
    || end.atMs <= start.atMs) {
    failures.push('negativeControl requires exact ordered busy-stall renderer-clock markers');
  }
  if (!positiveFinite(control?.busyLoopElapsedMs)
    || control.busyLoopElapsedMs < expected.injectedDurationMs * expected.minimumElapsedRatio) {
    failures.push('negativeControl busy loop did not run for the required elapsed duration');
  }
  if (nonNegativeFinite(start?.atMs) && positiveFinite(end?.atMs)
    && positiveFinite(control?.busyLoopElapsedMs)
    && Math.abs((end.atMs - start.atMs) - control.busyLoopElapsedMs) > 1) {
    failures.push('negativeControl marker duration must match the measured busy-loop elapsed time');
  }
  let display = null;
  let render = null;
  try {
    display = timingDistribution(
      control?.displayFrameIntervalsMs,
      'negativeControl displayFrameIntervalsMs',
      true,
    );
    render = timingDistribution(
      control?.renderFrameIntervalsMs,
      'negativeControl renderFrameIntervalsMs',
      true,
    );
  } catch (error) {
    failures.push(`negativeControl: ${error.message}`);
  }
  const cadenceStraddlesStall = (entries, values, label) => {
    if (!Array.isArray(entries) || !Array.isArray(values) || entries.length !== values.length) {
      failures.push(`negativeControl ${label} cadence requires one interval-endpoint record per sample`);
      return false;
    }
    let detected = false;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!nonNegativeFinite(entry?.startAtMs) || !positiveFinite(entry?.endAtMs)
        || entry.endAtMs <= entry.startAtMs || !positiveFinite(entry?.durationMs)
        || Math.abs((entry.endAtMs - entry.startAtMs) - entry.durationMs) > 0.5
        || Math.abs(entry.durationMs - values[index]) > 0.5) {
        failures.push(`negativeControl ${label} cadence interval ${index + 1} is malformed`);
        continue;
      }
      if (entry.startAtMs <= start?.atMs && entry.endAtMs >= end?.atMs
        && entry.durationMs >= expected.minimumObservedFrameMs) {
        detected = true;
      }
    }
    return detected;
  };
  const displayDetected = cadenceStraddlesStall(
    control?.displayCadenceIntervals,
    control?.displayFrameIntervalsMs,
    'display',
  );
  const renderDetected = cadenceStraddlesStall(
    control?.renderCadenceIntervals,
    control?.renderFrameIntervalsMs,
    'render',
  );
  if (!displayDetected || !renderDetected) {
    failures.push(
      `negativeControl must expose an interval straddling the exact busy stall in both display and render cadence `
      + `(>= ${expected.minimumObservedFrameMs} ms)`,
    );
  }
  return {
    ok: failures.length === 0,
    failures,
    injectedDurationMs: control?.injectedDurationMs ?? null,
    busyLoopElapsedMs: control?.busyLoopElapsedMs ?? null,
    display,
    render,
    detected: displayDetected && renderDetected,
  };
}

export function evaluateLockedInteractionPerformanceReport(report) {
  const failures = [
    ...protocolInteractionFailures(report),
    ...environmentInteractionFailures(report?.environment),
  ];
  const targetMisses = [];
  if (!nonEmptyString(report?.capturedAt) || !finite(Date.parse(report.capturedAt))) {
    failures.push('capturedAt must be a valid timestamp');
  }
  const negativeControl = evaluateNegativeControl(report?.negativeControl);
  failures.push(...negativeControl.failures);

  let runResources = null;
  try {
    runResources = summarizeRunResources(report);
    if (runResources.limitViolations.length > 0) {
      failures.push(
        'run resource singleton limits violated: '
        + runResources.limitViolations.map(({ metric }) => metric).join(', '),
      );
    }
  } catch (error) {
    failures.push(`run resources: ${error.message}`);
  }

  const scenarios = Array.isArray(report?.scenarios) ? report.scenarios : [];
  const actualOrder = scenarios.map((scenario) => scenario?.id);
  if (JSON.stringify(actualOrder)
    !== JSON.stringify(LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder)) {
    failures.push(
      `scenario results must be an ordered array containing exactly `
      + LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.join(', '),
    );
  }
  failures.push(...inputRecordFailures(report?.inputRecords, scenarios));
  failures.push(...coldProcessLinkFailures(scenarios, report?.environment));
  failures.push(...toolFirstUseFailures(scenarios, report?.environment));

  const gates = [];
  for (const scenario of scenarios) {
    const spec = interactionScenarioById.get(scenario?.id);
    if (!spec || !Array.isArray(scenario?.events)) continue;
    let summary;
    try {
      summary = summarizeInteractionEvents(scenario.events);
    } catch (error) {
      failures.push(`${spec.id}: ${error.message}`);
      continue;
    }
    failures.push(...scenarioInteractionFailures(spec, scenario, summary));

    let resources = null;
    let resourcesPass = true;
    if (spec.stress) {
      try {
        resources = summarizeStressResources(spec, scenario.resources);
        const growing = Object.entries(resources.metrics)
          .filter(([, metric]) => metric.continuousGrowth)
          .map(([key]) => key);
        if (growing.length > 0) {
          resourcesPass = false;
          failures.push(`${spec.id}: continuously growing resources: ${growing.join(', ')}`);
        }
        if (resources.limitViolations.length > 0) {
          resourcesPass = false;
          failures.push(
            `${spec.id}: singleton resource limits violated: `
            + resources.limitViolations.map(({ metric }) => metric).join(', '),
          );
        }
        if (resources.endDeltaViolations.length > 0) {
          resourcesPass = false;
          failures.push(
            `${spec.id}: warmed resources ended above baseline: `
            + resources.endDeltaViolations.map(({ metric }) => metric).join(', '),
          );
        }
      } catch (error) {
        resourcesPass = false;
        failures.push(`${spec.id}: ${error.message}`);
      }
    }

    const cold = summary.cold;
    const coldDurationLimit = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds
      .maximumColdInteractionDurationMs[spec.id];
    const coldAcceptance = {
      applicable: spec.gradeCold === true,
      displayP95Pass: spec.gradeCold !== true || (
        cold?.displayCadence?.p95Ms
          < LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.coldP95FrameMsExclusive
      ),
      renderP95Pass: spec.gradeCold !== true || (
        cold?.renderCadence?.p95Ms
          < LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.coldP95FrameMsExclusive
      ),
      worstFramePass: spec.gradeCold !== true || (
        cold?.displayCadence?.worstMs
          <= LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.coldMaximumFrameMsInclusive
        && cold?.renderCadence?.worstMs
          <= LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.coldMaximumFrameMsInclusive
      ),
      noFramesOver50Pass: spec.gradeCold !== true || (
        cold?.displayCadence?.framesOver50Ms
          <= LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.maximumColdFramesOver50Ms
        && cold?.renderCadence?.framesOver50Ms
          <= LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.maximumColdFramesOver50Ms
      ),
      responseDurationLimitMs: coldDurationLimit ?? null,
      responseDurationPass: spec.gradeCold !== true || (
        Number.isFinite(coldDurationLimit)
        && cold?.interactionDuration?.worstMs <= coldDurationLimit
      ),
    };
    const coldAcceptancePass = Object.entries(coldAcceptance)
      .filter(([key]) => key.endsWith('Pass'))
      .every(([, pass]) => pass === true);
    if (!coldAcceptancePass) {
      if (!coldAcceptance.displayP95Pass) {
        failures.push(`${spec.id}: cold display p95 must be under 33 ms`);
      }
      if (!coldAcceptance.renderP95Pass) {
        failures.push(`${spec.id}: cold render p95 must be under 33 ms`);
      }
      if (!coldAcceptance.worstFramePass || !coldAcceptance.noFramesOver50Pass) {
        failures.push(`${spec.id}: cold cadence cannot contain a frame over 50 ms`);
      }
      if (!coldAcceptance.responseDurationPass) {
        failures.push(`${spec.id}: cold response worst exceeds ${coldDurationLimit} ms`);
      }
    }

    const warm = summary.warm;
    const warmAcceptance = {
      applicable: spec.gradeWarm,
      displayP95Pass: !spec.gradeWarm || (
        warm != null
        && warm.displayCadence.p95Ms
          < LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.warmP95FrameMsExclusive
      ),
      renderP95Pass: !spec.gradeWarm || (
        warm != null
        && warm.renderCadence.p95Ms
          < LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.warmP95FrameMsExclusive
      ),
      noFramesOver50Pass: !spec.gradeWarm || (
        warm != null
        && warm.displayCadence.framesOver50Ms
          <= LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.maximumWarmFramesOver50Ms
        && warm.renderCadence.framesOver50Ms
          <= LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.maximumWarmFramesOver50Ms
      ),
      targetWorstUnder33Pass: !spec.gradeWarm || (
        warm != null
        && warm.displayCadence.worstMs
          < LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.warmTargetWorstFrameMsExclusive
        && warm.renderCadence.worstMs
          < LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.warmTargetWorstFrameMsExclusive
      ),
      noRecurringFramesOver33Pass: !LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds
        .recurringFrameGateScenarioIds.includes(spec.id) || (
        warm != null
        && warm.eventsWithFrameOver33Ms
          <= LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds
            .maximumWarmEventsWithFramesOver33Ms
      ),
    };
    const acceptancePass = warmAcceptance.displayP95Pass
      && warmAcceptance.renderP95Pass
      && warmAcceptance.noFramesOver50Pass
      && warmAcceptance.targetWorstUnder33Pass
      && warmAcceptance.noRecurringFramesOver33Pass;
    const durationLimit = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds
      .maximumWarmInteractionDurationMs[spec.id];
    const responseDurationPass = !spec.gradeWarm || (
      Number.isFinite(durationLimit)
      && warm != null
      && warm.interactionDuration.p95Ms <= durationLimit
    );
    warmAcceptance.responseDurationLimitMs = durationLimit ?? null;
    warmAcceptance.responseDurationPass = responseDurationPass;
    if (!acceptancePass || !responseDurationPass) {
      if (!warmAcceptance.displayP95Pass) {
        failures.push(`${spec.id}: warm display p95 must be under 20 ms`);
      }
      if (!warmAcceptance.renderP95Pass) {
        failures.push(`${spec.id}: warm render p95 must be under 20 ms`);
      }
      if (!warmAcceptance.noFramesOver50Pass) {
        failures.push(`${spec.id}: warm frames over 50 ms are not allowed`);
      }
      if (!warmAcceptance.targetWorstUnder33Pass) {
        failures.push(`${spec.id}: warm display/render worst frame must be under 33 ms`);
      }
      if (!warmAcceptance.noRecurringFramesOver33Pass) {
        failures.push(
          `${spec.id}: frames over 33 ms recur in more than one warmed interaction event`,
        );
      }
      if (!responseDurationPass) {
        failures.push(`${spec.id}: warm response p95 exceeds ${durationLimit} ms`);
      }
    }
    gates.push({
      scenario: spec.id,
      coldPolicy: LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.coldPolicy,
      summary,
      resources,
      coldAcceptance,
      warmAcceptance,
      resourcesPass,
      ok: coldAcceptancePass && acceptancePass && responseDurationPass && resourcesPass,
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    targetMisses,
    negativeControl,
    runResources,
    gates,
  };
}
