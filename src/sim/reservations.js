// FAIRWAY STATE — tee-time reservations: an ADDITIVE booking calendar.
//
// Design constraint (from the brief, honored strictly): this module layers on
// top of golfer arrivals — it never touches rounds.js or golfers.js. A booking
// is its own record; the fee snapshots the green fee at booking time and is
// collected by hand at the shop counter check-in (addRevenue 'greenFees', the
// same books line walk-in fees use). Rounds keep simulating exactly as before —
// a reservation is a promise a golfer walks in with, not a rewrite of demand.

import { calendarOf } from './time.js';
import { addRevenue } from './economy.js';

export const TEE_SHEET = {
  openMin: 7 * 60,      // first tee time 7:00
  closeMin: 17 * 60,    // last slot starts 16:30
  stepMin: 30,
  horizonDays: 7,       // how far ahead the computer lets you book
  dueLeadMin: 45,       // a booking shows at the counter this early
};

export function slotTimes() {
  const times = [];
  for (let m = TEE_SHEET.openMin; m < TEE_SHEET.closeMin; m += TEE_SHEET.stepMin) times.push(m);
  return times;
}

export function initReservations(state) {
  state.reservations = { nextId: 1, booked: [] };
}

export function ensureReservations(state) {
  if (!state.reservations) initReservations(state);
}

const bookOf = (state) => {
  ensureReservations(state);
  return state.reservations;
};

export function reservationById(state, id) {
  return bookOf(state).booked.find((r) => r.id === id) || null;
}

// the calendar: one row per slot, with whoever holds it
export function daySheet(state, dayAbs) {
  const book = bookOf(state);
  return slotTimes().map((minute) => ({
    minute,
    res: book.booked.find((r) => r.dayAbs === dayAbs && r.minute === minute && r.status !== 'cancelled') || null,
  }));
}

export function bookSlot(state, dayAbs, minute, name) {
  const book = bookOf(state);
  const todayAbs = calendarOf(state.clock.minutes).dayAbs;
  if (!name || !String(name).trim()) return { ok: false, reason: 'A booking needs a name.' };
  if (dayAbs < todayAbs) return { ok: false, reason: 'That day is already gone.' };
  if (dayAbs > todayAbs + TEE_SHEET.horizonDays) return { ok: false, reason: `The sheet only opens ${TEE_SHEET.horizonDays} days out.` };
  if (!slotTimes().includes(minute)) return { ok: false, reason: 'Not a tee time on the sheet.' };
  const taken = book.booked.some((r) => r.dayAbs === dayAbs && r.minute === minute && r.status !== 'cancelled');
  if (taken) return { ok: false, reason: 'That tee time is taken.' };
  const res = {
    id: book.nextId++,
    dayAbs,
    minute,
    name: String(name).trim(),
    fee: state.club ? state.club.greenFee : 0,
    status: 'booked', // booked → played | noShow | cancelled
  };
  book.booked.push(res);
  return { ok: true, res };
}

export function cancelReservation(state, id) {
  const res = reservationById(state, id);
  if (!res || res.status !== 'booked') return { ok: false };
  res.status = 'cancelled';
  return { ok: true };
}

// today's bookings that should be standing at the counter: from a little before
// their time until the day ends (arrive early, pay early — no punishment)
export function dueForCheckIn(state) {
  const cal = calendarOf(state.clock.minutes);
  return bookOf(state).booked.filter((r) =>
    r.status === 'booked' &&
    r.dayAbs === cal.dayAbs &&
    cal.minuteOfDay >= r.minute - TEE_SHEET.dueLeadMin);
}

export function checkInReservation(state, id) {
  const res = reservationById(state, id);
  if (!res || res.status !== 'booked') return { ok: false, reason: 'No open booking under that name.' };
  res.status = 'played';
  addRevenue(state, 'greenFees', res.fee);
  return { ok: true, fee: res.fee };
}

// midnight housekeeping: bookings whose day has fully passed become no-shows,
// and ancient records fall off so saves stay lean
export function reservationsDailyTick(state, todayAbs) {
  const book = bookOf(state);
  for (const r of book.booked) {
    if (r.status === 'booked' && r.dayAbs < todayAbs) r.status = 'noShow';
  }
  book.booked = book.booked.filter((r) => r.dayAbs >= todayAbs - 14);
}

export function fmtSlot(minute) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}
