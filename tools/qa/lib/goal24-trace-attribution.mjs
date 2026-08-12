import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

export const GOAL24_TRACE_MARK_PREFIX = 'goal24.interaction';
export const GOAL24_TRACE_ATTRIBUTION_SCHEMA = 'golf-flipper/goal24-trace-attribution/v2';
export const GOAL24_TRACE_CAUSAL_BUDGET_MS = 33;
export const GOAL24_TRACE_MIN_MEANINGFUL_CAUSAL_OVERLAP_MS = 1;
export const GOAL24_TRACE_MIN_MEANINGFUL_CAUSAL_COVERAGE_RATIO = 0.1;

const finite = (value) => Number.isFinite(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const round = (value) => finite(value) ? +value.toFixed(3) : null;
const roundRatio = (value) => finite(value) ? +value.toFixed(6) : null;

const cloneJson = (value) => {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
};

const decode = (value) => {
  try { return decodeURIComponent(String(value)); } catch { return String(value); }
};

export function goal24TraceMarkName(id, scenario, phase, label = '') {
  const required = [id, scenario, phase].map((value) => String(value || '').trim());
  if (required.some((value) => !value)) {
    throw new Error('Goal 24 trace marks require id, scenario, and phase.');
  }
  return [
    GOAL24_TRACE_MARK_PREFIX,
    encodeURIComponent(required[0]),
    encodeURIComponent(required[1]),
    encodeURIComponent(required[2]),
    encodeURIComponent(String(label || '')),
  ].join('|');
}

export function parseGoal24TraceMarkName(name) {
  const fields = String(name || '').split('|');
  if (fields.length !== 5 || fields[0] !== GOAL24_TRACE_MARK_PREFIX) return null;
  const [, id, scenario, phase, label] = fields.map(decode);
  if (!id || !scenario || !phase) return null;
  return { id, scenario, phase, label };
}

function readTrace(input) {
  if (typeof input === 'string') {
    const text = input.trimStart().startsWith('{') || input.trimStart().startsWith('[')
      ? input
      : fs.readFileSync(input, 'utf8');
    return JSON.parse(text);
  }
  if (!input || typeof input !== 'object') throw new Error('Chromium trace input is missing.');
  return input;
}

function eventList(trace) {
  if (Array.isArray(trace)) return trace;
  if (Array.isArray(trace.traceEvents)) return trace.traceEvents;
  throw new Error('Chromium trace has no traceEvents array.');
}

function eventDurationUs(event) {
  return Math.max(0, Number(event?.dur) || 0);
}

function eventEndUs(event) {
  return Number(event?.ts) + eventDurationUs(event);
}

function overlapUs(event, startUs, endUs) {
  return Math.max(0, Math.min(eventEndUs(event), endUs) - Math.max(Number(event?.ts), startUs));
}

function touchesWindow(event, startUs, endUs) {
  const startedAt = Number(event?.ts);
  if (!finite(startedAt)) return false;
  const duration = eventDurationUs(event);
  if (duration === 0) return startedAt >= startUs && startedAt <= endUs;
  return overlapUs(event, startUs, endUs) > 0;
}

function flattenStrings(value, path = '', output = [], depth = 0) {
  if (depth > 10 || output.length >= 1000 || value == null) return output;
  if (typeof value === 'string') {
    if (value.trim()) output.push({ path, value });
    return output;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      flattenStrings(value[index], `${path}[${index}]`, output, depth + 1);
    }
    return output;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flattenStrings(child, path ? `${path}.${key}` : key, output, depth + 1);
    }
  }
  return output;
}

function extractStack(event) {
  const frames = [];
  const visit = (value, depth = 0) => {
    if (depth > 10 || frames.length >= 64 || value == null) return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const functionName = value.functionName || value.function || value.name;
    const url = value.url || value.scriptName;
    const lineNumber = value.lineNumber ?? value.line;
    const columnNumber = value.columnNumber ?? value.column;
    if (nonEmpty(functionName) || nonEmpty(url)) {
      frames.push({
        functionName: nonEmpty(functionName) ? functionName : '(anonymous)',
        url: nonEmpty(url) ? url : null,
        lineNumber: Number.isInteger(lineNumber) ? lineNumber : null,
        columnNumber: Number.isInteger(columnNumber) ? columnNumber : null,
      });
    }
    for (const [key, child] of Object.entries(value)) {
      if (/stack|frame|call/i.test(key)) visit(child, depth + 1);
    }
  };
  visit(event?.args);
  return frames;
}

// All explicit patterns are evaluated for every event. The object is a lookup,
// not a priority list: matched cause names are sorted for stable serialization,
// while candidate strength is decided only by temporal overlap and duration.
const EXPLICIT_CAUSE_PATTERNS = Object.freeze({
  'asset-decode-upload': /decode|imagebitmap|tex(image|subimage)|texture.?upload|upload.?texture|gltf|glb/i,
  'garbage-collection': /(^|[^a-z])gc([^a-z]|$)|major.?gc|minor.?gc|v8\.gc|garbage|scaveng|mark.?compact|minor.?mark|major.?mark/i,
  'geometry-rebuild': /geometry|buffer.?data|matrix.?world|bounds|box3|compute.?bounding/i,
  'gpu-submit': /gpu.?task|gpu.?command|command.?buffer|submit|present|swap.?buffers|draw.?elements|draw.?arrays|glfinish|glflush/i,
  'navmesh-generation-query': /recast|detour|navmesh|nav.?query|crowd/i,
  'raster-composite': /raster|composit(e|ing|or)|draw.?frame|tile.?manager|picture.?layer/i,
  'shader-material-warmup': /shader|compile.?program|link.?program|compile.?material|init.?material|pipeline.?cache/i,
  'style-layout-paint': /recalculate.?style|update.?layout|layout(tree)?|paint(artifact|worklet|op)?/i,
  'synchronous-io': /filesystem|file.?system|read.?file|write.?file|open.?file|file.?reader.?sync|sync.?io|v8\.execute.*script|resource.?load/i,
});

const MAIN_THREAD_JAVASCRIPT_PATTERN = /functioncall|evaluate.?script|event.?dispatch|timer.?fire|runmicrotasks|v8\.execute/i;

function eventSearchText(event) {
  return [event?.name, event?.cat, ...flattenStrings(event?.args).map(({ value }) => value)]
    .filter(Boolean)
    .join(' ');
}

function classifyEventCause(event) {
  const text = eventSearchText(event);
  const matchedCauses = Object.entries(EXPLICIT_CAUSE_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([cause]) => cause)
    .sort();
  if (matchedCauses.length) {
    return {
      cause: matchedCauses.length === 1 ? matchedCauses[0] : 'compound-explicit-causal-work',
      matchedCauses,
      confidence: 'strong',
    };
  }
  if (MAIN_THREAD_JAVASCRIPT_PATTERN.test(text)) {
    return {
      cause: 'main-thread-javascript',
      matchedCauses: ['main-thread-javascript'],
      confidence: 'medium',
    };
  }
  return { cause: 'unknown', matchedCauses: [], confidence: 'unknown' };
}

function threadMetadata(events) {
  const threads = new Map();
  for (const event of events) {
    if (event?.ph !== 'M' || event?.name !== 'thread_name') continue;
    const key = `${event.pid}:${event.tid}`;
    threads.set(key, String(event.args?.name || event.args?.data?.name || ''));
  }
  return threads;
}

function isTopLevelTask(event) {
  if (event?.ph !== 'X' || !finite(Number(event.ts)) || !finite(Number(event.dur))) return false;
  return /(^|::)(RunTask|DoWork)$|RunTask|ProcessTaskFromWorkQueue|TaskQueueManager/i
    .test(String(event.name || ''));
}

function isGoal24MarkEvent(event) {
  return !!(
    parseGoal24TraceMarkName(event?.name)
    || parseGoal24TraceMarkName(event?.args?.data?.name)
    || parseGoal24TraceMarkName(event?.args?.name)
  );
}

function parseMarks(indexedEvents) {
  const marks = [];
  for (const { event, traceEventOrdinal } of indexedEvents) {
    if (!finite(Number(event?.ts))) continue;
    const parsed = parseGoal24TraceMarkName(event.name)
      || parseGoal24TraceMarkName(event.args?.data?.name)
      || parseGoal24TraceMarkName(event.args?.name);
    if (!parsed) continue;
    marks.push({
      ...parsed,
      tsUs: Number(event.ts),
      pid: event.pid,
      tid: event.tid,
      traceEventOrdinal,
    });
  }
  marks.sort((left, right) => left.tsUs - right.tsUs);
  return marks;
}

function windowFromMarks(id, marks) {
  const own = marks.filter((mark) => mark.id === id);
  const start = own.find((mark) => mark.phase === 'start');
  const contractEnd = [...own].reverse().find((mark) => (
    mark.phase === 'marker' && mark.label === 'post-outcome-render-boundary'
  ));
  const stopped = [...own].reverse().find((mark) => mark.phase === 'end');
  const end = contractEnd || stopped;
  if (!start || !end || end.tsUs < start.tsUs) return null;
  return { start, end, marks: own };
}

function rawEventEvidence(event) {
  return {
    ph: event?.ph ?? null,
    cat: event?.cat ?? null,
    name: event?.name ?? null,
    pid: event?.pid ?? null,
    tid: event?.tid ?? null,
    ts: event?.ts ?? null,
    dur: event?.dur ?? null,
    args: cloneJson(event?.args),
  };
}

function eventEvidence(indexed, startUs, endUs, metadata, rendererThreadKey) {
  const { event, traceEventOrdinal } = indexed;
  const classification = classifyEventCause(event);
  const durationTraceUs = eventDurationUs(event);
  const overlapTraceUs = overlapUs(event, startUs, endUs);
  const threadKey = `${event?.pid}:${event?.tid}`;
  return {
    traceEventOrdinal,
    name: String(event?.name || ''),
    category: String(event?.cat || ''),
    phase: event?.ph ?? null,
    pid: event?.pid ?? null,
    tid: event?.tid ?? null,
    threadName: metadata.get(threadKey) || null,
    onRendererMainThread: threadKey === rendererThreadKey,
    startedAtTraceUs: Number(event?.ts),
    durationTraceUs,
    durationMs: round(durationTraceUs / 1000),
    overlapTraceUs,
    overlapWithInteractionMs: round(overlapTraceUs / 1000),
    cause: classification.cause,
    matchedCauses: classification.matchedCauses,
    confidence: classification.confidence,
    arguments: flattenStrings(event?.args).slice(0, 24),
    stack: extractStack(event),
    rawEvidence: rawEventEvidence(event),
  };
}

function compareEvidenceStrength(left, right) {
  return right.overlapTraceUs - left.overlapTraceUs
    || right.durationTraceUs - left.durationTraceUs
    || left.startedAtTraceUs - right.startedAtTraceUs
    || Number(left.pid) - Number(right.pid)
    || Number(left.tid) - Number(right.tid)
    || left.traceEventOrdinal - right.traceEventOrdinal;
}

function strongestEvidence(evidence) {
  return [...evidence].sort(compareEvidenceStrength)[0] || null;
}

function causalConfiguration(options = {}) {
  const budgetMs = Number(options.causalBudgetMs ?? GOAL24_TRACE_CAUSAL_BUDGET_MS);
  const minimumMeaningfulOverlapMs = Number(
    options.minimumMeaningfulCausalOverlapMs
      ?? GOAL24_TRACE_MIN_MEANINGFUL_CAUSAL_OVERLAP_MS,
  );
  const minimumMeaningfulCoverageRatio = Number(
    options.minimumMeaningfulCausalCoverageRatio
      ?? GOAL24_TRACE_MIN_MEANINGFUL_CAUSAL_COVERAGE_RATIO,
  );
  if (!(budgetMs > 0) || !(minimumMeaningfulOverlapMs > 0)
    || !(minimumMeaningfulCoverageRatio > 0 && minimumMeaningfulCoverageRatio <= 1)) {
    throw new TypeError('Goal 24 trace causal thresholds are invalid.');
  }
  return { budgetMs, minimumMeaningfulOverlapMs, minimumMeaningfulCoverageRatio };
}

function assessCausalEvidence(selected, maximum, configuration) {
  const observedMaximumOverlapMs = maximum?.overlapWithInteractionMs ?? 0;
  const evidenceOverlapMs = selected?.overlapWithInteractionMs ?? 0;
  const coverageRatio = observedMaximumOverlapMs > 0
    ? evidenceOverlapMs / observedMaximumOverlapMs : 0;
  const classified = selected != null && selected.cause !== 'unknown'
    && selected.matchedCauses.length > 0;
  const meaningful = classified
    && evidenceOverlapMs >= configuration.minimumMeaningfulOverlapMs
    && coverageRatio >= configuration.minimumMeaningfulCoverageRatio;
  const overBudget = observedMaximumOverlapMs > configuration.budgetMs;
  return {
    budgetMs: configuration.budgetMs,
    minimumMeaningfulOverlapMs: configuration.minimumMeaningfulOverlapMs,
    minimumMeaningfulCoverageRatio: configuration.minimumMeaningfulCoverageRatio,
    observedMaximumOverlapMs,
    overBudget,
    strongestEvidenceOverlapMs: evidenceOverlapMs,
    strongestEvidenceCoverageRatio: roundRatio(coverageRatio),
    classified,
    meaningful,
    pass: !overBudget || meaningful,
    reason: meaningful
      ? 'duration-ranked-classified-causal-evidence'
      : overBudget
        ? 'over-budget-without-meaningful-classified-causal-evidence'
        : 'under-budget-cause-may-remain-unknown',
  };
}

export function analyzeGoal24ChromiumTrace(input, options = {}) {
  const trace = readTrace(input);
  const events = eventList(trace);
  const indexedEvents = events.map((event, traceEventOrdinal) => ({ event, traceEventOrdinal }));
  const marks = parseMarks(indexedEvents);
  const metadata = threadMetadata(events);
  const configuration = causalConfiguration(options);
  const ids = options.interactionIds?.length
    ? [...new Set(options.interactionIds.map(String))]
    : [...new Set(marks.map(({ id }) => id))];
  const interactions = [];
  const failures = [];

  if (!events.length) failures.push('traceEvents is empty');
  if (!marks.length) failures.push('no Goal 24 recorder-owned user-timing marks were captured');

  for (const id of ids) {
    const marked = windowFromMarks(id, marks);
    if (!marked) {
      interactions.push({ id, ok: false, reason: 'missing-ordered-start-and-end-trace-marks' });
      failures.push(`${id}: missing-ordered-start-and-end-trace-marks`);
      continue;
    }
    const { start, end } = marked;
    const rendererThreadKey = `${start.pid}:${start.tid}`;
    const temporalEvents = indexedEvents.filter(({ event }) => (
      touchesWindow(event, start.tsUs, end.tsUs)
    ));
    const durationEvents = temporalEvents.filter(({ event }) => (
      event?.ph !== 'M' && !isGoal24MarkEvent(event) && eventDurationUs(event) > 0
    ));
    const rendererEvents = durationEvents.filter(({ event }) => (
      event.pid === start.pid && event.tid === start.tid
    ));
    const topLevelTasks = rendererEvents.filter(({ event }) => isTopLevelTask(event));
    const rendererCompleteEvents = rendererEvents.filter(({ event }) => (
      event?.ph === 'X' && finite(Number(event.ts)) && finite(Number(event.dur))
    ));
    const longestTaskIndexed = [...(topLevelTasks.length ? topLevelTasks : rendererCompleteEvents)]
      .sort((left, right) => (
        overlapUs(right.event, start.tsUs, end.tsUs)
          - overlapUs(left.event, start.tsUs, end.tsUs)
        || eventDurationUs(right.event) - eventDurationUs(left.event)
      ))[0] || null;
    const evidence = durationEvents.map((entry) => (
      eventEvidence(entry, start.tsUs, end.tsUs, metadata, rendererThreadKey)
    ));
    const maximumOverlappingEvent = strongestEvidence(evidence);
    const semanticTemporalEvents = temporalEvents.filter(({ event }) => (
      event?.ph !== 'M' && !isGoal24MarkEvent(event) && !isTopLevelTask(event)
    ));
    const semanticEvidence = semanticTemporalEvents.map((entry) => (
      eventEvidence(entry, start.tsUs, end.tsUs, metadata, rendererThreadKey)
    ));
    const causalCandidates = semanticEvidence
      .filter((entry) => entry.cause !== 'unknown')
      .sort(compareEvidenceStrength)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
    const unclassifiedFallbackEvidence = strongestEvidence(
      semanticEvidence.filter((entry) => entry.cause === 'unknown'),
    );
    const longestMainThreadTask = longestTaskIndexed
      ? {
        ...eventEvidence(
          longestTaskIndexed,
          start.tsUs,
          end.tsUs,
          metadata,
          rendererThreadKey,
        ),
        selectionBasis: topLevelTasks.length
          ? 'longest-overlapping-top-level-renderer-main-thread-task'
          : 'longest-overlapping-complete-renderer-main-thread-event-fallback',
      }
      : null;
    const selected = causalCandidates[0] || unclassifiedFallbackEvidence || longestMainThreadTask;
    const assessment = assessCausalEvidence(selected, maximumOverlappingEvent, configuration);
    const threadKeys = new Set(temporalEvents.map(({ event }) => `${event.pid}:${event.tid}`));
    const causalScan = {
      scope: 'all-processes-all-threads-temporally-overlapping-interaction-window',
      temporallyOverlappingEventCount: temporalEvents.length,
      durationEventCount: durationEvents.length,
      processThreadCount: threadKeys.size,
      classifiedCandidateCount: causalCandidates.length,
      zeroDurationClassifiedCandidateCount: causalCandidates.filter(
        ({ durationTraceUs }) => durationTraceUs === 0,
      ).length,
      crossThreadClassifiedCandidateCount: causalCandidates.filter(
        ({ onRendererMainThread }) => !onRendererMainThread,
      ).length,
      maximumOverlappingEvent,
      unclassifiedFallbackEvidence,
    };
    const attribution = {
      cause: selected?.cause || 'unknown',
      matchedCauses: selected?.matchedCauses || [],
      confidence: selected?.confidence || 'unknown',
      selectionBasis: causalCandidates.length
        ? 'largest-temporal-overlap-then-longest-duration-across-all-processes-and-threads'
        : 'strongest-unclassified-overlap-fallback',
      candidateRank: causalCandidates.length ? 1 : null,
      evidence: selected || null,
      stack: selected?.stack || [],
    };
    interactions.push({
      id,
      scenario: start.scenario,
      ok: true,
      rendererThread: {
        pid: start.pid,
        tid: start.tid,
        name: metadata.get(rendererThreadKey) || null,
        identifiedBy: 'Goal 24 user-timing mark thread',
      },
      traceWindow: {
        startUs: start.tsUs,
        endUs: end.tsUs,
        durationMs: round((end.tsUs - start.tsUs) / 1000),
        endBasis: end.phase === 'marker' ? end.label : 'recorder-end',
        markCount: marked.marks.length,
      },
      longestMainThreadTask,
      causalScan,
      causalCandidates,
      strongestCausalEvidence: selected || null,
      causalAssessment: assessment,
      attribution,
    });
    if (!assessment.pass) {
      failures.push(
        `${id}: over-budget ${assessment.observedMaximumOverlapMs} ms event has no meaningful `
        + `classified causal evidence (strongest=${attribution.cause}, `
        + `overlap=${assessment.strongestEvidenceOverlapMs} ms, `
        + `coverage=${assessment.strongestEvidenceCoverageRatio})`,
      );
    }
  }

  return {
    schema: GOAL24_TRACE_ATTRIBUTION_SCHEMA,
    configuration,
    ok: failures.length === 0,
    failures,
    traceEventCount: events.length,
    goal24MarkCount: marks.length,
    interactionCount: interactions.length,
    interactions,
  };
}

function validateEvidenceBinding(evidence, entry, label, failures) {
  if (!evidence || typeof evidence !== 'object') {
    failures.push(`${label}: evidence is missing`);
    return false;
  }
  const raw = evidence.rawEvidence;
  if (!raw || typeof raw !== 'object') {
    failures.push(`${label}: raw candidate evidence is missing`);
    return false;
  }
  const expectedClassification = classifyEventCause(raw);
  const expectedOverlapUs = overlapUs(raw, entry.traceWindow.startUs, entry.traceWindow.endUs);
  const expectedDurationUs = eventDurationUs(raw);
  const rendererThreadKey = `${entry.rendererThread.pid}:${entry.rendererThread.tid}`;
  const rawThreadKey = `${raw.pid}:${raw.tid}`;
  const shapeValid = Number.isInteger(evidence.traceEventOrdinal)
    && evidence.traceEventOrdinal >= 0
    && evidence.name === String(raw.name || '')
    && evidence.category === String(raw.cat || '')
    && evidence.phase === (raw.ph ?? null)
    && evidence.pid === (raw.pid ?? null)
    && evidence.tid === (raw.tid ?? null)
    && evidence.startedAtTraceUs === Number(raw.ts)
    && evidence.durationTraceUs === expectedDurationUs
    && evidence.durationMs === round(expectedDurationUs / 1000)
    && evidence.overlapTraceUs === expectedOverlapUs
    && evidence.overlapWithInteractionMs === round(expectedOverlapUs / 1000)
    && evidence.onRendererMainThread === (rawThreadKey === rendererThreadKey)
    && evidence.cause === expectedClassification.cause
    && evidence.confidence === expectedClassification.confidence
    && isDeepStrictEqual(evidence.matchedCauses, expectedClassification.matchedCauses)
    && isDeepStrictEqual(evidence.arguments, flattenStrings(raw.args).slice(0, 24))
    && isDeepStrictEqual(evidence.stack, extractStack(raw));
  if (!shapeValid) {
    failures.push(`${label}: candidate fields differ from its preserved raw trace event`);
    return false;
  }
  if (!Number.isInteger(evidence.pid) || !Number.isInteger(evidence.tid)
    || !finite(evidence.startedAtTraceUs) || !finite(evidence.durationTraceUs)
    || !finite(evidence.overlapTraceUs) || evidence.durationTraceUs < 0
    || evidence.overlapTraceUs < 0 || evidence.overlapTraceUs > evidence.durationTraceUs) {
    failures.push(`${label}: candidate process/thread/timing provenance is malformed`);
    return false;
  }
  return true;
}

export function validateGoal24TraceAttribution(analysis, options = {}) {
  const failures = [];
  if (analysis?.schema !== GOAL24_TRACE_ATTRIBUTION_SCHEMA) {
    failures.push('trace attribution schema is missing or unsupported');
  }
  const expectedConfiguration = causalConfiguration(options);
  if (!isDeepStrictEqual(analysis?.configuration, expectedConfiguration)) {
    failures.push('trace attribution causal threshold configuration drifted');
  }
  if (analysis?.ok !== true) failures.push(...(analysis?.failures || ['trace attribution failed']));
  const interactions = Array.isArray(analysis?.interactions) ? analysis.interactions : [];
  if (!Number.isInteger(analysis?.traceEventCount) || analysis.traceEventCount < 1
    || !Number.isInteger(analysis?.goal24MarkCount) || analysis.goal24MarkCount < 1
    || analysis?.interactionCount !== interactions.length) {
    failures.push('trace attribution source-event/mark/interaction counts are malformed');
  }
  const requiredIds = [...new Set((options.requiredInteractionIds || []).map(String))];
  for (const id of requiredIds) {
    if (!interactions.some((entry) => entry.id === id && entry.ok === true)) {
      failures.push(`${id}: required trace attribution is missing`);
    }
  }
  const ids = new Set();
  for (const entry of interactions) {
    if (!entry?.ok) continue;
    if (!nonEmpty(entry.id) || ids.has(entry.id)) {
      failures.push(`${entry?.id || '(unknown)'}: interaction id is missing or duplicated`);
      continue;
    }
    ids.add(entry.id);
    if (!finite(entry.traceWindow?.startUs) || !finite(entry.traceWindow?.endUs)
      || entry.traceWindow.endUs < entry.traceWindow.startUs
      || entry.traceWindow.durationMs
        !== round((entry.traceWindow.endUs - entry.traceWindow.startUs) / 1000)) {
      failures.push(`${entry.id}: trace window timing is invalid`);
      continue;
    }
    if (!nonEmpty(entry.rendererThread?.identifiedBy)
      || !Number.isInteger(entry.rendererThread?.pid)
      || !Number.isInteger(entry.rendererThread?.tid)) {
      failures.push(`${entry.id}: renderer main-thread basis is missing`);
    }
    if (entry.longestMainThreadTask) {
      validateEvidenceBinding(
        entry.longestMainThreadTask,
        entry,
        `${entry.id}: longest renderer-main task`,
        failures,
      );
      if (!nonEmpty(entry.longestMainThreadTask.selectionBasis)
        || entry.longestMainThreadTask.onRendererMainThread !== true) {
        failures.push(`${entry.id}: longest renderer-main task selection provenance is invalid`);
      }
    }
    const scan = entry.causalScan;
    const candidates = Array.isArray(entry.causalCandidates) ? entry.causalCandidates : null;
    if (!scan || scan.scope
      !== 'all-processes-all-threads-temporally-overlapping-interaction-window'
      || !Number.isInteger(scan.temporallyOverlappingEventCount)
      || !Number.isInteger(scan.durationEventCount)
      || !Number.isInteger(scan.processThreadCount)
      || scan.temporallyOverlappingEventCount < scan.durationEventCount
      || scan.processThreadCount < 1 || !candidates) {
      failures.push(`${entry.id}: all-process/all-thread causal scan provenance is malformed`);
      continue;
    }
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      validateEvidenceBinding(candidate, entry, `${entry.id}: causal candidate ${index + 1}`, failures);
      if (candidate.rank !== index + 1 || candidate.cause === 'unknown'
        || !Array.isArray(candidate.matchedCauses) || candidate.matchedCauses.length === 0) {
        failures.push(`${entry.id}: causal candidate ${index + 1} rank/classification is invalid`);
      }
      if (index > 0 && compareEvidenceStrength(candidates[index - 1], candidate) > 0) {
        failures.push(`${entry.id}: causal candidates are not ranked by overlap then duration`);
      }
    }
    const crossThreadCount = candidates.filter(({ onRendererMainThread }) => !onRendererMainThread).length;
    const zeroDurationCount = candidates.filter(({ durationTraceUs }) => durationTraceUs === 0).length;
    if (scan.classifiedCandidateCount !== candidates.length
      || scan.crossThreadClassifiedCandidateCount !== crossThreadCount
      || scan.zeroDurationClassifiedCandidateCount !== zeroDurationCount) {
      failures.push(`${entry.id}: causal scan counts differ from preserved candidates`);
    }
    if (scan.maximumOverlappingEvent) {
      validateEvidenceBinding(
        scan.maximumOverlappingEvent,
        entry,
        `${entry.id}: maximum overlapping trace event`,
        failures,
      );
      if (candidates.some((candidate) => (
        candidate.overlapTraceUs > scan.maximumOverlappingEvent.overlapTraceUs
      )) || (entry.longestMainThreadTask
        && entry.longestMainThreadTask.overlapTraceUs
          > scan.maximumOverlappingEvent.overlapTraceUs)) {
        failures.push(`${entry.id}: maximum overlapping event is weaker than a causal candidate`);
      }
    }
    if (scan.unclassifiedFallbackEvidence) {
      validateEvidenceBinding(
        scan.unclassifiedFallbackEvidence,
        entry,
        `${entry.id}: unclassified fallback evidence`,
        failures,
      );
      if (scan.unclassifiedFallbackEvidence.cause !== 'unknown') {
        failures.push(`${entry.id}: unclassified fallback carries a forged classification`);
      }
    }
    const selected = candidates[0]
      || scan.unclassifiedFallbackEvidence
      || entry.longestMainThreadTask
      || null;
    if (!isDeepStrictEqual(entry.strongestCausalEvidence, selected)
      || !isDeepStrictEqual(entry.attribution?.evidence, selected)
      || entry.attribution?.cause !== (selected?.cause || 'unknown')
      || entry.attribution?.confidence !== (selected?.confidence || 'unknown')
      || !isDeepStrictEqual(entry.attribution?.matchedCauses, selected?.matchedCauses || [])
      || !isDeepStrictEqual(entry.attribution?.stack, selected?.stack || [])
      || entry.attribution?.candidateRank !== (candidates.length ? 1 : null)
      || entry.attribution?.selectionBasis !== (candidates.length
        ? 'largest-temporal-overlap-then-longest-duration-across-all-processes-and-threads'
        : 'strongest-unclassified-overlap-fallback')) {
      failures.push(`${entry.id}: strongest causal attribution differs from duration-ranked raw evidence`);
    }
    const recomputedAssessment = assessCausalEvidence(
      selected,
      scan.maximumOverlappingEvent,
      expectedConfiguration,
    );
    if (!isDeepStrictEqual(entry.causalAssessment, recomputedAssessment)) {
      failures.push(`${entry.id}: causal assessment differs from preserved timing evidence`);
    }
    if (recomputedAssessment.overBudget && !recomputedAssessment.meaningful) {
      failures.push(
        `${entry.id}: over-budget event has unknown or non-meaningful causal evidence`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}
