import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(TOOL_PATH), '../..');

export const RUN_NAMES = Object.freeze(['run01', 'run02', 'run03']);

export const SCENARIOS = Object.freeze({
  idle: Object.freeze({
    label: 'Idle exterior',
    sourceKey: 'inheritedIdleExterior',
  }),
  vacuum: Object.freeze({
    label: 'Vacuum active',
    sourceKey: 'vacuumActive',
  }),
  washer: Object.freeze({
    label: 'Pressure washer active',
    sourceKey: 'pressureWasherActive',
  }),
});

const COMMON_METRICS = Object.freeze([
  Object.freeze({
    key: 'averageFps', label: 'Average FPS', unit: 'FPS', source: ['averageFps'],
    gate: 'minimum-ratio', factor: 0.85,
    rationale: 'Retain at least 85% of the matched before median so average throughput cannot regress by more than 15%.',
  }),
  Object.freeze({
    key: 'onePercentLowFps', label: '1% low FPS', unit: 'FPS', source: ['onePercentLowFps'],
    gate: 'minimum-ratio', factor: 0.75,
    rationale: 'Retain at least 75% of the matched before median, allowing normal tail variance while rejecting a material stutter regression.',
  }),
  Object.freeze({
    key: 'worstFrameMs', label: 'Worst frame', unit: 'ms', source: ['worstFrameMs'],
    gate: 'worst-frame',
    rationale: 'Cap the worst-frame median at the larger of 50 ms or 1.5 times the matched before median.',
  }),
  Object.freeze({
    key: 'drawCalls', label: 'Draw calls', unit: 'calls', source: ['renderer', 'drawCalls'],
    gate: 'maximum-ratio', factor: 1.20,
    rationale: 'A 20% ceiling bounds additional submission overhead from the integrated Sheet 6 scene.',
  }),
  Object.freeze({
    key: 'renderedTriangles', label: 'Rendered triangles', unit: 'triangles', source: ['renderer', 'renderedTriangles'],
    gate: 'maximum-ratio', factor: 1.25,
    rationale: 'A 25% ceiling bounds composed-frame geometry cost at the same fixed camera and tool state.',
  }),
  Object.freeze({
    key: 'eventListeners', label: 'Event listeners', unit: 'listeners', source: ['browser', 'eventListeners'],
    gate: 'no-growth',
    rationale: 'Listener count may not grow because Sheet 6 asset integration does not require new persistent input or UI subscriptions.',
  }),
  Object.freeze({
    key: 'sceneNodes', label: 'Scene nodes', unit: 'nodes', source: ['renderer', 'sceneNodes'],
    gate: 'maximum-addition', allowance: 500,
    rationale: 'The fixed +500 Sheet 6 allowance bounds the integrated architecture instance graph.',
  }),
  Object.freeze({
    key: 'geometriesInMemory', label: 'Resident geometries', unit: 'geometries', source: ['renderer', 'geometriesInMemory'],
    gate: 'maximum-addition', allowance: 179,
    rationale: 'The fixed +179 Sheet 6 allowance bounds resident authored geometry after loading.',
  }),
  Object.freeze({
    key: 'materialCount', label: 'Material count', unit: 'materials', source: ['renderer', 'materialCount'],
    gate: 'maximum-addition', allowance: 59,
    rationale: 'The fixed +59 Sheet 6 allowance bounds unique visible material residency.',
  }),
  Object.freeze({
    key: 'textureCount', label: 'Texture count', unit: 'textures', source: ['renderer', 'textureCount'],
    gate: 'maximum-addition', allowance: 24,
    rationale: 'The fixed +24 Sheet 6 allowance bounds unique visible texture residency.',
  }),
]);

const SCENARIO_METRICS = Object.freeze({
  idle: Object.freeze([]),
  vacuum: Object.freeze([
    Object.freeze({
      key: 'uiMutationsPerSecond', label: 'UI mutations / second', unit: 'mutations/s',
      source: ['uiMutationsPerSecond'], gate: 'fixed-maximum', maximum: 9.22,
      rationale: 'The predeclared 9.22 updates/s ceiling keeps the active vacuum HUD cadence bounded.',
    }),
  ]),
  washer: Object.freeze([
    Object.freeze({
      key: 'uiMutationsPerSecond', label: 'UI mutations / second', unit: 'mutations/s',
      source: ['uiMutationsPerSecond'], gate: 'exact', expected: 0,
      rationale: 'The pressure-washer route should not mutate the measured HUD/UI root while held active.',
    }),
  ]),
});

function finite(value, context) {
  if (!Number.isFinite(value)) throw new Error(`${context} must be a finite number; received ${value}.`);
  return value;
}

function valueAt(object, source, context) {
  let value = object;
  for (const part of source) value = value?.[part];
  return finite(value, context);
}

function rounded(value, digits = 6) {
  if (value == null) return null;
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('median requires at least one value.');
  const sorted = values.map((value, index) => finite(value, `median value ${index}`)).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function repoRelative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

export function loadRunSet(directory, label) {
  const absoluteDirectory = path.resolve(directory);
  const runs = RUN_NAMES.map((runName) => {
    const file = path.join(absoluteDirectory, runName, 'runner-result.json');
    if (!fs.existsSync(file)) throw new Error(`${label} input is missing ${file}.`);
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (result.ok !== true) throw new Error(`${label} ${runName} is not accepted (ok !== true).`);
    for (const { sourceKey } of Object.values(SCENARIOS)) {
      if (!result.performanceScenarios?.[sourceKey]) {
        throw new Error(`${label} ${runName} is missing performanceScenarios.${sourceKey}.`);
      }
    }
    return {
      runName,
      file,
      path: repoRelative(file),
      sha256: sha256(file),
      capturedAt: result.capturedAt || null,
      result,
    };
  });
  return { label, directory: repoRelative(absoluteDirectory), runs };
}

function metricsForScenario(scenarioKey) {
  return [...COMMON_METRICS, ...(SCENARIO_METRICS[scenarioKey] || [])];
}

export function aggregateScenario(runSet, scenarioKey) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) throw new Error(`Unknown scenario ${scenarioKey}.`);
  const aggregated = {};
  for (const metric of metricsForScenario(scenarioKey)) {
    const values = runSet.runs.map(({ runName, result }) => valueAt(
      result.performanceScenarios[scenario.sourceKey],
      metric.source,
      `${runSet.label} ${runName} ${scenario.sourceKey}.${metric.source.join('.')}`,
    ));
    aggregated[metric.key] = median(values);
  }
  return aggregated;
}

function thresholdFor(metric, before) {
  switch (metric.gate) {
    case 'minimum-ratio':
      return { operator: '>=', value: before * metric.factor, basis: `${metric.factor} x before median` };
    case 'maximum-ratio':
      return { operator: '<=', value: before * metric.factor, basis: `${metric.factor} x before median` };
    case 'worst-frame':
      return { operator: '<=', value: Math.max(50, before * 1.5), basis: 'max(50 ms, 1.5 x before median)' };
    case 'no-growth':
      return { operator: '<=', value: before, basis: 'before median (no growth)' };
    case 'maximum-addition':
      return { operator: '<=', value: before + metric.allowance, basis: `before median + ${metric.allowance}` };
    case 'fixed-maximum':
      return { operator: '<=', value: metric.maximum, basis: `fixed ceiling ${metric.maximum}` };
    case 'exact':
      return { operator: '===', value: metric.expected, basis: `exactly ${metric.expected}` };
    default:
      throw new Error(`Unsupported gate ${metric.gate}.`);
  }
}

function passes(after, threshold) {
  if (threshold.operator === '>=') return after >= threshold.value;
  if (threshold.operator === '<=') return after <= threshold.value;
  if (threshold.operator === '===') return after === threshold.value;
  throw new Error(`Unsupported threshold operator ${threshold.operator}.`);
}

export function buildScenarioComparison(scenarioKey, beforeMedians, afterMedians) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) throw new Error(`Unknown scenario ${scenarioKey}.`);
  const comparisons = metricsForScenario(scenarioKey).map((metric) => {
    const before = finite(beforeMedians[metric.key], `${scenarioKey}.${metric.key} before`);
    const after = finite(afterMedians[metric.key], `${scenarioKey}.${metric.key} after`);
    const threshold = thresholdFor(metric, before);
    const delta = after - before;
    return {
      metric: metric.key,
      label: metric.label,
      unit: metric.unit,
      before: rounded(before),
      after: rounded(after),
      delta: rounded(delta),
      deltaPercent: before === 0 ? null : rounded((delta / before) * 100, 4),
      threshold: {
        operator: threshold.operator,
        value: rounded(threshold.value),
        basis: threshold.basis,
      },
      pass: passes(after, threshold),
      rationale: metric.rationale,
    };
  });
  return {
    label: scenario.label,
    sourceKey: scenario.sourceKey,
    comparisons,
    pass: comparisons.every((comparison) => comparison.pass),
  };
}

export function buildPerformanceComparison({ beforeDir, afterDir }) {
  const before = loadRunSet(beforeDir, 'before_stable');
  const after = loadRunSet(afterDir, 'after_navigation_final');
  const scenarios = {};
  for (const scenarioKey of Object.keys(SCENARIOS)) {
    scenarios[scenarioKey] = buildScenarioComparison(
      scenarioKey,
      aggregateScenario(before, scenarioKey),
      aggregateScenario(after, scenarioKey),
    );
  }
  const comparisons = Object.values(scenarios).flatMap((scenario) => scenario.comparisons);
  const passedGates = comparisons.filter((comparison) => comparison.pass).length;
  const capturedAt = after.runs.map((run) => run.capturedAt).filter(Boolean).sort().at(-1) || null;
  return {
    schemaVersion: 1,
    generatedFromLatestCapture: capturedAt,
    tool: repoRelative(TOOL_PATH),
    methodology: {
      aggregation: 'Per-field median across exactly run01, run02, and run03 for each matched scenario and input set.',
      comparison: 'before_stable/run01..03 versus after_navigation_final/run01..03; rejected and superseded after-run sets are not inputs.',
      scenarios: Object.fromEntries(Object.entries(SCENARIOS).map(([key, value]) => [key, value.sourceKey])),
    },
    inputs: {
      before: {
        label: before.label,
        directory: before.directory,
        runs: before.runs.map(({ runName, path: runPath, sha256: hash, capturedAt: at }) => ({
          run: runName, path: runPath, sha256: hash, capturedAt: at,
        })),
      },
      after: {
        label: after.label,
        directory: after.directory,
        runs: after.runs.map(({ runName, path: runPath, sha256: hash, capturedAt: at }) => ({
          run: runName, path: runPath, sha256: hash, capturedAt: at,
        })),
      },
    },
    scenarios,
    summary: {
      totalGates: comparisons.length,
      passedGates,
      failedGates: comparisons.length - passedGates,
      overallPass: comparisons.every((comparison) => comparison.pass),
    },
  };
}

function formatNumber(value) {
  if (value == null) return 'n/a';
  return Number.isInteger(value)
    ? value.toLocaleString('en-US')
    : value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function formatDeltaPercent(value) {
  if (value == null) return 'n/a (before = 0)';
  return `${value >= 0 ? '+' : ''}${formatNumber(value)}%`;
}

function formatThreshold(threshold) {
  return `${threshold.operator} ${formatNumber(threshold.value)} (${threshold.basis})`;
}

export function renderMarkdown(report) {
  const inputRows = ['| Set | Run | Captured at | SHA-256 | Input |', '| --- | --- | --- | --- | --- |'];
  for (const [set, input] of Object.entries(report.inputs)) {
    for (const run of input.runs) {
      inputRows.push(`| ${set} | ${run.run} | ${run.capturedAt || 'n/a'} | \`${run.sha256}\` | \`${run.path}\` |`);
    }
  }

  const scenarioSections = Object.entries(report.scenarios).map(([key, scenario]) => {
    const rows = [
      '| Metric | Before median | After median | Delta | Delta % | Threshold | Pass |',
      '| --- | ---: | ---: | ---: | ---: | --- | :---: |',
    ];
    for (const comparison of scenario.comparisons) {
      rows.push(`| ${comparison.label} (${comparison.unit}) | ${formatNumber(comparison.before)} | ${formatNumber(comparison.after)} | ${comparison.delta >= 0 ? '+' : ''}${formatNumber(comparison.delta)} | ${formatDeltaPercent(comparison.deltaPercent)} | ${formatThreshold(comparison.threshold)} | ${comparison.pass ? 'PASS' : 'FAIL'} |`);
    }
    return `## ${scenario.label} (\`${key}\`)\n\n${rows.join('\n')}\n\nScenario result: **${scenario.pass ? 'PASS' : 'FAIL'}**.`;
  }).join('\n\n');

  const rationaleRows = [
    '| Scenario | Metric | Rationale |',
    '| --- | --- | --- |',
  ];
  for (const scenario of Object.values(report.scenarios)) {
    for (const comparison of scenario.comparisons) {
      rationaleRows.push(`| ${scenario.label} | ${comparison.label} | ${comparison.rationale} |`);
    }
  }

  return `# Sheet 6 performance comparison

Overall result: **${report.summary.overallPass ? 'PASS' : 'FAIL'}** (${report.summary.passedGates}/${report.summary.totalGates} gates passed).

## Method

- ${report.methodology.aggregation}
- ${report.methodology.comparison}
- Fixed viewport, device scale factor, gameplay fixture, cameras, warm-up, sampling duration, and tool routes are inherited from the retained runner evidence.
- Percent delta is \`(after - before) / before x 100\`; it is reported as n/a when the before median is zero.

## Inputs

${inputRows.join('\n')}

${scenarioSections}

## Gate rationale

${rationaleRows.join('\n')}
`;
}

function parseArgs(argv) {
  const options = {
    beforeDir: path.join(REPO_ROOT, 'qa/assets_51_100_master/sheet_06/performance/before_stable'),
    afterDir: path.join(REPO_ROOT, 'qa/assets_51_100_master/sheet_06/performance/after_navigation_final'),
    outDir: path.join(REPO_ROOT, 'qa/assets_51_100_master/sheet_06/performance/comparison'),
  };
  const names = new Map([
    ['--before', 'beforeDir'],
    ['--after', 'afterDir'],
    ['--out', 'outDir'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const property = names.get(argv[index]);
    if (!property) throw new Error(`Unknown argument ${argv[index]}.`);
    const value = argv[index + 1];
    if (!value) throw new Error(`${argv[index]} requires a path.`);
    options[property] = path.resolve(REPO_ROOT, value);
    index += 1;
  }
  return options;
}

export function writeComparison({ beforeDir, afterDir, outDir }) {
  const report = buildPerformanceComparison({ beforeDir, afterDir });
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'sheet06-performance-comparison.json');
  const markdownPath = path.join(outDir, 'sheet06-performance-comparison.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  return { report, jsonPath, markdownPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === TOOL_PATH) {
  const output = writeComparison(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    overallPass: output.report.summary.overallPass,
    passedGates: output.report.summary.passedGates,
    totalGates: output.report.summary.totalGates,
    json: repoRelative(output.jsonPath),
    markdown: repoRelative(output.markdownPath),
  }, null, 2)}\n`);
  if (!output.report.summary.overallPass) process.exitCode = 1;
}
