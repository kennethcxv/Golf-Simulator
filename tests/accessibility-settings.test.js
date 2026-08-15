import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const course = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');
const preferences = fs.readFileSync(new URL('../src/core/preferences.js', import.meta.url), 'utf8');

const i18n = fs.readFileSync(new URL('../src/core/i18n.js', import.meta.url), 'utf8');

test('release settings persist visible accessibility controls', () => {
  // O2/Q3 moved the wording into the translation table, so pinning literal
  // English in the panel would now fail on a file that is MORE correct. The
  // intent - these four controls exist, are bound to their preference, and
  // have words to show - is checked where each half actually lives.
  for (const path of [
    'display.uiScale', 'accessibility.reducedMotion', 'camera.bob', 'accessibility.toolActivation',
  ]) {
    assert.match(settings, new RegExp(`'${path.replace('.', '\\.')}'`), `${path} is not wired to a control`);
  }
  for (const key of [
    'settings.display.uiScale', 'settings.accessibility.reducedMotion',
    'settings.camera.bob', 'settings.accessibility.toolActivation',
  ]) {
    assert.match(settings, new RegExp(`t\\('${key.replace(/\./g, '\\.')}'\\)`), `${key} is not drawn from the table`);
    assert.match(i18n, new RegExp(`'${key.replace(/\./g, '\\.')}':`), `${key} has no English line`);
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
