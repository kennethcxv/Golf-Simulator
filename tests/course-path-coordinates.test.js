import assert from 'node:assert/strict';
import test from 'node:test';

import { createCoursePathCoordinateTransform } from '../src/sim/coursePathCoordinates.js';
import { CELL_YD } from '../src/sim/constants.js';

const dimensions = { worldW: 20 * CELL_YD, worldH: 12 * CELL_YD };

test('vector path points map directly from the continuous course plane', () => {
  const transform = createCoursePathCoordinateTransform({ vec: { v: 1 } }, dimensions);

  assert.equal(transform.continuousPlane, true);
  assert.equal(transform.worldX(0), -dimensions.worldW / 2);
  assert.equal(transform.worldZ(0), -dimensions.worldH / 2);
  assert.equal(transform.worldX(4.5), -44);
  assert.equal(transform.worldZ(5.25), -6);
});

test('legacy grid path points retain their historical cell-centre mapping', () => {
  const transform = createCoursePathCoordinateTransform({}, dimensions);

  assert.equal(transform.continuousPlane, false);
  assert.equal(transform.worldX(0), -dimensions.worldW / 2 + CELL_YD / 2);
  assert.equal(transform.worldZ(0), -dimensions.worldH / 2 + CELL_YD / 2);
  assert.equal(transform.worldX(4.5), -40);
  assert.equal(transform.worldZ(5.25), -2);
});

test('renderer world mapping and bridge-query inverse agree in both path spaces', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 3.125, y: 6.875 },
    { x: 19, y: 11 },
  ];

  for (const course of [{ vec: { v: 1 } }, {}]) {
    const transform = createCoursePathCoordinateTransform(course, dimensions);
    for (const point of points) {
      const rendered = { x: transform.worldX(point.x), z: transform.worldZ(point.y) };
      assert.equal(transform.courseX(rendered.x), point.x);
      assert.equal(transform.courseY(rendered.z), point.y);
    }
  }
});
