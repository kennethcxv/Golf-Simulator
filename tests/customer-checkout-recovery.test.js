import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
);

function between(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0, `missing source boundary: ${startText}`);
  assert.ok(end > start, `missing source boundary: ${endText}`);
  return source.slice(start, end);
}

function callCount(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

test('organic checkout watchdog arms only for a cart-holder actively routed to the counter', () => {
  const arm = between(
    '  function armCustomerCheckoutApproach(c) {',
    '  function reconcileCustomerPlacementRecovery(c) {',
  );
  const update = between(
    '  function updateCustomers(dt) {',
    '  function update(dtMs) {',
  );

  assert.match(source, /checkoutApproachArmed: false/,
    'spawned shoppers begin with an unarmed counter watchdog');
  assert.match(update, /const checkoutTarget = c\.stops\[c\.stopIdx\]/);
  assert.match(update, /checkoutTarget\?\.kind === 'counter' && c\.cart\.length/);
  assert.match(update, /armCustomerCheckoutApproach\(c\)/);
  assert.match(arm, /createCheckoutFlow\(\{[\s\S]*state: 'CustomerApproaching',[\s\S]*nowMs: flowNow\(\)/,
    'arming replaces the spawn-age flow with a fresh approach checkpoint');
  assert.match(update, /if \(recoverCustomerCheckoutTimeout\(c\)\) continue;/,
    'a recovered customer cannot progress twice in the recovery frame');
});

test('outer watchdog performs one Recovery/resume pair without abandoning customer authority', () => {
  const recover = between(
    '  function recoverCustomerCheckoutTimeout(c, nowMs = flowNow()) {',
    '  function customerPick(c, stop) {',
  );

  assert.match(recover, /checkoutStateTimedOut\(flow, nowMs\)/);
  assert.equal(callCount(recover, /recoverTimedOutCheckout\(/g), 1);
  assert.equal(callCount(recover, /resumeCheckout\(/g), 1);
  assert.match(recover, /syncCustomerCheckoutFlow\(c, entered\.flow\)/);
  assert.match(recover, /syncCustomerCheckoutFlow\(c, resumed\.flow\)/);
  assert.match(recover, /fromState,[\s\S]*recoverySequence:[\s\S]*resumeSequence:/,
    'bounded diagnostics retain both sides of the one recovery pair');
  assert.doesNotMatch(recover,
    /surrenderCart|customerGiveUp|beginCustomerImpatientBeat|completeSale|counterQueue\.|stopIdx\s*[+\-=]|\.patience\s*=/,
    'watchdog reconciliation preserves cart, queue slot, inventory, and patience authority');
});

test('placement recovery preserves durable counter poses and restarts only unfinished UIDs', () => {
  const placement = between(
    '  function reconcileCustomerPlacementRecovery(c) {',
    '  function reconcileCustomerCheckoutTimeout(c, fromState) {',
  );

  assert.match(placement, /createSequentialPlacementRecovery\(c\.cart\)/);
  assert.match(placement, /if \(placed\.has\(item\.uid\)\)/);
  assert.match(placement, /interior\.add\(mesh\)/);
  assert.match(placement, /mesh\.position\.set\(item\.placedAt\.x, item\.placedAt\.y, item\.placedAt\.z\)/);
  assert.match(placement, /mesh\.rotation\.set\(0, item\.placedAt\.ry, 0\)/);
  assert.match(placement, /item\.placed = false;[\s\S]*c\.mesh\.add\(mesh\)/,
    'only the unfinished branch reattaches a product to customer carry');
  assert.match(placement, /c\.checkoutPlacement = recovery\.placement/);
  assert.doesNotMatch(placement, /c\.cart\s*=|\.splice\(|state\.shop|surrenderCart|customerGiveUp/);
});

test('WaitingForCashier recovery releases only unsafe input while the patience fuse stays independent', () => {
  const reconcile = between(
    '  function reconcileCustomerCheckoutTimeout(c, fromState) {',
    '  function recoverCustomerCheckoutTimeout(c, nowMs = flowNow()) {',
  );
  const update = between(
    '  function updateCustomers(dt) {',
    '  function update(dtMs) {',
  );
  const waitingStart = reconcile.indexOf("if (fromState === 'WaitingForCashier')");
  assert.ok(waitingStart >= 0);
  const waiting = reconcile.slice(waitingStart);

  assert.match(waiting, /register\.getCustomer\(\) === c/);
  assert.match(waiting, /register\.leave\(\{ restorePointer: false \}\)/);
  assert.match(waiting, /register\.recoverInput\('waiting-customer-watchdog'\)/);
  assert.doesNotMatch(waiting, /register\.begin|register\.complete|surrenderCart|customerGiveUp|c\.tx\s*=/);
  assert.match(update, /c\.checkoutApproachArmed && c\.checkoutFlow/,
    'shopping time cannot consume the counter patience clock before arming');
  assert.match(update, /c\.preServiceWait > PATIENCE_FULL[\s\S]*beginCustomerImpatientBeat\(c\)/,
    'the ten-minute give-up fuse remains the sole abandonment path');
});
