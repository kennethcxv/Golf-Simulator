// HELD-KEY TRACKING — the one place that decides which keys are "currently down".
//
// Two rules, both learned from a real drift bug:
//
//   1. Normalise case. KeyboardEvent.key carries the *shifted* spelling, so a player who lets go
//      of D while still holding Shift to run delivers keyup{key:'D'}. Matching that against a
//      lowercase 'd' fails, the key is stranded down forever, and the overview camera slides
//      right until the tab is closed. Keys are physical; their spelling is not.
//
//   2. A key held across a mode change belongs to the old mode. clear() drops everything, and the
//      auto-repeat keydowns that keep arriving while the key is still physically down are refused.
//      The player has to actually press it again — "fresh input", so a map opened mid-stride opens
//      still.

// single characters are case-folded; named keys ('ArrowLeft', 'Shift') are already canonical
const normalise = (key) => (typeof key === 'string' && key.length === 1 ? key.toLowerCase() : key);

export const OVERVIEW_KEYS = ['w', 'a', 's', 'd', 'q', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

//   3. A key typed into a form control is text, not camera input. The overview
//      keys are plain letters, so naming a course "Wasserman" in the editor's
//      Save dialog panned the map with every keystroke. Only key-DOWN is
//      filtered: if a field takes focus while a key is already held, the release
//      must still clear it, or rule 1's stranded-key bug comes back by another
//      route.
export function isTextEntryTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

//   4. A modifier can go down on the page and come up somewhere else. Tapping the Windows key
//      hands focus to the shell, so the keyup lands there and the page keeps 'meta' held for the
//      rest of the session. Clearing on focus loss is necessary but not sufficient — pointer lock
//      can drop without the window ever blurring, which is exactly how a real capture caught
//      walkHeld sitting on ["meta"] with a MetaLeft keydown and no matching keyup.
//
//      Every keyboard event carries the OS's own view of the modifiers, so the next keydown can
//      settle the disagreement: if the event says the modifier is up and we still think it is
//      down, ours is a phantom and gets dropped. This is also a live diagnostic — a modifier the
//      event still reports as DOWN is genuinely stuck below the browser, where no page code can
//      reach it, and the returned list distinguishes the two cases.
//
//      Lock-state modifiers (CapsLock, NumLock, ScrollLock) are deliberately absent:
//      getModifierState reports whether the lock is ON, not whether the key is held, so they
//      cannot be reconciled this way.
//
//   5. Reconciling on key-DOWN alone cannot recover from the case rule 4 was written for.
//      A stranded modifier turns ordinary letters into OS hotkeys, and the OS consumes them
//      before the page sees anything — so the very keydown the reconcile was waiting for is the
//      one that never arrives. The page can sit in the phantom state indefinitely while the
//      player presses D and nothing at all happens.
//
//      So reconcile from every event that carries getModifierState, not just keydown.
//      MouseEvent, PointerEvent and WheelEvent all implement it, and mousemove is the one the
//      player generates constantly without meaning to: looking around clears the phantom within
//      a frame or two of it appearing, with no key pressed at all.
//
//      What survives a reconcile is the *other* case, and it is worth telling apart. A modifier
//      the event still reports DOWN is genuinely held below the browser — no page code can
//      release it, so the only honest response is to show the player it is there.
export const HELD_MODIFIERS = Object.freeze(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta']);

// Which modifiers a held-set currently believes are down, in canonical spelling. Both spellings
// are probed for the same reason releaseKey below probes both.
export function heldModifierNames(held) {
  if (!held || typeof held.has !== 'function') return [];
  return HELD_MODIFIERS.filter((m) => held.has(m) || held.has(m.toLowerCase()));
}

//   6. THE PAGE'S BELIEF IS THE WRONG QUANTITY TO WATCH.
//
//      reconcileModifiers only ever DROPS: it iterates the modifiers the held-set already
//      contains, and skips any it does not. So a modifier the page never recorded a keydown for
//      is structurally invisible to it — and that is exactly the OS-level strand. When Windows
//      believes Win is down it consumes Win+X in the shell, the browser is handed no keydown at
//      all, walkHeld stays empty, and a readout built on "what does the walker believe is held"
//      reports nothing while every keypress is being eaten. Correctly, and uselessly.
//
//      Measured 2026-07-29: with the OS holding Meta and the page never having seen a keydown,
//      a plain mousemove reports getModifierState('Meta') === true. The OS's answer is available
//      on every event; it was simply never read except as a comparison against something the
//      page already believed.
//
//      No page code can RELEASE a modifier the OS is holding. What it can do is say so, which is
//      the difference between "D stopped working" and "Windows is holding the Windows key".
//      Returns null — not [] — when the event cannot answer, so a caller can tell "nothing is
//      down" apart from "this event carries no information".
export function observedModifiers(event) {
  if (!event || typeof event.getModifierState !== 'function') return null;
  const down = [];
  for (const modifier of HELD_MODIFIERS) {
    try {
      if (event.getModifierState(modifier)) down.push(modifier);
    } catch { /* an event that cannot answer for one modifier can still answer for others */ }
  }
  return down;
}

// Works against either a createHeldKeys instance or a plain Set — the walk controller uses a raw
// Set and full-lowercase spellings ('meta'), the overview camera uses this module's normalise
// ('Meta'), so both spellings are probed.
const releaseKey = (held, key) => {
  if (typeof held.up === 'function') held.up(key);
  else if (typeof held.delete === 'function') held.delete(key);
};

export function reconcileModifiers(held, event) {
  if (!held || typeof held.has !== 'function') return [];
  if (!event || typeof event.getModifierState !== 'function') return [];
  const dropped = [];
  for (const modifier of HELD_MODIFIERS) {
    const spellings = [modifier, modifier.toLowerCase()].filter((s) => held.has(s));
    if (!spellings.length) continue;
    let stillDown;
    try {
      stillDown = event.getModifierState(modifier);
    } catch {
      stillDown = true; // an event that cannot answer is not evidence of a phantom
    }
    if (stillDown !== false) continue;
    for (const spelling of spellings) releaseKey(held, spelling);
    dropped.push(modifier);
  }
  return dropped;
}

export function createHeldKeys(tracked) {
  const watch = new Set(tracked.map(normalise));
  const held = new Set();

  return {
    // `repeat` is the browser's auto-repeat flag. A repeat for a key we are not already holding
    // means the key survived a clear() — refuse it until the player releases and presses again.
    down(key, repeat = false) {
      const k = normalise(key);
      if (!watch.has(k)) return false;
      if (repeat && !held.has(k)) return false;
      held.add(k);
      return true;
    },
    up(key) {
      held.delete(normalise(key));
    },
    clear() {
      held.clear();
    },
    has(key) {
      return held.has(normalise(key));
    },
    get size() {
      return held.size;
    },
    snapshot() {
      return [...held];
    },
  };
}

// The overview camera's per-frame intent, as pure arithmetic: no keys down, no movement.
const PAN_SPEED = 0.7; // yd-ish per ms, matched to the previous feel
const ORBIT_SPEED = 0.0016;

export function overviewCameraDelta(held, dtMs) {
  const v = PAN_SPEED * dtMs;
  let panX = 0;
  let panY = 0;
  if (held.has('a') || held.has('ArrowLeft')) panX += v;
  if (held.has('d') || held.has('ArrowRight')) panX -= v;
  if (held.has('w') || held.has('ArrowUp')) panY += v;
  if (held.has('s') || held.has('ArrowDown')) panY -= v;
  const orbit = held.has('q') ? ORBIT_SPEED * dtMs : 0;
  return { panX, panY, orbit, moving: !!(panX || panY || orbit) };
}
