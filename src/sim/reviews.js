// REVIEWS — a reading of a day that actually happened.
//
// The rule, borrowed wholesale from data/thoughts.js: nothing gets said unless it is true right
// now. Every clause a reviewer can utter hangs off a factor with a predicate over real state, so
// the shop cannot be praised for being spotless while it is filthy, and nobody complains about a
// queue on a day they walked straight to the till. A review that is not evidence is just noise,
// and noise teaches the player nothing.
//
// Each review therefore carries its working: the factors it read, and the ones it cited. The
// laptop can show that, which is the whole point of "reviews must clearly explain cause".

import { clamp } from '../core/utils.js';
import { calendarOf } from './time.js';
import { notify } from './notifications.js';
import { shopCondition, exteriorScore } from './shop.js';
import { exteriorWashScore } from './washing.js';
import { clubRatings, fairGreenFee, amenityScore } from './club.js';
import { SHOP_CATALOG, RETAIL_CATS } from '../data/shopItems.js';
import { applyReputationChange, ensureReputation } from './reputation.js';
import { recordOutcome } from './economy.js';

const MAX_REVIEWS = 60;
const FACTOR_REPUTATION_CATEGORY = {
  shopClean: 'cleanliness', exterior: 'cleanliness', courseCondition: 'course',
  stock: 'retail', prices: 'retail', coursePrice: 'course', waitTime: 'service', queue: 'service',
};

// what fraction of the retail lines actually have something on the shelf
function stockRatio(state) {
  const lines = SHOP_CATALOG.filter((s) => RETAIL_CATS.has(s.cat));
  if (!lines.length) return 1;
  const stocked = lines.filter((s) => {
    const inv = state.shop.inventory[s.id];
    return inv && inv.shelf > 0;
  }).length;
  return stocked / lines.length;
}

// how greedy the markup is, averaged over the categories the player sets
function markupPressure(state) {
  const m = state.shop.markup || {};
  const vals = Object.values(m);
  if (!vals.length) return 1;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  // 1.0 is the book price; 1.6+ is taking the mickey
  return clamp(1 - (avg - 1.0) / 0.7, 0, 1);
}

// Each factor: a score in 0..1 (1 = delighted), a name, and the two things a person might say
// about it. `when` gates whether it is even part of *this* visit — you cannot resent a queue you
// never joined.
export const REVIEW_FACTORS = [
  {
    id: 'shopClean',
    label: 'Clubhouse cleanliness',
    weight: 1.1,
    read: (st, v) => clamp(v.cleanliness ?? (shopCondition(st) / 100), 0, 1),
    praise: () => 'the pro shop was spotless',
    gripe: (st) => `the pro shop was grimy (condition ${Math.round(shopCondition(st))})`,
  },
  {
    id: 'exterior',
    label: 'Outside the clubhouse',
    weight: 0.9,
    read: (st) => clamp(0.55 * exteriorWashScore(st) + 0.45 * exteriorScore(st), 0, 1),
    praise: () => 'the place looked well kept from the car park',
    gripe: () => 'the outside of the clubhouse is a state — dirty siding, weeds up the wall',
  },
  {
    id: 'courseCondition',
    label: 'Course condition',
    weight: 1.3,
    read: (st, v) => clamp(v.courseCondition ?? (clubRatings(st).condition / 100), 0, 1),
    praise: (st) => `the greens were in great shape (${Math.round(clubRatings(st).condition)})`,
    gripe: (st) => `the course is in poor condition (${Math.round(clubRatings(st).condition)})`,
    when: (st, v) => v.played !== false,
  },
  {
    id: 'stock',
    label: 'Product availability',
    weight: 1.0,
    read: (st, v) => clamp(
      v.productAvailability ?? (v.foundWhatTheyWanted === false ? 0 : stockRatio(st)),
      0,
      1,
    ),
    praise: () => 'the shop was properly stocked',
    gripe: (st, v) => (v.productAvailability === 0 || v.foundWhatTheyWanted === false
      ? 'the item I came for was unavailable'
      : 'half the shelves were bare — I could not find what I came for'),
  },
  {
    id: 'prices',
    label: 'Shop prices',
    weight: 0.8,
    read: (st, v) => clamp(v.pricing ?? markupPressure(st), 0, 1),
    praise: () => 'the prices were fair',
    gripe: () => 'the shop prices are steep for what it is',
  },
  {
    id: 'coursePrice',
    label: 'Green fee',
    weight: 1.0,
    read: (st) => {
      const r = clubRatings(st);
      const fair = fairGreenFee(r.overall, amenityScore(st));
      const fee = st.club.greenFee || fair;
      return clamp(1 - (fee - fair) / (fair * 0.8), 0, 1);
    },
    praise: () => 'good value for the round',
    gripe: (st) => `the green fee is too high for the state of the course ($${Math.round(st.club.greenFee || 0)})`,
    when: (st, v) => v.played !== false,
  },
  {
    id: 'waitTime',
    label: 'Time at the till',
    weight: 1.2,
    // 0s is perfect; 3 minutes standing there is not
    read: (st, v) => clamp(1 - (v.waitedSec || 0) / 180, 0, 1),
    praise: () => 'I was served straight away',
    gripe: (st, v) => `checkout took too long (${Math.round((v.waitedSec || 0) / 60)} minutes in the queue)`,
    when: (st, v) => (v.waitedSec || 0) > 0 || (v.queueLen || 0) > 0,
  },
  {
    id: 'queue',
    label: 'Checkout queue',
    weight: 0.7,
    read: (st, v) => clamp(1 - (v.queueLen || 0) / 6, 0, 1),
    praise: () => 'no queue at all',
    gripe: (st, v) => `there were ${v.queueLen} people in front of me and one till`,
    when: (st, v) => (v.queueLen || 0) > 0,
  },
  {
    id: 'navigationCongestion',
    label: 'Ease of moving around',
    weight: 0.8,
    read: (st, v) => clamp(1 - (v.navigationCongestion || 0), 0, 1),
    praise: () => 'the shop was easy to move around',
    gripe: () => 'the shop floor was cramped and hard to navigate',
    when: (st, v) => (v.navigationCongestion || 0) > 0,
  },
  {
    id: 'checkoutSuccess',
    label: 'Checkout result',
    weight: 1.4,
    read: (st, v) => clamp(v.checkoutSuccess, 0, 1),
    praise: () => 'checkout went smoothly',
    gripe: () => 'I could not complete my purchase',
    when: (st, v) => v.checkoutSuccess != null,
  },
  {
    id: 'checkInSuccess',
    label: 'Front-desk result',
    weight: 1.4,
    read: (st, v) => clamp(v.checkInSuccess, 0, 1),
    praise: () => 'the front desk handled my tee time smoothly',
    gripe: () => 'the front desk could not sort out my tee time',
    when: (st, v) => v.checkInSuccess != null,
  },
];

export function readFactors(state, visit = {}) {
  return REVIEW_FACTORS
    .filter((f) => !f.when || f.when(state, visit))
    .map((f) => ({
      id: f.id,
      label: f.label,
      weight: f.weight,
      score: clamp(f.read(state, visit), 0, 1),
    }));
}

// a deterministic shuffle, so the same reviewer on the same day writes the same review
const hashPick = (seed, n) => Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1 * n;

export function reviewFor(state, visit = {}, seed = 0) {
  const factors = readFactors(state, visit);
  const wsum = factors.reduce((a, f) => a + f.weight, 0) || 1;
  const mean = factors.reduce((a, f) => a + f.score * f.weight, 0) / wsum;
  const stars = clamp(Math.round(1 + mean * 4), 1, 5);

  const sorted = [...factors].sort((a, b) => a.score - b.score);
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  const def = (id) => REVIEW_FACTORS.find((f) => f.id === id);

  // vary WHICH good and bad thing gets picked, without ever picking one that isn't true
  const bad = sorted.filter((f) => f.score < 0.45);
  const good = sorted.filter((f) => f.score > 0.7).reverse();
  const pickBad = bad.length ? bad[Math.floor(hashPick(seed + 1, bad.length))] : null;
  const pickGood = good.length ? good[Math.floor(hashPick(seed + 2, good.length))] : null;

  const cited = [];
  let text;
  if (pickGood && pickBad) {
    cited.push(pickGood, pickBad);
    const g = def(pickGood.id).praise(state, visit);
    const b = def(pickBad.id).gripe(state, visit);
    text = `${cap(g)}, but ${b}.`;
  } else if (pickGood) {
    cited.push(pickGood);
    text = `${cap(def(pickGood.id).praise(state, visit))}.`;
  } else if (pickBad) {
    cited.push(pickBad);
    text = `${cap(def(pickBad.id).gripe(state, visit))}.`;
  } else {
    // nothing stood out either way — say so, and cite the thing closest to an opinion
    const mid = sorted[Math.floor(sorted.length / 2)];
    cited.push(mid);
    text = mid.score >= 0.5
      ? `${cap(def(mid.id).praise(state, visit))}, nothing to complain about.`
      : `${cap(def(mid.id).gripe(state, visit))}.`;
  }

  const day = state.clock ? calendarOf(state.clock.minutes).dayAbs : (state.day || 0);
  const id = String(visit.reviewId || `review:${day}:${String(seed).replace(/[^0-9a-z.-]+/gi, '-')}`);
  return { id, stars, text, factors, cited, worst, best, day };
}

// A completed round has stronger evidence than a generic clubhouse visit. These
// factors read the scorecard, pace clock, course snapshot, practice choice, and
// assigned cart from the canonical golf-day record. No clause is selected from
// a facility or event the reviewer did not actually experience.
export function reviewForCompletedRound(state, round, seed = 0) {
  const factors = [
    {
      id: 'roundScore',
      label: 'Personal round',
      weight: 0.85,
      score: clamp(0.72 - Math.max(-4, Number(round.score) - Number(round.par)) * 0.025, 0.2, 0.92),
      praise: `I got around in ${round.score}, which made the day`,
      gripe: `I struggled to a ${round.score}`,
    },
    {
      id: 'roundPace',
      label: 'Pace of play',
      weight: 1.45,
      score: clamp(1 - Number(round.waitingMinutes || 0) / 18, 0, 1),
      praise: `we kept moving and finished in ${Math.round(round.durationMinutes)} minutes`,
      gripe: `we spent ${Math.round(round.waitingMinutes)} minutes waiting on groups ahead`,
    },
    {
      id: 'roundCondition',
      label: 'Playing conditions',
      weight: 1.35,
      score: clamp(Number(round.conditionRating || 0) / 100, 0, 1),
      praise: `the course played well at a ${Math.round(round.conditionRating)} condition rating`,
      gripe: `the ${Math.round(round.conditionRating)} condition rating showed up in our lies`,
    },
  ];
  factors.push({
    id: 'roundCheckIn',
    label: 'Check-in',
    weight: 0.65,
    score: clamp(1 - Number(round.checkInMinutes || 0) / 12, 0.15, 1),
    praise: Number(round.checkInMinutes || 0) <= 2
      ? 'check-in was quick and connected us straight to the course'
      : `check-in took about ${Math.round(round.checkInMinutes)} minutes but was handled clearly`,
    gripe: `check-in took about ${Math.round(round.checkInMinutes)} minutes`,
  });
  factors.push({
    id: 'roundStart',
    label: 'Start punctuality',
    weight: 1.0,
    score: clamp(1 - Number(round.startDelayMinutes || 0) / 18, 0, 1),
    praise: Number(round.startDelayMinutes || 0) < 1
      ? 'the starter sent us off on time'
      : `the starter kept our delay to ${Math.round(round.startDelayMinutes)} minutes`,
    gripe: `our tee time slipped by ${Math.round(round.startDelayMinutes)} minutes`,
  });
  if (round.greenQuality != null) {
    factors.push({
      id: 'roundGreens',
      label: 'Greens',
      weight: 1.0,
      score: clamp(Number(round.greenQuality) / 100, 0, 1),
      praise: `the greens rolled honestly at ${Math.round(round.greenQuality)} condition`,
      gripe: `the greens felt rough at ${Math.round(round.greenQuality)} condition`,
    });
  }
  if (round.bunkerQuality != null) {
    factors.push({
      id: 'roundBunkers',
      label: 'Bunkers',
      weight: 0.55,
      score: clamp(Number(round.bunkerQuality) / 100, 0, 1),
      praise: `the bunkers were playable at ${Math.round(round.bunkerQuality)} condition`,
      gripe: `the bunkers showed their ${Math.round(round.bunkerQuality)} condition rating`,
    });
  }
  if (round.roughDifficulty != null) {
    factors.push({
      id: 'roundRough',
      label: 'Rough',
      weight: 0.5,
      score: clamp(1 - Number(round.roughDifficulty) / 125, 0.1, 1),
      praise: `the rough was fair enough to find and play from`,
      gripe: `the rough difficulty felt like ${Math.round(round.roughDifficulty)} out of 100`,
    });
  }
  if (round.designRating != null) {
    factors.push({
      id: 'roundDesign',
      label: 'Course design',
      weight: 0.7,
      score: clamp(Number(round.designRating) / 100, 0, 1),
      praise: `the ${Math.round(round.designRating)}-rated layout made us think`,
      gripe: `the ${Math.round(round.designRating)}-rated layout never found a rhythm`,
    });
  }
  if (round.sceneryRating != null) {
    factors.push({
      id: 'roundScenery',
      label: 'Scenery',
      weight: 0.45,
      score: clamp(Number(round.sceneryRating) / 100, 0, 1),
      praise: `the setting felt cared for at ${Math.round(round.sceneryRating)} quality`,
      gripe: `the scenery felt unfinished at ${Math.round(round.sceneryRating)} quality`,
    });
  }
  if (round.serviceRating != null) {
    factors.push({
      id: 'roundService',
      label: 'Service',
      weight: 0.7,
      score: clamp(Number(round.serviceRating) / 100, 0, 1),
      praise: `the staff service earned a ${Math.round(round.serviceRating)} rating`,
      gripe: `the staff service only earned a ${Math.round(round.serviceRating)} rating`,
    });
  }
  if (round.valueRating != null) {
    factors.push({
      id: 'roundValue',
      label: 'Value',
      weight: 0.9,
      score: clamp(Number(round.valueRating) / 100, 0, 1),
      praise: 'the green fee felt fair for the day we had',
      gripe: 'the green fee did not match the experience',
    });
  }
  if (round.practiceKind) {
    factors.push({
      id: 'roundPractice',
      label: 'Pre-round practice',
      weight: 0.55,
      score: 0.86,
      praise: `the ${round.practiceKind} area was a useful warm-up`,
      gripe: `the ${round.practiceKind} area did not help us settle in`,
    });
  }
  if (round.cartRequested && !round.cartUnavailable && round.cartCondition != null) {
    factors.push({
      id: 'roundCart',
      label: 'Golf cart',
      weight: 0.7,
      score: clamp(Number(round.cartCondition) / 100, 0, 1),
      praise: `our cart was ready and in good shape (${Math.round(round.cartCondition)})`,
      gripe: `our cart felt worn (${Math.round(round.cartCondition)} condition)`,
    });
  }
  if (round.cartRequested && round.cartUnavailable) {
    factors.push({
      id: 'roundCartAvailability',
      label: 'Cart availability',
      weight: 1.0,
      score: 0.1,
      praise: 'the staff found a workable transport plan',
      gripe: 'the cart we reserved was not available',
    });
  }
  if (Number(round.marshalVisits || 0) > 0) {
    factors.push({
      id: 'roundMarshal',
      label: 'Marshal response',
      weight: 0.65,
      score: 0.78,
      praise: 'the marshal checked on the backup instead of ignoring it',
      gripe: 'the marshal visit came after the pace had already slipped',
    });
  }

  const weighted = factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0);
  const weight = factors.reduce((sum, factor) => sum + factor.weight, 0) || 1;
  const mean = weighted / weight;
  const stars = clamp(Math.round(1 + mean * 4), 1, 5);
  const sorted = [...factors].sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  const bad = sorted.filter((factor) => factor.score < 0.48);
  const good = sorted.filter((factor) => factor.score > 0.72).reverse();
  const pickBad = bad.length ? bad[Math.floor(hashPick(seed + 31, bad.length))] : null;
  const pickGood = good.length ? good[Math.floor(hashPick(seed + 47, good.length))] : null;
  const cited = [];
  let text;
  if (pickGood && pickBad) {
    cited.push(pickGood, pickBad);
    text = `${cap(pickGood.praise)}, but ${pickBad.gripe}.`;
  } else if (pickGood) {
    cited.push(pickGood);
    text = `${cap(pickGood.praise)}.`;
  } else {
    const focus = pickBad || sorted[Math.floor(sorted.length / 2)];
    cited.push(focus);
    text = focus.score < 0.5 ? `${cap(focus.gripe)}.` : `${cap(focus.praise)}.`;
  }
  const publicFactors = factors.map(({ id, label, weight: factorWeight, score }) => ({
    id,
    label,
    weight: factorWeight,
    score,
  }));
  const citedIds = new Set(cited.map((factor) => factor.id));
  const publicCited = publicFactors.filter((factor) => citedIds.has(factor.id));
  const day = state.clock ? calendarOf(state.clock.minutes).dayAbs : (state.day || 0);
  return {
    stars,
    text,
    factors: publicFactors,
    cited: publicCited,
    worst: publicFactors.find((factor) => factor.id === sorted[0].id),
    best: publicFactors.find((factor) => factor.id === sorted[sorted.length - 1].id),
    day,
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function postReview(state, review) {
  if (!state.club.reviews) state.club.reviews = [];
  if (review.id && state.club.reviews.some((item) => item.id === review.id)) return review;
  const reviewId = review.id || `review:${review.day}:${state.club.reviews.length + 1}`;
  state.club.reviews.unshift({
    id: reviewId,
    stars: review.stars,
    text: review.text,
    day: review.day,
    cited: review.cited.map((c) => c.id),
    roundId: review.roundId || null,
    golferId: review.golferId || null,
    source: review.source || 'visit',
  });
  if (state.club.reviews.length > MAX_REVIEWS) state.club.reviews.length = MAX_REVIEWS;

  // Reputation changes only in the categories this review can support, and the
  // reason stored beside the delta is the same evidence the player reads.
  const reputation = ensureReputation(state);
  const grouped = {};
  const fallbackScore = clamp((Number(review.stars) - 1) / 4, 0, 1);
  for (const factor of review.cited || []) {
    const category = FACTOR_REPUTATION_CATEGORY[factor.id];
    if (!category) continue;
    const score = Number(factor.score);
    (grouped[category] ||= []).push(Number.isFinite(score) ? clamp(score, 0, 1) : fallbackScore);
  }
  if (!Object.keys(grouped).length) grouped.service = [fallbackScore];
  for (const [category, scores] of Object.entries(grouped)) {
    const target = scores.reduce((sum, score) => sum + score, 0) / scores.length * 100;
    const delta = clamp((target - reputation.categories[category]) * 0.03, -3, 3);
    applyReputationChange(state, {
      id: `${reviewId}:${category}`, category, delta, day: review.day,
      source: 'customer-review', sourceId: reviewId,
      reason: `${review.stars}-star review: ${review.text}`,
    });
  }
  recordOutcome(state, {
    idempotencyKey: `${reviewId}:posted`, type: 'reviewPosted', count: 1,
    relatedId: reviewId, reason: `${review.stars}-star review posted: ${review.text}`,
    day: review.day, metadata: { stars: review.stars, cited: (review.cited || []).map((factor) => factor.id) },
  });
  // one heads-up per day, however many land — the Reviews page holds the rest
  notify(state, {
    kind: 'review',
    text: `New review${review.stars <= 2 ? ` — ${review.stars}★, worth reading` : `: ${review.stars}★`}. More may follow today.`,
    dedupeKey: `review:${review.day}`,
  });
  return review;
}

export function reviewSummary(state, visit = {}) {
  const reviews = state.club.reviews || [];
  const factors = readFactors(state, visit);
  const byFactor = factors
    .map((f) => ({ id: f.id, label: f.label, score: Math.round(f.score * 100) / 100 }))
    .sort((a, b) => a.score - b.score);
  return {
    count: reviews.length,
    average: reviews.length
      ? Math.round((reviews.reduce((a, r) => a + r.stars, 0) / reviews.length) * 10) / 10
      : 0,
    recent: reviews.slice(0, 8),
    byFactor,
    worst: byFactor[0] || null,
    best: byFactor[byFactor.length - 1] || null,
  };
}

// --- analytics that explain themselves ---------------------------------------------------
// "Visitors decreased 22% because of heavy rain and a course-condition rating below 60."

export function explainVisitors(state, { today, yesterday, rainedToday }) {
  const delta = yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100) : 0;
  const causes = [];
  if (rainedToday) causes.push('rain');
  const cond = Math.round(clubRatings(state).condition);
  if (cond < 60) causes.push(`a course condition of ${cond}`);
  const rep = Math.round(state.club.reputation);
  if (rep < 35) causes.push(`a reputation of ${rep}`);
  const s = stockRatio(state);
  if (s < 0.4) causes.push(`${Math.round((1 - s) * 100)}% of the shelves empty`);

  if (Math.abs(delta) < 5) {
    return causes.length
      ? `Visitors held at ${today} — still held back by ${list(causes)}.`
      : `Visitors held at ${today}.`;
  }
  const dir = delta < 0 ? 'fell' : 'rose';
  if (delta < 0 && causes.length) {
    return `Visitors ${dir} ${Math.abs(delta)}% to ${today} — ${list(causes)}.`;
  }
  if (delta > 0 && !causes.length) {
    return `Visitors ${dir} ${delta}% to ${today} — the place is in good order.`;
  }
  return `Visitors ${dir} ${Math.abs(delta)}% to ${today}.`;
}

function list(a) {
  if (a.length === 1) return a[0];
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}
