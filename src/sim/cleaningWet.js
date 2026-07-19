// WETNESS AND SOLUTION.
//
// Two thin fields over the clubhouse floor and its surfaces, both of which fade on their own:
//
//   wetness  — what the mop leaves behind. Darkens the floor, lifts its gloss, and dries off over
//              about a minute. Purely cosmetic feedback, but it is the feedback that makes mopping
//              feel like mopping rather than like erasing.
//   solution — what the spray bottle lays down. This one is NOT cosmetic: the cloth only lifts
//              smears where solution is actually sitting, which is what makes spray-then-wipe a
//              real two-step rather than two interchangeable ways of pressing a button.
//
// Both are stored at the same resolution as the interior grime grid and share its healer shape, so
// a save carrying one carries all three.

import { clamp } from '../core/utils.js';

export const WET_DRY_SEC = 62;      // a mopped floor is dry again in about a minute
export const SOLUTION_DRY_SEC = 28; // solution flashes off faster than water
export const SOLUTION_MIN = 0.12;   // below this the cloth finds nothing to work with

/** Field dimensions follow the interior grime grid so the three always line up. */
export function ensureWet(state, gridW, gridH) {
  if (!state.shop || !state.shop.reno) return null;
  const reno = state.shop.reno;
  const n = gridW * gridH;
  if (!Array.isArray(reno.wet) || reno.wet.length !== n) reno.wet = new Array(n).fill(0);
  if (!Array.isArray(reno.solution) || reno.solution.length !== n) {
    reno.solution = new Array(n).fill(0);
  }
  // A save can carry NaNs; a single one poisons every average drawn from the field.
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(reno.wet[i])) reno.wet[i] = 0;
    if (!Number.isFinite(reno.solution[i])) reno.solution[i] = 0;
  }
  return reno;
}

// Walk the cells a round brush covers, in grid space, with a soft edge.
function* brush(gridW, gridH, cellYd, cx, cz, radiusYd) {
  const rCells = Math.ceil(radiusYd / cellYd) + 1;
  const gx = cx / cellYd;
  const gz = cz / cellYd;
  const x0 = Math.max(0, Math.floor(gx - rCells));
  const x1 = Math.min(gridW - 1, Math.ceil(gx + rCells));
  const z0 = Math.max(0, Math.floor(gz - rCells));
  const z1 = Math.min(gridH - 1, Math.ceil(gz + rCells));
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot((x + 0.5 - gx) * cellYd, (z + 0.5 - gz) * cellYd);
      if (d > radiusYd) continue;
      // Smooth falloff, but full strength in the middle of the stroke. A curve that is already
      // half-off at the centre cell leaves you scrubbing forever and never looking wet; a hard
      // circle stamps a visible disc edge into the mask. This is the compromise: 1 at the contact
      // point, easing to 0 at the rim.
      const t = d / radiusYd;
      yield { idx: z * gridW + x, strength: 1 - t * t };
    }
  }
}

/** The mop leaves water behind it. */
export function wetAt(state, geom, x, z, radiusYd, amount = 1) {
  const reno = state.shop.reno;
  if (!reno || !Array.isArray(reno.wet)) return 0;
  let touched = 0;
  for (const { idx, strength } of brush(geom.w, geom.h, geom.cell, x, z, radiusYd)) {
    const next = clamp(reno.wet[idx] + amount * strength, 0, 1);
    if (next > reno.wet[idx]) {
      reno.wet[idx] = Math.round(next * 1000) / 1000;
      touched++;
    }
  }
  return touched;
}

/** The spray bottle lays solution. */
export function solutionAt(state, geom, x, z, radiusYd, amount = 1) {
  const reno = state.shop.reno;
  if (!reno || !Array.isArray(reno.solution)) return 0;
  let touched = 0;
  for (const { idx, strength } of brush(geom.w, geom.h, geom.cell, x, z, radiusYd)) {
    const next = clamp(reno.solution[idx] + amount * strength, 0, 1);
    if (next > reno.solution[idx]) {
      reno.solution[idx] = Math.round(next * 1000) / 1000;
      touched++;
    }
  }
  return touched;
}

/** How much solution is sitting at a point — the cloth's licence to work. */
export function solutionLevel(state, geom, x, z) {
  const reno = state.shop.reno;
  if (!reno || !Array.isArray(reno.solution)) return 0;
  const gx = Math.floor(x / geom.cell);
  const gz = Math.floor(z / geom.cell);
  if (gx < 0 || gz < 0 || gx >= geom.w || gz >= geom.h) return 0;
  return reno.solution[gz * geom.w + gx] || 0;
}

export function wetLevel(state, geom, x, z) {
  const reno = state.shop.reno;
  if (!reno || !Array.isArray(reno.wet)) return 0;
  const gx = Math.floor(x / geom.cell);
  const gz = Math.floor(z / geom.cell);
  if (gx < 0 || gz < 0 || gx >= geom.w || gz >= geom.h) return 0;
  return reno.wet[gz * geom.w + gx] || 0;
}

/** Wiping consumes the solution it uses up. */
export function consumeSolution(state, geom, x, z, radiusYd, amount) {
  const reno = state.shop.reno;
  if (!reno || !Array.isArray(reno.solution)) return;
  for (const { idx, strength } of brush(geom.w, geom.h, geom.cell, x, z, radiusYd)) {
    reno.solution[idx] = Math.round(Math.max(0, reno.solution[idx] - amount * strength) * 1000) / 1000;
  }
}

/**
 * Both fields fade. Returns true if anything actually changed, so the renderer can skip
 * repainting a floor that is already dry.
 */
export function dryTick(state, dtSec) {
  const reno = state.shop && state.shop.reno;
  if (!reno || !Array.isArray(reno.wet)) return false;
  const wetStep = dtSec / WET_DRY_SEC;
  const solStep = dtSec / SOLUTION_DRY_SEC;
  let changed = false;
  for (let i = 0; i < reno.wet.length; i++) {
    if (reno.wet[i] > 0) {
      reno.wet[i] = Math.round(Math.max(0, reno.wet[i] - wetStep) * 1000) / 1000;
      changed = true;
    }
    if (reno.solution[i] > 0) {
      reno.solution[i] = Math.round(Math.max(0, reno.solution[i] - solStep) * 1000) / 1000;
      changed = true;
    }
  }
  return changed;
}

export const meanWet = (state) => {
  const w = state.shop?.reno?.wet;
  return Array.isArray(w) && w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0;
};
