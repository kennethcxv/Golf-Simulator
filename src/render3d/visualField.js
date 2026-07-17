// GOLF EMPIRE — the high-resolution VISUAL surface field.
//
// Two sources, one output shape:
//
//  · VECTOR courses (course.vec — the architect/editor design): the field is
//    rasterized straight from the authored splines by sim/courseVec.js at
//    VEC_SCALE texels per cell (16 → one texel per HALF yard), with a signed
//    boundary-distance channel for shader edge treatments (bunker lips,
//    collar shading). This is the production path.
//
//  · LEGACY grid courses (old saves, the big 18-hole estates): the original
//    kernel-argmax smoothing over the 8-yd sim cells at 8 texels per cell,
//    distance channel flat. Nothing old renders worse than it did.
//
// The field object: { w, h, scale, data: Uint8Array(w*h*2) } — interleaved
// (zone, dist) byte pairs, uploadable directly as an RG texture.
// dist: 128 = on the boundary, ±4 cells range in 1/32-cell steps.
//
// Pure data in, pure data out: no three.js, no DOM. Unit-tested headlessly.

import { ZONE } from '../sim/constants.js';
import { makeField, rasterizeRect } from '../sim/courseVec.js';

export const FIELD_SCALE = 8;   // legacy kernel path: 1 texel per yard
export const VEC_SCALE = 16;    // vector path: 1 texel per half yard

// --- legacy kernel table (unchanged from the resolution pass) -----------------

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

const INV = KERNEL.map((k) => (k ? 1 / (2.2 * k.sigma * 2.2 * k.sigma) : 0));
const WEIGHT = KERNEL.map((k) => (k ? k.weight : 0));
const REACH = 2;

function hash2(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

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

function warp(fx, fy, out) {
  const w1x = vnoise(fx * 0.52, fy * 0.52, 101) - 0.5;
  const w1y = vnoise(fx * 0.52, fy * 0.52, 907) - 0.5;
  const w2x = vnoise(fx * 1.9, fy * 1.9, 313) - 0.5;
  const w2y = vnoise(fx * 1.9, fy * 1.9, 577) - 0.5;
  out.x = fx + w1x * 1.15 + w2x * 0.4;
  out.y = fy + w1y * 1.15 + w2y * 0.4;
}

// --- construction ---------------------------------------------------------------

export function fieldDims(course) {
  const s = course.vec ? VEC_SCALE : FIELD_SCALE;
  return { w: course.w * s, h: course.h * s, scale: s };
}

export function makeVisualField(course) {
  const field = makeField(course, course.vec ? VEC_SCALE : FIELD_SCALE);
  computeVisualField(course, field);
  return field;
}

// Recompute the field inside a CELL-space rectangle (inclusive), or everything
// when rect is null.
export function computeVisualField(course, field, rect = null) {
  if (course.vec) {
    rasterizeRect(course, field, rect || { x0: 0, y0: 0, x1: course.w, y1: course.h });
    return field;
  }
  return computeLegacyField(course, field, rect);
}

function computeLegacyField(course, field, rect) {
  const { w: W, h: H, zones } = course;
  const FS = field.scale;
  const x0 = rect ? Math.max(0, Math.floor(rect.x0 * FS)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0 * FS)) : 0;
  const x1 = rect ? Math.min(field.w - 1, Math.ceil((rect.x1 + 1) * FS) - 1) : field.w - 1;
  const y1 = rect ? Math.min(field.h - 1, Math.ceil((rect.y1 + 1) * FS) - 1) : field.h - 1;
  const scores = new Float32Array(16);
  const p = { x: 0, y: 0 };
  const data = field.data;

  for (let ty = y0; ty <= y1; ty++) {
    const fy = (ty + 0.5) / FS;
    for (let tx = x0; tx <= x1; tx++) {
      const fx = (tx + 0.5) / FS;
      warp(fx, fy, p);
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
          if (d2 >= 1) continue;
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
      const o = (ty * field.w + tx) * 2;
      data[o] = best;
      data[o + 1] = 128; // legacy path carries no boundary distance
    }
  }
  return field;
}

// dirty-rect update after edits: pad by kernel reach + warp amplitude
export function updateVisualFieldRegion(course, field, cx0, cy0, cx1, cy1) {
  const PAD = REACH + 1.2;
  return computeVisualField(course, field, {
    x0: Math.max(0, cx0 - PAD),
    y0: Math.max(0, cy0 - PAD),
    x1: Math.min(course.w - 1, cx1 + PAD),
    y1: Math.min(course.h - 1, cy1 + PAD),
  });
}

// the zone the field shows at fractional CELL coords (ball lies, QA, tests)
export function fieldZoneAt(field, course, fx, fy) {
  const tx = Math.max(0, Math.min(field.w - 1, Math.floor(fx * field.scale)));
  const ty = Math.max(0, Math.min(field.h - 1, Math.floor(fy * field.scale)));
  return field.data[(ty * field.w + tx) * 2];
}

// signed boundary distance (in YARDS) of the winning zone at cell coords
export function fieldDistAt(field, course, fx, fy) {
  const tx = Math.max(0, Math.min(field.w - 1, Math.floor(fx * field.scale)));
  const ty = Math.max(0, Math.min(field.h - 1, Math.floor(fy * field.scale)));
  return ((field.data[(ty * field.w + tx) * 2 + 1] - 128) / 32) * 8;
}
