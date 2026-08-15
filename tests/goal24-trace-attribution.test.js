import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOAL24_TRACE_CAUSAL_CANDIDATE_LIMIT,
  analyzeGoal24ChromiumTrace,
  goal24TraceMarkName,
  parseGoal24TraceMarkName,
  validateGoal24TraceAttribution,
} from '../tools/qa/lib/goal24-trace-attribution.mjs';

const mark = (id, scenario, phase, label, ts) => ({
  ph: 'R', cat: 'blink.user_timing',
  name: goal24TraceMarkName(id, scenario, phase, label),
  ts, pid: 10, tid: 20,
});

function fixture() {
  return {
    traceEvents: [
      { ph: 'M', name: 'thread_name', pid: 10, tid: 20, args: { name: 'CrRendererMain' } },
      mark('door-1', 'doorApproach', 'start', '', 100_000),
      {
        ph: 'X', cat: 'toplevel', name: 'ThreadControllerImpl::RunTask',
        ts: 110_000, dur: 45_000, pid: 10, tid: 20,
      },
      {
        ph: 'X', cat: 'devtools.timeline', name: 'FunctionCall',
        ts: 112_000, dur: 40_000, pid: 10, tid: 20,
        args: { data: { stackTrace: [{ functionName: 'rebuildNavmesh', url: 'src/nav.js', lineNumber: 41 }] } },
      },
      {
        ph: 'X', cat: 'renderer.scheduler', name: 'Recast navmesh build',
        ts: 114_000, dur: 35_000, pid: 10, tid: 20,
      },
      mark('door-1', 'doorApproach', 'marker', 'post-outcome-render-boundary', 160_000),
      mark('door-1', 'doorApproach', 'end', '', 170_000),
      { ph: 'X', cat: 'toplevel', name: 'RunTask', ts: 160_001, dur: 90_000, pid: 99, tid: 99 },
    ],
  };
}

function overBudgetFixture(events, id = 'npc-1') {
  return {
    traceEvents: [
      { ph: 'M', name: 'thread_name', pid: 10, tid: 20, args: { name: 'CrRendererMain' } },
      { ph: 'M', name: 'thread_name', pid: 99, tid: 7, args: { name: 'CrGpuMain' } },
      mark(id, 'npcNavActivation', 'start', '', 100_000),
      {
        ph: 'X', cat: 'toplevel', name: 'ThreadControllerImpl::RunTask',
        ts: 105_000, dur: 90_000, pid: 10, tid: 20,
      },
      ...events,
      mark(id, 'npcNavActivation', 'marker', 'post-outcome-render-boundary', 200_000),
    ],
  };
}

test('trace mark names round-trip arbitrary ids without delimiter ambiguity', () => {
  const name = goal24TraceMarkName('door|1 / cold', 'door Approach', 'marker', 'post/outcome');
  assert.deepEqual(parseGoal24TraceMarkName(name), {
    id: 'door|1 / cold', scenario: 'door Approach', phase: 'marker', label: 'post/outcome',
  });
  assert.equal(parseGoal24TraceMarkName('unrelated'), null);
});

test('trace attribution binds the recorder-owned window and longest renderer task', () => {
  const analysis = analyzeGoal24ChromiumTrace(fixture(), { interactionIds: ['door-1'] });
  assert.equal(analysis.ok, true);
  assert.equal(analysis.interactions[0].traceWindow.durationMs, 60);
  assert.equal(analysis.interactions[0].traceWindow.endBasis, 'post-outcome-render-boundary');
  assert.equal(analysis.interactions[0].longestMainThreadTask.durationMs, 45);
  assert.equal(analysis.interactions[0].longestMainThreadTask.overlapWithInteractionMs, 45);
  assert.equal(analysis.interactions[0].attribution.cause, 'navmesh-generation-query');
  assert.equal(analysis.interactions[0].rendererThread.name, 'CrRendererMain');
});

test('tasks on another process/thread and work after the contract endpoint cannot win', () => {
  const trace = fixture();
  trace.traceEvents.push({
    ph: 'X', cat: 'toplevel', name: 'RunTask', ts: 161_000, dur: 900_000, pid: 10, tid: 20,
  });
  const analysis = analyzeGoal24ChromiumTrace(trace, { interactionIds: ['door-1'] });
  assert.equal(analysis.interactions[0].longestMainThreadTask.durationMs, 45);
});

test('unknown cause retains the strongest trace evidence instead of inventing a classification', () => {
  const trace = { traceEvents: [
    { ph: 'M', name: 'thread_name', pid: 10, tid: 20, args: { name: 'CrRendererMain' } },
    mark('opaque-1', 'toolSwitch', 'start', '', 100_000),
    {
      ph: 'X', cat: 'opaque.category', name: 'OpaqueWork',
      ts: 110_000, dur: 12_000, pid: 10, tid: 20,
      args: { data: { detail: 'unclassified production work' } },
    },
    mark('opaque-1', 'toolSwitch', 'marker', 'post-outcome-render-boundary', 130_000),
  ] };
  const analysis = analyzeGoal24ChromiumTrace(trace, { interactionIds: ['opaque-1'] });
  const interaction = analysis.interactions[0];
  assert.equal(analysis.ok, true);
  assert.equal(interaction.longestMainThreadTask.durationMs, 12);
  assert.equal(interaction.longestMainThreadTask.selectionBasis,
    'longest-overlapping-complete-renderer-main-thread-event-fallback');
  assert.equal(interaction.attribution.cause, 'unknown');
  assert.equal(interaction.attribution.evidence.name, 'OpaqueWork');
  assert.equal(validateGoal24TraceAttribution(analysis, {
    requiredInteractionIds: ['opaque-1'],
  }).ok, true);
});

test('missing exact ordered recorder marks fail closed', () => {
  const analysis = analyzeGoal24ChromiumTrace({ traceEvents: [
    mark('door-1', 'doorApproach', 'start', '', 100),
  ] }, { interactionIds: ['door-1'] });
  assert.equal(analysis.ok, false);
  assert.match(analysis.failures.join('\n'), /missing-ordered-start-and-end/);
});

test('validator requires every requested interaction and rejects forged timing', () => {
  const analysis = analyzeGoal24ChromiumTrace(fixture(), { interactionIds: ['door-1'] });
  assert.equal(validateGoal24TraceAttribution(analysis, {
    requiredInteractionIds: ['door-1'],
  }).ok, true);
  assert.match(validateGoal24TraceAttribution(analysis, {
    requiredInteractionIds: ['tool-1'],
  }).failures.join('\n'), /tool-1/);

  const forged = structuredClone(analysis);
  forged.interactions[0].longestMainThreadTask.durationMs = null;
  assert.equal(validateGoal24TraceAttribution(forged).ok, false);
});

test('duration-ranked evidence makes an 80 ms MajorGC beat a 0.001 ms nav token', () => {
  const trace = overBudgetFixture([
    {
      ph: 'X', cat: 'v8', name: 'MajorGC',
      ts: 108_000, dur: 80_000, pid: 10, tid: 20,
    },
    {
      ph: 'X', cat: 'renderer.scheduler', name: 'Recast navmesh query',
      ts: 109_000, dur: 1, pid: 10, tid: 20,
    },
  ]);
  const analysis = analyzeGoal24ChromiumTrace(trace, { interactionIds: ['npc-1'] });
  const interaction = analysis.interactions[0];
  assert.equal(analysis.ok, true);
  assert.equal(interaction.attribution.cause, 'garbage-collection');
  assert.equal(interaction.attribution.evidence.name, 'MajorGC');
  assert.equal(interaction.attribution.evidence.overlapWithInteractionMs, 80);
  assert.equal(interaction.causalCandidates[0].rank, 1);
  assert.equal(interaction.causalCandidates[1].name, 'Recast navmesh query');
  assert.equal(interaction.causalCandidates[1].overlapWithInteractionMs, 0.001);
  assert.equal(interaction.causalAssessment.meaningful, true);
  assert.equal(validateGoal24TraceAttribution(analysis, {
    requiredInteractionIds: ['npc-1'],
  }).ok, true);
});

test('cross-process GPU work can be strongest without replacing renderer-main task identity', () => {
  const trace = overBudgetFixture([{
    ph: 'X', cat: 'gpu', name: 'GpuCommandBuffer::Submit',
    ts: 106_000, dur: 88_000, pid: 99, tid: 7,
    args: { commandBuffer: 'shipping-frame-submit' },
  }]);
  const analysis = analyzeGoal24ChromiumTrace(trace, { interactionIds: ['npc-1'] });
  const interaction = analysis.interactions[0];
  assert.equal(analysis.ok, true);
  assert.equal(interaction.longestMainThreadTask.pid, 10);
  assert.equal(interaction.longestMainThreadTask.tid, 20);
  assert.equal(interaction.attribution.cause, 'gpu-submit');
  assert.equal(interaction.strongestCausalEvidence.pid, 99);
  assert.equal(interaction.strongestCausalEvidence.tid, 7);
  assert.equal(interaction.strongestCausalEvidence.threadName, 'CrGpuMain');
  assert.equal(interaction.strongestCausalEvidence.onRendererMainThread, false);
  assert.equal(interaction.strongestCausalEvidence.rawEvidence.pid, 99);
  assert.equal(interaction.causalScan.crossThreadClassifiedCandidateCount, 1);
  assert.equal(validateGoal24TraceAttribution(analysis, {
    requiredInteractionIds: ['npc-1'],
  }).ok, true);
});

test('candidate ledger explicitly retains GPU, raster, GC, nav, geometry, and shader evidence', () => {
  const trace = overBudgetFixture([
    { ph: 'X', cat: 'gpu', name: 'GpuCommandBuffer::Submit', ts: 106_000, dur: 85_000, pid: 99, tid: 7 },
    { ph: 'X', cat: 'cc', name: 'RasterTask', ts: 107_000, dur: 70_000, pid: 99, tid: 8 },
    { ph: 'X', cat: 'v8', name: 'MinorGC', ts: 108_000, dur: 60_000, pid: 10, tid: 20 },
    { ph: 'X', cat: 'renderer', name: 'Recast navmesh build', ts: 109_000, dur: 50_000, pid: 10, tid: 20 },
    { ph: 'X', cat: 'renderer', name: 'BufferGeometry rebuild', ts: 110_000, dur: 40_000, pid: 10, tid: 20 },
    { ph: 'X', cat: 'gpu', name: 'CompileShader program', ts: 111_000, dur: 30_000, pid: 99, tid: 7 },
  ]);
  const analysis = analyzeGoal24ChromiumTrace(trace, { interactionIds: ['npc-1'] });
  const causes = new Set(analysis.interactions[0].causalCandidates.flatMap(
    ({ matchedCauses }) => matchedCauses,
  ));
  assert.deepEqual([...causes].sort(), [
    'garbage-collection',
    'geometry-rebuild',
    'gpu-submit',
    'navmesh-generation-query',
    'raster-composite',
    'shader-material-warmup',
  ]);
  assert.equal(analysis.ok, true);
});

test('candidate ledger retains the globally strongest bounded prefix with explicit truncation provenance', () => {
  const classified = Array.from(
    { length: GOAL24_TRACE_CAUSAL_CANDIDATE_LIMIT + 17 },
    (_, index) => ({
      ph: 'X', cat: 'v8', name: `MajorGC-${String(index).padStart(3, '0')}`,
      ts: 101_000 + index * 10,
      dur: 40_000 + index,
      pid: index % 2 ? 99 : 10,
      tid: index % 2 ? 7 : 20,
    }),
  );
  const analysis = analyzeGoal24ChromiumTrace(overBudgetFixture(classified), {
    interactionIds: ['npc-1'],
  });
  const interaction = analysis.interactions[0];
  const ledger = interaction.causalScan.candidateLedger;
  assert.equal(analysis.ok, true);
  assert.equal(interaction.causalCandidates.length, GOAL24_TRACE_CAUSAL_CANDIDATE_LIMIT);
  assert.equal(interaction.causalScan.classifiedCandidateCount, classified.length);
  assert.deepEqual(ledger, {
    ordering: 'overlap-desc-duration-desc-start-asc-pid-asc-tid-asc-trace-event-ordinal-asc',
    retentionPolicy: 'global-strongest-top-k',
    totalCount: classified.length,
    retainedCount: GOAL24_TRACE_CAUSAL_CANDIDATE_LIMIT,
    limit: GOAL24_TRACE_CAUSAL_CANDIDATE_LIMIT,
    omittedCount: 17,
    truncated: true,
    retainedZeroDurationCount: 0,
    retainedCrossThreadCount: 32,
  });
  assert.equal(interaction.causalCandidates[0].name,
    `MajorGC-${String(classified.length - 1).padStart(3, '0')}`);
  assert.equal(interaction.causalCandidates.at(-1).name, 'MajorGC-017');
  assert.equal(interaction.strongestCausalEvidence.name,
    `MajorGC-${String(classified.length - 1).padStart(3, '0')}`);
  assert.equal(validateGoal24TraceAttribution(analysis, {
    requiredInteractionIds: ['npc-1'],
  }).ok, true);

  const forgedTotal = structuredClone(analysis);
  forgedTotal.interactions[0].causalScan.candidateLedger.totalCount -= 1;
  assert.match(validateGoal24TraceAttribution(forgedTotal).failures.join('\n'),
    /bounded causal candidate ledger provenance/u);

  const forgedOrder = structuredClone(analysis);
  forgedOrder.interactions[0].causalCandidates.reverse();
  assert.match(validateGoal24TraceAttribution(forgedOrder).failures.join('\n'),
    /not ranked|duration-ranked raw evidence/u);
});

test('unknown over-budget work fails closed even if summary status is spoofed to pass', () => {
  const trace = overBudgetFixture([{
    ph: 'X', cat: 'opaque.category', name: 'OpaqueEightyMillisecondWork',
    ts: 108_000, dur: 80_000, pid: 10, tid: 20,
    args: { detail: 'unclassified production work' },
  }]);
  const analysis = analyzeGoal24ChromiumTrace(trace, { interactionIds: ['npc-1'] });
  assert.equal(analysis.ok, false);
  assert.equal(analysis.interactions[0].attribution.cause, 'unknown');
  assert.equal(analysis.interactions[0].causalAssessment.overBudget, true);
  assert.equal(analysis.interactions[0].causalAssessment.meaningful, false);
  assert.match(analysis.failures.join('\n'), /over-budget.*no meaningful/u);

  const spoofed = structuredClone(analysis);
  spoofed.ok = true;
  spoofed.failures = [];
  const validation = validateGoal24TraceAttribution(spoofed, {
    requiredInteractionIds: ['npc-1'],
  });
  assert.equal(validation.ok, false);
  assert.match(validation.failures.join('\n'), /unknown or non-meaningful/u);
});

test('validator rejects spoofed causes, raw process drift, and malformed candidate ranking', () => {
  const trace = overBudgetFixture([
    { ph: 'X', cat: 'v8', name: 'MajorGC', ts: 108_000, dur: 80_000, pid: 10, tid: 20 },
    { ph: 'X', cat: 'renderer', name: 'Recast navmesh query', ts: 109_000, dur: 20_000, pid: 10, tid: 20 },
  ]);
  const analysis = analyzeGoal24ChromiumTrace(trace, { interactionIds: ['npc-1'] });
  assert.equal(validateGoal24TraceAttribution(analysis).ok, true);

  const spoofedCause = structuredClone(analysis);
  spoofedCause.interactions[0].causalCandidates[0].cause = 'navmesh-generation-query';
  spoofedCause.interactions[0].attribution.cause = 'navmesh-generation-query';
  assert.match(validateGoal24TraceAttribution(spoofedCause).failures.join('\n'),
    /preserved raw trace event|duration-ranked raw evidence/u);

  const rawProcessDrift = structuredClone(analysis);
  rawProcessDrift.interactions[0].causalCandidates[0].rawEvidence.pid = 999;
  assert.match(validateGoal24TraceAttribution(rawProcessDrift).failures.join('\n'),
    /preserved raw trace event/u);

  const malformedRank = structuredClone(analysis);
  malformedRank.interactions[0].causalCandidates[0].rank = 2;
  assert.match(validateGoal24TraceAttribution(malformedRank).failures.join('\n'),
    /rank\/classification/u);
});
