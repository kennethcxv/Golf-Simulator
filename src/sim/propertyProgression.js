import { propertyConditionBreakdown } from './propertyCondition.js';
import { trailingMonthlyNet } from './valuation.js';
import { reputationOverall } from './reputation.js';

export const PROPERTY_TIER_ORDER = [
  'neglectedPublic', 'establishedLocal', 'resortStyle', 'premiumPrivate',
];

export const PROPERTY_TIERS = {
  neglectedPublic: {
    id: 'neglectedPublic',
    level: 1,
    name: 'Small neglected public course',
    purchasePrice: [15000, 75000],
    startingCondition: [20, 55],
    holeCount: [9],
    customerDemand: 0.75,
    maintenanceComplexity: 'Low',
    clubhouseScale: 'Compact',
    upgradeCapacity: 6,
    reputationExpectation: 35,
    operatingCostMultiplier: 0.8,
    potentialValue: [65000, 160000],
    unlock: null,
  },
  establishedLocal: {
    id: 'establishedLocal',
    level: 2,
    name: 'Established local course',
    purchasePrice: [80000, 220000],
    startingCondition: [30, 68],
    holeCount: [9, 18],
    customerDemand: 1,
    maintenanceComplexity: 'Moderate',
    clubhouseScale: 'Full local club',
    upgradeCapacity: 10,
    reputationExpectation: 50,
    operatingCostMultiplier: 1.1,
    potentialValue: [180000, 420000],
    unlock: { soldProperties: 1, propertyCondition: 48, reputation: 42, monthlyNet: 2500 },
  },
  resortStyle: {
    id: 'resortStyle',
    level: 3,
    name: 'Resort-style course',
    purchasePrice: [260000, 700000],
    startingCondition: [40, 75],
    holeCount: [18],
    customerDemand: 1.3,
    maintenanceComplexity: 'High',
    clubhouseScale: 'Resort clubhouse',
    upgradeCapacity: 14,
    reputationExpectation: 68,
    operatingCostMultiplier: 1.55,
    potentialValue: [650000, 1500000],
    unlock: { soldProperties: 2, propertyCondition: 62, reputation: 58, monthlyNet: 8000 },
  },
  premiumPrivate: {
    id: 'premiumPrivate',
    level: 4,
    name: 'Premium private club',
    purchasePrice: [900000, 2200000],
    startingCondition: [50, 82],
    holeCount: [18],
    customerDemand: 1.55,
    maintenanceComplexity: 'Very high',
    clubhouseScale: 'Premium private estate',
    upgradeCapacity: 18,
    reputationExpectation: 82,
    operatingCostMultiplier: 2.1,
    potentialValue: [1800000, 5000000],
    unlock: { soldProperties: 3, propertyCondition: 75, reputation: 72, monthlyNet: 18000 },
  },
};

export function initEmpireProgression(empire) {
  empire.progression = {
    unlockedTierIds: ['neglectedPublic'],
    completedSales: [],
    processedSaleIds: {},
    appraisals: [],
    nextAppraisalId: 1,
    saleBackups: [],
  };
  return empire.progression;
}

export function ensureEmpireProgression(empire) {
  if (!empire.progression) initEmpireProgression(empire);
  const progression = empire.progression;
  progression.unlockedTierIds ||= ['neglectedPublic'];
  if (!progression.unlockedTierIds.includes('neglectedPublic')) progression.unlockedTierIds.unshift('neglectedPublic');
  progression.completedSales ||= [];
  progression.processedSaleIds ||= {};
  progression.appraisals ||= [];
  if (!Number.isInteger(progression.nextAppraisalId) || progression.nextAppraisalId < 1) progression.nextAppraisalId = progression.appraisals.length + 1;
  progression.saleBackups ||= [];
  return progression;
}

export function propertyTier(property) {
  return PROPERTY_TIERS[property?.tierId] || PROPERTY_TIERS.neglectedPublic;
}

export function tierUnlocked(empire, tierId) {
  return ensureEmpireProgression(empire).unlockedTierIds.includes(tierId);
}

export function nextLockedTier(empire) {
  return PROPERTY_TIER_ORDER.map((id) => PROPERTY_TIERS[id]).find((tier) => !tierUnlocked(empire, tier.id)) || null;
}

export function propertyReadiness(state, empire = null) {
  const condition = propertyConditionBreakdown(state);
  const reputation = reputationOverall(state);
  const monthlyNet = trailingMonthlyNet(state);
  const closedDays = state.ledger?.history?.length || 0;
  const saleRequirements = [
    { id: 'operating-history', label: 'Operate for 3 closed days', met: closedDays >= 3, value: closedDays, target: 3 },
    { id: 'safe-condition', label: 'Reach property condition 35', met: condition.overall >= 35, value: condition.overall, target: 35 },
    { id: 'settle-arrears', label: 'Clear severe property arrears', met: (state.property?.arrears || 0) < 5000, value: state.property?.arrears || 0, target: 0 },
  ];
  const nextTier = empire ? nextLockedTier(empire) : null;
  const unlock = nextTier?.unlock;
  const sold = empire ? ensureEmpireProgression(empire).completedSales.length : 0;
  const nextRequirements = nextTier && unlock ? [
    { id: 'sold-properties', label: `Complete ${unlock.soldProperties} property sale${unlock.soldProperties === 1 ? '' : 's'}`, met: sold >= unlock.soldProperties, value: sold, target: unlock.soldProperties },
    { id: 'condition', label: `Property condition ${unlock.propertyCondition}`, met: condition.overall >= unlock.propertyCondition, value: condition.overall, target: unlock.propertyCondition },
    { id: 'reputation', label: `Reputation ${unlock.reputation}`, met: reputation >= unlock.reputation, value: reputation, target: unlock.reputation },
    { id: 'profit', label: `24-day profit $${unlock.monthlyNet.toLocaleString('en-US')}`, met: monthlyNet >= unlock.monthlyNet, value: monthlyNet, target: unlock.monthlyNet },
  ] : [];
  return {
    closedDays,
    condition: condition.overall,
    reputation,
    monthlyNet,
    saleRequirements,
    saleEligible: saleRequirements.every((requirement) => requirement.met),
    nextTier,
    nextRequirements,
    nextTierEligible: nextRequirements.length > 0 && nextRequirements.every((requirement) => requirement.met),
  };
}

export function unlockEarnedTier(empire, state) {
  const progression = ensureEmpireProgression(empire);
  const readiness = propertyReadiness(state, empire);
  if (!readiness.nextTier || !readiness.nextTierEligible) return null;
  progression.unlockedTierIds.push(readiness.nextTier.id);
  return readiness.nextTier;
}

export function nextProgressionGoal(state, empire = null) {
  const readiness = propertyReadiness(state, empire);
  const unmetSale = readiness.saleRequirements.find((requirement) => !requirement.met);
  if (unmetSale) return { id: unmetSale.id, title: unmetSale.label, type: 'sale-readiness' };
  const unmetTier = readiness.nextRequirements.find((requirement) => !requirement.met);
  if (unmetTier) return { id: unmetTier.id, title: unmetTier.label, type: 'next-property' };
  if (readiness.nextTier) return { id: 'request-appraisal', title: 'Request an appraisal and decide whether to keep or sell', type: 'decision' };
  return { id: 'keep-or-sell', title: 'Keep operating or sell at peak value', type: 'sandbox' };
}
