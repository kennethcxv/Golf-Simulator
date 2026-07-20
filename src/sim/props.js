// FAIRWAY STATE — course restoration props: storm litter to haul off and the
// broken tee sign to repair. Additive state only (state.props); the scene
// renders piles/signs from it and calls back through these functions.

import { makeRng } from '../core/utils.js';
import { spend } from './economy.js';
import { ZONE, TURF_ZONES } from './constants.js';

export const PROPS = {
  litterCount: 4,
  litterWearWipe: 40,  // the ground under a hauled pile recovers this much wear
  signRepairCost: 150, // materials for the tee sign
};

export function initCourseProps(state) {
  // a LOCAL stream (seed-derived) — never state.rngState, so adding props
  // cannot shift any other system's draws
  const rng = makeRng(((state.seed >>> 0) ^ 0x9d70) || 1);
  const candidates = [];
  const { w, h, zones } = state.course;
  for (let cy = 2; cy < h - 2; cy++) {
    for (let cx = 2; cx < w - 2; cx++) {
      const zone = zones[cy * w + cx];
      if (TURF_ZONES.has(zone) && zone !== ZONE.GREEN) candidates.push({ cx, cy });
    }
  }
  const litter = [];
  for (let n = 0; n < PROPS.litterCount && candidates.length; n++) {
    const idx = rng.int(candidates.length);
    const c = candidates.splice(idx, 1)[0];
    litter.push({ cx: c.cx, cy: c.cy, cleared: false });
  }
  state.props = { litter, teeSignFixed: false };
}

export function ensureCourseProps(state) {
  if (!state.props) initCourseProps(state);
}

export function clearLitter(state, idx) {
  const p = state.props && state.props.litter[idx];
  if (!p || p.cleared) return { ok: false };
  p.cleared = true;
  if (state.turf) {
    const i = p.cy * state.course.w + p.cx;
    state.turf.wear[i] = Math.max(0, state.turf.wear[i] - PROPS.litterWearWipe);
  }
  return { ok: true };
}

export function fixTeeSign(state) {
  if (!state.props || state.props.teeSignFixed) return { ok: false };
  if (state.cash < PROPS.signRepairCost) return { ok: false, reason: 'Not enough cash for materials.' };
  spend(state, 'upkeep', PROPS.signRepairCost, {
    idempotencyKey: `property:${state.property?.id || state.seed}:tee-sign`, relatedId: 'tee-sign',
    description: 'Repair materials for the first-tee sign', source: 'course-restoration',
  });
  state.props.teeSignFixed = true;
  return { ok: true, cost: PROPS.signRepairCost };
}
