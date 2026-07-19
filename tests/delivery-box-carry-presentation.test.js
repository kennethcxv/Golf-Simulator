import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');
const courseSource = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');

test('first-person delivery cargo renders in an isolated post-world layer and restores world layers', () => {
  assert.match(source, /const DELIVERY_CARRY_RENDER_LAYER = 30/);
  assert.match(source, /object\.userData\.deliveryCarryBaseLayerMask = object\.layers\.mask/);
  assert.match(source, /object\.layers\.set\(DELIVERY_CARRY_RENDER_LAYER\)/);
  assert.match(source, /object\.layers\.mask = object\.userData\.deliveryCarryBaseLayerMask/);
  assert.match(source, /renderer\.clearDepth\(\)/);
  assert.match(source, /renderer\.render\(scene, camera\)/);
  assert.match(source, /camera\.layers\.mask = cameraLayerMask/);
  assert.doesNotMatch(source, /DeliveryCarryDepthReset/);
  assert.match(courseSource, /clubhouseApi\?\.renderDeliveryCarryOverlay\?\.\(\)/);
});

test('carry sleeves present a diagonal forearm instead of an end-on mitten', () => {
  assert.match(source, /new THREE\.CylinderGeometry\(0\.045, 0\.052, 0\.22, 8\)/);
  assert.match(source, /sleeve\.rotation\.x = -1\.08/);
  assert.match(source, /sleeve\.position\.set\(0, -0\.05, 0\.095\)/);
  assert.match(source, /object\.renderOrder = 2002/);
});
