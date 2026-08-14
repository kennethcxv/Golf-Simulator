// P0 (Goal 25) — THE QUARANTINE INTERLOCK MUST HAVE A KEY.
//
// The owner finished a checkout and got "Checkout records are unavailable right
// now. Try again." forever after. The interlock that refuses to bank while the
// journal is distrusted is correct and is NOT weakened by anything here: these
// tests assert that it still refuses, that it still reports unresolved work, and
// that only a DELIBERATE release re-opens trading.
//
// What is new is the release itself, and the properties that make it safe:
// it is explicit, it empties the journal it could not understand rather than
// trusting it again, it keeps the incident record, and it does not fire on its
// own.
import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { pickFromShelf } from '../src/sim/checkout.js';
import {
  acceptCash, bagItem, changeDue, completeSale, createTx, depositTendered,
  handOverChange, handOverGoods, makeChange, newDrawer, openDrawer, packReceipt,
  printReceipt, requestPayment, scanItem, takeFromDrawer, takeReceipt,
} from '../src/sim/register.js';
import {
  checkoutWalIsQuarantined,
  pendingCheckoutCount,
  quarantineCheckoutWal,
  releaseCheckoutWalQuarantine,
} from '../src/sim/checkoutSettlement.js';

function paidCashTicket(state, item) {
  state.shop.drawer = newDrawer();
  const tx = createTx({ items: [item], mode: 'relaxed', prefer: 'cash', rng: () => 0.9 });
  scanItem(tx, item.uid);
  requestPayment(tx);
  tx.tendered = makeChange(20);
  acceptCash(tx);
  openDrawer(tx);
  depositTendered(tx, state.shop.drawer);
  for (const [denom, count] of Object.entries(makeChange(changeDue(tx)))) {
    for (let i = 0; i < count; i += 1) takeFromDrawer(tx, state.shop.drawer, Number(denom));
  }
  handOverChange(tx, state.shop.drawer);
  printReceipt(tx);
  takeReceipt(tx);
  packReceipt(tx);
  bagItem(tx, item.uid);
  handOverGoods(tx);
  return tx;
}

function shopWithPaidTicket(seed, uid) {
  const state = newGame('relaxed', seed);
  const item = { uid, skuId: 'balls1', name: 'Practice Balls', price: 15 };
  assert.equal(pickFromShelf(state, item.skuId, item.uid).ok, true);
  return { state, tx: paidCashTicket(state, item) };
}

test('the interlock still refuses a finished sale while the journal is distrusted', () => {
  const { state, tx } = shopWithPaidTicket(4242, 'wal-refuse-unit');
  quarantineCheckoutWal(state, 'test-deliberate');
  const result = completeSale(state, tx, 'Refused Customer');
  assert.equal(result.ok, false, 'a quarantined journal must not bank');
  assert.match(result.reason, /unavailable right now/i);
  assert.notEqual(tx.banked, true);
  // and it still represents itself as unresolved work, which the recovery
  // suite pins deliberately
  assert.equal(pendingCheckoutCount(state), 1);
});

test('the same finished sale banks once the quarantine is deliberately released', () => {
  const { state, tx } = shopWithPaidTicket(4242, 'wal-release-unit');
  quarantineCheckoutWal(state, 'test-deliberate');
  assert.equal(completeSale(state, tx, 'Wedged Customer').ok, false);

  const released = releaseCheckoutWalQuarantine(state, { acknowledgedBy: 'test' });
  assert.equal(released.ok, true);
  assert.equal(released.released, true);
  assert.equal(checkoutWalIsQuarantined(state), false);
  assert.equal(pendingCheckoutCount(state), 0, 'the phantom pending settlement is gone with the latch');

  const after = completeSale(state, tx, 'Wedged Customer');
  assert.equal(after.ok, true, 'the till trades again after an acknowledged loss');
  assert.equal(tx.banked, true);
});

test('releasing keeps the incident on the record rather than erasing it', () => {
  const state = newGame('relaxed', 4242);
  quarantineCheckoutWal(state, 'invalid-persisted-checkout-settlement', { pendingCheckouts: { junk: 1 } });
  const released = releaseCheckoutWalQuarantine(state, { acknowledgedBy: 'owner' });
  assert.equal(released.accepted.reason, 'invalid-persisted-checkout-settlement');
  assert.deepEqual(released.accepted.evidence, { pendingCheckouts: { junk: 1 } });
  const field = state.shop.pendingCheckoutsQuarantine;
  assert.equal(field.active, false);
  assert.equal(field.reason, 'invalid-persisted-checkout-settlement',
    'why it was quarantined outlives the release');
  assert.equal(field.releasedBy, 'owner');
  assert.deepEqual(field.evidence, { pendingCheckouts: { junk: 1 } });
});

test('the release empties the journal it could not understand instead of trusting it again', () => {
  const state = newGame('relaxed', 4242);
  state.shop.pendingCheckouts = { 'not-understood': { anything: true } };
  quarantineCheckoutWal(state, 'test-deliberate');
  releaseCheckoutWalQuarantine(state);
  assert.deepEqual(state.shop.pendingCheckouts, {},
    'an acknowledged loss must not leave an un-understood settlement to be banked later');
});

test('release is deliberate: it never fires on its own, and is a no-op when nothing is wrong', () => {
  const { state, tx } = shopWithPaidTicket(4242, 'wal-noop-unit');
  quarantineCheckoutWal(state, 'test-deliberate');
  // a whole sale attempt, a save and a load must NOT clear it
  completeSale(state, tx, 'Nobody');
  const reloaded = deserialize(serialize(state));
  assert.equal(checkoutWalIsQuarantined(reloaded), true,
    'the latch survives save and load; only an explicit release clears it');

  const clean = newGame('relaxed', 4242);
  const noop = releaseCheckoutWalQuarantine(clean);
  assert.equal(noop.ok, true);
  assert.equal(noop.released, false);
  assert.equal(noop.diagnostic, 'not-quarantined');
});
