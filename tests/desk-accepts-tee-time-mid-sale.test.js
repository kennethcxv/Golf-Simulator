// G13 — THE COUNTER MUST LET THE TEE TIME ONTO THE SALE.
//
// The sim layer can carry a green fee on a merchandise ticket, and eleven checks
// prove the money splits correctly when it does. None of that reaches the player
// if the desk refuses to let them ask.
//
// It refused in THREE places, and finding only the first would have been the
// half-fix this goal has already caught five times:
//
//   1. `beginReservationPayment`   - `if (!reservation || tx) return false`
//   2. `select-reservation:`       - "Finish the active transaction first"
//   3. `select-walkin-slot:`       - `if (tx) return false`
//
// Two and three are the ones that bite, because the player must SELECT a
// reservation before check-in can be pressed. Fixing only the first leaves the
// merge unreachable from the counter while every unit test passes.
//
// These gates live inside a closure over live 3D state, so this reads the source
// the way the trunk-bob check does. That is a weaker instrument than driving the
// desk, and the report records the live path as UNCONFIRMED. What it does buy is
// the exact regression: someone restoring a bare `if (tx)` here would reclose the
// door silently.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);
const clubhouseSrc = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
);

// The block handling one monitor action, from its `if (action...)` to the next.
function actionBlock(name) {
  const at = src.indexOf(name);
  if (at < 0) return null;
  const next = src.indexOf("    if (action", at + name.length);
  return next < 0 ? src.slice(at, at + 1200) : src.slice(at, next);
}

function functionBody(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < src.length; index += 1) {
    if (src[index] === '{') depth += 1;
    if (src[index] === '}' && --depth === 0) return src.slice(start, index + 1);
  }
  throw new Error(`${name} has an unterminated body`);
}

test('selecting a reservation is not refused while items are still being scanned', () => {
  const block = actionBlock("action.startsWith('select-reservation:')");
  assert.ok(block, 'the select-reservation action is still handled here');
  // A bare `if (tx)` is the defect: it refuses the exact moment the player is
  // trying to use. The gate must ask what STAGE the ticket is at.
  assert.doesNotMatch(block, /if \(tx\) \{/,
    'a bare tx check would refuse a ticket that can still take the fee');
  assert.match(block, /tx\.stage !== 'scanning'/,
    'the refusal is scoped to a ticket that has already started payment');
});

test('booking a walk-in slot is not refused while items are still being scanned', () => {
  const block = actionBlock("action.startsWith('select-walkin-slot:')");
  assert.ok(block, 'the select-walkin-slot action is still handled here');
  assert.doesNotMatch(block, /if \(tx\) return false;/,
    'a bare tx check would refuse a walk-in booked mid-sale');
  assert.match(block, /tx\.stage !== 'scanning'/,
    'the refusal is scoped to a ticket that has already started payment');
});

test('the check-in entry point attaches to an open ticket instead of bailing', () => {
  const at = src.indexOf('function beginReservationPayment(');
  assert.ok(at > 0, 'the check-in entry point is still here');
  const block = src.slice(at, at + 1600);
  assert.doesNotMatch(block, /if \(!reservation \|\| tx\) return false;/,
    'the old refusal is gone');
  assert.match(block, /attachGreenFeeToTx\(/,
    'an open ticket takes the fee onto itself');
});

test('a successful desk answer restores the physical checkout without restarting payment', () => {
  const helper = functionBody('returnFromDeskAnswerToCheckout');
  assert.match(helper, /selectedReservationId\s*=\s*null/);
  assert.match(helper, /selectedWalkInCustomerId\s*=\s*null/);
  assert.match(helper, /activeTab\s*=\s*['"]checkout['"]/);
  assert.match(helper, /paymentAutoTimer\s*=\s*AUTO_PAYMENT_HOLD/);
  assert.match(helper, /paymentAutoSuppressed\s*=\s*false/);
  assert.match(helper, /setWorkspace\(['"]monitor['"]\)/);
  assert.doesNotMatch(helper, /choosePayment\s*\(|clearPhysicalTransaction\s*\(|abandon\s*\(/,
    'the return preserves the open ticket and lets the normal automatic handoff run');

  const begin = functionBody('beginReservationPayment');
  const combinedBranch = begin.slice(begin.indexOf('if (tx) {'), begin.indexOf('refreshAccessibilityPreferences'));
  assert.match(combinedBranch,
    /attachGreenFeeToTx\([\s\S]*returnFromDeskAnswerToCheckout\(\)[\s\S]*return true/,
    'all successful existing-ticket check-ins converge on the presentation return');
});

test('new, adjusted, existing, and refused desk answers share the checkout return path', () => {
  const slot = actionBlock("action.startsWith('select-walkin-slot:')");
  const existing = actionBlock("action === 'reservation-check-in'");
  const refused = actionBlock("action === 'reject-walkin'");
  assert.match(slot, /return beginReservationPayment\(booked\.res\)/,
    'requested and adjusted slot offers use the shared booking completion path');
  assert.match(existing, /return beginReservationPayment\(reservation\)/,
    'an existing booking uses the same completion path');
  assert.match(refused,
    /if \(rejected\) \{[\s\S]*returnFromDeskAnswerToCheckout\(\)/,
    'a successful refusal returns to the goods-only ticket');
});

test('a booking holder with an open goods ticket is actionable without changing their route', () => {
  const bridgeStart = clubhouseSrc.indexOf('  B.frontDeskReservations = {');
  const readyStart = clubhouseSrc.indexOf('    readyCustomerFor: (id) => {', bridgeStart);
  const readyEnd = clubhouseSrc.indexOf('\n    readyWalkInFor:', readyStart);
  assert.ok(bridgeStart >= 0 && readyStart > bridgeStart && readyEnd > readyStart);
  const ready = clubhouseSrc.slice(readyStart, readyEnd);
  assert.match(ready, /customer\.deskErrandRaisedMidSale/);
  assert.match(ready, /customer\.deskErrandPending/);
  assert.match(ready, /customer\.cart\?\.length/);
  assert.match(ready,
    /customer\.checkoutPhase === 'reservation-waiting' \|\| combinedAtCounter/);
  assert.doesNotMatch(ready, /customer\.checkoutPhase\s*=(?!=)/,
    'screen readiness must not reclassify or release an unpaid checkout customer');
});

test('an existing booking holder with unpaid goods enters checkout before desk service', () => {
  const branchAt = clubhouseSrc.indexOf(
    "} else if (stop.kind === 'counter' && openReservationCustomer(c)",
  );
  const cartAt = clubhouseSrc.indexOf(
    "} else if (stop.kind === 'counter' && c.cart.length && counterQueue.indexOf(c) === 0)",
    branchAt,
  );
  assert.ok(branchAt >= 0 && cartAt > branchAt,
    'the live reservation and merchandise counter branches remain ordered');
  const reservationBranch = clubhouseSrc.slice(branchAt, cartAt);
  assert.match(reservationBranch, /!\(c\.cart\?\.length && !c\.bought\)/,
    'an open booking must not outrank its owner\'s unpaid merchandise cart');
  const lifecycleGuard = clubhouseSrc.slice(
    clubhouseSrc.indexOf('if (c.reservationId != null && !c.reservationReleased'),
    branchAt,
  );
  assert.doesNotMatch(lifecycleGuard, /!\(c\.cart\?\.length && !c\.bought\)/,
    'the cart exclusion is scoped to counter routing, not booking lifecycle protection');
});

test('a newly-created combined booking remains actionable until the fee attachment succeeds', () => {
  const bookStart = clubhouseSrc.indexOf('    bookWalkIn: (customerId, dayAbs, minute) => {');
  const bookEnd = clubhouseSrc.indexOf('\n    rejectWalkIn:', bookStart);
  assert.ok(bookStart >= 0 && bookEnd > bookStart);
  const book = clubhouseSrc.slice(bookStart, bookEnd);
  assert.doesNotMatch(book, /customer\.deskErrandPending\s*=\s*false/,
    'creating the tee-sheet row alone must not consume the open desk answer');
  assert.doesNotMatch(book, /customer\.deskErrandAwaitingAnswer\s*=\s*false/,
    'a failed fee attachment must retain a coherent retry state');

  const begin = functionBody('beginReservationPayment');
  const attached = begin.indexOf('if (!joined.ok)');
  const clearsPending = begin.indexOf('cust.deskErrandPending = false');
  assert.ok(attached >= 0 && clearsPending > attached,
    'the desk answer is consumed only after attachGreenFeeToTx reports success');
});

test('the desk decides what to finalize from what the ticket carries', () => {
  // `transactionKind` remembers only the first thing that happened at the desk.
  // A visit that began as a shirt and picked up a tee time is still a check-in,
  // and routing on the opening move would bank it as an anonymous sale and leave
  // the round showing open on the sheet.
  const at = src.indexOf('function finalizeTransaction(');
  assert.ok(at > 0, 'the finalize handler is still here');
  const block = src.slice(at, at + 2200);
  assert.doesNotMatch(block, /if \(transactionKind === 'reservation'\) \{\s*result =/,
    'the branch must not be decided by how the ticket started');
  assert.match(block, /tx\.servicePayment[\s\S]{0,80}reservationId/,
    'it asks the ticket what booking it carries');
});

test('a banked combined sale transfers goods before reservation exit routing', () => {
  const finalizeAt = src.indexOf('function finalizeTransaction(');
  const finalize = src.slice(finalizeAt, finalizeAt + 13000);
  const paidAt = finalize.indexOf("attempt('paid-goods-ownership'");
  const paidReleaseAt = finalize.indexOf("attempt('paid-customer-route-release'");
  const releaseAt = finalize.indexOf('bridge.completeCustomer(finishedReservationId)');
  assert.ok(paidAt >= 0 && paidReleaseAt > paidAt && releaseAt > paidReleaseAt,
    'paid merchandise ownership and checkout route release precede the booking bridge');

  const paidStart = clubhouseSrc.indexOf('  function transferCustomerPaidOwnership(c) {');
  const paidEnd = clubhouseSrc.indexOf('\n  function releasePaidCustomerFromCheckout', paidStart);
  assert.ok(paidStart >= 0 && paidEnd > paidStart);
  const paid = clubhouseSrc.slice(paidStart, paidEnd);
  const cartClearAt = paid.indexOf('c.cart = []');
  assert.ok(cartClearAt >= 0);
  assert.doesNotMatch(paid, /\.mesh|recordCustomerVisit\(|leaveReview\(|clearCustomerItemMeshes\(|beginPendingDesk\(/,
    'the authoritative ownership boundary must not touch fallible presentation state');
  assert.match(paid, /c\.visitRecorded = c\.tx\?\.customerVisitRecorded === true/,
    'the actor reports history only when the durable ticket event applied');
  assert.doesNotMatch(paid, /c\.visitRecorded = true/,
    'paid ownership cannot claim an unresolved customer-history event succeeded');
});

test('post-bank presentation failures cannot strand or retry a durable ticket', () => {
  const finalizeAt = src.indexOf('function finalizeTransaction(');
  const finalize = src.slice(finalizeAt, finalizeAt + 18000);
  const bankAt = Math.min(
    ...['finalizeReservationCheckIn(', 'completeSale(']
      .map((needle) => finalize.indexOf(needle)).filter((index) => index >= 0),
  );
  const tryAt = finalize.indexOf('try {');
  const finallyAt = finalize.indexOf('} finally {', bankAt);
  const ownershipAt = finalize.indexOf("attempt('paid-goods-ownership'", bankAt);
  const presentationAt = finalize.indexOf("attempt('paid-customer-presentation'", ownershipAt);
  const paidReleaseAt = finalize.indexOf("attempt('paid-customer-route-release'", presentationAt);
  const bridgeAt = finalize.indexOf('bridge.completeCustomer(finishedReservationId)', paidReleaseAt);
  const salvageAt = finalize.indexOf("attempt('paid-bag-salvage'", finallyAt);
  const clearAt = finalize.indexOf("attempt('post-bank-physical-cleanup'", finallyAt);
  const txClearAt = finalize.indexOf('if (tx === finishedTx) tx = null', finallyAt);
  const returnAt = finalize.indexOf('return true;', finallyAt);
  assert.ok(tryAt >= 0 && bankAt > tryAt && finallyAt > bankAt,
    'the irreversible bank helper itself is covered by the recovery try/finally');
  assert.ok(ownershipAt > bankAt && presentationAt > ownershipAt
    && paidReleaseAt > presentationAt && bridgeAt > paidReleaseAt,
  'durable ownership, fallible presentation, route release, and booking release stay ordered');
  assert.ok(salvageAt > finallyAt && clearAt > salvageAt,
    'even bag salvage is isolated before guaranteed physical teardown');
  const authoritativeReleaseAt = finalize.indexOf(
    'runPaidCustomerAuthoritativeRelease({',
    finallyAt,
  );
  assert.ok(authoritativeReleaseAt > salvageAt && clearAt > authoritativeReleaseAt,
    'an idempotent exact-identity queue release runs before register teardown');
  assert.ok(clearAt > finallyAt && txClearAt > clearAt && returnAt > txClearAt,
    'every successful bank tears down its live register pointers in finally and returns success');
  assert.match(finalize, /attempt\('paid-customer-presentation'/,
    'fallible review/mesh/bag work is recovered rather than escaping');
  assert.match(finalize, /salvagePaidBagAfterPresentationFailure/,
    'a presentation fault cannot orphan a customer-owned bag under the register root');
  assert.match(finalize, /checkoutPostBankFailures/,
    'recovered post-bank faults remain diagnosable');
});

test('the runtime fault seam is exact-identity, one-shot, and throws after ownership', () => {
  const start = clubhouseSrc.indexOf('  function onCustomerPaid(c, transaction = null) {');
  const end = clubhouseSrc.indexOf('\n  addProp({', start);
  assert.ok(start >= 0 && end > start);
  const paid = clubhouseSrc.slice(start, end);
  const ownershipAt = paid.indexOf('transferCustomerPaidOwnership(c)');
  const snapshotAt = paid.indexOf('const injectedFault = qaPaidPresentationFault');
  const consumeAt = paid.indexOf('qaPaidPresentationFault = null', snapshotAt);
  const throwAt = paid.indexOf("throw new Error('QA injected paid-customer presentation failure.')");
  const presentationAt = paid.indexOf('const acceptanceYaw', throwAt);
  assert.ok(ownershipAt >= 0 && snapshotAt > ownershipAt && consumeAt > snapshotAt
    && throwAt > consumeAt && presentationAt > throwAt,
  'the injected exception consumes its exact one-shot only after paid ownership transfers');
  assert.match(paid, /transactionNumber\) === Number\(transaction\?\.number\)/);
  assert.match(paid, /customerId\) === String\(c\?\.customerId\)/);
  assert.match(clubhouseSrc, /debugFailNextPaidCustomerPresentation:[\s\S]*!transaction \|\| !customer \|\| transaction\.banked/,
    'the QA seam can arm only an active, unbanked transaction/customer identity');
});
