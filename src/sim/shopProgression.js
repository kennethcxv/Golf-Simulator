// PRO SHOP EXPANSION — one durable authority for what the retail operation is.
//
// A tier is not a badge. It determines which authored fixtures are installed,
// which supplier categories are useful, how many customers may occupy the shop,
// how much sellable display capacity exists, which finish/lighting treatment the
// clubhouse renders, and how much the work adds to the property appraisal.

import { addExpense } from './economy.js';
import { notify } from './notifications.js';
import { calendarOf } from './time.js';
import { capacityOf } from '../data/fixtureSlots.js';
import { FIXTURES } from '../data/shopLayout.js';

export const SHOP_TIER_ORDER = Object.freeze(['basic', 'standard', 'premium', 'luxury']);

export const SHOP_TIERS = Object.freeze({
  basic: Object.freeze({
    id: 'basic', label: 'BASIC', name: 'Starter shop', cost: 0, days: 0,
    customerCapacity: 2, supplierTier: 1, propertyValue: 0,
    categories: Object.freeze(['balls', 'apparel', 'accessories']),
    finish: 'Painted boards · utility lighting · starter counter',
    summary: 'A compact sales bay, one stock run, and the original laptop counter.',
    unlocks: Object.freeze(['Compact retail bay', 'Four starter displays', 'Basic stock shelving', '2-customer floor']),
  }),
  standard: Object.freeze({
    id: 'standard', label: 'STANDARD', name: 'Working pro shop', cost: 6500, days: 2,
    customerCapacity: 4, supplierTier: 2, propertyValue: 7500,
    categories: Object.freeze(['balls', 'apparel', 'accessories', 'clubs', 'provisions']),
    finish: 'Natural oak · improved worktop · full sales lighting',
    summary: 'Opens the main retail floor, expands receiving, and adds value and standard suppliers.',
    unlocks: Object.freeze(['Main retail floor', 'Club and apparel fixtures', 'Expanded stockroom', 'Tier-2 suppliers', '4-customer floor']),
  }),
  premium: Object.freeze({
    id: 'premium', label: 'PREMIUM', name: 'Full-service pro shop', cost: 16000, days: 4,
    customerCapacity: 6, supplierTier: 3, propertyValue: 20000,
    categories: Object.freeze(['balls', 'apparel', 'accessories', 'clubs', 'provisions']),
    finish: 'Medium walnut · deep green · focused display lighting',
    summary: 'Completes the premium display floor, fitting area, member lounge, and supplier range.',
    unlocks: Object.freeze(['Premium displays', 'Fitting and shoe area', 'Member lounge', 'Feature merchandising', 'Tier-3 suppliers', '6-customer floor']),
  }),
  luxury: Object.freeze({
    id: 'luxury', label: 'LUXURY', name: 'Club retail destination', cost: 35000, days: 6,
    customerCapacity: 8, supplierTier: 3, propertyValue: 45000,
    categories: Object.freeze(['balls', 'apparel', 'accessories', 'clubs', 'provisions']),
    finish: 'Select walnut · restrained brass · showcase lighting',
    summary: 'Turns the finished shop into a destination with luxury trim, entrance presence, and maximum service capacity.',
    unlocks: Object.freeze(['Luxury finish package', 'Brass checkout frontage', 'Showcase entrance', 'Trophy presentation', '8-customer floor']),
  }),
});

// Authored fixture installation schedule. Checkout itself is permanent and is
// intentionally absent: accepted register geometry and handoff routes never move.
const FIXTURE_TIER = Object.freeze({
  shelf_balls: 'basic',
  shelf_acc: 'basic',
  shelf_small: 'basic',
  hatstand: 'basic',
  backcounter: 'basic',
  backshelf_n: 'basic',

  rack_drivers: 'standard',
  rack_irons: 'standard',
  table_polos: 'standard',
  bagstand: 'standard',
  cold_drinks: 'standard',
  snack_rack: 'standard',
  member_station: 'standard',
  backshelf_e: 'standard',

  rack_putters: 'premium',
  fittingroom: 'premium',
  shoerack: 'premium',
  feature: 'premium',
  tour_vault: 'premium',
  putting_demo: 'premium',
  backshelf_e2: 'premium',
});

const tierIndex = (id) => Math.max(0, SHOP_TIER_ORDER.indexOf(id));

export function shopTierIndex(state, tierId = null) {
  const id = tierId || state?.shop?.progression?.tier || 'basic';
  return tierIndex(id);
}

export function shopTier(state) {
  return SHOP_TIERS[SHOP_TIER_ORDER[shopTierIndex(state)]];
}

export function fixtureRequiredTier(fixtureId) {
  return FIXTURE_TIER[fixtureId] || 'basic';
}

export function fixtureUnlockedForTier(fixtureId, tierId) {
  return tierIndex(fixtureRequiredTier(fixtureId)) <= tierIndex(tierId);
}

export function fixtureIsInstalled(state, fixtureId, tierId = null) {
  const progression = state?.shop?.progression;
  const fixture = FIXTURES.find((entry) => entry.id === fixtureId);
  if (fixture?.generatedOnly && !state?.shop?.generation) return false;
  if (!tierId && state?.campaign?.enabled) {
    const facilities = state.shop?.reno?.facilities || {};
    if (facilities.displayShelves
      && ['shelf_balls', 'shelf_acc', 'shelf_small'].includes(fixtureId)) return true;
    if (facilities.stockroomShelves
      && ['backshelf_n', 'backshelf_e', 'backshelf_e2'].includes(fixtureId)) return true;
  }
  // Pre-v12 saves keep the exact floor they were already using until they buy
  // their next tier. This is explicit migration compatibility, not a second
  // runtime authority for new games.
  if (!tierId && progression?.legacyFullLayout) return true;
  const resolved = tierId || progression?.tier || 'basic';
  return fixtureUnlockedForTier(fixtureId, resolved);
}

function syncBenefits(state) {
  const spec = shopTier(state);
  if (!Number.isFinite(state.shop.unlockedTier)) state.shop.unlockedTier = spec.supplierTier;
  else state.shop.unlockedTier = Math.max(state.shop.unlockedTier, spec.supplierTier);
}

export function initShopProgression(state) {
  state.shop.progression = {
    tier: 'basic',
    pending: null,
    completedAtDay: 0,
    legacyFullLayout: false,
  };
  state.shop.unlockedTier = 1;
  return state.shop.progression;
}

export function ensureShopProgression(state, { legacy = false } = {}) {
  if (!state?.shop) return null;
  if (!state.shop.progression || typeof state.shop.progression !== 'object') {
    state.shop.progression = {
      tier: legacy ? 'standard' : 'basic',
      pending: null,
      completedAtDay: 0,
      legacyFullLayout: !!legacy,
    };
  }
  const p = state.shop.progression;
  if (!SHOP_TIERS[p.tier]) p.tier = legacy ? 'standard' : 'basic';
  if (p.pending && !SHOP_TIERS[p.pending.target]) p.pending = null;
  p.legacyFullLayout = !!p.legacyFullLayout;
  syncBenefits(state);
  return p;
}

export function nextShopTier(state) {
  const next = shopTierIndex(state) + 1;
  return next < SHOP_TIER_ORDER.length ? SHOP_TIERS[SHOP_TIER_ORDER[next]] : null;
}

export function shopCategoryUnlocked(state, category) {
  if (!category || ['decor', 'supplies'].includes(category)) return true;
  return shopTier(state).categories.includes(category);
}

export function shopCustomerCapacity(state) {
  return shopTier(state).customerCapacity;
}

export function shopPropertyImprovementValue(state) {
  const currentValue = shopTier(state).propertyValue;
  const conveyedTier = state?.shop?.generation?.startingTier;
  const conveyedValue = SHOP_TIERS[conveyedTier]?.propertyValue || 0;
  return Math.max(0, currentValue - conveyedValue);
}

export function installedShopFixtures(state, tierId = null) {
  return FIXTURES.filter((fixture) => fixtureIsInstalled(state, fixture.id, tierId));
}

export function shopProductCapacity(state, tierId = null) {
  return installedShopFixtures(state, tierId).reduce((total, fixture) => (
    total + fixture.skus.reduce((sum, skuId) => sum + capacityOf(skuId), 0)
  ), 0);
}

export function beginShopExpansion(state, targetId) {
  const progression = ensureShopProgression(state);
  const target = SHOP_TIERS[targetId];
  if (!target) return { ok: false, reason: 'That shop tier does not exist.' };
  if (progression.pending) return { ok: false, reason: 'Shop construction is already under way.' };
  const expected = nextShopTier(state);
  if (!expected || expected.id !== targetId) {
    return { ok: false, reason: expected ? `Build ${expected.label} first.` : 'The shop is already at its best.' };
  }
  if (state.cash < target.cost) return { ok: false, reason: 'Not enough cash for this fit-out.' };

  addExpense(state, 'capitalImprovements', target.cost);
  progression.pending = {
    target: target.id,
    daysLeft: target.days,
    totalDays: target.days,
    startedDay: calendarOf(state.clock.minutes).dayAbs,
    blocked: false,
    blocker: null,
  };
  notify(state, {
    kind: 'money',
    text: `${target.label} pro-shop construction started — ${target.days} days.`,
    dedupeKey: `shop-tier-start:${target.id}:${progression.pending.startedDay}`,
  });
  return { ok: true, target, pending: progression.pending };
}

function activatePendingTier(state) {
  const progression = ensureShopProgression(state);
  const pending = progression.pending;
  if (!pending) return { ok: false, reason: 'No shop construction is pending.' };
  const target = SHOP_TIERS[pending.target];
  progression.tier = target.id;
  progression.completedAtDay = calendarOf(state.clock.minutes).dayAbs;
  progression.pending = null;
  progression.legacyFullLayout = false;
  syncBenefits(state);
  state.lastShopProgressionEvent = {
    kind: 'complete', tier: target.id, label: target.label,
    message: `${target.label} pro-shop construction is complete.`,
  };
  notify(state, {
    kind: 'money', text: state.lastShopProgressionEvent.message,
    dedupeKey: `shop-tier-complete:${target.id}:${progression.completedAtDay}`,
  });
  return { ok: true, target };
}

export function tryCompleteShopExpansion(state, layoutSafety = null) {
  const progression = ensureShopProgression(state);
  const pending = progression.pending;
  if (!pending) return { ok: false, reason: 'No shop construction is pending.' };
  if (pending.daysLeft > 0) return { ok: false, reason: `${pending.daysLeft} construction day${pending.daysLeft === 1 ? '' : 's'} remain.` };
  const safety = typeof layoutSafety === 'function'
    ? layoutSafety(state, pending.target)
    : { ok: true, reasons: [] };
  if (!safety.ok) {
    pending.blocked = true;
    pending.blocker = safety.reasons?.[0] || 'Clear the new fixture locations before work can finish.';
    state.lastShopProgressionEvent = {
      kind: 'blocked', tier: pending.target,
      message: `Shop construction is waiting: ${pending.blocker}`,
    };
    return { ok: false, blocked: true, reason: pending.blocker, reasons: safety.reasons || [] };
  }
  return activatePendingTier(state);
}

export function tickShopProgressionDaily(state, layoutSafety = null) {
  const progression = ensureShopProgression(state);
  if (!progression.pending) return null;
  progression.pending.daysLeft = Math.max(0, progression.pending.daysLeft - 1);
  if (progression.pending.daysLeft > 0) return { ok: true, pending: progression.pending };
  return tryCompleteShopExpansion(state, layoutSafety);
}

export function shopProgressionSummary(state) {
  const progression = ensureShopProgression(state);
  const current = shopTier(state);
  return {
    current,
    pending: progression.pending,
    next: nextShopTier(state),
    customerCapacity: shopCustomerCapacity(state),
    productCapacity: shopProductCapacity(state),
    propertyValue: shopPropertyImprovementValue(state),
  };
}
