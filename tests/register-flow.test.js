import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKOUT_STATE_ORDER,
  CHECKOUT_STATES,
  CHECKOUT_TRANSITIONS,
  REQUIRED_CHECKOUT_STATE_FIELDS,
  canTransitionCheckout,
  checkoutStateDefinition,
  checkoutStateTimedOut,
  createCheckoutFlow,
  enterCheckoutRecovery,
  isCheckoutState,
  recoverTimedOutCheckout,
  resolveCheckoutRecoveryTarget,
  resumeCheckout,
  transitionCheckout,
  validateCheckoutContract,
  validateCheckoutFlow,
  validateCheckoutTransition,
} from '../src/sim/registerFlow.js';

const EXPECTED_ORDER = [
  'CustomerApproaching',
  'CustomerPlacingProducts',
  'WaitingForCashier',
  'EnteringCashierMode',
  'WaitingForScan',
  'ProductHeld',
  'ProductScanning',
  'ProductScanned',
  'AllProductsScanned',
  'ChoosingPayment',
  'CardPresented',
  'CardSwipeReady',
  'CardSwiping',
  'CardProcessing',
  'CardApproved',
  'CardDeclined',
  'CashPresented',
  'CashAccepted',
  'DrawerOpening',
  'DepositingCash',
  'SelectingChange',
  'GivingChange',
  'PaymentComplete',
  'ReceiptPrinting',
  'Bagging',
  'BagHandoff',
  'CustomerLeaving',
  'TransactionComplete',
  'Recovery',
];

const advance = (flow, state, atMs) => {
  const result = transitionCheckout(flow, state, { nowMs: atMs, event: `test:${state}` });
  assert.equal(result.ok, true, result.reason);
  return result.flow;
};

test('the production contract defines the exact ordered set of 29 required states', () => {
  assert.deepEqual(CHECKOUT_STATE_ORDER, EXPECTED_ORDER);
  assert.equal(new Set(CHECKOUT_STATE_ORDER).size, 29);
  assert.deepEqual(Object.keys(CHECKOUT_STATES), EXPECTED_ORDER);
  assert.equal(validateCheckoutContract().ok, true, validateCheckoutContract().errors.join('\n'));
});

test('every state explicitly defines physical behavior, timeout, recovery, and adjacent successors', () => {
  for (const name of CHECKOUT_STATE_ORDER) {
    const state = CHECKOUT_STATES[name];
    for (const field of REQUIRED_CHECKOUT_STATE_FIELDS) {
      assert.ok(Object.hasOwn(state, field), `${name} defines ${field}`);
    }
    assert.equal(state.id, name);
    assert.ok(state.entryAction.length > 0);
    assert.ok(Array.isArray(state.allowedInput));
    assert.ok(state.camera.pose && state.camera.transition && state.camera.lookControl);
    assert.ok(state.playerAnimation.length > 0);
    assert.ok(state.customerAnimation.length > 0);
    assert.ok(state.uiState.posState && state.uiState.prompt);
    assert.ok(Array.isArray(state.audio) && state.audio.length > 0);
    assert.ok(state.completionCondition.length > 0);
    assert.ok(Object.hasOwn(state.timeout, 'seconds'));
    assert.ok(state.timeout.action);
    assert.ok(state.recoveryPath.checkpoint && state.recoveryPath.action);
    assert.deepEqual(state.nextStates, CHECKOUT_TRANSITIONS[name]);
    assert.ok(Object.isFrozen(state), `${name} contract is immutable`);
    assert.ok(Object.isFrozen(state.camera), `${name} camera contract is immutable`);
  }
});

test('contract lookup and validation reject unknown states without throwing', () => {
  assert.equal(isCheckoutState('Bagging'), true);
  assert.equal(isCheckoutState('TeleportToDone'), false);
  assert.equal(checkoutStateDefinition('Bagging'), CHECKOUT_STATES.Bagging);
  assert.equal(checkoutStateDefinition('TeleportToDone'), null);
  assert.match(validateCheckoutTransition('nope', 'Bagging').reason, /Unknown/);
  assert.match(validateCheckoutTransition('Bagging', 'nope').reason, /Unknown/);
});

test('production contract exposes the complete physical checkout inputs', () => {
  assert.deepEqual(CHECKOUT_STATES.WaitingForScan.allowedInput, ['grab-product', 'look', 'exit-cashier']);
  assert.deepEqual(CHECKOUT_STATES.ProductHeld.allowedInput,
    ['move-held-product', 'rotate-held-product', 'release-held-product', 'cancel-held-product']);
  assert.deepEqual(CHECKOUT_STATES.AllProductsScanned.allowedInput, ['confirm-total', 'exit-cashier']);
  assert.deepEqual(CHECKOUT_STATES.CardSwipeReady.allowedInput,
    ['activate-card-terminal', 'start-card-swipe', 'cancel-card-at-reader']);
  assert.deepEqual(CHECKOUT_STATES.CardSwiping.allowedInput,
    ['move-card-swipe', 'release-card-swipe', 'cancel-card-at-reader']);
  assert.deepEqual(CHECKOUT_STATES.CashPresented.allowedInput, ['click-presented-cash', 'exit-cashier']);
  assert.deepEqual(CHECKOUT_STATES.CashAccepted.allowedInput, ['open-cash-drawer', 'exit-cashier']);
  assert.deepEqual(CHECKOUT_STATES.DepositingCash.allowedInput,
    ['grab-tender-piece', 'move-tender-piece', 'release-tender-piece', 'exit-cashier']);
  assert.deepEqual(CHECKOUT_STATES.SelectingChange.allowedInput,
    ['select-change-piece', 'undo-change-piece', 'clear-change', 'click-customer-palm']);
  assert.deepEqual(CHECKOUT_STATES.ReceiptPrinting.allowedInput,
    ['grab-printed-receipt', 'move-receipt', 'release-receipt']);
  assert.deepEqual(CHECKOUT_STATES.Bagging.allowedInput,
    ['drag-receipt-to-bag', 'drag-product-to-bag', 'grab-filled-bag-handles']);
  assert.deepEqual(CHECKOUT_STATES.BagHandoff.allowedInput,
    ['move-filled-bag', 'release-filled-bag', 'cancel-filled-bag']);
  const obsolete = new Set([
    'click-product', 'click-presented-card', 'card-keypad-confirm',
    'card-keypad-correction', 'confirm-change',
  ]);
  for (const state of Object.values(CHECKOUT_STATES)) {
    for (const input of state.allowedInput) {
      assert.equal(obsolete.has(input), false, `${state.id} still exposes obsolete ${input}`);
    }
  }
});

test('the full card branch advances through every physical card state', () => {
  let flow = createCheckoutFlow({ nowMs: 0 });
  const states = [
    'CustomerPlacingProducts',
    'WaitingForCashier',
    'EnteringCashierMode',
    'WaitingForScan',
    'ProductHeld',
    'ProductScanning',
    'ProductScanned',
    'WaitingForScan',
    'ProductHeld',
    'ProductScanning',
    'ProductScanned',
    'AllProductsScanned',
    'ChoosingPayment',
    'CardPresented',
    'CardSwipeReady',
    'CardSwiping',
    'CardProcessing',
    'CardApproved',
    'PaymentComplete',
    'ReceiptPrinting',
    'Bagging',
    'BagHandoff',
    'CustomerLeaving',
    'TransactionComplete',
  ];
  states.forEach((state, index) => { flow = advance(flow, state, (index + 1) * 100); });
  assert.equal(flow.state, 'TransactionComplete');
  assert.equal(flow.sequence, states.length);
  assert.equal(flow.history.at(-1).event, 'test:TransactionComplete');
});

test('the full cash branch cannot omit acceptance, drawer, deposit, change, or handoff', () => {
  let flow = createCheckoutFlow({ state: 'ChoosingPayment', nowMs: 0 });
  const states = [
    'CashPresented',
    'CashAccepted',
    'DrawerOpening',
    'DepositingCash',
    'SelectingChange',
    'GivingChange',
    'PaymentComplete',
    'ReceiptPrinting',
    'Bagging',
    'BagHandoff',
    'CustomerLeaving',
    'TransactionComplete',
  ];
  states.forEach((state, index) => { flow = advance(flow, state, (index + 1) * 100); });
  assert.equal(flow.state, 'TransactionComplete');
});

test('decline and interrupted-swipe paths return to physical retry states', () => {
  assert.equal(canTransitionCheckout('CardSwiping', 'CardSwipeReady'), true);
  assert.equal(canTransitionCheckout('CardSwiping', 'CardProcessing'), true);
  assert.equal(canTransitionCheckout('CardProcessing', 'CardDeclined'), true);
  assert.equal(canTransitionCheckout('CardDeclined', 'CardPresented'), true);
  assert.equal(canTransitionCheckout('CardDeclined', 'ChoosingPayment'), true);
  assert.equal(canTransitionCheckout('CardDeclined', 'PaymentComplete'), false);
});

test('major physical states cannot be skipped by one transition', () => {
  const forbidden = [
    ['WaitingForScan', 'ProductScanned'],
    ['ProductHeld', 'ProductScanned'],
    ['AllProductsScanned', 'CardPresented'],
    ['ChoosingPayment', 'CardSwipeReady'],
    ['CardPresented', 'CardSwiping'],
    ['CardSwipeReady', 'CardProcessing'],
    ['CardSwiping', 'CardApproved'],
    ['CashPresented', 'DrawerOpening'],
    ['DrawerOpening', 'SelectingChange'],
    ['DepositingCash', 'GivingChange'],
    ['PaymentComplete', 'Bagging'],
    ['ReceiptPrinting', 'BagHandoff'],
    ['Bagging', 'CustomerLeaving'],
  ];
  for (const [from, to] of forbidden) {
    const result = validateCheckoutTransition(from, to);
    assert.equal(result.ok, false, `${from} must not skip directly to ${to}`);
    assert.match(result.reason, /cannot transition directly/);
  }
});

test('a successful transition is immutable and records its event and clock', () => {
  const before = createCheckoutFlow({ nowMs: 10 });
  const result = transitionCheckout(before, 'CustomerPlacingProducts', {
    nowMs: 250,
    event: 'customer-at-marker',
  });
  assert.equal(result.ok, true);
  assert.equal(before.state, 'CustomerApproaching', 'input flow was not mutated');
  assert.equal(before.sequence, 0);
  assert.equal(result.flow.state, 'CustomerPlacingProducts');
  assert.equal(result.flow.enteredAtMs, 250);
  assert.equal(result.flow.sequence, 1);
  assert.deepEqual(result.flow.history.at(-1), {
    from: 'CustomerApproaching',
    to: 'CustomerPlacingProducts',
    event: 'customer-at-marker',
    atMs: 250,
  });
});

test('invalid transitions return the original flow unchanged', () => {
  const flow = createCheckoutFlow({ state: 'WaitingForScan', nowMs: 0 });
  const result = transitionCheckout(flow, 'PaymentComplete', { nowMs: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.flow, flow);
  assert.equal(flow.sequence, 0);
});

test('recovery from a held product restores the scan checkpoint and only that checkpoint', () => {
  const held = createCheckoutFlow({ state: 'ProductHeld', nowMs: 0 });
  const interrupted = enterCheckoutRecovery(held, {
    cause: 'pointer-lock-lost',
    nowMs: 500,
  });
  assert.equal(interrupted.ok, true);
  assert.equal(interrupted.flow.state, 'Recovery');
  assert.equal(interrupted.flow.recovery.fromState, 'ProductHeld');
  assert.equal(interrupted.flow.recovery.resumeState, 'WaitingForScan');
  assert.equal(interrupted.flow.recovery.cause, 'pointer-lock-lost');

  const wrongResume = transitionCheckout(interrupted.flow, 'Bagging', { nowMs: 600 });
  assert.equal(wrongResume.ok, false);
  assert.match(wrongResume.reason, /only resume WaitingForScan/);

  const resumed = resumeCheckout(interrupted.flow, { nowMs: 700 });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.flow.state, 'WaitingForScan');
  assert.equal(resumed.flow.recovery, null);
});

test('scan recovery advances only when durable facts prove every item is scanned and staged', () => {
  assert.equal(resolveCheckoutRecoveryTarget('ProductScanned', {}), 'WaitingForScan');
  assert.equal(resolveCheckoutRecoveryTarget('ProductScanned', { allProductsScanned: true }), 'WaitingForScan');
  assert.equal(resolveCheckoutRecoveryTarget('ProductScanned', {
    allProductsScanned: true,
    allScannedItemsStaged: true,
  }), 'AllProductsScanned');
});

test('authorization, bag ownership, and sale-bank facts select idempotent recovery checkpoints', () => {
  assert.equal(resolveCheckoutRecoveryTarget('CardProcessing', {}), 'CardPresented');
  assert.equal(resolveCheckoutRecoveryTarget('CardProcessing', { paymentAuthorized: true }), 'PaymentComplete');
  assert.equal(resolveCheckoutRecoveryTarget('ReceiptPrinting', { paymentAuthorized: false }), 'ChoosingPayment');
  assert.equal(resolveCheckoutRecoveryTarget('ReceiptPrinting', { paymentAuthorized: true }), 'ReceiptPrinting');
  assert.equal(resolveCheckoutRecoveryTarget('BagHandoff', { paymentAuthorized: true }), 'Bagging');
  assert.equal(resolveCheckoutRecoveryTarget('BagHandoff', {
    paymentAuthorized: true,
    customerOwnsBag: true,
  }), 'CustomerLeaving');
  assert.equal(resolveCheckoutRecoveryTarget('CustomerLeaving', {
    paymentAuthorized: true,
    saleBanked: false,
  }), 'Bagging');
  assert.equal(resolveCheckoutRecoveryTarget('CustomerLeaving', { saleBanked: true }), 'CustomerLeaving');
});

test('cash recovery closes unsafe visuals and resumes before a deliberate drawer opening', () => {
  for (const state of ['CashAccepted', 'DrawerOpening', 'DepositingCash', 'SelectingChange', 'GivingChange']) {
    assert.equal(resolveCheckoutRecoveryTarget(state), 'CashAccepted', `${state} safely resumes at CashAccepted`);
  }
  assert.equal(resolveCheckoutRecoveryTarget('CashPresented'), 'CashPresented');
});

test('automatic state timeouts recover while deliberate player waits remain untimed', () => {
  const flow = createCheckoutFlow({ state: 'CardSwiping', nowMs: 1_000 });
  assert.equal(checkoutStateTimedOut(flow, 6_999), false);
  assert.equal(checkoutStateTimedOut(flow, 7_000), true);

  const timedOut = recoverTimedOutCheckout(flow, { nowMs: 7_000 });
  assert.equal(timedOut.ok, true);
  assert.equal(timedOut.flow.state, 'Recovery');
  assert.equal(timedOut.flow.recovery.resumeState, 'CardSwipeReady');
  assert.equal(timedOut.flow.recovery.cause, 'timeout:CardSwiping');

  for (const state of [
    'WaitingForScan', 'CardSwipeReady',
    'CardDeclined', 'CashPresented', 'SelectingChange',
  ]) {
    const waiting = createCheckoutFlow({ state, nowMs: 2_000 });
    assert.equal(checkoutStateTimedOut(waiting, Number.MAX_SAFE_INTEGER), false,
      `${state} must survive pause, blur, and alt-tab without resetting player input`);
  }

  const terminal = createCheckoutFlow({ state: 'TransactionComplete', nowMs: 0 });
  const recovery = createCheckoutFlow({ state: 'Recovery', nowMs: 0 });
  // A constructed Recovery snapshot is invalid until it has checkpoint data,
  // so timeout checking safely returns false instead of advancing it.
  assert.equal(checkoutStateTimedOut(terminal, Number.MAX_SAFE_INTEGER), false);
  assert.equal(checkoutStateTimedOut(recovery, Number.MAX_SAFE_INTEGER), false);
});

test('flow validation catches corrupt persisted recovery snapshots', () => {
  assert.equal(validateCheckoutFlow(null).ok, false);
  assert.equal(validateCheckoutFlow({ state: 'nope', enteredAtMs: 0, sequence: 0, history: [] }).ok, false);
  assert.equal(validateCheckoutFlow({
    state: 'Recovery',
    enteredAtMs: 0,
    sequence: 1,
    history: [],
    recovery: null,
  }).ok, false);
});

test('transition history is bounded during repeated physical pickup and release', () => {
  let flow = createCheckoutFlow({ state: 'WaitingForScan', nowMs: 0 });
  for (let i = 0; i < 40; i += 1) {
    flow = advance(flow, 'ProductHeld', i * 2 + 1);
    flow = advance(flow, 'WaitingForScan', i * 2 + 2);
  }
  assert.equal(flow.history.length, 64);
  assert.equal(flow.sequence, 80);
  assert.equal(flow.history.at(-1).to, 'WaitingForScan');
});

test('TransactionComplete is terminal and cannot be rolled back into Recovery', () => {
  assert.deepEqual(CHECKOUT_TRANSITIONS.TransactionComplete, []);
  assert.equal(canTransitionCheckout('TransactionComplete', 'Recovery'), false);
  const terminal = createCheckoutFlow({ state: 'TransactionComplete', nowMs: 0 });
  const result = enterCheckoutRecovery(terminal, { cause: 'late-blur', nowMs: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.flow, terminal);
});
