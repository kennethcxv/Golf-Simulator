import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInWindow, CHECK_IN_WINDOW_MINUTES } from '../src/sim/reservations.js';

// G11 (Goal 17) — CHECK-IN OPENS AN HOUR BEFORE AND CLOSES AT THE TEE TIME.
//
// The brief's two examples are the two tests that matter: "Nobody checks in at
// 6:30 am for a 1 pm slot" and "They cannot be late." Everything else here is
// the boundaries, because a window is all boundary - an off-by-one at either
// end is the whole feature being wrong for one minute in sixty.

const ONE_PM = 13 * 60;
const at = (h, m = 0) => h * 60 + m;

test('the window is an hour', () => {
  assert.equal(CHECK_IN_WINDOW_MINUTES, 60);
});

test("nobody checks in at 6:30 am for a 1 pm slot - the brief's own example", () => {
  const w = checkInWindow(ONE_PM, at(6, 30));
  assert.equal(w.state, 'early');
  assert.equal(w.minutesUntilOpen, 330, 'and the desk can say how long to come back in');
});

test('the window opens exactly sixty minutes before, inclusive', () => {
  assert.equal(checkInWindow(ONE_PM, at(11, 59)).state, 'early', 'a minute before it opens');
  assert.equal(checkInWindow(ONE_PM, at(12, 0)).state, 'open', 'on the hour it is open');
});

test('the window closes AT the tee time, so the tee time itself is late', () => {
  assert.equal(checkInWindow(ONE_PM, at(12, 59)).state, 'open', 'a minute before, still open');
  assert.equal(checkInWindow(ONE_PM, at(13, 0)).state, 'missed', 'at the tee time it is gone');
});

test('a missed booking reports how late, so the desk can say so', () => {
  const w = checkInWindow(ONE_PM, at(13, 20));
  assert.equal(w.state, 'missed');
  assert.equal(w.minutesLate, 20);
});

test('nonsense input fails closed rather than opening the window', () => {
  // An unparseable tee time must never read as "open" - that would let anyone
  // check in against a broken record.
  for (const bad of [undefined, null, NaN, 'soon']) {
    assert.notEqual(checkInWindow(bad, at(12, 30)).state, 'open');
    assert.notEqual(checkInWindow(ONE_PM, bad).state, 'open');
  }
});
