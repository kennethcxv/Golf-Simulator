// GOLF EMPIRE — the high-resolution VISUAL surface field.
//
// The 120×80 simulation grid stays authoritative for gameplay (turf, costs,
// classification, saves). This module derives what the RENDERER shows: a
// categorical field at FIELD_SCALE texels per cell (8 → one texel per yard)
// whose boundaries are smooth, curved, and organically warped instead of
// stepping at 8-yard cells.
//
// Method: for each hi-res texel, its (domain-warped) position gathers the
// surrounding simulation cells; every zone accumulates a compact smooth-kernel
// score shaped by a per-zone sigma (edge reach) and weight (priority). The
// argmax zone wins the texel. Blend widths between surfaces fall out of the
// sigma/weight table: tight zones (green, tee, bunker, water) keep crisp
// shapes, band zones (fringe, first cut) get squeezed into narrow collars,
// broad zones (rough, native) feather wide. Deterministic — hash noise only.
//
// Pure data in, pure data out: no three.js, no DOM. Unit-tested headlessly.

import { ZONE } from '../sim/constants.js';

export const FIELD_SCALE = 8; // texels per simulation cell edge (8 → 1 yd)

// kernel radius in cells around the warped sample point
const REACH = 2;

// sigma: how far a zone's influence feathers (cells). weight: argmax priority
// (>1 grows into neighbors, <1 gets squeezed thin). Together they implement
// the spec's per-boundary blend widths.
const KERNEL = new Array(16).fill(null);
KERNEL[ZONE.OUT] = { sigma: 1.2, weight: 0.92 };
KERNEL[ZONE.ROUGH] = { sigma: 1.05, weight: 1.0 };
KERNEL[ZONE.FAIRWAY] = { sigma: 0.95, weight: 1.12 };
KERNEL[ZONE.GREEN] = { sigma: 0.62, weight: 1.5 };
KERNEL[ZONE.TEE] = { sigma: 0.52, weight: 1.55 };
KERNEL[ZONE.BUNKER] = { sigma: 0.62, weight: 1.42 };
KERNEL[ZONE.WATER] = { sigma: 0.72, weight: 1.5 };
KERNEL[ZONE.PATH] = { sigma: 0.55, weight: 1.08 };
KERNEL[ZONE.FRINGE] = { sigma: 0.55, weight: 0.52 }; // a thin collar, not an 8-yd donut
KERNEL[ZONE.HEAVY] = { sigma: 1.3, weight: 0.95 };
KERNEL[ZONE.DIRT] = { sigma: 0.8, weight: 1.05 };
KERNEL[ZONE.BED] = { sigma: 0.7, weight: 1.25 };
KERNEL[ZONE.SEMI] = { sigma: 0.75, weight: 0.6 }; // first cut: a narrow mown step

// precomputed 1/(2σ²)-style factors for the compact kernel
const INV = KERNEL.map((k) => (k ? 1 / (2.2 * k.sigma * 2.2 * k.sigma) : 0));
const WEIGHT = KERNEL.map((k) => (k ? k.weight : 0));

// --- deterministic value noise (same family as the renderer's hashes) --------

function hash2(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// smooth value noise over cell coords (bilinear-blended lattice hashes)
function vnoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(xi + seed, yi);
  const b = hash2(xi + 1 + seed, yi);
  const c = hash2(xi + seed, yi + 1);
  const d = hash2(xi + 1 + seed, yi + 1);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

// organic domain warp: two octaves, ±~0.75 cells at the low octave
function warp(fx, fy, out) {
  const w1x = vnoise(fx * 0.52, fy * 0.52, 101) - 0.5;
  const w1y = vnoise(fx * 0.52, fy * 0.52, 907) - 0.5;
  const w2x = vnoise(fx * 1.9, fy * 1.9, 313) - 0.5;
  const w2y = vnoise(fx * 1.9, fy * 1.9, 577) - 0.5;
  out.x = fx + w1x * 1.15 + w2x * 0.4;
  out.y = fy + w1y * 1.15 + w2y * 0.4;
}

// --- field construction ---------------------------------------------------------

export function fieldDims(course) {
  return { w: course.w * FIELD_SCALE, h: course.h * FIELD_SCALE };
}

export function makeVisualField(course) {
  const { w, h } = fieldDims(course);
  return { w, h, data: new Uint8Array(w * h) };
}

// Recompute the field inside a CELL-space rectangle (inclusive), or everything
// when rect is null. The kernel reaches REACH cells plus ~0.8 cells of warp,
// so callers should already have padded their dirty rect (updateRegion does).
export function computeVisualField(course, field, rect = null) {
  const { w: W, h: H, zones } = course;
  const FS = FIELD_SCALE;
  const x0 = rect ? Math.max(0, Math.floor(rect.x0 * FS)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0 * FS)) : 0;
  const x1 = rect ? Math.min(field.w - 1, Math.ceil((rect.x1 + 1) * FS) - 1) : field.w - 1;
  const y1 = rect ? Math.min(field.h - 1, Math.ceil((rect.y1 + 1) * FS) - 1) : field.h - 1;
  const scores = new Float32Array(16);
  const p = { x: 0, y: 0 };

  for (let ty = y0; ty <= y1; ty++) {
    const fy = (ty + 0.5) / FS;
    for (let tx = x0; tx <= x1; tx++) {
      const fx = (tx + 0.5) / FS;
      warp(fx, fy, p);
      // clamp the warped position inside the grid so edges stay defined
      const wx = p.x < 0.01 ? 0.01 : p.x > W - 0.01 ? W - 0.01 : p.x;
      const wy = p.y < 0.01 ? 0.01 : p.y > H - 0.01 ? H - 0.01 : p.y;
      const cx0 = Math.max(0, Math.floor(wx) - REACH);
      const cy0 = Math.max(0, Math.floor(wy) - REACH);
      const cx1 = Math.min(W - 1, Math.floor(wx) + REACH);
      const cy1 = Math.min(H - 1, Math.floor(wy) + REACH);
      scores.fill(0);
      for (let cy = cy0; cy <= cy1; cy++) {
        const dy = cy + 0.5 - wy;
        const rowBase = cy * W;
        for (let cx = cx0; cx <= cx1; cx++) {
          const dx = cx + 0.5 - wx;
          const z = zones[rowBase + cx];
          const d2 = (dx * dx + dy * dy) * INV[z];
          if (d2 >= 1) continue; // outside this zone's compact kernel
          const fall = 1 - d2;
          scores[z] += WEIGHT[z] * fall * fall;
        }
      }
      let best = 0;
      let bestScore = -1;
      for (let z = 0; z < 16; z++) {
        if (scores[z] > bestScore) {
          bestScore = scores[z];
          best = z;
        }
      }
      field.data[ty * field.w + tx] = best;
    }
  }
  return field;
}

// dirty-rect update after cell edits: pad by kernel reach + warp amplitude
export function updateVisualFieldRegion(course, field, cx0, cy0, cx1, cy1) {
  const PAD = REACH + 1.2;
  return computeVisualField(course, field, {
    x0: Math.max(0, cx0 - PAD),
    y0: Math.max(0, cy0 - PAD),
    x1: Math.min(course.w - 1, cx1 + PAD),
    y1: Math.min(course.h - 1, cy1 + PAD),
  });
}

// test/QA helper: the zone the field shows at fractional CELL coords
export function fieldZoneAt(field, course, fx, fy) {
  const tx = Math.max(0, Math.min(field.w - 1, Math.floor(fx * FIELD_SCALE)));
  const ty = Math.max(0, Math.min(field.h - 1, Math.floor(fy * FIELD_SCALE)));
  return field.data[ty * field.w + tx];
}
