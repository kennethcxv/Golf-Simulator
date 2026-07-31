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

import { ZONE, CELL_YD } from '../sim/constants.js';
import { BANDS, makeField, rasterizeRect } from '../sim/courseVec.js';

export const FIELD_SCALE = 8;   // legacy kernel path: 1 texel per yard
export const VEC_SCALE = 16;    // vector path: 1 texel per half yard

// Rendering-only signed distances packed into one RGBA texture. The categorical
// RG field above remains authoritative for gameplay; these channels reconstruct
// sharp subpixel material contours in the shader without spending another
// texture unit. One byte stores 1/32 yd and saturates about four yards from an
// edge -- ample for the 1.4 yd first cut and 1 yd green collar.
export const SURFACE_DISTANCE_CHANNEL = Object.freeze({
  FAIRWAY: 0,
  GREEN: 1,
  TEE: 2,
  BUNKER: 3,
});
export const SURFACE_DISTANCE_UNITS_PER_YD = 32;
export const SURFACE_DISTANCE_ZERO = 128;
// courseVec's compact winning-zone distance uses 1/32 cell steps. Coverage
// needs at least half this world-space quantum to hide the residual contour
// position error at player height without widening a mowing band.
export const VISUAL_FIELD_DISTANCE_QUANTUM_YD = CELL_YD / 32;
export const SURFACE_COVERAGE_MIN_AA_YD = VISUAL_FIELD_DISTANCE_QUANTUM_YD * 0.5;
export const SURFACE_DISTANCE_MIN_YD = -SURFACE_DISTANCE_ZERO / SURFACE_DISTANCE_UNITS_PER_YD;
export const SURFACE_DISTANCE_MAX_YD = (255 - SURFACE_DISTANCE_ZERO) / SURFACE_DISTANCE_UNITS_PER_YD;
export const SURFACE_FIRST_CUT_YD = BANDS.firstCut;
export const SURFACE_GREEN_FRINGE_YD = BANDS.fringe;

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
export const VISUAL_FIELD_REGION_PADDING_CELLS = REACH + 1.2;

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
  field.hasAnalyticDistance = Boolean(course.vec);
  computeVisualField(course, field);
  return field;
}

export function encodeSurfaceDistanceYd(distanceYd) {
  const d = Math.max(SURFACE_DISTANCE_MIN_YD, Math.min(SURFACE_DISTANCE_MAX_YD, distanceYd));
  return Math.round(SURFACE_DISTANCE_ZERO + d * SURFACE_DISTANCE_UNITS_PER_YD);
}

export function decodeSurfaceDistanceByte(byte) {
  return (byte - SURFACE_DISTANCE_ZERO) / SURFACE_DISTANCE_UNITS_PER_YD;
}

export function makeSurfaceDistanceField(field) {
  // Match the vector field's half-yard resolution. Unlike the previous one-yard
  // occupancy average, this preserves the authored analytical boundary distance
  // at each sample. Linear GPU sampling then reconstructs the zero contour;
  // fwidth controls only pixel antialiasing, not the world-space shape.
  const distance = {
    w: field.w,
    h: field.h,
    scale: field.scale,
    data: new Uint8Array(field.w * field.h * 4),
  };
  computeSurfaceDistanceField(field, distance);
  return distance;
}

function winnerDistanceYd(field, sourceOffset) {
  if (!(field.hasAnalyticDistance ?? field.scale === VEC_SCALE)) return null;
  return ((field.data[sourceOffset + 1] - 128) / 32) * CELL_YD;
}

function baseFairwayDistance(field, tx, ty, exteriorStepYd) {
  const sourceOffset = (ty * field.w + tx) * 2;
  const zone = field.data[sourceOffset];
  const winnerD = winnerDistanceYd(field, sourceOffset);
  if (zone === ZONE.FAIRWAY) return winnerD === null ? -exteriorStepYd : Math.min(-1e-4, winnerD);
  if (zone === ZONE.SEMI) {
    return winnerD === null
      ? SURFACE_FIRST_CUT_YD * 0.5
      : Math.max(1e-4, winnerD + SURFACE_FIRST_CUT_YD);
  }
  if (zone === ZONE.ROUGH) return SURFACE_FIRST_CUT_YD + exteriorStepYd;
  return null;
}

function underlyingFairwayDistance(field, tx, ty, exteriorStepYd) {
  const direct = baseFairwayDistance(field, tx, ty, exteriorStepYd);
  if (direct !== null) return direct;

  const zone = field.data[(ty * field.w + tx) * 2];
  if (zone !== ZONE.GREEN && zone !== ZONE.FRINGE && zone !== ZONE.TEE && zone !== ZONE.BUNKER) {
    return SURFACE_FIRST_CUT_YD + exteriorStepYd;
  }

  // Bunkers, greens, and tees have priority over the corridor in the categorical
  // field. Extend the adjacent base-turf distance by one texel beneath those
  // overlays so their antialiased rim blends back to the actual surrounding lie,
  // rather than producing a dark rough halo. The interior value is irrelevant
  // once the overlay coverage reaches one.
  let sum = 0;
  let samples = 0;
  for (let oy = -1; oy <= 1; oy++) {
    const sy = ty + oy;
    if (sy < 0 || sy >= field.h) continue;
    for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) continue;
      const sx = tx + ox;
      if (sx < 0 || sx >= field.w) continue;
      const neighbor = baseFairwayDistance(field, sx, sy, exteriorStepYd);
      if (neighbor === null) continue;
      sum += neighbor;
      samples++;
    }
  }
  return samples ? sum / samples : SURFACE_FIRST_CUT_YD + exteriorStepYd;
}

function greenDistance(field, tx, ty, exteriorStepYd) {
  const sourceOffset = (ty * field.w + tx) * 2;
  const zone = field.data[sourceOffset];
  const winnerD = winnerDistanceYd(field, sourceOffset);
  if (zone === ZONE.GREEN) return winnerD === null ? -exteriorStepYd : Math.min(-1e-4, winnerD);
  if (zone === ZONE.FRINGE) {
    return winnerD === null
      ? SURFACE_GREEN_FRINGE_YD * 0.5
      : Math.max(1e-4, winnerD + SURFACE_GREEN_FRINGE_YD);
  }

  // Preserve a green/fringe base under the first bunker texel when a bunker cuts
  // into a green complex. Sand remains the higher-priority material in shader.
  if (zone === ZONE.BUNKER) {
    let sum = 0;
    let samples = 0;
    for (let oy = -1; oy <= 1; oy++) {
      const sy = ty + oy;
      if (sy < 0 || sy >= field.h) continue;
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const sx = tx + ox;
        if (sx < 0 || sx >= field.w) continue;
        const so = (sy * field.w + sx) * 2;
        const sz = field.data[so];
        const sd = winnerDistanceYd(field, so);
        if (sz === ZONE.GREEN) {
          sum += sd === null ? -exteriorStepYd : Math.min(-1e-4, sd);
          samples++;
        } else if (sz === ZONE.FRINGE) {
          sum += sd === null
            ? SURFACE_GREEN_FRINGE_YD * 0.5
            : Math.max(1e-4, sd + SURFACE_GREEN_FRINGE_YD);
          samples++;
        }
      }
    }
    if (samples) return sum / samples;
  }
  return SURFACE_GREEN_FRINGE_YD + exteriorStepYd;
}

function prioritySurfaceDistance(field, sourceOffset, zoneId, exteriorStepYd) {
  if (field.data[sourceOffset] !== zoneId) return exteriorStepYd;
  const winnerD = winnerDistanceYd(field, sourceOffset);
  return winnerD === null ? -exteriorStepYd : Math.min(-1e-4, winnerD);
}

// Derive four band-limited signed distances from the categorical visual field.
// The zero level set is the authored material edge. FAIRWAY and GREEN also use
// positive thresholds for their real-world first-cut/collar widths, allowing two
// related boundaries to share a channel without sacrificing tee antialiasing.
export function computeSurfaceDistanceField(field, distance, rect = null) {
  if (distance.scale !== field.scale || distance.w !== field.w || distance.h !== field.h) {
    throw new RangeError('surface distance field must match the visual field dimensions');
  }
  // The only neighbourhood operation is a one-texel base-material extension
  // under priority overlays. Recompute one extra source texel so a dirty update
  // is byte-identical to a full rebuild.
  const tx0 = rect ? Math.max(0, Math.floor(rect.x0 * distance.scale) - 1) : 0;
  const ty0 = rect ? Math.max(0, Math.floor(rect.y0 * distance.scale) - 1) : 0;
  const tx1 = rect ? Math.min(distance.w - 1, Math.ceil(rect.x1 * distance.scale) + 1) : distance.w - 1;
  const ty1 = rect ? Math.min(distance.h - 1, Math.ceil(rect.y1 * distance.scale) + 1) : distance.h - 1;
  const exteriorStepYd = CELL_YD / (distance.scale * 2);

  // A one-texel separable level-set relaxation removes the sampling-frequency
  // scallop from diagonal zero contours. Crucially this operates on signed
  // distance, not material color or coverage: the shader still renders a sharp
  // fwidth-antialiased threshold. The extra halo makes regional and full builds
  // mathematically identical.
  const rawTx0 = Math.max(0, tx0 - 1);
  const rawTy0 = Math.max(0, ty0 - 1);
  const rawTx1 = Math.min(distance.w - 1, tx1 + 1);
  const rawTy1 = Math.min(distance.h - 1, ty1 + 1);
  const rawW = rawTx1 - rawTx0 + 1;
  const rawH = rawTy1 - rawTy0 + 1;
  const raw = new Uint8Array(rawW * rawH * 4);

  for (let ty = rawTy0; ty <= rawTy1; ty++) {
    let dst = ((ty - rawTy0) * rawW) * 4;
    for (let tx = rawTx0; tx <= rawTx1; tx++, dst += 4) {
      const sourceOffset = (ty * field.w + tx) * 2;
      raw[dst + SURFACE_DISTANCE_CHANNEL.FAIRWAY] = encodeSurfaceDistanceYd(
        underlyingFairwayDistance(field, tx, ty, exteriorStepYd),
      );
      raw[dst + SURFACE_DISTANCE_CHANNEL.GREEN] = encodeSurfaceDistanceYd(
        greenDistance(field, tx, ty, exteriorStepYd),
      );
      raw[dst + SURFACE_DISTANCE_CHANNEL.TEE] = encodeSurfaceDistanceYd(
        prioritySurfaceDistance(field, sourceOffset, ZONE.TEE, exteriorStepYd),
      );
      raw[dst + SURFACE_DISTANCE_CHANNEL.BUNKER] = encodeSurfaceDistanceYd(
        prioritySurfaceDistance(field, sourceOffset, ZONE.BUNKER, exteriorStepYd),
      );
    }
  }

  const horizontal = new Uint8Array(raw.length);
  for (let y = 0; y < rawH; y++) {
    const row = y * rawW * 4;
    for (let x = 0; x < rawW; x++) {
      const center = row + x * 4;
      const left = x > 0 ? center - 4 : center;
      const right = x + 1 < rawW ? center + 4 : center;
      for (let channel = 0; channel < 4; channel++) {
        horizontal[center + channel] = (raw[left + channel] + raw[center + channel] * 2 + raw[right + channel] + 2) >> 2;
      }
    }
  }

  for (let ty = ty0; ty <= ty1; ty++) {
    const localY = ty - rawTy0;
    const upY = localY > 0 ? localY - 1 : localY;
    const downY = localY + 1 < rawH ? localY + 1 : localY;
    let dst = (ty * distance.w + tx0) * 4;
    for (let tx = tx0; tx <= tx1; tx++, dst += 4) {
      const localX = tx - rawTx0;
      const center = (localY * rawW + localX) * 4;
      const up = (upY * rawW + localX) * 4;
      const down = (downY * rawW + localX) * 4;
      for (let channel = 0; channel < 4; channel++) {
        distance.data[dst + channel] = (horizontal[up + channel]
          + horizontal[center + channel] * 2
          + horizontal[down + channel] + 2) >> 2;
      }
    }
  }
  distance.updatedRect = { tx0, ty0, tx1, ty1 };
  return distance;
}

// Recompute the field inside a CELL-space rectangle (inclusive), or everything
// when rect is null.
export function computeVisualField(course, field, rect = null) {
  field.hasAnalyticDistance = Boolean(course.vec);
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
      data[o + 1] = 128; // filled below, once every winner in the region is known
    }
  }
  fillLegacyBoundaryDistance(field, x0, y0, x1, y1);
  // The bytes now mean what packZD's do on the vector path, so the surface
  // channels can read them instead of falling back to their step constants.
  field.hasAnalyticDistance = true;
  return field;
}

// The legacy kernel path wrote a flat 128 — no boundary distance — so
// winnerDistanceYd returned null and every surface channel collapsed to a
// three-level step function at one-yard texels. That is what makes an 18-hole
// estate's fairway and green edges read blobby and quantised next to a
// nine-hole vector course.
//
// The categorical field is already rasterised at this point, so a chamfer
// distance transform recovers a real signed distance to the winning zone's
// boundary — the same quantity packZD encodes analytically on the vector path.
function fillLegacyBoundaryDistance(field, tx0, ty0, tx1, ty1) {
  const { w, h, data, scale } = field;
  // The encoding saturates about four cells out, so nothing further away can
  // change a byte in the requested region — that bound makes a dirty-rect
  // update identical to a full rebuild.
  const reach = Math.ceil(4 * scale) + 1;
  const px0 = Math.max(0, tx0 - reach);
  const py0 = Math.max(0, ty0 - reach);
  const px1 = Math.min(w - 1, tx1 + reach);
  const py1 = Math.min(h - 1, ty1 + reach);
  const rw = px1 - px0 + 1;
  const rh = py1 - py0 + 1;
  const INF = 1e9;
  const dist = new Float32Array(rw * rh);
  const zoneAt = (x, y) => data[(y * w + x) * 2];

  // Seed: a texel touching a different zone sits on the boundary.
  for (let y = py0; y <= py1; y++) {
    for (let x = px0; x <= px1; x++) {
      const z = zoneAt(x, y);
      const edge = (x > 0 && zoneAt(x - 1, y) !== z)
        || (x < w - 1 && zoneAt(x + 1, y) !== z)
        || (y > 0 && zoneAt(x, y - 1) !== z)
        || (y < h - 1 && zoneAt(x, y + 1) !== z);
      dist[(y - py0) * rw + (x - px0)] = edge ? 0 : INF;
    }
  }

  // Two-pass chamfer with exact diagonal weights.
  const DD = Math.SQRT2;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      let d = dist[i];
      if (d === 0) continue;
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - rw] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - rw - 1] + DD);
      if (x < rw - 1 && y > 0) d = Math.min(d, dist[i - rw + 1] + DD);
      dist[i] = d;
    }
  }
  for (let y = rh - 1; y >= 0; y--) {
    for (let x = rw - 1; x >= 0; x--) {
      const i = y * rw + x;
      let d = dist[i];
      if (d === 0) continue;
      if (x < rw - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < rh - 1) d = Math.min(d, dist[i + rw] + 1);
      if (x < rw - 1 && y < rh - 1) d = Math.min(d, dist[i + rw + 1] + DD);
      if (x > 0 && y < rh - 1) d = Math.min(d, dist[i + rw - 1] + DD);
      dist[i] = d;
    }
  }

  // packZD's encoding: 128 + distanceInCells * 32, negative inside. The extra
  // half texel puts the zero contour on the boundary itself rather than on the
  // last texel inside it.
  const perTexel = 32 / scale;
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      const d = dist[(y - py0) * rw + (x - px0)];
      let enc = 128 - (d + 0.5) * perTexel;
      enc = enc < 0 ? 0 : enc > 255 ? 255 : enc | 0;
      data[(y * w + x) * 2 + 1] = enc;
    }
  }
}

// dirty-rect update after edits: pad by kernel reach + warp amplitude
export function updateVisualFieldRegion(course, field, cx0, cy0, cx1, cy1, padding = VISUAL_FIELD_REGION_PADDING_CELLS) {
  const PAD = Math.max(0, Number(padding) || 0);
  return computeVisualField(course, field, {
    x0: Math.max(0, cx0 - PAD),
    y0: Math.max(0, cy0 - PAD),
    x1: Math.min(course.w - 1, cx1 + PAD),
    y1: Math.min(course.h - 1, cy1 + PAD),
  });
}

export function updateSurfaceDistanceFieldRegion(course, field, distance, cx0, cy0, cx1, cy1, padding = VISUAL_FIELD_REGION_PADDING_CELLS) {
  const PAD = Math.max(0, Number(padding) || 0);
  return computeSurfaceDistanceField(field, distance, {
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
