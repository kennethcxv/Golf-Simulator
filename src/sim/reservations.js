// FAIRWAY STATE - golf operations.
//
// This module owns tee-time schedule and front-desk operations state. It does
// not own customer walking AI, merchandise checkout, the laptop shell, or the
// save transport. Those systems consume the stable queries/events exported
// here and keep their existing responsibilities.

import { makeRng } from '../core/utils.js';
import { calendarOf } from './time.js';
import { amenityScore, clubRatings, demandMultiplier, fairGreenFee } from './club.js';
import { addExpense, addRevenue, postLedgerEntry, recordOutcome, unbill } from './economy.js';
import { cancelReservationCustomer, scheduleReservationCustomer } from './customerSimulation.js';
import { allocateCustomerIdentity } from './customerIdentity.js';
import { bankServiceCharge, serviceTicketByReference } from './register.js';
import { beginCartTrip, cartReservationQuote, cartsRequiredForParty } from './cartFleet.js';

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

// Stable service-payment identities shared with the physical register adapter.
export const RESERVATION_DEPOSIT_TYPE = 'reservation-deposit';
export const RESERVATION_NO_SHOW_FEE_TYPE = 'reservation-no-show-fee';
export const RESERVATION_DEPOSIT_SKU = 'service:reservation-deposit';
export const RESERVATION_NO_SHOW_FEE_SKU = 'service:reservation-no-show-fee';

export function reservationDepositReference(reservationId) {
  return `reservation:${String(reservationId)}:deposit`;
}

export function reservationNoShowFeeReference(reservationId) {
  return `reservation:${String(reservationId)}:no-show-fee`;
}

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

function syncReservationCompatibility(state, reservation, force = false) {
  if (reservation._compatSynced && !force) return reservation;
  const total = r2(reservation.payment?.total ?? reservation.fee ?? 0);
  const amountPaid = r2(reservation.payment?.amountPaid ?? reservation.depositPaid ?? 0);
  const depositPaid = r2(reservation.payment?.depositPaid ?? reservation.depositPaid ?? 0);
  const amountDue = r2(reservation.payment?.amountDue ?? Math.max(0, total - amountPaid));
  reservation.reservationId ??= reservation.id;
  reservation.customerId ??= `reservation-customer-${String(reservation.id)}`;
  reservation.fullName ??= reservation.reservationHolder || reservation.name;
  reservation.groupSize = reservation.partySize;
  reservation.groupMembers ??= reservation.party?.members?.map((member, index) => ({
    customerId: index === 0 ? reservation.customerId : `${reservation.customerId}:member:${index + 1}`,
    fullName: member.name,
    name: member.name,
    role: index === 0 ? 'booking-contact' : 'golfer',
  })) || [];
  reservation.teeTime = reservation.minute;
  reservation.teeTimeAbs = absoluteMinute(reservation.dayAbs, reservation.minute);
  reservation.fee = total;
  reservation.depositRequested ??= depositPaid;
  reservation.deposit = depositPaid;
  reservation.depositPaid = depositPaid;
  reservation.depositStatus ??= depositPaid > EPSILON ? 'legacy-untracked' : 'none';
  reservation.depositReferenceId ??= null;
  reservation.depositTransactionNumber ??= null;
  reservation.depositPaidAt ??= null;
  reservation.depositPaymentMethod ??= null;
  reservation.balanceDue = amountDue;
  reservation.remainingBalance = amountDue;
  reservation.paymentStatus = amountDue <= EPSILON ? 'paid' : amountPaid > EPSILON ? 'deposit-paid' : 'unpaid';
  reservation.paymentPreference ??= reservation.payment?.method === 'cash' || reservation.payment?.method === 'card'
    ? reservation.payment.method : null;
  reservation.reservationStatus = reservation.status;
  reservation.checkInStatus = reservation.checkIn?.status === 'checked-in' ? 'checked-in'
    : reservation.checkIn?.status === 'confirmed' ? 'waiting'
      : reservation.status === 'noShow' ? 'missed' : reservation.status === 'cancelled' ? 'cancelled' : 'pending';
  reservation.customerType ??= reservation.walkIn ? 'walk-in' : 'reservation';
  reservation.holes = reservation.holes === 9 ? 9 : 18;
  reservation.transport = reservation.transport === 'cart' ? 'cart' : 'walking';
  reservation.requestedTransport ??= reservation.transport;
  reservation.cartBookingOutcome ??= reservation.transport === 'cart' ? 'accepted' : 'not-requested';
  reservation.cartsRequested ??= reservation.transport === 'cart'
    ? cartsRequiredForParty(reservation.partySize) : 0;
  reservation.greenFeeSubtotal ??= r2(Math.max(0, total - Number(reservation.cartRentalFee || 0)));
  reservation.cartRentalFee = r2(reservation.cartRentalFee || 0);
  reservation.cartTripId ??= null;
  reservation.cartService ??= null;
  reservation.rentalRequirements ??= [];
  reservation.arrivalStatus = reservation.arrival?.status === 'late' ? 'arrived' : (reservation.arrival?.status || 'scheduled');
  reservation.plannedArrival = reservation.arrival?.plannedMinute ?? reservation.teeTimeAbs - TEE_SHEET.dueLeadMin;
  reservation.arrivalWindow ??= { start: reservation.plannedArrival, end: reservation.plannedArrival };
  reservation.arrivalTime = reservation.arrival?.arrivedAtMinute ?? null;
  reservation.arrivedAt = reservation.arrivalTime;
  reservation.checkedInAt = reservation.checkIn?.checkedInAtMinute ?? reservation.checkedInAt ?? null;
  reservation.createdAt ??= reservation.createdAtMinute ?? nowOf(state);
  reservation.cancelledAt = reservation.cancellation?.cancelledAtMinute ?? reservation.cancelledAt ?? null;
  reservation.noShowAt = reservation.noShow?.markedAtMinute ?? reservation.noShowAt ?? null;
  reservation.noShowFee ??= r2(reservation.noShow?.feeApplied || 0);
  reservation.noShowFeeStatus ??= reservation.status === 'noShow'
    ? (reservation.noShowFee > 0 ? 'charged' : 'waived') : 'not-due';
  reservation.currentDestination = reservation.status === 'played' ? 'course'
    : reservation.status === 'cancelled' || reservation.status === 'noShow' ? 'departed'
      : reservation.arrivalStatus === 'arrived' ? 'front-desk' : 'offsite';
  reservation._compatSynced = true;
  return reservation;
}

function migrateReservation(state, book, reservation, index, legacyCapacityDefault = false) {
  if (reservation._compatSynced) return reservation;
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
    const size = Math.max(1, Number(reservation.partySize || (legacyCapacityDefault ? book.config.slotCapacity : names.length) || 1));
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
  return syncReservationCompatibility(state, reservation);
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
  const legacyCapacityDefault = book.version == null;
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

  for (let i = 0; i < book.booked.length; i++) migrateReservation(state, book, book.booked[i], i, legacyCapacityDefault);
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
      bookedPlayers: capacityUsed,
      remainingCapacity: Math.max(0, slot.capacity - capacityUsed),
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
  if (dayAbs === todayAbs && minute < calendarOf(nowOf(state)).minuteOfDay) {
    return { ok: false, reason: 'That tee time has already passed.' };
  }
  if (dayAbs >= todayAbs + config.horizonDays) {
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
  return { ...(maybeOptions || {}), holder: nameOrOptions, legacyExact: true };
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

function mainLedgerCash(state, reservation, entry) {
  const cashDelta = r2(entry.cashDelta);
  if (!state.ledger) {
    state.cash = r2((state.cash || 0) + cashDelta);
    return { ok: true, legacy: true, entry: null };
  }
  const common = {
    idempotencyKey: `golf-operations:${entry.id}`,
    relatedId: reservation.id,
    category: entry.category,
    description: `${entry.kind} — ${reservation.reservationHolder}`,
    source: 'golf-operations',
    day: entry.dayAbs,
    timestamp: entry.postedAtMinute,
    customerCount: reservation.partySize,
    metadata: {
      financeEntryId: entry.id,
      partyId: reservation.party.id,
      method: entry.method,
      transactionId: entry.transactionId,
      receiptId: entry.receiptId,
      effectiveDayAbs: entry.effectiveDayAbs,
      note: entry.note,
    },
  };
  if (cashDelta > EPSILON) return addRevenue(state, entry.category, cashDelta, common);
  if (cashDelta < -EPSILON) return addExpense(state, 'bookingRefunds', Math.abs(cashDelta), {
    ...common,
    category: 'bookingRefunds',
  });
  // Retained deposits and prepaid funds are already in cash and profit. Keep an
  // immutable classification memo without manufacturing a second revenue event.
  return postLedgerEntry(state, {
    ...common,
    direction: 'revenue',
    amount: entry.amount,
    accountingClass: 'memo',
    cashImpact: 0,
    profitImpact: 0,
    aggregate: null,
  });
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
    // The subledger day is the posting day, exactly like ledger.today. Keep
    // the effective event time separately so delayed ticks remain auditable
    // without making the two books disagree about when cash actually moved.
    dayAbs: Number.isInteger(state.ledger?.postingDay)
      ? state.ledger.postingDay
      : calendarOf(nowOf(state)).dayAbs,
    effectiveDayAbs: calendarOf(input.atMinute).dayAbs,
    atMinute: Math.floor(input.atMinute),
    postedAtMinute: nowOf(state),
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
  const ledgerPost = mainLedgerCash(state, reservation, entry);
  if (!ledgerPost.ok) return ledgerPost;
  entry.relatedEntryId = ledgerPost.entry?.id || entry.relatedEntryId;
  book.financeEntries.push(entry);
  if (book.financeEntries.length > FINANCE_LIMIT) book.financeEntries.splice(0, book.financeEntries.length - FINANCE_LIMIT);
  if (entry.transactionId && !book.processedTransactionIds.includes(entry.transactionId)) {
    book.processedTransactionIds.push(entry.transactionId);
  }
  return { ok: true, entry, ledgerEntry: ledgerPost.entry || null, idempotent: false };
}

export function bookSlot(state, dayAbs, minute, nameOrOptions, maybeOptions = {}) {
  const options = bookingOptions(nameOrOptions, maybeOptions);
  const holder = String(options.holder || options.name || '').trim();
  if (!holder) return { ok: false, reason: 'A booking needs a reservation holder.' };
  const partySize = Math.floor(Number(options.partySize || options.customerNames?.length
    || (options.legacyExact ? configOf(state).slotCapacity : 1)));
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
  const holes = options.holes === 9 ? 9 : 18;
  const transport = options.transport === 'cart' || options.transport === 'ride' ? 'cart' : 'walking';
  const cartQuote = transport === 'cart'
    ? cartReservationQuote(state, { dayAbs, minute, partySize, holes })
    : { ok: true, requested: 0, fee: 0 };
  if (!cartQuote.ok) return { ok: false, reason: cartQuote.reason, cartQuote };
  const greenFeeSubtotal = r2(feePerPlayer * party.size);
  const cartRentalFee = transport === 'cart' ? r2(options.cartRentalFee ?? cartQuote.fee) : 0;
  const quotedTotal = options.totalAmount ?? options.totalFee;
  const total = quotedTotal != null ? r2(quotedTotal)
    : options.legacyExact ? r2(feePerPlayer + cartRentalFee)
      : r2(greenFeeSubtotal + cartRentalFee);
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
    _legacyExact: !!options.legacyExact,
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
    holes,
    transport,
    requestedTransport: options.requestedTransport === 'cart' || options.requestedTransport === 'ride' ? 'cart' : transport,
    cartBookingOutcome: options.cartBookingOutcome || (transport === 'cart' ? 'accepted' : 'not-requested'),
    cartsRequested: transport === 'cart' ? cartQuote.requested : 0,
    greenFeeSubtotal: r2(Math.max(0, total - cartRentalFee)),
    cartRentalFee,
    cartTripId: null,
    cartService: null,
  };
  if (options.customerIdentity || options.customerId) {
    reservation.customerId = options.customerIdentity?.customerId || String(options.customerId);
    reservation.fullName = options.customerIdentity?.fullName || options.fullName || holder;
  }
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

  syncReservationCompatibility(state, reservation, true);
  if (reservation._legacyExact) delete reservation.balanceDue;
  scheduleReservationCustomer(state, reservation);

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
  if (['arrived', 'late'].includes(reservation.arrival.status)) return { ok: true, already: true, idempotent: true, reservation, res: reservation };
  const slotAbs = absoluteMinute(reservation.dayAbs, reservation.minute);
  const late = atMinute > slotAbs;
  reservation.arrival.status = late ? 'late' : 'arrived';
  reservation.arrival.arrivedAtMinute = Math.floor(atMinute);
  if (late) reservation.arrival.lateMarkedAtMinute = Math.floor(atMinute);
  emitOperationEvent(state, reservation, 'party-arrived', atMinute, { late });
  if (late) emitOperationEvent(state, reservation, 'party-late', atMinute, { minutesLate: Math.floor(atMinute - slotAbs) });
  reservation.arrivalStatus = 'arrived';
  reservation.arrivalTime = Math.floor(atMinute);
  reservation.arrivedAt = Math.floor(atMinute);
  reservation.currentDestination = 'front-desk';
  return { ok: true, reservation, res: reservation, late };
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
  scheduleReservationCustomer(state, reservation);
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
  cancelReservationCustomer(state, reservation.id);
  recordOutcome(state, {
    idempotencyKey: `golf-operations:${reservation.id}:cancelled`,
    type: 'cancellation',
    count: 1,
    amount: terms.fee,
    relatedId: reservation.id,
    reason: terms.fee > EPSILON
      ? `${reservation.reservationHolder} cancelled with a retained fee.`
      : `${reservation.reservationHolder} cancelled with notice.`,
    day: calendarOf(atMinute).dayAbs,
    metadata: { refund: terms.refund, kind: reservation.cancellation.kind, partySize: reservation.partySize },
  });
  return { ok: true, reservation, ...terms };
}

function applyOperationsNoShowFee(state, reservation, atMinute, options = {}) {
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
  const fee = applyOperationsNoShowFee(state, reservation, atMinute, options);
  reservation.status = 'noShow';
  reservation.arrival.status = 'no-show';
  reservation.payment.pending = null;
  reservation.noShow = { markedAtMinute: atMinute, feeApplied: fee.feeApplied, ledgerEntryIds: fee.entryIds };
  emitOperationEvent(state, reservation, 'party-no-show', atMinute, {
    feeApplied: fee.feeApplied,
    slotReopened: bookOf(state).policy.reopenNoShowSlot,
  });
  cancelReservationCustomer(state, reservation.id);
  recordOutcome(state, {
    idempotencyKey: `golf-operations:${reservation.id}:no-show`,
    type: 'noShow',
    count: 1,
    amount: fee.feeApplied,
    relatedId: reservation.id,
    reason: `${reservation.reservationHolder} did not arrive before the grace period ended.`,
    day: calendarOf(atMinute).dayAbs,
    metadata: { partySize: reservation.partySize, slotReopened: bookOf(state).policy.reopenNoShowSlot },
  });
  return { ok: true, reservation, feeApplied: fee.feeApplied };
}

export function dueForCheckIn(state) {
  const cal = calendarOf(nowOf(state));
  return bookOf(state).booked
    .filter((reservation) => (
      reservation.status === 'booked'
      && reservation.dayAbs === cal.dayAbs
      && (['arrived', 'late'].includes(reservation.arrival.status)
        || (reservation._legacyExact && !reservation.willNoShow && nowOf(state) >= reservation.plannedArrival))
      && reservation.checkIn.status !== 'checked-in'
    ))
    .sort((a, b) => (a.arrival.arrivedAtMinute - b.arrival.arrivedAtMinute) || (a.minute - b.minute));
}

export function checkInReservation(state, id, options = {}) {
  const reservation = reservationById(state, id);
  if (!reservation || reservation.status !== 'booked') return { ok: false, reason: 'No open booking under that name.' };
  const legacyDirect = reservation._compatEngine || (reservation._legacyExact && (
    reservation.arrivalStatus === 'arrived'
    || reservation.dayAbs > calendarOf(nowOf(state)).dayAbs
  ));
  if (legacyDirect && reservation.checkIn.status !== 'confirmed') {
    const fee = Number.isFinite(reservation.balanceDue) ? r2(Math.max(0, reservation.balanceDue))
      : Number.isFinite(reservation.fee) ? r2(Math.max(0, reservation.fee)) : 0;
    const posted = fee > EPSILON ? addRevenue(state, 'greenFees', fee, {
      idempotencyKey: `reservation-legacy-check-in:${reservation.id}`,
      relatedId: reservation.id,
      source: 'reservation-check-in',
    }) : { ok: true };
    if (!posted.ok) return posted;
    const atMinute = Math.floor(options.atMinute ?? nowOf(state));
    reservation.status = 'played';
    reservation.payment.total = r2(reservation.fee ?? fee);
    reservation.payment.amountPaid = reservation.payment.total;
    reservation.payment.amountDue = 0;
    reservation.payment.status = 'paid';
    reservation.payment.method ||= 'legacy';
    reservation.paymentStatus = 'paid';
    reservation.paidAmount = fee;
    reservation.checkIn.status = 'checked-in';
    reservation.checkIn.checkedInAtMinute = atMinute;
    reservation.checkInStatus = 'checked-in';
    reservation.checkedInAt = atMinute;
    reservation.currentDestination = 'course';
    reservation.courseAccess.status = 'granted';
    reservation.courseAccess.grantedAtMinute = atMinute;
    reservation.courseAccess.departurePlannedAtMinute = atMinute + bookOf(state).policy.autoDepartMinutesAfterCheckIn;
    for (const member of reservation.party.members) member.checkedIn = true;
    const cart = beginCartTrip(state, reservation, { at: atMinute });
    return { ok: true, reservation, res: reservation, fee, amountDue: 0, courseAccess: reservation.courseAccess, cart };
  }
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
  recordOutcome(state, {
    idempotencyKey: `golf-operations:${reservation.id}:checked-in`,
    type: 'teeCheckIn',
    count: reservation.partySize,
    amount: reservation.payment.total,
    relatedId: reservation.id,
    reason: `${reservation.reservationHolder}'s party checked in for its tee time.`,
    day: calendarOf(atMinute).dayAbs,
    metadata: { partySize: reservation.partySize, walkIn: reservation.walkIn },
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
  recordOutcome(state, {
    idempotencyKey: `golf-operations:${reservation.id}:course-access`,
    type: 'courseAccess',
    count: reservation.partySize,
    relatedId: reservation.id,
    reason: `${reservation.reservationHolder}'s party departed for the course.`,
    day: calendarOf(atMinute).dayAbs,
    metadata: {
      partySize: reservation.partySize,
      assignedCourse: reservation.courseAccess.assignedCourse,
      startingHole: reservation.courseAccess.startingHole,
    },
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

export function reservationPaymentRevenueSplit(reservation, amount = null) {
  const total = r2(Math.max(0, Number(amount ?? reservation?.balanceDue ?? reservation?.payment?.amountDue ?? reservation?.fee ?? 0)));
  const greenTotal = r2(Math.max(0, Number(
    reservation?.greenFeeSubtotal ?? ((reservation?.fee ?? 0) - (reservation?.cartRentalFee ?? 0)),
  )));
  const depositPaid = Math.max(0, Number(reservation?.depositPaid ?? reservation?.payment?.depositPaid ?? 0));
  const greenOutstanding = Math.max(0, greenTotal - depositPaid);
  const greenFees = r2(Math.min(total, greenOutstanding));
  return { greenFees, rentals: r2(total - greenFees), total };
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

function uniqueNamesForGeneration(state, dayAbs) {
  // A golfer may reasonably play again on another day, but two simultaneous
  // parties must never materialize as the same visible customer identity.
  const used = new Set(bookOf(state).booked
    .filter((reservation) => reservation.dayAbs === dayAbs && reservation.status !== 'cancelled')
    .flatMap((reservation) => reservation.customerNames));
  const names = [];
  for (const golfer of state.golfers?.pool || []) {
    if (!used.has(golfer.name) && !names.includes(golfer.name)) names.push(golfer.name);
  }
  return names;
}

function generatedOccupancy(state, dayAbs) {
  const reputation = Math.max(0, Math.min(1, Number(state.club?.reputation || 50) / 100));
  const health = state.turf?.health?.length
    ? state.turf.health.reduce((sum, value) => sum + value, 0) / state.turf.health.length / 100
    : 0.55;
  const rain = dayAbs === calendarOf(nowOf(state)).dayAbs ? Number(state.weather?.today?.rainIn || 0) : 0;
  const temperature = Number(state.weather?.today?.tempHiF || 70);
  const weatherFactor = Math.max(0.55, 1 - Math.min(0.45, rain * 0.8)
    - Math.min(0.18, Math.abs(temperature - 72) / 110));
  const baseOccupancy = (0.22 + reputation * 0.31 + health * 0.27) * weatherFactor;
  const ratings = clubRatings(state);
  const fairFee = fairGreenFee(ratings.overall, amenityScore(state));
  const priceDemand = demandMultiplier(Number(state.club?.greenFee || 0), fairFee);

  // The tee sheet and public-round estimator must consume the same price signal.
  // Without this factor, generated online bookings paid any configured green fee
  // at unchanged occupancy, making the legal maximum an automatic revenue win.
  // Keep a small prospect floor so an overpriced course is quiet, not impossible.
  return Math.max(0.02, Math.min(0.95, baseOccupancy * priceDemand));
}

export function generateReservations(state, dayAbs, options = {}) {
  const seed = Number(options.seed ?? (state.seed || 1) + dayAbs * 7919);
  const rng = makeRng(seed);
  const occupancy = Math.max(0, Math.min(1, Number(options.occupancy ?? generatedOccupancy(state, dayAbs))));
  const names = uniqueNamesForGeneration(state, dayAbs);
  let nameIndex = 0;
  const created = [];
  for (const slot of daySheet(state, dayAbs)) {
    if (!slot.available || rng.next() > occupancy || nameIndex >= names.length) continue;
    const sizeRoll = rng.next();
    const partySize = sizeRoll < 0.16 ? 1 : sizeRoll < 0.68 ? 2 : sizeRoll < 0.84 ? 3 : 4;
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
      const slotAbs = absoluteMinute(dayAbs, slot.minute);
      const advancePlan = slotAbs - (24 + rng.int(48)) * 60;
      result.res.cancellation.plannedAtMinute = advancePlan > nowOf(state)
        ? advancePlan
        : Math.min(slotAbs - 5, nowOf(state) + 15 + rng.int(46));
    }
    created.push(result.res);
  }
  const book = bookOf(state);
  book.generator.lastSeed = seed;
  if (!book.generator.generatedDays.includes(dayAbs)) book.generator.generatedDays.push(dayAbs);
  return { seed, created };
}

export function ensureReservationHorizon(state, options = {}) {
  const book = bookOf(state);
  const todayAbs = Math.floor(options.todayAbs ?? calendarOf(nowOf(state)).dayAbs);
  const results = [];
  for (let offset = 0; offset < book.config.horizonDays; offset++) {
    const dayAbs = todayAbs + offset;
    if (book.generator.generatedDays.includes(dayAbs)) continue;
    results.push(generateReservations(state, dayAbs, {
      ...options,
      seed: options.seed == null ? undefined : Number(options.seed) + offset * 7919,
    }));
  }
  book.generator.generatedDays = book.generator.generatedDays
    .filter((dayAbs) => dayAbs >= todayAbs - 30 && dayAbs < todayAbs + book.config.horizonDays);
  return {
    generatedDays: results.length,
    created: results.flatMap((result) => result.created),
  };
}

// Capacity-engine compatibility -------------------------------------------------
// The checkout/front-desk branch exposed a smaller API over the same tee sheet.
// These adapters keep those callers on the richer operations records.

export function reservationConfig(state) {
  const config = configOf(state);
  return {
    ...config,
    maxGroupSize: config.maxPartySize,
    arrivalLeadMin: config.arrivalLeadMin ?? 15,
    arrivalWindowMin: config.arrivalWindowMin ?? 4,
    noShowGraceMin: config.noShowGraceMin ?? config.gracePeriodMin,
    noShowFeeRate: config.noShowFeeRate ?? 0.25,
  };
}

export function configureReservations(state, patch = {}) {
  const translated = {
    ...patch,
    maxPartySize: patch.maxPartySize ?? patch.maxGroupSize,
    gracePeriodMin: patch.gracePeriodMin ?? patch.noShowGraceMin,
  };
  delete translated.maxGroupSize;
  delete translated.noShowGraceMin;
  const result = configureTeeSheet(state, translated);
  return result.ok ? reservationConfig(state) : result;
}

export function slotLoad(state, dayAbs, minute) {
  const slot = daySheet(state, dayAbs).find((entry) => entry.minute === minute);
  const capacity = slot?.capacity ?? configOf(state).slotCapacity;
  const bookedPlayers = slot?.reservedSeats ?? 0;
  return {
    dayAbs,
    minute,
    capacity,
    bookedPlayers,
    remainingCapacity: Math.max(0, capacity - bookedPlayers),
    reservations: slot?.reservations || [],
  };
}

export function slotAvailability(state, dayAbs, minute, partySize = 1) {
  const load = slotLoad(state, dayAbs, minute);
  const size = Math.floor(Number(partySize || 1));
  const validTime = slotTimes(state).includes(minute);
  const validParty = size > 0 && size <= configOf(state).maxPartySize;
  const day = ensureScheduleDay(state, dayAbs);
  return {
    ...load,
    partySize: size,
    validTime,
    validParty,
    available: !day.closed && validTime && validParty && load.remainingCapacity >= size,
  };
}

export function planReservationArrival(reservation, options = {}) {
  const random = options.rng || makeRng((Number(reservation.id) || 1) * 2654435761);
  const range = (min, max) => typeof random.range === 'function'
    ? random.range(min, max) : min + (max - min) * (typeof random.next === 'function' ? random.next() : 0.5);
  const lead = Number(options.arrivalLeadMin ?? 15);
  const travel = Number(options.travelVariationMin ?? range(-5, 6));
  const weather = Number(options.weatherDelayMin ?? Math.max(0, Number(options.weatherSeverity || 0)) * 6);
  const parking = Number(options.parkingDelayMin ?? (1 - Math.max(0, Math.min(1, Number(options.parkingAvailability ?? 1)))) * 6);
  const punctuality = Math.max(0, Math.min(1, Number(options.punctuality ?? reservation.punctuality ?? 0.5)));
  const personality = options.personality ?? reservation.arrivalPersonality ?? 'punctual';
  const personalityOffset = personality === 'early' ? -5 : personality === 'relaxed' ? 3 : personality === 'rushed' ? 7 : -1;
  const teeTimeAbs = absoluteMinute(reservation.dayAbs, reservation.minute);
  const plannedArrival = Math.max(teeTimeAbs - 30, Math.min(teeTimeAbs + 10, Math.round(
    teeTimeAbs - lead + travel + weather + parking + personalityOffset + (0.5 - punctuality) * 10 + range(-1.5, 1.5),
  )));
  const halfWindow = Math.ceil(Number(options.arrivalWindowMin ?? 4) / 2);
  return {
    plannedArrival,
    arrivalWindow: { start: plannedArrival - halfWindow, end: plannedArrival + halfWindow },
    factors: { targetLeadMin: lead, travelVariationMin: travel, weatherDelayMin: r2(weather), parkingDelayMin: r2(parking), personality, punctuality },
  };
}

export function bookReservation(state, details = {}) {
  const dayAbs = Math.floor(Number(details.dayAbs));
  const minute = Math.floor(Number(details.minute ?? details.teeTime));
  const requestedName = String(details.fullName ?? details.name ?? '').trim();
  if (!requestedName) return { ok: false, reason: 'A booking needs a name.' };
  const identity = details.customerIdentity || allocateCustomerIdentity(state, {
    sourceId: `reservation:${bookOf(state).nextId}`,
    legacy: { ...(details.customer || {}), ...(details.customerId ? { customerId: String(details.customerId) } : {}), name: requestedName },
  });
  const partySize = Math.floor(Number(details.groupSize ?? details.partySize ?? 1));
  const transport = details.transport === 'cart' ? 'cart' : 'walking';
  const holes = details.holes === 9 ? 9 : 18;
  const quote = transport === 'cart'
    ? cartReservationQuote(state, { dayAbs, minute, partySize, holes })
    : { ok: true, requested: 0, fee: 0 };
  if (!quote.ok) return { ok: false, reason: quote.reason, cartQuote: quote };
  const feePerPlayer = r2(details.feePerGolfer ?? details.feePerPlayer ?? state.club?.greenFee ?? 0);
  const greenFeeSubtotal = r2(feePerPlayer * partySize);
  const cartRentalFee = transport === 'cart' ? r2(details.cartRentalFee ?? quote.fee) : 0;
  const total = r2(details.totalFee ?? details.fee ?? greenFeeSubtotal + cartRentalFee);
  const names = Array.isArray(details.groupMembers) && details.groupMembers.length
    ? details.groupMembers.map((member) => member.fullName || member.name)
    : [identity.fullName];
  const result = bookSlot(state, dayAbs, minute, {
    holder: identity.fullName,
    customerNames: names,
    partySize,
    feePerPlayer,
    totalAmount: total,
    arrived: details.arrivalStatus === 'arrived' || details.arrived === true,
    arrivalOffsetMin: Number.isFinite(details.arrivalOffsetMin) ? details.arrivalOffsetMin : -15,
    intendedOutcome: details.willNoShow ? 'no-show' : (details.intendedOutcome || 'arrive'),
    source: details.source || 'manual',
    walkIn: details.customerType === 'walk-in' || details.walkIn,
    holes,
    transport,
  });
  if (!result.ok) return result;
  const reservation = result.res;
  reservation._compatEngine = true;
  reservation.customerId = identity.customerId;
  reservation.fullName = identity.fullName;
  reservation.name = identity.fullName;
  reservation.reservationHolder = identity.fullName;
  const memberIdentities = [identity];
  for (let index = 1; index < partySize; index += 1) {
    const supplied = Array.isArray(details.groupMembers) ? details.groupMembers[index] : null;
    memberIdentities.push(allocateCustomerIdentity(state, {
      sourceId: `reservation:${reservation.id}:member:${index}`,
      legacy: supplied || undefined,
    }));
  }
  reservation.party.members = memberIdentities.map((member, index) => ({
    id: `${reservation.party.id}:member:${index + 1}`,
    name: member.fullName,
    memberStatus: details.membershipStatus || 'guest',
    checkedIn: false,
  }));
  reservation.party.size = partySize;
  reservation.customerNames = memberIdentities.map((member) => member.fullName);
  reservation.groupMembers = memberIdentities.map((member, index) => ({
    customerId: member.customerId,
    fullName: member.fullName,
    name: member.fullName,
    role: index === 0 ? 'booking-contact' : 'golfer',
  }));
  reservation.personality = identity.personality;
  reservation.patience = Number(details.patience ?? identity.patience);
  reservation.punctuality = Number(details.punctuality ?? identity.punctuality);
  reservation.arrivalPersonality = details.arrivalPersonality || 'punctual';
  reservation.paymentPreference = details.paymentPreference === 'cash' || details.paymentPreference === 'card'
    ? details.paymentPreference : identity.paymentPreference;
  reservation.holes = holes;
  reservation.transport = transport;
  reservation.requestedTransport = details.requestedTransport === 'cart' ? 'cart' : transport;
  reservation.cartBookingOutcome = details.cartBookingOutcome || (transport === 'cart' ? 'accepted' : 'not-requested');
  reservation.cartsRequested = transport === 'cart' ? quote.requested : 0;
  reservation.greenFeeSubtotal = r2(Math.max(0, total - cartRentalFee));
  reservation.cartRentalFee = cartRentalFee;
  reservation.noShowFee = r2(Math.max(0, Number(details.noShowFee ?? total * reservationConfig(state).noShowFeeRate)));
  reservation.noShowFeeStatus = 'not-due';
  reservation.willNoShow = Boolean(details.willNoShow);
  if (details.plannedArrival != null) reservation.arrival.plannedMinute = Number(details.plannedArrival);
  reservation.plannedArrival = reservation.arrival.plannedMinute;
  reservation.arrivalWindow = details.arrivalWindow || { start: reservation.plannedArrival - 2, end: reservation.plannedArrival + 2 };
  reservation.depositRequested = r2(Math.max(0, Number(details.deposit ?? 0)));
  reservation.depositStatus = reservation.depositRequested > 0 ? 'pending' : 'none';
  syncReservationCompatibility(state, reservation, true);
  if (reservation.depositRequested > 0 && details.bankDeposit !== false && calendarOf(nowOf(state)).minuteOfDay !== 0) {
    const depositResult = bankReservationDeposit(state, reservation.id, {
      amount: reservation.depositRequested,
      method: details.depositPaymentMethod || 'online-card',
      at: details.depositPaidAt ?? nowOf(state),
    });
    if (!depositResult.ok) return { ok: false, reason: depositResult.reason, depositResult };
    return { ...result, depositResult };
  }
  return result;
}

export function bankReservationDeposit(state, id, { amount = null, method = 'online-card', at = nowOf(state) } = {}) {
  const reservation = reservationById(state, id);
  if (!reservation) return { ok: false, reason: 'Reservation not found.' };
  const referenceId = reservationDepositReference(id);
  const existing = serviceTicketByReference(state, RESERVATION_DEPOSIT_TYPE, referenceId);
  if (reservation.depositStatus === 'paid' || reservation.depositReferenceId) {
    return { ok: true, already: true, amount: reservation.depositPaid || 0, res: reservation, ticket: existing };
  }
  const depositAmount = r2(Math.max(0, Math.min(reservation.fee, Number(amount ?? reservation.depositRequested ?? 0))));
  if (depositAmount <= EPSILON) return { ok: true, amount: 0, res: reservation, ticket: null };
  const banked = bankServiceCharge(state, {
    type: RESERVATION_DEPOSIT_TYPE,
    referenceId,
    revenueKey: 'greenFees',
    amount: depositAmount,
    customer: reservation.fullName || reservation.name,
    customerId: reservation.customerId,
    method,
    skuId: RESERVATION_DEPOSIT_SKU,
    itemName: 'Reservation Deposit',
    minute: at,
    details: { reservationId: id, customerId: reservation.customerId, dayAbs: reservation.dayAbs, minute: reservation.minute, totalFee: reservation.fee },
  });
  if (!banked.ok) return banked;
  reservation.payment.amountPaid = r2(reservation.payment.amountPaid + depositAmount);
  reservation.payment.depositPaid = depositAmount;
  refreshPayment(reservation);
  reservation.depositRequested = depositAmount;
  reservation.depositPaid = depositAmount;
  reservation.deposit = depositAmount;
  reservation.depositStatus = 'paid';
  reservation.depositReferenceId = referenceId;
  reservation.depositTransactionNumber = banked.ticket.number;
  reservation.depositPaidAt = banked.ticket.minute ?? at;
  reservation.depositPaymentMethod = method;
  syncReservationCompatibility(state, reservation, true);
  return { ok: true, already: !!banked.already, amount: depositAmount, res: reservation, ticket: banked.ticket };
}

export function generateOnlineReservations(state, options = {}) {
  const dayAbs = Math.floor(options.dayAbs ?? calendarOf(nowOf(state)).dayAbs + 1);
  const count = Math.max(0, Math.floor(options.count ?? 3));
  const minSize = Math.max(1, Math.floor(options.minGroupSize ?? 1));
  const maxSize = Math.min(configOf(state).maxPartySize, Math.floor(options.maxGroupSize ?? configOf(state).maxPartySize));
  const random = makeRng(Number(options.seed ?? state.seed ?? 1) + dayAbs * 7919);
  const created = [];
  let attempts = 0;
  while (created.length < count && attempts < count * 30 + 30) {
    attempts += 1;
    const partySize = minSize + random.int(Math.max(1, maxSize - minSize + 1));
    const candidates = availableSlots(state, dayAbs, { partySize });
    if (!candidates.length) break;
    const slot = candidates[random.int(candidates.length)];
    const willNoShow = random.next() < Number(options.noShowChance ?? 0.08);
    const result = bookReservation(state, {
      dayAbs,
      minute: slot.minute,
      name: `Online Golfer ${created.length + 1}`,
      partySize,
      holes: random.next() < 0.78 ? 18 : 9,
      transport: random.next() < 0.52 ? 'cart' : 'walking',
      paymentPreference: random.next() < 0.5 ? 'cash' : 'card',
      willNoShow,
      source: 'online',
      bankDeposit: calendarOf(nowOf(state)).minuteOfDay !== 0,
      deposit: r2((state.club?.greenFee || 0) * partySize * 0.25),
      arrivalOffsetMin: -20 + random.int(31),
    });
    if (result.ok) created.push(result.res);
  }
  return { created, attempts };
}

export function dueForArrivals(state, { at = nowOf(state) } = {}) {
  return bookOf(state).booked
    .filter((reservation) => reservation.status === 'booked'
      && reservation.arrivalStatus === 'scheduled'
      && at >= reservation.arrivalWindow.start)
    .sort((a, b) => a.arrivalWindow.start - b.arrivalWindow.start || a.id - b.id);
}

export function markReservationEnRoute(state, id, at = nowOf(state)) {
  const reservation = reservationById(state, id);
  if (!reservation || reservation.status !== 'booked') return { ok: false, reason: 'Reservation not found.' };
  if (reservation.arrivalStatus === 'en-route') return { ok: true, already: true, res: reservation };
  if (reservation.arrivalStatus !== 'scheduled' || at < reservation.arrivalWindow.start) {
    return { ok: false, reason: 'That arrival window has not started.' };
  }
  reservation.arrivalStatus = 'en-route';
  reservation.currentDestination = 'property';
  return { ok: true, res: reservation };
}

export function deskReservationList(state, presentReservationIds = []) {
  const present = new Set(presentReservationIds.map(String));
  const due = new Set(dueForCheckIn(state).map((reservation) => String(reservation.id)));
  return bookOf(state).booked
    .filter((reservation) => reservation.status === 'booked'
      && (due.has(String(reservation.id)) || present.has(String(reservation.id))))
    .sort((a, b) => a.teeTimeAbs - b.teeTimeAbs || a.id - b.id);
}

export function walkInAvailability(state, { dayAbs = calendarOf(nowOf(state)).dayAbs, partySize = 1, afterMinute = null } = {}) {
  const nowMinute = calendarOf(nowOf(state)).minuteOfDay;
  return availableSlots(state, dayAbs, { partySize, walkIn: true })
    .filter((slot) => slot.minute >= (afterMinute ?? nowMinute));
}

export function selectWalkInSlot(state, details = {}) {
  const dayAbs = Math.floor(details.dayAbs ?? calendarOf(nowOf(state)).dayAbs);
  const partySize = Math.floor(details.partySize ?? details.groupSize ?? 1);
  const minute = details.minute ?? walkInAvailability(state, { dayAbs, partySize })[0]?.minute;
  if (minute == null) return { ok: false, reason: 'No tee time is available.' };
  if (!walkInAvailability(state, { dayAbs, partySize, afterMinute: minute }).some((slot) => slot.minute === minute)) {
    return { ok: false, reason: 'That walk-in slot is not available.' };
  }
  return bookReservation(state, {
    ...details,
    dayAbs,
    minute,
    partySize,
    customerType: 'walk-in',
    walkIn: true,
    source: 'walk-in',
    arrivalStatus: 'arrived',
  });
}

export const bookWalkInSlot = selectWalkInSlot;

export function markReservationNoShow(state, id, { at = nowOf(state), reason = 'missed-tee-time', feeAmount = null } = {}) {
  const reservation = reservationById(state, id);
  if (!reservation) return { ok: false, reason: 'Reservation not found.' };
  if (reservation.status === 'noShow') return { ok: true, already: true, res: reservation };
  if (reservation.status !== 'booked') return { ok: false, reason: 'Only open bookings can become no-shows.' };
  reservation.status = 'noShow';
  reservation.arrival.status = 'no-show';
  reservation.arrivalStatus = 'no-show';
  reservation.noShow.markedAtMinute = at;
  reservation.noShowAt = at;
  reservation.noShowReason = reason;
  reservation.noShowFee = r2(Math.max(0, Number(feeAmount ?? reservation.noShowFee ?? 0)));
  reservation.noShowFeeStatus = reservation.noShowFee > 0 ? 'pending' : 'waived';
  reservation.noShowDepositCredit = r2(Math.min(reservation.depositPaid || 0, reservation.noShowFee));
  reservation.currentDestination = 'departed';
  return { ok: true, res: reservation };
}

export function chargeNoShowFee(state, id, { at = nowOf(state), amount = null, method = 'card-on-file' } = {}) {
  const reservation = reservationById(state, id);
  if (!reservation || reservation.status !== 'noShow') return { ok: false, reason: 'Only a no-show can be charged.' };
  const referenceId = reservationNoShowFeeReference(id);
  const existing = serviceTicketByReference(state, RESERVATION_NO_SHOW_FEE_TYPE, referenceId);
  if (reservation.noShowFeeReferenceId || ['charged', 'covered-by-deposit', 'waived'].includes(reservation.noShowFeeStatus)) {
    return { ok: true, already: true, amount: reservation.noShowFeeChargedAmount || 0, grossFee: reservation.noShowFee || 0, depositCredit: reservation.noShowDepositCredit || 0, res: reservation, ticket: existing };
  }
  const grossFee = r2(Math.max(0, Number(amount ?? reservation.noShowFee ?? 0)));
  const depositCredit = r2(Math.min(reservation.depositPaid || 0, grossFee));
  const amountToBank = r2(Math.max(0, grossFee - depositCredit));
  const banked = bankServiceCharge(state, {
    type: RESERVATION_NO_SHOW_FEE_TYPE,
    referenceId,
    revenueKey: 'greenFees',
    amount: amountToBank,
    customer: reservation.fullName || reservation.name,
    customerId: reservation.customerId,
    method,
    skuId: RESERVATION_NO_SHOW_FEE_SKU,
    itemName: 'Reservation No-Show Fee',
    minute: at,
    details: { reservationId: id, customerId: reservation.customerId, dayAbs: reservation.dayAbs, minute: reservation.minute, grossFee, depositCredit },
  });
  if (!banked.ok) return banked;
  reservation.noShowFee = grossFee;
  reservation.noShowDepositCredit = depositCredit;
  reservation.noShowFeeChargedAmount = amountToBank;
  reservation.noShowFeeReferenceId = referenceId;
  reservation.noShowFeeChargeKey = referenceId;
  reservation.noShowFeeTransactionNumber = banked.ticket.number;
  reservation.noShowFeeChargedAt = banked.ticket.minute ?? at;
  reservation.noShowFeeStatus = amountToBank > 0 ? 'charged' : 'covered-by-deposit';
  return { ok: true, already: !!banked.already, amount: amountToBank, grossFee, depositCredit, res: reservation, ticket: banked.ticket };
}

export const applyNoShowFee = chargeNoShowFee;

export function processReservationTimeline(state, { at = nowOf(state), chargeFees = false } = {}) {
  const deposits = [];
  const noShows = [];
  for (const reservation of bookOf(state).booked) {
    if (!reservation._compatEngine || reservation.status !== 'booked') continue;
    if (reservation.depositStatus === 'pending' && reservation.depositRequested > 0 && calendarOf(at).minuteOfDay !== 0) {
      const banked = bankReservationDeposit(state, reservation.id, { at });
      if (banked.ok && !banked.already) deposits.push(reservation);
    }
    if (reservation.arrivalStatus !== 'arrived'
      && reservation.checkInStatus !== 'waiting'
      && at > reservation.teeTimeAbs + reservationConfig(state).noShowGraceMin) {
      const marked = markReservationNoShow(state, reservation.id, { at });
      if (marked.ok && !marked.already) {
        noShows.push(reservation);
        if (chargeFees) chargeNoShowFee(state, reservation.id, { at });
      }
    }
  }
  golfOperationsTick(state, at);
  return { deposits, noShows };
}

export function resetGolfOperationsQA(state, options = {}) {
  const book = bookOf(state);
  // A fixture reset replaces the booking ledger, so its physical customer
  // arrivals must be retired at the same boundary. Leaving them scheduled
  // would let orphaned production parties consume the active-customer cap and
  // starve the deterministic (or any subsequently-created) reservation.
  for (const reservation of book.booked) cancelReservationCustomer(state, reservation.id);
  // The main ledger is intentionally immutable, so IDs that have already been
  // posted there must never be recycled by a fixture reset. Reusing (for
  // example) golf-pay-1 would make a later real-looking QA payment appear to be
  // an idempotent replay: the reservation subledger would advance while the
  // canonical cash ledger correctly refused the duplicate key. Keep every
  // identity sequence monotonic across resets just as save/load does.
  const nextSequences = {
    nextId: book.nextId,
    nextPartyId: book.nextPartyId,
    nextEventSeq: book.nextEventSeq,
    nextFinanceSeq: book.nextFinanceSeq,
    nextPaymentSeq: book.nextPaymentSeq,
    nextReceiptSeq: book.nextReceiptSeq,
  };
  // Browser evidence starts from a real production boot, whose online deposits
  // have already moved the shared wallet. Append explicit, exact-once reversals
  // before replacing the fixture so the immutable journal still reconciles.
  for (const entry of book.financeEntries) {
    if (entry.cashDelta > EPSILON) postLedgerEntry(state, {
      idempotencyKey: `golf-qa-reset:${entry.id}`,
      relatedId: entry.reservationId,
      direction: 'reversal',
      lineKey: entry.category,
      category: entry.category,
      accountingClass: 'revenue',
      amount: entry.cashDelta,
      cashImpact: -entry.cashDelta,
      profitImpact: -entry.cashDelta,
      aggregate: { side: 'revenue', key: entry.category, amount: -entry.cashDelta },
      description: `QA fixture reversal — ${entry.kind}`,
      source: 'golf-operations-qa',
    });
    else if (entry.cashDelta < -EPSILON) unbill(state, 'bookingRefunds', Math.abs(entry.cashDelta), {
      idempotencyKey: `golf-qa-reset:${entry.id}`,
      relatedId: entry.reservationId,
      description: `QA fixture refund reversal — ${entry.kind}`,
      source: 'golf-operations-qa',
    });
  }
  const reset = initReservations(state, options);
  for (const [key, value] of Object.entries(nextSequences)) {
    reset[key] = Math.max(reset[key], Number.isInteger(value) ? value : 1);
  }
  return reset;
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
