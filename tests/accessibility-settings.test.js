import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const course = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('release settings persist visible accessibility controls', () => {
  for (const label of ['Interface scale', 'Reduced motion', 'First-person tool sway', 'Tool use']) {
    assert.match(main, new RegExp(label));
  }
  assert.match(main, /toolUse: 'hold'/);
  assert.match(main, /uiScale: 1/);
  assert.match(main, /prefers-reduced-motion/);
  assert.match(main, /nextElementSibling\.textContent = `\$\{settings\.fov\}°`/);
  assert.match(main, /nextElementSibling\.textContent = `\$\{settings\.sens\.toFixed\(1\)\}×`/);
});

test('reduced motion reaches UI, held tools, focus, and vehicle camera transitions', () => {
  assert.match(css, /data-reduced-motion="true"/);
  assert.match(course, /const reducedMotion = !!walk\.reducedMotion/);
  assert.match(course, /focusBlend = walk\.reducedMotion/);
  assert.match(course, /mountBlend = walk\.reducedMotion/);
});

test('closing the pause menu restores an intentional zero-speed state', () => {
  assert.match(main, /pausePrevSpeed = app\.speedIdx;/);
  assert.match(main, /app\.speedIdx = pausePrevSpeed;/);
  assert.doesNotMatch(main, /pausePrevSpeed \|\| 1/);
});
