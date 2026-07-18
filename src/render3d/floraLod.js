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

  // Boundary planting closes the horizon and is never player-authored. Its
  // lightweight normalized silhouette is sufficient even at the property edge;
  // intentional trees still graduate to their full hero geometry near camera.
  if (boundary) {
    return {
      sourceId,
      renderId: proxyId,
      tier: 'boundary-proxy',
      hero: false,
      castShadow: false,
    };
  }

  const enter = Number.isFinite(options.heroEnterYd)
    ? Math.max(1, options.heroEnterYd)
    : FLORA_LOD_DEFAULTS.heroEnterYd;
  const exit = Number.isFinite(options.heroExitYd)
    ? Math.max(enter, options.heroExitYd)
    : FLORA_LOD_DEFAULTS.heroExitYd;
  const distance = finiteDistance(distanceYd);
  const hero = previousHero === true ? distance <= exit : distance <= enter;
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
