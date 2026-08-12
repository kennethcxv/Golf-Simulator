export const ASSET_IDLE_TIMEOUT_MS = 8000;

function finiteNow(now, fallback) {
  try {
    const value = Number(now());
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Resolve a bounded, immutable report for the shared loading-manager state.
 * Unlike a bare timeout race, the result never confuses "deadline elapsed"
 * with "all loaders settled". Callers that intend to compile or draw can
 * therefore fail closed while teardown callers can still wait best-effort.
 */
export function createAssetIdleBarrier({
  isIdle,
  subscribe,
  timeoutMs = ASSET_IDLE_TIMEOUT_MS,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  scheduleTimeout = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelTimeout = (handle) => clearTimeout(handle),
} = {}) {
  if (typeof isIdle !== 'function' || typeof subscribe !== 'function') {
    throw new TypeError('Asset idle barrier requires isIdle and subscribe functions.');
  }
  const boundedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) >= 0
    ? Number(timeoutMs)
    : ASSET_IDLE_TIMEOUT_MS;
  const startedAtMs = finiteNow(now, 0);
  const deadlineAtMs = startedAtMs + boundedTimeoutMs;

  const initiallyIdle = (() => {
    try { return isIdle() === true; } catch { return false; }
  })();
  if (initiallyIdle) {
    return Promise.resolve(Object.freeze({
      status: 'idle',
      safeToPrewarm: true,
      startedAtMs,
      deadlineAtMs,
      settledAtMs: startedAtMs,
      durationMs: 0,
      timeoutMs: boundedTimeoutMs,
      initiallyIdle: true,
    }));
  }

  return new Promise((resolve) => {
    let finished = false;
    let timerHandle = null;
    let unsubscribe = null;
    const finish = (status) => {
      if (finished) return;
      finished = true;
      if (timerHandle != null) {
        try { cancelTimeout(timerHandle); } catch { /* report still settles */ }
      }
      try { unsubscribe?.(); } catch { /* report still settles */ }
      const observedAtMs = finiteNow(now, status === 'timed-out' ? deadlineAtMs : startedAtMs);
      const settledAtMs = status === 'timed-out'
        ? Math.max(deadlineAtMs, observedAtMs)
        : Math.max(startedAtMs, observedAtMs);
      resolve(Object.freeze({
        status,
        safeToPrewarm: status === 'idle',
        startedAtMs,
        deadlineAtMs,
        settledAtMs,
        durationMs: settledAtMs - startedAtMs,
        timeoutMs: boundedTimeoutMs,
        initiallyIdle: false,
      }));
    };

    try {
      unsubscribe = subscribe(() => finish('idle'));
      // Close the race where the manager became idle between the first read and
      // installing the subscription.
      if (isIdle() === true) {
        finish('idle');
        return;
      }
      timerHandle = scheduleTimeout(() => finish('timed-out'), boundedTimeoutMs);
    } catch {
      finish('timed-out');
    }
  });
}
