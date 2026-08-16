// FIRST-RUN COMPILE SCREEN — the gate's decision table and the copy, pinned.
//
// What this file can honestly certify: the pure decision (stamp x driver key),
// the stamp's tolerance of garbage, the exact player copy, and that the
// orchestrator writes the stamp ONLY on a finished compile. Whether the screen
// actually appears on a fresh profile and never on the second boot is a claim
// about the running game, and tools/qa/electron-compile-screen.js owns it
// (three modes: first-run, absent, driver-update).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPILE_TITLE,
  COMPILE_LINES,
  COMPILE_STAMP_KEY,
  decideCompileScreen,
  readCompileStamp,
  writeCompileStamp,
  startCompileScreen,
} from '../src/ui/compileScreen.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    dump: () => Object.fromEntries(map),
  };
}

test('the words are the shipped-game words, and only the first run says "once"', () => {
  assert.equal(COMPILE_TITLE, 'Compiling shaders');
  assert.equal(COMPILE_LINES['first-run'], 'First-time setup. This only happens once.');
  assert.equal(COMPILE_LINES['driver-update'], 'Your graphics driver was updated. Rebuilding for the new version.');
  // The liar clause: after a driver update the game must NOT repeat the
  // "only happens once" promise it already made.
  assert.ok(!/only happens once/i.test(COMPILE_LINES['driver-update']));
  // ITEM 28: no em dash in anything the player reads.
  for (const line of [COMPILE_TITLE, ...Object.values(COMPILE_LINES)]) {
    assert.ok(!line.includes('—'), `em dash in player copy: "${line}"`);
  }
});

test('decision table: no stamp -> first run; changed driver -> driver update; match -> nothing', () => {
  const key = 'Google Inc. (NVIDIA) | ANGLE (...) D3D11-31.0.15.4633 | WebGL 2.0';
  assert.deepEqual(decideCompileScreen(null, key), { show: true, mode: 'first-run' });
  assert.deepEqual(
    decideCompileScreen({ v: 1, driver: 'ANGLE (...) D3D11-30.0.14.0000', programs: 171 }, key),
    { show: true, mode: 'driver-update' },
  );
  assert.deepEqual(decideCompileScreen({ v: 1, driver: key, programs: 171 }, key), { show: false, mode: null });
  // No driver key means no attribution: never claim, never stamp.
  assert.deepEqual(decideCompileScreen(null, null), { show: false, mode: null });
});

test('the version clause needs two KNOWN versions to call a driver update', () => {
  const key = 'V | GPU | WebGL 2.0';
  const stamped = (drv) => ({ v: 1, driver: key, drv, programs: 171 });
  // both known, different: the one true driver-update signal on this build
  assert.deepEqual(
    decideCompileScreen(stamped('32.0.15.0000'), key, '32.0.16.1088'),
    { show: true, mode: 'driver-update' },
  );
  // both known, equal: silent
  assert.deepEqual(decideCompileScreen(stamped('32.0.16.1088'), key, '32.0.16.1088'), { show: false, mode: null });
  // current unknown (bridge slow or absent): silent — unknown is not "changed"
  assert.deepEqual(decideCompileScreen(stamped('32.0.16.1088'), key, null), { show: false, mode: null });
  // stamp predates the version field: silent — no evidence of change
  assert.deepEqual(decideCompileScreen({ v: 1, driver: key, programs: 171 }, key, '32.0.16.1088'), { show: false, mode: null });
  // and a version difference must never DOWNGRADE a first run to an update
  assert.deepEqual(decideCompileScreen(null, key, '32.0.16.1088'), { show: true, mode: 'first-run' });
});

test('a garbage stamp reads as no stamp at all', () => {
  assert.equal(readCompileStamp(null), null);
  assert.equal(readCompileStamp(fakeStorage()), null);
  assert.equal(readCompileStamp(fakeStorage({ [COMPILE_STAMP_KEY]: 'not json {' })), null);
  assert.equal(readCompileStamp(fakeStorage({ [COMPILE_STAMP_KEY]: '{"driver":42}' })), null);
  assert.equal(readCompileStamp(fakeStorage({ [COMPILE_STAMP_KEY]: '{"driver":""}' })), null);
  const store = fakeStorage();
  writeCompileStamp(store, 'driver-A', 171);
  assert.equal(readCompileStamp(store).driver, 'driver-A');
  assert.equal(readCompileStamp(store).programs, 171);
});

function fakeWorld({ stamp = null, driver = 'DRIVER-A', programsAtFinish = 171 } = {}) {
  const gl = {
    getExtension: () => null,
    getParameter: (p) => ({ VENDOR: 'V', RENDERER: driver, VERSION: 'WebGL 2.0' })[
      Object.entries({ VENDOR: 'VENDOR', RENDERER: 'RENDERER', VERSION: 'VERSION' })
        .find(([, name]) => gl[name] === p)?.[0]
    ],
    VENDOR: 'VENDOR', RENDERER: 'RENDERER', VERSION: 'VERSION',
  };
  let programs = 12;
  const renderer = {
    getContext: () => gl,
    info: { programs: { get length() { return programs; } } },
  };
  const calls = [];
  const veil = {
    compileBegin: (...a) => calls.push(['begin', ...a]),
    compileCount: (...a) => calls.push(['count', ...a]),
    compileEnd: () => calls.push(['end']),
  };
  const store = fakeStorage(stamp ? { [COMPILE_STAMP_KEY]: JSON.stringify(stamp) } : {});
  return {
    renderer, veil, store, calls,
    setPrograms: (n) => { programs = n; },
    finishAt: programsAtFinish,
  };
}

test('the orchestrator: shows on first run, stamps only on finish(true), lands on n / n', (t) => {
  const rafs = [];
  t.mock.method(globalThis, 'setInterval', () => 0, { getter: false });
  globalThis.requestAnimationFrame = (fn) => { rafs.push(fn); return rafs.length; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const w = fakeWorld();
    const screen = startCompileScreen({ renderer: w.renderer, veil: w.veil, storage: w.store });
    assert.equal(screen.active, true);
    assert.equal(screen.mode, 'first-run');
    const begin = w.calls.find((c) => c[0] === 'begin');
    assert.deepEqual(begin, ['begin', 'first-run', COMPILE_TITLE, COMPILE_LINES['first-run']]);
    // count paints are clamped under the expected total and never fabricated
    const firstCount = w.calls.find((c) => c[0] === 'count');
    assert.equal(firstCount[1], 12); // the live count, not a timer's opening value
    w.setPrograms(171);
    screen.finish(true);
    const last = w.calls[w.calls.length - 2];
    assert.deepEqual(last, ['count', 171, 171], 'the final paint lands on n / n');
    assert.equal(w.calls[w.calls.length - 1][0], 'end');
    assert.equal(readCompileStamp(w.store).programs, 171);
    screen.finish(true); // idempotent
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test('finish(false) leaves NO stamp: an aborted first compile happens again next boot', (t) => {
  t.mock.method(globalThis, 'setInterval', () => 0, { getter: false });
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const w = fakeWorld();
    const screen = startCompileScreen({ renderer: w.renderer, veil: w.veil, storage: w.store });
    assert.equal(screen.active, true);
    screen.finish(false);
    assert.equal(readCompileStamp(w.store), null);
    assert.equal(w.calls[w.calls.length - 1][0], 'end');
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test('a matching stamp shows nothing and touches nothing, with no rAF in sight', () => {
  // No rAF/interval stubs on purpose: if the quiet path ever starts a pump,
  // this test crashes in Node - that IS the assertion.
  const w = fakeWorld();
  writeCompileStamp(w.store, 'V | DRIVER-A | WebGL 2.0', 171);
  const screen = startCompileScreen({ renderer: w.renderer, veil: w.veil, storage: w.store });
  assert.equal(screen.active, false);
  assert.deepEqual(w.calls, []);
  const before = w.store.dump();
  screen.finish(true);
  assert.deepEqual(w.store.dump(), before, 'the stamp is not rewritten on a quiet boot');
  assert.deepEqual(w.calls, [], 'no veil calls on a quiet boot');
});

test('a changed driver key shows the rebuild line and re-arms the stamp', (t) => {
  t.mock.method(globalThis, 'setInterval', () => 0, { getter: false });
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const w = fakeWorld({ stamp: { v: 1, driver: 'OLD-DRIVER 1.0', programs: 150 } });
    const screen = startCompileScreen({ renderer: w.renderer, veil: w.veil, storage: w.store });
    assert.equal(screen.mode, 'driver-update');
    const begin = w.calls.find((c) => c[0] === 'begin');
    assert.equal(begin[3], COMPILE_LINES['driver-update']);
    w.setPrograms(180);
    screen.finish(true);
    assert.equal(readCompileStamp(w.store).driver, 'V | DRIVER-A | WebGL 2.0');
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});
