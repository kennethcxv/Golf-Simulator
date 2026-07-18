import { CELL_YD } from './constants.js';

const TYPE_RADIUS_YD = Object.freeze({
  bench: 2.3,
  bench_course: 2.3,
  ball_washer: 1.0,
  trash_bin: 1.1,
  trash_course: 1.1,
  tee_sign: 1.2,
  distance_marker: 0.7,
  yardage_plate: 0.7,
  planter: 1.3,
  hedge: 2.0,
  bush_round: 1.6,
  bush_flower: 1.6,
  flowers: 1.2,
  reeds: 1.1,
  rock_l: 2.5,
  rock_cluster: 2.2,
  course_sign: 1.4,
  club_sign: 1.4,
  flower_a: 1.2,
  shrub_round: 1.6,
  bush_native: 1.8,
  rock_s: 1.0,
  rock_m: 1.7,
  boulder_a: 2.5,
  shore_rock: 1.6,
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function snapCoursePoint(x, y, {
  enabled = true,
  incrementYd = 1,
} = {}) {
  const fx = finite(x);
  const fy = finite(y);
  const increment = finite(incrementYd);
  if (fx === null || fy === null) return null;
  if (!enabled) return { x: fx, y: fy };
  if (increment === null || increment <= 0) return null;
  const stepCells = increment / CELL_YD;
  return {
    x: Math.round(fx / stepCells) * stepCells,
    y: Math.round(fy / stepCells) * stepCells,
  };
}

export function objectCollisionRadiusYd(type, scale = 1) {
  const normalizedScale = finite(scale);
  if (typeof type !== 'string' || !type || normalizedScale === null || normalizedScale <= 0) return null;
  let base = TYPE_RADIUS_YD[type];
  if (base == null) {
    if (/^(?:oak|maple|birch|shade|fill|tree_)/i.test(type)) base = 2.4;
    else if (/^(?:pine|spruce|cedar)/i.test(type)) base = 2.0;
    else if (/shrub|bush|flower|reed|grass_clump/i.test(type)) base = 1.3;
    else if (/boulder/i.test(type)) base = 2.5;
    else if (/rock/i.test(type)) base = 1.4;
    else base = 1.35;
  }
  return base * normalizedScale;
}

function circleOverlapsRect(cx, cy, radiusCells, rect) {
  const nearestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return Math.hypot(cx - nearestX, cy - nearestY) < radiusCells;
}

export function objectCollisionOk(course, type, x, y, {
  scale = 1,
  ignoreId = null,
  clearanceYd = 0.5,
} = {}) {
  if (!course || !Number.isFinite(course.w) || !Number.isFinite(course.h)) {
    return { ok: false, reason: 'No course placement surface.' };
  }
  const fx = finite(x);
  const fy = finite(y);
  const clearance = finite(clearanceYd);
  const radiusYd = objectCollisionRadiusYd(type, scale);
  if (fx === null || fy === null || radiusYd === null || clearance === null || clearance < 0) {
    return { ok: false, reason: 'Invalid object placement.' };
  }
  const radiusCells = radiusYd / CELL_YD;
  if (fx - radiusCells < -0.5 || fy - radiusCells < -0.5
    || fx + radiusCells > course.w - 0.5 || fy + radiusCells > course.h - 0.5) {
    return { ok: false, reason: 'Object must fit inside the course.' };
  }
  for (const object of course.objects || []) {
    if (ignoreId != null && object.id === ignoreId) continue;
    const otherRadiusYd = objectCollisionRadiusYd(object.type, object.scale ?? 1);
    if (otherRadiusYd == null || !Number.isFinite(object.x) || !Number.isFinite(object.y)) continue;
    const separationYd = Math.hypot(object.x - fx, object.y - fy) * CELL_YD;
    if (separationYd < radiusYd + otherRadiusYd + clearance) {
      return { ok: false, reason: 'Too close to another object.', collidesWith: object.id ?? null };
    }
  }
  for (const structure of course.structures || []) {
    if (![structure.x, structure.y, structure.w, structure.h].every(Number.isFinite)) continue;
    if (circleOverlapsRect(fx, fy, (radiusYd + clearance) / CELL_YD, structure)) {
      return { ok: false, reason: 'Object overlaps a structure.' };
    }
  }
  return { ok: true, reason: null };
}
