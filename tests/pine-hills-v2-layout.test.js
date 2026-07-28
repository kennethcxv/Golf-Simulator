// The pine-hills-v2 layout audit — Designs/ProShop/Greybox/FLOOR_PLAN.md, proven
// from Node.
//
// The variant resolves from the page URL once at module load, so under node --test
// every shopLayout export carries the v1 values — asserted first, because the seam
// being invisible here is half its contract. The v2 geometry is then audited through
// the pure surfaces (deriveFrontDeskFrame('pine-hills-v2'), PINE_HILLS_V2_LAYOUT)
// with the frame math reimplemented locally, so no module state is ever mutated.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKDOOR_CLEARWAY,
  CLUBHOUSE_LAYOUT_VARIANT,
  CLUTTER_SPOTS,
  DOOR_CLEARWAY,
  FIXTURES,
  FIXTURE_HALF,
  FRONT_DESK_BACKDROP,
  FRONT_DESK_FRAME,
  LOUNGE,
  MODERN_PUBLIC_INTERIOR,
  PINE_HILLS_V2_LAYOUT,
  PLAYER_DIAM,
  SAFETY_FACILITY_SITE,
  STAFF_CORRIDOR_MIN,
  TRAFFIC_PATHS,
  deriveFrontDeskFrame,
  fixtureRect,
  inRect,
} from '../src/data/shopLayout.js';

const V2 = deriveFrontDeskFrame('pine-hills-v2');
const v2Point = (lx, lz) => ({
  x: V2.x + lx * Math.cos(V2.ry) + lz * Math.sin(V2.ry),
  z: V2.z - lx * Math.sin(V2.ry) + lz * Math.cos(V2.ry),
});
const v2Vector = (lx, lz) => ({
  x: lx * Math.cos(V2.ry) + lz * Math.sin(V2.ry),
  z: -lx * Math.sin(V2.ry) + lz * Math.cos(V2.ry),
});
// The queue choreography is authored frame-local (shopLayout.js): head (-0.48, -1.05),
// pitch (-1.18, -0.45). Recomputed here against the pure v2 frame.
const queueBase = v2Point(-0.48, -1.05);
const queueStep = v2Vector(-1.18, -0.45);
const v2Slot = (i) => ({ x: queueBase.x + queueStep.x * i, z: queueBase.z + queueStep.z * i });

const v2Fixtures = FIXTURES.map((fixture) => {
  const pose = PINE_HILLS_V2_LAYOUT.fixturePoses[fixture.id];
  if (pose) return { ...fixture, ...pose };
  if (fixture.id === 'backcounter') {
    return {
      ...fixture,
      ...v2Point(PINE_HILLS_V2_LAYOUT.backcounterLocal.x, PINE_HILLS_V2_LAYOUT.backcounterLocal.z),
      ry: PINE_HILLS_V2_LAYOUT.backcounterLocal.ry,
    };
  }
  return fixture;
});
const v2FixtureById = new Map(v2Fixtures.map((fixture) => [fixture.id, fixture]));

// Greybox heights per kind (FLOOR_PLAN.md §4) — what the grey volumes ship at, and
// what the F1 strip rule measures against.
const KIND_HEIGHT = {
  shelf: 2.2, pegboard: 2.2, apparelwall: 2.2, rack: 2.2, backshelf: 2.2,
  table: 1.0, feature: 1.0, backcounter: 1.0, rail: 1.45, hatstand: 1.75,
  bagstand: 1.25, shoerack: 2.0, fittingroom: 2.05, premiumcase: 1.9,
  fridge: 1.9, snackrack: 1.6, service: 1.1, demo: 0.4,
  officeDesk: 1.0, officeChair: 1.1, officeFiling: 1.45, packingbench: 1.0,
};

const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const siteRect = (site) => ({
  minX: site.x - site.w / 2, maxX: site.x + site.w / 2,
  minZ: site.z - site.d / 2, maxZ: site.z + site.d / 2,
});

function segmentCrossesRect(a, b, rect) {
  // Conservative sampling: 400 steps over ~12 yd is a 0.03-yd resolution, far finer
  // than any clearance asserted here.
  for (let i = 0; i <= 400; i += 1) {
    const t = i / 400;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ) return true;
  }
  return false;
}

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

test('the seam is invisible under Node: every export carries the v1 values', () => {
  assert.equal(CLUBHOUSE_LAYOUT_VARIANT, null);
  assert.equal(FRONT_DESK_FRAME.x, -0.8);
  assert.equal(FRONT_DESK_FRAME.ry, Math.PI);
  assert.equal(FRONT_DESK_BACKDROP.surfaceLocalZ, 1.88);
  assert.equal(TRAFFIC_PATHS.length, 5);
  assert.deepEqual(SAFETY_FACILITY_SITE, { x: 5.15, z: -0.85 });
  assert.deepEqual(CLUTTER_SPOTS[0], { x: -8.0, z: 4.7 });
  const rail = FIXTURES.find((fixture) => fixture.id === 'rail_outer');
  assert.equal(rail.x, -0.5);
  assert.equal(rail.z, -3.2);
});

test('D1: the v2 frame moves the datum and nothing else', () => {
  assert.equal(V2.x, 3.30);
  assert.equal(V2.z, 3.35);
  assert.equal(V2.ry, 0);
  const v1 = deriveFrontDeskFrame();
  for (const key of ['frontLength', 'frontDepth', 'returnLength', 'returnCollisionWidth', 'returnStaffExtent', 'counterTop', 'version']) {
    assert.equal(V2[key], v1[key], `frame dimension ${key} must not change under v2`);
  }
});

test('desk, corridor and hutch: the south-wall counter works as drawn', () => {
  const frontHalf = V2.frontLength / 2;
  const depthHalf = V2.frontDepth / 2;
  const slab = {
    minX: V2.x - frontHalf, maxX: V2.x + frontHalf,
    minZ: V2.z - depthHalf, maxZ: V2.z + depthHalf,
  };
  const returnRun = {
    minX: V2.x - frontHalf, maxX: V2.x - frontHalf + V2.returnCollisionWidth,
    minZ: V2.z + depthHalf, maxZ: V2.z + V2.returnStaffExtent,
  };
  // FLOOR_PLAN.md §2: run x 1.00..5.60, front face z 2.94.
  assert.ok(Math.abs(slab.minX - 1.003) < 0.01 && Math.abs(slab.maxX - 5.597) < 0.01);
  assert.ok(Math.abs(slab.minZ - 2.94) < 0.005);
  // The desk stays clear of the protected entrance corridor.
  assert.ok(slab.minX >= DOOR_CLEARWAY.maxX + 0.5, `desk west end ${slab.minX} crowds the door clearway`);
  // Staff corridor between desk back and hutch front is at least the contract minimum.
  const hutch = fixtureRect(v2FixtureById.get('backcounter'));
  const corridor = hutch.minZ - slab.maxZ;
  assert.ok(corridor >= STAFF_CORRIDOR_MIN, `staff corridor ${corridor.toFixed(3)} < ${STAFF_CORRIDOR_MIN}`);
  // The corridor's west end is sealed by spacing: the slot between the return and the
  // hutch is narrower than a player capsule, so customers cannot slip behind the till.
  const westSlot = hutch.minX - returnRun.maxX;
  assert.ok(westSlot < PLAYER_DIAM, `west corridor slot ${westSlot.toFixed(3)} admits a capsule`);
  // The hutch backs onto the south wall rather than intersecting it.
  assert.ok(hutch.maxZ <= MODERN_PUBLIC_INTERIOR.d / 2 + 1e-9);
});

test('queue: off the counter, out of the doorway, humanly spaced', () => {
  const slabFrontZ = V2.z - V2.frontDepth / 2;
  const gap = slabFrontZ - v2Slot(0).z;
  assert.ok(gap >= 0.45 && gap <= 2.2, `queue head gap ${gap.toFixed(3)}`);
  const spacing = Math.hypot(queueStep.x, queueStep.z);
  assert.ok(spacing >= 1.15, `queue spacing ${spacing.toFixed(3)}`);
  for (let i = 0; i < 3; i += 1) {
    const slot = v2Slot(i);
    assert.ok(!inRect(DOOR_CLEARWAY, slot.x, slot.z), `queue slot ${i} stands in the door clearway`);
  }
});

test('no fixture intersects either protected clearway', () => {
  for (const fixture of v2Fixtures) {
    const rect = fixtureRect(fixture);
    assert.ok(!overlaps(rect, DOOR_CLEARWAY), `${fixture.id} intersects the door clearway`);
    assert.ok(!overlaps(rect, BACKDOOR_CLEARWAY), `${fixture.id} intersects the receiving clearway`);
  }
});

test('campaign keep-clears: the validator rects stay empty', () => {
  // FLOOR_PLAN.md §8 — sites that must stay fixture-free in the v2 room. Facility
  // sites that install ONTO their own fixture (officeDesk, stockroomShelves,
  // frontCounter...) are excluded by nature.
  const keepClear = [
    { id: 'displayShelves', ...siteRect({ x: -4.25, z: -0.7, w: 2.4, d: 0.8 }) },
    { id: 'safety', ...siteRect({ ...PINE_HILLS_V2_LAYOUT.safetySite, w: 0.72, d: 0.5 }) },
    { id: 'repair:floor', ...siteRect({ x: -2.1, z: -0.8, w: 1.45, d: 1.0 }) },
    { id: 'repair:panels', ...siteRect({ x: 5.15, z: 0.75, w: 1.15, d: 0.65 }) },
  ];
  for (const site of keepClear) {
    for (const fixture of v2Fixtures) {
      assert.ok(!overlaps(fixtureRect(fixture), site), `${fixture.id} intrudes on ${site.id}`);
    }
    for (const spot of PINE_HILLS_V2_LAYOUT.clutterSpots) {
      assert.ok(!(spot.x >= site.minX && spot.x <= site.maxX && spot.z >= site.minZ && spot.z <= site.maxZ),
        `clutter at ${spot.x},${spot.z} sits on ${site.id}`);
    }
  }
});

test('F1: the entry-axis strip holds nothing taller than 1.35 yd', () => {
  // Door to the north retail walls; the wall-backed fixtures AT the north end are the
  // intended ray terminus, so the strip stops short of them.
  const strip = { minX: -2.4, maxX: 0.9, minZ: -4.6, maxZ: MODERN_PUBLIC_INTERIOR.d / 2 };
  for (const fixture of v2Fixtures) {
    const height = KIND_HEIGHT[fixture.kind];
    assert.ok(Number.isFinite(height), `no greybox height for kind ${fixture.kind}`);
    if (height <= 1.35) continue;
    assert.ok(!overlaps(fixtureRect(fixture), strip),
      `${fixture.id} (${height} tall) stands in the F1 sightline strip`);
  }
});

test('F5: the door-to-lounge fan is open where the plan says it is', () => {
  const door = { x: -0.8, z: 5.2 };
  const crossers = (target) => v2Fixtures
    .filter((fixture) => segmentCrossesRect(door, target, fixtureRect(fixture)))
    .map((fixture) => fixture.id);
  // chairB is the arrival hero: nothing crosses its ray at any tier.
  assert.deepEqual(crossers(LOUNGE.chairB), [], 'chairB must read full-height from the door');
  // chairA is occluded by exactly the tier-2 bag stand and nothing else — at tier 1
  // (the starter state, where the neglect read matters most) the fan is fully open.
  const chairACrossers = crossers(LOUNGE.chairA);
  assert.deepEqual(chairACrossers, ['bagstand']);
  assert.equal(v2FixtureById.get('bagstand').minTier, 2);
});

test('F4: every clutter spot sits at least 0.8 yd off every traffic polyline', () => {
  const paths = PINE_HILLS_V2_LAYOUT.trafficPaths(v2Slot);
  assert.equal(PINE_HILLS_V2_LAYOUT.clutterSpots.length, 8);
  for (const spot of PINE_HILLS_V2_LAYOUT.clutterSpots) {
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i += 1) {
        const distance = pointSegmentDistance(spot, path[i], path[i + 1]);
        assert.ok(distance >= 0.8,
          `clutter at ${spot.x},${spot.z} is ${distance.toFixed(2)} yd off a traffic leg`);
      }
    }
  }
});

test('the corridor traffic leg walks inside the corridor band', () => {
  const paths = PINE_HILLS_V2_LAYOUT.trafficPaths(v2Slot);
  const corridorLeg = paths[5];
  const slabBackZ = V2.z + V2.frontDepth / 2;
  const hutch = fixtureRect(v2FixtureById.get('backcounter'));
  for (const point of corridorLeg) {
    assert.ok(point.z > slabBackZ && point.z < hutch.minZ,
      `corridor leg point ${point.x},${point.z} leaves the staff corridor`);
  }
});

test('the board surface lands on the real south wall under v2', () => {
  const surfaceLocalZ = MODERN_PUBLIC_INTERIOR.d / 2 - 0.075 - PINE_HILLS_V2_LAYOUT.frame.z;
  const wallPlane = MODERN_PUBLIC_INTERIOR.d / 2 - 0.075;
  assert.ok(Math.abs((V2.z + surfaceLocalZ) - wallPlane) < 1e-9);
  // The v1 +0.20 world-Z board compensation would push a board past the interior wall
  // face at ry 0 — the reason v2 renderers must NOT apply it.
  assert.ok(V2.z + surfaceLocalZ + 0.20 > MODERN_PUBLIC_INTERIOR.d / 2);
});

test('fixture rects that keep v1 poses are untouched by the v2 table', () => {
  const moved = new Set([...Object.keys(PINE_HILLS_V2_LAYOUT.fixturePoses), 'backcounter']);
  for (const fixture of v2Fixtures) {
    if (moved.has(fixture.id)) continue;
    const original = FIXTURES.find((entry) => entry.id === fixture.id);
    assert.equal(fixture.x, original.x, `${fixture.id} drifted in x`);
    assert.equal(fixture.z, original.z, `${fixture.id} drifted in z`);
  }
});

test('member station clears the relocated safety site and the desk', () => {
  const station = fixtureRect(v2FixtureById.get('member_station'));
  const safety = siteRect({ ...PINE_HILLS_V2_LAYOUT.safetySite, w: 0.72, d: 0.5 });
  assert.ok(!overlaps(station, safety));
  const slabFrontZ = V2.z - V2.frontDepth / 2;
  assert.ok(slabFrontZ - station.maxZ >= 0.25,
    `member station is ${(slabFrontZ - station.maxZ).toFixed(2)} yd off the desk front`);
});
