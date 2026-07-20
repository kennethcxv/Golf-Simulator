import assert from 'node:assert/strict';
import test from 'node:test';

import {
  snapCoursePoint,
  objectCollisionRadiusYd,
  objectCollisionOk,
} from '../src/sim/courseEditorObjectPlacement.js';

test('course object snapping uses real-yard increments and supports an explicit off mode', () => {
  assert.deepEqual(snapCoursePoint(4.08, 8.06), { x: 4.125, y: 8 });
  assert.deepEqual(
    snapCoursePoint(4.08, 8.06, { incrementYd: 2 }),
    { x: 4, y: 8 },
  );
  assert.deepEqual(
    snapCoursePoint(4.19, 8.06, { enabled: false }),
    { x: 4.19, y: 8.06 },
  );
  assert.equal(snapCoursePoint(Number.NaN, 3), null);
  assert.equal(snapCoursePoint(3, 4, { incrementYd: 0 }), null);
});

test('stable collision radii distinguish trees, shrubs, rocks, and props', () => {
  assert.equal(objectCollisionRadiusYd('tree_oak'), 2.4);
  assert.equal(objectCollisionRadiusYd('oak_a'), 6.3);
  assert.equal(objectCollisionRadiusYd('acacia_a'), 7.4);
  assert.equal(objectCollisionRadiusYd('cypress_a'), 1.8);
  assert.equal(objectCollisionRadiusYd('flower_bed_a'), 1);
  assert.equal(objectCollisionRadiusYd('tree_pineDefaultA'), 2.4);
  assert.equal(objectCollisionRadiusYd('bush_round'), 1.6);
  assert.equal(objectCollisionRadiusYd('rock_s'), 1);
  assert.equal(objectCollisionRadiusYd('rock_l'), 2.5);
  assert.ok(Math.abs(objectCollisionRadiusYd('bench', 1.5) - 3.45) < 1e-9);
  assert.equal(objectCollisionRadiusYd('trash_bin'), 1.1);
  assert.equal(objectCollisionRadiusYd('distance_marker'), 0.7);
  assert.equal(objectCollisionRadiusYd('', 1), null);
});

test('object collision validation covers bounds, objects, structures, and ignored selection', () => {
  const course = {
    w: 40,
    h: 30,
    objects: [
      { id: 7, type: 'oak_a', x: 10, y: 10, scale: 1 },
      { id: 8, type: 'rock_s', x: 18, y: 16, scale: 1 },
    ],
    structures: [{ x: 24, y: 8, w: 5, h: 6 }],
  };

  assert.deepEqual(objectCollisionOk(course, 'bench', 14, 12), { ok: true, reason: null });
  assert.equal(objectCollisionOk(course, 'bench', -0.5, 5).reason, 'Object must fit inside the course.');
  const collision = objectCollisionOk(course, 'bush_round', 10.3, 10.1);
  assert.equal(collision.ok, false);
  assert.equal(collision.reason, 'Too close to another object.');
  assert.equal(collision.collidesWith, 7);
  assert.deepEqual(
    objectCollisionOk(course, 'oak_a', 10, 10, { ignoreId: 7 }),
    { ok: true, reason: null },
  );
  assert.equal(objectCollisionOk(course, 'rock_m', 24.1, 10).reason, 'Object overlaps a structure.');
});
