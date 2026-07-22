import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const courseSceneSource = readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('initial scene build uploads its prepared visual and flow fields without recomputing them', () => {
  assert.match(courseSceneSource, /function rebuildAll\(st, \{\s*reusePreparedVisualFields = false,\s*reusePreparedFlowField = false,/);
  assert.match(courseSceneSource, /if \(!reusePreparedFlowField\) rebuildFlowField\(\);/);
  assert.match(
    courseSceneSource,
    /if \(reusePreparedVisualFields\) \{[\s\S]*?zoneHiTex\.needsUpdate = true;[\s\S]*?surfaceDistanceTex\.clearUpdateRanges\(\);[\s\S]*?surfaceDistanceTex\.needsUpdate = true;[\s\S]*?\} else \{\s*updateZoneField\(st\);\s*\}/,
  );
  assert.match(
    courseSceneSource,
    /rebuildAll\(state, \{\s*reusePreparedVisualFields: true,\s*reusePreparedFlowField: true,\s*\}\);/,
  );
});

test('game start paints the loading veil before destroying and rebuilding the scene', () => {
  const start = mainSource.indexOf('function startGame(');
  const end = mainSource.indexOf('\nfunction startGameNow(', start);
  assert.ok(start >= 0 && end > start, 'startGame lifecycle wrapper must exist');
  const body = mainSource.slice(start, end);

  const show = body.indexOf("veil.show('Preparing the course')");
  const speed = body.indexOf('app.speedIdx = 0');
  const reset = body.indexOf('resetCameraInput()');
  const firstFrame = body.indexOf('requestAnimationFrame(() => {');
  const secondFrame = body.indexOf('requestAnimationFrame(() => {', firstFrame + 1);
  const destroy = body.indexOf('destroyCurrentScene()');

  assert.ok(show >= 0, 'loading veil must be shown');
  assert.ok(speed > show && reset > speed, 'simulation and input must stop before yielding');
  assert.ok(firstFrame > reset && secondFrame > firstFrame, 'startup must yield through two animation frames');
  assert.ok(destroy > secondFrame, 'old scene teardown must wait until after the paint yield');
  assert.match(body, /const barrier = destroyCurrentScene\(\);\s*app\.prewarming = true;/);
  assert.match(body, /if \(barrier\) \{\s*veil\.set\('Finishing the previous course load'\);/);
});
