// LOOSE DEBRIS — swept, piled, and carried away.
//
// Leaves, grit, wrappers, the stuff that ends up in the corners of a clubhouse nobody has run for
// two years. The rule that shapes this whole file: a broom MOVES debris. It never deletes it. You
// push it downrange, scattered bits merge into piles as they overlap, the piles get denser as you
// work them, and only a dustpan or a vacuum actually removes anything.
//
// Debris is stored as CLUSTERS — `{ x, z, a }`, a position in shop-local yards and an amount —
// rather than as individual particles. A hundred independent rigid bodies would cost far more than
// it is worth and behave worse; a few dozen clusters that merge on contact give you the pile
// behaviour the reference art is asking for, save in a few hundred bytes, and never explode.

import { restorationAction } from './clubhouseRestoration.js';
import { BROOM_FEEL } from '../data/broomFeel.js';

const MAX_CLUSTERS = 96;      // a hard ceiling: merging keeps us far below this in practice
export const DEBRIS_MERGE_YD = 0.34;  // piles closer than this become one
// How fast the bristles push debris. From the one broom tuning file: the push
// must beat the walk speed (2.2 yd/s), or a forward push at full stride walks
// straight over its own pile — the review's "dirt lag". (Shipped at 1.05
// before Phase 6 round 2.)
const SWEEP_SPEED_YD = BROOM_FEEL.dirt.pushSpeed;
const SWEEP_MAX_STEP = BROOM_FEEL.dirt.maxStep;  // no single stroke may fling debris further
const SUCK_PULL_YD = 1.35;    // how hard the intake draws debris in, yards/second
const SUCK_MOUTH_YD = 0.16;   // debris is consumed only this close to the nozzle

export function debrisState(state) {
  return state.shop.reno.debris;
}

/** Make the debris list valid, on a new game or an old save. */
export function ensureDebris(state) {
  if (!state.shop || !state.shop.reno) return null;
  const reno = state.shop.reno;
  if (!Array.isArray(reno.debris)) {
    reno.debris = [];
    return reno.debris;
  }
  // A save can arrive with nulls, NaNs or half-written entries. Drop them rather than letting a
  // single bad cluster poison every distance test on the floor.
  reno.debris = reno.debris.filter((d) => d
    && Number.isFinite(d.x) && Number.isFinite(d.z) && Number.isFinite(d.a) && d.a > 0);
  for (const d of reno.debris) {
    if (d.kind !== 'litter' && d.kind !== 'grit') {
      // Old saves did not distinguish wrappers from grit. Derive a stable mix from position so a
      // reload never changes it and the trash-bag verb is not empty on a legacy floor.
      const hash = Math.abs(Math.floor(d.x * 31 + d.z * 53));
      d.kind = hash % 5 === 0 ? 'litter' : 'grit';
    }
  }
  return reno.debris;
}

export const clusterCount = (state) => debrisState(state).length;

export const totalDebris = (state) =>
  debrisState(state).reduce((sum, d) => sum + d.a, 0);

export function syncGenericCleanupMilestone(state) {
  const list = ensureDebris(state);
  const clutter = state?.shop?.reno?.clutter;
  const clutterClear = !Array.isArray(clutter) || clutter.every((entry) => entry?.cleared);
  const debrisLeft = list.reduce((sum, entry) => sum + (entry?.a || 0), 0);
  const pan = Number(state?.shop?.reno?.pan) || 0;
  const bag = Number(state?.shop?.reno?.bag) || 0;
  if (!clutterClear || debrisLeft > 0.02 || pan > 0.001 || bag > 0.001) return null;
  return restorationAction(state, {
    type: 'complete-cleanup-milestone',
    milestoneId: 'generic-debris',
  });
}

/**
 * Scatter starting debris across a floor. Deterministic for a given seed so a reloaded save and a
 * fresh one agree, and so the tests are not flaky.
 */
export function seedDebris(state, count, spanX, spanZ, seed = 1) {
  const list = ensureDebris(state);
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < count && list.length < MAX_CLUSTERS; i++) {
    list.push({
      x: Math.round(((rnd() - 0.5) * spanX) * 1000) / 1000,
      z: Math.round(((rnd() - 0.5) * spanZ) * 1000) / 1000,
      a: Math.round((0.12 + rnd() * 0.22) * 1000) / 1000,
      kind: i % 4 === 0 ? 'litter' : 'grit',
    });
  }
  return list;
}

/** Fold piles that now overlap into single, denser ones. Conserves the total exactly. */
function merge(list) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b) continue;
      if ((a.kind || 'grit') !== (b.kind || 'grit')) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) > DEBRIS_MERGE_YD) continue;
      // the bigger pile wins the position, weighted — a small bit joins the heap, not vice versa
      const total = a.a + b.a;
      a.x = (a.x * a.a + b.x * b.a) / total;
      a.z = (a.z * a.a + b.z * b.a) / total;
      a.a = total;
      list[j] = null;
    }
  }
  let w = 0;
  for (let i = 0; i < list.length; i++) if (list[i]) list[w++] = list[i];
  list.length = w;
}

/**
 * Push debris along a direction. Nothing is removed.
 *
 * @param {number} x,z        the bristle contact point, shop-local yards
 * @param {number} dirX,dirZ  sweep direction (need not be normalised)
 * @param {number} radius     bristle width in yards
 * @param {number} dtSec
 * @returns {{moved:number}}  how much debris the stroke touched
 */
export function sweepAt(state, x, z, dirX, dirZ, radius, dtSec) {
  const list = ensureDebris(state);
  const len = Math.hypot(dirX, dirZ) || 1;
  const ux = dirX / len;
  const uz = dirZ / len;
  const step = Math.min(SWEEP_MAX_STEP, SWEEP_SPEED_YD * dtSec);
  let moved = 0;

  for (const d of list) {
    const dist = Math.hypot(d.x - x, d.z - z);
    if (dist > radius) continue;
    // the middle of the head pushes hardest; the ends just nudge
    const bite = 1 - (dist / radius) * 0.65;
    d.x = Math.round((d.x + ux * step * bite) * 1000) / 1000;
    d.z = Math.round((d.z + uz * step * bite) * 1000) / 1000;
    moved += d.a;
  }
  if (moved > 0) merge(list);
  return { moved };
}

/**
 * Scoop up whatever is in front of the pan. Generous on purpose — hunting for a pile with
 * pixel-perfect placement is not the game.
 * @returns {number} the amount collected
 */
export function collectAt(state, x, z, radius, limit = Infinity, predicate = null) {
  const list = ensureDebris(state);
  let got = 0;
  let room = Number.isFinite(limit) ? Math.max(0, limit) : Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (Math.hypot(d.x - x, d.z - z) > radius) continue;
    if (predicate && !predicate(d)) continue;
    const take = Math.min(d.a, room);
    if (take <= 0) break;
    got += take;
    room -= take;
    if (take >= d.a - 0.0005) list[i] = null;
    else d.a = Math.round((d.a - take) * 1000) / 1000;
    if (room <= 0.0005) break;
  }
  if (got > 0) {
    let w = 0;
    for (let i = 0; i < list.length; i++) if (list[i]) list[w++] = list[i];
    list.length = w;
    syncGenericCleanupMilestone(state);
  }
  return Math.round(got * 1000) / 1000;
}

/**
 * Suction. Debris inside the field is DRAWN toward the intake; it is only consumed once it
 * actually reaches the mouth. A vacuum that deletes everything within a radius is the placeholder
 * this replaces.
 *
 * @param {number} radius the suction field, from the nozzle
 * @returns {number} the amount actually taken in this step
 */
export function suckAt(state, x, z, radius, dtSec) {
  const list = ensureDebris(state);
  let taken = 0;

  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    const dx = x - d.x;
    const dz = z - d.z;
    const dist = Math.hypot(dx, dz);
    if (dist > radius) continue;

    if (dist <= SUCK_MOUTH_YD) {
      taken += d.a;
      list[i] = null;
      continue;
    }
    // pull harder the closer it gets, so it accelerates into the head rather than creeping
    const pull = SUCK_PULL_YD * dtSec * (1 - (dist / radius) * 0.55);
    const move = Math.min(pull, dist - SUCK_MOUTH_YD * 0.5);
    d.x = Math.round((d.x + (dx / dist) * move) * 1000) / 1000;
    d.z = Math.round((d.z + (dz / dist) * move) * 1000) / 1000;
  }

  if (taken > 0) {
    let w = 0;
    for (let i = 0; i < list.length; i++) if (list[i]) list[w++] = list[i];
    list.length = w;
    syncGenericCleanupMilestone(state);
  }
  return Math.round(taken * 1000) / 1000;
}

/** Nearest pile to a point, for prompts and for aiming help. */
export function nearestPile(state, x, z, within = 1.5) {
  let best = null;
  let bestD = within;
  for (const d of debrisState(state)) {
    const dist = Math.hypot(d.x - x, d.z - z);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best ? { cluster: best, dist: bestD } : null;
}
