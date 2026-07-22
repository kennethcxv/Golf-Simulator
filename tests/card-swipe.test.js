import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeSwipe, SWIPE, SWIPE_MSG } from '../src/sim/cardSwipe.js';

const path = (y0, y1, steps, duration) => Array.from({ length: steps + 1 }, (_, index) => ({
  y: y0 + (y1 - y0) * (index / steps),
  t: duration * (index / steps),
}));

test('a clean top-to-bottom swipe at a normal pace is approved', () => {
  assert.deepEqual(judgeSwipe(path(0.08, 0.96, 10, 0.35)), { ok: true, code: 'ok' });
});

test('card swipe failures explain incomplete, reversed, and badly paced gestures', () => {
  assert.equal(judgeSwipe(path(0.08, 0.5, 8, 0.3)).code, 'incomplete');
  assert.equal(judgeSwipe(path(0.9, 0.1, 8, 0.3)).code, 'direction');
  assert.equal(judgeSwipe(path(0.55, 0.98, 8, 0.35)).code, 'start');
  assert.equal(judgeSwipe([
    { y: 0.10, t: 0 }, { y: 0.85, t: 0.15 },
    { y: 0.45, t: 0.25 }, { y: 0.95, t: 0.4 },
  ]).code, 'reverse');
  assert.equal(judgeSwipe(path(0.08, 0.96, 6, 0.03)).code, 'fast');
  assert.equal(judgeSwipe(path(0.08, 0.96, 12, 2)).code, 'slow');
});

test('small swipe wobble is forgiven and every result has player feedback', () => {
  assert.equal(judgeSwipe([
    { y: 0.08, t: 0 }, { y: 0.5, t: 0.1 },
    { y: 0.44, t: 0.15 }, { y: 0.95, t: 0.3 },
  ]).ok, true);
  for (const code of ['ok', 'incomplete', 'start', 'direction', 'reverse', 'fast', 'slow']) {
    assert.ok(SWIPE_MSG[code]);
  }
  assert.ok(SWIPE.START_MAX >= 0.3 && SWIPE.START_MAX <= 0.5);
  assert.ok(SWIPE.END_MIN >= 0.7 && SWIPE.END_MIN <= 0.9);
});
