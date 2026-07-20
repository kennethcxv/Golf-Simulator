// FAIRWAY STATE — progression: prestige, the improvement tree, tournaments, and
// the endgame. Prestige is what the golf WORLD thinks of you (slow, earned);
// reputation is what your local players feel week to week. Prestige gates the
// upgrades and events that turn a muni into a club that hosts a major.

import { clamp } from '../core/utils.js';
import { calendarOf } from './time.js';
import { courseDesignRating } from './course.js';
import { conditionRating } from './turf.js';
import { addRevenue, addExpense, recordOutcome } from './economy.js';
import { applyReputationChange } from './reputation.js';

export const UPGRADES = {
  greensMowerII: {
    name: 'Triplex greens mowers',
    blurb: 'Cuts greens crew time by 40%.',
    visibleResult: 'Triplex mowing equipment is added to the maintenance operation and named in the morning crew report.',
    gameplayEffect: 'Greens mowing uses 40% fewer crew hours.',
    valueEffect: 3500,
    cost: 7000,
    prestige: 15,
    cat: 'turf',
  },
  fairwayMowerII: {
    name: 'Lightweight fairway units',
    blurb: 'Cuts fairway crew time by 40%.',
    visibleResult: 'Lightweight fairway units join the maintenance fleet.',
    gameplayEffect: 'Fairway mowing uses 40% fewer crew hours.',
    valueEffect: 4500,
    cost: 9000,
    prestige: 20,
    cat: 'turf',
  },
  aerator: {
    name: 'Deep-tine aerator',
    blurb: 'Halves aeration cost; turf sheds wear faster.',
    visibleResult: 'A deep-tine aerator becomes part of the course-equipment condition score.',
    gameplayEffect: 'Aeration costs 50% less and daily wear recovery improves.',
    valueEffect: 3000,
    cost: 6000,
    prestige: 15,
    cat: 'turf',
  },
  sprayRig: {
    name: 'Precision spray rig',
    blurb: 'Fungicide applications cost 40% less.',
    visibleResult: 'The precision rig is listed with owned maintenance equipment.',
    gameplayEffect: 'Fungicide applications cost 40% less.',
    valueEffect: 4000,
    cost: 8000,
    prestige: 25,
    cat: 'turf',
  },
  smartIrrigation: {
    name: 'Smart irrigation controllers',
    blurb: 'Water bills drop 30%.',
    visibleResult: 'Irrigation condition shows smart controllers installed.',
    gameplayEffect: 'Applied irrigation water costs 30% less.',
    valueEffect: 6500,
    cost: 12000,
    prestige: 30,
    cat: 'turf',
  },
  premiumSupplier: {
    name: 'Premium supplier account',
    blurb: 'Unlocks tier-3 lines in the pro shop.',
    visibleResult: 'Premium merchandise appears in the supplier catalog and can be stocked on real shelves.',
    gameplayEffect: 'Unlocks tier-3 pro-shop merchandise.',
    valueEffect: 2500,
    cost: 5000,
    prestige: 35,
    cat: 'shop',
  },
  reciprocalClubs: {
    name: 'Reciprocal club network',
    blurb: 'Partner clubs send visitors; premium members love it.',
    visibleResult: 'Reciprocal guest revenue and visits appear in the ledger and summaries.',
    gameplayEffect: 'Adds partner-club visitor revenue tied to the membership book.',
    valueEffect: 3000,
    cost: 6000,
    prestige: 40,
    cat: 'membership',
  },
  corporatePartners: {
    name: 'Corporate partnership desk',
    blurb: 'Outing offers pay 35% more.',
    visibleResult: 'Corporate outing offers identify the partnership premium.',
    gameplayEffect: 'Accepted corporate outings pay 35% more.',
    valueEffect: 5000,
    cost: 10000,
    prestige: 45,
    cat: 'membership',
  },
  tournamentHost: {
    name: 'Tournament operations',
    blurb: 'Scoreboards, ropes, a starter who means it. Enables hosting events.',
    visibleResult: 'Tournament operations and event scheduling become available.',
    gameplayEffect: 'Unlocks staged tournaments with real condition requirements and ledger outcomes.',
    valueEffect: 9000,
    cost: 15000,
    prestige: 50,
    cat: 'events',
  },
};

export const TOURNAMENTS = {
  clubChampionship: {
    name: 'Willow Creek Club Championship',
    prestigeReq: 50,
    cost: 3000,
    entryRevenue: 2600,
    leadDays: 4,
    conditionReq: 45,
    prestigeWin: 5,
    prestigeLose: -4,
    repWin: 4,
    requiresHosted: null,
  },
  regionalAmateur: {
    name: 'County Amateur Invitational',
    prestigeReq: 65,
    cost: 8000,
    entryRevenue: 7400,
    leadDays: 6,
    conditionReq: 60,
    prestigeWin: 9,
    prestigeLose: -7,
    repWin: 6,
    requiresHosted: 'clubChampionship',
  },
  major: {
    name: 'THE WILLOW CREEK OPEN',
    prestigeReq: 85,
    cost: 25000,
    entryRevenue: 32000,
    leadDays: 8,
    conditionReq: 72,
    prestigeWin: 15,
    prestigeLose: -10,
    repWin: 10,
    requiresHosted: 'regionalAmateur',
  },
};

export function initProgression(state) {
  state.progression = {
    prestige: 12, // a muni nobody has heard of… yet
    unlocks: {},
    event: null, // { tier, day }
    hosted: {}, // tier -> count
    history: [], // newest first: {tier, day, success, note}
    majorWon: false,
  };
}

export function hasUpgrade(state, id) {
  // stored value is the purchase dayAbs, which can be 0 — presence is the test
  return !!(state.progression && state.progression.unlocks && id in state.progression.unlocks);
}

export function purchaseUpgrade(state, id) {
  const spec = UPGRADES[id];
  if (!spec) return { ok: false, reason: 'No such improvement.' };
  if (hasUpgrade(state, id)) return { ok: false, reason: 'Already owned.' };
  if (state.progression.prestige < spec.prestige) {
    return { ok: false, reason: `Needs prestige ${spec.prestige} — the golf world isn't ready to sell you this yet.` };
  }
  if (state.cash < spec.cost) return { ok: false, reason: 'Not enough cash.' };
  const day = calendarOf(state.clock.minutes).dayAbs;
  const charge = addExpense(state, 'works', spec.cost, {
    idempotencyKey: `upgrade:${state.property?.id || state.seed}:${id}`,
    relatedId: id,
    category: 'equipment',
    accountingClass: 'capital',
    description: `Upgrade purchase: ${spec.name}`,
    source: 'upgrade',
  });
  if (!charge.ok) return charge;
  state.progression.unlocks[id] = day;
  if (id === 'premiumSupplier' && state.shop) state.shop.unlockedTier = 3;
  if (id === 'reciprocalClubs' && state.club) state.club.reciprocal = true;
  return { ok: true, cost: spec.cost };
}

// --- upgrade effect helpers (dependency-free reads) ---------------------------------

export function mowHoursFactor(state, zoneKey) {
  if (zoneKey === 'green' && hasUpgrade(state, 'greensMowerII')) return 0.6;
  if (zoneKey === 'fairway' && hasUpgrade(state, 'fairwayMowerII')) return 0.6;
  return 1;
}

export function waterCostFactor(state) {
  return hasUpgrade(state, 'smartIrrigation') ? 0.7 : 1;
}

export function fungicideCostFactor(state) {
  return hasUpgrade(state, 'sprayRig') ? 0.6 : 1;
}

export function aerateCostFactor(state) {
  return hasUpgrade(state, 'aerator') ? 0.5 : 1;
}

export function wearRecoveryBonus(state) {
  return hasUpgrade(state, 'aerator') ? 0.6 : 0;
}

export function outingPayoutFactor(state) {
  return hasUpgrade(state, 'corporatePartners') ? 1.35 : 1;
}

// --- prestige ---------------------------------------------------------------------------

export function prestigeDailyTick(state) {
  const design = courseDesignRating(state.course, state.sections);
  const condition = state.turf ? conditionRating(state) : 0;
  const overall = 0.4 * design + 0.6 * condition;
  const premium = state.golfers ? state.golfers.pool.filter((g) => g.memberTier === 'premium').length : 0;
  const champions = state.club && state.club.champions ? state.club.champions.length : 0;
  const amen = state.club
    ? (state.club.amenities.range + state.club.amenities.restaurant + state.club.amenities.instruction)
    : 0;
  const hostedBonus =
    (state.progression.hosted.clubChampionship || 0) * 2 +
    (state.progression.hosted.regionalAmateur || 0) * 4 +
    (state.progression.hosted.major || 0) * 10;
  const target = clamp(
    overall * 0.42 + (state.club ? state.club.reputation : 30) * 0.22 + amen * 2.2 +
      premium * 1.4 + champions * 2.5 + hostedBonus,
    0, 100,
  );
  const rate = state.mode === 'relaxed' ? 0.14 : 0.1;
  state.progression.prestige = clamp(
    state.progression.prestige + clamp((target - state.progression.prestige) * rate, -0.9, 0.9),
    0, 100,
  );
}

// --- tournaments ----------------------------------------------------------------------------

export function canScheduleTournament(state, tier) {
  const spec = TOURNAMENTS[tier];
  if (!spec) return { ok: false, reason: 'No such event.' };
  if (!hasUpgrade(state, 'tournamentHost')) return { ok: false, reason: 'Needs Tournament operations.' };
  if (state.progression.event) return { ok: false, reason: 'An event is already on the calendar.' };
  if (state.progression.prestige < spec.prestigeReq) {
    return { ok: false, reason: `Needs prestige ${spec.prestigeReq}.` };
  }
  if (spec.requiresHosted && !(state.progression.hosted[spec.requiresHosted] > 0)) {
    return { ok: false, reason: `Host the ${TOURNAMENTS[spec.requiresHosted].name} first.` };
  }
  if (state.cash < spec.cost) return { ok: false, reason: 'Not enough cash to stage it.' };
  return { ok: true };
}

export function scheduleTournament(state, tier) {
  const gate = canScheduleTournament(state, tier);
  if (!gate.ok) return gate;
  const spec = TOURNAMENTS[tier];
  const day = calendarOf(state.clock.minutes).dayAbs + spec.leadDays;
  const eventId = `${tier}:${day}`;
  addExpense(state, 'events', spec.cost, {
    idempotencyKey: `tournament:${eventId}:staging`, relatedId: eventId,
    description: `${spec.name} staging costs`, source: 'tournament',
  });
  state.progression.event = { id: eventId, tier, day };
  if (state.club) {
    state.club.feed.unshift({
      kind: 'event',
      day: calendarOf(state.clock.minutes).dayAbs,
      text: `${spec.name} is on the calendar — ${spec.leadDays} days to get the course ready.`,
    });
    if (state.club.feed.length > 20) state.club.feed.pop();
  }
  return { ok: true, day };
}

// Runs at the closing midnight of event day (called from the daily accrual).
export function resolveTournamentIfDue(state, closingDay) {
  const ev = state.progression.event;
  if (!ev || ev.day > closingDay) return null;
  const spec = TOURNAMENTS[ev.tier];
  state.progression.event = null;

  const condition = state.turf ? conditionRating(state) : 0;
  const openHoles = state.course.holes.filter((h) => h.status === 'open').length;
  const success = condition >= spec.conditionReq && openHoles >= 9;

  const eventId = ev.id || `${ev.tier}:${ev.day}`;
  addRevenue(state, 'events', spec.entryRevenue, {
    idempotencyKey: `tournament:${eventId}:revenue`, relatedId: eventId,
    description: `${spec.name} event revenue`, source: 'tournament',
  });
  const outcome = {
    tier: ev.tier,
    name: spec.name,
    day: closingDay,
    success,
    condition: Math.round(condition),
    note: success
      ? `${spec.name} was a triumph — condition ${Math.round(condition)} with the whole course open.`
      : openHoles < 9
        ? `${spec.name} played over a broken routing (${openHoles}/9 holes). The write-ups were brutal.`
        : `${spec.name} exposed the turf (condition ${Math.round(condition)} vs ${spec.conditionReq} needed). Embarrassing.`,
  };
  state.progression.history.unshift(outcome);
  if (state.progression.history.length > 12) state.progression.history.pop();

  if (success) {
    state.progression.hosted[ev.tier] = (state.progression.hosted[ev.tier] || 0) + 1;
    state.progression.prestige = clamp(state.progression.prestige + spec.prestigeWin, 0, 100);
    if (state.club) applyReputationChange(state, {
      id: `tournament:${eventId}:reputation`, categories: ['course', 'service'], delta: spec.repWin,
      source: 'tournament', sourceId: eventId, reason: `${spec.name} succeeded on a ready, well-run course.`,
    });
    if (ev.tier === 'major') {
      state.progression.majorWon = true;
      state.progression.prestige = 100;
    }
  } else {
    state.progression.prestige = clamp(state.progression.prestige + spec.prestigeLose, 0, 100);
    if (state.club) applyReputationChange(state, {
      id: `tournament:${eventId}:reputation`, categories: ['course', 'service'], delta: -3,
      source: 'tournament', sourceId: eventId, reason: `${spec.name} failed because the property was not ready.`,
    });
  }

  recordOutcome(state, {
    idempotencyKey: `tournament:${eventId}:outcome`, type: success ? 'tournamentSuccess' : 'tournamentFailure',
    count: 1, amount: spec.entryRevenue, relatedId: eventId, reason: outcome.note,
    metadata: { tier: ev.tier, condition: Math.round(condition), openHoles },
  });

  if (state.club) {
    state.club.feed.unshift({ kind: 'event', day: closingDay, text: outcome.note });
    if (state.club.feed.length > 20) state.club.feed.pop();
  }
  return outcome;
}

// --- solvency (mode-differentiated) ------------------------------------------------------------

export function solvencyDailyTick(state) {
  if (state.mode === 'relaxed') {
    // the bank quietly floors you — no fail state, just a ceiling on the hole
    if (state.cash < -5000) state.cash = -5000;
    state.debtDays = 0;
    return;
  }
  if (state.cash < -2000) {
    state.debtDays = (state.debtDays || 0) + 1;
    if (state.debtDays >= 5 && !state.failed) {
      state.failed = {
        day: calendarOf(state.clock.minutes).dayAbs,
        reason: 'Five straight days past the overdraft limit. The bank has called in the note.',
      };
    }
  } else {
    state.debtDays = 0;
  }
}
