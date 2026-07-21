import {
  METERS_TO_YARDS, SHEET06_REGISTRATION_ID, defineSheet06Binding,
} from './units.js';

export const ASSET_058_CEILING_AND_BEAM_KIT = defineSheet06Binding({
  registrationId: SHEET06_REGISTRATION_ID,
  assetNumber: 58,
  assetId: 'A_058_CEILING_AND_BEAM_KIT',
  rootName: 'A_058_CEILING_AND_BEAM_KIT_ROOT',
  sheet: 6,
  stem: 'ceiling_and_beam_kit',
  name: 'CEILING AND BEAM KIT',
  referenceImagePath: 'Designs/RefrenceImages/51-60_refrence_images/ChatGPT Image Jul 17, 2026, 11_23_56 PM.png',
  intendedUse: 'Modular ceiling finishes plus purchasable ceiling and wall-mounted lighting grades',
  paths: {
    source: 'asset_sources/blender/assets_51_100/sheet_06/asset_058_ceiling_and_beam_kit.blend',
    canonicalGlb: 'Assets/assets_51_100/glb/sheet_06/asset_058_ceiling_and_beam_kit.glb',
    runtimeGlb: 'vendor/models/assets_51_100/sheet_06/asset_058_ceiling_and_beam_kit.glb',
    integrationModule: 'src/render3d/assets51to100/asset_058_ceiling_and_beam_kit.js',
  },
  dimensionsMeters: {
    moduleLength: 3.6,
    maximumFixtureWidth: 0.96,
    maximumFixtureDrop: 1.08,
    ceilingModuleWidth: 0.2,
    ceilingModuleHeight: 0.24,
  },
  supportedConstructionFinishFamilies: Object.freeze([
    'drop-ceiling', 'commercial', 'wood-beams', 'vaulted', 'luxury-coffered',
  ]),
  supportedConstructionQualityLevels: Object.freeze([
    'municipal', 'standard', 'premium', 'high-end', 'luxury',
  ]),
  constructionVariantCount: 25,
  supportedConstructionLightingFamilies: Object.freeze([
    'led-panels', 'track-lighting', 'pendant-lighting', 'luxury-chandeliers', 'wall-sconces',
  ]),
  constructionLightingVariantCount: 25,
  runtimeScale: METERS_TO_YARDS,
  requiredSockets: [
    'SOCKET_BeamNext', 'SOCKET_BeamCross', 'SOCKET_BeamEnd', 'SOCKET_RecessedLight',
  ],
  requiredPivots: [],
  requiredAnimations: [],
  mount: {
    root: 'interior',
    placementDatum: 'INTERIOR_CEILING_GRID',
    authoredOrigin: 'MODULE_CENTER_ON_CEILING_DATUM',
    translationContract: 'ASSEMBLE_MODULES_WITH_EXISTING_LIGHTING_RIG_PRESERVED',
    scaleExactlyOnce: true,
  },
  fallbackKey: 'sheet06.asset058.ceilingAndBeams',
  collision: {
    authoredCollisionExpected: true,
    runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
    glbNavigationAuthority: 'NONE',
    activateGlbCollision: false,
    contract: 'Overhead proxies remain outside head clearance; the canonical shell owns ceiling collision.',
  },
});

export default ASSET_058_CEILING_AND_BEAM_KIT;
