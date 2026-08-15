// P1 (owner playtest) — THE QUEUE, twice over.
//
//   "When I finish a transaction the next person passes their items straight
//    through the body of the person in front, immediately. They should wait for
//    the person ahead to LEAVE, walk to the desk, and only then place goods."
//
//   "And at four deep the line stops being a line - the fourth person stood left
//    of the third and behind. Single file."
//
// Both are arithmetic, and both are pinned here so they cannot drift back.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIXTURES, FIXTURE_HALF, PINE_HILLS_V2_LAYOUT as L, deriveFrontDeskFrame,
} from '../src/data/shopLayout.js';
// From the LAYOUT table, not the renderer: the constant belongs with the queue
// geometry it is compared against, and importing clubhouse.js here would drag
// the whole renderer into a pure arithmetic test.

const V2 = deriveFrontDeskFrame('pine-hills-v2');
const q = L.queue;
const pitch = Math.hypot(q.pitchLocal.x, q.pitchLocal.z);
const QUEUE_HEAD_REACH_YD = q.headReachYd;

test('standing in the SECOND slot cannot count as standing at the desk', () => {
  // This is the whole of the first complaint. customerIsAtTheDesk accepts anyone
  // within QUEUE_HEAD_REACH_YD of slot 0. The queue pitch is the distance
  // between consecutive slots. If the reach is not comfortably SHORTER than the
  // pitch, the person in slot 1 already qualifies -- so they place goods from
  // where they are standing, over the shoulder of whoever is still at the desk,
  // instead of walking up when the line advances.
  //
  // Shipped values when this was written: pitch 0.684, reach 0.80. The reach was
  // larger than the gap between people.
  assert.ok(
    QUEUE_HEAD_REACH_YD < pitch,
    `the head reach (${QUEUE_HEAD_REACH_YD}) must be shorter than the queue pitch `
    + `(${pitch.toFixed(3)}), or slot 1 is indistinguishable from slot 0`,
  );
  // and with real margin, not by a millimetre: a body settling into slot 1 must
  // not flicker into "at the desk" as it drifts
  assert.ok(
    pitch - QUEUE_HEAD_REACH_YD >= 0.15,
    `only ${(pitch - QUEUE_HEAD_REACH_YD).toFixed(3)} yd of margin between the reach and the pitch`,
  );
  // it still has to be loose enough that the last inches of settling do not
  // stall the sale
  assert.ok(QUEUE_HEAD_REACH_YD >= 0.35, 'too tight to ever be satisfied by a settling body');
});

test('the line holds a real queue in single file before anyone goes to the pocket', () => {
  // The fourth person is index 3. With lineSlots 3 they landed in the overflow
  // pocket -- a golden-angle packing, which is why he stood left of the third
  // and behind. The pocket is correct for a full house; four deep is not a full
  // house.
  assert.ok(q.lineSlots >= 6,
    `the line holds ${q.lineSlots}; a fourth customer should still be in single file`);
});

test('every slot the longer line uses is as clear as the layout suite demands', () => {
  // Same rules tests/pine-hills-v2-layout.test.js applies to every stand point.
  // Re-derived here rather than assumed, because lengthening a line into a room
  // is exactly the change that walks somebody into a fixture.
  const cutSet = new Set(L.cutFixtures || []);
  const posed = FIXTURES
    .filter((f) => !cutSet.has(f.id))
    .map((f) => ({ ...f, ...(L.fixturePoses[f.id] || {}) }))
    .filter((f) => L.fixturePoses[f.id]);
  assert.ok(posed.length > 0, 'no posed fixtures resolved - a clearance check with no obstacles cannot fail');

  const rectOf = (fx) => {
    const half = fx.footprint
      ? [
        Math.max(Math.abs(fx.footprint.minX), Math.abs(fx.footprint.maxX)),
        Math.max(Math.abs(fx.footprint.minZ), Math.abs(fx.footprint.maxZ)),
      ]
      : (FIXTURE_HALF[fx.kind] || [0.5, 0.5]);
    const swap = Math.abs(Math.sin(fx.ry || 0)) > 0.5;
    const hx = swap ? half[1] : half[0];
    const hz = swap ? half[0] : half[1];
    return { minX: fx.x - hx, maxX: fx.x + hx, minZ: fx.z - hz, maxZ: fx.z + hz };
  };
  const distToRect = (p, r) => Math.hypot(
    Math.max(r.minX - p.x, 0, p.x - r.maxX),
    Math.max(r.minZ - p.z, 0, p.z - r.maxZ),
  );
  const slot = (i) => {
    const cos = Math.cos(V2.ry);
    const sin = Math.sin(V2.ry);
    const lx = q.headLocal.x + q.pitchLocal.x * i;
    const lz = q.headLocal.z + q.pitchLocal.z * i;
    return { x: V2.x + lx * cos + lz * sin, z: V2.z - lx * sin + lz * cos };
  };
  const B = L.publicBounds;
  const slab = {
    minX: V2.x - V2.frontLength / 2, maxX: V2.x + V2.frontLength / 2,
    minZ: V2.z - V2.frontDepth / 2, maxZ: V2.z + V2.frontDepth / 2,
  };
  const exitLane = { minX: 0.20, maxX: 2.60, minZ: 2.20, maxZ: 5.20 };

  for (let i = 0; i < q.lineSlots; i += 1) {
    const p = slot(i);
    assert.ok(p.x >= B.minX + 0.30 && p.x <= B.maxX - 0.30
      && p.z >= B.minZ + 0.30 && p.z <= B.maxZ - 0.30,
    `line slot ${i} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) is too close to a wall`);
    for (const fx of posed) {
      const gap = distToRect(p, rectOf(fx));
      assert.ok(gap >= 0.30, `line slot ${i} only ${gap.toFixed(2)} yd from ${fx.id}`);
    }
    assert.ok(distToRect(p, slab) >= 0.30, `line slot ${i} presses the desk slab`);
    assert.ok(p.x >= 2.0, `line slot ${i} strays into the west half`);
    if (i > 0) {
      const prev = slot(i - 1);
      assert.ok(!(p.x >= exitLane.minX && p.x <= exitLane.maxX
        && p.z >= exitLane.minZ && p.z <= exitLane.maxZ),
      `line slot ${i} stands in the exit lane`);
      assert.ok(prev.z - p.z > 0.5, `line slot ${i} does not step BACK from the desk`);
      assert.ok(Math.abs(p.x - prev.x) <= 0.30,
        `line slot ${i} drifts sideways - that is a second lane, not a file`);
    }
  }
});
