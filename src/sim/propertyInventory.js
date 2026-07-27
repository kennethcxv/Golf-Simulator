// PROPERTY-SCOPED OWNED ITEM INVENTORY
//
// One durable item has exactly one ownership authority. Paid placeable orders
// enter `inTransit`; physical receiving moves them to `stored`; placement moves
// them to `placed`. Counts always conserve:
//
//   owned = inTransit + stored + placed
//
// The existing retail stock remains a separate system. Compatibility helpers
// mirror the six shipped decor SKUs while their physical cartons and current
// authored anchors are retained.

import { addRevenue } from './economy.js';
import {
  PLACEABLE_ITEM_CATALOG,
  placeableSpec,
  placeableSpecBySkuId,
} from '../data/placeableItems.js';
import { DECOR_SPOTS } from '../data/shopItems.js';

export const PROPERTY_INVENTORY_SCHEMA_VERSION = 2;
export const PROPERTY_INVENTORY_OPERATION_CAP = 80;
const HEALED_INVENTORIES = new WeakSet();

const nonNegativeInteger = (value) => (
  Number.isSafeInteger(value) && value >= 0 ? value : 0
);

const finiteMoney = (value, fallback = 0) => (
  Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : fallback
);

const clone = (value) => (value == null ? value : structuredClone(value));

function defaultPropertyId(state) {
  return state?.property?.id || `property:${Number.isFinite(state?.seed) ? state.seed : 'legacy'}`;
}

function inventoryShell(propertyId) {
  return {
    schemaVersion: PROPERTY_INVENTORY_SCHEMA_VERSION,
    propertyId,
    nextItemId: 1,
    nextPlacementId: 1,
    items: [],
    placements: [],
    pendingDeliveries: [],
    operations: [],
  };
}

function itemFromSpec(inventory, spec) {
  const item = {
    id: `owned-item:${inventory.nextItemId++}`,
    assetId: spec.assetId,
    skuId: spec.skuId || null,
    displayName: spec.displayName,
    category: spec.category,
    quantityOwned: 0,
    quantityPlaced: 0,
    quantityStored: 0,
    quantityInTransit: 0,
    variant: spec.defaultVariant || 'standard',
    condition: nonNegativeInteger(spec.defaultCondition ?? 100),
    purchasePrice: finiteMoney(spec.purchasePrice),
    sellValue: finiteMoney(spec.sellValue),
    placementRestrictions: clone(spec.placementRestrictions || {}),
    propertyId: inventory.propertyId,
    deliveryRequirement: clone(spec.deliveryRequirement || { required: false }),
    unlockRequirement: clone(spec.unlockRequirement || null),
    upgradeTier: nonNegativeInteger(spec.upgradeTier),
  };
  inventory.items.push(item);
  return item;
}

function recordFor(inventory, idOrSpec, create = false) {
  if (!inventory) return null;
  const lookup = typeof idOrSpec === 'object' && idOrSpec
    ? (idOrSpec.id || idOrSpec.assetId || idOrSpec.skuId)
    : idOrSpec;
  const direct = inventory.items.find((item) => (
    item.id === lookup || item.assetId === lookup || item.skuId === lookup
  ));
  if (direct || !create) return direct || null;
  const spec = typeof idOrSpec === 'object' && idOrSpec
    ? idOrSpec
    : placeableSpec(idOrSpec);
  return spec ? itemFromSpec(inventory, spec) : null;
}

function pendingTotal(inventory, itemId) {
  return inventory.pendingDeliveries
    .filter((entry) => entry.itemId === itemId)
    .reduce((sum, entry) => sum + nonNegativeInteger(entry.quantity), 0);
}

function nextNumericId(records, prefix) {
  return records.reduce((highest, record) => {
    const match = new RegExp(`^${prefix}:(\\d+)$`).exec(String(record?.id || ''));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
}

function normalizePlacementPose(pose = {}) {
  return {
    area: typeof pose.area === 'string' ? pose.area : 'clubhouse',
    mount: typeof pose.mount === 'string' ? pose.mount : 'floor',
    x: Number.isFinite(pose.x) ? pose.x : 0,
    y: Number.isFinite(pose.y) ? pose.y : 0,
    z: Number.isFinite(pose.z) ? pose.z : 0,
    ry: Number.isFinite(pose.ry) ? pose.ry : 0,
    surfaceId: typeof pose.surfaceId === 'string' ? pose.surfaceId : null,
    authoredSpot: Number.isInteger(pose.authoredSpot) ? pose.authoredSpot : null,
  };
}

function normalizeComponentStates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const [name, open] of Object.entries(value).slice(0, 80)) {
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(name) || typeof open !== 'boolean') continue;
    normalized[name] = open;
  }
  return normalized;
}

function normalizeRetailShelfStock(value) {
  const normalized = { schemaVersion: 1, zones: {} };
  const zones = value?.zones;
  if (!zones || typeof zones !== 'object' || Array.isArray(zones)) return normalized;
  for (const [zoneName, record] of Object.entries(zones).slice(0, 60)) {
    if (!/^SHELF_ZONE_(?:\d{2}|BAY\d{2}_LEVEL\d{2})$/.test(zoneName)) continue;
    if (!record || typeof record.skuId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(record.skuId)) continue;
    const quantity = nonNegativeInteger(record.quantity);
    const capacity = nonNegativeInteger(record.capacity);
    if (quantity < 1 || capacity < 1) continue;
    normalized.zones[zoneName] = {
      skuId: record.skuId,
      quantity: Math.min(quantity, capacity),
      capacity,
    };
  }
  return normalized;
}

function normalizeRetailShelfStorage(value) {
  const normalized = { schemaVersion: 1, zones: {} };
  const zones = value?.zones;
  if (!zones || typeof zones !== 'object' || Array.isArray(zones)) return normalized;
  for (const [zoneName, record] of Object.entries(zones).slice(0, 24)) {
    if (!/^STORAGE_ZONE_Bay\d{2}_Level\d{2}$/.test(zoneName)) continue;
    if (!record || typeof record.skuId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(record.skuId)) continue;
    const quantity = nonNegativeInteger(record.quantity);
    const capacity = nonNegativeInteger(record.capacity);
    if (quantity < 1 || capacity < 1) continue;
    normalized.zones[zoneName] = {
      skuId: record.skuId,
      quantity: Math.min(quantity, capacity),
      capacity,
    };
  }
  return normalized;
}

function retailShelfUnitCount(placement) {
  return Object.values(normalizeRetailShelfStock(placement?.retailShelfStock).zones)
    .reduce((sum, zone) => sum + zone.quantity, 0);
}

function retailShelfStoredUnitCount(placement) {
  return Object.values(normalizeRetailShelfStorage(placement?.retailShelfStorage).zones)
    .reduce((sum, zone) => sum + zone.quantity, 0);
}

const clampFinite = (value, min, max, fallback = 0) => (
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
);

function normalizeLightState(value, profile = null) {
  if (!profile) return null;
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const headCount = Math.max(0, Math.min(12, nonNegativeInteger(profile.adjustableHeads)));
  const savedHeads = Array.isArray(source.spotlights) ? source.spotlights : [];
  const defaultHeads = Array.isArray(profile.defaultAim) ? profile.defaultAim : [];
  const spotlights = Array.from({ length: headCount }, (_, index) => {
    const saved = savedHeads[index] && typeof savedHeads[index] === 'object' ? savedHeads[index] : {};
    const fallback = defaultHeads[index] && typeof defaultHeads[index] === 'object' ? defaultHeads[index] : {};
    return {
      yaw: clampFinite(saved.yaw, -Math.PI * 0.9, Math.PI * 0.9, clampFinite(fallback.yaw, -Math.PI * 0.9, Math.PI * 0.9)),
      tilt: clampFinite(saved.tilt, -Math.PI * 0.28, Math.PI * 0.28, clampFinite(fallback.tilt, -Math.PI * 0.28, Math.PI * 0.28)),
    };
  });
  return {
    isOn: typeof source.isOn === 'boolean' ? source.isOn : profile.defaultOn !== false,
    spotlights,
  };
}

function migrateLegacyDecor(state, inventory) {
  const shop = state?.shop;
  const renoDecor = Array.isArray(shop?.reno?.decor) ? shop.reno.decor : [];
  const carry = shop?.carry;
  const boxes = Array.isArray(shop?.deliveries?.boxes) ? shop.deliveries.boxes : [];
  const orders = Array.isArray(shop?.orders) ? shop.orders : [];

  for (const spec of PLACEABLE_ITEM_CATALOG) {
    const stored = nonNegativeInteger(shop?.inventory?.[spec.skuId]?.back);
    const placedEntries = renoDecor.filter((entry) => entry?.skuId === spec.skuId);
    const carried = carry?.skuId === spec.skuId ? nonNegativeInteger(carry.qty) : 0;
    const boxed = boxes
      .filter((box) => box?.skuId === spec.skuId)
      .reduce((sum, box) => sum + nonNegativeInteger(box.qty), 0);
    const ordered = orders
      .filter((order) => order?.skuId === spec.skuId)
      .reduce((sum, order) => sum + nonNegativeInteger(order.qty), 0);
    const inTransit = carried + boxed + ordered;
    if (stored + placedEntries.length + inTransit <= 0) continue;

    const item = itemFromSpec(inventory, spec);
    item.quantityStored = stored;
    item.quantityPlaced = placedEntries.length;
    item.quantityInTransit = inTransit;
    item.quantityOwned = stored + placedEntries.length + inTransit;

    for (const entry of placedEntries) {
      const spot = DECOR_SPOTS[spec.skuId]?.[entry.spot] || {};
      const placement = {
        id: `placement:${inventory.nextPlacementId++}`,
        itemId: item.id,
        assetId: item.assetId,
        propertyId: inventory.propertyId,
        variant: item.variant,
        condition: item.condition,
        componentStates: {},
        retailShelfStock: normalizeRetailShelfStock(null),
        retailShelfStorage: normalizeRetailShelfStorage(null),
        pose: normalizePlacementPose({
          area: 'clubhouse',
          mount: spot.mount,
          x: spot.x,
          z: spot.z,
          ry: spot.ry,
          surfaceId: `decor-anchor:${spec.skuId}:${entry.spot}`,
          authoredSpot: entry.spot,
        }),
      };
      inventory.placements.push(placement);
      entry.placementId = placement.id;
    }

    for (const order of orders.filter((entry) => entry?.skuId === spec.skuId)) {
      inventory.pendingDeliveries.push({
        sourceId: `shop-order:${order.id}`,
        itemId: item.id,
        quantity: nonNegativeInteger(order.qty),
      });
    }
    const loose = carried + boxed;
    if (loose > 0) {
      inventory.pendingDeliveries.push({
        sourceId: `legacy-transit:${spec.skuId}`,
        itemId: item.id,
        quantity: loose,
      });
    }
  }
}

function healInventory(state, inventory, propertyId) {
  inventory.schemaVersion = PROPERTY_INVENTORY_SCHEMA_VERSION;
  inventory.propertyId = propertyId;
  if (!Array.isArray(inventory.items)) inventory.items = [];
  if (!Array.isArray(inventory.placements)) inventory.placements = [];
  if (!Array.isArray(inventory.pendingDeliveries)) inventory.pendingDeliveries = [];
  if (!Array.isArray(inventory.operations)) inventory.operations = [];

  const itemIds = new Set();
  inventory.items = inventory.items.filter((item) => {
    if (!item || typeof item.id !== 'string' || itemIds.has(item.id)) return false;
    itemIds.add(item.id);
    const spec = placeableSpec(item.assetId) || placeableSpec(item.skuId);
    item.assetId = item.assetId || spec?.assetId || `legacy:${item.id}`;
    item.skuId = item.skuId || spec?.skuId || null;
    item.displayName = item.displayName || spec?.displayName || 'Legacy property item';
    item.category = item.category || spec?.category || 'decorations';
    item.variant = item.variant || spec?.defaultVariant || 'standard';
    item.condition = nonNegativeInteger(item.condition ?? spec?.defaultCondition ?? 100);
    item.purchasePrice = finiteMoney(item.purchasePrice, finiteMoney(spec?.purchasePrice));
    item.sellValue = finiteMoney(item.sellValue, finiteMoney(spec?.sellValue));
    item.placementRestrictions = clone(item.placementRestrictions || spec?.placementRestrictions || {});
    item.deliveryRequirement = clone(item.deliveryRequirement || spec?.deliveryRequirement || { required: false });
    item.unlockRequirement = clone(item.unlockRequirement ?? spec?.unlockRequirement ?? null);
    item.upgradeTier = nonNegativeInteger(item.upgradeTier ?? spec?.upgradeTier);
    item.propertyId = propertyId;
    item.quantityStored = nonNegativeInteger(item.quantityStored);
    item.quantityInTransit = nonNegativeInteger(item.quantityInTransit);
    return true;
  });

  const placementIds = new Set();
  inventory.placements = inventory.placements.filter((placement) => {
    if (!placement || typeof placement.id !== 'string' || placementIds.has(placement.id)) return false;
    const item = inventory.items.find((entry) => entry.id === placement.itemId);
    if (!item) return false;
    placementIds.add(placement.id);
    placement.assetId = item.assetId;
    placement.propertyId = propertyId;
    placement.variant = placement.variant || item.variant;
    placement.condition = nonNegativeInteger(placement.condition ?? item.condition);
    placement.componentStates = normalizeComponentStates(placement.componentStates);
    placement.retailShelfStock = normalizeRetailShelfStock(placement.retailShelfStock);
    placement.retailShelfStorage = normalizeRetailShelfStorage(placement.retailShelfStorage);
    const spec = placeableSpec(item.assetId) || placeableSpec(item.skuId);
    placement.lightState = normalizeLightState(placement.lightState, spec?.lightingProfile || null);
    placement.pose = normalizePlacementPose(placement.pose);
    return true;
  });

  inventory.pendingDeliveries = inventory.pendingDeliveries.filter((entry) => (
    entry && typeof entry.sourceId === 'string'
      && inventory.items.some((item) => item.id === entry.itemId)
      && nonNegativeInteger(entry.quantity) > 0
  )).map((entry) => ({
    sourceId: entry.sourceId,
    itemId: entry.itemId,
    quantity: nonNegativeInteger(entry.quantity),
  }));

  for (const item of inventory.items) {
    item.quantityPlaced = inventory.placements.filter((placement) => placement.itemId === item.id).length;
    const pending = pendingTotal(inventory, item.id);
    item.quantityInTransit = Math.max(item.quantityInTransit, pending);
    const accounted = item.quantityPlaced + item.quantityStored + item.quantityInTransit;
    item.quantityOwned = Math.max(nonNegativeInteger(item.quantityOwned), accounted);
    // A malformed legacy count never becomes a ghost unit. Any unaccounted
    // owned quantity remains explicitly in transit until received or repaired.
    item.quantityInTransit += item.quantityOwned - accounted;
  }

  inventory.operations = inventory.operations
    .filter((entry) => entry && typeof entry.id === 'string')
    .slice(-PROPERTY_INVENTORY_OPERATION_CAP);
  inventory.nextItemId = Math.max(
    nonNegativeInteger(inventory.nextItemId),
    nextNumericId(inventory.items, 'owned-item'),
  );
  inventory.nextPlacementId = Math.max(
    nonNegativeInteger(inventory.nextPlacementId),
    nextNumericId(inventory.placements, 'placement'),
  );
  return inventory;
}

export function ensurePropertyInventory(state, explicitPropertyId = null) {
  const propertyId = explicitPropertyId || defaultPropertyId(state);
  if (!state.propertyInventory || typeof state.propertyInventory !== 'object') {
    state.propertyInventory = inventoryShell(propertyId);
    migrateLegacyDecor(state, state.propertyInventory);
  }
  if (HEALED_INVENTORIES.has(state.propertyInventory)
      && state.propertyInventory.propertyId === propertyId) return state.propertyInventory;
  const healed = healInventory(state, state.propertyInventory, propertyId);
  HEALED_INVENTORIES.add(healed);
  return healed;
}

export function bindPropertyInventory(state, propertyId) {
  if (!state.property) state.property = {};
  state.property.id = propertyId;
  return ensurePropertyInventory(state, propertyId);
}

export function ownedPlaceableItems(state) {
  return ensurePropertyInventory(state).items;
}

export function ownedPlaceableItem(state, idOrAsset) {
  return recordFor(ensurePropertyInventory(state), idOrAsset, false);
}

export function placedPropertyItems(state) {
  return ensurePropertyInventory(state).placements;
}

function operationReplay(inventory, operationId) {
  if (!operationId) return null;
  return inventory.operations.find((entry) => entry.id === operationId)?.result || null;
}

function rememberOperation(inventory, operationId, kind, result) {
  if (!operationId) return;
  inventory.operations.push({ id: operationId, kind, result: clone(result) });
  if (inventory.operations.length > PROPERTY_INVENTORY_OPERATION_CAP) inventory.operations.shift();
}

export function registerPlaceablePurchase(state, idOrAsset, quantity, options = {}) {
  const inventory = ensurePropertyInventory(state);
  const qty = nonNegativeInteger(quantity);
  if (qty < 1) return { ok: false, reason: 'Purchase quantity must be a positive whole number.' };
  const spec = placeableSpec(idOrAsset);
  if (!spec) return { ok: false, reason: 'That item is not a property placeable.' };
  const sourceId = options.sourceId || null;
  if (sourceId) {
    const existing = inventory.pendingDeliveries.find((entry) => entry.sourceId === sourceId);
    if (existing) return { ok: true, replay: true, item: recordFor(inventory, existing.itemId), pending: existing };
  }
  const item = recordFor(inventory, spec, true);
  item.quantityOwned += qty;
  item.quantityInTransit += qty;
  if (Number.isFinite(options.purchasePrice)) item.purchasePrice = finiteMoney(options.purchasePrice);
  const pending = sourceId ? { sourceId, itemId: item.id, quantity: qty } : null;
  if (pending) inventory.pendingDeliveries.push(pending);
  return { ok: true, item, pending };
}

export function cancelPlaceablePurchase(state, sourceId) {
  const inventory = ensurePropertyInventory(state);
  const index = inventory.pendingDeliveries.findIndex((entry) => entry.sourceId === sourceId);
  if (index < 0) return { ok: false, reason: 'No pending property-item delivery has that source.' };
  const pending = inventory.pendingDeliveries[index];
  const item = recordFor(inventory, pending.itemId);
  if (!item || item.quantityInTransit < pending.quantity || item.quantityOwned < pending.quantity) {
    return { ok: false, reason: 'That property-item order is no longer fully cancellable.' };
  }
  inventory.pendingDeliveries.splice(index, 1);
  item.quantityInTransit -= pending.quantity;
  item.quantityOwned -= pending.quantity;
  return { ok: true, item, quantity: pending.quantity };
}

export function storeDeliveredPlaceables(state, idOrAsset, quantity) {
  const inventory = ensurePropertyInventory(state);
  const qty = nonNegativeInteger(quantity);
  const item = recordFor(inventory, idOrAsset, false);
  if (!item || qty < 1) return { ok: false, reason: 'No delivered property item to store.' };
  const moved = Math.min(qty, item.quantityInTransit);
  if (moved < 1) return { ok: false, reason: 'That property item is already accounted for.' };
  let left = moved;
  for (let index = 0; index < inventory.pendingDeliveries.length && left > 0;) {
    const pending = inventory.pendingDeliveries[index];
    if (pending.itemId !== item.id) {
      index++;
      continue;
    }
    const take = Math.min(left, pending.quantity);
    pending.quantity -= take;
    left -= take;
    if (pending.quantity <= 0) inventory.pendingDeliveries.splice(index, 1);
    else index++;
  }
  item.quantityInTransit -= moved;
  item.quantityStored += moved;
  return { ok: true, item, moved, untrackedTransit: left };
}

// Compatibility bridge for an old save/test that directly increments the
// shipped backroom count. It can only add genuinely observed physical units;
// it never lowers or deletes the property authority.
export function importLegacyStoredPlaceables(state, skuId, physicalStored) {
  const spec = placeableSpecBySkuId(skuId);
  if (!spec) return { ok: false, reason: 'Not a placeable SKU.' };
  const inventory = ensurePropertyInventory(state);
  const item = recordFor(inventory, spec, true);
  const target = nonNegativeInteger(physicalStored);
  if (target <= item.quantityStored) return { ok: true, item, imported: 0 };
  const delta = target - item.quantityStored;
  const fromTransit = Math.min(delta, item.quantityInTransit);
  if (fromTransit > 0) storeDeliveredPlaceables(state, item.id, fromTransit);
  const untracked = delta - fromTransit;
  if (untracked > 0) {
    item.quantityStored += untracked;
    item.quantityOwned += untracked;
  }
  return { ok: true, item, imported: delta };
}

export function withdrawStoredPlaceables(state, idOrAsset, quantity) {
  const item = ownedPlaceableItem(state, idOrAsset);
  const qty = nonNegativeInteger(quantity);
  if (!item || qty < 1 || item.quantityStored < qty) {
    return { ok: false, reason: 'That many property items are not in storage.' };
  }
  item.quantityStored -= qty;
  item.quantityInTransit += qty;
  return { ok: true, item, moved: qty };
}

export function placeOwnedItem(state, idOrAsset, pose, options = {}) {
  const inventory = ensurePropertyInventory(state);
  const item = recordFor(inventory, idOrAsset, false);
  if (!item || item.quantityStored < 1) return { ok: false, reason: 'None of that item is in property storage.' };
  const normalized = normalizePlacementPose(pose);
  const mounts = item.placementRestrictions?.mounts;
  if (Array.isArray(mounts) && mounts.length && !mounts.includes(normalized.mount)) {
    return { ok: false, reason: `That item cannot be placed on a ${normalized.mount} surface.` };
  }
  const areas = item.placementRestrictions?.propertyAreas;
  if (Array.isArray(areas) && areas.length && !areas.includes(normalized.area)) {
    return { ok: false, reason: `That item cannot be placed in ${normalized.area}.` };
  }
  const placement = {
    id: `placement:${inventory.nextPlacementId++}`,
    itemId: item.id,
    assetId: item.assetId,
    propertyId: inventory.propertyId,
    variant: options.variant || item.variant,
    condition: nonNegativeInteger(options.condition ?? item.condition),
    componentStates: normalizeComponentStates(options.componentStates),
    retailShelfStock: normalizeRetailShelfStock(options.retailShelfStock),
    retailShelfStorage: normalizeRetailShelfStorage(options.retailShelfStorage),
    lightState: normalizeLightState(options.lightState, placeableSpec(item.assetId)?.lightingProfile || null),
    pose: normalized,
  };
  inventory.placements.push(placement);
  item.quantityStored -= 1;
  item.quantityPlaced += 1;
  return { ok: true, item, placement };
}

export function setPlacementComponentState(state, placementId, componentName, open) {
  const inventory = ensurePropertyInventory(state);
  const placement = inventory.placements.find((entry) => entry.id === placementId);
  if (!placement) return { ok: false, reason: 'No placed property item has that ID.' };
  if (typeof componentName !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(componentName)) {
    return { ok: false, reason: 'That furniture component name is invalid.' };
  }
  if (typeof open !== 'boolean') return { ok: false, reason: 'Furniture component state must be open or closed.' };
  placement.componentStates = normalizeComponentStates(placement.componentStates);
  placement.componentStates[componentName] = open;
  return { ok: true, placement, componentName, open };
}

export function placementRetailShelfStock(state, placementId) {
  const placement = ensurePropertyInventory(state).placements.find((entry) => entry.id === placementId);
  if (!placement) return null;
  placement.retailShelfStock = normalizeRetailShelfStock(placement.retailShelfStock);
  return placement.retailShelfStock;
}

export function placementRetailShelfStorage(state, placementId) {
  const placement = ensurePropertyInventory(state).placements.find((entry) => entry.id === placementId);
  if (!placement) return null;
  placement.retailShelfStorage = normalizeRetailShelfStorage(placement.retailShelfStorage);
  return placement.retailShelfStorage;
}

export function placementLightState(state, placementId) {
  const inventory = ensurePropertyInventory(state);
  const placement = inventory.placements.find((entry) => entry.id === placementId);
  if (!placement) return null;
  const spec = placeableSpec(placement.assetId);
  placement.lightState = normalizeLightState(placement.lightState, spec?.lightingProfile || null);
  return placement.lightState;
}

export function setPlacementLightPower(state, placementId, isOn) {
  if (typeof isOn !== 'boolean') return { ok: false, reason: 'Light power state must be on or off.' };
  const inventory = ensurePropertyInventory(state);
  const placement = inventory.placements.find((entry) => entry.id === placementId);
  if (!placement) return { ok: false, reason: 'No placed property item has that ID.' };
  const spec = placeableSpec(placement.assetId);
  if (!spec?.lightingProfile) return { ok: false, reason: 'That property item is not a controllable light.' };
  placement.lightState = normalizeLightState(placement.lightState, spec.lightingProfile);
  placement.lightState.isOn = isOn;
  return { ok: true, placement, isOn };
}

export function setPlacementSpotlightAim(state, placementId, headIndex, yaw, tilt) {
  const inventory = ensurePropertyInventory(state);
  const placement = inventory.placements.find((entry) => entry.id === placementId);
  if (!placement) return { ok: false, reason: 'No placed property item has that ID.' };
  const spec = placeableSpec(placement.assetId);
  const profile = spec?.lightingProfile;
  const index = Number(headIndex);
  if (!profile || !Number.isInteger(index) || index < 0 || index >= (profile.adjustableHeads || 0)) {
    return { ok: false, reason: 'That spotlight head does not exist.' };
  }
  if (!Number.isFinite(yaw) || !Number.isFinite(tilt)) {
    return { ok: false, reason: 'Spotlight aim must use finite angles.' };
  }
  placement.lightState = normalizeLightState(placement.lightState, profile);
  placement.lightState.spotlights[index] = {
    yaw: clampFinite(yaw, -Math.PI * 0.9, Math.PI * 0.9),
    tilt: clampFinite(tilt, -Math.PI * 0.28, Math.PI * 0.28),
  };
  return { ok: true, placement, headIndex: index, aim: clone(placement.lightState.spotlights[index]) };
}

export function moveOwnedPlacement(state, placementId, pose) {
  const inventory = ensurePropertyInventory(state);
  const placement = inventory.placements.find((entry) => entry.id === placementId);
  if (!placement) return { ok: false, reason: 'No placed property item has that ID.' };
  const item = recordFor(inventory, placement.itemId);
  const normalized = normalizePlacementPose(pose);
  if (item?.placementRestrictions?.mounts?.length
      && !item.placementRestrictions.mounts.includes(normalized.mount)) {
    return { ok: false, reason: `That item cannot be placed on a ${normalized.mount} surface.` };
  }
  const before = clone(placement.pose);
  placement.pose = normalized;
  return { ok: true, item, placement, before };
}

export function storeOwnedPlacement(state, placementId) {
  const inventory = ensurePropertyInventory(state);
  const index = inventory.placements.findIndex((entry) => entry.id === placementId);
  if (index < 0) return { ok: false, reason: 'No placed property item has that ID.' };
  const placement = inventory.placements[index];
  const item = recordFor(inventory, placement.itemId);
  if (!item) return { ok: false, reason: 'The placement has no owned item.' };
  const stockedUnits = retailShelfUnitCount(placement);
  const storedUnits = retailShelfStoredUnitCount(placement);
  if (stockedUnits > 0 || storedUnits > 0) {
    const contents = [
      stockedUnits > 0 ? `${stockedUnits} displayed product${stockedUnits === 1 ? '' : 's'}` : null,
      storedUnits > 0 ? `${storedUnits} cabinet product${storedUnits === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' and ');
    return {
      ok: false,
      reason: `Empty this shelf before packing it up - ${contents} remain.`,
    };
  }
  inventory.placements.splice(index, 1);
  item.quantityPlaced = Math.max(0, item.quantityPlaced - 1);
  item.quantityStored += 1;
  return { ok: true, item, placement };
}

export function sellOwnedItem(state, idOrAsset, options = {}) {
  const inventory = ensurePropertyInventory(state);
  const replay = operationReplay(inventory, options.operationId);
  if (replay) return { ...clone(replay), replay: true };
  let item = recordFor(inventory, idOrAsset, false);
  if (options.placementId) {
    const stored = storeOwnedPlacement(state, options.placementId);
    if (!stored.ok) return stored;
    item = stored.item;
  }
  const quantity = nonNegativeInteger(options.quantity ?? 1);
  if (!item || quantity < 1 || item.quantityStored < quantity) {
    return { ok: false, reason: 'That many property items are not available to sell.' };
  }
  item.quantityStored -= quantity;
  item.quantityOwned -= quantity;
  const payout = finiteMoney(item.sellValue * quantity);
  if (payout > 0) {
    if (state.ledger) addRevenue(state, 'assetSales', payout);
    else state.cash = finiteMoney((Number.isFinite(state.cash) ? state.cash : 0) + payout);
  }
  const result = { ok: true, itemId: item.id, quantity, payout };
  rememberOperation(inventory, options.operationId, 'sell', result);
  return result;
}

export function propertyInventoryTotals(state) {
  const inventory = ensurePropertyInventory(state);
  return inventory.items.reduce((totals, item) => ({
    owned: totals.owned + item.quantityOwned,
    stored: totals.stored + item.quantityStored,
    placed: totals.placed + item.quantityPlaced,
    inTransit: totals.inTransit + item.quantityInTransit,
  }), { owned: 0, stored: 0, placed: 0, inTransit: 0 });
}
