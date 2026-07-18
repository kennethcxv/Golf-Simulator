import {
  METERS_TO_YARDS, SHEET06_REGISTRATION_ID, defineSheet06Binding,
} from './units.js';

export const ASSET_060_DAMAGED_FLOORING_SET = defineSheet06Binding({
  registrationId: SHEET06_REGISTRATION_ID,
  assetNumber: 60,
  assetId: 'A_060_DAMAGED_FLOORING_SET',
  rootName: 'A_060_DAMAGED_FLOORING_SET_ROOT',
  sheet: 6,
  stem: 'damaged_flooring_set',
  name: 'DAMAGED FLOORING SET',
  referenceImagePath: 'Designs/RefrenceImages/51-60_refrence_images/ChatGPT Image Jul 17, 2026, 11_23_56 PM.png',
  intendedUse: 'Aligned dirty, scratched, broken, stained, worn and cracked restoration states',
  paths: {
    source: 'asset_sources/blender/assets_51_100/sheet_06/asset_060_damaged_flooring_set.blend',
    canonicalGlb: 'Assets/assets_51_100/glb/sheet_06/asset_060_damaged_flooring_set.glb',
    runtimeGlb: 'vendor/models/assets_51_100/sheet_06/asset_060_damaged_flooring_set.glb',
    integrationModule: 'src/render3d/assets51to100/asset_060_damaged_flooring_set.js',
  },
  dimensionsMeters: { tileWidth: 1, tileLength: 1, maxRelief: 0.035 },
  runtimeScale: METERS_TO_YARDS,
  requiredSockets: ['SOCKET_FloorOrigin', 'SOCKET_DamageModule', 'SOCKET_FloorTransition'],
  requiredPivots: [],
  requiredAnimations: [],
  mount: {
    root: 'interior',
    placementDatum: 'ASSET_059_CANONICAL_WALK_PLANE',
    authoredOrigin: 'TILE_CENTER_ON_FINISHED_FLOOR',
    translationContract: 'ALIGNED_ADDITIVE_DAMAGE_OVER_ASSET_059',
    scaleExactlyOnce: true,
  },
  fallbackKey: 'sheet06.asset060.damagedFlooring',
  collision: {
    authoredCollisionExpected: true,
    runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
    glbNavigationAuthority: 'NONE',
    activateGlbCollision: false,
    navigationCollisionSourceAssetNumber: 59,
    contract: 'Damage is non-snagging and reuses the restored walk plane; shallow proxies are raycast-only.',
  },
  structuralContract: {
    role: 'ADDITIVE_FLOOR_DAMAGE',
    additiveDamageOnly: true,
    surfaceAuthorityAssetNumber: 59,
    ownsNavigationCollision: false,
  },
  stateContract: {
    existingGrimeGridIsAuthoritative: true,
    damageAndRemovableGrimeAreSeparateChannels: true,
  },
});

export default ASSET_060_DAMAGED_FLOORING_SET;
