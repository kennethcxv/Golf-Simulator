// DAY LENGTH MUST NEVER MOVE WALKING SPEED.
//
// The regression this pins, in full, because the shape of it matters more than
// the fix: the clubhouse took ONE multiplier — the day's compression against the
// rate NPC timings were authored at — and derived locomotion from it as
// `min(simSpeed, LOCOMOTION_SPEED_CAP)`.
//
// That is indistinguishable from correct for exactly as long as the multiplier
// is 1, and it was 1 for as long as the day was twelve real hours. Shortening
// the day to three made the compression 4, `min(4, 4)` returned the cap, and
// every shopper sprinted at 4x wall rate on the DEFAULT speed rung. A cap is not
// a rate. Reading a rate off a cap only looks right while the input is 1.
//
// So the test does not assert the fix. It drives the arithmetic with a DOCTORED
// day length and requires locomotion to sit still while decision moves — the one
// question the old shape would have failed and no test was asking.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BALANCE, simSpeedMultipliers } from '../src/sim/balance.js';

test('locomotion follows the speed rung and nothing else', () => {
  for (let idx = 0; idx < BALANCE.speeds.length; idx++) {
    const { locomotion } = simSpeedMultipliers(idx);
    assert.equal(locomotion, BALANCE.speeds[idx] || 1,
      `rung ${idx} must move bodies at the rung the player selected`);
  }
  assert.equal(simSpeedMultipliers(1).locomotion, 1,
    'the DEFAULT rung must be wall rate - this is the number that broke');
});

// THE NEGATIVE CONTROL. Break the thing the instrument measures: quadruple the
// day again and confirm decision follows while locomotion does not.
test('changing the day length moves decisions and leaves locomotion alone', () => {
  const faster = { ...BALANCE, gameMinutesPerRealSecond: BALANCE.gameMinutesPerRealSecond * 4 };
  const slower = { ...BALANCE, gameMinutesPerRealSecond: BALANCE.gameMinutesPerRealSecond / 8 };

  for (let idx = 1; idx < BALANCE.speeds.length; idx++) {
    const base = simSpeedMultipliers(idx);
    const quick = simSpeedMultipliers(idx, faster);
    const slow = simSpeedMultipliers(idx, slower);

    assert.equal(quick.decision, base.decision * 4, `rung ${idx}: decisions track the day`);
    assert.equal(slow.decision, base.decision / 8, `rung ${idx}: decisions track the day both ways`);

    assert.equal(quick.locomotion, base.locomotion,
      `rung ${idx}: a shorter day must not speed walking up - this is the regression`);
    assert.equal(slow.locomotion, base.locomotion,
      `rung ${idx}: a longer day must not slow walking down either`);
  }
});

test('the ladder never asks bodies to move faster than the tunnelling cap', () => {
  // 4x is the SIM-TIME-001 ruling: above it a 1.4 yd/s body covers more than its
  // own 0.32 yd radius between frames and steps through colliders.
  for (let idx = 0; idx < BALANCE.speeds.length; idx++) {
    assert.ok(simSpeedMultipliers(idx).locomotion <= 4,
      `rung ${idx} exceeds the locomotion cap`);
  }
});

// Decisions are the other half of SIM-TIME-001 and still have to compress, or a
// short day is an empty shop. 16x is the measured healthy ceiling: at that
// compression a game hour completes 10 of 11 visits, at 64x only 5 of 11.
test('decision compression stays inside the measured healthy ceiling', () => {
  const top = simSpeedMultipliers(BALANCE.speeds.length - 1).decision;
  assert.ok(top <= 16, `top rung compresses decisions ${top}x, past the measured 16x ceiling`);
  assert.ok(simSpeedMultipliers(1).decision > 1,
    'the default rung must still compress decisions, or the short day empties the shop');
});

// The wiring, since the arithmetic above is only correct if it is the arithmetic
// actually being used.
test('the frame loop passes both multipliers, and the clubhouse keeps them apart', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /simSpeedMultipliers\(app\.speedIdx\)/,
    'the frame loop must derive both numbers from the one tested place');
  assert.match(main, /setSimSpeed\?\.\(simMult\.decision, simMult\.locomotion\)/,
    'both multipliers must reach the clubhouse, separately');

  const clubhouse = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');
  assert.match(clubhouse, /const moveDt = dt \* locomotionSpeed;/,
    'bodies move on the locomotion multiplier');
  assert.doesNotMatch(clubhouse, /moveDt = dt \* Math\.min\(simSpeed/,
    'bodies must never take their speed from the decision multiplier again');
  assert.match(clubhouse, /const LOCOMOTION_WALL_RATE = 1;/,
    'the wall-rate reference must be a pinned constant, not something derived');
});
