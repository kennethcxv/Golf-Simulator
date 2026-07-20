import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, update, serialize, deserialize } from '../src/sim/state.js';
import { addRevenue, financialSummary } from '../src/sim/economy.js';
import { checkoutSale } from '../src/sim/checkout.js';
import { bookSlot, checkInReservation, reservationsDailyTick } from '../src/sim/reservations.js';
import { purchaseUpgrade } from '../src/sim/progression.js';
import {
  setGreenFee, setMembershipDue, setProductMarkup, setRentalPrice,
  productPricingResponse, teePricingResponse,
} from '../src/sim/pricing.js';
import { reviewFor, postReview } from '../src/sim/reviews.js';
import { propertyConditionBreakdown, CONDITION_CATEGORIES } from '../src/sim/propertyCondition.js';
import { appraisalBreakdown, appraiseProperty } from '../src/sim/valuation.js';
import { SHOP_CATALOG } from '../src/data/shopItems.js';
import { placeOrder, cancelOrder } from '../src/sim/shop.js';

const r2 = (value) => Math.round(value * 100) / 100;

test('ledger entries are complete, stable, collision-safe, and exact once', () => {
  const state = newGame('relaxed', 901);
  const cash = state.cash;
  const first = addRevenue(state, 'otherRevenue', 25, {
    idempotencyKey: 'event with spaces', relatedId: 'evt-1', description: 'Test event', source: 'test',
  });
  const duplicate = addRevenue(state, 'otherRevenue', 25, {
    idempotencyKey: 'event with spaces', relatedId: 'evt-1', description: 'Test event', source: 'test',
  });
  const distinct = addRevenue(state, 'otherRevenue', 10, {
    idempotencyKey: 'event-with-spaces', relatedId: 'evt-2', description: 'Distinct event', source: 'test',
  });

  assert.equal(first.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(distinct.duplicate, false);
  assert.equal(state.cash, cash + 35);
  assert.notEqual(first.entry.id, distinct.entry.id, 'normalization cannot collide two source IDs');
  for (const key of ['id', 'timestamp', 'category', 'description', 'amount', 'relatedId', 'propertyId', 'day', 'idempotencyKey']) {
    assert.notEqual(first.entry[key], undefined, `${key} is persisted`);
  }
});

test('checkout revenue and COGS cannot replay across save/load', () => {
  const state = newGame('relaxed', 902);
  const item = { uid: 'unit-1', skuId: 'balls1', price: 18 };
  const sale = checkoutSale(state, [item], 'Replay tester', 'saved-transaction-1');
  assert.equal(sale.ok, true);
  const cash = state.cash;
  const loaded = deserialize(serialize(state));
  const replay = checkoutSale(loaded, [item], 'Replay tester', 'saved-transaction-1');
  assert.equal(replay.ok, false);
  assert.equal(replay.duplicate, true);
  assert.equal(loaded.cash, cash);
  assert.equal(loaded.ledger.entries.filter((entry) => entry.idempotencyKey === 'checkout:saved-transaction-1:sale').length, 1);
  assert.equal(loaded.ledger.entries.filter((entry) => entry.idempotencyKey === 'checkout:saved-transaction-1:cogs').length, 1);
});

test('no-show fees post once even when housekeeping and save/load repeat', () => {
  const state = newGame('relaxed', 903);
  assert.equal(bookSlot(state, 0, 7 * 60, 'No Show').ok, true);
  reservationsDailyTick(state, 1);
  const cash = state.cash;
  const loaded = deserialize(serialize(state));
  reservationsDailyTick(loaded, 2);
  assert.equal(loaded.cash, cash);
  assert.equal(loaded.ledger.entries.filter((entry) => entry.category === 'noShowFees').length, 1);
});

test('tee-time revenue cannot replay after save/load even if booking status is stale', () => {
  const state = newGame('relaxed', 911);
  const booking = bookSlot(state, 0, 7 * 60, 'Saved Booker').res;
  assert.equal(checkInReservation(state, booking.id).ok, true);
  const cash = state.cash;
  const loaded = deserialize(serialize(state));
  loaded.reservations.booked.find((item) => item.id === booking.id).status = 'booked';
  const replay = checkInReservation(loaded, booking.id);
  assert.equal(replay.ok, true);
  assert.equal(loaded.cash, cash);
  assert.equal(loaded.ledger.entries.filter((entry) => entry.idempotencyKey === `reservation:${booking.id}:check-in`).length, 1);
});

test('supplier orders reject zero, negative, fractional, and non-numeric quantities', () => {
  const state = newGame('relaxed', 912);
  const cash = state.cash;
  for (const quantity of [0, -1, 1.5, '4']) assert.equal(placeOrder(state, 'balls1', quantity).ok, false);
  assert.equal(state.cash, cash);
  assert.equal(state.shop.orders.length, 0);
});

test('daily summaries reconcile profit and cash while explaining operations', () => {
  const state = newGame('relaxed', 904);
  update(state, 2 * 1440);
  assert.ok(state.ledger.dailySummaries.length >= 2);
  const summary = state.ledger.dailySummaries[0];
  const closed = state.ledger.history.find((day) => day.dayAbs === summary.day);
  assert.equal(r2(summary.cashChange), r2(closed.net));
  assert.equal(r2(summary.grossRevenue - summary.costOfGoodsSold - summary.operatingExpenses), r2(summary.netProfit));
  for (const key of ['customersServed', 'teeTimeUtilization', 'averageTransaction', 'missedSales', 'cleaningCondition', 'courseCondition', 'reputationChange', 'propertyValueChange']) {
    assert.ok(Number.isFinite(summary[key]), `${key} is a real number`);
  }
  assert.ok(summary.reasons.length > 0, 'the summary stores causes');
  assert.deepEqual(financialSummary(state, summary.day, summary.day).netProfit, summary.netProfit);
});

test('pricing refuses invalid values and maximum price is not the revenue optimum', () => {
  const state = newGame('relaxed', 905);
  assert.equal(setProductMarkup(state, 'balls', -1).ok, false);
  assert.equal(setGreenFee(state, -10).ok, false);
  assert.equal(setRentalPrice(state, -2).ok, false);
  assert.equal(setMembershipDue(state, 'full', -100).ok, false);
  const fairProduct = productPricingResponse(state, 'balls', 1);
  const maxProduct = productPricingResponse(state, 'balls', 1.5);
  assert.ok(maxProduct.revenueIndex < fairProduct.revenueIndex);
  const fairTee = teePricingResponse(state, teePricingResponse(state).fairValue);
  const maxTee = teePricingResponse(state, 150);
  assert.ok(maxTee.revenueIndex < fairTee.revenueIndex);
});

test('maximum membership dues do not create a one-day captive-member windfall', () => {
  const fair = newGame('relaxed', 913);
  const extreme = newGame('relaxed', 913);
  for (const tier of Object.keys(extreme.club.dues)) setMembershipDue(extreme, tier, 2000);
  update(fair, 1440);
  update(extreme, 1440);
  const dues = (state) => state.ledger.entries.filter((entry) => entry.category === 'dues').reduce((sum, entry) => sum + entry.amount, 0);
  assert.ok(dues(extreme) < dues(fair), `extreme ${dues(extreme)} must remain below fair ${dues(fair)}`);
  assert.ok(extreme.ledger.outcomes.some((outcome) => outcome.type === 'membershipPriceResistance'));
});

test('reviews move only reasoned reputation categories and persist the reason', () => {
  const state = newGame('relaxed', 906);
  const visit = { reviewId: 'review-test', played: true, waitedSec: 240, queueLen: 6 };
  let review = null;
  for (let seed = 0; seed < 100 && !review; seed += 1) {
    const candidate = reviewFor(state, visit, seed);
    if (candidate.cited.some((factor) => ['waitTime', 'queue'].includes(factor.id))) review = candidate;
  }
  assert.ok(review, 'fixture produces a review that cites the experienced service delay');
  postReview(state, review);
  assert.ok(state.reputation.history.length > 0);
  assert.ok(state.reputation.history.every((change) => change.reason.includes('star review')));
  assert.ok(state.reputation.history.some((change) => 'service' in change.categoryDeltas));
});

test('property condition has thirteen live categories with stable source IDs', () => {
  const state = newGame('relaxed', 907);
  const condition = propertyConditionBreakdown(state);
  assert.deepEqual(Object.keys(condition.categories), CONDITION_CATEGORIES);
  for (const category of Object.values(condition.categories)) {
    assert.ok(category.sources.length > 0, `${category.label} is grounded in live state`);
    assert.equal(new Set(category.sources).size, category.sources.length, `${category.label} has no duplicate source`);
  }
  assert.ok(condition.contributionIds.length > CONDITION_CATEGORIES.length, 'the rollup exposes its underlying state sources');
  assert.ok(condition.unresolved.every((problem) => problem.score < 45));
});

test('furniture movement and stock quantity cannot farm property value', () => {
  const state = newGame('relaxed', 908);
  const decor = SHOP_CATALOG.find((sku) => sku.cat === 'decor');
  state.shop.reno.decor = [{ skuId: decor.id, spot: 0 }];
  const placed = appraiseProperty(state);
  state.shop.reno.decor[0].spot = 1;
  assert.equal(appraiseProperty(state), placed, 'moving the same furnishing changes no value');
  state.shop.reno.decor.push({ skuId: decor.id, spot: 1 });
  assert.equal(appraiseProperty(state), placed, 'duplicating the same placement ID changes no value');

  for (const sku of SHOP_CATALOG) {
    if (state.shop.inventory[sku.id]) state.shop.inventory[sku.id].shelf = 1;
  }
  const oneEach = appraiseProperty(state);
  for (const sku of SHOP_CATALOG) {
    if (state.shop.inventory[sku.id]) state.shop.inventory[sku.id].shelf = 999;
  }
  assert.equal(appraiseProperty(state), oneEach, 'inventory quantity is not duplicated into real-estate value');
});

test('upgrade purchase persists and cannot charge or credit twice', () => {
  const state = newGame('relaxed', 909);
  state.progression.prestige = 100;
  state.cash = 100000;
  const bought = purchaseUpgrade(state, 'greensMowerII');
  assert.equal(bought.ok, true);
  const cash = state.cash;
  const value = appraiseProperty(state);
  const loaded = deserialize(serialize(state));
  assert.equal(purchaseUpgrade(loaded, 'greensMowerII').ok, false);
  assert.equal(loaded.cash, cash);
  assert.equal(appraiseProperty(loaded), value);
  assert.equal(loaded.ledger.entries.filter((entry) => entry.idempotencyKey.includes('greensMowerII')).length, 1);
});

test('furniture and equipment orders count as restoration investment only while paid', () => {
  const state = newGame('relaxed', 914);
  state.cash = 100000;
  const decor = SHOP_CATALOG.find((sku) => sku.cat === 'decor');
  const order = placeOrder(state, decor.id, 1);
  assert.equal(order.ok, true);
  assert.equal(appraisalBreakdown(state).restorationInvestment, order.order.cost);
  assert.equal(cancelOrder(state, order.order.id).ok, true);
  assert.equal(appraisalBreakdown(state).restorationInvestment, 0);
});

test('valuation contributions reconcile exactly to displayed value', () => {
  const state = newGame('relaxed', 910);
  const breakdown = appraisalBreakdown(state);
  assert.equal(breakdown.contributions.reduce((sum, item) => sum + item.amount, 0), breakdown.value);
  assert.ok(breakdown.contributions.every((item) => item.id && item.reason));
});
