// P1 (owner playtest) — "at four deep the line stops being a line".
//
// The fourth person is queue index 3, and lineSlots is 3, so index 3 falls into
// the OVERFLOW POCKET: a golden-angle sunflower packing around (4.35, 0.70).
// That is why he stood left of the third and behind. It is by design, not a bug
// in the walking.
//
// The stated reason for holding the line at three is at shopLayout.js:369 --
// "the face runs out at member_station, so the line holds three". That sentence
// belongs to the 2026-07-28 EAST re-pitch, which ran the line sideways along the
// desk face. B1 (Goal 19) SUPERSEDED that and re-pitched the line SOUTH into the
// open floor. The cap was never re-derived for the new direction.
//
// So this asks the geometry, using the SAME clearance rules the shipped layout
// suite enforces on every stand point: how many single-file slots actually fit
// before one of them presses a fixture, a wall, the desk slab, or the exit lane?
//
//   node tools/qa/node/p1-queue-linelength.mjs
import {
  PINE_HILLS_V2_LAYOUT as L, FIXTURES, FIXTURE_HALF, deriveFrontDeskFrame,
} from '../../../src/data/shopLayout.js';

// Same handles the shipped layout suite uses, so this measures what that suite
// measures rather than a private copy of the room.
const V2 = deriveFrontDeskFrame('pine-hills-v2');
const B = L.publicBounds;
const q = L.queue;

// the line, extended past the current cap, in room coordinates
function lineSlot(i) {
  const f = V2;
  const cos = Math.cos(f.ry);
  const sin = Math.sin(f.ry);
  const lx = q.headLocal.x + q.pitchLocal.x * i;
  const lz = q.headLocal.z + q.pitchLocal.z * i;
  return { x: f.x + lx * cos + lz * sin, z: f.z - lx * sin + lz * cos };
}

// FIXTURE_HALF entries are [halfX, halfZ] ARRAYS, and the base FIXTURES table is
// in the BASE room's coordinates -- its first entry sits at x -8.55, four yards
// outside this room. Measuring against that list found no fixture within reach
// of any slot and cheerfully reported that nine fit. An empty or misplaced
// obstacle set makes a clearance check unfalsifiable, so the poses are applied
// exactly as tests/pine-hills-v2-layout.test.js applies them, and the run aborts
// below if the obstacle list comes back empty.
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
const distToRect = (p, r) => {
  const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX);
  const dz = Math.max(r.minZ - p.z, 0, p.z - r.maxZ);
  return Math.hypot(dx, dz);
};
const inBounds = (p, b, pad = 0) => p.x >= b.minX + pad && p.x <= b.maxX - pad
  && p.z >= b.minZ + pad && p.z <= b.maxZ - pad;

const slab = {
  minX: V2.x - V2.frontLength / 2, maxX: V2.x + V2.frontLength / 2,
  minZ: V2.z - V2.frontDepth / 2, maxZ: V2.z + V2.frontDepth / 2,
};
const exitLane = { minX: 0.20, maxX: 2.60, minZ: 2.20, maxZ: 5.20 };

const cutSet = new Set(L.cutFixtures || []);
const fixtures = FIXTURES
  .filter((f) => !cutSet.has(f.id))
  .map((f) => ({ ...f, ...(L.fixturePoses[f.id] || {}) }))
  .filter((f) => f && f.x != null && f.z != null && L.fixturePoses[f.id]);
if (fixtures.length === 0) {
  console.error('ABORT: no v2-posed fixtures resolved; a clearance check with no obstacles cannot fail');
  process.exit(2);
}

const rows = [];
for (let i = 0; i < 9; i += 1) {
  const p = lineSlot(i);
  const prev = i > 0 ? lineSlot(i - 1) : null;
  let worstFixture = null;
  let worstGap = Infinity;
  for (const fx of fixtures) {
    const g = distToRect(p, rectOf(fx));
    if (g < worstGap) { worstGap = g; worstFixture = fx.id || fx.kind || '?'; }
  }
  const failures = [];
  if (!inBounds(p, B, 0.30)) failures.push('wall');
  if (Number.isFinite(worstGap) && worstGap < 0.30) failures.push(`fixture:${worstFixture}(${worstGap.toFixed(2)})`);
  if (distToRect(p, slab) < 0.30) failures.push('desk-slab');
  if (i > 0 && inBounds(p, exitLane)) failures.push('exit-lane');
  if (p.x < 2.0) failures.push('west-half');
  if (prev) {
    const spacing = Math.hypot(p.x - prev.x, p.z - prev.z);
    if (!(prev.z - p.z > 0.5)) failures.push('does-not-step-back');
    if (Math.abs(p.x - prev.x) > 0.30) failures.push('sideways-drift');
    if (!(spacing >= 0.60 && spacing <= 1.00)) failures.push(`spacing:${spacing.toFixed(2)}`);
  }
  rows.push({
    i,
    x: +p.x.toFixed(2),
    z: +p.z.toFixed(2),
    nearestFixture: worstFixture,
    fixtureGap: Number.isFinite(worstGap) ? +worstGap.toFixed(2) : null,
    slabGap: +distToRect(p, slab).toFixed(2),
    ok: failures.length === 0,
    failures,
  });
}

let fits = 0;
for (const r of rows) { if (!r.ok) break; fits += 1; }

console.log(JSON.stringify({
  currentLineSlots: q.lineSlots,
  slotsThatActuallyFitInSingleFile: fits,
  rows,
  verdict: fits > q.lineSlots
    ? `the line could hold ${fits} in single file; it is capped at ${q.lineSlots}`
    : `the cap of ${q.lineSlots} is what the geometry allows`,
}, null, 2));
