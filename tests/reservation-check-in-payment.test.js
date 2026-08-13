import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import {
  bookSlot,
  bookReservation,
  checkInReservation,
  RESERVATION_DEPOSIT_TYPE,
} from '../src/sim/reservations.js';
import {
  requestPayment,
  presentCard,
  insertCard,
  submitCardAmount,
  enterCardDigit,
  totalOf,
  runCard,
  retryCard,
  customerCash,
  acceptCash,
  openDrawer,
  depositTendered,
  takeFromDrawer,
  handOverChange,
  changeDue,
  makeChange,
  newDrawer,
  stackTotal,
} from '../src/sim/register.js';
import {
  RESERVATION_CHECK_IN_TYPE,
  createReservationCheckInTx,
  finalizeReservationCheckIn,
  reconcileReservationCheckInTickets,
  reservationPaymentReference,
} from '../src/sim/reservationCheckIn.js';

const rngFor = (sequence) => {
  let index = 0;
  return () => sequence[index++ % sequence.length];
};

const round2 = (value) => Math.round(value * 100) / 100;

// The reader opens at 0.00; the operator keys the figure before confirming.
const confirmExactAmount = (tx) => {
  for (const digit of String(Math.round(totalOf(tx) * 100))) enterCardDigit(tx, Number(digit));
  return submitCardAmount(tx);
};

function reserve(state, name = 'Ray Falk', minute = 480) {
  const day = calendarOf(state.clock.minutes).dayAbs + 1;
  const made = bookSlot(state, day, minute, name);
  assert.equal(made.ok, true);
  return made.res;
}

function approvedCard(state, reservation, rng = rngFor([0.9])) {
  const made = createReservationCheckInTx(state, reservation.id, { method: 'card', rng });
  assert.equal(made.ok, true);
  const { tx } = made;
  assert.equal(tx.items.length, 1);
  assert.equal(tx.items[0].scanned, true, 'the virtual green-fee line starts scanned');
  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  assert.equal(confirmExactAmount(tx).ok, true);
  const card = runCard(tx);
  assert.equal(card.result, 'approved');
  return tx;
}

function cashAtReceipt(state, reservation, tender = 40) {
  if (!state.shop.drawer) state.shop.drawer = newDrawer();
  const made = createReservationCheckInTx(state, reservation.id, {
    method: 'cash',
    rng: rngFor([0.9]),
  });
  assert.equal(made.ok, true);
  const { tx } = made;
  assert.equal(requestPayment(tx).ok, true);
  customerCash(tx);
  tx.tendered = makeChange(tender);
  assert.equal(acceptCash(tx).ok, true);
  assert.equal(openDrawer(tx).ok, true);
  assert.equal(depositTendered(tx, state.shop.drawer).ok, true);
  for (const [denom, count] of Object.entries(makeChange(changeDue(tx)))) {
    for (let i = 0; i < count; i += 1) {
      assert.equal(takeFromDrawer(tx, state.shop.drawer, Number(denom)).ok, true);
    }
  }
  assert.equal(handOverChange(tx, state.shop.drawer).ok, true);
  assert.equal(tx.stage, 'receipt');
  return tx;
}

test('card check-in banks one typed green-fee ticket without touching merchandise analytics', () => {
  const state = newGame('relaxed', 712);
  const reservation = reserve(state);
  const cashBefore = state.cash;
  const shopRevenueBefore = state.ledger.today.revenue.shopSales;
  const liveBefore = structuredClone(state.shop.salesLive || {});
  const velocityBefore = structuredClone(state.shop.salesToday || {});
  const heldBefore = structuredClone(state.shop.held || []);

  const tx = approvedCard(state, reservation);
  assert.equal(state.cash, cashBefore, 'approval alone does not bank money');
  const result = finalizeReservationCheckIn(state, tx);

  assert.equal(result.ok, true);
  assert.equal(result.fee, reservation.fee);
  assert.equal(state.cash, cashBefore + reservation.fee);
  assert.equal(state.ledger.today.revenue.greenFees, reservation.fee);
  assert.equal(state.ledger.today.revenue.shopSales, shopRevenueBefore);
  assert.deepEqual(state.shop.salesLive || {}, liveBefore);
  assert.deepEqual(state.shop.salesToday || {}, velocityBefore);
  assert.deepEqual(state.shop.held || [], heldBefore);
  assert.equal(state.shop.transactionHistory.length, 1);
  assert.deepEqual(
    {
      type: state.shop.transactionHistory[0].type,
      referenceId: state.shop.transactionHistory[0].referenceId,
      customer: state.shop.transactionHistory[0].customer,
      revenueKey: state.shop.transactionHistory[0].revenueKey,
      total: state.shop.transactionHistory[0].total,
    },
    {
      type: RESERVATION_CHECK_IN_TYPE,
      referenceId: reservationPaymentReference(reservation.id),
      customer: 'Ray Falk',
      revenueKey: 'greenFees',
      total: reservation.fee,
    },
  );
  assert.equal(reservation.status, 'played');
  assert.equal(reservation.checkInTransactionNumber, state.shop.transactionHistory[0].number);
  assert.equal(reservation.paymentMethod, 'card');
  assert.equal(reservation.paidAmount, reservation.fee);
});

test('cash check-in commits the transaction-local drawer only at finalization', () => {
  const state = newGame('relaxed', 713);
  const reservation = reserve(state, 'Robin K');
  state.shop.drawer = newDrawer();
  const opening = stackTotal(state.shop.drawer);
  const cashBefore = state.cash;
  const tx = cashAtReceipt(state, reservation, 40);

  assert.equal(stackTotal(state.shop.drawer), opening, 'cash handling is still transaction-local');
  const result = finalizeReservationCheckIn(state, tx);
  assert.equal(result.ok, true);
  assert.equal(result.ticket.method, 'cash');
  assert.equal(round2(stackTotal(state.shop.drawer) - opening), reservation.fee);
  assert.equal(state.cash, cashBefore + reservation.fee);
  assert.equal(state.ledger.today.revenue.greenFees, reservation.fee);
  assert.equal(state.ledger.today.revenue.shopSales, 0);
});

test('decline and retry remain compatible, and a decline cannot check the golfer in', () => {
  const state = newGame('relaxed', 714);
  const reservation = reserve(state, 'Casey L');
  const cashBefore = state.cash;
  const made = createReservationCheckInTx(state, reservation.id, {
    method: 'card',
    rng: rngFor([0.01, 0.9]),
  });
  assert.equal(made.ok, true);
  const { tx } = made;
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  confirmExactAmount(tx);
  assert.equal(runCard(tx, { force: 'declined' }).result, 'declined');

  assert.equal(finalizeReservationCheckIn(state, tx).ok, false);
  assert.equal(reservation.status, 'booked');
  assert.equal(state.cash, cashBefore);
  assert.equal(state.shop.transactionHistory.length, 0);

  assert.equal(retryCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  assert.equal(confirmExactAmount(tx).ok, true);
  assert.equal(runCard(tx).result, 'approved');
  assert.equal(finalizeReservationCheckIn(state, tx).ok, true);
  assert.equal(reservation.status, 'played');
});

test('the same reservation cannot bank twice, even from a freshly-created transaction', () => {
  const state = newGame('relaxed', 715);
  const reservation = reserve(state);
  const first = approvedCard(state, reservation);
  assert.equal(finalizeReservationCheckIn(state, first).ok, true);
  const cashAfterFirst = state.cash;
  const feesAfterFirst = state.ledger.today.revenue.greenFees;

  assert.equal(finalizeReservationCheckIn(state, first).ok, false, 'the same tx is idempotent');
  assert.equal(state.cash, cashAfterFirst);
  assert.equal(state.shop.transactionHistory.length, 1);
  assert.equal(createReservationCheckInTx(state, reservation.id).ok, false, 'played bookings cannot create a new tx');

  // Even a corrupted renderer/save that reopens the status cannot evade the
  // persisted service reference in transaction history.
  reservation.status = 'booked';
  const duplicate = approvedCard(state, reservation);
  const refused = finalizeReservationCheckIn(state, duplicate);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /already banked/i);
  assert.equal(state.cash, cashAfterFirst);
  assert.equal(state.ledger.today.revenue.greenFees, feesAfterFirst);
  assert.equal(state.shop.transactionHistory.length, 1);
});

test('a payment cannot finalize a different reservation', () => {
  const state = newGame('relaxed', 716);
  const first = reserve(state, 'First Golfer', 480);
  const second = reserve(state, 'Second Golfer', 510);
  const tx = approvedCard(state, first);
  const cashBefore = state.cash;

  const refused = finalizeReservationCheckIn(state, tx, second.id);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /different reservation/i);
  assert.equal(first.status, 'booked');
  assert.equal(second.status, 'booked');
  assert.equal(state.cash, cashBefore);
  assert.equal(state.shop.transactionHistory.length, 0);
});

test('legacy check-in stays compatible and blocks a pending monitor payment from charging again', () => {
  const state = newGame('relaxed', 717);
  const reservation = reserve(state, 'Legacy Golfer');
  const made = createReservationCheckInTx(state, reservation.id, { method: 'card', rng: rngFor([0.9]) });
  assert.equal(made.ok, true);
  requestPayment(made.tx);
  presentCard(made.tx);
  insertCard(made.tx);
  confirmExactAmount(made.tx);
  runCard(made.tx);

  const cashBefore = state.cash;
  assert.equal(checkInReservation(state, reservation.id).ok, true);
  const afterLegacy = state.cash;
  assert.equal(afterLegacy, cashBefore + reservation.fee);
  assert.equal(finalizeReservationCheckIn(state, made.tx).ok, false);
  assert.equal(state.cash, afterLegacy, 'the monitor path did not charge a second green fee');
  assert.equal(state.shop.transactionHistory.length, 0, 'legacy behavior remains otherwise unchanged');
});

test('fee/reference rejection rolls back all persistent cash and drawer effects', () => {
  const state = newGame('relaxed', 718);
  const reservation = reserve(state, 'Changed Fee');
  state.shop.drawer = newDrawer();
  const drawerBefore = structuredClone(state.shop.drawer);
  const cashBefore = state.cash;
  const tx = cashAtReceipt(state, reservation, 40);

  reservation.fee += 1;
  const refused = finalizeReservationCheckIn(state, tx);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /no longer matches/i);
  assert.deepEqual(state.shop.drawer, drawerBefore);
  assert.equal(state.cash, cashBefore);
  assert.equal(state.ledger.today.revenue.greenFees, 0);
  assert.equal(state.shop.transactionHistory.length, 0);
  assert.equal(reservation.status, 'booked');
});

test('a balance-mismatched cash journal is rejected without replacing the saved drawer', () => {
  const state = newGame('relaxed', 719);
  const reservation = reserve(state, 'Till Audit');
  state.shop.drawer = newDrawer();
  const drawerBefore = structuredClone(state.shop.drawer);
  const cashBefore = state.cash;
  const tx = cashAtReceipt(state, reservation, 40);
  tx.drawerPending[1] = (tx.drawerPending[1] || 0) + 1;

  const refused = finalizeReservationCheckIn(state, tx);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /does not balance/i);
  assert.deepEqual(state.shop.drawer, drawerBefore);
  assert.equal(state.cash, cashBefore);
  assert.equal(state.ledger.today.revenue.greenFees, 0);
  assert.equal(state.shop.transactionHistory.length, 0);
  assert.equal(reservation.status, 'booked');
});

test('an optional booking deposit charges only the displayed outstanding balance', () => {
  const state = newGame('relaxed', 721);
  const reservation = reserve(state, 'Deposit Golfer');
  reservation.depositPaid = 10;
  reservation.balanceDue = round2(reservation.fee - reservation.depositPaid);
  const cashBefore = state.cash;

  const tx = approvedCard(state, reservation);
  assert.equal(tx.items[0].price, reservation.balanceDue);
  assert.equal(tx.servicePayment.amount, reservation.balanceDue);
  const result = finalizeReservationCheckIn(state, tx);

  assert.equal(result.ok, true);
  assert.equal(result.fee, reservation.balanceDue);
  assert.equal(state.cash, cashBefore + reservation.balanceDue);
  assert.equal(state.ledger.today.revenue.greenFees, reservation.balanceDue);
  assert.equal(reservation.paidAmount, reservation.balanceDue);
  assert.equal(state.shop.transactionHistory[0].total, reservation.balanceDue);
});

test('a ticketed online deposit and physical check-in bank the full fee exactly once between two tickets', () => {
  const state = newGame('relaxed', 722);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs + 1;
  const cashBefore = state.cash;
  const made = bookReservation(state, {
    dayAbs,
    minute: 540,
    name: 'Online Deposit Golfer',
    partySize: 1,
    totalFee: 100,
    deposit: 25,
    paymentPreference: 'card',
  });
  assert.ok(made.ok);
  const reservation = made.res;
  assert.equal(state.cash, cashBefore + 25);
  assert.equal(state.ledger.today.revenue.greenFees, 25);
  assert.equal(state.shop.transactionHistory[0].type, RESERVATION_DEPOSIT_TYPE);

  const tx = approvedCard(state, reservation);
  assert.equal(tx.items[0].price, 75);
  const result = finalizeReservationCheckIn(state, tx);
  assert.ok(result.ok);
  assert.equal(result.fee, 75);
  assert.equal(state.cash, cashBefore + 100);
  assert.equal(state.ledger.today.revenue.greenFees, 100);
  assert.equal(state.shop.transactionHistory.length, 2);
  assert.equal(state.shop.transactionHistory[0].type, RESERVATION_CHECK_IN_TYPE);
  assert.equal(state.shop.transactionHistory[0].details.depositPaid, 25);
  assert.equal(state.shop.transactionHistory[0].details.depositReferenceId, reservation.depositReferenceId);
  assert.equal(reservation.totalPaid, 100);
  assert.equal(reservation.balanceDue, 0);
  assert.equal(createReservationCheckInTx(state, reservation.id).ok, false, 'played booking cannot create another balance payment');

  const loaded = deserialize(serialize(state));
  const saved = loaded.reservations.booked.find((entry) => entry.id === reservation.id);
  assert.equal(saved.depositTransactionNumber, reservation.depositTransactionNumber);
  assert.equal(saved.checkInTransactionNumber, reservation.checkInTransactionNumber);
  assert.equal(saved.totalPaid, 100);
  assert.equal(loaded.cash, state.cash);
  assert.equal(loaded.shop.transactionHistory.length, 2);
});

test('ticketed deposit provenance rejects a rewritten paid amount or outstanding balance', () => {
  const state = newGame('relaxed', 723);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs + 1;
  const reservation = bookReservation(state, {
    dayAbs,
    minute: 570,
    name: 'Deposit Integrity Golfer',
    partySize: 1,
    totalFee: 100,
    deposit: 25,
  }).res;
  const cashAfterDeposit = state.cash;
  reservation.depositPaid = 30;
  reservation.deposit = 30;
  reservation.balanceDue = 70;

  const refused = createReservationCheckInTx(state, reservation.id, { method: 'card' });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /invalid green fee/i);
  assert.equal(state.cash, cashAfterDeposit);
  assert.equal(state.ledger.today.revenue.greenFees, 25);
  assert.equal(state.shop.transactionHistory.length, 1);
  assert.equal(state.shop.transactionHistory[0].type, RESERVATION_DEPOSIT_TYPE);
});

test('completed reservation payment provenance survives save/load', () => {
  const state = newGame('relaxed', 720);
  const reservation = reserve(state, 'Saved Golfer');
  const tx = approvedCard(state, reservation);
  const result = finalizeReservationCheckIn(state, tx);
  assert.equal(result.ok, true);

  const loaded = deserialize(serialize(state));
  const saved = loaded.reservations.booked.find((entry) => entry.id === reservation.id);
  assert.equal(saved.status, 'played');
  assert.equal(saved.checkInReferenceId, reservationPaymentReference(reservation.id));
  assert.equal(saved.checkInTransactionNumber, result.ticket.number);
  assert.equal(saved.paymentMethod, 'card');
  assert.equal(saved.paidAmount, reservation.fee);
  assert.equal(loaded.shop.transactionHistory.length, 1);
  assert.equal(loaded.shop.transactionHistory[0].type, RESERVATION_CHECK_IN_TYPE);
  assert.equal(loaded.shop.transactionHistory[0].referenceId, saved.checkInReferenceId);
});

test('a fully prepaid cash reservation completes its zero-dollar check-in without fake tender', () => {
  const state = newGame('relaxed', 724);
  const reservation = reserve(state, 'Prepaid Cash Golfer');
  reservation.payment.amountPaid = reservation.fee;
  reservation.payment.amountDue = 0;
  reservation.payment.status = 'paid';
  reservation.payment.method = 'cash';
  reservation.paymentPreference = 'cash';
  reservation.depositPaid = reservation.fee;
  reservation.depositStatus = 'legacy-untracked';
  reservation.balanceDue = 0;
  reservation.remainingBalance = 0;
  const cashBefore = state.cash;

  const made = createReservationCheckInTx(state, reservation.id, { method: 'cash' });
  assert.equal(made.ok, true, made.reason);
  assert.equal(made.tx.items[0].price, 0);
  assert.equal(requestPayment(made.tx).ok, true);
  assert.equal(made.tx.stage, 'receipt');
  assert.deepEqual(made.tx.tendered, {});

  const result = finalizeReservationCheckIn(state, made.tx);
  assert.equal(result.ok, true, result.reason);
  assert.equal(state.cash, cashBefore);
  assert.equal(result.ticket.total, 0);
  assert.equal(reservation.status, 'played');
  assert.equal(reservation.payment.method, 'cash');
  assert.equal(reservation.payment.amountDue, 0);
});

test('a forged zero-dollar typed ticket cannot check in a prepaid reservation on save/load', () => {
  const state = newGame('relaxed', 725);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs + 1;
  const made = bookSlot(state, dayAbs, 480, {
    holder: 'Forged Prepaid Golfer',
    partySize: 1,
    paymentPlan: 'prepaid',
    paymentMethod: 'card',
    cardOnFile: true,
  });
  assert.equal(made.ok, true, made.reason);
  const reservation = made.res;
  const referenceId = reservationPaymentReference(reservation.id);

  // A type/reference pair alone is not a durable settlement authority. This
  // deliberately omits the WAL-backed details, customer event, item line,
  // timestamp, and ledger provenance owned by a genuine checkout ticket.
  state.shop.transactionHistory.unshift({
    type: RESERVATION_CHECK_IN_TYPE,
    referenceId,
    number: 999,
    method: 'cash',
    total: 0,
    serviceTotal: 0,
  });

  const direct = reconcileReservationCheckInTickets(state);
  assert.equal(direct.ok, false);
  assert.equal(direct.pending, 1);
  assert.equal(reservation.status, 'booked');
  assert.equal(reservation.courseAccess.status, 'none');
  assert.equal(reservation.checkInTransactionNumber, undefined);

  const loaded = deserialize(serialize(state));
  const restored = loaded.reservations.booked.find((entry) => entry.id === reservation.id);
  assert.equal(restored.status, 'booked');
  assert.equal(restored.courseAccess.status, 'none');
  assert.equal(restored.checkInTransactionNumber, undefined);
  assert.equal(restored.payment.method, 'card', 'forged cash tender cannot replace prepaid provenance');
});

test('a completed legacy-deposit check-in remains an idempotent durable outbox', () => {
  const state = newGame('relaxed', 726);
  const reservation = reserve(state, 'Legacy Deposit Outbox');
  reservation.depositPaid = 10;
  reservation.balanceDue = round2(reservation.fee - reservation.depositPaid);

  const tx = approvedCard(state, reservation);
  const completed = finalizeReservationCheckIn(state, tx, reservation.id);
  assert.equal(completed.ok, true, completed.reason);
  assert.equal(reservation.status, 'played');
  assert.equal(completed.ticket.details.priorPaid, 10);
  assert.equal(reservation.payment.amountPaid, reservation.fee);

  const before = serialize(state);
  const reconciled = reconcileReservationCheckInTickets(state);
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.pending, 0);
  assert.equal(reconciled.already, 1);
  assert.equal(serialize(state), before, 'replaying the valid ticket changes no durable authority');
});

test('a frozen reservation payment authority refuses before any settlement authority mutates', () => {
  const state = newGame('relaxed', 727);
  const reservation = reserve(state, 'Frozen Payment Golfer');
  const tx = approvedCard(state, reservation);
  reservation.payment = Object.freeze({ ...reservation.payment });
  const before = structuredClone({
    cash: state.cash,
    ledger: state.ledger,
    transactionHistory: state.shop.transactionHistory,
    pendingCheckouts: state.shop.pendingCheckouts,
    reservation,
  });

  let refused;
  assert.doesNotThrow(() => {
    refused = finalizeReservationCheckIn(state, tx);
  });
  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic || refused.reason, /reservation.+not writable/i);
  assert.notEqual(tx.commitPrepared, true);
  assert.deepEqual(structuredClone({
    cash: state.cash,
    ledger: state.ledger,
    transactionHistory: state.shop.transactionHistory,
    pendingCheckouts: state.shop.pendingCheckouts,
    reservation,
  }), before, 'cash, books, ticket history, WAL, and reservation remain unchanged');
});

test('duplicate reservation settlement references fail closed before either ticket mutates the booking', () => {
  const state = newGame('relaxed', 728);
  state.shop.nextTransactionNo = 10;
  const reservation = reserve(state, 'Duplicate Reference Golfer');
  const tx = approvedCard(state, reservation);
  const booked = structuredClone(reservation);
  const completed = finalizeReservationCheckIn(state, tx);
  assert.equal(completed.ok, true, completed.reason);
  assert.equal(completed.ticket.number, 10);

  const duplicate = structuredClone(completed.ticket);
  duplicate.number = 1;
  const reservationIndex = state.reservations.booked.findIndex(
    (entry) => entry.id === reservation.id,
  );
  state.reservations.booked[reservationIndex] = booked;
  state.shop.transactionHistory.unshift(duplicate);
  const before = structuredClone(state.reservations.booked[reservationIndex]);

  const report = reconcileReservationCheckInTickets(state);
  assert.equal(report.ok, false);
  assert.equal(report.applied, 0);
  assert.ok(report.pending > 0);
  assert.match(
    report.failures[0]?.diagnostic || report.failures[0]?.reason || '',
    /duplicate|conflict/i,
  );
  assert.deepEqual(
    state.reservations.booked[reservationIndex],
    before,
    'ambiguous ticket provenance cannot choose a transaction number or check the party in',
  );
});
