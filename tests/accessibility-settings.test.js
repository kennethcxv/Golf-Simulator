import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const course = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');
const preferences = fs.readFileSync(new URL('../src/core/preferences.js', import.meta.url), 'utf8');

test('release settings persist visible accessibility controls', () => {
  for (const label of ['Interface scale', 'Reduced motion', 'Camera movement', 'Sustained tool use']) {
    assert.match(settings, new RegExp(label));
  }
  assert.match(preferences, /toolActivation: 'hold'/);
  assert.match(preferences, /uiScale: 1/);
  assert.match(preferences, /PREFERENCES_KEY/);
  assert.match(settings, /Math\.round\(value\)/);
  assert.match(settings, /Number\(value\)\.toFixed\(2\)/);
});

test('reduced motion reaches UI, held tools, focus, and vehicle camera transitions', () => {
  assert.match(css, /data-reduced-motion="true"/);
  assert.match(main, /reducedMotion: values\.accessibility\.reducedMotion/);
  assert.match(course, /heldAnim\.t[\s\S]*walk\.reducedMotion/);
  assert.match(course, /focusBlend = walk\.reducedMotion/);
  assert.match(course, /mountBlend = walk\.reducedMotion/);
});

test('closing the pause menu restores an intentional zero-speed state', () => {
  assert.match(main, /pausePrevSpeed = app\.speedIdx;/);
  assert.match(main, /app\.speedIdx = pausePrevSpeed;/);
  assert.doesNotMatch(main, /pausePrevSpeed \|\| 1/);
});
