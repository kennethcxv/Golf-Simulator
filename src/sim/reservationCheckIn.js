// Reservation check-in payments share the physical register payment machinery
// without pretending a tee time is merchandise.  This adapter owns the stable
// reservation reference and the exact transition from an open booking to the
// persisted checked-in record.

import {
  reservationById,
  RESERVATION_DEPOSIT_TYPE,
  reservationDepositReference,
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
  completeSale,
  serviceTicketByReference,
  goodsLinesOf,
  serviceSubtotal,
} from './register.js';

export const RESERVATION_CHECK_IN_TYPE = 'reservation-check-in';
export const GREEN_FEE_SKU = 'service:green-fee';

const round2 = (value) => Math.round(Number(value) * 100) / 100;

function paymentAmountFor(reservation) {
  return round2(reservation.balanceDue != null ? reservation.balanceDue : reservation.fee);
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

  const snapshottedFee = paymentAmountFor(reservation);
  const referenceId = reservationPaymentReference(reservation.id);
  // ONE TICKET, TWO KINDS OF LINE. When the fee rides with merchandise the
  // ticket total is the whole visit, so the fee is checked against ITS OWN LINE
  // rather than against the total - the total legitimately exceeds it.
  const withGoods = goodsLinesOf(tx).length > 0;
  const virtualLine = withGoods
    ? tx.items.find((item) => item.uid === `${referenceId}:green-fee`)
    : (tx.items && tx.items.length === 1 ? tx.items[0] : null);
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

  // A ticket carrying merchandise banks through the sale door, which splits the
  // money by line: the goods to shopSales, this fee to greenFees. A ticket
  // carrying nothing but the fee banks through the service door as it always has.
  const banked = withGoods
    // Cleared: every reservation check above has just run against the live
    // booking - status, fee, deposit consistency, and the fee line itself.
    ? completeSale(state, tx, reservation.fullName || reservation.name, { serviceCleared: true })
    : completeServicePayment(state, tx, {
      type: RESERVATION_CHECK_IN_TYPE,
      referenceId,
      revenueKey: 'greenFees',
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
      },
    });
  if (!banked.ok) return banked;
  const ticket = banked.ticket || { number: tx.number };

  // Keep `played` for compatibility with the existing tee-sheet and legacy
  // checkInReservation() behavior, while adding durable payment provenance.
  reservation.status = 'played';
  reservation.checkedInAt = state.clock ? state.clock.minutes : null;
  reservation.checkInTransactionNumber = ticket.number;
  reservation.checkInReferenceId = referenceId;
  reservation.paymentMethod = tx.method;
  reservation.paidAmount = snapshottedFee;
  reservation.totalPaid = round2((reservation.depositPaid || 0) + snapshottedFee);
  reservation.paymentStatus = 'paid';
  // A pre-production compatibility path allowed callers to attach an
  // untracked deposit/balance directly to a legacy booking. Preserve that
  // observable balance for old tests/saves; ticketed deposits use the durable
  // zero-balance lifecycle.
  if (reservation.depositStatus !== 'legacy-untracked') {
    reservation.balanceDue = 0;
    reservation.remainingBalance = 0;
  }
  reservation.currentDestination = 'course';
  reservation.arrivalStatus = 'arrived';
  reservation.checkInStatus = 'checked-in';
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
    ticket,
  };
}
