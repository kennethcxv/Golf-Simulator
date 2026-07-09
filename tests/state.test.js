import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY, HOLE_STATUS, ZONE } from '../src/sim/constants.js';
import { BALANCE } from '../src/sim/balance.js';
import { newGame, serialize, deserialize, update, rngOf } from '../src/sim/state.js';

test('newGame builds a complete starting state per mode', () => {
  const st = newGame('relaxed', 42);
  assert.equal(st.mode, 'relaxed');
  assert.equal(st.cash, BALANCE.startingCash.relaxed);
  assert.equal(st.course.holes.length, 9);
  assert.ok(st.sections.length > 0, 'sections precomputed');
  const st2 = newGame('realistic', 42);
  assert.equal(st2.cash, BALANCE.startingCash.realistic);
});

test('state serializes to JSON and back without losing the world', () => {
  const st = newGame('realistic', 1234);
  const json = serialize(st);
  assert.equal(typeof json, 'string');
  const back = deserialize(json);
  assert.equal(back.mode, st.mode);
  assert.equal(back.cash, st.cash);
  assert.equal(back.clock.minutes, st.clock.minutes);
  assert.deepEqual(Array.from(back.course.zones), Array.from(st.course.zones));
  assert.equal(back.course.holes.length, 9);
  assert.deepEqual(back.course.holes[3].pin, st.course.holes[3].pin);
  assert.ok(back.sections.length > 0, 'sections rebuilt on load');
});

test('rng stream resumes identically after save/load', () => {
  const st = newGame('relaxed', 555);
  rngOf(st).next(); // advance a bit
  rngOf(st).next();
  const json = serialize(st);
  const back = deserialize(json);
  assert.equal(rngOf(st).next(), rngOf(back).next());
  assert.equal(rngOf(st).int(1000), rngOf(back).int(1000));
});

test('update advances the clock and runs daily ticks across midnight', () => {
  const st = newGame('realistic', 9);
  const hole = st.course.holes[0];
  hole.status = HOLE_STATUS.RENOVATION;
  hole.daysLeft = 1;
  const res = update(st, MINUTES_PER_DAY);
  assert.equal(res.daysPassed, 1);
  assert.equal(hole.status, HOLE_STATUS.OPEN, 'renovation completed on the daily tick');
});

test('a fresh game is playable: open holes and cash to work with', () => {
  const st = newGame('realistic', 42);
  const open = st.course.holes.filter((h) => h.status === HOLE_STATUS.OPEN);
  assert.equal(open.length, 9);
  assert.ok(st.cash > 0);
  // there is actual fairway on the ground
  let fairway = 0;
  for (const z of st.course.zones) if (z === ZONE.FAIRWAY) fairway++;
  assert.ok(fairway > 200, `only ${fairway} fairway cells`);
});
