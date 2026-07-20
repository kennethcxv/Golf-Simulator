// THE CHANGE WINDOW. The player may hand the customer their exact change, or up
// to $5.00 more as a courtesy — never a cent less, in any mode. The courtesy
// overage is real store money: it leaves the drawer, books as a cash-over-short
// expense, and appears on the receipt. This file is the full acceptance matrix.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  createTx, scanItem, requestPayment, acceptCash, openDrawer, depositTendered,
  takeFromDrawer, handOverChange, changeGivingState, MAX_EXTRA_CHANGE_CENTS,
  printReceipt, takeReceipt, packReceipt, bagItem, handOverGoods, completeSale,
  newDrawer, makeChange, stackTotal, changeDue, handTotal,
} from '../src/sim/register.js';
import { pickFromShelf, heldUnits } from '../src/sim/checkout.js';

const round2 = (value) => Math.round(value * 100) / 100;

// A cash sale paused at the change-counting step, with `required` change due.
function txAtChange(state, { price = 10, required = 4.28, uid = 'tol-unit', mode = 'relaxed' } = {}) {
  const inv = state.shop.inventory.balls3;
  if (inv.shelf <= 0) inv.shelf = 1;
  assert.equal(pickFromShelf(state, 'balls3', uid).ok, true);
  if (!state.shop.drawer) state.shop.drawer = newDrawer();
  const tx = createTx({
    items: [{ uid, skuId: 'balls3', name: 'Tour dozen', price }],
    mode,
    prefer: 'cash',
    rng: () => 0.9,
  });
  scanItem(tx, uid);
  requestPayment(tx);
  tx.tendered = makeChange(round2(price + required));
  acceptCash(tx);
  openDrawer(tx);
  depositTendered(tx, state.shop.drawer);
  return tx;
}

function give(tx, drawer, amount) {
  for (const [denom, n] of Object.entries(makeChange(amount))) {
    for (let i = 0; i < n; i += 1) {
      assert.equal(takeFromDrawer(tx, drawer, Number(denom)).ok, true, `drawer had a ${denom}`);
    }
  }
}

function finish(tx) {
  const printed = printReceipt(tx);
  assert.equal(printed.ok, true);
  takeReceipt(tx);
  packReceipt(tx);
  for (const item of tx.items) bagItem(tx, item.uid);
  handOverGoods(tx);
  return printed.receipt;
}

// --- the acceptance matrix ---------------------------------------------------

const MATRIX = [
  { required: 4.28, giving: 4.27, ok: false, state: 'short' },
  { required: 4.28, giving: 4.28, ok: true, state: 'exact' },
  { required: 4.28, giving: 4.29, ok: true, state: 'over' },
  { required: 4.28, giving: 5.00, ok: true, state: 'over' },
  { required: 4.28, giving: 9.28, ok: true, state: 'over' },
  { required: 4.28, giving: 9.29, ok: false, state: 'excess' },
  { required: 0.01, giving: 0.00, ok: false, state: 'short' },
  { required: 0.01, giving: 0.01, ok: true, state: 'exact' },
  { required: 0.01, giving: 5.01, ok: true, state: 'over' },
  { required: 0.01, giving: 5.02, ok: false, state: 'excess' },
  { required: 0.00, giving: 0.00, ok: true, state: 'exact' },
  { required: 0.00, giving: 5.00, ok: true, state: 'over' },
  { required: 0.00, giving: 5.01, ok: false, state: 'excess' },
];

for (const { required, giving, ok, state: expected } of MATRIX) {
  test(`required $${required.toFixed(2)}: giving $${giving.toFixed(2)} ${ok ? 'completes' : 'is refused'} (${expected})`, () => {
    const state = newGame('relaxed', 4280);
    state.shop.drawer = newDrawer();
    const tx = txAtChange(state, { required });
    assert.equal(changeDue(tx), required);
    if (giving > 0) give(tx, state.shop.drawer, giving);
    assert.equal(handTotal(tx), giving);

    const gs = changeGivingState(tx);
    assert.equal(gs.state, expected, 'the UI state matches the rule');
    assert.equal(gs.deltaCents, Math.round(giving * 100) - Math.round(required * 100));

    const res = handOverChange(tx, state.shop.drawer);
    assert.equal(res.ok, ok);
    if (ok) {
      assert.equal(tx.stage, 'receipt');
      assert.equal(round2(tx.lost), round2(giving - required));
      assert.equal(tx.changeGiven, giving);
    } else {
      assert.equal(tx.stage, 'cash-drawer', 'the drawer stays open for a recount');
      assert.equal(tx.lost, 0);
      assert.equal(handTotal(tx), giving, 'the counted hand is untouched');
    }
  });
}

test('the ceiling constant is five dollars in cents', () => {
  assert.equal(MAX_EXTRA_CHANGE_CENTS, 500);
});

// --- the economy effect ------------------------------------------------------

test('extra change leaves the drawer, reduces club cash, books an expense, and prints on the receipt — exactly once', () => {
  const state = newGame('relaxed', 4281);
  state.shop.drawer = newDrawer();
  const opening = stackTotal(state.shop.drawer);
  const cashBefore = state.cash;

  // total $10, tendered $14.28, required change $4.28, given $5.00 (over by $0.72)
  const tx = txAtChange(state, { price: 10, required: 4.28 });
  give(tx, state.shop.drawer, 5.00);
  assert.equal(handOverChange(tx, state.shop.drawer).ok, true);

  const receipt = finish(tx);
  assert.equal(receipt.tendered, 14.28);
  assert.equal(receipt.change, 4.28, 'required change');
  assert.equal(receipt.changeGiven, 5.00, 'what actually crossed the counter');
  assert.equal(receipt.extraChange, 0.72, 'the courtesy overage is itemised');

  const result = completeSale(state, tx, 'Round-up customer');
  assert.equal(result.ok, true);
  assert.equal(result.total, 10);
  assert.equal(round2(result.cash), 9.28, 'the drawer keeps tender minus given change');
  assert.equal(round2(stackTotal(state.shop.drawer) - opening), 9.28);
  assert.equal(round2(state.cash - cashBefore), 9.28, 'club cash gains the sale minus the extra');
  assert.equal(state.ledger.today.revenue.shopSales, 10, 'gross sale accounting is preserved');
  assert.equal(state.ledger.today.expense.cashOverShort, 0.72, 'the extra is its own expense line');
  assert.deepEqual(heldUnits(state), []);

  const ticket = state.shop.transactionHistory[0];
  assert.equal(ticket.extraChange, 0.72, 'history keeps the overage');
  assert.equal(ticket.changeGiven, 5.00);
  assert.equal(ticket.tendered, 14.28);

  // exactly once: the same transaction cannot bank again
  assert.equal(completeSale(state, tx, 'Round-up customer').ok, false);

  // and a save/load round-trip does not reapply any part of the settlement
  const reloaded = deserialize(serialize(state));
  assert.equal(reloaded.cash, state.cash);
  assert.equal(reloaded.ledger.today.expense.cashOverShort, 0.72);
  assert.equal(round2(stackTotal(reloaded.shop.drawer) - opening), 9.28);
  assert.equal(reloaded.shop.transactionHistory[0].extraChange, 0.72);
});

test('exact change books no expense and the receipt shows zero extra', () => {
  const state = newGame('relaxed', 4282);
  state.shop.drawer = newDrawer();
  const cashBefore = state.cash;
  const tx = txAtChange(state, { price: 10, required: 4.28 });
  give(tx, state.shop.drawer, 4.28);
  assert.equal(handOverChange(tx, state.shop.drawer).ok, true);
  const receipt = finish(tx);
  assert.equal(receipt.changeGiven, 4.28);
  assert.equal(receipt.extraChange, 0);
  const result = completeSale(state, tx, 'Exact customer');
  assert.equal(result.ok, true);
  assert.equal(round2(state.cash - cashBefore), 10);
  assert.equal(state.ledger.today.expense.cashOverShort || 0, 0);
});
