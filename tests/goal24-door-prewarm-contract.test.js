import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createFirstDoorVisibilityReady } from '../src/render3d/clubhouse/firstDoorVisibilityReady.js';

const courseSceneSource = readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);
const clubhouseSource = readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
);
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const performanceDriverSource = readFileSync(
  new URL('../tools/qa/electron-goal24-interaction-performance.js', import.meta.url),
  'utf8',
);

const FIRST_DOOR_SOURCE_NAMES = Object.freeze([
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

const sourceInputs = (sources) => Object.fromEntries(
  FIRST_DOOR_SOURCE_NAMES.map((source, index) => [source, sources[index].promise]),
);

const resolvedSourceInputs = () => Object.fromEntries(FIRST_DOOR_SOURCE_NAMES.map(
  (source) => [source, Promise.resolve({ lifecycle: 'dormant', source })],
));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const manualDeadline = () => {
  let callback = null;
  let delayMs = null;
  let cancelled = false;
  const handle = Object.freeze({ type: 'manual-deadline' });
  return {
    scheduleTimeout(nextCallback, nextDelayMs) {
      callback = nextCallback;
      delayMs = nextDelayMs;
      return handle;
    },
    cancelTimeout(nextHandle) {
      assert.strictEqual(nextHandle, handle);
      cancelled = true;
    },
    fire() {
      assert.equal(typeof callback, 'function', 'deadline must be scheduled before it can fire');
      callback();
    },
    diagnostics: () => ({ delayMs, cancelled }),
  };
};

const assertDeepFrozen = (value, seen = new WeakSet()) => {
  if (value == null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
};

test('first-door visibility readiness waits for all nine runtimes and returns a deeply frozen ready report', async () => {
  const sources = Array.from({ length: FIRST_DOOR_SOURCE_NAMES.length }, deferred);
  const deadline = manualDeadline();
  let clock = 100;
  const diagnosticValues = Object.fromEntries(FIRST_DOOR_SOURCE_NAMES.map(
    (source, index) => [source, { ready: true, sourceIndex: index + 1 }],
  ));
  const ready = createFirstDoorVisibilityReady({
    ...sourceInputs(sources),
    diagnostics: Object.fromEntries(FIRST_DOOR_SOURCE_NAMES.map(
      (source) => [source, () => diagnosticValues[source]],
    )),
    timeoutMs: 80,
    now: () => clock,
    scheduleTimeout: deadline.scheduleTimeout,
    cancelTimeout: deadline.cancelTimeout,
  });
  let settled = false;
  ready.then(() => { settled = true; });
  for (let index = 0; index < sources.length - 1; index += 1) {
    sources[index].resolve(index + 1);
    await Promise.resolve();
    assert.equal(settled, false, `barrier settled before source ${index + 2}`);
  }
  clock = 175;
  sources.at(-1).resolve(sources.length);
  const result = await ready;
  assert.deepEqual(result, {
    status: 'ready',
    safeToPrewarm: true,
    startedAtMs: 100,
    deadlineAtMs: 180,
    settledAtMs: 175,
    durationMs: 75,
    timeoutMs: 80,
    pending: [],
    degradedSources: [],
    errors: [],
    settlements: Object.fromEntries(FIRST_DOOR_SOURCE_NAMES.map(
      (source) => [source, { status: 'fulfilled' }],
    )),
    values: Object.fromEntries(FIRST_DOOR_SOURCE_NAMES.map(
      (source, index) => [source, index + 1],
    )),
    diagnostics: diagnosticValues,
  });
  assertDeepFrozen(result);
  assert.deepEqual(deadline.diagnostics(), { delayMs: 80, cancelled: true });
});

test('settled loader failures and fallback diagnostics resolve as safe degraded readiness', async () => {
  let clock = 200;
  const ready = createFirstDoorVisibilityReady({
    ...resolvedSourceInputs(),
    sheet06: Promise.resolve({ activationStatus: 'fallback' }),
    architecturalDoors: Promise.resolve({ ready: true }),
    props: Promise.resolve({ placed: 39 }),
    pineHillsInterior: Promise.reject(new TypeError('Pine interior loader broke')),
    diagnostics: {
      props: () => ({ failed: 1, failures: [{ asset: 'welcome-mat' }] }),
    },
    timeoutMs: 50,
    now: () => clock,
  });
  clock = 212;
  const result = await ready;

  assert.equal(result.status, 'degraded');
  assert.equal(result.safeToPrewarm, true,
    'a fully settled fallback cannot mount more late geometry during prewarm');
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.degradedSources, ['sheet06', 'props', 'pineHillsInterior']);
  assert.deepEqual(result.errors, [{
    source: 'pineHillsInterior',
    name: 'TypeError',
    message: 'Pine interior loader broke',
    code: null,
  }]);
  assert.deepEqual(result.settlements.pineHillsInterior, { status: 'rejected' });
  assert.equal(result.values.pineHillsInterior, null);
  assert.deepEqual(result.diagnostics.props, {
    failed: 1,
    failures: [{ asset: 'welcome-mat' }],
  });
  assertDeepFrozen(result);
});

test('deadline resolves once with pending names, normalized errors, and immutable snapshots', async () => {
  const sources = Array.from({ length: FIRST_DOOR_SOURCE_NAMES.length }, deferred);
  const deadline = manualDeadline();
  const sheet06Value = { activationStatus: 'active', nested: { loaded: 6 } };
  let clock = 300;
  const ready = createFirstDoorVisibilityReady({
    ...sourceInputs(sources),
    timeoutMs: 25,
    now: () => clock,
    scheduleTimeout: deadline.scheduleTimeout,
    cancelTimeout: deadline.cancelTimeout,
  });
  sources[0].resolve(sheet06Value);
  sources[1].reject('door decode failed');
  await Promise.resolve();
  clock = 325;
  deadline.fire();
  const result = await ready;

  assert.equal(result.status, 'timed-out');
  assert.equal(result.safeToPrewarm, false);
  assert.equal(result.settledAtMs, 325);
  assert.deepEqual(result.pending, FIRST_DOOR_SOURCE_NAMES.slice(2));
  assert.deepEqual(result.degradedSources, ['architecturalDoors']);
  assert.deepEqual(result.settlements, Object.fromEntries(FIRST_DOOR_SOURCE_NAMES.map(
    (source, index) => [source, {
      status: index === 0 ? 'fulfilled' : (index === 1 ? 'rejected' : 'pending'),
    }],
  )));
  assert.deepEqual(result.errors, [
    {
      source: 'architecturalDoors',
      name: 'Error',
      message: 'door decode failed',
      code: null,
    },
    {
      source: 'barrier',
      name: 'TimeoutError',
      message: 'First-door visibility readiness exceeded 25 ms.',
      code: 'FIRST_DOOR_VISIBILITY_TIMEOUT',
    },
  ]);
  assert.deepEqual(result.values.sheet06, sheet06Value);
  assertDeepFrozen(result);

  sheet06Value.nested.loaded = 99;
  sources[2].resolve({ placed: 40 });
  sources[3].resolve({ loaded: 20 });
  await Promise.resolve();
  assert.equal(result.values.sheet06.nested.loaded, 6,
    'the report owns its snapshot instead of freezing or retaining the live result');
  assert.equal(result.settlements.props.status, 'pending',
    'late loader completion cannot mutate the already-issued timeout report');
});

test('diagnostic and timer-scheduler faults are converted into resolved reports', async () => {
  const diagnosticReport = await createFirstDoorVisibilityReady({
    ...resolvedSourceInputs(),
    diagnostics: {
      props: () => { throw new Error('diagnostic unavailable'); },
    },
  });
  assert.equal(diagnosticReport.status, 'degraded');
  assert.equal(diagnosticReport.safeToPrewarm, true);
  assert.deepEqual(diagnosticReport.degradedSources, ['props']);
  assert.deepEqual(diagnosticReport.errors, [{
    source: 'props',
    name: 'Error',
    message: 'diagnostic unavailable',
    code: 'FIRST_DOOR_DIAGNOSTIC_FAILED',
  }]);

  const never = deferred();
  const timerReport = await createFirstDoorVisibilityReady({
    ...Object.fromEntries(FIRST_DOOR_SOURCE_NAMES.map((source) => [source, never.promise])),
    timeoutMs: 10,
    scheduleTimeout: () => { throw new Error('timer unavailable'); },
  });
  assert.equal(timerReport.status, 'timed-out');
  assert.equal(timerReport.safeToPrewarm, false);
  assert.deepEqual(timerReport.pending, FIRST_DOOR_SOURCE_NAMES);
  assert.deepEqual(timerReport.errors.map((error) => error.code), [
    'FIRST_DOOR_TIMEOUT_SCHEDULE_FAILED',
    'FIRST_DOOR_VISIBILITY_TIMEOUT',
  ]);
  assertDeepFrozen(timerReport);
});

test('missing required runtime is invalid and unsafe instead of silently fulfilling null', async () => {
  const result = await createFirstDoorVisibilityReady({
    ...resolvedSourceInputs(),
    premiumCountryClub: undefined,
  });

  assert.equal(result.status, 'invalid');
  assert.equal(result.safeToPrewarm, false);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.degradedSources, ['premiumCountryClub']);
  assert.deepEqual(result.settlements.premiumCountryClub, { status: 'missing' });
  assert.deepEqual(result.errors, [{
    source: 'premiumCountryClub',
    name: 'MissingReadinessSourceError',
    message: 'Required first-door readiness source is missing: premiumCountryClub.',
    code: 'FIRST_DOOR_SOURCE_MISSING',
  }]);
  assertDeepFrozen(result);
});

test('disposing in-flight readiness cancels its deadline and resolves one unsafe report', async () => {
  const sources = Array.from({ length: FIRST_DOOR_SOURCE_NAMES.length }, deferred);
  const deadline = manualDeadline();
  let diagnosticCalls = 0;
  let clock = 400;
  const ready = createFirstDoorVisibilityReady({
    ...sourceInputs(sources),
    diagnostics: Object.fromEntries(FIRST_DOOR_SOURCE_NAMES.map((source) => [
      source,
      () => { diagnosticCalls += 1; return { source }; },
    ])),
    timeoutMs: 80,
    now: () => clock,
    scheduleTimeout: deadline.scheduleTimeout,
    cancelTimeout: deadline.cancelTimeout,
  });
  sources[0].resolve({ loaded: 6 });
  await Promise.resolve();

  clock = 412;
  assert.equal(ready.dispose(), true, 'first disposal owns the in-flight barrier');
  assert.equal(ready.dispose(), false, 'readiness disposal is idempotent');
  const result = await ready;

  assert.equal(result.status, 'disposed');
  assert.equal(result.safeToPrewarm, false);
  assert.equal(result.settledAtMs, 412);
  assert.deepEqual(result.pending, FIRST_DOOR_SOURCE_NAMES.slice(1));
  assert.deepEqual(result.settlements.sheet06, { status: 'fulfilled' });
  assert.deepEqual(result.values.sheet06, { loaded: 6 });
  assert.deepEqual(result.errors, [{
    source: 'barrier',
    name: 'DisposedError',
    message: 'First-door visibility readiness was disposed before settlement.',
    code: 'FIRST_DOOR_VISIBILITY_DISPOSED',
  }]);
  assert.equal(diagnosticCalls, 0,
    'disposal does not call diagnostic closures on runtimes entering teardown');
  assert.deepEqual(deadline.diagnostics(), { delayMs: 80, cancelled: true });
  assertDeepFrozen(result);

  deadline.fire();
  for (const source of sources.slice(1)) source.resolve({ loaded: 1 });
  await Promise.resolve();
  assert.equal(result.status, 'disposed',
    'late deadline/source completion cannot reopen or mutate the terminal report');
});

test('prewarm joins global asset idle with door readiness before compilation or drawing', () => {
  const start = courseSceneSource.indexOf('async function prewarm(onStep)');
  const end = courseSceneSource.indexOf('\n  const postApi', start);
  assert.ok(start >= 0 && end > start, 'prewarm body must exist');
  const body = courseSceneSource.slice(start, end);
  const barrier = body.indexOf('prewarmClubhouse?.firstDoorVisibilityReady');
  const assetIdleGuard = body.indexOf('assetIdleReport?.safeToPrewarm !== true', barrier);
  const unsafeGuard = body.indexOf('doorVisibilityReport?.safeToPrewarm !== true', barrier);
  const timeWeatherSync = body.indexOf(
    'applyTimeWeather(prewarmMinuteOfDay, state.weather);',
    barrier,
  );
  const circuitSync = body.indexOf('clubhouseApi?.syncCeilingCircuitPower?.();', timeWeatherSync);
  const compileStep = body.indexOf("step('Compiling shaders')");
  const compile = body.indexOf('renderer.compile(');
  const firstDraw = body.indexOf('composer.render()');
  assert.ok(barrier >= 0, 'door visibility barrier must be joined during prewarm');
  assert.ok(assetIdleGuard > barrier && unsafeGuard >= assetIdleGuard
    && timeWeatherSync > unsafeGuard && circuitSync > timeWeatherSync && compileStep > circuitSync
    && compile > compileStep && firstDraw > compile,
    'unsafe readiness must fail before authoritative render sync, compilation, or forced drawing');
  assert.match(body,
    /const prewarmMinuteOfDay = Number\.isFinite\(prewarmClockMinutes\)[\s\S]*?% 1440[\s\S]*?: 720;/,
    'prewarm must derive a bounded minute of day from serialized state');
  assert.match(body, /const \[nextAssetIdleReport, doorVisibilityReport\] = await Promise\.all/,
    'global loading must return an explicit report instead of silently timing out');
  assert.match(courseSceneSource, /assetIdleReport: \(\) => assetIdleReport/,
    'the app and QA can inspect the exact global-idle outcome');
  assert.doesNotMatch(body, /clubhouseApi\?\.update|clubhouseApi\.update/,
    'render-only prewarm must not advance clubhouse simulation');
  const clubhouseBarrierStart = clubhouseSource.indexOf('createFirstDoorVisibilityReady({');
  const clubhouseBarrierEnd = clubhouseSource.indexOf('\n  });', clubhouseBarrierStart);
  assert.ok(clubhouseBarrierStart >= 0 && clubhouseBarrierEnd > clubhouseBarrierStart,
    'clubhouse first-door barrier construction must remain discoverable');
  const clubhouseBarrierBody = clubhouseSource.slice(clubhouseBarrierStart, clubhouseBarrierEnd);
  const expectedSources = {
    sheet06: 'sheet06Production.ready',
    architecturalDoors: 'architecturalDoorInstallation.ready',
    props: 'props61to100.ready',
    pineHillsInterior: 'pineHillsInterior.ready',
    shedInterior: 'shedInterior?.ready ?? Promise.resolve',
    modernPublic: 'modernClubhouse.ready',
    mountainLodge: 'mountainLodge.ready',
    resortClubhouse: 'resortClubhouse.ready',
    premiumCountryClub: 'premiumCountryClub.ready',
  };
  const expectedDiagnostics = {
    sheet06: 'sheet06Production.diagnostics()',
    architecturalDoors: 'architecturalDoorInstallation.diagnostics()',
    props: 'props61to100.diagnostics()',
    pineHillsInterior: 'pineHillsInterior.diagnostics()',
    shedInterior: 'shedInterior?.diagnostics?.() ?? Object.freeze',
    modernPublic: 'modernClubhouse.diagnostics()',
    mountainLodge: 'mountainLodge.diagnostics()',
    resortClubhouse: 'resortClubhouse.diagnostics()',
    premiumCountryClub: 'premiumCountryClub.diagnostics()',
  };
  for (const [source, expression] of Object.entries(expectedSources)) {
    assert.ok(clubhouseBarrierBody.includes(`${source}: ${expression}`),
      `${source} readiness must join the first-door barrier`);
  }
  for (const [source, expression] of Object.entries(expectedDiagnostics)) {
    assert.ok(clubhouseBarrierBody.includes(`${source}: () => ${expression}`),
      `${source} diagnostics must be captured by the readiness report`);
  }
  assert.doesNotMatch(clubhouseBarrierBody, /\bdetail:/,
    'a generic detail slot must not hide variant-specific readiness omissions');
  assert.match(clubhouseSource, /\r?\n\s*firstDoorVisibilityReady,\r?\n/,
    'clubhouse public API must expose the exact composite promise');
  const disposalStart = clubhouseSource.indexOf('function dispose() {');
  const readinessDisposal = clubhouseSource.indexOf(
    'firstDoorVisibilityReady.dispose?.()',
    disposalStart,
  );
  const firstRuntimeDisposal = clubhouseSource.indexOf(
    'premiumCountryClub.dispose()',
    disposalStart,
  );
  assert.ok(disposalStart >= 0 && readinessDisposal > disposalStart
    && firstRuntimeDisposal > readinessDisposal,
  'clubhouse teardown must cancel readiness before disposing constituent runtimes');
  assert.match(clubhouseSource,
    /function syncCameraVisibility\(\) \{[\s\S]*?syncCeilingCircuitPower\(\);[\s\S]*?interior\.visible =/,
    'every render-only visibility sync must apply authoritative circuit power first');
  assert.match(clubhouseSource,
    /update, syncCameraVisibility, syncCeilingCircuitPower,/,
    'prewarm must receive the non-advancing circuit synchronizer');
  assert.match(courseSceneSource,
    /firstDoorVisibilityReport: \(\) => firstDoorVisibilityReport/,
    'the app must be able to surface the exact immutable readiness report');
});

test('app keeps the veil and offers reload when prewarm cannot settle safely', () => {
  const start = mainSource.indexOf('const sceneRef = app.scene3d;');
  const end = mainSource.indexOf('// full-screen loading veil', start);
  assert.ok(start >= 0 && end > start, 'shipping prewarm caller must remain discoverable');
  const body = mainSource.slice(start, end);
  const catchAt = body.indexOf('.catch((error) =>');
  const staleGuard = body.indexOf(
    'if (app.scene3d !== sceneRef || generation !== sceneStartGeneration) return;',
    catchAt,
  );
  const invalidate = body.indexOf('sceneStartGeneration += 1;', staleGuard);
  const dispose = body.indexOf('destroyCurrentScene({ hideVeil: false });', invalidate);
  const fatal = body.indexOf('showFatalPanel({', dispose);
  const successGate = body.indexOf('if (!prewarmSucceeded', fatal);
  const unveil = body.indexOf('veil.hide();', successGate);

  assert.ok(catchAt > 0 && staleGuard > catchAt && invalidate > staleGuard
    && dispose > invalidate && fatal > dispose,
  'failure must be reported, generation-gated, disposed once, and routed to reload');
  assert.match(body, /reportFault\('scene\.prewarm', error,/);
  assert.ok(successGate > fatal && unveil > successGate,
    'finally may unveil only a successful, still-current prewarm');
  assert.doesNotMatch(body, /\.catch\(\(\) => \{\}\)/,
    'prewarm rejection must never be silently swallowed');
});

test('editor-camera warm restores the exact shipping render-only state', () => {
  const start = courseSceneSource.indexOf('async function prewarm(onStep)');
  const end = courseSceneSource.indexOf('\n  const postApi', start);
  const body = courseSceneSource.slice(start, end);
  const editorDraw = body.indexOf("phaseAt = markPrewarm('editor-camera-warm'", 0);
  const restoreCamera = body.indexOf('camera.position.copy(savedView.cameraPosition);', editorDraw);
  const restoreInterior = body.indexOf(
    'clubhouseApi.interior.visible = savedView.clubhouseInteriorVisible;',
    restoreCamera,
  );
  const restoreSync = body.indexOf('clubhouseApi?.syncCameraVisibility?.();', restoreInterior);
  const settle = body.indexOf('for (let i = 0; i < 3; i++)', restoreSync);
  assert.ok(editorDraw >= 0 && restoreCamera > editorDraw && restoreInterior > restoreCamera
    && restoreSync > restoreInterior && settle > restoreSync,
  'camera, interior, detail visibility, and circuit state restore before settling frames');
});

test('cold door evidence preserves the seeded boot clock until the route closes', () => {
  const fixtureStart = performanceDriverSource.indexOf('report.fixture = await page.evaluate');
  const doorStart = performanceDriverSource.indexOf("if (wants('door'))", fixtureStart);
  const afterStart = performanceDriverSource.indexOf(
    'report.fixtureAfterColdDoor = await page.evaluate',
    doorStart,
  );
  const settleStart = performanceDriverSource.indexOf(
    'await sleep(Number(process.env.GOAL24_PERF_SETTLE_MS',
    afterStart,
  );
  assert.ok(fixtureStart >= 0 && doorStart > fixtureStart
    && afterStart > doorStart && settleStart > afterStart);
  const preDoorFixture = performanceDriverSource.slice(fixtureStart, doorStart);
  const postDoorFixture = performanceDriverSource.slice(afterStart, settleStart);
  assert.doesNotMatch(preDoorFixture, /state\.clock\.minutes\s*=/,
    'the harness must not invent a shader-light state after shipping prewarm');
  assert.match(preDoorFixture, /clockMutationDeferredUntilAfterColdDoor: true/);
  assert.match(postDoorFixture, /fw\.state\.clock\.minutes = day \+ 14 \* 60;/);
  assert.match(postDoorFixture, /clockNormalizedAfterColdDoor: true/);
});
