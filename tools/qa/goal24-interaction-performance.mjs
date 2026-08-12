#!/usr/bin/env node

// Goal 24 interaction-performance orchestrator.
//
// The default invocation is intentionally exhaustive. It launches seven fresh
// Electron processes for the linked cold launch/start/door samples, one separate
// low-overhead interaction and resource-stress process, the four-entry display
// matrix, one CDP trace process, and one overlay/video process. Electron children
// are invoked synchronously and therefore can never overlap the repository lock.
//
//   node tools/qa/goal24-interaction-performance.mjs --phase=baseline
//   node tools/qa/goal24-interaction-performance.mjs --phase=comparison \
//     --reference=qa/goal24/performance/interaction/orchestrated/<baseline>/aggregate.json
//   node tools/qa/goal24-interaction-performance.mjs --suite=smoke

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { PNG } from 'pngjs';

import {
  LOCKED_INTERACTION_PERFORMANCE_PROTOCOL,
  LOCKED_INTERACTION_PERFORMANCE_SCHEMA_VERSION,
  evaluateLockedInteractionPerformanceReport,
  goal24NpcNavEvidenceFailures,
} from './locked-performance-contract.mjs';
import {
  analyzeGoal24ChromiumTrace,
  validateGoal24TraceAttribution,
} from './lib/goal24-trace-attribution.mjs';
import {
  GOAL24_SUPPORTED_TOOL_IDS,
  GOAL24_SUPPORTED_TOOL_MANIFEST,
  assertGoal24ToolManifest,
  goal24ToolEvidenceFailures,
} from './lib/goal24-tool-manifest.mjs';
import {
  GOAL24_DOOR_SCENARIOS,
  aggregateGoal24DoorEvidence,
  compareGoal24DoorEvidenceAggregates,
  validateGoal24DoorCohort,
  validateGoal24DoorEvidenceAggregate,
  validateGoal24DoorwayRenderEvidence,
} from './lib/goal24-door-evidence.mjs';
import { validateGoal24ResourceSnapshot } from './lib/goal24-resource-diagnostics.mjs';
import {
  analyzeGoal24Webm,
  goal24VisualEvidenceDigest,
  goal24VisualEvidencePayload,
  validateGoal24VisualMarkerPixels,
} from './lib/goal24-visual-evidence.mjs';

export const GOAL24_ORCHESTRATOR_SCHEMA = 'golf-flipper/goal24-performance-orchestrator/v1';
export const REQUIRED_COLD_PROCESS_COUNT = 7;
export const DEFAULT_SEED = 424242;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = path.join(ROOT, 'tools', 'qa', 'run-electron.cjs');
const DRIVER = path.join(ROOT, 'tools', 'qa', 'electron-goal24-interaction-performance.js');
const VIDEO_DECODE_VALIDATOR = path.join(ROOT, 'tools', 'qa', 'goal24-video-decode.mjs');
const DEFAULT_OUT = path.join(ROOT, 'qa', 'goal24', 'performance', 'interaction', 'orchestrated');
const ALL_LEGS = Object.freeze(['cold', 'full', 'matrix', 'trace', 'overlay']);
const ACCEPTANCE_COLD_SCENARIOS = Object.freeze([
  'coldLaunch',
  'startToControllable',
  'doorApproach',
  'doorFirstOpen',
  'doorCrossingOutsideToInside',
  'doorCrossingInsideToOutside',
]);
const CONTRIBUTION_RAW_SCENARIOS = Object.freeze({
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
});
const MATRIX = Object.freeze([
  Object.freeze({ id: '1080p-windowed', width: 1920, height: 1080, mode: 'windowed' }),
  Object.freeze({ id: '1440p-windowed', width: 2560, height: 1440, mode: 'windowed' }),
  Object.freeze({ id: '4k-windowed', width: 3840, height: 2160, mode: 'windowed' }),
  Object.freeze({ id: '4k-fullscreen', width: 3840, height: 2160, mode: 'fullscreen' }),
]);

const clone = (value) => structuredClone(value);
const slash = (value) => String(value).replaceAll('\\', '/');
const safe = (value) => String(value || '')
  .replace(/[^a-z0-9._-]+/gi, '-')
  .replace(/^-+|-+$/g, '') || 'run';

function list(value, fallback = []) {
  if (value == null || value === '') return [...fallback];
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function integer(value, fallback, label) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function booleanFlag(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (value === true || value === '1' || value === 'true') return true;
  if (value === false || value === '0' || value === 'false') return false;
  throw new Error(`Expected a boolean flag, received ${value}.`);
}

export function parseCli(argv = process.argv.slice(2), env = process.env) {
  const parsed = {
    suite: env.GOAL24_PERF_SUITE || 'full',
    phase: env.GOAL24_PERF_PHASE || 'baseline',
    legs: env.GOAL24_PERF_LEGS || null,
    coldRuns: env.GOAL24_PERF_COLD_RUNS || null,
    matrixCases: env.GOAL24_PERF_MATRIX_CASES || null,
    out: env.GOAL24_PERF_ORCHESTRATOR_OUT || null,
    sessionId: env.GOAL24_PERF_SESSION_ID || null,
    reference: env.GOAL24_PERF_REFERENCE || null,
    dryRun: booleanFlag(env.GOAL24_PERF_DRY_RUN, false),
  };
  for (const argument of argv) {
    if (argument === '--dry-run') parsed.dryRun = true;
    else if (argument === '--help' || argument === '-h') parsed.help = true;
    else if (argument.startsWith('--suite=')) parsed.suite = argument.slice(8);
    else if (argument.startsWith('--phase=')) parsed.phase = argument.slice(8);
    else if (argument.startsWith('--legs=')) parsed.legs = argument.slice(7);
    else if (argument.startsWith('--cold-runs=')) parsed.coldRuns = argument.slice(12);
    else if (argument.startsWith('--matrix=')) parsed.matrixCases = argument.slice(9);
    else if (argument.startsWith('--out=')) parsed.out = argument.slice(6);
    else if (argument.startsWith('--session-id=')) parsed.sessionId = argument.slice(13);
    else if (argument.startsWith('--reference=')) parsed.reference = argument.slice(12);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!['full', 'smoke'].includes(parsed.suite)) throw new Error('--suite must be full or smoke.');
  if (!['baseline', 'comparison'].includes(parsed.phase)) {
    throw new Error('--phase must be baseline or comparison.');
  }
  if (parsed.phase === 'comparison' && !parsed.reference) {
    throw new Error('--phase=comparison requires --reference=<baseline aggregate.json>.');
  }
  return parsed;
}

export function pinnedProtocolMetadata(options = {}) {
  const seed = Number(options.seed ?? DEFAULT_SEED);
  if (!Number.isInteger(seed)) throw new Error('Goal 24 seed must be an integer.');
  return {
    seed,
    clubhouse: 'pine-hills-v2',
    saveFixture: `relaxed-seed-${seed}`,
    route: 'goal24-indoor-route-v1',
    camera: 'goal24-first-person-player-camera-v1',
    toolManifest: clone(GOAL24_SUPPORTED_TOOL_MANIFEST),
    acceptanceResolution: { width: 1920, height: 1080 },
    acceptanceDevicePixelRatio: 1,
    forcedDeviceScaleFactor: 1,
    acceptanceWindowMode: 'windowed',
    quality: {
      preset: 'high',
      renderScale: 1,
      shadows: true,
      ambientOcclusion: true,
      bloom: true,
    },
    cache: {
      userDataPolicy: 'isolated-fresh-per-cold-process',
      chromiumDiskCache: 'fresh-with-generated-profile',
      shaderCache: 'host-managed-not-cleared',
      gpuDriverCache: 'host-managed-not-cleared',
      warmProfileReuse: 'disabled',
    },
    coldProcesses: REQUIRED_COLD_PROCESS_COUNT,
    coldDoorPolicy: 'one cold approach then warm approaches and crossings in each fresh process',
    stress: { ledgerTurns: 50, toolSwitches: 100, minimumToolChanges: 20 },
    indoorWalkDurationMs: 60_000,
    capLadder: [60, 120, 144, 0],
    settleDurationMs: 2_500,
    recorderCalibrationDurationMs: 1_500,
    negativeControlStallMs: 80,
    matrixWindowSizing: 'exact-runner-window-sizing-for-windowed-matrix-legs',
    chromiumTraceCategories:
      'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8,renderer.scheduler,cc,gpu',
  };
}

function baseRunEnv(pinned, run, suite, phase, sessionId) {
  return {
    GOAL24_PERF_RUN_ID: run.id,
    GOAL24_PERF_SESSION_ID: sessionId,
    GOAL24_PERF_PHASE: phase,
    GOAL24_PERF_SEED: String(pinned.seed),
    GOAL24_PERF_ROUTE: pinned.route,
    GOAL24_PERF_CAMERA: pinned.camera,
    GOAL24_PERF_TOOL_MANIFEST: JSON.stringify(pinned.toolManifest),
    GOAL24_PERF_SAVE_FIXTURE: pinned.saveFixture,
    GOAL24_PERF_QUALITY: pinned.quality.preset,
    GOAL24_PERF_SHADER_CACHE_POLICY: pinned.cache.shaderCache,
    GOAL24_PERF_GPU_CACHE_POLICY: pinned.cache.gpuDriverCache,
    GOAL24_PERF_USER_DATA_POLICY: pinned.cache.userDataPolicy,
    GOAL24_PERF_RESOLUTION: `${run.width}x${run.height}`,
    GOAL24_PERF_FULLSCREEN: run.mode === 'fullscreen' ? '1' : '0',
    QA_FORCE_DEVICE_SCALE_FACTOR: String(pinned.forcedDeviceScaleFactor),
    GOAL24_PERF_SCENARIOS: run.scenarios,
    GOAL24_PERF_WALK_MS: String(suite === 'smoke' ? 5_000 : pinned.indoorWalkDurationMs),
    GOAL24_PERF_CAPS: pinned.capLadder.join(','),
    GOAL24_PERF_SETTLE_MS: String(pinned.settleDurationMs),
    GOAL24_PERF_CALIBRATION_MS: String(pinned.recorderCalibrationDurationMs),
    GOAL24_PERF_DISABLE_STALL_CONTROL: '0',
    GOAL24_PERF_MATRIX_RAW_WINDOW: run.leg === 'matrix' && run.mode === 'windowed' ? '1' : '0',
    GOAL24_PERF_GPU_FRAME_TIMING: run.leg === 'matrix' ? '1' : '0',
    QA_CHROMIUM_TRACE_CATEGORIES: pinned.chromiumTraceCategories,
    QA_INSTRUMENTATION_MODE: run.instrumentation,
  };
}

export function buildRunPlan(options = {}) {
  const suite = options.suite || 'full';
  const phase = options.phase || 'baseline';
  if (!['full', 'smoke'].includes(suite)) throw new Error('suite must be full or smoke.');
  if (!['baseline', 'comparison'].includes(phase)) throw new Error('phase must be baseline or comparison.');
  if (phase === 'comparison' && !options.reference) {
    throw new Error('comparison phase requires a reference aggregate.');
  }
  const selectedLegs = list(options.legs, suite === 'smoke' ? ['cold', 'full'] : ALL_LEGS);
  if (new Set(selectedLegs).size !== selectedLegs.length
      || selectedLegs.some((leg) => !ALL_LEGS.includes(leg))) {
    throw new Error(`--legs must contain unique values from ${ALL_LEGS.join(', ')}.`);
  }
  const coldRuns = integer(options.coldRuns, suite === 'smoke' ? 1 : REQUIRED_COLD_PROCESS_COUNT, 'cold run count');
  const matrixIds = list(options.matrixCases, MATRIX.map(({ id }) => id));
  if (new Set(matrixIds).size !== matrixIds.length
      || matrixIds.some((id) => !MATRIX.some((entry) => entry.id === id))) {
    throw new Error(`--matrix must contain unique values from ${MATRIX.map(({ id }) => id).join(', ')}.`);
  }
  const pinned = pinnedProtocolMetadata(options);
  const sessionId = safe(options.sessionId || [
    new Date().toISOString().replace(/[:.]/g, '-'),
    phase,
    randomUUID().slice(0, 8),
  ].join('-'));
  const runs = [];
  const add = (descriptor) => {
    const ordinal = runs.length + 1;
    const run = {
      ordinal,
      id: safe(`${sessionId}-${String(ordinal).padStart(2, '0')}-${descriptor.name}`),
      width: descriptor.width ?? pinned.acceptanceResolution.width,
      height: descriptor.height ?? pinned.acceptanceResolution.height,
      mode: descriptor.mode ?? pinned.acceptanceWindowMode,
      ...descriptor,
    };
    run.env = { ...baseRunEnv(pinned, run, suite, phase, sessionId), ...(descriptor.env || {}) };
    delete run.env.GOAL24_PERF_OUT;
    runs.push(run);
  };

  if (selectedLegs.includes('cold')) {
    for (let index = 0; index < coldRuns; index += 1) {
      add({
        name: `cold-door-${String(index + 1).padStart(2, '0')}`,
        leg: 'cold',
        role: 'acceptance-cold',
        instrumentation: 'low-overhead',
        gradeEligible: suite === 'full' && coldRuns === REQUIRED_COLD_PROCESS_COUNT,
        scenarios: 'door',
        coldIndex: index + 1,
      });
    }
  }
  if (selectedLegs.includes('full')) {
    add({
      name: 'full-interaction-stress',
      leg: 'full',
      role: 'acceptance-full',
      instrumentation: 'low-overhead',
      gradeEligible: suite === 'full' && coldRuns === REQUIRED_COLD_PROCESS_COUNT,
      scenarios: suite === 'smoke'
        ? 'negative-control,idle,indoor-walk,npc'
        : 'negative-control,idle,indoor-walk,ledger,ledger-stress,tool,tool-stress,npc',
    });
  }
  if (selectedLegs.includes('matrix')) {
    for (const matrix of MATRIX.filter(({ id }) => matrixIds.includes(id))) {
      add({
        name: `matrix-${matrix.id}`,
        leg: 'matrix',
        role: 'diagnostic-matrix',
        instrumentation: 'low-overhead',
        gradeEligible: false,
        scenarios: 'idle,indoor-walk,cap-ladder',
        ...matrix,
      });
    }
  }
  if (selectedLegs.includes('trace')) {
    add({
      name: 'cdp-trace',
      leg: 'trace',
      role: 'diagnostic-trace',
      instrumentation: 'cdp-trace',
      gradeEligible: false,
      scenarios: 'door,ledger,tool,npc',
    });
  }
  if (selectedLegs.includes('overlay')) {
    add({
      name: 'overlay-video',
      leg: 'overlay',
      role: 'diagnostic-overlay-video',
      instrumentation: 'video',
      gradeEligible: false,
      scenarios: 'door,ledger,tool,npc',
      env: { GOAL24_PERF_OVERLAY: '1' },
    });
  }

  const acceptanceEligible = suite === 'full'
    && selectedLegs.includes('cold')
    && selectedLegs.includes('full')
    && coldRuns === REQUIRED_COLD_PROCESS_COUNT;
  const completeProtocol = acceptanceEligible
    && ALL_LEGS.every((leg) => selectedLegs.includes(leg))
    && matrixIds.length === MATRIX.length;
  if (phase === 'comparison' && !completeProtocol) {
    throw new Error('comparison phase requires the unfiltered complete protocol.');
  }
  return {
    schema: GOAL24_ORCHESTRATOR_SCHEMA,
    sessionId,
    suite,
    phase,
    selectedLegs,
    coldRuns,
    matrixIds,
    acceptanceEligible,
    completeProtocol,
    pinned,
    runs,
  };
}

export function parseFinalJson(stdout) {
  const source = String(stdout || '').trim();
  if (!source) throw new Error('Electron runner stdout was empty; expected its final JSON envelope.');
  const candidates = [];
  for (let index = source.lastIndexOf('{'); index >= 0;) {
    candidates.push(index);
    if (index === 0) break;
    index = source.lastIndexOf('{', index - 1);
  }
  for (const index of candidates) {
    try {
      const parsed = JSON.parse(source.slice(index));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* try the previous opening brace */ }
  }
  throw new Error('Electron runner stdout did not end with a parseable JSON envelope.');
}

function required(value, message) {
  if (!value) throw new Error(message);
}

function canonicalFilesystemPath(value) {
  const resolved = path.resolve(String(value));
  let canonical = resolved;
  try { canonical = fs.realpathSync.native(resolved); } catch { /* runner already removed the leaf */ }
  return process.platform === 'win32' ? canonical.replaceAll('\\', '/').toLowerCase() : canonical;
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

export function assertRegularArtifactFile(file, allowedRoot, label = 'artifact') {
  const absoluteRoot = path.resolve(allowedRoot);
  const absoluteFile = path.resolve(file);
  required(absoluteFile !== absoluteRoot && pathIsWithin(absoluteRoot, absoluteFile),
    `${label} escaped its allowed output root.`);
  required(fs.existsSync(absoluteRoot), `${label} output root is missing.`);
  const rootStat = fs.lstatSync(absoluteRoot);
  required(rootStat.isDirectory() && !rootStat.isSymbolicLink(),
    `${label} output root is not a regular directory (symbolic links/junctions are forbidden).`);
  const relative = path.relative(absoluteRoot, absoluteFile);
  let cursor = absoluteRoot;
  const segments = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    required(fs.existsSync(cursor), `${label} is missing: ${cursor}`);
    const stat = fs.lstatSync(cursor);
    required(!stat.isSymbolicLink(), `${label} path contains a symbolic link or junction: ${cursor}`);
    if (index === segments.length - 1) {
      required(stat.isFile(), `${label} is not a regular file: ${cursor}`);
    } else {
      required(stat.isDirectory(), `${label} parent is not a directory: ${cursor}`);
    }
  }
  const canonicalRoot = fs.realpathSync.native(absoluteRoot);
  const canonicalFile = fs.realpathSync.native(absoluteFile);
  required(pathIsWithin(canonicalRoot, canonicalFile), `${label} resolved outside its allowed output root.`);
  return canonicalFile;
}

function runnerRuntimeVersions(envelope) {
  return envelope.runner?.readbacks?.afterDriver?.main?.runtimeVersions
    || envelope.runner?.launch?.runtimeVersions
    || null;
}

function containsPinnedValues(actual, expected) {
  if (expected == null || typeof expected !== 'object') return Object.is(actual, expected);
  if (actual == null || typeof actual !== 'object') return false;
  return Object.entries(expected).every(([key, value]) => containsPinnedValues(actual[key], value));
}

export function validateRunnerProcessIdentity(envelope, run) {
  const runner = envelope?.runner;
  const launch = runner?.launch;
  const lock = runner?.repository?.launchLock;
  required(typeof launch?.launchId === 'string' && launch.launchId.length > 0,
    `${run.id}: runner launch instance ID is missing.`);
  required(Number.isInteger(launch?.parentPid) && launch.parentPid > 0,
    `${run.id}: runner parent PID is missing.`);
  required(lock?.ownerPid === launch.parentPid && lock?.ownerLaunchId === launch.launchId,
    `${run.id}: repository launch-lock owner is not the runner launch instance.`);
  const launchedMain = launch?.electronMainProcessIdentity;
  required(Number.isInteger(launchedMain?.pid) && launchedMain.pid === launch.electronPid,
    `${run.id}: launched Electron main-process PID is not bound to the child handle.`);
  required(Number.isFinite(launchedMain?.creationTimeEpochMs)
    && launchedMain.creationTimeEpochMs > 0
    && Number.isSafeInteger(launchedMain?.creationTimeEpochUs)
    && launchedMain.creationTimeEpochUs > 0
    && launchedMain.type === 'Browser',
  `${run.id}: launched Electron main-process start token is missing.`);
  required(runner?.processes?.initialSnapshot?.browserIdentity?.pid === launchedMain.pid
    && runner.processes.initialSnapshot.browserIdentity.creationTimeEpochMs
      === launchedMain.creationTimeEpochMs
    && runner.processes.initialSnapshot.browserIdentity.creationTimeEpochUs
      === launchedMain.creationTimeEpochUs
    && runner?.processes?.initialOsAttestation?.confirmed === true,
  `${run.id}: Electron main-process PID/start token lacks an independent OS attestation.`);
  const playwrightProcess = launch?.playwrightProcessIdentity;
  const relationship = launch?.processRelationship;
  required(Number.isInteger(launch?.playwrightProcessPid)
    && launch.playwrightProcessPid > 0
    && playwrightProcess?.pid === launch.playwrightProcessPid
    && Number.isFinite(playwrightProcess?.creationTimeEpochMs)
    && playwrightProcess.creationTimeEpochMs > 0
    && Number.isSafeInteger(playwrightProcess?.creationTimeEpochUs)
    && playwrightProcess.creationTimeEpochUs > 0
    && playwrightProcess.pid !== launchedMain.pid,
  `${run.id}: Playwright shell-wrapper process identity is missing or aliases Electron.`);
  required(relationship?.confirmed === true
    && relationship.kind === 'direct-shell-parent'
    && relationship.playwrightProcessIdentity?.pid === playwrightProcess.pid
    && relationship.playwrightProcessIdentity?.creationTimeEpochMs
      === playwrightProcess.creationTimeEpochMs
    && relationship.playwrightProcessIdentity?.creationTimeEpochUs
      === playwrightProcess.creationTimeEpochUs
    && relationship.electronMainProcessIdentity?.pid === launchedMain.pid
    && relationship.electronMainProcessIdentity?.creationTimeEpochMs
      === launchedMain.creationTimeEpochMs
    && relationship.electronMainProcessIdentity?.creationTimeEpochUs
      === launchedMain.creationTimeEpochUs
    && relationship.electronMainOsIdentity?.pid === launchedMain.pid
    && relationship.electronMainOsIdentity?.creationTimeEpochMs
      === launchedMain.creationTimeEpochMs
    && relationship.electronMainOsIdentity?.creationTimeEpochUs
      === launchedMain.creationTimeEpochUs
    && relationship.electronMainOsIdentity?.parentPid === playwrightProcess.pid,
  `${run.id}: Playwright wrapper to Electron Browser OS lineage is unproven.`);
  const readbacks = [
    runner?.readbacks?.beforeDriver,
    ...(runner?.readbacks?.driverSnapshots || []),
    runner?.readbacks?.afterDriver,
  ].filter(Boolean);
  required(readbacks.length >= 2, `${run.id}: main-process identity readbacks are incomplete.`);
  required(readbacks.every(({ main }) => {
    const exactBrowserEntries = Array.isArray(main?.processes)
      ? main.processes.filter((entry) => entry?.type === 'Browser'
        && entry.pid === launchedMain.pid
        && entry.creationTimeEpochMs === launchedMain.creationTimeEpochMs)
      : [];
    return main?.process?.pid === launchedMain.pid
      && main.process.creationTimeEpochMs === launchedMain.creationTimeEpochMs
      && main.process.creationTimeEpochUs === launchedMain.creationTimeEpochUs
      && main.process.type === 'Browser'
      && exactBrowserEntries.length === 1;
  }), `${run.id}: Electron main-process PID/start token drifted across runner readbacks.`);
  return {
    launchId: launch.launchId,
    electronMainProcessIdentity: clone(launchedMain),
  };
}

export function validateRunnerEnvelope(envelope, run, { profilePaths = new Set() } = {}) {
  required(envelope && typeof envelope === 'object', `${run.id}: runner envelope is missing.`);
  required(envelope.result && typeof envelope.result === 'object', `${run.id}: result is missing.`);
  required(envelope.result.ok === true, `${run.id}: raw driver returned ok:false.`);
  required(envelope.result.runId === run.id, `${run.id}: raw driver run ID does not match.`);
  required(envelope.runner?.schemaVersion === 'golf-flipper/electron-runner/v1', `${run.id}: unknown runner schema.`);
  const clubhouseArgs = Array.isArray(envelope.electronArgs)
    ? envelope.electronArgs.filter((arg) => String(arg).startsWith('--clubhouse=')) : [];
  required(clubhouseArgs.length === 1 && clubhouseArgs[0] === '--clubhouse=pine-hills-v2',
  `${run.id}: Electron was not launched with the pinned clubhouse.`);
  required(envelope.runner?.profile?.mode === 'isolated-temporary', `${run.id}: profile was not isolated.`);
  required(envelope.runner?.profile?.generated === true, `${run.id}: profile was not freshly generated.`);
  required(envelope.runner?.profile?.matchesPinnedPath === true, `${run.id}: Electron did not use its pinned profile.`);
  required(Number.isInteger(envelope.runner?.launch?.electronPid)
    && envelope.runner.launch.electronPid > 0, `${run.id}: Electron child PID is missing.`);
  const processIdentity = validateRunnerProcessIdentity(envelope, run);
  const profilePath = envelope.runner.profile.actualPath || envelope.runner.profile.path;
  required(typeof profilePath === 'string' && profilePath.length > 0, `${run.id}: profile path is missing.`);
  required(path.isAbsolute(profilePath), `${run.id}: profile path is not absolute.`);
  const canonicalProfile = canonicalFilesystemPath(profilePath);
  required(canonicalFilesystemPath(envelope.runner.profile.path) === canonicalProfile,
    `${run.id}: requested and actual profile paths differ.`);
  const userDataArgs = envelope.electronArgs.filter((arg) => String(arg).startsWith('--user-data-dir='));
  required(userDataArgs.length === 1
    && canonicalFilesystemPath(userDataArgs[0].slice('--user-data-dir='.length)) === canonicalProfile,
  `${run.id}: Electron user-data argument does not match the actual profile.`);
  required(!profilePaths.has(canonicalProfile), `${run.id}: user-data profile was reused.`);
  profilePaths.add(canonicalProfile);
  required(envelope.runner?.cleanup?.electronApplication?.closed === true
    && envelope.runner.cleanup.electronApplication.confirmedExited === true,
  `${run.id}: Electron cleanup is unproven.`);
  const processTree = envelope.runner.cleanup.electronApplication.processTree;
  required(processTree?.snapshotCaptured === true
    && Number.isInteger(processTree.identityCount) && processTree.identityCount > 0
    && processTree.preCloseAttestation?.confirmed === true
    && Array.isArray(processTree.exitSnapshot?.processes)
    && processTree.exitSnapshot.processes.length === processTree.identityCount
    && processTree.verification?.confirmedExited === true
    && processTree.confirmedExited === true,
  `${run.id}: Electron process-tree teardown is unproven.`);
  required(canonicalFilesystemPath(envelope.runner?.cleanup?.profile?.path) === canonicalProfile,
    `${run.id}: cleanup profile identity differs from the launched profile.`);
  required(envelope.runner?.cleanup?.profile?.action === 'remove-generated-leaf', `${run.id}: profile cleanup policy is wrong.`);
  required(envelope.runner?.cleanup?.profile?.removed === true, `${run.id}: generated profile was not removed.`);
  required(envelope.runner?.cleanup?.profile?.existsAfterCleanup === false, `${run.id}: generated profile remains on disk.`);
  required(envelope.runner?.cleanup?.launchLock?.released === true, `${run.id}: repository lock was not released.`);
  required(envelope.runner?.cleanup?.launchLock?.existsAfterCleanup === false, `${run.id}: repository lock remains on disk.`);
  const lockPath = envelope.runner.cleanup.launchLock.path;
  required(typeof lockPath === 'string' && path.isAbsolute(lockPath), `${run.id}: launch-lock path is missing.`);
  required(canonicalFilesystemPath(lockPath)
    === canonicalFilesystemPath(envelope.runner.repository?.launchLock?.path),
  `${run.id}: acquired and released launch-lock paths differ.`);
  required(!fs.existsSync(lockPath), `${run.id}: launch lock still exists after child exit.`);
  required(envelope.runner?.timing?.anchors?.runnerCleanupComplete, `${run.id}: cleanup timing anchor is missing.`);
  const anchors = envelope.runner.timing.anchors;
  required(Number.isFinite(anchors.driverComplete?.epochMs)
    && Number.isFinite(anchors.runnerCleanupComplete?.epochMs)
    && anchors.runnerCleanupComplete.epochMs >= anchors.driverComplete.epochMs,
  `${run.id}: cleanup timing is not ordered after driver completion.`);
  const readbacks = [
    envelope.runner?.readbacks?.beforeDriver,
    ...(envelope.runner?.readbacks?.driverSnapshots || []),
    envelope.runner?.readbacks?.afterDriver,
  ].filter(Boolean);
  required(readbacks.length >= 2 && readbacks.every((entry) => (
    canonicalFilesystemPath(entry?.main?.userDataPath) === canonicalProfile
  )), `${run.id}: runner readback user-data identity drifted from the launched profile.`);
  const runnerDiagnostics = envelope.runner?.diagnostics;
  required(Array.isArray(runnerDiagnostics?.pageErrors)
    && Array.isArray(runnerDiagnostics?.consoleErrors)
    && runnerDiagnostics.pageErrors.length === 0
    && runnerDiagnostics.consoleErrors.length === 0,
  `${run.id}: runner observed a page error or console error across the Electron lifecycle.`);
  required(envelope.runner?.instrumentation?.mode === run.instrumentation, `${run.id}: instrumentation mode drifted.`);
  required(envelope.runner?.instrumentation?.lowOverheadEligible === (run.instrumentation === 'low-overhead'),
    `${run.id}: low-overhead eligibility is inconsistent.`);
  required(envelope.runner?.cachePolicy?.userData === 'fresh-empty-temporary-profile',
    `${run.id}: runner user-data cache policy drifted.`);
  required(envelope.runner?.cachePolicy?.chromiumDiskCache === 'fresh-with-generated-profile',
    `${run.id}: Chromium disk-cache policy drifted.`);
  required(envelope.runner?.cachePolicy?.gpuDriverShaderCache === 'host-managed-not-cleared',
    `${run.id}: GPU shader-cache policy drifted.`);
  required(envelope.runner?.cachePolicy?.warmProfileReuse === 'disabled-by-default',
    `${run.id}: runner unexpectedly enabled warm profile reuse.`);
  const runtimeVersions = runnerRuntimeVersions(envelope);
  for (const key of ['electron', 'chrome', 'node', 'v8']) {
    required(typeof runtimeVersions?.[key] === 'string' && runtimeVersions[key].length > 0,
      `${run.id}: Electron runtime version ${key} is missing.`);
  }
  if (run.instrumentation === 'cdp-trace') {
    required(envelope.runner.instrumentation.chromiumTrace?.status === 'written', `${run.id}: CDP trace was not written.`);
    required(envelope.runner.instrumentation.chromiumTrace?.bytes > 0, `${run.id}: CDP trace is empty.`);
  }
  if (run.instrumentation === 'video') {
    required(envelope.runner.instrumentation.video?.status === 'written', `${run.id}: video was not written.`);
    required(envelope.runner.instrumentation.video?.exists === true, `${run.id}: video is missing.`);
    required(envelope.runner.instrumentation.video?.bytes > 0, `${run.id}: video is empty.`);
    required(isDeepStrictEqual(envelope.runner.instrumentation.video?.size, {
      width: run.width,
      height: run.height,
    }) && envelope.runner.instrumentation.video?.sizeSource === 'GOAL24_PERF_RESOLUTION',
    `${run.id}: Playwright video size is not pinned to the exact run resolution.`);
  }
  return { profilePath, ...processIdentity };
}

function resolveResultPath(value, root = ROOT) {
  required(typeof value === 'string' && value.length > 0, 'Raw driver did not return resultPath.');
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
}

export function validateRawRun(raw, envelope, run) {
  required(raw?.runId === run.id, `${run.id}: raw artifact run ID does not match.`);
  required(raw?.instrumentationMode === run.instrumentation, `${run.id}: raw instrumentation mode drifted.`);
  required(raw?.seed === Number(run.env.GOAL24_PERF_SEED), `${run.id}: raw seed drifted.`);
  required(raw?.controls?.hardwareRenderer === true, `${run.id}: hardware renderer gate failed.`);
  required(raw?.controls?.startGameOccurred === true, `${run.id}: start-to-controllable proof failed.`);
  required(raw?.controls?.noPageErrors === true, `${run.id}: page errors were observed.`);
  required(raw?.controls?.noConsoleErrors === true, `${run.id}: console errors were observed.`);
  required(raw?.controls?.rendererAndDisplayStreamsPresent === true, `${run.id}: cadence stream is missing.`);
  required(raw?.controls?.recorderUninstalled === true, `${run.id}: recorder teardown is unproven.`);
  required(raw?.recorderCalibration?.inactiveIsInert === true, `${run.id}: inactive recorder was not inert.`);
  if (run.instrumentation === 'low-overhead') {
    required(raw?.recorderCalibration?.activeP95OverheadWithinTolerance === true,
      `${run.id}: recorder overhead calibration failed.`);
  }
  if (run.role === 'diagnostic-overlay-video') {
    required(raw?.controls?.performanceOverlayActive === true,
      `${run.id}: video leg did not prove the frame-time overlay was active.`);
    required(raw?.overlay?.enabled === true && raw?.overlay?.visible === true,
      `${run.id}: overlay metadata does not prove a visible capture.`);
    required(raw?.contractEnvironment?.devicePixelRatio === 1,
      `${run.id}: visual evidence requires DPR 1 for exact video/pixel coordinates.`);
    required(raw?.evidence?.videoIdentity?.sessionId === run.env.GOAL24_PERF_SESSION_ID
      && raw.evidence.videoIdentity.runId === run.id
      && raw.evidence.videoIdentity.runnerLaunchId === envelope.runner?.launch?.launchId,
    `${run.id}: video identity is not bound to this session/run/launch.`);
  }
  required(envelope.result.resultPath === raw.resultPath, `${run.id}: resultPath differs between stdout and raw artifact.`);
  const runnerExpectedToolManifest = JSON.parse(run.env.GOAL24_PERF_TOOL_MANIFEST);
  assertGoal24ToolManifest(runnerExpectedToolManifest);
  const expectedPins = {
    seed: Number(run.env.GOAL24_PERF_SEED),
    clubhouse: 'pine-hills-v2',
    saveFixture: run.env.GOAL24_PERF_SAVE_FIXTURE,
    route: run.env.GOAL24_PERF_ROUTE,
    camera: run.env.GOAL24_PERF_CAMERA,
    toolManifest: runnerExpectedToolManifest,
    resolution: { width: run.width, height: run.height },
    windowMode: run.mode,
    quality: {
      preset: run.env.GOAL24_PERF_QUALITY,
      renderScale: 1,
      shadows: true,
      ambientOcclusion: true,
      bloom: true,
    },
    cache: {
      shaderCache: run.env.GOAL24_PERF_SHADER_CACHE_POLICY,
      gpuDriverCache: run.env.GOAL24_PERF_GPU_CACHE_POLICY,
      userDataPolicy: run.env.GOAL24_PERF_USER_DATA_POLICY,
    },
  };
  required(containsPinnedValues(raw?.protocolPins, expectedPins),
    `${run.id}: pinned seed/fixture/route/camera/tool-manifest/window/quality/cache metadata drifted.`);
  const readback = envelope.runner?.readbacks?.afterDriver?.renderer;
  const viewport = readback?.viewport;
  const dpr = viewport?.devicePixelRatio;
  required(Number.isFinite(dpr) && dpr > 0, `${run.id}: device-pixel-ratio readback is missing.`);
  required(Math.round(viewport.innerWidth * dpr) === run.width
    && Math.round(viewport.innerHeight * dpr) === run.height,
  `${run.id}: physical viewport does not match its pinned resolution.`);
  const canvasBacking = readback?.renderer?.canvasBacking;
  const drawingBuffer = readback?.renderer?.webgl?.drawingBuffer;
  required(canvasBacking?.width === run.width && canvasBacking?.height === run.height
    && drawingBuffer?.width === run.width && drawingBuffer?.height === run.height,
  `${run.id}: canvas backing or WebGL drawing buffer does not match the pinned render resolution.`);
  required(readback?.renderer?.pixelRatio === dpr,
    `${run.id}: Three renderer pixel ratio differs from the measured device-pixel ratio.`);
  const actualMode = envelope.runner?.readbacks?.afterDriver?.main?.window?.mode;
  required(actualMode === run.mode, `${run.id}: actual window mode ${actualMode} does not match ${run.mode}.`);
  if (run.gradeEligible) required(dpr === 1, `${run.id}: acceptance requires measured DPR 1.`);
  const quality = readback?.quality;
  required(quality?.quality === expectedPins.quality.preset
    && quality?.renderScale === expectedPins.quality.renderScale
    && quality?.shadows === expectedPins.quality.shadows
    && quality?.ambientOcclusion === expectedPins.quality.ambientOcclusion
    && quality?.bloom === expectedPins.quality.bloom,
  `${run.id}: actual quality readback does not match the pinned high preset.`);
  return true;
}

export function validateColdRunProtocol(raw, run) {
  const contribution = contributionFor(raw, run);
  const events = (id) => contribution.scenarios.find((scenario) => scenario?.id === id)?.events || [];
  required(events('coldLaunch').length === 1, `${run.id}: cold launch sample must occur exactly once.`);
  required(events('startToControllable').length === 1,
    `${run.id}: start-to-controllable sample must occur exactly once.`);
  const approaches = events('doorApproach');
  required(approaches.filter((event) => event.temperature === 'cold').length === 1,
    `${run.id}: door run must contain exactly one cold approach.`);
  required(approaches.filter((event) => event.temperature === 'warm').length >= 3,
    `${run.id}: door run must contain at least three warmed approaches.`);
  required(approaches[0]?.temperature === 'cold'
    && approaches.slice(1).every((event) => event.temperature === 'warm'),
  `${run.id}: cold door approach must precede every warmed approach.`);
  const firstOpens = events('doorFirstOpen');
  required(firstOpens.length === 1 && firstOpens[0]?.temperature === 'cold',
    `${run.id}: door-first-open must occur exactly once in the cold process.`);
  const inbound = events('doorCrossingOutsideToInside');
  required(inbound.length >= 1 && inbound[0]?.temperature === 'cold'
    && inbound.slice(1).every((event) => event.temperature === 'warm'),
  `${run.id}: outside-to-inside crossing must preserve its cold-first ordering.`);
  const outbound = events('doorCrossingInsideToOutside');
  required(outbound.length >= 1 && outbound.every((event) => event.temperature === 'warm'),
    `${run.id}: inside-to-outside crossing must be exercised warm through normal movement.`);
  return true;
}

export function validateColdDoorRouteParity(coldSources) {
  return validateGoal24DoorCohort(coldSources, {
    requiredProcessCount: REQUIRED_COLD_PROCESS_COUNT,
  });
}

export function bindColdContributionToRunner(raw, envelope, run) {
  const contribution = contributionFor(raw, run);
  const event = (id) => contribution.scenarios.find((scenario) => scenario.id === id)?.events?.[0];
  const launch = event('coldLaunch');
  const start = event('startToControllable');
  const approaches = contribution.scenarios.find((scenario) => scenario.id === 'doorApproach')?.events || [];
  const processId = String(envelope.runner?.launch?.electronPid);
  const runnerLaunchId = envelope.runner?.launch?.launchId;
  const processCreationTimeEpochMs = envelope.runner?.launch
    ?.electronMainProcessIdentity?.creationTimeEpochMs;
  const launchRequestedAtMs = envelope.runner?.timing?.anchors?.electronLaunchRequested?.epochMs;
  const launchResolvedAtMs = envelope.runner?.timing?.anchors?.electronLaunchResolved?.epochMs;
  const menuReadyAtMs = envelope.runner?.timing?.anchors?.menuReady?.epochMs;
  const profilePath = canonicalFilesystemPath(
    envelope.runner?.profile?.actualPath || envelope.runner?.profile?.path,
  );
  required(/^\d+$/u.test(processId), `${run.id}: runner Electron PID is missing.`);
  required([launch, start, ...approaches].every((candidate) => (
    String(candidate?.discriminator?.processInstanceId) === processId
    && candidate?.discriminator?.runnerLaunchId === runnerLaunchId
    && candidate?.discriminator?.electronMainProcessCreationTimeEpochMs
      === processCreationTimeEpochMs
  )), `${run.id}: graded cold/start/door process identity is not bound to the runner launch UUID/PID/start token.`);
  required(canonicalFilesystemPath(launch?.discriminator?.userDataDirectory) === profilePath,
    `${run.id}: graded cold user-data directory is not the runner profile.`);
  required(launch?.discriminator?.userDataProfileId === envelope.runner.profile.profileId,
    `${run.id}: graded profile ID is not the runner profile ID.`);
  const launchRecord = contribution.inputRecords.find((record) => (
    record.recordId === launch?.input?.recordId
  ));
  required(Number.isFinite(launchRequestedAtMs) && Number.isFinite(launchResolvedAtMs)
    && launchResolvedAtMs >= launchRequestedAtMs,
  `${run.id}: runner launch-instance anchors are missing or unordered.`);
  required(launch?.markers?.start?.atMs === launchRequestedAtMs
    && launchRecord?.requestedAtMs === launchRequestedAtMs
    && launchRecord?.deliveredAtMs === launchRequestedAtMs
    && launchRecord?.raw?.atMs === launchRequestedAtMs
    && launchRecord?.raw?.processInstanceId === processId
    && launchRecord?.raw?.runnerLaunchId === runnerLaunchId
    && launchRecord?.raw?.electronMainProcessCreationTimeEpochMs
      === processCreationTimeEpochMs,
  `${run.id}: graded cold launch is not bound to the runner launch-request anchor.`);
  required(launchRecord?.consumed?.atMs === launchResolvedAtMs,
    `${run.id}: graded cold launch is not bound to the runner launch-resolution anchor.`);
  required(Number.isFinite(menuReadyAtMs)
    && launch?.markers?.end?.atMs === menuReadyAtMs
    && launchRecord?.outcome?.atMs === menuReadyAtMs
    && launchRecord?.outcome?.markerName === launch?.markers?.end?.name
    && launchRecord?.outcome?.signal === 'main-menu-enabled-and-save-refresh-settled'
    && /runner-observed menu-ready anchor/u.test(launchRecord?.outcome?.observationSource || ''),
  `${run.id}: graded cold launch end/outcome is not bound to the runner menu-ready anchor.`);
  return true;
}

export function bindFullContributionToRunner(raw, envelope, run) {
  const contribution = contributionFor(raw, run);
  const environment = contribution.environment;
  required(environment && typeof environment === 'object', `${run.id}: contribution environment is missing.`);
  const readback = envelope.runner?.readbacks?.afterDriver;
  const renderer = readback?.renderer;
  const main = readback?.main;
  const profilePath = canonicalFilesystemPath(
    envelope.runner?.profile?.actualPath || envelope.runner?.profile?.path,
  );
  required(canonicalFilesystemPath(environment.profile?.userDataDirectory) === profilePath,
    `${run.id}: graded environment user-data directory differs from the runner profile.`);
  required(environment.profile?.processInstanceId === String(envelope.runner?.launch?.electronPid)
    && environment.profile?.runnerLaunchId === envelope.runner?.launch?.launchId
    && environment.profile?.electronMainProcessCreationTimeEpochMs
      === envelope.runner?.launch?.electronMainProcessIdentity?.creationTimeEpochMs
    && environment.profile?.userDataProfileId === envelope.runner?.profile?.profileId
    && environment.profile?.electronLaunchRequestedAtEpochMs
      === envelope.runner?.timing?.anchors?.electronLaunchRequested?.epochMs
    && canonicalFilesystemPath(environment.profile?.coldRunProfileRoot)
      === canonicalFilesystemPath(envelope.runner?.profile?.generatedUnder),
  `${run.id}: graded full contribution is not bound to its runner process/profile/launch instance.`);
  required(environment.profile?.seed === Number(run.env.GOAL24_PERF_SEED)
    && environment.profile?.saveFixture === run.env.GOAL24_PERF_SAVE_FIXTURE
    && environment.profile?.cameraRoute === run.env.GOAL24_PERF_ROUTE,
  `${run.id}: graded environment seed/fixture/route differs from the run pins.`);
  const runnerExpectedToolManifest = JSON.parse(run.env.GOAL24_PERF_TOOL_MANIFEST);
  assertGoal24ToolManifest(runnerExpectedToolManifest);
  required(isDeepStrictEqual(environment.toolManifest, runnerExpectedToolManifest)
    && isDeepStrictEqual(environment.profile?.supportedToolIds, GOAL24_SUPPORTED_TOOL_IDS),
  `${run.id}: graded environment tool manifest differs from the runner-owned shipping pin.`);
  required(environment.devicePixelRatio === renderer?.viewport?.devicePixelRatio,
    `${run.id}: graded environment DPR differs from the runner readback.`);
  required(environment.window?.innerWidth === renderer?.viewport?.innerWidth
    && environment.window?.innerHeight === renderer?.viewport?.innerHeight
    && environment.window?.outerWidth === renderer?.viewport?.outerWidth
    && environment.window?.outerHeight === renderer?.viewport?.outerHeight
    && environment.window?.mode === main?.window?.mode
    && environment.window?.focused === main?.window?.focused
    && environment.window?.visible === main?.window?.visible,
  `${run.id}: graded environment window differs from the runner readback.`);
  required(environment.quality?.preset === renderer?.quality?.quality
    && environment.quality?.renderScale === renderer?.quality?.renderScale
    && environment.quality?.shadows === renderer?.quality?.shadows
    && environment.quality?.ambientOcclusion === renderer?.quality?.ambientOcclusion
    && environment.quality?.bloom === renderer?.quality?.bloom,
  `${run.id}: graded environment quality differs from the runner readback.`);
  required(environment.gpu?.vendor === renderer?.renderer?.webgl?.unmaskedVendor
    && environment.gpu?.renderer === renderer?.renderer?.webgl?.unmaskedRenderer,
  `${run.id}: graded environment GPU differs from the runner WebGL readback.`);
  return true;
}

export function validateFullRunProtocol(raw, run, suite = 'full') {
  const events = (id) => raw?.scenarios?.[id]?.events || [];
  const idle = events('idle');
  required(idle.length >= 1 && idle.every((event) => (
    event.discriminator?.stationary === true
    && Number.isFinite(event.discriminator?.displacementYards)
    && event.discriminator.displacementYards <= 0.01
  )), `${run.id}: idle sample is missing or the before/after position moved.`);
  const walk = events('indoorWalk');
  const minimumWalkMs = suite === 'smoke' ? 4_000 : 59_000;
  required(walk.length >= 1 && walk.every((event) => event.durationMs >= minimumWalkMs),
    `${run.id}: indoor walk duration is below ${minimumWalkMs} ms.`);
  const minimumPathYards = suite === 'smoke' ? 0.5 : 5;
  required(walk.every((event) => Number.isFinite(event.discriminator?.pathYards)
    && event.discriminator.pathYards >= minimumPathYards
    && event.discriminator.insidePct >= 80
    && event.discriminator.distinctPositionChanges >= 2
    && event.discriminator.trustedMovementKeydowns >= 2),
  `${run.id}: indoor walk lacks meaningful inside movement and trusted movement input evidence.`);
  const npcEvents = events('npcNavActivation');
  required(npcEvents.length >= 1, `${run.id}: NPC/nav activation is missing.`);
  for (const event of npcEvents) {
    const navFailures = goal24NpcNavEvidenceFailures({
      markers: {
        start: { atMs: event?.startedAtMs },
        end: { atMs: event?.endedAtMs },
      },
      discriminator: event?.discriminator,
    });
    required(navFailures.length === 0,
      `${run.id}: raw NPC first-route navigation evidence failed: ${navFailures.join('; ')}`);
  }
  if (suite === 'smoke') return true;
  required(events('ledgerOpen').length >= 4, `${run.id}: four ledger opens are required.`);
  required(events('ledgerPageTurn').length === 10, `${run.id}: ten normal ledger page turns are required.`);
  required(events('ledgerClose').length >= 3, `${run.id}: three measured ledger closes are required.`);
  required(events('ledgerPageTurnStress').length === 50, `${run.id}: 50 ledger stress turns are required.`);
  required(raw?.scenarios?.ledgerStress?.requestedTurns === 50
    && raw?.scenarios?.ledgerStress?.completedTurns === 50,
  `${run.id}: ledger stress did not complete all 50 real turns.`);
  required(events('toolSwitch').length === 20, `${run.id}: 20 normal tool changes are required.`);
  required(events('toolSwitchStress').length === 100, `${run.id}: 100 warmed tool switches are required.`);
  required(raw?.scenarios?.toolStress?.requestedSwitches === 100
    && raw?.scenarios?.toolStress?.completedSwitches === 100,
  `${run.id}: tool stress did not complete all 100 real switches.`);
  const environment = raw?.contractEnvironment || raw?.contractContribution?.environment;
  const supportedToolIds = GOAL24_SUPPORTED_TOOL_IDS;
  const firstUses = events('toolFirstUse');
  const toolEvidenceFailures = goal24ToolEvidenceFailures(environment, firstUses);
  required(toolEvidenceFailures.length === 0,
    `${run.id}: first-use coverage failed: ${toolEvidenceFailures.join('; ')}`);
  required(firstUses.every((event, index) => (
    event?.discriminator?.firstUse === true
    && event?.discriminator?.toTool === supportedToolIds[index]
  )), `${run.id}: exact per-tool cold first-use production evidence is incomplete or unordered.`);
  return true;
}

export function validateDiagnosticInteractionRun(raw, run) {
  const minimumCounts = {
    doorApproach: 1,
    'doorCrossing:outside-in': 1,
    'doorCrossing:inside-out': 1,
    ledgerOpen: 4,
    ledgerPageTurn: 10,
    ledgerClose: 3,
    toolSwitch: 20,
    npcNavActivation: 1,
  };
  for (const [id, minimum] of Object.entries(minimumCounts)) {
    const events = raw?.scenarios?.[id]?.events;
    required(Array.isArray(events) && events.length >= minimum,
      `${run.id}: diagnostic capture omitted ${id} (${minimum} required).`);
    required(events.every((event) => event?.discriminator != null && event?.durationMs > 0),
      `${run.id}: diagnostic capture has incomplete ${id} evidence.`);
    if (id === 'npcNavActivation') {
      for (const event of events) {
        const navFailures = goal24NpcNavEvidenceFailures({
          markers: {
            start: { atMs: event?.startedAtMs },
            end: { atMs: event?.endedAtMs },
          },
          discriminator: event?.discriminator,
        });
        required(navFailures.length === 0,
          `${run.id}: diagnostic NPC first-route navigation evidence failed: ${navFailures.join('; ')}`);
      }
    }
  }
  return true;
}

function requireExact(actual, expected, message) {
  required(isDeepStrictEqual(actual, expected), message);
}

function rawEventForContribution(raw, event, run, linkedRawEvents) {
  const source = event?.rawSource;
  required(typeof source?.scenario === 'string' && source.scenario.length > 0
    && typeof source?.id === 'string' && source.id.length > 0,
  `${run.id}: ${event?.scenarioId || '(unknown)'} contribution event lacks an exact raw source coordinate.`);
  required(Number.isInteger(source.eventIndex) && source.eventIndex >= 0,
    `${run.id}: ${event?.scenarioId || '(unknown)'} raw source lacks an event index.`);
  required(source.scenario === CONTRIBUTION_RAW_SCENARIOS[event?.scenarioId],
    `${run.id}: ${event?.scenarioId || '(unknown)'} contribution points to the wrong raw scenario.`);
  const key = `${source.scenario}\u0000${source.eventIndex}\u0000${source.id}`;
  required(!linkedRawEvents.has(key),
    `${run.id}: raw source event ${source.scenario}/${source.id} is linked more than once.`);
  const candidates = raw?.scenarios?.[source.scenario]?.events;
  required(Array.isArray(candidates),
    `${run.id}: raw source scenario ${source.scenario} is missing.`);
  const candidate = candidates[source.eventIndex];
  required(candidate?.id === source.id
    && candidates.filter((entry) => entry?.id === source.id).length === 1,
  `${run.id}: raw source ${source.scenario}[${source.eventIndex}]/${source.id} must identify exactly one recorder event.`);
  linkedRawEvents.add(key);
  return candidate;
}

function validateCadenceEndpointProjection(event, rawEvent, run, scenarioId, {
  durationsAvailable = true,
} = {}) {
  const streams = [
    ['displayFrameIntervalsMs', 'displayCadenceIntervals'],
    ['renderFrameIntervalsMs', 'renderCadenceIntervals'],
  ];
  for (const [durationName, endpointName] of streams) {
    const expectedDurations = durationsAvailable ? rawEvent?.[durationName] : [];
    const expectedEndpoints = durationsAvailable ? rawEvent?.[endpointName] : [];
    required(Array.isArray(expectedDurations),
      `${run.id}: raw ${scenarioId} ${durationName} is missing.`);
    required(Array.isArray(expectedEndpoints),
      `${run.id}: raw ${scenarioId} ${endpointName} is missing.`);
    requireExact(event?.[durationName], expectedDurations,
      `${run.id}: ${scenarioId} contribution ${durationName} differs from its raw recorder window.`);
    requireExact(event?.[endpointName], expectedEndpoints,
      `${run.id}: ${scenarioId} contribution ${endpointName} differs from its raw recorder window.`);
    required(expectedDurations.length === expectedEndpoints.length,
      `${run.id}: raw ${scenarioId} ${durationName} and endpoint counts differ.`);
    for (let index = 0; index < expectedEndpoints.length; index += 1) {
      const endpoint = expectedEndpoints[index];
      required(Number.isFinite(endpoint?.startAtMs) && Number.isFinite(endpoint?.endAtMs)
        && Number.isFinite(endpoint?.durationMs)
        && endpoint.endAtMs >= endpoint.startAtMs
        && Math.abs((endpoint.endAtMs - endpoint.startAtMs) - endpoint.durationMs) <= 1e-6
        && endpoint.durationMs === expectedDurations[index],
      `${run.id}: raw ${scenarioId} ${endpointName}[${index}] is not an exact cadence interval.`);
    }
    const cadenceName = durationName.startsWith('display') ? 'display' : 'render';
    const priorCoverageName = cadenceName === 'display'
      ? 'measurementPriorDisplayBoundaryMs' : 'measurementPriorRenderBoundaryMs';
    const availability = event?.cadenceAvailability?.[cadenceName];
    if (durationsAvailable) {
      required(availability?.status === 'measured'
        && Number.isFinite(availability.priorBoundaryAtMs)
        && typeof availability.priorBoundarySource === 'string'
        && availability.priorBoundarySource.length > 0
        && availability.priorBoundaryAtMs === expectedEndpoints[0]?.startAtMs
        && availability.priorBoundaryAtMs === rawEvent?.sampleCoverage?.[priorCoverageName],
      `${run.id}: ${scenarioId} ${cadenceName} availability is not bound to the raw prior boundary.`);
      if (scenarioId === 'startToControllable' && cadenceName === 'render') {
        required(Number.isFinite(availability.measurementStartedAtMs)
          && availability.measurementStartedAtMs === expectedEndpoints[0]?.startAtMs
          && availability.measurementStartedAtMs
            === rawEvent?.discriminator?.renderCadenceMeasurementStartedAtMs
          && availability.priorBoundarySource
            === 'first observed shipping scene3d.render boundary after render instrumentation attached'
          && availability.preMeasurementReason
            === 'shipping scene3d.render did not exist before this timestamp'
          && rawEvent?.discriminator?.renderInstrumentationAttachedAtMs
            <= availability.measurementStartedAtMs,
        `${run.id}: startToControllable render measurement boundary is not bound to the raw first observed production render.`);
      }
    } else {
      required(availability?.status === 'unavailable',
        `${run.id}: ${scenarioId} ${cadenceName} cadence must remain explicitly unavailable.`);
    }
  }
}

function validateNormalRecorderBoundaries(rawEvent, event, run, scenarioId) {
  const markers = rawEvent?.markers;
  required(Array.isArray(markers) && markers.length >= 3,
    `${run.id}: raw ${scenarioId} recorder markers are missing.`);
  const startMarkers = markers.filter((marker) => marker?.atMs === rawEvent.startedAtMs);
  required(startMarkers.length === 1
    && startMarkers[0].label === 'measurement-armed-after-three-production-renders',
  `${run.id}: raw ${scenarioId} start is not the exact recorder-owned measurement boundary.`);
  const outcomeMarkers = markers.filter((marker) => marker?.label === 'production-outcome-observed');
  required(outcomeMarkers.length === 1
    && outcomeMarkers[0].atMs === rawEvent.discriminator?.productionOutcomeMarkerAtMs
    && outcomeMarkers[0].detail?.sourceObservedAtMs
      === rawEvent.discriminator?.outcomeObservedAtMs
    && outcomeMarkers[0].detail?.productionConsumptionAtMs
      === rawEvent.discriminator?.productionHandlerConsumed?.atMs,
  `${run.id}: raw ${scenarioId} production outcome is not bound to its recorder-owned marker.`);
  const endMarkers = markers.filter((marker) => marker?.label === 'post-outcome-render-boundary');
  const endMarker = endMarkers[0];
  required(endMarkers.length === 1
    && endMarker?.atMs === rawEvent.discriminator?.contractOutcomeMarkerAtMs
    && endMarker.atMs === rawEvent.endedAtMs
    && endMarker.atMs === event.markers.end.atMs,
  `${run.id}: raw ${scenarioId} end is not the exact recorder-owned post-outcome boundary.`);
  const snapshot = endMarker.cadenceSnapshot;
  required(snapshot?.displayCount === rawEvent.displayFrameIntervalsMs.length
    && snapshot?.renderCount === rawEvent.renderFrameIntervalsMs.length
    && snapshot?.displayDropped === rawEvent.sampleCoverage?.droppedDisplaySamples
    && snapshot?.renderDropped === rawEvent.sampleCoverage?.droppedRenderSamples
    && snapshot?.submissionDropped === rawEvent.sampleCoverage?.droppedSubmissionSamples,
  `${run.id}: raw ${scenarioId} cadence arrays are not bounded by the end-marker snapshot.`);
  const display = rawEvent.displayCadenceIntervals;
  const render = rawEvent.renderCadenceIntervals;
  required((display.length === 0 || (
    display[0].endAtMs === snapshot.firstDisplayBoundaryMs
    && display.at(-1).endAtMs === snapshot.lastDisplayBoundaryMs
  )) && (render.length === 0 || (
    render[0].endAtMs === snapshot.firstRenderBoundaryMs
    && render.at(-1).endAtMs === snapshot.lastRenderBoundaryMs
  )), `${run.id}: raw ${scenarioId} cadence endpoints do not match the end-marker snapshot.`);
  const coverage = rawEvent.sampleCoverage;
  required(coverage?.windowDurationMs === rawEvent.endedAtMs - rawEvent.startedAtMs
    && coverage.displayFirstBoundaryOffsetMs
      === (snapshot.firstDisplayBoundaryMs == null
        ? null : snapshot.firstDisplayBoundaryMs - rawEvent.startedAtMs)
    && coverage.displayLastBoundaryBeforeEndMs
      === (snapshot.lastDisplayBoundaryMs == null
        ? null : rawEvent.endedAtMs - snapshot.lastDisplayBoundaryMs)
    && coverage.renderFirstBoundaryOffsetMs
      === (snapshot.firstRenderBoundaryMs == null
        ? null : snapshot.firstRenderBoundaryMs - rawEvent.startedAtMs)
    && coverage.renderLastBoundaryBeforeEndMs
      === (snapshot.lastRenderBoundaryMs == null
        ? null : rawEvent.endedAtMs - snapshot.lastRenderBoundaryMs),
  `${run.id}: raw ${scenarioId} sample coverage is not derived from its recorder snapshot.`);
}

function expectedRegularDiscriminator(contractId, rawEvent) {
  const discriminator = clone(rawEvent.discriminator);
  if (contractId === 'doorApproach') {
    discriminator.endZone = discriminator.endedOutside ? 'outside' : 'inside';
    discriminator.freshProcess = rawEvent.thermalState === 'cold';
  }
  if (contractId === 'ledgerPageTurns10' || contractId === 'ledgerTurns50Stress') {
    discriminator.direction = discriminator.direction > 0 ? 'right' : 'left';
  }
  return discriminator;
}

function serializedEventTarget(target) {
  return JSON.stringify(target || { kind: 'non-element-event-target' });
}

function validateRegularInputProjection(record, event, rawEvent, run, scenarioId) {
  const isLedgerOpen = scenarioId === 'ledgerOpen';
  const expectedEventType = scenarioId === 'toolFirstUseByTool'
    || scenarioId === 'toolChanges20'
    || scenarioId === 'toolSwitches100Stress' ? 'keyup' : 'keydown';
  const expectedKey = String(rawEvent.discriminator?.key
    || rawEvent.discriminator?.interactKey
    || rawEvent.discriminator?.equipKey
    || '').toLowerCase();
  const inputs = (rawEvent.inputEvents || []).filter((candidate) => (
    candidate?.type === expectedEventType
    && candidate?.isTrusted === true
    && (!expectedKey || String(candidate.key || '').toLowerCase() === expectedKey)
  ));
  const deliveries = isLedgerOpen
    ? (rawEvent.inputEvents || []).filter((candidate) => (
      candidate?.type === 'keydown' && candidate?.isTrusted === true
    ))
    : inputs;
  const input = isLedgerOpen ? deliveries[1] : deliveries[0];
  const requestedAction = expectedEventType === 'keyup' ? 'up' : 'down';
  const requests = (rawEvent.driverInputRequests || []).filter((candidate) => (
    candidate?.kind === record.kind
    && candidate?.detail?.action === requestedAction
  ));
  const request = requests[0];
  required(input && request,
    `${run.id}: raw ${scenarioId}/${rawEvent.id} lacks the captured delivery/request used by its contribution.`);
  required(record.requestedAtMs === request.atMs
    && record.deliveredAtMs === input.atMs,
  `${run.id}: ${scenarioId} request/delivery timestamps differ from the raw recorder journal.`);
  requireExact(record.request, {
    atMs: request.atMs,
    source: request.source,
    kind: request.kind,
    actualControl: request.control,
    action: request.detail?.action,
    scenarioId,
    rawScenario: request.detail?.scenario,
  }, `${run.id}: ${scenarioId} contribution request evidence differs from the raw driver request.`);
  const expectedRaw = {
    eventType: isLedgerOpen ? 'keydown-sequence' : input.type,
    target: serializedEventTarget(input.target),
    source: 'capturing-DOM-input-listener',
    isTrusted: true,
    trustBasis: 'browser-isTrusted',
    atMs: input.atMs,
    eventTimestampMs: input.eventTimestampMs,
    observedAtMs: input.observedAtMs,
    code: input.code,
    key: input.key,
  };
  if (isLedgerOpen) {
    required(deliveries.length === 2 && requests.length === 2,
      `${run.id}: raw ledgerOpen must contain exactly two trusted deliveries and requests.`);
    const expectedSteps = [
      { phase: 'raise-book', control: rawEvent.discriminator?.entryKey,
        consumed: rawEvent.discriminator?.entryModeConsumed },
      { phase: 'open-cover', control: rawEvent.discriminator?.interactKey,
        consumed: rawEvent.discriminator?.productionHandlerConsumed },
    ];
    expectedRaw.steps = expectedSteps.map((expected, index) => ({
      phase: expected.phase,
      control: expected.control,
      requestedAtMs: requests[index].atMs,
      requestSource: requests[index].source,
      requestKind: requests[index].kind,
      deliveredAtMs: deliveries[index].atMs,
      consumed: expected.consumed,
      eventType: deliveries[index].type,
      key: deliveries[index].key,
      code: deliveries[index].code,
      target: serializedEventTarget(deliveries[index].target),
      source: 'capturing-DOM-input-listener',
      isTrusted: true,
      trustBasis: 'browser-isTrusted',
      eventTimestampMs: deliveries[index].eventTimestampMs,
      observedAtMs: deliveries[index].observedAtMs,
    }));
  }
  requireExact(record.raw, expectedRaw,
    `${run.id}: ${scenarioId} captured input evidence differs from its raw recorder journal.`);
  const consumed = rawEvent.discriminator?.productionHandlerConsumed;
  requireExact(record.consumed, {
    signal: consumed?.signal,
    productionHandlerObserved: true,
    atMs: consumed?.atMs,
  }, `${run.id}: ${scenarioId} consumption timestamp differs from the raw production observation.`);
  requireExact(record.outcome, {
    signal: `observed-production-state-then-render-boundaries:${scenarioId}`,
    observationSource: 'driver-observed production state followed by two measured production-render boundaries',
    observed: true,
    markerName: event.markers.end.name,
    atMs: event.markers.end.atMs,
  }, `${run.id}: ${scenarioId} outcome evidence differs from the raw-bound adapter outcome.`);
  required(Number.isFinite(rawEvent.discriminator?.outcomeObservedAtMs)
    && rawEvent.discriminator.outcomeObservedAtMs >= consumed?.atMs
    && rawEvent.discriminator.outcomeObservedAtMs
      <= rawEvent.discriminator?.productionOutcomeMarkerAtMs
    && rawEvent.discriminator?.contractOutcomeMarkerAtMs === event.markers.end.atMs,
  `${run.id}: raw ${scenarioId} discriminator/outcome-source timestamps are missing or unordered.`);
}

function validateStartInputProjection(record, event, rawEvent, run) {
  const expectedTraceIdentity = { id: 'start-game-1', scenario: 'startGame' };
  requireExact(rawEvent.traceIdentity, expectedTraceIdentity,
    `${run.id}: startToControllable raw recorder trace identity is not exact.`);
  requireExact(event.traceIdentity, expectedTraceIdentity,
    `${run.id}: startToControllable contribution trace identity differs from raw.`);
  const input = (rawEvent.inputEvents || []).find((candidate) => (
    candidate?.type === 'click' && candidate?.isTrusted === true
    && candidate.atEpochMs === record.deliveredAtMs
  ));
  const request = (rawEvent.driverInputRequests || []).find((candidate) => (
    candidate?.kind === 'pointer' && candidate.atEpochMs === record.requestedAtMs
  ));
  required(input && request,
    `${run.id}: startToControllable lacks its raw trusted click or driver request.`);
  requireExact(record.request, {
    atMs: request.atEpochMs,
    source: request.source,
    kind: request.kind,
    actualControl: request.control,
    action: request.detail?.action,
    scenarioId: 'startToControllable',
    rawScenario: request.detail?.scenario,
  }, `${run.id}: startToControllable request differs from the dedicated raw recorder journal.`);
  requireExact(record.raw, {
    eventType: input.type,
    target: serializedEventTarget(input.target),
    source: 'capturing-DOM-input-listener',
    isTrusted: true,
    trustBasis: 'browser-isTrusted',
    atMs: input.atEpochMs,
    eventTimestampMs: input.eventTimestampMs,
    observedAtMs: input.atEpochMs,
    clientX: input.clientX,
    clientY: input.clientY,
    button: input.button,
    targetElement: input.target,
    targetControlLabel: rawEvent.discriminator?.menuControl,
  }, `${run.id}: startToControllable click evidence differs from the dedicated raw recorder event.`);
  requireExact(record.consumed, {
    signal: 'shipping-menu-control-opened-difficulty-selection',
    productionHandlerObserved: true,
    atMs: rawEvent.discriminator?.menuControlConsumedAtMs,
  }, `${run.id}: startToControllable menu-consumption timestamp differs from raw.`);
  requireExact(record.outcome, {
    signal: 'walk-active-and-veil-clear-at-production-render-boundary',
    observationSource: 'dedicated transition recorder observed one controllable shipping render followed by its first display-rAF boundary',
    observed: true,
    markerName: event.markers.end.name,
    atMs: event.markers.end.atMs,
  }, `${run.id}: startToControllable outcome differs from its confirmed raw boundary.`);
  const movement = rawEvent.discriminator?.movementProbe;
  required(movement?.request?.kind === 'keyboard'
    && movement.request?.detail?.phase === 'movement-probe'
    && movement.delivery?.type === 'keydown' && movement.delivery?.isTrusted === true
    && Number.isFinite(movement.consumed?.atMs)
    && movement.consumed.atMs >= movement.delivery.atMs
    && Number.isFinite(movement.displacement) && movement.displacement > 0.02
    && Number.isFinite(movement.observedAtMs)
    && movement.observedAtMs >= movement.consumed.atMs
    && Number.isFinite(movement.confirmationRequestedAtMs)
    && movement.confirmationRequestedAtMs >= movement.observedAtMs
    && Number.isFinite(rawEvent.discriminator?.confirmedControllableRenderAtMs)
    && rawEvent.discriminator.confirmedControllableRenderAtMs
      >= movement.confirmationRequestedAtMs
    && Number.isFinite(rawEvent.discriminator?.confirmedControllableDisplayBoundaryAtMs)
    && rawEvent.discriminator.confirmedControllableDisplayBoundaryAtMs
      >= rawEvent.discriminator.confirmedControllableRenderAtMs,
  `${run.id}: startToControllable movement request/delivery/consumption/displacement/final-boundary chain is invalid.`);
}

function validateContributionEventProjection(raw, scenario, event, record, rawEvent, run) {
  const id = scenario.id;
  required(event.scenarioId === id && record.scenarioId === id
    && event.sequence === record.eventSequence,
  `${run.id}: ${id} raw-bound contribution sequence drifted.`);
  requireExact(record.rawSource, event.rawSource,
    `${run.id}: ${id} event and input record do not share the same raw coordinate.`);
  if (id === 'coldLaunch') {
    const startAtMs = rawEvent.markers?.[0]?.atEpochMs;
    const endAtMs = rawEvent.markers?.[1]?.atEpochMs;
    required(event.markers.start.atMs === startAtMs && event.markers.end.atMs === endAtMs
      && rawEvent.durationMs === endAtMs - startAtMs,
    `${run.id}: coldLaunch markers/duration differ from the raw runner-window event.`);
    validateCadenceEndpointProjection(event, rawEvent, run, id, { durationsAvailable: false });
    requireExact(event.sampleCoverage, {
      complete: true,
      windowDurationMs: endAtMs - startAtMs,
      droppedDisplaySamples: 0,
      droppedRenderSamples: 0,
      droppedSubmissionSamples: 0,
      displayFirstBoundaryOffsetMs: null,
      displayLastBoundaryBeforeEndMs: null,
      renderFirstBoundaryOffsetMs: null,
      renderLastBoundaryBeforeEndMs: null,
    }, `${run.id}: coldLaunch sample coverage is not the exact unavailable-cadence projection.`);
    requireExact(event.discriminator, rawEvent.discriminator,
      `${run.id}: coldLaunch discriminator differs from its raw runner event.`);
    required(record.requestedAtMs === startAtMs && record.deliveredAtMs === startAtMs
      && record.raw?.atMs === startAtMs && record.outcome?.atMs === endAtMs,
    `${run.id}: coldLaunch input/outcome anchors differ from its raw runner event.`);
    return;
  }

  const startEvent = id === 'startToControllable';
  const markerStart = startEvent ? rawEvent.startedAtEpochMs : rawEvent.startedAtMs;
  const markerEnd = startEvent ? rawEvent.endedAtEpochMs
    : rawEvent.discriminator?.contractOutcomeMarkerAtMs;
  required(Number.isFinite(markerStart) && Number.isFinite(markerEnd)
    && event.markers.start.atMs === markerStart && event.markers.end.atMs === markerEnd
    && rawEvent.durationMs === markerEnd - markerStart,
  `${run.id}: ${id} contribution markers/duration differ from its raw recorder window.`);
  validateCadenceEndpointProjection(event, rawEvent, run, id);
  requireExact(event.sampleCoverage, rawEvent.sampleCoverage,
    `${run.id}: ${id} sample coverage differs from its raw recorder window.`);
  requireExact(event.discriminator, startEvent
    ? rawEvent.discriminator : expectedRegularDiscriminator(id, rawEvent),
  `${run.id}: ${id} discriminator differs from the raw-derived value.`);
  required(event.temperature === rawEvent.thermalState,
    `${run.id}: ${id} thermal state differs from its raw recorder window.`);
  if (startEvent) {
    const input = (rawEvent.inputEvents || []).find((candidate) => (
      candidate?.type === 'click' && candidate?.isTrusted === true
      && candidate.atEpochMs === rawEvent.startedAtEpochMs
    ));
    const timeOrigin = Number.isFinite(input?.atEpochMs) && Number.isFinite(input?.atMs)
      ? input.atEpochMs - input.atMs : null;
    const display = rawEvent.displayCadenceIntervals;
    const render = rawEvent.renderCadenceIntervals;
    required(Number.isFinite(timeOrigin)
      && rawEvent.endedAtEpochMs
        === timeOrigin + rawEvent.discriminator?.confirmedControllableDisplayBoundaryAtMs
      && rawEvent.discriminator?.firstControllableDisplayBoundaryAtMs
        === rawEvent.endedAtEpochMs
      && rawEvent.discriminator?.firstControllableRenderAtMs
        === timeOrigin + rawEvent.discriminator?.confirmedControllableRenderAtMs
      && display.length > 0
      && display[0].startAtMs === rawEvent.sampleCoverage?.measurementPriorDisplayBoundaryMs
      && rawEvent.sampleCoverage?.displayFirstBoundaryOffsetMs
        === display[0].endAtMs - rawEvent.startedAtEpochMs
      && display.at(-1).endAtMs
        === timeOrigin + rawEvent.discriminator?.confirmedControllableDisplayBoundaryAtMs
      && render.length > 0
      && render[0].startAtMs === rawEvent.sampleCoverage?.measurementPriorRenderBoundaryMs
      && render[0].startAtMs
        === rawEvent.discriminator?.renderCadenceMeasurementStartedAtMs
      && rawEvent.discriminator?.renderInstrumentationAttachedAtMs <= render[0].startAtMs
      && rawEvent.sampleCoverage?.renderFirstBoundaryOffsetMs
        === render[0].startAtMs - rawEvent.startedAtEpochMs
      && render.at(-1).endAtMs
        === timeOrigin + rawEvent.discriminator?.confirmedControllableRenderAtMs,
    `${run.id}: startToControllable endpoints are not bound to the confirmed movement/render/display boundary.`);
    validateStartInputProjection(record, event, rawEvent, run);
  } else if (id === 'npcNavActivation') {
    validateNormalRecorderBoundaries(rawEvent, event, run, id);
    const navFailures = goal24NpcNavEvidenceFailures(rawEvent);
    required(navFailures.length === 0,
      `${run.id}: npcNavActivation raw navigation evidence failed: ${navFailures.join('; ')}`);
    const consumed = rawEvent.discriminator?.productionHandlerConsumed;
    required(record.requestedAtMs === rawEvent.startedAtMs
      && record.deliveredAtMs === rawEvent.startedAtMs
      && record.raw?.atMs === rawEvent.startedAtMs
      && record.raw?.routeRequestId === rawEvent.discriminator?.routeRequestId,
    `${run.id}: npcNavActivation lifecycle request differs from its raw window.`);
    requireExact(record.consumed, {
      signal: consumed?.signal,
      productionHandlerObserved: true,
      atMs: consumed?.atMs,
    }, `${run.id}: npcNavActivation consumption differs from raw.`);
    requireExact(record.outcome, {
      signal: 'same-organic-customer-route-remained-active-after-render-boundaries',
      observationSource: 'driver observed the exact customer route activation, then two measured production-render boundaries',
      observed: true,
      markerName: event.markers.end.name,
      atMs: event.markers.end.atMs,
    }, `${run.id}: npcNavActivation outcome differs from its raw window.`);
    required(rawEvent.discriminator?.routeObserved?.atMs
      >= rawEvent.discriminator?.routeResolvedAtMs,
    `${run.id}: npcNavActivation raw outcome-source timestamp is invalid.`);
  } else {
    validateNormalRecorderBoundaries(rawEvent, event, run, id);
    validateRegularInputProjection(record, event, rawEvent, run, id);
    if (GOAL24_DOOR_SCENARIOS.includes(id)) {
      validateGoal24DoorwayRenderEvidence(
        event.doorwayRenderEvidence,
        rawEvent,
        `${run.id}: ${id}/${rawEvent.id}`,
      );
    }
  }
}

function validateStressResourceProjection(raw, scenario, run) {
  const resources = scenario.resources;
  const source = resources?.rawSource?.scenario;
  const expectedSource = scenario.id === 'ledgerTurns50Stress' ? 'ledgerStress' : 'toolStress';
  required(typeof source === 'string' && source.length > 0,
    `${run.id}: ${scenario.id} stress resources lack a raw checkpoint source.`);
  required(source === expectedSource,
    `${run.id}: ${scenario.id} stress resources point to the wrong raw checkpoint scenario.`);
  const checkpoints = raw?.scenarios?.[source]?.checkpoints;
  required(Array.isArray(checkpoints) && checkpoints.length > 0,
    `${run.id}: ${scenario.id} raw stress checkpoints are missing.`);
  checkpoints.forEach((checkpoint, index) => {
    required(checkpoint && typeof checkpoint === 'object'
      && isDeepStrictEqual(
        Object.keys(checkpoint).sort(),
        ['elapsedMs', 'iteration', 'snapshot'],
      ), `${run.id}: ${scenario.id} raw checkpoint ${index + 1} dropped full snapshot evidence.`);
    try {
      validateGoal24ResourceSnapshot(checkpoint.snapshot);
    } catch (error) {
      throw new Error(
        `${run.id}: ${scenario.id} raw checkpoint ${index + 1} failed resource validation: ${error.message}`,
        { cause: error },
      );
    }
  });
  const expected = {
    rawSource: { scenario: source },
    samples: checkpoints.map((checkpoint) => clone(checkpoint)),
  };
  requireExact(resources, expected,
    `${run.id}: ${scenario.id} stress resources differ from the raw resource checkpoints.`);
}

function validateBoundRunResourceCheckpoint(raw, contribution, key, run) {
  const rawCheckpoint = raw?.[key];
  required(rawCheckpoint && typeof rawCheckpoint === 'object'
    && isDeepStrictEqual(
      Object.keys(rawCheckpoint).sort(),
      ['elapsedMs', 'iteration', 'snapshot'],
    ), `${run.id}: raw ${key} dropped the full resource snapshot.`);
  try {
    validateGoal24ResourceSnapshot(rawCheckpoint.snapshot);
  } catch (error) {
    throw new Error(`${run.id}: raw ${key} failed resource validation: ${error.message}`, {
      cause: error,
    });
  }
  requireExact(
    contribution?.[key],
    rawCheckpoint,
    `${run.id}: contribution ${key} differs from the independently persisted raw checkpoint.`,
  );
}

export function validateContributionRawBindings(raw, contribution, run) {
  const linkedRawEvents = new Set();
  const records = new Map(contribution.inputRecords.map((record) => [record.recordId, record]));
  for (const scenario of contribution.scenarios) {
    for (const event of scenario.events) {
      const record = records.get(event?.input?.recordId);
      required(record, `${run.id}: ${scenario.id} has no input record for raw cross-binding.`);
      const rawEvent = rawEventForContribution(raw, event, run, linkedRawEvents);
      validateContributionEventProjection(raw, scenario, event, record, rawEvent, run);
    }
    if (scenario.id === 'ledgerTurns50Stress' || scenario.id === 'toolSwitches100Stress') {
      validateStressResourceProjection(raw, scenario, run);
    }
  }
  if (run.role === 'acceptance-full') {
    validateBoundRunResourceCheckpoint(raw, contribution, 'resourceBaseline', run);
    validateBoundRunResourceCheckpoint(raw, contribution, 'resourceFinal', run);
    requireExact(contribution.environment, raw?.contractEnvironment,
      `${run.id}: contribution environment differs from the independently persisted raw environment.`);
    const control = contribution.negativeControl;
    const source = control?.rawSource;
    required(source?.scenario === 'negativeControl',
      `${run.id}: negative control points to the wrong raw recorder scenario.`);
    const rawControlEvents = raw?.scenarios?.[source?.scenario]?.events;
    const window = rawControlEvents?.[source?.eventIndex];
    required(Number.isInteger(source?.eventIndex) && source.eventIndex >= 0
      && window?.id === source?.id
      && rawControlEvents.filter((event) => event?.id === source?.id).length === 1,
      `${run.id}: negative control does not identify exactly one raw recorder window.`);
    requireExact(control, {
      rawSource: { scenario: source.scenario, id: source.id, eventIndex: source.eventIndex },
      kind: LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.negativeControl.kind,
      injectedDurationMs: LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.negativeControl.injectedDurationMs,
      sameInstrumentation: true,
      busyLoopElapsedMs: window.discriminator?.actualBusyMs,
      markers: {
        start: { name: 'busy-stall-begin', clock: 'renderer',
          atMs: raw.controls?.negativeControl?.busyStall?.startedAtMs },
        end: { name: 'busy-stall-end', clock: 'renderer',
          atMs: raw.controls?.negativeControl?.busyStall?.endedAtMs },
      },
      displayFrameIntervalsMs: window.displayFrameIntervalsMs,
      renderFrameIntervalsMs: window.renderFrameIntervalsMs,
      displayCadenceIntervals: window.displayCadenceIntervals,
      renderCadenceIntervals: window.renderCadenceIntervals,
    }, `${run.id}: negative-control contribution differs from its raw stall window.`);
  }
  return true;
}

function contributionFor(raw, run) {
  const contribution = raw?.contractContribution || raw?.lockedContractContribution;
  required(contribution && typeof contribution === 'object', `${run.id}: locked contract contribution is missing.`);
  const provenance = contribution.provenance;
  required(provenance?.sourceRunId === run.id, `${run.id}: contribution sourceRunId is missing or wrong.`);
  required(provenance?.instrumentationMode === 'low-overhead', `${run.id}: contribution is not low-overhead.`);
  required(provenance?.lowOverheadEligible === true, `${run.id}: contribution is not grade eligible.`);
  required(provenance?.hardwareRenderer === true, `${run.id}: contribution lacks hardware-renderer proof.`);
  required(provenance?.recorderCalibrationPass === true, `${run.id}: contribution lacks recorder-calibration proof.`);
  required(provenance.sourceRunId === raw?.runId
    && provenance.instrumentationMode === raw?.instrumentationMode
    && provenance.hardwareRenderer === raw?.controls?.hardwareRenderer
    && provenance.recorderCalibrationPass === (
      raw?.recorderCalibration?.inactiveIsInert === true
      && raw?.recorderCalibration?.activeP95OverheadWithinTolerance === true
    ), `${run.id}: contribution provenance differs from the persisted raw run controls.`);
  required(Array.isArray(contribution.scenarios), `${run.id}: contribution.scenarios must be an array.`);
  required(Array.isArray(contribution.inputRecords), `${run.id}: contribution.inputRecords must be an array.`);
  const expectedScenarioIds = run.role === 'acceptance-cold'
    ? ACCEPTANCE_COLD_SCENARIOS
    : LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder
      .filter((id) => !ACCEPTANCE_COLD_SCENARIOS.includes(id));
  const scenarioIds = contribution.scenarios.map((scenario) => scenario?.id);
  required(new Set(scenarioIds).size === scenarioIds.length,
    `${run.id}: contribution contains duplicate scenario IDs.`);
  required(JSON.stringify(scenarioIds) === JSON.stringify(expectedScenarioIds),
    `${run.id}: contribution scenarios are not the exact ordered role subset.`);
  const records = new Map();
  for (const record of contribution.inputRecords) {
    required(typeof record?.recordId === 'string' && record.recordId.length > 0,
      `${run.id}: input journal contains a missing record ID.`);
    required(!records.has(record.recordId), `${run.id}: input journal has duplicate ${record.recordId}.`);
    records.set(record.recordId, record);
  }
  const linked = new Set();
  for (const scenario of contribution.scenarios) {
    required(Array.isArray(scenario.events), `${run.id}: ${scenario.id} events must be an array.`);
    for (const event of scenario.events) {
      const recordId = event?.input?.recordId;
      const record = records.get(recordId);
      required(record, `${run.id}: ${scenario.id} event has no linked input record ${recordId || '(missing)'}.`);
      required(!linked.has(recordId), `${run.id}: input record ${recordId} is linked more than once.`);
      required(record.scenarioId === scenario.id && record.eventSequence === event.sequence,
        `${run.id}: input record ${recordId} scenario/sequence linkage drifted.`);
      linked.add(recordId);
    }
  }
  required(linked.size === records.size,
    `${run.id}: contribution input journal contains unlinked records.`);
  validateContributionRawBindings(raw, contribution, run);
  return contribution;
}

function normalizeScenarioSources(id, sources) {
  const gathered = [];
  for (const { run, contribution } of sources) {
    const scenario = contribution.scenarios.find((entry) => entry?.id === id);
    required(scenario && Array.isArray(scenario.events), `${run.id}: contribution scenario ${id} is missing.`);
    const records = new Map(contribution.inputRecords.map((record) => [record?.recordId, record]));
    required(records.size === contribution.inputRecords.length, `${run.id}: input journal contains missing or duplicate IDs.`);
    for (const event of scenario.events) {
      const recordId = event?.input?.recordId;
      const record = records.get(recordId);
      required(record, `${run.id}: ${id} event has no linked input record ${recordId || '(missing)'}.`);
      required(record.scenarioId === id, `${run.id}: ${id} input journal scenario linkage drifted.`);
      required(record.eventSequence === event.sequence, `${run.id}: ${id} input journal sequence linkage drifted.`);
      gathered.push({ run, event: clone(event), record: clone(record) });
    }
  }
  const temperaturePolicy = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarios
    .find((scenario) => scenario.id === id)?.temperature?.policy;
  if (temperaturePolicy === 'cold-block-then-warm') {
    gathered.sort((left, right) => {
      const heat = (value) => value.event.temperature === 'cold' ? 0 : 1;
      return heat(left) - heat(right) || left.run.ordinal - right.run.ordinal
        || left.event.sequence - right.event.sequence;
    });
  }
  const inputRecords = [];
  const events = gathered.map(({ run, event, record }, index) => {
    const sequence = index + 1;
    const sourceSequence = event.sequence;
    const sourceRecordId = event.input.recordId;
    const recordId = `${run.id}::${sourceRecordId}`;
    event.sequence = sequence;
    event.input.recordId = recordId;
    event.source = { runId: run.id, sequence: sourceSequence, recordId: sourceRecordId };
    record.recordId = recordId;
    record.eventSequence = sequence;
    record.source = { runId: run.id, eventSequence: sourceSequence, recordId: sourceRecordId };
    inputRecords.push(record);
    return event;
  });
  return { scenario: { id, events }, inputRecords };
}

export function aggregateLockedReport(executedRuns, options = {}) {
  const evaluator = options.evaluator || evaluateLockedInteractionPerformanceReport;
  const cold = executedRuns.filter(({ run }) => run.role === 'acceptance-cold');
  const full = executedRuns.filter(({ run }) => run.role === 'acceptance-full');
  required(cold.length === REQUIRED_COLD_PROCESS_COUNT,
    `Acceptance requires exactly ${REQUIRED_COLD_PROCESS_COUNT} cold process contributions.`);
  required(full.length === 1, 'Acceptance requires exactly one full interaction/stress contribution.');
  const coldSources = cold.map(({ run, raw }) => ({ run, contribution: contributionFor(raw, run) }));
  const fullSources = full.map(({ run, raw }) => ({ run, contribution: contributionFor(raw, run) }));
  const fullContribution = fullSources[0].contribution;
  required(fullContribution.environment && typeof fullContribution.environment === 'object',
    'Full contribution environment is missing.');
  required(fullContribution.negativeControl && typeof fullContribution.negativeControl === 'object',
    'Full contribution negative control is missing.');
  validateColdDoorRouteParity(coldSources);

  const inputRecords = [];
  const scenarios = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.map((id) => {
    const sources = ACCEPTANCE_COLD_SCENARIOS.includes(id) ? coldSources : fullSources;
    const normalized = normalizeScenarioSources(id, sources);
    inputRecords.push(...normalized.inputRecords);
    if (id === 'ledgerTurns50Stress' || id === 'toolSwitches100Stress') {
      const rawScenario = sources[0].contribution.scenarios.find((entry) => entry.id === id);
      required(rawScenario.resources && typeof rawScenario.resources === 'object', `${id}: resources are missing.`);
      normalized.scenario.resources = clone(rawScenario.resources);
    }
    return normalized.scenario;
  });
  const protocol = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL;
  const report = {
    schemaVersion: LOCKED_INTERACTION_PERFORMANCE_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
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
    environment: clone(fullContribution.environment),
    resourceBaseline: clone(fullContribution.resourceBaseline),
    resourceFinal: clone(fullContribution.resourceFinal),
    negativeControl: clone(fullContribution.negativeControl),
    inputRecords,
    scenarios,
    doorEvidence: aggregateGoal24DoorEvidence(coldSources, {
      requiredProcessCount: REQUIRED_COLD_PROCESS_COUNT,
    }),
  };
  return {
    report,
    evaluation: evaluator(report),
    aggregation: {
      sourceRuns: [...cold, ...full].map(({ run }) => run.id),
      policy: 'select locked raw contributions; prefix record IDs; resequence while retaining source fields',
      timingSynthesis: false,
      discriminatorSynthesis: false,
      inputTrustSynthesis: false,
    },
  };
}

export function validateMatrixRun(raw, envelope, run) {
  const requested = raw?.windowRequest?.requested;
  required(requested?.width === run.width && requested?.height === run.height,
    `${run.id}: requested resolution is not recorded exactly.`);
  required(requested?.fullscreen === (run.mode === 'fullscreen'), `${run.id}: requested window mode drifted.`);
  const after = envelope.runner?.readbacks?.afterDriver;
  const viewport = after?.renderer?.viewport;
  const dpr = viewport?.devicePixelRatio;
  required(Number.isFinite(dpr) && dpr > 0, `${run.id}: display scale readback is missing.`);
  const actual = {
    width: Math.round(viewport.innerWidth * dpr),
    height: Math.round(viewport.innerHeight * dpr),
    mode: after?.main?.window?.mode,
  };
  required(actual.width === run.width && actual.height === run.height,
    `${run.id}: actual physical viewport ${actual.width}x${actual.height} does not match ${run.width}x${run.height}.`);
  required(actual.mode === run.mode, `${run.id}: actual mode ${actual.mode} does not match ${run.mode}.`);
  const assertMetrics = (event, label) => {
    for (const [stream, metrics] of [
      ['display', event?.metrics?.displayRaf],
      ['render', event?.metrics?.actualRender],
    ]) {
      for (const key of ['averageFps', 'onePercentLowFps', 'p95Ms', 'worstMs']) {
        required(Number.isFinite(metrics?.[key]) && metrics[key] > 0,
          `${run.id}: ${label} ${stream} ${key} is not measured.`);
      }
      required(Number.isInteger(metrics?.samples) && metrics.samples > 0,
        `${run.id}: ${label} ${stream} sample count is missing.`);
      for (const key of ['over33', 'over50']) {
        required(Number.isInteger(metrics?.[key]) && metrics[key] >= 0
          && metrics[key] <= metrics.samples,
        `${run.id}: ${label} ${stream} ${key} frame count is not measured.`);
      }
      required(metrics.over50 <= metrics.over33,
        `${run.id}: ${label} ${stream} >50 ms count exceeds its >33 ms count.`);
    }
  };
  const idle = raw?.scenarios?.idle?.events || [];
  required(idle.length >= 1 && idle.every((event) => event.durationMs >= 4_000),
    `${run.id}: matrix run lacks its five-second idle sample.`);
  required(idle.every((event) => event.discriminator?.stationary === true
    && event.discriminator?.displacementYards <= 0.01),
  `${run.id}: matrix idle sample moved instead of remaining stationary.`);
  idle.forEach((event, index) => assertMetrics(event, `idle event ${index + 1}`));
  const walk = raw?.scenarios?.indoorWalk?.events || [];
  const requestedWalkMs = Number(run.env?.GOAL24_PERF_WALK_MS || 60_000);
  const minimumWalkMs = Math.max(1_000, requestedWalkMs - 1_000);
  required(walk.length >= 1 && walk.every((event) => event.durationMs >= minimumWalkMs),
    `${run.id}: matrix run lacks its requested ${requestedWalkMs} ms indoor walk.`);
  required(walk.every((event) => event.discriminator?.pathYards >= (requestedWalkMs < 10_000 ? 0.5 : 5)
    && event.discriminator?.insidePct >= 80
    && event.discriminator?.distinctPositionChanges >= 2
    && event.discriminator?.trustedMovementKeydowns >= 2),
  `${run.id}: matrix indoor walk lacks meaningful inside movement and trusted input evidence.`);
  walk.forEach((event, index) => assertMetrics(event, `indoor-walk event ${index + 1}`));
  const ladder = raw?.scenarios?.capLadder;
  const refresh = Number(ladder?.displayRefreshHz);
  const display = envelope.runner?.readbacks?.afterDriver?.main?.display;
  const displayReadback = Number(display?.displayFrequency);
  required(Number.isFinite(refresh) && refresh > 0, `${run.id}: display refresh readback is missing.`);
  required(Number.isFinite(displayReadback) && displayReadback > 0 && displayReadback === refresh,
    `${run.id}: cap ladder refresh does not match the independent runner display readback.`);
  required((typeof display?.id === 'number' || typeof display?.id === 'string')
    && Number.isFinite(display?.scaleFactor) && display.scaleFactor > 0
    && Number.isFinite(display?.bounds?.width) && display.bounds.width > 0
    && Number.isFinite(display?.bounds?.height) && display.bounds.height > 0,
  `${run.id}: independent display identity/scale/bounds readback is incomplete.`);
  const capEvents = ladder.events || [];
  capEvents.forEach((event, index) => assertMetrics(event, `cap-ladder event ${index + 1}`));
  const ran120 = capEvents.some((event) => event.discriminator?.requestedCap === 120);
  const skipped120 = (ladder.skipped || []).some((entry) => entry.cap === 120 && entry.reason);
  if (refresh >= 119) required(ran120 && !skipped120, `${run.id}: 120 fps cap was not exercised on a supporting display.`);
  else required(!ran120 && skipped120, `${run.id}: 120 fps cap was not explicitly skipped on an unsupported display.`);
  for (const cap of [60, 144, 0]) {
    required(capEvents.some((event) => event.discriminator?.requestedCap === cap
      && event.discriminator?.appliedCap === cap && event.durationMs >= 4_900),
      `${run.id}: cap ladder omitted ${cap}.`);
  }
  if (ran120) {
    const event = capEvents.find((candidate) => candidate.discriminator?.requestedCap === 120);
    required(event.discriminator?.appliedCap === 120 && event.durationMs >= 4_900,
      `${run.id}: 120 fps cap event did not complete with the applied cap.`);
  }
  required(run.env?.GOAL24_PERF_GPU_FRAME_TIMING === '1',
    `${run.id}: matrix run did not request render-submit GPU timing.`);
  const gpuInstall = raw?.gpuFrameTiming?.install;
  const frameTiming = raw?.gpuFrameTiming?.evidence;
  required(gpuInstall?.requested === true && gpuInstall?.installed === true,
    `${run.id}: matrix GPU frame-timing probe was not installed.`);
  required(frameTiming?.schemaVersion === 1,
    `${run.id}: matrix GPU frame-timing evidence schema is missing or unsupported.`);
  required(frameTiming?.context?.proof?.webgl2VersionClaim === true
    && frameTiming.context.proof.queryApiComplete === true
    && frameTiming.context.proof.timerQueryExtensionAvailable === true,
  `${run.id}: matrix GPU timing lacks a proven WebGL2 disjoint-timer-query context.`);
  required(frameTiming?.cpuSubmit?.validity?.valid === true
    && Array.isArray(frameTiming.cpuSubmit.rawSamples)
    && frameTiming.cpuSubmit.rawSamples.length > 0,
  `${run.id}: matrix CPU render-submit timing is invalid or empty.`);
  required(frameTiming?.gpu?.validity?.valid === true
    && Array.isArray(frameTiming.gpu.rawSamples)
    && frameTiming.gpu.rawSamples.length > 0,
  `${run.id}: matrix GPU render timing is invalid or empty.`);
  required(frameTiming?.lifecycle?.disposed === true
    && frameTiming?.cleanup?.leakFree === true
    && frameTiming.cleanup.queriesCreated === frameTiming.cleanup.queriesDeleted
    && (frameTiming.errors || []).length === 0,
  `${run.id}: matrix GPU timing did not dispose its wrapper/queries cleanly.`);
  const cpuBySequence = new Map(frameTiming.cpuSubmit.rawSamples.map((sample) => (
    [sample.frameSequence, sample]
  )));
  required(cpuBySequence.size === frameTiming.cpuSubmit.rawSamples.length,
    `${run.id}: matrix CPU render-submit frame sequences are duplicated.`);
  for (const sample of frameTiming.gpu.rawSamples) {
    const cpuSample = cpuBySequence.get(sample.frameSequence);
    required(cpuSample && JSON.stringify(cpuSample.metadata) === JSON.stringify(sample.metadata),
      `${run.id}: GPU sample ${sample.frameSequence} is not bound to its exact CPU render submission.`);
  }
  const nearestRankSummary = (samples) => {
    const values = samples.map(({ durationMs }) => durationMs)
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((left, right) => left - right);
    const percentile = (fraction) => values.length
      ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null;
    return {
      count: values.length,
      min: values[0] ?? null,
      p50: percentile(0.5),
      p95: percentile(0.95),
      worst: values.at(-1) ?? null,
    };
  };
  const routeTiming = {};
  for (const scenario of ['idle', 'indoorWalk', 'capLadder']) {
    const cpuSamples = frameTiming.cpuSubmit.rawSamples
      .filter((sample) => sample.metadata?.scenario === scenario);
    const gpuSamples = frameTiming.gpu.rawSamples
      .filter((sample) => sample.metadata?.scenario === scenario);
    required(cpuSamples.length > 0 && gpuSamples.length > 0,
      `${run.id}: ${scenario} lacks both CPU-submit and GPU frame samples.`);
    const labels = [...new Set(cpuSamples.map((sample) => sample.metadata?.label).filter(Boolean))];
    required(labels.length > 0 && labels.every((label) => gpuSamples.some(
      (sample) => sample.metadata?.label === label,
    )), `${run.id}: ${scenario} GPU samples do not cover every measured route label.`);
    routeTiming[scenario] = {
      labels,
      cpuSubmit: nearestRankSummary(cpuSamples),
      gpu: nearestRankSummary(gpuSamples),
    };
  }
  const metricSummary = (event) => ({
    durationMs: event?.durationMs ?? null,
    displayAverageFps: event?.metrics?.displayRaf?.averageFps ?? null,
    displayOnePercentLowFps: event?.metrics?.displayRaf?.onePercentLowFps ?? null,
    displayMedianMs: event?.metrics?.displayRaf?.medianMs ?? null,
    displayP95Ms: event?.metrics?.displayRaf?.p95Ms ?? null,
    displayWorstMs: event?.metrics?.displayRaf?.worstMs ?? null,
    displayFramesOver33Ms: event?.metrics?.displayRaf?.over33 ?? null,
    displayFramesOver50Ms: event?.metrics?.displayRaf?.over50 ?? null,
    renderAverageFps: event?.metrics?.actualRender?.averageFps ?? null,
    renderOnePercentLowFps: event?.metrics?.actualRender?.onePercentLowFps ?? null,
    renderMedianMs: event?.metrics?.actualRender?.medianMs ?? null,
    renderP95Ms: event?.metrics?.actualRender?.p95Ms ?? null,
    renderWorstMs: event?.metrics?.actualRender?.worstMs ?? null,
    renderFramesOver33Ms: event?.metrics?.actualRender?.over33 ?? null,
    renderFramesOver50Ms: event?.metrics?.actualRender?.over50 ?? null,
  });
  return {
    requested: { width: run.width, height: run.height, mode: run.mode },
    actual: { ...actual, devicePixelRatio: dpr },
    refreshHz: refresh,
    display: {
      id: display.id,
      bounds: clone(display.bounds),
      workArea: clone(display.workArea),
      scaleFactor: display.scaleFactor,
      displayFrequency: display.displayFrequency,
      rotation: display.rotation,
      touchSupport: display.touchSupport,
    },
    indoorWalk: metricSummary(walk[0]),
    frameTiming: {
      source: frameTiming.source,
      context: clone(frameTiming.context),
      cpuSubmit: nearestRankSummary(frameTiming.cpuSubmit.rawSamples),
      gpu: nearestRankSummary(frameTiming.gpu.rawSamples),
      routes: routeTiming,
      cleanup: clone(frameTiming.cleanup),
    },
    capLadder: {
      events: capEvents.map((event) => ({
        requestedCap: event.discriminator?.requestedCap ?? null,
        appliedCap: event.discriminator?.appliedCap ?? null,
        ...metricSummary(event),
      })),
      skipped: clone(ladder.skipped || []),
    },
  };
}

function comparisonMeasurement(beforeValue, afterValue) {
  const measured = Number.isFinite(beforeValue) && Number.isFinite(afterValue);
  const rawDelta = measured ? afterValue - beforeValue : null;
  const absoluteDelta = measured ? +rawDelta.toFixed(3) : null;
  const percentDelta = measured && beforeValue !== 0
    ? +((rawDelta / Math.abs(beforeValue)) * 100).toFixed(3)
    : measured && afterValue === 0 ? 0 : null;
  return {
    before: Number.isFinite(beforeValue) ? beforeValue : null,
    after: Number.isFinite(afterValue) ? afterValue : null,
    absoluteDelta,
    percentDelta,
    percentDeltaStatus: measured && beforeValue === 0 && afterValue !== 0
      ? 'undefined-zero-baseline' : measured ? 'defined' : 'unmeasured',
  };
}

export function compareMatrixFrameTiming(referenceRuns, currentRuns, options = {}) {
  const referenceByName = new Map((referenceRuns || [])
    .filter((entry) => entry.run?.leg === 'matrix')
    .map((entry) => [entry.run.name, entry]));
  const currentMatrixRuns = (currentRuns || []).filter((entry) => entry.run?.leg === 'matrix');
  required(referenceByName.size === MATRIX.length && currentMatrixRuns.length === MATRIX.length,
    'GPU/CPU matrix comparison requires every pinned matrix condition in both phases.');
  const rows = [];
  const cadenceFrameCountRows = [];
  const tolerance = (value) => Math.max(0.25, value * 0.05);
  const appendCadenceFrameCountRows = (
    matrix,
    route,
    event,
    beforeSummary,
    afterSummary,
  ) => {
    for (const stream of ['display', 'render']) {
      const over33Key = `${stream}FramesOver33Ms`;
      const over50Key = `${stream}FramesOver50Ms`;
      for (const [owner, summary] of [['baseline', beforeSummary], ['candidate', afterSummary]]) {
        required(Number.isInteger(summary?.[over33Key]) && summary[over33Key] >= 0,
          `${matrix} ${route} ${event} ${owner} ${stream} >33 ms frame count is missing.`);
        required(Number.isInteger(summary?.[over50Key]) && summary[over50Key] >= 0,
          `${matrix} ${route} ${event} ${owner} ${stream} >50 ms frame count is missing.`);
        required(summary[over50Key] <= summary[over33Key],
          `${matrix} ${route} ${event} ${owner} ${stream} >50 ms count exceeds >33 ms count.`);
      }
      const framesOver33Ms = comparisonMeasurement(
        beforeSummary[over33Key],
        afterSummary[over33Key],
      );
      const framesOver50Ms = comparisonMeasurement(
        beforeSummary[over50Key],
        afterSummary[over50Key],
      );
      const framesOver33Pass = framesOver33Ms.after <= framesOver33Ms.before;
      const framesOver50Pass = framesOver50Ms.after <= framesOver50Ms.before;
      cadenceFrameCountRows.push({
        matrix,
        route,
        event,
        stream,
        before: {
          framesOver33Ms: framesOver33Ms.before,
          framesOver50Ms: framesOver50Ms.before,
        },
        after: {
          framesOver33Ms: framesOver33Ms.after,
          framesOver50Ms: framesOver50Ms.after,
        },
        framesOver33Ms,
        framesOver50Ms,
        framesOver33Pass,
        framesOver50Pass,
        ok: framesOver33Pass && framesOver50Pass,
      });
    }
  };
  for (const current of currentMatrixRuns) {
    const reference = referenceByName.get(current.run?.name);
    required(reference?.matrix?.frameTiming && current?.matrix?.frameTiming,
      `${current.run?.name || '(unknown matrix)'} lacks sealed GPU/CPU timing in one phase.`);
    for (const route of ['idle', 'indoorWalk', 'capLadder']) {
      const beforeRoute = reference.matrix.frameTiming.routes?.[route];
      const afterRoute = current.matrix.frameTiming.routes?.[route];
      required(JSON.stringify(beforeRoute?.labels) === JSON.stringify(afterRoute?.labels),
        `${current.run.name} ${route} timing labels differ between phases.`);
      for (const stream of ['cpuSubmit', 'gpu']) {
        const before = beforeRoute?.[stream];
        const after = afterRoute?.[stream];
        required(Number.isFinite(before?.p95) && Number.isFinite(before?.worst)
          && Number.isFinite(after?.p95) && Number.isFinite(after?.worst),
        `${current.run.name} ${route} ${stream} comparison values are incomplete.`);
        const p95ToleranceMs = tolerance(before.p95);
        const worstToleranceMs = tolerance(before.worst);
        const p95Pass = after.p95 <= before.p95 + p95ToleranceMs;
        const worstPass = after.worst <= before.worst + worstToleranceMs;
        rows.push({
          matrix: current.run.name,
          route,
          stream,
          before: clone(before),
          after: clone(after),
          p95ToleranceMs,
          worstToleranceMs,
          p95Pass,
          worstPass,
          ok: p95Pass && worstPass,
        });
      }
    }
    const beforeWalk = reference.matrix.indoorWalk;
    const afterWalk = current.matrix.indoorWalk;
    const hasSerializedCadenceCounts = beforeWalk != null || afterWalk != null
      || reference.matrix.capLadder != null || current.matrix.capLadder != null;
    required(hasSerializedCadenceCounts || options.requireCadenceFrameCounts !== true,
      `${current.run.name} lacks serialized display/render frame-count evidence.`);
    if (!hasSerializedCadenceCounts) continue;
    required(beforeWalk && afterWalk,
      `${current.run.name} 60-second indoor-walk evidence is missing in one phase.`);
    appendCadenceFrameCountRows(
      current.run.name,
      'indoorWalk',
      '60-second-route',
      beforeWalk,
      afterWalk,
    );
    const beforeCapEvents = reference.matrix.capLadder?.events;
    const afterCapEvents = current.matrix.capLadder?.events;
    required(Array.isArray(beforeCapEvents) && Array.isArray(afterCapEvents),
      `${current.run.name} cap-ladder frame-count evidence is missing in one phase.`);
    const capIdentity = (events) => events.map(({ requestedCap, appliedCap }) => ({
      requestedCap,
      appliedCap,
    }));
    required(JSON.stringify(capIdentity(beforeCapEvents)) === JSON.stringify(capIdentity(afterCapEvents)),
      `${current.run.name} cap-ladder event identities differ between phases.`);
    required(new Set(beforeCapEvents.map(({ requestedCap }) => requestedCap)).size
      === beforeCapEvents.length,
    `${current.run.name} baseline cap-ladder event identities are duplicated.`);
    for (let index = 0; index < beforeCapEvents.length; index += 1) {
      appendCadenceFrameCountRows(
        current.run.name,
        'capLadder',
        `cap-${beforeCapEvents[index].requestedCap}`,
        beforeCapEvents[index],
        afterCapEvents[index],
      );
    }
  }
  const cadenceFrameCounts = {
    policy: {
      metrics: ['framesOver33Ms', 'framesOver50Ms'],
      tolerance: 'no increase',
      streams: ['display', 'render'],
      routes: ['indoorWalk', 'capLadder'],
    },
    rows: cadenceFrameCountRows,
    ok: cadenceFrameCountRows.every((row) => row.ok),
  };
  return {
    policy: {
      metrics: ['p95', 'worst'],
      relativeTolerancePct: 5,
      minimumToleranceMs: 0.25,
      streams: ['cpuSubmit', 'gpu'],
      routes: ['idle', 'indoorWalk', 'capLadder'],
    },
    rows,
    cadenceFrameCounts,
    ok: rows.length === MATRIX.length * 3 * 2
      && rows.every((row) => row.ok)
      && cadenceFrameCounts.ok,
  };
}

export function goal24InteractionEnvironmentPin(report) {
  return {
    toolManifest: report?.environment?.toolManifest,
    renderer: report?.environment?.renderer,
    gpu: report?.environment?.gpu,
    window: report?.environment?.window,
    devicePixelRatio: report?.environment?.devicePixelRatio,
    quality: report?.environment?.quality,
    profile: report?.environment?.profile ? {
      name: report.environment.profile.name,
      saveFixture: report.environment.profile.saveFixture,
      cameraRoute: report.environment.profile.cameraRoute,
      userDataPolicy: report.environment.profile.userDataPolicy,
      coldRunProfileRoot: report.environment.profile.coldRunProfileRoot,
      shaderCachePolicy: report.environment.profile.shaderCachePolicy,
      gpuCachePolicy: report.environment.profile.gpuCachePolicy,
      seed: report.environment.profile.seed,
      supportedToolIds: report.environment.profile.supportedToolIds,
    } : null,
  };
}

export function compareAcceptance(
  reference,
  current,
  pinned,
  machine,
  currentReport,
  currentRuns,
) {
  required(reference?.[REFERENCE_VERIFICATION],
    'Reference aggregate was not loaded through sealed-publication verification.');
  required(reference?.schema === GOAL24_ORCHESTRATOR_SCHEMA, 'Reference aggregate has an unknown schema.');
  validateBaselineReferenceOutcome(reference);
  required(/^[0-9a-f]{40,64}$/iu.test(reference.repository?.head || '')
    && typeof reference.repository?.branch === 'string' && reference.repository.branch.length > 0
    && /^[0-9a-f]{64}$/iu.test(reference.repository?.workingTreeFingerprintSha256 || ''),
  'Reference repository identity/fingerprint is incomplete.');
  required(reference.repositoryAfterRuns?.head === reference.repository.head
    && reference.repositoryAfterRuns?.branch === reference.repository.branch
    && reference.repositoryAfterRuns?.workingTreeFingerprintSha256
      === reference.repository.workingTreeFingerprintSha256,
  'Reference repository changed during its measurement session.');
  const validateRunStructure = (runs, owner, repository) => {
    required(Array.isArray(runs) && runs.length === 14,
      `${owner} must contain exactly 14 serialized process results.`);
    required(runs.every((entry) => entry.ok === true
      && Number.isInteger(entry.processId) && entry.processId > 0
      && entry.electronMainProcessIdentity?.pid === entry.processId
      && Number.isSafeInteger(entry.electronMainProcessIdentity?.creationTimeEpochUs)
      && entry.electronMainProcessIdentity.creationTimeEpochUs > 0
      && typeof entry.profilePath === 'string' && entry.profilePath.length > 0
      && typeof entry.profileId === 'string' && entry.profileId.length > 0
      && typeof entry.launchId === 'string' && entry.launchId.length > 0),
    `${owner} has an unsuccessful or identity-incomplete process result.`);
    const matchesRepository = (snapshot) => snapshot?.head === repository.head
      && snapshot?.branch === repository.branch
      && snapshot?.workingTreeFingerprintSha256 === repository.workingTreeFingerprintSha256;
    required(runs.every((entry) => matchesRepository(entry.repositoryBeforeRun)
      && matchesRepository(entry.repositoryAfterRun)),
    `${owner} has missing or drifted per-process repository fingerprints.`);
    const count = (predicate) => runs.filter(predicate).length;
    required(count((entry) => entry.run?.role === 'acceptance-cold'
      && entry.run?.instrumentation === 'low-overhead') === REQUIRED_COLD_PROCESS_COUNT,
    `${owner} must contain seven low-overhead cold process results.`);
    required(count((entry) => entry.run?.role === 'acceptance-full'
      && entry.run?.instrumentation === 'low-overhead') === 1,
    `${owner} must contain one separate low-overhead full process result.`);
    required(count((entry) => entry.run?.leg === 'matrix'
      && entry.run?.instrumentation === 'low-overhead') === MATRIX.length,
    `${owner} must contain four low-overhead matrix process results.`);
    required(count((entry) => entry.run?.leg === 'trace'
      && entry.run?.instrumentation === 'cdp-trace' && entry.run?.gradeEligible === false) === 1,
    `${owner} must contain one non-grading trace process result.`);
    required(count((entry) => entry.run?.leg === 'overlay'
      && entry.run?.instrumentation === 'video' && entry.run?.gradeEligible === false) === 1,
    `${owner} must contain one non-grading overlay/video process result.`);
    required(new Set(runs.map((entry) => entry.profilePath.toLowerCase())).size === runs.length,
      `${owner} reused an Electron profile path.`);
    required(new Set(runs.map((entry) => entry.profileId.toLowerCase())).size === runs.length,
      `${owner} reused an Electron profile instance ID.`);
    required(new Set(runs.map((entry) => entry.launchId.toLowerCase())).size === runs.length,
      `${owner} reused a runner launch instance ID.`);
    required(new Set(runs.map((entry) => (
      `${entry.electronMainProcessIdentity.pid}:${entry.electronMainProcessIdentity.creationTimeEpochUs}`
    ))).size === runs.length, `${owner} reused an Electron Browser process identity.`);
  };
  validateRunStructure(reference.runs, 'Reference', reference.repository);
  validateRunStructure(currentRuns, 'Comparison', currentRuns[0]?.repositoryBeforeRun);
  validateComparisonProfileIsolation(reference.runs, currentRuns);
  const referenceBrowserInstances = new Set(reference.runs.map((entry) => (
    `${entry.electronMainProcessIdentity.pid}:${entry.electronMainProcessIdentity.creationTimeEpochUs}`
  )));
  required(currentRuns.every((entry) => !referenceBrowserInstances.has(
    `${entry.electronMainProcessIdentity.pid}:${entry.electronMainProcessIdentity.creationTimeEpochUs}`,
  )), 'Reference and comparison reused an Electron Browser process identity.');
  required(JSON.stringify(reference.pinned) === JSON.stringify(pinned),
    'Reference and comparison pinned metadata differ.');
  required(reference.acceptance?.report, 'Reference aggregate has no locked acceptance report.');
  validateGoal24DoorEvidenceAggregate(reference.acceptance.report.doorEvidence);
  validateGoal24DoorEvidenceAggregate(currentReport?.doorEvidence);
  const reevaluated = evaluateLockedInteractionPerformanceReport(reference.acceptance.report);
  required(JSON.stringify(reference.acceptance.evaluation) === JSON.stringify(reevaluated),
    'Reference stored evaluation does not match a fresh locked-evaluator result.');
  for (const key of ['hostname', 'platform', 'release', 'architecture', 'node', 'cpuModel', 'logicalCpuCount', 'totalMemoryBytes']) {
    required(reference.machine?.[key] === machine?.[key], `Reference machine.${key} differs from comparison.`);
  }
  required(JSON.stringify(goal24InteractionEnvironmentPin(reference.acceptance.report))
    === JSON.stringify(goal24InteractionEnvironmentPin(currentReport)),
  'Reference and comparison measured GPU/window/DPR/quality/profile/tool-manifest environments differ.');
  const runtimePin = (runs, owner) => {
    required(Array.isArray(runs) && runs.length > 0, `${owner} run metadata is missing.`);
    const versions = runs.map((entry) => entry.runtimeVersions).filter(Boolean);
    required(versions.length === runs.length, `${owner} Electron runtime-version evidence is incomplete.`);
    required(versions.every((value) => JSON.stringify(value) === JSON.stringify(versions[0])),
      `${owner} Electron runtime versions drifted within the session.`);
    return versions[0];
  };
  required(JSON.stringify(runtimePin(reference.runs, 'Reference'))
    === JSON.stringify(runtimePin(currentRuns, 'Comparison')),
  'Reference and comparison Electron/Chromium runtime versions differ.');
  const matrixConditions = (runs, owner) => {
    const entries = runs.filter((entry) => entry.run?.leg === 'matrix');
    required(entries.length === MATRIX.length, `${owner} matrix coverage is incomplete.`);
    const conditions = entries.map((entry) => {
      required(entry.matrix && typeof entry.matrix === 'object',
        `${owner} matrix evidence is missing for ${entry.run?.name || '(unknown)'}.`);
      const cap120 = entry.matrix.capLadder?.events?.some(({ requestedCap }) => requestedCap === 120)
        ? 'measured' : entry.matrix.capLadder?.skipped?.some(({ cap, reason }) => cap === 120 && reason)
          ? 'skipped' : 'unproven';
      return {
        id: entry.run.name,
        requested: entry.matrix.requested,
        actual: entry.matrix.actual,
        refreshHz: entry.matrix.refreshHz,
        display: entry.matrix.display,
        frameTimingIdentity: {
          context: {
            version: entry.matrix.frameTiming?.context?.version ?? null,
            unmaskedVendor: entry.matrix.frameTiming?.context?.unmaskedVendor ?? null,
            unmaskedRenderer: entry.matrix.frameTiming?.context?.unmaskedRenderer ?? null,
            drawingBufferWidth: entry.matrix.frameTiming?.context?.drawingBufferWidth ?? null,
            drawingBufferHeight: entry.matrix.frameTiming?.context?.drawingBufferHeight ?? null,
            proof: clone(entry.matrix.frameTiming?.context?.proof ?? null),
          },
          routeLabels: Object.fromEntries(['idle', 'indoorWalk', 'capLadder'].map((route) => (
            [route, clone(entry.matrix.frameTiming?.routes?.[route]?.labels ?? null)]
          ))),
        },
        cap120,
      };
    });
    required(new Set(conditions.map(({ id }) => id)).size === MATRIX.length,
      `${owner} matrix identities are duplicated.`);
    return conditions;
  };
  required(JSON.stringify(matrixConditions(reference.runs, 'Reference'))
    === JSON.stringify(matrixConditions(currentRuns, 'Comparison')),
  'Reference and comparison display/matrix conditions differ.');
  required(Array.isArray(current?.gates)
    && current.gates.length === LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.length,
  'Current evaluation gate coverage is incomplete.');
  required(Array.isArray(reevaluated.gates)
    && reevaluated.gates.length === LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.length,
  'Reference evaluation gate coverage is incomplete.');
  const interactionComparison = compareLockedEvaluationGates(reevaluated, current, {
    referenceReport: reference.acceptance.report,
    currentReport,
  });
  const matrixFrameTiming = compareMatrixFrameTiming(reference.runs, currentRuns, {
    requireCadenceFrameCounts: true,
  });
  const doorEvidence = compareGoal24DoorEvidenceAggregates(
    reference.acceptance.report.doorEvidence,
    currentReport.doorEvidence,
  );
  return {
    ...interactionComparison,
    matrixFrameTiming,
    doorEvidence,
    ok: interactionComparison.ok && matrixFrameTiming.ok && doorEvidence.ok,
  };
}

/**
 * A pre-fix baseline is expected to retain current failures. It must still be
 * a sealed, complete, internally consistent 14-process measurement, while the
 * comparison candidate remains subject to every absolute locked gate. Requiring
 * the baseline itself to pass would make the requested before measurement
 * impossible whenever the reported hitch is real.
 */
export function validateBaselineReferenceOutcome(reference) {
  required(reference?.phase === 'baseline', 'Reference aggregate must be a baseline run.');
  required(reference?.completeProtocol === true && reference?.executionOk === true,
    'Reference aggregate must have completed the entire protocol.');
  const passed = reference?.acceptance?.evaluation?.ok === true;
  required(reference?.accepted === passed
    && reference?.ok === passed
    && reference?.state === (passed ? 'accepted' : 'rejected')
    && reference?.acceptance?.status === (passed ? 'pass' : 'fail'),
  'Reference baseline outcome fields do not match its locked evaluation.');
  return { passed };
}

export function validateComparisonProfileIsolation(referenceRuns, currentRuns) {
  required(Array.isArray(referenceRuns) && referenceRuns.length > 0,
    'Reference profile identities are missing.');
  required(Array.isArray(currentRuns) && currentRuns.length > 0,
    'Comparison profile identities are missing.');
  required(referenceRuns.every((entry) => typeof entry.profilePath === 'string'
    && path.isAbsolute(entry.profilePath)
    && entry.profilePath.length > 0 && typeof entry.profileId === 'string' && entry.profileId.length > 0
    && typeof entry.launchId === 'string' && entry.launchId.length > 0),
  'Reference profile identity/path evidence is incomplete.');
  required(currentRuns.every((entry) => typeof entry.profilePath === 'string'
    && path.isAbsolute(entry.profilePath)
    && entry.profilePath.length > 0 && typeof entry.profileId === 'string' && entry.profileId.length > 0
    && typeof entry.launchId === 'string' && entry.launchId.length > 0),
  'Comparison profile identity/path evidence is incomplete.');
  const referenceProfilePaths = new Set(referenceRuns.map((entry) => canonicalFilesystemPath(entry.profilePath)));
  const referenceProfileIds = new Set(referenceRuns.map((entry) => entry.profileId.toLowerCase()));
  const referenceLaunchIds = new Set(referenceRuns.map((entry) => entry.launchId.toLowerCase()));
  required(currentRuns.every((entry) => !referenceProfilePaths.has(canonicalFilesystemPath(entry.profilePath))),
    'Reference and comparison reused an Electron profile path.');
  required(currentRuns.every((entry) => !referenceProfileIds.has(entry.profileId.toLowerCase())),
    'Reference and comparison reused an Electron profile instance ID.');
  required(currentRuns.every((entry) => !referenceLaunchIds.has(entry.launchId.toLowerCase())),
    'Reference and comparison reused a runner launch instance ID.');
  return true;
}

function goal24WorkloadContextFailures(reference, current, path = 'workloadContext') {
  const failures = [];
  const visit = (before, after, currentPath) => {
    if (typeof before === 'number' || typeof after === 'number') {
      const numericPose = currentPath.startsWith(`${path}.camera.`)
        || currentPath.startsWith(`${path}.walk.`);
      const tolerance = numericPose
        ? LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress
          .workloadContextComparison.numericPoseTolerance
        : 0;
      if (!Number.isFinite(before) || !Number.isFinite(after)
        || Math.abs(after - before) > tolerance) {
        failures.push(`${currentPath} differs (tolerance ${tolerance})`);
      }
      return;
    }
    if (Array.isArray(before) || Array.isArray(after)) {
      if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
        failures.push(`${currentPath} array shape differs`);
        return;
      }
      before.forEach((entry, index) => visit(entry, after[index], `${currentPath}[${index}]`));
      return;
    }
    if ((before && typeof before === 'object') || (after && typeof after === 'object')) {
      if (!before || !after || typeof before !== 'object' || typeof after !== 'object') {
        failures.push(`${currentPath} object shape differs`);
        return;
      }
      const beforeKeys = Object.keys(before).sort();
      const afterKeys = Object.keys(after).sort();
      if (!isDeepStrictEqual(beforeKeys, afterKeys)) {
        failures.push(`${currentPath} fields differ`);
        return;
      }
      beforeKeys.forEach((key) => visit(before[key], after[key], `${currentPath}.${key}`));
      return;
    }
    if (!Object.is(before, after)) failures.push(`${currentPath} differs`);
  };
  visit(reference, current, path);
  return failures;
}

function compareResourceCheckpointContexts(reference, current, owner) {
  const before = reference?.checkpoints;
  const after = current?.checkpoints;
  const applicable = before != null || after != null;
  if (!applicable) return { applicable: false, ok: true, checkpoints: [], failures: [] };
  const failures = [];
  if (!Array.isArray(before) || !Array.isArray(after)) {
    failures.push(`${owner} resource checkpoints are missing on one side`);
    return { applicable: true, ok: false, checkpoints: [], failures };
  }
  const beforeByIteration = new Map();
  const afterByIteration = new Map();
  for (const [label, samples, target] of [
    ['reference', before, beforeByIteration],
    ['comparison', after, afterByIteration],
  ]) {
    for (const sample of samples) {
      if (!Number.isInteger(sample?.iteration) || target.has(sample.iteration)) {
        failures.push(`${owner} ${label} resource iteration keys are invalid or duplicated`);
        continue;
      }
      target.set(sample.iteration, sample);
    }
  }
  const iterations = [...new Set([...beforeByIteration.keys(), ...afterByIteration.keys()])]
    .sort((left, right) => left - right);
  const persistentMetrics = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress
    .persistentResourceMetrics;
  const heapPolicy = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.jsHeapTolerance;
  const checkpoints = iterations.map((iteration) => {
    const beforeSample = beforeByIteration.get(iteration);
    const afterSample = afterByIteration.get(iteration);
    const checkpointFailures = [];
    let metricRows = [];
    if (!beforeSample || !afterSample) {
      checkpointFailures.push(`${owner} iteration ${iteration} is missing on one side`);
    } else {
      checkpointFailures.push(...goal24WorkloadContextFailures(
        beforeSample.workloadContext,
        afterSample.workloadContext,
        `${owner}[${iteration}].workloadContext`,
      ));
      metricRows = persistentMetrics.map((metric) => {
        const beforeValue = beforeSample.metrics?.[metric];
        const afterValue = afterSample.metrics?.[metric];
        const allowedIncrease = metric === 'jsHeapUsedBytes' && Number.isFinite(beforeValue)
          ? Math.max(heapPolicy.minimumBytes, beforeValue * heapPolicy.relativeFraction)
          : 0;
        const pass = Number.isFinite(beforeValue)
          && Number.isFinite(afterValue)
          && afterValue <= beforeValue + allowedIncrease;
        if (!pass) {
          checkpointFailures.push(
            `${owner}[${iteration}].metrics.${metric} is missing or increased beyond tolerance`,
          );
        }
        return {
          metric,
          before: beforeValue ?? null,
          after: afterValue ?? null,
          allowedIncrease,
          comparison: comparisonMeasurement(beforeValue, afterValue),
          pass,
        };
      });
    }
    failures.push(...checkpointFailures);
    return {
      scenario: owner,
      iteration,
      referenceLabel: beforeSample?.label ?? null,
      currentLabel: afterSample?.label ?? null,
      metricRows,
      failures: checkpointFailures,
      ok: checkpointFailures.length === 0,
    };
  });
  return { applicable: true, ok: failures.length === 0, checkpoints, failures };
}

function resourceRegressionRows(reference, current, { includeWorkload = false } = {}) {
  const persistent = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress
    .persistentResourceMetrics;
  const metrics = includeWorkload
    ? [...persistent, 'drawCallCount', 'renderedTriangleCount']
    : [...persistent];
  const heapPolicy = LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.jsHeapTolerance;
  return metrics.map((metric) => {
    const beforeMetric = reference?.metrics?.[metric];
    const afterMetric = current?.metrics?.[metric];
    const applicable = beforeMetric != null || afterMetric != null;
    const fields = ['start', 'end', 'maximum'];
    const comparisons = Object.fromEntries(fields.map((field) => {
      const beforeValue = beforeMetric?.[field];
      const afterValue = afterMetric?.[field];
      const allowedIncrease = metric === 'jsHeapUsedBytes' && Number.isFinite(beforeValue)
        ? Math.max(heapPolicy.minimumBytes, beforeValue * heapPolicy.relativeFraction)
        : 0;
      const pass = !applicable || (
        Number.isFinite(beforeValue)
        && Number.isFinite(afterValue)
        && afterValue <= beforeValue + allowedIncrease
      );
      return [field, {
        before: beforeValue ?? null,
        after: afterValue ?? null,
        allowedIncrease,
        comparison: comparisonMeasurement(beforeValue, afterValue),
        pass,
      }];
    }));
    return {
      metric,
      persistent: persistent.includes(metric),
      applicable,
      beforeStart: comparisons.start.before,
      afterStart: comparisons.start.after,
      startComparison: comparisons.start.comparison,
      beforeEnd: comparisons.end.before,
      afterEnd: comparisons.end.after,
      endComparison: comparisons.end.comparison,
      beforeMaximum: comparisons.maximum.before,
      afterMaximum: comparisons.maximum.after,
      maximumComparison: comparisons.maximum.comparison,
      allowedStartIncrease: comparisons.start.allowedIncrease,
      allowedEndIncrease: comparisons.end.allowedIncrease,
      allowedMaximumIncrease: comparisons.maximum.allowedIncrease,
      startPass: comparisons.start.pass,
      endPass: comparisons.end.pass,
      maximumPass: comparisons.maximum.pass,
      ok: comparisons.start.pass && comparisons.end.pass && comparisons.maximum.pass,
    };
  });
}

export function compareLockedEvaluationGates(referenceEvaluation, currentEvaluation, options = {}) {
  required(Array.isArray(referenceEvaluation?.gates)
    && referenceEvaluation.gates.length === LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.length,
  'Reference evaluation gate coverage is incomplete.');
  required(Array.isArray(currentEvaluation?.gates)
    && currentEvaluation.gates.length === LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.scenarioOrder.length,
  'Current evaluation gate coverage is incomplete.');
  const prior = new Map(referenceEvaluation.gates.map((gate) => [gate.scenario, gate]));
  const reportRunCount = (report, scenarioId, thermalState, expectedEventCount, owner) => {
    if (report == null) return null;
    const scenario = report.scenarios?.find((entry) => entry?.id === scenarioId);
    required(scenario && Array.isArray(scenario.events),
      `${owner} report scenario ${scenarioId} is missing while deriving run counts.`);
    const events = scenario.events.filter((event) => event?.temperature === thermalState);
    required(events.length === expectedEventCount,
      `${owner} ${scenarioId} ${thermalState} event count differs from its evaluation summary.`);
    if (events.length === 0) return 0;
    const runIds = events.map((event) => event?.source?.runId);
    required(runIds.every((runId) => typeof runId === 'string' && runId.length > 0),
      `${owner} ${scenarioId} ${thermalState} events lack source-run provenance.`);
    return new Set(runIds).size;
  };
  const gates = currentEvaluation.gates.map((gate) => {
    const before = prior.get(gate.scenario);
    required(before, `Reference evaluation is missing gate ${gate.scenario}.`);
    const distributionComparison = (beforeDistribution, afterDistribution) => Object.fromEntries(
      ['medianMs', 'p95Ms', 'worstMs'].map((key) => [
        key,
        comparisonMeasurement(beforeDistribution?.[key], afterDistribution?.[key]),
      ]),
    );
    const cadenceComparison = (beforeCadence, afterCadence) => ({
      ...distributionComparison(beforeCadence, afterCadence),
      framesOver33Ms: comparisonMeasurement(
        beforeCadence?.framesOver33Ms,
        afterCadence?.framesOver33Ms,
      ),
      framesOver50Ms: comparisonMeasurement(
        beforeCadence?.framesOver50Ms,
        afterCadence?.framesOver50Ms,
      ),
    });
    const thermalComparison = (thermalState) => {
      const beforeSummary = before?.summary?.[thermalState] ?? null;
      const afterSummary = gate?.summary?.[thermalState] ?? null;
      const beforeEventCount = beforeSummary?.eventCount ?? 0;
      const afterEventCount = afterSummary?.eventCount ?? 0;
      return {
        runCount: comparisonMeasurement(
          reportRunCount(
            options.referenceReport,
            gate.scenario,
            thermalState,
            beforeEventCount,
            'Reference',
          ),
          reportRunCount(
            options.currentReport,
            gate.scenario,
            thermalState,
            afterEventCount,
            'Comparison',
          ),
        ),
        eventCount: comparisonMeasurement(beforeEventCount, afterEventCount),
        interactionDuration: distributionComparison(
          beforeSummary?.interactionDuration,
          afterSummary?.interactionDuration,
        ),
        displayCadence: cadenceComparison(
          beforeSummary?.displayCadence,
          afterSummary?.displayCadence,
        ),
        renderCadence: cadenceComparison(
          beforeSummary?.renderCadence,
          afterSummary?.renderCadence,
        ),
        recurringEvents: {
          eventsWithFrameOver33Ms: comparisonMeasurement(
            beforeSummary?.eventsWithFrameOver33Ms,
            afterSummary?.eventsWithFrameOver33Ms,
          ),
          eventsWithFrameOver50Ms: comparisonMeasurement(
            beforeSummary?.eventsWithFrameOver50Ms,
            afterSummary?.eventsWithFrameOver50Ms,
          ),
        },
      };
    };
    const thermalComparisons = {
      cold: thermalComparison('cold'),
      warm: thermalComparison('warm'),
    };
    const metric = (owner, cadence, key) => owner?.summary?.warm?.[cadence]?.[key] ?? null;
    const coldMetric = (owner, cadence, key) => owner?.summary?.cold?.[cadence]?.[key] ?? null;
    const delta = (after, beforeValue) => Number.isFinite(after) && Number.isFinite(beforeValue)
      ? +(after - beforeValue).toFixed(3) : null;
    const beforeDisplayP95 = metric(before, 'displayCadence', 'p95Ms');
    const afterDisplayP95 = metric(gate, 'displayCadence', 'p95Ms');
    const beforeRenderP95 = metric(before, 'renderCadence', 'p95Ms');
    const afterRenderP95 = metric(gate, 'renderCadence', 'p95Ms');
    const coldDurationBefore = before?.summary?.cold?.interactionDuration ?? null;
    const coldDurationAfter = gate?.summary?.cold?.interactionDuration ?? null;
    const hasColdSummary = (summary) => (summary?.eventCount ?? 0) > 0
      || ['medianMs', 'p95Ms', 'worstMs'].some((key) => (
        Number.isFinite(summary?.interactionDuration?.[key])
      ))
      || Number.isFinite(summary?.displayCadence?.p95Ms)
      || Number.isFinite(summary?.renderCadence?.p95Ms);
    const coldDurationGate = hasColdSummary(before?.summary?.cold)
      || hasColdSummary(gate?.summary?.cold);
    const coldMinimumToleranceMs = ['coldLaunch', 'startToControllable'].includes(gate.scenario)
      ? 50 : 10;
    const coldTolerance = (value) => Math.max(coldMinimumToleranceMs, value * 0.05);
    const coldDurationPass = !coldDurationGate || (
      Number.isFinite(coldDurationBefore?.medianMs)
      && Number.isFinite(coldDurationAfter?.medianMs)
      && Number.isFinite(coldDurationBefore?.p95Ms)
      && Number.isFinite(coldDurationAfter?.p95Ms)
      && Number.isFinite(coldDurationBefore?.worstMs)
      && Number.isFinite(coldDurationAfter?.worstMs)
      && coldDurationAfter.medianMs <= coldDurationBefore.medianMs
        + coldTolerance(coldDurationBefore.medianMs)
      && coldDurationAfter.p95Ms <= coldDurationBefore.p95Ms
        + coldTolerance(coldDurationBefore.p95Ms)
      && coldDurationAfter.worstMs <= coldDurationBefore.worstMs
        + coldTolerance(coldDurationBefore.worstMs)
    );
    const cadenceRegression = (thermalState, cadence) => {
      const summary = (owner) => owner?.summary?.[thermalState]?.[cadence] ?? null;
      const beforeCadence = summary(before);
      const afterCadence = summary(gate);
      if (beforeCadence == null && afterCadence == null) {
        return { applicable: false, p95Pass: true, worstPass: true,
          framesOver33Pass: true, framesOver50Pass: true, ok: true };
      }
      const tolerance = (value) => Math.max(0.5, value * 0.05);
      const p95Pass = Number.isFinite(beforeCadence?.p95Ms)
        && Number.isFinite(afterCadence?.p95Ms)
        && afterCadence.p95Ms <= beforeCadence.p95Ms + tolerance(beforeCadence.p95Ms);
      const worstPass = Number.isFinite(beforeCadence?.worstMs)
        && Number.isFinite(afterCadence?.worstMs)
        && afterCadence.worstMs <= beforeCadence.worstMs + tolerance(beforeCadence.worstMs);
      const countPass = (key) => Number.isInteger(beforeCadence?.[key])
        && Number.isInteger(afterCadence?.[key])
        && afterCadence[key] <= beforeCadence[key];
      const framesOver33Pass = countPass('framesOver33Ms');
      const framesOver50Pass = countPass('framesOver50Ms');
      return {
        applicable: true,
        before: clone(beforeCadence),
        after: clone(afterCadence),
        p95Pass,
        worstPass,
        framesOver33Pass,
        framesOver50Pass,
        ok: p95Pass && worstPass && framesOver33Pass && framesOver50Pass,
      };
    };
    const coldDisplayCadence = cadenceRegression('cold', 'displayCadence');
    const coldRenderCadence = cadenceRegression('cold', 'renderCadence');
    const warmDisplayCadence = cadenceRegression('warm', 'displayCadence');
    const warmRenderCadence = cadenceRegression('warm', 'renderCadence');
    const coldDisplayP95Before = coldMetric(before, 'displayCadence', 'p95Ms');
    const coldDisplayP95After = coldMetric(gate, 'displayCadence', 'p95Ms');
    const coldRenderP95Before = coldMetric(before, 'renderCadence', 'p95Ms');
    const coldRenderP95After = coldMetric(gate, 'renderCadence', 'p95Ms');
    const coldDisplayCadencePass = !coldDurationGate || coldDisplayCadence.ok;
    const coldRenderCadencePass = !coldDurationGate || coldRenderCadence.ok;
    const eventCountRegressionPass = (thermalState, key) => {
      const beforeValue = before?.summary?.[thermalState]?.[key];
      const afterValue = gate?.summary?.[thermalState]?.[key];
      if (beforeValue == null && afterValue == null) return true;
      return Number.isInteger(beforeValue) && Number.isInteger(afterValue)
        && afterValue <= beforeValue;
    };
    const coldRecurringFramePass = eventCountRegressionPass('cold', 'eventsWithFrameOver33Ms')
      && eventCountRegressionPass('cold', 'eventsWithFrameOver50Ms');
    const warmRecurringFramePass = eventCountRegressionPass('warm', 'eventsWithFrameOver33Ms')
      && eventCountRegressionPass('warm', 'eventsWithFrameOver50Ms');
    const warmRegressionPass = !gate.warmAcceptance?.applicable || (
      warmDisplayCadence.ok
      && warmRenderCadence.ok
      && warmRecurringFramePass
      && gate.summary.warm.interactionDuration.p95Ms
        <= before.summary.warm.interactionDuration.p95Ms
          + Math.max(10, before.summary.warm.interactionDuration.p95Ms * 0.05)
    );
    const resourceRows = resourceRegressionRows(before?.resources, gate?.resources, {
      includeWorkload: true,
    });
    const resourceContext = compareResourceCheckpointContexts(
      before?.resources,
      gate?.resources,
      gate.scenario,
    );
    const resourceRegressionPass = resourceRows.every((row) => row.ok)
      && resourceContext.ok;
    return {
      scenario: gate.scenario,
      displayP95BeforeMs: beforeDisplayP95,
      displayP95AfterMs: afterDisplayP95,
      displayP95DeltaMs: delta(afterDisplayP95, beforeDisplayP95),
      renderP95BeforeMs: beforeRenderP95,
      renderP95AfterMs: afterRenderP95,
      renderP95DeltaMs: delta(afterRenderP95, beforeRenderP95),
      thermalComparisons,
      coldDurationBefore,
      coldDurationAfter,
      coldMinimumToleranceMs,
      coldDurationPass,
      coldDisplayP95BeforeMs: coldDisplayP95Before,
      coldDisplayP95AfterMs: coldDisplayP95After,
      coldDisplayCadencePass,
      coldDisplayCadence,
      coldRenderP95BeforeMs: coldRenderP95Before,
      coldRenderP95AfterMs: coldRenderP95After,
      coldRenderCadencePass,
      coldRenderCadence,
      coldRecurringFramePass,
      warmDisplayCadence,
      warmRenderCadence,
      warmRecurringFramePass,
      warmRegressionPass,
      resourceRows,
      resourceContext,
      resourceRegressionPass,
      ok: coldDurationPass && coldDisplayCadencePass && coldRenderCadencePass
        && coldRecurringFramePass && warmRegressionPass && resourceRegressionPass,
    };
  });
  const runResourceRows = resourceRegressionRows(
    referenceEvaluation.runResources,
    currentEvaluation.runResources,
  );
  const runResourceContext = compareResourceCheckpointContexts(
    referenceEvaluation.runResources,
    currentEvaluation.runResources,
    'run',
  );
  const runResourceRegressionPass = runResourceRows.every((row) => row.ok)
    && runResourceContext.ok;
  return {
    ok: gates.every((gate) => gate.ok) && runResourceRegressionPass,
    policy: {
      relativeTolerancePct: 5,
      coldMinimumToleranceMs: 50,
      coldInteractionMinimumToleranceMs: 10,
      warmCadenceMinimumToleranceMs: 0.5,
      warmResponseMinimumToleranceMs: 10,
      cadenceMetrics: ['p95Ms', 'worstMs', 'framesOver33Ms', 'framesOver50Ms'],
      recurringFrameMetrics: ['eventsWithFrameOver33Ms', 'eventsWithFrameOver50Ms'],
      persistentResourceMetrics: [
        ...LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.persistentResourceMetrics,
      ],
      workloadResourceMetrics: ['drawCallCount', 'renderedTriangleCount'],
      deterministicPersistentResourceTolerance: 'no increase in start, end, or maximum',
      jsHeapTolerance:
        LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.jsHeapTolerance.policy,
      workloadContextComparison:
        clone(LOCKED_INTERACTION_PERFORMANCE_PROTOCOL.stress.workloadContextComparison),
      workloadResourceTolerance: 'no increase in start, end, or maximum',
      comparisonFields: ['before', 'after', 'absoluteDelta', 'percentDelta'],
      percentDeltaUnit: 'percent',
      runCountSource: 'unique normalized event source.runId values per scenario and thermal state',
    },
    runResources: {
      rows: runResourceRows,
      context: runResourceContext,
      ok: runResourceRegressionPass,
    },
    gates,
  };
}

function machineMetadata() {
  const cpus = os.cpus();
  return {
    capturedAt: new Date().toISOString(),
    hostname: os.hostname(),
    platform: process.platform,
    release: os.release(),
    architecture: process.arch,
    node: process.version,
    cpuModel: cpus[0]?.model || null,
    logicalCpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytesAtStart: os.freemem(),
    instrumentationNote: 'OS snapshot only; display/GPU/window/quality readbacks are retained per Electron run.',
  };
}

export function repositoryMetadata(root = ROOT) {
  const git = (args) => {
    const result = spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 10_000,
      // Binary asset patches in this repository routinely exceed Node's
      // spawnSync default (~1 MiB). Truncating them would make two unknown
      // fingerprints compare equal, so retain the complete patch or fail.
      maxBuffer: 256 * 1024 * 1024,
    });
    required(!result.error,
      `git ${args.join(' ')} failed: ${result.error?.message || 'unknown spawn error'}`);
    required(result.signal == null,
      `git ${args.join(' ')} was terminated by ${result.signal}.`);
    required(result.status === 0,
      `git ${args.join(' ')} exited ${result.status}: ${String(result.stderr || '').trim()}`);
    return String(result.stdout || '').trim();
  };
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  const diff = git(['diff', '--binary', '--no-ext-diff', 'HEAD']);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']);
  const untrackedFiles = untracked.split('\0').filter(Boolean).map((relative) => {
    const full = path.resolve(root, relative);
    const relativeNormalized = slash(path.relative(root, full));
    required(relativeNormalized && !relativeNormalized.startsWith('../') && relativeNormalized !== '..',
      `Untracked fingerprint path escaped repository: ${relative}`);
    const stat = fs.lstatSync(full);
    required(stat.isFile() && !stat.isSymbolicLink(),
      `Untracked fingerprint requires a regular non-link file: ${relative}`);
    return {
      path: relativeNormalized,
      bytes: stat.size,
      sha256: createHash('sha256').update(fs.readFileSync(full)).digest('hex'),
    };
  });
  const fingerprint = createHash('sha256')
    .update(status).update('\0').update(diff).update('\0')
    .update(JSON.stringify(untrackedFiles)).digest('hex');
  const metadata = {
    root: slash(root),
    head: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: status.length > 0,
    dirtyPathCount: status ? status.split(/\r?\n/u).filter(Boolean).length : 0,
    untrackedFiles,
    workingTreeFingerprintSha256: fingerprint,
  };
  required(typeof metadata.head === 'string' && /^[0-9a-f]{40,64}$/iu.test(metadata.head),
    'Repository HEAD is missing or invalid.');
  required(typeof metadata.branch === 'string' && metadata.branch.length > 0,
    'Repository branch identity is missing.');
  required(/^[0-9a-f]{64}$/iu.test(metadata.workingTreeFingerprintSha256),
    'Repository working-tree fingerprint is missing or invalid.');
  return metadata;
}

function writeTextAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, String(value), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* retain the original publication error */ }
    }
    try { fs.unlinkSync(temporary); } catch { /* the temporary may never have been created */ }
    throw error;
  }
}

function writeJson(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(file) {
  const digest = createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      bytes += count;
      digest.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return { algorithm: 'sha256', sha256: digest.digest('hex'), bytes };
}

function artifactIntegrity(file, allowedRoot, label) {
  const canonical = assertRegularArtifactFile(file, allowedRoot, label);
  return { path: slash(canonical), ...sha256File(canonical) };
}

function artifactSetDigest(runs) {
  const entries = runs.flatMap((entry) => Object.entries(entry.artifacts || {})
    .map(([kind, artifact]) => ({
      runId: entry.run?.id,
      kind,
      path: artifact?.path,
      algorithm: artifact?.algorithm,
      bytes: artifact?.bytes,
      sha256: artifact?.sha256,
    })))
    .sort((left, right) => `${left.runId}\0${left.kind}`.localeCompare(`${right.runId}\0${right.kind}`));
  return {
    count: entries.length,
    sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  };
}

export function validateVideoContainer(file, label = 'video artifact', options = {}) {
  try {
    return analyzeGoal24Webm(file, options);
  } catch (error) {
    throw new Error(`${label} failed structured WebM validation: ${error.message}`, { cause: error });
  }
}

const OVERLAY_VIDEO_SCENARIOS = Object.freeze([
  'doorApproach',
  'doorOpen',
  'doorCrossing:outside-in',
  'doorCrossing:inside-out',
  'ledgerOpen',
  'ledgerPageTurn',
  'ledgerClose',
  'toolFirstUse',
  'toolSwitch',
  'npcNavActivation',
]);

export function validateOverlayFrameEvidence(raw, sessionDir, run) {
  const frames = raw?.evidence?.overlayFrames;
  required(Array.isArray(frames) && frames.length === OVERLAY_VIDEO_SCENARIOS.length,
    `${run.id}: closed visual-frame evidence is missing or incomplete; expected `
      + `${OVERLAY_VIDEO_SCENARIOS.length}, received ${Array.isArray(frames) ? frames.length : 'non-array'}.`);
  required(JSON.stringify(frames.map(({ scenario }) => scenario))
    === JSON.stringify(OVERLAY_VIDEO_SCENARIOS),
  `${run.id}: closed visual frames do not cover the exact interaction route in order.`);
  const identity = raw?.evidence?.videoIdentity;
  const launchId = raw?.contractEnvironment?.profile?.runnerLaunchId;
  required(identity?.sessionId === run.env?.GOAL24_PERF_SESSION_ID
    && identity?.runId === run.id
    && identity?.runnerLaunchId === launchId
    && typeof identity?.videoNonce === 'string'
    && /^[a-f0-9-]{16,}$/iu.test(identity.videoNonce),
  `${run.id}: visual evidence run/session/launch/video identity is missing or drifted.`);
  const rollingOverlay = raw?.cleanup?.overlay;
  required(rollingOverlay?.enabled === true && rollingOverlay?.visible === true
    && rollingOverlay?.uninstalled === true
    && OVERLAY_VIDEO_SCENARIOS.every((scenario) => (
      rollingOverlay.seenInteractionLabels?.includes(scenario)
    )),
  `${run.id}: the active diagnostic overlay did not cover the exact interaction route.`);
  const validated = [];
  for (let routeIndex = 0; routeIndex < OVERLAY_VIDEO_SCENARIOS.length; routeIndex += 1) {
    const scenario = OVERLAY_VIDEO_SCENARIOS[routeIndex];
    const frame = frames[routeIndex];
    required(frame?.schema === 'golf-flipper/goal24-closed-visual-frame/v1'
      && frame.capturePhase === 'after-recorder-detach-closed-event-outside-graded-timing'
      && frame.recorderActiveAtShow === false && frame.removed === true,
    `${run.id}: ${scenario} visual frame was not captured from a closed recorder event.`);
    required(Number.isInteger(frame.eventIndex) && frame.eventIndex >= 0,
      `${run.id}: ${scenario} visual frame lacks an exact raw event index.`);
    const rawEvent = raw?.scenarios?.[scenario]?.events?.[frame.eventIndex];
    required(rawEvent && rawEvent.id === frame.interactionId && rawEvent.scenario === scenario,
      `${run.id}: ${scenario} visual frame does not resolve to its raw event coordinate.`);
    const source = {
      sessionId: identity.sessionId,
      runId: identity.runId,
      launchId: identity.runnerLaunchId,
      videoNonce: identity.videoNonce,
      scenario,
      eventIndex: frame.eventIndex,
      interactionId: rawEvent.id,
    };
    const payload = goal24VisualEvidencePayload(rawEvent, source);
    const digest = goal24VisualEvidenceDigest(payload);
    required(isDeepStrictEqual(frame.payload, payload) && frame.digest === digest,
      `${run.id}: ${scenario} visual payload/digest is not reconstructed from its raw event.`);
    required(Number.isFinite(frame.shownAtMs)
      && Number.isFinite(frame.screenshotRequestedAtMs)
      && Number.isFinite(frame.screenshotCompletedAtMs)
      && Number.isFinite(frame.hiddenAtMs)
      && frame.shownAtMs <= frame.screenshotRequestedAtMs
      && frame.screenshotRequestedAtMs <= frame.screenshotCompletedAtMs
      && frame.screenshotCompletedAtMs <= frame.hiddenAtMs
      && Math.abs(frame.dwellDurationMs - (frame.hiddenAtMs - frame.shownAtMs)) <= 0.05
      && frame.dwellDurationMs >= 1_200
      && Number.isInteger(frame.presentedRafCount) && frame.presentedRafCount >= 12,
    `${run.id}: ${scenario} closed marker dwell/screenshot timing is invalid.`);
    required(typeof frame.text === 'string'
      && frame.text.includes('GOAL 24 — CLOSED EVENT VIDEO PROOF (NOT GRADED)')
      && frame.text.includes(`scenario: ${scenario}`)
      && frame.text.includes(`interaction: ${rawEvent.id}`)
      && frame.text.includes(`duration: ${payload.durationMs.toFixed(3)} ms`)
      && frame.text.includes(`digest: ${digest}`)
      && frame.text.includes('display p95/worst:')
      && frame.text.includes('render p95/worst:')
      && frame.text.includes('peak non-shadow draw/tri:'),
    `${run.id}: ${scenario} closed-event panel lacks its exact visible identity and metrics.`);
    const screenshot = assertRegularArtifactFile(
      frame.screenshot,
      sessionDir,
      `${run.id} ${scenario} closed-event screenshot`,
    );
    let png;
    try {
      png = PNG.sync.read(fs.readFileSync(screenshot));
    } catch (error) {
      throw new Error(`${run.id}: ${scenario} visual screenshot is not a valid PNG: ${error.message}`,
        { cause: error });
    }
    const dpr = Number(frame.viewport?.devicePixelRatio);
    const expectedWidth = Math.round(Number(frame.viewport?.width) * dpr);
    const expectedHeight = Math.round(Number(frame.viewport?.height) * dpr);
    required(Number.isFinite(dpr) && dpr > 0
      && png.width === expectedWidth && png.height === expectedHeight,
    `${run.id}: ${scenario} overlay screenshot dimensions do not match its captured viewport.`);
    const markerValidation = validateGoal24VisualMarkerPixels({
      png,
      markerRect: frame.markerRect,
      devicePixelRatio: dpr,
      payload,
    });
    const panelRect = frame.panelRect || {};
    required(Number(panelRect.width) >= 580 && Number(panelRect.height) >= 230
      && Number(panelRect.x) >= 0 && Number(panelRect.y) >= 0,
    `${run.id}: ${scenario} closed-event panel rectangle is missing or implausible.`);
    const excluded = [panelRect, frame.rollingOverlayRect].filter(Boolean);
    const sceneColors = new Set();
    let sceneSamples = 0;
    let sceneLuminanceSum = 0;
    let sceneLuminanceSquaredSum = 0;
    const inside = (x, y, rect) => x >= Number(rect.x) * dpr
      && x <= (Number(rect.x) + Number(rect.width)) * dpr
      && y >= Number(rect.y) * dpr
      && y <= (Number(rect.y) + Number(rect.height)) * dpr;
    for (let y = 12; y < png.height; y += 18) {
      for (let x = 12; x < png.width; x += 18) {
        if (excluded.some((rect) => inside(x, y, rect))) continue;
        const pixelIndex = (y * png.width + x) * 4;
        const red = png.data[pixelIndex];
        const green = png.data[pixelIndex + 1];
        const blue = png.data[pixelIndex + 2];
        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        sceneSamples += 1;
        sceneLuminanceSum += luminance;
        sceneLuminanceSquaredSum += luminance * luminance;
        sceneColors.add(`${red},${green},${blue}`);
      }
    }
    const sceneMean = sceneLuminanceSum / sceneSamples;
    const sceneVariance = sceneLuminanceSquaredSum / sceneSamples - sceneMean * sceneMean;
    required(sceneSamples >= 1_000 && sceneColors.size >= 80 && sceneVariance >= 100,
      `${run.id}: ${scenario} screenshot has no varied game scene outside diagnostic panels.`);
    validated.push({
      scenario,
      interactionId: frame.interactionId,
      eventIndex: frame.eventIndex,
      payload,
      digest,
      screenshot,
      width: png.width,
      height: png.height,
      markerRect: frame.markerRect,
      panelRect: frame.panelRect,
      excludedRects: [frame.rollingOverlayRect].filter(Boolean),
      markerValidation,
      dwellDurationMs: frame.dwellDurationMs,
      presentedRafCount: frame.presentedRafCount,
      sceneSamples,
      sceneUniqueColorsObserved: sceneColors.size,
      sceneLuminanceVariance: +sceneVariance.toFixed(3),
    });
  }
  return validated;
}

export function runMarkdown(aggregate) {
  const displayValue = (value) => value ?? 'n/a';
  const markdownCell = (value) => String(displayValue(value))
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
  const comparisonCell = (measurement) => {
    if (!measurement) return 'n/a / n/a / n/a / n/a';
    const percent = measurement.percentDelta == null
      ? measurement.percentDeltaStatus === 'undefined-zero-baseline'
        ? 'undefined (zero baseline)'
        : 'n/a'
      : `${measurement.percentDelta}%`;
    return [
      displayValue(measurement.before),
      displayValue(measurement.after),
      displayValue(measurement.absoluteDelta),
      percent,
    ].join(' / ');
  };
  const lines = [
    `# Goal 24 interaction performance - ${aggregate.sessionId}`,
    '',
    `Phase: ${aggregate.phase}`,
    '',
    `Acceptance: ${aggregate.acceptance.status}`,
    '',
    '| # | Leg | Run | Instrumentation | Requested | Process | Profile | Result |',
    '|---:|---|---|---|---|---:|---|---|',
    ...(aggregate.runs || []).map((entry) => [
      entry.run.ordinal,
      entry.run.leg,
      entry.run.id,
      entry.run.instrumentation,
      `${entry.run.width}x${entry.run.height} ${entry.run.mode}`,
      entry.processId ?? 'n/a',
      entry.profilePath ? path.basename(entry.profilePath) : 'n/a',
      entry.ok ? 'ok' : 'failed',
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
  ];
  const gates = aggregate.acceptance.evaluation?.gates || [];
  const reportScenarios = new Map(
    (aggregate.acceptance.report?.scenarios || []).map((scenario) => [scenario.id, scenario]),
  );
  const traceRows = (aggregate.runs || []).flatMap((entry) => (
    (entry.traceAttribution?.interactions || []).map((interaction) => ({
      runId: entry.run?.id || 'n/a',
      ...interaction,
    }))
  ));
  const contractScenarioForTrace = new Map(
    Object.entries(CONTRIBUTION_RAW_SCENARIOS).map(([contractId, rawScenario]) => (
      [rawScenario, contractId]
    )),
  );
  const longestTraceByScenario = new Map();
  for (const trace of traceRows) {
    const scenario = contractScenarioForTrace.get(trace.scenario) || trace.scenario;
    const prior = longestTraceByScenario.get(scenario);
    const durationMs = Number(trace.longestMainThreadTask?.durationMs);
    const priorDurationMs = Number(prior?.longestMainThreadTask?.durationMs);
    if (!prior || (Number.isFinite(durationMs) && (!Number.isFinite(priorDurationMs)
      || durationMs > priorDurationMs))) {
      longestTraceByScenario.set(scenario, trace);
    }
  }
  if (gates.length) {
    const thermalRows = gates.flatMap((gate) => ['cold', 'warm'].map((thermalState) => {
      const events = (reportScenarios.get(gate.scenario)?.events || [])
        .filter((event) => event?.temperature === thermalState);
      const trace = longestTraceByScenario.get(gate.scenario);
      const stateAcceptance = thermalState === 'cold'
        ? gate.coldAcceptance : gate.warmAcceptance;
      const applicable = stateAcceptance?.applicable === true;
      const statePass = !applicable || Object.entries(stateAcceptance || {})
        .filter(([key]) => key.endsWith('Pass'))
        .every(([, pass]) => pass === true);
      return {
        scenario: gate.scenario,
        thermalState,
        summary: gate.summary?.[thermalState],
        sourceRunCount: new Set(events.map((event) => event?.source?.runId).filter(Boolean)).size,
        trace,
        gate: applicable ? (statePass ? 'pass' : 'fail') : 'n/a',
      };
    }));
    lines.push(
      '| Scenario | State | Source runs | Events | Interaction median ms | Interaction p95 ms | Interaction worst ms | Recurring events >33 ms | Recurring events >50 ms | Longest main-thread task ms | Cause | Gate |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|',
      ...thermalRows.map((row) => [
        row.scenario,
        row.thermalState,
        row.sourceRunCount,
        row.summary?.eventCount ?? 0,
        row.summary?.interactionDuration?.medianMs,
        row.summary?.interactionDuration?.p95Ms,
        row.summary?.interactionDuration?.worstMs,
        row.summary?.eventsWithFrameOver33Ms,
        row.summary?.eventsWithFrameOver50Ms,
        row.trace?.longestMainThreadTask?.durationMs,
        row.trace?.attribution?.cause,
        row.gate,
      ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
      '',
      '| Scenario | State | Cadence | Frame median ms | Frame p95 ms | Frame worst ms | Frames >33 ms | Frames >50 ms |',
      '|---|---|---|---:|---:|---:|---:|---:|',
      ...thermalRows.flatMap((row) => [
        ['display', row.summary?.displayCadence],
        ['render', row.summary?.renderCadence],
      ].map(([stream, cadence]) => [
        row.scenario,
        row.thermalState,
        stream,
        cadence?.medianMs,
        cadence?.p95Ms,
        cadence?.worstMs,
        cadence?.framesOver33Ms,
        cadence?.framesOver50Ms,
      ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'))),
      '',
    );
    const resourceRows = [
      ...Object.entries(aggregate.acceptance?.evaluation?.runResources?.metrics || {})
        .map(([metric, measurement]) => ({ scenario: 'run', metric, ...measurement })),
      ...gates.flatMap((gate) => Object.entries(gate.resources?.metrics || {})
        .map(([metric, measurement]) => ({ scenario: gate.scenario, metric, ...measurement }))),
    ];
    if (resourceRows.length) {
      lines.push(
        '| Scenario | Resource | Start | End | Delta | Minimum | Maximum | Slope / iteration | Persistent |',
        '|---|---|---:|---:|---:|---:|---:|---:|---|',
        ...resourceRows.map((row) => [
          row.scenario,
          row.metric,
          row.start,
          row.end,
          row.delta,
          row.minimum,
          row.maximum,
          row.slopePerIteration,
          row.persistent,
        ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
        '',
      );
    }
  }
  if (aggregate.comparison?.gates?.length) {
    const thermalRows = aggregate.comparison.gates.flatMap((row) => (
      ['cold', 'warm'].map((thermalState) => ({
        scenario: row.scenario,
        thermalState,
        comparison: row.thermalComparisons?.[thermalState],
      }))
    ));
    lines.push(
      'Comparison cells are baseline / candidate / absolute delta / percent delta.',
      '',
      '| Scenario | State | Source runs | Events | Interaction median ms | Interaction p95 ms | Interaction worst ms | Recurring events >33 ms | Recurring events >50 ms |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|',
      ...thermalRows.map(({ scenario, thermalState, comparison }) => [
        scenario,
        thermalState,
        comparisonCell(comparison?.runCount),
        comparisonCell(comparison?.eventCount),
        comparisonCell(comparison?.interactionDuration?.medianMs),
        comparisonCell(comparison?.interactionDuration?.p95Ms),
        comparisonCell(comparison?.interactionDuration?.worstMs),
        comparisonCell(comparison?.recurringEvents?.eventsWithFrameOver33Ms),
        comparisonCell(comparison?.recurringEvents?.eventsWithFrameOver50Ms),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
      '',
      '| Scenario | State | Cadence | Frame median ms | Frame p95 ms | Frame worst ms | Frames >33 ms | Frames >50 ms |',
      '|---|---|---|---:|---:|---:|---:|---:|',
      ...thermalRows.flatMap(({ scenario, thermalState, comparison }) => (
        [['display', comparison?.displayCadence], ['render', comparison?.renderCadence]]
          .map(([stream, cadence]) => [
            scenario,
            thermalState,
            stream,
            comparisonCell(cadence?.medianMs),
            comparisonCell(cadence?.p95Ms),
            comparisonCell(cadence?.worstMs),
            comparisonCell(cadence?.framesOver33Ms),
            comparisonCell(cadence?.framesOver50Ms),
          ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
      )),
      '',
    );
    const resourceRows = aggregate.comparison.gates.flatMap((row) => (
      (row.resourceRows || []).filter(({ applicable }) => applicable).map((resource) => ({
        scenario: row.scenario,
        ...resource,
      }))
    ));
    resourceRows.unshift(...(aggregate.comparison.runResources?.rows || [])
      .filter(({ applicable }) => applicable)
      .map((resource) => ({ scenario: 'run', ...resource })));
    if (resourceRows.length) {
      lines.push(
        '| Scenario | Resource | Start baseline/candidate/absolute/% delta | End baseline/candidate/absolute/% delta | Maximum baseline/candidate/absolute/% delta | Gate |',
        '|---|---|---:|---:|---:|---|',
        ...resourceRows.map((row) => `| ${row.scenario} | ${row.metric} | ${comparisonCell(row.startComparison)} | ${comparisonCell(row.endComparison)} | ${comparisonCell(row.maximumComparison)} | ${row.ok ? 'pass' : 'fail'} |`),
        '',
      );
    }
    const resourceContexts = [
      { scenario: 'run', context: aggregate.comparison.runResources?.context },
      ...aggregate.comparison.gates.map((row) => ({
        scenario: row.scenario,
        context: row.resourceContext,
      })),
    ].filter(({ context }) => context?.applicable);
    if (resourceContexts.length) {
      lines.push(
        '| Scenario | Matched resource workload contexts | Gate |',
        '|---|---:|---|',
        ...resourceContexts.map(({ scenario, context }) => (
          `| ${scenario} | ${context.checkpoints.length} | ${context.ok ? 'pass' : 'fail'} |`
        )),
        '',
      );
    }
  }
  const matrixRuns = (aggregate.runs || []).filter((entry) => entry.matrix);
  if (matrixRuns.length) {
    lines.push(
      '| Matrix | Refresh Hz | Walk display avg / 1% low | Walk display p95 / worst ms | Walk display >33 / >50 | Walk render p95 / worst ms | Walk render >33 / >50 | 120 cap |',
      '|---|---:|---:|---:|---:|---:|---:|---|',
      ...matrixRuns.map((entry) => {
        const walk = entry.matrix.indoorWalk;
        const cap120 = entry.matrix.capLadder?.events?.find(
          ({ requestedCap }) => requestedCap === 120,
        );
        const skipped = entry.matrix.capLadder?.skipped?.find(({ cap }) => cap === 120);
        return `| ${entry.run.name} | ${entry.matrix.refreshHz} | ${walk.displayAverageFps ?? 'n/a'} / ${walk.displayOnePercentLowFps ?? 'n/a'} | ${walk.displayP95Ms ?? 'n/a'} / ${walk.displayWorstMs ?? 'n/a'} | ${walk.displayFramesOver33Ms ?? 'n/a'} / ${walk.displayFramesOver50Ms ?? 'n/a'} | ${walk.renderP95Ms ?? 'n/a'} / ${walk.renderWorstMs ?? 'n/a'} | ${walk.renderFramesOver33Ms ?? 'n/a'} / ${walk.renderFramesOver50Ms ?? 'n/a'} | ${cap120 ? 'measured' : `skipped: ${skipped?.reason || 'unproven'}`} |`;
      }),
      '',
      '| Matrix | Cap | Display >33 / >50 | Render >33 / >50 |',
      '|---|---:|---:|---:|',
      ...matrixRuns.flatMap((entry) => (entry.matrix.capLadder?.events || []).map((event) => (
        `| ${entry.run.name} | ${event.requestedCap} | ${event.displayFramesOver33Ms ?? 'n/a'} / ${event.displayFramesOver50Ms ?? 'n/a'} | ${event.renderFramesOver33Ms ?? 'n/a'} / ${event.renderFramesOver50Ms ?? 'n/a'} |`
      ))),
      '',
    );
  }
  const matrixComparison = aggregate.comparison?.matrixFrameTiming;
  if (matrixComparison?.rows?.length) {
    lines.push(
      '| Matrix | Route | Submit stream | p95 baseline/candidate/absolute/% delta ms | Worst baseline/candidate/absolute/% delta ms | Gate |',
      '|---|---|---|---:|---:|---|',
      ...matrixComparison.rows.map((row) => `| ${row.matrix} | ${row.route} | ${row.stream} | ${comparisonCell(comparisonMeasurement(row.before?.p95, row.after?.p95))} | ${comparisonCell(comparisonMeasurement(row.before?.worst, row.after?.worst))} | ${row.ok ? 'pass' : 'fail'} |`),
      '',
    );
  }
  if (matrixComparison?.cadenceFrameCounts?.rows?.length) {
    lines.push(
      '| Matrix | Route event | Cadence stream | Frames >33 baseline/candidate/absolute/% delta | Frames >50 baseline/candidate/absolute/% delta | Gate |',
      '|---|---|---|---:|---:|---|',
      ...matrixComparison.cadenceFrameCounts.rows.map((row) => `| ${row.matrix} | ${row.event} | ${row.stream} | ${comparisonCell(row.framesOver33Ms)} | ${comparisonCell(row.framesOver50Ms)} | ${row.ok ? 'pass' : 'fail'} |`),
      '',
    );
  }
  if (traceRows.length) {
    lines.push(
      'Diagnostic Chromium trace attribution (excluded from acceptance timings):',
      '',
      '| Run | Interaction | Scenario | Trace window ms | Longest main-thread task ms | Cause | Confidence | Strongest evidence |',
      '|---|---|---|---:|---:|---|---|---|',
      ...traceRows.map((row) => [
        row.runId,
        row.id,
        row.scenario,
        row.traceWindow?.durationMs,
        row.longestMainThreadTask?.durationMs,
        row.attribution?.cause,
        row.attribution?.confidence,
        [row.attribution?.evidence?.category, row.attribution?.evidence?.name]
          .filter(Boolean).join(' / ') || 'n/a',
      ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
      '',
    );
  }
  lines.push(
    'Trace and overlay/video legs are diagnostic only; none of their timings enter acceptance.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

export function goal24RequiredTraceInteractionIds(raw) {
  const startEvent = raw?.scenarios?.startGame?.events?.[0];
  required(startEvent?.id === 'start-game-1'
    && startEvent?.traceIdentity?.id === 'start-game-1'
    && startEvent?.traceIdentity?.scenario === 'startGame',
  'trace run lacks the exact start-game-1/startGame recorder trace identity.');
  return Object.values(raw?.scenarios || {})
    .flatMap((scenario) => scenario?.events || [])
    .map((event) => event?.id)
    .filter((id) => typeof id === 'string' && id.length > 0 && id !== 'cold-launch-1');
}

const COMPLETION_MANIFEST_NAME = 'completion-manifest.json';
const REFERENCE_VERIFICATION = Symbol('goal24-reference-publication-verification');

function validateArtifactDescriptor(artifact, sessionDir, label) {
  required(artifact && typeof artifact === 'object', `${label} integrity descriptor is missing.`);
  required(typeof artifact.path === 'string' && path.isAbsolute(artifact.path),
    `${label} path is missing or not absolute.`);
  required(artifact.algorithm === 'sha256', `${label} hash algorithm is missing or unsupported.`);
  required(/^[0-9a-f]{64}$/iu.test(artifact.sha256 || ''), `${label} SHA-256 is missing or invalid.`);
  required(Number.isInteger(artifact.bytes) && artifact.bytes >= 0, `${label} byte count is invalid.`);
  const canonical = assertRegularArtifactFile(artifact.path, sessionDir, label);
  const measured = sha256File(canonical);
  required(measured.bytes === artifact.bytes, `${label} byte count no longer matches.`);
  required(measured.sha256 === artifact.sha256, `${label} SHA-256 no longer matches.`);
  return canonical;
}

function validateRunArtifactSet(runs, sessionDir) {
  required(Array.isArray(runs) && runs.length > 0, 'Published aggregate has no per-run artifacts.');
  const requiredKinds = [
    'raw', 'runnerEnvelope', 'runnerStdout', 'runnerStderr', 'invocation', 'validated',
  ];
  for (const entry of runs) {
    const runId = entry.run?.id || '(unknown run)';
    required(entry.artifacts && typeof entry.artifacts === 'object',
      `${runId}: artifact-integrity set is missing.`);
    for (const kind of requiredKinds) {
      validateArtifactDescriptor(entry.artifacts[kind], sessionDir, `${runId} ${kind}`);
    }
    if (entry.run?.instrumentation === 'cdp-trace') {
      validateArtifactDescriptor(entry.artifacts.chromiumTrace, sessionDir, `${runId} chromiumTrace`);
      validateArtifactDescriptor(entry.artifacts.traceAttribution, sessionDir, `${runId} traceAttribution`);
    }
    if (entry.run?.instrumentation === 'video') {
      validateArtifactDescriptor(entry.artifacts.video, sessionDir, `${runId} video`);
      validateArtifactDescriptor(
        entry.artifacts.videoDecodeInput,
        sessionDir,
        `${runId} decoded-video input`,
      );
      validateArtifactDescriptor(
        entry.artifacts.videoValidation,
        sessionDir,
        `${runId} decoded-video validation`,
      );
      const overlayArtifacts = Object.entries(entry.artifacts)
        .filter(([kind]) => kind.startsWith('overlayFrame'));
      const decodedProofArtifacts = Object.entries(entry.artifacts)
        .filter(([kind]) => kind.startsWith('decodedProofFrame'));
      const decodedMarkerArtifacts = Object.entries(entry.artifacts)
        .filter(([kind]) => kind.startsWith('decodedMarkerCrop'));
      required(overlayArtifacts.length === OVERLAY_VIDEO_SCENARIOS.length,
        `${runId}: sealed overlay screenshot coverage is incomplete.`);
      required(decodedProofArtifacts.length === OVERLAY_VIDEO_SCENARIOS.length
        && decodedMarkerArtifacts.length === OVERLAY_VIDEO_SCENARIOS.length,
      `${runId}: sealed decoded proof-frame/marker-crop coverage is incomplete.`);
      for (const [kind, artifact] of overlayArtifacts) {
        validateArtifactDescriptor(artifact, sessionDir, `${runId} ${kind}`);
      }
      for (const [kind, artifact] of [...decodedProofArtifacts, ...decodedMarkerArtifacts]) {
        validateArtifactDescriptor(artifact, sessionDir, `${runId} ${kind}`);
      }
      const expectedKinds = [
        ...requiredKinds,
        'video', 'videoDecodeInput', 'videoValidation',
        ...OVERLAY_VIDEO_SCENARIOS.map((scenario, index) => (
          `overlayFrame${String(index + 1).padStart(2, '0')}-${safe(scenario)}`
        )),
        ...OVERLAY_VIDEO_SCENARIOS.map((scenario, index) => (
          `decodedProofFrame${String(index + 1).padStart(2, '0')}-${safe(scenario)}`
        )),
        ...OVERLAY_VIDEO_SCENARIOS.map((scenario, index) => (
          `decodedMarkerCrop${String(index + 1).padStart(2, '0')}-${safe(scenario)}`
        )),
      ].sort();
      required(isDeepStrictEqual(Object.keys(entry.artifacts).sort(), expectedKinds),
        `${runId}: sealed video artifact kinds are missing, extra, or relabelled.`);

      const raw = JSON.parse(fs.readFileSync(entry.artifacts.raw.path, 'utf8'));
      const validatedDocument = JSON.parse(fs.readFileSync(entry.artifacts.validated.path, 'utf8'));
      const decodeInput = JSON.parse(fs.readFileSync(entry.artifacts.videoDecodeInput.path, 'utf8'));
      const decoded = JSON.parse(fs.readFileSync(entry.artifacts.videoValidation.path, 'utf8'));
      required(canonicalFilesystemPath(validatedDocument.videoDecodeInputPath)
        === canonicalFilesystemPath(entry.artifacts.videoDecodeInput.path)
        && canonicalFilesystemPath(validatedDocument.videoValidationPath)
          === canonicalFilesystemPath(entry.artifacts.videoValidation.path),
      `${runId}: validated document is not path-bound to decoded-video input/output.`);
      const reconstructedFrames = validateOverlayFrameEvidence(raw, sessionDir, entry.run);
      required(isDeepStrictEqual(validatedDocument.overlayFrameEvidence, reconstructedFrames)
        && isDeepStrictEqual(entry.overlayFrameEvidence, reconstructedFrames),
      `${runId}: published closed-frame validation is not an exact raw reconstruction.`);
      const expectedDecodeMarkers = reconstructedFrames.map((frame) => ({
        payload: frame.payload,
        digest: frame.digest,
        markerRect: frame.markerRect,
        panelRect: frame.panelRect,
        excludedRects: frame.excludedRects,
        screenshot: frame.screenshot,
      }));
      required(canonicalFilesystemPath(decodeInput.file)
        === canonicalFilesystemPath(entry.artifacts.video.path)
        && decodeInput.expectedWidth === entry.run.width
        && decodeInput.expectedHeight === entry.run.height
        && isDeepStrictEqual(decodeInput.expectedMarkers, expectedDecodeMarkers),
      `${runId}: decoded-video input is not exactly bound to reconstructed raw visual evidence.`);
      const structural = validateVideoContainer(entry.artifacts.video.path, `${runId} sealed video`, {
        expectedWidth: decodeInput.expectedWidth,
        expectedHeight: decodeInput.expectedHeight,
        minimumDurationMs: decodeInput.minimumDurationMs,
        maximumInterFrameGapMs: decodeInput.maximumPresentedGapMs,
      });
      required(isDeepStrictEqual(validatedDocument.structuralVideoEvidence, structural)
        && isDeepStrictEqual(entry.structuralVideoEvidence, structural)
        && isDeepStrictEqual(validatedDocument.decodedVideoEvidence, decoded)
        && isDeepStrictEqual(entry.decodedVideoEvidence, decoded),
      `${runId}: stored structural/decoded video results drifted from the sealed artifacts.`);
      required(decoded.fileSha256 === entry.artifacts.video.sha256
        && decoded.width === entry.run.width && decoded.height === entry.run.height
        && decoded.reachedMediaEnd === true && decoded.decodeError == null
        && decoded.exactRouteOrderVerified === true
        && decoded.decodedGameSceneBoundToScreenshots === true
        && decoded.markerResults?.length === OVERLAY_VIDEO_SCENARIOS.length,
      `${runId}: sealed decoded-video result is incomplete or bound to another video.`);
      decoded.markerResults.forEach((result, index) => {
        const scenario = OVERLAY_VIDEO_SCENARIOS[index];
        const frame = reconstructedFrames[index];
        const proofKind = `decodedProofFrame${String(index + 1).padStart(2, '0')}-${safe(scenario)}`;
        const markerKind = `decodedMarkerCrop${String(index + 1).padStart(2, '0')}-${safe(scenario)}`;
        const overlayKind = `overlayFrame${String(index + 1).padStart(2, '0')}-${safe(scenario)}`;
        required(result.ordinal === index + 1 && result.scenario === scenario
          && result.interactionId === frame.interactionId && result.digest === frame.digest
          && canonicalFilesystemPath(result.proofFrame.path)
            === canonicalFilesystemPath(entry.artifacts[proofKind].path)
          && result.proofFrame.sha256 === entry.artifacts[proofKind].sha256
          && canonicalFilesystemPath(result.markerCrop.path)
            === canonicalFilesystemPath(entry.artifacts[markerKind].path)
          && result.markerCrop.sha256 === entry.artifacts[markerKind].sha256
          && canonicalFilesystemPath(result.pairedScreenshot)
            === canonicalFilesystemPath(entry.artifacts[overlayKind].path)
          && result.sceneComparison?.screenshotSha256 === entry.artifacts[overlayKind].sha256,
        `${runId}: decoded proof ${index + 1} is not cross-bound to its marker and screenshot artifacts.`);
      });
    }
    const pathBindings = {
      resultPath: 'raw',
      resultEnvelopePath: 'runnerEnvelope',
      stdoutPath: 'runnerStdout',
      stderrPath: 'runnerStderr',
      invocationPath: 'invocation',
      validatedPath: 'validated',
      ...(entry.run?.instrumentation === 'video' ? {
        videoDecodeInputPath: 'videoDecodeInput',
        videoValidationPath: 'videoValidation',
      } : {}),
    };
    for (const [field, kind] of Object.entries(pathBindings)) {
      required(canonicalFilesystemPath(entry[field])
        === canonicalFilesystemPath(entry.artifacts[kind].path),
      `${runId}: ${field} is not bound to its ${kind} integrity record.`);
    }
  }
  return artifactSetDigest(runs);
}

export function validateAcceptedAggregateRawBindings(aggregate) {
  if (aggregate?.completeProtocol !== true) return true;
  required(aggregate?.acceptance?.report && aggregate?.acceptance?.evaluation,
    'Complete aggregate lacks its locked report or evaluation.');
  const executed = (aggregate.runs || [])
    .filter((entry) => entry.run?.role === 'acceptance-cold'
      || entry.run?.role === 'acceptance-full')
    .map((entry) => {
      const rawPath = entry.artifacts?.raw?.path;
      required(typeof rawPath === 'string' && path.isAbsolute(rawPath),
        `${entry.run?.id || '(unknown run)'}: accepted aggregate raw artifact path is missing.`);
      let raw;
      try { raw = JSON.parse(fs.readFileSync(rawPath, 'utf8')); } catch (error) {
        throw new Error(`${entry.run?.id || '(unknown run)'}: accepted raw artifact is not valid JSON: ${error.message}`, {
          cause: error,
        });
      }
      return { run: entry.run, raw };
    });
  const rebuilt = aggregateLockedReport(executed);
  rebuilt.report.capturedAt = aggregate.acceptance.report.capturedAt;
  requireExact(aggregate.acceptance.report, rebuilt.report,
    'Complete locked report is not an exact aggregation of its raw-bound contributions.');
  requireExact(aggregate.acceptance.evaluation, rebuilt.evaluation,
    'Complete locked evaluation differs from the freshly rebuilt raw-bound report.');
  return true;
}

export function publishAggregate(sessionDir, aggregate, options = {}) {
  const absoluteSession = path.resolve(sessionDir);
  required(!fs.existsSync(path.join(absoluteSession, 'failure.json')),
    'Cannot publish a session that already has a failure marker.');
  const completionPath = path.join(absoluteSession, COMPLETION_MANIFEST_NAME);
  required(!fs.existsSync(completionPath), 'Session already has a completion manifest.');
  const publicationNonce = options.publicationNonce || randomUUID();
  required(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(publicationNonce), 'Publication nonce is invalid.');
  required(aggregate.executionOk === true, 'Only successfully executed sessions may be published.');
  required(aggregate.ok === aggregate.accepted,
    'Aggregate ok must mean accepted; execution success is reported separately.');
  if (aggregate.completeProtocol) {
    required(aggregate.state === (aggregate.accepted ? 'accepted' : 'rejected'),
      'Complete-protocol aggregate state is inconsistent with acceptance.');
  } else {
    required(aggregate.state === 'diagnostic-incomplete'
      && aggregate.accepted === false && aggregate.ok === false,
    'Incomplete protocol must remain diagnostic-incomplete and cannot be accepted.');
  }
  const artifactSet = validateRunArtifactSet(aggregate.runs, absoluteSession);
  validateAcceptedAggregateRawBindings(aggregate);
  const published = {
    ...aggregate,
    publication: {
      nonce: publicationNonce,
      completionManifest: COMPLETION_MANIFEST_NAME,
      artifactCount: artifactSet.count,
      runArtifactsSha256: artifactSet.sha256,
    },
  };
  const summaryPath = path.join(absoluteSession, 'aggregate.md');
  const aggregatePath = path.join(absoluteSession, 'aggregate.json');
  writeTextAtomic(summaryPath, runMarkdown(published));
  writeJson(aggregatePath, published);
  const aggregateIntegrity = artifactIntegrity(aggregatePath, absoluteSession, 'published aggregate');
  const summaryIntegrity = artifactIntegrity(summaryPath, absoluteSession, 'published aggregate summary');
  const finalArtifactSet = validateRunArtifactSet(published.runs, absoluteSession);
  required(finalArtifactSet.count === artifactSet.count
    && finalArtifactSet.sha256 === artifactSet.sha256,
  'Per-run artifacts changed while the aggregate was being published.');
  const completion = {
    schema: `${GOAL24_ORCHESTRATOR_SCHEMA}/completion/v1`,
    publicationState: 'sealed',
    measurementState: published.state,
    executionOk: published.executionOk === true,
    accepted: published.accepted === true,
    sessionId: published.sessionId,
    publicationNonce,
    sealedAt: new Date().toISOString(),
    aggregate: aggregateIntegrity,
    summary: summaryIntegrity,
    artifactCount: artifactSet.count,
    runArtifactsSha256: artifactSet.sha256,
  };
  // This is the sole completion marker and intentionally the final filesystem
  // mutation on the successful publication path.
  writeJson(completionPath, completion);
  return { aggregate: published, completion, completionPath };
}

export function loadCompletedReference(referenceFile) {
  const referencePath = path.resolve(referenceFile);
  required(path.basename(referencePath) === 'aggregate.json',
    'Reference must name the published aggregate.json artifact.');
  const sessionDir = path.dirname(referencePath);
  required(!fs.existsSync(path.join(sessionDir, 'failure.json')),
    'Reference session has a failure marker.');
  assertRegularArtifactFile(referencePath, sessionDir, 'reference aggregate');
  const completionPath = path.join(sessionDir, COMPLETION_MANIFEST_NAME);
  assertRegularArtifactFile(completionPath, sessionDir, 'reference completion manifest');
  const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
  const completion = JSON.parse(fs.readFileSync(completionPath, 'utf8'));
  required(completion.schema === `${GOAL24_ORCHESTRATOR_SCHEMA}/completion/v1`
    && completion.publicationState === 'sealed',
  'Reference completion manifest has an unknown schema or state.');
  required(completion.sessionId === reference.sessionId,
    'Reference completion manifest session ID does not match the aggregate.');
  required(completion.measurementState === reference.state
    && completion.executionOk === reference.executionOk
    && completion.accepted === reference.accepted,
  'Reference completion manifest outcome does not match the aggregate.');
  required(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(reference.publication?.nonce || '')
    && completion.publicationNonce === reference.publication.nonce,
  'Reference completion nonce does not match the aggregate.');
  required(reference.publication?.completionManifest === COMPLETION_MANIFEST_NAME,
    'Reference aggregate names an unexpected completion manifest.');
  required(canonicalFilesystemPath(completion.aggregate?.path) === canonicalFilesystemPath(referencePath),
    'Reference completion manifest points at a different aggregate.');
  required(canonicalFilesystemPath(completion.summary?.path)
    === canonicalFilesystemPath(path.join(sessionDir, 'aggregate.md')),
  'Reference completion manifest points at a different summary.');
  validateArtifactDescriptor(completion.aggregate, sessionDir, 'reference aggregate');
  validateArtifactDescriptor(completion.summary, sessionDir, 'reference aggregate summary');
  const artifactSet = validateRunArtifactSet(reference.runs, sessionDir);
  required(completion.artifactCount === artifactSet.count
    && reference.publication.artifactCount === artifactSet.count,
  'Reference per-run artifact count does not match its sealed publication.');
  required(completion.runArtifactsSha256 === artifactSet.sha256
    && reference.publication.runArtifactsSha256 === artifactSet.sha256,
  'Reference per-run artifact-set hash does not match its sealed publication.');
  validateAcceptedAggregateRawBindings(reference);
  Object.defineProperty(reference, REFERENCE_VERIFICATION, {
    value: { referencePath, completionPath },
    enumerable: false,
  });
  return reference;
}

function sanitizedChildEnv(base, additions) {
  const env = { ...base };
  for (const key of [
    'VIDEO_DIR', 'QA_CHROMIUM_TRACE_PATH', 'QA_INSTRUMENTATION_MODE',
    'QA_ELECTRON_USER_DATA_DIR', 'QA_REUSABLE_PROFILE', 'QA_RESULT_PATH',
    'QA_CHROMIUM_TRACE_CATEGORIES', 'QA_CLUBHOUSE',
    'QA_FORCE_DEVICE_SCALE_FACTOR',
    'GOAL24_PERF_OVERLAY', 'GOAL24_PERF_SETTLE_MS', 'GOAL24_PERF_CALIBRATION_MS',
    'GOAL24_PERF_DISABLE_STALL_CONTROL', 'GOAL24_PERF_MATRIX_RAW_WINDOW',
    'GOAL24_PERF_GPU_FRAME_TIMING', 'GOAL24_PERF_TOOL_MANIFEST',
    'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE',
  ]) delete env[key];
  return { ...env, ...additions };
}

export function executeRun(run, context = {}) {
  const spawn = context.spawn || spawnSync;
  const root = context.root || ROOT;
  const sessionDir = context.sessionDir;
  required(sessionDir, 'executeRun requires sessionDir.');
  const legDir = path.join(sessionDir, 'legs', `${String(run.ordinal).padStart(2, '0')}-${safe(run.name)}`);
  fs.mkdirSync(legDir, { recursive: true });
  const resultEnvelopePath = path.join(legDir, 'runner-result.json');
  const stdoutPath = path.join(legDir, 'runner-stdout.txt');
  const stderrPath = path.join(legDir, 'runner-stderr.txt');
  const rawDriverRoot = path.join(sessionDir, 'raw-driver');
  const tracePath = path.join(legDir, 'chromium-trace.json');
  const traceAttributionPath = path.join(legDir, 'trace-attribution.json');
  const videoDir = path.join(legDir, 'video');
  const videoDecodeInputPath = path.join(legDir, 'video-decode-input.json');
  const videoValidationPath = path.join(legDir, 'video-validation.json');
  const decodedVideoProofDirectory = path.join(legDir, 'decoded-video-proofs');
  const additions = {
    ...run.env,
    GOAL24_PERF_OUT: rawDriverRoot,
    QA_RESULT_PATH: resultEnvelopePath,
    ...(run.instrumentation === 'cdp-trace' ? { QA_CHROMIUM_TRACE_PATH: tracePath } : {}),
    ...(run.instrumentation === 'video' ? { VIDEO_DIR: videoDir } : {}),
  };
  const startedAt = new Date().toISOString();
  const startedNs = process.hrtime.bigint();
  const child = spawn(
    process.execPath,
    [context.runner || RUNNER, context.driver || DRIVER, '--clubhouse=pine-hills-v2'],
    {
      cwd: root,
      env: sanitizedChildEnv(context.env || process.env, additions),
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: Number(context.timeoutMs || process.env.GOAL24_PERF_CHILD_TIMEOUT_MS || 45 * 60_000),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const elapsedMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
  writeTextAtomic(stdoutPath, String(child.stdout || ''));
  writeTextAtomic(stderrPath, String(child.stderr || ''));
  const invocationPath = path.join(legDir, 'invocation.json');
  writeJson(invocationPath, {
    run,
    command: process.execPath,
    args: [context.runner || RUNNER, context.driver || DRIVER, '--clubhouse=pine-hills-v2'],
    cwd: root,
    startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: +elapsedMs.toFixed(3),
    status: child.status,
    signal: child.signal,
    error: child.error ? String(child.error.message || child.error) : null,
  });
  if (child.error) throw new Error(`${run.id}: Electron child failed to launch: ${child.error.message}`);
  if (child.signal) throw new Error(`${run.id}: Electron child terminated by ${child.signal}.`);
  if (child.status !== 0) throw new Error(`${run.id}: Electron child exited ${child.status}. See ${legDir}.`);
  const stdoutEnvelope = parseFinalJson(child.stdout);
  assertRegularArtifactFile(resultEnvelopePath, sessionDir, `${run.id} runner result JSON`);
  const fileEnvelope = JSON.parse(fs.readFileSync(resultEnvelopePath, 'utf8'));
  required(JSON.stringify(fileEnvelope) === JSON.stringify(stdoutEnvelope),
    `${run.id}: runner stdout and QA_RESULT_PATH envelopes differ.`);
  const { profilePath, launchId, electronMainProcessIdentity } = validateRunnerEnvelope(
    fileEnvelope,
    run,
    context,
  );
  required(!fs.existsSync(profilePath), `${run.id}: generated profile still exists after runner exit.`);
  const resultPath = resolveResultPath(fileEnvelope.result.resultPath, root);
  const expectedResultPath = path.join(rawDriverRoot, run.id, 'raw.json');
  required(canonicalFilesystemPath(resultPath) === canonicalFilesystemPath(expectedResultPath),
    `${run.id}: resultPath escaped or did not match its current-session output directory.`);
  assertRegularArtifactFile(resultPath, sessionDir, `${run.id} raw result JSON`);
  const raw = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  validateRawRun(raw, fileEnvelope, run);
  if (run.role === 'acceptance-cold') {
    validateColdRunProtocol(raw, run);
    bindColdContributionToRunner(raw, fileEnvelope, run);
  }
  if (run.role === 'acceptance-full') {
    validateFullRunProtocol(raw, run, context.suite || (run.env.GOAL24_PERF_WALK_MS === '5000' ? 'smoke' : 'full'));
    if ((context.suite || 'full') === 'full') bindFullContributionToRunner(raw, fileEnvelope, run);
  }
  if (run.leg === 'trace' || run.leg === 'overlay') validateDiagnosticInteractionRun(raw, run);
  const matrix = run.leg === 'matrix' ? validateMatrixRun(raw, fileEnvelope, run) : null;
  let traceAttribution = null;
  if (run.instrumentation === 'cdp-trace') {
    const actualTrace = fileEnvelope.runner.instrumentation.chromiumTrace?.path;
    required(canonicalFilesystemPath(actualTrace) === canonicalFilesystemPath(tracePath),
      `${run.id}: runner trace path differs from the current leg.`);
    assertRegularArtifactFile(tracePath, legDir, `${run.id} trace artifact`);
    required(fs.statSync(tracePath).size > 0, `${run.id}: trace artifact is empty on disk.`);
    let traceDocument;
    try { traceDocument = JSON.parse(fs.readFileSync(tracePath, 'utf8')); } catch (error) {
      throw new Error(`${run.id}: trace artifact is not valid JSON: ${error.message}`, { cause: error });
    }
    const traceEvents = Array.isArray(traceDocument)
      ? traceDocument : traceDocument?.traceEvents;
    required(Array.isArray(traceEvents) && traceEvents.length > 0,
      `${run.id}: trace artifact has no trace events.`);
    required(traceEvents.some((event) => /renderer|devtools\.timeline|blink|v8|gpu/iu.test(
      `${event?.cat || ''} ${event?.name || ''}`,
    )), `${run.id}: trace has no expected renderer/timeline/V8/GPU categories.`);
    const requiredInteractionIds = goal24RequiredTraceInteractionIds(raw);
    traceAttribution = analyzeGoal24ChromiumTrace(traceDocument, {
      interactionIds: requiredInteractionIds,
    });
    const traceValidation = validateGoal24TraceAttribution(traceAttribution, {
      requiredInteractionIds,
    });
    required(traceValidation.ok,
      `${run.id}: trace attribution failed: ${traceValidation.failures.join('; ')}`);
    required(traceAttribution.interactions.every((entry) => (
      entry.ok === true
      && entry.longestMainThreadTask != null
      && typeof entry.attribution?.cause === 'string'
      && entry.attribution.cause.length > 0
      && entry.attribution?.evidence != null
    )), `${run.id}: every traced interaction requires its longest task and strongest available cause evidence.`);
    writeJson(traceAttributionPath, traceAttribution);
  }
  let videoPath = null;
  let overlayFrameEvidence = null;
  let structuralVideoEvidence = null;
  let decodedVideoEvidence = null;
  if (run.instrumentation === 'video') {
    const actualVideo = fileEnvelope.runner.instrumentation.video?.path;
    required(typeof actualVideo === 'string', `${run.id}: video artifact path is missing.`);
    assertRegularArtifactFile(actualVideo, videoDir, `${run.id} video artifact`);
    videoPath = actualVideo;
    overlayFrameEvidence = validateOverlayFrameEvidence(raw, sessionDir, run);
    const firstFrame = raw.evidence.overlayFrames[0];
    const lastFrame = raw.evidence.overlayFrames.at(-1);
    const minimumDurationMs = Math.max(5_000, lastFrame.hiddenAtMs - firstFrame.shownAtMs);
    const rawDisplayWorstMs = Math.max(...overlayFrameEvidence.map((frame) => (
      Number(frame.payload.metrics.displayRaf.worstMs) || 0
    )));
    const maximumPresentedGapMs = Math.max(2_000, rawDisplayWorstMs + 1_000);
    structuralVideoEvidence = validateVideoContainer(actualVideo, `${run.id} video artifact`, {
      expectedWidth: run.width,
      expectedHeight: run.height,
      minimumDurationMs,
      maximumInterFrameGapMs: maximumPresentedGapMs,
    });
    const decodeInput = {
      file: actualVideo,
      expectedMarkers: overlayFrameEvidence.map((frame) => ({
        payload: frame.payload,
        digest: frame.digest,
        markerRect: frame.markerRect,
        panelRect: frame.panelRect,
        excludedRects: frame.excludedRects,
        screenshot: frame.screenshot,
      })),
      outputDirectory: decodedVideoProofDirectory,
      expectedWidth: run.width,
      expectedHeight: run.height,
      minimumDurationMs,
      maximumPresentedGapMs,
    };
    writeJson(videoDecodeInputPath, decodeInput);
    const decodeSpawn = context.decodeSpawn || spawnSync;
    const decodeChild = decodeSpawn(
      process.execPath,
      [context.videoDecodeValidator || VIDEO_DECODE_VALIDATOR,
        videoDecodeInputPath, videoValidationPath],
      {
        cwd: root,
        env: sanitizedChildEnv(context.env || process.env, {}),
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: Number(context.videoDecodeTimeoutMs || 10 * 60_000),
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (decodeChild.error) throw decodeChild.error;
    if (decodeChild.signal) {
      throw new Error(`${run.id}: decoded-video validator terminated by ${decodeChild.signal}.`);
    }
    if (decodeChild.status !== 0) {
      throw new Error(`${run.id}: decoded-video validator exited ${decodeChild.status}: `
        + `${String(decodeChild.stderr || '').slice(0, 4000)}`);
    }
    assertRegularArtifactFile(videoValidationPath, legDir, `${run.id} decoded-video validation`);
    decodedVideoEvidence = JSON.parse(fs.readFileSync(videoValidationPath, 'utf8'));
    const videoIntegrity = sha256File(videoPath);
    required(decodedVideoEvidence?.schema === 'golf-flipper/goal24-decoded-video-evidence/v1'
      && decodedVideoEvidence.fileSha256 === videoIntegrity.sha256
      && decodedVideoEvidence.width === run.width
      && decodedVideoEvidence.height === run.height
      && decodedVideoEvidence.reachedMediaEnd === true
      && decodedVideoEvidence.decodeError == null
      && decodedVideoEvidence.exactRouteOrderVerified === true
      && decodedVideoEvidence.decodedGameSceneBoundToScreenshots === true
      && decodedVideoEvidence.markerResults?.length === OVERLAY_VIDEO_SCENARIOS.length,
    `${run.id}: decoded video did not prove the exact completed gameplay route.`);
    decodedVideoEvidence.markerResults.forEach((result, index) => {
      const expected = overlayFrameEvidence[index];
      required(result.ordinal === index + 1
        && result.scenario === expected.scenario
        && result.interactionId === expected.interactionId
        && result.digest === expected.digest
        && result.consecutiveMatchedFrames >= 3
        && result.matchedCells >= 396,
      `${run.id}: decoded marker ${index + 1} is not bound to its raw interaction in route order.`);
      assertRegularArtifactFile(result.proofFrame?.path, decodedVideoProofDirectory,
        `${run.id} decoded proof frame ${index + 1}`);
      assertRegularArtifactFile(result.markerCrop?.path, decodedVideoProofDirectory,
        `${run.id} decoded marker crop ${index + 1}`);
      required(sha256File(result.proofFrame.path).sha256 === result.proofFrame.sha256
        && sha256File(result.markerCrop.path).sha256 === result.markerCrop.sha256
        && result.sceneComparison?.screenshotSha256
          === sha256File(expected.screenshot).sha256,
      `${run.id}: decoded proof ${index + 1} hashes drifted before sealing.`);
    });
  }
  const validatedPath = path.join(legDir, 'validated.json');
  writeJson(validatedPath, {
    ok: true,
    runId: run.id,
    resultPath: slash(resultPath),
    profilePath: slash(profilePath),
    profileId: fileEnvelope.runner?.profile?.profileId ?? null,
    launchId,
    electronMainProcessIdentity,
    matrix,
    traceAttribution,
    overlayFrameEvidence,
    structuralVideoEvidence,
    decodedVideoEvidence,
    videoDecodeInputPath: videoPath ? slash(videoDecodeInputPath) : null,
    videoValidationPath: videoPath ? slash(videoValidationPath) : null,
  });
  const artifacts = {
    raw: artifactIntegrity(resultPath, sessionDir, `${run.id} sealed raw result`),
    runnerEnvelope: artifactIntegrity(resultEnvelopePath, sessionDir, `${run.id} sealed runner envelope`),
    runnerStdout: artifactIntegrity(stdoutPath, sessionDir, `${run.id} sealed runner stdout`),
    runnerStderr: artifactIntegrity(stderrPath, sessionDir, `${run.id} sealed runner stderr`),
    invocation: artifactIntegrity(invocationPath, sessionDir, `${run.id} sealed invocation`),
    validated: artifactIntegrity(validatedPath, sessionDir, `${run.id} sealed validation`),
    ...(run.instrumentation === 'cdp-trace'
      ? {
        chromiumTrace: artifactIntegrity(tracePath, sessionDir, `${run.id} sealed Chromium trace`),
        traceAttribution: artifactIntegrity(
          traceAttributionPath,
          sessionDir,
          `${run.id} sealed trace attribution`,
        ),
      }
      : {}),
    ...(videoPath
      ? {
        video: artifactIntegrity(videoPath, sessionDir, `${run.id} sealed video`),
        videoDecodeInput: artifactIntegrity(
          videoDecodeInputPath,
          sessionDir,
          `${run.id} sealed decoded-video input`,
        ),
        videoValidation: artifactIntegrity(
          videoValidationPath,
          sessionDir,
          `${run.id} sealed decoded-video validation`,
        ),
      }
      : {}),
    ...Object.fromEntries((overlayFrameEvidence || []).map((frame, index) => [
      `overlayFrame${String(index + 1).padStart(2, '0')}-${safe(frame.scenario)}`,
      artifactIntegrity(
        frame.screenshot,
        sessionDir,
        `${run.id} sealed ${frame.scenario} overlay frame`,
      ),
    ])),
    ...Object.fromEntries((decodedVideoEvidence?.markerResults || []).flatMap((entry, index) => [
      [
        `decodedProofFrame${String(index + 1).padStart(2, '0')}-${safe(entry.scenario)}`,
        artifactIntegrity(
          entry.proofFrame.path,
          sessionDir,
          `${run.id} sealed decoded proof frame ${index + 1}`,
        ),
      ],
      [
        `decodedMarkerCrop${String(index + 1).padStart(2, '0')}-${safe(entry.scenario)}`,
        artifactIntegrity(
          entry.markerCrop.path,
          sessionDir,
          `${run.id} sealed decoded marker crop ${index + 1}`,
        ),
      ],
    ])),
  };
  return {
    ok: true,
    run,
    raw,
    envelope: fileEnvelope,
    resultPath,
    resultEnvelopePath,
    stdoutPath,
    stderrPath,
    invocationPath,
    validatedPath,
    videoDecodeInputPath: videoPath ? videoDecodeInputPath : null,
    videoValidationPath: videoPath ? videoValidationPath : null,
    legDir,
    elapsedMs: +elapsedMs.toFixed(3),
    profilePath,
    processId: fileEnvelope.runner?.launch?.electronPid ?? null,
    launchId,
    electronMainProcessIdentity,
    runtimeVersions: clone(runnerRuntimeVersions(fileEnvelope)),
    profileId: fileEnvelope.runner?.profile?.profileId ?? null,
    electronLaunchRequestedAtEpochMs:
      fileEnvelope.runner?.timing?.anchors?.electronLaunchRequested?.epochMs ?? null,
    matrix,
    traceAttribution,
    overlayFrameEvidence,
    structuralVideoEvidence,
    decodedVideoEvidence,
    artifacts,
  };
}

export function runOrchestrator(options = {}, dependencies = {}) {
  const plan = buildRunPlan(options);
  const outRoot = path.resolve(options.out || DEFAULT_OUT);
  const sessionDir = path.join(outRoot, plan.sessionId);
  fs.mkdirSync(outRoot, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: false });
  const manifest = {
    schema: GOAL24_ORCHESTRATOR_SCHEMA,
    state: options.dryRun ? 'dry-run' : 'running',
    sessionId: plan.sessionId,
    suite: plan.suite,
    phase: plan.phase,
    createdAt: new Date().toISOString(),
    machine: machineMetadata(),
    repository: repositoryMetadata(),
    pinned: plan.pinned,
    plan: { ...plan, runs: plan.runs.map(({ env, ...run }) => ({ ...run, environmentKeys: Object.keys(env).sort() })) },
  };
  const sessionDescriptorPath = path.join(sessionDir, 'manifest.json');
  writeJson(sessionDescriptorPath, manifest);
  if (options.dryRun) return { sessionDir, plan, manifest };

  const executed = [];
  const profilePaths = new Set();
  try {
    for (const run of plan.runs) {
      // Deliberately no Promise or parallel queue: a run must finish and prove
      // profile/lock cleanup before the next Electron process is spawned.
      const repositoryBeforeRun = repositoryMetadata();
      required(repositoryBeforeRun.head === manifest.repository.head
        && repositoryBeforeRun.branch === manifest.repository.branch
        && repositoryBeforeRun.workingTreeFingerprintSha256
          === manifest.repository.workingTreeFingerprintSha256,
      `${run.id}: repository changed before this measurement process.`);
      const execution = executeRun(run, {
        ...dependencies,
        sessionDir,
        profilePaths,
        suite: plan.suite,
      });
      const repositoryAfterRun = repositoryMetadata();
      required(repositoryAfterRun.head === repositoryBeforeRun.head
        && repositoryAfterRun.branch === repositoryBeforeRun.branch
        && repositoryAfterRun.workingTreeFingerprintSha256
          === repositoryBeforeRun.workingTreeFingerprintSha256,
      `${run.id}: repository changed during this measurement process.`);
      execution.repositoryBeforeRun = repositoryBeforeRun;
      execution.repositoryAfterRun = repositoryAfterRun;
      executed.push(execution);
    }
    const repositoryAfterRuns = repositoryMetadata();
    required(repositoryAfterRuns.head === manifest.repository.head
      && repositoryAfterRuns.branch === manifest.repository.branch
      && repositoryAfterRuns.workingTreeFingerprintSha256
        === manifest.repository.workingTreeFingerprintSha256,
    'Repository contents changed during the measurement session.');
    let acceptance = {
      status: 'not-evaluated-incomplete-protocol',
      reason: 'Acceptance requires the unfiltered full cold/full/matrix/trace/overlay protocol.',
      report: null,
      evaluation: null,
    };
    if (plan.completeProtocol) {
      const locked = aggregateLockedReport(executed, {
        evaluator: evaluateLockedInteractionPerformanceReport,
      });
      acceptance = {
        status: locked.evaluation.ok ? 'pass' : 'fail',
        report: locked.report,
        evaluation: locked.evaluation,
        aggregation: locked.aggregation,
      };
    }
    let comparison = null;
    if (plan.phase === 'comparison') {
      required(acceptance.evaluation, 'Comparison requires an acceptance-eligible full run.');
      const referencePath = path.resolve(options.reference);
      const reference = loadCompletedReference(referencePath);
      comparison = compareAcceptance(
        reference,
        acceptance.evaluation,
        plan.pinned,
        manifest.machine,
        acceptance.report,
        executed,
      );
    }
    const accepted = plan.completeProtocol
      && acceptance.evaluation?.ok === true
      && (plan.phase !== 'comparison' || comparison?.ok === true);
    const aggregate = {
      schema: GOAL24_ORCHESTRATOR_SCHEMA,
      state: plan.completeProtocol ? (accepted ? 'accepted' : 'rejected') : 'diagnostic-incomplete',
      executionOk: true,
      accepted,
      sessionId: plan.sessionId,
      suite: plan.suite,
      phase: plan.phase,
      completedAt: new Date().toISOString(),
      completeProtocol: plan.completeProtocol,
      machine: manifest.machine,
      repository: manifest.repository,
      repositoryAfterRuns,
      pinned: plan.pinned,
      instrumentationIsolation: {
        acceptance: 'low-overhead-only',
        trace: 'separate-process-diagnostic-not-graded',
        overlayVideo: 'separate-process-diagnostic-not-graded',
      },
      runs: executed.map((entry) => ({
        ok: entry.ok,
        run: entry.run,
        resultPath: slash(entry.resultPath),
        resultEnvelopePath: slash(entry.resultEnvelopePath),
        stdoutPath: slash(entry.stdoutPath),
        stderrPath: slash(entry.stderrPath),
        invocationPath: slash(entry.invocationPath),
        validatedPath: slash(entry.validatedPath),
        videoDecodeInputPath: entry.videoDecodeInputPath
          ? slash(entry.videoDecodeInputPath) : null,
        videoValidationPath: entry.videoValidationPath
          ? slash(entry.videoValidationPath) : null,
        legDir: slash(entry.legDir),
        elapsedMs: entry.elapsedMs,
        profilePath: slash(entry.profilePath),
        processId: entry.processId,
        launchId: entry.launchId,
        electronMainProcessIdentity: entry.electronMainProcessIdentity,
        profileId: entry.profileId,
        electronLaunchRequestedAtEpochMs: entry.electronLaunchRequestedAtEpochMs,
        runtimeVersions: entry.runtimeVersions,
        repositoryBeforeRun: entry.repositoryBeforeRun,
        repositoryAfterRun: entry.repositoryAfterRun,
        matrix: entry.matrix,
        traceAttribution: entry.traceAttribution,
        overlayFrameEvidence: entry.overlayFrameEvidence,
        structuralVideoEvidence: entry.structuralVideoEvidence,
        decodedVideoEvidence: entry.decodedVideoEvidence,
        artifacts: entry.artifacts,
      })),
      acceptance,
      comparison,
      ok: accepted,
    };
    manifest.state = 'awaiting-completion-marker';
    manifest.authoritativeCompletionManifest = COMPLETION_MANIFEST_NAME;
    manifest.measurementState = aggregate.state;
    manifest.executionOk = aggregate.executionOk;
    manifest.accepted = aggregate.accepted;
    manifest.completedAt = aggregate.completedAt;
    writeJson(sessionDescriptorPath, manifest);
    const publication = publishAggregate(sessionDir, aggregate);
    return { sessionDir, plan, aggregate: publication.aggregate, completion: publication.completion };
  } catch (error) {
    const failure = {
      schema: GOAL24_ORCHESTRATOR_SCHEMA,
      state: 'failed-closed',
      sessionId: plan.sessionId,
      failedAt: new Date().toISOString(),
      message: String(error?.message || error),
      stack: error?.stack || null,
      completedRuns: executed.map(({ run, resultPath, legDir }) => ({
        id: run.id,
        resultPath: slash(resultPath),
        legDir: slash(legDir),
      })),
    };
    writeJson(path.join(sessionDir, 'failure.json'), failure);
    manifest.state = 'failed-closed';
    manifest.failurePath = slash(path.join(sessionDir, 'failure.json'));
    manifest.failedAt = failure.failedAt;
    writeJson(sessionDescriptorPath, manifest);
    throw error;
  }
}

function help() {
  return [
    'Goal 24 interaction-performance orchestrator',
    '',
    '  --suite=full|smoke           Full protocol (default) or short non-grading smoke',
    '  --phase=baseline|comparison  Comparison requires --reference',
    '  --reference=PATH             Baseline aggregate.json',
    '  --legs=cold,full,matrix,trace,overlay',
    '  --cold-runs=N                Defaults to 7 full / 1 smoke',
    '  --matrix=1080p-windowed,1440p-windowed,4k-windowed,4k-fullscreen',
    '  --out=PATH                   Artifact parent',
    '  --session-id=ID              Stable caller-provided session ID',
    '  --dry-run                    Write and print the process plan only',
    '',
    'Equivalent GOAL24_PERF_* environment filters are supported.',
  ].join('\n');
}

async function main() {
  const options = parseCli();
  if (options.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  const result = runOrchestrator(options);
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ ok: true, dryRun: true, sessionDir: slash(result.sessionDir), plan: result.plan }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({
    ok: result.aggregate.ok,
    executionOk: result.aggregate.executionOk,
    accepted: result.aggregate.accepted,
    state: result.aggregate.state,
    sessionDir: slash(result.sessionDir),
    aggregatePath: slash(path.join(result.sessionDir, 'aggregate.json')),
    summaryPath: slash(path.join(result.sessionDir, 'aggregate.md')),
    completionManifestPath: slash(path.join(result.sessionDir, COMPLETION_MANIFEST_NAME)),
    acceptance: result.aggregate.acceptance.status,
  }, null, 2)}\n`);
  if (!result.aggregate.executionOk
      || (result.aggregate.completeProtocol && !result.aggregate.accepted)) process.exitCode = 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
