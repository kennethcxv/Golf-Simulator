// Pure bridge-deck queries for paths authored by the Course Editor.
//
// Horizontal positions use the course's continuous CELL coordinates (one cell
// is CELL_YD yards). Stored path widths are yards, while bridge elevation
// controls are feet. Runtime results expose vertical values in both feet and
// world yards so the same index can serve first-person walking, raycasts, and
// playtest ball lies without either system reinterpreting the save format.

import { CELL_YD, ZONE } from './constants.js';

const EPSILON = 1e-9;
const FEET_PER_YARD = 3;

export const COURSE_BRIDGE_SURFACE_DEFAULTS = Object.freeze({
  pathWidthYd: 2.6,
  startT: 0,
  endT: 1,
  // Match the established renderer-side bridge lift: 0.18 world yards.
  deckHeightFt: 0.54,
  clearanceFt: 0.54,
  sampleSpacingYd: 1.6,
  camberRatio: 0.005,
  maxCamberYd: 0.45,
});

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function catmull(p0, p1, p2, p3, t) {
  return 0.5 * ((2 * p1) + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/**
 * Sample the persisted elevation grid at a fractional course point.
 *
 * The grid stores feet at integer cell centres. Catmull-Rom interpolation
 * mirrors courseScene's base-terrain lookup, but this pure fallback converts
 * the result to physical world yards. Render code may provide its post-relief
 * `terrainHeightYdAt` callback when building an index instead.
 */
export function sampleCourseElevationYd(course, x, y) {
  if (!course || !Number.isFinite(course.w) || !Number.isFinite(course.h)
    || course.w < 1 || course.h < 1 || !course.elevation
    || !Number.isFinite(x) || !Number.isFinite(y)) return Number.NaN;

  const width = Math.floor(course.w);
  const height = Math.floor(course.h);
  if (course.elevation.length < width * height) return Number.NaN;
  const elevationAt = (cx, cy) => {
    const ix = clamp(cx, 0, width - 1);
    const iy = clamp(cy, 0, height - 1);
    const feet = Number(course.elevation[iy * width + ix]);
    return Number.isFinite(feet) ? feet / FEET_PER_YARD : Number.NaN;
  };

  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const rows = [];
  for (let row = -1; row <= 2; row += 1) {
    rows.push(catmull(
      elevationAt(xi - 1, yi + row),
      elevationAt(xi, yi + row),
      elevationAt(xi + 1, yi + row),
      elevationAt(xi + 2, yi + row),
      tx,
    ));
  }
  return catmull(rows[0], rows[1], rows[2], rows[3], ty);
}

/**
 * Resolve the bridge portion of one saved path. Invalid metadata is disabled
 * conservatively; missing fields on a valid object receive production defaults.
 */
export function resolveCourseBridgeSurfaceSettings(bridge) {
  if (bridge === true) return {
    ...COURSE_BRIDGE_SURFACE_DEFAULTS,
    enabled: true,
    deckClearanceYd: COURSE_BRIDGE_SURFACE_DEFAULTS.deckHeightFt / FEET_PER_YARD,
  };
  if (!bridge || bridge === false || typeof bridge !== 'object' || Array.isArray(bridge)) return null;
  if (Object.hasOwn(bridge, 'enabled') && typeof bridge.enabled !== 'boolean') return null;
  if (bridge.enabled === false) return null;

  const readFraction = (key, fallback) => {
    if (!Object.hasOwn(bridge, key)) return fallback;
    const value = bridge[key];
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : Number.NaN;
  };
  const readFeet = (key, fallback) => {
    if (!Object.hasOwn(bridge, key)) return fallback;
    const value = bridge[key];
    return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
  };
  const startT = readFraction('startT', COURSE_BRIDGE_SURFACE_DEFAULTS.startT);
  const endT = readFraction('endT', COURSE_BRIDGE_SURFACE_DEFAULTS.endT);
  const deckHeightFt = readFeet('deckHeightFt', COURSE_BRIDGE_SURFACE_DEFAULTS.deckHeightFt);
  const clearanceFt = readFeet('clearanceFt', COURSE_BRIDGE_SURFACE_DEFAULTS.clearanceFt);
  if (![startT, endT, deckHeightFt, clearanceFt].every(Number.isFinite) || startT >= endT) return null;
  // The visual bridge treats either explicitly-authored height field as a
  // safety floor and uses the larger one. With neither field authored, it
  // retains the established 0.18-yard default.
  const authoredHeightFt = ['deckHeightFt', 'clearanceFt']
    .filter((key) => Object.hasOwn(bridge, key))
    .map((key) => bridge[key]);
  return {
    ...COURSE_BRIDGE_SURFACE_DEFAULTS,
    enabled: true,
    startT,
    endT,
    deckHeightFt,
    clearanceFt,
    deckClearanceYd: authoredHeightFt.length
      ? Math.max(...authoredHeightFt) / FEET_PER_YARD
      : COURSE_BRIDGE_SURFACE_DEFAULTS.deckHeightFt / FEET_PER_YARD,
  };
}

function finiteControlPoints(course, path) {
  if (!path || !Array.isArray(path.pts) || path.pts.length < 2 || path.pts.length > 4096) return null;
  const maxX = Number(course?.w);
  const maxY = Number(course?.h);
  if (!Number.isFinite(maxX) || !Number.isFinite(maxY) || maxX <= 0 || maxY <= 0) return null;
  if (!path.pts.every((point) => point
    && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= maxX && point.y >= 0 && point.y <= maxY)) return null;
  const points = [];
  for (const point of path.pts) {
    const previous = points[points.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > EPSILON) {
      points.push({ x: point.x, y: point.y });
    }
  }
  return points.length >= 2 ? points : null;
}

function prefixLengths(polyline) {
  const lengths = new Float64Array(polyline.length);
  for (let index = 1; index < polyline.length; index += 1) {
    lengths[index] = lengths[index - 1]
      + Math.hypot(
        polyline[index].x - polyline[index - 1].x,
        polyline[index].y - polyline[index - 1].y,
      );
  }
  return lengths;
}

function extrapolate(from, awayFrom) {
  return {
    x: from.x * 2 - awayFrom.x,
    y: from.y * 2 - awayFrom.y,
  };
}

// Barry-Goldman evaluation of the renderer's alpha=0.5 (centripetal)
// Catmull-Rom span. Uniformly scaling course cells into world yards leaves the
// evaluated shape unchanged, so this version can stay in course coordinates.
function centripetalPoint(p0, p1, p2, p3, u) {
  const interval = (a, b) => Math.max(
    EPSILON,
    Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)),
  );
  const t0 = 0;
  const t1 = t0 + interval(p0, p1);
  const t2 = t1 + interval(p1, p2);
  const t3 = t2 + interval(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const blend = (a, b, ta, tb) => {
    const denominator = Math.max(EPSILON, tb - ta);
    return {
      x: ((tb - t) * a.x + (t - ta) * b.x) / denominator,
      y: ((tb - t) * a.y + (t - ta) * b.y) / denominator,
    };
  };
  const a1 = blend(p0, p1, t0, t1);
  const a2 = blend(p1, p2, t1, t2);
  const a3 = blend(p2, p3, t2, t3);
  const b1 = blend(a1, a2, t0, t2);
  const b2 = blend(a2, a3, t1, t3);
  return blend(b1, b2, t1, t2);
}

function appendDistinct(points, point) {
  const previous = points[points.length - 1];
  if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > EPSILON) {
    points.push(point);
  }
}

function denseBridgeSpline(controlPoints, sampleSpacingYd) {
  const dense = [];
  for (let index = 0; index < controlPoints.length - 1; index += 1) {
    const p1 = controlPoints[index];
    const p2 = controlPoints[index + 1];
    const p0 = controlPoints[index - 1] || extrapolate(p1, p2);
    const p3 = controlPoints[index + 2] || extrapolate(p2, p1);
    const chordYd = Math.hypot(p2.x - p1.x, p2.y - p1.y) * CELL_YD;
    const steps = Math.max(8, Math.min(4096, Math.ceil(chordYd / sampleSpacingYd * 4)));
    if (index === 0) appendDistinct(dense, centripetalPoint(p0, p1, p2, p3, 0));
    for (let step = 1; step <= steps; step += 1) {
      appendDistinct(dense, centripetalPoint(p0, p1, p2, p3, step / steps));
    }
  }
  return dense;
}

function pointAtDistance(polyline, lengths, distance) {
  let upper = 1;
  while (upper < lengths.length - 1 && lengths[upper] < distance) upper += 1;
  const beforeDistance = lengths[upper - 1];
  const afterDistance = lengths[upper];
  const amount = (distance - beforeDistance) / Math.max(EPSILON, afterDistance - beforeDistance);
  return {
    x: polyline[upper - 1].x + (polyline[upper].x - polyline[upper - 1].x) * amount,
    y: polyline[upper - 1].y + (polyline[upper].y - polyline[upper - 1].y) * amount,
  };
}

function trimDenseByFraction(dense, startT, endT) {
  const lengths = prefixLengths(dense);
  const totalLengthCells = lengths[lengths.length - 1];
  if (!(totalLengthCells > EPSILON)) return null;
  if (startT === 0 && endT === 1) {
    return { points: dense, totalLengthCells };
  }
  const startDistance = totalLengthCells * startT;
  const endDistance = totalLengthCells * endT;
  const trimmed = [pointAtDistance(dense, lengths, startDistance)];
  for (let index = 1; index < dense.length - 1; index += 1) {
    if (lengths[index] > startDistance && lengths[index] < endDistance) {
      appendDistinct(trimmed, dense[index]);
    }
  }
  appendDistinct(trimmed, pointAtDistance(dense, lengths, endDistance));
  return trimmed.length >= 2 ? { points: trimmed, totalLengthCells } : null;
}

function uniformBridgeStations(polyline, sampleSpacingYd, startT, endT) {
  const lengths = prefixLengths(polyline);
  const bridgeLengthCells = lengths[lengths.length - 1];
  if (!(bridgeLengthCells > EPSILON)) return null;
  const segmentCount = Math.max(1, Math.ceil(bridgeLengthCells * CELL_YD / sampleSpacingYd));
  const stations = [];
  let cursor = 1;
  for (let index = 0; index <= segmentCount; index += 1) {
    const distanceCells = index === segmentCount
      ? bridgeLengthCells
      : bridgeLengthCells * index / segmentCount;
    while (cursor < lengths.length - 1 && lengths[cursor] < distanceCells) cursor += 1;
    const beforeDistance = lengths[cursor - 1];
    const afterDistance = lengths[cursor];
    const amount = (distanceCells - beforeDistance)
      / Math.max(EPSILON, afterDistance - beforeDistance);
    const before = polyline[cursor - 1];
    const after = polyline[cursor];
    const bridgeT = distanceCells / bridgeLengthCells;
    stations.push({
      x: before.x + (after.x - before.x) * amount,
      y: before.y + (after.y - before.y) * amount,
      distanceCells,
      bridgeT,
      pathT: startT + (endT - startT) * bridgeT,
    });
  }
  return { stations, bridgeLengthCells };
}

function safeTerrainHeight(sampler, x, y, course, path) {
  try {
    const height = Number(sampler(x, y, course, path));
    return Number.isFinite(height) ? height : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function buildSurface(course, path, pathIndex, styleOptions, terrainHeightYdAt) {
  const settings = resolveCourseBridgeSurfaceSettings(path?.bridge);
  if (!settings) return null;
  const controls = finiteControlPoints(course, path);
  if (!controls) return null;
  // The renderer requires an authored positive width. Fail closed here too so
  // damaged/legacy data cannot create an invisible but walkable bridge.
  const widthYd = path.width;
  if (!Number.isFinite(widthYd) || widthYd <= 0) return null;

  const dense = denseBridgeSpline(controls, styleOptions.sampleSpacingYd);
  if (dense.length < 2) return null;
  const trimmed = trimDenseByFraction(dense, settings.startT, settings.endT);
  if (!trimmed) return null;
  const sampled = uniformBridgeStations(
    trimmed.points,
    styleOptions.sampleSpacingYd,
    settings.startT,
    settings.endT,
  );
  if (!sampled) return null;
  const { stations, bridgeLengthCells } = sampled;
  const totalLengthCells = trimmed.totalLengthCells;

  const halfWidthCells = widthYd / (CELL_YD * 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < stations.length; index += 1) {
    const station = stations[index];
    const before = stations[Math.max(0, index - 1)];
    const after = stations[Math.min(stations.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const tangentLength = Math.hypot(dx, dy);
    if (!(tangentLength > EPSILON)) return null;
    station.tx = dx / tangentLength;
    station.ty = dy / tangentLength;
    station.nx = -station.ty;
    station.ny = station.tx;
    station.terrainHeightYd = safeTerrainHeight(terrainHeightYdAt, station.x, station.y, course, path);
    const leftHeight = safeTerrainHeight(
      terrainHeightYdAt,
      station.x + station.nx * halfWidthCells,
      station.y + station.ny * halfWidthCells,
      course,
      path,
    );
    const rightHeight = safeTerrainHeight(
      terrainHeightYdAt,
      station.x - station.nx * halfWidthCells,
      station.y - station.ny * halfWidthCells,
      course,
      path,
    );
    if (![station.terrainHeightYd, leftHeight, rightHeight].every(Number.isFinite)) return null;
    station.highTerrainHeightYd = Math.max(station.terrainHeightYd, leftHeight, rightHeight);
    minX = Math.min(minX, station.x);
    minY = Math.min(minY, station.y);
    maxX = Math.max(maxX, station.x);
    maxY = Math.max(maxY, station.y);
  }

  const deckClearanceYd = styleOptions.deckClearanceYd ?? settings.deckClearanceYd;
  const startDeckYd = stations[0].highTerrainHeightYd + deckClearanceYd;
  const endDeckYd = stations[stations.length - 1].highTerrainHeightYd + deckClearanceYd;
  const bridgeLengthYd = bridgeLengthCells * CELL_YD;
  let camberYd = Math.min(
    styleOptions.maxCamberYd,
    bridgeLengthYd * styleOptions.camberRatio,
  );
  for (let index = 1; index < stations.length - 1; index += 1) {
    const station = stations[index];
    const wave = Math.sin(Math.PI * station.bridgeT);
    if (wave <= EPSILON) continue;
    const lineHeightYd = startDeckYd + (endDeckYd - startDeckYd) * station.bridgeT;
    const requiredCamberYd = (
      station.highTerrainHeightYd + deckClearanceYd - lineHeightYd
    ) / wave;
    camberYd = Math.max(
      camberYd,
      Math.min(styleOptions.maxCamberYd, requiredCamberYd),
    );
  }
  for (const station of stations) {
    const lineHeightYd = startDeckYd + (endDeckYd - startDeckYd) * station.bridgeT;
    station.deckHeightYd = lineHeightYd + Math.sin(Math.PI * station.bridgeT) * camberYd;
  }

  return {
    pathId: Number.isFinite(path.id) ? path.id : null,
    pathIndex,
    widthYd,
    halfWidthCells,
    pathLengthYd: totalLengthCells * CELL_YD,
    bridgeLengthYd,
    settings,
    style: { ...styleOptions, deckClearanceYd },
    camberYd,
    bounds: {
      minX: minX - halfWidthCells,
      minY: minY - halfWidthCells,
      maxX: maxX + halfWidthCells,
      maxY: maxY + halfWidthCells,
    },
    stations,
  };
}

/**
 * Precompute all enabled bridge surfaces. The input course and its paths are
 * never mutated. Malformed legacy records are omitted from `surfaces`.
 *
 * `terrainHeightYdAt(x, y, course, path)` receives fractional course coords
 * and must return the final ground height in world yards. When omitted, the
 * persisted elevation grid is sampled with `sampleCourseElevationYd`.
 */
export function buildCourseBridgeSurfaceIndex(course, options = {}) {
  const optionStyle = options.style && typeof options.style === 'object' ? options.style : {};
  const requestedSpacing = optionStyle.sampleSpacingYd ?? options.sampleSpacingYd;
  const sampleSpacingYd = Number.isFinite(requestedSpacing) && requestedSpacing > 0
    ? requestedSpacing
    : COURSE_BRIDGE_SURFACE_DEFAULTS.sampleSpacingYd;
  const requestedCamberRatio = optionStyle.camberRatio ?? options.camberRatio;
  const camberRatio = Number.isFinite(requestedCamberRatio) && requestedCamberRatio >= 0
    ? requestedCamberRatio
    : COURSE_BRIDGE_SURFACE_DEFAULTS.camberRatio;
  const requestedMaxCamber = optionStyle.maxCamberYd ?? options.maxCamberYd;
  const maxCamberYd = Number.isFinite(requestedMaxCamber) && requestedMaxCamber >= 0
    ? requestedMaxCamber
    : COURSE_BRIDGE_SURFACE_DEFAULTS.maxCamberYd;
  const requestedDeckClearance = optionStyle.deckClearanceYd ?? options.deckClearanceYd;
  const deckClearanceYd = Number.isFinite(requestedDeckClearance) && requestedDeckClearance >= 0
    ? requestedDeckClearance
    : null;
  const styleOptions = { sampleSpacingYd, camberRatio, maxCamberYd, deckClearanceYd };
  const terrainHeightYdAt = typeof options.terrainHeightYdAt === 'function'
    ? options.terrainHeightYdAt
    : (x, y) => sampleCourseElevationYd(course, x, y);
  const paths = Array.isArray(course?.paths) ? course.paths : [];
  const surfaces = [];
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
    const surface = buildSurface(
      course,
      paths[pathIndex],
      pathIndex,
      styleOptions,
      terrainHeightYdAt,
    );
    if (surface) surfaces.push(surface);
  }
  return { cellYd: CELL_YD, sampleSpacingYd, surfaces };
}

function segmentCandidate(surface, segmentIndex, x, y) {
  const start = surface.stations[segmentIndex];
  const end = surface.stations[segmentIndex + 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > EPSILON)) return null;
  const rawAmount = ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared;
  // Each dense span is a narrow rectangle. Requiring the projection to remain
  // on that span prevents closest-point clamping from growing round caps at
  // every sample station (and, most importantly, beyond a partial bridge's
  // authored start/end). The sampling is dense enough that curved-span corner
  // gaps remain far below gameplay/raycast precision.
  if (rawAmount < -EPSILON || rawAmount > 1 + EPSILON) return null;
  const amount = clamp(rawAmount, 0, 1);
  const centerX = start.x + dx * amount;
  const centerY = start.y + dy * amount;
  const offsetX = x - centerX;
  const offsetY = y - centerY;
  const distanceSquared = offsetX * offsetX + offsetY * offsetY;
  if (distanceSquared > surface.halfWidthCells * surface.halfWidthCells + EPSILON) return null;
  return {
    surface,
    segmentIndex,
    amount,
    centerX,
    centerY,
    distanceSquared,
    dx,
    dy,
  };
}

/**
 * Query one fractional course point against a prebuilt bridge index.
 * Returns null off-deck, otherwise stable path/t/height/clearance information.
 */
export function queryCourseBridgeSurface(index, x, y) {
  if (x && typeof x === 'object') {
    y = x.y;
    x = x.x;
  }
  if (!index || !Array.isArray(index.surfaces) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  let best = null;
  for (const surface of index.surfaces) {
    const bounds = surface?.bounds;
    if (!bounds || x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
    for (let segmentIndex = 0; segmentIndex < surface.stations.length - 1; segmentIndex += 1) {
      const candidate = segmentCandidate(surface, segmentIndex, x, y);
      if (!candidate) continue;
      if (!best || candidate.distanceSquared < best.distanceSquared - EPSILON) best = candidate;
    }
  }
  if (!best) return null;

  const { surface, segmentIndex, amount, centerX, centerY, dx, dy } = best;
  const start = surface.stations[segmentIndex];
  const end = surface.stations[segmentIndex + 1];
  const interpolate = (key) => start[key] + (end[key] - start[key]) * amount;
  const tangentLength = Math.hypot(dx, dy);
  const nx = -dy / tangentLength;
  const ny = dx / tangentLength;
  const deckHeightYd = interpolate('deckHeightYd');
  const terrainHeightYd = interpolate('terrainHeightYd');
  const highTerrainHeightYd = interpolate('highTerrainHeightYd');
  const clearanceYd = deckHeightYd - terrainHeightYd;
  const minimumClearanceYd = deckHeightYd - highTerrainHeightYd;
  return {
    onBridge: true,
    zone: ZONE.PATH,
    pathId: surface.pathId,
    pathIndex: surface.pathIndex,
    pathT: interpolate('pathT'),
    bridgeT: interpolate('bridgeT'),
    center: { x: centerX, y: centerY },
    tangent: { x: dx / tangentLength, y: dy / tangentLength },
    lateralYd: ((x - centerX) * nx + (y - centerY) * ny) * CELL_YD,
    distanceFromCenterYd: Math.sqrt(best.distanceSquared) * CELL_YD,
    widthYd: surface.widthYd,
    deckHeightYd,
    deckHeightFt: deckHeightYd * FEET_PER_YARD,
    terrainHeightYd,
    terrainHeightFt: terrainHeightYd * FEET_PER_YARD,
    clearanceYd,
    clearanceFt: clearanceYd * FEET_PER_YARD,
    minimumClearanceYd,
    minimumClearanceFt: minimumClearanceYd * FEET_PER_YARD,
    camberYd: surface.camberYd,
    configuredDeckHeightFt: surface.settings.deckHeightFt,
    configuredClearanceFt: surface.settings.clearanceFt,
    requiredClearanceFt: surface.style.deckClearanceYd * FEET_PER_YARD,
  };
}

export function isCourseBridgeSurfaceAt(index, x, y) {
  return queryCourseBridgeSurface(index, x, y) !== null;
}
