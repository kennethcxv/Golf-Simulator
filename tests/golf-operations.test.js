import { test } from 'node:test';
import assert from 'node:assert/strict';

import { totals } from '../src/sim/economy.js';
import { setGreenFee, teePricingResponse } from '../src/sim/pricing.js';
import { SAVE_VERSION, newGame, serialize, deserialize } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import {
  addGuestToReservation,
  availableSlots,
  beginReservationPayment,
  bookSlot,
  cancelReservation,
  cancelReservationPayment,
  checkInReservation,
  completeReservationPayment,
  configureOperationsPolicy,
  configureTeeSheet,
  confirmReservation,
  createWalkInBooking,
  daySheet,
  dueForCheckIn,
  ensureReservationHorizon,
  generateReservations,
  golfOperationsTick,
  handleNoShow,
  markCourseDeparture,
  markReservationArrived,
  moveReservation,
  operationEventsSince,
  operationFinanceSummary,
  operationsPolicySummary,
  operationsSummary,
  reservationById,
  resetGolfOperationsQA,
  retryReservationCard,
  seedGolfOperationsQA,
  setCourseClosure,
  slotTimes,
} from '../src/sim/reservations.js';

const today = (state) => calendarOf(state.clock.minutes).dayAbs;
const at = (dayAbs, minute) => dayAbs * 1440 + minute;
const setTime = (state, dayAbs, minute) => { state.clock.minutes = at(dayAbs, minute); };

function pay(state, reservation, method = 'card', options = {}) {
  const started = beginReservationPayment(state, reservation.id, method, options);
  assert.ok(started.ok, started.reason);
  const completed = completeReservationPayment(state, reservation.id, {
    transactionId: started.transactionId,
    tendered: options.tendered ?? started.amount,
    cardApproved: options.cardApproved,
  });
  return { started, completed };
}

test('schedule configuration drives real dated slots rather than a hardcoded UI day', () => {
  const state = newGame('relaxed', 901);
  const configured = configureTeeSheet(state, {
    openingTime: 8 * 60,
    closingTime: 10 * 60,
    slotInterval: 15,
    maximumPartySize: 4,
    slotCapacity: 4,
    bookingWindow: 14,
    gracePeriod: 12,
  });
  assert.ok(configured.ok);
  assert.deepEqual(slotTimes(state), [480, 495, 510, 525, 540, 555, 570, 585]);
  const day = daySheet(state, today(state) + 3);
  assert.equal(day.length, 8);
  assert.ok(day.every((slot) => slot.dayAbs === today(state) + 3));
  assert.ok(day.every((slot) => /^Y1-/.test(slot.dateKey)));
  assert.ok(day.every((slot) => slot.capacity === 4 && slot.availableSeats === 4));
  assert.equal(state.reservations.config.horizonDays, 14);
  assert.equal(state.reservations.config.gracePeriodMin, 12);
});

test('configuration refuses to orphan existing bookings or shrink below reserved capacity', () => {
  const state = newGame('relaxed', 902);
  const day = today(state) + 1;
  bookSlot(state, day, 480, { holder: 'Capacity Holder', partySize: 4 });
  assert.equal(configureTeeSheet(state, { openingTime: 9 * 60 }).ok, false);
  assert.equal(configureTeeSheet(state, { slotCapacity: 3, maximumPartySize: 3 }).ok, false);
  assert.equal(state.reservations.config.openMin, 420);
  assert.equal(state.reservations.config.slotCapacity, 4);
});

test('capacity permits real pairings but rejects impossible overlap', () => {
  const state = newGame('relaxed', 903);
  const day = today(state) + 1;
  assert.ok(bookSlot(state, day, 480, {
    holder: 'Pairing One', customerNames: ['Pairing One', 'Guest One'], partySize: 2,
  }).ok);
  assert.ok(bookSlot(state, day, 480, {
    holder: 'Pairing Two', customerNames: ['Pairing Two', 'Guest Two'], partySize: 2,
  }).ok);
  const full = daySheet(state, day).find((slot) => slot.minute === 480);
  assert.equal(full.reservations.length, 2);
  assert.equal(full.reservedSeats, 4);
  assert.equal(full.availableSeats, 0);
  assert.equal(bookSlot(state, day, 480, 'One Too Many').ok, false);
});

test('booking validates hours, booking window, course closure, and party size', () => {
  const state = newGame('relaxed', 904);
  const day = today(state) + 1;
  assert.equal(bookSlot(state, day, 473, 'Not A Slot').ok, false);
  assert.equal(bookSlot(state, day, 480, { holder: 'Too Large', partySize: 5 }).ok, false);
  assert.equal(bookSlot(state, today(state) - 1, 480, 'Past').ok, false);
  assert.equal(bookSlot(state, today(state) + state.reservations.config.horizonDays, 480, 'Outside Window').ok, false);
  assert.equal(bookSlot(state, today(state) + 9, 480, 'Too Far').ok, false);
  setCourseClosure(state, day, true, 'Aeration closure');
  const closed = bookSlot(state, day, 480, 'Closed Course');
  assert.equal(closed.ok, false);
  assert.match(closed.reason, /Aeration/);
  setCourseClosure(state, day, false);
  assert.ok(bookSlot(state, day, 480, 'Open Again').ok);
  setTime(state, today(state), 600);
  assert.match(bookSlot(state, today(state), 480, 'Too Late').reason, /already passed/);
});

test('generated reservations are seeded, believable, staggered, and name-unique', () => {
  const a = newGame('relaxed', 905);
  const b = newGame('relaxed', 905);
  const day = today(a) + 1;
  const ga = generateReservations(a, day, { seed: 445566, occupancy: 0.9 });
  const gb = generateReservations(b, day, { seed: 445566, occupancy: 0.9 });
  const shape = (entry) => entry.created.map((reservation) => ({
    minute: reservation.minute,
    customerNames: reservation.customerNames,
    partySize: reservation.partySize,
    membershipStatus: reservation.membershipStatus,
    paymentStatus: reservation.payment.status,
    plannedArrival: reservation.arrival.plannedMinute,
    intendedOutcome: reservation.arrival.intendedOutcome,
    plannedCancellation: reservation.cancellation.plannedAtMinute,
  }));
  assert.deepEqual(shape(ga), shape(gb));
  const names = ga.created.flatMap((reservation) => reservation.customerNames);
  assert.equal(new Set(names).size, names.length, 'generated people are unique across the day');
  assert.ok(ga.created.some((reservation) => reservation.arrival.plannedMinute < at(day, reservation.minute)));
  assert.ok(ga.created.some((reservation) => reservation.arrival.plannedMinute >= at(day, reservation.minute)));
  for (const slot of daySheet(a, day)) assert.ok(slot.reservedSeats <= slot.capacity);
});

test('generated tee-sheet demand rejects an extreme green-fee revenue shortcut', () => {
  const fair = newGame('relaxed', 90501);
  const extreme = newGame('relaxed', 90501);
  setGreenFee(fair, teePricingResponse(fair).fairValue);
  setGreenFee(extreme, 150);

  const fairResult = ensureReservationHorizon(fair, { seed: 66001 });
  const extremeResult = ensureReservationHorizon(extreme, { seed: 66001 });
  const bookingRevenue = (state) => state.ledger.entries
    .filter((entry) => ['bookingRevenue', 'bookingDeposits'].includes(entry.category))
    .reduce((sum, entry) => sum + entry.amount, 0);

  assert.ok(extremeResult.created.length < fairResult.created.length,
    `extreme fee generated ${extremeResult.created.length} bookings versus fair ${fairResult.created.length}`);
  assert.ok(bookingRevenue(extreme) < bookingRevenue(fair),
    `extreme fee generated $${bookingRevenue(extreme)} online cash versus fair $${bookingRevenue(fair)}`);
});

test('the production booking horizon fills deterministically, rolls forward, and is idempotent', () => {
  const a = newGame('relaxed', 9051);
  const b = newGame('relaxed', 9051);
  const day = today(a);
  const firstA = ensureReservationHorizon(a, { todayAbs: day, seed: 7766 });
  const firstB = ensureReservationHorizon(b, { todayAbs: day, seed: 7766 });
  assert.equal(firstA.generatedDays, a.reservations.config.horizonDays);
  assert.equal(firstB.generatedDays, b.reservations.config.horizonDays);
  assert.deepEqual(
    a.reservations.booked.map((reservation) => [reservation.dayAbs, reservation.minute, reservation.customerNames, reservation.payment.status]),
    b.reservations.booked.map((reservation) => [reservation.dayAbs, reservation.minute, reservation.customerNames, reservation.payment.status]),
  );
  for (let offset = 0; offset < a.reservations.config.horizonDays; offset++) {
    const names = a.reservations.booked
      .filter((reservation) => reservation.dayAbs === day + offset && reservation.status !== 'cancelled')
      .flatMap((reservation) => reservation.customerNames);
    assert.equal(new Set(names).size, names.length, `day ${offset} has no duplicate visible identity`);
  }
  const before = {
    reservations: a.reservations.booked.length,
    finance: a.reservations.financeEntries.length,
    cash: a.cash,
  };
  assert.equal(ensureReservationHorizon(a, { todayAbs: day, seed: 7766 }).created.length, 0);
  assert.deepEqual({
    reservations: a.reservations.booked.length,
    finance: a.reservations.financeEntries.length,
    cash: a.cash,
  }, before, 're-entering the club cannot replay bookings or payments');
  const rolled = ensureReservationHorizon(a, { todayAbs: day + 1, seed: 7766 });
  assert.equal(rolled.generatedDays, 1, 'only the newly visible edge day is generated');
  assert.ok(a.reservations.generator.generatedDays.includes(day + a.reservations.config.horizonDays));
});

test('generated reservation identities exist before autosave and snapshot without live drift', () => {
  const state = newGame('relaxed', 90511);
  ensureReservationHorizon(state, { occupancy: 0.9, seed: 77661 });
  const beforeDirectory = JSON.stringify(state.customerDirectory);

  assert.ok(state.reservations.booked.length > 0);
  assert.ok(state.reservations.booked.every((reservation) => (
    state.customerDirectory.customers.some((customer) => customer.customerId === reservation.customerId)
  )));
  serialize(state);
  assert.equal(JSON.stringify(state.customerDirectory), beforeDirectory,
    'serializing an established tee sheet must not allocate customer identities');
});

test('the deterministic browser fixture reset reverses production booking cash and ledger lines', () => {
  const state = newGame('relaxed', 9052);
  const cashBefore = state.cash;
  ensureReservationHorizon(state, { occupancy: 1, seed: 9911 });
  const paymentSequenceBeforeReset = state.reservations.nextPaymentSeq;
  assert.notEqual(state.cash, cashBefore);
  assert.ok(state.reservations.financeEntries.length > 0);
  const productionArrivalIds = state.shop.customerSimulation.scheduled
    .filter((arrival) => arrival.reservationId != null)
    .map((arrival) => arrival.id);
  assert.ok(productionArrivalIds.length > 0);
  resetGolfOperationsQA(state);
  assert.equal(state.cash, cashBefore);
  assert.deepEqual(totals(state.ledger.today), { revenue: 0, expense: 0, net: 0 });
  assert.equal(state.reservations.booked.length, 0);
  assert.equal(state.reservations.financeEntries.length, 0);
  assert.ok(state.shop.customerSimulation.scheduled
    .filter((arrival) => productionArrivalIds.includes(arrival.id))
    .every((arrival) => arrival.status === 'Cancelled'));
  assert.equal(state.reservations.nextPaymentSeq, paymentSequenceBeforeReset,
    'fixture reset cannot recycle an immutable-ledger payment identity');

  const first = bookSlot(state, today(state) + 1, 480, 'After Reset One').res;
  const firstPayment = pay(state, first, 'cash', { tendered: first.fee });
  assert.ok(firstPayment.completed.ok);
  assert.equal(state.cash, cashBefore + first.fee,
    'the first payment after a fixture reset reaches canonical cash exactly once');

  resetGolfOperationsQA(state);
  assert.equal(state.cash, cashBefore);
  const second = bookSlot(state, today(state) + 1, 480, 'After Reset Two').res;
  const secondPayment = pay(state, second, 'cash', { tendered: second.fee });
  assert.ok(secondPayment.completed.ok);
  assert.notEqual(secondPayment.started.transactionId, firstPayment.started.transactionId);
  assert.equal(state.cash, cashBefore + second.fee,
    'a repeated fixture reset cannot suppress a later payment as a duplicate');
});

test('arrival events distinguish due, early, on-time, late, and absent parties', () => {
  const state = newGame('relaxed', 906);
  const day = today(state);
  const early = bookSlot(state, day, 480, { holder: 'Early Party', arrivalOffsetMin: -15 }).res;
  const onTime = bookSlot(state, day, 510, { holder: 'On Time Party', arrivalOffsetMin: 0 }).res;
  const late = bookSlot(state, day, 540, { holder: 'Late Party', arrivalOffsetMin: 8 }).res;
  const absent = bookSlot(state, day, 570, { holder: 'Absent Party', intendedOutcome: 'no-show' }).res;

  golfOperationsTick(state, at(day, 465));
  assert.equal(early.arrival.status, 'arrived');
  golfOperationsTick(state, at(day, 510));
  assert.equal(onTime.arrival.status, 'arrived');
  golfOperationsTick(state, at(day, 540));
  assert.equal(late.arrival.status, 'scheduled', 'late flag does not fabricate physical arrival');
  assert.equal(dueForCheckIn(state).some((entry) => entry.id === late.id), false);
  golfOperationsTick(state, at(day, 548));
  assert.equal(late.arrival.status, 'late');
  assert.ok(dueForCheckIn(state).some((entry) => entry.id === late.id));
  golfOperationsTick(state, at(day, 580));
  assert.equal(absent.status, 'noShow');

  const types = operationEventsSince(state).map((event) => event.type);
  for (const expected of ['party-due', 'party-arrived', 'party-late', 'party-no-show']) {
    assert.ok(types.includes(expected), expected);
  }
});

test('front desk confirms identity, adds a guest only within capacity, and moves by policy', () => {
  const state = newGame('relaxed', 907);
  const day = today(state);
  const reservation = bookSlot(state, day, 480, {
    holder: 'Nadia Bell', customerNames: ['Nadia Bell', 'Rita Osei'], partySize: 2,
  }).res;
  markReservationArrived(state, reservation.id);
  assert.ok(confirmReservation(state, reservation.id).ok);
  assert.ok(addGuestToReservation(state, reservation.id, 'June Mercer').ok);
  assert.equal(reservation.partySize, 3);
  assert.equal(reservation.payment.total, reservation.feePerPlayer * 3);
  assert.equal(addGuestToReservation(state, reservation.id, 'June Mercer').ok, false);

  bookSlot(state, day, 510, { holder: 'Full Slot', partySize: 4 });
  assert.equal(moveReservation(state, reservation.id, day, 510).ok, false);
  const moved = moveReservation(state, reservation.id, day, 540);
  assert.ok(moved.ok);
  assert.equal(reservation.minute, 540);
  assert.equal(daySheet(state, day).find((slot) => slot.minute === 480).availableSeats, 4);
});

test('prepaid, deposit, cash, and card payments issue receipts exactly once', () => {
  const state = newGame('relaxed', 908);
  const day = today(state) + 1;
  const cashStart = state.cash;
  const prepaid = bookSlot(state, day, 480, {
    holder: 'Prepaid Player', partySize: 2, paymentPlan: 'prepaid', paymentMethod: 'card', cardOnFile: true,
  }).res;
  assert.equal(prepaid.payment.status, 'paid');
  assert.equal(prepaid.payment.receipts.length, 1);

  const deposit = bookSlot(state, day, 510, {
    holder: 'Deposit Player', depositAmount: 20, paymentMethod: 'cash', partySize: 2,
  }).res;
  assert.equal(deposit.payment.status, 'deposit');
  assert.equal(deposit.payment.depositPaid, 20);
  const short = beginReservationPayment(state, deposit.id, 'cash');
  assert.equal(completeReservationPayment(state, deposit.id, {
    transactionId: short.transactionId,
    tendered: short.amount - 1,
  }).ok, false);
  const completed = completeReservationPayment(state, deposit.id, {
    transactionId: short.transactionId,
    tendered: short.amount + 10,
  });
  assert.ok(completed.ok);
  assert.equal(completed.change, 10);
  assert.equal(deposit.payment.status, 'paid');
  const replay = completeReservationPayment(state, deposit.id, { transactionId: short.transactionId, tendered: 999 });
  assert.ok(replay.ok && replay.idempotent);

  const card = bookSlot(state, day, 540, { holder: 'Card Player' }).res;
  const attempt = beginReservationPayment(state, card.id, 'card');
  assert.equal(completeReservationPayment(state, card.id, {
    transactionId: attempt.transactionId, cardApproved: false,
  }).declined, true);
  assert.ok(retryReservationCard(state, card.id, attempt.transactionId).ok);
  assert.ok(completeReservationPayment(state, card.id, { transactionId: attempt.transactionId }).ok);
  assert.equal(card.payment.receipts.length, 1);
  assert.equal(beginReservationPayment(state, 999999, 'card').ok, false, 'payment without a booking is rejected');

  const finance = operationFinanceSummary(state);
  assert.ok(finance.stableIdsUnique);
  assert.equal(state.cash - cashStart, finance.netCash);
});

test('pending payment survives reload and cannot replay across repeated reloads', () => {
  const state = newGame('relaxed', 909);
  const reservation = bookSlot(state, today(state), 480, { holder: 'Reload Payment' }).res;
  const started = beginReservationPayment(state, reservation.id, 'card');
  const cashBefore = state.cash;
  const during = deserialize(serialize(state));
  assert.equal(reservationById(during, reservation.id).payment.pending.transactionId, started.transactionId);
  const once = completeReservationPayment(during, reservation.id, { transactionId: started.transactionId });
  assert.ok(once.ok);
  const after = deserialize(serialize(during));
  const twice = completeReservationPayment(after, reservation.id, { transactionId: started.transactionId });
  assert.ok(twice.ok && twice.idempotent);
  assert.equal(after.cash, cashBefore + reservation.payment.total);
  assert.equal(operationFinanceSummary(after).entries.filter((entry) => entry.transactionId === started.transactionId).length, 1);
});

test('cancelled or abandoned front-desk payment moves no money', () => {
  const state = newGame('relaxed', 910);
  const reservation = bookSlot(state, today(state), 480, { holder: 'Abandoned Payment' }).res;
  const before = state.cash;
  const started = beginReservationPayment(state, reservation.id, 'cash');
  assert.ok(cancelReservationPayment(state, reservation.id, started.transactionId).ok);
  assert.equal(state.cash, before);
  assert.equal(operationFinanceSummary(state).entries.length, 0);
});

test('check-in refuses missing arrival, confirmation, and payment, then grants the whole party access', () => {
  const state = newGame('relaxed', 911);
  const day = today(state);
  const reservation = bookSlot(state, day, 480, {
    holder: 'Course Party', customerNames: ['Course Party', 'Guest Alpha', 'Guest Beta'], partySize: 3,
  }).res;
  assert.match(checkInReservation(state, reservation.id).reason, /arrived/);
  markReservationArrived(state, reservation.id);
  assert.match(checkInReservation(state, reservation.id).reason, /Confirm/);
  confirmReservation(state, reservation.id);
  assert.match(checkInReservation(state, reservation.id).reason, /due/);
  pay(state, reservation, 'card');
  const checked = checkInReservation(state, reservation.id);
  assert.ok(checked.ok);
  assert.ok(reservation.party.members.every((member) => member.checkedIn));
  assert.equal(reservation.courseAccess.status, 'granted');
  assert.equal(dueForCheckIn(state).length, 0, 'the front-desk queue clears');
  const departureAt = reservation.courseAccess.departurePlannedAtMinute;
  golfOperationsTick(state, departureAt);
  assert.equal(reservation.courseAccess.status, 'departed');
  assert.ok(reservation.actualStartMinute >= at(day, 480));
  assert.ok(operationEventsSince(state).some((event) => event.type === 'course-departure'));
  assert.ok(markCourseDeparture(state, reservation.id).idempotent);
});

test('walk-ins consume actual schedule availability and honor lead time and closure', () => {
  const state = newGame('relaxed', 912);
  const day = today(state);
  configureTeeSheet(state, { minWalkInLeadMin: 10 });
  setTime(state, day, 9 * 60 + 5);
  bookSlot(state, day, 570, { holder: 'Existing Foursome', partySize: 4 });
  const candidates = availableSlots(state, day, { partySize: 2, walkIn: true });
  assert.ok(candidates.every((slot) => slot.minute >= 555));
  assert.equal(candidates.some((slot) => slot.minute === 570), false);
  const walkIn = createWalkInBooking(state, {
    holder: 'Walk In Holder', customerNames: ['Walk In Holder', 'Walk In Guest'], partySize: 2,
  });
  assert.ok(walkIn.ok);
  assert.equal(walkIn.res.walkIn, true);
  assert.equal(walkIn.res.arrival.status, 'arrived');
  assert.equal(walkIn.slot.walkInAssignmentIds.includes(walkIn.res.id), true);
  setCourseClosure(state, day + 1, true, 'Storm');
  assert.equal(createWalkInBooking(state, { dayAbs: day + 1, holder: 'Storm Walk In' }).ok, false);
});

test('walk-in headcounts never invent unrelated named golfers', () => {
  const state = newGame('relaxed', 9191);
  const day = today(state);
  setTime(state, day, 8 * 60);
  const result = createWalkInBooking(state, {
    holder: 'Rowan Mercer',
    partySize: 3,
    minute: 510,
  });
  assert.ok(result.ok, result.reason);
  assert.deepEqual(result.res.customerNames, [
    'Rowan Mercer',
    'Guest 2 of Rowan Mercer',
    'Guest 3 of Rowan Mercer',
  ]);
  assert.equal(new Set(result.res.customerNames).size, 3);
});

test('no-show fee and slot reopening apply once according to readable policy', () => {
  const state = newGame('relaxed', 913);
  const day = today(state);
  configureOperationsPolicy(state, { noShowFee: 15, reopenNoShowSlot: true });
  const reservation = bookSlot(state, day, 480, {
    holder: 'No Show Deposit', intendedOutcome: 'no-show', depositAmount: 15,
    paymentMethod: 'card', cardOnFile: true, partySize: 4,
  }).res;
  const afterDeposit = state.cash;
  golfOperationsTick(state, at(day, 480 + state.reservations.config.gracePeriodMin));
  assert.equal(reservation.status, 'noShow');
  assert.equal(reservation.noShow.feeApplied, 15);
  assert.equal(state.cash, afterDeposit, 'retaining paid funds is not a second cash movement');
  assert.equal(daySheet(state, day).find((slot) => slot.minute === 480).availableSeats, 4);
  const count = operationFinanceSummary(state).entries.length;
  assert.ok(handleNoShow(state, reservation.id).idempotent);
  assert.equal(operationFinanceSummary(state).entries.length, count);
  assert.ok(operationsPolicySummary(state).join(' ').includes('authorized card'));
});

test('no-show state and fee remain exact once through repeated reload', () => {
  let state = newGame('relaxed', 914);
  const day = today(state);
  const reservation = bookSlot(state, day, 480, {
    holder: 'Reload No Show', intendedOutcome: 'no-show', depositAmount: 15,
    paymentMethod: 'card', cardOnFile: true,
  }).res;
  state = deserialize(serialize(state));
  golfOperationsTick(state, at(day, 500));
  const cash = state.cash;
  const ids = operationFinanceSummary(state).entries.map((entry) => entry.id);
  state = deserialize(serialize(state));
  golfOperationsTick(state, at(day + 1, 600));
  assert.equal(reservationById(state, reservation.id).status, 'noShow');
  assert.equal(state.cash, cash);
  assert.deepEqual(operationFinanceSummary(state).entries.map((entry) => entry.id), ids);
});

test('advance and same-day cancellation refund/retain correctly and never duplicate', () => {
  const advanceState = newGame('relaxed', 915);
  const day = today(advanceState) + 2;
  const start = advanceState.cash;
  const advance = bookSlot(advanceState, day, 480, {
    holder: 'Advance Cancel', paymentPlan: 'prepaid', paymentMethod: 'card', partySize: 2,
  }).res;
  assert.ok(cancelReservation(advanceState, advance.id, { atMinute: at(today(advanceState), 400) }).ok);
  assert.equal(advanceState.cash, start);
  assert.equal(advance.cancellation.refund, advance.payment.amountPaid);
  assert.equal(cancelReservation(advanceState, advance.id).ok, false);
  assert.ok(bookSlot(advanceState, day, 480, 'Replacement Party').ok, 'slot reopened');

  const sameDayState = newGame('relaxed', 916);
  const sameDay = today(sameDayState);
  configureOperationsPolicy(sameDayState, { sameDayCancellationFee: 12, retainDepositOnSameDay: false });
  const same = bookSlot(sameDayState, sameDay, 600, {
    holder: 'Same Day Cancel', paymentPlan: 'prepaid', paymentMethod: 'card', partySize: 2,
  }).res;
  const paid = same.payment.amountPaid;
  const result = cancelReservation(sameDayState, same.id, { atMinute: at(sameDay, 500) });
  assert.ok(result.ok);
  assert.equal(result.fee, 12);
  assert.equal(result.refund, paid - 12);
  assert.equal(operationFinanceSummary(sameDayState).entries.filter((entry) => entry.kind === 'refund').length, 1);
});

test('operations finance entries reconcile to cash and the club ledger', () => {
  const state = newGame('relaxed', 917);
  const startCash = state.cash;
  const day = today(state) + 1;
  const prepaid = bookSlot(state, day, 480, {
    holder: 'Finance Prepaid', paymentPlan: 'prepaid', paymentMethod: 'card', partySize: 2,
  }).res;
  const deposit = bookSlot(state, day, 510, {
    holder: 'Finance Deposit', depositAmount: 10, paymentMethod: 'cash', partySize: 2,
  }).res;
  pay(state, deposit, 'card');
  const walkIn = bookSlot(state, day, 540, { holder: 'Finance Walk In', walkIn: true }).res;
  pay(state, walkIn, 'cash', { tendered: walkIn.payment.amountDue + 20 });
  cancelReservation(state, prepaid.id, { atMinute: at(today(state), 400) });

  const finance = operationFinanceSummary(state);
  const books = totals(state.ledger.today);
  assert.ok(finance.stableIdsUnique);
  assert.equal(r2(state.cash - startCash), finance.netCash);
  assert.equal(r2(books.net), finance.netCash);
  assert.equal(operationFinanceSummary(state, today(state)).netCash, finance.netCash,
    'the dated subledger uses the same posting day as the main ledger');
  assert.ok(finance.categories.bookingDeposits > 0);
  assert.ok(finance.categories.bookingBalances > 0);
  assert.ok(finance.categories.walkInRevenue > 0);
  assert.ok(finance.categories.bookingRefunds > 0);
});

test('operations summary exposes next arrival, waiting, late, utilization, alerts, and revenue', () => {
  const state = newGame('relaxed', 918);
  const day = today(state);
  const next = bookSlot(state, day, 480, { holder: 'Next Arrival', arrivalOffsetMin: -10 }).res;
  const waiting = bookSlot(state, day, 510, { holder: 'Waiting Party', arrived: true, arrivalOffsetMin: -15 }).res;
  const late = bookSlot(state, day, 540, { holder: 'Late Alert', arrivalOffsetMin: 8 }).res;
  pay(state, waiting, 'card');
  golfOperationsTick(state, at(day, 540));
  const summary = operationsSummary(state, day);
  assert.equal(summary.nextArrival?.id, late.id);
  assert.ok(summary.waiting.some((entry) => entry.id === waiting.id));
  assert.ok(summary.late.some((entry) => entry.id === late.id));
  assert.ok(summary.utilization > 0 && summary.utilization < 1);
  assert.ok(summary.bookingRevenue > 0);
});

test('save/load preserves every operational stage and migrates old booking saves', () => {
  const state = newGame('relaxed', 919);
  const day = today(state);
  const beforeArrival = bookSlot(state, day, 480, {
    holder: 'Before Arrival', customerNames: ['Before Arrival', 'Party Member'], partySize: 2,
  }).res;
  const duringCheckIn = bookSlot(state, day, 510, { holder: 'During Check In', arrived: true }).res;
  confirmReservation(state, duringCheckIn.id);
  const duringPayment = bookSlot(state, day, 540, { holder: 'During Payment', arrived: true }).res;
  confirmReservation(state, duringPayment.id);
  beginReservationPayment(state, duringPayment.id, 'cash');
  const afterCheckIn = bookSlot(state, day, 570, {
    holder: 'After Check In', arrived: true, paymentPlan: 'prepaid', paymentMethod: 'card',
  }).res;
  confirmReservation(state, afterCheckIn.id);
  checkInReservation(state, afterCheckIn.id);

  const loaded = deserialize(serialize(state));
  assert.equal(reservationById(loaded, beforeArrival.id).arrival.status, 'scheduled');
  assert.equal(reservationById(loaded, duringCheckIn.id).checkIn.status, 'confirmed');
  assert.equal(reservationById(loaded, duringPayment.id).payment.pending.method, 'cash');
  assert.equal(reservationById(loaded, afterCheckIn.id).checkIn.status, 'checked-in');
  assert.deepEqual(reservationById(loaded, beforeArrival.id).customerNames, ['Before Arrival', 'Party Member']);

  const legacyRaw = JSON.parse(serialize(state));
  legacyRaw.version = 3;
  legacyRaw.reservations = { nextId: 2, booked: [{ id: 1, dayAbs: day + 1, minute: 480, name: 'Legacy Golfer', fee: 32, status: 'booked' }] };
  const migrated = deserialize(JSON.stringify(legacyRaw));
  const legacy = reservationById(migrated, 1);
  assert.equal(migrated.version, SAVE_VERSION);
  assert.equal(legacy.reservationHolder, 'Legacy Golfer');
  assert.equal(legacy.partySize, 1);
  assert.equal(legacy.payment.amountDue, 32);
  assert.equal(daySheet(migrated, day + 1).find((slot) => slot.minute === 480).res.id, 1);
});

test('deterministic accelerated QA day covers the requested operating-day branches', () => {
  const a = newGame('relaxed', 920);
  const b = newGame('relaxed', 920);
  const day = today(a) + 1;
  const qaA = seedGolfOperationsQA(a, { dayAbs: day, seed: 20260719 });
  const qaB = seedGolfOperationsQA(b, { dayAbs: day, seed: 20260719 });
  assert.deepEqual(qaA, qaB);
  assert.ok(qaA.ok);
  const reservations = a.reservations.booked.filter((entry) => entry.dayAbs === day);
  assert.ok(reservations.some((entry) => entry.payment.status === 'paid'));
  assert.ok(reservations.some((entry) => entry.payment.status === 'deposit'));
  assert.ok(reservations.some((entry) => entry.arrival.intendedOutcome === 'no-show'));
  assert.ok(reservations.some((entry) => entry.status === 'cancelled'));
  const full = daySheet(a, day).find((slot) => slot.minute === slotTimes(a)[5]);
  assert.equal(full.reservedSeats, full.capacity);
  assert.equal(full.reservations.length, 2);
  assert.ok(availableSlots(a, day, { partySize: 1 }).some((slot) => slot.minute === qaA.walkInMinute));
});

function r2(value) {
  return Math.round(value * 100) / 100;
}
