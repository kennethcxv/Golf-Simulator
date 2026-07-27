import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const courseSceneSource = readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);

test('course renderer resets WebGL state, disposes it, then invalidates parsed GLTFs', () => {
  assert.match(courseSceneSource,
    /composer\.dispose\(\);\s*renderer\.resetState\(\);\s*renderer\.dispose\(\);[\s\S]*?clearGltfCache\(\);\s*return \{/);
});
