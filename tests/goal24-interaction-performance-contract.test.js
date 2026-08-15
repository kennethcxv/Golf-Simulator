import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCKED_INTERACTION_PERFORMANCE_PROTOCOL,
  LOCKED_INTERACTION_PERFORMANCE_SCHEMA_VERSION,
  evaluateLockedInteractionPerformanceReport,
  summarizeInteractionEvents,
} from '../tools/qa/locked-performance-contract.mjs';
import {
  GOAL24_SUPPORTED_TOOL_IDS,
  GOAL24_SUPPORTED_TOOL_MANIFEST,
} from '../tools/qa/lib/goal24-tool-manifest.mjs';
import {
  GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
  GOAL24_DOOR_ROUTE_SCHEMA,
  GOAL24_DOOR_SCENARIOS,
  aggregateGoal24DoorEvidence,
  summarizeGoal24DoorwayRenderEvidence,
} from '../tools/qa/lib/goal24-door-evidence.mjs';
import {
  goal24ResourceCheckpointFixture,
  goal24ResourceSnapshotFixture,
} from './helpers/goal24-resource-fixture.mjs';

const clone = (value) => structuredClone(value);
const SUPPORTED_TOOL_IDS = GOAL24_SUPPORTED_TOOL_IDS;
const SCENARIO_TIME_OFFSET_MS = {
  doorApproach: 0,
  doorFirstOpen: 200,
  doorCrossingOutsideToInside: 400,
  doorCrossingInsideToOutside: 600,
  toolFirstUseByTool: 0,
  toolChanges20: 10_000,
  toolSwitches100Stress: 30_000,
};

const NAV_PERFORMANCE_SOURCE =
  'shipping-clubhouse-makeNav-and-navFresh-monotonic-counters';

function npcNavigationEvidence(
  lifecycleAtMs,
  routeRequestedAtMs,
  routeResolvedAtMs,
  {
    routeRequestId = 'route-1',
    customerId = 'customer-1',
    lifecycleBoundaryId = 'organic-footfall-1',
  } = {},
) {
  const navCreatedAtMs = Math.max(0, lifecycleAtMs - 500);
  const navCreateDurationMs = 4.25;
  const colliderVersion = 7;
  const rebuildDurationMs = 2.75;
  const before = {
    schemaVersion: 1,
    source: NAV_PERFORMANCE_SOURCE,
    capturedAtMs: Math.max(navCreatedAtMs, lifecycleAtMs - 0.5),
    navCreateStartedAtMs: navCreatedAtMs - navCreateDurationMs,
    navCreatedAtMs,
    navCreateDurationMs,
    navFreshCallCount: 0,
    navRebuildCount: 0,
    navRebuildTotalDurationMs: 0,
    navRebuildMaximumDurationMs: 0,
    navLastRebuildDurationMs: null,
    navLastRebuildAtMs: null,
    colliderVersion,
    builtColliderVersion: -1,
  };
  const after = {
    ...before,
    navFreshCallCount: 1,
    navRebuildCount: 1,
    navRebuildTotalDurationMs: rebuildDurationMs,
    navRebuildMaximumDurationMs: rebuildDurationMs,
    navLastRebuildDurationMs: rebuildDurationMs,
    navLastRebuildAtMs: routeRequestedAtMs + 1,
    builtColliderVersion: colliderVersion,
    capturedAtMs: routeResolvedAtMs,
    routeRequestId,
    customerId,
    lifecycleBoundaryId,
  };
  const atObservation = {
    ...after,
    capturedAtMs: routeResolvedAtMs + 1,
  };
  delete atObservation.routeRequestId;
  delete atObservation.customerId;
  delete atObservation.lifecycleBoundaryId;
  return {
    sceneLoaded: true,
    sceneLoadedAtMs: navCreatedAtMs,
    navCreateDurationMs,
    navPerformanceBefore: before,
    navPerformanceAfter: after,
    navPerformanceAtObservation: structuredClone(atObservation),
    navPerformanceDelta: {
      navFreshCallCount: 1,
      navRebuildCount: 1,
      navRebuildTotalDurationMs: rebuildDurationMs,
    },
    lifecycleWindowStartedAtMs: lifecycleAtMs,
    routeRequestedAtMs,
    routeResolvedAtMs,
    routeObserved: {
      atMs: routeResolvedAtMs + 2,
      customerId,
      navPerformance: structuredClone(atObservation),
      route: {
        requestId: routeRequestId,
        customerId,
        resolvedAtMs: routeResolvedAtMs,
        lifecycleBoundaryId,
        navPerformanceAtResolution: structuredClone(after),
      },
    },
  };
}

function temperatureFor(spec, index) {
  if (spec.temperature.policy === 'cold-only') return 'cold';
  if (spec.temperature.policy === 'cold-then-warm') return index === 0 ? 'cold' : 'warm';
  if (spec.temperature.policy === 'cold-block-then-warm') {
    return index < spec.temperature.minimumCold ? 'cold' : 'warm';
  }
  return 'warm';
}

function discriminatorFor(id, index, temperature) {
  switch (id) {
    case 'coldLaunch':
      return {
        processInstanceId: `process-${index + 1}`,
        userDataProfileId: `profile-${index + 1}`,
        userDataDirectory: `isolated/goal24/cold-${index + 1}`,
        freshProcess: true,
        mainMenuInteractive: true,
        shaderCachePolicy: 'retained-and-recorded',
        gpuCachePolicy: 'retained-and-recorded',
      };
    case 'startToControllable':
      return {
        processInstanceId: `process-${index + 1}`,
        menuControl: 'Continue',
        controlActivated: true,
        gameplayControllable: true,
        movementProbeAccepted: true,
        instrumentationReadyBeforeControl: true,
        firstControllableDisplayBoundaryObserved: true,
        firstControllableRenderObserved: true,
        instrumentationReadyAtMs: Math.max(0, index * 100 - 1),
        renderInstrumentationAttachedAtMs: index * 100 + 18,
        firstControllableDisplayBoundaryAtMs: index * 100 + 20,
        firstControllableRenderAtMs: index * 100 + 19,
      };
    case 'doorApproach':
      return {
        doorId: 'clubhouse-main',
        processInstanceId: temperature === 'cold'
          ? `process-${index + 1}`
          : 'warm-process',
        freshProcess: temperature === 'cold',
        startZone: 'outside',
        endZone: 'outside',
        startDistanceYards: 5,
        thresholdCrossed: true,
      };
    case 'doorFirstOpen':
      return {
        doorId: 'clubhouse-main',
        processInstanceId: `process-${index + 1}`,
        freshProcess: true,
        focusTargetDoorId: 'clubhouse-main',
        interactKey: 'e',
        desiredState: 'open',
        desiredStateApplied: true,
        opened: true,
        openSwingObserved: true,
        openSwingRadians: 0.4,
        productionDoorSignal: 'shipping-door-desired-state-changed',
        productionDoorSignalAtMs: 0,
      };
    case 'doorCrossingOutsideToInside':
      return {
        doorId: 'clubhouse-main',
        processInstanceId: temperature === 'cold'
          ? `process-${index + 1}`
          : 'warm-process',
        freshProcess: temperature === 'cold',
        fromZone: 'outside',
        toZone: 'inside',
        boundaryCrossed: true,
        normalMovement: true,
        noPriorInteriorThresholdCrossing: temperature === 'cold',
        interiorVisibilityObserved: true,
        productionVisibilityMarker: 'assets51to100-detail-visibility-false-to-true',
        productionVisibilityAtMs: null,
        detailVisibilityTransition: null,
        detailVisibilitySequenceDelta: null,
      };
    case 'doorCrossingInsideToOutside':
      return {
        doorId: 'clubhouse-main',
        fromZone: 'inside',
        toZone: 'outside',
        boundaryCrossed: true,
        normalMovement: true,
      };
    case 'ledgerOpen':
      return {
        fromState: 'closed',
        toState: 'open',
        readable: true,
        ledgerOwnsInput: true,
        firstOpen: temperature === 'cold',
        entryKey: 'k',
        interactKey: 'e',
      };
    case 'ledgerPageTurns10':
    case 'ledgerTurns50Stress': {
      const right = index % 2 === 0;
      return {
        direction: right ? 'right' : 'left',
        fromPage: right ? 0 : 1,
        toPage: right ? 1 : 0,
        bookAlreadyOpen: true,
        contentReady: true,
      };
    }
    case 'ledgerClose':
      return {
        fromState: 'open',
        toState: 'walking',
        walkControlRestored: true,
      };
    case 'toolFirstUseByTool': {
      const toolId = SUPPORTED_TOOL_IDS[index];
      return {
        toolId,
        supportedToolIds: [...SUPPORTED_TOOL_IDS],
        processInstanceId: 'aggregate-process',
        fromTool: index === 0 ? 'empty-hands' : SUPPORTED_TOOL_IDS[index - 1],
        toTool: toolId,
        equipKey: 'f',
        changed: true,
        viewmodelReady: true,
        firstUse: true,
        heldToolVisible: true,
        equipAnimationSettled: true,
        productionEquipSequenceBase: 0,
        productionEquipSequence: index + 1,
        productionEquipSignal: 'shipping-walk-toolChanged-edge',
        productionEquipAtMs: 0,
      };
    }
    case 'toolChanges20':
    case 'toolSwitches100Stress': {
      const cycle = ['empty-hands', ...SUPPORTED_TOOL_IDS];
      const globalIndex = id === 'toolChanges20' ? index : 20 + index;
      const fromTool = globalIndex === 0
        ? SUPPORTED_TOOL_IDS.at(-1)
        : cycle[(globalIndex - 1) % cycle.length];
      return {
        processInstanceId: 'aggregate-process',
        fromTool,
        toTool: cycle[globalIndex % cycle.length],
        equipKey: 'f',
        changed: true,
        viewmodelReady: true,
        firstUse: false,
        productionEquipSequence: SUPPORTED_TOOL_IDS.length + globalIndex + 1,
        productionEquipSignal: 'shipping-walk-toolChanged-edge',
        productionEquipAtMs: 0,
      };
    }
    case 'npcNavActivation':
      return {
        customerActivated: true,
        routeRequested: true,
        routeResolved: true,
        routeRequestId: `route-${index + 1}`,
        customerId: `customer-${index + 1}`,
        lifecycleBoundaryId: `organic-footfall-${index + 1}`,
        ...npcNavigationEvidence(10, 20, 30, {
          routeRequestId: `route-${index + 1}`,
          customerId: `customer-${index + 1}`,
          lifecycleBoundaryId: `organic-footfall-${index + 1}`,
        }),
      };
    default:
      throw new Error(`Unhandled scenario ${id}`);
  }
}

function cadenceEndpoints(startAtMs, intervals) {
  let cursor = startAtMs - Math.min(8, intervals[0] / 2);
  return intervals.map((durationMs) => {
    const start = cursor;
    cursor += durationMs;
    return { startAtMs: start, endAtMs: cursor, durationMs };
  });
}

function cadenceEndpointsFromBoundary(startAtMs, intervals) {
  let cursor = startAtMs;
  return intervals.map((durationMs) => {
    const start = cursor;
    cursor += durationMs;
    return { startAtMs: start, endAtMs: cursor, durationMs };
  });
}

function setMeasuredCadence(event, displayIntervals, renderIntervals = displayIntervals) {
  const startAtMs = event.markers.start.atMs;
  const displayEndpoints = cadenceEndpoints(startAtMs, displayIntervals);
  const startRenderCadence = event.scenarioId === 'startToControllable';
  const renderMeasurementStartedAtMs = startRenderCadence
    ? Math.max(startAtMs + 8, event.discriminator.renderInstrumentationAttachedAtMs + 1)
    : null;
  const renderEndpoints = startRenderCadence
    ? cadenceEndpointsFromBoundary(renderMeasurementStartedAtMs, renderIntervals)
    : cadenceEndpoints(startAtMs, renderIntervals);
  const endAtMs = Math.max(displayEndpoints.at(-1).endAtMs, renderEndpoints.at(-1).endAtMs) + 4;
  event.markers.end.atMs = endAtMs;
  event.cadenceAvailability = {
    display: {
      status: 'measured',
      priorBoundaryAtMs: displayEndpoints[0].startAtMs,
      priorBoundarySource: 'pre-armed requestAnimationFrame boundary',
    },
    render: {
      status: 'measured',
      priorBoundaryAtMs: renderEndpoints[0].startAtMs,
      priorBoundarySource: startRenderCadence
        ? 'first observed shipping scene3d.render boundary after instrumentation attachment'
        : 'pre-armed shipping scene3d.render boundary',
      ...(startRenderCadence ? {
        measurementStartedAtMs: renderMeasurementStartedAtMs,
        preMeasurementReason: 'shipping scene3d.render did not exist before this timestamp',
      } : {}),
    },
  };
  event.displayFrameIntervalsMs = [...displayIntervals];
  event.renderFrameIntervalsMs = [...renderIntervals];
  event.displayCadenceIntervals = displayEndpoints;
  event.renderCadenceIntervals = renderEndpoints;
  event.sampleCoverage = {
    complete: true,
    windowDurationMs: endAtMs - startAtMs,
    droppedDisplaySamples: 0,
    droppedRenderSamples: 0,
    droppedSubmissionSamples: 0,
    displayFirstBoundaryOffsetMs: displayEndpoints[0].endAtMs - startAtMs,
    displayLastBoundaryBeforeEndMs: endAtMs - displayEndpoints.at(-1).endAtMs,
    renderFirstBoundaryOffsetMs: startRenderCadence
      ? renderMeasurementStartedAtMs - startAtMs
      : renderEndpoints[0].endAtMs - startAtMs,
    renderLastBoundaryBeforeEndMs: endAtMs - renderEndpoints.at(-1).endAtMs,
  };
  if (event.scenarioId === 'doorFirstOpen') {
    event.discriminator.productionDoorSignalAtMs = startAtMs + 1;
  }
  if (['toolFirstUseByTool', 'toolChanges20', 'toolSwitches100Stress']
    .includes(event.scenarioId)) {
    event.discriminator.productionEquipAtMs = startAtMs + 1;
  }
  if (event.scenarioId === 'npcNavActivation') {
    Object.assign(event.discriminator, npcNavigationEvidence(
      startAtMs + 1,
      startAtMs + 8,
      Math.min(startAtMs + 18, endAtMs),
      {
        routeRequestId: event.discriminator.routeRequestId,
        customerId: event.discriminator.customerId,
        lifecycleBoundaryId: event.discriminator.lifecycleBoundaryId,
      },
    ));
  }
  if (GOAL24_DOOR_SCENARIOS.includes(event.scenarioId)) attachDoorEvidence(event);
  return event;
}

function attachDoorEvidence(event) {
  const inbound = event.scenarioId === 'doorCrossingOutsideToInside';
  const outbound = event.scenarioId === 'doorCrossingInsideToOutside';
  const routeKind = inbound ? 'outside-in' : outbound ? 'inside-out' : 'approach';
  const startZ = outbound ? 18 : inbound ? 22 : 26.5;
  const finishZ = inbound ? 18 : outbound ? 22 : 21.7;
  const pose = (z) => ({
    x: 40, y: 1.7, z, qx: 0, qy: 1, qz: 0, qw: 0, fov: 60, aspect: 16 / 9,
  });
  const pathSamples = Array.from({ length: 5 }, (_, index) => {
    const alpha = index / 4;
    const z = startZ + (finishZ - startZ) * alpha;
    return {
      ordinal: index + 1, atMs: event.markers.start.atMs + index * 5,
      x: 40, z, distanceToDoor: Math.abs(z - 20), inside: z < 20,
    };
  });
  const startedDetailed = routeKind === 'inside-out';
  const endedDetailed = routeKind === 'outside-in';
  const startSequence = routeKind === 'inside-out' ? 1 : 0;
  const endSequence = routeKind === 'approach' ? startSequence : startSequence + 1;
  const detailVisibilityTransition = routeKind === 'approach' ? null : {
    sequence: endSequence,
    atMs: event.markers.start.atMs + (inbound ? 3 : 18),
    from: startedDetailed,
    to: endedDetailed,
    cameraLocalX: 0,
    cameraLocalZ: inbound ? 5.6 : 7.1,
    exteriorDistanceYards: inbound ? 1.45 : 1.55,
    detailClearanceYards: GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
  };
  const runtimeReadyAtMs = Math.max(0, pathSamples[0].atMs - 50);
  const staticBatchStartedAtMs = Math.max(0, pathSamples[0].atMs - 40);
  const staticBatchReadyAtMs = Math.max(0, pathSamples[0].atMs - 20);
  const runtimeSnapshot = (
    capturedAtMs,
    detailedVisible,
    detailVisibilitySequence,
    lastDetailVisibilityTransition,
  ) => ({
    capturedAtMs,
    runtimeReadyAtMs,
    staticBatchStartedAtMs,
    staticBatchReadyAtMs,
    detailedVisible,
    detailVisibilitySequence,
    lastDetailVisibilityTransition,
  });
  const routeSignature = {
    schema: GOAL24_DOOR_ROUTE_SCHEMA,
    routeKind,
    detailClearanceYards: GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
    startPose: { x: 40, z: startZ, yaw: outbound ? 0 : Math.PI, pitch: -0.05 },
    target: { x: 40, z: 20 },
    normal: { x: 0, z: 1 },
    startCameraPose: pose(startZ),
    finishPosition: { x: 40, z: finishZ },
    finishCameraPose: pose(finishZ),
    pathSamples,
    runtimeStart: runtimeSnapshot(
      pathSamples[0].atMs,
      startedDetailed,
      startSequence,
      null,
    ),
    runtimeEnd: runtimeSnapshot(
      pathSamples.at(-1).atMs,
      endedDetailed,
      endSequence,
      detailVisibilityTransition,
    ),
  };
  event.discriminator.routeSignature = routeSignature;
  if (inbound) {
    event.discriminator.productionVisibilityMarker =
      'assets51to100-detail-visibility-false-to-true';
    event.discriminator.productionVisibilityAtMs = detailVisibilityTransition.atMs;
    event.discriminator.detailVisibilityTransition = clone(detailVisibilityTransition);
    event.discriminator.detailVisibilitySequenceDelta = endSequence - startSequence;
  }
  const renderFrameEvidence = event.renderCadenceIntervals.map((interval, index) => ({
    ordinal: index + 1,
    productionRenderStartedAtMs: interval.endAtMs,
    productionRenderEndedAtMs: interval.endAtMs + 1,
    rendererFrameBefore: 100 + index,
    rendererFrameAfter: 101 + index,
    composedRendersBefore: 200 + index,
    composedRendersAfter: 201 + index,
    composedRenderDelta: 1,
    calls: 120,
    triangles: 250_000,
    rendererInfoAutoReset: false,
    shadowBakesBefore: 4,
    shadowBakesAfter: 4,
    shadowBakeDelta: 0,
    frameClass: 'non-shadow',
    boundarySource: 'shipping-scene3d.render-wrapper',
    counterSource: 'THREE.WebGLRenderer.info.render-after-shipping-composed-frame',
    shadowClassificationSource: 'scene3d.post.stats().shadowBakes',
    composedRenderSource: 'scene3d.post.stats().composedRenders',
  }));
  event.doorwayRenderEvidence = summarizeGoal24DoorwayRenderEvidence({
    renderCadenceIntervals: event.renderCadenceIntervals,
    renderFrameEvidence,
  });
}

function eventFor(spec, index) {
  const temperature = temperatureFor(spec, index);
  const startAt = 1_000 + index * 1_000 + (SCENARIO_TIME_OFFSET_MS[spec.id] || 0);
  const coldIntervals = [16, 72, 16];
  const acceptedColdIntervals = [16, 16.5, 17, 16, 15.5];
  const warmIntervals = [16, 16.5, 17, 16, 15.5];
  const input = spec.id === 'coldLaunch'
    ? {
      kind: 'process',
      control: 'electron-launch',
      delivery: 'electron-main-process',
    }
    : spec.id === 'npcNavActivation'
      ? {
        kind: 'lifecycle',
        control: 'first-customer-route',
        delivery: 'production-lifecycle-observer',
      }
      : spec.id === 'startToControllable'
        ? {
          kind: 'pointer',
          control: 'continue-button',
          delivery: 'playwright-pointer',
        }
        : {
          kind: 'keyboard',
          control: spec.id === 'doorFirstOpen'
            ? 'door-interact-binding'
            : ['toolFirstUseByTool', 'toolChanges20', 'toolSwitches100Stress'].includes(spec.id)
              ? 'tool-belt-binding'
              : 'production-binding',
          delivery: 'playwright-keyboard',
        };
  const discriminator = discriminatorFor(spec.id, index, temperature);
  if (spec.id === 'npcNavActivation') {
    discriminator.lifecycleWindowStartedAtMs = startAt + 1;
    discriminator.routeRequestedAtMs = startAt + 8;
    discriminator.routeResolvedAtMs = startAt + 18;
  }
  const event = {
    scenarioId: spec.id,
    sequence: index + 1,
    temperature,
    input: {
      recordId: `${spec.id}-input-${index + 1}`,
      ...input,
      evidencePolicy: spec.triggerEvidencePolicy,
      productionPath: true,
      directStateMutation: false,
    },
    markers: {
      start: { name: spec.markerNames[0], clock: spec.markerClock, atMs: startAt },
      end: { name: spec.markerNames[1], clock: spec.markerClock, atMs: startAt + 24 },
    },
    cadenceAvailability: spec.cadencePolicy === 'duration-only-before-page-context'
      ? {
        display: { status: 'unavailable', reason: 'page context did not exist yet' },
        render: { status: 'unavailable', reason: 'game renderer did not exist yet' },
      }
      : { display: { status: 'measured' }, render: { status: 'measured' } },
    displayFrameIntervalsMs: [],
    renderFrameIntervalsMs: [],
    displayCadenceIntervals: [],
    renderCadenceIntervals: [],
    sampleCoverage: {
      complete: true,
      windowDurationMs: 24,
      droppedDisplaySamples: 0,
      droppedRenderSamples: 0,
      droppedSubmissionSamples: 0,
      displayFirstBoundaryOffsetMs: spec.cadencePolicy === 'duration-only-before-page-context'
        ? null : 8,
      displayLastBoundaryBeforeEndMs: spec.cadencePolicy === 'duration-only-before-page-context'
        ? null : 4,
      renderFirstBoundaryOffsetMs: spec.cadencePolicy === 'duration-only-before-page-context'
        ? null : 9,
      renderLastBoundaryBeforeEndMs: spec.cadencePolicy === 'duration-only-before-page-context'
        ? null : 3,
    },
    discriminator,
  };
  if (spec.id === 'startToControllable') {
    Object.assign(event.discriminator, {
      instrumentationReadyAtMs: startAt - 1,
      renderInstrumentationAttachedAtMs: startAt + 4,
      firstControllableDisplayBoundaryAtMs: startAt + 20,
      firstControllableRenderAtMs: startAt + 19,
    });
  }
  if (spec.cadencePolicy === 'duration-only-before-page-context') return event;
  const intervals = temperature === 'cold'
    ? (spec.gradeCold ? acceptedColdIntervals : coldIntervals)
    : warmIntervals;
  return setMeasuredCadence(event, intervals);
}

function eventCountFor(spec) {
  if (spec.eventCount.exact != null) return spec.eventCount.exact;
  if (spec.eventCount.matchesEnvironmentToolIds) return SUPPORTED_TOOL_IDS.length;
  return spec.eventCount.minimum;
}

function stableResources(scenarioId, iterations) {
  const checkpoints = [0, 0.2, 0.4, 0.6, 0.8, 1]
    .map((fraction) => Math.round(iterations * fraction));
  return {
    rawSource: {
      scenario: scenarioId === 'ledgerTurns50Stress' ? 'ledgerStress' : 'toolStress',
    },
    samples: checkpoints.map((iteration, index) => clone(goal24ResourceCheckpointFixture({
      iteration,
      elapsedMs: index * 1_000,
      label: `${scenarioId}-resource-${iteration}`,
      capturedAt: `2026-08-11T20:00:${String(index).padStart(2, '0')}.000Z`,
      heapUsedBytes: [100_000, 101_000, 99_000, 100_500, 99_500, 100_000][index],
      listenerCount: 60,
    }))),
  };
}

function replaceResourceSnapshot(checkpoint, overrides = {}) {
  const current = checkpoint.snapshot;
  const metrics = current.metrics;
  checkpoint.snapshot = clone(goal24ResourceSnapshotFixture({
    label: current.label,
    capturedAt: current.capturedAt,
    heapUsedBytes: metrics.jsHeapUsedBytes,
    listenerCount: metrics.activeEventListenerCount,
    domNodeCount: metrics.domNodeCount,
    sceneObjectCount: metrics.sceneObjectCount,
    meshCount: metrics.meshCount,
    materialCount: metrics.materialCount,
    geometryCount: metrics.geometryCount,
    textureCount: metrics.textureCount,
    rendererGeometryAllocationCount: metrics.rendererGeometryAllocationCount,
    rendererTextureAllocationCount: metrics.rendererTextureAllocationCount,
    rendererProgramCount: metrics.rendererProgramCount,
    textureDimensionsUnknownCount: metrics.textureDimensionsUnknownCount,
    audioContextCount: metrics.audioContextCount,
    estimatedTextureBytes: metrics.estimatedTextureBytes,
    workloadContext: current.diagnostics.workloadContext,
    ...overrides,
  }));
}

function inputRecordFor(scenarioId, event) {
  const atMs = event.markers.start.atMs;
  let raw;
  let deliveredAtMs = atMs;
  let requestedAtMs = atMs;
  let request = null;
  if (event.input.evidencePolicy === 'launcher-process') {
    raw = {
      eventType: 'process-spawn',
      target: 'electron-main-process',
      source: 'qa-runner-process-spawn-anchor',
      isTrusted: null,
      trustBasis: 'launcher-process-anchor',
      atMs,
      processInstanceId: event.discriminator.processInstanceId,
    };
  } else if (event.input.evidencePolicy === 'production-lifecycle') {
    raw = {
      eventType: 'customer-route-resolved',
      target: 'clubhouse.customer-lifecycle',
      source: 'production-customer-lifecycle-observer',
      isTrusted: null,
      trustBasis: 'production-lifecycle-observation',
      atMs,
      routeRequestId: event.discriminator.routeRequestId,
    };
  } else if (event.input.kind === 'pointer') {
    raw = {
      eventType: 'click',
      target: '#continue-button',
      source: 'capturing-DOM-input-listener',
      isTrusted: true,
      trustBasis: 'browser-isTrusted',
      atMs,
      eventTimestampMs: atMs,
      observedAtMs: atMs,
      clientX: 960,
      clientY: 540,
      button: 0,
      targetElement: {
        tag: 'button',
        id: 'continue-button',
        classes: ['menu-primary'],
        role: null,
        ariaLabel: null,
        text: 'Continue',
      },
      targetControlLabel: 'Continue',
    };
    request = {
      atMs,
      source: 'driver-immediately-before-Playwright-primary-menu-click',
      kind: 'pointer',
      actualControl: 'Continue',
      action: 'click',
      scenarioId,
      rawScenario: scenarioId,
    };
  } else if (scenarioId === 'ledgerOpen') {
    deliveredAtMs = atMs + 2;
    const step = (phase, control, stepRequestedAtMs, stepDeliveredAtMs, consumedAtMs) => ({
      phase,
      control,
      requestedAtMs: stepRequestedAtMs,
      requestSource: 'driver-immediately-before-Playwright-input-call',
      requestKind: 'keyboard',
      deliveredAtMs: stepDeliveredAtMs,
      consumed: { signal: `shipping-ledger-${phase}`, atMs: consumedAtMs },
      eventType: 'keydown',
      key: control,
      code: `Key${control.toUpperCase()}`,
      target: 'document.activeElement',
      source: 'capturing-DOM-input-listener',
      isTrusted: true,
      trustBasis: 'browser-isTrusted',
      eventTimestampMs: stepDeliveredAtMs,
      observedAtMs: stepDeliveredAtMs,
    });
    raw = {
      eventType: 'keydown-sequence',
      target: 'document.activeElement',
      source: 'capturing-DOM-input-listener',
      isTrusted: true,
      trustBasis: 'browser-isTrusted',
      atMs: deliveredAtMs,
      eventTimestampMs: deliveredAtMs,
      observedAtMs: deliveredAtMs,
      code: 'KeyE',
      key: 'e',
      steps: [
        step('raise-book', 'k', atMs, atMs, atMs + 1),
        step('open-cover', 'e', atMs + 2, atMs + 2, atMs + 3),
      ],
    };
    request = {
      atMs,
      source: 'driver-immediately-before-Playwright-input-call',
      kind: 'keyboard',
      actualControl: 'k',
      action: 'down',
      scenarioId,
      rawScenario: scenarioId,
    };
  } else {
    const key = scenarioId === 'doorFirstOpen'
      ? event.discriminator.interactKey
      : ['toolFirstUseByTool', 'toolChanges20', 'toolSwitches100Stress'].includes(scenarioId)
        ? event.discriminator.equipKey
        : 'w';
    raw = {
      eventType: 'keydown',
      target: 'document.activeElement',
      source: 'capturing-DOM-input-listener',
      isTrusted: true,
      trustBasis: 'browser-isTrusted',
      atMs,
      eventTimestampMs: atMs,
      observedAtMs: atMs,
      code: `Key${String(key).toUpperCase()}`,
      key,
    };
    request = {
      atMs,
      source: 'driver-immediately-before-Playwright-input-call',
      kind: 'keyboard',
      actualControl: key,
      action: 'down',
      scenarioId,
      rawScenario: scenarioId,
    };
  }
  return {
    recordId: event.input.recordId,
    scenarioId,
    eventSequence: event.sequence,
    clock: event.markers.start.clock,
    requestedAtMs,
    deliveredAtMs,
    ...(request ? { request } : {}),
    kind: event.input.kind,
    control: event.input.control,
    delivery: event.input.delivery,
    evidencePolicy: event.input.evidencePolicy,
    raw,
    consumed: {
      signal: scenarioId === 'doorFirstOpen'
        ? event.discriminator.productionDoorSignal
        : ['toolFirstUseByTool', 'toolChanges20', 'toolSwitches100Stress'].includes(scenarioId)
          ? event.discriminator.productionEquipSignal
          : `production-handler:${scenarioId}`,
      productionHandlerObserved: true,
      atMs: scenarioId === 'ledgerOpen' ? atMs + 3 : atMs + 1,
    },
    outcome: {
      signal: `observed-transition:${event.markers.end.name}`,
      observationSource: 'independent-state-and-render-probe',
      observed: true,
      markerName: event.markers.end.name,
      atMs: event.markers.end.atMs,
    },
  };
}

function validReport() {
  const protocol = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL;
  const scenarios = protocol.scenarios.map((spec) => {
    const scenario = {
      id: spec.id,
      events: Array.from(
        { length: eventCountFor(spec) },
        (_, index) => eventFor(spec, index),
      ),
    };
    if (spec.stress) scenario.resources = stableResources(spec.id, spec.stress.iterations);
    return scenario;
  });
  const doorSources = Array.from({ length: 7 }, (_, index) => ({
    run: { id: `door-process-${index + 1}`, ordinal: index + 1 },
    contribution: {
      scenarios: GOAL24_DOOR_SCENARIOS.map((id) => {
        const template = scenarios.find((scenario) => scenario.id === id).events[0];
        const temperatures = id === 'doorCrossingInsideToOutside'
          ? ['warm', 'warm', 'warm'] : ['cold', 'warm', 'warm', 'warm'];
        return {
          id,
          events: temperatures.map((temperature, eventIndex) => ({
            ...clone(template),
            sequence: eventIndex + 1,
            temperature,
            rawSource: { scenario: id, id: `${id}-${eventIndex + 1}`, eventIndex },
          })),
        };
      }),
    },
  }));
  return {
    schemaVersion: LOCKED_INTERACTION_PERFORMANCE_SCHEMA_VERSION,
    capturedAt: '2026-08-11T20:00:00.000Z',
    resourceBaseline: {
      iteration: 0,
      elapsedMs: 0,
      snapshot: clone(goal24ResourceSnapshotFixture({
        label: 'run-resource-baseline',
        capturedAt: '2026-08-11T19:59:58.000Z',
        listenerCount: 60,
      })),
    },
    resourceFinal: {
      iteration: 1,
      elapsedMs: 120_000,
      snapshot: clone(goal24ResourceSnapshotFixture({
        label: 'run-resource-final',
        capturedAt: '2026-08-11T20:02:00.000Z',
        listenerCount: 60,
      })),
    },
    protocol: {
      id: protocol.id,
      version: protocol.version,
      scenarioOrder: [...protocol.scenarioOrder],
      cadence: clone(protocol.cadence),
      thresholds: clone(protocol.thresholds),
      coldPolicy: protocol.coldPolicy,
      inputEvidence: clone(protocol.inputEvidence),
      negativeControl: clone(protocol.negativeControl),
      stress: clone(protocol.stress),
    },
    environment: {
      toolManifest: clone(GOAL24_SUPPORTED_TOOL_MANIFEST),
      renderer: {
        name: 'THREE.WebGLRenderer',
        api: 'WebGL2',
        version: 'Three r185',
        hardwareAccelerated: true,
        contextLost: false,
      },
      gpu: { vendor: 'GPU vendor', renderer: 'GPU renderer', backend: 'D3D11' },
      window: {
        innerWidth: 1920,
        innerHeight: 1080,
        outerWidth: 1920,
        outerHeight: 1080,
        mode: 'windowed',
        focused: true,
        visible: true,
      },
      devicePixelRatio: 1,
      quality: {
        preset: 'high',
        renderScale: 1,
        shadows: true,
        ambientOcclusion: true,
        bloom: true,
      },
      profile: {
        name: 'goal24-unified-interaction',
        saveFixture: 'relaxed-seed-424242',
        cameraRoute: 'locked-goal24-route-v1',
        userDataDirectory: 'isolated/goal24/run-1',
        userDataPolicy: 'isolated-fresh-per-cold-process',
        coldRunProfileRoot: 'isolated/goal24',
        shaderCachePolicy: 'retained-and-recorded',
        gpuCachePolicy: 'retained-and-recorded',
        processInstanceId: 'aggregate-process',
        userDataProfileId: 'aggregate-profile',
        electronLaunchRequestedAtEpochMs: 1_000,
        supportedToolIds: [...SUPPORTED_TOOL_IDS],
        seed: 424242,
      },
      instrumentation: {
        mode: 'low-overhead',
        gradeEligible: true,
        displayCadenceSource: protocol.cadence.display,
        renderCadenceSource: protocol.cadence.render,
        runtimeClock: protocol.cadence.runtimeClock,
        launcherClock: protocol.cadence.launcherClock,
        tracing: false,
        overlay: false,
        video: false,
        gcBeforeResourceCheckpoint: true,
        clockBridge: {
          domain: 'unix-epoch-milliseconds',
          source: 'launcher-epoch-plus-renderer-performance-time-origin',
          captureStartedAtEpochMs: 1_000,
          rendererSampledAtEpochMs: 1_000.75,
          captureCompletedAtEpochMs: 1_001,
          maximumUncertaintyMs: 1,
        },
      },
    },
    negativeControl: {
      kind: protocol.negativeControl.kind,
      injectedDurationMs: protocol.negativeControl.injectedDurationMs,
      sameInstrumentation: true,
      busyLoopElapsedMs: 81,
      markers: {
        start: { name: 'busy-stall-begin', clock: 'renderer', atMs: 5_000 },
        end: { name: 'busy-stall-end', clock: 'renderer', atMs: 5_081 },
      },
      displayFrameIntervalsMs: [16, 82, 16],
      renderFrameIntervalsMs: [16, 81, 16],
      displayCadenceIntervals: [
        { startAtMs: 4_983, endAtMs: 4_999, durationMs: 16 },
        { startAtMs: 4_999, endAtMs: 5_081, durationMs: 82 },
        { startAtMs: 5_081, endAtMs: 5_097, durationMs: 16 },
      ],
      renderCadenceIntervals: [
        { startAtMs: 4_984, endAtMs: 5_000, durationMs: 16 },
        { startAtMs: 5_000, endAtMs: 5_081, durationMs: 81 },
        { startAtMs: 5_081, endAtMs: 5_097, durationMs: 16 },
      ],
    },
    inputRecords: scenarios.flatMap((scenario) => (
      scenario.events.map((event) => inputRecordFor(scenario.id, event))
    )),
    scenarios,
    doorEvidence: aggregateGoal24DoorEvidence(doorSources),
  };
}

function setReportCadence(report, event, displayIntervals, renderIntervals = displayIntervals) {
  setMeasuredCadence(event, displayIntervals, renderIntervals);
  const record = report.inputRecords.find(({ recordId }) => recordId === event.input.recordId);
  if (record) {
    record.outcome.markerName = event.markers.end.name;
    record.outcome.atMs = event.markers.end.atMs;
  }
  return event;
}

test('Goal 24 protocol pins the complete ordered interaction and stress sequence', () => {
  assert.equal(LOCKED_INTERACTION_PERFORMANCE_SCHEMA_VERSION, 1);
  assert.deepEqual(LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder, [
    'coldLaunch',
    'startToControllable',
    'doorApproach',
    'doorFirstOpen',
    'doorCrossingOutsideToInside',
    'doorCrossingInsideToOutside',
    'ledgerOpen',
    'ledgerPageTurns10',
    'ledgerClose',
    'toolFirstUseByTool',
    'toolChanges20',
    'npcNavActivation',
    'ledgerTurns50Stress',
    'toolSwitches100Stress',
  ]);
  assert.equal(
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios
      .find(({ id }) => id === 'ledgerPageTurns10').eventCount.exact,
    10,
  );
  assert.equal(
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios
      .find(({ id }) => id === 'toolChanges20').temperature.minimumWarm,
    20,
  );
  assert.equal(
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios
      .find(({ id }) => id === 'coldLaunch').eventCount.minimum,
    7,
  );
  assert.equal(
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios
      .find(({ id }) => id === 'doorApproach').temperature.minimumCold,
    7,
  );
  assert.equal(
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios
      .find(({ id }) => id === 'doorApproach').gradeCold,
    true,
  );
  assert.equal(
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios
      .find(({ id }) => id === 'doorFirstOpen').temperature.minimumCold,
    7,
  );
  assert.equal(
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios
      .find(({ id }) => id === 'doorCrossingOutsideToInside').temperature.minimumCold,
    7,
  );
  assert.deepEqual(
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios
      .filter(({ stress }) => stress).map(({ stress }) => stress.iterations),
    [50, 100],
  );
  assert.equal(LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.warmP95FrameMsExclusive, 20);
  assert.equal(LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds.maximumWarmFramesOver50Ms, 0);
  assert.ok(Object.isFrozen(LOCKED_INTERACTION_PERFORMANCE_PROTOCOL));
  assert.ok(Object.isFrozen(LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios[0].eventCount));
  assert.ok(Object.isFrozen(LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.resourceMetrics));
});

test('interaction summary derives median, p95, worst, and slow-frame counts by cadence and heat', () => {
  const spec = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios
    .find(({ id }) => id === 'doorApproach');
  const events = [eventFor(spec, 0), eventFor(spec, 1), eventFor(spec, 2)];
  events[1].temperature = 'warm';
  events[2].temperature = 'warm';
  setMeasuredCadence(events[2], [16, 16.5, 17, 16, 15.5]);
  setMeasuredCadence(events[1], [12, 18, 34, 51], [11, 17, 35, 52]);
  const summary = summarizeInteractionEvents(events);
  assert.equal(summary.eventCount, 3);
  assert.equal(summary.cold.eventCount, 1);
  assert.equal(summary.cold.displayCadence.worstMs, 17);
  assert.equal(summary.warm.eventCount, 2);
  assert.equal(summary.warm.displayCadence.medianMs, 16.5);
  assert.equal(summary.warm.displayCadence.p95Ms, 51);
  assert.equal(summary.warm.displayCadence.worstMs, 51);
  assert.equal(summary.warm.displayCadence.framesOver33Ms, 2);
  assert.equal(summary.warm.displayCadence.framesOver50Ms, 1);
  assert.equal(summary.warm.renderCadence.framesOver50Ms, 1);
  assert.equal(summary.warm.eventsWithFrameOver50Ms, 1);
});

test('a complete low-overhead report passes and keeps cold stalls outside warm grading', () => {
  const result = evaluateLockedInteractionPerformanceReport(validReport());
  assert.equal(result.ok, true, result.failures.join('\n'));
  assert.equal(result.gates.length, LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.length);
  assert.equal(result.negativeControl.detected, true);
  assert.equal(result.targetMisses.length, 0);
  const launchGate = result.gates.find(({ scenario }) => scenario === 'coldLaunch');
  assert.equal(launchGate.summary.cold.eventCount, 7);
  assert.equal(launchGate.summary.cold.displayCadence, null);
  assert.equal(launchGate.summary.cold.renderCadence, null);
  const firstToolGate = result.gates.find(({ scenario }) => scenario === 'toolFirstUseByTool');
  assert.equal(firstToolGate.summary.cold.eventCount, SUPPORTED_TOOL_IDS.length);
  assert.equal(firstToolGate.coldAcceptance.noFramesOver50Pass, true);
  const toolGate = result.gates.find(({ scenario }) => scenario === 'toolChanges20');
  assert.equal(toolGate.summary.cold, null);
  assert.equal(toolGate.summary.warm.displayCadence.worstMs, 17);
  assert.equal(toolGate.warmAcceptance.displayP95Pass, true);
  const stressGate = result.gates.find(({ scenario }) => scenario === 'ledgerTurns50Stress');
  assert.deepEqual(
    Object.keys(stressGate.resources.metrics),
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.resourceMetrics,
  );
  assert.equal(stressGate.resources.metrics.jsHeapUsedBytes.start, 100_000);
  assert.equal(stressGate.resources.metrics.jsHeapUsedBytes.end, 100_000);
  assert.equal(stressGate.resources.metrics.jsHeapUsedBytes.continuousGrowth, false);
  assert.equal(stressGate.resources.provenance.jsHeapUsedBytes.unit, 'bytes');
  assert.equal(stressGate.resources.metrics.renderLoopCount.maximum, 1);
  assert.equal(stressGate.resources.metrics.drawCallCount.start, 120);
  assert.equal(stressGate.resources.metrics.renderedTriangleCount.start, 250_000);
  assert.equal(stressGate.resources.provenance.estimatedTextureBytes.estimated, true);
  assert.match(
    stressGate.resources.provenance.estimatedTextureBytes.limitations,
    /exact GPU memory is unavailable/i,
  );
});

test('evaluator fails closed on protocol, metadata, order, input, and cadence malformations', () => {
  const candidate = validReport();
  candidate.protocol.thresholds.warmP95FrameMsExclusive = 21;
  candidate.environment.gpu.renderer = '';
  candidate.environment.instrumentation.video = true;
  [candidate.scenarios[0], candidate.scenarios[1]] = [
    candidate.scenarios[1], candidate.scenarios[0],
  ];
  candidate.scenarios[2].events[0].input.directStateMutation = true;
  candidate.scenarios[3].events[0].renderFrameIntervalsMs = [];
  candidate.scenarios[3].events[0].renderCadenceIntervals = [];
  const result = evaluateLockedInteractionPerformanceReport(candidate);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /protocol\.thresholds does not match/);
  assert.match(result.failures.join('\n'), /environment\.gpu\.renderer is required/);
  assert.match(result.failures.join('\n'), /instrumentation\.video must be false/);
  assert.match(result.failures.join('\n'), /scenario results must be an ordered array/);
  assert.match(result.failures.join('\n'), /no direct state mutation/);
  assert.match(result.failures.join('\n'), /renderFrameIntervalsMs requires a non-empty array/);
});

test('fresh-process samples, raw trusted input, and independent outcomes are linked fail-closed', () => {
  const candidate = validReport();
  const approach = candidate.scenarios.find(({ id }) => id === 'doorApproach');
  approach.events[2].discriminator.processInstanceId = 'wrong-process';
  const record = candidate.inputRecords.find(({ scenarioId }) => scenarioId === 'ledgerOpen');
  record.raw.isTrusted = false;
  record.outcome.signal = record.consumed.signal;
  const result = evaluateLockedInteractionPerformanceReport(candidate);
  assert.equal(result.ok, false);
  assert.match(
    result.failures.join('\n'),
    /cold launch, start-to-controllable, door approach, first open, and first interior crossing must link/,
  );
  assert.match(result.failures.join('\n'), /trusted user input requires browser isTrusted evidence/);
  assert.match(result.failures.join('\n'), /requires an independent ordered outcome/);
});

test('launcher and production-lifecycle evidence cannot fabricate DOM isTrusted proof', () => {
  const candidate = validReport();
  const launcher = candidate.inputRecords.find(({ scenarioId }) => scenarioId === 'coldLaunch');
  const lifecycle = candidate.inputRecords
    .find(({ scenarioId }) => scenarioId === 'npcNavActivation');
  launcher.raw.isTrusted = true;
  launcher.raw.trustBasis = 'browser-isTrusted';
  lifecycle.raw.isTrusted = true;
  lifecycle.raw.trustBasis = 'browser-isTrusted';

  const result = evaluateLockedInteractionPerformanceReport(candidate);
  assert.equal(result.ok, false);
  assert.match(
    result.failures.join('\n'),
    /coldLaunch: event 1 launcher-process must explicitly avoid a DOM isTrusted claim/,
  );
  assert.match(
    result.failures.join('\n'),
    /npcNavActivation: event 1 production-lifecycle must explicitly avoid a DOM isTrusted claim/,
  );
});

test('trusted pointer evidence omits keyboard fields but requires coordinates and button', () => {
  const passing = validReport();
  const pointer = passing.inputRecords
    .find(({ scenarioId }) => scenarioId === 'startToControllable');
  assert.equal(pointer.raw.code, undefined);
  assert.equal(pointer.raw.key, undefined);
  assert.equal(evaluateLockedInteractionPerformanceReport(passing).ok, true);

  for (const missingField of ['clientX', 'clientY', 'button']) {
    const candidate = validReport();
    const record = candidate.inputRecords
      .find(({ scenarioId }) => scenarioId === 'startToControllable');
    delete record.raw[missingField];
    const result = evaluateLockedInteractionPerformanceReport(candidate);
    assert.equal(result.ok, false, `${missingField} must be required`);
    assert.match(
      result.failures.join('\n'),
      /trusted input must provide keyboard key\/code or pointer button\/coordinates/,
    );
  }
});

test('trusted keyboard evidence requires both native key and code fields', () => {
  for (const missingField of ['key', 'code']) {
    const candidate = validReport();
    const record = candidate.inputRecords.find(({ scenarioId }) => scenarioId === 'ledgerClose');
    delete record.raw[missingField];
    const result = evaluateLockedInteractionPerformanceReport(candidate);
    assert.equal(result.ok, false, `${missingField} must be required`);
    assert.match(
      result.failures.join('\n'),
      /trusted input must provide keyboard key\/code or pointer button\/coordinates/,
    );
  }
});

test('each scenario rejects trigger evidence from a different policy', () => {
  const candidate = validReport();
  const ledger = candidate.scenarios.find(({ id }) => id === 'ledgerOpen');
  const event = ledger.events[0];
  const record = candidate.inputRecords.find(({ recordId }) => recordId === event.input.recordId);
  event.input.evidencePolicy = 'launcher-process';
  record.evidencePolicy = 'launcher-process';
  record.raw.isTrusted = null;
  record.raw.trustBasis = 'launcher-process-anchor';

  const result = evaluateLockedInteractionPerformanceReport(candidate);
  assert.equal(result.ok, false);
  assert.match(
    result.failures.join('\n'),
    /ledgerOpen: event 1 input\.evidencePolicy must be trusted-user-input/,
  );
});

test('clock bridge declares a bounded capture bracket containing the renderer sample', () => {
  const passing = validReport();
  assert.deepEqual(passing.environment.instrumentation.clockBridge, {
    domain: 'unix-epoch-milliseconds',
    source: 'launcher-epoch-plus-renderer-performance-time-origin',
    captureStartedAtEpochMs: 1_000,
    rendererSampledAtEpochMs: 1_000.75,
    captureCompletedAtEpochMs: 1_001,
    maximumUncertaintyMs: 1,
  });
  assert.equal(evaluateLockedInteractionPerformanceReport(passing).ok, true);

  const invalidBridges = [
    { domain: 'performance-now', source: 'bridge', captureStartedAtEpochMs: 1_000, rendererSampledAtEpochMs: 1_001, captureCompletedAtEpochMs: 1_002, maximumUncertaintyMs: 2 },
    { domain: 'unix-epoch-milliseconds', source: '', captureStartedAtEpochMs: 1_000, rendererSampledAtEpochMs: 1_001, captureCompletedAtEpochMs: 1_002, maximumUncertaintyMs: 2 },
    { domain: 'unix-epoch-milliseconds', source: 'bridge', captureStartedAtEpochMs: 1_000, rendererSampledAtEpochMs: 999, captureCompletedAtEpochMs: 1_002, maximumUncertaintyMs: 2 },
    { domain: 'unix-epoch-milliseconds', source: 'bridge', captureStartedAtEpochMs: 1_000, rendererSampledAtEpochMs: 1_001, captureCompletedAtEpochMs: 1_200, maximumUncertaintyMs: 200 },
  ];
  for (const clockBridge of invalidBridges) {
    const candidate = validReport();
    candidate.environment.instrumentation.clockBridge = clockBridge;
    const result = evaluateLockedInteractionPerformanceReport(candidate);
    assert.equal(result.ok, false);
    assert.match(
      result.failures.join('\n'),
      /clockBridge must provide a bounded runner capture bracket containing the renderer sample/,
    );
  }
});

test('pre-page cold launch cannot fabricate cadence and start requires display/render proof', () => {
  const candidate = validReport();
  const launch = candidate.scenarios.find(({ id }) => id === 'coldLaunch');
  launch.events[0].displayFrameIntervalsMs = [80];
  const start = candidate.scenarios.find(({ id }) => id === 'startToControllable');
  start.events[0].discriminator.firstControllableDisplayBoundaryObserved = false;
  const result = evaluateLockedInteractionPerformanceReport(candidate);
  assert.equal(result.ok, false);
  assert.match(
    result.failures.join('\n'),
    /unavailable display cadence requires empty duration and endpoint arrays and a reason/,
  );
  assert.match(
    result.failures.join('\n'),
    /firstControllableDisplayBoundaryObserved must be true/,
  );
});

test('busy-stall negative control must be observed in both display and actual render cadence', () => {
  const passing = evaluateLockedInteractionPerformanceReport(validReport());
  assert.equal(passing.negativeControl.ok, true);
  assert.equal(passing.negativeControl.display.worstMs, 82);
  assert.equal(passing.negativeControl.render.worstMs, 81);

  const blind = validReport();
  blind.negativeControl.detected = true;
  blind.negativeControl.displayFrameIntervalsMs = [16, 16, 16];
  blind.negativeControl.renderFrameIntervalsMs = [16, 16, 16];
  const rejected = evaluateLockedInteractionPerformanceReport(blind);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.negativeControl.detected, false);
  assert.match(rejected.failures.join('\n'), /must expose an interval straddling the exact busy stall/);
});

test('stress resources reject missing provenance and zero heap masquerading as a measurement', () => {
  const missingSource = validReport();
  const ledgerStress = missingSource.scenarios
    .find(({ id }) => id === 'ledgerTurns50Stress');
  ledgerStress.resources.samples[0].snapshot.metricSources.materialCount.source = '';
  const sourceResult = evaluateLockedInteractionPerformanceReport(missingSource);
  assert.equal(sourceResult.ok, false);
  assert.match(
    sourceResult.failures.join('\n'),
    /failed raw snapshot validation.*differs from recomputed raw measurement evidence/,
  );

  const unstratifiedWorkload = validReport();
  const unstratifiedStress = unstratifiedWorkload.scenarios
    .find(({ id }) => id === 'ledgerTurns50Stress');
  delete unstratifiedStress.resources.samples[0]
    .snapshot.metricSources.drawCallCount.stratification;
  unstratifiedStress.resources.samples[0]
    .snapshot.metricSources.renderedTriangleCount.statistic =
    'first-observed-production-frame';
  const unstratifiedResult = evaluateLockedInteractionPerformanceReport(
    unstratifiedWorkload,
  );
  assert.equal(unstratifiedResult.ok, false);
  assert.match(
    unstratifiedResult.failures.join('\n'),
    /failed raw snapshot validation.*differs from recomputed raw measurement evidence/,
  );

  const zeroHeap = validReport();
  const toolStress = zeroHeap.scenarios.find(({ id }) => id === 'toolSwitches100Stress');
  toolStress.resources.samples[0].snapshot.metrics.jsHeapUsedBytes = 0;
  const heapResult = evaluateLockedInteractionPerformanceReport(zeroHeap);
  assert.equal(heapResult.ok, false);
  assert.match(heapResult.failures.join('\n'), /failed raw snapshot validation/);

  const duplicatedLoops = validReport();
  const duplicatedStress = duplicatedLoops.scenarios
    .find(({ id }) => id === 'ledgerTurns50Stress');
  duplicatedStress.resources.samples.forEach((sample) => {
    sample.snapshot.metrics.renderLoopCount = 2;
    sample.snapshot.metrics.audioContextCount = 2;
  });
  const duplicateResult = evaluateLockedInteractionPerformanceReport(duplicatedLoops);
  assert.equal(duplicateResult.ok, false);
  assert.match(
    duplicateResult.failures.join('\n'),
    /failed raw snapshot validation/,
  );

  const unprovenScheduler = validReport();
  const unprovenStress = unprovenScheduler.scenarios
    .find(({ id }) => id === 'toolSwitches100Stress');
  delete unprovenStress.resources.samples[0].snapshot.metricSources.renderLoopCount
    .absoluteProductionSchedulerProof;
  const unprovenResult = evaluateLockedInteractionPerformanceReport(unprovenScheduler);
  assert.equal(unprovenResult.ok, false);
  assert.match(
    unprovenResult.failures.join('\n'),
    /failed raw snapshot validation/,
  );

  const duplicatePending = validReport();
  const duplicatePendingStress = duplicatePending.scenarios
    .find(({ id }) => id === 'ledgerTurns50Stress');
  Object.assign(duplicatePendingStress.resources.samples[0]
    .snapshot.metricSources.renderCallbackCount, {
    invariantHolds: false,
    duplicateProgressionObserved: true,
    pendingCallbackCount: 2,
    maximumPendingCallbackCount: 2,
  });
  const duplicatePendingResult = evaluateLockedInteractionPerformanceReport(duplicatePending);
  assert.equal(duplicatePendingResult.ok, false);
  assert.match(
    duplicatePendingResult.failures.join('\n'),
    /failed raw snapshot validation/,
  );

  const retainedListener = validReport();
  const retainedStress = retainedListener.scenarios
    .find(({ id }) => id === 'toolSwitches100Stress');
  [60, 62, 60, 61, 60, 61].forEach((value, index) => {
    replaceResourceSnapshot(retainedStress.resources.samples[index], {
      listenerCount: value,
    });
  });
  const retainedResult = evaluateLockedInteractionPerformanceReport(retainedListener);
  assert.equal(retainedResult.ok, false);
  assert.match(
    retainedResult.failures.join('\n'),
    /warmed resources ended above baseline: activeEventListenerCount/,
  );
});

test('locked resource evaluation recomputes retained evidence and requires run endpoints', () => {
  const stripped = validReport();
  const strippedCheckpoint = stripped.scenarios
    .find(({ id }) => id === 'ledgerTurns50Stress').resources.samples[2];
  delete strippedCheckpoint.snapshot.measurementEvidence.production.renderSamples;
  const strippedResult = evaluateLockedInteractionPerformanceReport(stripped);
  assert.equal(strippedResult.ok, false);
  assert.match(strippedResult.failures.join('\n'), /raw measurement evidence is missing|evidence is incomplete/i);

  for (const field of ['resourceBaseline', 'resourceFinal']) {
    const missing = validReport();
    delete missing[field];
    const result = evaluateLockedInteractionPerformanceReport(missing);
    assert.equal(result.ok, false, `${field} must be mandatory`);
    assert.match(result.failures.join('\n'), /run resources:.*full snapshot/i);
  }

  for (const [label, mutate] of [
    ['duplicate composed render', (samples) => { samples[1].composedRenders += 1; }],
    ['callback-free renderer progress', (samples) => {
      samples[1].productionCallbackCount = samples[0].productionCallbackCount;
    }],
  ]) {
    const report = validReport();
    const checkpoint = report.scenarios
      .find(({ id }) => id === 'toolSwitches100Stress').resources.samples[1];
    mutate(checkpoint.snapshot.measurementEvidence.production.renderSamples);
    const result = evaluateLockedInteractionPerformanceReport(report);
    assert.equal(result.ok, false, label);
    assert.match(result.failures.join('\n'), /failed raw snapshot validation/i);
  }

  const shortObservation = validReport();
  const shortCheckpoint = shortObservation.scenarios
    .find(({ id }) => id === 'ledgerTurns50Stress').resources.samples[1];
  replaceResourceSnapshot(shortCheckpoint, { renderSampleCount: 12 });
  const shortResult = evaluateLockedInteractionPerformanceReport(shortObservation);
  assert.equal(shortResult.ok, false);
  assert.match(shortResult.failures.join('\n'), /must observe exactly 12 composed frames/);

  const shadowMismatch = validReport();
  const shadowCheckpoint = shadowMismatch.scenarios
    .find(({ id }) => id === 'toolSwitches100Stress').resources.samples[1];
  shadowCheckpoint.snapshot.metrics.shadowBakeCount += 1;
  const shadowResult = evaluateLockedInteractionPerformanceReport(shadowMismatch);
  assert.equal(shadowResult.ok, false);
  assert.match(shadowResult.failures.join('\n'), /failed raw snapshot validation/);
});

test('persistent renderer allocations, programs, and unknown dimensions cannot grow', () => {
  const cases = [
    ['rendererGeometryAllocationCount', 'rendererGeometryAllocationCount'],
    ['rendererTextureAllocationCount', 'rendererTextureAllocationCount'],
    ['rendererProgramCount', 'rendererProgramCount'],
    ['textureDimensionsUnknownCount', 'textureDimensionsUnknownCount'],
  ];
  for (const [metric, option] of cases) {
    const report = validReport();
    const stress = report.scenarios.find(({ id }) => id === 'ledgerTurns50Stress');
    const final = stress.resources.samples.at(-1);
    replaceResourceSnapshot(final, { [option]: final.snapshot.metrics[metric] + 1 });
    const result = evaluateLockedInteractionPerformanceReport(report);
    assert.equal(result.ok, false, `${metric} growth must fail`);
    assert.match(result.failures.join('\n'), new RegExp(`warmed resources ended above baseline:.*${metric}`));
  }
});

test('JS heap persistence uses the larger of two MiB or five percent', () => {
  const within = validReport();
  const withinStress = within.scenarios.find(({ id }) => id === 'ledgerTurns50Stress');
  const start = withinStress.resources.samples[0].snapshot.metrics.jsHeapUsedBytes;
  replaceResourceSnapshot(withinStress.resources.samples.at(-1), {
    heapUsedBytes: start + 2 * 1024 * 1024,
  });
  assert.equal(evaluateLockedInteractionPerformanceReport(within).ok, true);

  const above = validReport();
  const aboveStress = above.scenarios.find(({ id }) => id === 'ledgerTurns50Stress');
  replaceResourceSnapshot(aboveStress.resources.samples.at(-1), {
    heapUsedBytes: start + 2 * 1024 * 1024 + 1,
  });
  const result = evaluateLockedInteractionPerformanceReport(above);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /warmed resources ended above baseline: jsHeapUsedBytes/);
});

test('warm acceptance reads raw render cadence, is strict below 20 ms, and rejects >50 ms', () => {
  const stalled = validReport();
  const crossing = stalled.scenarios.find(({ id }) => id === 'doorCrossingOutsideToInside');
  const warmCrossing = crossing.events.find(({ temperature }) => temperature === 'warm');
  setReportCadence(stalled, warmCrossing, [16, 16, 16, 16], [16, 16, 55, 16]);
  const stalledResult = evaluateLockedInteractionPerformanceReport(stalled);
  assert.equal(stalledResult.ok, false);
  assert.match(stalledResult.failures.join('\n'), /warm render p95 must be under 20 ms/);
  assert.match(stalledResult.failures.join('\n'), /warm frames over 50 ms are not allowed/);

  const boundary = validReport();
  const ledger = boundary.scenarios.find(({ id }) => id === 'ledgerPageTurns10');
  ledger.events.forEach((event) => {
    setReportCadence(boundary, event, [16, 20]);
  });
  const boundaryResult = evaluateLockedInteractionPerformanceReport(boundary);
  assert.equal(boundaryResult.ok, false);
  assert.match(boundaryResult.failures.join('\n'), /warm display p95 must be under 20 ms/);
  assert.match(boundaryResult.failures.join('\n'), /warm render p95 must be under 20 ms/);
});

test('under-33 warmed worst-frame requirement fails acceptance', () => {
  const candidate = validReport();
  const close = candidate.scenarios.find(({ id }) => id === 'ledgerClose');
  setReportCadence(candidate, close.events[0], [...Array(39).fill(16), 34]);
  const result = evaluateLockedInteractionPerformanceReport(candidate);
  assert.equal(result.ok, false);
  assert.deepEqual(result.targetMisses, []);
  assert.match(result.failures.join('\n'), /warm display\/render worst frame must be under 33 ms/);
  const gate = result.gates.find(({ scenario }) => scenario === 'ledgerClose');
  assert.equal(gate.warmAcceptance.displayP95Pass, true);
  assert.equal(gate.warmAcceptance.targetWorstUnder33Pass, false);
});

test('alternation, cold/warm tool separation, and continuous stress growth fail explicitly', () => {
  const candidate = validReport();
  const pages = candidate.scenarios.find(({ id }) => id === 'ledgerPageTurns10');
  pages.events[1].discriminator.direction = pages.events[0].discriminator.direction;
  const tools = candidate.scenarios.find(({ id }) => id === 'toolChanges20');
  tools.events[1].temperature = 'cold';
  const stress = candidate.scenarios.find(({ id }) => id === 'toolSwitches100Stress');
  stress.resources.samples.forEach((sample, index) => {
    replaceResourceSnapshot(sample, {
      heapUsedBytes: 100_000 + index * 3_000_000,
      listenerCount: 60 + index,
    });
  });
  const result = evaluateLockedInteractionPerformanceReport(candidate);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /page directions must alternate/);
  assert.match(result.failures.join('\n'), /all events must be warm/);
  assert.match(
    result.failures.join('\n'),
    /continuously growing resources: jsHeapUsedBytes, activeEventListenerCount/,
  );
  const gate = result.gates.find(({ scenario }) => scenario === 'toolSwitches100Stress');
  assert.ok(gate.resources.metrics.jsHeapUsedBytes.slopePerIteration > 0);
  assert.equal(gate.resources.metrics.jsHeapUsedBytes.continuousGrowth, true);
});

test('every repeated 40 ms door interaction is caught by the recurring warm-frame gate', () => {
  for (const scenarioId of [
    'doorApproach',
    'doorCrossingOutsideToInside',
    'doorCrossingInsideToOutside',
  ]) {
    const candidate = validReport();
    const scenario = candidate.scenarios.find(({ id }) => id === scenarioId);
    scenario.events.filter(({ temperature }) => temperature === 'warm').forEach((event) => {
      setReportCadence(candidate, event, [...Array(39).fill(16), 40]);
    });
    const result = evaluateLockedInteractionPerformanceReport(candidate);
    const gate = result.gates.find(({ scenario: id }) => id === scenarioId);
    assert.equal(gate.warmAcceptance.displayP95Pass, true, `${scenarioId} fixture keeps p95 clean`);
    assert.equal(gate.warmAcceptance.noRecurringFramesOver33Pass, false, scenarioId);
    assert.equal(result.ok, false, scenarioId);
    assert.match(
      result.failures.join('\n'),
      new RegExp(`${scenarioId}: frames over 33 ms recur`),
    );
  }
});

test('measured cadence endpoint records cannot hide the immediate-start interval', () => {
  const candidate = validReport();
  const event = candidate.scenarios.find(({ id }) => id === 'ledgerClose').events[0];
  for (const cadenceKey of ['display', 'render']) {
    const endpointsKey = `${cadenceKey}CadenceIntervals`;
    event[endpointsKey].forEach((endpoint) => {
      endpoint.startAtMs += 8;
      endpoint.endAtMs += 8;
    });
    event.cadenceAvailability[cadenceKey].priorBoundaryAtMs = event.markers.start.atMs;
  }
  event.markers.end.atMs += 8;
  event.sampleCoverage.windowDurationMs += 8;
  event.sampleCoverage.displayFirstBoundaryOffsetMs = 16;
  event.sampleCoverage.renderFirstBoundaryOffsetMs = 16;
  const record = candidate.inputRecords.find(({ recordId }) => recordId === event.input.recordId);
  record.outcome.atMs = event.markers.end.atMs;

  const result = evaluateLockedInteractionPerformanceReport(candidate);
  assert.equal(result.ok, false);
  assert.match(
    result.failures.join('\n'),
    /cadence must straddle the start marker from its documented prior boundary/,
  );
});

test('start cadence straddles the click for display and begins render at the first observed boundary', () => {
  const passing = validReport();
  const event = passing.scenarios
    .find(({ id }) => id === 'startToControllable').events[0];
  const displayFirst = event.displayCadenceIntervals[0];
  const renderFirst = event.renderCadenceIntervals[0];
  const renderAvailability = event.cadenceAvailability.render;
  assert.ok(displayFirst.startAtMs < event.markers.start.atMs);
  assert.ok(displayFirst.endAtMs > event.markers.start.atMs);
  assert.ok(renderFirst.startAtMs > event.markers.start.atMs);
  assert.equal(renderAvailability.measurementStartedAtMs, renderFirst.startAtMs);
  assert.equal(renderAvailability.priorBoundaryAtMs, renderFirst.startAtMs);
  assert.ok(event.discriminator.renderInstrumentationAttachedAtMs
    <= renderAvailability.measurementStartedAtMs);
  assert.equal(
    event.sampleCoverage.renderFirstBoundaryOffsetMs,
    renderFirst.startAtMs - event.markers.start.atMs,
  );
  assert.equal(evaluateLockedInteractionPerformanceReport(passing).ok, true);

  const unboundStart = validReport();
  unboundStart.scenarios.find(({ id }) => id === 'startToControllable')
    .events[0].cadenceAvailability.render.measurementStartedAtMs += 1;
  assert.match(
    evaluateLockedInteractionPerformanceReport(unboundStart).failures.join('\n'),
    /start render cadence must begin at its documented first observed production-render boundary/,
  );

  const lateAttachment = validReport();
  const lateAttachmentEvent = lateAttachment.scenarios
    .find(({ id }) => id === 'startToControllable').events[0];
  lateAttachmentEvent.discriminator.renderInstrumentationAttachedAtMs =
    lateAttachmentEvent.cadenceAvailability.render.measurementStartedAtMs + 1;
  assert.match(
    evaluateLockedInteractionPerformanceReport(lateAttachment).failures.join('\n'),
    /start render cadence must begin at its documented first observed production-render boundary/,
  );

  const fabricatedPreClickRender = validReport();
  const fabricatedEvent = fabricatedPreClickRender.scenarios
    .find(({ id }) => id === 'startToControllable').events[0];
  fabricatedEvent.renderCadenceIntervals.forEach((endpoint) => {
    endpoint.startAtMs -= 16;
    endpoint.endAtMs -= 16;
  });
  const fabricatedFirst = fabricatedEvent.renderCadenceIntervals[0];
  fabricatedEvent.cadenceAvailability.render.priorBoundaryAtMs = fabricatedFirst.startAtMs;
  fabricatedEvent.cadenceAvailability.render.measurementStartedAtMs = fabricatedFirst.startAtMs;
  fabricatedEvent.discriminator.renderInstrumentationAttachedAtMs = fabricatedFirst.startAtMs - 1;
  fabricatedEvent.sampleCoverage.renderFirstBoundaryOffsetMs =
    fabricatedFirst.startAtMs - fabricatedEvent.markers.start.atMs;
  fabricatedEvent.sampleCoverage.renderLastBoundaryBeforeEndMs =
    fabricatedEvent.markers.end.atMs
      - fabricatedEvent.renderCadenceIntervals.at(-1).endAtMs;
  assert.match(
    evaluateLockedInteractionPerformanceReport(fabricatedPreClickRender).failures.join('\n'),
    /start render cadence must begin at its documented first observed production-render boundary/,
  );

  const missingReason = validReport();
  delete missingReason.scenarios.find(({ id }) => id === 'startToControllable')
    .events[0].cadenceAvailability.render.preMeasurementReason;
  assert.match(
    evaluateLockedInteractionPerformanceReport(missingReason).failures.join('\n'),
    /start render cadence must begin at its documented first observed production-render boundary/,
  );
});

test('start display cadence still rejects a blind interval immediately after the click', () => {
  const candidate = validReport();
  const event = candidate.scenarios
    .find(({ id }) => id === 'startToControllable').events[0];
  event.displayCadenceIntervals.forEach((endpoint) => {
    endpoint.startAtMs += 8;
    endpoint.endAtMs += 8;
  });
  event.cadenceAvailability.display.priorBoundaryAtMs =
    event.displayCadenceIntervals[0].startAtMs;
  event.sampleCoverage.displayFirstBoundaryOffsetMs =
    event.displayCadenceIntervals[0].endAtMs - event.markers.start.atMs;
  event.sampleCoverage.displayLastBoundaryBeforeEndMs =
    event.markers.end.atMs - event.displayCadenceIntervals.at(-1).endAtMs;

  assert.match(
    evaluateLockedInteractionPerformanceReport(candidate).failures.join('\n'),
    /display cadence must straddle the start marker from its documented prior boundary/,
  );
});

test('cadence endpoint arrays are one-to-one, duration-equal, contiguous, and window-bounded', () => {
  const missing = validReport();
  const missingEvent = missing.scenarios.find(({ id }) => id === 'ledgerClose').events[0];
  missingEvent.displayCadenceIntervals.pop();
  assert.match(
    evaluateLockedInteractionPerformanceReport(missing).failures.join('\n'),
    /requires one interval-endpoint record per duration sample/,
  );

  const unequal = validReport();
  const unequalEvent = unequal.scenarios.find(({ id }) => id === 'ledgerClose').events[0];
  unequalEvent.renderCadenceIntervals[1].durationMs += 1;
  assert.match(
    evaluateLockedInteractionPerformanceReport(unequal).failures.join('\n'),
    /must be ordered, contiguous, and duration-equal/,
  );

  const discontinuous = validReport();
  const discontinuousEvent = discontinuous.scenarios
    .find(({ id }) => id === 'ledgerClose').events[0];
  discontinuousEvent.displayCadenceIntervals[1].startAtMs += 1;
  discontinuousEvent.displayCadenceIntervals[1].durationMs -= 1;
  assert.match(
    evaluateLockedInteractionPerformanceReport(discontinuous).failures.join('\n'),
    /must be ordered, contiguous, and duration-equal/,
  );

  const outside = validReport();
  const outsideEvent = outside.scenarios.find(({ id }) => id === 'ledgerClose').events[0];
  const last = outsideEvent.displayCadenceIntervals.at(-1);
  outsideEvent.displayFrameIntervalsMs.push(16);
  outsideEvent.displayCadenceIntervals.push({
    startAtMs: last.endAtMs,
    endAtMs: last.endAtMs + 16,
    durationMs: 16,
  });
  assert.match(
    evaluateLockedInteractionPerformanceReport(outside).failures.join('\n'),
    /contains samples outside the graded window/,
  );

  const unavailable = validReport();
  const launch = unavailable.scenarios.find(({ id }) => id === 'coldLaunch').events[0];
  launch.displayCadenceIntervals.push({ startAtMs: 999, endAtMs: 1000, durationMs: 1 });
  assert.match(
    evaluateLockedInteractionPerformanceReport(unavailable).failures.join('\n'),
    /unavailable display cadence requires empty duration and endpoint arrays and a reason/,
  );
});

test('first door open requires desired-open and visible production swing evidence', () => {
  const candidate = validReport();
  const firstOpen = candidate.scenarios.find(({ id }) => id === 'doorFirstOpen').events[0];
  firstOpen.discriminator.opened = false;
  const result = evaluateLockedInteractionPerformanceReport(candidate);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /doorFirstOpen: event 1 opened must be true/);
});

test('a 500 ms NPC activation hitch fails the explicit cold cadence gate', () => {
  const candidate = validReport();
  const npc = candidate.scenarios.find(({ id }) => id === 'npcNavActivation').events[0];
  setReportCadence(candidate, npc, [16, 500, 16]);
  const result = evaluateLockedInteractionPerformanceReport(candidate);
  const gate = result.gates.find(({ scenario }) => scenario === 'npcNavActivation');
  assert.equal(result.ok, false);
  assert.equal(gate.coldAcceptance.applicable, true);
  assert.equal(gate.coldAcceptance.noFramesOver50Pass, false);
  assert.match(result.failures.join('\n'), /npcNavActivation: cold cadence cannot contain a frame over 50 ms/);
});

test('NPC first-route evidence rejects nav prewarm and a missing shipping rebuild', () => {
  const prewarmed = validReport();
  const prewarmedNpc = prewarmed.scenarios
    .find(({ id }) => id === 'npcNavActivation').events[0];
  prewarmedNpc.discriminator.navPerformanceBefore.navFreshCallCount = 1;
  prewarmedNpc.discriminator.navPerformanceAfter.navFreshCallCount = 2;
  let result = evaluateLockedInteractionPerformanceReport(prewarmed);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /before any navFresh call or collider-grid prewarm/);

  const noRebuild = validReport();
  const noRebuildNpc = noRebuild.scenarios
    .find(({ id }) => id === 'npcNavActivation').events[0];
  const before = noRebuildNpc.discriminator.navPerformanceBefore;
  Object.assign(noRebuildNpc.discriminator.navPerformanceAfter, {
    navRebuildCount: before.navRebuildCount,
    navRebuildTotalDurationMs: before.navRebuildTotalDurationMs,
    navRebuildMaximumDurationMs: before.navRebuildMaximumDurationMs,
    navLastRebuildDurationMs: null,
    navLastRebuildAtMs: null,
    builtColliderVersion: before.builtColliderVersion,
  });
  Object.assign(noRebuildNpc.discriminator.navPerformanceDelta, {
    navRebuildCount: 0,
    navRebuildTotalDurationMs: 0,
  });
  result = evaluateLockedInteractionPerformanceReport(noRebuild);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /exactly one shipping navFresh call and one collider-grid rebuild/);

  const forgedCreateDuration = validReport();
  const forgedNpc = forgedCreateDuration.scenarios
    .find(({ id }) => id === 'npcNavActivation').events[0];
  forgedNpc.discriminator.navPerformanceBefore.navCreateDurationMs += 1;
  result = evaluateLockedInteractionPerformanceReport(forgedCreateDuration);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /invalid shipping navigation counters or timings/);

  const lateGlobalCounter = validReport();
  const lateNpc = lateGlobalCounter.scenarios
    .find(({ id }) => id === 'npcNavActivation').events[0];
  lateNpc.discriminator.navPerformanceAfter.navFreshCallCount += 1;
  result = evaluateLockedInteractionPerformanceReport(lateGlobalCounter);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /snapshot owned by the exact resolved production route/);

  const missingPoll = validReport();
  const missingPollNpc = missingPoll.scenarios
    .find(({ id }) => id === 'npcNavActivation').events[0];
  delete missingPollNpc.discriminator.navPerformanceAtObservation;
  result = evaluateLockedInteractionPerformanceReport(missingPoll);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /later production diagnostic poll/);

  const malformedPoll = validReport();
  const malformedPollNpc = malformedPoll.scenarios
    .find(({ id }) => id === 'npcNavActivation').events[0];
  malformedPollNpc.discriminator.navPerformanceAtObservation.capturedAtMs = Number.NaN;
  malformedPollNpc.discriminator.routeObserved.navPerformance.capturedAtMs = Number.NaN;
  result = evaluateLockedInteractionPerformanceReport(malformedPoll);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /navPerformanceAtObservation contains invalid/);

  const relabeledRoute = validReport();
  const relabeledNpc = relabeledRoute.scenarios
    .find(({ id }) => id === 'npcNavActivation').events[0];
  relabeledNpc.discriminator.routeRequestId = 'relabeled-route';
  relabeledNpc.discriminator.routeObserved.route.requestId = 'relabeled-route';
  result = evaluateLockedInteractionPerformanceReport(relabeledRoute);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /snapshot must own matching request/);

  const impossibleOneRebuild = validReport();
  const impossibleNpc = impossibleOneRebuild.scenarios
    .find(({ id }) => id === 'npcNavActivation').events[0];
  for (const snapshot of [
    impossibleNpc.discriminator.navPerformanceAfter,
    impossibleNpc.discriminator.routeObserved.route.navPerformanceAtResolution,
    impossibleNpc.discriminator.navPerformanceAtObservation,
    impossibleNpc.discriminator.routeObserved.navPerformance,
  ]) {
    snapshot.navRebuildTotalDurationMs = 9;
    snapshot.navRebuildMaximumDurationMs = 7;
    snapshot.navLastRebuildDurationMs = 2.5;
  }
  impossibleNpc.discriminator.navPerformanceDelta.navRebuildTotalDurationMs = 9;
  result = evaluateLockedInteractionPerformanceReport(impossibleOneRebuild);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /equal total, maximum, and last durations/);

  const malformedLaterTiming = validReport();
  const malformedLaterNpc = malformedLaterTiming.scenarios
    .find(({ id }) => id === 'npcNavActivation').events[0];
  for (const snapshot of [
    malformedLaterNpc.discriminator.navPerformanceAtObservation,
    malformedLaterNpc.discriminator.routeObserved.navPerformance,
  ]) {
    snapshot.navRebuildTotalDurationMs = 9;
    snapshot.navRebuildMaximumDurationMs = 7;
    snapshot.navLastRebuildDurationMs = 2.5;
  }
  result = evaluateLockedInteractionPerformanceReport(malformedLaterTiming);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /equal total, maximum, and last durations/);

  const lateBeforeCapture = validReport();
  const lateBeforeNpc = lateBeforeCapture.scenarios
    .find(({ id }) => id === 'npcNavActivation').events[0];
  lateBeforeNpc.discriminator.navPerformanceBefore.capturedAtMs =
    lateBeforeNpc.discriminator.routeResolvedAtMs + 100;
  result = evaluateLockedInteractionPerformanceReport(lateBeforeCapture);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /captured before the organic lifecycle and exact route/);
});

test('a first-approach cold hitch fails absolute acceptance even when every process repeats it', () => {
  const candidate = validReport();
  const approach = candidate.scenarios.find(({ id }) => id === 'doorApproach');
  for (const event of approach.events.filter(({ temperature }) => temperature === 'cold')) {
    setReportCadence(candidate, event, [16, 72, 16]);
  }
  const result = evaluateLockedInteractionPerformanceReport(candidate);
  const gate = result.gates.find(({ scenario }) => scenario === 'doorApproach');
  assert.equal(result.ok, false);
  assert.equal(gate.coldAcceptance.applicable, true);
  assert.equal(gate.coldAcceptance.worstFramePass, false);
  assert.equal(gate.coldAcceptance.noFramesOver50Pass, false);
  assert.match(result.failures.join('\n'), /doorApproach: cold cadence cannot contain a frame over 50 ms/);
});

test('tool first-use evidence is exact, unique, complete, and precedes every warmed tool ID', () => {
  const duplicate = validReport();
  const duplicateEvents = duplicate.scenarios
    .find(({ id }) => id === 'toolFirstUseByTool').events;
  duplicateEvents[1].discriminator.toolId = duplicateEvents[0].discriminator.toolId;
  duplicateEvents[1].discriminator.toTool = duplicateEvents[0].discriminator.toTool;
  assert.match(
    evaluateLockedInteractionPerformanceReport(duplicate).failures.join('\n'),
    /exactly one first-use event for every supported tool ID in declared order/,
  );

  const missing = validReport();
  missing.scenarios.find(({ id }) => id === 'toolFirstUseByTool').events.pop();
  assert.match(
    evaluateLockedInteractionPerformanceReport(missing).failures.join('\n'),
    /exactly one first-use event for every supported tool ID in declared order/,
  );

  const unseenWarmTool = validReport();
  unseenWarmTool.scenarios.find(({ id }) => id === 'toolChanges20')
    .events[0].discriminator.toTool = 'unproven-tool';
  assert.match(
    evaluateLockedInteractionPerformanceReport(unseenWarmTool).failures.join('\n'),
    /cannot be warm before its toTool has exact first-use evidence/,
  );
});

test('warmed tool events form one continuous canonical F-belt chain through hands-free', () => {
  const valid = validReport();
  const normal = valid.scenarios.find(({ id }) => id === 'toolChanges20').events;
  assert.deepEqual(
    normal.slice(0, 3).map(({ discriminator }) => [
      discriminator.fromTool, discriminator.toTool, discriminator.productionEquipSequence,
    ]),
    [
      ['trashbag', 'empty-hands', 9],
      ['empty-hands', 'vacuum', 10],
      ['vacuum', 'mop', 11],
    ],
  );
  assert.equal(evaluateLockedInteractionPerformanceReport(valid).ok, true);

  const hiddenReset = validReport();
  const hiddenResetEvents = hiddenReset.scenarios
    .find(({ id }) => id === 'toolChanges20').events;
  hiddenResetEvents[0].discriminator.fromTool = 'empty-hands';
  hiddenResetEvents[0].discriminator.toTool = 'vacuum';
  assert.match(
    evaluateLockedInteractionPerformanceReport(hiddenReset).failures.join('\n'),
    /must continue the canonical production cycle trashbag -> empty-hands/,
  );

  const brokenBoundary = validReport();
  const brokenStress = brokenBoundary.scenarios
    .find(({ id }) => id === 'toolSwitches100Stress').events;
  brokenStress[0].discriminator.fromTool = 'trashbag';
  assert.match(
    evaluateLockedInteractionPerformanceReport(brokenBoundary).failures.join('\n'),
    /must continue the canonical production cycle vacuum -> mop/,
  );

  const skippedEdge = validReport();
  skippedEdge.scenarios.find(({ id }) => id === 'toolChanges20')
    .events[7].discriminator.productionEquipSequence += 1;
  assert.match(
    evaluateLockedInteractionPerformanceReport(skippedEdge).failures.join('\n'),
    /productionEquipSequence must be contiguous after the first-use chain/,
  );

  const wrongBinding = validReport();
  wrongBinding.scenarios.find(({ id }) => id === 'toolChanges20')
    .events[0].discriminator.equipKey = 'q';
  assert.match(
    evaluateLockedInteractionPerformanceReport(wrongBinding).failures.join('\n'),
    /must use the pinned first-use tool-belt binding/,
  );
});
