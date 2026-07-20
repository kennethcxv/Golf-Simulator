// GOLF EMPIRE — high-resolution, region-based course maintenance.
//
// The existing turf simulation remains the course-wide source consumed by the
// economy, golfers, reviews, and course editor. This module adds a one-yard
// physical work surface around one data-selected hero hole and synchronizes
// touched coarse cells back into that established interface.

import { CELL_YD, TURF_ZONES, ZONE } from './constants.js';
import { calendarOf } from './time.js';
import { holeDistanceYd } from './course.js';
import { clamp, distToSegment, makeRng } from '../core/utils.js';

export const COURSE_MAINTENANCE_VERSION = 1;
export const MAINTENANCE_RESOLUTION_YD = 1;
export const NEVER_DAY = 65535;

export const SURFACE = Object.freeze({
  NONE: 0,
  GREEN: 1,
  FRINGE: 2,
  TEE: 3,
  FAIRWAY: 4,
  ROUGH: 5,
  NATIVE: 6,
  BUNKER: 7,
});

export const SURFACE_NAMES = Object.freeze([
  'None',
  'Green',
  'Fringe',
  'Tee',
  'Fairway',
  'Rough',
  'Native rough',
  'Bunker',
]);

export const DISEASE = Object.freeze({
  NONE: 0,
  DOLLAR_SPOT: 1,
  BROWN_PATCH: 2,
});

export const DISEASE_NAMES = Object.freeze([
  'None',
  'Dollar spot',
  'Brown patch',
]);

const TARGET_HEIGHT_MM = Object.freeze({
  [SURFACE.GREEN]: 4,
  [SURFACE.FRINGE]: 8,
  [SURFACE.TEE]: 10,
  [SURFACE.FAIRWAY]: 14,
  [SURFACE.ROUGH]: 45,
  [SURFACE.NATIVE]: 90,
  [SURFACE.BUNKER]: 0,
});

const TARGET_HEIGHT_Q = Uint8Array.from(
  SURFACE_NAMES.map((_, surface) => Math.round((TARGET_HEIGHT_MM[surface] || 0) * 2)),
);

const IDEAL_MOISTURE = Object.freeze({
  [SURFACE.GREEN]: [42, 68],
  [SURFACE.FRINGE]: [38, 68],
  [SURFACE.TEE]: [36, 68],
  [SURFACE.FAIRWAY]: [32, 66],
  [SURFACE.ROUGH]: [24, 74],
  [SURFACE.NATIVE]: [15, 82],
  [SURFACE.BUNKER]: [12, 38],
});

const IDEAL_FERTILIZER = Object.freeze({
  [SURFACE.GREEN]: [42, 72],
  [SURFACE.FRINGE]: [38, 70],
  [SURFACE.TEE]: [38, 70],
  [SURFACE.FAIRWAY]: [34, 68],
  [SURFACE.ROUGH]: [22, 68],
  [SURFACE.NATIVE]: [0, 100],
  [SURFACE.BUNKER]: [0, 100],
});

const MANAGED_TURF = new Set([
  SURFACE.GREEN,
  SURFACE.FRINGE,
  SURFACE.TEE,
  SURFACE.FAIRWAY,
  SURFACE.ROUGH,
]);

const ALL_TURF = new Set([
  ...MANAGED_TURF,
  SURFACE.NATIVE,
]);

const SERIAL_FIELDS = Object.freeze({
  heightQ: Uint8Array,
  moisture: Uint8Array,
  health: Uint8Array,
  wear: Uint8Array,
  diseasePressure: Uint8Array,
  fertilizer: Uint8Array,
  fertilizerPending: Uint8Array,
  compaction: Uint8Array,
  visual: Uint8Array,
  mowAngle: Uint8Array,
  mowQuality: Uint8Array,
  mowPasses: Uint8Array,
  diseaseType: Uint8Array,
  diseaseSeverity: Uint8Array,
  treatedDays: Uint8Array,
  bunkerSmooth: Uint8Array,
  rakeAngle: Uint8Array,
  lastMowDay: Uint16Array,
  lastIrrigationDay: Uint16Array,
  lastFertilizerDay: Uint16Array,
  lastRakeDay: Uint16Array,
});

const SCORE_WEIGHTS = Object.freeze({
  mowing: 14,
  moisture: 10,
  turfHealth: 14,
  greenQuality: 12,
  teeQuality: 7,
  fairwayQuality: 10,
  roughManagement: 5,
  bunkerCondition: 8,
  divotsAndBallMarks: 8,
  debris: 4,
  disease: 8,
});

function surfaceFromZone(zone) {
  switch (zone) {
    case ZONE.GREEN: return SURFACE.GREEN;
    case ZONE.TEE: return SURFACE.TEE;
    case ZONE.FAIRWAY: return SURFACE.FAIRWAY;
    case ZONE.ROUGH: return SURFACE.ROUGH;
    case ZONE.BUNKER: return SURFACE.BUNKER;
    case ZONE.OUT: return SURFACE.NATIVE;
    default: return SURFACE.NONE;
  }
}

function targetHeightQ(surface) {
  return TARGET_HEIGHT_Q[surface] || 0;
}

export function targetHeightMm(surface) {
  return TARGET_HEIGHT_MM[surface] ?? null;
}

export function maintenanceSurfaceName(surface) {
  return SURFACE_NAMES[surface] || SURFACE_NAMES[0];
}

function holeCorridorDistance(hole, x, y) {
  return distToSegment(x, y, hole.tee.x, hole.tee.y, hole.pin.x, hole.pin.y);
}

function closestHole(course, x, y) {
  let closest = null;
  let distance = Infinity;
  for (const hole of course.holes) {
    if (!hole.tee || !hole.pin) continue;
    const next = holeCorridorDistance(hole, x, y);
    if (next < distance) {
      closest = hole;
      distance = next;
    }
  }
  return { hole: closest, distance };
}

function nearbyZoneCount(course, hole, zone, maxDistance) {
  let count = 0;
  for (let i = 0; i < course.zones.length; i++) {
    if (course.zones[i] !== zone) continue;
    const x = i % course.w;
    const y = Math.floor(i / course.w);
    if (holeCorridorDistance(hole, x, y) <= maxDistance) count++;
  }
  return count;
}

function nearbyZoneDistance(course, hole, zone) {
  let distance = Infinity;
  for (let i = 0; i < course.zones.length; i++) {
    if (course.zones[i] !== zone) continue;
    const x = i % course.w;
    const y = Math.floor(i / course.w);
    distance = Math.min(distance, holeCorridorDistance(hole, x, y));
  }
  return distance;
}

export function scoreHeroHoleCandidate(state, hole) {
  const course = state.course;
  const length = holeDistanceYd(hole);
  const bunkerCells = nearbyZoneCount(course, hole, ZONE.BUNKER, 7);
  const waterDistance = nearbyZoneDistance(course, hole, ZONE.WATER);
  const structure = course.structures.find((item) => item.type === 'clubhouse');
  const accessDistance = structure
    ? Math.hypot(
        hole.tee.x - (structure.x + structure.w / 2),
        hole.tee.y - (structure.y + structure.h / 2),
      )
    : 60;
  const lengthScore = clamp(length / 20, 4, 25);
  const bunkerScore = bunkerCells > 0 ? 25 : 0;
  const waterScore = waterDistance <= 12 ? 25 : waterDistance <= 20 ? 12 : 0;
  const accessScore = clamp(15 - accessDistance * 0.22, 0, 15);
  const completeScore = hole.tee && hole.pin ? 10 : 0;
  return {
    holeId: hole.id,
    total: lengthScore + bunkerScore + waterScore + accessScore + completeScore,
    lengthYd: length,
    bunkerCells,
    waterDistanceCells: Number.isFinite(waterDistance) ? waterDistance : null,
    equipmentDistanceCells: accessDistance,
  };
}

export function selectHeroHole(state) {
  const candidates = state.course.holes
    .filter((hole) => hole.tee && hole.pin)
    .map((hole) => ({ hole, score: scoreHeroHoleCandidate(state, hole) }))
    .sort((a, b) => (
      b.score.total - a.score.total
      || b.score.lengthYd - a.score.lengthYd
      || a.hole.id - b.hole.id
    ));
  return candidates.length ? candidates[0] : null;
}

function sectionOwnerMap(state) {
  const owners = new Int32Array(state.course.w * state.course.h).fill(-1);
  for (const section of state.sections || []) {
    for (const cell of section.cells) owners[cell] = section.holeId ?? -1;
  }
  return owners;
}

function eligibleCoarseCells(state, heroHole) {
  const course = state.course;
  const sectionOwners = sectionOwnerMap(state);
  const eligible = new Set();
  for (let i = 0; i < course.zones.length; i++) {
    const zone = course.zones[i];
    if (
      zone !== ZONE.GREEN
      && zone !== ZONE.TEE
      && zone !== ZONE.FAIRWAY
      && zone !== ZONE.ROUGH
      && zone !== ZONE.BUNKER
      && zone !== ZONE.OUT
    ) continue;
    const x = i % course.w;
    const y = Math.floor(i / course.w);
    const heroDistance = holeCorridorDistance(heroHole, x, y);
    const nearest = closestHole(course, x, y);
    const sectionOwns = sectionOwners[i] === heroHole.id;
    let include = false;
    if (zone === ZONE.GREEN || zone === ZONE.TEE) {
      include = sectionOwns;
    } else if (zone === ZONE.FAIRWAY || zone === ZONE.BUNKER) {
      include = sectionOwns || (nearest.hole?.id === heroHole.id && heroDistance <= 7);
    } else if (zone === ZONE.ROUGH) {
      include = nearest.hole?.id === heroHole.id && heroDistance <= 7;
    } else if (zone === ZONE.OUT) {
      include = nearest.hole?.id === heroHole.id
        && heroDistance > 4.8
        && heroDistance <= 7.2;
    }
    if (include) eligible.add(i);
  }
  return eligible;
}

function regionBounds(course, eligible) {
  let minX = course.w;
  let minY = course.h;
  let maxX = 0;
  let maxY = 0;
  for (const i of eligible) {
    const x = i % course.w;
    const y = Math.floor(i / course.w);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    minCellX: clamp(minX - 1, 0, course.w - 1),
    minCellY: clamp(minY - 1, 0, course.h - 1),
    maxCellX: clamp(maxX + 1, 0, course.w - 1),
    maxCellY: clamp(maxY + 1, 0, course.h - 1),
  };
}

function fineWorldPoint(model, x, y) {
  return {
    x: model.bounds.minCourseYdX + (x + 0.5) * model.resolutionYd
      - model.courseWorldWidthYd / 2,
    z: model.bounds.minCourseYdY + (y + 0.5) * model.resolutionYd
      - model.courseWorldHeightYd / 2,
  };
}

export function worldPointForMaintenanceCell(model, index) {
  const x = index % model.width;
  const y = Math.floor(index / model.width);
  return fineWorldPoint(model, x, y);
}

export function maintenanceIndexAtWorld(model, worldX, worldZ) {
  const courseYdX = worldX + model.courseWorldWidthYd / 2;
  const courseYdY = worldZ + model.courseWorldHeightYd / 2;
  const x = Math.floor((courseYdX - model.bounds.minCourseYdX) / model.resolutionYd);
  const y = Math.floor((courseYdY - model.bounds.minCourseYdY) / model.resolutionYd);
  if (x < 0 || y < 0 || x >= model.width || y >= model.height) return -1;
  const index = y * model.width + x;
  return model.surface[index] === SURFACE.NONE ? -1 : index;
}

function coarseIndexForFine(model, state, fineIndex) {
  const x = fineIndex % model.width;
  const y = Math.floor(fineIndex / model.width);
  const courseYdX = model.bounds.minCourseYdX + (x + 0.5) * model.resolutionYd;
  const courseYdY = model.bounds.minCourseYdY + (y + 0.5) * model.resolutionYd;
  const cx = Math.floor(courseYdX / CELL_YD);
  const cy = Math.floor(courseYdY / CELL_YD);
  if (cx < 0 || cy < 0 || cx >= state.course.w || cy >= state.course.h) return -1;
  return cy * state.course.w + cx;
}

function coarseSnapshot(state, coarse) {
  if (!state.turf || !TURF_ZONES.has(state.course.zones[coarse])) return null;
  return {
    heightMm: state.turf.heightMm[coarse],
    moisture: state.turf.moisture[coarse],
    health: state.turf.health[coarse],
    wear: state.turf.wear[coarse],
    fertilizer: state.turf.nutrients[coarse],
    diseaseType: state.turf.disType[coarse],
    diseaseSeverity: state.turf.disSev[coarse],
    treatedDays: state.turf.treated[coarse],
  };
}

function makeRuntime(model, state) {
  const activeIndices = [];
  const surfaceIndices = Array.from({ length: SURFACE_NAMES.length }, () => []);
  const fineByCoarse = new Map();

  // Maintenance bounds and the one-yard grid are coarse-cell aligned. Build
  // topology a tile at a time so each 8x8 block performs one Map insertion
  // instead of doing coordinate division and a Map lookup for every fine cell.
  // Keep a generic row-major path for migrated or hand-authored layouts.
  const finePerCoarse = CELL_YD / model.resolutionYd;
  const originCellX = model.bounds.minCourseYdX / CELL_YD;
  const originCellY = model.bounds.minCourseYdY / CELL_YD;
  const aligned = Number.isInteger(finePerCoarse)
    && Number.isInteger(originCellX)
    && Number.isInteger(originCellY)
    && model.width % finePerCoarse === 0
    && model.height % finePerCoarse === 0;
  const addIndex = (index, surface, bucket) => {
    activeIndices.push(index);
    surfaceIndices[surface].push(index);
    model.targetHeightQ[index] = TARGET_HEIGHT_Q[surface] || 0;
    bucket.push(index);
  };

  if (aligned) {
    const tileRows = model.height / finePerCoarse;
    const tileColumns = model.width / finePerCoarse;
    for (let tileY = 0; tileY < tileRows; tileY++) {
      const coarseY = originCellY + tileY;
      for (let tileX = 0; tileX < tileColumns; tileX++) {
        const coarseX = originCellX + tileX;
        const coarse = coarseY >= 0 && coarseY < state.course.h
          && coarseX >= 0 && coarseX < state.course.w
          ? coarseY * state.course.w + coarseX
          : -1;
        const bucket = [];
        const x0 = tileX * finePerCoarse;
        const y0 = tileY * finePerCoarse;
        for (let y = y0; y < y0 + finePerCoarse; y++) {
          const row = y * model.width;
          for (let x = x0; x < x0 + finePerCoarse; x++) {
            const index = row + x;
            const surface = model.surface[index];
            if (surface !== SURFACE.NONE) addIndex(index, surface, bucket);
          }
        }
        if (coarse >= 0 && bucket.length) fineByCoarse.set(coarse, bucket);
      }
    }
  } else {
    const coarseXByFineX = new Int32Array(model.width);
    for (let x = 0; x < model.width; x++) {
      const courseYdX = model.bounds.minCourseYdX + (x + 0.5) * model.resolutionYd;
      coarseXByFineX[x] = Math.floor(courseYdX / CELL_YD);
    }
    for (let y = 0; y < model.height; y++) {
      const courseYdY = model.bounds.minCourseYdY + (y + 0.5) * model.resolutionYd;
      const coarseY = Math.floor(courseYdY / CELL_YD);
      const row = y * model.width;
      for (let x = 0; x < model.width; x++) {
        const index = row + x;
        const surface = model.surface[index];
        if (surface === SURFACE.NONE) continue;
        const coarseX = coarseXByFineX[x];
        const coarse = coarseX >= 0 && coarseX < state.course.w
          && coarseY >= 0 && coarseY < state.course.h
          ? coarseY * state.course.w + coarseX
          : -1;
        let bucket = coarse >= 0 ? fineByCoarse.get(coarse) : null;
        if (coarse >= 0 && !bucket) {
          bucket = [];
          fineByCoarse.set(coarse, bucket);
        }
        addIndex(index, surface, bucket || []);
      }
    }
  }
  Object.defineProperty(model, 'runtime', {
    configurable: true,
    enumerable: false,
    value: {
      dirtyRows: new Map(),
      scoreDirty: true,
      coarseDirty: new Set(),
      activeIndices,
      surfaceIndices,
      fineByCoarse,
      coarseShadow: new Map(),
      doseRemainders: {
        moisture: new Float32Array(model.surface.length),
        fertilizer: new Float32Array(model.surface.length),
        disease: new Float32Array(model.surface.length),
        rake: new Float32Array(model.surface.length),
      },
      saveRevision: 0,
      encodedRevision: -1,
      encodedFields: null,
    },
  });
}

function markDirty(model, index) {
  const x = index % model.width;
  const y = Math.floor(index / model.width);
  const row = model.runtime.dirtyRows.get(y);
  if (row) {
    row.minX = Math.min(row.minX, x);
    row.maxX = Math.max(row.maxX, x);
  } else {
    model.runtime.dirtyRows.set(y, { y, minX: x, maxX: x });
  }
  model.runtime.scoreDirty = true;
  model.runtime.saveRevision++;
}

function markCoarseDirty(model, state, index) {
  const coarse = coarseIndexForFine(model, state, index);
  if (coarse >= 0) model.runtime.coarseDirty.add(coarse);
}

export function consumeCourseMaintenanceDirtyRows(model) {
  const rows = [...model.runtime.dirtyRows.values()].sort((a, b) => a.y - b.y);
  model.runtime.dirtyRows.clear();
  return rows;
}

function visualState(model, index) {
  if (model.surface[index] === SURFACE.NONE) return 0;
  let visual = model.mowPasses[index] > 0 ? 1 : 0;
  if (model.moisture[index] >= 70) visual |= 2;
  if (model.moisture[index] <= 28) visual |= 4;
  if (model.health[index] <= 48) visual |= 8;
  if (model.diseaseSeverity[index] > 4) visual |= 16;
  if (model.fertilizer[index] >= 82) visual |= 32;
  if (model.wear[index] >= 45) visual |= 64;
  if (model.bunkerSmooth[index] >= 88) visual |= 128;
  return visual;
}

function refreshVisual(model, index) {
  const next = visualState(model, index);
  if (next !== model.visual[index]) {
    model.visual[index] = next;
    markDirty(model, index);
  }
}

function hashSurface(surface) {
  let hash = 2166136261;
  for (let i = 0; i < surface.length; i++) {
    hash ^= surface[i];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function hashCourseLayout(state) {
  let hash = 2166136261;
  const mix = (value) => {
    let next = Number(value) >>> 0;
    for (let byte = 0; byte < 4; byte++) {
      hash ^= next & 0xff;
      hash = Math.imul(hash, 16777619);
      next >>>= 8;
    }
  };
  mix(state.course.w);
  mix(state.course.h);
  for (let index = 0; index < state.course.zones.length; index++) mix(state.course.zones[index]);
  for (const hole of state.course.holes) {
    mix(hole.id);
    mix(hole.tee?.x ?? -1);
    mix(hole.tee?.y ?? -1);
    mix(hole.pin?.x ?? -1);
    mix(hole.pin?.y ?? -1);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createFieldArrays(length) {
  const fields = {};
  for (const [name, Type] of Object.entries(SERIAL_FIELDS)) {
    fields[name] = new Type(length);
  }
  for (const name of [
    'lastMowDay',
    'lastIrrigationDay',
    'lastFertilizerDay',
    'lastRakeDay',
  ]) fields[name].fill(NEVER_DAY);
  return fields;
}

function initialCoarseTurf(state, coarseIndex, surface) {
  if (state.turf && TURF_ZONES.has(state.course.zones[coarseIndex])) {
    return {
      heightMm: state.turf.heightMm[coarseIndex],
      moisture: state.turf.moisture[coarseIndex],
      health: state.turf.health[coarseIndex],
      wear: state.turf.wear[coarseIndex],
      fertilizer: state.turf.nutrients[coarseIndex],
      diseaseType: state.turf.disType[coarseIndex],
      diseaseSeverity: state.turf.disSev[coarseIndex],
      treatedDays: state.turf.treated[coarseIndex],
    };
  }
  if (surface === SURFACE.BUNKER) {
    return {
      heightMm: 0,
      moisture: 30,
      health: 72,
      wear: 0,
      fertilizer: 0,
      diseaseType: 0,
      diseaseSeverity: 0,
      treatedDays: 0,
    };
  }
  return {
    heightMm: TARGET_HEIGHT_MM[SURFACE.NATIVE],
    moisture: 42,
    health: 65,
    wear: 3,
    fertilizer: 28,
    diseaseType: 0,
    diseaseSeverity: 0,
    treatedDays: 0,
  };
}

function putInitialFields(model, state) {
  for (const index of model.runtime.activeIndices) {
    const surface = model.surface[index];
    const coarse = coarseIndexForFine(model, state, index);
    const initial = initialCoarseTurf(state, coarse, surface);
    model.heightQ[index] = clamp(Math.round(initial.heightMm * 2), 0, 255);
    model.moisture[index] = clamp(Math.round(initial.moisture), 0, 100);
    model.health[index] = clamp(Math.round(initial.health), 0, 100);
    model.wear[index] = clamp(Math.round(initial.wear), 0, 100);
    model.fertilizer[index] = clamp(Math.round(initial.fertilizer), 0, 100);
    model.compaction[index] = clamp(Math.round(initial.wear * 0.45), 0, 100);
    model.diseaseType[index] = initial.diseaseType || 0;
    model.diseaseSeverity[index] = clamp(Math.round(initial.diseaseSeverity), 0, 100);
    model.treatedDays[index] = clamp(Math.round(initial.treatedDays), 0, 255);
    model.bunkerSmooth[index] = surface === SURFACE.BUNKER ? 78 : 0;
    model.visual[index] = visualState(model, index);
  }
}

function buildSurfaceMask(state, heroHole, eligible, bounds) {
  const resolutionYd = MAINTENANCE_RESOLUTION_YD;
  const width = Math.round(
    ((bounds.maxCellX - bounds.minCellX + 1) * CELL_YD) / resolutionYd,
  );
  const height = Math.round(
    ((bounds.maxCellY - bounds.minCellY + 1) * CELL_YD) / resolutionYd,
  );
  const surface = new Uint8Array(width * height);
  const pinCourseYd = {
    x: (heroHole.pin.x + 0.5) * CELL_YD,
    y: (heroHole.pin.y + 0.5) * CELL_YD,
  };
  const minCourseYdX = bounds.minCellX * CELL_YD;
  const minCourseYdY = bounds.minCellY * CELL_YD;
  for (let y = 0; y < height; y++) {
    const courseYdY = minCourseYdY + (y + 0.5) * resolutionYd;
    const cy = Math.floor(courseYdY / CELL_YD);
    for (let x = 0; x < width; x++) {
      const courseYdX = minCourseYdX + (x + 0.5) * resolutionYd;
      const cx = Math.floor(courseYdX / CELL_YD);
      const coarse = cy * state.course.w + cx;
      if (!eligible.has(coarse)) continue;
      let next = surfaceFromZone(state.course.zones[coarse]);
      const distanceToPinYd = Math.hypot(
        courseYdX - pinCourseYd.x,
        courseYdY - pinCourseYd.y,
      );
      if (
        next !== SURFACE.GREEN
        && ALL_TURF.has(next)
        && distanceToPinYd <= 19
      ) next = SURFACE.FRINGE;
      surface[y * width + x] = next;
    }
  }
  return {
    surface,
    width,
    height,
    resolutionYd,
    bounds: {
      ...bounds,
      minCourseYdX,
      minCourseYdY,
      maxCourseYdX: (bounds.maxCellX + 1) * CELL_YD,
      maxCourseYdY: (bounds.maxCellY + 1) * CELL_YD,
    },
  };
}

function candidateIndices(model, surfaces, predicate = null) {
  const result = [];
  for (const surface of surfaces) {
    for (const index of model.runtime.surfaceIndices[surface] || []) {
      if (!predicate || predicate(index)) result.push(index);
    }
  }
  return result;
}

function separatedPick(model, candidates, count, rng, minDistanceYd) {
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picked = [];
  for (const index of shuffled) {
    const point = worldPointForMaintenanceCell(model, index);
    if (picked.some((other) => {
      const otherPoint = worldPointForMaintenanceCell(model, other);
      return Math.hypot(point.x - otherPoint.x, point.z - otherPoint.z)
        < minDistanceYd;
    })) continue;
    picked.push(index);
    if (picked.length >= count) break;
  }
  return picked;
}

function damagePatch(model, centerIndex, radiusYd, mutator) {
  const center = worldPointForMaintenanceCell(model, centerIndex);
  const radiusCells = Math.ceil(radiusYd / model.resolutionYd);
  const cx = centerIndex % model.width;
  const cy = Math.floor(centerIndex / model.width);
  for (let y = Math.max(0, cy - radiusCells); y <= Math.min(model.height - 1, cy + radiusCells); y++) {
    for (let x = Math.max(0, cx - radiusCells); x <= Math.min(model.width - 1, cx + radiusCells); x++) {
      const index = y * model.width + x;
      if (model.surface[index] === SURFACE.NONE) continue;
      const point = fineWorldPoint(model, x, y);
      const distance = Math.hypot(point.x - center.x, point.z - center.z);
      if (distance > radiusYd) continue;
      mutator(index, 1 - distance / radiusYd);
      refreshVisual(model, index);
      // Not every meaningful numeric change crosses a visual bit threshold.
      // Persistence invalidation therefore follows the physical mutation, not
      // only the derived appearance.
      markDirty(model, index);
    }
  }
}

function makeIssue(model, type, index, serial, extra = {}) {
  const point = worldPointForMaintenanceCell(model, index);
  return {
    id: type + '-' + model.heroHoleId + '-' + serial,
    type,
    x: Number(point.x.toFixed(2)),
    z: Number(point.z.toFixed(2)),
    surface: model.surface[index],
    repaired: false,
    progress: 0,
    ...extra,
  };
}

function seedHeroProblems(model, state) {
  const rng = makeRng(((state.seed ^ (model.heroHoleId * 0x45d9f3b)) >>> 0) || 1);
  const divotCandidates = candidateIndices(
    model,
    [SURFACE.FAIRWAY, SURFACE.TEE],
    (index) => model.wear[index] >= 5,
  );
  const ballCandidates = candidateIndices(model, [SURFACE.GREEN]);
  const bunkerCandidates = candidateIndices(model, [SURFACE.BUNKER]);
  const debrisCandidates = candidateIndices(
    model,
    [SURFACE.ROUGH, SURFACE.NATIVE, SURFACE.FAIRWAY],
  );

  model.issues = {
    divots: separatedPick(model, divotCandidates, 6, rng, 12)
      .map((index, serial) => {
        damagePatch(model, index, 2.2, (cell, falloff) => {
          model.wear[cell] = clamp(model.wear[cell] + 45 * falloff, 0, 100);
          model.health[cell] = clamp(model.health[cell] - 8 * falloff, 0, 100);
        });
        return makeIssue(model, 'divot', index, serial + 1, {
          severity: 55 + rng.int(31),
          stage: 'open',
          mixProgress: 0,
          levelProgress: 0,
          recoveryHours: 0,
        });
      }),
    ballMarks: separatedPick(model, ballCandidates, 3, rng, 5)
      .map((index, serial) => {
        damagePatch(model, index, 1.4, (cell, falloff) => {
          model.wear[cell] = clamp(model.wear[cell] + 35 * falloff, 0, 100);
          model.health[cell] = clamp(model.health[cell] - 6 * falloff, 0, 100);
        });
        return makeIssue(model, 'ball-mark', index, serial + 1, {
          severity: 45 + rng.int(36),
          liftProgress: 0,
        });
      }),
    bunkerFootprints: separatedPick(model, bunkerCandidates, 7, rng, 3)
      .map((index, serial) => {
        damagePatch(model, index, 1.6, (cell, falloff) => {
          model.wear[cell] = clamp(model.wear[cell] + 70 * falloff, 0, 100);
          model.bunkerSmooth[cell] = clamp(model.bunkerSmooth[cell] - 65 * falloff, 0, 100);
        });
        return makeIssue(model, 'footprint', index, serial + 1, {
          severity: 55 + rng.int(36),
        });
      }),
    debris: separatedPick(model, debrisCandidates, 4, rng, 20)
      .map((index, serial) => makeIssue(
        model,
        ['leaves', 'branch', 'trash', 'storm-debris'][serial],
        index,
        serial + 1,
        { cleared: false, bagProgress: 0 },
      )),
  };

  const dryCandidates = candidateIndices(model, [SURFACE.FAIRWAY]);
  const dry = dryCandidates.length ? dryCandidates[Math.floor(dryCandidates.length * 0.68)] : -1;
  if (dry >= 0) {
    damagePatch(model, dry, 12, (index, falloff) => {
      model.moisture[index] = clamp(model.moisture[index] - 29 * falloff, 8, 100);
      model.health[index] = clamp(model.health[index] - 8 * falloff, 20, 100);
    });
  }
  const weak = dryCandidates.length ? dryCandidates[Math.floor(dryCandidates.length * 0.36)] : -1;
  if (weak >= 0) {
    damagePatch(model, weak, 10, (index, falloff) => {
      model.fertilizer[index] = clamp(model.fertilizer[index] - 30 * falloff, 5, 100);
      model.health[index] = clamp(model.health[index] - 10 * falloff, 18, 100);
    });
  }
  const diseaseCandidates = candidateIndices(model, [SURFACE.GREEN, SURFACE.FRINGE]);
  const disease = diseaseCandidates.length
    ? diseaseCandidates[Math.floor(diseaseCandidates.length * 0.42)]
    : -1;
  if (disease >= 0) {
    damagePatch(model, disease, 5.5, (index, falloff) => {
      model.diseaseType[index] = DISEASE.DOLLAR_SPOT;
      model.diseasePressure[index] = clamp(72 + 24 * falloff, 0, 100);
      model.diseaseSeverity[index] = clamp(12 + 35 * falloff, 0, 100);
      model.fertilizer[index] = clamp(model.fertilizer[index] - 18 * falloff, 8, 100);
      model.health[index] = clamp(model.health[index] - 13 * falloff, 16, 100);
    });
  }
}

function makeWorkOrder(model) {
  return {
    id: 'maintenance-day-hole-' + model.heroHoleId,
    title: 'Restore Hole ' + model.heroHoleNumber,
    startedAtMinute: null,
    completedAtMinute: null,
    steps: [
      { id: 'arrive', label: 'Arrive at the maintenance yard', complete: false },
      { id: 'review', label: 'Review the work order', complete: false },
      { id: 'inspect', label: 'Inspect Hole ' + model.heroHoleNumber, complete: false },
      { id: 'equipment', label: 'Select the required equipment', complete: false },
      { id: 'mow', label: 'Mow the required surfaces', complete: false },
      { id: 'irrigate', label: 'Irrigate dry turf', complete: false },
      { id: 'fertilize', label: 'Fertilize weak turf', complete: false },
      { id: 'divots', label: 'Repair the divots', complete: false },
      { id: 'ball-marks', label: 'Repair the ball marks', complete: false },
      { id: 'bunker', label: 'Rake the bunker', complete: false },
      { id: 'debris', label: 'Remove course debris', complete: false },
      { id: 'disease', label: 'Treat or flag disease', complete: false },
      { id: 'reinspect', label: 'Reinspect the completed work', complete: false },
      { id: 'condition', label: 'Raise hole condition to 75', complete: false },
      { id: 'save-load', label: 'Save, reload, and confirm persistence', complete: false },
    ],
  };
}

function makeEquipmentState() {
  return {
    tractor: {
      engineOn: false,
      bladesEngaged: false,
      mowerType: 'fairway-reel',
      fuel: 100,
      condition: 82,
    },
    greensMower: {
      engineOn: false,
      bladesEngaged: false,
      mowerType: 'greens-reel',
      fuel: 100,
      condition: 88,
    },
    hose: { nozzle: 'fan', connected: false, flow: 0 },
    spreader: { gateOpen: false, rate: 1 },
    divotKit: { loaded: true },
    ballMarkFork: { clean: true },
    bunkerRake: { condition: 92 },
    debrisBag: { open: false, fill: 0 },
  };
}

function makeInventory() {
  return {
    fertilizerKg: 28,
    fungicideLiters: 8,
    turfMixUses: 8,
    debrisBags: 4,
  };
}

function worldIrrigationContext(state, heroHole) {
  const worldW = state.course.w * CELL_YD;
  const worldH = state.course.h * CELL_YD;
  const world = (x, y) => ({
    x: (x + 0.5) * CELL_YD - worldW / 2,
    z: (y + 0.5) * CELL_YD - worldH / 2,
  });
  const green = world(heroHole.pin.x, heroHole.pin.y);
  const tee = world(heroHole.tee.x, heroHole.tee.y);
  return {
    controller: {
      x: Number((tee.x + 4).toFixed(2)),
      z: Number((tee.z - 5).toFixed(2)),
      enabled: true,
    },
    heads: [
      {
        id: 'head-' + heroHole.id + '-green',
        x: Number((green.x + 16).toFixed(2)),
        z: Number((green.z - 5).toFixed(2)),
        radiusYd: 21,
        status: 'dry',
        enabled: false,
      },
      {
        id: 'head-' + heroHole.id + '-approach',
        x: Number((green.x - 31).toFixed(2)),
        z: Number((green.z + 3).toFixed(2)),
        radiusYd: 24,
        status: 'clogged',
        enabled: false,
      },
    ],
  };
}

function buildCourseMaintenance(state, heroSelection = null, { syncInitial = true } = {}) {
  const selection = heroSelection || selectHeroHole(state);
  if (!selection) return null;
  const heroHole = selection.hole;
  const eligible = eligibleCoarseCells(state, heroHole);
  const bounds = regionBounds(state.course, eligible);
  const mask = buildSurfaceMask(state, heroHole, eligible, bounds);
  const fields = createFieldArrays(mask.surface.length);
  const heroHoleNumber = state.course.holes.findIndex((hole) => hole.id === heroHole.id) + 1;
  const model = {
    version: COURSE_MAINTENANCE_VERSION,
    heroHoleId: heroHole.id,
    heroHoleNumber,
    heroSelectionScore: selection.score,
    resolutionYd: mask.resolutionYd,
    width: mask.width,
    height: mask.height,
    bounds: mask.bounds,
    courseWorldWidthYd: state.course.w * CELL_YD,
    courseWorldHeightYd: state.course.h * CELL_YD,
    courseLayoutHash: hashCourseLayout(state),
    saveIdPrefix: 'course-maintenance:hole-' + heroHole.id,
    surface: mask.surface,
    targetHeightQ: new Uint8Array(mask.surface.length),
    ...fields,
    issues: null,
    inspection: {
      active: false,
      selectedMetric: 'priorities',
      firstCompletedAtMinute: null,
      lastCompletedAtMinute: null,
      inspectedIssueIds: [],
      diseaseFlagged: false,
    },
    route: {
      arrivedAtMinute: null,
      reviewedAtMinute: null,
      reloadCountAtArrival: null,
    },
    inventory: makeInventory(),
    equipment: makeEquipmentState(),
    irrigation: worldIrrigationContext(state, heroHole),
    workOrder: null,
    score: null,
    scoreHistory: [],
    history: [],
    lastTickMinute: state.clock?.minutes || 0,
    persistence: {
      reloadCount: 0,
      lastReloadAtMinute: null,
      migrationReason: null,
    },
  };
  makeRuntime(model, state);
  putInitialFields(model, state);
  seedHeroProblems(model, state);
  // The one-yard layer owns the selected region from the first frame. Push the
  // seeded dry, hungry, worn, and diseased patches through the established
  // course-wide turf interface immediately so golfers/economy never see a
  // contradictory coarse state.
  if (syncInitial) {
    for (const index of model.runtime.activeIndices) markCoarseDirty(model, state, index);
    syncCourseMaintenanceCoarseCells(state, model);
  }
  captureCourseMaintenanceCoarseShadow(state, model);
  model.surfaceHash = hashSurface(model.surface);
  model.runtime.encodedSurface = encodeTypedArray(
    model.surface,
    model.width,
    model.height,
    'surface',
  );
  model.runtime.encodedFields = encodeCourseMaintenanceFields(model);
  model.runtime.encodedRevision = model.runtime.saveRevision;
  model.workOrder = makeWorkOrder(model);
  model.score = calculateHoleCondition(state, model, { record: false });
  consumeCourseMaintenanceDirtyRows(model);
  model.runtime.scoreDirty = false;
  return model;
}

export function initCourseMaintenance(state) {
  state.courseMaintenance = buildCourseMaintenance(state);
  return state.courseMaintenance;
}

export function ensureCourseMaintenance(state) {
  if (!state.courseMaintenance) return initCourseMaintenance(state);
  if (!state.courseMaintenance.runtime) makeRuntime(state.courseMaintenance, state);
  return state.courseMaintenance;
}

export function maintenanceCellSaveId(model, index) {
  return model.saveIdPrefix + ':cell-' + index;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  if (typeof Buffer !== 'undefined') {
    const buffer = Buffer.from(text, 'base64');
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function rleEncodeInto(bytes, output, outputIndex = 0) {
  let index = 0;
  while (index < bytes.length) {
    let run = 1;
    while (
      index + run < bytes.length
      && bytes[index + run] === bytes[index]
      && run < 128
    ) run++;
    if (run >= 4) {
      output[outputIndex++] = 0x80 | (run - 1);
      output[outputIndex++] = bytes[index];
      index += run;
      continue;
    }
    const start = index;
    index += run;
    while (index < bytes.length && index - start < 128) {
      let nextRun = 1;
      while (
        index + nextRun < bytes.length
        && bytes[index + nextRun] === bytes[index]
        && nextRun < 128
      ) nextRun++;
      if (nextRun >= 4) break;
      index += nextRun;
    }
    const length = index - start;
    output[outputIndex++] = length - 1;
    output.set(bytes.subarray(start, index), outputIndex);
    outputIndex += length;
  }
  return outputIndex;
}

function rleEncode(bytes) {
  const output = new Uint8Array(bytes.length + Math.ceil(bytes.length / 128) + 2);
  const outputIndex = rleEncodeInto(bytes, output);
  return output.subarray(0, outputIndex);
}

function rleDecodeInto(
  bytes,
  sourceStart,
  sourceEnd,
  output,
  targetStart,
  expectedLength,
) {
  let source = sourceStart;
  let target = targetStart;
  const targetEnd = targetStart + expectedLength;
  while (source < sourceEnd && target < targetEnd) {
    const control = bytes[source++];
    const length = (control & 0x7f) + 1;
    if (control & 0x80) {
      const value = bytes[source++];
      if (value !== 0) output.fill(value, target, target + length);
      target += length;
    } else {
      output.set(bytes.subarray(source, source + length), target);
      source += length;
      target += length;
    }
  }
  if (target !== targetEnd || source !== sourceEnd) {
    throw new Error('Course maintenance field length mismatch.');
  }
}

function rleDecode(bytes, expectedLength) {
  const output = new Uint8Array(expectedLength);
  rleDecodeInto(bytes, 0, bytes.length, output, 0, expectedLength);
  return output;
}

function tileOrderedArray(array, width, height) {
  const ordered = new array.constructor(array.length);
  const tileSize = Math.max(1, Math.round(CELL_YD / MAINTENANCE_RESOLUTION_YD));
  let target = 0;
  for (let tileY = 0; tileY < height; tileY += tileSize) {
    for (let tileX = 0; tileX < width; tileX += tileSize) {
      for (let y = tileY; y < Math.min(height, tileY + tileSize); y++) {
        const length = Math.min(width, tileX + tileSize) - tileX;
        const source = y * width + tileX;
        ordered.set(array.subarray(source, source + length), target);
        target += length;
      }
    }
  }
  return ordered;
}

function restoreTileOrder(ordered, width, height) {
  const result = new ordered.constructor(ordered.length);
  const tileSize = Math.max(1, Math.round(CELL_YD / MAINTENANCE_RESOLUTION_YD));
  let source = 0;
  for (let tileY = 0; tileY < height; tileY += tileSize) {
    for (let tileX = 0; tileX < width; tileX += tileSize) {
      for (let y = tileY; y < Math.min(height, tileY + tileSize); y++) {
        const length = Math.min(width, tileX + tileSize) - tileX;
        result.set(ordered.subarray(source, source + length), y * width + tileX);
        source += length;
      }
    }
  }
  return result;
}

function encodedRle(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  return bytesToBase64(rleEncode(bytes));
}

function equalByteRanges(bytes, first, second, length) {
  for (let offset = 0; offset < length; offset++) {
    if (bytes[first + offset] !== bytes[second + offset]) return false;
  }
  return true;
}

function encodeRowBands(array, width, height) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  const rowBytes = width * array.BYTES_PER_ELEMENT;
  const output = new Uint8Array(
    bytes.length + Math.ceil(bytes.length / 128) + height * 4 + 16,
  );
  let outputIndex = 0;
  let y = 0;
  while (y < height) {
    const rowStart = y * rowBytes;
    if (y > 0 && equalByteRanges(bytes, rowStart, rowStart - rowBytes, rowBytes)) {
      let repeat = 1;
      while (
        repeat < 255
        && y + repeat < height
        && equalByteRanges(
          bytes,
          (y + repeat) * rowBytes,
          rowStart - rowBytes,
          rowBytes,
        )
      ) repeat++;
      output[outputIndex++] = repeat;
      y += repeat;
      continue;
    }
    const header = outputIndex;
    outputIndex += 3;
    const payloadStart = outputIndex;
    outputIndex = rleEncodeInto(
      bytes.subarray(rowStart, rowStart + rowBytes),
      output,
      outputIndex,
    );
    const payloadLength = outputIndex - payloadStart;
    output[header] = 0;
    output[header + 1] = payloadLength & 0xff;
    output[header + 2] = payloadLength >>> 8;
    y++;
  }
  return bytesToBase64(output.subarray(0, outputIndex));
}

function decodeRowBands(payload, Type, length, width, height) {
  const encoded = base64ToBytes(payload);
  const result = new Type(length);
  const output = new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  const rowBytes = width * Type.BYTES_PER_ELEMENT;
  let source = 0;
  let y = 0;
  while (source < encoded.length && y < height) {
    const repeat = encoded[source++];
    if (repeat) {
      if (y === 0 || y + repeat > height) {
        throw new Error('Invalid course maintenance row repeat.');
      }
      for (let count = 0; count < repeat; count++, y++) {
        output.set(
          output.subarray((y - 1) * rowBytes, y * rowBytes),
          y * rowBytes,
        );
      }
      continue;
    }
    if (source + 2 > encoded.length) {
      throw new Error('Invalid course maintenance row header.');
    }
    const payloadLength = encoded[source] | (encoded[source + 1] << 8);
    source += 2;
    const payloadEnd = source + payloadLength;
    if (payloadEnd > encoded.length) {
      throw new Error('Invalid course maintenance row payload.');
    }
    rleDecodeInto(encoded, source, payloadEnd, output, y * rowBytes, rowBytes);
    source = payloadEnd;
    y++;
  }
  if (source !== encoded.length || y !== height) {
    throw new Error('Course maintenance row count mismatch.');
  }
  return result;
}

const BANDED_SAVE_FIELDS = new Set([
  'heightQ',
  'moisture',
  'health',
  'wear',
  'fertilizer',
  'compaction',
]);

function encodeTypedArray(array, width, height, fieldName = '') {
  if (array.length === 0) return 'u:0';
  let uniform = true;
  for (let i = 1; i < array.length; i++) {
    if (array[i] !== array[0]) {
      uniform = false;
      break;
    }
  }
  if (uniform) return 'u:' + array[0].toString(36);

  // Broad agronomic fields repeat heavily between adjacent one-yard rows.
  // A row-band stream retains that compression while decoding directly into
  // the simulation's row-major arrays; sparse action/history fields use RLE.
  if (BANDED_SAVE_FIELDS.has(fieldName)) {
    return 'b:' + encodeRowBands(array, width, height);
  }
  return 'r:' + encodedRle(array);
}

function encodeCourseMaintenanceFields(model) {
  const fields = {};
  for (const name of Object.keys(SERIAL_FIELDS)) {
    fields[name] = encodeTypedArray(model[name], model.width, model.height, name);
  }
  return fields;
}

function decodeTypedArray(text, Type, length, width, height) {
  if (text.startsWith('u:')) {
    const result = new Type(length);
    const value = Number.parseInt(text.slice(2), 36);
    // Typed arrays are already zero-initialized. Most sparse maintenance
    // fields use u:0, so avoiding a second full-buffer write matters on load.
    if (value !== 0) result.fill(value);
    return result;
  }
  const mode = text.length > 2 && text[1] === ':' ? text[0] : 'r';
  const predicted = mode === 'd' || mode === 'q';
  const tiled = mode === 't' || mode === 'q';
  const payload = text.length > 2 && text[1] === ':' ? text.slice(2) : text;
  if (mode === 'b') return decodeRowBands(payload, Type, length, width, height);
  const byteLength = length * Type.BYTES_PER_ELEMENT;
  const bytes = rleDecode(base64ToBytes(payload), byteLength);
  // rleDecode owns an exact, aligned buffer, so the decoded bytes can be
  // viewed directly instead of copying every field once more.
  const result = new Type(bytes.buffer, bytes.byteOffset, length);
  if (predicted) {
    let previous = 0;
    for (let i = 0; i < result.length; i++) {
      result[i] += previous;
      previous = result[i];
    }
  }
  return tiled ? restoreTileOrder(result, width, height) : result;
}

export function snapshotCourseMaintenance(model) {
  if (!model) return null;
  const cacheValid = model.runtime?.encodedFields
    && model.runtime.encodedRevision === model.runtime.saveRevision;
  const fields = cacheValid
    ? model.runtime.encodedFields
    : encodeCourseMaintenanceFields(model);
  if (model.runtime && !cacheValid) {
    model.runtime.encodedFields = fields;
    model.runtime.encodedRevision = model.runtime.saveRevision;
  }
  return {
    version: model.version,
    heroHoleId: model.heroHoleId,
    heroHoleNumber: model.heroHoleNumber,
    heroSelectionScore: model.heroSelectionScore,
    resolutionYd: model.resolutionYd,
    width: model.width,
    height: model.height,
    bounds: model.bounds,
    courseLayoutHash: model.courseLayoutHash,
    surfaceHash: model.surfaceHash,
    surfaceField: model.runtime?.encodedSurface || encodeTypedArray(
      model.surface,
      model.width,
      model.height,
      'surface',
    ),
    saveIdPrefix: model.saveIdPrefix,
    fields,
    issues: model.issues,
    inspection: model.inspection,
    route: model.route,
    inventory: model.inventory,
    equipment: model.equipment,
    irrigation: model.irrigation,
    workOrder: model.workOrder,
    score: model.score,
    scoreHistory: model.scoreHistory,
    history: model.history,
    lastTickMinute: model.lastTickMinute,
    persistence: model.persistence,
  };
}

function modelFromSavedLayout(state, raw) {
  if (
    !raw.surfaceField
    || !raw.courseLayoutHash
    || raw.version !== COURSE_MAINTENANCE_VERSION
    || raw.resolutionYd !== MAINTENANCE_RESOLUTION_YD
    || raw.courseLayoutHash !== hashCourseLayout(state)
    || !Number.isInteger(raw.width)
    || !Number.isInteger(raw.height)
    || raw.width <= 0
    || raw.height <= 0
  ) return null;
  const heroHole = state.course.holes.find((hole) => hole.id === raw.heroHoleId);
  if (!heroHole) return null;
  const length = raw.width * raw.height;
  const surface = decodeTypedArray(
    raw.surfaceField,
    Uint8Array,
    length,
    raw.width,
    raw.height,
  );
  if (hashSurface(surface) !== raw.surfaceHash) return null;
  const model = {
    version: COURSE_MAINTENANCE_VERSION,
    heroHoleId: heroHole.id,
    heroHoleNumber: raw.heroHoleNumber
      || state.course.holes.findIndex((hole) => hole.id === heroHole.id) + 1,
    heroSelectionScore: raw.heroSelectionScore || null,
    resolutionYd: raw.resolutionYd,
    width: raw.width,
    height: raw.height,
    bounds: raw.bounds,
    courseWorldWidthYd: state.course.w * CELL_YD,
    courseWorldHeightYd: state.course.h * CELL_YD,
    courseLayoutHash: raw.courseLayoutHash,
    surfaceHash: raw.surfaceHash,
    saveIdPrefix: raw.saveIdPrefix || 'course-maintenance:hole-' + heroHole.id,
    surface,
    targetHeightQ: new Uint8Array(length),
    issues: null,
    inspection: {
      active: false,
      selectedMetric: 'priorities',
      firstCompletedAtMinute: null,
      lastCompletedAtMinute: null,
      inspectedIssueIds: [],
      diseaseFlagged: false,
    },
    route: {
      arrivedAtMinute: null,
      reviewedAtMinute: null,
      reloadCountAtArrival: null,
    },
    inventory: makeInventory(),
    equipment: makeEquipmentState(),
    irrigation: worldIrrigationContext(state, heroHole),
    workOrder: null,
    score: null,
    scoreHistory: [],
    history: [],
    lastTickMinute: state.clock?.minutes || 0,
    persistence: {
      reloadCount: 0,
      lastReloadAtMinute: null,
      migrationReason: null,
    },
  };
  makeRuntime(model, state);
  model.runtime.encodedSurface = raw.surfaceField;
  return model;
}

function hydrateSavedCourseMaintenance(state, raw, model) {
  for (const [name, Type] of Object.entries(SERIAL_FIELDS)) {
    if (!raw.fields?.[name]) throw new Error('Missing field ' + name);
    model[name] = decodeTypedArray(
      raw.fields[name],
      Type,
      model.surface.length,
      model.width,
      model.height,
    );
  }
  if (!raw.issues || !raw.workOrder) throw new Error('Missing maintenance objects.');
  model.issues = raw.issues;
  model.inspection = { ...model.inspection, ...(raw.inspection || {}) };
  model.route = { ...model.route, ...(raw.route || {}) };
  model.inventory = { ...model.inventory, ...(raw.inventory || {}) };
  model.equipment = { ...model.equipment, ...(raw.equipment || {}) };
  model.irrigation = raw.irrigation || model.irrigation;
  model.workOrder = raw.workOrder;
  model.score = raw.score || calculateHoleCondition(state, model, { record: false });
  model.scoreHistory = raw.scoreHistory || [];
  model.history = raw.history || [];
  model.lastTickMinute = raw.lastTickMinute ?? state.clock.minutes;
  model.persistence = {
    ...model.persistence,
    ...(raw.persistence || {}),
    reloadCount: (raw.persistence?.reloadCount || 0) + 1,
    lastReloadAtMinute: state.clock.minutes,
  };
  captureCourseMaintenanceCoarseShadow(state, model);
  consumeCourseMaintenanceDirtyRows(model);
  model.runtime.scoreDirty = false;
  model.runtime.encodedFields = raw.fields;
  model.runtime.encodedRevision = model.runtime.saveRevision;
  const saveLoad = workOrderStep(model, 'save-load');
  if (saveLoad) {
    saveLoad.complete = model.route.reloadCountAtArrival !== null
      && model.persistence.reloadCount > model.route.reloadCountAtArrival;
  }
  if (
    model.workOrder.steps.every((step) => step.complete)
    && model.workOrder.completedAtMinute === null
  ) model.workOrder.completedAtMinute = state.clock.minutes;
  state.courseMaintenance = model;
  return model;
}

export function restoreCourseMaintenance(state, raw) {
  if (!raw) {
    const model = buildCourseMaintenance(state);
    state.courseMaintenance = model;
    return model;
  }

  try {
    const fastModel = modelFromSavedLayout(state, raw);
    if (fastModel) return hydrateSavedCourseMaintenance(state, raw, fastModel);
  } catch {
    // Fall through to the geometry-derived compatibility path. A damaged or
    // older layout cache must never make the whole save unreadable.
  }

  const selection = {
    hole: state.course.holes.find((hole) => hole.id === raw.heroHoleId),
    score: raw.heroSelectionScore || null,
  };
  const model = buildCourseMaintenance(
    state,
    selection.hole ? selection : null,
    { syncInitial: false },
  );
  if (!model) {
    state.courseMaintenance = null;
    return null;
  }
  const compatible = raw.version === COURSE_MAINTENANCE_VERSION
    && raw.width === model.width
    && raw.height === model.height
    && raw.resolutionYd === model.resolutionYd
    && raw.surfaceHash === model.surfaceHash;
  if (!compatible) {
    model.persistence.migrationReason = 'Course surface changed; rebuilt the hero region safely.';
    state.courseMaintenance = model;
    return model;
  }
  try {
    return hydrateSavedCourseMaintenance(state, raw, model);
  } catch {
    const rebuilt = buildCourseMaintenance(state, null, { syncInitial: false });
    rebuilt.persistence.migrationReason = 'Maintenance data was incomplete; rebuilt the hero region safely.';
    state.courseMaintenance = rebuilt;
    return rebuilt;
  }
}

function issueAt(model, collection, id) {
  return model.issues[collection]?.find((issue) => issue.id === id) || null;
}

function nearestIssue(model, collection, worldX, worldZ, radiusYd, predicate = null) {
  let nearest = null;
  let distance = radiusYd;
  for (const issue of model.issues[collection] || []) {
    if (predicate && !predicate(issue)) continue;
    const next = Math.hypot(issue.x - worldX, issue.z - worldZ);
    if (next <= distance) {
      nearest = issue;
      distance = next;
    }
  }
  return nearest ? { issue: nearest, distance } : null;
}

function applyBrush(state, model, options, callback) {
  const radiusYd = Math.max(model.resolutionYd * 0.5, options.radiusYd || 1);
  const courseYdX = options.x + model.courseWorldWidthYd / 2;
  const courseYdY = options.z + model.courseWorldHeightYd / 2;
  const centerX = (courseYdX - model.bounds.minCourseYdX) / model.resolutionYd;
  const centerY = (courseYdY - model.bounds.minCourseYdY) / model.resolutionYd;
  const radiusCells = Math.ceil(radiusYd / model.resolutionYd);
  const minX = Math.max(0, Math.floor(centerX - radiusCells));
  const maxX = Math.min(model.width - 1, Math.ceil(centerX + radiusCells));
  const minY = Math.max(0, Math.floor(centerY - radiusCells));
  const maxY = Math.min(model.height - 1, Math.ceil(centerY + radiusCells));
  let changed = 0;
  let eligible = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const index = y * model.width + x;
      if (model.surface[index] === SURFACE.NONE) continue;
      const point = fineWorldPoint(model, x, y);
      const distance = Math.hypot(point.x - options.x, point.z - options.z);
      if (distance > radiusYd) continue;
      const falloff = 1 - distance / radiusYd;
      eligible++;
      if (callback(index, falloff, point)) {
        changed++;
        refreshVisual(model, index);
        markDirty(model, index);
        markCoarseDirty(model, state, index);
      }
    }
  }
  if (changed) {
    syncCourseMaintenanceCoarseCells(state, model);
  }
  return { changed, eligible };
}

function angleByte(angleRad) {
  let angle = angleRad % (Math.PI * 2);
  if (angle < 0) angle += Math.PI * 2;
  return Math.round((angle / (Math.PI * 2)) * 255) & 255;
}

function consumeDoseRemainder(model, kind, index, amount) {
  const remainders = model.runtime.doseRemainders[kind];
  const total = remainders[index] + Math.max(0, amount);
  const units = Math.floor(total + 1e-7);
  remainders[index] = total - units;
  return units;
}

function allowedMower(surface, mowerType) {
  if (mowerType === 'greens-reel') {
    return surface === SURFACE.GREEN
      || surface === SURFACE.FRINGE
      || surface === SURFACE.TEE;
  }
  if (mowerType === 'fairway-reel') {
    return surface === SURFACE.FAIRWAY || surface === SURFACE.ROUGH;
  }
  return false;
}

export function mowCourseMaintenancePath(state, options) {
  const model = ensureCourseMaintenance(state);
  const mowerType = options.mowerType || model.equipment.tractor.mowerType;
  if (!options.bladesEngaged) {
    return { ok: false, changed: 0, reason: 'Engage the mower blades before cutting.' };
  }
  const speed = Math.max(0, options.speedYdPerSec || 0);
  const quality = clamp(1 - Math.max(0, speed - 12) / 18, 0.35, 1);
  let wrongSurface = 0;
  const day = calendarOf(state.clock.minutes).dayAbs;
  const result = applyBrush(state, model, options, (index) => {
    const surface = model.surface[index];
    if (!allowedMower(surface, mowerType)) {
      wrongSurface++;
      return false;
    }
    const target = model.targetHeightQ[index];
    const before = model.heightQ[index];
    if (before <= target) {
      model.mowPasses[index] = clamp(model.mowPasses[index] + 1, 0, 255);
      return true;
    }
    const cutDepth = Math.max(1, Math.round((before - target) * quality));
    model.heightQ[index] = Math.max(target, before - cutDepth);
    model.mowAngle[index] = angleByte(options.directionRad || 0);
    model.mowQuality[index] = Math.round(quality * 100);
    model.mowPasses[index] = clamp(model.mowPasses[index] + 1, 0, 255);
    model.lastMowDay[index] = clamp(day, 0, NEVER_DAY - 1);
    model.compaction[index] = clamp(model.compaction[index] + (speed > 17 ? 2 : 1), 0, 100);
    return true;
  });
  if (result.changed) {
    addMaintenanceHistory(state, model, 'mowing', {
      cells: result.changed,
      quality: Math.round(quality * 100),
      mowerType,
    });
  }
  return {
    ok: result.changed > 0,
    ...result,
    wrongSurface,
    quality: Math.round(quality * 100),
    reason: result.changed
      ? null
      : wrongSurface
        ? 'This mower is not suitable for the surface under the deck.'
        : 'No grass in the mower path needs cutting.',
  };
}

export function irrigateCourseMaintenancePath(state, options) {
  const model = ensureCourseMaintenance(state);
  const day = calendarOf(state.clock.minutes).dayAbs;
  const dose = Math.max(0, (options.pointsPerSecond || 18) * (options.dtSec || 0));
  let reachedTurf = 0;
  const result = applyBrush(state, model, options, (index, falloff) => {
    if (!ALL_TURF.has(model.surface[index])) return false;
    reachedTurf++;
    const units = consumeDoseRemainder(
      model,
      'moisture',
      index,
      dose * (0.35 + falloff * 0.65),
    );
    model.lastIrrigationDay[index] = clamp(day, 0, NEVER_DAY - 1);
    if (!units) return false;
    const before = model.moisture[index];
    model.moisture[index] = clamp(before + units, 0, 100);
    return model.moisture[index] !== before;
  });
  if (result.changed) {
    addMaintenanceHistory(state, model, 'irrigation', {
      cells: result.changed,
      appliedPoints: Number(dose.toFixed(2)),
    });
  }
  return {
    ok: reachedTurf > 0,
    ...result,
    reason: reachedTurf ? null : 'Water is not reaching turf.',
  };
}

export function fertilizeCourseMaintenancePath(state, options) {
  const model = ensureCourseMaintenance(state);
  if (model.inventory.fertilizerKg <= 0) {
    return { ok: false, changed: 0, reason: 'The spreader is empty.' };
  }
  const day = calendarOf(state.clock.minutes).dayAbs;
  const seconds = Math.max(0, options.dtSec || 0);
  const desiredKg = (options.kgPerSecond || 0.18) * seconds;
  if (desiredKg <= 0) return { ok: false, changed: 0, reason: 'Move the spreader over managed turf.' };
  const availableRatio = Math.min(1, model.inventory.fertilizerKg / desiredKg);
  const dose = (options.applicationPointsPerSecond || 20) * seconds * availableRatio;
  let reachedManagedTurf = 0;
  const result = applyBrush(state, model, options, (index, falloff) => {
    if (!MANAGED_TURF.has(model.surface[index])) return false;
    reachedManagedTurf++;
    const units = consumeDoseRemainder(
      model,
      'fertilizer',
      index,
      dose * (0.45 + falloff * 0.55),
    );
    model.lastFertilizerDay[index] = clamp(day, 0, NEVER_DAY - 1);
    if (!units) return false;
    const before = model.fertilizerPending[index];
    model.fertilizerPending[index] = clamp(before + units, 0, 100);
    return model.fertilizerPending[index] !== before;
  });
  if (reachedManagedTurf) {
    const usedKg = Math.min(model.inventory.fertilizerKg, desiredKg);
    model.inventory.fertilizerKg = Number(
      Math.max(0, model.inventory.fertilizerKg - usedKg).toFixed(6),
    );
    if (result.changed) {
      addMaintenanceHistory(state, model, 'fertilizer', {
        cells: result.changed,
        usedKg,
      });
    }
    return { ok: true, ...result, usedKg };
  }
  return { ok: false, ...result, usedKg: 0, reason: 'The spreader is not over managed turf.' };
}

export function applyFungicideCourseMaintenancePath(state, options) {
  const model = ensureCourseMaintenance(state);
  if (model.inventory.fungicideLiters <= 0) {
    return { ok: false, changed: 0, reason: 'The treatment tank is empty.' };
  }
  const seconds = Math.max(0, options.dtSec || 0);
  const desiredLiters = (options.litersPerSecond || 0.08) * seconds;
  if (desiredLiters <= 0) return { ok: false, changed: 0, reason: 'Hold the sprayer over a flagged patch.' };
  const ratio = Math.min(1, model.inventory.fungicideLiters / desiredLiters);
  const treatmentDose = (options.treatmentPointsPerSecond || 18) * seconds * ratio;
  let reachedDisease = 0;
  const result = applyBrush(state, model, options, (index, falloff) => {
    if (!ALL_TURF.has(model.surface[index])) return false;
    if (model.diseaseType[index] === DISEASE.NONE && model.diseasePressure[index] < 45) {
      return false;
    }
    reachedDisease++;
    const units = consumeDoseRemainder(model, 'disease', index, treatmentDose * falloff);
    const treatedBefore = model.treatedDays[index];
    model.treatedDays[index] = Math.max(model.treatedDays[index], Math.round(12 * ratio));
    if (!units) return model.treatedDays[index] !== treatedBefore;
    const before = model.diseaseSeverity[index];
    model.diseaseSeverity[index] = clamp(
      model.diseaseSeverity[index] - units,
      0,
      100,
    );
    return model.diseaseSeverity[index] !== before || model.treatedDays[index] !== treatedBefore;
  });
  if (reachedDisease) {
    const usedLiters = Math.min(model.inventory.fungicideLiters, desiredLiters);
    model.inventory.fungicideLiters = Number(
      Math.max(0, model.inventory.fungicideLiters - usedLiters).toFixed(6),
    );
    if (result.changed) {
      addMaintenanceHistory(state, model, 'disease-treatment', {
        cells: result.changed,
        usedLiters,
      });
    }
    return { ok: true, ...result, usedLiters };
  }
  return { ok: false, ...result, usedLiters: 0, reason: 'No disease pressure is under the nozzle.' };
}

export function rakeCourseMaintenancePath(state, options) {
  const model = ensureCourseMaintenance(state);
  const day = calendarOf(state.clock.minutes).dayAbs;
  const strength = clamp((options.dtSec || 0) * 55, 0, 100);
  let reachedBunker = 0;
  const result = applyBrush(state, model, options, (index, falloff) => {
    if (model.surface[index] !== SURFACE.BUNKER) return false;
    reachedBunker++;
    model.rakeAngle[index] = angleByte(options.directionRad || 0);
    model.lastRakeDay[index] = clamp(day, 0, NEVER_DAY - 1);
    const units = consumeDoseRemainder(model, 'rake', index, strength * falloff);
    if (!units) return false;
    const wearBefore = model.wear[index];
    const smoothBefore = model.bunkerSmooth[index];
    model.wear[index] = clamp(wearBefore - units, 0, 100);
    model.bunkerSmooth[index] = clamp(smoothBefore + units, 0, 100);
    return model.wear[index] !== wearBefore || model.bunkerSmooth[index] !== smoothBefore;
  });
  let repaired = 0;
  for (const footprint of model.issues.bunkerFootprints) {
    if (footprint.repaired) continue;
    const distance = Math.hypot(footprint.x - options.x, footprint.z - options.z);
    if (distance <= (options.radiusYd || 1.5) + 1.2) {
      footprint.progress = clamp(footprint.progress + (options.dtSec || 0) / 0.8, 0, 1);
      if (footprint.progress >= 1) {
        footprint.repaired = true;
        repaired++;
      }
    }
  }
  if (result.changed) {
    addMaintenanceHistory(state, model, 'bunker-raking', {
      cells: result.changed,
      footprintsRepaired: repaired,
    });
  }
  return {
    ok: reachedBunker > 0,
    ...result,
    footprintsRepaired: repaired,
    reason: reachedBunker ? null : 'The rake is not touching bunker sand.',
  };
}

export function applyDivotMix(state, id, dtSec) {
  const model = ensureCourseMaintenance(state);
  const issue = issueAt(model, 'divots', id);
  if (!issue || issue.repaired) return { ok: false, reason: 'That divot is already repaired.' };
  if (issue.stage !== 'open') return { ok: false, reason: 'The turf mix is already in place.' };
  if (model.inventory.turfMixUses <= 0) return { ok: false, reason: 'The divot kit is out of turf mix.' };
  issue.mixProgress = clamp(issue.mixProgress + dtSec / 0.65, 0, 1);
  if (issue.mixProgress >= 1) {
    issue.stage = 'filled';
    model.inventory.turfMixUses--;
    addMaintenanceHistory(state, model, 'divot-filled', { id: issue.id });
    updateWorkOrder(state, model);
  }
  return { ok: true, issue, complete: issue.stage === 'filled' };
}

export function levelDivot(state, id, dtSec) {
  const model = ensureCourseMaintenance(state);
  const issue = issueAt(model, 'divots', id);
  if (!issue || issue.repaired) return { ok: false, reason: 'That divot is already repaired.' };
  if (issue.stage !== 'filled') return { ok: false, reason: 'Add turf mix before leveling the divot.' };
  issue.levelProgress = clamp(issue.levelProgress + dtSec / 0.7, 0, 1);
  if (issue.levelProgress >= 1) {
    issue.stage = 'repaired';
    issue.repaired = true;
    issue.recoveryHours = 10;
    const index = maintenanceIndexAtWorld(model, issue.x, issue.z);
    if (index >= 0) {
      damagePatch(model, index, 2.3, (cell, falloff) => {
        model.wear[cell] = clamp(model.wear[cell] - 55 * falloff, 0, 100);
        model.health[cell] = clamp(model.health[cell] + 5 * falloff, 0, 100);
        markCoarseDirty(model, state, cell);
      });
      syncCourseMaintenanceCoarseCells(state, model);
    }
    addMaintenanceHistory(state, model, 'divot-repaired', { id: issue.id });
    updateWorkOrder(state, model);
  }
  return { ok: true, issue, complete: issue.repaired };
}

export function repairBallMark(state, id, dtSec) {
  const model = ensureCourseMaintenance(state);
  const issue = issueAt(model, 'ballMarks', id);
  if (!issue || issue.repaired) return { ok: false, reason: 'That ball mark is already repaired.' };
  issue.liftProgress = clamp(issue.liftProgress + dtSec / 0.65, 0, 1);
  if (issue.liftProgress >= 1) {
    issue.repaired = true;
    const index = maintenanceIndexAtWorld(model, issue.x, issue.z);
    if (index >= 0) {
      damagePatch(model, index, 1.6, (cell, falloff) => {
        model.wear[cell] = clamp(model.wear[cell] - 42 * falloff, 0, 100);
        model.health[cell] = clamp(model.health[cell] + 4 * falloff, 0, 100);
        markCoarseDirty(model, state, cell);
      });
      syncCourseMaintenanceCoarseCells(state, model);
    }
    addMaintenanceHistory(state, model, 'ball-mark-repaired', { id: issue.id });
    updateWorkOrder(state, model);
  }
  return { ok: true, issue, complete: issue.repaired };
}

export function clearCourseMaintenanceDebris(state, id, dtSec) {
  const model = ensureCourseMaintenance(state);
  const issue = issueAt(model, 'debris', id);
  if (!issue || issue.cleared) return { ok: false, reason: 'That debris is already cleared.' };
  if (model.inventory.debrisBags <= 0) return { ok: false, reason: 'No debris bags remain.' };
  issue.bagProgress = clamp(issue.bagProgress + dtSec / 0.8, 0, 1);
  if (issue.bagProgress >= 1) {
    issue.cleared = true;
    issue.repaired = true;
    model.equipment.debrisBag.fill = clamp(model.equipment.debrisBag.fill + 22, 0, 100);
    if (model.equipment.debrisBag.fill >= 88) {
      model.inventory.debrisBags--;
      model.equipment.debrisBag.fill = 0;
    }
    addMaintenanceHistory(state, model, 'debris-cleared', { id: issue.id, type: issue.type });
    updateWorkOrder(state, model);
  }
  return { ok: true, issue, complete: issue.cleared };
}

export function nearestCourseMaintenanceIssue(state, collection, worldX, worldZ, radiusYd = 4) {
  const model = ensureCourseMaintenance(state);
  return nearestIssue(
    model,
    collection,
    worldX,
    worldZ,
    radiusYd,
    (issue) => !(issue.repaired || issue.cleared),
  );
}

export function toggleCourseInspection(state, active = null) {
  const model = ensureCourseMaintenance(state);
  model.inspection.active = active === null ? !model.inspection.active : !!active;
  if (model.inspection.active && model.workOrder.startedAtMinute === null) {
    model.workOrder.startedAtMinute = state.clock.minutes;
  }
  return model.inspection.active;
}

export function markCourseMaintenanceRouteStep(state, step) {
  const model = ensureCourseMaintenance(state);
  if (step === 'arrive') {
    if (model.route.arrivedAtMinute === null) model.route.arrivedAtMinute = state.clock.minutes;
    if (model.route.reloadCountAtArrival === null) {
      model.route.reloadCountAtArrival = model.persistence.reloadCount;
    }
    if (model.workOrder.startedAtMinute === null) {
      model.workOrder.startedAtMinute = state.clock.minutes;
    }
  } else if (step === 'review') {
    if (model.route.arrivedAtMinute === null) {
      return { ok: false, reason: 'Arrive at the maintenance yard before reviewing the work order.' };
    }
    if (model.route.reviewedAtMinute === null) model.route.reviewedAtMinute = state.clock.minutes;
  } else {
    return { ok: false, reason: 'Unknown maintenance route step.' };
  }
  updateWorkOrder(state, model);
  return { ok: true, route: model.route, workOrder: model.workOrder };
}

export function manageCourseMaintenanceIrrigationHead(state, headId, enabled = null) {
  const model = ensureCourseMaintenance(state);
  const head = model.irrigation.heads.find((entry) => entry.id === headId);
  if (!head) return { ok: false, reason: 'That sprinkler head is not part of this hole.' };
  if (!model.irrigation.controller.enabled) {
    return { ok: false, reason: 'The irrigation controller is switched off.' };
  }
  if (head.status === 'clogged') {
    head.status = 'ready';
    head.enabled = false;
    addMaintenanceHistory(state, model, 'irrigation-head-cleared', { headId });
    updateWorkOrder(state, model);
    return { ok: true, repaired: true, head };
  }
  head.enabled = enabled === null ? !head.enabled : !!enabled;
  head.status = head.enabled ? 'running' : 'ready';
  addMaintenanceHistory(state, model, head.enabled ? 'irrigation-head-on' : 'irrigation-head-off', { headId });
  updateWorkOrder(state, model);
  return { ok: true, repaired: false, head };
}

export function inspectCourseMaintenanceAt(state, worldX, worldZ) {
  const model = ensureCourseMaintenance(state);
  const index = maintenanceIndexAtWorld(model, worldX, worldZ);
  if (index < 0) return null;
  const issueCollections = ['divots', 'ballMarks', 'bunkerFootprints', 'debris'];
  for (const collection of issueCollections) {
    const found = nearestIssue(model, collection, worldX, worldZ, 5);
    if (found && !model.inspection.inspectedIssueIds.includes(found.issue.id)) {
      model.inspection.inspectedIssueIds.push(found.issue.id);
    }
  }
  if (model.inspection.firstCompletedAtMinute === null) {
    model.inspection.firstCompletedAtMinute = state.clock.minutes;
  } else {
    model.inspection.lastCompletedAtMinute = state.clock.minutes;
  }
  updateWorkOrder(state, model);
  return maintenanceCellReport(model, index);
}

export function flagCourseMaintenanceDisease(state) {
  const model = ensureCourseMaintenance(state);
  model.inspection.diseaseFlagged = true;
  updateWorkOrder(state, model);
}

export function maintenanceCellReport(model, index) {
  if (index < 0 || index >= model.surface.length || model.surface[index] === SURFACE.NONE) {
    return null;
  }
  const surface = model.surface[index];
  const [moistureLow, moistureHigh] = IDEAL_MOISTURE[surface];
  const [fertilizerLow, fertilizerHigh] = IDEAL_FERTILIZER[surface];
  const problems = [];
  const heightMm = model.heightQ[index] / 2;
  const targetMm = model.targetHeightQ[index] / 2;
  if (MANAGED_TURF.has(surface) && heightMm > targetMm + 1.5) {
    problems.push('Grass is above target height.');
  }
  if (model.moisture[index] < moistureLow) problems.push('Turf is dry.');
  if (model.moisture[index] > moistureHigh) problems.push('Turf is overwatered.');
  if (model.fertilizer[index] < fertilizerLow) problems.push('Turf is underfed.');
  if (model.fertilizer[index] > fertilizerHigh) problems.push('Turf is overfed.');
  if (model.diseaseSeverity[index] > 4) {
    problems.push(DISEASE_NAMES[model.diseaseType[index]] + ' is active.');
  } else if (model.diseasePressure[index] > 55) {
    problems.push('Disease pressure is elevated.');
  }
  if (model.wear[index] > 42) problems.push('Localized wear needs repair.');
  return {
    saveId: maintenanceCellSaveId(model, index),
    index,
    surface,
    surfaceName: maintenanceSurfaceName(surface),
    heightMm,
    targetHeightMm: targetMm,
    moisture: model.moisture[index],
    moistureRange: [moistureLow, moistureHigh],
    health: model.health[index],
    wear: model.wear[index],
    diseasePressure: model.diseasePressure[index],
    disease: {
      type: model.diseaseType[index],
      name: DISEASE_NAMES[model.diseaseType[index]],
      severity: model.diseaseSeverity[index],
      treatedDays: model.treatedDays[index],
    },
    fertilizer: model.fertilizer[index],
    fertilizerPending: model.fertilizerPending[index],
    fertilizerRange: [fertilizerLow, fertilizerHigh],
    compaction: model.compaction[index],
    recentMaintenance: {
      mowedDay: model.lastMowDay[index] === NEVER_DAY ? null : model.lastMowDay[index],
      irrigatedDay: model.lastIrrigationDay[index] === NEVER_DAY
        ? null
        : model.lastIrrigationDay[index],
      fertilizedDay: model.lastFertilizerDay[index] === NEVER_DAY
        ? null
        : model.lastFertilizerDay[index],
      rakedDay: model.lastRakeDay[index] === NEVER_DAY ? null : model.lastRakeDay[index],
    },
    visualState: model.visual[index],
    problems,
  };
}

function categoryAverage(model, surfaces, scoreOf) {
  let total = 0;
  let count = 0;
  for (const surface of surfaces) {
    for (const index of model.runtime.surfaceIndices[surface] || []) {
      total += scoreOf(index, surface);
      count++;
    }
  }
  return count ? total / count : 100;
}

function riskAwareCategory(model, surfaces, scoreOf, riskCells = 64, riskWeight = 0.45) {
  const scores = [];
  for (const surface of surfaces) {
    for (const index of model.runtime.surfaceIndices[surface] || []) {
      scores.push(scoreOf(index, surface));
    }
  }
  if (!scores.length) return 100;
  scores.sort((a, b) => a - b);
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const count = Math.min(scores.length, riskCells);
  let riskTotal = 0;
  for (let index = 0; index < count; index++) riskTotal += scores[index];
  const localRisk = riskTotal / count;
  return mean * (1 - riskWeight) + localRisk * riskWeight;
}

function rangeScore(value, range, outsideScale = 2.2) {
  if (value >= range[0] && value <= range[1]) return 100;
  const distance = value < range[0] ? range[0] - value : value - range[1];
  return clamp(100 - distance * outsideScale, 0, 100);
}

function turfCellQuality(model, index, surface) {
  const heightTarget = model.targetHeightQ[index];
  const heightDifference = Math.abs(model.heightQ[index] - heightTarget) / 2;
  const heightScore = clamp(100 - heightDifference * (surface === SURFACE.ROUGH ? 2 : 5), 0, 100);
  const moistureScore = rangeScore(model.moisture[index], IDEAL_MOISTURE[surface]);
  const fertilizerScore = rangeScore(model.fertilizer[index], IDEAL_FERTILIZER[surface], 1.7);
  return clamp(
    model.health[index] * 0.38
      + heightScore * 0.25
      + moistureScore * 0.15
      + fertilizerScore * 0.10
      + (100 - model.wear[index]) * 0.07
      + (100 - model.diseaseSeverity[index]) * 0.05,
    0,
    100,
  );
}

function issueCompletion(issues, completeOf) {
  if (!issues.length) return 100;
  return (issues.filter(completeOf).length / issues.length) * 100;
}

export function calculateHoleCondition(state, model = null, { record = true } = {}) {
  const region = model || ensureCourseMaintenance(state);
  const categories = {
    mowing: categoryAverage(region, [...MANAGED_TURF], (index, surface) => {
      const difference = Math.abs(region.heightQ[index] - region.targetHeightQ[index]) / 2;
      const target = TARGET_HEIGHT_MM[surface];
      const base = clamp(100 - (difference / Math.max(2, target)) * 72, 0, 100);
      const quality = region.mowPasses[index] ? region.mowQuality[index] : 55;
      return base * 0.82 + quality * 0.18;
    }),
    moisture: riskAwareCategory(region, [...ALL_TURF], (index, surface) => (
      rangeScore(region.moisture[index], IDEAL_MOISTURE[surface])
    )),
    turfHealth: categoryAverage(region, [...ALL_TURF], (index) => region.health[index]),
    greenQuality: categoryAverage(region, [SURFACE.GREEN, SURFACE.FRINGE], (index, surface) => (
      turfCellQuality(region, index, surface)
    )),
    teeQuality: categoryAverage(region, [SURFACE.TEE], (index, surface) => (
      turfCellQuality(region, index, surface)
    )),
    fairwayQuality: categoryAverage(region, [SURFACE.FAIRWAY], (index, surface) => (
      turfCellQuality(region, index, surface)
    )),
    roughManagement: categoryAverage(region, [SURFACE.ROUGH], (index, surface) => (
      turfCellQuality(region, index, surface)
    )),
    bunkerCondition: categoryAverage(region, [SURFACE.BUNKER], (index) => (
      region.bunkerSmooth[index] * 0.7 + (100 - region.wear[index]) * 0.3
    )),
    divotsAndBallMarks: (
      issueCompletion(region.issues.divots, (issue) => issue.repaired) * 0.6
      + issueCompletion(region.issues.ballMarks, (issue) => issue.repaired) * 0.4
    ),
    debris: issueCompletion(region.issues.debris, (issue) => issue.cleared),
    disease: riskAwareCategory(region, [...ALL_TURF], (index) => (
      clamp(
        100
          - region.diseaseSeverity[index] * 1.25
          - Math.max(0, region.diseasePressure[index] - 55) * 0.35,
        0,
        100,
      )
    )),
  };
  for (const key of Object.keys(categories)) categories[key] = Math.round(categories[key]);
  const weightTotal = Object.values(SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0);
  const total = Math.round(
    Object.entries(SCORE_WEIGHTS)
      .reduce((sum, [key, weight]) => sum + categories[key] * weight, 0)
      / weightTotal,
  );
  const previous = region.score?.categories || null;
  const reasons = previous
    ? Object.keys(categories)
        .map((key) => ({
          category: key,
          from: previous[key],
          to: categories[key],
          delta: categories[key] - previous[key],
        }))
        .filter((row) => row.delta !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 5)
    : [];
  const score = {
    total,
    categories,
    reasons,
    calculatedAtMinute: state.clock.minutes,
  };
  if (record) {
    if (!region.score || region.score.total !== total || reasons.length) {
      region.scoreHistory.push({
        minute: state.clock.minutes,
        total,
        reasons,
      });
      if (region.scoreHistory.length > 40) region.scoreHistory.shift();
    }
    region.score = score;
    region.runtime.scoreDirty = false;
  }
  return score;
}

export function finalizeCourseMaintenanceAction(state) {
  const model = ensureCourseMaintenance(state);
  updateWorkOrder(state, model);
  return model.score;
}

function workOrderStep(model, id) {
  return model.workOrder.steps.find((step) => step.id === id);
}

export function updateWorkOrder(state, model = null) {
  const region = model || ensureCourseMaintenance(state);
  const score = calculateHoleCondition(state, region);
  const historyCells = (type, predicate = null) => region.history
    .filter((entry) => entry.type === type && (!predicate || predicate(entry)))
    .reduce((sum, entry) => sum + (entry.details?.cells || 0) * (entry.count || 1), 0);
  const set = (id, complete) => {
    const step = workOrderStep(region, id);
    if (step) step.complete = !!complete;
  };
  set('arrive', region.route.arrivedAtMinute !== null);
  set('review', region.route.reviewedAtMinute !== null);
  set('inspect', region.inspection.firstCompletedAtMinute !== null);
  set('equipment', region.history.some((entry) => entry.type === 'equipment-selected'));
  const greensMowed = historyCells('mowing', (entry) => entry.details?.mowerType === 'greens-reel');
  const fairwayMowed = historyCells('mowing', (entry) => entry.details?.mowerType === 'fairway-reel');
  set('mow', greensMowed >= 24 && fairwayMowed >= 80);
  set('irrigate', score.categories.moisture >= 80 && region.history.some((entry) => entry.type === 'irrigation'));
  set('fertilize', score.categories.turfHealth >= 58 && region.history.some((entry) => entry.type === 'fertilizer'));
  set('divots', region.issues.divots.every((issue) => issue.repaired));
  set('ball-marks', region.issues.ballMarks.every((issue) => issue.repaired));
  set('bunker', region.issues.bunkerFootprints.every((issue) => issue.repaired));
  set('debris', region.issues.debris.every((issue) => issue.cleared));
  set(
    'disease',
    historyCells('disease-treatment') >= 5 || region.inspection.diseaseFlagged,
  );
  const fieldSteps = ['mow', 'irrigate', 'fertilize', 'divots', 'ball-marks', 'bunker', 'debris', 'disease'];
  set('reinspect', region.inspection.lastCompletedAtMinute !== null
    && fieldSteps.every((id) => workOrderStep(region, id)?.complete));
  set('condition', score.total >= 75);
  set(
    'save-load',
    region.route.reloadCountAtArrival !== null
      && region.persistence.reloadCount > region.route.reloadCountAtArrival,
  );
  if (
    region.workOrder.steps.every((step) => step.complete)
    && region.workOrder.completedAtMinute === null
  ) region.workOrder.completedAtMinute = state.clock.minutes;
  return region.workOrder;
}

export function selectCourseMaintenanceEquipment(state, equipmentId) {
  const model = ensureCourseMaintenance(state);
  if (!(equipmentId in model.equipment)) {
    return { ok: false, reason: 'That equipment is not in the maintenance inventory.' };
  }
  addMaintenanceHistory(state, model, 'equipment-selected', { equipmentId });
  updateWorkOrder(state, model);
  return { ok: true, equipment: model.equipment[equipmentId] };
}

function addMaintenanceHistory(state, model, type, details = {}) {
  const previous = model.history[model.history.length - 1];
  if (
    previous
    && previous.type === type
    && state.clock.minutes - previous.minute < 1
  ) {
    previous.count = (previous.count || 1) + 1;
    previous.details = details;
    return;
  }
  model.history.push({
    minute: state.clock.minutes,
    type,
    details,
  });
  if (model.history.length > 80) model.history.shift();
}

function fineIndicesForCoarse(model, state, coarseIndex) {
  if (model.runtime?.fineByCoarse?.has(coarseIndex)) {
    return model.runtime.fineByCoarse.get(coarseIndex);
  }
  const cx = coarseIndex % state.course.w;
  const cy = Math.floor(coarseIndex / state.course.w);
  const minCourseX = cx * CELL_YD;
  const minCourseY = cy * CELL_YD;
  const x0 = Math.max(
    0,
    Math.floor((minCourseX - model.bounds.minCourseYdX) / model.resolutionYd),
  );
  const y0 = Math.max(
    0,
    Math.floor((minCourseY - model.bounds.minCourseYdY) / model.resolutionYd),
  );
  const x1 = Math.min(
    model.width - 1,
    Math.ceil((minCourseX + CELL_YD - model.bounds.minCourseYdX) / model.resolutionYd) - 1,
  );
  const y1 = Math.min(
    model.height - 1,
    Math.ceil((minCourseY + CELL_YD - model.bounds.minCourseYdY) / model.resolutionYd) - 1,
  );
  const result = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const index = y * model.width + x;
      if (model.surface[index] !== SURFACE.NONE) result.push(index);
    }
  }
  return result;
}

function captureCourseMaintenanceCoarseShadow(state, model, coarseIndices = null) {
  const indices = coarseIndices || model.runtime.fineByCoarse.keys();
  for (const coarse of indices) {
    const next = coarseSnapshot(state, coarse);
    if (next) model.runtime.coarseShadow.set(coarse, next);
  }
}

function distributeCoarseDelta(array, indices, delta, minimum, maximum, offset) {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001 || !indices.length) return false;
  const direction = delta < 0 ? -1 : 1;
  const magnitude = Math.abs(delta);
  const whole = Math.floor(magnitude);
  const fractionalCells = Math.round((magnitude - whole) * indices.length);
  let changed = false;
  for (let order = 0; order < indices.length; order++) {
    const index = indices[order];
    const rotated = (order + offset) % indices.length;
    const amount = whole + (rotated < fractionalCells ? 1 : 0);
    if (!amount) continue;
    const before = array[index];
    array[index] = clamp(before + direction * amount, minimum, maximum);
    if (array[index] !== before) changed = true;
  }
  return changed;
}

// Course-wide systems (weather, staff policy, tests/scenarios, and future
// editor operations) continue to write the established coarse turf arrays.
// Import their delta before advancing localized state so neither layer silently
// wins and physical one-yard deviations remain intact.
export function reconcileCourseMaintenanceCoarseCells(state, model = null) {
  const region = model || ensureCourseMaintenance(state);
  if (!state.turf || !region) return 0;
  let reconciled = 0;
  const hour = Math.floor(state.clock.minutes / 60);
  for (const [coarse, allFine] of region.runtime.fineByCoarse) {
    if (!TURF_ZONES.has(state.course.zones[coarse])) continue;
    const current = coarseSnapshot(state, coarse);
    const previous = region.runtime.coarseShadow.get(coarse);
    if (!previous) {
      region.runtime.coarseShadow.set(coarse, current);
      continue;
    }
    const fine = allFine.filter((index) => ALL_TURF.has(region.surface[index]));
    if (!fine.length) continue;
    const offset = (coarse * 17 + hour * 13) % fine.length;
    let changed = false;
    changed = distributeCoarseDelta(
      region.heightQ,
      fine,
      (current.heightMm - previous.heightMm) * 2,
      0,
      255,
      offset,
    ) || changed;
    changed = distributeCoarseDelta(
      region.moisture,
      fine,
      current.moisture - previous.moisture,
      0,
      100,
      offset + 3,
    ) || changed;
    changed = distributeCoarseDelta(
      region.health,
      fine,
      current.health - previous.health,
      25,
      100,
      offset + 7,
    ) || changed;
    changed = distributeCoarseDelta(
      region.wear,
      fine,
      current.wear - previous.wear,
      0,
      100,
      offset + 11,
    ) || changed;
    changed = distributeCoarseDelta(
      region.fertilizer,
      fine,
      current.fertilizer - previous.fertilizer,
      0,
      100,
      offset + 19,
    ) || changed;
    changed = distributeCoarseDelta(
      region.diseaseSeverity,
      fine,
      current.diseaseSeverity - previous.diseaseSeverity,
      0,
      100,
      offset + 23,
    ) || changed;
    if (current.diseaseType !== previous.diseaseType) {
      for (const index of fine) region.diseaseType[index] = current.diseaseType;
      changed = true;
    }
    if (current.treatedDays !== previous.treatedDays) {
      for (const index of fine) region.treatedDays[index] = current.treatedDays;
      changed = true;
    }
    if (changed) {
      reconciled++;
      region.runtime.scoreDirty = true;
      for (const index of fine) refreshVisual(region, index);
    }
    region.runtime.coarseShadow.set(coarse, current);
  }
  return reconciled;
}

export function syncCourseMaintenanceCoarseCells(state, model = null) {
  const region = model || ensureCourseMaintenance(state);
  if (!state.turf || region.runtime.coarseDirty.size === 0) return 0;
  let synced = 0;
  for (const coarse of region.runtime.coarseDirty) {
    if (!TURF_ZONES.has(state.course.zones[coarse])) continue;
    const fine = fineIndicesForCoarse(region, state, coarse)
      .filter((index) => ALL_TURF.has(region.surface[index]));
    if (!fine.length) continue;
    let height = 0;
    let moisture = 0;
    let health = 0;
    let wear = 0;
    let fertilizer = 0;
    let diseaseSeverity = 0;
    let diseaseType = 0;
    let maxDiseaseSeverity = -1;
    let treated = 0;
    for (const index of fine) {
      height += region.heightQ[index] / 2;
      moisture += region.moisture[index];
      health += region.health[index];
      wear += region.wear[index];
      fertilizer += region.fertilizer[index];
      diseaseSeverity += region.diseaseSeverity[index];
      if (region.diseaseSeverity[index] > maxDiseaseSeverity) {
        maxDiseaseSeverity = region.diseaseSeverity[index];
        diseaseType = region.diseaseType[index];
      }
      treated = Math.max(treated, region.treatedDays[index]);
    }
    const count = fine.length;
    state.turf.heightMm[coarse] = height / count;
    state.turf.moisture[coarse] = moisture / count;
    state.turf.health[coarse] = health / count;
    state.turf.wear[coarse] = wear / count;
    state.turf.nutrients[coarse] = fertilizer / count;
    state.turf.disSev[coarse] = diseaseSeverity / count;
    state.turf.disType[coarse] = diseaseType;
    state.turf.treated[coarse] = treated;
    synced++;
  }
  captureCourseMaintenanceCoarseShadow(state, region, region.runtime.coarseDirty);
  region.runtime.coarseDirty.clear();
  return synced;
}

function diseaseRisk(state, model, index) {
  const surface = model.surface[index];
  if (!ALL_TURF.has(surface)) return 0;
  const moisture = model.moisture[index];
  const fertilizer = model.fertilizer[index];
  const health = model.health[index];
  const mowingStress = model.mowQuality[index] > 0 && model.mowQuality[index] < 62 ? 15 : 0;
  const wet = clamp((moisture - 62) * 1.7, 0, 55);
  const hungry = clamp((40 - fertilizer) * 1.4, 0, 42);
  const weak = clamp((55 - health) * 0.8, 0, 30);
  const weather = state.weather?.today;
  const humidity = weather ? clamp((weather.humidity - 0.48) * 90, 0, 42) : 12;
  const heat = weather ? clamp((weather.tempLoF - 58) * 2.3, 0, 35) : 0;
  if (moisture > 68 && fertilizer > 68) {
    return clamp(wet + heat + humidity + weak + mowingStress, 0, 100);
  }
  return clamp(hungry + humidity + weak + mowingStress, 0, 100);
}

export function courseMaintenanceHourlyTick(state, { coarseAdvanced = false } = {}) {
  const model = ensureCourseMaintenance(state);
  if (!model) return;
  if (coarseAdvanced) reconcileCourseMaintenanceCoarseCells(state, model);
  const weather = state.weather?.today;
  const temp = weather?.tempHiF || 72;
  const humidity = weather?.humidity || 0.5;
  const evap = clamp(0.22 + Math.max(0, temp - 70) * 0.012 + (0.55 - humidity) * 0.4, 0.12, 0.85);
  const hourAbs = Math.floor(state.clock.minutes / 60);
  const chance = (index, salt) => (
    ((Math.imul(index + 1, 1103515245) ^ Math.imul(hourAbs + salt, 12345)) >>> 0) % 10000
  ) / 10000;
  for (const index of model.runtime.activeIndices) {
    const surface = model.surface[index];
    if (surface === SURFACE.NONE) continue;
    let changed = false;
    if (ALL_TURF.has(surface)) {
      const oldMoisture = model.moisture[index];
      const moistureLoss = chance(index, 17) < evap ? 1 : 0;
      model.moisture[index] = clamp(oldMoisture - moistureLoss, 0, 100);
      if (model.moisture[index] !== oldMoisture) changed = true;
      if (model.fertilizerPending[index] > 0) {
        const release = Math.min(3, model.fertilizerPending[index]);
        model.fertilizerPending[index] -= release;
        model.fertilizer[index] = clamp(model.fertilizer[index] + release, 0, 100);
        changed = true;
      }
      const risk = Math.round(diseaseRisk(state, model, index));
      if (risk !== model.diseasePressure[index]) {
        model.diseasePressure[index] = risk;
        changed = true;
      }
      const beforeDiseaseSeverity = model.diseaseSeverity[index];
      const beforeDiseaseType = model.diseaseType[index];
      if (model.treatedDays[index] > 0) {
        model.diseaseSeverity[index] = clamp(model.diseaseSeverity[index] - 2, 0, 100);
      } else if (risk >= 72) {
        if (model.diseaseType[index] === DISEASE.NONE) {
          model.diseaseType[index] = model.moisture[index] > 70
            ? DISEASE.BROWN_PATCH
            : DISEASE.DOLLAR_SPOT;
        }
        model.diseaseSeverity[index] = clamp(model.diseaseSeverity[index] + 1, 0, 100);
      } else if (chance(index, 31) < 0.25) {
        model.diseaseSeverity[index] = clamp(model.diseaseSeverity[index] - 1, 0, 100);
      }
      if (model.diseaseSeverity[index] <= 0) model.diseaseType[index] = DISEASE.NONE;
      if (
        model.diseaseSeverity[index] !== beforeDiseaseSeverity
        || model.diseaseType[index] !== beforeDiseaseType
      ) changed = true;
      const moistureScore = rangeScore(model.moisture[index], IDEAL_MOISTURE[surface]);
      const fertilizerScore = rangeScore(model.fertilizer[index], IDEAL_FERTILIZER[surface]);
      const stress = (
        (100 - moistureScore) * 0.0025
        + (100 - fertilizerScore) * 0.0018
        + model.diseaseSeverity[index] * 0.002
      );
      const recovery = moistureScore > 82 && fertilizerScore > 75 ? 0.08 : 0;
      const beforeHealth = model.health[index];
      const healthDelta = recovery - stress;
      if (healthDelta > 0 && chance(index, 47) < healthDelta) {
        model.health[index] = clamp(model.health[index] + 1, 25, 100);
      } else if (healthDelta < 0 && chance(index, 59) < -healthDelta) {
        model.health[index] = clamp(model.health[index] - 1, 25, 100);
      }
      if (model.health[index] !== beforeHealth) changed = true;
    }
    if (changed) {
      markDirty(model, index);
      markCoarseDirty(model, state, index);
      refreshVisual(model, index);
    }
  }
  for (const divot of model.issues.divots) {
    if (divot.repaired && divot.recoveryHours > 0) divot.recoveryHours--;
  }
  // Enabled heads are actual irrigation, not a decorative switch. One hourly
  // pulse keeps simulation cost bounded and makes leaving a head running a
  // meaningful overwatering risk after the dry patch has recovered.
  for (const head of model.irrigation.heads) {
    if (!head.enabled || head.status === 'clogged') continue;
    irrigateCourseMaintenancePath(state, {
      x: head.x,
      z: head.z,
      radiusYd: head.radiusYd,
      pointsPerSecond: 10,
      dtSec: 1,
    });
  }
  model.lastTickMinute = state.clock.minutes;
  syncCourseMaintenanceCoarseCells(state, model);
  if (hourAbs % 6 === 0) updateWorkOrder(state, model);
}

export function courseMaintenanceDailyTick(state, { coarseAdvanced = false } = {}) {
  const model = ensureCourseMaintenance(state);
  if (!model) return;
  if (coarseAdvanced) reconcileCourseMaintenanceCoarseCells(state, model);
  for (const index of model.runtime.activeIndices) {
    let changed = false;
    if (model.treatedDays[index] > 0) {
      model.treatedDays[index]--;
      changed = true;
    }
    if (model.wear[index] > 0 && model.surface[index] !== SURFACE.BUNKER) {
      model.wear[index] = clamp(model.wear[index] - 1, 0, 100);
      changed = true;
    }
    if (changed) {
      markDirty(model, index);
      markCoarseDirty(model, state, index);
      refreshVisual(model, index);
    }
  }
  syncCourseMaintenanceCoarseCells(state, model);
  updateWorkOrder(state, model);
}

export function courseMaintenanceRatingModifier(state) {
  const model = state.courseMaintenance;
  if (!model?.score) return 0;
  return clamp((model.score.total - 50) * 0.08, -4, 4);
}

export function courseMaintenanceGreenSpeedModifier(state, holeId) {
  const model = state.courseMaintenance;
  if (!model || model.heroHoleId !== holeId) return 0;
  const greenMowing = categoryAverage(
    model,
    [SURFACE.GREEN],
    (index) => clamp(100 - Math.abs(model.heightQ[index] - model.targetHeightQ[index]) * 8, 0, 100),
  );
  return clamp((greenMowing - 65) / 40, -1.2, 0.9);
}
