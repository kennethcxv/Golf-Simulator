import {
  METERS_TO_YARDS, SHEET06_REGISTRATION_ID, defineSheet06Binding,
} from './units.js';

export const ASSET_059_RENOVATED_FLOORING_SET = defineSheet06Binding({
  registrationId: SHEET06_REGISTRATION_ID,
  assetNumber: 59,
  assetId: 'A_059_RENOVATED_FLOORING_SET',
  rootName: 'A_059_RENOVATED_FLOORING_SET_ROOT',
  sheet: 6,
  stem: 'renovated_flooring_set',
  name: 'RENOVATED FLOORING SET',
  referenceImagePath: 'Designs/RefrenceImages/51-60_refrence_images/ChatGPT Image Jul 17, 2026, 11_23_56 PM.png',
  intendedUse: 'Clean wood, alternate wood, carpet and tile flooring with surface metadata',
  paths: {
    source: 'asset_sources/blender/assets_51_100/sheet_06/asset_059_renovated_flooring_set.blend',
    canonicalGlb: 'Assets/assets_51_100/glb/sheet_06/asset_059_renovated_flooring_set.glb',
    runtimeGlb: 'vendor/models/assets_51_100/sheet_06/asset_059_renovated_flooring_set.glb',
    integrationModule: 'src/render3d/assets51to100/asset_059_renovated_flooring_set.js',
  },
  dimensionsMeters: { tileWidth: 1, tileLength: 1, thickness: 0.018 },
  runtimeScale: METERS_TO_YARDS,
  requiredSockets: ['SOCKET_FloorOrigin', 'SOCKET_FloorTransition'],
  requiredPivots: [],
  requiredAnimations: [],
  mount: {
    root: 'interior',
    placementDatum: 'INTERIOR_FINISHED_FLOOR_ORIGIN',
    authoredOrigin: 'TILE_CENTER_ON_FINISHED_FLOOR',
    translationContract: 'MATERIAL_OR_SKIN_OVER_SINGLE_CANONICAL_WALK_PLANE',
    scaleExactlyOnce: true,
  },
  fallbackKey: 'sheet06.asset059.renovatedFlooring',
  collision: {
    authoredCollisionExpected: true,
    runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
    glbNavigationAuthority: 'NONE',
    activateGlbCollision: false,
    singleContinuousWalkPlane: true,
    contract: 'One permanent walk plane is authoritative; finish skins and decals add no blockers.',
  },
  stateContract: {
    finishSelectionRequired: true,
    existingGrimeGridIsAuthoritative: true,
    supportedFinishes: ['oak', 'alternate_oak', 'carpet', 'tile', 'concrete', 'vinyl', 'laminate', 'hardwood', 'luxury_hardwood', 'stone_tile', 'marble', 'herringbone'],
    constructionQualityLevels: ['municipal', 'standard', 'premium', 'high_end', 'luxury'],
    constructionVariantCount: 40,
  },
});

export default ASSET_059_RENOVATED_FLOORING_SET;
