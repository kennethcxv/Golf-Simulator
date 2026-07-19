import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
  CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION,
  captureCashierBuildSnapshot,
  compareCashierBuildSnapshots,
} from './cashier-build-snapshot.mjs';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
const DEFAULT_VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const REQUIRED_VIEWPORTS = Object.freeze(['1280x720', '1600x900', '1920x1080']);
let VIEWPORT = { ...DEFAULT_VIEWPORT };
const ITEMS = Object.freeze(['tees1', 'marker1', 'glove1']);
let OUT = path.resolve('qa/cash-register-production/simplified-rebuild/performance');
const DEFAULT_BASELINE = path.resolve(
  'qa/cashier_master_final/performance/final/simplified-register-performance.json',
);
export const PERFORMANCE_SCHEMA_VERSION = 4;
export const RENDER_CAPTURE_FRAME_COUNT = 24;
export const HEAP_TRANSIENT_EXCESS_BUDGET_MIB = 16;
// The control is sampled once per rAF. A matched prefix may therefore end one
// scheduling interval before the action boundary; 100 ms is a deliberately
// small, fail-closed allowance for that final sample gap. Explicit action
// start/stop samples normally make the action-side gap effectively zero.
export const HEAP_TRACE_COVERAGE_TOLERANCE_MS = 100;
export const REQUIRED_DYNAMIC_PHASES = Object.freeze([
  'overviewProducts',
  'oneClickBagging',
  'cardHandoff',
  'cardInsertion',
  'cardProcessing',
  'cardResult',
  'cashPresentation',
  'cashDrawerOpening',
  'cashDeposit',
  'changeSelection',
  'receiptPrinting',
  'bagHandoff',
  'customerCleanup',
  'cardApprovedResult',
  'cardApprovedCleanup',
]);
export const REQUIRED_DYNAMIC_WINDOWS = Object.freeze([
  'scanAndCardHandoff',
  'cardAuthorization',
  'cashAcceptance',
  'cashFulfillment',
  'cardApproved',
  'cardApprovedRepeat',
]);
export const REQUIRED_PERFORMANCE_GATE_KEYS = Object.freeze([
  'cameraMatch',
  'activeMonitorAverageFps',
  'activeMonitorOnePercentLow',
  'everyWorkspaceAverageFps',
  'everyWorkspaceWorstFrame',
  'reentryHeap',
  'reentryListeners',
  'reentryDom',
  'reentryLiveResources',
  'reentryRendererMemory',
  'staticUiFrequency',
  'runtimeErrors',
  'requestFailures',
  'dynamic_dynamicPhaseCoverage',
  'dynamic_dynamicFrameCoverage',
  'dynamic_dynamicAverageFps',
  'dynamic_dynamicP99Frame',
  'dynamic_dynamicWorstFrame',
  'dynamic_dynamicHeapHighWater',
  'dynamic_transactionPostGcHeap',
  'dynamic_transactionResetState',
  'dynamic_transactionListeners',
  'dynamic_transactionDom',
  'dynamic_transactionSceneNodes',
  'dynamic_transactionLiveResources',
  'dynamic_transactionRepeatRendererResidency',
  'dynamic_transactionRendererResidency',
  'dynamic_storedBaseline',
  'productionBuildUnchanged',
  'schemaContract',
]);
const PROFILE_DEFAULTS = Object.freeze({
  master: Object.freeze({
    sampleCount: 3,
    sampleMs: 2500,
    warmupMs: 1500,
    gcSettleMs: 600,
    reentryCycles: 20,
    dynamicTailMs: 120,
    heapControlMs: 24000,
  }),
  smoke: Object.freeze({
    sampleCount: 1,
    sampleMs: 700,
    warmupMs: 250,
    gcSettleMs: 150,
    reentryCycles: 2,
    dynamicTailMs: 60,
    heapControlMs: 16000,
  }),
});
let RUN_CONFIG = { profile: 'master', ...PROFILE_DEFAULTS.master, baselinePath: DEFAULT_BASELINE };

function integerOption(value, fallback, label, minimum = 0) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}; got ${value}.`);
  }
  return parsed;
}

function booleanOption(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(?:1|true|yes|on)$/i.test(String(value).trim());
}

export function resolvePerformanceConfig(options = {}, env = process.env) {
  const profile = String(options.profile || env.REGISTER_PERF_PROFILE || 'master').trim().toLowerCase();
  if (!PROFILE_DEFAULTS[profile]) {
    throw new Error(`Unknown performance profile "${profile}". Use master or smoke.`);
  }
  const defaults = PROFILE_DEFAULTS[profile];
  const baselineRaw = options.baselinePath ?? env.REGISTER_PERF_BASELINE ?? DEFAULT_BASELINE;
  const baselineText = String(baselineRaw ?? '').trim();
  const baselinePath = !baselineText || /^(none|off|false)$/i.test(baselineText)
    ? null
    : path.resolve(baselineText);
  return {
    profile,
    sampleCount: integerOption(
      options.sampleCount ?? env.REGISTER_PERF_SAMPLE_COUNT,
      defaults.sampleCount,
      'sampleCount',
      1,
    ),
    sampleMs: integerOption(
      options.sampleMs ?? env.REGISTER_PERF_SAMPLE_MS,
      defaults.sampleMs,
      'sampleMs',
      250,
    ),
    warmupMs: integerOption(
      options.warmupMs ?? env.REGISTER_PERF_WARMUP_MS,
      defaults.warmupMs,
      'warmupMs',
      0,
    ),
    gcSettleMs: integerOption(
      options.gcSettleMs ?? env.REGISTER_PERF_GC_SETTLE_MS,
      defaults.gcSettleMs,
      'gcSettleMs',
      1,
    ),
    reentryCycles: integerOption(
      options.reentryCycles ?? env.REGISTER_PERF_REENTRY_CYCLES,
      defaults.reentryCycles,
      'reentryCycles',
      1,
    ),
    dynamicTailMs: integerOption(
      options.dynamicTailMs ?? env.REGISTER_PERF_DYNAMIC_TAIL_MS,
      defaults.dynamicTailMs,
      'dynamicTailMs',
      0,
    ),
    heapControlMs: integerOption(
      options.heapControlMs ?? env.REGISTER_PERF_HEAP_CONTROL_MS,
      defaults.heapControlMs,
      'heapControlMs',
      1000,
    ),
    allocationSampling: booleanOption(
      options.allocationSampling ?? env.REGISTER_PERF_ALLOCATION_SAMPLING,
      false,
    ),
    baselinePath,
  };
}

function configureViewport(value) {
  const raw = String(value || '').trim().toLowerCase().replace('×', 'x');
  if (!raw) {
    VIEWPORT = { ...DEFAULT_VIEWPORT };
    return { explicit: false, tag: `${VIEWPORT.width}x${VIEWPORT.height}` };
  }
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(raw);
  if (!match) throw new Error(`Invalid performance viewport "${value}". Use WIDTHxHEIGHT.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 640 || height < 360) throw new Error(`Performance viewport ${raw} is too small for the production route.`);
  VIEWPORT = { width, height };
  return { explicit: true, tag: `${width}x${height}` };
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function round(value, places = 3) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(places));
}

function median(values) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeFrames(frameTimesMs) {
  if (!frameTimesMs.length) {
    return {
      frameCount: 0,
      durationMs: 0,
      avgFps: null,
      onePercentLowFps: null,
      avgFrameMs: null,
      p95FrameMs: null,
      p99FrameMs: null,
      worstFrameMs: null,
      framesOver33Ms: 0,
      framesOver50Ms: 0,
      framesOver100Ms: 0,
    };
  }
  const ascending = [...frameTimesMs].sort((a, b) => a - b);
  const descending = [...ascending].reverse();
  const slowCount = Math.max(1, Math.ceil(descending.length * 0.01));
  const slowMean = descending.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
  const durationMs = frameTimesMs.reduce((sum, value) => sum + value, 0);
  const percentile = (p) => ascending[Math.min(ascending.length - 1, Math.floor(ascending.length * p))];
  return {
    frameCount: frameTimesMs.length,
    durationMs: round(durationMs, 1),
    avgFps: round(frameTimesMs.length * 1000 / durationMs),
    onePercentLowFps: round(1000 / slowMean),
    avgFrameMs: round(durationMs / frameTimesMs.length),
    p95FrameMs: round(percentile(0.95)),
    p99FrameMs: round(percentile(0.99)),
    worstFrameMs: round(descending[0]),
    framesOver33Ms: frameTimesMs.filter((value) => value > 33.333).length,
    framesOver50Ms: frameTimesMs.filter((value) => value > 50).length,
    framesOver100Ms: frameTimesMs.filter((value) => value > 100).length,
  };
}

function finiteHeapTrace(samples, durationMs = Infinity) {
  return (Array.isArray(samples) ? samples : [])
    .filter((sample) => Number.isFinite(sample?.elapsedMs)
      && sample.elapsedMs >= 0
      && sample.elapsedMs <= durationMs
      && Number.isFinite(sample?.usedHeapBytes))
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
}

function heapTraceIntegrity(samples) {
  const trace = Array.isArray(samples) ? samples : [];
  const finite = trace.length >= 2 && trace.every((sample) => (
    Number.isFinite(sample?.elapsedMs)
      && sample.elapsedMs >= 0
      && Number.isFinite(sample?.usedHeapBytes)
      && sample.usedHeapBytes >= 0
  ));
  const strictlyIncreasing = finite && trace.every((sample, index) => (
    index === 0 || sample.elapsedMs > trace[index - 1].elapsedMs
  ));
  return {
    trace,
    finite,
    strictlyIncreasing,
    startsAtZero: finite && trace[0].elapsedMs === 0,
    startAtMs: finite ? trace[0].elapsedMs : null,
    endAtMs: finite ? trace.at(-1).elapsedMs : null,
  };
}

export function summarizeHeapTrace(samples) {
  const trace = finiteHeapTrace(samples);
  if (!trace.length) {
    return {
      samples: 0,
      startBytes: null,
      endBytes: null,
      peakBytes: null,
      peakGrowthMiB: null,
      endGrowthMiB: null,
      maxDrawupMiB: null,
      drawupTroughAtMs: null,
      drawupPeakAtMs: null,
    };
  }
  const start = trace[0];
  const end = trace.at(-1);
  let peak = start;
  let trough = start;
  let drawupTrough = start;
  let drawupPeak = start;
  let maxDrawupBytes = 0;
  for (const sample of trace) {
    if (sample.usedHeapBytes > peak.usedHeapBytes) peak = sample;
    if (sample.usedHeapBytes < trough.usedHeapBytes) trough = sample;
    const drawupBytes = sample.usedHeapBytes - trough.usedHeapBytes;
    if (drawupBytes > maxDrawupBytes) {
      maxDrawupBytes = drawupBytes;
      drawupTrough = trough;
      drawupPeak = sample;
    }
  }
  return {
    samples: trace.length,
    startBytes: start.usedHeapBytes,
    endBytes: end.usedHeapBytes,
    peakBytes: peak.usedHeapBytes,
    peakGrowthMiB: round((peak.usedHeapBytes - start.usedHeapBytes) / 1048576),
    endGrowthMiB: round((end.usedHeapBytes - start.usedHeapBytes) / 1048576),
    maxDrawupMiB: round(maxDrawupBytes / 1048576),
    drawupTroughAtMs: round(drawupTrough.elapsedMs),
    drawupPeakAtMs: round(drawupPeak.elapsedMs),
  };
}

export function buildMatchedHeapCalibration(dynamicTrace, controlTrace, options = {}) {
  const dynamicDurationMs = Number(options.dynamicDurationMs);
  const controlDurationMs = Number(options.controlDurationMs);
  const budgetMiB = Number.isFinite(options.budgetMiB)
    ? options.budgetMiB
    : HEAP_TRANSIENT_EXCESS_BUDGET_MIB;
  const actionIntegrity = heapTraceIntegrity(dynamicTrace);
  const controlIntegrity = heapTraceIntegrity(controlTrace);
  const dynamic = summarizeHeapTrace(actionIntegrity.trace);
  const matchedControl = finiteHeapTrace(controlIntegrity.trace, dynamicDurationMs);
  const control = summarizeHeapTrace(matchedControl);
  const durationMatched = Number.isFinite(dynamicDurationMs)
    && dynamicDurationMs > 0
    && Number.isFinite(controlDurationMs)
    && controlDurationMs >= dynamicDurationMs;
  const stateMatched = options.controlStateStable === true;
  const matchedControlEndAtMs = matchedControl.length ? matchedControl.at(-1).elapsedMs : null;
  const matchedControlNextAtMs = controlIntegrity.finite
    ? controlIntegrity.trace.find((sample) => sample.elapsedMs >= dynamicDurationMs)?.elapsedMs ?? null
    : null;
  const actionTraceCoverageMs = actionIntegrity.finite
    ? actionIntegrity.endAtMs - actionIntegrity.startAtMs
    : null;
  const controlTraceCoverageMs = controlIntegrity.finite && Number.isFinite(matchedControlEndAtMs)
    ? matchedControlEndAtMs - controlIntegrity.startAtMs
    : null;
  const controlFullTraceCoverageMs = controlIntegrity.finite
    ? controlIntegrity.endAtMs - controlIntegrity.startAtMs
    : null;
  const actionTraceCoversDuration = Number.isFinite(dynamicDurationMs)
    && dynamicDurationMs > 0
    && actionIntegrity.startsAtZero
    && actionIntegrity.strictlyIncreasing
    && Number.isFinite(actionIntegrity.endAtMs)
    && Math.abs(actionIntegrity.endAtMs - dynamicDurationMs)
      <= HEAP_TRACE_COVERAGE_TOLERANCE_MS;
  const controlTraceCoversDuration = Number.isFinite(dynamicDurationMs)
    && dynamicDurationMs > 0
    && controlIntegrity.startsAtZero
    && controlIntegrity.strictlyIncreasing
    && Number.isFinite(controlIntegrity.endAtMs)
    && controlIntegrity.endAtMs >= dynamicDurationMs
    && Number.isFinite(matchedControlEndAtMs)
    && dynamicDurationMs - matchedControlEndAtMs
      <= HEAP_TRACE_COVERAGE_TOLERANCE_MS
    && Number.isFinite(matchedControlNextAtMs)
    && matchedControlNextAtMs - dynamicDurationMs
      <= HEAP_TRACE_COVERAGE_TOLERANCE_MS;
  const controlTraceCoversDeclaredDuration = Number.isFinite(controlDurationMs)
    && controlDurationMs > 0
    && controlIntegrity.startsAtZero
    && controlIntegrity.strictlyIncreasing
    && Number.isFinite(controlIntegrity.endAtMs)
    && Math.abs(controlIntegrity.endAtMs - controlDurationMs)
      <= HEAP_TRACE_COVERAGE_TOLERANCE_MS;
  const traceCoverageMatched = actionTraceCoversDuration
    && controlTraceCoversDuration
    && controlTraceCoversDeclaredDuration;
  const metricsComplete = dynamic.samples >= 2
    && control.samples >= 2
    && Number.isFinite(dynamic.maxDrawupMiB)
    && Number.isFinite(control.maxDrawupMiB);
  const excessMaxDrawupMiB = metricsComplete
    ? round(dynamic.maxDrawupMiB - control.maxDrawupMiB)
    : null;
  const qualified = durationMatched && stateMatched && traceCoverageMatched && metricsComplete;
  return {
    source: `Maximum live-heap draw-up compared with the prefix of one same-run, same-instrumentation active-monitor no-action control; both traces must start at zero, be strictly increasing, and cover the action boundary within ${HEAP_TRACE_COVERAGE_TOLERANCE_MS} ms`,
    dynamicDurationMs: round(dynamicDurationMs, 1),
    controlDurationMs: round(controlDurationMs, 1),
    durationMatched,
    controlStateStable: stateMatched,
    traceCoverageToleranceMs: HEAP_TRACE_COVERAGE_TOLERANCE_MS,
    actionTraceStrictlyIncreasing: actionIntegrity.strictlyIncreasing,
    controlTraceStrictlyIncreasing: controlIntegrity.strictlyIncreasing,
    actionTraceStartsAtZero: actionIntegrity.startsAtZero,
    controlTraceStartsAtZero: controlIntegrity.startsAtZero,
    actionTraceCoversDuration,
    controlTraceBoundaryBracketed: controlTraceCoversDuration,
    controlTraceCoversDuration,
    controlTraceCoversDeclaredDuration,
    traceCoverageMatched,
    actionTraceStartAtMs: round(actionIntegrity.startAtMs, 3),
    actionTraceEndAtMs: round(actionIntegrity.endAtMs, 3),
    matchedControlStartAtMs: round(controlIntegrity.startAtMs, 3),
    matchedControlEndAtMs: round(matchedControlEndAtMs, 3),
    matchedControlNextAtMs: round(matchedControlNextAtMs, 3),
    actionTraceCoverageMs: round(actionTraceCoverageMs, 3),
    controlTraceCoverageMs: round(controlTraceCoverageMs, 3),
    controlFullTraceCoverageMs: round(controlFullTraceCoverageMs, 3),
    qualified,
    actionMaxDrawupMiB: dynamic.maxDrawupMiB,
    controlMaxDrawupMiB: control.maxDrawupMiB,
    excessMaxDrawupMiB,
    budgetMiB,
    pass: qualified && excessMaxDrawupMiB <= budgetMiB,
    matchedControlSamples: control.samples,
    actionSamples: dynamic.samples,
  };
}

function delta(before, after) {
  const absolute = after == null || before == null ? null : after - before;
  const percent = absolute == null || before === 0 ? null : absolute / before * 100;
  return { before, after, absolute: round(absolute), percent: round(percent) };
}

function valueAt(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], object);
}

const BASELINE_SCENES = Object.freeze([
  'idleMonitor',
  'activeMonitor',
  'scanner',
  'card',
  'cardEntry',
  'cash',
  'cashDrawer',
]);
const BASELINE_METRICS = Object.freeze([
  Object.freeze({ key: 'avgFps', path: 'aggregate.avgFps', direction: 'higher' }),
  Object.freeze({ key: 'onePercentLowFps', path: 'aggregate.onePercentLowFps', direction: 'higher' }),
  Object.freeze({ key: 'p99FrameMs', path: 'aggregate.p99FrameMs', direction: 'lower' }),
  Object.freeze({ key: 'worstFrameMs', path: 'aggregate.worstFrameMs', direction: 'lower', diagnosticOnly: true }),
  Object.freeze({ key: 'drawCalls', path: 'render.drawCalls', direction: 'lower' }),
  Object.freeze({ key: 'renderedTriangles', path: 'render.renderedTriangles', direction: 'lower' }),
  Object.freeze({ key: 'visibleMaterials', path: 'render.uniqueVisibleMaterials', direction: 'lower' }),
  Object.freeze({ key: 'visibleTextures', path: 'render.uniqueVisibleTextures', direction: 'lower' }),
  Object.freeze({ key: 'estimatedVisibleTextureMiB', path: 'render.estimatedVisibleTextureMiB', direction: 'lower' }),
  Object.freeze({ key: 'postGcHeapMiB', path: 'heap.jsHeapUsedMiB', direction: 'lower' }),
]);

function baselineMetricPass(metric, change) {
  if (change.before == null || change.after == null) return null;
  switch (metric.key) {
    case 'avgFps': return change.percent >= -15;
    case 'onePercentLowFps': return change.percent >= -20;
    case 'p99FrameMs': return change.percent <= 30 || change.absolute <= 8;
    case 'drawCalls': return change.percent <= 5 || change.absolute <= 150;
    case 'renderedTriangles': return change.percent <= 10;
    case 'visibleMaterials': return change.percent <= 10 || change.absolute <= 12;
    case 'visibleTextures': return change.percent <= 10 || change.absolute <= 8;
    case 'estimatedVisibleTextureMiB': return change.percent <= 10 || change.absolute <= 64;
    case 'postGcHeapMiB': return change.absolute <= 5;
    default: return true;
  }
}

export function buildStoredBaselineComparison(baseline, current, provenance = {}) {
  if (!baseline || !current) {
    return {
      available: false,
      qualified: false,
      pass: null,
      provenance,
      reason: 'No stored baseline was available.',
      dynamicComparison: {
        available: false,
        reason: 'No stored baseline was available.',
      },
      rows: [],
    };
  }
  const baselineViewport = baseline.protocol?.viewport || baseline.environment?.viewport || null;
  const currentViewport = current.protocol?.viewport || current.environment?.viewport || null;
  const metricSchemaComplete = BASELINE_SCENES.every((scene) => (
    BASELINE_METRICS.every((metric) => (
      Number.isFinite(valueAt(baseline.scenes?.[scene], metric.path))
        && Number.isFinite(valueAt(current.scenes?.[scene], metric.path))
    ))
  ));
  const qualification = {
    viewportMatch: baselineViewport?.width === currentViewport?.width
      && baselineViewport?.height === currentViewport?.height,
    devicePixelRatioMatch: Number.isFinite(baseline.environment?.devicePixelRatio)
      && baseline.environment.devicePixelRatio === current.environment?.devicePixelRatio,
    browserModeMatch: !!baseline.protocol?.browserMode
      && baseline.protocol.browserMode === current.protocol?.browserMode,
    browserVersionMatch: !!baseline.environment?.browserVersion
      && baseline.environment.browserVersion === current.environment?.browserVersion,
    hardwareConcurrencyMatch: Number.isFinite(baseline.environment?.hardwareConcurrency)
      && baseline.environment.hardwareConcurrency === current.environment?.hardwareConcurrency,
    webglRendererMatch: !!baseline.environment?.webglRenderer
      && baseline.environment.webglRenderer === current.environment?.webglRenderer,
    sampleProtocolMatch: Number.isFinite(baseline.protocol?.sampleCount)
      && Number.isFinite(baseline.protocol?.sampleMs)
      && Number.isFinite(baseline.protocol?.warmupMs)
      && Number.isFinite(baseline.protocol?.gcSettleMs)
      && baseline.protocol.sampleCount === current.protocol?.sampleCount
      && baseline.protocol?.sampleMs === current.protocol?.sampleMs
      && baseline.protocol?.warmupMs === current.protocol?.warmupMs
      && baseline.protocol?.gcSettleMs === current.protocol?.gcSettleMs,
    metricSchemaComplete,
  };
  const qualified = Object.values(qualification).every(Boolean);
  const rows = [];
  for (const scene of BASELINE_SCENES) {
    for (const metric of BASELINE_METRICS) {
      const before = valueAt(baseline.scenes?.[scene], metric.path);
      const after = valueAt(current.scenes?.[scene], metric.path);
      const change = delta(before, after);
      const metricPass = metric.diagnosticOnly ? null : baselineMetricPass(metric, change);
      rows.push({
        scene,
        metric: metric.key,
        units: /Fps$/.test(metric.key) ? 'fps'
          : /FrameMs$/.test(metric.key) ? 'ms'
            : /MiB$/.test(metric.key) ? 'MiB' : 'count',
        direction: metric.direction,
        diagnosticOnly: !!metric.diagnosticOnly,
        ...change,
        pass: qualified ? metricPass : null,
      });
    }
  }
  const judged = rows.filter((row) => row.pass != null);
  const dynamicAvailable = REQUIRED_DYNAMIC_PHASES.every(
    (key) => baseline.dynamicPhases?.[key] && current.dynamicPhases?.[key],
  );
  return {
    available: true,
    qualified,
    pass: qualified ? judged.every((row) => row.pass) : null,
    qualification,
    provenance,
    baselineGeneratedAt: baseline.generatedAt || null,
    currentGeneratedAt: current.generatedAt || null,
    reason: qualified
      ? 'Matched viewport, DPR, browser mode/version, CPU concurrency, GPU renderer, and static sampling protocol.'
      : 'Stored results are retained for diagnosis but are not judged because the matched-run qualification failed.',
    budgets: {
      avgFps: 'no more than 15% lower',
      onePercentLowFps: 'no more than 20% lower',
      p99FrameMs: 'no more than 30% or 8 ms higher',
      drawCalls: 'no more than 5% or 150 calls higher',
      renderedTriangles: 'no more than 10% higher',
      visibleMaterials: 'no more than 10% or 12 higher',
      visibleTextures: 'no more than 10% or 8 higher',
      estimatedVisibleTextureMiB: 'no more than 10% or 64 MiB higher',
      postGcHeapMiB: 'no more than 5 MiB higher',
    },
    dynamicComparison: dynamicAvailable ? {
      available: true,
      reason: 'Both runs contain the complete dynamic-phase schema.',
    } : {
      available: false,
      reason: 'The stored pre-tray run predates dynamic-phase instrumentation; only like-for-like static scenes are compared.',
    },
    rows,
  };
}

export function validatePerformanceResultSchema(result) {
  const issues = [];
  const sha256Pattern = /^[a-f0-9]{64}$/;
  const requireFinite = (value, label) => {
    if (!Number.isFinite(value)) issues.push(`${label} must be finite.`);
  };
  const protocolHeapControlMs = result?.protocol?.heapControlMs;
  const protocolGcSettleMs = result?.protocol?.gcSettleMs;
  const protocolSampleCount = result?.protocol?.sampleCount;
  if (!['master', 'smoke'].includes(result?.protocol?.profile)) {
    issues.push('protocol.profile must be master or smoke.');
  }
  if (!['headed', 'headless'].includes(result?.protocol?.browserMode)) {
    issues.push('protocol.browserMode must be headed or headless.');
  }
  for (const metric of ['width', 'height']) {
    const value = result?.protocol?.viewport?.[metric];
    if (!Number.isSafeInteger(value) || value < 1) {
      issues.push(`protocol.viewport.${metric} must be a positive integer.`);
    }
  }
  if (!Number.isSafeInteger(protocolSampleCount) || protocolSampleCount < 1) {
    issues.push('protocol.sampleCount must be a positive integer.');
  }
  requireFinite(protocolHeapControlMs, 'protocol.heapControlMs');
  if (Number.isFinite(protocolHeapControlMs) && protocolHeapControlMs <= 0) {
    issues.push('protocol.heapControlMs must be positive.');
  }
  requireFinite(protocolGcSettleMs, 'protocol.gcSettleMs');
  if (Number.isFinite(protocolGcSettleMs) && protocolGcSettleMs <= 0) {
    issues.push('protocol.gcSettleMs must be positive.');
  }
  if (result?.schemaVersion !== PERFORMANCE_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${PERFORMANCE_SCHEMA_VERSION}.`);
  }
  for (const key of BASELINE_SCENES) {
    const scene = result?.scenes?.[key];
    if (!scene) {
      issues.push(`scenes.${key} is required.`);
      continue;
    }
    if (typeof scene.screenshot !== 'string' || !scene.screenshot.trim()) {
      issues.push(`scenes.${key}.screenshot is required.`);
    }
    for (const metric of ['avgFps', 'onePercentLowFps', 'p95FrameMs', 'p99FrameMs', 'worstFrameMs']) {
      requireFinite(scene.aggregate?.[metric], `scenes.${key}.aggregate.${metric}`);
    }
    for (const metric of ['drawCalls', 'renderedTriangles', 'uniqueVisibleGeometries', 'uniqueVisibleMaterials', 'uniqueVisibleTextures']) {
      requireFinite(scene.render?.[metric], `scenes.${key}.render.${metric}`);
    }
    const renderFrameCount = scene.render?.frameDistribution?.frameCount;
    requireFinite(renderFrameCount, `scenes.${key}.render.frameDistribution.frameCount`);
    if (Number.isFinite(renderFrameCount) && renderFrameCount !== RENDER_CAPTURE_FRAME_COUNT) {
      issues.push(`scenes.${key}.render.frameDistribution.frameCount must be ${RENDER_CAPTURE_FRAME_COUNT}.`);
    }
    const samples = scene.samples;
    if (!Array.isArray(samples)
        || samples.length !== protocolSampleCount
        || samples.some((sample) => (
          !Number.isFinite(sample?.summary?.avgFps)
          || !Number.isFinite(sample?.summary?.onePercentLowFps)
          || !Number.isFinite(sample?.summary?.worstFrameMs)
        ))) {
      issues.push(`scenes.${key}.samples must match protocol.sampleCount with finite summary metrics.`);
    }
    requireFinite(scene.heap?.jsHeapUsedMiB, `scenes.${key}.heap.jsHeapUsedMiB`);
    requireFinite(scene.listeners?.total, `scenes.${key}.listeners.total`);
    requireFinite(scene.dom?.elements, `scenes.${key}.dom.elements`);
    for (const metric of [
      'objects', 'meshes', 'geometries', 'materials', 'textures',
    ]) {
      requireFinite(
        scene.liveSceneResources?.[metric],
        `scenes.${key}.liveSceneResources.${metric}`,
      );
    }
    for (const metric of ['geometries', 'textures']) {
      requireFinite(
        scene.liveSceneResources?.rendererMemory?.[metric],
        `scenes.${key}.liveSceneResources.rendererMemory.${metric}`,
      );
    }
    if (key === 'idleMonitor' || key === 'activeMonitor') {
      for (const metric of [
        'frontDeskMonitor', 'scannerStatus', 'cashWorkspace', 'cardTerminal',
      ]) {
        requireFinite(scene.ui?.perSecond?.[metric], `scenes.${key}.ui.perSecond.${metric}`);
      }
    }
  }
  for (const key of REQUIRED_DYNAMIC_PHASES) {
    const phase = result?.dynamicPhases?.[key];
    if (!phase) {
      issues.push(`dynamicPhases.${key} is required.`);
      continue;
    }
    if (typeof phase.screenshot !== 'string' || !phase.screenshot.trim()) {
      issues.push(`dynamicPhases.${key}.screenshot is required.`);
    }
    requireFinite(phase.aggregate?.frameCount, `dynamicPhases.${key}.aggregate.frameCount`);
    for (const metric of ['avgFps', 'onePercentLowFps', 'p95FrameMs', 'p99FrameMs', 'worstFrameMs']) {
      requireFinite(phase.aggregate?.[metric], `dynamicPhases.${key}.aggregate.${metric}`);
    }
    for (const metric of ['drawCalls', 'renderedTriangles', 'uniqueVisibleGeometries', 'uniqueVisibleMaterials', 'uniqueVisibleTextures']) {
      requireFinite(phase.render?.[metric], `dynamicPhases.${key}.render.${metric}`);
    }
    const renderFrameCount = phase.render?.frameDistribution?.frameCount;
    requireFinite(renderFrameCount, `dynamicPhases.${key}.render.frameDistribution.frameCount`);
    if (Number.isFinite(renderFrameCount) && renderFrameCount !== RENDER_CAPTURE_FRAME_COUNT) {
      issues.push(`dynamicPhases.${key}.render.frameDistribution.frameCount must be ${RENDER_CAPTURE_FRAME_COUNT}.`);
    }
    const frameTimesMs = phase.frameTimesMs;
    const stateTimeline = phase.stateTimeline;
    const frameTimelineValid = Array.isArray(frameTimesMs)
      && frameTimesMs.length > 0
      && Array.isArray(stateTimeline)
      && stateTimeline.length === frameTimesMs.length
      && frameTimesMs.every((frameTimeMs) => Number.isFinite(frameTimeMs) && frameTimeMs > 0)
      && stateTimeline.every((entry, index, timeline) => (
        Number.isFinite(entry?.frameTimeMs)
          && entry.frameTimeMs > 0
          && entry.frameTimeMs === frameTimesMs[index]
          && Number.isFinite(entry?.atMs)
          && (index === 0 || entry.atMs > timeline[index - 1].atMs)
      ));
    if (!frameTimelineValid) {
      issues.push(`dynamicPhases.${key}.frameTimesMs and stateTimeline must contain matching positive frame deltas with strictly increasing timestamps.`);
    }
    if (Array.isArray(frameTimesMs)
        && Number.isFinite(phase.aggregate?.frameCount)
        && phase.aggregate.frameCount !== frameTimesMs.length) {
      issues.push(`dynamicPhases.${key}.aggregate.frameCount must match frameTimesMs length.`);
    }
    if (!phase.resources?.before || !phase.resources?.afterPostGc) {
      issues.push(`dynamicPhases.${key}.resources must include before and afterPostGc.`);
    }
    if (!phase.stability || !phase.heapHighWater || !phase.ui) {
      issues.push(`dynamicPhases.${key} must include stability, heapHighWater, and ui metrics.`);
    } else {
      const heapTimeline = phase.heapTimeline;
      const heapTimelineValid = Array.isArray(heapTimeline)
        && heapTimeline.length >= 2
        && heapTimeline[0]?.boundary === 'start'
        && heapTimeline.at(-1)?.boundary === 'stop'
        && heapTimeline.every((sample, index, trace) => (
          Number.isFinite(sample?.elapsedMs)
            && sample.elapsedMs >= 0
            && Number.isFinite(sample?.usedHeapBytes)
            && sample.usedHeapBytes >= 0
            && (index === 0 || sample.elapsedMs > trace[index - 1].elapsedMs)
        ));
      if (!heapTimelineValid) {
        issues.push(`dynamicPhases.${key}.heapTimeline must contain explicit start/stop boundary samples in finite, non-negative, strictly increasing order.`);
      }
      for (const metric of [
        'samples', 'startBytes', 'endBytes', 'peakBytes', 'peakGrowthMiB', 'endGrowthMiB',
        'maxDrawupMiB',
      ]) {
        requireFinite(phase.heapHighWater?.[metric], `dynamicPhases.${key}.heapHighWater.${metric}`);
      }
      const calibration = phase.heapHighWater?.calibration;
      const calibrationBooleans = [
        'durationMatched', 'controlStateStable', 'actionTraceStrictlyIncreasing',
        'controlTraceStrictlyIncreasing', 'actionTraceStartsAtZero',
        'controlTraceStartsAtZero', 'actionTraceCoversDuration',
        'controlTraceBoundaryBracketed', 'controlTraceCoversDuration',
        'controlTraceCoversDeclaredDuration',
        'traceCoverageMatched', 'qualified',
      ];
      if (!calibration || calibrationBooleans.some(
        (field) => typeof calibration[field] !== 'boolean',
      )) {
        issues.push(`dynamicPhases.${key}.heapHighWater.calibration must include qualification booleans.`);
      } else {
        for (const metric of [
          'dynamicDurationMs', 'controlDurationMs', 'actionMaxDrawupMiB',
          'controlMaxDrawupMiB', 'excessMaxDrawupMiB', 'budgetMiB',
          'matchedControlSamples', 'actionSamples', 'traceCoverageToleranceMs',
          'actionTraceStartAtMs', 'actionTraceEndAtMs', 'matchedControlStartAtMs',
          'matchedControlEndAtMs', 'matchedControlNextAtMs', 'actionTraceCoverageMs',
          'controlTraceCoverageMs',
          'controlFullTraceCoverageMs',
        ]) {
          requireFinite(
            calibration[metric],
            `dynamicPhases.${key}.heapHighWater.calibration.${metric}`,
          );
        }
        if (Array.isArray(heapTimeline)
            && phase.heapHighWater?.samples !== heapTimeline.length) {
          issues.push(`dynamicPhases.${key}.heapHighWater.samples must match heapTimeline length.`);
        }
        if (Array.isArray(heapTimeline)
            && calibration.actionSamples !== heapTimeline.length) {
          issues.push(`dynamicPhases.${key}.heapHighWater.calibration.actionSamples must match heapTimeline length.`);
        }
        if (Number.isFinite(protocolHeapControlMs)
            && Number.isFinite(calibration.controlDurationMs)
            && Math.abs(calibration.controlDurationMs - protocolHeapControlMs)
              > HEAP_TRACE_COVERAGE_TOLERANCE_MS) {
          issues.push(`dynamicPhases.${key}.heapHighWater.calibration.controlDurationMs must match protocol.heapControlMs within ${HEAP_TRACE_COVERAGE_TOLERANCE_MS} ms.`);
        }
      }
    }
  }
  for (const key of REQUIRED_DYNAMIC_WINDOWS) {
    const window = result?.dynamicWindows?.[key];
    if (!window) {
      issues.push(`dynamicWindows.${key} is required.`);
      continue;
    }
    if (typeof window.screenshot !== 'string' || !window.screenshot.trim()) {
      issues.push(`dynamicWindows.${key}.screenshot is required.`);
    }
    requireFinite(window.aggregate?.frameCount, `dynamicWindows.${key}.aggregate.frameCount`);
    requireFinite(window.longTasks?.count, `dynamicWindows.${key}.longTasks.count`);
    requireFinite(
      window.longTasks?.totalDurationMs,
      `dynamicWindows.${key}.longTasks.totalDurationMs`,
    );
    if (typeof window.longTasks?.supported !== 'boolean'
        || !Array.isArray(window.longTasks?.entries)) {
      issues.push(`dynamicWindows.${key}.longTasks must include support and raw entries.`);
    }
    if (!Number.isFinite(window.aggregate?.frameCount) || window.aggregate.frameCount < 2
        || !Number.isFinite(window.longTasks?.count) || window.longTasks.count < 0
        || !Number.isFinite(window.longTasks?.totalDurationMs)
        || window.longTasks.totalDurationMs < 0) {
      issues.push(`dynamicWindows.${key} must contain at least two frames and non-negative long-task metrics.`);
    }
  }
  const reentryLeak = result?.reentryLeak;
  if (!reentryLeak
      || !Number.isSafeInteger(reentryLeak.cycles)
      || reentryLeak.cycles < 1
      || reentryLeak.cycles !== result?.protocol?.reentryCycles
      || !Array.isArray(reentryLeak.samples)
      || reentryLeak.samples.length < 2) {
    issues.push('reentryLeak must include the declared positive cycle count and at least two samples.');
  }
  for (const metric of [
    'heapMiB', 'listeners', 'domElements', 'liveGeometries', 'liveMaterials',
    'liveTextures', 'rendererGeometries', 'rendererTextures',
  ]) {
    requireFinite(reentryLeak?.delta?.[metric], `reentryLeak.delta.${metric}`);
  }
  const measuredFiles = result?.build?.measuredFiles;
  if (!Array.isArray(measuredFiles) || measuredFiles.length === 0) {
    issues.push('build.measuredFiles must contain the QA harness provenance map.');
  } else {
    for (const [index, entry] of measuredFiles.entries()) {
      if (typeof entry?.path !== 'string' || !entry.path
          || entry.exists !== true || !sha256Pattern.test(entry.sha256 || '')) {
        issues.push(`build.measuredFiles[${index}] must name an existing file with a lowercase SHA-256.`);
      }
    }
  }
  const heapIdleControl = result?.heapIdleControl;
  if (!heapIdleControl || typeof heapIdleControl.stateStable !== 'boolean'
      || !Array.isArray(heapIdleControl.heapTimeline)) {
    issues.push('heapIdleControl with a state-stable raw heap timeline is required.');
  } else {
    if (heapIdleControl.heapTimeline.length < 2
        || heapIdleControl.heapTimeline.some((sample) => (
          !Number.isFinite(sample?.elapsedMs)
            || sample.elapsedMs < 0
            || !Number.isFinite(sample?.usedHeapBytes)
            || sample.usedHeapBytes < 0
        ))
        || heapIdleControl.heapTimeline[0]?.elapsedMs !== 0
        || heapIdleControl.heapTimeline[0]?.boundary !== 'start'
        || heapIdleControl.heapTimeline.at(-1)?.boundary !== 'stop'
        || heapIdleControl.heapTimeline.some((sample, index, trace) => (
          index > 0 && sample.elapsedMs <= trace[index - 1].elapsedMs
        ))) {
      issues.push('heapIdleControl.heapTimeline must contain explicit start/stop boundary samples in finite, non-negative, strictly increasing order starting at zero.');
    }
    for (const metric of [
      'durationMs', 'samples', 'startBytes', 'endBytes', 'peakBytes',
      'peakGrowthMiB', 'endGrowthMiB', 'maxDrawupMiB',
    ]) {
      requireFinite(
        heapIdleControl.heapHighWater?.[metric],
        `heapIdleControl.heapHighWater.${metric}`,
      );
    }
    if (heapIdleControl.heapHighWater?.samples !== heapIdleControl.heapTimeline.length) {
      issues.push('heapIdleControl.heapHighWater.samples must match heapIdleControl.heapTimeline length.');
    }
    const controlDurationMs = heapIdleControl.heapHighWater?.durationMs;
    if (Number.isFinite(protocolHeapControlMs)
        && Number.isFinite(controlDurationMs)
        && Math.abs(controlDurationMs - protocolHeapControlMs)
          > HEAP_TRACE_COVERAGE_TOLERANCE_MS) {
      issues.push(`heapIdleControl.heapHighWater.durationMs must match protocol.heapControlMs within ${HEAP_TRACE_COVERAGE_TOLERANCE_MS} ms.`);
    }
    const controlTimelineEndMs = heapIdleControl.heapTimeline.at(-1)?.elapsedMs;
    if (Number.isFinite(controlDurationMs)
        && Number.isFinite(controlTimelineEndMs)
        && Math.abs(controlTimelineEndMs - controlDurationMs)
          > HEAP_TRACE_COVERAGE_TOLERANCE_MS) {
      issues.push(`heapIdleControl.heapTimeline must cover its declared duration within ${HEAP_TRACE_COVERAGE_TOLERANCE_MS} ms.`);
    }
    const controlFrameTimes = heapIdleControl.frameTimesMs;
    const controlStateTimeline = heapIdleControl.stateTimeline;
    const controlFrameTimelineValid = Array.isArray(controlFrameTimes)
      && controlFrameTimes.length > 0
      && Array.isArray(controlStateTimeline)
      && controlStateTimeline.length === controlFrameTimes.length
      && controlFrameTimes.every((frameTimeMs) => Number.isFinite(frameTimeMs) && frameTimeMs > 0)
      && controlStateTimeline.every((entry, index, timeline) => (
        Number.isFinite(entry?.frameTimeMs)
          && entry.frameTimeMs > 0
          && entry.frameTimeMs === controlFrameTimes[index]
          && Number.isFinite(entry?.atMs)
          && (index === 0 || entry.atMs > timeline[index - 1].atMs)
      ));
    if (!controlFrameTimelineValid) {
      issues.push('heapIdleControl.frameTimesMs and stateTimeline must contain matching positive frame deltas with strictly increasing timestamps.');
    }
    requireFinite(heapIdleControl.aggregate?.frameCount, 'heapIdleControl.aggregate.frameCount');
    if (Array.isArray(controlFrameTimes)
        && Number.isFinite(heapIdleControl.aggregate?.frameCount)
        && heapIdleControl.aggregate.frameCount !== controlFrameTimes.length) {
      issues.push('heapIdleControl.aggregate.frameCount must match frameTimesMs length.');
    }
    requireFinite(heapIdleControl.stability?.listeners, 'heapIdleControl.stability.listeners');
    requireFinite(heapIdleControl.stability?.domElements, 'heapIdleControl.stability.domElements');
    if (Number.isFinite(heapIdleControl.stability?.listeners)
        && heapIdleControl.stability.listeners !== 0) {
      issues.push('heapIdleControl.stability.listeners must be zero.');
    }
    if (Number.isFinite(heapIdleControl.stability?.domElements)
        && heapIdleControl.stability.domElements !== 0) {
      issues.push('heapIdleControl.stability.domElements must be zero.');
    }
    const qualification = heapIdleControl.qualification;
    const qualificationBooleans = [
      'qualified', 'endpointStateComplete', 'endpointStateStable',
      'timelineStateComplete', 'timelineStateStable', 'cameraStable',
      'drawerPrewarmStable', 'cashGpuPrewarmStable', 'prewarmReady',
      'resourcesStable', 'listenerStable', 'domStable',
    ];
    if (!qualification || qualificationBooleans.some(
      (field) => typeof qualification[field] !== 'boolean',
    )) {
      issues.push('heapIdleControl.qualification must include state, camera, prewarm, and resource booleans.');
    } else {
      requireFinite(qualification.timelineSamples, 'heapIdleControl.qualification.timelineSamples');
      if (Array.isArray(controlStateTimeline)
          && Number.isFinite(qualification.timelineSamples)
          && qualification.timelineSamples !== controlStateTimeline.length) {
        issues.push('heapIdleControl.qualification.timelineSamples must match stateTimeline length.');
      }
    }
  }
  const transactionStability = result?.transactionStability;
  const transactionBoundaryKeys = ['start', 'afterFirstSale', 'afterWarmSale', 'end'];
  const boundaryCountMetrics = [
    ['listeners.total', (boundary) => boundary.listeners?.total],
    ['dom.elements', (boundary) => boundary.dom?.elements],
    ['liveSceneResources.objects', (boundary) => boundary.liveSceneResources?.objects],
    ['liveSceneResources.meshes', (boundary) => boundary.liveSceneResources?.meshes],
    ['liveSceneResources.geometries', (boundary) => boundary.liveSceneResources?.geometries],
    ['liveSceneResources.materials', (boundary) => boundary.liveSceneResources?.materials],
    ['liveSceneResources.textures', (boundary) => boundary.liveSceneResources?.textures],
    ['liveSceneResources.rendererMemory.geometries',
      (boundary) => boundary.liveSceneResources?.rendererMemory?.geometries],
    ['liveSceneResources.rendererMemory.textures',
      (boundary) => boundary.liveSceneResources?.rendererMemory?.textures],
  ];
  for (const key of transactionBoundaryKeys) {
    const boundary = transactionStability?.[key];
    if (!boundary) {
      issues.push(`transactionStability.${key} is required.`);
      continue;
    }
    if (boundary.heap?.explicitGcRequested !== true
        || boundary.heap?.explicitGcImmediatelyBeforeRead !== true) {
      issues.push(`transactionStability.${key}.heap must prove a successful explicit GC immediately before the heap read.`);
    }
    if (!Number.isFinite(boundary.heap?.jsHeapUsedMiB)
        || boundary.heap.jsHeapUsedMiB < 0) {
      issues.push(`transactionStability.${key}.heap.jsHeapUsedMiB must be finite and non-negative.`);
    }
    for (const [metric, read] of boundaryCountMetrics) {
      const value = read(boundary);
      if (!Number.isSafeInteger(value) || value < 0) {
        issues.push(`transactionStability.${key}.${metric} must be a non-negative integer.`);
      }
    }
    const state = boundary.state;
    if (state?.active !== true
        || state.workspace !== 'monitor'
        || state.transactionNumber != null
        || state.transactionStage != null
        || state.customerCount !== 0
        || state.drawerOpen !== false) {
      issues.push(`transactionStability.${key}.state must be the clean active monitor with no transaction, customer, or open drawer.`);
    }
    const normalization = boundary.heapNormalization;
    if (!normalization
        || normalization.kind !== 'clear-diagnostics-precollect-settle-final-immediate-gc'
        || !Number.isFinite(normalization.settleMs)
        || normalization.settleMs < 0
        || normalization.dynamicDiagnosticsAvailable !== true
        || (key !== 'start' && normalization.dynamicDiagnosticsCleared !== true)
        || normalization.dynamicDiagnosticsWasRunning !== false
        || normalization.preSettleExplicitGcSucceeded !== true
        || normalization.finalExplicitGcImmediatelyBeforeRead !== true) {
      issues.push(`transactionStability.${key}.heapNormalization must prove cleared diagnostics, a settled pre-collection, and a final immediate GC.`);
    }
    if (Number.isFinite(normalization?.settleMs)
        && Number.isFinite(protocolGcSettleMs)
        && normalization.settleMs !== protocolGcSettleMs) {
      issues.push(`transactionStability.${key}.heapNormalization.settleMs must equal protocol.gcSettleMs.`);
    }
    for (const metric of ['clearedFrameSamples', 'clearedStateSamples', 'clearedHeapSamples']) {
      const value = normalization?.[metric];
      if (!Number.isSafeInteger(value) || value < 0) {
        issues.push(`transactionStability.${key}.heapNormalization.${metric} must be a non-negative integer.`);
      }
    }
    if (key !== 'start' && normalization) {
      if (normalization.clearedFrameSamples < 1
          || normalization.clearedStateSamples < 1
          || normalization.clearedHeapSamples < 2) {
        issues.push(`transactionStability.${key}.heapNormalization must prove non-empty completed recorder timelines were cleared.`);
      }
      if (normalization.clearedFrameSamples !== normalization.clearedStateSamples) {
        issues.push(`transactionStability.${key}.heapNormalization cleared frame/state sample counts must match.`);
      }
    }
  }
  const transactionDeltaKeys = [
    'firstUseDelta', 'pathWarmupDelta', 'methodMatchedDelta',
    'repeatSaleDelta', 'totalDelta', 'delta',
  ];
  const transactionDeltaMetrics = [
    'postGcHeapMiB', 'listeners', 'domElements', 'liveSceneObjects',
    'liveSceneMeshes', 'liveGeometries', 'liveMaterials', 'liveTextures',
    'rendererGeometries', 'rendererTextures',
  ];
  for (const key of transactionDeltaKeys) {
    const delta = transactionStability?.[key];
    if (!delta) {
      issues.push(`transactionStability.${key} is required.`);
      continue;
    }
    for (const metric of transactionDeltaMetrics) {
      if (!Number.isFinite(delta[metric])) {
        issues.push(`transactionStability.${key}.${metric} must be finite.`);
      }
    }
  }
  if (transactionStability?.methodMatchedDelta
      && JSON.stringify(transactionStability.repeatSaleDelta)
        !== JSON.stringify(transactionStability.methodMatchedDelta)) {
    issues.push('transactionStability.repeatSaleDelta must alias methodMatchedDelta.');
  }
  if (transactionStability?.methodMatchedDelta
      && JSON.stringify(transactionStability.delta)
        !== JSON.stringify(transactionStability.methodMatchedDelta)) {
    issues.push('transactionStability.delta must alias methodMatchedDelta.');
  }
  const canRecomputeTransactionDeltas = transactionBoundaryKeys.every((key) => {
    const boundary = transactionStability?.[key];
    return boundary
      && Number.isFinite(boundary.heap?.jsHeapUsedMiB)
      && boundaryCountMetrics.every(([, read]) => Number.isFinite(read(boundary)));
  });
  if (canRecomputeTransactionDeltas) {
    const recomputed = transactionStabilityReport(
      transactionStability.start,
      transactionStability.afterFirstSale,
      transactionStability.afterWarmSale,
      transactionStability.end,
    );
    for (const key of ['firstUseDelta', 'pathWarmupDelta', 'methodMatchedDelta', 'totalDelta']) {
      for (const metric of transactionDeltaMetrics) {
        if (transactionStability[key]?.[metric] !== recomputed[key][metric]) {
          issues.push(`transactionStability.${key}.${metric} must equal the boundary-derived delta ${recomputed[key][metric]}.`);
        }
      }
    }
  }
  if (!result?.storedBaselineComparison
      || typeof result.storedBaselineComparison.available !== 'boolean') {
    issues.push('storedBaselineComparison with an explicit availability flag is required.');
  }
  const productionBuildHashes = result?.productionBuildHashes;
  const productionBuildSnapshot = result?.productionBuildSnapshot;
  if (!productionBuildHashes || typeof productionBuildHashes !== 'object'
      || Array.isArray(productionBuildHashes)) {
    issues.push('productionBuildHashes must contain the full cashier production map.');
  } else {
    const hashEntries = Object.entries(productionBuildHashes);
    if (hashEntries.length === 0) {
      issues.push('productionBuildHashes must not be empty.');
    }
    for (const [file, hash] of hashEntries) {
      if (!file || !sha256Pattern.test(hash || '')) {
        issues.push(`productionBuildHashes.${file || '<missing>'} must be a lowercase SHA-256.`);
      }
    }
  }
  if (!productionBuildSnapshot || typeof productionBuildSnapshot !== 'object'
      || Array.isArray(productionBuildSnapshot)) {
    issues.push('productionBuildSnapshot is required.');
  } else {
    if (productionBuildSnapshot.schemaVersion !== CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION) {
      issues.push(`productionBuildSnapshot.schemaVersion must be ${CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION}.`);
    }
    if (productionBuildSnapshot.algorithm !== 'sha256') {
      issues.push('productionBuildSnapshot.algorithm must be sha256.');
    }
    for (const field of ['beforeAggregateHash', 'afterAggregateHash']) {
      if (!sha256Pattern.test(productionBuildSnapshot[field] || '')) {
        issues.push(`productionBuildSnapshot.${field} must be a lowercase SHA-256.`);
      }
    }
    for (const field of ['beforeFileCount', 'afterFileCount']) {
      if (!Number.isSafeInteger(productionBuildSnapshot[field])
          || productionBuildSnapshot[field] < 1) {
        issues.push(`productionBuildSnapshot.${field} must be a positive integer.`);
      }
    }
    if (productionBuildHashes && typeof productionBuildHashes === 'object'
        && !Array.isArray(productionBuildHashes)
        && Number.isSafeInteger(productionBuildSnapshot.beforeFileCount)
        && Object.keys(productionBuildHashes).length !== productionBuildSnapshot.beforeFileCount) {
      issues.push('productionBuildHashes must contain every before-snapshot file.');
    }
    if (typeof productionBuildSnapshot.unchanged !== 'boolean'
        || !Array.isArray(productionBuildSnapshot.changedFiles)) {
      issues.push('productionBuildSnapshot must include unchanged and changedFiles.');
    }
  }
  return { valid: issues.length === 0, issues };
}

export function buildDynamicGateReport(
  dynamicPhases,
  transactionStability,
  baselineComparison,
  dynamicWindows = {},
  heapIdleControl = null,
) {
  const repeatApprovedPhase = dynamicWindows?.cardApprovedRepeat;
  const phases = [
    ...REQUIRED_DYNAMIC_PHASES.map((key) => dynamicPhases?.[key]).filter(Boolean),
    ...(repeatApprovedPhase ? [repeatApprovedPhase] : []),
  ];
  const missing = REQUIRED_DYNAMIC_PHASES.filter((key) => !dynamicPhases?.[key]);
  if (!repeatApprovedPhase) missing.push('dynamicWindows.cardApprovedRepeat');
  const measuredPhases = phases.map((phase) => ({
    phase,
    summary: summarizeFrames(Array.isArray(phase?.frameTimesMs) ? phase.frameTimesMs : []),
  }));
  const valuesFor = (selector) => measuredPhases.map(selector).filter(Number.isFinite);
  const worst = (selector, fallback = null) => {
    const values = valuesFor(selector);
    return values.length ? Math.max(...values) : fallback;
  };
  const minimum = (selector, fallback = null) => {
    const values = valuesFor(selector);
    return values.length ? Math.min(...values) : fallback;
  };
  const minimumFrames = minimum(({ summary }) => summary.frameCount, 0);
  const minimumAvgFps = minimum(({ summary }) => summary.avgFps, 0);
  const maximumP99 = worst(({ summary }) => summary.p99FrameMs, Infinity);
  const maximumWorst = worst(({ summary }) => summary.worstFrameMs, Infinity);
  const recomputedControlQualification = heapIdleControl
    ? qualifyHeapControl(heapIdleControl)
    : null;
  const heapCalibrations = phases.map((phase) => (
    heapIdleControl
      ? buildMatchedHeapCalibration(phase.heapTimeline, heapIdleControl.heapTimeline, {
        dynamicDurationMs: phase.heapHighWater?.durationMs,
        controlDurationMs: heapIdleControl.heapHighWater?.durationMs,
        controlStateStable: recomputedControlQualification?.qualified === true,
      })
      : phase.heapHighWater?.calibration
  ));
  const heapHighWaterComplete = phases.length > 0
    && heapCalibrations.every((calibration) => calibration?.qualified === true
      && calibration.durationMatched === true
      && calibration.controlStateStable === true
      && calibration.actionTraceStrictlyIncreasing === true
      && calibration.controlTraceStrictlyIncreasing === true
      && calibration.actionTraceStartsAtZero === true
      && calibration.controlTraceStartsAtZero === true
      && calibration.actionTraceCoversDuration === true
      && calibration.controlTraceBoundaryBracketed === true
      && calibration.controlTraceCoversDuration === true
      && calibration.controlTraceCoversDeclaredDuration === true
      && calibration.traceCoverageMatched === true
      && Number.isFinite(calibration.dynamicDurationMs)
      && Number.isFinite(calibration.controlDurationMs)
      && calibration.controlDurationMs >= calibration.dynamicDurationMs
      && Number.isFinite(calibration.traceCoverageToleranceMs)
      && calibration.traceCoverageToleranceMs === HEAP_TRACE_COVERAGE_TOLERANCE_MS
      && Number.isFinite(calibration.actionTraceCoverageMs)
      && Number.isFinite(calibration.controlTraceCoverageMs)
      && Number.isFinite(calibration.controlFullTraceCoverageMs)
      && Number.isFinite(calibration.actionSamples)
      && calibration.actionSamples >= 2
      && Number.isFinite(calibration.matchedControlSamples)
      && calibration.matchedControlSamples >= 2
      && Number.isFinite(calibration.actionMaxDrawupMiB)
      && Number.isFinite(calibration.controlMaxDrawupMiB)
      && Number.isFinite(calibration.excessMaxDrawupMiB));
  const maximumHeapExcess = heapHighWaterComplete
    ? Math.max(...heapCalibrations.map((calibration) => calibration.excessMaxDrawupMiB))
    : null;
  const deltaValues = transactionStability?.methodMatchedDelta || {};
  const totalDeltaValues = transactionStability?.totalDelta || {};
  const resetState = transactionStability?.end?.state || {};
  const detail = (pass, value) => ({ pass: !!pass, detail: value });
  const details = {
    dynamicPhaseCoverage: detail(missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${phases.length} required transition windows captured`),
    dynamicFrameCoverage: detail(minimumFrames >= 2, `minimum ${minimumFrames} retained rAF deltas; budget >= 2`),
    dynamicAverageFps: detail(minimumAvgFps >= 30, `minimum ${minimumAvgFps} FPS; budget >= 30 FPS`),
    dynamicP99Frame: detail(maximumP99 <= 100, `maximum ${maximumP99} ms; budget <= 100 ms`),
    dynamicWorstFrame: detail(maximumWorst <= 250, `maximum ${maximumWorst} ms; budget <= 250 ms`),
    dynamicHeapHighWater: detail(
      heapHighWaterComplete && maximumHeapExcess <= HEAP_TRANSIENT_EXCESS_BUDGET_MIB,
      heapHighWaterComplete
        ? `maximum ${maximumHeapExcess} MiB live-heap draw-up above the same-run matched-duration active-monitor control; trace coverage tolerance <= ${HEAP_TRACE_COVERAGE_TOLERANCE_MS} ms and budget <= +${HEAP_TRANSIENT_EXCESS_BUDGET_MIB} MiB excess`
        : 'one or more required dynamic windows lack a qualified finite matched-duration heap control measurement',
    ),
    transactionPostGcHeap: detail(
      Number.isFinite(deltaValues.postGcHeapMiB) && deltaValues.postGcHeapMiB <= 4,
      `${deltaValues.postGcHeapMiB} MiB retained-heap delta from one approved-card cleanup to the next method-matched approved-card cleanup; budget <= +4 MiB growth`,
    ),
    transactionResetState: detail(
      resetState.active === true
        && resetState.workspace === 'monitor'
        && resetState.transactionNumber == null
        && resetState.transactionStage == null
        && resetState.customerCount === 0
        && resetState.drawerOpen === false,
      JSON.stringify(resetState),
    ),
    transactionListeners: detail(deltaValues.listeners === 0, `${deltaValues.listeners} listeners; budget 0`),
    transactionDom: detail(deltaValues.domElements === 0, `${deltaValues.domElements} DOM elements; budget 0`),
    transactionSceneNodes: detail(
      Math.abs(deltaValues.liveSceneObjects ?? Infinity) <= 4
        && Math.abs(deltaValues.liveSceneMeshes ?? Infinity) <= 4,
      `${deltaValues.liveSceneObjects}/${deltaValues.liveSceneMeshes} scene objects/meshes across the repeated sale; budget <= 4 each`,
    ),
    transactionLiveResources: detail(
      Math.abs(deltaValues.liveGeometries ?? Infinity) <= 2
        && Math.abs(deltaValues.liveMaterials ?? Infinity) <= 2
        && Math.abs(deltaValues.liveTextures ?? Infinity) <= 2,
      `${deltaValues.liveGeometries}/${deltaValues.liveMaterials}/${deltaValues.liveTextures} geometry/material/texture across the repeated sale; budget <= 2 each`,
    ),
    transactionRepeatRendererResidency: detail(
      Math.abs(deltaValues.rendererGeometries ?? Infinity) <= 2
        && Math.abs(deltaValues.rendererTextures ?? Infinity) <= 2,
      `${deltaValues.rendererGeometries}/${deltaValues.rendererTextures} renderer geometry/texture across the method-matched repeated sale; budget <= 2 each`,
    ),
    transactionRendererResidency: detail(
      Math.abs(totalDeltaValues.rendererGeometries ?? Infinity) <= 200
        && Math.abs(totalDeltaValues.rendererTextures ?? Infinity) <= 32,
      `${totalDeltaValues.rendererGeometries}/${totalDeltaValues.rendererTextures} renderer geometry/texture across the three-sale envelope; first-use residency budget <= 200/32`,
    ),
    storedBaseline: detail(
      baselineComparison?.pass !== false,
      baselineComparison?.available
        ? baselineComparison.qualified
          ? `matched static comparison ${baselineComparison.pass ? 'passed' : 'failed'}`
          : 'stored comparison retained but not judged because protocol qualification failed'
        : 'no stored baseline available; gate not judged',
    ),
  };
  return { pass: Object.values(details).every((entry) => entry.pass), details };
}

export function buildStaticPerformanceGateReport(result) {
  const scenes = result?.scenes || {};
  const sampleSummary = (sample) => summarizeFrames(
    Array.isArray(sample?.frameTimesMs) ? sample.frameTimesMs : [],
  );
  const sceneMedian = (sceneKey, metric) => median(
    (Array.isArray(scenes[sceneKey]?.samples) ? scenes[sceneKey].samples : [])
      .map((sample) => sampleSummary(sample)?.[metric]),
  );
  const idleAverageFps = sceneMedian('idleMonitor', 'avgFps');
  const activeAverageFps = sceneMedian('activeMonitor', 'avgFps');
  const idleOnePercentLowFps = sceneMedian('idleMonitor', 'onePercentLowFps');
  const activeOnePercentLowFps = sceneMedian('activeMonitor', 'onePercentLowFps');
  const averageFpsComparison = delta(idleAverageFps, activeAverageFps);
  const onePercentLowComparison = delta(idleOnePercentLowFps, activeOnePercentLowFps);
  const finiteCameraDistance = (paths) => {
    const differences = paths.map(([group, field]) => {
      const idleValue = scenes.idleMonitor?.camera?.[group]?.[field];
      const activeValue = scenes.activeMonitor?.camera?.[group]?.[field];
      return Number.isFinite(idleValue) && Number.isFinite(activeValue)
        ? activeValue - idleValue
        : Infinity;
    });
    return differences.every(Number.isFinite) ? Math.hypot(...differences) : Infinity;
  };
  const cameraPositionDistance = finiteCameraDistance([
    ['position', 'x'], ['position', 'y'], ['position', 'z'],
  ]);
  const cameraQuaternionDistance = finiteCameraDistance([
    ['quaternion', 'x'], ['quaternion', 'y'], ['quaternion', 'z'], ['quaternion', 'w'],
  ]);
  const idleFov = scenes.idleMonitor?.camera?.fovDegrees;
  const activeFov = scenes.activeMonitor?.camera?.fovDegrees;
  const cameraFovDelta = Number.isFinite(idleFov) && Number.isFinite(activeFov)
    ? activeFov - idleFov
    : Infinity;
  const workspaceMedians = BASELINE_SCENES.map((key) => ({
    key,
    avgFps: sceneMedian(key, 'avgFps'),
    worstFrameMs: sceneMedian(key, 'worstFrameMs'),
  }));
  const workspaceMetricsComplete = workspaceMedians.every((scene) => (
    Number.isFinite(scene.avgFps) && Number.isFinite(scene.worstFrameMs)
  ));
  const minimumMedianSampleAvg = workspaceMetricsComplete
    ? Math.min(...workspaceMedians.map((scene) => scene.avgFps))
    : null;
  const maximumMedianSampleWorst = workspaceMetricsComplete
    ? Math.max(...workspaceMedians.map((scene) => scene.worstFrameMs))
    : null;
  const staticUiRates = ['idleMonitor', 'activeMonitor'].flatMap((key) => {
    const rates = scenes[key]?.ui?.perSecond || {};
    return ['frontDeskMonitor', 'scannerStatus', 'cashWorkspace', 'cardTerminal']
      .map((metric) => rates[metric]);
  });
  const staticUiRate = staticUiRates.length > 0 && staticUiRates.every(Number.isFinite)
    ? Math.max(...staticUiRates)
    : Infinity;
  const reentrySamples = Array.isArray(result?.reentryLeak?.samples)
    ? result.reentryLeak.samples
    : [];
  const reentryStart = reentrySamples[0];
  const reentryEnd = reentrySamples.at(-1);
  const reentryDifference = (read, places = null) => {
    const before = read(reentryStart);
    const after = read(reentryEnd);
    if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
    const value = after - before;
    return places == null ? value : round(value, places);
  };
  const reentryDelta = {
    heapMiB: reentryDifference((sample) => sample?.heap?.jsHeapUsedMiB, 3),
    listeners: reentryDifference((sample) => sample?.listeners?.total),
    domElements: reentryDifference((sample) => sample?.dom?.elements),
    liveGeometries: reentryDifference((sample) => sample?.liveSceneResources?.geometries),
    liveMaterials: reentryDifference((sample) => sample?.liveSceneResources?.materials),
    liveTextures: reentryDifference((sample) => sample?.liveSceneResources?.textures),
    rendererGeometries: reentryDifference(
      (sample) => sample?.liveSceneResources?.rendererMemory?.geometries,
    ),
    rendererTextures: reentryDifference(
      (sample) => sample?.liveSceneResources?.rendererMemory?.textures,
    ),
  };
  const errors = result?.errors || {};
  const errorCount = (key) => Array.isArray(errors[key]) ? errors[key].length : Infinity;
  const nonBenignRequestFailureCount = Array.isArray(errors.failedRequests)
    ? errors.failedRequests.filter((entry) => !/ERR_ABORTED/.test(String(entry?.error || ''))).length
    : Infinity;
  const detail = (pass, value) => ({ pass: !!pass, detail: value });
  const sampleCount = result?.protocol?.sampleCount;
  const reentryCycles = result?.protocol?.reentryCycles;
  const details = {
    cameraMatch: detail(
      cameraPositionDistance <= 0.002
        && cameraQuaternionDistance <= 0.002
        && Math.abs(cameraFovDelta) <= 0.02,
      `position ${round(cameraPositionDistance, 6)}, quaternion ${round(cameraQuaternionDistance, 6)}, FOV ${round(cameraFovDelta, 6)} degrees`,
    ),
    activeMonitorAverageFps: detail(
      Number.isFinite(averageFpsComparison.percent) && averageFpsComparison.percent >= -35,
      `${averageFpsComparison.percent}% versus idle; budget >= -35%`,
    ),
    activeMonitorOnePercentLow: detail(
      Number.isFinite(onePercentLowComparison.percent)
        && onePercentLowComparison.percent >= -40,
      `${onePercentLowComparison.percent}% versus idle; budget >= -40%`,
    ),
    everyWorkspaceAverageFps: detail(
      workspaceMetricsComplete && minimumMedianSampleAvg >= 30,
      `minimum median-of-${sampleCount} sample average ${minimumMedianSampleAvg} FPS; budget >= 30 FPS`,
    ),
    everyWorkspaceWorstFrame: detail(
      workspaceMetricsComplete && maximumMedianSampleWorst <= 100,
      `maximum median-of-${sampleCount} sample worst ${maximumMedianSampleWorst} ms; budget <= 100 ms`,
    ),
    reentryHeap: detail(
      Number.isFinite(reentryDelta.heapMiB) && Math.abs(reentryDelta.heapMiB) <= 2,
      `${reentryDelta.heapMiB} MiB after ${reentryCycles} cycles; budget <= 2 MiB absolute growth`,
    ),
    reentryListeners: detail(
      reentryDelta.listeners === 0,
      `${reentryDelta.listeners} listeners after ${reentryCycles} cycles; budget 0`,
    ),
    reentryDom: detail(
      reentryDelta.domElements === 0,
      `${reentryDelta.domElements} elements after ${reentryCycles} cycles; budget 0`,
    ),
    reentryLiveResources: detail(
      reentryDelta.liveGeometries === 0
        && reentryDelta.liveMaterials === 0
        && reentryDelta.liveTextures === 0,
      `${reentryDelta.liveGeometries}/${reentryDelta.liveMaterials}/${reentryDelta.liveTextures} geometry/material/texture; budget 0/0/0`,
    ),
    reentryRendererMemory: detail(
      Number.isFinite(reentryDelta.rendererGeometries)
        && Number.isFinite(reentryDelta.rendererTextures)
        && Math.abs(reentryDelta.rendererGeometries) <= 2
        && Math.abs(reentryDelta.rendererTextures) <= 2,
      `${reentryDelta.rendererGeometries}/${reentryDelta.rendererTextures} geometry/texture; budget <= 2 lazy resources each`,
    ),
    staticUiFrequency: detail(
      staticUiRate <= 5,
      `maximum known register full-canvas clear rate ${staticUiRate}/s in static monitor scenes; budget <= 5/s`,
    ),
    runtimeErrors: detail(
      errorCount('consoleErrors') === 0
        && errorCount('pageErrors') === 0
        && errorCount('httpErrors') === 0,
      `${errorCount('consoleErrors')} console errors, ${errorCount('pageErrors')} page errors, ${errorCount('httpErrors')} HTTP errors`,
    ),
    requestFailures: detail(
      nonBenignRequestFailureCount === 0,
      `${nonBenignRequestFailureCount} non-benign failures recomputed from raw request failures`,
    ),
  };
  return {
    pass: Object.values(details).every((entry) => entry.pass),
    details,
    derived: {
      cameraPositionDistance: round(cameraPositionDistance, 6),
      cameraQuaternionDistance: round(cameraQuaternionDistance, 6),
      cameraFovDelta: round(cameraFovDelta, 6),
      averageFpsComparison,
      onePercentLowComparison,
      workspaceMedians,
      reentryDelta,
      staticUiRate: round(staticUiRate),
    },
  };
}

async function boot(page) {
  await page.goto(BASE_URL);
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(900);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    if (!clubhouse) return false;
    const merchReady = typeof clubhouse.assetsReady !== 'function' || clubhouse.assetsReady();
    const equipmentReady = typeof clubhouse.deliveryEquipmentReady !== 'function'
      || clubhouse.deliveryEquipmentReady();
    return merchReady && equipmentReady;
  }, null, { timeout: 60000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  // Give the onReady integration callbacks and their first composed render a
  // deterministic settle before the idle baseline is allowed to start.
  await page.waitForTimeout(1200);
}

async function configureFixture(page) {
  return page.evaluate((skuIds) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72,
      tempLoF: 54,
      rainIn: 0,
      humidity: 0.48,
      windMph: 5,
    };
    if (!app.state.uiPrefs || typeof app.state.uiPrefs !== 'object') app.state.uiPrefs = {};
    app.state.uiPrefs.checkout = {
      largeTextAndTargets: false,
      reducedCameraMotion: false,
      fasterAnimations: false,
      automaticExactChange: false,
      confirmCashPurchase: true,
    };
    app.state.shop.simpleCheckout = false;
    for (const skuId of skuIds) {
      const inventory = app.state.shop.inventory[skuId];
      inventory.shelf = Math.max(12, inventory.shelf || 0);
      inventory.back = Math.max(0, inventory.back || 0);
    }
    app.state.shop.markup.accessories = 1.15;
    app.state.shop.markup.apparel = 1.15;
    clubhouse.rebuildStock();
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    app.scene3d.walk.clearKeys();

    // The same normal first-person position used by the simplified acceptance route.
    // Pressing E from here lets production register.enter() own the actual camera pose/FOV.
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 + clubhouse.interior.position.x;
    walk.z = 5.35 + clubhouse.interior.position.z;
    walk.yaw = 0;
    walk.pitch = -0.18;

    return {
      fixture: 'Willow Creek bootstrap, paused at 2 PM, clear weather, deterministic three-item retail customer, default tactile checkout accessibility settings',
      interiorOffset: {
        x: clubhouse.interior.position.x,
        y: clubhouse.interior.position.y,
        z: clubhouse.interior.position.z,
      },
      walk: { x: walk.x, z: walk.z, yaw: walk.yaw, pitch: walk.pitch },
    };
  }, ITEMS);
}

async function installUiInstrumentation(page) {
  await page.evaluate(() => {
    const dimensions = {
      '1024x640': 'frontDeskMonitor',
      '640x256': 'scannerStatus',
      '512x360': 'cashWorkspace',
      '384x256': 'cardTerminal',
    };
    window.__simplifiedRegisterPerf = {
      counters: {
        frontDeskMonitor: 0,
        scannerStatus: 0,
        cashWorkspace: 0,
        cardTerminal: 0,
        otherFullCanvasClears: 0,
      },
      reset() {
        for (const key of Object.keys(this.counters)) this.counters[key] = 0;
      },
    };
    const prototype = CanvasRenderingContext2D.prototype;
    if (!prototype.__simplifiedRegisterPerfWrapped) {
      const originalFillRect = prototype.fillRect;
      const originalClearRect = prototype.clearRect;
      const record = (context, x, y, width, height) => {
        const perf = window.__simplifiedRegisterPerf;
        if (!perf || x !== 0 || y !== 0 || width !== context.canvas.width || height !== context.canvas.height) return;
        const key = dimensions[`${width}x${height}`];
        if (key) perf.counters[key]++;
        else perf.counters.otherFullCanvasClears++;
      };
      prototype.fillRect = function simplifiedRegisterPerfFillRect(x, y, width, height) {
        record(this, x, y, width, height);
        return originalFillRect.apply(this, arguments);
      };
      prototype.clearRect = function simplifiedRegisterPerfClearRect(x, y, width, height) {
        record(this, x, y, width, height);
        return originalClearRect.apply(this, arguments);
      };
      Object.defineProperty(prototype, '__simplifiedRegisterPerfWrapped', { value: true });
    }
  });
}

async function waitForCameraStable(page, timeout = 12000) {
  await page.evaluate(() => { window.__simplifiedPerfCameraProbe = null; });
  await page.waitForFunction(() => {
    const camera = window.__fw.scene3d.camera;
    const now = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      qx: camera.quaternion.x,
      qy: camera.quaternion.y,
      qz: camera.quaternion.z,
      qw: camera.quaternion.w,
      fov: camera.fov,
    };
    const old = window.__simplifiedPerfCameraProbe;
    if (!old) {
      window.__simplifiedPerfCameraProbe = { ...now, stable: 0 };
      return false;
    }
    const movement = Math.hypot(
      now.x - old.x,
      now.y - old.y,
      now.z - old.z,
      now.qx - old.qx,
      now.qy - old.qy,
      now.qz - old.qz,
      now.qw - old.qw,
      (now.fov - old.fov) / 100,
    );
    const stable = movement < 0.0002 ? old.stable + 1 : 0;
    window.__simplifiedPerfCameraProbe = { ...now, stable };
    return stable >= 8;
  }, null, { timeout, polling: 'raf' });
}

async function cameraSnapshot(page) {
  return page.evaluate(() => {
    const camera = window.__fw.scene3d.camera;
    return {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      quaternion: {
        x: camera.quaternion.x,
        y: camera.quaternion.y,
        z: camera.quaternion.z,
        w: camera.quaternion.w,
      },
      fovDegrees: camera.fov,
      near: camera.near,
      far: camera.far,
    };
  });
}

async function heapSnapshot(page, cdp, collect = true) {
  let collectionSucceeded = !collect;
  if (collect) {
    try {
      await cdp.send('HeapProfiler.collectGarbage');
      collectionSucceeded = true;
    } catch (_) {
      collectionSucceeded = false;
    }
  }
  const response = await cdp.send('Performance.getMetrics');
  const metrics = Object.fromEntries(response.metrics.map((metric) => [metric.name, metric.value]));
  const memory = await page.evaluate(() => performance.memory ? {
    used: performance.memory.usedJSHeapSize,
    total: performance.memory.totalJSHeapSize,
    limit: performance.memory.jsHeapSizeLimit,
  } : null);
  const used = metrics.JSHeapUsedSize ?? memory?.used ?? null;
  return {
    source: collect
      ? 'Chrome DevTools Protocol Performance.getMetrics after an immediate explicit HeapProfiler.collectGarbage request'
      : 'Chrome DevTools Protocol Performance.getMetrics without an immediately preceding explicit collection',
    explicitGcRequested: collect,
    explicitGcImmediatelyBeforeRead: collect && collectionSucceeded,
    jsHeapUsedBytes: used,
    jsHeapUsedMiB: used == null ? null : round(used / 1048576),
    jsHeapTotalBytes: metrics.JSHeapTotalSize ?? memory?.total ?? null,
    domNodes: metrics.Nodes ?? null,
    documents: metrics.Documents ?? null,
    layoutObjects: metrics.LayoutObjects ?? null,
  };
}

async function listenerSnapshot(cdp) {
  const objectGroup = `simplified-register-perf-${Date.now()}`;
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: '[window, document, ...document.querySelectorAll("*")]',
    objectGroup,
    returnByValue: false,
  });
  const properties = await cdp.send('Runtime.getProperties', {
    objectId: evaluated.result.objectId,
    ownProperties: true,
  });
  const targets = properties.result
    .filter((property) => /^\d+$/.test(property.name) && property.value?.objectId)
    .map((property) => property.value.objectId);
  const all = [];
  for (let index = 0; index < targets.length; index += 30) {
    const batch = targets.slice(index, index + 30);
    const found = await Promise.all(batch.map(async (objectId) => {
      try {
        return (await cdp.send('DOMDebugger.getEventListeners', { objectId })).listeners;
      } catch (_) {
        return [];
      }
    }));
    all.push(...found.flat());
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup }).catch(() => {});
  const byType = {};
  for (const listener of all) byType[listener.type] = (byType[listener.type] || 0) + 1;
  return {
    source: 'CDP DOMDebugger.getEventListeners over window, document, and every current DOM Element',
    targetsInspected: targets.length,
    total: all.length,
    byType,
    unmeasured: 'Listeners on non-DOM EventTargets that are unreachable through CDP enumeration',
  };
}

async function domSnapshot(page) {
  return page.evaluate(() => ({
    source: 'document.querySelectorAll counts in the isolated QA page',
    elements: document.querySelectorAll('*').length,
    canvases: document.querySelectorAll('canvas').length,
    bodyChildren: document.body.children.length,
    registerModeClass: document.body.classList.contains('register-mode'),
    shopOverlaysVisible: [...document.querySelectorAll('.shop-overlay')]
      .filter((element) => getComputedStyle(element).display !== 'none').length,
  }));
}

async function sceneResourceSnapshot(page) {
  return page.evaluate(() => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    const textureKeys = [
      'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
      'emissiveMap', 'alphaMap', 'lightMap', 'envMap',
    ];
    let objects = 0;
    let meshes = 0;
    app.scene3d.scene.traverse((object) => {
      objects++;
      if (!object.isMesh) return;
      meshes++;
      if (object.geometry) geometries.add(object.geometry.uuid);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of textureKeys) if (material[key]) textures.add(material[key].uuid);
      }
    });
    return {
      source: 'Unique live THREE scene resource UUIDs plus WebGLRenderer.info.memory',
      objects,
      meshes,
      geometries: geometries.size,
      materials: materials.size,
      textures: textures.size,
      rendererMemory: {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      },
    };
  });
}

export function summarizeRenderFrameDistribution(frames) {
  const retained = (frames || []).filter((frame) => Number.isFinite(frame?.calls));
  if (!retained.length) throw new Error('A render snapshot must retain at least one complete frame.');
  const nonShadow = retained.filter((frame) => frame.scheduledShadowBake === false);
  const typical = nonShadow.length ? nonShadow : retained;
  const distribution = (key, values = retained) => {
    const sorted = values.map((frame) => frame[key]).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return { min: null, median: null, p95: null, max: null };
    return {
      min: round(sorted[0]),
      median: round(median(sorted)),
      p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
      max: round(sorted[sorted.length - 1]),
    };
  };
  const typicalMetric = (key) => round(median(typical.map((frame) => frame[key])));
  return {
    drawCalls: typicalMetric('calls'),
    renderedTriangles: typicalMetric('triangles'),
    renderedLines: typicalMetric('lines'),
    renderedPoints: typicalMetric('points'),
    frameDistribution: {
      frameCount: retained.length,
      typicalFrameCount: typical.length,
      typicalBasis: nonShadow.length
        ? 'median of frames whose course shadow-bake counter did not advance'
        : 'median of all retained frames because a shadow-bake counter was unavailable',
      scheduledShadowFrameCount: retained.filter((frame) => frame.scheduledShadowBake === true).length,
      unknownShadowFrameCount: retained.filter((frame) => frame.scheduledShadowBake == null).length,
      calls: distribution('calls'),
      triangles: distribution('triangles'),
      nonShadowCalls: distribution('calls', nonShadow),
      scheduledShadowCalls: distribution(
        'calls',
        retained.filter((frame) => frame.scheduledShadowBake === true),
      ),
      frames: retained,
    },
  };
}

async function renderSnapshot(page) {
  const raw = await page.evaluate((captureFrameCount) => new Promise((resolve) => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const renderer = app.scene3d.renderer;
    const isWorldVisible = (object) => {
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    };
    const previousAutoReset = renderer.info.autoReset;
    const frames = [];
    requestAnimationFrame(() => {
      renderer.info.autoReset = false;
      renderer.info.reset();
      let previousShadowBakes = app.scene3d.post.stats?.().shadowBakes ?? null;
      const captureFrame = () => {
        const render = { ...renderer.info.render };
        const shadowBakes = app.scene3d.post.stats?.().shadowBakes ?? null;
        frames.push({
          calls: render.calls,
          triangles: render.triangles,
          lines: render.lines,
          points: render.points,
          shadowBakes,
          scheduledShadowBake: Number.isFinite(shadowBakes) && Number.isFinite(previousShadowBakes)
            ? shadowBakes > previousShadowBakes
            : null,
        });
        previousShadowBakes = shadowBakes;
        renderer.info.reset();
        if (frames.length < captureFrameCount) {
          requestAnimationFrame(captureFrame);
          return;
        }
        const geometries = new Set();
        const materials = new Set();
        const textures = new Map();
        const textureKeys = [
          'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
          'emissiveMap', 'alphaMap', 'lightMap', 'envMap',
        ];
        let visibleMeshes = 0;
        let sceneTrianglesBeforeFrustumCulling = 0;
        scene.traverse((object) => {
          if (!object.isMesh || !isWorldVisible(object)) return;
          visibleMeshes++;
          if (object.geometry) {
            geometries.add(object.geometry.uuid);
            const triangles = object.geometry.index
              ? object.geometry.index.count / 3
              : (object.geometry.attributes?.position?.count || 0) / 3;
            sceneTrianglesBeforeFrustumCulling += triangles * (object.isInstancedMesh ? object.count : 1);
          }
          const list = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of list) {
            if (!material) continue;
            materials.add(material.uuid);
            for (const key of textureKeys) {
              const texture = material[key];
              if (texture) textures.set(texture.uuid, texture);
            }
          }
        });
        let estimatedTextureBytes = 0;
        let textureDimensionsKnown = 0;
        for (const texture of textures.values()) {
          const image = texture.image || texture.source?.data;
          const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
          const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
          if (!width || !height) continue;
          textureDimensionsKnown++;
          estimatedTextureBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
        }
        renderer.info.autoReset = previousAutoReset;
        resolve({
          frames,
          visibleSceneMeshes: visibleMeshes,
          sceneTrianglesBeforeFrustumCulling: Math.round(sceneTrianglesBeforeFrustumCulling),
          uniqueVisibleGeometries: geometries.size,
          uniqueVisibleMaterials: materials.size,
          uniqueVisibleTextures: textures.size,
          geometriesInRendererMemory: renderer.info.memory.geometries,
          texturesInRendererMemory: renderer.info.memory.textures,
          estimatedVisibleTextureBytes: Math.round(estimatedTextureBytes),
          estimatedVisibleTextureMiB: Math.round(estimatedTextureBytes / 1048576 * 1000) / 1000,
          textureDimensionsKnown,
          textureMemoryQualification: 'Estimate assumes RGBA8 and a complete mip chain when mip generation is enabled; exact GPU allocation is unavailable from WebGL.',
        });
      };
      requestAnimationFrame(captureFrame);
    });
  }), RENDER_CAPTURE_FRAME_COUNT);
  return {
    source: `THREE.WebGLRenderer.info across ${RENDER_CAPTURE_FRAME_COUNT} consecutive complete composed frames; primary calls/triangles are the non-shadow median`,
    ...summarizeRenderFrameDistribution(raw.frames),
    ...Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'frames')),
  };
}

async function sampleFrameTimes(page, durationMs) {
  return page.evaluate((ms) => new Promise((resolve) => {
    const values = [];
    let started = null;
    let previous = null;
    const frame = (now) => {
      if (started == null) {
        started = now;
        previous = now;
      } else {
        values.push(now - previous);
        previous = now;
      }
      if (now - started >= ms) resolve(values);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), durationMs);
}

async function cdpPerformanceSnapshot(cdp) {
  const response = await cdp.send('Performance.getMetrics');
  const metrics = Object.fromEntries(response.metrics.map((metric) => [metric.name, metric.value]));
  return {
    source: 'Chrome DevTools Protocol Performance.getMetrics',
    timestampSeconds: metrics.Timestamp ?? null,
    taskDurationSeconds: metrics.TaskDuration ?? null,
    scriptDurationSeconds: metrics.ScriptDuration ?? null,
    layoutDurationSeconds: metrics.LayoutDuration ?? null,
    recalcStyleDurationSeconds: metrics.RecalcStyleDuration ?? null,
    jsEventListeners: metrics.JSEventListeners ?? null,
    nodes: metrics.Nodes ?? null,
    documents: metrics.Documents ?? null,
  };
}

async function checkoutStateSnapshot(page) {
  return page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const register = clubhouse.register;
    const tx = register.getTx();
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
    return {
      active: register.isActive(),
      workspace: register.workspace(),
      transactionNumber: tx?.number ?? null,
      transactionStage: tx?.stage ?? null,
      checkoutFlowState: tx?.checkoutFlow?.state ?? null,
      deliveryPhase: register.deliveryPhase?.() ?? null,
      drawerOpen: !!tx?.drawerOpen,
      tenderDeposited: !!tx?.deposited,
      customerCount: customers.length,
      sceneChildren: window.__fw.scene3d.scene.children.length,
      drawerPrewarm: register.drawerPrewarmStatus?.() ?? null,
      cashGpuPrewarm: register.cashGpuPrewarmStatus?.() ?? null,
    };
  });
}

async function dynamicBoundarySnapshot(page, cdp, { collectGarbage = false } = {}) {
  return {
    state: await checkoutStateSnapshot(page),
    camera: await cameraSnapshot(page),
    heap: await heapSnapshot(page, cdp, collectGarbage),
    listeners: await listenerSnapshot(cdp),
    dom: await domSnapshot(page),
    liveSceneResources: await sceneResourceSnapshot(page),
    browserWork: await cdpPerformanceSnapshot(cdp),
  };
}

export async function captureNormalizedTransactionBoundary(
  page,
  cdp,
  {
    settleMs = RUN_CONFIG.gcSettleMs,
    captureSnapshot = dynamicBoundarySnapshot,
  } = {},
) {
  const diagnostics = await page.evaluate(() => {
    const perf = window.__simplifiedRegisterPerf;
    const dynamic = perf?.dynamic || null;
    const wasRunning = dynamic?.running === true;
    if (wasRunning) {
      throw new Error('Cannot normalize a transaction boundary while the dynamic probe is running.');
    }
    const result = {
      available: !!perf,
      cleared: !!dynamic,
      wasRunning,
      frameSamples: Array.isArray(dynamic?.frameTimesMs) ? dynamic.frameTimesMs.length : 0,
      stateSamples: Array.isArray(dynamic?.stateTimeline) ? dynamic.stateTimeline.length : 0,
      heapSamples: Array.isArray(dynamic?.heapSampleTimeline)
        ? dynamic.heapSampleTimeline.length : 0,
    };
    if (perf) perf.dynamic = null;
    return result;
  });
  let preSettleExplicitGcSucceeded = false;
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    preSettleExplicitGcSucceeded = true;
  } catch (_) {
    preSettleExplicitGcSucceeded = false;
  }
  await page.waitForTimeout(settleMs);
  const boundary = await captureSnapshot(page, cdp, { collectGarbage: true });
  return {
    ...boundary,
    heapNormalization: {
      kind: 'clear-diagnostics-precollect-settle-final-immediate-gc',
      settleMs,
      dynamicDiagnosticsAvailable: diagnostics.available,
      dynamicDiagnosticsCleared: diagnostics.cleared,
      dynamicDiagnosticsWasRunning: diagnostics.wasRunning,
      clearedFrameSamples: diagnostics.frameSamples,
      clearedStateSamples: diagnostics.stateSamples,
      clearedHeapSamples: diagnostics.heapSamples,
      preSettleExplicitGcSucceeded,
      finalExplicitGcImmediatelyBeforeRead:
        boundary?.heap?.explicitGcImmediatelyBeforeRead === true,
    },
  };
}

export async function startDynamicProbe(page) {
  await page.evaluate(() => {
    const perf = window.__simplifiedRegisterPerf;
    perf.reset();
    if (perf.dynamic?.running) throw new Error('A dynamic performance probe is already running.');
    const startedAt = performance.now();
    const startHeapBytes = Number.isFinite(performance.memory?.usedJSHeapSize)
      ? performance.memory.usedJSHeapSize
      : null;
    const state = {
      running: true,
      startedAt,
      previousAt: null,
      stoppedAt: null,
      frameTimesMs: [],
      heapSamplesBytes: startHeapBytes == null ? [] : [startHeapBytes],
      heapSampleTimeline: startHeapBytes == null
        ? []
        : [{ atMs: startedAt, usedHeapBytes: startHeapBytes, boundary: 'start' }],
      stateTimeline: [],
      longTasks: [],
      observer: null,
      longTaskSupported: false,
    };
    if (typeof PerformanceObserver !== 'undefined'
        && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({
            name: entry.name,
            startTimeMs: entry.startTime,
            durationMs: entry.duration,
          });
        }
      });
      state.observer.observe({ entryTypes: ['longtask'] });
      state.longTaskSupported = true;
    }
    const frame = (now) => {
      if (!state.running) return;
      // A requestAnimationFrame callback receives the previous frame's high-
      // resolution timestamp. It can therefore be a few milliseconds earlier
      // than performance.now() captured immediately before scheduling this
      // first callback. The explicit zero-time boundary owns that interval;
      // skip any pre-boundary rAF instead of emitting a negative/duplicate
      // elapsed sample that would make trace coverage unverifiable.
      if (now <= state.startedAt) {
        requestAnimationFrame(frame);
        return;
      }
      const usedHeapBytes = Number.isFinite(performance.memory?.usedJSHeapSize)
        ? performance.memory.usedJSHeapSize
        : null;
      if (state.previousAt != null) {
        const frameTimeMs = now - state.previousAt;
        state.frameTimesMs.push(frameTimeMs);
        const clubhouse = window.__fw?.scene3d?.clubhouse?.();
        const register = clubhouse?.register;
        const tx = register?.getTx?.();
        const customers = clubhouse
          ? (typeof clubhouse.customers === 'function'
            ? clubhouse.customers()
            : Array.isArray(clubhouse.customers) ? clubhouse.customers : [])
          : [];
        state.stateTimeline.push({
          frameTimeMs,
          atMs: now,
          active: register?.isActive?.() ?? false,
          workspace: register?.workspace?.() ?? null,
          transactionNumber: tx?.number ?? null,
          transactionStage: tx?.stage ?? null,
          checkoutFlowState: tx?.checkoutFlow?.state ?? null,
          deliveryPhase: register?.deliveryPhase?.() ?? null,
          drawerOpen: !!tx?.drawerOpen,
          tenderDeposited: !!tx?.deposited,
          customerCount: customers.length,
          sceneChildren: window.__fw?.scene3d?.scene?.children?.length ?? null,
          usedHeapBytes,
        });
      }
      state.previousAt = now;
      if (usedHeapBytes != null) {
        state.heapSamplesBytes.push(usedHeapBytes);
        state.heapSampleTimeline.push({ atMs: now, usedHeapBytes });
      }
      requestAnimationFrame(frame);
    };
    perf.dynamic = state;
    requestAnimationFrame(frame);
  });
}

async function stopDynamicProbe(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const state = window.__simplifiedRegisterPerf.dynamic;
    if (!state?.running) throw new Error('No dynamic performance probe is running.');
    state.running = false;
    state.stoppedAt = performance.now();
    const stopHeapBytes = Number.isFinite(performance.memory?.usedJSHeapSize)
      ? performance.memory.usedJSHeapSize
      : null;
    if (stopHeapBytes != null) {
      const previous = state.heapSampleTimeline.at(-1);
      if (!previous || state.stoppedAt > previous.atMs) {
        state.heapSamplesBytes.push(stopHeapBytes);
        state.heapSampleTimeline.push({
          atMs: state.stoppedAt,
          usedHeapBytes: stopHeapBytes,
          boundary: 'stop',
        });
      } else if (state.stoppedAt === previous.atMs) {
        previous.usedHeapBytes = stopHeapBytes;
        previous.boundary = previous.boundary === 'start' ? 'start-stop' : 'stop';
        state.heapSamplesBytes[state.heapSamplesBytes.length - 1] = stopHeapBytes;
      }
    }
    if (state.observer) {
      for (const entry of state.observer.takeRecords()) {
        state.longTasks.push({
          name: entry.name,
          startTimeMs: entry.startTime,
          durationMs: entry.duration,
        });
      }
      state.observer.disconnect();
    }
    requestAnimationFrame(() => resolve({
      startedAt: state.startedAt,
      stoppedAt: state.stoppedAt,
      frameTimesMs: [...state.frameTimesMs],
      heapSamplesBytes: [...state.heapSamplesBytes],
      heapSampleTimeline: state.heapSampleTimeline.map((sample) => ({ ...sample })),
      stateTimeline: [...state.stateTimeline],
      longTasks: [...state.longTasks],
      longTaskSupported: state.longTaskSupported,
      uiCounts: { ...window.__simplifiedRegisterPerf.counters },
    }));
  }));
}

function difference(after, before) {
  return after == null || before == null ? null : round(after - before);
}

function stableRecordEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function qualifyHeapControl(control) {
  const before = control?.stateBefore || {};
  const after = control?.stateAfter || {};
  const stateFields = [
    'active', 'workspace', 'transactionNumber', 'transactionStage',
    'checkoutFlowState', 'deliveryPhase', 'drawerOpen', 'tenderDeposited',
    'customerCount', 'sceneChildren',
  ];
  const endpointStateComplete = stateFields.every((field) => (
    Object.hasOwn(before, field) && Object.hasOwn(after, field)
  ));
  const endpointStateStable = endpointStateComplete
    && stateFields.every((field) => before[field] === after[field]);
  const timeline = Array.isArray(control?.stateTimeline) ? control.stateTimeline : [];
  const timelineStateComplete = timeline.length >= 2 && timeline.every((entry, index) => (
    stateFields.every((field) => Object.hasOwn(entry || {}, field))
      && Number.isFinite(entry?.atMs)
      && Number.isFinite(entry?.frameTimeMs)
      && entry.frameTimeMs > 0
      && (index === 0 || entry.atMs > timeline[index - 1].atMs)
  ));
  const timelineStateStable = timelineStateComplete && timeline.every((entry) => (
    stateFields.every((field) => entry[field] === before[field])
  ));
  const beforeCamera = control?.cameraBefore;
  const afterCamera = control?.cameraAfter;
  const cameraValues = beforeCamera && afterCamera ? [
    beforeCamera.position.x - afterCamera.position.x,
    beforeCamera.position.y - afterCamera.position.y,
    beforeCamera.position.z - afterCamera.position.z,
    beforeCamera.quaternion.x - afterCamera.quaternion.x,
    beforeCamera.quaternion.y - afterCamera.quaternion.y,
    beforeCamera.quaternion.z - afterCamera.quaternion.z,
    beforeCamera.quaternion.w - afterCamera.quaternion.w,
    beforeCamera.fovDegrees - afterCamera.fovDegrees,
  ] : [Infinity];
  const cameraStable = cameraValues.every(
    (value) => Number.isFinite(value) && Math.abs(value) <= 1e-6,
  );
  const drawerPrewarmStable = stableRecordEqual(before.drawerPrewarm, after.drawerPrewarm);
  const cashGpuPrewarmStable = stableRecordEqual(before.cashGpuPrewarm, after.cashGpuPrewarm);
  const prewarmReady = before.drawerPrewarm?.complete === true
    && after.drawerPrewarm?.complete === true
    && before.cashGpuPrewarm?.ready === true
    && after.cashGpuPrewarm?.ready === true;
  const beforeResources = control?.resources?.before;
  const afterResources = control?.resources?.after;
  const liveResourceFields = ['objects', 'meshes', 'geometries', 'materials', 'textures'];
  const resourcesStable = !!beforeResources && !!afterResources
    && liveResourceFields.every((field) => (
      Number.isFinite(beforeResources[field])
        && Number.isFinite(afterResources[field])
        && beforeResources[field] === afterResources[field]
    ))
    && ['geometries', 'textures'].every((field) => (
      Number.isFinite(beforeResources.rendererMemory?.[field])
        && Number.isFinite(afterResources.rendererMemory?.[field])
        && beforeResources.rendererMemory[field] === afterResources.rendererMemory[field]
    ));
  const listenerStable = Number.isFinite(control?.stability?.listeners)
    && control.stability.listeners === 0;
  const domStable = Number.isFinite(control?.stability?.domElements)
    && control.stability.domElements === 0;
  const qualified = endpointStateStable
    && timelineStateStable
    && cameraStable
    && drawerPrewarmStable
    && cashGpuPrewarmStable
    && prewarmReady
    && resourcesStable
    && listenerStable
    && domStable;
  return {
    qualified,
    endpointStateComplete,
    endpointStateStable,
    timelineStateComplete,
    timelineStateStable,
    cameraStable,
    drawerPrewarmStable,
    cashGpuPrewarmStable,
    prewarmReady,
    resourcesStable,
    listenerStable,
    domStable,
    timelineSamples: timeline.length,
  };
}

function digestAllocationProfile(profile, limit = 20) {
  const rows = [];
  const visit = (node) => {
    if (!node) return;
    const frame = node.callFrame || {};
    if (Number.isFinite(node.selfSize) && node.selfSize > 0) {
      rows.push({
        selfBytes: node.selfSize,
        function: frame.functionName || '(anonymous)',
        source: frame.url || '',
        line: Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : null,
        column: Number.isFinite(frame.columnNumber) ? frame.columnNumber + 1 : null,
      });
    }
    for (const child of node.children || []) visit(child);
  };
  visit(profile?.head);
  rows.sort((a, b) => b.selfBytes - a.selfBytes);
  return {
    source: 'CDP HeapProfiler sampling with objects collected by both minor and major GC retained for allocation-pressure diagnosis',
    samplingIntervalBytes: 16384,
    sampleCount: Array.isArray(profile?.samples) ? profile.samples.length : 0,
    totalSelfBytes: rows.reduce((sum, row) => sum + row.selfBytes, 0),
    top: rows.slice(0, limit),
  };
}

async function captureDynamicPhase(page, cdp, key, label, action, options = {}) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await page.waitForTimeout(RUN_CONFIG.gcSettleMs);
  const before = await dynamicBoundarySnapshot(page, cdp, { collectGarbage: false });
  let allocationProfile = null;
  let allocationSamplingStarted = false;
  if (RUN_CONFIG.allocationSampling) {
    await cdp.send('HeapProfiler.startSampling', {
      samplingInterval: 16384,
      stackDepth: 64,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    allocationSamplingStarted = true;
  }
  await startDynamicProbe(page);
  let recording;
  try {
    await action();
    await page.waitForTimeout(options.tailMs ?? RUN_CONFIG.dynamicTailMs);
  } finally {
    try {
      recording = await stopDynamicProbe(page).catch(() => null);
    } finally {
      if (allocationSamplingStarted) {
        const sampled = await cdp.send('HeapProfiler.stopSampling');
        allocationProfile = digestAllocationProfile(sampled?.profile);
      }
    }
  }
  assert(recording, `Dynamic phase ${key} did not return a frame recording.`);
  const roundedFrames = recording.frameTimesMs.map((value) => round(value));
  const aggregate = summarizeFrames(roundedFrames);
  const observedDurationMs = recording.startedAt == null
    ? 0
    : recording.stoppedAt - recording.startedAt;
  const uiDurationMs = Math.max(aggregate.durationMs || observedDurationMs || 0, 0.001);
  const ui = {
    source: 'Page-local CanvasRenderingContext2D full-canvas clear/fill instrumentation during the live transition',
    durationMs: round(uiDurationMs, 1),
    counts: recording.uiCounts,
    perSecond: Object.fromEntries(Object.entries(recording.uiCounts).map(([name, count]) => [
      name,
      round(count * 1000 / uiDurationMs),
    ])),
  };
  const heapTimeline = recording.heapSampleTimeline.map((sample) => ({
    elapsedMs: round(sample.atMs - recording.startedAt),
    usedHeapBytes: sample.usedHeapBytes,
    boundary: sample.boundary || null,
  }));
  const heapSummary = summarizeHeapTrace(heapTimeline);
  const heapCalibration = options.heapControl
    ? buildMatchedHeapCalibration(heapTimeline, options.heapControl.heapTimeline, {
      dynamicDurationMs: observedDurationMs,
      controlDurationMs: options.heapControl.heapHighWater?.durationMs,
      controlStateStable: options.heapControl.stateStable,
    })
    : null;
  const heapPeakEntry = recording.stateTimeline.reduce((peak, entry) => (
    Number.isFinite(entry.usedHeapBytes)
      && (!peak || entry.usedHeapBytes > peak.usedHeapBytes)
      ? entry
      : peak
  ), null);
  const afterWithoutGc = await dynamicBoundarySnapshot(page, cdp, { collectGarbage: false });
  const render = await renderSnapshot(page);
  const screenshot = `dynamic-${key}.png`;
  await page.screenshot({ path: path.join(OUT, screenshot) });
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await page.waitForTimeout(RUN_CONFIG.gcSettleMs);
  const afterPostGc = await dynamicBoundarySnapshot(page, cdp, { collectGarbage: false });
  return {
    key,
    label,
    stateBefore: before.state,
    stateAfter: afterWithoutGc.state,
    cameraBefore: before.camera,
    cameraAfter: afterWithoutGc.camera,
    aggregate,
    frameTimesMs: roundedFrames,
    heapTimeline,
    stateTimeline: recording.stateTimeline.map((entry) => ({
      ...entry,
      frameTimeMs: round(entry.frameTimeMs),
      atMs: round(entry.atMs),
    })),
    frameTimingSource: 'requestAnimationFrame deltas recorded continuously while normal mouse/keyboard actions and their production animations ran',
    longTasks: {
      source: 'PerformanceObserver longtask entries during the dynamic window',
      supported: recording.longTaskSupported,
      count: recording.longTasks.length,
      totalDurationMs: round(recording.longTasks.reduce((sum, entry) => sum + entry.durationMs, 0)),
      entries: recording.longTasks.map((entry) => ({
        ...entry,
        startTimeMs: round(entry.startTimeMs),
        durationMs: round(entry.durationMs),
      })),
    },
    heapHighWater: {
      source: 'performance.memory.usedJSHeapSize sampled once per animation frame; raw absolute values are Chromium-only diagnostics and are not forced-GC normalized',
      durationMs: round(observedDurationMs, 1),
      ...heapSummary,
      calibration: heapCalibration,
      peakAt: heapPeakEntry ? {
        atMs: round(heapPeakEntry.atMs),
        usedHeapBytes: heapPeakEntry.usedHeapBytes,
        workspace: heapPeakEntry.workspace,
        transactionStage: heapPeakEntry.transactionStage,
        checkoutFlowState: heapPeakEntry.checkoutFlowState,
        deliveryPhase: heapPeakEntry.deliveryPhase,
        drawerOpen: heapPeakEntry.drawerOpen,
        tenderDeposited: heapPeakEntry.tenderDeposited,
        customerCount: heapPeakEntry.customerCount,
      } : null,
    },
    allocationProfile,
    browserWorkDelta: {
      taskDurationSeconds: difference(
        afterWithoutGc.browserWork.taskDurationSeconds,
        before.browserWork.taskDurationSeconds,
      ),
      scriptDurationSeconds: difference(
        afterWithoutGc.browserWork.scriptDurationSeconds,
        before.browserWork.scriptDurationSeconds,
      ),
      layoutDurationSeconds: difference(
        afterWithoutGc.browserWork.layoutDurationSeconds,
        before.browserWork.layoutDurationSeconds,
      ),
      recalcStyleDurationSeconds: difference(
        afterWithoutGc.browserWork.recalcStyleDurationSeconds,
        before.browserWork.recalcStyleDurationSeconds,
      ),
    },
    render,
    resources: {
      before: before.liveSceneResources,
      after: afterWithoutGc.liveSceneResources,
      afterPostGc: afterPostGc.liveSceneResources,
    },
    stability: {
      postGcHeapMiB: difference(afterPostGc.heap.jsHeapUsedMiB, before.heap.jsHeapUsedMiB),
      listeners: difference(afterPostGc.listeners.total, before.listeners.total),
      domElements: difference(afterPostGc.dom.elements, before.dom.elements),
      liveSceneObjects: difference(
        afterPostGc.liveSceneResources.objects,
        before.liveSceneResources.objects,
      ),
      liveGeometries: difference(
        afterPostGc.liveSceneResources.geometries,
        before.liveSceneResources.geometries,
      ),
      liveMaterials: difference(
        afterPostGc.liveSceneResources.materials,
        before.liveSceneResources.materials,
      ),
      liveTextures: difference(
        afterPostGc.liveSceneResources.textures,
        before.liveSceneResources.textures,
      ),
    },
    ui,
    screenshot,
    limitations: {
      gcAttribution: 'V8 GC event timing is not exposed by the stable Web Performance APIs used here. Heap high-water, long tasks, and retained raw frame spikes are measured, but a spike is not silently attributed to GC.',
      instrumentationOverhead: 'The dynamic recorder stores one compact checkout-state record per animation frame. Frame and heap measurements therefore include this small, consistent QA overhead and are conservative relative to uninstrumented play.',
    },
  };
}

function deriveDynamicSubphase(source, key, label, predicate, qualification) {
  const selectedTimeline = source.stateTimeline.filter(predicate);
  const frames = selectedTimeline.map((entry) => entry.frameTimeMs);
  return {
    ...source,
    key,
    label,
    aggregate: summarizeFrames(frames),
    frameTimesMs: frames,
    stateTimeline: selectedTimeline,
    sharedMeasurementWindow: {
      sourceKey: source.key,
      sourceLabel: source.label,
      qualification,
      resourceEnvelope: 'Resource, heap-high-water, listener, DOM, UI, render, and screenshot values describe the enclosing uninterrupted window; rAF frame percentiles describe only frames whose live checkout state matched this subphase.',
    },
  };
}

async function captureScene(page, cdp, key, label) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await page.waitForTimeout(RUN_CONFIG.gcSettleMs);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(RUN_CONFIG.warmupMs);
  await page.evaluate(() => window.__simplifiedRegisterPerf.reset());
  const samples = [];
  for (let index = 0; index < RUN_CONFIG.sampleCount; index++) {
    const frameTimesMs = await sampleFrameTimes(page, RUN_CONFIG.sampleMs);
    samples.push({
      index: index + 1,
      summary: summarizeFrames(frameTimesMs),
      frameTimesMs: frameTimesMs.map((value) => round(value)),
    });
  }
  const pooled = samples.flatMap((sample) => sample.frameTimesMs);
  const durationMs = pooled.reduce((sum, value) => sum + value, 0);
  const uiCounts = await page.evaluate(() => ({ ...window.__simplifiedRegisterPerf.counters }));
  const ui = {
    source: 'Page-local CanvasRenderingContext2D full-canvas clear/fill instrumentation',
    durationMs: round(durationMs, 1),
    counts: uiCounts,
    perSecond: Object.fromEntries(Object.entries(uiCounts).map(([name, count]) => [
      name,
      round(count * 1000 / durationMs),
    ])),
    qualification: 'Counts full-canvas clear/fill operations by known simplified-register canvas dimensions; it is not a general browser paint counter.',
  };
  const scene = {
    key,
    label,
    workspace: await page.evaluate(() => window.__fw.scene3d.clubhouse().register.workspace()),
    transactionStage: await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx()?.stage || null),
    camera: await cameraSnapshot(page),
    samples,
    aggregate: summarizeFrames(pooled),
    render: await renderSnapshot(page),
    heap: await heapSnapshot(page, cdp, true),
    listeners: await listenerSnapshot(cdp),
    dom: await domSnapshot(page),
    liveSceneResources: await sceneResourceSnapshot(page),
    ui,
    screenshot: `${key}.png`,
  };
  await page.screenshot({ path: path.join(OUT, scene.screenshot) });
  return scene;
}

async function stabilitySnapshot(page, cdp, cycle) {
  await page.waitForTimeout(250);
  return {
    cycle,
    camera: await cameraSnapshot(page),
    heap: await heapSnapshot(page, cdp, true),
    listeners: await listenerSnapshot(cdp),
    dom: await domSnapshot(page),
    liveSceneResources: await sceneResourceSnapshot(page),
    transactionNumber: await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx()?.number || null),
    transactionStage: await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx()?.stage || null),
  };
}

async function monitorClick(page, action) {
  await page.waitForFunction((id) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.monitorScreenPoint(id);
    return register.workspace() === 'monitor' && point && point.inView;
  }, action, { timeout: 10000 });
  const point = await page.evaluate((id) => window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id), action);
  assert(point?.inView, `Monitor action ${action} is outside the production camera.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(180);
}

async function exitFrontDesk(page) {
  // A just-finished receipt/bag camera can still be easing back to the monitor;
  // Escape is intentionally ignored while that production camera owns input.
  // Retry at human cadence until the safe monitor exit becomes available.
  for (let step = 0; step < 24; step += 1) {
    const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
    if (!active) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
  assert(!active, 'Escape did not back out through the shared monitor and leave the front desk.');
}

async function enterFrontDeskAtMonitor(page, transactionNumber = null) {
  await page.keyboard.press('e');
  await page.waitForFunction((number) => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.isActive() && (number == null || register.getTx()?.number === number);
  }, transactionNumber, { timeout: 10000 });
  const workspace = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.workspace());
  if (workspace !== 'monitor') await page.keyboard.press('Escape');
  await page.waitForFunction((number) => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.isActive()
      && register.workspace() === 'monitor'
      && (number == null || register.getTx()?.number === number);
  }, transactionNumber, { timeout: 10000 });
  // Register free-look follows the cursor. Neutralize it on every entry so the
  // idle and active monitor captures compare the exact same pose/quaternion.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  // The action point is projected through the moving production camera. Waiting
  // here prevents a freshly entered monitor click from landing at the button's
  // previous screen position while the camera is still interpolating.
  await waitForCameraStable(page);
}

async function projectObject(page, predicate) {
  return page.evaluate(async (query) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((object) => {
      if (found || !object.visible || !object.userData) return;
      if (query.kind && object.userData.kind !== query.kind) return;
      if (query.uid && object.userData.uid !== query.uid) return;
      if (query.from && object.userData.from !== query.from) return;
      if (query.denom !== undefined
        && Number(object.userData.denom) !== Number(query.denom)) return;
      found = object;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = bounds.isEmpty()
      ? found.getWorldPosition(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3());
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, predicate);
}

async function projectLocal(page, local) {
  return page.evaluate(async (point) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const world = new THREE.Vector3(
      point.x + clubhouse.interior.position.x,
      point.y + clubhouse.interior.position.y,
      point.z + clubhouse.interior.position.z,
    ).project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, local);
}

async function scanAll(page) {
  const itemIds = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid));
  for (const uid of itemIds) {
    let product = await projectObject(page, { kind: 'item', uid });
    // The preceding product's click-to-bag flight can briefly cross the next
    // product. Wait for this visible target to settle before aiming at it.
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(120);
      const next = await projectObject(page, { kind: 'item', uid });
      if (next && product
          && Math.abs(next.x - product.x) < 1.5
          && Math.abs(next.y - product.y) < 1.5) {
        product = next;
        break;
      }
      product = next;
    }
    assert(product?.inView, `${uid} is outside the scanner production camera.`);
    // Production scanning is one click: it rings the item and sends it to the
    // bag. The retired auto-centre + drag gesture must never return to this QA.
    await page.mouse.click(product.x, product.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx?.items.find((item) => item.uid === id)?.scanned;
    }, uid, { timeout: 5000 });
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx?.items.find((item) => item.uid === id)?.staged;
    }, uid, { timeout: 8000 });
    // `staged` is the durable accounting fact and is set when the one-click
    // scan begins. The visible 0.5 s product arc still owns input until its
    // completion state is reached. Wait for that state boundary before aiming
    // at the next product so this performance route cannot manufacture a
    // "missed click" by clicking while production correctly rejects repeats.
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      if (!tx) return false;
      const remaining = tx.items.some((item) => !item.scanned);
      const state = tx.checkoutFlow?.state;
      return remaining ? state === 'WaitingForScan' : state === 'AllProductsScanned';
    }, null, { timeout: 8000 });
  }
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    return register.workspace() === 'monitor' && tx?.items.every((item) => item.scanned && item.staged);
  }, null, { timeout: 7000 });
  await waitForCameraStable(page);
}

async function clickPresentedCard(page) {
  const card = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  assert(card?.inView, 'The presented card is outside the production card camera.');
  await page.mouse.click(card.x, card.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-entry' && tx.checkoutFlow?.state === 'CardAmountEntry';
  }, null, { timeout: 4000 });
}

async function clickCardConfirm(page) {
  const ok = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint('OK')
  ));
  assert(ok?.inView, 'The card reader OK key is outside the production card camera.');
  await page.mouse.click(ok.x, ok.y);
}

async function cashMonitorClick(page, action) {
  await page.waitForFunction((id) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.monitorScreenPoint(id);
    return register.workspace() === 'cash' && point && point.inView;
  }, action, { timeout: 10000 });
  const point = await page.evaluate((id) => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
  ), action);
  assert(point?.inView, `Cash monitor action ${action} is outside the drawer camera.`);
  await page.mouse.click(point.x, point.y);
}

async function selectExactChange(page) {
  const plan = await page.evaluate(async () => {
    const domain = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return domain.makeChangeFrom(
      domain.drawerContents(tx, window.__fw.state.shop.drawer),
      domain.changeDue(tx),
    );
  });
  assert(plan, 'The live drawer could not make exact change for the performance transaction.');
  for (const [rawDenomination, count] of Object.entries(plan)) {
    const denomination = Number(rawDenomination);
    for (let index = 0; index < count; index++) {
      const slot = await projectObject(page, { kind: 'drawer-slot', denom: denomination });
      assert(slot?.inView, `Drawer denomination ${denomination} is outside the production camera.`);
      await page.mouse.click(slot.x, slot.y);
      await page.waitForTimeout(90);
    }
  }
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'cash-drawer' && tx.drawerOpen;
  }, null, { timeout: 3000 });
  const giving = await page.evaluate(async () => {
    const { changeGivingState } = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx ? {
      stage: tx.stage,
      drawerOpen: !!tx.drawerOpen,
      deposited: !!tx.deposited,
      ...changeGivingState(tx),
    } : null;
  });
  assert(giving?.stage === 'cash-drawer' && giving.drawerOpen && giving.deposited
    && giving.state === 'exact',
  `Physical drawer clicks did not count exact change: ${JSON.stringify(giving)}.`);
  return plan;
}

async function waitForAllCustomersRemoved(page, timeout = 22000) {
  await page.waitForFunction(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
    return !clubhouse.register.getTx() && customers.length === 0;
  }, null, { timeout });
}

async function sendPerformanceCustomer(page, method, { exactCashFixture = false } = {}) {
  const customer = await page.evaluate(({ skuIds, payment, cashFixture }) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const created = clubhouse.sendToCounter(skuIds, payment);
    return { created, payment, cashFixture };
  }, { skuIds: ITEMS, payment: method, cashFixture: exactCashFixture });
  assert(customer?.created, `Could not create deterministic ${method} performance customer.`);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.items.length === 3
  ), null, { timeout: 15000 });
  if (exactCashFixture) {
    await page.evaluate(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const prices = [6.90, 9.20, 19.62];
      tx.items.forEach((item, index) => {
        item.price = prices[index];
        item.priceCents = Math.round(prices[index] * 100);
      });
    });
  }
  return customer.created;
}

async function stageApprovedCardSale(page) {
  await exitFrontDesk(page);
  await page.waitForFunction(
    () => !window.__fw.scene3d.clubhouse().register.isActive(),
    null,
    { timeout: 5000 },
  );
  const customer = await sendPerformanceCustomer(page, 'card');
  await enterFrontDeskAtMonitor(page);
  await monitorClick(page, 'start-scanning');
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.workspace() === 'scan'
  ), null, { timeout: 5000 });
  await waitForCameraStable(page);
  await scanAll(page);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-ready' && tx.checkoutFlow?.state === 'CardInsertReady';
  }, null, { timeout: 7000 });
  await waitForCameraStable(page);
  await page.evaluate(() => {
    window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0.99;
  });
  await clickPresentedCard(page);
  return customer;
}

async function completeApprovedCardSale(page) {
  await clickCardConfirm(page);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-busy' && tx.checkoutFlow?.state === 'CardProcessing';
  }, null, { timeout: 4000 });
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'receipt' && tx.checkoutFlow?.state === 'CardApproved';
  }, null, { timeout: 7000 });
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'bag-deliver'
  ), null, { timeout: 12000 });
  await waitForAllCustomersRemoved(page);
}

function transactionBoundaryDelta(before, after) {
  return {
    postGcHeapMiB: difference(after.heap.jsHeapUsedMiB, before.heap.jsHeapUsedMiB),
    listeners: difference(after.listeners.total, before.listeners.total),
    domElements: difference(after.dom.elements, before.dom.elements),
    liveSceneObjects: difference(after.liveSceneResources.objects, before.liveSceneResources.objects),
    liveSceneMeshes: difference(after.liveSceneResources.meshes, before.liveSceneResources.meshes),
    liveGeometries: difference(after.liveSceneResources.geometries, before.liveSceneResources.geometries),
    liveMaterials: difference(after.liveSceneResources.materials, before.liveSceneResources.materials),
    liveTextures: difference(after.liveSceneResources.textures, before.liveSceneResources.textures),
    rendererGeometries: difference(
      after.liveSceneResources.rendererMemory.geometries,
      before.liveSceneResources.rendererMemory.geometries,
    ),
    rendererTextures: difference(
      after.liveSceneResources.rendererMemory.textures,
      before.liveSceneResources.rendererMemory.textures,
    ),
  };
}

export function transactionStabilityReport(start, afterFirstSale, afterWarmSale, end) {
  const firstUseDelta = transactionBoundaryDelta(start, afterFirstSale);
  const pathWarmupDelta = transactionBoundaryDelta(afterFirstSale, afterWarmSale);
  const methodMatchedDelta = transactionBoundaryDelta(afterWarmSale, end);
  const totalDelta = transactionBoundaryDelta(start, end);
  return {
    start,
    afterFirstSale,
    afterWarmSale,
    end,
    firstUseDelta,
    pathWarmupDelta,
    methodMatchedDelta,
    // Compatibility aliases consumed by the existing overlay and summaries.
    // Both now describe the canonical approved-card-to-approved-card comparison.
    repeatSaleDelta: methodMatchedDelta,
    totalDelta,
    delta: methodMatchedDelta,
  };
}

function gitBuildSnapshot() {
  const fingerprint = (relativePath) => {
    const absolute = path.resolve(relativePath);
    if (!fs.existsSync(absolute)) return { path: relativePath, exists: false };
    const bytes = fs.readFileSync(absolute);
    const stat = fs.statSync(absolute);
    return {
      path: relativePath.replace(/\\/g, '/'),
      exists: true,
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  };
  const discoverMeasuredFiles = (relativeDirectory, predicate) => {
    const directory = path.resolve(relativeDirectory);
    if (!fs.existsSync(directory)) return [];
    const files = [];
    const pending = [directory];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(absolute);
        else if (entry.isFile()) {
          const relative = path.relative(process.cwd(), absolute).replace(/\\/g, '/');
          if (predicate(relative)) files.push(relative);
        }
      }
    }
    return files.sort();
  };
  const measuredFiles = [
    'tools/qa/simplified-register-performance.mjs',
    'tools/qa/simplified-register-performance.js',
    'tools/qa/run-playwright.cjs',
    'tools/qa/cashier-build-snapshot.mjs',
    'src/render3d/courseScene.js',
    'src/render3d/clubhouse.js',
    'src/render3d/clubhouse/catalogProductVisual.js',
    'src/render3d/clubhouse/customerFlow.js',
    'src/render3d/clubhouse/customerPaidBag.js',
    'src/render3d/clubhouse/fixtures.js',
    'src/render3d/clubhouse/frontDeskMonitorUi.js',
    'src/render3d/clubhouse/interiorShadowPolicy.js',
    'src/render3d/clubhouse/materials.js',
    'src/render3d/clubhouse/merch.js',
    'src/render3d/clubhouse/resourceLifecycle.js',
    'src/render3d/clubhouse/sharedTexturePool.js',
    'src/render3d/clubhouse/simplifiedRegisterMode.js',
    'src/render3d/clubhouse/registerCameraPoses.js',
    'src/data/fixtureSlots.js',
    'src/data/shopLayout.js',
    'src/sim/register.js',
    'src/sim/registerFlow.js',
    'src/sim/checkoutPreferences.js',
    'vendor/three.module.js',
    'vendor/addons/loaders/GLTFLoader.js',
    'vendor/addons/utils/SkeletonUtils.js',
    'vendor/models/clubhouse/checkout_counter.glb',
    'vendor/models/clubhouse/checkout_product_staging_tray.glb',
    'vendor/models/clubhouse/checkout_change_handoff_tray.glb',
    'vendor/models/checkout/checkout_counter.glb',
    'vendor/models/checkout/pos_monitor.glb',
    'vendor/models/checkout/customer_display.glb',
    'vendor/models/checkout/barcode_scanner.glb',
    'vendor/models/checkout/payment_card.glb',
    'vendor/models/checkout/payment_terminal.glb',
    'vendor/models/checkout/receipt_printer.glb',
    'vendor/models/checkout/loose_receipt.glb',
    'vendor/models/checkout/shopping_bag.glb',
    'vendor/models/checkout/scannable_product_box.glb',
    'vendor/models/checkout/cash_drawer.glb',
    'vendor/models/checkout/cash_bill_50.glb',
    'vendor/models/checkout/cash_bill_20.glb',
    'vendor/models/checkout/cash_bill_10.glb',
    'vendor/models/checkout/cash_bill_5.glb',
    'vendor/models/checkout/cash_bill_1.glb',
    'vendor/models/checkout/cash_coin_50.glb',
    'vendor/models/checkout/cash_coin_20.glb',
    'vendor/models/checkout/cash_coin_10.glb',
    'vendor/models/checkout/cash_coin_05.glb',
    'vendor/models/checkout/cash_coin_01.glb',
    'vendor/models/checkout/cash_coin_05_sheet01.glb',
    ...discoverMeasuredFiles('src/render3d/assets51to100', (file) => file.endsWith('.js')),
    ...discoverMeasuredFiles('vendor/models/checkout', (file) => file.endsWith('.glb')),
  ].filter((file, index, files) => files.indexOf(file) === index)
    .sort()
    .map(fingerprint);
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
    return { head, dirty: status.trim().length > 0, measuredFiles };
  } catch (error) {
    return { head: null, dirty: null, measuredFiles, error: error?.message || String(error) };
  }
}

function readStoredBaseline(baselinePath) {
  if (!baselinePath || !fs.existsSync(baselinePath)) {
    return {
      baseline: null,
      rawText: null,
      provenance: {
        requestedPath: baselinePath,
        exists: false,
      },
    };
  }
  const bytes = fs.readFileSync(baselinePath);
  const stat = fs.statSync(baselinePath);
  const baseline = JSON.parse(bytes.toString('utf8'));
  const trayPaths = [
    path.resolve('vendor/models/clubhouse/checkout_product_staging_tray.glb'),
    path.resolve('vendor/models/clubhouse/checkout_change_handoff_tray.glb'),
  ].filter((candidate) => fs.existsSync(candidate));
  const trayTimes = trayPaths.map((candidate) => ({
    path: path.relative(process.cwd(), candidate).replace(/\\/g, '/'),
    modifiedAt: fs.statSync(candidate).mtime.toISOString(),
  }));
  const generatedMs = Date.parse(baseline.generatedAt || '');
  const earliestTrayMs = trayTimes.length
    ? Math.min(...trayTimes.map((entry) => Date.parse(entry.modifiedAt)))
    : null;
  return {
    baseline,
    rawText: bytes.toString('utf8'),
    provenance: {
      requestedPath: baselinePath,
      path: path.relative(process.cwd(), baselinePath).replace(/\\/g, '/'),
      exists: true,
      bytes: stat.size,
      fileModifiedAt: stat.mtime.toISOString(),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      baselineGeneratedAt: baseline.generatedAt || null,
      trayAssetTimestamps: trayTimes,
      temporallyPredatesCurrentTrayAssets: Number.isFinite(generatedMs)
        && Number.isFinite(earliestTrayMs) ? generatedMs < earliestTrayMs : null,
      qualificationNote: 'Temporal provenance establishes that this stored run predates the current tray GLBs. Runtime judging still requires matched viewport, DPR, browser mode/version, CPU concurrency, GPU, and static sample protocol. The delta is current-build versus pre-tray build and is not presented as tray-only causal attribution.',
    },
  };
}

function markdownReport(result) {
  const sceneRows = Object.values(result.scenes).map((scene) => (
    `| ${scene.label} | ${scene.aggregate.avgFps} | ${scene.aggregate.onePercentLowFps} | ${scene.aggregate.worstFrameMs} | ${scene.render.drawCalls} | ${scene.render.renderedTriangles} | ${scene.render.uniqueVisibleMaterials} | ${scene.render.uniqueVisibleTextures} | ${scene.heap.jsHeapUsedMiB} | ${scene.listeners.total} | ${scene.dom.elements} | ${scene.ui.perSecond.frontDeskMonitor} / ${scene.ui.perSecond.scannerStatus} / ${scene.ui.perSecond.cashWorkspace} / ${scene.ui.perSecond.cardTerminal} | [image](./${scene.screenshot}) |`
  )).join('\n');
  const leakRows = result.reentryLeak.samples.map((sample) => (
    `| ${sample.cycle} | ${sample.heap.jsHeapUsedMiB} | ${sample.listeners.total} | ${sample.dom.elements} | ${sample.liveSceneResources.geometries} / ${sample.liveSceneResources.materials} / ${sample.liveSceneResources.textures} | ${sample.liveSceneResources.rendererMemory.geometries} / ${sample.liveSceneResources.rendererMemory.textures} | ${sample.transactionNumber} | ${sample.transactionStage} |`
  )).join('\n');
  const dynamicRows = REQUIRED_DYNAMIC_PHASES.map((key) => {
    const phase = result.dynamicPhases[key];
    const calibration = phase.heapHighWater.calibration;
    return `| ${phase.label} | ${phase.aggregate.frameCount} | ${phase.aggregate.avgFps} | ${phase.aggregate.onePercentLowFps} | ${phase.aggregate.p95FrameMs} | ${phase.aggregate.p99FrameMs} | ${phase.aggregate.worstFrameMs} | ${phase.render.drawCalls} | ${phase.render.renderedTriangles} | ${phase.render.uniqueVisibleGeometries} / ${phase.render.uniqueVisibleMaterials} / ${phase.render.uniqueVisibleTextures} | ${phase.heapHighWater.peakGrowthMiB} | ${calibration.actionMaxDrawupMiB} / ${calibration.controlMaxDrawupMiB} / ${calibration.excessMaxDrawupMiB} | ${phase.stability.postGcHeapMiB} / ${phase.stability.listeners} / ${phase.stability.domElements} | [image](./${phase.screenshot}) |`;
  }).join('\n');
  const baselineRows = result.storedBaselineComparison.rows.map((row) => (
    `| ${row.scene} | ${row.metric} | ${row.before} | ${row.after} | ${row.absolute} | ${row.percent} | ${row.diagnosticOnly ? 'diagnostic' : row.pass == null ? 'not judged' : row.pass ? 'PASS' : 'FAIL'} |`
  )).join('\n');
  const gateRows = Object.entries(result.gates.details).map(([name, gate]) => (
    `| ${name} | ${gate.pass ? 'PASS' : 'FAIL'} | ${gate.detail} |`
  )).join('\n');
  return `# Simplified register performance capture

Generated: ${result.generatedAt}

This is a current-build, matched-scene feature-overhead capture. The idle baseline is the shared front-desk monitor opened through normal E input with no transaction. The active comparison uses the same production monitor camera with a deterministic three-item transaction. Scanner, card, cash, and open-drawer workspaces are supplemental representative stages.

## Protocol

- Chrome ${result.environment.browserVersion}, ${result.environment.viewport.width}x${result.environment.viewport.height}, DPR ${result.environment.devicePixelRatio}
- Browser mode: ${result.protocol.browserMode}
- Driver profile/schema: ${result.protocol.profile} / v${result.schemaVersion}
- Build: ${result.build.head || 'unavailable'}${result.build.dirty ? ' (dirty worktree)' : ''}
- GPU: ${result.environment.webglRenderer}
- Renderer quality: ${result.environment.rendererQuality.drawingBuffer.width}x${result.environment.rendererQuality.drawingBuffer.height} drawing buffer, pixel ratio ${result.environment.rendererQuality.pixelRatio}, antialias ${result.environment.rendererQuality.antialias}, shadows ${result.environment.rendererQuality.shadowMapEnabled}, shadow type ${result.environment.rendererQuality.shadowMapType}, tone mapping ${result.environment.rendererQuality.toneMapping}, color space ${result.environment.rendererQuality.outputColorSpace}
- Fixture: ${result.fixture.fixture}
- ${result.protocol.sampleCount} x ${result.protocol.sampleMs / 1000}-second rAF samples per scene, after explicit GC, ${result.protocol.gcSettleMs} ms settle, and ${result.protocol.warmupMs / 1000}-second warm-up
- One ${result.protocol.heapControlMs / 1000}-second active-monitor no-action heap control uses the same forced-GC settle, explicit boundary samples, and per-rAF instrumentation as every dynamic window.
- Average FPS = sampled frames / sampled duration. 1% low = inverse mean of the slowest 1% of rAF deltas. Worst frame is the largest retained rAF delta.
- Render counts come from THREE.WebGLRenderer.info over ${result.protocol.renderCaptureFrames} consecutive complete composed frames. Primary calls/triangles are the median of frames without a scheduled 10 Hz course-shadow bake; min/max and shadow-tagged distributions remain in JSON.
- Texture MiB is an estimate, not a GPU allocation measurement.
- Listener totals cover window, document, and current DOM Elements; unreachable non-DOM EventTargets are unmeasured.

## Scene results

| Scene | Avg FPS | 1% low | Worst ms | Draw calls | Triangles | Visible materials | Visible textures | Post-GC heap MiB | Listeners | DOM elements | UI clears/s monitor / scan / cash / card | Evidence |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${sceneRows}

Matched idle-to-active monitor camera delta: ${result.comparison.camera.positionDistance} world units, ${result.comparison.camera.quaternionDistance} quaternion distance, ${result.comparison.camera.fovDeltaDegrees} degrees FOV. FPS comparison gates use the median of ${result.protocol.sampleCount} independent scene sample${result.protocol.sampleCount === 1 ? '' : 's'}; pooled summaries and every raw frame remain in the JSON.

## Dynamic checkout phases

These rAF windows run while the real mouse/keyboard action and production animation are moving. Contiguous automatic state sequences stay under one uninterrupted recorder and are divided by the live transaction/fulfillment state sampled on each frame; their resource envelope remains explicitly shared.

Raw peak growth remains diagnostic. The transient-memory gate uses maximum draw-up from a prior sampled trough and subtracts the matched-duration prefix of the same-run no-action control. Both traces must start at zero, be strictly increasing, and cover the action boundary within ${HEAP_TRACE_COVERAGE_TOLERANCE_MS} ms. Every control timeline state plus endpoint camera, prewarm, and resource residency must remain stable or the gate fails closed. Control: ${result.heapIdleControl.heapHighWater.durationMs} ms, ${result.heapIdleControl.heapHighWater.samples} samples, ${result.heapIdleControl.heapHighWater.maxDrawupMiB} MiB maximum draw-up, qualified ${result.heapIdleControl.stateStable}.

| Phase | Frames | Avg FPS | 1% low | p95 ms | p99 ms | Worst ms | Draw calls | Triangles | Visible geometry / material / texture | Raw heap peak +MiB | Draw-up action / control / excess MiB | Post-GC heap / listener / DOM delta | Evidence |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${dynamicRows}

## Three-sale transaction stability

The complete envelope starts on the no-transaction monitor, completes the declined-card-to-cash coverage sale, then completes two consecutive approved-card sales through the same normal controls. Every retained-heap boundary clears completed QA recorder arrays, performs a pre-collection and settle, and performs a final successful collection immediately before the read. The primary repeat-sale gate compares the two method-matched approved-card cleanup boundaries; total deltas retain one-time renderer residency for diagnosis.

| Boundary delta | Post-GC heap MiB | Listeners / DOM | Scene objects / meshes | Live geometry / material / texture | Renderer geometry / texture |
|---|---:|---:|---:|---:|---:|
| First-use: start to decline-to-cash cleanup | ${result.transactionStability.firstUseDelta.postGcHeapMiB} | ${result.transactionStability.firstUseDelta.listeners} / ${result.transactionStability.firstUseDelta.domElements} | ${result.transactionStability.firstUseDelta.liveSceneObjects} / ${result.transactionStability.firstUseDelta.liveSceneMeshes} | ${result.transactionStability.firstUseDelta.liveGeometries} / ${result.transactionStability.firstUseDelta.liveMaterials} / ${result.transactionStability.firstUseDelta.liveTextures} | ${result.transactionStability.firstUseDelta.rendererGeometries} / ${result.transactionStability.firstUseDelta.rendererTextures} |
| Path warm-up: cash cleanup to approved-card cleanup | ${result.transactionStability.pathWarmupDelta.postGcHeapMiB} | ${result.transactionStability.pathWarmupDelta.listeners} / ${result.transactionStability.pathWarmupDelta.domElements} | ${result.transactionStability.pathWarmupDelta.liveSceneObjects} / ${result.transactionStability.pathWarmupDelta.liveSceneMeshes} | ${result.transactionStability.pathWarmupDelta.liveGeometries} / ${result.transactionStability.pathWarmupDelta.liveMaterials} / ${result.transactionStability.pathWarmupDelta.liveTextures} | ${result.transactionStability.pathWarmupDelta.rendererGeometries} / ${result.transactionStability.pathWarmupDelta.rendererTextures} |
| Method-matched repeat: approved-card cleanup to approved-card cleanup | ${result.transactionStability.methodMatchedDelta.postGcHeapMiB} | ${result.transactionStability.methodMatchedDelta.listeners} / ${result.transactionStability.methodMatchedDelta.domElements} | ${result.transactionStability.methodMatchedDelta.liveSceneObjects} / ${result.transactionStability.methodMatchedDelta.liveSceneMeshes} | ${result.transactionStability.methodMatchedDelta.liveGeometries} / ${result.transactionStability.methodMatchedDelta.liveMaterials} / ${result.transactionStability.methodMatchedDelta.liveTextures} | ${result.transactionStability.methodMatchedDelta.rendererGeometries} / ${result.transactionStability.methodMatchedDelta.rendererTextures} |
| Total: start to sale three | ${result.transactionStability.totalDelta.postGcHeapMiB} | ${result.transactionStability.totalDelta.listeners} / ${result.transactionStability.totalDelta.domElements} | ${result.transactionStability.totalDelta.liveSceneObjects} / ${result.transactionStability.totalDelta.liveSceneMeshes} | ${result.transactionStability.totalDelta.liveGeometries} / ${result.transactionStability.totalDelta.liveMaterials} / ${result.transactionStability.totalDelta.liveTextures} | ${result.transactionStability.totalDelta.rendererGeometries} / ${result.transactionStability.totalDelta.rendererTextures} |

## Stored pre-tray comparison

Available: **${result.storedBaselineComparison.available ? 'yes' : 'no'}**. Qualified for judging: **${result.storedBaselineComparison.qualified ? 'yes' : 'no'}**. Verdict: **${result.storedBaselineComparison.pass == null ? 'NOT JUDGED' : result.storedBaselineComparison.pass ? 'PASS' : 'FAIL'}**.

${result.storedBaselineComparison.reason} ${result.storedBaselineComparison.dynamicComparison.reason}

| Scene | Metric | Before | Current | Delta | Delta % | Verdict |
|---|---|---:|---:|---:|---:|---|
${baselineRows || '| n/a | n/a | n/a | n/a | n/a | n/a | not available |'}

## Re-entry stability

The probe performs ${result.protocol.reentryCycles} normal Escape/E leave/re-enter cycles while preserving the same live transaction.

| Cycle | Post-GC heap MiB | Listeners | DOM elements | Live geometry / material / texture | Renderer geometry / texture | Tx # | Stage |
|---:|---:|---:|---:|---:|---:|---:|---|
${leakRows}

Final deltas: heap ${result.reentryLeak.delta.heapMiB >= 0 ? '+' : ''}${result.reentryLeak.delta.heapMiB} MiB; listeners ${result.reentryLeak.delta.listeners >= 0 ? '+' : ''}${result.reentryLeak.delta.listeners}; DOM ${result.reentryLeak.delta.domElements >= 0 ? '+' : ''}${result.reentryLeak.delta.domElements}; live geometry/material/texture ${result.reentryLeak.delta.liveGeometries}/${result.reentryLeak.delta.liveMaterials}/${result.reentryLeak.delta.liveTextures}; renderer geometry/texture ${result.reentryLeak.delta.rendererGeometries}/${result.reentryLeak.delta.rendererTextures}.

## Gates

| Gate | Result | Detail |
|---|---|---|
${gateRows}

Overall proposed-budget verdict: **${result.gates.pass ? 'PASS' : 'FAIL'}**.

The tolerances are local QA budgets, not repository product requirements: median-sample active monitor average FPS no more than 35% below idle, median-sample 1% low no more than 40% below idle, every static and dynamic phase at least 30 FPS, static median sample-max no more than 100 ms, dynamic p99 no more than 100 ms and dynamic absolute worst no more than 250 ms, exact production-camera match, matched-control transient heap excess no more than +${HEAP_TRANSIENT_EXCESS_BUDGET_MIB} MiB, bounded method-matched approved-card forced-GC heap growth, stable listeners/DOM/live resources, no console/page/HTTP/non-benign request errors, and the matched stored-baseline tolerances recorded in JSON.

## Limitations

- ${result.protocol.browserMode === 'headed' ? 'Headed' : 'Headless'} Chrome rAF timing reflects this host, browser, viewport, and current background load; it is not a multi-hardware benchmark.
- The worst-frame gate uses the median of ${result.protocol.sampleCount} per-scene sample ${result.protocol.sampleCount === 1 ? 'maximum' : 'maxima'} so a recurrent game stall fails while an isolated host/driver scheduling pause remains visible in the raw absolute worst-frame metric.
- Exact GPU texture allocation and GPU frame time are unavailable through WebGL; visible texture bytes are explicitly estimated as RGBA8 with mip assumptions.
- The listener probe cannot enumerate inaccessible non-DOM EventTargets.
- The re-entry probe covers camera/input ownership; the separate three-sale envelope measures completed checkout cleanup and gates the two method-matched approved-card cleanups. The master-cardinality lifecycle stress remains a separate driver.
- Stable Web Performance APIs do not expose attributed V8 GC event timing; raw frame spikes, long tasks, heap high-water, and forced-GC boundaries are measured without silently labeling a spike as GC.
- Raw live-heap magnitudes and GC-cycle timing are browser-specific. Only same-run matched-duration excess is gated; the complete control/action timelines and raw absolute peaks remain in JSON.
- Canvas clear instrumentation reports update frequency for known register canvas dimensions, not compositor paints or total UI CPU time.

Raw samples and metric sources are retained in [simplified-register-performance.json](./simplified-register-performance.json), with focused extracts in [dynamic-phase-metrics.json](./dynamic-phase-metrics.json), [transaction-stability.json](./transaction-stability.json), [stored-baseline-comparison.json](./stored-baseline-comparison.json), and the byte-preserved [stored-pre-tray-baseline.json](./stored-pre-tray-baseline.json).
`;
}

export async function runSimplifiedRegisterPerformance(page, options = {}) {
  const productionBuildBefore = captureCashierBuildSnapshot();
  RUN_CONFIG = resolvePerformanceConfig(options);
  const viewportRun = configureViewport(options.viewport
    || process.env.REGISTER_PERF_VIEWPORT
    || process.env.REGISTER_QA_VIEWPORT
    || process.env.QA_VIEWPORT);
  const outBase = path.resolve(process.env.REGISTER_PERF_ROOT
    || 'qa/cash-register-production/simplified-rebuild/performance');
  OUT = viewportRun.explicit ? path.join(outBase, viewportRun.tag) : outBase;
  fs.mkdirSync(OUT, { recursive: true });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const httpErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));
  page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push({
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
    });
  });

  await boot(page);
  const fixture = await configureFixture(page);
  await installUiInstrumentation(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  const environment = await page.evaluate(() => {
    const app = window.__fw;
    const gl = app.scene3d.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      url: location.href,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory || null,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      webglVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      webglRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      rendererQuality: {
        cssViewport: { width: innerWidth, height: innerHeight },
        drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
        pixelRatio: app.scene3d.renderer.getPixelRatio(),
        antialias: !!gl.getContextAttributes()?.antialias,
        shadowMapEnabled: !!app.scene3d.renderer.shadowMap.enabled,
        shadowMapType: app.scene3d.renderer.shadowMap.type,
        toneMapping: app.scene3d.renderer.toneMapping,
        outputColorSpace: app.scene3d.renderer.outputColorSpace,
      },
    };
  });
  environment.browserVersion = await page.context().browser().version();

  // Idle is the normal shared monitor with no transaction; production owns the camera.
  await enterFrontDeskAtMonitor(page);
  assert(!await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx()), 'Idle monitor unexpectedly has a transaction.');
  await waitForCameraStable(page);
  const scenes = {};
  scenes.idleMonitor = await captureScene(page, cdp, '01-idle-monitor', 'Idle shared monitor');
  const transactionStart = await captureNormalizedTransactionBoundary(page, cdp);

  await exitFrontDesk(page);
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 5000 });
  const customer = await sendPerformanceCustomer(page, 'card', { exactCashFixture: true });
  await enterFrontDeskAtMonitor(page);
  assert(await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx()?.items.length === 3), 'Active monitor lost the three-item transaction.');
  await waitForCameraStable(page);
  scenes.activeMonitor = await captureScene(page, cdp, '02-active-monitor', 'Active three-item monitor');

  const reentrySamples = [await stabilitySnapshot(page, cdp, 0)];
  const transactionNumber = reentrySamples[0].transactionNumber;
  for (let cycle = 1; cycle <= RUN_CONFIG.reentryCycles; cycle++) {
    await exitFrontDesk(page);
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 3000 });
    await page.waitForTimeout(45);
    await enterFrontDeskAtMonitor(page, transactionNumber);
    await page.waitForTimeout(70);
    if (cycle % 5 === 0 || cycle === RUN_CONFIG.reentryCycles) {
      reentrySamples.push(await stabilitySnapshot(page, cdp, cycle));
    }
  }
  const leakStart = reentrySamples[0];
  const leakEnd = reentrySamples[reentrySamples.length - 1];
  const reentryLeak = {
    cycles: RUN_CONFIG.reentryCycles,
    samples: reentrySamples,
    delta: {
      heapMiB: round(leakEnd.heap.jsHeapUsedMiB - leakStart.heap.jsHeapUsedMiB),
      listeners: leakEnd.listeners.total - leakStart.listeners.total,
      domElements: leakEnd.dom.elements - leakStart.dom.elements,
      liveGeometries: leakEnd.liveSceneResources.geometries - leakStart.liveSceneResources.geometries,
      liveMaterials: leakEnd.liveSceneResources.materials - leakStart.liveSceneResources.materials,
      liveTextures: leakEnd.liveSceneResources.textures - leakStart.liveSceneResources.textures,
      rendererGeometries: leakEnd.liveSceneResources.rendererMemory.geometries - leakStart.liveSceneResources.rendererMemory.geometries,
      rendererTextures: leakEnd.liveSceneResources.rendererMemory.textures - leakStart.liveSceneResources.rendererMemory.textures,
    },
  };

  const heapIdleControl = await captureDynamicPhase(
    page,
    cdp,
    'heapIdleControl',
    'Active-monitor no-action live-heap control',
    async () => page.waitForTimeout(RUN_CONFIG.heapControlMs),
    { tailMs: 0 },
  );
  heapIdleControl.qualification = qualifyHeapControl(heapIdleControl);
  heapIdleControl.stateStable = heapIdleControl.qualification.qualified;

  const dynamicPhases = {};
  const dynamicWindows = {};
  dynamicPhases.overviewProducts = await captureDynamicPhase(
    page,
    cdp,
    'overviewProducts',
    'Monitor-to-products overview and staging camera transition',
    async () => {
      await monitorClick(page, 'start-scanning');
      await page.waitForFunction(() => (
        window.__fw.scene3d.clubhouse().register.workspace() === 'scan'
      ), null, { timeout: 5000 });
      await waitForCameraStable(page);
    },
    { heapControl: heapIdleControl },
  );
  scenes.scanner = await captureScene(page, cdp, '03-scanner', 'Assisted scanner workspace');
  dynamicWindows.scanAndCardHandoff = await captureDynamicPhase(
    page,
    cdp,
    'scanAndCardHandoffWindow',
    'Uninterrupted one-click bagging and automatic customer-card handoff',
    async () => {
      await scanAll(page);
      await page.waitForFunction(() => {
        const register = window.__fw.scene3d.clubhouse().register;
        const tx = register.getTx();
        return register.workspace() === 'card' && tx?.method === 'card' && tx.stage === 'card-ready';
      }, null, { timeout: 7000 });
      await waitForCameraStable(page);
    },
    { heapControl: heapIdleControl },
  );
  dynamicPhases.oneClickBagging = deriveDynamicSubphase(
    dynamicWindows.scanAndCardHandoff,
    'oneClickBagging',
    'Three normal one-click scans and click-to-bag flights',
    (entry) => entry.transactionStage === 'scanning' || entry.workspace === 'scan',
    'Frames selected from the uninterrupted scan/handoff window while scanning or the scan workspace was live.',
  );
  dynamicPhases.cardHandoff = deriveDynamicSubphase(
    dynamicWindows.scanAndCardHandoff,
    'cardHandoff',
    'Automatic customer card presentation and close-reader camera handoff',
    (entry) => entry.workspace === 'card'
      || entry.transactionStage === 'card-present'
      || entry.transactionStage === 'card-ready',
    'Frames selected from the uninterrupted scan/handoff window while payment presentation and the close-reader camera transition were live.',
  );
  scenes.card = await captureScene(page, cdp, '04-card', 'Physical card reader workspace');

  await page.evaluate(() => {
    window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0;
  });
  dynamicPhases.cardInsertion = await captureDynamicPhase(
    page,
    cdp,
    'cardInsertion',
    'One physical card click through automatic insertion and exact-total entry',
    async () => clickPresentedCard(page),
    { heapControl: heapIdleControl },
  );
  scenes.cardEntry = await captureScene(page, cdp, '04b-card-entry', 'Inserted card and active amount keypad');
  dynamicWindows.cardAuthorization = await captureDynamicPhase(
    page,
    cdp,
    'cardAuthorizationWindow',
    'Uninterrupted confirm, processing, declined-result, and monitor-return window',
    async () => {
      await clickCardConfirm(page);
      await page.waitForFunction(() => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return tx?.stage === 'card-busy' && tx.checkoutFlow?.state === 'CardProcessing';
      }, null, { timeout: 4000 });
      await page.waitForFunction(() => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return tx?.stage === 'card-declined' && tx.checkoutFlow?.state === 'CardDeclined';
      }, null, { timeout: 7000 });
      await page.waitForFunction(() => (
        window.__fw.scene3d.clubhouse().register.workspace() === 'monitor'
      ), null, { timeout: 7000 });
      await waitForCameraStable(page);
    },
    { heapControl: heapIdleControl },
  );
  dynamicPhases.cardProcessing = deriveDynamicSubphase(
    dynamicWindows.cardAuthorization,
    'cardProcessing',
    'Card authorization processing frames',
    (entry) => entry.checkoutFlowState === 'CardProcessing' || entry.transactionStage === 'card-busy',
    'Frames selected from the uninterrupted authorization window while CardProcessing/card-busy was live.',
  );
  dynamicPhases.cardResult = deriveDynamicSubphase(
    dynamicWindows.cardAuthorization,
    'cardResult',
    'Declined card result and recovery frames',
    (entry) => entry.checkoutFlowState === 'CardDeclined' || entry.transactionStage === 'card-declined',
    'Frames selected from the uninterrupted authorization window while the declined result was live.',
  );
  dynamicPhases.cashPresentation = await captureDynamicPhase(
    page,
    cdp,
    'cashPresentation',
    'Visible switch-to-cash choice through customer-held tender presentation',
    async () => {
      await monitorClick(page, 'card-to-cash');
      await page.waitForFunction(() => {
        const register = window.__fw.scene3d.clubhouse().register;
        const tx = register.getTx();
        return register.workspace() === 'monitor' && tx?.stage === 'cash-tender';
      }, null, { timeout: 7000 });
      await waitForCameraStable(page);
    },
    { heapControl: heapIdleControl },
  );
  scenes.cash = await captureScene(page, cdp, '05-cash', 'Cash workspace, tender presented');
  const tender = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  assert(tender?.inView, 'Presented cash is outside the production cash camera.');
  dynamicWindows.cashAcceptance = await captureDynamicPhase(
    page,
    cdp,
    'cashAcceptanceWindow',
    'Uninterrupted one-click tender, drawer opening, and automatic deposit window',
    async () => {
      await page.mouse.click(tender.x, tender.y);
      await page.waitForFunction(() => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return tx?.checkoutFlow?.state === 'DrawerOpening';
      }, null, { timeout: 3000 });
      await page.waitForFunction(() => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return tx?.stage === 'cash-drawer' && tx.drawerOpen;
      }, null, { timeout: 5000 });
      await page.waitForFunction(() => (
        window.__fw.scene3d.clubhouse().register.getTx()?.deposited
      ), null, { timeout: 8000 });
      await waitForCameraStable(page);
    },
    { heapControl: heapIdleControl },
  );
  dynamicPhases.cashDrawerOpening = deriveDynamicSubphase(
    dynamicWindows.cashAcceptance,
    'cashDrawerOpening',
    'Cash drawer opening frames',
    (entry) => entry.checkoutFlowState === 'DrawerOpening'
      || (entry.transactionStage === 'cash-drawer' && !entry.drawerOpen),
    'Frames selected from the uninterrupted cash-acceptance window before the drawer reached open.',
  );
  dynamicPhases.cashDeposit = deriveDynamicSubphase(
    dynamicWindows.cashAcceptance,
    'cashDeposit',
    'Accepted tender deposit and drawer-ready frames',
    (entry) => entry.transactionStage === 'cash-drawer' && entry.drawerOpen,
    'Frames selected from the uninterrupted cash-acceptance window while the open drawer accepted tender.',
  );
  scenes.cashDrawer = await captureScene(page, cdp, '06-cash-drawer', 'Cash workspace, drawer open');

  let exactChangePlan = null;
  dynamicPhases.changeSelection = await captureDynamicPhase(
    page,
    cdp,
    'changeSelection',
    'Physical denomination clicks to exact change',
    async () => {
      exactChangePlan = await selectExactChange(page);
    },
    { heapControl: heapIdleControl },
  );
  dynamicWindows.cashFulfillment = await captureDynamicPhase(
    page,
    cdp,
    'cashFulfillmentWindow',
    'Uninterrupted change confirmation, receipt, bag handoff, reset, and customer removal',
    async () => {
      await cashMonitorClick(page, 'confirm-change');
      await page.waitForFunction(() => (
        window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'receipt-print'
      ), null, { timeout: 10000 });
      await page.waitForFunction(() => {
        const phase = window.__fw.scene3d.clubhouse().register.deliveryPhase();
        return phase === 'receipt-deliver' || phase === 'bag-deliver';
      }, null, { timeout: 8000 });
      await page.waitForFunction(() => (
        window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'bag-deliver'
      ), null, { timeout: 8000 });
      await waitForAllCustomersRemoved(page);
    },
    { tailMs: 180, heapControl: heapIdleControl },
  );
  dynamicPhases.receiptPrinting = deriveDynamicSubphase(
    dynamicWindows.cashFulfillment,
    'receiptPrinting',
    'Receipt print and receipt-delivery frames',
    (entry) => entry.deliveryPhase === 'receipt-print' || entry.deliveryPhase === 'receipt-deliver',
    'Frames selected from the uninterrupted fulfillment window during receipt printing or delivery.',
  );
  dynamicPhases.bagHandoff = deriveDynamicSubphase(
    dynamicWindows.cashFulfillment,
    'bagHandoff',
    'Paid-bag customer handoff frames',
    (entry) => entry.deliveryPhase === 'bag-deliver',
    'Frames selected from the uninterrupted fulfillment window during bag-deliver.',
  );
  dynamicPhases.customerCleanup = deriveDynamicSubphase(
    dynamicWindows.cashFulfillment,
    'customerCleanup',
    'Post-settlement reset, departure, and customer removal frames',
    (entry) => entry.transactionStage == null && entry.customerCount > 0,
    'Frames selected after transaction teardown while the paid customer was still departing.',
  );

  // First-use checkout resources are legitimate residency, not repeat-sale
  // leakage. Preserve the mixed decline-to-cash cleanup as a cold-path boundary,
  // then warm and repeat the exact approved-card route before judging retention.
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.isActive() && register.workspace() === 'monitor' && !register.getTx();
  }, null, { timeout: 5000 });
  await waitForCameraStable(page);
  const transactionAfterFirstSale = await captureNormalizedTransactionBoundary(page, cdp);

  const approvedCustomer = await stageApprovedCardSale(page);
  dynamicWindows.cardApproved = await captureDynamicPhase(
    page,
    cdp,
    'cardApprovedWindow',
    'Uninterrupted confirm, approval, receipt/bag delivery, reset, and customer removal',
    async () => completeApprovedCardSale(page),
    { tailMs: 180, heapControl: heapIdleControl },
  );
  dynamicPhases.cardApprovedResult = deriveDynamicSubphase(
    dynamicWindows.cardApproved,
    'cardApprovedResult',
    'Approved card processing and result frames',
    (entry) => entry.checkoutFlowState === 'CardProcessing'
      || entry.checkoutFlowState === 'CardApproved'
      || entry.transactionStage === 'card-busy',
    'Frames selected from the second completed card sale while authorization was processing or approved.',
  );
  dynamicPhases.cardApprovedCleanup = deriveDynamicSubphase(
    dynamicWindows.cardApproved,
    'cardApprovedCleanup',
    'Approved card receipt/bag/reset/customer-cleanup frames',
    (entry) => entry.deliveryPhase != null
      || (entry.transactionStage == null && entry.customerCount > 0),
    'Frames selected from the second completed card sale during delivery and post-transaction cleanup.',
  );
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.isActive() && register.workspace() === 'monitor' && !register.getTx();
  }, null, { timeout: 5000 });
  await waitForCameraStable(page);
  const transactionAfterWarmSale = await captureNormalizedTransactionBoundary(page, cdp);

  const repeatApprovedCustomer = await stageApprovedCardSale(page);
  dynamicWindows.cardApprovedRepeat = await captureDynamicPhase(
    page,
    cdp,
    'cardApprovedRepeatWindow',
    'Method-matched repeat approved-card cleanup for retained-memory judging',
    async () => completeApprovedCardSale(page),
    { tailMs: 180, heapControl: heapIdleControl },
  );
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.isActive() && register.workspace() === 'monitor' && !register.getTx();
  }, null, { timeout: 5000 });
  await waitForCameraStable(page);
  const transactionEnd = await captureNormalizedTransactionBoundary(page, cdp);
  const transactionStability = transactionStabilityReport(
    transactionStart,
    transactionAfterFirstSale,
    transactionAfterWarmSale,
    transactionEnd,
  );

  const cameraPositionDistance = Math.hypot(
    scenes.activeMonitor.camera.position.x - scenes.idleMonitor.camera.position.x,
    scenes.activeMonitor.camera.position.y - scenes.idleMonitor.camera.position.y,
    scenes.activeMonitor.camera.position.z - scenes.idleMonitor.camera.position.z,
  );
  const cameraQuaternionDistance = Math.hypot(
    scenes.activeMonitor.camera.quaternion.x - scenes.idleMonitor.camera.quaternion.x,
    scenes.activeMonitor.camera.quaternion.y - scenes.idleMonitor.camera.quaternion.y,
    scenes.activeMonitor.camera.quaternion.z - scenes.idleMonitor.camera.quaternion.z,
    scenes.activeMonitor.camera.quaternion.w - scenes.idleMonitor.camera.quaternion.w,
  );
  const idleMedian = {
    avgFps: round(median(scenes.idleMonitor.samples.map((sample) => sample.summary.avgFps))),
    onePercentLowFps: round(median(scenes.idleMonitor.samples.map((sample) => sample.summary.onePercentLowFps))),
    worstFrameMs: round(median(scenes.idleMonitor.samples.map((sample) => sample.summary.worstFrameMs))),
  };
  const activeMedian = {
    avgFps: round(median(scenes.activeMonitor.samples.map((sample) => sample.summary.avgFps))),
    onePercentLowFps: round(median(scenes.activeMonitor.samples.map((sample) => sample.summary.onePercentLowFps))),
    worstFrameMs: round(median(scenes.activeMonitor.samples.map((sample) => sample.summary.worstFrameMs))),
  };
  const comparison = {
    basis: `median of ${RUN_CONFIG.sampleCount} independent per-scene sample${RUN_CONFIG.sampleCount === 1 ? '' : 's'}; pooled summaries remain in scenes.*.aggregate`,
    camera: {
      positionDistance: round(cameraPositionDistance, 6),
      quaternionDistance: round(cameraQuaternionDistance, 6),
      fovDeltaDegrees: round(scenes.activeMonitor.camera.fovDegrees - scenes.idleMonitor.camera.fovDegrees, 6),
    },
    avgFps: delta(idleMedian.avgFps, activeMedian.avgFps),
    onePercentLowFps: delta(idleMedian.onePercentLowFps, activeMedian.onePercentLowFps),
    worstFrameMs: delta(idleMedian.worstFrameMs, activeMedian.worstFrameMs),
    pooled: {
      avgFps: delta(scenes.idleMonitor.aggregate.avgFps, scenes.activeMonitor.aggregate.avgFps),
      onePercentLowFps: delta(
        scenes.idleMonitor.aggregate.onePercentLowFps,
        scenes.activeMonitor.aggregate.onePercentLowFps,
      ),
      worstFrameMs: delta(
        scenes.idleMonitor.aggregate.worstFrameMs,
        scenes.activeMonitor.aggregate.worstFrameMs,
      ),
    },
    drawCalls: delta(scenes.idleMonitor.render.drawCalls, scenes.activeMonitor.render.drawCalls),
    renderedTriangles: delta(scenes.idleMonitor.render.renderedTriangles, scenes.activeMonitor.render.renderedTriangles),
    uniqueVisibleMaterials: delta(scenes.idleMonitor.render.uniqueVisibleMaterials, scenes.activeMonitor.render.uniqueVisibleMaterials),
    uniqueVisibleTextures: delta(scenes.idleMonitor.render.uniqueVisibleTextures, scenes.activeMonitor.render.uniqueVisibleTextures),
    estimatedVisibleTextureMiB: delta(scenes.idleMonitor.render.estimatedVisibleTextureMiB, scenes.activeMonitor.render.estimatedVisibleTextureMiB),
    postGcHeapMiB: delta(scenes.idleMonitor.heap.jsHeapUsedMiB, scenes.activeMonitor.heap.jsHeapUsedMiB),
    listeners: delta(scenes.idleMonitor.listeners.total, scenes.activeMonitor.listeners.total),
    domElements: delta(scenes.idleMonitor.dom.elements, scenes.activeMonitor.dom.elements),
  };
  const nonBenignRequestFailures = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
  const workspaceTail = Object.fromEntries(Object.entries(scenes).map(([key, scene]) => [key, {
    medianSampleAvgFps: round(median(scene.samples.map((sample) => sample.summary.avgFps))),
    medianSampleOnePercentLowFps: round(median(
      scene.samples.map((sample) => sample.summary.onePercentLowFps),
    )),
    medianSampleWorstFrameMs: round(median(scene.samples.map((sample) => sample.summary.worstFrameMs))),
    absoluteWorstFrameMs: scene.aggregate.worstFrameMs,
  }]));
  const workspaceTailPass = Object.values(workspaceTail)
    .every((scene) => scene.medianSampleWorstFrameMs <= 100);
  const maximumMedianSampleWorst = Math.max(
    ...Object.values(workspaceTail).map((scene) => scene.medianSampleWorstFrameMs),
  );
  const absoluteObservedWorst = Math.max(
    ...Object.values(workspaceTail).map((scene) => scene.absoluteWorstFrameMs),
  );
  const workspaceFpsPass = Object.values(workspaceTail)
    .every((scene) => scene.medianSampleAvgFps >= 30);
  const minimumMedianSampleAvg = Math.min(
    ...Object.values(workspaceTail).map((scene) => scene.medianSampleAvgFps),
  );
  const staticUiRate = Math.max(
    ...['idleMonitor', 'activeMonitor'].flatMap((key) => {
      const rates = scenes[key].ui.perSecond;
      return [rates.frontDeskMonitor, rates.scannerStatus, rates.cashWorkspace, rates.cardTerminal];
    }),
  );
  const gate = (pass, detail) => ({ pass: !!pass, detail });
  const gateDetails = buildStaticPerformanceGateReport({
    scenes,
    reentryLeak,
    errors: {
      consoleErrors,
      pageErrors,
      failedRequests,
      httpErrors,
      nonBenignRequestFailures,
    },
    protocol: {
      sampleCount: RUN_CONFIG.sampleCount,
      reentryCycles: RUN_CONFIG.reentryCycles,
    },
  }).details;
  const generatedAt = new Date().toISOString();
  const build = gitBuildSnapshot();
  const protocol = {
    baseUrl: BASE_URL,
    viewport: VIEWPORT,
    requiredViewports: REQUIRED_VIEWPORTS,
    browserMode: process.env.HEADED === '1' ? 'headed' : 'headless',
    profile: RUN_CONFIG.profile,
    sampleCount: RUN_CONFIG.sampleCount,
    sampleMs: RUN_CONFIG.sampleMs,
    warmupMs: RUN_CONFIG.warmupMs,
    gcSettleMs: RUN_CONFIG.gcSettleMs,
    reentryCycles: RUN_CONFIG.reentryCycles,
    dynamicTailMs: RUN_CONFIG.dynamicTailMs,
    heapControlMs: RUN_CONFIG.heapControlMs,
    allocationSamplingDiagnostic: RUN_CONFIG.allocationSampling,
    renderCaptureFrames: RENDER_CAPTURE_FRAME_COUNT,
    productionInputRoute: 'E/Escape, physical monitor clicks, one click per product, one click on customer card, physical reader OK, visible decline-to-cash recovery, one click on customer tender, physical drawer denominations, visible confirm-change, automatic receipt/bag/customer cleanup, then two consecutive complete approved-card sales through the same controls',
  };
  const baselineSource = readStoredBaseline(RUN_CONFIG.baselinePath);
  if (baselineSource.rawText) {
    fs.writeFileSync(path.join(OUT, 'stored-pre-tray-baseline.json'), baselineSource.rawText);
  }
  const comparisonSubject = {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    generatedAt,
    protocol,
    environment,
    scenes,
    heapIdleControl,
    dynamicPhases,
  };
  const storedBaselineComparison = buildStoredBaselineComparison(
    baselineSource.baseline,
    comparisonSubject,
    baselineSource.provenance,
  );
  const dynamicGates = buildDynamicGateReport(
    dynamicPhases,
    transactionStability,
    storedBaselineComparison,
    dynamicWindows,
    heapIdleControl,
  );
  Object.assign(gateDetails, Object.fromEntries(
    Object.entries(dynamicGates.details).map(([key, value]) => [`dynamic_${key}`, value]),
  ));
  const result = {
    ok: true,
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    generatedAt,
    build,
    protocol,
    fixture,
    environment,
    customer,
    approvedCustomer,
    repeatApprovedCustomer,
    scenes,
    heapIdleControl,
    dynamicPhases,
    dynamicWindows,
    comparison,
    workspaceTail,
    reentryLeak,
    exactChangePlan,
    transactionStability,
    storedBaselineComparison,
    errors: {
      consoleErrors,
      pageErrors,
      failedRequests,
      httpErrors,
      nonBenignRequestFailures,
    },
    limitations: [
      `${process.env.HEADED === '1' ? 'Headed' : 'Headless'} Chrome measurement on one host; not a multi-device hardware benchmark.`,
      'Texture memory is an RGBA8/mipmap estimate because WebGL does not expose exact GPU allocation.',
      'Listener enumeration excludes inaccessible non-DOM EventTargets.',
      `Re-entry stress covers ${RUN_CONFIG.reentryCycles} safe enter/exit cycles; the separate stability envelope covers one declined-card-to-cash completion plus two consecutive approved-card completions.`,
      'Canvas instrumentation counts known full-canvas operations, not compositor paints or total UI CPU time.',
      'Stable Web Performance APIs do not expose attributed V8 GC event timing. The driver retains raw frame spikes, long tasks, per-frame heap high-water marks, and forced-GC boundary snapshots without claiming which spikes were GC.',
      `The transient heap gate compares each raw action-window draw-up with a duration-matched prefix of one same-run active-monitor no-action control; explicit boundary samples and a ${HEAP_TRACE_COVERAGE_TOLERANCE_MS} ms maximum final-sample gap make incomplete traces fail closed. Raw absolute high-water values remain diagnostic and the repeated-sale forced-GC retention gate remains independent.`,
      'Dynamic heap/frame windows include the small cost of one compact state record per animation frame so automatic transitions can be partitioned without stopping the recorder.',
    ],
  };
  const productionBuildAfter = captureCashierBuildSnapshot({ allowMissing: true });
  const productionBuildComparison = compareCashierBuildSnapshots(
    productionBuildBefore,
    productionBuildAfter,
  );
  result.productionBuildHashes = { ...productionBuildBefore.productionBuildHashes };
  result.productionBuildSnapshot = {
    schemaVersion: productionBuildBefore.schemaVersion,
    algorithm: productionBuildBefore.algorithm,
    beforeCapturedAt: productionBuildBefore.capturedAt,
    afterCapturedAt: productionBuildAfter.capturedAt,
    ...productionBuildComparison,
  };
  gateDetails.productionBuildUnchanged = gate(
    productionBuildComparison.unchanged,
    productionBuildComparison.unchanged
      ? `full cashier production snapshot v${productionBuildBefore.schemaVersion} remained unchanged across ${productionBuildBefore.fileCount} files`
      : `production build changed during performance QA: ${productionBuildComparison.changedFiles
        .map((entry) => `${entry.change}:${entry.path}`).join(', ') || 'aggregate mismatch'}`,
  );
  const schema = validatePerformanceResultSchema(result);
  gateDetails.schemaContract = gate(schema.valid, schema.valid
    ? `schema v${PERFORMANCE_SCHEMA_VERSION} contains all static scenes, ${REQUIRED_DYNAMIC_PHASES.length} required dynamic phases, resource metrics, and stability envelopes`
    : schema.issues.join(' | '));
  result.schemaValidation = schema;
  result.gates = {
    pass: Object.values(gateDetails).every((entry) => entry.pass),
    details: gateDetails,
  };
  result.ok = result.gates.pass;
  fs.writeFileSync(path.join(OUT, 'simplified-register-performance.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(
    path.join(OUT, 'dynamic-phase-metrics.json'),
    JSON.stringify({
      schemaVersion: PERFORMANCE_SCHEMA_VERSION,
      generatedAt,
      protocol,
      heapIdleControl,
      phases: dynamicPhases,
      windows: dynamicWindows,
      gates: dynamicGates,
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(OUT, 'transaction-stability.json'),
    JSON.stringify({
      schemaVersion: PERFORMANCE_SCHEMA_VERSION,
      generatedAt,
      protocol: { gcSettleMs: protocol.gcSettleMs },
      ...transactionStability,
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(OUT, 'stored-baseline-comparison.json'),
    JSON.stringify(storedBaselineComparison, null, 2),
  );
  fs.writeFileSync(path.join(OUT, 'README.md'), markdownReport(result));
  return {
    ok: result.ok,
    out: OUT,
    raw: path.join(OUT, 'simplified-register-performance.json'),
    dynamicRaw: path.join(OUT, 'dynamic-phase-metrics.json'),
    stabilityRaw: path.join(OUT, 'transaction-stability.json'),
    baselineComparisonRaw: path.join(OUT, 'stored-baseline-comparison.json'),
    preservedBaselineRaw: baselineSource.rawText
      ? path.join(OUT, 'stored-pre-tray-baseline.json') : null,
    report: path.join(OUT, 'README.md'),
    comparison,
    heapIdleControl: {
      stateStable: heapIdleControl.stateStable,
      durationMs: heapIdleControl.heapHighWater.durationMs,
      maxDrawupMiB: heapIdleControl.heapHighWater.maxDrawupMiB,
    },
    dynamicPhases: Object.fromEntries(Object.entries(dynamicPhases).map(([key, phase]) => [key, {
      avgFps: phase.aggregate.avgFps,
      onePercentLowFps: phase.aggregate.onePercentLowFps,
      p99FrameMs: phase.aggregate.p99FrameMs,
      worstFrameMs: phase.aggregate.worstFrameMs,
      drawCalls: phase.render.drawCalls,
      renderedTriangles: phase.render.renderedTriangles,
      materials: phase.render.uniqueVisibleMaterials,
      textures: phase.render.uniqueVisibleTextures,
      postGcHeapDeltaMiB: phase.stability.postGcHeapMiB,
      listenerDelta: phase.stability.listeners,
      domDelta: phase.stability.domElements,
    }])),
    workspaces: Object.fromEntries(Object.entries(scenes).map(([key, scene]) => [key, {
      avgFps: scene.aggregate.avgFps,
      onePercentLowFps: scene.aggregate.onePercentLowFps,
      worstFrameMs: scene.aggregate.worstFrameMs,
      drawCalls: scene.render.drawCalls,
      renderedTriangles: scene.render.renderedTriangles,
      materials: scene.render.uniqueVisibleMaterials,
      textures: scene.render.uniqueVisibleTextures,
      postGcHeapMiB: scene.heap.jsHeapUsedMiB,
      listeners: scene.listeners.total,
      domElements: scene.dom.elements,
    }])) ,
    reentryLeak: reentryLeak.delta,
    transactionStability: {
      firstUseDelta: transactionStability.firstUseDelta,
      pathWarmupDelta: transactionStability.pathWarmupDelta,
      methodMatchedDelta: transactionStability.methodMatchedDelta,
      repeatSaleDelta: transactionStability.repeatSaleDelta,
      totalDelta: transactionStability.totalDelta,
      delta: transactionStability.delta,
    },
    storedBaselineComparison: {
      available: storedBaselineComparison.available,
      qualified: storedBaselineComparison.qualified,
      pass: storedBaselineComparison.pass,
    },
    schemaValidation: schema,
    productionBuildHashes: result.productionBuildHashes,
    productionBuildSnapshot: result.productionBuildSnapshot,
    gates: result.gates,
    errors: result.errors,
  };
}
