// Reservation check-in payments share the physical register payment machinery
// without pretending a tee time is merchandise.  This adapter owns the stable
// reservation reference and the exact transition from an open booking to the
// persisted checked-in record.

import {
  reservationById,
  reservationPaymentRevenueSplit,
  RESERVATION_DEPOSIT_TYPE,
  reservationDepositReference,
  finalizeReservationCheckInState,
} from './reservations.js';
import { recordCustomerVisit } from './customerIdentity.js';
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
  serviceTicketByReference,
} from './register.js';
import { beginCartTrip } from './cartFleet.js';

export const RESERVATION_CHECK_IN_TYPE = 'reservation-check-in';
export const GREEN_FEE_SKU = 'service:green-fee';
export const CART_RENTAL_SKU = 'service:cart-rental';

const round2 = (value) => Math.round(Number(value) * 100) / 100;

function paymentAmountFor(reservation) {
  const value = Number.isFinite(reservation.balanceDue) ? reservation.balanceDue
    : Number.isFinite(reservation.fee) ? reservation.fee : 0;
  return round2(value);
}

function paymentLinesFor(reservation) {
  const split = reservationPaymentRevenueSplit(reservation, paymentAmountFor(reservation));
  const referenceId = reservationPaymentReference(reservation.id);
  const lines = [];
  if (split.greenFees > 0 || split.rentals <= 0) {
    lines.push({
      uid: `${referenceId}:green-fee`, skuId: GREEN_FEE_SKU,
      name: 'Green Fee', price: split.greenFees,
    });
  }
  if (split.rentals > 0) {
    lines.push({
      uid: `${referenceId}:cart-rental`, skuId: CART_RENTAL_SKU,
      name: `Cart Rental (${reservation.cartsRequested || 1})`, price: split.rentals,
    });
  }
  return { lines, split };
}

function ticketedDepositIsConsistent(state, reservation) {
  if ((reservation.depositPaid || 0) > 0
    && !reservation.depositReferenceId
    && (reservation.depositStatus === 'none' || reservation.depositStatus == null)) {
    reservation.depositStatus = 'legacy-untracked';
  }
  if (reservation.depositStatus !== 'paid' && !reservation.depositReferenceId) return true;
  const depositPaid = round2(reservation.depositPaid || 0);
  const expected = round2(reservation.fee - depositPaid);
  const referenceId = reservationDepositReference(reservation.id);
  const ticket = serviceTicketByReference(state, RESERVATION_DEPOSIT_TYPE, referenceId);
  return depositPaid >= 0
    && depositPaid <= round2(reservation.fee)
    && reservation.depositReferenceId === referenceId
    && paymentAmountFor(reservation) === expected
    && (!ticket || (
      round2(ticket.total) === depositPaid
      && (reservation.depositTransactionNumber == null || ticket.number === reservation.depositTransactionNumber)
    ));
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
  const { lines, split } = paymentLinesFor(reservation);
  const tx = createTx({
    items: lines,
    mode: state.mode || 'relaxed',
    prefer: method,
    rng,
  });
  // It is a virtual line on the shared monitor, not a physical product.  Marking
  // it scanned lets the existing requestPayment/card/cash APIs run unchanged.
  for (const item of tx.items) item.scanned = true;
  tx.kind = 'service';
  tx.servicePayment = {
    type: RESERVATION_CHECK_IN_TYPE,
    referenceId,
    revenueKey: 'greenFees',
    revenueSplit: split,
    amount,
    reservationId: reservation.id,
  };

  return { ok: true, tx, reservation };
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
) {
  if (!tx || tx.kind !== 'service' || !tx.servicePayment) {
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

  const snapshottedFee = paymentAmountFor(reservation);
  const referenceId = reservationPaymentReference(reservation.id);
  const expectedPayment = paymentLinesFor(reservation);
  const paymentLinesMatch = Array.isArray(tx.items)
    && tx.items.length === expectedPayment.lines.length
    && tx.items.every((item, index) => {
      const expected = expectedPayment.lines[index];
      return item.uid === expected.uid
        && item.skuId === expected.skuId
        && item.name === expected.name
        && round2(item.price) === round2(expected.price)
        && item.scanned === true;
    });
  if (
    !Number.isFinite(snapshottedFee)
    || snapshottedFee < 0
    || service.type !== RESERVATION_CHECK_IN_TYPE
    || service.referenceId !== referenceId
    || round2(service.amount) !== snapshottedFee
    || !ticketedDepositIsConsistent(state, reservation)
    || !paymentLinesMatch
    || round2(tx.discount || 0) !== 0
    || round2(totalOf(tx)) !== snapshottedFee
    || round2(dueOf(tx)) !== snapshottedFee
  ) {
    return { ok: false, reason: 'The payment no longer matches the booked green fee.' };
  }

  const fulfilled = finishVirtualFulfilment(tx);
  if (!fulfilled.ok) return fulfilled;

  const banked = completeServicePayment(state, tx, {
    type: RESERVATION_CHECK_IN_TYPE,
    referenceId,
    revenueKey: 'greenFees',
    revenueSplit: expectedPayment.split,
    expectedTotal: snapshottedFee,
    customer: reservation.fullName || reservation.name,
    details: {
      reservationId: reservation.id,
      customerId: reservation.customerId || null,
      dayAbs: reservation.dayAbs,
      minute: reservation.minute,
      depositPaid: round2(reservation.depositPaid || 0),
      depositReferenceId: reservation.depositReferenceId || null,
      totalReservationFee: round2(reservation.fee),
      greenFeeSubtotal: round2(reservation.greenFeeSubtotal ?? reservation.fee),
      cartRentalFee: round2(reservation.cartRentalFee || 0),
      cartsRequested: reservation.cartsRequested || 0,
    },
  });
  if (!banked.ok) return banked;

  const checkedInAt = state.clock ? state.clock.minutes : null;
  reservation.checkInTransactionNumber = banked.ticket.number;
  reservation.checkInReferenceId = referenceId;
  reservation.paymentMethod = tx.method;
  reservation.paidAmount = snapshottedFee;
  reservation.totalPaid = round2((reservation.depositPaid || 0) + snapshottedFee);
  reservation.paymentStatus = 'paid';
  reservation.payment ||= {};
  reservation.payment.total = round2(reservation.fee ?? reservation.totalPaid);
  reservation.payment.amountPaid = reservation.totalPaid;
  reservation.payment.amountDue = 0;
  reservation.payment.status = 'paid';
  reservation.payment.method = tx.method;
  // A pre-production compatibility path allowed callers to attach an
  // untracked deposit/balance directly to a legacy booking. Preserve that
  // observable balance for old tests/saves; ticketed deposits use the durable
  // zero-balance lifecycle.
  if (reservation.depositStatus !== 'legacy-untracked') {
    reservation.balanceDue = 0;
    reservation.remainingBalance = 0;
  }
  reservation.arrivalStatus = 'arrived';
  const checkedIn = finalizeReservationCheckInState(state, reservation, { atMinute: checkedInAt });
  if (!checkedIn.ok) return checkedIn;
  const cart = beginCartTrip(state, reservation, { at: checkedInAt });
  if (!reservation.visitHistoryRecorded && reservation.customerId) {
    const recorded = recordCustomerVisit(state, reservation.customerId, {
      dayAbs: reservation.dayAbs,
      purpose: reservation.customerType === 'walk-in' ? 'walk-in-tee' : 'tee-time',
      outcome: 'check-in',
      paymentMethod: tx.method,
      amount: snapshottedFee,
    });
    if (recorded.ok) reservation.visitHistoryRecorded = true;
  }

  return {
    ok: true,
    fee: snapshottedFee,
    reservation,
    receipt: fulfilled.receipt,
    ticket: banked.ticket,
    cart,
  };
}
