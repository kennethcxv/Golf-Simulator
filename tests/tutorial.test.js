import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY } from '../src/sim/constants.js';
import { newGame, update, serialize, deserialize } from '../src/sim/state.js';
import { TUTORIAL_STEPS, tickTutorial, tutorialFlag } from '../src/sim/tutorial.js';
import { placeOrder } from '../src/sim/shop.js';
import { treatSection } from '../src/sim/turf.js';
import { ZONE } from '../src/sim/constants.js';

test('tutorial exists, starts at the beginning, and has a real arc', () => {
  const st = newGame('realistic', 42);
  assert.ok(st.tutorial);
  assert.equal(st.tutorial.step, 0);
  assert.ok(TUTORIAL_STEPS.length >= 8, `${TUTORIAL_STEPS.length} steps`);
  for (const s of TUTORIAL_STEPS) {
    assert.ok(s.id && s.title && s.hint && typeof s.check === 'function');
  }
});

test('steps advance only when their real conditions are met', () => {
  const st = newGame('realistic', 42);
  assert.equal(tickTutorial(st).advanced.length, 0, 'nothing done yet');
  assert.equal(st.tutorial.step, 0);

  tutorialFlag(st, 'groundsOpened');
  let res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'meet-grounds'));
  assert.equal(st.tutorial.step, 1);

  // treat a sick green → the turf-care step clears
  const sick = st.sections.find((s) => s.zone === ZONE.GREEN && (() => {
    for (const i of s.cells) if (st.turf.disType[i]) return true;
    return false;
  })());
  treatSection(st, sick);
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'treat-green'), JSON.stringify(st.tutorial));

  // hire day labor
  st.maintenance.crewUnits = 2;
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'staff-up'));

  // order stock
  placeOrder(st, 'balls1', 12);
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'stock-shop'));

  // walk the floor + touch prices
  tutorialFlag(st, 'shopWalked');
  tutorialFlag(st, 'priceTouched');
  res = tickTutorial(st);
  assert.ok(st.tutorial.step >= 6, `now at ${st.tutorial.step}`);
});

test('the arc completes at real club maturity', () => {
  const st = newGame('realistic', 42);
  // brute-force every condition
  tutorialFlag(st, 'groundsOpened');
  tutorialFlag(st, 'shopWalked');
  tutorialFlag(st, 'priceTouched');
  st.turf.disType.fill(0);
  st.turf.disSev.fill(0);
  st.maintenance.crewUnits = 3;
  placeOrder(st, 'balls1', 6);
  st.golfers.pool[0].memberTier = 'full';
  st.golfers.pool[0].joinedDay = 3;
  st.ledger.yesterday = { net: 500, revenue: {}, expense: {} };
  st.club.amenities.range = 1;
  st.progression.prestige = 32;
  tickTutorial(st);
  assert.equal(st.tutorial.complete, true, JSON.stringify(st.tutorial));
});

test('tutorial state survives save/load', () => {
  const st = newGame('realistic', 42);
  tutorialFlag(st, 'groundsOpened');
  tickTutorial(st);
  const back = deserialize(serialize(st));
  assert.equal(back.tutorial.step, st.tutorial.step);
  assert.deepEqual(back.tutorial.flags, st.tutorial.flags);
});

test('a naturally played opening advances the early arc', () => {
  const st = newGame('realistic', 42);
  tutorialFlag(st, 'groundsOpened');
  st.maintenance.crewUnits = 2;
  // let the sick greens get treated and a day pass
  for (const s of st.sections) {
    if (s.zone === ZONE.GREEN) treatSection(st, s);
  }
  update(st, MINUTES_PER_DAY * 12);
  tickTutorial(st);
  assert.ok(st.tutorial.step >= 2, `progressed to ${st.tutorial.step}`);
});
