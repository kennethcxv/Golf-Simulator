// G13 — ONE VISIT, ONE PAYMENT.
//
// The brief writes the flow it wants as six numbered steps:
//
//   1. they collect items from the shelves
//   2. they come to the desk and put the items down
//   3. I scan each item
//   4. then they ask for their tee time
//   5. I book or check in
//   6. I charge them for the items and the green fee together
//      - ONE TRANSACTION, ONE PAYMENT.
//
// Step 6 was not mistuned, it was absent. `beginReservationPayment` refused to
// start while a goods ticket was open, `createReservationCheckInTx` built its
// own ticket carrying exactly one virtual line, and `completeServicePayment`
// posted the WHOLE ticket total to greenFees. Two tickets was the only
// reachable flow, and the merge was named as a seam by the previous goal and
// left unbuilt.
//
// This file is the contract for the merged ticket. The part that matters most
// is not that the two can ride together - it is that the MONEY STILL LANDS ON
// THE RIGHT LINES when they do. A combined ticket that banks the shirt as green
// fee revenue is worse than two tickets, because it is wrong quietly.

import test from 'node:test';
import assert from 'node:assert/strict';

import { deserialize, newGame, serialize } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import {
  bookSlot, reservationById, selectWalkInSlot, walkInAvailability,
} from '../src/sim/reservations.js';
import { pickFromShelf, heldUnits } from '../src/sim/checkout.js';
import {
  createTx, scanItem, completeSale, requestPayment, presentCard, insertCard,
  submitCardAmount, enterCardDigit, runCard, totalOf, taxOf,
  printReceipt, takeReceipt, packReceipt, bagItem, allBagged, handOverGoods,
  serviceLinesOf, goodsLinesOf,
  customerCash, acceptCash, openDrawer, depositTendered, takeFromDrawer,
  handOverChange, changeDue, makeChange, newDrawer,
} from '../src/sim/register.js';
import {
  attachGreenFeeToTx,
  finalizeReservationCheckIn,
  GREEN_FEE_SKU,
  reconcileReservationCheckInTickets,
  RESERVATION_CHECK_IN_TYPE,
  reservationPaymentReference,
} from '../src/sim/reservationCheckIn.js';
import {
  allocateCustomerIdentity, customerIdentityById, identityForReservation,
  reconcileCustomerVisitEvents, recordCustomerVisitEvent,
} from '../src/sim/customerIdentity.js';

const rngFor = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };
const round2 = (v) => Math.round(v * 100) / 100;

const confirmExactAmount = (tx) => {
  for (const d of String(Math.round(totalOf(tx) * 100))) enterCardDigit(tx, Number(d));
  return submitCardAmount(tx);
};

function reserve(state, name = 'Ray Falk', minute = 480) {
  const day = calendarOf(state.clock.minutes).dayAbs + 1;
  const made = bookSlot(state, day, minute, name);
  assert.equal(made.ok, true);
  identityForReservation(state, made.res);
  return made.res;
}

// Step 1: the customer actually lifts them off the shelf, so the stock the sale
// consumes is stock that really moved.
function collectFromShelves(state, tx) {
  for (const item of tx.items) {
    if (heldUnits(state).some((u) => u.uid === item.uid)) continue;
    // The repo's established idiom for putting a unit on the shelf in a test.
    // Note it only carries ONE pick: the count guard passes but the underlying
    // lot is finite, so a second ticket for the same SKU fails at the lot plan.
    const inv = state.shop.inventory[item.skuId];
    if (inv.shelf <= 0) inv.shelf = 1;
    const picked = pickFromShelf(state, item.skuId, item.uid);
    assert.equal(picked.ok, true, `${item.skuId}: ${picked.reason}`);
  }
}

// Steps 1-3: goods on the counter, every one scanned.
function goodsOnCounter(state, mode = 'relaxed', tag = 'a') {
  const tx = createTx({
    items: [
      { uid: `${tag}1`, skuId: 'balls3', name: 'Pro-V dozen', price: 47 },
      { uid: `${tag}2`, skuId: 'glove1', name: 'Cabretta glove', price: 19 },
    ],
    mode,
    rng: rngFor([0.1, 0.9]),
  });
  collectFromShelves(state, tx);
  for (const it of tx.items) scanItem(tx, it.uid);
  return tx;
}

// Step 6, physically: one card, one approval.
function payOnce(tx) {
  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  assert.equal(confirmExactAmount(tx).ok, true);
  assert.equal(runCard(tx).result, 'approved');
  assert.equal(printReceipt(tx).ok, true);
  assert.equal(takeReceipt(tx).ok, true);
  assert.equal(packReceipt(tx).ok, true);
  for (const item of tx.items) if (!item.bagged) bagItem(tx, item.uid);
  assert.equal(allBagged(tx), true, 'a tee time is not something you put in a bag');
  assert.equal(handOverGoods(tx).ok, true);
}

function payCashOnce(state, tx) {
  state.shop.drawer ||= newDrawer();
  tx.prefer = 'cash';
  assert.equal(requestPayment(tx).ok, true);
  customerCash(tx);
  assert.equal(acceptCash(tx).ok, true);
  assert.equal(openDrawer(tx).ok, true);
  assert.equal(depositTendered(tx, state.shop.drawer).ok, true);
  for (const [denom, count] of Object.entries(makeChange(changeDue(tx)))) {
    for (let index = 0; index < count; index += 1) {
      assert.equal(takeFromDrawer(tx, state.shop.drawer, Number(denom)).ok, true);
    }
  }
  assert.equal(handOverChange(tx, state.shop.drawer).ok, true);
  assert.equal(printReceipt(tx).ok, true);
  assert.equal(takeReceipt(tx).ok, true);
  assert.equal(packReceipt(tx).ok, true);
  for (const item of tx.items) if (!item.bagged) bagItem(tx, item.uid);
  assert.equal(handOverGoods(tx).ok, true);
}

test('the tee time joins the ticket the goods are already on', () => {
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);

  const attached = attachGreenFeeToTx(state, tx, res.id);
  assert.equal(attached.ok, true, 'step 5 must be reachable with goods on the counter');

  // one ticket, three lines, and the fee is one of them
  assert.equal(tx.items.length, 3);
  const fee = tx.items.find((i) => i.skuId === GREEN_FEE_SKU);
  assert.ok(fee, 'the green fee is a line on this ticket');
  assert.equal(fee.scanned, true, 'a tee time is not scanned with a barcode gun');
  assert.equal(round2(fee.price), round2(res.fee));
});

test('the ticket total is the goods plus the fee', () => {
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  const goodsTotal = totalOf(tx);

  attachGreenFeeToTx(state, tx, res.id);
  assert.equal(round2(totalOf(tx)), round2(goodsTotal + res.fee),
    'one number to read out to the customer');
});

test('golf is still not taxed just because it rode in with a shirt', () => {
  // The green fee is deliberately untaxed - whether a round is a taxable
  // service varies by state and is not a thing to guess at inside a check-in.
  // Merging must not quietly start charging sales tax on golf.
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  tx.taxRate = 0.07;
  const taxOnGoodsAlone = round2(taxOf(tx));

  attachGreenFeeToTx(state, tx, res.id);
  assert.equal(round2(taxOf(tx)), taxOnGoodsAlone,
    'the fee must not enter the taxable base');
});

test('one payment, and the money lands on BOTH revenue lines', () => {
  const state = newGame();
  const res = reserve(state);
  const before = {
    shop: state.ledger.today.revenue.shopSales || 0,
    green: state.ledger.today.revenue.greenFees || 0,
  };
  const tx = goodsOnCounter(state);
  const goodsTotal = totalOf(tx);
  attachGreenFeeToTx(state, tx, res.id);
  payOnce(tx);

  const done = finalizeReservationCheckIn(state, tx, res.id);
  assert.equal(done.ok, true, done.reason);

  const after = {
    shop: state.ledger.today.revenue.shopSales || 0,
    green: state.ledger.today.revenue.greenFees || 0,
  };
  // THE WHOLE POINT: the split is by line, not by ticket.
  assert.equal(round2(after.green - before.green), round2(res.fee),
    'greenFees moves by the fee and not a penny more');
  assert.equal(round2(after.shop - before.shop), round2(goodsTotal),
    'shopSales moves by the goods and not a penny more');
});

test('it is one ticket number and one payment method, not two', () => {
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  attachGreenFeeToTx(state, tx, res.id);
  payOnce(tx);
  const done = finalizeReservationCheckIn(state, tx, res.id);
  assert.equal(done.ok, true, done.reason);

  const booking = reservationById(state, res.id);
  assert.equal(booking.status, 'played', 'the round is checked in');
  assert.equal(booking.paymentMethod, 'card');
  // the reservation points at the SAME ticket the shirt was on
  assert.equal(booking.checkInTransactionNumber, done.ticket.number);
});

test('the banked combined ticket records one exact customer visit and payment', () => {
  const state = newGame();
  const res = reserve(state, 'Exact History Golfer');
  const tx = goodsOnCounter(state, 'relaxed', 'history-');
  attachGreenFeeToTx(state, tx, res.id);
  const paidTotal = totalOf(tx);
  payOnce(tx);

  // This is deliberately the simulation bank call with no renderer/onPaid
  // callback after it. Durable customer accounting must already be complete.
  const done = finalizeReservationCheckIn(state, tx, res.id);
  assert.equal(done.ok, true, done.reason);
  assert.equal(done.customerVisitRecorded, true);
  assert.equal(reservationById(state, res.id).visitHistoryRecorded, true);

  const history = customerIdentityById(state, res.customerId).visitHistory;
  assert.equal(history.totalVisits, 1, 'one person walked through the door');
  assert.equal(history.completedCheckIns, 1, 'the round is one recorded outcome');
  assert.equal(history.completedPurchases, 1, 'the goods are one recorded outcome');
  assert.equal(history.cardPayments, 1, 'the single card is counted once');
  assert.equal(history.cashPayments, 0);
  assert.equal(history.lifetimeSpend, round2(paidTotal),
    'spend is the exact whole ticket, not the fee plus the whole ticket');
  assert.equal(history.firstVisitDayAbs, res.dayAbs,
    'combined accounting retains the reservation day, not renderer wall time');

  assert.equal(done.ticket.customerVisitEvent.status, 'applied');
  assert.equal(done.ticket.customerVisitRecorded, true);
  assert.match(done.ticket.customerVisitEvent.id, /^checkout:.+:customer-visit$/);
  const once = JSON.stringify(history);
  assert.equal(reconcileCustomerVisitEvents(state).ok, true);
  assert.equal(reconcileCustomerVisitEvents(state).ok, true);
  assert.equal(JSON.stringify(history), once, 'reconciliation is an exact no-op after apply');
});

test('a fully prepaid tee time remains a zero-dollar service on one combined retail visit', () => {
  const state = newGame();
  const dayAbs = calendarOf(state.clock.minutes).dayAbs + 1;
  const made = bookSlot(state, dayAbs, 480, {
    holder: 'Prepaid Combined Golfer',
    partySize: 1,
    paymentPlan: 'prepaid',
    paymentMethod: 'card',
    cardOnFile: true,
  });
  assert.equal(made.ok, true);
  const reservation = made.res;
  identityForReservation(state, reservation);
  assert.equal(reservation.payment.amountPaid, reservation.fee);
  assert.equal(reservation.payment.amountDue, 0);
  assert.equal(reservation.depositPaid, 0,
    'prepayment is not misrepresented as a deposit');

  const greenBefore = state.ledger.today.revenue.greenFees || 0;
  const bookingBefore = state.ledger.today.revenue.bookingRevenue || 0;
  const cashBefore = state.cash;
  const tx = goodsOnCounter(state, 'relaxed', 'prepaid-combined-');
  const goodsTotal = totalOf(tx);
  const bookedBeforeSettlement = structuredClone(reservation);
  const attached = attachGreenFeeToTx(state, tx, reservation.id);
  assert.equal(attached.ok, true, attached.reason);
  assert.equal(attached.amount, 0);
  assert.equal(serviceLinesOf(tx).length, 1);
  assert.equal(serviceLinesOf(tx)[0].price, 0);
  payCashOnce(state, tx);

  const done = finalizeReservationCheckIn(state, tx, reservation.id);
  assert.equal(done.ok, true, done.reason);
  const referenceId = reservationPaymentReference(reservation.id);
  assert.equal(done.ticket.type, RESERVATION_CHECK_IN_TYPE,
    'zero balance cannot erase the check-in ticket identity');
  assert.equal(done.ticket.referenceId, referenceId);
  assert.equal(done.ticket.serviceTotal, 0);
  assert.equal(done.ticket.total, goodsTotal);
  assert.equal(done.ticket.customerVisitEvent.amount, done.ticket.total,
    'the customer event records the retail money exchanged on this visit');
  assert.equal(state.cash, round2(cashBefore + goodsTotal));
  assert.equal(state.ledger.today.revenue.greenFees || 0, greenBefore,
    'the already-posted green fee is not banked twice');
  assert.equal(state.ledger.today.revenue.bookingRevenue || 0, bookingBefore,
    'advance booking revenue is unchanged at physical check-in');

  const history = customerIdentityById(state, reservation.customerId).visitHistory;
  assert.equal(history.totalVisits, 1);
  assert.equal(history.completedCheckIns, 1);
  assert.equal(history.completedPurchases, 1);
  assert.equal(history.cashPayments, 1);
  assert.equal(history.cardPayments, 0);
  assert.equal(history.lifetimeSpend, goodsTotal,
    'the visit records only the money exchanged at this combined payment');
  assert.equal(history.lastVisitPurpose, 'tee-time+retail');

  const checkedIn = reservationById(state, reservation.id);
  assert.equal(checkedIn.status, 'played');
  assert.equal(checkedIn.paidAmount, 0);
  assert.equal(checkedIn.totalPaid, checkedIn.fee,
    'the existing prepaid amount survives the zero-balance check-in');
  assert.equal(checkedIn.payment.amountPaid, checkedIn.fee);
  assert.equal(checkedIn.payment.amountDue, 0);
  assert.equal(checkedIn.payment.status, 'paid');
  assert.equal(checkedIn.payment.method, 'card',
    'a zero-dollar check-in keeps the canonical advance-payment tender');
  assert.equal(checkedIn.paymentMethod, 'cash',
    'the compatibility field records the tender used for the retail ticket');

  const immediateReplay = reconcileReservationCheckInTickets(state);
  assert.equal(immediateReplay.ok, true, JSON.stringify(immediateReplay));
  assert.equal(immediateReplay.already, 1);

  const loaded = deserialize(serialize(state));
  const loadedReservation = reservationById(loaded, reservation.id);
  const loadedTicket = loaded.shop.transactionHistory.find(
    (entry) => entry.type === RESERVATION_CHECK_IN_TYPE && entry.referenceId === referenceId,
  );
  assert.ok(loadedTicket, 'the zero-dollar service reference survives save/load');
  assert.equal(loadedTicket.serviceTotal, 0);
  assert.equal(loadedReservation.totalPaid, loadedReservation.fee);
  assert.equal(loadedReservation.payment.amountPaid, loadedReservation.fee);
  const loadedReplay = reconcileReservationCheckInTickets(loaded);
  assert.equal(loadedReplay.ok, true, JSON.stringify(loadedReplay));
  assert.equal(loadedReplay.already, 1);

  const tailLostRaw = JSON.parse(serialize(state));
  const reservationIndex = tailLostRaw.reservations.booked.findIndex(
    (entry) => entry.id === reservation.id,
  );
  tailLostRaw.reservations.booked[reservationIndex] = bookedBeforeSettlement;
  const tailRecovered = deserialize(JSON.stringify(tailLostRaw));
  const recoveredReservation = reservationById(tailRecovered, reservation.id);
  assert.equal(recoveredReservation.status, 'played',
    'save/load replays a genuine prepaid combined ticket after a torn reservation tail');
  const recoveredReplay = reconcileReservationCheckInTickets(tailRecovered);
  assert.equal(recoveredReplay.ok, true, JSON.stringify(recoveredReplay));
  assert.equal(recoveredReplay.already, 1);
  assert.equal(loadedReservation.payment.method, 'card');
  assert.equal(loadedReservation.paymentMethod, 'cash');
  assert.equal(customerIdentityById(loaded, reservation.customerId).visitHistory.completedCheckIns, 1);
});

test('a pending banked ticket repairs customer history once across save/load', () => {
  const state = newGame();
  const res = reserve(state, 'Recovered History Golfer');
  const tx = goodsOnCounter(state, 'relaxed', 'recovered-history-');
  attachGreenFeeToTx(state, tx, res.id);
  const paidTotal = totalOf(tx);
  payOnce(tx);
  const done = finalizeReservationCheckIn(state, tx, res.id);
  assert.equal(done.ok, true, done.reason);

  // Model the only dangerous checkpoint: money/ticket persisted while the
  // derived customer aggregate did not. The ticket event remains the outbox.
  const raw = JSON.parse(serialize(state));
  const rawCustomer = raw.customerDirectory.customers.find(
    (customer) => customer.customerId === res.customerId,
  );
  Object.assign(rawCustomer.visitHistory, {
    totalVisits: 0,
    completedPurchases: 0,
    completedCheckIns: 0,
    noShows: 0,
    cancellations: 0,
    cashPayments: 0,
    cardPayments: 0,
    lifetimeSpend: 0,
    firstVisitDayAbs: null,
    lastVisitDayAbs: null,
    lastVisitPurpose: null,
    lastPaymentMethod: null,
    appliedEvents: [],
  });
  raw.shop.transactionHistory[0].customerVisitRecorded = false;
  raw.shop.transactionHistory[0].customerVisitEvent.status = 'pending';
  raw.reservations.booked.find((reservation) => reservation.id === res.id).visitHistoryRecorded = false;

  const recovered = deserialize(JSON.stringify(raw));
  const recoveredHistory = customerIdentityById(recovered, res.customerId).visitHistory;
  assert.equal(recoveredHistory.totalVisits, 1);
  assert.equal(recoveredHistory.completedCheckIns, 1);
  assert.equal(recoveredHistory.completedPurchases, 1);
  assert.equal(recoveredHistory.cardPayments, 1);
  assert.equal(recoveredHistory.lifetimeSpend, round2(paidTotal));
  assert.equal(recoveredHistory.appliedEvents.length, 1);
  assert.equal(recovered.shop.transactionHistory[0].customerVisitRecorded, true);
  assert.equal(recovered.shop.transactionHistory[0].customerVisitEvent.status, 'applied');
  assert.equal(reservationById(recovered, res.id).visitHistoryRecorded, true,
    'reservation compatibility flag follows the reconciled ticket event');

  const recoveredAgain = deserialize(serialize(recovered));
  assert.deepEqual(
    customerIdentityById(recoveredAgain, res.customerId).visitHistory,
    recoveredHistory,
    'a second reconciliation cannot double the repaired event',
  );
});

test('reusing a customer event id with different money is rejected without mutation', () => {
  const state = newGame();
  const customer = allocateCustomerIdentity(state, { sourceId: 'event-conflict-customer' });
  const tx = goodsOnCounter(state, 'relaxed', 'event-conflict-');
  payOnce(tx);
  const done = completeSale(state, tx, customer);
  assert.equal(done.ok, true, done.reason);
  const before = JSON.stringify(customer.visitHistory);

  const conflicting = {
    ...done.ticket.customerVisitEvent,
    outcomes: [...done.ticket.customerVisitEvent.outcomes],
    amount: done.ticket.customerVisitEvent.amount + 1,
  };
  const replay = recordCustomerVisitEvent(state, conflicting);
  assert.equal(replay.ok, false);
  assert.equal(replay.conflict, true);
  assert.equal(JSON.stringify(customer.visitHistory), before);
});

test('an ordinary banked retail ticket records one purchase at the same boundary', () => {
  const state = newGame();
  const customer = allocateCustomerIdentity(state, { sourceId: 'retail-history-customer' });
  const tx = goodsOnCounter(state, 'relaxed', 'retail-history-');
  const paidTotal = totalOf(tx);
  payOnce(tx);

  const done = completeSale(state, tx, customer);
  assert.equal(done.ok, true, done.reason);
  assert.equal(done.customerVisitRecorded, true);
  const history = customer.visitHistory;
  assert.equal(history.totalVisits, 1);
  assert.equal(history.completedPurchases, 1);
  assert.equal(history.completedCheckIns, 0);
  assert.equal(history.cashPayments, 0);
  assert.equal(history.cardPayments, 1);
  assert.equal(history.lifetimeSpend, round2(paidTotal));
  assert.equal(history.lastVisitPurpose, 'retail');
  assert.equal(history.lastPaymentMethod, 'card');
});

test('the combined ticket retains customer identity through save history', () => {
  const state = newGame();
  const res = reserve(state, 'Identity Golfer');
  const tx = goodsOnCounter(state);
  attachGreenFeeToTx(state, tx, res.id);
  payOnce(tx);

  const done = finalizeReservationCheckIn(state, tx, res.id);
  assert.equal(done.ok, true, done.reason);
  assert.equal(done.ticket.customerId, res.customerId);
  assert.equal(state.shop.transactionHistory[0].customerId, res.customerId);
  assert.equal(state.shop.transactionHistory[0].customer, res.fullName || res.name);
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.shop.transactionHistory[0].customerId, res.customerId);
});

test('a new walk-in booking remains payable after save/load before payment', () => {
  const state = newGame();
  const dayAbs = calendarOf(state.clock.minutes).dayAbs;
  const slot = walkInAvailability(state, { dayAbs, partySize: 1 })[0];
  assert.ok(slot, 'the deterministic opening state offers a same-day walk-in slot');
  const made = selectWalkInSlot(state, {
    dayAbs,
    minute: slot.minute,
    customerId: 'combined-save-customer',
    name: 'Saved Walk-In',
    fullName: 'Saved Walk-In',
    partySize: 1,
    paymentPreference: 'card',
  });
  assert.equal(made.ok, true, made.reason);

  const tx = goodsOnCounter(state, 'relaxed', 'save-combined-');
  assert.equal(attachGreenFeeToTx(state, tx, made.res.id).ok, true);
  assert.equal(heldUnits(state).length, 2, 'the goods are still owned by the open checkout');

  const loaded = deserialize(serialize(state));
  const booking = reservationById(loaded, made.res.id);
  assert.ok(booking, 'the newly-created booking survives reload');
  assert.equal(booking.status, 'booked', 'an unbanked fee never checks the golfer in early');
  assert.equal(booking.customerId, 'combined-save-customer');
  assert.deepEqual(heldUnits(loaded), [], 'reload rolls the abandoned merchandise hold back');
  assert.equal(loaded.shop.transactionHistory.length, 0, 'reload cannot invent a payment');

  const retry = goodsOnCounter(loaded, 'relaxed', 'retry-combined-');
  const reattached = attachGreenFeeToTx(loaded, retry, booking.id);
  assert.equal(reattached.ok, true, reattached.reason);
  assert.equal(retry.items.filter((item) => item.skuId === GREEN_FEE_SKU).length, 1,
    'the surviving booking has one coherent retry path');
});

test('the same booking cannot be checked in twice through the merged door', () => {
  const state = newGame();
  const res = reserve(state);

  const first = goodsOnCounter(state);
  attachGreenFeeToTx(state, first, res.id);
  payOnce(first);
  const firstDone = finalizeReservationCheckIn(state, first, res.id);
  assert.equal(firstDone.ok, true, firstDone.reason);

  // A second ticket at the desk, reaching for a round that is already paid for.
  const second = createTx({ items: [], mode: 'relaxed', rng: rngFor([0.1, 0.9]) });
  const again = attachGreenFeeToTx(state, second, res.id);
  assert.equal(again.ok, false, 'a played round is not still bookable');
});

test('a ticket refuses to carry the same fee twice', () => {
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  assert.equal(attachGreenFeeToTx(state, tx, res.id).ok, true);
  const twice = attachGreenFeeToTx(state, tx, res.id);
  assert.equal(twice.ok, false, 'one round, one line');
  assert.equal(tx.items.length, 3, 'and the ticket is not left with a stray line');
});

test('a duplicate service line is rejected before paid fulfilment mutates the ticket', () => {
  const state = newGame();
  const res = reserve(state, 'Duplicate Service Golfer');
  const tx = goodsOnCounter(state, 'relaxed', 'duplicate-service-');
  assert.equal(attachGreenFeeToTx(state, tx, res.id).ok, true);
  tx.items.push({
    uid: 'duplicate-service:cart',
    skuId: 'service:cart-rental',
    name: 'Duplicate zero-dollar service',
    priceCents: 0,
    price: 0,
    scanned: true,
    bagged: false,
  });

  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  assert.equal(confirmExactAmount(tx).ok, true);
  assert.equal(runCard(tx).result, 'approved');
  const before = {
    stage: tx.stage,
    receiptPrinted: tx.receiptPrinted,
    receiptPacked: tx.receiptPacked,
    bagged: tx.items.map((item) => item.bagged),
  };
  const cashBefore = state.cash;

  const refused = finalizeReservationCheckIn(state, tx, res.id);
  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic || refused.reason, /exactly one ticket line/i);
  assert.deepEqual({
    stage: tx.stage,
    receiptPrinted: tx.receiptPrinted,
    receiptPacked: tx.receiptPacked,
    bagged: tx.items.map((item) => item.bagged),
  }, before, 'validation must happen before receipt, bagging, or handoff state advances');
  assert.equal(tx.banked, undefined);
  assert.equal(state.cash, cashBefore);
  assert.equal(state.shop.transactionHistory.length, 0);
  assert.equal(reservationById(state, res.id).status, 'booked');
});

test('the line split is by class, not by the green fee alone', () => {
  // Requirement 6 - fix the class, not the instance. A cart rental or a lesson
  // must ride the same rails without further surgery, so the split keys on the
  // service prefix rather than on this one SKU.
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  attachGreenFeeToTx(state, tx, res.id);

  assert.equal(goodsLinesOf(tx).length, 2);
  assert.equal(serviceLinesOf(tx).length, 1);
  // the classifier reads the prefix, so an unrelated service is also caught
  tx.items.push({ uid: 'cart', skuId: 'service:cart-rental', name: 'Cart', priceCents: 2000, price: 20 });
  assert.equal(serviceLinesOf(tx).length, 2, 'any service: line is a service line');
  assert.equal(goodsLinesOf(tx).length, 2, 'and no goods line was reclassified');
});

// --- what the books adversary found, and what now stops it ------------------

test('the fee cannot bank through the sale door without clearing the booking', () => {
  // completeSale can post to greenFees now, but it knows nothing about the
  // reservation - not whether it is still booked, not how to flip it to played.
  // If it banked anyway, the shop would take money for a tee time the sheet
  // still shows as open, and the no-show fee would land on top of it.
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  attachGreenFeeToTx(state, tx, res.id);
  payOnce(tx);

  const sneaked = completeSale(state, tx, 'A customer');
  assert.equal(sneaked.ok, false, 'the sale door must refuse an uncleared booking');
  assert.match(sneaked.reason, /check-in/i);
  assert.equal(round2(state.ledger.today.revenue.greenFees || 0), 0,
    'and not a penny of it reached the books');
  assert.equal(reservationById(state, res.id).status, 'booked',
    'the round is untouched, so it can still be checked in properly');

  // and the proper door still works afterwards
  assert.equal(finalizeReservationCheckIn(state, tx, res.id).ok, true);
});

test('the merged ticket leaves a service-typed trail behind it', () => {
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  attachGreenFeeToTx(state, tx, res.id);
  payOnce(tx);
  assert.equal(finalizeReservationCheckIn(state, tx, res.id).ok, true);

  const row = state.shop.transactionHistory[0];
  assert.ok(row, 'the visit is on the ticket history');
  assert.equal(row.referenceId, `reservation:${res.id}:check-in`,
    'the row names the booking it settled');
  assert.equal(round2(row.serviceTotal), round2(res.fee),
    'and says how much of the total was the round');
  assert.ok(row.total > row.serviceTotal, 'the rest of the total is the merchandise');
});

test('a tee time never enters the merchandise velocity window', () => {
  // The per-SKU tally is what Inventory reorders from. A tee time has no shelf,
  // so a phantom SKU in there is a reorder nobody can ever fill.
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  attachGreenFeeToTx(state, tx, res.id);
  payOnce(tx);
  assert.equal(finalizeReservationCheckIn(state, tx, res.id).ok, true);

  const sold = state.shop.salesToday || {};
  assert.equal(sold[GREEN_FEE_SKU], undefined,
    'the green fee is not a stock keeping unit');
  assert.ok(sold.balls3 > 0, 'and the real merchandise still counted');
});
