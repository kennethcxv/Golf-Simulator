import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  STARTUP_INPUT_EVENT_TYPES,
  createStartupHold,
  installStartupInputHold,
} from '../src/core/startupHold.js';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function eventScope() {
  const listeners = new Map();
  const removals = [];
  return {
    listeners,
    removals,
    addEventListener(type, listener, options) {
      const entries = listeners.get(type) || [];
      entries.push({ listener, options });
      listeners.set(type, entries);
    },
    removeEventListener(type, listener, options) {
      removals.push({ type, listener, options });
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((entry) => entry.listener !== listener));
    },
    dispatch(type, overrides = {}) {
      const event = {
        type,
        key: '',
        ctrlKey: false,
        metaKey: false,
        target: null,
        prevented: 0,
        stopped: 0,
        preventDefault() { this.prevented += 1; },
        stopImmediatePropagation() { this.stopped += 1; },
        ...overrides,
      };
      for (const { listener } of listeners.get(type) || []) listener(event);
      return event;
    },
  };
}

test('only the attached current scene can release and recover the intended speed rung', () => {
  const hold = createStartupHold();
  const firstScene = {};
  const secondScene = {};
  const first = hold.begin({ generation: 7, intendedSpeedIdx: 1 });
  assert.equal(hold.attachScene(first, firstScene), true);

  const second = hold.begin({ generation: 8, intendedSpeedIdx: 1 });
  assert.equal(hold.attachScene(second, secondScene), true);
  assert.equal(hold.complete(first, firstScene), null,
    'a late prewarm cannot release the replacement scene hold');
  assert.equal(hold.cancelForScene(firstScene), false,
    'disposing the replaced scene cannot cancel the replacement hold');
  assert.deepEqual(hold.diagnostics(), {
    pending: true,
    tokenId: second.id,
    generation: 8,
    intendedSpeedIdx: 1,
    sceneAttached: true,
    beginCount: 2,
  });

  assert.equal(hold.complete(second, firstScene), null,
    'even the current token must name its attached scene');
  assert.deepEqual(hold.complete(second, secondScene), {
    generation: 8,
    intendedSpeedIdx: 1,
  });
  assert.equal(hold.isPending(), false);
});

test('failure cancellation never returns a speed rung for restoration', () => {
  const hold = createStartupHold();
  const scene = {};
  const token = hold.begin({ generation: 21, intendedSpeedIdx: 1 });
  assert.equal(hold.attachScene(token, scene), true);
  assert.equal(hold.cancelForScene(scene), true);
  assert.equal(hold.complete(token, scene), null,
    'a failed prewarm has no completion value a caller could restore');
  assert.equal(hold.isPending(), false);
});

test('the fixed input barrier consumes hidden gameplay input and stays reload/fatal-safe', () => {
  const hold = createStartupHold();
  const scope = eventScope();
  const installation = installStartupInputHold({ scope, hold });

  assert.deepEqual([...scope.listeners.keys()], [...STARTUP_INPUT_EVENT_TYPES]);
  for (const type of STARTUP_INPUT_EVENT_TYPES) {
    assert.equal(scope.listeners.get(type).length, 1, `${type} installs exactly once`);
    assert.deepEqual(scope.listeners.get(type)[0].options, { capture: true, passive: false });
  }

  hold.begin({ generation: 1, intendedSpeedIdx: 1 });
  for (const type of STARTUP_INPUT_EVENT_TYPES) {
    const event = scope.dispatch(type, { key: type === 'keydown' ? 'e' : '' });
    assert.equal(event.prevented, 1, `${type} is default-blocked behind the veil`);
    assert.equal(event.stopped, 1, `${type} cannot reach a later global handler`);
  }

  const fatal = scope.dispatch('click', {
    target: { closest: (selector) => (selector === '.fault-panel' ? {} : null) },
  });
  assert.equal(fatal.prevented, 0);
  assert.equal(fatal.stopped, 0, 'the recovery panel remains clickable after a startup fault');

  for (const shortcut of [
    { key: 'F5' },
    { key: 'r', ctrlKey: true },
    { key: 'R', metaKey: true },
  ]) {
    const reload = scope.dispatch('keydown', shortcut);
    assert.equal(reload.prevented, 0, `${shortcut.key} reload remains available`);
    assert.equal(reload.stopped, 0);
  }

  hold.cancel();
  const playable = scope.dispatch('pointerdown');
  assert.equal(playable.prevented, 0);
  assert.equal(playable.stopped, 0, 'normal input resumes after the hold ends');

  assert.equal(installation.dispose(), true);
  assert.equal(installation.dispose(), false, 'teardown is idempotent');
  assert.equal(scope.removals.length, STARTUP_INPUT_EVENT_TYPES.length);
  assert.ok([...scope.listeners.values()].every((entries) => entries.length === 0));
});

test('shipping startup keeps rung zero until successful current-scene completion', () => {
  const startAt = mainSource.indexOf('function startGame(');
  const startNowAt = mainSource.indexOf('\nfunction startGameNow(', startAt);
  const prewarmEnd = mainSource.indexOf('\n// full-screen loading veil', startNowAt);
  assert.ok(startAt >= 0 && startNowAt > startAt && prewarmEnd > startNowAt);
  const start = mainSource.slice(startAt, startNowAt);
  const startNow = mainSource.slice(startNowAt, prewarmEnd);

  const begin = start.indexOf('const startupToken = startupHold.begin({');
  const pause = start.indexOf('app.speedIdx = 0;');
  const firstYield = start.indexOf('requestAnimationFrame(() => {');
  assert.ok(begin >= 0 && pause > begin && firstYield > pause,
    'the capability and rung-zero hold begin before either loading-frame yield');
  assert.equal((start.match(/startGameNow\(state, loadNotice, generation, startupToken\)/g) || []).length, 2,
    'barrier and no-barrier paths carry the same ownership token');

  const attach = startNow.indexOf('startupHold.attachScene(startupToken, app.scene3d)');
  const prewarm = startNow.indexOf('.prewarm(');
  const successGate = startNow.indexOf('if (!prewarmSucceeded', prewarm);
  const complete = startNow.indexOf('startupHold.complete(startupToken, sceneRef)', successGate);
  const restore = startNow.indexOf('app.speedIdx = startupCompletion.intendedSpeedIdx;', complete);
  const resetFrameClock = startNow.indexOf('lastTs = performance.now();', restore);
  const unveil = startNow.indexOf('veil.hide();', resetFrameClock);
  assert.ok(attach >= 0 && prewarm > attach && successGate > prewarm
    && complete > successGate && restore > complete
    && resetFrameClock > restore && unveil > resetFrameClock,
  'only a successful, still-current attached scene can restore speed and reset hidden dt before unveiling');
  assert.doesNotMatch(startNow.slice(0, successGate), /app\.speedIdx\s*=\s*1\s*;/,
    'scene construction cannot silently resume simulation behind the veil');
});

test('the production frame hold sits before every save-relevant or input-driven mutation', () => {
  const frameAt = mainSource.indexOf('function frame(ts)');
  const frameEnd = mainSource.indexOf('\nconst CONDITION_WORD', frameAt);
  assert.ok(frameAt >= 0 && frameEnd > frameAt);
  const frame = mainSource.slice(frameAt, frameEnd);
  const gate = frame.indexOf('if (startupHold.isPending()) {');
  const gateEnd = frame.indexOf('\n  }', gate);
  assert.ok(gate >= 0 && gateEnd > gate);
  assert.match(frame.slice(gate, gateEnd), /scheduleProductionFrame\(\);\s*return;/,
    'held frames retain the one production scheduler and perform no work');

  const boundaries = [
    'keyboardCamera(dtMs)',
    'app.state.golfDay.speedRung =',
    'empireUpdate(app.empire, gameMinutes)',
    "autosave('rollover')",
    'autosaveClock += dtMs',
    'tickDeliveries(app.state, app.state.clock.minutes)',
    'app.scene3d.walk.update(dtMs)',
    'tickTutorial(app.state)',
    'updatePhoneRing(ts)',
  ];
  for (const boundary of boundaries) {
    const at = frame.indexOf(boundary);
    assert.ok(at > gateEnd, `${boundary} must remain beyond the startup return boundary`);
  }
});

test('input interception is installed before all gameplay listeners and clears pre-hold latches', () => {
  const installation = mainSource.indexOf('installStartupInputHold({ scope: window, hold: startupHold });');
  const firstGameplayListener = mainSource.indexOf("canvas.addEventListener('click'");
  assert.ok(installation >= 0 && firstGameplayListener > installation,
    'the startup barrier must outrank later capture and bubble handlers');

  const startAt = mainSource.indexOf('function startGame(');
  const resetAt = mainSource.indexOf('resetStartupInputLatches();', startAt);
  const yieldAt = mainSource.indexOf('requestAnimationFrame(() => {', startAt);
  assert.ok(resetAt > startAt && yieldAt > resetAt,
    'pre-existing key, drag, trigger, and wheel latches clear before hidden frames');
});
