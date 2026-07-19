// GOLF EMPIRE — the vector course: authored splines are the design truth,
// everything else (hi-res visual masks, the sim cell grid, terrain relief)
// derives from them.
//
// The 120×80 simulation grid stays authoritative for GAMEPLAY (turf state,
// maintenance costs, lies, golfer AI, save compatibility) — but it stopped
// being the design source. course.vec holds the shapes a golf architect
// actually draws: hole centerlines with width profiles, closed green /
// bunker / water boundaries, oriented tee pads, path splines, mounds.
// One rasterizer turns those into a categorical field at ANY resolution:
// 16 texels/cell (0.5 yd) for rendering, 1 sample/cell for course.zones.
//
// Pure data + math: runs in node tests and in the browser.
//
// Units: positions are CELL coordinates (floats — 1 cell = 8 yd);
// authored widths/depths are YARDS/FEET where noted (design-meaningful).

import { ZONE, CELL_YD, HOLE_STATUS } from './constants.js';
import { clamp } from '../core/utils.js';

export const VEC_VERSION = 1;

// ---------------------------------------------------------------- schema ----

export function emptyVec(seed = 7) {
  return {
    v: VEC_VERSION,
    seed,               // stable per property: drives edge warp + mow phase
    holes: [],          // [{ id, par, line:[{x,y}], width:[{t,w(yd half)}], tees:[], green:{}, bunkers:[], roughW, mowDir }]
    waters: [],         // [{ id, kind:'pond'|'lake', pts:[{x,y}closed], depth }]
    streams: [],        // [{ id, pts:[{x,y}open], w(yd) }]
    beds: [],           // [{ id, pts:[closed] }] landscaping beds
    mounds: [],         // [{ id, x, y, r(cells), h(ft) }] authored land features
    nextId: 1,
  };
}

export function vecId(vec) {
  return vec.nextId++;
}

// hole feature builders (used by the architect + editor tools)
export function makeVecTee(x, y, rot, tier, wYd = 8, dYd = 10) {
  return { x, y, rot, tier, w: wYd, d: dYd };
}

export function makeVecGreen(cx, cy, rYd, elong, angle, seed, authoredOutline = null) {
  // Most greens use ten seeded points around a rotated ellipse. Hero greens can
  // instead provide a normalized [across, front] outline: the same spline path
  // and SDF pipeline smooths it, while the architect controls its silhouette
  // without spending RNG draws or changing the serialized vector schema.
  const pts = [];
  const rc = rYd / CELL_YD;
  const outline = Array.isArray(authoredOutline) && authoredOutline.length >= 8
    ? authoredOutline.filter((point) => (
      Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
    ))
    : null;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  if (outline?.length >= 8) {
    for (const [across, front] of outline) {
      const ex = across * rc * elong;
      const ey = front * rc;
      pts.push({ x: cx + ex * ca - ey * sa, y: cy + ex * sa + ey * ca });
    }
    return { cx, cy, pts, fringe: 1.0, raise: 1.6, pins: [] };
  }

  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = 0.82 + 0.30 * hashN(seed * 31 + i * 7.13);
    const rx = rc * elong * j;
    const ry = rc * j;
    const ex = Math.cos(a) * rx;
    const ey = Math.sin(a) * ry;
    pts.push({ x: cx + ex * ca - ey * sa, y: cy + ex * sa + ey * ca });
  }
  return { cx, cy, pts, fringe: 1.0, raise: 1.6, pins: [] };
}

export function makeVecBunker(cx, cy, rYd, seed, { depth = 2.4, lobes = 3, stretch = 1.0, angle = 0 } = {}) {
  // Freeform lobed silhouette: enough irregularity for a hand-shaped
  // cloud/kidney, but with a bounded radius so neighboring vertices cannot
  // pinch around a false turf island or form an unmaintainable sand neck.
  const pts = [];
  const n = 8 + Math.floor(hashN(seed * 17.7) * 4);
  const rc = rYd / CELL_YD;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const lobe = Math.sin(a * lobes + seed) * 0.18;
    const j = 0.74 + 0.38 * hashN(seed * 13 + i * 3.7) + lobe;
    const ex = Math.cos(a) * rc * j * stretch;
    const ey = Math.sin(a) * rc * j;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    pts.push({ x: cx + ex * ca - ey * sa, y: cy + ex * sa + ey * ca });
  }
  return { pts, depth, lip: 0.9 };
}

export function makeVecPond(cx, cy, rxYd, ryYd, seed, kind = 'pond', angle = 0) {
  const pts = [];
  const n = 12;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = 0.72 + 0.42 * hashN(seed * 23 + i * 5.3);
    const ex = Math.cos(a) * (rxYd / CELL_YD) * j;
    const ey = Math.sin(a) * (ryYd / CELL_YD) * j;
    pts.push({
      x: cx + ex * ca - ey * sa,
      y: cy + ex * sa + ey * ca,
    });
  }
  return { kind, pts, depth: 4.5 };
}

// ------------------------------------------------------------- rng / noise ----

function hashN(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

// smooth value noise in cell space (resolution-independent → the warp looks
// identical whether sampled for the sim grid or the 0.5-yd visual field)
function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

function fbm2(x, y) {
  return vnoise(x, y) * 0.65 + vnoise(x * 2.13 + 17.7, y * 2.13 - 9.1) * 0.35;
}

// ------------------------------------------------------------ spline sampling ----

// Catmull-Rom through control points → dense polyline. step in cells.
export function sampleOpen(pts, step = 0.35) {
  if (!pts || pts.length < 2) return (pts || []).map((p) => ({ ...p }));
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

// closed Catmull-Rom loop → polygon (first point NOT repeated at the end)
export function sampleClosed(pts, step = 0.3) {
  if (!pts || pts.length < 3) return (pts || []).map((p) => ({ ...p }));
  const n = pts.length;
  const out = [];
  for (let s = 0; s < n; s++) {
    const p0 = pts[(s - 1 + n) % n];
    const p1 = pts[s];
    const p2 = pts[(s + 1) % n];
    const p3 = pts[(s + 2) % n];
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const k = Math.max(2, Math.ceil(segLen / step));
    for (let i = 0; i < k; i++) {
      const t = i / k;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

export function polyLength(poly, closed = false) {
  let len = 0;
  for (let i = 1; i < poly.length; i++) len += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
  if (closed && poly.length > 2) {
    len += Math.hypot(poly[0].x - poly[poly.length - 1].x, poly[0].y - poly[poly.length - 1].y);
  }
  return len;
}

// point + unit tangent at arc-length parameter t (0..1) along an open polyline
export function alongPoly(poly, t) {
  const total = polyLength(poly);
  let want = clamp(t, 0, 1) * total;
  for (let i = 1; i < poly.length; i++) {
    const seg = Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
    if (want <= seg || i === poly.length - 1) {
      const k = seg > 1e-9 ? want / seg : 0;
      return {
        x: poly[i - 1].x + (poly[i].x - poly[i - 1].x) * k,
        y: poly[i - 1].y + (poly[i].y - poly[i - 1].y) * k,
        tx: (poly[i].x - poly[i - 1].x) / (seg || 1),
        ty: (poly[i].y - poly[i - 1].y) / (seg || 1),
      };
    }
    want -= seg;
  }
  const last = poly[poly.length - 1];
  return { x: last.x, y: last.y, tx: 1, ty: 0 };
}

// ------------------------------------------------------------------ geometry ----

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + dx * t);
  const ey = py - (ay + dy * t);
  return { d2: ex * ex + ey * ey, t };
}

// signed distance to a polygon (cells) — negative inside. Even-odd inside test.
export function polygonSDF(px, py, poly) {
  let d2 = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const r = segDist2(px, py, a.x, a.y, b.x, b.y);
    if (r.d2 < d2) d2 = r.d2;
    if ((a.y > py) !== (b.y > py)
      && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y + ((b.y - a.y) === 0 ? 1e-12 : 0)) + a.x) {
      inside = !inside;
    }
  }
  const d = Math.sqrt(d2);
  return inside ? -d : d;
}

// distance to an open polyline + arc-length parameter of the closest point.
// arcs[] must be the prefix arc lengths (arcs[i] = length up to vertex i).
export function polylineDistT(px, py, poly, arcs) {
  let best = Infinity;
  let bestT = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const r = segDist2(px, py, a.x, a.y, b.x, b.y);
    if (r.d2 < best) {
      best = r.d2;
      bestT = arcs[i - 1] + (arcs[i] - arcs[i - 1]) * r.t;
    }
  }
  const total = arcs[arcs.length - 1] || 1;
  return { d: Math.sqrt(best), t: bestT / total };
}

function prefixArcs(poly) {
  const arcs = new Float32Array(poly.length);
  for (let i = 1; i < poly.length; i++) {
    arcs[i] = arcs[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
  }
  return arcs;
}

function bboxOfPoly(poly, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

// oriented-rectangle SDF (tee pads): center, rotation, half extents in cells
function rectSDF(px, py, tee) {
  const hw = (tee.w / CELL_YD) / 2;
  const hd = (tee.d / CELL_YD) / 2;
  const ca = Math.cos(tee.rot);
  const sa = Math.sin(tee.rot);
  const dx = px - tee.x;
  const dy = py - tee.y;
  const lx = Math.abs(dx * ca + dy * sa) - hd;   // along play direction
  const ly = Math.abs(-dx * sa + dy * ca) - hw;  // across
  const ox = Math.max(lx, 0);
  const oy = Math.max(ly, 0);
  const outside = Math.hypot(ox, oy);
  const insideD = Math.min(Math.max(lx, ly), 0);
  // rounded corners: subtract a small radius so pads never look die-cut
  return outside + insideD - 0.12;
}

// width profile lookup: stops [{t, w(yd half-width)}] → half-width in CELLS at t
function widthAt(stops, t) {
  if (!stops || !stops.length) return 2.2;
  if (t <= stops[0].t) return stops[0].w / CELL_YD;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      const a = stops[i - 1];
      const b = stops[i];
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      const s = k * k * (3 - 2 * k); // smoothstep between stops — no kinks
      return (a.w + (b.w - a.w) * s) / CELL_YD;
    }
  }
  return stops[stops.length - 1].w / CELL_YD;
}

// ------------------------------------------------------- geometry pack (cache) ----

// Sampled/derived geometry for fast repeated evaluation. Rebuild whenever
// course.vec changes (editor ops call invalidateGeom).
const geomCache = new WeakMap();

export function invalidateGeom(course) {
  geomCache.delete(course);
}

export function getGeom(course) {
  let g = geomCache.get(course);
  if (g && g.rev === course.vec && g.pathsRev === course.paths) return g;
  g = buildGeom(course.vec, course.w, course.h, course.paths || []);
  g.rev = course.vec;
  g.pathsRev = course.paths;
  geomCache.set(course, g);
  return g;
}

function buildGeom(vec, W, H, coursePaths) {
  const holes = (vec.holes || []).map((h) => {
    const line = sampleOpen(h.line, 0.35);
    const arcs = prefixArcs(line);
    const greenPoly = h.green ? sampleClosed(h.green.pts, 0.3) : null;
    const maxW = h.width ? h.width.reduce((m, s) => Math.max(m, s.w), 0) / CELL_YD : 0;
    return {
      ref: h,
      line,
      arcs,
      lenYd: arcs[arcs.length - 1] * CELL_YD,
      width: h.width,
      maxW,
      bbox: bboxOfPoly(line, 4.5),
      green: h.green,
      greenPoly,
      greenBbox: greenPoly ? bboxOfPoly(greenPoly, 4.5) : null,
      tees: h.tees || [],
      bunkers: (h.bunkers || []).map((b) => {
        const poly = sampleClosed(b.pts, 0.3);
        // estimate the bowl's inradius from the centroid — depth easing uses it
        let cx = 0, cy = 0;
        for (const p of poly) { cx += p.x; cy += p.y; }
        cx /= poly.length; cy /= poly.length;
        const inR = Math.max(0.25, -polygonSDF(cx, cy, poly));
        return { ref: b, poly, bbox: bboxOfPoly(poly, 1.6), inR, cx, cy };
      }),
      roughW: (h.roughW || 26) / CELL_YD, // mown rough half-width beyond fairway edge
    };
  });
  const waters = (vec.waters || []).map((w) => {
    const poly = sampleClosed(w.pts, 0.25);
    return { ref: w, poly, bbox: bboxOfPoly(poly, 2.2) };
  });
  const streams = (vec.streams || []).map((s) => {
    const poly = sampleOpen(s.pts, 0.3);
    return { ref: s, poly, arcs: prefixArcs(poly), w: (s.w || 4) / CELL_YD, bbox: bboxOfPoly(poly, 1.5) };
  });
  const beds = (vec.beds || []).map((b) => {
    const poly = sampleClosed(b.pts, 0.3);
    return { ref: b, poly, bbox: bboxOfPoly(poly, 0.8) };
  });
  const mounds = (vec.mounds || []).map((m) => ({ ref: m, bbox: { x0: m.x - m.r, y0: m.y - m.r, x1: m.x + m.r, y1: m.y + m.r } }));
  const paths = coursePaths.map((p) => {
    const poly = sampleOpen(p.pts, 0.3);
    return { ref: p, poly, arcs: prefixArcs(poly), w: (p.width || 3.2) / CELL_YD, bbox: bboxOfPoly(poly, 1.2) };
  });
  const lawns = (vec.lawns || []); // ornamental putting/tee lawns near the clubhouse

  // coarse spatial bins (4×4 cells) so evaluation only touches nearby features
  const BIN = 4;
  const bw = Math.ceil(W / BIN);
  const bh = Math.ceil(H / BIN);
  const bins = new Array(bw * bh);
  const insert = (bbox, entry) => {
    const bx0 = clamp(Math.floor(bbox.x0 / BIN), 0, bw - 1);
    const by0 = clamp(Math.floor(bbox.y0 / BIN), 0, bh - 1);
    const bx1 = clamp(Math.floor(bbox.x1 / BIN), 0, bw - 1);
    const by1 = clamp(Math.floor(bbox.y1 / BIN), 0, bh - 1);
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const i = by * bw + bx;
        (bins[i] || (bins[i] = [])).push(entry);
      }
    }
  };
  holes.forEach((h, i) => {
    insert(h.bbox, { kind: 'hole', i });
    if (h.greenBbox) insert(h.greenBbox, { kind: 'green', i });
    h.tees.forEach((t, j) => insert({
      x0: t.x - 2.2, y0: t.y - 2.2, x1: t.x + 2.2, y1: t.y + 2.2,
    }, { kind: 'tee', i, j }));
    h.bunkers.forEach((b, j) => insert(b.bbox, { kind: 'bunker', i, j }));
  });
  waters.forEach((w, i) => insert(w.bbox, { kind: 'water', i }));
  streams.forEach((s, i) => insert(s.bbox, { kind: 'stream', i }));
  beds.forEach((b, i) => insert(b.bbox, { kind: 'bed', i }));
  mounds.forEach((m, i) => insert(m.bbox, { kind: 'mound', i }));
  paths.forEach((p, i) => insert(p.bbox, { kind: 'path', i }));
  lawns.forEach((t, j) => insert({
    x0: t.x - 2.2, y0: t.y - 2.2, x1: t.x + 2.2, y1: t.y + 2.2,
  }, { kind: 'lawn', j }));

  // ---- per-bin SEGMENT lists: the evaluator's hot path never walks a whole
  // polyline — it only measures the handful of segments near its bin.
  // fairSegs reach far (the graded-rough question is asked up to ~8.5 cells
  // out); path/stream segments only need their own width + warp margin.
  const fairSegs = new Array(bw * bh);
  const pathSegs = new Array(bw * bh);
  const insertSeg = (store, ax, ay, bx, by, pad, seg) => {
    const bx0 = clamp(Math.floor((Math.min(ax, bx) - pad) / BIN), 0, bw - 1);
    const by0 = clamp(Math.floor((Math.min(ay, by) - pad) / BIN), 0, bh - 1);
    const bx1 = clamp(Math.floor((Math.max(ax, bx) + pad) / BIN), 0, bw - 1);
    const by1 = clamp(Math.floor((Math.max(ay, by) + pad) / BIN), 0, bh - 1);
    for (let by2 = by0; by2 <= by1; by2++) {
      for (let bx2 = bx0; bx2 <= bx1; bx2++) {
        const i = by2 * bw + bx2;
        (store[i] || (store[i] = [])).push(seg);
      }
    }
  };
  holes.forEach((h, hi) => {
    if (!h.width) return;
    const step = 0.9; // coarser polyline for distance queries — warp adds the life
    const line = sampleOpen(h.ref.line, step);
    const arcs = prefixArcs(line);
    const total = arcs[arcs.length - 1] || 1;
    const pad = h.maxW + 8.6; // rough + heavy band reach
    for (let i = 1; i < line.length; i++) {
      insertSeg(fairSegs, line[i - 1].x, line[i - 1].y, line[i].x, line[i].y, pad, {
        hi,
        ax: line[i - 1].x, ay: line[i - 1].y, bx: line[i].x, by: line[i].y,
        t0: arcs[i - 1] / total, t1: arcs[i] / total,
      });
    }
  });
  paths.forEach((p, pi) => {
    const pad = p.w / 2 + 1.4;
    for (let i = 1; i < p.poly.length; i++) {
      insertSeg(pathSegs, p.poly[i - 1].x, p.poly[i - 1].y, p.poly[i].x, p.poly[i].y, pad, {
        pi, ax: p.poly[i - 1].x, ay: p.poly[i - 1].y, bx: p.poly[i].x, by: p.poly[i].y, w: p.w,
      });
    }
  });
  streams.forEach((s, si) => {
    const pad = s.w / 2 + 1.4;
    for (let i = 1; i < s.poly.length; i++) {
      insertSeg(pathSegs, s.poly[i - 1].x, s.poly[i - 1].y, s.poly[i].x, s.poly[i].y, pad, {
        si, ax: s.poly[i - 1].x, ay: s.poly[i - 1].y, bx: s.poly[i].x, by: s.poly[i].y, w: s.w, stream: true,
      });
    }
  });

  // ---- shared warp lattice at quarter-cell resolution: one smooth vector
  // field + one ragged-edge channel, bilinearly sampled by every evaluation.
  const seed = vec.seed || 7;
  const WS = 4;
  const ww = W * WS + 1;
  const wh = H * WS + 1;
  const warpX = new Float32Array(ww * wh);
  const warpY = new Float32Array(ww * wh);
  const warpR = new Float32Array(ww * wh);
  for (let y = 0; y < wh; y++) {
    const gy = y / WS;
    for (let x = 0; x < ww; x++) {
      const gx = x / WS;
      const o = y * ww + x;
      warpX[o] = (fbm2(gx * 0.55 + seed * 11.3, gy * 0.55 + seed * 7.7) - 0.5) * 2;
      warpY[o] = (fbm2(gx * 0.55 - seed * 5.1, gy * 0.55 + seed * 13.9) - 0.5) * 2;
      warpR[o] = (fbm2(gx * 0.23 + seed * 3.1, gy * 0.23 - seed * 1.7) - 0.5) * 2.4;
    }
  }

  return {
    holes, waters, streams, beds, mounds, paths, lawns, bins, bw, bh, BIN,
    fairSegs, pathSegs, warpX, warpY, warpR, ww, wh, WS, seed,
  };
}

// bilinear sample of the warp lattice (channel: 0 = x, 1 = y, 2 = rag)
function warpSample(geom, arr, px, py) {
  const fx = clamp(px * geom.WS, 0, geom.ww - 1.001);
  const fy = clamp(py * geom.WS, 0, geom.wh - 1.001);
  const ix = fx | 0;
  const iy = fy | 0;
  const ux = fx - ix;
  const uy = fy - iy;
  const o = iy * geom.ww + ix;
  const a = arr[o];
  const b = arr[o + 1];
  const c = arr[o + geom.ww];
  const d = arr[o + geom.ww + 1];
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

// ------------------------------------------------------------- field evaluation ----

// Per-boundary organic warp amplitudes (cells). Small for engineered surfaces,
// large for grass-on-grass transitions — this is where "natural edge
// irregularity" comes from without hand-placing every wiggle. Fairways use the
// lower-frequency rag channel as a signed edge offset below; the other classes
// use the shared two-axis coordinate warp.
const WARP = {
  tee: 0.10,
  green: 0.08,
  bunker: 0.22,
  water: 0.26,
  path: 0.14,
  fairway: 0.04,
  bands: 0.28,
};

// Transition band widths (yards) — the real-world mowing numbers.
export const BANDS = {
  fringe: 1.0,      // green → fringe collar
  firstCut: 1.4,    // fairway → first cut
  heavy: 24,        // mown rough → heavy rough band width
};

// Evaluate the surface class + signed boundary distance at a point (cells).
// HOT PATH: shared warp lattice, per-bin candidate lists, zero allocation —
// the result is packed into an int: zone | (distByte << 8).
const F_INF = 1e9;

function evalPacked(course, geom, px, py, paint) {
  const bx0 = px / geom.BIN;
  const by0 = py / geom.BIN;
  const bx = bx0 < 0 ? 0 : bx0 >= geom.bw ? geom.bw - 1 : bx0 | 0;
  const by = by0 < 0 ? 0 : by0 >= geom.bh ? geom.bh - 1 : by0 | 0;
  const bi = by * geom.bw + bx;
  const bucket = geom.bins[bi];

  // one warp direction for the whole sample; classes differ by amplitude only
  const wx = warpSample(geom, geom.warpX, px, py);
  const wy = warpSample(geom, geom.warpY, px, py);

  let greenD = F_INF;
  let greenFringe = BANDS.fringe;
  let greenApron = 0;
  let teeD = F_INF;

  if (bucket) {
    // ---- water (priority 1)
    const pwx = px + wx * WARP.water;
    const pwy = py + wy * WARP.water;
    for (let k = 0; k < bucket.length; k++) {
      const e = bucket[k];
      if (e.kind === 'water') {
        const d = polygonSDF(pwx, pwy, geom.waters[e.i].poly);
        if (d <= 0) return packZD(ZONE.WATER, d);
      }
    }
    // ---- bunkers (2)
    const pbx = px + wx * WARP.bunker;
    const pby = py + wy * WARP.bunker;
    for (let k = 0; k < bucket.length; k++) {
      const e = bucket[k];
      if (e.kind === 'bunker') {
        const d = polygonSDF(pbx, pby, geom.holes[e.i].bunkers[e.j].poly);
        if (d <= 0) return packZD(ZONE.BUNKER, d);
      }
    }
    // ---- greens (3)
    const pgx = px + wx * WARP.green;
    const pgy = py + wy * WARP.green;
    for (let k = 0; k < bucket.length; k++) {
      const e = bucket[k];
      if (e.kind === 'green') {
        const g = geom.holes[e.i];
        const d = polygonSDF(pgx, pgy, g.greenPoly);
        if (d < greenD) {
          greenD = d;
          greenFringe = (g.green.fringe || BANDS.fringe);
          greenApron = Number.isFinite(g.green.apron) && g.green.apron > 0 ? g.green.apron : 0;
        }
      }
    }
    if (greenD <= 0) return packZD(ZONE.GREEN, greenD);
    // ---- tees + lawns (4)
    const ptx = px + wx * WARP.tee;
    const pty = py + wy * WARP.tee;
    for (let k = 0; k < bucket.length; k++) {
      const e = bucket[k];
      if (e.kind === 'tee' || e.kind === 'lawn') {
        const pad = e.kind === 'tee' ? geom.holes[e.i].tees[e.j] : geom.lawns[e.j];
        const d = rectSDF(ptx, pty, pad);
        if (d < teeD) teeD = d;
      }
    }
    if (teeD <= 0) return packZD(ZONE.TEE, teeD);
  }

  // ---- cart paths + streams (5): segment bins
  const segs = geom.pathSegs[bi];
  if (segs) {
    const ppx = px + wx * WARP.path;
    const ppy = py + wy * WARP.path;
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      const r = segDist2(ppx, ppy, s.ax, s.ay, s.bx, s.by);
      const d = Math.sqrt(r.d2) - s.w / 2;
      if (d <= 0) return packZD(s.stream ? ZONE.WATER : ZONE.PATH, d);
    }
  }

  // ---- painted freeform overrides (player edits), organically warped
  if (paint) {
    const zd = paintedZD(
      paint, course.w, course.h,
      px + wx * WARP.bands - 0.5,
      py + wy * WARP.bands - 0.5,
    );
    if (zd >= 0) return zd;
  }

  // ---- fringe collar
  if (greenD <= greenFringe / CELL_YD) return packZD(ZONE.FRINGE, greenD - greenFringe / CELL_YD);

  // ---- approach apron: optional closely-mown SEMI immediately outside the
  // fringe. Missing/zero metadata preserves authored and legacy greens.
  const apronEdge = (greenFringe + greenApron) / CELL_YD;
  if (greenApron > 0 && greenD <= apronEdge) return packZD(ZONE.SEMI, greenD - apronEdge);

  // ---- fairway corridors (7): nearest corridor segment → width profile
  let fairD = F_INF;
  let roughW = 24 / CELL_YD;
  let rag = null;
  const fsegs = geom.fairSegs[bi];
  if (fsegs) {
    // The shared XY warp contains a short octave and previously displaced this
    // boundary by as much as 1.44 yd, producing regular close-view scallops.
    // Modulate the signed corridor distance with the already-cached, much
    // lower-frequency rag channel instead. Its 0.04-cell scale keeps organic
    // movement below 0.4 yd while preserving the architect's corridor shape.
    rag = warpSample(geom, geom.warpR, px, py);
    let bestD2 = F_INF;
    let bestSeg = null;
    let bestT = 0;
    for (let k = 0; k < fsegs.length; k++) {
      const s = fsegs[k];
      const r = segDist2(px, py, s.ax, s.ay, s.bx, s.by);
      if (r.d2 < bestD2) {
        bestD2 = r.d2;
        bestSeg = s;
        bestT = s.t0 + (s.t1 - s.t0) * r.t;
      }
    }
    if (bestSeg) {
      const h = geom.holes[bestSeg.hi];
      fairD = Math.sqrt(bestD2) - widthAt(h.width, bestT) + rag * WARP.fairway;
      roughW = h.roughW;
    }
  }
  if (fairD <= 0) return packZD(ZONE.FAIRWAY, fairD);
  const firstCut = BANDS.firstCut / CELL_YD;
  if (fairD <= firstCut) return packZD(ZONE.SEMI, fairD - firstCut);

  // ---- landscaping beds
  if (bucket) {
    for (let k = 0; k < bucket.length; k++) {
      const e = bucket[k];
      if (e.kind === 'bed') {
        const d = polygonSDF(px + wx * WARP.bands, py + wy * WARP.bands, geom.beds[e.i].poly);
        if (d <= 0) return packZD(ZONE.BED, d);
      }
    }
  }

  // ---- graded rough → ragged heavy band → native
  let playD = fairD;
  const gd = greenD * 0.9;
  const td = teeD * 0.9;
  if (gd < playD) playD = gd;
  if (td < playD) playD = td;
  if (playD <= roughW) return packZD(ZONE.ROUGH, playD - roughW);
  if (playD > 12) return packZD(ZONE.OUT, 4); // deep native — skip the band math
  if (rag === null) rag = warpSample(geom, geom.warpR, px, py);
  const heavyW = BANDS.heavy / CELL_YD;
  if (playD <= roughW + heavyW + rag) return packZD(ZONE.HEAVY, playD - (roughW + heavyW));
  return packZD(ZONE.OUT, playD - (roughW + heavyW));
}

// Painted overrides are authored on the 8-yard simulation grid, but the visual
// field samples every half yard. Returning a constant distance made the encoded
// zero-crossing snap to the cell border, so every brush stroke rendered as
// 8-yard squares. Reconstruct the stroke boundary as the 0.5 isoline of the
// bilinear indicator instead, and measure to it through the analytic gradient:
// that puts the edge at a smooth sub-cell position and hands the shader the
// real gradient it needs to antialias. Returns -1 when the sample is not inside
// a painted stroke, which is outside packZD's non-negative range.
function paintedZD(paint, w, h, cx0, cy0) {
  let x0 = Math.floor(cx0);
  let y0 = Math.floor(cy0);
  x0 = x0 < 0 ? 0 : x0 > w - 2 ? w - 2 : x0;
  y0 = y0 < 0 ? 0 : y0 > h - 2 ? h - 2 : y0;
  let fx = cx0 - x0;
  let fy = cy0 - y0;
  fx = fx < 0 ? 0 : fx > 1 ? 1 : fx;
  fy = fy < 0 ? 0 : fy > 1 ? 1 : fy;

  const i00 = y0 * w + x0;
  const p00 = paint[i00];
  const p10 = paint[i00 + 1];
  const p01 = paint[i00 + w];
  const p11 = paint[i00 + w + 1];

  // The cell under the sample still picks the zone, exactly as the previous
  // nearest-cell lookup did; neighbours only shape where its boundary falls.
  const zone = fx < 0.5 ? (fy < 0.5 ? p00 : p01) : (fy < 0.5 ? p10 : p11);
  if (zone === 255) return -1;

  const m00 = p00 === zone ? 1 : 0;
  const m10 = p10 === zone ? 1 : 0;
  const m01 = p01 === zone ? 1 : 0;
  const m11 = p11 === zone ? 1 : 0;

  const a = m00 + (m10 - m00) * fx;
  const b = m01 + (m11 - m01) * fx;
  const f = a + (b - a) * fy;

  const gx = (m10 - m00) * (1 - fy) + (m11 - m01) * fy;
  const gy = (m01 - m00) * (1 - fx) + (m11 - m10) * fx;
  const g = Math.sqrt(gx * gx + gy * gy);

  // A uniform neighbourhood holds no boundary, so the sample sits well inside
  // the stroke (or well outside it, and the generated surface keeps the point).
  if (g < 1e-6) return f >= 0.5 ? packZD(zone, -1.5) : -1;

  const d = (0.5 - f) / g;
  if (d >= 0) return -1; // the isoline puts this sample outside the stroke
  return packZD(zone, d);
}

function packZD(zone, d) {
  let enc = 128 + d * 32; // 1/32 cell (≈ 0.25 yd) resolution, ±4 cells
  enc = enc < 0 ? 0 : enc > 255 ? 255 : enc | 0;
  return zone | (enc << 8);
}

// Object-shaped wrapper for callers outside the raster hot path.
export function evaluateSurface(course, geom, px, py, paint) {
  const packed = evalPacked(course, geom, px, py, paint);
  return { zone: packed & 0xff, d: ((packed >> 8) - 128) / 32 };
}

// --------------------------------------------------------------- rasterization ----

// Rasterize the surface field over a texel rect at `scale` texels per cell.
// field.data is INTERLEAVED (zone, dist) byte pairs — uploadable directly as
// an RG texture. dist: 128 = on-edge, ±4 cells range at 1/32-cell steps.
export function rasterizeRect(course, field, rect) {
  const geom = getGeom(course);
  const { scale } = field;
  const paint = course.paint || null;
  const tx0 = clamp(Math.floor(rect.x0 * scale), 0, field.w - 1);
  const ty0 = clamp(Math.floor(rect.y0 * scale), 0, field.h - 1);
  const tx1 = clamp(Math.ceil(rect.x1 * scale), 0, field.w - 1);
  const ty1 = clamp(Math.ceil(rect.y1 * scale), 0, field.h - 1);
  const inv = 1 / scale;
  const data = field.data;
  for (let ty = ty0; ty <= ty1; ty++) {
    const py = (ty + 0.5) * inv;
    let o = (ty * field.w + tx0) * 2;
    for (let tx = tx0; tx <= tx1; tx++, o += 2) {
      const packed = evalPacked(course, geom, (tx + 0.5) * inv, py, paint);
      data[o] = packed & 0xff;
      data[o + 1] = packed >> 8;
    }
  }
  return { tx0, ty0, tx1, ty1 };
}

export function makeField(course, scale) {
  const w = course.w * scale;
  const h = course.h * scale;
  return { w, h, scale, data: new Uint8Array(w * h * 2) };
}

export function rasterizeField(course, scale) {
  const field = makeField(course, scale);
  rasterizeRect(course, field, { x0: 0, y0: 0, x1: course.w, y1: course.h });
  return field;
}

// ------------------------------------------------------------- sim derivation ----

// Write course.zones from the vectors (cell centers; pins/tee markers pinned).
// Structures keep their OUT footprint. Returns the course for chaining.
export function deriveZones(course) {
  const geom = getGeom(course);
  const paint = course.paint || null;
  const { w, h, zones } = course;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      zones[y * w + x] = evalPacked(course, geom, x + 0.5, y + 0.5, paint) & 0xff;
    }
  }
  // structures stamp OUT
  for (const s of course.structures || []) {
    for (let y = s.y; y < s.y + s.h; y++) {
      for (let x = s.x; x < s.x + s.w; x++) {
        if (x >= 0 && y >= 0 && x < w && y < h) zones[y * w + x] = ZONE.OUT;
      }
    }
  }
  // validation anchors: the active pin must sit on green cells, tees on tee cells
  for (const hole of course.holes) {
    if (hole.pin) zones[Math.round(hole.pin.y) * w + Math.round(hole.pin.x)] = ZONE.GREEN;
    if (hole.tee) zones[Math.round(hole.tee.y) * w + Math.round(hole.tee.x)] = ZONE.TEE;
  }
  return course;
}

// ------------------------------------------------------------------- relief ----

// Analytic terrain overlays derived from the same vectors: raised green pads,
// flat built-up tee boxes, bunker bowls with rolled lips, water carves, mounds.
// All heights in FEET (course.elevation units). baseAt(cx, cy) samples the
// smooth base terrain so pads can plateau at their center's height.
export function buildRelief(course, baseAt) {
  const geom = getGeom(course);
  const feats = [];
  for (const h of geom.holes) {
    if (h.greenPoly) {
      const g = h.green;
      feats.push({
        kind: 'green', poly: h.greenPoly, bbox: h.greenBbox,
        raise: g.raise ?? 1.6, base: baseAt(g.cx, g.cy),
        // Subtle putting contours: every green retains its broad tilt. Authored
        // complexes may add a few low, wide rolls; legacy/editor greens keep the
        // original single-roll fallback exactly as before.
        tiltX: Math.cos((g.tiltA ?? 0)) * (g.tilt ?? 0.25),
        tiltY: Math.sin((g.tiltA ?? 0)) * (g.tilt ?? 0.25),
        cx: g.cx, cy: g.cy,
        rollX: g.cx + Math.cos((g.tiltA ?? 0) + 1.9) * 0.8,
        rollY: g.cy + Math.sin((g.tiltA ?? 0) + 1.9) * 0.8,
        contours: Array.isArray(g.contours)
          ? g.contours.filter((contour) => (
            Number.isFinite(contour?.x) && Number.isFinite(contour?.y)
            && Number.isFinite(contour?.r) && contour.r > 0
            && Number.isFinite(contour?.h)
          )).map((contour) => ({
            x: contour.x, y: contour.y, r: contour.r, h: contour.h,
          }))
          : null,
      });
    }
    for (const t of h.tees) {
      feats.push({
        kind: 'tee', tee: t, base: baseAt(t.x, t.y),
        raise: t.raise ?? 1.3,
        bbox: { x0: t.x - 2.4, y0: t.y - 2.4, x1: t.x + 2.4, y1: t.y + 2.4 },
      });
    }
    for (const b of h.bunkers) {
      feats.push({
        kind: 'bunker', poly: b.poly, bbox: b.bbox, inR: b.inR,
        depth: b.ref.depth ?? 2.4, lip: b.ref.lip ?? 0.9,
      });
    }
  }
  for (const w of geom.waters) {
    feats.push({ kind: 'water', poly: w.poly, bbox: w.bbox, depth: w.ref.depth ?? 4.5 });
  }
  for (const s of geom.streams) {
    feats.push({ kind: 'stream', poly: s.poly, arcs: s.arcs, w: s.w, depth: 2.2, bbox: s.bbox });
  }
  for (const m of geom.mounds) {
    feats.push({ kind: 'mound', m: m.ref, bbox: m.bbox });
  }

  // cell-resolution buckets of features (bbox + falloff margin)
  const { w, h } = course;
  const buckets = new Array(w * h).fill(null);
  const MARGIN = 3.2;
  feats.forEach((f) => {
    const x0 = clamp(Math.floor(f.bbox.x0 - MARGIN), 0, w - 1);
    const y0 = clamp(Math.floor(f.bbox.y0 - MARGIN), 0, h - 1);
    const x1 = clamp(Math.ceil(f.bbox.x1 + MARGIN), 0, w - 1);
    const y1 = clamp(Math.ceil(f.bbox.y1 + MARGIN), 0, h - 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        (buckets[i] || (buckets[i] = [])).push(f);
      }
    }
  });
  return { feats, buckets, w, h };
}

function smooth01(t) {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
}

// relief height (feet) at cell coords, blended over the base height there.
export function reliefAt(relief, px, py, baseH) {
  const cx = clamp(px | 0, 0, relief.w - 1);
  const cy = clamp(py | 0, 0, relief.h - 1);
  const bucket = relief.buckets[cy * relief.w + cx];
  if (!bucket) return baseH;
  let hgt = baseH;
  for (const f of bucket) {
    switch (f.kind) {
      case 'green': {
        const d = polygonSDF(px, py, f.poly); // neg inside
        const wPad = smooth01((0.9 - d) / 2.1); // 1 well inside → 0 at ~0.9c out
        if (wPad > 0.001) {
          let rolling = 0;
          if (f.contours?.length) {
            for (const roll of f.contours) {
              const d2 = (px - roll.x) ** 2 + (py - roll.y) ** 2;
              rolling += roll.h * Math.exp(-d2 / (2 * roll.r * roll.r));
            }
          } else {
            rolling = 0.24 * Math.exp(-((px - f.rollX) ** 2 + (py - f.rollY) ** 2) / 1.4);
          }
          const contour = f.tiltX * (px - f.cx) + f.tiltY * (py - f.cy) + rolling;
          const target = f.base + f.raise + contour;
          hgt = hgt + (target - hgt) * wPad;
        }
        break;
      }
      case 'tee': {
        const d = rectSDF(px, py, f.tee);
        const wPad = smooth01((0.55 - d) / 1.15);
        if (wPad > 0.001) {
          const target = f.base + f.raise;
          hgt = hgt + (target - hgt) * wPad;
        }
        break;
      }
      case 'bunker': {
        const d = polygonSDF(px, py, f.poly);
        if (d < 0) {
          // Continuous rolled lip into an eased bowl. The old fixed step at
          // d=0 created two-foot vertical sand cliffs and exposed individual
          // terrain triangles from ground-level cameras.
          const k = smooth01(-d / Math.max(0.3, f.inR * 0.85));
          hgt += f.lip * 0.34 * (1 - k);
          hgt -= f.depth * k;
        } else if (d < 1.2) {
          // The outside roll meets the sand-side roll at the same height, then
          // fades through several yards of turf without a visible seam.
          const g = d / 0.62;
          hgt += f.lip * 0.34 * Math.exp(-g * g);
        }
        break;
      }
      case 'water': {
        const d = polygonSDF(px, py, f.poly);
        if (d < 0) {
          hgt -= f.depth * smooth01(-d / 1.6);
        } else if (d < 1.4) {
          hgt -= (1 - d / 1.4) * 0.8; // settled banks dip toward the shore
        }
        break;
      }
      case 'stream': {
        const r = polylineDistT(px, py, f.poly, f.arcs);
        const d = r.d - f.w / 2;
        if (d < 0) hgt -= f.depth * smooth01(-d / Math.max(0.2, f.w * 0.5));
        else if (d < 0.9) hgt -= (1 - d / 0.9) * 0.55;
        break;
      }
      case 'mound': {
        const m = f.m;
        const dd = ((px - m.x) ** 2 + (py - m.y) ** 2) / (m.r * m.r);
        if (dd < 1) hgt += m.h * Math.exp(-dd * 3.2);
        break;
      }
      default: break;
    }
  }
  return hgt;
}

// ----------------------------------------------------------- mow direction ----

// Field angle for mow banding: perpendicular stripes that bend with the hole.
// Returns the hole-line tangent angle at the nearest point (radians 0..2π), or
// null when off every corridor.
export function mowAngleAt(course, px, py) {
  const geom = getGeom(course);
  let best = Infinity;
  let ang = null;
  for (const h of geom.holes) {
    const r = polylineDistT(px, py, h.line, h.arcs);
    if (r.d < best) {
      best = r.d;
      const p = alongPoly(h.line, r.t);
      ang = Math.atan2(p.ty, p.tx);
    }
  }
  return ang === null ? null : (ang + Math.PI * 2) % (Math.PI * 2);
}

// ---------------------------------------------------------------- utilities ----

// Yardage of a hole measured along its playing line (tee → green center).
export function holeLengthYd(vecHole) {
  const line = sampleOpen(vecHole.line, 0.5);
  return polyLength(line) * CELL_YD;
}

// ensure a paint layer exists (255 = no override)
export function ensurePaint(course) {
  if (!course.paint || course.paint.length !== course.w * course.h) {
    course.paint = new Uint8Array(course.w * course.h).fill(255);
  }
  return course.paint;
}
