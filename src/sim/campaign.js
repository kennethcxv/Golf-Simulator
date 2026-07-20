// FIRST-TIME PROPERTY CAMPAIGN
//
// This module connects the existing restoration, delivery, layout, register,
// reservation, review, and economy systems. Campaign tasks are projections of
// those authorities. The small amount of campaign-owned state records real
// world installations, repair work stages, presentation history, and the
// opening boundary; it never substitutes a checkbox for cleaning or commerce.

import { calendarOf } from './time.js';
import { SHOP_CATALOG, RETAIL_CATS, skuById } from '../data/shopItems.js';
import { planShipment, boxDims } from '../data/boxes.js';
import { ensureDebris, seedDebris, totalDebris } from './cleaningDebris.js';
import { ensureWash, exteriorWashScore, surfaceClean } from './washing.js';
import {
  ARCHITECTURE_COMPONENTS,
  ensureClubhouseArchitecture,
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
  COUNTER,
  DOOR_CLEARWAY,
  INTERIOR,
  OFFICE,
  STOCKROOM,
} from '../data/shopLayout.js';
import { RENO, ensureShopReno } from './shop.js';
import { bookReservation, slotAvailability, slotTimes } from './reservations.js';
import { RESERVATION_CHECK_IN_TYPE } from './reservationCheckIn.js';

export const CAMPAIGN_VERSION = 1;

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
  officeChair: Object.freeze({ skuId: CAMPAIGN_SKUS.chair, label: 'office chair' }),
  laptop: Object.freeze({ skuId: CAMPAIGN_SKUS.laptop, label: 'office laptop' }),
  frontCounter: Object.freeze({ skuId: CAMPAIGN_SKUS.counter, label: 'front desk counter' }),
  registerHardware: Object.freeze({ skuId: null, label: 'register hardware' }),
  displayShelves: Object.freeze({ skuId: CAMPAIGN_SKUS.shelves, label: 'sales-floor displays' }),
  stockroomShelves: Object.freeze({ skuId: CAMPAIGN_SKUS.shelves, label: 'stockroom shelving' }),
  safety: Object.freeze({ skuId: CAMPAIGN_SKUS.safety, label: 'safety station' }),
});

const FRESH_STORED_FIXTURES = Object.freeze([
  'shelf_balls', 'shelf_acc', 'shelf_small',
  'backcounter', 'backshelf_n', 'backshelf_e', 'backshelf_e2',
]);

const FACILITY_DEFAULTS = Object.freeze(Object.fromEntries(
  Object.keys(CAMPAIGN_FACILITIES).map((id) => [id, false]),
));

const STARTER_ENTITLEMENTS = Object.freeze({
  vac1: 1,
  [CAMPAIGN_SKUS.desk]: 1,
  [CAMPAIGN_SKUS.chair]: 1,
  [CAMPAIGN_SKUS.laptop]: 1,
  [CAMPAIGN_SKUS.repair]: 1,
});

const STARTER_DELIVERY = Object.freeze([
  CAMPAIGN_SKUS.desk,
  CAMPAIGN_SKUS.chair,
  CAMPAIGN_SKUS.laptop,
  CAMPAIGN_SKUS.repair,
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

function seedFreshCampaignWorld(state) {
  // A closed fixer-upper does not begin with magically sale-ready stock.
  for (const sku of SHOP_CATALOG) {
    const inv = state.shop.inventory[sku.id] || (state.shop.inventory[sku.id] = { shelf: 0, back: 0 });
    if (RETAIL_CATS.has(sku.cat)) {
      inv.shelf = 0;
      inv.back = 0;
    }
  }

  // The cleaning kit is inherited and physically staged in the stockroom.
  // Every other starter item arrives through the normal delivery loop.
  state.shop.inventory.vac1.back = Math.max(1, finite(state.shop.inventory.vac1.back));
  const layout = ensureLayout(state);
  for (const id of FRESH_STORED_FIXTURES) {
    if (!layout.stored.includes(id)) layout.stored.push(id);
  }

  ensureDebris(state);
  if (state.shop.reno.debris.length === 0 && !state.shop.reno.debrisSeeded) {
    seedDebris(state, 30, 18, 10.5, 20260718);
    state.shop.reno.debrisSeeded = true;
  }
  ensureWash(state);
  ensureClubhouseArchitecture(state);
  ensureCampaignFacilities(state, { installed: false });
  ensureCampaignRepairs(state, { restored: false });

  for (const skuId of STARTER_DELIVERY) queueCampaignDelivery(state, skuId, 1, { inherited: true });
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
  }
  return state.campaign;
}

export function ensureCampaign(state) {
  if (!state?.campaign) return null;
  if (state.campaign.version !== CAMPAIGN_VERSION) {
    const old = state.campaign;
    state.campaign = { ...makeCampaignState(), ...old, version: CAMPAIGN_VERSION };
  }
  const campaign = state.campaign;
  campaign.events ||= {};
  campaign.cleaningToolsUsed ||= {};
  campaign.starterEntitlements ||= { ...STARTER_ENTITLEMENTS };
  campaign.purchased ||= {};
  campaign.completedObjectiveIds = Array.isArray(campaign.completedObjectiveIds)
    ? campaign.completedObjectiveIds : [];
  campaign.history = Array.isArray(campaign.history) ? campaign.history : [];
  campaign.recoverySeq = Math.max(0, Math.floor(finite(campaign.recoverySeq)));
  campaign.hidden = !!campaign.hidden;
  campaign.enabled = campaign.enabled !== false;
  campaign.businessOpen = !!campaign.businessOpen;
  campaign.firstDayComplete = !!campaign.firstDayComplete;
  ensureCampaignFacilities(state);
  ensureCampaignRepairs(state);
  ensureClubhouseArchitecture(state);
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
  for (const id of FRESH_STORED_FIXTURES) restoreFixture(state, id);
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

function carriedMatching(state, skuId) {
  const carry = state?.shop?.carry;
  return carry && carry.skuId === skuId ? Math.max(0, Math.floor(finite(carry.qty))) : 0;
}

function availableCampaignUnits(state, skuId) {
  const inv = state?.shop?.inventory?.[skuId];
  return Math.max(0, Math.floor(finite(inv?.back))) + carriedMatching(state, skuId);
}

function consumeCampaignUnit(state, skuId) {
  const carry = state?.shop?.carry;
  if (carry?.skuId === skuId && finite(carry.qty) > 0) {
    carry.qty -= 1;
    if (carry.qty <= 0) state.shop.carry = null;
    return { ok: true, from: 'hands' };
  }
  const inv = state?.shop?.inventory?.[skuId];
  if (inv && finite(inv.back) > 0) {
    inv.back -= 1;
    return { ok: true, from: 'backroom' };
  }
  const carrying = state?.shop?.carry;
  const heldName = carrying ? skuById(carrying.skuId)?.name : null;
  return {
    ok: false,
    reason: heldName
      ? `Set down the ${heldName.toLowerCase()} first.`
      : `${skuById(skuId)?.name || 'That item'} must be unpacked and carried here, or stored on the backroom shelving.`,
  };
}

export function laptopReadiness(state) {
  const zones = campaignZoneProgress(state);
  const requirements = [
    { id: 'office-clean', label: 'Clear and clean the office', ok: zones.office >= 0.55, reason: `Office cleanliness is ${Math.round(zones.office * 100)}%; reach 55%.` },
    { id: 'office-power', label: 'Restore office power and lighting', ok: repairComplete(state, 'ceiling'), reason: 'Remove the damaged ceiling/light components and install a repair kit.' },
    { id: 'office-desk', label: 'Place the office desk', ok: facilityInstalled(state, 'officeDesk'), reason: 'Unpack the inherited desk and install it at the office outline.' },
    { id: 'office-chair', label: 'Place the office chair', ok: facilityInstalled(state, 'officeChair'), reason: 'Unpack the inherited chair and install it beside the desk.' },
    { id: 'office-laptop', label: 'Physically install the laptop', ok: facilityInstalled(state, 'laptop'), reason: 'Unpack the inherited laptop and place it on the desk.' },
  ];
  return { ready: requirements.every((requirement) => requirement.ok), requirements };
}

function facilityPrerequisite(state, id) {
  const zones = campaignZoneProgress(state);
  if (id === 'officeDesk' || id === 'officeChair') {
    return zones.office >= 0.40
      ? { ok: true }
      : { ok: false, reason: `Clean the office to 40% first (currently ${Math.round(zones.office * 100)}%).` };
  }
  if (id === 'laptop') {
    if (!facilityInstalled(state, 'officeDesk') || !facilityInstalled(state, 'officeChair')) {
      return { ok: false, reason: 'Install the desk and chair first.' };
    }
    if (!repairComplete(state, 'ceiling')) return { ok: false, reason: 'Restore office power and lighting first.' };
    if (zones.office < 0.55) return { ok: false, reason: `Clean the office to 55% first (currently ${Math.round(zones.office * 100)}%).` };
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
    return { ok: false, reason: 'Restore the office and install the laptop before ordering the remaining components.' };
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
    {
      minX: COUNTER.x - COUNTER.len / 2 - 0.3,
      maxX: COUNTER.x + COUNTER.len / 2 + 0.3,
      minZ: COUNTER.z - COUNTER.depth / 2 - 1.0,
      maxZ: COUNTER.z + COUNTER.depth / 2 + 1.1,
    },
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

function allRepairsComplete(state) {
  return CAMPAIGN_REPAIR_JOBS.every((job) => repairComplete(state, job.id));
}

export function openingReadiness(state) {
  const campaign = ensureCampaign(state);
  const zones = campaignZoneProgress(state);
  const stock = visibleStarterStock(state);
  const routes = routesIntact(state);
  const blockingBoxes = criticalBoxBlockers(state);
  const noMajorTrash = clutterRemaining(state) === 0
    && totalDebris(state) <= 0.05
    && finite(state.shop.reno.pan) <= 0.001
    && finite(state.shop.reno.bag) <= 0.001;
  const requirements = [
    { id: 'repairs', label: 'Basic clubhouse repairs complete', ok: allRepairsComplete(state), reason: 'Finish each marked two-stage repair.' },
    { id: 'laptop', label: 'Office and laptop usable', ok: laptopReadiness(state).ready, reason: laptopReadiness(state).requirements.find((item) => !item.ok)?.reason || '' },
    { id: 'counter', label: 'Front counter and register working', ok: facilityInstalled(state, 'frontCounter') && facilityInstalled(state, 'registerHardware'), reason: 'Install the counter, then confirm the register hardware at the till.' },
    { id: 'display-shelves', label: 'Display shelves placed', ok: facilityInstalled(state, 'displayShelves') && fixtureSetPresent(state, ['shelf_balls', 'shelf_acc', 'shelf_small']), reason: 'Install the sales-floor shelving kit at its marked outline.' },
    { id: 'stockroom-shelves', label: 'Stockroom shelving placed', ok: facilityInstalled(state, 'stockroomShelves') && fixtureSetPresent(state, ['backshelf_n', 'backshelf_e', 'backshelf_e2']), reason: 'Install the stockroom shelving kit at its marked outline.' },
    { id: 'stock', label: 'Starter merchandise visible', ok: stock.units >= 8 && stock.lines >= 2, reason: `Put at least 8 units across 2 product lines on displays (${stock.units} units / ${stock.lines} lines now).` },
    { id: 'lobby', label: 'Lobby clean enough for guests', ok: zones.lobby >= 0.72, reason: `Lobby cleanliness is ${Math.round(zones.lobby * 100)}%; reach 72%.` },
    { id: 'trash', label: 'No major blocking trash', ok: noMajorTrash, reason: 'Haul clutter, collect loose debris, empty the dustpan, and dispose of the trash bag.' },
    { id: 'entrance', label: 'Entrance functional', ok: repairComplete(state, 'entranceDoor') && repairComplete(state, 'porch'), reason: 'Repair the doors and porch.' },
    { id: 'safety', label: 'Basic safety items installed', ok: facilityInstalled(state, 'safety'), reason: 'Install the extinguisher, first-aid kit, and exit signage.' },
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

function orderedCampaignQuantity(state, skuId) {
  return Math.max(0, Math.floor(finite(ensureCampaign(state)?.purchased?.[skuId])));
}

function starterDeliveryLanded(state) {
  const landed = new Set((state?.shop?.deliveries?.shipments || []).map((shipment) => shipment.skuId));
  return STARTER_DELIVERY.some((skuId) => landed.has(skuId));
}

function loungePlaced(state) {
  return (state?.shop?.reno?.decor || []).some((entry) => entry.skuId === 'lounge1');
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
  const debrisDone = totalDebris(state) <= 0.02
    && finite(state.shop.reno.pan) <= 0.001
    && finite(state.shop.reno.bag) <= 0.001;
  const repairDone = CAMPAIGN_REPAIR_JOBS.filter((job) => repairComplete(state, job.id)).length;
  const stock = readiness.stock;
  const entered = !!campaign.events.enteredClubhouse;
  const looked = !!campaign.events.lookedAround;
  const walked = !!campaign.events.walkedToClubhouse;
  const essentialOrders = orderedCampaignQuantity(state, CAMPAIGN_SKUS.repair) >= 7
    && orderedCampaignQuantity(state, CAMPAIGN_SKUS.counter) >= 1
    && orderedCampaignQuantity(state, CAMPAIGN_SKUS.shelves) >= 2
    && orderedCampaignQuantity(state, CAMPAIGN_SKUS.safety) >= 1;
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
      complete: debrisDone,
      progress: zones.looseDebris,
      blocked: entered ? null : 'The cleaning kit is staged inside.',
      tool: 'Broom → dustpan or trash bag → disposal bin',
      hint: 'The broom moves debris; the dustpan or vacuum collects it. Empty the pan and dispose of the bag.',
      zone: 'sales floor',
    }),
    objective('lobby-clean', 'Deep-clean the lobby and entrance mat', {
      complete: zones.lobby >= 0.72,
      progress: zones.lobby / 0.72,
      blocked: entered ? null : 'Enter the clubhouse first.',
      tool: zones.lobby < 0.35 ? 'Shop vacuum' : 'Spray + cloth, then mop',
      hint: 'Use F to cycle the inherited cleaning kit. Different tools leave different feedback.',
      zone: 'lobby',
    }),
    objective('windows-clean', 'Wipe the key clubhouse windows', {
      complete: zones.windows >= 0.60,
      progress: zones.windows / 0.60,
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
    objective('starter-delivery', 'Receive the inherited office delivery', {
      complete: starterDeliveryLanded(state),
      progress: starterDeliveryLanded(state) ? 1 : 0,
      hint: 'A van is due shortly. Move cartons from the pad, cut every tape seam, open the flaps, and carry the contents.',
      zone: 'receiving',
    }),
    objective('office-desk', 'Place the office desk', {
      complete: facilityInstalled(state, 'officeDesk'),
      blocked: zones.office < 0.40 ? `Clean the office to 40% first (${Math.round(zones.office * 100)}%).` : null,
      tool: 'Unpacked office desk flat-pack',
      hint: 'Carry the unpacked desk to the office outline and press E.',
      zone: 'office',
    }),
    objective('office-chair', 'Place the office chair', {
      complete: facilityInstalled(state, 'officeChair'),
      blocked: zones.office < 0.40 ? `Clean the office to 40% first (${Math.round(zones.office * 100)}%).` : null,
      tool: 'Unpacked office task chair',
      hint: 'Carry the chair to the office outline and press E.',
      zone: 'office',
    }),
    objective('office-power', 'Restore office power and lighting', {
      complete: repairComplete(state, 'ceiling'),
      progress: ensureCampaignRepairs(state).ceiling.removed ? 0.5 : 0,
      blocked: zones.office < 0.45 ? `Clean the office to 45% first (${Math.round(zones.office * 100)}%).` : null,
      tool: 'Inherited repair components',
      hint: 'Remove the damaged ceiling/light component, then install the replacement.',
      zone: 'office',
    }),
    objective('laptop-install', 'Install and boot the office laptop', {
      complete: laptop.ready && !!campaign.events.laptopOpened,
      progress: (laptop.requirements.filter((item) => item.ok).length + Number(!!campaign.events.laptopOpened)) / (laptop.requirements.length + 1),
      blocked: laptop.ready ? null : laptop.requirements.find((item) => !item.ok)?.reason,
      tool: 'Unpacked club office laptop',
      hint: laptop.ready ? 'Use E at the physical laptop.' : 'Complete the office requirements shown here.',
      zone: 'office',
    }),
    objective('order-opening-supplies', 'Order the reopening supplies', {
      complete: essentialOrders,
      progress: (
        Math.min(7, orderedCampaignQuantity(state, CAMPAIGN_SKUS.repair))
        + Math.min(1, orderedCampaignQuantity(state, CAMPAIGN_SKUS.counter))
        + Math.min(2, orderedCampaignQuantity(state, CAMPAIGN_SKUS.shelves))
        + Math.min(1, orderedCampaignQuantity(state, CAMPAIGN_SKUS.safety))
      ) / 11,
      blocked: laptop.ready ? null : 'Unlock the physical laptop first.',
      hint: 'Supplier: 7 repair components, 1 counter, 2 shelving kits, and 1 safety station. Add starter merchandise too.',
      zone: 'laptop',
    }),
    objective('repairs', 'Complete the basic clubhouse repairs', {
      complete: repairDone === CAMPAIGN_REPAIR_JOBS.length,
      progress: repairDone / CAMPAIGN_REPAIR_JOBS.length,
      blocked: laptop.ready ? null : 'Restore the office first; the laptop orders the remaining parts.',
      tool: 'Repair components at each marked work site',
      hint: 'Clean first, remove the damaged piece, then install one replacement component.',
      zone: 'clubhouse',
    }),
    objective('stockroom-shelves', 'Install the stockroom shelving', {
      complete: facilityInstalled(state, 'stockroomShelves') && fixtureSetPresent(state, ['backshelf_n', 'backshelf_e', 'backshelf_e2']),
      blocked: zones.stockroom < 0.45 ? `Clean the stockroom to 45% first (${Math.round(zones.stockroom * 100)}%).` : null,
      tool: 'Commercial shelving kit',
      hint: 'Carry an unpacked shelving kit to the stockroom outline.',
      zone: 'stockroom',
    }),
    objective('display-shelves', 'Install the sales-floor display shelves', {
      complete: facilityInstalled(state, 'displayShelves') && fixtureSetPresent(state, ['shelf_balls', 'shelf_acc', 'shelf_small']),
      blocked: zones.retail < 0.55 ? `Clean the sales floor to 55% first (${Math.round(zones.retail * 100)}%).` : null,
      tool: 'Commercial shelving kit',
      hint: 'Carry an unpacked shelving kit to the display outline. The authored safe layout is restored.',
      zone: 'sales floor',
    }),
    objective('counter', 'Install the front desk and register', {
      complete: facilityInstalled(state, 'frontCounter') && facilityInstalled(state, 'registerHardware'),
      progress: (Number(facilityInstalled(state, 'frontCounter')) + Number(facilityInstalled(state, 'registerHardware'))) / 2,
      blocked: repairComplete(state, 'floor') && repairComplete(state, 'panels') ? null : 'Repair the floor and counter-area panels first.',
      tool: facilityInstalled(state, 'frontCounter') ? 'Confirm the register hardware' : 'Front desk counter kit',
      hint: 'Install the counter, then interact again to power and confirm the existing checkout hardware.',
      zone: 'front desk',
    }),
    objective('safety', 'Install the safety and utility station', {
      complete: facilityInstalled(state, 'safety'),
      blocked: repairComplete(state, 'panels') ? null : 'Repair the wall panels first.',
      tool: 'Clubhouse safety station',
      hint: 'Mount the extinguisher, first-aid kit, and signage at the service-wing marker.',
      zone: 'service wing',
    }),
    objective('lounge', 'Furnish the guest lounge', {
      complete: loungePlaced(state),
      optional: true,
      tool: 'Lounge set from Clubhouse → furnishings',
      hint: 'Order and place the existing lounge set at a green furnishing ghost.',
      zone: 'lounge',
    }),
    objective('starter-stock', 'Stock visible starter merchandise', {
      complete: stock.units >= 8 && stock.lines >= 2,
      progress: Math.min(stock.units / 8, stock.lines / 2),
      blocked: facilityInstalled(state, 'displayShelves') ? null : 'Install the display shelves first.',
      tool: 'Unboxed balls, tees, gloves, or provisions',
      hint: `Shelves currently show ${stock.units} units across ${stock.lines} lines. Carry goods to their matching fixture.`,
      zone: 'sales floor',
    }),
    objective('clear-routes', 'Keep the entrance, till, and aisles clear', {
      complete: readiness.requirements.find((item) => item.id === 'routes')?.ok,
      blocked: readiness.requirements.find((item) => item.id === 'routes')?.reason,
      optional: true,
      hint: 'Build mode rejects unsafe placement; move any carton out of doorway and checkout clearways.',
      zone: 'clubhouse',
    }),
    objective('open', 'Open the clubhouse for business', {
      complete: campaign.businessOpen,
      progress: readiness.requirements.filter((item) => item.ok).length / readiness.requirements.length,
      blocked: readiness.ready ? null : readiness.requirements.find((item) => !item.ok)?.reason,
      hint: readiness.ready ? 'Use the CLOSED hours sign on the porch, or the Opening page on the laptop.' : 'Review the opening requirements on the laptop.',
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
      hint: 'The sold unit leaves a visible gap. Check Inventory on the laptop when it is time to reorder.',
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
  if (!laptopReadiness(state).ready) return campaign.events.enteredClubhouse ? 'restore-office' : 'arrival';
  if (!allRepairsComplete(state)) return 'repairs';
  return 'setup';
}

const PHASE_TITLES = Object.freeze({
  arrival: 'Claim the neglected property',
  'restore-office': 'Make the clubhouse workable',
  repairs: 'Restore the clubhouse',
  setup: 'Set up the pro shop',
  'ready-to-open': 'Open for business',
  'opening-day': 'Serve the first business day',
  complete: 'Build on opening day',
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
