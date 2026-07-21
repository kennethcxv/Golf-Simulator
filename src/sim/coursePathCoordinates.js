// Stored path points have two supported coordinate contracts.
//
// Vector courses author paths on the continuous terrain plane (0..w / 0..h),
// while legacy grid courses store path points relative to cell centres. Keep
// both directions in one pure transform so rendering and bridge queries cannot
// silently disagree about the historical half-cell offset.

import { CELL_YD } from './constants.js';

function positiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
  return value;
}

export function createCoursePathCoordinateTransform(course, {
  worldW,
  worldH,
  cellYd = CELL_YD,
} = {}) {
  positiveFinite(worldW, 'worldW');
  positiveFinite(worldH, 'worldH');
  positiveFinite(cellYd, 'cellYd');

  const continuousPlane = !!course?.vec;
  const centerOffset = continuousPlane ? 0 : 0.5;
  const toWorld = (value, span) => (value + centerOffset) * cellYd - span / 2;
  const toCourse = (value, span) => (value + span / 2) / cellYd - centerOffset;

  return Object.freeze({
    continuousPlane,
    worldX: (x) => toWorld(x, worldW),
    worldZ: (y) => toWorld(y, worldH),
    courseX: (x) => toCourse(x, worldW),
    courseY: (z) => toCourse(z, worldH),
  });
}
