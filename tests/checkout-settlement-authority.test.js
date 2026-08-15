import test from 'node:test';
import assert from 'node:assert/strict';

import { checkoutSale, pickFromShelf } from '../src/sim/checkout.js';
import {
  validateCheckoutWalRecord,
  validateCheckoutSettlementReceipts,
} from '../src/sim/checkoutSettlement.js';
import { closeBooks, LEDGER_HISTORY_DAYS } from '../src/sim/economy.js';
import { inventoryPosition } from '../src/sim/inventoryLifecycle.js';
import {
  createReservationCheckInTx,
  finalizeReservationCheckIn,
  RESERVATION_CHECK_IN_TYPE,
  reservationPaymentReference,
} from '../src/sim/reservationCheckIn.js';
import {
  enterCardDigit,
  insertCard,
  presentCard,
  requestPayment,
  runCard,
  submitCardAmount,
  totalOf,
} from '../src/sim/register.js';
import { bookSlot } from '../src/sim/reservations.js';
import {
  CHECKOUT_WAL_SAVE_VERSION,
  deserialize,
  newGame,
  serialize,
} from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';

const INVENTORY_REFERENCE_PREFIX = 'checkout-sale-batch:v2:';

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
  )).join(',')}}`;
}

function resign(record) {
  delete record.signature;
  record.signature = stableSerialize(record);
  return record;
}

function checkoutRows(state, transactionId) {
  const prefix = `checkout:${transactionId}:`;
  return {
    ledger: (state.ledger.entries || []).filter(
      (entry) => entry?.idempotencyKey?.startsWith(prefix),
    ),
    outcomes: (state.ledger.outcomes || []).filter(
      (outcome) => outcome?.idempotencyKey?.startsWith(prefix),
    ),
  };
}

function retailCore(state, transactionId, skuId = 'balls1') {
  const rows = checkoutRows(state, transactionId);
  return structuredClone({
    cash: state.cash,
    position: inventoryPosition(state, skuId),
    ledger: rows.ledger,
    outcomes: rows.outcomes,
    processedIds: Object.fromEntries(Object.entries(state.ledger.processedIds || {})
      .filter(([key]) => key.startsWith(`checkout:${transactionId}:`))),
    processedOutcomeIds: Object.fromEntries(
      Object.entries(state.ledger.processedOutcomeIds || {})
        .filter(([key]) => key.startsWith(`checkout:${transactionId}:`)),
    ),
    salesLive: state.shop.salesLive || null,
    salesToday: state.shop.salesToday || {},
    salesTax: state.salesTax,
  });
}

function assertCheckoutQuarantined(state) {
  assert.equal(state.shop.pendingCheckoutsQuarantine?.active, true);
  assert.deepEqual(state.shop.pendingCheckouts, {});
}

function capturePendingRetail({ seed, transactionId, uid }) {
  const state = newGame('relaxed', seed);
  assert.equal(pickFromShelf(state, 'balls1', uid).ok, true);
  const pristine = JSON.parse(serialize(state));
  assert.throws(() => checkoutSale(
    state,
    [{ uid, skuId: 'balls1', price: 15 }],
    'Authority Test Golfer',
    transactionId,
    {
      taxRate: 0,
      qaFaultAfterCoreCommit() {
        throw new Error('capture signed checkout settlement');
      },
    },
  ), /capture signed checkout settlement/);
  const settlementId = `checkout:${transactionId}`;
  const plan = structuredClone(state.shop.pendingCheckouts[settlementId]);
  assert.ok(plan, 'the injected interruption retains the signed settlement plan');
  for (const line of plan.inventory.entries) {
    pristine.shop.inventoryLifecycle.operations[`customer-pick:${line.uid}`]
      .checkoutPriceAuthority = structuredClone(plan.inventory.priceAuthority);
  }
  return { pristine, plan, settlementId };
}

function rewritePlanSettlementId(plan, settlementId) {
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.version === 1 && typeof value.settlementId === 'string') {
      value.settlementId = settlementId;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(plan);
  resign(plan);
  return plan;
}

function completedRetail({ seed, transactionId, uid }) {
  const state = newGame('relaxed', seed);
  assert.equal(pickFromShelf(state, 'balls1', uid).ok, true);
  const sale = checkoutSale(
    state,
    [{ uid, skuId: 'balls1', price: 15 }],
    'Receipt Test Golfer',
    transactionId,
    { taxRate: 0 },
  );
  assert.equal(sale.ok, true, sale.reason || sale.diagnostic);
  const settlementId = `checkout:${transactionId}`;
  assert.ok(state.shop.checkoutSettlementReceipts[settlementId]);
  return { state, settlementId };
}

function approvedReservationCard(state, reservation) {
  const made = createReservationCheckInTx(state, reservation.id, {
    method: 'card',
    rng: () => 0.9,
  });
  assert.equal(made.ok, true, made.reason);
  const { tx } = made;
  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  for (const digit of String(Math.round(totalOf(tx) * 100))) {
    assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
  }
  assert.equal(submitCardAmount(tx).ok, true);
  assert.equal(runCard(tx, { force: 'approved' }).result, 'approved');
  return tx;
}

function reservationFor(state, name) {
  const dayAbs = calendarOf(state.clock.minutes).dayAbs + 1;
  const made = bookSlot(state, dayAbs, 480, name);
  assert.equal(made.ok, true, made.reason);
  return made.res;
}

function capturePendingService({ seed, name }) {
  const state = newGame('relaxed', seed);
  const reservation = reservationFor(state, name);
  const tx = approvedReservationCard(state, reservation);
  assert.throws(() => finalizeReservationCheckIn(
    state,
    tx,
    reservation.id,
    {
      qaFaultAfterCoreCommit() {
        throw new Error('capture signed service settlement');
      },
    },
  ), /capture signed service settlement/);
  const settlementId = `service:${RESERVATION_CHECK_IN_TYPE}:${reservationPaymentReference(reservation.id)}`;
  const plan = state.shop.pendingCheckouts[settlementId];
  assert.ok(plan, 'the injected interruption retains the signed service settlement plan');
  return { state, reservation, settlementId, plan };
}

function completedService({ seed, name }) {
  const state = newGame('relaxed', seed);
  const reservation = reservationFor(state, name);
  const tx = approvedReservationCard(state, reservation);
  const completed = finalizeReservationCheckIn(state, tx);
  assert.equal(completed.ok, true, completed.reason || completed.diagnostic);
  const settlementId = `service:${RESERVATION_CHECK_IN_TYPE}:${reservationPaymentReference(reservation.id)}`;
  assert.ok(state.shop.checkoutSettlementReceipts[settlementId]);
  return { state, reservation, settlementId };
}

test('a transaction plan whose signed settlement id is not canonical quarantines before core mutation', () => {
  const transactionId = 'authority-plan-canonical-id';
  const uid = 'authority-plan-canonical-unit';
  const { pristine, plan } = capturePendingRetail({
    seed: 27100,
    transactionId,
    uid,
  });
  const forgedSettlementId = 'checkout:forged-canonical-owner';
  rewritePlanSettlementId(plan, forgedSettlementId);
  pristine.shop.pendingCheckouts = { [forgedSettlementId]: plan };
  const before = retailCore(pristine, transactionId);

  const loaded = deserialize(pristine);

  assertCheckoutQuarantined(loaded);
  assert.deepEqual(retailCore(loaded, transactionId), before,
    'a non-canonical signed plan cannot move stock, cash, or accounting authority');
  assert.equal(loaded.shop.held.some((item) => item.uid === uid), true);
});

for (const missingField of [
  'checkoutSettlementReceipts',
  'checkoutSettlementReceiptKeys',
]) {
  test(`a V15 save missing only ${missingField} quarantines its checkout authority`, () => {
    const raw = JSON.parse(serialize(newGame('relaxed', 27101)));
    assert.equal(raw.version, CHECKOUT_WAL_SAVE_VERSION);
    delete raw.shop[missingField];

    const loaded = deserialize(raw);

    assertCheckoutQuarantined(loaded);
  });
}

for (const [label, version] of [
  ['numeric downgrade', CHECKOUT_WAL_SAVE_VERSION - 1],
  ['malformed version', 'not-a-save-version'],
]) {
  test(`${label} cannot make V15-only receipt authorities valid without a WAL field`, () => {
    const raw = JSON.parse(serialize(newGame('relaxed', 27102)));
    raw.version = version;
    delete raw.shop.pendingCheckouts;
    assert.deepEqual(raw.shop.checkoutSettlementReceipts, {});
    assert.deepEqual(raw.shop.checkoutSettlementReceiptKeys, []);
    assert.deepEqual(raw.shop.checkoutProjectionIds, {});

    const loaded = deserialize(raw);

    assertCheckoutQuarantined(loaded);
  });
}

for (const exactFirst of [true, false]) {
  test(`duplicate raw transaction tickets quarantine with the exact ticket ${exactFirst ? 'first' : 'second'}`, () => {
    const transactionId = `authority-duplicate-ticket-${exactFirst ? 'first' : 'second'}`;
    const uid = `${transactionId}-unit`;
    const { pristine, plan, settlementId } = capturePendingRetail({
      seed: exactFirst ? 27103 : 27104,
      transactionId,
      uid,
    });
    const exact = structuredClone(plan.ticketDraft);
    const forged = structuredClone(plan.ticketDraft);
    forged.customer = 'A different forged customer';
    pristine.shop.pendingCheckouts = { [settlementId]: plan };
    pristine.shop.transactionHistory = exactFirst ? [exact, forged] : [forged, exact];
    const before = retailCore(pristine, transactionId);

    const loaded = deserialize(pristine);

    assertCheckoutQuarantined(loaded);
    assert.deepEqual(retailCore(loaded, transactionId), before,
      'raw duplicate ordering cannot choose which ticket gets to commit the plan');
  });
}

for (const correctFirst of [true, false]) {
  test(`duplicate raw held UIDs quarantine with the correct SKU ${correctFirst ? 'first' : 'second'}`, () => {
    const transactionId = `authority-duplicate-held-${correctFirst ? 'first' : 'second'}`;
    const uid = `${transactionId}-unit`;
    const { pristine, plan, settlementId } = capturePendingRetail({
      seed: correctFirst ? 27105 : 27106,
      transactionId,
      uid,
    });
    const correct = { uid, skuId: 'balls1' };
    const forged = { uid, skuId: 'tees1' };
    pristine.shop.pendingCheckouts = { [settlementId]: plan };
    pristine.shop.held = correctFirst ? [correct, forged] : [forged, correct];
    const before = retailCore(pristine, transactionId);

    const loaded = deserialize(pristine);

    assertCheckoutQuarantined(loaded);
    assert.deepEqual(retailCore(loaded, transactionId), before,
      'raw duplicate ordering cannot choose which held product the plan consumes');
  });
}

test('duplicate held UIDs unrelated to checkout authority do not quarantine a clean state', () => {
  const state = newGame('relaxed', 27112);
  assert.equal(pickFromShelf(state, 'balls1', 'unrelated-duplicate-held-unit').ok, true);
  const raw = JSON.parse(serialize(state));
  raw.shop.held.push(structuredClone(raw.shop.held[0]));
  assert.deepEqual(raw.shop.pendingCheckouts, {});
  assert.deepEqual(raw.shop.checkoutSettlementReceipts, {});

  const loaded = deserialize(raw);

  assert.notEqual(loaded.shop.pendingCheckoutsQuarantine?.active, true,
    'inventory ambiguity with no settlement owner is not checkout corruption');
  assert.deepEqual(loaded.shop.pendingCheckouts, {});
  assert.deepEqual(loaded.shop.checkoutSettlementReceipts, {});
});

for (const scenario of [
  {
    name: 'receipt item UID disagrees with its inventory identity and ticket',
    signatureChanges: true,
    mutate(raw, receipt) {
      receipt.itemUids = ['forged-receipt-item-uid'];
      resign(receipt);
    },
  },
  {
    name: 'ticket item UID disagrees with its retained receipt',
    signatureChanges: false,
    mutate(raw, receipt, transactionId) {
      const ticket = raw.shop.transactionHistory.find(
        (entry) => entry.transactionId === transactionId,
      );
      assert.ok(ticket);
      ticket.items[0].uid = 'forged-ticket-item-uid';
      // Recompute the still-valid receipt signature as part of the hostile save
      // image, proving the rejection is a cross-authority check rather than a
      // stale-checksum check.
      resign(receipt);
    },
  },
  {
    name: 'inventory reference identity disagrees with its retained receipt items',
    signatureChanges: true,
    mutate(raw, receipt) {
      const oldReferenceId = receipt.inventoryReferenceId;
      assert.ok(oldReferenceId.startsWith(INVENTORY_REFERENCE_PREFIX));
      const identity = JSON.parse(oldReferenceId.slice(INVENTORY_REFERENCE_PREFIX.length));
      identity.items[0][0] = 'forged-inventory-reference-uid';
      const forgedReferenceId = `${INVENTORY_REFERENCE_PREFIX}${JSON.stringify(identity)}`;
      const operations = raw.shop.inventoryLifecycle.operations;
      operations[forgedReferenceId] = operations[oldReferenceId];
      delete operations[oldReferenceId];
      raw.shop.inventoryLifecycle.operationKeys = raw.shop.inventoryLifecycle.operationKeys
        .map((key) => key === oldReferenceId ? forgedReferenceId : key);
      receipt.inventoryReferenceId = forgedReferenceId;
      resign(receipt);
    },
  },
]) {
  test(`a recomputed receipt signature cannot hide that its ${scenario.name}`, () => {
    const transactionId = `authority-receipt-${scenario.name.replaceAll(' ', '-')}`;
    const { state, settlementId } = completedRetail({
      seed: 27107,
      transactionId,
      uid: `${transactionId}-unit`,
    });
    const raw = JSON.parse(serialize(state));
    const receipt = raw.shop.checkoutSettlementReceipts[settlementId];
    const originalSignature = receipt.signature;
    scenario.mutate(raw, receipt, transactionId);
    assert.equal(
      receipt.signature === originalSignature,
      !scenario.signatureChanges,
      'the fixture keeps a valid recomputed receipt signature after its mutation',
    );

    const loaded = deserialize(raw);

    assertCheckoutQuarantined(loaded);
    assert.equal(loaded.cash, raw.cash,
      'receipt/ticket/inventory disagreement cannot replay or unwind cash');
  });
}

test('a positive service settlement remains authoritative and non-quarantined across save/load', () => {
  const state = newGame('relaxed', 27108);
  const reservation = reservationFor(state, 'Positive Service Golfer');
  const tx = approvedReservationCard(state, reservation);
  const completed = finalizeReservationCheckIn(state, tx);
  assert.equal(completed.ok, true, completed.reason || completed.diagnostic);
  const settlementId = `service:${RESERVATION_CHECK_IN_TYPE}:${reservationPaymentReference(reservation.id)}`;
  assert.ok(state.shop.checkoutSettlementReceipts[settlementId]);

  const loaded = deserialize(serialize(state));

  assert.notEqual(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.ok(loaded.shop.checkoutSettlementReceipts[settlementId]);
  assert.equal(loaded.shop.transactionHistory.filter(
    (ticket) => ticket.type === RESERVATION_CHECK_IN_TYPE
      && ticket.referenceId === reservationPaymentReference(reservation.id),
  ).length, 1);
});

test('a coherently re-signed reservation WAL cannot inflate its paid projections', () => {
  const { state, reservation, settlementId } = capturePendingService({
    seed: 27117,
    name: 'Forged Reservation Projection Golfer',
  });
  const raw = structuredClone(state);
  const plan = raw.shop.pendingCheckouts[settlementId];
  const forgedIncrease = 100;
  plan.ticketDraft.details.priorPaid += forgedIncrease;
  plan.ticketDraft.details.totalReservationFee += forgedIncrease;
  plan.reservationTarget.fields.totalPaid += forgedIncrease;
  plan.reservationTarget.paymentFields.total += forgedIncrease;
  plan.reservationTarget.paymentFields.amountPaid += forgedIncrease;
  resign(plan);
  const reservationBefore = structuredClone(raw.reservations.booked.find(
    (entry) => entry.id === reservation.id,
  ));

  assert.equal(validateCheckoutWalRecord({ [settlementId]: plan }).ok, false,
    'the signed WAL is invalid even when all of its forged target totals agree');
  const loaded = deserialize(raw);

  assertCheckoutQuarantined(loaded);
  const restored = loaded.reservations.booked.find((entry) => entry.id === reservation.id);
  assert.equal(restored.status, 'booked');
  assert.equal(restored.totalPaid, reservationBefore.totalPaid);
  assert.equal(restored.payment.amountPaid, reservationBefore.payment.amountPaid);
  assert.equal(restored.payment.total, reservationBefore.payment.total);
});

test('a re-signed reservation WAL cannot add a second financial projection field', () => {
  const { plan, settlementId } = capturePendingService({
    seed: 27119,
    name: 'Forged Reservation Schema Golfer',
  });
  const forged = structuredClone(plan);
  forged.reservationTarget.paymentFields.storeCredit = 250;
  resign(forged);

  const validation = validateCheckoutWalRecord({ [settlementId]: forged });

  assert.equal(validation.ok, false);
  assert.match(validation.diagnostic, /reservation target/i);
});

test('a standalone reservation WAL cannot discard its booking projection', () => {
  const { state, settlementId } = capturePendingService({
    seed: 27120,
    name: 'Missing Reservation Target Golfer',
  });
  const raw = structuredClone(state);
  raw.shop.pendingCheckouts[settlementId].reservationTarget = null;
  resign(raw.shop.pendingCheckouts[settlementId]);

  assert.equal(validateCheckoutWalRecord(
    { [settlementId]: raw.shop.pendingCheckouts[settlementId] },
    raw,
  ).ok, false);
  const loaded = deserialize(raw);
  assertCheckoutQuarantined(loaded);
});

test('the settlement journal rejects service types outside reservation check-in', () => {
  const { plan } = capturePendingService({
    seed: 27121,
    name: 'Generic Service Authority Golfer',
  });
  const forged = structuredClone(plan);
  const referenceId = 'custom-service-charge';
  const settlementId = `service:custom-service:${referenceId}`;
  forged.ticketKey = { kind: 'service', type: 'custom-service', referenceId };
  forged.settlementId = settlementId;
  forged.ticketDraft.type = 'custom-service';
  forged.ticketDraft.referenceId = referenceId;
  delete forged.ticketDraft.customerVisitEvent;
  forged.ticketDraft.items[0].uid = `${referenceId}:charge`;
  forged.reservationTarget = null;
  const revenue = forged.postings.find((posting) => posting.component === 'revenue');
  const key = `${settlementId}:revenue`;
  revenue.spec.idempotencyKey = key;
  revenue.spec.entryId = `le:${revenue.spec.propertyId}:${key}`;
  revenue.spec.relatedId = referenceId;
  revenue.spec.metadata.type = 'custom-service';
  forged.ticketDraft.ledgerIdempotencyKeys.revenue = key;
  forged.ticketDraft.ledgerEntryIds.revenue = revenue.spec.entryId;
  rewritePlanSettlementId(forged, settlementId);

  const validation = validateCheckoutWalRecord({ [settlementId]: forged });

  assert.equal(validation.ok, false);
  assert.match(validation.diagnostic, /service|reservation/i);
});

test('a reservation WAL whose live booking left both CAS states quarantines on load', () => {
  const { state, reservation } = capturePendingService({
    seed: 27122,
    name: 'Diverged Reservation Target Golfer',
  });
  const raw = structuredClone(state);
  const live = raw.reservations.booked.find((entry) => entry.id === reservation.id);
  live.currentDestination = 'unrelated-destination';

  const loaded = deserialize(raw);

  assertCheckoutQuarantined(loaded);
});

test('a reservation checkout event cannot be relabelled as a retail visit', () => {
  const { plan, settlementId } = capturePendingService({
    seed: 27123,
    name: 'Forged Visit Semantics Golfer',
  });
  const forged = structuredClone(plan);
  forged.ticketDraft.customerVisitEvent.purpose = 'retail';
  forged.ticketDraft.customerVisitEvent.outcomes = ['purchase'];
  resign(forged);

  const validation = validateCheckoutWalRecord({ [settlementId]: forged });

  assert.equal(validation.ok, false);
  assert.match(validation.diagnostic, /customer event|reservation/i);
});

test('a retained service receipt restores its exact reservation tail without rebanking', () => {
  const state = newGame('relaxed', 27124);
  const reservation = reservationFor(state, 'Retained Reservation Tail Golfer');
  const tx = approvedReservationCard(state, reservation);
  const beforeReservation = structuredClone(reservation);
  const completed = finalizeReservationCheckIn(state, tx);
  assert.equal(completed.ok, true, completed.reason || completed.diagnostic);
  const settlementId = `service:${RESERVATION_CHECK_IN_TYPE}:${reservationPaymentReference(reservation.id)}`;
  const receipt = state.shop.checkoutSettlementReceipts[settlementId];
  assert.ok(receipt?.reservationTarget);
  const cashAfterFirstPayment = state.cash;
  state.shop.transactionHistory = state.shop.transactionHistory.filter((ticket) => (
    ticket.type !== RESERVATION_CHECK_IN_TYPE
      || ticket.referenceId !== reservationPaymentReference(reservation.id)
  ));
  const index = state.reservations.booked.findIndex((entry) => entry.id === reservation.id);
  state.reservations.booked[index] = beforeReservation;

  const retry = approvedReservationCard(state, state.reservations.booked[index]);
  const recovered = finalizeReservationCheckIn(state, retry);

  assert.equal(recovered.ok, true, recovered.reason || recovered.diagnostic);
  assert.equal(recovered.recovered, true);
  assert.equal(state.cash, cashAfterFirstPayment, 'receipt replay never banks the fee twice');
  const restored = state.reservations.booked[index];
  assert.equal(restored.status, 'played');
  assert.equal(restored.checkInReferenceId, reservationPaymentReference(reservation.id));
  assert.equal(restored.checkInTransactionNumber, receipt.ticketNumber);
});

for (const scenario of [
  {
    label: 'a self-declared shop-sales account',
    mutate(plan) {
      plan.ticketDraft.revenueKey = 'shopSales';
      const revenue = plan.postings.find((posting) => posting.component === 'revenue');
      revenue.spec.lineKey = 'shopSales';
      revenue.spec.category = 'shopSales';
      revenue.spec.aggregate = {
        side: 'revenue',
        key: 'shopSales',
        amount: revenue.spec.amount,
      };
    },
  },
  {
    label: 'a non-service posting source',
    mutate(plan) {
      plan.postings.find((posting) => posting.component === 'revenue')
        .spec.source = 'checkout';
    },
  },
  {
    label: 'a different service metadata type',
    mutate(plan) {
      plan.postings.find((posting) => posting.component === 'revenue')
        .spec.metadata.type = 'reservation-deposit';
    },
  },
]) {
  test(`a re-signed reservation WAL rejects ${scenario.label}`, () => {
    const { plan, settlementId } = capturePendingService({
      seed: 27118,
      name: 'Forged Reservation Revenue Golfer',
    });
    const forged = structuredClone(plan);
    scenario.mutate(forged);
    resign(forged);

    const validation = validateCheckoutWalRecord({ [settlementId]: forged });

    assert.equal(validation.ok, false,
      'reservation revenue authority is canonical rather than self-declared');
    assert.match(validation.diagnostic, /reservation service authority|ledger plan/i);
  });
}

test('an unmarked completed service ticket with mutated financial content quarantines against its retained receipt', () => {
  const { state, reservation, settlementId } = completedService({
    seed: 27115,
    name: 'Unmarked Mutated Service Golfer',
  });
  const raw = JSON.parse(serialize(state));
  const referenceId = reservationPaymentReference(reservation.id);
  const ticket = raw.shop.transactionHistory.find((entry) => (
    entry.type === RESERVATION_CHECK_IN_TYPE && entry.referenceId === referenceId
  ));
  assert.ok(ticket);
  assert.ok(raw.shop.checkoutSettlementReceipts[settlementId]);
  delete ticket.checkoutSettlement;
  ticket.items[0].price += 11;
  ticket.total += 11;
  const cashBefore = raw.cash;

  const loaded = deserialize(raw);

  assertCheckoutQuarantined(loaded);
  assert.equal(loaded.cash, cashBefore,
    'removing the marker cannot hide changed service money from the retained receipt');
});

for (const scenario of [
  {
    label: 'merchandise content',
    mutate(ticket) {
      ticket.items[0] = {
        uid: 'forged-service-wal-merchandise-unit',
        skuId: 'balls1',
        name: 'Forged Golf Balls',
        price: ticket.items[0].price,
      };
    },
  },
  {
    label: 'a total that disagrees with its ledger posting',
    mutate(ticket) {
      ticket.total += 7;
      ticket.items[0].price += 7;
    },
  },
]) {
  test(`a re-signed service WAL with ${scenario.label} quarantines before publishing its ticket`, () => {
    const { state, settlementId, plan } = capturePendingService({
      seed: 27113,
      name: 'Forged Pending Service Golfer',
    });
    const raw = structuredClone(state);
    const rawPlan = raw.shop.pendingCheckouts[settlementId];
    scenario.mutate(rawPlan.ticketDraft);
    resign(rawPlan);
    const cashBefore = raw.cash;

    const loaded = deserialize(raw);

    assertCheckoutQuarantined(loaded);
    assert.equal(loaded.cash, cashBefore,
      'rejecting the forged ticket cannot replay or unwind its already posted core');
    assert.equal(loaded.shop.transactionHistory.some((ticket) => (
      ticket.type === plan.ticketKey.type
        && ticket.referenceId === plan.ticketKey.referenceId
    )), false, 'the forged service ticket never becomes terminal history');
  });
}

for (const scenario of [
  {
    label: 'merchandise content',
    mutate(ticket) {
      ticket.items[0] = {
        uid: 'forged-terminal-service-merchandise-unit',
        skuId: 'balls1',
        name: 'Forged Golf Balls',
        price: ticket.items[0].price,
      };
    },
  },
  {
    label: 'a total that disagrees with its ledger posting',
    mutate(ticket) {
      ticket.total += 9;
      ticket.items[0].price += 9;
    },
  },
]) {
  test(`a terminal service ticket with ${scenario.label} quarantines against its receipt`, () => {
    const { state, reservation } = completedService({
      seed: 27114,
      name: 'Forged Terminal Service Golfer',
    });
    const raw = JSON.parse(serialize(state));
    const referenceId = reservationPaymentReference(reservation.id);
    const ticket = raw.shop.transactionHistory.find((entry) => (
      entry.type === RESERVATION_CHECK_IN_TYPE && entry.referenceId === referenceId
    ));
    assert.ok(ticket);
    scenario.mutate(ticket);
    const cashBefore = raw.cash;

    const loaded = deserialize(raw);

    assertCheckoutQuarantined(loaded);
    assert.equal(loaded.cash, cashBefore,
      'terminal ticket disagreement cannot replay or unwind settled service cash');
  });
}

test('a retained service receipt cannot be re-signed under another service reference', () => {
  const state = newGame('relaxed', 27109);
  const reservation = reservationFor(state, 'Forged Service Receipt Golfer');
  const tx = approvedReservationCard(state, reservation);
  assert.equal(finalizeReservationCheckIn(state, tx).ok, true);
  const raw = JSON.parse(serialize(state));
  const originalSettlementId = `service:${RESERVATION_CHECK_IN_TYPE}:${reservationPaymentReference(reservation.id)}`;
  const forgedSettlementId = `service:${RESERVATION_CHECK_IN_TYPE}:forged-service-reference`;
  const receipt = raw.shop.checkoutSettlementReceipts[originalSettlementId];
  assert.ok(receipt);
  delete raw.shop.checkoutSettlementReceipts[originalSettlementId];
  receipt.settlementId = forgedSettlementId;
  resign(receipt);
  raw.shop.checkoutSettlementReceipts[forgedSettlementId] = receipt;
  raw.shop.checkoutSettlementReceiptKeys = raw.shop.checkoutSettlementReceiptKeys
    .map((key) => key === originalSettlementId ? forgedSettlementId : key);

  const loaded = deserialize(raw);

  assertCheckoutQuarantined(loaded);
});

test('an aged transaction receipt rejects ticket snapshot retail SKU pairs that disagree with inventory identity after ticket history is pruned', () => {
  const transactionId = 'authority-aged-receipt-sku-conflict';
  const { state, settlementId } = completedRetail({
    seed: 27116,
    transactionId,
    uid: 'authority-aged-receipt-sku-conflict-unit',
  });
  state.clock.minutes = (LEDGER_HISTORY_DAYS + 1) * 1440;
  closeBooks(state, LEDGER_HISTORY_DAYS + 1);
  state.shop.transactionHistory = [];
  const raw = JSON.parse(serialize(state));
  const receipt = raw.shop.checkoutSettlementReceipts[settlementId];
  assert.ok(receipt);
  assert.equal(checkoutRows(raw, transactionId).ledger.length, 0,
    'the normal retention pass prunes immutable ledger rows for this aged checkout');
  receipt.ticketSnapshot.items[0].skuId = 'tees1';
  resign(receipt);

  assert.equal(validateCheckoutSettlementReceipts(
    raw.shop.checkoutSettlementReceipts,
    raw.shop.checkoutSettlementReceiptKeys,
  ).ok, false, 'receipt validation binds each retained retail UID to its inventory SKU');

  const loaded = deserialize(raw);

  assertCheckoutQuarantined(loaded);
  assert.equal(loaded.cash, raw.cash,
    'a forged aged receipt cannot replay or unwind settled retail cash');
});

test('a zero-dollar prepaid service writes a terminal receipt that survives roundtrip', () => {
  const state = newGame('relaxed', 27110);
  const reservation = reservationFor(state, 'Zero Dollar Service Golfer');
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
  const made = createReservationCheckInTx(state, reservation.id, {
    method: 'cash',
    rng: () => 0.9,
  });
  assert.equal(made.ok, true, made.reason);
  assert.equal(requestPayment(made.tx).ok, true);
  assert.equal(made.tx.stage, 'receipt');

  const completed = finalizeReservationCheckIn(state, made.tx);

  assert.equal(completed.ok, true, completed.reason || completed.diagnostic);
  assert.equal(completed.ticket.total, 0);
  assert.equal(state.cash, cashBefore);
  const settlementId = `service:${RESERVATION_CHECK_IN_TYPE}:${reservationPaymentReference(reservation.id)}`;
  assert.ok(state.shop.checkoutSettlementReceipts[settlementId]);
  const loaded = deserialize(serialize(state));
  assert.notEqual(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.ok(loaded.shop.checkoutSettlementReceipts[settlementId]);
  assert.equal(loaded.cash, cashBefore);
});

test('a full receipt authority preserves its oldest legitimate transaction when admitting a new checkout', () => {
  const oldestTransactionId = 'authority-oldest-retained-transaction';
  const { state, settlementId: oldestSettlementId } = completedRetail({
    seed: 27111,
    transactionId: oldestTransactionId,
    uid: 'authority-oldest-retained-unit',
  });
  const oldestReceipt = structuredClone(
    state.shop.checkoutSettlementReceipts[oldestSettlementId],
  );
  const propertyId = state.property?.id || `club-${state.seed}`;
  for (let index = 1; index < 2_000; index += 1) {
    const transactionId = `authority-retained-${index}`;
    const settlementId = `checkout:${transactionId}`;
    const uid = `authority-retained-unit-${index}`;
    const receipt = structuredClone(oldestReceipt);
    receipt.settlementId = settlementId;
    receipt.ticketKey = { kind: 'transaction', transactionId };
    receipt.alternateTicketKeys = [];
    receipt.transactionId = transactionId;
    receipt.ticketNumber = index + 1;
    receipt.itemUids = [uid];
    receipt.ticketSnapshot.transactionId = transactionId;
    receipt.ticketSnapshot.number = index + 1;
    receipt.ticketSnapshot.items[0].uid = uid;
    receipt.ticketSnapshot.checkoutSettlement.settlementId = settlementId;
    receipt.inventoryReferenceId = `${INVENTORY_REFERENCE_PREFIX}${JSON.stringify({
      transactionId,
      items: [[uid, 'balls1']],
    })}`;
    for (const posting of receipt.postings) {
      const suffix = posting.component === 'sale' ? 'sale' : posting.component;
      posting.idempotencyKey = `checkout:${transactionId}:${suffix}`;
      posting.entryId = `le:${propertyId}:${posting.idempotencyKey}`;
      posting.relatedId = transactionId;
      posting.spec.idempotencyKey = posting.idempotencyKey;
      posting.spec.entryId = posting.entryId;
      posting.spec.relatedId = transactionId;
      posting.spec.metadata.checkoutSettlement.settlementId = settlementId;
      receipt.ticketSnapshot.ledgerIdempotencyKeys[posting.component]
        = posting.idempotencyKey;
      receipt.ticketSnapshot.ledgerEntryIds[posting.component] = posting.entryId;
    }
    for (const projection of receipt.projections) {
      projection.id = projection.kind === 'sales'
        ? `${settlementId}:sales-projection`
        : `${settlementId}:tax-projection`;
      projection.checkoutSettlement.settlementId = settlementId;
    }
    receipt.outcomeKey = `checkout:${transactionId}:completed`;
    receipt.outcomeId = `out:${propertyId}:${receipt.outcomeKey}`;
    receipt.outcomeSpec.idempotencyKey = receipt.outcomeKey;
    receipt.outcomeSpec.id = receipt.outcomeId;
    receipt.outcomeSpec.relatedId = transactionId;
    receipt.outcomeSpec.metadata.checkoutSettlement.settlementId = settlementId;
    resign(receipt);
    state.shop.checkoutSettlementReceipts[settlementId] = receipt;
    state.shop.checkoutSettlementReceiptKeys.push(settlementId);
  }
  assert.equal(state.shop.checkoutSettlementReceiptKeys.length, 2_000);
  assert.equal(validateCheckoutSettlementReceipts(
    state.shop.checkoutSettlementReceipts,
    state.shop.checkoutSettlementReceiptKeys,
  ).ok, true, 'the capacity fixture is structurally valid before the prospective sale');

  const nextTransactionId = 'authority-over-cap-prospective';
  const nextUid = 'authority-over-cap-unit';
  assert.equal(pickFromShelf(state, 'balls1', nextUid).ok, true);
  const earliestUnpinnedSettlementId = 'checkout:authority-retained-1';
  assert.ok(state.shop.checkoutSettlementReceipts[earliestUnpinnedSettlementId]);

  const admitted = checkoutSale(
    state,
    [{ uid: nextUid, skuId: 'balls1', price: 15 }],
    'Receipt Capacity Golfer',
    nextTransactionId,
    { taxRate: 0 },
  );

  assert.equal(admitted.ok, true, admitted.reason || admitted.diagnostic);
  assert.deepEqual(state.shop.pendingCheckouts, {});
  assert.equal(checkoutRows(state, nextTransactionId).ledger.length, 2);
  assert.equal(checkoutRows(state, nextTransactionId).outcomes.length, 1);
  assert.equal(state.shop.held.some((item) => item.uid === nextUid), false);
  assert.deepEqual(
    state.shop.checkoutSettlementReceipts[oldestSettlementId],
    oldestReceipt,
  );
  assert.equal(
    state.shop.checkoutSettlementReceipts[earliestUnpinnedSettlementId],
    undefined,
    'capacity retires the earliest unpinned record rather than the oldest real transaction',
  );
  assert.ok(state.shop.checkoutSettlementReceipts[`checkout:${nextTransactionId}`]);
  assert.equal(state.shop.checkoutSettlementReceiptKeys[0], oldestSettlementId);
  assert.equal(state.shop.checkoutSettlementReceiptKeys.length, 2_000);
});
