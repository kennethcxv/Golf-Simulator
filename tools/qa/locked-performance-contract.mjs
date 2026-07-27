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
      !== expected.thresholds.minimumOnePercentLowFps) {
    failures.push('thresholds must be average FPS >= 60 and 1% low FPS >= 30');
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
    const gate = {
      scenario: scenarioKey,
      median: summary,
      averageFpsPass,
      onePercentLowFpsPass,
      ok: averageFpsPass && onePercentLowFpsPass,
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
  }
  return { ok: failures.length === 0, failures, gates };
}
