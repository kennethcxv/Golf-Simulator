import {
  METERS_TO_YARDS, SHEET06_REGISTRATION_ID, defineSheet06Binding,
} from './units.js';

export const ASSET_051_FINISHED_CLUBHOUSE_EXTERIOR = defineSheet06Binding({
  registrationId: SHEET06_REGISTRATION_ID,
  assetNumber: 51,
  assetId: 'A_051_FINISHED_CLUBHOUSE_EXTERIOR',
  rootName: 'A_051_FINISHED_CLUBHOUSE_EXTERIOR_ROOT',
  sheet: 6,
  stem: 'finished_clubhouse_exterior',
  name: 'FINISHED CLUBHOUSE EXTERIOR',
  referenceImagePath: 'Designs/RefrenceImages/51-60_refrence_images/ChatGPT Image Jul 17, 2026, 11_23_56 PM.png',
  intendedUse: 'Complete restored clubhouse shell plus garage-door and exterior landscape-light finish grades',
  constructionFinishes: {
    category: 'garage-doors',
    families: ['garage-door'],
    qualities: ['municipal', 'standard', 'premium', 'high-end', 'luxury'],
    variantCount: 5,
    collisionContract: 'Finish-only skins retain the analytic east-wall collision authority.',
  },
  landscapeLightingFinishes: {
    category: 'lighting',
    families: ['landscape-lighting'],
    qualities: ['municipal', 'standard', 'premium', 'high-end', 'luxury'],
    variantCount: 5,
    placementContract: 'Eight stable exterior datums remain visual-only and inside the canonical footprint.',
  },
  paths: {
    source: 'asset_sources/blender/assets_51_100/sheet_06/asset_051_finished_clubhouse_exterior.blend',
    canonicalGlb: 'Assets/assets_51_100/glb/sheet_06/asset_051_finished_clubhouse_exterior.glb',
    runtimeGlb: 'vendor/models/assets_51_100/sheet_06/asset_051_finished_clubhouse_exterior.glb',
    integrationModule: 'src/render3d/assets51to100/asset_051_finished_clubhouse_exterior.js',
  },
  dimensionsMeters: {
    structuralWidth: 19.2,
    structuralHeight: 7.13,
    structuralDepth: 12.34,
    overallFinishWidth: 19.89,
    overallFinishDepth: 13.46,
  },
  runtimeScale: METERS_TO_YARDS,
  requiredSockets: [
    'SOCKET_MainEntrance', 'SOCKET_Porch', 'SOCKET_ClubSign',
    'SOCKET_ExteriorLight_W', 'SOCKET_ExteriorLight_E',
  ],
  requiredPivots: [],
  requiredAnimations: [],
  mount: {
    root: 'group',
    placementDatum: 'CLUBHOUSE_FINISHED_FLOOR_ORIGIN',
    authoredOrigin: 'FOOTPRINT_CENTER_ON_FINISHED_FLOOR',
    translationContract: 'LOCAL_XZ_ZERO_AND_LOCAL_Y_FLOOR_TOP',
    scaleExactlyOnce: true,
  },
  fallbackKey: 'sheet06.asset051.canonicalShell',
  collision: {
    authoredCollisionExpected: true,
    authoredCollisionDesignAuthority: true,
    runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
    glbNavigationAuthority: 'NONE',
    activateGlbCollision: false,
    contract: 'Simplified wall, roof, foundation and column proxies preserve real door and window openings.',
  },
  structuralContract: {
    role: 'CANONICAL_STRUCTURAL_AUTHORITY',
    structuralAuthority: true,
    ownsCanonicalStructure: true,
    counterpartAssetNumber: 52,
    duplicateFullShellAllowed: false,
  },
});

export default ASSET_051_FINISHED_CLUBHOUSE_EXTERIOR;
