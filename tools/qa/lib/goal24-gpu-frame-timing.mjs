// Goal 24 GPU/CPU render-submit timing.
//
// The browser-side factory is intentionally self-contained so an Electron
// Playwright driver can inject it with `goal24GpuFrameTimingFactorySource()`.
// The probe never substitutes display cadence or CPU time for unavailable GPU
// time. GPU samples only come from completed, non-disjoint
// EXT_disjoint_timer_query_webgl2 TIME_ELAPSED_EXT queries.

export const GOAL24_GPU_FRAME_TIMING_SCHEMA_VERSION = 1;
export const GOAL24_GPU_FRAME_TIMING_EXTENSION = 'EXT_disjoint_timer_query_webgl2';

/**
 * Create a browser-side timing probe around a synchronous render submission.
 *
 * Typical page usage:
 *
 *   const detach = probe.wrapRender(scene3d, 'render');
 *   // ...run the fixed matrix route...
 *   await probe.flush();
 *   const evidence = probe.snapshot();
 *   probe.dispose();
 *
 * Callers that own the hook can instead use beginFrame/endFrame or
 * measureFrameSubmit. No hook is installed automatically.
 */
export function createGoal24GpuFrameTimingProbe(options = {}) {
  // Keep every dependency inside this function. Its source is injected into
  // the Electron renderer by the QA driver rather than bundled into shipping
  // code.
  const schemaVersion = 1;
  const extensionName = 'EXT_disjoint_timer_query_webgl2';
  const gl = options.gl ?? null;
  const clock = typeof options.clock === 'function'
    ? options.clock
    : () => typeof globalThis.performance?.now === 'function'
      ? globalThis.performance.now()
      : Number.NaN;
  const schedulePoll = typeof options.schedulePoll === 'function'
    ? options.schedulePoll
    : (callback) => {
      if (typeof globalThis.requestAnimationFrame === 'function') {
        return globalThis.requestAnimationFrame(callback);
      }
      return globalThis.setTimeout(callback, 16);
    };
  const cancelPoll = typeof options.cancelPoll === 'function'
    ? options.cancelPoll
    : (handle) => {
      if (typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(handle);
      } else {
        globalThis.clearTimeout(handle);
      }
    };
  const setTimer = typeof options.setTimer === 'function'
    ? options.setTimer
    : (callback, delay) => globalThis.setTimeout(callback, delay);
  const clearTimer = typeof options.clearTimer === 'function'
    ? options.clearTimer
    : (handle) => globalThis.clearTimeout(handle);

  const boundedInteger = (value, fallback, minimum, maximum) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.floor(numeric)));
  };
  const maxSamples = boundedInteger(options.maxSamples, 18_000, 1, 1_000_000);
  const maxPendingQueries = boundedInteger(options.maxPendingQueries, 8, 1, 256);
  const maxQueriesPerPoll = boundedInteger(options.maxQueriesPerPoll, 4, 1, 256);
  const maxPollAttemptsPerQuery = boundedInteger(
    options.maxPollAttemptsPerQuery,
    240,
    1,
    10_000,
  );
  const sampleEveryNFrames = boundedInteger(options.sampleEveryNFrames, 1, 1, 1_000);
  // During an active matrix route, the next beginFrame performs the bounded
  // query poll. This avoids adding a second rAF chain to the measured window.
  // flush() temporarily enables scheduled polling after the route. The opt-in
  // mode exists for callers with sparse render hooks.
  const autoSchedulePolls = options.autoSchedulePolls === true;
  const maxErrors = boundedInteger(options.maxErrors, 32, 1, 1_000);

  const cpuStartAtMs = new Float64Array(maxSamples);
  const cpuEndAtMs = new Float64Array(maxSamples);
  const cpuDurationMs = new Float64Array(maxSamples);
  const cpuFrameSequence = new Uint32Array(maxSamples);
  const cpuMetadata = new Array(maxSamples);
  const gpuDurationNs = new Float64Array(maxSamples);
  const gpuDurationMs = new Float64Array(maxSamples);
  const gpuFrameSequence = new Uint32Array(maxSamples);
  const gpuQueryOrdinal = new Uint32Array(maxSamples);
  const gpuMetadata = new Array(maxSamples);

  let cpuSampleCount = 0;
  let gpuSampleCount = 0;
  let nextFrameSequence = 1;
  let nextQueryOrdinal = 1;
  let framesBegun = 0;
  let framesEnded = 0;
  let incompleteFrameCount = 0;
  let invalidCpuSampleCount = 0;
  let cpuCapacitySkippedCount = 0;
  let gpuCapacitySkippedCount = 0;
  let gpuSamplingIntervalSkippedCount = 0;
  let gpuTimedOutQueryCount = 0;
  let gpuAbortedQueryCount = 0;
  let gpuDisposedPendingQueryCount = 0;
  let gpuInvalidResultCount = 0;
  let gpuQueriesCreated = 0;
  let gpuQueriesDeleted = 0;
  let gpuQueryDeleteFailureCount = 0;
  let pollsScheduled = 0;
  let pollsCompleted = 0;
  let activeFrame = null;
  let disposed = false;
  let pollScheduled = false;
  let pollHandle = null;
  let schedulingPoll = false;
  let synchronousPollCallbackObserved = false;
  let timerExtension = null;
  let gpuInitialState = 'unavailable';
  let gpuInitialReason = 'webgl-context-unavailable';
  let gpuFatalState = null;
  let gpuFatalReason = null;
  let gpuDisjointObserved = false;
  let gpuContextLostObserved = false;
  let errorOverflowCount = 0;
  const errors = [];
  const pendingQueries = [];
  const liveQueries = new Map();
  const wrappers = new Set();
  const flushWaiters = new Set();

  const finiteOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const normalizePrimitive = (value) => {
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    return String(value);
  };
  const normalizeMetadata = (metadata) => {
    if (metadata == null) return null;
    if (typeof metadata !== 'object') return { label: normalizePrimitive(metadata) };
    const normalized = {};
    // A deliberately small, allocation-bounded evidence vocabulary. Unknown
    // objects are not retained by the probe.
    for (const key of [
      'frameIndex',
      'rendererFrame',
      'scenario',
      'label',
      'mode',
      'qualityPreset',
    ]) {
      if (Object.prototype.hasOwnProperty.call(metadata, key)) {
        normalized[key] = normalizePrimitive(metadata[key]);
      }
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
  };
  const errorMessage = (error) => {
    if (error instanceof Error) return error.message;
    return String(error ?? 'unknown error');
  };
  const recordError = (phase, error, details = null) => {
    const entry = {
      phase: String(phase),
      message: errorMessage(error),
      frameSequence: finiteOrNull(details?.frameSequence),
      queryOrdinal: finiteOrNull(details?.queryOrdinal),
    };
    if (errors.length < maxErrors) errors.push(entry);
    else errorOverflowCount += 1;
    return entry;
  };
  const makeGpuFatal = (state, reason, error = null, details = null) => {
    if (gpuFatalState == null) {
      gpuFatalState = state;
      gpuFatalReason = reason;
    }
    if (error != null) recordError(`gpu-${reason}`, error, details);
  };

  const contextReadFailures = [];
  const readContextParameter = (label, parameter) => {
    if (!gl || typeof gl.getParameter !== 'function' || !Number.isFinite(Number(parameter))) {
      contextReadFailures.push({ field: label, reason: 'parameter-unavailable' });
      return null;
    }
    try {
      const value = gl.getParameter(parameter);
      return value == null ? null : normalizePrimitive(value);
    } catch (error) {
      contextReadFailures.push({ field: label, reason: errorMessage(error) });
      return null;
    }
  };
  const normalizeAttributes = (attributes) => {
    if (!attributes || typeof attributes !== 'object') return null;
    const normalized = {};
    for (const key of Object.keys(attributes).sort()) {
      const value = attributes[key];
      if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
        normalized[key] = normalizePrimitive(value);
      }
    }
    return normalized;
  };
  const readContextAttributes = () => {
    if (!gl || typeof gl.getContextAttributes !== 'function') return null;
    try {
      return normalizeAttributes(gl.getContextAttributes());
    } catch (error) {
      contextReadFailures.push({ field: 'contextAttributes', reason: errorMessage(error) });
      return null;
    }
  };
  const readSupportedExtensions = () => {
    if (!gl || typeof gl.getSupportedExtensions !== 'function') return null;
    try {
      const extensions = gl.getSupportedExtensions();
      return Array.isArray(extensions) ? [...extensions].map(String).sort() : null;
    } catch (error) {
      contextReadFailures.push({ field: 'supportedExtensions', reason: errorMessage(error) });
      return null;
    }
  };
  const getExtension = (name, { required = false } = {}) => {
    if (!gl || typeof gl.getExtension !== 'function') return null;
    try {
      return gl.getExtension(name);
    } catch (error) {
      if (required) makeGpuFatal('error', 'extension-discovery-failed', error);
      else contextReadFailures.push({ field: name, reason: errorMessage(error) });
      return null;
    }
  };

  const version = readContextParameter('version', gl?.VERSION);
  const shadingLanguageVersion = readContextParameter(
    'shadingLanguageVersion',
    gl?.SHADING_LANGUAGE_VERSION,
  );
  const standardVendor = readContextParameter('vendor', gl?.VENDOR);
  const standardRenderer = readContextParameter('renderer', gl?.RENDERER);
  const debugRendererExtension = getExtension('WEBGL_debug_renderer_info');
  const unmaskedVendor = debugRendererExtension
    ? readContextParameter('unmaskedVendor', debugRendererExtension.UNMASKED_VENDOR_WEBGL)
    : null;
  const unmaskedRenderer = debugRendererExtension
    ? readContextParameter('unmaskedRenderer', debugRendererExtension.UNMASKED_RENDERER_WEBGL)
    : null;
  const contextAttributes = readContextAttributes();
  const supportedExtensions = readSupportedExtensions();
  timerExtension = getExtension(extensionName, { required: true });

  const queryApiProof = {
    createQuery: typeof gl?.createQuery === 'function',
    deleteQuery: typeof gl?.deleteQuery === 'function',
    beginQuery: typeof gl?.beginQuery === 'function',
    endQuery: typeof gl?.endQuery === 'function',
    getQueryParameter: typeof gl?.getQueryParameter === 'function',
    queryResultAvailableConstant: Number.isFinite(Number(gl?.QUERY_RESULT_AVAILABLE)),
    queryResultConstant: Number.isFinite(Number(gl?.QUERY_RESULT)),
    timeElapsedConstant: Number.isFinite(Number(timerExtension?.TIME_ELAPSED_EXT)),
    gpuDisjointConstant: Number.isFinite(Number(timerExtension?.GPU_DISJOINT_EXT)),
  };
  const queryApiComplete = Object.values(queryApiProof).every(Boolean);
  const webgl2VersionClaim = typeof version === 'string' && /WebGL\s*2(?:\.0)?/i.test(version);
  if (gpuFatalState == null && !gl) {
    gpuInitialState = 'unavailable';
    gpuInitialReason = 'webgl-context-unavailable';
  } else if (gpuFatalState == null && !webgl2VersionClaim) {
    gpuInitialState = 'unavailable';
    gpuInitialReason = 'context-is-not-proven-webgl2';
  } else if (gpuFatalState == null && !timerExtension) {
    gpuInitialState = 'unavailable';
    gpuInitialReason = 'timer-query-extension-unavailable';
  } else if (gpuFatalState == null && !queryApiComplete) {
    gpuInitialState = 'unavailable';
    gpuInitialReason = 'webgl2-query-api-incomplete';
  } else if (gpuFatalState == null) {
    gpuInitialState = 'available';
    gpuInitialReason = null;
  }

  const contextIdentity = {
    source: String(options.contextSource ?? 'caller-supplied WebGL context'),
    label: String(options.contextLabel ?? 'goal24-primary-render-context'),
    version,
    shadingLanguageVersion,
    standardVendor,
    standardRenderer,
    unmaskedVendor,
    unmaskedRenderer,
    drawingBufferWidth: finiteOrNull(gl?.drawingBufferWidth),
    drawingBufferHeight: finiteOrNull(gl?.drawingBufferHeight),
    canvas: gl?.canvas ? {
      id: String(gl.canvas.id ?? ''),
      width: finiteOrNull(gl.canvas.width),
      height: finiteOrNull(gl.canvas.height),
    } : null,
    contextAttributes,
    supportedExtensions,
    contextReadFailures,
    proof: {
      webgl2VersionClaim,
      queryApi: queryApiProof,
      queryApiComplete,
      timerQueryExtensionRequested: extensionName,
      timerQueryExtensionAvailable: !!timerExtension,
      timerQueryAdvertised: supportedExtensions == null
        ? null
        : supportedExtensions.includes(extensionName),
      debugRendererInfoAvailable: !!debugRendererExtension,
    },
  };

  const safeDeleteQuery = (record, phase = 'delete-query') => {
    if (!record || !liveQueries.has(record.queryOrdinal)) return true;
    try {
      gl.deleteQuery(record.query);
      liveQueries.delete(record.queryOrdinal);
      gpuQueriesDeleted += 1;
      return true;
    } catch (error) {
      gpuQueryDeleteFailureCount += 1;
      recordError(phase, error, record);
      return false;
    }
  };
  const deleteAllPendingQueries = (phase) => {
    for (const record of pendingQueries.splice(0)) safeDeleteQuery(record, phase);
  };
  const invalidateAcceptedGpuSamples = () => {
    // Raw numeric results remain visible, but snapshot validity is global and
    // summaries are suppressed after a disjoint/context-loss event.
  };
  const observeContextLoss = () => {
    if (!gl || typeof gl.isContextLost !== 'function') return false;
    try {
      if (!gl.isContextLost()) return false;
      gpuContextLostObserved = true;
      makeGpuFatal('invalid-context-lost', 'webgl-context-lost');
      invalidateAcceptedGpuSamples();
      deleteAllPendingQueries('delete-after-context-loss');
      return true;
    } catch (error) {
      makeGpuFatal('error', 'context-loss-check-failed', error);
      deleteAllPendingQueries('delete-after-context-loss-check-error');
      return true;
    }
  };
  const observeDisjoint = () => {
    if (gpuInitialState !== 'available' || gpuFatalState != null) return false;
    try {
      if (!gl.getParameter(timerExtension.GPU_DISJOINT_EXT)) return false;
      gpuDisjointObserved = true;
      makeGpuFatal('invalid-disjoint', 'gpu-disjoint-observed');
      invalidateAcceptedGpuSamples();
      deleteAllPendingQueries('delete-after-disjoint');
      return true;
    } catch (error) {
      makeGpuFatal('error', 'gpu-disjoint-read-failed', error);
      deleteAllPendingQueries('delete-after-disjoint-read-error');
      return true;
    }
  };
  const gpuCanStartQuery = () => (
    !disposed
    && gpuInitialState === 'available'
    && gpuFatalState == null
    && !gpuDisjointObserved
    && !gpuContextLostObserved
  );

  const resolveFlushWaiters = (force = false) => {
    if (!force && pendingQueries.length > 0 && gpuFatalState == null && !disposed) return;
    for (const waiter of [...flushWaiters]) {
      flushWaiters.delete(waiter);
      if (waiter.timer != null) {
        try {
          clearTimer(waiter.timer);
        } catch (error) {
          recordError('clear-flush-timer', error);
        }
      }
      waiter.resolve(snapshot());
    }
  };

  const collectAvailable = (requestedLimit = maxQueriesPerPoll) => {
    const limit = boundedInteger(requestedLimit, maxQueriesPerPoll, 1, 10_000);
    if (disposed) {
      return { inspected: 0, collected: 0, pending: 0, state: 'disposed' };
    }
    if (pendingQueries.length === 0) {
      resolveFlushWaiters();
      return { inspected: 0, collected: 0, pending: 0, state: 'empty' };
    }
    if (observeContextLoss() || observeDisjoint()) {
      resolveFlushWaiters(true);
      return {
        inspected: 0,
        collected: 0,
        pending: pendingQueries.length,
        state: gpuFatalState,
      };
    }

    let inspected = 0;
    let collected = 0;
    let index = 0;
    while (index < pendingQueries.length && inspected < limit) {
      const record = pendingQueries[index];
      inspected += 1;
      record.pollAttempts += 1;
      let available;
      try {
        available = !!gl.getQueryParameter(record.query, gl.QUERY_RESULT_AVAILABLE);
      } catch (error) {
        pendingQueries.splice(index, 1);
        safeDeleteQuery(record, 'delete-after-availability-error');
        makeGpuFatal('error', 'query-availability-read-failed', error, record);
        deleteAllPendingQueries('delete-after-query-availability-error');
        break;
      }
      if (!available) {
        if (record.pollAttempts >= maxPollAttemptsPerQuery) {
          pendingQueries.splice(index, 1);
          gpuTimedOutQueryCount += 1;
          safeDeleteQuery(record, 'delete-timed-out-query');
          continue;
        }
        index += 1;
        continue;
      }

      let durationNs;
      try {
        durationNs = Number(gl.getQueryParameter(record.query, gl.QUERY_RESULT));
      } catch (error) {
        pendingQueries.splice(index, 1);
        safeDeleteQuery(record, 'delete-after-result-error');
        makeGpuFatal('error', 'query-result-read-failed', error, record);
        deleteAllPendingQueries('delete-after-query-result-error');
        break;
      }
      pendingQueries.splice(index, 1);
      safeDeleteQuery(record, 'delete-completed-query');
      if (!Number.isFinite(durationNs) || durationNs < 0) {
        gpuInvalidResultCount += 1;
        makeGpuFatal(
          'error',
          'query-result-invalid',
          new Error('GPU query result must be a finite, non-negative nanosecond value.'),
          record,
        );
        deleteAllPendingQueries('delete-after-invalid-query-result');
        break;
      }
      if (gpuSampleCount >= maxSamples) {
        gpuCapacitySkippedCount += 1;
        continue;
      }
      const sampleIndex = gpuSampleCount;
      gpuDurationNs[sampleIndex] = durationNs;
      gpuDurationMs[sampleIndex] = durationNs / 1_000_000;
      gpuFrameSequence[sampleIndex] = record.frameSequence;
      gpuQueryOrdinal[sampleIndex] = record.queryOrdinal;
      gpuMetadata[sampleIndex] = record.metadata;
      gpuSampleCount += 1;
      collected += 1;
    }
    resolveFlushWaiters();
    return {
      inspected,
      collected,
      pending: pendingQueries.length,
      state: gpuFatalState ?? 'available',
    };
  };

  const ensurePollScheduled = () => {
    if (disposed || pollScheduled || pendingQueries.length === 0 || gpuFatalState != null) return;
    pollScheduled = true;
    schedulingPoll = true;
    let callbackRanSynchronously = false;
    try {
      const handle = schedulePoll(() => {
        callbackRanSynchronously = schedulingPoll;
        if (callbackRanSynchronously) synchronousPollCallbackObserved = true;
        pollScheduled = false;
        pollHandle = null;
        pollsCompleted += 1;
        if (disposed) return;
        collectAvailable(maxQueriesPerPoll);
        // A synchronous scheduler is not permitted to recurse. A later frame,
        // explicit collect, or flush can advance collection safely.
        if (!callbackRanSynchronously) ensurePollScheduled();
      });
      pollHandle = handle;
      pollsScheduled += 1;
    } catch (error) {
      pollScheduled = false;
      pollHandle = null;
      makeGpuFatal('error', 'poll-scheduler-failed', error);
      deleteAllPendingQueries('delete-after-poll-scheduler-error');
      resolveFlushWaiters(true);
    } finally {
      schedulingPoll = false;
    }
  };

  const beginFrame = (metadata = null) => {
    if (disposed) throw new Error('Goal 24 GPU frame-timing probe is disposed.');
    if (activeFrame != null) {
      incompleteFrameCount += 1;
      recordError(
        'frame-lifecycle',
        new Error('A frame is already active; nested render timing is unsupported.'),
        activeFrame,
      );
      throw new Error('Goal 24 GPU frame-timing probe already has an active frame.');
    }
    collectAvailable(maxQueriesPerPoll);
    const frameSequence = nextFrameSequence;
    nextFrameSequence += 1;
    framesBegun += 1;
    let startedAtMs = Number.NaN;
    try {
      startedAtMs = Number(clock());
    } catch (error) {
      recordError('cpu-submit-clock-start', error, { frameSequence });
    }
    let normalizedMetadata = null;
    try {
      normalizedMetadata = normalizeMetadata(metadata);
    } catch (error) {
      recordError('frame-metadata-normalization', error, { frameSequence });
    }
    const record = {
      token: Object.freeze({ frameSequence }),
      frameSequence,
      startedAtMs,
      metadata: normalizedMetadata,
      query: null,
      queryOrdinal: null,
      queryBegan: false,
    };

    if ((frameSequence - 1) % sampleEveryNFrames !== 0) {
      gpuSamplingIntervalSkippedCount += 1;
    } else if (gpuCanStartQuery()) {
      if (gpuSampleCount + pendingQueries.length >= maxSamples
        || pendingQueries.length >= maxPendingQueries) {
        gpuCapacitySkippedCount += 1;
      } else if (observeContextLoss() || observeDisjoint()) {
        // The explicit fatal state is already recorded by the observer.
      } else {
        let query = null;
        const queryOrdinal = nextQueryOrdinal;
        nextQueryOrdinal += 1;
        try {
          query = gl.createQuery();
          if (!query) throw new Error('WebGL2 createQuery returned null.');
          record.query = query;
          record.queryOrdinal = queryOrdinal;
          liveQueries.set(queryOrdinal, record);
          gpuQueriesCreated += 1;
          gl.beginQuery(timerExtension.TIME_ELAPSED_EXT, query);
          record.queryBegan = true;
        } catch (error) {
          if (query) safeDeleteQuery(record, 'delete-after-begin-query-error');
          makeGpuFatal('error', 'begin-query-failed', error, record);
          record.query = null;
          record.queryOrdinal = null;
          record.queryBegan = false;
          deleteAllPendingQueries('delete-after-begin-query-error');
        }
      }
    }
    activeFrame = record;
    return record.token;
  };

  const finishActiveQuery = (record) => {
    if (!record?.query || !record.queryBegan) return;
    try {
      gl.endQuery(timerExtension.TIME_ELAPSED_EXT);
      record.queryBegan = false;
      record.pollAttempts = 0;
      pendingQueries.push(record);
    } catch (error) {
      record.queryBegan = false;
      safeDeleteQuery(record, 'delete-after-end-query-error');
      makeGpuFatal('error', 'end-query-failed', error, record);
      deleteAllPendingQueries('delete-after-end-query-error');
    }
  };
  const abortActiveQuery = (record, phase) => {
    if (!record?.query) return;
    gpuAbortedQueryCount += 1;
    if (record.queryBegan) {
      try {
        gl.endQuery(timerExtension.TIME_ELAPSED_EXT);
      } catch (error) {
        recordError(`${phase}-end-query`, error, record);
      }
      record.queryBegan = false;
    }
    safeDeleteQuery(record, `${phase}-delete-query`);
  };

  const endFrame = (token) => {
    if (disposed) throw new Error('Goal 24 GPU frame-timing probe is disposed.');
    if (activeFrame == null) {
      incompleteFrameCount += 1;
      recordError('frame-lifecycle', new Error('No frame is active.'));
      throw new Error('Goal 24 GPU frame-timing probe has no active frame.');
    }
    if (token !== activeFrame.token) {
      const rejected = activeFrame;
      activeFrame = null;
      incompleteFrameCount += 1;
      abortActiveQuery(rejected, 'wrong-token');
      recordError(
        'frame-lifecycle',
        new Error('endFrame received a token that does not own the active frame.'),
        rejected,
      );
      throw new Error('Goal 24 GPU frame-timing token does not own the active frame.');
    }

    const record = activeFrame;
    activeFrame = null;
    let endedAtMs = Number.NaN;
    try {
      endedAtMs = Number(clock());
    } catch (error) {
      recordError('cpu-submit-clock-end', error, record);
    }
    finishActiveQuery(record);
    framesEnded += 1;
    const durationMs = endedAtMs - record.startedAtMs;
    if (!Number.isFinite(record.startedAtMs)
      || !Number.isFinite(endedAtMs)
      || !Number.isFinite(durationMs)
      || durationMs < 0) {
      invalidCpuSampleCount += 1;
      recordError(
        'cpu-submit-clock',
        new Error('CPU submit timing requires finite, monotonic millisecond clock values.'),
        record,
      );
    } else if (cpuSampleCount >= maxSamples) {
      cpuCapacitySkippedCount += 1;
    } else {
      const sampleIndex = cpuSampleCount;
      cpuStartAtMs[sampleIndex] = record.startedAtMs;
      cpuEndAtMs[sampleIndex] = endedAtMs;
      cpuDurationMs[sampleIndex] = durationMs;
      cpuFrameSequence[sampleIndex] = record.frameSequence;
      cpuMetadata[sampleIndex] = record.metadata;
      cpuSampleCount += 1;
    }
    if (autoSchedulePolls) ensurePollScheduled();
    return {
      frameSequence: record.frameSequence,
      cpuSubmitDurationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
      gpuQueryIssued: record.query != null,
      gpuQueryOrdinal: record.queryOrdinal,
    };
  };

  const measureFrameSubmit = (submit, metadata = null) => {
    if (typeof submit !== 'function') {
      throw new TypeError('measureFrameSubmit requires a synchronous render callback.');
    }
    const token = beginFrame(metadata);
    try {
      return submit();
    } finally {
      endFrame(token);
    }
  };

  const wrapRender = (target, methodName = 'render', metadataFactory = null) => {
    if (disposed) throw new Error('Goal 24 GPU frame-timing probe is disposed.');
    if (!target || typeof target[methodName] !== 'function') {
      throw new TypeError(`Cannot wrap non-function render method ${String(methodName)}.`);
    }
    if (metadataFactory != null && typeof metadataFactory !== 'function') {
      throw new TypeError('Render metadata factory must be a function when provided.');
    }
    const original = target[methodName];
    const wrapperRecord = {
      target,
      methodName,
      original,
      wrapped: null,
      detached: false,
    };
    const wrapped = function goal24MeasuredRenderSubmit(...args) {
      let metadata = null;
      if (metadataFactory) {
        try {
          metadata = metadataFactory.call(this, {
            args,
            nextFrameSequence,
            target: this,
          });
        } catch (error) {
          recordError('render-metadata-factory', error, { frameSequence: nextFrameSequence });
        }
      }
      return measureFrameSubmit(() => original.apply(this, args), metadata);
    };
    wrapperRecord.wrapped = wrapped;
    let installed = false;
    try {
      installed = Reflect.set(target, methodName, wrapped)
        && target[methodName] === wrapped;
    } catch (error) {
      recordError('install-render-wrapper', error);
    }
    if (!installed) {
      throw new Error(`Unable to install Goal 24 timing wrapper on ${String(methodName)}.`);
    }
    wrappers.add(wrapperRecord);
    const detach = () => {
      if (wrapperRecord.detached) return false;
      if (target[methodName] === wrapped) {
        let restored = false;
        try {
          restored = Reflect.set(target, methodName, original)
            && target[methodName] === original;
        } catch (error) {
          recordError('detach-render-wrapper', error);
        }
        if (!restored) return false;
      }
      wrapperRecord.detached = true;
      wrappers.delete(wrapperRecord);
      return true;
    };
    return detach;
  };

  const percentileNearestRank = (sorted, percentile) => {
    if (sorted.length === 0) return null;
    const rank = Math.max(1, Math.ceil(percentile * sorted.length));
    return sorted[rank - 1];
  };
  const summarize = (values) => {
    if (values.length === 0) {
      return { count: 0, min: null, p50: null, p95: null, worst: null };
    }
    const sorted = [...values].sort((left, right) => left - right);
    return {
      count: sorted.length,
      min: sorted[0],
      p50: percentileNearestRank(sorted, 0.50),
      p95: percentileNearestRank(sorted, 0.95),
      worst: sorted[sorted.length - 1],
    };
  };
  const cpuRawSamples = () => Array.from({ length: cpuSampleCount }, (_, index) => ({
    frameSequence: cpuFrameSequence[index],
    startAtMs: cpuStartAtMs[index],
    endAtMs: cpuEndAtMs[index],
    durationMs: cpuDurationMs[index],
    metadata: cpuMetadata[index] ? { ...cpuMetadata[index] } : null,
  }));
  const gpuRawSamples = () => Array.from({ length: gpuSampleCount }, (_, index) => ({
    frameSequence: gpuFrameSequence[index],
    queryOrdinal: gpuQueryOrdinal[index],
    durationNs: gpuDurationNs[index],
    durationMs: gpuDurationMs[index],
    valid: gpuFatalState == null,
    invalidReason: gpuFatalState == null ? null : gpuFatalReason,
    metadata: gpuMetadata[index] ? { ...gpuMetadata[index] } : null,
  })).sort((left, right) => (
    left.frameSequence - right.frameSequence || left.queryOrdinal - right.queryOrdinal
  ));

  const cpuValidity = () => {
    if (cpuSampleCount === 0) {
      return {
        state: invalidCpuSampleCount > 0 || incompleteFrameCount > 0 ? 'error' : 'no-samples',
        valid: false,
        reason: invalidCpuSampleCount > 0
          ? 'invalid-cpu-clock-sample'
          : incompleteFrameCount > 0 ? 'incomplete-frame-lifecycle' : 'no-frame-samples',
      };
    }
    if (invalidCpuSampleCount > 0 || incompleteFrameCount > 0) {
      return { state: 'error', valid: false, reason: 'invalid-or-incomplete-frame-sample' };
    }
    if (cpuCapacitySkippedCount > 0) {
      return { state: 'partial', valid: false, reason: 'cpu-sample-capacity-exceeded' };
    }
    return { state: 'valid', valid: true, reason: null };
  };
  const gpuValidity = () => {
    if (gpuFatalState != null) {
      return { state: gpuFatalState, valid: false, reason: gpuFatalReason };
    }
    if (gpuInitialState !== 'available') {
      return { state: gpuInitialState, valid: false, reason: gpuInitialReason };
    }
    if (pendingQueries.length > 0) {
      return { state: 'pending', valid: false, reason: 'gpu-queries-not-yet-resolved' };
    }
    if (gpuCapacitySkippedCount > 0 || gpuTimedOutQueryCount > 0
      || gpuAbortedQueryCount > 0 || gpuDisposedPendingQueryCount > 0
      || gpuInvalidResultCount > 0 || gpuQueryDeleteFailureCount > 0) {
      return {
        state: 'partial',
        valid: false,
        reason: 'gpu-query-stream-incomplete',
      };
    }
    if (gpuSampleCount === 0) {
      return { state: 'no-samples', valid: false, reason: 'no-completed-gpu-query-samples' };
    }
    return { state: 'valid', valid: true, reason: null };
  };

  function snapshot() {
    const cpuSamples = cpuRawSamples();
    const gpuSamples = gpuRawSamples();
    const currentGpuValidity = gpuValidity();
    return {
      schemaVersion,
      source: 'Goal 24 synchronous render hook timing probe',
      configuration: {
        maxSamples,
        maxPendingQueries,
        maxQueriesPerPoll,
        maxPollAttemptsPerQuery,
        sampleEveryNFrames,
        autoSchedulePolls,
      },
      context: {
        ...contextIdentity,
        canvas: contextIdentity.canvas ? { ...contextIdentity.canvas } : null,
        contextReadFailures: contextIdentity.contextReadFailures.map((failure) => ({ ...failure })),
        contextAttributes: contextIdentity.contextAttributes
          ? { ...contextIdentity.contextAttributes }
          : null,
        supportedExtensions: contextIdentity.supportedExtensions
          ? [...contextIdentity.supportedExtensions]
          : null,
        proof: {
          ...contextIdentity.proof,
          queryApi: { ...contextIdentity.proof.queryApi },
        },
      },
      cpuSubmit: {
        source: 'monotonic clock immediately before and after synchronous render hook invocation',
        unit: 'milliseconds',
        percentileMethod: 'nearest-rank',
        validity: cpuValidity(),
        rawSamples: cpuSamples,
        summary: summarize(cpuSamples.map((sample) => sample.durationMs)),
      },
      gpu: {
        source: `${extensionName} TIME_ELAPSED_EXT query around the same render hook`,
        sourceUnit: 'nanoseconds',
        reportUnit: 'milliseconds',
        percentileMethod: 'nearest-rank',
        nonBlockingReadPolicy: 'QUERY_RESULT is read only after QUERY_RESULT_AVAILABLE is true',
        validity: currentGpuValidity,
        rawSamples: gpuSamples,
        summary: currentGpuValidity.valid
          ? summarize(gpuSamples.map((sample) => sample.durationMs))
          : { count: 0, min: null, p50: null, p95: null, worst: null },
        observedSampleSummary: summarize(gpuSamples.map((sample) => sample.durationMs)),
        pendingFrameSequences: pendingQueries
          .map((record) => record.frameSequence)
          .sort((left, right) => left - right),
        counters: {
          queriesCreated: gpuQueriesCreated,
          queriesDeleted: gpuQueriesDeleted,
          trackedLiveQueries: liveQueries.size,
          pendingQueries: pendingQueries.length,
          capacitySkipped: gpuCapacitySkippedCount,
          samplingIntervalSkipped: gpuSamplingIntervalSkippedCount,
          timedOutQueries: gpuTimedOutQueryCount,
          abortedQueries: gpuAbortedQueryCount,
          disposedPendingQueries: gpuDisposedPendingQueryCount,
          invalidResults: gpuInvalidResultCount,
          deleteFailures: gpuQueryDeleteFailureCount,
        },
      },
      lifecycle: {
        disposed,
        framesBegun,
        framesEnded,
        activeFrameSequence: activeFrame?.frameSequence ?? null,
        incompleteFrames: incompleteFrameCount,
        invalidCpuSamples: invalidCpuSampleCount,
        cpuCapacitySkipped: cpuCapacitySkippedCount,
        wrappedRenderMethodCount: wrappers.size,
        pollScheduled,
        pollsScheduled,
        pollsCompleted,
        synchronousPollCallbackObserved,
      },
      cleanup: {
        queriesCreated: gpuQueriesCreated,
        queriesDeleted: gpuQueriesDeleted,
        trackedLiveQueries: liveQueries.size,
        pendingQueries: pendingQueries.length,
        activeQuery: !!activeFrame?.query,
        pollScheduled,
        wrapperCount: wrappers.size,
        leakFree: liveQueries.size === 0
          && pendingQueries.length === 0
          && !activeFrame?.query
          && !pollScheduled
          && wrappers.size === 0,
      },
      errors: errors.map((entry) => ({ ...entry })),
      errorOverflowCount,
      limitations: [
        'GPU timing is unavailable when WebGL2 or EXT_disjoint_timer_query_webgl2 is unavailable.',
        'A disjoint event or context loss invalidates the GPU timing stream; CPU timing is never substituted.',
        'CPU submit duration measures the synchronous render-hook call, not compositor presentation latency.',
        'The probe does not call getError because consuming the application WebGL error state would perturb production diagnostics.',
      ],
    };
  }

  const flush = ({ timeoutMs = 2_000 } = {}) => {
    if (pendingQueries.length === 0 || gpuFatalState != null || disposed) {
      return Promise.resolve(snapshot());
    }
    const boundedTimeout = boundedInteger(timeoutMs, 2_000, 1, 60_000);
    return new Promise((resolve) => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimer(() => {
        flushWaiters.delete(waiter);
        resolve(snapshot());
      }, boundedTimeout);
      flushWaiters.add(waiter);
      ensurePollScheduled();
    });
  };

  const dispose = () => {
    if (disposed) return { disposed: false, evidence: snapshot() };
    for (const wrapper of [...wrappers]) {
      if (wrapper.target[wrapper.methodName] === wrapper.wrapped) {
        let restored = false;
        try {
          restored = Reflect.set(wrapper.target, wrapper.methodName, wrapper.original)
            && wrapper.target[wrapper.methodName] === wrapper.original;
        } catch (error) {
          recordError('restore-render-wrapper-during-dispose', error);
        }
        if (!restored) continue;
      }
      wrapper.detached = true;
      wrappers.delete(wrapper);
    }
    if (pollScheduled) {
      try {
        cancelPoll(pollHandle);
      } catch (error) {
        recordError('cancel-poll-during-dispose', error);
      }
      pollScheduled = false;
      pollHandle = null;
    }
    if (activeFrame) {
      incompleteFrameCount += 1;
      abortActiveQuery(activeFrame, 'dispose-active-frame');
      activeFrame = null;
    }
    gpuDisposedPendingQueryCount += pendingQueries.length;
    deleteAllPendingQueries('delete-pending-during-dispose');
    // Retry records whose first deleteQuery call threw. This is both useful in
    // transient fake/adversarial contexts and explicit evidence if cleanup is
    // still impossible.
    for (const record of [...liveQueries.values()]) {
      safeDeleteQuery(record, 'retry-delete-during-dispose');
    }
    disposed = true;
    resolveFlushWaiters(true);
    const evidence = snapshot();
    return { disposed: true, evidence };
  };

  return Object.freeze({
    schemaVersion,
    beginFrame,
    endFrame,
    measureFrameSubmit,
    wrapRender,
    collect: collectAvailable,
    flush,
    snapshot,
    dispose,
  });
}

/**
 * Return the exact self-contained browser factory for Playwright/Electron
 * injection. For example:
 *
 *   const source = goal24GpuFrameTimingFactorySource();
 *   await page.evaluate(({ source }) => {
 *     const createProbe = (0, eval)(source);
 *     const scene3d = globalThis.__fw.scene3d;
 *     const renderer = scene3d.renderer;
 *     const probe = createProbe({ gl: renderer.getContext() });
 *     probe.wrapRender(scene3d, 'render');
 *     globalThis.__goal24GpuFrameTiming = probe;
 *   }, { source });
 */
export function goal24GpuFrameTimingFactorySource() {
  return `(${createGoal24GpuFrameTimingProbe.toString()})`;
}
