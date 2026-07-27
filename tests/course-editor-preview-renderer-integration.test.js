import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sceneSource = readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);

function sourceBetween(start, end) {
  const startIndex = sceneSource.indexOf(start);
  const endIndex = sceneSource.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `found source boundary: ${start}`);
  assert.ok(endIndex > startIndex, `found source boundary: ${end}`);
  return sceneSource.slice(startIndex, endIndex);
}

test('feature preview updates reuse renderer resources across pointer movement', () => {
  const update = sourceBetween(
    'function setEditorFeaturePreview(preview)',
    '// --- placement ghost',
  );

  assert.doesNotMatch(update, /new THREE\.(?:BufferGeometry|ShapeGeometry|MeshBasicMaterial|LineBasicMaterial)/,
    'the hot hover update must not allocate GPU geometry or materials');
  assert.match(update, /setDrawRange\(0, fillCount\)/);
  assert.match(update, /const closed = preview\?\.outline\?\.closed !== false/);
  assert.match(update, /points\.length < \(closed \? 3 : 2\)/);
  assert.match(update, /writePreviewPolyline\(featureOutline\.geometry/);
  assert.match(update, /writePreviewSegments\(featureGuide\.geometry/);
  assert.match(update, /editorFeaturePreview\.visible = true/);
});

test('scene exposes shaped preview and a distinct terrain falloff ring', () => {
  assert.match(sceneSource, /setEditorFeaturePreview,/);
  assert.match(sceneSource, /const featureGuide = new THREE\.LineSegments/);
  assert.match(sceneSource, /const brushFalloffRing = new THREE\.Mesh/);
  assert.match(sceneSource, /radiusYd \* \(1 - clamp\(falloff, 0, 1\)\)/);
});
