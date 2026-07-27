import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as THREE from 'three';

import { applyClubhouseLightingCompatibility } from '../src/render3d/clubhouse/lightingCompatibility.js';

test('16-unit WebGL links panel intensity to point emitters without LTC samplers', () => {
  const root = new THREE.Group();
  const area = new THREE.RectAreaLight(0xffd8ad, 4.5, 1.6, 0.8);
  area.name = 'CeilingPanelLight_test';
  area.position.set(2, 3, 4);
  root.add(area);

  const report = applyClubhouseLightingCompatibility(root, {
    capabilities: { maxTextures: 16 },
  });
  const fallback = root.getObjectByName('CeilingPanelLight_test_PointFallback');

  assert.deepEqual(report, {
    backend: 'point-fallback',
    maxTextureImageUnits: 16,
    replacementCount: 1,
  });
  assert.equal(area.visible, false);
  assert.equal(fallback?.isPointLight, true);
  assert.deepEqual(fallback.position.toArray(), [2, 3, 4]);
  area.intensity = 7.25;
  assert.equal(fallback.intensity, 7.25);
  area.visible = false;
  assert.equal(fallback.visible, false);
  area.visible = true;
  assert.equal(area.visible, false);
  assert.equal(fallback.visible, true);
});

test('32-unit WebGL retains the authored rectangular panel rig', () => {
  const root = new THREE.Group();
  const area = new THREE.RectAreaLight(0xffd8ad, 4.5, 1.6, 0.8);
  root.add(area);

  const report = applyClubhouseLightingCompatibility(root, {
    capabilities: { maxTextures: 32 },
  });

  assert.equal(report.backend, 'rect-area');
  assert.equal(report.replacementCount, 0);
  assert.equal(area.visible, true);
  assert.equal(root.children.length, 1);
});

test('the live Pine Hills clubhouse retains the exact authored RectArea panel rig', () => {
  const source = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /import \{ applyClubhouseLightingCompatibility \}/);
  assert.doesNotMatch(source, /applyClubhouseLightingCompatibility\(interior, renderer\)/);
  assert.match(
    source,
    /const lightingCompatibility = Object\.freeze\(\{[\s\S]*?backend: 'rect-area'[\s\S]*?replacementCount: 0/,
  );
});
