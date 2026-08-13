// Reservation check-in payments share the physical register payment machinery
// without pretending a tee time is merchandise.  This adapter owns the stable
// reservation reference and the exact transition from an open booking to the
// persisted checked-in record.

import {
  reservationById,
  RESERVATION_DEPOSIT_TYPE,
  RESERVATION_DEPOSIT_SKU,
  reservationDepositReference,
} from './reservations.js';
import { identityForReservation } from './customerIdentity.js';
import { preflightLedgerEntry } from './economy.js';
import { t } from '../core/i18n.js';
import {
  createTx,
  totalOf,
  dueOf,
  printReceipt,
  takeReceipt,
  packReceipt,
  bagItem,
  handOverGoods,
  completeServicePayment,
  completeSale,
  serviceTicketByReference,
  validateServiceChargeTicket,
  goodsLinesOf,
  serviceLinesOf,
  serviceSubtotal,
} from './register.js';

export const RESERVATION_CHECK_IN_TYPE = 'reservation-check-in';
export const GREEN_FEE_SKU = 'service:green-fee';

const round2 = (value) => Math.round(Number(value) * 100) / 100;

function canAssignField(target, key) {
  try {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) return false;
    const own = Object.getOwnPropertyDescriptor(target, key);
    if (own) return Object.hasOwn(own, 'value') && own.writable === true;
    let prototype = Object.getPrototypeOf(target);
    while (prototype) {
      const inherited = Object.getOwnPropertyDescriptor(prototype, key);
      if (inherited) {
        if (!Object.hasOwn(inherited, 'value') || inherited.writable !== true) return false;
        break;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return Object.isExtensible(target);
  } catch {
    return false;
  }
}

function tryAssignField(target, key, value) {
  if (!canAssignField(target, key)) return false;
  try {
    target[key] = value;
    return target[key] === value;
  } catch {
    return false;
  }
}

function reservationProjectionWritable(reservation) {
  const topLevel = [
    'status', 'reservationStatus', 'checkedInAt', 'checkInTransactionNumber',
    'checkInReferenceId', 'paymentMethod', 'paidAmount', 'totalPaid',
    'paymentStatus', 'currentDestination', 'arrivalStatus', 'checkInStatus',
  ];
  if (reservation.depositStatus !== 'legacy-untracked') {
    topLevel.push('balanceDue', 'remainingBalance');
  }
  if (topLevel.some((key) => !canAssignField(reservation, key))) return false;
  for (const [key, fields] of [
    ['checkIn', ['status', 'checkedInAtMinute']],
    ['arrival', ['status', 'arrivedAtMinute']],
    ['courseAccess', ['status', 'grantedAtMinute', 'departurePlannedAtMinute']],
  ]) {
    const nested = reservation[key];
    if (nested == null) {
      if (!canAssignField(reservation, key)) return false;
    } else if (!nested || typeof nested !== 'object' || Array.isArray(nested)
        || fields.some((field) => !canAssignField(nested, field))) {
      return false;
    }
  }
  for (const member of reservation.party?.members || []) {
    if (!canAssignField(member, 'checkedIn')) return false;
  }
  if (reservation.payment && typeof reservation.payment === 'object') {
    const paymentFields = ['amountPaid', 'amountDue', 'status', 'method', 'pending'];
    if (paymentFields.some((key) => !canAssignField(reservation.payment, key))) return false;
  }
  return true;
}

function paymentAmountFor(reservation) {
  const canonicalDue = Number(reservation?.payment?.amountDue);
  const compatibilityDue = Number(reservation?.balanceDue);
  if (Number.isFinite(canonicalDue) && Number.isFinite(compatibilityDue)) {
    const canonicalPaid = Number(reservation?.payment?.amountPaid);
    if (round2(canonicalDue) === 0 && round2(compatibilityDue) > 0
        && round2(canonicalPaid) >= round2(reservation?.payment?.total ?? reservation?.fee ?? 0)) {
      return 0;
    }
    const pristineUnpaid = round2(canonicalPaid) === 0
      && round2(canonicalDue) === round2(reservation?.payment?.total ?? reservation?.fee ?? 0);
    if (pristineUnpaid && round2(compatibilityDue) !== round2(reservation?.fee ?? canonicalDue)) {
      const legacyDeposit = round2(Number(reservation?.depositPaid) || 0);
      if (!(legacyDeposit > 0
          && legacyDeposit <= round2(reservation?.fee ?? 0)
          && round2(compatibilityDue) === round2(reservation.fee - legacyDeposit))) {
        return Number.NaN;
      }
    }
    return round2(compatibilityDue);
  }
  if (Number.isFinite(canonicalDue)) return round2(canonicalDue);
  return round2(reservation.balanceDue != null ? reservation.balanceDue : reservation.fee);
}

function priorPaidFor(reservation) {
  return round2(Math.max(
    0,
    Number(reservation?.payment?.amountPaid) || 0,
    Number(reservation?.depositPaid) || 0,
  ));
}

function reservationSettlementDetails(reservation, checkInAmount) {
  return {
    reservationId: reservation.id,
    customerId: reservation.customerId || null,
    dayAbs: reservation.dayAbs,
    minute: reservation.minute,
    depositPaid: round2(reservation.depositPaid || 0),
    depositReferenceId: reservation.depositReferenceId || null,
    totalReservationFee: round2(reservation.fee),
    priorPaid: priorPaidFor(reservation),
    priorPaymentMethod: reservation.payment?.method || null,
    checkInAmount: round2(checkInAmount),
  };
}

function reservationSettlementTarget(state, reservation, tx, checkInAmount, referenceId) {
  const details = reservationSettlementDetails(reservation, checkInAmount);
  const paymentTotal = round2(reservation.payment?.total ?? reservation.fee ?? 0);
  const totalPaid = round2(details.priorPaid + details.checkInAmount);
  const amountDue = round2(Math.max(0, paymentTotal - totalPaid));
  const checkedInAt = state.clock ? state.clock.minutes : null;
  const checkIn = {
    ...(reservation.checkIn || {}),
    status: 'checked-in',
    checkedInAtMinute: checkedInAt,
  };
  const arrival = {
    ...(reservation.arrival || {}),
    status: 'arrived',
    arrivedAtMinute: reservation.arrival?.arrivedAtMinute ?? checkedInAt,
  };
  const courseAccess = {
    ...(reservation.courseAccess || {}),
    status: 'granted',
    grantedAtMinute: checkedInAt,
    departurePlannedAtMinute: checkedInAt == null
      ? null
      : checkedInAt + (Number(state.reservations?.policy?.autoDepartMinutesAfterCheckIn) || 2),
  };
  const party = reservation.party && typeof reservation.party === 'object'
    ? {
      ...reservation.party,
      members: (reservation.party.members || []).map((member) => ({
        ...member,
        checkedIn: true,
      })),
    }
    : reservation.party;
  const fields = {
    status: 'played',
    reservationStatus: 'played',
    checkedInAt,
    checkInReferenceId: referenceId,
    paymentMethod: tx.method,
    paidAmount: details.checkInAmount,
    totalPaid,
    paymentStatus: 'paid',
    currentDestination: 'course',
    arrivalStatus: 'arrived',
    checkInStatus: 'checked-in',
    checkIn,
    arrival,
    courseAccess,
    party,
  };
  if (reservation.depositStatus !== 'legacy-untracked') {
    fields.balanceDue = 0;
    fields.remainingBalance = 0;
  }
  const expected = Object.fromEntries(Object.keys(fields).map((key) => [key, (
    Object.hasOwn(reservation, key)
      ? { present: true, value: reservation[key] }
      : { present: false }
  )]));
  return {
    reservationId: String(reservation.id),
    expected: {
      ...expected,
      status: { present: true, value: 'booked' },
      fee: { present: Object.hasOwn(reservation, 'fee'), value: reservation.fee },
      depositPaid: {
        present: Object.hasOwn(reservation, 'depositPaid'),
        ...(Object.hasOwn(reservation, 'depositPaid') ? { value: reservation.depositPaid } : {}),
      },
      depositReferenceId: {
        present: Object.hasOwn(reservation, 'depositReferenceId'),
        ...(Object.hasOwn(reservation, 'depositReferenceId')
          ? { value: reservation.depositReferenceId } : {}),
      },
    },
    fields,
    paymentExpected: reservation.payment ? Object.fromEntries([
      'total', 'amountPaid', 'amountDue', 'status', 'method', 'pending',
    ].map((key) => [key, (
      Object.hasOwn(reservation.payment, key)
        ? { present: true, value: reservation.payment[key] }
        : { present: false }
    )])) : null,
    paymentFields: reservation.payment ? {
      total: paymentTotal,
      amountPaid: totalPaid,
      amountDue,
      status: amountDue <= 0 ? 'paid' : 'deposit',
      method: details.checkInAmount > 0
        ? (tx.method || details.priorPaymentMethod || null)
        : (details.priorPaymentMethod || tx.method || null),
      pending: null,
    } : null,
  };
}

function ticketedDepositIsConsistent(state, reservation) {
  const fee = round2(Number(reservation?.fee));
  const depositPaid = round2(Number(reservation?.depositPaid) || 0);
  const canonicalPaid = round2(Number(reservation?.payment?.amountPaid) || 0);
  const canonicalTotal = round2(Number(reservation?.payment?.total ?? fee));
  const canonicalDue = round2(Number(reservation?.payment?.amountDue ?? (fee - canonicalPaid)));
  const canonicalConserved = round2(canonicalPaid + canonicalDue) === canonicalTotal;
  const legacyDepositConserved = canonicalPaid === 0 && depositPaid > 0
    && round2(depositPaid + Number(reservation?.balanceDue)) === fee;
  if (!Number.isFinite(fee) || fee < 0 || depositPaid < 0 || depositPaid > fee
      || canonicalPaid < 0 || canonicalPaid > fee || canonicalTotal !== fee
      || (!canonicalConserved && !legacyDepositConserved)) return false;
  if (reservation.payment && Number.isFinite(Number(reservation.payment.amountDue))
      && Number.isFinite(Number(reservation.balanceDue))) {
    const canonicalDue = round2(Number(reservation.payment.amountDue));
    const compatibilityDue = round2(Number(reservation.balanceDue));
    const canonicalPaid = round2(Number(reservation.payment.amountPaid) || 0);
    const paymentTotal = round2(reservation.payment.total ?? reservation.fee ?? 0);
    const safelyPrepaid = canonicalDue === 0 && canonicalPaid >= paymentTotal;
    const legacyDepositDue = depositPaid > 0 && canonicalPaid === 0
      && canonicalDue === paymentTotal
      && compatibilityDue === round2(fee - depositPaid);
    if (canonicalDue !== compatibilityDue && !safelyPrepaid && !legacyDepositDue
        && !(canonicalPaid === 0 && canonicalDue === paymentTotal)) return false;
  }
  if ((reservation.depositPaid || 0) > 0
    && !reservation.depositReferenceId
    && (reservation.depositStatus === 'none' || reservation.depositStatus == null)) {
    reservation.depositStatus = 'legacy-untracked';
  }
  if (reservation.depositStatus !== 'paid' && !reservation.depositReferenceId) return true;
  const expected = round2(reservation.fee - depositPaid);
  const referenceId = reservationDepositReference(reservation.id);
  const ticket = serviceTicketByReference(state, RESERVATION_DEPOSIT_TYPE, referenceId);
  const ticketValidation = ticket ? validateServiceChargeTicket(state, {
    type: RESERVATION_DEPOSIT_TYPE,
    referenceId,
    revenueKey: 'greenFees',
    amount: depositPaid,
    customer: reservation.fullName || reservation.name,
    customerId: reservation.customerId,
    method: reservation.depositPaymentMethod,
    skuId: RESERVATION_DEPOSIT_SKU,
    itemName: 'Reservation Deposit',
    details: {
      reservationId: reservation.id,
      customerId: reservation.customerId,
      dayAbs: reservation.dayAbs,
      minute: reservation.minute,
      totalFee: reservation.fee,
    },
  }) : null;
  return depositPaid >= 0
    && depositPaid <= round2(reservation.fee)
    && reservation.depositReferenceId === referenceId
    && paymentAmountFor(reservation) === expected
    && ticketValidation?.ok === true
    && round2(ticket.total) === depositPaid
      && (reservation.depositTransactionNumber == null || ticket.number === reservation.depositTransactionNumber)
    ;
}

export function reservationPaymentReference(reservationId) {
  return `reservation:${String(reservationId)}:check-in`;
}

export function createReservationCheckInTx(state, reservationId, {
  method = null,
  rng = Math.random,
} = {}) {
  const reservation = reservationById(state, reservationId);
  if (!reservation || reservation.status !== 'booked') {
    return { ok: false, reason: 'No open booking under that name.' };
  }
  const amount = paymentAmountFor(reservation);
  if (!Number.isFinite(amount) || amount < 0 || !ticketedDepositIsConsistent(state, reservation)) {
    return { ok: false, reason: 'That reservation has an invalid green fee.' };
  }
  if (method !== null && method !== 'card' && method !== 'cash') {
    return { ok: false, reason: 'Choose card or cash for this check-in.' };
  }
  if (typeof rng !== 'function') return { ok: false, reason: 'A payment random source is required.' };

  const referenceId = reservationPaymentReference(reservation.id);
  const uid = `${referenceId}:green-fee`;
  const tx = createTx({
    items: [{ uid, skuId: GREEN_FEE_SKU, name: 'Green Fee', price: amount }],
    mode: state.mode || 'relaxed',
    prefer: method,
    rng,
  });
  // NO SALES TAX ON THE GREEN FEE. The brief scoped the tax to pro-shop sales — tangible
  // merchandise — and createTx defaults taxRate to 0, so this ticket charges the fee and
  // nothing else. Whether a round of golf is a taxable service varies by state and is not a
  // thing to guess at inside a check-in.
  //
  // It is a virtual line on the shared monitor, not a physical product.  Marking
  // it scanned lets the existing requestPayment/card/cash APIs run unchanged.
  tx.items[0].scanned = true;
  tx.kind = 'service';
  tx.servicePayment = {
    type: RESERVATION_CHECK_IN_TYPE,
    referenceId,
    revenueKey: 'greenFees',
    amount,
    reservationId: reservation.id,
  };

  return { ok: true, tx, reservation };
}

// ONE VISIT, ONE PAYMENT.
//
// A customer who puts a shirt on the counter and then asks about their tee time
// is one visit, and should be one ticket and one payment. Before this, the desk
// refused: `beginReservationPayment` bailed while a goods ticket was open, and
// the check-in built a ticket of its own. So the player rang two sales, and the
// customer paid twice for one trip to the desk.
//
// This attaches the green fee as a LINE on the ticket the goods are already on.
// The line is a service line by SKU prefix, which is what keeps its money off
// the merchandise revenue account, out of the taxable base, out of the discount
// base, off the shelves, and out of the bag.
export function attachGreenFeeToTx(state, tx, reservationId) {
  if (!tx || !Array.isArray(tx.items)) return { ok: false, reason: 'There is no open ticket.' };
  if (tx.banked) return { ok: false, reason: 'That sale is already banked.' };
  if (tx.stage !== 'scanning') {
    return { ok: false, reason: 'Add the tee time before starting payment.' };
  }
  if (tx.servicePayment || tx.items.some((item) => item.skuId === GREEN_FEE_SKU)) {
    return { ok: false, reason: 'This ticket already has a tee time on it.' };
  }

  const reservation = reservationById(state, reservationId);
  if (!reservation || reservation.status !== 'booked') {
    return { ok: false, reason: 'No open booking under that name.' };
  }
  const amount = paymentAmountFor(reservation);
  if (!Number.isFinite(amount) || amount < 0 || !ticketedDepositIsConsistent(state, reservation)) {
    return { ok: false, reason: 'That reservation has an invalid green fee.' };
  }

  const referenceId = reservationPaymentReference(reservation.id);
  const uid = `${referenceId}:green-fee`;
  // Scanned on arrival: there is no barcode on a tee time, and an unscanned line
  // would block requestPayment forever.
  tx.items.push({
    uid,
    skuId: GREEN_FEE_SKU,
    name: 'Green Fee',
    priceCents: Math.round(amount * 100),
    price: amount,
    scanned: true,
    bagged: false,
  });
  tx.servicePayment = {
    type: RESERVATION_CHECK_IN_TYPE,
    referenceId,
    revenueKey: 'greenFees',
    amount,
    reservationId: reservation.id,
    combined: true,
  };
  return { ok: true, tx, reservation, amount };
}

// The simplified desk auto-files the receipt and virtual line when the player
// presses FINALIZE.  We still call the register's receipt/fulfilment functions,
// so approval and receipt state remain the same single source of truth.
function finishVirtualFulfilment(tx) {
  let receipt = null;
  if (tx.stage === 'receipt') {
    if (!tx.receiptPrinted) {
      const printed = printReceipt(tx);
      if (!printed.ok) return printed;
      receipt = printed.receipt;
    }
    const taken = takeReceipt(tx);
    if (!taken.ok) return taken;
  }
  if (tx.stage === 'bagging') {
    if (!tx.receiptPacked) {
      const packed = packReceipt(tx);
      if (!packed.ok) return packed;
    }
    for (const item of tx.items) {
      if (!item.bagged) {
        const bagged = bagItem(tx, item.uid);
        if (!bagged.ok) return bagged;
      }
    }
    const handed = handOverGoods(tx);
    if (!handed.ok) return handed;
  }
  if (tx.stage !== 'done') {
    return { ok: false, reason: 'Finish the card or cash payment before check-in.' };
  }
  return { ok: true, receipt };
}

export function finalizeReservationCheckIn(
  state,
  tx,
  reservationId = tx && tx.servicePayment ? tx.servicePayment.reservationId : null,
  { qaFaultAfterCoreCommit = null } = {},
) {
  // A ticket qualifies by carrying a booking, not by being nothing but a booking.
  // A combined ticket is a MERCHANDISE ticket with a service line on it, so its
  // kind stays whatever a sale's kind is; only a fee-only ticket is kind
  // 'service'.
  if (!tx || !tx.servicePayment) {
    return { ok: false, reason: 'This payment is not tied to a reservation.' };
  }
  if (tx.kind !== 'service' && !goodsLinesOf(tx).length) {
    return { ok: false, reason: 'This payment is not tied to a reservation.' };
  }
  if (tx.banked) return { ok: false, reason: 'That check-in is already banked.' };

  const service = tx.servicePayment;
  if (reservationId !== service.reservationId) {
    return { ok: false, reason: 'This payment belongs to a different reservation.' };
  }
  const reservation = reservationById(state, reservationId);
  if (!reservation || reservation.status !== 'booked') {
    return { ok: false, reason: 'No open booking under that name.' };
  }
  try {
    // Production reservations already own an identity. Enrol a legacy booking
    // here, before fulfilment or banking, so its durable history event can be
    // preflighted instead of taking money under an unresolved customer id.
    identityForReservation(state, reservation);
  } catch {
    return {
      ok: false,
      reason: t('customer.historyUnavailable'),
      diagnostic: 'The reservation customer identity is unavailable.',
    };
  }

  const snapshottedFee = paymentAmountFor(reservation);
  const referenceId = reservationPaymentReference(reservation.id);
  // ONE TICKET, TWO KINDS OF LINE. When the fee rides with merchandise the
  // ticket total is the whole visit, so the fee is checked against ITS OWN LINE
  // rather than against the total - the total legitimately exceeds it.
  const withGoods = goodsLinesOf(tx).length > 0;
  const serviceLines = serviceLinesOf(tx);
  if (serviceLines.length !== 1) {
    return {
      ok: false,
      reason: t('checkout.integrityUnavailable'),
      diagnostic: 'A service booking must have exactly one ticket line.',
    };
  }
  const virtualLine = serviceLines.length === 1 ? serviceLines[0] : null;
  if (
    !Number.isFinite(snapshottedFee)
    || snapshottedFee < 0
    || service.type !== RESERVATION_CHECK_IN_TYPE
    || service.referenceId !== referenceId
    || round2(service.amount) !== snapshottedFee
    || !ticketedDepositIsConsistent(state, reservation)
    || !virtualLine
    || virtualLine.uid !== `${referenceId}:green-fee`
    || virtualLine.skuId !== GREEN_FEE_SKU
    || round2(virtualLine.price) !== snapshottedFee
    || virtualLine.scanned !== true
    // The booked fee must arrive whole either way: alone it is the entire
    // ticket, and alongside goods it is the entire SERVICE half of the ticket.
    || round2(serviceSubtotal(tx)) !== snapshottedFee
    || (!withGoods && (
      round2(tx.discount || 0) !== 0
      || round2(totalOf(tx)) !== snapshottedFee
      || round2(dueOf(tx)) !== snapshottedFee
    ))
  ) {
    return { ok: false, reason: 'The payment no longer matches the booked green fee.' };
  }

  const fulfilled = finishVirtualFulfilment(tx);
  if (!fulfilled.ok) return fulfilled;

  const settlementDetails = reservationSettlementDetails(reservation, snapshottedFee);
  const reservationTarget = reservationSettlementTarget(
    state,
    reservation,
    tx,
    snapshottedFee,
    referenceId,
  );

  // A ticket carrying merchandise banks through the sale door, which splits the
  // money by line: the goods to shopSales, this fee to greenFees. A ticket
  // carrying nothing but the fee banks through the service door as it always has.
  const banked = withGoods
    // Cleared: every reservation check above has just run against the live
    // booking - status, fee, deposit consistency, and the fee line itself.
    ? completeSale(state, tx, {
      fullName: reservation.fullName || reservation.name,
      customerId: reservation.customerId || null,
    }, {
      serviceCleared: true,
      customerVisitDayAbs: reservation.dayAbs,
      customerVisitReservationId: reservation.id,
      serviceDetails: settlementDetails,
      reservationTarget,
      qaFaultAfterCoreCommit,
    })
    : completeServicePayment(state, tx, {
      type: RESERVATION_CHECK_IN_TYPE,
      referenceId,
      revenueKey: 'greenFees',
      expectedTotal: snapshottedFee,
      customer: reservation.fullName || reservation.name,
      details: settlementDetails,
      reservationTarget,
      qaFaultAfterCoreCommit,
      ...(reservation.customerId ? {
        customerVisitEvent: {
          id: `service:${RESERVATION_CHECK_IN_TYPE}:${referenceId}:customer-visit`,
          customerId: reservation.customerId,
          dayAbs: reservation.dayAbs,
          purpose: reservation.customerType === 'walk-in' ? 'walk-in-tee' : 'tee-time',
          outcomes: ['check-in'],
          countsAsVisit: true,
          paymentMethod: tx.method,
          amount: snapshottedFee,
          reservationId: reservation.id,
        },
      } : {}),
    });
  if (!banked.ok) return banked;
  // completeSale historically returned totals but not its newly-prepended
  // ticket. Recover that exact row so combined check-in callers retain the
  // same customer/service provenance that the save history now owns.
  const ticket = banked.ticket
    || state.shop.transactionHistory?.find((entry) => Number(entry.number) === Number(tx.number))
    || { number: tx.number };

  // Both combined and fee-only payments carry a persisted ticket event. The
  // register preflights it before money moves and applies it idempotently after
  // the ticket append; save/load can reconcile the same event if needed.
  const customerVisitRecorded = banked.customerVisitRecorded === true;
  tryAssignField(reservation, 'visitHistoryRecorded', customerVisitRecorded);

  return {
    ok: true,
    recovered: banked.recovered === true,
    already: banked.already === true,
    fee: snapshottedFee,
    reservation,
    receipt: fulfilled.receipt,
    ticket,
    customerVisitRecorded,
  };
}

// A completed service-typed ticket is also a durable reservation outbox. This
// covers saves made after the ticket append but before the final reservation
// projection, including historical builds that predate the checkout WAL.
export function reconcileReservationCheckInTickets(state, { tickets = null } = {}) {
  const source = Array.isArray(tickets)
    ? tickets
    : (Array.isArray(state?.shop?.transactionHistory) ? state.shop.transactionHistory : []);
  const report = { applied: 0, already: 0, pending: 0, failures: [] };
  const ticketsByReference = new Map();
  for (const ticket of source) {
    if (ticket?.type !== RESERVATION_CHECK_IN_TYPE || typeof ticket.referenceId !== 'string') continue;
    const grouped = ticketsByReference.get(ticket.referenceId) || [];
    grouped.push(ticket);
    ticketsByReference.set(ticket.referenceId, grouped);
  }
  const ambiguousReferences = new Set();
  for (const [referenceId, grouped] of ticketsByReference) {
    if (grouped.length <= 1) continue;
    ambiguousReferences.add(referenceId);
    report.pending += 1;
    report.failures.push({
      ticketNumber: null,
      referenceId,
      reason: t('checkout.integrityUnavailable'),
      diagnostic: 'Duplicate reservation tickets conflict on one settlement reference.',
    });
  }
  const ordered = [...source].sort(
    (left, right) => (Number(left?.number) || 0) - (Number(right?.number) || 0),
  );
  for (const ticket of ordered) {
    if (ticket?.type !== RESERVATION_CHECK_IN_TYPE || typeof ticket.referenceId !== 'string') continue;
    if (ambiguousReferences.has(ticket.referenceId)) continue;
    const details = ticket.details && typeof ticket.details === 'object' ? ticket.details : {};
    const reservationId = details.reservationId
      ?? ticket.customerVisitEvent?.reservationId
      ?? ticket.referenceId.match(/^reservation:(.+):check-in$/)?.[1];
    const reservation = (state?.reservations?.booked || []).find(
      (entry) => String(entry?.id) === String(reservationId),
    );
    if (!reservation) {
      report.pending += 1;
      report.failures.push({
        ticketNumber: ticket.number ?? null,
        referenceId: ticket.referenceId,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: 'Reservation not found.',
      });
      continue;
    }
    const expectedReference = reservationPaymentReference(reservation.id);
    if (ticket.referenceId !== expectedReference) {
      report.pending += 1;
      report.failures.push({
        ticketNumber: ticket.number ?? null,
        referenceId: ticket.referenceId,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: 'Reservation reference does not match the ticket.',
      });
      continue;
    }
    const checkInAmount = round2(Number.isFinite(Number(details.checkInAmount))
      ? Number(details.checkInAmount)
      : Number(ticket.serviceTotal ?? ticket.total) || 0);
    const persistedPriorPaid = Number(details.priorPaid);
    const priorPaid = round2(Number.isFinite(persistedPriorPaid)
      ? Math.max(0, persistedPriorPaid)
      : priorPaidFor(reservation));
    const paymentTotal = round2(
      Number(details.totalReservationFee ?? reservation.payment?.total ?? reservation.fee) || 0,
    );
    const canonicalPriorPaid = priorPaidFor(reservation);
    const canonicalPaymentTotal = round2(reservation.payment?.total ?? reservation.fee ?? 0);
    const expectedCheckInAmount = round2(Math.max(0, paymentTotal - priorPaid));
    const detailsComplete = details.reservationId != null
      && String(details.reservationId) === String(reservation.id)
      && Object.hasOwn(details, 'priorPaid')
      && Object.hasOwn(details, 'totalReservationFee')
      && Object.hasOwn(details, 'checkInAmount')
      && Object.hasOwn(details, 'priorPaymentMethod');
    const ticketCustomerMatches = typeof ticket.customer === 'string'
      && ticket.customer.length > 0
      && ticket.customer === (reservation.fullName || reservation.name);
    const serviceLines = Array.isArray(ticket.items)
      ? ticket.items.filter((item) => String(item?.skuId || '').startsWith('service:'))
      : [];
    const serviceLineMatches = serviceLines.length === 1
      && serviceLines[0]?.uid === `${expectedReference}:green-fee`
      && serviceLines[0]?.skuId === GREEN_FEE_SKU
      && round2(Number(serviceLines[0]?.price)) === checkInAmount;
    const visitEvent = ticket.customerVisitEvent;
    const visitEventId = ticket.transactionId
      ? `checkout:${ticket.transactionId}:customer-visit`
      : `service:${RESERVATION_CHECK_IN_TYPE}:${expectedReference}:customer-visit`;
    const zeroAmountVisitProvenance = checkInAmount !== 0 || (
      visitEvent
      && visitEvent.id === visitEventId
      && visitEvent.customerId === reservation.customerId
      && String(visitEvent.reservationId) === String(reservation.id)
      && visitEvent.paymentMethod === ticket.method
      && round2(Number(visitEvent.amount)) === round2(Number(ticket.total))
      && Array.isArray(visitEvent.outcomes)
      && visitEvent.outcomes.includes('check-in')
    );
    const serviceKey = `service:${RESERVATION_CHECK_IN_TYPE}:${expectedReference}:revenue`;
    const serviceComponent = ticket.ledgerEntryIds?.service ? 'service' : 'revenue';
    const serviceEntryId = ticket.ledgerEntryIds?.[serviceComponent]
      ?? ticket.ledgerEntryId ?? null;
    const serviceLedgerKey = ticket.ledgerIdempotencyKeys?.[serviceComponent]
      ?? (ticket.ledgerEntryId ? serviceKey : null);
    const serviceLedgerId = state.ledger?.processedIds?.[serviceKey] || null;
    const settlementMinute = Math.round(Number(ticket.minute));
    const serviceLedgerPreflight = checkInAmount > 0 ? preflightLedgerEntry(state, {
      strictIdentity: true,
      idempotencyKey: serviceKey,
      relatedId: expectedReference,
      direction: 'revenue',
      lineKey: 'greenFees',
      category: 'greenFees',
      amount: checkInAmount,
      day: Math.floor(settlementMinute / 1440),
      timestamp: settlementMinute,
      description: `Service payment - ${ticket.customer}`,
      source: 'service-payment',
      customerCount: 1,
      metadata: {
        type: RESERVATION_CHECK_IN_TYPE,
        method: ticket.method,
        ...(serviceComponent === 'service' ? { withGoods: true } : {}),
        ...(ticket.checkoutSettlement
          ? { checkoutSettlement: ticket.checkoutSettlement }
          : {}),
      },
    }) : { ok: true, duplicate: true };
    const validTicket = Number.isSafeInteger(Number(ticket.number)) && Number(ticket.number) > 0
      && (ticket.method === 'cash' || ticket.method === 'card')
      && Number.isFinite(Number(ticket.total)) && round2(Number(ticket.total)) >= 0
      && detailsComplete
      && ticketCustomerMatches
      && serviceLineMatches
      && zeroAmountVisitProvenance
      && (reservation.status === 'played' || priorPaid === canonicalPriorPaid)
      && paymentTotal === canonicalPaymentTotal
      && checkInAmount === expectedCheckInAmount
      && checkInAmount === round2(Number(ticket.serviceTotal ?? ticket.total) || 0)
      && round2(priorPaid + checkInAmount) === paymentTotal
      && (checkInAmount === 0 || (
        Number.isFinite(Number(ticket.minute))
        && serviceLedgerId
        && serviceEntryId === serviceLedgerId
        && serviceLedgerKey === serviceKey
        && serviceLedgerPreflight.ok
        && serviceLedgerPreflight.duplicate
      ));
    if (!validTicket) {
      report.pending += 1;
      report.failures.push({
        ticketNumber: ticket.number ?? null,
        referenceId: ticket.referenceId,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: serviceLedgerPreflight.diagnostic
          || serviceLedgerPreflight.reason
          || 'Reservation ticket lacks canonical payment or ledger provenance.',
      });
      continue;
    }
    if (reservation.status !== 'booked' && reservation.status !== 'played') {
      report.pending += 1;
      report.failures.push({
        ticketNumber: ticket.number ?? null,
        referenceId: ticket.referenceId,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: `Reservation is ${reservation.status || 'invalid'}, not payable or played.`,
      });
      continue;
    }
    if (reservation.status === 'played'
        && reservation.checkInReferenceId
        && (reservation.checkInReferenceId !== ticket.referenceId
          || (reservation.checkInTransactionNumber != null
            && Number(reservation.checkInTransactionNumber) !== Number(ticket.number)))) {
      report.pending += 1;
      report.failures.push({
        ticketNumber: ticket.number ?? null,
        referenceId: ticket.referenceId,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: 'Reservation belongs to a different completed check-in.',
      });
      continue;
    }

    const already = reservation.status === 'played'
      && reservation.checkInReferenceId === ticket.referenceId
      && Number(reservation.checkInTransactionNumber) === Number(ticket.number);
    const totalPaid = round2(priorPaid + checkInAmount);
    const amountDue = round2(Math.max(0, paymentTotal - totalPaid));
    const canonicalPriorMethod = reservation.payment?.method || null;
    const suppliedPriorMethod = details.priorPaymentMethod || null;
    if (checkInAmount === 0 && suppliedPriorMethod && suppliedPriorMethod !== canonicalPriorMethod) {
      report.pending += 1;
      report.failures.push({
        ticketNumber: ticket.number ?? null,
        referenceId: ticket.referenceId,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: 'Reservation ticket has conflicting prepaid tender provenance.',
      });
      continue;
    }
    const priorMethod = canonicalPriorMethod;

    if (!reservationProjectionWritable(reservation)) {
      report.pending += 1;
      report.failures.push({
        ticketNumber: ticket.number ?? null,
        referenceId: ticket.referenceId,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: 'The reservation payment projection is not writable.',
      });
      continue;
    }

    const checkedInAt = Number.isFinite(Number(ticket.minute)) ? Number(ticket.minute) : null;
    reservation.status = 'played';
    reservation.reservationStatus = 'played';
    reservation.checkedInAt = checkedInAt;
    reservation.checkInTransactionNumber = ticket.number;
    reservation.checkInReferenceId = ticket.referenceId;
    reservation.paymentMethod = ticket.method || null;
    reservation.paidAmount = checkInAmount;
    reservation.totalPaid = totalPaid;
    reservation.paymentStatus = 'paid';
    if (reservation.depositStatus !== 'legacy-untracked') {
      reservation.balanceDue = 0;
      reservation.remainingBalance = 0;
    }
    reservation.currentDestination = 'course';
    reservation.arrivalStatus = 'arrived';
    reservation.checkInStatus = 'checked-in';
    reservation.checkIn ||= {};
    reservation.checkIn.status = 'checked-in';
    reservation.checkIn.checkedInAtMinute = checkedInAt;
    reservation.arrival ||= {};
    reservation.arrival.status = 'arrived';
    reservation.arrival.arrivedAtMinute ??= checkedInAt;
    reservation.courseAccess ||= {};
    reservation.courseAccess.status = 'granted';
    reservation.courseAccess.grantedAtMinute = checkedInAt;
    reservation.courseAccess.departurePlannedAtMinute = checkedInAt == null
      ? null
      : checkedInAt + (Number(state.reservations?.policy?.autoDepartMinutesAfterCheckIn) || 2);
    for (const member of reservation.party?.members || []) member.checkedIn = true;
    if (reservation.payment && typeof reservation.payment === 'object') {
      reservation.payment.amountPaid = totalPaid;
      reservation.payment.amountDue = amountDue;
      reservation.payment.status = amountDue <= 0 ? 'paid' : 'deposit';
      reservation.payment.method = checkInAmount > 0
        ? (ticket.method || priorMethod)
        : (priorMethod || ticket.method || null);
      reservation.payment.pending = null;
    }
    tryAssignField(reservation, 'visitHistoryRecorded', ticket.customerVisitRecorded === true);
    if (already) report.already += 1;
    else report.applied += 1;
  }
  return { ok: report.pending === 0, ...report };
}
