import { financialSummary, outcomesInWindow } from './economy.js';
import { propertyConditionBreakdown } from './propertyCondition.js';
import { appraisalBreakdown } from './valuation.js';
import { reputationChangesForDay, reputationSnapshot } from './reputation.js';
import { slotTimes } from './reservations.js';

const r2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const r1 = (value) => Math.round((Number(value) || 0) * 10) / 10;

export function initBusiness(state) {
  const reputation = reputationSnapshot(state);
  const appraisal = appraisalBreakdown(state);
  state.business = {
    lastClosedReputation: reputation.overall,
    lastClosedPropertyValue: appraisal.value,
  };
  return state.business;
}

export function ensureBusiness(state) {
  if (!state.business) return initBusiness(state);
  if (!Number.isFinite(state.business.lastClosedReputation)) state.business.lastClosedReputation = reputationSnapshot(state).overall;
  if (!Number.isFinite(state.business.lastClosedPropertyValue)) state.business.lastClosedPropertyValue = appraisalBreakdown(state).value;
  return state.business;
}

function outcomeCount(outcomes, types) {
  const wanted = new Set(types);
  return outcomes.filter((outcome) => wanted.has(outcome.type)).reduce((sum, outcome) => sum + (outcome.count || 0), 0);
}

function outcomeAmount(outcomes, types) {
  const wanted = new Set(types);
  return outcomes.filter((outcome) => wanted.has(outcome.type)).reduce((sum, outcome) => sum + (outcome.amount || 0), 0);
}

function topCategory(bucket) {
  return Object.entries(bucket || {}).sort((a, b) => b[1] - a[1])[0] || null;
}

export function closeDayIndicators(state, day) {
  const business = ensureBusiness(state);
  const financial = financialSummary(state, day, day);
  const outcomes = outcomesInWindow(state, day, day);
  const condition = propertyConditionBreakdown(state);
  const appraisal = appraisalBreakdown(state);
  const reputation = reputationSnapshot(state);
  const reservations = state.reservations?.booked?.filter((reservation) => reservation.dayAbs === day) || [];
  const playedReservations = reservations.filter((reservation) => reservation.status === 'played').length;
  const heldReservations = reservations.filter((reservation) => reservation.status !== 'cancelled').length;
  const capacity = slotTimes().length;
  const checkoutEntries = state.ledger.entries.filter((entry) =>
    entry.day === day && entry.category === 'shopSales' && entry.relatedId && entry.profitImpact > 0);
  const checkoutCustomers = checkoutEntries.reduce((sum, entry) => sum + (entry.customerCount || 1), 0);
  const checkoutRevenue = checkoutEntries.reduce((sum, entry) => sum + entry.profitImpact, 0);
  const customersServed = outcomeCount(outcomes, ['customerServed', 'shopCustomersServed', 'checkoutCompleted', 'teeCheckIn'])
    || (state.club.lastRounds || 0) + checkoutCustomers;
  const missedSales = outcomeCount(outcomes, ['missedSale']) || (state.shop?.lostSalesYesterday || 0);
  const noShows = outcomeCount(outcomes, ['noShow']);
  const noShowFees = financial.revenueByCategory.noShowFees || outcomeAmount(outcomes, ['noShowFee']);
  const repChanges = reputationChangesForDay(state, day);

  const reasons = [];
  const revenueTop = topCategory(financial.revenueByCategory);
  const expenseTop = topCategory(financial.expenseByCategory);
  if (revenueTop) reasons.push(`Largest revenue source: ${revenueTop[0]} (${r2(revenueTop[1])}).`);
  if (expenseTop) reasons.push(`Largest operating cost: ${expenseTop[0]} (${r2(expenseTop[1])}).`);
  if (missedSales > 0) reasons.push(`${missedSales} intended purchase${missedSales === 1 ? '' : 's'} were missed through stock or price pressure.`);
  if (noShows > 0) reasons.push(`${noShows} tee-time no-show${noShows === 1 ? '' : 's'} cost capacity; ${r2(noShowFees)} was recovered in fees.`);
  for (const problem of condition.unresolved.slice(0, 3)) reasons.push(`${problem.label} remains weak at ${Math.round(problem.score)}.`);
  for (const change of repChanges.slice(0, 3)) reasons.push(`${change.reason} (${change.overallDelta >= 0 ? '+' : ''}${change.overallDelta} reputation).`);

  const indicators = {
    day,
    customersServed: r1(customersServed),
    teeTimeUtilization: capacity ? r1(playedReservations / capacity * 100) : 0,
    teeTimeBookedUtilization: capacity ? r1(heldReservations / capacity * 100) : 0,
    averageTransaction: checkoutCustomers ? r2(checkoutRevenue / checkoutCustomers) : 0,
    missedSales: r1(missedSales),
    noShowImpact: { count: r1(noShows), feesRecovered: r2(noShowFees) },
    cleaningCondition: condition.categories.clubhouseCleanliness.score,
    courseCondition: condition.categories.courseTurf.score,
    propertyCondition: condition.overall,
    reputation: reputation.overall,
    reputationCategories: { ...reputation.categories },
    reputationChange: r1(reputation.overall - business.lastClosedReputation),
    propertyValue: appraisal.value,
    propertyValueChange: r2(appraisal.value - business.lastClosedPropertyValue),
    reasons,
  };
  business.lastClosedReputation = reputation.overall;
  business.lastClosedPropertyValue = appraisal.value;
  return indicators;
}

export function latestDailySummary(state) {
  const summaries = state.ledger?.dailySummaries || [];
  return summaries[summaries.length - 1] || null;
}

export function weeklySummary(state, endingDay = Math.floor((state.clock?.minutes || 0) / 1440) - 1) {
  const summaries = (state.ledger?.dailySummaries || []).filter((summary) => summary.day >= endingDay - 6 && summary.day <= endingDay);
  if (!summaries.length) {
    const financial = financialSummary(state, endingDay - 6, endingDay);
    return { ...financial, days: 0, reasons: [] };
  }
  const total = (key) => r2(summaries.reduce((sum, summary) => sum + (summary[key] || 0), 0));
  const average = (key) => r1(summaries.reduce((sum, summary) => sum + (summary[key] || 0), 0) / summaries.length);
  const reasons = [...new Set(summaries.flatMap((summary) => summary.reasons || []))].slice(-12);
  return {
    fromDay: summaries[0].day,
    toDay: summaries[summaries.length - 1].day,
    days: summaries.length,
    grossRevenue: total('grossRevenue'),
    costOfGoodsSold: total('costOfGoodsSold'),
    operatingExpenses: total('operatingExpenses'),
    netProfit: total('netProfit'),
    cashChange: total('cashChange'),
    customersServed: total('customersServed'),
    missedSales: total('missedSales'),
    teeTimeUtilization: average('teeTimeUtilization'),
    averageTransaction: average('averageTransaction'),
    cleaningCondition: summaries[summaries.length - 1].cleaningCondition,
    courseCondition: summaries[summaries.length - 1].courseCondition,
    reputationChange: r1((summaries[summaries.length - 1].reputation || 0) - (summaries[0].reputation || 0)),
    propertyValueChange: r2((summaries[summaries.length - 1].propertyValue || 0) - (summaries[0].propertyValue || 0)),
    reasons,
  };
}
