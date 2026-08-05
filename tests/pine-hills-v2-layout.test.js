// The pine-hills-v2 layout audit — OVERNIGHT_REPORT.md §3's resized room, proven
// from Node.
//
// The variant resolves from the page URL once at module load, so under node --test
// every shopLayout export carries the v1 values — asserted first, because the seam
// being invisible here is half its contract. The v2 geometry is then audited through
// the pure surfaces (deriveFrontDeskFrame('pine-hills-v2'), PINE_HILLS_V2_LAYOUT)
// with the fixture/frame math reimplemented locally, so no module state is mutated.
//
// The stand-point clearance suite exists because of a measured failure: the first
// v2 room shipped browse stand points the nav grid could not deliver a walker to,
// and customers pinned there for sim-hours. Every stand point, queue slot, and
// traffic vertex is now proven reachable-adjacent (clear of every collider rect)
// before a build can pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKDOOR_CLEARWAY,
  CEILING_PANEL_RIG,
  CLUBHOUSE_CEILING_PANELS,
  CLUBHOUSE_LAYOUT_VARIANT,
  DOOR_CLEARWAY,
  DOOR_MAIN,
  FIXTURES,
  FIXTURE_HALF,
  LOUNGE,
  MODERN_PUBLIC_INTERIOR,
  PARTITIONS,
  PINE_HILLS_V2_CEILING_RIG,
  PINE_HILLS_V2_LAYOUT,
  PINE_HILLS_V2_SHELL_LIGHTS,
  PLAYER_DIAM,
  PUBLIC_ROOM_BOUNDS,
  SHELL,
  SHELL_LIGHT_PLACEMENTS,
  STAFF_CORRIDOR_MIN,
  deriveFrontDeskFrame,
  pineHillsV2QueueSlot,
} from '../src/data/shopLayout.js';

const L = PINE_HILLS_V2_LAYOUT;
const B = L.publicBounds;
const V2 = deriveFrontDeskFrame('pine-hills-v2');
const v2Point = (lx, lz) => ({
  x: V2.x + lx * Math.cos(V2.ry) + lz * Math.sin(V2.ry),
  z: V2.z - lx * Math.sin(V2.ry) + lz * Math.cos(V2.ry),
});
// Queue choreography is the shipped pure function (2026-07-28 ruling: line east
// along the desk face, overflow pocket past it) — auditing through the export
// means these tests measure exactly what the browser build walks.
const v2Slot = pineHillsV2QueueSlot;
// A full house in the resized-day evidence peaks at 11-13 tracked customers:
// twelve queue indices is every point the live game can hand out under load.
const QUEUE_INDICES = [...Array(12).keys()];

// The same transformation the module applies: cut, then re-pose, then re-sku.
const cutSet = new Set(L.cutFixtures);
const v2Fixtures = FIXTURES
  .filter((fixture) => !cutSet.has(fixture.id))
  .map((fixture) => {
    const pose = L.fixturePoses[fixture.id];
    const skus = L.skuOverrides[fixture.id];
    const out = { ...fixture, ...(pose || {}) };
    if (skus) out.skus = [...skus];
    if (fixture.id === 'backcounter') {
      Object.assign(out, v2Point(L.backcounterLocal.x, L.backcounterLocal.z), {
        ry: L.backcounterLocal.ry,
      });
    }
    return out;
  });
const byId = new Map(v2Fixtures.map((fixture) => [fixture.id, fixture]));
const WING_ZONES = new Set(['stockroom', 'office']);
const publicFixtures = v2Fixtures.filter((fixture) => !WING_ZONES.has(fixture.zone));

// Greybox heights per kind — what the grey volumes ship at, and what the F1
// eye-level occlusion metric measures against.
const KIND_HEIGHT = {
  shelf: 2.2, pegboard: 2.2, apparelwall: 2.2, rack: 2.2, backshelf: 2.2,
  table: 1.0, feature: 1.0, backcounter: 1.0, rail: 1.45, hatstand: 1.75,
  bagstand: 1.25, shoerack: 2.0, fittingroom: 2.05, premiumcase: 1.9,
  fridge: 1.9, snackrack: 1.6, service: 1.1, demo: 0.4,
  officeDesk: 1.0, officeChair: 1.1, officeFiling: 1.45, packingbench: 1.0,
};

function fixtureRectOf(fixture) {
  const half = fixture.footprint
    ? [
      Math.max(Math.abs(fixture.footprint.minX), Math.abs(fixture.footprint.maxX)),
      Math.max(Math.abs(fixture.footprint.minZ), Math.abs(fixture.footprint.maxZ)),
    ]
    : (FIXTURE_HALF[fixture.kind] || [0.5, 0.5]);
  const swap = Math.abs(Math.sin(fixture.ry || 0)) > 0.5;
  const hx = swap ? half[1] : half[0];
  const hz = swap ? half[0] : half[1];
  return {
    minX: fixture.x - hx, maxX: fixture.x + hx,
    minZ: fixture.z - hz, maxZ: fixture.z + hz,
  };
}
const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const inBounds = (p, r, pad = 0) => p.x >= r.minX + pad && p.x <= r.maxX - pad
  && p.z >= r.minZ + pad && p.z <= r.maxZ - pad;
const rectInBounds = (rect, r) => rect.minX >= r.minX && rect.maxX <= r.maxX
  && rect.minZ >= r.minZ && rect.maxZ <= r.maxZ;
const distToRect = (p, r) => {
  const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX);
  const dz = Math.max(r.minZ - p.z, 0, p.z - r.maxZ);
  return Math.hypot(dx, dz);
};
const distPointSegment = (p, a, b) => {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
};
function segmentCrossesRect(a, b, rect) {
  const steps = 400;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ) return true;
  }
  return false;
}
// Ray from origin along dir to the envelope walls: smallest positive t.
function envelopeDistance(origin, dir, r) {
  let best = Infinity;
  if (dir.x < 0) best = Math.min(best, (r.minX - origin.x) / dir.x);
  if (dir.x > 0) best = Math.min(best, (r.maxX - origin.x) / dir.x);
  if (dir.z < 0) best = Math.min(best, (r.minZ - origin.z) / dir.z);
  if (dir.z > 0) best = Math.min(best, (r.maxZ - origin.z) / dir.z);
  return best;
}
function rectDistance(origin, dir, rect) {
  // Slab method; returns entry distance or Infinity.
  let tMin = -Infinity;
  let tMax = Infinity;
  for (const [o, d, lo, hi] of [
    [origin.x, dir.x, rect.minX, rect.maxX],
    [origin.z, dir.z, rect.minZ, rect.maxZ],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t0 = (lo - o) / d;
      let t1 = (hi - o) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      tMin = Math.max(tMin, t0);
      tMax = Math.min(tMax, t1);
      if (tMin > tMax) return Infinity;
    }
  }
  return tMax < 0 ? Infinity : Math.max(tMin, 0);
}
const rotatedSocket = (fixture, socket) => {
  const angle = fixture.ry || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: fixture.x + socket.x * cos + socket.z * sin,
    z: fixture.z - socket.x * sin + socket.z * cos,
  };
};
const loungeChairRect = (piece, half = 0.45) => ({
  minX: piece.x - half, maxX: piece.x + half,
  minZ: piece.z - half, maxZ: piece.z + half,
});
const WING_RECT = { minX: 5.70, maxX: MODERN_PUBLIC_INTERIOR.w / 2, minZ: -MODERN_PUBLIC_INTERIOR.d / 2, maxZ: MODERN_PUBLIC_INTERIOR.d / 2 };
const inRoomOrWing = (p) => inBounds(p, B) || inBounds(p, WING_RECT);

test('the seam is invisible under Node: every export carries v1', () => {
  assert.equal(CLUBHOUSE_LAYOUT_VARIANT, null);
  assert.ok(FIXTURES.some((fixture) => fixture.id === 'bagstand'));
  assert.ok(FIXTURES.some((fixture) => fixture.id === 'rack_drivers'));
  assert.equal(LOUNGE.chairA.x, 3.45);
  assert.equal(LOUNGE.chairA.z, -4.85);
  assert.ok(Math.abs(PUBLIC_ROOM_BOUNDS.minX - -MODERN_PUBLIC_INTERIOR.w / 2) < 1e-9);
  assert.ok(Math.abs(PUBLIC_ROOM_BOUNDS.minZ - -MODERN_PUBLIC_INTERIOR.d / 2) < 1e-9);
});

test('decision D1 holds: the v2 frame is the approved south-wall counter', () => {
  assert.equal(V2.x, 3.30);
  assert.equal(V2.z, 3.35);
  assert.equal(V2.ry, 0);
});

test('the envelope is the approved 70 m² municipal footprint', () => {
  const areaM2 = (B.maxX - B.minX) * (B.maxZ - B.minZ) * 0.83612736;
  assert.ok(areaM2 >= 68 && areaM2 <= 72, `area ${areaM2.toFixed(1)} m² outside 68-72`);
  // East and south anchor on the existing structure.
  assert.equal(B.maxX, 5.70);
  assert.ok(Math.abs(B.maxZ - MODERN_PUBLIC_INTERIOR.d / 2) < 1e-9);
  // The new walls actually shrink the room.
  assert.ok(B.minX > -MODERN_PUBLIC_INTERIOR.w / 2 + 3);
  assert.ok(B.minZ > -MODERN_PUBLIC_INTERIOR.d / 2 + 0.5);
});

test('ceiling and beams: 2.56 m of pressure that still clears every head', () => {
  assert.equal(L.ceilingY, 2.80);
  assert.ok(L.ceilingY < SHELL.h);
  assert.ok(L.ceilingY - DOOR_MAIN.h > 0.05, 'door head must clear the lid');
  const beamUnderside = L.ceilingY - L.beams.depth;
  assert.ok(beamUnderside >= 2.35, 'beam underside headroom');
  for (const z of L.beams.zStations) {
    assert.ok(B.maxZ - z >= 1.0, `beam at z ${z} too close to the door wall`);
    assert.ok(z > B.minZ && z < B.maxZ);
  }
});

test('the cut list is exact and touches nothing in the service wing', () => {
  assert.equal(L.cutFixtures.length, 11);
  for (const id of L.cutFixtures) {
    assert.ok(!byId.has(id), `${id} should be cut`);
    assert.ok(!L.fixturePoses[id], `${id} is cut - a pose for it is dead data`);
  }
  for (const id of ['office_desk', 'office_chair', 'office_filing', 'packing_bench',
    'backshelf_n', 'backshelf_e', 'backshelf_e2']) {
    const fixture = byId.get(id);
    assert.ok(fixture, `wing fixture ${id} must survive`);
    const original = FIXTURES.find((entry) => entry.id === id);
    assert.equal(fixture.x, original.x, `${id} x untouched`);
    assert.equal(fixture.z, original.z, `${id} z untouched`);
  }
  // The gloves fold: the pegboard carries them, nothing else changed skus.
  const acc = byId.get('shelf_acc');
  for (const sku of ['glove1', 'glove2', 'sock1']) {
    assert.ok(acc.skus.includes(sku), `shelf_acc carries ${sku}`);
  }
});

test('every public fixture sits inside the envelope and overlaps nothing', () => {
  for (const fixture of publicFixtures) {
    const rect = fixtureRectOf(fixture);
    assert.ok(rectInBounds(rect, B),
      `${fixture.id} rect ${JSON.stringify(rect)} breaches the envelope`);
  }
  for (let i = 0; i < publicFixtures.length; i++) {
    for (let j = i + 1; j < publicFixtures.length; j++) {
      const a = fixtureRectOf(publicFixtures[i]);
      const b = fixtureRectOf(publicFixtures[j]);
      assert.ok(!overlaps(a, b),
        `${publicFixtures[i].id} overlaps ${publicFixtures[j].id}`);
    }
  }
});

test('every stand point is deliverable: clear of all colliders (the item-3 lesson)', () => {
  const loungePieces = [
    L.loungeSet.chairA, L.loungeSet.chairB,
    { ...L.loungeSet.coffee }, L.loungeSet.trophy,
  ].map((piece) => loungeChairRect(piece));
  const clearOf = (point, label, ownId = null) => {
    assert.ok(inBounds(point, B, 0.30), `${label} at (${point.x.toFixed(2)}, ${point.z.toFixed(2)}) too close to a wall`);
    for (const fixture of publicFixtures) {
      if (fixture.id === ownId) continue;
      const gap = distToRect(point, fixtureRectOf(fixture));
      assert.ok(gap >= 0.30,
        `${label} only ${gap.toFixed(2)} yd from ${fixture.id}`);
    }
    for (const rect of loungePieces) {
      assert.ok(distToRect(point, rect) >= 0.28, `${label} inside the lounge suite`);
    }
  };
  for (const fixture of publicFixtures) {
    for (const kindKey of ['browse', 'stock']) {
      for (const [index, socket] of (fixture[kindKey] || []).entries()) {
        const point = rotatedSocket(fixture, socket);
        if (kindKey === 'browse' && fixture.experience) {
          // Experience stands (the fitting booth's try-on point) sit inside their
          // own hull by design; they still must stay inside the envelope.
          assert.ok(inBounds(point, B), `${fixture.id} experience stand outside the room`);
          continue;
        }
        clearOf(point, `${fixture.id} ${kindKey}[${index}]`, fixture.id);
      }
    }
  }
  for (const i of QUEUE_INDICES) {
    clearOf(v2Slot(i), `queue slot ${i}`);
  }
});

test('the queue ruling: line east along the desk face, exit lane never crossed', () => {
  const slab = {
    minX: V2.x - V2.frontLength / 2, maxX: V2.x + V2.frontLength / 2,
    minZ: V2.z - V2.frontDepth / 2, maxZ: V2.z + V2.frontDepth / 2,
  };
  // The leavers' lane: from the head westward along the face, then south
  // through the desk-end gap to the door. The head itself (slot 0) is the
  // lane's origin; every other queue point must stay out of it.
  const exitLane = { minX: 0.20, maxX: 2.60, minZ: 2.20, maxZ: 5.20 };
  const head = v2Slot(0);
  for (const i of QUEUE_INDICES) {
    const p = v2Slot(i);
    assert.ok(distToRect(p, slab) >= 0.30,
      `queue slot ${i} presses the desk slab (${distToRect(p, slab).toFixed(2)})`);
    assert.ok(p.x >= 2.0,
      `queue slot ${i} at x ${p.x.toFixed(2)} strays into the west half`);
    if (i === 0) continue;
    assert.ok(!inBounds(p, exitLane),
      `queue slot ${i} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) stands in the exit lane`);
  }
  // The line itself: monotone east (the tail grows AWAY from the door), body
  // spacing in the tight-retail band, and every line slot on the face band.
  for (let i = 1; i < L.queue.lineSlots; i++) {
    const prev = v2Slot(i - 1);
    const cur = v2Slot(i);
    assert.ok(cur.x > prev.x + 0.5, `line slot ${i} does not step east`);
    const spacing = Math.hypot(cur.x - prev.x, cur.z - prev.z);
    assert.ok(spacing >= 0.60 && spacing <= 1.00,
      `line spacing ${spacing.toFixed(3)} outside the 0.60-1.00 body band`);
    assert.ok(cur.z > 2.0 && cur.z < slab.minZ,
      `line slot ${i} off the desk-face band`);
  }
  assert.ok(Math.abs(head.x - 2.82) < 1e-9 && Math.abs(head.z - 2.30) < 1e-9,
    'the head moved - checkout reach circles and camera poses key off (2.82, 2.30)');
});

test('the protected clearways stay empty', () => {
  for (const fixture of publicFixtures) {
    assert.ok(!overlaps(fixtureRectOf(fixture), DOOR_CLEARWAY),
      `${fixture.id} breaches the door clearway`);
  }
  for (const spot of L.clutterSpots) {
    assert.ok(!inBounds(spot, DOOR_CLEARWAY), 'clutter in the door clearway');
    assert.ok(!inBounds(spot, BACKDOOR_CLEARWAY), 'clutter in the receiving doorway');
  }
  for (const piece of [L.loungeSet.chairA, L.loungeSet.chairB, L.loungeSet.coffee]) {
    assert.ok(!inBounds(piece, DOOR_CLEARWAY), 'lounge piece in the door clearway');
  }
});

test('the corridor seal closes the partition-to-desk hole', () => {
  // First requeue day run, 2026-07-28: the x 5.70 partition ends at z 2.00 and
  // the desk face starts at z 2.94; customers were body-shoved through the
  // 0.94-yd hole and pinned in the staff corridor — violating §7's explicit
  // "customers cannot enter the corridor". The seal is the drawn wall segment.
  const seal = L.corridorSeal;
  const partition = PARTITIONS[0];
  const slabFaceZ = V2.z - V2.frontDepth / 2;
  assert.ok(Math.abs(seal.x - partition.at) < 1e-6, 'seal off the partition line');
  assert.ok(seal.zFrom <= partition.to + 1e-6, 'seal leaves a gap at the partition end');
  assert.ok(seal.zTo >= slabFaceZ - 1e-6, 'seal leaves a gap at the desk face');
  // The stub must reach the desk's STAFF edge (the T-seam the 1× curve leg
  // found) but never cover the staff mouth at z 3.86.
  const deskStaffEdge = V2.z + V2.frontDepth / 2;
  assert.ok(seal.zTo >= deskStaffEdge - 0.02, 'seal stops short of the desk staff edge');
  assert.ok(seal.zTo < 3.86, 'seal covers the staff mouth');
  const member = fixtureRectOf(byId.get('member_station'));
  assert.ok(seal.x - seal.t / 2 >= member.maxX + 0.05,
    'seal presses member_station');

  // C5, 2026-08-04: `returnBackFill` is GONE and must stay gone. It sealed the
  // 0.34 yd behind the return leg, and with the leg deleted it is the last thing
  // standing in the staff pass-through. Asserting its absence here is the point:
  // the seal and the doorway are the same 0.88 yd of floor, and a future edit
  // that re-adds the fillet re-seals the till.
  const westSeal = L.corridorWestSeal;
  assert.equal(westSeal.returnBackFill, undefined,
    'returnBackFill is the staff pass-through - it must not come back');
  const hutch = fixtureRectOf(byId.get('backcounter'));
  const gapFill = westSeal.hutchGapFill;
  assert.ok(gapFill.maxX >= hutch.minX - 0.02, 'gapFill-hutch seam');
  assert.ok(gapFill.minZ <= hutch.minZ + 0.02, 'gapFill hutch-face seam');
  assert.ok(gapFill.maxZ >= B.maxZ - 0.02, 'gapFill south-wall seam');
  // The hutch-east sliver: flush hutch-east → partition band, hutch face → wall.
  const eastFill = westSeal.hutchEastFill;
  assert.ok(eastFill.minX <= hutch.maxX + 0.02, 'hutchEastFill-hutch seam');
  assert.ok(eastFill.maxX >= seal.x + seal.t / 2 - 1e-6, 'hutchEastFill-partition seam');
  assert.ok(eastFill.minZ <= hutch.minZ + 0.02, 'hutchEastFill hutch-face seam');
  assert.ok(eastFill.maxZ >= B.maxZ - 0.02, 'hutchEastFill south-wall seam');
});

test('the staff corridor behind the desk survives the resize untouched', () => {
  const deskStaffEdge = V2.z + V2.frontDepth / 2;
  const hutchFace = v2Point(L.backcounterLocal.x, L.backcounterLocal.z).z - 0.3;
  const corridor = hutchFace - deskStaffEdge;
  assert.ok(corridor >= STAFF_CORRIDOR_MIN - 1e-6,
    `staff corridor ${corridor.toFixed(3)} < ${STAFF_CORRIDOR_MIN}`);
});

test('the lounge keeps its mandate: inside the room, visible from the door', () => {
  const set = L.loungeSet;
  for (const [name, piece] of Object.entries(set)) {
    if (name === 'bounds') continue;
    assert.ok(inBounds(piece, B), `lounge ${name} outside the envelope`);
  }
  const doorEye = { x: DOOR_MAIN.x, z: 5.2 };
  const tallRects = publicFixtures
    .filter((fixture) => (KIND_HEIGHT[fixture.kind] ?? 1.0) > 1.0)
    .map((fixture) => ({ id: fixture.id, rect: fixtureRectOf(fixture) }));
  for (const [name, piece] of [['chairA', set.chairA], ['chairB', set.chairB],
    ['coffee', set.coffee], ['rug', set.rug]]) {
    for (const { id, rect } of tallRects) {
      assert.ok(!segmentCrossesRect(doorEye, piece, rect),
        `door→${name} sightline crosses ${id}`);
    }
  }
});

test('F1 normalized: the D1 sightline gain survives in the small room', () => {
  // 41 rays fanned ±55° around north from the door eye. In a 9.2 m deep room the
  // old literal ≥8 yd metric is impossible for most directions (the walls arrive
  // first), so the resize contract is the wall-normalized form: a ray passes when
  // its first eye-level obstruction stands at ≥80% of the empty-room distance
  // along that ray. The literal figure is printed for the report.
  const doorEye = { x: DOOR_MAIN.x, z: 5.2 };
  const tallRects = publicFixtures
    .filter((fixture) => (KIND_HEIGHT[fixture.kind] ?? 1.0) > 1.35)
    .map((fixture) => fixtureRectOf(fixture));
  let pass = 0;
  let literal = 0;
  const rays = 41;
  for (let i = 0; i < rays; i++) {
    const angle = (-55 + (110 * i) / (rays - 1)) * (Math.PI / 180);
    const dir = { x: Math.sin(angle), z: -Math.cos(angle) };
    const wall = envelopeDistance(doorEye, dir, B);
    let hit = wall;
    for (const rect of tallRects) {
      hit = Math.min(hit, rectDistance(doorEye, dir, rect));
    }
    if (hit / wall >= 0.8) pass += 1;
    if (hit >= 8) literal += 1;
  }
  const fraction = pass / rays;
  console.log(`F1 normalized ${(fraction * 100).toFixed(1)}% | literal ≥8yd ${((literal / rays) * 100).toFixed(1)}%`);
  assert.ok(fraction >= 0.60, `normalized F1 ${(fraction * 100).toFixed(1)}% < 60%`);
});

test('traffic legs run inside the room and through open floor', () => {
  const legs = L.trafficPaths(v2Slot);
  const solidRects = [
    ...publicFixtures.map((fixture) => ({ id: fixture.id, rect: fixtureRectOf(fixture) })),
    { id: 'lounge chairA', rect: loungeChairRect(L.loungeSet.chairA) },
    { id: 'lounge chairB', rect: loungeChairRect(L.loungeSet.chairB) },
    { id: 'lounge coffee', rect: loungeChairRect(L.loungeSet.coffee, 0.35) },
  ];
  for (const leg of legs) {
    for (const vertex of leg) {
      assert.ok(inRoomOrWing(vertex),
        `traffic vertex (${vertex.x}, ${vertex.z}) outside room+wing`);
    }
    for (let s = 0; s < leg.length - 1; s++) {
      for (const { id, rect } of solidRects) {
        assert.ok(!segmentCrossesRect(leg[s], leg[s + 1], rect),
          `leg segment ${s} crosses ${id}`);
      }
    }
  }
});

test('clutter spots sit in dead zones: off every leg, outside every solid', () => {
  // Seven since C5 (2026-08-04): the eighth sat in what is now the staff
  // pass-through and pinched it to 0.17 yd. The count is asserted so a spot
  // cannot be added back without someone reading this.
  assert.equal(L.clutterSpots.length, 7);
  const legs = L.trafficPaths(v2Slot);
  const passThroughBand = {
    minX: V2.x - V2.frontLength / 2 - 0.25,
    maxX: V2.x - V2.frontLength / 2 + V2.returnCollisionWidth + 0.25,
    minZ: V2.z + V2.frontDepth / 2,
    maxZ: B.maxZ,
  };
  for (const spot of L.clutterSpots) {
    assert.ok(inRoomOrWing(spot), `clutter (${spot.x}, ${spot.z}) outside room+wing`);
    assert.ok(distToRect(spot, passThroughBand) >= 0.05,
      `clutter (${spot.x}, ${spot.z}) sits in the staff pass-through`);
    for (const leg of legs) {
      for (let s = 0; s < leg.length - 1; s++) {
        const d = distPointSegment(spot, leg[s], leg[s + 1]);
        assert.ok(d >= 0.8,
          `clutter (${spot.x}, ${spot.z}) only ${d.toFixed(2)} yd off a traffic leg`);
      }
    }
    for (const fixture of publicFixtures) {
      assert.ok(distToRect(spot, fixtureRectOf(fixture)) >= 0.05,
        `clutter (${spot.x}, ${spot.z}) inside ${fixture.id}`);
    }
  }
});

test('campaign datums: safety site inside, member station clear of it', () => {
  const site = L.safetySite;
  assert.ok(inBounds(site, B));
  // Half 0.28: calibrated by the original graze fix (station 2.05 → 2.15 to
  // clear the keep-clear by 0.07), which pins the protected z-extent at ~1.63.
  const siteRect = { minX: site.x - 0.28, maxX: site.x + 0.28, minZ: site.z - 0.28, maxZ: site.z + 0.28 };
  const station = byId.get('member_station');
  assert.ok(station, 'member_station survives');
  assert.ok(!overlaps(fixtureRectOf(station), siteRect),
    'member station grazes the safety keep-clear');
});

test('the greybox ceiling repair pair sits inside the envelope', () => {
  for (const id of ['panel-03', 'panel-07']) {
    const panel = CLUBHOUSE_CEILING_PANELS.find((entry) => entry.id === id);
    assert.ok(panel, `${id} exists`);
    assert.ok(inBounds(panel, B), `${id} centre outside the envelope`);
  }
  const orphan = CLUBHOUSE_CEILING_PANELS.find((entry) => entry.id === 'panel-02');
  assert.ok(orphan.x < B.minX, 'panel-02 is cavity-side - the module must not expose it');
});

test('phase 4: the v2 ceiling rig hangs every panel and both fault beats inside the envelope', () => {
  const rig = PINE_HILLS_V2_CEILING_RIG;
  assert.equal(rig.y, L.ceilingY, 'the rig hangs from the v2 lid');
  assert.equal(rig.panels.length, 4, 'exactly the four in-envelope stations');
  const ids = rig.panels.map((panel) => panel.id);
  assert.equal(new Set(ids).size, 4, 'position keys are unique - these name meshes');
  // Sim keys are deliberately NOT unique. The sim owns exactly two light
  // faults and the save shape is pinned, so the only way to make the neglected
  // room read as neglected is to hang more than one fitting off each fault:
  // two flickering and two dead, wired as circuit runs. Repair is still two
  // beats and the save never learns about it.
  const simIds = rig.panels.map((panel) => panel.simId);
  assert.deepEqual(
    Object.fromEntries(['panel-02', 'panel-07'].map(
      (sim) => [sim, simIds.filter((id) => id === sim).length],
    )),
    { 'panel-02': 2, 'panel-07': 2 },
    'both faults drive a pair of fittings - the abandoned read',
  );
  assert.equal(simIds.filter((id) => id !== 'panel-02' && id !== 'panel-07').length, 0,
    'no fitting is healthy in the neglected room');
  // The two runs must be diagonal, not split north/south: a room where one
  // half flickers and the other half is dark reads as a lighting design, and a
  // room where they alternate reads as failure.
  const flicker = rig.panels.filter((panel) => panel.simId === 'panel-02');
  assert.notEqual(flicker[0].x, flicker[1].x, 'the flickering pair is diagonal in x');
  assert.notEqual(flicker[0].z, flicker[1].z, 'the flickering pair is diagonal in z');
  for (const panel of rig.panels) {
    assert.ok(panel.x - panel.w / 2 >= B.minX && panel.x + panel.w / 2 <= B.maxX
      && panel.z - panel.d / 2 >= B.minZ && panel.z + panel.d / 2 <= B.maxZ,
    `${panel.id} face inside the public envelope`);
    for (const station of L.beams.zStations) {
      assert.ok(Math.abs(panel.z - station) >= panel.d / 2 + L.beams.width / 2,
        `${panel.id} clears the beam at z ${station}`);
    }
  }
});

test('phase 4: v2 shell light placements are in-building and the cavity leaks are gone', () => {
  for (const [fx, fz] of PINE_HILLS_V2_SHELL_LIGHTS.daylightFills) {
    // Either inside the public envelope or in the service wing (the office
    // keeps its real east window); never west of the new wall.
    assert.ok(fx >= B.minX, `fill (${fx}, ${fz}) sits in sealed cavity`);
    assert.ok(fz >= B.minZ && fz <= SHELL.d, `fill (${fx}, ${fz}) outside the building band`);
  }
  const accent = PINE_HILLS_V2_SHELL_LIGHTS.retailAccent;
  assert.ok(inBounds(accent, B), 'retail accent inside the public envelope');
});

test('phase 4 seam guard: under Node the rig and placements resolve to the v1 values', () => {
  // The suite runs with the variant OFF — these pin v1 byte-identity.
  assert.equal(CLUBHOUSE_LAYOUT_VARIANT, null);
  assert.equal(CEILING_PANEL_RIG.y, SHELL.h);
  assert.equal(CEILING_PANEL_RIG.key, undefined, 'v1 declares no interior key light');
  assert.equal(CEILING_PANEL_RIG.panels.length, CLUBHOUSE_CEILING_PANELS.length);
  for (const [index, panel] of CEILING_PANEL_RIG.panels.entries()) {
    const authored = CLUBHOUSE_CEILING_PANELS[index];
    assert.equal(panel.id, authored.id);
    assert.equal(panel.simId, authored.id, 'v1 sim key === position key');
    assert.equal(panel.x, authored.x);
    assert.equal(panel.z, authored.z);
  }
  assert.deepEqual(
    SHELL_LIGHT_PLACEMENTS.daylightFills.map((fill) => [...fill]),
    [[-6.6, 3.4], [3.0, -4.0], [8.3, 4.2]],
    'the v1 daylight fills are untouched',
  );
  assert.deepEqual(
    { ...SHELL_LIGHT_PLACEMENTS.retailAccent },
    { x: -7.8, z: -1.25 },
    'the v1 retail accent is untouched',
  );
});

test('the west door clearway margin holds against the new wall', () => {
  // The wall face must stay west of the protected rectangle, with at least a
  // player capsule of slack for the walk past the door.
  assert.ok(DOOR_CLEARWAY.minX - B.minX >= PLAYER_DIAM * 0.7,
    `west wall to clearway ${(DOOR_CLEARWAY.minX - B.minX).toFixed(2)}`);
});
