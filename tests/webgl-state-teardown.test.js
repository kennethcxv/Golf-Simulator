import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const courseSceneSource = readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);

test('course renderer resets shared WebGL state before renderer disposal', () => {
  assert.match(courseSceneSource, /composer\.dispose\(\);\s*renderer\.resetState\(\);\s*renderer\.dispose\(\);/);
});
