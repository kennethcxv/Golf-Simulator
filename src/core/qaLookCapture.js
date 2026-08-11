// A (Goal 20) — THE QA WINDOW MUST NEVER CAPTURE THE OPERATOR'S CURSOR.
//
// THE TRAP. Every QA driver drives the camera the way the player does: it
// clicks the canvas, the game calls canvas.requestPointerLock(), and the view
// turns. But Chromium's pointer lock is an OS-level seizure — it hides the
// system cursor and calls ClipCursor() to confine it to the window. Measured
// with tools/qa/cursor-capture-watch.ps1 during a normal run: CURSOR_SHOWING
// clear, and the confinement rectangle collapsed from the 5120x1440 desktop to
// [7,30,1608,930], the QA window. For as long as a session ran, the machine's
// owner could not use their own mouse.
//
// Real pointer lock and a free cursor cannot coexist on one desktop: Chromium
// only grants lock to a FOCUSED window and releases it the moment focus goes,
// so "locked but not capturing" does not exist. Something had to give.
//
// WHAT GIVES, AND WHAT DOES NOT. The game's own input path is untouched: the
// events are still real, trusted, injected through the browser's input
// pipeline, hit-tested and dispatched to the same listeners in the same order.
// The single thing replaced is the LOCK PRIMITIVE itself — the four DOM members
// that mean "the page owns the pointer". The game reads pointer lock in
// thirteen places to decide what a click means; every one of them keeps working
// unchanged, because from the page's point of view the lock is held. That is
// deliberately more faithful than editing thirteen call sites would have been.
//
// This is installed ONLY when main.cjs plants --fw-qa, which it does only when
// FW_QA=1 is in the environment (tools/qa/run-electron.cjs). The shipped game
// never sees it. tests/qa-look-capture.test.js pins that inertness.
//
// ESCAPE HATCH: --fw-qa-pointerlock forces the real thing back, so the genuine
// lock path still has a driver that exercises it. That run DOES take the
// cursor, which is why it is opt-in and never the default.

const LAUNCH_ARGS = (() => {
  try {
    const a = globalThis.fairwayNative?.launchArgs;
    return Array.isArray(a) ? a : [];
  } catch { return []; }
})();

export const QA_VIRTUAL_LOOK = LAUNCH_ARGS.includes('--fw-qa')
  && !LAUNCH_ARGS.includes('--fw-qa-pointerlock');

let held = null; // the element that "holds" the virtual lock
let lastX = null;
let lastY = null;
let installed = false;

// Exported for the acceptance driver, which has to be able to ask whether the
// shim is live without inferring it from behaviour.
export function qaVirtualLockElement() { return held; }

export function installQaLookCapture(doc = globalThis.document, win = globalThis.window) {
  if (!QA_VIRTUAL_LOOK || installed || !doc || !win) return false;
  installed = true;

  const fire = () => doc.dispatchEvent(new Event('pointerlockchange', { bubbles: true }));

  Object.defineProperty(doc, 'pointerLockElement', {
    configurable: true,
    get: () => held,
  });

  doc.exitPointerLock = function exitPointerLock() {
    if (!held) return;
    held = null;
    lastX = null;
    lastY = null;
    fire();
  };

  const proto = win.Element?.prototype;
  if (proto) {
    proto.requestPointerLock = function requestPointerLock() {
      held = this;
      lastX = null;
      lastY = null;
      fire();
      return Promise.resolve();
    };
  }

  // A driver's mouse moves arrive as absolute positions. Under a real lock the
  // browser would report the per-event delta instead; with no lock it reports a
  // screen-space delta that is not guaranteed to survive the injection path. So
  // the delta is recomputed from the SAME event's own coordinates and shadowed
  // onto the instance before the game's listener runs. Capture phase on window
  // is the first thing to see any mouse event, and the game listens on document
  // in the bubble phase (courseScene.js), so this always lands first.
  //
  // This reproduces exactly what a real lock would have delivered: with no
  // physical device behind the pointer, the raw delta IS the position delta.
  win.addEventListener('mousemove', (e) => {
    if (!held) { lastX = null; lastY = null; return; }
    const x = e.clientX;
    const y = e.clientY;
    const dx = lastX === null ? 0 : x - lastX;
    const dy = lastY === null ? 0 : y - lastY;
    lastX = x;
    lastY = y;
    try {
      Object.defineProperty(e, 'movementX', { configurable: true, get: () => dx });
      Object.defineProperty(e, 'movementY', { configurable: true, get: () => dy });
    } catch { /* a browser that refuses leaves the native values in place */ }
  }, true);

  // With the cursor free, the operator can alt-tab away and keep working — which
  // is the whole point of the section. But courseScene's focus backstop releases
  // every held key whenever document.hasFocus() is false, so a driver holding W
  // would drop it the instant the operator clicked their own window. Injected
  // input does not need OS focus, so under the shim the page always reports
  // focused. Cost: the real focus-loss backstop is not exercised by QA runs; it
  // keeps its unit coverage in tests/walk-focus-backstop.
  doc.hasFocus = () => true;

  return true;
}
