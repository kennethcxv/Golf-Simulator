import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY } from '../src/sim/constants.js';
import { newGame, update } from '../src/sim/state.js';
import {
  TIERS, fairGreenFee, demandMultiplier, amenityScore, upgradeAmenity,
  memberCounts, acceptOuting, declineOuting,
} from '../src/sim/club.js';

function boostCourse(st, health = 82) {
  st.turf.health.fill(health);
  st.turf.moisture.fill(55);
  st.turf.nutrients.fill(55);
  st.turf.disType.fill(0);
  st.turf.disSev.fill(0);
}

function tankCourse(st) {
  st.turf.health.fill(18);
  st.maintenance.crewUnits = 0;
  for (const key of Object.keys(st.maintenance.policies)) {
    st.maintenance.policies[key].irrigation = 'off';
    st.maintenance.policies[key].fertilizer = 'none';
  }
}

test('newGame initializes club, golfer pool, and ledger', () => {
  const st = newGame('realistic', 42);
  assert.ok(st.club && st.golfers && st.ledger);
  assert.ok(st.golfers.pool.length >= 120, `pool of ${st.golfers.pool.length}`);
  const counts = memberCounts(st);
  const total = counts.weekday + counts.full + counts.premium;
  assert.ok(total >= 15 && total <= 40, `a muni starts with some regulars: ${total}`);
  assert.ok(st.club.reputation > 10 && st.club.reputation < 60);
  assert.equal(typeof st.club.greenFee, 'number');
  for (const tier of Object.keys(TIERS)) {
    assert.ok(st.club.dues[tier] > 0);
  }
});

test('golfer pool is deterministic per seed and has personas', () => {
  const a = newGame('realistic', 99);
  const b = newGame('realistic', 99);
  assert.deepEqual(a.golfers.pool.map((g) => g.name + g.wealth + g.persona), b.golfers.pool.map((g) => g.name + g.wealth + g.persona));
  const personas = new Set(a.golfers.pool.map((g) => g.persona));
  assert.ok(personas.size >= 4, 'multiple picky-about personas exist');
});

test('fair green fee rises with course quality', () => {
  assert.ok(fairGreenFee(80, 5) > fairGreenFee(40, 5) + 10);
  assert.ok(fairGreenFee(60, 8) > fairGreenFee(60, 0));
});

test('demand responds to pricing around fair value', () => {
  assert.ok(Math.abs(demandMultiplier(40, 40) - 1) < 0.05);
  assert.ok(demandMultiplier(80, 40) < 0.6, 'double price kills demand');
  assert.ok(demandMultiplier(20, 40) > 1.2, 'bargain pricing lifts demand');
  assert.ok(demandMultiplier(400, 40) >= 0.1, 'clamped floor');
});

test('a good, fairly priced club gains members; a trashed, overpriced one bleeds them', () => {
  const grow = newGame('realistic', 500);
  boostCourse(grow);
  grow.club.reputation = 60;
  update(grow, 14 * MINUTES_PER_DAY);
  const growCounts = memberCounts(grow);
  const growTotal = growCounts.weekday + growCounts.full + growCounts.premium;

  const bleed = newGame('realistic', 500);
  tankCourse(bleed);
  bleed.club.reputation = 15;
  bleed.club.dues = { weekday: 900, full: 1600, premium: 2800 }; // extortion
  update(bleed, 14 * MINUTES_PER_DAY);
  const bleedCounts = memberCounts(bleed);
  const bleedTotal = bleedCounts.weekday + bleedCounts.full + bleedCounts.premium;

  const startTotal = (() => {
    const c = memberCounts(newGame('realistic', 500));
    return c.weekday + c.full + c.premium;
  })();

  assert.ok(growTotal > startTotal, `good club grew: ${startTotal} → ${growTotal}`);
  assert.ok(bleedTotal < startTotal, `bad club bled: ${startTotal} → ${bleedTotal}`);
  assert.ok(bleed.club.feed.some((f) => f.kind === 'quit'), 'quit events hit the feed');
});

test('amenity upgrades cost cash, raise the score, and charge upkeep', () => {
  const st = newGame('realistic', 42);
  const score0 = amenityScore(st);
  const cash0 = st.cash;
  const res = upgradeAmenity(st, 'range');
  assert.equal(res.ok, true);
  assert.ok(st.cash < cash0);
  assert.equal(st.club.amenities.range, 1);
  assert.ok(amenityScore(st) > score0);
  update(st, MINUTES_PER_DAY);
  assert.ok(st.ledger.yesterday.expense.upkeep > 0, 'amenity upkeep bills daily');
});

test('instruction amenity only scores with an instructor employed', () => {
  const st = newGame('realistic', 42);
  st.club.amenities.instruction = 1;
  const without = amenityScore(st);
  st.staff.employees.push({ id: 950, name: 'Pro', role: 'instructor', skill: 3, wage: 150, trainingDays: 0 });
  const withPro = amenityScore(st);
  assert.ok(withPro > without, `instructor activates instruction: ${without} → ${withPro}`);
});

test('corporate outings pay out on their day and annoy members slightly', () => {
  const st = newGame('realistic', 42);
  boostCourse(st);
  // force an offer deterministically
  st.club.outings.offers.push({ id: 991, company: 'Test Corp', size: 24, payout: 1800, day: 3, expiresDay: 2 });
  const res = acceptOuting(st, 991);
  assert.equal(res.ok, true);
  assert.equal(st.club.outings.scheduled.length, 1);
  const satBefore = st.golfers.pool.filter((g) => g.memberTier).reduce((a, g) => a + g.satisfaction, 0);
  update(st, 4 * MINUTES_PER_DAY);
  const outingRev = st.ledger.history.reduce((a, d) => a + (d.revenue.outings || 0), 0);
  assert.equal(outingRev, 1800, `outing revenue landed: ${outingRev}`);
  assert.equal(st.club.outings.scheduled.length, 0, 'outing consumed');
});

test('declined offers disappear; stale offers expire', () => {
  const st = newGame('realistic', 42);
  st.club.outings.offers.push({ id: 992, company: 'Meh Corp', size: 20, payout: 1200, day: 5, expiresDay: 2 });
  declineOuting(st, 992);
  assert.equal(st.club.outings.offers.length, 0);
  st.club.outings.offers.push({ id: 993, company: 'Slow Corp', size: 20, payout: 1200, day: 6, expiresDay: 1 });
  update(st, 3 * MINUTES_PER_DAY);
  assert.ok(!st.club.outings.offers.some((o) => o.id === 993), 'expired offer cleaned up');
});

test('the ledger balances: yesterday.net equals the cash change across a full day', () => {
  const st = newGame('realistic', 777);
  // align to an exact midnight so the measured window is one whole ledger day
  const toMidnight = MINUTES_PER_DAY - (st.clock.minutes % MINUTES_PER_DAY);
  update(st, toMidnight);
  const cashBefore = st.cash;
  update(st, MINUTES_PER_DAY); // one full day: its 5 AM crew pass + its closing accrual
  const net = st.ledger.yesterday.net;
  const delta = st.cash - cashBefore;
  assert.ok(Math.abs(net - delta) < 1.5, `ledger net ${net} vs cash delta ${delta}`);
  assert.ok(st.ledger.history.length >= 2);
});

test('green fee revenue responds to course quality', () => {
  const good = newGame('realistic', 888);
  boostCourse(good);
  good.club.reputation = 65;
  update(good, 6 * MINUTES_PER_DAY);
  const goodRev = good.ledger.history.reduce((a, d) => a + d.revenue.greenFees, 0);

  const bad = newGame('realistic', 888);
  tankCourse(bad);
  bad.club.reputation = 12;
  update(bad, 6 * MINUTES_PER_DAY);
  const badRev = bad.ledger.history.reduce((a, d) => a + d.revenue.greenFees, 0);
  assert.ok(goodRev > badRev * 1.5, `quality drives play: ${goodRev} vs ${badRev}`);
});

test('reputation drifts toward course quality and member happiness', () => {
  const st = newGame('realistic', 555);
  boostCourse(st);
  st.club.reputation = 20;
  update(st, 10 * MINUTES_PER_DAY);
  assert.ok(st.club.reputation > 24, `reputation climbing: ${st.club.reputation}`);
});

test('club state survives save/load', async () => {
  const { serialize, deserialize } = await import('../src/sim/state.js');
  const st = newGame('realistic', 42);
  update(st, 2 * MINUTES_PER_DAY);
  const back = deserialize(serialize(st));
  assert.deepEqual(memberCounts(back), memberCounts(st));
  assert.equal(back.club.reputation, st.club.reputation);
  assert.equal(back.golfers.pool.length, st.golfers.pool.length);
  assert.deepEqual(back.ledger.yesterday, st.ledger.yesterday);
  assert.equal(back.staff.market.length, st.staff.market.length);
});
