// Player-facing preferences shared by the main menu, pause menu, audio graph,
// camera, renderer, laptop, and accessibility styles. One persisted document
// prevents each surface from inventing its own idea of "settings".

import { DEFAULT_BINDINGS, normalizeBindings } from './keyBindings.js';
import { DEFAULT_LOCALE, isLocale, setLocale } from './i18n.js';

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
    shadowQuality: 'medium',
    postProcessing: true,
    resolution: 'native',
    uiScale: 1,
    // A1 (Goal 18): 0 = uncapped. 60 is the measured default and the only rung
    // that HOLDS: cap 60 paced 60.6 fps with 90-94% of intervals on cadence;
    // cap 120 averaged ~92 fps with 0% of intervals on the 8.33 ms target
    // (tools/qa/electron-a1-fps-cap.js, 2026-08-10). The blocker is not the
    // GPU (5.14 ms after the GTAO re-grade) but 8.0 ms median of CPU-side
    // render submit (electron-a1-cpu-split.js) — the un-frozen clubhouse
    // subtree. When that lever lands and 120 paces cleanly, flip this to 120.
    fpsCap: 60,
  }),
  accessibility: Object.freeze({
    reducedMotion: false,
    highContrast: false,
    toolActivation: 'hold',
  }),
  // Q3: the language everything the player reads is drawn in (src/core/i18n.js)
  locale: DEFAULT_LOCALE,
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
      // 'balanced' is what medium used to be called; map it forward rather than
      // dropping a saved document to 'custom'.
      quality: oneOf(
        display.quality === 'balanced' ? 'medium' : display.quality,
        ['low', 'medium', 'high', 'ultra', 'custom'],
        DEFAULT_PREFERENCES.display.quality,
      ),
      renderScale: clamp(display.renderScale, 0.65, 1.35, DEFAULT_PREFERENCES.display.renderScale),
      ambientOcclusion: bool(display.ambientOcclusion, DEFAULT_PREFERENCES.display.ambientOcclusion),
      bloom: bool(display.bloom, DEFAULT_PREFERENCES.display.bloom),
      shadows: bool(display.shadows, DEFAULT_PREFERENCES.display.shadows),
      shadowQuality: oneOf(display.shadowQuality, ['off', 'low', 'medium', 'high'], DEFAULT_PREFERENCES.display.shadowQuality),
      postProcessing: bool(display.postProcessing, DEFAULT_PREFERENCES.display.postProcessing),
      resolution: oneOf(display.resolution, ['native', '1080p', '1440p', '4k'], DEFAULT_PREFERENCES.display.resolution),
      uiScale: clamp(display.uiScale, 0.9, 1.3, DEFAULT_PREFERENCES.display.uiScale),
      fpsCap: oneOf(display.fpsCap, [0, 60, 120, 144], DEFAULT_PREFERENCES.display.fpsCap),
    },
    accessibility: {
      reducedMotion: bool(accessibility.reducedMotion, DEFAULT_PREFERENCES.accessibility.reducedMotion),
      highContrast: bool(accessibility.highContrast, DEFAULT_PREFERENCES.accessibility.highContrast),
      toolActivation: oneOf(accessibility.toolActivation, ['hold', 'toggle'], DEFAULT_PREFERENCES.accessibility.toolActivation),
    },
    // Q3: an unknown or missing locale falls back to English rather than
    // leaving the game drawing from a table that does not exist
    locale: isLocale(raw.locale) ? raw.locale : DEFAULT_LOCALE,
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
    // Q3: the i18n table follows the document, so every surface that draws a
    // line through t() is already correct by the time the listeners run. One
    // place does this, so no screen can be left drawing the old language.
    setLocale(values.locale);
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

  // Persist a migrated document so the next launch has one source of truth,
  // and put the saved language in force before anything draws.
  setLocale(values.locale);
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

// FOUR TIERS THAT GENUINELY DIFFER, and every field one moves is a measured
// cost. `balanced` is kept as a silent alias of `medium` so a document saved by
// an older build still normalises to a real preset instead of falling back to
// 'custom' and stranding the player on whatever they had.
//
// shadowQuality is the tier that matters most and it is new. Measured in
// Electron on pine-hills-v2 at a fixed shop-floor pose
// (tools/qa/electron-shadow-quality.js): the sun's shadow map is re-baked ten
// times a second, and the frames that carry a bake cost six times a frame that
// does not. Halving the map quarters that raster.
export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    quality: 'low',
    renderScale: 0.65,
    ambientOcclusion: false,
    bloom: false,
    shadows: false,
    shadowQuality: 'off',
    // TRIED AND REVERTED, 2026-08-06: postProcessing: false, to skip the
    // composer entirely rather than run it with both effects off. It measured
    // 21% SLOWER indoors (59.7 fps against Medium's 76.0 at the shop-floor pose)
    // and submitted MORE draw calls, not fewer. The direct-render path is not
    // the cheap path on this renderer and the reason was not isolated; the
    // setPostEnabled hook it needed is kept, because it is sound, but no preset
    // uses it. Recorded so nobody spends the afternoon on it twice.
    postProcessing: true,
  }),
  medium: Object.freeze({
    quality: 'medium',
    postProcessing: true,
    renderScale: 0.9,
    ambientOcclusion: false,
    bloom: true,
    shadows: true,
    shadowQuality: 'low',
  }),
  high: Object.freeze({
    quality: 'high',
    renderScale: 1,
    ambientOcclusion: true,
    bloom: true,
    shadows: true,
    shadowQuality: 'medium',
  }),
  ultra: Object.freeze({
    quality: 'ultra',
    postProcessing: true,
    renderScale: 1.15,
    ambientOcclusion: true,
    bloom: true,
    shadows: true,
    shadowQuality: 'high',
  }),
});

// WHAT EACH ONE CHANGES, in the player's words. The settings screen draws this
// verbatim so the list can never drift from the values above — a preset that
// does not say what it does is a preset nobody dares move.
export const QUALITY_PRESET_NOTES = Object.freeze({
  low: 'No shadows, no ambient shading, no bloom. World drawn at 65%.',
  medium: 'Shadows at half resolution, refreshed half as often. No ambient shading. World at 90%.',
  high: 'Full shadows, ambient shading and bloom. World at full size. The tuned default.',
  ultra: 'Shadows at double resolution refreshed every 60 ms, and the world drawn at 115%: sharper than the screen, then downsampled.',
});

// MEASURED, at three fixed poses in Electron on pine-hills-v2, NPCs at 1x and the
// shop open (tools/qa/electron-quality-presets.js, RTX 5080, 1600x900). Average
// fps, shop floor / shop walk / porch:
//
//   low     69.5 / 77.1 / 78.7
//   medium  70.9 / 71.4 / 76.9
//   high    62.5 / 64.4 / 66.2
//   ultra   54.0 / 54.8 / 64.3
//
// The run brackets itself: `high` is sampled at the start AND the end, and the
// spread between those two readings (6.5%) is the floor below which a gap means
// nothing. medium→high clears it at all three poses (13.4%, 10.9%, 16.2%) and is
// almost entirely GTAO — the ambient-occlusion pass roughly doubles the draw
// calls. high→ultra clears it at two of three.
//
// LOW AND MEDIUM DO NOT RELIABLY SEPARATE ON THIS HARDWARE (-2%, +8%, +2.3%), and
// that is worth saying rather than hiding: on an RTX 5080 at this resolution the
// renderer is not fragment-bound below about 1.35 device pixels, so dropping the
// render scale from 90% to 65% buys nothing. What Low genuinely removes is the
// shadow map and the bloom chain, and those are fragment costs that dominate on
// the weak GPUs Low exists for. The gap should be measured again on one.

// The renderer-side numbers behind display.shadowQuality. walkMap is the map
// baked on foot; bakeMs is how often. Both are read by courseScene's
// setShadowQuality, which owns sun.shadow.mapSize.
export const SHADOW_QUALITY_LEVELS = Object.freeze({
  off: Object.freeze({ enabled: false, walkMap: 1024, fullMap: 2048, bakeMs: 250 }),
  low: Object.freeze({ enabled: true, walkMap: 1024, fullMap: 2048, bakeMs: 200 }),
  medium: Object.freeze({ enabled: true, walkMap: 2048, fullMap: 4096, bakeMs: 100 }),
  high: Object.freeze({ enabled: true, walkMap: 4096, fullMap: 4096, bakeMs: 60 }),
});

// WINDOW SIZES the player can ask for. Electron resizes the real window; a
// browser tab cannot, and says so rather than pretending.
export const RESOLUTION_PRESETS = Object.freeze({
  native: Object.freeze({ label: 'Match the window', width: 0, height: 0 }),
  '1080p': Object.freeze({ label: '1920 × 1080', width: 1920, height: 1080 }),
  '1440p': Object.freeze({ label: '2560 × 1440', width: 2560, height: 1440 }),
  '4k': Object.freeze({ label: '3840 × 2160', width: 3840, height: 2160 }),
});
