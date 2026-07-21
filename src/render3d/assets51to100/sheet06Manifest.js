import asset051 from './asset_051_finished_clubhouse_exterior.js';
import asset052 from './asset_052_dilapidated_clubhouse_exterior.js';
import asset053 from './asset_053_main_entrance_double_door.js';
import asset054 from './asset_054_exterior_porch_and_steps.js';
import asset055 from './asset_055_clubhouse_windows_set.js';
import asset056 from './asset_056_interior_wall_panel_kit.js';
import asset057 from './asset_057_interior_trim_and_baseboard_kit.js';
import asset058 from './asset_058_ceiling_and_beam_kit.js';
import asset059 from './asset_059_renovated_flooring_set.js';
import asset060 from './asset_060_damaged_flooring_set.js';
import { METERS_TO_YARDS, SHEET06_REGISTRATION_ID } from './units.js';

const EXPECTED_ASSET_NUMBERS = Object.freeze([51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
const PATH_KEYS = Object.freeze(['source', 'canonicalGlb', 'runtimeGlb', 'integrationModule']);

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function requireUnique(value, label, seen) {
  requireString(value, label);
  if (seen.has(value)) throw new Error(`${label} must be unique: ${value}`);
  seen.add(value);
}

function validateDimensions(dimensions, assetNumber) {
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) {
    throw new TypeError(`Asset ${assetNumber} dimensionsMeters must be an object.`);
  }
  const entries = Object.entries(dimensions);
  if (entries.length === 0 || entries.some(([, value]) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`Asset ${assetNumber} dimensionsMeters must contain positive finite values.`);
  }
}

/**
 * Validates the immutable loader contract for the ten Sheet-6 clubhouse assets.
 * This is intentionally exported so build/QA tooling can validate generated
 * candidate manifests before allowing them into the runtime registry.
 */
export function validateSheet06Manifest(assets) {
  if (!Array.isArray(assets) || assets.length !== EXPECTED_ASSET_NUMBERS.length) {
    throw new Error('Sheet 6 must contain exactly ten assets numbered 51 through 60.');
  }

  const assetIds = new Set();
  const rootNames = new Set();
  const stems = new Set();
  const fallbackKeys = new Set();
  const paths = new Set();

  assets.forEach((asset, index) => {
    const expectedNumber = EXPECTED_ASSET_NUMBERS[index];
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      throw new TypeError(`Sheet 6 entry ${index} must be an asset binding object.`);
    }
    if (asset.assetNumber !== expectedNumber) {
      throw new Error(`Sheet 6 assets must remain in exact 51-60 order; expected ${expectedNumber}.`);
    }
    if (asset.sheet !== 6 || asset.registrationId !== SHEET06_REGISTRATION_ID) {
      throw new Error(`Asset ${expectedNumber} has the wrong Sheet-6 registration.`);
    }

    requireUnique(asset.assetId, `Asset ${expectedNumber} assetId`, assetIds);
    requireUnique(asset.rootName, `Asset ${expectedNumber} rootName`, rootNames);
    requireUnique(asset.stem, `Asset ${expectedNumber} stem`, stems);
    requireUnique(asset.fallbackKey, `Asset ${expectedNumber} fallbackKey`, fallbackKeys);
    if (asset.rootName !== `${asset.assetId}_ROOT`) {
      throw new Error(`Asset ${expectedNumber} rootName must match its Blender root identity.`);
    }

    if (!asset.paths || typeof asset.paths !== 'object') {
      throw new TypeError(`Asset ${expectedNumber} paths must be an object.`);
    }
    for (const key of PATH_KEYS) {
      requireUnique(asset.paths[key], `Asset ${expectedNumber} paths.${key}`, paths);
    }
    if (asset.paths.integrationModule !== `src/render3d/assets51to100/asset_${String(expectedNumber).padStart(3, '0')}_${asset.stem}.js`) {
      throw new Error(`Asset ${expectedNumber} integrationModule must point to its binding module.`);
    }

    validateDimensions(asset.dimensionsMeters, expectedNumber);
    if (asset.runtimeScale !== METERS_TO_YARDS || asset.mount?.scaleExactlyOnce !== true) {
      throw new Error(`Asset ${expectedNumber} must apply the meters-to-yards scale exactly once.`);
    }
    if (!['group', 'interior'].includes(asset.mount?.root)) {
      throw new Error(`Asset ${expectedNumber} mount.root must be group or interior.`);
    }
    requireString(asset.mount?.placementDatum, `Asset ${expectedNumber} mount.placementDatum`);

    for (const key of ['requiredSockets', 'requiredPivots', 'requiredAnimations']) {
      if (!Array.isArray(asset[key]) || asset[key].some((value) => typeof value !== 'string')) {
        throw new TypeError(`Asset ${expectedNumber} ${key} must be a string array.`);
      }
    }
    if (asset.collision?.runtimeNavigationAuthority !== 'ANALYTIC_LAYOUT'
      || asset.collision?.glbNavigationAuthority !== 'NONE'
      || asset.collision?.activateGlbCollision !== false) {
      throw new Error(`Asset ${expectedNumber} must retain analytic runtime navigation authority.`);
    }
  });

  const finished = assets[0];
  const damaged = assets[1];
  if (finished.structuralContract?.role !== 'CANONICAL_STRUCTURAL_AUTHORITY'
    || finished.structuralContract?.structuralAuthority !== true
    || finished.collision?.authoredCollisionDesignAuthority !== true) {
    throw new Error('Asset 51 must remain the canonical structural and authored-collision design authority.');
  }
  if (damaged.structuralContract?.role !== 'ADDITIVE_DAMAGE_VISUALS'
    || damaged.structuralContract?.additiveDamageOnly !== true
    || damaged.structuralContract?.ownsCanonicalStructure !== false
    || damaged.structuralContract?.ownsNavigationCollision !== false
    || damaged.collision?.glbNavigationAuthority !== 'NONE') {
    throw new Error('Asset 52 must remain additive damage with no structural or navigation authority.');
  }

  return true;
}

export const SHEET06_ASSETS = Object.freeze([
  asset051,
  asset052,
  asset053,
  asset054,
  asset055,
  asset056,
  asset057,
  asset058,
  asset059,
  asset060,
]);

validateSheet06Manifest(SHEET06_ASSETS);

export const SHEET06_BY_NUMBER = Object.freeze(Object.fromEntries(
  SHEET06_ASSETS.map((asset) => [asset.assetNumber, asset]),
));
