// GOLF EMPIRE — organic course shaping: the shared toolkit both the starting
// course and every marketplace property paint with.
//
// The old generators drew straight waypoint corridors at constant radius, which
// read as parallel rectangular strips from the air. This module replaces that
// with spline-based fairways (variable width, curved centerlines), shaped green
// complexes with fringe collars, rectangular tee boxes squared to the line of
// play, kidney bunkers, first-cut and heavy-rough transition bands, cart-path
// routing, per-hole land movement, and INTENTIONAL vegetation (framing lines,
// clusters, specimen trees, boundary forest) written into course.objects.
//
// Everything is deterministic from the rng that is passed in.

import { ZONE } from './constants.js';
import { idx, inBounds, getZone, setZone } from './course.js';
import { clamp } from '../core/utils.js';

// --- splines -----------------------------------------------------------------

// Catmull-Rom through the waypoints → dense polyline (points every ~step cells).
export function splinePoints(pts, step = 0.75) {
  if (pts.length < 2) return pts.slice();
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let s = 0; s < P.length - 3; s++) {
    const p0 = P[s];
    const p1 = P[s + 1];
    const p2 = P[s + 2];
    const p3 = P[s + 3];
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = Math.max(2, Math.ceil(segLen / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

// Total length of a polyline (cells).
export function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

// A point (and its tangent) at parameter t (0..1 by arc length) along a polyline.
export function pointAlong(pts, t) {
  const total = polylineLength(pts);
  let want = clamp(t, 0, 1) * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (want <= seg || i === pts.length - 1) {
      const k = seg > 1e-9 ? want / seg : 0;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k,
        tx: (pts[i].x - pts[i - 1].x) / (seg || 1),
        ty: (pts[i].y - pts[i - 1].y) / (seg || 1),
      };
    }
    want -= seg;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y, tx: 1, ty: 0 };
}

// --- organic painting ---------------------------------------------------------

function paintSoftDisk(course, cx, cy, r, zone, onlyOver) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (!inBounds(course, x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      if (onlyOver && !onlyOver.has(getZone(course, x, y))) continue;
      setZone(course, x, y, zone);
    }
  }
}

// Paint a corridor along a SPLINE with a per-t radius profile and low-frequency
// edge wobble — the organic fairway painter.
export function paintShapedCorridor(course, waypoints, radiusAt, zone, rng, { onlyOver = null, wobble = 0.5 } = {}) {
  const pts = splinePoints(waypoints, 0.6);
  const total = polylineLength(pts);
  const phase1 = rng.next() * Math.PI * 2;
  const phase2 = rng.next() * Math.PI * 2;
  let walked = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) walked += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const t = total > 0 ? walked / total : 0;
    const base = typeof radiusAt === 'function' ? radiusAt(t) : radiusAt;
    // slow sine wobble (not per-step noise) keeps the edge smooth but irregular
    const w = 1 + wobble * 0.24 * Math.sin(walked * 0.55 + phase1) + wobble * 0.14 * Math.sin(walked * 1.3 + phase2);
    paintSoftDisk(course, pts[i].x, pts[i].y, Math.max(0.8, base * w), zone, onlyOver);
  }
}

// A width profile for a fairway: narrow leaving the tee, generous at the
// landing zone, a strategic pinch, then opening again into the approach.
export function fairwayProfile(rng, par) {
  const landing = 0.55 + rng.next() * 0.12; // where drives land
  const landingR = 2.6 + rng.next() * 0.8;
  const pinch = par >= 5 ? 0.72 + rng.next() * 0.08 : null;
  return (t) => {
    if (t < 0.08) return 1.2; // walk-off from the tee
    if (t > 0.94) return 1.7; // throat into the green
    let r = 2.0 + 0.35 * Math.sin(t * 9); // living edge, never constant
    r += Math.exp(-Math.pow((t - landing) * 5.2, 2)) * (landingR - 2.0);
    if (pinch !== null) r -= Math.exp(-Math.pow((t - pinch) * 8, 2)) * 0.9;
    return Math.max(1.3, r);
  };
}

// A green complex: rotated ellipse (optionally kidney-bitten), fringe collar,
// and a low plateau in the elevation so it reads as a built green.
export function paintGreenComplex(course, cx, cy, rng, {
  r = 2.2, elong = 1.35, angle = null, kidney = null, raise = 1.8,
} = {}) {
  const a = angle === null ? rng.next() * Math.PI : angle;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rx = r * elong;
  const ry = r;
  const bite = kidney === null ? (rng.chance(0.45) ? { bx: rx * 0.9, by: ry * 0.75, br: r * 0.75 } : null) : kidney;
  const reach = Math.ceil(Math.max(rx, ry)) + 1;
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      if (!inBounds(course, x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const lx = dx * ca + dy * sa;
      const ly = -dx * sa + dy * ca;
      let inside = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
      if (inside && bite) {
        const bdx = lx - bite.bx;
        const bdy = ly - bite.by;
        if (bdx * bdx + bdy * bdy < bite.br * bite.br) inside = false;
      }
      if (inside) setZone(course, x, y, ZONE.GREEN);
    }
  }
  // a green must be ONE surface: the kidney bite may have pinched off a lobe.
  // Keep the component containing the pin cell; stray lobes become collar.
  {
    const cx0 = Math.round(cx - reach);
    const cy0 = Math.round(cy - reach);
    const cx1 = Math.round(cx + reach);
    const cy1 = Math.round(cy + reach);
    const px = Math.round(cx);
    const py = Math.round(cy);
    if (getZone(course, px, py) !== ZONE.GREEN) setZone(course, px, py, ZONE.GREEN);
    const keep = new Set([`${px},${py}`]);
    const stack = [[px, py]];
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const k = `${nx},${ny}`;
        if (nx < cx0 || ny < cy0 || nx > cx1 || ny > cy1 || keep.has(k)) continue;
        if (getZone(course, nx, ny) !== ZONE.GREEN) continue;
        keep.add(k);
        stack.push([nx, ny]);
      }
    }
    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        if (getZone(course, x, y) === ZONE.GREEN && !keep.has(`${x},${y}`)) {
          setZone(course, x, y, ZONE.FRINGE);
        }
      }
    }
  }
  // gentle putting-surface plateau
  if (raise > 0) {
    const rr = Math.max(rx, ry) + 2;
    for (let y = Math.floor(cy - rr); y <= Math.ceil(cy + rr); y++) {
      for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
        if (!inBounds(course, x, y)) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        course.elevation[idx(course, x, y)] += clamp(raise * (1 - d / rr), 0, raise);
      }
    }
  }
  return { cx, cy, rx, ry, angle: a };
}

// A tee box: a small rounded rectangle squared to the line of play.
export function paintTeeBox(course, cx, cy, aimX, aimY, { w = 1.4, len = 2.0 } = {}) {
  const a = Math.atan2(aimY - cy, aimX - cx);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const reach = Math.ceil(Math.max(w, len)) + 1;
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      if (!inBounds(course, x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const lx = dx * ca + dy * sa; // along the line of play
      const ly = -dx * sa + dy * ca;
      if (Math.abs(lx) <= len && Math.abs(ly) <= w) setZone(course, x, y, ZONE.TEE);
    }
  }
}

// A bunker: two or three overlapping soft disks → a kidney/cloud blob, with a
// shallow depression captured in the elevation so the renderer carves a bowl.
export function paintBunkerBlob(course, cx, cy, rng, { r = 1.5, depth = 1.6, onlyOver = null } = {}) {
  const sandable = onlyOver || new Set([ZONE.ROUGH, ZONE.FAIRWAY, ZONE.SEMI, ZONE.HEAVY, ZONE.OUT]);
  const lobes = [{ x: cx, y: cy, r }];
  const n = rng.chance(0.65) ? 2 : 3;
  for (let i = 1; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    lobes.push({
      x: cx + Math.cos(a) * r * 0.8,
      y: cy + Math.sin(a) * r * 0.8,
      r: r * (0.55 + rng.next() * 0.35),
    });
  }
  for (const l of lobes) paintSoftDisk(course, l.x, l.y, l.r, ZONE.BUNKER, sandable);
  // sand sits below its lip — the visual bowl comes from this
  const rr = r * 1.9;
  for (let y = Math.floor(cy - rr); y <= Math.ceil(cy + rr); y++) {
    for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
      if (!inBounds(course, x, y)) continue;
      if (getZone(course, x, y) !== ZONE.BUNKER) continue;
      course.elevation[idx(course, x, y)] -= depth;
    }
  }
}

// --- derived transition bands ---------------------------------------------------

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function neighborsHave(course, x, y, zoneSet, ring = N4) {
  for (const [dx, dy] of ring) {
    if (zoneSet.has(getZone(course, x + dx, y + dy))) return true;
  }
  return false;
}

// FRINGE: every non-green cell 4-adjacent to a green becomes collar (a thin
// ring — the crew mows it with the tee units, so acreage stays honest).
export function deriveFringe(course) {
  const greens = new Set([ZONE.GREEN]);
  const collarable = new Set([ZONE.ROUGH, ZONE.FAIRWAY, ZONE.OUT, ZONE.HEAVY, ZONE.SEMI]);
  const marks = [];
  for (let y = 0; y < course.h; y++) {
    for (let x = 0; x < course.w; x++) {
      if (!collarable.has(getZone(course, x, y))) continue;
      if (neighborsHave(course, x, y, greens, N4)) marks.push([x, y]);
    }
  }
  for (const [x, y] of marks) setZone(course, x, y, ZONE.FRINGE);
}

// FIRST CUT: rough cells hugging the fairway get the intermediate mow.
export function deriveFirstCut(course) {
  const fw = new Set([ZONE.FAIRWAY]);
  const marks = [];
  for (let y = 0; y < course.h; y++) {
    for (let x = 0; x < course.w; x++) {
      if (getZone(course, x, y) !== ZONE.ROUGH) continue;
      if (neighborsHave(course, x, y, fw, N8)) marks.push([x, y]);
    }
  }
  for (const [x, y] of marks) setZone(course, x, y, ZONE.SEMI);
}

// HEAVY ROUGH: a soft band where mown rough meets untended land, so the course
// fades into the property instead of stopping at a hard line.
export function deriveHeavyBand(course, rng) {
  const rough = new Set([ZONE.ROUGH]);
  const marks = [];
  for (let y = 0; y < course.h; y++) {
    for (let x = 0; x < course.w; x++) {
      if (getZone(course, x, y) !== ZONE.OUT) continue;
      if (neighborsHave(course, x, y, rough, N8)) marks.push([x, y]);
    }
  }
  for (const [x, y] of marks) setZone(course, x, y, ZONE.HEAVY);
  // second, broken ring for a ragged native edge
  const heavy = new Set([ZONE.HEAVY]);
  const marks2 = [];
  for (let y = 0; y < course.h; y++) {
    for (let x = 0; x < course.w; x++) {
      if (getZone(course, x, y) !== ZONE.OUT) continue;
      if (neighborsHave(course, x, y, heavy) && rng.chance(0.55)) marks2.push([x, y]);
    }
  }
  for (const [x, y] of marks2) setZone(course, x, y, ZONE.HEAVY);
}

// --- cart paths ------------------------------------------------------------------

// Route a cart path offset alongside each hole (tee → green), then connect each
// green to the next tee. Writes course.paths AND paints PATH cells beneath.
export function routeCartPaths(course, specs, rng) {
  const off = 1.6; // cells to the side of the playing line
  const side = rng.chance(0.5) ? 1 : -1;
  const allPts = [];
  for (let h = 0; h < specs.length; h++) {
    const s = specs[h];
    const line = splinePoints([s.tee, ...(s.wp || []), s.pin], 2.2);
    for (let i = 0; i < line.length; i++) {
      const t = i / Math.max(1, line.length - 1);
      const p = pointAlong(line, t);
      // path hugs the corridor, drifting a little; skips the green pad itself
      const k = side * (off + Math.sin(t * 5 + h) * 0.5);
      allPts.push({ x: p.x - p.ty * k, y: p.y + p.tx * k });
    }
    if (h < specs.length - 1) {
      const next = specs[h + 1];
      allPts.push({ x: (s.pin.x + next.tee.x) / 2 + (rng.next() - 0.5) * 2, y: (s.pin.y + next.tee.y) / 2 + (rng.next() - 0.5) * 2 });
    }
  }
  // thin the polyline so the stored path has editable, well-spaced points
  const pts = [];
  for (let i = 0; i < allPts.length; i++) {
    const p = allPts[i];
    if (!inBounds(course, Math.round(p.x), Math.round(p.y))) continue;
    if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) > 3.2) pts.push(p);
  }
  if (pts.length < 2) return;
  const path = { id: course.nextPathId++, pts, width: 2.6, material: 'asphalt' };
  course.paths.push(path);
  paintPathCells(course, path);
}

// Paint the PATH zone cells under a stored path spline (over grass only —
// greens, tees, bunkers and water refuse pavement).
export function paintPathCells(course, path) {
  const paveable = new Set([ZONE.OUT, ZONE.ROUGH, ZONE.HEAVY, ZONE.SEMI, ZONE.FAIRWAY, ZONE.FRINGE, ZONE.DIRT]);
  const line = splinePoints(path.pts, 0.5);
  const r = Math.max(0.5, (path.width / 8) * 0.5 + 0.15); // width yd → cell radius
  for (const p of line) paintSoftDisk(course, p.x, p.y, r, ZONE.PATH, paveable);
}

// --- per-hole land movement ---------------------------------------------------------

// Give each hole real golf features: an elevated tee, a settling valley or a
// climbing approach, and a raised green (painted by paintGreenComplex).
export function shapeHoleElevation(course, specs, rng) {
  for (const s of specs) {
    const line = splinePoints([s.tee, ...(s.wp || []), s.pin], 1.5);
    const mode = rng.int(3); // 0 falls, 1 climbs, 2 rolls through a swale
    const amp = 2 + rng.next() * 2.5;
    for (let i = 0; i < line.length; i++) {
      const t = i / Math.max(1, line.length - 1);
      const p = line[i];
      let d = 0;
      if (mode === 0) d = (1 - t) * amp * 0.5; // tee sits high, green low
      else if (mode === 1) d = t * amp * 0.5; // climbing hole
      else d = -Math.sin(t * Math.PI) * amp * 0.4; // swale mid-hole
      const rr = 5;
      for (let y = Math.floor(p.y - rr); y <= Math.ceil(p.y + rr); y++) {
        for (let x = Math.floor(p.x - rr); x <= Math.ceil(p.x + rr); x++) {
          if (!inBounds(course, x, y)) continue;
          const dd = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
          if (dd > rr) continue;
          const fall = 1 - dd / rr;
          course.elevation[idx(course, x, y)] += d * fall * 0.28;
        }
      }
    }
    // tees always sit a touch proud
    const tr = 3;
    for (let y = Math.floor(s.tee.y - tr); y <= Math.ceil(s.tee.y + tr); y++) {
      for (let x = Math.floor(s.tee.x - tr); x <= Math.ceil(s.tee.x + tr); x++) {
        if (!inBounds(course, x, y)) continue;
        const dd = Math.hypot(x + 0.5 - s.tee.x, y + 0.5 - s.tee.y);
        course.elevation[idx(course, x, y)] += clamp(1.6 * (1 - dd / tr), 0, 1.6);
      }
    }
  }
}

// --- vegetation ------------------------------------------------------------------

export const TREE_TYPES = {
  deciduous: ['tree_default', 'tree_oak', 'tree_detailed', 'tree_fat'],
  pine: ['tree_pineDefaultA', 'tree_pineRoundB'],
};

const IN_PLAY = new Set([
  ZONE.ROUGH, ZONE.FAIRWAY, ZONE.GREEN, ZONE.TEE, ZONE.BUNKER,
  ZONE.WATER, ZONE.PATH, ZONE.FRINGE, ZONE.SEMI,
]);

// Distance (in cells, chebyshev, capped) from each cell to the nearest in-play
// cell — the planting logic's "how far from golf am I" question.
function playDistanceField(course, cap = 6) {
  const { w, h, zones } = course;
  const dist = new Int8Array(w * h).fill(cap);
  const queue = [];
  for (let i = 0; i < w * h; i++) {
    if (IN_PLAY.has(zones[i])) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const d = dist[i];
    if (d >= cap) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] > d + 1) {
        dist[ni] = d + 1;
        queue.push(ni);
      }
    }
  }
  return dist;
}

function plantable(course, x, y) {
  if (!inBounds(course, Math.round(x), Math.round(y))) return false;
  const z = getZone(course, Math.round(x), Math.round(y));
  return z === ZONE.OUT || z === ZONE.HEAVY || z === ZONE.ROUGH;
}

function structureClear(course, x, y, pad = 3) {
  for (const s of course.structures) {
    if (x >= s.x - pad && x <= s.x + s.w + pad && y >= s.y - pad && y <= s.y + s.h + pad + 2) return false;
  }
  return true;
}

function addTree(course, rng, x, y, { pinePreference = 0.3, scaleMin = 0.85, scaleMax = 1.25 } = {}) {
  if (!plantable(course, x, y) || !structureClear(course, x, y)) return null;
  const pine = rng.chance(pinePreference);
  const pool = pine ? TREE_TYPES.pine : TREE_TYPES.deciduous;
  const obj = {
    id: course.nextObjectId++,
    type: pool[rng.int(pool.length)],
    x: x + (rng.next() - 0.5) * 0.7,
    y: y + (rng.next() - 0.5) * 0.7,
    rot: rng.next() * Math.PI * 2,
    scale: scaleMin + rng.next() * (scaleMax - scaleMin),
  };
  course.objects.push(obj);
  return obj;
}

// Intentional planting:
//  - framing lines along fairway edges (with gaps — sightlines stay open)
//  - clustered groves in the land between holes (clumps, not noise)
//  - specimen trees on dogleg corners
//  - a dense boundary forest band around the whole property
export function plantVegetation(course, specs, rng, { density = 1 } = {}) {
  const dist = playDistanceField(course, 6);
  const { w, h } = course;

  // 1. framing lines: cells 1–2 out from play, planted in runs with gaps
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = dist[y * w + x];
      if (d < 1 || d > 2) continue;
      // low-frequency gate makes RUNS of trees with real gaps, not salt noise
      const gate = Math.sin(x * 0.55 + y * 0.31) + Math.sin(x * 0.17 - y * 0.43);
      if (gate > 0.55 && rng.chance(0.5 * density)) {
        addTree(course, rng, x, y, { pinePreference: 0.25 });
      }
    }
  }

  // 2. interior groves: clump seeds far from play, 3–7 trees each, meadows between
  const groveSeeds = [];
  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const d = dist[y * w + x];
      if (d >= 4 && rng.chance(0.05 * density)) groveSeeds.push({ x, y });
    }
  }
  for (const g of groveSeeds) {
    const n = 3 + rng.int(5);
    const pine = rng.chance(0.4); // groves lean one species — reads as planted stands
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = 0.6 + rng.next() * 2.6;
      addTree(course, rng, g.x + Math.cos(a) * r, g.y + Math.sin(a) * r, {
        pinePreference: pine ? 0.85 : 0.12,
      });
    }
  }

  // 3. specimen trees at dogleg corners (the strategic tree you aim over/around)
  for (const s of specs) {
    for (const wp of s.wp || []) {
      const a = rng.next() * Math.PI * 2;
      const t = addTree(course, rng, wp.x + Math.cos(a) * 3.4, wp.y + Math.sin(a) * 3.4, {
        pinePreference: 0.1, scaleMin: 1.25, scaleMax: 1.55,
      });
      if (!t) continue;
    }
  }

  // 4. boundary forest: a deep band just inside the property line
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge > 3) continue;
      const d = dist[y * w + x];
      if (d < 2) continue; // never wall off a hole that runs near the line
      const p = edge === 0 ? 0.55 : edge === 1 ? 0.42 : edge === 2 ? 0.26 : 0.14;
      if (rng.chance(p * density)) {
        addTree(course, rng, x, y, { pinePreference: 0.45, scaleMin: 0.95, scaleMax: 1.45 });
      }
    }
  }
}

// --- the finishing pass -----------------------------------------------------------

// Everything a painted course needs to stop looking like zone-fill: transition
// bands, cart paths, per-hole land movement (call before pads are re-flattened),
// and intentional vegetation.
export function finishCourse(course, specs, rng, { density = 1, paths = true } = {}) {
  deriveFringe(course);
  deriveFirstCut(course);
  deriveHeavyBand(course, rng);
  if (paths) routeCartPaths(course, specs, rng);
  plantVegetation(course, specs, rng, { density });
}
