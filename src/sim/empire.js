// GOLF EMPIRE — the empire layer: one wallet, a marketplace, and a portfolio of
// owned properties. Buying boots a full FAIRWAY STATE club (the real newGame
// wiring, fed the property's deterministic course) and then seeds it to the
// listing's stats; selling pays the displayed valuation and removes every trace —
// members, staff, golfers, all of it. Deliberately no undo.
//
// Money model: the empire has ONE wallet. While a property is active, that
// club's state.cash IS the wallet (the whole existing economy keeps working
// untouched); empire-level operations sync it back before they move money.
// Parked properties hold no cash of their own.
//
// Simulation model: exactly one property is live at a time. Parked properties
// do NOT run the sim — they carry a small `passive` summary (frozen headline
// stats + a drifting condition estimate) ticked once per world-day, and the
// drift is written into their real turf arrays when the owner returns. The
// approximation formulas live in passiveDay() below and are documented in
// DEV_LOG.md.

import { ZONE, DAY_START_MIN } from './constants.js';
import { BALANCE } from './balance.js';
import { makeRng, rngOf, clamp, formatMoney } from '../core/utils.js';
import { newGame, update, snapshot, deserialize } from './state.js';
import { calendarOf } from './time.js';
import { rollDailyWeather } from './weather.js';
import { conditionRating, zonePolicyKey, DISEASE } from './turf.js';
import { courseDesignRating, holePar, holeDistanceYd } from './course.js';
import { memberCounts } from './club.js';
import { deliverOrdersDue, tickDeliveries } from './shop.js';
import { generateMarketplace, generateListing, buildPropertyCourse, appraiseStats, round500, MARKET } from './marketplace.js';
import { appraiseProperty, appraisalBreakdown } from './valuation.js';
import { seedReputation } from './reputation.js';
import {
  initEmpireProgression, ensureEmpireProgression, propertyReadiness,
  unlockEarnedTier,
} from './propertyProgression.js';
import { initBusiness } from './business.js';

export const EMPIRE_VERSION = 3;

const EMPIRE_SAVE_KEYS = new Set([
  'version', 'empireVersion', 'mode', 'seed', 'cash', 'clockMinutes',
  'activeId', 'firstPurchaseDone', 'log', 'market', 'marketRngState',
  'lastMarketDay', 'marketCondition', 'marketConditionTarget', 'progression',
  'holdings',
]);
const HOLDING_SAVE_KEYS = new Set(['property', 'passive', 'state']);

function preserveUnknownSaveFields(target, raw, knownKeys) {
  const entries = Object.entries(raw || {}).filter(([key]) => !knownKeys.has(key));
  if (!entries.length) return target;
  Object.defineProperty(target, '__unknownSaveFields', {
    value: Object.fromEntries(entries),
    writable: true,
    configurable: true,
  });
  return target;
}

// Parked-property approximation knobs (reasoning in DEV_LOG.md):
// a caretaker keeps the lights on — condition decays toward a floor but never
// below it (and a wreck is NOT restored for free), a trickle of unhosted play
// still comes through the door, and dues keep billing.
const PASSIVE = {
  floor: 38, // where an unattended-but-caretaken course bottoms out
  decay: 0.035, // fraction of the excess-over-floor lost per day (half-life ≈ 20 days)
  baseRounds: 14, // vs ~30/day at a comparable attended club — nobody is minding the till
  caretakerPerDay: 150, // caretaker wage + skeleton maintenance, per 9 holes
  utilitiesPerDay: 45, // same line the live club pays
};
const SEASON_F = [0.95, 1.15, 1.0, 0.22]; // the live club's seasonal demand shape

export function newEmpire(mode = 'relaxed', seed = Date.now() % 2147483647) {
  const market = generateMarketplace(seed);
  for (const p of market) p.listedDay = 0; // launch roster hits the market on day one
  const marketRng = makeRng(((seed ^ 0x9e3779b9) >>> 0) || 1);
  const firstTarget = Math.round((MARKET.conditionMin + marketRng.next() * (MARKET.conditionMax - MARKET.conditionMin)) * 10000) / 10000;
  const empire = {
    version: EMPIRE_VERSION,
    mode,
    seed,
    cash: BALANCE.startingCash[mode],
    market,
    holdings: [], // [{ property, state, passive|null }] — passive only while parked
    activeId: null,
    clockMinutes: DAY_START_MIN, // world time while no property is active
    firstPurchaseDone: false,
    log: [],
    // the living market: its own serializable rng stream (market luck never
    // disturbs the active club's dice) and the last world-day it processed
    marketRngState: marketRng.getState(),
    lastMarketDay: 0,
    // the pricing cycle: every empire starts at par, already drifting somewhere
    marketCondition: 1,
    marketConditionTarget: firstTarget,
  };
  initEmpireProgression(empire);
  return empire;
}

// --- plumbing -------------------------------------------------------------------

export function activeHolding(empire) {
  return empire.holdings.find((h) => h.property.id === empire.activeId) || null;
}

export function activeState(empire) {
  const h = activeHolding(empire);
  return h ? h.state : null;
}

// The active club's cash IS the wallet; pull it back before empire-level math.
export function syncWallet(empire) {
  const st = activeState(empire);
  if (st) {
    empire.cash = st.cash;
    empire.clockMinutes = st.clock.minutes;
  }
  return empire.cash;
}

export function worldMinutes(empire) {
  const st = activeState(empire);
  return st ? st.clock.minutes : empire.clockMinutes;
}

function empireLog(empire, text, kind = 'deed', day = null) {
  empire.log.unshift({ day: day ?? calendarOf(worldMinutes(empire)).dayAbs, text, kind });
  if (empire.log.length > 30) empire.log.pop();
}

// --- seeding a bought property to its listing --------------------------------------

// Iterate the turf arrays until the REAL condition rating (the same number the
// HUD shows) lands on the target. Used at purchase and when a parked property's
// drifted estimate is reconciled back into the world.
function driftTurfToward(state, target) {
  const t = state.turf;
  const { zones } = state.course;
  const policies = state.maintenance.policies;
  for (let pass = 0; pass < 30; pass++) {
    const gap = target - conditionRating(state);
    if (Math.abs(gap) <= 1.5) break;
    for (let i = 0; i < zones.length; i++) {
      const key = zonePolicyKey(zones[i]);
      if (!key) continue;
      t.health[i] = clamp(t.health[i] + gap * 0.55, 3, 97);
      if (gap > 0) {
        t.heightMm[i] += (policies[key].mowHeightMm - t.heightMm[i]) * 0.35;
        t.wear[i] = Math.max(0, t.wear[i] * 0.8 - 1);
      } else {
        t.heightMm[i] = Math.min(t.heightMm[i] * 1.1 + 0.6, 95);
        t.wear[i] = Math.min(t.wear[i] + 2.5, 85);
      }
    }
  }
}

// Wipe the default fixer-upper diseases, infect exactly what the listing
// promised, then drift the surface to the listed condition.
function seedTurfToCondition(state, property) {
  const t = state.turf;
  t.disType.fill(0);
  t.disSev.fill(0);
  t.treated.fill(0);

  const rng = makeRng((property.seed ^ 0x5eed) >>> 0 || 1);
  const kind = property.diseaseKind === 'brownPatch' ? DISEASE.BROWN_PATCH : DISEASE.DOLLAR_SPOT;
  const greens = state.sections.filter((s) => s.zone === ZONE.GREEN && s.holeId != null);
  const shuffled = [...greens];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const baseSev = clamp(18 + (58 - property.condition) * 0.45, 8, 50);
  for (let k = 0; k < Math.min(property.sickGreens, shuffled.length); k++) {
    for (const i of shuffled[k].cells) {
      if (rng.next() < 0.6) {
        t.disType[i] = kind;
        t.disSev[i] = clamp(baseSev + (rng.next() - 0.5) * 12, 5, 90);
        t.health[i] = clamp(t.health[i] - t.disSev[i] * 0.25, 8, 100);
        // brown patch is a saturation disease — the diagnosis copy should be true
        if (kind === DISEASE.BROWN_PATCH) t.moisture[i] = clamp(Math.max(t.moisture[i], 68 + rng.next() * 10), 0, 100);
      }
    }
  }
  driftTurfToward(state, property.condition);
}

// A distressed sale rarely conveys the whole book: trim or grow the seeded
// membership to the listing's count (poorest walk first; wealthiest sign first).
function seedMembership(state, property) {
  const pool = state.golfers.pool;
  const target = property.startingMembers;
  const current = pool.filter((g) => g.memberTier);
  if (current.length > target) {
    const ordered = [...current].sort((a, b) => a.wealth - b.wealth || a.id - b.id);
    for (let i = 0; i < current.length - target; i++) {
      ordered[i].memberTier = null;
      ordered[i].joinedDay = -1;
    }
  } else if (current.length < target) {
    const prospects = pool
      .filter((g) => !g.memberTier && !g.leftForever)
      .sort((a, b) => b.wealth - a.wealth || a.id - b.id);
    for (let i = 0; i < target - current.length && i < prospects.length; i++) {
      const g = prospects[i];
      g.memberTier = g.wealth >= 4 ? 'premium' : g.wealth >= 2 ? 'full' : 'weekday';
      g.joinedDay = 0;
      g.satisfaction = Math.max(g.satisfaction, 45);
    }
  }
}

// The full existing newGame() wiring — turf, club, staff, shop, golfers,
// ledger, progression, tutorial — booted onto the property's real course,
// then seeded to the listing's condition, membership, and reputation.
export function initPropertyState(property, mode) {
  const state = newGame(mode, property.seed, {
    course: buildPropertyCourse(property),
    clubName: property.name,
    propertyId: property.id,
    tierId: property.tierId || 'neglectedPublic',
    acquisitionCost: property.askingPrice,
  });
  state.cash = 0; // the empire wallet is the only money there is
  seedTurfToCondition(state, property);
  seedMembership(state, property);
  seedReputation(state, property.startingReputation);
  // what the place is worth is what the rent is sized off (sim/property.js)
  state.club.valuation = property.askingPrice;
  // the golf world has roughly heard of it to the extent the locals like it
  state.progression.prestige = clamp(8 + property.startingReputation * 0.3, 5, 30);
  initBusiness(state);
  return state;
}

// --- transactions ----------------------------------------------------------------

export function buyProperty(empire, propertyId) {
  syncWallet(empire);
  const i = empire.market.findIndex((p) => p.id === propertyId);
  if (i === -1) return { ok: false, reason: 'That listing is gone.' };
  const property = empire.market[i];
  if (empire.cash < property.askingPrice) {
    return {
      ok: false,
      reason: `Not enough cash — ${property.name} is asking ${formatMoney(property.askingPrice)} and the empire holds ${formatMoney(empire.cash)}.`,
    };
  }
  empire.market.splice(i, 1);
  empire.cash -= property.askingPrice;
  const payer = activeState(empire);
  if (payer) payer.cash = empire.cash; // the active club's books are the wallet

  const state = initPropertyState(property, empire.mode);
  // join the shared world clock and roll a real forecast for its first day
  state.clock.minutes = worldMinutes(empire);
  rollDailyWeather(state.weather, rngOf(state), calendarOf(state.clock.minutes).dayOfYear);
  if (empire.firstPurchaseDone) {
    // you already know how to run a club — the guide only teaches once
    state.tutorial.complete = true;
    state.tutorial.hidden = true;
  } else {
    empire.firstPurchaseDone = true;
  }

  const holding = { property, state, passive: null };
  empire.holdings.push(holding);
  if (!empire.activeId) {
    empire.activeId = property.id;
    state.cash = empire.cash;
  } else {
    parkHolding(holding); // bought sight-unseen: it waits, caretaken, until visited
  }
  empireLog(empire, `Bought ${property.name} for ${formatMoney(property.askingPrice)}.`);
  return { ok: true, property, state };
}

// What a holding is worth right now — the SAME number a sale pays out.
// Active: the live appraisal. Parked: the frozen summary + drifted condition.
export function holdingValue(empire, holding) {
  if (holding.property.id === empire.activeId || !holding.passive) {
    return appraiseProperty(holding.state);
  }
  const p = holding.passive;
  return appraiseStats({
    size: holding.property.size,
    design: p.design,
    condition: p.conditionEst,
    members: p.members,
    reputation: p.reputation,
    monthlyNet: p.lastNet * 24,
  });
}

function saleBreakdown(empire, holding) {
  const live = appraisalBreakdown(holding.state);
  const value = holdingValue(empire, holding);
  return { ...live, value, grossSaleValue: value };
}

export function latestPropertyAppraisal(empire, propertyId) {
  return ensureEmpireProgression(empire).appraisals
    .filter((item) => item.propertyId === propertyId)
    .sort((a, b) => b.createdDay - a.createdDay || b.sequence - a.sequence)[0] || null;
}

export function requestPropertyAppraisal(empire, propertyId) {
  syncWallet(empire);
  const holding = empire.holdings.find((item) => item.property.id === propertyId);
  if (!holding) return { ok: false, reason: "You don't own that property." };
  const progression = ensureEmpireProgression(empire);
  const sequence = progression.nextAppraisalId++;
  const id = `appraisal-${sequence}`;
  const day = calendarOf(worldMinutes(empire)).dayAbs;
  const breakdown = saleBreakdown(empire, holding);
  const readiness = propertyReadiness(holding.state, empire);
  const marketModifier = Math.round(clamp(empire.marketCondition || 1, MARKET.conditionMin, MARKET.conditionMax) * 1000) / 1000;
  const offer = round500(breakdown.grossSaleValue * marketModifier);
  const closingCosts = Math.round(Math.max(750, offer * 0.035) * 100) / 100;
  const outstanding = Math.round(Math.max(0, breakdown.outstanding || 0) * 100) / 100;
  const netProceeds = Math.max(0, Math.round((offer - closingCosts - outstanding) * 100) / 100);
  const appraisal = {
    id,
    sequence,
    propertyId,
    propertyName: holding.property.name,
    tierId: holding.property.tierId || holding.state.property?.tierId || 'neglectedPublic',
    createdDay: day,
    expiresDay: day + 5,
    status: readiness.saleEligible ? 'offered' : 'information',
    eligible: readiness.saleEligible,
    offer,
    appraisedValue: breakdown.grossSaleValue,
    marketModifier,
    closingCosts,
    outstanding,
    netProceeds,
    acquisitionCost: breakdown.acquisitionCost,
    restorationInvestment: breakdown.restorationInvestment,
    valuation: breakdown,
    readiness,
  };
  // A newly requested valuation replaces every earlier open quote for this
  // property. This prevents a player from collecting several offers and later
  // accepting a stale high-water mark after the live property has changed.
  for (const previous of progression.appraisals) {
    if (previous.propertyId !== propertyId || !['offered', 'information'].includes(previous.status)) continue;
    previous.status = 'superseded';
    previous.closedDay = day;
  }
  progression.appraisals.push(appraisal);
  if (progression.appraisals.length > 30) progression.appraisals.shift();
  empireLog(empire, readiness.saleEligible
    ? `Appraisal received for ${holding.property.name}: ${formatMoney(offer)} offer, ${formatMoney(netProceeds)} net.`
    : `Appraisal completed for ${holding.property.name}; sale requirements remain.`, 'appraisal', day);
  return { ok: true, appraisal };
}

export function rejectPropertyAppraisal(empire, appraisalId, choice = 'rejected') {
  const appraisal = ensureEmpireProgression(empire).appraisals.find((item) => item.id === appraisalId);
  if (!appraisal) return { ok: false, reason: 'That appraisal is no longer available.' };
  if (!['offered', 'information'].includes(appraisal.status)) return { ok: false, reason: 'That appraisal is already closed.' };
  appraisal.status = choice === 'keep' ? 'kept' : 'rejected';
  appraisal.closedDay = calendarOf(worldMinutes(empire)).dayAbs;
  return { ok: true, appraisal };
}

function performSale(empire, index, payout) {
  const holding = empire.holdings[index];
  const propertyId = holding.property.id;
  const name = holding.property.name;
  empire.holdings.splice(index, 1);
  empire.cash = Math.round((empire.cash + payout) * 100) / 100;
  if (empire.activeId === propertyId) {
    empire.clockMinutes = holding.state.clock.minutes;
    empire.activeId = null;
  } else {
    const state = activeState(empire);
    if (state) state.cash = empire.cash;
  }
  return { holding, propertyId, name };
}

function recordCompletedSale(empire, holding, details) {
  const progression = ensureEmpireProgression(empire);
  const acquisitionCost = holding.state.property?.acquisitionCost || holding.property.askingPrice || 0;
  const completed = {
    id: details.saleId,
    appraisalId: details.appraisalId || null,
    propertyId: holding.property.id,
    propertyName: holding.property.name,
    tierId: holding.property.tierId || holding.state.property?.tierId || 'neglectedPublic',
    day: calendarOf(worldMinutes(empire)).dayAbs,
    acquisitionCost,
    restorationInvestment: details.restorationInvestment || 0,
    grossOffer: details.grossOffer,
    closingCosts: details.closingCosts || 0,
    outstanding: details.outstanding || 0,
    netProceeds: details.netProceeds,
    profit: Math.round((details.netProceeds - acquisitionCost) * 100) / 100,
  };
  progression.completedSales.push(completed);
  if (progression.completedSales.length > 40) progression.completedSales.shift();
  progression.processedSaleIds[details.saleId] = completed;
  const unlockedTier = unlockEarnedTier(empire, holding.state);
  return { completed, unlockedTier };
}

export function confirmPropertySale(empire, propertyId, appraisalId, confirmed = false) {
  if (!confirmed) return { ok: false, reason: 'Explicit sale confirmation is required.' };
  syncWallet(empire);
  const progression = ensureEmpireProgression(empire);
  const saleId = `sale:${appraisalId}`;
  if (progression.processedSaleIds[saleId]) {
    const prior = progression.processedSaleIds[saleId];
    return { ok: false, duplicate: true, reason: 'That sale has already closed.', payout: prior.netProceeds };
  }
  const appraisal = progression.appraisals.find((item) => item.id === appraisalId && item.propertyId === propertyId);
  if (!appraisal || appraisal.status !== 'offered') return { ok: false, reason: 'Request a current sale appraisal first.' };
  const newer = progression.appraisals.some((item) => item.propertyId === propertyId && item.sequence > appraisal.sequence);
  if (newer) {
    appraisal.status = 'superseded';
    return { ok: false, reason: 'That offer was superseded. Use the newest appraisal.' };
  }
  const day = calendarOf(worldMinutes(empire)).dayAbs;
  if (day > appraisal.expiresDay) {
    appraisal.status = 'expired';
    return { ok: false, reason: 'That offer expired. Request a new appraisal.' };
  }
  const index = empire.holdings.findIndex((item) => item.property.id === propertyId);
  if (index < 0) return { ok: false, reason: "You don't own that property." };
  const holding = empire.holdings[index];
  const readiness = propertyReadiness(holding.state, empire);
  if (!readiness.saleEligible) return { ok: false, reason: 'The property no longer meets the sale requirements.' };

  progression.saleBackups.push({
    id: `backup:${saleId}`,
    createdDay: day,
    cashBefore: empire.cash,
    activeId: empire.activeId,
    property: holding.property,
    passive: holding.passive,
    state: snapshot(holding.state),
  });
  while (progression.saleBackups.length > 3) progression.saleBackups.shift();

  const sold = performSale(empire, index, appraisal.netProceeds);
  appraisal.status = 'accepted';
  appraisal.closedDay = day;
  const recorded = recordCompletedSale(empire, sold.holding, {
    saleId,
    appraisalId,
    grossOffer: appraisal.offer,
    closingCosts: appraisal.closingCosts,
    outstanding: appraisal.outstanding,
    netProceeds: appraisal.netProceeds,
    restorationInvestment: appraisal.restorationInvestment,
  });
  empireLog(empire, `Sold ${sold.name}: ${formatMoney(appraisal.offer)} offer, ${formatMoney(appraisal.netProceeds)} net after closing.`, 'sale', day);
  return { ok: true, payout: appraisal.netProceeds, appraisal, ...recorded };
}

export function sellProperty(empire, propertyId) {
  syncWallet(empire);
  const i = empire.holdings.findIndex((h) => h.property.id === propertyId);
  if (i === -1) return { ok: false, reason: "You don't own that property." };
  const holding = empire.holdings[i];
  const payout = holdingValue(empire, holding);
  const saleId = `legacy-sale:${propertyId}:${ensureEmpireProgression(empire).completedSales.length + 1}`;
  const sold = performSale(empire, i, payout);
  recordCompletedSale(empire, sold.holding, { saleId, grossOffer: payout, netProceeds: payout });
  empireLog(empire, `Sold ${sold.name} for ${formatMoney(payout)}. No going back now.`);
  return { ok: true, payout };
}

// --- parking, passive days, and coming back ------------------------------------------

// Freeze the headline stats the passive tick needs; the full state just waits.
function parkHolding(holding) {
  const st = holding.state;
  const counts = memberCounts(st);
  holding.passive = {
    conditionEst: conditionRating(st),
    design: Math.round(courseDesignRating(st.course, st.sections) * 10) / 10,
    members: counts.weekday + counts.full + counts.premium,
    reputation: Math.round(st.club.reputation * 10) / 10,
    greenFee: st.club.greenFee,
    duesPerDay: Math.round(((counts.weekday * st.club.dues.weekday + counts.full * st.club.dues.full + counts.premium * st.club.dues.premium) / 24) * 100) / 100,
    days: 0,
    lastNet: 0,
    sinceVisitNet: 0,
    accruedNet: holding.passive ? holding.passive.accruedNet : 0,
  };
  st.cash = 0;
}

// One world-day for one parked property. See DEV_LOG.md for the reasoning.
function passiveDay(empire, holding, seasonIndex) {
  const p = holding.passive;
  if (p.conditionEst > PASSIVE.floor) {
    p.conditionEst = Math.max(PASSIVE.floor, p.conditionEst - (p.conditionEst - PASSIVE.floor) * PASSIVE.decay);
  }
  const sizeF = holding.property.size / 9;
  const q = 0.4 * p.design + 0.6 * p.conditionEst; // the same overall-rating blend the HUD uses
  const rounds = Math.max(0, PASSIVE.baseRounds * SEASON_F[seasonIndex] * (q / 60) * clamp(p.reputation / 45, 0.3, 1.4) * sizeF);
  const revenue = rounds * p.greenFee + p.duesPerDay;
  const costs = PASSIVE.caretakerPerDay * sizeF + PASSIVE.utilitiesPerDay;
  const net = clamp(Math.round(revenue - costs), -800 * sizeF, 2600 * sizeF);
  p.lastNet = net;
  p.days++;
  p.sinceVisitNet += net;
  p.accruedNet += net;
  empire.cash += net;
}

function passiveTickAll(empire, days) {
  const seasonIndex = calendarOf(worldMinutes(empire)).seasonIndex;
  for (const h of empire.holdings) {
    if (h.property.id === empire.activeId || !h.passive) continue;
    for (let d = 0; d < days; d++) passiveDay(empire, h, seasonIndex);
  }
}

// Returning to a parked property writes the passive story back into the world:
// clock catches up, the drifted condition estimate becomes real turf, shipped
// orders are in the backroom, and anything time-sensitive you weren't there
// for is resolved honestly (unhosted outings are simply lost).
function reconcileOnActivate(empire, holding) {
  const st = holding.state;
  const p = holding.passive;
  const now = worldMinutes(empire);
  if (now <= st.clock.minutes) return; // no world time passed — pure unpark
  st.clock.minutes = now;
  const dayAbs = calendarOf(now).dayAbs;
  if (p) driftTurfToward(st, p.conditionEst);
  deliverOrdersDue(st, dayAbs);
  tickDeliveries(st, now); // windowed orders whose truck came while parked
  const missed = st.club.outings.scheduled.filter((o) => o.day < dayAbs);
  if (missed.length) {
    st.club.outings.scheduled = st.club.outings.scheduled.filter((o) => o.day >= dayAbs);
    for (const o of missed) {
      st.club.feed.unshift({ kind: 'outing', day: dayAbs, text: `${o.company}'s outing came and went while ownership was elsewhere.` });
    }
    if (st.club.feed.length > 20) st.club.feed.length = 20;
  }
  st.club.outings.offers = st.club.outings.offers.filter((o) => o.expiresDay >= dayAbs);
  rollDailyWeather(st.weather, rngOf(st), calendarOf(now).dayOfYear);
  st.pendingMorning = true;
}

export function switchProperty(empire, propertyId) {
  const target = empire.holdings.find((h) => h.property.id === propertyId);
  if (!target) return { ok: false, reason: "You don't own that property." };
  if (empire.activeId === propertyId) return { ok: true, state: target.state, already: true };
  syncWallet(empire);
  const outgoing = activeHolding(empire);
  if (outgoing) parkHolding(outgoing);
  reconcileOnActivate(empire, target);
  target.passive = null; // active holdings live for real
  empire.activeId = propertyId;
  target.state.cash = empire.cash;
  empireLog(empire, `Moved the office to ${target.property.name}.`);
  return { ok: true, state: target.state };
}

// --- the living market ----------------------------------------------------------------
// One roll of market life per world-day. New listings appear on a steady
// cadence, capped so the window never becomes a warehouse; a dry market is
// guaranteed restocking. Knobs live in MARKET (marketplace.js), reasoning in
// DEV_LOG.md. The market only moves while world time moves — no active club,
// no passage of time, no churn.

// Who beats you to a deal. Pure flavor — the money and the course both leave the game.
const RIVALS = [
  'Fairline Capital', 'Northgate Leisure Group', 'the Pemberton family trust',
  'Meridian Golf Partners', 'Bluecap Hospitality', 'a consortium of dentists',
  'Old Harbour Holdings', 'the county park district',
];

function marketDay(empire, day) {
  const rng = makeRng(empire.marketRngState);
  // the buyer's/seller's cycle drifts first, so today's arrivals price on
  // today's mood: a slow lerp toward a target that re-rolls about once a
  // season, a whisper of daily noise, hard-clamped to the tuned bounds
  if (day % MARKET.conditionRetargetDays === 0) {
    empire.marketConditionTarget = Math.round(
      (MARKET.conditionMin + rng.next() * (MARKET.conditionMax - MARKET.conditionMin)) * 10000,
    ) / 10000;
  }
  const drifted = empire.marketCondition
    + (empire.marketConditionTarget - empire.marketCondition) * MARKET.conditionLerp
    + (rng.next() - 0.5) * MARKET.conditionNoise;
  empire.marketCondition = Math.round(clamp(drifted, MARKET.conditionMin, MARKET.conditionMax) * 10000) / 10000;

  // rival investors pick off listings that sat too long — but the grace window
  // guarantees anything you're actively weighing up can't vanish overnight
  for (let i = empire.market.length - 1; i >= 0; i--) {
    const p = empire.market[i];
    if (day - (p.listedDay ?? 0) < MARKET.minDaysListed) continue;
    if (!rng.chance(MARKET.rivalDailyChance)) continue;
    empire.market.splice(i, 1);
    empireLog(empire, `${RIVALS[rng.int(RIVALS.length)]} bought ${p.name} — it's off the market.`, 'rival', day);
  }
  if (day % MARKET.refreshEveryDays === 0 && empire.market.length < MARKET.maxListings) {
    const chance = empire.market.length <= MARKET.dryMarketFloor ? 1 : MARKET.refreshChance;
    if (rng.chance(chance)) {
      const taken = (field) => [
        ...empire.market.map((p) => p[field]),
        ...empire.holdings.map((h) => h.property[field]),
      ];
      const listing = generateListing(1 + rng.int(2147483646), {
        marketCondition: empire.marketCondition,
        takenNames: taken('name'),
        takenIds: taken('id'),
      });
      listing.listedDay = day;
      empire.market.push(listing);
      empireLog(empire, `New on the market: ${listing.name} — asking ${formatMoney(listing.askingPrice)}.`, 'market', day);
    }
  }
  empire.marketRngState = rng.getState();
}

export function marketTick(empire) {
  const day = calendarOf(worldMinutes(empire)).dayAbs;
  if (!Number.isFinite(empire.lastMarketDay)) empire.lastMarketDay = day;
  while (empire.lastMarketDay < day) {
    empire.lastMarketDay += 1;
    marketDay(empire, empire.lastMarketDay);
  }
}

// The one tick the app calls: advance the active club's full simulation, then
// give every parked property its passive world-days and settle the wallet.
export function empireUpdate(empire, gameMinutes) {
  const st = activeState(empire);
  if (!st) return { daysPassed: 0 };
  const res = update(st, gameMinutes);
  empire.cash = st.cash;
  if (res.daysPassed > 0) {
    passiveTickAll(empire, res.daysPassed);
    marketTick(empire);
    st.cash = empire.cash;
  }
  empire.clockMinutes = st.clock.minutes;
  return res;
}

// --- persistence -----------------------------------------------------------------

export function empireSnapshot(empire) {
  syncWallet(empire);
  return {
    ...(empire.__unknownSaveFields || {}),
    empireVersion: EMPIRE_VERSION,
    mode: empire.mode,
    seed: empire.seed,
    cash: Math.round(empire.cash * 100) / 100,
    clockMinutes: worldMinutes(empire),
    activeId: empire.activeId,
    firstPurchaseDone: empire.firstPurchaseDone,
    log: empire.log,
    market: empire.market,
    marketRngState: empire.marketRngState,
    lastMarketDay: empire.lastMarketDay,
    marketCondition: empire.marketCondition,
    marketConditionTarget: empire.marketConditionTarget,
    progression: ensureEmpireProgression(empire),
    holdings: empire.holdings.map((h) => ({
      ...(h.__unknownSaveFields || {}),
      property: h.property,
      passive: h.passive,
      state: snapshot(h.state),
    })),
  };
}

export function serializeEmpire(empire) {
  return JSON.stringify(empireSnapshot(empire));
}

// A pre-empire single-club save (plain GameState JSON) loads as a one-property
// empire so nothing anyone saved ever becomes unreadable.
function legacyEmpireFrom(raw) {
  const st = deserialize(raw);
  const counts = memberCounts(st);
  const record = {
    id: 'legacy-club',
    tierId: st.course.holes.length >= 14 ? 'establishedLocal' : 'neglectedPublic',
    name: st.clubName,
    blurb: 'The original club, carried into the empire era.',
    size: st.course.holes.length >= 14 ? 18 : 9,
    seed: st.seed,
    layout: { kind: 'willow' },
    condition: conditionRating(st),
    sickGreens: 0,
    diseaseKind: 'dollarSpot',
    startingMembers: counts.weekday + counts.full + counts.premium,
    startingReputation: Math.round(st.club.reputation),
    design: Math.round(courseDesignRating(st.course, st.sections) * 10) / 10,
    par: st.course.holes.reduce((sum, h) => sum + (h.tee && h.pin ? holePar(h) : 0), 0),
    yards: Math.round(st.course.holes.reduce((sum, h) => sum + holeDistanceYd(h), 0)),
    estMonthlyNet: 0,
    trueValue: appraiseProperty(st),
    askingPrice: appraiseProperty(st),
  };
  const joinDay = calendarOf(st.clock.minutes).dayAbs;
  st.property.id = record.id;
  st.property.tierId = record.tierId;
  if (!st.property.acquisitionCost) st.property.acquisitionCost = record.askingPrice;
  const market = generateMarketplace(st.seed).filter((p) => p.id !== 'willow-creek');
  for (const p of market) p.listedDay = joinDay; // listed "today" — a fair fresh start
  const empire = {
    version: EMPIRE_VERSION,
    mode: st.mode,
    seed: st.seed,
    cash: st.cash,
    market,
    holdings: [{ property: record, state: st, passive: null }],
    activeId: record.id,
    clockMinutes: st.clock.minutes,
    firstPurchaseDone: true,
    log: [],
    marketRngState: ((st.seed ^ 0x9e3779b9) >>> 0) || 1,
    lastMarketDay: joinDay,
    marketCondition: 1,
    marketConditionTarget: 1,
  };
  initEmpireProgression(empire);
  return empire;
}

export function deserializeEmpire(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data.empireVersion) return legacyEmpireFrom(data);
  const empire = {
    version: EMPIRE_VERSION,
    mode: data.mode,
    seed: data.seed,
    cash: data.cash,
    market: data.market,
    holdings: data.holdings.map((h) => preserveUnknownSaveFields({
      property: h.property,
      passive: h.passive ?? null,
      state: deserialize(h.state),
    }, h, HOLDING_SAVE_KEYS)),
    activeId: data.activeId,
    clockMinutes: data.clockMinutes,
    firstPurchaseDone: !!data.firstPurchaseDone,
    log: data.log || [],
    marketRngState: data.marketRngState,
    lastMarketDay: data.lastMarketDay,
    marketCondition: data.marketCondition,
    marketConditionTarget: data.marketConditionTarget,
    progression: data.progression,
  };
  ensureEmpireProgression(empire);
  // saves written before the living market existed: grow the stream, join the
  // market clock at the save's own world day, start the pricing cycle at par,
  // and give the frozen listings a fresh (fair) listing date — their expiry
  // clock starts now, not in arrears
  if (!Number.isFinite(empire.marketRngState)) {
    empire.marketRngState = (((empire.seed ?? 1) ^ 0x9e3779b9) >>> 0) || 1;
  }
  if (!Number.isFinite(empire.lastMarketDay)) {
    empire.lastMarketDay = calendarOf(empire.clockMinutes ?? 0).dayAbs;
  }
  if (!Number.isFinite(empire.marketCondition)) empire.marketCondition = 1;
  if (!Number.isFinite(empire.marketConditionTarget)) empire.marketConditionTarget = 1;
  for (const p of empire.market) {
    if (!Number.isFinite(p.listedDay)) p.listedDay = empire.lastMarketDay;
    if (!p.tierId) p.tierId = p.size >= 18 ? 'establishedLocal' : 'neglectedPublic';
  }
  for (const holding of empire.holdings) {
    if (!holding.property.tierId) holding.property.tierId = holding.property.size >= 18 ? 'establishedLocal' : 'neglectedPublic';
    holding.state.property.id = holding.property.id;
    holding.state.property.tierId = holding.property.tierId;
    if (!holding.state.property.acquisitionCost) holding.state.property.acquisitionCost = holding.property.askingPrice || 0;
  }
  return preserveUnknownSaveFields(empire, data, EMPIRE_SAVE_KEYS);
}
