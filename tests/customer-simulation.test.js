import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { bookSlot, cancelReservation } from '../src/sim/reservations.js';
import { heldUnits } from '../src/sim/checkout.js';
import {
  CUSTOMER_INTENT,
  CUSTOMER_OUTCOME,
  CUSTOMER_STATE,
  MAX_CUSTOMER_HISTORY,
  MAX_SERVICE_QUEUE,
  RECOVERY_ACTION,
  activateArrival,
  claimSocket,
  createFixtureCustomer,
  customerById,
  customerSimulationOf,
  despawnCustomer,
  ensureCustomerSimulation,
  evaluateCustomerSatisfaction,
  initCustomerSimulation,
  joinServiceQueue,
  leaveServiceQueue,
  planCustomerArrivals,
  releaseDueArrivals,
  releaseCustomerProducts,
  releaseSocket,
  recoverCustomerSimulation,
  requestCustomerRecovery,
  reserveCustomerProduct,
  reviewVisitForCustomer,
  resumeCustomerAfterRecovery,
  serviceQueuePosition,
  tickCustomerQueueWait,
  transitionCustomer,
} from '../src/sim/customerSimulation.js';

const fixedRng = (value = 0.5) => ({
  next: () => value,
  int: (n) => Math.min(n - 1, Math.floor(value * n)),
  range: (min, max) => min + value * (max - min),
  pick: (items) => items[Math.min(items.length - 1, Math.floor(value * items.length))],
  chance: () => false,
});

test('one explicit state is authoritative and illegal lifecycle jumps are refused', () => {
  const state = newGame('relaxed', 901);
  const customer = createFixtureCustomer(state, CUSTOMER_INTENT.PRO_SHOP_SHOPPER, { name: 'State Walker' });
  assert.equal(customer.state, CUSTOMER_STATE.APPROACHING_PROPERTY);
  assert.equal(transitionCustomer(state, customer, CUSTOMER_STATE.PAYING).ok, false, 'cannot jump from the driveway to payment');
  assert.equal(transitionCustomer(state, customer, CUSTOMER_STATE.EXTERIOR_ARRIVAL, 'reached property edge').ok, true);
  assert.equal(transitionCustomer(state, customer, CUSTOMER_STATE.WALKING_TO_ENTRANCE).ok, true);
  assert.equal(transitionCustomer(state, customer, CUSTOMER_STATE.WAITING_FOR_DOOR).ok, true);
  assert.equal(transitionCustomer(state, customer, CUSTOMER_STATE.ENTERING).ok, true);
  assert.equal(transitionCustomer(state, customer, CUSTOMER_STATE.CHOOSING_ACTIVITY).ok, true);
  assert.equal(customer.stateHistory.at(-1).to, CUSTOMER_STATE.CHOOSING_ACTIVITY);
  assert.ok(customerSimulationOf(state).transitionEvents.every((event) => event.from && event.to));
  assert.equal('queued' in customer, false, 'a boolean is not the authoritative queue state');
  assert.equal('awaitingCheckout' in customer, false, 'checkout authority is the lifecycle plus transaction relationship');
});

test('daily arrivals are staggered, reservation parties share a time, and tee customers are usually 10–20 minutes early', () => {
  const state = newGame('relaxed', 902);
  initCustomerSimulation(state);
  const dayAbs = 0;
  state.reservations.booked.push({
    id: 77,
    dayAbs,
    minute: 10 * 60,
    name: 'Early Party',
    partySize: 3,
    fee: 40,
    status: 'booked',
  });
  const arrivals = planCustomerArrivals(state, dayAbs, {
    rng: fixedRng(0.5),
    shopperCount: 24,
    noShowChance: 0,
    lateChance: 0,
  });
  const reservation = arrivals.find((arrival) => arrival.reservationId === 77);
  assert.ok(reservation);
  assert.equal(reservation.partySize, 3);
  assert.ok(reservation.arrivalOffsetMin <= -10 && reservation.arrivalOffsetMin >= -20);
  const shoppers = arrivals.filter((arrival) => arrival.intent !== CUSTOMER_INTENT.RESERVATION_CHECK_IN);
  assert.equal(shoppers.length, 24);
  assert.ok(shoppers.every((arrival, index) => index === 0 || arrival.scheduledMinute - shoppers[index - 1].scheduledMinute >= 7));
  assert.ok(shoppers.some((arrival) => arrival.scheduledMinute < 10 * 60));
  assert.ok(shoppers.some((arrival) => arrival.scheduledMinute > 12 * 60));
});

test('no-shows never spawn, active caps hold arrivals, and queue pressure throttles shoppers before reservations', () => {
  const state = newGame('relaxed', 903);
  const sim = initCustomerSimulation(state);
  sim.plannedDays = [0];
  sim.scheduled.push(
    {
      id: 'no-show', status: CUSTOMER_STATE.SCHEDULED, dayAbs: 0, scheduledMinute: 300,
      intent: CUSTOMER_INTENT.RESERVATION_CHECK_IN, partySize: 1, noShow: true, name: 'Absent Golfer',
    },
    {
      id: 'shopper', status: CUSTOMER_STATE.SCHEDULED, dayAbs: 0, scheduledMinute: 300,
      intent: CUSTOMER_INTENT.PRO_SHOP_SHOPPER, partySize: 1, noShow: false, name: 'Shopper',
    },
    {
      id: 'booking', status: CUSTOMER_STATE.SCHEDULED, dayAbs: 0, scheduledMinute: 300,
      intent: CUSTOMER_INTENT.RESERVATION_CHECK_IN, partySize: 1, noShow: false, name: 'Booked Golfer',
    },
  );
  assert.deepEqual(releaseDueArrivals(state, 360, { activeCount: 12, maxActive: 12 }), []);
  const released = releaseDueArrivals(state, 360, { activeCount: 0, queueLength: 4 });
  assert.deepEqual(released.map((arrival) => arrival.id), ['booking']);
  const party = activateArrival(state, released[0], 360);
  assert.equal(party.length, 1);
  assert.equal(party[0].name, 'Booked Golfer');
  assert.equal(sim.scheduled.find((arrival) => arrival.id === 'no-show').status, 'No-show');
  assert.equal(sim.active.some((customer) => customer.name === 'Absent Golfer'), false);
});

test('booking and cancellation use the customer-arrival extension point', () => {
  const state = newGame('relaxed', 904);
  const booked = bookSlot(state, 0, 9 * 60, 'Tee Sheet Guest');
  assert.equal(booked.ok, true);
  const sim = ensureCustomerSimulation(state);
  const arrival = sim.scheduled.find((entry) => entry.reservationId === booked.res.id);
  assert.ok(arrival, 'the booking has a physical-arrival record');
  assert.equal(cancelReservation(state, booked.res.id).ok, true);
  assert.equal(arrival.status, 'Cancelled');
});

test('a reservation party arrives together but only its lead owns check-in intent', () => {
  const state = newGame('relaxed', 913);
  const sim = initCustomerSimulation(state);
  sim.scheduled.push({
    id: 'party-arrival',
    status: 'Released',
    scheduledMinute: 540,
    intendedMinute: 560,
    intent: CUSTOMER_INTENT.RESERVATION_CHECK_IN,
    reservationId: 44,
    partyId: 'reservation-44',
    partySize: 4,
    name: 'Party Lead',
  });
  const party = activateArrival(state, sim.scheduled[0], 540);
  assert.equal(party.length, 4);
  assert.equal(party[0].intent, CUSTOMER_INTENT.RESERVATION_CHECK_IN);
  assert.deepEqual(party.slice(1).map((customer) => customer.intent), [
    CUSTOMER_INTENT.LOUNGE_VISITOR,
    CUSTOMER_INTENT.LOUNGE_VISITOR,
    CUSTOMER_INTENT.LOUNGE_VISITOR,
  ]);
  assert.ok(party.every((customer) => customer.partyId === 'reservation-44' && customer.reservationId === 44));
});

test('fixture and production paths both respect the twelve-customer active cap', () => {
  const state = newGame('relaxed', 914);
  const customers = Array.from({ length: 12 }, (_, index) => (
    createFixtureCustomer(state, CUSTOMER_INTENT.BROWSER, { name: `Cap ${index}` })
  ));
  assert.ok(customers.every(Boolean));
  assert.equal(createFixtureCustomer(state, CUSTOMER_INTENT.BROWSER, { name: 'Cap overflow' }), null);
  assert.equal(customerSimulationOf(state).active.length, 12);
});

test('service queue is FIFO, capacity-bounded, and advances without cutting', () => {
  const state = newGame('relaxed', 905);
  const customers = Array.from({ length: MAX_SERVICE_QUEUE + 1 }, (_, index) => (
    createFixtureCustomer(state, CUSTOMER_INTENT.PRO_SHOP_SHOPPER, { name: `Queue ${index}` })
  ));
  customers.slice(0, MAX_SERVICE_QUEUE).forEach((customer, index) => {
    const result = joinServiceQueue(state, customer, index);
    assert.equal(result.ok, true);
    assert.equal(result.position, index);
  });
  assert.equal(joinServiceQueue(state, customers.at(-1)).ok, false);
  assert.equal(serviceQueuePosition(state, customers[2]), 2);
  tickCustomerQueueWait(customers[0], 12.5);
  assert.equal(customers[0].experience.waitTimeSec, 12.5);
  assert.equal(leaveServiceQueue(state, customers[0]).ok, true);
  assert.equal(serviceQueuePosition(state, customers[1]), 0);
  assert.deepEqual(customerSimulationOf(state).serviceQueue, customers.slice(1, MAX_SERVICE_QUEUE).map((customer) => customer.id));
});

test('explicit sockets prevent overlap and release cleanly', () => {
  const state = newGame('relaxed', 906);
  const customers = Array.from({ length: 4 }, (_, index) => (
    createFixtureCustomer(state, CUSTOMER_INTENT.BROWSER, { name: `Socket ${index}` })
  ));
  const candidates = ['approach-a', 'approach-b', 'approach-c'];
  const claims = customers.map((customer) => claimSocket(state, customer, 'door-approach', candidates));
  assert.equal(new Set(claims.slice(0, 3)).size, 3);
  assert.equal(claims[3], null);
  releaseSocket(state, customers[0], 'door-approach');
  assert.ok(claimSocket(state, customers[3], 'door-approach', candidates));
});

test('a real final shelf unit can be reserved once, keeps its SKU identity, and returns on abandonment', () => {
  const state = newGame('relaxed', 907);
  state.shop.inventory.balls1.shelf = 1;
  const first = createFixtureCustomer(state, CUSTOMER_INTENT.SPECIFIC_ITEM, { name: 'First', desiredSkuId: 'balls1' });
  const second = createFixtureCustomer(state, CUSTOMER_INTENT.SPECIFIC_ITEM, { name: 'Second', desiredSkuId: 'balls1' });
  const reserved = reserveCustomerProduct(state, first, 'balls1');
  assert.equal(reserved.ok, true);
  assert.equal(reserved.item.skuId, 'balls1');
  assert.equal(state.shop.inventory.balls1.shelf, 0);
  assert.equal(heldUnits(state).length, 1);
  assert.equal(reserveCustomerProduct(state, second, 'balls1').ok, false, 'the second customer cannot duplicate the last unit');
  assert.equal(releaseCustomerProducts(state, first), 1);
  assert.equal(state.shop.inventory.balls1.shelf, 1);
  assert.equal(heldUnits(state).length, 0);
});

test('empty, low, and full-stock shopper fixtures preserve real inventory accounting', () => {
  const state = newGame('relaxed', 918);
  const specific = createFixtureCustomer(state, CUSTOMER_INTENT.SPECIFIC_ITEM, {
    name: 'Empty Shelf', desiredSkuId: 'balls1',
  });
  state.shop.inventory.balls1.shelf = 0;
  assert.equal(reserveCustomerProduct(state, specific, 'balls1').ok, false);
  assert.equal(specific.experience.productAvailability, 0);
  assert.equal(specific.experience.desiredProductFound, false);
  assert.equal(specific.cart.length, 0);
  assert.equal(heldUnits(state).length, 0);

  state.shop.inventory.balls1.shelf = 1;
  const lowStock = createFixtureCustomer(state, CUSTOMER_INTENT.PRO_SHOP_SHOPPER, { name: 'Last Unit' });
  const competing = createFixtureCustomer(state, CUSTOMER_INTENT.BROWSER, { name: 'Too Late' });
  assert.equal(reserveCustomerProduct(state, lowStock, 'balls1').ok, true);
  assert.equal(reserveCustomerProduct(state, competing, 'balls1').ok, false);
  assert.equal(state.shop.inventory.balls1.shelf, 0);
  assert.equal(heldUnits(state).length, 1);
  assert.equal(releaseCustomerProducts(state, lowStock), 1);
  assert.equal(state.shop.inventory.balls1.shelf, 1);

  state.shop.inventory.balls1.shelf = 12;
  assert.equal(reserveCustomerProduct(state, competing, 'balls1').ok, true);
  assert.equal(reserveCustomerProduct(state, competing, 'balls1').ok, true);
  assert.equal(competing.cart.length, 2);
  assert.equal(state.shop.inventory.balls1.shelf, 10);
  assert.equal(heldUnits(state).filter((unit) => unit.skuId === 'balls1').length, 2);
  assert.equal(releaseCustomerProducts(state, competing), 2);
  assert.equal(state.shop.inventory.balls1.shelf, 12);
});

test('navigation recovery escalates in the required order and only teleports last', () => {
  const state = newGame('relaxed', 908);
  const customer = createFixtureCustomer(state, CUSTOMER_INTENT.BROWSER, { name: 'Recovery Case' });
  const actions = Array.from({ length: 5 }, () => requestCustomerRecovery(state, customer, state.clock.minutes));
  assert.deepEqual(actions, [
    RECOVERY_ACTION.REPATH,
    RECOVERY_ACTION.ALTERNATE_APPROACH,
    RECOVERY_ACTION.RELEASE_OPTIONAL,
    RECOVERY_ACTION.SAFE_ANCHOR,
    RECOVERY_ACTION.EMERGENCY_REPOSITION,
  ]);
  assert.equal(customer.state, CUSTOMER_STATE.RECOVERY);
  assert.equal(resumeCustomerAfterRecovery(state, customer).ok, true);
  assert.equal(customer.state, CUSTOMER_STATE.APPROACHING_PROPERTY);
  assert.equal(customerSimulationOf(state).metrics.emergencyRepositions, 1);
});

test('satisfaction is derived from real visit factors and exposes reasons', () => {
  const state = newGame('relaxed', 909);
  const customer = createFixtureCustomer(state, CUSTOMER_INTENT.SPECIFIC_ITEM, { name: 'Evidence Reviewer', desiredSkuId: 'balls3' });
  customer.experience.waitTimeSec = 260;
  customer.experience.productAvailability = 0;
  customer.experience.desiredProductFound = false;
  customer.experience.navigationCongestion = 1;
  customer.experience.checkoutSuccess = 0;
  customer.reasons.push('desired stock was unavailable');
  const result = evaluateCustomerSatisfaction(state, customer);
  assert.equal(result.outcome, CUSTOMER_OUTCOME.DISSATISFIED);
  assert.ok(result.factors.some((factor) => factor.id === 'productAvailability' && factor.score === 0));
  assert.ok(result.reasons.some((reason) => /stock|availability/i.test(reason)));
  const reviewVisit = reviewVisitForCustomer(customer);
  assert.equal(reviewVisit.customerOutcome, CUSTOMER_OUTCOME.DISSATISFIED);
  assert.equal(reviewVisit.foundWhatTheyWanted, false);
  assert.equal(reviewVisit.bought, false);
  assert.ok(reviewVisit.outcomeReasons.some((reason) => /stock|availability/i.test(reason)));
});

test('save during checkout restores one customer, one held unit, and a valid queue checkpoint without repeated payment', () => {
  const state = newGame('relaxed', 910);
  state.shop.inventory.balls1.shelf = 1;
  const customer = createFixtureCustomer(state, CUSTOMER_INTENT.PRO_SHOP_SHOPPER, { name: 'Reload Shopper' });
  const picked = reserveCustomerProduct(state, customer, 'balls1');
  assert.equal(picked.ok, true);
  joinServiceQueue(state, customer);
  transitionCustomer(state, customer, CUSTOMER_STATE.PAYING, 'fixture entered checkout', state.clock.minutes, { force: true });
  customer.transactionRelationship = { id: 'checkout-reload', status: 'active' };

  const loaded = deserialize(serialize(state));
  const restored = customerById(loaded, customer.id);
  assert.ok(restored);
  assert.equal(restored.state, CUSTOMER_STATE.WAITING_IN_QUEUE);
  assert.equal(serviceQueuePosition(loaded, restored), 0);
  assert.equal(restored.cart.length, 1);
  assert.equal(restored.cart[0].uid, picked.item.uid);
  assert.equal(heldUnits(loaded).length, 1);
  assert.equal(loaded.shop.inventory.balls1.shelf, 0);
  assert.equal(restored.transactionRelationship, null);

  const loadedAgain = deserialize(serialize(loaded));
  assert.equal(customerSimulationOf(loadedAgain).active.filter((entry) => entry.id === customer.id).length, 1);
  assert.equal(heldUnits(loadedAgain).filter((entry) => entry.uid === picked.item.uid).length, 1);
  assert.equal(loadedAgain.shop.inventory.balls1.shelf, 0);
});

test('save during browsing releases optional sockets while save during queue preserves FIFO', () => {
  const state = newGame('relaxed', 915);
  const browser = createFixtureCustomer(state, CUSTOMER_INTENT.BROWSER, { name: 'Saved Browser' });
  const queued = createFixtureCustomer(state, CUSTOMER_INTENT.WALK_IN_TEE_TIME, { name: 'Saved Walk-in' });
  transitionCustomer(state, browser, CUSTOMER_STATE.BROWSING, 'fixture browsing', state.clock.minutes, { force: true });
  browser.browseAssignment = { fixtureId: 'shelf_balls', socketId: 'browse-shelf_balls-south-0' };
  claimSocket(state, browser, 'browse', [browser.browseAssignment.socketId]);
  joinServiceQueue(state, queued);
  transitionCustomer(state, queued, CUSTOMER_STATE.WAITING_IN_QUEUE, 'fixture queued', state.clock.minutes, { force: true });

  const loaded = deserialize(serialize(state));
  const restoredBrowser = customerById(loaded, browser.id);
  const restoredQueue = customerById(loaded, queued.id);
  assert.equal(restoredBrowser.state, CUSTOMER_STATE.CHOOSING_ACTIVITY);
  assert.equal(restoredBrowser.browseAssignment, null);
  assert.deepEqual(customerSimulationOf(loaded).socketClaims, {});
  assert.equal(restoredQueue.state, CUSTOMER_STATE.WAITING_IN_QUEUE);
  assert.equal(serviceQueuePosition(loaded, restoredQueue), 0);
});

test('scene exit and re-entry recovery is idempotent and keeps accounted products at a retry checkpoint', () => {
  const state = newGame('relaxed', 916);
  state.shop.inventory.balls2.shelf = 1;
  const customer = createFixtureCustomer(state, CUSTOMER_INTENT.PRO_SHOP_SHOPPER, { name: 'Scene Re-entry' });
  const reserved = reserveCustomerProduct(state, customer, 'balls2');
  joinServiceQueue(state, customer);
  transitionCustomer(state, customer, CUSTOMER_STATE.WAITING_FOR_CASHIER, 'scene fixture', state.clock.minutes, { force: true });

  const first = recoverCustomerSimulation(state);
  const second = recoverCustomerSimulation(state);
  assert.equal(first.active, 1);
  assert.equal(second.active, 1);
  assert.equal(customer.state, CUSTOMER_STATE.WAITING_IN_QUEUE);
  assert.equal(serviceQueuePosition(state, customer), 0);
  assert.equal(customer.cart[0].uid, reserved.item.uid);
  assert.equal(heldUnits(state).filter((unit) => unit.uid === reserved.item.uid).length, 1);
  assert.equal(state.shop.inventory.balls2.shelf, 0);
});

test('walk-in customers carry front-desk intent and satisfaction records check-in outcome', () => {
  const state = newGame('relaxed', 917);
  const customer = createFixtureCustomer(state, CUSTOMER_INTENT.WALK_IN_TEE_TIME, { name: 'Walk-in Guest' });
  customer.experience.checkInSuccess = 1;
  customer.experience.waitTimeSec = 10;
  const result = evaluateCustomerSatisfaction(state, customer);
  assert.ok([CUSTOMER_OUTCOME.SATISFIED, CUSTOMER_OUTCOME.NEUTRAL].includes(result.outcome));
  assert.ok(result.factors.some((factor) => factor.id === 'checkInSuccess' && factor.score === 1));
});

test('legacy saves still return renderer-only held stock on reload', () => {
  const state = newGame('relaxed', 911);
  const customer = createFixtureCustomer(state, CUSTOMER_INTENT.PRO_SHOP_SHOPPER, { name: 'Legacy' });
  reserveCustomerProduct(state, customer, 'balls1', { uid: 'legacy-held' });
  const before = state.shop.inventory.balls1.shelf;
  delete state.shop.customerSimulation;
  const loaded = deserialize(serialize(state));
  assert.equal(heldUnits(loaded).length, 0);
  assert.equal(loaded.shop.inventory.balls1.shelf, before + 1);
  assert.ok(loaded.shop.customerSimulation);
});

test('fifty accelerated visits leave no active customers and history remains bounded', () => {
  const state = newGame('relaxed', 912);
  const total = MAX_CUSTOMER_HISTORY + 30;
  for (let i = 0; i < total; i += 1) {
    const customer = createFixtureCustomer(state, i % 2 ? CUSTOMER_INTENT.BROWSER : CUSTOMER_INTENT.LOUNGE_VISITOR, { name: `Soak ${i}` });
    transitionCustomer(state, customer, CUSTOMER_STATE.LEAVING, 'accelerated soak', state.clock.minutes, { force: true });
    assert.equal(despawnCustomer(state, customer, { reason: 'accelerated soak complete' }).ok, true);
  }
  const sim = customerSimulationOf(state);
  assert.equal(sim.active.length, 0);
  assert.equal(sim.serviceQueue.length, 0);
  assert.equal(sim.history.length, MAX_CUSTOMER_HISTORY);
  assert.equal(sim.history.at(-1).name, `Soak ${total - 1}`);
  assert.ok(sim.transitionEvents.length <= 300);
});
