import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const percent = (before, after) => before === 0 ? null : ((after - before) / before) * 100;
const rounded = (value) => value === null ? null : Number(value.toFixed(3));

export function comparePerformanceRuns(before, after) {
  const beforeCases = new Map((before.cases || []).map((entry) => [entry.key, entry]));
  const afterCases = new Map((after.cases || []).map((entry) => [entry.key, entry]));
  const keys = [...new Set([...beforeCases.keys(), ...afterCases.keys()])].sort();
  const cases = [];
  const regressions = [];
  const noiseWarnings = [];
  for (const key of keys) {
    const baseline = beforeCases.get(key);
    const candidate = afterCases.get(key);
    if (!baseline || !candidate) {
      regressions.push(`${key}: case missing from ${baseline ? 'candidate' : 'baseline'}`);
      cases.push({ key, comparable: false });
      continue;
    }
    const delta = {
      averageFpsPct: rounded(percent(baseline.performance.averageFps, candidate.performance.averageFps)),
      onePercentLowFpsPct: rounded(percent(
        baseline.performance.onePercentLowFps,
        candidate.performance.onePercentLowFps,
      )),
      worstFrameMsPct: rounded(percent(
        baseline.performance.worstFrameMs,
        candidate.performance.worstFrameMs,
      )),
      drawCalls: candidate.renderer.drawCalls - baseline.renderer.drawCalls,
      triangles: candidate.renderer.triangles - baseline.renderer.triangles,
      materials: candidate.scene.materialCount - baseline.scene.materialCount,
      textureMipBytes: candidate.scene.estimatedTextureMipBytes - baseline.scene.estimatedTextureMipBytes,
      heapBytes: baseline.heapBytes == null || candidate.heapBytes == null
        ? null : candidate.heapBytes - baseline.heapBytes,
      activeListeners: candidate.activeListeners - baseline.activeListeners,
    };
    const failures = [];
    const averageRegression = delta.averageFpsPct < -10;
    const lowRegression = delta.onePercentLowFpsPct < -15;
    const worstRegression = delta.worstFrameMsPct > 25
      && candidate.performance.worstFrameMs - baseline.performance.worstFrameMs > 5;
    // Headed Chrome frame times quantize around display cadence, so a lone 16.7 ->
    // 25 ms worst-frame shift in a short sample is noise unless average throughput
    // corroborates it. A severe average regression fails on its own.
    if (delta.averageFpsPct < -20) failures.push(`average FPS ${delta.averageFpsPct}%`);
    else if (averageRegression && (lowRegression || worstRegression)) {
      failures.push(`frame pacing: average ${delta.averageFpsPct}%, 1% low ${delta.onePercentLowFpsPct}%, worst ${delta.worstFrameMsPct}%`);
    } else {
      if (lowRegression) noiseWarnings.push(`${key}: uncorroborated 1% low shift ${delta.onePercentLowFpsPct}%`);
      if (worstRegression) noiseWarnings.push(`${key}: uncorroborated worst-frame shift ${delta.worstFrameMsPct}%`);
    }
    if (delta.drawCalls > Math.max(5, baseline.renderer.drawCalls * 0.05)) failures.push(`draw calls +${delta.drawCalls}`);
    if (delta.triangles > Math.max(1000, baseline.renderer.triangles * 0.05)) failures.push(`triangles +${delta.triangles}`);
    if (delta.materials > 2) failures.push(`materials +${delta.materials}`);
    if (delta.textureMipBytes > 4 * 1024 * 1024) failures.push(`texture estimate +${delta.textureMipBytes} bytes`);
    if (delta.heapBytes !== null && delta.heapBytes > 20 * 1024 * 1024) failures.push(`heap +${delta.heapBytes} bytes`);
    if (delta.activeListeners > 2) failures.push(`active listeners +${delta.activeListeners}`);
    if (failures.length) regressions.push(`${key}: ${failures.join(', ')}`);
    cases.push({ key, comparable: true, delta, failures });
  }
  if (after.ok === false) regressions.push('Candidate probe reported ok:false.');
  const comparableCases = cases.filter((entry) => entry.comparable);
  const matrixAverageDeltas = comparableCases.length ? {
    averageFpsPct: rounded(comparableCases.reduce((sum, entry) => sum + entry.delta.averageFpsPct, 0) / comparableCases.length),
    onePercentLowFpsPct: rounded(comparableCases.reduce(
      (sum, entry) => sum + entry.delta.onePercentLowFpsPct, 0,
    ) / comparableCases.length),
    worstFrameMsPct: rounded(comparableCases.reduce(
      (sum, entry) => sum + entry.delta.worstFrameMsPct, 0,
    ) / comparableCases.length),
  } : null;
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    baseline: before.reportPath || null,
    candidate: after.reportPath || null,
    thresholds: {
      averageFpsPct: -10,
      onePercentLowFpsPct: -15,
      worstFrameMsPct: 25,
      worstFrameAbsoluteMs: 5,
      drawCalls: 'max(5, 5%)',
      triangles: 'max(1000, 5%)',
      materials: 2,
      textureMipBytes: 4 * 1024 * 1024,
      heapBytes: 20 * 1024 * 1024,
      activeListeners: 2,
      framePacingRule: 'Average FPS below -10% must be corroborated by 1% low below -15% or a worst-frame increase above 25% and 5 ms; average below -20% fails alone.',
    },
    matrixAverageDeltas,
    cases,
    regressions,
    noiseWarnings,
    ok: regressions.length === 0,
  };
}

function args(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--before') parsed.before = argv[++index];
    else if (arg === '--after') parsed.after = argv[++index];
    else if (arg === '--out') parsed.out = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!parsed.before || !parsed.after) throw new Error('--before and --after are required.');
  return parsed;
}

function main() {
  const options = args(process.argv.slice(2));
  const before = JSON.parse(fs.readFileSync(path.resolve(options.before), 'utf8'));
  const after = JSON.parse(fs.readFileSync(path.resolve(options.after), 'utf8'));
  const report = comparePerformanceRuns(before, after);
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    const outputPath = path.resolve(options.out);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, body);
  }
  process.stdout.write(body);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
