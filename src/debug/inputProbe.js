// SIX-CASE INPUT PROBE — what the keydown listener actually receives, per case.
//
// Reported 2026-07-29: "The tell I cannot explain is that Shift CHANGES the outcome.
// Something differs between the modified and unmodified path and I want the measurement,
// not a hypothesis." The six cases named in the brief: D, Shift+D, W, Shift+W, X, Shift+X.
//
// WHY THIS LIVES IN src/ AND NOT IN THE PROBE FILE. The same measurement has to run in
// Chromium (via tools/qa/run-playwright.cjs) and in the packaged Electron shell (via a
// separate .mjs driver, because Playwright's browser API is not the Electron API). Two
// copies of an instrument are two instruments, and the whole point of the exercise is to
// compare browser against desktop — which is worthless if the numbers come from different
// code. So the measurement is one module and the drivers only supply the keystrokes.
//
// THE KEYSTROKES MUST COME FROM THE DRIVER. Nothing here dispatches a KeyboardEvent.
// Page-dispatched events are exactly what let two earlier D-key harnesses pass while D did
// not strafe under a real hand: a synthetic event has no OS keyboard behind it, no layout
// mapping, and cannot be eaten by a shell accelerator. The driver presses real keys
// through CDP; this module only watches.
//
// FOUR OBSERVATION POINTS, because the answer is *where* it stops:
//
//   1. window capture — the earliest a page can see the event. Missing here means the OS
//      or the shell consumed it and no page fix is possible.
//   2. window bubble, registered last — where courseScene's walkKeyDown and main.js's
//      global handler have both already run. `defaultPrevented` read here is the honest
//      answer to "was preventDefault called", and absence here with presence at (1) is an
//      interception inside the page.
//   3. walkHeld — whether the walk controller recorded the key, or a filter dropped it.
//   4. moveIntent — whether the per-frame movement block then acted on it. This is the
//      one point that cannot be observed from outside courseScene: position delta reads
//      identically for "the key never arrived" and "the key arrived and a wall was in the
//      way".
//
// For X there is no movement to intend, so the equivalent of (4) is whether
// walk.interactSecondary was called. It is wrapped, not replaced — the real function still
// runs, so the probe does not change what it is measuring.

const MODIFIER_NAMES = ['Shift', 'Control', 'Alt', 'AltGraph', 'Meta'];

const modifierStates = (event) => {
  if (typeof event.getModifierState !== 'function') return null;
  const down = [];
  for (const name of MODIFIER_NAMES) {
    try { if (event.getModifierState(name)) down.push(name); } catch { /* skip the one that throws */ }
  }
  return down;
};

const describe = (event, phase) => ({
  phase,
  type: event.type,
  key: event.key,
  code: event.code,
  keyCode: event.keyCode,
  repeat: !!event.repeat,
  // isTrusted separates a real keystroke from a page-dispatched one. A row with
  // isTrusted:false is not evidence about the delivery chain at all.
  isTrusted: !!event.isTrusted,
  // The flags AND the OS's own answer, which are not always the same object: the flags
  // are a snapshot on the event, getModifierState queries the platform's key state.
  flags: {
    shift: !!event.shiftKey, ctrl: !!event.ctrlKey, alt: !!event.altKey, meta: !!event.metaKey,
  },
  modifiersReported: modifierStates(event),
  defaultPrevented: !!event.defaultPrevented,
  target: event.target?.tagName
    ? `${event.target.tagName}${event.target.id ? `#${event.target.id}` : ''}`
    : String(event.target),
  activeElement: globalThis.document?.activeElement?.tagName || null,
  pointerLocked: !!globalThis.document?.pointerLockElement,
});

export function createInputProbe(app) {
  let rows = [];
  let armed = false;
  let secondaryCalls = 0;
  let secondaryOriginal = null;
  let posBefore = null;
  let heldDuringPress = null;

  const walkOf = () => app?.scene3d?.walk || null;
  const posOf = () => {
    const s = walkOf()?.state;
    return s && Number.isFinite(s.x) ? { x: s.x, z: s.z, yaw: s.yaw } : null;
  };

  const onCapture = (e) => rows.push(describe(e, 'window-capture'));
  const onBubble = (e) => rows.push(describe(e, 'window-bubble'));

  // Registered so that capture sees the event before anything in the page, and bubble
  // sees it after every other window listener. courseScene registers walkKeyDown on
  // window bubble when walk mode is entered; arming AFTER that puts this listener behind
  // it, which is what makes `defaultPrevented` meaningful.
  function arm() {
    if (armed) return { armed: true, alreadyArmed: true };
    for (const type of ['keydown', 'keyup']) {
      globalThis.addEventListener(type, onCapture, true);
      globalThis.addEventListener(type, onBubble, false);
    }
    // Wrap, do not replace: main.js calls walk.interactSecondary for X, and whether that
    // call happens is the X equivalent of "did the movement handler run".
    const walk = walkOf();
    if (walk && typeof walk.interactSecondary === 'function' && !secondaryOriginal) {
      secondaryOriginal = walk.interactSecondary;
      walk.interactSecondary = (...args) => {
        secondaryCalls += 1;
        return secondaryOriginal.apply(walk, args);
      };
    }
    armed = true;
    return { armed: true, secondaryWrapped: !!secondaryOriginal };
  }

  function beginCase() {
    rows = [];
    secondaryCalls = 0;
    heldDuringPress = null;
    posBefore = posOf();
    walkOf()?.moveIntent?.begin?.();
  }

  // WHAT THE WALKER IS HOLDING *WHILE THE KEY IS DOWN*. Reading the held set at the end of
  // a case answers a different question: keyup has already removed the key, so a correct
  // press reports an empty set and reads as "the walker never recorded it". The driver
  // calls this between its down and up.
  function sample() {
    const walk = walkOf();
    let held = null;
    try { held = walk?.heldKeys?.() || null; } catch { held = null; }
    heldDuringPress = held;
    return {
      heldKeys: held,
      heldModifiers: (() => { try { return walk?.heldModifiers?.() || []; } catch { return []; } })(),
      osModifiers: (() => { try { return walk?.osModifiers?.() || []; } catch { return []; } })(),
      pointerLocked: !!globalThis.document?.pointerLockElement,
    };
  }

  function endCase(label) {
    const walk = walkOf();
    walk?.moveIntent?.end?.();
    const posAfter = posOf();
    return {
      case: label,
      // Delivery: what arrived, where, and with which modifiers.
      events: rows.slice(),
      reachedCapture: rows.some((r) => r.phase === 'window-capture' && r.type === 'keydown'),
      reachedBubble: rows.some((r) => r.phase === 'window-bubble' && r.type === 'keydown'),
      // "Was preventDefault called" — read from the LAST listener in the chain, which is
      // the only place the answer is settled.
      preventDefaultCalled: rows
        .filter((r) => r.phase === 'window-bubble' && r.type === 'keydown')
        .some((r) => r.defaultPrevented),
      // Acceptance: did the walk controller record it. Sampled while the key was DOWN —
      // heldAfter is kept alongside because a non-empty set after the release is its own
      // finding (a strand), but it is not the answer to "was the key recorded".
      heldDuringPress: heldDuringPress ? [...heldDuringPress] : null,
      heldAfter: (() => { try { return walk?.heldKeys?.() || null; } catch { return null; } })(),
      // Action: did the movement block act on it, and did interactSecondary fire.
      moveIntent: walk?.moveIntent?.read?.() || null,
      interactSecondaryCalls: secondaryCalls,
      // A blocked strafe still shows movement intent; this separates the two.
      movedYd: posBefore && posAfter
        ? +Math.hypot(posAfter.x - posBefore.x, posAfter.z - posBefore.z).toFixed(4)
        : null,
      pointerLocked: !!globalThis.document?.pointerLockElement,
      walkActive: !!walk?.isActive?.(),
      // What the walker believes and what the OS says, at the end of the case.
      heldModifiers: (() => { try { return walk?.heldModifiers?.() || []; } catch { return []; } })(),
      osModifiers: (() => { try { return walk?.osModifiers?.() || []; } catch { return []; } })(),
    };
  }

  function disarm() {
    if (!armed) return;
    for (const type of ['keydown', 'keyup']) {
      globalThis.removeEventListener(type, onCapture, true);
      globalThis.removeEventListener(type, onBubble, false);
    }
    const walk = walkOf();
    if (walk && secondaryOriginal) {
      walk.interactSecondary = secondaryOriginal;
      secondaryOriginal = null;
    }
    armed = false;
  }

  return { arm, beginCase, sample, endCase, disarm, isArmed: () => armed };
}

// The six cases the brief names, in order, as data the drivers share. `hold` is the
// modifier to hold down first; `code` is the physical key, so the press is layout-honest
// (pressing by `key` would ask the driver to find a character, which is a different act).
export const SIX_KEY_CASES = Object.freeze([
  Object.freeze({ label: 'D alone', code: 'KeyD', hold: null }),
  Object.freeze({ label: 'Shift+D', code: 'KeyD', hold: 'Shift' }),
  Object.freeze({ label: 'W alone', code: 'KeyW', hold: null }),
  Object.freeze({ label: 'Shift+W', code: 'KeyW', hold: 'Shift' }),
  Object.freeze({ label: 'X alone', code: 'KeyX', hold: null }),
  Object.freeze({ label: 'Shift+X', code: 'KeyX', hold: 'Shift' }),
]);
