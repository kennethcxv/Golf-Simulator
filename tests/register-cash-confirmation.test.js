import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  cashConfirmationReadiness,
  cashDrawerOpeningCatchupPath,
  paidCheckoutCatchupPath,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

const modeSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

test('cash confirmation waits for the physical drawer flow before handing over change', () => {
  assert.equal(cashConfirmationReadiness('WaitingForScan'), 'defer');
  assert.equal(cashConfirmationReadiness('ProductHeld'), 'defer');
  assert.equal(cashConfirmationReadiness('ProductScanning'), 'defer');
  assert.equal(cashConfirmationReadiness('ProductScanned'), 'defer');
  assert.equal(cashConfirmationReadiness('AllProductsScanned'), 'defer');
  assert.equal(cashConfirmationReadiness('ChoosingPayment'), 'defer');
  assert.equal(cashConfirmationReadiness('CashPresented'), 'defer');
  assert.equal(cashConfirmationReadiness('CashAccepted'), 'defer');
  assert.equal(cashConfirmationReadiness('DrawerOpening'), 'defer');
  assert.equal(cashConfirmationReadiness('DepositingCash'), 'defer');
  assert.equal(cashConfirmationReadiness('SelectingChange'), 'ready');
  assert.equal(cashConfirmationReadiness('GivingChange'), 'reject');
  assert.equal(cashConfirmationReadiness('ReceiptPrinting'), 'reject');
  assert.equal(cashConfirmationReadiness(null), 'reject');
});

test('a deposited cash transaction catches up to the physical drawer opening legally', () => {
  assert.deepEqual(cashDrawerOpeningCatchupPath('WaitingForScan'), [
    'ProductHeld', 'ProductScanning', 'ProductScanned', 'AllProductsScanned',
    'ChoosingPayment', 'CashPresented', 'CashAccepted', 'DrawerOpening',
  ]);
  assert.deepEqual(cashDrawerOpeningCatchupPath('AllProductsScanned'), [
    'ChoosingPayment', 'CashPresented', 'CashAccepted', 'DrawerOpening',
  ]);
  assert.deepEqual(cashDrawerOpeningCatchupPath('CashPresented'), [
    'CashAccepted', 'DrawerOpening',
  ]);
  assert.deepEqual(cashDrawerOpeningCatchupPath('CashAccepted'), ['DrawerOpening']);
  assert.deepEqual(cashDrawerOpeningCatchupPath('DrawerOpening'), []);
  assert.deepEqual(cashDrawerOpeningCatchupPath('DepositingCash'), []);
  assert.deepEqual(cashDrawerOpeningCatchupPath('SelectingChange'), []);
  assert.equal(cashDrawerOpeningCatchupPath('CardPresented'), null);
});

test('an early confirm is replayed only after the drawer reaches SelectingChange', () => {
  const confirmStart = modeSource.indexOf('  function confirmChange(automatic = false) {');
  const confirmEnd = modeSource.indexOf('\n  // --- THE PHYSICAL RECEIPT', confirmStart);
  const confirm = modeSource.slice(confirmStart, confirmEnd);
  const defer = confirm.indexOf("if (readiness === 'defer')");
  const pending = confirm.indexOf('pendingChangeConfirmation = { automatic };');
  const catchup = confirm.indexOf('cashDrawerOpeningCatchupPath(checkoutFlowState())');
  const handoff = confirm.indexOf('const handed = handOverChange(tx, drawer);');
  assert.ok(defer >= 0 && pending > defer && catchup > pending && handoff > catchup,
    'early confirmation must queue before any domain or physical handoff');

  const updateStart = modeSource.indexOf('  function updateDrawer(dt) {');
  const updateEnd = modeSource.indexOf('\n  // Which preset', updateStart);
  const update = modeSource.slice(updateStart, updateEnd);
  const selecting = update.indexOf("flowTo('SelectingChange', 'all-received-cash-secured')");
  const replay = update.indexOf('confirmChange(automatic);');
  assert.ok(selecting >= 0 && replay > selecting,
    'the queued click must replay after the physical drawer flow reaches change selection');
});

test('a durably paid transaction catches up only through legal branch transitions', () => {
  assert.deepEqual(paidCheckoutCatchupPath('card', 'WaitingForScan'), [
    'ProductHeld', 'ProductScanning', 'ProductScanned', 'AllProductsScanned',
    'ChoosingPayment', 'CardPresented', 'CardInsertReady', 'CardInserting',
    'CardAmountEntry', 'CardProcessing', 'CardApproved', 'PaymentComplete',
  ]);
  assert.deepEqual(paidCheckoutCatchupPath('card', 'CardPresented'), [
    'CardInsertReady', 'CardInserting', 'CardAmountEntry', 'CardProcessing',
    'CardApproved', 'PaymentComplete',
  ]);
  assert.deepEqual(paidCheckoutCatchupPath('cash', 'DrawerOpening'), [
    'DepositingCash', 'SelectingChange', 'GivingChange', 'PaymentComplete',
  ]);
  assert.deepEqual(paidCheckoutCatchupPath('card', 'PaymentComplete'), []);
  assert.deepEqual(paidCheckoutCatchupPath('cash', 'ReceiptPrinting'), []);
  assert.equal(paidCheckoutCatchupPath('card', 'DrawerOpening'), null);
  assert.equal(paidCheckoutCatchupPath('cash', 'CardPresented'), null);
  assert.equal(paidCheckoutCatchupPath('wire', 'ChoosingPayment'), null);
});

test('automatic receipt printing reconciles the paid flow and then fails closed', () => {
  const beginStart = modeSource.indexOf('  function beginAutomaticReceipt() {');
  const beginEnd = modeSource.indexOf('\n  function finishAutomaticFulfillment()', beginStart);
  const begin = modeSource.slice(beginStart, beginEnd);
  const catchup = begin.indexOf('paidCheckoutCatchupPath(tx.method, checkoutFlowState())');
  const transition = begin.indexOf('for (const next of catchup)');
  const receiptGate = begin.indexOf("if (checkoutFlowState() !== 'ReceiptPrinting') return false;");
  const print = begin.indexOf('const printed = printReceipt(tx);');
  assert.ok(catchup >= 0 && transition > catchup && receiptGate > transition && print > receiptGate,
    'receipt printing must follow legal paid-flow catch-up and the ReceiptPrinting gate');
});
