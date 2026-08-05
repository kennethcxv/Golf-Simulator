import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  acceptCash,
  createTx,
  depositTendered,
  drawerContents,
  handOverChange,
  insertCard,
  makeChange,
  newDrawer,
  openDrawer,
  presentCard,
  recoverCashAcceptedCheckpoint,
  recoverUnresolvedCardAuthorization,
  requestPayment,
  scanItem,
  submitCardAmount,
  enterCardDigit,
  totalOf,
  takeFromDrawer,
} from '../src/sim/register.js';
import {
  CHECKOUT_STATES,
  abandonCheckoutRecovery,
  checkoutStateTimedOut,
  createCheckoutFlow,
  resolveCheckoutRecoveryTarget,
  transitionCheckout,
} from '../src/sim/registerFlow.js';
import { SIMPLIFIED_REGISTER_WATCHDOG_STATES } from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

const item = (uid = 'watchdog-item', price = 12) => ({
  uid,
  skuId: 'balls3',
  name: 'Watchdog dozen',
  price,
});

function readyTx(prefer, price = 12) {
  const tx = createTx({ items: [item('watchdog-item', price)], prefer, rng: () => 0.9 });
  assert.equal(scanItem(tx, 'watchdog-item').ok, true);
  assert.equal(requestPayment(tx).ok, true);
  return tx;
}

function takeStack(tx, drawer, stack) {
  for (const [rawDenom, count] of Object.entries(stack)) {
    for (let index = 0; index < count; index += 1) {
      assert.equal(takeFromDrawer(tx, drawer, Number(rawDenom)).ok, true);
    }
  }
}

test('unresolved card authorization rolls back without inventing a result or changing attempt identity', () => {
  const tx = readyTx('card');
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  // the reader opens at 0.00 — the operator keys the total before confirming
  for (const digit of String(Math.round(totalOf(tx) * 100))) {
    assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
  }
  assert.equal(submitCardAmount(tx).ok, true);
  tx.cardAttempts = 2;
  tx.cardsTried = 3;

  const basketBefore = structuredClone(tx.items);
  const financialBefore = {
    method: tx.method,
    banked: tx.banked,
    drawerStart: tx.drawerStart,
    drawerPending: tx.drawerPending,
  };
  const recovered = recoverUnresolvedCardAuthorization(tx);

  assert.deepEqual(recovered, {
    ok: true,
    stage: 'card-present',
    cardAttempts: 2,
    cardsTried: 3,
  });
  assert.equal(tx.stage, 'card-present');
  assert.equal(tx.cardResult, null);
  assert.equal(tx.cardEntryCents, 0);
  assert.equal(tx.cardEntryDigits, '');
  assert.equal(tx.cardEntryError, null);
  assert.equal(tx.cardAttempts, 2);
  assert.equal(tx.cardsTried, 3);
  assert.deepEqual(tx.items, basketBefore);
  assert.deepEqual({
    method: tx.method,
    banked: tx.banked,
    drawerStart: tx.drawerStart,
    drawerPending: tx.drawerPending,
  }, financialBefore);
  assert.equal(recoverUnresolvedCardAuthorization(tx).ok, false,
    'the same in-flight request cannot be rolled back twice');
});

test('cash watchdog rebuilds from accepted tender and the transaction-local opening journal only', () => {
  const persistentDrawer = newDrawer();
  const persistentBefore = structuredClone(persistentDrawer);
  const tx = readyTx('cash', 12);
  tx.tendered = makeChange(20);
  assert.equal(acceptCash(tx).ok, true);
  const acceptedTender = structuredClone(tx.acceptedTender);
  assert.equal(openDrawer(tx).ok, true);
  assert.equal(depositTendered(tx, persistentDrawer).ok, true);
  takeStack(tx, persistentDrawer, makeChange(8));
  assert.notDeepEqual(drawerContents(tx, persistentDrawer), persistentBefore,
    'the interrupted transaction has a changed local drawer journal');

  const recovered = recoverCashAcceptedCheckpoint(tx, persistentDrawer);

  assert.equal(recovered.ok, true);
  assert.equal(tx.stage, 'cash-drawer');
  assert.equal(tx.drawerOpen, false);
  assert.equal(tx.deposited, false);
  assert.deepEqual(tx.tendered, acceptedTender);
  assert.deepEqual(tx.acceptedTender, acceptedTender);
  assert.deepEqual(tx.drawerStart, persistentBefore);
  assert.deepEqual(tx.drawerPending, persistentBefore);
  assert.deepEqual(tx.hand, {});
  assert.equal(tx.changeGiven, null);
  assert.equal(tx.lost, 0);
  assert.deepEqual(persistentDrawer, persistentBefore,
    'watchdog recovery never commits to the persistent drawer');

  assert.equal(openDrawer(tx).ok, true);
  assert.equal(depositTendered(tx, persistentDrawer).ok, true);
  takeStack(tx, persistentDrawer, makeChange(8));
  assert.equal(handOverChange(tx, persistentDrawer).ok, true,
    'the rebuilt local journal resumes through the normal cash verbs');
  assert.equal(tx.stage, 'receipt');
  assert.deepEqual(persistentDrawer, persistentBefore,
    'even a resumed payment stays local until completeSale');
});

test('the live register watchdog covers bounded active states and excludes untimed waits', () => {
  const expectedActiveRegisterStates = [
    'EnteringCashierMode',
    'ProductHeld', 'ProductScanning', 'ProductScanned',
    'AllProductsScanned', 'ChoosingPayment',
    'CardPresented', 'CardInserting', 'CardProcessing', 'CardApproved',
    'CashAccepted', 'DrawerOpening', 'DepositingCash', 'GivingChange',
    'PaymentComplete', 'ReceiptPrinting', 'Bagging', 'BagHandoff', 'CustomerLeaving',
  ];
  assert.deepEqual(SIMPLIFIED_REGISTER_WATCHDOG_STATES, expectedActiveRegisterStates);
  for (const state of SIMPLIFIED_REGISTER_WATCHDOG_STATES) {
    assert.equal(Number.isFinite(CHECKOUT_STATES[state].timeout.seconds), true,
      `${state} must have a finite contract watchdog`);
    assert.equal(CHECKOUT_STATES[state].timeout.action, 'enter-recovery');
  }

  for (const state of [
    // CardInsertReady joined this group on 2026-08-03: the offered card waits in
    // the customer's hand for a player click, and the 4-second watchdog it kept
    // from the old automatic route was killing live sales (A1).
    'WaitingForScan', 'CardInsertReady', 'CardAmountEntry',
    'CardDeclined', 'CashPresented', 'SelectingChange',
    'TransactionComplete', 'Recovery',
  ]) {
    assert.equal(SIMPLIFIED_REGISTER_WATCHDOG_STATES.includes(state), false,
      `${state} is an intentional untimed wait/terminal state`);
    assert.equal(CHECKOUT_STATES[state].timeout.seconds, null);
  }

  for (const state of ['CustomerApproaching', 'CustomerPlacingProducts', 'WaitingForCashier']) {
    assert.equal(SIMPLIFIED_REGISTER_WATCHDOG_STATES.includes(state), false,
      `${state} is owned by the outer customer/queue lifecycle, not active register animation`);
    assert.equal(Number.isFinite(CHECKOUT_STATES[state].timeout.seconds), true);
  }
});

test('an already-active cashier advances the next queued owner through cashier entry', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  const helperStart = source.indexOf('  function beginCashierEntry(event) {');
  const helperEnd = source.indexOf('\n  function poseBetween(', helperStart);
  const beginStart = source.indexOf('  function begin(customer) {');
  const beginEnd = source.indexOf('\n  function beginReservationPayment(', beginStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  assert.ok(beginStart >= 0 && beginEnd > beginStart);
  const helper = source.slice(helperStart, helperEnd);
  const begin = source.slice(beginStart, beginEnd);

  assert.match(helper, /checkoutFlowState\(\) !== 'WaitingForCashier'/);
  assert.match(helper, /flowTo\('EnteringCashierMode', event\)/);
  assert.match(helper, /enterTimer = 0\.30/,
    'the normal camera/input settling beat remains between queued owners');
  assert.match(begin, /if \(active\) beginCashierEntry\('active-cashier-accepted-next-queued-customer'\)/,
    'a fresh queue owner cannot remain in WaitingForCashier while the till is already open');
});

test('live delivery holds BagHandoff and CustomerLeaving around their physical windows', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  const deliveryStart = source.indexOf('  function beginBagDeliveryOrRelease() {');
  const deliveryEnd = source.indexOf('\n  function updateCashMotions(dt) {', deliveryStart);
  const finalizeStart = source.indexOf('  function finalizeTransaction() {');
  const finalizeEnd = source.indexOf('\n  function handleMonitorAction(action) {', finalizeStart);
  assert.ok(deliveryStart >= 0 && deliveryEnd > deliveryStart);
  assert.ok(finalizeStart >= 0 && finalizeEnd > finalizeStart);
  const delivery = source.slice(deliveryStart, deliveryEnd);
  const finalize = source.slice(finalizeStart, finalizeEnd);

  const bagHandoff = delivery.indexOf("'BagHandoff'");
  const bagMotion = delivery.indexOf("deliveryPhase = 'bag-deliver'");
  const customerHold = delivery.indexOf("deliveryPhase = 'bag-customer-hold'");
  const customerLeaving = delivery.indexOf(
    "flowTo('CustomerLeaving', 'customer-held-bag-acceptance-beat-complete')",
  );
  const release = delivery.lastIndexOf("deliveryPhase = 'released'");
  assert.ok(bagHandoff >= 0 && bagHandoff < bagMotion,
    'BagHandoff must begin before the physical bag starts moving');
  assert.ok(bagMotion < customerHold && customerHold < customerLeaving,
    'the bag must reach a readable customer-owned hold before departure');
  assert.ok(customerLeaving >= 0 && customerLeaving < release,
    'CustomerLeaving must begin after the customer-owned bag hold');
  assert.match(delivery, /checkoutFlowState\(\) !== 'BagHandoff'\) return false/,
    'delivery must fail closed if the physical flow never reached BagHandoff');
  assert.match(delivery,
    /checkoutFlowState\(\) !== 'BagHandoff'[\s\S]*!flowTo\('CustomerLeaving',[\s\S]*\)\) return;/,
    'customer goods cannot be marked released when the departure transition is rejected');
  assert.match(finalize, /checkoutFlowState\(\) !== 'CustomerLeaving'/,
    'banking must require the held CustomerLeaving checkpoint');
  assert.doesNotMatch(finalize, /flowTo\('BagHandoff'|flowTo\('CustomerLeaving'/,
    'finalize must not traverse timed physical states synchronously');
});

test('a customer arriving while the cashier remains active enters the normal scan flow', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  const beginStart = source.indexOf('  function begin(customer) {');
  const beginEnd = source.indexOf('\n  function beginReservationPayment(', beginStart);
  assert.ok(beginStart >= 0 && beginEnd > beginStart);
  const begin = source.slice(beginStart, beginEnd);

  assert.match(begin,
    /if \(active\) beginCashierEntry\('active-cashier-accepted-next-queued-customer'\)/,
    'an already-active cashier must route the new customer through the canonical entry helper');
  assert.match(source,
    /function beginCashierEntry\(event\) \{[\s\S]*checkoutFlowState\(\) !== 'WaitingForCashier'[\s\S]*flowTo\('EnteringCashierMode', event\)[\s\S]*enterTimer = 0\.30/,
    'the canonical helper must retain the visible entry beat before WaitingForScan');
});

// A1 — THE CARD READER LOCKED OUT MID-SALE (playtest 2026-08-03).
//
// Measured with tools/qa/checkout-card-lockout.js, which runs the identical
// four-item $300.56 card sale twice and varies only how long the player takes
// to click the offered card. At 400 ms it reached CardAmountEntry; at 6000 ms
// the flow entered Recovery with cause "timeout:CardInsertReady", the reconcile
// failed ("Card presentation recovery has no unresolved card"), and from there
// the card click, the reader's X and every other verb were refused. The item
// count and the amount were held constant, so the trigger is TIME.
//
// Two defects, pinned separately below because either one alone is enough to
// kill a sale.

test('a state that waits for the player click cannot be timed out from under them', () => {
  // The card route used to insert on a timer. When it became "the offered card
  // waits in the customer's hand until it is clicked", the machine-speed
  // watchdog stayed behind.
  assert.equal(CHECKOUT_STATES.CardInsertReady.timeout.seconds, null,
    'CardInsertReady waits for a deliberate human action, exactly like CardAmountEntry');
  assert.equal(CHECKOUT_STATES.CardAmountEntry.timeout.seconds, null,
    'the state this reasoning was already applied to');
  // …and the machine-driven neighbours keep theirs, or a genuinely stalled
  // insertion would have no watchdog at all.
  assert.ok(Number.isFinite(CHECKOUT_STATES.CardInserting.timeout.seconds),
    'CardInserting is animation-driven and must stay watched');
  assert.ok(Number.isFinite(CHECKOUT_STATES.CardProcessing.timeout.seconds),
    'CardProcessing is authorization-driven and must stay watched');
});

test('the offered card survives a player who takes a long look at it', () => {
  // The exact predicate the renderer's watchdog calls, at the delay that killed
  // the reported sale and well beyond it.
  const flow = createCheckoutFlow({ state: 'CardInsertReady', nowMs: 1000 });
  assert.equal(checkoutStateTimedOut(flow, 1000 + 6000), false,
    'six seconds of looking for the card is not a fault');
  assert.equal(checkoutStateTimedOut(flow, 1000 + 120000), false,
    'nor is two minutes - the offer is the customer standing there holding it out');
});

test('a recovery the renderer cannot reconcile can always be let go', () => {
  // Reproduce the trap: enter Recovery from a card state, then confirm the
  // stored resume state really is the only legal exit.
  const flow = createCheckoutFlow({ state: 'CardInsertReady', nowMs: 0 });
  const entered = transitionCheckout(flow, 'Recovery', {
    nowMs: 10, event: 'timeout:CardInsertReady', facts: { paymentAuthorized: false },
  });
  assert.equal(entered.ok, true);
  assert.equal(entered.flow.recovery.resumeState, 'CardPresented');
  assert.equal(
    transitionCheckout(entered.flow, 'AllProductsScanned', { nowMs: 20 }).ok, false,
    'the trap: Recovery permits only its stored resume state, so a checkpoint the '
    + 'renderer cannot rebuild left every later verb refused',
  );

  const released = abandonCheckoutRecovery(entered.flow, {
    nowMs: 20,
    facts: { paymentAuthorized: false, allProductsScanned: true, allScannedItemsStaged: true },
  });
  assert.equal(released.ok, true);
  assert.equal(released.flow.state, 'AllProductsScanned',
    'an unauthorized sale drops back to the scanned basket - the same place the reader X lands');
  assert.equal(released.flow.recovery, null, 'and it is no longer in recovery at all');

  // A basket that is not fully rung up goes back to scanning instead.
  const partial = abandonCheckoutRecovery(entered.flow, {
    nowMs: 20,
    facts: { paymentAuthorized: false, allProductsScanned: false, allScannedItemsStaged: false },
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.flow.state, 'WaitingForScan');
});

test('letting go is refused for anything that has already taken money', () => {
  const flow = createCheckoutFlow({ state: 'CardProcessing', nowMs: 0 });
  const entered = transitionCheckout(flow, 'Recovery', {
    nowMs: 10, event: 'timeout:CardProcessing', facts: { paymentAuthorized: true },
  });
  assert.equal(entered.ok, true);
  const released = abandonCheckoutRecovery(entered.flow, {
    nowMs: 20, facts: { paymentAuthorized: true, allProductsScanned: true, allScannedItemsStaged: true },
  });
  assert.equal(released.ok, false,
    'an authorized payment must reconcile; it may never be dropped back to scanning');
  assert.match(released.reason, /authorized/i);
  // and it is not a way to escape a healthy flow either
  const healthy = createCheckoutFlow({ state: 'CardAmountEntry', nowMs: 0 });
  assert.equal(abandonCheckoutRecovery(healthy, { nowMs: 1, facts: {} }).ok, false,
    'only a flow actually parked in Recovery may be released');
});

test('a card the customer is still holding out counts as an unresolved card', () => {
  // The reconcile adapter demanded stage 'card-present'. At CardInsertReady the
  // domain has already advanced to 'card-ready' — presentCard() ran the moment
  // the presentation beat landed — so the CardPresented checkpoint could never
  // be rebuilt. Build the real domain state and show the mismatch is genuine.
  const tx = readyTx('card');
  assert.equal(tx.stage, 'card-present');
  assert.equal(presentCard(tx).ok, true);
  assert.equal(tx.stage, 'card-ready',
    'the stage the renderer is actually in while the offer is held out');
  assert.equal(resolveCheckoutRecoveryTarget('CardInsertReady', { paymentAuthorized: false }),
    'CardPresented', 'and the checkpoint it is asked to rebuild');

  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  assert.match(source,
    /!\['card-present', 'card-ready'\]\.includes\(tx\.stage\)/,
    'so the adapter must accept both stages');
});
