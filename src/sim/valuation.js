// GOLF EMPIRE — live property valuation.
// One appraisal for everything: the number shown as "estimated value" while you
// own a property IS the number a sale pays out. It reads only what the existing
// simulation already computes — course ratings, the membership book, reputation,
// and the trailing ledger — through appraiseStats, the same formula that priced
// the property's hidden trueValue when it was listed. No second opinion, no lies.

import { clubRatings, memberCounts } from './club.js';
import { validateHole } from './course.js';
import { appraiseStats } from './marketplace.js';

// Trailing per-season net: the game's "monthly income". Averages the daily nets
// of up to the last 24 closed days and scales to the 24-day season, so a short
// history extrapolates rather than undercounting a new club.
export function trailingMonthlyNet(state) {
  const hist = state.ledger ? state.ledger.history : null;
  if (!hist || hist.length === 0) return 0;
  const window = hist.slice(-24);
  const avgDaily = window.reduce((sum, day) => sum + (day.net || 0), 0) / window.length;
  return Math.round(avgDaily * 24);
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
  };
  parts.value = appraiseStats(parts);
  return parts;
}

export function appraiseProperty(state) {
  return appraisalBreakdown(state).value;
}
