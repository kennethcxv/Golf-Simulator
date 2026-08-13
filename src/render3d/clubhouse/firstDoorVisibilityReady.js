const SOURCE_NAMES = Object.freeze([
  'sheet06',
  'architecturalDoors',
  'props',
  'pineHillsInterior',
  'shedInterior',
  'modernPublic',
  'mountainLodge',
  'resortClubhouse',
  'premiumCountryClub',
]);

export const FIRST_DOOR_VISIBILITY_TIMEOUT_MS = 8000;

const DEGRADED_STATUSES = new Set([
  'degraded',
  'disposed',
  'error',
  'failed',
  'failure',
  'fallback',
  'partial',
  'timed-out',
  'timeout',
]);

const NOOP_DISPOSE = () => false;
const NOOP_SOURCE_SETTLEMENT = () => {};

function finiteNow(now, fallback) {
  try {
    const value = Number(now());
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function normalizedError(source, error, fallback = {}) {
  const read = (key) => {
    try {
      return error?.[key];
    } catch {
      return undefined;
    }
  };
  const rawName = read('name');
  const rawMessage = read('message');
  const rawCode = read('code');
  return {
    source,
    name: String(rawName || fallback.name || 'Error'),
    message: String(rawMessage || (typeof error === 'string' ? error : '')
      || fallback.message || 'Unknown first-door visibility readiness failure.'),
    code: rawCode == null && fallback.code == null
      ? null
      : String(rawCode ?? fallback.code),
  };
}

/**
 * Copy diagnostics into report-owned plain data. Loader results can contain
 * live Three.js objects, so non-plain instances are represented by identity
 * instead of being recursively frozen (which would mutate the running scene).
 */
function immutableSnapshot(value, seen = new WeakSet(), depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint' || typeof value === 'symbol') return String(value);
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (depth >= 12) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Error) {
    const snapshot = normalizedError(null, value);
    delete snapshot.source;
    return snapshot;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => immutableSnapshot(entry, seen, depth + 1));
  }

  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return { type: 'UnreadableObject' };
  }
  if (prototype !== Object.prototype && prototype !== null) {
    let type = 'Object';
    let name = null;
    try {
      type = value.constructor?.name || type;
      name = typeof value.name === 'string' && value.name ? value.name : null;
    } catch {
      // A hostile diagnostic proxy still gets a stable, report-owned summary.
    }
    return name ? { type, name } : { type };
  }

  const snapshot = {};
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return { type: 'UnreadableObject' };
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    snapshot[key] = Object.hasOwn(descriptor, 'value')
      ? immutableSnapshot(descriptor.value, seen, depth + 1)
      : '[Accessor]';
  }
  return snapshot;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function indicatesDegradation(value, seen = new WeakSet(), depth = 0) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((entry) => indicatesDegradation(entry, seen, depth + 1));
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if ((normalizedKey === 'status'
      || normalizedKey === 'lifecycle'
      || normalizedKey === 'activationstatus')
      && typeof entry === 'string'
      && DEGRADED_STATUSES.has(entry.toLowerCase())) return true;
    if (normalizedKey === 'ready' && entry === false) return true;
    if (normalizedKey === 'ok' && entry === false) return true;
    if ((normalizedKey === 'failed' || normalizedKey === 'failedassets')
      && Number(entry) > 0) return true;
    if (normalizedKey === 'failures' && Array.isArray(entry) && entry.length > 0) return true;
    if ((normalizedKey === 'error' || normalizedKey.endsWith('error')) && entry != null) return true;
    // This is a source-level contract. Sheet-6 deliberately embeds an adapter
    // diagnostic with `actualSharedGameIntegrated:false`: the adapter is only a
    // template/cache layer and the enclosing production runtime is the object
    // that owns live integration. Recursing this heuristic made a healthy,
    // active top-level runtime report itself as degraded on every scene start.
    if (depth === 0 && normalizedKey === 'actualsharedgameintegrated' && entry === false) {
      return true;
    }
    if (indicatesDegradation(entry, seen, depth + 1)) return true;
  }
  return false;
}

/**
 * Join the eagerly-started clubhouse runtimes that can still mount or batch
 * geometry visible at the main entrance. The returned promise always resolves
 * once: either after all nine required sources settle, after an omitted source
 * is identified as an unsafe integration error, or at the fixed deadline.
 *
 * `diagnostics` accepts source-keyed snapshot functions (or already-captured
 * values). A rejected source produces a safe-to-prewarm degraded report once
 * every source has settled. A deadline with pending sources is not safe to
 * prewarm because those loaders can still mutate the scene later.
 */
export function createFirstDoorVisibilityReady({
  sheet06,
  architecturalDoors,
  props,
  pineHillsInterior,
  shedInterior,
  modernPublic,
  mountainLodge,
  resortClubhouse,
  premiumCountryClub,
  diagnostics = {},
  timeoutMs = FIRST_DOOR_VISIBILITY_TIMEOUT_MS,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  scheduleTimeout = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelTimeout = (handle) => clearTimeout(handle),
} = {}) {
  const boundedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) >= 0
    ? Number(timeoutMs)
    : FIRST_DOOR_VISIBILITY_TIMEOUT_MS;
  const startedAtMs = finiteNow(now, 0);
  const deadlineAtMs = startedAtMs + boundedTimeoutMs;
  const inputs = {
    sheet06,
    architecturalDoors,
    props,
    pineHillsInterior,
    shedInterior,
    modernPublic,
    mountainLodge,
    resortClubhouse,
    premiumCountryClub,
  };
  const settlements = Object.fromEntries(SOURCE_NAMES.map((source) => [source, {
    status: inputs[source] == null ? 'missing' : 'pending',
    value: null,
    error: null,
  }]));
  let finished = false;
  let timerHandle = null;
  let timerScheduleError = null;
  let resolveBarrier;
  const barrier = new Promise((resolve) => { resolveBarrier = resolve; });
  let settleSource = NOOP_SOURCE_SETTLEMENT;

  const finish = (reason) => {
    if (finished) return;
    finished = true;
    if (timerHandle != null) {
      try {
        cancelTimeout(timerHandle);
      } catch {
        // A failed timer cancellation cannot reopen or reject the barrier.
      }
    }

    const observedAtMs = finiteNow(now, reason === 'timeout' ? deadlineAtMs : startedAtMs);
    const settledAtMs = reason === 'timeout'
      ? Math.max(deadlineAtMs, observedAtMs)
      : Math.max(startedAtMs, observedAtMs);
    const pending = [];
    const errors = [];
    const values = {};
    const diagnosticSnapshots = {};
    const settlementSnapshots = {};
    const degradedSources = new Set();

    for (const source of SOURCE_NAMES) {
      const settlement = settlements[source];
      if (settlement.status === 'pending') pending.push(source);
      if (settlement.status === 'missing') {
        errors.push(normalizedError(source, null, {
          name: 'MissingReadinessSourceError',
          code: 'FIRST_DOOR_SOURCE_MISSING',
          message: `Required first-door readiness source is missing: ${source}.`,
        }));
        degradedSources.add(source);
      }
      if (settlement.status === 'rejected') {
        errors.push(normalizedError(source, settlement.error));
        degradedSources.add(source);
      }
      values[source] = settlement.status === 'fulfilled'
        ? immutableSnapshot(settlement.value)
        : null;
      settlementSnapshots[source] = { status: settlement.status };

      try {
        const provider = reason === 'disposed' ? null : diagnostics?.[source];
        const diagnostic = typeof provider === 'function'
          ? provider({
            source,
            status: settlement.status,
            value: settlement.status === 'fulfilled' ? settlement.value : null,
          })
          : (provider ?? null);
        diagnosticSnapshots[source] = immutableSnapshot(diagnostic);
        if (indicatesDegradation(values[source])
          || indicatesDegradation(diagnosticSnapshots[source])) degradedSources.add(source);
      } catch (error) {
        diagnosticSnapshots[source] = null;
        errors.push(normalizedError(source, error, {
          name: 'DiagnosticError',
          code: 'FIRST_DOOR_DIAGNOSTIC_FAILED',
        }));
        degradedSources.add(source);
      }
    }

    if (timerScheduleError) {
      errors.push(normalizedError('barrier', timerScheduleError, {
        name: 'TimeoutScheduleError',
        code: 'FIRST_DOOR_TIMEOUT_SCHEDULE_FAILED',
      }));
    }
    if (reason === 'timeout') {
      errors.push(normalizedError('barrier', null, {
        name: 'TimeoutError',
        code: 'FIRST_DOOR_VISIBILITY_TIMEOUT',
        message: `First-door visibility readiness exceeded ${boundedTimeoutMs} ms.`,
      }));
    }
    if (reason === 'disposed') {
      errors.push(normalizedError('barrier', null, {
        name: 'DisposedError',
        code: 'FIRST_DOOR_VISIBILITY_DISPOSED',
        message: 'First-door visibility readiness was disposed before settlement.',
      }));
    }

    const hasMissingSource = SOURCE_NAMES.some(
      (source) => settlements[source].status === 'missing',
    );
    const status = reason === 'disposed'
      ? 'disposed'
      : (reason === 'timeout'
        ? 'timed-out'
        : (hasMissingSource
          ? 'invalid'
          : (degradedSources.size > 0 || errors.length > 0 ? 'degraded' : 'ready')));
    const report = deepFreeze({
      status,
      safeToPrewarm: status === 'ready' || status === 'degraded',
      startedAtMs,
      deadlineAtMs,
      settledAtMs,
      durationMs: settledAtMs - startedAtMs,
      timeoutMs: boundedTimeoutMs,
      pending,
      degradedSources: [...degradedSources],
      errors,
      settlements: settlementSnapshots,
      values,
      diagnostics: diagnosticSnapshots,
    });
    resolveBarrier(report);

    // Do not retain live runtime values or diagnostic closures after any terminal
    // outcome. Pending source promises keep only the small settlement callback.
    for (const source of SOURCE_NAMES) {
      inputs[source] = null;
      settlements[source].value = null;
      settlements[source].error = null;
    }
    diagnostics = null;
    timerHandle = null;
    timerScheduleError = null;
    resolveBarrier = null;
    settleSource = NOOP_SOURCE_SETTLEMENT;
    Object.defineProperty(barrier, 'dispose', {
      configurable: true,
      value: NOOP_DISPOSE,
    });
  };

  const activeSources = SOURCE_NAMES.filter((source) => inputs[source] != null);
  let remainingSources = activeSources.length;
  settleSource = (source, status, payload) => {
    if (finished) return;
    settlements[source].status = status;
    if (status === 'fulfilled') settlements[source].value = payload;
    else settlements[source].error = payload;
    remainingSources -= 1;
    if (remainingSources === 0) finish('all-settled');
  };
  for (const source of activeSources) {
    void Promise.resolve(inputs[source]).then(
      (value) => settleSource(source, 'fulfilled', value),
      (error) => settleSource(source, 'rejected', error),
    );
  }

  Object.defineProperty(barrier, 'dispose', {
    configurable: true,
    value: () => {
      if (!finished) {
        finish('disposed');
        return true;
      }
      return false;
    },
  });

  try {
    timerHandle = scheduleTimeout(() => finish('timeout'), boundedTimeoutMs);
  } catch (error) {
    timerScheduleError = error;
    finish('timeout');
  }
  if (remainingSources === 0 && !finished) finish('all-settled');

  return barrier;
}
