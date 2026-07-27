// PINEHOLLOW CEILING-LIGHT PROGRESSION
//
// Authored in metres, rendered in the clubhouse's yard-based world.  Each SKU
// points at three separately exported GLBs so the renderer can use real LODs
// without rescaling a single mesh into fake upgrade tiers.

import { SHELL } from './shopLayout.js';

export const CEILING_LIGHT_METERS_TO_YARDS = 1.0936133;

const round = (value, places = 3) => {
  const power = 10 ** places;
  return Math.round(value * power) / power;
};

const deepFreeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};

const AIM_PRESETS = deepFreeze([
  { label: 'straight', yaw: 0, tilt: 0 },
  { label: 'left display', yaw: -0.62, tilt: 0.34 },
  { label: 'right display', yaw: 0.62, tilt: -0.34 },
  { label: 'wide wash', yaw: 0.28, tilt: 0.52 },
]);

const rows = [
  {
    key: 'basic', label: 'Basic Suspended Linear Light', level: 1, supplierTier: 1,
    file: 'ceiling_light_basic', assetName: 'CeilingLight_Basic', dimensionsM: [1.45, 0.541, 0.16],
    cost: 150, weightLb: 11, finish: 6, colorTemperatureK: 4250, powerDrawWatts: 42,
    emissiveScale: 0.64, lightIntensityScale: 0.56,
    diffuserEmissionIntensity: 1.35, diffuserEmissionColorLinear: [0.86, 0.93, 1.0],
    runtimeLights: 2, description: 'A practical powder-coated suspended linear fixture with twin cables and a frosted diffuser.',
  },
  {
    key: 'standard', label: 'Standard Square Panel Light', level: 2, supplierTier: 1,
    file: 'ceiling_light_standard', assetName: 'CeilingLight_Standard', dimensionsM: [0.62, 0.083, 0.62],
    cost: 285, weightLb: 9, finish: 8, colorTemperatureK: 3800, powerDrawWatts: 36,
    emissiveScale: 0.68, lightIntensityScale: 0.52,
    diffuserEmissionIntensity: 1.65, diffuserEmissionColorLinear: [1.0, 0.86, 0.69],
    runtimeLights: 1, description: 'A clean warm-white flush panel with a recessed diffuser and restrained frame detail.',
  },
  {
    key: 'premium-single', label: 'Premium Recessed Spotlight', level: 3, supplierTier: 2,
    file: 'ceiling_light_premium_single', assetName: 'CeilingLight_Premium_Single', dimensionsM: [0.184, 0.020, 0.184],
    cost: 210, weightLb: 3, finish: 7, colorTemperatureK: 3250, powerDrawWatts: 18,
    emissiveScale: 0.50, lightIntensityScale: 0.55,
    spotAngleScale: 0.88, trimColorLinear: [0.055, 0.026, 0.009],
    recessDepthM: 0.124,
    runtimeLights: 1, collectionId: 'premium-recessed-set', progressionPrimary: false,
    description: 'One flush bronze-trimmed recessed spotlight with its service can concealed above the ceiling.',
  },
  {
    key: 'premium', label: 'Premium Recessed Spotlight Trio', level: 3, supplierTier: 2,
    file: 'ceiling_light_premium_triple', assetName: 'CeilingLight_Premium_Triple', dimensionsM: [0.86, 0.020, 0.64],
    cost: 620, weightLb: 8, finish: 10, colorTemperatureK: 3250, powerDrawWatts: 54,
    emissiveScale: 0.50, lightIntensityScale: 0.55,
    spotAngleScale: 0.88, trimColorLinear: [0.055, 0.026, 0.009],
    recessDepthM: 0.124,
    runtimeLights: 3, collectionId: 'premium-recessed-set', progressionPrimary: true,
    description: 'A coordinated triangular set of three flush bronze-trimmed recessed spotlights.',
  },
  {
    key: 'high-end', label: 'High-End Adjustable Track Light', level: 4, supplierTier: 3,
    file: 'ceiling_light_high_end', assetName: 'CeilingLight_HighEnd', dimensionsM: [1.28, 0.525, 0.28],
    cost: 1080, weightLb: 18, finish: 12, colorTemperatureK: 2950, powerDrawWatts: 72,
    emissiveScale: 0.58, lightIntensityScale: 0.56,
    darkMetalColorLinear: [0.035, 0.038, 0.035],
    runtimeLights: 3, adjustableHeads: 3, aimPresets: AIM_PRESETS,
    defaultAim: [{ yaw: -0.14, tilt: 0.14 }, { yaw: 0.03, tilt: -0.03 }, { yaw: 0.16, tilt: -0.12 }],
    description: 'A black architectural track with three independently articulated display spotlights.',
  },
  {
    key: 'luxury', label: 'Luxury Brass Crystal Chandelier', level: 5, supplierTier: 3,
    file: 'ceiling_light_luxury', assetName: 'CeilingLight_Luxury', dimensionsM: [1.58, 1.316, 1.58],
    cost: 2650, weightLb: 64, finish: 16, colorTemperatureK: 2700, powerDrawWatts: 156,
    emissiveScale: 0.08, lightIntensityScale: 0.38,
    runtimeColorLinear: [1.0, 0.64, 0.38],
    runtimeLights: 3, requiresProtectedClearance: true,
    description: 'A twelve-candle brass chandelier with two arm tiers, faceted crystals, chains, and a finished canopy.',
  },
];

function paths(file) {
  const base = `vendor/models/ceiling_lights/${file}`;
  return [`${base}.glb`, `${base}_lod1.glb`, `${base}_lod2.glb`];
}

function placementProfile(row) {
  const [widthM, visibleDropM, depthM] = row.dimensionsM;
  return {
    mount: 'ceiling',
    width: round(widthM * CEILING_LIGHT_METERS_TO_YARDS),
    depth: round(depthM * CEILING_LIGHT_METERS_TO_YARDS),
    height: round(visibleDropM * CEILING_LIGHT_METERS_TO_YARDS),
    offsetX: 0,
    offsetZ: 0,
    blocksMovement: false,
    rotationStep: Math.PI / 12,
    recessDepth: round((row.recessDepthM || 0) * CEILING_LIGHT_METERS_TO_YARDS),
    minimumWalkClearance: round(2.05 * CEILING_LIGHT_METERS_TO_YARDS),
    requiresProtectedClearance: row.requiresProtectedClearance === true,
  };
}

export const CEILING_LIGHT_SKUS = deepFreeze(rows.map((row) => {
  const modelLodPaths = paths(row.file);
  return {
    id: `ceiling-light-${row.key}`,
    cat: 'decor',
    tier: row.supplierTier,
    furnitureTier: row.level,
    furnitureTierId: row.key,
    furnitureCategory: 'ceiling-lights',
    name: row.label,
    brand: 'PINEHOLLOW LIGHTING',
    description: row.description,
    cost: row.cost,
    msrp: 0,
    finish: row.finish,
    lb: row.weightLb,
    fragile: row.key === 'luxury' || row.key.startsWith('premium'),
    placeableAssetId: `ceiling-light:${row.key}`,
    modelPath: modelLodPaths[0],
    modelLodPaths,
    modelLodDistancesM: [0, 8, 18],
    modelScale: CEILING_LIGHT_METERS_TO_YARDS,
    mountYOffset: SHELL.h,
    dimensionsM: row.dimensionsM,
    recessDepthM: row.recessDepthM || 0,
    placeableProfile: placementProfile(row),
    functionalProfile: {
      placementNode: 'PLACEMENT_FOOTPRINT',
      controlNode: 'LIGHT_CONTROL_INTERACTION',
      ceilingCutoutNodeSuffix: row.recessDepthM ? 'CEILING_CUTOUT' : null,
      runtimeLights: row.runtimeLights,
      adjustableHeads: row.adjustableHeads || 0,
    },
    lightingProfile: {
      assetName: row.assetName,
      defaultOn: true,
      colorTemperatureK: row.colorTemperatureK,
      powerDrawWatts: row.powerDrawWatts,
      emissiveScale: row.emissiveScale,
      lightIntensityScale: row.lightIntensityScale,
      runtimeColorLinear: row.runtimeColorLinear || null,
      diffuserEmissionIntensity: row.diffuserEmissionIntensity || 0,
      diffuserEmissionColorLinear: row.diffuserEmissionColorLinear || null,
      spotAngleScale: row.spotAngleScale || 1,
      trimColorLinear: row.trimColorLinear || null,
      darkMetalColorLinear: row.darkMetalColorLinear || null,
      runtimeLights: row.runtimeLights,
      adjustableHeads: row.adjustableHeads || 0,
      aimPresets: row.aimPresets || [],
      defaultAim: row.defaultAim || [],
      circuit: 'clubhouse-ceiling',
    },
    collectionId: row.collectionId || null,
    progressionPrimary: row.progressionPrimary !== false,
    geometryProfile: `${row.assetName}:${row.dimensionsM.join('x')}:lod0-lod1-lod2`,
  };
}));

const BY_ID = new Map(CEILING_LIGHT_SKUS.map((sku) => [sku.id, sku]));

export function ceilingLightSku(id) {
  return BY_ID.get(id) || null;
}

export function isCeilingLightSku(sku) {
  return sku?.furnitureCategory === 'ceiling-lights' && !!sku.lightingProfile;
}
