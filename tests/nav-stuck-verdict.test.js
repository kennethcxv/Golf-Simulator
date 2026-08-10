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
  NAV_NO_PROGRESS_SECONDS,
  navStuckVerdict, NAV_SLIDING_SECONDS,
} from '../src/render3d/clubhouse.js';

test('a slide is invisible to displacement, and NOW it escalates anyway', () => {
  // G10 (Goal 17) REVERSED THIS TEST DELIBERATELY, AND THE OLD ONE IS QUOTED
  // ABOVE IN THE SOURCE SO THE CHANGE IS NOT SILENT.
  //
  // A customer sliding along a box face asks for a 0.06 yd step, gets 0.055 of
  // it every frame, and has been no closer to its target for three seconds.
  // This used to assert `stuck: false` on the evidence that displacement always
  // fired first - but that evidence came from a build where the progress test
  // ran SECOND and therefore could never win. The brief settles it: "The
  // threshold I want is 3 seconds of no progress, and it must fire regardless
  // of what displacement thinks."
  const sliding = { moved: 0.055, step: 0.06, noProgressT: 3.1 };
  assert.ok(sliding.moved >= sliding.step * 0.25, 'displacement sees a walking customer');
  const verdict = navStuckVerdict(sliding);
  assert.equal(verdict.wouldSlide, true);
  assert.equal(verdict.stuck, true, 'three seconds of no progress is stuck');
  assert.equal(verdict.reason, 'no-progress',
    'and it carries its own reason, because a wrong route needs a different answer from a wedge');
});

test('just under the threshold is not yet stuck', () => {
  // The boundary matters: this is what stops an ordinary pause at a shelf being
  // treated as a blocked route. F2 (Goal 18) moved the threshold to ONE second;
  // the boundary case rides the constant rather than a stale literal.
  const nearly = navStuckVerdict({ moved: 0.055, step: 0.06, noProgressT: NAV_NO_PROGRESS_SECONDS - 0.1 });
  assert.equal(nearly.stuck, false);
  assert.equal(nearly.reason, 'none');
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

test('a wedged customer that is ALSO making no progress reports no-progress', () => {
  // G10 flipped this too, and for the same reason. When both are true the
  // walker has been going nowhere for three seconds AND is against something -
  // and the useful answer is the one that changes the ROUTE, not the one that
  // sidesteps into the same wall again. Nine seconds of no progress is not a
  // wedge you nudge out of.
  const both = navStuckVerdict({ moved: 0, step: 0.06, noProgressT: 9 });
  assert.equal(both.stuck, true);
  assert.equal(both.reason, 'no-progress');
  assert.equal(both.wouldSlide, true);
});

test('a wedge with a healthy progress clock still reports displacement', () => {
  // The other side of the same coin: a walker that has only just met a corner
  // has made progress recently, so it gets the sidestep ladder it always had.
  const wedgeOnly = navStuckVerdict({ moved: 0, step: 0.06, noProgressT: 0.2 });
  assert.equal(wedgeOnly.stuck, true);
  assert.equal(wedgeOnly.reason, 'displacement');
});
