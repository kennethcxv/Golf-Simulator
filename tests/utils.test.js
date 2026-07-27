import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, clamp, lerp, dist, formatMoney } from '../src/core/utils.js';

test('makeRng is deterministic for a given seed', () => {
  const a = makeRng(1234);
  const b = makeRng(1234);
  const seqA = [a.next(), a.next(), a.next(), a.next(), a.next()];
  const seqB = [b.next(), b.next(), b.next(), b.next(), b.next()];
  assert.deepEqual(seqA, seqB);
});

test('makeRng differs across seeds and stays in [0,1)', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  let differed = false;
  for (let i = 0; i < 10; i++) {
    const va = a.next();
    const vb = b.next();
    assert.ok(va >= 0 && va < 1);
    assert.ok(vb >= 0 && vb < 1);
    if (va !== vb) differed = true;
  }
  assert.ok(differed, 'different seeds should produce different sequences');
});

test('makeRng state round-trips through getState/setState', () => {
  const a = makeRng(99);
  a.next(); a.next(); a.next();
  const saved = a.getState();
  const rest = makeRng(0);
  rest.setState(saved);
  assert.equal(a.next(), rest.next());
  assert.equal(a.next(), rest.next());
});

test('makeRng int(n) returns integers in [0,n)', () => {
  const a = makeRng(7);
  for (let i = 0; i < 50; i++) {
    const v = a.int(6);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 6);
  }
});

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-2, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('lerp interpolates', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(2, 4, 0), 2);
  assert.equal(lerp(2, 4, 1), 4);
});

test('dist computes euclidean distance', () => {
  assert.equal(dist(0, 0, 3, 4), 5);
});

test('formatMoney renders whole dollars with separators and sign', () => {
  assert.equal(formatMoney(1234.56), '$1,235');
  assert.equal(formatMoney(0), '$0');
  assert.equal(formatMoney(-500), '-$500');
  assert.equal(formatMoney(2500000), '$2,500,000');
});
