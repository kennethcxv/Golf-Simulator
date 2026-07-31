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
import {
  ensurePaint, invalidateGeom, deriveZones, deriveZonesRegion, evaluateSurface, getGeom, vecId,
  makeVecGreen, makeVecBunker, makeVecPond, makeVecTee,
} from './courseVec.js';
import { CELL_YD } from './constants.js';
import {
  objectCollisionOk,
  objectCollisionRadiusYd,
} from './courseEditorObjectPlacement.js';

// the tall-canopy flora species (for tree counting in stats); matches the
// renderer's TREE_SPECIES set plus the legacy Kenney aliases
const TREE_OBJECT_TYPES = new Set([
  'oak_a', 'oak_b', 'maple_a', 'birch_a', 'shade_a', 'flower_a', 'fill_a', 'fill_b',
  'pine_a', 'pine_b', 'spruce_a', 'cedar_a',
  'tree_default', 'tree_oak', 'tree_detailed', 'tree_fat', 'tree_pineDefaultA', 'tree_pineRoundB',
]);

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
    baselineIdentity: {
      nextHoleId: state.course.nextHoleId,
      nextObjectId: state.course.nextObjectId,
      nextPathId: state.course.nextPathId,
      nextVectorId: state.course.vec?.nextId,
      paintPresent: !!state.course.paint,
      sections: cloneJson(state.sections || []),
    },
  };
}

export function sessionDirty(session) {
  // Redo is only a history branch: after undoing back to the opening state the
  // live course has no pending work and must not show a false Apply/exit prompt.
  return session.undo.length > 0 || session.changedCells.size > 0;
}

// --- op plumbing -------------------------------------------------------------------

// `changedCells` is the NET footprint of the pending undo stack, not a history
// of every cell the cursor ever touched. That distinction matters because the
// footprint drives renovation closures: undone work must not close a hole.
function refreshChangedCells(state, session) {
  const baseline = new Map();
  for (const op of session.undo) {
    for (const cell of op.cells || []) {
      let first = baseline.get(cell.i);
      if (!first) baseline.set(cell.i, first = {});
      if (cell.zoneBefore !== undefined && first.zone === undefined) first.zone = cell.zoneBefore;
      if (cell.elevBefore !== undefined && first.elev === undefined) first.elev = cell.elevBefore;
    }
  }
  session.changedCells.clear();
  const { course } = state;
  for (const [i, first] of baseline) {
    const zoneChanged = first.zone !== undefined && course.zones[i] !== first.zone;
    const elevChanged = first.elev !== undefined && Math.abs(course.elevation[i] - first.elev) >= 1e-4;
    if (zoneChanged || elevChanged) session.changedCells.add(i);
  }
}

function pushOp(state, session, op) {
  session.undo.push(op);
  session.redo.length = 0;
  session.bill = Math.max(0, session.bill + op.cost);
  refreshChangedCells(state, session);
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
  const nextPathIdBefore = course.nextPathId;
  const zonesBefore = Uint8Array.from(course.zones);
  const pathsBefore = JSON.parse(JSON.stringify(course.paths));
  mutate();
  if (course.vec) {
    // vector courses rasterize PATH from the spline geometry — re-derive
    invalidateGeom(course);
    const pathRect = changedVectorRect(pathsBefore, course.paths);
    if (pathRect) deriveZonesRegion(course, paddedRect(
      pathRect, pathZonePadding(pathsBefore, course.paths),
    ));
    else deriveZones(course);
  } else {
    repaintPathZones(course);
  }
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
    nextPathIdBefore, nextPathIdAfter: course.nextPathId,
    pathsBefore, pathsAfter: JSON.parse(JSON.stringify(course.paths)),
  });
  return { ok: true, cost, cells: cells.length };
}

// --- vector-course edits -------------------------------------------------------------
// On a vector course the visible surfaces + relief derive from course.vec and
// the freeform course.paint layer, NOT from course.zones directly — so the
// green/bunker/water/tee tools and the paint brush write THERE, then re-derive
// the sim grid. One vecOp = one undo step, storing vec + paint + zone diffs.

function nearestVecHole(course, cx, cy) {
  let best = null;
  let bestD = Infinity;
  for (const h of course.vec.holes) {
    // distance to the hole's centerline endpoints is a cheap, good-enough pick
    for (const p of h.line) {
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d < bestD) { bestD = d; best = h; }
    }
  }
  return best;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Vector edits can change relief without changing any raster zone (for
// example bunker depth, green contours, or water depth). Keep a geometry
// footprint on the history op so those edits still receive a local renderer
// refresh instead of falling back to the whole course.
function changedVectorRect(before, after) {
  const points = [];
  const addPoint = (point) => {
    if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
      points.push({ x: point.x, y: point.y });
    } else if (Number.isFinite(point?.cx) && Number.isFinite(point?.cy)) {
      points.push({ x: point.cx, y: point.cy });
    }
  };
  const walk = (left, right) => {
    if (jsonEqual(left, right)) return;
    const leftPoints = Array.isArray(left?.pts) ? left.pts : [];
    const rightPoints = Array.isArray(right?.pts) ? right.pts : [];
    if (leftPoints.length || rightPoints.length) {
      leftPoints.forEach(addPoint);
      rightPoints.forEach(addPoint);
    }
    addPoint(left);
    addPoint(right);
    if (Array.isArray(left) || Array.isArray(right)) {
      const a = Array.isArray(left) ? left : [];
      const b = Array.isArray(right) ? right : [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i]);
      return;
    }
    if ((left && typeof left === 'object') || (right && typeof right === 'object')) {
      const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
      for (const key of keys) walk(left?.[key], right?.[key]);
    }
  };
  walk(before, after);
  if (!points.length) return null;
  const bounds = boundsOfPoints(points);
  return {
    x0: Math.floor(bounds.minX),
    y0: Math.floor(bounds.minY),
    x1: Math.ceil(bounds.maxX),
    y1: Math.ceil(bounds.maxY),
  };
}

function paddedRect(rect, padding) {
  return rect ? {
    x0: rect.x0 - padding,
    y0: rect.y0 - padding,
    x1: rect.x1 + padding,
    y1: rect.y1 + padding,
  } : null;
}

function pathZonePadding(...pathLists) {
  let maxWidthYd = 0;
  for (const paths of pathLists) {
    for (const path of paths || []) maxWidthYd = Math.max(maxWidthYd, Number(path.width) || 0);
  }
  return Math.max(4, Math.ceil(maxWidthYd / (CELL_YD * 2) + 2));
}

// Calculate the complete possible influence beyond the changed control points.
// Widths are serialized in yards, while deriveZonesRegion consumes cells. This
// stays data-driven so imported/authored courses with wider-than-UI corridors
// still get byte-identical regional derivation.
function vectorZonePadding(...vectors) {
  let maxInfluenceYd = 0;
  let maxRoughYd = 26;
  for (const vector of vectors) {
    for (const hole of vector?.holes || []) maxRoughYd = Math.max(maxRoughYd, Number(hole.roughW) || 0);
  }
  for (const vector of vectors) {
    for (const hole of vector?.holes || []) {
      const corridorYd = Math.max(0, ...(hole.width || []).map((stop) => Number(stop.w) || 0));
      maxInfluenceYd = Math.max(maxInfluenceYd, corridorYd + maxRoughYd + 24);
      const green = hole.green;
      if (green) {
        maxInfluenceYd = Math.max(
          maxInfluenceYd,
          (Number(green.fringe) || 1) + (Number(green.apron) || 0) + maxRoughYd + 24,
        );
      }
      for (const tee of hole.tees || []) {
        maxInfluenceYd = Math.max(
          maxInfluenceYd,
          Math.max(Number(tee.w) || 0, Number(tee.d) || 0) / 2 + maxRoughYd + 24,
        );
      }
    }
    for (const stream of vector?.streams || []) {
      maxInfluenceYd = Math.max(maxInfluenceYd, (Number(stream.w) || 0) / 2 + 2);
    }
  }
  return Math.max(4, Math.ceil(maxInfluenceYd / CELL_YD + 2));
}

function snapshotHoleRecords(course, holeIds) {
  return [...new Set(holeIds || [])].map((holeId) => {
    const hole = course.holes.find((candidate) => candidate.id === holeId);
    return hole ? cloneJson(hole) : null;
  }).filter(Boolean);
}

// Restore tracked hole records without replacing surviving record objects.
// UI panels commonly retain a selected-hole reference during undo/redo.
function restoreHoleRecords(course, snapshots) {
  for (const snapshot of snapshots || []) {
    const hole = course.holes.find((candidate) => candidate.id === snapshot.id);
    if (!hole) continue;
    for (const key of Object.keys(hole)) {
      if (!Object.prototype.hasOwnProperty.call(snapshot, key)) delete hole[key];
    }
    Object.assign(hole, cloneJson(snapshot));
  }
}

function vecOp(state, session, label, mutate, { extraCost = 0, holeIds = [] } = {}) {
  const { course } = state;
  const vecBefore = cloneJson(course.vec);
  const holesBefore = snapshotHoleRecords(course, holeIds);
  const paintBefore = course.paint ? Uint8Array.from(course.paint) : null;
  const zonesBefore = Uint8Array.from(course.zones);
  const mutCost = mutate() || 0;
  const vecAfter = cloneJson(course.vec);
  const holesAfter = snapshotHoleRecords(course, holeIds);
  let paintChanged = !!course.paint !== !!paintBefore;
  for (let i = 0; !paintChanged && i < (course.paint?.length || 0); i++) {
    if (course.paint[i] !== paintBefore[i]) { paintChanged = true; break; }
  }
  if (jsonEqual(vecBefore, vecAfter) && jsonEqual(holesBefore, holesAfter) && !paintChanged) {
    return { ok: true, cost: 0, cells: 0, unchanged: true };
  }
  const vectorRect = changedVectorRect(vecBefore, vecAfter);
  invalidateGeom(course);
  if (vectorRect) deriveZonesRegion(course, paddedRect(
    vectorRect, vectorZonePadding(vecBefore, vecAfter),
  ));
  else deriveZones(course);
  const cells = [];
  const changed = [];
  for (let i = 0; i < course.zones.length; i++) {
    if (course.zones[i] !== zonesBefore[i]) {
      cells.push({ i, zoneBefore: zonesBefore[i], zoneAfter: course.zones[i] });
      changed.push(i);
    }
  }
  if (changed.length) turfOnZonesChanged(state, changed);
  const cost = Math.round(mutCost + extraCost);
  pushOp(state, session, {
    kind: 'vec', label, cost, cells,
    rect: vectorRect,
    vecBefore, vecAfter,
    paintBeforePresent: !!paintBefore,
    paintAfterPresent: !!course.paint,
    holesBefore, holesAfter,
    paintBefore: paintChanged && paintBefore ? Array.from(paintBefore) : null,
    paintAfter: paintChanged && course.paint ? Array.from(course.paint) : null,
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
  if (course.vec) {
    // vector courses derive surfaces from vec + the paint override layer; the
    // brush writes overrides so the change survives re-derivation and renders.
    if (stroke.paintPresentBefore === undefined) stroke.paintPresentBefore = !!course.paint;
    const paint = ensurePaint(course);
    for (const c of cells) {
      const cur = paint[c.i];
      if (cur === zone) continue;
      if (!stroke.before.has(c.i)) stroke.before.set(c.i, cur);
      paint[c.i] = zone;
      stroke.after.set(c.i, zone);
    }
    return cells;
  }
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

// A changed paint sample only influences nearby cell-centre evaluations. Keep
// the set deliberately one cell wider than bilinear interpolation requires so
// edge clamping and future kernel changes remain covered without falling back
// to a full-course derive.
function vectorPaintZoneCandidates(course, paintChanges) {
  const candidates = new Set();
  for (const change of paintChanges) {
    const px = change.i % course.w;
    const py = (change.i - px) / course.w;
    for (let y = py - 1; y <= py + 1; y++) {
      for (let x = px - 1; x <= px + 1; x++) {
        if (x >= 0 && y >= 0 && x < course.w && y < course.h) candidates.add(y * course.w + x);
      }
    }
  }
  return candidates;
}

function vectorPaintAnchorZones(course) {
  const anchors = new Map();
  for (const hole of course.holes) {
    if (hole.pin) {
      const x = Math.round(hole.pin.x);
      const y = Math.round(hole.pin.y);
      if (x >= 0 && y >= 0 && x < course.w && y < course.h) anchors.set(y * course.w + x, ZONE.GREEN);
    }
    if (hole.tee) {
      const x = Math.round(hole.tee.x);
      const y = Math.round(hole.tee.y);
      if (x >= 0 && y >= 0 && x < course.w && y < course.h) anchors.set(y * course.w + x, ZONE.TEE);
    }
  }
  return anchors;
}

function vectorPaintStructureCells(course, candidates) {
  const cells = new Set();
  for (const structure of course.structures || []) {
    const x0 = Math.max(0, structure.x);
    const y0 = Math.max(0, structure.y);
    const x1 = Math.min(course.w, structure.x + structure.w);
    const y1 = Math.min(course.h, structure.y + structure.h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * course.w + x;
        if (candidates.has(i)) cells.add(i);
      }
    }
  }
  return cells;
}

export function endPaintStroke(state, session, stroke, label = 'Paint') {
  if (!stroke.before.size) return { ok: false, cost: 0 };
  const { course } = state;
  if (course.vec) {
    // The freeform override is already live. The old commit path copied the
    // entire paint layer, invalidated unchanged vector geometry, and derived
    // every course cell twice just to price a brush-sized edit. That created a
    // 300+ ms release frame. Store the actual changed paint samples and evaluate
    // only the cell centres they can influence.
    const paintChanges = [];
    for (const [i, before] of stroke.before) {
      const after = course.paint[i];
      if (after !== before) paintChanges.push({ i, before, after });
    }
    if (!paintChanges.length) return { ok: false, cost: 0 };

    const candidates = vectorPaintZoneCandidates(course, paintChanges);
    const anchors = vectorPaintAnchorZones(course);
    const structures = vectorPaintStructureCells(course, candidates);
    const geom = getGeom(course);
    const zoneChanges = [];
    const changed = [];
    let cost = 0;
    for (const i of candidates) {
      const x = i % course.w;
      const y = (i - x) / course.w;
      const before = course.zones[i];
      let after = evaluateSurface(course, geom, x + 0.5, y + 0.5, course.paint).zone;
      if (structures.has(i)) after = ZONE.OUT;
      if (anchors.has(i)) after = anchors.get(i);
      if (after !== before) {
        course.zones[i] = after;
        zoneChanges.push({ i, zoneBefore: before, zoneAfter: after });
        changed.push(i);
        cost += zoneCost(after);
      }
    }
    turfOnZonesChanged(state, changed);
    cost = Math.round(cost);

    // Keep paint-only samples in the operation footprint as well. A sub-cell
    // edit can be visually real without flipping a coarse simulation centre;
    // it must still be dirty, undoable, and renderer-scoped.
    const cells = zoneChanges.slice();
    const footprint = new Set(cells.map((cell) => cell.i));
    for (const change of paintChanges) {
      if (!footprint.has(change.i)) cells.push({ i: change.i });
    }
    pushOp(state, session, {
      kind: 'vector-paint', label, cells, cost, paintChanges,
      paintPresentBefore: !!stroke.paintPresentBefore,
    });
    return { ok: true, cost, cells: zoneChanges.length };
  }
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

const FEATURE_OPEN_GROUND = new Set([
  ZONE.ROUGH, ZONE.FAIRWAY, ZONE.SEMI, ZONE.HEAVY,
  ZONE.OUT, ZONE.FRINGE, ZONE.DIRT, ZONE.BED,
]);
const FEATURE_ALLOWED_ZONES = {
  green: new Set([...FEATURE_OPEN_GROUND, ZONE.GREEN]),
  bunker: FEATURE_OPEN_GROUND,
  water: FEATURE_OPEN_GROUND,
  tee: new Set([...FEATURE_OPEN_GROUND, ZONE.TEE]),
};
const FEATURE_SURFACE_REASONS = {
  green: 'Greens require open ground.',
  bunker: 'Bunkers require open turf.',
  water: 'Water requires open ground.',
  tee: 'Tee boxes require open ground.',
};
const FEATURE_BOUNDS_REASONS = {
  green: 'Greens must fit inside the course.',
  bunker: 'Bunkers must fit inside the course.',
  water: 'Water must fit inside the course.',
  tee: 'Tee boxes must fit inside the course.',
};
const GREEN_KIDNEY_OUTLINE = [
  [1.02, -0.18], [0.9, 0.28], [0.62, 0.74], [0.14, 1.02],
  [-0.34, 0.94], [-0.74, 0.62], [-0.94, 0.14], [-0.82, -0.34],
  [-0.42, -0.72], [0.02, -0.42], [0.42, -0.82], [0.82, -0.62],
];

function boundsOfPoints(points, margin = 0) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

function ellipseBounds(cx, cy, rx, ry, angle, margin = 0) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const dx = Math.hypot(rx * ca, ry * sa) + margin;
  const dy = Math.hypot(rx * sa, ry * ca) + margin;
  return { minX: cx - dx, minY: cy - dy, maxX: cx + dx, maxY: cy + dy };
}

function rectBounds(cx, cy, halfLength, halfWidth, angle) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const dx = Math.abs(ca) * halfLength + Math.abs(sa) * halfWidth;
  const dy = Math.abs(sa) * halfLength + Math.abs(ca) * halfWidth;
  return { minX: cx - dx, minY: cy - dy, maxX: cx + dx, maxY: cy + dy };
}

function boundsFitCourse(course, bounds) {
  return bounds.minX >= 0 && bounds.minY >= 0
    && bounds.maxX <= course.w && bounds.maxY <= course.h;
}

function pointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const cross = (px - ax) * dy - (py - ay) * dx;
  if (Math.abs(cross) > 1e-8) return false;
  const dot = (px - ax) * dx + (py - ay) * dy;
  return dot >= -1e-8 && dot <= dx * dx + dy * dy + 1e-8;
}

function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    if (pointOnSegment(px, py, a.x, a.y, b.x, b.y)) return true;
    if ((b.y > py) !== (a.y > py)
      && px < ((a.x - b.x) * (py - b.y)) / (a.y - b.y) + b.x) inside = !inside;
  }
  return inside;
}

function pointSegmentDistanceSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const denom = dx * dx + dy * dy;
  const t = denom > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / denom, 0, 1) : 0;
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  return (px - qx) ** 2 + (py - qy) ** 2;
}

function pointInPolygonMargin(px, py, points, margin) {
  if (pointInPolygon(px, py, points)) return true;
  if (!(margin > 0)) return false;
  const limit = margin * margin;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    if (pointSegmentDistanceSq(px, py, points[j].x, points[j].y, points[i].x, points[i].y) <= limit) return true;
  }
  return false;
}

function vectorPond(cx, cy, r, elong, angle, seed) {
  return makeVecPond(cx, cy, r * elong * CELL_YD, r * CELL_YD, seed, 'pond', angle);
}

function addCellsWithin(course, bounds, contains, cells) {
  const x0 = Math.max(0, Math.floor(bounds.minX - 0.5));
  const y0 = Math.max(0, Math.floor(bounds.minY - 0.5));
  const x1 = Math.min(course.w - 1, Math.ceil(bounds.maxX - 0.5));
  const y1 = Math.min(course.h - 1, Math.ceil(bounds.maxY - 0.5));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (contains(x + 0.5, y + 0.5)) cells.add(y * course.w + x);
    }
  }
}

function featureFootprint(course, feature, cx, cy, options) {
  const cells = new Set();
  if (feature === 'tee') {
    const { aimX, aimY, w = 1.2, len = 1.8 } = options;
    if (![cx, cy, aimX, aimY, w, len].every(Number.isFinite) || !(w > 0) || !(len > 0)) return null;
    const angle = Math.atan2(aimY - cy, aimX - cx);
    const bounds = rectBounds(cx, cy, len, w, angle);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    addCellsWithin(course, bounds, (px, py) => {
      const dx = px - cx;
      const dy = py - cy;
      const lx = dx * ca + dy * sa;
      const ly = -dx * sa + dy * ca;
      return Math.abs(lx) <= len && Math.abs(ly) <= w;
    }, cells);
    return { bounds, cells };
  }

  if (feature === 'green') {
    const { r = 1.8, elong = 1.25, angle = 0, kidney = false } = options;
    if (![cx, cy, r, elong, angle].every(Number.isFinite) || !(r > 0) || !(elong > 0)) return null;
    if (course.vec) {
      const green = makeVecGreen(
        cx, cy, r * CELL_YD, elong, angle, course.vec.nextId,
        kidney ? GREEN_KIDNEY_OUTLINE : null,
      );
      const margin = (green.fringe || 1) / CELL_YD;
      const bounds = boundsOfPoints(green.pts, margin);
      addCellsWithin(course, bounds, (px, py) => pointInPolygonMargin(px, py, green.pts, margin), cells);
      return { bounds, cells };
    }
    const rx = r * elong;
    const ry = r;
    const bounds = ellipseBounds(cx, cy, rx, ry, angle, 1);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const greenCells = new Set();
    addCellsWithin(course, ellipseBounds(cx, cy, rx, ry, angle), (px, py) => {
      const dx = px - cx;
      const dy = py - cy;
      const lx = dx * ca + dy * sa;
      const ly = -dx * sa + dy * ca;
      let inside = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
      if (inside && kidney) {
        const bdx = lx - rx * 0.85;
        const bdy = ly - ry * 0.7;
        if (bdx * bdx + bdy * bdy < r * 0.7 * r * 0.7) inside = false;
      }
      return inside;
    }, greenCells);
    for (const i of greenCells) {
      cells.add(i);
      const x = i % course.w;
      const y = (i / course.w) | 0;
      if (x > 0) cells.add(i - 1);
      if (x + 1 < course.w) cells.add(i + 1);
      if (y > 0) cells.add(i - course.w);
      if (y + 1 < course.h) cells.add(i + course.w);
    }
    return { bounds, cells };
  }

  if (feature === 'bunker') {
    const { r = 1.4, lobes = 2, stretch = 1, angle = 0 } = options;
    if (![cx, cy, r, lobes, stretch, angle].every(Number.isFinite)
      || !(r > 0) || !(stretch > 0) || !(lobes >= 1)) return null;
    if (course.vec) {
      const bunker = makeVecBunker(cx, cy, r * CELL_YD, course.vec.nextId, {
        lobes: Math.max(1, lobes), stretch, angle,
      });
      const bounds = boundsOfPoints(bunker.pts);
      addCellsWithin(course, bounds, (px, py) => pointInPolygon(px, py, bunker.pts), cells);
      return { bounds, cells };
    }
    const centers = [{ x: cx, y: cy, r }];
    for (let i = 1; i < lobes; i++) {
      const a = angle + i * 2.4;
      centers.push({ x: cx + Math.cos(a) * r * 0.75, y: cy + Math.sin(a) * r * 0.75, r: r * 0.7 });
    }
    const bounds = {
      minX: Math.min(...centers.map((c) => c.x - c.r)),
      minY: Math.min(...centers.map((c) => c.y - c.r)),
      maxX: Math.max(...centers.map((c) => c.x + c.r)),
      maxY: Math.max(...centers.map((c) => c.y + c.r)),
    };
    addCellsWithin(course, bounds, (px, py) => centers.some((c) => Math.hypot(px - c.x, py - c.y) <= c.r), cells);
    return { bounds, cells };
  }

  const { r = 2.4, elong = 1.2, angle = 0 } = options;
  if (![cx, cy, r, elong, angle].every(Number.isFinite) || !(r > 0) || !(elong > 0)) return null;
  if (course.vec) {
    const pond = vectorPond(cx, cy, r, elong, angle, course.vec.nextId);
    const bounds = boundsOfPoints(pond.pts);
    addCellsWithin(course, bounds, (px, py) => pointInPolygon(px, py, pond.pts), cells);
    return { bounds, cells };
  }
  const rx = r * elong;
  const ry = r;
  const bounds = ellipseBounds(cx, cy, rx, ry, angle);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  addCellsWithin(course, bounds, (px, py) => {
    const dx = px - cx;
    const dy = py - cy;
    const lx = dx * ca + dy * sa;
    const ly = -dx * sa + dy * ca;
    return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
  }, cells);
  return { bounds, cells };
}

// Pure placement authority shared by hover previews and stamp commits.
// Pond/lake are aliases for the water stamp; callers still pass the exact
// stamp-native dimensions and angle chosen for that shape.
export function featurePlacementOk(course, feature, cx, cy, options = {}) {
  const kind = feature === 'pond' || feature === 'lake' ? 'water' : feature;
  if (!FEATURE_ALLOWED_ZONES[kind]) return { ok: false, reason: 'Unknown editor feature.' };
  if (kind === 'tee' && !course.holes.some((hole) => hole.id === options.holeId)) {
    return { ok: false, reason: 'No such hole.' };
  }
  const footprint = featureFootprint(course, kind, cx, cy, options);
  if (!footprint) return { ok: false, reason: 'Invalid placement dimensions.' };
  if (!boundsFitCourse(course, footprint.bounds)) {
    return { ok: false, reason: FEATURE_BOUNDS_REASONS[kind] };
  }
  const allowed = FEATURE_ALLOWED_ZONES[kind];
  if (!footprint.cells.size) return { ok: false, reason: FEATURE_SURFACE_REASONS[kind] };
  for (const i of footprint.cells) {
    if (!allowed.has(course.zones[i])) return { ok: false, reason: FEATURE_SURFACE_REASONS[kind] };
  }
  return { ok: true, reason: null };
}

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
  r = 1.8, elong = 1.25, angle = 0, kidney = false, raise = 1.4, holeId = null,
} = {}) {
  const { course } = state;
  const legal = featurePlacementOk(course, 'green', cx, cy, { r, elong, angle, kidney });
  if (!legal.ok) return legal;
  if (course.vec) {
    const requestedHole = holeId == null
      ? null
      : course.holes.find((candidate) => candidate.id === holeId);
    if (holeId != null && !requestedHole) return { ok: false, reason: 'No such hole.' };
    const hole = requestedHole
      ? course.vec.holes.find((candidate) => candidate.id === requestedHole.vecId)
      : nearestVecHole(course, cx, cy);
    if (requestedHole && !hole) return { ok: false, reason: 'That hole has no vector design.' };
    const courseHole = requestedHole
      || (hole ? course.holes.find((candidate) => candidate.vecId === hole.id) : null);
    return vecOp(state, session, 'Green', () => {
      const g = makeVecGreen(
        cx, cy, r * CELL_YD, elong, angle, vecId(course.vec),
        kidney ? GREEN_KIDNEY_OUTLINE : null,
      );
      g.raise = raise + 0.2;
      const rc = r;
      g.pins = [
        { x: cx, y: cy },
        { x: cx + Math.cos(angle) * rc * 0.5, y: cy + Math.sin(angle) * rc * 0.5 },
        { x: cx - Math.cos(angle) * rc * 0.4, y: cy - Math.sin(angle) * rc * 0.4 },
      ];
      if (hole) {
        hole.green = g;
        if (courseHole) {
          courseHole.pin = { x: Math.round(cx - 0.5), y: Math.round(cy - 0.5) };
          courseHole.pins = {
            A: { x: Math.round(g.pins[0].x - 0.5), y: Math.round(g.pins[0].y - 0.5) },
            B: { x: Math.round(g.pins[1].x - 0.5), y: Math.round(g.pins[1].y - 0.5) },
            C: { x: Math.round(g.pins[2].x - 0.5), y: Math.round(g.pins[2].y - 0.5) },
          };
          courseHole.activePin = 'A';
        }
      } else {
        // standalone green (no hole nearby) — parked on the first hole so it renders
        if (course.vec.holes[0]) course.vec.holes[0].green = g;
      }
      const area = Math.PI * (r * elong) * r; // cells²
      return area * zoneCost(ZONE.GREEN);
    }, { holeIds: courseHole ? [courseHole.id] : [] });
  }
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
  r = 1.4, depth = 1.6, lobes = 2, stretch = 1, angle = 0, holeId = null,
} = {}) {
  const { course } = state;
  const legal = featurePlacementOk(course, 'bunker', cx, cy, { r, lobes, stretch, angle });
  if (!legal.ok) return legal;
  if (course.vec) {
    const requestedHole = holeId == null
      ? null
      : course.holes.find((candidate) => candidate.id === holeId);
    if (holeId != null && !requestedHole) return { ok: false, reason: 'No such hole.' };
    const hole = requestedHole
      ? course.vec.holes.find((candidate) => candidate.id === requestedHole.vecId)
      : nearestVecHole(course, cx, cy) || course.vec.holes[0];
    if (!hole) return { ok: false, reason: 'That hole has no vector design.' };
    return vecOp(state, session, 'Bunker', () => {
      const id = vecId(course.vec);
      const b = { id, ...makeVecBunker(cx, cy, r * CELL_YD, id, {
        depth: depth + 0.8, lobes: Math.max(1, lobes), stretch, angle,
      }) };
      (hole.bunkers || (hole.bunkers = [])).push(b);
      const area = Math.PI * r * r * 1.2;
      return area * zoneCost(ZONE.BUNKER);
    });
  }
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
  const legal = featurePlacementOk(course, 'water', cx, cy, { r, elong, angle });
  if (!legal.ok) return legal;
  if (course.vec) {
    return vecOp(state, session, 'Water', () => {
      const pond = vectorPond(cx, cy, r, elong, angle, vecId(course.vec));
      pond.depth = depth + 2;
      course.vec.waters.push({ id: vecId(course.vec), ...pond });
      const area = Math.PI * (r * elong) * r;
      return area * zoneCost(ZONE.WATER);
    });
  }
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
  if (course.vec) {
    return vecOp(state, session, 'Stream', () => {
      course.vec.streams.push({ id: vecId(course.vec), pts: pts.map((p) => ({ x: p.x, y: p.y })), w: width * 2 * CELL_YD, depth: depth + 0.8 });
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return len * width * 2 * zoneCost(ZONE.WATER);
    });
  }
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
  const legal = featurePlacementOk(course, 'tee', cx, cy, { holeId, aimX, aimY, w, len });
  if (!legal.ok) return legal;
  const hole = course.holes.find((h) => h.id === holeId);
  ensureHoleShape(hole, holeNumber(course, holeId));
  if (course.vec) {
    const vh = course.vec.holes.find((h) => h.id === hole.vecId);
    const tierKey = teeKey === 'back' ? 'back' : teeKey === 'forward' ? 'forward' : 'middle';
    return vecOp(state, session, 'Tee', () => {
      const rot = Math.atan2(aimY - cy, aimX - cx);
      const tee = makeVecTee(cx, cy, rot, tierKey, w * 2 * CELL_YD, len * 2 * CELL_YD);
      tee.raise = 1.2;
      if (vh) {
        vh.tees = (vh.tees || []).filter((t) => t.tier !== tierKey);
        vh.tees.push(tee);
      }
      const marker = { x: Math.round(cx - 0.5), y: Math.round(cy - 0.5) };
      hole.tees = hole.tees || {};
      hole.tees[tierKey] = marker;
      hole.activeTee = teeKey;      // the newly-built tee becomes the one in play
      hole.tee = { ...marker };
      const area = (w * 2) * (len * 2);
      return area * zoneCost(ZONE.TEE);
    }, { holeIds: [holeId] });
  }
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
  if (hole.activePin === pinKey && hole.pin?.x === pos.x && hole.pin?.y === pos.y) {
    return { ok: true, cost: 0, unchanged: true };
  }
  const before = { activePin: hole.activePin, pin: hole.pin ? { ...hole.pin } : null };
  hole.activePin = pinKey;
  hole.pin = { ...pos };
  pushOp(state, session, {
    kind: 'hole', label: `Select pin ${pinKey}`, cost: 0, cells: null,
    holeId,
    before,
    after: { activePin: pinKey, pin: { ...pos } },
  });
  return { ok: true, cost: 0 };
}

export function selectTee(state, session, holeId, teeKey) {
  const hole = state.course.holes.find((h) => h.id === holeId);
  if (!hole) return { ok: false, reason: 'No such hole.' };
  ensureHoleShape(hole, holeNumber(state.course, holeId));
  const pos = hole.tees[teeKey];
  if (!pos) return { ok: false, reason: `No ${teeKey} tee built yet.` };
  if (hole.activeTee === teeKey && hole.tee?.x === pos.x && hole.tee?.y === pos.y) {
    return { ok: true, cost: 0, unchanged: true };
  }
  const before = { activeTee: hole.activeTee, tee: hole.tee ? { ...hole.tee } : null };
  hole.activeTee = teeKey;
  hole.tee = { ...pos };
  pushOp(state, session, {
    kind: 'hole', label: `Select ${teeKey} tee`, cost: 0, cells: null,
    holeId,
    before,
    after: { activeTee: teeKey, tee: { ...pos } },
  });
  return { ok: true, cost: 0 };
}

// --- existing vector feature editing --------------------------------------------------

const PATH_MATERIAL_VALUES = new Set(['asphalt', 'concrete', 'gravel', 'dirt']);
const SHORELINE_STYLE_VALUES = new Set(['natural', 'mown', 'reeds', 'rock', 'bulkhead']);
const BRIDGE_DECK_MATERIAL_VALUES = new Set(['timber', 'concrete', 'steel']);
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function vectorUnsupported(reason = 'This course uses the legacy grid format; vector feature editing is unavailable.') {
  return { ok: false, unsupported: true, reason };
}

function editableVectorCourse(course) {
  return !!(course?.vec && Array.isArray(course.vec.holes) && Array.isArray(course.vec.waters));
}

function vecHoleFromCourseRecord(course, holeId) {
  if (!editableVectorCourse(course)) return vectorUnsupported();
  const courseHole = course.holes.find((hole) => hole.id === holeId);
  if (!courseHole) return { ok: false, reason: 'No such hole.' };
  const vecHole = course.vec.holes.find((hole) => hole.id === courseHole.vecId);
  if (!vecHole) {
    return vectorUnsupported('This hole is not linked to an editable vector record.');
  }
  return { ok: true, courseHole, vecHole };
}

function validPoint(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointsInsideCourse(course, points) {
  return points.every((point) => (
    point.x >= 0 && point.y >= 0 && point.x <= course.w && point.y <= course.h
  ));
}

function polygonArea(points) {
  let twice = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    twice += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return Math.abs(twice) * 0.5;
}

function validateControlPoints(course, points, { closed = true } = {}) {
  const min = closed ? 3 : 2;
  if (!Array.isArray(points) || points.length < min || !points.every(validPoint)) {
    return { ok: false, reason: `${closed ? 'A boundary' : 'A path'} needs at least ${min} finite points.` };
  }
  if (!pointsInsideCourse(course, points)) {
    return { ok: false, reason: `${closed ? 'Boundary' : 'Path'} points must stay inside the course.` };
  }
  if (closed && polygonArea(points) <= 1e-5) {
    return { ok: false, reason: 'A boundary must enclose a positive area.' };
  }
  if (!closed) {
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    if (length <= 1e-5) return { ok: false, reason: 'A path must have positive length.' };
  }
  return { ok: true };
}

function pointCentroid(points) {
  let x = 0;
  let y = 0;
  for (const point of points) { x += point.x; y += point.y; }
  return { x: x / points.length, y: y / points.length };
}

function normalizeTransform(transform, points) {
  if (transform === undefined) return { ok: true, value: null };
  if (!transform || typeof transform !== 'object' || Array.isArray(transform)) {
    return { ok: false, reason: 'Feature transform must be an object.' };
  }
  const allowed = new Set(['dx', 'dy', 'rotate', 'scale', 'scaleX', 'scaleY', 'origin']);
  if (Object.keys(transform).some((key) => !allowed.has(key))) {
    return { ok: false, reason: 'Feature transform contains an unsupported value.' };
  }
  const dx = OWN(transform, 'dx') ? transform.dx : 0;
  const dy = OWN(transform, 'dy') ? transform.dy : 0;
  const rotate = OWN(transform, 'rotate') ? transform.rotate : 0;
  const baseScale = OWN(transform, 'scale') ? transform.scale : 1;
  const scaleX = OWN(transform, 'scaleX') ? transform.scaleX : baseScale;
  const scaleY = OWN(transform, 'scaleY') ? transform.scaleY : baseScale;
  if (![dx, dy, rotate, scaleX, scaleY].every(Number.isFinite) || scaleX <= 0 || scaleY <= 0) {
    return { ok: false, reason: 'Transform offsets and rotation must be finite; scales must be positive.' };
  }
  const origin = transform.origin === undefined ? pointCentroid(points) : transform.origin;
  if (!validPoint(origin)) return { ok: false, reason: 'Transform origin must be a finite point.' };
  return { ok: true, value: { dx, dy, rotate, scaleX, scaleY, origin: { x: origin.x, y: origin.y } } };
}

function transformPoint(point, transform) {
  if (!transform) return { x: point.x, y: point.y };
  const lx = (point.x - transform.origin.x) * transform.scaleX;
  const ly = (point.y - transform.origin.y) * transform.scaleY;
  const ca = Math.cos(transform.rotate);
  const sa = Math.sin(transform.rotate);
  return {
    x: transform.origin.x + lx * ca - ly * sa + transform.dx,
    y: transform.origin.y + lx * sa + ly * ca + transform.dy,
  };
}

function prepareControlPointEdit(course, current, patch, { closed = true } = {}) {
  let points = OWN(patch, 'pts') ? patch.pts : current;
  const initial = validateControlPoints(course, points, { closed });
  if (!initial.ok) return initial;
  points = points.map((point) => ({ x: point.x, y: point.y }));
  const normalized = normalizeTransform(patch.transform, points);
  if (!normalized.ok) return normalized;
  if (normalized.value) points = points.map((point) => transformPoint(point, normalized.value));
  const final = validateControlPoints(course, points, { closed });
  if (!final.ok) return final;
  return { ok: true, points, transform: normalized.value };
}

function validatePatchKeys(patch, allowed) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, reason: 'Feature changes must be an object.' };
  }
  if (Object.keys(patch).some((key) => !allowed.has(key))) {
    return { ok: false, reason: 'Feature changes contain an unsupported value.' };
  }
  return { ok: true };
}

function featureIndex(items, ref, label) {
  if (ref == null) return { ok: false, reason: `Select a ${label} first.` };
  const selector = (typeof ref === 'object' && !Array.isArray(ref)) ? ref : { id: ref };
  if (OWN(selector, 'id')) {
    const index = items.findIndex((item) => item?.id === selector.id);
    return index === -1 ? { ok: false, reason: `No such ${label}.` } : { ok: true, index };
  }
  if (OWN(selector, 'index') && Number.isInteger(selector.index)
    && selector.index >= 0 && selector.index < items.length) {
    return { ok: true, index: selector.index };
  }
  return { ok: false, reason: `Invalid ${label} reference; use { id } or { index }.` };
}

function stableFeatureRef(feature, index) {
  return feature?.id === undefined ? { index } : { id: feature.id };
}

function normalizeContours(value, course) {
  if (value === null) return { ok: true, value: null };
  if (!Array.isArray(value)) return { ok: false, reason: 'Green contours must be an array.' };
  const contours = [];
  for (const contour of value) {
    if (!contour || typeof contour !== 'object'
      || !Number.isFinite(contour.x) || !Number.isFinite(contour.y)
      || !Number.isFinite(contour.r) || contour.r <= 0 || !Number.isFinite(contour.h)
      || contour.x < 0 || contour.y < 0 || contour.x > course.w || contour.y > course.h
      || (contour.role != null && typeof contour.role !== 'string')) {
      return { ok: false, reason: 'Green contours need finite in-bounds centers, positive radii, and finite heights.' };
    }
    contours.push({
      ...(contour.role == null ? {} : { role: contour.role }),
      x: contour.x, y: contour.y, r: contour.r, h: contour.h,
    });
  }
  return { ok: true, value: contours };
}

function transformedContours(contours, transform) {
  if (!transform || !Array.isArray(contours)) return contours;
  const radiusScale = Math.sqrt(transform.scaleX * transform.scaleY);
  return contours.map((contour) => ({
    ...contour,
    ...transformPoint(contour, transform),
    r: contour.r * radiusScale,
  }));
}

function transformHolePins(hole, transform) {
  if (!transform) return;
  if (hole.pin && validPoint(hole.pin)) hole.pin = transformPoint(hole.pin, transform);
  if (hole.pins && typeof hole.pins === 'object') {
    for (const key of Object.keys(hole.pins)) {
      const pin = hole.pins[key];
      if (validPoint(pin)) hole.pins[key] = transformPoint(pin, transform);
    }
  }
}

// Edit a vector green through the stable back-compat course hole record id.
// `pts` replaces the control boundary; transform values are deltas applied once.
export function editVectorGreen(state, session, holeId, patch) {
  const linked = vecHoleFromCourseRecord(state.course, holeId);
  if (!linked.ok) return linked;
  const keys = validatePatchKeys(patch, new Set(['pts', 'transform', 'fringe', 'apron', 'sculpt']));
  if (!keys.ok) return keys;
  const current = linked.vecHole.green;
  if (!current || !Array.isArray(current.pts)) return { ok: false, reason: 'This hole has no vector green.' };
  const geometry = prepareControlPointEdit(state.course, current.pts, patch);
  if (!geometry.ok) return geometry;
  const next = cloneJson(current);
  next.pts = geometry.points;
  const priorCenter = Number.isFinite(current.cx) && Number.isFinite(current.cy)
    ? { x: current.cx, y: current.cy }
    : pointCentroid(current.pts);
  const replacedBoundary = OWN(patch, 'pts') && !jsonEqual(current.pts, patch.pts);
  const boundaryChanged = !jsonEqual(current.pts, geometry.points);
  const center = geometry.transform
    ? transformPoint(replacedBoundary ? pointCentroid(patch.pts) : priorCenter, geometry.transform)
    : (boundaryChanged ? pointCentroid(next.pts) : priorCenter);
  next.cx = center.x;
  next.cy = center.y;
  if (geometry.transform) {
    if (Array.isArray(next.pins)) next.pins = next.pins.map((pin) => transformPoint(pin, geometry.transform));
    next.contours = transformedContours(next.contours, geometry.transform);
  }
  for (const field of ['fringe', 'apron']) {
    if (!OWN(patch, field)) continue;
    if (!Number.isFinite(patch[field]) || patch[field] < 0) {
      return { ok: false, reason: `${field[0].toUpperCase() + field.slice(1)} width must be a finite non-negative yard value.` };
    }
    next[field] = patch[field];
  }
  if (OWN(patch, 'sculpt')) {
    const sculpt = patch.sculpt;
    if (!sculpt || typeof sculpt !== 'object' || Array.isArray(sculpt)) {
      return { ok: false, reason: 'Green sculpt settings must be an object.' };
    }
    const allowed = new Set(['raise', 'tilt', 'tiltA', 'contours']);
    if (Object.keys(sculpt).some((key) => !allowed.has(key))) {
      return { ok: false, reason: 'Green sculpt settings contain an unsupported value.' };
    }
    for (const field of ['raise', 'tilt']) {
      if (!OWN(sculpt, field)) continue;
      if (!Number.isFinite(sculpt[field]) || sculpt[field] < 0) {
        return { ok: false, reason: `Green ${field} must be finite and non-negative.` };
      }
      next[field] = sculpt[field];
    }
    if (OWN(sculpt, 'tiltA')) {
      if (!Number.isFinite(sculpt.tiltA)) return { ok: false, reason: 'Green tilt angle must be finite.' };
      next.tiltA = sculpt.tiltA;
    }
    if (OWN(sculpt, 'contours')) {
      const contours = normalizeContours(sculpt.contours, state.course);
      if (!contours.ok) return contours;
      if (contours.value === null) delete next.contours;
      else next.contours = contours.value;
    }
  }
  const holeAfter = cloneJson(linked.courseHole);
  transformHolePins(holeAfter, geometry.transform);
  if (jsonEqual(current, next) && jsonEqual(linked.courseHole, holeAfter)) {
    return { ok: true, cost: 0, cells: 0, unchanged: true, green: current };
  }
  const result = vecOp(state, session, 'Edit green', () => {
    linked.vecHole.green = next;
    if (geometry.transform) {
      linked.courseHole.pin = holeAfter.pin;
      linked.courseHole.pins = holeAfter.pins;
    }
  }, { holeIds: [holeId] });
  return { ...result, green: linked.vecHole.green };
}

export function editVectorBunker(state, session, holeId, ref, patch) {
  const linked = vecHoleFromCourseRecord(state.course, holeId);
  if (!linked.ok) return linked;
  const items = Array.isArray(linked.vecHole.bunkers) ? linked.vecHole.bunkers : [];
  const found = featureIndex(items, ref, 'bunker');
  if (!found.ok) return found;
  const keys = validatePatchKeys(patch, new Set(['pts', 'transform', 'depth', 'lip']));
  if (!keys.ok) return keys;
  const current = items[found.index];
  const geometry = prepareControlPointEdit(state.course, current.pts, patch);
  if (!geometry.ok) return geometry;
  const next = { ...cloneJson(current), pts: geometry.points };
  for (const field of ['depth', 'lip']) {
    if (!OWN(patch, field)) continue;
    const minimum = field === 'depth' ? Number.EPSILON : 0;
    if (!Number.isFinite(patch[field]) || patch[field] < minimum) {
      return { ok: false, reason: `Bunker ${field} must be ${field === 'depth' ? 'positive' : 'non-negative'} and finite.` };
    }
    next[field] = patch[field];
  }
  if (jsonEqual(current, next)) {
    return { ok: true, cost: 0, cells: 0, unchanged: true, bunker: current, ref: stableFeatureRef(current, found.index) };
  }
  const result = vecOp(state, session, 'Edit bunker', () => { items[found.index] = next; });
  return { ...result, bunker: items[found.index], ref: stableFeatureRef(next, found.index) };
}

export function deleteVectorBunker(state, session, holeId, ref) {
  const linked = vecHoleFromCourseRecord(state.course, holeId);
  if (!linked.ok) return linked;
  const items = Array.isArray(linked.vecHole.bunkers) ? linked.vecHole.bunkers : [];
  const found = featureIndex(items, ref, 'bunker');
  if (!found.ok) return found;
  const removed = cloneJson(items[found.index]);
  const result = vecOp(state, session, 'Delete bunker', () => { items.splice(found.index, 1); });
  return { ...result, removed, ref: stableFeatureRef(removed, found.index) };
}

function normalizeShoreline(current, value) {
  if (value === null) return { ok: true, value: null };
  const patch = typeof value === 'string' ? { style: value } : value;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, reason: 'Shoreline settings must be a style or settings object.' };
  }
  const allowed = new Set(['style', 'widthYd', 'softness']);
  if (Object.keys(patch).some((key) => !allowed.has(key))) {
    return { ok: false, reason: 'Shoreline settings contain an unsupported value.' };
  }
  const next = current && typeof current === 'object' && !Array.isArray(current) ? cloneJson(current) : {};
  if (OWN(patch, 'style')) {
    if (!SHORELINE_STYLE_VALUES.has(patch.style)) return { ok: false, reason: 'Unsupported shoreline style.' };
    next.style = patch.style;
  }
  if (OWN(patch, 'widthYd')) {
    if (!Number.isFinite(patch.widthYd) || patch.widthYd < 0) {
      return { ok: false, reason: 'Shoreline width must be finite and non-negative.' };
    }
    next.widthYd = patch.widthYd;
  }
  if (OWN(patch, 'softness')) {
    if (!Number.isFinite(patch.softness) || patch.softness < 0 || patch.softness > 1) {
      return { ok: false, reason: 'Shoreline softness must be between 0 and 1.' };
    }
    next.softness = patch.softness;
  }
  return { ok: true, value: next };
}

export function editVectorWater(state, session, ref, patch) {
  const { course } = state;
  if (!editableVectorCourse(course)) return vectorUnsupported();
  const found = featureIndex(course.vec.waters, ref, 'water feature');
  if (!found.ok) return found;
  const keys = validatePatchKeys(patch, new Set(['pts', 'transform', 'depth', 'shoreline']));
  if (!keys.ok) return keys;
  const current = course.vec.waters[found.index];
  const geometry = prepareControlPointEdit(course, current.pts, patch);
  if (!geometry.ok) return geometry;
  const next = { ...cloneJson(current), pts: geometry.points };
  if (!jsonEqual(current.pts, geometry.points)) next.surface = 'outline';
  if (OWN(patch, 'depth')) {
    if (!Number.isFinite(patch.depth) || patch.depth <= 0) {
      return { ok: false, reason: 'Water depth must be positive and finite.' };
    }
    next.depth = patch.depth;
  }
  if (OWN(patch, 'shoreline')) {
    const shoreline = normalizeShoreline(current.shoreline, patch.shoreline);
    if (!shoreline.ok) return shoreline;
    if (shoreline.value === null) delete next.shoreline;
    else next.shoreline = shoreline.value;
  }
  if (jsonEqual(current, next)) {
    return { ok: true, cost: 0, cells: 0, unchanged: true, water: current, ref: stableFeatureRef(current, found.index) };
  }
  const result = vecOp(state, session, 'Edit water', () => { course.vec.waters[found.index] = next; });
  return { ...result, water: course.vec.waters[found.index], ref: stableFeatureRef(next, found.index) };
}

export function deleteVectorWater(state, session, ref) {
  const { course } = state;
  if (!editableVectorCourse(course)) return vectorUnsupported();
  const found = featureIndex(course.vec.waters, ref, 'water feature');
  if (!found.ok) return found;
  const removed = cloneJson(course.vec.waters[found.index]);
  const result = vecOp(state, session, 'Delete water', () => { course.vec.waters.splice(found.index, 1); });
  return { ...result, removed, ref: stableFeatureRef(removed, found.index) };
}

export function editVectorStream(state, session, ref, patch) {
  const { course } = state;
  if (!editableVectorCourse(course)) return vectorUnsupported();
  const streams = Array.isArray(course.vec.streams) ? course.vec.streams : [];
  const found = featureIndex(streams, ref, 'stream');
  if (!found.ok) return found;
  const keys = validatePatchKeys(patch, new Set(['pts', 'transform', 'width', 'depth']));
  if (!keys.ok) return keys;
  const current = streams[found.index];
  const geometry = prepareControlPointEdit(course, current.pts, patch, { closed: false });
  if (!geometry.ok) return geometry;
  const next = { ...cloneJson(current), pts: geometry.points };
  if (OWN(patch, 'width')) {
    if (!Number.isFinite(patch.width) || patch.width <= 0) {
      return { ok: false, reason: 'Stream width must be positive and finite.' };
    }
    next.w = patch.width;
  }
  if (OWN(patch, 'depth')) {
    if (!Number.isFinite(patch.depth) || patch.depth <= 0) {
      return { ok: false, reason: 'Stream depth must be positive and finite.' };
    }
    next.depth = patch.depth;
  }
  if (jsonEqual(current, next)) {
    return { ok: true, cost: 0, cells: 0, unchanged: true, stream: current, ref: stableFeatureRef(current, found.index) };
  }
  const result = vecOp(state, session, 'Edit stream', () => { streams[found.index] = next; });
  return { ...result, stream: streams[found.index], ref: stableFeatureRef(next, found.index) };
}

export function deleteVectorStream(state, session, ref) {
  const { course } = state;
  if (!editableVectorCourse(course)) return vectorUnsupported();
  const streams = Array.isArray(course.vec.streams) ? course.vec.streams : [];
  const found = featureIndex(streams, ref, 'stream');
  if (!found.ok) return found;
  const removed = cloneJson(streams[found.index]);
  const result = vecOp(state, session, 'Delete stream', () => { streams.splice(found.index, 1); });
  return { ...result, removed, ref: stableFeatureRef(removed, found.index) };
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
export function objectPlacementOk(course, type, x, y, {
  scale = 1, ignoreId = null, clearanceYd = 0.5,
} = {}) {
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
  const collision = objectCollisionOk(course, type, x, y, { scale, ignoreId, clearanceYd });
  if (!collision.ok) return collision;
  return { ok: true };
}

export function addObject(state, session, type, x, y, { rot = 0, scale = 1 } = {}) {
  const { course } = state;
  const legal = objectPlacementOk(course, type, x, y, { scale });
  if (!legal.ok) return legal;
  const nextObjectIdBefore = course.nextObjectId;
  const obj = { id: course.nextObjectId++, type, x, y, rot, scale };
  course.objects.push(obj);
  pushOp(state, session, {
    kind: 'object-add', label: 'Place object', cost: objectCostOf(type), cells: null, object: { ...obj },
    nextObjectIdBefore, nextObjectIdAfter: course.nextObjectId,
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

export function beginObjectGesture(state, id, label = 'Move object') {
  const obj = findObject(state.course, id);
  if (!obj) return null;
  return { id, label, before: { ...obj } };
}

export function previewObjectGesture(state, gesture, patch) {
  const obj = gesture && findObject(state.course, gesture.id);
  if (!obj) return { ok: false, reason: 'No such object.' };
  if (patch.x !== undefined || patch.y !== undefined || patch.scale !== undefined) {
    const legal = objectPlacementOk(state.course, obj.type, patch.x ?? obj.x, patch.y ?? obj.y, {
      scale: patch.scale ?? obj.scale,
      ignoreId: obj.id,
    });
    if (!legal.ok) return legal;
  }
  Object.assign(obj, patch);
  return { ok: true, cost: 0, object: obj };
}

export function endObjectGesture(state, session, gesture) {
  const obj = gesture && findObject(state.course, gesture.id);
  if (!obj) return { ok: false, reason: 'No such object.' };
  const after = { ...obj };
  const keys = new Set([...Object.keys(gesture.before), ...Object.keys(after)]);
  if ([...keys].every((key) => Object.is(gesture.before[key], after[key]))) {
    return { ok: true, cost: 0, unchanged: true };
  }
  pushOp(state, session, {
    kind: 'object-move', label: gesture.label, cost: 0, cells: null,
    id: gesture.id, before: gesture.before, after,
  });
  return { ok: true, cost: 0 };
}

export function moveObject(state, session, id, patch) {
  const gesture = beginObjectGesture(state, id);
  if (!gesture) return { ok: false, reason: 'No such object.' };
  const preview = previewObjectGesture(state, gesture, patch);
  if (!preview.ok) return preview;
  return endObjectGesture(state, session, gesture);
}

export function duplicateObject(state, session, id) {
  const { course } = state;
  const obj = findObject(course, id);
  if (!obj) return { ok: false, reason: 'No such object.' };
  const radiusYd = objectCollisionRadiusYd(obj.type, obj.scale) || 1.35;
  const firstRingCells = Math.max(1, (radiusYd * 2 + 0.5) / CELL_YD);
  for (let ring = 1; ring <= 4; ring += 1) {
    const distance = firstRingCells * ring;
    for (let index = 0; index < 12; index += 1) {
      const angle = Math.PI / 4 + index * Math.PI / 6;
      const x = obj.x + Math.cos(angle) * distance;
      const y = obj.y + Math.sin(angle) * distance;
      const legal = objectPlacementOk(course, obj.type, x, y, { scale: obj.scale });
      if (!legal.ok) continue;
      return addObject(state, session, obj.type, x, y, {
        rot: obj.rot + 0.6,
        scale: obj.scale,
      });
    }
  }
  return { ok: false, reason: 'No collision-free room near that object.' };
}

// Assisted landscaping: scatter a category over a disk, respecting legality.
// Returns the created objects so the UI can preview-then-commit or undo once.
export function scatterObjects(state, session, types, cx, cy, {
  radius = 4, count = 8, rng = Math.random, scaleMin = 0.85, scaleMax = 1.25,
} = {}) {
  const created = [];
  let cost = 0;
  const { course } = state;
  const nextObjectIdBefore = course.nextObjectId;
  for (let k = 0; k < count * 3 && created.length < count; k++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const type = types[Math.floor(rng() * types.length)];
    const rot = rng() * Math.PI * 2;
    const scale = scaleMin + rng() * (scaleMax - scaleMin);
    if (!objectPlacementOk(course, type, x, y, { scale }).ok) continue;
    const obj = { id: course.nextObjectId++, type, x, y, rot, scale };
    course.objects.push(obj);
    created.push({ ...obj });
    cost += objectCostOf(type);
  }
  if (!created.length) return { ok: false, reason: 'No room here.' };
  pushOp(state, session, {
    kind: 'object-scatter', label: 'Landscaping', cost, cells: null, objects: created,
    nextObjectIdBefore, nextObjectIdAfter: course.nextObjectId,
  });
  return { ok: true, cost, count: created.length };
}

// --- paths -----------------------------------------------------------------------------

function normalizeBridge(current, value) {
  if (value === null || value === false) return { ok: true, value: null };
  if (value === true) return { ok: true, value: true };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'Bridge settings must be a boolean or settings object.' };
  }
  const allowed = new Set([
    'enabled', 'startT', 'endT', 'deckHeightFt', 'clearanceFt',
    'supportSpacingYd', 'railings', 'deckMaterial',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return { ok: false, reason: 'Bridge settings contain an unsupported value.' };
  }
  const next = current && typeof current === 'object' && !Array.isArray(current) ? cloneJson(current) : {};
  for (const field of ['enabled', 'railings']) {
    if (OWN(value, field)) {
      if (typeof value[field] !== 'boolean') return { ok: false, reason: `Bridge ${field} must be true or false.` };
      next[field] = value[field];
    }
  }
  for (const field of ['startT', 'endT']) {
    if (OWN(value, field)) {
      if (!Number.isFinite(value[field]) || value[field] < 0 || value[field] > 1) {
        return { ok: false, reason: `Bridge ${field} must be between 0 and 1.` };
      }
      next[field] = value[field];
    }
  }
  if (Number.isFinite(next.startT) && Number.isFinite(next.endT) && next.startT >= next.endT) {
    return { ok: false, reason: 'Bridge start must come before bridge end.' };
  }
  for (const field of ['deckHeightFt', 'clearanceFt']) {
    if (OWN(value, field)) {
      if (!Number.isFinite(value[field]) || value[field] < 0) {
        return { ok: false, reason: `Bridge ${field} must be finite and non-negative.` };
      }
      next[field] = value[field];
    }
  }
  if (OWN(value, 'supportSpacingYd')) {
    if (!Number.isFinite(value.supportSpacingYd) || value.supportSpacingYd <= 0) {
      return { ok: false, reason: 'Bridge support spacing must be positive and finite.' };
    }
    next.supportSpacingYd = value.supportSpacingYd;
  }
  if (OWN(value, 'deckMaterial')) {
    if (!BRIDGE_DECK_MATERIAL_VALUES.has(value.deckMaterial)) {
      return { ok: false, reason: 'Unsupported bridge deck material.' };
    }
    next.deckMaterial = value.deckMaterial;
  }
  return { ok: true, value: next };
}

function validatePathWidthMaterial(width, material) {
  if (!Number.isFinite(width) || width <= 0) return { ok: false, reason: 'Path width must be positive and finite.' };
  if (!PATH_MATERIAL_VALUES.has(material)) return { ok: false, reason: 'Unsupported path material.' };
  return { ok: true };
}

export function addPath(state, session, pts, { width = 2.6, material = 'asphalt', bridge = null } = {}) {
  const { course } = state;
  if (!editableVectorCourse(course)) {
    return vectorUnsupported('Path construction is unavailable for legacy grid courses.');
  }
  const points = validateControlPoints(course, pts, { closed: false });
  if (!points.ok) return points;
  const dimensions = validatePathWidthMaterial(width, material);
  if (!dimensions.ok) return dimensions;
  const bridgeSettings = normalizeBridge(null, bridge);
  if (!bridgeSettings.ok) return bridgeSettings;
  let path = null;
  const res = pathOp(state, session, 'Path', () => {
    path = { id: course.nextPathId++, pts: pts.map((p) => ({ x: p.x, y: p.y })), width, material };
    if (bridgeSettings.value !== null) path.bridge = bridgeSettings.value;
    course.paths.push(path);
  }, { chargeNewPavement: true });
  return { ...res, path };
}

export function editPath(state, session, id, patch) {
  const { course } = state;
  if (!editableVectorCourse(course)) {
    return vectorUnsupported('Path editing is unavailable for legacy grid courses.');
  }
  const path = findPath(course, id);
  if (!path) return { ok: false, reason: 'No such path.' };
  const keys = validatePatchKeys(patch, new Set(['pts', 'width', 'material', 'bridge']));
  if (!keys.ok) return keys;
  const next = cloneJson(path);
  if (OWN(patch, 'pts')) {
    const points = validateControlPoints(course, patch.pts, { closed: false });
    if (!points.ok) return points;
    next.pts = patch.pts.map((point) => ({ x: point.x, y: point.y }));
  }
  if (OWN(patch, 'width')) next.width = patch.width;
  if (OWN(patch, 'material')) next.material = patch.material;
  const dimensions = validatePathWidthMaterial(next.width, next.material);
  if (!dimensions.ok) return dimensions;
  if (OWN(patch, 'bridge')) {
    const bridge = normalizeBridge(path.bridge, patch.bridge);
    if (!bridge.ok) return bridge;
    if (bridge.value === null) delete next.bridge;
    else next.bridge = bridge.value;
  }
  if (jsonEqual(path, next)) return { ok: true, cost: 0, cells: 0, unchanged: true, path };
  return pathOp(state, session, 'Edit path', () => {
    Object.assign(path, next);
    if (!OWN(next, 'bridge')) delete path.bridge;
  }, { chargeNewPavement: true });
}

// Path-point dragging previews directly against the live spline. Restore the
// captured geometry before committing so pathOp records a true before/after
// pair and the whole drag remains one exact undo step.
export function commitPathPointDrag(state, session, id, originalPts, previewPts) {
  const path = findPath(state.course, id);
  if (!path) return { ok: false, reason: 'No such path.' };
  if (!editableVectorCourse(state.course)) {
    return vectorUnsupported('Path editing is unavailable for legacy grid courses.');
  }
  const before = validateControlPoints(state.course, originalPts, { closed: false });
  if (!before.ok) return before;
  const after = validateControlPoints(state.course, previewPts, { closed: false });
  if (!after.ok) return after;
  path.pts = originalPts.map((p) => ({ x: p.x, y: p.y }));
  return editPath(state, session, id, { pts: previewPts });
}

export function removePath(state, session, id) {
  const { course } = state;
  if (!editableVectorCourse(course)) {
    return vectorUnsupported('Path removal is unavailable for legacy grid courses.');
  }
  if (!findPath(course, id)) return { ok: false, reason: 'No such path.' };
  return pathOp(state, session, 'Remove path', () => {
    course.paths = course.paths.filter((p) => p.id !== id);
  });
}

// --- holes ------------------------------------------------------------------------------

export function newHole(state, session) {
  const { course } = state;
  const nextHoleIdBefore = course.nextHoleId;
  const hole = addHole(course);
  ensureHoleShape(hole, course.holes.length);
  pushOp(state, session, {
    kind: 'hole-add', label: 'New hole', cost: BALANCE.newHoleCost, cells: null,
    holeId: hole.id, hole: cloneJson(hole), at: course.holes.length - 1,
    nextHoleIdBefore, nextHoleIdAfter: course.nextHoleId,
  });
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
      if (Number.isInteger(op.nextObjectIdBefore)) course.nextObjectId = op.nextObjectIdBefore;
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
      if (Number.isInteger(op.nextObjectIdBefore)) course.nextObjectId = op.nextObjectIdBefore;
      break;
    case 'path':
      applyCellsBackward(state, op.cells);
      state.course.paths = JSON.parse(JSON.stringify(op.pathsBefore));
      if (Number.isInteger(op.nextPathIdBefore)) course.nextPathId = op.nextPathIdBefore;
      if (course.vec) invalidateGeom(course);
      break;
    case 'vec':
      applyCellsBackward(state, op.cells);
      course.vec = JSON.parse(JSON.stringify(op.vecBefore));
      if (op.paintBefore) course.paint = Uint8Array.from(op.paintBefore);
      else if (op.paintBeforePresent === false) delete course.paint;
      restoreHoleRecords(course, op.holesBefore);
      invalidateGeom(course);
      break;
    case 'vector-paint':
      applyCellsBackward(state, op.cells);
      for (const change of op.paintChanges) course.paint[change.i] = change.before;
      if (!op.paintPresentBefore) delete course.paint;
      break;
    case 'hole-add':
      course.holes = course.holes.filter((h) => h.id !== op.holeId);
      if (Number.isInteger(op.nextHoleIdBefore)) course.nextHoleId = op.nextHoleIdBefore;
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
      if (Number.isInteger(op.nextObjectIdAfter)) course.nextObjectId = op.nextObjectIdAfter;
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
      if (Number.isInteger(op.nextObjectIdAfter)) course.nextObjectId = op.nextObjectIdAfter;
      break;
    case 'path':
      applyCellsForward(state, op.cells);
      state.course.paths = JSON.parse(JSON.stringify(op.pathsAfter));
      if (Number.isInteger(op.nextPathIdAfter)) course.nextPathId = op.nextPathIdAfter;
      if (course.vec) invalidateGeom(course);
      break;
    case 'vec':
      applyCellsForward(state, op.cells);
      course.vec = JSON.parse(JSON.stringify(op.vecAfter));
      if (op.paintAfter) course.paint = Uint8Array.from(op.paintAfter);
      else if (op.paintAfterPresent === false) delete course.paint;
      restoreHoleRecords(course, op.holesAfter);
      invalidateGeom(course);
      break;
    case 'vector-paint':
      applyCellsForward(state, op.cells);
      for (const change of op.paintChanges) ensurePaint(course)[change.i] = change.after;
      break;
    case 'hole-add': {
      const hole = op.hole ? cloneJson(op.hole) : ensureHoleShape({ id: op.holeId }, op.at + 1);
      course.holes.splice(Math.min(op.at ?? course.holes.length, course.holes.length), 0, hole);
      if (Number.isInteger(op.nextHoleIdAfter)) course.nextHoleId = op.nextHoleIdAfter;
      else course.nextHoleId = Math.max(course.nextHoleId, op.holeId + 1);
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

// Bounding rect (cells) of the cells an op touched, so undo/redo can scope the
// renderer refresh instead of rebuilding the course. Ops that carry no cells —
// object placement, hole settings, pin/tee selection — return null, and the
// caller falls back to a full refresh.
export function opCellRect(state, op) {
  const cells = op?.cells;
  const w = state.course.w;
  const explicit = op?.rect;
  let x0 = Number.isFinite(explicit?.x0) ? explicit.x0 : Infinity;
  let y0 = Number.isFinite(explicit?.y0) ? explicit.y0 : Infinity;
  let x1 = Number.isFinite(explicit?.x1) ? explicit.x1 : -Infinity;
  let y1 = Number.isFinite(explicit?.y1) ? explicit.y1 : -Infinity;
  for (const cell of cells || []) {
    const i = cell.i;
    if (!Number.isInteger(i)) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

function opObjectTypes(op) {
  if (!op || !String(op.kind || '').startsWith('object-')) return [];
  const types = [];
  if (op.object?.type) types.push(op.object.type);
  if (op.before?.type) types.push(op.before.type);
  if (op.after?.type) types.push(op.after.type);
  for (const object of op.objects || []) if (object?.type) types.push(object.type);
  return [...new Set(types)];
}

export function undo(state, session) {
  const op = session.undo.pop();
  if (!op) return { ok: false };
  const rect = opCellRect(state, op);
  invertOp(state, session, op);
  session.redo.push(op);
  session.bill = Math.max(0, session.bill - op.cost);
  refreshChangedCells(state, session);
  return { ok: true, label: op.label, kind: op.kind, rect, objectTypes: opObjectTypes(op) };
}

export function redo(state, session) {
  const op = session.redo.pop();
  if (!op) return { ok: false };
  const rect = opCellRect(state, op);
  replayOp(state, session, op);
  session.undo.push(op);
  session.bill += op.cost;
  refreshChangedCells(state, session);
  return { ok: true, label: op.label, kind: op.kind, rect, objectTypes: opObjectTypes(op) };
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
  // Preserve only the renderer-facing invalidation metadata. Returning compact
  // summaries lets the UI restore the visible course in bounded regional work
  // instead of paying one whole-course rebuild after the data is rolled back.
  const operations = session.undo.map((op) => {
    const summary = { kind: op.kind, rect: opCellRect(state, op) };
    const objectTypes = opObjectTypes(op);
    if (objectTypes.length) summary.objectTypes = objectTypes;
    return summary;
  });

  // Roll back directly rather than calling undo(): undo() recomputes the net
  // changed-cell set after every operation. That turns a long-session Discard
  // into quadratic bookkeeping even though the set is cleared at the end.
  while (session.undo.length) {
    const op = session.undo.pop();
    invertOp(state, session, op);
  }
  const baseline = session.baselineIdentity;
  if (baseline) {
    state.course.nextHoleId = baseline.nextHoleId;
    state.course.nextObjectId = baseline.nextObjectId;
    state.course.nextPathId = baseline.nextPathId;
    if (state.course.vec && Number.isFinite(baseline.nextVectorId)) {
      state.course.vec.nextId = baseline.nextVectorId;
    }
    if (!baseline.paintPresent) delete state.course.paint;
  }
  session.redo.length = 0;
  session.bill = 0;
  session.changedCells.clear();
  state.sections = baseline?.sections ? cloneJson(baseline.sections) : labelSections(state.course);
  return { ok: true, operations };
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
  const treeCount = course.objects.filter((o) => TREE_OBJECT_TYPES.has(o.type)).length;
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
