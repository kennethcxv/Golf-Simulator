// PAYMENT. Two paths, both physical.
//
// CARD is a terminal with prompts: the customer presents, the player runs it, and
// it can approve, decline, be cancelled, or time out. A decline is not the end —
// the customer digs out a second card. None of it completes on one keypress.
//
// CASH is the interesting one. The customer hands over actual pieces. The player
// takes them, opens the drawer, puts them away, then counts change back OUT of
// the drawer piece by piece. Relaxed refuses a wrong count so nobody loses money;
// Realistic lets it through and records exactly what the mistake cost.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTx, scanItem, requestPayment, dueOf, cashTotalOf,
  presentCard, insertCard, submitCardAmount, runCard, retryCard, cancelCard,
  customerCash, acceptCash, openDrawer, closeDrawer, depositTendered,
  takeFromDrawer, returnToDrawer, changeDue, handTotal, handOverChange,
  newDrawer, stackTotal, makeChange, drawerContents,
} from '../src/sim/register.js';

const rngFor = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };
const confirmExactAmount = (tx) => submitCardAmount(tx);
// one Pro-V dozen at $47 and a glove at $19.55 → $66.55
const basket = () => ([
  { uid: 'a', skuId: 'balls3', name: 'Pro-V dozen', price: 47 },
  { uid: 'b', skuId: 'glove1', name: 'Cabretta glove', price: 19.55 },
]);
const scannedTx = (opts = {}) => {
  const tx = createTx({ items: basket(), ...opts });
  for (const it of tx.items) scanItem(tx, it.uid);
  return tx;
};

// --- card ------------------------------------------------------------------------

test('a card sale: present, run, approve — and it takes more than one call', () => {
  const tx = scannedTx({ rng: rngFor([0.1, 0.9]) }); // <0.4 → card, then a clean auth
  requestPayment(tx);
  assert.equal(tx.method, 'card');
  assert.equal(tx.stage, 'card-present');

  // running the terminal before the customer has presented is refused
  assert.equal(runCard(tx).ok, false);

  assert.equal(presentCard(tx).ok, true);
  assert.equal(tx.stage, 'card-ready');

  // authorization is impossible until the physical card reaches the chip slot
  assert.equal(runCard(tx).ok, false);
  assert.equal(insertCard(tx).ok, true);
  assert.equal(tx.stage, 'card-entry');
  assert.equal(confirmExactAmount(tx).ok, true);
  assert.equal(tx.stage, 'card-busy');

  const res = runCard(tx);
  assert.equal(res.ok, true);
  assert.equal(res.result, 'approved');
  assert.equal(tx.stage, 'receipt');
  assert.equal(tx.cardAttempts, 1);
});

test('a declined card does not end the sale — the customer tries a second one', () => {
  const tx = scannedTx({ rng: rngFor([0.1, 0.01, 0.9]) }); // card, DECLINE, then approve
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  confirmExactAmount(tx);

  const bad = runCard(tx);
  assert.equal(bad.result, 'declined');
  assert.equal(tx.stage, 'card-declined');
  assert.equal(tx.cardAttempts, 1);

  // you cannot just re-run a declined card — they have to present another
  assert.equal(runCard(tx).ok, false);

  assert.equal(retryCard(tx).ok, true);
  assert.equal(tx.cardsTried, 2);
  assert.equal(tx.stage, 'card-ready');

  assert.equal(insertCard(tx).ok, true);
  confirmExactAmount(tx);
  const good = runCard(tx);
  assert.equal(good.result, 'approved');
  assert.equal(tx.stage, 'receipt');
  assert.equal(tx.cardAttempts, 2);
});

test('a cancelled card drops back to the payment choice with no money moved', () => {
  const tx = scannedTx({ rng: rngFor([0.1]) });
  requestPayment(tx);
  presentCard(tx);
  const res = cancelCard(tx);
  assert.equal(res.ok, true);
  assert.equal(tx.stage, 'payment');
  assert.equal(tx.method, null, 'they can now choose cash instead');
  assert.equal(tx.cardResult, 'cancelled');
});

test('a card that times out is not an approval', () => {
  const tx = scannedTx({ rng: rngFor([0.1]) });
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  confirmExactAmount(tx);
  const res = runCard(tx, { timeout: true });
  assert.equal(res.result, 'timeout');
  assert.equal(tx.stage, 'card-declined', 'same recovery path as a decline');
  assert.notEqual(tx.stage, 'receipt');
});

// --- cash -------------------------------------------------------------------------

test('the customer hands over real pieces that cover the rounded cash total', () => {
  const tx = scannedTx({ rng: rngFor([0.9, 0.9]) }); // >=0.4 → cash
  requestPayment(tx);
  assert.equal(tx.method, 'cash');
  assert.equal(cashTotalOf(tx), 66.55);

  const cash = customerCash(tx);
  assert.ok(stackTotal(cash) >= 66.55, 'covers the bill');
  assert.equal(stackTotal(tx.tendered), stackTotal(cash));
  assert.equal(tx.stage, 'cash-tender');
});

test('cash: accept, open the drawer, put it away, count the change back out', () => {
  const tx = scannedTx({ rng: rngFor([0.9, 0.9]) });
  requestPayment(tx);
  customerCash(tx);
  const tendered = stackTotal(tx.tendered);
  const due = changeDue(tx);
  assert.equal(due, Math.round((tendered - 66.55) * 100) / 100);

  const drawer = newDrawer();
  const before = stackTotal(drawer);

  assert.equal(acceptCash(tx).ok, true);
  assert.equal(tx.stage, 'cash-drawer');

  // you cannot take change out of a drawer you have not opened
  assert.equal(takeFromDrawer(tx, drawer, 20).ok, false);

  assert.equal(openDrawer(tx).ok, true);
  assert.equal(tx.drawerOpen, true);

  // the customer's money goes IN first
  const dep = depositTendered(tx, drawer);
  assert.equal(dep.ok, true);
  assert.equal(stackTotal(drawer), before, 'the saved drawer is unchanged before the sale commits');
  assert.equal(stackTotal(drawerContents(tx, drawer)), Math.round((before + tendered) * 100) / 100);
  assert.equal(tx.deposited, true);

  // then change comes OUT, one piece at a time, into the hand
  for (const [denom, n] of Object.entries(makeChange(due))) {
    for (let i = 0; i < n; i++) {
      assert.equal(takeFromDrawer(tx, drawer, Number(denom)).ok, true);
    }
  }
  assert.equal(handTotal(tx), due);

  const res = handOverChange(tx, drawer);
  assert.equal(res.ok, true);
  assert.equal(res.lost, 0);
  assert.equal(tx.stage, 'receipt');
  assert.equal(tx.drawerOpen, false, 'handing over closes the drawer');
  // The local till now holds opening float plus the goods; commitSale owns persistence.
  assert.equal(stackTotal(drawerContents(tx, drawer)), Math.round((before + 66.55) * 100) / 100);
  assert.equal(stackTotal(drawer), before);
});

test('a piece put back goes back in the drawer — the hand is not a black hole', () => {
  const tx = scannedTx({ rng: rngFor([0.9, 0.9]) });
  requestPayment(tx);
  customerCash(tx);
  acceptCash(tx);
  const drawer = newDrawer();
  openDrawer(tx);
  depositTendered(tx, drawer);
  const inTill = stackTotal(drawerContents(tx, drawer));

  takeFromDrawer(tx, drawer, 5);
  assert.equal(handTotal(tx), 5);
  assert.equal(stackTotal(drawerContents(tx, drawer)), Math.round((inTill - 5) * 100) / 100);
  assert.equal(stackTotal(drawer), stackTotal(newDrawer()), 'persistent float still did not move');

  returnToDrawer(tx, drawer, 5);
  assert.equal(handTotal(tx), 0);
  assert.equal(stackTotal(drawerContents(tx, drawer)), inTill, 'right back where it came from');
});

test('RELAXED refuses a wrong count — nobody loses money by fumbling', () => {
  const tx = scannedTx({ mode: 'relaxed', rng: rngFor([0.9, 0.9]) });
  requestPayment(tx);
  customerCash(tx);
  acceptCash(tx);
  const drawer = newDrawer();
  openDrawer(tx);
  depositTendered(tx, drawer);

  takeFromDrawer(tx, drawer, 1); // nowhere near the change due
  const res = handOverChange(tx, drawer);
  assert.equal(res.ok, false);
  assert.match(res.reason, /count/i);
  assert.equal(tx.stage, 'cash-drawer', 'still counting');
  assert.equal(tx.lost, 0);
});

test('REALISTIC lets a wrong count through and records what it cost', () => {
  const tx = scannedTx({ mode: 'realistic', rng: rngFor([0.9, 0.9]) });
  requestPayment(tx);
  customerCash(tx);
  acceptCash(tx);
  const drawer = newDrawer();
  openDrawer(tx);
  depositTendered(tx, drawer);
  const due = changeDue(tx);

  // hand over $5 too much
  for (const [denom, n] of Object.entries(makeChange(due + 5))) {
    for (let i = 0; i < n; i++) takeFromDrawer(tx, drawer, Number(denom));
  }
  assert.equal(handTotal(tx), due + 5);

  const res = handOverChange(tx, drawer);
  assert.equal(res.ok, true);
  assert.equal(res.lost, 5, 'the till is five dollars short');
  assert.equal(tx.lost, 5);
  assert.equal(tx.stage, 'receipt');
});

test('shorting the customer is refused in every mode — under-giving never completes', () => {
  const tx = scannedTx({ mode: 'realistic', rng: rngFor([0.9, 0.9]) });
  requestPayment(tx);
  customerCash(tx);
  acceptCash(tx);
  const drawer = newDrawer();
  openDrawer(tx);
  depositTendered(tx, drawer);
  const due = changeDue(tx);

  for (const [denom, n] of Object.entries(makeChange(Math.max(0, due - 5)))) {
    for (let i = 0; i < n; i++) takeFromDrawer(tx, drawer, Number(denom));
  }
  const res = handOverChange(tx, drawer);
  assert.equal(res.ok, false, 'five dollars short can never close the sale');
  assert.match(res.reason, /not enough/i);
  assert.equal(tx.stage, 'cash-drawer', 'still counting');
});

test('over-giving beyond five dollars is refused; five even is the ceiling', () => {
  const tx = scannedTx({ mode: 'relaxed', rng: rngFor([0.9, 0.9]) });
  requestPayment(tx);
  customerCash(tx);
  acceptCash(tx);
  const drawer = newDrawer();
  openDrawer(tx);
  depositTendered(tx, drawer);
  const due = changeDue(tx);

  // $5.05 over: one nickel beyond the courtesy ceiling
  for (const [denom, n] of Object.entries(makeChange(due + 5.05))) {
    for (let i = 0; i < n; i++) takeFromDrawer(tx, drawer, Number(denom));
  }
  const refused = handOverChange(tx, drawer);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /too much/i);

  // put the whole miscount back, then count exactly $5.00 over — allowed even in relaxed
  for (const [denom, n] of Object.entries({ ...tx.hand })) {
    for (let i = 0; i < n; i++) returnToDrawer(tx, drawer, Number(denom));
  }
  for (const [denom, n] of Object.entries(makeChange(due + 5))) {
    for (let i = 0; i < n; i++) takeFromDrawer(tx, drawer, Number(denom));
  }
  const res = handOverChange(tx, drawer);
  assert.equal(res.ok, true);
  assert.equal(res.lost, 5, 'the courtesy overage is booked against the till');
  assert.equal(res.given, Math.round((due + 5) * 100) / 100, 'the receipt remembers what crossed the counter');
});

test('exact cash needs no change at all and skips straight to the receipt', () => {
  const tx = scannedTx({ rng: rngFor([0.9, 0.9]) });
  requestPayment(tx);
  // override what they happened to pull out: they had it exact
  tx.tendered = makeChange(cashTotalOf(tx));
  assert.equal(changeDue(tx), 0);
  acceptCash(tx);
  const drawer = newDrawer();
  openDrawer(tx);
  depositTendered(tx, drawer);
  const res = handOverChange(tx, drawer);
  assert.equal(res.ok, true);
  assert.equal(res.lost, 0);
  assert.equal(tx.stage, 'receipt');
});

test('you cannot close out a cash sale without putting the tendered money away', () => {
  const tx = scannedTx({ rng: rngFor([0.9, 0.9]) });
  requestPayment(tx);
  customerCash(tx);
  acceptCash(tx);
  const drawer = newDrawer();
  openDrawer(tx);
  // skipped depositTendered
  const res = handOverChange(tx, drawer);
  assert.equal(res.ok, false);
  assert.match(res.reason, /till|drawer|put/i);
});

test('the drawer starts with a real float — you can always make change', () => {
  const drawer = newDrawer();
  assert.ok(stackTotal(drawer) > 0);
  for (const d of [50, 20, 10, 5, 1, 0.5, 0.2, 0.1, 0.05, 0.01]) {
    assert.ok((drawer[d] || 0) > 0, `the float has ${d}s`);
  }
});
