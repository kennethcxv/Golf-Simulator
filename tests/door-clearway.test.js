// DOOR_CLEARWAY must stay empty. This is the third time an object has been
// found standing in a rect whose entire reason for existing is that nothing
// stands in it, so the rule gets a test instead of another comment.
//
// What actually went wrong, measured 2026-07-29 by
// tools/qa/proshop-door-clearway-audit.js: three systems refuse to PLACE things
// in a clearway (layout.js, propertyPlacement.js, boxPlacement.js) and none of
// them police the start-state seeder. shop.js jitters every authored clutter
// spot by ±0.4 x / ±0.3 z, buildClutterPile gives each pile a 0.9 × 0.9
// collider, and an authored spot chosen to sit just clear of the rect is one
// coin-flip from sitting just inside it. Two piles and the basket station were
// in the entrance; the v2 room had three obstructions.
//
// The tests below cover the jitter EXHAUSTIVELY rather than by sampling seeds:
// a random-seed test that passes is only evidence about the seeds it drew.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOOR_CLEARWAY,
  BACKDOOR_CLEARWAY,
  CLEARWAYS,
  CLUTTER_SPOTS,
  PINE_HILLS_V2_LAYOUT,
  PINE_HILLS_BASKET_STATION,
  PINE_HILLS_V2_BASKET_STATION,
  MAT,
  HOURS_SIGN,
  STOCK_LANE_CLEARWAY,
  STOCKROOM,
  PLAYER_DIAM,
  clampOutOfClearways,
} from '../src/data/shopLayout.js';
import { CLUTTER_PILE_FOOTPRINT, seedClutterPile } from '../src/sim/shop.js';

const JITTER_X = 0.4; // shop.js seedClutterPile
const JITTER_Z = 0.3;

const boxAt = (x, z, w, d) => ({
  minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2,
});
const overlaps = (a, b) => a.maxX > b.minX && a.minX < b.maxX && a.maxZ > b.minZ && a.minZ < b.maxZ;
const inAnyClearway = (box) => CLEARWAYS.some((r) => overlaps(box, r));

test('the clearways are the ones every consumer protects', () => {
  // Three now. The stock-door lane joined on 2026-07-29 (TILL-REACH-001): the
  // first two protect a DOORWAY, this one protects a ROUTE, and the reason is
  // the same — three rooms were sealed by furniture standing in it.
  assert.deepEqual(CLEARWAYS, [DOOR_CLEARWAY, BACKDOOR_CLEARWAY, STOCK_LANE_CLEARWAY]);
});

// The exhaustive one. Every authored spot, every corner and edge of its jitter
// box, both rooms — after clamping, none of it may touch a clearway.
test('no clutter pile can be jittered into a doorway, in either room', () => {
  const spotSets = {
    'pine-hills': CLUTTER_SPOTS,
    'pine-hills-v2': PINE_HILLS_V2_LAYOUT.clutterSpots,
  };
  const steps = 9; // corners, edges, centre and the points between
  for (const [room, spots] of Object.entries(spotSets)) {
    for (const spot of spots) {
      for (let i = 0; i < steps; i += 1) {
        for (let j = 0; j < steps; j += 1) {
          const dx = -JITTER_X + (2 * JITTER_X * i) / (steps - 1);
          const dz = -JITTER_Z + (2 * JITTER_Z * j) / (steps - 1);
          const clear = clampOutOfClearways(
            spot.x + dx, spot.z + dz, CLUTTER_PILE_FOOTPRINT, CLUTTER_PILE_FOOTPRINT,
          );
          const box = boxAt(clear.x, clear.z, CLUTTER_PILE_FOOTPRINT, CLUTTER_PILE_FOOTPRINT);
          assert.equal(
            inAnyClearway(box), false,
            `${room} pile authored at (${spot.x}, ${spot.z}) jittered by (${dx.toFixed(2)}, `
            + `${dz.toFixed(2)}) lands in a clearway at (${clear.x.toFixed(2)}, ${clear.z.toFixed(2)})`,
          );
        }
      }
    }
  }
});

test('the rounding the seeder applies cannot put a pile back in', () => {
  // seedClutterPile rounds to 2dp AFTER clamping, and the clamp only clears by
  // 0.01 — so the rounding is the last thing standing between the clamp and a
  // blocked door. A deterministic rng that always asks for the worst jitter.
  const worst = { range: (lo, hi) => (Math.abs(lo) > Math.abs(hi) ? lo : hi) };
  const least = { range: (lo) => lo };
  for (const rng of [worst, least]) {
    for (const spot of [...CLUTTER_SPOTS, ...PINE_HILLS_V2_LAYOUT.clutterSpots]) {
      const pile = seedClutterPile(spot, rng, false);
      const box = boxAt(pile.x, pile.z, CLUTTER_PILE_FOOTPRINT, CLUTTER_PILE_FOOTPRINT);
      assert.equal(
        inAnyClearway(box), false,
        `pile from (${spot.x}, ${spot.z}) rounded to (${pile.x}, ${pile.z}) sits in a clearway`,
      );
    }
  }
});

// The fixed entrance dressing. The basket station was 0.11 yd inside the rect in
// BOTH rooms — "clear of the door swing" was true and irrelevant, because the
// clearway is deliberately wider than the swing.
test('permanent entrance dressing stands outside the clearway', () => {
  const stations = {
    'pine-hills': PINE_HILLS_BASKET_STATION,
    'pine-hills-v2': PINE_HILLS_V2_BASKET_STATION,
  };
  for (const [room, s] of Object.entries(stations)) {
    assert.equal(
      inAnyClearway(boxAt(s.x, s.z, s.w, s.d)), false,
      `${room} basket station at (${s.x}, ${s.z}) stands in the doorway`,
    );
    // The pickup slot is where a customer stands to take a basket; a body in the
    // clearway blocks the door just as well as a prop does.
    assert.equal(
      inAnyClearway(boxAt(s.pickup.x, s.pickup.z, 0.64, 0.64)), false,
      `${room} basket pickup slot at (${s.pickup.x}, ${s.pickup.z}) stands in the doorway`,
    );
  }
});

test('the flat entrance dressing is allowed in the clearway, and is flat', () => {
  // The welcome mat and the hours sign are deliberately in or beside the
  // threshold. Neither registers a collider — that is what makes them legal
  // here, so the test states it rather than leaving a silent exception.
  assert.equal(overlaps(boxAt(MAT.x, MAT.z, 0.1, 0.1), DOOR_CLEARWAY), true);
  assert.equal(overlaps(boxAt(HOURS_SIGN.x, HOURS_SIGN.z, 0.1, 0.1), DOOR_CLEARWAY), false);
});

test('clampOutOfClearways leaves anything already clear exactly where it is', () => {
  // (8, 0) used to be here as "obviously clear floor". It is now inside the
  // stock-door lane, which is exactly the point: that spot was never clear, it
  // was merely unprotected.
  for (const [x, z] of [[-9, 0], [0, 0], [5, 5], [-2.9, 5.0], [8, 4.0]]) {
    const c = clampOutOfClearways(x, z, 0.9, 0.9);
    assert.equal(c.x, x, `x moved for a clear footprint at (${x}, ${z})`);
    assert.equal(c.z, z, `z moved for a clear footprint at (${x}, ${z})`);
  }
});

test('clampOutOfClearways pushes along the axis of least penetration', () => {
  // A pile just inside the west edge belongs against the west wall it was
  // authored against, not flung across the doorway or out through the glass.
  const west = clampOutOfClearways(DOOR_CLEARWAY.minX + 0.05, 5.0, 0.9, 0.9);
  assert.ok(west.x < DOOR_CLEARWAY.minX, 'a west-edge intruder goes west');
  assert.equal(west.z, 5.0, 'and does not slide along the wall it was against');

  const east = clampOutOfClearways(DOOR_CLEARWAY.maxX - 0.05, 5.0, 0.9, 0.9);
  assert.ok(east.x > DOOR_CLEARWAY.maxX, 'an east-edge intruder goes east');

  // Dead centre: still resolved, in some direction, completely.
  const mid = clampOutOfClearways(
    (DOOR_CLEARWAY.minX + DOOR_CLEARWAY.maxX) / 2,
    (DOOR_CLEARWAY.minZ + DOOR_CLEARWAY.maxZ) / 2,
    0.9, 0.9,
  );
  assert.equal(inAnyClearway(boxAt(mid.x, mid.z, 0.9, 0.9)), false);
});

test('the receiving doorway is protected by the same clamp', () => {
  const inside = clampOutOfClearways(
    (BACKDOOR_CLEARWAY.minX + BACKDOOR_CLEARWAY.maxX) / 2,
    (BACKDOOR_CLEARWAY.minZ + BACKDOOR_CLEARWAY.maxZ) / 2,
    0.9, 0.9,
  );
  assert.equal(inAnyClearway(boxAt(inside.x, inside.z, 0.9, 0.9)), false);
});

// --- TILL-REACH-001: the lane through the stock door -----------------------------
//
// A different failure from the ones above, with the same shape. Nothing was
// PLACED in this lane — the furniture was authored there years ago and was
// harmless because it had no collision. The collision sweep gave the hand truck
// and the mop corner real hulls, and two pieces of service furniture became a
// wall: 0.45 yd between them against a 0.68-yd player. That sealed the office,
// the staff corridor and the staff side of the till, all at once.
//
// The original diagnosis blamed the desk, because the probe that produced it
// flooded only PUBLIC_ROOM_BOUNDS — and the corridor's one designed entrance is
// the office, at x > 5.70, outside that grid. See DEFECTS.md.
test('the stock-door lane is wide enough for a player, and nothing is authored in it', () => {
  const lane = STOCK_LANE_CLEARWAY;
  assert.ok(lane.maxX - lane.minX >= PLAYER_DIAM,
    `the lane itself must admit a ${PLAYER_DIAM}-yd body, not merely be declared`);

  // Every authored fixed position in the service wing, against the lane. These
  // are the pieces whose hulls arrive at runtime from GLB bounds, so their exact
  // size is not knowable here — what IS knowable is that their anchor must not
  // be in the lane, which is the mistake that was actually made.
  for (const [name, spot] of Object.entries(STOCKROOM)) {
    if (!Number.isFinite(spot?.x) || !Number.isFinite(spot?.z)) continue;
    if (spot.x < 5.0) continue; // public-side datums (the pad outside, etc.)
    const inLane = spot.x > lane.minX && spot.x < lane.maxX
      && spot.z > lane.minZ && spot.z < lane.maxZ;
    assert.equal(inLane, false,
      `STOCKROOM.${name} at (${spot.x}, ${spot.z}) is parked in the stock-door lane`);
  }
});

test('a clutter pile can never be seeded into the stock-door lane, at any jitter', () => {
  // Exhaustive over the jitter box rather than over seeds, for the reason at the
  // top of this file.
  const STEP = 0.05;
  for (const spot of CLUTTER_SPOTS) {
    for (let dx = -JITTER_X; dx <= JITTER_X + 1e-9; dx += STEP) {
      for (let dz = -JITTER_Z; dz <= JITTER_Z + 1e-9; dz += STEP) {
        const c = clampOutOfClearways(
          spot.x + dx, spot.z + dz, CLUTTER_PILE_FOOTPRINT, CLUTTER_PILE_FOOTPRINT,
        );
        const box = boxAt(c.x, c.z, CLUTTER_PILE_FOOTPRINT, CLUTTER_PILE_FOOTPRINT);
        assert.equal(overlaps(box, STOCK_LANE_CLEARWAY), false,
          `pile from (${spot.x}, ${spot.z}) lands in the stock-door lane at `
          + `(${c.x.toFixed(2)}, ${c.z.toFixed(2)})`);
      }
    }
  }
});

test('the lane is a clearway, so the three placement systems already refuse it', () => {
  // The value of adding it to CLEARWAYS rather than checking it separately: every
  // system that already asks "is this in a clearway" now covers the stock lane
  // for free. This pins the wiring, because the wiring is the whole point.
  assert.ok(CLEARWAYS.includes(STOCK_LANE_CLEARWAY),
    'STOCK_LANE_CLEARWAY must be in CLEARWAYS or nothing enforces it');
  const middleOfTheLane = boxAt(7.5, 1.0, 0.6, 0.6);
  assert.equal(inAnyClearway(middleOfTheLane), true);
});
