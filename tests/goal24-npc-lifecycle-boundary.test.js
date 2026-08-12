import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { emitGoal24NpcLifecycleBoundary } from '../src/render3d/clubhouse.js';

const clubhouseSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const recorderSource = fs.readFileSync(
  new URL('../tools/qa/lib/goal24-interaction-recorder.mjs', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

test('the Goal 24 NPC observer is optional, synchronous, and behavior-isolated', () => {
  const original = globalThis.__goal24NpcLifecycleBoundary;
  try {
    delete globalThis.__goal24NpcLifecycleBoundary;
    assert.equal(emitGoal24NpcLifecycleBoundary({ lifecycleId: 'absent' }), false);

    const ordering = [];
    const boundary = Object.freeze({ lifecycleId: 'organic-footfall:1', atMs: 42 });
    globalThis.__goal24NpcLifecycleBoundary = (observed) => {
      ordering.push('observer');
      assert.equal(observed, boundary, 'the production boundary identity reaches the observer intact');
    };
    ordering.push('before');
    assert.equal(emitGoal24NpcLifecycleBoundary(boundary), true);
    ordering.push('after');
    assert.deepEqual(ordering, ['before', 'observer', 'after'], 'the observer runs in the spawning call stack');

    globalThis.__goal24NpcLifecycleBoundary = () => {
      throw new Error('QA observer failure');
    };
    assert.doesNotThrow(() => emitGoal24NpcLifecycleBoundary(boundary));
    assert.equal(emitGoal24NpcLifecycleBoundary(boundary), false,
      'an instrumentation failure cannot prevent a production customer spawn');
  } finally {
    if (original === undefined) delete globalThis.__goal24NpcLifecycleBoundary;
    else globalThis.__goal24NpcLifecycleBoundary = original;
  }
});

test('the organic footfall edge emits immediately before creation and binds the first route', () => {
  assert.match(
    clubhouseSource,
    /eventType: 'organic-customer-lifecycle-window-start',[\s\S]*?emitGoal24NpcLifecycleBoundary\(lifecycleBoundary\);\s*spawnCustomer\(false, null, \{\s*allowWalkInRequest: true,\s*spawnSource: 'organic-footfall',\s*lifecycleBoundary,\s*\}\);/,
    'the synchronous observer must be the last operation before the production organic spawn call',
  );
  assert.match(
    clubhouseSource,
    /lifecycleBoundaryId: options\.lifecycleBoundary\?\.lifecycleId \?\? null,[\s\S]*?createdAtMs: performance\.now\(\)/,
    'the created customer must carry the lifecycle boundary that preceded its construction',
  );
  assert.match(
    clubhouseSource,
    /c\.routeDiagnostics = \{[\s\S]*?spawnSource: c\.spawnSource,\s*lifecycleBoundaryId: c\.lifecycleBoundaryId,\s*lifecycleBoundaryAtMs: c\.lifecycleBoundaryAtMs,/,
    'the production nav result must remain bound to the same lifecycle boundary',
  );
});

test('shipping navigation exposes monotonic create/rebuild timing without a reset or drive hook', () => {
  assert.match(
    clubhouseSource,
    /const navCreateStartedAtMs = performance\.now\(\);\s*const nav = makeNav\([\s\S]*?const navCreatedAtMs = performance\.now\(\);\s*const navCreateDurationMs = navCreatedAtMs - navCreateStartedAtMs;/,
    'base-grid construction must be measured around the actual shipping makeNav call',
  );
  assert.match(
    clubhouseSource,
    /function navFresh\(\) \{\s*navFreshCallCount \+= 1;[\s\S]*?const rebuildStartedAtMs = performance\.now\(\);\s*nav\.rebuild\([\s\S]*?navRebuildCount \+= 1;/,
    'first/static-collider rebuild counts must surround the actual shipping nav.rebuild call',
  );
  assert.match(clubhouseSource, /function navPerformanceDiagnostics\(\) \{\s*return Object\.freeze\(\{/);
  assert.match(clubhouseSource, /navPerformanceDiagnostics,/,
    'the runtime clubhouse API must expose the snapshot-only diagnostic');
  assert.doesNotMatch(clubhouseSource, /(?:reset|set)NavPerformanceDiagnostics/,
    'the diagnostic cannot reset or drive shipping navigation');
});

test('a lifecycle boundary inside a shipping render excludes that pre-boundary frame', () => {
  assert.match(
    recorderSource,
    /const measurementGeneration = active\?\.measurementGeneration \?\? null;[\s\S]*?active\.measurementGeneration === measurementGeneration/,
    'the render wrapper must only seal evidence from the same measurement generation it entered',
  );
  assert.match(
    recorderSource,
    /active\.renderStarts = 0;\s*active\.renderFrameEvidence\.length = 0;\s*active\.measurementGeneration \+= 1;/,
    'restarting at the synchronous NPC edge must invalidate an already in-flight pre-boundary render',
  );
});
