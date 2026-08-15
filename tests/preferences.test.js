import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  makePreferences,
  normalizePreferences,
  QUALITY_PRESETS,
  QUALITY_PRESET_NOTES,
  SHADOW_QUALITY_LEVELS,
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
    // 'ultra' USED TO BE THE INVALID EXAMPLE HERE. It is a shipping tier now
    // (E2), so it would have proved the opposite of what this test is for.
    display: { uiScale: 4, quality: 'cinematic', shadowQuality: 'insane', resolution: '8k' },
    accessibility: { toolActivation: 'sometimes' },
  });
  assert.equal(p.audio.master, 1);
  assert.equal(p.audio.effects, 0);
  assert.equal(p.audio.muted, DEFAULT_PREFERENCES.audio.muted);
  assert.equal(p.camera.sensitivity, 2.5);
  assert.equal(p.camera.fov, 50);
  assert.equal(p.display.uiScale, 1.3);
  assert.equal(p.display.quality, 'high');
  assert.equal(p.display.shadowQuality, DEFAULT_PREFERENCES.display.shadowQuality);
  assert.equal(p.display.resolution, 'native');
  assert.equal(p.accessibility.toolActivation, 'hold');
});

test('every quality tier is accepted, and the old name for medium still is', () => {
  for (const tier of ['low', 'medium', 'high', 'ultra', 'custom']) {
    assert.equal(normalizePreferences({ display: { quality: tier } }).display.quality, tier);
  }
  // A document written before the tiers were renamed must land on a real tier
  // rather than falling through to 'custom' and stranding the player.
  assert.equal(normalizePreferences({ display: { quality: 'balanced' } }).display.quality, 'medium');
});

test('every quality preset is complete, and the tiers are ordered by cost', () => {
  const order = ['low', 'medium', 'high', 'ultra'];
  for (const tier of order) {
    const preset = QUALITY_PRESETS[tier];
    assert.ok(preset, `${tier} preset exists`);
    // A preset that omits a field leaves whatever the player had, so the tier
    // silently means something different depending on where they came from.
    for (const key of ['quality', 'renderScale', 'ambientOcclusion', 'bloom', 'shadows', 'shadowQuality']) {
      assert.ok(Object.hasOwn(preset, key), `${tier} sets ${key}`);
    }
    assert.equal(preset.quality, tier);
    // ...and it has to normalize to itself, or picking it writes something else
    assert.deepEqual(
      normalizePreferences({ display: preset }).display.quality, tier,
    );
    assert.ok(QUALITY_PRESET_NOTES[tier], `${tier} says what it changes`);
  }
  // Monotone in the two things that cost the most: pixels and shadow detail.
  const shadowRank = { off: 0, low: 1, medium: 2, high: 3 };
  for (let i = 1; i < order.length; i++) {
    const lower = QUALITY_PRESETS[order[i - 1]];
    const upper = QUALITY_PRESETS[order[i]];
    assert.ok(upper.renderScale >= lower.renderScale, `${order[i]} draws at least as many pixels as ${order[i - 1]}`);
    assert.ok(
      shadowRank[upper.shadowQuality] >= shadowRank[lower.shadowQuality],
      `${order[i]} has at least as much shadow detail as ${order[i - 1]}`,
    );
  }
  // ...and at least one field must actually MOVE between adjacent tiers, or the
  // tier is a label with nothing behind it.
  for (let i = 1; i < order.length; i++) {
    const lower = QUALITY_PRESETS[order[i - 1]];
    const upper = QUALITY_PRESETS[order[i]];
    const moved = Object.keys(upper).filter((k) => k !== 'quality' && upper[k] !== lower[k]);
    assert.ok(moved.length > 0, `${order[i]} differs from ${order[i - 1]} in something`);
  }
});

test('every shadow tier names a real map size and bake rate', () => {
  for (const [name, level] of Object.entries(SHADOW_QUALITY_LEVELS)) {
    assert.ok([512, 1024, 2048, 4096].includes(level.walkMap), `${name} walkMap is a real texture size`);
    assert.ok([512, 1024, 2048, 4096].includes(level.fullMap), `${name} fullMap is a real texture size`);
    assert.ok(level.bakeMs >= 16 && level.bakeMs <= 1000, `${name} bake rate is inside courseScene's accepted range`);
  }
  // Every tier a preset asks for must exist, or the renderer silently falls back
  // to medium and the preset means nothing.
  for (const preset of Object.values(QUALITY_PRESETS)) {
    assert.ok(SHADOW_QUALITY_LEVELS[preset.shadowQuality], `${preset.quality} names a real shadow tier`);
  }
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
