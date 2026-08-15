import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE, simSpeedMultipliers } from '../src/sim/balance.js';

// G8 (Goal 17) — THERE IS ONE SPEED, AND NO INDEX CAN CHANGE IT.
//
// "Delete the speed ladder above 1x entirely, and every path that reads it,
// including the NPC decision/locomotion split."
//
// The ladder was removed in the previous session. This pins it, because the
// failure mode is subtle: the FUNCTION still takes a speedIdx argument (it has
// to - callers pass one, and the symbol is load-bearing in older drivers), so
// nothing about its signature would reveal a rung creeping back in. The only
// honest check is behavioural: feed it every index and require the answer never
// to move.

test('no speed index changes the simulation rate', () => {
  const at1 = simSpeedMultipliers(1);
  for (const idx of [0, 1, 2, 3, 4, 99, -1, undefined, null]) {
    assert.deepEqual(simSpeedMultipliers(idx), at1,
      `speed index ${idx} must produce the same multipliers as 1x`);
  }
});

test('locomotion is pinned at 1, so nobody ever runs at 500 mph', () => {
  // The brief's complaint was "sped-up customers running at 500 mph looks
  // absurd". Locomotion is the term that did that; decision is day compression
  // and is a different thing.
  assert.equal(simSpeedMultipliers(1).locomotion, 1);
});

test('a trading day is 180 real minutes at the only speed there is', () => {
  const perRealSecond = BALANCE.gameMinutesPerRealSecond;
  const realMinutesPerDay = 1440 / perRealSecond / 60;
  assert.ok(Math.abs(realMinutesPerDay - 180) < 0.5,
    `a day runs ${realMinutesPerDay.toFixed(2)} real minutes`);
  assert.ok(Math.abs(perRealSecond * 60 - 8) < 0.01,
    'which is 8 game-minutes per real minute');
});
