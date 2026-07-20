import {
  METERS_TO_YARDS, SHEET06_REGISTRATION_ID, defineSheet06Binding,
} from './units.js';

export const ASSET_057_INTERIOR_TRIM_AND_BASEBOARD_KIT = defineSheet06Binding({
  registrationId: SHEET06_REGISTRATION_ID,
  assetNumber: 57,
  assetId: 'A_057_INTERIOR_TRIM_AND_BASEBOARD_KIT',
  rootName: 'A_057_INTERIOR_TRIM_AND_BASEBOARD_KIT_ROOT',
  sheet: 6,
  stem: 'interior_trim_and_baseboard_kit',
  name: 'INTERIOR TRIM AND BASEBOARD KIT',
  referenceImagePath: 'Designs/RefrenceImages/51-60_refrence_images/ChatGPT Image Jul 17, 2026, 11_23_56 PM.png',
  intendedUse: 'Reusable baseboard, crown, chair-rail, casing, corner, cap and junction modules',
  paths: {
    source: 'asset_sources/blender/assets_51_100/sheet_06/asset_057_interior_trim_and_baseboard_kit.blend',
    canonicalGlb: 'Assets/assets_51_100/glb/sheet_06/asset_057_interior_trim_and_baseboard_kit.glb',
    runtimeGlb: 'vendor/models/assets_51_100/sheet_06/asset_057_interior_trim_and_baseboard_kit.glb',
    integrationModule: 'src/render3d/assets51to100/asset_057_interior_trim_and_baseboard_kit.js',
  },
  dimensionsMeters: { moduleLength: 2.4, height: 0.14, depth: 0.025 },
  runtimeScale: METERS_TO_YARDS,
  requiredSockets: [
    'SOCKET_TrimNext', 'SOCKET_InsideCorner', 'SOCKET_OutsideCorner',
    'SOCKET_EndCap', 'SOCKET_Junction',
  ],
  requiredPivots: [],
  requiredAnimations: [],
  mount: {
    root: 'interior',
    placementDatum: 'INTERIOR_FINISHED_FLOOR_TRIM_GRID',
    authoredOrigin: 'CENTERED_WALL_MOUNT_ORIGIN',
    translationContract: 'ASSEMBLE_MODULES_WITH_SHARED_PANEL_AND_APERTURE_DATUMS',
    scaleExactlyOnce: true,
  },
  fallbackKey: 'sheet06.asset057.trimAndBaseboards',
  collision: {
    authoredCollisionExpected: false,
    runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
    glbNavigationAuthority: 'NONE',
    activateGlbCollision: false,
    contract: 'No movement blocker; use non-navigation selection bounds only where required.',
  },
});

export default ASSET_057_INTERIOR_TRIM_AND_BASEBOARD_KIT;
