import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import { bookSlot } from '../src/sim/reservations.js';
import { heldUnits, pickFromShelf } from '../src/sim/checkout.js';
import {
  allocateCustomerIdentity,
  createCustomerVisitEvent,
  customerIdentityById,
  identityForReservation,
  preflightCustomerVisitEvent,
  reconcileCustomerVisitEvents,
  recordCustomerVisitEvent,
} from '../src/sim/customerIdentity.js';
import {
  bagItem,
  completeSale,
  createTx,
  enterCardDigit,
  goodsLinesOf,
  handOverGoods,
  insertCard,
  packReceipt,
  presentCard,
  printReceipt,
  requestPayment,
  runCard,
  scanItem,
  submitCardAmount,
  takeReceipt,
  totalOf,
} from '../src/sim/register.js';
import {
  createReservationCheckInTx,
  finalizeReservationCheckIn,
  reconcileReservationCheckInTickets,
} from '../src/sim/reservationCheckIn.js';

function approveCardToReceipt(tx) {
  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  for (const digit of String(Math.round(totalOf(tx) * 100))) {
    assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
  }
  assert.equal(submitCardAmount(tx).ok, true);
  assert.equal(runCard(tx, { force: 'approved' }).result, 'approved');
}

function finishRetailCard(tx) {
  approveCardToReceipt(tx);
  assert.equal(printReceipt(tx).ok, true);
  assert.equal(takeReceipt(tx).ok, true);
  assert.equal(packReceipt(tx).ok, true);
  for (const item of goodsLinesOf(tx)) assert.equal(bagItem(tx, item.uid).ok, true);
  assert.equal(handOverGoods(tx).ok, true);
}

test('a visit event atomically replaces even a frozen prior history object', () => {
  const state = newGame('relaxed', 25101);
  const customer = allocateCustomerIdentity(state, { sourceId: 'atomic-history' });
  const prior = customer.visitHistory;
  const priorSnapshot = structuredClone(prior);
  Object.freeze(prior);
  const event = createCustomerVisitEvent({
    id: 'atomic-history-event',
    customerId: customer.customerId,
    dayAbs: 12,
    purpose: 'retail',
    outcomes: ['purchase'],
    countsAsVisit: true,
    paymentMethod: 'card',
    amount: 24.5,
  });

  assert.equal(preflightCustomerVisitEvent(state, event).ok, true);
  const recorded = recordCustomerVisitEvent(state, event);
  assert.equal(recorded.ok, true, recorded.reason);
  assert.notEqual(customer.visitHistory, prior, 'publication is one property replacement');
  assert.deepEqual(prior, priorSnapshot, 'the frozen authority is never partially mutated');
  assert.equal(customer.visitHistory.completedPurchases, 1);
  assert.equal(customer.visitHistory.lifetimeSpend, 24.5);
  assert.deepEqual(customer.visitHistory.appliedEvents.map(({ id }) => id), [event.id]);
});

test('an unwritable customer history authority rejects before checkout core mutation', () => {
  const state = newGame('relaxed', 25102);
  const customer = allocateCustomerIdentity(state, { sourceId: 'blocked-history' });
  Object.defineProperty(customer, 'visitHistory', {
    value: customer.visitHistory,
    writable: false,
    enumerable: true,
    configurable: true,
  });

  state.shop.inventory.balls1.shelf = Math.max(1, state.shop.inventory.balls1.shelf || 0);
  const picked = pickFromShelf(state, 'balls1', 'blocked-history-unit');
  assert.equal(picked.ok, true, picked.reason);
  const tx = createTx({
    id: 'blocked-history-checkout',
    items: [{
      uid: 'blocked-history-unit',
      skuId: 'balls1',
      name: 'Practice Balls',
      price: 15,
    }],
    mode: 'relaxed',
    prefer: 'card',
    taxRate: 0.07,
    rng: () => 0.9,
  });
  assert.equal(scanItem(tx, 'blocked-history-unit').ok, true);
  finishRetailCard(tx);

  const before = JSON.stringify(state);
  const heldBefore = structuredClone(heldUnits(state));
  const result = completeSale(state, tx, customer);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'Customer history is unavailable right now. Try again.');
  assert.match(result.diagnostic || result.reason, /history.*not writable/i);
  assert.equal(JSON.stringify(state), before, 'money, stock, ledgers, and tickets stay untouched');
  assert.deepEqual(heldUnits(state), heldBefore);
  assert.notEqual(tx.banked, true);
  assert.deepEqual(Object.keys(state.shop.pendingCheckouts || {}), []);
});

test('an immutable reservation history flag cannot throw or strand a paid check-in', () => {
  const state = newGame('relaxed', 25103);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs + 1;
  const booked = bookSlot(state, dayAbs, 8 * 60, 'Immutable Flag Golfer');
  assert.equal(booked.ok, true, booked.reason);
  const reservation = booked.res;
  const customer = identityForReservation(state, reservation);
  const made = createReservationCheckInTx(state, reservation.id, { method: 'card' });
  assert.equal(made.ok, true, made.reason);
  approveCardToReceipt(made.tx);

  Object.defineProperty(reservation, 'visitHistoryRecorded', {
    value: false,
    writable: false,
    enumerable: true,
    configurable: true,
  });

  const result = finalizeReservationCheckIn(state, made.tx, reservation.id);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.customerVisitRecorded, true);
  assert.equal(result.ticket.customerVisitRecorded, true);
  assert.equal(result.ticket.customerVisitEvent.status, 'applied');
  assert.equal(reservation.status, 'played');
  assert.equal(reservation.visitHistoryRecorded, false,
    'the immutable compatibility projection may remain stale without blocking authority');
  assert.equal(customerIdentityById(state, customer.customerId).visitHistory.completedCheckIns, 1);
  assert.deepEqual(Object.keys(state.shop.pendingCheckouts || {}), []);

  assert.doesNotThrow(() => reconcileCustomerVisitEvents(state));
  const customerReplay = reconcileCustomerVisitEvents(state);
  assert.equal(customerReplay.ok, true);
  assert.doesNotThrow(() => reconcileReservationCheckInTickets(state));
  const reservationReplay = reconcileReservationCheckInTickets(state);
  assert.equal(reservationReplay.ok, true);
  assert.equal(reservation.status, 'played');
});

test('a lower-numbered forged customer event cannot claim a genuine event identity', () => {
  const state = newGame('relaxed', 25104);
  const customer = allocateCustomerIdentity(state, { sourceId: 'ambiguous-history' });
  const event = createCustomerVisitEvent({
    id: 'ambiguous-history-event',
    customerId: customer.customerId,
    dayAbs: 12,
    purpose: 'retail',
    outcomes: ['purchase'],
    countsAsVisit: true,
    paymentMethod: 'card',
    amount: 24.5,
  });
  state.shop.transactionHistory = [
    {
      number: 2,
      transactionId: 'genuine-customer-event-ticket',
      customerVisitEvent: { ...event },
      customerVisitRecorded: false,
    },
    {
      number: 1,
      transactionId: 'forged-customer-event-ticket',
      customerVisitEvent: { ...event, purpose: 'forged', amount: 999 },
      customerVisitRecorded: false,
    },
  ];
  const historyBefore = structuredClone(customer.visitHistory);
  const ticketsBefore = structuredClone(state.shop.transactionHistory);

  const report = reconcileCustomerVisitEvents(state);

  assert.equal(report.ok, false);
  assert.equal(report.pending, 1);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].eventId, event.id);
  assert.match(report.failures[0].diagnostic || report.failures[0].reason, /duplicate|conflict|ambiguous/i);
  assert.deepEqual(customer.visitHistory, historyBefore,
    'neither conflicting signature may claim the customer journal');
  assert.deepEqual(state.shop.transactionHistory, ticketsBefore,
    'ambiguous ticket projections remain untouched for explicit repair');
});

test('an ambiguous customer event blocks unrelated batch projections before mutation', () => {
  const state = newGame('relaxed', 25105);
  const conflicted = allocateCustomerIdentity(state, { sourceId: 'conflicted-batch-history' });
  const unrelated = allocateCustomerIdentity(state, { sourceId: 'unrelated-batch-history' });
  const reservation = { id: 'ambiguous-batch-reservation', visitHistoryRecorded: false };
  state.reservations.booked.push(reservation);
  const shared = createCustomerVisitEvent({
    id: 'ambiguous-batch-event',
    customerId: conflicted.customerId,
    dayAbs: 13,
    purpose: 'tee-time',
    outcomes: ['check-in'],
    countsAsVisit: true,
    paymentMethod: 'cash',
    amount: 40,
    reservationId: reservation.id,
  });
  const independent = createCustomerVisitEvent({
    id: 'independent-batch-event',
    customerId: unrelated.customerId,
    dayAbs: 13,
    purpose: 'retail',
    outcomes: ['purchase'],
    countsAsVisit: true,
    paymentMethod: 'card',
    amount: 15,
  });
  state.shop.transactionHistory = [
    { number: 1, customerVisitEvent: { ...independent }, customerVisitRecorded: false },
    { number: 2, customerVisitEvent: { ...shared }, customerVisitRecorded: false },
    {
      number: 3,
      customerVisitEvent: { ...shared, paymentMethod: 'card' },
      customerVisitRecorded: false,
    },
  ];
  const authoritiesBefore = structuredClone({
    conflicted: conflicted.visitHistory,
    unrelated: unrelated.visitHistory,
    tickets: state.shop.transactionHistory,
    reservation,
  });

  const report = reconcileCustomerVisitEvents(state);

  assert.equal(report.ok, false);
  assert.deepEqual({
    conflicted: conflicted.visitHistory,
    unrelated: unrelated.visitHistory,
    tickets: state.shop.transactionHistory,
    reservation,
  }, authoritiesBefore, 'the full recovery batch stays pure when any event id is ambiguous');
});

test('a unique forged ticket event cannot claim another customer without ledger authority', () => {
  const state = newGame('relaxed', 25106);
  const victim = allocateCustomerIdentity(state, { sourceId: 'forged-event-victim' });
  const other = allocateCustomerIdentity(state, { sourceId: 'forged-event-ticket-owner' });
  state.shop.transactionHistory = [{
    number: 1,
    transactionId: 'forged-unique-customer-event',
    customerId: other.customerId,
    method: 'card',
    total: 0.01,
    customerVisitEvent: createCustomerVisitEvent({
      id: 'checkout:forged-unique-customer-event:customer-visit',
      customerId: victim.customerId,
      dayAbs: 4,
      purpose: 'retail',
      outcomes: ['purchase'],
      countsAsVisit: true,
      paymentMethod: 'cash',
      amount: 0.01,
    }),
    customerVisitRecorded: false,
  }];
  const before = structuredClone({
    victim: victim.visitHistory,
    other: other.visitHistory,
    tickets: state.shop.transactionHistory,
  });

  const report = reconcileCustomerVisitEvents(state);

  assert.equal(report.ok, false);
  assert.match(report.failures[0].diagnostic || report.failures[0].reason, /does not match its ticket/i);
  assert.deepEqual({
    victim: victim.visitHistory,
    other: other.visitHistory,
    tickets: state.shop.transactionHistory,
  }, before);
});

test('an unsafe-cent customer event is rejected before any recovery projection', () => {
  const state = newGame('relaxed', 25107);
  const customer = allocateCustomerIdentity(state, { sourceId: 'unsafe-cent-event' });
  const unsafeAmount = (Number.MAX_SAFE_INTEGER + 1) / 100;
  state.shop.transactionHistory = [{
    number: 1,
    transactionId: 'unsafe-cent-customer-event',
    customerId: customer.customerId,
    method: 'cash',
    total: unsafeAmount,
    customerVisitEvent: {
      id: 'checkout:unsafe-cent-customer-event:customer-visit',
      customerId: customer.customerId,
      dayAbs: 4,
      purpose: 'retail',
      outcomes: ['purchase'],
      countsAsVisit: true,
      paymentMethod: 'cash',
      amount: unsafeAmount,
      reservationId: null,
    },
    customerVisitRecorded: false,
  }];
  const before = structuredClone({ history: customer.visitHistory, tickets: state.shop.transactionHistory });

  const report = reconcileCustomerVisitEvents(state);

  assert.equal(report.ok, false);
  assert.match(report.failures[0].diagnostic || report.failures[0].reason, /too large|invalid/i);
  assert.deepEqual({ history: customer.visitHistory, tickets: state.shop.transactionHistory }, before);
});

test('an already-applied exact event does not depend on retained ledger history', () => {
  const state = newGame('relaxed', 25108);
  const customer = allocateCustomerIdentity(state, { sourceId: 'pruned-ledger-history' });
  const event = createCustomerVisitEvent({
    id: 'checkout:pruned-ledger-history-sale:customer-visit',
    customerId: customer.customerId,
    dayAbs: 5,
    purpose: 'retail',
    outcomes: ['purchase'],
    countsAsVisit: true,
    paymentMethod: 'card',
    amount: 12,
  });
  const applied = recordCustomerVisitEvent(state, event);
  assert.equal(applied.ok, true);
  const ticket = {
    number: 1,
    transactionId: 'pruned-ledger-history-sale',
    customerId: customer.customerId,
    method: 'card',
    total: 12,
    customerVisitEvent: { ...event },
    customerVisitRecorded: false,
  };
  state.shop.transactionHistory = [ticket];
  const historyBefore = structuredClone(customer.visitHistory);

  const report = reconcileCustomerVisitEvents(state);

  assert.equal(report.ok, true);
  assert.equal(report.already, 1);
  assert.deepEqual(customer.visitHistory, historyBefore);
  assert.equal(ticket.customerVisitRecorded, true);
});
