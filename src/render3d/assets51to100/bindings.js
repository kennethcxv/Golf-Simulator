// Runtime binding contract for Assets 61-100 (Sheets 7-10).
//
// Sheet 6 gives each of its ten assets its own module. That reads well at ten and badly
// at fifty: the next forty would be forty near-identical files whose only real content is
// a socket list that must match the shipped GLB exactly. So sheets 7-10 declare their
// bindings inline in one manifest per sheet, against this shared contract, and a test
// checks every one of them against the actual binary rather than against a second copy of
// the same claim.
//
// The shape deliberately matches Sheet 6's so the two can be unified later without
// changing what the loader consumes. `normalizeSheet06RuntimeBinding` in the asset cache
// already accepts this shape; its name is Sheet-6 flavoured, its behaviour is not.

import { METERS_TO_YARDS } from './units.js';

export const SHEET_REGISTRATIONS = Object.freeze({
  7: 'PINEHOLLOW_CLUBHOUSE_S07_V1',
  8: 'PINEHOLLOW_CLUBHOUSE_S08_V1',
  9: 'PINEHOLLOW_CLUBHOUSE_S09_V1',
  10: 'PINEHOLLOW_CLUBHOUSE_S10_V1',
});

// What an authored `mount` on the GLB root means for placement. The builders stamp this,
// the reimport reports carry it, and the manifests inherit it -- so it is never retyped.
export const MOUNT_ROOTS = Object.freeze(['interior', 'exterior', 'group']);
export const MOUNT_SURFACES = Object.freeze(['floor', 'wall', 'ceiling', 'surface']);

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function defineBinding(binding) {
  return deepFreeze({ ...binding });
}

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

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${label} must be a string array.`);
  }
}

/**
 * Validate one sheet's ten bindings.
 *
 * Exported so QA tooling can check a generated manifest before it is allowed anywhere
 * near the runtime registry, which is the same reason Sheet 6 exports its validator.
 *
 * @param {ReadonlyArray<object>} assets ten bindings, in ascending asset order
 * @param {number} sheet 7 through 10
 */
export function validateSheetManifest(assets, sheet) {
  const registrationId = SHEET_REGISTRATIONS[sheet];
  if (!registrationId) throw new Error(`Unknown sheet ${sheet}; expected 7 through 10.`);

  const first = (sheet - 1) * 10 + 1;
  const expected = Array.from({ length: 10 }, (_, index) => first + index);
  if (!Array.isArray(assets) || assets.length !== expected.length) {
    throw new Error(`Sheet ${sheet} must contain exactly ten assets numbered ${first} through ${first + 9}.`);
  }

  const assetIds = new Set();
  const rootNames = new Set();
  const stems = new Set();
  const fallbackKeys = new Set();
  const paths = new Set();

  assets.forEach((asset, index) => {
    const number = expected[index];
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      throw new TypeError(`Sheet ${sheet} entry ${index} must be a binding object.`);
    }
    if (asset.assetNumber !== number) {
      throw new Error(`Sheet ${sheet} assets must stay in exact order; expected ${number}.`);
    }
    if (asset.sheet !== sheet || asset.registrationId !== registrationId) {
      throw new Error(`Asset ${number} has the wrong Sheet-${sheet} registration.`);
    }

    requireUnique(asset.assetId, `Asset ${number} assetId`, assetIds);
    requireUnique(asset.rootName, `Asset ${number} rootName`, rootNames);
    requireUnique(asset.stem, `Asset ${number} stem`, stems);
    requireUnique(asset.fallbackKey, `Asset ${number} fallbackKey`, fallbackKeys);
    if (asset.rootName !== `${asset.assetId}_ROOT`) {
      throw new Error(`Asset ${number} rootName must match its Blender root identity.`);
    }

    if (!asset.paths || typeof asset.paths !== 'object') {
      throw new TypeError(`Asset ${number} paths must be an object.`);
    }
    for (const key of ['source', 'canonicalGlb', 'runtimeGlb']) {
      requireUnique(asset.paths[key], `Asset ${number} paths.${key}`, paths);
    }
    const sheetDir = `sheet_${String(sheet).padStart(2, '0')}`;
    if (!asset.paths.runtimeGlb.startsWith(`vendor/models/assets_51_100/${sheetDir}/`)) {
      throw new Error(`Asset ${number} must load from the ${sheetDir} runtime directory.`);
    }

    // Scale is the one thing that must happen exactly once. Applying metres-to-yards
    // twice is a silent 20% error that looks plausible on a chair and absurd on a wall.
    if (asset.runtimeScale !== METERS_TO_YARDS || asset.mount?.scaleExactlyOnce !== true) {
      throw new Error(`Asset ${number} must apply the meters-to-yards scale exactly once.`);
    }
    if (!MOUNT_ROOTS.includes(asset.mount?.root)) {
      throw new Error(`Asset ${number} mount.root must be one of ${MOUNT_ROOTS.join(', ')}.`);
    }
    if (!MOUNT_SURFACES.includes(asset.mount?.surface)) {
      throw new Error(`Asset ${number} mount.surface must be one of ${MOUNT_SURFACES.join(', ')}.`);
    }
    requireString(asset.mount?.placementDatum, `Asset ${number} mount.placementDatum`);

    for (const key of ['requiredSockets', 'requiredPivots', 'requiredAnimations']) {
      requireStringArray(asset[key], `Asset ${number} ${key}`);
    }

    if (typeof asset.collision?.authoredCollisionExpected !== 'boolean') {
      throw new TypeError(`Asset ${number} collision.authoredCollisionExpected must be a boolean.`);
    }
    // Navigation stays analytic for the same reason Sheet 6 keeps it: the shell owns the
    // walkable world, and letting authored props quietly become navigation authorities is
    // how a player ends up wedged behind a filing cabinet.
    if (asset.collision?.runtimeNavigationAuthority !== 'ANALYTIC_LAYOUT'
      || asset.collision?.glbNavigationAuthority !== 'NONE'
      || asset.collision?.activateGlbCollision !== false) {
      throw new Error(`Asset ${number} must retain analytic runtime navigation authority.`);
    }

    if (asset.firstPerson !== null) {
      const fp = asset.firstPerson;
      if (!fp || typeof fp !== 'object') {
        throw new TypeError(`Asset ${number} firstPerson must be an object or null.`);
      }
      requireUnique(fp.runtimeGlb, `Asset ${number} firstPerson.runtimeGlb`, paths);
      requireString(fp.rootName, `Asset ${number} firstPerson.rootName`);
      requireStringArray(fp.requiredSockets, `Asset ${number} firstPerson.requiredSockets`);
      requireStringArray(fp.requiredAnimations, `Asset ${number} firstPerson.requiredAnimations`);
      if (!fp.runtimeGlb.startsWith('vendor/models/assets_51_100/firstperson/')) {
        throw new Error(`Asset ${number} viewmodel must load from the firstperson directory.`);
      }
      // A viewmodel that ships collision would block the player holding it.
      if (fp.collisionExpected !== false) {
        throw new Error(`Asset ${number} viewmodel must not expect collision.`);
      }
    }
  });

  return true;
}

/** Build a `{ [assetNumber]: binding }` lookup from one or more manifests. */
export function indexByNumber(...manifests) {
  return Object.freeze(Object.fromEntries(
    manifests.flat().map((asset) => [asset.assetNumber, asset]),
  ));
}
