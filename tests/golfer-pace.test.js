// GOLFERS GET THE SAME CLOCK SPLIT AS SHOPPERS (D1).
//
// On-course bodies read position off game minutes (updateRoutePosition), so
// shortening the day 12h -> 3h made every golfer sprint at 4x the authored
// rates on the DEFAULT rung — measured 1.93 -> 7.73 yd/s on foot, 3.50 -> 14.00
// in a cart. Ruling: decisions on the game clock, locomotion wall-rate capped
// at the shoppers' x4.
//
// The wall rate is game-minute duration divided by how fast the clock burns
// game minutes (compression x rung). These tests drive golferPaceScale with a
// doctored day length — the same discipline the shopper split uses — and prove
// the WALL rate does not move where it must not.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BALANCE, GOLFER_LOCOMOTION_SPEED_CAP, golferPaceScale, simSpeedMultipliers,
} from '../src/sim/balance.js';

// yd/s a body reads on screen: authored wall rate x (clock rate / pace scale).
const wallRate = (authoredYdPerMin, rung, balance) => {
  const baseline = balance.npcTimingBaselineGameMinutesPerRealSecond;
  const compression = balance.gameMinutesPerRealSecond / baseline;
  const gameMinPerWallSec = compression * rung * baseline;
  // duration_gameMin = dist / speed * pace  =>  wallSec = duration / gameMinPerWallSec
  // wallSpeed = dist / wallSec = speed * gameMinPerWallSec / pace
  return (authoredYdPerMin / 60) * ((compression * rung) / golferPaceScale(rung, balance));
};

test('on the shipped balance, the default rung reads at the authored rates', () => {
  // The defect: 1.93 -> 7.73 on foot. With the pace scale in, the shipped
  // compression cancels and the body walks at the authored 58 yd/min again.
  const foot = wallRate(58, 1, BALANCE);
  const cart = wallRate(105, 1, BALANCE);
  assert.ok(Math.abs(foot - 58 / 60) < 1e-9, `foot reads ${foot.toFixed(3)} yd/s, expected ${(58 / 60).toFixed(3)}`);
  assert.ok(Math.abs(cart - 105 / 60) < 1e-9, `cart reads ${cart.toFixed(3)} yd/s`);
});

test('fast-forward moves bodies up to the cap and no further', () => {
  for (const rung of [1, 2, 4]) {
    const foot = wallRate(58, rung, BALANCE);
    assert.ok(Math.abs(foot - (58 / 60) * rung) < 1e-9,
      `rung ${rung}: bodies follow fast-forward below the cap (got ${foot.toFixed(3)})`);
  }
  const at16 = wallRate(58, 16, BALANCE);
  assert.ok(Math.abs(at16 - (58 / 60) * GOLFER_LOCOMOTION_SPEED_CAP) < 1e-9,
    `rung 16 is capped at x${GOLFER_LOCOMOTION_SPEED_CAP} (got ${(at16 / (58 / 60)).toFixed(2)}x)`);
});

test('a doctored day length cannot move the wall rate - the shopper-split control', () => {
  // The exact control the locomotion pin uses: change ONLY the day length and
  // prove the body's wall speed does not move. If pace read the compression
  // wrong, this is where it shows.
  for (const dayFactor of [1, 2, 4, 8]) {
    const doctored = {
      ...BALANCE,
      gameMinutesPerRealSecond: BALANCE.npcTimingBaselineGameMinutesPerRealSecond * dayFactor,
    };
    const foot = wallRate(58, 1, doctored);
    assert.ok(Math.abs(foot - 58 / 60) < 1e-9,
      `day x${dayFactor}: wall rate moved to ${foot.toFixed(3)} yd/s`);
  }
});

test('the pace scale composes with the shopper multipliers, not against them', () => {
  // The decision multiplier and the golfer pace read the SAME compression; if
  // either grew its own notion of the day, the two populations would drift.
  const { decision } = simSpeedMultipliers(1); // rung index 1 = 1x in shipped speeds
  const rung = BALANCE.speeds[1] || 1;
  const compression = BALANCE.gameMinutesPerRealSecond / BALANCE.npcTimingBaselineGameMinutesPerRealSecond;
  assert.ok(Math.abs(decision - rung * compression) < 1e-9);
  assert.ok(Math.abs(golferPaceScale(rung) - compression * (rung / Math.min(rung, GOLFER_LOCOMOTION_SPEED_CAP))) < 1e-9);
});
