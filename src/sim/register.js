// THE REGISTER — the transaction a player works with their hands.
//
// This module is the whole truth of a sale and it knows nothing about three.js.
// Every rule the counter enforces — an item is scanned exactly once, payment
// cannot start with goods still unscanned, money moves only when payment
// succeeds — is a function in here, so it can be hammered headlessly. The 3D
// layer above is a puppet: it moves meshes and calls these.
//
// MONEY IS INTEGER CENTS internally. A drawer holds hundreds of dimes and
// `0.1 * 300` is 30.000000000000004 in float, which would make a till that
// balances on paper fail to balance in code. Cents in, dollars out at the edge.

import { addRevenue, addExpense } from './economy.js';
import { liveSales, consumeHeldBatch } from './checkout.js';
import { recordSale } from './shop.js';

// --- currency -----------------------------------------------------------------
// Shop prices land on arbitrary cents. The drawer carries five coin
// denominations down through the penny, so cash and card share one exact total.

export const BILLS = [50, 20, 10, 5, 1];
export const COINS = [0.5, 0.25, 0.1, 0.05, 0.01];
export const DENOMS = [...BILLS, ...COINS];

const cents = (v) => Math.round(v * 100);
const dollars = (c) => c / 100;
const DENOM_CENTS = DENOMS.map(cents); // [5000, 2000, 1000, 500, 100, 25, 10, 5]

export function roundCash(v) {
  return dollars(cents(v));
}

// The unlimited US-style denomination set is canonical, so greedy produces the
// fewest pieces. Bounded drawer change below uses dynamic programming because a
// temporarily empty slot can make a greedy choice fail even when change exists.
export function makeChange(amount) {
  let left = cents(amount);
  const out = {};
  for (let i = 0; i < DENOM_CENTS.length; i++) {
    const n = Math.floor(left / DENOM_CENTS[i]);
    if (n > 0) {
      out[DENOMS[i]] = n;
      left -= n * DENOM_CENTS[i];
    }
  }
  return out;
}

export function stackTotal(stack) {
  let c = 0;
  for (const d of Object.keys(stack || {})) c += cents(Number(d)) * (stack[d] || 0);
  return dollars(c);
}

export function stackCount(stack) {
  let n = 0;
  for (const d of Object.keys(stack || {})) n += stack[d] || 0;
  return n;
}

export function addToStack(stack, denom, n = 1) {
  const out = { ...(stack || {}) };
  out[denom] = (out[denom] || 0) + n;
  return out;
}

// one piece at a time — this is a hand reaching into a till, not a transfer
export function takeFromStack(stack, denom, n = 1) {
  const have = (stack || {})[denom] || 0;
  if (have < n) return { ok: false, reason: 'None left in that slot.', stack };
  const out = { ...stack };
  out[denom] = have - n;
  if (out[denom] === 0) delete out[denom];
  return { ok: true, stack: out };
}

const copyStack = (stack) => {
  const out = {};
  for (const [denom, count] of Object.entries(stack || {})) {
    if (Number.isInteger(count) && count > 0) out[denom] = count;
  }
  return out;
};

const sameStack = (a, b) => {
  const left = copyStack(a);
  const right = copyStack(b);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if ((left[key] || 0) !== (right[key] || 0)) return false;
  return true;
};

// Cash handling works against a transaction-local copy. The saved shop drawer
// remains the opening float until completeSale atomically replaces it. This is
// also the read path for callers that need to draw the in-progress contents.
export function drawerContents(tx, drawer = {}) {
  return tx.drawerPending || drawer;
}

function localDrawer(tx, drawer) {
  if (!tx.drawerStart || !tx.drawerPending) {
    tx.drawerStart = copyStack(drawer);
    tx.drawerPending = copyStack(drawer);
  }
  return tx.drawerPending;
}

// --- the transaction ------------------------------------------------------------
// STAGES, in order:
//   scanning → payment → card|cash → (card: processing → approved/declined)
//                                  → (cash: tender → change)
//            → receipt → bagging → done
// `voided` is the escape hatch: a customer who walks out, or a game reloaded
// mid-sale. It is a terminal stage that has moved no money.

// `prefer` is the customer's own payment habit, decided before they reach the till —
// some people are cash people. Left null, they make their mind up at the counter.
export function createTx({ items = [], mode = 'relaxed', discount = 0, rng = Math.random, prefer = null } = {}) {
  return {
    items: items.map((it) => ({
      uid: it.uid,
      skuId: it.skuId,
      name: it.name || it.skuId,
      priceCents: cents(it.price || 0),
      price: dollars(cents(it.price || 0)),
      scanned: false,
      bagged: false,
    })),
    mode,
    discount,
    prefer,
    stage: 'scanning',
    method: null,
    // card
    cardAttempts: 0,
    cardsTried: 0,
    cardResult: null,
    cardEntryCents: 0,
    cardEntryDigits: '',
    cardEntryError: null,
    // cash
    tendered: null,       // the pieces the customer physically handed over
    tenderedTotal: null,  // ...and what they were worth, before they get put away
    drawerOpen: false,
    deposited: false,   // the tendered cash has been put away in the till
    hand: {},           // what the player has picked up to hand back
    changeGiven: null,  // the amount actually handed across (required + any extra)
    lost: 0,            // + till is short (the allowed up-to-$5 extra change)
    rounding: 0,        // retained in receipts/save data for backward compatibility
    drawerStart: null,  // opening and working stacks stay local until completeSale
    drawerPending: null,
    // finish
    receiptPrinted: false,
    receiptPacked: false,
    rng,
  };
}

const round2 = (v) => Math.round(v * 100) / 100;
const itemOf = (tx, uid) => tx.items.find((i) => i.uid === uid);

// --- scanning -------------------------------------------------------------------

export function scanItem(tx, uid) {
  if (tx.stage !== 'scanning') return { ok: false, reason: 'Not ringing up right now.' };
  const it = itemOf(tx, uid);
  if (!it) return { ok: false, reason: 'That is not on this order.' };
  if (it.scanned) return { ok: false, reason: `${it.name} is already scanned.` };
  it.scanned = true;
  return { ok: true, item: it };
}

export function unscannedCount(tx) {
  return tx.items.filter((i) => !i.scanned).length;
}

export function allScanned(tx) {
  return tx.items.length > 0 && tx.items.every((i) => i.scanned);
}

// --- what is owed ---------------------------------------------------------------
// The subtotal counts SCANNED goods only. An unscanned item on the counter is a
// thing the register does not know about — which is exactly why you cannot pay.

export function subtotal(tx) {
  return dollars(tx.items
    .filter((item) => item.scanned)
    .reduce((sum, item) => sum
      + (Number.isInteger(item.priceCents) ? item.priceCents : cents(item.price)), 0));
}

export function discountOf(tx) {
  return dollars(cents(subtotal(tx) * (tx.discount || 0)));
}

export function totalOf(tx) {
  return dollars(cents(subtotal(tx)) - cents(discountOf(tx)));
}

export function cashTotalOf(tx) {
  return roundCash(totalOf(tx));
}

// what this transaction will actually take, given the method it is paying by
export function dueOf(tx) {
  return tx.method === 'cash' ? cashTotalOf(tx) : totalOf(tx);
}

// --- starting payment -----------------------------------------------------------

export function requestPayment(tx) {
  if (tx.stage !== 'scanning') return { ok: false, reason: 'Payment already started.' };
  if (!tx.items.length) return { ok: false, reason: 'Nothing to ring up.' };
  const left = unscannedCount(tx);
  if (left > 0) return { ok: false, reason: `Still ${left} to scan.` };

  // Live callers always supply `prefer` (the balanced-bag draw made when the
  // customer was created). The rng fallback is a neutral coin for bare tests.
  tx.method = tx.prefer || (tx.rng() < 0.5 ? 'card' : 'cash');
  if (tx.method === 'cash') {
    tx.rounding = round2(cashTotalOf(tx) - totalOf(tx));
    tx.stage = 'cash-tender';
  } else {
    tx.stage = 'card-present';
  }
  return { ok: true, method: tx.method };
}

// --- card ---------------------------------------------------------------------
// The terminal is a device with prompts, not a yes/no. The customer has to have
// the card OUT before the player can run it, a decline needs a *different* card,
// and a cancel drops all the way back so they can pay cash instead.

const DECLINE_CHANCE = 0.12; // first card; a second card is much likelier to clear

export function presentCard(tx) {
  if (tx.stage !== 'card-present') return { ok: false, reason: 'No card asked for.' };
  tx.stage = 'card-ready';
  tx.cardsTried = Math.max(1, tx.cardsTried);
  return { ok: true };
}

// The card reader authorizes only after the physical card has entered its chip
// slot. Keeping insertion as a distinct transaction verb prevents a renderer,
// test, or recovery path from jumping directly from presentation to approval.
export function insertCard(tx) {
  if (tx.stage !== 'card-ready') {
    return { ok: false, reason: tx.stage === 'card-declined' ? 'Use a different card.' : 'No card is ready to insert.' };
  }
  tx.cardEntryCents = 0;
  tx.cardEntryDigits = '';
  tx.cardEntryError = null;
  tx.stage = 'card-entry';
  return { ok: true };
}

export function cardEnteredAmount(tx) {
  return dollars(Math.max(0, Number(tx && tx.cardEntryCents) || 0));
}

export function enterCardDigit(tx, digit) {
  if (!tx || tx.stage !== 'card-entry') {
    return { ok: false, reason: 'The terminal is not accepting an amount.' };
  }
  const value = Number(digit);
  if (!Number.isInteger(value) || value < 0 || value > 9) {
    return { ok: false, reason: 'Enter one keypad digit.' };
  }
  const digits = `${tx.cardEntryDigits || ''}${value}`;
  if (digits.length > 8) return { ok: false, reason: 'That amount is too large.' };
  tx.cardEntryDigits = digits;
  tx.cardEntryCents = Number(digits);
  tx.cardEntryError = null;
  return { ok: true, amount: cardEnteredAmount(tx) };
}

export function backspaceCardAmount(tx) {
  if (!tx || tx.stage !== 'card-entry') {
    return { ok: false, reason: 'The terminal is not accepting an amount.' };
  }
  tx.cardEntryDigits = String(tx.cardEntryDigits || '').slice(0, -1);
  tx.cardEntryCents = Number(tx.cardEntryDigits || 0);
  tx.cardEntryError = null;
  return { ok: true, amount: cardEnteredAmount(tx) };
}

export function clearCardAmount(tx) {
  if (!tx || tx.stage !== 'card-entry') {
    return { ok: false, reason: 'The terminal is not accepting an amount.' };
  }
  tx.cardEntryCents = 0;
  tx.cardEntryDigits = '';
  tx.cardEntryError = null;
  return { ok: true, amount: 0 };
}

export function submitCardAmount(tx) {
  if (!tx || tx.stage !== 'card-entry') {
    return { ok: false, reason: 'The terminal is not accepting an amount.' };
  }
  const expectedCents = cents(totalOf(tx));
  const enteredCents = Number(tx.cardEntryCents) || 0;
  const empty = !String(tx.cardEntryDigits || '').length;
  if (empty || enteredCents !== expectedCents) {
    tx.cardEntryError = empty ? 'ENTER AMOUNT' : 'AMOUNT MUST MATCH TOTAL';
    return {
      ok: false,
      reason: empty
        ? 'Enter the transaction total.'
        : 'Entered amount must match the transaction total.',
      expected: dollars(expectedCents),
      entered: dollars(enteredCents),
    };
  }
  tx.cardEntryError = null;
  tx.stage = 'card-busy';
  return { ok: true, amount: dollars(enteredCents) };
}

export function runCard(tx, { timeout = false, force = null } = {}) {
  if (tx.stage !== 'card-busy') {
    return { ok: false, reason: tx.stage === 'card-declined' ? 'Declined — they need another card.' : 'No card presented.' };
  }
  tx.cardAttempts += 1;
  if (timeout) {
    tx.cardResult = 'timeout';
    tx.stage = 'card-declined';
    return { ok: true, result: 'timeout' };
  }
  // The live renderer forces a deterministic result: gameplay never declines a
  // card (force:'approved'). The rng path below still exists for the decline
  // mechanic that register-payment.test.js exercises.
  if (force === 'approved') {
    tx.cardResult = 'approved';
    tx.stage = 'receipt';
    return { ok: true, result: 'approved' };
  }
  if (force === 'declined') {
    tx.cardResult = 'declined';
    tx.stage = 'card-declined';
    return { ok: true, result: 'declined' };
  }
  // a second card clears far more often than the first — the first one was the
  // problem, not the person
  const chance = tx.cardsTried > 1 ? DECLINE_CHANCE * 0.25 : DECLINE_CHANCE;
  if (tx.rng() < chance) {
    tx.cardResult = 'declined';
    tx.stage = 'card-declined';
    return { ok: true, result: 'declined' };
  }
  tx.cardResult = 'approved';
  tx.stage = 'receipt';
  return { ok: true, result: 'approved' };
}

export function retryCard(tx) {
  if (tx.stage !== 'card-declined') return { ok: false, reason: 'Nothing to retry.' };
  tx.cardsTried += 1;
  tx.cardEntryCents = 0;
  tx.cardEntryDigits = '';
  tx.cardEntryError = null;
  tx.stage = 'card-ready';
  return { ok: true, cardsTried: tx.cardsTried };
}

export function cancelCard(tx) {
  if (!tx.stage.startsWith('card')) return { ok: false, reason: 'No card payment running.' };
  tx.cardResult = 'cancelled';
  tx.cardEntryCents = 0;
  tx.cardEntryDigits = '';
  tx.cardEntryError = null;
  tx.method = null;
  tx.stage = 'payment';   // they can choose again — cash, or another card
  return { ok: true };
}

// The cashier pulls a card run at the reader's X BEFORE the amount is submitted.
// The basket is intact and every item is still scanned, so the sale drops back
// to the post-scan choice point where the customer re-presents payment. This is
// only legal before authorization: never while it is in flight (card-busy) or
// resolved (declined/approved), so it can never double-settle or strand a paid
// customer.
export function abandonCardBeforeSubmit(tx) {
  if (tx.method !== 'card') return { ok: false, reason: 'No card run to pull.' };
  if (!['card-present', 'card-ready', 'card-entry'].includes(tx.stage)) {
    return { ok: false, reason: 'The card can only be pulled before the amount is submitted.' };
  }
  tx.cardResult = null;
  tx.cardEntryCents = 0;
  tx.cardEntryDigits = '';
  tx.cardEntryError = null;
  tx.method = null;
  tx.stage = 'scanning'; // items stay scanned+staged; the payment choice re-opens
  return { ok: true };
}

// they give up on plastic and reach for their wallet
export function payCashInstead(tx) {
  if (tx.stage !== 'payment') return { ok: false, reason: 'Not at the payment choice.' };
  tx.method = 'cash';
  tx.rounding = round2(cashTotalOf(tx) - totalOf(tx));
  tx.stage = 'cash-tender';
  return { ok: true };
}

// --- cash ---------------------------------------------------------------------
// The float the drawer opens with. A till that cannot break a fifty is a till
// that stalls the queue, so this is a real starting bank, not a token.

export function newDrawer() {
  return {
    50: 2,
    20: 5,
    10: 8,
    5: 10,
    1: 25,
    0.5: 16,
    0.25: 20,
    0.1: 20,
    0.05: 20,
    0.01: 50,
  };
}

// What a person actually pulls out of their wallet. Nobody counts out $66.55 in
// exact notes: they hand over the next clean step of bills and take the change.
// The exception is the customer who digs for the odd coins so the change comes
// back as whole notes instead of a fistful of shrapnel — about a third of people.
export function customerCash(tx) {
  const due = cashTotalOf(tx);
  const step = due > 100 ? 50 : due > 40 ? 20 : due > 15 ? 10 : 5;
  let amount = Math.ceil(round2(due) / step) * step;
  if (tx.rng() < 0.35) {
    const oddCents = Math.round(due * 100) % 100;
    if (oddCents > 0) amount = round2(amount + oddCents / 100);
  }
  tx.tendered = makeChange(amount);
  return tx.tendered;
}

// Change the till can ACTUALLY produce. Greedy over what is really in each slot:
// a drawer with no fives pays a ten out in singles. Returns null when the exact
// amount cannot be made from the pieces on hand — which is a real thing that
// happens to a real till, and which Relaxed mode has to know about before it
// promises the player a correct-change highlight it cannot honour.
export function makeChangeFrom(drawer, amount) {
  const target = cents(amount);
  if (target < 0) return null;
  const best = Array(target + 1).fill(null);
  best[0] = { pieces: 0, stack: {} };
  for (let i = 0; i < DENOMS.length; i++) {
    const d = DENOMS[i];
    const dc = DENOM_CENTS[i];
    const have = (drawer || {})[d] || 0;
    if (have <= 0) continue;
    const before = best.slice();
    for (let value = 0; value <= target; value += 1) {
      const base = before[value];
      if (!base) continue;
      const max = Math.min(have, Math.floor((target - value) / dc));
      for (let count = 1; count <= max; count += 1) {
        const nextValue = value + count * dc;
        const pieces = base.pieces + count;
        if (best[nextValue] && best[nextValue].pieces <= pieces) continue;
        best[nextValue] = {
          pieces,
          stack: { ...base.stack, [d]: count },
        };
      }
    }
  }
  return best[target] ? best[target].stack : null;
}

// Pre-cent-accurate saves contain no half-dollars or pennies. Rebalance a small
// part of that existing float into the new slots without creating or deleting
// value. The exchange is idempotent and leaves unusually sparse drawers alone
// when their current contents cannot fund the target slot.
export function migrateDrawer(drawer) {
  const out = copyStack(drawer);
  const openingCents = cents(stackTotal(out));
  const exchangeInto = (denom, minimumCount) => {
    const have = out[denom] || 0;
    const needed = minimumCount - have;
    if (needed <= 0) return;
    const source = { ...out };
    delete source[denom];
    const plan = makeChangeFrom(source, denom * needed);
    if (!plan) return;
    for (const [raw, count] of Object.entries(plan)) {
      const sourceDenom = Number(raw);
      out[sourceDenom] -= count;
      if (out[sourceDenom] <= 0) delete out[sourceDenom];
    }
    out[denom] = have + needed;
  };
  exchangeInto(0.01, 50);
  exchangeInto(0.5, 16);
  return cents(stackTotal(out)) === openingCents ? out : copyStack(drawer);
}

// What they handed over, remembered as a NUMBER — because the pieces themselves are
// about to be moved into the till one at a time, and `tendered` will empty out as
// they go. Reading the change owed off a stack that is being dismantled would walk
// it down to zero as the player put the money away.
export function changeDue(tx) {
  if (tx.method !== 'cash') return 0;
  const paid = tx.tenderedTotal != null ? tx.tenderedTotal : stackTotal(tx.tendered || {});
  return round2(Math.max(0, paid - cashTotalOf(tx)));
}

export function acceptCash(tx) {
  if (tx.stage !== 'cash-tender') return { ok: false, reason: 'No cash offered.' };
  if (!tx.tendered || !stackCount(tx.tendered)) return { ok: false, reason: 'They have not counted it out yet.' };
  tx.tenderedTotal = stackTotal(tx.tendered);
  tx.stage = 'cash-drawer';
  return { ok: true, taken: tx.tenderedTotal };
}

export function openDrawer(tx) {
  if (tx.stage !== 'cash-drawer') return { ok: false, reason: 'The drawer stays shut.' };
  tx.drawerOpen = true;
  return { ok: true };
}

export function closeDrawer(tx) {
  tx.drawerOpen = false;
  return { ok: true };
}

// The customer's money goes into the till, ONE PIECE AT A TIME, into its own slot.
// This has to happen before the sale can close, or the drawer balances short by
// exactly what they paid you.
export function depositPiece(tx, drawer, denom) {
  if (!tx.drawerOpen) return { ok: false, reason: 'Open the drawer first.' };
  const res = takeFromStack(tx.tendered || {}, denom);
  if (!res.ok) return { ok: false, reason: 'They did not give you one of those.' };
  const working = localDrawer(tx, drawer);
  tx.tendered = res.stack;
  working[denom] = (working[denom] || 0) + 1;
  tx.deposited = stackCount(tx.tendered) === 0;
  return { ok: true, deposited: tx.deposited, drawer: working };
}

// the whole handful at once — the tests and the Relaxed one-click path use this
export function depositTendered(tx, drawer) {
  if (!tx.drawerOpen) return { ok: false, reason: 'Open the drawer first.' };
  if (tx.deposited) return { ok: false, reason: 'Already put away.' };
  if (!tx.tendered || !stackCount(tx.tendered)) return { ok: false, reason: 'Nothing to put away.' };
  for (const [denom, n] of Object.entries({ ...tx.tendered })) {
    for (let i = 0; i < n; i++) depositPiece(tx, drawer, Number(denom));
  }
  return { ok: true, drawer: drawerContents(tx, drawer) };
}

export function takeFromDrawer(tx, drawer, denom) {
  if (!tx.drawerOpen) return { ok: false, reason: 'Open the drawer first.' };
  const working = localDrawer(tx, drawer);
  const res = takeFromStack(working, denom);
  if (!res.ok) return res;
  tx.drawerPending = res.stack;
  tx.hand = addToStack(tx.hand, denom);
  return { ok: true, drawer: tx.drawerPending };
}

export function returnToDrawer(tx, drawer, denom) {
  const res = takeFromStack(tx.hand, denom);
  if (!res.ok) return { ok: false, reason: 'Not holding one of those.' };
  const working = localDrawer(tx, drawer);
  tx.hand = res.stack;
  working[denom] = (working[denom] || 0) + 1;
  return { ok: true, drawer: working };
}

export function handTotal(tx) {
  return stackTotal(tx.hand);
}

// The register enforces the change window in EVERY mode: the customer always
// receives at least their full change (under-giving is impossible, not even by
// a cent), and the player may round up to at most $5.00 extra — a real courtesy
// the till pays for. `tx.lost` books that overage (+ = till short) and the
// exact amount handed across is remembered for the receipt.
export const MAX_EXTRA_CHANGE_CENTS = 500;

export function changeGivingState(tx) {
  const requiredCents = cents(changeDue(tx));
  const givingCents = cents(handTotal(tx));
  const deltaCents = givingCents - requiredCents;
  const state = deltaCents < 0 ? 'short'
    : deltaCents === 0 ? 'exact'
      : deltaCents <= MAX_EXTRA_CHANGE_CENTS ? 'over' : 'excess';
  return { requiredCents, givingCents, deltaCents, state };
}

export function handOverChange(tx, drawer) {
  if (tx.stage !== 'cash-drawer') return { ok: false, reason: 'No change to give.' };
  if (!tx.deposited) return { ok: false, reason: 'Put their money in the till first.' };
  const { deltaCents } = changeGivingState(tx);

  if (deltaCents < 0) {
    return { ok: false, reason: 'Not enough — count it again.' };
  }
  if (deltaCents > MAX_EXTRA_CHANGE_CENTS) {
    return { ok: false, reason: 'Too much — count it again.' };
  }

  tx.lost = dollars(deltaCents);
  tx.changeGiven = round2(handTotal(tx));
  tx.hand = {};
  tx.drawerOpen = false;
  tx.stage = 'receipt';
  return { ok: true, lost: tx.lost, given: tx.changeGiven };
}



// --- receipt ---------------------------------------------------------------------
// It prints, and then it is a physical thing on the printer that has to be picked
// up. That is the whole point: the paper exists.

export function printReceipt(tx) {
  if (tx.stage !== 'receipt') return { ok: false, reason: 'Nothing to print yet.' };
  if (tx.receiptPrinted) return { ok: false, reason: 'Already printed.' };
  tx.receiptPrinted = true;
  return {
    ok: true,
    receipt: {
      lines: tx.items.map((i) => ({ name: i.name, price: i.price })),
      subtotal: subtotal(tx),
      discount: discountOf(tx),
      // Cash receipts show what was actually due after nickel rounding. The
      // unrounded merchandise total remains derivable from subtotal/discount,
      // and `rounding` states the adjustment explicitly.
      total: dueOf(tx),
      method: tx.method,
      tendered: tx.method === 'cash' ? tx.tenderedTotal : null,
      change: tx.method === 'cash' ? changeDue(tx) : null,
      // what actually crossed the counter, and the courtesy overage if any
      changeGiven: tx.method === 'cash'
        ? (tx.changeGiven != null ? tx.changeGiven : changeDue(tx))
        : null,
      extraChange: tx.method === 'cash' ? round2(Math.max(0, tx.lost || 0)) : null,
      rounding: tx.rounding,
    },
  };
}

export function takeReceipt(tx) {
  if (tx.stage !== 'receipt') return { ok: false, reason: 'No receipt out.' };
  if (!tx.receiptPrinted) return { ok: false, reason: 'It has not printed yet.' };
  tx.stage = 'bagging';
  return { ok: true };
}

// The paper is part of the paid order, not renderer decoration.  Keeping this
// checkpoint on the transaction means no alternate caller can hand over a bag
// whose products are present while its receipt was left on the counter.
export function packReceipt(tx) {
  if (tx.stage !== 'bagging') return { ok: false, reason: 'Take the receipt first.' };
  if (!tx.receiptPrinted) return { ok: false, reason: 'It has not printed yet.' };
  if (tx.receiptPacked) return { ok: false, reason: 'The receipt is already in the bag.' };
  tx.receiptPacked = true;
  return { ok: true };
}

// --- bagging ---------------------------------------------------------------------

export function bagItem(tx, uid) {
  if (tx.stage !== 'bagging') return { ok: false, reason: 'Not bagging yet.' };
  const it = itemOf(tx, uid);
  if (!it) return { ok: false, reason: 'That is not on this order.' };
  if (it.bagged) return { ok: false, reason: `${it.name} is already in the bag.` };
  it.bagged = true;
  return { ok: true, item: it };
}

export function allBagged(tx) {
  return tx.items.length > 0 && tx.items.every((i) => i.bagged);
}

export function handOverGoods(tx) {
  if (tx.stage !== 'bagging') return { ok: false, reason: 'Not ready to hand over.' };
  if (!allBagged(tx)) {
    return { ok: false, reason: `${tx.items.filter((i) => !i.bagged).length} still to bag.` };
  }
  if (!tx.receiptPacked) return { ok: false, reason: 'Put the receipt in the bag first.' };
  tx.stage = 'done';
  return { ok: true };
}

// --- the end ---------------------------------------------------------------------
// THE ONLY PLACE MONEY MOVES. Everything above is a rehearsal; nothing is banked
// until the customer is walking away with the bag. A transaction that is voided,
// abandoned, or reloaded out from under us therefore costs the player nothing and
// earns them nothing, which is the whole invariant.

export function canComplete(tx) {
  return tx.stage === 'done'
    && tx.receiptPrinted === true
    && tx.receiptPacked === true
    && allBagged(tx);
}

export function voidTx(tx) {
  tx.stage = 'voided';
  tx.hand = {};
  tx.drawerOpen = false;
  tx.receiptPacked = false;
  // No persistent drawer entry was touched; discarding the local stacks is the
  // complete rollback, even after a JSON round-trip of the transaction object.
  tx.drawerStart = null;
  tx.drawerPending = null;
  return { ok: true };
}

// Bank it. Guarded on stage === 'done', so a transaction that was voided, is still
// being scanned, or has already completed cannot bank a second time.
function drawerCommitFor(state, tx) {
  if (tx.method !== 'cash') return { ok: true, cash: dueOf(tx), contents: null };
  if (!tx.deposited || !tx.drawerStart || !tx.drawerPending) {
    return { ok: false, reason: 'The cash has not been secured in the drawer.' };
  }
  if (stackCount(tx.hand) > 0 || tx.drawerOpen) {
    return { ok: false, reason: 'Finish the change and close the drawer first.' };
  }

  const current = state.shop.drawer || tx.drawerStart;
  if (!sameStack(current, tx.drawerStart)) {
    return { ok: false, reason: 'The drawer changed before this sale could bank.' };
  }

  const cash = round2(stackTotal(tx.drawerPending) - stackTotal(tx.drawerStart));
  const expected = round2(dueOf(tx) - (tx.lost || 0));
  if (cash !== expected) {
    return { ok: false, reason: 'The drawer does not balance with this transaction.' };
  }
  return { ok: true, cash, contents: copyStack(tx.drawerPending) };
}

function commitDrawer(state, contents) {
  if (!contents) return;
  const drawer = state.shop.drawer || {};
  for (const key of Object.keys(drawer)) delete drawer[key];
  Object.assign(drawer, contents);
  state.shop.drawer = drawer;
}

// Direct service charges (online reservation deposits and card-on-file no-show
// fees) have no physical register rehearsal, but they still need the same
// durable transaction numbering, ledger entry, and idempotency provenance as a
// completed counter payment. The stable reference is authoritative across
// save/load; a replay returns the original ticket without moving money again.
export function serviceTicketByReference(state, type, referenceId) {
  const history = state && state.shop && Array.isArray(state.shop.transactionHistory)
    ? state.shop.transactionHistory
    : [];
  return history.find((entry) => entry
    && entry.type === type
    && entry.referenceId === referenceId) || null;
}

export function bankServiceCharge(state, {
  type,
  referenceId,
  revenueKey = 'greenFees',
  amount,
  customer = 'A customer',
  customerId = null,
  method = 'card-on-file',
  skuId = 'service:charge',
  itemName = 'Service Charge',
  details = {},
  minute = state && state.clock ? state.clock.minutes : null,
} = {}) {
  if (
    !state
    || !state.shop
    || !state.ledger
    || !state.ledger.today
    || !state.ledger.today.revenue
    || !Number.isFinite(state.cash)
  ) {
    return { ok: false, reason: 'The club books are not available.' };
  }
  if (typeof type !== 'string' || !type.trim() || typeof referenceId !== 'string' || !referenceId.trim()) {
    return { ok: false, reason: 'The service charge has no stable reference.' };
  }
  if (revenueKey !== 'greenFees') {
    return { ok: false, reason: 'That service revenue line is not supported.' };
  }
  const total = round2(Number(amount));
  if (!Number.isFinite(total) || total < 0) {
    return { ok: false, reason: 'The service charge amount is invalid.' };
  }
  if (typeof method !== 'string' || !method.trim()) {
    return { ok: false, reason: 'The service charge has no payment method.' };
  }

  const existing = serviceTicketByReference(state, type, referenceId);
  if (existing) return { ok: true, already: true, total: existing.total, ticket: existing };

  const history = Array.isArray(state.shop.transactionHistory)
    ? state.shop.transactionHistory
    : (state.shop.transactionHistory = []);
  const greatestTicket = history.reduce(
    (greatest, ticket) => Math.max(greatest, Number(ticket && ticket.number) || 0),
    0,
  );
  const ticketNumber = Math.max(
    1,
    greatestTicket + 1,
    Number(state.shop.nextTransactionNo) || 1,
  );
  const ticket = {
    type,
    referenceId,
    number: ticketNumber,
    customer,
    customerId,
    method,
    total,
    cash: total,
    lost: 0,
    revenueKey,
    items: [{
      uid: `${referenceId}:charge`,
      skuId,
      name: itemName,
      price: total,
    }],
    details: { ...details },
    minute,
  };

  // All validation and duplicate detection is complete before this synchronous
  // accounting checkpoint. Zero-dollar tickets are allowed when a retained
  // deposit fully covers a no-show policy fee; they provide durable provenance
  // without moving money twice.
  if (total > 0) addRevenue(state, revenueKey, total);
  state.shop.nextTransactionNo = ticketNumber + 1;
  history.unshift(ticket);
  if (history.length > 100) history.length = 100;
  if (!Array.isArray(state.shop.log)) state.shop.log = [];
  state.shop.log.unshift(`${customer} paid ${total.toFixed(2)} for ${itemName.toLowerCase()}`);
  if (state.shop.log.length > 8) state.shop.log.pop();

  return { ok: true, already: false, total, ticket };
}

// Services use the same payment rehearsal as merchandise (card approval or a
// transaction-local cash drawer), but have a deliberately separate bank path.
// In particular this function never calls consumeHeldBatch(), liveSales(), or
// recordSale().  A green fee must not masquerade as shelf stock just because it
// was paid at the same physical terminal.
//
// `referenceId` is the idempotency key.  Keeping it in persisted transaction
// history prevents a freshly-created transaction from banking the same service
// again after a save/load or renderer restart.
export function completeServicePayment(state, tx, {
  type,
  referenceId,
  revenueKey = 'greenFees',
  expectedTotal,
  customer = 'A customer',
  details = {},
} = {}) {
  if (
    !state
    || !state.shop
    || !state.ledger
    || !state.ledger.today
    || !state.ledger.today.revenue
    || !Number.isFinite(state.cash)
  ) {
    return { ok: false, reason: 'The club books are not available.' };
  }
  if (!tx || !canComplete(tx)) return { ok: false, reason: 'The service payment is not finished.' };
  if (tx.banked) return { ok: false, reason: 'Already banked.' };
  if (tx.kind !== 'service' || !tx.servicePayment) {
    return { ok: false, reason: 'This is not a service payment.' };
  }
  if (typeof type !== 'string' || !type.trim() || typeof referenceId !== 'string' || !referenceId.trim()) {
    return { ok: false, reason: 'The service payment has no stable reference.' };
  }
  if (revenueKey !== 'greenFees') {
    return { ok: false, reason: 'That service revenue line is not supported at this desk.' };
  }

  const service = tx.servicePayment;
  const amount = round2(Number(expectedTotal));
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, reason: 'The service amount is invalid.' };
  }
  if (
    service.type !== type
    || service.referenceId !== referenceId
    || service.revenueKey !== revenueKey
    || round2(Number(service.amount)) !== amount
  ) {
    return { ok: false, reason: 'The service reference does not match this payment.' };
  }
  if (round2(totalOf(tx)) !== amount || round2(dueOf(tx)) !== amount) {
    return { ok: false, reason: 'The paid amount no longer matches the service total.' };
  }
  if (!Number.isFinite(tx.lost || 0)) {
    return { ok: false, reason: 'The cash variance is invalid.' };
  }
  if (tx.method === 'card' && tx.cardResult !== 'approved') {
    return { ok: false, reason: 'The card payment was not approved.' };
  }
  if (tx.method !== 'card' && tx.method !== 'cash') {
    return { ok: false, reason: 'The service has no completed payment method.' };
  }

  const history = Array.isArray(state.shop.transactionHistory) ? state.shop.transactionHistory : [];
  if (history.some((entry) => entry
    && entry.type === type
    && entry.referenceId === referenceId)) {
    return { ok: false, reason: 'That service payment is already banked.' };
  }

  // Every check above is side-effect free.  Drawer validation is also performed
  // against the transaction-local journal before the first persistent mutation.
  const drawerCommit = drawerCommitFor(state, tx);
  if (!drawerCommit.ok) return drawerCommit;

  const greatestTicket = history.reduce(
    (greatest, ticket) => Math.max(greatest, Number(ticket && ticket.number) || 0),
    0,
  );
  const ticketNumber = Math.max(
    1,
    greatestTicket + 1,
    Number(state.shop.nextTransactionNo) || 1,
  );
  const ticket = {
    type,
    referenceId,
    number: ticketNumber,
    customer,
    customerId: details.customerId || null,
    method: tx.method,
    total: amount,
    cash: drawerCommit.cash,
    lost: tx.lost || 0,
    revenueKey,
    items: tx.items.map((item) => ({
      uid: item.uid,
      skuId: item.skuId,
      name: item.name,
      price: item.price,
    })),
    details: { ...details },
    minute: state.clock ? state.clock.minutes : null,
  };

  // Commit as one synchronous checkpoint.  The fallible validations are above;
  // these operations only replace the verified drawer journal and append books.
  commitDrawer(state, drawerCommit.contents);
  addRevenue(state, revenueKey, amount);
  if (tx.lost > 0) addExpense(state, 'cashOverShort', tx.lost);
  else if (tx.lost < 0) addRevenue(state, 'cashOverShort', -tx.lost);

  tx.banked = true;
  tx.number = ticketNumber;
  tx.stage = 'done';
  tx.drawerStart = null;
  tx.drawerPending = null;
  state.shop.nextTransactionNo = ticketNumber + 1;
  if (!Array.isArray(state.shop.transactionHistory)) state.shop.transactionHistory = history;
  state.shop.transactionHistory.unshift(ticket);
  if (state.shop.transactionHistory.length > 100) state.shop.transactionHistory.length = 100;

  if (!Array.isArray(state.shop.log)) state.shop.log = [];
  state.shop.log.unshift(`${customer} paid ${amount.toFixed(2)} at check-in`);
  if (state.shop.log.length > 8) state.shop.log.pop();

  return {
    ok: true,
    total: amount,
    cash: drawerCommit.cash,
    lost: tx.lost || 0,
    ticket,
  };
}

export function completeSale(state, tx, who = 'A customer') {
  if (!canComplete(tx)) return { ok: false, reason: 'The sale is not finished.' };
  if (tx.banked) return { ok: false, reason: 'Already banked.' };

  // Check every fallible invariant before touching stock, drawer, or books.
  const drawerCommit = drawerCommitFor(state, tx);
  if (!drawerCommit.ok) return drawerCommit;
  const consumed = consumeHeldBatch(state, tx.items);
  if (!consumed.ok) return consumed;
  commitDrawer(state, drawerCommit.contents);

  const total = dueOf(tx);
  addRevenue(state, 'shopSales', total);

  // Keep the merchandise ticket intact, then book the drawer variance so the
  // ledger cash reconciles with the physical till in both directions.
  if (tx.lost > 0) addExpense(state, 'cashOverShort', tx.lost);
  else if (tx.lost < 0) addRevenue(state, 'cashOverShort', -tx.lost);

  const live = liveSales(state);
  live.units += tx.items.length;
  live.revenue = round2(live.revenue + total);

  // The held batch was consumed before banking; now feed the same items into the
  // per-SKU velocity tally used by Inventory and Analytics.
  for (const it of tx.items) {
    recordSale(state, it.skuId);
  }

  tx.banked = true;
  tx.stage = 'done';
  tx.drawerStart = null;
  tx.drawerPending = null;

  const customerName = typeof who === 'object' && who
    ? (who.fullName || who.name || 'A customer')
    : who;
  const customerId = typeof who === 'object' && who ? (who.customerId || null) : null;
  const names = tx.items.map((i) => i.name);
  state.shop.log.unshift(`${customerName} bought ${names.join(' + ')} at the counter (${Math.round(total)} dollars)`);
  if (state.shop.log.length > 8) state.shop.log.pop();

  const history = state.shop.transactionHistory || (state.shop.transactionHistory = []);
  const ticketNumber = Math.max(1, Number(tx.number || state.shop.nextTransactionNo || history.length + 1));
  tx.number = ticketNumber;
  state.shop.nextTransactionNo = Math.max(
    Number(state.shop.nextTransactionNo || 1),
    ticketNumber + 1,
  );
  history.unshift({
    number: ticketNumber,
    customer: customerName,
    customerId,
    method: tx.method,
    total,
    cash: drawerCommit.cash,
    lost: tx.lost || 0,
    tendered: tx.method === 'cash' ? tx.tenderedTotal : null,
    changeGiven: tx.method === 'cash'
      ? (tx.changeGiven != null ? tx.changeGiven : changeDue(tx))
      : null,
    extraChange: tx.method === 'cash' ? round2(Math.max(0, tx.lost || 0)) : null,
    items: tx.items.map((item) => ({ uid: item.uid, skuId: item.skuId, name: item.name, price: item.price })),
    minute: state.clock ? state.clock.minutes : null,
  });
  if (history.length > 100) history.length = 100;

  return { ok: true, total, cash: drawerCommit.cash, lost: tx.lost };
}

// --- the scan volume ----------------------------------------------------------------
// A SWEPT test, not a point test, and the difference is the whole mechanic.
//
// The player drags an item across the scanner with a mouse, and a mouse moves in
// jumps. At 60 fps a fast flick carries the barcode a third of a yard between one
// frame and the next — clean over a 0.56 yd scan volume and out the far side, never
// once sampled INSIDE it. A point-in-box check would miss that scan. The item would
// land in the bag unscanned, the player would swear blind they scanned it, and the
// register would refuse to take payment.
//
// So: the segment the barcode actually travelled this frame, against the box.
// Slab method — clip the segment's parameter range against each axis in turn; if
// anything survives all three, the path went through the box.
export function segmentHitsBox(p0, p1, box) {
  const lo = [box.minX, box.minY, box.minZ];
  const hi = [box.maxX, box.maxY, box.maxZ];
  const a = [p0.x, p0.y, p0.z];
  const b = [p1.x, p1.y, p1.z];

  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = b[i] - a[i];
    if (Math.abs(d) < 1e-9) {
      // parallel to this slab: it either starts inside it or it never gets in
      if (a[i] < lo[i] || a[i] > hi[i]) return false;
      continue;
    }
    let n = (lo[i] - a[i]) / d;
    let f = (hi[i] - a[i]) / d;
    if (n > f) { const tmp = n; n = f; f = tmp; }
    if (n > t0) t0 = n;
    if (f < t1) t1 = f;
    if (t0 > t1) return false;
  }
  return true;
}
