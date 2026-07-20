// FAIRWAY STATE - capacity-safe tee-time reservations and arrival scheduling.
//
// This module remains additive: it does not rewrite rounds or golfer demand. It
// owns the durable reservation record, tee-sheet capacity, arrival/no-show
// timeline, and the exact-once accounting markers used by check-in systems.

import { makeRng } from '../core/utils.js';
import { calendarOf } from './time.js';
import { addRevenue } from './economy.js';
import { genName } from '../data/names.js';
import { makeRng, rngOf } from '../core/utils.js';
import { allocateCustomerIdentity, recordCustomerVisit } from './customerIdentity.js';
import { drawPaymentMethod } from './paymentBag.js';
import { bankServiceCharge, serviceTicketByReference } from './register.js';

const MINUTES_PER_DAY = 24 * 60;
const ACTIVE_CAPACITY_STATUSES = new Set(['booked', 'played']);
const round2 = (value) => Math.round(Number(value) * 100) / 100;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Number(value)
  : fallback;
const integer = (value, fallback) => Number.isInteger(Number(value)) ? Number(value) : fallback;

export const TEE_SHEET = {
  openMin: 7 * 60,       // first tee time 7:00
  closeMin: 17 * 60,     // last slot starts 16:30
  stepMin: 30,
  horizonDays: 7,
  dueLeadMin: 45,        // compatibility lead for bookings made by bookSlot()
  arrivalLeadMin: 15,    // production online-arrival target
  arrivalWindowMin: 4,
  noShowGraceMin: 20,
  slotCapacity: 4,
  maxGroupSize: 4,
  noShowFeeRate: 0.25,
};

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

export function slotTimes() {
  const times = [];
  for (let m = TEE_SHEET.openMin; m < TEE_SHEET.closeMin; m += TEE_SHEET.stepMin) times.push(m);
  return times;
}

function defaultConfig() {
  return {
    slotCapacity: TEE_SHEET.slotCapacity,
    maxGroupSize: TEE_SHEET.maxGroupSize,
    arrivalLeadMin: TEE_SHEET.arrivalLeadMin,
    arrivalWindowMin: TEE_SHEET.arrivalWindowMin,
    noShowGraceMin: TEE_SHEET.noShowGraceMin,
    noShowFeeRate: TEE_SHEET.noShowFeeRate,
  };
}

function normalizeConfig(config = {}) {
  const defaults = defaultConfig();
  const slotCapacity = clamp(integer(
    config.slotCapacity ?? config.courseCapacity,
    defaults.slotCapacity,
  ), 1, 16);
  return {
    slotCapacity,
    maxGroupSize: clamp(integer(config.maxGroupSize, defaults.maxGroupSize), 1, slotCapacity),
    arrivalLeadMin: clamp(integer(config.arrivalLeadMin, defaults.arrivalLeadMin), 0, 120),
    arrivalWindowMin: clamp(integer(config.arrivalWindowMin, defaults.arrivalWindowMin), 0, 30),
    noShowGraceMin: clamp(integer(config.noShowGraceMin, defaults.noShowGraceMin), 0, 180),
    noShowFeeRate: clamp(finite(config.noShowFeeRate, defaults.noShowFeeRate), 0, 1),
  };
}

export function initReservations(state) {
  state.reservations = {
    version: 3,
    nextId: 1,
    nextCustomerId: 1,
    config: defaultConfig(),
    booked: [],
  };
}

const absoluteTeeTime = (dayAbs, minute) => dayAbs * MINUTES_PER_DAY + minute;

function statusCheckIn(status) {
  if (status === 'played') return 'checked-in';
  if (status === 'noShow') return 'missed';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}

function statusArrival(status) {
  if (status === 'played') return 'arrived';
  if (status === 'noShow') return 'no-show';
  if (status === 'cancelled') return 'cancelled';
  return 'scheduled';
}

function migrateReservation(record, config, sourceVersion = 1) {
  const r = record;
  const dayAbs = integer(r.dayAbs, 0);
  const minute = integer(
    typeof r.teeTime === 'number' ? r.teeTime : r.teeTime?.minute,
    integer(r.minute, TEE_SHEET.openMin),
  );
  r.dayAbs = dayAbs;
  r.minute = minute;
  r.reservationId ??= r.id;
  r.customerId ??= `reservation-customer-${String(r.id)}`;
  r.name = String(r.name ?? r.fullName ?? 'Unknown Golfer').trim() || 'Unknown Golfer';
  r.fullName ??= r.name;
  r.groupSize = clamp(integer(r.groupSize ?? r.partySize, config.slotCapacity), 1, config.slotCapacity);
  r.partySize = r.groupSize;
  if (!Array.isArray(r.groupMembers)) r.groupMembers = [];
  r.teeTime = minute;
  r.teeTimeAbs = absoluteTeeTime(dayAbs, minute);
  r.fee = round2(finite(r.fee, 0));
  const legacyDeposit = round2(clamp(finite(r.deposit, 0), 0, r.fee));
  r.depositRequested = round2(clamp(finite(r.depositRequested, legacyDeposit), 0, r.fee));
  r.depositPaid = round2(clamp(finite(r.depositPaid, legacyDeposit), 0, r.fee));
  r.deposit = r.depositPaid; // compatibility alias: money already credited to this booking
  r.depositReferenceId ??= null;
  r.depositTransactionNumber ??= null;
  r.depositPaidAt ??= null;
  r.depositPaymentMethod ??= null;
  r.depositRequestedMethod ??= r.depositPaymentMethod || 'online-card';
  if (r.depositStatus == null) {
    if (r.depositPaid <= 0) r.depositStatus = r.depositRequested > 0 ? 'pending' : 'none';
    else if (sourceVersion < 3 || !r.depositReferenceId) r.depositStatus = 'legacy-untracked';
    else r.depositStatus = 'paid';
  }
  if (r.depositPaid > 0 && r.depositStatus === 'none' && !r.depositReferenceId) {
    r.depositStatus = 'legacy-untracked';
  }
  const isLegacyBalance = (r.source == null || r.source === 'legacy' || r.source === 'manual-legacy')
    && r.balanceDue == null;
  if (!isLegacyBalance) r.balanceDue = round2(clamp(finite(r.balanceDue, r.fee - r.depositPaid), 0, r.fee));
  const effectiveBalance = r.balanceDue == null ? round2(r.fee - r.depositPaid) : r.balanceDue;
  r.remainingBalance = effectiveBalance;
  r.paymentStatus ??= effectiveBalance <= 0 ? 'paid' : r.deposit > 0 ? 'deposit-paid' : 'unpaid';
  r.paymentPreference ??= null;
  r.status ??= 'booked';
  r.reservationStatus = r.status;
  if (r.status !== 'booked' || r.checkInStatus == null) r.checkInStatus = statusCheckIn(r.status);
  if (r.status === 'played') {
    r.paymentStatus = 'paid';
    r.balanceDue = 0;
    r.remainingBalance = 0;
  }
  r.customerType ??= 'reservation';
  r.source ??= 'legacy';
  r.holes = r.holes === 9 ? 9 : 18;
  r.transport = r.transport === 'cart' ? 'cart' : 'walking';
  if (!Array.isArray(r.rentalRequirements)) r.rentalRequirements = [];
  r.patience = clamp(finite(r.patience, 0.65), 0, 1);
  r.punctuality = clamp(finite(r.punctuality, 0.5), 0, 1);
  r.reviewPersonality ??= 'balanced';
  r.currentDestination ??= r.status === 'played' ? 'course' : r.status === 'booked' ? 'offsite' : 'departed';

  // Old snapshots used the 45-minute due window. Keep that stable on migration;
  // new online reservations use the 15-minute production planner below.
  r.plannedArrival ??= r.teeTimeAbs - TEE_SHEET.dueLeadMin;
  const halfWindow = Math.ceil(config.arrivalWindowMin / 2);
  if (!r.arrivalWindow || !Number.isFinite(r.arrivalWindow.start) || !Number.isFinite(r.arrivalWindow.end)) {
    r.arrivalWindow = { start: r.plannedArrival - halfWindow, end: r.plannedArrival + halfWindow };
  }
  r.arrivalTime ??= r.arrivedAt ?? null;
  r.arrivalStatus ??= statusArrival(r.status);
  r.arrivedAt ??= r.arrivalTime;
  r.checkedInAt ??= null;
  r.noShowAt ??= null;
  r.noShowReason ??= null;
  r.noShowFee = round2(Math.max(0, finite(r.noShowFee, r.fee * config.noShowFeeRate)));
  r.noShowFeeStatus ??= r.noShowFeeChargedAt != null
    ? 'charged'
    : r.status === 'noShow' && r.noShowFee > 0 ? 'pending' : r.status === 'noShow' ? 'waived' : 'not-due';
  r.noShowFeeChargedAt ??= null;
  r.noShowFeeChargeKey ??= null;
  r.noShowFeeReferenceId ??= r.noShowFeeChargeKey;
  r.noShowFeeTransactionNumber ??= null;
  r.noShowFeePaymentMethod ??= null;
  r.noShowFeeChargedAmount = round2(Math.max(0, finite(r.noShowFeeChargedAmount,
    r.noShowFeeStatus === 'charged' ? r.noShowFee : 0)));
  r.noShowDepositCredit = round2(Math.max(0, finite(r.noShowDepositCredit, 0)));
  if (sourceVersion < 3 && r.noShowFeeStatus === 'charged' && !r.noShowFeeTransactionNumber) {
    r.noShowFeeProvenance ??= 'legacy-direct';
  }
  r.createdAt ??= null;
  r.cancelledAt ??= null;
  r.willNoShow = Boolean(r.willNoShow);
  return r;
}

export function ensureReservations(state) {
  if (!state.reservations || typeof state.reservations !== 'object') initReservations(state);
  const book = state.reservations;
  if (!Array.isArray(book.booked)) book.booked = [];
  const sourceVersion = integer(book.version, 1);
  book.version = 3;
  book.config = normalizeConfig(book.config);

  let maxId = 0;
  let maxCustomerSequence = 0;
  for (const r of book.booked) {
    if (!Number.isInteger(r.id) || r.id <= 0) r.id = maxId + 1;
    maxId = Math.max(maxId, r.id);
    migrateReservation(r, book.config, sourceVersion);
    const match = /^customer-(\d+)$/.exec(String(r.customerId));
    if (match) maxCustomerSequence = Math.max(maxCustomerSequence, Number(match[1]));
  }
  book.nextId = Math.max(integer(book.nextId, 1), maxId + 1);
  book.nextCustomerId = Math.max(integer(book.nextCustomerId, 1), maxCustomerSequence + 1);
  return book;
}

const bookOf = (state) => ensureReservations(state);

export function reservationConfig(state) {
  return { ...bookOf(state).config };
}

export function configureReservations(state, patch = {}) {
  const book = bookOf(state);
  const merged = { ...book.config, ...patch };
  if (patch.courseCapacity != null && patch.slotCapacity == null) merged.slotCapacity = patch.courseCapacity;
  book.config = normalizeConfig(merged);
  return { ...book.config };
}

export function reservationById(state, id) {
  return bookOf(state).booked.find((r) => r.id === id || r.reservationId === id) || null;
}

function consumesCapacity(reservation) {
  return ACTIVE_CAPACITY_STATUSES.has(reservation.status);
}

export function slotLoad(state, dayAbs, minute) {
  const book = bookOf(state);
  const reservations = book.booked.filter((r) =>
    r.dayAbs === dayAbs && r.minute === minute && consumesCapacity(r));
  const bookedPlayers = reservations.reduce((sum, r) => sum + clamp(integer(r.groupSize, 1), 1, book.config.slotCapacity), 0);
  return {
    dayAbs,
    minute,
    capacity: book.config.slotCapacity,
    bookedPlayers,
    remainingCapacity: Math.max(0, book.config.slotCapacity - bookedPlayers),
    reservations,
  };
}

export function slotAvailability(state, dayAbs, minute, partySize = 1) {
  const load = slotLoad(state, dayAbs, minute);
  const size = integer(partySize, 1);
  const validTime = slotTimes().includes(minute);
  const validParty = size > 0 && size <= bookOf(state).config.maxGroupSize;
  return {
    ...load,
    partySize: size,
    validTime,
    validParty,
    available: validTime && validParty && load.remainingCapacity >= size,
  };
}

// Compatibility calendar: `res` remains the first visible holder. Capacity-aware
// consumers can use `reservations`, `bookedPlayers`, and `remainingCapacity`.
export function daySheet(state, dayAbs) {
  const book = bookOf(state);
  return slotTimes().map((minute) => {
    const visible = book.booked.filter((r) => r.dayAbs === dayAbs && r.minute === minute && r.status !== 'cancelled');
    const load = slotLoad(state, dayAbs, minute);
    return {
      minute,
      res: visible[0] || null,
      reservations: visible,
      bookedPlayers: load.bookedPlayers,
      remainingCapacity: load.remainingCapacity,
      capacity: load.capacity,
      available: load.remainingCapacity > 0,
    };
  });
}

function bookingValidation(state, dayAbs, minute, name, partySize) {
  const config = bookOf(state).config;
  const todayAbs = calendarOf(state.clock.minutes).dayAbs;
  if (!name || !String(name).trim()) return { ok: false, reason: 'A booking needs a name.' };
  if (dayAbs < todayAbs) return { ok: false, reason: 'That day is already gone.' };
  if (dayAbs > todayAbs + TEE_SHEET.horizonDays) return { ok: false, reason: `The sheet only opens ${TEE_SHEET.horizonDays} days out.` };
  if (!slotTimes().includes(minute)) return { ok: false, reason: 'Not a tee time on the sheet.' };
  if (!Number.isInteger(partySize) || partySize < 1) return { ok: false, reason: 'A group needs at least one golfer.' };
  if (partySize > config.maxGroupSize) return { ok: false, reason: `Groups are limited to ${config.maxGroupSize} golfers.` };
  const availability = slotAvailability(state, dayAbs, minute, partySize);
  if (!availability.available) {
    return {
      ok: false,
      reason: availability.remainingCapacity === 0
        ? 'That tee time is taken.'
        : `That tee time only has room for ${availability.remainingCapacity}.`,
    };
  }
  return { ok: true };
}

function allocateCustomerId(book) {
  let id;
  do id = `customer-${book.nextCustomerId++}`;
  while (book.booked.some((r) => r.customerId === id));
  return id;
}

function normalizePaymentPreference(value) {
  return value === 'card' || value === 'cash' ? value : null;
}

export function planReservationArrival(reservation, {
  rng = null,
  arrivalLeadMin = TEE_SHEET.arrivalLeadMin,
  arrivalWindowMin = TEE_SHEET.arrivalWindowMin,
  travelVariationMin = null,
  weatherSeverity = 0,
  weatherDelayMin = null,
  parkingAvailability = 1,
  parkingDelayMin = null,
  punctuality = reservation.punctuality ?? 0.5,
  personality = reservation.arrivalPersonality ?? 'punctual',
} = {}) {
  const random = normalizeRng(rng || makeRng((reservation.id || 1) * 2654435761));
  const travel = travelVariationMin == null ? Math.round(random.range(-5, 6)) : finite(travelVariationMin, 0);
  const weather = weatherDelayMin == null ? clamp(finite(weatherSeverity, 0), 0, 1) * 6 : finite(weatherDelayMin, 0);
  const parking = parkingDelayMin == null ? (1 - clamp(finite(parkingAvailability, 1), 0, 1)) * 6 : finite(parkingDelayMin, 0);
  const personalityOffset = personality === 'early' ? -5 : personality === 'relaxed' ? 3 : personality === 'rushed' ? 7 : -1;
  const punctualityOffset = (0.5 - clamp(finite(punctuality, 0.5), 0, 1)) * 10;
  const smallVariation = random.range(-1.5, 1.5);
  const teeTimeAbs = absoluteTeeTime(reservation.dayAbs, reservation.minute);
  const plannedArrival = clamp(
    Math.round(teeTimeAbs - arrivalLeadMin + travel + weather + parking + personalityOffset + punctualityOffset + smallVariation),
    teeTimeAbs - 30,
    teeTimeAbs + 10,
  );
  const halfWindow = Math.ceil(clamp(integer(arrivalWindowMin, 4), 0, 30) / 2);
  return {
    plannedArrival,
    arrivalWindow: { start: plannedArrival - halfWindow, end: plannedArrival + halfWindow },
    factors: {
      targetLeadMin: arrivalLeadMin,
      travelVariationMin: travel,
      weatherDelayMin: round2(weather),
      parkingDelayMin: round2(parking),
      personality,
      punctuality: clamp(finite(punctuality, 0.5), 0, 1),
    },
  };
}

export function bookReservation(state, details = {}) {
  const book = bookOf(state);
  const dayAbs = integer(details.dayAbs, NaN);
  const minute = integer(details.minute ?? details.teeTime, NaN);
  const name = String(details.fullName ?? details.name ?? '').trim();
  const partySize = integer(details.groupSize ?? details.partySize, 1);
  const valid = bookingValidation(state, dayAbs, minute, name, partySize);
  if (!valid.ok) return valid;

  const feePerGolfer = round2(finite(details.feePerGolfer, state.club ? state.club.greenFee : 0));
  const fee = round2(finite(details.totalFee ?? details.fee, feePerGolfer * partySize));
  const requestedDeposit = round2(clamp(finite(details.deposit, 0), 0, fee));
  const id = book.nextId++;
  const legacyCustomerId = details.customerId == null || String(details.customerId).trim() === ''
    ? null
    : String(details.customerId);
  const identity = details.customerIdentity || allocateCustomerIdentity(state, {
    sourceId: `reservation:${id}`,
    legacy: {
      ...(details.customer || {}),
      ...(legacyCustomerId ? { customerId: legacyCustomerId } : {}),
      name,
      paymentPreference: normalizePaymentPreference(details.paymentPreference) || undefined,
    },
  });
  const primaryName = identity.fullName;
  const suppliedMembers = Array.isArray(details.groupMembers) ? [...details.groupMembers] : [];
  const groupMembers = suppliedMembers.length ? suppliedMembers : [{
    customerId: identity.customerId,
    fullName: primaryName,
    name: primaryName,
    role: 'booking-contact',
  }];
  for (let memberIndex = groupMembers.length; memberIndex < partySize; memberIndex += 1) {
    const member = allocateCustomerIdentity(state, { sourceId: `reservation:${id}:member:${memberIndex}` });
    groupMembers.push({
      customerId: member.customerId,
      fullName: member.fullName,
      name: member.fullName,
      role: 'golfer',
    });
  }
  const res = {
    id,
    reservationId: id,
    customerId: identity.customerId,
    name: primaryName,
    fullName: primaryName,
    groupMembers,
    groupSize: partySize,
    partySize,
    dayAbs,
    minute,
    teeTime: minute,
    teeTimeAbs: absoluteTeeTime(dayAbs, minute),
    holes: details.holes === 9 ? 9 : 18,
    transport: details.transport === 'cart' ? 'cart' : 'walking',
    rentalRequirements: Array.isArray(details.rentalRequirements) ? [...details.rentalRequirements] : [],
    fee,
    depositRequested: requestedDeposit,
    deposit: 0,
    depositPaid: 0,
    depositStatus: requestedDeposit > 0 ? 'pending' : 'none',
    depositReferenceId: null,
    depositTransactionNumber: null,
    depositPaidAt: null,
    depositPaymentMethod: null,
    depositRequestedMethod: details.depositPaymentMethod || 'online-card',
    balanceDue: fee,
    remainingBalance: fee,
    paymentStatus: 'unpaid',
    paymentPreference: normalizePaymentPreference(details.paymentPreference) || identity.paymentPreference,
    status: 'booked',
    reservationStatus: 'booked',
    checkInStatus: 'pending',
    customerType: details.customerType || 'reservation',
    source: details.source || 'manual',
    personality: identity.personality,
    patience: clamp(finite(details.patience, identity.patience), 0, 1),
    punctuality: clamp(finite(details.punctuality, identity.punctuality), 0, 1),
    travelDistance: identity.travelDistance,
    parkingSensitivity: identity.parkingSensitivity,
    weatherSensitivity: identity.weatherSensitivity,
    loungePreference: identity.loungePreference,
    reviewPersonality: details.reviewPersonality || identity.personality,
    arrivalPersonality: details.arrivalPersonality
      || (identity.personality === 'hurried' ? 'rushed'
        : identity.personality === 'relaxed' ? 'relaxed'
          : identity.punctuality > 0.72 ? 'early' : 'punctual'),
    currentDestination: details.currentDestination || 'offsite',
    arrivalStatus: details.arrivalStatus || 'scheduled',
    arrivalTime: details.arrivedAt ?? null,
    arrivedAt: details.arrivedAt ?? null,
    checkedInAt: null,
    createdAt: details.createdAt ?? (state.clock ? state.clock.minutes : null),
    cancelledAt: null,
    noShowAt: null,
    noShowReason: null,
    noShowFee: round2(Math.max(0, finite(details.noShowFee, fee * book.config.noShowFeeRate))),
    noShowFeeStatus: 'not-due',
    noShowFeeChargedAt: null,
    noShowFeeChargeKey: null,
    noShowFeeReferenceId: null,
    noShowFeeTransactionNumber: null,
    noShowFeePaymentMethod: null,
    noShowFeeChargedAmount: 0,
    noShowDepositCredit: 0,
    willNoShow: Boolean(details.willNoShow),
  };

  const arrival = planReservationArrival(res, {
    rng: details.rng,
    arrivalLeadMin: details.arrivalLeadMin ?? book.config.arrivalLeadMin,
    arrivalWindowMin: details.arrivalWindowMin ?? book.config.arrivalWindowMin,
    travelVariationMin: details.travelVariationMin
      ?? round2((identity.travelDistance - 25) / 12),
    weatherSeverity: details.weatherSeverity,
    weatherDelayMin: details.weatherDelayMin
      ?? round2(clamp(finite(details.weatherSeverity, 0), 0, 1) * identity.weatherSensitivity * 8),
    parkingAvailability: details.parkingAvailability,
    parkingDelayMin: details.parkingDelayMin
      ?? round2((1 - clamp(finite(details.parkingAvailability, 1), 0, 1)) * identity.parkingSensitivity * 8),
    punctuality: res.punctuality,
    personality: res.arrivalPersonality,
  });
  res.plannedArrival = details.plannedArrival ?? arrival.plannedArrival;
  res.arrivalWindow = details.arrivalWindow
    ? { start: details.arrivalWindow.start, end: details.arrivalWindow.end }
    : arrival.arrivalWindow;
  res.arrivalFactors = arrival.factors;
  book.booked.push(res);
  let depositResult = null;
  const createdAtRollover = state.clock && calendarOf(state.clock.minutes).minuteOfDay === 0;
  if (requestedDeposit > 0 && details.bankDeposit !== false && !createdAtRollover) {
    depositResult = bankReservationDeposit(state, res.id, {
      amount: requestedDeposit,
      method: details.depositPaymentMethod || 'online-card',
      at: details.depositPaidAt ?? (state.clock ? state.clock.minutes : null),
    });
    if (!depositResult.ok) {
      const index = book.booked.indexOf(res);
      if (index >= 0) book.booked.splice(index, 1);
      return { ok: false, reason: depositResult.reason, depositResult };
    }
  }
  return { ok: true, res, depositResult };
}

// The legacy exact-slot API still consumes a complete tee-time unless callers
// explicitly provide a party size. Existing saves/UI therefore cannot begin
// double-booking after this capacity expansion.
export function bookSlot(state, dayAbs, minute, nameOrDetails, options = {}) {
  const suppliedDetails = nameOrDetails && typeof nameOrDetails === 'object'
    ? { ...nameOrDetails }
    : { ...options, name: nameOrDetails };
  const explicitParty = suppliedDetails.groupSize != null || suppliedDetails.partySize != null;
  const partySize = explicitParty
    ? integer(suppliedDetails.groupSize ?? suppliedDetails.partySize, 1)
    : bookOf(state).config.slotCapacity;
  const legacyFee = state.club ? state.club.greenFee : 0;
  const legacyArrival = absoluteTeeTime(dayAbs, minute) - TEE_SHEET.dueLeadMin;
  const result = bookReservation(state, {
    ...suppliedDetails,
    dayAbs,
    minute,
    partySize,
    totalFee: suppliedDetails.totalFee ?? suppliedDetails.fee ?? (explicitParty ? legacyFee * partySize : legacyFee),
    source: suppliedDetails.source || 'manual-legacy',
    bankDeposit: false,
    plannedArrival: suppliedDetails.plannedArrival ?? legacyArrival,
    arrivalWindow: suppliedDetails.arrivalWindow ?? { start: legacyArrival, end: legacyArrival },
    arrivalLeadMin: suppliedDetails.arrivalLeadMin ?? TEE_SHEET.dueLeadMin,
    travelVariationMin: suppliedDetails.travelVariationMin ?? 0,
    weatherDelayMin: suppliedDetails.weatherDelayMin ?? 0,
    parkingDelayMin: suppliedDetails.parkingDelayMin ?? 0,
    arrivalPersonality: suppliedDetails.arrivalPersonality || 'punctual',
    punctuality: suppliedDetails.punctuality ?? 0.4,
    rng: suppliedDetails.rng || makeRng(1),
  });
  if (result.ok && suppliedDetails.balanceDue == null) {
    // Preserve the original exact-slot contract: its amount is derived from
    // `fee`, so fee tampering is still detected by the check-in adapter.
    result.res.remainingBalance = round2(result.res.fee - result.res.deposit);
    delete result.res.balanceDue;
  }
  return result;
}

export function bankReservationDeposit(state, id, {
  amount = null,
  method = 'online-card',
  at = state.clock ? state.clock.minutes : null,
} = {}) {
  const res = reservationById(state, id);
  if (!res) return { ok: false, reason: 'Reservation not found.' };
  const referenceId = reservationDepositReference(res.id);
  const existingTicket = serviceTicketByReference(state, RESERVATION_DEPOSIT_TYPE, referenceId);
  if (existingTicket && (
    round2(existingTicket.total) !== round2(res.depositPaid || res.depositRequested)
    || (res.depositTransactionNumber != null && existingTicket.number !== res.depositTransactionNumber)
  )) {
    return { ok: false, reason: 'The saved deposit ticket does not match this reservation.' };
  }

  // Version-2 saves may contain a balance already reduced by a deposit even
  // though the old engine never wrote a ticket. Never charge that money again.
  if (res.depositStatus === 'legacy-untracked' && res.depositPaid > 0) {
    return { ok: true, already: true, legacy: true, amount: res.depositPaid, res, ticket: null };
  }
  if (res.depositStatus === 'paid' || res.depositReferenceId) {
    return {
      ok: true,
      already: true,
      amount: res.depositPaid,
      res,
      ticket: existingTicket,
    };
  }
  if (res.status !== 'booked') return { ok: false, reason: 'Only an open booking can take a deposit.' };

  const depositAmount = round2(clamp(finite(amount, res.depositRequested), 0, res.fee));
  if (depositAmount <= 0) {
    res.depositStatus = 'none';
    res.depositRequested = 0;
    res.deposit = 0;
    res.depositPaid = 0;
    return { ok: true, already: false, amount: 0, res, ticket: null };
  }
  if (existingTicket && round2(existingTicket.total) !== depositAmount) {
    return { ok: false, reason: 'The saved deposit ticket does not match this reservation.' };
  }

  const banked = bankServiceCharge(state, {
    type: RESERVATION_DEPOSIT_TYPE,
    referenceId,
    revenueKey: 'greenFees',
    amount: depositAmount,
    customer: res.fullName || res.name,
    customerId: res.customerId || null,
    method,
    skuId: RESERVATION_DEPOSIT_SKU,
    itemName: 'Reservation Deposit',
    minute: at,
    details: {
      reservationId: res.id,
      customerId: res.customerId || null,
      dayAbs: res.dayAbs,
      minute: res.minute,
      totalFee: res.fee,
    },
  });
  if (!banked.ok) return banked;
  if (round2(banked.ticket.total) !== depositAmount) {
    return { ok: false, reason: 'The saved deposit ticket does not match this reservation.' };
  }

  res.depositRequested = depositAmount;
  res.deposit = depositAmount;
  res.depositPaid = depositAmount;
  res.depositStatus = 'paid';
  res.depositReferenceId = referenceId;
  res.depositTransactionNumber = banked.ticket.number;
  res.depositPaidAt = banked.ticket.minute ?? at;
  res.depositPaymentMethod = banked.ticket.method;
  res.balanceDue = round2(Math.max(0, res.fee - depositAmount));
  res.remainingBalance = res.balanceDue;
  res.paymentStatus = res.balanceDue <= 0 ? 'paid' : 'deposit-paid';
  return {
    ok: true,
    already: Boolean(banked.already),
    amount: depositAmount,
    res,
    ticket: banked.ticket,
  };
}

export function cancelReservation(state, id) {
  const res = reservationById(state, id);
  if (!res || res.status !== 'booked') return { ok: false };
  res.status = 'cancelled';
  res.reservationStatus = 'cancelled';
  res.checkInStatus = 'cancelled';
  res.arrivalStatus = 'cancelled';
  res.currentDestination = 'departed';
  res.cancelledAt = state.clock ? state.clock.minutes : null;
  if (!res.visitHistoryRecorded && res.customerId) {
    const recorded = recordCustomerVisit(state, res.customerId, {
      dayAbs: res.dayAbs,
      purpose: 'tee-time',
      outcome: 'cancelled',
    });
    if (recorded.ok) res.visitHistoryRecorded = true;
  }
  return { ok: true, res };
}

function normalizeRng(rng) {
  if (typeof rng === 'function') {
    return {
      next: rng,
      int: (n) => Math.floor(rng() * n),
      range: (min, max) => min + rng() * (max - min),
      chance: (p) => rng() < p,
    };
  }
  if (rng && typeof rng.next === 'function') {
    return {
      next: () => rng.next(),
      int: typeof rng.int === 'function' ? (n) => rng.int(n) : (n) => Math.floor(rng.next() * n),
      range: typeof rng.range === 'function' ? (min, max) => rng.range(min, max) : (min, max) => min + rng.next() * (max - min),
      chance: typeof rng.chance === 'function' ? (p) => rng.chance(p) : (p) => rng.next() < p,
    };
  }
  return normalizeRng(makeRng(1));
}

function reservationRng(state, supplied) {
  if (supplied) return normalizeRng(supplied);
  if (Number.isFinite(state.rngState)) return normalizeRng(rngOf(state));
  return normalizeRng(makeRng(integer(state.seed, 1)));
}

function uniqueName(state, random, nameFactory, index) {
  const used = new Set(bookOf(state).booked.map((r) => String(r.fullName || r.name).toLowerCase()));
  let candidate = '';
  for (let attempt = 0; attempt < 64; attempt++) {
    candidate = String(nameFactory
      ? nameFactory({ state, rng: random, index, attempt })
      : genName(random)).trim();
    if (candidate && !used.has(candidate.toLowerCase())) return candidate;
  }
  const parts = (candidate || 'Guest Golfer').split(/\s+/);
  const first = parts.shift() || 'Guest';
  const last = parts.pop() || 'Golfer';
  for (let suffix = 0; suffix < 26; suffix++) {
    const distinct = `${first} ${String.fromCharCode(65 + suffix)}. ${last}`;
    if (!used.has(distinct.toLowerCase())) return distinct;
  }
  return `${first} ${bookOf(state).nextCustomerId} ${last}`;
}

function inferredWeatherSeverity(state) {
  const today = state.weather && state.weather.today ? state.weather.today : {};
  if (Number.isFinite(today.severity)) return clamp(today.severity, 0, 1);
  const rain = Math.max(0, finite(today.rainIn, 0));
  const wind = Math.max(0, finite(today.windMph, 0));
  return clamp(rain / 0.8 + wind / 50, 0, 1);
}

export function generateOnlineReservations(state, {
  dayAbs = calendarOf(state.clock.minutes).dayAbs + 1,
  count = 1,
  rng = null,
  nameFactory = null,
  minGroupSize = 1,
  maxGroupSize = null,
  weatherSeverity = null,
  parkingAvailability = 1,
  noShowChance = 0.08,
} = {}) {
  const book = bookOf(state);
  const random = reservationRng(state, rng);
  const minSize = clamp(integer(minGroupSize, 1), 1, book.config.maxGroupSize);
  const maxSize = clamp(integer(maxGroupSize, book.config.maxGroupSize), minSize, book.config.maxGroupSize);
  const created = [];
  const rejected = [];

  for (let index = 0; index < Math.max(0, integer(count, 0)); index++) {
    let partySize = minSize + random.int(maxSize - minSize + 1);
    let candidates = slotTimes().filter((minute) => slotAvailability(state, dayAbs, minute, partySize).available);
    if (!candidates.length) {
      candidates = slotTimes().filter((minute) => slotAvailability(state, dayAbs, minute, 1).available);
      if (!candidates.length) {
        rejected.push({ index, reason: 'No tee-time capacity remains.' });
        break;
      }
      const maxRemaining = Math.max(...candidates.map((minute) => slotLoad(state, dayAbs, minute).remainingCapacity));
      partySize = clamp(partySize, 1, maxRemaining);
      candidates = candidates.filter((minute) => slotAvailability(state, dayAbs, minute, partySize).available);
    }

    const minute = candidates[random.int(candidates.length)];
    const name = uniqueName(state, random, nameFactory, index);
    const personality = random.chance(0.2) ? 'early' : random.chance(0.2) ? 'relaxed' : 'punctual';
    const punctuality = personality === 'early' ? random.range(0.72, 0.96)
      : personality === 'relaxed' ? random.range(0.25, 0.55) : random.range(0.5, 0.82);
    // Drawn from the balanced shuffled bag so counter payments stay 50/50 over
    // every complete batch; the preference sticks to the reservation for life.
    const paymentPreference = drawPaymentMethod(state, () => random.range(0, 1));
    const holes = random.chance(0.78) ? 18 : 9;
    const transport = random.chance(0.52) ? 'cart' : 'walking';
    const rentalRequirements = random.chance(0.16) ? ['clubs'] : [];
    const totalFee = round2((state.club ? state.club.greenFee : 0) * partySize);
    const deposit = round2(totalFee * 0.25);
    const result = bookReservation(state, {
      dayAbs,
      minute,
      name,
      partySize,
      totalFee,
      deposit,
      holes,
      transport,
      rentalRequirements,
      paymentPreference,
      source: 'online',
      customerType: 'reservation',
      patience: random.range(0.45, 0.95),
      punctuality,
      reviewPersonality: random.chance(0.2) ? 'critical' : random.chance(0.4) ? 'enthusiastic' : 'balanced',
      arrivalPersonality: personality,
      weatherSeverity: weatherSeverity == null ? inferredWeatherSeverity(state) : weatherSeverity,
      parkingAvailability,
      willNoShow: random.chance(clamp(finite(noShowChance, 0.08), 0, 1)),
      rng: random,
    });
    if (result.ok) created.push(result.res);
    else rejected.push({ index, reason: result.reason });
  }
  return { ok: rejected.length === 0, created, rejected };
}

export function availableSlots(state, dayAbs, {
  partySize = 1,
  notBeforeMinute = null,
} = {}) {
  return slotTimes()
    .filter((minute) => notBeforeMinute == null || minute >= notBeforeMinute)
    .map((minute) => slotAvailability(state, dayAbs, minute, partySize))
    .filter((slot) => slot.available);
}

export function walkInAvailability(state, {
  dayAbs = calendarOf(state.clock.minutes).dayAbs,
  partySize = 1,
  notBeforeMinute = null,
} = {}) {
  const cal = calendarOf(state.clock.minutes);
  const floor = notBeforeMinute == null && dayAbs === cal.dayAbs ? cal.minuteOfDay : notBeforeMinute;
  return availableSlots(state, dayAbs, { partySize, notBeforeMinute: floor });
}

export function selectWalkInSlot(state, details = {}) {
  const cal = calendarOf(state.clock.minutes);
  const dayAbs = integer(details.dayAbs, cal.dayAbs);
  const minute = integer(details.minute ?? details.teeTime, NaN);
  if (dayAbs === cal.dayAbs && minute < cal.minuteOfDay) {
    return { ok: false, reason: 'That tee time has already passed.' };
  }
  const now = state.clock ? state.clock.minutes : absoluteTeeTime(dayAbs, cal.minuteOfDay);
  const result = bookReservation(state, {
    ...details,
    dayAbs,
    minute,
    customerType: 'walk-in',
    source: 'walk-in',
    arrivalStatus: 'arrived',
    arrivedAt: now,
    currentDestination: 'front-desk',
    plannedArrival: now,
    arrivalWindow: { start: now, end: now },
    arrivalLeadMin: 0,
    travelVariationMin: 0,
    weatherDelayMin: 0,
    parkingDelayMin: 0,
  });
  if (result.ok) {
    result.res.arrivalStatus = 'arrived';
    result.res.arrivalTime = now;
    result.res.arrivedAt = now;
    result.res.currentDestination = 'front-desk';
  }
  return result;
}

export const bookWalkInSlot = selectWalkInSlot;

export function dueForArrivals(state, { at = state.clock.minutes } = {}) {
  return bookOf(state).booked
    .filter((r) => r.status === 'booked'
      && r.arrivalStatus === 'scheduled'
      && !r.willNoShow
      && at >= r.arrivalWindow.start)
    .sort((a, b) => a.plannedArrival - b.plannedArrival || a.id - b.id);
}

export function markReservationEnRoute(state, id, at = state.clock.minutes) {
  const res = reservationById(state, id);
  if (!res || res.status !== 'booked') return { ok: false, reason: 'No open booking under that name.' };
  if (res.arrivalStatus === 'arrived') return { ok: true, already: true, res };
  if (res.arrivalStatus !== 'scheduled' && res.arrivalStatus !== 'en-route') return { ok: false, reason: 'That customer cannot begin this trip.' };
  if (res.arrivalStatus === 'scheduled' && at < res.arrivalWindow.start) {
    return { ok: false, reason: 'That customer has not reached their arrival window.' };
  }
  res.arrivalStatus = 'en-route';
  res.departedForCourseAt ??= at;
  res.currentDestination = 'clubhouse';
  return { ok: true, res };
}

export function markReservationArrived(state, id, at = state.clock.minutes, destination = 'front-desk') {
  const res = reservationById(state, id);
  if (!res || res.status !== 'booked') return { ok: false, reason: 'No open booking under that name.' };
  if (res.arrivalStatus === 'arrived') return { ok: true, already: true, res };
  if (res.arrivalStatus === 'no-show' || res.arrivalStatus === 'cancelled') return { ok: false, reason: 'That customer is no longer expected.' };
  if (res.arrivalStatus === 'scheduled' && at < res.arrivalWindow.start) {
    return { ok: false, reason: 'That customer has not reached their arrival window.' };
  }
  res.arrivalStatus = 'arrived';
  res.arrivalTime = at;
  res.arrivedAt = at;
  res.currentDestination = destination;
  res.checkInStatus = 'waiting';
  return { ok: true, res };
}

// Compatibility list used by the current desk. Legacy manual bookings retain
// their 45-minute lead; online bookings appear around their persisted plan.
export function dueForCheckIn(state) {
  const at = state.clock.minutes;
  const cal = calendarOf(at);
  return bookOf(state).booked.filter((r) =>
    r.status === 'booked'
    && r.dayAbs === cal.dayAbs
    && !r.willNoShow
    && (r.arrivalStatus === 'arrived' || at >= r.plannedArrival));
}

// THE DESK LIST the front-of-house monitor shows: everyone due by the book PLUS anyone
// physically standing in the shop with a live booking for today. dueForCheckIn alone hides a
// guest who walks in ahead of their planned arrival (their arrivalStatus is still 'scheduled'
// and the clock has not reached plannedArrival) — which is exactly the person at the counter
// asking why the computer can't see their 1:30. Physical presence outranks the schedule; even
// a pre-rolled no-show who showed up anyway gets listed, because there they are.
export function deskReservationList(state, presentReservationIds = []) {
  const due = dueForCheckIn(state);
  if (!presentReservationIds || !presentReservationIds.length) return due;
  const seen = new Set(due.map((r) => String(r.id)));
  const cal = calendarOf(state.clock.minutes);
  for (const rawId of presentReservationIds) {
    const key = String(rawId);
    if (seen.has(key)) continue;
    const r = bookOf(state).booked.find(
      (b) => String(b.id) === key || String(b.reservationId) === key,
    );
    if (r && r.status === 'booked' && r.dayAbs === cal.dayAbs) {
      seen.add(String(r.id));
      due.push(r);
    }
  }
  return due.sort((a, b) => a.minute - b.minute || a.id - b.id);
}

export function checkInReservation(state, id) {
  const res = reservationById(state, id);
  if (!res || res.status !== 'booked') return { ok: false, reason: 'No open booking under that name.' };
  res.status = 'played';
  res.reservationStatus = 'played';
  res.checkInStatus = 'checked-in';
  res.arrivalStatus = 'arrived';
  res.arrivalTime ??= state.clock ? state.clock.minutes : null;
  res.arrivedAt ??= res.arrivalTime;
  res.checkedInAt = state.clock ? state.clock.minutes : null;
  res.currentDestination = 'course';
  res.paymentStatus = 'paid';
  // `??` does not skip NaN — a fee-less or corrupted booking must settle at
  // zero, not post NaN into the ledger
  res.paidAmount = round2(Number.isFinite(res.balanceDue) ? res.balanceDue
    : (Number.isFinite(res.fee) ? res.fee : 0));
  res.balanceDue = 0;
  addRevenue(state, 'greenFees', res.paidAmount);
  return { ok: true, fee: res.paidAmount, res };
}

export function markReservationNoShow(state, id, {
  at = state.clock ? state.clock.minutes : null,
  reason = 'missed-tee-time',
  feeAmount = null,
} = {}) {
  const res = reservationById(state, id);
  if (!res) return { ok: false, reason: 'Reservation not found.' };
  if (res.status === 'noShow') return { ok: true, already: true, res };
  if (res.status !== 'booked') return { ok: false, reason: 'Only open bookings can become no-shows.' };
  res.status = 'noShow';
  res.reservationStatus = 'noShow';
  res.checkInStatus = 'missed';
  res.arrivalStatus = 'no-show';
  res.currentDestination = 'departed';
  res.noShowAt = at;
  res.noShowReason = reason;
  res.noShowFee = round2(Math.max(0, finite(feeAmount, res.noShowFee)));
  res.noShowFeeStatus = res.noShowFee > 0 ? 'pending' : 'waived';
  res.noShowDepositCredit = round2(Math.min(res.depositPaid || 0, res.noShowFee));
  res.noShowFeeChargedAmount = 0;
  return { ok: true, res };
}

export function chargeNoShowFee(state, id, {
  at = state.clock ? state.clock.minutes : null,
  amount = null,
  method = 'card-on-file',
} = {}) {
  const res = reservationById(state, id);
  if (!res || res.status !== 'noShow') return { ok: false, reason: 'Only a no-show can be charged.' };
  const referenceId = reservationNoShowFeeReference(res.id);
  const existingTicket = serviceTicketByReference(state, RESERVATION_NO_SHOW_FEE_TYPE, referenceId);
  const expectedRecordedNoShowAmount = res.noShowFeeTransactionNumber != null
    || res.noShowFeeReferenceId
    || res.noShowFeeChargeKey
    ? round2(res.noShowFeeChargedAmount || 0)
    : round2(Math.max(0, res.noShowFee - (res.depositPaid || 0)));
  if (existingTicket && (
    round2(existingTicket.total) !== expectedRecordedNoShowAmount
    || (res.noShowFeeTransactionNumber != null && existingTicket.number !== res.noShowFeeTransactionNumber)
  )) {
    return { ok: false, reason: 'The saved no-show ticket does not match this reservation.' };
  }
  if (
    res.noShowFeeStatus === 'charged'
    || res.noShowFeeStatus === 'covered-by-deposit'
    || res.noShowFeeStatus === 'waived'
    || res.noShowFeeReferenceId
    || res.noShowFeeChargeKey
  ) {
    return {
      ok: true,
      already: true,
      legacy: res.noShowFeeProvenance === 'legacy-direct',
      amount: res.noShowFeeChargedAmount || 0,
      grossFee: res.noShowFee,
      depositCredit: res.noShowDepositCredit || 0,
      res,
      ticket: existingTicket,
    };
  }

  const grossFee = round2(Math.max(0, finite(amount, res.noShowFee)));
  const depositCredit = round2(Math.min(Math.max(0, res.depositPaid || 0), grossFee));
  const amountToBank = round2(Math.max(0, grossFee - depositCredit));
  if (grossFee <= 0) {
    res.noShowFee = 0;
    res.noShowFeeStatus = 'waived';
    res.noShowDepositCredit = 0;
    res.noShowFeeChargedAmount = 0;
    return { ok: true, already: false, amount: 0, grossFee: 0, depositCredit: 0, res, ticket: null };
  }

  if (existingTicket && round2(existingTicket.total) !== amountToBank) {
    return { ok: false, reason: 'The saved no-show ticket does not match this reservation.' };
  }
  const banked = bankServiceCharge(state, {
    type: RESERVATION_NO_SHOW_FEE_TYPE,
    referenceId,
    revenueKey: 'greenFees',
    amount: amountToBank,
    customer: res.fullName || res.name,
    customerId: res.customerId || null,
    method,
    skuId: RESERVATION_NO_SHOW_FEE_SKU,
    itemName: 'Reservation No-Show Fee',
    minute: at,
    details: {
      reservationId: res.id,
      customerId: res.customerId || null,
      dayAbs: res.dayAbs,
      minute: res.minute,
      grossFee,
      depositCredit,
    },
  });
  if (!banked.ok) return banked;
  if (round2(banked.ticket.total) !== amountToBank) {
    return { ok: false, reason: 'The saved no-show ticket does not match this reservation.' };
  }

  res.noShowFee = grossFee;
  res.noShowDepositCredit = depositCredit;
  res.noShowFeeChargedAmount = amountToBank;
  res.noShowFeeChargeKey = referenceId;
  res.noShowFeeReferenceId = referenceId;
  res.noShowFeeTransactionNumber = banked.ticket.number;
  res.noShowFeeChargedAt = banked.ticket.minute ?? at;
  res.noShowFeePaymentMethod = banked.ticket.method;
  res.noShowFeeStatus = amountToBank > 0 ? 'charged' : 'covered-by-deposit';
  res.noShowFeeProvenance = 'ticketed';
  if (!res.visitHistoryRecorded && res.customerId) {
    const recorded = recordCustomerVisit(state, res.customerId, {
      dayAbs: res.dayAbs,
      purpose: 'tee-time',
      outcome: 'no-show',
      amount: grossFee,
    });
    if (recorded.ok) res.visitHistoryRecorded = true;
  }
  return {
    ok: true,
    already: Boolean(banked.already),
    amount: amountToBank,
    grossFee,
    depositCredit,
    res,
    ticket: banked.ticket,
  };
}

export const applyNoShowFee = chargeNoShowFee;

export function processReservationTimeline(state, {
  at = state.clock.minutes,
  chargeFees = false,
} = {}) {
  const config = bookOf(state).config;
  const deposits = [];
  const noShows = [];
  // Online reservations are generated during dailyTick immediately after the
  // prior day's books close. Deferring those minute-zero deposits until the
  // first active new-day tick keeps each cash movement inside the same ledger
  // window that records it.
  if (calendarOf(at).minuteOfDay !== 0) {
    for (const res of bookOf(state).booked) {
      if (res.status !== 'booked' || res.depositStatus !== 'pending' || res.depositRequested <= 0) continue;
      const banked = bankReservationDeposit(state, res.id, {
        amount: res.depositRequested,
        method: res.depositRequestedMethod || 'online-card',
        at,
      });
      if (banked.ok) deposits.push(res);
    }
  }
  for (const res of bookOf(state).booked) {
    const deadline = res.teeTimeAbs + config.noShowGraceMin;
    if (res.status !== 'booked'
        || res.arrivalStatus === 'arrived'
        || res.checkInStatus === 'waiting'
        || res.checkInStatus === 'payment-in-progress'
        || at <= deadline) continue;
    const marked = markReservationNoShow(state, res.id, { at });
    if (!marked.ok) continue;
    if (chargeFees) chargeNoShowFee(state, res.id, { at });
    noShows.push(res);
  }
  return { deposits, noShows };
}

// Midnight housekeeping: mark all prior-day open bookings, leave fees pending
// for the explicit exact-once charge primitive, and retain two weeks of history.
export function reservationsDailyTick(state, todayAbs) {
  const book = bookOf(state);
  for (const r of book.booked) {
    if (r.status === 'booked'
        && r.arrivalStatus !== 'arrived'
        && r.checkInStatus !== 'waiting'
        && r.checkInStatus !== 'payment-in-progress'
        && r.dayAbs < todayAbs) {
      markReservationNoShow(state, r.id, { at: todayAbs * MINUTES_PER_DAY, reason: 'day-ended' });
    }
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
