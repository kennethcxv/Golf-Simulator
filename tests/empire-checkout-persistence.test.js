import test from 'node:test';
import assert from 'node:assert/strict';

import { checkoutSale, pickFromShelf } from '../src/sim/checkout.js';
import { quarantineCheckoutWal } from '../src/sim/checkoutSettlement.js';
import { snapshot } from '../src/sim/state.js';
import {
  activeState,
  buyProperty,
  deserializeEmpire,
  deserializeEmpireWithReport,
  newEmpire,
  sellProperty,
  serializeEmpire,
  syncWallet,
  switchProperty,
} from '../src/sim/empire.js';

const round2 = (value) => Math.round(Number(value) * 100) / 100;

function ownedEmpire(seed, { two = false } = {}) {
  const empire = newEmpire('relaxed', seed);
  const first = buyProperty(empire, 'willow-creek');
  assert.equal(first.ok, true, first.reason);
  if (two) {
    const second = buyProperty(empire, 'bent-pines');
    assert.equal(second.ok, true, second.reason);
  }
  return empire;
}

function interruptFifteenDollarSale(state, id) {
  const item = { uid: `${id}-unit`, skuId: 'balls1', price: 15 };
  if (state.shop.inventory[item.skuId].shelf <= 0) {
    state.shop.inventory[item.skuId].shelf = 1;
  }
  const picked = pickFromShelf(state, item.skuId, item.uid);
  assert.equal(picked.ok, true, picked.reason);
  const openingCash = state.cash;
  assert.throws(() => checkoutSale(state, [item], 'Portfolio WAL Golfer', id, {
    taxRate: 0,
    qaFaultAfterInventory() {
      throw new Error('interrupt portfolio checkout after inventory');
    },
  }), /interrupt portfolio checkout after inventory/);
  assert.deepEqual(Object.keys(state.shop.pendingCheckouts), [`checkout:${id}`]);
  assert.equal(state.cash, openingCash, 'the interrupted checkout has not banked its payment yet');
  return { openingCash, item };
}

function interruptFifteenDollarSaleAfterCore(state, id) {
  const item = { uid: `${id}-unit`, skuId: 'balls1', price: 15 };
  if (state.shop.inventory[item.skuId].shelf <= 0) {
    state.shop.inventory[item.skuId].shelf = 1;
  }
  const picked = pickFromShelf(state, item.skuId, item.uid);
  assert.equal(picked.ok, true, picked.reason);
  const openingCash = state.cash;
  assert.throws(() => checkoutSale(state, [item], 'Portfolio WAL Golfer', id, {
    taxRate: 0,
    qaFaultAfterCoreCommit() {
      throw new Error('interrupt portfolio checkout after core commit');
    },
  }), /interrupt portfolio checkout after core commit/);
  assert.deepEqual(Object.keys(state.shop.pendingCheckouts), [`checkout:${id}`]);
  assert.equal(state.cash, round2(openingCash + 15),
    'the post-core interruption has already committed its payment');
  return { openingCash, item };
}

function rawHolding(raw, propertyId) {
  const holding = raw.holdings.find((entry) => entry.property.id === propertyId);
  assert.ok(holding, `expected a persisted holding for ${propertyId}`);
  return holding;
}

function installCheckoutImage(rawState, liveState) {
  rawState.cash = liveState.cash;
  rawState.shop = structuredClone(liveState.shop);
  rawState.ledger = structuredClone(liveState.ledger);
  rawState.salesTax = structuredClone(liveState.salesTax);
  return rawState;
}

function receiptRowsFor(state, transactionId) {
  return Object.values(state.shop.checkoutSettlementReceipts || {})
    .filter((receipt) => receipt?.transactionId === transactionId);
}

function checkoutEvidenceBytes(state) {
  return JSON.stringify({
    cash: state.cash,
    shop: state.shop,
    ledger: state.ledger,
    salesTax: state.salesTax,
  });
}

function portfolioAuthorityBytes(empire) {
  return JSON.stringify({
    cash: empire.cash,
    clockMinutes: empire.clockMinutes,
    activeId: empire.activeId,
    market: empire.market,
    log: empire.log,
    progression: empire.progression,
    holdings: empire.holdings.map((holding) => ({
      property: holding.property,
      passive: holding.passive,
      cash: holding.state.cash,
      shop: holding.state.shop,
      ledger: holding.state.ledger,
      salesTax: holding.state.salesTax,
    })),
  });
}

function rowsFor(state, transactionId) {
  const key = (suffix) => `checkout:${transactionId}:${suffix}`;
  return {
    sale: state.ledger.entries.filter((entry) => entry.idempotencyKey === key('sale')),
    cogs: state.ledger.entries.filter((entry) => entry.idempotencyKey === key('cogs')),
    ticket: state.shop.transactionHistory.filter((entry) => entry.transactionId === transactionId),
  };
}

function assertRecoveredFifteenDollarCheckout(state, transactionId, expectedCash) {
  assert.equal(state.cash, expectedCash);
  assert.deepEqual(state.shop.pendingCheckouts, {});
  assert.equal(rowsFor(state, transactionId).sale.length, 1);
  assert.equal(rowsFor(state, transactionId).cogs.length, 1);
  assert.equal(rowsFor(state, transactionId).ticket.length, 1);
  assert.equal(receiptRowsFor(state, transactionId).length, 1);
}

test('portfolio save drains an interrupted $15 checkout before capturing envelope cash', () => {
  const empire = ownedEmpire(27100);
  const state = activeState(empire);
  const transactionId = 'portfolio-save-fifteen';
  const { openingCash } = interruptFifteenDollarSale(state, transactionId);

  const raw = JSON.parse(serializeEmpire(empire));
  const saved = raw.holdings.find((holding) => holding.property.id === raw.activeId).state;
  const expectedCash = round2(openingCash + 15);
  assert.equal(raw.cash, expectedCash, 'the shared wallet includes the recovered payment');
  assert.equal(saved.cash, expectedCash, 'nested and envelope cash are the same committed image');
  assert.deepEqual(saved.shop.pendingCheckouts, {});
  assert.equal(rowsFor(saved, transactionId).sale.length, 1);
  assert.equal(rowsFor(saved, transactionId).cogs.length, 1);
  assert.equal(rowsFor(saved, transactionId).ticket.length, 1);

  const loaded = deserializeEmpire(raw);
  assert.equal(loaded.cash, expectedCash);
  assert.equal(activeState(loaded).cash, expectedCash);
  assert.deepEqual(activeState(loaded).shop.pendingCheckouts, {});
  assert.equal(rowsFor(activeState(loaded), transactionId).sale.length, 1);
  assert.equal(rowsFor(activeState(loaded), transactionId).cogs.length, 1);
  assert.equal(rowsFor(activeState(loaded), transactionId).ticket.length, 1);
});

test('switching safely reconciles the outgoing checkout and refuses a quarantined checkout', () => {
  const empire = ownedEmpire(27101, { two: true });
  const outgoing = activeState(empire);
  const transactionId = 'portfolio-switch-fifteen';
  const { openingCash } = interruptFifteenDollarSale(outgoing, transactionId);
  const expectedCash = round2(openingCash + 15);

  const switched = switchProperty(empire, 'bent-pines');
  assert.equal(switched.ok, true, switched.reason);
  assert.equal(empire.activeId, 'bent-pines');
  assert.equal(empire.cash, expectedCash);
  assert.equal(activeState(empire).cash, expectedCash, 'the reconciled wallet follows the player');
  assert.equal(outgoing.cash, 0, 'the safely settled outgoing club is parked without a local wallet');
  assert.deepEqual(outgoing.shop.pendingCheckouts, {});
  assert.equal(rowsFor(outgoing, transactionId).ticket.length, 1);

  const blockedState = activeState(empire);
  const blockedId = 'portfolio-switch-invalid-plan';
  interruptFifteenDollarSale(blockedState, blockedId);
  blockedState.shop.pendingCheckouts[`checkout:${blockedId}`].signature = 'corrupt-signature';
  const holdingsBefore = empire.holdings.map((holding) => holding.property.id);
  const blockedSwitch = switchProperty(empire, 'willow-creek');
  assert.equal(blockedSwitch.ok, false);
  assert.match(blockedSwitch.reason, /checkout/i);
  assert.equal(empire.activeId, 'bent-pines', 'a blocked switch does not park or activate anything');
  assert.deepEqual(empire.holdings.map((holding) => holding.property.id), holdingsBefore);
  assert.deepEqual(Object.keys(blockedState.shop.pendingCheckouts), [`checkout:${blockedId}`],
    'a failed reconciliation leaves its WAL available for repair');

  quarantineCheckoutWal(blockedState, 'portfolio-switch-test-quarantine');
  const blockedSale = sellProperty(empire, 'bent-pines');
  assert.equal(blockedSale.ok, false);
  assert.match(blockedSale.reason, /checkout/i);
  assert.equal(empire.activeId, 'bent-pines');
  assert.deepEqual(empire.holdings.map((holding) => holding.property.id), holdingsBefore,
    'a blocked sale cannot discard the checkout authority with its property');
});

test('selling the active property banks a recoverable checkout before calculating proceeds', () => {
  const empire = ownedEmpire(27102);
  const state = activeState(empire);
  const { openingCash } = interruptFifteenDollarSale(state, 'portfolio-sale-fifteen');

  const sale = sellProperty(empire, 'willow-creek');
  assert.equal(sale.ok, true, sale.reason);
  assert.equal(empire.cash, round2(openingCash + 15 + sale.payout));
  assert.equal(empire.activeId, null);
  assert.equal(empire.holdings.length, 0);
});

test('parked checkout evidence is never replayed against a zero local wallet', () => {
  const empire = ownedEmpire(27103, { two: true });
  const cleanRaw = JSON.parse(serializeEmpire(empire));
  const parked = empire.holdings.find((holding) => holding.property.id === 'bent-pines');
  const transactionId = 'portfolio-parked-fifteen';
  interruptFifteenDollarSale(parked.state, transactionId);
  const walletBefore = empire.cash;

  assert.throws(
    () => serializeEmpire(empire),
    /parked property with an unresolved checkout/i,
  );
  assert.equal(empire.cash, walletBefore);
  assert.equal(parked.state.cash, 0);
  assert.deepEqual(Object.keys(parked.state.shop.pendingCheckouts), [`checkout:${transactionId}`]);
  assert.equal(rowsFor(parked.state, transactionId).ticket.length, 0,
    'a refused save leaves the parked checkout authority untouched');

  // Model a portfolio written before the parked-WAL guard existed. Loading it
  // must quarantine the nested journal rather than replay absolute cash targets
  // against the parked club's intentionally empty local wallet.
  const rawParked = cleanRaw.holdings.find((holding) => holding.property.id === 'bent-pines').state;
  rawParked.cash = parked.state.cash;
  rawParked.shop = structuredClone(parked.state.shop);
  rawParked.ledger = structuredClone(parked.state.ledger);
  rawParked.salesTax = structuredClone(parked.state.salesTax);

  const loaded = deserializeEmpire(cleanRaw);
  const loadedParked = loaded.holdings.find((holding) => holding.property.id === 'bent-pines').state;
  assert.equal(loaded.cash, walletBefore);
  assert.equal(loadedParked.cash, 0);
  assert.equal(loadedParked.shop.pendingCheckoutsQuarantine?.active, true);
  assert.deepEqual(Object.keys(loadedParked.shop.pendingCheckouts), [`checkout:${transactionId}`]);
  assert.equal(rowsFor(loadedParked, transactionId).ticket.length, 0);

  const savedAgain = JSON.parse(serializeEmpire(loaded));
  const savedParked = savedAgain.holdings.find((holding) => holding.property.id === 'bent-pines').state;
  assert.equal(savedAgain.cash, walletBefore);
  assert.equal(savedParked.cash, 0);
  assert.equal(savedParked.shop.pendingCheckoutsQuarantine?.active, true);
  assert.deepEqual(Object.keys(savedParked.shop.pendingCheckouts), [`checkout:${transactionId}`]);
});

test('active before-core WAL load promotes recovered nested cash to the envelope exactly once', () => {
  const empire = ownedEmpire(27110);
  const raw = JSON.parse(serializeEmpire(empire));
  const state = activeState(empire);
  const transactionId = 'portfolio-load-before-core';
  const { openingCash } = interruptFifteenDollarSale(state, transactionId);
  const expectedCash = round2(openingCash + 15);
  const persistedActive = rawHolding(raw, raw.activeId).state;
  installCheckoutImage(persistedActive, state);

  assert.equal(raw.cash, openingCash, 'the envelope models the pre-recovery wallet');
  assert.equal(persistedActive.cash, openingCash);
  assert.equal(rowsFor(persistedActive, transactionId).sale.length, 0);
  assert.equal(rowsFor(persistedActive, transactionId).cogs.length, 0);
  assert.equal(rowsFor(persistedActive, transactionId).ticket.length, 0);

  const loaded = deserializeEmpire(raw);
  assert.equal(loaded.cash, expectedCash,
    'the envelope adopts the nested payment recovered during load');
  assertRecoveredFifteenDollarCheckout(activeState(loaded), transactionId, expectedCash);

  const loadedAgain = deserializeEmpire(serializeEmpire(loaded));
  assert.equal(loadedAgain.cash, expectedCash);
  assertRecoveredFifteenDollarCheckout(activeState(loadedAgain), transactionId, expectedCash);
});

test('active duplicate selection preserves the envelope wallet when a stale zero-cash copy comes first', () => {
  const empire = ownedEmpire(27115);
  const raw = JSON.parse(serializeEmpire(empire));
  const canonical = structuredClone(rawHolding(raw, raw.activeId));
  const expectedCash = canonical.state.cash;
  const stale = structuredClone(canonical);
  stale.state.cash = 0;
  raw.holdings = [stale, canonical];

  const first = deserializeEmpireWithReport(raw);
  const loadedActive = activeState(first.empire);
  assert.equal(first.report.recovered, true);
  assert.equal(first.empire.holdings.length, 1);
  assert.equal(first.empire.cash, expectedCash,
    'the persisted envelope wallet identifies the real active authority');
  assert.equal(loadedActive.cash, expectedCash);
  assert.notEqual(loadedActive.shop.pendingCheckoutsQuarantine?.active, true,
    'the discarded stale copy is never misclassified as parked authority');

  const second = deserializeEmpireWithReport(JSON.parse(serializeEmpire(first.empire)));
  assert.equal(second.report.recovered, false,
    'the canonical one-holding image is stable after one recovery');
  assert.equal(second.empire.cash, expectedCash);
  assert.notEqual(activeState(second.empire).shop.pendingCheckoutsQuarantine?.active, true);
});

test('an exact duplicate of the active holding collapses before parked wallet preflight', () => {
  const empire = ownedEmpire(27116);
  const raw = JSON.parse(serializeEmpire(empire));
  const canonical = rawHolding(raw, raw.activeId);
  const expectedCash = canonical.state.cash;
  raw.holdings.push(structuredClone(canonical));

  const loaded = deserializeEmpireWithReport(raw);
  assert.equal(loaded.report.recovered, true);
  assert.equal(loaded.empire.holdings.length, 1);
  assert.equal(loaded.empire.cash, expectedCash);
  assert.equal(activeState(loaded.empire).cash, expectedCash);
  assert.notEqual(activeState(loaded.empire).shop.pendingCheckoutsQuarantine?.active, true,
    'an identical duplicate cannot manufacture a parked-wallet conflict');
});

test('valid active settlement authority wins a wallet-consistent duplicate tie', () => {
  const empire = ownedEmpire(27117);
  const raw = JSON.parse(serializeEmpire(empire));
  const canonical = structuredClone(rawHolding(raw, raw.activeId));
  const malformed = structuredClone(canonical);
  delete malformed.state.shop.checkoutSettlementReceiptKeys;
  raw.holdings = [malformed, canonical];

  const loaded = deserializeEmpireWithReport(raw);
  assert.equal(loaded.report.recovered, true);
  assert.equal(loaded.empire.holdings.length, 1);
  assert.equal(loaded.empire.cash, canonical.state.cash);
  assert.notEqual(activeState(loaded.empire).shop.pendingCheckoutsQuarantine?.active, true);
  assert.deepEqual(
    activeState(loaded.empire).shop.checkoutSettlementReceiptKeys,
    canonical.state.shop.checkoutSettlementReceiptKeys,
    'the complete checkout authority is retained instead of the malformed first copy',
  );
});

test('parked wallet conflict blocks active WAL recovery during portfolio load', () => {
  const empire = ownedEmpire(27114, { two: true });
  const raw = JSON.parse(serializeEmpire(empire));
  const state = activeState(empire);
  const transactionId = 'portfolio-load-active-behind-parked-conflict';
  const { openingCash } = interruptFifteenDollarSale(state, transactionId);
  const persistedActive = rawHolding(raw, raw.activeId).state;
  installCheckoutImage(persistedActive, state);
  const pendingBefore = structuredClone(persistedActive.shop.pendingCheckouts);
  const parkedPropertyId = raw.holdings.find(
    (holding) => holding.property.id !== raw.activeId,
  ).property.id;
  const persistedParked = rawHolding(raw, parkedPropertyId).state;
  persistedParked.cash = 75;
  assert.equal(raw.holdings[0].property.id, raw.activeId,
    'the active holding deliberately precedes the parked conflict in the raw image');
  assert.equal(raw.cash, openingCash);
  assert.equal(rowsFor(persistedActive, transactionId).sale.length, 0);

  const loaded = deserializeEmpire(raw);
  const loadedActive = activeState(loaded);
  const loadedParked = loaded.holdings.find(
    (holding) => holding.property.id === parkedPropertyId,
  ).state;

  assert.equal(loaded.cash, openingCash,
    'a blocked load cannot advance the envelope wallet');
  assert.equal(loadedActive.cash, openingCash,
    'parked authority is preflighted before active cash can reconcile');
  assert.deepEqual(loadedActive.shop.pendingCheckouts, pendingBefore,
    'the active WAL stays available and wholly unreconciled');
  assert.equal(rowsFor(loadedActive, transactionId).sale.length, 0);
  assert.equal(rowsFor(loadedActive, transactionId).cogs.length, 0);
  assert.equal(rowsFor(loadedActive, transactionId).ticket.length, 0);
  assert.equal(receiptRowsFor(loadedActive, transactionId).length, 0);
  assert.equal(loadedParked.cash, 75,
    'the conflicting parked wallet remains preserved as evidence');
  assert.equal(loadedParked.shop.pendingCheckoutsQuarantine?.active, true);
});

test('active after-core WAL load promotes committed nested cash without reposting it', () => {
  const empire = ownedEmpire(27111);
  const raw = JSON.parse(serializeEmpire(empire));
  const state = activeState(empire);
  const transactionId = 'portfolio-load-after-core';
  const { openingCash } = interruptFifteenDollarSaleAfterCore(state, transactionId);
  const expectedCash = round2(openingCash + 15);
  const persistedActive = rawHolding(raw, raw.activeId).state;
  installCheckoutImage(persistedActive, state);

  assert.equal(raw.cash, openingCash, 'the portfolio envelope is deliberately stale');
  assert.equal(persistedActive.cash, expectedCash,
    'the nested core already contains the committed payment');
  assert.equal(rowsFor(persistedActive, transactionId).sale.length, 1);
  assert.equal(rowsFor(persistedActive, transactionId).cogs.length, 1);
  assert.equal(rowsFor(persistedActive, transactionId).ticket.length, 0,
    'the interrupted tail has not published its ticket');

  const loaded = deserializeEmpire(raw);
  assert.equal(loaded.cash, expectedCash,
    'the stale envelope cannot overwrite the recovered nested authority');
  assertRecoveredFifteenDollarCheckout(activeState(loaded), transactionId, expectedCash);

  const loadedAgain = deserializeEmpire(serializeEmpire(loaded));
  assert.equal(loadedAgain.cash, expectedCash);
  assertRecoveredFifteenDollarCheckout(activeState(loadedAgain), transactionId, expectedCash);
});

test('malformed active WAL makes serialization fail without altering live evidence', () => {
  const empire = ownedEmpire(27112);
  const state = activeState(empire);
  const transactionId = 'portfolio-malformed-active-save';
  interruptFifteenDollarSale(state, transactionId);
  state.shop.pendingCheckouts[`checkout:${transactionId}`].signature = 'corrupt-active-signature';
  const envelopeCashBefore = empire.cash;
  const evidenceBefore = checkoutEvidenceBytes(state);

  assert.throws(
    () => serializeEmpire(empire),
    /checkout|settlement|journal/i,
  );
  assert.equal(empire.cash, envelopeCashBefore,
    'a refused save cannot pull a partial or repaired wallet into the envelope');
  assert.equal(checkoutEvidenceBytes(state), evidenceBefore,
    'cash, WAL, ledger, inventory, and ticket evidence remain byte-for-byte unchanged');
});

test('blocked target WAL is preflighted before an active checkout can reconcile', () => {
  const empire = ownedEmpire(27113, { two: true });
  const active = activeState(empire);
  const target = empire.holdings.find((holding) => holding.property.id === 'bent-pines').state;
  const activeId = 'portfolio-blocked-target-active';
  const targetId = 'portfolio-blocked-target-parked';
  const { openingCash } = interruptFifteenDollarSale(active, activeId);
  interruptFifteenDollarSale(target, targetId);
  const envelopeCashBefore = empire.cash;
  const activeEvidenceBefore = checkoutEvidenceBytes(active);
  const targetEvidenceBefore = checkoutEvidenceBytes(target);

  const switched = switchProperty(empire, 'bent-pines');
  assert.equal(switched.ok, false);
  assert.match(switched.reason, /checkout/i);
  assert.equal(empire.activeId, 'willow-creek');
  assert.equal(empire.cash, envelopeCashBefore);
  assert.equal(active.cash, openingCash,
    'a target-side block cannot leave active cash ahead of the envelope');
  assert.equal(checkoutEvidenceBytes(active), activeEvidenceBefore,
    'the active WAL remains wholly uncommitted when the target is blocked');
  assert.equal(checkoutEvidenceBytes(target), targetEvidenceBefore,
    'the parked target evidence is untouched');
  assert.equal(rowsFor(active, activeId).sale.length, 0);
  assert.equal(rowsFor(active, activeId).cogs.length, 0);
  assert.equal(rowsFor(active, activeId).ticket.length, 0);
});

test('a quarantined parked checkout globally blocks unrelated active sale and purchase', () => {
  const outcomes = [];
  for (const [index, operation] of ['sell-active', 'buy-listing'].entries()) {
    const empire = ownedEmpire(27120 + index, { two: true });
    const active = activeState(empire);
    const parked = empire.holdings.find((holding) => holding.property.id === 'bent-pines').state;
    const listing = empire.market[0];
    const affordableCash = Math.max(empire.cash, listing.askingPrice + 10_000);
    empire.cash = affordableCash;
    active.cash = affordableCash;
    interruptFifteenDollarSale(parked, `portfolio-global-block-${operation}`);
    quarantineCheckoutWal(parked, `portfolio-global-block-${operation}`);
    const before = portfolioAuthorityBytes(empire);
    const activeEvidenceBefore = checkoutEvidenceBytes(active);
    const parkedEvidenceBefore = checkoutEvidenceBytes(parked);
    const result = operation === 'sell-active'
      ? sellProperty(empire, empire.activeId)
      : buyProperty(empire, listing.id);
    outcomes.push({
      operation,
      result,
      before,
      after: portfolioAuthorityBytes(empire),
      activeEvidenceBefore,
      activeEvidenceAfter: checkoutEvidenceBytes(active),
      parkedEvidenceBefore,
      parkedEvidenceAfter: checkoutEvidenceBytes(parked),
      envelopeCash: empire.cash,
      activeCash: active.cash,
    });
  }

  for (const outcome of outcomes) {
    assert.equal(outcome.result.ok, false, `${outcome.operation} must fail closed`);
    assert.match(outcome.result.reason, /checkout/i);
    assert.equal(outcome.after, outcome.before,
      `${outcome.operation} cannot mutate cash, market, holdings, or checkout authority`);
    assert.equal(outcome.activeEvidenceAfter, outcome.activeEvidenceBefore);
    assert.equal(outcome.parkedEvidenceAfter, outcome.parkedEvidenceBefore);
    assert.equal(outcome.envelopeCash, outcome.activeCash,
      `${outcome.operation} cannot create an active/envelope wallet divergence`);
  }
});

test('syncWallet only mirrors authoritative active cash and never reconciles checkout evidence', () => {
  const recoverableEmpire = ownedEmpire(27130);
  const recoverable = activeState(recoverableEmpire);
  interruptFifteenDollarSale(recoverable, 'portfolio-sync-recoverable');
  const recoverableCash = recoverable.cash;
  recoverableEmpire.cash = round2(recoverableCash - 123);
  const recoverableBefore = checkoutEvidenceBytes(recoverable);

  const recoveredWallet = syncWallet(recoverableEmpire);
  assert.equal(recoveredWallet, recoverableCash);
  assert.equal(recoverableEmpire.cash, recoverableCash);
  assert.equal(checkoutEvidenceBytes(recoverable), recoverableBefore,
    'a HUD wallet read cannot finish a recoverable sale');

  const quarantinedEmpire = ownedEmpire(27131);
  const quarantined = activeState(quarantinedEmpire);
  const transactionId = 'portfolio-sync-quarantined';
  interruptFifteenDollarSale(quarantined, transactionId);
  quarantined.shop.pendingCheckouts[`checkout:${transactionId}`].signature = 'corrupt-sync-signature';
  quarantineCheckoutWal(quarantined, 'portfolio-sync-quarantined');
  const quarantinedCash = quarantined.cash;
  quarantinedEmpire.cash = round2(quarantinedCash - 321);
  const quarantinedBefore = checkoutEvidenceBytes(quarantined);

  const quarantinedWallet = syncWallet(quarantinedEmpire);
  assert.equal(quarantinedWallet, quarantinedCash,
    'even quarantined checkout evidence cannot make the UI return a stale envelope');
  assert.equal(quarantinedEmpire.cash, quarantinedCash);
  assert.equal(checkoutEvidenceBytes(quarantined), quarantinedBefore);
});

test('historical parked terminal cash is quarantined and preserved across switch and resave', () => {
  const empire = ownedEmpire(27140, { two: true });
  const cleanRaw = JSON.parse(serializeEmpire(empire));
  const parked = empire.holdings.find((holding) => holding.property.id === 'bent-pines');
  const transactionId = 'portfolio-historical-parked-terminal';
  const { openingCash } = interruptFifteenDollarSale(parked.state, transactionId);
  const terminalImage = structuredClone(snapshot(parked.state));
  const parkedCash = round2(openingCash + 15);
  assert.equal(openingCash, 0, 'a normally parked club starts without a local wallet');
  assertRecoveredFifteenDollarCheckout(terminalImage, transactionId, parkedCash);
  rawHolding(cleanRaw, 'bent-pines').state = terminalImage;
  const envelopeCash = cleanRaw.cash;

  const loaded = deserializeEmpire(cleanRaw);
  const loadedParked = loaded.holdings.find((holding) => holding.property.id === 'bent-pines').state;
  assert.equal(loaded.cash, envelopeCash);
  assert.equal(loadedParked.cash, parkedCash,
    'historical nested wallet authority is evidence and cannot be erased');
  assert.equal(loadedParked.shop.pendingCheckoutsQuarantine?.active, true);
  assert.equal(
    loadedParked.shop.pendingCheckoutsQuarantine?.reason,
    'parked-wallet-authority-conflict',
  );
  assertRecoveredFifteenDollarCheckout(loadedParked, transactionId, parkedCash);

  const beforeMutations = portfolioAuthorityBytes(loaded);
  const switched = switchProperty(loaded, 'bent-pines');
  const sold = sellProperty(loaded, 'bent-pines');
  assert.equal(switched.ok, false);
  assert.match(switched.reason, /checkout/i);
  assert.equal(sold.ok, false);
  assert.match(sold.reason, /checkout/i);
  assert.equal(portfolioAuthorityBytes(loaded), beforeMutations,
    'blocked portfolio actions cannot overwrite or monetize the nested wallet');

  const savedAgain = JSON.parse(serializeEmpire(loaded));
  const savedParked = rawHolding(savedAgain, 'bent-pines').state;
  assert.equal(savedAgain.cash, envelopeCash);
  assert.equal(savedParked.cash, parkedCash);
  assert.equal(savedParked.shop.pendingCheckoutsQuarantine?.active, true);
  assertRecoveredFifteenDollarCheckout(savedParked, transactionId, parkedCash);

  const loadedAgain = deserializeEmpire(savedAgain);
  const parkedAgain = loadedAgain.holdings.find((holding) => holding.property.id === 'bent-pines').state;
  assert.equal(loadedAgain.cash, envelopeCash);
  assert.equal(parkedAgain.cash, parkedCash);
  assert.equal(parkedAgain.shop.pendingCheckoutsQuarantine?.active, true);
  assertRecoveredFifteenDollarCheckout(parkedAgain, transactionId, parkedCash);
});

test('malformed parked WAL remains available as quarantine evidence across resave', () => {
  const empire = ownedEmpire(27141, { two: true });
  const cleanRaw = JSON.parse(serializeEmpire(empire));
  const parked = empire.holdings.find((holding) => holding.property.id === 'bent-pines').state;
  const transactionId = 'portfolio-malformed-parked-evidence';
  interruptFifteenDollarSale(parked, transactionId);
  const settlementId = `checkout:${transactionId}`;
  parked.shop.pendingCheckouts[settlementId].signature = 'corrupt-parked-signature';
  const malformedJournal = structuredClone(parked.shop.pendingCheckouts);
  installCheckoutImage(rawHolding(cleanRaw, 'bent-pines').state, parked);
  const envelopeCash = cleanRaw.cash;

  const loaded = deserializeEmpire(cleanRaw);
  const loadedParked = loaded.holdings.find((holding) => holding.property.id === 'bent-pines').state;
  assert.equal(loaded.cash, envelopeCash);
  assert.equal(loadedParked.cash, 0);
  assert.deepEqual(loadedParked.shop.pendingCheckouts, {},
    'an invalid plan must never enter the operative reconciler');
  assert.equal(loadedParked.shop.pendingCheckoutsQuarantine?.active, true);
  assert.deepEqual(
    loadedParked.shop.pendingCheckoutsQuarantine?.evidence?.pendingCheckouts,
    malformedJournal,
    'the original malformed journal remains available for manual repair',
  );
  assert.equal(rowsFor(loadedParked, transactionId).sale.length, 0);
  assert.equal(rowsFor(loadedParked, transactionId).cogs.length, 0);
  assert.equal(rowsFor(loadedParked, transactionId).ticket.length, 0);

  const beforeSwitch = checkoutEvidenceBytes(loadedParked);
  const switched = switchProperty(loaded, 'bent-pines');
  assert.equal(switched.ok, false);
  assert.match(switched.reason, /checkout/i);
  assert.equal(loaded.cash, envelopeCash);
  assert.equal(loadedParked.cash, 0);
  assert.equal(checkoutEvidenceBytes(loadedParked), beforeSwitch);

  const savedAgain = JSON.parse(serializeEmpire(loaded));
  const savedParked = rawHolding(savedAgain, 'bent-pines').state;
  assert.equal(savedAgain.cash, envelopeCash);
  assert.equal(savedParked.cash, 0);
  assert.deepEqual(
    savedParked.shop.pendingCheckoutsQuarantine?.evidence?.pendingCheckouts,
    malformedJournal,
  );

  const loadedAgain = deserializeEmpire(savedAgain);
  const parkedAgain = loadedAgain.holdings.find((holding) => holding.property.id === 'bent-pines').state;
  assert.equal(loadedAgain.cash, envelopeCash);
  assert.equal(parkedAgain.cash, 0);
  assert.deepEqual(parkedAgain.shop.pendingCheckouts, {});
  assert.deepEqual(
    parkedAgain.shop.pendingCheckoutsQuarantine?.evidence?.pendingCheckouts,
    malformedJournal,
  );
  assert.equal(rowsFor(parkedAgain, transactionId).sale.length, 0);
  assert.equal(rowsFor(parkedAgain, transactionId).cogs.length, 0);
  assert.equal(rowsFor(parkedAgain, transactionId).ticket.length, 0);
});
