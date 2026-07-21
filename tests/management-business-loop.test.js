import test from 'node:test';
import assert from 'node:assert/strict';

import { MINUTES_PER_DAY } from '../src/sim/constants.js';
import { newGame, update, serialize, deserialize } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import { skuById } from '../src/data/shopItems.js';
import { placeOrder, tickDeliveries, priceFor } from '../src/sim/shop.js';
import {
  boxesOf, cutTape, openFlap, takeFromBox, flattenBox, recycleBox,
} from '../src/sim/deliveries.js';
import { carriedGoods, homeOf, stockFixture, storeInBack } from '../src/sim/stocking.js';
import { bookReservation } from '../src/sim/reservations.js';
import { createReservationCheckInTx, finalizeReservationCheckIn } from '../src/sim/reservationCheckIn.js';
import { pickFromShelf, heldUnits } from '../src/sim/checkout.js';
import {
  createTx, scanItem, requestPayment, presentCard, insertCard, submitCardAmount, runCard,
  enterCardDigit, totalOf, printReceipt, takeReceipt, packReceipt, bagItem, handOverGoods, completeSale,
} from '../src/sim/register.js';
import { reviewFor, postReview, reviewSummary } from '../src/sim/reviews.js';
import { hireStaff } from '../src/sim/staff.js';
import { upgradeAmenity, UTILITIES_PER_DAY } from '../src/sim/club.js';
import { hasUpgrade, purchaseUpgrade } from '../src/sim/progression.js';

const approvedCard = (tx) => {
  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  for (const digit of String(Math.round(totalOf(tx) * 100))) {
    assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
  }
  assert.equal(submitCardAmount(tx).ok, true);
  assert.equal(runCard(tx).result, 'approved');
};

const unitsOf = (state, skuId) => {
  const inventory = state.shop.inventory[skuId];
  const boxed = boxesOf(state)
    .filter((box) => box.skuId === skuId)
    .reduce((sum, box) => sum + box.qty, 0);
  const carried = carriedGoods(state);
  const inHands = carried && carried.skuId === skuId ? carried.qty : 0;
  const held = heldUnits(state).filter((unit) => unit.skuId === skuId).length;
  const ordered = state.shop.orders
    .filter((order) => order.skuId === skuId)
    .reduce((sum, order) => sum + order.qty, 0);
  return inventory.shelf + inventory.back + boxed + inHands + held + ordered;
};

test('one persisted club connects supplier, stocking, guests, sales, books, staff, upgrades, and reviews', () => {
  const state = newGame('relaxed', 20260718);
  state.cash = 100000;
  state.club.greenFee = 64;
  state.club.dues.weekday += 5;
  state.shop.markup.balls = 1.28;
  state.shop.featureCategory = 'balls';
  state.shop.inventory.balls1.shelf = 0;
  state.shop.inventory.balls1.back = 0;

  // Supplier order -> exact debit -> authored delivery manifest.
  const cashBeforeOrder = state.cash;
  const ordered = placeOrder(state, 'balls1', 12);
  assert.equal(ordered.ok, true);
  assert.equal(ordered.supplier, 'Fairway Supply Co.');
  assert.equal(state.cash, cashBeforeOrder - ordered.cost);
  assert.equal(state.ledger.today.expense.shopOrders, ordered.cost);
  assert.equal(unitsOf(state, 'balls1'), 12, 'ordered units are already conserved in transit');

  const arrivalEvents = tickDeliveries(state, ordered.order.deliveryMin + 1);
  assert.equal(arrivalEvents.filter((event) => event.kind === 'arrived').length, 1);
  assert.equal(state.shop.orders.length, 0);
  assert.equal(unitsOf(state, 'balls1'), 12, 'arrival moved the same units into cartons');

  // Carton -> cut tape -> four flaps -> two armfuls -> the correct fixture.
  for (const box of [...boxesOf(state)]) {
    assert.equal(cutTape(state, box.id, 1).ok, true);
    assert.equal(openFlap(state, box.id).ok, true);
    assert.equal(openFlap(state, box.id).ok, true);
    assert.equal(openFlap(state, box.id).ok, true);
    while (box.qty > 0) {
      const taken = takeFromBox(state, box.id);
      assert.equal(taken.ok, true);
      const home = homeOf('balls1');
      assert.ok(home, 'ordered line has an authored sales fixture');
      const stocked = stockFixture(state, home.id, 99);
      assert.equal(stocked.ok, true);
      if (carriedGoods(state)) assert.equal(storeInBack(state).ok, true);
    }
    assert.equal(flattenBox(state, box.id).ok, true);
    assert.equal(recycleBox(state, box.id).ok, true);
  }
  assert.equal(boxesOf(state).length, 0);
  assert.equal(carriedGoods(state), null);
  assert.equal(unitsOf(state, 'balls1'), 12);

  // Booking -> online deposit -> physical shared-register check-in -> green-fee ledger.
  const dayAbs = calendarOf(state.clock.minutes).dayAbs + 1;
  const booked = bookReservation(state, {
    dayAbs,
    minute: 540,
    name: 'Morgan Fairway',
    partySize: 2,
    holes: 9,
    transport: 'cart',
    rentalRequirements: ['clubs'],
    paymentPreference: 'card',
    totalFee: 128,
    deposit: 32,
  });
  assert.equal(booked.ok, true);
  assert.equal(booked.res.depositPaid, 32);
  const checkIn = createReservationCheckInTx(state, booked.res.id, {
    method: 'card',
    rng: () => 0.9,
  });
  assert.equal(checkIn.ok, true);
  approvedCard(checkIn.tx);
  const checkedIn = finalizeReservationCheckIn(state, checkIn.tx);
  assert.equal(checkedIn.ok, true);
  assert.equal(booked.res.status, 'played');
  assert.equal(booked.res.totalPaid, 128);
  assert.equal(state.ledger.today.revenue.greenFees + state.ledger.today.revenue.rentals, 128,
    'green fee and cart rental reconcile to the paid booking total');

  // Stocked unit -> physical scan/card/receipt/bag/handoff -> sale and finance ticket.
  const sku = skuById('balls1');
  const uid = 'management-loop-ball-1';
  const salePrice = priceFor(sku, state.shop.markup.balls, null);
  assert.equal(pickFromShelf(state, sku.id, uid).ok, true);
  const saleTx = createTx({
    items: [{ uid, skuId: sku.id, name: sku.name, price: salePrice }],
    mode: state.mode,
    prefer: 'card',
    rng: () => 0.9,
  });
  assert.equal(scanItem(saleTx, uid).ok, true);
  approvedCard(saleTx);
  assert.equal(printReceipt(saleTx).ok, true);
  assert.equal(takeReceipt(saleTx).ok, true);
  assert.equal(packReceipt(saleTx).ok, true);
  assert.equal(bagItem(saleTx, uid).ok, true);
  assert.equal(handOverGoods(saleTx).ok, true);
  const sold = completeSale(state, saleTx, 'Morgan Fairway');
  assert.equal(sold.ok, true);
  assert.equal(sold.total, salePrice);
  assert.equal(state.ledger.today.revenue.shopSales, salePrice);
  assert.equal(unitsOf(state, 'balls1'), 11, 'one and only one stocked unit left with the guest');
  assert.equal(state.shop.transactionHistory.length, 3, 'deposit, check-in, and merchandise each have one ticket');

  // The same live state feeds staffing, renovation, unlock, review, and daily books.
  const hired = hireStaff(state, state.staff.market[0].id);
  assert.equal(hired.ok, true);
  assert.equal(upgradeAmenity(state, 'range').ok, true);
  state.progression.prestige = 35; // deterministic eligibility fixture; gating itself has dedicated tests
  assert.equal(purchaseUpgrade(state, 'premiumSupplier').ok, true);
  assert.equal(hasUpgrade(state, 'premiumSupplier'), true);
  assert.equal(state.shop.unlockedTier, 3);
  postReview(state, reviewFor(state, { waitedSec: 12, queueLen: 0, played: true }, 901));
  assert.equal(reviewSummary(state).count, 1);

  update(state, MINUTES_PER_DAY);
  assert.equal(state.ledger.yesterday.expense.utilities, UTILITIES_PER_DAY);
  assert.equal(state.ledger.yesterday.expense.wagesStaff, hired.employee.wage);
  assert.ok(state.ledger.yesterday.revenue.dues > 0, 'the active member roll generated dues');
  assert.ok(state.ledger.yesterday.revenue.greenFees + state.ledger.yesterday.revenue.rentals >= 128,
    'physical check-in and daily play share categorized booking books');
  assert.ok(state.ledger.yesterday.revenue.shopSales >= salePrice, 'physical and simulated shop sales share one ledger line');
  assert.equal(state.ledger.yesterday.expense.shopOrders, ordered.cost);
  assert.ok(state.ledger.yesterday.expense.works >= 8000, 'range renovation and supplier unlock closed into capital works');

  const beforeSave = {
    cash: state.cash,
    balls: unitsOf(state, 'balls1'),
    tickets: state.shop.transactionHistory.length,
    reviews: state.club.reviews.length,
    employeeId: hired.employee.id,
    greenFee: state.club.greenFee,
    weekdayDues: state.club.dues.weekday,
    ballMarkup: state.shop.markup.balls,
    featureCategory: state.shop.featureCategory,
    rangeLevel: state.club.amenities.range,
  };
  const loaded = deserialize(serialize(state));
  assert.deepEqual({
    cash: loaded.cash,
    balls: unitsOf(loaded, 'balls1'),
    tickets: loaded.shop.transactionHistory.length,
    reviews: loaded.club.reviews.length,
    employeeId: loaded.staff.employees[0].id,
    greenFee: loaded.club.greenFee,
    weekdayDues: loaded.club.dues.weekday,
    ballMarkup: loaded.shop.markup.balls,
    featureCategory: loaded.shop.featureCategory,
    rangeLevel: loaded.club.amenities.range,
  }, beforeSave);
  assert.equal(hasUpgrade(loaded, 'premiumSupplier'), true);
  assert.deepEqual(loaded.ledger.yesterday, state.ledger.yesterday);
});
