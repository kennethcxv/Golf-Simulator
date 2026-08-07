// G2 — THE PROGRESS TEST WAS REVERTED, AND THIS PINS WHY.
//
// "Item 14: prove the progress test rescues something displacement cannot, or
// revert it and record that displacement was sufficient."
//
// It could not be proved, so it is reverted, and these hold the shape of the
// answer so it cannot quietly come back without one.
//
// The STATES are genuinely different, and that was never the question: a
// shopper grinding along the flat face of a box MOVES most of the step it asked
// for, every frame, while getting no closer. Displacement asks "did I move";
// progress asks "am I arriving". The verdict still computes both.
//
// What could not be shown is that the difference MATTERS in play. Measured in
// Electron on pine-hills-v2, shop open, organic walk-ins, 150 s at 1x
// (tools/qa/electron-nav-progress-peak.js): the no-progress clock reached
// 3.00 s — past the 2.5 s threshold, so the branch was live and eligible — and
// rescued exactly ZERO customers, while displacement caught four. Every frame
// on which progress would have fired, displacement had already fired. The
// control run with the customer sim suspended moved neither number.
//
// So `wouldSlide` is still computed and still counted by navBlockDiagnostics,
// because that counter is the evidence that would reopen the branch. It is no
// longer a stuck REASON.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  navStuckVerdict, NAV_SLIDING_SECONDS,
} from '../src/render3d/clubhouse.js';

test('a slide is still invisible to displacement, and the verdict still sees it', () => {
  // A customer sliding along a box face: asks for a 0.06 yd step, gets 0.055 of
  // it every frame, and has been no closer to its target for 3 s.
  const sliding = { moved: 0.055, step: 0.06, noProgressT: 3.0 };
  assert.ok(sliding.moved >= sliding.step * 0.25, 'displacement sees a walking customer');
  const verdict = navStuckVerdict(sliding);
  // the state is recognised...
  assert.equal(verdict.wouldSlide, true);
  // ...and deliberately does NOT escalate, because in 150 s of a busy shop this
  // never once happened without displacement having already fired.
  assert.equal(verdict.stuck, false);
  assert.equal(verdict.reason, 'none');
});

test('displacement still catches what it always caught', () => {
  const wedged = { moved: 0.001, step: 0.06, noProgressT: 0 };
  const verdict = navStuckVerdict(wedged);
  assert.equal(verdict.stuck, true);
  assert.equal(verdict.reason, 'displacement');
});

test('a customer that is genuinely walking is flagged by neither (control)', () => {
  // THE CONTROL. If this reported stuck, the checks above would pass on a
  // predicate that is simply always true.
  assert.deepEqual(
    navStuckVerdict({ moved: 0.058, step: 0.06, noProgressT: 0.4 }),
    { stuck: false, reason: 'none', wouldSlide: false },
  );
  // ...and standing still is not stuck: no step was asked for, so there is
  // nothing to be blocked from doing.
  assert.deepEqual(
    navStuckVerdict({ moved: 0, step: 0, noProgressT: 99 }),
    { stuck: false, reason: 'none', wouldSlide: false },
  );
});

test('the slide flag respects its own threshold rather than tripping early', () => {
  const under = { moved: 0.055, step: 0.06, noProgressT: NAV_SLIDING_SECONDS - 0.01 };
  const over = { moved: 0.055, step: 0.06, noProgressT: NAV_SLIDING_SECONDS + 0.01 };
  assert.equal(navStuckVerdict(under).wouldSlide, false);
  assert.equal(navStuckVerdict(over).wouldSlide, true);
});

test('a wedged customer that is ALSO making no progress escalates on displacement', () => {
  // Both conditions true at once — which the live run says is the only way the
  // progress clock ever crosses its threshold. The reason has to be the certain
  // one, or the nav-block log would attribute corner wedges to box faces and
  // send the next reader after the wrong prop.
  const both = navStuckVerdict({ moved: 0, step: 0.06, noProgressT: 9 });
  assert.equal(both.reason, 'displacement');
  assert.equal(both.wouldSlide, true);
});
