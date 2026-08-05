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
import {
  MARKET, generateListing, buildPropertyCourse, marketConditionLabel, listingAgeLabel,
} from '../src/sim/marketplace.js';
import {
  newEmpire, buyProperty, sellProperty, empireUpdate, marketTick, holdingValue,
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
      `${r.name} went to a rival after ${age} days - never inside the grace window`);
    assert.ok([...notices].some((t) => t.includes(r.name)),
      `${r.name} left with a visible notice, not a silent disappearance`);
  }
  const ages = removals.map((r) => r.day - r.listedDay);
  const avgAge = ages.reduce((a, b) => a + b, 0) / ages.length;
  assert.ok(avgAge >= MARKET.minDaysListed && avgAge <= MARKET.minDaysListed + 45,
    `typical tenure lands in the tuned window (avg ${avgAge.toFixed(1)}d)`);
  assert.ok(e.log.length <= 30, 'the feed stays bounded');
});

// --- Task 3: market conditions (pricing drift) ----------------------------------------

test('the market mood drifts over time, slowly, inside hard bounds', () => {
  assert.ok(MARKET.conditionMin >= 0.7 && MARKET.conditionMax <= 1.3 && MARKET.conditionMin < MARKET.conditionMax,
    'the cycle is a modifier, not an economy');
  const e = newEmpire('relaxed', 4242);
  let lo = Infinity;
  let hi = -Infinity;
  let prev = e.marketCondition;
  let maxDailyStep = 0;
  skipDays(e, 600, (em) => {
    const c = em.marketCondition;
    assert.ok(Number.isFinite(c), 'market condition always defined');
    assert.ok(c >= MARKET.conditionMin - 1e-9 && c <= MARKET.conditionMax + 1e-9,
      `condition ${c} stays inside [${MARKET.conditionMin}, ${MARKET.conditionMax}]`);
    maxDailyStep = Math.max(maxDailyStep, Math.abs(c - prev));
    prev = c;
    lo = Math.min(lo, c);
    hi = Math.max(hi, c);
  });
  assert.ok(hi - lo >= 0.12, `the cycle genuinely moves over 600 days: saw ${lo.toFixed(3)}..${hi.toFixed(3)}`);
  assert.ok(maxDailyStep <= 0.03, `but never lurches: worst daily step ${maxDailyStep.toFixed(4)}`);
});

test('the same day-six listing asks more in a seller\'s market than a buyer\'s market', () => {
  // identical empires, identical market rng stream, only the mood differs — the
  // listing that appears is the same course with a different sticker
  const spawnAt = (cond) => {
    const em = newEmpire('relaxed', 31337);
    em.market = []; // dry market: the day-6 refresh roll is guaranteed
    em.marketCondition = cond;
    em.marketConditionTarget = cond; // lerp pulls toward itself; only shared noise moves it
    skipDays(em, 6);
    assert.equal(em.market.length, 1, 'exactly one listing spawned');
    return em.market[0];
  };
  const cheap = spawnAt(MARKET.conditionMin);
  const dear = spawnAt(MARKET.conditionMax);
  assert.equal(cheap.name, dear.name, 'same rng stream, same course');
  assert.equal(cheap.trueValue, dear.trueValue, 'the mood moves the ASK, never the intrinsic value');
  assert.ok(dear.askingPrice > cheap.askingPrice,
    `seller's market asks more: ${cheap.askingPrice} vs ${dear.askingPrice}`);
  const ratio = dear.askingPrice / cheap.askingPrice;
  assert.ok(ratio > 1.15 && ratio < 1.55, `the full swing is felt but bounded (×${ratio.toFixed(2)})`);
});

test('owned properties are priced on their own merits, not the market mood', () => {
  const e = newEmpire('relaxed', 42);
  e.cash = 10_000_000;
  buyProperty(e, 'willow-creek'); // active
  buyProperty(e, 'bent-pines'); // parked from birth
  const willow = e.holdings.find((h) => h.property.id === 'willow-creek');
  const bent = e.holdings.find((h) => h.property.id === 'bent-pines');

  e.marketCondition = MARKET.conditionMin;
  const activeLow = holdingValue(e, willow);
  const parkedLow = holdingValue(e, bent);
  e.marketCondition = MARKET.conditionMax;
  assert.equal(holdingValue(e, willow), activeLow, 'active club appraisal ignores the cycle');
  assert.equal(holdingValue(e, bent), parkedLow, 'parked club appraisal ignores the cycle');

  const res = sellProperty(e, 'bent-pines');
  assert.equal(res.payout, parkedLow, 'the sale check is the displayed number, whatever the mood');
});

// --- Task 4: what the screens say -------------------------------------------------------

test('the market-condition indicator reads one honest status, no numbers required', () => {
  assert.equal(marketConditionLabel(MARKET.conditionMin).key, 'buyers');
  assert.equal(marketConditionLabel(0.96).key, 'buyers', 'soft edge reads as a buyer\'s market');
  assert.equal(marketConditionLabel(1).key, 'balanced');
  assert.equal(marketConditionLabel(1.04).key, 'sellers', 'rich edge reads as a seller\'s market');
  assert.equal(marketConditionLabel(MARKET.conditionMax).key, 'sellers');
  for (const c of [0.85, 0.95, 1, 1.05, 1.15]) {
    const m = marketConditionLabel(c);
    assert.ok(m.label.length > 3 && m.hint.length > 10, 'label and hint are real words');
  }
});

test('time-on-market reads as relative urgency, not a countdown', () => {
  assert.equal(listingAgeLabel(0), listingAgeLabel(1), 'fresh is fresh');
  assert.ok(/just listed/i.test(listingAgeLabel(0)));
  assert.ok(!/\d/.test(listingAgeLabel(35)), 'no precise numbers to min-max against');
  const fresh = listingAgeLabel(0);
  const mid = listingAgeLabel(MARKET.minDaysListed - 2);
  const old = listingAgeLabel(MARKET.minDaysListed + 5);
  assert.notEqual(fresh, mid, 'age genuinely shows');
  assert.notEqual(mid, old, 'and keeps showing');
  assert.ok(/rival|circling|sitting/i.test(old), 'past the grace window the urgency is explicit');
  assert.equal(listingAgeLabel(MARKET.minDaysListed - 1), mid,
    'the rivals-circling copy only appears once rivals genuinely can circle');
});

test('the living market survives save/load, and pre-living-market saves still open', () => {
  const e = newEmpire('relaxed', 99);
  skipDays(e, 30);
  const back = deserializeEmpire(serializeEmpire(e));
  assert.equal(back.lastMarketDay, e.lastMarketDay);
  assert.equal(back.marketRngState, e.marketRngState);
  assert.equal(back.marketCondition, e.marketCondition, 'the market mood round-trips');
  assert.equal(back.marketConditionTarget, e.marketConditionTarget);
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
  delete old.marketCondition;
  delete old.marketConditionTarget;
  for (const p of old.market) delete p.listedDay;
  old.empireVersion = 1;
  const migrated = deserializeEmpire(JSON.stringify(old));
  assert.ok(Number.isFinite(migrated.marketRngState), 'migrated save grows a market rng stream');
  assert.ok(Number.isFinite(migrated.lastMarketDay), 'migrated save joins the market clock');
  assert.ok(Number.isFinite(migrated.marketCondition)
    && migrated.marketCondition >= MARKET.conditionMin && migrated.marketCondition <= MARKET.conditionMax,
    'migrated save joins the pricing cycle at a sane mood');
  assert.ok(migrated.market.every((p) => Number.isFinite(p.listedDay)),
    'migrated listings get a fair fresh listing date');
  skipDays(migrated, 30); // and the migrated market lives
  assert.ok(migrated.market.length <= MARKET.maxListings);
});
