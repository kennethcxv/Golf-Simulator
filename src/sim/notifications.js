// FAIRWAY STATE — the club's notification feed.
//
// Every entry here is the record of something the sim actually did: a van that unloaded, a
// review that posted, rent that went unpaid. Nothing pushes a notification speculatively, and
// a dedupe key stops the same fact being filed twice — a page that re-renders sixty times a
// second must never be able to flood this list.
//
// The feed persists in the save (state.notifications) so an unread warning survives a reload.
// It is bounded: the newest NOTIF_CAP entries win, which also bounds the save file.

export const NOTIF_CAP = 60;

// kind → which laptop application owns the fact. The laptop uses this to navigate.
export const NOTIF_KINDS = {
  delivery: { icon: '🚚', page: 'deliveries' },
  stock: { icon: '📋', page: 'inventory' },
  review: { icon: '⭐', page: 'reviews' },
  money: { icon: '💰', page: 'finances' },
  course: { icon: '⛳', page: 'course' },
  event: { icon: '🏆', page: 'events' },
  staff: { icon: '👥', page: 'employees' },
  system: { icon: '⚙', page: 'home' },
  // A2/A4 (Goal 19): the bell is how a player LEARNS mail exists — one line
  // per message, pointing at the Mail page; the content itself lives there.
  mail: { icon: '✉', page: 'mail' },
};

export function initNotifications(state) {
  state.notifications = { items: [], nextId: 1 };
}

export function ensureNotifications(state) {
  const n = state.notifications;
  if (!n || !Array.isArray(n.items)) {
    initNotifications(state);
    return state.notifications;
  }
  // heal: drop malformed rows a hand-edited or damaged save might carry; a broken
  // nextId re-derives from the surviving rows rather than wiping the inbox
  n.items = n.items.filter((i) => i && typeof i.text === 'string' && Number.isFinite(Number(i.id)))
    .slice(0, NOTIF_CAP)
    .map((i) => ({
      id: Number(i.id),
      kind: NOTIF_KINDS[i.kind] ? i.kind : 'system',
      text: i.text,
      page: typeof i.page === 'string' ? i.page : null,
      minute: Number.isFinite(Number(i.minute)) ? Number(i.minute) : 0,
      read: !!i.read,
      dedupeKey: typeof i.dedupeKey === 'string' ? i.dedupeKey : null,
    }));
  const derived = n.items.reduce((a, i) => Math.max(a, i.id + 1), 1);
  n.nextId = Number.isFinite(Number(n.nextId)) ? Math.max(Number(n.nextId), derived) : derived;
  return n;
}

/**
 * File a notification. Returns the item, or null when the dedupe key says this fact is
 * already on file. `page` overrides the kind's default destination.
 */
export function notify(state, { kind = 'system', text, page = null, dedupeKey = null }) {
  if (!text) return null;
  const n = ensureNotifications(state);
  if (dedupeKey && n.items.some((i) => i.dedupeKey === dedupeKey)) return null;
  const item = {
    id: n.nextId++,
    kind: NOTIF_KINDS[kind] ? kind : 'system',
    text: String(text),
    page: page || (NOTIF_KINDS[kind] ? NOTIF_KINDS[kind].page : null),
    minute: state.clock ? Math.floor(state.clock.minutes) : 0,
    read: false,
    dedupeKey,
  };
  n.items.unshift(item);
  if (n.items.length > NOTIF_CAP) n.items.length = NOTIF_CAP;
  return item;
}

export const unreadCount = (state) => ensureNotifications(state).items.filter((i) => !i.read).length;

export function markRead(state, id) {
  const item = ensureNotifications(state).items.find((i) => i.id === id);
  if (item) item.read = true;
  return !!item;
}

export function markAllRead(state) {
  for (const i of ensureNotifications(state).items) i.read = true;
}

export function dismissNotification(state, id) {
  const n = ensureNotifications(state);
  const before = n.items.length;
  n.items = n.items.filter((i) => i.id !== id);
  return n.items.length !== before;
}
