// GOLF EMPIRE — live property valuation.
// One appraisal for everything: the number shown as "estimated value" while you
// own a property IS the number a sale pays out. It reads only what the existing
// simulation already computes — course ratings, the membership book, reputation,
// and the trailing ledger — through appraiseStats, the same formula that priced
// the property's hidden trueValue when it was listed. No second opinion, no lies.

import { clubRatings, memberCounts } from './club.js';
import { validateHole } from './course.js';
import { appraiseStats, round500 } from './marketplace.js';
import { shopPropertyImprovementValue } from './shopProgression.js';

// Trailing per-season net: the game's "monthly income". Sums the last 24 closed
// days over the FULL 24-day window — a young club with five days of books gets
// credit for five days of profit, not an annualized hot streak. (Browser QA
// caught the alternative: extrapolating a 6-day honeymoon let a $45k purchase
// appraise at $103k — a flip exploit, not a valuation.)
export function trailingMonthlyNet(state) {
  const hist = state.ledger ? state.ledger.history : null;
  if (!hist || hist.length === 0) return 0;
  return Math.round(hist.slice(-24).reduce((sum, day) => sum + (day.net || 0), 0));
}

// Real holes on the ground (open, renovating, or under construction) — the
// acreage the appraisal prices. Unbuilt stubs don't count.
function realHoleCount(state) {
  return state.course.holes.filter((h) => validateHole(state.course, h).valid).length;
}

export function appraisalBreakdown(state) {
  const ratings = clubRatings(state);
  const counts = memberCounts(state);
  const parts = {
    size: realHoleCount(state),
    design: Math.round(ratings.design * 10) / 10,
    condition: Math.round(ratings.condition * 10) / 10,
    members: counts.weekday + counts.full + counts.premium,
    reputation: Math.round(state.club.reputation * 10) / 10,
    monthlyNet: trailingMonthlyNet(state),
    shopImprovements: shopPropertyImprovementValue(state),
  };
  parts.value = round500(appraiseStats(parts) + parts.shopImprovements);
  return parts;
}

export function appraiseProperty(state) {
  return appraisalBreakdown(state).value;
}
