// P0 REPRODUCTION — is the WAL quarantine what wedges a finished checkout?
//
// Built from tests/checkout-atomicity.test.js's own ticket recipe, so the sale
// is a REAL one that the shipped code accepts, not a synthetic object that an
// early guard rejects before the question is even asked. (My first Electron
// probe used a hand-made ticket and got "The sale is not finished." in all three
// arms -- a constant error across both arms of an experiment is not evidence
// about either of them.)
//
// TWO ARMS, IDENTICAL IN EVERY OTHER RESPECT:
//   A  latch clear -> the same sale
//   B  latch set   -> the same sale
// If A banks and B returns the owner's string, the latch is the cause.
import { newGame } from '../../../src/sim/state.js';
import { pickFromShelf } from '../../../src/sim/checkout.js';
import {
  acceptCash, bagItem, changeDue, completeSale, createTx, depositTendered,
  handOverChange, handOverGoods, makeChange, newDrawer, openDrawer, packReceipt,
  printReceipt, requestPayment, scanItem, takeFromDrawer, takeReceipt,
} from '../../../src/sim/register.js';
import {
  checkoutWalIsQuarantined, quarantineCheckoutWal,
} from '../../../src/sim/checkoutSettlement.js';

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

function arm(label, { latched }) {
  const state = newGame('relaxed', 4242);
  const item = { uid: `p0-${label}-unit`, skuId: 'balls1', name: 'Practice Balls', price: 15 };
  const picked = pickFromShelf(state, item.skuId, item.uid);
  const tx = paidCashTicket(state, item);
  if (latched) quarantineCheckoutWal(state, 'p0-repro-deliberate', { probe: true });
  const cashBefore = state.cash;
  let result;
  let threw = null;
  try {
    result = completeSale(state, tx, 'P0 Repro Customer');
  } catch (e) {
    threw = String(e?.message || e);
  }
  return {
    label,
    latched,
    pickedOk: picked.ok,
    quarantined: checkoutWalIsQuarantined(state),
    threw,
    ok: result?.ok ?? null,
    reason: result?.reason ?? null,
    diagnostic: result?.diagnostic ?? null,
    banked: tx.banked === true,
    cashMoved: +(state.cash - cashBefore).toFixed(2),
  };
}

const A = arm('clear', { latched: false });
const B = arm('latched', { latched: true });

// Does anything in the shipped code clear it? Set it, then look for a way back.
const s = newGame('relaxed', 4242);
quarantineCheckoutWal(s, 'p0-persistence-check');
const beforeRoundTrip = checkoutWalIsQuarantined(s);
const roundTripped = JSON.parse(JSON.stringify({ shop: s.shop }));
const survivesSerialisation = roundTripped.shop?.pendingCheckoutsQuarantine?.active === true;

console.log(JSON.stringify({
  armA_latchClear: A,
  armB_latchSet: B,
  verdict:
    A.ok === true && B.ok === false
      ? 'REPRODUCED — the same finished sale banks with the latch clear and is refused with it set'
      : 'NOT REPRODUCED as stated; see the arms',
  ownersStringMatches: /unavailable right now/i.test(String(B.reason || '')),
  diagnosticNamesQuarantine: /quarantin/i.test(String(B.diagnostic || '')),
  moneyTakenButSaleRefused: B.ok === false && B.cashMoved !== 0,
  latchSurvivesSerialisation: beforeRoundTrip && survivesSerialisation,
}, null, 2));
