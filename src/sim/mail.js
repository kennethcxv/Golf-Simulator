// THE WORK LAPTOP'S MAILBOX (A2, Full_Goal_19) — a real inbox, not a card.
//
// Every message is the record of something the sim did: an email booking
// request arriving, a supplier confirming an order, a bad review landing as a
// complaint. Messages store a KIND plus data; the laptop renders the prose (in
// the laptop's own working English, like every other laptop page). Booking
// requests are resolved IN PLACE — the message keeps its `resolved` stamp and
// stays as history, because "she asked for Tuesday 8 AM and I declined" is
// exactly what an inbox is for. Requests themselves still live and expire in
// reservations' book.requests; the mail row carries the requestId and the
// laptop asks reservations whether it is still actionable.
//
// Deliberately mirrors notifications.js: capped, healed, deduped. The bell
// stays for real-time facts (a van at the door, a customer giving up); mail
// carries the CORRESPONDENCE — things a person would have written down. Each
// delivery ALSO files one bell line ("new mail") pointing at the Mail page:
// that line is how a player learns the laptop has an inbox at all (A4), and
// the content itself never rides the bell.

import { notify } from './notifications.js';
import { t } from '../core/i18n.js';

export const MAIL_CAP = 80;

export const MAIL_KINDS = Object.freeze({
  'booking-request': { icon: '⛳' },
  'supplier-order': { icon: '🚚' },
  complaint: { icon: '✉' },
  system: { icon: '✉' },
});

const markHealed = (store) => {
  // non-enumerable: the save never carries it, so a deserialized mailbox
  // heals exactly once on first read and row identity is stable afterwards
  Object.defineProperty(store, '__healed', { value: true, enumerable: false, configurable: true });
  return store;
};

export function initMail(state) {
  state.mail = markHealed({ messages: [], nextId: 1 });
  return state.mail;
}

export function ensureMail(state) {
  const m = state.mail;
  if (!m || typeof m !== 'object') return initMail(state);
  if (m.__healed) return m;
  m.messages = (Array.isArray(m.messages) ? m.messages : [])
    .filter((msg) => msg && typeof msg.kind === 'string' && Number.isFinite(Number(msg.id)))
    .slice(0, MAIL_CAP)
    .map((msg) => ({
      id: Number(msg.id),
      kind: MAIL_KINDS[msg.kind] ? msg.kind : 'system',
      from: typeof msg.from === 'string' ? msg.from : '',
      data: msg.data && typeof msg.data === 'object' ? msg.data : {},
      atAbs: Number.isFinite(Number(msg.atAbs)) ? Number(msg.atAbs) : 0,
      read: !!msg.read,
      resolved: typeof msg.resolved === 'string' ? msg.resolved : null,
      dedupeKey: typeof msg.dedupeKey === 'string' ? msg.dedupeKey : null,
    }));
  const derived = m.messages.reduce((a, msg) => Math.max(a, msg.id + 1), 1);
  m.nextId = Number.isFinite(Number(m.nextId)) ? Math.max(Number(m.nextId), derived) : derived;
  return markHealed(m);
}

export function deliverMail(state, { kind = 'system', from = '', data = {}, dedupeKey = null, atAbs = null }) {
  const m = ensureMail(state);
  if (dedupeKey && m.messages.some((msg) => msg.dedupeKey === dedupeKey)) return null;
  const message = {
    id: m.nextId++,
    kind: MAIL_KINDS[kind] ? kind : 'system',
    from: String(from),
    data,
    // Number(null) is 0 and finite — the guard must test the RAW value or
    // every default-stamped message reads "today 12:00 AM" (Verifier A).
    atAbs: Number.isFinite(atAbs) ? Number(atAbs) : Math.floor(state.clock?.minutes || 0),
    read: false,
    resolved: null,
    dedupeKey,
  };
  m.messages.unshift(message);
  if (m.messages.length > MAIL_CAP) m.messages.length = MAIL_CAP;
  notify(state, {
    kind: 'mail',
    text: t('mail.notif.arrived', { from: message.from || t('mail.notif.unknownSender') }),
    dedupeKey: `mail-arrived:${message.id}`,
  });
  return message;
}

export const unreadMailCount = (state) => ensureMail(state).messages.filter((msg) => !msg.read).length;

export function markMailRead(state, id) {
  const message = ensureMail(state).messages.find((msg) => msg.id === id);
  if (message) message.read = true;
  return !!message;
}

/** Stamp the mail row that carries a booking request, wherever it is. */
export function resolveMailForRequest(state, requestId, resolution) {
  const message = ensureMail(state).messages
    .find((msg) => msg.kind === 'booking-request' && msg.data?.requestId === requestId);
  if (!message) return false;
  message.resolved = String(resolution);
  message.read = true;
  return true;
}
