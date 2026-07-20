import {
  METERS_TO_YARDS, SHEET06_REGISTRATION_ID, defineSheet06Binding,
} from './units.js';

export const ASSET_052_DILAPIDATED_CLUBHOUSE_EXTERIOR = defineSheet06Binding({
  registrationId: SHEET06_REGISTRATION_ID,
  assetNumber: 52,
  assetId: 'A_052_DILAPIDATED_CLUBHOUSE_EXTERIOR',
  rootName: 'A_052_DILAPIDATED_CLUBHOUSE_EXTERIOR_ROOT',
  sheet: 6,
  stem: 'dilapidated_clubhouse_exterior',
  name: 'DILAPIDATED CLUBHOUSE EXTERIOR',
  referenceImagePath: 'Designs/RefrenceImages/51-60_refrence_images/ChatGPT Image Jul 17, 2026, 11_23_56 PM.png',
  intendedUse: 'Spatially aligned neglected starting state for the restored clubhouse',
  paths: {
    source: 'asset_sources/blender/assets_51_100/sheet_06/asset_052_dilapidated_clubhouse_exterior.blend',
    canonicalGlb: 'Assets/assets_51_100/glb/sheet_06/asset_052_dilapidated_clubhouse_exterior.glb',
    runtimeGlb: 'vendor/models/assets_51_100/sheet_06/asset_052_dilapidated_clubhouse_exterior.glb',
    integrationModule: 'src/render3d/assets51to100/asset_052_dilapidated_clubhouse_exterior.js',
  },
  dimensionsMeters: { width: 19.2, height: 7.13, depth: 12.34 },
  runtimeScale: METERS_TO_YARDS,
  requiredSockets: [
    'SOCKET_MainEntrance', 'SOCKET_Porch', 'SOCKET_ClubSign',
    'SOCKET_Damage_Roof', 'SOCKET_Damage_Trim',
  ],
  requiredPivots: [],
  requiredAnimations: [],
  mount: {
    root: 'group',
    placementDatum: 'ASSET_051_CANONICAL_ORIGIN',
    authoredOrigin: 'FOOTPRINT_CENTER_ON_FINISHED_FLOOR',
    translationContract: 'IDENTICAL_TO_ASSET_051',
    scaleExactlyOnce: true,
  },
  fallbackKey: 'sheet06.asset052.additiveDamage',
  collision: {
    authoredCollisionExpected: true,
    runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
    glbNavigationAuthority: 'NONE',
    activateGlbCollision: false,
    navigationCollisionSourceAssetNumber: 51,
    contract: 'Authored damage helpers may be raycastable, but never alter the canonical walk envelope.',
  },
  structuralContract: {
    role: 'ADDITIVE_DAMAGE_VISUALS',
    structuralAuthority: false,
    structuralAuthorityAssetNumber: 51,
    additiveDamageOnly: true,
    ownsCanonicalStructure: false,
    ownsNavigationCollision: false,
    spatiallyAlignedWithAssetNumber: 51,
    duplicateFullShellAllowed: false,
  },
});

export default ASSET_052_DILAPIDATED_CLUBHOUSE_EXTERIOR;
