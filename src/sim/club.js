// FAIRWAY STATE — the club: membership tiers, pricing, amenities, corporate
// outings, reputation, and the daily books. Built on real membership-business
// texture: tiers are about privileges and price psychology, joins follow perceived
// value, churn follows satisfaction vs. what you charge.

import { rngOf, clamp } from '../core/utils.js';
import { genCompany } from '../data/names.js';
import { HOLE_STATUS } from './constants.js';
import { calendarOf } from './time.js';
import { courseDesignRating } from './course.js';
import { conditionRating } from './turf.js';
import { addRevenue, addExpense, closeBooks, recordOutcome } from './economy.js';
import { applyReputationChange, ensureReputation } from './reputation.js';
import { staffDailyWages, bestSkill, groundsCrewHours, ROLE } from './staff.js';
import { members, nonMembers } from './golfers.js';
import { outingPayoutFactor, hasUpgrade } from './progression.js';
import { notify } from './notifications.js';

export const TIERS = {
  weekday: {
    name: 'Fairway Card',
    blurb: 'Weekday play, honest price.',
    baseDues: 240, // per season (24 days)
    guestPassesPerSeason: 0,
    shopDiscount: 0,
  },
  full: {
    name: 'Club Member',
    blurb: 'Anytime play, a guest each season, restaurant perks.',
    baseDues: 420,
    guestPassesPerSeason: 1,
    shopDiscount: 0.05,
  },
  premium: {
    name: 'Legacy Member',
    blurb: 'Priority tee times, three guests a season, range included.',
    baseDues: 780,
    guestPassesPerSeason: 3,
    shopDiscount: 0.1,
  },
};

export const AMENITIES = {
  range: { name: 'Practice range', maxLevel: 3, cost: [4000, 9000, 16000], upkeepPerLevel: 25 },
  restaurant: { name: 'Grill room', maxLevel: 3, cost: [12000, 22000, 38000], upkeepPerLevel: 60 },
  instruction: { name: 'Teaching program', maxLevel: 2, cost: [3000, 8000], upkeepPerLevel: 15 },
};

export const UTILITIES_PER_DAY = 45;

export function initClub(state) {
  state.club = {
    reputation: 30,
    greenFee: 32,
    lastRounds: 0,
    prevRounds: 0,
    dues: { weekday: TIERS.weekday.baseDues, full: TIERS.full.baseDues, premium: TIERS.premium.baseDues },
    amenities: { range: 0, restaurant: 0, instruction: 0 },
    reciprocal: false,
    outings: { offers: [], scheduled: [], nextId: 1 },
    feed: [],
    champions: [], // golfer ids who became the club's beloved regulars
  };
}

function pushFeed(state, entry) {
  state.club.feed.unshift({ ...entry, day: calendarOf(state.clock.minutes).dayAbs });
  if (state.club.feed.length > 20) state.club.feed.pop();
}

// --- ratings & pricing ------------------------------------------------------------

export function clubRatings(state) {
  const design = courseDesignRating(state.course, state.sections);
  const condition = state.turf ? conditionRating(state) : 0;
  return { design, condition, overall: 0.4 * design + 0.6 * condition };
}

export function amenityScore(state) {
  const a = state.club.amenities;
  let score = a.range * 1.1;
  if (a.restaurant > 0) score += a.restaurant * (1.3 + bestSkill(state, ROLE.FNB) * 0.08);
  if (a.instruction > 0 && bestSkill(state, ROLE.INSTRUCTOR) > 0) score += a.instruction * 1.2;
  return score;
}

export function fairGreenFee(overallRating, amenity) {
  return 12 + overallRating * 0.45 + amenity * 3;
}

export function demandMultiplier(price, fair) {
  return clamp(Math.pow(fair / Math.max(price, 1), 1.3), 0.1, 1.8);
}

export function fairDues(state, tier, overall, amenity) {
  const base = TIERS[tier].baseDues;
  return base * (0.45 + overall / 90 + amenity / 30);
}

export function memberCounts(state) {
  const counts = { weekday: 0, full: 0, premium: 0 };
  for (const g of members(state)) counts[g.memberTier]++;
  return counts;
}

// --- amenities ----------------------------------------------------------------------

export function upgradeAmenity(state, key) {
  const spec = AMENITIES[key];
  const level = state.club.amenities[key];
  if (level >= spec.maxLevel) return { ok: false, reason: 'Already at its best.' };
  const cost = spec.cost[level];
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash.' };
  addExpense(state, 'works', cost, {
    idempotencyKey: `amenity:${key}:level-${level + 1}`,
    relatedId: key,
    description: `${spec.name} level ${level + 1}`,
    source: 'amenity-upgrade',
    metadata: { level: level + 1 },
  });
  state.club.amenities[key] = level + 1;
  pushFeed(state, { kind: 'amenity', text: `${spec.name} upgraded to level ${level + 1}.` });
  return { ok: true, cost };
}

// --- corporate outings -----------------------------------------------------------------

export function maybeGenerateOutingOffer(state) {
  const rng = rngOf(state);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs;
  if (state.club.outings.offers.length >= 2) return;
  if (!rng.chance(0.18)) return;
  const size = 16 + rng.int(25);
  const payout = Math.round(size * state.club.greenFee * (1.6 + rng.next() * 0.7) * (state.progression ? outingPayoutFactor(state) : 1));
  const offer = {
    id: state.club.outings.nextId++,
    company: genCompany(rng),
    size,
    payout,
    day: dayAbs + 4 + rng.int(5),
    expiresDay: dayAbs + 2 + rng.int(2),
  };
  state.club.outings.offers.push(offer);
  pushFeed(state, { kind: 'offer', text: `${offer.company} wants a ${size}-player outing - ${payout.toLocaleString('en-US')} dollars.` });
  notify(state, {
    kind: 'event',
    text: `${offer.company} wants a ${size}-player outing - $${payout.toLocaleString('en-US')}. The offer expires day ${offer.expiresDay + 1}.`,
    dedupeKey: `offer:${offer.id}`,
  });
}

export function acceptOuting(state, offerId) {
  const i = state.club.outings.offers.findIndex((o) => o.id === offerId);
  if (i === -1) return { ok: false, reason: 'Offer gone.' };
  const [offer] = state.club.outings.offers.splice(i, 1);
  state.club.outings.scheduled.push(offer);
  pushFeed(state, { kind: 'outing', text: `Booked ${offer.company} for a ${offer.size}-player outing.` });
  return { ok: true };
}

export function declineOuting(state, offerId) {
  const i = state.club.outings.offers.findIndex((o) => o.id === offerId);
  if (i !== -1) state.club.outings.offers.splice(i, 1);
  return { ok: true };
}

function expireOffers(state, dayAbs) {
  state.club.outings.offers = state.club.outings.offers.filter((o) => dayAbs <= o.expiresDay);
}

// --- the daily accrual (runs at the midnight that CLOSES the day) --------------------------

export function estimateRounds(state, ratings, amenity) {
  const cal = calendarOf(state.clock.minutes);
  const seasonF = [0.95, 1.15, 1.0, 0.22][cal.seasonIndex];
  const w = state.weather.today;
  let weatherF = 1;
  if (w.rainIn > 0.6) weatherF = 0.2;
  else if (w.rainIn > 0.15) weatherF = 0.55;
  if (w.tempHiF < 42) weatherF *= 0.35;
  if (w.tempHiF > 96) weatherF *= 0.7;
  const openHoles = state.course.holes.filter((h) => h.status === HOLE_STATUS.OPEN).length;
  const fair = fairGreenFee(ratings.overall, amenity);
  const demand = demandMultiplier(state.club.greenFee, fair);
  const quality = 0.35 + ratings.overall / 90;
  const rep = 0.3 + state.club.reputation / 70;
  return Math.round(30 * seasonF * weatherF * demand * quality * rep * (openHoles / 9));
}

export function accrueDaily(state) {
  const ratings = clubRatings(state);
  const amenity = amenityScore(state);
  const cal = calendarOf(state.clock.minutes);
  const closingDay = Number.isInteger(state.ledger?.postingDay) ? state.ledger.postingDay : cal.dayAbs - 1;
  if (state.club.lastAccruedDay === closingDay) return state.club.lastAccrual || null;
  const counts = memberCounts(state);
  const memberTotal = counts.weekday + counts.full + counts.premium;

  // revenue: public rounds
  const rounds = estimateRounds(state, ratings, amenity);
  // keep yesterday's gate before it is overwritten — Analytics explains the CHANGE in visitors,
  // and without the previous day to compare against, the delta is always zero and the page is mute
  state.club.prevRounds = state.club.lastRounds || 0;
  state.club.lastRounds = rounds;
  const greenFeeRevenue = rounds * state.club.greenFee;
  if (greenFeeRevenue > 0) addRevenue(state, 'greenFees', greenFeeRevenue, {
    idempotencyKey: `club-day:${closingDay}:walk-ins`,
    relatedId: `club-day-${closingDay}`,
    category: 'walkIns',
    description: `${rounds} walk-in round${rounds === 1 ? '' : 's'}`,
    source: 'daily-club',
    units: rounds,
    customerCount: rounds,
  });
  if (rounds > 0) recordOutcome(state, {
    idempotencyKey: `club-day:${closingDay}:customers-served`,
    type: 'customerServed',
    count: rounds,
    amount: greenFeeRevenue,
    relatedId: `club-day-${closingDay}`,
    reason: `${rounds} public golfer${rounds === 1 ? '' : 's'} completed a round.`,
  });
  if (rounds > 0) {
    const fair = fairGreenFee(ratings.overall, amenity);
    const ratio = state.club.greenFee / Math.max(1, fair);
    const priceDelta = ratio > 1.2 ? -clamp((ratio - 1.2) * 1.8, 0.15, 1)
      : ratio < 0.8 ? 0.2 : 0.08;
    applyReputationChange(state, {
      id: `club-day:${closingDay}:green-fee-reputation`, category: 'course', delta: priceDelta,
      source: 'daily-club', sourceId: `club-day-${closingDay}`,
      reason: ratio > 1.2
        ? `${rounds} golfers paid a green fee ${Math.round((ratio - 1) * 100)}% above the course's fair value.`
        : `${rounds} golfers found the green fee fair for the course delivered.`,
    });
  }

  // Revenue: dues accrue daily because a season is the billing period. The
  // member book is a rolling population, not 25 captives who instantly accept
  // any slider value. Above fair value, renewals/payment realization falls
  // faster than price rises; the slower membership tick then records the named
  // people who actually leave. This closes the one-day extreme-dues windfall
  // while keeping the model understandable.
  let dues = 0;
  let listedDues = 0;
  let realizedMembers = 0;
  for (const tier of Object.keys(counts)) {
    const listed = counts[tier] * (state.club.dues[tier] / 24);
    const fair = fairDues(state, tier, ratings.overall, amenity);
    const ratio = state.club.dues[tier] / Math.max(1, fair);
    const realization = clamp(Math.pow(1 / Math.max(0.1, ratio), 2), 0.03, 1);
    listedDues += listed;
    dues += listed * realization;
    realizedMembers += counts[tier] * realization;
  }
  if (dues > 0) addRevenue(state, 'dues', dues, {
    idempotencyKey: `club-day:${closingDay}:dues`,
    relatedId: `club-day-${closingDay}`,
    description: `Daily dues from ${memberTotal} member${memberTotal === 1 ? '' : 's'}`,
    source: 'daily-club',
    customerCount: Math.round(realizedMembers),
    metadata: { listedDues: Math.round(listedDues * 100) / 100, realizedMembers: Math.round(realizedMembers * 10) / 10 },
  });
  const resistedDues = Math.round((listedDues - dues) * 100) / 100;
  if (resistedDues > 0.01) recordOutcome(state, {
    idempotencyKey: `club-day:${closingDay}:dues-price-resistance`,
    type: 'membershipPriceResistance', count: Math.max(0, memberTotal - Math.round(realizedMembers)),
    amount: resistedDues, relatedId: `club-day-${closingDay}`,
    reason: `${memberTotal} members generated ${Math.round(dues)} dollars of ${Math.round(listedDues)} listed daily dues because pricing exceeded perceived value.`,
    metadata: { listedDues: Math.round(listedDues * 100) / 100, realizedDues: Math.round(dues * 100) / 100 },
  });

  // revenue: amenities
  const a = state.club.amenities;
  if (a.range > 0) addRevenue(state, 'range', a.range * (8 + memberTotal * 0.35 + rounds * 0.2), {
    idempotencyKey: `club-day:${closingDay}:range`, relatedId: `club-day-${closingDay}`, source: 'daily-club',
  });
  if (a.restaurant > 0) {
    const covers = memberTotal * 0.45 + rounds * 0.3;
    const fnbF = 0.7 + bestSkill(state, ROLE.FNB) * 0.12;
    addRevenue(state, 'restaurant', a.restaurant * covers * 2.6 * fnbF, {
      idempotencyKey: `club-day:${closingDay}:restaurant`, relatedId: `club-day-${closingDay}`, source: 'daily-club', customerCount: Math.round(covers),
    });
  }
  if (a.instruction > 0 && bestSkill(state, ROLE.INSTRUCTOR) > 0) {
    const lessons = Math.min(memberTotal * 0.12 + 1.5, 3 + bestSkill(state, ROLE.INSTRUCTOR) * 1.5);
    addRevenue(state, 'lessons', lessons * 38 * a.instruction, {
      idempotencyKey: `club-day:${closingDay}:lessons`, relatedId: `club-day-${closingDay}`, source: 'daily-club', units: lessons,
    });
  }

  // revenue + disruption: outings that happened today
  const dueOutings = state.club.outings.scheduled.filter((o) => o.day <= closingDay);
  state.club.outings.scheduled = state.club.outings.scheduled.filter((o) => o.day > closingDay);
  for (const outing of dueOutings) {
    addRevenue(state, 'outings', outing.payout, {
      idempotencyKey: `outing:${outing.id}:payout`, relatedId: outing.id, description: `${outing.company} corporate outing`, source: 'outing', customerCount: outing.size,
    });
    recordOutcome(state, {
      idempotencyKey: `outing:${outing.id}:completed`, type: 'outingCompleted', count: outing.size, amount: outing.payout, relatedId: outing.id,
      reason: `${outing.company} completed a ${outing.size}-player outing.`,
    });
    for (const g of members(state)) g.satisfaction = clamp(g.satisfaction - 6, 0, 100);
    applyReputationChange(state, {
      id: `outing:${outing.id}:reputation`, category: ratings.overall >= 55 ? 'service' : 'course',
      delta: ratings.overall >= 55 ? 1 : -1.5, source: 'outing', sourceId: outing.id,
      reason: ratings.overall >= 55 ? `${outing.company}'s event ran successfully.` : `${outing.company}'s event exposed weak course conditions.`,
    });
    pushFeed(state, { kind: 'outing', text: `${outing.company} outing played - ${outing.payout.toLocaleString('en-US')} dollars banked.` });
  }

  // reciprocal network: partner-club visitors, mostly for the premium crowd
  if (state.progression && hasUpgrade(state, 'reciprocalClubs')) {
    addRevenue(state, 'reciprocal', counts.premium * 6 + counts.full * 2 + 8, {
      idempotencyKey: `club-day:${closingDay}:reciprocal`, relatedId: `club-day-${closingDay}`, source: 'daily-club',
    });
  }

  // expenses
  const wages = staffDailyWages(state);
  if (wages > 0) addExpense(state, 'wagesStaff', wages, {
    idempotencyKey: `club-day:${closingDay}:staff-wages`, relatedId: `club-day-${closingDay}`, source: 'daily-club',
  });
  addExpense(state, 'utilities', UTILITIES_PER_DAY, {
    idempotencyKey: `club-day:${closingDay}:utilities`, relatedId: `club-day-${closingDay}`, source: 'daily-club',
  });
  let upkeep = 0;
  for (const key of Object.keys(AMENITIES)) upkeep += state.club.amenities[key] * AMENITIES[key].upkeepPerLevel;
  if (upkeep > 0) addExpense(state, 'upkeep', upkeep, {
    idempotencyKey: `club-day:${closingDay}:amenity-upkeep`, relatedId: `club-day-${closingDay}`, source: 'daily-club',
  });
  state.club.lastAccruedDay = closingDay;
  state.club.lastAccrual = { day: closingDay, rounds, greenFeeRevenue, dues, wages, upkeep };
  return state.club.lastAccrual;
}

// --- membership & reputation daily dynamics (runs after books close) ----------------------

function satisfactionTarget(state, ratings, amenity) {
  const service =
    Math.min(groundsCrewHours(state) / 16, 1) * 8 +
    (bestSkill(state, ROLE.INSTRUCTOR) > 0 ? 4 : 0) +
    (bestSkill(state, ROLE.FNB) > 0 ? 3 : 0);
  return clamp(ratings.condition * 0.5 + ratings.design * 0.12 + amenity * 1.9 + service, 5, 95);
}

export function dailyMembershipTick(state) {
  ensureReputation(state);
  const rng = rngOf(state);
  const ratings = clubRatings(state);
  const amenity = amenityScore(state);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs;

  expireOffers(state, dayAbs);
  maybeGenerateOutingOffer(state);

  const target = satisfactionTarget(state, ratings, amenity);

  // members: drift + churn (visit experiences in sim/rounds.js dominate; this is
  // the slower between-visits pull toward what the club objectively offers)
  for (const g of members(state)) {
    g.satisfaction = clamp(g.satisfaction + clamp(target - g.satisfaction, -16, 16) * 0.12, 0, 100);

    // the truly fed-up don't linger — below 15 they're simply gone, loudly and
    // for good; 15-25 is the at-risk zone where you might still save them
    if (g.satisfaction < 15 || (g.satisfaction < 25 && rng.chance(1 / 6))) {
      g.memberTier = null;
      g.leftForever = true;
      applyReputationChange(state, {
        id: `member:${g.id}:left-forever:${dayAbs}`, category: 'service', delta: -3,
        source: 'membership', sourceId: g.id, reason: `${g.name} quit after sustained poor satisfaction.`,
      });
      recordOutcome(state, { idempotencyKey: `member:${g.id}:left-forever:${dayAbs}`, type: 'memberChurn', count: 1, relatedId: g.id, reason: `${g.name} left permanently.` });
      pushFeed(state, { kind: 'quit-forever', text: `${g.name} quit for good and isn't quiet about it. That one stings.` });
      continue;
    }

    if (rng.chance(1 / 16)) {
      const fair = fairDues(state, g.memberTier, ratings.overall, amenity);
      const priced = state.club.dues[g.memberTier] / Math.max(fair, 1);
      const threshold = clamp(35 + (priced - 1) * 55, 22, 92);
      if (g.satisfaction < threshold) {
        g.memberTier = null;
        applyReputationChange(state, {
          id: `member:${g.id}:value-churn:${dayAbs}`, category: 'service', delta: -0.5,
          source: 'membership', sourceId: g.id, reason: `${g.name} left because dues exceeded perceived value.`,
        });
        recordOutcome(state, { idempotencyKey: `member:${g.id}:value-churn:${dayAbs}`, type: 'memberChurn', count: 1, relatedId: g.id, reason: `${g.name} left over value for money.` });
        pushFeed(state, { kind: 'quit', text: `${g.name} walked - "not worth it anymore."` });
      }
    }
  }

  // prospects: joins (never anyone who stormed out for good)
  for (const g of nonMembers(state)) {
    if (g.leftForever) continue;
    const tier = g.wealth >= 4 ? 'premium' : g.wealth >= 2 ? 'full' : 'weekday';
    const fair = fairDues(state, tier, ratings.overall, amenity);
    const priceF = clamp(Math.pow(fair / Math.max(state.club.dues[tier], 1), 2), 0.03, 2.2);
    const repF = clamp(Math.pow(state.club.reputation / 50, 0.8), 0.35, 1.6);
    const ratingF = Math.pow(Math.max(ratings.overall, 5) / 55, 1.5);
    const chance = 0.0045 * ratingF * priceF * repF;
    if (rng.chance(chance)) {
      g.memberTier = tier;
      g.joinedDay = dayAbs;
      g.satisfaction = Math.max(g.satisfaction, 50);
      applyReputationChange(state, {
        id: `member:${g.id}:joined:${dayAbs}`, category: 'service', delta: 0.15,
        source: 'membership', sourceId: g.id, reason: `${g.name} joined as a ${TIERS[tier].name}.`,
      });
      recordOutcome(state, { idempotencyKey: `member:${g.id}:joined:${dayAbs}`, type: 'memberJoined', count: 1, relatedId: g.id, reason: `${g.name} became a member.` });
      pushFeed(state, { kind: 'join', text: `${g.name} joined as a ${TIERS[tier].name}.` });
    }
  }

  // reputation drifts toward what the club actually is
  const ms = members(state);
  const avgSat = ms.length ? ms.reduce((a, g) => a + g.satisfaction, 0) / ms.length : ratings.overall;
  const repTarget = 0.55 * ratings.overall + 0.45 * avgSat;
  let delta = clamp((repTarget - state.club.reputation) * 0.12, -1.8, 1.8);
  const renovating = state.course.holes.some((h) => h.status === HOLE_STATUS.RENOVATION);
  if (renovating) delta -= 0.35;
  applyReputationChange(state, {
    id: `club-day:${dayAbs}:quality-reputation`, categories: ['course', 'service'], delta,
    source: 'daily-club', sourceId: `club-day-${dayAbs}`,
    reason: delta >= 0
      ? `Course quality and member satisfaction supported the club's standing.`
      : `Course quality and member satisfaction pulled the club's standing down.`,
  });
}

// Convenience: the full midnight economy pass, in the right order.
export function midnightBooks(state) {
  accrueDaily(state);
  closeBooks(state, calendarOf(state.clock.minutes).dayAbs - 1);
}
