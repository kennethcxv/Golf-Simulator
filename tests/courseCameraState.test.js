import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COURSE_CAMERA_VIEW_OPTIONS,
  FLYOVER_CAMERA_VIEW,
  normalizeCourseCameraView,
  beginCourseCameraFlyover,
  advanceCourseCameraFlyover,
  courseCameraFlyoverLabel,
} from '../src/ui/courseCameraState.js';

test('camera view options expose every normal preset but not transient flyover state', () => {
  assert.deepEqual(COURSE_CAMERA_VIEW_OPTIONS.map(([value]) => value), [
    'frame-hole',
    'tee',
    'fairway',
    'approach',
    'green',
    'ground-preview',
    'course-overview',
  ]);
  assert.equal(COURSE_CAMERA_VIEW_OPTIONS.some(([value]) => value === FLYOVER_CAMERA_VIEW), false);
  assert.equal(normalizeCourseCameraView('green'), 'green');
  assert.equal(normalizeCourseCameraView('flyover'), 'frame-hole');
});

test('flyover captures the exact preset to restore, including overview', () => {
  const hole = { id: 'h1' };
  const greenFlight = beginCourseCameraFlyover(hole, 'green');
  const overviewFlight = beginCourseCameraFlyover(hole, 'course-overview');

  assert.equal(greenFlight.hole, hole);
  assert.equal(greenFlight.restoreView, 'green');
  assert.equal(overviewFlight.restoreView, 'course-overview');
  assert.equal(beginCourseCameraFlyover(hole, 'flyover').restoreView, 'frame-hole');
});

test('flyover progress is duration based, clamped, and reported in five-percent buckets', () => {
  const original = beginCourseCameraFlyover({ id: 'h2' }, 'tee');
  const early = advanceCourseCameraFlyover(original, 0.2);
  const quarter = advanceCourseCameraFlyover(original, 1.875);
  const complete = advanceCourseCameraFlyover(quarter, 99);

  assert.equal(original.t, 0, 'advancing does not mutate the captured restore state');
  assert.ok(early.t > 0 && early.t < 0.05);
  assert.equal(early.statusPercent, 0);
  assert.equal(quarter.t, 0.25);
  assert.equal(quarter.statusPercent, 25);
  assert.equal(courseCameraFlyoverLabel(quarter), 'Flyover · 25%');
  assert.equal(complete.t, 1);
  assert.equal(complete.statusPercent, 100);
  assert.equal(courseCameraFlyoverLabel(complete), 'Flyover · 100%');
  assert.equal(complete.restoreView, 'tee');
});

