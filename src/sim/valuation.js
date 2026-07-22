// GOLF EMPIRE — explainable, pure property valuation.
// Every amount is recomputed from current game state. Contributions have stable
// IDs, so moving the same furniture or re-reading an appraisal cannot accumulate
// value. The displayed value remains the amount a valid sale offer starts from.

import { clubRatings, memberCounts, AMENITIES } from './club.js';
import { validateHole } from './course.js';
import { appraiseStatsBreakdown, round500 } from './marketplace.js';
import { propertyConditionBreakdown } from './propertyCondition.js';
import { UPGRADES } from './progression.js';
import { reputationOverall } from './reputation.js';
import { financialSummary } from './economy.js';
import { shopPropertyImprovementValue } from './shopProgression.js';

const r2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function trailingMonthlyNet(state) {
  const history = state.ledger?.history;
  const closed = history?.slice(-24) || [];
  let total = closed.reduce((sum, day) => sum + (day.summary?.netProfit ?? day.net ?? 0), 0);
  const postingDay = state.ledger?.postingDay;
  if (Number.isInteger(postingDay) && !closed.some((day) => day.dayAbs === postingDay)) {
    total += financialSummary(state, postingDay, postingDay).netProfit;
  }
  return Math.round(total);
}

function realHoleCount(state) {
  return state.course.holes.filter((hole) => validateHole(state.course, hole).valid).length;
}

function restorationInvestment(state) {
  return Math.max(0, r2((state.ledger?.entries || [])
    .filter((entry) => entry.accountingClass === 'capital')
    .reduce((sum, entry) => sum - entry.cashImpact, 0)));
}

function upgradeContributions(state) {
  const contributions = [];
  for (const id of Object.keys(state.progression?.unlocks || {}).sort()) {
    const upgrade = UPGRADES[id];
    if (!upgrade) continue;
    contributions.push({
      id: `upgrade:${id}`,
      label: upgrade.name,
      amount: round500(upgrade.valueEffect ?? upgrade.cost * 0.45),
      reason: upgrade.visibleResult || upgrade.blurb,
    });
  }
  for (const key of Object.keys(AMENITIES).sort()) {
    const level = state.club?.amenities?.[key] || 0;
    for (let index = 0; index < level; index += 1) {
      const spec = AMENITIES[key];
      contributions.push({
        id: `amenity:${key}:level-${index + 1}`,
        label: `${spec.name} level ${index + 1}`,
        amount: round500((spec.cost[index] || 0) * 0.5),
        reason: 'A durable, player-purchased amenity visible in club operations.',
      });
    }
  }
  return contributions;
}

export function appraisalBreakdown(state) {
  const ratings = clubRatings(state);
  const counts = memberCounts(state);
  const size = realHoleCount(state);
  const members = counts.weekday + counts.full + counts.premium;
  const reputation = reputationOverall(state);
  const monthlyNet = trailingMonthlyNet(state);
  const propertyCondition = propertyConditionBreakdown(state);
  const base = appraiseStatsBreakdown({
    size,
    design: ratings.design,
    condition: ratings.condition,
    members,
    reputation,
    monthlyNet,
  });
  const sizeFactor = Math.max(size, 4) / 9;
  const conditionAdjustment = round500((propertyCondition.overall - 50) * 35 * sizeFactor);
  const unresolvedDamage = Math.max(0, round500(propertyCondition.unresolved
    .reduce((sum, problem) => sum + problem.lossSeverity * 6 * sizeFactor, 0)));
  const upgradeRows = upgradeContributions(state);
  const upgradeValue = upgradeRows.reduce((sum, contribution) => sum + contribution.amount, 0);
  const shopImprovements = shopPropertyImprovementValue(state);
  const rawValue = base.value + conditionAdjustment - unresolvedDamage + upgradeValue + shopImprovements;
  const value = Math.max(round500(rawValue), round500(base.land * 0.5));
  const acquisitionCost = r2(state.property?.acquisitionCost ?? state.club?.acquisitionCost ?? 0);
  const outstanding = r2(Math.max(0, state.property?.arrears || 0) + Math.max(0, state.property?.loanBalance || 0));

  const contributions = [
    { id: 'base:land', label: 'Land and fixed infrastructure', amount: round500(base.land), reason: `${size} real holes determine the acreage floor.` },
    { id: 'base:course-quality', label: 'Course design and turf', amount: round500(base.course), reason: `Design ${Math.round(ratings.design)}, course condition ${Math.round(ratings.condition)}.` },
    { id: 'business:members', label: 'Membership book', amount: round500(base.membership), reason: `${members} active members.` },
    { id: 'business:reputation', label: 'Reputation', amount: round500(base.reputation), reason: `Overall reputation ${Math.round(reputation)}.` },
    { id: 'business:earnings', label: 'Trailing operating profit', amount: round500(base.earnings), reason: `${monthlyNet >= 0 ? '+' : ''}$${Math.round(monthlyNet).toLocaleString('en-US')} over the last 24 closed days.` },
    { id: 'condition:whole-property', label: 'Whole-property condition', amount: conditionAdjustment, reason: `All thirteen real-state condition categories combine to ${Math.round(propertyCondition.overall)}.` },
    ...upgradeRows,
    { id: 'shop:fit-out', label: 'Pro-shop fit-out', amount: shopImprovements, reason: 'The installed retail tier adds durable value to the clubhouse.' },
    { id: 'deduction:unresolved-damage', label: 'Unresolved problems', amount: -unresolvedDamage, reason: `${propertyCondition.unresolved.length} condition categories remain below 45.` },
  ];
  const explained = contributions.reduce((sum, contribution) => sum + contribution.amount, 0);
  const reconciliation = value - explained;
  if (reconciliation !== 0) {
    contributions.push({
      id: 'valuation:rounding-floor',
      label: reconciliation > 0 ? 'Valuation floor and market rounding' : 'Market rounding adjustment',
      amount: reconciliation,
      reason: 'Reconciles rounded contribution lines exactly to the sale valuation.',
    });
  }

  return {
    size,
    design: Math.round(ratings.design * 10) / 10,
    condition: Math.round(ratings.condition * 10) / 10,
    propertyCondition: propertyCondition.overall,
    conditionBreakdown: propertyCondition,
    members,
    reputation,
    monthlyNet,
    acquisitionCost,
    restorationInvestment: restorationInvestment(state),
    upgradeValue,
    shopImprovements,
    unresolvedDamage,
    outstanding,
    grossSaleValue: value,
    estimatedSaleProceeds: Math.max(0, r2(value - outstanding)),
    value,
    contributions,
  };
}

export function appraiseProperty(state) {
  return appraisalBreakdown(state).value;
}
