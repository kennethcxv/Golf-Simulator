import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCourseEditorPreviewGeometry,
  COURSE_EDITOR_PREVIEW_COLORS,
} from '../src/render3d/courseEditorPreviewGeometry.js';
import { makeVecGreen, makeVecBunker, makeVecPond } from '../src/sim/courseVec.js';
import { CELL_YD } from '../src/sim/constants.js';

const approx = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`);
};

const bounds = (points) => ({
  minX: Math.min(...points.map((point) => point.x)),
  maxX: Math.max(...points.map((point) => point.x)),
  minZ: Math.min(...points.map((point) => point.z)),
  maxZ: Math.max(...points.map((point) => point.z)),
});

const assertRendererReady = (preview) => {
  assert.equal(preview.outline.closed, true);
  assert.ok(preview.outline.points.length >= 4);
  assert.deepEqual(preview.fill.points, preview.outline.points);
  for (const point of preview.outline.points) {
    assert.equal(Number.isFinite(point.x), true);
    assert.equal(Number.isFinite(point.z), true);
  }
};

test('tee preview is a rotated world-space rectangle with a forward aim guide', () => {
  const preview = buildCourseEditorPreviewGeometry({
    feature: 'tee',
    hoverWorld: { x: 10, z: 20 },
    hoverCell: { x: 4.5, y: 7.25 },
    widthYd: 4,
    lengthYd: 8,
    rotationDeg: 90,
    aimWorld: { x: 10, z: 40 },
    valid: true,
  });

  assertRendererReady(preview);
  assert.equal(preview.shape, 'rectangle');
  assert.deepEqual(preview.center.cell, { x: 4.5, y: 7.25 });
  assert.equal(preview.outline.points.length, 4);
  const rectangleBounds = bounds(preview.outline.points);
  approx(rectangleBounds.minX, 8);
  approx(rectangleBounds.maxX, 12);
  approx(rectangleBounds.minZ, 16);
  approx(rectangleBounds.maxZ, 24);
  assert.equal(preview.guides.length, 1);
  assert.equal(preview.guides[0].kind, 'aim');
  approx(preview.guides[0].points[0].x, 10);
  approx(preview.guides[0].points[0].z, 24);
  assert.deepEqual(preview.guides[0].points[1], { x: 10, z: 40 });
  assert.equal(preview.validity.color, COURSE_EDITOR_PREVIEW_COLORS.valid);
});

test('round, oval, and kidney greens expose distinct deterministic silhouettes', () => {
  const common = {
    feature: 'green', hoverWorld: { x: 0, z: 0 }, hoverCell: { x: 12, y: 9 }, sizeYd: 20,
  };
  const round = buildCourseEditorPreviewGeometry({ ...common, shape: 'round' });
  const oval = buildCourseEditorPreviewGeometry({ ...common, shape: 'oval' });
  const kidney = buildCourseEditorPreviewGeometry({ ...common, shape: 'kidney' });

  [round, oval, kidney].forEach(assertRendererReady);
  assert.equal(round.outline.points.length, 32);
  assert.equal(oval.outline.points.length, 32);
  assert.equal(kidney.outline.points.length, 12);
  approx(bounds(round.outline.points).maxX, 10.2);
  approx(bounds(round.outline.points).maxZ, 10);
  approx(bounds(oval.outline.points).maxX, 13.5);
  approx(bounds(oval.outline.points).maxZ, 10);
  assert.notDeepEqual(kidney.outline.points, oval.outline.points);
  assert.ok(round.guides.length >= 6, 'green placement exposes a clipped contour grid');
  assert.ok(round.guides.every((guide) => guide.kind === 'contour-grid' && guide.points.length === 2));
  assert.equal(
    buildCourseEditorPreviewGeometry({ ...common, shape: 'round', contourGrid: false }).guides.length,
    0,
  );
  assert.deepEqual(
    kidney,
    buildCourseEditorPreviewGeometry({ ...common, shape: 'kidney' }),
    'the silhouette is independent of mutable vector ids and random state',
  );
});

test('green rotation uses the same X/Z convention as authored course vectors', () => {
  const preview = buildCourseEditorPreviewGeometry({
    feature: 'green',
    hoverWorld: { x: 5, z: -3 },
    sizeYd: 20,
    shape: 'oval',
    rotationDeg: 90,
  });
  const rotated = bounds(preview.outline.points);
  approx(rotated.minX, -5);
  approx(rotated.maxX, 15);
  approx(rotated.minZ, -16.5);
  approx(rotated.maxZ, 10.5);
});

test('bunker silhouettes retain round, oval, and concave kidney identities', () => {
  const common = { feature: 'bunker', hoverWorld: { x: 30, z: 40 }, sizeYd: 10 };
  const round = buildCourseEditorPreviewGeometry({ ...common, shape: 'round' });
  const oval = buildCourseEditorPreviewGeometry({ ...common, shape: 'oval' });
  const kidney = buildCourseEditorPreviewGeometry({
    ...common,
    shape: 'kidney',
    valid: false,
    invalidReason: 'Bunkers require open turf.',
  });

  [round, oval, kidney].forEach(assertRendererReady);
  approx(bounds(round.outline.points).maxX, 35);
  approx(bounds(oval.outline.points).maxX, 37.25);
  assert.equal(kidney.outline.points.length, 12);
  assert.notDeepEqual(kidney.outline.points, round.outline.points);
  assert.equal(kidney.validity.valid, false);
  assert.equal(kidney.validity.color, COURSE_EDITOR_PREVIEW_COLORS.invalid);
  assert.equal(kidney.validity.reason, 'Bunkers require open turf.');
});

test('pond and lake previews provide stable organic shoreline polygons', () => {
  const common = {
    feature: 'water', hoverWorld: { x: -20, z: 12 }, hoverCell: { x: 8, y: 14 }, sizeYd: 20,
  };
  const pond = buildCourseEditorPreviewGeometry({ ...common, shape: 'pond', rotationRad: 0.2 });
  const lake = buildCourseEditorPreviewGeometry({ ...common, shape: 'lake', rotationRad: 0.2 });

  assertRendererReady(pond);
  assertRendererReady(lake);
  assert.equal(pond.outline.points.length, 16);
  assert.equal(lake.outline.points.length, 20);
  assert.ok(lake.dimensions.radiusX > pond.dimensions.radiusX);
  assert.ok(lake.dimensions.radiusZ > pond.dimensions.radiusZ);
  assert.deepEqual(pond, buildCourseEditorPreviewGeometry({ ...common, shape: 'pond', rotationRad: 0.2 }));
  assert.deepEqual(lake, buildCourseEditorPreviewGeometry({ ...common, shape: 'lake', rotationRad: 0.2 }));
});

test('preview builder rejects ambiguous or unsupported geometry inputs', () => {
  assert.throws(
    () => buildCourseEditorPreviewGeometry({ feature: 'stream', hoverWorld: { x: 0, z: 0 } }),
    /Unsupported editor preview feature/,
  );
  assert.throws(
    () => buildCourseEditorPreviewGeometry({
      feature: 'green', hoverWorld: { x: 0, z: 0 }, shape: 'triangle', sizeYd: 20,
    }),
    /Unsupported green shape/,
  );
  assert.throws(
    () => buildCourseEditorPreviewGeometry({
      feature: 'green', hoverWorld: { x: 0, z: 0 }, sizeYd: 0,
    }),
    /greater than zero/,
  );
  assert.throws(
    () => buildCourseEditorPreviewGeometry({
      feature: 'tee', hoverWorld: { x: 0, z: 0 }, rotationRad: 0, rotationDeg: 0,
    }),
    /not both/,
  );
});

test('seeded previews match the exact vector outlines committed by editor stamps', () => {
  const cx = 14.25;
  const cy = 22.5;
  const seed = 417;
  const rotationRad = 0.63;
  const toWorld = (points) => points.map((point) => ({
    x: (point.x - cx) * CELL_YD,
    z: (point.y - cy) * CELL_YD,
  }));
  const assertPoints = (actual, expected) => {
    assert.equal(actual.length, expected.length);
    for (let index = 0; index < actual.length; index += 1) {
      approx(actual[index].x, expected[index].x);
      approx(actual[index].z, expected[index].z);
    }
  };

  const green = buildCourseEditorPreviewGeometry({
    feature: 'green', shape: 'oval', sizeYd: 30, seed, rotationRad,
    hoverWorld: { x: 0, z: 0 }, hoverCell: { x: cx, y: cy },
  });
  assertPoints(
    green.outline.points,
    toWorld(makeVecGreen(cx, cy, 15, 1.35, rotationRad, seed).pts),
  );

  const bunker = buildCourseEditorPreviewGeometry({
    feature: 'bunker', shape: 'kidney', sizeYd: 14, seed, rotationRad,
    hoverWorld: { x: 0, z: 0 }, hoverCell: { x: cx, y: cy },
  });
  assertPoints(
    bunker.outline.points,
    toWorld(makeVecBunker(cx, cy, 7, seed, {
      lobes: 3, stretch: 1.12, angle: rotationRad,
    }).pts),
  );

  const pond = buildCourseEditorPreviewGeometry({
    feature: 'water', shape: 'pond', sizeYd: 36, seed, rotationRad,
    hoverWorld: { x: 0, z: 0 }, hoverCell: { x: cx, y: cy },
  });
  assertPoints(
    pond.outline.points,
    toWorld(makeVecPond(cx, cy, 20.7, 18, seed, 'pond', rotationRad).pts),
  );
});
