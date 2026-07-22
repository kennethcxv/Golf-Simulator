// Persistent maintenance work orders. Planning is inert: turf changes only when
// the player physically performs work or an eligible paid staff/equipment task
// accumulates its deterministic game-time duration.

import { ZONE, TURF_ZONES } from './constants.js';
import { BALANCE } from './balance.js';
import { calendarOf } from './time.js';
import { clamp } from '../core/utils.js';
import { spend } from './economy.js';
import { ROLE, staffByRole } from './staff.js';
import { hasUpgrade } from './progression.js';

export const WORK_ORDER_TYPES = {
  mow: { label: 'Mow', zones: TURF_ZONES, minutesPerCell: 0.8, costPerCell: 0.28, equipment: 'mower' },
  water: { label: 'Water', zones: TURF_ZONES, minutesPerCell: 0.35, costPerCell: 0.12, equipment: 'irrigation' },
  fertilize: { label: 'Fertilize', zones: TURF_ZONES, minutesPerCell: 0.42, costPerCell: 0.62, equipment: 'sprayer' },
  repairDivots: { label: 'Repair divots', zones: new Set([ZONE.TEE, ZONE.FAIRWAY]), minutesPerCell: 0.55, costPerCell: 0.18, equipment: 'hand-tools' },
  repairBallMarks: { label: 'Repair ball marks', zones: new Set([ZONE.GREEN]), minutesPerCell: 0.7, costPerCell: 0.2, equipment: 'hand-tools' },
  rakeBunker: { label: 'Rake bunker', zones: new Set([ZONE.BUNKER]), minutesPerCell: 0.5, costPerCell: 0.2, equipment: 'rake' },
  treatDisease: { label: 'Treat disease', zones: TURF_ZONES, minutesPerCell: 0.48, costPerCell: 2.2, equipment: 'sprayer' },
  aerate: { label: 'Aerate', zones: TURF_ZONES, minutesPerCell: 0.65, costPerCell: 1.2, equipment: 'aerator' },
};

const ACTIVE = new Set(['open', 'queued', 'in_progress']);
const MAX_ACTIVE_ORDERS = 24;

export function ensureMaintenanceOrders(state) {
  if (!state.maintenance) return;
  const m = state.maintenance;
  if (!Array.isArray(m.orders)) m.orders = [];
  if (!Number.isInteger(m.nextOrderId) || m.nextOrderId < 1) m.nextOrderId = 1;
  if (!Array.isArray(m.orderHistory)) m.orderHistory = [];
  m.orders = m.orders.filter((order) => order && WORK_ORDER_TYPES[order.type]).slice(-MAX_ACTIVE_ORDERS);
  for (const order of m.orders) {
    if (!Number.isFinite(order.progressMinutes)) order.progressMinutes = 0;
    if (!Number.isFinite(order.durationMinutes) || order.durationMinutes <= 0) order.durationMinutes = 60;
    if (!ACTIVE.has(order.status) && order.status !== 'complete' && order.status !== 'cancelled') order.status = 'open';
    if (!['player', 'staff', 'automation'].includes(order.assignment)) order.assignment = 'player';
    if (!Array.isArray(order.manualCells)) order.manualCells = [];
  }
}

function sectionTarget(section) {
  return {
    sectionId: section.id,
    zone: section.zone,
    holeId: section.holeId ?? null,
    name: section.name,
    size: section.cells.length,
    centroid: { x: section.centroid.x, y: section.centroid.y },
  };
}

export function resolveOrderSection(state, order) {
  const exact = state.sections.find((section) => section.id === order.target.sectionId
    && section.zone === order.target.zone);
  if (exact) return exact;
  let best = null;
  let bestDistance = Infinity;
  for (const section of state.sections) {
    if (section.zone !== order.target.zone) continue;
    if (order.target.holeId != null && section.holeId !== order.target.holeId) continue;
    const distance = Math.hypot(
      section.centroid.x - order.target.centroid.x,
      section.centroid.y - order.target.centroid.y,
    );
    if (distance < bestDistance) { best = section; bestDistance = distance; }
  }
  return best;
}

export function estimateWorkOrder(type, section) {
  const spec = WORK_ORDER_TYPES[type];
  if (!spec) return null;
  const durationMinutes = Math.max(30, Math.round(section.cells.length * spec.minutesPerCell));
  const estimatedCost = Math.max(8, Math.round(section.cells.length * spec.costPerCell));
  return { durationMinutes, estimatedCost, equipment: spec.equipment };
}

export function createWorkOrder(state, type, section) {
  ensureMaintenanceOrders(state);
  const spec = WORK_ORDER_TYPES[type];
  if (!spec) return { ok: false, reason: 'Unknown maintenance task.' };
  if (!section || !spec.zones.has(section.zone)) return { ok: false, reason: 'That task does not fit this surface.' };
  const duplicate = state.maintenance.orders.find((order) => ACTIVE.has(order.status)
    && order.type === type && order.target.sectionId === section.id && order.target.zone === section.zone);
  if (duplicate) return { ok: false, reason: 'That work order is already active.', order: duplicate };
  const activeCount = state.maintenance.orders.filter((order) => ACTIVE.has(order.status)).length;
  if (activeCount >= MAX_ACTIVE_ORDERS) return { ok: false, reason: 'The work-order board is full.' };
  const estimate = estimateWorkOrder(type, section);
  const order = {
    id: state.maintenance.nextOrderId++,
    type,
    label: spec.label,
    target: sectionTarget(section),
    assignment: 'player',
    status: 'open',
    createdMinute: state.clock.minutes,
    durationMinutes: estimate.durationMinutes,
    progressMinutes: 0,
    estimatedCost: estimate.estimatedCost,
    reservedCost: 0,
    equipment: estimate.equipment,
    manualCells: [],
    result: null,
  };
  state.maintenance.orders.push(order);
  return { ok: true, order };
}

export function automationTier(state) {
  const groundskeepers = staffByRole(state, ROLE.GROUNDSKEEPER, { available: true });
  if (hasUpgrade(state, 'smartIrrigation')) return 3;
  if (groundskeepers.length || hasUpgrade(state, 'greensMowerII') || hasUpgrade(state, 'fairwayMowerII')) return 2;
  if (state.tractor?.repaired) return 1;
  return 0;
}

export function canAutomateOrder(state, order) {
  if (order.type === 'water') return hasUpgrade(state, 'smartIrrigation');
  if (order.type === 'mow') {
    return order.target.zone === ZONE.GREEN || order.target.zone === ZONE.TEE
      ? hasUpgrade(state, 'greensMowerII')
      : hasUpgrade(state, 'fairwayMowerII');
  }
  if (order.type === 'fertilize' || order.type === 'treatDisease') return hasUpgrade(state, 'sprayRig');
  if (order.type === 'aerate') return hasUpgrade(state, 'aerator');
  return false;
}

export function assignWorkOrder(state, orderId, assignment) {
  ensureMaintenanceOrders(state);
  const order = state.maintenance.orders.find((entry) => entry.id === orderId);
  if (!order || !ACTIVE.has(order.status)) return { ok: false, reason: 'Work order is no longer active.' };
  if (assignment === 'player') {
    order.assignment = 'player';
    order.status = 'open';
    return { ok: true, order, cost: 0 };
  }
  if (order.reservedCost > 0) return { ok: false, reason: 'This paid assignment is already scheduled.' };
  if (assignment === 'staff' && staffByRole(state, ROLE.GROUNDSKEEPER, { available: true }).length === 0) {
    return { ok: false, reason: 'Hire an available groundskeeper first.' };
  }
  if (assignment === 'automation' && !canAutomateOrder(state, order)) {
    return { ok: false, reason: 'The required automation equipment is not unlocked.' };
  }
  if (assignment !== 'staff' && assignment !== 'automation') return { ok: false, reason: 'Unknown assignment.' };
  const costFactor = assignment === 'staff' ? 1 : 0.72;
  const cost = Math.max(5, Math.round(order.estimatedCost * costFactor));
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash to reserve this work.' };
  spend(state, 'upkeep', cost);
  order.assignment = assignment;
  order.status = 'queued';
  order.reservedCost = cost;
  order.assignedMinute = state.clock.minutes;
  return { ok: true, order, cost };
}

function irrigationCovers(state, cellIndex) {
  const heads = state.course.irrigationHeads || [];
  if (!heads.length) return false;
  const x = cellIndex % state.course.w;
  const y = Math.floor(cellIndex / state.course.w);
  return heads.some((head) => Math.hypot(head.x - x, head.y - y) <= 5);
}

function applyCompletedOrder(state, order, section, quality) {
  const t = state.turf;
  const policyKey = { [ZONE.GREEN]: 'green', [ZONE.TEE]: 'tee', [ZONE.FAIRWAY]: 'fairway', [ZONE.ROUGH]: 'rough' }[section.zone];
  let changed = 0;
  let missed = 0;
  for (const i of section.cells) {
    if (state.course.zones[i] !== section.zone) { missed += 1; continue; }
    if (order.type === 'mow' && policyKey) {
      const target = state.maintenance.policies[policyKey].mowHeightMm;
      t.heightMm[i] = Math.max(target, t.heightMm[i] - Math.max(2, (t.heightMm[i] - target) * quality));
    } else if (order.type === 'water') {
      if (order.assignment === 'automation' && !irrigationCovers(state, i)) { missed += 1; continue; }
      t.moisture[i] = clamp(t.moisture[i] + 24 * quality, 0, 100);
    } else if (order.type === 'fertilize') {
      t.nutrients[i] = clamp(t.nutrients[i] + 18 * quality, 0, 100);
    } else if (order.type === 'repairDivots') {
      t.divots[i] = Math.max(0, t.divots[i] - 6 * quality);
      t.wear[i] = Math.max(0, t.wear[i] - 12 * quality);
    } else if (order.type === 'repairBallMarks') {
      t.ballMarks[i] = Math.max(0, t.ballMarks[i] - 6 * quality);
      t.wear[i] = Math.max(0, t.wear[i] - 10 * quality);
    } else if (order.type === 'rakeBunker') {
      t.wear[i] = Math.max(0, t.wear[i] - 80 * quality);
    } else if (order.type === 'treatDisease') {
      t.treated[i] = BALANCE.turf.fungicideProtectionDays;
      t.disSev[i] = Math.max(0, t.disSev[i] - 35 * quality);
    } else if (order.type === 'aerate') {
      t.wear[i] = Math.max(0, t.wear[i] - 35 * quality);
      t.health[i] = clamp(t.health[i] + 3 * quality, 0, 100);
    }
    changed += 1;
  }
  if (order.type === 'mow' && policyKey) {
    state.maintenance.lastMowDay[policyKey] = calendarOf(state.clock.minutes).dayAbs;
  }
  if (order.type === 'fertilize' && policyKey) {
    state.maintenance.lastFertDay[policyKey] = calendarOf(state.clock.minutes).dayAbs;
  }
  return { changed, missed, quality: Math.round(quality * 100) / 100 };
}

function completeOrder(state, order, quality) {
  const section = resolveOrderSection(state, order);
  if (!section) {
    order.status = 'cancelled';
    order.result = { reason: 'Target no longer exists after course construction.' };
    return;
  }
  order.status = 'complete';
  order.completedMinute = state.clock.minutes;
  order.progressMinutes = order.durationMinutes;
  order.result = applyCompletedOrder(state, order, section, quality);
  state.maintenance.orderHistory.unshift({
    id: order.id, type: order.type, target: order.target.name,
    assignment: order.assignment, completedMinute: order.completedMinute, result: order.result,
  });
  if (state.maintenance.orderHistory.length > 20) state.maintenance.orderHistory.length = 20;
}

export function tickMaintenanceOrders(state, gameMinutes = 60) {
  ensureMaintenanceOrders(state);
  const groundskeepers = staffByRole(state, ROLE.GROUNDSKEEPER, { available: true });
  const busyStaff = new Set();
  const busyEquipment = new Set();
  const progressed = [];
  for (const order of state.maintenance.orders) {
    if ((order.status !== 'queued' && order.status !== 'in_progress') || order.assignment === 'player') continue;
    let speed = 1;
    if (order.assignment === 'staff') {
      const worker = groundskeepers.find((entry) => !busyStaff.has(entry.id));
      if (!worker) continue;
      busyStaff.add(worker.id);
      order.assignedStaffId = worker.id;
      speed = 0.72 + worker.skill * 0.11;
    } else {
      if (busyEquipment.has(order.equipment)) continue;
      busyEquipment.add(order.equipment);
      speed = 1.05;
    }
    order.status = 'in_progress';
    order.progressMinutes = Math.min(order.durationMinutes, order.progressMinutes + Math.max(0, gameMinutes) * speed);
    progressed.push(order.id);
    if (order.progressMinutes >= order.durationMinutes) completeOrder(state, order, clamp(speed, 0.78, 1.15));
  }
  return { progressed };
}

export function recordManualWork(state, type, cellIndex) {
  ensureMaintenanceOrders(state);
  for (const order of state.maintenance.orders) {
    if (order.assignment !== 'player' || order.status !== 'open' || order.type !== type) continue;
    const section = resolveOrderSection(state, order);
    if (!section || !section.cells.includes(cellIndex) || order.manualCells.includes(cellIndex)) continue;
    order.manualCells.push(cellIndex);
    const ratio = order.manualCells.length / Math.max(1, section.cells.length);
    order.progressMinutes = Math.min(order.durationMinutes, order.durationMinutes * ratio);
    if (ratio >= 0.98) {
      // The physical hooks already changed each touched cell. Completion only
      // closes the tracking order; it never grants untouched maintenance.
      order.status = 'complete';
      order.completedMinute = state.clock.minutes;
      order.result = { changed: order.manualCells.length, missed: section.cells.length - order.manualCells.length, quality: 1 };
    }
    return { ok: true, order };
  }
  return { ok: false };
}

export function cancelWorkOrder(state, orderId) {
  ensureMaintenanceOrders(state);
  const order = state.maintenance.orders.find((entry) => entry.id === orderId);
  if (!order || !ACTIVE.has(order.status)) return { ok: false };
  order.status = 'cancelled';
  order.cancelledMinute = state.clock.minutes;
  return { ok: true, order };
}

export function workOrderProgress(order) {
  return clamp(order.progressMinutes / Math.max(1, order.durationMinutes), 0, 1);
}
