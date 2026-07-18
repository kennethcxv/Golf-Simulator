import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { SHEET06_ASSETS, SHEET06_BY_NUMBER } from './sheet06Manifest.js';
import {
  createSheet06AssetCache,
  normalizeSheet06RuntimeBinding,
} from './sheet06AssetCache.js';

function runtimeBinding(binding) {
  return normalizeSheet06RuntimeBinding({
    number: binding.assetNumber,
    runtimeGlb: binding.paths.runtimeGlb,
    rootName: binding.rootName,
    requiredSockets: binding.requiredSockets,
    requiredPivots: binding.requiredPivots,
    requiredAnimations: binding.requiredAnimations,
    mount: binding.mount,
    fallback: binding.fallbackKey,
    runtimeScale: binding.runtimeScale,
    collision: binding.collision,
    sourceBinding: binding,
  });
}

export const SHEET06_RUNTIME_ASSETS = Object.freeze(SHEET06_ASSETS.map(runtimeBinding));

export const SHEET06_RUNTIME_BY_NUMBER = Object.freeze(Object.fromEntries(
  Object.keys(SHEET06_BY_NUMBER).map((number) => [
    number,
    SHEET06_RUNTIME_ASSETS.find((binding) => binding.number === Number(number)),
  ]),
));

/**
 * Creates one eager, instance-scoped ownership boundary for the ten Sheet-6
 * architecture GLBs. The caller supplies the procedural group/interior mounts,
 * fallback nodes, placement datum resolver, and restoration-state applicator.
 * Until a GLB validates and its initial state applies successfully, its matching
 * procedural fallback remains visible.
 */
export function createSheet06Architecture({
  loader = null,
  cache = null,
  cacheFactory = createSheet06AssetCache,
  bindings = SHEET06_RUNTIME_ASSETS,
  mounts = {},
  fallbacks = {},
  placementResolver = null,
  applyState = () => {},
  initialState = null,
  clonePrototype,
  mixerFactory,
  onAssetSettled = null,
  onReady = null,
} = {}) {
  // A fully injected cache is useful to test wiring without initiating I/O and
  // lets a future scene owner substitute a compatible shared orchestration API.
  if (cache) return cache;
  if (typeof cacheFactory !== 'function') throw new TypeError('cacheFactory must be a function');
  const options = {
    loader: loader || new GLTFLoader(),
    bindings,
    mounts,
    fallbacks,
    placementResolver,
    applyState,
    initialState,
    onAssetSettled,
    onReady,
  };
  if (clonePrototype) options.clonePrototype = clonePrototype;
  if (mixerFactory) options.mixerFactory = mixerFactory;
  return cacheFactory(options);
}

export { SHEET06_ASSETS, SHEET06_BY_NUMBER };
