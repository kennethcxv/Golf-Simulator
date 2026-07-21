import assert from 'node:assert/strict';
import test from 'node:test';

import { createCourseWaterReflectionGuard } from '../src/render3d/courseWaterReflectionGuard.js';

test('course waters cannot recursively invoke one another reflection callbacks', () => {
  const guard = createCourseWaterReflectionGuard();
  const calls = [];
  const waterA = {
    onBeforeRender() {
      calls.push('A');
      waterB.onBeforeRender();
    },
  };
  const waterB = {
    onBeforeRender() {
      calls.push('B');
      waterA.onBeforeRender();
    },
  };

  guard(waterA);
  guard(waterB);

  waterA.onBeforeRender();
  waterB.onBeforeRender();

  assert.deepEqual(calls, ['A', 'B']);
});

test('each course water refreshes at most once per display frame', () => {
  const guard = createCourseWaterReflectionGuard();
  let waterACalls = 0;
  let waterBCalls = 0;
  const waterA = guard({
    onBeforeRender() {
      waterACalls += 1;
    },
  });
  const waterB = guard({
    onBeforeRender() {
      waterBCalls += 1;
    },
  });

  guard.beginFrame();
  waterA.onBeforeRender(); // main RenderPass
  waterB.onBeforeRender();
  waterA.onBeforeRender(); // GTAO traversal
  waterB.onBeforeRender();

  assert.deepEqual([waterACalls, waterBCalls], [1, 1]);

  guard.beginFrame();
  waterA.onBeforeRender();
  waterB.onBeforeRender();

  assert.deepEqual([waterACalls, waterBCalls], [2, 2]);
});

test('course water reflection guard resets after a failed reflection render', () => {
  const guard = createCourseWaterReflectionGuard();
  const failure = new Error('reflection failed');
  const brokenWater = guard({
    onBeforeRender() {
      throw failure;
    },
  });
  let healthyCalls = 0;
  const healthyWater = guard({
    onBeforeRender() {
      healthyCalls += 1;
    },
  });

  assert.throws(() => brokenWater.onBeforeRender(), failure);
  healthyWater.onBeforeRender();

  assert.equal(healthyCalls, 1);
});
