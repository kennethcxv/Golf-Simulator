const fs = require('node:fs');
const path = require('node:path');

const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
const finalPhase = process.env.QA_CHAIR_FINAL_PHASE || process.argv[2] || 'production-loop-4';
const baselinePhase = process.env.QA_CHAIR_BASELINE_PHASE || process.argv[3] || 'baseline';
const chairQaRoot = path.join(repoRoot, 'qa', 'chairs');
const baselinePath = path.join(chairQaRoot, baselinePhase, 'runtime-report.json');
const finalPath = path.join(chairQaRoot, finalPhase, 'runtime-report.json');

function readReport(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing chair performance report: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const baseline = readReport(baselinePath);
const final = readReport(finalPath);
const before = baseline.summary;
const after = final.summary;

function percentDelta(a, b) {
  return a === 0 ? null : ((b - a) / a) * 100;
}

function metric({ id, label, beforeValue, afterValue, unit, rule, pass, detail }) {
  return {
    id,
    label,
    unit,
    baseline: beforeValue,
    final: afterValue,
    delta: afterValue - beforeValue,
    deltaPercent: percentDelta(beforeValue, afterValue),
    rule,
    pass: Boolean(pass),
    detail,
  };
}

const heapBudget = Math.max(before.medianHeapBytes * 1.20, before.medianHeapBytes + 64 * 1024 * 1024);
const metrics = [
  metric({
    id: 'average-fps', label: 'Median average FPS', unit: 'fps',
    beforeValue: before.medianAverageFps, afterValue: after.medianAverageFps,
    rule: 'final >= 90% of baseline',
    pass: after.medianAverageFps >= before.medianAverageFps * 0.90,
  }),
  metric({
    id: 'one-percent-low-fps', label: 'Median 1% low FPS', unit: 'fps',
    beforeValue: before.medianOnePercentLowFps, afterValue: after.medianOnePercentLowFps,
    rule: 'final >= 90% of baseline',
    pass: after.medianOnePercentLowFps >= before.medianOnePercentLowFps * 0.90,
  }),
  metric({
    id: 'worst-frame', label: 'Median worst frame', unit: 'ms',
    beforeValue: before.medianWorstFrameMs, afterValue: after.medianWorstFrameMs,
    rule: 'final <= 115% of baseline',
    pass: after.medianWorstFrameMs <= before.medianWorstFrameMs * 1.15,
  }),
  metric({
    id: 'draw-calls', label: 'Median draw calls', unit: 'calls',
    beforeValue: before.medianDrawCalls, afterValue: after.medianDrawCalls,
    rule: 'final <= 105% of baseline',
    pass: after.medianDrawCalls <= before.medianDrawCalls * 1.05,
  }),
  metric({
    id: 'rendered-triangles', label: 'Median rendered triangles', unit: 'triangles',
    beforeValue: before.medianRenderedTriangles, afterValue: after.medianRenderedTriangles,
    rule: 'final <= 110% of baseline',
    pass: after.medianRenderedTriangles <= before.medianRenderedTriangles * 1.10,
  }),
  metric({
    id: 'scene-triangles', label: 'Median scene triangles', unit: 'triangles',
    beforeValue: before.medianSceneTriangles, afterValue: after.medianSceneTriangles,
    rule: 'final <= 110% of baseline',
    pass: after.medianSceneTriangles <= before.medianSceneTriangles * 1.10,
  }),
  metric({
    id: 'materials', label: 'Median unique materials', unit: 'materials',
    beforeValue: before.medianMaterials, afterValue: after.medianMaterials,
    rule: 'final <= 110% of baseline',
    pass: after.medianMaterials <= before.medianMaterials * 1.10,
  }),
  metric({
    id: 'texture-memory', label: 'Median estimated texture memory', unit: 'bytes',
    beforeValue: before.medianTextureMemoryBytes, afterValue: after.medianTextureMemoryBytes,
    rule: 'final <= 110% of baseline',
    pass: after.medianTextureMemoryBytes <= before.medianTextureMemoryBytes * 1.10,
  }),
  metric({
    id: 'heap', label: 'Median JavaScript heap', unit: 'bytes',
    beforeValue: before.medianHeapBytes, afterValue: after.medianHeapBytes,
    rule: 'final <= max(baseline + 64 MiB, 120% of baseline)',
    pass: after.medianHeapBytes <= heapBudget,
    detail: { heapBudget },
  }),
  metric({
    id: 'active-listeners', label: 'Median active listeners', unit: 'listeners',
    beforeValue: before.medianActiveListeners, afterValue: after.medianActiveListeners,
    rule: 'final <= baseline + 2',
    pass: after.medianActiveListeners <= before.medianActiveListeners + 2,
  }),
  metric({
    id: 'ui-mutations', label: 'Median UI mutation callbacks', unit: 'callbacks/second',
    beforeValue: before.medianUiMutationCallbacksPerSecond,
    afterValue: after.medianUiMutationCallbacksPerSecond,
    rule: 'final <= baseline + 1 callback/second',
    pass: after.medianUiMutationCallbacksPerSecond
      <= before.medianUiMutationCallbacksPerSecond + 1,
  }),
];

const comparableFixture = baseline.fixture.stressCount === final.fixture.stressCount
  && baseline.launch.sampleCount === final.launch.sampleCount
  && baseline.launch.sampleDurationMs === final.launch.sampleDurationMs
  && baseline.launch.viewport.width === final.launch.viewport.width
  && baseline.launch.viewport.height === final.launch.viewport.height;
const diagnosticsClean = [baseline, final].every((report) => (
  report.diagnostics.consoleErrors.length === 0
  && report.diagnostics.pageErrors.length === 0
  && report.diagnostics.failedRequests.length === 0
));
const runtimeAccepted = baseline.ok === true && final.ok === true;
const normalControlsWorked = baseline.normalControls.movedDistance > 0.05
  && final.normalControls.movedDistance > 0.05;

const acceptance = {
  comparableFixture,
  diagnosticsClean,
  runtimeAccepted,
  normalControlsWorked,
  everyMetricWithinBudget: metrics.every((entry) => entry.pass),
};
const result = {
  ok: Object.values(acceptance).every(Boolean),
  capturedAt: new Date().toISOString(),
  baseline: path.relative(repoRoot, baselinePath).replaceAll('\\', '/'),
  final: path.relative(repoRoot, finalPath).replaceAll('\\', '/'),
  fixture: {
    baselineStressCount: baseline.fixture.stressCount,
    finalStressCount: final.fixture.stressCount,
    sampleCount: final.launch.sampleCount,
    sampleDurationMs: final.launch.sampleDurationMs,
    viewport: final.launch.viewport,
  },
  metrics,
  acceptance,
};

const jsonPath = path.join(chairQaRoot, 'performance-comparison.json');
const markdownPath = path.join(chairQaRoot, 'performance-comparison.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);

const fmt = (value, unit) => {
  if (unit === 'bytes') return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return Number(value).toFixed(2);
};
const rows = metrics.map((entry) => (
  `| ${entry.label} | ${fmt(entry.baseline, entry.unit)} | ${fmt(entry.final, entry.unit)} | ${entry.deltaPercent == null ? 'n/a' : `${entry.deltaPercent >= 0 ? '+' : ''}${entry.deltaPercent.toFixed(1)}%`} | ${entry.pass ? 'PASS' : 'FAIL'} |`
));
const markdown = [
  '# Chair Performance Comparison',
  '',
  `Result: **${result.ok ? 'PASS' : 'FAIL'}**`,
  '',
  `Baseline: \`${result.baseline}\`  `,
  `Final: \`${result.final}\``,
  '',
  '| Metric | Baseline | Final | Delta | Gate |',
  '| --- | ---: | ---: | ---: | :---: |',
  ...rows,
  '',
  '## Acceptance',
  '',
  ...Object.entries(acceptance).map(([key, pass]) => `- ${pass ? '[x]' : '[ ]'} ${key}`),
  '',
  `The comparison uses the same ${final.fixture.stressCount}-chair fixture, ${final.launch.sampleCount} × ${final.launch.sampleDurationMs / 1000}-second samples, viewport, and repository-default graphics settings.`,
  '',
].join('\n');
fs.writeFileSync(markdownPath, markdown);

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
