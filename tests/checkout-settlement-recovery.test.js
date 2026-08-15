import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHECKOUT_WAL_SAVE_VERSION,
  deserialize,
  deserializeWithReport,
  newGame,
  serialize,
} from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import {
  beginReservationPayment,
  bookSlot,
  reservationById,
} from '../src/sim/reservations.js';
import {
  checkoutSale,
  heldUnits,
  pickFromShelf,
  returnToShelf,
} from '../src/sim/checkout.js';
import { closeBooks, LEDGER_HISTORY_DAYS } from '../src/sim/economy.js';
import { allocateCustomerIdentity } from '../src/sim/customerIdentity.js';
import {
  adoptExternalInventory,
  INVENTORY_STAGE,
  moveInventory,
} from '../src/sim/inventoryLifecycle.js';
import {
  acceptCash,
  bagItem,
  changeDue,
  completeSale,
  createTx,
  depositTendered,
  enterCardDigit,
  goodsLinesOf,
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
import {
  attachGreenFeeToTx,
  createReservationCheckInTx,
  finalizeReservationCheckIn,
  RESERVATION_CHECK_IN_TYPE,
} from '../src/sim/reservationCheckIn.js';
import {
  pendingCheckoutCount,
  reconcilePendingCheckouts,
} from '../src/sim/checkoutSettlement.js';

const round2 = (value) => Math.round(Number(value) * 100) / 100;

function retailOnCounter(state, {
  id,
  uid,
  skuId = 'balls1',
  name = 'Practice Balls',
  price = 15,
  taxRate = 0.07,
}) {
  const inventory = state.shop.inventory[skuId];
  if (inventory.shelf <= 0) inventory.shelf = 1;
  const picked = pickFromShelf(state, skuId, uid);
  assert.equal(picked.ok, true, picked.reason);

  const tx = createTx({
    id,
    items: [{ uid, skuId, name, price }],
    mode: 'relaxed',
    prefer: 'card',
    taxRate,
    rng: () => 0.9,
  });
  assert.equal(scanItem(tx, uid).ok, true);
  return tx;
}

function finishCardAndHandoff(tx) {
  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  for (const digit of String(Math.round(totalOf(tx) * 100))) {
    assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
  }
  assert.equal(submitCardAmount(tx).ok, true);
  assert.equal(runCard(tx, { force: 'approved' }).result, 'approved');
  assert.equal(printReceipt(tx).ok, true);
  assert.equal(takeReceipt(tx).ok, true);
  assert.equal(packReceipt(tx).ok, true);
  for (const item of goodsLinesOf(tx)) assert.equal(bagItem(tx, item.uid).ok, true);
  assert.equal(handOverGoods(tx).ok, true);
  assert.equal(tx.stage, 'done');
}

function finishCashAndHandoff(state, tx) {
  state.shop.drawer = newDrawer();
  tx.prefer = 'cash';
  assert.equal(requestPayment(tx).ok, true);
  tx.tendered = makeChange(20);
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
  for (const item of goodsLinesOf(tx)) assert.equal(bagItem(tx, item.uid).ok, true);
  assert.equal(handOverGoods(tx).ok, true);
  assert.equal(tx.stage, 'done');
}

function approveCardToReceipt(tx) {
  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  for (const digit of String(Math.round(totalOf(tx) * 100))) {
    assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
  }
  assert.equal(submitCardAmount(tx).ok, true);
  assert.equal(runCard(tx, { force: 'approved' }).result, 'approved');
  assert.equal(tx.stage, 'receipt');
}

function checkoutLedgerEntries(state, transactionId) {
  const prefix = `checkout:${transactionId}:`;
  return state.ledger.entries.filter((entry) => entry.idempotencyKey?.startsWith(prefix));
}

function checkoutInventoryOperations(state, transactionId) {
  const prefix = 'checkout-sale-batch:v2:';
  return Object.entries(state.shop.inventoryLifecycle?.operations || {})
    .filter(([referenceId]) => {
      if (!referenceId.startsWith(prefix)) return false;
      try {
        return JSON.parse(referenceId.slice(prefix.length)).transactionId === transactionId;
      } catch {
        return false;
      }
    });
}

function pendingIds(state) {
  return Object.keys(state.shop.pendingCheckouts || {});
}

function makeGenuineV14CheckoutImage(raw) {
  raw.version = CHECKOUT_WAL_SAVE_VERSION - 1;
  for (const field of [
    'pendingCheckouts',
    'pendingCheckoutsQuarantine',
    'checkoutSettlementReceipts',
    'checkoutSettlementReceiptKeys',
    'checkoutProjectionIds',
  ]) delete raw.shop[field];
  for (const ticket of raw.shop.transactionHistory || []) delete ticket.checkoutSettlement;
  for (const entry of raw.ledger?.entries || []) {
    if (entry.metadata) delete entry.metadata.checkoutSettlement;
  }
  for (const outcome of raw.ledger?.outcomes || []) {
    if (outcome.metadata) delete outcome.metadata.checkoutSettlement;
  }
  const operations = raw.shop.inventoryLifecycle?.operations;
  if (operations && typeof operations === 'object' && !Array.isArray(operations)) {
    for (const referenceId of Object.keys(operations)) {
      if (referenceId.startsWith('checkout-sale-batch:v2:')) delete operations[referenceId];
    }
  }
  if (Array.isArray(raw.shop.inventoryLifecycle?.operationKeys)) {
    raw.shop.inventoryLifecycle.operationKeys = raw.shop.inventoryLifecycle.operationKeys
      .filter((referenceId) => !referenceId.startsWith('checkout-sale-batch:v2:'));
  }
  return raw;
}

function ticketsFor(state, transactionId) {
  return state.shop.transactionHistory.filter((ticket) => ticket.transactionId === transactionId);
}

function coreAuthorities(state) {
  return structuredClone({
    cash: state.cash,
    drawer: state.shop.drawer,
    held: heldUnits(state),
    lifecycle: state.shop.inventoryLifecycle,
    ledgerToday: state.ledger.today,
    ledgerEntries: state.ledger.entries,
    ledgerIds: state.ledger.processedIds,
    outcomes: state.ledger.outcomes,
    outcomeIds: state.ledger.processedOutcomeIds,
    salesLive: state.shop.salesLive,
    salesToday: state.shop.salesToday,
    salesTax: state.salesTax,
    projectionIds: state.shop.checkoutProjectionIds,
    history: state.shop.transactionHistory,
    pending: state.shop.pendingCheckouts,
    nextTransactionNo: state.shop.nextTransactionNo,
  });
}

test('a matching retail ticket without its WAL cannot claim stock or banking authority', () => {
  const state = newGame('relaxed', 24100);
  const tx = retailOnCounter(state, {
    id: 'forged-ticket-only-retail',
    uid: 'forged-ticket-only-retail-unit',
  });
  finishCardAndHandoff(tx);
  state.shop.transactionHistory.unshift({
    number: 91,
    transactionId: tx.id,
    customer: 'Forged Ticket Golfer',
    method: tx.method,
    total: totalOf(tx),
    net: 15,
    tax: 1.05,
    taxRate: tx.taxRate,
    cash: totalOf(tx),
    lost: 0,
    items: tx.items.map((item) => ({
      uid: item.uid,
      skuId: item.skuId,
      name: item.name,
      price: item.price,
    })),
    ledgerEntryIds: {},
    ledgerIdempotencyKeys: {},
    minute: state.clock.minutes,
  });
  const before = coreAuthorities(state);

  const refused = completeSale(state, tx, 'Forged Ticket Golfer');
  assert.equal(refused.ok, false);
  assert.equal(refused.already, true);
  assert.match(refused.diagnostic || refused.reason, /no pending settlement remains to recover/i);
  assert.notEqual(tx.banked, true);
  assert.notEqual(tx.commitPrepared, true);
  assert.deepEqual(coreAuthorities(state), before);
  assert.equal(heldUnits(state).some((item) => item.uid === 'forged-ticket-only-retail-unit'), true);
  assert.equal(checkoutInventoryOperations(state, tx.id).length, 0);
  assert.equal(checkoutLedgerEntries(state, tx.id).length, 0);
});

test('an exhausted ticket sequence cannot publish a retail settlement WAL', () => {
  const state = newGame('relaxed', 24109);
  state.shop.nextTransactionNo = Number.MAX_SAFE_INTEGER;
  const tx = retailOnCounter(state, {
    id: 'ticket-limit-retail',
    uid: 'ticket-limit-retail-unit',
  });
  finishCardAndHandoff(tx);
  const before = coreAuthorities(state);

  const refused = completeSale(state, tx, 'Ticket Limit Golfer');

  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic || refused.reason, /ticket counter.*safe limit|pending checkout settlement is invalid/i);
  assert.notEqual(tx.commitPrepared, true);
  assert.notEqual(tx.banked, true);
  assert.deepEqual(coreAuthorities(state), before);
});

test('a post-core interruption retries the durable retail settlement exactly once', () => {
  const state = newGame('relaxed', 24101);
  const tx = retailOnCounter(state, {
    id: 'wal-retry-retail',
    uid: 'wal-retry-unit',
  });
  finishCardAndHandoff(tx);

  const cashBefore = state.cash;
  const liveBefore = structuredClone(state.shop.salesLive || { units: 0, revenue: 0 });
  const skuSalesBefore = Number(state.shop.salesToday?.balls1) || 0;
  const taxBefore = structuredClone(state.salesTax);
  let faults = 0;

  assert.throws(
    () => completeSale(state, tx, 'WAL Retry Golfer', {
      qaFaultAfterCoreCommit: () => {
        faults += 1;
        throw new Error('test interruption after checkout core commit');
      },
    }),
    /test interruption after checkout core commit/,
  );

  assert.equal(faults, 1);
  assert.notEqual(tx.banked, true);
  assert.equal(tx.commitPrepared, true);
  assert.deepEqual(pendingIds(state), [`checkout:${tx.id}`]);
  assert.equal(ticketsFor(state, tx.id).length, 0, 'the ticket is deliberately after the seam');
  assert.equal(heldUnits(state).some((item) => item.uid === 'wal-retry-unit'), false);
  assert.equal(checkoutInventoryOperations(state, tx.id).length, 1);
  assert.ok(state.cash > cashBefore, 'the ledger-backed cash projection is already committed');
  assert.equal(state.shop.salesLive.units, (liveBefore.units || 0) + 1,
    'the operation-keyed sales projection is part of the core commit');
  assert.equal(round2(state.shop.salesLive.revenue), round2((liveBefore.revenue || 0) + 15));
  assert.equal(state.shop.salesToday.balls1, skuSalesBefore + 1);
  assert.equal(round2(state.salesTax.collected), round2(taxBefore.collected + 1.05));
  assert.equal(round2(state.salesTax.owed), round2(taxBefore.owed + 1.05));
  assert.equal(round2(state.salesTax.taxableSales), round2(taxBefore.taxableSales + 15));

  const cashAfterCore = state.cash;
  const ledgerAfterCore = structuredClone(checkoutLedgerEntries(state, tx.id));
  const inventoryAfterCore = structuredClone(checkoutInventoryOperations(state, tx.id));
  const salesAfterCore = structuredClone(state.shop.salesLive);
  const skuSalesAfterCore = state.shop.salesToday.balls1;
  const taxAfterCore = structuredClone(state.salesTax);
  assert.equal(
    ledgerAfterCore.filter((entry) => entry.idempotencyKey === `checkout:${tx.id}:sale`).length,
    1,
  );

  const retried = completeSale(state, tx, 'WAL Retry Golfer');
  assert.equal(retried.ok, true, retried.reason);
  assert.equal(retried.recovered, true);
  assert.equal(tx.banked, true);
  assert.equal(tx.commitPrepared, false);
  assert.deepEqual(pendingIds(state), []);
  assert.equal(ticketsFor(state, tx.id).length, 1);
  assert.equal(state.cash, cashAfterCore, 'retry cannot bank cash again');
  assert.deepEqual(checkoutLedgerEntries(state, tx.id), ledgerAfterCore,
    'retry reuses every ledger checkpoint');
  assert.deepEqual(checkoutInventoryOperations(state, tx.id), inventoryAfterCore,
    'retry reuses the sold-stock movement');
  assert.deepEqual(state.shop.salesLive, salesAfterCore,
    'retry reuses the sales projection checkpoint');
  assert.equal(state.shop.salesToday.balls1, skuSalesAfterCore);
  assert.deepEqual(state.salesTax, taxAfterCore,
    'retry reuses the tax projection checkpoint');
  for (const [component, idempotencyKey] of Object.entries(retried.ticket.ledgerIdempotencyKeys)) {
    const entryId = retried.ticket.ledgerEntryIds[component];
    assert.equal(typeof entryId, 'string');
    assert.ok(entryId.length > 0, `${component} retains a non-empty ledger entry id`);
    assert.equal(state.ledger.processedIds[idempotencyKey], entryId,
      `${component} ticket provenance resolves to its durable ledger checkpoint`);
  }

  const afterRetry = {
    cash: state.cash,
    ledger: structuredClone(checkoutLedgerEntries(state, tx.id)),
    inventory: structuredClone(checkoutInventoryOperations(state, tx.id)),
    ticketCount: ticketsFor(state, tx.id).length,
    salesLive: structuredClone(state.shop.salesLive),
    skuSales: state.shop.salesToday.balls1,
  };
  assert.equal(completeSale(state, tx, 'WAL Retry Golfer').ok, false);
  assert.deepEqual({
    cash: state.cash,
    ledger: checkoutLedgerEntries(state, tx.id),
    inventory: checkoutInventoryOperations(state, tx.id),
    ticketCount: ticketsFor(state, tx.id).length,
    salesLive: state.shop.salesLive,
    skuSales: state.shop.salesToday.balls1,
  }, afterRetry, 'a later duplicate call changes no authority');
});

test('ambiguous history rows cannot consume a pending retail settlement', () => {
  const state = newGame('relaxed', 24110);
  const tx = retailOnCounter(state, {
    id: 'ambiguous-history-retail',
    uid: 'ambiguous-history-retail-unit',
  });
  finishCardAndHandoff(tx);
  assert.throws(
    () => completeSale(state, tx, 'Genuine History Golfer', {
      qaFaultAfterCoreCommit: () => { throw new Error('capture pending history ambiguity'); },
    }),
    /capture pending history ambiguity/,
  );
  const settlementId = `checkout:${tx.id}`;
  const plan = state.shop.pendingCheckouts[settlementId];
  assert.ok(plan);
  const exact = structuredClone(plan.ticketDraft);
  const forged = structuredClone(plan.ticketDraft);
  forged.customer = 'Forged History Golfer';
  state.shop.transactionHistory = [forged, exact, ...state.shop.transactionHistory];
  const before = coreAuthorities(state);

  const refused = completeSale(state, tx, 'Genuine History Golfer');

  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic || refused.reason, /ticket identity is ambiguous/i);
  assert.deepEqual(coreAuthorities(state), before);
  assert.ok(state.shop.pendingCheckouts[settlementId], 'the WAL remains available for repair');
  assert.notEqual(tx.banked, true);
});

test('lifecycle operation-cap churn after a post-core fault cannot strand an exact checkout retry', () => {
  const state = newGame('relaxed', 24107);
  const tx = retailOnCounter(state, {
    id: 'wal-operation-cap-retry',
    uid: 'wal-operation-cap-unit',
  });
  finishCardAndHandoff(tx);

  assert.throws(() => completeSale(state, tx, 'Operation Cap Golfer', {
    qaFaultAfterCoreCommit: () => {
      throw new Error('operation cap interruption after checkout core commit');
    },
  }), /operation cap interruption after checkout core commit/);

  const settlementId = `checkout:${tx.id}`;
  const plan = state.shop.pendingCheckouts[settlementId];
  assert.ok(plan?.inventory?.referenceId);
  const cashAfterCore = state.cash;
  const ledgerAfterCore = structuredClone(checkoutLedgerEntries(state, tx.id));
  const inventoryAfterCore = structuredClone(checkoutInventoryOperations(state, tx.id));
  const salesAfterCore = structuredClone(state.shop.salesLive);
  const skuSalesAfterCore = state.shop.salesToday.balls1;
  const taxAfterCore = structuredClone(state.salesTax);
  assert.equal(inventoryAfterCore.length, 1);

  const churnLot = adoptExternalInventory(state, {
    skuId: 'balls2',
    quantity: 1,
    stage: INVENTORY_STAGE.SHELF,
    note: 'WAL operation-cap regression churn',
  });
  assert.equal(churnLot.ok, true, churnLot.reason);
  let from = INVENTORY_STAGE.SHELF;
  let to = INVENTORY_STAGE.RESERVE;
  // The production journal retains 2,500 completed operations. Cross that
  // boundary with real lifecycle moves while the checkout WAL is still pending.
  for (let index = 0; index < 2_501; index += 1) {
    const moved = moveInventory(state, {
      from,
      to,
      quantity: 1,
      allocations: churnLot.allocations,
      referenceId: `wal-operation-cap-churn:${index}`,
      reason: 'Exercise pending-checkout operation retention',
      refreshOrder: false,
    });
    assert.equal(moved.ok, true, moved.reason);
    [from, to] = [to, from];
  }
  assert.ok(state.shop.inventoryLifecycle.operationKeys.length <= 2_500,
    'the regression crosses the bounded lifecycle journal rather than growing it');

  const retried = completeSale(state, tx, 'Operation Cap Golfer');
  assert.equal(retried.ok, true, retried.reason);
  assert.equal(retried.recovered, true);
  assert.equal(tx.banked, true);
  assert.deepEqual(pendingIds(state), []);
  assert.equal(ticketsFor(state, tx.id).length, 1);
  assert.equal(state.cash, cashAfterCore, 'retry cannot bank cash again after journal churn');
  assert.deepEqual(checkoutLedgerEntries(state, tx.id), ledgerAfterCore);
  assert.deepEqual(checkoutInventoryOperations(state, tx.id), inventoryAfterCore,
    'the sold-stock checkpoint remains exact across operation-cap churn');
  assert.deepEqual(state.shop.salesLive, salesAfterCore);
  assert.equal(state.shop.salesToday.balls1, skuSalesAfterCore);
  assert.deepEqual(state.salesTax, taxAfterCore);
});

test('sixty-one closeBooks passes cannot prune a pending checkout out of exact recovery', () => {
  const state = newGame('relaxed', 24108);
  const tx = retailOnCounter(state, {
    id: 'wal-ledger-retention-retry',
    uid: 'wal-ledger-retention-unit',
  });
  finishCardAndHandoff(tx);

  assert.throws(() => completeSale(state, tx, 'Ledger Retention Golfer', {
    qaFaultAfterCoreCommit: () => {
      throw new Error('ledger retention interruption after checkout core commit');
    },
  }), /ledger retention interruption after checkout core commit/);

  const cashAfterCore = state.cash;
  const ledgerAfterCore = structuredClone(checkoutLedgerEntries(state, tx.id));
  const inventoryAfterCore = structuredClone(checkoutInventoryOperations(state, tx.id));
  const salesAfterCore = structuredClone(state.shop.salesLive);
  const skuSalesAfterCore = state.shop.salesToday.balls1;
  const taxAfterCore = structuredClone(state.salesTax);
  assert.ok(ledgerAfterCore.length > 0);
  assert.deepEqual(pendingIds(state), [`checkout:${tx.id}`]);

  const checkoutDay = calendarOf(state.clock.minutes).dayAbs;
  for (let offset = 0; offset <= LEDGER_HISTORY_DAYS; offset += 1) {
    closeBooks(state, checkoutDay + offset);
  }
  assert.equal(state.ledger.history.length, LEDGER_HISTORY_DAYS);
  assert.deepEqual(checkoutLedgerEntries(state, tx.id), ledgerAfterCore,
    'ledger pruning retains checkpoints still owned by a pending checkout');

  const retried = completeSale(state, tx, 'Ledger Retention Golfer');
  assert.equal(retried.ok, true, retried.reason);
  assert.equal(retried.recovered, true);
  assert.equal(tx.banked, true);
  assert.deepEqual(pendingIds(state), []);
  assert.equal(ticketsFor(state, tx.id).length, 1);
  assert.equal(state.cash, cashAfterCore, 'retry cannot repost cash after close-of-books pruning');
  assert.deepEqual(checkoutLedgerEntries(state, tx.id), ledgerAfterCore);
  assert.deepEqual(checkoutInventoryOperations(state, tx.id), inventoryAfterCore);
  assert.deepEqual(state.shop.salesLive, salesAfterCore);
  assert.equal(state.shop.salesToday.balls1, skuSalesAfterCore);
  assert.deepEqual(state.salesTax, taxAfterCore);
});

test('reservation recovery rejects an external payment added to an absent nested CAS field', () => {
  const state = newGame('relaxed', 24109);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs + 1;
  const made = bookSlot(state, dayAbs, 8 * 60, 'Nested CAS Golfer');
  assert.equal(made.ok, true, made.reason);
  const reservation = made.res;
  delete reservation.payment.pending;
  assert.equal(Object.hasOwn(reservation.payment, 'pending'), false,
    'the WAL must preserve absence, not serialize it as an unchecked undefined');

  const payment = createReservationCheckInTx(state, reservation.id, { method: 'card' });
  assert.equal(payment.ok, true, payment.reason);
  const { tx } = payment;
  approveCardToReceipt(tx);

  assert.throws(() => finalizeReservationCheckIn(state, tx, reservation.id, {
    qaFaultAfterCoreCommit: () => {
      throw new Error('nested CAS interruption after checkout core commit');
    },
  }), /nested CAS interruption after checkout core commit/);

  assert.equal(reservation.status, 'booked');
  assert.equal(tx.commitPrepared, true);
  assert.equal(state.shop.transactionHistory.length, 0);
  assert.equal(pendingIds(state).length, 1);
  const cashAfterCore = state.cash;
  const ledgerAfterCore = structuredClone(state.ledger.entries);

  const external = beginReservationPayment(state, reservation.id, 'cash', {
    transactionId: 'external-pending-reservation-payment',
  });
  assert.equal(external.ok, true, external.reason);
  const externalPending = structuredClone(reservation.payment.pending);
  assert.equal(externalPending.status, 'pending');

  const refused = finalizeReservationCheckIn(state, tx, reservation.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.conflict, true);
  assert.match(refused.diagnostic || refused.reason, /reservation changed during checkout recovery/i);
  assert.deepEqual(reservation.payment.pending, externalPending,
    'recovery cannot overwrite a concurrent reservation payment');
  assert.equal(reservation.status, 'booked');
  assert.notEqual(tx.banked, true);
  assert.equal(tx.commitPrepared, true);
  assert.equal(state.cash, cashAfterCore);
  assert.deepEqual(state.ledger.entries, ledgerAfterCore);
  assert.equal(state.shop.transactionHistory.length, 0);
  assert.equal(pendingIds(state).length, 1, 'the conflicted WAL remains available for explicit repair');
});

test('serialize drains an interrupted combined sale and deserialize preserves one exact settlement', () => {
  const state = newGame('relaxed', 24102);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs + 1;
  const made = bookSlot(state, dayAbs, 8 * 60, 'WAL Save Golfer');
  assert.equal(made.ok, true, made.reason);
  const reservation = made.res;
  const tx = retailOnCounter(state, {
    id: 'wal-save-load-combined',
    uid: 'wal-save-load-unit',
  });
  assert.equal(attachGreenFeeToTx(state, tx, reservation.id).ok, true);
  finishCardAndHandoff(tx);

  const liveBefore = structuredClone(state.shop.salesLive || { units: 0, revenue: 0 });
  const skuSalesBefore = Number(state.shop.salesToday?.balls1) || 0;
  assert.throws(
    () => finalizeReservationCheckIn(state, tx, reservation.id, {
      qaFaultAfterCoreCommit: () => {
        throw new Error('test interruption before durable checkout tail');
      },
    }),
    /test interruption before durable checkout tail/,
  );

  assert.equal(reservation.status, 'booked');
  assert.equal(ticketsFor(state, tx.id).length, 0);
  assert.deepEqual(pendingIds(state), [`checkout:${tx.id}`]);
  assert.equal(checkoutInventoryOperations(state, tx.id).length, 1);
  assert.equal(state.shop.salesLive.units, (liveBefore.units || 0) + 1,
    'combined-sale analytics are committed before the injected interruption');
  assert.equal(round2(state.shop.salesLive.revenue), round2((liveBefore.revenue || 0) + 15));
  assert.equal(state.shop.salesToday.balls1, skuSalesBefore + 1);
  const cashAfterCore = state.cash;
  const ledgerAfterCore = structuredClone(checkoutLedgerEntries(state, tx.id));
  const inventoryAfterCore = structuredClone(checkoutInventoryOperations(state, tx.id));
  const salesAfterCore = structuredClone(state.shop.salesLive);
  const skuSalesAfterCore = state.shop.salesToday.balls1;
  const taxAfterCore = structuredClone(state.salesTax);

  const saved = serialize(state);
  assert.deepEqual(pendingIds(state), [], 'snapshot drains the prepared journal before writing');
  assert.equal(ticketsFor(state, tx.id).length, 1);
  assert.equal(reservation.status, 'played');
  assert.equal(state.cash, cashAfterCore);
  assert.deepEqual(checkoutLedgerEntries(state, tx.id), ledgerAfterCore);
  assert.deepEqual(checkoutInventoryOperations(state, tx.id), inventoryAfterCore);
  assert.deepEqual(state.shop.salesLive, salesAfterCore);
  assert.equal(state.shop.salesToday.balls1, skuSalesAfterCore);
  assert.deepEqual(state.salesTax, taxAfterCore);

  const loaded = deserialize(saved);
  const loadedReservation = reservationById(loaded, reservation.id);
  assert.ok(loadedReservation);
  assert.equal(loadedReservation.status, 'played');
  assert.equal(loadedReservation.checkInTransactionNumber, ticketsFor(loaded, tx.id)[0].number);
  assert.equal(ticketsFor(loaded, tx.id).length, 1);
  assert.equal(ticketsFor(loaded, tx.id)[0].type, RESERVATION_CHECK_IN_TYPE);
  assert.deepEqual(pendingIds(loaded), []);
  assert.equal(loaded.cash, cashAfterCore);
  assert.deepEqual(checkoutLedgerEntries(loaded, tx.id), ledgerAfterCore);
  assert.deepEqual(checkoutInventoryOperations(loaded, tx.id), inventoryAfterCore);
  assert.equal(heldUnits(loaded).some((item) => item.uid === 'wal-save-load-unit'), false);
  assert.equal(loaded.shop.salesLive.units, (liveBefore.units || 0) + 1);
  assert.equal(round2(loaded.shop.salesLive.revenue), round2((liveBefore.revenue || 0) + 15));
  assert.equal(loaded.shop.salesToday.balls1, skuSalesBefore + 1);

  const loadedAgain = deserialize(serialize(loaded));
  assert.equal(ticketsFor(loadedAgain, tx.id).length, 1);
  assert.equal(loadedAgain.cash, cashAfterCore);
  assert.deepEqual(checkoutLedgerEntries(loadedAgain, tx.id), ledgerAfterCore);
  assert.deepEqual(checkoutInventoryOperations(loadedAgain, tx.id), inventoryAfterCore);
  assert.equal(loadedAgain.shop.salesLive.units, loaded.shop.salesLive.units);
  assert.equal(loadedAgain.shop.salesToday.balls1, loaded.shop.salesToday.balls1);
});

test('a failed flavor-log append cannot turn a committed sale into a failed payment', () => {
  const state = newGame('relaxed', 24103);
  const tx = retailOnCounter(state, {
    id: 'wal-log-failure',
    uid: 'wal-log-failure-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const originalLog = ['immutable audit display'];
  state.shop.log = Object.freeze(originalLog.slice());

  let result;
  assert.doesNotThrow(() => {
    result = completeSale(state, tx, 'Log Failure Golfer');
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(tx.banked, true);
  assert.deepEqual(state.shop.log, originalLog, 'the rejected flavor write is safely ignored');
  assert.equal(ticketsFor(state, tx.id).length, 1);
  assert.deepEqual(pendingIds(state), []);
  assert.equal(
    checkoutLedgerEntries(state, tx.id)
      .filter((entry) => entry.idempotencyKey === `checkout:${tx.id}:sale`).length,
    1,
  );
  assert.equal(checkoutInventoryOperations(state, tx.id).length, 1);
});

test('an incomplete outcome checkpoint refuses before any core authority mutates', () => {
  const state = newGame('relaxed', 24104);
  const tx = retailOnCounter(state, {
    id: 'wal-outcome-preflight',
    uid: 'wal-outcome-preflight-unit',
  });
  finishCardAndHandoff(tx);
  const outcomeKey = `checkout:${tx.id}:completed`;
  state.ledger.processedOutcomeIds[outcomeKey] = 'missing-outcome-row';
  const before = {
    cash: state.cash,
    drawer: structuredClone(state.shop.drawer),
    held: structuredClone(heldUnits(state)),
    lifecycle: structuredClone(state.shop.inventoryLifecycle),
    ledgerEntries: structuredClone(state.ledger.entries),
    outcomes: structuredClone(state.ledger.outcomes),
    salesLive: structuredClone(state.shop.salesLive),
    salesToday: structuredClone(state.shop.salesToday),
    salesTax: structuredClone(state.salesTax),
    history: structuredClone(state.shop.transactionHistory),
  };

  const refused = completeSale(state, tx, 'Outcome Preflight Golfer');
  assert.equal(refused.ok, false);
  assert.match(
    refused.diagnostic || refused.reason,
    /outcome idempotency checkpoint is incomplete|different event/i,
  );
  assert.notEqual(tx.banked, true);
  assert.notEqual(tx.commitPrepared, true,
    'a pre-existing outcome conflict is rejected before preparing a settlement');
  assert.deepEqual(pendingIds(state), []);
  assert.deepEqual({
    cash: state.cash,
    drawer: state.shop.drawer,
    held: heldUnits(state),
    lifecycle: state.shop.inventoryLifecycle,
    ledgerEntries: state.ledger.entries,
    outcomes: state.ledger.outcomes,
    salesLive: state.shop.salesLive,
    salesToday: state.shop.salesToday,
    salesTax: state.salesTax,
    history: state.shop.transactionHistory,
  }, before, 'preflight failure leaves stock, drawer, books, projections, and tickets untouched');
});

test('an exact strict-identity orphan ledger row refuses before checkout preparation', () => {
  const state = newGame('relaxed', 24120);
  const tx = retailOnCounter(state, {
    id: 'wal-orphan-ledger-exact',
    uid: 'wal-orphan-ledger-exact-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const customer = 'Exact Orphan Golfer';
  const idempotencyKey = `checkout:${tx.id}:sale`;
  const propertyId = state.property.id;
  const timestamp = Math.round(state.clock.minutes);
  const item = goodsLinesOf(tx)[0];
  state.ledger.entries.push({
    id: `le:${propertyId}:${idempotencyKey}`,
    idempotencyKey,
    timestamp,
    day: Math.floor(timestamp / 1440),
    direction: 'revenue',
    category: 'shopSales',
    lineKey: 'shopSales',
    accountingClass: 'revenue',
    description: `Register sale - ${customer}`,
    amount: 15,
    cashImpact: 15,
    profitImpact: 15,
    relatedId: tx.id,
    propertyId,
    source: 'checkout',
    units: 1,
    customerCount: 1,
    metadata: {
      method: 'card',
      itemIds: [item.uid],
      skuIds: [item.skuId],
      tax: 0,
      taxRate: 0,
      ticketTotal: 15,
      checkoutSettlement: {
        version: 1,
        settlementId: `checkout:${tx.id}`,
      },
    },
  });
  assert.equal(Object.hasOwn(state.ledger.processedIds, idempotencyKey), false);
  const before = coreAuthorities(state);

  const refused = completeSale(state, tx, customer);
  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic || refused.reason, /ledger idempotency checkpoint is incomplete/i);
  assert.notEqual(tx.commitPrepared, true);
  assert.notEqual(tx.banked, true);
  assert.deepEqual(pendingIds(state), []);
  assert.deepEqual(coreAuthorities(state), before,
    'the orphan is diagnosed without repairing its map or touching checkout core authority');
});

test('a deterministic ledger row id owned by another key refuses before checkout preparation', () => {
  const state = newGame('relaxed', 24125);
  const tx = retailOnCounter(state, {
    id: 'wal-cross-key-ledger-id',
    uid: 'wal-cross-key-ledger-id-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const key = `checkout:${tx.id}:sale`;
  state.ledger.entries.push({
    id: `le:${state.property.id}:${key}`,
    idempotencyKey: 'forged:other-ledger-key',
  });
  const before = coreAuthorities(state);

  const refused = completeSale(state, tx, 'Cross-Key Ledger Golfer');
  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic || refused.reason, /entry identity belongs to a different idempotency key/i);
  assert.notEqual(tx.commitPrepared, true);
  assert.notEqual(tx.banked, true);
  assert.deepEqual(coreAuthorities(state), before);
});

for (const scenario of [
  {
    name: 'conflicting orphan ledger row',
    rows(key) {
      return [{
        id: 'forged-ledger-row',
        idempotencyKey: key,
        direction: 'expense',
      }];
    },
    reason: /different posting/i,
  },
  {
    name: 'ambiguous orphan ledger rows',
    rows(key) {
      return [
        { id: 'ambiguous-ledger-a', idempotencyKey: key },
        { id: 'ambiguous-ledger-b', idempotencyKey: key },
      ];
    },
    reason: /ledger idempotency key is ambiguous/i,
  },
  {
    name: 'id-less orphan ledger row',
    rows(key) {
      return [{ idempotencyKey: key }];
    },
    reason: /ledger idempotency checkpoint is incomplete/i,
  },
]) {
  test(`${scenario.name} refuses before checkout core authority mutates`, () => {
    const state = newGame('relaxed', 24121);
    const tx = retailOnCounter(state, {
      id: `wal-${scenario.name.replaceAll(' ', '-')}`,
      uid: `wal-${scenario.name.replaceAll(' ', '-')}-unit`,
      taxRate: 0,
    });
    finishCardAndHandoff(tx);
    const key = `checkout:${tx.id}:sale`;
    state.ledger.entries.push(...scenario.rows(key));
    const before = coreAuthorities(state);

    const refused = completeSale(state, tx, 'Ledger Orphan Golfer');
    assert.equal(refused.ok, false);
    assert.match(refused.diagnostic || refused.reason, scenario.reason);
    assert.notEqual(tx.commitPrepared, true);
    assert.notEqual(tx.banked, true);
    assert.deepEqual(pendingIds(state), []);
    assert.deepEqual(coreAuthorities(state), before);
  });
}

test('an exact orphan checkout outcome refuses before checkout preparation', () => {
  const state = newGame('relaxed', 24122);
  const tx = retailOnCounter(state, {
    id: 'wal-orphan-outcome-exact',
    uid: 'wal-orphan-outcome-exact-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const idempotencyKey = `checkout:${tx.id}:completed`;
  const propertyId = state.property.id;
  const timestamp = Math.round(state.clock.minutes);
  state.ledger.outcomes.push({
    id: `out:${propertyId}:${idempotencyKey}`,
    idempotencyKey,
    timestamp,
    day: Math.floor(timestamp / 1440),
    type: 'checkoutCompleted',
    count: 1,
    amount: totalOf(tx),
    reason: 'Register checkout completed with 1 item.',
    relatedId: tx.id,
    propertyId,
    metadata: { units: 1, method: 'card' },
  });
  assert.equal(Object.hasOwn(state.ledger.processedOutcomeIds, idempotencyKey), false);
  const before = coreAuthorities(state);

  const refused = completeSale(state, tx, 'Outcome Orphan Golfer');
  assert.equal(refused.ok, false);
  assert.match(
    refused.diagnostic || refused.reason,
    /outcome idempotency checkpoint is incomplete|different event/i,
  );
  assert.notEqual(tx.commitPrepared, true);
  assert.notEqual(tx.banked, true);
  assert.deepEqual(pendingIds(state), []);
  assert.deepEqual(coreAuthorities(state), before,
    'the orphan outcome remains untouched and cannot authorize a checkout');
});

test('a deterministic outcome id owned by another key refuses before checkout preparation', () => {
  const state = newGame('relaxed', 24126);
  const tx = retailOnCounter(state, {
    id: 'wal-cross-key-outcome-id',
    uid: 'wal-cross-key-outcome-id-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const key = `checkout:${tx.id}:completed`;
  state.ledger.outcomes.push({
    id: `out:${state.property.id}:${key}`,
    idempotencyKey: 'forged:other-outcome-key',
  });
  const before = coreAuthorities(state);

  const refused = completeSale(state, tx, 'Cross-Key Outcome Golfer');
  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic || refused.reason, /outcome identity belongs to a different idempotency key/i);
  assert.notEqual(tx.commitPrepared, true);
  assert.notEqual(tx.banked, true);
  assert.deepEqual(coreAuthorities(state), before);
});

test('deserialize never heals an orphan checkout row into authority for a pending sale', () => {
  const state = newGame('relaxed', 24127);
  const tx = retailOnCounter(state, {
    id: 'wal-load-orphan-ledger',
    uid: 'wal-load-orphan-ledger-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const pristineSave = JSON.parse(serialize(state));

  assert.throws(() => completeSale(state, tx, 'Load Orphan Golfer', {
    qaFaultAfterCoreCommit: () => { throw new Error('capture genuine pending plan'); },
  }), /capture genuine pending plan/);
  const settlementId = `checkout:${tx.id}`;
  const plan = structuredClone(state.shop.pendingCheckouts[settlementId]);
  const saleKey = `checkout:${tx.id}:sale`;
  const exactRow = structuredClone(
    state.ledger.entries.find((entry) => entry.idempotencyKey === saleKey),
  );
  assert.ok(plan);
  assert.ok(exactRow);

  const pickReferenceId = `customer-pick:${tx.items[0].uid}`;
  pristineSave.shop.inventoryLifecycle.operations[pickReferenceId].checkoutPriceAuthority =
    structuredClone(
      state.shop.inventoryLifecycle.operations[pickReferenceId].checkoutPriceAuthority,
    );
  pristineSave.shop.pendingCheckouts = { [settlementId]: plan };
  pristineSave.shop.nextTransactionNo = state.shop.nextTransactionNo;
  pristineSave.ledger.entries.push(exactRow);
  delete pristineSave.ledger.processedIds[saleKey];
  const cashBefore = pristineSave.cash;
  const revenueBefore = pristineSave.ledger.today.revenue.shopSales;

  const loaded = deserialize(JSON.stringify(pristineSave));
  assert.deepEqual(Object.keys(loaded.shop.pendingCheckouts), [settlementId]);
  assert.equal(Object.hasOwn(loaded.ledger.processedIds, saleKey), false,
    'load recovery leaves the orphan checkpoint visibly incomplete');
  assert.deepEqual(heldUnits(loaded), pristineSave.shop.held);
  assert.equal(ticketsFor(loaded, tx.id).length, 0);
  assert.equal(loaded.cash, cashBefore);
  assert.equal(loaded.ledger.today.revenue.shopSales, revenueBefore);
});

for (const [label, malformedWal, quarantineReason] of [
  ['null', null, 'malformed-persisted-checkout-journal'],
  ['array', [], 'malformed-persisted-checkout-journal'],
  ['string', 'lost-checkout-journal', 'malformed-persisted-checkout-journal'],
  ['invalid-record', { 'checkout:corrupt': { version: 1 } }, 'invalid-persisted-checkout-settlement'],
]) {
  test(`deserialize quarantines a present ${label} checkout WAL without checkpoint backfill or held-stock recovery`, () => {
    const state = newGame('relaxed', 24131);
    const tx = retailOnCounter(state, {
      id: `wal-malformed-${label}`,
      uid: `wal-malformed-${label}-unit`,
      taxRate: 0,
    });
    finishCardAndHandoff(tx);
    const pristineSave = JSON.parse(serialize(state));
    const shelfAfterPick = pristineSave.shop.inventory.balls1.shelf;
    const heldBefore = structuredClone(pristineSave.shop.held);

    assert.throws(() => completeSale(state, tx, 'Malformed WAL Golfer', {
      qaFaultAfterCoreCommit: () => { throw new Error('capture partial bank posting'); },
    }), /capture partial bank posting/);
    const saleKey = `checkout:${tx.id}:sale`;
    const bankedRow = state.ledger.entries.find((entry) => entry.idempotencyKey === saleKey);
    assert.ok(bankedRow, 'the adversarial save contains a real bank posting');

    // Compose a torn persisted image: money/ledger reached disk, while the
    // inventory authority is still the pre-commit held unit and the WAL field
    // itself is present but no longer a record.
    pristineSave.cash = state.cash;
    pristineSave.ledger = JSON.parse(JSON.stringify(state.ledger));
    delete pristineSave.ledger.processedIds[saleKey];
    const outcomeKey = `checkout:${tx.id}:completed`;
    const outcomeId = `orphan-outcome:${tx.id}`;
    pristineSave.ledger.outcomes.push({ id: outcomeId, idempotencyKey: outcomeKey });
    delete pristineSave.ledger.processedOutcomeIds[outcomeKey];
    pristineSave.shop.pendingCheckouts = malformedWal;
    const { state: loaded, report } = deserializeWithReport(JSON.stringify(pristineSave));

    assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true);
    assert.equal(loaded.shop.pendingCheckoutsQuarantine?.reason, quarantineReason);
    assert.deepEqual(loaded.shop.pendingCheckouts, {});
    assert.equal(pendingCheckoutCount(loaded), 1,
      'an unknown quarantined WAL is represented as unresolved work, never an empty journal');
    const recovery = reconcilePendingCheckouts(loaded);
    assert.equal(recovery.ok, false);
    assert.equal(recovery.pending, 1);
    assert.match(recovery.failures[0].diagnostic, /quarantined.*cannot be recovered/i);
    assert.ok(report.repairs.some(({ path, message }) => (
      path === '$.shop.pendingCheckouts' && /quarantined.*recovery blocked/i.test(message)
    )));
    assert.equal(Object.hasOwn(loaded.ledger.processedIds, saleKey), false,
      'ensureLedger must not turn an orphan bank row into a replay checkpoint');
    assert.equal(Object.hasOwn(loaded.ledger.processedOutcomeIds, outcomeKey), false,
      'ensureLedger must not turn an orphan outcome row into a replay checkpoint');
    assert.equal(loaded.ledger.entries.filter((entry) => entry.idempotencyKey === saleKey).length, 1);
    assert.equal(loaded.cash, pristineSave.cash, 'the partial bank posting is not unwound or repeated');
    assert.deepEqual(heldUnits(loaded), heldBefore,
      'unknown WAL ownership keeps held goods quarantined instead of restocking them');
    assert.equal(loaded.shop.inventory.balls1.shelf, shelfAfterPick);
    const heldAllocation = loaded.shop.inventoryLifecycle.heldAllocations[tx.items[0].uid];
    assert.equal(Array.isArray(heldAllocation), true);
    const heldLot = loaded.shop.inventoryLifecycle.lots
      .find((lot) => lot.id === heldAllocation[0].lotId);
    assert.equal(heldLot.buckets[INVENTORY_STAGE.CUSTOMER_HELD], 1,
      'the inventory ledger retains the unit in its held bucket');
    assert.equal(ticketsFor(loaded, tx.id).length, 0);

    const reloaded = deserialize(serialize(loaded));
    assert.equal(reloaded.shop.pendingCheckoutsQuarantine?.active, true,
      'the fail-closed recovery barrier survives a clean save/load round trip');
    assert.equal(Object.hasOwn(reloaded.ledger.processedIds, saleKey), false);
    assert.equal(Object.hasOwn(reloaded.ledger.processedOutcomeIds, outcomeKey), false);
    assert.deepEqual(heldUnits(reloaded), heldBefore);
    assert.equal(reloaded.shop.inventory.balls1.shelf, shelfAfterPick);
  });
}

test('a current-schema save cannot downgrade an empty checkout journal by deleting its field', () => {
  const raw = JSON.parse(serialize(newGame('relaxed', 24133)));
  assert.equal(raw.version, CHECKOUT_WAL_SAVE_VERSION);
  assert.deepEqual(raw.shop.pendingCheckouts, {});
  delete raw.shop.pendingCheckouts;

  const { state: loaded, report } = deserializeWithReport(raw);
  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.equal(
    loaded.shop.pendingCheckoutsQuarantine?.reason,
    'missing-checkout-journal-with-unresolved-evidence',
  );
  assert.ok(report.repairs.some(({ path, message }) => (
    path === '$.shop.pendingCheckouts'
      && /missing.*checkout.*journal.*quarantined/i.test(message)
  )));
  assert.equal(reconcilePendingCheckouts(loaded).ok, false,
    'an absent current-schema journal is unknowable even when no checkout projection is visible');
});

test('a stale but valid empty WAL cannot explain later checkout core projections', () => {
  const state = newGame('relaxed', 24139);
  const tx = retailOnCounter(state, {
    id: 'stale-empty-wal-post-core',
    uid: 'stale-empty-wal-post-core-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const stale = JSON.parse(serialize(state));
  const shelfAfterPick = stale.shop.inventory.balls1.shelf;
  assert.deepEqual(stale.shop.pendingCheckouts, {});
  assert.deepEqual(stale.shop.checkoutSettlementReceipts, {});

  assert.throws(() => completeSale(state, tx, 'Stale WAL Golfer', {
    qaFaultAfterCoreCommit: () => { throw new Error('capture post-core state'); },
  }), /capture post-core state/);
  stale.cash = state.cash;
  stale.ledger = structuredClone(state.ledger);
  stale.salesTax = structuredClone(state.salesTax);
  stale.shop.salesLive = structuredClone(state.shop.salesLive);
  stale.shop.salesToday = structuredClone(state.shop.salesToday);
  stale.shop.checkoutProjectionIds = structuredClone(state.shop.checkoutProjectionIds);
  const saleKey = `checkout:${tx.id}:sale`;

  const loaded = deserialize(stale);
  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.reason,
    'incoherent-persisted-checkout-settlement');
  assert.equal(Object.hasOwn(loaded.ledger.processedIds, saleKey), true,
    'the already-written checkpoint remains visible without becoming recovery authority');
  assert.equal(heldUnits(loaded).some((item) => item.uid === tx.items[0].uid), true);
  assert.equal(loaded.shop.inventory.balls1.shelf, shelfAfterPick,
    'the stale empty journal cannot restock the potentially sold unit');
});

for (const [label, versionMutation] of [
  ['numeric downgrade', (raw) => { raw.version = CHECKOUT_WAL_SAVE_VERSION - 1; }],
  ['string current version', (raw) => { raw.version = String(CHECKOUT_WAL_SAVE_VERSION); }],
  ['missing version', (raw) => { delete raw.version; }],
]) {
  test(`${label} cannot hide current checkout markers behind the legacy migration path`, () => {
    const state = newGame('relaxed', 24140);
    const tx = retailOnCounter(state, {
      id: `stale-wal-${label.replaceAll(' ', '-')}`,
      uid: `stale-wal-${label.replaceAll(' ', '-')}-unit`,
      taxRate: 0,
    });
    finishCardAndHandoff(tx);
    const stale = JSON.parse(serialize(state));
    assert.throws(() => completeSale(state, tx, 'Downgrade Golfer', {
      qaFaultAfterCoreCommit: () => { throw new Error('capture downgraded post-core state'); },
    }), /capture downgraded post-core state/);
    stale.cash = state.cash;
    stale.ledger = structuredClone(state.ledger);
    stale.shop.checkoutProjectionIds = structuredClone(state.shop.checkoutProjectionIds);
    versionMutation(stale);

    const loaded = deserialize(stale);
    assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true);
    assert.equal(heldUnits(loaded).some((item) => item.uid === tx.items[0].uid), true);
  });
}

test('a current-schema save with no record-shaped shop authority is quarantined', () => {
  const raw = JSON.parse(serialize(newGame('relaxed', 24141)));
  raw.shop = null;
  const loaded = deserialize(raw);
  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.reason,
    'missing-checkout-journal-with-unresolved-evidence');
});

test('persisted WAL validation enforces the one-register settlement invariant', () => {
  const pendingPlan = (seed, id, uid) => {
    const state = newGame('relaxed', seed);
    const tx = retailOnCounter(state, { id, uid, taxRate: 0 });
    finishCardAndHandoff(tx);
    assert.throws(() => completeSale(state, tx, 'Parallel WAL Golfer', {
      qaFaultAfterCoreCommit: () => { throw new Error('retain signed WAL'); },
    }), /retain signed WAL/);
    return structuredClone(state.shop.pendingCheckouts[`checkout:${id}`]);
  };
  const first = pendingPlan(24142, 'parallel-wal-a', 'parallel-wal-a-unit');
  const second = pendingPlan(24143, 'parallel-wal-b', 'parallel-wal-b-unit');
  const raw = JSON.parse(serialize(newGame('relaxed', 24144)));
  raw.shop.pendingCheckouts = {
    [first.settlementId]: first,
    [second.settlementId]: second,
  };

  const loaded = deserialize(raw);
  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.deepEqual(loaded.shop.pendingCheckouts, {});
});

test('snapshot refuses a live current state whose checkout authorities disappear without erasing evidence', () => {
  const state = newGame('relaxed', 24145);
  delete state.shop.pendingCheckouts;
  delete state.shop.checkoutSettlementReceipts;
  delete state.shop.checkoutSettlementReceiptKeys;
  const before = structuredClone(state.shop);

  assert.throws(() => serialize(state), /checkout settlement authority is incomplete/i);
  assert.deepEqual(state.shop, before,
    'a failed save does not fabricate empty authorities or overwrite repair evidence');
});

test('a disappearing identity-less ticket cannot suppress missing current checkout WAL quarantine', () => {
  const state = newGame('relaxed', 24134);
  const uid = 'missing-wal-minimal-ticket-unit';
  assert.equal(pickFromShelf(state, 'balls1', uid).ok, true);
  const raw = JSON.parse(serialize(state));
  const transactionId = 'missing-wal-minimal-ticket';
  const saleKey = `checkout:${transactionId}:sale`;
  const rowId = `le:${state.property.id}:${saleKey}`;
  const shelfAfterPick = raw.shop.inventory.balls1.shelf;
  delete raw.shop.pendingCheckouts;
  raw.shop.transactionHistory.unshift({ transactionId });
  raw.cash = round2(raw.cash + 15);
  raw.ledger.entries.push({
    id: rowId,
    idempotencyKey: saleKey,
    relatedId: transactionId,
    direction: 'revenue',
    lineKey: 'shopSales',
    amount: 15,
  });
  delete raw.ledger.processedIds[saleKey];

  const loaded = deserialize(raw);
  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.equal(ticketsFor(loaded, transactionId).length, 0,
    'normalization still rejects the identity-less ticket');
  assert.equal(Object.hasOwn(loaded.ledger.processedIds, saleKey), false,
    'the orphan row is not promoted into a replay checkpoint');
  assert.equal(heldUnits(loaded).some((item) => item.uid === uid), true);
  assert.equal(loaded.shop.inventory.balls1.shelf, shelfAfterPick,
    'the unknown checkout keeps its held stock out of the shelf');
});

test('a current completed ticket cannot mask its own stale matching held-stock projection', () => {
  const state = newGame('relaxed', 24135);
  const tx = retailOnCounter(state, {
    id: 'missing-wal-stale-held',
    uid: 'missing-wal-stale-held-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const precommit = JSON.parse(serialize(state));
  const shelfAfterPick = precommit.shop.inventory.balls1.shelf;
  const completed = completeSale(state, tx, 'Stale Held Golfer');
  assert.equal(completed.ok, true, completed.reason);
  const committed = JSON.parse(serialize(state));

  // Compose the exact completed money/ticket projection with the earlier held
  // inventory image, then remove the only authority that could reconcile it.
  precommit.cash = committed.cash;
  precommit.ledger = committed.ledger;
  precommit.salesTax = committed.salesTax;
  precommit.shop.transactionHistory = committed.shop.transactionHistory;
  precommit.shop.salesLive = committed.shop.salesLive;
  precommit.shop.salesToday = committed.shop.salesToday;
  precommit.shop.checkoutProjectionIds = committed.shop.checkoutProjectionIds;
  delete precommit.shop.pendingCheckouts;

  const loaded = deserialize(precommit);
  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.equal(ticketsFor(loaded, tx.id).length, 1,
    'the exact ticket remains a historical projection, not WAL authority');
  assert.equal(heldUnits(loaded).some((item) => item.uid === tx.items[0].uid), true);
  assert.equal(loaded.shop.inventory.balls1.shelf, shelfAfterPick,
    'the sold ticket cannot restock its still-held matching unit');
});

test('checkout checkpoint maps alone cannot suppress missing current WAL quarantine', () => {
  const state = newGame('relaxed', 24136);
  const tx = retailOnCounter(state, {
    id: 'missing-wal-checkpoint-only',
    uid: 'missing-wal-checkpoint-only-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const precommit = JSON.parse(serialize(state));
  const shelfAfterPick = precommit.shop.inventory.balls1.shelf;
  assert.equal(completeSale(state, tx, 'Checkpoint Only Golfer').ok, true);
  const committed = JSON.parse(serialize(state));
  const saleKey = `checkout:${tx.id}:sale`;
  const outcomeKey = `checkout:${tx.id}:completed`;

  precommit.cash = committed.cash;
  precommit.ledger.today = committed.ledger.today;
  precommit.ledger.processedIds = committed.ledger.processedIds;
  precommit.ledger.processedOutcomeIds = committed.ledger.processedOutcomeIds;
  precommit.ledger.entries = precommit.ledger.entries.filter(
    (entry) => entry.idempotencyKey !== saleKey,
  );
  precommit.ledger.outcomes = precommit.ledger.outcomes.filter(
    (outcome) => outcome.idempotencyKey !== outcomeKey,
  );
  delete precommit.shop.pendingCheckouts;

  const loaded = deserialize(precommit);
  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.equal(Object.hasOwn(loaded.ledger.processedIds, saleKey), true,
    'the suspicious checkpoint remains visible for manual recovery');
  assert.equal(Object.hasOwn(loaded.ledger.processedOutcomeIds, outcomeKey), true);
  assert.equal(heldUnits(loaded).some((item) => item.uid === tx.items[0].uid), true);
  assert.equal(loaded.shop.inventory.balls1.shelf, shelfAfterPick);
});

test('a missing legacy checkout WAL still permits legacy checkpoint and held-stock recovery', () => {
  const state = newGame('relaxed', 24132);
  const uid = 'legacy-missing-wal-unit';
  assert.equal(pickFromShelf(state, 'balls1', uid).ok, true);
  const raw = JSON.parse(serialize(state));
  makeGenuineV14CheckoutImage(raw);
  const key = 'legacy:pre-wal:revenue';
  const id = 'legacy-pre-wal-ledger-row';
  raw.ledger.entries.push({ id, idempotencyKey: key });
  delete raw.ledger.processedIds[key];
  const shelfAfterPick = raw.shop.inventory.balls1.shelf;

  const loaded = deserialize(JSON.stringify(raw));
  assert.notEqual(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.equal(loaded.ledger.processedIds[key], id,
    'an absent legacy WAL retains the historical orphan-row migration');
  assert.equal(heldUnits(loaded).some((entry) => entry.uid === uid), false);
  assert.equal(loaded.shop.inventory.balls1.shelf, shelfAfterPick + 1,
    'legacy renderer-only held goods still recover normally');
});

test('V14 completed checkout projections remain compatible without current ticket bindings', () => {
  const state = newGame('relaxed', 24137);
  const tx = retailOnCounter(state, {
    id: 'legacy-v14-physical-checkout',
    uid: 'legacy-v14-physical-checkout-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  assert.equal(completeSale(state, tx, 'Legacy Physical Golfer').ok, true);
  const raw = JSON.parse(serialize(state));
  makeGenuineV14CheckoutImage(raw);
  const [ticket] = raw.shop.transactionHistory;
  delete ticket.transactionId;
  delete ticket.ledgerIdempotencyKeys;
  delete ticket.ledgerEntryIds;
  delete ticket.checkoutSettlement;

  const loaded = deserialize(raw);
  assert.notEqual(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.equal(loaded.shop.transactionHistory.length, 1);
  assert.ok(loaded.ledger.entries.some(
    (entry) => entry.idempotencyKey === `checkout:${tx.id}:sale`,
  ));
});

test('V14 direct checkout ledger evidence remains compatible without a history ticket', () => {
  const state = newGame('relaxed', 24138);
  const uid = 'legacy-v14-direct-checkout-unit';
  assert.equal(pickFromShelf(state, 'balls1', uid).ok, true);
  const transactionId = 'legacy-v14-direct-checkout';
  const sale = checkoutSale(state, [{
    uid,
    skuId: 'balls1',
    name: 'Practice Balls',
    price: 15,
  }], 'Legacy Direct Golfer', transactionId, { taxRate: 0 });
  assert.equal(sale.ok, true, sale.reason);
  const raw = JSON.parse(serialize(state));
  makeGenuineV14CheckoutImage(raw);
  raw.shop.transactionHistory = [];

  const loaded = deserialize(raw);
  assert.notEqual(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.equal(loaded.shop.transactionHistory.length, 0);
  assert.ok(loaded.ledger.entries.some(
    (entry) => entry.idempotencyKey === `checkout:${transactionId}:sale`,
  ));
});

test('a terminal receipt keeps an aged checkout canonical after financial rows are pruned', () => {
  const state = newGame('relaxed', 24146);
  const tx = retailOnCounter(state, {
    id: 'aged-terminal-receipt',
    uid: 'aged-terminal-receipt-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  assert.equal(completeSale(state, tx, 'Aged Receipt Golfer').ok, true);
  const settlementId = `checkout:${tx.id}`;
  assert.ok(state.shop.checkoutSettlementReceipts[settlementId]);

  state.clock.minutes = (LEDGER_HISTORY_DAYS + 1) * 1440;
  closeBooks(state, LEDGER_HISTORY_DAYS + 1);
  assert.equal(checkoutLedgerEntries(state, tx.id).length, 0,
    'the normal retention pass removes old immutable financial rows');
  state.shop.transactionHistory = [];

  const loaded = deserialize(serialize(state));
  assert.notEqual(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.ok(loaded.shop.checkoutSettlementReceipts[settlementId]);
  assert.equal(Object.hasOwn(loaded.ledger.processedIds, `checkout:${tx.id}:sale`), true);
  assert.equal(heldUnits(loaded).some((item) => item.uid === tx.items[0].uid), false);
});

test('inventory command churn cannot evict a retained checkout receipt operation', () => {
  const state = newGame('relaxed', 24164);
  const transactionId = 'receipt-operation-retention';
  const soldUid = 'receipt-operation-retention-unit';
  assert.equal(pickFromShelf(state, 'balls1', soldUid).ok, true);
  const sale = checkoutSale(
    state,
    [{ uid: soldUid, skuId: 'balls1', price: 15 }],
    'Receipt Retention Golfer',
    transactionId,
    { taxRate: 0 },
  );
  assert.equal(sale.ok, true, sale.reason || sale.diagnostic);
  const settlementId = `checkout:${transactionId}`;
  const receipt = state.shop.checkoutSettlementReceipts[settlementId];
  assert.ok(receipt?.inventoryReferenceId);

  for (let index = 0; index < 1_400; index += 1) {
    const uid = `receipt-operation-churn-${index}`;
    assert.equal(pickFromShelf(state, 'balls1', uid).ok, true);
    assert.equal(returnToShelf(state, 'balls1', uid).ok, true);
  }

  assert.ok(state.shop.inventoryLifecycle.operations[receipt.inventoryReferenceId],
    'the terminal operation remains paired with its retained receipt');
  assert.ok(state.shop.inventoryLifecycle.operationKeys.length <= 2_500);
  const loaded = deserialize(serialize(state));
  assert.notEqual(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.ok(loaded.shop.checkoutSettlementReceipts[settlementId]);
  assert.ok(loaded.shop.inventoryLifecycle.operations[receipt.inventoryReferenceId]);
});

test('current terminal checkout projections without their retained receipt fail closed', () => {
  const state = newGame('relaxed', 24147);
  const tx = retailOnCounter(state, {
    id: 'terminal-missing-receipt',
    uid: 'terminal-missing-receipt-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  assert.equal(completeSale(state, tx, 'Missing Receipt Golfer').ok, true);
  const raw = JSON.parse(serialize(state));
  raw.shop.checkoutSettlementReceipts = {};
  raw.shop.checkoutSettlementReceiptKeys = [];

  const loaded = deserialize(raw);
  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.reason,
    'incoherent-persisted-checkout-settlement');
});

for (const scenario of [
  {
    name: 'conflicting orphan outcome row',
    rows(key) {
      return [{
        id: 'forged-outcome-row',
        idempotencyKey: key,
        type: 'forgedCheckout',
      }];
    },
    reason: /different event/i,
  },
  {
    name: 'ambiguous orphan outcome rows',
    rows(key) {
      return [
        { id: 'ambiguous-outcome-a', idempotencyKey: key },
        { id: 'ambiguous-outcome-b', idempotencyKey: key },
      ];
    },
    reason: /outcome idempotency key is ambiguous/i,
  },
  {
    name: 'id-less orphan outcome row',
    rows(key) {
      return [{ idempotencyKey: key }];
    },
    reason: /outcome idempotency checkpoint is incomplete/i,
  },
]) {
  test(`${scenario.name} refuses before checkout core authority mutates`, () => {
    const state = newGame('relaxed', 24124);
    const tx = retailOnCounter(state, {
      id: `wal-${scenario.name.replaceAll(' ', '-')}`,
      uid: `wal-${scenario.name.replaceAll(' ', '-')}-unit`,
      taxRate: 0,
    });
    finishCardAndHandoff(tx);
    const key = `checkout:${tx.id}:completed`;
    state.ledger.outcomes.push(...scenario.rows(key));
    const before = coreAuthorities(state);

    const refused = completeSale(state, tx, 'Outcome Orphan Golfer');
    assert.equal(refused.ok, false);
    assert.match(refused.diagnostic || refused.reason, scenario.reason);
    assert.notEqual(tx.commitPrepared, true);
    assert.notEqual(tx.banked, true);
    assert.deepEqual(pendingIds(state), []);
    assert.deepEqual(coreAuthorities(state), before);
  });
}

for (const poisoned of [Number.NaN, Number.POSITIVE_INFINITY, '15']) {
  test(`a ${String(poisoned)} aggregate refuses before checkout core authority mutates`, () => {
    const state = newGame('relaxed', 24123);
    const tx = retailOnCounter(state, {
      id: `wal-invalid-aggregate-${String(poisoned)}`,
      uid: `wal-invalid-aggregate-${String(poisoned)}-unit`,
      taxRate: 0,
    });
    finishCardAndHandoff(tx);
    state.ledger.today.revenue.shopSales = poisoned;
    const before = coreAuthorities(state);

    const refused = completeSale(state, tx, 'Invalid Aggregate Golfer');
    assert.equal(refused.ok, false);
    assert.match(refused.diagnostic || refused.reason, /ledger aggregate value is invalid/i);
    assert.notEqual(tx.commitPrepared, true);
    assert.notEqual(tx.banked, true);
    assert.deepEqual(pendingIds(state), []);
    assert.deepEqual(coreAuthorities(state), before,
      'invalid aggregate data is never normalized by checkout preflight');
  });
}

const frozenSettlementAuthorities = [
  {
    name: 'transaction-history publication property',
    freeze(state) {
      Object.defineProperty(state.shop, 'transactionHistory', {
        value: state.shop.transactionHistory,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    },
    reason: /ticket publication.+not writable/i,
  },
  {
    name: 'next-ticket publication property',
    freeze(state) {
      Object.defineProperty(state.shop, 'nextTransactionNo', {
        value: state.shop.nextTransactionNo,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    },
    reason: /ticket publication.+not writable/i,
  },
  {
    name: 'pending settlement journal',
    freeze(state) {
      state.shop.pendingCheckouts = Object.freeze({});
    },
    reason: /checkout journal.+not writable/i,
  },
  {
    name: 'inventory operation checkpoint journal',
    freeze(state) {
      state.shop.inventoryLifecycle.operations = Object.freeze({
        ...state.shop.inventoryLifecycle.operations,
      });
    },
    reason: /inventory.+not writable/i,
  },
  {
    name: 'daily-sales projection authority',
    freeze(state) {
      state.shop.salesToday = Object.freeze({ ...state.shop.salesToday });
    },
    reason: /(sales|projection).+not writable/i,
  },
  {
    name: 'ledger checkpoint journal',
    freeze(state) {
      state.ledger.processedIds = Object.freeze({ ...state.ledger.processedIds });
    },
    reason: /ledger.+not writable/i,
  },
  {
    name: 'outcome checkpoint journal',
    freeze(state) {
      state.ledger.processedOutcomeIds = Object.freeze({ ...state.ledger.processedOutcomeIds });
    },
    reason: /outcome.+not writable/i,
  },
];

for (let index = 0; index < frozenSettlementAuthorities.length; index += 1) {
  const scenario = frozenSettlementAuthorities[index];
  test(`frozen ${scenario.name} refuses before any core mutation`, () => {
    const state = newGame('relaxed', 24110 + index);
    const tx = retailOnCounter(state, {
      id: `wal-frozen-authority-${index}`,
      uid: `wal-frozen-authority-unit-${index}`,
    });
    finishCardAndHandoff(tx);
    scenario.freeze(state);
    const before = coreAuthorities(state);

    let refused;
    assert.doesNotThrow(() => {
      refused = completeSale(state, tx, `Frozen ${scenario.name}`);
    }, `${scenario.name} must be rejected as data, not escape as an exception`);
    assert.equal(refused.ok, false, scenario.name);
    assert.match(refused.diagnostic || refused.reason, scenario.reason, scenario.name);
    assert.notEqual(tx.banked, true, scenario.name);
    assert.notEqual(tx.commitPrepared, true, scenario.name);
    assert.deepEqual(coreAuthorities(state), before,
      `${scenario.name} changes no inventory, books, projection, journal, or ticket`);
  });
}

test('an immutable cash-drawer property refuses before held inventory moves', () => {
  const state = newGame('relaxed', 24120);
  const tx = retailOnCounter(state, {
    id: 'wal-frozen-drawer-property',
    uid: 'wal-frozen-drawer-property-unit',
    taxRate: 0,
  });
  finishCashAndHandoff(state, tx);
  Object.defineProperty(state.shop, 'drawer', {
    value: state.shop.drawer,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  const before = coreAuthorities(state);

  let refused;
  assert.doesNotThrow(() => {
    refused = completeSale(state, tx, 'Frozen Drawer Golfer');
  });
  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic || refused.reason, /drawer.+not writable/i);
  assert.notEqual(tx.banked, true);
  assert.notEqual(tx.commitPrepared, true);
  assert.deepEqual(coreAuthorities(state), before,
    'drawer rejection leaves inventory, books, projections, ticket, and WAL untouched');
});

test('a duplicated referenced lot id refuses before checkout can sell the wrong SKU', () => {
  const state = newGame('relaxed', 24121);
  const tx = retailOnCounter(state, {
    id: 'wal-duplicate-lot',
    uid: 'wal-duplicate-lot-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const allocation = state.shop.inventoryLifecycle.heldAllocations['wal-duplicate-lot-unit'][0];
  const original = state.shop.inventoryLifecycle.lots.find((lot) => lot.id === allocation.lotId);
  assert.ok(original);
  state.shop.inventoryLifecycle.lots.unshift({
    ...structuredClone(original),
    skuId: 'shirt1',
    buckets: {
      ...structuredClone(original.buckets),
      [INVENTORY_STAGE.CUSTOMER_HELD]: 1,
      [INVENTORY_STAGE.SOLD]: 0,
    },
  });
  const before = coreAuthorities(state);

  const refused = completeSale(state, tx, 'Ambiguous Lot Golfer');
  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic || refused.reason, /lot.+ambiguous/i);
  assert.notEqual(tx.commitPrepared, true);
  assert.deepEqual(coreAuthorities(state), before,
    'ambiguous lot provenance leaves both lots and every checkout authority untouched');
});

test('a sold inventory bucket overflow refuses before checkout moves money or stock', () => {
  const state = newGame('relaxed', 24128);
  const uid = 'wal-sold-overflow-unit';
  const tx = retailOnCounter(state, {
    id: 'wal-sold-overflow',
    uid,
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const allocation = state.shop.inventoryLifecycle.heldAllocations[uid][0];
  const lot = state.shop.inventoryLifecycle.lots.find((entry) => entry.id === allocation.lotId);
  lot.buckets[INVENTORY_STAGE.SOLD] = Number.MAX_SAFE_INTEGER;
  const before = coreAuthorities(state);

  const refused = completeSale(state, tx, 'Overflow Lot Golfer');
  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic || refused.reason, /lot would overflow/i);
  assert.notEqual(tx.commitPrepared, true);
  assert.deepEqual(coreAuthorities(state), before);
});

for (const [name, poison] of [
  ['visit counter', (history) => { history.totalVisits = Number.MAX_SAFE_INTEGER; }],
  ['lifetime spend', (history) => { history.lifetimeSpend = Number.MAX_VALUE; }],
]) {
  test(`a customer ${name} overflow refuses before checkout core mutation`, () => {
    const state = newGame('relaxed', name === 'visit counter' ? 24129 : 24130);
    const customer = allocateCustomerIdentity(state, { sourceId: `wal-${name}` });
    poison(customer.visitHistory);
    const tx = retailOnCounter(state, {
      id: `wal-customer-${name.replaceAll(' ', '-')}`,
      uid: `wal-customer-${name.replaceAll(' ', '-')}-unit`,
      taxRate: 0,
    });
    finishCardAndHandoff(tx);
    const before = coreAuthorities(state);
    const historyBefore = structuredClone(customer.visitHistory);

    const refused = completeSale(state, tx, customer);
    assert.equal(refused.ok, false);
    assert.match(refused.diagnostic || refused.reason, /history would overflow/i);
    assert.notEqual(tx.commitPrepared, true);
    assert.deepEqual(customer.visitHistory, historyBefore);
    assert.deepEqual(coreAuthorities(state), before);
  });
}

test('sales counter overflow refuses before creating a pending checkout', () => {
  const state = newGame('relaxed', 24131);
  state.shop.salesLive = { units: Number.MAX_SAFE_INTEGER, revenue: 0 };
  state.shop.salesToday = { balls1: Number.MAX_SAFE_INTEGER };
  const tx = retailOnCounter(state, {
    id: 'wal-sales-counter-overflow',
    uid: 'wal-sales-counter-overflow-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const before = coreAuthorities(state);

  const refused = completeSale(state, tx, 'Sales Overflow Golfer');
  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic || refused.reason, /projection targets are invalid/i);
  assert.notEqual(tx.commitPrepared, true);
  assert.deepEqual(coreAuthorities(state), before);
});

for (const kind of ['sales', 'tax']) {
  test(`a forged ${kind} projection checkpoint without its result refuses before core mutation`, () => {
    const state = newGame('relaxed', kind === 'sales' ? 24132 : 24133);
    const tx = retailOnCounter(state, {
      id: `wal-forged-${kind}-projection`,
      uid: `wal-forged-${kind}-projection-unit`,
    });
    finishCardAndHandoff(tx);
    const untouched = structuredClone(state);
    const replayTx = JSON.parse(JSON.stringify(tx));

    assert.throws(() => completeSale(state, tx, `Forged ${kind} Projection Golfer`, {
      qaFaultAfterCoreCommit: () => { throw new Error('capture projection checkpoint'); },
    }), /capture projection checkpoint/);
    const projectionId = `checkout:${tx.id}:${kind}-projection`;
    const checkpoint = structuredClone(state.shop.checkoutProjectionIds[projectionId]);
    assert.ok(checkpoint);
    untouched.shop.checkoutProjectionIds = { [projectionId]: checkpoint };
    const before = coreAuthorities(untouched);

    const refused = completeSale(
      untouched,
      replayTx,
      `Forged ${kind} Projection Golfer`,
    );
    assert.equal(refused.ok, false);
    assert.match(refused.diagnostic || refused.reason, /checkpoint has no matching result/i);
    assert.notEqual(replayTx.commitPrepared, true);
    assert.deepEqual(coreAuthorities(untouched), before);
  });
}

for (const [name, corrupt, reason] of [
  ['inactive', (lot) => { lot.active = false; }, /lot is unavailable/i],
  ['insufficient', (lot) => { lot.buckets[INVENTORY_STAGE.CUSTOMER_HELD] = 0; }, /not enough inventory/i],
]) {
  test(`${name} exact lot allocation refuses before creating an unrecoverable WAL`, () => {
    const state = newGame('relaxed', name === 'inactive' ? 24122 : 24123);
    const uid = `wal-${name}-lot-unit`;
    const tx = retailOnCounter(state, {
      id: `wal-${name}-lot`,
      uid,
      taxRate: 0,
    });
    finishCardAndHandoff(tx);
    const allocation = state.shop.inventoryLifecycle.heldAllocations[uid][0];
    const lot = state.shop.inventoryLifecycle.lots.find((entry) => entry.id === allocation.lotId);
    assert.ok(lot);
    corrupt(lot);
    const before = coreAuthorities(state);

    const refused = completeSale(state, tx, `${name} Lot Golfer`);
    assert.equal(refused.ok, false);
    assert.match(refused.diagnostic || refused.reason, reason);
    assert.notEqual(tx.commitPrepared, true);
    assert.deepEqual(pendingIds(state), []);
    assert.deepEqual(coreAuthorities(state), before,
      `${name} lot rejection leaves stock, books, projections, ticket, and WAL untouched`);
  });
}

test('an equal direct sale between a post-core fault and retry remains counted', () => {
  const state = newGame('relaxed', 24105);
  const tx = retailOnCounter(state, {
    id: 'wal-interleaved-sale',
    uid: 'wal-interleaved-unit',
  });
  finishCardAndHandoff(tx);
  const opening = {
    cash: state.cash,
    units: state.shop.salesLive?.units || 0,
    revenue: state.shop.salesLive?.revenue || 0,
    skuSales: state.shop.salesToday?.balls1 || 0,
    taxCollected: state.salesTax.collected,
  };

  assert.throws(() => completeSale(state, tx, 'Interleaved WAL Golfer', {
    qaFaultAfterCoreCommit: () => {
      throw new Error('interleave after operation projections');
    },
  }), /interleave after operation projections/);

  // The public direct-checkout path normally honors the pending-settlement lock.
  // Temporarily remove and restore that lock to model an adversarial legacy
  // writer interleaving a same-SKU, same-value sale before WAL recovery.
  const pending = state.shop.pendingCheckouts;
  state.shop.pendingCheckouts = {};
  const directItem = {
    uid: 'wal-interleaved-direct-unit',
    skuId: 'balls1',
    name: 'Practice Balls',
    price: 15,
  };
  if (state.shop.inventory.balls1.shelf <= 0) state.shop.inventory.balls1.shelf = 1;
  assert.equal(pickFromShelf(state, directItem.skuId, directItem.uid).ok, true);
  const direct = checkoutSale(
    state,
    [directItem],
    'Interleaved Direct Golfer',
    'wal-interleaved-direct',
    { taxRate: 0.07 },
  );
  assert.equal(direct.ok, true, direct.reason);
  state.shop.pendingCheckouts = pending;

  const afterBoth = {
    cash: state.cash,
    units: state.shop.salesLive.units,
    revenue: state.shop.salesLive.revenue,
    skuSales: state.shop.salesToday.balls1,
    taxCollected: state.salesTax.collected,
  };
  assert.equal(afterBoth.units, opening.units + 2);
  assert.equal(round2(afterBoth.revenue), round2(opening.revenue + 30));
  assert.equal(afterBoth.skuSales, opening.skuSales + 2);
  assert.equal(round2(afterBoth.taxCollected), round2(opening.taxCollected + 2.1));
  assert.equal(round2(afterBoth.cash), round2(opening.cash + 32.1));

  const retried = completeSale(state, tx, 'Interleaved WAL Golfer');
  assert.equal(retried.ok, true, retried.reason);
  assert.equal(retried.recovered, true);
  assert.deepEqual({
    cash: state.cash,
    units: state.shop.salesLive.units,
    revenue: state.shop.salesLive.revenue,
    skuSales: state.shop.salesToday.balls1,
    taxCollected: state.salesTax.collected,
  }, afterBoth, 'operation checkpoints replay without erasing or duplicating the direct sale');
});

test('a frozen transaction-history array is published through safe replacement', () => {
  const state = newGame('relaxed', 24106);
  const tx = retailOnCounter(state, {
    id: 'wal-frozen-history',
    uid: 'wal-frozen-history-unit',
    taxRate: 0,
  });
  finishCardAndHandoff(tx);
  const frozenHistory = Object.freeze(state.shop.transactionHistory.slice());
  state.shop.transactionHistory = frozenHistory;

  let result;
  assert.doesNotThrow(() => {
    result = completeSale(state, tx, 'Frozen History Golfer');
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(tx.banked, true);
  assert.notEqual(state.shop.transactionHistory, frozenHistory,
    'publication replaces the frozen container instead of mutating it');
  assert.equal(frozenHistory.length, 0);
  assert.equal(ticketsFor(state, tx.id).length, 1);
  assert.deepEqual(pendingIds(state), []);
});
