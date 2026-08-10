// THE POCKET PHONE'S OWN RECORD (A1, Full_Goal_19) — call history, missed
// calls, text messages, and the contact book derived from them.
//
// The phone is a CHANNEL SURFACE, not a booking system: every booking a call
// produces goes through reservations.bookSlot like every other channel, and
// what lives here is only what a phone remembers — who called, when, what came
// of it, and the short texts a call is too heavy for. Requests themselves stay
// in reservations' book.requests (pruned after a day); the call log is the
// durable trace, written once at each request's RESOLUTION (answered-booked,
// answered-declined, missed), which is why Contacts can show "everyone who has
// called, with their history" long after the request rows are gone.
//
// Texts store a KIND plus args rather than prose, so the UI renders them
// through t() in the player's locale and a save never bakes a language in.

export const CALL_LOG_CAP = 80;
export const TEXT_CAP = 60;

export const CALL_OUTCOMES = Object.freeze(['booked', 'declined', 'missed', 'booked-alt']);

const markHealed = (store) => {
  // non-enumerable so JSON.stringify (the save) never carries it; a
  // deserialized store lacks the flag and heals exactly once on first read
  Object.defineProperty(store, '__healed', { value: true, enumerable: false, configurable: true });
  return store;
};

export function initPhone(state) {
  state.phone = markHealed({ calls: [], texts: [], nextCallId: 1, nextTextId: 1 });
  return state.phone;
}

export function ensurePhone(state) {
  const p = state.phone;
  if (!p || typeof p !== 'object') return initPhone(state);
  // Heal ONCE per loaded store, each part independently — a corrupt texts
  // array must not cost the player their call history — and never rebuild
  // row objects on later reads: a UI (or a test) may hold a row reference
  // across a call that reads the store again.
  if (p.__healed) return p;
  p.calls = (Array.isArray(p.calls) ? p.calls : [])
    .filter((c) => c && typeof c.name === 'string' && Number.isFinite(Number(c.id)))
    .slice(0, CALL_LOG_CAP)
    .map((c) => ({
      id: Number(c.id),
      name: c.name,
      partySize: Number.isFinite(Number(c.partySize)) ? Number(c.partySize) : 1,
      dayAbs: Number.isFinite(Number(c.dayAbs)) ? Number(c.dayAbs) : 0,
      minute: Number.isFinite(Number(c.minute)) ? Number(c.minute) : 0,
      outcome: CALL_OUTCOMES.includes(c.outcome) ? c.outcome : 'missed',
      atAbs: Number.isFinite(Number(c.atAbs)) ? Number(c.atAbs) : 0,
      seen: !!c.seen,
    }));
  p.texts = (Array.isArray(p.texts) ? p.texts : [])
    .filter((m) => m && typeof m.kind === 'string' && Number.isFinite(Number(m.id)))
    .slice(0, TEXT_CAP)
    .map((m) => ({
      id: Number(m.id),
      from: typeof m.from === 'string' ? m.from : '',
      kind: m.kind,
      args: m.args && typeof m.args === 'object' ? m.args : {},
      atAbs: Number.isFinite(Number(m.atAbs)) ? Number(m.atAbs) : 0,
      read: !!m.read,
    }));
  const callId = p.calls.reduce((a, c) => Math.max(a, c.id + 1), 1);
  const textId = p.texts.reduce((a, m) => Math.max(a, m.id + 1), 1);
  p.nextCallId = Number.isFinite(Number(p.nextCallId)) ? Math.max(Number(p.nextCallId), callId) : callId;
  p.nextTextId = Number.isFinite(Number(p.nextTextId)) ? Math.max(Number(p.nextTextId), textId) : textId;
  return markHealed(p);
}

/** One line per resolved call. `outcome` is one of CALL_OUTCOMES. */
export function logCall(state, { name, partySize = 1, dayAbs = 0, minute = 0, outcome, atAbs = null }) {
  if (!name || !CALL_OUTCOMES.includes(outcome)) return null;
  const p = ensurePhone(state);
  const entry = {
    id: p.nextCallId++,
    name: String(name),
    partySize,
    dayAbs,
    minute,
    outcome,
    // Number(null) is 0, and 0 is finite — the first draft of this line
    // stamped every call "today 12:00 AM". Verifier A read it off the screen.
    atAbs: Number.isFinite(atAbs) ? Number(atAbs) : Math.floor(state.clock?.minutes || 0),
    // a missed call carries a badge until the player has LOOKED at the phone;
    // answered calls were seen by definition
    seen: outcome !== 'missed',
  };
  p.calls.unshift(entry);
  if (p.calls.length > CALL_LOG_CAP) p.calls.length = CALL_LOG_CAP;
  return entry;
}

export function sendText(state, { from, kind, args = {}, atAbs = null }) {
  if (!from || !kind) return null;
  const p = ensurePhone(state);
  const entry = {
    id: p.nextTextId++,
    from: String(from),
    kind: String(kind),
    args,
    atAbs: Number.isFinite(atAbs) ? Number(atAbs) : Math.floor(state.clock?.minutes || 0),
    read: false,
  };
  p.texts.unshift(entry);
  if (p.texts.length > TEXT_CAP) p.texts.length = TEXT_CAP;
  return entry;
}

export const missedCallCount = (state) => ensurePhone(state).calls
  .filter((c) => c.outcome === 'missed' && !c.seen).length;

export const unreadTextCount = (state) => ensurePhone(state).texts.filter((m) => !m.read).length;

/** The number the HUD badge shows while the phone is in the pocket. */
export const phoneBadgeCount = (state) => missedCallCount(state) + unreadTextCount(state);

export function markCallsSeen(state) {
  for (const c of ensurePhone(state).calls) c.seen = true;
}

export function markTextsRead(state) {
  for (const m of ensurePhone(state).texts) m.read = true;
}

/**
 * The contact book, derived: one row per caller, newest activity first. A
 * golfer becomes a contact by calling — exactly the brief's "everyone who has
 * called, with their history".
 */
export function contactsOf(state) {
  const byName = new Map();
  for (const c of ensurePhone(state).calls) {
    if (!byName.has(c.name)) {
      byName.set(c.name, { name: c.name, calls: [], lastAtAbs: c.atAbs, booked: 0, missed: 0 });
    }
    const contact = byName.get(c.name);
    contact.calls.push(c);
    contact.lastAtAbs = Math.max(contact.lastAtAbs, c.atAbs);
    if (c.outcome === 'booked' || c.outcome === 'booked-alt') contact.booked += 1;
    if (c.outcome === 'missed') contact.missed += 1;
  }
  return [...byName.values()].sort((a, b) => b.lastAtAbs - a.lastAtAbs);
}
