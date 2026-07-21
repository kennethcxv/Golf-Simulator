import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import {
  bookReservation, configureReservations, slotLoad,
} from '../src/sim/reservations.js';
import { customerIdentityById } from '../src/sim/customerIdentity.js';
import {
  bookLaptopReservation, laptopReservationSheet,
} from '../src/ui/laptop.js';

const tomorrow = (state) => calendarOf(state.clock.minutes).dayAbs + 1;

test('laptop sheet shows every capacity-sharing reservation and directory-owned full name', () => {
  const state = newGame('relaxed', 8101);
  const dayAbs = tomorrow(state);
  configureReservations(state, { slotCapacity: 4, maxGroupSize: 4 });
  const first = bookReservation(state, {
    dayAbs,
    minute: 480,
    name: 'Mara Vale',
    partySize: 2,
    totalFee: 80,
    deposit: 20,
  }).res;
  const second = bookReservation(state, {
    dayAbs,
    minute: 480,
    name: 'Theo Nash',
    partySize: 1,
    totalFee: 50,
    deposit: 0,
  }).res;

  const model = laptopReservationSheet(state, dayAbs);
  const slot = model.slots.find((entry) => entry.minute === 480);
  assert.equal(slot.reservations.length, 2, 'neither capacity-sharing reservation is hidden');
  assert.deepEqual(slot.reservations.map((entry) => entry.reservation.id), [first.id, second.id]);
  assert.equal(slot.bookedPlayers, 3);
  assert.equal(slot.remainingCapacity, 1);
  assert.equal(model.bookedPlayers, 3);
  assert.equal(model.openPlayerCapacity, model.totalPlayerCapacity - 3);
  assert.equal(model.expectedRevenue, 110, 'deposit is excluded from the outstanding expected balance');
  for (const entry of slot.reservations) {
    const authority = customerIdentityById(state, entry.reservation.customerId);
    assert.ok(authority);
    assert.equal(entry.fullName, authority.fullName);
    assert.equal(entry.reservation.fullName, authority.fullName);
  }
});

test('laptop can book exactly the remaining players with a generated believable identity', () => {
  const state = newGame('relaxed', 8102);
  const dayAbs = tomorrow(state);
  configureReservations(state, { slotCapacity: 4, maxGroupSize: 4 });
  assert.ok(bookReservation(state, {
    dayAbs, minute: 510, name: 'Existing Pair', partySize: 2,
  }).ok);

  const result = bookLaptopReservation(state, { dayAbs, minute: 510, partySize: 2 });
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.res.fullName, /^Guest\s+\d+$/i);
  assert.match(result.res.fullName, /^\S+\s+\S+/i, 'generated guests have a full first and last name');
  assert.equal(customerIdentityById(state, result.res.customerId)?.fullName, result.res.fullName);
  assert.equal(slotLoad(state, dayAbs, 510).remainingCapacity, 0);

  const directorySize = state.customerDirectory.customers.length;
  const overflow = bookLaptopReservation(state, { dayAbs, minute: 510, partySize: 1 });
  assert.equal(overflow.ok, false);
  assert.match(overflow.reason, /full/i);
  assert.equal(state.customerDirectory.customers.length, directorySize,
    'a refused booking does not manufacture an orphan customer');
});

test('laptop cart bookings quote the fleet and preserve one honest combined fee', () => {
  const state = newGame('relaxed', 8112);
  const dayAbs = tomorrow(state);
  const result = bookLaptopReservation(state, {
    dayAbs, minute: 570, partySize: 4, holes: 9, transport: 'cart',
  });
  assert.equal(result.ok, true);
  assert.equal(result.res.transport, 'cart');
  assert.equal(result.res.holes, 9);
  assert.equal(result.res.cartsRequested, 2);
  assert.equal(result.res.greenFeeSubtotal, state.club.greenFee * 4);
  assert.equal(result.res.cartRentalFee, 36);
  assert.equal(result.res.fee, state.club.greenFee * 4 + 36);
  assert.equal(laptopReservationSheet(state, dayAbs).expectedRevenue, result.res.fee);
});

test('selecting a returning directory customer preserves the same identity', () => {
  const state = newGame('relaxed', 8103);
  const dayAbs = tomorrow(state);
  configureReservations(state, { slotCapacity: 4, maxGroupSize: 4 });
  const first = bookLaptopReservation(state, { dayAbs, minute: 540, partySize: 1 });
  assert.equal(first.ok, true);
  const directorySize = state.customerDirectory.customers.length;

  const returnVisit = bookLaptopReservation(state, {
    dayAbs,
    minute: 570,
    partySize: 1,
    customerId: first.res.customerId,
  });
  assert.equal(returnVisit.ok, true);
  assert.equal(returnVisit.res.customerId, first.res.customerId);
  assert.equal(returnVisit.res.fullName, first.res.fullName);
  assert.equal(state.customerDirectory.customers.length, directorySize);
});

test('laptop reservation projection survives save/load without changing totals or names', () => {
  const state = newGame('relaxed', 8104);
  const dayAbs = tomorrow(state);
  configureReservations(state, { slotCapacity: 4, maxGroupSize: 4 });
  assert.ok(bookLaptopReservation(state, { dayAbs, minute: 600, partySize: 2 }).ok);
  assert.ok(bookLaptopReservation(state, { dayAbs, minute: 600, partySize: 1 }).ok);
  const before = laptopReservationSheet(state, dayAbs);
  const loaded = deserialize(serialize(state));
  const after = laptopReservationSheet(loaded, dayAbs);

  const projection = (model) => ({
    bookedPlayers: model.bookedPlayers,
    openPlayerCapacity: model.openPlayerCapacity,
    expectedRevenue: model.expectedRevenue,
    slots: model.slots.map((slot) => ({
      minute: slot.minute,
      bookedPlayers: slot.bookedPlayers,
      remainingCapacity: slot.remainingCapacity,
      names: slot.reservations.map((entry) => entry.fullName),
      ids: slot.reservations.map((entry) => entry.reservation.customerId),
    })),
  });
  assert.deepEqual(projection(after), projection(before));
});
