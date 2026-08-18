// EVERY STOP THE SHOP CAN ISSUE, MEASURED AGAINST WHERE A BODY MAY STAND.
//
// The nav rebuild ended with the ladder still switched on, and the reason was
// written into clubhouse.js at the time: "the solver is not right yet — not
// because it lets people touch, but because 'reachable stop' is not yet its
// problem. The fix is stop geometry." 354 escalations in five minutes, almost
// all of them a walker grinding at a browse point no body could occupy.
//
// This is pure arithmetic on the shipped layout — no renderer, no Electron —
// so it can say WHICH stops are impossible before anyone walks to one. It
// applies the same rules tests/pine-hills-v2-layout.test.js applies to stand
// points, plus the two the browse points were never checked against:
//
//   * the FRONT DESK SLAB, which is not in the fixture table;
//   * a FORMED QUEUE, which is not furniture but occupies floor for minutes at
//     a time. member_station's browse point is the one the report names.
//
// Usage:  node tools/qa/stop-geometry-audit.mjs [--variant pine-hills-v2]
import {
  FIXTURES, FIXTURE_HALF, PINE_HILLS_V2_LAYOUT as L, deriveFrontDeskFrame,
} from '../../src/data/shopLayout.js';

const variant = process.argv.includes('--variant')
  ? process.argv[process.argv.indexOf('--variant') + 1] : 'pine-hills-v2';
const FD = deriveFrontDeskFrame(variant);
const q = L.queue;

// A standing body, and the room the crowd solver insists on around one. These
// mirror clubhouse.js's own constants; if they drift, the audit is measuring a
// different shop from the one that walks.
const BODY_RADIUS = 0.3;          // CUSTOMER_COLLIDER_RADIUS
const NEIGHBOUR_COMFORT = 0.32;   // ORCA comfort band
const WALL_CLEARANCE = 0.30;      // the layout suite's rule for a stand point

const cutSet = new Set(variant === 'pine-hills-v2' ? (L.cutFixtures || []) : []);
const posed = FIXTURES
  .filter((f) => !cutSet.has(f.id))
  .map((f) => ({ ...f, ...((variant === 'pine-hills-v2' && L.fixturePoses[f.id]) || {}) }));

const rectOf = (fx) => {
  const half = fx.footprint
    ? [
      Math.max(Math.abs(fx.footprint.minX), Math.abs(fx.footprint.maxX)),
      Math.max(Math.abs(fx.footprint.minZ), Math.abs(fx.footprint.maxZ)),
    ]
    : (FIXTURE_HALF[fx.kind] || [0.5, 0.5]);
  const swap = Math.abs(Math.sin(fx.ry || 0)) > 0.5;
  return {
    minX: fx.x - (swap ? half[1] : half[0]), maxX: fx.x + (swap ? half[1] : half[0]),
    minZ: fx.z - (swap ? half[0] : half[1]), maxZ: fx.z + (swap ? half[0] : half[1]),
  };
};
const distToRect = (p, r) => Math.hypot(
  Math.max(r.minX - p.x, 0, p.x - r.maxX),
  Math.max(r.minZ - p.z, 0, p.z - r.maxZ),
);
const offsetPoint = (f, off) => {
  const cos = Math.cos(f.ry || 0);
  const sin = Math.sin(f.ry || 0);
  return { x: f.x + off.x * cos + off.z * sin, z: f.z - off.x * sin + off.z * cos };
};
const queueSlot = (i) => {
  const cos = Math.cos(FD.ry);
  const sin = Math.sin(FD.ry);
  const lx = q.headLocal.x + q.pitchLocal.x * i;
  const lz = q.headLocal.z + q.pitchLocal.z * i;
  return { x: FD.x + lx * cos + lz * sin, z: FD.z - lx * sin + lz * cos };
};

const slab = {
  minX: FD.x - FD.frontLength / 2, maxX: FD.x + FD.frontLength / 2,
  minZ: FD.z - FD.frontDepth / 2, maxZ: FD.z + FD.frontDepth / 2,
};
const B = L.publicBounds;
const slots = Array.from({ length: q.lineSlots }, (_, i) => queueSlot(i));

// The verdict for one point. `own` is the fixture the stop belongs to: a browse
// point is SUPPOSED to be close to its own fixture, so its own rect is measured
// but never counted as a blocker.
function judge(point, ownId) {
  const issues = [];
  let worst = Infinity;
  for (const fx of posed) {
    const gap = distToRect(point, rectOf(fx));
    if (fx.id === ownId) continue;
    if (gap < BODY_RADIUS) issues.push({ what: fx.id, kind: 'fixture', gap: +gap.toFixed(3) });
    worst = Math.min(worst, gap);
  }
  const ownGap = ownId
    ? distToRect(point, rectOf(posed.find((f) => f.id === ownId) || { x: 0, z: 0, kind: 'x' }))
    : null;
  const slabGap = distToRect(point, slab);
  if (slabGap < BODY_RADIUS) issues.push({ what: 'frontDeskSlab', kind: 'desk', gap: +slabGap.toFixed(3) });
  const wall = Math.min(
    point.x - B.minX, B.maxX - point.x, point.z - B.minZ, B.maxZ - point.z,
  );
  if (wall < WALL_CLEARANCE) issues.push({ what: 'wall', kind: 'wall', gap: +wall.toFixed(3) });
  // A formed queue is not furniture, but a body in it holds its slot for
  // minutes. Two standing bodies need a body's width plus the solver's comfort
  // band between their centres or neither can reach its own stop.
  const need = BODY_RADIUS * 2 + NEIGHBOUR_COMFORT;
  let queueWorst = Infinity;
  slots.forEach((s, i) => {
    const d = Math.hypot(s.x - point.x, s.z - point.z);
    queueWorst = Math.min(queueWorst, d);
    if (d < need) issues.push({ what: `queueSlot${i}`, kind: 'queue', gap: +d.toFixed(3) });
  });
  return {
    point: { x: +point.x.toFixed(2), z: +point.z.toFixed(2) },
    ownGap: ownGap == null ? null : +ownGap.toFixed(3),
    nearestQueueSlot: +queueWorst.toFixed(3),
    issues,
    legal: issues.length === 0,
  };
}

const rows = [];
for (const f of posed) {
  for (const [kind, list] of [['browse', f.browse || []], ['stock', f.stock || []]]) {
    list.forEach((off, i) => {
      const v = judge(offsetPoint(f, off), f.id);
      rows.push({ fixture: f.id, kind, index: i, ...v });
    });
  }
}

const bad = rows.filter((r) => !r.legal);
const need = BODY_RADIUS * 2 + NEIGHBOUR_COMFORT;
console.log(`variant ${variant} · ${posed.length} fixtures · ${rows.length} stop points`);
console.log(`a standing body needs ${need.toFixed(2)} yd between centres; `
  + `${WALL_CLEARANCE} yd off a wall; ${BODY_RADIUS} yd off a solid\n`);
console.log(`${'fixture'.padEnd(16)}${'kind'.padEnd(8)}${'point'.padEnd(18)}nearestQueue  blockers`);
for (const r of rows) {
  const flag = r.legal ? '   ' : '!! ';
  console.log(`${flag}${r.fixture.padEnd(13)}${r.kind.padEnd(8)}`
    + `${`(${r.point.x}, ${r.point.z})`.padEnd(18)}${String(r.nearestQueueSlot).padStart(6)}        `
    + (r.issues.map((i) => `${i.what}@${i.gap}`).join(' ') || '-'));
}
console.log(`\nILLEGAL STOPS: ${bad.length} of ${rows.length}`);
for (const r of bad) {
  console.log(`  ${r.fixture} ${r.kind}[${r.index}] — ${r.issues.map((i) => `${i.what} ${i.gap} yd`).join(', ')}`);
}
process.exitCode = 0;
