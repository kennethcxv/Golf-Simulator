import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY } from '../src/sim/constants.js';
import { newGame, update, serialize, deserialize } from '../src/sim/state.js';
import {
  TUTORIAL_STEPS, tickTutorial, tutorialFlag, skipTutorial, replayTutorial,
} from '../src/sim/tutorial.js';
import { placeOrder, deliverOrdersDue, clearClutter } from '../src/sim/shop.js';
import { openBox } from '../src/sim/deliveries.js';
import { checkoutSale } from '../src/sim/checkout.js';
import { treatSection } from '../src/sim/turf.js';
import { ZONE } from '../src/sim/constants.js';
import { calendarOf } from '../src/sim/time.js';

// walks the full opening loop with real actions; used by several tests
function playOpening(st) {
  tutorialFlag(st, 'lookedAround');
  tutorialFlag(st, 'walkedABit');
  tutorialFlag(st, 'doorOpened');
  tutorialFlag(st, 'shopWalked');
  clearClutter(st, 0);
  tutorialFlag(st, 'windowWiped');
  tutorialFlag(st, 'laptopOpened');
  placeOrder(st, 'balls1', 12);
  deliverOrdersDue(st, calendarOf(st.clock.minutes).dayAbs + 5);
  tutorialFlag(st, 'boxCarried');
  tutorialFlag(st, 'boxCut');
  openBox(st, st.shop.deliveries.boxes[0].id);
  tutorialFlag(st, 'shelved');
  checkoutSale(st, [{ skuId: 'balls1', price: 15 }], 'First customer');
  tutorialFlag(st, 'savedGame');
}

test('tutorial exists, starts at the beginning, and has a chaptered arc', () => {
  const st = newGame('realistic', 42);
  assert.ok(st.tutorial);
  assert.equal(st.tutorial.step, 0);
  assert.ok(TUTORIAL_STEPS.length >= 15, `${TUTORIAL_STEPS.length} steps`);
  const chapters = new Set(TUTORIAL_STEPS.map((s) => s.chapter).filter(Boolean));
  assert.ok(chapters.size >= 6, `${chapters.size} chapters`);
  for (const s of TUTORIAL_STEPS) {
    assert.ok(s.id && s.title && s.hint && typeof s.check === 'function');
  }
});

test('the opening chain follows the physical clubhouse loop, in order', () => {
  const st = newGame('realistic', 42);
  assert.equal(tickTutorial(st).advanced.length, 0, 'nothing done yet');

  tutorialFlag(st, 'lookedAround');
  tutorialFlag(st, 'walkedABit');
  tutorialFlag(st, 'doorOpened');
  tutorialFlag(st, 'shopWalked');
  let res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'walk-in'), 'arrival chapter clears');

  clearClutter(st, 0);
  tutorialFlag(st, 'windowWiped');
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'wipe-window'), 'mess chapter clears');

  tutorialFlag(st, 'laptopOpened');
  placeOrder(st, 'balls1', 12);
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'order-stock'), 'office chapter clears');

  deliverOrdersDue(st, calendarOf(st.clock.minutes).dayAbs + 5);
  tutorialFlag(st, 'boxCarried');
  tutorialFlag(st, 'boxCut');
  openBox(st, st.shop.deliveries.boxes[0].id);
  tutorialFlag(st, 'shelved');
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'shelve'), 'receiving chapter clears');

  checkoutSale(st, [{ skuId: 'balls1', price: 15 }], 'First customer');
  tutorialFlag(st, 'savedGame');
  res = tickTutorial(st);
  assert.ok(res.advanced.some((s) => s.id === 'save-game'), 'sale + save clear');
});

test('actions done out of order are banked and skipped past on arrival', () => {
  const st = newGame('realistic', 42);
  // the player saves and rings a sale before ever touching the arrival steps
  tutorialFlag(st, 'savedGame');
  checkoutSale(st, [{ skuId: 'balls1', price: 15 }], 'Early bird');
  assert.equal(tickTutorial(st).advanced.length, 0, 'later steps wait their turn');
  playOpening(st);
  tickTutorial(st);
  const saveIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'save-game');
  assert.ok(st.tutorial.step > saveIdx, 'banked steps cleared without repeating them');
});

test('the arc completes at real club maturity', () => {
  const st = newGame('realistic', 42);
  playOpening(st);
  st.turf.disType.fill(0);
  st.turf.disSev.fill(0);
  st.maintenance.crewUnits = 3;
  st.ledger.yesterday = { net: 500, revenue: {}, expense: {} };
  st.progression.prestige = 32;
  tickTutorial(st);
  assert.equal(st.tutorial.complete, true, JSON.stringify(st.tutorial));
});

test('skip ends the guide; replay restarts it and banks what is already true', () => {
  const st = newGame('realistic', 42);
  skipTutorial(st);
  assert.equal(st.tutorial.complete, true);
  replayTutorial(st);
  assert.equal(st.tutorial.complete, false);
  assert.equal(st.tutorial.step, 0);
  tutorialFlag(st, 'lookedAround');
  tutorialFlag(st, 'walkedABit');
  tickTutorial(st);
  assert.ok(st.tutorial.step >= 2, 'replayed guide advances again');
});

test('tutorial state survives save/load', () => {
  const st = newGame('realistic', 42);
  tutorialFlag(st, 'lookedAround');
  tutorialFlag(st, 'walkedABit');
  tickTutorial(st);
  const back = deserialize(serialize(st));
  assert.equal(back.tutorial.step, st.tutorial.step);
  assert.deepEqual(back.tutorial.flags, st.tutorial.flags);
});

test('a naturally played opening advances the early arc', () => {
  const st = newGame('realistic', 42);
  tutorialFlag(st, 'lookedAround');
  tutorialFlag(st, 'walkedABit');
  tutorialFlag(st, 'doorOpened');
  tutorialFlag(st, 'shopWalked');
  clearClutter(st, 1);
  for (const s of st.sections) {
    if (s.zone === ZONE.GREEN) treatSection(st, s);
  }
  update(st, MINUTES_PER_DAY * 12);
  tickTutorial(st);
  assert.ok(st.tutorial.step >= 4, `progressed to ${st.tutorial.step}`);
});
