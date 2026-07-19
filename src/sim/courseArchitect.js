// GOLF EMPIRE — the course architect: designs a nine-hole parkland property
// as VECTORS (courseVec schema), then derives the sim grid, terrain program,
// cart-path network, and an intentional planting plan from the design.
//
// The routing is an authored template — two loops off the clubhouse like a
// real parkland nine — with seeded jitter so no two properties are identical:
//
//   H1 par 4  gentle dogleg-R, uphill, fairway bunker at the landing
//   H2 par 3  mid-length, elevated tee dropping to a defended green
//   H3 par 5  sweeping along the northern ridge, cross bunker
//   H4 par 4  strong dogleg-left elbow back to the clubhouse
//   H5 par 4  water risk/reward — pond guards the right approach
//   H6 par 3  short, ringed by pot bunkers
//   H7 par 5  long downhill roller with staggered fairway bunkers
//   H8 par 3  mid, through a forest glade
//   H9 par 4  finisher returning to the clubhouse lawn
//
// Everything is deterministic from the rng passed in.

import { ZONE, CELL_YD, HOLE_STATUS, GRID_W, GRID_H } from './constants.js';
import { makeCourse, addHole, idx, inBounds, getZone } from './course.js';
import {
  emptyVec, makeVecTee, makeVecGreen, makeVecBunker, makeVecPond,
  deriveZones, sampleOpen, polyLength, alongPoly, ensurePaint, invalidateGeom,
  evaluateSurface, getGeom,
} from './courseVec.js';
import {
  applyAuthoredTerrainProfiles, compileVegetationExclusions, tallVegetationAllowed,
} from './courseLandscape.js';
import { clamp } from '../core/utils.js';

// ------------------------------------------------------------ the template ----

// Cell coordinates (1 cell = 8 yd) on the 120×80 property. y grows south.
function corridorLandscape(leftTypes, rightTypes, options = {}) {
  const treeT0 = options.treeT0 ?? 0.18;
  const treeT1 = options.treeT1 ?? 0.88;
  const spacingYd = options.spacingYd ?? 31;
  const openingClearYd = options.openingClearYd ?? 30;
  const approachClearYd = options.approachClearYd ?? 26;
  return {
    exclusions: [
      { kind: 'route', t0: 0, t1: 0.18, clearHalfYd: openingClearYd },
      // Canopies need more than trunk clearance. Twelve yards beyond the mown
      // edge keeps normal approach/landing cameras and real shot windows out of
      // broadleaf crowns while still allowing deliberately framed corridors.
      { kind: 'route', t0: 0.18, t1: 0.76, beyondFairwayYd: 12 },
      { kind: 'route', t0: 0.76, t1: 1, clearHalfYd: approachClearYd },
      { kind: 'green', bufferYd: 22 },
      { kind: 'bunker', bufferYd: 7 },
      { kind: 'path', bufferYd: 5 },
    ],
    plantings: [
      {
        side: 'left', t0: treeT0, t1: treeT1, beyondFairwayYd: 17,
        spacingYd, lateralJitterYd: 2.5, minClearYd: 7,
        scale: [0.86, 1.18], types: leftTypes,
      },
      {
        side: 'right', t0: treeT0, t1: treeT1, beyondFairwayYd: 18,
        spacingYd: spacingYd + 3, lateralJitterYd: 2.5, minClearYd: 7,
        scale: [0.84, 1.16], types: rightTypes,
      },
      {
        side: 'left', t0: 0.14, t1: 0.94, beyondFairwayYd: 3,
        spacingYd: 21, lateralJitterYd: 3, minClearYd: 3,
        scale: [0.78, 1.12],
        types: ['grass_clump', 'bush_native', 'shrub_round', 'grass_clump', 'shrub_round', 'rock_s'],
      },
      {
        side: 'right', t0: 0.16, t1: 0.92, beyondFairwayYd: 4,
        spacingYd: 23, lateralJitterYd: 3, minClearYd: 3,
        scale: [0.78, 1.12],
        types: ['bush_native', 'grass_clump', 'shrub_round', 'bush_native', 'grass_clump', 'rock_s'],
      },
    ],
  };
}

// Hero water can use an architect-controlled normalized outline while retaining
// makeVecPond's schema, depth, and deterministic construction. The generic
// seeded silhouette remains the fallback for every other pond/property.
function makeAuthoredPond(spec, cx, cy, seed) {
  const pond = makeVecPond(cx, cy, spec.rx, spec.ry, seed);
  const outline = Array.isArray(spec.outline) && spec.outline.length >= 8
    ? spec.outline.filter((point) => (
      Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
    ))
    : null;
  if (outline?.length >= 8) {
    const angle = Number(spec.angle) || 0;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    pond.pts = outline.map(([across, front]) => {
      const ex = across * spec.rx / CELL_YD;
      const ey = front * spec.ry / CELL_YD;
      return { x: cx + ex * ca - ey * sa, y: cy + ex * sa + ey * ca };
    });
  }
  if (spec.role) pond.role = spec.role;
  if (spec.surface) pond.surface = spec.surface;
  return pond;
}

const TEMPLATE = [
  {
    name: 'Opening Drive', par: 4, hcp: 6, roughW: 25,
    line: [[20.75, 34.75], [36.75, 30.5], [54.25, 31.5], [71.75, 27.75]],
    width: [[0.05, 9], [0.18, 13], [0.48, 20.5], [0.64, 18.5], [0.8, 12], [1, 14]],
    green: {
      r: 12, elong: 1.3, raise: 2.35, tilt: 0.18,
      // An angled pear rather than a seeded oval. Coordinates are normalized
      // [across play, toward the approach]; Catmull-Rom sampling turns these
      // restrained control points into a continuous, mowable boundary. The
      // forward nose supplies a ground-access throat between the two traps.
      angleOffset: 0.06,
      tiltOffset: 0.1,
      style: 'opening-drive-angled-pear',
      outline: [
        [0.98, -0.08], [0.91, 0.31], [0.68, 0.68], [0.36, 0.98],
        [0.06, 1.2], [-0.28, 1.08], [-0.62, 0.79], [-0.94, 0.39],
        [-1.07, -0.04], [-0.91, -0.48], [-0.62, -0.81], [-0.24, -1.02],
        [0.2, -1.06], [0.59, -0.91], [0.85, -0.63], [0.97, -0.33],
      ],
      // Broad rolls measured relative to the outline: a quiet back-left shelf
      // and a shallow front-right feed. Heights are feet, deliberately below
      // five inches so the surface reads as shaped without becoming miniature.
      contours: [
        { role: 'back-left-shelf', across: -0.4, front: -0.28, radius: 0.76, heightFt: 0.3 },
        { role: 'front-right-feed', across: 0.46, front: 0.34, radius: 0.62, heightFt: -0.12 },
      ],
    },
    bunkers: [
      { at: [50.5, 34.0], r: 8.5, depth: 2.2, lip: 1.1, stretch: 1.35, angle: -0.18, lobes: 3 }, // landing edge, right
      { at: [69.5, 25.6], r: 6.2, depth: 2.7, lip: 1.35, stretch: 1.28, angle: 0.52, lobes: 3 }, // greenside left
    ],
    // Pure, hash-shaped authored features. These never draw from rng, consume a
    // vector id, or count against the quality-scaled bunker budget.
    fixedBunkers: [
      { at: [68.7, 30.6], r: 5.4, depth: 2.5, lip: 1.25, stretch: 1.15, angle: -0.2, lobes: 3 },
    ],
    path: {
      side: 'outward', arrivalPull: 0.5,
      fullOffsetFromT: 0.08, fullOffsetToT: 0.92,
      minFairwayEdgeClearYd: 26,
    },
    vegetation: {
      exclusions: [
        { kind: 'route', t0: 0, t1: 0.18, clearHalfYd: 34 },
        { kind: 'route', t0: 0.18, t1: 0.72, beyondFairwayYd: 12 },
        { kind: 'route', t0: 0.72, t1: 1, clearHalfYd: 26 },
        { kind: 'green', bufferYd: 24 },
        { kind: 'bunker', bufferYd: 8 },
        { kind: 'path', bufferYd: 6 },
      ],
      // Route-relative, RNG-free plantings make the opening corridor read as a
      // deliberately framed golf hole. They are sockets in authored data, not
      // renderer coordinates; the planting pass projects them from the spline.
      plantings: [
        { side: 'left', t0: 0.2, t1: 0.7, beyondFairwayYd: 17, spacingYd: 32, lateralJitterYd: 2.5,
          scale: [0.86, 1.18], types: ['oak_a', 'maple_a', 'pine_a', 'oak_b'] },
        { side: 'right', t0: 0.22, t1: 0.7, beyondFairwayYd: 18, spacingYd: 35, lateralJitterYd: 2,
          scale: [0.84, 1.16], types: ['pine_a', 'oak_b', 'spruce_a', 'maple_a'] },
        { side: 'left', t0: 0.72, t1: 0.93, beyondFairwayYd: 20, spacingYd: 28, lateralJitterYd: 1.5,
          scale: [0.86, 1.16], types: ['oak_a', 'pine_b', 'maple_a'] },
        { side: 'right', t0: 0.72, t1: 0.93, beyondFairwayYd: 20, spacingYd: 30, lateralJitterYd: 1.5,
          scale: [0.84, 1.14], types: ['spruce_a', 'oak_b', 'pine_a'] },
        { side: 'left', t0: 0.16, t1: 0.94, beyondFairwayYd: 3, spacingYd: 18, lateralJitterYd: 3,
          minClearYd: 3, scale: [0.82, 1.18],
          types: ['grass_clump', 'bush_native', 'shrub_round', 'grass_clump', 'shrub_round', 'rock_s'] },
        { side: 'right', t0: 0.18, t1: 0.92, beyondFairwayYd: 4, spacingYd: 20, lateralJitterYd: 3,
          minClearYd: 3, scale: [0.78, 1.14],
          types: ['bush_native', 'grass_clump', 'shrub_round', 'bush_native', 'grass_clump', 'rock_s'] },
      ],
    },
    terrainProfile: {
      relativeFeet: [[0, 0], [0.16, 2.4], [0.34, 6.6], [0.5, 5.0], [0.64, 3.3], [0.82, 7.3], [1, 8.2]],
      landingPlateau: { t0: 0.42, t1: 0.64, maxCrossSlope: 0.025 },
      landingCrown: { t0: 0.2, t1: 0.72, edgeDropFt: 2.6 },
      approachShoulder: { t0: 0.74, t1: 0.94, side: 'right', heightFt: 3.1 },
    },
    // Unequal shoulders sit behind the putting surface instead of forming the
    // previous symmetric dome. Local distances are real-world yards.
    greenBackstops: {
      mounds: [
        { role: 'back-left-shoulder', backYd: 22, acrossYd: -15, radiusYd: 18, heightFt: 2.8 },
        { role: 'back-right-shoulder', backYd: 17, acrossYd: 18, radiusYd: 14, heightFt: 2.1 },
      ],
    },
  },
  {
    name: 'The Overlook', par: 3, hcp: 7, roughW: 24,
    line: [[76.25, 33.75], [84.8, 32.4], [91.3, 30.8], [96.8, 29.1]],
    width: [[0, 5.5], [0.25, 4.5], [0.6, 6.5], [0.82, 9], [1, 12]],
    green: {
      r: 11.5, elong: 1.26, angleOffset: 0.3, raise: 2, tilt: 0.16, tiltOffset: -0.05,
      style: 'overlook-diagonal-fan',
      outline: [
        [0.92, -0.58], [1.02, -0.08], [0.86, 0.48], [0.52, 0.92],
        [0.08, 1.12], [-0.42, 1.02], [-0.82, 0.68], [-1.02, 0.18],
        [-0.92, -0.36], [-0.58, -0.82], [-0.08, -1], [0.48, -0.9],
      ],
      contours: [
        { role: 'rear-right-shelf', across: 0.38, front: -0.28, radius: 0.66, heightFt: 0.22 },
        { role: 'front-feed', across: -0.1, front: 0.42, radius: 0.7, heightFt: -0.1 },
      ],
    },
    bunkers: [
      { at: [94.8, 27.8], r: 5.8, depth: 2.8, lip: 1.25, stretch: 1.3, angle: 0.28, lobes: 3 },
      { at: [97.6, 31.4], r: 5.2, depth: 2.5, lip: 1.15, stretch: 1.15, angle: -0.2, lobes: 3 },
    ],
    teeKnoll: 3.5,
    terrainProfile: {
      relativeFeet: [[0, 0], [0.14, -1.2], [0.42, -4.2], [0.72, -8.4], [1, -11.2]],
      approachShoulder: { t0: 0.72, t1: 0.96, side: 'right', heightFt: 1.8 },
    },
    path: {
      side: 'outward', arrivalPull: 0.42, fullOffsetFromT: 0.1,
      fullOffsetToT: 0.88, minFairwayEdgeClearYd: 16,
      transitionAfter: [[100.5, 27.5], [105, 26], [108, 23], [106, 19.5]],
    },
    vegetation: corridorLandscape(
      ['birch_a', 'pine_a', 'maple_a'], ['pine_a', 'spruce_a', 'oak_b'],
      { openingClearYd: 32, approachClearYd: 28, spacingYd: 34 },
    ),
    teeAmenities: { bench: true, washer: false, trash: true },
  },
  {
    name: 'Long Meadow', par: 5, hcp: 2, roughW: 30,
    line: [[104.5, 23.4], [94.5, 17.4], [78, 12.8], [61, 11.8], [44.5, 13.2]],
    width: [[0.04, 9], [0.16, 13], [0.32, 18], [0.46, 20], [0.58, 14], [0.72, 18.5], [0.88, 12], [1, 14.5]],
    green: {
      r: 13.4, elong: 1.42, angleOffset: -0.22, raise: 2.1, tilt: 0.18, tiltOffset: 0.08,
      style: 'long-meadow-diagonal-kidney',
      outline: [
        [1.05, -0.52], [1.06, 0.02], [0.82, 0.58], [0.42, 1], [-0.06, 1.1],
        [-0.52, 0.92], [-0.84, 0.55], [-0.9, 0.12], [-0.7, -0.14],
        [-0.82, -0.56], [-0.42, -0.9], [0.04, -0.98], [0.54, -0.88], [0.88, -0.7],
      ],
      contours: [
        { role: 'back-shelf', across: -0.34, front: -0.32, radius: 0.72, heightFt: 0.25 },
        { role: 'run-in-feed', across: 0.3, front: 0.42, radius: 0.65, heightFt: -0.1 },
      ],
    },
    bunkers: [
      { at: [75, 10.4], r: 8, depth: 2.2, lip: 1.05, stretch: 1.45, angle: -0.1, lobes: 3 },
      { at: [61.5, 15.2], r: 8.7, depth: 2.3, lip: 1.1, stretch: 1.65, angle: 0.15, lobes: 3 },
      { at: [46.7, 15.2], r: 6.2, depth: 2.7, lip: 1.25, stretch: 1.2, angle: 0.4, lobes: 3 },
    ],
    terrainProfile: {
      relativeFeet: [[0, 0], [0.14, 1.2], [0.3, 4.5], [0.46, 6.2], [0.62, 4.1], [0.76, 7], [0.9, 5.4], [1, 6.4]],
      landingPlateau: { t0: 0.34, t1: 0.52, maxCrossSlope: 0.028 },
      landingCrown: { t0: 0.2, t1: 0.76, edgeDropFt: 2 },
      approachShoulder: { t0: 0.76, t1: 0.94, side: 'left', heightFt: 2.3 },
    },
    path: {
      side: 'outward', arrivalPull: 0.28, fullOffsetFromT: 0.09,
      fullOffsetToT: 0.92, minFairwayEdgeClearYd: 15,
    },
    vegetation: corridorLandscape(
      ['oak_a', 'maple_a', 'oak_b'], ['pine_a', 'oak_b', 'spruce_a'],
      { treeT0: 0.14, treeT1: 0.92, spacingYd: 38, openingClearYd: 34, approachClearYd: 28 },
    ),
    teeAmenities: { bench: true, washer: true, trash: true },
  },
  {
    name: 'The Elbow', par: 4, hcp: 5, roughW: 25,
    line: [[37.8, 8], [26.5, 10], [16, 17], [7.8, 30], [7.2, 45.5]],
    width: [[0.04, 8], [0.16, 11], [0.34, 17], [0.48, 20], [0.6, 14], [0.76, 11], [0.9, 13], [1, 14]],
    green: {
      r: 11.8, elong: 1.2, angleOffset: 0.34, raise: 2, tilt: 0.17, tiltOffset: -0.08,
      style: 'elbow-offset-boomerang',
      outline: [
        [1.02, -0.42], [1, 0.08], [0.72, 0.66], [0.3, 1.04], [-0.18, 1.08],
        [-0.62, 0.86], [-0.96, 0.42], [-1, -0.08], [-0.72, -0.5],
        [-0.3, -0.9], [0.16, -0.96], [0.66, -0.78],
      ],
      contours: [
        { role: 'rear-left-shelf', across: -0.36, front: -0.3, radius: 0.68, heightFt: 0.24 },
        { role: 'front-right-feed', across: 0.42, front: 0.38, radius: 0.6, heightFt: -0.11 },
      ],
    },
    bunkers: [
      { at: [16.5, 21.5], r: 8, depth: 2.4, lip: 1.15, stretch: 1.45, angle: 0.72, lobes: 3 },
      { at: [9.8, 42.6], r: 6, depth: 2.7, lip: 1.3, stretch: 1.2, angle: 0.25, lobes: 3 },
    ],
    strongDogleg: true,
    terrainProfile: {
      relativeFeet: [[0, 0], [0.18, 2], [0.4, 5.5], [0.53, 4.8], [0.68, 0.5], [0.84, -3], [1, -1.5]],
      landingPlateau: { t0: 0.34, t1: 0.54, maxCrossSlope: 0.025 },
      landingCrown: { t0: 0.22, t1: 0.66, edgeDropFt: 2.3 },
      approachShoulder: { t0: 0.72, t1: 0.94, side: 'left', heightFt: 2.4 },
    },
    path: {
      side: 'outward', arrivalPull: 0.32, fullOffsetFromT: 0.08,
      fullOffsetToT: 0.92, minFairwayEdgeClearYd: 14,
      transitionAfter: [[4.2, 48.5], [8.5, 51], [14.5, 52.5], [18, 49], [21, 46.5]],
    },
    vegetation: corridorLandscape(
      ['oak_a', 'maple_a', 'fill_a'], ['pine_a', 'spruce_a', 'oak_b'],
      { treeT0: 0.12, treeT1: 0.94, spacingYd: 29, openingClearYd: 32, approachClearYd: 26 },
    ),
    teeAmenities: {
      bench: true, washer: false, trash: false,
      // Keep the furniture beside the walk-on rather than between the player
      // camera and this sharply turning opening shot.
      signLateralYd: 7.5, signAlongYd: 2.4,
      benchLateralYd: 12, benchAlongYd: -6,
    },
  },
  {
    name: 'Millpond', par: 4, hcp: 1, roughW: 26,
    line: [[23.5, 50.8], [37, 52.8], [50.5, 53.2], [62, 54.7], [75.5, 58]],
    width: [[0.04, 9], [0.16, 13.5], [0.38, 20], [0.56, 18], [0.72, 13.5], [0.86, 11.5], [1, 14]],
    green: {
      r: 13.8, elong: 1.24, angleOffset: -0.18, raise: 2.05, tilt: 0.22, tiltOffset: 0.12,
      style: 'millpond-diagonal-cape',
      outline: [
        [0.98, -0.16], [0.92, 0.28], [0.68, 0.72], [0.28, 1.06], [-0.14, 1.16],
        [-0.57, 0.92], [-0.91, 0.48], [-1.02, -0.04], [-0.84, -0.56],
        [-0.46, -0.96], [0.02, -1.08], [0.48, -0.88], [0.82, -0.54],
      ],
      contours: [
        { role: 'safe-left-shelf', across: -0.38, front: -0.12, radius: 0.72, heightFt: 0.28 },
        { role: 'pond-feed', across: 0.48, front: 0.28, radius: 0.6, heightFt: -0.16 },
      ],
    },
    bunkers: [
      { at: [42, 50.4], r: 7.8, depth: 2.2, lip: 1.1, stretch: 1.55, angle: 0.15, lobes: 3 },
      { at: [77.3, 55.8], r: 5.8, depth: 2.7, lip: 1.3, stretch: 1.25, angle: -0.25, lobes: 3 },
    ],
    // The pond follows the right side of the diagonal approach as a single
    // strategic cape. Its fairway-facing bank stays open; the broader back bank
    // carries the landscape dressing so the target edge remains readable.
    pond: {
      at: [67.25, 60.15], rx: 36, ry: 29, angle: 0.12,
      role: 'millpond-approach', surface: 'outline',
      outline: [
        [1.02, -0.12], [0.95, 0.18], [0.78, 0.48], [0.52, 0.75], [0.15, 0.91],
        [-0.17, 0.86], [-0.48, 0.99], [-0.75, 0.72], [-0.95, 0.38], [-1.02, -0.02],
        [-0.9, -0.34], [-0.64, -0.58], [-0.31, -0.72], [0.02, -0.9], [0.34, -0.78],
        [0.63, -0.61], [0.86, -0.4], [0.98, -0.25],
      ],
    },
    terrainProfile: {
      relativeFeet: [[0, 0], [0.15, 2], [0.38, 1], [0.55, 0], [0.7, -2.5], [0.84, -0.5], [1, 3.5]],
      landingPlateau: { t0: 0.3, t1: 0.55, maxCrossSlope: 0.025 },
      landingCrown: { t0: 0.2, t1: 0.72, edgeDropFt: 2 },
    },
    path: {
      side: 'inward', arrivalPull: 1, fullOffsetFromT: 0.08,
      fullOffsetToT: 0.92, minFairwayEdgeClearYd: 14, waterBufferYd: 8,
      transitionAfter: [
        [84, 51], [83.5, 51.75], [83, 52.5], [82, 53.25], [81, 54],
        [80.25, 54.75], [79.5, 55.5], [78.75, 56.25], [78.25, 57],
        [78.1, 57.75], [78.1, 58.5], [78.1, 59.25], [77.8, 60],
        [77.5, 60.75], [77.75, 61.5], [78.5, 62.25], [79.25, 63],
        [80, 63.75],
      ],
    },
    vegetation: corridorLandscape(
      ['oak_a', 'maple_a', 'birch_a'], ['oak_b', 'pine_a', 'maple_a'],
      { spacingYd: 34, openingClearYd: 32, approachClearYd: 30 },
    ),
    teeAmenities: { bench: true, washer: false, trash: true },
  },
  {
    name: 'Short Iron', par: 3, hcp: 9, roughW: 21,
    line: [[78.8, 61], [87.2, 63.3], [96.3, 65.8]],
    width: [[0, 4.5], [0.28, 3.2], [0.68, 2.7], [0.88, 5], [1, 8.5]],
    green: {
      r: 10.7, elong: 1.34, angleOffset: 0.38, raise: 2.2, tilt: 0.24, tiltOffset: -0.15,
      style: 'short-iron-kidney',
      outline: [
        [0.96, -0.1], [0.82, 0.42], [0.48, 0.88], [0.02, 1.08], [-0.45, 0.94],
        [-0.83, 0.56], [-0.96, 0.04], [-0.7, -0.46], [-0.26, -0.82],
        [0.18, -0.72], [0.58, -0.92], [0.9, -0.56],
      ],
      contours: [
        { role: 'high-back-pad', across: -0.25, front: -0.32, radius: 0.66, heightFt: 0.24 },
        { role: 'bailout-feed', across: 0.38, front: 0.38, radius: 0.58, heightFt: -0.1 },
      ],
    },
    bunkers: [
      { at: [94.1, 66.9], r: 5.8, depth: 3.2, lip: 1.35, stretch: 1.25, angle: 0.3, lobes: 3 },
      { at: [96, 62.9], r: 4.2, depth: 2.5, lip: 1.15, stretch: 1.05, angle: -0.2, lobes: 2 },
      { at: [98.5, 65.7], r: 3.9, depth: 2.8, lip: 1.2, stretch: 1, angle: 0.1, lobes: 2 },
    ],
    terrainProfile: {
      relativeFeet: [[0, 0], [0.18, -1], [0.45, -3], [0.7, 0], [0.88, 4], [1, 6.5]],
    },
    path: {
      side: 'outward', arrivalPull: 1, fullOffsetFromT: 0.1,
      fullOffsetToT: 0.88, minFairwayEdgeClearYd: 14,
      transitionAfter: [
        [94, 68], [95, 68.1], [96, 68.2], [97, 68.3], [98, 68.4],
        [99, 68.6], [100, 68.8], [101, 69], [101.5, 69.7],
        [101.8, 70.5], [101.8, 71.25], [101.5, 72], [101, 72.75],
        [100.5, 73.5], [99.75, 74.25], [99, 75],
      ],
    },
    vegetation: corridorLandscape(
      ['pine_a', 'spruce_a', 'birch_a'], ['oak_b', 'maple_a', 'pine_a'],
      { treeT0: 0.26, treeT1: 0.9, spacingYd: 38, openingClearYd: 34, approachClearYd: 28 },
    ),
    teeAmenities: { bench: true, washer: false, trash: true },
    camera: { frameYawOffset: 0.16 },
  },
  {
    name: 'Cascades', par: 5, hcp: 3, roughW: 28,
    line: [[100, 70.5], [86.5, 73.3], [71, 72.7], [55.5, 69.5], [43, 68], [35, 65.5]],
    width: [[0.03, 8.5], [0.14, 12], [0.28, 18.5], [0.43, 14], [0.6, 19.5], [0.75, 13], [0.88, 16], [1, 13.5]],
    green: {
      r: 12.4, elong: 1.28, angleOffset: 0.2, raise: 1.95, tilt: 0.21, tiltOffset: 0.1,
      style: 'cascades-saddle',
      outline: [
        [0.96, -0.12], [0.86, 0.34], [0.58, 0.78], [0.18, 1.05], [-0.26, 1],
        [-0.68, 0.7], [-0.94, 0.24], [-0.92, -0.28], [-0.62, -0.72],
        [-0.18, -1], [0.3, -0.94], [0.7, -0.66], [0.94, -0.3],
      ],
      contours: [
        { role: 'upper-shelf', across: -0.35, front: -0.28, radius: 0.72, heightFt: 0.26 },
        { role: 'lower-feed', across: 0.32, front: 0.4, radius: 0.62, heightFt: -0.12 },
      ],
    },
    bunkers: [
      { at: [84, 70.4], r: 8.2, depth: 2.2, lip: 1.05, stretch: 1.5, angle: 0.15, lobes: 3 },
      { at: [64, 74.8], r: 8, depth: 2.25, lip: 1.1, stretch: 1.35, angle: -0.25, lobes: 3 },
      { at: [38.2, 67.9], r: 6.2, depth: 2.7, lip: 1.25, stretch: 1.2, angle: 0.25, lobes: 3 },
    ],
    rollers: true,
    terrainProfile: {
      relativeFeet: [[0, 0], [0.12, -3], [0.25, -8], [0.37, -4.5], [0.51, -10], [0.63, -6.5], [0.78, -14], [0.9, -16], [1, -13.5]],
      landingPlateau: { t0: 0.2, t1: 0.36, maxCrossSlope: 0.028 },
      landingCrown: { t0: 0.16, t1: 0.78, edgeDropFt: 2.2 },
      approachShoulder: { t0: 0.78, t1: 0.94, side: 'left', heightFt: 2.5 },
    },
    path: {
      side: 'outward', arrivalPull: 1, fullOffsetFromT: 0.07,
      fullOffsetToT: 0.93, minFairwayEdgeClearYd: 14,
      transitionAfter: [
        [31, 70.5], [31, 69.5], [31.2, 68.5], [31.5, 67.5],
        [31.8, 66.5], [32.2, 65.5], [33, 64.5], [34, 63.5],
        [35, 63.2], [36, 63.1], [37, 63.2], [38, 63.4],
        [39, 63.6], [40, 63.8], [41, 64], [42, 64.3],
        [43, 64.7], [44, 65],
      ],
    },
    vegetation: corridorLandscape(
      ['pine_a', 'spruce_a', 'oak_b'], ['oak_a', 'maple_a', 'pine_b'],
      { treeT0: 0.12, treeT1: 0.94, spacingYd: 36, openingClearYd: 36, approachClearYd: 28 },
    ),
    teeAmenities: { bench: true, washer: true, trash: true },
  },
  {
    name: 'The Glade', par: 3, hcp: 8, roughW: 21,
    line: [[39, 61.5], [48.2, 60.9], [58.5, 61]],
    width: [[0, 5], [0.28, 3.8], [0.62, 4.2], [0.84, 7], [1, 9.5]],
    green: {
      r: 11.1, elong: 1.3, angleOffset: -0.24, raise: 1.9, tilt: 0.16, tiltOffset: 0.12,
      style: 'glade-wide-saddle',
      outline: [
        [1.02, -0.2], [0.92, 0.3], [0.62, 0.78], [0.18, 1.02], [-0.28, 1.08],
        [-0.72, 0.78], [-0.98, 0.3], [-0.94, -0.2], [-0.7, -0.62],
        [-0.24, -0.94], [0.24, -0.88], [0.66, -0.72], [0.94, -0.44],
      ],
      contours: [
        { role: 'back-glade-shelf', across: -0.32, front: -0.3, radius: 0.7, heightFt: 0.2 },
        { role: 'center-run-in', across: 0.2, front: 0.42, radius: 0.68, heightFt: -0.1 },
      ],
    },
    bunkers: [
      { at: [56.1, 59.2], r: 5.8, depth: 2.6, lip: 1.25, stretch: 1.35, angle: 0.18, lobes: 3 },
      { at: [59.9, 62.9], r: 5, depth: 2.5, lip: 1.15, stretch: 1.1, angle: -0.3, lobes: 3 },
    ],
    // A restrained pad still separates the tee complex, while the former
    // 4.5-foot dome hid the entire par-3 target from a player's eye height.
    teeKnoll: 1.35,
    terrainProfile: {
      relativeFeet: [[0, 0], [0.22, -0.8], [0.5, -2], [0.78, -0.8], [1, 0.8]],
      approachShoulder: { t0: 0.7, t1: 0.96, side: 'right', heightFt: 1.5 },
    },
    path: {
      side: 'outward', arrivalPull: 1, fullOffsetFromT: 0.12,
      fullOffsetToT: 0.86, minFairwayEdgeClearYd: 8,
      // H8 exits into the shared H5/H6 circulation spine. Keeping this as a
      // branch avoids an implausible paved lap around the east boundary (and
      // removes the old transfer that sat in H6's target view).
      transitionAfter: [[64, 65], [72, 68], [80, 63.75]],
    },
    vegetation: corridorLandscape(
      ['birch_a', 'maple_a', 'oak_a'], ['pine_a', 'spruce_a', 'birch_a'],
      { treeT0: 0.08, treeT1: 0.95, spacingYd: 27, openingClearYd: 34, approachClearYd: 30 },
    ),
    teeAmenities: { bench: true, washer: false, trash: true },
    camera: { frameYawOffset: 0.22 },
  },
  {
    name: 'Homeward', par: 4, hcp: 6, roughW: 25,
    line: [[65, 48.2], [49.5, 44.2], [33, 43.2], [20.5, 45.5]],
    width: [[0.04, 9], [0.18, 13], [0.42, 19], [0.58, 17], [0.72, 12], [0.88, 13.5], [1, 14]],
    green: {
      r: 12.9, elong: 1.28, angleOffset: 0.16, raise: 2.15, tilt: 0.19, tiltOffset: -0.08,
      style: 'homeward-terrace-pear',
      outline: [
        [0.96, -0.18], [0.9, 0.28], [0.66, 0.7], [0.26, 1.06], [-0.2, 1.12],
        [-0.62, 0.86], [-0.94, 0.42], [-1.02, -0.06], [-0.82, -0.52],
        [-0.42, -0.9], [0.06, -1.02], [0.52, -0.84], [0.84, -0.5],
      ],
      contours: [
        { role: 'clubhouse-rear-shelf', across: -0.34, front: -0.3, radius: 0.7, heightFt: 0.25 },
        { role: 'home-run-in', across: 0.28, front: 0.42, radius: 0.64, heightFt: -0.1 },
      ],
    },
    bunkers: [
      { at: [47.2, 46.6], r: 7.2, depth: 2.3, lip: 1.1, stretch: 1.45, angle: -0.12, lobes: 3 },
      { at: [22.8, 48.2], r: 5.6, depth: 2.6, lip: 1.25, stretch: 1.2, angle: 0.32, lobes: 3 },
    ],
    terrainProfile: {
      relativeFeet: [[0, 0], [0.2, 1.5], [0.42, 3], [0.62, 1], [0.8, 2.5], [1, 5]],
      landingPlateau: { t0: 0.3, t1: 0.56, maxCrossSlope: 0.03 },
      landingCrown: { t0: 0.2, t1: 0.7, edgeDropFt: 1.8 },
      approachShoulder: { t0: 0.72, t1: 0.94, side: 'right', heightFt: 1.8 },
    },
    path: {
      side: 'inward', arrivalPull: 1, fullOffsetFromT: 0.08,
      fullOffsetToT: 0.9, minFairwayEdgeClearYd: 10,
      // This branch leaves the south junction of the H5/H6 spine and reaches
      // the finishing tee below Millpond. It is deliberately separate from
      // H8's exit so the path network can join like real course infrastructure.
      accessBefore: [[84, 51], [86, 49], [80, 44], [65, 43]],
    },
    vegetation: corridorLandscape(
      ['oak_a', 'maple_a', 'oak_b'], ['oak_b', 'birch_a', 'pine_a'],
      { treeT0: 0.14, treeT1: 0.86, spacingYd: 33, openingClearYd: 34, approachClearYd: 30 },
    ),
    teeAmenities: { bench: true, washer: true, trash: true },
  },
];

const CLUBHOUSE = { type: 'clubhouse', x: 12, y: 38, w: 6, h: 5 };

// ---------------------------------------------------------------- helpers ----

function fbm(x, y) {
  const h = (xx, yy) => {
    const s = Math.sin(xx * 127.1 + yy * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  const vn = (xx, yy) => {
    const ix = Math.floor(xx);
    const iy = Math.floor(yy);
    const fx = xx - ix;
    const fy = yy - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    return (h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * ux) * (1 - uy)
      + (h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * ux) * uy;
  };
  return vn(x, y) * 0.62 + vn(x * 2.07 + 13.1, y * 2.07 - 7.7) * 0.26 + vn(x * 4.3 - 3.3, y * 4.3 + 9.9) * 0.12;
}

// point→segment squared distance + parameter (for path fairway-clearance)
function pathSegDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + dx * t);
  const ey = py - (ay + dy * t);
  return { d2: ex * ex + ey * ey, t };
}

// fairway half-width (cells) at arc parameter t from a width profile [{t,w(yd)}]
function fairHalfCells(stops, t) {
  if (!stops || !stops.length) return 2.4;
  if (t <= stops[0].t) return stops[0].w / CELL_YD;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      const a = stops[i - 1];
      const b = stops[i];
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      const s = k * k * (3 - 2 * k);
      return (a.w + (b.w - a.w) * s) / CELL_YD;
    }
  }
  return stops[stops.length - 1].w / CELL_YD;
}

// Copy authored metadata without sharing template references. Keeping this
// deterministic and data-only means optional presentation/shaping records can
// travel with a vector hole without advancing the course RNG.
function cloneAuthored(value) {
  if (Array.isArray(value)) return value.map(cloneAuthored);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = cloneAuthored(child);
    return out;
  }
  return value;
}

// ------------------------------------------------------------- the designer ----

export function designCourse(rng, opts = {}) {
  const jitterAmp = opts.jitter ?? 0.35;
  // feature levers let one builder span a quality range: a pristine parkland
  // nine (all features) down to a modest muni (few bunkers, no water, flat).
  const bunkerBudget = opts.bunkerBudget ?? Infinity; // cap total bunkers placed
  const includeWater = opts.water ?? true;
  const greenSizeMul = opts.greenSizeMul ?? 1;
  const moundMul = opts.moundMul ?? 1; // land movement scale
  let bunkersPlaced = 0;
  const course = makeCourse(GRID_W, GRID_H);
  const vec = emptyVec(1 + Math.floor(rng.next() * 100000));
  course.vec = vec;
  ensurePaint(course);

  const J = (amp = jitterAmp) => (rng.next() - 0.5) * 2 * amp;

  // ---- 1. authored holes → vectors
  const designed = [];
  for (let i = 0; i < TEMPLATE.length; i++) {
    const t = TEMPLATE[i];
    // jitter interior waypoints only — tees and greens anchor the routing
    const line = t.line.map(([x, y], k) => (
      k === 0 || k === t.line.length - 1
        ? { x: x + J(0.15), y: y + J(0.15) }
        : { x: x + J(0.8), y: y + J(0.8) }
    ));
    const first = line[0];
    const second = line[1];
    const last = line[line.length - 1];
    const prev = line[line.length - 2];
    const aimA = Math.atan2(second.y - first.y, second.x - first.x);
    const appA = Math.atan2(last.y - prev.y, last.x - prev.x);

    const vh = {
      id: vec.nextId++,
      name: t.name,
      par: t.par,
      hcp: t.hcp,
      roughW: t.roughW + J(2),
      line,
      width: t.par === 3 ? null : t.width.map(([tt, w]) => ({ t: tt, w: w + J(0.8) })),
      apron: t.par === 3 ? t.width.map(([tt, w]) => ({ t: tt, w })) : null,
      tees: [],
      green: null,
      bunkers: [],
      mowPhase: rng.next() * Math.PI * 2,
    };
    for (const key of ['path', 'vegetation', 'terrainProfile', 'camera']) {
      if (t[key]) vh[key] = cloneAuthored(t[key]);
    }

    // par-3 walk apron still renders as a slim fairway ribbon
    if (vh.apron) vh.width = vh.apron.map((s) => ({ t: s.t, w: s.w }));

    // tee complex: back / middle / forward marching down the line of play
    const lineSampled = sampleOpen(line, 0.4);
    const lenC = polyLength(lineSampled);
    const teeAt = (distC, tier, w, d, raise) => {
      const p = alongPoly(lineSampled, clamp(distC / lenC, 0, 0.3));
      const rot = Math.atan2(p.ty, p.tx);
      const tee = makeVecTee(p.x, p.y, rot, tier, w, d);
      tee.raise = raise;
      vh.tees.push(tee);
    };
    teeAt(0, 'back', 7.5 + J(0.5), 9.5 + J(0.5), 1.6);
    teeAt(2.2 + J(0.3), 'middle', 8, 10, 1.2);
    teeAt(4.6 + J(0.4), 'forward', 8, 9, 0.9);

    // green complex, oriented across the approach
    const gr = t.green.r * greenSizeMul + J(1.0);
    const randomizedGAngle = appA + Math.PI / 2 + J(0.3);
    const gAngle = Number.isFinite(t.green.angleOffset)
      ? appA + Math.PI / 2 + t.green.angleOffset
      : randomizedGAngle;
    const greenElong = t.green.elong + J(0.08);
    const green = makeVecGreen(
      last.x, last.y, gr, greenElong, gAngle, vec.seed + i * 13, t.green.outline,
    );
    green.raise = 1.5 + rng.next() * 0.7;
    const randomizedTiltA = appA + Math.PI + J(0.5);
    green.tiltA = Number.isFinite(t.green.tiltOffset)
      ? appA + Math.PI + t.green.tiltOffset
      : randomizedTiltA; // greens tilt back toward the approach
    green.tilt = 0.2 + rng.next() * 0.15;
    // Keep the same random draw sequence for every hole, then let a hero-hole
    // specification pin its final playable contour deterministically.
    if (Number.isFinite(t.green.raise)) green.raise = t.green.raise;
    if (Number.isFinite(t.green.tilt)) green.tilt = t.green.tilt;
    if (t.green.style) green.style = t.green.style;
    if (Array.isArray(t.green.contours)) {
      const ca = Math.cos(gAngle);
      const sa = Math.sin(gAngle);
      const rc = gr / CELL_YD;
      green.contours = t.green.contours.map((contour) => {
        const across = (Number(contour.across) || 0) * rc * greenElong;
        const front = (Number(contour.front) || 0) * rc;
        return {
          role: contour.role || null,
          x: last.x + across * ca - front * sa,
          y: last.y + across * sa + front * ca,
          r: Math.max(0.25, (Number(contour.radius) || 0.5) * rc),
          h: Number(contour.heightFt) || 0,
        };
      });
    }
    // pins A/B/C spread across the surface
    const gca = Math.cos(gAngle);
    const gsa = Math.sin(gAngle);
    const rc = (gr / CELL_YD);
    green.pins = [
      { x: last.x, y: last.y },
      { x: last.x + gca * rc * 0.5, y: last.y + gsa * rc * 0.5 },
      { x: last.x - gca * rc * 0.45 - gsa * rc * 0.3, y: last.y - gsa * rc * 0.45 + gca * rc * 0.3 },
    ];
    vh.green = green;

    for (let b = 0; b < t.bunkers.length; b++) {
      if (bunkersPlaced >= bunkerBudget) break; // low-quality courses carry fewer traps
      const spec = t.bunkers[b];
      // Preserve the historical J/J/J/lobes draw order so authored H1
      // silhouettes cannot reshuffle any downstream hole's seeded design.
      const bx = spec.at[0] + J(0.4);
      const by = spec.at[1] + J(0.4);
      const br = spec.r + J(0.8);
      const randomLobes = 2 + Math.floor(rng.next() * 3);
      const bunk = makeVecBunker(
        bx, by, br,
        vec.seed * 7 + i * 31 + b * 11,
        {
          depth: spec.depth,
          lobes: spec.lobes ?? randomLobes,
          stretch: spec.stretch || 1,
          angle: spec.angle || 0,
        },
      );
      if (Number.isFinite(spec.lip)) bunk.lip = spec.lip;
      vh.bunkers.push(bunk);
      bunkersPlaced++;
    }

    // Extra authored bunkers use only their fixed data and makeVecBunker's
    // deterministic hash. In particular: no J(), rng.next(), nextId, or
    // bunker-budget mutation here, so every H2-H9 random draw remains stable.
    for (let b = 0; b < (t.fixedBunkers || []).length; b++) {
      const spec = t.fixedBunkers[b];
      const bunker = makeVecBunker(
        spec.at[0], spec.at[1], spec.r,
        vec.seed * 7 + i * 31 + (t.bunkers.length + b) * 11,
        {
          depth: spec.depth,
          lobes: spec.lobes ?? 3,
          stretch: spec.stretch || 1,
          angle: spec.angle || 0,
        },
      );
      if (Number.isFinite(spec.lip)) bunker.lip = spec.lip;
      vh.bunkers.push(bunker);
    }

    if (t.pond && includeWater) {
      vec.waters.push({
        id: vec.nextId++,
        ...makeAuthoredPond(
          t.pond,
          t.pond.at[0] + J(0.5),
          t.pond.at[1] + J(0.3),
          vec.seed + 91 + i,
        ),
      });
    }
    if (t.teeKnoll) {
      vec.mounds.push({ id: vec.nextId++, x: first.x, y: first.y, r: 3.4, h: t.teeKnoll });
    }
    if (t.rollers && moundMul > 0.5) {
      for (let k = 0; k < 3; k++) {
        const p = alongPoly(lineSampled, 0.25 + k * 0.22);
        vec.mounds.push({
          id: vec.nextId++,
          x: p.x - p.ty * (2.6 + J(1)), y: p.y + p.tx * (2.6 + J(1)),
          r: 2.6 + rng.next() * 1.4, h: (1.6 + rng.next() * 1.2) * moundMul,
        });
      }
    }
    // backstop mounds framing every green complex
    if (moundMul > 0.35) {
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? 1 : -1;
        const mound = {
          id: vec.nextId++,
          x: last.x + Math.cos(appA) * 2.4 + Math.cos(appA + Math.PI / 2) * side * 1.7 + J(0.5),
          y: last.y + Math.sin(appA) * 2.4 + Math.sin(appA + Math.PI / 2) * side * 1.7 + J(0.5),
          r: 1.9 + rng.next() * 0.9, h: (1.4 + rng.next() * 1.1) * moundMul,
        };
        if (t.greenBackstops) {
          const authored = t.greenBackstops.mounds?.[k];
          if (authored) {
            const back = authored.backYd / CELL_YD;
            const across = authored.acrossYd / CELL_YD;
            mound.x = last.x + Math.cos(appA) * back + Math.cos(appA + Math.PI / 2) * across;
            mound.y = last.y + Math.sin(appA) * back + Math.sin(appA + Math.PI / 2) * across;
            mound.r = authored.radiusYd / CELL_YD;
            mound.h = authored.heightFt * moundMul;
            mound.role = authored.role || null;
          } else {
            mound.r = t.greenBackstops.radiusCells;
            mound.h = t.greenBackstops.heightFt * moundMul;
          }
        }
        vec.mounds.push(mound);
      }
    }

    vec.holes.push(vh);
    designed.push({ t, vh, lineSampled, lenC, aimA, appA });
  }

  // A small scenic basin behind the north-east routing transition. It stays
  // well outside both playable corridors and reads as property drainage.
  if (includeWater) {
    vec.waters.push({
      id: vec.nextId++,
      ...makeVecPond(110.2 + J(0.8), 18.8 + J(0.6), 14, 10, vec.seed + 777),
    });
  }

  // clubhouse landscaping beds + the practice putting lawn
  vec.beds.push({
    id: vec.nextId++,
    pts: [
      { x: CLUBHOUSE.x - 1.2, y: CLUBHOUSE.y - 1.4 }, { x: CLUBHOUSE.x + 3, y: CLUBHOUSE.y - 2.0 },
      { x: CLUBHOUSE.x + 6.5, y: CLUBHOUSE.y - 1.5 }, { x: CLUBHOUSE.x + 4, y: CLUBHOUSE.y - 0.6 },
      { x: CLUBHOUSE.x + 1, y: CLUBHOUSE.y - 0.5 },
    ],
  });
  vec.lawns = [{ x: CLUBHOUSE.x - 2.6, y: CLUBHOUSE.y + 3.4, rot: 0.3, w: 18, d: 14, tier: 'lawn' }];

  // ---- 2. base terrain: regional tilt + rolling fBm, graded under corridors
  const { w, h } = course;
  const elev = course.elevation;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tilt = ((x / w) * 0.62 + (1 - y / h) * 0.38 - 0.42) * (opts.elevAmp ?? 1) * 17;
      // Local roll carries the parkland character; the regional tilt above is
      // drainage and is left alone. At 9 ft the property read as a table from
      // every camera — about a 0.7% grade across 960 yards.
      const roll = (fbm(x * 0.052 + vec.seed * 0.13, y * 0.052) - 0.5) * 13
        + (fbm(x * 0.16 + 31, y * 0.16 - 17) - 0.5) * 3.4;
      elev[y * w + x] = tilt + roll;
    }
  }
  // corridor grading: pull land toward the smoothed centerline height so
  // fairways roll along the line of play instead of leaning across it
  const target = new Float32Array(w * h);
  const weight = new Float32Array(w * h);
  for (const d of designed) {
    const n = Math.ceil(d.lenC / 0.5);
    const lineH = [];
    for (let i = 0; i <= n; i++) {
      const p = alongPoly(d.lineSampled, i / n);
      const cx = clamp(Math.round(p.x), 0, w - 1);
      const cy = clamp(Math.round(p.y), 0, h - 1);
      lineH.push(elev[cy * w + cx]);
    }
    // moving average → the long-profile the hole plays over
    const sm = lineH.map((_, i) => {
      let s = 0, c = 0;
      for (let k = -6; k <= 6; k++) {
        const j = i + k;
        if (j < 0 || j >= lineH.length) continue;
        s += lineH[j];
        c++;
      }
      return s / c;
    });
    for (let i = 0; i <= n; i++) {
      const p = alongPoly(d.lineSampled, i / n);
      const R = 4.2;
      for (let yy = Math.floor(p.y - R); yy <= Math.ceil(p.y + R); yy++) {
        for (let xx = Math.floor(p.x - R); xx <= Math.ceil(p.x + R); xx++) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const dd = Math.hypot(xx + 0.5 - p.x, yy + 0.5 - p.y);
          if (dd > R) continue;
          const k = (1 - dd / R);
          const o = yy * w + xx;
          target[o] += sm[i] * k;
          weight[o] += k;
        }
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (weight[i] > 0) {
      const t = target[i] / weight[i];
      elev[i] += (t - elev[i]) * 0.6;
    }
  }
  // Authored longitudinal profiles sit on top of the generic rolling base.
  // They give every hole a readable journey, playable landing shelves, and
  // restrained approach shoulders without consuming generator RNG.
  applyAuthoredTerrainProfiles(course);
  // clubhouse pad sits dead level
  {
    const cx = CLUBHOUSE.x + CLUBHOUSE.w / 2;
    const cy = CLUBHOUSE.y + CLUBHOUSE.h / 2;
    const padH = elev[Math.round(cy) * w + Math.round(cx)];
    for (let y = CLUBHOUSE.y - 2; y < CLUBHOUSE.y + CLUBHOUSE.h + 3; y++) {
      for (let x = CLUBHOUSE.x - 2; x < CLUBHOUSE.x + CLUBHOUSE.w + 3; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const dd = Math.max(Math.abs(x + 0.5 - cx) - CLUBHOUSE.w / 2, Math.abs(y + 0.5 - cy) - CLUBHOUSE.h / 2);
        const k = clamp(1 - dd / 3, 0, 1);
        const o = y * w + x;
        elev[o] += (padH - elev[o]) * k;
      }
    }
  }

  // ---- 3. structures + cart-path network
  course.structures.push({ ...CLUBHOUSE });

  const pathPts = [];
  const splitStarts = [0];
  const pushTo = (points, x, y, minDistance = 2.4) => {
    const p = { x, y };
    if (!points.length || Math.hypot(p.x - points[points.length - 1].x, p.y - points[points.length - 1].y) > minDistance) {
      points.push(p);
    }
    return points.length - 1;
  };
  const push = (x, y) => pushTo(pathPts, x, y);
  const appendHolePath = (points, d, holeIndex) => {
    const n = 12;
    // Choose the property-facing side once for the whole hole. Re-evaluating
    // this sign at every control point lets a dogleg (or a return hole crossing
    // the property centreline) flip the path through its own fairway.
    const sideAnchor = alongPoly(d.lineSampled, 0.5);
    const sideNx = -sideAnchor.ty;
    const sideNy = sideAnchor.tx;
    const outwardSide = (sideAnchor.x - 60) * sideNx + (sideAnchor.y - 40) * sideNy >= 0 ? 1 : -1;
    let start = -1;
    let end = -1;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = alongPoly(d.lineSampled, t);
      // Pick the corridor-perpendicular side requested by the authored hole.
      // "outward" remains relative to the property centre; explicit left/right
      // options are useful where routing folds back through the interior.
      const nx = -p.ty;
      const ny = p.tx;
      const outward = outwardSide;
      const fwHalf = d.vh.width ? fairHalfCells(d.vh.width, t) : 3;
      const authoredPath = d.vh.path;
      let pathSide = outward;
      if (authoredPath?.side === 'inward') pathSide = -outward;
      else if (authoredPath?.side === 'left') pathSide = 1;
      else if (authoredPath?.side === 'right') pathSide = -1;
      const edgeClear = authoredPath?.minFairwayEdgeClearYd != null
        ? authoredPath.minFairwayEdgeClearYd / CELL_YD
        : (d.vh.roughW / CELL_YD) * 0.5 + 0.8;
      const off = pathSide * (fwHalf + edgeClear + Math.sin(t * 3.6 + holeIndex) * 0.22);
      const fromT = authoredPath?.fullOffsetFromT ?? 0.06;
      const toT = authoredPath?.fullOffsetToT ?? 0.94;
      const arrivalPull = authoredPath?.arrivalPull ?? 0.4;
      let pull = 1;
      if (t < fromT) pull = arrivalPull + (1 - arrivalPull) * (t / Math.max(0.001, fromT));
      else if (t > toT) pull = 1 - (1 - arrivalPull) * ((t - toT) / Math.max(0.001, 1 - toT));
      const retained = pushTo(points, p.x + nx * off * pull, p.y + ny * off * pull);
      if (start < 0) start = retained;
      end = retained;
    }
    return { start, end };
  };
  // start at the clubhouse cart staging
  push(CLUBHOUSE.x + CLUBHOUSE.w + 0.8, CLUBHOUSE.y + CLUBHOUSE.h - 0.6);
  // The opening hole's path belongs on its woodland edge, but the staging bay
  // sits on the opposite side of the tee. Route the connector around the back
  // of the clubhouse and outside the tee complex before it joins H1; a direct
  // chord here used to cut straight across the player's opening view.
  push(CLUBHOUSE.x + CLUBHOUSE.w + 2.8, CLUBHOUSE.y + CLUBHOUSE.h + 3.0);
  push(CLUBHOUSE.x + CLUBHOUSE.w - 1.0, CLUBHOUSE.y + CLUBHOUSE.h + 4.0);
  push(CLUBHOUSE.x - 1.0, CLUBHOUSE.y + CLUBHOUSE.h + 4.0);
  push(CLUBHOUSE.x - 3.5, CLUBHOUSE.y + CLUBHOUSE.h + 0.5);
  push(CLUBHOUSE.x - 3.5, TEMPLATE[0].line[0][1] + 1.5);
  push(CLUBHOUSE.x, TEMPLATE[0].line[0][1] - 3.5);
  push(TEMPLATE[0].line[0][0] - 4.5, TEMPLATE[0].line[0][1] - 5.0);
  let southJunction = -1;
  let northJunction = -1;
  let h6PathStart = -1;
  let h8Exit = -1;
  // H1-H8 form the main circulation graph. H9 is appended later as a branch
  // from the H5/H6 spine, preventing a sequential spline from lapping the east
  // boundary and crossing the H6 target view.
  for (let i = 0; i < designed.length - 1; i++) {
    const d = designed[i];
    const range = appendHolePath(pathPts, d, i);
    // These are renderer spline boundaries, not disconnected path ends: slices
    // overlap one control point so the paved network remains physically joined.
    if (i === 5 || i === 6) splitStarts.push(range.start);
    if (i === 5) h6PathStart = range.start;
    // Long green-to-tee transfers are authored as circulation, not inferred as
    // a direct Catmull-Rom chord through unrelated playing corridors.
    let transitionStarted = false;
    const transition = d.vh.path?.transitionAfter || [];
    for (let k = 0; k < transition.length; k++) {
      const point = transition[k];
      const retained = pushTo(pathPts, point[0], point[1], 0.45);
      // These authored transfer controls are deliberately dense around adjacent
      // green/tee complexes. Preserve them through the generic relaxation pass;
      // otherwise the clearance solver can flip a safe junction through the
      // neighboring target it was meant to skirt.
      if (i >= 4 && i <= 6) pathPts[retained].pathLocked = true;
      if (!transitionStarted) {
        transitionStarted = true;
        if (i === 6) splitStarts.push(retained);
      }
      if (i === 4 && k === 0) southJunction = retained;
      if (i === 4 && k === transition.length - 1) northJunction = retained;
      if (i === 7 && k === transition.length - 1) h8Exit = retained;
    }
  }
  // clearance pass: shove any point that still sits on a fairway off it (the
  // connectors between interior holes are the usual offenders). Smoothing runs
  // FIRST (to relax the initial pushes) then the clearance has the LAST word so
  // nothing is pulled back onto a fairway. Margin covers CatmullRom overshoot.
  const clearFairways = (points, margin) => {
    for (let iter = 0; iter < 14; iter++) {
      let moved = false;
      for (let pi = 1; pi < points.length - 1; pi++) { // pin network junctions/endpoints
        const p = points[pi];
        if (p.pathLocked) continue;
        let worst = 0;
        let pushX = 0;
        let pushY = 0;
        for (const d of designed) {
          if (!d.vh.width) continue;
          const line = d.lineSampled;
          let bestD2 = Infinity;
          let cxp = 0;
          let cyp = 0;
          let bestT = 0;
          for (let i = 1; i < line.length; i++) {
            const r = pathSegDist2(p.x, p.y, line[i - 1].x, line[i - 1].y, line[i].x, line[i].y);
            if (r.d2 < bestD2) {
              bestD2 = r.d2;
              cxp = line[i - 1].x + (line[i].x - line[i - 1].x) * r.t;
              cyp = line[i - 1].y + (line[i].y - line[i - 1].y) * r.t;
              bestT = (i - 1 + r.t) / (line.length - 1);
            }
          }
          const half = fairHalfCells(d.vh.width, bestT);
          const intr = half + margin - Math.sqrt(bestD2);
          if (intr > worst) {
            worst = intr;
            const dx = p.x - cxp;
            const dy = p.y - cyp;
            const L = Math.hypot(dx, dy) || 1;
            pushX = dx / L;
            pushY = dy / L;
          }
        }
        if (worst > 0.05) {
          p.x += pushX * (worst + 0.4);
          p.y += pushY * (worst + 0.4);
          moved = true;
        }
      }
      if (!moved) break;
    }
  };
  const finishPath = (points) => {
    clearFairways(points, 1.6);
    // Relax kinks the pushes may have left (endpoints pinned).
    for (let s = 0; s < 2; s++) {
      for (let i = 1; i < points.length - 1; i++) {
        if (points[i].pathLocked) continue;
        points[i].x = (points[i - 1].x + points[i].x * 2 + points[i + 1].x) / 4;
        points[i].y = (points[i - 1].y + points[i].y * 2 + points[i + 1].y) / 4;
      }
    }
    clearFairways(points, 2.4); // wider final margin absorbs Catmull-Rom overshoot
    for (const point of points) {
      point.x = clamp(point.x, 2, w - 3);
      point.y = clamp(point.y, 2, h - 3);
    }
  };
  finishPath(pathPts);

  // Snap H8's branch to the already-cleared north junction. Both occurrences
  // become endpoints after slicing, so the three-way join is exact and stable.
  if (northJunction >= 0) {
    if (h6PathStart >= 0) {
      pathPts[h6PathStart].x = pathPts[northJunction].x;
      pathPts[h6PathStart].y = pathPts[northJunction].y;
    }
    if (h8Exit >= 0) {
      pathPts[h8Exit].x = pathPts[northJunction].x;
      pathPts[h8Exit].y = pathPts[northJunction].y;
    }
  }

  const homePathPts = [];
  const h9 = designed[8];
  if (southJunction >= 0) pushTo(homePathPts, pathPts[southJunction].x, pathPts[southJunction].y);
  const access = h9.vh.path?.accessBefore || [];
  // access[0] names the shared junction; use its cleared coordinate above.
  for (let i = southJunction >= 0 ? 1 : 0; i < access.length; i++) {
    const retained = pushTo(homePathPts, access[i][0], access[i][1], 0.45);
    homePathPts[retained].pathLocked = true;
  }
  appendHolePath(homePathPts, h9, 8);
  // The stable H9 side now finishes north of its green, already beside the
  // clubhouse. A short staging connection is cleaner than the old ornamental
  // loop, which doubled back through its own ribbon.
  pushTo(homePathPts, pathPts[0].x, pathPts[0].y, 0.2);
  finishPath(homePathPts);
  // Close the network on the exact staging control rather than leaving a
  // sub-cell seam that becomes visible from the clubhouse camera.
  homePathPts[homePathPts.length - 1].x = pathPts[0].x;
  homePathPts[homePathPts.length - 1].y = pathPts[0].y;

  splitStarts.push(southJunction, northJunction, pathPts.length - 1);
  const cuts = [...new Set(splitStarts.filter((index) => index >= 0))].sort((a, b) => a - b);
  const addPath = (points) => {
    const compact = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const previous = compact[compact.length - 1];
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5) {
        // Preserve the network endpoint if the final relaxed control collapsed
        // onto its predecessor; otherwise discard the redundant near-duplicate.
        if (i === points.length - 1) compact[compact.length - 1] = point;
        continue;
      }
      compact.push(point);
    }
    if (compact.length < 2) return;
    course.paths.push({
      id: course.nextPathId++,
      pts: compact.map((p) => ({ x: p.x, y: p.y })),
      width: 2.7, // eight-foot paved ribbon, matching a real single-lane cart path
      material: 'asphalt',
    });
  };
  for (let i = 0; i < cuts.length - 1; i++) {
    // Share the cut control at both ends: no gaps, while each renderer spline
    // gets a local tangent and cannot weave through an unrelated branch.
    addPath(pathPts.slice(cuts[i], cuts[i + 1] + 1));
  }
  addPath(homePathPts);

  // ---- 4. back-compat hole records (golfers, sections, saves, editor) —
  // BEFORE deriveZones so the tee/pin anchors get stamped into the grid
  for (let i = 0; i < designed.length; i++) {
    const d = designed[i];
    const hole = addHole(course);
    const back = d.vh.tees[0];
    hole.tee = { x: Math.round(back.x), y: Math.round(back.y) };
    hole.pin = { x: Math.round(d.vh.green.pins[0].x), y: Math.round(d.vh.green.pins[0].y) };
    hole.wp = d.vh.line.slice(1, -1).map((p) => ({ x: p.x, y: p.y }));
    hole.status = HOLE_STATUS.OPEN;
    hole.everOpen = true;
    hole.name = d.vh.name;
    hole.handicap = d.vh.hcp;
    hole.parOverride = d.vh.par;
    hole.vecId = d.vh.id;
    hole.tees = {
      back: { x: Math.round(d.vh.tees[0].x), y: Math.round(d.vh.tees[0].y) },
      middle: { x: Math.round(d.vh.tees[1].x), y: Math.round(d.vh.tees[1].y) },
      forward: { x: Math.round(d.vh.tees[2].x), y: Math.round(d.vh.tees[2].y) },
    };
    hole.activeTee = 'back';
    hole.pins = {
      A: { x: Math.round(d.vh.green.pins[0].x), y: Math.round(d.vh.green.pins[0].y) },
      B: { x: Math.round(d.vh.green.pins[1].x), y: Math.round(d.vh.green.pins[1].y) },
      C: { x: Math.round(d.vh.green.pins[2].x), y: Math.round(d.vh.green.pins[2].y) },
    };
    hole.activePin = 'A';
  }

  // ---- 5. zones from the vectors
  invalidateGeom(course);
  deriveZones(course);

  // ---- 6. planting + props
  plantProperty(course, designed, rng);

  return course;
}

// ------------------------------------------------------------- vegetation ----

const IN_PLAY = new Set([
  ZONE.ROUGH, ZONE.FAIRWAY, ZONE.GREEN, ZONE.TEE, ZONE.BUNKER,
  ZONE.WATER, ZONE.PATH, ZONE.FRINGE, ZONE.SEMI, ZONE.BED,
]);

function playDistance(course, cap = 8) {
  const { w, h, zones } = course;
  const dist = new Int8Array(w * h).fill(cap);
  const queue = [];
  for (let i = 0; i < w * h; i++) {
    if (IN_PLAY.has(zones[i])) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const d = dist[i];
    if (d >= cap) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] > d + 1) {
        dist[ni] = d + 1;
        queue.push(ni);
      }
    }
  }
  return dist;
}

// A real parkland belt reads in groups of recognizable silhouettes. Filler
// crowns remain useful connective tissue, but no longer make up nearly half of
// every stand; oak, maple, birch, and evergreen groups now carry the skyline.
const FOREST_MIX = [
  ['fill_a', 0.13], ['fill_b', 0.11], ['oak_b', 0.17], ['oak_a', 0.11],
  ['maple_a', 0.12], ['pine_a', 0.11], ['pine_b', 0.07], ['spruce_a', 0.06],
  ['birch_a', 0.07], ['cedar_a', 0.03], ['shade_a', 0.02],
];

const TALL_PLANT_TYPES = new Set([
  'fill_a', 'fill_b', 'oak_a', 'oak_b', 'maple_a', 'birch_a', 'shade_a', 'flower_a',
  'pine_a', 'pine_b', 'spruce_a', 'cedar_a',
]);

function pickSpecies(rng, mix) {
  let r = rng.next();
  for (const [id, p] of mix) {
    r -= p;
    if (r <= 0) return id;
  }
  return mix[0][0];
}

function structureClear(course, x, y, pad = 2.5) {
  for (const s of course.structures) {
    if (x >= s.x - pad && x <= s.x + s.w + pad && y >= s.y - pad && y <= s.y + s.h + pad + 1.5) return false;
  }
  return true;
}

function addObj(course, type, x, y, rot, scale) {
  if (!inBounds(course, Math.round(x), Math.round(y))) return null;
  const o = { id: course.nextObjectId++, type, x, y, rot, scale };
  course.objects.push(o);
  return o;
}

function authoredObjectClear(course, x, y, minClearYd) {
  const minCells = Math.max(0, minClearYd) / CELL_YD;
  const d2 = minCells * minCells;
  for (const object of course.objects) {
    const dx = object.x - x;
    const dy = object.y - y;
    if (dx * dx + dy * dy < d2) return false;
  }
  return true;
}

// Millpond's open fairway bank is part of the shot picture, so its accent
// planting belongs on the broad back shore rather than around the whole water
// line. Fixed sockets append after procedural planting: they neither spend RNG
// nor renumber any existing authored object.
function dressMillpondShore(course) {
  const pond = course.vec?.waters?.find((water) => water.role === 'millpond-approach');
  if (!pond?.pts?.length) return;
  let cx = 0;
  let cy = 0;
  for (const point of pond.pts) {
    cx += point.x;
    cy += point.y;
  }
  cx /= pond.pts.length;
  cy /= pond.pts.length;
  const accents = [
    { index: 2, type: 'reed_clump', offset: 0.14, scale: 1.18 },
    { index: 3, type: 'shore_rock', offset: 0.24, scale: 0.92 },
    { index: 4, type: 'reed_clump', offset: 0.16, scale: 1.32 },
    { index: 5, type: 'grass_clump', offset: 0.25, scale: 1.08 },
    { index: 6, type: 'reed_clump', offset: 0.14, scale: 1.22 },
    { index: 7, type: 'shore_rock', offset: 0.26, scale: 1.04 },
    { index: 8, type: 'reed_clump', offset: 0.15, scale: 1.16 },
    { index: 9, type: 'grass_clump', offset: 0.24, scale: 1.02 },
  ];
  for (let i = 0; i < accents.length; i++) {
    const accent = accents[i];
    const point = pond.pts[accent.index % pond.pts.length];
    const dx = point.x - cx;
    const dy = point.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    const object = addObj(
      course,
      accent.type,
      point.x + dx / length * accent.offset,
      point.y + dy / length * accent.offset,
      (i * 2.399963229728653) % (Math.PI * 2),
      accent.scale,
    );
    if (object) object.role = 'millpond-shore';
  }
}

// Project route-relative planting sockets after the seeded property scatter has
// completed. This is deliberately RNG-free: strengthening the hero corridor can
// never perturb the routing, hazards, IDs, or random character of Holes 2-9.
function plantAuthoredCorridors(course, designed, waterClear, tallAllowed) {
  for (let holeIndex = 0; holeIndex < designed.length; holeIndex++) {
    const design = designed[holeIndex];
    const specs = design.vh.vegetation?.plantings;
    if (!Array.isArray(specs)) continue;
    const routeYd = design.lenC * CELL_YD;
    for (let specIndex = 0; specIndex < specs.length; specIndex++) {
      const spec = specs[specIndex];
      const types = Array.isArray(spec.types) ? spec.types.filter(Boolean) : [];
      if (!types.length || routeYd <= 0) continue;
      const t0 = clamp(Number(spec.t0) || 0, 0, 1);
      const t1 = clamp(Number(spec.t1) || 0, t0, 1);
      const spacingYd = Math.max(6, Number(spec.spacingYd) || 24);
      const count = Math.max(1, Math.ceil(routeYd * (t1 - t0) / spacingYd));
      const side = spec.side === 'left' ? 1 : -1;
      const scaleRange = Array.isArray(spec.scale) && spec.scale.length >= 2
        ? spec.scale : [0.92, 1.32];

      for (let k = 0; k < count; k++) {
        const key = course.vec.seed * 0.001 + holeIndex * 17.1 + specIndex * 3.7 + k * 0.83;
        const alongNoise = fbm(key + 11.3, k * 0.71 + 5.2);
        const lateralNoise = fbm(key - 8.7, k * 0.53 - 2.1);
        const typeNoise = fbm(key + 31.9, k * 1.17 + 0.4);
        const scaleNoise = fbm(key - 19.4, k * 0.91 + 8.3);
        const binT = t0 + (t1 - t0) * ((k + 0.5) / count);
        const alongJitterT = ((alongNoise - 0.5) * spacingYd * 0.34) / routeYd;
        const t = clamp(binT + alongJitterT, t0, t1);
        const p = alongPoly(design.lineSampled, t);
        const fairHalfYd = fairHalfCells(design.vh.width, t) * CELL_YD;
        const lateralJitterYd = (lateralNoise - 0.5) * 2 * Math.max(0, Number(spec.lateralJitterYd) || 0);
        const offsetCells = (fairHalfYd + Math.max(0, Number(spec.beyondFairwayYd) || 0) + lateralJitterYd) / CELL_YD;
        const x = p.x - p.ty * side * offsetCells;
        const y = p.y + p.tx * side * offsetCells;
        const type = types[Math.min(types.length - 1, Math.floor(typeNoise * types.length))];
        const tall = TALL_PLANT_TYPES.has(type);
        const minClearYd = Math.max(0, Number(spec.minClearYd) || (tall ? 7 : 3));
        if (!plantable(course, x, y, waterClear)) continue;
        if (tall && !tallAllowed(x, y)) continue;
        if (!authoredObjectClear(course, x, y, minClearYd)) continue;
        const scale = scaleRange[0] + (scaleRange[1] - scaleRange[0]) * scaleNoise;
        const rot = fbm(key + 71.2, k * 0.37 - 6.4) * Math.PI * 2;
        addObj(course, type, x, y, rot, scale);
      }
    }
  }
}

function plantable(course, x, y, waterClear = null) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  // A six-yard bunker or narrow first cut can sit entirely between centers of
  // the eight-yard gameplay grid. Planting against that coarse lookup put
  // shrubs and rocks inside authored sand. Vector courses have exact surface
  // truth available; use it for placement while legacy grids retain getZone.
  const z = course.vec
    ? evaluateSurface(course, getGeom(course), x, y, course.paint || null).zone
    : getZone(course, cx, cy);
  if (z !== ZONE.OUT && z !== ZONE.HEAVY && z !== ZONE.ROUGH) return false;
  if (!structureClear(course, x, y)) return false;
  // keep tall canopy off the shoreline so ponds reflect sky, not dark trees
  if (waterClear && waterClear[cy * course.w + cx]) return false;
  return true;
}

// cells within `r` of any water cell — trees stay out so shorelines stay open
function waterClearField(course, r = 2) {
  const { w, h, zones } = course;
  const field = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (zones[y * w + x] !== ZONE.WATER) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) field[ny * w + nx] = 1;
        }
      }
    }
  }
  return field;
}

function plantProperty(course, designed, rng) {
  const { w, h } = course;
  const dist = playDistance(course, 8);
  const waterClear = waterClearField(course, 2);
  const tallExclusions = compileVegetationExclusions(course);
  const tallAllowed = (x, y) => tallVegetationAllowed(tallExclusions, x, y);

  // regional species character: pine belts vs broadleaf, from low-freq noise
  const beltNoise = (x, y) => fbm(x * 0.045 + 71.3, y * 0.045 - 23.7);

  // 1. deep forest — the property IS a forest with golf carved out of it
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const d = dist[y * w + x];
      if (d < 3) continue;
      const clearing = fbm(x * 0.075 + 7.7, y * 0.075 + 3.3);
      if (clearing < 0.34 && d < 6) continue;         // meadows near play, never deep voids
      const dens = d >= 5 ? 0.5 : d >= 4 ? 0.4 : 0.28;
      if (rng.next() > dens) continue;
      const px = x + (rng.next() - 0.5) * 0.9;
      const py = y + (rng.next() - 0.5) * 0.9;
      if (!plantable(course, px, py, waterClear)) continue;
      const belt = beltNoise(x, y);
      let type;
      if (belt > 0.62) type = pickSpecies(rng, [['pine_a', 0.42], ['pine_b', 0.28], ['spruce_a', 0.2], ['fill_a', 0.1]]);
      else if (belt < 0.3 && fbm(x * 0.2, y * 0.2) > 0.55) type = pickSpecies(rng, [['birch_a', 0.6], ['fill_b', 0.4]]);
      else type = pickSpecies(rng, FOREST_MIX);
      const rot = rng.next() * Math.PI * 2;
      const scale = 0.85 + rng.next() * 0.5;
      if (!tallAllowed(px, py)) continue;
      addObj(course, type, px, py, rot, scale);
    }
  }

  // 2. corridor walls — tree lines separating holes, with runs and gaps
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const d = dist[y * w + x];
      if (d < 1 || d > 2) continue;
      const gate = Math.sin(x * 0.52 + y * 0.29) + Math.sin(x * 0.16 - y * 0.41);
      if (gate < 0.42 || rng.next() > 0.48) continue;
      const px = x + (rng.next() - 0.5) * 0.8;
      const py = y + (rng.next() - 0.5) * 0.8;
      if (!plantable(course, px, py, waterClear)) continue;
      const belt = beltNoise(x, y);
      const type = belt > 0.62
        ? pickSpecies(rng, [['pine_a', 0.5], ['pine_b', 0.3], ['spruce_a', 0.2]])
        : pickSpecies(rng, [['oak_b', 0.3], ['fill_a', 0.3], ['maple_a', 0.2], ['oak_a', 0.2]]);
      const rot = rng.next() * Math.PI * 2;
      const scale = 0.9 + rng.next() * 0.45;
      if (!tallAllowed(px, py)) continue;
      addObj(course, type, px, py, rot, scale);
    }
  }

  // 3. specimen trees defending dogleg corners
  for (const d of designed) {
    const wps = d.vh.line.slice(1, -1);
    for (const wp of wps) {
      if (rng.next() > 0.75) continue;
      const a = rng.next() * Math.PI * 2;
      const r = 3.2 + rng.next() * 1.2;
      const px = wp.x + Math.cos(a) * r;
      const py = wp.y + Math.sin(a) * r;
      if (!plantable(course, px, py, waterClear)) continue;
      const type = rng.next() < 0.6 ? 'oak_a' : 'shade_a';
      const rot = rng.next() * Math.PI * 2;
      const scale = 1.25 + rng.next() * 0.3;
      if (!tallAllowed(px, py)) continue;
      addObj(course, type, px, py, rot, scale);
    }
  }

  // 4. green-complex framing: a stand behind every green
  for (const d of designed) {
    const g = d.vh.green;
    const back = d.appA;
    for (let k = 0; k < 3; k++) {
      const a = back + (rng.next() - 0.5) * 1.5;
      const r = 3.0 + rng.next() * 1.8;
      const px = g.cx + Math.cos(a) * r;
      const py = g.cy + Math.sin(a) * r;
      if (!plantable(course, px, py, waterClear)) continue;
      const type = pickSpecies(rng, [['oak_a', 0.3], ['maple_a', 0.3], ['pine_a', 0.2], ['oak_b', 0.2]]);
      const rot = rng.next() * Math.PI * 2;
      const scale = 1.05 + rng.next() * 0.35;
      if (!tallAllowed(px, py)) continue;
      addObj(course, type, px, py, rot, scale);
    }
  }

  // 5. clubhouse landscaping: a restrained arrival garden — two ornamentals
  // flanking the entrance, then mostly leafy shrubs (flowering trees are a
  // seasonal accent, not the headline)
  const ch = course.structures[0];
  for (const x of [ch.x - 0.5, ch.x + ch.w + 0.5]) {
    const y = ch.y - 1.8;
    const rot = rng.next() * Math.PI * 2;
    const scale = 0.9 + rng.next() * 0.2;
    if (tallAllowed(x, y)) addObj(course, 'flower_a', x, y, rot, scale);
  }
  for (let k = 0; k < 3; k++) {
    const px = ch.x - 1 + rng.next() * (ch.w + 2);
    const py = ch.y - 2.2 + rng.next() * 1.0;
    addObj(course, 'shrub_flower', px, py, rng.next() * Math.PI * 2, 0.85 + rng.next() * 0.25);
  }
  for (let k = 0; k < 8; k++) {
    const a = rng.next() * Math.PI * 2;
    addObj(course, 'shrub_round', ch.x + ch.w / 2 + Math.cos(a) * (4.2 + rng.next() * 1.5),
      ch.y + ch.h / 2 + Math.sin(a) * (3.6 + rng.next() * 1.2), rng.next() * Math.PI * 2, 0.85 + rng.next() * 0.35);
  }

  // 6. water dressing: reeds, shoreline rocks, native bushes
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (getZone(course, x, y) === ZONE.WATER) continue;
      let shore = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        if (getZone(course, x + dx, y + dy) === ZONE.WATER) { shore = true; break; }
      }
      if (!shore) continue;
      if (rng.next() < 0.5) {
        addObj(course, 'reed_clump', x + (rng.next() - 0.5) * 0.7, y + (rng.next() - 0.5) * 0.7,
          rng.next() * Math.PI * 2, 0.9 + rng.next() * 0.5);
      }
      if (rng.next() < 0.2) {
        addObj(course, 'shore_rock', x + (rng.next() - 0.5) * 0.8, y + (rng.next() - 0.5) * 0.8,
          rng.next() * Math.PI * 2, 0.8 + rng.next() * 0.7);
      }
      if (rng.next() < 0.12 && plantable(course, x, y)) {
        addObj(course, 'bush_native', x, y, rng.next() * Math.PI * 2, 0.9 + rng.next() * 0.4);
      }
    }
  }

  // 7. native texture in the heavy band: bushes, grass clumps, the odd boulder
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (getZone(course, x, y) !== ZONE.HEAVY) continue;
      const r = rng.next();
      if (r < 0.04) addObj(course, 'bush_native', x + J2(rng), y + J2(rng), rng.next() * 6.28, 0.85 + rng.next() * 0.5);
      else if (r < 0.12) addObj(course, 'grass_clump', x + J2(rng), y + J2(rng), rng.next() * 6.28, 0.9 + rng.next() * 0.6);
      else if (r < 0.124) addObj(course, 'boulder_a', x + J2(rng), y + J2(rng), rng.next() * 6.28, 0.7 + rng.next() * 0.6);
    }
  }

  // 8. golf furniture: tee signs, markers, benches, washers, yardage plates
  for (let i = 0; i < designed.length; i++) {
    const d = designed[i];
    const tees = d.vh.tees;
    const back = tees[0];
    const ca = Math.cos(back.rot);
    const sa = Math.sin(back.rot);
    const teeSide = (lateralYd, alongYd) => ({
      x: back.x - sa * (lateralYd / CELL_YD) + ca * (alongYd / CELL_YD),
      y: back.y + ca * (lateralYd / CELL_YD) + sa * (alongYd / CELL_YD),
    });
    // tee sign beside the back tee, facing the walk-on
    const amenities = d.t.teeAmenities || {};
    const sign = teeSide(amenities.signLateralYd ?? 4.2, amenities.signAlongYd ?? -1.4);
    addObj(course, 'tee_sign', sign.x, sign.y, back.rot + Math.PI / 2, 1);
    const markerFor = { back: 'tee_marker_blue', middle: 'tee_marker_gold', forward: 'tee_marker_red' };
    for (const tee of tees) {
      const mw = (tee.w / CELL_YD) * 0.36;
      const mca = Math.cos(tee.rot);
      const msa = Math.sin(tee.rot);
      addObj(course, markerFor[tee.tier] || 'tee_marker_gold', tee.x - msa * mw, tee.y + mca * mw, tee.rot, 1);
      addObj(course, markerFor[tee.tier] || 'tee_marker_gold', tee.x + msa * mw, tee.y - mca * mw, tee.rot, 1);
    }
    const hasBench = rng.next() < 0.6;
    const hasWasher = rng.next() < 0.5;
    const hasTrash = rng.next() < 0.4;
    const bench = teeSide(amenities.benchLateralYd ?? 6.4, amenities.benchAlongYd ?? -2.2);
    const washer = teeSide(5.4, -3.1);
    const trash = teeSide(7.4, -3.6);
    if (amenities.bench ?? (i === 0 || hasBench)) addObj(course, 'bench_course', bench.x, bench.y, back.rot + Math.PI, 1);
    if (amenities.washer ?? (i === 0 || hasWasher)) addObj(course, 'ball_washer', washer.x, washer.y, 0, 1);
    if (amenities.trash ?? (i === 0 || hasTrash)) addObj(course, 'trash_course', trash.x, trash.y, 0, 1);
    // 150-yd plate up the fairway
    if (d.vh.par >= 4) {
      const remain = 150 / CELL_YD;
      const t150 = clamp(1 - remain / d.lenC, 0.1, 0.95);
      const p = alongPoly(d.lineSampled, t150);
      addObj(course, 'yardage_marker', p.x - p.ty * 2.0, p.y + p.tx * 2.0, 0, 1);
    }
    // a rake resting beside some bunkers
    for (const b of d.vh.bunkers) {
      if (rng.next() > 0.45) continue;
      const p0 = b.pts[0];
      addObj(course, 'rake_prop', p0.x, p0.y, rng.next() * Math.PI * 2, 1);
    }
  }

  plantAuthoredCorridors(course, designed, waterClear, tallAllowed);
  dressMillpondShore(course);
}

function J2(rng) {
  return (rng.next() - 0.5) * 0.8;
}
