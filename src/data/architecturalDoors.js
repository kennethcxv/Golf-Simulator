// Production architectural-door catalog. Blender sources author metres and a
// threshold-centre origin; the clubhouse runtime converts to its yard grid once
// at the mounted root. Fixed wall openings are validated before a visual can
// replace the proven procedural fallback.

const freeze = (value) => Object.freeze(value);

export const METERS_TO_YARDS = 1 / 0.9144;

export const ARCHITECTURAL_DOOR_TIERS = freeze({
  basic: freeze({
    id: 'basic', label: 'Basic', rootName: 'Door_Basic', file: 'door_basic.glb',
    leafWidthM: 0.84, leafHeightM: 2.04, leafThicknessM: 0.04,
    openingWidthM: 0.852, openingHeightM: 2.052, frameDepthM: 0.24,
    wallDepthMinM: 0.16, wallDepthMaxM: 0.34, leafCount: 1, openDegrees: 100,
  }),
  standard: freeze({
    id: 'standard', label: 'Standard', rootName: 'Door_Standard', file: 'door_standard.glb',
    leafWidthM: 0.86, leafHeightM: 2.08, leafThicknessM: 0.044,
    openingWidthM: 0.873, openingHeightM: 2.093, frameDepthM: 0.25,
    wallDepthMinM: 0.17, wallDepthMaxM: 0.35, leafCount: 1, openDegrees: 105,
  }),
  premium: freeze({
    id: 'premium', label: 'Premium', rootName: 'Door_Premium', file: 'door_premium.glb',
    leafWidthM: 0.92, leafHeightM: 2.16, leafThicknessM: 0.05,
    openingWidthM: 0.934, openingHeightM: 2.174, frameDepthM: 0.27,
    wallDepthMinM: 0.19, wallDepthMaxM: 0.37, leafCount: 1, openDegrees: 105,
  }),
  'high-end': freeze({
    id: 'high-end', label: 'High-End', rootName: 'Door_HighEnd', file: 'door_high_end.glb',
    leafWidthM: 1.02, leafHeightM: 2.46, leafThicknessM: 0.055,
    openingWidthM: 1.034, openingHeightM: 2.474, frameDepthM: 0.3,
    wallDepthMinM: 0.22, wallDepthMaxM: 0.4, leafCount: 1, openDegrees: 105,
    arched: true,
  }),
  luxury: freeze({
    id: 'luxury', label: 'Luxury', rootName: 'Door_Luxury', file: 'door_luxury.glb',
    leafWidthM: 0.93, leafHeightM: 2.35, leafThicknessM: 0.058,
    openingWidthM: 1.874, openingHeightM: 2.364, frameDepthM: 0.32,
    wallDepthMinM: 0.24, wallDepthMaxM: 0.42, leafCount: 2, openDegrees: 105,
  }),
});

export const ARCHITECTURAL_DOOR_RUNTIME_ROOT = 'vendor/models/architecture/doors';
export const ARCHITECTURAL_DOOR_LOD_DISTANCES_M = freeze([0, 8, 18]);

export const CONSTRUCTION_QUALITY_DOOR_TIER = freeze({
  municipal: 'basic',
  standard: 'standard',
  premium: 'premium',
  'high-end': 'high-end',
  // The Luxury product is the permanent balanced main entrance. Interior and
  // receiving openings remain single-leaf Premium assemblies at this quality.
  luxury: 'premium',
});

export function architecturalDoorSpec(tier) {
  return ARCHITECTURAL_DOOR_TIERS[tier] || null;
}

export function architecturalDoorPath(tier) {
  const spec = architecturalDoorSpec(tier);
  return spec ? `${ARCHITECTURAL_DOOR_RUNTIME_ROOT}/${spec.file}` : null;
}

export function architecturalDoorTierForQuality(qualityId) {
  return CONSTRUCTION_QUALITY_DOOR_TIER[qualityId] || 'basic';
}

export function architecturalDoorScaleForOpening(tier, openingWidthM, openingHeightM, {
  allowDownscale = false,
  maximumDownscale = 0.9,
} = {}) {
  const spec = architecturalDoorSpec(tier);
  if (!spec) return null;
  const widthScale = Number(openingWidthM) / spec.openingWidthM;
  const heightScale = Number(openingHeightM) / spec.openingHeightM;
  const fit = Math.min(1, widthScale, heightScale);
  if (!Number.isFinite(fit) || fit <= 0) return null;
  if (fit < 1 && (!allowDownscale || fit < maximumDownscale)) return null;
  return fit;
}

export function validateArchitecturalDoorMount({
  tier,
  scale = 1,
  openingWidthM,
  openingHeightM,
  wallDepthM,
  floorOffsetM = 0,
  upsideDown = false,
  cornerClearanceM = Infinity,
  swingClearanceM = Infinity,
  ceilingHeightM = Infinity,
}) {
  const spec = architecturalDoorSpec(tier);
  const errors = [];
  if (!spec) return freeze({ ok: false, errors: freeze(['unknown-tier']) });
  if (!Number.isFinite(scale) || scale <= 0) errors.push('invalid-scale');
  if (upsideDown) errors.push('upside-down');
  if (!Number.isFinite(floorOffsetM) || Math.abs(floorOffsetM) > 0.015) errors.push('floor-misaligned');
  const requiredWidth = spec.openingWidthM * scale;
  const requiredHeight = spec.openingHeightM * scale;
  const requiredDepth = spec.frameDepthM * scale;
  const swingRadius = spec.leafWidthM * scale;
  if (!Number.isFinite(openingWidthM) || openingWidthM + 0.002 < requiredWidth) errors.push('opening-too-narrow');
  if (!Number.isFinite(openingHeightM) || openingHeightM + 0.002 < requiredHeight) errors.push('opening-too-short');
  if (!Number.isFinite(wallDepthM)
      || wallDepthM + 0.002 < spec.wallDepthMinM * scale
      || wallDepthM - 0.002 > spec.wallDepthMaxM * scale) errors.push('unsupported-wall-depth');
  if (Number.isFinite(cornerClearanceM) && cornerClearanceM + 0.002 < spec.leafWidthM * 0.16 * scale) {
    errors.push('too-close-to-corner');
  }
  if (Number.isFinite(swingClearanceM) && swingClearanceM + 0.002 < swingRadius) errors.push('swing-blocked');
  if (spec.arched && Number.isFinite(ceilingHeightM) && ceilingHeightM + 0.002 < requiredHeight) {
    errors.push('ceiling-too-low');
  }
  return freeze({
    ok: errors.length === 0,
    errors: freeze(errors),
    required: freeze({
      openingWidthM: requiredWidth,
      openingHeightM: requiredHeight,
      frameDepthM: requiredDepth,
      swingRadiusM: swingRadius,
      leafCount: spec.leafCount,
    }),
  });
}
