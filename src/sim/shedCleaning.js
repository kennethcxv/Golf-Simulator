// SHED CLEANING — the 11 discrete shed targets: tool schedules, the
// monotonic set-progress reducer, the window film/target mirror, the
// checklist view, and the full-completion predicate. THREE-free; this is
// the sim half a later renderer task drives (it will import
// SHED_TARGET_SCHEDULES for the tool-contact idiom, mirroring
// pineHillsInterior.js's applyCleaningTool).
//
// Event envelope matches restorationAction's shape exactly — { type: 'audio'
// | 'toast' | 'restoration-progress', ... } — so clubhouse.js's existing
// presentRestorationFeedback(result) can consume it unmodified (it reads
// event.type, event.cue, event.text, event.tone). No reputation writes here.

import { RENO } from './shop.js';
import { insideShedRoom } from '../data/shedLayout.js';
import { ensureShedScene } from './shedScene.js';
import { restorationAction } from './clubhouseRestoration.js';
import { cleaningStatus } from './cleaningToolState.js';
import { totalDebris } from './cleaningDebris.js';

const round3 = (value) => Math.round(value * 1000) / 1000;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

export const SHED_TARGET_IDS = Object.freeze([
  'web:corner-nw', 'web:corner-ne', 'bench:grease', 'wall:scuff-door', 'floor:oil-patch',
  'shelf:dust', 'entry:leaf-drift', 'trash:cans', 'trash:pizza-box', 'window:south', 'window:east',
]);

const SHED_TARGET_LABELS = Object.freeze({
  'web:corner-nw': 'Northwest cobweb vacuumed',
  'web:corner-ne': 'Northeast cobweb vacuumed',
  'bench:grease': 'Workbench grease scrubbed',
  'wall:scuff-door': 'Wall scuff by the door cleaned',
  'floor:oil-patch': 'Floor oil patch scrubbed',
  'shelf:dust': 'Shelf dust wiped',
  'entry:leaf-drift': 'Leaf drift swept and bagged',
  'trash:cans': 'Trash cans emptied',
  'trash:pizza-box': 'Pizza box thrown out',
  'window:south': 'South window cleaned',
  'window:east': 'East window cleaned',
});

// Baseline progress per second of steady tool contact. Phases scale it with
// `rate` (default 1x); `snap` phases (spray-style) jump straight to a floor
// instead of accruing over time. `min` is the progress the PRIOR phase must
// reach before this phase's tool does anything; `gateReason` is returned
// when a later-phase tool is used too early. `bagGated` phases additionally
// require the caller's ctx.bagSpace > 0 and !ctx.bagTied (same shape as
// pineHillsInterior.js's applyCleaningTool options).
export const SHED_TARGET_SCHEDULES = Object.freeze({
  'web:corner-nw': Object.freeze({
    tools: ['vacuum'],
    phases: [Object.freeze({ tools: ['vacuum'], min: 0, max: 1 })],
  }),
  'web:corner-ne': Object.freeze({
    tools: ['vacuum'],
    phases: [Object.freeze({ tools: ['vacuum'], min: 0, max: 1 })],
  }),
  'bench:grease': Object.freeze({
    tools: ['spray', 'sponge'],
    phases: [
      Object.freeze({ tools: ['spray'], min: 0, max: 0.28, snap: 0.28 }),
      Object.freeze({ tools: ['sponge'], min: 0.28, max: 1, gateReason: 'spray-first' }),
    ],
  }),
  'wall:scuff-door': Object.freeze({
    tools: ['spray', 'cloth', 'sponge'],
    phases: [
      Object.freeze({ tools: ['spray'], min: 0, max: 0.28, snap: 0.28 }),
      Object.freeze({ tools: ['cloth', 'sponge'], min: 0.28, max: 1, gateReason: 'spray-first' }),
    ],
  }),
  'floor:oil-patch': Object.freeze({
    tools: ['sponge'],
    phases: [Object.freeze({ tools: ['sponge'], min: 0, max: 1, rate: 0.45 })],
  }),
  'shelf:dust': Object.freeze({
    tools: ['cloth'],
    phases: [Object.freeze({ tools: ['cloth'], min: 0, max: 1 })],
  }),
  'entry:leaf-drift': Object.freeze({
    tools: ['broom', 'trashbag'],
    phases: [
      Object.freeze({ tools: ['broom'], min: 0, max: 0.66 }),
      Object.freeze({
        tools: ['trashbag'], min: 0.66, max: 1, snap: 1, gateReason: 'sweep-first', bagGated: true,
      }),
    ],
  }),
  'trash:cans': Object.freeze({
    tools: ['trashbag'],
    phases: [Object.freeze({ tools: ['trashbag'], min: 0, max: 1, bagGated: true })],
  }),
  'trash:pizza-box': Object.freeze({ tools: [], directE: true, phases: [] }),
  'window:south': Object.freeze({
    tools: ['spray', 'cloth'],
    phases: [
      Object.freeze({ tools: ['spray'], min: 0, max: 0.3, snap: 0.3 }),
      Object.freeze({ tools: ['cloth'], min: 0.3, max: 1, gateReason: 'spray-first' }),
    ],
  }),
  'window:east': Object.freeze({
    tools: ['spray', 'cloth'],
    phases: [
      Object.freeze({ tools: ['spray'], min: 0, max: 0.3, snap: 0.3 }),
      Object.freeze({ tools: ['cloth'], min: 0.3, max: 1, gateReason: 'spray-first' }),
    ],
  }),
});

const BASELINE_RATE = 0.5; // progress per second of steady tool contact

function invalidShed(reason) {
  return { ok: false, changed: false, completed: false, reason, events: [] };
}

/** Reducer mirroring restorationAction's set-target-progress semantics, scoped to the shed. */
export function shedTargetAction(state, action) {
  if (!action || typeof action !== 'object') return invalidShed('Shed action must be an object.');
  const { targetId, progress } = action;
  if (!SHED_TARGET_IDS.includes(targetId)) return invalidShed('Unknown shed cleaning target.');
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    return invalidShed('Target progress must be a finite number from 0 through 1.');
  }
  const scene = ensureShedScene(state);
  if (!scene) return invalidShed('Shed cleaning state is unavailable.');
  const current = scene.targets[targetId] || 0;
  const rounded = round3(progress);
  if (rounded <= current) {
    return { ok: true, changed: false, completed: current >= 1, targetId, progress: current, events: [] };
  }
  scene.targets[targetId] = rounded;
  const events = [{ type: 'restoration-progress', targetId, progress: rounded }];
  const completedNow = current < 1 && rounded >= 1;
  if (completedNow) {
    events.push(
      { type: 'audio', cue: 'shed-target-complete', targetId },
      { type: 'toast', tone: 'positive', text: `${SHED_TARGET_LABELS[targetId]}`, targetId },
    );
  }
  return { ok: true, changed: true, completed: rounded >= 1, targetId, progress: rounded, events };
}

/** The pure-schedule evaluator a renderer calls per frame of tool contact. */
export function applyShedToolProgress(state, targetId, toolId, dt, ctx = {}) {
  if (!SHED_TARGET_IDS.includes(targetId)) return { did: 0, blocked: true, reason: 'unknown-target' };
  const schedule = SHED_TARGET_SCHEDULES[targetId];
  const scene = ensureShedScene(state);
  if (!scene) return { did: 0, blocked: true, reason: 'unavailable' };
  const current = scene.targets[targetId] || 0;
  if (current >= 1) return { did: 0, blocked: false };
  if (!schedule.phases.length) return { did: 0, blocked: true, reason: 'direct-only' };
  const phase = schedule.phases.find((entry) => entry.tools.includes(toolId));
  if (!phase) return { did: 0, blocked: true, reason: 'wrong-tool' };
  if (phase.bagGated) {
    if (ctx.bagTied) return { did: 0, blocked: true, reason: 'bag-tied' };
    if (!(Number(ctx.bagSpace) > 0)) return { did: 0, blocked: true, reason: 'bag-full' };
  }
  if (current < phase.min) return { did: 0, blocked: true, reason: phase.gateReason || 'not-ready' };
  let next;
  if (phase.snap != null) {
    next = Math.max(current, phase.snap);
  } else {
    const dtSec = Math.max(0, Number(dt) || 0);
    const rate = BASELINE_RATE * (phase.rate ?? 1);
    next = Math.min(phase.max, current + rate * dtSec);
  }
  if (next <= current) return { did: 0, blocked: false };
  const result = shedTargetAction(state, { targetId, progress: next });
  if (!result.ok) return { did: 0, blocked: true, reason: result.reason };
  return { did: round3(next - current), blocked: false };
}

/** Drains one physical window pane toward 0, mirroring 1-film into its shed target. */
export function cleanShedWindow(state, index, amount) {
  const reno = state?.shop?.reno;
  if (!reno || !Array.isArray(reno.windows) || (index !== 0 && index !== 1)) {
    return { ok: false, reason: 'invalid-window' };
  }
  const current = Number(reno.windows[index]) || 0;
  const drop = Math.max(0, Number(amount) || 0);
  const left = Math.max(0, round3(current - drop));
  reno.windows[index] = left;
  const targetId = index === 0 ? 'window:south' : 'window:east';
  const target = shedTargetAction(state, { targetId, progress: round3(clamp01(1 - left)) });
  // Re-entrancy safe: restorationAction itself guards on the milestone's own
  // recorded state (reno.cleanupMilestones.windows), not a local flag here.
  let milestone = null;
  if (reno.windows[0] <= 0.01 && reno.windows[1] <= 0.01) {
    milestone = restorationAction(state, { type: 'complete-cleanup-milestone', milestoneId: 'windows' });
  }
  return { ok: true, left, target, milestone };
}

// Cell-center mapping kept identical to cleanGrimeAt (shop.js) and to
// shedScene.js's own masking pass — only cells inside the shed footprint count.
function shedFloorCells(state) {
  const grime = state?.shop?.reno?.grime;
  if (!Array.isArray(grime) || grime.length !== RENO.grid.w * RENO.grid.h) return [];
  const cellW = RENO.room.w / RENO.grid.w;
  const cellD = RENO.room.d / RENO.grid.h;
  const cells = [];
  for (let cy = 0; cy < RENO.grid.h; cy++) {
    for (let cx = 0; cx < RENO.grid.w; cx++) {
      const x = -RENO.room.w / 2 + (cx + 0.5) * cellW;
      const z = -RENO.room.d / 2 + (cy + 0.5) * cellD;
      if (insideShedRoom(x, z)) cells.push(grime[cy * RENO.grid.w + cx]);
    }
  }
  return cells;
}

const TRASH_IDS = Object.freeze(['trash:cans', 'trash:pizza-box']);
const SCRUB_IDS = Object.freeze([
  'web:corner-nw', 'web:corner-ne', 'bench:grease', 'wall:scuff-door', 'floor:oil-patch', 'shelf:dust',
]);
const WINDOW_TARGET_IDS = Object.freeze(['window:south', 'window:east']);

function computeShedComplete(state, scene) {
  for (const id of SHED_TARGET_IDS) {
    if ((scene.targets[id] || 0) < 1) return false;
  }
  const grime = state?.shop?.reno?.grime;
  if (!Array.isArray(grime) || grime.length !== RENO.grid.w * RENO.grid.h) return false;
  const cells = shedFloorCells(state);
  if (!cells.length || !cells.every((value) => value <= 0.01)) return false;
  const windows = state?.shop?.reno?.windows;
  if (!Array.isArray(windows) || !(windows[0] <= 0.01 && windows[1] <= 0.01)) return false;
  const status = cleaningStatus(state);
  if (!status) return false;
  const debris = totalDebris(state);
  if (debris + status.pan.load + status.bag.load > 0.02) return false;
  if (status.bag.disposed < 1) return false;
  return true;
}

/** True iff every gate (targets, floor, windows, debris/pan/bag, disposal) clears. */
export function shedCleanupComplete(state) {
  const scene = ensureShedScene(state);
  if (!scene) return false;
  const complete = computeShedComplete(state, scene);
  if (complete && !Number.isFinite(scene.completedAt)) scene.completedAt = Date.now();
  return complete;
}

/** Ordered checklist for the shed HUD: label, done flag, and a display count/detail. */
export function shedView(state) {
  const scene = ensureShedScene(state);
  if (!scene) return { items: [], complete: false, completedAt: null };
  const doneCount = (ids) => ids.filter((id) => (scene.targets[id] || 0) >= 1).length;
  const trashDone = doneCount(TRASH_IDS);
  const scrubDone = doneCount(SCRUB_IDS);
  const windowsDone = doneCount(WINDOW_TARGET_IDS);

  const cells = shedFloorCells(state);
  const floorMean = cells.length ? cells.reduce((sum, value) => sum + value, 0) / cells.length : 0;
  const floorPct = Math.round(clamp01(1 - floorMean) * 100);
  const floorDone = cells.length > 0 && cells.every((value) => value <= 0.01);

  const status = cleaningStatus(state);
  const debris = totalDebris(state);
  const bagDisposed = status ? status.bag.disposed : 0;
  const sweepDone = debris <= 0.02 && bagDisposed >= 1;

  const items = [
    { id: 'pick-up-trash', label: 'Pick up the trash', done: trashDone === TRASH_IDS.length, count: trashDone },
    {
      id: 'sweep-collect-dispose',
      label: 'Sweep, collect, and dispose of debris',
      done: sweepDone,
      detail: { debris: round3(debris), bagDisposed },
    },
    { id: 'vacuum-mop-floor', label: 'Vacuum and mop the floor', done: floorDone, count: floorPct },
    {
      id: 'scrub-marks',
      label: 'Scrub the wall and bench marks',
      done: scrubDone === SCRUB_IDS.length,
      count: scrubDone,
    },
    { id: 'windows', label: 'Clean the windows', done: windowsDone === WINDOW_TARGET_IDS.length, count: windowsDone },
  ];
  return { items, complete: shedCleanupComplete(state), completedAt: scene.completedAt };
}
