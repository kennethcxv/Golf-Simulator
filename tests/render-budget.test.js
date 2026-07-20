import test from 'node:test';
import assert from 'node:assert/strict';
import {
  characterPartCastsShadow,
  configureAmbientStockShadow,
  prepareFrameShadows,
  shouldRefreshPlanarReflection,
} from '../src/render3d/renderBudget.js';

test('one explicit shadow update is requested for each composed game frame', () => {
  const shadowMap = { autoUpdate: true, needsUpdate: false };
  assert.equal(prepareFrameShadows(shadowMap), true);
  assert.equal(shadowMap.autoUpdate, false);
  assert.equal(shadowMap.needsUpdate, true);
  assert.equal(prepareFrameShadows(null), false);
});

test('planar reflections skip material overrides and cache an unchanged interior view', () => {
  assert.equal(shouldRefreshPlanarReflection({ overrideMaterial: true }), false);
  assert.equal(shouldRefreshPlanarReflection({ inside: false }), true);
  assert.equal(shouldRefreshPlanarReflection({
    inside: true,
    now: 4.2,
    lastAt: 4,
    positionDeltaSq: 0.01,
    quaternionDot: 0.99999,
  }), false);
});

test('interior planar reflection refreshes for motion, rotation, or staleness', () => {
  const base = { inside: true, now: 4.2, lastAt: 4, positionDeltaSq: 0, quaternionDot: 1 };
  assert.equal(shouldRefreshPlanarReflection({ ...base, positionDeltaSq: 0.03 }), true);
  assert.equal(shouldRefreshPlanarReflection({ ...base, quaternionDot: 0.9 }), true);
  assert.equal(shouldRefreshPlanarReflection({ ...base, now: 4.6 }), true);
});

test('character shadow silhouette excludes tiny moving details', () => {
  for (const name of ['torso', 'pelvis', 'head', 'thigh', 'calf']) {
    assert.equal(characterPartCastsShadow(name), true, name);
  }
  for (const name of ['face_details', 'cap', 'hair', 'upper_arm', 'forearm_hand', 'shoe']) {
    assert.equal(characterPartCastsShadow(name), false, name);
  }
});

test('merged shelf stock receives light without resubmitting a sun shadow', () => {
  const mesh = { castShadow: true, receiveShadow: false };
  assert.equal(configureAmbientStockShadow(mesh), mesh);
  assert.equal(mesh.castShadow, false);
  assert.equal(mesh.receiveShadow, true);
});
