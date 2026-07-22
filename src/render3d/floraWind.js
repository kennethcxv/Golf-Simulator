export const FLORA_WIND_BASE_BY_KIND = Object.freeze({
  deciduous: 0.010,
  ornamental: 0.012,
  evergreen: 0.006,
  palm: 0.018,
  shrub: 0.014,
  reed: 0.035,
  groundcover: 0.030,
  flowerbed: 0.018,
  rock: 0,
});

export const STATIC_FLORA_LOD_IDS = Object.freeze(new Set([
  'fill_a', 'fill_b', 'birch_a', 'pine_b', 'cedar_a', 'pine_far',
  'deciduous_far', 'cypress_far', 'palm_far', 'acacia_far', 'eucalyptus_far',
]));

export function floraWindEligible(id, kind) {
  return kind !== 'rock' && !STATIC_FLORA_LOD_IDS.has(id);
}

export function floraWindStrength(kind, windMph = 6) {
  const base = FLORA_WIND_BASE_BY_KIND[kind] ?? 0.008;
  const wind = Number.isFinite(Number(windMph)) ? Number(windMph) : 6;
  const weatherScale = Math.max(0.2, Math.min(2, wind / 6));
  return base * weatherScale;
}
