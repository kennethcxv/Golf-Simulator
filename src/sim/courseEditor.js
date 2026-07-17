// GOLF EMPIRE — the course editor's simulation core.
//
// Design: edits apply to the LIVE course immediately (the screen answers the
// brush), every action lands on an undo stack with its inverse, and the money
// side accumulates as a PENDING BILL that is charged exactly once on Apply.
// Undo before Apply refunds the pending line; Discard restores the session's
// opening snapshot. After Apply the stacks clear — committed construction is a
// business decision (renovation downtime and all), same as the old works flow.
//
// Pure data + pure functions. The renderer and DOM never appear here.

import { ZONE, HOLE_STATUS, HOLE_CORRIDOR_CELLS } from './constants.js';
import { BALANCE } from './balance.js';
import { clamp, distToSegment } from '../core/utils.js';
import {
  inBounds, getZone, addHole, validateHole, labelSections,
  holeNumber, holeDistanceYd, holePar, ensureHoleShape, ensureCourseShape,
} from './course.js';
import { paintPathCells, splinePoints } from './courseShaping.js';
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
  [ZONE.FRINGE]: 'fringe',
  [ZONE.HEAVY]: 'heavy',
  [ZONE.DIRT]: 'dirt',
  [ZONE.BED]: 'bed',
  [ZONE.SEMI]: 'semi',
};

export function zoneCost(zone) {
  return BALANCE.zoneCost[ZONE_COST_KEY[zone]] ?? 0;
}

// --- session ---------------------------------------------------------------------

export function makeEditSession(state) {
  ensureCourseShape(state.course);
  return {
    undo: [], // committed ops (with inverses)
    redo: [],
    bill: 0, // dollars pending — charged once on applySession
    changedCells: new Set(), // every cell index touched since the last apply
    opSeq: 1,
  };
}

export function sessionDirty(session) {
  return session.undo.length > 0 || session.redo.length > 0 || session.changedCells.size > 0;
}

// --- op plumbing -------------------------------------------------------------------

function pushOp(state, session, op) {
  session.undo.push(op);
  session.redo.length = 0;
  session.bill = Math.max(0, session.bill + op.cost);
  if (op.cells) for (const c of op.cells) session.changedCells.add(c.i);
}

function applyCellsForward(state, cells) {
  const { course } = state;
  const changedZones = [];
  for (const c of cells) {
    if (c.zoneAfter !== undefined && course.zones[c.i] !== c.zoneAfter) {
      course.zones[c.i] = c.zoneAfter;
      changedZones.push(c.i);
    }
    if (c.elevAfter !== undefined) course.elevation[c.i] = c.elevAfter;
  }
  if (changedZones.length) turfOnZonesChanged(state, changedZones);
  return changedZones.length;
}

function applyCellsBackward(state, cells) {
  const { course } = state;
  const changedZones = [];
  for (const c of cells) {
    if (c.zoneBefore !== undefined && course.zones[c.i] !== c.zoneBefore) {
      course.zones[c.i] = c.zoneBefore;
      changedZones.push(c.i);
    }
    if (c.elevBefore !== undefined) course.elevation[c.i] = c.elevBefore;
  }
  if (changedZones.length) turfOnZonesChanged(state, changedZones);
}

function findObject(course, id) {
  return course.objects.find((o) => o.id === id) || null;
}

function findPath(course, id) {
  return course.paths.find((p) => p.id === id) || null;
}

// Re-derive PATH cells from the stored paths: torn-up pavement returns to
// rough, then every remaining path repaints itself.
function repaintPathZones(course) {
  for (let i = 0; i < course.zones.length; i++) {
    if (course.zones[i] === ZONE.PATH) course.zones[i] = ZONE.ROUGH;
  }
  for (const p of course.paths) paintPathCells(course, p);
}

// Run a mutation of course.paths as ONE undoable op with an exact cell diff.
function pathOp(state, session, label, mutate, { chargeNewPavement = false } = {}) {
  const { course } = state;
  const zonesBefore = Uint8Array.from(course.zones);
  const pathsBefore = JSON.parse(JSON.stringify(course.paths));
  mutate();
  repaintPathZones(course);
  const cells = [];
  const changed = [];
  let newlyPaved = 0;
  for (let i = 0; i < course.zones.length; i++) {
    if (course.zones[i] !== zonesBefore[i]) {
      cells.push({ i, zoneBefore: zonesBefore[i], zoneAfter: course.zones[i] });
      changed.push(i);
      if (course.zones[i] === ZONE.PATH) newlyPaved++;
    }
  }
  if (changed.length) turfOnZonesChanged(state, changed);
  const cost = chargeNewPavement ? Math.round(newlyPaved * zoneCost(ZONE.PATH)) : 0;
  pushOp(state, session, {
    kind: 'path', label, cost, cells,
    pathsBefore, pathsAfter: JSON.parse(JSON.stringify(course.paths)),
  });
  return { ok: true, cost, cells: cells.length };
}

// --- brushes ------------------------------------------------------------------------

// Collect the cells of a round brush with falloff weights (1 at center → 0 at edge).
export function brushCells(course, cx, cy, radius, falloff = 0.5) {
  const out = [];
  const r = Math.max(0.4, radius);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (!inBounds(course, x, y)) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const t = d / r;
      const w = t < 1 - falloff ? 1 : 1 - (t - (1 - falloff)) / Math.max(0.001, falloff);
      out.push({ x, y, i: y * course.w + x, w: clamp(w, 0, 1) });
    }
  }
  return out;
}

// --- terrain sculpting ----------------------------------------------------------------
// The UI accumulates a stroke: begin → move (live writes) → end (one undo op).

export function beginTerrainStroke(state, session) {
  return { kind: 'terrain', before: new Map(), after: new Map() };
}

export function sculptAt(state, stroke, cx, cy, { mode = 'raise', radius = 2, strength = 0.5, falloff = 0.5, target = null } = {}) {
  const { course } = state;
  const cells = brushCells(course, cx, cy, radius, falloff);
  if (mode === 'smooth') {
    const planned = [];
    for (const c of cells) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = c.x + dx;
          const ny = c.y + dy;
          if (!inBounds(course, nx, ny)) continue;
          sum += course.elevation[ny * course.w + nx];
          n++;
        }
      }
      planned.push({ c, target: sum / n });
    }
    for (const { c, target: t } of planned) {
      if (!stroke.before.has(c.i)) stroke.before.set(c.i, course.elevation[c.i]);
      course.elevation[c.i] += (t - course.elevation[c.i]) * strength * c.w;
      stroke.after.set(c.i, course.elevation[c.i]);
    }
    return cells;
  }
  for (const c of cells) {
    if (!stroke.before.has(c.i)) stroke.before.set(c.i, course.elevation[c.i]);
    if (mode === 'raise') course.elevation[c.i] += strength * c.w;
    else if (mode === 'lower') course.elevation[c.i] -= strength * c.w;
    else if (mode === 'flatten') {
      const t = target === null ? stroke.flattenTarget ?? (stroke.flattenTarget = course.elevation[c.i]) : target;
      course.elevation[c.i] += (t - course.elevation[c.i]) * clamp(strength * 1.6, 0, 1) * c.w;
    }
    stroke.after.set(c.i, course.elevation[c.i]);
  }
  return cells;
}

export function endTerrainStroke(state, session, stroke, label = 'Terrain') {
  if (!stroke.before.size) return { ok: false, cost: 0 };
  const cells = [];
  let feet = 0;
  for (const [i, before] of stroke.before) {
    const after = stroke.after.get(i);
    if (Math.abs(after - before) < 1e-4) continue;
    feet += Math.abs(after - before);
    cells.push({ i, elevBefore: before, elevAfter: after });
  }
  if (!cells.length) return { ok: false, cost: 0 };
  const cost = Math.round(feet * BALANCE.elevationCostPerFoot);
  pushOp(state, session, { kind: 'terrain', label, cells, cost });
  return { ok: true, cost, cells: cells.length };
}

// --- surface painting -------------------------------------------------------------------

export function beginPaintStroke() {
  return { kind: 'paint', before: new Map(), after: new Map() };
}

const UNPAINTABLE = new Set([ZONE.WATER]); // water is the water tool's business

export function paintAt(state, stroke, cx, cy, zone, { radius = 1.5, over = null } = {}) {
  const { course } = state;
  const cells = brushCells(course, cx, cy, radius, 0.0);
  for (const c of cells) {
    const cur = course.zones[c.i];
    if (cur === zone) continue;
    if (over && !over.has(cur)) continue;
    if (!over && UNPAINTABLE.has(cur) && zone !== ZONE.OUT) continue;
    if (!stroke.before.has(c.i)) stroke.before.set(c.i, cur);
    course.zones[c.i] = zone;
    stroke.after.set(c.i, zone);
  }
  return cells;
}

export function endPaintStroke(state, session, stroke, label = 'Paint') {
  if (!stroke.before.size) return { ok: false, cost: 0 };
  const cells = [];
  let cost = 0;
  const changed = [];
  for (const [i, before] of stroke.before) {
    const after = stroke.after.get(i);
    if (after === before) continue;
    cost += zoneCost(after);
    cells.push({ i, zoneBefore: before, zoneAfter: after });
    changed.push(i);
  }
  if (!cells.length) return { ok: false, cost: 0 };
  turfOnZonesChanged(state, changed); // fresh sod grows in
  cost = Math.round(cost);
  pushOp(state, session, { kind: 'paint', label, cells, cost });
  return { ok: true, cost, cells: cells.length };
}

// --- shaped feature stamps (green / bunker / water / tee) -----------------------------------
// One call = one undo op. The caller previews; this commits.

function stampCells(state, session, edits, label, extraCost = 0) {
  const { course } = state;
  const cells = [];
  let cost = extraCost;
  const changed = [];
  for (const e of edits) {
    const before = course.zones[e.i];
    const elevBefore = course.elevation[e.i];
    const entry = { i: e.i };
    let used = false;
    if (e.zone !== undefined && e.zone !== before) {
      entry.zoneBefore = before;
      entry.zoneAfter = e.zone;
      course.zones[e.i] = e.zone;
      cost += zoneCost(e.zone);
      changed.push(e.i);
      used = true;
    }
    if (e.dElev !== undefined && Math.abs(e.dElev) > 1e-4) {
      entry.elevBefore = elevBefore;
      entry.elevAfter = elevBefore + e.dElev;
      course.elevation[e.i] = entry.elevAfter;
      cost += Math.abs(e.dElev) * BALANCE.elevationCostPerFoot;
      used = true;
    }
    if (used) cells.push(entry);
  }
  if (!cells.length) return { ok: false, cost: 0 };
  if (changed.length) turfOnZonesChanged(state, changed);
  cost = Math.round(cost);
  pushOp(state, session, { kind: 'stamp', label, cells, cost });
  return { ok: true, cost, cells: cells.length };
}

// Green: rotated ellipse (+ optional kidney), fringe collar, gentle plateau,
// and elevation smoothing so the surface putts true.
export function stampGreen(state, session, cx, cy, {
  r = 1.8, elong = 1.25, angle = 0, kidney = false, raise = 1.4,
} = {}) {
  const { course } = state;
  const edits = [];
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const rx = r * elong;
  const ry = r;
  const reach = Math.ceil(rx) + 2;
  const greenIdx = new Set();
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      if (!inBounds(course, x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const lx = dx * ca + dy * sa;
      const ly = -dx * sa + dy * ca;
      let inside = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
      if (inside && kidney) {
        const bdx = lx - rx * 0.85;
        const bdy = ly - ry * 0.7;
        if (bdx * bdx + bdy * bdy < r * 0.7 * r * 0.7) inside = false;
      }
      const i = y * course.w + x;
      if (inside && course.zones[i] !== ZONE.WATER) {
        greenIdx.add(i);
        edits.push({ i, zone: ZONE.GREEN });
      }
    }
  }
  // collar + smooth plateau
  for (let y = Math.floor(cy - reach - 1); y <= Math.ceil(cy + reach + 1); y++) {
    for (let x = Math.floor(cx - reach - 1); x <= Math.ceil(cx + reach + 1); x++) {
      if (!inBounds(course, x, y)) continue;
      const i = y * course.w + x;
      if (greenIdx.has(i)) continue;
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx2, dy2]) => {
        const nx = x + dx2;
        const ny = y + dy2;
        return inBounds(course, nx, ny) && greenIdx.has(ny * course.w + nx);
      });
      if (touches && course.zones[i] !== ZONE.WATER && course.zones[i] !== ZONE.PATH) {
        edits.push({ i, zone: ZONE.FRINGE });
      }
    }
  }
  if (raise > 0) {
    // plateau: raise toward the average + raise, strongest at center
    let sum = 0;
    let n = 0;
    for (const i of greenIdx) {
      sum += course.elevation[i];
      n++;
    }
    const base = n ? sum / n : 0;
    for (const i of greenIdx) {
      const want = base + raise * 0.5;
      edits.find((e) => e.i === i).dElev = (want - course.elevation[i]) * 0.8;
    }
  }
  return stampCells(state, session, edits, 'Green');
}

// Bunker: lobed blob, depressed floor, blended lip.
export function stampBunker(state, session, cx, cy, {
  r = 1.4, depth = 1.6, lobes = 2, angle = 0,
} = {}) {
  const { course } = state;
  const centers = [{ x: cx, y: cy, r }];
  for (let i = 1; i < lobes; i++) {
    const a = angle + i * 2.4;
    centers.push({ x: cx + Math.cos(a) * r * 0.75, y: cy + Math.sin(a) * r * 0.75, r: r * 0.7 });
  }
  const sandable = new Set([ZONE.ROUGH, ZONE.FAIRWAY, ZONE.SEMI, ZONE.HEAVY, ZONE.OUT, ZONE.FRINGE, ZONE.DIRT, ZONE.BED]);
  const edits = new Map();
  for (const c of centers) {
    const reach = Math.ceil(c.r) + 1;
    for (let y = Math.floor(c.y - reach); y <= Math.ceil(c.y + reach); y++) {
      for (let x = Math.floor(c.x - reach); x <= Math.ceil(c.x + reach); x++) {
        if (!inBounds(course, x, y)) continue;
        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
        if (d > c.r) continue;
        const i = y * course.w + x;
        if (!sandable.has(course.zones[i])) continue;
        const cur = edits.get(i) || { i };
        cur.zone = ZONE.BUNKER;
        cur.dElev = Math.min(cur.dElev ?? 0, -depth * clamp(1 - d / c.r + 0.25, 0.25, 1));
        edits.set(i, cur);
      }
    }
  }
  return stampCells(state, session, [...edits.values()], 'Bunker');
}

// Water: pond/lake blob with a depressed bed; the renderer floods the bowl.
export function stampWater(state, session, cx, cy, {
  r = 2.4, depth = 2.4, elong = 1.2, angle = 0,
} = {}) {
  const { course } = state;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const rx = r * elong;
  const ry = r;
  const floodable = new Set([ZONE.ROUGH, ZONE.FAIRWAY, ZONE.SEMI, ZONE.HEAVY, ZONE.OUT, ZONE.DIRT, ZONE.BED, ZONE.FRINGE]);
  const edits = [];
  const reach = Math.ceil(rx) + 1;
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      if (!inBounds(course, x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const lx = dx * ca + dy * sa;
      const ly = -dx * sa + dy * ca;
      const q = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry);
      if (q > 1) continue;
      const i = y * course.w + x;
      if (!floodable.has(course.zones[i])) continue;
      edits.push({ i, zone: ZONE.WATER, dElev: -depth * (1 - q * 0.55) });
    }
  }
  return stampCells(state, session, edits, 'Water');
}

// Stream: a narrow water spline.
export function stampStream(state, session, pts, { width = 1.0, depth = 1.4 } = {}) {
  const { course } = state;
  const line = splinePoints(pts, 0.5);
  const floodable = new Set([ZONE.ROUGH, ZONE.FAIRWAY, ZONE.SEMI, ZONE.HEAVY, ZONE.OUT, ZONE.DIRT, ZONE.BED, ZONE.FRINGE]);
  const edits = new Map();
  for (const p of line) {
    const r = width;
    for (let y = Math.floor(p.y - r); y <= Math.ceil(p.y + r); y++) {
      for (let x = Math.floor(p.x - r); x <= Math.ceil(p.x + r); x++) {
        if (!inBounds(course, x, y)) continue;
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
        if (d > r) continue;
        const i = y * course.w + x;
        if (!floodable.has(course.zones[i])) continue;
        const cur = edits.get(i) || { i };
        cur.zone = ZONE.WATER;
        cur.dElev = Math.min(cur.dElev ?? 0, -depth * clamp(1 - d / r + 0.3, 0.3, 1));
        edits.set(i, cur);
      }
    }
  }
  return stampCells(state, session, [...edits.values()], 'Stream');
}

// Tee box stamp: pad + flatten + becomes the hole's tee of the given color.
export function stampTee(state, session, holeId, teeKey, cx, cy, aimX, aimY, { w = 1.2, len = 1.8 } = {}) {
  const { course } = state;
  const hole = course.holes.find((h) => h.id === holeId);
  if (!hole) return { ok: false, reason: 'No such hole.' };
  ensureHoleShape(hole, holeNumber(course, holeId));
  const a = Math.atan2(aimY - cy, aimX - cx);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const edits = [];
  const reach = Math.ceil(Math.max(w, len)) + 1;
  const padIdx = [];
  let sum = 0;
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      if (!inBounds(course, x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const lx = dx * ca + dy * sa;
      const ly = -dx * sa + dy * ca;
      if (Math.abs(lx) <= len && Math.abs(ly) <= w) {
        const i = y * course.w + x;
        if (course.zones[i] === ZONE.WATER) continue;
        padIdx.push(i);
        sum += course.elevation[i];
        edits.push({ i, zone: ZONE.TEE });
      }
    }
  }
  if (!padIdx.length) return { ok: false, reason: 'Nowhere to build here.' };
  const avg = sum / padIdx.length;
  for (const e of edits) e.dElev = avg - course.elevation[e.i]; // a tee sits level
  const res = stampCells(state, session, edits, 'Tee box');
  if (!res.ok) {
    // the pad may already be exactly this tee — still allow marker placement
  }
  const marker = { x: Math.round(cx), y: Math.round(cy) };
  const prevTees = JSON.parse(JSON.stringify(hole.tees));
  const prevTee = hole.tee ? { ...hole.tee } : null;
  const prevActive = hole.activeTee;
  hole.tees[teeKey] = marker;
  hole.activeTee = teeKey;
  hole.tee = { ...marker };
  pushOp(state, session, {
    kind: 'hole', label: 'Tee marker', cost: BALANCE.holeMoveCost, cells: null,
    holeId,
    before: { tees: prevTees, tee: prevTee, activeTee: prevActive },
    after: { tees: JSON.parse(JSON.stringify(hole.tees)), tee: { ...marker }, activeTee: teeKey },
  });
  return { ok: true, cost: (res.cost || 0) + BALANCE.holeMoveCost };
}

// Pin placement: A/B/C positions on the green.
export function setPinPosition(state, session, holeId, pinKey, x, y) {
  const { course } = state;
  const hole = course.holes.find((h) => h.id === holeId);
  if (!hole) return { ok: false, reason: 'No such hole.' };
  ensureHoleShape(hole, holeNumber(course, holeId));
  if (getZone(course, x, y) !== ZONE.GREEN) return { ok: false, reason: 'Pins must sit on a green.' };
  const before = {
    pins: JSON.parse(JSON.stringify(hole.pins)),
    pin: hole.pin ? { ...hole.pin } : null,
    activePin: hole.activePin,
  };
  hole.pins[pinKey] = { x, y };
  hole.activePin = pinKey;
  hole.pin = { x, y };
  pushOp(state, session, {
    kind: 'hole', label: `Pin ${pinKey}`, cost: BALANCE.holeMoveCost, cells: null,
    holeId,
    before,
    after: { pins: JSON.parse(JSON.stringify(hole.pins)), pin: { x, y }, activePin: pinKey },
  });
  return { ok: true, cost: BALANCE.holeMoveCost };
}

export function selectPin(state, session, holeId, pinKey) {
  const hole = state.course.holes.find((h) => h.id === holeId);
  if (!hole) return { ok: false, reason: 'No such hole.' };
  ensureHoleShape(hole, holeNumber(state.course, holeId));
  const pos = hole.pins[pinKey];
  if (!pos) return { ok: false, reason: `No pin ${pinKey} set yet — place it on the green.` };
  hole.activePin = pinKey;
  hole.pin = { ...pos };
  return { ok: true };
}

export function selectTee(state, session, holeId, teeKey) {
  const hole = state.course.holes.find((h) => h.id === holeId);
  if (!hole) return { ok: false, reason: 'No such hole.' };
  ensureHoleShape(hole, holeNumber(state.course, holeId));
  const pos = hole.tees[teeKey];
  if (!pos) return { ok: false, reason: `No ${teeKey} tee built yet.` };
  hole.activeTee = teeKey;
  hole.tee = { ...pos };
  return { ok: true };
}

// --- objects --------------------------------------------------------------------------

export const OBJECT_CATALOG = [
  // trees (Kenney set already in vendor/models/trees)
  { type: 'tree_default', cat: 'tree', name: 'Shade tree', cost: 'tree' },
  { type: 'tree_oak', cat: 'tree', name: 'Oak', cost: 'tree' },
  { type: 'tree_detailed', cat: 'tree', name: 'Elm', cost: 'tree' },
  { type: 'tree_fat', cat: 'tree', name: 'Maple', cost: 'tree' },
  { type: 'tree_pineDefaultA', cat: 'tree', name: 'Pine', cost: 'tree' },
  { type: 'tree_pineRoundB', cat: 'tree', name: 'Spruce', cost: 'tree' },
  // shrubs & ground cover (procedural or GLB, renderer decides)
  { type: 'bush_round', cat: 'shrub', name: 'Boxwood', cost: 'shrub' },
  { type: 'bush_flower', cat: 'shrub', name: 'Flowering shrub', cost: 'shrub' },
  { type: 'hedge', cat: 'shrub', name: 'Hedge section', cost: 'shrub' },
  { type: 'grass_clump', cat: 'shrub', name: 'Native grasses', cost: 'shrub' },
  { type: 'reeds', cat: 'shrub', name: 'Reeds', cost: 'shrub' },
  { type: 'flowers', cat: 'decor', name: 'Flower patch', cost: 'decor' },
  // rocks
  { type: 'rock_s', cat: 'rock', name: 'Stone', cost: 'rock' },
  { type: 'rock_m', cat: 'rock', name: 'Boulder', cost: 'rock' },
  { type: 'rock_l', cat: 'rock', name: 'Large boulder', cost: 'rock' },
  { type: 'rock_cluster', cat: 'rock', name: 'Rock cluster', cost: 'rock' },
  // golf props
  { type: 'bench', cat: 'prop', name: 'Bench', cost: 'prop' },
  { type: 'trash_bin', cat: 'prop', name: 'Trash bin', cost: 'prop' },
  { type: 'ball_washer', cat: 'prop', name: 'Ball washer', cost: 'prop' },
  { type: 'distance_marker', cat: 'prop', name: '150 marker', cost: 'prop' },
  { type: 'tee_sign', cat: 'prop', name: 'Tee sign', cost: 'prop' },
  { type: 'planter', cat: 'decor', name: 'Planter', cost: 'decor' },
];

const CATALOG_BY_TYPE = new Map(OBJECT_CATALOG.map((o) => [o.type, o]));

export function objectCostOf(type) {
  const entry = CATALOG_BY_TYPE.get(type);
  return BALANCE.objectCost[entry ? entry.cost : 'decor'] ?? 50;
}

// Placement legality: no trees on greens/tees/bunkers/water/paths; props may
// stand on rough/fringe; nothing floats on water except reeds at the shore.
export function objectPlacementOk(course, type, x, y) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (!inBounds(course, cx, cy)) return { ok: false, reason: 'Outside the property.' };
  const z = getZone(course, cx, cy);
  const entry = CATALOG_BY_TYPE.get(type) || { cat: 'decor' };
  const NEVER = new Set([ZONE.GREEN, ZONE.TEE, ZONE.BUNKER, ZONE.PATH]);
  if (NEVER.has(z)) return { ok: false, reason: 'Not on a playing surface.' };
  if (z === ZONE.WATER && type !== 'reeds' && entry.cat !== 'rock') {
    return { ok: false, reason: 'That would drown.' };
  }
  for (const s of course.structures) {
    if (x >= s.x - 1 && x <= s.x + s.w + 1 && y >= s.y - 1 && y <= s.y + s.h + 3) {
      return { ok: false, reason: 'Too close to the clubhouse.' };
    }
  }
  return { ok: true };
}

export function addObject(state, session, type, x, y, { rot = 0, scale = 1 } = {}) {
  const { course } = state;
  const legal = objectPlacementOk(course, type, x, y);
  if (!legal.ok) return legal;
  const obj = { id: course.nextObjectId++, type, x, y, rot, scale };
  course.objects.push(obj);
  pushOp(state, session, {
    kind: 'object-add', label: 'Place object', cost: objectCostOf(type), cells: null, object: { ...obj },
  });
  return { ok: true, object: obj, cost: objectCostOf(type) };
}

export function removeObject(state, session, id) {
  const { course } = state;
  const obj = findObject(course, id);
  if (!obj) return { ok: false, reason: 'No such object.' };
  course.objects = course.objects.filter((o) => o.id !== id);
  pushOp(state, session, {
    kind: 'object-remove', label: 'Remove object', cost: BALANCE.objectRemoveCost, cells: null, object: { ...obj },
  });
  return { ok: true, cost: BALANCE.objectRemoveCost };
}

export function moveObject(state, session, id, patch) {
  const { course } = state;
  const obj = findObject(course, id);
  if (!obj) return { ok: false, reason: 'No such object.' };
  if (patch.x !== undefined || patch.y !== undefined) {
    const legal = objectPlacementOk(course, obj.type, patch.x ?? obj.x, patch.y ?? obj.y);
    if (!legal.ok) return legal;
  }
  const before = { ...obj };
  Object.assign(obj, patch);
  pushOp(state, session, {
    kind: 'object-move', label: 'Move object', cost: 0, cells: null, id, before, after: { ...obj },
  });
  return { ok: true, cost: 0 };
}

export function duplicateObject(state, session, id) {
  const { course } = state;
  const obj = findObject(course, id);
  if (!obj) return { ok: false, reason: 'No such object.' };
  return addObject(state, session, obj.type, obj.x + 1, obj.y + 1, { rot: obj.rot + 0.6, scale: obj.scale });
}

// Assisted landscaping: scatter a category over a disk, respecting legality.
// Returns the created objects so the UI can preview-then-commit or undo once.
export function scatterObjects(state, session, types, cx, cy, {
  radius = 4, count = 8, rng = Math.random, scaleMin = 0.85, scaleMax = 1.25,
} = {}) {
  const created = [];
  let cost = 0;
  const { course } = state;
  for (let k = 0; k < count * 3 && created.length < count; k++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const type = types[Math.floor(rng() * types.length)];
    if (!objectPlacementOk(course, type, x, y).ok) continue;
    const obj = { id: course.nextObjectId++, type, x, y, rot: rng() * Math.PI * 2, scale: scaleMin + rng() * (scaleMax - scaleMin) };
    course.objects.push(obj);
    created.push({ ...obj });
    cost += objectCostOf(type);
  }
  if (!created.length) return { ok: false, reason: 'No room here.' };
  pushOp(state, session, { kind: 'object-scatter', label: 'Landscaping', cost, cells: null, objects: created });
  return { ok: true, cost, count: created.length };
}

// --- paths -----------------------------------------------------------------------------

export function addPath(state, session, pts, { width = 2.6, material = 'asphalt' } = {}) {
  const { course } = state;
  if (!pts || pts.length < 2) return { ok: false, reason: 'A path needs at least two points.' };
  let path = null;
  const res = pathOp(state, session, 'Path', () => {
    path = { id: course.nextPathId++, pts: pts.map((p) => ({ x: p.x, y: p.y })), width, material };
    course.paths.push(path);
  }, { chargeNewPavement: true });
  return { ...res, path };
}

export function editPath(state, session, id, patch) {
  const { course } = state;
  const path = findPath(course, id);
  if (!path) return { ok: false, reason: 'No such path.' };
  return pathOp(state, session, 'Edit path', () => {
    Object.assign(path, patch, patch.pts ? { pts: patch.pts.map((p) => ({ x: p.x, y: p.y })) } : null);
  }, { chargeNewPavement: true });
}

export function removePath(state, session, id) {
  const { course } = state;
  if (!findPath(course, id)) return { ok: false, reason: 'No such path.' };
  return pathOp(state, session, 'Remove path', () => {
    course.paths = course.paths.filter((p) => p.id !== id);
  });
}

// --- holes ------------------------------------------------------------------------------

export function newHole(state, session) {
  const { course } = state;
  const hole = addHole(course);
  ensureHoleShape(hole, course.holes.length);
  pushOp(state, session, { kind: 'hole-add', label: 'New hole', cost: BALANCE.newHoleCost, cells: null, holeId: hole.id });
  return { ok: true, hole, cost: BALANCE.newHoleCost };
}

export function deleteHole(state, session, holeId) {
  const { course } = state;
  const at = course.holes.findIndex((h) => h.id === holeId);
  if (at === -1) return { ok: false, reason: 'No such hole.' };
  const hole = course.holes[at];
  course.holes.splice(at, 1);
  pushOp(state, session, { kind: 'hole-delete', label: 'Delete hole', cost: 0, cells: null, hole: JSON.parse(JSON.stringify(hole)), at });
  return { ok: true, cost: 0 };
}

export function setHoleSettings(state, session, holeId, patch) {
  const { course } = state;
  const hole = course.holes.find((h) => h.id === holeId);
  if (!hole) return { ok: false, reason: 'No such hole.' };
  ensureHoleShape(hole, holeNumber(course, holeId));
  const fields = ['name', 'handicap', 'parOverride'];
  const before = {};
  const after = {};
  for (const f of fields) {
    if (patch[f] !== undefined && patch[f] !== hole[f]) {
      before[f] = hole[f];
      after[f] = patch[f];
      hole[f] = patch[f];
    }
  }
  if (!Object.keys(after).length) return { ok: true, cost: 0, unchanged: true };
  pushOp(state, session, { kind: 'hole-settings', label: 'Hole settings', cost: 0, cells: null, holeId, before, after });
  return { ok: true, cost: 0 };
}

export function reorderHole(state, session, holeId, dir) {
  const { course } = state;
  const at = course.holes.findIndex((h) => h.id === holeId);
  const to = at + dir;
  if (at === -1 || to < 0 || to >= course.holes.length) return { ok: false, reason: 'Cannot move it that way.' };
  const [h] = course.holes.splice(at, 1);
  course.holes.splice(to, 0, h);
  pushOp(state, session, { kind: 'hole-reorder', label: 'Reorder holes', cost: 0, cells: null, holeId, from: at, to });
  return { ok: true, cost: 0 };
}

// --- undo / redo ---------------------------------------------------------------------------

function invertOp(state, session, op) {
  const { course } = state;
  switch (op.kind) {
    case 'terrain':
    case 'paint':
    case 'stamp':
      applyCellsBackward(state, op.cells);
      break;
    case 'hole': {
      const hole = course.holes.find((h) => h.id === op.holeId);
      if (hole) Object.assign(hole, JSON.parse(JSON.stringify(op.before)));
      break;
    }
    case 'object-add':
      course.objects = course.objects.filter((o) => o.id !== op.object.id);
      break;
    case 'object-remove':
      course.objects.push({ ...op.object });
      break;
    case 'object-move': {
      const obj = findObject(course, op.id);
      if (obj) Object.assign(obj, op.before);
      break;
    }
    case 'object-scatter':
      course.objects = course.objects.filter((o) => !op.objects.some((c) => c.id === o.id));
      break;
    case 'path':
      applyCellsBackward(state, op.cells);
      state.course.paths = JSON.parse(JSON.stringify(op.pathsBefore));
      break;
    case 'hole-add':
      course.holes = course.holes.filter((h) => h.id !== op.holeId);
      break;
    case 'hole-delete':
      course.holes.splice(op.at, 0, JSON.parse(JSON.stringify(op.hole)));
      break;
    case 'hole-settings': {
      const hole = course.holes.find((h) => h.id === op.holeId);
      if (hole) Object.assign(hole, op.before);
      break;
    }
    case 'hole-reorder': {
      const [h] = course.holes.splice(op.to, 1);
      course.holes.splice(op.from, 0, h);
      break;
    }
    default:
      break;
  }
}

function replayOp(state, session, op) {
  const { course } = state;
  switch (op.kind) {
    case 'terrain':
    case 'paint':
    case 'stamp':
      applyCellsForward(state, op.cells);
      break;
    case 'hole': {
      const hole = course.holes.find((h) => h.id === op.holeId);
      if (hole) Object.assign(hole, JSON.parse(JSON.stringify(op.after)));
      break;
    }
    case 'object-add':
      course.objects.push({ ...op.object });
      break;
    case 'object-remove':
      course.objects = course.objects.filter((o) => o.id !== op.object.id);
      break;
    case 'object-move': {
      const obj = findObject(course, op.id);
      if (obj) Object.assign(obj, op.after);
      break;
    }
    case 'object-scatter':
      for (const o of op.objects) course.objects.push({ ...o });
      break;
    case 'path':
      applyCellsForward(state, op.cells);
      state.course.paths = JSON.parse(JSON.stringify(op.pathsAfter));
      break;
    case 'hole-add': {
      const hole = addHole(course);
      // keep the id stable across undo/redo
      hole.id = op.holeId;
      course.nextHoleId = Math.max(course.nextHoleId, op.holeId + 1);
      ensureHoleShape(hole, course.holes.length);
      break;
    }
    case 'hole-delete':
      course.holes = course.holes.filter((h) => h.id !== op.hole.id);
      break;
    case 'hole-settings': {
      const hole = course.holes.find((h) => h.id === op.holeId);
      if (hole) Object.assign(hole, op.after);
      break;
    }
    case 'hole-reorder': {
      const [h] = course.holes.splice(op.from, 1);
      course.holes.splice(op.to, 0, h);
      break;
    }
    default:
      break;
  }
}

export function undo(state, session) {
  const op = session.undo.pop();
  if (!op) return { ok: false };
  invertOp(state, session, op);
  session.redo.push(op);
  session.bill = Math.max(0, session.bill - op.cost);
  return { ok: true, label: op.label };
}

export function redo(state, session) {
  const op = session.redo.pop();
  if (!op) return { ok: false };
  replayOp(state, session, op);
  session.undo.push(op);
  session.bill += op.cost;
  return { ok: true, label: op.label };
}

// --- apply / discard --------------------------------------------------------------------

// Which open holes the pending edits disturb (same corridor rule as the old works).
export function affectedHoles(state, session) {
  const { course } = state;
  const out = [];
  for (const hole of course.holes) {
    if (hole.status !== HOLE_STATUS.OPEN && hole.status !== HOLE_STATUS.RENOVATION) continue;
    if (!hole.tee || !hole.pin) continue;
    let near = 0;
    for (const i of session.changedCells) {
      const x = i % course.w;
      const y = (i / course.w) | 0;
      if (distToSegment(x, y, hole.tee.x, hole.tee.y, hole.pin.x, hole.pin.y) <= HOLE_CORRIDOR_CELLS) near++;
    }
    if (near > 0) {
      const r = BALANCE.renovation[state.mode];
      out.push({ holeId: hole.id, cells: near, days: clamp(Math.ceil(near / r.cellsPerDay), r.minDays, r.maxDays) });
    }
  }
  return out;
}

export function applySession(state, session) {
  if (!session.undo.length && !session.changedCells.size) {
    return { ok: false, reason: 'Nothing to build.' };
  }
  const bill = Math.round(session.bill);
  if (bill > state.cash) return { ok: false, reason: `Not enough cash (${bill.toLocaleString('en-US')} needed).` };
  const affected = affectedHoles(state, session);
  if (bill > 0) spend(state, 'works', bill);
  for (const a of affected) {
    const hole = state.course.holes.find((h) => h.id === a.holeId);
    hole.status = HOLE_STATUS.RENOVATION;
    hole.daysLeft = Math.max(hole.daysLeft || 0, a.days);
  }
  for (const hole of state.course.holes) {
    if (hole.status === HOLE_STATUS.UNBUILT && validateHole(state.course, hole).valid) {
      hole.status = HOLE_STATUS.CONSTRUCTION;
      hole.daysLeft = BALANCE.newHoleConstructionDays[state.mode];
    }
  }
  state.sections = labelSections(state.course);
  const report = { cost: bill, cells: session.changedCells.size, holesAffected: affected };
  session.undo.length = 0;
  session.redo.length = 0;
  session.bill = 0;
  session.changedCells.clear();
  return { ok: true, report };
}

export function discardSession(state, session) {
  let guard = 0;
  while (session.undo.length && guard++ < 10000) undo(state, session);
  session.redo.length = 0;
  session.bill = 0;
  session.changedCells.clear();
  state.sections = labelSections(state.course);
  return { ok: true };
}

// --- measurement -----------------------------------------------------------------------

// Distance/elevation/slope between two cell points (cell coords, may be fractional).
export function measure(course, a, b) {
  const CELL = 8; // yards per cell (mirrors constants.CELL_YD without the import cycle risk)
  const dYd = Math.hypot(b.x - a.x, b.y - a.y) * CELL;
  const elevA = sampleElev(course, a.x, a.y);
  const elevB = sampleElev(course, b.x, b.y);
  const dFt = elevB - elevA;
  const runFt = dYd * 3;
  const slopeDeg = runFt > 0.5 ? Math.atan2(dFt, runFt) * (180 / Math.PI) : 0;
  return {
    yards: Math.round(dYd),
    elevationFt: Math.round(dFt * 10) / 10,
    slopeDeg: Math.round(slopeDeg * 10) / 10,
  };
}

function sampleElev(course, fx, fy) {
  const x0 = clamp(Math.floor(fx), 0, course.w - 1);
  const y0 = clamp(Math.floor(fy), 0, course.h - 1);
  const x1 = Math.min(x0 + 1, course.w - 1);
  const y1 = Math.min(y0 + 1, course.h - 1);
  const tx = clamp(fx - x0, 0, 1);
  const ty = clamp(fy - y0, 0, 1);
  const e = course.elevation;
  const w = course.w;
  return (e[y0 * w + x0] * (1 - tx) + e[y0 * w + x1] * tx) * (1 - ty)
    + (e[y1 * w + x0] * (1 - tx) + e[y1 * w + x1] * tx) * ty;
}

// --- statistics ---------------------------------------------------------------------------

const ACRE_PER_CELL = (8 * 8) / 4840; // 64 sq yd per cell

export function courseStats(state, session = null) {
  const { course } = state;
  const counts = {};
  for (const z of course.zones) counts[z] = (counts[z] || 0) + 1;
  const acres = (z) => Math.round((counts[z] || 0) * ACRE_PER_CELL * 100) / 100;
  const holes = course.holes.filter((h) => h.tee && h.pin);
  const totalYd = holes.reduce((a, h) => a + holeDistanceYd(h), 0);
  const totalPar = holes.reduce((a, h) => a + holePar(h), 0);
  const treeCount = course.objects.filter((o) => o.type.startsWith('tree_')).length;
  // difficulty: length + hazards + green size pressure, 1..5 stars
  const bunkerCells = counts[ZONE.BUNKER] || 0;
  const waterCells = counts[ZONE.WATER] || 0;
  const difficulty = clamp(Math.round(
    1 + (totalYd / holes.length / 240 || 0) + bunkerCells / 150 + waterCells / 120,
  ), 1, 5);
  return {
    holes: course.holes.length,
    openHoles: course.holes.filter((h) => h.status === HOLE_STATUS.OPEN).length,
    totalPar,
    totalYd: Math.round(totalYd),
    fairwayAcres: acres(ZONE.FAIRWAY) + acres(ZONE.SEMI),
    greenAcres: acres(ZONE.GREEN) + acres(ZONE.FRINGE),
    roughAcres: acres(ZONE.ROUGH) + acres(ZONE.HEAVY),
    bunkerAcres: acres(ZONE.BUNKER),
    waterAcres: acres(ZONE.WATER),
    pathAcres: acres(ZONE.PATH),
    treeCount,
    objectCount: course.objects.length,
    difficulty,
    pendingCost: session ? Math.round(session.bill) : 0,
  };
}
