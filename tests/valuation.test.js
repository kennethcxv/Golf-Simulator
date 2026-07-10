import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY, HOLE_STATUS } from '../src/sim/constants.js';
import { newGame, update } from '../src/sim/state.js';
import { nonMembers } from '../src/sim/golfers.js';
import { appraiseProperty, appraisalBreakdown, trailingMonthlyNet } from '../src/sim/valuation.js';

function boostCourse(st, health = 85) {
  st.turf.health.fill(health);
  st.turf.moisture.fill(55);
  st.turf.nutrients.fill(55);
  st.turf.heightMm.fill(6);
  st.turf.wear.fill(4);
  st.turf.disType.fill(0);
  st.turf.disSev.fill(0);
}

function tankCourse(st) {
  st.turf.health.fill(16);
  st.turf.heightMm.fill(60);
  st.turf.wear.fill(55);
}

function fakeHistory(st, dailyNet, days = 24) {
  st.ledger.history = [];
  for (let d = 0; d < days; d++) {
    st.ledger.history.push({ dayAbs: d, net: dailyNet });
  }
}

test('appraisal is a pure read: repeatable and leaves the rng stream alone', () => {
  const st = newGame('realistic', 42);
  const rngBefore = st.rngState;
  const a = appraiseProperty(st);
  const b = appraiseProperty(st);
  assert.equal(a, b);
  assert.equal(st.rngState, rngBefore, 'valuation must not consume randomness');
  assert.ok(a > 20000 && a < 200000, `fresh muni appraises in a sane band: ${a}`);
});

test('two differently-conditioned copies of the same property diverge the right way', () => {
  const thriving = newGame('realistic', 777);
  const neglected = newGame('realistic', 777);
  boostCourse(thriving);
  tankCourse(neglected);
  const vThriving = appraiseProperty(thriving);
  const vNeglected = appraiseProperty(neglected);
  assert.ok(
    vThriving > vNeglected * 1.2,
    `thriving ${vThriving} should clear neglected ${vNeglected} by a wide margin`,
  );
});

test('restoring condition on one property raises its own valuation', () => {
  const st = newGame('realistic', 555);
  tankCourse(st);
  const before = appraiseProperty(st);
  boostCourse(st);
  const after = appraiseProperty(st);
  assert.ok(after > before, `condition work pays: ${before} → ${after}`);
});

test('design damage (holes out of play) drags the valuation down', () => {
  const st = newGame('realistic', 99);
  const whole = appraiseProperty(st);
  for (const hole of st.course.holes.slice(0, 5)) {
    hole.status = HOLE_STATUS.RENOVATION;
    hole.daysLeft = 10;
  }
  const broken = appraiseProperty(st);
  assert.ok(broken < whole, `torn-up routing is worth less: ${whole} → ${broken}`);
});

test('membership base moves the valuation', () => {
  const st = newGame('realistic', 42);
  const before = appraiseProperty(st);
  let added = 0;
  for (const g of nonMembers(st)) {
    if (added >= 25) break;
    g.memberTier = 'full';
    added++;
  }
  const after = appraiseProperty(st);
  assert.ok(added >= 20, 'test setup: enough prospects to convert');
  assert.ok(after > before, `a real book of members is worth money: ${before} → ${after}`);
});

test('reputation moves the valuation', () => {
  const st = newGame('realistic', 42);
  st.club.reputation = 20;
  const low = appraiseProperty(st);
  st.club.reputation = 72;
  const high = appraiseProperty(st);
  assert.ok(high > low, `reputation carries value: ${low} vs ${high}`);
});

test('trailing income history moves the valuation in both directions', () => {
  const st = newGame('realistic', 42);
  fakeHistory(st, 900);
  const profitable = appraiseProperty(st);
  assert.equal(trailingMonthlyNet(st), 900 * 24, 'trailing seasonal net from a steady book');
  fakeHistory(st, -900);
  const bleeding = appraiseProperty(st);
  assert.ok(profitable > bleeding, `profits price in: ${profitable} vs ${bleeding}`);
});

test('trailing net handles short and missing histories', () => {
  const st = newGame('realistic', 42);
  st.ledger.history = [];
  assert.equal(trailingMonthlyNet(st), 0);
  fakeHistory(st, 600, 5); // only 5 closed days so far
  assert.equal(trailingMonthlyNet(st), 600 * 24, 'short history extrapolates the daily average');
});

test('a game actually lived in appraises consistently with its breakdown', () => {
  const st = newGame('realistic', 4242);
  update(st, 6 * MINUTES_PER_DAY);
  const value = appraiseProperty(st);
  const b = appraisalBreakdown(st);
  assert.equal(b.value, value, 'breakdown and headline value agree');
  assert.ok(b.design > 0 && b.condition > 0);
  assert.ok(b.members >= 0 && Number.isFinite(b.monthlyNet));
  assert.equal(b.size, 9);
});
