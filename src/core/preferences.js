// Player-facing preferences shared by the main menu, pause menu, audio graph,
// camera, renderer, laptop, and accessibility styles. One persisted document
// prevents each surface from inventing its own idea of "settings".

import { DEFAULT_BINDINGS, normalizeBindings } from './keyBindings.js';

export const PREFERENCES_KEY = 'golfempire:preferences:v1';

export const DEFAULT_PREFERENCES = Object.freeze({
  audio: Object.freeze({
    master: 0.8,
    effects: 0.9,
    ambience: 0.65,
    ui: 0.8,
    muted: false,
  }),
  camera: Object.freeze({
    sensitivity: 1,
    invertY: false,
    fov: 66,
    bob: true,
  }),
  display: Object.freeze({
    quality: 'high',
    renderScale: 1,
    ambientOcclusion: true,
    bloom: true,
    shadows: true,
    uiScale: 1,
  }),
  accessibility: Object.freeze({
    reducedMotion: false,
    highContrast: false,
    toolActivation: 'hold',
  }),
  // N2/F2: the one binding table every key read resolves through
  controls: Object.freeze({
    bindings: DEFAULT_BINDINGS,
  }),
});

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

export function normalizePreferences(raw = {}) {
  const audio = raw.audio || {};
  const camera = raw.camera || {};
  const display = raw.display || {};
  const accessibility = raw.accessibility || {};
  return {
    audio: {
      master: clamp(audio.master, 0, 1, DEFAULT_PREFERENCES.audio.master),
      effects: clamp(audio.effects, 0, 1, DEFAULT_PREFERENCES.audio.effects),
      ambience: clamp(audio.ambience, 0, 1, DEFAULT_PREFERENCES.audio.ambience),
      ui: clamp(audio.ui, 0, 1, DEFAULT_PREFERENCES.audio.ui),
      muted: bool(audio.muted, DEFAULT_PREFERENCES.audio.muted),
    },
    camera: {
      sensitivity: clamp(camera.sensitivity, 0.35, 2.5, DEFAULT_PREFERENCES.camera.sensitivity),
      invertY: bool(camera.invertY, DEFAULT_PREFERENCES.camera.invertY),
      fov: Math.round(clamp(camera.fov, 50, 90, DEFAULT_PREFERENCES.camera.fov)),
      bob: bool(camera.bob, DEFAULT_PREFERENCES.camera.bob),
    },
    display: {
      quality: oneOf(display.quality, ['low', 'balanced', 'high', 'custom'], DEFAULT_PREFERENCES.display.quality),
      renderScale: clamp(display.renderScale, 0.65, 1.35, DEFAULT_PREFERENCES.display.renderScale),
      ambientOcclusion: bool(display.ambientOcclusion, DEFAULT_PREFERENCES.display.ambientOcclusion),
      bloom: bool(display.bloom, DEFAULT_PREFERENCES.display.bloom),
      shadows: bool(display.shadows, DEFAULT_PREFERENCES.display.shadows),
      uiScale: clamp(display.uiScale, 0.9, 1.3, DEFAULT_PREFERENCES.display.uiScale),
    },
    accessibility: {
      reducedMotion: bool(accessibility.reducedMotion, DEFAULT_PREFERENCES.accessibility.reducedMotion),
      highContrast: bool(accessibility.highContrast, DEFAULT_PREFERENCES.accessibility.highContrast),
      toolActivation: oneOf(accessibility.toolActivation, ['hold', 'toggle'], DEFAULT_PREFERENCES.accessibility.toolActivation),
    },
    controls: {
      bindings: normalizeBindings(raw.controls?.bindings),
    },
  };
}

function parse(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readInitial(storage) {
  const current = parse(storage, PREFERENCES_KEY);
  if (current) return normalizePreferences(current);

  // One-time migration from the two settings documents used by older builds.
  const legacyDisplay = parse(storage, 'gc-settings') || {};
  const legacyAudio = parse(storage, 'fairwaystate:settings') || {};
  return normalizePreferences({
    audio: {
      master: legacyAudio.volume,
      muted: legacyAudio.muted,
    },
    camera: {
      sensitivity: legacyDisplay.sens,
      fov: legacyDisplay.fov,
    },
    display: {
      renderScale: legacyDisplay.renderScale,
      ambientOcclusion: legacyDisplay.ao,
      bloom: legacyDisplay.bloom,
      quality: 'custom',
    },
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(target, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = merge({ ...(target[key] || {}) }, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

export function makePreferences(storage = globalThis.localStorage) {
  let values = readInitial(storage);
  const listeners = new Set();

  function persist() {
    try {
      storage?.setItem?.(PREFERENCES_KEY, JSON.stringify(values));
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function publish(result) {
    for (const listener of listeners) listener(values, result);
    return result;
  }

  function update(patch) {
    values = normalizePreferences(merge(clone(values), patch));
    return publish(persist());
  }

  function set(path, value) {
    const parts = String(path).split('.');
    const next = clone(values);
    let at = next;
    for (let i = 0; i < parts.length - 1; i++) at = at[parts[i]] ||= {};
    at[parts.at(-1)] = value;
    values = normalizePreferences(next);
    return publish(persist());
  }

  function reset() {
    values = normalizePreferences(DEFAULT_PREFERENCES);
    return publish(persist());
  }

  // Persist a migrated document so the next launch has one source of truth.
  persist();

  return {
    get values() { return values; },
    get(path) {
      return String(path).split('.').reduce((at, key) => at?.[key], values);
    },
    set,
    update,
    reset,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function applyDocumentPreferences(values, root = globalThis.document?.documentElement) {
  if (!root) return;
  root.style.setProperty('--ui-scale', String(values.display.uiScale));
  root.dataset.reducedMotion = values.accessibility.reducedMotion ? 'true' : 'false';
  root.dataset.highContrast = values.accessibility.highContrast ? 'true' : 'false';
}

export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({ quality: 'low', renderScale: 0.75, ambientOcclusion: false, bloom: false, shadows: false }),
  balanced: Object.freeze({ quality: 'balanced', renderScale: 0.9, ambientOcclusion: true, bloom: false, shadows: true }),
  high: Object.freeze({ quality: 'high', renderScale: 1, ambientOcclusion: true, bloom: true, shadows: true }),
});
