import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  makePreferences,
  normalizePreferences,
} from '../src/core/preferences.js';

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
}

test('preferences clamp invalid persisted values to supported ranges', () => {
  const p = normalizePreferences({
    audio: { master: 9, effects: -2, muted: 'yes' },
    camera: { sensitivity: 99, fov: 12 },
    display: { uiScale: 4, quality: 'ultra' },
    accessibility: { toolActivation: 'sometimes' },
  });
  assert.equal(p.audio.master, 1);
  assert.equal(p.audio.effects, 0);
  assert.equal(p.audio.muted, DEFAULT_PREFERENCES.audio.muted);
  assert.equal(p.camera.sensitivity, 2.5);
  assert.equal(p.camera.fov, 50);
  assert.equal(p.display.uiScale, 1.3);
  assert.equal(p.display.quality, 'high');
  assert.equal(p.accessibility.toolActivation, 'hold');
});

test('preferences migrate the two legacy settings documents once', () => {
  const storage = memoryStorage({
    'gc-settings': JSON.stringify({ renderScale: 0.75, ao: false, bloom: false, fov: 72, sens: 1.4 }),
    'fairwaystate:settings': JSON.stringify({ volume: 0.35, muted: true }),
  });
  const prefs = makePreferences(storage);
  assert.equal(prefs.values.audio.master, 0.35);
  assert.equal(prefs.values.audio.muted, true);
  assert.equal(prefs.values.camera.fov, 72);
  assert.equal(prefs.values.camera.sensitivity, 1.4);
  assert.equal(prefs.values.display.renderScale, 0.75);
  assert.equal(prefs.values.display.ambientOcclusion, false);
  assert.ok(storage.data.has(PREFERENCES_KEY));
});

test('preference changes persist and notify without mutating prior snapshots', () => {
  const storage = memoryStorage();
  const prefs = makePreferences(storage);
  const before = prefs.values;
  let calls = 0;
  prefs.subscribe(() => calls++);
  const result = prefs.set('accessibility.reducedMotion', true);
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.notEqual(prefs.values, before);
  assert.equal(before.accessibility.reducedMotion, false);
  assert.equal(JSON.parse(storage.data.get(PREFERENCES_KEY)).accessibility.reducedMotion, true);
});

test('a blocked storage write keeps the in-session setting and reports failure', () => {
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota'); },
  };
  const prefs = makePreferences(storage);
  const result = prefs.set('camera.invertY', true);
  assert.equal(result.ok, false);
  assert.equal(prefs.values.camera.invertY, true);
});
