// PHYSICAL MONEY. Change is counted out of a real drawer in real denominations,
// so the money layer has to be exact before anything above it can be trusted.
//
// Shop prices land on arbitrary cents — a $34 polo at a 1.15 markup with a 5%
// member discount is $37.15 — and the game has no penny. So CASH rounds to the
// nearest nickel (what Canada, Australia and NZ each did when they retired the
// one-cent coin) while CARD takes the exact cent. That rule lives here, and it
// is the reason a cash total and a card total for the same basket can differ.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLS, COINS, DENOMS, roundCash, makeChange, stackTotal, stackCount, addToStack, takeFromStack,
} from '../src/sim/register.js';

test('denominations are bills then coins, descending, with no penny', () => {
  assert.deepEqual(BILLS, [50, 20, 10, 5, 1]);
  assert.deepEqual(COINS, [0.25, 0.1, 0.05]);
  assert.deepEqual(DENOMS, [50, 20, 10, 5, 1, 0.25, 0.1, 0.05]);
  for (let i = 1; i < DENOMS.length; i++) assert.ok(DENOMS[i] < DENOMS[i - 1], 'descending');
  assert.ok(!DENOMS.includes(0.01), 'no penny — cash rounds to the nickel');
});

test('cash rounds to the nearest nickel; card does not', () => {
  assert.equal(roundCash(37.15), 37.15);
  assert.equal(roundCash(37.13), 37.15);
  assert.equal(roundCash(37.12), 37.1);
  assert.equal(roundCash(37.17), 37.15);
  assert.equal(roundCash(37.18), 37.2);
  assert.equal(roundCash(0.02), 0);
  assert.equal(roundCash(0.03), 0.05);
  // and it never drifts in binary float
  for (const v of [1.01, 9.99, 128.44, 899.97]) {
    const r = roundCash(v);
    assert.equal(Math.round(r * 100) % 5, 0, `${v} → ${r} is a nickel multiple`);
    assert.ok(Math.abs(r - v) <= 0.025 + 1e-9, `${v} → ${r} rounds to nearest`);
  }
});

test('makeChange returns the fewest notes and coins that sum exactly', () => {
  const cases = [
    [0, {}],
    [5, { 5: 1 }],
    [0.15, { 0.1: 1, 0.05: 1 }],
    [12.85, { 10: 1, 1: 2, 0.25: 3, 0.1: 1 }],
    [67.4, { 50: 1, 10: 1, 5: 1, 1: 2, 0.25: 1, 0.1: 1, 0.05: 1 }],
  ];
  for (const [amount, want] of cases) {
    const got = makeChange(amount);
    assert.deepEqual(got, want, `makeChange(${amount})`);
    assert.equal(stackTotal(got), amount, `sums back to ${amount}`);
  }
});

test('makeChange sums back exactly for every nickel amount up to $200', () => {
  for (let cents = 0; cents <= 20000; cents += 5) {
    const amount = cents / 100;
    const st = makeChange(amount);
    assert.equal(stackTotal(st), amount, `makeChange(${amount}) sums back`);
  }
});

test('a stack knows its value and its piece count, and pieces move one at a time', () => {
  let s = {};
  s = addToStack(s, 20);
  s = addToStack(s, 20);
  s = addToStack(s, 0.25);
  assert.equal(stackTotal(s), 40.25);
  assert.equal(stackCount(s), 3);

  const t = takeFromStack(s, 20);
  assert.ok(t.ok);
  assert.equal(stackTotal(t.stack), 20.25);
  assert.equal(stackCount(t.stack), 2);

  // you cannot take what is not there
  const empty = takeFromStack(t.stack, 50);
  assert.equal(empty.ok, false);
  assert.equal(stackTotal(t.stack), 20.25, 'a failed take changes nothing');
});

test('stackTotal never accumulates float error across many coins', () => {
  let s = {};
  for (let i = 0; i < 300; i++) s = addToStack(s, 0.1);
  assert.equal(stackTotal(s), 30);
});
