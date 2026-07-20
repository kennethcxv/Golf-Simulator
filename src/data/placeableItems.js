// PROPERTY PLACEABLE CATALOG
//
// Retail merchandise and property improvements are deliberately separate. A
// polo is counted by the pro-shop stock system; a lounge, plant, or light is a
// durable property asset that can be in transit, stored, or placed. The six
// existing physical decor lines are the first production slice through the
// shared ownership system. Their current authored anchors remain valid while
// the broader free-placement catalog grows on this same contract.

import { DECOR_SPOTS, SHOP_CATALOG } from './shopItems.js';

const decor = SHOP_CATALOG.filter((sku) => sku.cat === 'decor');

const CATEGORY_BY_SKU = Object.freeze({
  rug1: 'clubhouse-furniture',
  plant1: 'decorations',
  poster1: 'decorations',
  board1: 'office',
  light1: 'utilities',
  lounge1: 'clubhouse-furniture',
});

const DELIVERY_CLASS_BY_SKU = Object.freeze({
  rug1: 'furniture',
  plant1: 'small-fixture',
  poster1: 'small-fixture',
  board1: 'small-fixture',
  light1: 'small-fixture',
  lounge1: 'large-furniture',
});

function authoredMounts(skuId) {
  return [...new Set((DECOR_SPOTS[skuId] || []).map((spot) => spot.mount))];
}

export const PLACEABLE_ITEM_CATALOG = Object.freeze(decor.map((sku) => Object.freeze({
  assetId: `shop-decor:${sku.id}`,
  skuId: sku.id,
  displayName: sku.name,
  category: CATEGORY_BY_SKU[sku.id] || 'decorations',
  variants: Object.freeze(['standard']),
  defaultVariant: 'standard',
  defaultCondition: 100,
  purchasePrice: sku.cost,
  sellValue: Math.round(sku.cost * 0.6 * 100) / 100,
  placementRestrictions: Object.freeze({
    propertyAreas: Object.freeze(['clubhouse']),
    mounts: Object.freeze(authoredMounts(sku.id)),
    requiresAuthoredBounds: true,
    preserveCustomerRoutes: true,
    preserveDoorClearance: true,
    preserveCheckoutAccess: true,
  }),
  deliveryRequirement: Object.freeze({
    required: true,
    deliveryClass: DELIVERY_CLASS_BY_SKU[sku.id] || 'small-fixture',
    physicalReceiving: true,
  }),
  unlockRequirement: Object.freeze({ shopTier: sku.tier }),
  upgradeTier: sku.tier,
})));

const BY_ASSET = new Map(PLACEABLE_ITEM_CATALOG.map((spec) => [spec.assetId, spec]));
const BY_SKU = new Map(PLACEABLE_ITEM_CATALOG.map((spec) => [spec.skuId, spec]));

export function placeableSpecByAssetId(assetId) {
  return BY_ASSET.get(assetId) || null;
}

export function placeableSpecBySkuId(skuId) {
  return BY_SKU.get(skuId) || null;
}

export function placeableSpec(id) {
  return placeableSpecByAssetId(id) || placeableSpecBySkuId(id);
}

