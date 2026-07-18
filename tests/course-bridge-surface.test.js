import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCourseBridgeSurfaceIndex,
  COURSE_BRIDGE_SURFACE_DEFAULTS,
  isCourseBridgeSurfaceAt,
  queryCourseBridgeSurface,
  resolveCourseBridgeSurfaceSettings,
  sampleCourseElevationYd,
} from '../src/sim/courseBridgeSurface.js';
import { buildCourseBridgeGeometry } from '../src/render3d/courseBridgeGeometry.js';
import { CELL_YD, ZONE } from '../src/sim/constants.js';

function courseWith(paths, elevationFt = 0) {
  return {
    w: 24,
    h: 24,
    elevation: Float32Array.from({ length: 24 * 24 }, () => elevationFt),
    paths,
  };
}

function approx(actual, expected, epsilon = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`);
}

test('boolean bridge metadata indexes a full path without mutating authoring data', () => {
  const course = courseWith([{
    id: 7,
    pts: [{ x: 2, y: 6 }, { x: 12, y: 6 }],
    width: 4,
    bridge: true,
  }], 3);
  const before = structuredClone(course.paths);
  const first = buildCourseBridgeSurfaceIndex(course);
  const second = buildCourseBridgeSurfaceIndex(course);

  assert.deepEqual(first, second, 'sampling and arclength are deterministic');
  assert.deepEqual(course.paths, before, 'the persisted path is read-only');
  assert.equal(first.surfaces.length, 1);
  const hit = queryCourseBridgeSurface(first, 7, 6);
  assert.equal(hit.onBridge, true);
  assert.equal(hit.zone, ZONE.PATH);
  assert.equal(hit.pathId, 7);
  approx(hit.pathT, 0.5, 0.002);
  // An 80-yard span receives the renderer's 0.4-yard midpoint camber.
  approx(hit.deckHeightFt, 3 + COURSE_BRIDGE_SURFACE_DEFAULTS.deckHeightFt + 1.2, 0.002);
  assert.equal(queryCourseBridgeSurface(first, 7, 7), null, 'one cell is eight yards and outside a four-yard deck');
});

test('object metadata defaults enable a bridge, while enabled false disables it', () => {
  assert.deepEqual(resolveCourseBridgeSurfaceSettings({}), {
    ...COURSE_BRIDGE_SURFACE_DEFAULTS,
    enabled: true,
    deckClearanceYd: COURSE_BRIDGE_SURFACE_DEFAULTS.deckHeightFt / 3,
  });
  assert.equal(resolveCourseBridgeSurfaceSettings({ enabled: false }), null);
  const index = buildCourseBridgeSurfaceIndex(courseWith([
    { id: 1, pts: [{ x: 1, y: 2 }, { x: 9, y: 2 }], width: 3, bridge: {} },
    { id: 2, pts: [{ x: 1, y: 4 }, { x: 9, y: 4 }], width: 3, bridge: { enabled: false } },
  ]));
  assert.equal(index.surfaces.length, 1);
  assert.equal(queryCourseBridgeSurface(index, 5, 2).pathId, 1);
  assert.equal(queryCourseBridgeSurface(index, 5, 4), null);
});

test('partial bridge interval uses deterministic path arclength and square end caps', () => {
  const index = buildCourseBridgeSurfaceIndex(courseWith([{
    id: 11,
    pts: [{ x: 2, y: 10 }, { x: 12, y: 10 }],
    width: 3.2,
    bridge: { enabled: true, startT: 0.25, endT: 0.75 },
  }]));

  assert.equal(queryCourseBridgeSurface(index, 4.49, 10), null);
  const start = queryCourseBridgeSurface(index, 4.5, 10);
  const middle = queryCourseBridgeSurface(index, 7, 10);
  const end = queryCourseBridgeSurface(index, 9.5, 10);
  assert.ok(start && middle && end);
  approx(start.pathT, 0.25, 0.002);
  approx(middle.pathT, 0.5, 0.002);
  approx(middle.bridgeT, 0.5, 0.002);
  approx(end.pathT, 0.75, 0.002);
  assert.equal(queryCourseBridgeSurface(index, 9.51, 10), null);
});

test('width is measured in yards at fractional course coordinates', () => {
  const index = buildCourseBridgeSurfaceIndex(courseWith([{
    id: 14,
    pts: [{ x: 2, y: 3 }, { x: 14, y: 3 }],
    width: 4,
    bridge: true,
  }]));
  const onEdge = queryCourseBridgeSurface(index, 8, 3.25); // 0.25 cell = 2 yd
  assert.ok(onEdge);
  approx(onEdge.distanceFromCenterYd, 2);
  approx(Math.abs(onEdge.lateralYd), 2);
  assert.equal(isCourseBridgeSurfaceAt(index, 8, 3.2501), false);
});

test('deck height is bank-to-bank and minimum clearance raises it over intervening terrain', () => {
  const waterIndex = buildCourseBridgeSurfaceIndex(courseWith([{
    id: 20,
    pts: [{ x: 2, y: 8 }, { x: 12, y: 8 }],
    width: 3,
    bridge: { deckHeightFt: 2, clearanceFt: 1 },
  }]), {
    terrainHeightYdAt: (x) => (x < 3 || x > 11 ? 4 : -2),
  });
  const waterMiddle = queryCourseBridgeSurface(waterIndex, 7, 8);
  approx(waterMiddle.deckHeightYd, 4 + 2 / 3 + 0.4, 0.0003);
  approx(waterMiddle.deckHeightFt, 15.2, 0.001);
  approx(waterMiddle.terrainHeightYd, -2);
  approx(waterMiddle.clearanceYd, 6 + 2 / 3 + 0.4, 0.0003);
  assert.equal(waterMiddle.configuredDeckHeightFt, 2);
  assert.equal(waterMiddle.configuredClearanceFt, 1);
  assert.equal(waterMiddle.requiredClearanceFt, 2);

  const humpIndex = buildCourseBridgeSurfaceIndex(courseWith([{
    id: 21,
    pts: [{ x: 2, y: 12 }, { x: 12, y: 12 }],
    width: 3,
    bridge: { deckHeightFt: 1, clearanceFt: 6 },
  }]), {
    terrainHeightYdAt: (x) => (x > 6.8 && x < 7.2 ? 5 : 0),
    sampleSpacingYd: 0.25,
  });
  const hump = queryCourseBridgeSurface(humpIndex, 7, 12);
  assert.ok(hump);
  approx(hump.camberYd, 0.45);
  approx(hump.deckHeightYd, 2.45, 1e-5);
  approx(hump.minimumClearanceYd, -2.55, 1e-5);
  const approach = queryCourseBridgeSurface(humpIndex, 2, 12);
  approx(approach.deckHeightYd, 2);
  assert.ok(approach.clearanceFt > hump.minimumClearanceFt);
});

test('surface stations and deck heights match renderer geometry exactly', () => {
  const path = {
    id: 25,
    pts: [{ x: 2, y: 4 }, { x: 8, y: 8 }, { x: 15, y: 5 }, { x: 20, y: 9 }],
    width: 3.4,
    bridge: {
      startT: 0.17,
      endT: 0.81,
      deckHeightFt: 1.5,
      clearanceFt: 0.9,
    },
  };
  const terrain = (x, y) => 0.03 * x - 0.02 * y + Math.sin(x * 0.4) * 0.08;
  const index = buildCourseBridgeSurfaceIndex(courseWith([path]), {
    terrainHeightYdAt: terrain,
  });
  const surface = index.surfaces[0];
  const geometry = buildCourseBridgeGeometry(path, {
    pointToWorld: (point) => ({ x: point.x * CELL_YD, z: point.y * CELL_YD }),
    heightAt: (x, z) => terrain(x / CELL_YD, z / CELL_YD),
  });

  assert.equal(surface.stations.length, geometry.deck.stationCount);
  approx(surface.bridgeLengthYd, geometry.lengthYd, 1e-7);
  approx(surface.camberYd, geometry.camberYd, 1e-7);
  for (let index2 = 0; index2 < surface.stations.length; index2 += 1) {
    const station = surface.stations[index2];
    approx(station.x * CELL_YD, geometry.centerline[index2 * 3], 2e-5);
    approx(station.y * CELL_YD, geometry.centerline[index2 * 3 + 2], 2e-5);
    approx(station.deckHeightYd, geometry.centerline[index2 * 3 + 1], 2e-5);
  }
});

test('fallback elevation sampling respects integer cell centres and feet-to-yard conversion', () => {
  const course = courseWith([], 9);
  approx(sampleCourseElevationYd(course, 4, 7), 3);
  approx(sampleCourseElevationYd(course, 4.35, 7.8), 3);
  assert.ok(Number.isNaN(sampleCourseElevationYd(null, 0, 0)));
});

test('invalid and legacy paths fail closed without throwing or producing phantom decks', () => {
  const paths = [
    { id: 1, pts: [{ x: 1, y: 1 }, { x: 8, y: 1 }], width: 3 }, // no bridge metadata
    { id: 2, pts: [{ x: 1, y: 2 }], width: 3, bridge: true },
    { id: 3, pts: [{ x: 1, y: 3 }, { x: Number.NaN, y: 3 }], width: 3, bridge: true },
    { id: 4, pts: [{ x: 1, y: 4 }, { x: 8, y: 4 }], width: -1, bridge: true },
    { id: 5, pts: [{ x: 1, y: 5 }, { x: 8, y: 5 }], width: 3, bridge: { startT: 0.8, endT: 0.2 } },
    { id: 6, pts: [{ x: 1, y: 6 }, { x: 8, y: 6 }], bridge: true }, // missing renderer width
    { id: 7, pts: [{ x: 1, y: 7 }, { x: 8, y: 7 }], width: '3', bridge: true },
    { id: 8, pts: [{ x: 1, y: 8 }, { x: 1e9, y: 8 }], width: 3, bridge: true },
    { id: 9, pts: [{ x: 1, y: 9 }, { x: 8, y: 9 }], width: 3, bridge: { startT: '0.2' } },
  ];
  const index = buildCourseBridgeSurfaceIndex(courseWith(paths));
  assert.deepEqual(index.surfaces.map((surface) => surface.pathId), []);
  assert.equal(queryCourseBridgeSurface(index, 4, 6), null,
    'missing width cannot create an invisible walkable bridge');
  assert.equal(queryCourseBridgeSurface(index, Number.NaN, 6), null);
  assert.equal(queryCourseBridgeSurface(null, 4, 6), null);

  const badTerrain = buildCourseBridgeSurfaceIndex(courseWith([{
    id: 10,
    pts: [{ x: 1, y: 10 }, { x: 8, y: 10 }],
    width: 3,
    bridge: true,
  }]), { terrainHeightYdAt: () => Number.NaN });
  assert.equal(badTerrain.surfaces.length, 0);
});
