// FAIRWAY STATE - golf operations.
//
// This module owns tee-time schedule and front-desk operations state. It does
// not own customer walking AI, merchandise checkout, the laptop shell, or the
// save transport. Those systems consume the stable queries/events exported
// here and keep their existing responsibilities.

import { makeRng } from '../core/utils.js';
import { calendarOf } from './time.js';
import { addExpense, addRevenue } from './economy.js';

export const TEE_SHEET = Object.freeze({
  openMin: 7 * 60,
  closeMin: 17 * 60,
  stepMin: 30,
  horizonDays: 7,
  dueLeadMin: 30,
  gracePeriodMin: 10,
  maxPartySize: 4,
  slotCapacity: 4,
  minWalkInLeadMin: 0,
});

export const DEFAULT_OPERATIONS_POLICY = Object.freeze({
  advanceCancellationHours: 24,
  advanceCancellationFee: 0,
  sameDayCancellationFee: 12,
  retainDepositOnSameDay: true,
  noShowFee: 15,
  reopenNoShowSlot: true,
  allowLateMove: true,
  allowPairings: true,
  lateFee: 0,
  autoDepartMinutesAfterCheckIn: 2,
  supportsMemberAccounts: false,
});

const OPERATIONS_VERSION = 2;
const EVENT_LIMIT = 400;
const FINANCE_LIMIT = 800;
const EPSILON = 0.005;

const r2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const absoluteMinute = (dayAbs, minute) => dayAbs * 1440 + minute;
const dateKey = (dayAbs) => {
  const cal = calendarOf(dayAbs * 1440);
  return `Y${cal.year}-${cal.seasonName}-D${cal.dayOfSeason}`;
};
const slotIdOf = (dayAbs, minute) => `tee:${dayAbs}:${minute}`;
const nowOf = (state) => Math.floor(state.clock?.minutes || 0);
const activeBook = (reservation) => reservation.status !== 'cancelled';
const checkedIn = (reservation) => reservation.checkIn?.status === 'checked-in';

function defaultConfig() {
  return { ...TEE_SHEET };
}

function defaultPolicy() {
  return { ...DEFAULT_OPERATIONS_POLICY };
}

function configOf(state) {
  ensureReservations(state);
  return state.reservations.config;
}

function bookOf(state) {
  ensureReservations(state);
  return state.reservations;
}

function nextStableId(book, key, prefix) {
  const value = Number.isInteger(book[key]) ? book[key] : 1;
  book[key] = value + 1;
  return `${prefix}-${value}`;
}

function memberStatusFor(state, name) {
  const golfer = state.golfers?.pool?.find((entry) => entry.name === name);
  return golfer?.memberTier ? 'member' : 'guest';
}

function normalizeNames(state, holder, names, partySize) {
  const out = [];
  const add = (value) => {
    const name = String(value || '').trim();
    if (name && !out.includes(name)) out.push(name);
  };
  add(holder);
  for (const name of names || []) add(name);

  const pool = state.golfers?.pool || [];
  for (const golfer of pool) {
    if (out.length >= partySize) break;
    add(golfer.name);
  }
  while (out.length < partySize) add(`Guest ${out.length + 1} of ${holder}`);
  return out.slice(0, partySize);
}

function makeParty(state, book, holder, names, partySize, explicitStatus) {
  const customerNames = normalizeNames(state, holder, names, partySize);
  return {
    id: nextStableId(book, 'nextPartyId', 'party'),
    holder,
    size: customerNames.length,
    members: customerNames.map((name, index) => ({
      id: `${book.nextPartyId - 1}:member:${index + 1}`,
      name,
      memberStatus: explicitStatus || memberStatusFor(state, name),
      checkedIn: false,
    })),
  };
}

function membershipOf(party) {
  const statuses = new Set(party.members.map((member) => member.memberStatus));
  return statuses.size > 1 ? 'mixed' : (statuses.values().next().value || 'guest');
}

function paymentShape(total, options = {}) {
  const memberPass = options.paymentPlan === 'member-pass';
  return {
    status: memberPass || total <= EPSILON ? (memberPass ? 'member-pass' : 'paid') : 'unpaid',
    total: memberPass ? 0 : r2(total),
    amountPaid: 0,
    depositPaid: 0,
    amountDue: memberPass ? 0 : r2(total),
    method: memberPass ? 'member-pass' : null,
    cardOnFile: !!options.cardOnFile,
    payments: [],
    receipts: [],
    pending: null,
  };
}

function refreshPayment(reservation) {
  const payment = reservation.payment;
  payment.total = r2(payment.total);
  payment.amountPaid = r2(payment.amountPaid);
  payment.depositPaid = r2(payment.depositPaid);
  payment.amountDue = r2(Math.max(0, payment.total - payment.amountPaid));
  if (payment.status === 'member-pass') return payment;
  if (payment.amountDue <= EPSILON) payment.status = 'paid';
  else if (payment.amountPaid > EPSILON) payment.status = 'deposit';
  else payment.status = 'unpaid';
  return payment;
}

function migrateReservation(state, book, reservation, index) {
  if (reservation.id == null) reservation.id = index + 1;
  reservation.name = String(reservation.name || reservation.reservationHolder || `Reservation ${reservation.id}`).trim();
  reservation.reservationHolder ||= reservation.name;
  reservation.dayAbs = Math.floor(Number(reservation.dayAbs || 0));
  reservation.minute = Math.floor(Number(reservation.minute || TEE_SHEET.openMin));
  reservation.date ||= { dayAbs: reservation.dayAbs, key: dateKey(reservation.dayAbs) };
  reservation.slotId ||= slotIdOf(reservation.dayAbs, reservation.minute);
  reservation.fee = r2(reservation.fee ?? state.club?.greenFee ?? 0);
  reservation.feePerPlayer = r2(reservation.feePerPlayer ?? reservation.fee);
  reservation.walkIn = !!reservation.walkIn;
  reservation.notes = Array.isArray(reservation.notes) ? reservation.notes : [];

  if (!reservation.party) {
    const names = reservation.customerNames || [reservation.name];
    const size = Math.max(1, Number(reservation.partySize || names.length || 1));
    reservation.party = makeParty(
      state,
      book,
      reservation.reservationHolder,
      names,
      size,
      reservation.membershipStatus,
    );
  }
  reservation.partySize = reservation.party.size;
  reservation.customerNames = reservation.party.members.map((member) => member.name);
  reservation.membershipStatus ||= membershipOf(reservation.party);

  if (!reservation.payment) {
    const paid = reservation.status === 'played';
    reservation.payment = paymentShape(reservation.feePerPlayer * reservation.partySize);
    if (paid) {
      reservation.payment.amountPaid = reservation.payment.total;
      reservation.payment.amountDue = 0;
      reservation.payment.status = 'paid';
      reservation.payment.method = 'legacy';
    }
  }
  refreshPayment(reservation);

  const slotAbs = absoluteMinute(reservation.dayAbs, reservation.minute);
  if (!reservation.arrival) {
    reservation.arrival = {
      status: reservation.status === 'played' ? 'arrived'
        : reservation.status === 'noShow' ? 'no-show'
          : reservation.status === 'cancelled' ? 'cancelled' : 'scheduled',
      plannedMinute: slotAbs - TEE_SHEET.dueLeadMin,
      arrivedAtMinute: reservation.status === 'played' ? slotAbs : null,
      lateMarkedAtMinute: null,
      intendedOutcome: reservation.status === 'noShow' ? 'no-show' : 'arrive',
      spawnedAtMinute: null,
    };
  }
  reservation.checkIn ||= {
    status: reservation.status === 'played' ? 'checked-in' : 'unconfirmed',
    confirmedAtMinute: reservation.status === 'played' ? slotAbs : null,
    checkedInAtMinute: reservation.status === 'played' ? slotAbs : null,
  };
  reservation.noShow ||= {
    markedAtMinute: reservation.status === 'noShow' ? slotAbs + TEE_SHEET.gracePeriodMin : null,
    feeApplied: 0,
    ledgerEntryIds: [],
  };
  reservation.cancellation ||= {
    cancelledAtMinute: reservation.status === 'cancelled' ? slotAbs : null,
    reason: reservation.status === 'cancelled' ? 'Legacy cancellation' : null,
    kind: reservation.status === 'cancelled' ? 'legacy' : null,
    fee: 0,
    refund: 0,
    ledgerEntryIds: [],
  };
  reservation.courseAccess ||= {
    status: reservation.status === 'played' ? 'departed' : 'none',
    assignedCourse: state.clubName || 'Main course',
    startingHole: 1,
    grantedAtMinute: reservation.status === 'played' ? slotAbs : null,
    departurePlannedAtMinute: null,
    departedAtMinute: reservation.status === 'played' ? slotAbs : null,
  };
  reservation.actualStartMinute ??= reservation.status === 'played' ? slotAbs : null;
  reservation.createdAtMinute ??= nowOf(state);
  reservation.source ||= reservation.walkIn ? 'walk-in' : 'player';
  return reservation;
}

export function initReservations(state, options = {}) {
  state.reservations = {
    version: OPERATIONS_VERSION,
    nextId: 1,
    nextPartyId: 1,
    nextEventSeq: 1,
    nextFinanceSeq: 1,
    nextPaymentSeq: 1,
    nextReceiptSeq: 1,
    config: { ...defaultConfig(), ...(options.config || {}) },
    policy: { ...defaultPolicy(), ...(options.policy || {}) },
    booked: [],
    schedule: {},
    courseClosures: {},
    events: [],
    eventKeys: [],
    financeEntries: [],
    processedTransactionIds: [],
    lastProcessedMinute: nowOf(state),
    generator: { lastSeed: null, generatedDays: [] },
  };
  return state.reservations;
}

export function ensureReservations(state) {
  if (!state.reservations) return initReservations(state);
  const book = state.reservations;
  book.version = OPERATIONS_VERSION;
  book.nextId = Number.isInteger(book.nextId) ? book.nextId : 1;
  book.nextPartyId = Number.isInteger(book.nextPartyId) ? book.nextPartyId : 1;
  book.nextEventSeq = Number.isInteger(book.nextEventSeq) ? book.nextEventSeq : 1;
  book.nextFinanceSeq = Number.isInteger(book.nextFinanceSeq) ? book.nextFinanceSeq : 1;
  book.nextPaymentSeq = Number.isInteger(book.nextPaymentSeq) ? book.nextPaymentSeq : 1;
  book.nextReceiptSeq = Number.isInteger(book.nextReceiptSeq) ? book.nextReceiptSeq : 1;
  book.config = { ...defaultConfig(), ...(book.config || {}) };
  book.policy = { ...defaultPolicy(), ...(book.policy || {}) };
  book.booked = Array.isArray(book.booked) ? book.booked : [];
  book.schedule ||= {};
  book.courseClosures ||= {};
  book.events = Array.isArray(book.events) ? book.events : [];
  book.eventKeys = Array.isArray(book.eventKeys) ? book.eventKeys : [];
  book.financeEntries = Array.isArray(book.financeEntries) ? book.financeEntries : [];
  book.processedTransactionIds = Array.isArray(book.processedTransactionIds) ? book.processedTransactionIds : [];
  book.generator ||= { lastSeed: null, generatedDays: [] };
  book.lastProcessedMinute ??= nowOf(state);

  for (let i = 0; i < book.booked.length; i++) migrateReservation(state, book, book.booked[i], i);
  const numericIds = book.booked.map((reservation) => Number(reservation.id)).filter(Number.isFinite);
  if (numericIds.length) book.nextId = Math.max(book.nextId, ...numericIds.map((id) => id + 1));

  for (const reservation of book.booked) {
    const day = ensureScheduleDayInternal(state, reservation.dayAbs);
    const slot = day.slots.find((entry) => entry.minute === reservation.minute);
    if (slot && !slot.reservationIds.includes(reservation.id)) slot.reservationIds.push(reservation.id);
    if (slot && reservation.walkIn && !slot.walkInAssignmentIds.includes(reservation.id)) {
      slot.walkInAssignmentIds.push(reservation.id);
    }
  }
  return book;
}

function normalizedConfigPatch(patch) {
  const out = { ...patch };
  if (patch.openingTime != null) out.openMin = patch.openingTime;
  if (patch.openingMinute != null) out.openMin = patch.openingMinute;
  if (patch.closingTime != null) out.closeMin = patch.closingTime;
  if (patch.closingMinute != null) out.closeMin = patch.closingMinute;
  if (patch.slotInterval != null) out.stepMin = patch.slotInterval;
  if (patch.slotIntervalMinutes != null) out.stepMin = patch.slotIntervalMinutes;
  if (patch.bookingWindow != null) out.horizonDays = patch.bookingWindow;
  if (patch.bookingWindowDays != null) out.horizonDays = patch.bookingWindowDays;
  if (patch.gracePeriod != null) out.gracePeriodMin = patch.gracePeriod;
  if (patch.gracePeriodMinutes != null) out.gracePeriodMin = patch.gracePeriodMinutes;
  if (patch.maximumPartySize != null) out.maxPartySize = patch.maximumPartySize;
  delete out.openingTime;
  delete out.openingMinute;
  delete out.closingTime;
  delete out.closingMinute;
  delete out.slotInterval;
  delete out.slotIntervalMinutes;
  delete out.bookingWindow;
  delete out.bookingWindowDays;
  delete out.gracePeriod;
  delete out.gracePeriodMinutes;
  delete out.maximumPartySize;
  return out;
}

export function configureTeeSheet(state, patch = {}) {
  const book = bookOf(state);
  const next = { ...book.config, ...normalizedConfigPatch(patch) };
  const integerKeys = [
    'openMin', 'closeMin', 'stepMin', 'horizonDays', 'dueLeadMin',
    'gracePeriodMin', 'maxPartySize', 'slotCapacity', 'minWalkInLeadMin',
  ];
  for (const key of integerKeys) {
    if (!Number.isInteger(next[key])) return { ok: false, reason: `${key} must be a whole number.` };
  }
  if (next.openMin < 0 || next.closeMin > 1440 || next.openMin >= next.closeMin) {
    return { ok: false, reason: 'Opening time must be before closing time on the same day.' };
  }
  if (next.stepMin < 5 || next.stepMin > 180) return { ok: false, reason: 'Slot interval must be 5-180 minutes.' };
  if (next.maxPartySize < 1 || next.slotCapacity < 1 || next.maxPartySize > next.slotCapacity) {
    return { ok: false, reason: 'Maximum party size must fit the slot capacity.' };
  }
  if (next.horizonDays < 1 || next.horizonDays > 365) return { ok: false, reason: 'Booking window must be 1-365 days.' };
  if (next.gracePeriodMin < 0 || next.gracePeriodMin > 180) return { ok: false, reason: 'Grace period must be 0-180 minutes.' };
  const nextTimes = new Set(slotTimes(next));
  const active = book.booked.filter((reservation) => countsForCapacity(state, reservation));
  for (const reservation of active) {
    if (!nextTimes.has(reservation.minute)) {
      return { ok: false, reason: `${fmtSlot(reservation.minute)} still has a booking and would fall outside the new schedule.` };
    }
  }
  const seatsBySlot = new Map();
  for (const reservation of active) {
    const key = `${reservation.dayAbs}:${reservation.minute}`;
    seatsBySlot.set(key, (seatsBySlot.get(key) || 0) + reservation.partySize);
    if (seatsBySlot.get(key) > next.slotCapacity) {
      return { ok: false, reason: 'The new capacity is smaller than an existing booked slot.' };
    }
  }
  book.config = next;
  const affected = Object.keys(book.schedule);
  book.schedule = {};
  for (const day of affected) ensureScheduleDayInternal(state, Number(day));
  for (const reservation of book.booked) {
    const slot = slotByMinute(state, reservation.dayAbs, reservation.minute);
    if (slot && !slot.reservationIds.includes(reservation.id)) slot.reservationIds.push(reservation.id);
  }
  return { ok: true, config: { ...next } };
}

export function configureOperationsPolicy(state, patch = {}) {
  const book = bookOf(state);
  const next = { ...book.policy, ...patch };
  for (const key of ['advanceCancellationHours', 'advanceCancellationFee', 'sameDayCancellationFee', 'noShowFee', 'lateFee', 'autoDepartMinutesAfterCheckIn']) {
    if (!Number.isFinite(next[key]) || next[key] < 0) return { ok: false, reason: `${key} must be zero or greater.` };
  }
  book.policy = next;
  return { ok: true, policy: { ...next } };
}

export function operationsPolicySummary(state) {
  const policy = bookOf(state).policy;
  return [
    `Cancel at least ${policy.advanceCancellationHours} hours ahead: ${policy.advanceCancellationFee ? `$${policy.advanceCancellationFee} fee` : 'no fee'}.`,
    `Same-day cancellation: $${policy.sameDayCancellationFee} fee${policy.retainDepositOnSameDay ? '; deposit may be retained' : ''}.`,
    `No-show after the grace period: up to $${policy.noShowFee}, only from paid funds or an authorized card.`,
    `Late parties ${policy.allowLateMove ? 'may move to an open slot' : 'keep their original slot only'}.`,
  ];
}

export function slotTimes(source = null) {
  const config = source?.reservations ? configOf(source) : { ...defaultConfig(), ...(source || {}) };
  const times = [];
  for (let minute = config.openMin; minute < config.closeMin; minute += config.stepMin) times.push(minute);
  return times;
}

function ensureScheduleDayInternal(state, dayAbs) {
  const book = state.reservations;
  const key = String(dayAbs);
  const closure = book.courseClosures[key];
  if (!book.schedule[key]) {
    book.schedule[key] = {
      dayAbs,
      dateKey: dateKey(dayAbs),
      closed: !!closure,
      closureReason: closure?.reason || null,
      slots: slotTimes(book.config).map((minute) => ({
        id: slotIdOf(dayAbs, minute),
        dayAbs,
        dateKey: dateKey(dayAbs),
        minute,
        capacity: book.config.slotCapacity,
        reservationIds: [],
        walkInAssignmentIds: [],
        actualStartMinute: null,
        assignedCourse: state.clubName || 'Main course',
        startingHole: 1,
        closed: !!closure,
        closureReason: closure?.reason || null,
      })),
    };
  }
  return book.schedule[key];
}

export function ensureScheduleDay(state, dayAbs) {
  bookOf(state);
  return ensureScheduleDayInternal(state, Math.floor(dayAbs));
}

export function setCourseClosure(state, dayAbs, closed = true, reason = 'Course closed') {
  const book = bookOf(state);
  const key = String(Math.floor(dayAbs));
  if (closed) book.courseClosures[key] = { dayAbs: Math.floor(dayAbs), reason: String(reason || 'Course closed') };
  else delete book.courseClosures[key];
  const day = ensureScheduleDayInternal(state, Math.floor(dayAbs));
  day.closed = !!closed;
  day.closureReason = closed ? String(reason || 'Course closed') : null;
  for (const slot of day.slots) {
    slot.closed = !!closed;
    slot.closureReason = day.closureReason;
  }
  return { ok: true, day };
}

export function reservationById(state, id) {
  return bookOf(state).booked.find((reservation) => String(reservation.id) === String(id)) || null;
}

export function slotByMinute(state, dayAbs, minute) {
  return ensureScheduleDay(state, dayAbs).slots.find((slot) => slot.minute === minute) || null;
}

export function slotForReservation(state, reservationOrId) {
  const reservation = typeof reservationOrId === 'object'
    ? reservationOrId
    : reservationById(state, reservationOrId);
  return reservation ? slotByMinute(state, reservation.dayAbs, reservation.minute) : null;
}

function countsForCapacity(state, reservation) {
  if (reservation.status === 'cancelled') return false;
  if (reservation.status === 'noShow' && bookOf(state).policy.reopenNoShowSlot) return false;
  return true;
}

function reservationsForSlot(state, slot) {
  return slot.reservationIds.map((id) => reservationById(state, id)).filter(Boolean);
}

function reservedSeats(state, slot, exceptId = null) {
  return reservationsForSlot(state, slot)
    .filter((reservation) => String(reservation.id) !== String(exceptId) && countsForCapacity(state, reservation))
    .reduce((sum, reservation) => sum + reservation.partySize, 0);
}

export function daySheet(state, dayAbs) {
  const day = ensureScheduleDay(state, dayAbs);
  return day.slots.map((slot) => {
    const all = reservationsForSlot(state, slot);
    const visible = all.filter(activeBook);
    const capacityUsed = reservedSeats(state, slot);
    const openReservations = visible.filter((reservation) => countsForCapacity(state, reservation));
    return {
      ...slot,
      reservations: visible,
      history: all,
      res: openReservations[0] || visible[0] || null,
      reservedSeats: capacityUsed,
      availableSeats: Math.max(0, slot.capacity - capacityUsed),
      available: !day.closed && !slot.closed && capacityUsed < slot.capacity,
    };
  });
}

export function availableSlots(state, dayAbs, options = {}) {
  const partySize = Math.max(1, Number(options.partySize || 1));
  const minMinute = options.fromMinute ?? (dayAbs === calendarOf(nowOf(state)).dayAbs
    ? calendarOf(nowOf(state)).minuteOfDay + (options.walkIn ? configOf(state).minWalkInLeadMin : 0)
    : -Infinity);
  return daySheet(state, dayAbs).filter((slot) => (
    slot.available && slot.availableSeats >= partySize && slot.minute >= minMinute
  ));
}

function validateBooking(state, dayAbs, minute, partySize, options = {}, exceptId = null) {
  const config = configOf(state);
  const todayAbs = calendarOf(nowOf(state)).dayAbs;
  if (dayAbs < todayAbs) return { ok: false, reason: 'That day is already gone.' };
  if (dayAbs > todayAbs + config.horizonDays) {
    return { ok: false, reason: `The sheet only opens ${config.horizonDays} days out.` };
  }
  if (!slotTimes(config).includes(minute)) return { ok: false, reason: 'Not a tee time on the sheet.' };
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > config.maxPartySize) {
    return { ok: false, reason: `Party size must be 1-${config.maxPartySize}.` };
  }
  const slot = slotByMinute(state, dayAbs, minute);
  if (!slot || slot.closed || ensureScheduleDay(state, dayAbs).closed) {
    return { ok: false, reason: slot?.closureReason || 'The course is closed.' };
  }
  if (options.walkIn && dayAbs === todayAbs) {
    const nowMinute = calendarOf(nowOf(state)).minuteOfDay;
    if (minute < nowMinute + config.minWalkInLeadMin) {
      return { ok: false, reason: `Walk-ins need ${config.minWalkInLeadMin} minutes of lead time.` };
    }
  }
  const used = reservedSeats(state, slot, exceptId);
  if (used + partySize > slot.capacity) {
    return { ok: false, reason: `Only ${Math.max(0, slot.capacity - used)} place${slot.capacity - used === 1 ? '' : 's'} remain.` };
  }
  if (!bookOf(state).policy.allowPairings && used > 0 && String(exceptId || '') === '') {
    return { ok: false, reason: 'This policy does not pair separate parties in one slot.' };
  }
  return { ok: true, slot };
}

function bookingOptions(nameOrOptions, maybeOptions) {
  if (nameOrOptions && typeof nameOrOptions === 'object') return { ...nameOrOptions };
  return { ...(maybeOptions || {}), holder: nameOrOptions };
}

function emitOperationEvent(state, reservation, type, atMinute, details = {}, uniqueSuffix = '') {
  const book = bookOf(state);
  const key = `${reservation.id}:${type}:${uniqueSuffix || 'once'}`;
  if (book.eventKeys.includes(key)) return book.events.find((event) => event.key === key) || null;
  const event = {
    id: `golf-event-${book.nextEventSeq++}`,
    key,
    sequence: book.nextEventSeq - 1,
    type,
    reservationId: reservation.id,
    partyId: reservation.party.id,
    holder: reservation.reservationHolder,
    dayAbs: reservation.dayAbs,
    minute: reservation.minute,
    atMinute: Math.floor(atMinute),
    details,
  };
  book.eventKeys.push(key);
  book.events.push(event);
  if (book.events.length > EVENT_LIMIT) book.events.splice(0, book.events.length - EVENT_LIMIT);
  if (book.eventKeys.length > EVENT_LIMIT * 2) {
    const liveKeys = new Set(book.events.map((entry) => entry.key));
    book.eventKeys = book.eventKeys.filter((entry) => liveKeys.has(entry));
  }
  return event;
}

function mainLedgerCash(state, category, cashDelta) {
  if (Math.abs(cashDelta) <= EPSILON) return;
  if (!state.ledger) {
    state.cash = r2((state.cash || 0) + cashDelta);
    return;
  }
  if (cashDelta > 0) addRevenue(state, category, cashDelta);
  else addExpense(state, 'bookingRefunds', Math.abs(cashDelta));
}

function postFinanceEntry(state, reservation, input) {
  const book = bookOf(state);
  const stableId = input.id;
  const existing = book.financeEntries.find((entry) => entry.id === stableId);
  if (existing) return { ok: true, entry: existing, idempotent: true };
  const entry = {
    id: stableId,
    sequence: book.nextFinanceSeq++,
    reservationId: reservation.id,
    partyId: reservation.party.id,
    dayAbs: calendarOf(input.atMinute).dayAbs,
    atMinute: Math.floor(input.atMinute),
    category: input.category,
    kind: input.kind,
    amount: r2(input.amount),
    cashDelta: r2(input.cashDelta),
    method: input.method || null,
    transactionId: input.transactionId || null,
    receiptId: input.receiptId || null,
    relatedEntryId: input.relatedEntryId || null,
    note: input.note || '',
  };
  book.financeEntries.push(entry);
  if (book.financeEntries.length > FINANCE_LIMIT) book.financeEntries.splice(0, book.financeEntries.length - FINANCE_LIMIT);
  if (entry.transactionId && !book.processedTransactionIds.includes(entry.transactionId)) {
    book.processedTransactionIds.push(entry.transactionId);
  }
  mainLedgerCash(state, entry.cashDelta >= 0 ? entry.category : 'bookingRefunds', entry.cashDelta);
  return { ok: true, entry, idempotent: false };
}

export function bookSlot(state, dayAbs, minute, nameOrOptions, maybeOptions = {}) {
  const options = bookingOptions(nameOrOptions, maybeOptions);
  const holder = String(options.holder || options.name || '').trim();
  if (!holder) return { ok: false, reason: 'A booking needs a reservation holder.' };
  const partySize = Math.floor(Number(options.partySize || options.customerNames?.length || 1));
  const validation = validateBooking(state, Math.floor(dayAbs), Math.floor(minute), partySize, options);
  if (!validation.ok) return validation;

  const book = bookOf(state);
  const party = makeParty(
    state,
    book,
    holder,
    options.customerNames,
    partySize,
    options.membershipStatus,
  );
  const feePerPlayer = r2(options.feePerPlayer ?? state.club?.greenFee ?? 0);
  const total = options.totalAmount != null ? r2(options.totalAmount) : r2(feePerPlayer * party.size);
  const slotAbs = absoluteMinute(dayAbs, minute);
  const arrivalOffset = Number.isFinite(options.arrivalOffsetMin)
    ? Math.floor(options.arrivalOffsetMin)
    : -15;
  const reservation = {
    id: book.nextId++,
    dayAbs: Math.floor(dayAbs),
    date: { dayAbs: Math.floor(dayAbs), key: dateKey(Math.floor(dayAbs)) },
    minute: Math.floor(minute),
    slotId: validation.slot.id,
    name: holder,
    reservationHolder: holder,
    party,
    customerNames: party.members.map((member) => member.name),
    partySize: party.size,
    membershipStatus: membershipOf(party),
    fee: total,
    feePerPlayer,
    status: 'booked',
    walkIn: !!options.walkIn,
    source: options.source || (options.walkIn ? 'walk-in' : 'player'),
    notes: Array.isArray(options.notes) ? [...options.notes] : (options.notes ? [String(options.notes)] : []),
    payment: paymentShape(total, options),
    arrival: {
      status: options.arrived ? (arrivalOffset > 0 ? 'late' : 'arrived') : 'scheduled',
      plannedMinute: slotAbs + arrivalOffset,
      arrivedAtMinute: options.arrived ? nowOf(state) : null,
      lateMarkedAtMinute: options.arrived && arrivalOffset > 0 ? nowOf(state) : null,
      intendedOutcome: options.intendedOutcome || 'arrive',
      spawnedAtMinute: null,
    },
    checkIn: {
      status: 'unconfirmed',
      confirmedAtMinute: null,
      checkedInAtMinute: null,
    },
    noShow: { markedAtMinute: null, feeApplied: 0, ledgerEntryIds: [] },
    cancellation: {
      cancelledAtMinute: null,
      plannedAtMinute: options.plannedCancellationMinute ?? null,
      reason: null,
      kind: null,
      fee: 0,
      refund: 0,
      ledgerEntryIds: [],
    },
    courseAccess: {
      status: 'none',
      assignedCourse: options.assignedCourse || state.clubName || 'Main course',
      startingHole: Number(options.startingHole || 1),
      grantedAtMinute: null,
      departurePlannedAtMinute: null,
      departedAtMinute: null,
    },
    actualStartMinute: null,
    createdAtMinute: nowOf(state),
  };
  book.booked.push(reservation);
  validation.slot.reservationIds.push(reservation.id);
  if (reservation.walkIn) validation.slot.walkInAssignmentIds.push(reservation.id);
  emitOperationEvent(state, reservation, 'reservation-created', nowOf(state), {
    partySize: reservation.partySize,
    walkIn: reservation.walkIn,
  });

  if (options.paymentPlan === 'prepaid' && total > EPSILON) {
    const begin = beginReservationPayment(state, reservation.id, options.paymentMethod || 'card', {
      kind: 'prepaid',
      cardOnFile: !!options.cardOnFile,
    });
    if (begin.ok) completeReservationPayment(state, reservation.id, {
      transactionId: begin.transactionId,
      tendered: total,
      cardApproved: true,
    });
  } else if (Number(options.depositAmount) > EPSILON) {
    const deposit = Math.min(total, r2(options.depositAmount));
    const begin = beginReservationPayment(state, reservation.id, options.paymentMethod || 'card', {
      kind: 'deposit',
      amount: deposit,
      cardOnFile: !!options.cardOnFile,
    });
    if (begin.ok) completeReservationPayment(state, reservation.id, {
      transactionId: begin.transactionId,
      tendered: deposit,
      cardApproved: true,
    });
  }

  return { ok: true, res: reservation, reservation, slot: validation.slot };
}

export function beginReservationPayment(state, id, method, options = {}) {
  const reservation = reservationById(state, id);
  if (!reservation) return { ok: false, reason: 'Payment needs a valid booking.' };
  if (!['booked', 'played'].includes(reservation.status)) return { ok: false, reason: 'That booking cannot accept payment.' };
  if (!['cash', 'card', 'member-account'].includes(method)) return { ok: false, reason: 'Choose cash or card.' };
  if (method === 'member-account' && !bookOf(state).policy.supportsMemberAccounts) {
    return { ok: false, reason: 'Member accounts are not enabled at this club.' };
  }
  refreshPayment(reservation);
  if (reservation.payment.amountDue <= EPSILON) return { ok: false, reason: 'Nothing is due.' };
  if (reservation.payment.pending?.status === 'pending') {
    return {
      ok: true,
      idempotent: true,
      transactionId: reservation.payment.pending.transactionId,
      amount: reservation.payment.pending.amount,
      method: reservation.payment.pending.method,
    };
  }
  const amount = r2(Math.min(reservation.payment.amountDue, options.amount ?? reservation.payment.amountDue));
  if (amount <= EPSILON) return { ok: false, reason: 'Payment amount must be positive.' };
  const book = bookOf(state);
  const transactionId = options.transactionId || `golf-pay-${book.nextPaymentSeq++}`;
  const existing = book.financeEntries.find((entry) => entry.transactionId === transactionId);
  if (existing) return { ok: true, idempotent: true, transactionId, amount: existing.amount, method: existing.method };
  reservation.payment.pending = {
    transactionId,
    method,
    kind: options.kind || (reservation.payment.amountPaid > EPSILON ? 'balance' : 'full'),
    amount,
    startedAtMinute: nowOf(state),
    status: 'pending',
  };
  if (options.cardOnFile) reservation.payment.cardOnFile = true;
  emitOperationEvent(state, reservation, 'payment-started', nowOf(state), { method, amount }, transactionId);
  return { ok: true, transactionId, amount, method };
}

export function cancelReservationPayment(state, id, transactionId = null) {
  const reservation = reservationById(state, id);
  const pending = reservation?.payment?.pending;
  if (!reservation || !pending) return { ok: false, reason: 'No payment is in progress.' };
  if (transactionId && pending.transactionId !== transactionId) return { ok: false, reason: 'That payment is not active.' };
  pending.status = 'cancelled';
  reservation.payment.pending = null;
  emitOperationEvent(state, reservation, 'payment-cancelled', nowOf(state), {}, pending.transactionId);
  return { ok: true };
}

function categoryForPayment(reservation, kind) {
  if (kind === 'deposit') return 'bookingDeposits';
  if (kind === 'prepaid') return reservation.walkIn ? 'walkInRevenue' : 'bookingRevenue';
  if (kind === 'no-show-fee') return 'noShowFees';
  if (kind === 'cancellation-fee') return 'cancellationFees';
  return reservation.walkIn ? 'walkInRevenue' : 'bookingBalances';
}

export function completeReservationPayment(state, id, options = {}) {
  const reservation = reservationById(state, id);
  if (!reservation) return { ok: false, reason: 'Payment needs a valid booking.' };
  const transactionId = options.transactionId || reservation.payment.pending?.transactionId;
  if (!transactionId) return { ok: false, reason: 'Start the payment first.' };
  const existing = bookOf(state).financeEntries.find((entry) => entry.transactionId === transactionId);
  if (existing) {
    return {
      ok: true,
      idempotent: true,
      transactionId,
      receiptId: existing.receiptId,
      amount: existing.amount,
      change: existing.note.startsWith('change:') ? Number(existing.note.slice(7)) : 0,
    };
  }
  const pending = reservation.payment.pending;
  if (!pending || pending.transactionId !== transactionId || pending.status !== 'pending') {
    return { ok: false, reason: 'That payment is not active.' };
  }
  if (pending.method === 'card' && options.cardApproved === false) {
    pending.status = 'declined';
    emitOperationEvent(state, reservation, 'payment-declined', nowOf(state), { method: 'card' }, transactionId);
    return { ok: false, declined: true, reason: 'Card declined. Try another card or cash.' };
  }
  const tendered = pending.method === 'cash' ? r2(options.tendered ?? 0) : pending.amount;
  if (pending.method === 'cash' && tendered + EPSILON < pending.amount) {
    return { ok: false, reason: `Cash tender is $${r2(pending.amount - tendered).toFixed(2)} short.` };
  }
  const change = pending.method === 'cash' ? r2(tendered - pending.amount) : 0;
  const book = bookOf(state);
  const receiptId = `GOLF-${reservation.dayAbs}-${reservation.id}-${book.nextReceiptSeq++}`;
  const category = categoryForPayment(reservation, pending.kind);
  const posted = postFinanceEntry(state, reservation, {
    id: `golf-finance:${transactionId}`,
    atMinute: nowOf(state),
    category,
    kind: pending.kind,
    amount: pending.amount,
    cashDelta: pending.amount,
    method: pending.method,
    transactionId,
    receiptId,
    note: `change:${change}`,
  });
  reservation.payment.amountPaid = r2(reservation.payment.amountPaid + pending.amount);
  if (pending.kind === 'deposit') reservation.payment.depositPaid = r2(reservation.payment.depositPaid + pending.amount);
  reservation.payment.method = pending.method;
  reservation.payment.payments.push(posted.entry.id);
  reservation.payment.receipts.push({
    id: receiptId,
    transactionId,
    amount: pending.amount,
    method: pending.method,
    change,
    issuedAtMinute: nowOf(state),
  });
  reservation.payment.pending = null;
  refreshPayment(reservation);
  emitOperationEvent(state, reservation, 'payment-completed', nowOf(state), {
    method: pending.method,
    amount: pending.amount,
    receiptId,
  }, transactionId);
  return { ok: true, transactionId, receiptId, amount: pending.amount, change, payment: reservation.payment };
}

export function retryReservationCard(state, id, transactionId = null) {
  const reservation = reservationById(state, id);
  const pending = reservation?.payment?.pending;
  if (!pending || pending.method !== 'card' || pending.status !== 'declined') {
    return { ok: false, reason: 'No declined card is waiting.' };
  }
  if (transactionId && transactionId !== pending.transactionId) return { ok: false, reason: 'That card attempt is not active.' };
  pending.status = 'pending';
  return { ok: true, transactionId: pending.transactionId };
}

export function markReservationArrived(state, id, atMinute = nowOf(state)) {
  const reservation = reservationById(state, id);
  if (!reservation || reservation.status !== 'booked') return { ok: false, reason: 'No active booking under that name.' };
  if (['arrived', 'late'].includes(reservation.arrival.status)) return { ok: true, idempotent: true, reservation };
  const slotAbs = absoluteMinute(reservation.dayAbs, reservation.minute);
  const late = atMinute > slotAbs;
  reservation.arrival.status = late ? 'late' : 'arrived';
  reservation.arrival.arrivedAtMinute = Math.floor(atMinute);
  if (late) reservation.arrival.lateMarkedAtMinute = Math.floor(atMinute);
  emitOperationEvent(state, reservation, 'party-arrived', atMinute, { late });
  if (late) emitOperationEvent(state, reservation, 'party-late', atMinute, { minutesLate: Math.floor(atMinute - slotAbs) });
  return { ok: true, reservation, late };
}

export function markReservationLate(state, id, atMinute = nowOf(state)) {
  const reservation = reservationById(state, id);
  if (!reservation || reservation.status !== 'booked') return { ok: false, reason: 'No active booking under that name.' };
  if (reservation.arrival.lateMarkedAtMinute != null) return { ok: true, idempotent: true, reservation };
  // "Late" and "present" are separate facts. An absent party can be flagged
  // late without entering the front-desk queue; only markReservationArrived
  // turns it into a person the player can serve.
  if (reservation.arrival.arrivedAtMinute != null) reservation.arrival.status = 'late';
  reservation.arrival.lateMarkedAtMinute = Math.floor(atMinute);
  emitOperationEvent(state, reservation, 'party-late', atMinute, {
    minutesLate: Math.max(0, Math.floor(atMinute - absoluteMinute(reservation.dayAbs, reservation.minute))),
  });
  return { ok: true, reservation };
}

export function confirmReservation(state, id, atMinute = nowOf(state)) {
  const reservation = reservationById(state, id);
  if (!reservation || reservation.status !== 'booked') return { ok: false, reason: 'No active reservation to confirm.' };
  if (!['arrived', 'late'].includes(reservation.arrival.status)) return { ok: false, reason: 'The party has not arrived.' };
  if (reservation.checkIn.status === 'confirmed') return { ok: true, idempotent: true, reservation };
  reservation.checkIn.status = 'confirmed';
  reservation.checkIn.confirmedAtMinute = Math.floor(atMinute);
  emitOperationEvent(state, reservation, 'reservation-confirmed', atMinute);
  return { ok: true, reservation };
}

export function addGuestToReservation(state, id, name, options = {}) {
  const reservation = reservationById(state, id);
  if (!reservation || reservation.status !== 'booked' || checkedIn(reservation)) {
    return { ok: false, reason: 'Guests can only be added before check-in.' };
  }
  const guestName = String(name || '').trim();
  if (!guestName) return { ok: false, reason: 'Enter the guest name.' };
  if (reservation.customerNames.includes(guestName)) return { ok: false, reason: 'That guest is already in the party.' };
  const validation = validateBooking(
    state,
    reservation.dayAbs,
    reservation.minute,
    reservation.partySize + 1,
    { walkIn: reservation.walkIn },
    reservation.id,
  );
  if (!validation.ok) return validation;
  reservation.party.members.push({
    id: `${reservation.party.id}:member:${reservation.party.members.length + 1}`,
    name: guestName,
    memberStatus: options.membershipStatus || memberStatusFor(state, guestName),
    checkedIn: false,
  });
  reservation.party.size++;
  reservation.partySize = reservation.party.size;
  reservation.customerNames = reservation.party.members.map((member) => member.name);
  reservation.membershipStatus = membershipOf(reservation.party);
  const addedAmount = r2(options.amount ?? reservation.feePerPlayer);
  reservation.payment.total = r2(reservation.payment.total + addedAmount);
  reservation.fee = reservation.payment.total;
  refreshPayment(reservation);
  emitOperationEvent(state, reservation, 'guest-added', nowOf(state), { name: guestName, amountDueAdded: addedAmount }, guestName);
  return { ok: true, reservation, amountDueAdded: addedAmount };
}

export function moveReservation(state, id, dayAbs, minute, options = {}) {
  const reservation = reservationById(state, id);
  if (!reservation || reservation.status !== 'booked' || checkedIn(reservation)) {
    return { ok: false, reason: 'Only an open booking can move.' };
  }
  if (reservation.arrival.status === 'late' && !bookOf(state).policy.allowLateMove) {
    return { ok: false, reason: 'Club policy does not move late parties.' };
  }
  const validation = validateBooking(state, Math.floor(dayAbs), Math.floor(minute), reservation.partySize, options, reservation.id);
  if (!validation.ok) return validation;
  const oldSlot = slotForReservation(state, reservation);
  const from = { dayAbs: reservation.dayAbs, minute: reservation.minute, slotId: reservation.slotId };
  reservation.dayAbs = Math.floor(dayAbs);
  reservation.date = { dayAbs: reservation.dayAbs, key: dateKey(reservation.dayAbs) };
  reservation.minute = Math.floor(minute);
  reservation.slotId = validation.slot.id;
  const offset = reservation.arrival.plannedMinute - absoluteMinute(from.dayAbs, from.minute);
  reservation.arrival.plannedMinute = absoluteMinute(reservation.dayAbs, reservation.minute) + offset;
  if (oldSlot) oldSlot.reservationIds = oldSlot.reservationIds.filter((entry) => String(entry) !== String(reservation.id));
  if (!validation.slot.reservationIds.includes(reservation.id)) validation.slot.reservationIds.push(reservation.id);
  emitOperationEvent(state, reservation, 'reservation-moved', nowOf(state), { from, to: { dayAbs: reservation.dayAbs, minute: reservation.minute } }, `${from.dayAbs}:${from.minute}`);
  return { ok: true, reservation, from, slot: validation.slot };
}

function cancellationTerms(state, reservation, atMinute) {
  const policy = bookOf(state).policy;
  const hoursAhead = (absoluteMinute(reservation.dayAbs, reservation.minute) - atMinute) / 60;
  const advance = hoursAhead >= policy.advanceCancellationHours;
  const baseFee = advance ? policy.advanceCancellationFee : policy.sameDayCancellationFee;
  const depositRetention = !advance && policy.retainDepositOnSameDay ? reservation.payment.depositPaid : 0;
  const fee = r2(Math.min(reservation.payment.amountPaid, Math.max(baseFee, depositRetention)));
  return { advance, hoursAhead, fee, refund: r2(Math.max(0, reservation.payment.amountPaid - fee)) };
}

export function cancelReservation(state, id, options = {}) {
  const reservation = reservationById(state, id);
  if (!reservation || reservation.status !== 'booked' || checkedIn(reservation)) {
    return { ok: false, reason: 'Only an open booking can be cancelled.' };
  }
  const atMinute = Math.floor(options.atMinute ?? nowOf(state));
  const terms = cancellationTerms(state, reservation, atMinute);
  const entryIds = [];
  if (terms.fee > EPSILON) {
    const feeEntry = postFinanceEntry(state, reservation, {
      id: `golf-finance:${reservation.id}:cancellation-fee`,
      atMinute,
      category: 'cancellationFees',
      kind: 'cancellation-fee-retained',
      amount: terms.fee,
      cashDelta: 0,
      method: reservation.payment.method,
      note: 'Retained from paid funds; no new charge.',
    });
    entryIds.push(feeEntry.entry.id);
  }
  if (terms.refund > EPSILON) {
    const refundEntry = postFinanceEntry(state, reservation, {
      id: `golf-finance:${reservation.id}:cancellation-refund`,
      atMinute,
      category: 'bookingRefunds',
      kind: 'refund',
      amount: terms.refund,
      cashDelta: -terms.refund,
      method: reservation.payment.method,
      note: terms.advance ? 'Advance cancellation refund.' : 'Same-day refund after policy fee.',
    });
    entryIds.push(refundEntry.entry.id);
  }
  reservation.status = 'cancelled';
  reservation.arrival.status = 'cancelled';
  reservation.payment.pending = null;
  reservation.cancellation = {
    cancelledAtMinute: atMinute,
    plannedAtMinute: reservation.cancellation?.plannedAtMinute ?? null,
    reason: String(options.reason || 'Cancelled at the front desk'),
    kind: terms.advance ? 'advance' : 'same-day',
    fee: terms.fee,
    refund: terms.refund,
    ledgerEntryIds: entryIds,
  };
  emitOperationEvent(state, reservation, 'reservation-cancelled', atMinute, {
    kind: reservation.cancellation.kind,
    fee: terms.fee,
    refund: terms.refund,
  });
  return { ok: true, reservation, ...terms };
}

function applyNoShowFee(state, reservation, atMinute, options = {}) {
  const policy = bookOf(state).policy;
  const target = r2(Math.max(0, options.fee ?? policy.noShowFee));
  if (target <= EPSILON) return { feeApplied: 0, entryIds: [] };
  const entryIds = [];
  const retained = r2(Math.min(target, reservation.payment.amountPaid));
  if (retained > EPSILON) {
    const retainedEntry = postFinanceEntry(state, reservation, {
      id: `golf-finance:${reservation.id}:no-show-retained`,
      atMinute,
      category: 'noShowFees',
      kind: 'no-show-fee-retained',
      amount: retained,
      cashDelta: 0,
      method: reservation.payment.method,
      note: 'Retained from paid funds; no new charge.',
    });
    entryIds.push(retainedEntry.entry.id);
  }
  const authorized = !!options.authorized || !!reservation.payment.cardOnFile;
  const additional = authorized ? r2(target - retained) : 0;
  if (additional > EPSILON) {
    const chargedEntry = postFinanceEntry(state, reservation, {
      id: `golf-finance:${reservation.id}:no-show-charge`,
      atMinute,
      category: 'noShowFees',
      kind: 'no-show-fee-charge',
      amount: additional,
      cashDelta: additional,
      method: 'card',
      transactionId: `golf-no-show-${reservation.id}`,
      receiptId: `GOLF-NOSHOW-${reservation.dayAbs}-${reservation.id}`,
      note: 'Authorized no-show charge.',
    });
    entryIds.push(chargedEntry.entry.id);
  }
  return { feeApplied: r2(retained + additional), entryIds };
}

export function handleNoShow(state, id, options = {}) {
  const reservation = reservationById(state, id);
  if (!reservation) return { ok: false, reason: 'No booking found.' };
  if (reservation.status === 'noShow') return { ok: true, idempotent: true, reservation, feeApplied: reservation.noShow.feeApplied };
  if (reservation.status !== 'booked' || checkedIn(reservation)) return { ok: false, reason: 'That booking cannot become a no-show.' };
  const atMinute = Math.floor(options.atMinute ?? nowOf(state));
  const graceEnd = absoluteMinute(reservation.dayAbs, reservation.minute) + configOf(state).gracePeriodMin;
  if (!options.force && atMinute < graceEnd) return { ok: false, reason: 'The grace period is still open.' };
  const fee = applyNoShowFee(state, reservation, atMinute, options);
  reservation.status = 'noShow';
  reservation.arrival.status = 'no-show';
  reservation.payment.pending = null;
  reservation.noShow = { markedAtMinute: atMinute, feeApplied: fee.feeApplied, ledgerEntryIds: fee.entryIds };
  emitOperationEvent(state, reservation, 'party-no-show', atMinute, {
    feeApplied: fee.feeApplied,
    slotReopened: bookOf(state).policy.reopenNoShowSlot,
  });
  return { ok: true, reservation, feeApplied: fee.feeApplied };
}

export function dueForCheckIn(state) {
  const cal = calendarOf(nowOf(state));
  return bookOf(state).booked
    .filter((reservation) => (
      reservation.status === 'booked'
      && reservation.dayAbs === cal.dayAbs
      && ['arrived', 'late'].includes(reservation.arrival.status)
      && reservation.checkIn.status !== 'checked-in'
    ))
    .sort((a, b) => (a.arrival.arrivedAtMinute - b.arrival.arrivedAtMinute) || (a.minute - b.minute));
}

export function checkInReservation(state, id, options = {}) {
  const reservation = reservationById(state, id);
  if (!reservation || reservation.status !== 'booked') return { ok: false, reason: 'No open booking under that name.' };
  if (!['arrived', 'late'].includes(reservation.arrival.status)) return { ok: false, reason: 'The party has not arrived.' };
  if (reservation.checkIn.status !== 'confirmed') return { ok: false, reason: 'Confirm the reservation first.' };
  refreshPayment(reservation);
  if (reservation.payment.amountDue > EPSILON) {
    return { ok: false, reason: `$${reservation.payment.amountDue.toFixed(2)} is still due.`, amountDue: reservation.payment.amountDue };
  }
  const atMinute = Math.floor(options.atMinute ?? nowOf(state));
  reservation.status = 'played';
  reservation.checkIn.status = 'checked-in';
  reservation.checkIn.checkedInAtMinute = atMinute;
  for (const member of reservation.party.members) member.checkedIn = true;
  reservation.courseAccess.status = 'granted';
  reservation.courseAccess.grantedAtMinute = atMinute;
  reservation.courseAccess.departurePlannedAtMinute = atMinute + bookOf(state).policy.autoDepartMinutesAfterCheckIn;
  emitOperationEvent(state, reservation, 'party-checked-in', atMinute, { partySize: reservation.partySize });
  emitOperationEvent(state, reservation, 'party-ready-for-course', atMinute, {
    assignedCourse: reservation.courseAccess.assignedCourse,
    startingHole: reservation.courseAccess.startingHole,
  });
  return {
    ok: true,
    reservation,
    fee: reservation.payment.total,
    amountDue: 0,
    courseAccess: reservation.courseAccess,
  };
}

export function markCourseDeparture(state, id, options = {}) {
  const reservation = reservationById(state, id);
  if (!reservation || reservation.checkIn.status !== 'checked-in') return { ok: false, reason: 'Check-in is required before course departure.' };
  if (reservation.courseAccess.status === 'departed') return { ok: true, idempotent: true, reservation };
  const atMinute = Math.floor(options.atMinute ?? nowOf(state));
  reservation.courseAccess.status = 'departed';
  reservation.courseAccess.departedAtMinute = atMinute;
  reservation.actualStartMinute = Math.max(atMinute, absoluteMinute(reservation.dayAbs, reservation.minute));
  const slot = slotForReservation(state, reservation);
  if (slot && slot.actualStartMinute == null) slot.actualStartMinute = reservation.actualStartMinute;
  emitOperationEvent(state, reservation, 'course-departure', atMinute, {
    actualStartMinute: reservation.actualStartMinute,
    assignedCourse: reservation.courseAccess.assignedCourse,
    startingHole: reservation.courseAccess.startingHole,
  });
  return { ok: true, reservation, actualStartMinute: reservation.actualStartMinute };
}

export function createWalkInBooking(state, input = {}) {
  const cal = calendarOf(nowOf(state));
  const dayAbs = Math.floor(input.dayAbs ?? cal.dayAbs);
  const partySize = Math.floor(Number(input.partySize || input.customerNames?.length || 1));
  const holder = String(input.holder || input.name || '').trim();
  // A holder + headcount must not silently recruit unrelated people from the
  // club's golfer pool. Stable placeholders identify every unfilled seat until
  // the player replaces it with an explicit guest name.
  const customerNames = Array.isArray(input.customerNames) && input.customerNames.length
    ? input.customerNames
    : Array.from({ length: Math.max(1, partySize) }, (_, index) => (
      index === 0 ? holder : `Guest ${index + 1} of ${holder}`
    ));
  const arrivingNow = input.arrived !== false && input.checkInImmediately !== false;
  let minute = input.minute;
  if (minute == null) minute = availableSlots(state, dayAbs, { partySize, walkIn: true })[0]?.minute;
  if (minute == null) return { ok: false, reason: 'No real slot has enough capacity.' };
  const result = bookSlot(state, dayAbs, Math.floor(minute), {
    ...input,
    holder,
    customerNames,
    partySize,
    walkIn: true,
    source: 'walk-in',
    arrived: arrivingNow,
    arrivalOffsetMin: Math.floor(nowOf(state) - absoluteMinute(dayAbs, Math.floor(minute))),
  });
  if (!result.ok) return result;
  if (arrivingNow && result.res.arrival.status === 'scheduled') markReservationArrived(state, result.res.id);
  return result;
}

export function operationEventsSince(state, sequence = 0) {
  return bookOf(state).events.filter((event) => event.sequence > sequence);
}

export function operationFinanceSummary(state, dayAbs = null) {
  const entries = bookOf(state).financeEntries.filter((entry) => dayAbs == null || entry.dayAbs === dayAbs);
  const categories = {
    bookingRevenue: 0,
    bookingDeposits: 0,
    bookingBalances: 0,
    bookingRefunds: 0,
    cancellationFees: 0,
    noShowFees: 0,
    walkInRevenue: 0,
  };
  let cashIn = 0;
  let cashOut = 0;
  for (const entry of entries) {
    categories[entry.category] = r2((categories[entry.category] || 0) + entry.amount);
    if (entry.cashDelta > 0) cashIn = r2(cashIn + entry.cashDelta);
    else cashOut = r2(cashOut + Math.abs(entry.cashDelta));
  }
  return {
    entries,
    categories,
    cashIn,
    cashOut,
    netCash: r2(cashIn - cashOut),
    stableIdsUnique: new Set(entries.map((entry) => entry.id)).size === entries.length,
  };
}

export function operationsSummary(state, dayAbs = calendarOf(nowOf(state)).dayAbs) {
  const sheet = daySheet(state, dayAbs);
  const reservations = bookOf(state).booked.filter((entry) => entry.dayAbs === dayAbs);
  const active = reservations.filter((entry) => entry.status !== 'cancelled');
  const capacity = sheet.reduce((sum, slot) => sum + slot.capacity, 0);
  const reserved = sheet.reduce((sum, slot) => sum + slot.reservedSeats, 0);
  const waiting = active.filter((entry) => ['arrived', 'late'].includes(entry.arrival.status) && !checkedIn(entry));
  const future = active
    .filter((entry) => entry.status === 'booked' && entry.arrival.status === 'scheduled')
    .sort((a, b) => a.arrival.plannedMinute - b.arrival.plannedMinute);
  const finance = operationFinanceSummary(state, dayAbs);
  return {
    dayAbs,
    totalSlots: sheet.length,
    capacity,
    reserved,
    utilization: capacity ? reserved / capacity : 0,
    nextArrival: future[0] || null,
    waiting,
    late: active.filter((entry) => entry.arrival.lateMarkedAtMinute != null && !checkedIn(entry)),
    noShows: reservations.filter((entry) => entry.status === 'noShow'),
    cancellations: reservations.filter((entry) => entry.status === 'cancelled'),
    checkedIn: reservations.filter(checkedIn),
    walkIns: reservations.filter((entry) => entry.walkIn),
    bookingRevenue: finance.netCash,
    finance,
  };
}

export function golfOperationsTick(state, targetMinute = nowOf(state)) {
  const book = bookOf(state);
  const target = Math.floor(targetMinute);
  const eventsBefore = book.nextEventSeq;
  const reservations = [...book.booked].sort((a, b) => (
    absoluteMinute(a.dayAbs, a.minute) - absoluteMinute(b.dayAbs, b.minute)
  ));
  for (const reservation of reservations) {
    if (checkedIn(reservation)
      && reservation.courseAccess.status === 'granted'
      && target >= reservation.courseAccess.departurePlannedAtMinute) {
      markCourseDeparture(state, reservation.id, { atMinute: reservation.courseAccess.departurePlannedAtMinute });
      continue;
    }
    if (reservation.status !== 'booked') continue;
    const slotAbs = absoluteMinute(reservation.dayAbs, reservation.minute);
    const dueAt = slotAbs - book.config.dueLeadMin;
    if (target >= dueAt) emitOperationEvent(state, reservation, 'party-due', dueAt);

    const plannedCancel = reservation.cancellation?.plannedAtMinute;
    if (plannedCancel != null && target >= plannedCancel) {
      cancelReservation(state, reservation.id, { atMinute: plannedCancel, reason: 'Advance cancellation' });
      continue;
    }

    const graceEnd = slotAbs + book.config.gracePeriodMin;
    // A large time jump must not manufacture a brief arrival after the party's
    // whole service window has already passed. If no earlier tick observed the
    // arrival, the deterministic result is a no-show.
    if (reservation.arrival.status === 'scheduled' && target >= graceEnd) {
      handleNoShow(state, reservation.id, { atMinute: graceEnd });
      continue;
    }
    if (reservation.arrival.intendedOutcome !== 'no-show'
      && reservation.arrival.status === 'scheduled'
      && target >= reservation.arrival.plannedMinute) {
      markReservationArrived(state, reservation.id, reservation.arrival.plannedMinute);
    }
    if (reservation.arrival.status === 'scheduled' && target >= slotAbs) {
      markReservationLate(state, reservation.id, slotAbs);
    }
    if (!['arrived', 'late'].includes(reservation.arrival.status) && target >= graceEnd) {
      handleNoShow(state, reservation.id, { atMinute: graceEnd });
      continue;
    }
  }
  book.lastProcessedMinute = Math.max(book.lastProcessedMinute || 0, target);
  return operationEventsSince(state, eventsBefore - 1);
}

export function reservationsDailyTick(state, todayAbs) {
  const book = bookOf(state);
  golfOperationsTick(state, todayAbs * 1440);
  book.booked = book.booked.filter((reservation) => reservation.dayAbs >= todayAbs - 30);
  for (const key of Object.keys(book.schedule)) {
    if (Number(key) < todayAbs - 30) delete book.schedule[key];
  }
}

function uniqueNamesForGeneration(state) {
  const used = new Set(bookOf(state).booked.flatMap((reservation) => reservation.customerNames));
  const names = [];
  for (const golfer of state.golfers?.pool || []) {
    if (!used.has(golfer.name) && !names.includes(golfer.name)) names.push(golfer.name);
  }
  return names;
}

export function generateReservations(state, dayAbs, options = {}) {
  const seed = Number(options.seed ?? (state.seed || 1) + dayAbs * 7919);
  const rng = makeRng(seed);
  const occupancy = Math.max(0, Math.min(1, Number(options.occupancy ?? 0.62)));
  const names = uniqueNamesForGeneration(state);
  let nameIndex = 0;
  const created = [];
  for (const slot of daySheet(state, dayAbs)) {
    if (!slot.available || rng.next() > occupancy || nameIndex >= names.length) continue;
    const partySize = 1 + rng.int(configOf(state).maxPartySize);
    const size = Math.min(partySize, slot.availableSeats, names.length - nameIndex);
    if (size < 1) continue;
    const customerNames = names.slice(nameIndex, nameIndex + size);
    nameIndex += size;
    const holder = customerNames[0];
    const roll = rng.next();
    const intendedOutcome = roll < 0.06 ? 'no-show' : 'arrive';
    const arrivalRoll = rng.next();
    const arrivalOffsetMin = intendedOutcome === 'no-show' ? 0
      : arrivalRoll < 0.72 ? -(10 + rng.int(11))
        : arrivalRoll < 0.86 ? 0
          : 3 + rng.int(13);
    const paymentRoll = rng.next();
    const paymentPlan = paymentRoll < 0.28 ? 'prepaid' : undefined;
    const depositAmount = paymentRoll >= 0.28 && paymentRoll < 0.5
      ? r2((state.club?.greenFee || 0) * size * 0.35)
      : 0;
    const result = bookSlot(state, dayAbs, slot.minute, {
      holder,
      customerNames,
      partySize: size,
      arrivalOffsetMin,
      intendedOutcome,
      paymentPlan,
      depositAmount,
      paymentMethod: rng.next() < 0.55 ? 'card' : 'cash',
      cardOnFile: paymentPlan === 'prepaid' || depositAmount > 0,
      source: 'generated',
    });
    if (!result.ok) continue;
    if (rng.next() < 0.06) {
      result.res.cancellation.plannedAtMinute = absoluteMinute(dayAbs, slot.minute) - (24 + rng.int(48)) * 60;
    }
    created.push(result.res);
  }
  const book = bookOf(state);
  book.generator.lastSeed = seed;
  if (!book.generator.generatedDays.includes(dayAbs)) book.generator.generatedDays.push(dayAbs);
  return { seed, created };
}

export function seedGolfOperationsQA(state, options = {}) {
  const dayAbs = Math.floor(options.dayAbs ?? calendarOf(nowOf(state)).dayAbs);
  const seed = Number(options.seed ?? 20260719);
  const rng = makeRng(seed);
  const baseNames = [
    ['Avery Monroe', 'Talia Brooks'],
    ['Devon Park', 'Mina Shah'],
    ['Caleb Foster', 'Noor Ibrahim', 'Wes Chen'],
    ['Imani Cole', 'Theo Jensen'],
    ['Sylvie Hart'],
    ['Jonah Wells', 'Mei Torres'],
    ['Farah Quinn', 'Luca Bennett'],
  ];
  const times = slotTimes(state);
  if (times.length < 7) return { ok: false, reason: 'QA route needs at least seven slots.' };
  const ids = {};
  const create = (key, index, input) => {
    const result = bookSlot(state, dayAbs, times[index], {
      holder: baseNames[index][0],
      customerNames: baseNames[index],
      partySize: baseNames[index].length,
      source: 'qa-seed',
      ...input,
    });
    if (!result.ok) throw new Error(`QA fixture ${key}: ${result.reason}`);
    ids[key] = result.res.id;
    return result.res;
  };
  create('earlyPrepaid', 0, { arrivalOffsetMin: -18, paymentPlan: 'prepaid', paymentMethod: 'card', cardOnFile: true });
  create('onTimeCard', 1, { arrivalOffsetMin: 0 });
  create('lateCash', 2, { arrivalOffsetMin: 8, depositAmount: r2((state.club?.greenFee || 0) * 0.4), paymentMethod: 'cash' });
  create('noShow', 3, { intendedOutcome: 'no-show', depositAmount: 15, paymentMethod: 'card', cardOnFile: true });
  const cancelled = create('cancellation', 4, { arrivalOffsetMin: -12, paymentPlan: 'prepaid', paymentMethod: 'card' });
  cancelReservation(state, cancelled.id, {
    atMinute: absoluteMinute(dayAbs, cancelled.minute) - 26 * 60,
    reason: 'QA advance cancellation',
  });
  create('fullSlotA', 5, { arrivalOffsetMin: -14, paymentPlan: 'prepaid', paymentMethod: 'card' });
  create('fullSlotB', 5, {
    holder: baseNames[6][0],
    customerNames: baseNames[6],
    partySize: baseNames[6].length,
    arrivalOffsetMin: -11,
  });
  const walkInMinute = times[6];
  bookOf(state).generator.lastSeed = seed;
  return {
    ok: true,
    seed,
    dayAbs,
    ids,
    walkInMinute,
    randomProof: rng.next(),
  };
}

export function fmtSlot(minute) {
  const hour = Math.floor(minute / 60);
  const min = minute % 60;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = ((hour + 11) % 12) + 1;
  return `${hour12}:${String(min).padStart(2, '0')} ${ampm}`;
}
