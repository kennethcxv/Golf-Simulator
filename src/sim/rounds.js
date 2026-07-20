// FAIRWAY STATE — daily round simulation: who played, what they shot, what the
// course DID to them, and what they now think about your club. This is where
// turf condition measurably becomes strokes, wait minutes, and word of mouth —
// and where foot traffic wears your greens back down.

import { ZONE, HOLE_STATUS } from './constants.js';
import { makeRng, rngOf, clamp } from '../core/utils.js';
import { calendarOf } from './time.js';
import { greenSpeedOf, sectionTurfSummary } from './turf.js';
import { fairGreenFee, amenityScore, clubRatings } from './club.js';
import { members } from './golfers.js';
import { shopOpenStock } from './shop.js';
import { SHOP_CATALOG, SHELF_CAP } from '../data/shopItems.js';
import { capacityOf } from '../data/fixtureSlots.js';
import { thoughtsForRound } from '../data/thoughts.js';
import { ROLE, bestSkill, groundsCrewHours } from './staff.js';

// --- course aggregates (computed once per day / per score call) ------------------

export function courseAggregates(state) {
  let greensSpeedSum = 0;
  let greensHealthSum = 0;
  let greens = 0;
  let diseasedGreens = 0;
  let fwHealthSum = 0;
  let fw = 0;
  let roughHeightSum = 0;
  let rough = 0;
  let bunkers = 0;
  let water = 0;
  for (const s of state.sections) {
    if (s.zone === ZONE.GREEN && s.holeId != null) {
      const sum = sectionTurfSummary(state, s);
      greensSpeedSum += greenSpeedOf(state, s);
      greensHealthSum += sum.health;
      if (sum.disease) diseasedGreens++;
      greens++;
    } else if (s.zone === ZONE.FAIRWAY) {
      fwHealthSum += sectionTurfSummary(state, s).health * s.size;
      fw += s.size;
    } else if (s.zone === ZONE.ROUGH) {
      roughHeightSum += sectionTurfSummary(state, s).heightMm * s.size;
      rough += s.size;
    } else if (s.zone === ZONE.BUNKER) bunkers++;
    else if (s.zone === ZONE.WATER) water++;
  }
  const holes = state.course.holes;
  return {
    greensSpeed: greens ? Math.round((greensSpeedSum / greens) * 10) / 10 : 8,
    greensHealth: greens ? Math.round(greensHealthSum / greens) : 50,
    fairwayHealth: fw ? Math.round(fwHealthSum / fw) : 50,
    roughHeightMm: rough ? Math.round(roughHeightSum / rough) : 45,
    diseasedGreens,
    bunkers,
    waterHoles: water,
    par: holes.filter((h) => h.status === HOLE_STATUS.OPEN).reduce((a, h) => a + 4, 0) ? holes.filter((h) => h.status === HOLE_STATUS.OPEN).length * 4 - 2 : 34,
    renovations: holes.filter((h) => h.status === HOLE_STATUS.RENOVATION || h.status === HOLE_STATUS.CONSTRUCTION).length,
  };
}

// --- one round's score ----------------------------------------------------------------

export function simulateRoundScore(state, golfer, seed, agg = null) {
  const a = agg || courseAggregates(state);
  const rng = makeRng((seed >>> 0) || 1);
  const par = 34;
  let score = par + 2 + golfer.skill * 0.55;
  // sick, slow, bumpy greens cost strokes
  score += clamp((70 - a.greensHealth) / 12, 0, 5);
  if (a.greensSpeed < 8.5) score += (8.5 - a.greensSpeed) * 0.8;
  score += clamp((60 - a.fairwayHealth) / 15, 0, 3);
  if (a.roughHeightMm > 65) score += 1.2;
  score += (rng.next() - 0.5) * 8.4;
  return Math.round(clamp(score, par - 6, par + 40));
}

// --- context for the thought catalog -----------------------------------------------------

export function buildRoundContext(state, golfer, agg, extras) {
  const ratings = clubRatings(state);
  const amen = amenityScore(state);
  let shelfCapTotal = 0;
  for (const sku of SHOP_CATALOG) shelfCapTotal += capacityOf(sku.id) || SHELF_CAP[sku.cat];
  const markupMax = Math.max(...Object.values(state.shop.markup));
  const dayAbs = calendarOf(state.clock.minutes).dayAbs;
  return {
    golfer: {
      name: golfer.name,
      persona: golfer.persona,
      wealth: golfer.wealth,
      memberTier: golfer.memberTier,
      satisfaction: golfer.satisfaction,
      roundsHere: golfer.roundsPlayed || 0,
      skillTrend: (golfer.skillDelta30 || 0) < -0.3 ? 'improving' : 'steady',
    },
    round: {
      score: extras.score,
      par: 34,
      waitMin: extras.waitMin,
      playersToday: extras.playersToday,
      greensSpeed: agg.greensSpeed,
      greensHealth: agg.greensHealth,
      fairwayHealth: agg.fairwayHealth,
      roughHeightMm: agg.roughHeightMm,
      diseasedGreens: agg.diseasedGreens,
      bunkers: agg.bunkers,
      waterHoles: agg.waterHoles,
      weather: state.weather.today,
      seasonIndex: calendarOf(state.clock.minutes).seasonIndex,
      renovations: agg.renovations,
    },
    club: {
      greenFee: state.club.greenFee,
      fairFee: Math.round(fairGreenFee(ratings.overall, amen)),
      reputation: state.club.reputation,
      amenities: state.club.amenities,
      outingToday: extras.outingToday,
    },
    shop: {
      bought: extras.bought,
      lostSale: extras.lostSale,
      fittedRecently: golfer.fittedDay != null && dayAbs - golfer.fittedDay <= 21,
      stockRatio: clamp(shopOpenStock(state) / Math.max(1, shelfCapTotal), 0, 1),
      markupMax,
      staffed: bestSkill(state, ROLE.PROSHOP) > 0,
    },
    staff: {
      groundsHours: Math.round(groundsCrewHours(state)),
      hasInstructor: bestSkill(state, ROLE.INSTRUCTOR) > 0,
      hasFnb: bestSkill(state, ROLE.FNB) > 0,
      hasProshop: bestSkill(state, ROLE.PROSHOP) > 0,
    },
  };
}

// --- the day ----------------------------------------------------------------------------------

export function simulateDayRounds(state, roundsCount, { forceInclude = null } = {}) {
  if (roundsCount <= 0) return { played: 0 };
  const rng = rngOf(state);
  const agg = courseAggregates(state);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs;
  const outingToday = state.club.outings.scheduled.some((o) => o.day === dayAbs);
  const waitMin = clamp((roundsCount - 18) * 1.1, 0, 38) + (outingToday ? 9 : 0);

  // who actually played today
  const players = [];
  const ms = members(state);
  for (const g of ms) {
    if (players.length >= Math.ceil(roundsCount * 0.55)) break;
    const p = 0.16 * (0.5 + g.satisfaction / 100) * (state.weather.today.rainIn > 0.5 ? 0.35 : 1);
    if (g.id === forceInclude || rng.chance(p)) players.push(g);
  }
  if (forceInclude && !players.some((g) => g.id === forceInclude)) {
    const forced = state.golfers.pool.find((g) => g.id === forceInclude);
    if (forced) players.push(forced);
  }
  for (const g of state.golfers.pool) {
    if (players.length >= Math.ceil(roundsCount * 0.8)) break;
    if (g.memberTier || g.leftForever) continue;
    if (rng.chance(0.05)) players.push(g);
  }

  const stockedSkus = SHOP_CATALOG.filter((s) => state.shop.inventory[s.id].shelf > 0);
  const feedCandidates = [];

  for (const g of players) {
    const seed = ((state.seed ^ (dayAbs * 7919)) + g.id * 131) >>> 0;
    const score = simulateRoundScore(state, g, seed, agg);

    // the shop side of the visit
    const bought =
      stockedSkus.length && rng.chance(0.22)
        ? stockedSkus[rng.int(stockedSkus.length)].name
        : null;
    const lostSale = !bought && state.shop.lostSalesYesterday > 0 && rng.chance(clamp(state.shop.lostSalesYesterday / 12, 0, 0.5));

    const ctx = buildRoundContext(state, g, agg, { score, waitMin, playersToday: roundsCount, outingToday, bought, lostSale });
    const thoughts = thoughtsForRound(ctx, seed);

    // memory ring
    g.memory = g.memory || [];
    g.memory.unshift({
      day: dayAbs,
      score,
      par: 34,
      thoughts: thoughts.map((t) => t.rendered),
      moods: thoughts.map((t) => t.mood),
    });
    if (g.memory.length > 8) g.memory.length = 8;

    // satisfaction moves on what actually happened
    let delta = 0;
    for (const t of thoughts) delta += t.mood === 'good' ? 3.4 : t.mood === 'bad' ? -4.2 : 0.3;
    delta += (agg.greensHealth - 55) * 0.05;
    delta -= Math.max(0, waitMin - 12) * 0.12;
    g.satisfaction = clamp(g.satisfaction + delta, 0, 100);

    // skill evolves with play (fittings and a teaching pro accelerate it)
    const prevSkill = g.skill;
    let gain = 0.06;
    if (g.fittedDay != null && dayAbs - g.fittedDay <= 21) gain += 0.05;
    if (bestSkill(state, ROLE.INSTRUCTOR) > 0) gain += 0.03;
    g.skill = Math.max(2, Math.round((g.skill - gain) * 100) / 100);
    g.skillDelta30 = Math.round(((g.skillDelta30 || 0) * 0.9 + (g.skill - prevSkill)) * 100) / 100;

    g.roundsPlayed = (g.roundsPlayed || 0) + 1;
    g.lastVisitDay = dayAbs;
    if (g.bestScore == null || score < g.bestScore) g.bestScore = score;

    // champions: consistently delighted regulars raise the club's name
    if (!g.champion && g.memberTier && (g.memberTier === 'full' || g.memberTier === 'premium') &&
        g.satisfaction >= 85 && g.roundsPlayed >= 12) {
      g.champion = true;
      state.club.champions = state.club.champions || [];
      state.club.champions.push(g.id);
      state.club.reputation = clamp(state.club.reputation + 2, 0, 100);
      state.club.feed.unshift({ kind: 'champion', day: dayAbs, text: `${g.name} has become a true regular — people ask for their tee time.` });
      if (state.club.feed.length > 20) state.club.feed.pop();
    }

    if (thoughts.length && (g.memberTier || rng.chance(0.4))) {
      feedCandidates.push({ name: g.name, thought: thoughts[0] });
    }
  }

  // foot traffic wears the walking surfaces
  const t = state.turf;
  if (t) {
    const greenWear = roundsCount * 0.045;
    const teeWear = roundsCount * 0.075;
    const zones = state.course.zones;
    for (let i = 0; i < zones.length; i++) {
      if (zones[i] === ZONE.GREEN) t.wear[i] = clamp(t.wear[i] + greenWear, 0, 100);
      else if (zones[i] === ZONE.TEE) t.wear[i] = clamp(t.wear[i] + teeWear, 0, 100);
    }
  }

  // overheard around the club: surface a couple of real thoughts
  for (const fc of feedCandidates.slice(0, 2)) {
    state.club.feed.unshift({
      kind: 'thought',
      day: dayAbs,
      text: `${fc.name}: “${fc.thought.rendered}”`,
      mood: fc.thought.mood,
    });
    if (state.club.feed.length > 20) state.club.feed.pop();
  }

  return { played: players.length, waitMin };
}
