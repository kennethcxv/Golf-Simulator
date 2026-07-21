// PLAYER-FACING FURNITURE PURCHASING AND PROGRESSION.
//
// Catalog rows stay immutable in data/. This module owns only the player's
// purchases, renovation level, install state and aggregate clubhouse effects.

import { FURNITURE_CATALOG, furnitureById } from '../data/furnitureCatalog.js';
import { ensureLayout } from './layout.js';

export const FURNITURE_STATE_VERSION = 1;
export const FURNITURE_HISTORY_LIMIT = 240;
export const MAX_FURNITURE_LEVEL = 50;

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const levelThreshold = (level) => 34 + level * 18;

function emptyFurnitureState() {
  return {
    version: FURNITURE_STATE_VERSION,
    level: 1,
    xp: 0,
    nextSerial: 1,
    lifetimeSpend: 0,
    purchaseCount: 0,
    purchases: [],
  };
}

export function ensureFurnitureCatalogState(state) {
  if (!state?.shop) return null;
  const current = state.shop.furnitureCatalog && typeof state.shop.furnitureCatalog === 'object'
    ? state.shop.furnitureCatalog : {};
  const defaults = emptyFurnitureState();
  const furniture = state.shop.furnitureCatalog = current;
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(furniture, key)) furniture[key] = value;
  }
  furniture.version = FURNITURE_STATE_VERSION;
  furniture.level = Math.max(1, Math.min(MAX_FURNITURE_LEVEL, Math.floor(Number(furniture.level) || 1)));
  furniture.xp = Math.max(0, Number(furniture.xp) || 0);
  furniture.nextSerial = Math.max(1, Math.floor(Number(furniture.nextSerial) || 1));
  furniture.lifetimeSpend = money(Math.max(0, Number(furniture.lifetimeSpend) || 0));
  furniture.purchaseCount = Math.max(0, Math.floor(Number(furniture.purchaseCount) || 0));
  if (!Array.isArray(furniture.purchases)) furniture.purchases = [];
  if (furniture.purchases.length > FURNITURE_HISTORY_LIMIT) {
    furniture.purchases = furniture.purchases.slice(-FURNITURE_HISTORY_LIMIT);
  }
  return furniture;
}

export function furnitureLevel(state) {
  return ensureFurnitureCatalogState(state)?.level || 1;
}

export function furnitureReputation(state) {
  return Math.max(0, Number(state?.club?.reputation) || 0);
}

export function furnitureUnlockStatus(state, itemOrId) {
  const item = typeof itemOrId === 'string' ? furnitureById(itemOrId) : itemOrId;
  if (!item) return Object.freeze({ unlocked: false, reasons: Object.freeze(['Unknown catalog item.']) });
  const level = furnitureLevel(state);
  const reputation = furnitureReputation(state);
  const reasons = [];
  if (level < item.unlockLevel) reasons.push(`Renovation level ${item.unlockLevel} required.`);
  if (reputation < item.requiredReputation) reasons.push(`${item.requiredReputation} reputation required.`);
  return Object.freeze({
    unlocked: reasons.length === 0,
    level,
    reputation,
    reasons: Object.freeze(reasons),
  });
}

function awardRenovationXp(furniture, item, quantity) {
  const gained = Math.max(4, Math.round((item.quality * 0.55 + Math.log10(item.purchaseCost + 10) * 5) * quantity));
  furniture.xp += gained;
  const levels = [];
  while (furniture.level < MAX_FURNITURE_LEVEL) {
    const threshold = levelThreshold(furniture.level);
    if (furniture.xp < threshold) break;
    furniture.xp -= threshold;
    furniture.level += 1;
    levels.push(furniture.level);
  }
  return { gained, levels };
}

export function furnitureInstanceId(skuId, serial) {
  return `furniture::${skuId}::${serial}`;
}

export function furnitureSkuFromInstanceId(instanceId) {
  const match = /^furniture::(.+)::(\d+)$/.exec(String(instanceId || ''));
  return match && furnitureById(match[1]) ? match[1] : null;
}

export function purchasedFurnitureInstances(state, { states = null } = {}) {
  const layout = ensureLayout(state);
  const allowed = states ? new Set(states) : null;
  return Object.entries(layout.objects)
    .filter(([id, record]) => furnitureSkuFromInstanceId(id) && (!allowed || allowed.has(record.state)))
    .map(([id, record]) => Object.freeze({
      id,
      skuId: record.catalogSku || furnitureSkuFromInstanceId(id),
      state: record.state,
      purchasedPrice: money(record.purchasedPrice || 0),
      record: clone(record),
    }));
}

export function installedFurnitureByFamily(state) {
  const entries = purchasedFurnitureInstances(state, { states: ['installed'] })
    .map((instance) => furnitureById(instance.skuId))
    .filter(Boolean)
    .map((item) => [item.familyId, item]);
  return Object.freeze(Object.fromEntries(entries));
}

export function purchaseFurniture(state, skuId, { quantity = 1 } = {}) {
  const item = furnitureById(skuId);
  if (!item) return { ok: false, reason: 'That furnishing is not in the catalog.' };
  const count = Math.floor(Number(quantity));
  if (!Number.isFinite(count) || count < 1 || count > 100) {
    return { ok: false, reason: 'Choose a quantity between 1 and 100.' };
  }
  const access = furnitureUnlockStatus(state, item);
  if (!access.unlocked) return { ok: false, locked: true, reason: access.reasons[0], access };
  const total = money(item.purchaseCost * count);
  if (!Number.isFinite(state.cash) || state.cash < total) {
    return { ok: false, reason: `Not enough cash for ${count} × ${item.name}.`, required: total, cash: money(state.cash) };
  }

  const furniture = ensureFurnitureCatalogState(state);
  const layout = ensureLayout(state);
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const serial = furniture.nextSerial++;
    const id = furnitureInstanceId(item.id, serial);
    ids.push(id);
    layout.objects[id] = {
      assetId: `furniture:${item.id}`,
      catalogSku: item.id,
      state: 'stored',
      transform: null,
      variant: item.progressionTier,
      requiredRelationship: null,
      purchasedPrice: money(item.purchaseCost),
      purchasedAtRevision: layout.revision + 1,
    };
  }
  state.cash = money(state.cash - total);
  layout.revision += 1;
  furniture.lifetimeSpend = money(furniture.lifetimeSpend + total);
  furniture.purchaseCount += count;
  const xp = awardRenovationXp(furniture, item, count);
  furniture.purchases.push({
    skuId: item.id,
    instanceIds: [...ids],
    quantity: count,
    unitPrice: money(item.purchaseCost),
    catalogRate: money(item.price),
    packageQuantity: item.packageQuantity,
    total,
    levelAfter: furniture.level,
    layoutRevision: layout.revision,
  });
  if (furniture.purchases.length > FURNITURE_HISTORY_LIMIT) furniture.purchases.splice(0, furniture.purchases.length - FURNITURE_HISTORY_LIMIT);
  return {
    ok: true,
    item,
    instanceIds: ids,
    quantity: count,
    total,
    cash: state.cash,
    level: furniture.level,
    xpGained: xp.gained,
    levelsGained: xp.levels,
  };
}

export function installFurniture(state, instanceId) {
  const layout = ensureLayout(state);
  const record = layout.objects[instanceId];
  const skuId = record?.catalogSku || furnitureSkuFromInstanceId(instanceId);
  const item = furnitureById(skuId);
  if (!record || !item) return { ok: false, reason: 'That furnishing is not owned.' };
  if (!['installation', 'vehicle'].includes(item.placementMode)) {
    return { ok: false, reason: `${item.name} must be placed through renovation mode.` };
  }
  if (record.state === 'installed') return { ok: true, unchanged: true, item, instanceId };
  if (record.state === 'sold') return { ok: false, reason: `${item.name} was sold.` };
  // One room-wide installation per family. The previous finish remains owned and
  // returns to storage, so changing style never destroys the player's purchase.
  if (item.placementMode === 'installation') {
    for (const [otherId, other] of Object.entries(layout.objects)) {
      if (otherId === instanceId || other.state !== 'installed') continue;
      const otherItem = furnitureById(other.catalogSku || furnitureSkuFromInstanceId(otherId));
      if (otherItem?.familyId === item.familyId) other.state = 'stored';
    }
  }
  record.state = 'installed';
  layout.revision += 1;
  return { ok: true, item, instanceId, revision: layout.revision };
}

export function uninstallFurniture(state, instanceId) {
  const layout = ensureLayout(state);
  const record = layout.objects[instanceId];
  if (!record || record.state !== 'installed') return { ok: false, reason: 'That furnishing is not installed.' };
  record.state = 'stored';
  layout.revision += 1;
  return { ok: true, instanceId, revision: layout.revision };
}

export function furnitureEffects(state) {
  const totals = { maintenanceValue: 0, comfortValue: 0, prestigeValue: 0, placedCount: 0, installedCount: 0 };
  for (const instance of purchasedFurnitureInstances(state)) {
    if (!['placed', 'installed'].includes(instance.state)) continue;
    const item = furnitureById(instance.skuId);
    if (!item) continue;
    totals.maintenanceValue += item.maintenanceValue;
    totals.comfortValue += item.comfortValue;
    totals.prestigeValue += item.prestigeValue;
    if (instance.state === 'placed') totals.placedCount += 1;
    else totals.installedCount += 1;
  }
  return Object.freeze(totals);
}

export function furnitureCatalogAvailability(state, catalog = FURNITURE_CATALOG) {
  return catalog.map((item) => Object.freeze({ item, ...furnitureUnlockStatus(state, item) }));
}
