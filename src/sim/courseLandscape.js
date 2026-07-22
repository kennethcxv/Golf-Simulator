// Deterministic, data-only helpers for authored course-landscape intent.
//
// Vector positions are in simulation-cell coordinates (1 cell = CELL_YD),
// elevation values are feet, and authored clearance/profile metadata is in the
// real-world units named by each field. This module deliberately owns no cache
// and consumes no RNG so generation and tests can call it safely.

import { CELL_YD } from './constants.js';
import { polygonSDF, sampleClosed, sampleOpen } from './courseVec.js';

const EPS = 1e-9;

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function smooth01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function profileStops(profile) {
  const raw = Array.isArray(profile) ? profile : profile?.relativeFeet;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((stop) => Array.isArray(stop) && Number.isFinite(stop[0]) && Number.isFinite(stop[1]))
    .map((stop) => [clamp(stop[0], 0, 1), stop[1]])
    .sort((a, b) => a[0] - b[0]);
}

// Piecewise-linear evaluation keeps authored elevations exact at every stop.
// Values beyond the authored range hold the nearest endpoint.
function profileFeetFromStops(stops, t) {
  if (!stops.length) return 0;
  const at = clamp(finite(t), 0, 1);
  if (at <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (at <= b[0]) {
      const span = b[0] - a[0];
      if (span <= EPS) return b[1];
      const k = (at - a[0]) / span;
      return a[1] + (b[1] - a[1]) * k;
    }
  }
  return stops[stops.length - 1][1];
}

export function authoredProfileFeet(profile, t) {
  return profileFeetFromStops(profileStops(profile), t);
}

function widthStops(stops) {
  return Array.isArray(stops)
    ? stops
      .filter((stop) => Number.isFinite(stop?.t) && Number.isFinite(stop?.w))
      .map((stop) => ({ t: clamp(stop.t, 0, 1), w: Math.max(0, stop.w) }))
      .sort((a, b) => a.t - b.t)
    : [];
}

function widthAtYd(stops, t) {
  if (!stops.length) return 16;
  if (t <= stops[0].t) return stops[0].w;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (t <= b.t) {
      const k = clamp((t - a.t) / Math.max(EPS, b.t - a.t), 0, 1);
      return a.w + (b.w - a.w) * smooth01(k);
    }
  }
  return stops[stops.length - 1].w;
}

function compileRoute(line, step = 0.25) {
  if (!Array.isArray(line) || line.length < 2) return null;
  const points = sampleOpen(line, step).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length < 2) return null;
  const arcs = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    arcs[i] = arcs[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  const total = arcs[arcs.length - 1];
  return total > EPS ? { points, arcs, total } : null;
}

function closestOnRoute(route, x, y) {
  let bestD2 = Infinity;
  let bestT = 0;
  let bestX = route.points[0].x;
  let bestY = route.points[0].y;
  let bestTx = 1;
  let bestTy = 0;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1];
    const b = route.points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const k = length2 > EPS ? clamp(((x - a.x) * dx + (y - a.y) * dy) / length2, 0, 1) : 0;
    const qx = a.x + dx * k;
    const qy = a.y + dy * k;
    const ex = x - qx;
    const ey = y - qy;
    const d2 = ex * ex + ey * ey;
    if (d2 < bestD2) {
      const length = Math.sqrt(length2) || 1;
      bestD2 = d2;
      bestT = (route.arcs[i - 1] + length * k) / route.total;
      bestX = qx;
      bestY = qy;
      bestTx = dx / length;
      bestTy = dy / length;
    }
  }
  const offsetX = x - bestX;
  const offsetY = y - bestY;
  return {
    d: Math.sqrt(bestD2),
    t: clamp(bestT, 0, 1),
    x: bestX,
    y: bestY,
    tx: bestTx,
    ty: bestTy,
    // In the x/z ground plane, forward x up is the golfer's right vector.
    right: offsetX * -bestTy + offsetY * bestTx,
  };
}

function elevationAt(course, source, fx, fy) {
  // Vector coordinates address cell areas; elevation samples sit at their
  // centers, hence the half-cell shift before interpolation.
  const sx = clamp(fx - 0.5, 0, course.w - 1);
  const sy = clamp(fy - 0.5, 0, course.h - 1);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(course.w - 1, x0 + 1);
  const y1 = Math.min(course.h - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;
  const h00 = source[y0 * course.w + x0];
  const h10 = source[y0 * course.w + x1];
  const h01 = source[y1 * course.w + x0];
  const h11 = source[y1 * course.w + x1];
  return (h00 + (h10 - h00) * tx) * (1 - ty) + (h01 + (h11 - h01) * tx) * ty;
}

function intervalWeight(t, t0, t1) {
  if (t < t0 || t > t1 || t1 - t0 <= EPS) return 0;
  const fade = Math.min(0.05, (t1 - t0) / 3);
  if (fade <= EPS) return 1;
  return smooth01(Math.min((t - t0) / fade, (t1 - t) / fade, 1));
}

// Reshape the existing base elevation in-place. Multiple authored corridors
// combine by weighted averaging from one immutable elevation snapshot, so the
// result does not depend on one profile observing another profile's writes.
export function applyAuthoredTerrainProfiles(course) {
  const diagnostics = {
    appliedHoles: 0,
    changedCells: 0,
    maxAbsDeltaFt: 0,
    holes: [],
  };
  const holes = course?.vec?.holes;
  const expected = finite(course?.w, 0) * finite(course?.h, 0);
  if (!Array.isArray(holes) || expected <= 0 || course?.elevation?.length !== expected) return diagnostics;

  const authored = [];
  for (const hole of holes) {
    const stops = profileStops(hole?.terrainProfile);
    const route = compileRoute(hole?.line);
    if (!stops.length || !route) continue;
    authored.push({ hole, route, stops, width: widthStops(hole.width) });
  }
  if (!authored.length) return diagnostics;

  const source = Float32Array.from(course.elevation);
  const targets = new Float64Array(expected);
  const weights = new Float64Array(expected);

  for (const item of authored) {
    const { hole, route, stops, width } = item;
    const profile = hole.terrainProfile;
    const tee = hole.tees?.[0] || route.points[0];
    const teeElevationFt = elevationAt(course, source, tee.x, tee.y);
    const profileOriginFt = profileFeetFromStops(stops, 0);
    const plateau = profile.landingPlateau;
    const plateauT0 = clamp(finite(plateau?.t0, 2), 0, 1);
    const plateauT1 = clamp(finite(plateau?.t1, -1), 0, 1);
    const maxCrossSlope = Math.max(0, finite(plateau?.maxCrossSlope, 0));
    const hasPlateau = plateau != null
      && Number.isFinite(plateau.t0) && Number.isFinite(plateau.t1)
      && Number.isFinite(plateau.maxCrossSlope);
    const crown = profile.landingCrown;
    const crownT0 = clamp(finite(crown?.t0, 2), 0, 1);
    const crownT1 = clamp(finite(crown?.t1, -1), 0, 1);
    const crownEdgeDropFt = Math.max(0, finite(crown?.edgeDropFt, 0));
    const shoulder = profile.approachShoulder;
    const shoulderT0 = clamp(finite(shoulder?.t0, 2), 0, 1);
    const shoulderT1 = clamp(finite(shoulder?.t1, -1), 0, 1);
    const shoulderHeightFt = finite(shoulder?.heightFt, 0);
    const shoulderSide = shoulder?.side === 'left' ? -1 : 1;
    let affectedCells = 0;
    let maxWeight = 0;

    for (let y = 0; y < course.h; y++) {
      for (let x = 0; x < course.w; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const nearest = closestOnRoute(route, px, py);
        const fairHalfYd = widthAtYd(width, nearest.t);
        const innerCells = Math.max(1 / CELL_YD, fairHalfYd / CELL_YD);
        const outerCells = innerCells + (Math.max(8, finite(hole.roughW, 24)) + 8) / CELL_YD;
        if (nearest.d >= outerCells) continue;
        const blend = nearest.d <= innerCells
          ? 1
          : 1 - smooth01((nearest.d - innerCells) / Math.max(EPS, outerCells - innerCells));
        if (blend <= EPS) continue;

        const centerBaseFt = elevationAt(course, source, nearest.x, nearest.y);
        let crossDeltaFt = source[y * course.w + x] - centerBaseFt;
        if (hasPlateau && nearest.t >= plateauT0 - EPS && nearest.t <= plateauT1 + EPS) {
          // maxCrossSlope is a grade (rise/run); convert lateral yards to feet.
          const allowedFt = nearest.d * CELL_YD * 3 * maxCrossSlope;
          crossDeltaFt = clamp(crossDeltaFt, -allowedFt, allowedFt);
        }

        let targetFt = teeElevationFt
          + profileFeetFromStops(stops, nearest.t) - profileOriginFt
          + crossDeltaFt;

        // A shallow symmetric crown makes the landing corridor shed water and
        // read as shaped ground in oblique/player views while preserving every
        // exact authored centerline elevation stop.
        const crownAlong = intervalWeight(nearest.t, crownT0, crownT1);
        if (crownAlong > 0 && crownEdgeDropFt > 0) {
          const crownAcross = smooth01(nearest.d * CELL_YD / Math.max(1, fairHalfYd));
          targetFt -= crownEdgeDropFt * crownAlong * crownAcross;
        }

        const shoulderAlong = intervalWeight(nearest.t, shoulderT0, shoulderT1);
        if (shoulderAlong > 0 && shoulderHeightFt !== 0) {
          const selectedSideYd = nearest.right * CELL_YD * shoulderSide;
          const shoulderAcross = smooth01(selectedSideYd / Math.max(1, fairHalfYd));
          targetFt += shoulderHeightFt * shoulderAlong * shoulderAcross;
        }

        const offset = y * course.w + x;
        targets[offset] += targetFt * blend;
        weights[offset] += blend;
        affectedCells++;
        if (blend > maxWeight) maxWeight = blend;
      }
    }

    diagnostics.holes.push({
      id: hole.id ?? null,
      affectedCells,
      teeElevationFt,
      endpointRelativeFt: profileFeetFromStops(stops, 1) - profileOriginFt,
      maxWeight,
    });
  }

  for (let i = 0; i < expected; i++) {
    if (weights[i] <= EPS) continue;
    const blend = Math.min(1, weights[i]);
    const target = targets[i] / weights[i];
    const next = source[i] + (target - source[i]) * blend;
    const delta = Math.abs(next - source[i]);
    course.elevation[i] = next;
    if (delta > 1e-6) diagnostics.changedCells++;
    if (delta > diagnostics.maxAbsDeltaFt) diagnostics.maxAbsDeltaFt = delta;
  }
  diagnostics.appliedHoles = authored.length;
  return diagnostics;
}

// Compile metadata and vector/path geometry once before a planting loop. The
// compiled value is a stable snapshot and does not retain mutable point arrays.
export function compileVegetationExclusions(course) {
  const entries = [];
  const counts = { route: 0, green: 0, bunker: 0, path: 0 };
  for (const hole of course?.vec?.holes || []) {
    const specs = hole?.vegetation?.exclusions;
    if (!Array.isArray(specs) || !specs.length) continue;
    let route = null;
    for (const spec of specs) {
      if (!spec || typeof spec.kind !== 'string') continue;
      if (spec.kind === 'route') {
        route ||= compileRoute(hole.line);
        if (!route) continue;
        const hasClear = Number.isFinite(spec.clearHalfYd);
        const hasBeyond = Number.isFinite(spec.beyondFairwayYd);
        if (!hasClear && !hasBeyond) continue;
        entries.push({
          kind: 'route',
          holeId: hole.id ?? null,
          route,
          width: widthStops(hole.width),
          t0: clamp(finite(spec.t0), 0, 1),
          t1: clamp(finite(spec.t1, 1), 0, 1),
          clearHalfYd: hasClear ? Math.max(0, spec.clearHalfYd) : null,
          beyondFairwayYd: hasBeyond ? Math.max(0, spec.beyondFairwayYd) : null,
        });
        counts.route++;
      } else if (spec.kind === 'green' && hole.green?.pts?.length >= 3 && Number.isFinite(spec.bufferYd)) {
        entries.push({
          kind: 'green',
          holeId: hole.id ?? null,
          featureId: hole.green.id ?? null,
          poly: sampleClosed(hole.green.pts.map((p) => ({ x: p.x, y: p.y })), 0.25),
          clearanceYd: Math.max(0, spec.bufferYd),
        });
        counts.green++;
      } else if (spec.kind === 'bunker' && Number.isFinite(spec.bufferYd)) {
        for (const bunker of hole.bunkers || []) {
          if (!Array.isArray(bunker?.pts) || bunker.pts.length < 3) continue;
          entries.push({
            kind: 'bunker',
            holeId: hole.id ?? null,
            featureId: bunker.id ?? null,
            poly: sampleClosed(bunker.pts.map((p) => ({ x: p.x, y: p.y })), 0.25),
            clearanceYd: Math.max(0, spec.bufferYd),
          });
          counts.bunker++;
        }
      } else if (spec.kind === 'path' && Number.isFinite(spec.bufferYd)) {
        for (const path of course?.paths || []) {
          const pathRoute = compileRoute(path?.pts, 0.2);
          if (!pathRoute) continue;
          entries.push({
            kind: 'path',
            holeId: hole.id ?? null,
            featureId: path.id ?? null,
            route: pathRoute,
            clearanceYd: Math.max(0, spec.bufferYd) + Math.max(0, finite(path.width, 0)) / 2,
          });
          counts.path++;
        }
      }
    }
  }
  return { entries, counts };
}

function exclusionHit(entry, x, y) {
  if (entry.kind === 'route') {
    const nearest = closestOnRoute(entry.route, x, y);
    const lo = Math.min(entry.t0, entry.t1);
    const hi = Math.max(entry.t0, entry.t1);
    if (nearest.t < lo - EPS || nearest.t > hi + EPS) return null;
    let clearanceYd = entry.clearHalfYd ?? 0;
    if (entry.beyondFairwayYd != null) {
      clearanceYd = Math.max(clearanceYd, widthAtYd(entry.width, nearest.t) + entry.beyondFairwayYd);
    }
    const distanceYd = nearest.d * CELL_YD;
    return distanceYd <= clearanceYd + EPS ? { distanceYd, clearanceYd, t: nearest.t } : null;
  }
  if (entry.kind === 'green' || entry.kind === 'bunker') {
    const distanceYd = Math.max(0, polygonSDF(x, y, entry.poly)) * CELL_YD;
    return distanceYd <= entry.clearanceYd + EPS ? { distanceYd, clearanceYd: entry.clearanceYd } : null;
  }
  if (entry.kind === 'path') {
    const nearest = closestOnRoute(entry.route, x, y);
    const distanceYd = nearest.d * CELL_YD;
    return distanceYd <= entry.clearanceYd + EPS ? { distanceYd, clearanceYd: entry.clearanceYd, t: nearest.t } : null;
  }
  return null;
}

export function vegetationExclusionAt(compiled, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const entry of compiled?.entries || []) {
    const hit = exclusionHit(entry, x, y);
    if (hit) {
      return {
        kind: entry.kind,
        holeId: entry.holeId,
        featureId: entry.featureId ?? null,
        ...hit,
      };
    }
  }
  return null;
}

export function tallVegetationAllowed(compiled, x, y) {
  return vegetationExclusionAt(compiled, x, y) === null;
}
