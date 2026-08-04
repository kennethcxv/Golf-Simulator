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
import {
  createOpenClosedSignRegistry,
  exteriorSignFace,
} from '../src/render3d/clubhouse/openClosedSigns.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const clubhouseSource = read('../src/render3d/clubhouse.js');
const shellSource = read('../src/render3d/clubhouse/shell.js');

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

// C1 — "THERE ARE TWO SIGNS AND ONLY ONE TURNS."
//
// The interior card was wired. The exterior board on the south wall —
// LegacyBusinessHoursSign, the one a customer walks past — was repainted from
// campaignAllowsBusiness(), which is a one-time campaign MILESTONE and is
// permanently true in a non-campaign game. It read "OPEN TODAY / 6 AM–8 PM"
// through every night the player had shut the shop.
//
// The tests above could not have caught that, because every one of them looks
// at the card. These look at the REGISTRY: the list of boards that a single
// signIsOpen(state) read drives. A sign that is not on that list is driven by
// nothing, and a sign that paints an OPEN/CLOSED word without joining it fails
// the source sweep below.

test('the registry drives every sign it holds from one signIsOpen read', () => {
  const registry = createOpenClosedSignRegistry();
  const painted = [];
  registry.register('CardIndoors', (facts) => painted.push(['CardIndoors', facts.open]));
  registry.register('BoardOutdoors', (facts) => painted.push(['BoardOutdoors', facts.open]));

  const state = newGame('normal', 41);
  assert.equal(signIsOpen(state), false, 'a fresh shop is CLOSED');
  assert.equal(registry.sync(state), true, 'the first sync always paints');
  assert.deepEqual(painted, [['CardIndoors', false], ['BoardOutdoors', false]],
    'BOTH signs are painted, not just the one someone remembered');

  painted.length = 0;
  assert.equal(registry.sync(state), false, 'and an unchanged fact costs nothing');
  assert.deepEqual(painted, []);

  flipSign(state, 600);
  assert.equal(registry.sync(state), true);
  assert.deepEqual(painted, [['CardIndoors', true], ['BoardOutdoors', true]],
    'flipping the card must move the board outside in the same tick');

  // THE CASE THAT SHIPPED: the midnight rollover moves signOpen with nobody
  // pressing E, and the old code only re-aimed the card on an E press.
  painted.length = 0;
  closeSignForNewDay(state);
  assert.equal(registry.sync(state), true, 'a new day is a change of fact like any other');
  assert.deepEqual(painted, [['CardIndoors', false], ['BoardOutdoors', false]]);
});

test('a sign registered late is painted with the CURRENT fact, not the built-in one', () => {
  const registry = createOpenClosedSignRegistry();
  const state = newGame('normal', 42);
  flipSign(state, 600);
  registry.sync(state);
  let seen = null;
  registry.register('ArrivedLate', (facts) => { seen = facts.open; });
  assert.equal(seen, true, 'a board built after the shop opened must not show yesterday');
});

test('the board outside answers the same question the customers do', () => {
  // shopAcceptsWalkIns() asks the card and the clock. It does not ask the
  // campaign. So neither may the board — and the greybox starter is precisely a
  // campaign profile with businessOpen false, which is how the first draft of
  // this fix reproduced the bug it was fixing.
  const openMidRestoration = exteriorSignFace({ open: true, established: false });
  assert.equal(openMidRestoration.key, 'open',
    'a card turned to OPEN puts customers in the room, so the board must say OPEN');
});

test('"we have not opened yet" and "we are shut for the night" are different boards', () => {
  // Conflating them is the actual bug: businessOpen (a campaign milestone) was
  // standing in for signIsOpen (tonight).
  const restoring = exteriorSignFace({ open: false, established: false });
  const shut = exteriorSignFace({ open: false, established: true });
  const trading = exteriorSignFace({ open: true, established: true });
  assert.equal(restoring.key, 'restoration');
  assert.equal(shut.key, 'closed');
  assert.equal(trading.key, 'open');
  assert.notDeepEqual(restoring.lines, shut.lines,
    'a shop under restoration must not read the same as a shop that shut at eight');
  assert.match(shut.lines.join(' '), /CLOSED/);
  assert.match(trading.lines.join(' '), /OPEN/);
  // …and an open board never says CLOSED, which is the thing a customer reads
  assert.doesNotMatch(trading.lines.join(' '), /CLOSED/);
});

test('no sign paints an OPEN or CLOSED word outside the registry', () => {
  // The sweep that would have caught the shipped bug. Any renderer file that
  // builds sign copy containing OPEN or CLOSED must import the registry module;
  // otherwise it is painting a state nothing drives.
  const dir = new URL('../src/render3d/', import.meta.url);
  const files = [];
  const walk = (u) => {
    for (const entry of fs.readdirSync(u, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, u);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.js')) files.push(child);
    }
  };
  walk(dir);

  // A sign's copy is an ARRAY OF LINES handed to a texture painter. Match that
  // shape, not the bare words, so a comment or a state name is not a finding.
  const signCopy = /(?:makeSignTexture|signMaterial|face)\(\s*\[[^\]]*'(?:OPEN|CLOSED)[^']*'/;
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (!signCopy.test(src)) continue;
    if (src.includes('openClosedSigns.js')) continue;      // wired
    offenders.push(file.pathname.split('/src/')[1]);
  }
  assert.deepEqual(offenders, [],
    `these files paint an OPEN/CLOSED sign without joining the registry: ${offenders.join(', ')}`);
});

test('the exterior board is registered and repainted, not left to a campaign flag', () => {
  assert.match(shellSource, /sign\.name = 'LegacyBusinessHoursSign';/,
    'the board still exists — deleting it is the other valid answer, and it was not taken');
  assert.match(shellSource, /repaintBusinessSign = \(face\) => \{/,
    'it takes a FACE; a boolean is what let a milestone stand in for tonight');
  assert.doesNotMatch(shellSource, /campaignAllowsBusiness/,
    'the shell does not decide open-ness at all any more');
  assert.match(clubhouseSource,
    /openClosedSigns\.register\(shell\.exteriorSignName, \(facts\) => \{/,
    'the clubhouse registers the board');
  assert.match(clubhouseSource, /openClosedSigns\.register\(group\.name, \(\) => applyFacing\(true\)\);/,
    'and the card');
  assert.match(clubhouseSource, /\n    syncOpenClosedSigns\(\);\n    \/\/ the door sign's flip animation/,
    'and the registry is synced every frame, so a rollover turns them both');
});
