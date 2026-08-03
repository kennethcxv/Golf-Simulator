// THE OPEN / CLOSED SIGN (2026-08-02). The rules, held so they cannot drift:
//   - customers do not arrive until the sign reads OPEN
//   - flipping to CLOSED stops NEW arrivals; anyone inside finishes and leaves
//   - the state persists across save and reload
//   - a new day starts CLOSED, because the preparation window is the point
//   - opening late is measurable (no popup — the player learns it)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  SHOP_HOURS,
  closeSignForNewDay,
  flipSign,
  healShopSign,
  shopAcceptsWalkIns,
  signIsOpen,
  withinTradingHours,
} from '../src/sim/shopSign.js';
import { newGame } from '../src/sim/state.js';
import { DOOR_MAIN, INTERIOR } from '../src/data/shopLayout.js';
import { shopSignLocalPoint } from '../src/data/shopSignPlacement.js';

const clubhouseSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

test('a fresh shop opens CLOSED — the morning is the player\'s to prepare', () => {
  const state = newGame('normal', 11);
  assert.equal(signIsOpen(state), false);
  // …and mid-morning, inside trading hours, still nobody comes in
  assert.equal(withinTradingHours(600), true, 'ten in the morning is trading hours');
  assert.equal(shopAcceptsWalkIns(state, 600), false,
    'trading hours alone must not open the shop');
});

test('flipping the sign is what lets customers in', () => {
  const state = newGame('normal', 12);
  const flipped = flipSign(state, 600);
  assert.equal(flipped.ok, true);
  assert.equal(flipped.open, true);
  assert.equal(shopAcceptsWalkIns(state, 600), true);
  // and flipping back stops NEW arrivals
  flipSign(state, 700);
  assert.equal(signIsOpen(state), false);
  assert.equal(shopAcceptsWalkIns(state, 700), false);
});

test('the sign cannot conjure customers outside trading hours', () => {
  const state = newGame('normal', 13);
  const flipped = flipSign(state, 180); // 3 AM
  assert.equal(flipped.open, true, 'the player may still flip it');
  assert.equal(flipped.withinHours, false, 'and the caller can say so');
  assert.equal(shopAcceptsWalkIns(state, 180), false,
    'but the world keeps its own hours — the sign gates within them, it does not extend them');
});

test('opening late is measured, not announced', () => {
  const state = newGame('normal', 14);
  const late = flipSign(state, SHOP_HOURS.openMinute + 95);
  assert.equal(late.minutesLate, 95,
    'the cost of a late open has to be computable; the player is never warned about it');
  assert.equal(state.shop.signOpenedAtMinute, SHOP_HOURS.openMinute + 95);
});

test('a new day starts CLOSED — the preparation window survives the rollover', () => {
  const state = newGame('normal', 15);
  flipSign(state, 600);
  assert.equal(signIsOpen(state), true);
  closeSignForNewDay(state);
  assert.equal(signIsOpen(state), false);
  assert.equal(state.shop.signOpenedAtMinute, null);
});

test('the sign survives save and reload', () => {
  const state = newGame('normal', 16);
  flipSign(state, 640);
  const round = JSON.parse(JSON.stringify(state));
  assert.equal(signIsOpen(round), true, 'an open sign reloads open');
  flipSign(state, 900);
  const closedRound = JSON.parse(JSON.stringify(state));
  assert.equal(signIsOpen(closedRound), false, 'a closed sign reloads closed');
});

test('a save written before the sign existed still trades', () => {
  const state = newGame('normal', 17);
  delete state.shop.signOpen;          // as an older save would deserialize
  delete state.shop.signOpenedAtMinute;
  assert.equal(healShopSign(state), true, 'the healer fires exactly once');
  assert.equal(signIsOpen(state), true,
    'heal to what that player last experienced — an always-open shop — not the new default');
  assert.equal(healShopSign(state), false, 'and never again');
});

test('the customer loop asks the sign, not only the clock', () => {
  // The gate has to be the shared helper: a second hand-rolled hours check
  // would silently ignore the sign.
  assert.match(clubhouseSource, /const open = shopAcceptsWalkIns\(state, minute\)/,
    'updateCustomers gates arrivals on the sign');
  assert.doesNotMatch(clubhouseSource, /const open = minute >= 360 && minute <= 1200/,
    'the old clock-only gate is gone, not merely bypassed');
});

// A2 — "THE SIGN DOES NOT VISUALLY FLIP, AND IT SHIPPED WITH A PASSING TEST."
//
// The test below asserted the animation source, and the animation source was
// correct: tickSpin is ticked, the E verb animates, the easing is there. What
// nothing checked was WHERE the card is. The renderer built a WORLD point with
// L2W() and assigned it as the group's INTERIOR-LOCAL position, so the building
// offset landed twice and the painted card hung 360 yards outside the building
// — while the E hotspot, which took the world point correctly, stayed on the
// jamb. The player pressed E on an invisible hotspot, got the toast and the
// trading gate, and never saw a card turn, because there was no card to see.
//
// So the placement is a named point now, and these check it. The turn ITSELF is
// measured in tools/qa/shop-sign-turn.js, which samples the card's world
// bearing every animation frame across a real E press: 75 distinct bearings
// over a π-radian sweep on 2026-08-03, against 1 while idle. A source regex
// cannot tell a rendered swing from a dead one; that driver can.

test('the sign hangs inside the room, where a player standing in it can read it', () => {
  const point = shopSignLocalPoint(DOOR_MAIN, INTERIOR.d);
  // inside the envelope on both axes — this is the assertion that was missing
  assert.ok(Math.abs(point.x) < INTERIOR.w / 2,
    `sign x ${point.x} is outside the ${INTERIOR.w} yd room`);
  assert.ok(point.z > 0 && point.z < INTERIOR.d / 2,
    `sign z ${point.z} is not between the room centre and the south wall face`);
  // …and proud of that wall face rather than buried in it
  assert.ok(INTERIOR.d / 2 - point.z >= 0.05,
    'the card must stand off the wall, not sit inside it');
  // eye height for someone standing on the floor, measured FROM the floor
  assert.ok(point.y > 1.3 && point.y < 1.8,
    `sign y ${point.y} is not at reading height above the interior floor`);
  // and beside the doorway, not across it
  assert.ok(point.x > DOOR_MAIN.x + DOOR_MAIN.w / 2,
    'the card must clear the door aperture');
});

test('the card and the hotspot that flips it are the same point in two frames', () => {
  // The card is a child of `interior` so it takes the LOCAL point; the walk prop
  // is matched against world walk.x/z so it takes that point through L2W. Two
  // sources for one position is exactly how they ended up 360 yards apart.
  assert.match(clubhouseSource,
    /const signLocal = shopSignLocalPoint\(DOOR_MAIN, INTERIOR\.d\);/,
    'one datum for the sign position');
  assert.match(clubhouseSource,
    /const hang = L2W\(signLocal\.x, signLocal\.z\);/,
    'the world form is derived from it, not computed separately');
  assert.match(clubhouseSource,
    /group\.position\.set\(signLocal\.x, signLocal\.y, signLocal\.z\);/,
    'the card takes the local point — passing it a world point offsets it twice');
  assert.match(clubhouseSource, /addProp\(\{\s*\n\s*x: hang\.x,\s*\n\s*z: hang\.z,/,
    'and the hotspot takes the world form of that same point');
});

test('the sign is a physical prop with an E verb, not a menu toggle', () => {
  assert.match(clubhouseSource, /ClubhouseOpenClosedSign/, 'it exists in the world');
  assert.match(clubhouseSource, /label: \(\) => \(signIsOpen\(state\)/,
    'it reads its state live so the prompt cannot go stale');
  assert.match(clubhouseSource, /action: \(\) => \{\s*\n\s*const result = flipSign\(/,
    'E flips the shared sim verb');
  // The two faces are painted on one card; flipping is a turn, not a swap, and
  // the yaw is still derived from the state rather than tracked separately.
  assert.match(clubhouseSource, /const want = signIsOpen\(state\) \? Math\.PI : 0;/,
    'the yaw IS the state, so there is nothing to keep in sync');
  // ...and the turn is VISIBLE. Assigning the target outright teleported the
  // card through 180 degrees between two frames, so the only evidence of a flip
  // was the toast. It must ease to the target over time instead.
  assert.match(clubhouseSource, /spin\.from = group\.rotation\.y;/,
    'a flip starts from wherever the card currently is');
  assert.match(clubhouseSource, /applyFacing\(true\); \/\/ swing it, do not teleport it/,
    'the E verb animates the turn');
  assert.match(clubhouseSource, /shopSign\.tickSpin\(dt\);/,
    'and the swing is ticked from the clubhouse update, or it would never move');
});
