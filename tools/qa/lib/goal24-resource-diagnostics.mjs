// Goal 24 attribution/resource diagnostics.
//
// This is deliberately a checkpoint instrument, not an interaction recorder.
// It must run before, between, or after timed interaction windows because CDP
// heap/listener walks and scene traversal are intentionally too expensive for a
// graded timing window. It installs no observers and patches no browser or app
// functions. Runtime object groups and any owned CDP session are released.

export const GOAL24_RESOURCE_DIAGNOSTICS_SCHEMA_VERSION = 3;
export const GOAL24_PRODUCTION_FRAME_LOOP_OWNER =
  'golf-flipper/src/main.js:production-frame-loop:v1';
const GOAL24_RESOURCE_MEASUREMENT_EVIDENCE_SCHEMA_VERSION = 1;
const GOAL24_WORKLOAD_CONTEXT_SCHEMA_VERSION = 2;

const LISTENER_SCOPE = 'window, document, and every current light-DOM Element';
const LISTENER_LIMITATION = [
  'The census does not include listeners on non-DOM EventTargets, detached nodes, '
    + 'nodes reachable only through shadow roots, other frames, or workers.',
  'The target list is a point-in-time light-DOM enumeration; DOM churn during CDP inspection '
    + 'can make a partially failed census an undercount.',
].join(' ');
const TEXTURE_LIMITATION = [
  'Estimate assumes four uncompressed RGBA8 bytes per texel and includes a complete mip '
    + 'chain when mip generation or authored mip levels are present.',
  'Visibility means the mesh and its ancestors have visible !== false; it does not apply '
    + 'camera frustum, layers, shader sampling, occlusion, render-target ownership, internal '
    + 'driver padding, compression, or format conversion.',
  'Exact GPU memory is unavailable from WebGL.',
].join(' ');
const RENDER_LOOP_LIMITATION = [
  'The absolute callback/root counts cover the production frame scheduler owned by src/main.js, '
    + 'not unrelated requestAnimationFrame users elsewhere in the renderer.',
  'The scheduler counters begin before its only root request, have no reset API, and are read '
    + 'through a snapshot-only getter; renderer-counter sampling independently proves progress.',
].join(' ');
const AUDIO_RUNTIME_LIMITATION = [
  'Runtime.queryObjects counts live JavaScript wrappers inheriting from the main renderer '
    + 'AudioContext prototype after the optional checkpoint GC.',
  'Browser-internal contexts without such a wrapper and contexts in other renderer isolates, '
    + 'frames, or workers are not included.',
].join(' ');

let captureSerial = 0;

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function nonNegativeIntegerOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function cloneEvidence(value, path = 'measurement evidence') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneEvidence(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${path} contains unsupported or missing evidence.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain plain serializable objects.`);
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => (
    [key, cloneEvidence(entry, `${path}.${key}`)]
  )));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function exactEvidenceEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => exactEvidenceEqual(entry, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && exactEvidenceEqual(left[key], right[key]));
}

function requireFiniteNumber(value, path) {
  if (!Number.isFinite(value)) throw new TypeError(`${path} must be a finite number.`);
  return value;
}

function validateWorkloadContext(value, path = 'workload context') {
  if (!value || typeof value !== 'object'
    || value.schemaVersion !== GOAL24_WORKLOAD_CONTEXT_SCHEMA_VERSION) {
    throw new TypeError(`${path} schema is missing or unsupported.`);
  }
  if (value.appScreen !== 'game') throw new TypeError(`${path} must capture the game screen.`);
  if (value.prewarming !== false) throw new TypeError(`${path} must prove prewarming is false.`);
  const camera = value.camera;
  if (!camera || typeof camera !== 'object') throw new TypeError(`${path}.camera is missing.`);
  for (const key of ['fov', 'aspect', 'near', 'far']) {
    requireFiniteNumber(camera[key], `${path}.camera.${key}`);
  }
  if (!(camera.fov > 0 && camera.fov < 180)) {
    throw new TypeError(`${path}.camera.fov must be between 0 and 180 degrees.`);
  }
  if (!(camera.aspect > 0 && camera.aspect <= 32)) {
    throw new TypeError(`${path}.camera.aspect must be positive and physically bounded.`);
  }
  if (!(camera.near > 0 && camera.far > camera.near && camera.far <= 10_000_000)) {
    throw new TypeError(`${path}.camera clipping planes are physically invalid.`);
  }
  for (const [name, keys] of [
    ['position', ['x', 'y', 'z']],
    ['quaternion', ['x', 'y', 'z', 'w']],
  ]) {
    if (!camera[name] || typeof camera[name] !== 'object') {
      throw new TypeError(`${path}.camera.${name} is missing.`);
    }
    for (const key of keys) requireFiniteNumber(camera[name][key], `${path}.camera.${name}.${key}`);
  }
  if (Object.values(camera.position).some((entry) => Math.abs(entry) > 10_000_000)) {
    throw new TypeError(`${path}.camera.position is outside the supported world bounds.`);
  }
  if (Object.values(camera.quaternion).some((entry) => Math.abs(entry) > 1.000001)) {
    throw new TypeError(`${path}.camera.quaternion contains an invalid component.`);
  }
  const quaternionNorm = Math.hypot(
    camera.quaternion.x,
    camera.quaternion.y,
    camera.quaternion.z,
    camera.quaternion.w,
  );
  if (Math.abs(quaternionNorm - 1) > 0.002) {
    throw new TypeError(`${path}.camera.quaternion must be normalized.`);
  }
  const walk = value.walk;
  if (!walk || typeof walk !== 'object' || typeof walk.active !== 'boolean') {
    throw new TypeError(`${path}.walk is incomplete.`);
  }
  for (const key of ['x', 'z', 'yaw', 'pitch', 'eye', 'fov']) {
    requireFiniteNumber(walk[key], `${path}.walk.${key}`);
  }
  if (Math.abs(walk.x) > 10_000_000 || Math.abs(walk.z) > 10_000_000
    || !(walk.eye > 0 && walk.eye <= 100)
    || !(walk.fov > 0 && walk.fov < 180)) {
    throw new TypeError(`${path}.walk pose is physically invalid.`);
  }
  if (value.heldTool !== null && typeof value.heldTool !== 'string') {
    throw new TypeError(`${path}.heldTool must be a string or null.`);
  }
  const ledger = value.ledger;
  if (!ledger || typeof ledger !== 'object' || typeof ledger.open !== 'boolean'
    || typeof ledger.visualOpen !== 'boolean'
    || typeof ledger.state !== 'string'
    || !Number.isInteger(ledger.spread) || ledger.spread < 0
    || !Number.isInteger(ledger.pageCount) || ledger.pageCount <= 0
    || typeof ledger.turning !== 'boolean') {
    throw new TypeError(`${path}.ledger is incomplete.`);
  }
  const ledgerStates = new Set([
    'closed', 'raising', 'held', 'opening', 'open', 'closing', 'lowering',
  ]);
  if (!ledgerStates.has(ledger.state) || ledger.spread >= ledger.pageCount) {
    throw new TypeError(`${path}.ledger state or page position is invalid.`);
  }
  const modeOpenStates = new Set(['raising', 'held', 'opening', 'open']);
  const visualOpenStates = new Set(['opening', 'open']);
  if (ledger.open !== modeOpenStates.has(ledger.state)
    || ledger.visualOpen !== visualOpenStates.has(ledger.state)
    || (ledger.turning && ledger.state !== 'open')) {
    throw new TypeError(`${path}.ledger flags are inconsistent with its production state.`);
  }
  return value;
}

function normalizeWorkloadContext(value, path = 'workload context') {
  validateWorkloadContext(value, path);
  return {
    schemaVersion: GOAL24_WORKLOAD_CONTEXT_SCHEMA_VERSION,
    appScreen: value.appScreen,
    prewarming: value.prewarming,
    camera: {
      fov: value.camera.fov,
      aspect: value.camera.aspect,
      near: value.camera.near,
      far: value.camera.far,
      position: {
        x: value.camera.position.x,
        y: value.camera.position.y,
        z: value.camera.position.z,
      },
      quaternion: {
        x: value.camera.quaternion.x,
        y: value.camera.quaternion.y,
        z: value.camera.quaternion.z,
        w: value.camera.quaternion.w,
      },
    },
    walk: {
      active: value.walk.active,
      x: value.walk.x,
      z: value.walk.z,
      yaw: value.walk.yaw,
      pitch: value.walk.pitch,
      eye: value.walk.eye,
      fov: value.walk.fov,
    },
    heldTool: value.heldTool,
    ledger: {
      open: value.ledger.open,
      visualOpen: value.ledger.visualOpen,
      state: value.ledger.state,
      spread: value.ledger.spread,
      pageCount: value.ledger.pageCount,
      turning: value.ledger.turning,
    },
  };
}

/**
 * Recompute the shipping scheduler invariant from raw monotonic counters. None
 * of the booleans reported by the app are trusted as the proof by themselves.
 */
export function assessProductionFrameLoopDiagnostics(value) {
  const input = value && typeof value === 'object' ? value : {};
  const rootStartCount = nonNegativeIntegerOrNull(input.rootStartCount);
  const scheduleCount = nonNegativeIntegerOrNull(input.scheduleCount);
  const callbackCount = nonNegativeIntegerOrNull(input.callbackCount);
  const pendingCallbackCount = nonNegativeIntegerOrNull(input.pendingCallbackCount);
  const maximumPendingCallbackCount = nonNegativeIntegerOrNull(
    input.maximumPendingCallbackCount,
  );
  const schedulingFailureCount = nonNegativeIntegerOrNull(input.schedulingFailureCount);
  const pendingUnderflowCount = nonNegativeIntegerOrNull(input.pendingUnderflowCount);
  const countersComplete = [
    rootStartCount,
    scheduleCount,
    callbackCount,
    pendingCallbackCount,
    maximumPendingCallbackCount,
    schedulingFailureCount,
    pendingUnderflowCount,
  ].every((entry) => entry != null);
  const ownerMatches = input.ownerToken === GOAL24_PRODUCTION_FRAME_LOOP_OWNER;
  const timestampsComplete = Number.isFinite(input.firstRootStartAtMs)
    && input.firstRootStartAtMs >= 0
    && Number.isFinite(input.lastCallbackAtMs)
    && input.lastCallbackAtMs >= input.firstRootStartAtMs;
  const accountingConsistent = countersComplete
    && scheduleCount - callbackCount === pendingCallbackCount
    && maximumPendingCallbackCount >= pendingCallbackCount
    && rootStartCount <= scheduleCount
    && callbackCount <= scheduleCount;
  const absoluteProductionSchedulerProof = input.schemaVersion === 1
    && ownerMatches
    && countersComplete
    && timestampsComplete
    && accountingConsistent;
  const duplicateStartObserved = rootStartCount != null && rootStartCount > 1;
  const duplicatePendingObserved = (pendingCallbackCount != null && pendingCallbackCount > 1)
    || (maximumPendingCallbackCount != null && maximumPendingCallbackCount > 1);
  const invariantHolds = absoluteProductionSchedulerProof
    && rootStartCount === 1
    && scheduleCount > 1
    && callbackCount > 0
    && pendingCallbackCount === 1
    && maximumPendingCallbackCount === 1
    && schedulingFailureCount === 0
    && pendingUnderflowCount === 0;
  return {
    source: [
      'src/main.js production-owned scheduleProductionFrame() counters, initialized before ',
      'startProductionFrameLoop() and exposed through app.frameLoopDiagnostics() as a ',
      'read-only snapshot with no reset or scheduler controls.',
    ].join(''),
    ownerToken: typeof input.ownerToken === 'string' ? input.ownerToken : null,
    ownerMatches,
    schemaVersion: nonNegativeIntegerOrNull(input.schemaVersion),
    rootStartCount,
    scheduleCount,
    callbackCount,
    pendingCallbackCount,
    maximumPendingCallbackCount,
    schedulingFailureCount,
    pendingUnderflowCount,
    firstRootStartAtMs: finiteOrNull(input.firstRootStartAtMs),
    lastCallbackAtMs: finiteOrNull(input.lastCallbackAtMs),
    countersComplete,
    timestampsComplete,
    accountingConsistent,
    absoluteProductionSchedulerProof,
    duplicateStartObserved,
    duplicatePendingObserved,
    invariantHolds,
  };
}

function countRecord(values) {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function modeSmallest(values) {
  const frequencies = new Map();
  for (const value of values) frequencies.set(value, (frequencies.get(value) || 0) + 1);
  return [...frequencies.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? null;
}

/**
 * Conservative texture-size estimate used by both tests and the browser snapshot.
 * Every level uses integer dimensions down to 1x1 rather than the approximate 4/3 factor.
 */
export function estimateRgba8MipChainBytes({
  width,
  height,
  layers = 1,
  faces = 1,
  includeMipChain = true,
} = {}) {
  let w = Math.floor(Number(width));
  let h = Math.floor(Number(height));
  const layerCount = Math.floor(Number(layers));
  const faceCount = Math.floor(Number(faces));
  if (![w, h, layerCount, faceCount].every((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }
  let texels = w * h * layerCount * faceCount;
  while (includeMipChain && (w > 1 || h > 1)) {
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
    texels += w * h * layerCount * faceCount;
  }
  return Math.round(texels * 4);
}

/**
 * Derive a non-invasive render-loop invariant from THREE's production-owned
 * renderer.info.render.frame counter sampled after consecutive browser frames.
 */
export function deriveRenderLoopInvariant(samples, {
  referenceInternalRendererInvocations = null,
  productionSchedulerDiagnostics = null,
} = {}) {
  if (!Array.isArray(samples) || samples.length < 2) {
    throw new TypeError('Render-loop evidence requires at least two ordered samples.');
  }
  const pairs = [];
  let monotonicRendererCounter = true;
  let monotonicShadowCounter = true;
  let monotonicComposedRenderCounter = true;
  let monotonicProductionCallbackCounter = true;
  let shadowComparablePairCount = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1] || {};
    const current = samples[index] || {};
    const rendererDelta = Number(current.rendererFrame) - Number(previous.rendererFrame);
    const composedRenderDelta = Number(current.composedRenders)
      - Number(previous.composedRenders);
    const productionCallbackDelta = Number(current.productionCallbackCount)
      - Number(previous.productionCallbackCount);
    const shadowComparable = Number.isFinite(previous.shadowBakes)
      && Number.isFinite(current.shadowBakes);
    if (shadowComparable) shadowComparablePairCount += 1;
    const shadowDelta = shadowComparable ? current.shadowBakes - previous.shadowBakes : null;
    if (!Number.isInteger(rendererDelta) || rendererDelta < 0) monotonicRendererCounter = false;
    if (!Number.isInteger(composedRenderDelta) || composedRenderDelta < 0) {
      monotonicComposedRenderCounter = false;
    }
    if (!Number.isInteger(productionCallbackDelta) || productionCallbackDelta < 0) {
      monotonicProductionCallbackCounter = false;
    }
    if (shadowComparable && shadowDelta < 0) monotonicShadowCounter = false;
    pairs.push({
      fromTimestampMs: finiteOrNull(previous.timestampMs),
      toTimestampMs: finiteOrNull(current.timestampMs),
      rendererFrameDelta: finiteOrNull(rendererDelta),
      composedRenderDelta: finiteOrNull(composedRenderDelta),
      productionCallbackDelta: finiteOrNull(productionCallbackDelta),
      shadowBakeDelta: finiteOrNull(shadowDelta),
    });
  }
  const positiveDeltas = pairs
    .map(({ rendererFrameDelta }) => rendererFrameDelta)
    .filter((value) => Number.isInteger(value) && value > 0);
  const localBaseline = positiveDeltas.length ? Math.min(...positiveDeltas) : null;
  const providedReference = Number(referenceInternalRendererInvocations);
  const hasProvidedReference = Number.isInteger(providedReference) && providedReference > 0;
  const baseline = hasProvidedReference ? providedReference : localBaseline;
  const mode = modeSmallest(positiveDeltas);
  const counterPairsComplete = pairs.every(({ rendererFrameDelta, composedRenderDelta,
    productionCallbackDelta, shadowBakeDelta }) => (
    Number.isInteger(rendererFrameDelta) && rendererFrameDelta >= 0
    && Number.isInteger(composedRenderDelta) && composedRenderDelta >= 0
    && Number.isInteger(productionCallbackDelta) && productionCallbackDelta >= 0
    && Number.isInteger(shadowBakeDelta) && shadowBakeDelta >= 0
  ));
  const progressionObserved = pairs.some(({ composedRenderDelta }) => composedRenderDelta > 0);
  const duplicateComposedRenderObserved = pairs.some(({ composedRenderDelta,
    productionCallbackDelta }) => composedRenderDelta > productionCallbackDelta);
  const composedRenderWithoutCallbackObserved = pairs.some(({ composedRenderDelta,
    productionCallbackDelta }) => composedRenderDelta > 0 && productionCallbackDelta === 0);
  const rendererProgressWithoutCallbackObserved = pairs.some(({ rendererFrameDelta,
    productionCallbackDelta }) => rendererFrameDelta > 0 && productionCallbackDelta === 0);
  const rendererProgressWithoutComposedRenderObserved = pairs.some(({ rendererFrameDelta,
    composedRenderDelta }) => rendererFrameDelta > 0 && composedRenderDelta === 0);
  const composedRenderWithoutRendererProgressObserved = pairs.some(({ rendererFrameDelta,
    composedRenderDelta }) => composedRenderDelta > 0 && rendererFrameDelta === 0);
  const maximumProgressionsPerBoundary = pairs.length
    ? Math.max(...pairs.map(({ composedRenderDelta }) => composedRenderDelta ?? 0)) : null;
  const scheduler = assessProductionFrameLoopDiagnostics(productionSchedulerDiagnostics);
  const sampledCallbackCounts = samples.map(({ productionCallbackCount }) => (
    nonNegativeIntegerOrNull(productionCallbackCount)
  ));
  const sampledCallbacksComplete = sampledCallbackCounts.every((value) => value != null);
  const sampledCallbacksBoundedByScheduler = sampledCallbacksComplete
    && scheduler.callbackCount != null
    && Math.max(...sampledCallbackCounts) <= scheduler.callbackCount;
  const rendererProgressionInvariantHolds = progressionObserved
    && counterPairsComplete
    && monotonicRendererCounter
    && monotonicShadowCounter
    && monotonicComposedRenderCounter
    && monotonicProductionCallbackCounter
    && sampledCallbacksBoundedByScheduler
    && !duplicateComposedRenderObserved
    && !composedRenderWithoutCallbackObserved
    && !rendererProgressWithoutCallbackObserved
    && !rendererProgressWithoutComposedRenderObserved
    && !composedRenderWithoutRendererProgressObserved;
  const schedulerDuplicateObserved = scheduler.duplicateStartObserved
    || scheduler.duplicatePendingObserved;
  const duplicateProgressionObserved = duplicateComposedRenderObserved
    || schedulerDuplicateObserved;
  const invariantHolds = scheduler.invariantHolds && rendererProgressionInvariantHolds;
  return {
    source: [
      `${scheduler.source} `,
      'The immutable scene3d.post.stats().composedRenders counter and production scheduler ',
      'callbackCount are sampled together after consecutive browser animation frames. ',
      'THREE.WebGLRenderer.info.render.frame supplies internal-pass progress only; ',
      'scene3d.post.stats().shadowBakes independently classifies shadow-bake frames.',
    ].join(''),
    limitation: RENDER_LOOP_LIMITATION,
    sampleCount: samples.length,
    boundaryCount: samples.length - 1,
    progressingBoundaryCount: pairs.filter(({ composedRenderDelta }) => composedRenderDelta > 0).length,
    calibration: 'diagnostic-only internal renderer pass minimum; not used as duplicate proof',
    localBaselineInternalRendererInvocations: localBaseline,
    baselineInternalRendererInvocations: baseline,
    modalInternalRendererInvocations: mode,
    maximumProgressionsPerBoundary,
    monotonicRendererCounter,
    monotonicShadowCounter,
    monotonicComposedRenderCounter,
    monotonicProductionCallbackCounter,
    shadowCounterAvailable: shadowComparablePairCount > 0,
    shadowComparablePairCount,
    counterPairsComplete,
    sampledCallbacksComplete,
    sampledCallbacksBoundedByScheduler,
    duplicateComposedRenderObserved,
    composedRenderWithoutCallbackObserved,
    rendererProgressWithoutCallbackObserved,
    rendererProgressWithoutComposedRenderObserved,
    composedRenderWithoutRendererProgressObserved,
    rendererDuplicateProgressionObserved: duplicateComposedRenderObserved,
    schedulerDuplicateObserved,
    duplicateProgressionObserved,
    rendererProgressionInvariantHolds,
    absoluteProductionSchedulerProof: scheduler.absoluteProductionSchedulerProof,
    productionScheduler: scheduler,
    invariantHolds,
    // These counts are the maximum queued production callbacks and root starts
    // observed by the shipping scheduler since module initialization.
    renderCallbackCount: scheduler.maximumPendingCallbackCount ?? 0,
    renderLoopCount: scheduler.rootStartCount ?? 0,
    deltas: pairs,
  };
}

/**
 * Select a like-for-like composed-frame workload statistic. Shadow-map bakes
 * are explicitly separated so a calm baseline frame cannot be compared with a
 * candidate bake frame merely because it happened to be observed first.
 */
export function summarizeGoal24ComposedFrames(samples) {
  if (!Array.isArray(samples) || samples.length < 2) {
    throw new TypeError('Composed-frame evidence requires at least two ordered counter samples.');
  }
  const frames = [];
  let stableWorkloadContext = null;
  samples.forEach((sample, index) => {
    if (sample?.rendererInfoAutoReset !== false) {
      throw new TypeError(
        `Composed-frame sample ${index} must explicitly prove renderer.info.autoReset === false.`,
      );
    }
    for (const key of [
      'rendererFrame', 'composedRenders', 'productionCallbackCount', 'shadowBakes',
    ]) {
      if (!Number.isInteger(sample?.[key]) || sample[key] < 0) {
        throw new TypeError(`Composed-frame sample ${index} has invalid ${key}.`);
      }
    }
    const workloadContext = normalizeWorkloadContext(
      sample.workloadContext,
      `Composed-frame sample ${index} workload context`,
    );
    if (stableWorkloadContext == null) stableWorkloadContext = workloadContext;
    else if (!exactEvidenceEqual(stableWorkloadContext, workloadContext)) {
      throw new TypeError('Composed-frame workload context changed during the observation window.');
    }
  });
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1] || {};
    const current = samples[index] || {};
    const internalRendererInvocations = Number(current.rendererFrame)
      - Number(previous.rendererFrame);
    const composedRenderDelta = current.composedRenders - previous.composedRenders;
    const productionCallbackDelta = current.productionCallbackCount
      - previous.productionCallbackCount;
    if (!Number.isInteger(internalRendererInvocations) || internalRendererInvocations < 0) {
      throw new TypeError(`Composed-frame renderer counter ${index} is invalid.`);
    }
    if (!Number.isInteger(composedRenderDelta) || composedRenderDelta < 0
      || !Number.isInteger(productionCallbackDelta) || productionCallbackDelta < 0) {
      throw new TypeError(`Composed-frame production counters ${index} are invalid.`);
    }
    if ((composedRenderDelta > 0 || internalRendererInvocations > 0)
      && productionCallbackDelta === 0) {
      throw new TypeError(
        `Composed-frame boundary ${index} progressed without a production callback.`,
      );
    }
    if (composedRenderDelta > productionCallbackDelta) {
      throw new TypeError(`Composed-frame boundary ${index} contains duplicate composed renders.`);
    }
    if (composedRenderDelta === 0) {
      if (internalRendererInvocations > 0) {
        throw new TypeError(`Composed-frame boundary ${index} has unattributed renderer progress.`);
      }
      continue;
    }
    if (composedRenderDelta !== 1) {
      throw new TypeError(
        `Composed-frame boundary ${index} must contain exactly one sampled composed render.`,
      );
    }
    if (internalRendererInvocations === 0) {
      throw new TypeError(`Composed-frame boundary ${index} lacks renderer progress.`);
    }
    const values = [current.calls, current.triangles, current.lines, current.points];
    if (!values.every((value) => Number.isInteger(value) && value >= 0)) {
      throw new TypeError(`Composed-frame render counters ${index} are incomplete.`);
    }
    const shadowBakeDelta = current.shadowBakes - previous.shadowBakes;
    if (!Number.isInteger(shadowBakeDelta) || shadowBakeDelta < 0) {
      throw new TypeError(`Composed-frame shadow counter ${index} is invalid.`);
    }
    if (shadowBakeDelta > composedRenderDelta) {
      throw new TypeError(
        `Composed-frame boundary ${index} contains more shadow bakes than composed renders.`,
      );
    }
    frames.push({
      source: [
        'THREE.WebGLRenderer.info after exactly one immutable composedRenders increment ',
        'bound to the production scheduler callback counter',
      ].join(''),
      sampleIndex: index,
      fromTimestampMs: finiteOrNull(previous.timestampMs),
      toTimestampMs: finiteOrNull(current.timestampMs),
      internalRendererInvocations,
      composedRenderDelta,
      productionCallbackDelta,
      drawCalls: Math.round(current.calls),
      renderedTriangles: Math.round(current.triangles),
      renderedLines: Math.round(current.lines),
      renderedPoints: Math.round(current.points),
      rendererInfoAutoReset: false,
      shadowBakesBefore: finiteOrNull(previous.shadowBakes),
      shadowBakesAfter: finiteOrNull(current.shadowBakes),
      shadowBakeDelta,
      frameClass: shadowBakeDelta > 0 ? 'shadow-bake' : 'non-shadow',
      workloadContext: cloneEvidence(stableWorkloadContext),
    });
  }
  if (!frames.length) {
    throw new TypeError('No production composed frame advanced during the diagnostic window.');
  }
  const nonShadowFrames = frames.filter(({ frameClass }) => frameClass === 'non-shadow');
  if (!nonShadowFrames.length) {
    throw new TypeError(
      'Composed-frame diagnostics require at least one production frame proven not to bake shadows.',
    );
  }
  const peakDrawCallFrame = [...nonShadowFrames].sort((left, right) => (
    right.drawCalls - left.drawCalls
    || right.renderedTriangles - left.renderedTriangles
    || left.sampleIndex - right.sampleIndex
  ))[0];
  const peakRenderedTriangleFrame = [...nonShadowFrames].sort((left, right) => (
    right.renderedTriangles - left.renderedTriangles
    || right.drawCalls - left.drawCalls
    || left.sampleIndex - right.sampleIndex
  ))[0];
  const peakDrawCalls = peakDrawCallFrame.drawCalls;
  const peakRenderedTriangles = peakRenderedTriangleFrame.renderedTriangles;
  const shadowBakeFrameCount = frames.filter(({ frameClass }) => frameClass === 'shadow-bake').length;
  const totalShadowBakeDelta = frames.reduce(
    (total, frame) => total + frame.shadowBakeDelta,
    0,
  );
  return {
    representative: {
      source: [
        'Independent peak draw-call and rendered-triangle non-shadow production composed ',
        'frames selected from complete immutable composedRenders/callback-bound evidence.',
      ].join(''),
      statistic: 'independent-peak-non-shadow-frames',
      drawCalls: peakDrawCalls,
      renderedTriangles: peakRenderedTriangles,
      peakDrawCallFrame: cloneEvidence(peakDrawCallFrame),
      peakRenderedTriangleFrame: cloneEvidence(peakRenderedTriangleFrame),
      observedFrameCount: frames.length,
      nonShadowFrameCount: nonShadowFrames.length,
      shadowBakeFrameCount,
      totalShadowBakeDelta,
      peakNonShadowDrawCalls: peakDrawCalls,
      peakNonShadowRenderedTriangles: peakRenderedTriangles,
      workloadContext: cloneEvidence(stableWorkloadContext),
    },
    frames,
    peakDrawCallFrame: cloneEvidence(peakDrawCallFrame),
    peakRenderedTriangleFrame: cloneEvidence(peakRenderedTriangleFrame),
    workloadContext: cloneEvidence(stableWorkloadContext),
    observedFrameCount: frames.length,
    nonShadowFrameCount: nonShadowFrames.length,
    shadowBakeFrameCount,
    totalShadowBakeDelta,
    unclassifiedFrameCount: 0,
    peakNonShadowDrawCalls: peakDrawCalls,
    peakNonShadowRenderedTriangles: peakRenderedTriangles,
  };
}

function nextObjectGroup(label) {
  captureSerial += 1;
  return `goal24-resource-${label}-${Date.now()}-${captureSerial}`;
}

/** Read-only listener census. No addEventListener monkeypatch is used. */
export async function captureGoal24EventListenerCensus(cdp, { batchSize = 32 } = {}) {
  if (!cdp || typeof cdp.send !== 'function') throw new TypeError('A CDP session is required.');
  const objectGroup = nextObjectGroup('listeners');
  try {
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: '[window, document, ...document.querySelectorAll("*")]',
      objectGroup,
      returnByValue: false,
      silent: true,
    });
    const arrayObjectId = evaluated?.result?.objectId;
    if (!arrayObjectId) throw new Error('CDP did not return the listener target array by reference.');
    const properties = await cdp.send('Runtime.getProperties', {
      objectId: arrayObjectId,
      ownProperties: true,
    });
    const targets = (properties?.result || [])
      .filter((property) => /^\d+$/.test(property.name) && property.value?.objectId)
      .sort((left, right) => Number(left.name) - Number(right.name))
      .map((property) => ({ index: Number(property.name), objectId: property.value.objectId }));
    const listeners = [];
    const failures = [];
    const size = positiveInteger(batchSize, 32, 100);
    for (let index = 0; index < targets.length; index += size) {
      const batch = targets.slice(index, index + size);
      const results = await Promise.all(batch.map(async (target) => {
        try {
          const response = await cdp.send('DOMDebugger.getEventListeners', {
            objectId: target.objectId,
          });
          return { target, listeners: response?.listeners || [] };
        } catch (error) {
          return { target, error: String(error?.message || error) };
        }
      }));
      for (const result of results) {
        if (result.error) {
          failures.push({ targetIndex: result.target.index, error: result.error });
          continue;
        }
        for (const listener of result.listeners) listeners.push(listener);
      }
    }
    const byType = {};
    const byAttribution = {};
    for (const listener of listeners) {
      const type = String(listener.type || 'unknown');
      byType[type] = (byType[type] || 0) + 1;
      const scriptId = listener.scriptId == null ? 'unknown-script' : String(listener.scriptId);
      const line = Number.isInteger(listener.lineNumber) ? listener.lineNumber : '?';
      const column = Number.isInteger(listener.columnNumber) ? listener.columnNumber : '?';
      const handler = String(
        listener.originalHandler?.description || listener.handler?.description || 'anonymous',
      ).replace(/\s+/g, ' ').slice(0, 160);
      const key = `${type} @ ${scriptId}:${line}:${column} ${handler}`;
      byAttribution[key] = (byAttribution[key] || 0) + 1;
    }
    return {
      source: `CDP DOMDebugger.getEventListeners over ${LISTENER_SCOPE}`,
      scope: LISTENER_SCOPE,
      limitation: LISTENER_LIMITATION,
      targetsInspected: targets.length - failures.length,
      targetCount: targets.length,
      lightDomElementsEnumerated: Math.max(0, targets.length - 2),
      targetsFailed: failures.length,
      complete: failures.length === 0,
      total: listeners.length,
      byType: countRecord(byType),
      byAttribution: countRecord(byAttribution),
      failures,
    };
  } finally {
    try {
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup });
    } catch {
      // A closed target has already released the group. There is no hook to retain.
    }
  }
}

async function appAudioDebugStats(page) {
  try {
    return await page.evaluate(() => {
      const debugStats = globalThis.__fw?.audio?.debugStats;
      if (typeof debugStats !== 'function') {
        return { available: false, value: null, error: 'window.__fw.audio.debugStats is unavailable' };
      }
      try {
        const value = debugStats.call(globalThis.__fw.audio);
        return { available: true, value: JSON.parse(JSON.stringify(value)), error: null };
      } catch (error) {
        return { available: false, value: null, error: String(error?.message || error) };
      }
    });
  } catch (error) {
    return { available: false, value: null, error: String(error?.message || error) };
  }
}

/**
 * Combines the production audio debug API with a read-only CDP heap query for
 * live AudioContext wrappers. Failure of the optional runtime query is explicit.
 */
export async function captureGoal24AudioContextEvidence(page, cdp) {
  if (!page || typeof page.evaluate !== 'function') throw new TypeError('A Playwright page is required.');
  if (!cdp || typeof cdp.send !== 'function') throw new TypeError('A CDP session is required.');
  const app = await appAudioDebugStats(page);
  const objectGroup = nextObjectGroup('audio');
  let runtime = {
    available: false,
    count: null,
    contexts: [],
    error: null,
    source: 'CDP Runtime.queryObjects using the main renderer AudioContext prototype',
    limitation: AUDIO_RUNTIME_LIMITATION,
  };
  try {
    const prototype = await cdp.send('Runtime.evaluate', {
      expression: '(() => { const C = globalThis.AudioContext || globalThis.webkitAudioContext; return C?.prototype || null; })()',
      objectGroup,
      returnByValue: false,
      silent: true,
    });
    const prototypeObjectId = prototype?.result?.objectId;
    if (!prototypeObjectId) {
      runtime.error = 'AudioContext is unavailable in the inspected renderer execution context.';
    } else {
      const queried = await cdp.send('Runtime.queryObjects', {
        prototypeObjectId,
        objectGroup,
      });
      const objectsObjectId = queried?.objects?.objectId;
      if (!objectsObjectId) throw new Error('Runtime.queryObjects returned no object array.');
      const states = await cdp.send('Runtime.callFunctionOn', {
        objectId: objectsObjectId,
        functionDeclaration: `function () {
          return Array.prototype.map.call(this, (context) => {
            try {
              return {
                state: String(context.state),
                sampleRate: Number.isFinite(context.sampleRate) ? context.sampleRate : null,
                baseLatency: Number.isFinite(context.baseLatency) ? context.baseLatency : null,
                outputLatency: Number.isFinite(context.outputLatency) ? context.outputLatency : null,
              };
            } catch (error) {
              return { state: 'unreadable', error: String(error && error.message || error) };
            }
          });
        }`,
        returnByValue: true,
        silent: true,
      });
      const contexts = Array.isArray(states?.result?.value) ? states.result.value : [];
      runtime = { ...runtime, available: true, count: contexts.length, contexts, error: null };
    }
  } catch (error) {
    runtime.error = String(error?.message || error);
  } finally {
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup }).catch(() => {});
  }
  const appInitialized = app.available && app.value?.initialized === true;
  const appSlotCount = app.available ? (appInitialized ? 1 : 0) : null;
  const count = runtime.available ? runtime.count : appSlotCount;
  return {
    source: runtime.available
      ? 'window.__fw.audio.debugStats() plus CDP Runtime.queryObjects(AudioContext.prototype)'
      : 'window.__fw.audio.debugStats(); CDP Runtime.queryObjects evidence unavailable',
    limitation: runtime.available
      ? AUDIO_RUNTIME_LIMITATION
      : `${AUDIO_RUNTIME_LIMITATION} The fallback count only describes the app-owned single context slot.`,
    count,
    app,
    runtime,
    agreement: runtime.available && app.available
      ? (appInitialized ? runtime.count >= 1 : runtime.count === 0)
      : null,
  };
}

async function captureProductionRenderAndScene(page, {
  observationFrames = 12,
  timeoutMs = 4000,
} = {}) {
  const frameCount = positiveInteger(observationFrames, 12, 120);
  const timeout = positiveInteger(timeoutMs, 4000, 15000);
  const production = await page.evaluate(({ frameCount: wantedFrames, timeout }) => new Promise((resolve, reject) => {
    const app = globalThis.__fw;
    const scene3d = app?.scene3d;
    const renderer = scene3d?.renderer;
    const scene = scene3d?.scene;
    if (!renderer?.info?.render || !scene?.traverse) {
      reject(new Error('Goal 24 resource diagnostics require window.__fw.scene3d renderer and scene.'));
      return;
    }
    if (typeof app.frameLoopDiagnostics !== 'function') {
      reject(new Error(
        'Goal 24 resource diagnostics require app.frameLoopDiagnostics() production evidence.',
      ));
      return;
    }

    let animationFrameId = 0;
    let settled = false;
    const samples = [];
    const rounded = (value) => (Number.isFinite(value)
      ? Math.round(Number(value) * 1e6) / 1e6 : null);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      clearTimeout(timeoutId);
      fn(value);
    };
    const readWorkloadContext = () => {
      const camera = scene3d.camera;
      const walk = scene3d.walk?.state;
      const ledger = (() => {
        try { return scene3d.clubhouse?.()?.ledgerBook?.diagnostics?.() || null; } catch { return null; }
      })();
      const heldTool = (() => {
        try { return scene3d.walk?.getTool?.() ?? null; } catch { return null; }
      })();
      return {
        schemaVersion: 2,
        appScreen: app.screen == null ? null : String(app.screen),
        prewarming: app.prewarming === true,
        camera: {
          fov: rounded(camera?.fov),
          aspect: rounded(camera?.aspect),
          near: rounded(camera?.near),
          far: rounded(camera?.far),
          position: {
            x: rounded(camera?.position?.x),
            y: rounded(camera?.position?.y),
            z: rounded(camera?.position?.z),
          },
          quaternion: {
            x: rounded(camera?.quaternion?.x),
            y: rounded(camera?.quaternion?.y),
            z: rounded(camera?.quaternion?.z),
            w: rounded(camera?.quaternion?.w),
          },
        },
        walk: {
          active: walk?.active === true,
          x: rounded(walk?.x),
          z: rounded(walk?.z),
          yaw: rounded(walk?.yaw),
          pitch: rounded(walk?.pitch),
          eye: rounded(walk?.eye),
          fov: rounded(walk?.fov),
        },
        heldTool: heldTool == null ? null : String(heldTool),
        ledger: {
          open: app.ledgerOpen === true,
          visualOpen: ledger?.open === true,
          state: ledger?.state == null ? null : String(ledger.state),
          spread: Number.isFinite(ledger?.spread) ? Number(ledger.spread) : null,
          pageCount: Number.isFinite(ledger?.pageCount) ? Number(ledger.pageCount) : null,
          turning: typeof ledger?.turning === 'boolean' ? ledger.turning : null,
        },
      };
    };
    const readCounters = (timestampMs) => {
      const postStats = (() => {
        try { return scene3d.post?.stats?.() || null; } catch { return null; }
      })();
      const frameLoop = app.frameLoopDiagnostics();
      return {
        timestampMs,
        rendererFrame: Number(renderer.info.render.frame),
        composedRenders: Number(postStats?.composedRenders),
        productionCallbackCount: Number(frameLoop?.callbackCount),
        calls: Number(renderer.info.render.calls),
        triangles: Number(renderer.info.render.triangles),
        lines: Number(renderer.info.render.lines),
        points: Number(renderer.info.render.points),
        rendererInfoAutoReset: renderer.info.autoReset,
        shadowBakes: Number.isFinite(postStats?.shadowBakes)
          ? Number(postStats.shadowBakes) : null,
        workloadContext: readWorkloadContext(),
      };
    };

    const textureSurfaces = (texture) => {
      const source = texture?.image ?? texture?.source?.data ?? null;
      const images = Array.isArray(source) ? source : [source];
      return images.map((image) => {
        const width = Number(image?.videoWidth || image?.naturalWidth || image?.width || 0);
        const height = Number(image?.videoHeight || image?.naturalHeight || image?.height || 0);
        const layers = Number(image?.depth || 1);
        return { width, height, layers };
      }).filter(({ width, height, layers }) => width > 0 && height > 0 && layers > 0);
    };
    const rgba8Bytes = ({ width, height, layers }, includeMipChain) => {
      let w = Math.floor(width);
      let h = Math.floor(height);
      let texels = w * h * Math.floor(layers);
      while (includeMipChain && (w > 1 || h > 1)) {
        w = Math.max(1, Math.floor(w / 2));
        h = Math.max(1, Math.floor(h / 2));
        texels += w * h * Math.floor(layers);
      }
      return Math.round(texels * 4);
    };
    const collectMaterialTextures = (material, target) => {
      if (!material) return;
      for (const key of Object.keys(material)) {
        let value;
        try { value = material[key]; } catch { continue; }
        if (value?.isTexture) target.add(value);
      }
      for (const uniform of Object.values(material.uniforms || {})) {
        const value = uniform?.value;
        if (value?.isTexture) target.add(value);
        if (Array.isArray(value)) {
          for (const entry of value) if (entry?.isTexture) target.add(entry);
        }
      }
    };
    const worldVisible = (object) => {
      for (let current = object; current; current = current.parent) {
        if (current.visible === false) return false;
      }
      return true;
    };
    const collectScene = () => {
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      const visibleGeometries = new Set();
      const visibleMaterials = new Set();
      const visibleTextures = new Set();
      let objects = 0;
      let meshes = 0;
      let instancedMeshes = 0;
      let visibleMeshes = 0;
      let sceneTrianglesBeforeFrustumCulling = 0;
      scene.traverse((object) => {
        objects += 1;
        if (!(object.isMesh || object.isInstancedMesh)) return;
        meshes += 1;
        if (object.isInstancedMesh) instancedMeshes += 1;
        if (object.geometry) geometries.add(object.geometry);
        const entries = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of entries) {
          if (!material) continue;
          materials.add(material);
          collectMaterialTextures(material, textures);
        }
        if (!worldVisible(object)) return;
        visibleMeshes += 1;
        if (object.geometry) {
          visibleGeometries.add(object.geometry);
          const primitiveTriangles = object.geometry.index
            ? Number(object.geometry.index.count || 0) / 3
            : Number(object.geometry.attributes?.position?.count || 0) / 3;
          sceneTrianglesBeforeFrustumCulling += primitiveTriangles
            * (object.isInstancedMesh ? Number(object.count || 0) : 1);
        }
        for (const material of entries) {
          if (!material) continue;
          visibleMaterials.add(material);
          collectMaterialTextures(material, visibleTextures);
        }
      });
      let estimatedVisibleTextureBytes = 0;
      let textureDimensionsKnown = 0;
      let textureDimensionsUnknown = 0;
      let sceneTextureDimensionsKnown = 0;
      let sceneTextureDimensionsUnknown = 0;
      let visibleTextureSurfaces = 0;
      for (const texture of textures) {
        if (textureSurfaces(texture).length) sceneTextureDimensionsKnown += 1;
        else sceneTextureDimensionsUnknown += 1;
      }
      for (const texture of visibleTextures) {
        const surfaces = textureSurfaces(texture);
        if (!surfaces.length) {
          textureDimensionsUnknown += 1;
          continue;
        }
        textureDimensionsKnown += 1;
        visibleTextureSurfaces += surfaces.length;
        const includeMipChain = texture.generateMipmaps !== false
          || (Array.isArray(texture.mipmaps) && texture.mipmaps.length > 1);
        for (const surface of surfaces) {
          estimatedVisibleTextureBytes += rgba8Bytes(surface, includeMipChain);
        }
      }
      return {
        source: 'Identity sets collected by one read-only THREE.Scene.traverse checkpoint',
        objects,
        meshes,
        instancedMeshes,
        geometries: geometries.size,
        materials: materials.size,
        textures: textures.size,
        visibleMeshes,
        visibleGeometries: visibleGeometries.size,
        visibleMaterials: visibleMaterials.size,
        visibleTextures: visibleTextures.size,
        visibleTextureSurfaces,
        textureDimensionsKnown,
        textureDimensionsUnknown,
        sceneTextureDimensionsKnown,
        sceneTextureDimensionsUnknown,
        sceneTrianglesBeforeFrustumCulling: Math.round(sceneTrianglesBeforeFrustumCulling),
        estimatedVisibleTextureBytes: Math.round(estimatedVisibleTextureBytes),
        rendererMemory: {
          source: 'THREE.WebGLRenderer.info.memory live allocation counters (counts, not bytes)',
          geometries: Number(renderer.info.memory?.geometries),
          textures: Number(renderer.info.memory?.textures),
          programs: Array.isArray(renderer.info.programs)
            ? renderer.info.programs.length : Number.NaN,
        },
      };
    };

    // The timestamp delivered to the first queued rAF can describe the frame
    // boundary immediately before this synchronous setup work. Do not attach a
    // later performance.now() value to that earlier boundary; the monotonic
    // renderer/shadow counters, not this untimed setup sample, define the first
    // interval.
    samples.push(readCounters(null));
    const onAnimationFrame = (timestamp) => {
      try {
        const current = readCounters(timestamp);
        samples.push(current);
        if (samples.length >= wantedFrames + 1) {
          finish(resolve, {
            renderSamples: samples,
            frameLoopDiagnostics: app.frameLoopDiagnostics(),
            scene: collectScene(),
          });
          return;
        }
        animationFrameId = requestAnimationFrame(onAnimationFrame);
      } catch (error) {
        finish(reject, error);
      }
    };
    const timeoutId = setTimeout(() => {
      finish(reject, new Error(`Production render observation timed out after ${timeout} ms.`));
    }, timeout);
    animationFrameId = requestAnimationFrame(onAnimationFrame);
  }), { frameCount, timeout });
  const composed = summarizeGoal24ComposedFrames(production.renderSamples);
  return {
    ...production,
    composedFrame: composed.representative,
    composedFrames: composed.frames,
    composedFrameSummary: {
      observedFrameCount: composed.observedFrameCount,
      nonShadowFrameCount: composed.nonShadowFrameCount,
      shadowBakeFrameCount: composed.shadowBakeFrameCount,
      totalShadowBakeDelta: composed.totalShadowBakeDelta,
      unclassifiedFrameCount: composed.unclassifiedFrameCount,
      peakNonShadowDrawCalls: composed.peakNonShadowDrawCalls,
      peakNonShadowRenderedTriangles: composed.peakNonShadowRenderedTriangles,
      peakDrawCallFrame: composed.peakDrawCallFrame,
      peakRenderedTriangleFrame: composed.peakRenderedTriangleFrame,
      workloadContext: composed.workloadContext,
    },
  };
}

function metric(source, unit = 'count', extra = {}) {
  return { source, unit, ...extra };
}

function normalizeRenderSample(sample, index) {
  if (!sample || typeof sample !== 'object') {
    throw new TypeError(`Production render sample ${index} is missing.`);
  }
  const timestampMs = sample.timestampMs;
  if (!((index === 0 && timestampMs === null)
    || (Number.isFinite(timestampMs) && timestampMs >= 0))) {
    throw new TypeError(`Production render sample ${index} has an invalid timestamp.`);
  }
  const integers = {};
  const counterKeys = [
    'rendererFrame', 'composedRenders', 'productionCallbackCount', 'shadowBakes',
    ...(index === 0 ? [] : ['calls', 'triangles', 'lines', 'points']),
  ];
  for (const key of counterKeys) {
    if (!Number.isInteger(sample[key]) || sample[key] < 0) {
      throw new TypeError(`Production render sample ${index} has invalid ${key}.`);
    }
    integers[key] = sample[key];
  }
  if (sample.rendererInfoAutoReset !== false) {
    throw new TypeError(
      `Production render sample ${index} must explicitly prove renderer.info.autoReset === false.`,
    );
  }
  return {
    timestampMs,
    ...integers,
    rendererInfoAutoReset: false,
    workloadContext: normalizeWorkloadContext(
      sample.workloadContext,
      `Production render sample ${index} workload context`,
    ),
  };
}

function normalizeFrameLoopEvidence(value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Goal 24 production frame-loop evidence is missing.');
  }
  return cloneEvidence({
    schemaVersion: value.schemaVersion,
    ownerToken: value.ownerToken,
    rootStartCount: value.rootStartCount,
    scheduleCount: value.scheduleCount,
    callbackCount: value.callbackCount,
    pendingCallbackCount: value.pendingCallbackCount,
    maximumPendingCallbackCount: value.maximumPendingCallbackCount,
    schedulingFailureCount: value.schedulingFailureCount,
    pendingUnderflowCount: value.pendingUnderflowCount,
    firstRootStartAtMs: value.firstRootStartAtMs,
    lastCallbackAtMs: value.lastCallbackAtMs,
  }, 'production frame-loop evidence');
}

function normalizeProductionEvidence(production) {
  if (!production || typeof production !== 'object') {
    throw new TypeError('Goal 24 production resource evidence is missing.');
  }
  if (!Array.isArray(production.renderSamples)
    || !production.frameLoopDiagnostics
    || !production.scene) {
    throw new TypeError('Goal 24 production resource evidence is incomplete.');
  }
  const renderSamples = production.renderSamples.map(normalizeRenderSample);
  for (let index = 1; index < renderSamples.length; index += 1) {
    const previous = renderSamples[index - 1].timestampMs;
    const current = renderSamples[index].timestampMs;
    if (!Number.isFinite(current)
      || (Number.isFinite(previous) && current <= previous)) {
      throw new TypeError('Production render sample timestamps must increase exactly in order.');
    }
  }
  return cloneEvidence({
    renderSamples,
    frameLoopDiagnostics: normalizeFrameLoopEvidence(production.frameLoopDiagnostics),
    scene: production.scene,
  }, 'production measurement evidence');
}

function buildGoal24ResourceSnapshot({
  capturedAt,
  label,
  gcCompleted,
  heap,
  dom,
  listeners,
  audio,
  production,
  renderLoopBaselineInternalRendererInvocations = null,
}) {
  if (typeof capturedAt !== 'string' || capturedAt.length === 0) {
    throw new TypeError('Goal 24 resource capture timestamp is missing.');
  }
  const normalizedLabel = String(label || 'resource-checkpoint');
  const normalizedBaseline = renderLoopBaselineInternalRendererInvocations == null
    ? null : renderLoopBaselineInternalRendererInvocations;
  if (normalizedBaseline != null
    && (!Number.isInteger(normalizedBaseline) || normalizedBaseline <= 0)) {
    throw new TypeError('Goal 24 internal renderer-pass reference must be a positive integer.');
  }
  const measurementEvidence = cloneEvidence({
    schemaVersion: GOAL24_RESOURCE_MEASUREMENT_EVIDENCE_SCHEMA_VERSION,
    capturedAt,
    label: normalizedLabel,
    capturedOutsideTimedInteraction: true,
    gcCompleted: gcCompleted === true,
    renderLoopBaselineInternalRendererInvocations: normalizedBaseline,
    heap: {
      usedSize: heap?.usedSize,
      totalSize: heap?.totalSize,
      embedderHeapUsedSize: heap?.embedderHeapUsedSize ?? null,
      backingStorageSize: heap?.backingStorageSize ?? null,
    },
    dom: {
      documents: dom?.documents,
      nodes: dom?.nodes,
      jsEventListeners: dom?.jsEventListeners,
    },
    listeners,
    audio,
    production: normalizeProductionEvidence(production),
  });
  const raw = measurementEvidence;
  const scene = raw.production.scene;
  const composed = summarizeGoal24ComposedFrames(raw.production.renderSamples);
  const frame = composed.representative;
  const renderLoop = deriveRenderLoopInvariant(raw.production.renderSamples, {
    referenceInternalRendererInvocations: raw.renderLoopBaselineInternalRendererInvocations,
    productionSchedulerDiagnostics: raw.production.frameLoopDiagnostics,
  });
  if (raw.listeners.complete !== true) {
    throw new TypeError('Incomplete CDP event-listener census cannot supply a graded resource metric.');
  }
  if (raw.audio.agreement === false) {
    throw new TypeError('App audio debugStats and CDP AudioContext evidence disagree.');
  }
  if (renderLoop.absoluteProductionSchedulerProof !== true) {
    throw new TypeError(
      'Production frame-loop diagnostics do not supply complete absolute scheduler evidence.',
    );
  }
  if (renderLoop.invariantHolds !== true) {
    throw new TypeError('Production composed-render/callback invariant does not hold.');
  }
  const integerMetric = (name, value, { positive = false } = {}) => {
    if (!Number.isInteger(value) || value < 0 || (positive && value === 0)) {
      throw new TypeError(`Invalid Goal 24 resource metric ${name}: ${value}`);
    }
    return value;
  };
  const metrics = {
    jsHeapUsedBytes: integerMetric('jsHeapUsedBytes', raw.heap.usedSize, { positive: true }),
    domNodeCount: integerMetric('domNodeCount', raw.dom.nodes),
    sceneObjectCount: integerMetric('sceneObjectCount', scene.objects),
    meshCount: integerMetric('meshCount', scene.meshes),
    materialCount: integerMetric('materialCount', scene.materials),
    geometryCount: integerMetric('geometryCount', scene.geometries),
    textureCount: integerMetric('textureCount', scene.textures),
    rendererGeometryAllocationCount: integerMetric(
      'rendererGeometryAllocationCount', scene.rendererMemory?.geometries,
    ),
    rendererTextureAllocationCount: integerMetric(
      'rendererTextureAllocationCount', scene.rendererMemory?.textures,
    ),
    rendererProgramCount: integerMetric(
      'rendererProgramCount', scene.rendererMemory?.programs,
    ),
    textureDimensionsUnknownCount: integerMetric(
      'textureDimensionsUnknownCount', scene.sceneTextureDimensionsUnknown,
    ),
    activeEventListenerCount: integerMetric('activeEventListenerCount', raw.listeners.total),
    renderCallbackCount: integerMetric(
      'renderCallbackCount', renderLoop.renderCallbackCount,
    ),
    renderLoopCount: integerMetric('renderLoopCount', renderLoop.renderLoopCount),
    audioContextCount: integerMetric('audioContextCount', raw.audio.count),
    drawCallCount: integerMetric('drawCallCount', frame.drawCalls),
    renderedTriangleCount: integerMetric(
      'renderedTriangleCount', frame.renderedTriangles,
    ),
    estimatedTextureBytes: integerMetric(
      'estimatedTextureBytes', scene.estimatedVisibleTextureBytes,
    ),
    observedComposedFrameCount: integerMetric(
      'observedComposedFrameCount', composed.observedFrameCount, { positive: true },
    ),
    shadowBakeFrameCount: integerMetric(
      'shadowBakeFrameCount', composed.shadowBakeFrameCount,
    ),
    shadowBakeCount: integerMetric(
      'shadowBakeCount', composed.totalShadowBakeDelta,
    ),
  };
  const metricSources = {
    jsHeapUsedBytes: metric(raw.gcCompleted
      ? 'CDP Runtime.getHeapUsage.usedSize after the checkpoint HeapProfiler.collectGarbage request'
      : 'CDP Runtime.getHeapUsage.usedSize without a helper-requested collection', 'bytes'),
    domNodeCount: metric('CDP Memory.getDOMCounters.nodes over the inspected renderer target'),
    sceneObjectCount: metric('Read-only THREE.Scene.traverse object count'),
    meshCount: metric('Read-only THREE.Scene.traverse Mesh/InstancedMesh object count'),
    materialCount: metric('Unique material object identities referenced by the live THREE scene'),
    geometryCount: metric('Unique geometry object identities referenced by the live THREE scene'),
    textureCount: metric('Unique texture object identities referenced by live scene materials/uniforms'),
    rendererGeometryAllocationCount: metric(
      'THREE.WebGLRenderer.info.memory.geometries live allocation count',
    ),
    rendererTextureAllocationCount: metric(
      'THREE.WebGLRenderer.info.memory.textures live allocation count',
    ),
    rendererProgramCount: metric('THREE.WebGLRenderer.info.programs live program count'),
    textureDimensionsUnknownCount: metric(
      'Scene-referenced THREE.Texture identities with no readable positive source dimensions',
    ),
    activeEventListenerCount: metric(raw.listeners.source, 'count', {
      limitations: raw.listeners.limitation,
      complete: raw.listeners.complete,
    }),
    renderCallbackCount: metric(renderLoop.source, 'count', {
      limitations: renderLoop.limitation,
      invariant: true,
      invariantHolds: renderLoop.invariantHolds,
      duplicateProgressionObserved: renderLoop.duplicateProgressionObserved,
      baselineInternalRendererInvocations: renderLoop.baselineInternalRendererInvocations,
      absoluteProductionSchedulerProof: renderLoop.absoluteProductionSchedulerProof,
      ownerToken: renderLoop.productionScheduler.ownerToken,
      rootStartCount: renderLoop.productionScheduler.rootStartCount,
      pendingCallbackCount: renderLoop.productionScheduler.pendingCallbackCount,
      maximumPendingCallbackCount:
        renderLoop.productionScheduler.maximumPendingCallbackCount,
      schedulerAccountingConsistent: renderLoop.productionScheduler.accountingConsistent,
    }),
    renderLoopCount: metric(renderLoop.source, 'count', {
      limitations: renderLoop.limitation,
      invariant: true,
      invariantHolds: renderLoop.invariantHolds,
      duplicateProgressionObserved: renderLoop.duplicateProgressionObserved,
      baselineInternalRendererInvocations: renderLoop.baselineInternalRendererInvocations,
      absoluteProductionSchedulerProof: renderLoop.absoluteProductionSchedulerProof,
      ownerToken: renderLoop.productionScheduler.ownerToken,
      rootStartCount: renderLoop.productionScheduler.rootStartCount,
      pendingCallbackCount: renderLoop.productionScheduler.pendingCallbackCount,
      maximumPendingCallbackCount:
        renderLoop.productionScheduler.maximumPendingCallbackCount,
      schedulerAccountingConsistent: renderLoop.productionScheduler.accountingConsistent,
    }),
    audioContextCount: metric(raw.audio.source, 'count', { limitations: raw.audio.limitation }),
    drawCallCount: metric(frame.source, 'count', {
      statistic: 'peak-non-shadow-draw-calls',
      stratification: 'scene3d.post.stats().shadowBakes monotonic production counter',
      evidencePath: 'diagnostics.composedFrameSummary.peakDrawCallFrame',
    }),
    renderedTriangleCount: metric(frame.source, 'count', {
      statistic: 'peak-non-shadow-rendered-triangles',
      stratification: 'scene3d.post.stats().shadowBakes monotonic production counter',
      evidencePath: 'diagnostics.composedFrameSummary.peakRenderedTriangleFrame',
    }),
    estimatedTextureBytes: metric(
      'Visible-by-scene-hierarchy texture dimensions, estimated as RGBA8 plus mip levels',
      'bytes',
      { estimated: true, limitations: TEXTURE_LIMITATION },
    ),
    observedComposedFrameCount: metric(
      'Count of exact composedRenders increments retained in diagnostics.composedFrames',
    ),
    shadowBakeFrameCount: metric(
      'Observed composed frames with a positive scene3d.post.stats().shadowBakes delta',
    ),
    shadowBakeCount: metric(
      'Exact summed scene3d.post.stats().shadowBakes delta over observed composed frames',
    ),
  };
  const snapshot = {
    schemaVersion: GOAL24_RESOURCE_DIAGNOSTICS_SCHEMA_VERSION,
    label: raw.label,
    capturedAt: raw.capturedAt,
    capturedOutsideTimedInteraction: true,
    gcCompleted: raw.gcCompleted,
    metrics,
    metricSources,
    diagnostics: {
      heap: {
        source: 'CDP Runtime.getHeapUsage',
        usedSize: finiteOrNull(raw.heap.usedSize),
        totalSize: finiteOrNull(raw.heap.totalSize),
        embedderHeapUsedSize: finiteOrNull(raw.heap.embedderHeapUsedSize),
        backingStorageSize: finiteOrNull(raw.heap.backingStorageSize),
      },
      dom: {
        source: 'CDP Memory.getDOMCounters',
        documents: finiteOrNull(raw.dom.documents),
        nodes: finiteOrNull(raw.dom.nodes),
        jsEventListeners: finiteOrNull(raw.dom.jsEventListeners),
      },
      listeners: raw.listeners,
      audio: raw.audio,
      renderLoop,
      composedFrame: frame,
      composedFrameSummary: {
        observedFrameCount: composed.observedFrameCount,
        nonShadowFrameCount: composed.nonShadowFrameCount,
        shadowBakeFrameCount: composed.shadowBakeFrameCount,
        totalShadowBakeDelta: composed.totalShadowBakeDelta,
        unclassifiedFrameCount: composed.unclassifiedFrameCount,
        peakNonShadowDrawCalls: composed.peakNonShadowDrawCalls,
        peakNonShadowRenderedTriangles: composed.peakNonShadowRenderedTriangles,
        peakDrawCallFrame: composed.peakDrawCallFrame,
        peakRenderedTriangleFrame: composed.peakRenderedTriangleFrame,
        workloadContext: composed.workloadContext,
      },
      composedFrames: composed.frames,
      workloadContext: composed.workloadContext,
      rendererMemory: scene.rendererMemory,
      textureEstimate: {
        estimatedVisibleTextureBytes: scene.estimatedVisibleTextureBytes,
        estimatedVisibleTextureMiB: Math.round(
          scene.estimatedVisibleTextureBytes / 1048576 * 1000,
        ) / 1000,
        visibleTextures: scene.visibleTextures,
        visibleTextureSurfaces: scene.visibleTextureSurfaces,
        textureDimensionsKnown: scene.textureDimensionsKnown,
        textureDimensionsUnknown: scene.textureDimensionsUnknown,
        sceneTextureDimensionsKnown: scene.sceneTextureDimensionsKnown,
        sceneTextureDimensionsUnknown: scene.sceneTextureDimensionsUnknown,
        qualification: TEXTURE_LIMITATION,
      },
      scene,
    },
    instrumentation: {
      policy: 'checkpoint-only-outside-timed-interaction-windows',
      persistentHooksInstalled: false,
      shippingFunctionsPatched: false,
      shippingSchedulerDiagnostics: 'production-owned monotonic counters with snapshot-only access',
      mutationObserversInstalled: false,
      cleanup: 'Runtime object groups are released after each CDP census/query; rAF and timer callbacks end with the snapshot.',
    },
    measurementEvidence,
  };
  return deepFreeze(snapshot);
}

/** Pure assembly keeps the resource schema unit-testable without a live CDP target. */
export function assembleGoal24ResourceSnapshot(input) {
  return buildGoal24ResourceSnapshot(input);
}

/**
 * Recompute the complete snapshot from retained raw measurement evidence. This
 * rejects projections that drop samples/diagnostics or mutate metrics and
 * provenance independently of the evidence that produced them.
 */
export function validateGoal24ResourceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object'
    || snapshot.schemaVersion !== GOAL24_RESOURCE_DIAGNOSTICS_SCHEMA_VERSION) {
    throw new TypeError('Goal 24 resource snapshot schema is missing or unsupported.');
  }
  const evidence = snapshot.measurementEvidence;
  if (!evidence || evidence.schemaVersion
    !== GOAL24_RESOURCE_MEASUREMENT_EVIDENCE_SCHEMA_VERSION) {
    throw new TypeError('Goal 24 resource snapshot raw measurement evidence is missing.');
  }
  const expected = buildGoal24ResourceSnapshot({
    capturedAt: evidence.capturedAt,
    label: evidence.label,
    gcCompleted: evidence.gcCompleted,
    heap: evidence.heap,
    dom: evidence.dom,
    listeners: evidence.listeners,
    audio: evidence.audio,
    production: evidence.production,
    renderLoopBaselineInternalRendererInvocations:
      evidence.renderLoopBaselineInternalRendererInvocations,
  });
  if (!exactEvidenceEqual(snapshot, expected)) {
    throw new TypeError(
      'Goal 24 resource snapshot differs from recomputed raw measurement evidence.',
    );
  }
  return true;
}

/** Capture one complete checkpoint using an existing CDP session. */
export async function captureGoal24ResourceSnapshot(page, {
  cdp,
  label = 'resource-checkpoint',
  outsideTimedInteraction = false,
  collectGarbage = true,
  gcSettleMs = 40,
  renderObservationFrames = 12,
  renderTimeoutMs = 4000,
  renderLoopBaselineInternalRendererInvocations = null,
} = {}) {
  if (outsideTimedInteraction !== true) {
    throw new Error(
      'Goal 24 resource diagnostics are checkpoint-only; pass outsideTimedInteraction: true.',
    );
  }
  if (!page || typeof page.evaluate !== 'function') throw new TypeError('A Playwright page is required.');
  if (!cdp || typeof cdp.send !== 'function') throw new TypeError('A CDP session is required.');
  let gcCompleted = false;
  if (collectGarbage) {
    await cdp.send('HeapProfiler.collectGarbage');
    gcCompleted = true;
    const settle = Math.max(0, Math.min(1000, Math.floor(Number(gcSettleMs) || 0)));
    if (settle) await new Promise((resolve) => setTimeout(resolve, settle));
  }
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const listeners = await captureGoal24EventListenerCensus(cdp);
  const audio = await captureGoal24AudioContextEvidence(page, cdp);
  const production = await captureProductionRenderAndScene(page, {
    observationFrames: renderObservationFrames,
    timeoutMs: renderTimeoutMs,
  });
  const snapshot = assembleGoal24ResourceSnapshot({
    capturedAt: new Date().toISOString(),
    label,
    gcCompleted,
    heap,
    dom,
    listeners,
    audio,
    production,
    renderLoopBaselineInternalRendererInvocations,
  });
  validateGoal24ResourceSnapshot(snapshot);
  return snapshot;
}

/**
 * Owns a CDP session when the caller does not provide one. dispose() is
 * idempotent and detaches only a session created by this helper.
 */
export async function createGoal24ResourceDiagnostics(page, { cdp = null } = {}) {
  if (!page || typeof page.evaluate !== 'function') throw new TypeError('A Playwright page is required.');
  let session = cdp;
  let ownsSession = false;
  if (!session) {
    const context = page.context?.();
    if (!context || typeof context.newCDPSession !== 'function') {
      throw new TypeError('The Playwright page context cannot create a CDP session.');
    }
    session = await context.newCDPSession(page);
    ownsSession = true;
  }
  let disposed = false;
  let snapshotInFlight = false;
  let renderLoopBaselineInternalRendererInvocations = null;
  return Object.freeze({
    schemaVersion: GOAL24_RESOURCE_DIAGNOSTICS_SCHEMA_VERSION,
    snapshot(options = {}) {
      if (disposed) throw new Error('Goal 24 resource diagnostics have been disposed.');
      if (snapshotInFlight) throw new Error('A Goal 24 resource checkpoint is already in progress.');
      snapshotInFlight = true;
      const pending = captureGoal24ResourceSnapshot(page, {
        ...options,
        cdp: session,
        renderLoopBaselineInternalRendererInvocations,
      });
      return pending.then((result) => {
        if (renderLoopBaselineInternalRendererInvocations == null) {
          renderLoopBaselineInternalRendererInvocations =
            result.diagnostics.renderLoop.localBaselineInternalRendererInvocations;
        }
        return result;
      }).finally(() => { snapshotInFlight = false; });
    },
    async dispose() {
      if (disposed) return false;
      disposed = true;
      if (ownsSession && typeof session.detach === 'function') {
        try { await session.detach(); } catch { /* target closure already detached it */ }
      }
      return true;
    },
  });
}

export const GOAL24_RESOURCE_QUALIFICATIONS = Object.freeze({
  listeners: LISTENER_LIMITATION,
  audioContexts: AUDIO_RUNTIME_LIMITATION,
  renderLoop: RENDER_LOOP_LIMITATION,
  textureMemory: TEXTURE_LIMITATION,
});
