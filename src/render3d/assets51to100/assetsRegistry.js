// One lookup for every Assets 51-100 runtime binding.
//
// Sheet 6 keeps its per-asset modules and its own validator; sheets 7-10 declare theirs
// in generated manifests against the shared contract in bindings.js. Both shapes agree on
// what the loader needs — identity, paths, scale, sockets, mount and collision policy — so
// callers can work from asset number alone and stay out of the difference.
//
// Nothing here mounts anything. Building a registry is separate from deciding where a
// trophy cabinet stands, and keeping them separate means the scene can adopt these assets
// one room at a time instead of all at once.

import { SHEET06_ASSETS } from './sheet06Manifest.js';
import SHEET07_ASSETS from './sheet07Manifest.js';
import SHEET08_ASSETS from './sheet08Manifest.js';
import SHEET09_ASSETS from './sheet09Manifest.js';
import SHEET10_ASSETS from './sheet10Manifest.js';
import { indexByNumber } from './bindings.js';

export const SHEETS = Object.freeze({
  6: SHEET06_ASSETS,
  7: SHEET07_ASSETS,
  8: SHEET08_ASSETS,
  9: SHEET09_ASSETS,
  10: SHEET10_ASSETS,
});

export const ALL_ASSETS = Object.freeze([
  ...SHEET06_ASSETS, ...SHEET07_ASSETS, ...SHEET08_ASSETS, ...SHEET09_ASSETS, ...SHEET10_ASSETS,
]);

export const ASSETS_BY_NUMBER = indexByNumber(ALL_ASSETS);

if (ALL_ASSETS.length !== 50) {
  throw new Error(`Assets 51-100 registry must hold exactly 50 bindings, found ${ALL_ASSETS.length}.`);
}
for (let number = 51; number <= 100; number += 1) {
  if (!ASSETS_BY_NUMBER[number]) throw new Error(`Assets 51-100 registry is missing asset ${number}.`);
}

/** Bindings that also ship a first-person viewmodel. Sheet 8 only, today. */
export const VIEWMODEL_ASSETS = Object.freeze(ALL_ASSETS.filter((asset) => asset.firstPerson));

export function bindingFor(assetNumber) {
  const binding = ASSETS_BY_NUMBER[assetNumber];
  if (!binding) throw new Error(`No Assets 51-100 binding for asset ${assetNumber}.`);
  return binding;
}

/**
 * Every runtime GLB the registry can ask for, world copies and viewmodels alike.
 * Useful for residency checks and preloading; the loader takes bindings, not paths.
 */
export function runtimeGlbPaths() {
  const paths = [];
  for (const asset of ALL_ASSETS) {
    paths.push(asset.paths.runtimeGlb);
    if (asset.firstPerson) paths.push(asset.firstPerson.runtimeGlb);
  }
  return Object.freeze(paths);
}

export default ASSETS_BY_NUMBER;
