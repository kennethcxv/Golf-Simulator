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
import { newGame, update, snapshot, deserializeWithReport } from './state.js';
import { calendarOf } from './time.js';
import { rollDailyWeather } from './weather.js';
import { conditionRating, zonePolicyKey, DISEASE } from './turf.js';
import { courseDesignRating, holePar, holeDistanceYd } from './course.js';
import { memberCounts } from './club.js';
import { deliverOrdersDue, tickDeliveries } from './shop.js';
import { generateMarketplace, generateListing, buildPropertyCourse, appraiseStats, MARKET } from './marketplace.js';
import { appraiseProperty } from './valuation.js';
import { bindPropertyInventory } from './propertyInventory.js';

export const EMPIRE_VERSION = 3;

export const EMPIRE_MIGRATIONS = Object.freeze([
  Object.freeze({ version: 2, name: 'living-market' }),
  Object.freeze({ version: 3, name: 'validated-portfolio-authority' }),
]);

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
    initCampaign(state, { fresh: true });
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
function legacyEmpireFromState(st) {
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
  bindPropertyInventory(st, record.id);
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
    holdings: data.holdings.map((h) => {
      const state = deserialize(h.state);
      bindPropertyInventory(state, h.property.id);
      return {
        property: h.property,
        passive: h.passive ?? null,
        state,
      };
    }),
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
}

function normalizedPropertyLayout(value, size, report, path) {
  const source = isRecord(value) ? cloneSaveValue(value, {}) : {};
  let repaired = !isRecord(value);
  const layout = {
    ...source,
    kind: typeof source.kind === 'string' && source.kind.trim()
      ? source.kind.slice(0, 80)
      : 'willow',
  };
  if (layout.kind !== source.kind) repaired = true;
  // Nine-hole vector properties treat these fields as optional feature
  // levers. The 18-hole serpentine builder reads every one arithmetically, so
  // damaged/missing values need conservative authored defaults before a
  // listing can be bought and built.
  const numeric = size === 18
    ? {
      margin: [8, 3, 30], bands: [6, 1, 18], elevAmp: [1, 0, 5], fairwayR: [2.3, 0.5, 12],
      roughR: [5, 1, 20], greenR: [1.9, 0.5, 8], greenRJitter: [0.4, 0, 4],
      doglegChance: [0.35, 0, 1], bunkers: [6, 0, 100], ponds: [1, 0, 20],
    }
    : {
      elevAmp: [1, 0, 5], greenR: [1.9, 0.5, 8], bunkers: [6, 0, 100],
      ponds: [1, 0, 20],
    };
  for (const [key, [fallback, min, max]] of Object.entries(numeric)) {
    // Vector-course levers are optional and have builder defaults. Absence is
    // therefore canonical for nine-hole records; only validate a lever that
    // was actually persisted.
    if (size !== 18 && !Object.hasOwn(source, key)) continue;
    const normalized = finiteNumber(source[key], fallback, {
      integer: key === 'bands' || key === 'bunkers' || key === 'ponds', min, max,
    });
    if (typeof source[key] !== 'number' || !Object.is(source[key], normalized)) repaired = true;
    layout[key] = normalized;
  }
  if (size === 18) {
    const defaultParMix = [4, 3, 4, 5, 4, 4, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 4];
    const sourceParMix = Array.isArray(source.parMix) ? source.parMix.slice(0, 18) : [];
    const parMix = sourceParMix
      .map((par) => finiteNumber(par, 0, { integer: true, min: 0, max: 10 }))
      .filter((par) => par >= 3 && par <= 5);
    if (!parMix.length || parMix.length !== sourceParMix.length
        || !Array.isArray(source.parMix) || source.parMix.length > 18) repaired = true;
    layout.parMix = parMix.length ? parMix : defaultParMix;

    const defaultParRange = { 3: [13, 29], 4: [33, 54], 5: [60, 70] };
    if (isRecord(source.parRange)) {
      const parRange = cloneSaveValue(source.parRange, {});
      for (const par of [3, 4, 5]) {
        if (!Object.hasOwn(source.parRange, par)) continue;
        const range = source.parRange[par];
        if (!Array.isArray(range) || range.length < 2
            || !Number.isFinite(Number(range[0])) || !Number.isFinite(Number(range[1]))) {
          parRange[par] = defaultParRange[par];
          repaired = true;
          continue;
        }
        const lo = finiteNumber(range[0], defaultParRange[par][0], { min: 1, max: 120 });
        const hi = finiteNumber(range[1], defaultParRange[par][1], { min: lo, max: 160 });
        parRange[par] = [lo, hi];
        if (range.length !== 2 || typeof range[0] !== 'number' || typeof range[1] !== 'number'
            || !Object.is(range[0], lo) || !Object.is(range[1], hi)) repaired = true;
      }
      layout.parRange = parRange;
    } else if (source.parRange != null) {
      delete layout.parRange;
      repaired = true;
    }
  }
  if (repaired) noteRepair(report, path, 'invalid property layout fields normalized');
  return layout;
}

function normalizedMarketProperty(value, index, seed, listedDay, report) {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    noteRepair(report, `$.market[${index}]`, 'identity-less market listing removed');
    return null;
  }
  const property = cloneSaveValue(value, {});
  let repaired = false;
  const assign = (key, normalized) => {
    if (!Object.is(property[key], normalized)) repaired = true;
    property[key] = normalized;
  };
  assign('id', property.id.trim().slice(0, 160));
  assign('name', typeof property.name === 'string' && property.name.trim()
    ? property.name.slice(0, 200)
    : `Recovered listing ${index + 1}`);
  assign('blurb', typeof property.blurb === 'string' ? property.blurb.slice(0, 2000) : '');
  assign('size', property.size === 18 ? 18 : 9);
  assign('seed', finiteNumber(property.seed, seed + index + 1, {
    integer: true, min: 1, max: 2147483647,
  }));
  property.layout = normalizedPropertyLayout(
    property.layout,
    property.size,
    report,
    `$.market[${index}].layout`,
  );
  assign('condition', finiteNumber(property.condition, 50, { min: 0, max: 100 }));
  assign('sickGreens', finiteNumber(property.sickGreens, 0, { integer: true, min: 0, max: 18 }));
  assign('diseaseKind', property.diseaseKind === 'brownPatch' ? 'brownPatch' : 'dollarSpot');
  assign('startingMembers', finiteNumber(property.startingMembers, 0, {
    integer: true, min: 0, max: 1_000_000,
  }));
  assign('startingReputation', finiteNumber(property.startingReputation, 0, { min: 0, max: 100 }));
  assign('design', finiteNumber(property.design, 0, { min: 0, max: 100 }));
  assign('par', finiteNumber(property.par, 0, { integer: true, min: 0, max: 200 }));
  assign('yards', finiteNumber(property.yards, 0, { integer: true, min: 0, max: 20_000 }));
  assign('estMonthlyNet', finiteNumber(property.estMonthlyNet, 0, {
    min: -1_000_000_000, max: 1_000_000_000,
  }));
  assign('trueValue', finiteNumber(property.trueValue, 0, { min: 0, max: 1_000_000_000_000 }));
  assign('askingPrice', finiteNumber(property.askingPrice, property.trueValue, {
    min: 0, max: 1_000_000_000_000,
  }));
  assign('listedDay', finiteNumber(property.listedDay, listedDay, {
    integer: true, min: 0, max: Number.MAX_SAFE_INTEGER,
  }));
  if (repaired) noteRepair(report, `$.market[${index}]`, 'invalid market listing fields normalized');
  return property;
}

function normalizedPassive(value, state, index, report) {
  if (!isRecord(value)) return null;
  const passive = cloneSaveValue(value, {});
  let repaired = false;
  const counts = () => {
    const member = memberCounts(state);
    return member.weekday + member.full + member.premium;
  };
  const fields = {
    conditionEst: [() => conditionRating(state), 0, 100, false],
    design: [() => courseDesignRating(state.course, state.sections), 0, 100, false],
    members: [counts, 0, 1_000_000, true],
    reputation: [() => state.club.reputation, 0, 100, false],
    greenFee: [() => state.club.greenFee, 0, 1_000_000, false],
    duesPerDay: [() => 0, -1_000_000, 1_000_000, false],
    days: [() => 0, 0, 10_000_000, true],
    lastNet: [() => 0, -1_000_000_000, 1_000_000_000, false],
    sinceVisitNet: [() => 0, -1_000_000_000_000, 1_000_000_000_000, false],
    accruedNet: [() => 0, -1_000_000_000_000, 1_000_000_000_000, false],
  };
  for (const [key, [fallback, min, max, integer]] of Object.entries(fields)) {
    const normalized = finiteNumber(passive[key], Number.isFinite(passive[key]) ? 0 : fallback(), {
      integer, min, max,
    });
    if (typeof passive[key] !== 'number' || !Object.is(passive[key], normalized)) repaired = true;
    passive[key] = normalized;
  }
  if (repaired) {
    noteRepair(report, `$.holdings[${index}].passive`, 'invalid passive summary fields normalized');
  }
  return passive;
}

function normalizedProperty(value, state, index, seed, report) {
  const property = isRecord(value) ? cloneSaveValue(value, {}) : {};
  let repaired = !isRecord(value);
  if (!isRecord(value)) {
    noteRepair(report, `$.holdings[${index}].property`, 'missing property record rebuilt from its club state');
  }
  const assign = (key, normalized) => {
    if (!Object.is(property[key], normalized)) repaired = true;
    property[key] = normalized;
  };
  assign('id', typeof property.id === 'string' && property.id.trim()
    ? property.id.trim().slice(0, 160)
    : `recovered-property-${index + 1}`);
  assign('name', typeof property.name === 'string' && property.name.trim()
    ? property.name.slice(0, 200)
    : state.clubName);
  assign('blurb', typeof property.blurb === 'string' ? property.blurb.slice(0, 2000) : '');
  assign('size', property.size === 18 ? 18 : 9);
  assign('seed', finiteNumber(property.seed, seed + index + 1, {
    integer: true, min: 1, max: 2147483647,
  }));
  property.layout = normalizedPropertyLayout(
    property.layout,
    property.size,
    report,
    `$.holdings[${index}].property.layout`,
  );
  const conditionFallback = Number.isFinite(Number(property.condition)) ? 0 : conditionRating(state);
  assign('condition', finiteNumber(property.condition, conditionFallback, { min: 0, max: 100 }));
  assign('sickGreens', finiteNumber(property.sickGreens, 0, {
    integer: true, min: 0, max: 18,
  }));
  assign('diseaseKind', property.diseaseKind === 'brownPatch' ? 'brownPatch' : 'dollarSpot');
  const counts = memberCounts(state);
  assign('startingMembers', finiteNumber(
    property.startingMembers,
    counts.weekday + counts.full + counts.premium,
    { integer: true, min: 0, max: 1_000_000 },
  ));
  assign('startingReputation', finiteNumber(property.startingReputation, state.club.reputation, {
    min: 0, max: 100,
  }));
  const designFallback = Number.isFinite(Number(property.design))
    ? 0
    : courseDesignRating(state.course, state.sections);
  assign('design', finiteNumber(property.design, designFallback, { min: 0, max: 100 }));
  assign('par', finiteNumber(property.par, 0, { integer: true, min: 0, max: 200 }));
  assign('yards', finiteNumber(property.yards, 0, { integer: true, min: 0, max: 20_000 }));
  assign('estMonthlyNet', finiteNumber(property.estMonthlyNet, 0, {
    min: -1_000_000_000, max: 1_000_000_000,
  }));
  // Appraisal walks the full club state, so only pay that cost when an old or
  // damaged save actually needs the derived fallback. Valid current saves are
  // the overwhelmingly common load path and already persist trueValue.
  const trueValueFallback = Number.isFinite(Number(property.trueValue))
    ? 0
    : appraiseProperty(state);
  assign('trueValue', finiteNumber(property.trueValue, trueValueFallback, {
    min: 0, max: 1_000_000_000_000,
  }));
  assign('askingPrice', finiteNumber(property.askingPrice, property.trueValue, {
    min: 0, max: 1_000_000_000_000,
  }));
  if (repaired) {
    noteRepair(report, `$.holdings[${index}].property`, 'invalid property fields normalized');
  }
  return property;
}

function isEmpireEnvelope(data) {
  return Object.hasOwn(data, 'empireVersion')
    || Object.hasOwn(data, 'holdings')
    || Object.hasOwn(data, 'market')
    || Object.hasOwn(data, 'activeId');
}

export function deserializeEmpireWithReport(raw) {
  const data = parseSaveInput(raw, { kind: 'empire save' });
  if (!isEmpireEnvelope(data)) {
    const report = createSaveReport('empire', 0, EMPIRE_VERSION);
    noteMigration(report, 1, 'single-club-envelope');
    for (const migration of EMPIRE_MIGRATIONS) noteMigration(report, migration.version, migration.name);
    const nested = deserializeWithReport(data);
    appendNestedReport(report, nested.report, '$.holdings[0].state');
    return {
      empire: legacyEmpireFromState(nested.state),
      report: finishSaveReport(report),
    };
  }

  const persistedVersion = Number.isSafeInteger(data.empireVersion) && data.empireVersion >= 0
    ? data.empireVersion
    : 0;
  if (persistedVersion > EMPIRE_VERSION) {
    throw new SaveCompatibilityError(
      `This portfolio uses empire schema ${persistedVersion}, but this build supports through ${EMPIRE_VERSION}.`,
      { path: '$.empireVersion' },
    );
  }
  const report = createSaveReport('empire', persistedVersion, EMPIRE_VERSION);
  for (const migration of EMPIRE_MIGRATIONS) {
    if (migration.version > persistedVersion) noteMigration(report, migration.version, migration.name);
  }

  const mode = data.mode === 'realistic' ? 'realistic' : 'relaxed';
  const seed = finiteNumber(data.seed, 1, { integer: true, min: 1, max: 2147483647 });
  const defaults = newEmpire(mode, seed);
  const holdings = [];
  const holdingIds = new Set();
  const rawHoldings = recordsOnly(data.holdings, report, '$.holdings', { max: 1000 });
  for (let index = 0; index < rawHoldings.length; index += 1) {
    const rawHolding = rawHoldings[index];
    const nested = deserializeWithReport(isRecord(rawHolding.state) ? rawHolding.state : {});
    appendNestedReport(report, nested.report, `$.holdings[${index}].state`);
    const property = normalizedProperty(rawHolding.property, nested.state, index, seed, report);
    if (holdingIds.has(property.id)) {
      noteRepair(report, `$.holdings[${index}]`, `duplicate property authority ${property.id} removed`);
      continue;
    }
    holdingIds.add(property.id);
    holdings.push({
      property,
      passive: normalizedPassive(rawHolding.passive, nested.state, index, report),
      state: nested.state,
    });
  }

  const clockMinutes = finiteNumber(data.clockMinutes, DAY_START_MIN, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const lastMarketDay = finiteNumber(
    data.lastMarketDay,
    calendarOf(clockMinutes).dayAbs,
    { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  );

  const rawMarket = Array.isArray(data.market)
    ? recordsOnly(data.market, report, '$.market', { max: MARKET.maxListings * 4 })
    : cloneSaveValue(defaults.market, []);
  if (!Array.isArray(data.market)) noteRepair(report, '$.market', 'missing market regenerated deterministically');
  const market = dedupeRecords(
    rawMarket
      .map((property, index) => normalizedMarketProperty(
        property, index, seed, lastMarketDay, report,
      ))
      .filter(Boolean)
      .filter((property) => {
        if (!holdingIds.has(property.id)) return true;
        noteRepair(report, '$.market', `owned property ${property.id} removed from listings`);
        return false;
      }),
    (property) => property.id,
    report,
    '$.market',
  );
  const activeId = typeof data.activeId === 'string' && holdingIds.has(data.activeId)
    ? data.activeId
    : null;
  if (data.activeId != null && activeId === null) noteRepair(report, '$.activeId', 'unknown active property cleared');
  const empire = {
    version: EMPIRE_VERSION,
    mode,
    seed,
    cash: finiteNumber(data.cash, defaults.cash, { min: -1_000_000_000_000, max: 1_000_000_000_000 }),
    market,
    holdings,
    activeId,
    clockMinutes,
    firstPurchaseDone: !!data.firstPurchaseDone,
    log: recordsOnly(data.log, report, '$.log', { max: 30 }),
    marketRngState: finiteNumber(data.marketRngState, ((seed ^ 0x9e3779b9) >>> 0) || 1, {
      integer: true,
      min: 0,
      max: 0xffffffff,
    }),
    lastMarketDay,
    marketCondition: finiteNumber(data.marketCondition, 1, { min: MARKET.conditionMin, max: MARKET.conditionMax }),
    marketConditionTarget: finiteNumber(data.marketConditionTarget, 1, { min: MARKET.conditionMin, max: MARKET.conditionMax }),
  };

  for (const holding of empire.holdings) {
    if (holding.property.id === empire.activeId) {
      holding.passive = null;
      holding.state.cash = empire.cash;
    } else if (!holding.passive) {
      parkHolding(holding);
      noteRepair(report, '$.holdings', `missing passive summary rebuilt for ${holding.property.id}`);
    }
  }
  return { empire, report: finishSaveReport(report) };
}

export function deserializeEmpire(raw) {
  return deserializeEmpireWithReport(raw).empire;
}
