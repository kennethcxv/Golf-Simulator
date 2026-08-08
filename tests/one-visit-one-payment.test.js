// G13 — ONE VISIT, ONE PAYMENT.
//
// The brief writes the flow it wants as six numbered steps:
//
//   1. they collect items from the shelves
//   2. they come to the desk and put the items down
//   3. I scan each item
//   4. then they ask for their tee time
//   5. I book or check in
//   6. I charge them for the items and the green fee together
//      - ONE TRANSACTION, ONE PAYMENT.
//
// Step 6 was not mistuned, it was absent. `beginReservationPayment` refused to
// start while a goods ticket was open, `createReservationCheckInTx` built its
// own ticket carrying exactly one virtual line, and `completeServicePayment`
// posted the WHOLE ticket total to greenFees. Two tickets was the only
// reachable flow, and the merge was named as a seam by the previous goal and
// left unbuilt.
//
// This file is the contract for the merged ticket. The part that matters most
// is not that the two can ride together - it is that the MONEY STILL LANDS ON
// THE RIGHT LINES when they do. A combined ticket that banks the shirt as green
// fee revenue is worse than two tickets, because it is wrong quietly.

import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import { bookSlot, reservationById } from '../src/sim/reservations.js';
import { pickFromShelf, heldUnits } from '../src/sim/checkout.js';
import {
  createTx, scanItem, completeSale, requestPayment, presentCard, insertCard,
  submitCardAmount, enterCardDigit, runCard, totalOf, taxOf,
  printReceipt, takeReceipt, packReceipt, bagItem, allBagged, handOverGoods,
  serviceLinesOf, goodsLinesOf,
} from '../src/sim/register.js';
import {
  attachGreenFeeToTx,
  finalizeReservationCheckIn,
  GREEN_FEE_SKU,
} from '../src/sim/reservationCheckIn.js';

const rngFor = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };
const round2 = (v) => Math.round(v * 100) / 100;

const confirmExactAmount = (tx) => {
  for (const d of String(Math.round(totalOf(tx) * 100))) enterCardDigit(tx, Number(d));
  return submitCardAmount(tx);
};

function reserve(state, name = 'Ray Falk', minute = 480) {
  const day = calendarOf(state.clock.minutes).dayAbs + 1;
  const made = bookSlot(state, day, minute, name);
  assert.equal(made.ok, true);
  return made.res;
}

// Step 1: the customer actually lifts them off the shelf, so the stock the sale
// consumes is stock that really moved.
function collectFromShelves(state, tx) {
  for (const item of tx.items) {
    if (heldUnits(state).some((u) => u.uid === item.uid)) continue;
    // The repo's established idiom for putting a unit on the shelf in a test.
    // Note it only carries ONE pick: the count guard passes but the underlying
    // lot is finite, so a second ticket for the same SKU fails at the lot plan.
    const inv = state.shop.inventory[item.skuId];
    if (inv.shelf <= 0) inv.shelf = 1;
    const picked = pickFromShelf(state, item.skuId, item.uid);
    assert.equal(picked.ok, true, `${item.skuId}: ${picked.reason}`);
  }
}

// Steps 1-3: goods on the counter, every one scanned.
function goodsOnCounter(state, mode = 'relaxed', tag = 'a') {
  const tx = createTx({
    items: [
      { uid: `${tag}1`, skuId: 'balls3', name: 'Pro-V dozen', price: 47 },
      { uid: `${tag}2`, skuId: 'glove1', name: 'Cabretta glove', price: 19 },
    ],
    mode,
    rng: rngFor([0.1, 0.9]),
  });
  collectFromShelves(state, tx);
  for (const it of tx.items) scanItem(tx, it.uid);
  return tx;
}

// Step 6, physically: one card, one approval.
function payOnce(tx) {
  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  assert.equal(confirmExactAmount(tx).ok, true);
  assert.equal(runCard(tx).result, 'approved');
  assert.equal(printReceipt(tx).ok, true);
  assert.equal(takeReceipt(tx).ok, true);
  assert.equal(packReceipt(tx).ok, true);
  for (const item of tx.items) if (!item.bagged) bagItem(tx, item.uid);
  assert.equal(allBagged(tx), true, 'a tee time is not something you put in a bag');
  assert.equal(handOverGoods(tx).ok, true);
}

test('the tee time joins the ticket the goods are already on', () => {
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);

  const attached = attachGreenFeeToTx(state, tx, res.id);
  assert.equal(attached.ok, true, 'step 5 must be reachable with goods on the counter');

  // one ticket, three lines, and the fee is one of them
  assert.equal(tx.items.length, 3);
  const fee = tx.items.find((i) => i.skuId === GREEN_FEE_SKU);
  assert.ok(fee, 'the green fee is a line on this ticket');
  assert.equal(fee.scanned, true, 'a tee time is not scanned with a barcode gun');
  assert.equal(round2(fee.price), round2(res.fee));
});

test('the ticket total is the goods plus the fee', () => {
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  const goodsTotal = totalOf(tx);

  attachGreenFeeToTx(state, tx, res.id);
  assert.equal(round2(totalOf(tx)), round2(goodsTotal + res.fee),
    'one number to read out to the customer');
});

test('golf is still not taxed just because it rode in with a shirt', () => {
  // The green fee is deliberately untaxed - whether a round is a taxable
  // service varies by state and is not a thing to guess at inside a check-in.
  // Merging must not quietly start charging sales tax on golf.
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  tx.taxRate = 0.07;
  const taxOnGoodsAlone = round2(taxOf(tx));

  attachGreenFeeToTx(state, tx, res.id);
  assert.equal(round2(taxOf(tx)), taxOnGoodsAlone,
    'the fee must not enter the taxable base');
});

test('one payment, and the money lands on BOTH revenue lines', () => {
  const state = newGame();
  const res = reserve(state);
  const before = {
    shop: state.ledger.today.revenue.shopSales || 0,
    green: state.ledger.today.revenue.greenFees || 0,
  };
  const tx = goodsOnCounter(state);
  const goodsTotal = totalOf(tx);
  attachGreenFeeToTx(state, tx, res.id);
  payOnce(tx);

  const done = finalizeReservationCheckIn(state, tx, res.id);
  assert.equal(done.ok, true, done.reason);

  const after = {
    shop: state.ledger.today.revenue.shopSales || 0,
    green: state.ledger.today.revenue.greenFees || 0,
  };
  // THE WHOLE POINT: the split is by line, not by ticket.
  assert.equal(round2(after.green - before.green), round2(res.fee),
    'greenFees moves by the fee and not a penny more');
  assert.equal(round2(after.shop - before.shop), round2(goodsTotal),
    'shopSales moves by the goods and not a penny more');
});

test('it is one ticket number and one payment method, not two', () => {
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  attachGreenFeeToTx(state, tx, res.id);
  payOnce(tx);
  const done = finalizeReservationCheckIn(state, tx, res.id);
  assert.equal(done.ok, true, done.reason);

  const booking = reservationById(state, res.id);
  assert.equal(booking.status, 'played', 'the round is checked in');
  assert.equal(booking.paymentMethod, 'card');
  // the reservation points at the SAME ticket the shirt was on
  assert.equal(booking.checkInTransactionNumber, done.ticket.number);
});

test('the same booking cannot be checked in twice through the merged door', () => {
  const state = newGame();
  const res = reserve(state);

  const first = goodsOnCounter(state);
  attachGreenFeeToTx(state, first, res.id);
  payOnce(first);
  const firstDone = finalizeReservationCheckIn(state, first, res.id);
  assert.equal(firstDone.ok, true, firstDone.reason);

  // A second ticket at the desk, reaching for a round that is already paid for.
  const second = createTx({ items: [], mode: 'relaxed', rng: rngFor([0.1, 0.9]) });
  const again = attachGreenFeeToTx(state, second, res.id);
  assert.equal(again.ok, false, 'a played round is not still bookable');
});

test('a ticket refuses to carry the same fee twice', () => {
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  assert.equal(attachGreenFeeToTx(state, tx, res.id).ok, true);
  const twice = attachGreenFeeToTx(state, tx, res.id);
  assert.equal(twice.ok, false, 'one round, one line');
  assert.equal(tx.items.length, 3, 'and the ticket is not left with a stray line');
});

test('the line split is by class, not by the green fee alone', () => {
  // Requirement 6 - fix the class, not the instance. A cart rental or a lesson
  // must ride the same rails without further surgery, so the split keys on the
  // service prefix rather than on this one SKU.
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  attachGreenFeeToTx(state, tx, res.id);

  assert.equal(goodsLinesOf(tx).length, 2);
  assert.equal(serviceLinesOf(tx).length, 1);
  // the classifier reads the prefix, so an unrelated service is also caught
  tx.items.push({ uid: 'cart', skuId: 'service:cart-rental', name: 'Cart', priceCents: 2000, price: 20 });
  assert.equal(serviceLinesOf(tx).length, 2, 'any service: line is a service line');
  assert.equal(goodsLinesOf(tx).length, 2, 'and no goods line was reclassified');
});

// --- what the books adversary found, and what now stops it ------------------

test('the fee cannot bank through the sale door without clearing the booking', () => {
  // completeSale can post to greenFees now, but it knows nothing about the
  // reservation - not whether it is still booked, not how to flip it to played.
  // If it banked anyway, the shop would take money for a tee time the sheet
  // still shows as open, and the no-show fee would land on top of it.
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  attachGreenFeeToTx(state, tx, res.id);
  payOnce(tx);

  const sneaked = completeSale(state, tx, 'A customer');
  assert.equal(sneaked.ok, false, 'the sale door must refuse an uncleared booking');
  assert.match(sneaked.reason, /check-in/i);
  assert.equal(round2(state.ledger.today.revenue.greenFees || 0), 0,
    'and not a penny of it reached the books');
  assert.equal(reservationById(state, res.id).status, 'booked',
    'the round is untouched, so it can still be checked in properly');

  // and the proper door still works afterwards
  assert.equal(finalizeReservationCheckIn(state, tx, res.id).ok, true);
});

test('the merged ticket leaves a service-typed trail behind it', () => {
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  attachGreenFeeToTx(state, tx, res.id);
  payOnce(tx);
  assert.equal(finalizeReservationCheckIn(state, tx, res.id).ok, true);

  const row = state.shop.transactionHistory[0];
  assert.ok(row, 'the visit is on the ticket history');
  assert.equal(row.referenceId, `reservation:${res.id}:check-in`,
    'the row names the booking it settled');
  assert.equal(round2(row.serviceTotal), round2(res.fee),
    'and says how much of the total was the round');
  assert.ok(row.total > row.serviceTotal, 'the rest of the total is the merchandise');
});

test('a tee time never enters the merchandise velocity window', () => {
  // The per-SKU tally is what Inventory reorders from. A tee time has no shelf,
  // so a phantom SKU in there is a reorder nobody can ever fill.
  const state = newGame();
  const res = reserve(state);
  const tx = goodsOnCounter(state);
  attachGreenFeeToTx(state, tx, res.id);
  payOnce(tx);
  assert.equal(finalizeReservationCheckIn(state, tx, res.id).ok, true);

  const sold = state.shop.salesToday || {};
  assert.equal(sold[GREEN_FEE_SKU], undefined,
    'the green fee is not a stock keeping unit');
  assert.ok(sold.balls3 > 0, 'and the real merchandise still counted');
});
