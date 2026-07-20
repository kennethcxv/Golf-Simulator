// Pure flora LOD policy shared by the renderer and deterministic Node tests.
// Hero assets remain intact near the player; distant authored trees and the
// procedural boundary belt reuse the existing normalized lightweight variants.

export const FLORA_LOD_PROXY_BY_ID = Object.freeze({
  oak_a: 'fill_a',
  oak_b: 'fill_b',
  maple_a: 'birch_a',
  shade_a: 'fill_b',
  pine_a: 'pine_far',
  spruce_a: 'pine_far',
  pine_b: 'pine_far',
  cedar_a: 'pine_far',
});

export const FLORA_LOD_DEFAULTS = Object.freeze({
  heroEnterYd: 125,
  heroExitYd: 150,
  refreshDistanceYd: 18,
  // The boundary belt is ~3,000 instances, so it cannot use the authored radius
  // above — that would promote most of the ring at once. But it also cannot stay
  // proxy-only: the belt IS the horizon in every ground-level view, and its
  // proxies are flat-shaded low-poly cones. A tight band promotes only the few
  // dozen trees actually near the camera, which is what the player reads.
  boundaryHeroEnterYd: 55,
  boundaryHeroExitYd: 72,
});

function finiteDistance(value) {
  return Number.isFinite(value) && value >= 0 ? value : Infinity;
}

export function floraLodChoice(sourceId, distanceYd, previousHero, options = {}) {
  const proxyId = FLORA_LOD_PROXY_BY_ID[sourceId];
  const boundary = options.boundary === true;
  if (!proxyId) {
    const nativeTree = options.tree === true;
    return {
      sourceId,
      renderId: sourceId,
      tier: boundary ? 'boundary-native' : nativeTree ? 'native-light' : 'native',
      hero: false,
      // Low-poly filler trees support the canopy mass but add little useful
      // penumbra beside nearby hero casters. Keeping them out of the large
      // overview shadow map removes repeated submissions without hiding them.
      castShadow: !boundary && !nativeTree,
    };
  }

  // Boundary planting closes the horizon and is never player-authored, so it
  // stays on the cheap silhouette for all the distance that matters. It still
  // graduates near the camera: the belt is what a player standing on a tee
  // actually looks at, and its proxy is a flat-shaded cone stack.
  const enter = Number.isFinite(options.heroEnterYd)
    ? Math.max(1, options.heroEnterYd)
    : boundary ? FLORA_LOD_DEFAULTS.boundaryHeroEnterYd : FLORA_LOD_DEFAULTS.heroEnterYd;
  const exit = Number.isFinite(options.heroExitYd)
    ? Math.max(enter, options.heroExitYd)
    : Math.max(enter, boundary ? FLORA_LOD_DEFAULTS.boundaryHeroExitYd : FLORA_LOD_DEFAULTS.heroExitYd);
  const distance = finiteDistance(distanceYd);
  const hero = previousHero === true ? distance <= exit : distance <= enter;

  if (boundary) {
    return {
      sourceId,
      renderId: hero ? sourceId : proxyId,
      tier: hero ? 'boundary-hero' : 'boundary-proxy',
      hero,
      // Never a shadow caster either way. The belt rings the whole property and
      // its penumbra is redundant beside the authored trees already in the map.
      castShadow: false,
    };
  }

  return {
    sourceId,
    renderId: hero ? sourceId : proxyId,
    tier: hero ? 'hero' : 'proxy',
    hero,
    castShadow: hero,
  };
}

export function floraLodNeedsRefresh(previousPosition, nextPosition, thresholdYd) {
  if (!previousPosition || !nextPosition) return true;
  const threshold = Number.isFinite(thresholdYd) && thresholdYd > 0
    ? thresholdYd
    : FLORA_LOD_DEFAULTS.refreshDistanceYd;
  const dx = Number(nextPosition.x) - Number(previousPosition.x);
  const dz = Number(nextPosition.z) - Number(previousPosition.z);
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return true;
  return dx * dx + dz * dz >= threshold * threshold;
}
