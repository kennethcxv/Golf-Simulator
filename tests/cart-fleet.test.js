import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import { bookReservation, checkInReservation } from '../src/sim/reservations.js';
import {
  CART_FLEET_SCHEMA,
  advanceCartFleet,
  cartReservationQuote,
  cartsRequiredForParty,
  ensureCartFleet,
  fleetCapacity,
  fleetDailyTick,
  fleetSummary,
  purchaseFleetCart,
  serviceFleetCart,
  upgradeFleetInfrastructure,
} from '../src/sim/cartFleet.js';
import {
  createReservationCheckInTx,
  finalizeReservationCheckIn,
  CART_RENTAL_SKU,
  GREEN_FEE_SKU,
} from '../src/sim/reservationCheckIn.js';
import {
  requestPayment, presentCard, insertCard, enterCardDigit, submitCardAmount, runCard, totalOf,
} from '../src/sim/register.js';

function tomorrow(state) {
  return calendarOf(state.clock.minutes).dayAbs + 1;
}

function reserveCart(state, {
  name = 'Cart Golfer', minute = 480, partySize = 2, holes = 9,
} = {}) {
  const result = bookReservation(state, {
    dayAbs: tomorrow(state), minute, name, partySize, holes, transport: 'cart',
  });
  assert.equal(result.ok, true, result.reason);
  return result.res;
}

function approveCard(state, reservation) {
  const made = createReservationCheckInTx(state, reservation.id, {
    method: 'card', rng: () => 0.9,
  });
  assert.equal(made.ok, true, made.reason);
  const { tx } = made;
  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  for (const digit of String(Math.round(totalOf(tx) * 100))) {
    assert.equal(enterCardDigit(tx, digit).ok, true);
  }
  assert.equal(submitCardAmount(tx).ok, true);
  assert.equal(runCard(tx).result, 'approved');
  return tx;
}

test('a property starts with a serviceable four-cart fleet and real infrastructure limits', () => {
  const state = newGame('relaxed', 8101);
  const fleet = state.cartFleet;
  const summary = fleetSummary(state);
  assert.equal(fleet.schema, CART_FLEET_SCHEMA);
  assert.equal(summary.carts, 4);
  assert.equal(summary.counts.available, 4);
  assert.deepEqual(summary.capacity, {
    parking: 4, overflow: 2, total: 6, chargers: 2, serviceBays: 1,
  });
  assert.equal(cartsRequiredForParty(1), 1);
  assert.equal(cartsRequiredForParty(2), 1);
  assert.equal(cartsRequiredForParty(4), 2);
  assert.equal(new Set(fleet.carts.map((cart) => cart.id)).size, 4);
});

test('future cart capacity is reserved across overlapping rounds and rejects overbooking honestly', () => {
  const state = newGame('relaxed', 8102);
  const dayAbs = tomorrow(state);
  const first = bookReservation(state, {
    dayAbs, minute: 480, name: 'First Foursome', partySize: 4, holes: 9, transport: 'cart',
  });
  const second = bookReservation(state, {
    dayAbs, minute: 510, name: 'Second Foursome', partySize: 4, holes: 9, transport: 'cart',
  });
  assert.ok(first.ok && second.ok);
  assert.equal(first.res.cartsRequested, 2);
  assert.equal(first.res.cartRentalFee, 36);
  const quote = cartReservationQuote(state, { dayAbs, minute: 540, partySize: 2, holes: 9 });
  assert.equal(quote.ok, false);
  assert.equal(quote.available, 0);
  const refused = bookReservation(state, {
    dayAbs, minute: 540, name: 'No Cart Left', partySize: 2, holes: 9, transport: 'cart',
  });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /rental carts? remain/i);
  assert.equal(state.reservations.booked.length, 2, 'a rejected request consumes no tee or fleet capacity');
});

test('physical check-in displays and banks green fee and cart rental as one balanced payment', () => {
  const state = newGame('relaxed', 8103);
  const reservation = reserveCart(state, { partySize: 2 });
  const cashBefore = state.cash;
  const tx = approveCard(state, reservation);
  assert.deepEqual(tx.items.map(({ skuId, price }) => ({ skuId, price })), [
    { skuId: GREEN_FEE_SKU, price: state.club.greenFee * 2 },
    { skuId: CART_RENTAL_SKU, price: 18 },
  ]);

  const result = finalizeReservationCheckIn(state, tx);
  assert.equal(result.ok, true);
  assert.equal(state.cash, cashBefore + reservation.fee);
  assert.equal(state.ledger.today.revenue.greenFees, state.club.greenFee * 2);
  assert.equal(state.ledger.today.revenue.rentals, 18);
  assert.deepEqual(result.ticket.revenueSplit, { greenFees: 64, rentals: 18 });
  assert.equal(result.cart.assigned, true);
  assert.equal(reservation.cartService.outcome, 'assigned');
  assert.equal(reservation.cartService.cartIds.length, 1);
});

test('customer carts walk, load, drive, park at every hole, return, and hand back keys', () => {
  const state = newGame('relaxed', 8104);
  const reservation = reserveCart(state, { partySize: 4, holes: 9 });
  const checked = checkInReservation(state, reservation.id);
  assert.equal(checked.ok, true);
  const trip = state.cartFleet.trips.find((entry) => entry.id === reservation.cartTripId);
  assert.equal(trip.phase, 'walk-to-cart');
  assert.equal(trip.cartIds.length, 2);
  assert.ok(trip.cartIds.every((id) => state.cartFleet.carts.find((cart) => cart.id === id).status === 'assigned'));

  advanceCartFleet(state, { at: trip.startedAt + 2.1 });
  assert.equal(trip.phase, 'loading');
  advanceCartFleet(state, { at: trip.startedAt + 4.1 });
  assert.equal(trip.phase, 'driving-to-hole');
  assert.equal(trip.equipmentLoaded, true);
  advanceCartFleet(state, { at: trip.startedAt + 5.7 });
  assert.equal(trip.phase, 'parked-at-hole');
  assert.equal(trip.holeIndex, 0);

  advanceCartFleet(state, { at: trip.startedAt + 200 });
  assert.equal(trip.phase, 'complete');
  assert.equal(trip.holeIndex, trip.holeIds.length);
  assert.equal(trip.keyReturned, true);
  assert.equal(trip.equipmentLoaded, false);
  assert.equal(reservation.currentDestination, 'departed');
  assert.equal(reservation.cartService.outcome, 'completed');
  assert.equal(reservation.cartService.equipmentLoaded, true);
  assert.equal(reservation.cartService.keyReturned, true);
  assert.equal(reservation.cartService.holesCompleted, 9);
  assert.ok(Number.isFinite(reservation.cartService.satisfactionDelta));
  assert.ok(trip.cartIds.every((id) => {
    const cart = state.cartFleet.carts.find((entry) => entry.id === id);
    return cart.assignedTripId === null && cart.rounds === 1 && cart.odometerYd > 0;
  }));
});

test('a mid-round save resumes the same assignment and completes without duplicates', () => {
  const state = newGame('relaxed', 8105);
  const reservation = reserveCart(state);
  checkInReservation(state, reservation.id);
  const trip = state.cartFleet.trips.find((entry) => entry.id === reservation.cartTripId);
  state.clock.minutes = trip.startedAt + 14;
  advanceCartFleet(state, { at: state.clock.minutes });
  assert.notEqual(trip.phase, 'complete');
  const assigned = [...trip.cartIds];

  const loaded = deserialize(serialize(state));
  const savedReservation = loaded.reservations.booked.find((entry) => entry.id === reservation.id);
  const savedTrip = loaded.cartFleet.trips.find((entry) => entry.id === savedReservation.cartTripId);
  assert.deepEqual(savedTrip.cartIds, assigned);
  assert.equal(new Set(loaded.cartFleet.carts.map((cart) => cart.id)).size, loaded.cartFleet.carts.length);
  assert.equal(loaded.cartFleet.carts.filter((cart) => cart.assignedTripId === savedTrip.id).length, assigned.length);

  advanceCartFleet(loaded, { at: savedTrip.startedAt + 200 });
  assert.equal(savedTrip.phase, 'complete');
  assert.equal(loaded.cartFleet.lifetime.rentals, 1);
  advanceCartFleet(loaded, { at: savedTrip.startedAt + 400 });
  assert.equal(loaded.cartFleet.lifetime.rentals, 1, 'replaying a completed trip cannot pay or count twice');
});

test('parking, purchases, infrastructure, and manual service all use the fleet expense line', () => {
  const state = newGame('relaxed', 8106);
  const startingCash = state.cash;
  const first = purchaseFleetCart(state);
  const second = purchaseFleetCart(state);
  assert.ok(first.ok && second.ok);
  assert.equal(fleetSummary(state).overflowUsed, 2);
  assert.match(purchaseFleetCart(state).reason, /parking/i);
  const parking = upgradeFleetInfrastructure(state, 'parking');
  assert.equal(parking.ok, true);
  assert.equal(fleetCapacity(state).parking, 6);
  assert.equal(purchaseFleetCart(state).ok, true);

  const cart = state.cartFleet.carts[0];
  cart.charge = 20;
  cart.cleanliness = 30;
  cart.condition = 60;
  assert.equal(serviceFleetCart(state, cart.id, 'charge').ok, true);
  assert.equal(serviceFleetCart(state, cart.id, 'clean').ok, true);
  assert.equal(serviceFleetCart(state, cart.id, 'repair').ok, true);
  assert.deepEqual({ charge: cart.charge, cleanliness: cart.cleanliness, condition: cart.condition }, {
    charge: 100, cleanliness: 100, condition: 100,
  });
  assert.ok(state.cash < startingCash);
  assert.ok(state.ledger.today.expense.rentalFleet > 0);
});

test('daily fleet service is capacity-bound, charged, and migration removes duplicate identity', () => {
  const state = newGame('relaxed', 8107);
  const original = state.cartFleet.carts[0];
  state.cartFleet.carts.push({ ...original, condition: 1 });
  state.cartFleet.carts[0].charge = 10;
  state.cartFleet.carts[0].cleanliness = 20;
  state.cartFleet.carts[0].condition = 50;
  state.cartFleet.schema = 0;
  ensureCartFleet(state);
  assert.equal(state.cartFleet.schema, CART_FLEET_SCHEMA);
  assert.equal(new Set(state.cartFleet.carts.map((cart) => cart.id)).size, state.cartFleet.carts.length);

  const cashBefore = state.cash;
  const summary = fleetDailyTick(state, 3);
  assert.ok(summary.averageCharge > 75, 'the two-slot starter charging bank recovers the waiting cart');
  assert.ok(state.cartFleet.carts[0].cleanliness > 20, 'the starter service bay processes one dirty cart');
  assert.ok(state.cash < cashBefore);
  assert.ok(state.ledger.today.expense.rentalFleet > 0);
});
