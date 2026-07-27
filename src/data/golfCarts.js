// Original Golf Flipper cart progression catalog.
//
// Runtime dimensions and capacities mirror the Blender-authored asset metadata in
// vendor/models/golf_carts/config. Keeping this small registry in source lets the
// simulation and renderer share one stable tier contract without fetching JSON at
// boot; the generated catalog remains the asset-pipeline audit authority.

export const GOLF_CART_TIERS = Object.freeze([
  Object.freeze({
    id: 'basic',
    rank: 1,
    assetId: 'GolfCart_Basic',
    name: 'Basic',
    modelUrl: 'vendor/models/golf_carts/golf_cart_basic.glb',
    capacity: 2,
    dimensionsM: Object.freeze([1.20, 2.45, 1.78]),
    drive: Object.freeze({ topSpeedYdPerSec: 8.4, reverseYdPerSec: 3.6, accelerationYdPerSec2: 5.0, brakeYdPerSec2: 8.8, turnRateRadPerSec: 1.72 }),
    purchaseCost: 6800,
    repairPerPoint: 22,
    chargeMinutes: 2.6,
    accent: '#174b35',
    summary: 'Compact two-seat workhorse with a bag rack and folding windshield.',
  }),
  Object.freeze({
    id: 'standard',
    rank: 2,
    assetId: 'GolfCart_Standard',
    name: 'Standard',
    modelUrl: 'vendor/models/golf_carts/golf_cart_standard.glb',
    capacity: 2,
    dimensionsM: Object.freeze([1.23, 2.58, 1.81]),
    drive: Object.freeze({ topSpeedYdPerSec: 8.8, reverseYdPerSec: 3.8, accelerationYdPerSec2: 5.3, brakeYdPerSec2: 9.0, turnRateRadPerSec: 1.66 }),
    purchaseCost: 9400,
    repairPerPoint: 28,
    chargeMinutes: 2.4,
    accent: '#b18b5c',
    summary: 'Upgraded two-seat fleet cart with utility storage and alloy wheels.',
  }),
  Object.freeze({
    id: 'premium',
    rank: 3,
    assetId: 'GolfCart_Premium',
    name: 'Premium',
    modelUrl: 'vendor/models/golf_carts/golf_cart_premium.glb',
    capacity: 4,
    dimensionsM: Object.freeze([1.27, 3.08, 1.86]),
    drive: Object.freeze({ topSpeedYdPerSec: 9.1, reverseYdPerSec: 3.9, accelerationYdPerSec2: 5.5, brakeYdPerSec2: 9.2, turnRateRadPerSec: 1.54 }),
    purchaseCost: 15800,
    repairPerPoint: 38,
    chargeMinutes: 2.2,
    accent: '#242628',
    summary: 'Gloss-black four-seat cart with a rear-facing passenger bench.',
  }),
  Object.freeze({
    id: 'high_end',
    rank: 4,
    assetId: 'GolfCart_HighEnd',
    name: 'High-End',
    modelUrl: 'vendor/models/golf_carts/golf_cart_high_end.glb',
    capacity: 4,
    dimensionsM: Object.freeze([1.30, 3.20, 1.89]),
    drive: Object.freeze({ topSpeedYdPerSec: 9.5, reverseYdPerSec: 4.0, accelerationYdPerSec2: 5.8, brakeYdPerSec2: 9.5, turnRateRadPerSec: 1.50 }),
    purchaseCost: 23500,
    repairPerPoint: 52,
    chargeMinutes: 1.9,
    accent: '#275f99',
    summary: 'Metallic-blue four-seat model with premium trim and lithium storage.',
  }),
  Object.freeze({
    id: 'luxury',
    rank: 5,
    assetId: 'GolfCart_Luxury',
    name: 'Luxury',
    modelUrl: 'vendor/models/golf_carts/golf_cart_luxury.glb',
    capacity: 6,
    dimensionsM: Object.freeze([1.38, 3.96, 1.95]),
    drive: Object.freeze({ topSpeedYdPerSec: 9.0, reverseYdPerSec: 3.7, accelerationYdPerSec2: 4.8, brakeYdPerSec2: 9.4, turnRateRadPerSec: 1.34 }),
    purchaseCost: 36000,
    repairPerPoint: 72,
    chargeMinutes: 1.7,
    accent: '#202326',
    summary: 'Semi-enclosed six-seat resort shuttle with six doors and luggage space.',
  }),
]);

export const GOLF_CART_TIER_IDS = Object.freeze(GOLF_CART_TIERS.map((tier) => tier.id));

const BY_ID = new Map(GOLF_CART_TIERS.map((tier) => [tier.id, tier]));
const INITIAL_FLEET = Object.freeze([
  'basic', 'basic', 'standard', 'standard', 'premium', 'premium', 'high_end', 'luxury',
]);

export function golfCartTier(id) {
  return BY_ID.get(String(id || '')) || GOLF_CART_TIERS[0];
}

export function initialGolfCartTier(index) {
  return INITIAL_FLEET[Math.max(0, Math.floor(Number(index) || 0)) % INITIAL_FLEET.length];
}

export function nextGolfCartTier(id) {
  const tier = golfCartTier(id);
  return GOLF_CART_TIERS.find((candidate) => candidate.rank === tier.rank + 1) || null;
}

export function golfCartUpgradeCost(id) {
  const current = golfCartTier(id);
  const next = nextGolfCartTier(id);
  return next ? Math.round(Math.max(0, next.purchaseCost - current.purchaseCost * 0.55)) : null;
}
