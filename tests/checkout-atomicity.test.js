import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import { addRevenue, preflightLedgerEntry } from '../src/sim/economy.js';
import { checkoutSale, heldUnits, pickFromShelf } from '../src/sim/checkout.js';
import {
  acceptCash,
  bagItem,
  bankServiceCharge,
  changeDue,
  completeSale,
  completeServicePayment,
  createTx,
  depositTendered,
  enterCardDigit,
  handOverChange,
  handOverGoods,
  insertCard,
  makeChange,
  newDrawer,
  openDrawer,
  packReceipt,
  presentCard,
  printReceipt,
  requestPayment,
  runCard,
  scanItem,
  submitCardAmount,
  takeFromDrawer,
  takeReceipt,
  totalOf,
} from '../src/sim/register.js';
import { bookSlot } from '../src/sim/reservations.js';
import {
  createReservationCheckInTx,
  finalizeReservationCheckIn,
} from '../src/sim/reservationCheckIn.js';
import { calendarOf } from '../src/sim/time.js';

function finishCashSale(state, item, extraChange = 0) {
  state.shop.drawer = newDrawer();
  const tx = createTx({ items: [item], mode: 'relaxed', prefer: 'cash', rng: () => 0.9 });
  assert.equal(scanItem(tx, item.uid).ok, true);
  assert.equal(requestPayment(tx).ok, true);
  tx.tendered = makeChange(20);
  assert.equal(acceptCash(tx).ok, true);
  assert.equal(openDrawer(tx).ok, true);
  assert.equal(depositTendered(tx, state.shop.drawer).ok, true);
  for (const [denom, count] of Object.entries(makeChange(changeDue(tx) + extraChange))) {
    for (let index = 0; index < count; index += 1) {
      assert.equal(takeFromDrawer(tx, state.shop.drawer, Number(denom)).ok, true);
    }
  }
  assert.equal(handOverChange(tx, state.shop.drawer).ok, true);
  assert.equal(printReceipt(tx).ok, true);
  assert.equal(takeReceipt(tx).ok, true);
  assert.equal(packReceipt(tx).ok, true);
  assert.equal(bagItem(tx, item.uid).ok, true);
  assert.equal(handOverGoods(tx).ok, true);
  return tx;
}

function approvedReservationTx(state, reservation) {
  const made = createReservationCheckInTx(state, reservation.id, {
    method: 'card',
    rng: () => 0.9,
  });
  assert.equal(made.ok, true);
  const { tx } = made;
  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  for (const digit of String(Math.round(totalOf(tx) * 100))) {
    assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
  }
  assert.equal(submitCardAmount(tx).ok, true);
  assert.equal(runCard(tx).result, 'approved');
  return tx;
}

function reservationFor(state, name = 'Atomic Golfer') {
  const day = calendarOf(state.clock.minutes).dayAbs + 1;
  const made = bookSlot(state, day, 8 * 60, name);
  assert.equal(made.ok, true);
  return made.res;
}

test('completeSale preflights cash-over-short before consuming stock or committing the drawer', () => {
  const state = newGame('relaxed', 1601);
  const item = { uid: 'atomic-cash-unit', skuId: 'balls1', name: 'Practice Balls', price: 15 };
  assert.equal(pickFromShelf(state, item.skuId, item.uid).ok, true);
  const tx = finishCashSale(state, item, 1);
  assert.equal(tx.lost, 1);
  const varianceKey = `checkout:${tx.id}:cash-over-short`;
  state.ledger.processedIds[varianceKey] = 'missing-ledger-entry';

  const before = {
    cash: state.cash,
    drawer: structuredClone(state.shop.drawer),
    held: structuredClone(heldUnits(state)),
    inventory: structuredClone(state.shop.inventory),
    lifecycle: structuredClone(state.shop.inventoryLifecycle),
    ledger: structuredClone(state.ledger),
  };
  const result = completeSale(state, tx, 'Atomic cash customer');

  assert.equal(result.ok, false);
  assert.match(result.reason, /checkpoint is incomplete/i);
  assert.notEqual(tx.banked, true);
  assert.equal(state.cash, before.cash);
  assert.deepEqual(state.shop.drawer, before.drawer);
  assert.deepEqual(heldUnits(state), before.held);
  assert.deepEqual(state.shop.inventory, before.inventory);
  assert.deepEqual(state.shop.inventoryLifecycle, before.lifecycle);
  assert.deepEqual(state.ledger, before.ledger);
});

test('checkoutSale preflights COGS before moving a direct-sale basket', () => {
  const state = newGame('relaxed', 1602);
  const item = { uid: 'atomic-direct-unit', skuId: 'balls1', price: 15 };
  assert.equal(pickFromShelf(state, item.skuId, item.uid).ok, true);
  const transactionId = 'atomic-direct-sale';
  state.ledger.processedIds[`checkout:${transactionId}:cogs`] = 'missing-ledger-entry';
  const before = {
    cash: state.cash,
    held: structuredClone(heldUnits(state)),
    inventory: structuredClone(state.shop.inventory),
    lifecycle: structuredClone(state.shop.inventoryLifecycle),
    ledger: structuredClone(state.ledger),
  };

  const result = checkoutSale(state, [item], 'Atomic direct customer', transactionId);
  assert.equal(result.ok, false);
  assert.match(result.reason, /checkpoint is incomplete/i);
  assert.equal(state.cash, before.cash);
  assert.deepEqual(heldUnits(state), before.held);
  assert.deepEqual(state.shop.inventory, before.inventory);
  assert.deepEqual(state.shop.inventoryLifecycle, before.lifecycle);
  assert.deepEqual(state.ledger, before.ledger);
});

test('missing held allocations return provenance-incomplete instead of throwing', () => {
  const state = newGame('relaxed', 1603);
  const item = { uid: 'corrupt-held-unit', skuId: 'balls1', price: 15 };
  assert.equal(pickFromShelf(state, item.skuId, item.uid).ok, true);
  delete state.shop.inventoryLifecycle.heldAllocations[item.uid];
  const before = {
    cash: state.cash,
    held: structuredClone(heldUnits(state)),
    lifecycle: structuredClone(state.shop.inventoryLifecycle),
  };

  let result = null;
  assert.doesNotThrow(() => {
    result = checkoutSale(state, [item], 'Corrupt save', 'corrupt-held-sale');
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /provenance is incomplete/i);
  assert.equal(state.cash, before.cash);
  assert.deepEqual(heldUnits(state), before.held);
  assert.deepEqual(state.shop.inventoryLifecycle, before.lifecycle);
});

test('ledger preflight is pure and rejects a mismatched idempotency checkpoint', () => {
  const state = newGame('relaxed', 1604);
  const key = 'atomic:preflight:pure';
  assert.equal(addRevenue(state, 'greenFees', 5, {
    idempotencyKey: key,
    relatedId: 'original',
  }).ok, true);
  const before = structuredClone(state);

  const result = preflightLedgerEntry(state, {
    direction: 'revenue',
    lineKey: 'greenFees',
    category: 'greenFees',
    amount: 10,
    idempotencyKey: key,
    relatedId: 'different',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /different posting/i);
  assert.deepEqual(state, before);
});

test('direct service charges use their reference once and recover a missing ticket', () => {
  const type = 'atomic-service-charge';
  const referenceId = 'atomic-service-ref';
  const key = `service:${type}:${referenceId}:revenue`;
  const state = newGame('relaxed', 1605);
  const cashBefore = state.cash;

  const first = bankServiceCharge(state, {
    type,
    referenceId,
    amount: 25,
    customer: 'Reference Customer',
  });
  assert.equal(first.ok, true);
  assert.equal(first.already, false);
  assert.equal(state.cash, cashBefore + 25);
  assert.equal(state.shop.transactionHistory.length, 1);
  assert.equal(state.ledger.entries.filter((entry) => entry.idempotencyKey === key).length, 1);

  const cashAfterFirst = state.cash;
  const duplicate = bankServiceCharge(state, {
    type,
    referenceId,
    amount: 25,
    customer: 'Reference Customer',
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.already, true);
  assert.equal(state.cash, cashAfterFirst);
  assert.equal(state.shop.transactionHistory.length, 1);

  // Simulate a crash snapshot that retained the durable ledger post but lost
  // the derived ticket. The retry restores provenance without moving cash.
  state.shop.transactionHistory = [];
  const recovered = bankServiceCharge(state, {
    type,
    referenceId,
    amount: 25,
    customer: 'Reference Customer',
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  assert.equal(state.cash, cashAfterFirst);
  assert.equal(state.shop.transactionHistory.length, 1);
  assert.equal(state.ledger.entries.filter((entry) => entry.idempotencyKey === key).length, 1);
});

test('a failed service preflight creates no ticket and never marks payment banked', () => {
  const state = newGame('relaxed', 1606);
  const reservation = reservationFor(state, 'Failed Preflight Golfer');
  const tx = approvedReservationTx(state, reservation);
  const { type, referenceId } = tx.servicePayment;
  state.ledger.processedIds[`service:${type}:${referenceId}:revenue`] = 'missing-ledger-entry';
  const before = {
    cash: state.cash,
    drawer: structuredClone(state.shop.drawer),
    ledger: structuredClone(state.ledger),
  };

  const result = finalizeReservationCheckIn(state, tx);
  assert.equal(result.ok, false);
  assert.match(result.reason, /checkpoint is incomplete/i);
  assert.notEqual(tx.banked, true);
  assert.equal(reservation.status, 'booked');
  assert.equal(state.shop.transactionHistory.length, 0);
  assert.equal(state.cash, before.cash);
  assert.deepEqual(state.shop.drawer, before.drawer);
  assert.deepEqual(state.ledger, before.ledger);
});

test('service payment ledger recovery rebuilds history without rebanking cash', () => {
  const state = newGame('relaxed', 1607);
  const reservation = reservationFor(state, 'Recovered Payment Golfer');
  const tx = approvedReservationTx(state, reservation);
  const first = finalizeReservationCheckIn(state, tx);
  assert.equal(first.ok, true);
  const cashAfterFirst = state.cash;
  const ledgerCount = state.ledger.entries.length;
  const retry = JSON.parse(JSON.stringify(tx));
  retry.banked = false;
  retry.number = null;
  state.shop.transactionHistory = [];

  const recovered = completeServicePayment(state, retry, {
    type: retry.servicePayment.type,
    referenceId: retry.servicePayment.referenceId,
    revenueKey: retry.servicePayment.revenueKey,
    expectedTotal: retry.servicePayment.amount,
    customer: reservation.fullName || reservation.name,
    details: { reservationId: reservation.id },
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  assert.equal(retry.banked, true);
  assert.equal(state.cash, cashAfterFirst);
  assert.equal(state.ledger.entries.length, ledgerCount);
  assert.equal(state.shop.transactionHistory.length, 1);
});
