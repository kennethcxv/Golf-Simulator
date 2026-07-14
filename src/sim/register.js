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

import { addRevenue } from './economy.js';
import { liveSales, consumeHeld } from './checkout.js';
import { recordSale } from './shop.js';

// --- currency -----------------------------------------------------------------
// Shop prices land on arbitrary cents (a $34 polo at 1.15 markup with a 5%
// member discount is $37.15) but there is no penny in the drawer. CASH rounds to
// the nearest nickel — what Canada, Australia and NZ each did when they retired
// the one-cent coin — and CARD takes the exact cent. That is why the cash total
// and the card total for one basket can differ by up to two cents, and why the
// rounding is recorded rather than quietly pocketed.

export const BILLS = [50, 20, 10, 5, 1];
export const COINS = [0.25, 0.1, 0.05];
export const DENOMS = [...BILLS, ...COINS];

const cents = (v) => Math.round(v * 100);
const dollars = (c) => c / 100;
const DENOM_CENTS = DENOMS.map(cents); // [5000, 2000, 1000, 500, 100, 25, 10, 5]

export function roundCash(v) {
  return dollars(Math.round(cents(v) / 5) * 5);
}

// greedy is optimal for this denomination set (each denom divides the next up),
// so the fewest-pieces guarantee holds without a knapsack
export function makeChange(amount) {
  let left = Math.round(cents(amount) / 5) * 5; // change is always payable in nickels
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
      price: it.price || 0,
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
    // cash
    tendered: null,       // the pieces the customer physically handed over
    tenderedTotal: null,  // ...and what they were worth, before they get put away
    drawerOpen: false,
    deposited: false,   // the tendered cash has been put away in the till
    hand: {},           // what the player has picked up to hand back
    lost: 0,            // + till is short (over-handed), − customer was shorted
    rounding: 0,        // the nickel rounding on a cash sale, recorded not pocketed
    // finish
    receiptPrinted: false,
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
  return round2(tx.items.filter((i) => i.scanned).reduce((a, i) => a + i.price, 0));
}

export function discountOf(tx) {
  return round2(subtotal(tx) * (tx.discount || 0));
}

export function totalOf(tx) {
  return round2(subtotal(tx) - discountOf(tx));
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

  tx.method = tx.prefer || (tx.rng() < 0.4 ? 'card' : 'cash');
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

export function runCard(tx, { timeout = false } = {}) {
  if (tx.stage !== 'card-ready') {
    return { ok: false, reason: tx.stage === 'card-declined' ? 'Declined — they need another card.' : 'No card presented.' };
  }
  tx.cardAttempts += 1;
  if (timeout) {
    tx.cardResult = 'timeout';
    tx.stage = 'card-declined';
    return { ok: true, result: 'timeout' };
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
  tx.stage = 'card-ready';
  return { ok: true, cardsTried: tx.cardsTried };
}

export function cancelCard(tx) {
  if (!tx.stage.startsWith('card')) return { ok: false, reason: 'No card payment running.' };
  tx.cardResult = 'cancelled';
  tx.method = null;
  tx.stage = 'payment';   // they can choose again — cash, or another card
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
  return { 20: 5, 10: 8, 5: 10, 1: 25, 0.25: 20, 0.1: 20, 0.05: 20 };
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
  let left = Math.round(round2(amount) * 100 / 5) * 5;
  const out = {};
  for (let i = 0; i < DENOMS.length; i++) {
    const d = DENOMS[i];
    const dc = DENOM_CENTS[i];
    const want = Math.floor(left / dc);
    const have = (drawer || {})[d] || 0;
    const n = Math.min(want, have);
    if (n > 0) {
      out[d] = n;
      left -= n * dc;
    }
  }
  return left === 0 ? out : null;
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
  tx.tendered = res.stack;
  drawer[denom] = (drawer[denom] || 0) + 1;
  tx.deposited = stackCount(tx.tendered) === 0;
  return { ok: true, deposited: tx.deposited };
}

// the whole handful at once — the tests and the Relaxed one-click path use this
export function depositTendered(tx, drawer) {
  if (!tx.drawerOpen) return { ok: false, reason: 'Open the drawer first.' };
  if (tx.deposited) return { ok: false, reason: 'Already put away.' };
  if (!tx.tendered || !stackCount(tx.tendered)) return { ok: false, reason: 'Nothing to put away.' };
  for (const [denom, n] of Object.entries({ ...tx.tendered })) {
    for (let i = 0; i < n; i++) depositPiece(tx, drawer, Number(denom));
  }
  return { ok: true };
}

export function takeFromDrawer(tx, drawer, denom) {
  if (!tx.drawerOpen) return { ok: false, reason: 'Open the drawer first.' };
  const res = takeFromStack(drawer, denom);
  if (!res.ok) return res;
  for (const k of Object.keys(drawer)) delete drawer[k];
  Object.assign(drawer, res.stack);
  tx.hand = addToStack(tx.hand, denom);
  return { ok: true };
}

export function returnToDrawer(tx, drawer, denom) {
  const res = takeFromStack(tx.hand, denom);
  if (!res.ok) return { ok: false, reason: 'Not holding one of those.' };
  tx.hand = res.stack;
  drawer[denom] = (drawer[denom] || 0) + 1;
  return { ok: true };
}

export function handTotal(tx) {
  return stackTotal(tx.hand);
}

// Relaxed refuses a miscount and keeps the drawer open. Realistic takes the
// player at their word and books the difference: + means the till came up short
// because you over-handed, − means you shorted the customer.
export function handOverChange(tx, drawer) {
  if (tx.stage !== 'cash-drawer') return { ok: false, reason: 'No change to give.' };
  if (!tx.deposited) return { ok: false, reason: 'Put their money in the till first.' };
  const due = changeDue(tx);
  const held = handTotal(tx);
  const diff = round2(held - due);

  if (diff !== 0 && tx.mode === 'relaxed') {
    return {
      ok: false,
      reason: diff > 0 ? 'Too much — count it again.' : 'Not enough — count it again.',
    };
  }

  tx.lost = diff;
  tx.hand = {};
  tx.drawerOpen = false;
  tx.stage = 'receipt';
  return { ok: true, lost: diff };
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
      total: totalOf(tx),
      method: tx.method,
      tendered: tx.method === 'cash' ? stackTotal(tx.tendered) : null,
      change: tx.method === 'cash' ? changeDue(tx) : null,
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
  tx.stage = 'done';
  return { ok: true };
}

// --- the end ---------------------------------------------------------------------
// THE ONLY PLACE MONEY MOVES. Everything above is a rehearsal; nothing is banked
// until the customer is walking away with the bag. A transaction that is voided,
// abandoned, or reloaded out from under us therefore costs the player nothing and
// earns them nothing, which is the whole invariant.

export function canComplete(tx) {
  return tx.stage === 'done';
}

export function voidTx(tx) {
  tx.stage = 'voided';
  tx.hand = {};
  tx.drawerOpen = false;
  return { ok: true };
}

// Bank it. Guarded on stage === 'done', so a transaction that was voided, is still
// being scanned, or has already completed cannot bank a second time.
export function completeSale(state, tx, who = 'A customer') {
  if (!canComplete(tx)) return { ok: false, reason: 'The sale is not finished.' };
  if (tx.banked) return { ok: false, reason: 'Already banked.' };

  const total = dueOf(tx);
  addRevenue(state, 'shopSales', total);

  // a miscount in Realistic mode: the till is short what you over-handed (or the
  // customer was shorted, which comes back as goodwill, not cash)
  if (tx.lost > 0) addRevenue(state, 'shopSales', -tx.lost);

  const live = liveSales(state);
  live.units += tx.items.length;
  live.revenue = round2(live.revenue + total);

  // the goods leave the building — off the held ledger for good, and onto the per-SKU tally
  // the Inventory and Analytics pages read their velocity from. A sale rung up by hand is
  // still a sale; leaving it out would make every velocity on the laptop quietly wrong.
  for (const it of tx.items) {
    consumeHeld(state, it.uid);
    recordSale(state, it.skuId);
  }

  tx.banked = true;
  tx.stage = 'done';

  const names = tx.items.map((i) => i.name);
  state.shop.log.unshift(`${who} bought ${names.join(' + ')} at the counter (${Math.round(total)} dollars)`);
  if (state.shop.log.length > 8) state.shop.log.pop();

  return { ok: true, total, lost: tx.lost };
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
