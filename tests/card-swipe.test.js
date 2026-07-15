// THE CARD SWIPE is a gesture, and this is the arithmetic that judges it.
//
// The brief's Phase 8 asks for a mag-stripe swipe worked with the mouse: start at the
// top of the reader, pull the card down through it at a sane pace, don't back up. Get
// it wrong and the terminal says WHY, forgivingly — "swipe slower", "swipe again",
// "swipe downward", "complete the swipe" — rather than silently failing. Every one of
// those rules lives in this pure function so it can be hammered headlessly; the 3D
// layer only feeds it the path the card actually travelled under the cursor.
//
// The channel coordinate is normalised: 0 is the top of the slot, 1 is the bottom.

import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeSwipe, SWIPE, SWIPE_MSG } from '../src/sim/cardSwipe.js';

// a straight swipe from y0 to y1 in n steps over `dur` seconds
const path = (y0, y1, n, dur) => Array.from({ length: n + 1 }, (_, i) => ({
  y: y0 + (y1 - y0) * (i / n),
  t: dur * (i / n),
}));

test('a clean top-to-bottom swipe at a normal pace is approved', () => {
  const r = judgeSwipe(path(0.08, 0.96, 10, 0.35));
  assert.equal(r.ok, true, `expected ok, got ${r.code}`);
  assert.equal(r.code, 'ok');
});

test('a swipe that stops halfway is incomplete', () => {
  const r = judgeSwipe(path(0.08, 0.5, 8, 0.3));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'incomplete');
});

test('dragging upward is the wrong direction', () => {
  const r = judgeSwipe(path(0.9, 0.1, 8, 0.3));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'direction');
});

test('a swipe that begins below the top of the slot is rejected', () => {
  const r = judgeSwipe(path(0.55, 0.98, 8, 0.35));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'start');
});

test('a big reversal mid-swipe is a fumble', () => {
  // down to 0.85, back up to 0.45 (a 0.40 reversal), then down to 0.95
  const s = [
    { y: 0.10, t: 0.00 },
    { y: 0.85, t: 0.15 },
    { y: 0.45, t: 0.25 },
    { y: 0.95, t: 0.40 },
  ];
  const r = judgeSwipe(s);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'reverse');
});

test('a flick faster than the valid window says swipe slower', () => {
  const r = judgeSwipe(path(0.08, 0.96, 6, 0.03));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'fast');
});

test('a crawl slower than the valid window says swipe again', () => {
  const r = judgeSwipe(path(0.08, 0.96, 12, 2.0));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'slow');
});

test('too few samples is an incomplete swipe, not a crash', () => {
  assert.equal(judgeSwipe([{ y: 0.1, t: 0 }]).code, 'incomplete');
  assert.equal(judgeSwipe([]).code, 'incomplete');
  assert.equal(judgeSwipe(null).code, 'incomplete');
});

test('a small reversal within tolerance is forgiven', () => {
  const s = [
    { y: 0.08, t: 0.00 },
    { y: 0.50, t: 0.10 },
    { y: 0.44, t: 0.15 },   // a 0.06 wobble — under the threshold
    { y: 0.95, t: 0.30 },
  ];
  const r = judgeSwipe(s);
  assert.equal(r.ok, true, `expected ok, got ${r.code}`);
});

test('every failure code has a player-facing message, and the brief\'s four are present', () => {
  for (const code of ['ok', 'incomplete', 'start', 'direction', 'reverse', 'fast', 'slow']) {
    assert.ok(SWIPE_MSG[code] && SWIPE_MSG[code].length, `no message for ${code}`);
  }
  assert.equal(SWIPE_MSG.fast, 'Swipe slower');
  assert.equal(SWIPE_MSG.slow, 'Swipe again');
  assert.equal(SWIPE_MSG.direction, 'Swipe downward');
  assert.equal(SWIPE_MSG.incomplete, 'Complete the swipe');
});

test('the config exposes a forgiving, tunable window', () => {
  // sanity on the shipped thresholds so a later tweak that breaks the feel is visible
  assert.ok(SWIPE.START_MAX >= 0.3 && SWIPE.START_MAX <= 0.5);
  assert.ok(SWIPE.END_MIN >= 0.7 && SWIPE.END_MIN <= 0.9);
  assert.ok(SWIPE.MAX_SEC >= 1.0);
});
