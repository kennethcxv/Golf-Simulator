// GOLF EMPIRE — the LIVING market: new listings appear over time (Task 1),
// ignored listings get bought by rival investors (Task 2), and a slow
// buyer's/seller's-market cycle moves new asking prices (Task 3).
//
// World-clock rule: the market only moves while world time moves. These tests
// drive the same marketTick the real empireUpdate loop calls — mostly via the
// no-active-club world clock (fast), plus one test through the full live sim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY, HOLE_STATUS } from '../src/sim/constants.js';
import { courseDesignRating, validateHole, holeDistanceYd } from '../src/sim/course.js';
import { MARKET, generateListing, buildPropertyCourse } from '../src/sim/marketplace.js';
import {
  newEmpire, buyProperty, empireUpdate, marketTick,
  serializeEmpire, deserializeEmpire,
} from '../src/sim/empire.js';

// Advance the empire's world clock day by day with no active club — the same
// marketTick the real update loop calls, without paying for a live turf sim.
function skipDays(e, n, eachDay = null) {
  for (let d = 0; d < n; d++) {
    e.clockMinutes += MINUTES_PER_DAY;
    marketTick(e);
    if (eachDay) eachDay(e, d);
  }
}

// --- Task 1: new listings over time ------------------------------------------------

test('the refresh cadence knobs are tuned to the brief, not hardcoded inline', () => {
  assert.ok(MARKET.maxListings >= 10 && MARKET.maxListings <= 12,
    `cap of ${MARKET.maxListings} unsold listings stays in the 10-12 band`);
  const expectedDaysPerListing = MARKET.refreshEveryDays / MARKET.refreshChance;
  assert.ok(expectedDaysPerListing >= 6 && expectedDaysPerListing <= 14,
    `a new listing lands roughly every 1-2 in-game weeks (expected ~${expectedDaysPerListing.toFixed(1)}d)`);
});

test('new listings appear on the market over simulated weeks', () => {
  const e = newEmpire('relaxed', 4242);
  const originalIds = new Set(e.market.map((p) => p.id));
  skipDays(e, 60);
  const fresh = e.market.filter((p) => !originalIds.has(p.id));
  assert.ok(fresh.length >= 2, `sixty quiet days bring new stock: got ${fresh.length}`);
  for (const p of fresh) {
    assert.ok(p.listedDay > 0, 'a new listing knows the day it hit the market');
    assert.ok(typeof p.name === 'string' && p.name.length > 3);
    assert.ok(p.askingPrice >= 5500 && p.askingPrice % 500 === 0);
  }
  assert.equal(new Set(e.market.map((p) => p.id)).size, e.market.length, 'ids stay unique');
  assert.equal(new Set(e.market.map((p) => p.name)).size, e.market.length, 'names stay unique');
  assert.ok(e.log.some((l) => /market/i.test(l.text) && fresh.some((p) => l.text.includes(p.name))),
    'arrivals are announced in the empire feed, not silent');
});

test('the market never exceeds its cap, however long it runs', () => {
  const e = newEmpire('relaxed', 7);
  skipDays(e, 400, () => {
    assert.ok(e.market.length <= MARKET.maxListings,
      `cap ${MARKET.maxListings} held (market hit ${e.market.length})`);
  });
  assert.ok(e.market.some((p) => p.listedDay > 0), 'the market genuinely turned over new stock');
  assert.ok(e.market.length >= 2, `a long-running market stays stocked: ${e.market.length}`);
});

test('generated listings are real, buildable courses with the launch-roster rigor', () => {
  const takenNames = ['Willow Creek Municipal'];
  const takenIds = ['willow-creek'];
  const zoneChecksums = new Map();
  for (const seed of [11, 2222, 333333, 4444444, 55555555, 654321]) {
    const p = generateListing(seed, { takenNames, takenIds });
    takenNames.push(p.name);
    takenIds.push(p.id);

    assert.ok(typeof p.id === 'string' && p.id.length > 0, 'id');
    assert.ok(typeof p.name === 'string' && p.name.length > 3, 'name');
    assert.ok(typeof p.blurb === 'string' && p.blurb.length > 20, 'flavor text');
    assert.ok(p.size === 9 || p.size === 18, `size 9 or 18, got ${p.size}`);
    assert.ok(p.condition > 0 && p.condition < 100, `condition ${p.condition}`);
    assert.ok(p.askingPrice >= 5500 && p.askingPrice % 500 === 0, `ask ${p.askingPrice}`);
    assert.ok(p.trueValue > 5000, `true value ${p.trueValue}`);
    assert.ok(Number.isInteger(p.seed), 'per-property build seed');
    assert.ok(p.startingMembers >= 0 && p.startingReputation > 0);

    const course = buildPropertyCourse(p);
    assert.equal(course.holes.length, p.size, `${p.name}: ${course.holes.length}/${p.size} holes`);
    for (const hole of course.holes) {
      const v = validateHole(course, hole);
      assert.ok(v.valid, `${p.name} hole ${hole.id}: ${v.reasons.join(' ')}`);
      assert.equal(hole.status, HOLE_STATUS.OPEN);
    }
    const design = courseDesignRating(course);
    assert.ok(Math.abs(design - p.design) < 0.5, `${p.name}: listed design ${p.design} vs built ${design}`);
    const yd = course.holes.reduce((a, h) => a + holeDistanceYd(h), 0);
    if (p.size === 9) assert.ok(yd >= 1500 && yd <= 3800, `${p.name}: 9-hole yardage ${Math.round(yd)}`);
    else assert.ok(yd >= 3800 && yd <= 7400, `${p.name}: 18-hole yardage ${Math.round(yd)}`);
    let fairway = 0;
    for (const z of course.zones) if (z === 2) fairway++;
    assert.ok(fairway > 150 * (p.size / 9), `${p.name}: only ${fairway} fairway cells`);
    assert.ok(course.structures.length >= 1, `${p.name}: clubhouse exists`);
    const checksum = course.zones.reduce((a, z, i) => (a + z * (i + 1)) % 2147483647, 0);
    for (const [otherName, other] of zoneChecksums) {
      assert.notEqual(checksum, other, `${p.name} and ${otherName} share an identical layout`);
    }
    zoneChecksums.set(p.name, checksum);
  }
  // deterministic per seed
  assert.deepEqual(
    generateListing(2222, { takenNames: [], takenIds: [] }),
    generateListing(2222, { takenNames: [], takenIds: [] }),
  );
});

test('the generator keeps producing genuinely different properties over a long run', () => {
  const takenNames = [];
  const takenIds = [];
  const listings = [];
  for (let k = 0; k < 24; k++) {
    const p = generateListing(1000 + k * 7919, { takenNames, takenIds });
    takenNames.push(p.name);
    takenIds.push(p.id);
    listings.push(p);
    const course = buildPropertyCourse(p);
    for (const hole of course.holes) {
      assert.ok(validateHole(course, hole).valid, `${p.name} hole ${hole.id} valid`);
    }
  }
  assert.equal(new Set(takenNames).size, 24, 'name collisions are retried away');
  assert.equal(new Set(takenIds).size, 24, 'ids never collide');
  const designs = listings.map((p) => p.design);
  const conditions = listings.map((p) => p.condition);
  assert.ok(Math.max(...designs) - Math.min(...designs) >= 18,
    `long-run design spread stays wide: ${Math.min(...designs)}..${Math.max(...designs)}`);
  assert.ok(Math.max(...conditions) - Math.min(...conditions) >= 25,
    `long-run condition spread stays wide: ${Math.min(...conditions)}..${Math.max(...conditions)}`);
  assert.ok(listings.some((p) => p.size === 18), 'the occasional 18-holer still appears');
  assert.ok(listings.filter((p) => p.size === 9).length >= 16, 'nines stay the norm');
  assert.ok(listings.some((p) => p.askingPrice < p.trueValue * 0.92), 'bargains keep coming');
  assert.ok(listings.some((p) => p.askingPrice > p.trueValue * 1.08), 'traps keep coming');
});

test('a lived-in month grows the market through the real empire update loop', () => {
  const e = newEmpire('relaxed', 4242);
  e.cash = 10_000_000;
  buyProperty(e, 'willow-creek');
  for (let d = 0; d < 45; d++) empireUpdate(e, MINUTES_PER_DAY);
  assert.ok(e.lastMarketDay >= 44, `the market clock kept up with the world (day ${e.lastMarketDay})`);
  assert.ok(e.market.some((p) => p.listedDay > 0), 'a new listing arrived while running the club');
});

// --- Task 2: listings that don't last forever ----------------------------------------

test('a listing is safe from rivals during its minimum time on market', () => {
  assert.ok(MARKET.minDaysListed >= 6, `a real grace window exists (${MARKET.minDaysListed}d)`);
  const meanTenure = MARKET.minDaysListed + 1 / MARKET.rivalDailyChance;
  assert.ok(meanTenure >= 14 && meanTenure <= 45,
    `expected time on market is urgent but not unfair (~${meanTenure.toFixed(0)}d)`);
  const e = newEmpire('relaxed', 4242);
  const originalIds = e.market.map((p) => p.id);
  skipDays(e, MARKET.minDaysListed - 1);
  for (const id of originalIds) {
    assert.ok(e.market.some((p) => p.id === id), `${id} untouchable inside the grace window`);
  }
});

test('ignored listings go to rival buyers within a reasonable window, never silently', () => {
  const e = newEmpire('relaxed', 777);
  let prev = e.market.map((p) => ({ id: p.id, name: p.name, listedDay: p.listedDay }));
  const removals = [];
  const notices = new Set();
  skipDays(e, 250, (em) => {
    const ids = new Set(em.market.map((p) => p.id));
    for (const p of prev) {
      if (!ids.has(p.id)) removals.push({ ...p, day: em.lastMarketDay });
    }
    prev = em.market.map((p) => ({ id: p.id, name: p.name, listedDay: p.listedDay }));
    for (const l of em.log) {
      if (l.kind === 'rival') notices.add(l.text);
    }
  });

  assert.ok(removals.length >= 8,
    `250 ignored days see real turnover: ${removals.length} rival buys`);
  for (const r of removals) {
    const age = r.day - r.listedDay;
    assert.ok(age >= MARKET.minDaysListed,
      `${r.name} went to a rival after ${age} days — never inside the grace window`);
    assert.ok([...notices].some((t) => t.includes(r.name)),
      `${r.name} left with a visible notice, not a silent disappearance`);
  }
  const ages = removals.map((r) => r.day - r.listedDay);
  const avgAge = ages.reduce((a, b) => a + b, 0) / ages.length;
  assert.ok(avgAge >= MARKET.minDaysListed && avgAge <= MARKET.minDaysListed + 45,
    `typical tenure lands in the tuned window (avg ${avgAge.toFixed(1)}d)`);
  assert.ok(e.log.length <= 30, 'the feed stays bounded');
});

test('the living market survives save/load, and pre-living-market saves still open', () => {
  const e = newEmpire('relaxed', 99);
  skipDays(e, 30);
  const back = deserializeEmpire(serializeEmpire(e));
  assert.equal(back.lastMarketDay, e.lastMarketDay);
  assert.equal(back.marketRngState, e.marketRngState);
  assert.deepEqual(back.market, e.market, 'every listing, including listedDay stamps, round-trips');
  // and the market stream continues identically after the reload
  skipDays(e, 30);
  skipDays(back, 30);
  assert.deepEqual(back.market.map((p) => p.id), e.market.map((p) => p.id),
    'the reloaded empire replays the exact same market future');

  // a save written before the living market existed: no rng stream, no stamps
  const old = JSON.parse(serializeEmpire(newEmpire('relaxed', 5)));
  delete old.marketRngState;
  delete old.lastMarketDay;
  for (const p of old.market) delete p.listedDay;
  old.empireVersion = 1;
  const migrated = deserializeEmpire(JSON.stringify(old));
  assert.ok(Number.isFinite(migrated.marketRngState), 'migrated save grows a market rng stream');
  assert.ok(Number.isFinite(migrated.lastMarketDay), 'migrated save joins the market clock');
  assert.ok(migrated.market.every((p) => Number.isFinite(p.listedDay)),
    'migrated listings get a fair fresh listing date');
  skipDays(migrated, 30); // and the migrated market lives
  assert.ok(migrated.market.length <= MARKET.maxListings);
});
