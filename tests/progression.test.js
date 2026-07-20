import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY, ZONE } from '../src/sim/constants.js';
import { newGame, update, serialize, deserialize } from '../src/sim/state.js';
import {
  UPGRADES, hasUpgrade, purchaseUpgrade, mowHoursFactor, waterCostFactor,
  fungicideCostFactor, outingPayoutFactor, prestigeDailyTick,
  TOURNAMENTS, scheduleTournament, canScheduleTournament,
} from '../src/sim/progression.js';
import { placeOrder } from '../src/sim/shop.js';

function boostCourse(st, health = 85) {
  st.turf.health.fill(health);
  st.turf.moisture.fill(55);
  st.turf.nutrients.fill(55);
  st.turf.disType.fill(0);
  st.turf.disSev.fill(0);
  st.turf.wear.fill(5);
  for (let i = 0; i < st.course.zones.length; i++) {
    if (st.course.zones[i] === ZONE.GREEN) st.turf.heightMm[i] = 3.5;
  }
  st.club.reputation = 60;
}

test('newGame initializes progression with prestige and an empty unlock set', () => {
  const st = newGame('realistic', 42);
  assert.ok(st.progression, 'progression state exists');
  assert.ok(st.progression.prestige >= 5 && st.progression.prestige <= 40, `starting prestige ${st.progression.prestige}`);
  assert.ok(Object.keys(UPGRADES).length >= 8, 'a real tree');
  assert.equal(hasUpgrade(st, 'greensMowerII'), false);
});

test('prestige drifts toward what the club has become', () => {
  const st = newGame('realistic', 42);
  boostCourse(st);
  st.club.reputation = 70;
  const before = st.progression.prestige;
  for (let i = 0; i < 12; i++) prestigeDailyTick(st);
  assert.ok(st.progression.prestige > before + 2, `prestige climbing: ${before} → ${st.progression.prestige}`);
});

test('upgrades gate on cash AND prestige, then change the sim for real', () => {
  const st = newGame('realistic', 42);
  st.progression.prestige = 5; // too low for anything
  const blocked = purchaseUpgrade(st, 'greensMowerII');
  assert.equal(blocked.ok, false);

  st.progression.prestige = 60;
  st.cash = 100;
  const broke = purchaseUpgrade(st, 'greensMowerII');
  assert.equal(broke.ok, false);

  st.cash = 50000;
  const cashBefore = st.cash;
  const res = purchaseUpgrade(st, 'greensMowerII');
  assert.equal(res.ok, true);
  assert.ok(st.cash < cashBefore);
  assert.equal(hasUpgrade(st, 'greensMowerII'), true);
  assert.ok(mowHoursFactor(st, 'green') < 1, 'triplex mowers cut greens faster');
  assert.equal(mowHoursFactor(st, 'rough'), 1, 'rough unaffected by a greens mower');

  purchaseUpgrade(st, 'smartIrrigation');
  assert.ok(waterCostFactor(st) < 1);
  purchaseUpgrade(st, 'sprayRig');
  assert.ok(fungicideCostFactor(st) < 1);
});

test('the premium supplier unlock opens tier-3 ordering', () => {
  const st = newGame('realistic', 42);
  st.cash = 60000;
  const before = placeOrder(st, 'balls3', 12); // tier 3
  assert.equal(before.ok, false);
  st.progression.prestige = 60;
  purchaseUpgrade(st, 'premiumSupplier');
  const after = placeOrder(st, 'balls3', 12);
  assert.equal(after.ok, true);
});

test('corporate partners raise outing payouts', () => {
  const st = newGame('realistic', 42);
  assert.equal(outingPayoutFactor(st), 1);
  st.progression.prestige = 60;
  st.cash = 60000;
  purchaseUpgrade(st, 'corporatePartners');
  assert.ok(outingPayoutFactor(st) > 1.2);
});

test('reciprocal network pays a daily line once unlocked', () => {
  const st = newGame('realistic', 42);
  boostCourse(st);
  st.progression.prestige = 60;
  st.cash = 60000;
  purchaseUpgrade(st, 'reciprocalClubs');
  update(st, MINUTES_PER_DAY);
  assert.ok(st.ledger.yesterday.revenue.reciprocal > 0, JSON.stringify(st.ledger.yesterday.revenue));
});

test('tournaments: gated, scheduled, and resolved with real stakes', () => {
  const st = newGame('realistic', 42);
  boostCourse(st, 88);
  st.cash = 100000;

  assert.equal(canScheduleTournament(st, 'clubChampionship').ok, false, 'needs the operations unlock');
  st.progression.prestige = 55;
  purchaseUpgrade(st, 'tournamentHost');
  assert.equal(canScheduleTournament(st, 'clubChampionship').ok, true);

  const res = scheduleTournament(st, 'clubChampionship');
  assert.equal(res.ok, true);
  const prestigeBefore = st.progression.prestige;
  update(st, (TOURNAMENTS.clubChampionship.leadDays + 1) * MINUTES_PER_DAY);
  assert.ok(st.progression.history.length >= 1, 'event went into the history');
  const outcome = st.progression.history[0];
  assert.equal(outcome.tier, 'clubChampionship');
  assert.equal(outcome.success, true, JSON.stringify(outcome));
  assert.ok(st.progression.prestige > prestigeBefore, 'a good event builds prestige');
  const eventsRev = st.ledger.history.reduce((a, d) => a + (d.revenue.events || 0), 0);
  assert.ok(eventsRev > 0, 'entry fees landed');
});

test('a tournament on a trashed course backfires', () => {
  const st = newGame('realistic', 999);
  st.cash = 100000;
  st.progression.prestige = 55;
  purchaseUpgrade(st, 'tournamentHost');
  scheduleTournament(st, 'clubChampionship');
  // trash the course before event day
  st.turf.health.fill(18);
  st.maintenance.crewUnits = 0;
  for (const key of Object.keys(st.maintenance.policies)) {
    st.maintenance.policies[key].irrigation = 'off';
  }
  st.weather.locked = true;
  st.weather.today = { tempHiF: 95, tempLoF: 70, rainIn: 0, humidity: 0.3, windMph: 5 };
  const prestigeBefore = st.progression.prestige;
  update(st, (TOURNAMENTS.clubChampionship.leadDays + 1) * MINUTES_PER_DAY);
  const outcome = st.progression.history[0];
  assert.equal(outcome.success, false, JSON.stringify(outcome));
  assert.ok(st.progression.prestige < prestigeBefore, 'embarrassment costs prestige');
});

test('the endgame: hosting the major wins the campaign', () => {
  const st = newGame('realistic', 42);
  // 93: the pass bar is condition ≥72 on the day after a week of hot-weather
  // decay — 90 left exactly one point of headroom and failed on seed drift
  boostCourse(st, 93);
  st.cash = 200000;
  st.progression.prestige = 90;
  purchaseUpgrade(st, 'tournamentHost');
  st.progression.hosted = { clubChampionship: 1, regionalAmateur: 1 };
  assert.equal(canScheduleTournament(st, 'major').ok, true);
  scheduleTournament(st, 'major');
  st.maintenance.crewUnits = 4;
  update(st, (TOURNAMENTS.major.leadDays + 1) * MINUTES_PER_DAY);
  assert.equal(st.progression.majorWon, true, JSON.stringify(st.progression.history[0]));
});

test('realistic mode can go bankrupt; relaxed mode gets a lifeline', () => {
  const hard = newGame('realistic', 42);
  hard.cash = -30000; // deep enough that daily takings can't outrun the overdraft
  hard.maintenance.crewUnits = 0;
  update(hard, 7 * MINUTES_PER_DAY);
  assert.ok(hard.failed, 'the bank called it');

  const soft = newGame('relaxed', 42);
  soft.cash = -6000;
  update(soft, 3 * MINUTES_PER_DAY);
  assert.ok(!soft.failed, 'relaxed never hard-fails');
  assert.ok(soft.cash >= -5000, `the bank floors you: ${soft.cash}`);
});

test('progression survives save/load', () => {
  const st = newGame('realistic', 42);
  st.progression.prestige = 60;
  st.cash = 60000;
  purchaseUpgrade(st, 'greensMowerII');
  purchaseUpgrade(st, 'tournamentHost');
  scheduleTournament(st, 'clubChampionship');
  const back = deserialize(serialize(st));
  assert.equal(hasUpgrade(back, 'greensMowerII'), true);
  assert.deepEqual(back.progression.event, st.progression.event);
  assert.equal(back.progression.prestige, st.progression.prestige);
});
