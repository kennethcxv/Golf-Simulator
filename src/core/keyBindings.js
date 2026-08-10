// FULL KEY REBINDING (N2/F2) — one binding table, one read path.
//
// Every rebindable verb in the game is listed here once, with the key it
// ships on. The persisted document lives in preferences (controls.bindings);
// this module owns what counts as a valid table: every action bound, one
// action per key, unknown keys healed back to defaults. Consumers never read
// event.key against a letter again — they ask actionForKey/keyForAction, so
// a rebind changes every surface at once (main.js dispatch, walk movement,
// the dirt-sense hold, prompts).
//
// Deliberately NOT in the table: mode-scoped keys (the builder's own R/B/I,
// the register's Escape, arrow-key camera nudges) and the browser-reserved
// chords OVERNIGHT_REPORT_2 documents. Tap-vs-hold semantics belong to the
// ACTION, not the key — rebinding the tool belt or the dirt sense moves the
// key and keeps the tap/hold behaviour.

export const BINDABLE_ACTIONS = Object.freeze([
  Object.freeze({ id: 'moveForward', label: 'Move forward', group: 'Movement', defaultKey: 'w' }),
  Object.freeze({ id: 'moveBack', label: 'Move back', group: 'Movement', defaultKey: 's' }),
  Object.freeze({ id: 'moveLeft', label: 'Move left', group: 'Movement', defaultKey: 'a' }),
  Object.freeze({ id: 'moveRight', label: 'Move right', group: 'Movement', defaultKey: 'd' }),
  Object.freeze({ id: 'run', label: 'Run (hold)', group: 'Movement', defaultKey: 'shift', hold: true }),
  Object.freeze({ id: 'interact', label: 'Interact (tap, or hold where shown)', group: 'Actions', defaultKey: 'e', hold: true }),
  Object.freeze({ id: 'carry', label: 'Carry / pick up', group: 'Actions', defaultKey: 'x' }),
  Object.freeze({ id: 'setDown', label: 'Set down', group: 'Actions', defaultKey: 'z' }),
  Object.freeze({ id: 'toolBelt', label: 'Tools (tap next, hold wheel)', group: 'Actions', defaultKey: 'f', hold: true }),
  Object.freeze({ id: 'dirtSense', label: 'Dirt sense (hold)', group: 'Actions', defaultKey: 'q', hold: true }),
  // A1 (Goal 19): the pocket phone. T was free across the whole table — no
  // collision to resolve — and it is the key the brief suggested.
  Object.freeze({ id: 'phone', label: 'Phone', group: 'Interface', defaultKey: 't' }),
  Object.freeze({ id: 'overview', label: 'Overview map', group: 'Interface', defaultKey: 'tab' }),
  Object.freeze({ id: 'courseEditor', label: 'Course editor', group: 'Interface', defaultKey: 'j' }),
  Object.freeze({ id: 'pause', label: 'Pause', group: 'Interface', defaultKey: 'p' }),
  Object.freeze({ id: 'cartLights', label: 'Cart lights', group: 'Driving', defaultKey: 'l' }),
  Object.freeze({ id: 'cartCamera', label: 'Cart camera', group: 'Driving', defaultKey: 'v' }),
  Object.freeze({ id: 'mowerBlades', label: 'Mower blades', group: 'Driving', defaultKey: 'r' }),
  // ITEM 23 (2026-08-06): "full key rebinding, IN ONE PIECE."
  //
  // Rebinding already existed and was good — a row per verb, conflict
  // detection, reset to defaults — but eight player-facing verbs never reached
  // it. They were handled as literal `case 'b': case 'B':` in main.js's key
  // switch, several of them written out twice (once inside the clubhouse, once
  // outside), so a player who rebound everything the panel offered still could
  // not move build mode off B or the speed keys off 1/2/3. Half a rebinding
  // screen is arguably worse than none: it tells you the keys are yours.
  Object.freeze({ id: 'buildMode', label: 'Build / rearrange mode', group: 'Interface', defaultKey: 'b' }),
  Object.freeze({ id: 'maintenancePanel', label: 'Maintenance panel', group: 'Interface', defaultKey: 'i' }),
  Object.freeze({ id: 'groundsPanel', label: 'Grounds panel', group: 'Interface', defaultKey: 'g' }),
  Object.freeze({ id: 'clubPanel', label: 'Club panel', group: 'Interface', defaultKey: 'c' }),
  Object.freeze({ id: 'empirePanel', label: 'Empire panel', group: 'Interface', defaultKey: 'm' }),
  // A3: the three speed rows are gone with the ladder — Space is the one
  // time control (pause/resume) and it is deliberately not rebindable.
]);

export const DEFAULT_BINDINGS = Object.freeze(Object.fromEntries(
  BINDABLE_ACTIONS.map((action) => [action.id, action.defaultKey]),
));

const ACTION_BY_ID = new Map(BINDABLE_ACTIONS.map((action) => [action.id, action]));

// Canonical key names: single characters lowercased, named keys lowercased,
// space spelled out. Modifier LOCATION is ignored (both Shifts run).
export function canonicalKeyName(keyOrEvent) {
  const raw = typeof keyOrEvent === 'string' ? keyOrEvent : keyOrEvent?.key;
  if (typeof raw !== 'string' || !raw) return null;
  if (raw === ' ') return 'space';
  return raw.toLowerCase();
}

// Keys that can never be bound: the pause-menu escape hatch must always
// exist, and browser/OS chords cannot be honoured anyway.
const RESERVED_KEYS = new Set(['escape', 'meta', 'control', 'alt', 'f11', 'f12']);

export function isBindableKey(key) {
  const canonical = canonicalKeyName(key);
  return !!canonical && !RESERVED_KEYS.has(canonical) && canonical.length <= 12;
}

/**
 * Heal any raw table into a complete, conflict-free one. Unknown actions are
 * dropped, invalid or reserved keys revert to that action's default, and when
 * two actions claim one key the FIRST in BINDABLE_ACTIONS order keeps it and
 * later ones revert - deterministic, so a bad save heals the same way twice.
 */
export function normalizeBindings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const taken = new Map(); // key -> actionId
  for (const action of BINDABLE_ACTIONS) {
    // E5 — AN EXPLICIT EMPTY STRING MEANS UNBOUND, AND SURVIVES.
    //
    // Rebinding a key that another action already owns now takes it from that
    // action and leaves it with no key, so the player is told exactly what
    // changed instead of having two bindings move on one keystroke. That only
    // works if an unbind can be WRITTEN: this loop used to restore the default
    // for any falsy key, which put the displaced action straight back onto the
    // key it had just lost. A MISSING field still falls back to the default —
    // only a deliberate '' is honoured — so a save from an older build, or one
    // with a corrupt field, still boots fully bound.
    if (Object.hasOwn(source, action.id) && source[action.id] === '') {
      out[action.id] = '';
      continue;
    }
    let key = canonicalKeyName(source[action.id]);
    if (!key || !isBindableKey(key)) key = action.defaultKey;
    if (taken.has(key) && taken.get(key) !== action.id) key = action.defaultKey;
    // the default may ITSELF now collide with an earlier custom claim; the
    // earlier action wins and this one keeps its default anyway - the UI
    // surfaces the conflict rather than silently unbinding anything
    out[action.id] = key;
    if (!taken.has(key)) taken.set(key, action.id);
  }
  return out;
}

/** Every key claimed by two or more actions, for the settings UI to flag. */
export function bindingConflicts(bindings) {
  const byKey = new Map();
  for (const action of BINDABLE_ACTIONS) {
    const key = bindings?.[action.id];
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(action.id);
  }
  return [...byKey.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([key, actions]) => ({ key, actions }));
}

export function keyForAction(bindings, actionId) {
  return bindings?.[actionId] || DEFAULT_BINDINGS[actionId] || null;
}

export function actionForKey(bindings, keyOrEvent) {
  const key = canonicalKeyName(keyOrEvent);
  if (!key) return null;
  for (const action of BINDABLE_ACTIONS) {
    if (keyForAction(bindings, action.id) === key) return action.id;
  }
  return null;
}

export function actionLabel(actionId) {
  return ACTION_BY_ID.get(actionId)?.label || actionId;
}

/** How a key reads on a keycap in the UI and in prompts. */
export function describeKey(key) {
  const canonical = canonicalKeyName(key);
  if (!canonical) return '?';
  const names = {
    space: 'Space',
    shift: 'Shift',
    tab: 'Tab',
    enter: 'Enter',
    backspace: 'Backspace',
    arrowup: 'Up',
    arrowdown: 'Down',
    arrowleft: 'Left',
    arrowright: 'Right',
    capslock: 'Caps',
  };
  if (names[canonical]) return names[canonical];
  return canonical.length === 1 ? canonical.toUpperCase() : canonical;
}
