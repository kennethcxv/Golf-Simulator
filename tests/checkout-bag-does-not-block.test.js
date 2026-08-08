// G6 — THE BAG MUST NOT BLOCK THE CUSTOMER OR THEIR CASH.
//
// "The bag blocks them. Move the customer's stand point and their cash placement
// right so neither sits behind it."
//
// VERIFIED RATHER THAN REBUILT, and the answer is that both halves already hold:
//
//   bag            desk-local x = -1.16
//   stand point    desk-local x = -0.10   (1.06 yd to its right)
//   customer cash  desk-local x = -0.38   (0.78 yd to its right)
//
// The stand point cannot go further right and the reason is recorded in
// shopLayout.js: pushing it to +0.06 was tried and `checkout-space.test.js`
// failed it immediately - "bagging is 1.55 yd away at its far corner". The bag
// lies at the counter's far left and the player has to reach into its mouth, so
// 0.16 yd is the whole of the margin. That is a real constraint, not a decision
// to be revisited, and this file records it as an upper bound so the next
// attempt does not spend an afternoon rediscovering it.
//
// What this pins is the DIRECTION. Both anchors must stay clear to the right of
// the carrier. A later layout change that slides either back behind the bag
// re-creates exactly the complaint, and nothing else in the suite would notice:
// the space test guards the player's REACH, not the customer's visibility.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const layout = fs.readFileSync(new URL('../src/data/shopLayout.js', import.meta.url), 'utf8');

// desk-local x of an authored pose, read from the source that defines it
function localX(pattern, label) {
  const m = pattern.exec(layout);
  assert.ok(m, `${label} is still authored in shopLayout`);
  return Number(m[1]);
}

const BAG_X = () => localX(/\bbag: frontDeskPose\((-?[\d.]+)/, 'the bag');
const STAND_X = () => localX(/const staffDatum = frontDeskPoint\((-?[\d.]+)/, 'the stand point');
const CASH_X = () => localX(/customerTender: \{ \.\.\.frontDeskPoint\((-?[\d.]+)/, 'the customer tender');

test('the three anchors are all still authored where this test can read them', () => {
  // Control: if any of these silently stopped matching, every assertion below
  // would be reading a number that is not on screen.
  assert.equal(typeof BAG_X(), 'number');
  assert.equal(typeof STAND_X(), 'number');
  assert.equal(typeof CASH_X(), 'number');
  assert.ok(BAG_X() < -0.9, 'the bag is still at the far left of the counter');
});

test('the customer stands clear to the right of the bag', () => {
  const gap = STAND_X() - BAG_X();
  assert.ok(gap > 0.8,
    `the stand point must sit right of the carrier, gap is ${gap.toFixed(2)} yd`);
});

test('the customer cash is laid clear to the right of the bag', () => {
  // The tender is a footprint, not a point: its LEFT edge is what could slide
  // behind the carrier, so the width comes off the gap.
  const w = localX(/customerTender: \{[^}]*w: ([\d.]+)/, 'the tender footprint');
  const leftEdge = CASH_X() - w / 2;
  const gap = leftEdge - BAG_X();
  assert.ok(gap > 0.4,
    `the cash must not be laid behind the carrier, left edge clears it by ${gap.toFixed(2)} yd`);
});

test('the stand point stays inside the reach margin that blocked moving it further', () => {
  // The upper bound is the finding, not a preference. +0.06 was tried and failed
  // the space test; -0.10 is what fits. Anything past that is known-broken and
  // should fail here rather than in a driver an hour later.
  assert.ok(STAND_X() <= 0.0,
    'moving the stand right of 0.0 puts bagging out of the player reach margin');
});
