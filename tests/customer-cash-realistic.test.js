// G5 — CENTS, MATCHING AMOUNTS, REALISTIC DENOMINATIONS.
//
// "Coins on the desk, not only notes. The cash on the desk matches what they
//  handed over. The amounts are realistic. Nobody pays $29.96 to get four cents
//  back. Model how people actually pay: round notes, plus coins for an odd
//  amount, or round up to the next note."
//
// The brief names TWO payment behaviours and only the second existed. Rounding
// up to the next note was the only reachable path unless the odd cents happened
// to be an exact multiple of 25 - three totals in a hundred - so the counter was
// notes-only in almost every sale and the change always came back as shrapnel.
//
// The other behaviour, and the commoner one in a real shop, is to cover the
// dollars with notes and THE CENTS WITH COINS so the change is whole dollars.
//
// This is measured over a distribution, not a single call, because the choice is
// probabilistic. A single sample proves nothing about a coin flip.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTx, scanItem, totalOf, cashTotalOf, customerCash, payableInLargeCoins,
} from '../src/sim/register.js';

const COINS = ['0.01', '0.05', '0.10', '0.25'];
const seeded = (seed) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

function tenderFor(price, seed) {
  const tx = createTx({
    items: [{ uid: 'a', skuId: 'balls3', name: 'Dozen', price }],
    mode: 'relaxed',
    rng: seeded(seed),
    taxRate: 0,
  });
  scanItem(tx, 'a');
  tx.method = 'cash';
  const stack = customerCash(tx);
  return { tx, stack, due: cashTotalOf(tx) };
}

const stackValue = (stack) => Object.entries(stack || {})
  .reduce((sum, [denom, count]) => sum + Math.round(Number(denom) * 100) * count, 0);
const coinCount = (stack) => COINS.reduce((n, d) => n + ((stack || {})[d] || 0), 0);

test('the sampler produces real tenders (control)', () => {
  // If customerCash returned empty stacks every assertion below would pass
  // vacuously - a distribution of nothing has no pennies in it either.
  let withMoney = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const { stack } = tenderFor(29.96, seed);
    if (stackValue(stack) > 0) withMoney += 1;
  }
  assert.equal(withMoney, 60, 'every sampled customer handed over something');
});

test('the tender always covers the bill', () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const price = 3 + (seed % 97) * 1.13;
    const { stack, due } = tenderFor(Number(price.toFixed(2)), seed);
    assert.ok(stackValue(stack) >= Math.round(due * 100),
      `seed ${seed}: handed ${stackValue(stack)}c for a ${Math.round(due * 100)}c bill`);
  }
});

test('coins reach the desk, rather than notes in every sale', () => {
  // The defect: with the coin path gated on cents being an exact multiple of 25,
  // odd totals almost never produced a coin.
  let withCoins = 0;
  const SAMPLES = 200;
  for (let seed = 1; seed <= SAMPLES; seed += 1) {
    const price = 4 + (seed % 89) * 1.07;   // spreads the cents across 0-99
    const { stack } = tenderFor(Number(price.toFixed(2)), seed);
    if (coinCount(stack) > 0) withCoins += 1;
  }
  const pct = (100 * withCoins) / SAMPLES;
  // THE CEILING HERE IS STRUCTURAL, and the threshold is set to the model rather
  // than the model tuned to the threshold.
  //
  // A customer only pays the cents in coins when those cents can be MADE from
  // quarters, dimes and nickels - so a total ending in 96c cannot be, whatever
  // the probability. Roughly a fifth of totals end in a multiple of 5, and the
  // behaviour fires on a bit over half of those, which lands near 13%.
  //
  // Before this the coin path needed cents that were an exact multiple of 25 -
  // three totals in a hundred - so coins were effectively never seen. Asserting
  // 20% here would have meant raising the probability until the number went
  // green, which is the same mistake as tuning a measurement until it reports
  // what you want.
  assert.ok(pct > 10,
    `coins should be a normal sight at the counter, got ${pct.toFixed(1)}% of tenders`);
  assert.ok(pct < 45,
    `but not every customer digs for change, got ${pct.toFixed(1)}%`);
});

test('nobody counts out pennies', () => {
  // F4's rule, which still holds: the coins a customer digs out are large ones.
  let withPennies = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const price = 4 + (seed % 89) * 1.07;
    const { stack } = tenderFor(Number(price.toFixed(2)), seed);
    if ((stack || {})['0.01'] > 0) withPennies += 1;
  }
  assert.equal(withPennies, 0, 'a penny in a customer tender is counting out shrapnel');
});

test('paying the cents exactly makes the change whole dollars', () => {
  // The point of the coin behaviour: it is not decoration, it is what stops the
  // player handing back four cents.
  let exactCentTenders = 0;
  let wholeDollarChange = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const price = 4 + (seed % 89) * 1.07;
    const { stack, due } = tenderFor(Number(price.toFixed(2)), seed);
    const change = stackValue(stack) - Math.round(due * 100);
    const cents = Math.round(due * 100) % 100;
    if (cents === 0 || !payableInLargeCoins(cents)) continue;
    if (coinCount(stack) === 0) continue;
    exactCentTenders += 1;
    if (change % 100 === 0) wholeDollarChange += 1;
  }
  assert.ok(exactCentTenders > 10, `too few coin tenders sampled: ${exactCentTenders}`);
  const pct = (100 * wholeDollarChange) / exactCentTenders;
  assert.ok(pct > 60,
    `covering the cents should leave whole-dollar change, got ${pct.toFixed(1)}%`);
});

test('the large-coin rule admits quarters and dimes and refuses odd pennies', () => {
  for (const ok of [25, 50, 75, 10, 20, 30, 35, 60, 85, 5, 15]) {
    assert.equal(payableInLargeCoins(ok), true, `${ok}c is payable in large coins`);
  }
  for (const bad of [1, 2, 3, 4, 6, 7, 96, 99, 43]) {
    assert.equal(payableInLargeCoins(bad), false, `${bad}c needs pennies`);
  }
});
