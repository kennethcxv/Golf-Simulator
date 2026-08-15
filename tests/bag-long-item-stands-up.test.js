// E1 (Goal 20) — a long item leaves the bag by the mouth, never through a wall.
//
// The rule it replaces clamped every body into the authored interior with
// `clamp(v, -(halfX - bodyHalfX), halfX - bodyHalfX)`, whose bounds INVERT the
// moment the body is wider than the bag. A long item was therefore shoved
// sideways by its own overflow and cut through the paper on both walls at once,
// which the owner reported as worse than the mouth fault it replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bagFitPlan, bagPlacementFor } from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

// the authored shopping bag's interior, in its own local units
const INTERIOR = { halfX: 0.125, halfMouth: 0.126, halfDepth: 0.07 };
const CENTRE_Y = 0.14;

// how far the body pokes past each interior face, per axis
function overflow(plan, place) {
  return {
    x: Math.max(0, Math.abs(place.x) + plan.half.x - INTERIOR.halfX),
    z: Math.max(0, Math.abs(place.z) + plan.half.z - INTERIOR.halfDepth),
    // the mouth is the TOP face only; below the floor is still a wall
    below: Math.max(0, (CENTRE_Y - INTERIOR.halfMouth) - (place.y - plan.half.y)),
    aboveMouth: Math.max(0, (place.y + plan.half.y) - (CENTRE_Y + INTERIOR.halfMouth)),
  };
}

test('a short item lies down and stays entirely inside', () => {
  const body = { x: 0.04, y: 0.03, z: 0.03 };
  const plan = bagFitPlan(body, INTERIOR);
  assert.equal(plan.standUp, false);
  const place = bagPlacementFor(plan, INTERIOR, { index: 0, centreY: CENTRE_Y });
  const o = overflow(plan, place);
  assert.equal(o.x, 0);
  assert.equal(o.z, 0);
  assert.equal(o.below, 0);
  assert.equal(o.aboveMouth, 0);
});

test('a long item stands up and can only overflow through the mouth', () => {
  // a club, an umbrella, a long boxed rangefinder: far longer than the bag is
  // wide, and this is the exact shape that used to exit both side walls
  const body = { x: 0.30, y: 0.03, z: 0.03 };
  const plan = bagFitPlan(body, INTERIOR);
  assert.equal(plan.standUp, true);
  assert.equal(plan.axis, 'x', 'the longest axis is the one that goes up the mouth');
  // after standing up, the long extent is the MOUTH axis
  assert.equal(plan.half.y, 0.30);
  assert.equal(plan.half.x, 0.03);

  const place = bagPlacementFor(plan, INTERIOR, { index: 0, centreY: CENTRE_Y });
  const o = overflow(plan, place);
  assert.equal(o.x, 0, 'nothing may leave through a side wall');
  assert.equal(o.z, 0, 'nothing may leave through a face');
  assert.equal(o.below, 0, 'it stands ON the interior floor, not through it');
  assert.ok(o.aboveMouth > 0, 'the length has to go somewhere, and the mouth is where');
});

test('the old rule is what produced the two-wall exit', () => {
  // The clamp as it was written, reproduced exactly. This is the arithmetic,
  // not a paraphrase: with bodyHalfX > halfX the bounds cross over.
  const bodyHalfX = 0.30;
  const lo = -(INTERIOR.halfX - bodyHalfX); // +0.175
  const hi = INTERIOR.halfX - bodyHalfX; //   -0.175
  assert.ok(lo > hi, 'the bounds invert, which is the whole defect');
  const clamped = Math.max(lo, Math.min(hi, -0.055));
  assert.equal(clamped, 0.175);
  // the body then straddles both walls
  const left = clamped - bodyHalfX; // -0.125
  const right = clamped + bodyHalfX; // +0.475
  assert.ok(left <= -INTERIOR.halfX, 'through the left wall');
  assert.ok(right >= INTERIOR.halfX, 'and out through the right');
});

test('stacking still works, and no lying item is ever pushed through a wall', () => {
  const body = { x: 0.05, y: 0.035, z: 0.04 };
  const plan = bagFitPlan(body, INTERIOR);
  const seen = [];
  for (let index = 0; index < 6; index += 1) {
    const place = bagPlacementFor(plan, INTERIOR, { index, centreY: CENTRE_Y });
    const o = overflow(plan, place);
    assert.equal(o.x, 0, `item ${index} left through a side`);
    assert.equal(o.below, 0, `item ${index} sank through the floor`);
    seen.push(place);
  }
  // two columns, and the stack climbs
  assert.ok(seen[0].x < 0 && seen[1].x > 0, 'two columns');
  assert.ok(seen[2].y > seen[0].y, 'the second layer sits above the first');
});

test('a body too wide to lie down but not long enough to matter still stands', () => {
  // wide and flat: it does not fit lying, so it must not be clamped sideways
  const body = { x: 0.20, y: 0.02, z: 0.05 };
  const plan = bagFitPlan(body, INTERIOR);
  assert.equal(plan.standUp, true);
  const place = bagPlacementFor(plan, INTERIOR, { index: 3, centreY: CENTRE_Y });
  assert.equal(overflow(plan, place).x, 0);
  assert.equal(place.x, 0, 'a stood-up body is centred across the width');
});
