// B4 — "FIX THE PLANT YOU LOGGED AND DID NOT FIX."
//
// The brief quotes my own note back at me: *the rig plants the tool head on the
// floor regardless of whether the handle can physically reach*, and gives the
// evidence — *"the plant number read 0.073-0.084 for every candidate in your
// sweep including one two yards below the eye."*
//
// That reading is the whole signature of the bug. A number that does not move
// when its input moves two yards is not measuring its input. The head was being
// snapped onto the boards from BELOW, drawing a shaft between a hand and a head
// that no handle connects, which is very likely why the hand read as detached.
//
// The fix shipped on 2026-08-07 as an eased authority term, and then shipped
// with NO CHECK — the rule was three lines inside a five-hundred-line frame
// solve, reachable only by booting Electron, equipping a broom and driving a
// grip-anchor override. So it was extracted to `plantAuthorityFor` and this file
// is the check it should have had.
//
// WATCHED FAILING: with the body of `plantAuthorityFor` replaced by `return 1`
// — which is exactly the unfixed rig, planting unconditionally — cases 2, 3 and
// 4 below fail, and case 5 fails with the brief's own number: every candidate
// reporting identical authority however far below the floor the hands are.

import test from 'node:test';
import assert from 'node:assert/strict';
import { plantAuthorityFor } from '../src/render3d/broomViewmodel.js';

// The shipped constants, so the cases are the game's own geometry rather than
// numbers invented for a test.
const FLOOR = 0;
const KISS = 0.012;      // feel.surface.floorKiss
const EASE = 0.12;       // the fade span, in metres of sink

test('hands above the contact plane keep full authority to plant', () => {
  // The ordinary case: you are standing up, the handle reaches, the bristles
  // belong on the boards.
  assert.equal(plantAuthorityFor(1.2, FLOOR, KISS), 1);
  assert.equal(plantAuthorityFor(0.5, FLOOR, KISS), 1);
  assert.equal(plantAuthorityFor(KISS, FLOOR, KISS), 1, 'exactly at the plane is still legal');
});

test('authority fades as the hands sink through the plane, and does not pop', () => {
  // Eased, not switched. Half a fade-span under the plane is half authority.
  const half = plantAuthorityFor(KISS - EASE / 2, FLOOR, KISS);
  assert.ok(Math.abs(half - 0.5) < 1e-9, `expected 0.5 at half a span of sink, got ${half}`);

  // Monotone across the fade, with no step at either end.
  let prev = 1;
  for (let s = 0; s <= EASE * 1.5; s += EASE / 12) {
    const a = plantAuthorityFor(KISS - s, FLOOR, KISS);
    assert.ok(a <= prev + 1e-12, `authority rose while the hands sank further (at sink ${s})`);
    prev = a;
  }
});

test('a hand below the fade span has no authority at all', () => {
  assert.equal(plantAuthorityFor(KISS - EASE, FLOOR, KISS), 0);
  assert.equal(plantAuthorityFor(-1.0, FLOOR, KISS), 0);
});

test('THE BRIEF’S COUNTER-EXAMPLE: a candidate two yards below the eye', () => {
  // "including one two yards below the eye". The eye stands 1.62 yd above the
  // boards, so two yards below it is 0.38 yd BELOW the floor — hands through the
  // floorboards, where no handle can put bristles on the boards above them.
  //
  // The unfixed rig gave this candidate the same plant as an upright one. It
  // must now have none.
  const eyeY = 1.62;
  const twoYardsBelowEye = eyeY - 2.0;
  assert.ok(twoYardsBelowEye < FLOOR, 'the case is only interesting if it is under the floor');
  assert.equal(plantAuthorityFor(twoYardsBelowEye, FLOOR, KISS), 0,
    'the candidate the brief names must not be able to plant');
});

test('the plant number VARIES with the candidate — the bug’s actual signature', () => {
  // The bug did not report a wrong number, it reported the SAME number for every
  // candidate. So the assertion is about spread, not about any single value.
  //
  // The ladder deliberately spans both regimes: the top three must agree with
  // each other (a real invariant — an upright pose plants the same whatever the
  // height), and the bottom must not agree with the top. An instrument that
  // varied everywhere would be as suspect as one that varied nowhere, so both
  // halves are asserted.
  const above = [1.5, 1.0, 0.4].map((y) => plantAuthorityFor(y, FLOOR, KISS));
  const below = [-0.05, -0.2, -0.38, -1.0].map((y) => plantAuthorityFor(y, FLOOR, KISS));

  assert.equal(new Set(above).size, 1, 'above the plane the plant should be constant');
  const spread = Math.max(...above, ...below) - Math.min(...above, ...below);
  assert.ok(spread > 0.9,
    `every candidate returned the same authority (spread ${spread.toFixed(3)}); `
    + 'this is the 0.073-0.084-for-everything reading the brief describes');
});

test('the ease span is a span, not a division by zero waiting to happen', () => {
  // Guarded because a zero ease is the natural way someone would try to make the
  // plant snap, and 1 - x/0 is not a number.
  const a = plantAuthorityFor(-0.5, FLOOR, KISS, 0);
  assert.ok(Number.isFinite(a) && a === 0, `a zero-width fade must still return 0, got ${a}`);
});
