// GOLF EMPIRE - deterministic course-camera composition.
//
// This module deliberately has no Three.js dependency. Every pose is compatible
// with cameraRig.js: copy target.x/y/z, yaw, pitch, and dist onto the rig, then
// call rig.apply(). Authored course points are cell-space by default; callers may
// pass coordinateSpace: 'world' when supplying already-converted x/z points.

import { CELL_YD, GRID_H, GRID_W } from './constants.js';

export const COURSE_CAMERA_MODES = Object.freeze({
  FRAME_HOLE: 'frame-hole',
  TEE: 'tee',
  FAIRWAY: 'fairway',
  APPROACH: 'approach',
  GREEN: 'green',
  GROUND_PREVIEW: 'ground-preview',
  COURSE_OVERVIEW: 'course-overview',
});

const MODE_SET = new Set(Object.values(COURSE_CAMERA_MODES));
const EPS = 1e-6;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function positive(value, fallback) {
  return Number.isFinite(value) && value > EPS ? value : fallback;
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, finite(value, lo)));
}

function pointOf(value) {
  if (!value || !Number.isFinite(value.x)) return null;
  const z = Number.isFinite(value.z) ? value.z : value.y;
  if (!Number.isFinite(z)) return null;
  return { x: value.x, z };
}

function distinctPoints(points) {
  const clean = [];
  for (const value of points || []) {
    const p = pointOf(value);
    if (!p) continue;
    const prev = clean[clean.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.z - prev.z) > EPS) clean.push(p);
  }
  return clean;
}

// Accept the native course { w, h, CELL_YD } shape, explicit world dimensions,
// or explicit world min/max bounds. The native grid remains centred at (0, 0).
export function normalizeCourseCameraProperty(property = {}) {
  const cellYd = positive(property.cellYd, CELL_YD);
  const w = positive(property.w ?? property.widthCells, GRID_W);
  const h = positive(property.h ?? property.heightCells, GRID_H);

  const explicitX = Number.isFinite(property.minX) && Number.isFinite(property.maxX)
    && property.maxX > property.minX;
  const explicitZ = Number.isFinite(property.minZ) && Number.isFinite(property.maxZ)
    && property.maxZ > property.minZ;
  const worldW = positive(property.worldW, w * cellYd);
  const worldH = positive(property.worldH, h * cellYd);
  const centerX = explicitX
    ? (property.minX + property.maxX) * 0.5
    : finite(property.centerX, 0);
  const centerZ = explicitZ
    ? (property.minZ + property.maxZ) * 0.5
    : finite(property.centerZ, 0);
  const minX = explicitX ? property.minX : centerX - worldW * 0.5;
  const maxX = explicitX ? property.maxX : centerX + worldW * 0.5;
  const minZ = explicitZ ? property.minZ : centerZ - worldH * 0.5;
  const maxZ = explicitZ ? property.maxZ : centerZ + worldH * 0.5;

  return {
    cellYd,
    w,
    h,
    worldW: maxX - minX,
    worldH: maxZ - minZ,
    centerX,
    centerZ,
    minX,
    maxX,
    minZ,
    maxZ,
  };
}

function toWorldPoint(point, property, coordinateSpace) {
  const p = pointOf(point);
  if (!p) return null;
  if (coordinateSpace === 'world') return p;
  return {
    x: property.minX + (p.x + 0.5) * property.cellYd,
    z: property.minZ + (p.z + 0.5) * property.cellYd,
  };
}

function activeHolePoint(hole, kind) {
  if (!hole) return null;
  if (kind === 'tee') {
    const selected = hole.tees?.[hole.activeTee];
    return pointOf(selected) || pointOf(hole.tee);
  }
  const selected = hole.pins?.[hole.activePin];
  return pointOf(selected) || pointOf(hole.pin);
}

function vecEndpoint(vecHole, hole, kind) {
  if (!vecHole) return null;
  if (kind === 'tee') {
    const active = hole?.activeTee;
    const selected = (vecHole.tees || []).find((tee) => tee?.tier === active);
    return pointOf(selected) || pointOf(vecHole.tees?.[0]);
  }
  const names = ['A', 'B', 'C'];
  const index = Math.max(0, names.indexOf(hole?.activePin));
  return pointOf(vecHole.green?.pins?.[index])
    || pointOf(vecHole.green)
    || pointOf(vecHole.line?.[vecHole.line.length - 1]);
}

function sourceRoute(hole, vecHole, routePoints) {
  if (Array.isArray(routePoints) && distinctPoints(routePoints).length) {
    return distinctPoints(routePoints);
  }

  const vecLine = distinctPoints(vecHole?.line);
  if (vecLine.length) {
    // The vector centreline is the route truth, while the active vector tee and
    // pin are the precise endpoints for the player's current selection.
    const tee = vecEndpoint(vecHole, hole, 'tee');
    const pin = vecEndpoint(vecHole, hole, 'pin');
    if (tee) vecLine[0] = tee;
    if (pin) vecLine[vecLine.length - 1] = pin;
    return distinctPoints(vecLine);
  }

  return distinctPoints([
    activeHolePoint(hole, 'tee'),
    ...(hole?.wp || []),
    activeHolePoint(hole, 'pin'),
  ]);
}

// Return a clean world-space polyline. Explicit routePoints are authoritative,
// followed by the authored vector line, then the legacy tee/wp/pin route.
export function courseCameraRoute(hole, options = {}) {
  const property = normalizeCourseCameraProperty(options.property);
  const coordinateSpace = options.coordinateSpace === 'world' ? 'world' : 'cell';
  const vecHole = options.vecHole || options.vec || null;
  const routePoints = options.routePoints || options.route || null;
  return distinctPoints(sourceRoute(hole, vecHole, routePoints)
    .map((point) => toWorldPoint(point, property, coordinateSpace)));
}

function routeMetrics(route) {
  const points = distinctPoints(route);
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1]
      + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1] || 0 };
}

function sampleMetrics(metrics, t) {
  const { points, cumulative, length } = metrics;
  if (!points.length) return { x: 0, z: 0, tx: 0, tz: 1, distance: 0, length: 0 };
  if (points.length === 1 || length <= EPS) {
    return { ...points[0], tx: 0, tz: 1, distance: 0, length };
  }

  const distance = clamp(t, 0, 1) * length;
  let index = 1;
  while (index < cumulative.length - 1 && cumulative[index] < distance) index++;
  const a = points[index - 1];
  const b = points[index];
  const segmentLength = Math.max(EPS, cumulative[index] - cumulative[index - 1]);
  const local = clamp((distance - cumulative[index - 1]) / segmentLength, 0, 1);
  return {
    x: a.x + (b.x - a.x) * local,
    z: a.z + (b.z - a.z) * local,
    tx: (b.x - a.x) / segmentLength,
    tz: (b.z - a.z) / segmentLength,
    distance,
    length,
  };
}

// Arc-length sampling keeps camera timing even through doglegs rather than
// cutting directly from the tee to the pin.
export function sampleCourseCameraRoute(route, t) {
  return sampleMetrics(routeMetrics(route), t);
}

function tangentAt(metrics, t, windowYd = 12) {
  if (metrics.length <= EPS) return { x: 0, z: 1 };
  const dt = clamp(windowYd / metrics.length, 0.002, 0.18);
  const a = sampleMetrics(metrics, clamp(t - dt, 0, 1));
  const b = sampleMetrics(metrics, clamp(t + dt, 0, 1));
  let x = b.x - a.x;
  let z = b.z - a.z;
  let len = Math.hypot(x, z);
  if (len <= EPS) {
    const p = sampleMetrics(metrics, t);
    x = p.tx;
    z = p.tz;
    len = Math.hypot(x, z);
  }
  return len > EPS ? { x: x / len, z: z / len } : { x: 0, z: 1 };
}

function routeYaw(metrics, t, windowYd) {
  const tangent = tangentAt(metrics, t, windowYd);
  // CameraRig's yaw describes the target-to-camera offset, so PI places the
  // camera behind the direction of play and looks from tee toward green.
  return Math.atan2(tangent.x, tangent.z) + Math.PI;
}

function safeHeight(heightAt, x, z) {
  if (typeof heightAt !== 'function') return 0;
  try {
    return finite(heightAt(x, z), 0);
  } catch {
    return 0;
  }
}

function targetAt(metrics, t, heightAt) {
  const point = sampleMetrics(metrics, t);
  return { x: point.x, y: safeHeight(heightAt, point.x, point.z), z: point.z };
}

function pose(mode, target, yaw, pitch, dist, extras = {}) {
  return {
    target: {
      x: finite(target?.x, 0),
      y: finite(target?.y, 0),
      z: finite(target?.z, 0),
    },
    yaw: finite(yaw, 0),
    pitch: clamp(pitch, 0.04, 1.48),
    dist: positive(dist, 80),
    mode,
    ...extras,
  };
}

function normalizeMode(mode) {
  const clean = String(mode || COURSE_CAMERA_MODES.FRAME_HOLE)
    .trim().toLowerCase().replace(/[ _]+/g, '-');
  const aliases = {
    frame: COURSE_CAMERA_MODES.FRAME_HOLE,
    hole: COURSE_CAMERA_MODES.FRAME_HOLE,
    ground: COURSE_CAMERA_MODES.GROUND_PREVIEW,
    overview: COURSE_CAMERA_MODES.COURSE_OVERVIEW,
    course: COURSE_CAMERA_MODES.COURSE_OVERVIEW,
  };
  const normalized = aliases[clean] || clean;
  return MODE_SET.has(normalized) ? normalized : COURSE_CAMERA_MODES.FRAME_HOLE;
}

function frameFeaturePoints(route, vecHole, property, coordinateSpace, heightAt) {
  const cells = [
    ...(vecHole?.tees || []),
    ...(vecHole?.green?.pts || []),
    ...(vecHole?.bunkers || []).flatMap((bunker) => bunker?.pts || []),
  ];
  const routeSamples = [];
  const metrics = routeMetrics(route);
  for (let i = 0; i <= 32; i++) routeSamples.push(sampleMetrics(metrics, i / 32));
  return distinctPoints([
    ...route,
    ...routeSamples,
    ...cells.map((point) => toWorldPoint(point, property, coordinateSpace)),
  ]).map((point) => ({
    ...point,
    y: safeHeight(heightAt, point.x, point.z),
  }));
}

// Project a world point using the same orbit basis as cameraRig.js and a
// conventional perspective camera. Keeping this math here makes frame fitting
// deterministic in Node tests without introducing a Three.js dependency.
function projectForFrame(point, target, yaw, pitch, dist, aspect, verticalFov) {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const camera = {
    x: target.x + sy * cp * dist,
    y: target.y + sp * dist,
    z: target.z + cy * cp * dist,
  };
  const relX = point.x - camera.x;
  const relY = point.y - camera.y;
  const relZ = point.z - camera.z;
  const depth = relX * (-sy * cp) + relY * -sp + relZ * (-cy * cp);
  const tanHalfFov = Math.tan(verticalFov * 0.5);
  return {
    x: (relX * cy + relZ * -sy) / Math.max(EPS, depth * tanHalfFov * aspect),
    y: (relX * (-sy * sp) + relY * cp + relZ * (-cy * sp))
      / Math.max(EPS, depth * tanHalfFov),
    depth,
  };
}

function frameEnvelope(points, target, yaw, pitch, dist, aspect, verticalFov) {
  const envelope = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minDepth: Infinity };
  for (const point of points) {
    const projected = projectForFrame(point, target, yaw, pitch, dist, aspect, verticalFov);
    envelope.minX = Math.min(envelope.minX, projected.x);
    envelope.maxX = Math.max(envelope.maxX, projected.x);
    envelope.minY = Math.min(envelope.minY, projected.y);
    envelope.maxY = Math.max(envelope.maxY, projected.y);
    envelope.minDepth = Math.min(envelope.minDepth, projected.depth);
  }
  return envelope;
}

function frameFits(envelope, safeX, safeY) {
  return envelope.minDepth > 1
    && envelope.minX >= -safeX && envelope.maxX <= safeX
    && envelope.minY >= -safeY && envelope.maxY <= safeY;
}

function framePose(route, vecHole, property, coordinateSpace, heightAt, options) {
  const metrics = routeMetrics(route);
  const direction = tangentAt(metrics, 0.5, Math.max(24, metrics.length * 0.45));
  const authoredYawOffset = finite(vecHole?.camera?.frameYawOffset, 0);
  const yaw = Math.atan2(direction.x, direction.z) + Math.PI
    + finite(options.frameYawOffset, authoredYawOffset);
  const pitch = clamp(finite(
    options.framePitch,
    finite(vecHole?.camera?.framePitch, 0.68),
  ), 0.55, 0.9);
  const verticalFov = positive(options.verticalFov, 50) * Math.PI / 180;
  const aspect = positive(options.aspect, 16 / 9);
  const safeX = clamp(positive(options.frameSafeX, 0.82), 0.4, 0.96);
  const safeY = clamp(positive(options.frameSafeY, 0.78), 0.4, 0.94);
  // With a camera behind the tee, a target near the first third gives the
  // nearer tee enough perspective room while retaining the green high in frame.
  const routeT = clamp(finite(options.frameTargetT, 0.30), 0.2, 0.5);
  const target = targetAt(metrics, routeT, heightAt);
  const points = frameFeaturePoints(route, vecHole, property, coordinateSpace, heightAt);
  const minDist = positive(options.minFrameDist, 96);
  const maxDist = Math.max(minDist, positive(options.maxFrameDist, 440));

  // Fit the asymmetric perspective bounds directly. Binary search is stable,
  // cheap (the point set is tiny), and correctly accounts for near-tee scale,
  // aspect ratio, authored doglegs, hazards, and terrain height.
  let lo = minDist;
  let hi = maxDist;
  let envelope = frameEnvelope(points, target, yaw, pitch, hi, aspect, verticalFov);
  const clipped = !frameFits(envelope, safeX, safeY);
  if (!clipped) {
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) * 0.5;
      const candidate = frameEnvelope(points, target, yaw, pitch, mid, aspect, verticalFov);
      if (frameFits(candidate, safeX, safeY)) hi = mid;
      else lo = mid;
    }
    envelope = frameEnvelope(points, target, yaw, pitch, hi, aspect, verticalFov);
  }
  return pose(
    COURSE_CAMERA_MODES.FRAME_HOLE,
    target,
    yaw,
    pitch,
    hi,
    {
      routeT,
      frameEnvelope: envelope,
      frameSafe: { x: safeX, y: safeY },
      frameClipped: clipped,
    },
  );
}

function greenFeaturePoints(metrics, vecHole, property, coordinateSpace, heightAt, options) {
  const points = [];
  const authored = vecHole?.camera || {};
  const routeStartT = clamp(finite(
    options.greenContextStartT,
    finite(authored.greenContextStartT, 0.86),
  ), 0.7, 0.94);
  const contextHalfWidth = clamp(positive(
    options.greenContextHalfWidthYd,
    positive(authored.greenContextHalfWidthYd, 26),
  ), 12, 48);
  for (let index = 0; index <= 8; index++) {
    const t = routeStartT + (1 - routeStartT) * (index / 8);
    const center = sampleMetrics(metrics, t);
    const tangent = tangentAt(metrics, t, 18);
    points.push(
      center,
      { x: center.x - tangent.z * contextHalfWidth, z: center.z + tangent.x * contextHalfWidth },
      { x: center.x + tangent.z * contextHalfWidth, z: center.z - tangent.x * contextHalfWidth },
    );
  }

  const greenCenter = sampleMetrics(metrics, 1);
  const hazardRange = clamp(positive(options.greenHazardRangeYd, 80), 32, 140);
  const greenPoints = distinctPoints((vecHole?.green?.pts || [])
    .map((point) => toWorldPoint(point, property, coordinateSpace)));
  points.push(...greenPoints);
  for (const bunker of vecHole?.bunkers || []) {
    const bunkerPoints = distinctPoints((bunker?.pts || [])
      .map((point) => toWorldPoint(point, property, coordinateSpace)));
    const nearby = bunkerPoints.some((point) => (
      Math.hypot(point.x - greenCenter.x, point.z - greenCenter.z) <= hazardRange
    ));
    if (nearby) points.push(...bunkerPoints);
  }

  return distinctPoints(points).map((point) => ({
    ...point,
    y: safeHeight(heightAt, point.x, point.z),
  }));
}

function greenPose(metrics, vecHole, property, coordinateSpace, heightAt, options) {
  const routeT = clamp(finite(options.greenTargetT, 0.93), 0.84, 1);
  const target = targetAt(metrics, routeT, heightAt);
  const yaw = routeYaw(metrics, 0.98, 24) + finite(
    options.greenYawOffset,
    finite(vecHole?.camera?.greenYawOffset, 0),
  );
  // Keep the target complex at golf scale. The old 27-degree crane angle made
  // every green read as the same plate on a plan; a lower oblique view exposes
  // bunker lips, shoulders, and the authored putting-surface silhouette.
  const pitch = clamp(finite(options.greenPitch, 0.39), 0.3, 0.62);
  const aspect = positive(options.aspect, 16 / 9);
  const verticalFov = positive(options.verticalFov, 50) * Math.PI / 180;
  // Preserve a little horizontal breathing room around lips and collars; the
  // editor chrome and perspective edge should never crowd a strategic hazard.
  const safeX = clamp(positive(options.greenSafeX, 0.78), 0.5, 0.94);
  const safeY = clamp(positive(options.greenSafeY, 0.74), 0.5, 0.9);
  const points = greenFeaturePoints(
    metrics, vecHole, property, coordinateSpace, heightAt, options,
  );
  const minDist = positive(options.minGreenDist, 48);
  const maxDist = Math.max(minDist, positive(options.maxGreenDist, 104));

  let lo = minDist;
  let hi = maxDist;
  let envelope = frameEnvelope(points, target, yaw, pitch, hi, aspect, verticalFov);
  const clipped = !frameFits(envelope, safeX, safeY);
  if (!clipped) {
    for (let iteration = 0; iteration < 28; iteration++) {
      const mid = (lo + hi) * 0.5;
      const candidate = frameEnvelope(points, target, yaw, pitch, mid, aspect, verticalFov);
      if (frameFits(candidate, safeX, safeY)) hi = mid;
      else lo = mid;
    }
    envelope = frameEnvelope(points, target, yaw, pitch, hi, aspect, verticalFov);
  }

  return pose(
    COURSE_CAMERA_MODES.GREEN,
    target,
    yaw,
    pitch,
    hi,
    {
      routeT,
      greenEnvelope: envelope,
      greenSafe: { x: safeX, y: safeY },
      greenClipped: clipped,
    },
  );
}

function overviewPose(property, heightAt, options) {
  const aspect = positive(options.aspect, 16 / 9);
  const verticalFov = positive(options.verticalFov, 50) * Math.PI / 180;
  const safeX = clamp(positive(options.overviewSafeX, 0.88), 0.5, 0.96);
  const safeY = clamp(positive(options.overviewSafeY, 0.86), 0.5, 0.94);
  // The long property axis recedes into the image, while the shorter axis uses
  // the wider screen dimension. A 35-degree elevation keeps real terrain
  // depth without turning the overview into satellite imagery.
  const alongX = property.worldW >= property.worldH;
  const yaw = alongX ? Math.PI / 2 : 0;
  const pitch = clamp(finite(options.overviewPitch, 0.61), 0.5, 0.96);
  const maxDist = positive(options.maxOverviewDist, 700);
  const minDist = Math.min(maxDist, positive(options.minOverviewDist, 180));
  const points = [];
  const gridX = 6;
  const gridZ = 4;
  for (let iz = 0; iz <= gridZ; iz++) {
    for (let ix = 0; ix <= gridX; ix++) {
      const x = property.minX + property.worldW * (ix / gridX);
      const z = property.minZ + property.worldH * (iz / gridZ);
      points.push({ x, y: safeHeight(heightAt, x, z), z });
    }
  }

  const cameraDir = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const halfLong = (alongX ? property.worldW : property.worldH) * 0.5;
  let best = null;
  // Search only within the property. The near-side bias compensates for the
  // perspective magnification of the nearest boundary while leaving an
  // intentional oblique view over the full parkland footprint.
  for (let index = 0; index <= 64; index++) {
    const shift = halfLong * (index / 64);
    const x = property.centerX + cameraDir.x * shift;
    const z = property.centerZ + cameraDir.z * shift;
    const target = { x, y: safeHeight(heightAt, x, z), z };
    const atMax = frameEnvelope(points, target, yaw, pitch, maxDist, aspect, verticalFov);
    const canFit = frameFits(atMax, safeX, safeY);
    let dist = maxDist;
    let envelope = atMax;
    if (canFit) {
      let lo = minDist;
      let hi = maxDist;
      for (let iteration = 0; iteration < 28; iteration++) {
        const mid = (lo + hi) * 0.5;
        const candidate = frameEnvelope(points, target, yaw, pitch, mid, aspect, verticalFov);
        if (frameFits(candidate, safeX, safeY)) hi = mid;
        else lo = mid;
      }
      dist = hi;
      envelope = frameEnvelope(points, target, yaw, pitch, dist, aspect, verticalFov);
    }

    const centerX = (envelope.minX + envelope.maxX) * 0.5;
    const centerY = (envelope.minY + envelope.maxY) * 0.5;
    const overflow = Math.max(
      Math.abs(envelope.minX) / safeX,
      Math.abs(envelope.maxX) / safeX,
      Math.abs(envelope.minY) / safeY,
      Math.abs(envelope.maxY) / safeY,
      envelope.minDepth > 1 ? 0 : 100,
    );
    const composition = Math.abs(centerY - 0.06) + Math.abs(centerX) * 0.15
      + (dist / Math.max(EPS, maxDist)) * 0.005;
    const score = (canFit ? 0 : 100 + overflow) + composition;
    if (!best || score < best.score) {
      best = { target, dist, envelope, shift, canFit, score };
    }
  }

  return pose(
    COURSE_CAMERA_MODES.COURSE_OVERVIEW,
    best.target,
    yaw,
    pitch,
    best.dist,
    {
      overviewEnvelope: best.envelope,
      overviewSafe: { x: safeX, y: safeY },
      overviewClipped: !best.canFit,
      overviewTargetShift: best.shift,
    },
  );
}

// Build one editor camera preset. A missing or unusable hole safely falls back
// to the property overview; all returned numeric fields remain finite.
export function courseCameraPose(hole, mode = COURSE_CAMERA_MODES.FRAME_HOLE, options = {}) {
  const normalizedMode = normalizeMode(mode);
  const property = normalizeCourseCameraProperty(options.property);
  const heightAt = options.heightAt;
  if (normalizedMode === COURSE_CAMERA_MODES.COURSE_OVERVIEW) {
    return overviewPose(property, heightAt, options);
  }

  const coordinateSpace = options.coordinateSpace === 'world' ? 'world' : 'cell';
  const vecHole = options.vecHole || options.vec || null;
  const route = courseCameraRoute(hole, options);
  const metrics = routeMetrics(route);
  if (!route.length || metrics.length <= EPS) {
    const fallback = overviewPose(property, heightAt, options);
    return { ...fallback, requestedMode: normalizedMode, fallback: 'invalid-route' };
  }

  if (normalizedMode === COURSE_CAMERA_MODES.FRAME_HOLE) {
    return framePose(route, vecHole, property, coordinateSpace, heightAt, options);
  }

  if (normalizedMode === COURSE_CAMERA_MODES.GROUND_PREVIEW) {
    const lookAheadYd = clamp(metrics.length * 0.045, 10, 14);
    const routeT = lookAheadYd / metrics.length;
    const dist = lookAheadYd + 7;
    const pitch = Math.asin(clamp(positive(options.eyeHeightYd, 1.85) / dist, 0.04, 0.3));
    return pose(normalizedMode, targetAt(metrics, routeT, heightAt),
      routeYaw(metrics, routeT, 10), pitch, dist, { routeT });
  }

  if (normalizedMode === COURSE_CAMERA_MODES.TEE) {
    const lookYd = clamp(metrics.length * 0.08, 24, 34);
    const routeT = lookYd / metrics.length;
    const pitch = clamp(finite(options.teePitch, 0.19), 0.14, 0.28);
    const dist = lookYd + clamp(positive(options.teeBackYd, 10), 6, 16);
    return pose(normalizedMode, targetAt(metrics, routeT, heightAt),
      routeYaw(metrics, routeT, 18), pitch, dist, { routeT });
  }

  if (normalizedMode === COURSE_CAMERA_MODES.FAIRWAY) {
    const routeT = 0.48;
    // A restrained elevated landing-area view, rather than a second aerial
    // plan. It stays high enough to read strategy while retaining tree, bunker,
    // and terrain scale in the foreground.
    return pose(normalizedMode, targetAt(metrics, routeT, heightAt),
      routeYaw(metrics, routeT, 24), 0.34, clamp(metrics.length * 0.19, 64, 96), { routeT });
  }

  if (normalizedMode === COURSE_CAMERA_MODES.APPROACH) {
    const routeT = 0.86;
    const defaultDist = clamp(metrics.length * 0.16, 50, 74);
    const dist = clamp(positive(
      options.approachDistYd,
      positive(vecHole?.camera?.approachDistYd, defaultDist),
    ), 36, 96);
    const yawOffset = finite(
      options.approachYawOffset,
      finite(vecHole?.camera?.approachYawOffset, 0),
    );
    return pose(normalizedMode, targetAt(metrics, routeT, heightAt),
      routeYaw(metrics, routeT, 18) + yawOffset, 0.29, dist, { routeT });
  }

  // Green view includes the final approach corridor and nearby hazards. This
  // prevents the cart path/foreground from consuming the shot while a bunker
  // or edge of the putting surface is clipped just outside the viewport.
  return greenPose(metrics, vecHole, property, coordinateSpace, heightAt, options);
}

// Sample the authored route for a cinematic tee-to-green pass. Progress is
// smooth-stepped, but spatial sampling remains arc-length based through every
// waypoint, so doglegs are followed rather than cut across.
export function courseCameraFlyoverPose(hole, progress, options = {}) {
  const property = normalizeCourseCameraProperty(options.property);
  const route = courseCameraRoute(hole, options);
  const metrics = routeMetrics(route);
  if (!route.length || metrics.length <= EPS) {
    const fallback = overviewPose(property, options.heightAt, options);
    return {
      ...fallback,
      requestedMode: 'flyover',
      fallback: 'invalid-route',
      progress: clamp(progress, 0, 1),
      routeT: 0,
    };
  }

  const p = clamp(progress, 0, 1);
  const routeT = p * p * (3 - 2 * p);
  const lift = Math.sin(p * Math.PI);
  const yawOffset = finite(
    options.flyoverYawOffset,
    finite(options.vecHole?.camera?.flyoverYawOffset, 0),
  );
  return pose(
    'flyover',
    targetAt(metrics, routeT, options.heightAt),
    routeYaw(metrics, routeT, 22) + yawOffset,
    // Fly through the hole rather than above a miniature of it. Mid-flight
    // still rises for route awareness, but stays close enough for landform and
    // hazard relief to remain legible.
    0.31 + lift * 0.04,
    58 + lift * 18,
    { progress: p, routeT },
  );
}
