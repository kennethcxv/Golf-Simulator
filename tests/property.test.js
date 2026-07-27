// The rent falls due whether or not you had a good week.
//
// The build charged wages, utilities and upkeep — but nothing for the property itself, which is
// the single largest fixed cost a business like this actually has. Without it there is no floor
// under the player's decisions: you can sit on a broken course forever and never feel it.
//
// So: a weekly property bill sized off what the place is worth, charged on a schedule you can see
// coming, with a warning before it lands and consequences if it doesn't get paid.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import {
  ensureProperty, propertyState, weeklyCharge, tickProperty, arrearsOf,
  RENT_RATE, WARN_DAYS, CYCLE_DAYS,
} from '../src/sim/property.js';

const fresh = () => {
  const st = newGame('relaxed', 5);
  st.club.valuation = 46500;
  ensureProperty(st);
  return st;
};

test('the bill is sized off what the property is worth', () => {
  const st = fresh();
  const w = weeklyCharge(st);
  assert.ok(w > 0, 'there is a bill at all');
  assert.equal(w, Math.round(46500 * RENT_RATE), 'and it is a real fraction of the valuation');
  assert.ok(w > 300 && w < 1200, `it is felt but survivable ($${w}/week)`);
});

test('it lands on a schedule, not at random', () => {
  const st = fresh();
  const p = propertyState(st);
  assert.equal(p.nextDueDay, CYCLE_DAYS, 'the first bill is one cycle away');

  const events = [];
  for (let day = 1; day <= CYCLE_DAYS * 3; day++) {
    const r = tickProperty(st, day);
    if (r.charged) events.push(day);
  }
  assert.deepEqual(events, [CYCLE_DAYS, CYCLE_DAYS * 2, CYCLE_DAYS * 3], 'every cycle, exactly once');
});

test('you are warned before it lands, not after', () => {
  const st = fresh();
  const warned = [];
  for (let day = 1; day <= CYCLE_DAYS; day++) {
    const r = tickProperty(st, day);
    if (r.warning) warned.push(day);
  }
  assert.equal(warned.length, 1, 'one warning, not a nag every day');
  assert.equal(warned[0], CYCLE_DAYS - WARN_DAYS, `${WARN_DAYS} days ahead`);
});

test('paying it takes the money', () => {
  const st = fresh();
  st.cash = 20000;
  const w = weeklyCharge(st);
  const r = tickProperty(st, CYCLE_DAYS);
  assert.equal(r.charged, true);
  assert.equal(r.paid, true);
  assert.equal(st.cash, 20000 - w, 'the cash actually left');
  assert.equal(arrearsOf(st), 0);
});

test('missing it puts you in arrears, and the arrears grow', () => {
  const st = fresh();
  st.cash = 10; // broke
  const w = weeklyCharge(st);

  const r1 = tickProperty(st, CYCLE_DAYS);
  assert.equal(r1.paid, false, 'could not pay');
  assert.equal(r1.missed, true);
  assert.equal(st.cash, 10, 'and it did not take money you do not have');
  assert.equal(arrearsOf(st), w, 'it is owed');

  const r2 = tickProperty(st, CYCLE_DAYS * 2);
  assert.ok(arrearsOf(st) > w * 2, `arrears carry interest (${arrearsOf(st)} vs ${w * 2})`);
  assert.equal(r2.missedTotal, 2, 'and the game is counting');
});

test('coming into money clears what is owed first', () => {
  const st = fresh();
  st.cash = 10;
  tickProperty(st, CYCLE_DAYS); // miss one
  const owed = arrearsOf(st);
  assert.ok(owed > 0);

  st.cash = 20000; // a good week
  tickProperty(st, CYCLE_DAYS * 2);
  assert.equal(arrearsOf(st), 0, 'the debt is settled');
  assert.ok(st.cash < 20000 - weeklyCharge(st), 'and the back rent came out too');
});

test('falling far enough behind is a real problem, and the game says so', () => {
  const st = fresh();
  st.cash = 0;
  let last = null;
  for (let i = 1; i <= 6; i++) last = tickProperty(st, CYCLE_DAYS * i);
  assert.ok(last.missedTotal >= 5);
  assert.ok(last.severe, 'the game escalates rather than silently accruing forever');
  assert.ok(last.message && /behind|arrears|owe/i.test(last.message), `it says so: "${last.message}"`);
});

test('the schedule survives a save', () => {
  const st = fresh();
  tickProperty(st, CYCLE_DAYS);
  const loaded = JSON.parse(JSON.stringify(st));
  ensureProperty(loaded);
  assert.equal(propertyState(loaded).nextDueDay, propertyState(st).nextDueDay);
  assert.equal(arrearsOf(loaded), arrearsOf(st));
});

test('a legacy save gains a schedule rather than a crash', () => {
  const st = newGame('relaxed', 5);
  delete st.property;
  ensureProperty(st);
  assert.ok(propertyState(st).nextDueDay > 0);
  assert.ok(weeklyCharge(st) > 0, 'and a bill sized off whatever it is worth');
});
