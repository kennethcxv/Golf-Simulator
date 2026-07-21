import {
  METERS_TO_YARDS, SHEET06_REGISTRATION_ID, defineSheet06Binding,
} from './units.js';

export const ASSET_053_MAIN_ENTRANCE_DOUBLE_DOOR = defineSheet06Binding({
  registrationId: SHEET06_REGISTRATION_ID,
  assetNumber: 53,
  assetId: 'A_053_MAIN_ENTRANCE_DOUBLE_DOOR',
  rootName: 'A_053_MAIN_ENTRANCE_DOUBLE_DOOR_ROOT',
  sheet: 6,
  stem: 'main_entrance_double_door',
  name: 'MAIN ENTRANCE DOUBLE-DOOR ASSEMBLY',
  referenceImagePath: 'Designs/RefrenceImages/51-60_refrence_images/ChatGPT Image Jul 17, 2026, 11_23_56 PM.png',
  intendedUse: 'Operable glazed front entrance for players and customers',
  paths: {
    source: 'asset_sources/blender/assets_51_100/sheet_06/asset_053_main_entrance_double_door.blend',
    canonicalGlb: 'Assets/assets_51_100/glb/sheet_06/asset_053_main_entrance_double_door.glb',
    runtimeGlb: 'vendor/models/assets_51_100/sheet_06/asset_053_main_entrance_double_door.glb',
    integrationModule: 'src/render3d/assets51to100/asset_053_main_entrance_double_door.js',
  },
  dimensionsMeters: { width: 1.8, height: 2.45, depth: 0.24 },
  runtimeScale: METERS_TO_YARDS,
  requiredSockets: [
    'PIVOT_DoorLeft', 'PIVOT_DoorRight',
    'SOCKET_HandleLeft', 'SOCKET_HandleRight', 'SOCKET_Threshold',
  ],
  requiredPivots: ['PIVOT_DoorLeft', 'PIVOT_DoorRight'],
  requiredAnimations: [
    'DoorLeft_Open', 'DoorLeft_Close', 'DoorRight_Open', 'DoorRight_Close',
  ],
  mount: {
    root: 'group',
    placementDatum: 'MAIN_ENTRANCE_THRESHOLD_CENTER',
    authoredOrigin: 'THRESHOLD_CENTER_ON_FINISHED_FLOOR',
    translationContract: 'DOOR_MAIN_X_FLOOR_TOP_SOUTH_WALL',
    scaleExactlyOnce: true,
  },
  fallbackKey: 'sheet06.asset053.mainEntranceDoubleDoor',
  collision: {
    authoredCollisionExpected: true,
    runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
    glbNavigationAuthority: 'NONE',
    activateGlbCollision: false,
    contract: 'Frame is static; each physical hinge owns one state-aware leaf collider.',
  },
  interactionContract: {
    logicalAssembly: 'MAIN_DOUBLE_DOOR',
    persistedState: 'OPEN_OR_CLOSED',
    leafCount: 2,
    occupancyProtectsBothSweptArcs: true,
  },
});

export default ASSET_053_MAIN_ENTRANCE_DOUBLE_DOOR;
