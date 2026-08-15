// A (Goal 20) — the QA virtual pointer lock.
//
// The dangerous half of this feature is not that it works, it is that it might
// work IN THE SHIPPED GAME. A player whose pointer lock had been quietly
// replaced would have a camera driven by absolute cursor position inside a
// window they could leave at any moment. So the first test here is the one that
// proves the shim is inert without the launch flag, and it runs against the
// same module the game imports.
import test from 'node:test';
import assert from 'node:assert/strict';

// The flag is read at module-eval time (it has to be: the shim must be in place
// before any listener is registered), so each case imports a fresh instance.
let loadSeq = 0;
async function loadWith(args) {
  globalThis.fairwayNative = args ? { launchArgs: args } : undefined;
  loadSeq += 1;
  return import(`../src/core/qaLookCapture.js?case=${loadSeq}`);
}

function fakeDom() {
  const events = [];
  const listeners = [];
  class FakeElement {}
  const doc = {
    hasFocus: () => false,
    dispatchEvent: (e) => { events.push(e.type); return true; },
  };
  const win = {
    Element: FakeElement,
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
  };
  return { doc, win, events, listeners, FakeElement };
}

test('without the QA launch flag the shim never installs', async () => {
  const mod = await loadWith(null);
  assert.equal(mod.QA_VIRTUAL_LOOK, false);
  const { doc, win, listeners } = fakeDom();
  assert.equal(mod.installQaLookCapture(doc, win), false);
  // untouched: no pointerLockElement, no listener, real hasFocus
  assert.equal('pointerLockElement' in doc, false);
  assert.equal(listeners.length, 0);
  assert.equal(doc.hasFocus(), false);
});

test('--fw-dev and --fw-clubhouse alone do not arm it', async () => {
  const mod = await loadWith(['--fw-dev', '--fw-clubhouse=pine-hills-v2']);
  assert.equal(mod.QA_VIRTUAL_LOOK, false);
  const { doc, win } = fakeDom();
  assert.equal(mod.installQaLookCapture(doc, win), false);
});

test('--fw-qa-pointerlock hands the real lock back', async () => {
  const mod = await loadWith(['--fw-qa', '--fw-qa-pointerlock']);
  assert.equal(mod.QA_VIRTUAL_LOOK, false, 'the opt-out must beat the opt-in');
  const { doc, win } = fakeDom();
  assert.equal(mod.installQaLookCapture(doc, win), false);
});

test('--fw-qa installs a lock the page cannot tell from the real one', async () => {
  const mod = await loadWith(['--fw-qa', '--fw-clubhouse=pine-hills-v2']);
  assert.equal(mod.QA_VIRTUAL_LOOK, true);
  const { doc, win, events, listeners, FakeElement } = fakeDom();
  assert.equal(mod.installQaLookCapture(doc, win), true);

  assert.equal(doc.pointerLockElement, null);
  const canvas = new FakeElement();
  canvas.requestPointerLock();
  assert.equal(doc.pointerLockElement, canvas, 'the game reads a held lock');
  assert.deepEqual(events, ['pointerlockchange']);

  doc.exitPointerLock();
  assert.equal(doc.pointerLockElement, null);
  assert.deepEqual(events, ['pointerlockchange', 'pointerlockchange']);

  // releasing twice must not fire a second change: the game's walkLockChange
  // calls walkBlur() on every one it hears, and a spurious blur drops held keys
  doc.exitPointerLock();
  assert.equal(events.length, 2);

  assert.equal(doc.hasFocus(), true, 'injected input does not need OS focus');

  const move = listeners.find((l) => l.type === 'mousemove');
  assert.ok(move && move.capture === true, 'must see the event before the game does');
});

test('the move shim reports position deltas, and only while the lock is held', async () => {
  const mod = await loadWith(['--fw-qa']);
  const { doc, win, listeners, FakeElement } = fakeDom();
  mod.installQaLookCapture(doc, win);
  const fire = listeners.find((l) => l.type === 'mousemove').fn;
  const ev = (x, y) => ({ clientX: x, clientY: y, movementX: 999, movementY: 999 });

  // NOT held: the shim leaves the native values alone, so an unlocked driver
  // cannot turn the view — the same guarantee real pointer lock gives.
  const idle = ev(100, 100);
  fire(idle);
  assert.equal(idle.movementX, 999, 'untouched while unlocked');

  const canvas = new FakeElement();
  canvas.requestPointerLock();
  const first = ev(800, 450);
  fire(first);
  assert.equal(first.movementX, 0, 'the first event after a lock never jumps');
  assert.equal(first.movementY, 0);

  const second = ev(830, 460);
  fire(second);
  assert.equal(second.movementX, 30);
  assert.equal(second.movementY, 10);

  const third = ev(800, 450);
  fire(third);
  assert.equal(third.movementX, -30, 'a move back is a negative delta');
  assert.equal(third.movementY, -10);

  // re-locking must not deliver the accumulated jump the game guards against
  doc.exitPointerLock();
  canvas.requestPointerLock();
  const after = ev(1400, 900);
  fire(after);
  assert.equal(after.movementX, 0);
});
