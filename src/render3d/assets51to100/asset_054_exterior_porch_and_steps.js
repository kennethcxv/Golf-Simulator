import {
  METERS_TO_YARDS, SHEET06_REGISTRATION_ID, defineSheet06Binding,
} from './units.js';

export const ASSET_054_EXTERIOR_PORCH_AND_STEPS = defineSheet06Binding({
  registrationId: SHEET06_REGISTRATION_ID,
  assetNumber: 54,
  assetId: 'A_054_EXTERIOR_PORCH_AND_STEPS',
  rootName: 'A_054_EXTERIOR_PORCH_AND_STEPS_ROOT',
  sheet: 6,
  stem: 'exterior_porch_and_steps',
  name: 'EXTERIOR PORCH AND STEPS',
  referenceImagePath: 'Designs/RefrenceImages/51-60_refrence_images/ChatGPT Image Jul 17, 2026, 11_23_56 PM.png',
  intendedUse: 'Covered porch, accessible steps, railings and stone column bases',
  paths: {
    source: 'asset_sources/blender/assets_51_100/sheet_06/asset_054_exterior_porch_and_steps.blend',
    canonicalGlb: 'Assets/assets_51_100/glb/sheet_06/asset_054_exterior_porch_and_steps.glb',
    runtimeGlb: 'vendor/models/assets_51_100/sheet_06/asset_054_exterior_porch_and_steps.glb',
    integrationModule: 'src/render3d/assets51to100/asset_054_exterior_porch_and_steps.js',
  },
  dimensionsMeters: { width: 11.52, height: 4.02, depth: 3.29 },
  runtimeScale: METERS_TO_YARDS,
  requiredSockets: [
    'SOCKET_MainEntrance', 'SOCKET_Railing_W', 'SOCKET_Railing_E',
    'SOCKET_Column_W', 'SOCKET_Column_E',
  ],
  requiredPivots: [],
  requiredAnimations: [],
  mount: {
    root: 'group',
    placementDatum: 'ASSET_051_SOCKET_Porch',
    authoredOrigin: 'PORCH_FOOTPRINT_CENTER_ON_FINISHED_FLOOR',
    translationContract: 'SOCKET_FIRST_WITH_LAYOUT_FALLBACK',
    scaleExactlyOnce: true,
  },
  fallbackKey: 'sheet06.asset054.porchAndSteps',
  collision: {
    authoredCollisionExpected: true,
    runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
    glbNavigationAuthority: 'NONE',
    activateGlbCollision: false,
    contract: 'Smooth deck and stair proxy plus simple post and rail blockers; decorative treads never snag.',
  },
});

export default ASSET_054_EXTERIOR_PORCH_AND_STEPS;
