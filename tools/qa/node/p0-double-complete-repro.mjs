// P0 (Goal 25 round 2) — WHAT ACTUALLY PRODUCES THE OWNER'S STRING?
//
// Last session I found the WAL quarantine produced "Checkout records are
// unavailable right now. Try again." and reported it as THE cause. It is ONE
// cause. `checkout.integrityUnavailable` has 277 call sites in src/, each with
// its own internal `diagnostic`, and the player is shown the same sentence for
// every one of them.
//
// And the owner's four real save files (%APPDATA%/GOLF EMPIRE/saves) load CLEAN:
// no latch on disk, none set at boot — measured in p0-owner-save-latch.mjs. So
// whatever is wedging him is not the quarantine.
//
// THE SYMPTOM IS THE CLUE: "the customer I charged never left the register."
// Money moved, sale refused. register.js:1918-1939 does exactly that — if a
// ticket already exists for this transaction id and no WAL remains, the sale is
// a closed duplicate and is refused. That is a SECOND completeSale on a
// transaction the FIRST one already banked.
//
// THREE ARMS, one sale each, identical up to the last step:
//   A  complete once                  -> expect ok
//   B  complete twice (same tx)       -> expect the owner's string on call 2
//   C  complete twice, arriving via the register's own handoff path
import { newGame } from '../../../src/sim/state.js';
import { pickFromShelf } from '../../../src/sim/checkout.js';
import {
  acceptCash, bagItem, changeDue, completeSale, createTx, depositTendered,
  handOverChange, handOverGoods, makeChange, newDrawer, openDrawer, packReceipt,
  printReceipt, requestPayment, scanItem, takeFromDrawer, takeReceipt,
} from '../../../src/sim/register.js';
import { pendingCheckoutCount } from '../../../src/sim/checkoutSettlement.js';

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

function call(state, tx, label) {
  const cashBefore = state.cash;
  let r;
  let threw = null;
  try { r = completeSale(state, tx, 'P0 Double Customer'); } catch (e) { threw = String(e?.message || e); }
  return {
    label,
    threw,
    ok: r?.ok ?? null,
    already: r?.already ?? null,
    reason: r?.reason ?? null,
    diagnostic: r?.diagnostic ?? null,
    cashMoved: +(state.cash - cashBefore).toFixed(2),
    pendingAfter: pendingCheckoutCount(state),
    txBanked: tx.banked === true,
  };
}

function arm(label, { completions }) {
  const state = newGame('relaxed', 7788);
  const item = {
    uid: `p0-dbl-${label}-unit`, skuId: 'balls1', name: 'Practice Balls', price: 15,
  };
  pickFromShelf(state, item.skuId, item.uid);
  const tx = paidCashTicket(state, item);
  const calls = [];
  for (let i = 0; i < completions; i += 1) calls.push(call(state, tx, `call${i + 1}`));
  return { label, calls, cashTotal: state.cash };
}

const A = arm('once', { completions: 1 });
const B = arm('twice', { completions: 2 });
const C = arm('thrice', { completions: 3 });

const second = B.calls[1];
console.log(JSON.stringify({
  armA_completeOnce: A.calls,
  armB_completeTwice: B.calls,
  armC_completeThrice: C.calls.slice(1),
  verdict: A.calls[0].ok === true && second.ok === false
    ? 'REPRODUCED — the first call banks, the second returns the owner\'s string'
    : 'NOT REPRODUCED as stated; see the arms',
  ownersStringMatches: /unavailable right now/i.test(String(second.reason || '')),
  moneyMovedOnFirstOnly: A.calls[0].cashMoved !== 0 && second.cashMoved === 0,
  diagnosticOnSecond: second.diagnostic,
}, null, 2));
