import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { newGame } from '../../src/sim/state.js';
import {
  computeSurfaceDistanceField,
  computeVisualField,
  makeSurfaceDistanceField,
  makeVisualField,
} from '../../src/render3d/visualField.js';

const iterations = Math.max(1, Number(process.env.FIELD_BENCH_ITERATIONS || 5));
const warmups = Math.max(0, Number(process.env.FIELD_BENCH_WARMUPS || 1));
const state = newGame('relaxed', 424242);
const course = state.course;

function hashFields(field, distance) {
  return createHash('sha256').update(field.data).update(distance.data).digest('hex');
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    minMs: sorted[0],
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1),
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
  };
}

function runPair() {
  globalThis.gc?.();
  const initialStart = performance.now();
  const field = makeVisualField(course);
  const distance = makeSurfaceDistanceField(field);
  const initialMs = performance.now() - initialStart;
  const preparedHash = hashFields(field, distance);

  const duplicateStart = performance.now();
  computeVisualField(course, field);
  computeSurfaceDistanceField(field, distance);
  const duplicateMs = performance.now() - duplicateStart;
  const recomputedHash = hashFields(field, distance);

  return {
    initialMs,
    duplicateMs,
    oldPathMs: initialMs + duplicateMs,
    preparedHash,
    recomputedHash,
    exact: preparedHash === recomputedHash,
    dimensions: {
      width: field.w,
      height: field.h,
      visualBytes: field.data.byteLength,
      surfaceDistanceBytes: distance.data.byteLength,
    },
  };
}

for (let i = 0; i < warmups; i += 1) runPair();
const samples = Array.from({ length: iterations }, runPair);
const initial = summarize(samples.map((sample) => sample.initialMs));
const duplicate = summarize(samples.map((sample) => sample.duplicateMs));
const oldPath = summarize(samples.map((sample) => sample.oldPathMs));
const result = {
  ok: samples.every((sample) => sample.exact),
  protocol: {
    fixture: 'newGame relaxed seed 424242 (Willow course seed 276398324)',
    iterations,
    warmups,
    timing: 'Node performance.now; course generation excluded; optional forced GC before each pair',
    comparison: 'current initial prepared-field path versus the removed identical second compute pair',
  },
  dimensions: samples[0].dimensions,
  currentInitialPair: initial,
  removedDuplicatePair: duplicate,
  emulatedOldPath: oldPath,
  medianCpuReductionMs: duplicate.medianMs,
  medianCpuReductionPercent: (duplicate.medianMs / oldPath.medianMs) * 100,
  exactOutput: {
    ok: samples.every((sample) => sample.exact),
    hashes: [...new Set(samples.map((sample) => sample.preparedHash))],
  },
  samples,
};

const outputPath = process.env.QA_RESULT_PATH;
if (outputPath) {
  const absolute = resolve(outputPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
