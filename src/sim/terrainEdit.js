// FAIRWAY STATE — "Course Works": the plan-then-confirm terrain editing system.
// Edits are staged into a plan (a ghost overlay in the UI), priced, then confirmed
// as a single project — which charges cash and puts affected open holes into
// renovation downtime. Deliberately no undo after confirm: renovation is a real
// business decision, not a free reshuffle.

import { ZONE, HOLE_CORRIDOR_CELLS, HOLE_STATUS } from './constants.js';
import { BALANCE } from './balance.js';
import { distToSegment, clamp } from '../core/utils.js';
import { idx, inBounds, getZone, validateHole, labelSections } from './course.js';
import { turfOnZonesChanged } from './turf.js';
import { spend } from './economy.js';

const ZONE_COST_KEY = {
  [ZONE.OUT]: 'out',
  [ZONE.ROUGH]: 'rough',
  [ZONE.FAIRWAY]: 'fairway',
  [ZONE.GREEN]: 'green',
  [ZONE.TEE]: 'tee',
  [ZONE.BUNKER]: 'bunker',
  [ZONE.WATER]: 'water',
  [ZONE.PATH]: 'path',
};

export function zoneCostPerCell(zone) {
  return BALANCE.zoneCost[ZONE_COST_KEY[zone]] ?? 0;
}

export function makePlan() {
  // cells: Map<cellIndex, { x, y, zone?: targetZone, dElev?: netFeet }>
  return { cells: new Map() };
}

function planEntry(plan, course, x, y) {
  const i = idx(course, x, y);
  let e = plan.cells.get(i);
  if (!e) {
    e = { x, y };
    plan.cells.set(i, e);
  }
  return e;
}

function pruneEntry(plan, course, e) {
  const i = idx(course, e.x, e.y);
  const zoneNoop = e.zone === undefined || e.zone === course.zones[i];
  const elevNoop = e.dElev === undefined || Math.abs(e.dElev) < 1e-6;
  if (zoneNoop) delete e.zone;
  if (elevNoop) delete e.dElev;
  if (e.zone === undefined && e.dElev === undefined) plan.cells.delete(i);
}

function forEachBrushCell(course, cx, cy, radius, fn) {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(course, x, y)) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) fn(x, y);
    }
  }
}

export function planPaintZone(plan, course, cx, cy, radius, zone) {
  forEachBrushCell(course, cx, cy, radius, (x, y) => {
    const e = planEntry(plan, course, x, y);
    e.zone = zone;
    pruneEntry(plan, course, e);
  });
}

export function planAdjustElev(plan, course, cx, cy, radius, dFeet) {
  forEachBrushCell(course, cx, cy, radius, (x, y) => {
    const e = planEntry(plan, course, x, y);
    e.dElev = (e.dElev || 0) + dFeet;
    pruneEntry(plan, course, e);
  });
}

// Smooth pulls each brushed cell's *planned* elevation toward the local average.
export function planSmoothElev(plan, course, cx, cy, radius, strength = 0.5) {
  const planned = (x, y) => {
    const e = plan.cells.get(idx(course, x, y));
    return course.elevation[idx(course, x, y)] + (e && e.dElev ? e.dElev : 0);
  };
  const targets = [];
  forEachBrushCell(course, cx, cy, radius, (x, y) => {
    let sum = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!inBounds(course, x + dx, y + dy)) continue;
        sum += planned(x + dx, y + dy);
        n++;
      }
    }
    targets.push({ x, y, target: sum / n });
  });
  for (const t of targets) {
    const e = planEntry(plan, course, t.x, t.y);
    const cur = planned(t.x, t.y);
    e.dElev = (e.dElev || 0) + (t.target - cur) * strength;
    pruneEntry(plan, course, e);
  }
}

export function planCost(plan, course) {
  let zoneTotal = 0;
  let elevTotal = 0;
  let elevFeet = 0;
  const zoneCells = {};
  for (const e of plan.cells.values()) {
    if (e.zone !== undefined) {
      zoneTotal += zoneCostPerCell(e.zone);
      const key = ZONE_COST_KEY[e.zone];
      zoneCells[key] = (zoneCells[key] || 0) + 1;
    }
    if (e.dElev !== undefined) {
      elevFeet += Math.abs(e.dElev);
      elevTotal += Math.abs(e.dElev) * BALANCE.elevationCostPerFoot;
    }
  }
  return {
    total: Math.round(zoneTotal + elevTotal),
    zoneTotal: Math.round(zoneTotal),
    elevTotal: Math.round(elevTotal),
    elevFeet,
    zoneCells,
    cellCount: plan.cells.size,
  };
}

function renovationDays(cellCount, mode) {
  const r = BALANCE.renovation[mode];
  return clamp(Math.ceil(cellCount / r.cellsPerDay), r.minDays, r.maxDays);
}

// Which open holes does this plan disturb, and for how long?
export function planAffectedHoles(plan, course, mode) {
  const out = [];
  for (const hole of course.holes) {
    if (hole.status !== HOLE_STATUS.OPEN && hole.status !== HOLE_STATUS.RENOVATION) continue;
    if (!hole.tee || !hole.pin) continue;
    let nearCells = 0;
    for (const e of plan.cells.values()) {
      const d = distToSegment(e.x, e.y, hole.tee.x, hole.tee.y, hole.pin.x, hole.pin.y);
      if (d <= HOLE_CORRIDOR_CELLS) nearCells++;
    }
    if (nearCells > 0) out.push({ holeId: hole.id, cells: nearCells, days: renovationDays(nearCells, mode) });
  }
  return out;
}

export function applyPlan(state, plan) {
  const { course } = state;
  if (plan.cells.size === 0) return { ok: false, reason: 'Nothing planned.' };
  const cost = planCost(plan, course);
  if (cost.total > state.cash) {
    return { ok: false, reason: `Not enough cash (${cost.total} needed).` };
  }
  const affected = planAffectedHoles(plan, course, state.mode);

  const changedCells = [];
  for (const e of plan.cells.values()) {
    const i = idx(course, e.x, e.y);
    if (e.zone !== undefined && course.zones[i] !== e.zone) {
      course.zones[i] = e.zone;
      changedCells.push(i);
    }
    if (e.dElev !== undefined) course.elevation[i] += e.dElev;
  }
  spend(state, 'works', cost.total);
  turfOnZonesChanged(state, changedCells);

  for (const a of affected) {
    const hole = course.holes.find((h) => h.id === a.holeId);
    hole.status = HOLE_STATUS.RENOVATION;
    hole.daysLeft = Math.max(hole.daysLeft || 0, a.days);
  }

  // any unbuilt hole that just became complete starts construction
  for (const hole of course.holes) {
    if (hole.status === HOLE_STATUS.UNBUILT && validateHole(course, hole).valid) {
      hole.status = HOLE_STATUS.CONSTRUCTION;
      hole.daysLeft = BALANCE.newHoleConstructionDays[state.mode];
    }
  }

  state.sections = labelSections(course);
  const report = { cost: cost.total, cells: cost.cellCount, holesAffected: affected };
  plan.cells.clear();
  return { ok: true, report };
}

// --- tee/pin placement -------------------------------------------------------

function placeMarker(state, holeId, x, y, kind) {
  const { course } = state;
  const hole = course.holes.find((h) => h.id === holeId);
  if (!hole) return { ok: false, reason: 'No such hole.' };
  const requiredZone = kind === 'tee' ? ZONE.TEE : ZONE.GREEN;
  if (getZone(course, x, y) !== requiredZone) {
    return { ok: false, reason: kind === 'tee' ? 'Tees must sit on a tee pad.' : 'Pins must sit on a green.' };
  }
  if (state.cash < BALANCE.holeMoveCost) return { ok: false, reason: 'Not enough cash.' };

  const wasOpen = hole.status === HOLE_STATUS.OPEN;
  hole[kind === 'tee' ? 'tee' : 'pin'] = { x, y };
  spend(state, 'works', BALANCE.holeMoveCost);

  const valid = validateHole(course, hole).valid;
  if (wasOpen) {
    hole.status = HOLE_STATUS.RENOVATION;
    hole.daysLeft = BALANCE.renovation[state.mode].teePinMoveDays;
  } else if (hole.status === HOLE_STATUS.UNBUILT && valid) {
    hole.status = HOLE_STATUS.CONSTRUCTION;
    hole.daysLeft = BALANCE.newHoleConstructionDays[state.mode];
  }
  state.sections = labelSections(course);
  return { ok: true };
}

export function worksSetTee(state, holeId, x, y) {
  return placeMarker(state, holeId, x, y, 'tee');
}

export function worksSetPin(state, holeId, x, y) {
  return placeMarker(state, holeId, x, y, 'pin');
}

// --- daily countdown ----------------------------------------------------------

export function tickRenovationsDaily(state) {
  for (const hole of state.course.holes) {
    if (hole.status !== HOLE_STATUS.RENOVATION && hole.status !== HOLE_STATUS.CONSTRUCTION) continue;
    hole.daysLeft = Math.max(0, (hole.daysLeft || 0) - 1);
    if (hole.daysLeft === 0) {
      if (validateHole(state.course, hole).valid) {
        hole.status = HOLE_STATUS.OPEN;
        hole.everOpen = true;
      } else {
        // work finished but the hole is incomplete (e.g. its green was dug up)
        hole.status = HOLE_STATUS.UNBUILT;
      }
    }
  }
}
