import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '../src/core/utils.js';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import { configureTeeSheet,
  TEE_SHEET,
  ensureReservations,
  configureReservations,
  reservationConfig,
  bookReservation,
  bookSlot,
  cancelReservation,
  slotLoad,
  slotAvailability,
  generateOnlineReservations,
  planReservationArrival,
  dueForArrivals,
  markReservationEnRoute,
  markReservationArrived,
  processReservationTimeline,
  bankReservationDeposit,
  chargeNoShowFee,
  markReservationNoShow,
  checkInReservation,
  RESERVATION_DEPOSIT_TYPE,
  RESERVATION_NO_SHOW_FEE_TYPE,
  reservationDepositReference,
  reservationNoShowFeeReference,
  walkInAvailability,
  selectWalkInSlot,
} from '../src/sim/reservations.js';

const today = (state) => calendarOf(state.clock.minutes).dayAbs;

test('legacy reservation snapshots migrate once into stable rich customer records', () => {
  const state = newGame('relaxed', 3101);
  const dayAbs = today(state) + 1;
  state.reservations = {
    nextId: 8,
    booked: [{ id: 7, dayAbs, minute: 510, name: 'Legacy Golfer', fee: 32, status: 'booked' }],
  };

  ensureReservations(state);
  const migrated = state.reservations.booked[0];
  assert.equal(migrated.customerId, 'reservation-customer-7');
  assert.equal(migrated.fullName, 'Legacy Golfer');
  assert.equal(migrated.reservationId, 7);
  assert.equal(migrated.groupSize, 1,
    'a legacy record with one named golfer must not be inflated into a foursome');
  assert.equal(slotLoad(state, dayAbs, 510).remainingCapacity,
    reservationConfig(state).slotCapacity - 1,
    'the migrated singleton consumes exactly one place in the tee slot');
  assert.equal(migrated.teeTime, 510);
  assert.equal(migrated.paymentStatus, 'unpaid');
  assert.equal(migrated.arrivalStatus, 'scheduled');
  assert.equal(migrated.checkInStatus, 'pending');
  assert.equal(migrated.customerType, 'reservation');
  assert.ok(Number.isFinite(migrated.plannedArrival));
  assert.ok(Number.isFinite(migrated.arrivalWindow.start));
  assert.equal(migrated.noShowFeeStatus, 'not-due');

  const stableId = migrated.customerId;
  ensureReservations(state);
  assert.equal(state.reservations.booked[0].customerId, stableId, 're-running migration does not replace identity');
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.reservations.booked[0].customerId, stableId, 'identity and timeline persist through save/load');
});

test('capacity-aware parties can share a slot but never exceed configured course capacity', () => {
  const state = newGame('relaxed', 3102);
  const dayAbs = today(state) + 1;
  configureReservations(state, { slotCapacity: 4, maxGroupSize: 4 });

  assert.ok(bookReservation(state, { dayAbs, minute: 480, name: 'Pair One', partySize: 2 }).ok);
  const second = bookReservation(state, { dayAbs, minute: 480, name: 'Pair Two', partySize: 2 });
  assert.ok(second.ok);
  assert.deepEqual(slotLoad(state, dayAbs, 480), {
    dayAbs,
    minute: 480,
    capacity: 4,
    bookedPlayers: 4,
    remainingCapacity: 0,
    reservations: slotLoad(state, dayAbs, 480).reservations,
  });
  assert.equal(bookReservation(state, { dayAbs, minute: 480, name: 'Overflow', partySize: 1 }).ok, false);
  assert.equal(bookReservation(state, { dayAbs, minute: 510, name: 'Too Large', partySize: 5 }).ok, false);

  assert.ok(cancelReservation(state, second.res.id).ok);
  assert.equal(slotAvailability(state, dayAbs, 480, 2).available, true, 'cancellation releases exactly its party capacity');
  assert.ok(bookReservation(state, { dayAbs, minute: 480, name: 'Replacement Pair', partySize: 2 }).ok);

  const legacy = bookSlot(state, dayAbs, 540, 'Legacy Whole Slot');
  assert.ok(legacy.ok);
  assert.equal(bookSlot(state, dayAbs, 540, 'Still Taken').ok, false, 'legacy exact-slot calls remain exclusive');
});

test('online generation is deterministic, unique, rich, and capacity safe', () => {
  const a = newGame('relaxed', 3103);
  const b = newGame('relaxed', 3103);
  const dayAbs = today(a) + 2;
  const options = { dayAbs, count: 48, minGroupSize: 1, maxGroupSize: 4, noShowChance: 0.15 };
  const first = generateOnlineReservations(a, options);
  const second = generateOnlineReservations(b, options);

  const projection = (result) => result.created.map((r) => ({
    id: r.id,
    customerId: r.customerId,
    fullName: r.fullName,
    groupSize: r.groupSize,
    minute: r.minute,
    holes: r.holes,
    transport: r.transport,
    paymentPreference: r.paymentPreference,
    plannedArrival: r.plannedArrival,
    willNoShow: r.willNoShow,
  }));
  assert.deepEqual(projection(first), projection(second), 'the same simulation seed produces the same schedule');
  assert.ok(first.created.length > 0);
  assert.equal(new Set(first.created.map((r) => r.fullName)).size, first.created.length, 'online customer names are unique');
  assert.equal(new Set(first.created.map((r) => r.customerId)).size, first.created.length, 'customer IDs are unique');

  for (const reservation of first.created) {
    assert.equal(reservation.source, 'online');
    assert.ok(reservation.groupSize >= 1 && reservation.groupSize <= 4);
    assert.ok([9, 18].includes(reservation.holes));
    assert.ok(['walking', 'cart'].includes(reservation.transport));
    assert.ok(['cash', 'card'].includes(reservation.paymentPreference));
    assert.equal(reservation.balanceDue, reservation.fee - reservation.deposit);
  }
  for (let minute = TEE_SHEET.openMin; minute < TEE_SHEET.closeMin; minute += TEE_SHEET.stepMin) {
    const load = slotLoad(a, dayAbs, minute);
    assert.ok(load.bookedPlayers <= load.capacity, `${minute} stays within course capacity`);
  }
});

test('arrival planning centers near fifteen minutes early and responds to travel, personality, weather, and parking', () => {
  const reservation = { id: 4, dayAbs: 12, minute: 600, punctuality: 0.5, arrivalPersonality: 'punctual' };
  const early = planReservationArrival(reservation, {
    rng: makeRng(99),
    travelVariationMin: -4,
    weatherDelayMin: 0,
    parkingDelayMin: 0,
    punctuality: 0.9,
    personality: 'early',
  });
  const delayed = planReservationArrival(reservation, {
    rng: makeRng(99),
    travelVariationMin: 5,
    weatherSeverity: 1,
    parkingAvailability: 0,
    punctuality: 0.2,
    personality: 'rushed',
  });
  const teeTimeAbs = reservation.dayAbs * 1440 + reservation.minute;
  assert.ok(early.plannedArrival < teeTimeAbs - 15);
  assert.ok(delayed.plannedArrival > early.plannedArrival);
  assert.ok(delayed.plannedArrival <= teeTimeAbs + 10, 'extreme delays stay bounded');
  assert.ok(early.arrivalWindow.start < early.arrivalWindow.end);
});

test('arrival windows stagger customers and persisted transitions are idempotent', () => {
  const state = newGame('relaxed', 3104);
  const dayAbs = today(state) + 1;
  const first = bookReservation(state, {
    dayAbs, minute: 480, name: 'First Arrival', partySize: 1,
    plannedArrival: dayAbs * 1440 + 462,
    arrivalWindow: { start: dayAbs * 1440 + 460, end: dayAbs * 1440 + 464 },
  }).res;
  const second = bookReservation(state, {
    dayAbs, minute: 510, name: 'Second Arrival', partySize: 1,
    plannedArrival: dayAbs * 1440 + 495,
    arrivalWindow: { start: dayAbs * 1440 + 493, end: dayAbs * 1440 + 497 },
  }).res;

  const reached = dueForArrivals(state, { at: first.arrivalWindow.start });
  assert.deepEqual(reached.map((r) => r.id), [first.id], 'only the reached arrival window is released');
  assert.equal(markReservationEnRoute(state, second.id, second.arrivalWindow.start - 1).ok, false,
    'a customer cannot begin driving before their window');
  assert.ok(markReservationEnRoute(state, first.id, first.arrivalWindow.start).ok);
  assert.ok(markReservationArrived(state, first.id, first.plannedArrival).ok);
  const again = markReservationArrived(state, first.id, first.plannedArrival + 1);
  assert.equal(again.already, true);
  assert.equal(first.arrivedAt, first.plannedArrival, 'duplicate arrival cannot replace the persisted timestamp');
  assert.equal(second.arrivalStatus, 'scheduled');

  const loaded = deserialize(serialize(state));
  const saved = loaded.reservations.booked.find((r) => r.id === first.id);
  assert.equal(saved.arrivalStatus, 'arrived');
  assert.equal(saved.arrivedAt, first.plannedArrival);
  assert.equal(saved.currentDestination, 'front-desk');
});

test('overdue reservations become no-shows and the policy fee can bank only once', () => {
  const state = newGame('relaxed', 3105);
  const dayAbs = today(state) + 1;
  const reservation = bookReservation(state, {
    dayAbs,
    minute: 480,
    name: 'No Show Golfer',
    partySize: 2,
    noShowFee: 17.5,
  }).res;
  const deadline = reservation.teeTimeAbs + reservationConfig(state).noShowGraceMin;
  const processed = processReservationTimeline(state, { at: deadline + 1 });
  assert.deepEqual(processed.noShows.map((r) => r.id), [reservation.id]);
  assert.equal(reservation.status, 'noShow');
  assert.equal(reservation.noShowFeeStatus, 'pending');

  const cashBefore = state.cash;
  const revenueBefore = state.ledger.today.revenue.greenFees;
  const first = chargeNoShowFee(state, reservation.id, { at: deadline + 2 });
  const second = chargeNoShowFee(state, reservation.id, { at: deadline + 3 });
  assert.ok(first.ok);
  assert.equal(second.already, true);
  assert.equal(state.cash, cashBefore + 17.5);
  assert.equal(state.ledger.today.revenue.greenFees, revenueBefore + 17.5);
  assert.equal(reservation.noShowFeeChargeKey, `reservation:${reservation.id}:no-show-fee`);
  assert.equal(processReservationTimeline(state, { at: deadline + 50 }).noShows.length, 0, 'timeline replay is exact-once');

  const loaded = deserialize(serialize(state));
  const saved = loaded.reservations.booked.find((r) => r.id === reservation.id);
  assert.equal(saved.noShowFeeStatus, 'charged');
  assert.equal(saved.noShowFeeChargeKey, reservation.noShowFeeChargeKey);
});

test('a reservation deposit banks one durable ticket and replay after save/load cannot duplicate it', () => {
  const state = newGame('relaxed', 3110);
  const dayAbs = today(state) + 1;
  const cashBefore = state.cash;
  const revenueBefore = state.ledger.today.revenue.greenFees;
  const made = bookReservation(state, {
    dayAbs,
    minute: 540,
    name: 'Deposit Accounting',
    partySize: 1,
    totalFee: 100,
    deposit: 25,
  });
  assert.ok(made.ok);
  const reservation = made.res;
  assert.equal(state.cash, cashBefore + 25);
  assert.equal(state.ledger.today.revenue.greenFees, revenueBefore + 25);
  assert.equal(reservation.depositPaid, 25);
  assert.equal(reservation.balanceDue, 75);
  assert.equal(reservation.depositStatus, 'paid');
  assert.equal(reservation.depositReferenceId, reservationDepositReference(reservation.id));
  assert.equal(state.shop.transactionHistory.length, 1);
  assert.equal(state.shop.transactionHistory[0].type, RESERVATION_DEPOSIT_TYPE);
  assert.equal(state.shop.transactionHistory[0].referenceId, reservation.depositReferenceId);
  assert.equal(state.shop.transactionHistory[0].total, 25);
  assert.equal(state.shop.transactionHistory[0].details.totalFee, 100);
  assert.equal(state.shop.transactionHistory[0].minute, reservation.depositPaidAt);

  const replay = bankReservationDeposit(state, reservation.id);
  assert.equal(replay.already, true);
  assert.equal(state.cash, cashBefore + 25);
  assert.equal(state.shop.transactionHistory.length, 1);

  const loaded = deserialize(serialize(state));
  const saved = loaded.reservations.booked.find((r) => r.id === reservation.id);
  const loadedCash = loaded.cash;
  const loadedRevenue = loaded.ledger.today.revenue.greenFees;
  const afterReload = bankReservationDeposit(loaded, saved.id);
  assert.equal(afterReload.already, true);
  assert.equal(loaded.cash, loadedCash);
  assert.equal(loaded.ledger.today.revenue.greenFees, loadedRevenue);
  assert.equal(loaded.shop.transactionHistory.length, 1);
  assert.equal(saved.depositTransactionNumber, loaded.shop.transactionHistory[0].number);

  const checkIn = checkInReservation(loaded, saved.id);
  assert.ok(checkIn.ok);
  assert.equal(checkIn.fee, 75, 'only the outstanding balance banks at legacy check-in');
  assert.equal(loaded.cash, cashBefore + 100);
  assert.equal(loaded.ledger.today.revenue.greenFees, revenueBefore + 100);
});

test('minute-zero generated deposits defer into the new ledger window and then bank once', () => {
  const state = newGame('relaxed', 3113);
  configureTeeSheet(state, { autoBookings: false }); // exact-once deposit accounting
  state.clock.minutes = 1440;
  const cashBefore = state.cash;
  const revenueBefore = state.ledger.today.revenue.greenFees;
  const reservation = bookReservation(state, {
    dayAbs: 2,
    minute: 540,
    name: 'Rollover Deposit',
    partySize: 1,
    totalFee: 80,
    deposit: 20,
  }).res;
  assert.equal(reservation.depositStatus, 'pending');
  assert.equal(state.cash, cashBefore);
  assert.equal(state.shop.transactionHistory.length, 0);

  const loaded = deserialize(serialize(state));
  const processed = processReservationTimeline(loaded, { at: 1441 });
  const saved = loaded.reservations.booked.find((r) => r.id === reservation.id);
  assert.deepEqual(processed.deposits.map((r) => r.id), [reservation.id]);
  assert.equal(saved.depositStatus, 'paid');
  assert.equal(saved.depositPaid, 20);
  assert.equal(loaded.cash, cashBefore + 20);
  assert.equal(loaded.ledger.today.revenue.greenFees, revenueBefore + 20);
  assert.equal(loaded.shop.transactionHistory.length, 1);
  assert.equal(processReservationTimeline(loaded, { at: 1442 }).deposits.length, 0);
  assert.equal(loaded.cash, cashBefore + 20);
});

test('no-show accounting credits a retained deposit and tickets only the additional fee once', () => {
  const state = newGame('relaxed', 3111);
  const dayAbs = today(state) + 1;
  const cashBefore = state.cash;
  const made = bookReservation(state, {
    dayAbs,
    minute: 570,
    name: 'Partial No Show',
    partySize: 1,
    totalFee: 100,
    deposit: 20,
    noShowFee: 35,
  });
  assert.ok(made.ok);
  const reservation = made.res;
  assert.equal(state.cash, cashBefore + 20, 'deposit is banked at booking');
  assert.ok(markReservationNoShow(state, reservation.id, { at: reservation.teeTimeAbs + 30 }).ok);

  const charged = chargeNoShowFee(state, reservation.id, { at: reservation.teeTimeAbs + 31 });
  assert.ok(charged.ok);
  assert.equal(charged.grossFee, 35);
  assert.equal(charged.depositCredit, 20);
  assert.equal(charged.amount, 15);
  assert.equal(state.cash, cashBefore + 35, 'deposit plus additional fee equals the policy fee, not a double charge');
  assert.equal(reservation.noShowFeeStatus, 'charged');
  assert.equal(reservation.noShowFeeReferenceId, reservationNoShowFeeReference(reservation.id));
  const ticket = state.shop.transactionHistory.find((entry) => entry.type === RESERVATION_NO_SHOW_FEE_TYPE);
  assert.ok(ticket);
  assert.equal(ticket.total, 15);
  assert.equal(ticket.details.grossFee, 35);
  assert.equal(ticket.details.depositCredit, 20);
  assert.equal(ticket.minute, reservation.teeTimeAbs + 31);
  assert.equal(reservation.noShowFeeChargedAt, reservation.teeTimeAbs + 31);

  const loaded = deserialize(serialize(state));
  const saved = loaded.reservations.booked.find((r) => r.id === reservation.id);
  const loadedCash = loaded.cash;
  const loadedHistory = loaded.shop.transactionHistory.length;
  const replay = chargeNoShowFee(loaded, saved.id);
  assert.equal(replay.already, true);
  assert.equal(loaded.cash, loadedCash);
  assert.equal(loaded.shop.transactionHistory.length, loadedHistory);
  assert.equal(saved.noShowFeeTransactionNumber, ticket.number);
});

test('a deposit that fully covers the no-show policy writes zero-dollar provenance without new revenue', () => {
  const state = newGame('relaxed', 3112);
  const dayAbs = today(state) + 1;
  const cashBefore = state.cash;
  const reservation = bookReservation(state, {
    dayAbs,
    minute: 600,
    name: 'Covered No Show',
    partySize: 1,
    totalFee: 100,
    deposit: 25,
    noShowFee: 25,
  }).res;
  assert.equal(state.cash, cashBefore + 25);
  markReservationNoShow(state, reservation.id, { at: reservation.teeTimeAbs + 30 });
  const charged = chargeNoShowFee(state, reservation.id, { at: reservation.teeTimeAbs + 31 });
  assert.ok(charged.ok);
  assert.equal(charged.amount, 0);
  assert.equal(charged.depositCredit, 25);
  assert.equal(state.cash, cashBefore + 25);
  assert.equal(reservation.noShowFeeStatus, 'covered-by-deposit');
  const ticket = state.shop.transactionHistory.find((entry) => entry.type === RESERVATION_NO_SHOW_FEE_TYPE);
  assert.ok(ticket, 'the policy outcome still has durable provenance');
  assert.equal(ticket.total, 0);
});

test('walk-in helpers expose viable manual choices and reserve only the selected capacity', () => {
  const state = newGame('relaxed', 3106);
  const cal = calendarOf(state.clock.minutes);
  state.clock.minutes = cal.dayAbs * 1440 + 480;
  const dayAbs = calendarOf(state.clock.minutes).dayAbs;
  configureReservations(state, { slotCapacity: 4, maxGroupSize: 4 });

  const choices = walkInAvailability(state, { dayAbs, partySize: 2 });
  assert.ok(choices.length > 0);
  assert.ok(choices.every((choice) => choice.minute >= 480));
  const minute = choices[0].minute;
  assert.equal(selectWalkInSlot(state, { dayAbs, minute: 450, name: 'Too Late', partySize: 1 }).ok, false,
    'manual selection rejects a past slot');
  const chosen = selectWalkInSlot(state, {
    dayAbs,
    minute,
    name: 'Walk In Pair',
    partySize: 2,
    paymentPreference: 'cash',
  });
  assert.ok(chosen.ok);
  assert.equal(chosen.res.customerType, 'walk-in');
  assert.equal(chosen.res.arrivalStatus, 'arrived');
  assert.equal(chosen.res.currentDestination, 'front-desk');
  assert.equal(slotLoad(state, dayAbs, minute).remainingCapacity, 2);

  assert.ok(selectWalkInSlot(state, { dayAbs, minute, name: 'Second Pair', partySize: 2 }).ok);
  assert.equal(selectWalkInSlot(state, { dayAbs, minute, name: 'Overflow Walk In', partySize: 1 }).ok, false);
});
