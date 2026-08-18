// A STOP NOBODY MAY STAND ON MUST NEVER BE ISSUED.
//
// The nav rebuild ended with the recovery ladder still switched on and the
// reason written into clubhouse.js: "the solver is not right yet — not because
// it lets people touch, but because 'reachable stop' is not yet its problem.
// The fix is stop geometry." 354 escalations in five minutes, almost all of
// them one walker grinding at a browse point inside a neighbour's collider.
//
// tools/qa/stop-geometry-audit.mjs measures the shipped layout and still finds
// two: shelf_balls' browse point sits 0.107 yd from the back counter (a body
// needs 0.3) and tour_vault's sits 0.677 yd from queue slot 5 (two standing
// bodies need 0.92 between centres). This is the runtime half — the validator
// that refuses them at ASSIGNMENT time, before a walker has spent seconds
// failing to reach one.
import test from 'node:test';
import assert from 'node:assert/strict';

import { legalStopPoint, stopPointIsLegal } from '../src/sim/layout.js';
import { newGame } from '../src/sim/state.js';

const state = newGame({ seed: 4242 });

// DO NOT GUESS WHICH POINTS ARE SOLID. The first cut of this test hard-coded
// two coordinates and got both backwards — (0.6, -0.2) is inside a fixture on
// the default layout and the front desk's own centre is open floor there. Ask
// the geometry which is which, and fail loudly if the room contains no example
// of either, because then the test is measuring nothing.
function sample() {
  const open = [];
  const solid = [];
  for (let x = -8; x <= 8; x += 0.5) {
    for (let z = -6; z <= 6; z += 0.5) {
      (stopPointIsLegal(state, { x, z }) ? open : solid).push({ x, z });
    }
  }
  return { open, solid };
}
const { open: OPEN, solid: SOLID } = sample();

test('the room contains both standable floor and solid obstacles', () => {
  assert.ok(OPEN.length > 20, `only ${OPEN.length} standable points — nothing to validate against`);
  assert.ok(SOLID.length > 5, `only ${SOLID.length} solid points — the collider set is not loaded`);
});

test('a stop on open floor is returned untouched', () => {
  for (const point of OPEN.slice(0, 12)) {
    const legal = legalStopPoint(state, point);
    assert.ok(legal, `open floor at ${JSON.stringify(point)} must resolve`);
    assert.equal(legal.moved, 0, 'an already-legal stop must not be moved at all');
    assert.equal(legal.x, point.x);
    assert.equal(legal.z, point.z);
  }
});

test('a stop inside solid geometry is nudged to the nearest standable point', () => {
  let nudged = 0;
  let refused = 0;
  for (const point of SOLID) {
    const legal = legalStopPoint(state, point);
    if (!legal) { refused += 1; continue; }
    nudged += 1;
    assert.ok(legal.moved > 0, `${JSON.stringify(point)} was solid; it has to have moved`);
    assert.ok(legal.moved <= 1.2, `moved ${legal.moved} yd — past the cap this is a different stop`);
    assert.equal(stopPointIsLegal(state, legal), true,
      `the point it chose for ${JSON.stringify(point)} must itself be standable`);
  }
  // Deep inside a wall there may be no legal point within the cap, and refusing
  // is the correct answer there — but most solids in a shop have floor beside
  // them, so a validator that refuses everything is broken.
  assert.ok(nudged > refused,
    `nudged ${nudged}, refused ${refused} — a validator that mostly refuses is not doing its job`);
});

test('a stop with no legal point anywhere near it is REFUSED, not faked', () => {
  // Far outside the room. A validator that always returns something would hand
  // the walker a stop in the car park and call it success.
  assert.equal(legalStopPoint(state, { x: 400, z: 400 }), null,
    'no legal point within the search cap must return null so the caller picks another stop');
});

test('bad input is refused rather than turned into a stop at the origin', () => {
  for (const bad of [null, undefined, {}, { x: 1 }, { x: NaN, z: 0 }]) {
    assert.equal(legalStopPoint(state, bad), null, `${JSON.stringify(bad)} must not resolve`);
    assert.equal(stopPointIsLegal(state, bad), false);
  }
});
