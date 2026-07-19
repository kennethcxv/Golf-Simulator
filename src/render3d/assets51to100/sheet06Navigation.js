import { SHEET06_AUTHORED_FRONT_Z_YARDS } from './sheet06ClubhouseAdapter.js';
import { METERS_TO_YARDS } from './units.js';

// Asset 54 is registered at Asset 51's porch socket. These measurements are the
// authored collision/visible-rail coordinates in build_assets_51_60.py, kept in
// metres here and converted exactly once when a world-space contract is made.
const ASSET54_ROOT_X_YARDS = -1;
const ASSET54_FINISHED_FLOOR_Z_METERS = 0.27432;
const ASSET54_RAMP_INNER_DEPTH_METERS = 1.50;
const ASSET54_RAMP_OUTER_DEPTH_METERS = 3.29;
const ASSET54_RAMP_HALF_WIDTH_METERS = 2.92;
const ASSET54_FRONT_RAIL_DEPTH_METERS = 0.11;
const ASSET54_FRONT_RAIL_BOTTOM_METERS = 0.475;
const ASSET54_FRONT_RAIL_TOP_METERS = 1.155;

const FRONT_RAIL_SPANS_METERS = Object.freeze([
  Object.freeze({ id: 'west', minX: -5.30, maxX: -2.82 }),
  Object.freeze({ id: 'east', minX: 2.82, maxX: 5.30 }),
]);

const freeze = (value) => Object.freeze({ ...value });

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite.`);
  return number;
}

function worldFrame({ centerX = 0, centerZ = 0, floorY = 0 } = {}) {
  return freeze({
    centerX: finite(centerX, 'centerX'),
    centerZ: finite(centerZ, 'centerZ'),
    floorY: finite(floorY, 'floorY'),
  });
}

export const SHEET06_ASSET54_NAVIGATION_METRICS = Object.freeze({
  coordinateAuthority: 'ASSET_054_AUTHORED_METERS_REGISTERED_TO_ASSET_051_PORCH_SOCKET',
  runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
  glbNavigationAuthority: 'NONE',
  activateGlbCollision: false,
  rootXGameYards: ASSET54_ROOT_X_YARDS,
  frontZGameYards: SHEET06_AUTHORED_FRONT_Z_YARDS,
  ramp: Object.freeze({
    innerDepthMeters: ASSET54_RAMP_INNER_DEPTH_METERS,
    outerDepthMeters: ASSET54_RAMP_OUTER_DEPTH_METERS,
    halfWidthMeters: ASSET54_RAMP_HALF_WIDTH_METERS,
  }),
  frontRails: FRONT_RAIL_SPANS_METERS,
});

/**
 * Resolve the legacy clubhouse floor onto Asset 54's authored smooth ramp.
 * A null legacy value remains null; this contract only replaces the abrupt
 * porch-floor step inside the authored central stair opening.
 */
export function resolveSheet06GroundY({
  worldX,
  worldZ,
  centerX = 0,
  centerZ = 0,
  floorY,
  terrainY,
  legacyGroundY = null,
} = {}) {
  const x = Number(worldX);
  const z = Number(worldZ);
  const floor = Number(floorY);
  const terrain = Number(terrainY);
  const legacy = legacyGroundY == null ? null : Number(legacyGroundY);
  if (![x, z, centerX, centerZ, floor, terrain].every(Number.isFinite)
    || (legacy !== null && !Number.isFinite(legacy))) return legacyGroundY;
  if (legacy === null) return null;

  const localX = x - Number(centerX);
  const localZ = z - Number(centerZ);
  const rampCenterX = ASSET54_ROOT_X_YARDS;
  const rampHalfWidth = ASSET54_RAMP_HALF_WIDTH_METERS * METERS_TO_YARDS;
  const rampInnerZ = SHEET06_AUTHORED_FRONT_Z_YARDS
    + ASSET54_RAMP_INNER_DEPTH_METERS * METERS_TO_YARDS;
  const rampOuterZ = SHEET06_AUTHORED_FRONT_Z_YARDS
    + ASSET54_RAMP_OUTER_DEPTH_METERS * METERS_TO_YARDS;

  if (Math.abs(localX - rampCenterX) > rampHalfWidth || localZ < rampInnerZ) {
    return legacy;
  }

  // The tiny legacy porch overhang beyond the authored ramp must use terrain,
  // too; otherwise it recreates the full-height discontinuity in a 4 mm strip.
  if (localZ >= rampOuterZ) return terrain;

  const linear = (localZ - rampInnerZ) / (rampOuterZ - rampInnerZ);
  const smooth = linear * linear * (3 - 2 * linear);
  return floor + (terrain - floor) * smooth;
}

/** Exact world-space 2D blockers for Asset 54's two visible front rail runs. */
export function createSheet06Asset54FrontRailColliders(frame = {}) {
  const { centerX, centerZ, floorY } = worldFrame(frame);
  const zCenter = centerZ + SHEET06_AUTHORED_FRONT_Z_YARDS
    + 1.42 * METERS_TO_YARDS;
  const halfDepth = ASSET54_FRONT_RAIL_DEPTH_METERS * METERS_TO_YARDS / 2;
  const minY = floorY + (
    ASSET54_FRONT_RAIL_BOTTOM_METERS - ASSET54_FINISHED_FLOOR_Z_METERS
  ) * METERS_TO_YARDS;
  const maxY = floorY + (
    ASSET54_FRONT_RAIL_TOP_METERS - ASSET54_FINISHED_FLOOR_Z_METERS
  ) * METERS_TO_YARDS;

  return Object.freeze(FRONT_RAIL_SPANS_METERS.map((span) => freeze({
    id: `sheet06-asset54-front-rail-${span.id}`,
    kind: 'sheet06-asset54-front-rail',
    assetNumber: 54,
    collisionAuthority: 'ANALYTIC_LAYOUT',
    glbCollision: false,
    minX: centerX + ASSET54_ROOT_X_YARDS + span.minX * METERS_TO_YARDS,
    maxX: centerX + ASSET54_ROOT_X_YARDS + span.maxX * METERS_TO_YARDS,
    minZ: zCenter - halfDepth,
    maxZ: zCenter + halfDepth,
    minY,
    maxY,
  })));
}

/**
 * Owns the two analytic rail registrations while leaving ground resolution
 * allocation-free. GLB collision nodes remain hidden metadata throughout.
 */
export function createSheet06NavigationContract({
  centerX = 0,
  centerZ = 0,
  floorY = 0,
  terrainHeightAt,
  addCollider,
  removeCollider,
} = {}) {
  const frame = worldFrame({ centerX, centerZ, floorY });
  if (typeof terrainHeightAt !== 'function') throw new TypeError('terrainHeightAt must be a function.');
  if (typeof addCollider !== 'function') throw new TypeError('addCollider must be a function.');
  if (typeof removeCollider !== 'function') throw new TypeError('removeCollider must be a function.');

  const descriptors = createSheet06Asset54FrontRailColliders(frame);
  let active = false;
  let registered = [];

  function diagnostics() {
    return freeze({
      active,
      runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
      glbNavigationAuthority: 'NONE',
      glbCollisionObjectsActivated: 0,
      railColliderCount: registered.length,
      expectedRailColliderCount: descriptors.length,
      railColliderIds: Object.freeze(registered.map((collider) => collider.id)),
    });
  }

  function activate() {
    if (active) return diagnostics();
    const next = [];
    try {
      for (const descriptor of descriptors) next.push(addCollider({ ...descriptor }) || descriptor);
    } catch (error) {
      for (const collider of next.reverse()) {
        try { removeCollider(collider); } catch { /* preserve the original registration error */ }
      }
      throw error;
    }
    registered = next;
    active = true;
    return diagnostics();
  }

  function deactivate() {
    if (!active) return diagnostics();
    for (const collider of [...registered].reverse()) removeCollider(collider);
    registered = [];
    active = false;
    return diagnostics();
  }

  function groundYAt(worldX, worldZ, legacyGroundY = null) {
    return resolveSheet06GroundY({
      worldX,
      worldZ,
      ...frame,
      terrainY: terrainHeightAt(worldX, worldZ),
      legacyGroundY,
    });
  }

  return Object.freeze({
    groundYAt,
    activate,
    deactivate,
    diagnostics,
    descriptors,
  });
}

export default createSheet06NavigationContract;
