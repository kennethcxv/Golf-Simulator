import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY } from '../src/sim/constants.js';
import { newGame, update, serialize, deserialize } from '../src/sim/state.js';
import { TUTORIAL_STEPS, tickTutorial, tutorialFlag } from '../src/sim/tutorial.js';
import { placeOrder, deliverOrdersDue, clearClutter } from '../src/sim/shop.js';
import { openBox } from '../src/sim/deliveries.js';
import { checkoutSale } from '../src/sim/checkout.js';
import { treatSection } from '../src/sim/turf.js';
import { ZONE } from '../src/sim/constants.js';
import { calendarOf } from '../src/sim/time.js';

test('tutorial exists, starts at the beginning, and has a real arc', () => {
  const st = newGame('realistic', 42);
  assert.ok(st.tutorial);
  assert.equal(st.tutorial.step, 0);
  assert.ok(TUTORIAL_STEPS.length >= 8, `${TUTORIAL_STEPS.length} steps`);
  for (const s of TUTORIAL_STEPS) {
    assert.ok(s.id && s.title && s.hint && typeof s.check === 'function');
  }
});

test('the opening chain follows the physical clubhouse loop, in order', () => {
  const st = newGame('realistic', 42);
  assert.equal(tickTutorial(st).advanced.length, 0, 'nothing done yet');

  tutorialFlag(st, 'shopWalked'); // stepped through the real door
  let res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'walk-in'));

  clearClutter(st, 0); // hauled a pile
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'haul-clean'));

  placeOrder(st, 'balls1', 12); // ordered at the laptop
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'order-stock'));

  // the truck comes; unbox a case in the stockroom
  deliverOrdersDue(st, calendarOf(st.clock.minutes).dayAbs + 5);
  openBox(st, st.shop.deliveries.boxes[0].id);
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'unbox'));

  tutorialFlag(st, 'shelved'); // walked it to a display
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'shelve'));

  checkoutSale(st, [{ skuId: 'balls1', price: 15 }], 'First customer'); // rang the register
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'first-ring'), JSON.stringify(st.tutorial));
  assert.equal(st.tutorial.step, 6, 'the whole shop-opening chain cleared in order');
});

test('the arc completes at real club maturity', () => {
  const st = newGame('realistic', 42);
  tutorialFlag(st, 'shopWalked');
  tutorialFlag(st, 'shelved');
  clearClutter(st, 0);
  placeOrder(st, 'balls1', 6);
  deliverOrdersDue(st, calendarOf(st.clock.minutes).dayAbs + 5);
  openBox(st, st.shop.deliveries.boxes[0].id);
  checkoutSale(st, [{ skuId: 'balls1', price: 15 }], 'QA');
  st.turf.disType.fill(0);
  st.turf.disSev.fill(0);
  st.maintenance.crewUnits = 3;
  st.ledger.yesterday = { net: 500, revenue: {}, expense: {} };
  st.progression.prestige = 32;
  tickTutorial(st);
  assert.equal(st.tutorial.complete, true, JSON.stringify(st.tutorial));
});

test('tutorial state survives save/load', () => {
  const st = newGame('realistic', 42);
  tutorialFlag(st, 'shopWalked');
  tickTutorial(st);
  const back = deserialize(serialize(st));
  assert.equal(back.tutorial.step, st.tutorial.step);
  assert.deepEqual(back.tutorial.flags, st.tutorial.flags);
});

test('a naturally played opening advances the early arc', () => {
  const st = newGame('realistic', 42);
  tutorialFlag(st, 'shopWalked');
  clearClutter(st, 1);
  for (const s of st.sections) {
    if (s.zone === ZONE.GREEN) treatSection(st, s);
  }
  update(st, MINUTES_PER_DAY * 12);
  tickTutorial(st);
  assert.ok(st.tutorial.step >= 2, `progressed to ${st.tutorial.step}`);
});
