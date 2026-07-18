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
  takeFromDrawer,
} from '../src/sim/register.js';
import { CHECKOUT_STATES } from '../src/sim/registerFlow.js';
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

test('the live register watchdog covers automatic states and excludes deliberate player waits', () => {
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

test('live delivery holds BagHandoff and CustomerLeaving around their physical windows', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  );
  const deliveryStart = source.indexOf('  function updateDelivery(dt) {');
  const deliveryEnd = source.indexOf('\n  function updateCashMotions(dt) {', deliveryStart);
  const finalizeStart = source.indexOf('  function finalizeTransaction() {');
  const finalizeEnd = source.indexOf('\n  function handleMonitorAction(action) {', finalizeStart);
  assert.ok(deliveryStart >= 0 && deliveryEnd > deliveryStart);
  assert.ok(finalizeStart >= 0 && finalizeEnd > finalizeStart);
  const delivery = source.slice(deliveryStart, deliveryEnd);
  const finalize = source.slice(finalizeStart, finalizeEnd);

  const bagHandoff = delivery.indexOf("flowTo(\n            'BagHandoff'");
  const bagMotion = delivery.indexOf("deliveryPhase = 'bag-deliver'");
  const customerLeaving = delivery.indexOf("flowTo('CustomerLeaving', 'physical-bag-reached-customer')");
  const release = delivery.lastIndexOf("deliveryPhase = 'released'");
  assert.ok(bagHandoff >= 0 && bagHandoff < bagMotion,
    'BagHandoff must begin before the physical bag starts moving');
  assert.ok(customerLeaving >= 0 && customerLeaving < release,
    'CustomerLeaving must begin when the physical bag reaches the customer');
  assert.match(finalize, /checkoutFlowState\(\) !== 'CustomerLeaving'/,
    'banking must require the held CustomerLeaving checkpoint');
  assert.doesNotMatch(finalize, /flowTo\('BagHandoff'|flowTo\('CustomerLeaving'/,
    'finalize must not traverse timed physical states synchronously');
});
