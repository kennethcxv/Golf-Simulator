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
