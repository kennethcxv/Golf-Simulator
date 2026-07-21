// PHYSICAL MONEY. Change is counted out of a real drawer in real denominations,
// so the money layer has to be exact before anything above it can be trusted.
//
// Shop prices land on arbitrary cents. Five coin compartments, including the
// penny, keep both cash and card on the same exact cent total.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLS, COINS, DENOMS, roundCash, makeChange, makeChangeFrom,
  stackTotal, stackCount, addToStack, takeFromStack,
  migrateLegacyQuarterStack, migrateDrawer,
} from '../src/sim/register.js';

test('denominations are bills then five coins, descending through the penny', () => {
  assert.deepEqual(BILLS, [50, 20, 10, 5, 1]);
  assert.deepEqual(COINS, [0.5, 0.2, 0.1, 0.05, 0.01]);
  assert.deepEqual(DENOMS, [50, 20, 10, 5, 1, 0.5, 0.2, 0.1, 0.05, 0.01]);
  for (let i = 1; i < DENOMS.length; i++) assert.ok(DENOMS[i] < DENOMS[i - 1], 'descending');
  assert.ok(DENOMS.includes(0.01), 'cent-accurate cash can make arbitrary change');
});

test('cash and card retain the same cent-accurate total', () => {
  assert.equal(roundCash(37.15), 37.15);
  assert.equal(roundCash(37.13), 37.13);
  assert.equal(roundCash(37.12), 37.12);
  assert.equal(roundCash(37.17), 37.17);
  assert.equal(roundCash(37.18), 37.18);
  assert.equal(roundCash(0.02), 0.02);
  assert.equal(roundCash(0.03), 0.03);
  for (const v of [1.01, 9.99, 128.44, 899.97]) {
    const r = roundCash(v);
    assert.equal(r, v, `${v} stays exact at the cent boundary`);
  }
});

test('makeChange returns the fewest notes and coins that sum exactly', () => {
  const cases = [
    [0, {}],
    [5, { 5: 1 }],
    [0.15, { 0.1: 1, 0.05: 1 }],
    [4.28, { 1: 4, 0.2: 1, 0.05: 1, 0.01: 3 }],
    [5.64, { 5: 1, 0.5: 1, 0.1: 1, 0.01: 4 }],
    [12.85, { 10: 1, 1: 2, 0.5: 1, 0.2: 1, 0.1: 1, 0.05: 1 }],
    [67.4, { 50: 1, 10: 1, 5: 1, 1: 2, 0.2: 2 }],
  ];
  for (const [amount, want] of cases) {
    const got = makeChange(amount);
    assert.deepEqual(got, want, `makeChange(${amount})`);
    assert.equal(stackTotal(got), amount, `sums back to ${amount}`);
  }
});

test('makeChange sums back exactly for every cent amount up to $200', () => {
  for (let cents = 0; cents <= 20000; cents += 1) {
    const amount = cents / 100;
    const st = makeChange(amount);
    assert.equal(stackTotal(st), amount, `makeChange(${amount}) sums back`);
  }
});

test('makeChangeFrom finds exact bounded-drawer alternatives instead of getting trapped greedily', () => {
  const full = { 5: 20, 1: 20, 0.5: 20, 0.2: 20, 0.1: 20, 0.05: 20, 0.01: 50 };
  assert.deepEqual(makeChangeFrom(full, 4.28), { 1: 4, 0.2: 1, 0.05: 1, 0.01: 3 });
  assert.deepEqual(makeChangeFrom(full, 5.64), { 5: 1, 0.5: 1, 0.1: 1, 0.01: 4 });
  assert.deepEqual(makeChangeFrom({ 0.5: 1, 0.2: 3 }, 0.6), { 0.2: 3 });
  assert.equal(makeChangeFrom({ 0.5: 1 }, 0.6), null);
});

test('a stack knows its value and its piece count, and pieces move one at a time', () => {
  let s = {};
  s = addToStack(s, 20);
  s = addToStack(s, 20);
  s = addToStack(s, 0.2);
  assert.equal(stackTotal(s), 40.2);
  assert.equal(stackCount(s), 3);

  const t = takeFromStack(s, 20);
  assert.ok(t.ok);
  assert.equal(stackTotal(t.stack), 20.2);
  assert.equal(stackCount(t.stack), 2);

  // you cannot take what is not there
  const empty = takeFromStack(t.stack, 50);
  assert.equal(empty.ok, false);
  assert.equal(stackTotal(t.stack), 20.2, 'a failed take changes nothing');
});

test('legacy quarter stacks migrate exactly once into 20-unit and 5-unit coins', () => {
  const legacy = { 20: 2, 0.5: 3, 0.25: 7, 0.2: 4, 0.05: 9, 0.01: 2 };
  const opening = stackTotal(legacy);
  const migrated = migrateLegacyQuarterStack(legacy);
  assert.equal(migrated[0.25], undefined);
  assert.equal(migrated[0.2], 11);
  assert.equal(migrated[0.05], 16);
  assert.equal(stackTotal(migrated), opening);
  assert.deepEqual(migrateLegacyQuarterStack(migrated), migrated, 'stack migration is idempotent');
  const drawer = migrateDrawer(legacy);
  assert.equal(drawer[0.25], undefined);
  assert.equal(stackTotal(drawer), opening);
  assert.deepEqual(migrateDrawer(drawer), drawer, 'full drawer migration is idempotent');
});

test('stackTotal never accumulates float error across many coins', () => {
  let s = {};
  for (let i = 0; i < 300; i++) s = addToStack(s, 0.1);
  assert.equal(stackTotal(s), 30);
});
