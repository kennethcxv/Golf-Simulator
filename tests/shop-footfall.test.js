// A7 — HOW BUSY THE SHOP GETS (2026-08-03).
//
// Playtest: "concurrency is pinned near one. Scale it with how the shop is
// doing." It was already scaled — by yesterday's unit sales — and that is the
// defect rather than the fix. Units sold is an OUTPUT of footfall, so using it
// as the input closes a loop on itself: few customers sell few units, few units
// bring few customers, and nothing the player does breaks out. The default of 2
// units resolved to exactly one shopper.
//
// The replacement is reputation (three quarters) and cleanliness (one quarter)
// against the tier's capacity. Reputation is an INTEGRAL of past trade rather
// than a mirror of it, so it cannot lock; cleanliness is the term the player can
// move today with a broom.
//
// Measured live at 1x in tools/qa/shop-footfall.js: at the starter tier's
// capacity of 2, a failing shop (rep 25, condition 0) held a mean of 0.92
// shoppers and a thriving one (rep 85, condition 47) held 1.96, with the floor
// draining to zero when the sign was flipped closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  SHOP_FOOTFALL, shopFootfallDrive, shopFootfallTarget, footfallDriveFrom,
} from '../src/sim/shopFootfall.js';
import { newGame } from '../src/sim/state.js';
import { seedReputation } from '../src/sim/reputation.js';
import { clubRatings, amenityScore, fairGreenFee } from '../src/sim/club.js';

// ITEM 15 (2026-08-06): the fixture now controls the COURSE too. Rating and
// price joined the drive, and newGame's default course is decent — so the old
// "a big empty shop with no standing" case was quietly also "...attached to a
// well-rated course", and it drew two people rather than one. The fixture was
// not saying what the test meant. `course` is 0..1 and `feeRatio` is what the
// club charges as a multiple of the fair fee (1 = fair, >1 = dear).
function shopAt(reputation, cleanliness, { course = null, feeRatio = 1 } = {}) {
  const state = newGame('normal', 7);
  seedReputation(state, reputation);
  if (course != null && Array.isArray(state.sections)) {
    // CONDITION is the lever, not hole geometry. clubRatings is
    // 0.4*design + 0.6*condition, design comes from the course's SHAPE (a
    // fixture cannot meaningfully rough that out), and condition is exactly
    // what "neglected" means: turf health, moisture, wear. A first attempt set
    // hole.quality and hole.design, neither of which exists — the fixture
    // moved nothing and the test compared a course against itself.
    for (const section of state.sections) {
      if ('health' in section) section.health = course * 100;
      if ('wear' in section) section.wear = (1 - course) * 100;
      if ('moisture' in section) section.moisture = 40 + course * 20;
      if ('disease' in section) section.disease = 0;
    }
  }
  if (state.club) {
    const ratings = clubRatings(state);
    const fair = fairGreenFee(ratings.overall, amenityScore(state));
    state.club.greenFee = Math.max(1, fair * feeRatio);
  }
  const reno = state.shop.reno;
  if (Array.isArray(reno.grime)) reno.grime = reno.grime.map(() => 1 - cleanliness);
  if (Array.isArray(reno.windows)) reno.windows = reno.windows.map(() => 1 - cleanliness);
  if (Array.isArray(reno.clutter)) {
    reno.clutter = reno.clutter.map((item) => ({ ...item, cleared: cleanliness > 0.5 }));
  }
  return state;
}

test('a better shop draws more people, a worse one fewer', () => {
  const low = shopFootfallDrive(shopAt(25, 0));
  const mid = shopFootfallDrive(shopAt(55, 0.7));
  const high = shopFootfallDrive(shopAt(85, 1));
  assert.ok(low < mid && mid < high,
    `the drive must be monotonic in performance (${low} / ${mid} / ${high})`);
  // …and it must actually SPAN the room, not creep. A model whose whole range
  // is a rounding error is the defect this replaces, dressed differently.
  assert.ok(high - low > 0.5,
    `the range between a failing and a thriving shop is only ${(high - low).toFixed(3)}`);
});

test('the room is filled in proportion to the club, and capped by its fit-out', () => {
  const thriving = shopAt(85, 1);
  assert.equal(shopFootfallTarget(thriving, 2), 2, 'a two-person room holds two');
  assert.ok(shopFootfallTarget(thriving, 8) >= 6, 'and an eight-person room fills up');
  assert.ok(shopFootfallTarget(thriving, 8) <= 8, 'never past its own capacity');
  // A failing shop is quiet everywhere, whatever the fit-out cost.
  // no standing, filthy and dear. The COURSE is whatever newGame builds, and
  // it is a decent one - which is the point: a good course does bring some
  // people even to a badly run shop, so the floor here is 2 rather than 1.
  const failing = shopAt(25, 0, { feeRatio: 1.8 });
  const drawn = shopFootfallTarget(failing, 8);
  assert.ok(drawn <= 2,
    `a big empty shop with no standing stays near empty, got ${drawn}`);
});

test('an open shop is never completely empty of prospects, and a closed one always is', () => {
  const failing = shopAt(5, 0);
  assert.equal(shopFootfallTarget(failing, 4), 1,
    'the worst shop in the world still gets someone through the door');
  assert.equal(shopFootfallTarget(shopAt(85, 1), 8, { open: false }), 0,
    'the door sign is a gate, not a scale');
  assert.equal(shopFootfallTarget(shopAt(85, 1), 0), 0, 'a room with no capacity holds nobody');
});

test('cleanliness moves the number on its own - sweeping has to pay', () => {
  const dirty = shopFootfallDrive(shopAt(60, 0));
  const clean = shopFootfallDrive(shopAt(60, 1));
  assert.ok(clean > dirty, `cleaning at the same reputation must help (${dirty} vs ${clean})`);
  // …but it cannot carry the shop by itself, or a spotless unknown shop would
  // draw a crowd on day one.
  assert.ok(clean - dirty <= SHOP_FOOTFALL.cleanlinessShare + 1e-9,
    'cleanliness is a modifier, not the base');
});

test('the arrival loop no longer feeds footfall its own output', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse.js', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  assert.doesNotMatch(source, /salesYesterday\.units \|\| 2\) \/ 8/,
    'yesterday-units is gone from the arrival target, not merely bypassed');
  assert.match(source, /footfallTarget = shopFootfallTarget\(state, shopCustomerCapacity\(state\), \{ open: true \}\)/,
    'the shared model owns the number');
  // shopCondition() walks the grime and window arrays; solving it every frame
  // for a number that cannot change inside a game minute is waste.
  assert.match(source, /const wholeMinute = Math\.floor\(minute\);/,
    'the cache key is the WHOLE minute - the fractional one re-solved every frame');
});


// ITEM 15: the sentence the brief actually asked for, on the FORMULA.
//
// Tested pure rather than by sculpting a state: a course's condition is
// computed from turf cells, not stored on the section, so a fixture cannot
// cheaply build a neglected course. A first attempt set section.health and
// hole.quality, neither of which exists, and quietly compared a course against
// itself.
test('a good cheap course is busy and a neglected dear one is empty', () => {
  const goodCheap = footfallDriveFrom({
    reputation: 0.6, cleanliness: 0.8, rating: 0.95, priceFactor: SHOP_FOOTFALL.priceCeiling,
  });
  const neglectedDear = footfallDriveFrom({
    reputation: 0.6, cleanliness: 0.2, rating: 0.10, priceFactor: SHOP_FOOTFALL.priceFloor,
  });
  assert.ok(goodCheap > neglectedDear * 2,
    `the good cheap course must clearly out-draw the neglected dear one (${goodCheap.toFixed(3)} vs ${neglectedDear.toFixed(3)})`);
  assert.ok(goodCheap > 0.8, `a good cheap course should fill a room, drive ${goodCheap.toFixed(3)}`);
  assert.ok(neglectedDear < 0.3, `a neglected dear one should be quiet, drive ${neglectedDear.toFixed(3)}`);
});

test('each term moves the drive on its own', () => {
  const base = { reputation: 0.5, cleanliness: 0.5, rating: 0.5, priceFactor: 1 };
  const bump = (key, value) => footfallDriveFrom({ ...base, [key]: value });
  for (const key of ['reputation', 'cleanliness', 'rating']) {
    assert.ok(bump(key, 0.9) > bump(key, 0.1),
      `${key} must move the drive on its own`);
  }
  assert.ok(bump('priceFactor', SHOP_FOOTFALL.priceCeiling) > bump('priceFactor', SHOP_FOOTFALL.priceFloor),
    'undercutting must draw and gouging must repel');
});

test('price alone moves the room on a real state, at identical reputation', () => {
  const cheap = shopFootfallDrive(shopAt(60, 0.6, { feeRatio: 0.6 }));
  const fair = shopFootfallDrive(shopAt(60, 0.6, { feeRatio: 1.0 }));
  const dear = shopFootfallDrive(shopAt(60, 0.6, { feeRatio: 1.8 }));
  assert.ok(cheap > fair && fair > dear,
    `undercutting must draw and gouging must repel (${cheap} / ${fair} / ${dear})`);
});
