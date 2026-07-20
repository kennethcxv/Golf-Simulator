import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { newGame, update, serialize, deserialize } from '../../src/sim/state.js';
import {
  newEmpire, buyProperty, activeState, empireUpdate, requestPropertyAppraisal,
  confirmPropertySale, serializeEmpire, deserializeEmpire,
} from '../../src/sim/empire.js';
import { addRevenue, financialSummary } from '../../src/sim/economy.js';
import { checkoutSale } from '../../src/sim/checkout.js';
import {
  bookSlot, checkInReservation, reservationsDailyTick,
} from '../../src/sim/reservations.js';
import { placeOrder } from '../../src/sim/shop.js';
import {
  productPricingResponse, teePricingResponse, membershipPricingResponse, rentalPricingResponse,
} from '../../src/sim/pricing.js';
import { UPGRADES, purchaseUpgrade } from '../../src/sim/progression.js';
import { propertyConditionBreakdown } from '../../src/sim/propertyCondition.js';
import {
  PROPERTY_TIERS, PROPERTY_TIER_ORDER, propertyReadiness,
} from '../../src/sim/propertyProgression.js';
import { reputationSnapshot } from '../../src/sim/reputation.js';
import { appraisalBreakdown, appraiseProperty } from '../../src/sim/valuation.js';
import { SHOP_CATALOG } from '../../src/data/shopItems.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(root, process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) || 'qa/economy-progression/evidence');
const r2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

function write(name, value) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function restoreRealState(state) {
  state.shop.reno.grime.fill(0);
  state.shop.reno.windows.fill(0);
  for (const item of state.shop.reno.clutter) item.cleared = true;
  const exterior = state.shop.reno.exterior;
  exterior.weeds.fill(0);
  exterior.gutter = 0;
  exterior.cobwebs = 0;
  exterior.light = 0;
  exterior.siding.fill(0);
  for (const surface of Object.values(state.shop.reno.wash || {})) {
    surface.grime.fill(0);
    surface.soap.fill(0);
  }
  for (const item of state.props.litter) item.cleared = true;
  state.props.teeSignFixed = true;
  state.tractor.repaired = true;
  state.turf.health.fill(78);
  state.turf.moisture.fill(55);
  state.turf.nutrients.fill(60);
  state.turf.wear.fill(3);
  state.turf.disSev.fill(0);
  state.turf.disType.fill(0);
  for (const policy of Object.values(state.maintenance.policies)) policy.irrigation = 'standard';
}

function sumEntries(state, predicate) {
  return r2(state.ledger.entries.filter(predicate).reduce((sum, entry) => sum + entry.amount, 0));
}

// A lived-in property supplies ledger, summary, reputation, pricing, condition,
// valuation, and appraisal evidence from the same authoritative state.
const empire = newEmpire('relaxed', 8801);
assert.equal(buyProperty(empire, 'willow-creek').ok, true);
for (let day = 0; day < 8; day += 1) empireUpdate(empire, 1440);
const state = activeState(empire);
state.cash = Math.max(state.cash, 100000);
empire.cash = state.cash;

const currentDay = Math.floor(state.clock.minutes / 1440);
placeOrder(state, 'balls1', 6);
const checkIn = bookSlot(state, currentDay, 7 * 60, 'Evidence Golfer').res;
checkInReservation(state, checkIn.id);
const noShow = bookSlot(state, currentDay, 7 * 60 + 12, 'Evidence No Show').res;
reservationsDailyTick(state, currentDay + 1);
checkoutSale(state, [{ uid: 'evidence-unit', skuId: 'balls1', price: 18 }], 'Evidence Shopper', 'evidence-checkout');
state.progression.prestige = 100;
purchaseUpgrade(state, 'greensMowerII');

const requiredLedgerFields = [
  'id', 'idempotencyKey', 'timestamp', 'day', 'direction', 'category', 'description',
  'amount', 'relatedId', 'propertyId', 'source', 'accountingClass', 'cashImpact', 'profitImpact',
];
const invalidEntries = state.ledger.entries.filter((entry) => requiredLedgerFields.some((field) => entry[field] === undefined));
assert.equal(invalidEntries.length, 0);
write('ledger.json', {
  propertyId: state.property.id,
  entryCount: state.ledger.entries.length,
  exactOnceIdCount: Object.keys(state.ledger.processedIds).length,
  schema: requiredLedgerFields,
  schemaValid: true,
  categories: [...new Set(state.ledger.entries.map((entry) => entry.category))].sort(),
  recentEntries: state.ledger.entries.slice(-30),
});

const summaries = state.ledger.dailySummaries.slice(-7);
write('daily-summary.json', {
  closedDays: state.ledger.history.length,
  latestSeven: summaries,
  reconciliation: summaries.map((summary) => ({
    day: summary.day,
    profitFormula: r2(summary.grossRevenue - summary.costOfGoodsSold - summary.operatingExpenses),
    reportedNetProfit: summary.netProfit,
    cashChange: summary.cashChange,
    formulaMatches: r2(summary.grossRevenue - summary.costOfGoodsSold - summary.operatingExpenses) === summary.netProfit,
  })),
  period: financialSummary(state, summaries[0].day, summaries.at(-1).day),
});

write('reputation.json', {
  snapshot: reputationSnapshot(state),
  recentReasonedChanges: state.reputation.history.slice(0, 30),
  allChangesHaveReasons: state.reputation.history.every((change) => Boolean(change.reason)),
  reviewEvidence: (state.club.reviews || []).slice(0, 10),
});

const fairTee = teePricingResponse(state).fairValue;
write('pricing.json', {
  controls: {
    products: { min: 0.7, max: 1.5 }, teeTime: { min: 10, max: 150 },
    membership: { min: 100, max: 2000 }, rentals: { min: 5, max: 60 },
  },
  products: ['clubs', 'balls', 'apparel', 'accessories'].map((category) => ({
    category,
    low: productPricingResponse(state, category, 0.7),
    fair: productPricingResponse(state, category, 1),
    maximum: productPricingResponse(state, category, 1.5),
  })),
  teeTime: {
    low: teePricingResponse(state, 10), fair: teePricingResponse(state, fairTee), maximum: teePricingResponse(state, 150),
  },
  membership: Object.keys(state.club.dues).map((tier) => ({
    tier,
    low: membershipPricingResponse(state, tier, 100),
    current: membershipPricingResponse(state, tier),
    maximum: membershipPricingResponse(state, tier, 2000),
  })),
  rentals: { low: rentalPricingResponse(state, 5), current: rentalPricingResponse(state), maximum: rentalPricingResponse(state, 60) },
});

const upgradeLoaded = deserialize(serialize(state));
write('upgrades.json', {
  definitions: Object.entries(UPGRADES).map(([id, spec]) => ({ id, ...spec, requirement: `Prestige ${spec.prestige}` })),
  purchasedEvidence: {
    id: 'greensMowerII', persisted: 'greensMowerII' in upgradeLoaded.progression.unlocks,
    ledgerEntries: upgradeLoaded.ledger.entries.filter((entry) => entry.relatedId === 'greensMowerII'),
    duplicatePurchase: purchaseUpgrade(upgradeLoaded, 'greensMowerII'),
  },
  physicalExistingUpgradeExamples: [
    'Pressure washer models are separate in-world equipment with different power and spray radius.',
    'Vacuum ownership begins when its physical delivery box is opened.',
    'Premium supplier merchandise appears as real products on the existing shop shelves.',
    'Furniture and lighting are delivered and placed into existing physical spots.',
  ],
});

const baselineCondition = propertyConditionBreakdown(state);
const baselineValue = appraisalBreakdown(state);
restoreRealState(state);
const restoredCondition = propertyConditionBreakdown(state);
const restoredValue = appraisalBreakdown(state);
assert.equal(restoredValue.contributions.reduce((sum, item) => sum + item.amount, 0), restoredValue.value);
write('condition.json', {
  categoryOrder: Object.keys(restoredCondition.categories),
  baseline: baselineCondition,
  restored: restoredCondition,
  movement: r2(restoredCondition.overall - baselineCondition.overall),
  note: 'The fixture changed real grime masks, clutter flags, exterior jobs, litter, tractor, turf arrays, disease, wear, and irrigation policies; it did not set a condition score.',
});
write('valuation-breakdown.json', {
  baseline: baselineValue,
  restored: restoredValue,
  exactContributionSum: restoredValue.contributions.reduce((sum, item) => sum + item.amount, 0),
  displayedValue: restoredValue.value,
  stableContributionIds: new Set(restoredValue.contributions.map((item) => item.id)).size === restoredValue.contributions.length,
});

const readiness = propertyReadiness(state, empire);
assert.equal(readiness.saleEligible, true);
const appraisal = requestPropertyAppraisal(empire, 'willow-creek').appraisal;
write('appraisal.json', appraisal);
write('next-property-framework.json', {
  order: PROPERTY_TIER_ORDER,
  tiers: PROPERTY_TIER_ORDER.map((id) => PROPERTY_TIERS[id]),
  currentReadiness: readiness,
  unlockedTierIds: empire.progression.unlockedTierIds,
  noFakeEnvironments: 'Only existing property environments are listed for purchase; tiers 3 and 4 are progression definitions, not claimed completed levels.',
});

const refusal = confirmPropertySale(empire, 'willow-creek', appraisal.id, false);
const holdingsAfterRefusal = empire.holdings.length;
const savedOfferEmpire = deserializeEmpire(serializeEmpire(empire));
const persistedOffer = savedOfferEmpire.progression.appraisals.find((item) => item.id === appraisal.id);
const cashBeforeSale = savedOfferEmpire.cash;
const sale = confirmPropertySale(savedOfferEmpire, 'willow-creek', appraisal.id, true);
const cashAfterSale = savedOfferEmpire.cash;
const replaySale = confirmPropertySale(savedOfferEmpire, 'willow-creek', appraisal.id, true);
const soldReload = deserializeEmpire(serializeEmpire(savedOfferEmpire));
assert.equal(sale.ok, true);
assert.equal(replaySale.duplicate, true);
assert.equal(soldReload.holdings.some((holding) => holding.property.id === 'willow-creek'), false);
write('sale-flow.json', {
  appraisalId: appraisal.id,
  explicitConfirmationRefusal: refusal,
  holdingsAfterRefusal,
  persistedOfferMatches: persistedOffer.offer === appraisal.offer && persistedOffer.netProceeds === appraisal.netProceeds,
  cashBeforeSale,
  accepted: sale,
  cashAfterSale,
  exactPayout: r2(cashAfterSale - cashBeforeSale),
  duplicateAttempt: replaySale,
  recoveryBackupCount: savedOfferEmpire.progression.saleBackups.length,
  reloadDoesNotResurrectProperty: !soldReload.holdings.some((holding) => holding.property.id === 'willow-creek'),
});

// Compact adversarial checks mirror the invariant suite and preserve the
// observed before/after values as evidence, rather than only saying "pass".
const checkoutState = newGame('relaxed', 8811);
const checkoutFirst = checkoutSale(checkoutState, [{ uid: 'anti-unit', skuId: 'balls1', price: 18 }], 'Replay', 'anti-checkout');
const checkoutCash = checkoutState.cash;
const checkoutReplayState = deserialize(serialize(checkoutState));
const checkoutReplay = checkoutSale(checkoutReplayState, [{ uid: 'anti-unit', skuId: 'balls1', price: 18 }], 'Replay', 'anti-checkout');

const noShowState = newGame('relaxed', 8812);
bookSlot(noShowState, 0, 7 * 60, 'Anti No Show');
reservationsDailyTick(noShowState, 1);
const noShowCash = noShowState.cash;
const noShowLoaded = deserialize(serialize(noShowState));
reservationsDailyTick(noShowLoaded, 2);

const valueState = newGame('relaxed', 8813);
const decor = SHOP_CATALOG.find((sku) => sku.cat === 'decor');
valueState.shop.reno.decor = [{ skuId: decor.id, spot: 0 }];
const valuePlaced = appraiseProperty(valueState);
valueState.shop.reno.decor[0].spot = 1;
const valueMoved = appraiseProperty(valueState);
for (const inventory of Object.values(valueState.shop.inventory)) inventory.shelf = 1;
const valueOneEach = appraiseProperty(valueState);
for (const inventory of Object.values(valueState.shop.inventory)) inventory.shelf = 999;
const valueStocked = appraiseProperty(valueState);

const collisionState = newGame('relaxed', 8814);
const collisionA = addRevenue(collisionState, 'otherRevenue', 10, { idempotencyKey: 'collision with spaces', source: 'anti-exploit' });
const collisionB = addRevenue(collisionState, 'otherRevenue', 10, { idempotencyKey: 'collision-with-spaces', source: 'anti-exploit' });

const upgradeState = newGame('relaxed', 8815);
upgradeState.cash = 100000;
upgradeState.progression.prestige = 100;
purchaseUpgrade(upgradeState, 'greensMowerII');
const upgradeCash = upgradeState.cash;
const upgradeReplay = purchaseUpgrade(upgradeState, 'greensMowerII');

const instantEmpire = newEmpire('relaxed', 8816);
buyProperty(instantEmpire, 'willow-creek');
const instantAppraisal = requestPropertyAppraisal(instantEmpire, 'willow-creek').appraisal;
const instantCash = instantEmpire.cash;
const instantSale = confirmPropertySale(instantEmpire, 'willow-creek', instantAppraisal.id, true);

const antiExploit = {
  duplicateTransactionRewards: { pass: checkoutFirst.ok && checkoutReplay.duplicate && checkoutReplayState.cash === checkoutCash, checkoutFirst, checkoutReplay },
  duplicateSaleProceeds: { pass: replaySale.duplicate && soldReload.cash === cashAfterSale, cashAfterSale, reloadCash: soldReload.cash },
  furnitureMoveValueFarming: { pass: valueMoved === valuePlaced, valuePlaced, valueMoved },
  stockQuantityValueFarming: { pass: valueStocked === valueOneEach, oneEach: valueOneEach, after999Each: valueStocked },
  negativePricePurchasing: { pass: !placeOrder(valueState, 'balls1', -4).ok },
  repeatedNoShowFee: { pass: noShowLoaded.cash === noShowCash, before: noShowCash, afterReplay: noShowLoaded.cash },
  repeatedUpgradeRefund: { pass: !upgradeReplay.ok && upgradeState.cash === upgradeCash, upgradeReplay, cash: upgradeState.cash },
  immediateGuaranteedFlip: { pass: !instantAppraisal.eligible && !instantSale.ok && instantEmpire.cash === instantCash, appraisal: instantAppraisal, attempt: instantSale },
  ledgerIdCollision: { pass: collisionA.entry.id !== collisionB.entry.id, first: collisionA.entry.id, second: collisionB.entry.id },
};
assert.ok(Object.values(antiExploit).every((check) => check.pass));
write('anti-exploit.json', { allPass: true, checks: antiExploit });

const bookingState = newGame('relaxed', 8817);
const booking = bookSlot(bookingState, 0, 7 * 60, 'Saved Booking').res;
checkInReservation(bookingState, booking.id);
const bookingCash = bookingState.cash;
const bookingLoaded = deserialize(serialize(bookingState));
bookingLoaded.reservations.booked.find((item) => item.id === booking.id).status = 'booked';
checkInReservation(bookingLoaded, booking.id);
write('save-load.json', {
  checkout: {
    cashBeforeSave: checkoutCash, cashAfterReplay: checkoutReplayState.cash,
    exactOnceEntryCount: checkoutReplayState.ledger.entries.filter((entry) => entry.idempotencyKey === 'checkout:anti-checkout:sale').length,
  },
  booking: {
    cashBeforeSave: bookingCash, cashAfterStaleStatusReplay: bookingLoaded.cash,
    exactOnceEntryCount: bookingLoaded.ledger.entries.filter((entry) => entry.idempotencyKey === `reservation:${booking.id}:check-in`).length,
  },
  upgrade: {
    cashBeforeSave: upgradeCash,
    persisted: 'greensMowerII' in deserialize(serialize(upgradeState)).progression.unlocks,
    duplicateRefused: !upgradeReplay.ok,
  },
  appraisal: { offerBeforeSave: appraisal.offer, offerAfterLoad: persistedOffer.offer, netBeforeSave: appraisal.netProceeds, netAfterLoad: persistedOffer.netProceeds },
  sale: { cashAfterSale, cashAfterReload: soldReload.cash, propertyAbsentAfterReload: !soldReload.holdings.some((holding) => holding.property.id === 'willow-creek') },
  exploitProtectionIdsPersisted: Object.keys(checkoutReplayState.ledger.processedIds).length,
  existingPortfolioCoverage: 'tests/portfolio.test.js covers active-property switching and its serialize/deserialize transition.',
});

console.log(JSON.stringify({
  outDir,
  files: fs.readdirSync(outDir).sort(),
  ledgerEntries: state.ledger.entries.length,
  closedDays: state.ledger.history.length,
  saleNet: appraisal.netProceeds,
  antiExploitPass: true,
}, null, 2));
