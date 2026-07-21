import {
  METERS_TO_YARDS, SHEET06_REGISTRATION_ID, defineSheet06Binding,
} from './units.js';

export const ASSET_056_INTERIOR_WALL_PANEL_KIT = defineSheet06Binding({
  registrationId: SHEET06_REGISTRATION_ID,
  assetNumber: 56,
  assetId: 'A_056_INTERIOR_WALL_PANEL_KIT',
  rootName: 'A_056_INTERIOR_WALL_PANEL_KIT_ROOT',
  sheet: 6,
  stem: 'interior_wall_panel_kit',
  name: 'INTERIOR WALL-PANEL KIT',
  referenceImagePath: 'Designs/RefrenceImages/51-60_refrence_images/ChatGPT Image Jul 17, 2026, 11_23_56 PM.png',
  intendedUse: 'Gap-free wainscoting plus thirty purchasable drywall, paint, wood, stone, trim and moulding grade carriers',
  constructionFinishes: {
    category: 'walls',
    families: ['drywall', 'paint', 'wood-panels', 'stone', 'luxury-trim', 'luxury-moulding'],
    qualities: ['municipal', 'standard', 'premium', 'high-end', 'luxury'],
    variantCount: 30,
  },
  paths: {
    source: 'asset_sources/blender/assets_51_100/sheet_06/asset_056_interior_wall_panel_kit.blend',
    canonicalGlb: 'Assets/assets_51_100/glb/sheet_06/asset_056_interior_wall_panel_kit.glb',
    runtimeGlb: 'vendor/models/assets_51_100/sheet_06/asset_056_interior_wall_panel_kit.glb',
    integrationModule: 'src/render3d/assets51to100/asset_056_interior_wall_panel_kit.js',
  },
  dimensionsMeters: { moduleWidth: 1.2, height: 1.15, depth: 0.075 },
  runtimeScale: METERS_TO_YARDS,
  requiredSockets: [
    'SOCKET_PanelNext', 'SOCKET_InsideCorner', 'SOCKET_OutsideCorner',
    'SOCKET_DoorConnector', 'SOCKET_WindowConnector',
  ],
  requiredPivots: [],
  requiredAnimations: [],
  mount: {
    root: 'interior',
    placementDatum: 'INTERIOR_FINISHED_FLOOR_WALL_GRID',
    authoredOrigin: 'CENTERED_WALL_MOUNT_ORIGIN',
    translationContract: 'ASSEMBLE_MODULES_FROM_LAYOUT_APERTURES_AND_CORNERS',
    scaleExactlyOnce: true,
  },
  fallbackKey: 'sheet06.asset056.wallPanels',
  collision: {
    authoredCollisionExpected: true,
    runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
    glbNavigationAuthority: 'NONE',
    activateGlbCollision: false,
    contract: 'Module proxies may support selection, but canonical walls retain the walk envelope.',
  },
});

export default ASSET_056_INTERIOR_WALL_PANEL_KIT;
