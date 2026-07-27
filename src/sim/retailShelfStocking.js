// Dynamic stock ownership for player-placed retail shelving.
//
// Global `inventory[sku].shelf` remains the simulation/accounting projection.
// A placement's zone records only assign a subset of those real shelf units to
// authored transforms so the renderer never invents duplicate merchandise.

import { RETAIL_CATS, skuById } from '../data/shopItems.js';
import { placeableSpec } from '../data/placeableItems.js';
import {
  placedPropertyItems,
  placementRetailShelfStock,
  placementRetailShelfStorage,
} from './propertyInventory.js';
import {
  armRoom,
  carriedGoods,
  moveCarriedToShelf,
  setCarry,
  storeInBack,
  takeFromBack,
} from './stocking.js';
import {
  INVENTORY_STAGE,
  moveInventory,
} from './inventoryLifecycle.js';

const DISPLAY_CATEGORIES = new Set(['balls', 'apparel', 'accessories', 'provisions']);

function shelfContext(state, placementId) {
  const placement = placedPropertyItems(state).find((entry) => entry.id === placementId);
  const spec = placement ? placeableSpec(placement.assetId) : null;
  const profile = spec?.functionalProfile;
  if (!placement || spec?.category !== 'freestanding-shelving' || !profile?.shelfZones) return null;
  const zoneNames = profile.shelfZones === 3
    ? Array.from({ length: 3 }, (_, index) => `SHELF_ZONE_${String(index + 1).padStart(2, '0')}`)
    : Array.from({ length: 15 }, (_, index) => {
      const bay = Math.floor(index / 5) + 1;
      const level = (index % 5) + 1;
      return `SHELF_ZONE_BAY${String(bay).padStart(2, '0')}_LEVEL${String(level).padStart(2, '0')}`;
    });
  const stock = placementRetailShelfStock(state, placementId);
  const valid = new Set(zoneNames);
  for (const name of Object.keys(stock.zones)) {
    if (!valid.has(name)) delete stock.zones[name];
  }
  return {
    placement,
    spec,
    profile,
    stock,
    zoneNames,
    zoneCapacity: Math.max(1, Number(profile.zoneCapacity) || 1),
  };
}

function recordsAcrossShelves(state) {
  const records = [];
  for (const placement of placedPropertyItems(state).slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const context = shelfContext(state, placement.id);
    if (!context) continue;
    for (const zoneName of context.zoneNames) {
      const record = context.stock.zones[zoneName];
      if (record) records.push({ placementId: placement.id, zoneName, record });
    }
  }
  return records;
}

function storageContext(state, placementId) {
  const placement = placedPropertyItems(state).find((entry) => entry.id === placementId);
  const spec = placement ? placeableSpec(placement.assetId) : null;
  const profile = spec?.functionalProfile;
  const count = Math.max(0, Number(profile?.storageZones) || 0);
  if (!placement || spec?.category !== 'freestanding-shelving' || count < 1) return null;
  const zoneNames = Array.from({ length: count }, (_, index) => {
    const bay = Math.floor(index / 2) + 1;
    const level = (index % 2) + 1;
    return `STORAGE_ZONE_Bay${String(bay).padStart(2, '0')}_Level${String(level).padStart(2, '0')}`;
  });
  const storage = placementRetailShelfStorage(state, placementId);
  const valid = new Set(zoneNames);
  for (const name of Object.keys(storage.zones)) {
    if (!valid.has(name)) delete storage.zones[name];
  }
  return {
    placement,
    spec,
    profile,
    storage,
    zoneNames,
    zoneCapacity: Math.max(1, Number(profile.storageZoneCapacity) || 6),
  };
}

function recordsAcrossStorage(state) {
  const records = [];
  for (const placement of placedPropertyItems(state).slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const context = storageContext(state, placement.id);
    if (!context) continue;
    for (const zoneName of context.zoneNames) {
      const record = context.storage.zones[zoneName];
      if (record) records.push({ placementId: placement.id, zoneName, record });
    }
  }
  return records;
}

// Customer sales debit the global shelf projection. Reconciliation consumes
// dynamic assignments only after unassigned/fixed-fixture units are exhausted.
export function reconcileRetailShelfStock(state) {
  const bySku = new Map();
  for (const entry of recordsAcrossShelves(state)) {
    if (!bySku.has(entry.record.skuId)) bySku.set(entry.record.skuId, []);
    bySku.get(entry.record.skuId).push(entry);
  }
  for (const [skuId, entries] of bySku) {
    let remaining = Math.max(0, Number(state.shop?.inventory?.[skuId]?.shelf) || 0);
    for (const entry of entries) {
      const kept = Math.min(entry.record.quantity, remaining);
      remaining -= kept;
      if (kept > 0) entry.record.quantity = kept;
      else {
        const context = shelfContext(state, entry.placementId);
        if (context) delete context.stock.zones[entry.zoneName];
      }
    }
  }
}

export function reconcileRetailShelfStorage(state) {
  const bySku = new Map();
  for (const entry of recordsAcrossStorage(state)) {
    if (!bySku.has(entry.record.skuId)) bySku.set(entry.record.skuId, []);
    bySku.get(entry.record.skuId).push(entry);
  }
  for (const [skuId, entries] of bySku) {
    let remaining = Math.max(0, Number(state.shop?.inventory?.[skuId]?.back) || 0);
    for (const entry of entries) {
      const kept = Math.min(entry.record.quantity, remaining);
      remaining -= kept;
      if (kept > 0) entry.record.quantity = kept;
      else {
        const context = storageContext(state, entry.placementId);
        if (context) delete context.storage.zones[entry.zoneName];
      }
    }
  }
}

export function retailShelfAssignments(state, placementId) {
  reconcileRetailShelfStock(state);
  const context = shelfContext(state, placementId);
  if (!context) return [];
  return context.zoneNames.flatMap((zoneName) => {
    const record = context.stock.zones[zoneName];
    return record ? [{ zoneName, ...record }] : [];
  });
}

export function retailShelfAssignedUnits(state, skuId = null) {
  reconcileRetailShelfStock(state);
  return recordsAcrossShelves(state).reduce((total, entry) => (
    !skuId || entry.record.skuId === skuId ? total + entry.record.quantity : total
  ), 0);
}

export function retailShelfStorageAssignments(state, placementId) {
  reconcileRetailShelfStorage(state);
  const context = storageContext(state, placementId);
  if (!context) return [];
  return context.zoneNames.flatMap((zoneName) => {
    const record = context.storage.zones[zoneName];
    return record ? [{ zoneName, ...record }] : [];
  });
}

export function retailShelfStoredUnits(state, skuId = null) {
  reconcileRetailShelfStorage(state);
  return recordsAcrossStorage(state).reduce((total, entry) => (
    !skuId || entry.record.skuId === skuId ? total + entry.record.quantity : total
  ), 0);
}

export function retailShelfPlacementSummary(state, placementId) {
  const context = shelfContext(state, placementId);
  if (!context) return null;
  const assignments = retailShelfAssignments(state, placementId);
  const units = assignments.reduce((sum, entry) => sum + entry.quantity, 0);
  return {
    units,
    capacity: context.zoneNames.length * context.zoneCapacity,
    usedZones: assignments.length,
    zoneCount: context.zoneNames.length,
  };
}

export function retailShelfStorageSummary(state, placementId) {
  const context = storageContext(state, placementId);
  if (!context) return null;
  const assignments = retailShelfStorageAssignments(state, placementId);
  const units = assignments.reduce((sum, entry) => sum + entry.quantity, 0);
  return {
    units,
    capacity: context.zoneNames.length * context.zoneCapacity,
    usedZones: assignments.length,
    zoneCount: context.zoneNames.length,
  };
}

export function stockRetailShelf(state, placementId, units = 1) {
  const context = shelfContext(state, placementId);
  if (!context) return { ok: false, reason: 'That is not a stockable retail shelf.' };
  const carry = carriedGoods(state);
  if (!carry) return { ok: false, reason: 'Your hands are empty.' };
  const sku = skuById(carry.skuId);
  if (!sku || !RETAIL_CATS.has(sku.cat) || !DISPLAY_CATEGORIES.has(sku.cat)) {
    return { ok: false, reason: `${sku?.name || 'That item'} needs its specialized display.` };
  }
  let zoneName = context.zoneNames.find((name) => {
    const record = context.stock.zones[name];
    return record?.skuId === carry.skuId && record.quantity < context.zoneCapacity;
  });
  if (!zoneName) zoneName = context.zoneNames.find((name) => !context.stock.zones[name]);
  if (!zoneName) return { ok: false, full: true, reason: `${context.spec.displayName} is full.` };
  const existing = context.stock.zones[zoneName];
  const room = context.zoneCapacity - (existing?.quantity || 0);
  const transfer = moveCarriedToShelf(
    state,
    Math.min(Math.max(1, Math.floor(units)), room),
    `Stocked ${placementId}:${zoneName}`,
  );
  if (!transfer.ok) return transfer;
  context.stock.zones[zoneName] = {
    skuId: transfer.skuId,
    quantity: (existing?.quantity || 0) + transfer.moved,
    capacity: context.zoneCapacity,
  };
  return {
    ...transfer,
    placementId,
    zoneName,
    zoneQuantity: context.stock.zones[zoneName].quantity,
    zoneCapacity: context.zoneCapacity,
    shelf: retailShelfPlacementSummary(state, placementId),
  };
}

export function takeFromRetailShelf(state, placementId, units = 1) {
  const context = shelfContext(state, placementId);
  if (!context) return { ok: false, reason: 'That is not a stockable retail shelf.' };
  const entries = retailShelfAssignments(state, placementId).reverse();
  if (!entries.length) return { ok: false, reason: 'That shelf is empty.' };
  const selected = entries[0];
  const carry = carriedGoods(state);
  if (carry && carry.skuId !== selected.skuId) {
    return { ok: false, reason: `You are already carrying ${skuById(carry.skuId)?.name || 'another product'}.` };
  }
  const room = armRoom(state, selected.skuId);
  if (room < 1) return { ok: false, reason: 'Your arms are full.' };
  const quantity = Math.min(Math.max(1, Math.floor(units)), room, selected.quantity);
  const moved = moveInventory(state, {
    from: INVENTORY_STAGE.SHELF,
    to: INVENTORY_STAGE.RESERVE,
    quantity,
    skuId: selected.skuId,
    reason: `Removed stock from ${placementId}:${selected.zoneName}`,
  });
  if (!moved.ok) return moved;
  const inventory = state.shop.inventory[selected.skuId];
  inventory.shelf = Math.max(0, inventory.shelf - quantity);
  const current = carriedGoods(state);
  setCarry(state, selected.skuId, (current?.qty || 0) + quantity, [
    ...((current && current.skuId === selected.skuId && current.allocations) || []),
    ...moved.allocations,
  ]);
  const record = context.stock.zones[selected.zoneName];
  record.quantity -= quantity;
  if (record.quantity <= 0) delete context.stock.zones[selected.zoneName];
  return {
    ok: true,
    placementId,
    zoneName: selected.zoneName,
    skuId: selected.skuId,
    moved: quantity,
    leftInZone: Math.max(0, record.quantity),
    shelf: retailShelfPlacementSummary(state, placementId),
  };
}

export function storeRetailShelfCabinet(state, placementId, preferredZoneName = null, units = 1) {
  const context = storageContext(state, placementId);
  if (!context) return { ok: false, reason: 'That shelf has no usable cabinet storage.' };
  const carry = carriedGoods(state);
  if (!carry) return { ok: false, reason: 'Your hands are empty.' };
  const sku = skuById(carry.skuId);
  if (!sku || !RETAIL_CATS.has(sku.cat) || !DISPLAY_CATEGORIES.has(sku.cat)) {
    return { ok: false, reason: `${sku?.name || 'That item'} does not fit this cabinet.` };
  }
  const candidates = preferredZoneName && context.zoneNames.includes(preferredZoneName)
    ? [preferredZoneName, ...context.zoneNames.filter((name) => name !== preferredZoneName)]
    : context.zoneNames;
  let zoneName = candidates.find((name) => {
    const record = context.storage.zones[name];
    return record?.skuId === carry.skuId && record.quantity < context.zoneCapacity;
  });
  if (!zoneName) zoneName = candidates.find((name) => !context.storage.zones[name]);
  if (!zoneName) return { ok: false, full: true, reason: `${context.spec.displayName} cabinet storage is full.` };
  const existing = context.storage.zones[zoneName];
  const room = context.zoneCapacity - (existing?.quantity || 0);
  const skuId = carry.skuId;
  const transfer = storeInBack(state, Math.min(Math.max(1, Math.floor(units)), room));
  if (!transfer.ok) return transfer;
  context.storage.zones[zoneName] = {
    skuId,
    quantity: (existing?.quantity || 0) + transfer.moved,
    capacity: context.zoneCapacity,
  };
  return {
    ...transfer,
    skuId,
    placementId,
    zoneName,
    zoneQuantity: context.storage.zones[zoneName].quantity,
    zoneCapacity: context.zoneCapacity,
    storage: retailShelfStorageSummary(state, placementId),
  };
}

export function takeFromRetailShelfCabinet(state, placementId, preferredZoneName = null, units = 1) {
  const context = storageContext(state, placementId);
  if (!context) return { ok: false, reason: 'That shelf has no usable cabinet storage.' };
  const entries = retailShelfStorageAssignments(state, placementId);
  const selected = (preferredZoneName
    ? entries.find((entry) => entry.zoneName === preferredZoneName)
    : null) || entries.at(-1);
  if (!selected) return { ok: false, reason: 'That cabinet is empty.' };
  const carry = carriedGoods(state);
  if (carry && carry.skuId !== selected.skuId) {
    return { ok: false, reason: `You are already carrying ${skuById(carry.skuId)?.name || 'another product'}.` };
  }
  const room = armRoom(state, selected.skuId);
  if (room < 1) return { ok: false, reason: 'Your arms are full.' };
  const quantity = Math.min(Math.max(1, Math.floor(units)), room, selected.quantity);
  const transfer = takeFromBack(state, selected.skuId, quantity);
  if (!transfer.ok) return transfer;
  const record = context.storage.zones[selected.zoneName];
  record.quantity -= transfer.taken;
  if (record.quantity <= 0) delete context.storage.zones[selected.zoneName];
  return {
    ...transfer,
    skuId: selected.skuId,
    placementId,
    zoneName: selected.zoneName,
    leftInZone: Math.max(0, record.quantity),
    storage: retailShelfStorageSummary(state, placementId),
  };
}
