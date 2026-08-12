import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOAL24_GPU_FRAME_TIMING_EXTENSION,
  GOAL24_GPU_FRAME_TIMING_SCHEMA_VERSION,
  createGoal24GpuFrameTimingProbe,
  goal24GpuFrameTimingFactorySource,
} from '../tools/qa/lib/goal24-gpu-frame-timing.mjs';

class FakeScheduler {
  constructor() {
    this.nextId = 1;
    this.callbacks = new Map();
    this.canceled = [];
  }

  schedule = (callback) => {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    return id;
  };

  cancel = (id) => {
    this.canceled.push(id);
    this.callbacks.delete(id);
  };

  runOne() {
    const entry = this.callbacks.entries().next().value;
    if (!entry) return false;
    const [id, callback] = entry;
    this.callbacks.delete(id);
    callback(0);
    return true;
  }

  runAll(limit = 100) {
    let count = 0;
    while (count < limit && this.runOne()) count += 1;
    return count;
  }
}

class FakeWebGl2 {
  constructor({ timerSupported = true, queryResultsNs = [] } = {}) {
    this.VERSION = 0x1F02;
    this.SHADING_LANGUAGE_VERSION = 0x8B8C;
    this.VENDOR = 0x1F00;
    this.RENDERER = 0x1F01;
    this.QUERY_RESULT = 0x8866;
    this.QUERY_RESULT_AVAILABLE = 0x8867;
    this.drawingBufferWidth = 1920;
    this.drawingBufferHeight = 1080;
    this.canvas = { id: 'game-canvas', width: 1920, height: 1080 };
    this.timerSupported = timerSupported;
    this.queryResultsNs = [...queryResultsNs];
    this.nextQueryId = 1;
    this.queries = new Map();
    this.activeQuery = null;
    this.disjoint = false;
    this.contextLost = false;
    this.throwAvailabilityFor = null;
    this.throwResultFor = null;
    this.deleteFailuresRemaining = 0;
    this.createCount = 0;
    this.deleteCount = 0;
    this.timerExtension = {
      TIME_ELAPSED_EXT: 0x88BF,
      GPU_DISJOINT_EXT: 0x8FBB,
    };
    this.debugExtension = {
      UNMASKED_VENDOR_WEBGL: 0x9245,
      UNMASKED_RENDERER_WEBGL: 0x9246,
    };
  }

  getExtension(name) {
    if (name === GOAL24_GPU_FRAME_TIMING_EXTENSION) {
      return this.timerSupported ? this.timerExtension : null;
    }
    if (name === 'WEBGL_debug_renderer_info') return this.debugExtension;
    return null;
  }

  getSupportedExtensions() {
    return this.timerSupported
      ? [GOAL24_GPU_FRAME_TIMING_EXTENSION, 'WEBGL_debug_renderer_info']
      : ['WEBGL_debug_renderer_info'];
  }

  getContextAttributes() {
    return { alpha: false, antialias: true, powerPreference: 'high-performance' };
  }

  getParameter(parameter) {
    if (parameter === this.VERSION) return 'WebGL 2.0 Fake';
    if (parameter === this.SHADING_LANGUAGE_VERSION) return 'WebGL GLSL ES 3.00 Fake';
    if (parameter === this.VENDOR) return 'Fake Standard Vendor';
    if (parameter === this.RENDERER) return 'Fake Standard Renderer';
    if (parameter === this.debugExtension.UNMASKED_VENDOR_WEBGL) return 'Fake GPU Vendor';
    if (parameter === this.debugExtension.UNMASKED_RENDERER_WEBGL) return 'Fake GPU Model';
    if (parameter === this.timerExtension.GPU_DISJOINT_EXT) return this.disjoint;
    throw new Error(`Unexpected getParameter(${parameter})`);
  }

  createQuery() {
    const query = { id: this.nextQueryId };
    this.nextQueryId += 1;
    this.createCount += 1;
    this.queries.set(query, {
      available: false,
      result: this.queryResultsNs.length > 0 ? this.queryResultsNs.shift() : 1_000_000,
      ended: false,
    });
    return query;
  }

  beginQuery(target, query) {
    assert.equal(target, this.timerExtension.TIME_ELAPSED_EXT);
    if (this.activeQuery) throw new Error('overlapping TIME_ELAPSED query');
    if (!this.queries.has(query)) throw new Error('unknown query');
    this.activeQuery = query;
  }

  endQuery(target) {
    assert.equal(target, this.timerExtension.TIME_ELAPSED_EXT);
    if (!this.activeQuery) throw new Error('no active query');
    this.queries.get(this.activeQuery).ended = true;
    this.activeQuery = null;
  }

  getQueryParameter(query, parameter) {
    const record = this.queries.get(query);
    if (!record) throw new Error('read after delete');
    if (parameter === this.QUERY_RESULT_AVAILABLE) {
      if (query.id === this.throwAvailabilityFor) throw new Error('availability read failed');
      return record.available;
    }
    if (parameter === this.QUERY_RESULT) {
      if (query.id === this.throwResultFor) throw new Error('result read failed');
      return record.result;
    }
    throw new Error(`Unexpected getQueryParameter(${parameter})`);
  }

  deleteQuery(query) {
    if (this.deleteFailuresRemaining > 0) {
      this.deleteFailuresRemaining -= 1;
      throw new Error('transient delete failure');
    }
    if (!this.queries.has(query)) throw new Error('double delete');
    this.queries.delete(query);
    this.deleteCount += 1;
  }

  isContextLost() {
    return this.contextLost;
  }

  makeAllAvailable() {
    for (const record of this.queries.values()) {
      if (record.ended) record.available = true;
    }
  }
}

function harness(options = {}) {
  const gl = options.gl ?? new FakeWebGl2(options.glOptions);
  const scheduler = options.scheduler ?? new FakeScheduler();
  let now = 0;
  const probe = createGoal24GpuFrameTimingProbe({
    gl,
    clock: () => now,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel,
    contextLabel: 'unit-test-primary-context',
    contextSource: 'FakeWebGl2 production-renderer stand-in',
    autoSchedulePolls: true,
    ...options.probeOptions,
  });
  return {
    gl,
    scheduler,
    probe,
    frame(durationMs, metadata = null) {
      const token = probe.beginFrame(metadata);
      now += durationMs;
      return probe.endFrame(token);
    },
    advance(durationMs) {
      now += durationMs;
    },
  };
}

test('records exact CPU submit and non-blocking GPU query samples with deterministic summaries', async () => {
  const h = harness({
    glOptions: { queryResultsNs: [4_000_000, 1_000_000, 8_000_000] },
  });
  h.frame(4, { frameIndex: 10, scenario: 'matrix-full' });
  h.frame(1, { frameIndex: 11, scenario: 'matrix-full' });
  h.frame(8, { frameIndex: 12, scenario: 'matrix-full' });

  let evidence = h.probe.snapshot();
  assert.deepEqual(evidence.cpuSubmit.summary, {
    count: 3, min: 1, p50: 4, p95: 8, worst: 8,
  });
  assert.equal(evidence.gpu.validity.state, 'pending');
  assert.equal(evidence.gpu.summary.count, 0);
  assert.equal(evidence.gpu.observedSampleSummary.count, 0);
  assert.equal(evidence.context.proof.webgl2VersionClaim, true);
  assert.equal(evidence.context.proof.queryApiComplete, true);
  assert.equal(evidence.context.proof.timerQueryExtensionAvailable, true);
  assert.equal(evidence.context.unmaskedRenderer, 'Fake GPU Model');

  h.gl.makeAllAvailable();
  const flushed = h.probe.flush();
  assert.equal(h.scheduler.runOne(), true);
  evidence = await flushed;
  assert.deepEqual(evidence.gpu.summary, {
    count: 3, min: 1, p50: 4, p95: 8, worst: 8,
  });
  assert.deepEqual(
    evidence.gpu.rawSamples.map(({ frameSequence, durationNs, durationMs }) => ({
      frameSequence, durationNs, durationMs,
    })),
    [
      { frameSequence: 1, durationNs: 4_000_000, durationMs: 4 },
      { frameSequence: 2, durationNs: 1_000_000, durationMs: 1 },
      { frameSequence: 3, durationNs: 8_000_000, durationMs: 8 },
    ],
  );
  assert.deepEqual(h.probe.snapshot(), h.probe.snapshot());

  const disposed = h.probe.dispose();
  assert.equal(disposed.disposed, true);
  assert.equal(disposed.evidence.cleanup.leakFree, true);
  assert.equal(disposed.evidence.cleanup.queriesCreated, 3);
  assert.equal(disposed.evidence.cleanup.queriesDeleted, 3);
  assert.equal(h.gl.queries.size, 0);
});

test('keeps CPU evidence but explicitly marks GPU timing unavailable without fabricating samples', () => {
  const h = harness({ glOptions: { timerSupported: false } });
  h.frame(2.5, { label: 'unsupported-gpu' });
  const evidence = h.probe.snapshot();
  assert.equal(evidence.cpuSubmit.validity.valid, true);
  assert.equal(evidence.cpuSubmit.rawSamples[0].durationMs, 2.5);
  assert.deepEqual(evidence.gpu.validity, {
    state: 'unavailable',
    valid: false,
    reason: 'timer-query-extension-unavailable',
  });
  assert.deepEqual(evidence.gpu.rawSamples, []);
  assert.equal(evidence.gpu.summary.count, 0);
  assert.equal(h.gl.createCount, 0);
  assert.equal(h.probe.dispose().evidence.cleanup.leakFree, true);
});

test('default measured window adds no scheduler callback and flush polls only after the route', async () => {
  const gl = new FakeWebGl2({ queryResultsNs: [2_000_000] });
  const scheduler = new FakeScheduler();
  let now = 0;
  const probe = createGoal24GpuFrameTimingProbe({
    gl,
    clock: () => now,
    schedulePoll: scheduler.schedule,
    cancelPoll: scheduler.cancel,
  });
  const token = probe.beginFrame();
  now = 2;
  probe.endFrame(token);
  assert.equal(scheduler.callbacks.size, 0);
  assert.equal(probe.snapshot().configuration.autoSchedulePolls, false);

  gl.makeAllAvailable();
  const flushed = probe.flush();
  assert.equal(scheduler.callbacks.size, 1);
  scheduler.runOne();
  assert.equal((await flushed).gpu.validity.valid, true);
  assert.equal(probe.dispose().evidence.cleanup.leakFree, true);
});

test('bounds in-flight queries and reports skipped GPU frames as partial evidence', () => {
  const h = harness({
    glOptions: { queryResultsNs: [1_000_000, 2_000_000, 3_000_000] },
    probeOptions: { maxPendingQueries: 2 },
  });
  h.frame(1);
  h.frame(1);
  h.frame(1);
  assert.equal(h.gl.createCount, 2);
  assert.equal(h.probe.snapshot().gpu.counters.capacitySkipped, 1);

  h.gl.makeAllAvailable();
  h.scheduler.runAll();
  const evidence = h.probe.snapshot();
  assert.deepEqual(evidence.gpu.validity, {
    state: 'partial',
    valid: false,
    reason: 'gpu-query-stream-incomplete',
  });
  assert.equal(evidence.gpu.summary.count, 0);
  assert.equal(evidence.gpu.observedSampleSummary.count, 2);
  assert.equal(evidence.cpuSubmit.summary.count, 3);
  assert.equal(h.probe.dispose().evidence.cleanup.leakFree, true);
});

test('a later GPU disjoint invalidates previously completed values and deletes pending queries', () => {
  const h = harness({ glOptions: { queryResultsNs: [3_000_000, 4_000_000] } });
  h.frame(1);
  h.gl.makeAllAvailable();
  h.scheduler.runOne();
  assert.equal(h.probe.snapshot().gpu.validity.valid, true);

  h.frame(1);
  h.gl.disjoint = true;
  h.scheduler.runOne();
  const evidence = h.probe.snapshot();
  assert.deepEqual(evidence.gpu.validity, {
    state: 'invalid-disjoint',
    valid: false,
    reason: 'gpu-disjoint-observed',
  });
  assert.equal(evidence.gpu.summary.count, 0);
  assert.equal(evidence.gpu.observedSampleSummary.count, 1);
  assert.equal(evidence.gpu.rawSamples[0].valid, false);
  assert.equal(evidence.gpu.rawSamples[0].invalidReason, 'gpu-disjoint-observed');
  assert.equal(evidence.cleanup.trackedLiveQueries, 0);
  assert.equal(h.gl.queries.size, 0);
  assert.equal(h.probe.dispose().evidence.cleanup.leakFree, true);
});

test('context loss is an explicit invalid state and releases tracked query objects', () => {
  const h = harness();
  h.frame(1);
  h.gl.contextLost = true;
  h.scheduler.runOne();
  const evidence = h.probe.snapshot();
  assert.deepEqual(evidence.gpu.validity, {
    state: 'invalid-context-lost',
    valid: false,
    reason: 'webgl-context-lost',
  });
  assert.equal(evidence.gpu.rawSamples.length, 0);
  assert.equal(evidence.cleanup.trackedLiveQueries, 0);
  assert.equal(h.gl.queries.size, 0);
  assert.equal(h.probe.dispose().evidence.cleanup.leakFree, true);
});

test('query read errors fail closed and clean every outstanding query', () => {
  const h = harness({ glOptions: { queryResultsNs: [1_000_000, 2_000_000] } });
  h.frame(1);
  h.frame(1);
  h.gl.makeAllAvailable();
  h.gl.throwResultFor = 1;
  h.scheduler.runOne();
  const evidence = h.probe.snapshot();
  assert.deepEqual(evidence.gpu.validity, {
    state: 'error',
    valid: false,
    reason: 'query-result-read-failed',
  });
  assert.equal(evidence.gpu.rawSamples.length, 0);
  assert.equal(evidence.cleanup.trackedLiveQueries, 0);
  assert.equal(evidence.cleanup.pendingQueries, 0);
  assert.equal(h.gl.queries.size, 0);
  assert.match(evidence.errors[0].message, /result read failed/);
  assert.equal(h.probe.dispose().evidence.cleanup.leakFree, true);
});

test('unavailable query results age out after a bounded number of async polls', () => {
  const h = harness({ probeOptions: { maxPollAttemptsPerQuery: 2 } });
  h.frame(1);
  assert.equal(h.scheduler.runOne(), true);
  assert.equal(h.scheduler.runOne(), true);
  const evidence = h.probe.snapshot();
  assert.equal(evidence.gpu.counters.timedOutQueries, 1);
  assert.equal(evidence.gpu.counters.pendingQueries, 0);
  assert.equal(evidence.gpu.counters.trackedLiveQueries, 0);
  assert.equal(evidence.gpu.validity.state, 'partial');
  assert.equal(h.gl.queries.size, 0);
  assert.equal(h.probe.dispose().evidence.cleanup.leakFree, true);
});

test('wrong frame ownership aborts the active query rather than leaking it', () => {
  const h = harness();
  h.probe.beginFrame({ label: 'owned-frame' });
  assert.throws(
    () => h.probe.endFrame({ frameSequence: 1 }),
    /token does not own/,
  );
  const evidence = h.probe.snapshot();
  assert.equal(evidence.cpuSubmit.validity.state, 'error');
  assert.equal(evidence.lifecycle.incompleteFrames, 1);
  assert.equal(evidence.cleanup.activeQuery, false);
  assert.equal(evidence.cleanup.trackedLiveQueries, 0);
  assert.equal(h.gl.queries.size, 0);
  assert.equal(h.probe.dispose().evidence.cleanup.leakFree, true);
});

test('render wrapper measures throwing submissions and restores the exact production method', () => {
  const h = harness({ glOptions: { timerSupported: false } });
  const original = function render() {
    h.advance(6);
    throw new Error('shipping renderer failed');
  };
  const renderer = { render: original };
  const detach = h.probe.wrapRender(
    renderer,
    'render',
    () => ({ scenario: 'throwing-render', rendererFrame: 42 }),
  );
  assert.notEqual(renderer.render, original);
  assert.throws(() => renderer.render(), /shipping renderer failed/);
  assert.equal(h.probe.snapshot().cpuSubmit.rawSamples[0].durationMs, 6);
  assert.equal(h.probe.snapshot().cpuSubmit.rawSamples[0].metadata.rendererFrame, 42);
  assert.equal(detach(), true);
  assert.equal(detach(), false);
  assert.equal(renderer.render, original);

  h.probe.wrapRender(renderer, 'render');
  const disposed = h.probe.dispose();
  assert.equal(renderer.render, original);
  assert.equal(disposed.evidence.cleanup.wrapperCount, 0);
  assert.equal(disposed.evidence.cleanup.leakFree, true);
});

test('dispose retries a transient delete failure and exposes accounting proof', () => {
  const h = harness();
  h.frame(1);
  h.gl.deleteFailuresRemaining = 1;
  h.gl.makeAllAvailable();
  h.scheduler.runOne();
  let evidence = h.probe.snapshot();
  assert.equal(evidence.gpu.counters.deleteFailures, 1);
  assert.equal(evidence.cleanup.trackedLiveQueries, 1);
  assert.equal(evidence.cleanup.leakFree, false);

  evidence = h.probe.dispose().evidence;
  assert.equal(evidence.cleanup.trackedLiveQueries, 0);
  assert.equal(evidence.cleanup.queriesCreated, evidence.cleanup.queriesDeleted);
  assert.equal(evidence.cleanup.leakFree, true);
  assert.equal(h.gl.queries.size, 0);
});

test('dispose deletes unresolved queries and marks the GPU stream incomplete', () => {
  const h = harness({ probeOptions: { autoSchedulePolls: false } });
  h.frame(1);
  const evidence = h.probe.dispose().evidence;
  assert.equal(evidence.gpu.counters.disposedPendingQueries, 1);
  assert.equal(evidence.gpu.validity.state, 'partial');
  assert.equal(evidence.gpu.summary.count, 0);
  assert.equal(evidence.cleanup.trackedLiveQueries, 0);
  assert.equal(evidence.cleanup.leakFree, true);
  assert.equal(h.gl.queries.size, 0);
});

test('factory source is self-contained and suitable for Electron page injection', () => {
  const source = goal24GpuFrameTimingFactorySource();
  const injectedFactory = (0, eval)(source);
  assert.equal(typeof injectedFactory, 'function');
  assert.match(source, /EXT_disjoint_timer_query_webgl2/);
  const gl = new FakeWebGl2({ timerSupported: false });
  const injectedProbe = injectedFactory({ gl, clock: () => 10 });
  assert.equal(injectedProbe.schemaVersion, GOAL24_GPU_FRAME_TIMING_SCHEMA_VERSION);
  const token = injectedProbe.beginFrame({ label: 'injected' });
  injectedProbe.endFrame(token);
  assert.equal(injectedProbe.snapshot().cpuSubmit.summary.count, 1);
  assert.equal(injectedProbe.dispose().evidence.cleanup.leakFree, true);
});
