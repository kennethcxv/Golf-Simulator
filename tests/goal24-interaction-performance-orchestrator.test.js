import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';

import {
  GOAL24_ORCHESTRATOR_SCHEMA,
  REQUIRED_COLD_PROCESS_COUNT,
  aggregateLockedReport,
  assertRegularArtifactFile,
  bindColdContributionToRunner,
  bindFullContributionToRunner,
  buildRunPlan,
  compareMatrixFrameTiming,
  compareLockedEvaluationGates,
  executeRun,
  goal24RequiredTraceInteractionIds,
  loadCompletedReference,
  parseFinalJson,
  repositoryMetadata,
  publishAggregate,
  readGoal24ChromiumTraceArtifact,
  runOrchestrator,
  validateVideoContainer,
  validateColdDoorRouteParity,
  validateFullRunProtocol,
  validateMatrixRun,
  validateOverlayFrameEvidence,
  validateRawRun,
  validateComparisonProfileIsolation,
  validateAcceptedAggregateRawBindings,
  validateBaselineReferenceOutcome,
  validateContributionRawBindings,
  validateRunnerEnvelope,
} from '../tools/qa/goal24-interaction-performance.mjs';
import { LOCKED_INTERACTION_PERFORMANCE_PROTOCOL } from '../tools/qa/locked-performance-contract.mjs';
import {
  goal24TraceMarkName,
} from '../tools/qa/lib/goal24-trace-attribution.mjs';
import {
  GOAL24_SUPPORTED_TOOL_IDS,
  GOAL24_SUPPORTED_TOOL_MANIFEST,
} from '../tools/qa/lib/goal24-tool-manifest.mjs';
import {
  GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
  GOAL24_DOOR_ROUTE_SCHEMA,
  GOAL24_DOOR_SCENARIOS,
  summarizeGoal24DoorwayRenderEvidence,
} from '../tools/qa/lib/goal24-door-evidence.mjs';
import {
  goal24ResourceCheckpointFixture,
  goal24ResourceSnapshotFixture,
  goal24WorkloadContextFixture,
} from './helpers/goal24-resource-fixture.mjs';
import {
  goal24VisualEvidenceDigest,
  goal24VisualEvidencePayload,
  goal24VisualMarkerDefinition,
} from '../tools/qa/lib/goal24-visual-evidence.mjs';

test('default plan serializes seven fresh cold processes before the isolated full and diagnostic legs', () => {
  const plan = buildRunPlan({
    suite: 'full',
    phase: 'baseline',
    sessionId: 'unit-full',
  });
  assert.equal(plan.schema, GOAL24_ORCHESTRATOR_SCHEMA);
  assert.equal(plan.acceptanceEligible, true);
  assert.equal(plan.completeProtocol, true);
  assert.equal(plan.runs.length, 14);
  assert.deepEqual(plan.runs.slice(0, 7).map(({ leg }) => leg), Array(7).fill('cold'));
  assert.deepEqual(plan.runs.slice(0, 7).map(({ coldIndex }) => coldIndex), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(plan.runs.slice(0, 7).every((run) => (
    run.scenarios === 'door'
    && run.instrumentation === 'low-overhead'
    && run.width === 1920
    && run.height === 1080
    && run.mode === 'windowed'
    && run.env.GOAL24_PERF_SEED === '424242'
    && run.env.GOAL24_PERF_ROUTE === plan.pinned.route
    && run.env.GOAL24_PERF_CAMERA === plan.pinned.camera
    && run.env.QA_FORCE_DEVICE_SCALE_FACTOR === '1'
  )));
  assert.equal(new Set(plan.runs.map(({ id }) => id)).size, plan.runs.length);

  const full = plan.runs[7];
  assert.equal(full.leg, 'full');
  assert.match(full.scenarios, /ledger-stress/);
  assert.match(full.scenarios, /tool-stress/);
  assert.match(full.scenarios, /npc/);
  assert.equal(full.env.GOAL24_PERF_WALK_MS, '60000');

  const matrix = plan.runs.filter(({ leg }) => leg === 'matrix');
  assert.deepEqual(matrix.map(({ name, width, height, mode }) => ({ name, width, height, mode })), [
    { name: 'matrix-1080p-windowed', width: 1920, height: 1080, mode: 'windowed' },
    { name: 'matrix-1440p-windowed', width: 2560, height: 1440, mode: 'windowed' },
    { name: 'matrix-4k-windowed', width: 3840, height: 2160, mode: 'windowed' },
    { name: 'matrix-4k-fullscreen', width: 3840, height: 2160, mode: 'fullscreen' },
  ]);
  assert.ok(matrix.every((run) => run.scenarios === 'idle,indoor-walk,cap-ladder'));
  assert.ok(matrix.filter(({ mode }) => mode === 'windowed')
    .every((run) => run.env.GOAL24_PERF_MATRIX_RAW_WINDOW === '1'));
  assert.equal(matrix.find(({ mode }) => mode === 'fullscreen').env.GOAL24_PERF_MATRIX_RAW_WINDOW, '0');
  assert.deepEqual(plan.runs.slice(-2).map(({ instrumentation, gradeEligible }) => ({
    instrumentation,
    gradeEligible,
  })), [
    { instrumentation: 'cdp-trace', gradeEligible: false },
    { instrumentation: 'video', gradeEligible: false },
  ]);
});

test('smoke and leg filters are explicit non-acceptance plans', () => {
  const smoke = buildRunPlan({ suite: 'smoke', phase: 'baseline', sessionId: 'unit-smoke' });
  assert.equal(smoke.runs.length, 2);
  assert.equal(smoke.coldRuns, 1);
  assert.equal(smoke.acceptanceEligible, false);
  assert.equal(smoke.runs[1].env.GOAL24_PERF_WALK_MS, '5000');
  assert.doesNotMatch(smoke.runs[1].scenarios, /ledger-stress/);

  const filtered = buildRunPlan({
    suite: 'full',
    phase: 'baseline',
    sessionId: 'unit-filter',
    legs: 'matrix',
    matrixCases: '1080p-windowed',
  });
  assert.equal(filtered.runs.length, 1);
  assert.equal(filtered.runs[0].name, 'matrix-1080p-windowed');
  assert.equal(filtered.acceptanceEligible, false);
  assert.throws(
    () => buildRunPlan({ suite: 'full', phase: 'baseline', legs: 'cold,cold' }),
    /unique values/,
  );
});

test('final JSON parser tolerates runner diagnostics but fails closed on non-JSON', () => {
  const envelope = { runner: { schemaVersion: 'v1' }, result: { ok: true } };
  assert.deepEqual(parseFinalJson(`[qa] display readback\n${JSON.stringify(envelope, null, 2)}\n`), envelope);
  assert.throws(() => parseFinalJson('only diagnostics'), /parseable JSON envelope/);
  assert.throws(() => parseFinalJson(''), /stdout was empty/);
});

function runnerEnvelope(run, profile = 'C:/temp/profile-1') {
  const lockPath = `C:/temp/lock-${run.id}`;
  const launchId = `launch-${run.id}`;
  const processIdentity = {
    pid: 1234,
    creationTimeEpochMs: 1_000,
    creationTimeEpochUs: 1_000_000,
    type: 'Browser',
    name: 'Golf Flipper.exe',
    serviceName: null,
  };
  const playwrightProcessIdentity = {
    pid: 1222,
    parentPid: 4321,
    creationTimeEpochMs: 900,
    creationTimeEpochUs: 900_000,
    name: 'cmd.exe',
    executablePath: 'C:/Windows/System32/cmd.exe',
  };
  const readback = {
    main: { userDataPath: profile, process: processIdentity, processes: [processIdentity] },
  };
  return {
    electronArgs: ['.', '--clubhouse=pine-hills-v2', `--user-data-dir=${profile}`],
    result: { ok: true, runId: run.id },
    runner: {
      schemaVersion: 'golf-flipper/electron-runner/v1',
      repository: {
        launchLock: { path: lockPath, ownerPid: 4321, ownerLaunchId: launchId },
      },
      launch: {
        launchId,
        parentPid: 4321,
        electronPid: 1234,
        playwrightProcessPid: playwrightProcessIdentity.pid,
        playwrightProcessIdentity,
        electronMainProcessIdentity: processIdentity,
        processRelationship: {
          confirmed: true,
          kind: 'direct-shell-parent',
          playwrightProcessIdentity,
          electronMainProcessIdentity: processIdentity,
          electronMainOsIdentity: {
            pid: processIdentity.pid,
            parentPid: playwrightProcessIdentity.pid,
            creationTimeEpochMs: processIdentity.creationTimeEpochMs,
            creationTimeEpochUs: processIdentity.creationTimeEpochUs,
          },
        },
        runtimeVersions: {
          electron: '37.0.0', chrome: '138.0.0.0', node: '22.16.0', v8: '13.8.0',
        },
      },
      readbacks: {
        beforeDriver: structuredClone(readback),
        driverSnapshots: [],
        afterDriver: structuredClone(readback),
      },
      processes: {
        initialSnapshot: { browserIdentity: processIdentity },
        initialOsAttestation: { confirmed: true },
      },
      diagnostics: { pageErrors: [], consoleErrors: [] },
      profile: {
        mode: 'isolated-temporary',
        generated: true,
        matchesPinnedPath: true,
        path: profile,
        actualPath: profile,
        profileId: `profile-${run.id}`,
      },
      instrumentation: {
        mode: run.instrumentation,
        lowOverheadEligible: run.instrumentation === 'low-overhead',
      },
      cachePolicy: {
        userData: 'fresh-empty-temporary-profile',
        chromiumDiskCache: 'fresh-with-generated-profile',
        gpuDriverShaderCache: 'host-managed-not-cleared',
        warmProfileReuse: 'disabled-by-default',
      },
      timing: {
        anchors: {
          electronLaunchRequested: { epochMs: 1 },
          driverComplete: { epochMs: 9 },
          runnerCleanupComplete: { epochMs: 10 },
        },
      },
      cleanup: {
        electronApplication: {
          closed: true,
          confirmedExited: true,
          processTree: {
            snapshotCaptured: true,
            identityCount: 2,
            preCloseAttestation: { confirmed: true },
            exitSnapshot: { processes: [processIdentity, playwrightProcessIdentity] },
            verification: { confirmedExited: true },
            confirmedExited: true,
          },
        },
        profile: {
          path: profile,
          action: 'remove-generated-leaf',
          removed: true,
          existsAfterCleanup: false,
        },
        launchLock: { path: lockPath, released: true, existsAfterCleanup: false },
      },
    },
  };
}

test('runner validation proves fresh profile, application, profile, and launch-lock teardown', () => {
  const run = { id: 'cold-1', instrumentation: 'low-overhead' };
  const profiles = new Set();
  validateRunnerEnvelope(runnerEnvelope(run), run, { profilePaths: profiles });
  assert.equal(profiles.size, 1);
  assert.throws(
    () => validateRunnerEnvelope(runnerEnvelope({ ...run, id: 'cold-2' }), { ...run, id: 'cold-2' }, { profilePaths: profiles }),
    /profile was reused/,
  );
  const leaked = runnerEnvelope(run, 'C:/temp/profile-leaked');
  leaked.runner.cleanup.launchLock.existsAfterCleanup = true;
  assert.throws(() => validateRunnerEnvelope(leaked, run), /lock remains/);
  const notOk = runnerEnvelope(run, 'C:/temp/profile-not-ok');
  notOk.result.ok = false;
  assert.throws(() => validateRunnerEnvelope(notOk, run), /ok:false/);
  const wrongLockOwner = runnerEnvelope(run, 'C:/temp/profile-wrong-lock-owner');
  wrongLockOwner.runner.repository.launchLock.ownerPid += 1;
  assert.throws(() => validateRunnerEnvelope(wrongLockOwner, run), /launch-lock owner/);
  const driftedMain = runnerEnvelope(run, 'C:/temp/profile-drifted-main');
  driftedMain.runner.readbacks.afterDriver.main.process.creationTimeEpochMs += 1;
  assert.throws(() => validateRunnerEnvelope(driftedMain, run), /PID\/start token drifted/);
});

test('raw validation pins route, camera, physical 1080p DPR1, quality, and teardown controls', () => {
  const plan = buildRunPlan({
    suite: 'full',
    phase: 'baseline',
    sessionId: 'raw-pins',
    legs: 'cold',
    coldRuns: 7,
  });
  const run = plan.runs[0];
  const raw = {
    runId: run.id,
    instrumentationMode: 'low-overhead',
    seed: 424242,
    resultPath: 'qa/raw.json',
    controls: {
      hardwareRenderer: true,
      startGameOccurred: true,
      noPageErrors: true,
      noConsoleErrors: true,
      rendererAndDisplayStreamsPresent: true,
      recorderUninstalled: true,
    },
    recorderCalibration: {
      inactiveIsInert: true,
      activeP95OverheadWithinTolerance: true,
    },
    protocolPins: {
      seed: 424242,
      clubhouse: 'pine-hills-v2',
      saveFixture: plan.pinned.saveFixture,
      route: plan.pinned.route,
      camera: plan.pinned.camera,
      toolManifest: structuredClone(GOAL24_SUPPORTED_TOOL_MANIFEST),
      resolution: { width: 1920, height: 1080 },
      windowMode: 'windowed',
      quality: { preset: 'high', renderScale: 1, shadows: true, ambientOcclusion: true, bloom: true },
      cache: {
        shaderCache: 'host-managed-not-cleared',
        gpuDriverCache: 'host-managed-not-cleared',
        userDataPolicy: 'isolated-fresh-per-cold-process',
      },
    },
  };
  const envelope = {
    result: { resultPath: 'qa/raw.json' },
    runner: {
      readbacks: {
        afterDriver: {
          main: { window: { mode: 'windowed' } },
          renderer: {
            viewport: { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 },
            renderer: {
              canvasBacking: { width: 1920, height: 1080 },
              webgl: { drawingBuffer: { width: 1920, height: 1080 } },
              pixelRatio: 1,
            },
            quality: {
              quality: 'high', renderScale: 1, shadows: true, ambientOcclusion: true, bloom: true,
            },
          },
        },
      },
    },
  };
  assert.equal(validateRawRun(raw, envelope, run), true);
  envelope.runner.readbacks.afterDriver.renderer.viewport.devicePixelRatio = 1.25;
  assert.throws(() => validateRawRun(raw, envelope, run), /physical viewport|DPR 1/);
});

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
  const navCreatedAtMs = Math.max(0, lifecycleAtMs - 50);
  const navCreateDurationMs = 4.25;
  const colliderVersion = 11;
  const rebuildDurationMs = 2.5;
  const navPerformanceBefore = {
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
  const navPerformanceAfter = {
    ...navPerformanceBefore,
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
  const navPerformanceAtObservation = {
    ...navPerformanceAfter,
    capturedAtMs: routeResolvedAtMs + 0.5,
  };
  delete navPerformanceAtObservation.routeRequestId;
  delete navPerformanceAtObservation.customerId;
  delete navPerformanceAtObservation.lifecycleBoundaryId;
  return {
    sceneLoaded: true,
    sceneLoadedAtMs: navCreatedAtMs,
    navCreateDurationMs,
    navPerformanceBefore,
    navPerformanceAfter,
    navPerformanceAtObservation,
    navPerformanceDelta: {
      navFreshCallCount: 1,
      navRebuildCount: 1,
      navRebuildTotalDurationMs: rebuildDurationMs,
    },
    lifecycleWindowStartedAtMs: lifecycleAtMs,
    routeRequestedAtMs,
    routeResolvedAtMs,
  };
}

function lockedDiscriminator(id, index, temperature, runId, startAt = index * 100) {
  const doorRoute = (routeKind, side, distance, finishSide = side) => {
    const startZ = side === 'outside' ? 20 + distance : 20 - distance;
    const finishZ = routeKind === 'approach'
      ? 21.7
      : finishSide === 'outside' ? 22 : 18;
    const camera = (z) => ({
      x: 40, y: 1.7, z, qx: 0, qy: 1, qz: 0, qw: 0, fov: 60, aspect: 16 / 9,
    });
    const pathSamples = Array.from({ length: 5 }, (_, pathIndex) => {
      const alpha = pathIndex / 4;
      const z = startZ + (finishZ - startZ) * alpha;
      return {
        ordinal: pathIndex + 1, atMs: startAt + pathIndex * 5,
        x: 40, z, distanceToDoor: Math.abs(z - 20), inside: z < 20,
      };
    });
    const startedDetailed = routeKind === 'inside-out';
    const endedDetailed = routeKind === 'outside-in';
    const startSequence = routeKind === 'inside-out' ? 1 : 0;
    const endSequence = routeKind === 'approach' ? startSequence : startSequence + 1;
    const detailVisibilityTransition = routeKind === 'approach' ? null : {
      sequence: endSequence,
      atMs: startAt + (routeKind === 'outside-in' ? 3 : 18),
      from: startedDetailed,
      to: endedDetailed,
      cameraLocalX: 0,
      cameraLocalZ: routeKind === 'outside-in' ? 5.6 : 7.1,
      exteriorDistanceYards: routeKind === 'outside-in' ? 1.45 : 1.55,
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
    return {
      schema: GOAL24_DOOR_ROUTE_SCHEMA,
      routeKind,
      detailClearanceYards: GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
      startPose: {
        x: 40,
        z: startZ,
        yaw: side === 'outside' ? Math.PI : 0,
        pitch: -0.05,
      },
      target: { x: 40, z: 20 },
      normal: { x: 0, z: 1 },
      startCameraPose: camera(startZ),
      finishPosition: { x: 40, z: finishZ },
      finishCameraPose: camera(finishZ),
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
  };
  switch (id) {
    case 'coldLaunch': return {
      processInstanceId: runId,
      userDataProfileId: `profile-${runId}`,
      userDataDirectory: `C:/isolated/${runId}`,
      freshProcess: true,
      mainMenuInteractive: true,
      shaderCachePolicy: 'host-managed-not-cleared',
      gpuCachePolicy: 'fresh-with-generated-profile',
    };
    case 'startToControllable': return {
      processInstanceId: runId,
      menuControl: 'New Game',
      controlActivated: true,
      gameplayControllable: true,
      movementProbeAccepted: true,
      instrumentationReadyBeforeControl: true,
      firstControllableDisplayBoundaryObserved: true,
      firstControllableRenderObserved: true,
      instrumentationReadyAtMs: startAt,
      renderInstrumentationAttachedAtMs: startAt + 1,
      renderCadenceMeasurementStartedAtMs: startAt + 3,
      firstControllableRenderAtMs: startAt + 15,
      firstControllableDisplayBoundaryAtMs: startAt + 24,
      menuControlConsumedAtMs: startAt + 1,
      candidateControllableRenderAtMs: startAt + 2,
      candidateControllableDisplayBoundaryAtMs: startAt + 6,
      confirmedControllableRenderAtMs: startAt + 15,
      confirmedControllableDisplayBoundaryAtMs: startAt + 24,
      movementProbe: {
        key: 'w',
        displacement: 0.5,
        observedAtMs: startAt + 12,
        confirmationRequestedAtMs: startAt + 13,
        request: {
          atMs: startAt + 5, kind: 'keyboard', control: 'w',
          source: 'driver-immediately-before-Playwright-movement-probe-keydown',
          detail: { action: 'down', phase: 'movement-probe', scenario: 'startToControllable' },
        },
        delivery: {
          type: 'keydown', isTrusted: true, key: 'w', code: 'KeyW', atMs: startAt + 6,
        },
        consumed: {
          signal: 'shipping-walk-held-key-set', productionHandlerObserved: true,
          atMs: startAt + 7,
        },
      },
    };
    case 'doorApproach': return {
      doorId: 'clubhouse-main-door',
      processInstanceId: runId,
      freshProcess: temperature === 'cold',
      startZone: 'outside',
      endZone: 'outside',
      startDistanceYards: 6.5,
      thresholdCrossed: true,
      endedOutside: true,
      routeSignature: doorRoute('approach', 'outside', 6.5),
    };
    case 'doorFirstOpen': return {
      doorId: 'clubhouse-main-door',
      processInstanceId: runId,
      freshProcess: true,
      focusTargetDoorId: 'clubhouse-main-door',
      interactKey: 'e',
      desiredState: 'open',
      desiredStateApplied: true,
      opened: true,
      openSwingObserved: true,
      openSwingRadians: 0.75,
      productionDoorSignal: 'production-handler:doorFirstOpen',
      productionDoorSignalAtMs: startAt + 1,
      productionHandlerConsumed: {
        signal: 'production-handler:doorFirstOpen', atMs: startAt + 1,
      },
      outcomeObservedAtMs: startAt + 20,
      productionOutcomeMarkerAtMs: startAt + 21,
      contractOutcomeMarkerAtMs: startAt + 24,
    };
    case 'doorCrossingOutsideToInside': {
      const routeSignature = doorRoute('outside-in', 'outside', 2, 'inside');
      const detailVisibilityTransition = routeSignature.runtimeEnd
        .lastDetailVisibilityTransition;
      return {
        doorId: 'clubhouse-main-door', processInstanceId: runId,
        freshProcess: temperature === 'cold',
        fromZone: 'outside', toZone: 'inside', boundaryCrossed: true, normalMovement: true,
        noPriorInteriorThresholdCrossing: temperature === 'cold',
        interiorVisibilityObserved: true,
        productionVisibilityMarker: 'assets51to100-detail-visibility-false-to-true',
        productionVisibilityAtMs: detailVisibilityTransition.atMs,
        detailVisibilityTransition: structuredClone(detailVisibilityTransition),
        detailVisibilitySequenceDelta: routeSignature.runtimeEnd.detailVisibilitySequence
          - routeSignature.runtimeStart.detailVisibilitySequence,
        routeSignature,
      };
    }
    case 'doorCrossingInsideToOutside': return {
      doorId: 'clubhouse-main-door', fromZone: 'inside', toZone: 'outside', boundaryCrossed: true, normalMovement: true,
      routeSignature: doorRoute('inside-out', 'inside', 2, 'outside'),
    };
    case 'ledgerOpen': return {
      fromState: 'closed', toState: 'open', readable: true, ledgerOwnsInput: true, firstOpen: temperature === 'cold',
      entryKey: 'k', interactKey: 'e',
      entryModeConsumed: { signal: 'shipping-ledger-entry-mode', atMs: startAt + 3 },
      productionHandlerConsumed: {
        signal: 'shipping-ledger-cover-opened', atMs: startAt + 6,
      },
    };
    case 'ledgerPageTurns10':
    case 'ledgerTurns50Stress': return {
      direction: index % 2 === 0 ? 'right' : 'left',
      fromPage: index % 2,
      toPage: (index + 1) % 2,
      bookAlreadyOpen: true,
      contentReady: true,
    };
    case 'ledgerClose': return { fromState: 'open', toState: 'walking', walkControlRestored: true };
    case 'toolChanges20':
    case 'toolSwitches100Stress': {
      const tools = GOAL24_SUPPORTED_TOOL_IDS;
      const cycle = ['empty-hands', ...tools];
      const globalIndex = id === 'toolChanges20' ? index : 20 + index;
      const fromTool = globalIndex === 0
        ? tools.at(-1)
        : cycle[(globalIndex - 1) % cycle.length];
      return {
        processInstanceId: runId,
        fromTool,
        toTool: cycle[globalIndex % cycle.length],
        equipKey: 'f',
        changed: true,
        viewmodelReady: true,
        firstUse: false,
        productionEquipSequence: tools.length + globalIndex + 1,
        productionEquipSignal: 'shipping-walk-toolChanged-edge',
        productionEquipAtMs: startAt + 1,
      };
    }
    case 'toolFirstUseByTool': {
      const tools = GOAL24_SUPPORTED_TOOL_IDS;
      const toolId = tools[index];
      return {
        toolId,
        supportedToolIds: tools,
        processInstanceId: runId,
        fromTool: index === 0 ? 'empty-hands' : tools[index - 1],
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
        productionEquipAtMs: startAt + 1,
        productionHandlerConsumed: {
          signal: 'shipping-walk-toolChanged-edge', atMs: startAt + 1,
        },
        outcomeObservedAtMs: startAt + 20,
        productionOutcomeMarkerAtMs: startAt + 21,
        contractOutcomeMarkerAtMs: startAt + 24,
      };
    }
    case 'npcNavActivation': {
      const routeRequestId = `route-${runId}-${index}`;
      const customerId = `customer-${runId}-${index}`;
      const lifecycleBoundaryId = `organic-footfall-${runId}-${index}`;
      const navEvidence = npcNavigationEvidence(startAt, startAt + 2, startAt + 20, {
        routeRequestId,
        customerId,
        lifecycleBoundaryId,
      });
      return {
      customerActivated: true,
      customerCreated: true,
      routeRequested: true,
      routeResolved: true,
      routeRequestId,
      ...navEvidence,
      lifecycleBoundaryId,
      lifecycleBoundaryAtMs: startAt - 0.1,
      lifecycleMeasurementBoundary: {
        label: 'organic-footfall-window-start',
        atMs: startAt,
        priorDisplayBoundaryMs: startAt - 3,
        priorRenderBoundaryMs: startAt - 3,
      },
      customerId,
      lifecycleObserved: {
        customerId,
        spawnSource: 'organic-footfall',
        lifecycleBoundaryId,
        lifecycleBoundaryAtMs: startAt - 0.1,
        boundaryObservation: {
          boundary: {
            schemaVersion: 1,
            eventType: 'organic-customer-lifecycle-window-start',
            lifecycleId: lifecycleBoundaryId,
            atMs: startAt - 0.1,
            source: 'shipping-organic-footfall-loop',
            spawnSource: 'organic-footfall',
          },
          measurementBoundary: {
            label: 'organic-footfall-window-start',
            atMs: startAt,
            priorDisplayBoundaryMs: startAt - 3,
            priorRenderBoundaryMs: startAt - 3,
          },
          observedAtMs: startAt + 0.1,
        },
        signal: 'shipping-organic-footfall-customer-created',
      },
      routeObserved: {
        atMs: startAt + 21,
        customerId,
        navPerformance: structuredClone(navEvidence.navPerformanceAtObservation),
        route: {
          requestId: routeRequestId,
          customerId,
          requestedAtMs: startAt + 2,
          resolvedAtMs: startAt + 20,
          pathNodes: 1,
          spawnSource: 'organic-footfall',
          lifecycleBoundaryId,
          lifecycleBoundaryAtMs: startAt - 0.1,
          navPerformanceAtResolution: structuredClone(navEvidence.navPerformanceAfter),
        },
      },
      productionHandlerConsumed: {
        signal: 'shipping-navFresh-path-request-for-same-organic-customer', atMs: startAt + 2,
      },
      outcomeObservedAtMs: startAt + 21,
      productionOutcomeMarkerAtMs: startAt + 22,
      contractOutcomeMarkerAtMs: startAt + 24,
      directSpawnUsed: false,
      };
    }
    default: throw new Error(`Missing locked discriminator for ${id}`);
  }
}

test('start recorder resolves a nested click target to its exact button control', async () => {
  const source = fs.readFileSync(
    path.resolve('tools/qa/lib/goal24-interaction-recorder.mjs'), 'utf8',
  );
  assert.match(source, /target\.closest\('button,\[role="button"\]'\)/);
  assert.match(source, /closest-interactive-control-from-native-event-target/);
});

function attachDoorwayRenderFixture(event) {
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

function lockedEvent(spec, index, temperature, runId, baseAt = 0) {
  const startAt = baseAt + index * 100;
  const processTrigger = spec.triggerEvidencePolicy === 'launcher-process';
  const lifecycle = spec.triggerEvidencePolicy === 'production-lifecycle';
  const pointer = spec.id === 'startToControllable';
  const recordId = `${spec.id}-${runId}-${index + 1}`;
  const trustedControl = spec.id === 'doorFirstOpen' ? 'door-interact-binding'
    : spec.id === 'toolFirstUseByTool' || spec.id === 'toolChanges20'
      || spec.id === 'toolSwitches100Stress' ? 'tool-belt-binding'
      : spec.id === 'ledgerOpen' ? 'ledger-raise-and-cover-open-sequence'
        : 'production-binding';
  const cadenceMeasured = spec.cadencePolicy !== 'duration-only-before-page-context';
  const displayFrameIntervalsMs = cadenceMeasured ? [6, 6, 6, 6, 3] : [];
  const renderFrameIntervalsMs = cadenceMeasured ? [6, 6, 6, 6, 3] : [];
  const endpoints = (values, firstBoundaryAtMs = startAt - 3) => {
    let cursor = firstBoundaryAtMs;
    return values.map((durationMs) => {
      const startAtMs = cursor;
      cursor += durationMs;
      return { startAtMs, endAtMs: cursor, durationMs };
    });
  };
  const discriminator = lockedDiscriminator(spec.id, index, temperature, runId, startAt);
  if (!processTrigger && !lifecycle) {
    discriminator.productionHandlerConsumed ??= {
      signal: discriminator.productionEquipSignal || `production-handler:${spec.id}`,
      atMs: startAt + 1,
    };
    discriminator.outcomeObservedAtMs ??= startAt + 20;
    discriminator.productionOutcomeMarkerAtMs ??= startAt + 21;
    discriminator.contractOutcomeMarkerAtMs ??= startAt + 24;
  }
  const event = {
    scenarioId: spec.id,
    sequence: index + 1,
    temperature,
    input: {
      recordId,
      kind: processTrigger ? 'process' : lifecycle ? 'lifecycle' : pointer ? 'pointer' : 'keyboard',
      control: processTrigger ? 'electron-launch' : lifecycle ? 'first-customer-route'
        : pointer ? 'new-game-button' : trustedControl,
      delivery: processTrigger ? 'electron-main-process' : lifecycle ? 'production-lifecycle-observer' : pointer ? 'playwright-pointer' : 'playwright-keyboard',
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
        display: { status: 'unavailable', reason: 'renderer did not exist before menu' },
        render: { status: 'unavailable', reason: 'renderer did not exist before menu' },
      }
      : {
        display: {
          status: 'measured', priorBoundaryAtMs: startAt - 3,
          priorBoundarySource: 'test-recorder-previous-display-boundary',
        },
        render: {
          status: 'measured',
          priorBoundaryAtMs: spec.id === 'startToControllable' ? startAt + 3 : startAt - 3,
          priorBoundarySource: spec.id === 'startToControllable'
            ? 'first observed shipping scene3d.render boundary after render instrumentation attached'
            : 'test-recorder-previous-production-render-boundary',
          ...(spec.id === 'startToControllable' ? {
            measurementStartedAtMs: startAt + 3,
            preMeasurementReason: 'shipping scene3d.render did not exist before this timestamp',
          } : {}),
        },
      },
    displayFrameIntervalsMs,
    displayCadenceIntervals: endpoints(displayFrameIntervalsMs),
    renderFrameIntervalsMs,
    renderCadenceIntervals: endpoints(
      renderFrameIntervalsMs,
      spec.id === 'startToControllable' ? startAt + 3 : startAt - 3,
    ),
    sampleCoverage: {
      complete: true,
      droppedDisplaySamples: 0,
      droppedRenderSamples: 0,
      droppedSubmissionSamples: 0,
      windowDurationMs: 24,
      displayFirstBoundaryOffsetMs: cadenceMeasured ? 3 : null,
      displayLastBoundaryBeforeEndMs: cadenceMeasured ? 0 : null,
      renderFirstBoundaryOffsetMs: cadenceMeasured ? 3 : null,
      renderLastBoundaryBeforeEndMs: cadenceMeasured ? 0 : null,
      ...(cadenceMeasured ? {
        measurementPriorDisplayBoundaryMs: startAt - 3,
        measurementPriorRenderBoundaryMs: spec.id === 'startToControllable'
          ? startAt + 3 : startAt - 3,
      } : {}),
    },
    discriminator,
  };
  if (spec.id === 'startToControllable') {
    event.traceIdentity = { id: 'start-game-1', scenario: 'startGame' };
    event.renderFrameIntervalsMs = [6, 6];
    event.renderCadenceIntervals = endpoints(event.renderFrameIntervalsMs, startAt + 3);
    event.sampleCoverage.renderLastBoundaryBeforeEndMs = 9;
  }
  if (GOAL24_DOOR_SCENARIOS.includes(spec.id)) attachDoorwayRenderFixture(event);
  const raw = processTrigger
    ? {
      eventType: 'process-spawn', target: 'electron-main-process', source: 'qa-runner-process-spawn-anchor',
      isTrusted: null, trustBasis: 'launcher-process-anchor', atMs: startAt,
    }
    : lifecycle
      ? {
        eventType: 'customer-route-resolved', target: 'clubhouse.customer-lifecycle',
        source: 'production-customer-lifecycle-observer', isTrusted: null,
        trustBasis: 'production-lifecycle-observation', atMs: startAt,
      }
      : pointer
        ? {
          eventType: 'click', target: '#new-game', source: 'capturing-DOM-input-listener',
          isTrusted: true, trustBasis: 'browser-isTrusted', atMs: startAt,
          eventTimestampMs: startAt, observedAtMs: startAt, clientX: 960, clientY: 540, button: 0,
        }
        : {
          eventType: spec.id === 'toolFirstUseByTool' || spec.id === 'toolChanges20'
            || spec.id === 'toolSwitches100Stress' ? 'keyup' : 'keydown',
          target: 'document.activeElement', source: 'capturing-DOM-input-listener',
          isTrusted: true, trustBasis: 'browser-isTrusted', atMs: startAt,
          eventTimestampMs: startAt, observedAtMs: startAt,
          code: spec.id === 'toolFirstUseByTool' || spec.id === 'toolChanges20'
            || spec.id === 'toolSwitches100Stress' ? 'KeyF' : 'KeyE',
          key: spec.id === 'toolFirstUseByTool' || spec.id === 'toolChanges20'
            || spec.id === 'toolSwitches100Stress' ? 'f' : 'e',
        };
  const consumedSignal = discriminator.productionHandlerConsumed?.signal
    || discriminator.productionEquipSignal
    || `production-handler:${spec.id}`;
  const consumedAtMs = discriminator.productionHandlerConsumed?.atMs ?? startAt + 1;
  return {
    event,
    record: {
      recordId,
      scenarioId: spec.id,
      eventSequence: index + 1,
      clock: spec.markerClock,
      requestedAtMs: startAt,
      deliveredAtMs: startAt,
      request: {
        atMs: startAt,
        source: processTrigger ? 'qa-runner-process-spawn-anchor'
          : lifecycle ? 'production-customer-lifecycle-observer'
            : pointer ? 'driver-immediately-before-Playwright-primary-menu-click'
              : 'driver-immediately-before-Playwright-input-call',
        kind: event.input.kind,
        actualControl: pointer ? 'New Game' : raw.key || event.input.control,
        action: pointer ? 'click' : raw.eventType === 'keyup' ? 'up' : 'down',
        scenarioId: spec.id,
        rawScenario: spec.id,
      },
      kind: event.input.kind,
      control: event.input.control,
      delivery: event.input.delivery,
      evidencePolicy: event.input.evidencePolicy,
      raw,
      consumed: { signal: consumedSignal, productionHandlerObserved: true, atMs: consumedAtMs },
      outcome: {
        signal: `observed:${spec.markerNames[1]}`,
        observationSource: 'independent-state-and-render-probe',
        observed: true,
        markerName: spec.markerNames[1],
        atMs: startAt + 24,
      },
    },
  };
}

function lockedResources(scenarioId, iterations) {
  return {
    rawSource: {
      scenario: scenarioId === 'ledgerTurns50Stress' ? 'ledgerStress' : 'toolStress',
    },
    samples: [0, 0.2, 0.4, 0.6, 0.8, 1].map((fraction, index) => structuredClone(
      goal24ResourceCheckpointFixture({
        iteration: Math.round(iterations * fraction),
        elapsedMs: index * 1000,
        label: `${scenarioId}-resource-${Math.round(iterations * fraction)}`,
        capturedAt: `2026-08-11T20:00:${String(index).padStart(2, '0')}.000Z`,
        heapUsedBytes: [100000, 101000, 99000, 100500, 99500, 100000][index],
        listenerCount: 60,
      }),
    )),
  };
}

function replaceLockedResourceSnapshot(checkpoint, overrides = {}) {
  const current = checkpoint.snapshot;
  const metrics = current.metrics;
  checkpoint.snapshot = structuredClone(goal24ResourceSnapshotFixture({
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

function lockedEnvironment(processInstanceId = 'full-process') {
  const protocol = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL;
  return {
    toolManifest: structuredClone(GOAL24_SUPPORTED_TOOL_MANIFEST),
    renderer: { name: 'THREE.WebGLRenderer', api: 'WebGL2', version: 'Three r185', hardwareAccelerated: true, contextLost: false },
    gpu: { vendor: 'GPU vendor', renderer: 'GPU renderer', backend: 'D3D11' },
    window: { innerWidth: 1920, innerHeight: 1080, outerWidth: 1920, outerHeight: 1080, mode: 'windowed', focused: true, visible: true },
    devicePixelRatio: 1,
    quality: { preset: 'high', renderScale: 1, shadows: true, ambientOcclusion: true, bloom: true },
    profile: {
      name: 'goal24-unified-interaction', saveFixture: 'relaxed-seed-424242',
      cameraRoute: 'goal24-indoor-route-v1', userDataDirectory: 'C:/isolated/full',
      userDataPolicy: 'isolated-fresh-per-cold-process', coldRunProfileRoot: 'C:/isolated',
      shaderCachePolicy: 'host-managed-not-cleared', gpuCachePolicy: 'fresh-with-generated-profile', seed: 424242,
      processInstanceId,
      userDataProfileId: `profile-${processInstanceId}`,
      electronLaunchRequestedAtEpochMs: 1_000,
      supportedToolIds: [...GOAL24_SUPPORTED_TOOL_IDS],
    },
    instrumentation: {
      mode: 'low-overhead', gradeEligible: true,
      displayCadenceSource: protocol.cadence.display, renderCadenceSource: protocol.cadence.render,
      runtimeClock: protocol.cadence.runtimeClock, launcherClock: protocol.cadence.launcherClock,
      tracing: false, overlay: false, video: false, gcBeforeResourceCheckpoint: true,
      clockBridge: {
        domain: 'unix-epoch-milliseconds',
        source: 'renderer epoch sample bounded by runner capture bracket',
        captureStartedAtEpochMs: 1_000,
        rendererSampledAtEpochMs: 1_000.5,
        captureCompletedAtEpochMs: 1_001,
        maximumUncertaintyMs: 1,
      },
    },
  };
}

function exactContribution(runId, ids, { cold = false, full = false } = {}) {
  const scenarios = [];
  const inputRecords = [];
  for (const id of ids) {
    const spec = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios.find((candidate) => candidate.id === id);
    let temperatures;
    if (cold && id === 'doorApproach') temperatures = ['cold', 'warm', 'warm', 'warm'];
    else if (cold && id === 'doorFirstOpen') temperatures = ['cold'];
    else if (cold && id === 'doorCrossingOutsideToInside') {
      temperatures = ['cold', 'warm', 'warm', 'warm'];
    } else if (cold && id === 'doorCrossingInsideToOutside') {
      temperatures = ['warm', 'warm', 'warm'];
    }
    else if (cold && (id === 'coldLaunch' || id === 'startToControllable')) temperatures = ['cold'];
    else if (cold) temperatures = ['warm'];
    else {
      const count = spec.eventCount.matchesEnvironmentToolIds
        ? GOAL24_SUPPORTED_TOOL_IDS.length : spec.eventCount.exact ?? spec.eventCount.minimum;
      temperatures = Array.from({ length: count }, (_, index) => (
        spec.temperature.policy === 'cold-only'
          || (spec.temperature.policy === 'cold-then-warm' && index === 0) ? 'cold' : 'warm'
      ));
    }
    const scenarioIndex = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.indexOf(id);
    const pairs = temperatures.map((temperature, index) => lockedEvent(
      spec, index, temperature, runId, scenarioIndex * 10_000,
    ));
    const scenario = { id, events: pairs.map(({ event }) => event) };
    if (spec.stress) scenario.resources = lockedResources(spec.id, spec.stress.iterations);
    scenarios.push(scenario);
    inputRecords.push(...pairs.map(({ record }) => record));
  }
  return {
    provenance: {
      sourceRunId: runId, instrumentationMode: 'low-overhead', lowOverheadEligible: true,
      hardwareRenderer: true, recorderCalibrationPass: true,
    },
    scenarios,
    inputRecords,
    ...(full ? {
      environment: lockedEnvironment(runId),
      resourceBaseline: {
        iteration: 0,
        elapsedMs: 0,
        snapshot: structuredClone(goal24ResourceSnapshotFixture({
          label: 'run-resource-baseline',
          capturedAt: '2026-08-11T19:59:58.000Z',
          listenerCount: 60,
        })),
      },
      resourceFinal: {
        iteration: 1,
        elapsedMs: 120_000,
        snapshot: structuredClone(goal24ResourceSnapshotFixture({
          label: 'run-resource-final',
          capturedAt: '2026-08-11T20:02:00.000Z',
          listenerCount: 60,
        })),
      },
      negativeControl: {
        kind: 'busy-main-thread-stall', injectedDurationMs: 80, sameInstrumentation: true,
        busyLoopElapsedMs: 81,
        markers: {
          start: { name: 'busy-stall-begin', clock: 'renderer', atMs: 5000 },
          end: { name: 'busy-stall-end', clock: 'renderer', atMs: 5081 },
        },
        displayFrameIntervalsMs: [16, 82, 16],
        renderFrameIntervalsMs: [16, 81, 16],
        displayCadenceIntervals: [
          { startAtMs: 4984, endAtMs: 5000, durationMs: 16 },
          { startAtMs: 5000, endAtMs: 5082, durationMs: 82 },
          { startAtMs: 5082, endAtMs: 5098, durationMs: 16 },
        ],
        renderCadenceIntervals: [
          { startAtMs: 4984, endAtMs: 5000, durationMs: 16 },
          { startAtMs: 5000, endAtMs: 5081, durationMs: 81 },
          { startAtMs: 5081, endAtMs: 5097, durationMs: 16 },
        ],
      },
    } : {}),
  };
}

const EXACT_RAW_SCENARIO = {
  coldLaunch: 'coldLaunch',
  startToControllable: 'startGame',
  doorApproach: 'doorApproach',
  doorFirstOpen: 'doorOpen',
  doorCrossingOutsideToInside: 'doorCrossing:outside-in',
  doorCrossingInsideToOutside: 'doorCrossing:inside-out',
  ledgerOpen: 'ledgerOpen',
  ledgerPageTurns10: 'ledgerPageTurn',
  ledgerClose: 'ledgerClose',
  toolFirstUseByTool: 'toolFirstUse',
  toolChanges20: 'toolSwitch',
  npcNavActivation: 'npcNavActivation',
  ledgerTurns50Stress: 'ledgerPageTurnStress',
  toolSwitches100Stress: 'toolSwitchStress',
};

function exactRawRun(runId, ids, options = {}) {
  const contractContribution = exactContribution(runId, ids, options);
  const raw = {
    runId,
    instrumentationMode: 'low-overhead',
    controls: { hardwareRenderer: true },
    recorderCalibration: {
      inactiveIsInert: true,
      activeP95OverheadWithinTolerance: true,
    },
    scenarios: {},
    contractContribution,
  };
  const records = new Map(contractContribution.inputRecords.map((record) => [record.recordId, record]));
  const target = { tag: 'canvas', id: 'game-canvas', classes: [], role: null, ariaLabel: null, dataQa: null };
  const recorderMarkers = (event, discriminator) => {
    const display = event.displayCadenceIntervals;
    const render = event.renderCadenceIntervals;
    const snapshot = {
      atMs: event.markers.end.atMs,
      displayCount: display.length,
      renderCount: render.length,
      submissionCount: 0,
      displayDropped: event.sampleCoverage.droppedDisplaySamples,
      renderDropped: event.sampleCoverage.droppedRenderSamples,
      submissionDropped: event.sampleCoverage.droppedSubmissionSamples,
      renderStarts: render.length,
      firstDisplayBoundaryMs: display[0]?.endAtMs ?? null,
      lastDisplayBoundaryMs: display.at(-1)?.endAtMs ?? null,
      firstRenderBoundaryMs: render[0]?.endAtMs ?? null,
      lastRenderBoundaryMs: render.at(-1)?.endAtMs ?? null,
    };
    const lifecycleBoundary = discriminator.lifecycleMeasurementBoundary;
    return [
      {
        label: lifecycleBoundary?.label
          || 'measurement-armed-after-three-production-renders',
        atMs: event.markers.start.atMs,
        detail: {
          priorDisplayBoundaryMs: event.sampleCoverage.measurementPriorDisplayBoundaryMs,
          priorRenderBoundaryMs: event.sampleCoverage.measurementPriorRenderBoundaryMs,
        },
        ...(lifecycleBoundary ? {
          cadenceSnapshot: {
            atMs: event.markers.start.atMs,
            displayCount: 0,
            renderCount: 0,
            submissionCount: 0,
            displayDropped: 0,
            renderDropped: 0,
            submissionDropped: 0,
            renderStarts: 0,
            renderFrameEvidenceCount: 0,
            firstDisplayBoundaryMs: null,
            lastDisplayBoundaryMs: null,
            firstRenderBoundaryMs: null,
            lastRenderBoundaryMs: null,
          },
        } : {}),
      },
      {
        label: 'production-outcome-observed',
        atMs: discriminator.productionOutcomeMarkerAtMs,
        detail: {
          sourceObservedAtMs: discriminator.outcomeObservedAtMs,
          productionConsumptionAtMs: discriminator.productionHandlerConsumed.atMs,
        },
      },
      {
        label: 'post-outcome-render-boundary',
        atMs: event.markers.end.atMs,
        detail: { ok: true },
        cadenceSnapshot: snapshot,
      },
    ];
  };

  for (const scenario of contractContribution.scenarios) {
    const rawScenario = EXACT_RAW_SCENARIO[scenario.id];
    raw.scenarios[rawScenario] ??= { events: [] };
    for (const event of scenario.events) {
      const record = records.get(event.input.recordId);
      const eventIndex = raw.scenarios[rawScenario].events.length;
      const rawEventId = `${rawScenario.replaceAll(':', '-')}-raw-${eventIndex + 1}`;
      const rawSource = { scenario: rawScenario, id: rawEventId, eventIndex };
      event.rawSource = structuredClone(rawSource);
      record.rawSource = structuredClone(rawSource);
      if (scenario.id === 'coldLaunch') {
        const rawEvent = {
          id: rawEventId,
          scenario: rawScenario,
          repetition: event.sequence,
          thermalState: event.temperature,
          instrumentationMode: 'low-overhead',
          durationMs: event.markers.end.atMs - event.markers.start.atMs,
          markers: [
            { label: 'launch-requested', clock: 'runner-monotonic', atEpochMs: event.markers.start.atMs },
            { label: 'menu-interactive', clock: 'runner-monotonic', atEpochMs: event.markers.end.atMs },
          ],
          discriminator: structuredClone(event.discriminator),
          metrics: null,
        };
        record.requestedAtMs = event.markers.start.atMs;
        record.deliveredAtMs = event.markers.start.atMs;
        record.raw.atMs = event.markers.start.atMs;
        record.outcome.atMs = event.markers.end.atMs;
        raw.scenarios[rawScenario].events.push(rawEvent);
        continue;
      }

      if (scenario.id === 'startToControllable') {
        const clickTarget = {
          tag: 'button', id: 'new-game', classes: ['primary'], role: null,
          ariaLabel: null, text: 'New Game',
        };
        const click = {
          type: 'click', isTrusted: true,
          atMs: event.markers.start.atMs, atEpochMs: event.markers.start.atMs,
          eventTimestampMs: event.markers.start.atMs,
          observedAtMs: event.markers.start.atMs,
          clientX: 960, clientY: 540, button: 0, target: clickTarget,
        };
        const request = {
          atMs: event.markers.start.atMs,
          atEpochMs: event.markers.start.atMs,
          kind: 'pointer', control: 'New Game',
          source: 'driver-immediately-before-Playwright-primary-menu-click',
          detail: { action: 'click', scenario: 'startToControllable' },
        };
        record.requestedAtMs = request.atEpochMs;
        record.deliveredAtMs = click.atEpochMs;
        record.request = {
          atMs: request.atEpochMs, source: request.source, kind: request.kind,
          actualControl: request.control, action: 'click',
          scenarioId: 'startToControllable', rawScenario: 'startToControllable',
        };
        record.raw = {
          eventType: 'click', target: JSON.stringify(clickTarget),
          source: 'capturing-DOM-input-listener', isTrusted: true,
          trustBasis: 'browser-isTrusted', atMs: click.atEpochMs,
          eventTimestampMs: click.eventTimestampMs, observedAtMs: click.atEpochMs,
          clientX: click.clientX, clientY: click.clientY, button: click.button,
          targetElement: clickTarget, targetControlLabel: 'New Game',
        };
        record.consumed = {
          signal: 'shipping-menu-control-opened-difficulty-selection',
          productionHandlerObserved: true,
          atMs: event.discriminator.menuControlConsumedAtMs,
        };
        record.outcome = {
          signal: 'walk-active-and-veil-clear-at-production-render-boundary',
          observationSource: 'dedicated transition recorder observed one controllable shipping render followed by its first display-rAF boundary',
          observed: true, markerName: event.markers.end.name, atMs: event.markers.end.atMs,
        };
        raw.scenarios[rawScenario].events.push({
          id: rawEventId,
          scenario: rawScenario,
          repetition: event.sequence,
          thermalState: event.temperature,
          instrumentationMode: 'low-overhead',
          startedAtEpochMs: event.markers.start.atMs,
          endedAtEpochMs: event.markers.end.atMs,
          durationMs: event.markers.end.atMs - event.markers.start.atMs,
          displayFrameIntervalsMs: structuredClone(event.displayFrameIntervalsMs),
          displayCadenceIntervals: structuredClone(event.displayCadenceIntervals),
          renderFrameIntervalsMs: structuredClone(event.renderFrameIntervalsMs),
          renderCadenceIntervals: structuredClone(event.renderCadenceIntervals),
          sampleCoverage: structuredClone(event.sampleCoverage),
          inputEvents: [click, event.discriminator.movementProbe.delivery],
          driverInputRequests: [request, event.discriminator.movementProbe.request],
          traceIdentity: { id: 'start-game-1', scenario: 'startGame' },
          discriminator: structuredClone(event.discriminator),
        });
        continue;
      }

      const discriminator = event.discriminator;
      const startedAtMs = event.markers.start.atMs;
      const endedAtMs = event.markers.end.atMs;
      let inputEvents;
      let driverInputRequests;
      if (scenario.id === 'ledgerOpen') {
        inputEvents = [
          { type: 'keydown', isTrusted: true, key: 'k', code: 'KeyK', atMs: startedAtMs,
            eventTimestampMs: startedAtMs, observedAtMs: startedAtMs, target },
          { type: 'keydown', isTrusted: true, key: 'e', code: 'KeyE', atMs: startedAtMs + 5,
            eventTimestampMs: startedAtMs + 5, observedAtMs: startedAtMs + 5, target },
        ];
        driverInputRequests = [
          { atMs: startedAtMs, kind: 'keyboard', control: 'k',
            source: 'driver-immediately-before-Playwright-input-call',
            detail: { action: 'down', phase: 'raise-book', scenario: scenario.id } },
          { atMs: startedAtMs + 4, kind: 'keyboard', control: 'e',
            source: 'driver-immediately-before-Playwright-input-call',
            detail: { action: 'down', phase: 'open-cover', scenario: scenario.id } },
        ];
      } else {
        const tool = scenario.id === 'toolFirstUseByTool'
          || scenario.id === 'toolChanges20' || scenario.id === 'toolSwitches100Stress';
        const key = tool ? 'f' : scenario.id.startsWith('door') ? 'w' : 'e';
        const actualKey = scenario.id === 'doorFirstOpen' ? 'e' : key;
        const type = tool ? 'keyup' : 'keydown';
        inputEvents = [{
          type, isTrusted: true, key: actualKey,
          code: `Key${actualKey.toUpperCase()}`, atMs: startedAtMs,
          eventTimestampMs: startedAtMs, observedAtMs: startedAtMs, target,
        }];
        driverInputRequests = [{
          atMs: startedAtMs, kind: 'keyboard', control: actualKey,
          source: 'driver-immediately-before-Playwright-input-call',
          detail: { action: type === 'keyup' ? 'up' : 'down', scenario: scenario.id },
        }];
      }
      const delivered = scenario.id === 'ledgerOpen' ? inputEvents[1] : inputEvents[0];
      const requested = driverInputRequests[0];
      record.requestedAtMs = requested.atMs;
      record.deliveredAtMs = delivered.atMs;
      record.request = {
        atMs: requested.atMs, source: requested.source, kind: requested.kind,
        actualControl: requested.control, action: requested.detail.action,
        scenarioId: scenario.id, rawScenario: requested.detail.scenario,
      };
      record.raw = {
        eventType: scenario.id === 'ledgerOpen' ? 'keydown-sequence' : delivered.type,
        target: JSON.stringify(delivered.target),
        source: 'capturing-DOM-input-listener', isTrusted: true,
        trustBasis: 'browser-isTrusted', atMs: delivered.atMs,
        eventTimestampMs: delivered.eventTimestampMs, observedAtMs: delivered.observedAtMs,
        code: delivered.code, key: delivered.key,
      };
      if (scenario.id === 'ledgerOpen') {
        const expected = [
          { phase: 'raise-book', control: 'k', consumed: discriminator.entryModeConsumed },
          { phase: 'open-cover', control: 'e', consumed: discriminator.productionHandlerConsumed },
        ];
        record.raw.steps = expected.map((step, stepIndex) => ({
          phase: step.phase,
          control: step.control,
          requestedAtMs: driverInputRequests[stepIndex].atMs,
          requestSource: driverInputRequests[stepIndex].source,
          requestKind: driverInputRequests[stepIndex].kind,
          deliveredAtMs: inputEvents[stepIndex].atMs,
          consumed: step.consumed,
          eventType: inputEvents[stepIndex].type,
          key: inputEvents[stepIndex].key,
          code: inputEvents[stepIndex].code,
          target: JSON.stringify(inputEvents[stepIndex].target),
          source: 'capturing-DOM-input-listener', isTrusted: true,
          trustBasis: 'browser-isTrusted',
          eventTimestampMs: inputEvents[stepIndex].eventTimestampMs,
          observedAtMs: inputEvents[stepIndex].observedAtMs,
        }));
      }
      record.consumed = {
        signal: discriminator.productionHandlerConsumed.signal,
        productionHandlerObserved: true,
        atMs: discriminator.productionHandlerConsumed.atMs,
      };
      record.outcome = {
        signal: `observed-production-state-then-render-boundaries:${scenario.id}`,
        observationSource: 'driver-observed production state followed by two measured production-render boundaries',
        observed: true, markerName: event.markers.end.name, atMs: event.markers.end.atMs,
      };
      if (scenario.id === 'npcNavActivation') {
        inputEvents = [];
        driverInputRequests = [];
        record.requestedAtMs = startedAtMs;
        record.deliveredAtMs = startedAtMs;
        record.raw = {
          eventType: 'organic-customer-lifecycle-window-start',
          target: 'clubhouse.customer-lifecycle',
          source: 'production-customer-lifecycle-observer',
          isTrusted: null, trustBasis: 'production-lifecycle-observation',
          atMs: startedAtMs, routeRequestId: discriminator.routeRequestId,
        };
        record.outcome = {
          signal: 'same-organic-customer-route-remained-active-after-render-boundaries',
          observationSource: 'driver observed the exact customer route activation, then two measured production-render boundaries',
          observed: true, markerName: event.markers.end.name, atMs: event.markers.end.atMs,
        };
      }
      const rawDiscriminator = structuredClone(discriminator);
      if (scenario.id === 'ledgerPageTurns10' || scenario.id === 'ledgerTurns50Stress') {
        rawDiscriminator.direction = discriminator.direction === 'right' ? 1 : -1;
      }
      raw.scenarios[rawScenario].events.push({
        id: rawEventId,
        scenario: rawScenario,
        repetition: event.sequence,
        thermalState: event.temperature,
        instrumentationMode: 'low-overhead',
        startedAtMs,
        endedAtMs,
        durationMs: endedAtMs - startedAtMs,
        displayFrameIntervalsMs: structuredClone(event.displayFrameIntervalsMs),
        displayCadenceIntervals: structuredClone(event.displayCadenceIntervals),
        renderFrameIntervalsMs: structuredClone(event.renderFrameIntervalsMs),
        renderCadenceIntervals: structuredClone(event.renderCadenceIntervals),
        ...(GOAL24_DOOR_SCENARIOS.includes(scenario.id) ? {
          renderFrameEvidence: structuredClone(event.doorwayRenderEvidence.frameSamples),
          doorwayRenderEvidence: structuredClone(event.doorwayRenderEvidence),
        } : {}),
        sampleCoverage: structuredClone(event.sampleCoverage),
        inputEvents,
        driverInputRequests,
        markers: recorderMarkers(event, discriminator),
        discriminator: rawDiscriminator,
      });
    }
    if (scenario.resources) {
      const summary = scenario.id === 'ledgerTurns50Stress' ? 'ledgerStress' : 'toolStress';
      raw.scenarios[summary] = {
        checkpoints: structuredClone(scenario.resources.samples),
      };
    }
  }

  if (options.full) {
    raw.contractEnvironment = structuredClone(contractContribution.environment);
    raw.resourceBaseline = structuredClone(contractContribution.resourceBaseline);
    raw.resourceFinal = structuredClone(contractContribution.resourceFinal);
    const control = contractContribution.negativeControl;
    const rawSource = { scenario: 'negativeControl', id: 'negative-control-raw-1', eventIndex: 0 };
    control.rawSource = structuredClone(rawSource);
    raw.scenarios.negativeControl = { events: [{
      id: rawSource.id,
      discriminator: { actualBusyMs: control.busyLoopElapsedMs },
      displayFrameIntervalsMs: structuredClone(control.displayFrameIntervalsMs),
      renderFrameIntervalsMs: structuredClone(control.renderFrameIntervalsMs),
      displayCadenceIntervals: structuredClone(control.displayCadenceIntervals),
      renderCadenceIntervals: structuredClone(control.renderCadenceIntervals),
    }] };
    raw.controls.negativeControl = {
      busyStall: {
        startedAtMs: control.markers.start.atMs,
        endedAtMs: control.markers.end.atMs,
      },
    };
  }
  return raw;
}

function rawBoundToolContributionFixture({ stress = false } = {}) {
  const scenarioId = stress ? 'toolSwitches100Stress' : 'toolChanges20';
  const rawScenario = stress ? 'toolSwitchStress' : 'toolSwitch';
  const rawEventId = `${rawScenario}-raw-1`;
  const displayFrameIntervalsMs = [16, 17];
  const displayCadenceIntervals = [
    { startAtMs: 90, endAtMs: 106, durationMs: 16 },
    { startAtMs: 106, endAtMs: 123, durationMs: 17 },
  ];
  const renderFrameIntervalsMs = [15, 18];
  const renderCadenceIntervals = [
    { startAtMs: 91, endAtMs: 106, durationMs: 15 },
    { startAtMs: 106, endAtMs: 124, durationMs: 18 },
  ];
  const sampleCoverage = {
    complete: true,
    windowDurationMs: 40,
    droppedDisplaySamples: 0,
    droppedRenderSamples: 0,
    droppedSubmissionSamples: 0,
    displayFirstBoundaryOffsetMs: 6,
    displayLastBoundaryBeforeEndMs: 17,
    renderFirstBoundaryOffsetMs: 6,
    renderLastBoundaryBeforeEndMs: 16,
    measurementPriorDisplayBoundaryMs: 90,
    measurementPriorRenderBoundaryMs: 91,
  };
  const inputEvent = {
    type: 'keyup',
    isTrusted: true,
    key: 'f',
    code: 'KeyF',
    atMs: 102,
    eventTimestampMs: 101.75,
    observedAtMs: 102,
    target: { tag: 'canvas', id: 'game-canvas' },
  };
  const inputRequest = {
    atMs: 101,
    kind: 'keyboard',
    control: 'f',
    source: 'driver-immediately-before-Playwright-input-call',
    detail: { action: 'up', scenario: scenarioId },
  };
  const discriminator = {
    key: 'f',
    equipKey: 'f',
    fromTool: 'broom',
    toTool: 'mop',
    changed: true,
    viewmodelReady: true,
    firstUse: false,
    productionEquipSequence: GOAL24_SUPPORTED_TOOL_IDS.length + 1,
    productionEquipSignal: 'shipping-walk-toolChanged-edge',
    productionEquipAtMs: 110,
    productionHandlerConsumed: { atMs: 110, signal: 'shipping-walk-toolChanged-edge' },
    outcomeObservedAtMs: 120,
    productionOutcomeMarkerAtMs: 121,
    contractOutcomeMarkerAtMs: 140,
  };
  const endCadenceSnapshot = {
    atMs: 140,
    displayCount: 2,
    renderCount: 2,
    submissionCount: 0,
    displayDropped: 0,
    renderDropped: 0,
    submissionDropped: 0,
    renderStarts: 2,
    firstDisplayBoundaryMs: 106,
    lastDisplayBoundaryMs: 123,
    firstRenderBoundaryMs: 106,
    lastRenderBoundaryMs: 124,
  };
  const rawEvent = {
    id: rawEventId,
    scenario: rawScenario,
    repetition: 1,
    thermalState: 'warm',
    startedAtMs: 100,
    endedAtMs: 140,
    durationMs: 40,
    displayFrameIntervalsMs,
    displayCadenceIntervals,
    renderFrameIntervalsMs,
    renderCadenceIntervals,
    sampleCoverage,
    inputEvents: [inputEvent],
    driverInputRequests: [inputRequest],
    markers: [
      {
        label: 'measurement-armed-after-three-production-renders',
        atMs: 100,
        detail: { priorDisplayBoundaryMs: 90, priorRenderBoundaryMs: 91 },
      },
      {
        label: 'production-outcome-observed',
        atMs: 121,
        detail: { sourceObservedAtMs: 120, productionConsumptionAtMs: 110 },
      },
      {
        label: 'post-outcome-render-boundary',
        atMs: 140,
        detail: { ok: true },
        cadenceSnapshot: endCadenceSnapshot,
      },
    ],
    discriminator,
  };
  const recordId = `${scenarioId}-input-1`;
  const rawSource = { scenario: rawScenario, id: rawEventId, eventIndex: 0 };
  const event = {
    scenarioId,
    sequence: 1,
    temperature: 'warm',
    rawSource,
    input: {
      recordId,
      kind: 'keyboard',
      control: 'tool-belt-binding',
      delivery: 'playwright-keyboard',
      evidencePolicy: 'trusted-user-input',
      productionPath: true,
      directStateMutation: false,
    },
    markers: {
      start: { name: stress ? 'tool-stress-switch-input' : 'tool-change-input', clock: 'renderer', atMs: 100 },
      end: { name: stress ? 'tool-stress-viewmodel-ready' : 'tool-viewmodel-ready', clock: 'renderer', atMs: 140 },
    },
    cadenceAvailability: {
      display: {
        status: 'measured', priorBoundaryAtMs: 90,
        priorBoundarySource: 'test-recorder-previous-display-boundary',
      },
      render: {
        status: 'measured', priorBoundaryAtMs: 91,
        priorBoundarySource: 'test-recorder-previous-production-render-boundary',
      },
    },
    displayFrameIntervalsMs: structuredClone(displayFrameIntervalsMs),
    displayCadenceIntervals: structuredClone(displayCadenceIntervals),
    renderFrameIntervalsMs: structuredClone(renderFrameIntervalsMs),
    renderCadenceIntervals: structuredClone(renderCadenceIntervals),
    sampleCoverage: structuredClone(sampleCoverage),
    discriminator: structuredClone(discriminator),
  };
  const record = {
    recordId,
    scenarioId,
    eventSequence: 1,
    rawSource,
    clock: 'renderer',
    requestedAtMs: 101,
    deliveredAtMs: 102,
    request: {
      atMs: 101,
      source: inputRequest.source,
      kind: 'keyboard',
      actualControl: 'f',
      action: 'up',
      scenarioId,
      rawScenario: scenarioId,
    },
    kind: 'keyboard',
    control: 'tool-belt-binding',
    delivery: 'playwright-keyboard',
    evidencePolicy: 'trusted-user-input',
    raw: {
      eventType: 'keyup',
      target: JSON.stringify(inputEvent.target),
      source: 'capturing-DOM-input-listener',
      isTrusted: true,
      trustBasis: 'browser-isTrusted',
      atMs: 102,
      eventTimestampMs: 101.75,
      observedAtMs: 102,
      code: 'KeyF',
      key: 'f',
    },
    consumed: {
      signal: 'shipping-walk-toolChanged-edge',
      productionHandlerObserved: true,
      atMs: 110,
    },
    outcome: {
      signal: `observed-production-state-then-render-boundaries:${scenarioId}`,
      observationSource: 'driver-observed production state followed by two measured production-render boundaries',
      observed: true,
      markerName: event.markers.end.name,
      atMs: 140,
    },
  };
  const scenario = { id: scenarioId, events: [event] };
  const raw = { scenarios: { [rawScenario]: { events: [rawEvent] } } };
  if (stress) {
    const checkpoints = [
      structuredClone(goal24ResourceCheckpointFixture({
        iteration: 0,
        elapsedMs: 0,
        label: 'tool-stress-resource-0',
        capturedAt: '2026-08-11T20:00:00.000Z',
        heapUsedBytes: 100_000,
      })),
      structuredClone(goal24ResourceCheckpointFixture({
        iteration: 100,
        elapsedMs: 1_000,
        label: 'tool-stress-resource-100',
        capturedAt: '2026-08-11T20:00:01.000Z',
        heapUsedBytes: 100_100,
      })),
    ];
    raw.scenarios.toolStress = { checkpoints };
    scenario.resources = {
      rawSource: { scenario: 'toolStress' },
      samples: structuredClone(checkpoints),
    };
  }
  return {
    run: { id: 'raw-bound-fixture', role: 'unit-test' },
    raw,
    contribution: { scenarios: [scenario], inputRecords: [record] },
  };
}

test('acceptance contribution cadence and outcome are exact projections of one indexed raw recorder event', () => {
  const fixture = rawBoundToolContributionFixture();
  assert.equal(validateContributionRawBindings(
    fixture.raw, fixture.contribution, fixture.run,
  ), true);

  const durationMutation = structuredClone(fixture);
  durationMutation.contribution.scenarios[0].events[0].renderFrameIntervalsMs[0] += 1;
  assert.throws(() => validateContributionRawBindings(
    durationMutation.raw, durationMutation.contribution, durationMutation.run,
  ), /renderFrameIntervalsMs differs/);

  const endpointMutation = structuredClone(fixture);
  endpointMutation.contribution.scenarios[0].events[0]
    .displayCadenceIntervals[0].endAtMs += 1;
  assert.throws(() => validateContributionRawBindings(
    endpointMutation.raw, endpointMutation.contribution, endpointMutation.run,
  ), /displayCadenceIntervals differs/);

  const outcomeMutation = structuredClone(fixture);
  outcomeMutation.contribution.inputRecords[0].outcome.atMs -= 1;
  assert.throws(() => validateContributionRawBindings(
    outcomeMutation.raw, outcomeMutation.contribution, outcomeMutation.run,
  ), /outcome evidence differs/);

  const markerMutation = structuredClone(fixture);
  markerMutation.contribution.scenarios[0].events[0].markers.end.atMs -= 1;
  assert.throws(() => validateContributionRawBindings(
    markerMutation.raw, markerMutation.contribution, markerMutation.run,
  ), /markers\/duration differ/);

  const coverageMutation = structuredClone(fixture);
  coverageMutation.contribution.scenarios[0].events[0]
    .sampleCoverage.renderLastBoundaryBeforeEndMs += 1;
  assert.throws(() => validateContributionRawBindings(
    coverageMutation.raw, coverageMutation.contribution, coverageMutation.run,
  ), /sample coverage differs/);

  const requestMutation = structuredClone(fixture);
  requestMutation.contribution.inputRecords[0].requestedAtMs += 1;
  assert.throws(() => validateContributionRawBindings(
    requestMutation.raw, requestMutation.contribution, requestMutation.run,
  ), /request\/delivery timestamps differ/);
});

test('start contribution render availability is exact-bound to the raw first production-render boundary', () => {
  const run = { id: 'raw-bound-start', role: 'unit-test' };
  const raw = exactRawRun(run.id, ['startToControllable']);
  assert.equal(validateContributionRawBindings(raw, raw.contractContribution, run), true);

  const rawIdentityMutation = structuredClone(raw);
  rawIdentityMutation.scenarios.startGame.events[0].traceIdentity.id = 'forged-start';
  assert.throws(
    () => validateContributionRawBindings(
      rawIdentityMutation,
      rawIdentityMutation.contractContribution,
      run,
    ),
    /raw recorder trace identity is not exact/,
  );

  const contributionIdentityMutation = structuredClone(raw.contractContribution);
  contributionIdentityMutation.scenarios[0].events[0].traceIdentity.scenario = 'forged-scenario';
  assert.throws(
    () => validateContributionRawBindings(raw, contributionIdentityMutation, run),
    /contribution trace identity differs from raw/,
  );

  const shifted = structuredClone(raw.contractContribution);
  shifted.scenarios[0].events[0]
    .cadenceAvailability.render.measurementStartedAtMs += 1;
  assert.throws(
    () => validateContributionRawBindings(raw, shifted, run),
    /render measurement boundary is not bound to the raw first observed production render/,
  );

  const undocumented = structuredClone(raw.contractContribution);
  undocumented.scenarios[0].events[0]
    .cadenceAvailability.render.preMeasurementReason = '';
  assert.throws(
    () => validateContributionRawBindings(raw, undocumented, run),
    /render measurement boundary is not bound to the raw first observed production render/,
  );

  const relabeled = structuredClone(raw.contractContribution);
  relabeled.scenarios[0].events[0]
    .cadenceAvailability.render.priorBoundarySource = 'unrelated recorder boundary';
  assert.throws(
    () => validateContributionRawBindings(raw, relabeled, run),
    /render measurement boundary is not bound to the raw first observed production render/,
  );
});

test('trace interaction requirements include start transition and exclude only pre-page cold launch', () => {
  const raw = {
    scenarios: {
      coldLaunch: { events: [{ id: 'cold-launch-1' }] },
      startGame: { events: [{
        id: 'start-game-1',
        traceIdentity: { id: 'start-game-1', scenario: 'startGame' },
      }] },
      doorApproach: { events: [{ id: 'door-approach-1' }] },
    },
  };
  assert.deepEqual(goal24RequiredTraceInteractionIds(raw), [
    'start-game-1',
    'door-approach-1',
  ]);
  const forged = structuredClone(raw);
  forged.scenarios.startGame.events[0].traceIdentity.id = 'other-start';
  assert.throws(() => goal24RequiredTraceInteractionIds(forged),
    /exact start-game-1\/startGame recorder trace identity/);
});

test('raw-bound NPC contribution cannot coordinate away prewarm or the first nav rebuild', () => {
  const run = { id: 'raw-bound-npc-nav', role: 'unit-test' };
  const raw = exactRawRun(run.id, ['npcNavActivation']);
  assert.equal(validateContributionRawBindings(raw, raw.contractContribution, run), true);

  const prewarmed = structuredClone(raw);
  const prewarmedRawEvent = prewarmed.scenarios.npcNavActivation.events[0];
  prewarmedRawEvent.discriminator.navPerformanceBefore.navFreshCallCount = 1;
  prewarmedRawEvent.discriminator.navPerformanceAfter.navFreshCallCount = 2;
  prewarmed.contractContribution.scenarios[0].events[0].discriminator =
    structuredClone(prewarmedRawEvent.discriminator);
  assert.throws(
    () => validateContributionRawBindings(prewarmed, prewarmed.contractContribution, run),
    /before any navFresh call or collider-grid prewarm/,
  );

  const noRebuild = structuredClone(raw);
  const noRebuildRawEvent = noRebuild.scenarios.npcNavActivation.events[0];
  const before = noRebuildRawEvent.discriminator.navPerformanceBefore;
  Object.assign(noRebuildRawEvent.discriminator.navPerformanceAfter, {
    navRebuildCount: before.navRebuildCount,
    navRebuildTotalDurationMs: before.navRebuildTotalDurationMs,
    navRebuildMaximumDurationMs: before.navRebuildMaximumDurationMs,
    navLastRebuildDurationMs: null,
    navLastRebuildAtMs: null,
    builtColliderVersion: before.builtColliderVersion,
  });
  Object.assign(noRebuildRawEvent.discriminator.navPerformanceDelta, {
    navRebuildCount: 0,
    navRebuildTotalDurationMs: 0,
  });
  noRebuild.contractContribution.scenarios[0].events[0].discriminator =
    structuredClone(noRebuildRawEvent.discriminator);
  assert.throws(
    () => validateContributionRawBindings(noRebuild, noRebuild.contractContribution, run),
    /exactly one shipping navFresh call and one collider-grid rebuild/,
  );

  const polledLater = structuredClone(raw);
  const polledLaterRawEvent = polledLater.scenarios.npcNavActivation.events[0];
  polledLaterRawEvent.discriminator.navPerformanceAfter.navFreshCallCount += 1;
  polledLater.contractContribution.scenarios[0].events[0].discriminator =
    structuredClone(polledLaterRawEvent.discriminator);
  assert.throws(
    () => validateContributionRawBindings(
      polledLater,
      polledLater.contractContribution,
      run,
    ),
    /snapshot owned by the exact resolved production route/,
  );

  const missingPoll = structuredClone(raw);
  const missingPollRawEvent = missingPoll.scenarios.npcNavActivation.events[0];
  delete missingPollRawEvent.discriminator.navPerformanceAtObservation;
  missingPoll.contractContribution.scenarios[0].events[0].discriminator =
    structuredClone(missingPollRawEvent.discriminator);
  assert.throws(
    () => validateContributionRawBindings(missingPoll, missingPoll.contractContribution, run),
    /later production diagnostic poll/,
  );

  const relabeled = structuredClone(raw);
  const relabeledRawEvent = relabeled.scenarios.npcNavActivation.events[0];
  relabeledRawEvent.discriminator.routeRequestId = 'reused-other-route';
  relabeledRawEvent.discriminator.routeObserved.route.requestId = 'reused-other-route';
  relabeled.contractContribution.scenarios[0].events[0].discriminator =
    structuredClone(relabeledRawEvent.discriminator);
  assert.throws(
    () => validateContributionRawBindings(relabeled, relabeled.contractContribution, run),
    /snapshot must own matching request/,
  );

  const impossibleTiming = structuredClone(raw);
  const impossibleRawEvent = impossibleTiming.scenarios.npcNavActivation.events[0];
  for (const snapshot of [
    impossibleRawEvent.discriminator.navPerformanceAfter,
    impossibleRawEvent.discriminator.routeObserved.route.navPerformanceAtResolution,
    impossibleRawEvent.discriminator.navPerformanceAtObservation,
    impossibleRawEvent.discriminator.routeObserved.navPerformance,
  ]) {
    snapshot.navRebuildTotalDurationMs = 9;
    snapshot.navRebuildMaximumDurationMs = 7;
    snapshot.navLastRebuildDurationMs = 2.5;
  }
  impossibleRawEvent.discriminator.navPerformanceDelta.navRebuildTotalDurationMs = 9;
  impossibleTiming.contractContribution.scenarios[0].events[0].discriminator =
    structuredClone(impossibleRawEvent.discriminator);
  assert.throws(
    () => validateContributionRawBindings(
      impossibleTiming,
      impossibleTiming.contractContribution,
      run,
    ),
    /equal total, maximum, and last durations/,
  );

  const malformedLaterTiming = structuredClone(raw);
  const malformedLaterRawEvent = malformedLaterTiming.scenarios.npcNavActivation.events[0];
  for (const snapshot of [
    malformedLaterRawEvent.discriminator.navPerformanceAtObservation,
    malformedLaterRawEvent.discriminator.routeObserved.navPerformance,
  ]) {
    snapshot.navRebuildTotalDurationMs = 9;
    snapshot.navRebuildMaximumDurationMs = 7;
    snapshot.navLastRebuildDurationMs = 2.5;
  }
  malformedLaterTiming.contractContribution.scenarios[0].events[0].discriminator =
    structuredClone(malformedLaterRawEvent.discriminator);
  assert.throws(
    () => validateContributionRawBindings(
      malformedLaterTiming,
      malformedLaterTiming.contractContribution,
      run,
    ),
    /equal total, maximum, and last durations/,
  );

  const lateBeforeCapture = structuredClone(raw);
  const lateBeforeRawEvent = lateBeforeCapture.scenarios.npcNavActivation.events[0];
  lateBeforeRawEvent.discriminator.navPerformanceBefore.capturedAtMs =
    lateBeforeRawEvent.discriminator.routeResolvedAtMs + 100;
  lateBeforeCapture.contractContribution.scenarios[0].events[0].discriminator =
    structuredClone(lateBeforeRawEvent.discriminator);
  assert.throws(
    () => validateContributionRawBindings(
      lateBeforeCapture,
      lateBeforeCapture.contractContribution,
      run,
    ),
    /captured before the organic lifecycle and exact route/,
  );
});

test('raw-bound NPC contribution accepts only the exact organic lifecycle recorder restart', () => {
  const run = { id: 'raw-bound-npc-lifecycle', role: 'unit-test' };
  const raw = exactRawRun(run.id, ['npcNavActivation']);
  assert.equal(validateContributionRawBindings(raw, raw.contractContribution, run), true);

  const genericRestart = structuredClone(raw);
  genericRestart.scenarios.npcNavActivation.events[0].markers[0].label =
    'measurement-armed-after-three-production-renders';
  assert.throws(
    () => validateContributionRawBindings(
      genericRestart,
      genericRestart.contractContribution,
      run,
    ),
    /exact recorder-owned measurement boundary/,
  );

  const nonEmptyRestart = structuredClone(raw);
  nonEmptyRestart.scenarios.npcNavActivation.events[0]
    .markers[0].cadenceSnapshot.renderStarts = 1;
  assert.throws(
    () => validateContributionRawBindings(
      nonEmptyRestart,
      nonEmptyRestart.contractContribution,
      run,
    ),
    /not an empty recorder boundary/,
  );

  for (const [label, mutate] of [
    ['prepended marker', (event) => event.markers.unshift({
      ...structuredClone(event.markers[0]), atMs: event.startedAtMs - 100,
    })],
    ['unrelated lifecycle id', (event) => {
      event.discriminator.lifecycleBoundaryId = 'unrelated-lifecycle';
    }],
    ['mismatched top lifecycle edge', (event) => {
      event.discriminator.lifecycleBoundaryAtMs = 0;
    }],
    ['direct spawn', (event) => {
      event.discriminator.directSpawnUsed = true;
    }],
    ['test-hook boundary', (event) => {
      event.discriminator.lifecycleObserved.spawnSource = 'manual';
      event.discriminator.lifecycleObserved.boundaryObservation.boundary.source = 'test-hook';
    }],
    ['different route customer', (event) => {
      event.discriminator.routeObserved.customerId = 'other-customer';
    }],
    ['different route request', (event) => {
      event.discriminator.routeObserved.route.requestId = 'other-route';
    }],
    ['shifted nested measurement', (event) => {
      event.discriminator.lifecycleObserved
        .boundaryObservation.measurementBoundary.atMs += 100;
    }],
    ['fake route handler', (event) => {
      event.discriminator.productionHandlerConsumed.signal = 'fake-route-handler';
    }],
    ['missing customer identity', (event) => {
      delete event.discriminator.customerId;
      delete event.discriminator.lifecycleObserved.customerId;
      delete event.discriminator.routeObserved.customerId;
    }],
    ['nonfinite boundary observation', (event) => {
      event.discriminator.lifecycleObserved.boundaryObservation.observedAtMs = Infinity;
    }],
    ['nonfinite route observation', (event) => {
      event.discriminator.routeObserved.atMs = Infinity;
    }],
    ['non-organic unresolved route', (event) => {
      event.discriminator.routeObserved.route.pathNodes = 0;
      event.discriminator.routeObserved.route.spawnSource = 'manual';
    }],
    ['outcome differs from route observation', (event) => {
      event.discriminator.routeObserved.atMs -= 1;
    }],
    ['all-linked ancient lifecycle edge', (event) => {
      event.discriminator.lifecycleBoundaryAtMs = 0;
      event.discriminator.lifecycleObserved.lifecycleBoundaryAtMs = 0;
      event.discriminator.lifecycleObserved.boundaryObservation.boundary.atMs = 0;
      event.discriminator.routeObserved.route.lifecycleBoundaryAtMs = 0;
    }],
  ]) {
    const forged = structuredClone(raw);
    const rawEvent = forged.scenarios.npcNavActivation.events[0];
    mutate(rawEvent);
    forged.contractContribution.scenarios[0].events[0].discriminator =
      structuredClone(rawEvent.discriminator);
    const record = forged.contractContribution.inputRecords[0];
    record.consumed.signal = rawEvent.discriminator.productionHandlerConsumed.signal;
    assert.throws(
      () => validateContributionRawBindings(forged, forged.contractContribution, run),
      undefined,
      label,
    );
  }
});

test('acceptance contribution rejects reused raw coordinates and stress checkpoint drift', () => {
  const fixture = rawBoundToolContributionFixture({ stress: true });
  assert.equal(validateContributionRawBindings(
    fixture.raw, fixture.contribution, fixture.run,
  ), true);

  const checkpointMutation = {
    run: structuredClone(fixture.run),
    raw: structuredClone(fixture.raw),
    contribution: structuredClone(fixture.contribution),
  };
  checkpointMutation.contribution.scenarios[0].resources.samples[1].elapsedMs += 1;
  assert.throws(() => validateContributionRawBindings(
    checkpointMutation.raw, checkpointMutation.contribution, checkpointMutation.run,
  ), /stress resources differ/);

  const reused = structuredClone(fixture);
  const duplicateEvent = structuredClone(reused.contribution.scenarios[0].events[0]);
  duplicateEvent.sequence = 2;
  duplicateEvent.input.recordId = `${duplicateEvent.input.recordId}-duplicate`;
  const duplicateRecord = structuredClone(reused.contribution.inputRecords[0]);
  duplicateRecord.recordId = duplicateEvent.input.recordId;
  duplicateRecord.eventSequence = 2;
  reused.contribution.scenarios[0].events.push(duplicateEvent);
  reused.contribution.inputRecords.push(duplicateRecord);
  assert.throws(() => validateContributionRawBindings(
    reused.raw, reused.contribution, reused.run,
  ), /linked more than once/);
});

test('raw binding independently recomputes every resource snapshot and run endpoint', () => {
  for (const [label, mutate] of [
    ['stripped evidence', (checkpoint) => {
      delete checkpoint.snapshot.measurementEvidence.production.renderSamples;
    }],
    ['duplicate composed evidence', (checkpoint) => {
      checkpoint.snapshot.measurementEvidence.production.renderSamples[1]
        .composedRenders += 1;
    }],
    ['callback-free progress', (checkpoint) => {
      const samples = checkpoint.snapshot.measurementEvidence.production.renderSamples;
      samples[1].productionCallbackCount = samples[0].productionCallbackCount;
    }],
  ]) {
    const fixture = rawBoundToolContributionFixture({ stress: true });
    mutate(fixture.raw.scenarios.toolStress.checkpoints[0]);
    assert.throws(
      () => validateContributionRawBindings(fixture.raw, fixture.contribution, fixture.run),
      /failed resource validation/,
      label,
    );
  }

  const fullIds = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder
    .filter((id) => !['coldLaunch', 'startToControllable', 'doorApproach', 'doorFirstOpen',
      'doorCrossingOutsideToInside', 'doorCrossingInsideToOutside'].includes(id));
  for (const field of ['resourceBaseline', 'resourceFinal']) {
    const raw = exactRawRun('resource-endpoint-binding', fullIds, { full: true });
    delete raw[field];
    assert.throws(
      () => validateContributionRawBindings(raw, raw.contractContribution, {
        id: 'resource-endpoint-binding', role: 'acceptance-full',
      }),
      new RegExp(`raw ${field} dropped the full resource snapshot`),
    );
  }
  const contributionMissing = exactRawRun(
    'resource-contribution-endpoint', fullIds, { full: true },
  );
  delete contributionMissing.contractContribution.resourceFinal;
  assert.throws(
    () => validateContributionRawBindings(
      contributionMissing,
      contributionMissing.contractContribution,
      { id: 'resource-contribution-endpoint', role: 'acceptance-full' },
    ),
    /contribution resourceFinal differs/,
  );
});

test('locked aggregation selects raw contributions without synthesizing timing or trust evidence', () => {
  const fullStart = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.indexOf('ledgerOpen');
  const coldIds = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.slice(0, fullStart);
  const fullIds = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.slice(fullStart);
  const runs = [];
  for (let index = 0; index < REQUIRED_COLD_PROCESS_COUNT; index += 1) {
    const id = `cold-${index + 1}`;
    runs.push({
      run: { id, ordinal: index + 1, role: 'acceptance-cold' },
      raw: exactRawRun(id, coldIds, { cold: true }),
    });
  }
  runs.push({
    run: { id: 'full-1', ordinal: 8, role: 'acceptance-full' },
    raw: exactRawRun('full-1', fullIds, { full: true }),
  });
  let evaluated = null;
  const { report, evaluation, aggregation } = aggregateLockedReport(runs, {
    evaluator(candidate) {
      evaluated = candidate;
      return { ok: true, failures: [], gates: [] };
    },
  });
  assert.equal(evaluation.ok, true);
  assert.equal(evaluated, report);
  assert.deepEqual(report.scenarios.map(({ id }) => id), LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder);
  const launches = report.scenarios.find(({ id }) => id === 'coldLaunch');
  assert.equal(launches.events.length, 7);
  assert.deepEqual(launches.events.map(({ sequence }) => sequence), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(launches.events.every((event) => event.input.recordId.includes('::')));
  const approaches = report.scenarios.find(({ id }) => id === 'doorApproach');
  assert.equal(approaches.events.filter(({ temperature }) => temperature === 'cold').length, 7);
  assert.equal(approaches.events.filter(({ temperature }) => temperature === 'warm').length, 21);
  assert.ok(approaches.events.slice(0, 7).every(({ temperature }) => temperature === 'cold'));
  assert.equal(aggregation.timingSynthesis, false);
  assert.equal(aggregation.inputTrustSynthesis, false);
  assert.equal(Object.hasOwn(report, 'aggregation'), false);
  assert.equal(report.inputRecords.length, report.scenarios.reduce((sum, scenario) => sum + scenario.events.length, 0));

  runs[0].raw.contractContribution.inputRecords.push({ recordId: 'unlinked' });
  assert.throws(
    () => aggregateLockedReport(runs, { evaluator: () => ({ ok: true }) }),
    /unlinked records/,
  );
});

test('cold door route parity rejects warmed and cross-process camera-route drift', () => {
  const fullStart = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.indexOf('ledgerOpen');
  const coldIds = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.slice(0, fullStart);
  const sources = Array.from({ length: REQUIRED_COLD_PROCESS_COUNT }, (_, index) => {
    const id = `route-process-${index + 1}`;
    return {
      run: { id },
      contribution: exactContribution(id, coldIds, { cold: true }),
    };
  });
  assert.equal(validateColdDoorRouteParity(sources), true);

  const warmDrift = structuredClone(sources);
  warmDrift[0].contribution.scenarios.find(({ id }) => id === 'doorApproach')
    .events[1].discriminator.routeSignature.startPose.yaw += 0.1;
  assert.throws(() => validateColdDoorRouteParity(warmDrift), /warmed route\/camera start drifted/);

  const processDrift = structuredClone(sources);
  for (const event of processDrift[4].contribution.scenarios
    .find(({ id }) => id === 'doorCrossingOutsideToInside').events) {
    event.discriminator.routeSignature.target.x += 0.1;
  }
  assert.throws(() => validateColdDoorRouteParity(processDrift), /drifted across cold processes/);
});

test('full protocol rejects missing or relabeled per-tool cold first-use evidence', () => {
  const fullStart = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.indexOf('ledgerOpen');
  const fullIds = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.slice(fullStart);
  const raw = exactRawRun('full-tool-protocol', fullIds, { full: true });
  raw.scenarios.idle = { events: [{
    durationMs: 5_000,
    discriminator: { stationary: true, displacementYards: 0 },
  }] };
  raw.scenarios.indoorWalk = { events: [{
    durationMs: 60_000,
    discriminator: {
      pathYards: 10, insidePct: 100, distinctPositionChanges: 10, trustedMovementKeydowns: 2,
    },
  }] };
  raw.scenarios.ledgerStress.requestedTurns = 50;
  raw.scenarios.ledgerStress.completedTurns = 50;
  raw.scenarios.toolStress.requestedSwitches = 100;
  raw.scenarios.toolStress.completedSwitches = 100;
  const run = { id: 'full-tool-protocol' };
  assert.equal(validateFullRunProtocol(raw, run, 'full'), true);

  const missing = structuredClone(raw);
  missing.scenarios.toolFirstUse.events.pop();
  assert.throws(() => validateFullRunProtocol(missing, run, 'full'), /first-use coverage/);

  const relabeled = structuredClone(raw);
  relabeled.scenarios.toolFirstUse.events[1].discriminator.firstUse = false;
  assert.throws(() => validateFullRunProtocol(relabeled, run, 'full'), /production evidence/);
});

test('aggregated role subsets pass the real locked evaluator without an injected test double', () => {
  const fullStart = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.indexOf('ledgerOpen');
  const coldIds = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.slice(0, fullStart);
  const fullIds = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.slice(fullStart);
  const runs = Array.from({ length: REQUIRED_COLD_PROCESS_COUNT }, (_, index) => {
    const id = `process-${index + 1}`;
    return {
      run: { id, ordinal: index + 1, role: 'acceptance-cold' },
      raw: exactRawRun(id, coldIds, { cold: true }),
    };
  });
  runs.push({
    run: { id: 'full-process', ordinal: 8, role: 'acceptance-full' },
    raw: exactRawRun('full-process', fullIds, { full: true }),
  });
  const locked = aggregateLockedReport(runs);
  assert.equal(locked.evaluation.ok, true, locked.evaluation.failures.join('\n'));
  assert.equal(locked.evaluation.gates.length, LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.length);
  assert.deepEqual(
    locked.report.scenarios.map(({ id }) => id),
    LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder,
  );
});

test('sealed complete aggregate is rebuilt from persisted raw contributions whether pass or fail', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-raw-bound-aggregate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fullStart = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.indexOf('ledgerOpen');
  const coldIds = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.slice(0, fullStart);
  const fullIds = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.slice(fullStart);
  const executed = Array.from({ length: REQUIRED_COLD_PROCESS_COUNT }, (_, index) => {
    const id = `sealed-cold-${index + 1}`;
    return {
      run: { id, ordinal: index + 1, role: 'acceptance-cold' },
      raw: exactRawRun(id, coldIds, { cold: true }),
    };
  });
  executed.push({
    run: { id: 'sealed-full', ordinal: 8, role: 'acceptance-full' },
    raw: exactRawRun('sealed-full', fullIds, { full: true }),
  });
  const locked = aggregateLockedReport(executed);
  const runs = executed.map(({ run, raw: rawRun }) => {
    const rawPath = path.join(root, `${run.id}.json`);
    fs.writeFileSync(rawPath, `${JSON.stringify(rawRun)}\n`);
    return { run, artifacts: { raw: { path: rawPath } } };
  });
  const aggregate = {
    completeProtocol: true,
    accepted: true,
    runs,
    acceptance: { report: locked.report, evaluation: locked.evaluation },
  };
  assert.equal(validateAcceptedAggregateRawBindings(aggregate), true);
  const mutated = structuredClone(aggregate);
  mutated.acceptance.report.scenarios
    .find(({ id }) => id === 'toolChanges20').events[0].renderFrameIntervalsMs[0] += 1;
  assert.throws(() => validateAcceptedAggregateRawBindings(mutated),
    /not an exact aggregation/);

  const rejectedExecuted = structuredClone(executed);
  const rejectedFull = rejectedExecuted.at(-1).raw.contractContribution.scenarios
    .find(({ id }) => id === 'toolSwitches100Stress');
  const rejectedFinal = rejectedFull.resources.samples.at(-1);
  replaceLockedResourceSnapshot(rejectedFinal, {
    rendererProgramCount: rejectedFinal.snapshot.metrics.rendererProgramCount + 1,
  });
  const rejectedRawCheckpoints = rejectedExecuted.at(-1).raw.scenarios.toolStress.checkpoints;
  rejectedRawCheckpoints[rejectedRawCheckpoints.length - 1] = structuredClone(rejectedFinal);
  const rejectedLocked = aggregateLockedReport(rejectedExecuted);
  assert.equal(rejectedLocked.evaluation.ok, false);
  const rejectedRuns = rejectedExecuted.map(({ run, raw: rawRun }) => {
    const rawPath = path.join(root, `${run.id}-rejected.json`);
    fs.writeFileSync(rawPath, `${JSON.stringify(rawRun)}\n`);
    return { run, artifacts: { raw: { path: rawPath } } };
  });
  const rejectedAggregate = {
    completeProtocol: true,
    accepted: false,
    runs: rejectedRuns,
    acceptance: {
      report: rejectedLocked.report,
      evaluation: rejectedLocked.evaluation,
    },
  };
  assert.equal(validateAcceptedAggregateRawBindings(rejectedAggregate), true);
  rejectedAggregate.acceptance.report.scenarios
    .find(({ id }) => id === 'toolChanges20').events[0].renderFrameIntervalsMs[0] += 1;
  assert.throws(() => validateAcceptedAggregateRawBindings(rejectedAggregate),
    /not an exact aggregation/);
});

test('comparison accepts a sealed complete failing before baseline without weakening candidate gates', () => {
  const failed = {
    phase: 'baseline', completeProtocol: true, executionOk: true,
    state: 'rejected', accepted: false, ok: false,
    acceptance: { status: 'fail', evaluation: { ok: false } },
  };
  assert.deepEqual(validateBaselineReferenceOutcome(failed), { passed: false });
  const passed = structuredClone(failed);
  Object.assign(passed, { state: 'accepted', accepted: true, ok: true });
  passed.acceptance.status = 'pass';
  passed.acceptance.evaluation.ok = true;
  assert.deepEqual(validateBaselineReferenceOutcome(passed), { passed: true });
  assert.throws(() => validateBaselineReferenceOutcome({
    ...failed, state: 'accepted', accepted: true, ok: true,
  }), /outcome fields/);
  assert.throws(() => validateBaselineReferenceOutcome({
    ...failed, completeProtocol: false,
  }), /entire protocol/);
});

test('cold contribution is cross-bound to runner PID, unique profile, and launch anchors', () => {
  const run = { id: 'cold-bind', role: 'acceptance-cold' };
  const fullStart = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.indexOf('ledgerOpen');
  const coldIds = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.slice(0, fullStart);
  const raw = exactRawRun(run.id, coldIds, { cold: true });
  const contribution = raw.contractContribution;
  const profile = 'C:/temp/profile-cold-bind';
  const envelope = runnerEnvelope(run, profile);
  const processId = String(envelope.runner.launch.electronPid);
  const launchRequestedAtMs = 100;
  const launchResolvedAtMs = 101;
  const menuReadyAtMs = 124;
  envelope.runner.timing.anchors.electronLaunchRequested = { epochMs: launchRequestedAtMs };
  envelope.runner.timing.anchors.electronLaunchResolved = { epochMs: launchResolvedAtMs };
  envelope.runner.timing.anchors.menuReady = { epochMs: menuReadyAtMs };
  for (const scenarioId of ['coldLaunch', 'startToControllable', 'doorApproach']) {
    const scenario = contribution.scenarios.find(({ id }) => id === scenarioId);
    for (const event of scenario.events) {
      event.discriminator.processInstanceId = processId;
      event.discriminator.runnerLaunchId = envelope.runner.launch.launchId;
      event.discriminator.electronMainProcessCreationTimeEpochMs = envelope.runner.launch
        .electronMainProcessIdentity.creationTimeEpochMs;
      const rawEvent = raw.scenarios[event.rawSource.scenario].events[event.rawSource.eventIndex];
      rawEvent.discriminator = structuredClone(event.discriminator);
    }
  }
  const launch = contribution.scenarios.find(({ id }) => id === 'coldLaunch').events[0];
  launch.discriminator.userDataDirectory = profile;
  launch.discriminator.userDataProfileId = envelope.runner.profile.profileId;
  launch.markers.start.atMs = launchRequestedAtMs;
  launch.markers.end.atMs = menuReadyAtMs;
  const rawLaunch = raw.scenarios.coldLaunch.events[0];
  rawLaunch.markers[0].atEpochMs = launchRequestedAtMs;
  rawLaunch.markers[1].atEpochMs = menuReadyAtMs;
  rawLaunch.durationMs = menuReadyAtMs - launchRequestedAtMs;
  rawLaunch.discriminator = structuredClone(launch.discriminator);
  const launchRecord = contribution.inputRecords.find(({ recordId }) => recordId === launch.input.recordId);
  Object.assign(launchRecord, {
    requestedAtMs: launchRequestedAtMs,
    deliveredAtMs: launchRequestedAtMs,
  });
  Object.assign(launchRecord.raw, {
    atMs: launchRequestedAtMs,
    processInstanceId: processId,
    runnerLaunchId: envelope.runner.launch.launchId,
    electronMainProcessCreationTimeEpochMs: envelope.runner.launch
      .electronMainProcessIdentity.creationTimeEpochMs,
  });
  launchRecord.consumed.atMs = launchResolvedAtMs;
  Object.assign(launchRecord.outcome, {
    atMs: menuReadyAtMs,
    markerName: launch.markers.end.name,
    signal: 'main-menu-enabled-and-save-refresh-settled',
    observationSource: 'runner-observed menu-ready anchor',
  });

  assert.equal(bindColdContributionToRunner(raw, envelope, run), true);
  const warmApproach = contribution.scenarios.find(({ id }) => id === 'doorApproach').events[1];
  warmApproach.discriminator.processInstanceId = '9999';
  raw.scenarios[ warmApproach.rawSource.scenario]
    .events[warmApproach.rawSource.eventIndex].discriminator.processInstanceId = '9999';
  assert.throws(() => bindColdContributionToRunner(raw, envelope, run), /process identity/);
  warmApproach.discriminator.processInstanceId = processId;
  raw.scenarios[warmApproach.rawSource.scenario]
    .events[warmApproach.rawSource.eventIndex].discriminator.processInstanceId = processId;
  launchRecord.raw.processInstanceId = '9999';
  assert.throws(() => bindColdContributionToRunner(raw, envelope, run), /launch-request anchor/);
});

test('repository fingerprint retains binary diffs larger than spawnSync default maxBuffer', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-repository-metadata-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-b', 'qa-large-diff');
  git('config', 'user.email', 'goal24-test@example.invalid');
  git('config', 'user.name', 'Goal 24 Test');
  const binaryPath = path.join(root, 'large.bin');
  fs.writeFileSync(binaryPath, randomBytes(2 * 1024 * 1024));
  git('add', 'large.bin');
  git('commit', '-m', 'initial fixture');
  fs.writeFileSync(binaryPath, randomBytes(2 * 1024 * 1024));

  const metadata = repositoryMetadata(root);
  assert.equal(metadata.branch, 'qa-large-diff');
  assert.equal(metadata.dirty, true);
  assert.match(metadata.workingTreeFingerprintSha256, /^[0-9a-f]{64}$/u);
});

test('artifact validation rejects a junction that escapes the session output root', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-artifact-links-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const session = path.join(parent, 'session');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(session);
  fs.mkdirSync(outside);
  const regular = path.join(session, 'raw.json');
  fs.writeFileSync(regular, '{}');
  assert.equal(assertRegularArtifactFile(regular, session, 'raw fixture'), fs.realpathSync.native(regular));

  const externalArtifact = path.join(outside, 'raw.json');
  fs.writeFileSync(externalArtifact, '{"stale":true}');
  const junction = path.join(session, 'linked-output');
  fs.symlinkSync(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(
    () => assertRegularArtifactFile(path.join(junction, 'raw.json'), session, 'raw fixture'),
    /symbolic link or junction|resolved outside/,
  );
  assert.throws(
    () => assertRegularArtifactFile(path.join(junction, 'raw.json'), junction, 'video fixture'),
    /output root is not a regular directory/,
  );
});

test('sealed publication hash-binds every trust artifact and requires its final nonce manifest', (t) => {
  const session = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-sealed-publication-'));
  t.after(() => fs.rmSync(session, { recursive: true, force: true }));
  const leg = path.join(session, 'legs', '01-fixture');
  fs.mkdirSync(leg, { recursive: true });
  const files = Object.fromEntries([
    ['raw', path.join(leg, 'raw.json')],
    ['runnerEnvelope', path.join(leg, 'runner-result.json')],
    ['runnerStdout', path.join(leg, 'runner-stdout.txt')],
    ['runnerStderr', path.join(leg, 'runner-stderr.txt')],
    ['invocation', path.join(leg, 'invocation.json')],
    ['validated', path.join(leg, 'validated.json')],
  ]);
  for (const [kind, file] of Object.entries(files)) {
    fs.writeFileSync(file, `${kind}\n`);
  }
  const descriptor = (file) => {
    const content = fs.readFileSync(file);
    return {
      path: fs.realpathSync.native(file).replaceAll('\\', '/'),
      algorithm: 'sha256',
      bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  };
  const run = {
    ok: true,
    run: { id: 'fixture-run', instrumentation: 'low-overhead' },
    resultPath: files.raw,
    resultEnvelopePath: files.runnerEnvelope,
    stdoutPath: files.runnerStdout,
    stderrPath: files.runnerStderr,
    invocationPath: files.invocation,
    validatedPath: files.validated,
    artifacts: Object.fromEntries(Object.entries(files).map(([kind, file]) => [kind, descriptor(file)])),
  };
  const aggregate = {
    schema: GOAL24_ORCHESTRATOR_SCHEMA,
    state: 'diagnostic-incomplete',
    executionOk: true,
    accepted: false,
    ok: false,
    sessionId: 'sealed-fixture',
    phase: 'baseline',
    completeProtocol: false,
    acceptance: { status: 'not-evaluated-incomplete-protocol' },
    runs: [run],
  };
  assert.throws(() => publishAggregate(session, {
    ...aggregate, state: 'complete', accepted: true, ok: true,
  }), /Incomplete protocol/);
  const publication = publishAggregate(session, aggregate, {
    publicationNonce: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(publication.aggregate.state, 'diagnostic-incomplete');
  assert.equal(publication.aggregate.executionOk, true);
  assert.equal(publication.aggregate.accepted, false);
  assert.equal(publication.completion.publicationState, 'sealed');
  assert.equal(publication.completion.accepted, false);
  const completionMtime = fs.statSync(publication.completionPath).mtimeMs;
  assert.ok(completionMtime >= fs.statSync(path.join(session, 'aggregate.json')).mtimeMs);
  assert.ok(completionMtime >= fs.statSync(path.join(session, 'aggregate.md')).mtimeMs);
  assert.deepEqual(
    fs.readdirSync(session).filter((name) => name.endsWith('.tmp')),
    [],
  );
  const aggregatePath = path.join(session, 'aggregate.json');
  assert.equal(loadCompletedReference(aggregatePath).sessionId, 'sealed-fixture');

  const aggregateBytes = fs.readFileSync(aggregatePath);
  const mutatedAggregate = JSON.parse(aggregateBytes.toString('utf8'));
  mutatedAggregate.accepted = true;
  fs.writeFileSync(aggregatePath, `${JSON.stringify(mutatedAggregate, null, 2)}\n`);
  assert.throws(() => loadCompletedReference(aggregatePath), /outcome|byte count|SHA-256/);
  fs.writeFileSync(aggregatePath, aggregateBytes);

  fs.appendFileSync(files.raw, 'tampered\n');
  assert.throws(() => loadCompletedReference(aggregatePath), /byte count|SHA-256/);
  fs.writeFileSync(files.raw, 'raw\n');
  assert.equal(loadCompletedReference(aggregatePath).sessionId, 'sealed-fixture');

  const completionPath = path.join(session, 'completion-manifest.json');
  const completion = JSON.parse(fs.readFileSync(completionPath, 'utf8'));
  completion.publicationNonce = '22222222-2222-4222-8222-222222222222';
  fs.writeFileSync(completionPath, `${JSON.stringify(completion, null, 2)}\n`);
  assert.throws(() => loadCompletedReference(aggregatePath), /nonce/);
  completion.publicationNonce = publication.aggregate.publication.nonce;
  fs.writeFileSync(completionPath, `${JSON.stringify(completion, null, 2)}\n`);

  fs.writeFileSync(path.join(session, 'failure.json'), '{"state":"failed-closed"}\n');
  assert.throws(() => loadCompletedReference(aggregatePath), /failure marker/);
  fs.unlinkSync(path.join(session, 'failure.json'));
  fs.unlinkSync(completionPath);
  assert.throws(() => loadCompletedReference(aggregatePath), /completion manifest is missing/);
});

test('comparison requires baseline and candidate profile paths and instances to be disjoint', () => {
  const reference = [
    { profilePath: 'C:/goal24/profiles/baseline-a', profileId: 'baseline-a', launchId: 'launch-baseline-a' },
    { profilePath: 'C:/goal24/profiles/baseline-b', profileId: 'baseline-b', launchId: 'launch-baseline-b' },
  ];
  const comparison = [
    { profilePath: 'C:/goal24/profiles/comparison-a', profileId: 'comparison-a', launchId: 'launch-comparison-a' },
    { profilePath: 'C:/goal24/profiles/comparison-b', profileId: 'comparison-b', launchId: 'launch-comparison-b' },
  ];
  assert.equal(validateComparisonProfileIsolation(reference, comparison), true);
  assert.throws(
    () => validateComparisonProfileIsolation(reference, [
      ...comparison.slice(0, 1),
      { profilePath: reference[1].profilePath, profileId: 'comparison-c', launchId: 'launch-comparison-c' },
    ]),
    /reused an Electron profile path/,
  );
  assert.throws(
    () => validateComparisonProfileIsolation(reference, [
      ...comparison.slice(0, 1),
      { profilePath: 'C:/goal24/profiles/comparison-c', profileId: reference[1].profileId, launchId: 'launch-comparison-c' },
    ]),
    /reused an Electron profile instance ID/,
  );
  assert.throws(
    () => validateComparisonProfileIsolation(reference, [
      ...comparison.slice(0, 1),
      { profilePath: 'C:/goal24/profiles/comparison-c', profileId: 'comparison-c', launchId: reference[1].launchId },
    ]),
    /reused a runner launch instance ID/,
  );
});

test('comparison gates every cold scenario and catches cold-only ledger/tool regressions', () => {
  const gate = (scenario) => ({
    scenario,
    warmAcceptance: { applicable: true },
    summary: {
      cold: {
        eventCount: 1,
        eventsWithFrameOver33Ms: 0,
        eventsWithFrameOver50Ms: 0,
        interactionDuration: { medianMs: 100, p95Ms: 100, worstMs: 100 },
        displayCadence: { p95Ms: 16, worstMs: 18, framesOver33Ms: 0, framesOver50Ms: 0 },
        renderCadence: { p95Ms: 16, worstMs: 18, framesOver33Ms: 0, framesOver50Ms: 0 },
      },
      warm: {
        eventCount: 3,
        eventsWithFrameOver33Ms: 0,
        eventsWithFrameOver50Ms: 0,
        interactionDuration: { medianMs: 20, p95Ms: 20, worstMs: 20 },
        displayCadence: { p95Ms: 16, worstMs: 18, framesOver33Ms: 0, framesOver50Ms: 0 },
        renderCadence: { p95Ms: 16, worstMs: 18, framesOver33Ms: 0, framesOver50Ms: 0 },
      },
    },
  });
  const reference = {
    gates: LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.map(gate),
  };
  const current = structuredClone(reference);
  for (const scenario of ['ledgerOpen', 'toolChanges20']) {
    const regression = current.gates.find((entry) => entry.scenario === scenario);
    regression.summary.cold.interactionDuration = { medianMs: 200, p95Ms: 200, worstMs: 200 };
  }
  const comparison = compareLockedEvaluationGates(reference, current);
  assert.equal(comparison.ok, false);
  assert.equal(comparison.gates.find(({ scenario }) => scenario === 'ledgerOpen').coldDurationPass, false);
  assert.equal(comparison.gates.find(({ scenario }) => scenario === 'toolChanges20').coldDurationPass, false);
  assert.equal(comparison.gates.find(({ scenario }) => scenario === 'doorApproach').coldDurationPass, true);
  assert.ok(comparison.gates.every((entry) => entry.warmRegressionPass));

  const cadenceRegression = structuredClone(reference);
  const door = cadenceRegression.gates.find(({ scenario }) => scenario === 'doorApproach');
  door.summary.cold.displayCadence.worstMs = 40;
  door.summary.cold.displayCadence.framesOver33Ms = 1;
  door.summary.cold.eventsWithFrameOver33Ms = 1;
  const cadenceComparison = compareLockedEvaluationGates(reference, cadenceRegression);
  const doorComparison = cadenceComparison.gates.find(({ scenario }) => scenario === 'doorApproach');
  assert.equal(cadenceComparison.ok, false);
  assert.equal(doorComparison.coldDisplayCadence.worstPass, false);
  assert.equal(doorComparison.coldDisplayCadence.framesOver33Pass, false);
  assert.equal(doorComparison.coldRecurringFramePass, false);

  const resourceRegression = structuredClone(reference);
  const referenceStress = reference.gates.find(({ scenario }) => scenario === 'ledgerTurns50Stress');
  const currentStress = resourceRegression.gates.find(({ scenario }) => scenario === 'ledgerTurns50Stress');
  referenceStress.resources = {
    metrics: {
      drawCallCount: { end: 120, maximum: 130 },
      renderedTriangleCount: { end: 250_000, maximum: 260_000 },
    },
  };
  currentStress.resources = structuredClone(referenceStress.resources);
  currentStress.resources.metrics.drawCallCount.maximum = 131;
  const resourceComparison = compareLockedEvaluationGates(reference, resourceRegression);
  const resourceGate = resourceComparison.gates.find(({ scenario }) => scenario === 'ledgerTurns50Stress');
  assert.equal(resourceComparison.ok, false);
  assert.equal(resourceGate.resourceRegressionPass, false);
  assert.equal(resourceGate.resourceRows.find(({ metric }) => metric === 'drawCallCount').maximumPass, false);
});

test('resource comparison gates all persistent summaries and exact matched workload context', () => {
  const iterationsByScenario = { ledgerTurns50Stress: 50, toolSwitches100Stress: 100 };
  const metricSummary = (metric) => {
    const value = metric === 'jsHeapUsedBytes' ? 50_000_000 : 10;
    return { start: value, end: value, maximum: value };
  };
  const resources = (scenario) => ({
    metrics: Object.fromEntries([
      ...LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.persistentResourceMetrics,
      'drawCallCount',
      'renderedTriangleCount',
    ].map((metric) => [metric, metricSummary(metric)])),
    checkpoints: [0, iterationsByScenario[scenario]].map((iteration) => ({
      iteration,
      elapsedMs: iteration * 10,
      label: `${scenario}-${iteration}`,
      workloadContext: goal24WorkloadContextFixture(),
      metrics: Object.fromEntries(
        LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.persistentResourceMetrics
          .map((metric) => [metric, metricSummary(metric).start]),
      ),
    })),
  });
  const evaluation = () => ({
    gates: LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.map((scenario) => ({
      scenario,
      warmAcceptance: { applicable: false },
      summary: { cold: { eventCount: 0 }, warm: { eventCount: 0 } },
      ...(iterationsByScenario[scenario] ? { resources: resources(scenario) } : {}),
    })),
    runResources: {
      metrics: Object.fromEntries(
        LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.persistentResourceMetrics
          .map((metric) => [metric, metricSummary(metric)]),
      ),
      checkpoints: [
        { iteration: 0, elapsedMs: 0, label: 'run-resource-baseline',
          workloadContext: goal24WorkloadContextFixture(),
          metrics: Object.fromEntries(
            LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.persistentResourceMetrics
              .map((metric) => [metric, metricSummary(metric).start]),
          ) },
        { iteration: 1, elapsedMs: 1000, label: 'run-resource-final',
          workloadContext: goal24WorkloadContextFixture(),
          metrics: Object.fromEntries(
            LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.persistentResourceMetrics
              .map((metric) => [metric, metricSummary(metric).end]),
          ) },
      ],
    },
  });
  const reference = evaluation();
  assert.equal(compareLockedEvaluationGates(reference, structuredClone(reference)).ok, true);

  for (const metric of LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress
    .deterministicPersistentResourceMetrics) {
    for (const field of ['start', 'end', 'maximum']) {
      const candidate = structuredClone(reference);
      candidate.gates.find(({ scenario }) => scenario === 'ledgerTurns50Stress')
        .resources.metrics[metric][field] += 1;
      const comparison = compareLockedEvaluationGates(reference, candidate);
      const row = comparison.gates.find(({ scenario }) => scenario === 'ledgerTurns50Stress')
        .resourceRows.find((entry) => entry.metric === metric);
      assert.equal(comparison.ok, false, `${metric}.${field} must fail`);
      assert.equal(row[`${field}Pass`], false);
    }
  }

  const heapTolerance = Math.max(
    2 * 1024 * 1024,
    reference.runResources.metrics.jsHeapUsedBytes.start * 0.05,
  );
  const heapWithin = structuredClone(reference);
  heapWithin.runResources.metrics.jsHeapUsedBytes.start += heapTolerance;
  assert.equal(compareLockedEvaluationGates(reference, heapWithin).ok, true);
  const heapAbove = structuredClone(reference);
  heapAbove.runResources.metrics.jsHeapUsedBytes.start += heapTolerance + 1;
  assert.equal(compareLockedEvaluationGates(reference, heapAbove).ok, false);

  const checkpointIncrease = structuredClone(reference);
  checkpointIncrease.gates.find(({ scenario }) => scenario === 'ledgerTurns50Stress')
    .resources.checkpoints[1].metrics.rendererProgramCount += 1;
  const checkpointComparison = compareLockedEvaluationGates(reference, checkpointIncrease);
  assert.equal(checkpointComparison.ok, false);
  assert.equal(checkpointComparison.gates
    .find(({ scenario }) => scenario === 'ledgerTurns50Stress')
    .resourceContext.checkpoints[1].metricRows
    .find(({ metric }) => metric === 'rendererProgramCount').pass, false);

  const poseWithin = structuredClone(reference);
  poseWithin.gates.find(({ scenario }) => scenario === 'toolSwitches100Stress')
    .resources.checkpoints[1].workloadContext.camera.position.x += 0.001;
  assert.equal(compareLockedEvaluationGates(reference, poseWithin).ok, true);
  const poseAbove = structuredClone(reference);
  poseAbove.gates.find(({ scenario }) => scenario === 'toolSwitches100Stress')
    .resources.checkpoints[1].workloadContext.walk.yaw += 0.0011;
  assert.equal(compareLockedEvaluationGates(reference, poseAbove).ok, false);

  for (const mutate of [
    (context) => { context.heldTool = 'brush'; },
    (context) => { context.ledger.state = 'open'; context.ledger.open = true; },
    (context) => { context.ledger.spread += 1; },
  ]) {
    const candidate = structuredClone(reference);
    const context = candidate.gates.find(({ scenario }) => scenario === 'ledgerTurns50Stress')
      .resources.checkpoints[0].workloadContext;
    mutate(context);
    const comparison = compareLockedEvaluationGates(reference, candidate);
    assert.equal(comparison.ok, false);
    assert.equal(comparison.gates.find(({ scenario }) => scenario === 'ledgerTurns50Stress')
      .resourceContext.ok, false);
  }
});

test('matrix GPU and CPU-submit comparison covers every route, p95, and worst frame', () => {
  const matrixRuns = buildRunPlan({
    suite: 'full', phase: 'baseline', sessionId: 'matrix-comparison-unit',
  }).runs.filter(({ leg }) => leg === 'matrix');
  const entry = (run) => ({
    run,
    matrix: {
      frameTiming: {
        routes: Object.fromEntries(['idle', 'indoorWalk', 'capLadder'].map((route) => [route, {
          labels: [`${route}-route`],
          cpuSubmit: { count: 100, p95: 2, worst: 3 },
          gpu: { count: 100, p95: 4, worst: 5 },
        }])),
      },
    },
  });
  const reference = matrixRuns.map(entry);
  const current = structuredClone(reference);
  const pass = compareMatrixFrameTiming(reference, current);
  assert.equal(pass.ok, true);
  assert.equal(pass.rows.length, 4 * 3 * 2);

  current[2].matrix.frameTiming.routes.indoorWalk.gpu.worst = 6;
  const regression = compareMatrixFrameTiming(reference, current);
  assert.equal(regression.ok, false);
  const row = regression.rows.find(({ matrix, route, stream }) => (
    matrix === current[2].run.name && route === 'indoorWalk' && stream === 'gpu'
  ));
  assert.equal(row.p95Pass, true);
  assert.equal(row.worstPass, false);
});

test('video validation rejects header and Cluster-marker fakes without structured frames', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-video-container-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fake = path.join(root, 'fake.webm');
  const headerOnly = Buffer.alloc(20 * 1024);
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(headerOnly, 0);
  Buffer.from('webm').copy(headerOnly, 16);
  fs.writeFileSync(fake, headerOnly);
  assert.throws(() => validateVideoContainer(fake), /structured WebM validation/);
  Buffer.from([0x1f, 0x43, 0xb6, 0x75]).copy(headerOnly, 10 * 1024);
  fs.writeFileSync(fake, headerOnly);
  assert.throws(() => validateVideoContainer(fake), /structured WebM validation/);
});

test('legacy stripe-only overlay frames fail the closed-event identity contract', (t) => {
  const session = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-overlay-frames-'));
  t.after(() => fs.rmSync(session, { recursive: true, force: true }));
  const scenarios = [
    'doorApproach', 'doorOpen', 'doorCrossing:outside-in', 'doorCrossing:inside-out',
    'ledgerOpen', 'ledgerPageTurn', 'ledgerClose',
    'toolFirstUse', 'toolSwitch', 'npcNavActivation',
  ];
  const frames = scenarios.map((scenario, frameIndex) => {
    const screenshot = path.join(session, `frame-${frameIndex}.png`);
    const png = new PNG({ width: 640, height: 360 });
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const index = (y * png.width + x) * 4;
        const inOverlay = x >= 300 && x < 630 && y >= 12 && y < 160;
        const stripe = (x + y + frameIndex) % 31;
        png.data[index] = inOverlay ? 18 + stripe : 90 + stripe;
        png.data[index + 1] = inOverlay ? 28 + stripe : 110 + stripe;
        png.data[index + 2] = inOverlay ? 23 + stripe : 130 + stripe;
        png.data[index + 3] = 255;
      }
    }
    fs.writeFileSync(screenshot, PNG.sync.write(png));
    return {
      scenario,
      activeScenario: scenario,
      interactionId: `${scenario}-${frameIndex}`,
      capturePhase: 'after-locked-post-outcome-render-boundary-before-recorder-detach',
      text: `GOAL 24 — DIAGNOSTIC VIDEO (NOT GRADED)\ninteraction: ${scenario}\ndisplay rAF\nshipping renderer frame`,
      rect: { x: 300, y: 12, width: 330, height: 148 },
      viewport: { width: 640, height: 360, devicePixelRatio: 1 },
      diagnostics: { enabled: true, visible: true, seenInteractionLabels: [scenario] },
      screenshot,
    };
  });
  const run = { id: 'overlay-fixture' };
  assert.throws(() => validateOverlayFrameEvidence(
    { evidence: { overlayFrames: frames } }, session, run,
  ), /visual evidence run\/session\/launch\/video identity/);
});

test('closed visual frames reconstruct raw events and validate every digest-marker cell', (t) => {
  const session = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-closed-visual-'));
  t.after(() => fs.rmSync(session, { recursive: true, force: true }));
  const scenarios = [
    'doorApproach', 'doorOpen', 'doorCrossing:outside-in', 'doorCrossing:inside-out',
    'ledgerOpen', 'ledgerPageTurn', 'ledgerClose',
    'toolFirstUse', 'toolSwitch', 'npcNavActivation',
  ];
  const sessionId = 'overlay-session-2026-08-11';
  const runId = 'overlay-fixture';
  const launchId = 'launch-7fb4de9b-2026';
  const videoNonce = 'a589fc6e-5519-4f26-8d50-63a4d9825b2b';
  const metric = (values) => {
    const sorted = [...values].sort((left, right) => left - right);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const percentile = (fraction) => sorted[Math.floor((sorted.length - 1) * fraction)];
    const slowCount = Math.max(1, Math.ceil(values.length * 0.01));
    const slowMean = [...values].sort((left, right) => right - left)
      .slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
    const round = (value) => +value.toFixed(3);
    return {
      samples: values.length,
      meanMs: round(mean),
      medianMs: round(percentile(0.5)),
      p95Ms: round(percentile(0.95)),
      p99Ms: round(percentile(0.99)),
      worstMs: round(sorted.at(-1)),
      over33: values.filter((value) => value > 33).length,
      over50: values.filter((value) => value > 50).length,
      averageFps: round(1000 / mean),
      onePercentLowFps: round(1000 / slowMean),
    };
  };
  const raw = {
    evidence: {
      videoIdentity: { sessionId, runId, runnerLaunchId: launchId, videoNonce },
      overlayFrames: [],
    },
    contractEnvironment: { profile: { runnerLaunchId: launchId } },
    cleanup: {
      overlay: {
        enabled: true, visible: true, uninstalled: true,
        seenInteractionLabels: [...scenarios],
      },
    },
    scenarios: {},
  };
  const frames = scenarios.map((scenario, frameIndex) => {
    const startedAtMs = 1_000 + frameIndex * 2_000;
    const endedAtMs = startedAtMs + 48;
    const displayFrameIntervalsMs = [8, 16, 16];
    const renderFrameIntervalsMs = [8, 16, 16];
    const renderSubmissionWallMs = [2, 3, 2];
    const cadence = (values) => {
      let cursor = startedAtMs;
      return values.map((durationMs) => {
        const startAtMs = cursor;
        cursor += durationMs;
        return { startAtMs, endAtMs: cursor, durationMs };
      });
    };
    const displayCadenceIntervals = cadence(displayFrameIntervalsMs);
    const renderCadenceIntervals = cadence(renderFrameIntervalsMs);
    const interactionId = `${scenario.replaceAll(':', '-')}-${frameIndex + 1}`;
    const event = {
      id: interactionId,
      scenario,
      repetition: frameIndex + 1,
      thermalState: frameIndex === 0 ? 'cold' : 'warm',
      startedAtMs,
      endedAtMs,
      recordingStoppedAtMs: endedAtMs + 1,
      durationMs: endedAtMs - startedAtMs,
      displayFrameIntervalsMs,
      displayCadenceIntervals,
      renderFrameIntervalsMs,
      renderCadenceIntervals,
      renderSubmissionWallMs,
      renderStarts: 3,
      droppedSamples: { display: 0, render: 0, submission: 0 },
      sampleCoverage: {
        complete: true,
        displayFirstBoundaryOffsetMs: 8,
        displayLastBoundaryBeforeEndMs: 8,
        renderFirstBoundaryOffsetMs: 8,
        renderLastBoundaryBeforeEndMs: 8,
        measurementPriorDisplayBoundaryMs: startedAtMs,
        measurementPriorRenderBoundaryMs: startedAtMs,
      },
      metrics: {
        displayRaf: metric(displayFrameIntervalsMs),
        actualRender: metric(renderFrameIntervalsMs),
        renderSubmissionWall: metric(renderSubmissionWallMs),
      },
      discriminator: {
        outcomeObservedAtMs: startedAtMs + 20,
        productionOutcomeMarkerAtMs: startedAtMs + 30,
        contractOutcomeMarkerAtMs: endedAtMs,
      },
      markers: [
        { label: 'production-outcome-observed', atMs: startedAtMs + 30 },
        { label: 'post-outcome-render-boundary', atMs: endedAtMs },
      ],
      renderFrameEvidence: renderCadenceIntervals.map((interval, index) => ({
        ordinal: index + 1,
        productionRenderStartedAtMs: interval.endAtMs,
        productionRenderEndedAtMs: interval.endAtMs + 1,
        rendererFrameBefore: 100 + index,
        rendererFrameAfter: 101 + index,
        calls: 400 + index,
        triangles: 800_000 + index * 100,
        rendererInfoAutoReset: false,
        shadowBakesBefore: 5,
        shadowBakesAfter: 5,
        shadowBakeDelta: 0,
        composedRendersBefore: 200 + index,
        composedRendersAfter: 201 + index,
        composedRenderDelta: 1,
        frameClass: 'non-shadow',
        boundarySource: 'shipping-scene3d.render-wrapper',
        counterSource: 'THREE.WebGLRenderer.info.render-after-shipping-composed-frame',
        shadowClassificationSource: 'scene3d.post.stats().shadowBakes',
        composedRenderSource: 'scene3d.post.stats().composedRenders',
      })),
    };
    raw.scenarios[scenario] = { events: [event] };
    const source = {
      sessionId, runId, launchId, videoNonce,
      scenario, eventIndex: 0, interactionId,
    };
    const payload = goal24VisualEvidencePayload(event, source);
    const definition = goal24VisualMarkerDefinition(payload);
    const screenshot = path.join(session, `closed-frame-${frameIndex}.png`);
    const png = new PNG({ width: 1280, height: 720 });
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const index = (y * png.width + x) * 4;
        const inPanel = x >= 20 && x < 610 && y >= 20 && y < 256;
        const stripe = (x * 3 + y * 5 + frameIndex * 7) % 97;
        png.data[index] = inPanel ? 18 : 45 + stripe;
        png.data[index + 1] = inPanel ? 28 : 70 + stripe;
        png.data[index + 2] = inPanel ? 23 : 90 + stripe;
        png.data[index + 3] = 255;
      }
    }
    for (let cellY = 0; cellY < definition.gridSize; cellY += 1) {
      for (let cellX = 0; cellX < definition.gridSize; cellX += 1) {
        const color = definition.cells[cellY * definition.gridSize + cellX];
        for (let py = 0; py < 10; py += 1) {
          for (let px = 0; px < 10; px += 1) {
            const offset = ((36 + cellY * 10 + py) * png.width
              + 36 + cellX * 10 + px) * 4;
            png.data.set(color, offset);
          }
        }
      }
    }
    fs.writeFileSync(screenshot, PNG.sync.write(png));
    const shownAtMs = 5_000 + frameIndex * 1_500;
    const digest = goal24VisualEvidenceDigest(payload);
    return {
      schema: 'golf-flipper/goal24-closed-visual-frame/v1',
      scenario,
      interactionId,
      eventIndex: 0,
      capturePhase: 'after-recorder-detach-closed-event-outside-graded-timing',
      payload,
      digest,
      text: [
        'GOAL 24 — CLOSED EVENT VIDEO PROOF (NOT GRADED)',
        `scenario: ${scenario}`,
        `interaction: ${interactionId}`,
        `duration: ${payload.durationMs.toFixed(3)} ms`,
        'display p95/worst:',
        'render p95/worst:',
        'peak non-shadow draw/tri:',
        `digest: ${digest}`,
      ].join('\n'),
      markerRect: { x: 36, y: 36, width: 200, height: 200 },
      panelRect: { x: 20, y: 20, width: 590, height: 236 },
      rollingOverlayRect: null,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      shownAtMs,
      screenshotRequestedAtMs: shownAtMs + 100,
      screenshotCompletedAtMs: shownAtMs + 120,
      hiddenAtMs: shownAtMs + 1_300,
      dwellDurationMs: 1_300,
      presentedRafCount: 78,
      recorderActiveAtShow: false,
      removed: true,
      screenshot,
    };
  });
  raw.evidence.overlayFrames = frames;
  const run = { id: runId, env: { GOAL24_PERF_SESSION_ID: sessionId } };
  assert.equal(validateOverlayFrameEvidence(raw, session, run).length, 10);

  const relabelled = structuredClone(frames);
  relabelled[0].payload.source.scenario = 'npcNavActivation';
  raw.evidence.overlayFrames = relabelled;
  assert.throws(() => validateOverlayFrameEvidence(raw, session, run), /payload\/digest/);

  raw.evidence.overlayFrames = frames;
  const forged = PNG.sync.read(fs.readFileSync(frames[0].screenshot));
  forged.data.set([255, 0, 255, 255], (40 * forged.width + 40) * 4);
  fs.writeFileSync(frames[0].screenshot, PNG.sync.write(forged));
  assert.throws(() => validateOverlayFrameEvidence(raw, session, run),
    /orientation anchor|Visual marker cell/);
});

test('full locked environment is cross-bound to independent runner profile/window/GPU readbacks', () => {
  const id = 'full-bind';
  const fullStart = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.indexOf('ledgerOpen');
  const fullIds = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.slice(fullStart);
  const raw = exactRawRun(id, fullIds, { full: true });
  const run = {
    id,
    role: 'acceptance-full',
    env: {
      GOAL24_PERF_SEED: '424242',
      GOAL24_PERF_SAVE_FIXTURE: 'relaxed-seed-424242',
      GOAL24_PERF_ROUTE: 'goal24-indoor-route-v1',
      GOAL24_PERF_TOOL_MANIFEST: JSON.stringify(GOAL24_SUPPORTED_TOOL_MANIFEST),
    },
  };
  const envelope = {
    runner: {
      launch: {
        electronPid: 1234,
        launchId: 'launch-full-bind',
        electronMainProcessIdentity: { pid: 1234, creationTimeEpochMs: 1_000 },
      },
      profile: {
        path: 'C:/isolated/full',
        actualPath: 'C:/isolated/full',
        profileId: 'profile-full-bind',
        generatedUnder: 'C:/isolated',
      },
      timing: { anchors: { electronLaunchRequested: { epochMs: 800 } } },
      readbacks: {
        afterDriver: {
          main: { window: { mode: 'windowed', focused: true, visible: true } },
          renderer: {
            viewport: {
              innerWidth: 1920, innerHeight: 1080, outerWidth: 1920, outerHeight: 1080, devicePixelRatio: 1,
            },
            quality: { quality: 'high', renderScale: 1, shadows: true, ambientOcclusion: true, bloom: true },
            renderer: { webgl: { unmaskedVendor: 'GPU vendor', unmaskedRenderer: 'GPU renderer' } },
          },
        },
      },
    },
  };
  Object.assign(raw.contractContribution.environment.profile, {
    processInstanceId: '1234',
    runnerLaunchId: 'launch-full-bind',
    electronMainProcessCreationTimeEpochMs: 1_000,
    userDataProfileId: 'profile-full-bind',
    electronLaunchRequestedAtEpochMs: 800,
  });
  raw.contractEnvironment = structuredClone(raw.contractContribution.environment);
  assert.equal(bindFullContributionToRunner(raw, envelope, run), true);
  raw.contractContribution.environment.profile.userDataDirectory = 'C:/isolated/not-the-runner';
  raw.contractEnvironment.profile.userDataDirectory = 'C:/isolated/not-the-runner';
  assert.throws(() => bindFullContributionToRunner(raw, envelope, run), /user-data directory differs/);
});

test('programmatic comparison planning fails before any Electron process when protocol is filtered', () => {
  assert.throws(() => buildRunPlan({
    suite: 'smoke', phase: 'comparison', reference: 'baseline.json', sessionId: 'bad-smoke',
  }), /complete protocol/);
  assert.throws(() => buildRunPlan({
    suite: 'full', phase: 'comparison', reference: 'baseline.json', legs: 'cold,full', sessionId: 'bad-filter',
  }), /complete protocol/);
  assert.throws(() => buildRunPlan({ suite: 'full', phase: 'comparison' }), /requires a reference/);
});

test('matrix validation requires physical resolution, mode, 60-second walk, and conditional 120 cap', () => {
  const run = {
    id: 'matrix',
    name: 'matrix-4k-fullscreen',
    leg: 'matrix',
    width: 3840,
    height: 2160,
    mode: 'fullscreen',
    env: { GOAL24_PERF_GPU_FRAME_TIMING: '1' },
  };
  const metrics = () => ({
    displayRaf: {
      samples: 300, averageFps: 60, onePercentLowFps: 55, p95Ms: 17, worstMs: 22,
      over33: 0, over50: 0,
    },
    actualRender: {
      samples: 300, averageFps: 60, onePercentLowFps: 54, p95Ms: 17.2, worstMs: 23,
      over33: 0, over50: 0,
    },
  });
  const raw = {
    windowRequest: { requested: { width: 3840, height: 2160, fullscreen: true } },
    gpuFrameTiming: {
      install: { requested: true, installed: true },
      evidence: {
        schemaVersion: 1,
        source: 'Goal 24 synchronous render hook timing probe',
        context: {
          version: 'WebGL 2.0',
          unmaskedVendor: 'GPU vendor',
          unmaskedRenderer: 'GPU renderer',
          drawingBufferWidth: 3840,
          drawingBufferHeight: 2160,
          proof: {
            webgl2VersionClaim: true,
            queryApiComplete: true,
            timerQueryExtensionAvailable: true,
          },
        },
        cpuSubmit: {
          validity: { valid: true },
          rawSamples: [
            ['idle', 'idle-1'], ['idle', 'idle-1'],
            ['indoorWalk', 'indoor-walk-1'], ['indoorWalk', 'indoor-walk-1'],
            ['capLadder', 'cap-60'], ['capLadder', 'cap-60'],
          ].map(([scenario, label], index) => ({
            frameSequence: index + 1,
            durationMs: 1 + index / 10,
            metadata: { scenario, label },
          })),
        },
        gpu: {
          validity: { valid: true },
          rawSamples: [
            ['idle', 'idle-1'], ['idle', 'idle-1'],
            ['indoorWalk', 'indoor-walk-1'], ['indoorWalk', 'indoor-walk-1'],
            ['capLadder', 'cap-60'], ['capLadder', 'cap-60'],
          ].map(([scenario, label], index) => ({
            frameSequence: index + 1,
            durationMs: 0.5 + index / 10,
            metadata: { scenario, label },
          })),
        },
        lifecycle: { disposed: true },
        cleanup: { leakFree: true, queriesCreated: 6, queriesDeleted: 6 },
        errors: [],
      },
    },
    scenarios: {
      indoorWalk: { events: [{
        durationMs: 60_010,
        metrics: metrics(),
        discriminator: {
          pathYards: 12, insidePct: 100, distinctPositionChanges: 120,
          trustedMovementKeydowns: 2,
        },
      }] },
      capLadder: {
        displayRefreshHz: 60,
        events: [60, 144, 0].map((requestedCap) => ({
          durationMs: 5_000,
          metrics: metrics(),
          discriminator: { requestedCap, appliedCap: requestedCap },
        })),
        skipped: [{ cap: 120, reason: '60 Hz display' }],
      },
      idle: { events: [{
        durationMs: 5_000,
        metrics: metrics(),
        discriminator: { stationary: true, displacementYards: 0 },
      }] },
    },
  };
  const envelope = {
    runner: {
      readbacks: {
        afterDriver: {
          renderer: { viewport: { innerWidth: 2560, innerHeight: 1440, devicePixelRatio: 1.5 } },
          main: {
            window: { mode: 'fullscreen' },
            display: {
              id: 7,
              bounds: { x: 0, y: 0, width: 3840, height: 2160 },
              workArea: { x: 0, y: 0, width: 3840, height: 2100 },
              scaleFactor: 1.5,
              displayFrequency: 60,
              rotation: 0,
              touchSupport: 'unknown',
            },
          },
        },
      },
    },
  };
  assert.equal(validateMatrixRun(raw, envelope, run).refreshHz, 60);
  const noMetrics = structuredClone(raw);
  delete noMetrics.scenarios.indoorWalk.events[0].metrics;
  assert.throws(() => validateMatrixRun(noMetrics, envelope, run), /is not measured/);
  raw.scenarios.capLadder.events.push({
    durationMs: 5_000,
    metrics: metrics(),
    discriminator: { requestedCap: 120, appliedCap: 120 },
  });
  assert.throws(() => validateMatrixRun(raw, envelope, run), /explicitly skipped/);

  raw.scenarios.capLadder.skipped = [];
  raw.scenarios.capLadder.displayRefreshHz = 144;
  envelope.runner.readbacks.afterDriver.main.display.displayFrequency = 144;
  assert.equal(validateMatrixRun(raw, envelope, run).refreshHz, 144);
});

test('executeRun fails closed when stdout and the runner result artifact disagree', (t) => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-execute-run-'));
  t.after(() => fs.rmSync(sessionDir, { recursive: true, force: true }));
  const run = buildRunPlan({
    suite: 'smoke', phase: 'baseline', sessionId: 'execute-mismatch', legs: 'cold', coldRuns: 1,
  }).runs[0];
  let calls = 0;
  assert.throws(() => executeRun(run, {
    sessionDir,
    env: {
      ...process.env,
      GOAL24_PERF_SETTLE_MS: '999999',
      GOAL24_PERF_CALIBRATION_MS: '1',
      GOAL24_PERF_DISABLE_STALL_CONTROL: '1',
      GOAL24_PERF_MATRIX_RAW_WINDOW: '1',
      QA_FORCE_DEVICE_SCALE_FACTOR: '2',
      NODE_OPTIONS: '--require=untrusted-hook.cjs',
    },
    spawn(command, args, options) {
      calls += 1;
      assert.equal(command, process.execPath);
      assert.equal(options.shell, false);
      assert.match(args.at(-1), /^--clubhouse=pine-hills-v2$/u);
      assert.equal(options.env.GOAL24_PERF_SETTLE_MS, '2500');
      assert.equal(options.env.GOAL24_PERF_CALIBRATION_MS, '1500');
      assert.equal(options.env.GOAL24_PERF_DISABLE_STALL_CONTROL, '0');
      assert.equal(options.env.GOAL24_PERF_MATRIX_RAW_WINDOW, '0');
      assert.equal(options.env.QA_FORCE_DEVICE_SCALE_FACTOR, '1');
      assert.equal(options.env.NODE_OPTIONS, undefined);
      fs.writeFileSync(options.env.QA_RESULT_PATH, JSON.stringify({ source: 'result-file' }));
      return {
        status: 0, signal: null, error: null,
        stdout: JSON.stringify({ source: 'stdout' }), stderr: '',
      };
    },
  }), /stdout and QA_RESULT_PATH envelopes differ/);
  assert.equal(calls, 1);
});

test('bounded Chromium trace reader validates the whole artifact and retains only required windows', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-trace-stream-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'chromium-trace.json');
  const startName = goal24TraceMarkName('interaction-1', 'ledgerOpen', 'start');
  const boundaryName = goal24TraceMarkName(
    'interaction-1',
    'ledgerOpen',
    'marker',
    'post-outcome-render-boundary',
  );
  const events = [
    { args: { name: 'CrRendererMain' }, cat: '__metadata', name: 'thread_name', ph: 'M', pid: 7, tid: 8, ts: 0 },
    { args: {}, cat: 'loading', name: 'outside-before', ph: 'X', pid: 7, tid: 8, ts: 10, dur: 2 },
    { args: {}, cat: 'blink.user_timing', name: startName, ph: 'R', pid: 7, tid: 8, ts: 100 },
    { args: {}, cat: 'devtools.timeline', name: 'RunTask', ph: 'X', pid: 7, tid: 8, ts: 110, dur: 70 },
    { args: {}, cat: 'blink.user_timing', name: boundaryName, ph: 'R', pid: 7, tid: 8, ts: 200 },
    ...Array.from({ length: 20_000 }, (_, index) => ({
      args: {}, cat: 'loading', name: `outside-after-${index}`, ph: 'X',
      pid: 7, tid: 8, ts: 1_000 + index * 10, dur: 1,
    })),
  ];
  const source = `{"traceEvents":[\n${events.map(JSON.stringify).join(',\n')}],"metadata":\n`
    + `${JSON.stringify({ 'clock-domain': 'WIN_QPC', source: 'unit-test' })}}\n`;
  fs.writeFileSync(file, source, 'utf8');

  const streamed = readGoal24ChromiumTraceArtifact(file, {
    label: 'unit trace',
    interactionIds: ['interaction-1'],
  });
  assert.equal(streamed.source.bytes, Buffer.byteLength(source));
  assert.equal(
    streamed.source.sha256,
    createHash('sha256').update(source).digest('hex'),
  );
  assert.equal(streamed.source.traceEventCount, events.length);
  assert.equal(streamed.source.retainedTraceEventCount, 4);
  assert.deepEqual(streamed.sourceOrdinals, [0, 2, 3, 4]);
  assert.deepEqual(
    streamed.traceDocument.traceEvents.map(({ name }) => name),
    ['thread_name', startName, 'RunTask', boundaryName],
  );
  assert.equal(streamed.source.parser, 'bounded-two-pass-chromium-json-lines-v1');
});

test('bounded Chromium trace reader fails closed on malformed event or envelope JSON', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-trace-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const malformedEvent = path.join(directory, 'malformed-event.json');
  fs.writeFileSync(
    malformedEvent,
    '{"traceEvents":[\n{"cat":"gpu",}],"metadata":\n{}}\n',
    'utf8',
  );
  assert.throws(
    () => readGoal24ChromiumTraceArtifact(malformedEvent, { label: 'malformed event' }),
    /malformed event is not valid JSON: trace event 1/u,
  );

  const malformedEnvelope = path.join(directory, 'malformed-envelope.json');
  fs.writeFileSync(
    malformedEnvelope,
    '{"traceEvents":[\n{"cat":"gpu","name":"GpuTask"}],"metadata":\n{"broken":true}\n',
    'utf8',
  );
  assert.throws(
    () => readGoal24ChromiumTraceArtifact(malformedEnvelope, { label: 'malformed envelope' }),
    /Chromium metadata envelope is malformed/u,
  );
});

test('orchestrator never starts a second Electron child after the first child exits nonzero', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-serialized-stop-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  let calls = 0;
  assert.throws(() => runOrchestrator({
    suite: 'smoke', phase: 'baseline', sessionId: 'serialized-stop', out,
  }, {
    spawn(_command, _args, options) {
      calls += 1;
      assert.equal(options.shell, false);
      return { status: 17, signal: null, error: null, stdout: '', stderr: 'synthetic failure' };
    },
  }), /Electron child exited 17/);
  assert.equal(calls, 1);
  const failure = JSON.parse(fs.readFileSync(path.join(out, 'serialized-stop', 'failure.json'), 'utf8'));
  assert.equal(failure.state, 'failed-closed');
  assert.equal(failure.completedRuns.length, 0);
});

test('source contract uses synchronous no-shell children and calls the locked evaluator', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/goal24-interaction-performance.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /import \{ spawnSync \} from 'node:child_process'/);
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /Promise\.all\([^)]*executeRun/);
  assert.match(source, /evaluateLockedInteractionPerformanceReport/);
  assert.match(source, /Trace and overlay\/video legs are diagnostic only/);
});

test('GPU matrix cleanup detaches the render producer before flushing its final query', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/electron-goal24-interaction-performance.js', import.meta.url),
    'utf8',
  );
  const cleanup = source.slice(
    source.indexOf('const gpuFrameTimingCleanup ='),
    source.indexOf('const resourceDispose ='),
  );
  const detachAt = cleanup.indexOf('owner.detach?.() === true');
  const flushAt = cleanup.indexOf('owner.probe.flush');
  assert.ok(detachAt >= 0 && flushAt > detachAt,
    'the wrapper must stop enqueuing queries before the bounded flush starts');
  assert.match(cleanup, /if \(!detached\) throw new Error/,
    'failure to detach must fail closed instead of disposing an incomplete stream');
  assert.match(source, /gpuFrameTimingCleanup\.flushGpuValidity\?\.valid === true/,
    'acceptance requires the detached flush itself to report a valid GPU stream');
});

test('warmed tool driver never stages a cycle edge with direct setTool mutation', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/electron-goal24-interaction-performance.js', import.meta.url),
    'utf8',
  );
  const warmedBlock = source.slice(
    source.indexOf('for (let index = 0; index < 20; index += 1)'),
    source.indexOf("if (wants('npc', 'nav'))"),
  );
  assert.ok(warmedBlock.length > 0);
  assert.doesNotMatch(warmedBlock, /setTool\s*\(/);
  assert.doesNotMatch(warmedBlock, /stageAfterLastTool/);
  assert.match(warmedBlock, /switchTool\(/);
});

test('tool first-use staging is cold, settled, and observable beyond the locked response gate', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/electron-goal24-interaction-performance.js', import.meta.url),
    'utf8',
  );
  const budget = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds
    .maximumColdInteractionDurationMs.toolFirstUseByTool;
  assert.equal(budget, 6000);
  assert.match(source,
    /toolPresentationObservationTimeoutMs = Math\.max\(\s*12_000,\s*coldToolFirstUseBudgetMs \* 2/,
    'observer timeout must exceed the contract threshold so the contract judges slow events');
  const staging = source.slice(
    source.indexOf('const bareHandsStage ='),
    source.indexOf('const toolKey ='),
  );
  for (const invariant of [
    "book?.state === 'closed'", 'held?.heldRootVisible === false',
    'held?.visibleHeldGroups?.length === 0', 'held?.animation?.settled === true',
    'held?.stationStowedTool == null', 'viewmodels?.equippedTool == null',
    'composedRenders >= stage.composedRenders + 3', 'elapsedMs >= 180',
  ]) assert.ok(staging.includes(invariant), `missing bare-hands staging invariant: ${invariant}`);
  assert.doesNotMatch(staging, /setTool\(['"](?:vacuum|mop|broom|dustpan|spray|cloth|sponge|trashbag)/,
    'staging cannot pre-equip or prewarm a measured tool');
});

test('ledger turn observer outlives the locked response gate without changing it', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/electron-goal24-interaction-performance.js', import.meta.url),
    'utf8',
  );
  const budget = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.thresholds
    .maximumWarmInteractionDurationMs.ledgerPageTurns10;
  assert.equal(budget, 1500);
  assert.match(source,
    /ledgerPageTurnObservationTimeoutMs = Math\.max\(\s*12_000,\s*warmLedgerPageTurnBudgetMs \* 8/,
    'observer timeout must exceed the contract threshold so the contract judges slow turns');
  const turnBlock = source.slice(
    source.indexOf('const turnLedger ='),
    source.indexOf("if (wants('ledger', 'ledger-stress'))"),
  );
  assert.equal(
    turnBlock.match(/timeout: ledgerPageTurnObservationTimeoutMs/g)?.length,
    2,
    'both production-start and settled-turn observers must use the extended horizon',
  );
  assert.doesNotMatch(turnBlock, /timeout:\s*(?:2500|7000)/,
    'short observer timeouts must not preempt the locked evaluator');
});

test('video-leg overlay observes each recorder-owned scenario before measurement begins', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/electron-goal24-interaction-performance.js', import.meta.url),
    'utf8',
  );
  const beginBlock = source.slice(
    source.indexOf('const begin = async ('),
    source.indexOf('const end = async ('),
  );
  assert.match(beginBlock,
    /beginInteractionWindow\([\s\S]*?__goal24PerformanceOverlay[\s\S]*?updateNow\?\.\(\)[\s\S]*?seenInteractionLabels\?\.includes\(expectedScenario\)[\s\S]*?restartInteractionMeasurement/,
    'the non-grading overlay must synchronously read the active recorder label before the timed boundary');
  assert.ok(
    source.indexOf('? await installPerformanceOverlay()')
      < source.indexOf("if (wants('door'))"),
    'the overlay must exist before the one-time cold door/open/crossing sequence',
  );
});

test('door windows retain enough post-outcome production renders for non-shadow statistics', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/electron-goal24-interaction-performance.js', import.meta.url),
    'utf8',
  );
  const endBlock = source.slice(
    source.indexOf('const end = async ('),
    source.indexOf('const mark =', source.indexOf('const end = async (')),
  );
  assert.match(endBlock,
    /scenario === 'doorApproach'[\s\S]*?scenario\.startsWith\('doorCrossing:'\)/);
  assert.match(endBlock,
    /const postOutcomeRenderCount = doorwayRenderEvidenceRequired \? 8 : 2;/);
  assert.match(endBlock,
    /awaitInteractionRenders\(\s*page,\s*postOutcomeRenderCount,\s*3000,/);
  assert.match(endBlock, /postOutcomeRenderCount,/,
    'the raw discriminator records which tail requirement closed the window');
});

test('warm door repetitions reset through the shipping interaction outside measurement', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/electron-goal24-interaction-performance.js', import.meta.url),
    'utf8',
  );
  const resetBlock = source.slice(
    source.indexOf('const ensureMainDoorClosedOutsideMeasurement ='),
    source.indexOf('const approachDoor ='),
  );
  assert.match(resetBlock, /stageDoor\('outside', 2\.05\)/,
    'the reset must enter the real main-door focus radius');
  assert.match(resetBlock, /page\.keyboard\.press\(interact\)/,
    'the reset must use the shipping trusted-key interaction path');
  assert.match(resetBlock, /main-entrance-close-applied/,
    'the reset must observe the production close signal');
  assert.match(resetBlock,
    /reset\.clearObservation\s*=\s*await readDoor\(reset\.clearStage\.target\)/,
    'an already-closed door must be accepted without relying on animation-frame polling');
  assert.match(resetBlock, /if \(!isSettledClosed\(reset\.clearObservation\)\)/,
    'the asynchronous settle wait must only run when the immediate observation needs it');
  assert.match(resetBlock, /\{ polling: 25, timeout: 7000 \}/,
    'an unsettled door must use timer polling so a starved rAF cannot create a false timeout');
  assert.doesNotMatch(resetBlock, /setMainAssemblyOpen|setMainLeafOpen|desiredOpen\s*=/,
    'the reset cannot mutate door state directly');

  const approachBlock = source.slice(
    source.indexOf('const approachDoor ='),
    source.indexOf('const ensureMainDoorOpenOutsideMeasurement ='),
  );
  assert.ok(
    approachBlock.indexOf('ensureMainDoorClosedOutsideMeasurement()')
      < approachBlock.indexOf('await begin(`door-approach-${repetition}`'),
    'the warm reset must complete before the recorder-owned measurement starts',
  );
  assert.match(approachBlock, /preMeasurementDoorReset,/,
    'raw evidence must retain the exact out-of-window reset result');
});
