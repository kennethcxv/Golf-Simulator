import {
  METERS_TO_YARDS, SHEET06_REGISTRATION_ID, defineSheet06Binding,
} from './units.js';

export const ASSET_055_CLUBHOUSE_WINDOWS_SET = defineSheet06Binding({
  registrationId: SHEET06_REGISTRATION_ID,
  assetNumber: 55,
  assetId: 'A_055_CLUBHOUSE_WINDOWS_SET',
  rootName: 'A_055_CLUBHOUSE_WINDOWS_SET_ROOT',
  sheet: 6,
  stem: 'clubhouse_windows_set',
  name: 'CLUBHOUSE WINDOWS SET',
  referenceImagePath: 'Designs/RefrenceImages/51-60_refrence_images/ChatGPT Image Jul 17, 2026, 11_23_56 PM.png',
  intendedUse: 'Reusable rectangular, narrow, wide and arched window family with repair states',
  paths: {
    source: 'asset_sources/blender/assets_51_100/sheet_06/asset_055_clubhouse_windows_set.blend',
    canonicalGlb: 'Assets/assets_51_100/glb/sheet_06/asset_055_clubhouse_windows_set.glb',
    runtimeGlb: 'vendor/models/assets_51_100/sheet_06/asset_055_clubhouse_windows_set.glb',
    integrationModule: 'src/render3d/assets51to100/asset_055_clubhouse_windows_set.js',
  },
  dimensionsMeters: { standardWidth: 2.19, standardHeight: 1.74, wallDepth: 0.23 },
  runtimeScale: METERS_TO_YARDS,
  requiredSockets: [
    'SOCKET_WindowStandard', 'SOCKET_WindowNarrow',
    'SOCKET_WindowWide', 'SOCKET_WindowArched',
  ],
  requiredPivots: [],
  requiredAnimations: [],
  mount: {
    root: 'group',
    placementDatum: 'SHOP_LAYOUT_STABLE_WINDOW_DATUMS',
    authoredOrigin: 'CENTERED_WALL_MOUNT_ORIGIN',
    translationContract: 'INSTANTIATE_NAMED_VARIANT_PER_WINDOW_ID',
    scaleExactlyOnce: true,
  },
  fallbackKey: 'sheet06.asset055.windowFamily',
  collision: {
    authoredCollisionExpected: true,
    runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
    glbNavigationAuthority: 'NONE',
    activateGlbCollision: false,
    contract: 'Frames may expose thin raycast bounds; glass and trim never block navigation.',
  },
  stateContract: {
    stableWindowIdsRequired: true,
    existingFilmValuesAreAuthoritative: true,
    variants: ['standard', 'narrow', 'wide', 'arched'],
  },
});

export default ASSET_055_CLUBHOUSE_WINDOWS_SET;
