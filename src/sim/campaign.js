// FIRST-TIME PROPERTY CAMPAIGN
//
// This module connects the existing restoration, delivery, layout, register,
// reservation, review, and economy systems. Campaign tasks are projections of
// those authorities. The small amount of campaign-owned state records real
// world installations, repair work stages, presentation history, and the
// opening boundary; it never substitutes a checkbox for cleaning or commerce.

import { calendarOf } from './time.js';
import { SHOP_CATALOG, RETAIL_CATS, skuById } from '../data/shopItems.js';
import {
  availableSupplyUnits as availableCampaignUnits,
  carriedMatching,
  consumeSupplyUnit as consumeCampaignUnit,
} from './supplyUnits.js';
import { planShipment, boxDims } from '../data/boxes.js';
import { ensureDebris, totalDebris } from './cleaningDebris.js';
import { ensureWash, exteriorWashScore, surfaceClean } from './washing.js';
import {
  ARCHITECTURE_COMPONENTS,
  ceilingCircuitPowered,
  CLUBHOUSE_CLEANUP_MILESTONE_IDS,
  CLUBHOUSE_CLEANUP_TARGET_IDS,
  CLUBHOUSE_LIGHT_TARGET_IDS,
  CLUBHOUSE_RESTOCK_GROUP_IDS,
  ensureClubhouseArchitecture,
  ensureClubhouseRestoration,
  restorationSnapshot,
  setArchitectureComponent,
} from './clubhouseRestoration.js';
import {
  ensureLayout,
  fixtureById,
  restoreFixture,
  routesIntact,
} from './layout.js';
import {
  BACKDOOR_CLEARWAY,
  DOOR_CLEARWAY,
  FRONT_DESK_COLLIDERS,
  FRONT_DESK_FRAME,
  FURNISHED_CLUBHOUSE_FIXTURE_IDS,
  INTERIOR,
  OFFICE,
  STOCKROOM,
  frontDeskPoint,
  frontDeskRect,
} from '../data/shopLayout.js';
import { RENO, ensureShopReno } from './shop.js';
import { bookReservation, slotAvailability, slotTimes } from './reservations.js';
import { RESERVATION_CHECK_IN_TYPE } from './reservationCheckIn.js';
import { ensureStarterRetailStock } from './clubhouseStarterStock.js';

export const CAMPAIGN_VERSION = 2;
export const FURNISHED_START_VERSION = 1;

export const CAMPAIGN_SKUS = Object.freeze({
  repair: 'repairkit1',
  desk: 'desk1',
  chair: 'chair1',
  laptop: 'laptop1',
  counter: 'counter1',
  shelves: 'shelfkit1',
  safety: 'safetykit1',
});

export const CAMPAIGN_ITEM_IDS = Object.freeze([
  CAMPAIGN_SKUS.repair,
  CAMPAIGN_SKUS.desk,
  CAMPAIGN_SKUS.chair,
  CAMPAIGN_SKUS.laptop,
  CAMPAIGN_SKUS.counter,
  CAMPAIGN_SKUS.shelves,
  CAMPAIGN_SKUS.safety,
]);

export const CAMPAIGN_FACILITIES = Object.freeze({
  officeDesk: Object.freeze({ skuId: CAMPAIGN_SKUS.desk, label: 'office desk' }),
  officeChair: Object.freeze({ skuId: CAMPAIGN_SKUS.chair, label: 'front-desk reception chair' }),
  laptop: Object.freeze({ skuId: CAMPAIGN_SKUS.laptop, label: 'Pine Hills front-desk tee-sheet laptop' }),
  frontCounter: Object.freeze({ skuId: CAMPAIGN_SKUS.counter, label: 'front desk counter' }),
  registerHardware: Object.freeze({ skuId: null, label: 'register hardware' }),
  displayShelves: Object.freeze({ skuId: CAMPAIGN_SKUS.shelves, label: 'sales-floor displays' }),
  stockroomShelves: Object.freeze({ skuId: CAMPAIGN_SKUS.shelves, label: 'stockroom shelving' }),
  safety: Object.freeze({ skuId: CAMPAIGN_SKUS.safety, label: 'safety station' }),
});

export const FURNISHED_START_FIXTURES = FURNISHED_CLUBHOUSE_FIXTURE_IDS;

const STARTER_ENTITLEMENTS = Object.freeze({
  vac1: 1,
  [CAMPAIGN_SKUS.repair]: 1,
});

const OBSOLETE_INHERITED_FLATPACK_SKUS = new Set(
  CAMPAIGN_ITEM_IDS.filter((skuId) => skuId !== CAMPAIGN_SKUS.repair),
);
const OBSOLETE_DELIVERY_STAGES = Object.freeze([
  'inTransit', 'deliveredUnopened', 'openedBox', 'reserve', 'shelf', 'customerHeld',
]);
const PRESERVED_INVENTORY_STAGES = Object.freeze([
  'sold', 'disposedLost',
]);

// The generic debris scatterer is useful for unrestricted rooms, but the
// clubhouse has a service-wing partition and permanent lounge/packing props.
// Random points can consequently land inside a wall or under a collider. These
// authored campaign spots keep the neglected-floor read across all three rooms
// while leaving a valid player stance for the broom, pan, bag, and vacuum.
export const CAMPAIGN_DEBRIS_SPOTS = Object.freeze([
  Object.freeze({ x: -7.6, z: 4.6, a: 0.26 }),
  Object.freeze({ x: -5.2, z: 4.4, a: 0.18 }),
  Object.freeze({ x: -4.5, z: 2.8, a: 0.22 }),
  Object.freeze({ ...frontDeskPoint(0.4, -1.05), a: 0.31 }),
  Object.freeze({ ...frontDeskPoint(-2.1, -1.05), a: 0.17 }),
  Object.freeze({ x: 3.6, z: 2.8, a: 0.24 }),
  Object.freeze({ x: -8.1, z: 1.3, a: 0.21 }),
  Object.freeze({ x: -4.8, z: 1.8, a: 0.16 }),
  Object.freeze({ x: -3.7, z: 0.0, a: 0.27 }),
  Object.freeze({ x: -0.4, z: 0.7, a: 0.19 }),
  Object.freeze({ x: 1.8, z: -0.2, a: 0.25 }),
  Object.freeze({ x: 3.2, z: -1.1, a: 0.14 }),
  Object.freeze({ x: -7.4, z: -3.8, a: 0.23 }),
  Object.freeze({ x: -4.4, z: -4.3, a: 0.20 }),
  Object.freeze({ x: 6.65, z: 5.15, a: 0.18 }),
  Object.freeze({ x: 7.15, z: 3.3, a: 0.24 }),
  Object.freeze({ x: 8.2, z: -1.5, a: 0.28 }),
  Object.freeze({ x: 6.8, z: -5.1, a: 0.20 }),
]);

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function campaignOf(state) {
  return state && state.campaign && state.campaign.version === CAMPAIGN_VERSION
    ? state.campaign
    : null;
}

function renoOf(state) {
  if (!state?.shop) return null;
  if (!state.shop.reno || typeof state.shop.reno !== 'object') state.shop.reno = {};
  return state.shop.reno;
}

export function ensureCampaignFacilities(state, { installed = null } = {}) {
  const reno = renoOf(state);
  if (!reno) return null;
  if (!reno.facilities || typeof reno.facilities !== 'object' || Array.isArray(reno.facilities)) {
    const defaultInstalled = installed == null ? !campaignOf(state)?.enabled : !!installed;
    reno.facilities = Object.fromEntries(
      Object.keys(CAMPAIGN_FACILITIES).map((id) => [id, defaultInstalled]),
    );
  }
  for (const id of Object.keys(CAMPAIGN_FACILITIES)) {
    if (typeof reno.facilities[id] !== 'boolean') {
      reno.facilities[id] = installed == null ? !campaignOf(state)?.enabled : !!installed;
    }
  }
  return reno.facilities;
}

export function ensureCampaignRepairs(state, { restored = null } = {}) {
  const reno = renoOf(state);
  if (!reno) return null;
  if (!reno.repairWork || typeof reno.repairWork !== 'object' || Array.isArray(reno.repairWork)) {
    reno.repairWork = {};
  }
  for (const id of [...ARCHITECTURE_COMPONENTS, 'entranceDoor']) {
    if (!reno.repairWork[id] || typeof reno.repairWork[id] !== 'object') {
      reno.repairWork[id] = { removed: false };
    } else {
      reno.repairWork[id].removed = !!reno.repairWork[id].removed;
    }
  }
  if (typeof reno.entranceDoorRepaired !== 'boolean') {
    reno.entranceDoorRepaired = restored == null ? !campaignOf(state)?.enabled : !!restored;
  }
  return reno.repairWork;
}

function makeCampaignState() {
  return {
    version: CAMPAIGN_VERSION,
    enabled: true,
    hidden: false,
    phase: 'arrival',
    startedAt: null,
    businessOpen: false,
    openedAt: null,
    operatingDayAbs: null,
    openingReservationId: null,
    firstDayComplete: false,
    completedObjectiveIds: [],
    history: [],
    events: {},
    cleaningToolsUsed: {},
    starterEntitlements: { ...STARTER_ENTITLEMENTS },
    purchased: {},
    recoverySeq: 0,
    openingBaseline: null,
    arrivalShown: false,
    furnishedStartVersion: FURNISHED_START_VERSION,
  };
}

function queueCampaignDelivery(state, skuId, qty, { inherited = false, recovery = false } = {}) {
  const sku = skuById(skuId);
  if (!sku || !Number.isInteger(qty) || qty < 1 || !state?.shop) return null;
  const manifest = planShipment(sku, qty);
  const id = state.shop.nextOrderId++;
  const sequence = Math.max(0, state.campaign?.recoverySeq || 0);
  if (state.campaign) state.campaign.recoverySeq = sequence + 1;
  const now = finite(state.clock?.minutes, 360);
  const deliveryMin = Math.ceil(now + 6 + (sequence % 5) * 3);
  const arrivesDay = Math.floor(deliveryMin / 1440);
  const open = Math.max(now + 2, deliveryMin - 5);
  const close = deliveryMin + 20;
  const order = {
    id,
    skuId,
    qty,
    cost: 0,
    goods: 0,
    fee: 0,
    supplier: manifest.supplier,
    manifest,
    arrivesDay,
    placedMin: now,
    window: { open, close },
    deliveryMin,
    status: 'received',
    notif: {},
    campaign: true,
    inherited: !!inherited,
    recovery: !!recovery,
  };
  state.shop.orders.push(order);
  return order;
}

function isObsoleteInheritedFlatpackOrder(order) {
  if (!order || typeof order !== 'object') return false;
  return order.campaign === true
    && order.inherited === true
    && OBSOLETE_INHERITED_FLATPACK_SKUS.has(order.skuId)
    && Object.hasOwn(order, 'cost')
    && finite(order.cost) === 0
    && (order.goods == null || finite(order.goods) === 0)
    && (order.fee == null || finite(order.fee) === 0);
}

function retireObsoleteInheritedFlatpacks(state) {
  const shop = state?.shop;
  if (!shop) return;
  const lifecycle = shop.inventoryLifecycle;
  const candidates = [
    ...(Array.isArray(shop.orders) ? shop.orders : []),
    ...(Array.isArray(lifecycle?.orders) ? lifecycle.orders : []),
  ];
  const retiredOrderIds = new Set(
    candidates.filter(isObsoleteInheritedFlatpackOrder).map((order) => order.id),
  );
  if (!retiredOrderIds.size) return;

  shop.orders = (Array.isArray(shop.orders) ? shop.orders : [])
    .filter((order) => !retiredOrderIds.has(order.id));

  const deliveries = shop.deliveries;
  if (deliveries && typeof deliveries === 'object') {
    deliveries.boxes = (Array.isArray(deliveries.boxes) ? deliveries.boxes : [])
      .filter((box) => !retiredOrderIds.has(box.orderId));
    deliveries.shipments = (Array.isArray(deliveries.shipments) ? deliveries.shipments : [])
      .filter((shipment) => !retiredOrderIds.has(shipment.orderId));
    if (Array.isArray(deliveries.arrivedOrderIds)) {
      deliveries.arrivedOrderIds = deliveries.arrivedOrderIds
        .filter((orderId) => !retiredOrderIds.has(orderId));
    }
  }

  if (!lifecycle || typeof lifecycle !== 'object') return;
  const removeProjectionForLot = (lot) => {
    const inventory = shop.inventory?.[lot.skuId];
    const shelf = Math.max(0, Math.floor(finite(lot.buckets?.shelf)));
    if (inventory && shelf > 0) inventory.shelf = Math.max(0, finite(inventory.shelf) - shelf);

    let reserve = Math.max(0, Math.floor(finite(lot.buckets?.reserve)));
    const carry = shop.carry;
    if (reserve > 0 && carry?.skuId === lot.skuId && Array.isArray(carry.allocations)) {
      const removedFromCarry = carry.allocations
        .filter((allocation) => allocation.lotId === lot.id)
        .reduce((sum, allocation) => sum + Math.max(0, Math.floor(finite(allocation.quantity))), 0);
      if (removedFromCarry > 0) {
        carry.allocations = carry.allocations.filter((allocation) => allocation.lotId !== lot.id);
        carry.qty = Math.max(0, finite(carry.qty) - removedFromCarry);
        reserve = Math.max(0, reserve - removedFromCarry);
        if (carry.qty <= 0) shop.carry = null;
      }
    }
    if (inventory && reserve > 0) inventory.back = Math.max(0, finite(inventory.back) - reserve);
  };
  lifecycle.orders = (Array.isArray(lifecycle.orders) ? lifecycle.orders : [])
    .filter((order) => !retiredOrderIds.has(order.id));
  lifecycle.lots = (Array.isArray(lifecycle.lots) ? lifecycle.lots : [])
    .flatMap((lot) => {
      if (!retiredOrderIds.has(lot?.orderId)) return [lot];
      const buckets = lot?.buckets && typeof lot.buckets === 'object' ? lot.buckets : {};
      removeProjectionForLot(lot);
      const preservedQuantity = PRESERVED_INVENTORY_STAGES
        .reduce((sum, stage) => sum + Math.max(0, Math.floor(finite(buckets[stage]))), 0);
      if (preservedQuantity <= 0) return [];
      for (const stage of OBSOLETE_DELIVERY_STAGES) buckets[stage] = 0;
      lot.source = 'furnished-start-migration';
      lot.orderId = null;
      lot.lineId = null;
      lot.orderedQuantity = preservedQuantity;
      lot.note = 'Owned unit preserved when inherited starter flatpack was retired';
      return [lot];
    });
}

function preserveOpenedClubhouseCondition(state, campaign) {
  if (!campaign.businessOpen && !campaign.firstDayComplete && campaign.openedAt == null) return;
  const reno = ensureClubhouseRestoration(state);
  if (!reno) return;
  for (const targetId of CLUBHOUSE_CLEANUP_TARGET_IDS) reno.targetProgress[targetId] = 1;
  for (const targetId of CLUBHOUSE_LIGHT_TARGET_IDS) reno.targetProgress[targetId] = 1;
  for (const panelId of Object.keys(reno.lightPanels || {})) reno.lightPanels[panelId] = 'working';
  for (const milestoneId of CLUBHOUSE_CLEANUP_MILESTONE_IDS) {
    reno.cleanupMilestones[milestoneId] = true;
  }
  for (const groupId of CLUBHOUSE_RESTOCK_GROUP_IDS) reno.restockMilestones[groupId] = true;
  reno.fullCleanupAwarded = true;
}

function migrateFurnishedStart(state, campaign) {
  retireObsoleteInheritedFlatpacks(state);
  const facilities = ensureCampaignFacilities(state, { installed: true });
  for (const id of Object.keys(CAMPAIGN_FACILITIES)) facilities[id] = true;
  ensureLayout(state);
  for (const id of FURNISHED_START_FIXTURES) restoreFixture(state, id);
  ensureCampaignRepairs(state, { restored: true });
  const architecture = ensureClubhouseArchitecture(state);
  for (const id of ARCHITECTURE_COMPONENTS) architecture.components[id].restored = true;
  preserveOpenedClubhouseCondition(state, campaign);
  ensureStarterRetailStock(state);
  campaign.furnishedStartVersion = FURNISHED_START_VERSION;
}

function seedFreshCampaignWorld(state) {
  // Pine Hills is furnished but neglected. Replace the legacy four-line shelf
  // seed before the lot ledger exists; the production entitlement below then
  // authors every starter group at exactly half capacity.
  for (const sku of SHOP_CATALOG) {
    if (!RETAIL_CATS.has(sku.cat)) continue;
    const inventory = state.shop.inventory[sku.id]
      || (state.shop.inventory[sku.id] = { shelf: 0, back: 0 });
    inventory.shelf = 0;
    inventory.back = 0;
  }
  state.shop.inventory.vac1.back = Math.max(1, finite(state.shop.inventory.vac1.back));
  state.shop.inventory[CAMPAIGN_SKUS.repair].back = Math.max(
    1,
    finite(state.shop.inventory[CAMPAIGN_SKUS.repair].back),
  );
  ensureLayout(state);
  for (const id of FURNISHED_START_FIXTURES) restoreFixture(state, id);

  ensureDebris(state);
  if (state.shop.reno.debris.length === 0 && !state.shop.reno.debrisSeeded) {
    // Eighteen readable clumps sell long neglect without turning the first
    // clubhouse visit into a room-by-room pixel hunt. The player still has to
    // sweep, collect, and dispose of conserved debris; this only bounds toil.
    state.shop.reno.debris.push(...CAMPAIGN_DEBRIS_SPOTS.map((spot) => ({ ...spot })));
    state.shop.reno.debrisSeeded = true;
  }
  ensureWash(state);
  ensureClubhouseArchitecture(state);
  ensureClubhouseRestoration(state);
  // DILAPIDATED START. A new game inherits a structurally damaged clubhouse:
  // the furnished workstations and displays exist (the campaign arc and the
  // tee-sheet laptop depend on them), but every architecture component starts
  // broken. The campaign's cleaning-gated repair chain, the ceiling power
  // gate, and the reopening supply bundle drive the House Flipper loop;
  // refinishing follows each completed repair. Existing furnished saves are
  // untouched — migrateFurnishedStart still governs them.
  const facilities = ensureCampaignFacilities(state, { installed: true });
  for (const id of Object.keys(CAMPAIGN_FACILITIES)) facilities[id] = true;
  ensureCampaignRepairs(state, { restored: false });
  const architecture = ensureClubhouseArchitecture(state);
  for (const id of ARCHITECTURE_COMPONENTS) {
    architecture.components[id].restored = false;
    state.shop.reno.componentRepairProgress[id] = 0;
  }
  ensureStarterRetailStock(state);
}

export function initCampaign(state, { fresh = true } = {}) {
  if (!state?.shop) return null;
  // Fresh games previously gained the exterior chores lazily through a later
  // renderer/load migration. Campaign objectives need that same authoritative
  // restoration state before any renderer exists.
  ensureShopReno(state);
  state.campaign = makeCampaignState();
  state.campaign.startedAt = finite(state.clock?.minutes, 360);
  if (fresh) {
    seedFreshCampaignWorld(state);
  } else {
    // Existing saves already displayed these installed assets. Preserve that
    // world while migrating the guide onto the real cleaning/repair state.
    ensureCampaignFacilities(state, { installed: true });
    ensureCampaignRepairs(state, { restored: true });
    ensureClubhouseArchitecture(state);
    ensureDebris(state);
    ensureWash(state);
    migrateFurnishedStart(state, state.campaign);
  }
  return state.campaign;
}

export function ensureCampaign(state) {
  if (!state?.campaign) return null;
  const priorVersion = Number.isSafeInteger(state.campaign.version) ? state.campaign.version : 0;
  const needsFurnishedStart = !Number.isSafeInteger(state.campaign.furnishedStartVersion)
    || state.campaign.furnishedStartVersion < FURNISHED_START_VERSION;
  if (state.campaign.version !== CAMPAIGN_VERSION) {
    const old = state.campaign;
    state.campaign = { ...makeCampaignState(), ...old, version: CAMPAIGN_VERSION };
  }
  const campaign = state.campaign;
  campaign.events ||= {};
  campaign.cleaningToolsUsed ||= {};
  campaign.starterEntitlements = priorVersion < CAMPAIGN_VERSION
    ? { ...STARTER_ENTITLEMENTS }
    : (campaign.starterEntitlements || { ...STARTER_ENTITLEMENTS });
  campaign.purchased ||= {};
  campaign.completedObjectiveIds = Array.isArray(campaign.completedObjectiveIds)
    ? campaign.completedObjectiveIds : [];
  campaign.history = Array.isArray(campaign.history) ? campaign.history : [];
  campaign.recoverySeq = Math.max(0, Math.floor(finite(campaign.recoverySeq)));
  campaign.hidden = !!campaign.hidden;
  campaign.enabled = campaign.enabled !== false;
  campaign.businessOpen = !!campaign.businessOpen;
  campaign.firstDayComplete = !!campaign.firstDayComplete;
  if (needsFurnishedStart) migrateFurnishedStart(state, campaign);
  ensureCampaignFacilities(state);
  ensureCampaignRepairs(state);
  ensureClubhouseArchitecture(state);
  ensureClubhouseRestoration(state);
  ensureStarterRetailStock(state);
  ensureDebris(state);
  ensureWash(state);
  return campaign;
}

export function disableCampaign(state) {
  if (!state?.shop) return null;
  const campaign = ensureCampaign(state) || initCampaign(state, { fresh: false });
  campaign.enabled = false;
  campaign.businessOpen = true;
  campaign.hidden = true;
  const facilities = ensureCampaignFacilities(state, { installed: true });
  for (const id of Object.keys(facilities)) facilities[id] = true;
  ensureCampaignRepairs(state, { restored: true });
  for (const id of FURNISHED_START_FIXTURES) restoreFixture(state, id);
  return campaign;
}

export function campaignAllowsBusiness(state) {
  const campaign = ensureCampaign(state);
  return !campaign || !campaign.enabled || campaign.businessOpen;
}

export function recordCampaignEvent(state, id, value = true) {
  const campaign = ensureCampaign(state);
  if (!campaign || !campaign.enabled || typeof id !== 'string' || !id) return false;
  campaign.events[id] = value;
  return true;
}

export function recordCampaignCleaning(state, toolId, amount = 0) {
  const campaign = ensureCampaign(state);
  if (!campaign || !campaign.enabled || !toolId || finite(amount) <= 0) return false;
  campaign.cleaningToolsUsed[toolId] = true;
  return true;
}

export function campaignRecordPurchase(state, skuId, qty) {
  const campaign = ensureCampaign(state);
  if (!campaign || !campaign.enabled || !CAMPAIGN_ITEM_IDS.includes(skuId)) return false;
  const amount = Math.max(0, Math.floor(finite(qty)));
  if (!amount) return false;
  campaign.purchased[skuId] = Math.max(0, Math.floor(finite(campaign.purchased[skuId]))) + amount;
  return true;
}

function grimeCleanInBounds(state, bounds) {
  const grime = state?.shop?.reno?.grime;
  if (!Array.isArray(grime) || grime.length !== RENO.grid.w * RENO.grid.h) return 0;
  let dirt = 0;
  let count = 0;
  for (let cy = 0; cy < RENO.grid.h; cy++) {
    for (let cx = 0; cx < RENO.grid.w; cx++) {
      const x = -RENO.room.w / 2 + ((cx + 0.5) / RENO.grid.w) * RENO.room.w;
      const z = -RENO.room.d / 2 + ((cy + 0.5) / RENO.grid.h) * RENO.room.d;
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
      dirt += clamp01(grime[cy * RENO.grid.w + cx]);
      count++;
    }
  }
  return count ? clamp01(1 - dirt / count) : 0;
}

function clutterRemaining(state, bounds = null) {
  const clutter = state?.shop?.reno?.clutter || [];
  return clutter.filter((pile) => !pile.cleared && (!bounds
    || (pile.x >= bounds.minX && pile.x <= bounds.maxX && pile.z >= bounds.minZ && pile.z <= bounds.maxZ))).length;
}

function windowCleanliness(state) {
  const windows = state?.shop?.reno?.windows;
  if (!Array.isArray(windows) || !windows.length) return 0;
  return clamp01(1 - windows.reduce((sum, dirt) => sum + clamp01(dirt), 0) / windows.length);
}

function exteriorChoreProgress(state) {
  const exterior = state?.shop?.reno?.exterior;
  if (!exterior) return 0;
  const values = [
    ...(Array.isArray(exterior.weeds) ? exterior.weeds : []),
    exterior.gutter,
    exterior.cobwebs,
    exterior.light,
  ];
  if (!values.length) return 0;
  return values.filter((value) => !value).length / values.length;
}

export function campaignZoneProgress(state) {
  ensureCampaign(state);
  const entranceBounds = { minX: -2.4, maxX: 2.4, minZ: 2.0, maxZ: INTERIOR.d / 2 };
  const lobbyBounds = { minX: -INTERIOR.w / 2, maxX: 5.7, minZ: 2.0, maxZ: INTERIOR.d / 2 };
  const retailBounds = { minX: -INTERIOR.w / 2, maxX: 5.7, minZ: -INTERIOR.d / 2, maxZ: 2.0 };
  const officeBounds = { ...OFFICE.bounds };
  const stockBounds = { ...STOCKROOM.bounds };
  const debris = totalDebris(state);
  const debrisBase = Math.max(0.001, debris + finite(state.shop.reno.pan) + finite(state.shop.reno.bag));
  const looseClean = debris <= 0.02 && finite(state.shop.reno.pan) <= 0.001 && finite(state.shop.reno.bag) <= 0.001
    ? 1 : clamp01(1 - debris / Math.max(5, debrisBase));
  return {
    entrance: clamp01(grimeCleanInBounds(state, entranceBounds) * 0.65
      + (clutterRemaining(state, { minX: -10.25, maxX: 5.7, minZ: 2.5, maxZ: 6.5 }) === 0 ? 0.35 : 0)),
    lobby: grimeCleanInBounds(state, lobbyBounds),
    retail: grimeCleanInBounds(state, retailBounds),
    office: grimeCleanInBounds(state, officeBounds),
    stockroom: grimeCleanInBounds(state, stockBounds),
    windows: windowCleanliness(state),
    exterior: clamp01(exteriorWashScore(state) * 0.8 + exteriorChoreProgress(state) * 0.2),
    looseDebris: looseClean,
  };
}

export function facilityInstalled(state, id) {
  const campaign = ensureCampaign(state);
  if (!campaign || !campaign.enabled) return true;
  const facilities = ensureCampaignFacilities(state);
  return !!facilities?.[id];
}

// The physical supply-unit rules (carried item first, then backroom shelving)
// live in supplyUnits.js so campaign installs and normal-play structural
// repairs can never drift apart.

export function laptopReadiness(state) {
  const requirements = [
    { id: 'front-counter', label: 'Pine Hills front desk installed', ok: facilityInstalled(state, 'frontCounter'), reason: 'The furnished Pine Hills front desk is unavailable.' },
    { id: 'front-desk-tee-sheet', label: 'Front-desk tee-sheet laptop installed', ok: facilityInstalled(state, 'laptop'), reason: 'The Pine Hills reception tee-sheet laptop is unavailable.' },
  ];
  return { ready: requirements.every((requirement) => requirement.ok), requirements };
}

function facilityPrerequisite(state, id) {
  const zones = campaignZoneProgress(state);
  if (id === 'officeDesk') {
    return zones.office >= 0.40
      ? { ok: true }
      : { ok: false, reason: `Clean the office to 40% first (currently ${Math.round(zones.office * 100)}%).` };
  }
  if (id === 'officeChair') {
    if (!facilityInstalled(state, 'frontCounter')) {
      return { ok: false, reason: 'Install the Pine Hills front desk first.' };
    }
    return zones.lobby >= 0.40
      ? { ok: true }
      : { ok: false, reason: `Clean the front-desk reception area to 40% first (currently ${Math.round(zones.lobby * 100)}%).` };
  }
  if (id === 'laptop') {
    if (!facilityInstalled(state, 'frontCounter')) {
      return { ok: false, reason: 'Install the Pine Hills front desk first.' };
    }
    if (!repairComplete(state, 'ceiling')) return { ok: false, reason: 'Restore clubhouse power and lighting first.' };
    if (zones.lobby < 0.55) return { ok: false, reason: `Clean the front-desk reception area to 55% first (currently ${Math.round(zones.lobby * 100)}%).` };
  }
  if (id === 'displayShelves' && zones.retail < 0.55) {
    return { ok: false, reason: `Clean the sales floor to 55% first (currently ${Math.round(zones.retail * 100)}%).` };
  }
  if (id === 'stockroomShelves' && zones.stockroom < 0.45) {
    return { ok: false, reason: `Clean the stockroom to 45% first (currently ${Math.round(zones.stockroom * 100)}%).` };
  }
  if ((id === 'frontCounter' || id === 'registerHardware')
      && (!repairComplete(state, 'floor') || !repairComplete(state, 'panels'))) {
    return { ok: false, reason: 'Repair the floor and front-counter wall panels first.' };
  }
  if (id === 'registerHardware' && !facilityInstalled(state, 'frontCounter')) {
    return { ok: false, reason: 'Install the front counter first.' };
  }
  if (id === 'safety' && !repairComplete(state, 'panels')) {
    return { ok: false, reason: 'Repair the wall panels before mounting the safety station.' };
  }
  return { ok: true };
}

export function installCampaignFacility(state, id) {
  const campaign = ensureCampaign(state);
  if (!campaign || !campaign.enabled) return { ok: false, reason: 'The reopening campaign is not active.' };
  const spec = CAMPAIGN_FACILITIES[id];
  if (!spec) return { ok: false, reason: 'No installation belongs there.' };
  const facilities = ensureCampaignFacilities(state);
  if (facilities[id]) return { ok: false, reason: `${spec.label[0].toUpperCase()}${spec.label.slice(1)} is already installed.` };
  const prereq = facilityPrerequisite(state, id);
  if (!prereq.ok) return prereq;
  let consumed = { ok: true, from: 'assembly' };
  if (spec.skuId) {
    consumed = consumeCampaignUnit(state, spec.skuId);
    if (!consumed.ok) return consumed;
  }
  facilities[id] = true;
  if (id === 'displayShelves') {
    for (const fixtureId of ['shelf_balls', 'shelf_acc', 'shelf_small']) restoreFixture(state, fixtureId);
  } else if (id === 'stockroomShelves') {
    for (const fixtureId of ['backshelf_n', 'backshelf_e', 'backshelf_e2']) restoreFixture(state, fixtureId);
  } else if (id === 'frontCounter') {
    restoreFixture(state, 'backcounter');
  }
  return { ok: true, id, label: spec.label, consumedFrom: consumed.from };
}

export const CAMPAIGN_REPAIR_JOBS = Object.freeze([
  Object.freeze({ id: 'ceiling', label: 'Office power and ceiling', tool: 'Repair components' }),
  Object.freeze({ id: 'floor', label: 'Damaged flooring', tool: 'Repair components' }),
  Object.freeze({ id: 'panels', label: 'Wall panels and counter area', tool: 'Repair components' }),
  Object.freeze({ id: 'trim', label: 'Interior and entrance trim', tool: 'Repair components' }),
  Object.freeze({ id: 'windows', label: 'Window frames', tool: 'Repair components' }),
  Object.freeze({ id: 'porch', label: 'Porch boards and rail', tool: 'Repair components' }),
  Object.freeze({ id: 'shell', label: 'Exterior shell', tool: 'Repair components' }),
  Object.freeze({ id: 'entranceDoor', label: 'Entrance doors and hardware', tool: 'Repair components' }),
]);

export function repairComplete(state, id) {
  const architecture = ensureClubhouseArchitecture(state);
  if (id === 'entranceDoor') return !!renoOf(state)?.entranceDoorRepaired;
  return !!architecture?.components?.[id]?.restored;
}

function repairPrerequisite(state, id) {
  const zones = campaignZoneProgress(state);
  if (id !== 'ceiling' && !laptopReadiness(state).ready) {
    return { ok: false, reason: 'Restore the Pine Hills front desk and tee-sheet laptop before ordering the remaining components.' };
  }
  const checks = {
    ceiling: [zones.office >= 0.45, `Clean the office to 45% first (currently ${Math.round(zones.office * 100)}%).`],
    floor: [zones.retail >= 0.60 && zones.lobby >= 0.60, 'Vacuum and mop the lobby and sales floor to 60% first.'],
    panels: [zones.lobby >= 0.60, `Clean the lobby to 60% first (currently ${Math.round(zones.lobby * 100)}%).`],
    trim: [zones.lobby >= 0.65 && zones.windows >= 0.45, 'Clean the lobby and wipe the key windows first.'],
    windows: [zones.windows >= 0.60, `Wipe the windows to 60% first (currently ${Math.round(zones.windows * 100)}%).`],
    porch: [surfaceClean(state, 'porch') >= 0.60, `Pressure wash the porch to 60% first (currently ${Math.round(surfaceClean(state, 'porch') * 100)}%).`],
    shell: [exteriorWashScore(state) >= 0.65 && exteriorChoreProgress(state) >= 0.75, 'Pressure wash the exterior and clear its maintenance problems first.'],
    entranceDoor: [zones.entrance >= 0.65 && surfaceClean(state, 'porch') >= 0.55, 'Clear the entrance and wash the porch before repairing the doors.'],
  };
  const [ok, reason] = checks[id] || [false, 'That repair is not part of the campaign.'];
  return { ok, reason: ok ? null : reason };
}

export function campaignRepairStatus(state, id) {
  ensureCampaign(state);
  const job = CAMPAIGN_REPAIR_JOBS.find((entry) => entry.id === id);
  if (!job) return { ok: false, reason: 'Unknown repair.' };
  const work = ensureCampaignRepairs(state)[id];
  const complete = repairComplete(state, id);
  const prereq = repairPrerequisite(state, id);
  return {
    ok: true,
    id,
    label: job.label,
    removed: !!work.removed,
    complete,
    prerequisiteMet: prereq.ok,
    blockedReason: prereq.reason,
    repairKits: availableCampaignUnits(state, CAMPAIGN_SKUS.repair),
  };
}

export function workCampaignRepair(state, id) {
  const campaign = ensureCampaign(state);
  if (!campaign || !campaign.enabled) return { ok: false, reason: 'The reopening campaign is not active.' };
  const status = campaignRepairStatus(state, id);
  if (!status.ok) return status;
  if (status.complete) return { ok: false, reason: `${status.label} is already restored.` };
  if (!status.prerequisiteMet) return { ok: false, reason: status.blockedReason };
  const work = ensureCampaignRepairs(state)[id];
  if (!work.removed) {
    work.removed = true;
    return { ok: true, id, stage: 'removed', label: status.label };
  }
  const consumed = consumeCampaignUnit(state, CAMPAIGN_SKUS.repair);
  if (!consumed.ok) return consumed;
  let result;
  if (id === 'entranceDoor') {
    renoOf(state).entranceDoorRepaired = true;
    result = { ok: true, changed: true };
  } else {
    result = setArchitectureComponent(state, id, true);
  }
  if (!result.ok) {
    // The state mutation failed; return the conserved kit to the location it
    // came from rather than losing a paid component.
    state.shop.inventory[CAMPAIGN_SKUS.repair].back += 1;
    return result;
  }
  return { ok: true, id, stage: 'installed', label: status.label, consumedFrom: consumed.from };
}

function fixtureSetPresent(state, ids) {
  return ids.every((id) => !!fixtureById(state, id));
}

function visibleStarterStock(state) {
  const lines = SHOP_CATALOG
    .filter((sku) => RETAIL_CATS.has(sku.cat))
    .map((sku) => ({ sku, qty: Math.max(0, Math.floor(finite(state.shop.inventory?.[sku.id]?.shelf))) }))
    .filter((entry) => entry.qty > 0);
  return {
    units: lines.reduce((sum, entry) => sum + entry.qty, 0),
    lines: lines.length,
    detail: lines,
  };
}

function rectsOverlap(a, b) {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxZ > b.minZ && a.minZ < b.maxZ;
}

function criticalBoxBlockers(state) {
  const critical = [
    DOOR_CLEARWAY,
    BACKDOOR_CLEARWAY,
    frontDeskRect({
      minX: -FRONT_DESK_FRAME.frontLength / 2 - 0.3,
      maxX: FRONT_DESK_FRAME.frontLength / 2 + 0.3,
      minZ: -FRONT_DESK_FRAME.frontDepth / 2 - 1.0,
      maxZ: FRONT_DESK_FRAME.frontDepth / 2 + 1.1,
    }),
    FRONT_DESK_COLLIDERS.returnRun,
  ];
  return (state?.shop?.deliveries?.boxes || []).filter((box) => {
    if (box.loc !== 'world' || !Number.isFinite(box.x) || !Number.isFinite(box.z)) return false;
    const dims = boxDims(box.box);
    const swap = Math.abs(Math.sin(finite(box.ry))) > 0.5;
    const hx = (swap ? dims.d : dims.w) / 2;
    const hz = (swap ? dims.w : dims.d) / 2;
    const rect = { minX: box.x - hx, maxX: box.x + hx, minZ: box.z - hz, maxZ: box.z + hz };
    return critical.some((zone) => rectsOverlap(rect, zone));
  });
}

export function openingReadiness(state) {
  const campaign = ensureCampaign(state);
  const zones = campaignZoneProgress(state);
  const stock = visibleStarterStock(state);
  const routes = routesIntact(state);
  const blockingBoxes = criticalBoxBlockers(state);
  const restoration = restorationSnapshot(state);
  const furnished = Object.keys(CAMPAIGN_FACILITIES)
    .every((id) => facilityInstalled(state, id))
    && fixtureSetPresent(state, [
      'shelf_balls', 'shelf_acc', 'shelf_small', 'table_polos', 'hatstand',
      'cold_drinks', 'snackrack', 'backcounter', 'backshelf_n', 'backshelf_e2',
    ]);
  const noMajorTrash = clutterRemaining(state) === 0
    && totalDebris(state) <= 0.05
    && finite(state.shop.reno.pan) <= 0.001
    && finite(state.shop.reno.bag) <= 0.001;
  const requirements = [
    { id: 'furnished', label: 'Furnished workstations and displays available', ok: furnished, reason: 'Recover any missing authored workstation or display from storage.' },
    { id: 'laptop', label: 'Pine Hills front-desk tee-sheet usable', ok: laptopReadiness(state).ready, reason: laptopReadiness(state).requirements.find((item) => !item.ok)?.reason || '' },
    { id: 'cleanup-details', label: 'Neglected clubhouse details cleaned', ok: !!restoration?.complete.discreteCleanup, reason: 'Clear each marked mess, scuff, cobweb, and disordered furnishing.' },
    { id: 'cleanup-systems', label: 'Floors, windows, clutter, and debris cleaned', ok: !!restoration?.complete.existingCleanupSystems, reason: 'Finish the floor, windows, general clutter, and loose-debris cleanup.' },
    { id: 'lighting', label: 'Faulty ceiling lights repaired', ok: !!restoration?.complete.lighting, reason: ceilingCircuitPowered(state) ? 'Repair the faulty ceiling panels.' : 'Restore the ceiling circuit, then repair the faulty panels.' },
    {
      id: 'repairs',
      label: 'Structural damage repaired',
      ok: CAMPAIGN_REPAIR_JOBS.every((job) => repairComplete(state, job.id)),
      reason: `Repair the damaged structure first (${CAMPAIGN_REPAIR_JOBS.filter((job) => repairComplete(state, job.id)).length}/${CAMPAIGN_REPAIR_JOBS.length} complete). Each repair unlocks after its area is cleaned.`,
    },
    { id: 'stock', label: 'All six starter retail groups restocked', ok: !!restoration?.complete.restocking, reason: `Open the three inherited cartons and fill balls, accessories, headwear, apparel, cooler, and snacks (${restoration?.counts.restockCompleted || 0}/6 complete).` },
    { id: 'lobby', label: 'Lobby clean enough for guests', ok: zones.lobby >= 0.72, reason: `Lobby cleanliness is ${Math.round(zones.lobby * 100)}%; reach 72%.` },
    { id: 'trash', label: 'No major blocking trash', ok: noMajorTrash, reason: 'Haul clutter, collect loose debris, empty the dustpan, and dispose of the trash bag.' },
    { id: 'routes', label: 'Customer and employee paths clear', ok: routes && blockingBoxes.length === 0, reason: !routes ? 'A moved fixture cuts off a required customer or employee route.' : `${blockingBoxes.length} delivery carton${blockingBoxes.length === 1 ? '' : 's'} blocks a doorway or checkout approach.` },
  ];
  return {
    ready: !!campaign && requirements.every((requirement) => requirement.ok),
    requirements,
    stock,
    blockingBoxes: blockingBoxes.map((box) => box.id),
  };
}

function chooseOpeningReservation(state, operatingDayAbs) {
  const now = finite(state.clock?.minutes);
  const nowDay = Math.floor(now / 1440);
  const nowMinute = calendarOf(now).minuteOfDay;
  for (let dayAbs = operatingDayAbs; dayAbs <= operatingDayAbs + 1; dayAbs++) {
    for (const minute of slotTimes()) {
      if (dayAbs === nowDay && minute < nowMinute + 35) continue;
      if (!slotAvailability(state, dayAbs, minute, 2).available) continue;
      return { dayAbs, minute };
    }
  }
  return null;
}

export function openClubhouse(state) {
  const campaign = ensureCampaign(state);
  if (!campaign || !campaign.enabled) return { ok: false, reason: 'The reopening campaign is not active.' };
  if (campaign.businessOpen) return { ok: false, reason: 'The clubhouse is already open.' };
  const readiness = openingReadiness(state);
  if (!readiness.ready) {
    const blocked = readiness.requirements.find((requirement) => !requirement.ok);
    return { ok: false, reason: blocked?.reason || 'Opening requirements are not complete.', blocked };
  }
  const now = finite(state.clock?.minutes);
  const cal = calendarOf(now);
  const operatingDayAbs = cal.minuteOfDay >= 18 * 60 ? cal.dayAbs + 1 : cal.dayAbs;
  campaign.businessOpen = true;
  campaign.openedAt = now;
  campaign.operatingDayAbs = operatingDayAbs;
  campaign.openingBaseline = {
    nextTransactionNo: Math.max(1, finite(state.shop.nextTransactionNo, 1)),
    reviewCount: state.club?.reviews?.length || 0,
    cash: round2(state.cash),
    stock: Object.fromEntries(SHOP_CATALOG
      .filter((sku) => RETAIL_CATS.has(sku.cat))
      .map((sku) => [sku.id, Math.max(0, Math.floor(finite(state.shop.inventory?.[sku.id]?.shelf)))])),
  };
  const slot = chooseOpeningReservation(state, operatingDayAbs);
  let booking = null;
  if (slot) {
    const teeAbs = slot.dayAbs * 1440 + slot.minute;
    booking = bookReservation(state, {
      dayAbs: slot.dayAbs,
      minute: slot.minute,
      fullName: 'Maya Thompson',
      partySize: 2,
      source: 'campaign-opening-day',
      paymentPreference: 'card',
      willNoShow: false,
      bankDeposit: false,
      plannedArrival: teeAbs - 12,
      arrivalWindow: { start: teeAbs - 14, end: teeAbs - 10 },
      travelVariationMin: 0,
      parkingDelayMin: 0,
      weatherDelayMin: 0,
    });
    if (booking.ok) campaign.openingReservationId = booking.res.id;
  }
  return { ok: true, readiness, booking, operatingDayAbs };
}

function ticketsSinceOpening(state) {
  const campaign = ensureCampaign(state);
  const at = finite(campaign?.openedAt, Infinity);
  return (state?.shop?.transactionHistory || []).filter((ticket) => finite(ticket?.minute, -Infinity) >= at);
}

export function firstDayProgress(state) {
  const campaign = ensureCampaign(state);
  if (!campaign?.businessOpen) {
    return { checkIn: false, merchandiseSale: false, shelfGap: false, revenue: 0, review: false, booksClosed: false, complete: false };
  }
  const tickets = ticketsSinceOpening(state);
  const checkIn = tickets.some((ticket) => ticket.type === RESERVATION_CHECK_IN_TYPE);
  const merchandiseTickets = tickets.filter((ticket) => !ticket.type
    && Array.isArray(ticket.items)
    && ticket.items.some((item) => RETAIL_CATS.has(skuById(item.skuId)?.cat)));
  const merchandiseSale = merchandiseTickets.length > 0;
  const baselineStock = campaign.openingBaseline?.stock || {};
  const shelfGap = Object.entries(baselineStock).some(([skuId, opening]) => (
    opening > finite(state.shop.inventory?.[skuId]?.shelf)
  ));
  const revenue = (state.ledger?.txLog || [])
    .filter((entry) => entry.kind === 'rev' && finite(entry.m, -Infinity) >= finite(campaign.openedAt, Infinity))
    .reduce((sum, entry) => sum + finite(entry.amt), 0);
  const review = (state.club?.reviews?.length || 0) > finite(campaign.openingBaseline?.reviewCount);
  const result = (state.ledger?.history || []).find((entry) => entry.dayAbs === campaign.operatingDayAbs) || null;
  const booksClosed = !!result;
  const complete = checkIn && merchandiseSale && shelfGap && revenue > 0 && review && booksClosed;
  return {
    checkIn,
    merchandiseSale,
    merchandiseTickets: merchandiseTickets.length,
    shelfGap,
    revenue: round2(revenue),
    review,
    booksClosed,
    result,
    complete,
  };
}

function objective(id, title, {
  complete = false,
  progress = complete ? 1 : 0,
  blocked = null,
  tool = null,
  optional = false,
  zone = null,
  hint = '',
} = {}) {
  return {
    id, title, complete: !!complete, progress: clamp01(progress), blocked,
    recommendedTool: tool, optional: !!optional, zone, hint,
  };
}

function objectiveList(state) {
  const campaign = ensureCampaign(state);
  const zones = campaignZoneProgress(state);
  const laptop = laptopReadiness(state);
  const readiness = openingReadiness(state);
  const first = firstDayProgress(state);
  const restoration = restorationSnapshot(state);
  const tools = campaign.cleaningToolsUsed || {};
  const debrisTool = !tools.broom ? 'Push broom'
    : !tools.dustpan ? 'Dustpan'
      : !tools.trashbag ? 'Trash bag'
        : finite(state.shop.reno.pan) > 0 ? 'Empty the dustpan at the disposal bin'
          : finite(state.shop.reno.bag) > 0 ? 'Dispose of the filled trash bag'
            : 'Vacuum for the last fine debris';
  const floorTool = !tools.vacuum ? 'Shop vacuum'
    : !tools.spray ? 'Cleaning spray'
      : !tools.cloth ? 'Microfibre cloth over sprayed patches'
        : !tools.mop ? 'Mop for the final hard-floor pass'
          : 'Use the tool that matches the remaining patch';
  const entered = !!campaign.events.enteredClubhouse;
  const looked = !!campaign.events.lookedAround;
  const walked = !!campaign.events.walkedToClubhouse;
  const furnished = readiness.requirements.find((item) => item.id === 'furnished')?.ok;
  return [
    objective('survey', 'Survey the neglected property', {
      complete: looked && walked,
      progress: (Number(looked) + Number(walked)) / 2,
      hint: 'Look around, then walk toward the clubhouse. You keep control throughout.',
      zone: 'grounds',
    }),
    objective('enter', 'Enter the closed clubhouse', {
      complete: entered,
      blocked: walked ? null : 'Walk up to the porch first.',
      hint: 'Open the green entrance doors with E and step inside.',
      zone: 'entrance',
    }),
    objective('entrance-trash', 'Remove the entrance and lobby trash', {
      complete: clutterRemaining(state, { minX: -10.25, maxX: 5.7, minZ: 2.5, maxZ: 6.5 }) === 0,
      progress: clutterRemaining(state, { minX: -10.25, maxX: 5.7, minZ: 2.5, maxZ: 6.5 }) === 0 ? 1 : zones.entrance * 0.35,
      blocked: entered ? null : 'Step inside to reach the old cartons.',
      hint: 'Face each old clutter pile and press E to haul it out.',
      zone: 'entrance',
    }),
    objective('loose-debris', 'Sweep, collect, and dispose of loose debris', {
      complete: !!restoration?.cleanupMilestones['generic-debris'],
      progress: zones.looseDebris,
      blocked: entered ? null : 'The cleaning kit is staged inside.',
      tool: debrisTool,
      hint: 'The broom gathers loose debris. Collect some with the dustpan, bag the rest, then empty both at the stockroom disposal bin.',
      zone: 'sales floor',
    }),
    objective('lobby-clean', 'Deep-clean the lobby and entrance mat', {
      complete: !!restoration?.cleanupMilestones.floor,
      progress: restoration?.cleanupMilestones.floor ? 1 : zones.lobby,
      blocked: entered ? null : 'Enter the clubhouse first.',
      tool: floorTool,
      hint: 'Use F to cycle the inherited cleaning kit: vacuum dust, spray and wipe smears, then mop the hard floor and mat area.',
      zone: 'lobby',
    }),
    objective('windows-clean', 'Wipe the key clubhouse windows', {
      complete: !!restoration?.cleanupMilestones.windows,
      progress: restoration?.cleanupMilestones.windows ? 1 : zones.windows,
      tool: 'Cleaning spray and cloth',
      optional: true,
      hint: 'Work one pane at a time; the daylight changes as the film lifts.',
      zone: 'windows',
    }),
    objective('exterior-clean', 'Pressure wash the porch and exterior', {
      complete: exteriorWashScore(state) >= 0.65,
      progress: exteriorWashScore(state) / 0.65,
      tool: surfaceClean(state, 'porch') < 0.58 ? 'Pressure washer: soap, dwell, then rinse' : 'Pressure washer',
      optional: !laptop.ready,
      hint: 'Heavy porch and foundation staining needs soap before the jet can lift it.',
      zone: 'exterior',
    }),
    objective('furnished-inspection', 'Inspect the furnished clubhouse workstations', {
      complete: furnished && entered && looked,
      progress: (Number(!!furnished) + Number(entered) + Number(looked)) / 3,
      tool: 'Direct workstation inspection',
      blocked: entered ? null : 'Step inside the clubhouse first.',
      hint: 'Check the shared front desk, reception tee-sheet laptop, pro-shop displays, lounge, and cleaning bay.',
      zone: 'clubhouse',
    }),
    objective('cleanup-details', 'Clear the visible neglect and straighten the lounge', {
      complete: !!restoration?.complete.discreteCleanup,
      progress: restoration ? restoration.counts.cleanupCompleted / restoration.counts.cleanupTotal : 0,
      blocked: entered ? null : 'Step inside to reach the marked cleanup details.',
      tool: 'Matching cleaning tool or direct straighten interaction',
      hint: 'Clear the leaves, cobwebs, scuffs, food waste, desk clutter, fallen frame, and crooked chair.',
      zone: 'clubhouse',
    }),
    objective('lighting-repairs', 'Repair the faulty ceiling lights', {
      complete: !!restoration?.complete.lighting,
      progress: restoration ? restoration.counts.lightsRepaired / restoration.counts.lightsTotal : 0,
      // Both gates, in the order the player meets them. Until the circuit is
      // live every fitting is dark and neither fault is visible or repairable,
      // so describing one as "flickering" here names a state that does not
      // exist yet — the same lie the in-room prompt used to tell.
      blocked: entered
        ? (ceilingCircuitPowered(state)
          ? null
          : 'The ceiling circuit is dead - finish the office power and ceiling repair first.')
        : 'Enter the clubhouse to inspect the ceiling panels.',
      tool: 'Ceiling light repair interaction',
      hint: ceilingCircuitPowered(state)
        ? 'Repair the panel that flickers and the panel that stays dead.'
        : 'Both ceiling panels are dark until the circuit is live. Restore power first.',
      zone: 'clubhouse ceiling',
    }),
    objective('structural-repairs', 'Repair the damaged structure', {
      complete: CAMPAIGN_REPAIR_JOBS.every((job) => repairComplete(state, job.id)),
      progress: CAMPAIGN_REPAIR_JOBS.filter((job) => repairComplete(state, job.id)).length
        / CAMPAIGN_REPAIR_JOBS.length,
      blocked: entered ? null : 'Step inside to survey the damage first.',
      tool: 'Clubhouse repair components',
      hint: (() => {
        const next = CAMPAIGN_REPAIR_JOBS.find((job) => !repairComplete(state, job.id));
        if (!next) return 'Every structural component is repaired.';
        const status = campaignRepairStatus(state, next.id);
        return status.prerequisiteMet
          ? `${status.label}: remove the damaged piece, then install repair components (${status.repairKits} on hand).`
          : `${status.label}: ${status.blockedReason}`;
      })(),
      zone: 'clubhouse structure',
    }),
    objective('starter-stock', 'Open the three cartons and restock every fixture', {
      complete: !!restoration?.complete.restocking,
      progress: restoration ? restoration.counts.restockCompleted / restoration.counts.restockTotal : 0,
      blocked: facilityInstalled(state, 'displayShelves') ? null : 'Install the display shelves first.',
      tool: 'Unboxed balls, tees, gloves, or provisions',
      hint: `${restoration?.counts.restockCompleted || 0} of 6 retail groups are full. Carry each carton line to its matching fixture or cooler.`,
      zone: 'sales floor',
    }),
    objective('organize-floor', 'Organize the floor and keep every route clear', {
      complete: readiness.requirements.find((item) => item.id === 'routes')?.ok,
      blocked: readiness.requirements.find((item) => item.id === 'routes')?.reason,
      hint: 'Use build mode for misplaced fixtures and move cartons out of doorways and the checkout approach.',
      zone: 'clubhouse',
    }),
    objective('open', 'Open the clubhouse for business', {
      complete: campaign.businessOpen,
      progress: readiness.requirements.filter((item) => item.ok).length / readiness.requirements.length,
      blocked: readiness.ready ? null : readiness.requirements.find((item) => !item.ok)?.reason,
      hint: readiness.ready ? 'Use the CLOSED hours sign on the porch, or the Opening page on the front-desk laptop.' : 'Review the opening requirements on the front-desk laptop.',
      zone: 'front entrance',
    }),
    objective('first-checkin', 'Check in the first tee-time guest', {
      complete: first.checkIn,
      blocked: campaign.businessOpen ? null : 'Open the clubhouse first.',
      hint: 'The first reservation arrives gradually. Serve the named guest at the shared front-desk monitor.',
      zone: 'front desk',
    }),
    objective('first-sale', 'Complete the first merchandise sale', {
      complete: first.merchandiseSale,
      blocked: campaign.businessOpen ? null : 'Open the clubhouse first.',
      hint: 'Let a shopper browse, then scan, take payment, print the receipt, bag, and hand over the purchase.',
      zone: 'checkout',
    }),
    objective('shelf-gap', 'Notice the first shelf gap', {
      complete: first.shelfGap,
      blocked: first.merchandiseSale ? null : 'A real sale must remove stock first.',
      optional: true,
      hint: 'The sold unit leaves a visible gap. Check Inventory on the front-desk laptop when it is time to reorder.',
      zone: 'sales floor',
    }),
    objective('first-review', 'Receive the first customer review', {
      complete: first.review,
      blocked: campaign.businessOpen ? null : 'Open the clubhouse first.',
      hint: 'A real visitor writes feedback from cleanliness, stock, wait time, and service.',
      zone: 'reviews',
    }),
    objective('first-day-close', 'Finish and review the first business day', {
      complete: first.complete,
      progress: [first.checkIn, first.merchandiseSale, first.shelfGap, first.revenue > 0, first.review, first.booksClosed].filter(Boolean).length / 6,
      blocked: campaign.businessOpen ? null : 'Open the clubhouse first.',
      hint: first.booksClosed
        ? 'Review the real revenue, expenses, net result, and reputation feedback.'
        : 'Complete a check-in and sale; the books close at midnight and the next goal follows.',
      zone: 'business day',
    }),
  ];
}

function phaseFor(state) {
  const campaign = ensureCampaign(state);
  const first = firstDayProgress(state);
  if (campaign.firstDayComplete || first.complete) return 'complete';
  if (campaign.businessOpen) return 'opening-day';
  if (openingReadiness(state).ready) return 'ready-to-open';
  if (!campaign.events.enteredClubhouse) return 'arrival';
  if (!restorationSnapshot(state)?.complete.lighting) return 'repairs';
  return 'setup';
}

// K (Goal 23) — THE PHASE IS A CHAPTER, NOT THE TASK AGAIN.
//
// "The task card is double-printed." It is not, structurally: one card, one
// title, printed once (tools/qa/electron-k-hud-card.js reads the DOM). What it
// IS, is the same instruction twice in different words, stacked -- the very
// first thing a new player reads was
//
//   Inspect the furnished but neglected property     <- phase
//   Survey the neglected property                    <- task
//
// A phase is the chapter you are in; the task is what to do next. When the
// chapter restates the task the card wastes its most valuable line and reads as
// a stutter, which is exactly what it looked like to someone seeing it cold.
const PHASE_TITLES = Object.freeze({
  arrival: 'Arriving at Pine Hills',
  'restore-office': 'Getting the office running',
  repairs: 'Clean and repair the clubhouse',
  setup: 'Stocking the shop',
  'ready-to-open': 'Ready to open',
  'opening-day': 'Opening day',
  complete: 'Running the club',
});

export function campaignView(state) {
  const campaign = ensureCampaign(state);
  if (!campaign || !campaign.enabled) return null;
  const tasks = objectiveList(state);
  const phase = phaseFor(state);
  const actionable = tasks.find((task) => !task.complete && !task.optional && !task.blocked);
  const currentTask = actionable || tasks.find((task) => !task.complete && !task.optional) || null;
  const optional = tasks.filter((task) => task.optional && !task.complete).slice(0, 4);
  const completed = tasks.filter((task) => task.complete);
  return {
    phase,
    mainObjective: PHASE_TITLES[phase],
    currentTask,
    optional,
    tasks,
    completedCount: completed.length,
    totalCount: tasks.length,
    zoneProgress: campaignZoneProgress(state),
    opening: openingReadiness(state),
    firstDay: firstDayProgress(state),
    history: campaign.history.slice(0, 16),
    hidden: campaign.hidden,
  };
}

export function tickCampaign(state) {
  const campaign = ensureCampaign(state);
  const result = { advanced: [], phaseChanged: null, firstDayCompleted: false };
  if (!campaign || !campaign.enabled) return result;
  const view = campaignView(state);
  const known = new Set(campaign.completedObjectiveIds);
  for (const task of view.tasks) {
    if (!task.complete || known.has(task.id)) continue;
    known.add(task.id);
    campaign.completedObjectiveIds.push(task.id);
    const entry = {
      id: task.id,
      title: task.title,
      minute: finite(state.clock?.minutes),
      zone: task.zone,
    };
    campaign.history.unshift(entry);
    if (campaign.history.length > 40) campaign.history.length = 40;
    result.advanced.push(task);
  }
  const nextPhase = phaseFor(state);
  if (campaign.phase !== nextPhase) {
    result.phaseChanged = { from: campaign.phase, to: nextPhase, title: PHASE_TITLES[nextPhase] };
    campaign.phase = nextPhase;
  }
  const first = firstDayProgress(state);
  if (first.complete && !campaign.firstDayComplete) {
    campaign.firstDayComplete = true;
    result.firstDayCompleted = true;
  }
  return result;
}

export function dismissCampaignGuide(state) {
  const campaign = ensureCampaign(state);
  if (!campaign) return false;
  campaign.hidden = true;
  return true;
}

export function resetCampaignGuide(state) {
  const campaign = ensureCampaign(state);
  if (!campaign) return false;
  campaign.hidden = false;
  campaign.completedObjectiveIds = [];
  campaign.history = [];
  // The world is untouched. The next tick re-banks everything the player has
  // genuinely done and resumes at the first unmet task.
  tickCampaign(state);
  return true;
}

function consumedCampaignUnits(state, skuId) {
  const facilities = ensureCampaignFacilities(state);
  if (skuId === CAMPAIGN_SKUS.repair) {
    return CAMPAIGN_REPAIR_JOBS.filter((job) => repairComplete(state, job.id)).length;
  }
  const map = {
    [CAMPAIGN_SKUS.desk]: Number(facilities.officeDesk),
    [CAMPAIGN_SKUS.chair]: Number(facilities.officeChair),
    [CAMPAIGN_SKUS.laptop]: Number(facilities.laptop),
    [CAMPAIGN_SKUS.counter]: Number(facilities.frontCounter),
    [CAMPAIGN_SKUS.shelves]: Number(facilities.displayShelves) + Number(facilities.stockroomShelves),
    [CAMPAIGN_SKUS.safety]: Number(facilities.safety),
  };
  return map[skuId] || 0;
}

export function campaignItemAccounting(state, skuId) {
  const campaign = ensureCampaign(state);
  if (!campaign) return null;
  const expected = Math.max(0, Math.floor(finite(campaign.starterEntitlements?.[skuId])))
    + Math.max(0, Math.floor(finite(campaign.purchased?.[skuId])));
  const inv = state.shop.inventory?.[skuId] || {};
  const inventory = Math.max(0, Math.floor(finite(inv.shelf))) + Math.max(0, Math.floor(finite(inv.back)));
  const carry = carriedMatching(state, skuId);
  const boxes = (state.shop.deliveries?.boxes || [])
    .filter((box) => box.skuId === skuId)
    .reduce((sum, box) => sum + Math.max(0, Math.floor(finite(box.qty))), 0);
  const orders = (state.shop.orders || [])
    .filter((order) => order.skuId === skuId)
    .reduce((sum, order) => sum + Math.max(0, Math.floor(finite(order.qty))), 0);
  const consumed = consumedCampaignUnits(state, skuId);
  const accounted = inventory + carry + boxes + orders + consumed;
  return { skuId, expected, accounted, missing: Math.max(0, expected - accounted), inventory, carry, boxes, orders, consumed };
}

export function campaignRecoveryStatus(state) {
  const campaign = ensureCampaign(state);
  if (!campaign || !campaign.enabled) return { needed: false, items: [], layoutBlocked: false };
  const ids = ['vac1', ...CAMPAIGN_ITEM_IDS];
  const items = ids.map((id) => campaignItemAccounting(state, id)).filter((item) => item && item.missing > 0);
  return { needed: items.length > 0 || !routesIntact(state), items, layoutBlocked: !routesIntact(state) };
}

export function recoverCampaignItem(state, skuId) {
  const accounting = campaignItemAccounting(state, skuId);
  if (!accounting || accounting.expected <= 0) {
    return { ok: false, reason: 'No owned campaign item is missing. Order it normally first.' };
  }
  if (accounting.missing <= 0) {
    return { ok: false, reason: 'Every owned unit is still in inventory, a carton, your hands, an order, or an installation.' };
  }
  if (skuId === 'vac1') {
    state.shop.inventory.vac1.back += accounting.missing;
    return { ok: true, skuId, qty: accounting.missing, immediate: true };
  }
  const order = queueCampaignDelivery(state, skuId, accounting.missing, { recovery: true });
  return order
    ? { ok: true, skuId, qty: accounting.missing, order }
    : { ok: false, reason: 'The replacement delivery could not be scheduled.' };
}

export function recoverAllCampaignItems(state) {
  const before = campaignRecoveryStatus(state);
  const recovered = [];
  for (const item of before.items) {
    const result = recoverCampaignItem(state, item.skuId);
    if (result.ok) recovered.push(result);
  }
  return { ok: recovered.length > 0, recovered, before };
}

export function recoverOpeningLayout(state) {
  const facilities = ensureCampaignFacilities(state);
  if (facilities.displayShelves) {
    for (const id of ['shelf_balls', 'shelf_acc', 'shelf_small']) restoreFixture(state, id);
  }
  if (facilities.stockroomShelves) {
    for (const id of ['backshelf_n', 'backshelf_e', 'backshelf_e2']) restoreFixture(state, id);
  }
  if (facilities.frontCounter) restoreFixture(state, 'backcounter');
  if (routesIntact(state)) return { ok: true, reset: [] };
  const layout = ensureLayout(state);
  const reset = Object.keys(layout.moved);
  layout.moved = {};
  return routesIntact(state)
    ? { ok: true, reset }
    : { ok: false, reset, reason: 'A non-movable object still blocks the authored safe layout. Move delivery cartons out of the marked clearways.' };
}
