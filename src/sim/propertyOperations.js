// Remote property operations for the empire layer. This module owns the
// player-facing contracts and pure projections; empire.js remains the wallet,
// world-clock, and transaction authority.

import { clamp } from '../core/utils.js';
import { completePropertyProfile, round500 } from './marketplace.js';

export const PROPERTY_INSPECTION_COST = 750;
export const REMOTE_PROPERTY_UTILITIES_PER_DAY = 45;

export const PROPERTY_MANAGER_TIERS = Object.freeze({
  caretaker: Object.freeze({
    id: 'caretaker',
    label: 'Caretaker crew',
    description: 'Keeps the gates open. Revenue is thin and a healthy course drifts toward condition 38.',
    hireCost: 0,
    dailyCostPerNine: 150,
    conditionFloor: 38,
    conditionDecay: 0.035,
    roundsMultiplier: 1,
    revenueMultiplier: 1,
  }),
  manager: Object.freeze({
    id: 'manager',
    label: 'Club manager',
    description: 'Runs bookings and the crew remotely. Slower decline, steadier play, and condition protected to 52.',
    hireCost: 6500,
    dailyCostPerNine: 325,
    conditionFloor: 52,
    conditionDecay: 0.018,
    roundsMultiplier: 1.22,
    revenueMultiplier: 1.05,
  }),
  director: Object.freeze({
    id: 'director',
    label: 'Operations director',
    description: 'A senior operator for valuable clubs. Strong attendance and near-hold condition above 68.',
    hireCost: 16000,
    dailyCostPerNine: 610,
    conditionFloor: 68,
    conditionDecay: 0.0075,
    roundsMultiplier: 1.55,
    revenueMultiplier: 1.12,
  }),
});

const MANAGER_NAMES = Object.freeze([
  'Morgan Hale', 'Dana Mercer', 'Jordan Bell', 'Casey Rowan',
  'Avery Shaw', 'Riley Brooks', 'Cameron Price', 'Taylor Quinn',
]);

export function managerTier(id) {
  return PROPERTY_MANAGER_TIERS[id] || PROPERTY_MANAGER_TIERS.caretaker;
}

function managerNameFor(property, tierId) {
  if (tierId === 'caretaker') return 'Local caretaker crew';
  const seed = Math.abs(Number(property?.seed) || 1);
  const offset = tierId === 'director' ? 3 : 0;
  return MANAGER_NAMES[(seed + offset) % MANAGER_NAMES.length];
}

export function defaultPropertyOperations(property) {
  return {
    managerTier: 'caretaker',
    managerName: managerNameFor(property, 'caretaker'),
    hiredDay: null,
    managementFeesPaid: 0,
    acquisition: null,
  };
}

export function ensureHoldingOperations(holding) {
  if (!holding.operations || typeof holding.operations !== 'object') {
    holding.operations = defaultPropertyOperations(holding.property);
  }
  const tier = managerTier(holding.operations.managerTier);
  holding.operations.managerTier = tier.id;
  if (!holding.operations.managerName) {
    holding.operations.managerName = managerNameFor(holding.property, tier.id);
  }
  if (!Number.isFinite(holding.operations.managementFeesPaid)) {
    holding.operations.managementFeesPaid = 0;
  }
  if (!('hiredDay' in holding.operations)) holding.operations.hiredDay = null;
  if (!('acquisition' in holding.operations)) holding.operations.acquisition = null;
  return holding.operations;
}

export function propertyOperationsProfile(holding) {
  const operations = ensureHoldingOperations(holding);
  return { operations, tier: managerTier(operations.managerTier) };
}

export function assignManagerRecord(holding, tierId, dayAbs) {
  const next = PROPERTY_MANAGER_TIERS[tierId];
  if (!next) return { ok: false, reason: 'That management contract is not available.' };
  const operations = ensureHoldingOperations(holding);
  if (operations.managerTier === next.id) {
    return { ok: true, already: true, tier: next, operations };
  }
  operations.managerTier = next.id;
  operations.managerName = managerNameFor(holding.property, next.id);
  operations.hiredDay = Number.isFinite(dayAbs) ? dayAbs : 0;
  if (next.hireCost > 0) operations.managementFeesPaid += next.hireCost;
  return { ok: true, tier: next, operations };
}

export function buildInspectionReport(property, inspectedDay = 0) {
  if (!property) return null;
  completePropertyProfile(property);
  const sizeFactor = Math.max(1, (Number(property.size) || 9) / 9);
  const trueValue = Math.max(500, Number(property.trueValue) || Number(property.askingPrice) || 500);
  const maintenanceReserve = round500(
    (100 - clamp(Number(property.condition) || 0, 0, 100)) * 135 * sizeFactor
    + Math.max(0, Number(property.sickGreens) || 0) * 2400,
  );
  const risks = [];
  if (property.condition < 40) risks.push('Major deferred maintenance');
  else if (property.condition < 58) risks.push('Visible maintenance backlog');
  if (property.sickGreens > 0) risks.push(`${property.sickGreens} diseased green${property.sickGreens === 1 ? '' : 's'}`);
  if (property.size >= 18) risks.push('Two-course-scale operating footprint');
  if (property.design < 60) risks.push('Limited routing upside');
  if (!risks.length) risks.push('No material defect beyond normal wear');

  const opportunities = [];
  if (property.design >= 82 && property.condition < 60) opportunities.push('Strong design buried under poor condition');
  if (property.startingMembers < 15) opportunities.push('Membership book has room to rebuild');
  if (property.listingBias < 0.95) opportunities.push('Ask appears soft against inspected fundamentals');
  if (!opportunities.length) opportunities.push('Value depends on disciplined day-to-day operation');

  return {
    propertyId: property.id,
    inspectedDay,
    feePaid: PROPERTY_INSPECTION_COST,
    valueLow: round500(trueValue * 0.93),
    valueHigh: round500(trueValue * 1.07),
    maintenanceReserve,
    region: property.region,
    climate: property.climate,
    difficulty: property.difficulty,
    customerDemand: property.customerDemand,
    expansionPotential: property.expansionPotential,
    tourismRating: property.tourismRating,
    maintenanceCostPerDay: property.maintenanceCostPerDay,
    operatingCostPerDay: property.operatingCostPerDay,
    risks,
    opportunities,
  };
}

export function passiveOperationsProjection(holding) {
  const { tier } = propertyOperationsProfile(holding);
  const sizeFactor = Math.max(1, (Number(holding.property?.size) || 9) / 9);
  const propertyOverhead = Math.round(Math.max(0, Number(holding.property?.operatingCostPerDay) || 0) * 0.45);
  return {
    protectedCondition: tier.conditionFloor,
    dailyManagementCost: Math.round(
      tier.dailyCostPerNine * sizeFactor + propertyOverhead + REMOTE_PROPERTY_UTILITIES_PER_DAY,
    ),
    propertyOverhead,
    utilities: REMOTE_PROPERTY_UTILITIES_PER_DAY,
    attendanceMultiplier: tier.roundsMultiplier,
    revenueMultiplier: tier.revenueMultiplier,
    decayRate: tier.conditionDecay,
  };
}
