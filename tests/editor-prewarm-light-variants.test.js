import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CLUBHOUSE_INTERIOR_DRAW_DISTANCE,
  clubhouseInteriorVisibleAt,
} from '../src/render3d/clubhouse.js';

const courseSceneSource = fs.readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);
const clubhouseSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
);

test('clubhouse render visibility keeps the exact strict 80-yard threshold', () => {
  assert.equal(CLUBHOUSE_INTERIOR_DRAW_DISTANCE, 80);
  assert.equal(clubhouseInteriorVisibleAt(0, 0, 0, 0), true);
  assert.equal(clubhouseInteriorVisibleAt(79.999999, 0, 0, 0), true);
  assert.equal(clubhouseInteriorVisibleAt(80, 0, 0, 0), false);
  assert.equal(clubhouseInteriorVisibleAt(48, 64, 0, 0), false);
  assert.equal(clubhouseInteriorVisibleAt(3, 4, 0, 0, 5.000001), true);
});

test('the live visibility poll and prewarm share one render-only sync helper', () => {
  const helperStart = clubhouseSource.indexOf('function syncCameraVisibility()');
  const updateStart = clubhouseSource.indexOf('function update(dtMs)');
  const updateEnd = clubhouseSource.indexOf('// --- boot', updateStart);
  const updateSource = clubhouseSource.slice(updateStart, updateEnd);
  const publicApi = clubhouseSource.slice(clubhouseSource.indexOf('return {', updateEnd));

  assert.notEqual(helperStart, -1);
  assert.match(updateSource, /if \(visClock > 0\.5\)[\s\S]*syncCameraVisibility\(\);/);
  assert.doesNotMatch(updateSource, /Math\.hypot\(camera\.position/,
    'the live poll does not maintain a second visibility calculation');
  assert.match(publicApi, /update, syncCameraVisibility,/);
});

test('editor prewarm draws the persisted editor light variant and restores walk state', () => {
  const prewarmStart = courseSceneSource.indexOf('async function prewarm(onStep)');
  const prewarmEnd = courseSceneSource.indexOf('\n  return {', prewarmStart);
  const source = courseSceneSource.slice(prewarmStart, prewarmEnd);
  const editorStart = source.indexOf('const persistedEditor = state.uiPrefs?.courseEditor || {};');
  const setFov = source.indexOf('camera.fov = 46;', editorStart);
  const frameCamera = source.indexOf('if (editorView === COURSE_CAMERA_MODES.COURSE_OVERVIEW)', editorStart);
  const forceFlora = source.indexOf('floraLodUpdate?.(true);', frameCamera);
  const syncVisibility = source.indexOf('clubhouseApi?.syncCameraVisibility?.();', forceFlora);
  const editorDraw = source.indexOf('try { composer.render(); }', syncVisibility);
  const restoreInterior = source.indexOf(
    'clubhouseApi.interior.visible = savedView.clubhouseInteriorVisible;',
    editorDraw,
  );
  const restoreFlora = source.indexOf('floraLodUpdate?.(true);', restoreInterior);

  for (const [label, index] of Object.entries({
    editorStart, setFov, frameCamera, forceFlora, syncVisibility,
    editorDraw, restoreInterior, restoreFlora,
  })) assert.notEqual(index, -1, `${label} is present`);
  assert.ok(setFov < frameCamera);
  assert.ok(frameCamera < forceFlora);
  assert.ok(forceFlora < syncVisibility);
  assert.ok(syncVisibility < editorDraw);
  assert.ok(editorDraw < restoreInterior);
  assert.ok(restoreInterior < restoreFlora);
  assert.match(source, /course\.holes\.find\(\(hole\) => hole\.id === persistedEditor\.selectedHoleId\)/);
  assert.match(source, /heldRoot\.visible = false;/);
  assert.match(source, /heldRoot\.visible = savedView\.heldVisible;/);
  assert.match(source, /rig\.maxDist = 700;/);
  assert.match(source, /camera\.near = 1;/);
  assert.doesNotMatch(source, /clubhouseApi\??\.update\(/,
    'prewarm never advances mutable clubhouse systems');
});

