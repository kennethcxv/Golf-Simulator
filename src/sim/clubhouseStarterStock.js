// PINE HILLS STARTER RETAIL ENTITLEMENT
//
// The furnished clubhouse conveys one display-capacity of its starter lines.
// Half is visible on the authored fixtures and the remainder is physical stock
// in three unopened cartons. The lot ledger remains the inventory authority;
// this module only grants a missing entitlement once and never replaces paid
// or player-owned stock that is already present.

import { skuById } from '../data/shopItems.js';
import { capacityOf } from '../data/fixtureSlots.js';
import { planShipment } from '../data/boxes.js';
import {
  FLOOR_BOX_SURFACE_ID,
  deliveryShelfSurfaceId,
} from '../data/boxPlacementSurfaces.js';
import { previewBoxPlacement } from './boxPlacement.js';
import {
  BOX_LIFECYCLE,
  BOX_SCHEMA_VERSION,
  ensureDeliveries,
} from './deliveries.js';
import {
  INVENTORY_STAGE,
  adoptExternalInventory,
  ensureInventoryLifecycle,
  inventoryPosition,
} from './inventoryLifecycle.js';
import {
  CLUBHOUSE_LAYOUT_VERSION,
  STARTER_RESTOCK_VERSION,
  ensureClubhouseRestoration,
  restorationAction,
} from './clubhouseRestoration.js';

export { STARTER_RESTOCK_VERSION };

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

export const STARTER_RETAIL_GROUPS = freeze({
  balls: ['balls1', 'balls2', 'balls3'],
  accessories: [
    'tees1', 'towel1', 'marker1', 'divot1', 'range2',
    'sunglasses2', 'bottle1', 'umb1', 'scorecard1',
  ],
  headwear: ['cap1', 'cap2', 'visor1'],
  apparel: ['glove1', 'glove2', 'sock1', 'polo1', 'polo2', 'pants2', 'shorts1', 'jacket2'],
  cooler: ['water1', 'sportdrink2', 'soda1'],
  snacks: ['chips1', 'bar2', 'crackers1', 'snack1'],
});

export const STARTER_RETAIL_SKU_IDS = Object.freeze(
  Object.values(STARTER_RETAIL_GROUPS).flat(),
);

export const STARTER_RETAIL_ENTITLEMENT = freeze(Object.fromEntries(
  STARTER_RETAIL_SKU_IDS.map((skuId) => [skuId, capacityOf(skuId)]),
));

export const STARTER_CARTON_SPECS = freeze([
  {
    id: 'balls-accessories',
    label: 'BALLS / ACCESSORIES',
    representativeSkuId: 'balls1',
    groups: ['balls', 'accessories'],
    nearFixtureIds: ['shelf_balls', 'shelf_acc'],
    preferredFloorTargets: [
      { x: -7.30, z: -4.40, ry: 0 },
      { x: -6.75, z: -4.35, ry: 0 },
      { x: -4.35, z: -4.35, ry: 0 },
    ],
    shelfSurfaceId: deliveryShelfSurfaceId(1, 1),
  },
  {
    id: 'apparel-headwear',
    label: 'APPAREL / HEADWEAR',
    representativeSkuId: 'polo1',
    groups: ['apparel', 'headwear'],
    nearFixtureIds: ['shelf_small', 'hatstand'],
    preferredFloorTargets: [
      { x: 0.50, z: -4.35, ry: 0 },
      { x: 0.25, z: -4.25, ry: 0 },
      { x: 2.50, z: -4.35, ry: 0 },
    ],
    shelfSurfaceId: deliveryShelfSurfaceId(2, 1),
  },
  {
    id: 'drinks-snacks',
    label: 'DRINKS / SNACKS',
    representativeSkuId: 'water1',
    groups: ['cooler', 'snacks'],
    nearFixtureIds: ['cold_drinks', 'snackrack'],
    preferredFloorTargets: [
      { x: -7.00, z: 5.00, ry: 0 },
      { x: -6.50, z: 4.85, ry: 0 },
      { x: -7.70, z: 4.20, ry: 0 },
    ],
    shelfSurfaceId: deliveryShelfSurfaceId(1, 2),
  },
]);

// These are real units from the two named inventory lines, not dressing props.
// The unit ordinal is evaluated only after the visible shelf quantity is
// clamped, so an empty or depleted line can never retain a phantom package.
export const STARTER_TIPPED_PACKAGES = freeze([
  {
    skuId: 'balls1',
    unitIndex: 3,
    rotation: { x: 0, y: -0.03, z: -0.18 },
  },
  {
    skuId: 'chips1',
    unitIndex: 1,
    rotation: { x: 0.04, y: 0, z: 0.20 },
  },
]);

const STARTER_TIP_BY_SKU = new Map(
  STARTER_TIPPED_PACKAGES.map((entry) => [entry.skuId, entry]),
);

const whole = (value) => Math.max(0, Math.floor(Number(value) || 0));

export function starterRetailQuantity(state, skuId) {
  if (!STARTER_RETAIL_SKU_IDS.includes(skuId)) return 0;
  const position = inventoryPosition(state, skuId);
  return whole(position.onHand) + whole(position.incoming);
}

export function starterRetailAccounting(state, skuId) {
  if (!STARTER_RETAIL_SKU_IDS.includes(skuId)) return null;
  const entitled = STARTER_RETAIL_ENTITLEMENT[skuId];
  const present = starterRetailQuantity(state, skuId);
  return {
    skuId,
    entitled,
    present,
    missing: Math.max(0, entitled - present),
    shelfTarget: Math.floor(entitled * 0.5),
  };
}

function starterPresentationEnabled(state) {
  return whole(state?.campaign?.furnishedStartVersion) > 0
    && whole(state?.shop?.reno?.starterRestockVersion) >= STARTER_RESTOCK_VERSION;
}

function deliberateSlotOrder(capacity) {
  const spaced = [];
  const gaps = [];
  for (let slotIndex = 0; slotIndex < capacity; slotIndex += 1) {
    (slotIndex % 2 === 0 ? spaced : gaps).push(slotIndex);
  }
  return [...spaced, ...gaps];
}

// A deterministic projection from real shelf inventory to authored sockets.
// Alternating sockets are filled first, producing readable gaps at the
// furnished half-stock level; normal restocking then fills those gaps until
// the same authored capacity is full. Only two inventory-backed units carry a
// tipped pose, and those poses disappear naturally if their line is depleted.
export function starterRetailPresentation(state, skuId, quantity = null) {
  if (!starterPresentationEnabled(state) || !STARTER_RETAIL_SKU_IDS.includes(skuId)) return null;
  const capacity = STARTER_RETAIL_ENTITLEMENT[skuId];
  const sourceQuantity = quantity == null
    ? state?.shop?.inventory?.[skuId]?.shelf
    : quantity;
  const visibleQuantity = Math.min(capacity, whole(sourceQuantity));
  const tipSpec = STARTER_TIP_BY_SKU.get(skuId) || null;
  const items = deliberateSlotOrder(capacity)
    .slice(0, visibleQuantity)
    .map((slotIndex, unitIndex) => ({
      skuId,
      unitIndex,
      slotIndex,
      tip: tipSpec?.unitIndex === unitIndex ? { ...tipSpec.rotation } : null,
    }));
  return {
    skuId,
    capacity,
    visibleQuantity,
    slotIndices: items.map((item) => item.slotIndex),
    items,
  };
}

export function starterRetailPresentationSnapshot(state) {
  const lines = STARTER_RETAIL_SKU_IDS
    .map((skuId) => starterRetailPresentation(state, skuId))
    .filter(Boolean);
  return {
    lines,
    visibleQuantity: lines.reduce((sum, line) => sum + line.visibleQuantity, 0),
    tippedPackages: lines.flatMap((line) => line.items.filter((item) => item.tip)),
  };
}

function uniqueStarterLineId(state, baseLineId) {
  const lifecycle = ensureInventoryLifecycle(state);
  const used = new Set(lifecycle.lots.map((lot) => lot.lineId).filter(Boolean));
  if (!used.has(baseLineId)) return baseLineId;
  let grant = 2;
  while (used.has(`${baseLineId}:grant-${grant}`)) grant += 1;
  return `${baseLineId}:grant-${grant}`;
}

function addShelfEntitlement(state, skuId, quantity) {
  if (quantity <= 0) return { ok: true, allocations: [] };
  const lineId = uniqueStarterLineId(
    state,
    `pine-hills-starter-shelf:${STARTER_RESTOCK_VERSION}:${skuId}`,
  );
  const adopted = adoptExternalInventory(state, {
    skuId,
    quantity,
    stage: INVENTORY_STAGE.SHELF,
    lineId,
    note: 'Pine Hills conveyed starter display stock',
  });
  if (!adopted.ok) return adopted;
  state.shop.inventory[skuId].shelf += quantity;
  return adopted;
}

function cartonMetadata(skuId) {
  const sku = skuById(skuId);
  const box = planShipment(sku, 1).boxes[0];
  return { sku, box };
}

function applyStarterCartonPlacement(carton, result, spec, kind) {
  if (!result?.ok || !result.target) return false;
  carton.loc = result.target.loc || 'world';
  carton.currentLocation = carton.loc;
  carton.surfaceId = result.target.surfaceId;
  carton.x = result.target.x;
  carton.z = result.target.z;
  carton.ry = result.target.ry;
  carton.starterPlacement = {
    kind,
    validated: true,
    nearFixtureIds: [...spec.nearFixtureIds],
  };
  return true;
}

function placeStarterCarton(state, carton, spec) {
  for (const pose of spec.preferredFloorTargets) {
    const result = previewBoxPlacement(state, carton, {
      kind: 'surface',
      surfaceId: FLOOR_BOX_SURFACE_ID,
      ...pose,
    });
    if (applyStarterCartonPlacement(carton, result, spec, 'retail-adjacent-floor')) return;
  }

  const fallback = previewBoxPlacement(state, carton, spec.shelfSurfaceId);
  if (applyStarterCartonPlacement(carton, fallback, spec, 'stockroom-shelf-fallback')) return;
  carton.starterPlacement = {
    kind: 'legacy-stockroom-fallback',
    validated: false,
    nearFixtureIds: [...spec.nearFixtureIds],
  };
}

function makeStarterCarton(state, spec, entries) {
  if (!entries.length) return null;
  const deliveries = state.shop.deliveries;
  const id = deliveries.nextBoxId++;
  const starterCartonOrdinal = STARTER_CARTON_SPECS.indexOf(spec) + 1;
  const contents = [];
  let quantity = 0;
  let weight = 1.1;
  for (const entry of entries) {
    const lineId = uniqueStarterLineId(
      state,
      `pine-hills-starter-carton:${STARTER_RESTOCK_VERSION}:${spec.id}:${entry.skuId}`,
    );
    const adopted = adoptExternalInventory(state, {
      skuId: entry.skuId,
      quantity: entry.quantity,
      stage: INVENTORY_STAGE.DELIVERED_UNOPENED,
      lineId,
      note: `${spec.label} conveyed starter carton`,
    });
    if (!adopted.ok) throw new Error(adopted.reason || `Could not grant ${entry.skuId}`);
    for (const allocation of adopted.allocations) {
      contents.push({
        lineId,
        lotId: allocation.lotId,
        skuId: entry.skuId,
        quantity: allocation.quantity,
        remainingQuantity: allocation.quantity,
      });
    }
    quantity += entry.quantity;
    weight += (skuById(entry.skuId)?.lb || 0) * entry.quantity;
  }

  const { sku, box: packaging } = cartonMetadata(spec.representativeSkuId);
  const roundedWeight = Math.round(weight * 10) / 10;
  const carton = {
    id,
    persistentId: `box-${id}`,
    skuId: spec.representativeSkuId,
    orderId: null,
    parentOrderId: null,
    qty: quantity,
    initialQty: quantity,
    initialQuantity: quantity,
    remainingQuantity: quantity,
    cap: quantity,
    lb: roundedWeight,
    weightClass: roundedWeight >= 40 ? 'heavy' : roundedWeight >= 16 ? 'medium' : 'light',
    box: packaging.kind,
    fragile: entries.some((entry) => !!skuById(entry.skuId)?.fragile),
    longProduct: !!packaging.longProduct,
    familyId: packaging.familyId,
    layoutId: packaging.layoutId,
    shellId: packaging.shellId,
    modelId: packaging.modelId,
    packingState: packaging.packingState,
    packingOrientation: packaging.packingOrientation,
    contentScale: packaging.contentScale,
    supplierId: 'pine-hills-conveyance',
    supplier: 'Pine Hills Municipal Golf',
    loc: 'world',
    currentLocation: 'world',
    surfaceId: spec.shelfSurfaceId,
    x: 0,
    z: 0,
    ry: 0,
    currentCarrier: null,
    contents,
    tape: 0,
    cutProgress: 0,
    tapeSegments: { centre: 0, left: 0, right: 0 },
    flaps: [0, 0],
    flapProgress: [0, 0, 0, 0],
    openingProgress: 0,
    flattenProgress: 0,
    openedState: 'unopened',
    inventoryOpened: false,
    damageState: 'intact',
    disposalState: 'active',
    flat: false,
    lifecycle: BOX_LIFECYCLE.SEALED,
    schemaVersion: BOX_SCHEMA_VERSION,
    starterRestockVersion: STARTER_RESTOCK_VERSION,
    starterCartonId: spec.id,
    starterCartonOrdinal,
    starterCartonCount: STARTER_CARTON_SPECS.length,
    assortmentLabel: spec.label,
    representativeName: sku.name,
  };
  placeStarterCarton(state, carton, spec);
  deliveries.boxes.push(carton);
  return carton;
}

export function ensureStarterRetailStock(state) {
  if (!state?.shop?.inventory) return { ok: false, changed: false, reason: 'Shop inventory is unavailable.' };
  const reno = ensureClubhouseRestoration(state);
  if (!reno) return { ok: false, changed: false, reason: 'Clubhouse restoration is unavailable.' };
  if (reno.starterRestockVersion >= STARTER_RESTOCK_VERSION) {
    return { ok: true, changed: false, version: reno.starterRestockVersion, cartons: [] };
  }

  ensureDeliveries(state);
  ensureInventoryLifecycle(state);
  const remainingBySku = {};
  const shelfAdded = {};
  for (const skuId of STARTER_RETAIL_SKU_IDS) {
    const accounting = starterRetailAccounting(state, skuId);
    const shelfNow = whole(state.shop.inventory[skuId]?.shelf);
    const toShelf = Math.min(accounting.missing, Math.max(0, accounting.shelfTarget - shelfNow));
    const added = addShelfEntitlement(state, skuId, toShelf);
    if (!added.ok) return { ok: false, changed: Object.keys(shelfAdded).length > 0, reason: added.reason };
    if (toShelf > 0) shelfAdded[skuId] = toShelf;
    remainingBySku[skuId] = accounting.missing - toShelf;
  }

  const cartons = [];
  for (const spec of STARTER_CARTON_SPECS) {
    const entries = spec.groups.flatMap((groupId) => (
      STARTER_RETAIL_GROUPS[groupId]
        .filter((skuId) => remainingBySku[skuId] > 0)
        .map((skuId) => ({ skuId, quantity: remainingBySku[skuId] }))
    ));
    const carton = makeStarterCarton(state, spec, entries);
    if (carton) cartons.push(carton);
  }

  reno.starterRestockVersion = STARTER_RESTOCK_VERSION;
  reno.clubhouseLayoutVersion = Math.max(
    CLUBHOUSE_LAYOUT_VERSION,
    whole(reno.clubhouseLayoutVersion),
  );
  return {
    ok: true,
    changed: cartons.length > 0 || Object.keys(shelfAdded).length > 0,
    version: STARTER_RESTOCK_VERSION,
    shelfAdded,
    cartons,
  };
}

export function starterRestockGroupComplete(state, groupId) {
  const skuIds = STARTER_RETAIL_GROUPS[groupId];
  return !!skuIds && skuIds.every((skuId) => (
    whole(state?.shop?.inventory?.[skuId]?.shelf) >= STARTER_RETAIL_ENTITLEMENT[skuId]
  ));
}

export function syncStarterRestockMilestones(state, skuId = null) {
  const reno = ensureClubhouseRestoration(state);
  if (!reno || reno.clubhouseLayoutVersion < CLUBHOUSE_LAYOUT_VERSION) return [];
  const groupIds = Object.keys(STARTER_RETAIL_GROUPS).filter((groupId) => (
    !skuId || STARTER_RETAIL_GROUPS[groupId].includes(skuId)
  ));
  const results = [];
  for (const groupId of groupIds) {
    if (!reno.restockMilestones[groupId] && starterRestockGroupComplete(state, groupId)) {
      results.push(restorationAction(state, {
        type: 'complete-restock-milestone',
        groupId,
      }));
    }
  }
  return results;
}
