// GOLF EMPIRE — the course editor: UI shell + input controller + playtest.
//
// Layout follows the simpler course-editor reference: a top bar (Playtest,
// Undo, Redo, Save, the pending bill, money, daylight preview), a left tool
// rail (Select / Terrain / Paint / Tee / Green / Bunker / Water / Objects /
// Paths / Measure) whose ACTIVE tool shows its few controls beneath it, a TIP
// box, a bottom control-hint bar, and a compass. Hole selection is a card grid;
// hole settings a small dialog; statistics a toggleable panel.
//
// All simulation goes through sim/courseEditor.js (undo/redo, exactly-once
// billing) and sim/playtest.js (the ball). This file owns DOM + pointer input.

import { el, toast } from './ui.js';
import { t } from '../core/i18n.js';
import { ZONE, HOLE_STATUS, CELL_YD } from '../sim/constants.js';
import { holeNumber, holePar, holeDistanceYd, ensureHoleShape } from '../sim/course.js';
import { ZONE_COLORS } from '../render/palette.js';
import { formatMoney, clamp, distToSegment } from '../core/utils.js';
import {
  makeEditSession, sessionDirty,
  beginTerrainStroke, sculptAt, endTerrainStroke,
  beginPaintStroke, paintAt, endPaintStroke,
  stampGreen, stampBunker, stampWater, stampStream, stampTee, featurePlacementOk, setPinPosition, selectPin, selectTee,
  editVectorGreen, editVectorBunker, deleteVectorBunker, editVectorWater, deleteVectorWater,
  editVectorStream, deleteVectorStream,
  addObject, removeObject, beginObjectGesture, previewObjectGesture, endObjectGesture,
  duplicateObject, scatterObjects, objectPlacementOk, objectPlacementRotation,
  OBJECT_CATALOG, objectCostOf,
  addPath, editPath, removePath,
  newHole, deleteHole, setHoleSettings, reorderHole,
  undo, redo, applySession, discardSession,
  measure, courseStats, zoneCost, constructionImpact,
} from '../sim/courseEditor.js';
import {
  startPlaytest, strike, stepBall, remainingYd, playtestHud, suggestClub, CLUBS,
} from '../sim/playtest.js';
import {
  COURSE_CAMERA_VIEW_OPTIONS,
  FLYOVER_CAMERA_VIEW,
  normalizeCourseCameraView,
  beginCourseCameraFlyover,
  advanceCourseCameraFlyover,
  courseCameraFlyoverLabel,
} from './courseCameraState.js';
import { sampleOpen } from '../sim/courseVec.js';
import { buildCourseEditorPreviewGeometry } from '../render3d/courseEditorPreviewGeometry.js';
import { snapCoursePoint, objectCollisionRadiusYd } from '../sim/courseEditorObjectPlacement.js';

// Monochrome stroke icons (no emoji — the reference UI is quiet and premium).
// Each icon is a list of [tag, attrs] built with createElementNS: no HTML parsing.
const ICONS = {
  select: [['path', { d: 'M4 2l9 7-4.2 1L7 14z' }]],
  terrain: [['path', { d: 'M1.5 13L6 5l3 4.6L11 6l3.5 7z' }]],
  paint: [['path', { d: 'M9.5 2.5l4 4L7 13H3v-4z' }], ['path', { d: 'M11 8L8 5' }]],
  tee: [['path', { d: 'M4.5 4h7M8 4v6.5M6.5 13h3M8 10.5V13' }], ['circle', { cx: '8', cy: '2.4', r: '1.1' }]],
  green: [['path', { d: 'M5 14V3' }], ['path', { d: 'M5 3.6h6.5L9.5 6l2 2.4H5' }], ['path', { d: 'M2.5 14h7' }]],
  bunker: [['path', { d: 'M2 11.5q6-7.5 12 0' }], ['path', { d: 'M5 13.4h.01M8 12.8h.01M11 13.4h.01' }]],
  water: [['path', { d: 'M8 2.2c2.8 3.6 4.6 5.6 4.6 8a4.6 4.6 0 11-9.2 0c0-2.4 1.8-4.4 4.6-8z' }]],
  objects: [['path', { d: 'M8 2l4 5.4H4z' }], ['path', { d: 'M8 6.6l3.2 4.6H4.8z' }], ['path', { d: 'M8 11.2V14' }]],
  paths: [['path', { d: 'M2 14c4.5-3.5 5-6.5 12-10', 'stroke-dasharray': '2.6 2' }]],
  measure: [['path', { d: 'M3.5 12.5l9-9' }], ['path', { d: 'M5.5 10.5l1.2 1.2M7.5 8.5l1.2 1.2M9.5 6.5l1.2 1.2' }]],
  play: [['path', { d: 'M5.5 3.2l7.5 4.8-7.5 4.8z' }]],
  undo: [['path', { d: 'M6.5 3.5L3 7l3.5 3.5' }], ['path', { d: 'M3 7h6a4 4 0 014 4v1.5' }]],
  redo: [['path', { d: 'M9.5 3.5L13 7l-3.5 3.5' }], ['path', { d: 'M13 7H7a4 4 0 00-4 4v1.5' }]],
  save: [['path', { d: 'M3 3h8.5L13 4.5V13H3z' }], ['path', { d: 'M5 3v3.5h5V3' }], ['path', { d: 'M5 13v-4h6v4' }]],
  holes: [['path', { d: 'M6 14V4' }], ['path', { d: 'M6 4.5h5L9.4 6.4 11 8.3H6' }]],
  stats: [['path', { d: 'M3.5 13V8.5M7.5 13V4M11.5 13V6.5' }], ['path', { d: 'M2 13.5h12' }]],
  exit: [['path', { d: 'M4 4l8 8M12 4l-8 8' }]],
  frame: [['path', { d: 'M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3' }]],
  // a flight path climbing away from the tee, with its heading arrow
  flyover: [['path', { d: 'M1.5 12.5C5.5 12 10 9.5 13.5 4.5' }], ['path', { d: 'M10.2 4.6h3.6v3.5' }]],
  shrub: [['path', { d: 'M4.5 13c-2-1.5-2-4.5.5-5.5C4.5 4.5 7 3.5 8 5c1-1.5 3.5-.5 3 2.5 2.5 1 2.5 4 .5 5.5z' }], ['path', { d: 'M8 13v1.5' }]],
  rock: [['path', { d: 'M3 12l1.5-4.5L8 5l4 1.5L13.5 12z' }], ['path', { d: 'M8 5l1 7' }]],
  prop: [['path', { d: 'M3 12.5V9.5h10v3' }], ['path', { d: 'M4 9.5V6h8v3.5' }], ['path', { d: 'M4.5 12.5v1M11.5 12.5v1' }]],
  decor: [['circle', { cx: '8', cy: '5', r: '2.4' }], ['path', { d: 'M8 7.5V12' }], ['path', { d: 'M5.5 13.5h5' }]],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgIcon(name) {
  const span = el('span', { class: 'ced-ico' });
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name] || ICONS.select) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  span.append(svg);
  return span;
}

const TOOLS = [
  { key: 'select', icon: 'select', label: 'Select' },
  { key: 'terrain', icon: 'terrain', label: 'Terrain' },
  { key: 'paint', icon: 'paint', label: 'Paint' },
  { key: 'tee', icon: 'tee', label: 'Tee' },
  { key: 'green', icon: 'green', label: 'Green' },
  { key: 'bunker', icon: 'bunker', label: 'Bunker' },
  { key: 'water', icon: 'water', label: 'Water' },
  { key: 'objects', icon: 'objects', label: 'Objects' },
  { key: 'paths', icon: 'paths', label: 'Paths' },
  { key: 'measure', icon: 'measure', label: 'Measure' },
];
const TERRAIN_SOFT_MODES = new Set(['smooth', 'blend', 'erode']);
const TERRAIN_SELF_FINISHING_MODES = new Set(['smooth', 'flatten', 'plateau', 'blend', 'erode']);

const CAMERA_VIEWS = COURSE_CAMERA_VIEW_OPTIONS;

const PAINT_SURFACES = [
  { zone: ZONE.FAIRWAY, label: 'Fairway' },
  { zone: ZONE.SEMI, label: 'First cut' },
  { zone: ZONE.ROUGH, label: 'Rough' },
  { zone: ZONE.HEAVY, label: 'Heavy rough' },
  { zone: ZONE.FRINGE, label: 'Fringe' },
  { zone: ZONE.GREEN, label: 'Green' },
  { zone: ZONE.TEE, label: 'Tee grass' },
  { zone: ZONE.OUT, label: 'Native' },
  { zone: ZONE.DIRT, label: 'Dirt' },
  { zone: ZONE.BED, label: 'Planting bed' },
];

const EXTRA_ZONE_COLORS = {
  [ZONE.FRINGE]: '#89c46a',
  [ZONE.HEAVY]: '#6f7b3c',
  [ZONE.DIRT]: '#8a6f4d',
  [ZONE.BED]: '#5d4630',
  [ZONE.SEMI]: '#6f9c4e',
};
const zoneColor = (z) => EXTRA_ZONE_COLORS[z] || ZONE_COLORS[z] || '#888';

const OBJ_ICON = { tree: 'objects', shrub: 'shrub', rock: 'rock', prop: 'prop', decor: 'decor' };

export function vectorHoleForRecord(course, hole) {
  const vectorHoles = course?.vec?.holes || [];
  // Vector IDs share the vector feature sequence with bunkers/water, while
  // back-compat hole-record IDs are simple 1..N values. An OR predicate can
  // therefore match an earlier hole-record ID before reaching the true vecId
  // (for example H4 record id 4 used to display H2 vector id 4).
  if (hole?.vecId != null) {
    const authored = vectorHoles.find((candidate) => candidate.id === hole.vecId);
    if (authored) return authored;
  }
  return vectorHoles.find((candidate) => candidate.id === hole?.id) || null;
}

export function editorFeatureRef(feature, index) {
  return feature?.id === undefined ? { index } : { id: feature.id };
}

export function editorFeatureRefEqual(a, b) {
  if (!a || !b) return false;
  if (Object.prototype.hasOwnProperty.call(a, 'id')
    || Object.prototype.hasOwnProperty.call(b, 'id')) return a.id === b.id;
  return a.index === b.index;
}

export function editorFeatureByRef(features, ref) {
  if (!Array.isArray(features) || !ref) return null;
  if (Object.prototype.hasOwnProperty.call(ref, 'id')) {
    const index = features.findIndex((feature) => feature?.id === ref.id);
    return index < 0 ? null : { feature: features[index], index };
  }
  const index = Number(ref.index);
  return Number.isInteger(index) && index >= 0 && index < features.length
    ? { feature: features[index], index }
    : null;
}

function pointInEditorPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if ((a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

function editorBoundaryDistance(points, x, y) {
  if (!Array.isArray(points) || points.length < 3) return Infinity;
  if (pointInEditorPolygon(x, y, points)) return 0;
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    best = Math.min(best, distToSegment(x, y, points[j].x, points[j].y, points[i].x, points[i].y));
  }
  return best;
}

function editorPolylineDistance(points, x, y) {
  if (!Array.isArray(points) || points.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distToSegment(
      x, y,
      points[i - 1].x, points[i - 1].y,
      points[i].x, points[i].y,
    ));
  }
  return best;
}

// Spatial selection authority for ground clicks. It measures every eligible
// boundary and returns the genuinely nearest feature rather than array order.
export function nearestEditorVectorFeature(features, x, y, maxDistance = Infinity) {
  let best = null;
  for (let index = 0; index < (features || []).length; index++) {
    const feature = features[index];
    const distance = editorBoundaryDistance(feature?.pts, x, y);
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { feature, index, ref: editorFeatureRef(feature, index), distance };
    }
  }
  return best;
}

// Streams are open centerlines, so they must not use polygon containment or
// the implicit last-to-first edge used by pond/bunker/green boundaries.
export function nearestEditorPolylineFeature(features, x, y, maxDistance = Infinity) {
  let best = null;
  for (let index = 0; index < (features || []).length; index++) {
    const feature = features[index];
    const distance = editorPolylineDistance(feature?.pts, x, y);
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { feature, index, ref: editorFeatureRef(feature, index), distance };
    }
  }
  return best;
}

export function nearestEditorControlPoint(points, x, y, maxDistance = Infinity) {
  let best = null;
  for (let index = 0; index < (points || []).length; index++) {
    const distance = Math.hypot(points[index].x - x, points[index].y - y);
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { index, point: points[index], distance };
    }
  }
  return best;
}

export function movedEditorControlPoints(points, index, nextPoint) {
  if (!Array.isArray(points) || !Number.isInteger(index) || index < 0 || index >= points.length
    || !Number.isFinite(nextPoint?.x) || !Number.isFinite(nextPoint?.y)) return null;
  return points.map((point, pointIndex) => (
    pointIndex === index ? { x: nextPoint.x, y: nextPoint.y } : { x: point.x, y: point.y }
  ));
}

// The retained preview renderer accepts a closed outline. Turn an authored
// stream centerline into a narrow ribbon while keeping its handles on the
// original points that the stream CRUD API owns.
export function editorStreamRibbon(points, widthYd, cellYd = CELL_YD) {
  if (!Array.isArray(points) || points.length < 2
    || !Number.isFinite(widthYd) || widthYd <= 0
    || !Number.isFinite(cellYd) || cellYd <= 0) return [];
  const halfWidthCells = Math.max(0.025, widthYd / cellYd / 2);
  const left = [];
  const right = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    let dx = after.x - before.x;
    let dy = after.y - before.y;
    let length = Math.hypot(dx, dy);
    if (length < 1e-8 && index > 0) {
      dx = point.x - points[index - 1].x;
      dy = point.y - points[index - 1].y;
      length = Math.hypot(dx, dy);
    }
    if (length < 1e-8 && index + 1 < points.length) {
      dx = points[index + 1].x - point.x;
      dy = points[index + 1].y - point.y;
      length = Math.hypot(dx, dy);
    }
    if (length < 1e-8) return [];
    const nx = -dy / length;
    const ny = dx / length;
    left.push({ x: point.x + nx * halfWidthCells, y: point.y + ny * halfWidthCells });
    right.push({ x: point.x - nx * halfWidthCells, y: point.y - ny * halfWidthCells });
  }
  return [...left, ...right.reverse()];
}

export function editorGreenContourPreset(green, preset) {
  if (preset === 'none') return null;
  const points = green?.pts || [];
  if (!points.length || !Number.isFinite(green?.cx) || !Number.isFinite(green?.cy)) return null;
  const radius = Math.max(0.3, points.reduce((sum, point) => (
    sum + Math.hypot(point.x - green.cx, point.y - green.cy)
  ), 0) / points.length * 0.36);
  const angle = Number.isFinite(green.tiltA) ? green.tiltA : 0;
  const dx = Math.cos(angle + Math.PI / 2) * radius * 0.8;
  const dy = Math.sin(angle + Math.PI / 2) * radius * 0.8;
  if (preset === 'soft-roll') {
    return [{ role: 'editor-soft-roll', x: green.cx + dx * 0.55, y: green.cy + dy * 0.55, r: radius, h: 0.2 }];
  }
  if (preset === 'saddle') {
    return [
      { role: 'editor-saddle-high', x: green.cx + dx, y: green.cy + dy, r: radius, h: 0.18 },
      { role: 'editor-saddle-low', x: green.cx - dx, y: green.cy - dy, r: radius, h: -0.18 },
    ];
  }
  return null;
}

export function makeCourseEditor(app, hooks) {
  // hooks: { onExit(), afterApply(), autosave(), money(), isPaused() }
  let session = null;
  let active = false;
  let tool = 'select';
  const ui = {}; // live element refs

  // per-tool tunables (progressive disclosure: only the active tool shows)
  const opt = {
    terrain: {
      mode: 'raise', radiusYd: 20, strength: 55, falloff: 0.5, autoSmooth: true,
      slopePercent: 3, plateauOffsetFt: 0,
    },
    paint: { zone: ZONE.FAIRWAY, radiusYd: 16 },
    tee: { holeId: null, teeKey: 'back', rot: 0 },
    green: { mode: 'draw', shape: 'oval', sizeYd: 30, rot: 0, pin: null }, // pin: null | 'A'|'B'|'C'
    bunker: { mode: 'draw', shape: 'kidney', sizeYd: 14, depth: 2.4, rot: 0 },
    water: { mode: 'draw', shape: 'pond', sizeYd: 36, streamWidthYd: 6, depth: 4.4, rot: 0 },
    objects: {
      cat: 'tree', type: 'oak_a', scale: 1, randomRot: true,
      assist: false, assistCount: 8, snapYd: 1, search: '',
    },
    paths: {
      mode: 'draw',
      width: 3.2,
      material: 'asphalt',
      bridge: false,
      deckMaterial: 'timber',
      railings: true,
      clearanceFt: 0.54,
      supportSpacingYd: 12,
    },
  };

  // transient input state
  let stroke = null; // active terrain/paint stroke
  let strokeClock = 0;
  let drawingPath = null; // [{x,y}...] while placing a path
  let measurePts = []; // world pts
  let selected = null; // selected object (Select tool)
  let draggingObj = false;
  let featureDrag = null; // local-only vector control-point drag; commits once on release
  const featureSelection = { green: null, bunker: null, water: null };
  let selectedPathId = null;
  let pathDrag = null; // local-only open-centerline preview; commits once on release
  let objectControlGesture = null;
  let objectControlError = null;
  let camDrag = null; // {mode:'orbit'|'pan', x, y}
  let hover = null; // last raycastGround hit
  let hoverPreviewFrame = null;
  let pendingHoverPreview = null;
  let pt = null; // playtest session
  let ptPower = null; // {t, dir} while charging
  let ptLeftAim = null; // left drag becomes aim; a stationary hold remains power
  let ptAim = 0;
  let ptClub = null;
  let ptReturnCamera = null;
  let lightMode = 'day';

  const scene = () => app.scene3d;
  const state = () => app.state;
  const editorPrefs = () => {
    const prefs = state().uiPrefs || (state().uiPrefs = {});
    return prefs.courseEditor || (prefs.courseEditor = {});
  };

  function resolveFeatureSelection(kind, selection = featureSelection[kind]) {
    if (!selection) return null;
    const course = state().course;
    if (kind === 'green') {
      const hole = course.holes.find((candidate) => candidate.id === selection.holeId);
      const vectorHole = vectorHoleForRecord(course, hole);
      return hole && vectorHole?.green
        ? { kind, hole, vectorHole, feature: vectorHole.green, ref: { holeId: hole.id } }
        : null;
    }
    if (kind === 'bunker') {
      const hole = course.holes.find((candidate) => candidate.id === selection.holeId);
      const vectorHole = vectorHoleForRecord(course, hole);
      const found = editorFeatureByRef(vectorHole?.bunkers, selection.ref);
      return hole && vectorHole && found
        ? { kind, hole, vectorHole, feature: found.feature, index: found.index, ref: selection.ref }
        : null;
    }
    if (kind === 'water') {
      const source = selection.source === 'stream' ? 'stream' : 'water';
      const features = source === 'stream' ? course.vec?.streams : course.vec?.waters;
      const found = editorFeatureByRef(features, selection.ref);
      return found
        ? { kind, source, feature: found.feature, index: found.index, ref: selection.ref }
        : null;
    }
    return null;
  }

  function clearFeatureSelections(kind = null) {
    featureDrag = null;
    if (kind) featureSelection[kind] = null;
    else for (const key of Object.keys(featureSelection)) featureSelection[key] = null;
  }

  function focusAuthoredFeature(points) {
    const sc = scene();
    if (!sc || !Array.isArray(points) || points.length < 2) return;
    const worldPoints = points.map((point) => ({
      x: authoredWorldX(sc, point.x),
      z: authoredWorldZ(sc, point.y),
    }));
    const minX = Math.min(...worldPoints.map((point) => point.x));
    const maxX = Math.max(...worldPoints.map((point) => point.x));
    const minZ = Math.min(...worldPoints.map((point) => point.z));
    const maxZ = Math.max(...worldPoints.map((point) => point.z));
    const x = (minX + maxX) * 0.5;
    const z = (minZ + maxZ) * 0.5;
    const span = Math.max(maxX - minX, maxZ - minZ);
    sc.clearCourseCameraPreset?.();
    sc.rig.target.set(x, sc.heightAt(x, z), z);
    sc.rig.dist = Math.min(sc.rig.dist, clamp(span * 1.35 + 55, 105, 220));
    sc.rig.pitch = Math.min(sc.rig.pitch, 0.78);
    sc.rig.apply();
  }

  function setFeatureSelection(kind, selection) {
    featureDrag = null;
    featureSelection[kind] = selection;
    opt[kind].mode = 'edit';
    renderToolPanel();
    refreshSelectedBoundaryPreview();
    focusAuthoredFeature(resolveFeatureSelection(kind)?.feature?.pts);
  }

  function selectedBoundaryPoints() {
    if (featureDrag) return featureDrag.previewPts;
    return resolveFeatureSelection(tool)?.feature?.pts || null;
  }

  function boundaryPreview(points, kind, {
    valid = true,
    reason = null,
    controlPoints = points,
  } = {}) {
    const sc = scene();
    const world = (points || []).map((point) => ({
      x: authoredWorldX(sc, point.x), z: authoredWorldZ(sc, point.y),
    }));
    const worldControls = (controlPoints || []).map((point) => ({
      x: authoredWorldX(sc, point.x), z: authoredWorldZ(sc, point.y),
    }));
    const guides = [];
    const half = 2.2;
    for (const point of worldControls) {
      guides.push({ kind: 'control-cross', points: [{ x: point.x - half, z: point.z }, { x: point.x + half, z: point.z }] });
      guides.push({ kind: 'control-cross', points: [{ x: point.x, z: point.z - half }, { x: point.x, z: point.z + half }] });
    }
    return {
      feature: kind,
      shape: 'edit-boundary',
      outline: { closed: true, points: world },
      fill: { points: world },
      controls: worldControls,
      guides,
      validity: { valid, reason, color: valid ? 0x7fd66b : 0xd84b3a },
    };
  }

  function previewBoundaryValid(points, { closed = true } = {}) {
    const course = state().course;
    const minimum = closed ? 3 : 2;
    if (!Array.isArray(points) || points.length < minimum) return false;
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.y < 0 || point.x > course.w || point.y > course.h)) return false;
    if (!closed) {
      return points.some((point, index) => index > 0
        && Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 1e-5);
    }
    let twiceArea = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      twiceArea += points[j].x * points[i].y - points[i].x * points[j].y;
    }
    return Math.abs(twiceArea) > 1e-5;
  }

  function refreshSelectedBoundaryPreview() {
    const sc = scene();
    if (!sc || !['green', 'bunker', 'water'].includes(tool) || opt[tool].mode !== 'edit') return false;
    const selectedFeature = resolveFeatureSelection(tool);
    const controlPoints = selectedBoundaryPoints();
    if (!selectedFeature || !controlPoints) {
      sc.setEditorFeaturePreview?.(null);
      return false;
    }
    const stream = tool === 'water' && selectedFeature.source === 'stream';
    const outlinePoints = stream
      ? editorStreamRibbon(controlPoints, selectedFeature.feature.w ?? 6)
      : controlPoints;
    const valid = previewBoundaryValid(controlPoints, { closed: !stream }) && outlinePoints.length >= 3;
    sc.setEditorFeaturePreview?.(boundaryPreview(outlinePoints, stream ? 'stream' : tool, {
      valid,
      reason: valid
        ? null
        : stream
          ? 'Stream points must stay in bounds and form a line.'
          : 'Boundary must stay in bounds and enclose an area.',
      controlPoints,
    }));
    return true;
  }

  function pointsZoneRect(...pointSets) {
    const points = pointSets.flat().filter(Boolean);
    if (!points.length) return null;
    return {
      x0: Math.min(...points.map((point) => point.x)) - 4,
      y0: Math.min(...points.map((point) => point.y)) - 4,
      x1: Math.max(...points.map((point) => point.x)) + 4,
      y1: Math.max(...points.map((point) => point.y)) + 4,
    };
  }

  // Centre + radius (cells) → the dirty rect refreshGround takes. The stamp
  // tools call this on their success branch; callers pad the radius themselves,
  // so this stays a plain square around the point.
  function zr(x, y, r) {
    return { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
  }

  function rectTouchesPoints(rect, points, padding = 0) {
    if (!rect) return true;
    if (!Array.isArray(points) || !points.length) return false;
    const x0 = Math.min(...points.map((point) => point.x)) - padding;
    const y0 = Math.min(...points.map((point) => point.y)) - padding;
    const x1 = Math.max(...points.map((point) => point.x)) + padding;
    const y1 = Math.max(...points.map((point) => point.y)) + padding;
    return x1 >= rect.x0 && x0 <= rect.x1 && y1 >= rect.y0 && y0 <= rect.y1;
  }

  // Water surfaces and terrain-following paths only need rebuilding when the
  // sculpt actually reaches them. Recreating every pond, stream, path and
  // bridge after an unrelated fairway stroke generated enough short-lived
  // geometry to trigger periodic long GC pauses during extended editing.
  function terrainRefreshDependencies(rect) {
    if (!rect) return { water: true, paths: true };
    const course = state().course;
    const waters = [
      ...(course.vec?.waters || []).map((feature) => ({ feature, padding: 2 })),
      ...(course.vec?.streams || []).map((feature) => ({
        feature,
        padding: 2 + (Number(feature.w) || 6) / CELL_YD,
      })),
    ];
    return {
      water: waters.some(({ feature, padding }) => rectTouchesPoints(rect, feature.pts, padding)),
      paths: (course.paths || []).some((path) => rectTouchesPoints(
        rect, path.pts, 2 + (Number(path.width) || 6) / CELL_YD,
      )),
    };
  }

  // The analytic relief sculpt behind a feature — a green's pad, a bunker's
  // bowl and lip, a pond's bed — blends out past the surface footprint, so the
  // terrain window has to be wider than the zone window. 4 cells is 32 yd.
  const RELIEF_PAD_CELLS = 4;
  // Paint affects bilinear neighbours plus at most 0.28 cells of organic warp.
  // Two cells is a proven exact halo; feature edits retain the wider general
  // relief/visual-field padding below.
  const PAINT_FIELD_PAD_CELLS = 2;
  const DISCARD_TILE_CELLS = 10;

  function refreshEditedFeature(kind, beforePts, afterPts) {
    const sc = scene();
    // covers both the old and the new outline, so dragging a boundary repairs
    // the terrain it vacated as well as the terrain it now occupies
    const zoneRect = pointsZoneRect(beforePts, afterPts);
    sc.refreshGround(state(), {
      water: kind === 'water',
      holes: kind === 'green',
      flow: kind === 'green',
      relief: true,
      zoneRect,
      terrainRect: zoneRect ? {
        x0: zoneRect.x0 - RELIEF_PAD_CELLS,
        y0: zoneRect.y0 - RELIEF_PAD_CELLS,
        x1: zoneRect.x1 + RELIEF_PAD_CELLS,
        y1: zoneRect.y1 + RELIEF_PAD_CELLS,
      } : null,
    });
    sc.updateTurf(state());
    refreshTop();
    renderToolPanel();
    refreshSelectedBoundaryPreview();
  }

  function commitSelectedFeatureEdit(kind, patch, success = null) {
    const selectedFeature = resolveFeatureSelection(kind);
    if (!selectedFeature) {
      featureSelection[kind] = null;
      toast(kind === 'water'
        ? t('editor.selectWaterFirst')
        : t('editor.selectFeatureFirst', { kind }), 'warn');
      renderToolPanel();
      refreshSelectedBoundaryPreview();
      return { ok: false };
    }
    const beforePts = selectedFeature.feature.pts.map((point) => ({ x: point.x, y: point.y }));
    let result;
    if (kind === 'green') {
      result = editVectorGreen(state(), session, selectedFeature.hole.id, patch);
    } else if (kind === 'bunker') {
      result = editVectorBunker(state(), session, selectedFeature.hole.id, selectedFeature.ref, patch);
    } else if (selectedFeature.source === 'stream') {
      result = editVectorStream(state(), session, selectedFeature.ref, patch);
    } else {
      result = editVectorWater(state(), session, selectedFeature.ref, patch);
    }
    if (!result.ok) {
      toast(result.reason || `Could not edit the ${kind}.`, 'warn');
      renderToolPanel();
      refreshSelectedBoundaryPreview();
      return result;
    }
    const afterPts = resolveFeatureSelection(kind)?.feature?.pts || beforePts;
    refreshEditedFeature(kind, beforePts, afterPts);
    if (success && !result.unchanged) toast(success);
    return result;
  }

  function selectedPath() {
    if (selectedPathId == null) return null;
    return state().course.paths.find((path) => path.id === selectedPathId) || null;
  }

  function clearPathSelection() {
    selectedPathId = null;
    pathDrag = null;
  }

  function pathBridgeControls(path) {
    const raw = path?.bridge;
    const metadata = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      enabled: raw === true || (!!raw && metadata.enabled !== false),
      deckMaterial: metadata.deckMaterial || 'timber',
      railings: metadata.railings !== false,
      clearanceFt: Number.isFinite(metadata.clearanceFt) ? metadata.clearanceFt : 0.54,
      supportSpacingYd: Number.isFinite(metadata.supportSpacingYd) ? metadata.supportSpacingYd : 12,
    };
  }

  function authoredBridgeFromOptions() {
    if (!opt.paths.bridge) return null;
    return {
      enabled: true,
      deckMaterial: opt.paths.deckMaterial,
      railings: opt.paths.railings,
      clearanceFt: opt.paths.clearanceFt,
      supportSpacingYd: opt.paths.supportSpacingYd,
    };
  }

  function pathPreview(points, { valid = true, reason = null } = {}) {
    const sc = scene();
    const world = (points || []).map((point) => ({
      x: authoredWorldX(sc, point.x), z: authoredWorldZ(sc, point.y),
    }));
    const half = 2.2;
    const guides = [];
    for (const point of world) {
      guides.push({ kind: 'control-cross', points: [{ x: point.x - half, z: point.z }, { x: point.x + half, z: point.z }] });
      guides.push({ kind: 'control-cross', points: [{ x: point.x, z: point.z - half }, { x: point.x, z: point.z + half }] });
    }
    return {
      feature: 'path',
      shape: 'edit-centerline',
      outline: { closed: false, points: world },
      fill: { points: [] },
      controls: world,
      guides,
      validity: { valid, reason, color: valid ? 0x7fd66b : 0xd84b3a },
    };
  }

  function selectedPathPoints() {
    if (pathDrag) return pathDrag.previewPts;
    return selectedPath()?.pts || null;
  }

  function refreshSelectedPathPreview() {
    const sc = scene();
    if (!sc || tool !== 'paths' || opt.paths.mode !== 'edit') return false;
    const path = selectedPath();
    const points = selectedPathPoints();
    if (!path || !points) {
      if (selectedPathId != null) clearPathSelection();
      sc.setEditorFeaturePreview?.(null);
      return false;
    }
    const valid = previewBoundaryValid(points, { closed: false });
    sc.setEditorFeaturePreview?.(pathPreview(points, {
      valid,
      reason: valid ? null : 'Path points must stay in bounds and form an open line.',
    }));
    return true;
  }

  function refreshEditedPath(beforePts = [], afterPts = []) {
    scene().refreshGround(state(), {
      paths: true,
      zoneRect: pointsZoneRect(beforePts, afterPts),
    });
    refreshTop();
    renderToolPanel();
    refreshSelectedPathPreview();
  }

  function commitSelectedPathEdit(patch, success = null) {
    const path = selectedPath();
    if (!path) {
      clearPathSelection();
      toast(t('editor.selectAPathFirst'), 'warn');
      renderToolPanel();
      refreshSelectedPathPreview();
      return { ok: false };
    }
    const beforePts = path.pts.map((point) => ({ x: point.x, y: point.y }));
    const result = editPath(state(), session, path.id, patch);
    if (!result.ok) {
      toast(result.reason || 'Could not edit the path.', 'warn');
      renderToolPanel();
      refreshSelectedPathPreview();
      return result;
    }
    const afterPts = selectedPath()?.pts || beforePts;
    refreshEditedPath(beforePts, afterPts);
    if (success && !result.unchanged) toast(success);
    return result;
  }

  // ---------------------------------------------------------------- DOM ----

  const topLeft = el('div', { class: 'ced-top-left' },
    el('div', { class: 'ced-title' }, svgIcon('green'), el('span', { text: 'COURSE EDITOR' })),
    ui.playtestBtn = el('button', { class: 'ced-top-btn primary', title: 'Play the selected hole', onclick: () => enterPlaytest() },
      svgIcon('play'), el('span', { text: 'Playtest' })),
    ui.undoBtn = el('button', { class: 'ced-top-btn', title: 'Undo (Ctrl+Z)', onclick: () => doUndo() },
      svgIcon('undo'), el('span', { text: 'Undo' })),
    ui.redoBtn = el('button', { class: 'ced-top-btn', title: 'Redo (Ctrl+Y)', onclick: () => doRedo() },
      svgIcon('redo'), el('span', { text: 'Redo' })),
    ui.saveBtn = el('button', { class: 'ced-top-btn', title: 'Save the course', onclick: () => openSaveDialog() },
      svgIcon('save'), el('span', { text: 'Save' })),
    ui.statsBtn = el('button', { class: 'ced-top-btn', title: 'Course statistics', onclick: () => toggleStats() },
      svgIcon('stats'), el('span', { text: 'Stats' })),
  );

  // the selected hole is the editor's center of gravity: one chip names it,
  // clicking it opens the hole cards
  ui.holeChip = el('button', { class: 'ced-holechip', title: 'Select a hole to edit', onclick: () => openHoleSelect() },
    svgIcon('holes'), el('span', { text: 'Select a hole' }));

  ui.billChip = el('span', { class: 'ced-bill', text: '' });
  ui.applyBtn = el('button', { class: 'ced-top-btn primary', text: 'Build it', onclick: () => doApply() });
  ui.discardBtn = el('button', { class: 'ced-top-btn', text: 'Discard', onclick: () => doDiscard() });
  ui.flyoverOpt = el('option', { value: FLYOVER_CAMERA_VIEW, text: 'Flyover' });
  ui.flyoverOpt.disabled = true;
  ui.flyoverOpt.hidden = true;
  ui.cameraSel = el('select', { class: 'ced-camera', title: 'Course camera preset' },
    ...CAMERA_VIEWS.map(([value, text]) => el('option', { value, text })),
    ui.flyoverOpt,
  );
  ui.cameraSel.onchange = () => setCameraView(ui.cameraSel.value);
  // Flyover is a timed flight that restores the preset it interrupted, so it is
  // deliberately NOT one of the persistable camera views (see
  // normalizeCourseCameraView). It still belongs beside them where the
  // reference puts it, rather than buried in the hole picker — so it gets a
  // button next to the selector instead of an option inside it.
  ui.flyoverBtn = el('button', {
    class: 'ced-top-btn ced-flyover',
    title: 'Fly the selected hole from tee to green',
    onclick: () => {
      if (flyover) stopFlyover();
      else startFlyover(selectedHole());
    },
  }, svgIcon('flyover'), el('span', { text: 'Flyover' }));
  const billWrap = el('div', { class: 'ced-bill-wrap' },
    ui.holeChip, ui.cameraSel, ui.flyoverBtn, ui.billChip, ui.applyBtn, ui.discardBtn,
  );

  ui.moneyChip = el('span', { class: 'ced-money', text: '' });
  ui.clockChip = el('span', { class: 'ced-clock', text: '' });
  ui.lightSel = el('select', { class: 'ced-light', title: 'Editor lighting preview' },
    el('option', { value: 'day', text: 'Late morning' }),
    el('option', { value: 'morning', text: 'Morning' }),
    el('option', { value: 'golden', text: 'Golden hour' }),
    el('option', { value: 'overcast', text: 'Overcast' }),
  );
  ui.lightSel.onchange = () => {
    lightMode = ui.lightSel.value;
    editorPrefs().lighting = lightMode;
    if (scene()) scene().setLightingOverride(lightMode);
  };
  const topRight = el('div', { class: 'ced-top-right' },
    ui.moneyChip,
    ui.clockChip,
    ui.lightSel,
    el('button', { class: 'ced-top-btn', title: 'Leave the editor', onclick: () => requestExit() },
      svgIcon('exit'), el('span', { text: 'Exit' })),
  );

  const topBar = el('div', { class: 'ced-top' }, topLeft, billWrap, topRight);

  // tool rail + contextual controls
  const railButtons = new Map();
  const rail = el('div', { class: 'ced-rail' },
    el('div', { class: 'ced-rail-head', text: 'SELECT TOOL' }),
    ...TOOLS.map((t, i) => {
      const b = el('button', {
        class: 'ced-tool',
        onclick: () => setTool(t.key),
        title: `${t.label} (${i === 9 ? 0 : i + 1})`,
      }, svgIcon(t.icon), el('span', { text: t.label }));
      railButtons.set(t.key, b);
      return b;
    }),
  );
  ui.toolPanel = el('div', { class: 'ced-tool-panel' });
  ui.impactPanel = el('div', { class: 'ced-impact', style: 'display:none' });
  const tip = el('div', { class: 'ced-tip' },
    el('b', { text: 'TIP' }),
    ui.tipBody = el('div', { text: 'Choose a tool and click on the course to begin.' }),
  );
  const leftCol = el('div', { class: 'ced-left' }, rail, ui.toolPanel, tip);

  ui.hintBar = el('div', { class: 'ced-hints', text: '' });
  ui.measureChip = el('div', { class: 'ced-measure', style: 'display:none' });
  ui.compass = el('div', { class: 'ced-compass' }, el('span', { text: 'N' }));

  // stats panel (toggleable)
  ui.statsPanel = el('div', { class: 'ced-stats', style: 'display:none' });

  // playtest overlay + its hole mini-map card
  ui.ptBar = el('div', { class: 'ced-pt', style: 'display:none' });
  ui.ptMap = el('div', { class: 'ced-pt-map', style: 'display:none' });

  const root = el('div', { class: 'ced-root', style: 'display:none' },
    topBar, leftCol, ui.impactPanel, ui.hintBar, ui.measureChip, ui.compass, ui.statsPanel, ui.ptBar, ui.ptMap);

  // ------------------------------------------------------------- helpers ----

  function holesOf() {
    const c = state().course;
    c.holes.forEach((h, i) => ensureHoleShape(h, i + 1));
    return c.holes;
  }

  function compactMoney(value) {
    const amount = Number(value) || 0;
    const abs = Math.abs(amount);
    if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
    if (abs >= 1_000) return `$${(amount / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
    return formatMoney(amount);
  }

  function refreshTop() {
    const bill = session ? Math.round(session.bill) : 0;
    const dirty = !!(session && sessionDirty(session));
    const impact = constructionImpact(state(), session);
    // the bill trio only exists while something is actually pending — a clean
    // course shows a clean bar, not permanent status text
    ui.billChip.style.display = bill > 0 ? '' : 'none';
    ui.billChip.textContent = bill > 0 ? `Works ${compactMoney(bill)}` : '';
    ui.billChip.title = bill > 0 ? `Pending works: ${formatMoney(bill)}` : '';
    const canPay = bill <= state().cash;
    ui.applyBtn.style.display = dirty ? '' : 'none';
    ui.applyBtn.disabled = !dirty;
    ui.applyBtn.textContent = bill > 0 && !canPay ? 'Insufficient cash' : 'Build';
    ui.applyBtn.classList.toggle('danger', bill > 0 && !canPay);
    ui.discardBtn.style.display = dirty ? '' : 'none';
    ui.discardBtn.disabled = !dirty;
    ui.impactPanel.style.display = dirty ? '' : 'none';
    if (dirty) {
      const valueDirection = impact.valueDelta > 0 ? '+' : impact.valueDelta < 0 ? '−' : '';
      const valueAmount = compactMoney(Math.abs(impact.valueDelta));
      const closureText = impact.holesAffected
        ? `${impact.holesAffected} hole${impact.holesAffected === 1 ? '' : 's'} close for up to ${impact.maxConstructionDays} day${impact.maxConstructionDays === 1 ? '' : 's'}`
        : 'No open-hole closure expected';
      ui.impactPanel.replaceChildren(
        el('b', { text: 'CONSTRUCTION IMPACT' }),
        el('div', { class: 'ced-impact-row' },
          el('span', { text: 'Works' }),
          el('strong', { text: formatMoney(impact.pendingCost) })),
        el('div', { class: `ced-impact-warning${impact.holesAffected ? ' warn' : ''}`, text: closureText }),
        el('div', { class: 'ced-impact-row' },
          el('span', { text: 'Estimated value' }),
          el('strong', {
            class: impact.valueDelta < 0 ? 'negative' : impact.valueDelta > 0 ? 'positive' : '',
            text: `${valueDirection}${valueAmount}`,
          })),
      );
    }
    ui.undoBtn.disabled = !(session && session.undo.length);
    ui.redoBtn.disabled = !(session && session.redo.length);
    // startFlyover needs a hole with both a tee and a pin; say so on the button
    // rather than letting the click quietly do nothing.
    const flyable = selectedHole();
    const canFly = !!(flyable && flyable.tee && flyable.pin);
    ui.flyoverBtn.disabled = !canFly && !flyover;
    ui.flyoverBtn.classList.toggle('on', !!flyover);
    ui.flyoverBtn.title = flyover
      ? 'Stop the flyover and return to the previous camera'
      : canFly
        ? 'Fly the selected hole from tee to green'
        : 'This hole needs a tee and a pin before it can be flown';
    ui.moneyChip.textContent = compactMoney(state().cash);
    ui.moneyChip.title = `Available cash: ${formatMoney(state().cash)}`;
    // the game date rides along, like the reference's "Y1 · Spring · Day 2"
    try {
      const chip = document.querySelector('.hud-clock');
      ui.clockChip.textContent = chip ? chip.textContent.replace(/[⏸▶]/g, '').trim() : '';
    } catch { /* clock is decoration */ }
    refreshHoleChip();
    if (ui.statsPanel.style.display !== 'none') renderStats();
  }

  function selectedHole() {
    return holesOf().find((h) => h.id === opt.tee.holeId) || holesOf()[0] || null;
  }

  function refreshHoleChip() {
    const hole = selectedHole();
    const label = ui.holeChip.querySelector('span:last-child');
    if (!hole) {
      label.textContent = 'Select a hole';
      return;
    }
    const n = holeNumber(state().course, hole.id);
    const yd = hole.tee && hole.pin ? ` · ${Math.round(holeDistanceYd(hole))} yd` : '';
    const named = hole.name && hole.name !== `Hole ${n}` ? ` - ${hole.name}` : '';
    label.textContent = `Hole ${n}${named} · Par ${holePar(hole)}${yd}`;
    ui.holeChip.title = `${label.textContent} - click to select or edit a hole`;
  }

  function setCameraView(mode, hole = selectedHole()) {
    const view = normalizeCourseCameraView(mode);
    const stoppedFlight = clearFlyoverState();
    ui.cameraSel.value = view;
    editorPrefs().cameraView = view;
    if (stoppedFlight) hint(HINTS[tool] || '');
    if (!scene()) return;
    if (view === 'course-overview') scene().frameCourse();
    else scene().frameHole(hole, view);
  }

  // Selecting a hole is the editor's core gesture: it frames the camera, aims
  // the tee tool, and names itself in the top bar.
  function selectHole(hole, { frame = true } = {}) {
    if (!hole) return;
    if (featureSelection.green?.holeId !== hole.id) featureSelection.green = null;
    if (featureSelection.bunker?.holeId !== hole.id) featureSelection.bunker = null;
    featureDrag = null;
    opt.tee.holeId = hole.id;
    editorPrefs().selectedHoleId = hole.id;
    if (frame) setCameraView('frame-hole', hole);
    refreshHoleChip();
  }

  function hint(text) {
    ui.hintBar.textContent = text;
  }

  const HINTS = {
    select: 'Left click: select an object · Drag: move it · Right-drag: rotate camera · Middle: pan · Wheel: zoom',
    terrain: 'Hold left: sculpt · Right-drag: rotate camera · Middle: pan · Wheel: zoom',
    paint: 'Hold left: paint · Hold right: erase to rough · Middle: pan · Wheel: zoom',
    tee: 'Click on the ground: build the tee box aimed at the pin',
    green: 'Draw: click to build · Edit: drag boundary cross handles · A/B/C arms a pin',
    bunker: 'Draw: click to dig · Edit: select a bunker and drag its boundary handles',
    water: 'Draw: click to flood · Edit: select water and drag shoreline/centerline handles',
    objects: 'Click: place · Right-click: remove nearest · Fill area: pick a spot',
    paths: 'Draw: click points and right-click to finish · Edit: select a path and drag its cross handles',
    measure: 'Click two (or more) points · Right-click: clear',
  };

  const TOOL_TIPS = {
    select: 'Select a placed tree, rock, or prop to reveal move, rotate, scale, duplicate, and remove controls.',
    terrain: 'Use a smaller brush for precise shaping. Auto smooth softens the edge after every sculpt tick.',
    paint: 'Surface paint changes the lie and renovation cost. Right-drag restores rough without changing elevation.',
    tee: 'Choose the hole and tee set first; the preview aims the finished box toward the active pin.',
    green: 'Edit mode keeps the green as it was drawn. The bright square handles are the points you can drag.',
    bunker: 'Edit mode preserves the bunker identity, depth, lip, and billing while you reshape its boundary.',
    water: 'Ponds use shoreline handles; streams use centerline handles and a finished bank-to-bank width.',
    objects: 'Green previews are legal; red previews collide. Snap and size are applied before placement.',
    paths: 'Right-click finishes a new route. Edit mode exposes retained centerline handles and bridge controls.',
    measure: 'Each click extends the measurement; right-click clears it and starts a new route.',
  };

  // THE BRUSH RING IS THE CURSOR. terrain and paint already draw a world-space
  // ring on the terrain at the exact spot the stroke will land; the OS arrow on
  // top of it was a second pointer, drawn at a different place (the ring sits on
  // the ground under the cursor, not at it), which is what made sculpting feel
  // like aiming with two sights. Hide the arrow for those, give the
  // place-a-point tools a crosshair, and leave select alone — it points at
  // handles and props, where an arrow is correct.
  const BRUSH_CURSOR_TOOLS = new Set(['terrain', 'paint']);

  function applyToolCursor() {
    const body = typeof document !== 'undefined' ? document.body : null;
    if (!body) return;
    const editing = active && !pt;
    const brush = editing && BRUSH_CURSOR_TOOLS.has(tool);
    const precise = editing && !brush && tool !== 'select';
    body.classList.toggle('ced-cursor-brush', brush);
    body.classList.toggle('ced-cursor-precise', precise);
  }

  function setTool(key) {
    commitObjectControlGesture();
    clearFeatureSelections();
    clearPathSelection();
    tool = key;
    stroke = null;
    drawingPath = null;
    if (key !== 'measure') {
      measurePts = [];
      if (scene()) scene().setMeasureLine(null);
    }
    if (key !== 'select') setSelected(null);
    if (scene()) {
      scene().setPlacementGhost(null);
      scene().setEditorFeaturePreview?.(null);
      // TOOL FOCUS: picking a brush from a satellite distance is guesswork —
      // ease in far enough that the brush ring stays a readable size
      const rig = scene().rig;
      const focusDistance = key === 'objects' ? 155 : 260;
      if (key !== 'select' && rig.dist > focusDistance) {
        scene().clearCourseCameraPreset?.();
        rig.dist = focusDistance;
        rig.pitch = Math.min(rig.pitch, 0.95);
        rig.apply();
      }
    }
    for (const [k, b] of railButtons) b.classList.toggle('on', k === key);
    renderToolPanel();
    const toolHint = HINTS[key] || '';
    ui.tipBody.textContent = TOOL_TIPS[key] || toolHint || 'Choose a tool and click on the course to begin.';
    applyToolCursor();
    hint(toolHint);
  }

  function setSelected(obj) {
    commitObjectControlGesture();
    selected = obj;
    const sc = scene();
    if (sc && tool === 'select') {
      if (obj) {
        sc.setEditorBrush({
          x: sc.worldX(obj.x),
          z: sc.worldZ(obj.y),
          radiusYd: Math.max(3, objectCollisionRadiusYd(obj.type, obj.scale || 1)),
          color: 0xffe9a0,
        });
      } else sc.setEditorBrush(null);
    }
    if (tool === 'select') renderToolPanel();
  }

  // ------------------------------------------------------ tool panels ----

  function slider(label, value, min, max, step, oninput, format = (v) => v, gesture = null) {
    const val = el('span', { class: 'ced-val', text: String(format(value)) });
    const finishGesture = () => gesture?.onend?.();
    const input = el('input', {
      type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
      oninput: (e) => {
        gesture?.onstart?.();
        const v = Number(e.target.value);
        val.textContent = String(format(v));
        oninput(v);
      },
      onpointerdown: () => gesture?.onstart?.(),
      onpointerup: finishGesture,
      onpointercancel: finishGesture,
      onchange: finishGesture,
      onblur: finishGesture,
    });
    return el('div', { class: 'ced-row' }, el('label', { text: label }), input, val);
  }

  // Metadata changes are expensive vector rebuilds and real undo entries. Keep
  // the thumb/value responsive during movement, then commit exactly once when
  // the pointer/keyboard gesture ends.
  function commitSlider(label, value, min, max, step, oncommit, format = (v) => v) {
    let pending = value;
    let editing = false;
    return slider(label, value, min, max, step, (next) => { pending = next; }, format, {
      onstart: () => { editing = true; },
      onend: () => {
        if (!editing) return;
        editing = false;
        if (pending !== value) oncommit(pending);
      },
    });
  }

  function beginObjectControlGesture(label) {
    if (!selected) return null;
    if (objectControlGesture
      && objectControlGesture.id === selected.id
      && objectControlGesture.label === label) return objectControlGesture;
    commitObjectControlGesture();
    objectControlError = null;
    objectControlGesture = beginObjectGesture(state(), selected.id, label, true);
    return objectControlGesture;
  }

  function previewSelectedObject(patch, label) {
    const gesture = beginObjectControlGesture(label);
    const res = previewObjectGesture(state(), gesture, patch);
    if (res.ok) {
      objectControlError = null;
      rebuildObjectVisuals();
    } else {
      objectControlError = res.reason || 'That transform would overlap another object.';
    }
    return res;
  }

  function commitObjectControlGesture() {
    if (!objectControlGesture) return { ok: true, unchanged: true };
    const gesture = objectControlGesture;
    const previewError = objectControlError;
    objectControlGesture = null;
    objectControlError = null;
    const res = endObjectGesture(state(), session, gesture);
    if (res.ok && !res.unchanged) refreshTop();
    if (previewError) {
      toast(previewError, 'warn');
      const selectedId = selected?.id;
      queueMicrotask(() => {
        if (!active || tool !== 'select' || selected?.id !== selectedId) return;
        renderToolPanel();
        refreshHoverPreview();
      });
    }
    return res;
  }

  function segButtons(options, current, onpick) {
    return el('div', { class: 'ced-seg' }, ...options.map(([key, label]) =>
      el('button', {
        class: key === current ? 'on' : '',
        text: label,
        onclick: (e) => {
          onpick(key);
          for (const sib of e.target.parentElement.children) sib.classList.toggle('on', sib === e.target);
        },
      })));
  }

  function holePicker(current, onpick) {
    const sel = el('select');
    for (const h of holesOf()) {
      sel.append(el('option', { value: String(h.id), text: `${h.name} · par ${holePar(h)}` }));
    }
    if (current) sel.value = String(current);
    sel.onchange = () => onpick(Number(sel.value));
    return sel;
  }

  function chooseFeatureMode(kind, mode) {
    opt[kind].mode = mode;
    featureDrag = null;
    if (mode === 'draw') featureSelection[kind] = null;
    if (mode === 'edit' && kind === 'green') {
      const hole = selectedHole();
      featureSelection.green = vectorHoleForRecord(state().course, hole)?.green
        ? { holeId: hole.id }
        : null;
    }
    scene().setEditorFeaturePreview?.(null);
    renderToolPanel();
    if (!refreshSelectedBoundaryPreview()) refreshHoverPreview();
    hint(HINTS[kind]);
  }

  function choosePathMode(mode) {
    opt.paths.mode = mode;
    pathDrag = null;
    drawingPath = null;
    if (mode === 'draw') selectedPathId = null;
    scene().setMeasureLine(null);
    scene().setEditorFeaturePreview?.(null);
    renderToolPanel();
    if (!refreshSelectedPathPreview()) refreshHoverPreview();
    hint(HINTS.paths);
  }

  function setPathSelection(pathId) {
    pathDrag = null;
    selectedPathId = pathId;
    opt.paths.mode = 'edit';
    drawingPath = null;
    scene().setMeasureLine(null);
    renderToolPanel();
    refreshSelectedPathPreview();
    focusAuthoredFeature(selectedPath()?.pts);
  }

  function contourPresetOf(green) {
    const roles = (green?.contours || []).map((contour) => contour.role);
    if (!roles.length) return 'none';
    if (roles.every((role) => role === 'editor-soft-roll')) return 'soft-roll';
    if (roles.length === 2 && roles.includes('editor-saddle-high') && roles.includes('editor-saddle-low')) return 'saddle';
    return 'custom';
  }

  function removeSelectedVectorFeature(kind) {
    const selectedFeature = resolveFeatureSelection(kind);
    if (!selectedFeature) {
      toast(kind === 'water'
        ? t('editor.selectWaterFirst')
        : t('editor.selectFeatureFirst', { kind }), 'warn');
      return;
    }
    const beforePts = selectedFeature.feature.pts.map((point) => ({ x: point.x, y: point.y }));
    let result;
    if (kind === 'bunker') {
      result = deleteVectorBunker(state(), session, selectedFeature.hole.id, selectedFeature.ref);
    } else if (selectedFeature.source === 'stream') {
      result = deleteVectorStream(state(), session, selectedFeature.ref);
    } else {
      result = deleteVectorWater(state(), session, selectedFeature.ref);
    }
    if (!result.ok) {
      toast(result.reason || `Could not delete the ${kind}.`, 'warn');
      return;
    }
    clearFeatureSelections(kind);
    refreshEditedFeature(kind, beforePts, []);
    toast(selectedFeature.source === 'stream'
      ? t('editor.streamDeleted')
      : kind === 'water' ? t('editor.waterDeleted') : t('editor.bunkerDeleted'));
  }

  function renderToolPanel() {
    const p = ui.toolPanel;
    p.replaceChildren();
    const head = (t) => p.append(el('div', { class: 'ced-panel-head', text: t }));
    switch (tool) {
      case 'select': {
        head('Select');
        if (!selected) {
          p.append(el('div', { class: 'ced-note', text: 'Click a tree, rock, or prop on the course.' }));
          break;
        }
        const entry = OBJECT_CATALOG.find((o) => o.type === selected.type);
        p.append(el('div', { class: 'ced-note', text: `${entry ? entry.name : selected.type}` }));
        p.append(slider('Rotate', Math.round(((selected.rot || 0) * 180) / Math.PI) % 360, 0, 359, 1, (v) => {
          previewSelectedObject({ rot: (v * Math.PI) / 180 }, 'Rotate object');
        }, (v) => `${v}°`, {
          onstart: () => beginObjectControlGesture('Rotate object'),
          onend: commitObjectControlGesture,
        }));
        p.append(slider('Scale', Math.round((selected.scale || 1) * 100), 55, 165, 5, (v) => {
          previewSelectedObject({ scale: v / 100 }, 'Scale object');
        }, (v) => `${v}%`, {
          onstart: () => beginObjectControlGesture('Scale object'),
          onend: commitObjectControlGesture,
        }));
        p.append(el('div', { class: 'ced-row' },
          el('button', {
            text: 'Duplicate',
            onclick: () => {
              const res = duplicateObject(state(), session, selected.id, { protectPlay: true });
              if (res.ok) {
                refreshObjects();
                toast(t('editor.copiedDragItInto'));
                setSelected(res.object);
              } else toast(res.reason || 'There is no clear space for a copy.', 'warn');
            },
          }),
          el('button', {
            class: 'danger',
            text: 'Remove',
            onclick: () => {
              removeObject(state(), session, selected.id);
              setSelected(null);
              refreshObjects();
            },
          }),
        ));
        break;
      }
      case 'terrain': {
        head('Terrain');
        p.append(segButtons([
          ['raise', '▲ Raise'], ['lower', '▼ Lower'], ['smooth', '≈ Smooth'], ['flatten', '▭ Flatten'],
          ['slope', '／ Slope'], ['plateau', '▬ Plateau'], ['blend', '∿ Blend'], ['erode', '⌁ Erode'],
        ], opt.terrain.mode, (k) => {
          opt.terrain.mode = k;
          renderToolPanel();
          refreshHoverPreview();
        }));
        p.append(slider('Size', opt.terrain.radiusYd, 8, 60, 2, (v) => { opt.terrain.radiusYd = v; refreshHoverPreview(); }, (v) => `${v} yd`));
        p.append(slider('Strength', opt.terrain.strength, 10, 100, 5, (v) => { opt.terrain.strength = v; }, (v) => `${v}%`));
        p.append(slider('Falloff', Math.round(opt.terrain.falloff * 100), 10, 100, 5, (v) => {
          opt.terrain.falloff = v / 100;
          refreshHoverPreview();
        }, (v) => `${v}%`));
        if (opt.terrain.mode === 'slope') {
          p.append(slider('Grade', opt.terrain.slopePercent, -8, 8, 0.5, (v) => {
            opt.terrain.slopePercent = v;
          }, (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%`));
          p.append(el('div', { class: 'ced-note', text: 'Drag from the high or low anchor in the direction the finished grade should run.' }));
        }
        if (opt.terrain.mode === 'plateau') {
          p.append(slider('Height', opt.terrain.plateauOffsetFt, -8, 8, 0.5, (v) => {
            opt.terrain.plateauOffsetFt = v;
          }, (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)} ft`));
        }
        p.append(el('label', { class: 'ced-check' },
          el('input', {
            type: 'checkbox', ...(opt.terrain.autoSmooth ? { checked: '' } : {}),
            onchange: (e) => { opt.terrain.autoSmooth = e.target.checked; },
          }),
          el('span', { text: 'Auto smooth' }),
        ));
        break;
      }
      case 'paint': {
        head('Paint');
        const grid = el('div', { class: 'ced-swatches' });
        for (const s of PAINT_SURFACES) {
          const b = el('button', {
            class: opt.paint.zone === s.zone ? 'on' : '',
            title: `${formatMoney(zoneCost(s.zone))} per cell`,
            onclick: (e) => {
              opt.paint.zone = s.zone;
              for (const sib of grid.children) sib.classList.toggle('on', sib === e.currentTarget);
            },
          }, el('span', { class: 'sw', style: `background:${zoneColor(s.zone)}` }), el('span', { text: s.label }));
          grid.append(b);
        }
        p.append(grid);
        p.append(slider('Size', opt.paint.radiusYd, 8, 48, 2, (v) => { opt.paint.radiusYd = v; refreshHoverPreview(); }, (v) => `${v} yd`));
        break;
      }
      case 'tee': {
        head('Tee boxes');
        if (opt.tee.holeId === null) opt.tee.holeId = holesOf()[0] && holesOf()[0].id;
        p.append(el('div', { class: 'ced-row' }, el('label', { text: 'Hole' }), holePicker(opt.tee.holeId, (id) => {
          opt.tee.holeId = id;
          refreshHoverPreview();
          renderToolPanel();
        })));
        p.append(segButtons([['back', 'Back'], ['middle', 'Middle'], ['forward', 'Forward']], opt.tee.teeKey, (k) => { opt.tee.teeKey = k; }));
        p.append(slider('Rotate', opt.tee.rot, -90, 90, 1, (v) => {
          opt.tee.rot = v;
          refreshHoverPreview();
        }, (v) => `${v > 0 ? '+' : ''}${v}°`));
        const hole = holesOf().find((h) => h.id === opt.tee.holeId);
        if (hole) {
          const rows = el('div', { class: 'ced-note' });
          for (const key of ['back', 'middle', 'forward']) {
            const t = hole.tees[key];
            const yd = t && hole.pin ? Math.round(Math.hypot(hole.pin.x - t.x, hole.pin.y - t.y) * 8) : null;
            rows.append(el('div', { text: `${key}: ${t ? `${yd} yd to pin` : 'not built'}${hole.activeTee === key ? ' · playing' : ''}` }));
          }
          p.append(rows);
          p.append(el('div', { class: 'ced-row' },
            el('button', {
              text: 'Play this tee',
              onclick: () => {
                const res = selectTee(state(), session, hole.id, opt.tee.teeKey);
                if (!res.ok) toast(res.reason, 'warn');
                else {
                  scene().updateHoles();
                  scene().rebuildFlowField();
                  scene().updateTurf(state());
                  renderToolPanel();
                }
              },
            }),
          ));
        }
        break;
      }
      case 'green': {
        head('Green');
        p.append(segButtons([['draw', 'Draw'], ['edit', 'Edit']], opt.green.mode, (mode) => chooseFeatureMode('green', mode)));
        const hole = selectedHole();
        const vectorHole = vectorHoleForRecord(state().course, hole);
        const green = vectorHole?.green;
        const greenSelected = featureSelection.green?.holeId === hole?.id;
        const greenList = el('div', { class: 'ced-note' });
        if (hole && green) {
          const selectGreen = () => setFeatureSelection('green', { holeId: hole.id });
          greenList.append(el('div', { class: 'ced-pathrow', onclick: selectGreen },
            el('span', { text: `${hole.name} · ${green.pts.length} boundary points` }),
            el('button', {
              class: greenSelected ? 'on' : '',
              text: greenSelected ? 'Selected' : 'Edit',
              onclick: (event) => { event.stopPropagation(); selectGreen(); },
            }),
          ));
        } else {
          greenList.append(el('div', { text: hole ? 'This hole has no vector green yet.' : t('editor.selectAHoleFirst') }));
        }
        p.append(greenList);
        if (opt.green.mode === 'draw') {
          p.append(segButtons([['round', 'Round'], ['oval', 'Oval'], ['kidney', 'Kidney']], opt.green.shape, (k) => { opt.green.shape = k; refreshHoverPreview(); }));
          p.append(slider('Size', opt.green.sizeYd, 18, 44, 1, (v) => { opt.green.sizeYd = v; refreshHoverPreview(); }, (v) => `${v} yd`));
          p.append(slider('Rotate', opt.green.rot, 0, 179, 1, (v) => { opt.green.rot = v; refreshHoverPreview(); }, (v) => `${v}°`));
        } else {
          const resolved = resolveFeatureSelection('green');
          if (!resolved) {
            p.append(el('div', { class: 'ced-note', text: 'Choose the selected-hole green above or click its boundary on the ground.' }));
          } else {
            const selectedGreen = resolved.feature;
            p.append(commitSlider('Fringe', selectedGreen.fringe ?? 1, 0.5, 4, 0.25,
              (value) => commitSelectedFeatureEdit('green', { fringe: value }), (value) => `${Number(value).toFixed(2)} yd`));
            p.append(commitSlider('Apron', selectedGreen.apron ?? 0, 0, 16, 0.5,
              (value) => commitSelectedFeatureEdit('green', { apron: value }), (value) => `${Number(value).toFixed(1)} yd`));
            p.append(commitSlider('Raise', selectedGreen.raise ?? 1.6, 0, 5, 0.1,
              (value) => commitSelectedFeatureEdit('green', { sculpt: { raise: value } }), (value) => `${Number(value).toFixed(1)} ft`));
            p.append(commitSlider('Tilt', selectedGreen.tilt ?? 0.25, 0, 0.8, 0.01,
              (value) => commitSelectedFeatureEdit('green', { sculpt: { tilt: value } }), (value) => `${Number(value).toFixed(2)} ft/cell`));
            const tiltDeg = Math.round((((selectedGreen.tiltA ?? 0) * 180) / Math.PI + 360) % 360);
            p.append(commitSlider('Tilt direction', tiltDeg, 0, 359, 1,
              (value) => commitSelectedFeatureEdit('green', { sculpt: { tiltA: (value * Math.PI) / 180 } }), (value) => `${value}°`));
            const contourSel = el('select',
              el('option', { value: 'none', text: 'None' }),
              el('option', { value: 'soft-roll', text: 'Soft roll' }),
              el('option', { value: 'saddle', text: 'Saddle' }),
            );
            const currentPreset = contourPresetOf(selectedGreen);
            if (currentPreset === 'custom') contourSel.append(el('option', { value: 'custom', text: 'Authored / custom', disabled: '' }));
            contourSel.value = currentPreset;
            contourSel.onchange = () => {
              const contours = editorGreenContourPreset(selectedGreen, contourSel.value);
              commitSelectedFeatureEdit('green', { sculpt: { contours } });
            };
            p.append(el('div', { class: 'ced-row' }, el('label', { text: 'Contour preset' }), contourSel));
            p.append(el('div', { class: 'ced-note', text: 'Drag the visible cross handles to reshape the retained boundary.' }));
          }
        }
        head('Pin position');
        p.append(segButtons([['none', 'Off'], ['A', 'A'], ['B', 'B'], ['C', 'C']], opt.green.pin || 'none', (k) => { opt.green.pin = k === 'none' ? null : k; refreshHoverPreview(); }));
        if (hole) {
          const pinRow = el('div', { class: 'ced-row' });
          for (const key of ['A', 'B', 'C']) {
            pinRow.append(el('button', {
              class: hole.activePin === key ? 'on' : '',
              text: `Play ${key}`,
              disabled: hole.pins?.[key] ? undefined : 'disabled',
              onclick: () => {
                const result = selectPin(state(), session, hole.id, key);
                if (!result.ok) toast(result.reason, 'warn');
                else {
                  scene().updateHoles();
                  scene().rebuildFlowField();
                  refreshTop();
                  renderToolPanel();
                }
              },
            }));
          }
          p.append(pinRow);
        }
        p.append(el('div', { class: 'ced-note', text: 'Arm A, B, or C, then click this hole’s green to place that socket.' }));
        break;
      }
      case 'bunker': {
        head('Bunker');
        p.append(segButtons([['draw', 'Draw'], ['edit', 'Edit']], opt.bunker.mode, (mode) => chooseFeatureMode('bunker', mode)));
        const hole = selectedHole();
        const vectorHole = vectorHoleForRecord(state().course, hole);
        const bunkers = vectorHole?.bunkers || [];
        const list = el('div', { class: 'ced-note' });
        bunkers.forEach((bunker, index) => {
          const ref = editorFeatureRef(bunker, index);
          const activeRef = featureSelection.bunker?.holeId === hole?.id && editorFeatureRefEqual(featureSelection.bunker.ref, ref);
          const selectBunker = () => setFeatureSelection('bunker', { holeId: hole.id, ref });
          list.append(el('div', { class: 'ced-pathrow', onclick: selectBunker },
            el('span', { text: `Bunker ${bunker.id ?? index + 1} · ${(bunker.depth ?? 2.4).toFixed(1)} ft deep` }),
            el('button', {
              class: activeRef ? 'on' : '',
              text: activeRef ? 'Selected' : 'Edit',
              onclick: (event) => { event.stopPropagation(); selectBunker(); },
            }),
          ));
        });
        if (!bunkers.length) list.append(el('div', { text: hole ? 'No bunkers are assigned to this hole.' : t('editor.selectAHoleFirst') }));
        p.append(list);
        if (opt.bunker.mode === 'draw') {
          p.append(segButtons([['round', 'Round'], ['oval', 'Oval'], ['kidney', 'Kidney']], opt.bunker.shape, (k) => { opt.bunker.shape = k; refreshHoverPreview(); }));
          p.append(slider('Size', opt.bunker.sizeYd, 8, 26, 1, (v) => { opt.bunker.sizeYd = v; refreshHoverPreview(); }, (v) => `${v} yd`));
          p.append(slider('Rotate', opt.bunker.rot, 0, 179, 1, (v) => { opt.bunker.rot = v; refreshHoverPreview(); }, (v) => `${v}°`));
          p.append(slider('Finished depth', opt.bunker.depth * 10, 10, 60, 2, (v) => { opt.bunker.depth = v / 10; }, (v) => `${(v / 10).toFixed(1)} ft`));
        } else {
          const resolved = resolveFeatureSelection('bunker');
          if (!resolved) {
            p.append(el('div', { class: 'ced-note', text: 'Choose a bunker above or click the nearest bunker boundary.' }));
          } else {
            const bunker = resolved.feature;
            p.append(commitSlider('Depth', (bunker.depth ?? 2.4) * 10, 5, 80, 1,
              (value) => commitSelectedFeatureEdit('bunker', { depth: value / 10 }), (value) => `${(value / 10).toFixed(1)} ft`));
            p.append(commitSlider('Lip', (bunker.lip ?? 0.9) * 10, 0, 30, 1,
              (value) => commitSelectedFeatureEdit('bunker', { lip: value / 10 }), (value) => `${(value / 10).toFixed(1)} ft`));
            p.append(el('div', { class: 'ced-note', text: 'Sand is intrinsic to the built bunker. Drag cross handles to edit its boundary.' }));
            p.append(el('button', { class: 'danger', text: 'Delete bunker', onclick: () => removeSelectedVectorFeature('bunker') }));
          }
        }
        break;
      }
      case 'water': {
        head('Water');
        p.append(segButtons([['draw', 'Draw'], ['edit', 'Edit']], opt.water.mode, (mode) => chooseFeatureMode('water', mode)));
        const waters = (state().course.vec?.waters || []).map((feature, index) => ({
          source: 'water', feature, index,
        })).filter(({ feature }) => feature.kind === 'pond' || feature.kind === 'lake' || !feature.kind);
        const streams = (state().course.vec?.streams || []).map((feature, index) => ({
          source: 'stream', feature, index,
        }));
        const waterFeatures = [...waters, ...streams];
        const list = el('div', { class: 'ced-note' });
        waterFeatures.forEach(({ source, feature, index }, displayIndex) => {
          const ref = editorFeatureRef(feature, index);
          const activeRef = featureSelection.water?.source === source
            && editorFeatureRefEqual(featureSelection.water.ref, ref);
          const kind = source === 'stream' ? 'Stream' : feature.kind === 'lake' ? 'Lake' : 'Pond';
          const details = source === 'stream'
            ? `${(feature.w ?? 6).toFixed(1)} yd wide · ${(feature.depth ?? 2.2).toFixed(1)} ft deep`
            : `${(feature.depth ?? 4.5).toFixed(1)} ft deep`;
          const selectThisFeature = () => setFeatureSelection('water', { source, ref });
          list.append(el('div', { class: 'ced-pathrow', onclick: selectThisFeature },
            el('span', { text: `${kind} ${displayIndex + 1} · ${details}` }),
            el('button', {
              class: activeRef ? 'on' : '',
              text: activeRef ? 'Selected' : 'Edit',
              onclick: (event) => { event.stopPropagation(); selectThisFeature(); },
            }),
          ));
        });
        if (!waterFeatures.length) list.append(el('div', { text: 'No ponds, lakes, or streams are built.' }));
        p.append(list);
        if (opt.water.mode === 'draw') {
          p.append(segButtons([['pond', 'Pond'], ['lake', 'Lake'], ['stream', 'Stream']], opt.water.shape, (k) => {
            opt.water.shape = k;
            drawingPath = null;
            // Pond/lake and stream authoring expose different controls. Rebuild
            // the panel immediately so the highlighted shape and its inputs
            // cannot disagree until the user changes tools.
            renderToolPanel();
            refreshHoverPreview();
          }));
          if (opt.water.shape === 'stream') {
            p.append(slider('Width', opt.water.streamWidthYd, 2, 18, 0.5, (v) => { opt.water.streamWidthYd = v; }, (v) => `${Number(v).toFixed(1)} yd`));
          } else {
            p.append(slider('Size', opt.water.sizeYd, 20, 64, 2, (v) => { opt.water.sizeYd = v; refreshHoverPreview(); }, (v) => `${v} yd`));
            p.append(slider('Rotate', opt.water.rot, 0, 179, 1, (v) => { opt.water.rot = v; refreshHoverPreview(); }, (v) => `${v}°`));
          }
          p.append(slider('Finished depth', opt.water.depth * 10, 20, 100, 2, (v) => { opt.water.depth = v / 10; }, (v) => `${(v / 10).toFixed(1)} ft`));
        } else {
          const resolved = resolveFeatureSelection('water');
          if (!resolved) {
            p.append(el('div', { class: 'ced-note', text: 'Choose water above or click the nearest shoreline/stream centerline.' }));
          } else {
            const water = resolved.feature;
            if (resolved.source === 'stream') {
              p.append(commitSlider('Width', water.w ?? 6, 1, 24, 0.5,
                (value) => commitSelectedFeatureEdit('water', { width: value }), (value) => `${Number(value).toFixed(1)} yd`));
            }
            p.append(commitSlider('Depth', (water.depth ?? 4.5) * 10, 10, 120, 2,
              (value) => commitSelectedFeatureEdit('water', { depth: value / 10 }), (value) => `${(value / 10).toFixed(1)} ft`));
            p.append(el('div', {
              class: 'ced-note',
              text: resolved.source === 'stream'
                ? 'Drag the centerline cross handles. Width is the finished bank-to-bank span.'
                : 'Drag the shoreline cross handles. The water plane follows this exact outline.',
            }));
            p.append(el('button', {
              class: 'danger',
              text: resolved.source === 'stream' ? 'Delete stream' : 'Delete water',
              onclick: () => removeSelectedVectorFeature('water'),
            }));
          }
        }
        break;
      }
      case 'objects': {
        head('Objects');
        const cats = [['tree', 'Trees'], ['shrub', 'Shrubs'], ['rock', 'Rocks'], ['prop', 'Props'], ['decor', 'Decor']];
        p.append(segButtons(cats, opt.objects.cat, (k) => {
          opt.objects.cat = k;
          opt.objects.search = '';
          const first = OBJECT_CATALOG.find((o) => o.cat === k);
          if (first) opt.objects.type = first.type;
          renderToolPanel();
          refreshHoverPreview();
        }));
        const searchInput = el('input', {
          type: 'search',
          value: opt.objects.search,
          placeholder: 'Search this category',
          'aria-label': 'Search landscaping',
        });
        p.append(el('div', { class: 'ced-row ced-search' }, searchInput));
        const grid = el('div', { class: 'ced-objgrid' });
        const fillObjectGrid = () => {
          const query = opt.objects.search.trim().toLocaleLowerCase();
          const entries = OBJECT_CATALOG.filter((o) => o.cat === opt.objects.cat
            && (!query || o.name.toLocaleLowerCase().includes(query)));
          grid.replaceChildren(...entries.map((o) => el('button', {
            class: opt.objects.type === o.type ? 'on' : '',
            title: `${o.name} - exact final preview`,
            onclick: (e) => {
              opt.objects.type = o.type;
              renderToolPanel();
              refreshHoverPreview();
            },
          }, svgIcon(OBJ_ICON[o.cat] || 'decor'), el('span', {},
            el('span', { text: o.name }),
            el('small', { class: 'ced-obj-price', text: formatMoney(objectCostOf(o.type)) })))));
          if (!entries.length) grid.append(el('div', { class: 'ced-note', text: 'No matching items.' }));
        };
        searchInput.oninput = () => {
          opt.objects.search = searchInput.value;
          fillObjectGrid();
        };
        fillObjectGrid();
        p.append(grid);
        const selectedEntry = OBJECT_CATALOG.find((entry) => entry.type === opt.objects.type);
        if (selectedEntry) {
          const clearance = objectCollisionRadiusYd(selectedEntry.type, opt.objects.scale);
          const details = [
            selectedEntry.rootRadiusYd ? `roots ${selectedEntry.rootRadiusYd.toFixed(1)} yd` : null,
            selectedEntry.canopyRadiusYd ? `canopy ${selectedEntry.canopyRadiusYd.toFixed(1)} yd` : `use clearance ${clearance.toFixed(1)} yd`,
            selectedEntry.matureHeightYd ? `mature height about ${selectedEntry.matureHeightYd} yd` : null,
            selectedEntry.climate ? `${selectedEntry.climate} climate` : 'all climates',
          ].filter(Boolean).join(' · ');
          p.append(el('div', { class: 'ced-note ced-object-detail', text: details }));
        }
        p.append(slider('Size', Math.round(opt.objects.scale * 100), 60, 160, 5, (v) => { opt.objects.scale = v / 100; refreshHoverPreview(); }, (v) => `${v}%`));
        p.append(el('div', { class: 'ced-row' },
          el('label', { text: 'Snap' }),
          segButtons([['0', 'Off'], ['1', '1 yd'], ['2', '2 yd']], String(opt.objects.snapYd), (value) => {
            opt.objects.snapYd = Number(value);
            refreshHoverPreview();
          }),
        ));
        p.append(el('label', { class: 'ced-check' },
          el('input', {
            type: 'checkbox', ...(opt.objects.randomRot ? { checked: '' } : {}),
            onchange: (e) => { opt.objects.randomRot = e.target.checked; },
          }),
          el('span', { text: 'Random rotation' }),
        ));
        p.append(el('label', { class: 'ced-check' },
          el('input', {
            type: 'checkbox', ...(opt.objects.assist ? { checked: '' } : {}),
            onchange: (e) => { opt.objects.assist = e.target.checked; hint(e.target.checked ? 'Fill area: click the middle of the area to scatter' : HINTS.objects); },
          }),
          el('span', { text: 'Fill area (scatter)' }),
        ));
        if (opt.objects.assist) {
          p.append(slider('Count', opt.objects.assistCount, 3, 24, 1, (v) => { opt.objects.assistCount = v; }));
        }
        break;
      }
      case 'paths': {
        head('Paths');
        p.append(segButtons([['draw', 'Draw'], ['edit', 'Edit']], opt.paths.mode, choosePathMode));
        const list = el('div', { class: 'ced-note' });
        for (const path of state().course.paths) {
          const activePath = path.id === selectedPathId;
          const selectThisPath = () => setPathSelection(path.id);
          list.append(el('div', { class: 'ced-pathrow', onclick: selectThisPath },
            el('span', {
              text: `Path ${path.id} · ${path.material} · ${path.pts.length} pts${pathBridgeControls(path).enabled ? ' · bridge' : ''}`,
            }),
            el('button', {
              class: activePath ? 'on' : '',
              text: activePath ? 'Selected' : 'Edit',
              onclick: (event) => { event.stopPropagation(); selectThisPath(); },
            }),
          ));
        }
        if (!state().course.paths.length) list.append(el('div', { text: 'No paths are built.' }));
        p.append(list);

        const materialSelect = (value, onchange) => {
          const select = el('select');
          for (const material of ['asphalt', 'concrete', 'gravel', 'dirt']) {
            select.append(el('option', {
              value: material,
              text: material[0].toUpperCase() + material.slice(1),
            }));
          }
          select.value = value;
          select.onchange = () => onchange(select.value);
          return select;
        };
        const deckSelect = (value, onchange) => {
          const select = el('select');
          for (const material of ['timber', 'concrete', 'steel']) {
            select.append(el('option', {
              value: material,
              text: material[0].toUpperCase() + material.slice(1),
            }));
          }
          select.value = value;
          select.onchange = () => onchange(select.value);
          return select;
        };
        if (opt.paths.mode === 'draw') {
          p.append(slider('Width', opt.paths.width * 10, 16, 60, 2,
            (value) => { opt.paths.width = value / 10; },
            (value) => `${(value / 10).toFixed(1)} yd`));
          p.append(el('div', { class: 'ced-row' }, el('label', { text: 'Material' }),
            materialSelect(opt.paths.material, (value) => { opt.paths.material = value; })));
          p.append(el('label', { class: 'ced-check' },
            el('input', {
              type: 'checkbox', ...(opt.paths.bridge ? { checked: '' } : {}),
              onchange: (event) => { opt.paths.bridge = event.target.checked; renderToolPanel(); },
            }),
            el('span', { text: 'Bridge' }),
          ));
          if (opt.paths.bridge) {
            p.append(el('div', { class: 'ced-row' }, el('label', { text: 'Deck material' }),
              deckSelect(opt.paths.deckMaterial, (value) => { opt.paths.deckMaterial = value; })));
            p.append(el('label', { class: 'ced-check' },
              el('input', {
                type: 'checkbox', ...(opt.paths.railings ? { checked: '' } : {}),
                onchange: (event) => { opt.paths.railings = event.target.checked; },
              }),
              el('span', { text: 'Railings' }),
            ));
            p.append(slider('Minimum clearance', opt.paths.clearanceFt * 10, 0, 120, 1,
              (value) => { opt.paths.clearanceFt = value / 10; },
              (value) => `${(value / 10).toFixed(1)} ft`));
            p.append(slider('Support spacing', opt.paths.supportSpacingYd, 4, 40, 1,
              (value) => { opt.paths.supportSpacingYd = value; },
              (value) => `${value} yd`));
          }
          p.append(el('div', { class: 'ced-note', text: 'Click centerline points on the course, then right-click to build.' }));
        } else {
          const path = selectedPath();
          if (!path) {
            p.append(el('div', { class: 'ced-note', text: 'Choose a path above or click its nearest centerline/control point.' }));
          } else {
            p.append(commitSlider('Width', path.width * 10, 8, 100, 1,
              (value) => commitSelectedPathEdit({ width: value / 10 }),
              (value) => `${(value / 10).toFixed(1)} yd`));
            p.append(el('div', { class: 'ced-row' }, el('label', { text: 'Material' }),
              materialSelect(path.material, (value) => commitSelectedPathEdit({ material: value }))));
            const bridge = pathBridgeControls(path);
            p.append(el('label', { class: 'ced-check' },
              el('input', {
                type: 'checkbox', ...(bridge.enabled ? { checked: '' } : {}),
                onchange: (event) => commitSelectedPathEdit({
                  bridge: event.target.checked ? { ...bridge, enabled: true } : null,
                }),
              }),
              el('span', { text: 'Bridge' }),
            ));
            if (bridge.enabled) {
              p.append(el('div', { class: 'ced-row' }, el('label', { text: 'Deck material' }),
                deckSelect(bridge.deckMaterial, (value) => commitSelectedPathEdit({ bridge: { deckMaterial: value } }))));
              p.append(el('label', { class: 'ced-check' },
                el('input', {
                  type: 'checkbox', ...(bridge.railings ? { checked: '' } : {}),
                  onchange: (event) => commitSelectedPathEdit({ bridge: { railings: event.target.checked } }),
                }),
                el('span', { text: 'Railings' }),
              ));
              p.append(commitSlider('Minimum clearance', bridge.clearanceFt * 10, 0, 120, 1,
                (value) => commitSelectedPathEdit({ bridge: { clearanceFt: value / 10 } }),
                (value) => `${(value / 10).toFixed(1)} ft`));
              p.append(commitSlider('Support spacing', bridge.supportSpacingYd, 4, 40, 1,
                (value) => commitSelectedPathEdit({ bridge: { supportSpacingYd: value } }),
                (value) => `${value} yd`));
            }
            p.append(el('div', { class: 'ced-note', text: 'Drag the retained centerline cross handles to reshape this path.' }));
            p.append(el('button', {
              class: 'danger',
              text: 'Delete path',
              onclick: () => {
                const beforePts = path.pts.map((point) => ({ x: point.x, y: point.y }));
                const result = removePath(state(), session, path.id);
                if (!result.ok) {
                  toast(result.reason || 'Could not delete the path.', 'warn');
                  return;
                }
                clearPathSelection();
                refreshEditedPath(beforePts, []);
                toast(t('editor.pathDeleted'));
              },
            }));
          }
        }
        break;
      }
      case 'measure': {
        head('Measure');
        p.append(el('div', { class: 'ced-note', text: 'Click two points to measure. Extra clicks extend the chain.' }));
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------- stats ----

  function toggleStats() {
    ui.statsPanel.style.display = ui.statsPanel.style.display === 'none' ? '' : 'none';
    if (ui.statsPanel.style.display !== 'none') renderStats();
  }

  function renderStats() {
    const s = courseStats(state(), session);
    const row = (k, v) => el('div', { class: 'ced-stat-row' }, el('span', { text: k }), el('b', { text: String(v) }));
    ui.statsPanel.replaceChildren(
      el('div', { class: 'ced-panel-head', text: 'Course statistics' }),
      row('Holes', `${s.openHoles} open / ${s.holes}`),
      row('Par', s.totalPar),
      row('Yardage', `${s.totalYd.toLocaleString('en-US')} yd`),
      row('Difficulty', '★'.repeat(s.difficulty) + '☆'.repeat(5 - s.difficulty)),
      row('Pending works', formatMoney(s.pendingCost)),
      el('details', { class: 'ced-adv' },
        el('summary', { text: 'Acreage & inventory' }),
        row('Fairway', `${s.fairwayAcres} ac`),
        row('Greens', `${s.greenAcres} ac`),
        row('Rough', `${s.roughAcres} ac`),
        row('Bunkers', `${s.bunkerAcres} ac`),
        row('Water', `${s.waterAcres} ac`),
        row('Cart paths', `${s.pathAcres} ac`),
        row('Trees', s.treeCount),
        row('Placed objects', s.objectCount),
      ),
    );
  }

  // ------------------------------------------------------ hole dialogs ----

  let modalEl = null;
  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }
  function openModal(...kids) {
    closeModal();
    modalEl = el('div', {
      class: 'ced-modal-veil',
      onclick: (e) => { if (e.target === modalEl) closeModal(); },
    }, el('div', { class: 'ced-modal' }, ...kids));
    root.append(modalEl);
  }

  // full-course thumbnail (save panel): every zone, whole property
  function courseThumbCanvas(w = 216, h = 148) {
    const c = state().course;
    const cnv = el('canvas', { width: String(w), height: String(h), class: 'ced-mini' });
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = '#15251a';
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w / c.w, h / c.h);
    const ox = (w - c.w * s) / 2;
    const oy = (h - c.h * s) / 2;
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const z = c.zones[y * c.w + x];
        if (z === ZONE.OUT) continue;
        ctx.fillStyle = zoneColor(z);
        ctx.fillRect(ox + x * s, oy + y * s, Math.ceil(s), Math.ceil(s));
      }
    }
    return cnv;
  }

  // mini overhead layout of one hole (canvas): local zone window around the corridor
  function holeMiniCanvas(hole, w = 92, h = 128) {
    const c = state().course;
    const cnv = el('canvas', { width: String(w), height: String(h), class: 'ced-mini' });
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = '#1d2a18';
    ctx.fillRect(0, 0, w, h);
    if (!hole.tee || !hole.pin) {
      ctx.fillStyle = '#7c8a74';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('unbuilt', w / 2, h / 2);
      return cnv;
    }
    const vecHole = vectorHoleForRecord(c, hole);
    const pts = vecHole?.line?.length >= 2
      ? sampleOpen(vecHole.line, 0.18)
      : [hole.tee, ...(hole.wp || []), hole.pin];
    const start = pts[0];
    const end = pts[pts.length - 1];
    const routeDx = end.x - start.x;
    const routeDy = end.y - start.y;
    const routeLength = Math.max(0.001, Math.hypot(routeDx, routeDy));
    const forwardX = routeDx / routeLength;
    const forwardY = routeDy / routeLength;
    const local = (x, y) => ({
      u: (x - start.x) * -forwardY + (y - start.y) * forwardX,
      v: (x - start.x) * forwardX + (y - start.y) * forwardY,
    });
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    minX -= 8; maxX += 8; minY -= 8; maxY += 8;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const point of pts) {
      const p = local(point.x, point.y);
      minU = Math.min(minU, p.u);
      maxU = Math.max(maxU, p.u);
      minV = Math.min(minV, p.v);
      maxV = Math.max(maxV, p.v);
    }
    minU -= 7; maxU += 7; minV -= 4; maxV += 4;
    const margin = 7;
    const sx = (w - margin * 2) / Math.max(1, maxU - minU);
    const sy = (h - margin * 2) / Math.max(1, maxV - minV);
    const s = Math.min(sx, sy);
    const ox = (w - (maxU - minU) * s) / 2;
    const oy = (h - (maxV - minV) * s) / 2;
    const project = (x, y) => {
      const p = local(x, y);
      return {
        x: ox + (p.u - minU) * s,
        y: h - oy - (p.v - minV) * s,
        inWindow: p.u >= minU && p.u <= maxU && p.v >= minV && p.v <= maxV,
      };
    };
    if (vecHole) {
      const closedPath = (points, fill) => {
        if (!points?.length) return;
        ctx.beginPath();
        points.forEach((point, index) => {
          const p = project(point.x, point.y);
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      };
      const arcs = [0];
      for (let i = 1; i < pts.length; i++) {
        arcs.push(arcs[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      }
      const routeLen = Math.max(0.001, arcs.at(-1));
      const widthYd = (t) => {
        const stops = vecHole.width || [];
        if (!stops.length) return 5;
        if (t <= stops[0].t) return stops[0].w;
        for (let i = 1; i < stops.length; i++) {
          if (t > stops[i].t) continue;
          const a = stops[i - 1];
          const b = stops[i];
          const k0 = (t - a.t) / Math.max(0.001, b.t - a.t);
          const k = k0 * k0 * (3 - 2 * k0);
          return a.w + (b.w - a.w) * k;
        }
        return stops.at(-1).w;
      };
      const corridor = (extraYd) => {
        const left = [];
        const right = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[Math.max(0, i - 1)];
          const b = pts[Math.min(pts.length - 1, i + 1)];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.max(0.001, Math.hypot(dx, dy));
          const half = (widthYd(arcs[i] / routeLen) + extraYd) / 8;
          left.push({ x: pts[i].x - (dy / len) * half, y: pts[i].y + (dx / len) * half });
          right.push({ x: pts[i].x + (dy / len) * half, y: pts[i].y - (dx / len) * half });
        }
        return [...left, ...right.reverse()];
      };

      closedPath(corridor(Math.max(10, vecHole.roughW || 24)), zoneColor(ZONE.ROUGH));
      closedPath(corridor(1.4), zoneColor(ZONE.SEMI));
      closedPath(corridor(0), zoneColor(ZONE.FAIRWAY));

      // Hazards are part of the hole's strategy. Water used to be omitted from
      // the compact card entirely, so Millpond looked like a generic straight
      // par four from the tee even though its approach is defined by the pond.
      for (const water of c.vec?.waters || []) {
        if (!water.pts?.some((point) => project(point.x, point.y).inWindow)) continue;
        closedPath(water.pts, zoneColor(ZONE.WATER));
      }

      // Show the selected hole's nearby circulation, not every neighboring
      // branch that happens to enter the local map window. The old full-network
      // stroke overwhelmed H7's S-shaped strategy line with H6/H8's loop.
      const closeToRoute = (point) => {
        for (let i = 1; i < pts.length; i++) {
          if (distToSegment(point.x, point.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= 5.5) return true;
        }
        return false;
      };
      ctx.strokeStyle = 'rgba(139, 137, 130, 0.58)';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const path of c.paths || []) {
        const pathPts = sampleOpen(path.pts || [], 0.2);
        if (pathPts.length < 2) continue;
        ctx.beginPath();
        let drawing = false;
        for (let index = 1; index < pathPts.length; index++) {
          const prior = pathPts[index - 1];
          const point = pathPts[index];
          if (!closeToRoute(prior) && !closeToRoute(point)) {
            drawing = false;
            continue;
          }
          const a = project(prior.x, prior.y);
          const b = project(point.x, point.y);
          if (!drawing) ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          drawing = true;
        }
        ctx.lineWidth = Math.max(1, ((path.width || 2.7) / 8) * s);
        ctx.stroke();
      }

      for (const tee of vecHole.tees || []) {
        const ca = Math.cos(tee.rot);
        const sa = Math.sin(tee.rot);
        const hd = (tee.d / 8) / 2;
        const hw = (tee.w / 8) / 2;
        closedPath([
          { x: tee.x + ca * hd - sa * hw, y: tee.y + sa * hd + ca * hw },
          { x: tee.x + ca * hd + sa * hw, y: tee.y + sa * hd - ca * hw },
          { x: tee.x - ca * hd + sa * hw, y: tee.y - sa * hd - ca * hw },
          { x: tee.x - ca * hd - sa * hw, y: tee.y - sa * hd + ca * hw },
        ], zoneColor(ZONE.TEE));
      }
      if (vecHole.green?.pts?.length) {
        const greenPts = vecHole.green.pts;
        ctx.beginPath();
        greenPts.forEach((point, index) => {
          const p = project(point.x, point.y);
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.strokeStyle = zoneColor(ZONE.FRINGE);
        ctx.lineWidth = Math.max(2, ((vecHole.green.fringe || 1) / 8) * s * 2);
        ctx.stroke();
        ctx.fillStyle = zoneColor(ZONE.GREEN);
        ctx.fill();
      }
      for (const bunker of vecHole.bunkers || []) closedPath(bunker.pts, zoneColor(ZONE.BUNKER));
    } else {
      // Legacy saves without vectors retain the coarse simulation-grid preview.
      for (let y = Math.max(0, Math.floor(minY)); y < Math.min(c.h, Math.ceil(maxY)); y++) {
        for (let x = Math.max(0, Math.floor(minX)); x < Math.min(c.w, Math.ceil(maxX)); x++) {
          const z = c.zones[y * c.w + x];
          if (z === ZONE.OUT) continue;
          const p = project(x + 0.5, y + 0.5);
          if (!p.inWindow) continue;
          ctx.fillStyle = zoneColor(z);
          const dot = Math.max(1.4, s * 1.45);
          ctx.fillRect(p.x - dot / 2, p.y - dot / 2, dot, dot);
        }
      }
    }
    // Authored strategy line: subtle enough to keep the turf readable, but
    // clear enough that a dogleg never collapses into a generic blob.
    ctx.strokeStyle = 'rgba(255, 244, 204, 0.55)';
    ctx.lineWidth = Math.max(1, s * 0.48);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((point, index) => {
      const p = project(point.x, point.y);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    // tee + pin dots
    const teePoint = project(hole.tee.x, hole.tee.y);
    const pinPoint = project(hole.pin.x, hole.pin.y);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(teePoint.x, teePoint.y, 3, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#ffdd66';
    ctx.beginPath();
    ctx.arc(pinPoint.x, pinPoint.y, 3, 0, 7);
    ctx.fill();
    return cnv;
  }

  function openHoleSelect() {
    const holes = holesOf();
    const grid = el('div', { class: 'ced-holegrid' });
    let picked = selectedHole() || holes[0] || null;
    const foot = el('div', { class: 'ced-holefoot' });
    const renderFoot = () => {
      foot.replaceChildren();
      if (!picked) return;
      const yd = Math.round(holeDistanceYd(picked));
      foot.append(
        el('div', {},
          el('b', { text: `${picked.name}` }),
          el('span', { class: 'ced-note', text: `  Par ${holePar(picked)} · ${yd} yd · ${picked.status}` }),
        ),
        el('div', {},
          el('button', {
            title: 'Fly the hole from tee to green',
            onclick: () => {
              closeModal();
              selectHole(picked, { frame: false });
              startFlyover(picked);
            },
          }, svgIcon('play'), el('span', { text: 'Flyover' })),
          el('button', {
            onclick: () => {
              selectHole(picked);
              closeModal();
            },
          }, svgIcon('frame'), el('span', { text: 'Frame it' })),
          el('button', {
            class: 'primary',
            text: 'Edit Hole',
            onclick: () => {
              closeModal();
              selectHole(picked);
              openHoleSettings(picked);
            },
          }),
        ),
      );
    };
    holes.forEach((h) => {
      const n = holeNumber(state().course, h.id);
      const card = el('button', { class: 'ced-holecard', onclick: () => { picked = h; renderFoot(); for (const sib of grid.children) sib.classList.toggle('on', sib === card); } },
        el('div', { class: 'ced-holenum', text: String(n) }),
        holeMiniCanvas(h),
        el('div', { class: 'ced-holemeta', text: h.tee && h.pin ? `Par ${holePar(h)} · ${Math.round(holeDistanceYd(h))} yd` : 'unbuilt' }),
      );
      if (h === picked) card.classList.add('on');
      grid.append(card);
    });
    // add-hole card
    grid.append(el('button', {
      class: 'ced-holecard add',
      onclick: () => {
        const res = newHole(state(), session);
        if (res.ok) {
          toast(`Hole ${state().course.holes.length} surveyed (${formatMoney(res.cost)} pending) - paint its fairway, green and tee.`);
          refreshTop();
          closeModal();
          openHoleSelect();
        }
      },
    }, el('div', { class: 'ced-holenum', text: '+' }), el('div', { class: 'ced-holemeta', text: 'Add hole' })));

    const par = holes.reduce((a, h) => a + (h.tee && h.pin ? holePar(h) : 0), 0);
    const yds = Math.round(holes.reduce((a, h) => a + holeDistanceYd(h), 0));
    openModal(
      el('div', { class: 'ced-modal-head' },
        el('b', { text: 'Select a Hole to Edit' }),
        el('span', { class: 'ced-note', text: `Par ${par} · ${yds.toLocaleString('en-US')} yards` }),
        el('button', { text: '✕', class: 'ced-x', onclick: closeModal }),
      ),
      grid,
      foot,
    );
    renderFoot();
  }

  function openHoleSettings(hole) {
    ensureHoleShape(hole, holeNumber(state().course, hole.id));
    const name = el('input', { type: 'text', value: hole.name, maxlength: '28' });
    const parAuto = holePar({ ...hole, parOverride: null });
    let parOv = hole.parOverride;
    const parLabel = el('b', { text: String(parOv ?? parAuto) });
    const handicap = el('input', { type: 'number', min: '1', max: '18', value: String(hole.handicap) });
    const yd = Math.round(holeDistanceYd(hole));

    const pinSeg = segButtons([['A', 'A'], ['B', 'B'], ['C', 'C']], hole.activePin, (k) => {
      const res = selectPin(state(), session, hole.id, k);
      if (!res.ok) toast(res.reason, 'warn');
      else {
        scene().updateHoles();
        refreshTop();
      }
    });
    const teeSeg = segButtons([['back', 'Back'], ['middle', 'Middle'], ['forward', 'Fwd']], hole.activeTee, (k) => {
      const res = selectTee(state(), session, hole.id, k);
      if (!res.ok) toast(res.reason, 'warn');
      else {
        scene().updateHoles();
        refreshTop();
      }
    });

    openModal(
      el('div', { class: 'ced-modal-head' },
        el('b', { text: `${hole.name} - settings` }),
        el('button', { text: '✕', class: 'ced-x', onclick: closeModal }),
      ),
      el('div', { class: 'ced-settings' },
        el('div', { class: 'ced-set-col' },
          el('div', { class: 'ced-row' }, el('label', { text: 'Hole name' }), name),
          el('div', { class: 'ced-row' }, el('label', { text: 'Par' }),
            el('button', {
              text: '−',
              onclick: () => { parOv = clamp((parOv ?? parAuto) - 1, 3, 5); parLabel.textContent = String(parOv); },
            }),
            parLabel,
            el('button', {
              text: '+',
              onclick: () => { parOv = clamp((parOv ?? parAuto) + 1, 3, 5); parLabel.textContent = String(parOv); },
            }),
            el('button', {
              text: 'Auto',
              title: `Distance says par ${parAuto}`,
              onclick: () => { parOv = null; parLabel.textContent = String(parAuto); },
            }),
          ),
          el('div', { class: 'ced-row' }, el('label', { text: 'Yardage' }), el('b', { text: `${yd} yd` }), el('span', { class: 'ced-note', text: '(tee → pin)' })),
          el('div', { class: 'ced-row' }, el('label', { text: 'Handicap' }), handicap),
          el('div', { class: 'ced-row' }, el('label', { text: 'Tee box' }), teeSeg),
          el('div', { class: 'ced-row' }, el('label', { text: 'Pin position' }), pinSeg),
          el('div', { class: 'ced-row' },
            el('button', { text: '↑ Earlier', onclick: () => { reorderHole(state(), session, hole.id, -1); refreshTop(); } }),
            el('button', { text: '↓ Later', onclick: () => { reorderHole(state(), session, hole.id, +1); refreshTop(); } }),
          ),
        ),
        el('div', { class: 'ced-set-col' }, holeMiniCanvas(hole, 150, 210)),
      ),
      el('div', { class: 'ced-modal-foot' },
        el('button', {
          class: 'danger',
          text: 'Delete hole',
          onclick: () => {
            openModal(
              el('div', { class: 'ced-modal-head' }, el('b', { text: `Delete ${hole.name}?` })),
              el('div', { class: 'ced-note', text: 'The land stays as painted; the hole (tee/pin/score card) is removed. Undo can bring it back before you build.' }),
              el('div', { class: 'ced-modal-foot' },
                el('button', { text: 'Keep it', onclick: () => { closeModal(); openHoleSettings(hole); } }),
                el('button', {
                  class: 'danger',
                  text: 'Delete',
                  onclick: () => {
                    deleteHole(state(), session, hole.id);
                    scene().updateHoles();
                    refreshTop();
                    closeModal();
                    toast(t('editor.holeDeleted', { hole: hole.name }));
                  },
                }),
              ),
            );
          },
        }),
        el('button', {
          text: 'Duplicate settings',
          title: 'Creates a new unbuilt hole with these settings - paint its ground, then place tee and pin',
          onclick: () => {
            const res = newHole(state(), session);
            if (res.ok) {
              setHoleSettings(state(), session, res.hole.id, { name: `${name.value} II`, handicap: Number(handicap.value) || hole.handicap, parOverride: parOv });
              toast(t('editor.newHoleAddedWith'));
              refreshTop();
            }
          },
        }),
        el('button', { text: 'Cancel', onclick: closeModal }),
        el('button', {
          class: 'primary',
          text: 'Apply',
          onclick: () => {
            setHoleSettings(state(), session, hole.id, {
              name: name.value.trim() || hole.name,
              handicap: clamp(Number(handicap.value) || hole.handicap, 1, 18),
              parOverride: parOv,
            });
            scene().updateHoles();
            refreshTop();
            closeModal();
          },
        }),
      ),
    );
  }

  // ------------------------------------------------------------ save ----

  let lastSavedText = null;

  function openSaveDialog() {
    const bill = session ? Math.round(session.bill) : 0;
    const nameInput = el('input', { type: 'text', value: state().clubName, maxlength: '40' });
    openModal(
      el('div', { class: 'ced-modal-head' },
        el('b', { text: 'Save course' }),
        el('button', { text: '✕', class: 'ced-x', onclick: closeModal }),
      ),
      el('div', { class: 'ced-save-body' },
        el('div', { class: 'ced-save-fields' },
          el('div', { class: 'ced-row' }, el('label', { text: 'Course name' }), nameInput),
          bill > 0
            ? el('div', { class: 'ced-note warn', text: `Unbuilt works worth ${formatMoney(bill)} are pending - Build applies and pays for them first.` })
            : el('div', { class: 'ced-note', text: 'The course is settled - saving stores it to the autosave.' }),
          el('div', { class: 'ced-note', text: lastSavedText ? `Last saved: ${lastSavedText}` : 'Not saved from the editor yet this visit.' }),
        ),
        el('div', { class: 'ced-save-thumbwrap' },
          courseThumbCanvas(),
          el('div', { class: 'ced-holemeta', text: `${state().clubName}` }),
        ),
      ),
      el('div', { class: 'ced-modal-foot' },
        el('button', {
          text: 'Export JSON',
          title: 'Download the raw course data as a backup',
          onclick: () => {
            const c = state().course;
            const data = {
              version: state().version,
              clubName: state().clubName,
              w: c.w,
              h: c.h,
              zones: Array.from(c.zones),
              elevation: Array.from(c.elevation),
              holes: c.holes,
              nextHoleId: c.nextHoleId,
              objects: c.objects,
              nextObjectId: c.nextObjectId,
              paths: c.paths,
              nextPathId: c.nextPathId,
              structures: c.structures,
              vec: c.vec || null,
              paint: c.paint ? Array.from(c.paint) : null,
              editor: { ...editorPrefs() },
            };
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${state().clubName.replace(/\W+/g, '_').toLowerCase()}_course.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            toast(t('editor.courseDataExported'));
          },
        }),
        el('button', { text: 'Cancel', onclick: closeModal }),
        el('button', {
          class: 'primary',
          text: bill > 0 ? 'Build & save' : 'Save',
          onclick: () => {
            if (nameInput.value.trim()) state().clubName = nameInput.value.trim();
            if (bill > 0) {
              if (!doApply()) return;
            }
            hooks.autosave();
            lastSavedText = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            toast(t('editor.courseSaved'));
            closeModal();
            refreshTop();
          },
        }),
      ),
    );
  }

  // ------------------------------------------------------- apply flow ----

  function doApply() {
    const res = applySession(state(), session);
    if (!res.ok) {
      toast(res.reason, 'warn');
      return false;
    }
    hooks.afterApply();
    const closed = res.report.holesAffected.length;
    toast(`Works complete - ${formatMoney(res.report.cost)}${closed ? ` · ${closed} hole${closed > 1 ? 's' : ''} closed for renovation` : ''}.`);
    refreshTop();
    renderToolPanel();
    return true;
  }

  const nextEditorFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  function discardRefreshTiles(operations, kinds, padding = 0, { fullOnMissing = true } = {}) {
    const course = state().course;
    const keys = new Set();
    const addRect = (rect) => {
      const x0 = clamp(Math.floor(rect.x0 - padding), 0, course.w - 1);
      const y0 = clamp(Math.floor(rect.y0 - padding), 0, course.h - 1);
      const x1 = clamp(Math.ceil(rect.x1 + padding), 0, course.w - 1);
      const y1 = clamp(Math.ceil(rect.y1 + padding), 0, course.h - 1);
      for (let y = Math.floor(y0 / DISCARD_TILE_CELLS); y <= Math.floor(y1 / DISCARD_TILE_CELLS); y++) {
        for (let x = Math.floor(x0 / DISCARD_TILE_CELLS); x <= Math.floor(x1 / DISCARD_TILE_CELLS); x++) {
          keys.add(`${x}:${y}`);
        }
      }
    };
    for (const operation of operations) {
      if (!kinds.has(operation.kind)) continue;
      if (operation.rect) addRect(operation.rect);
      else if (fullOnMissing) addRect({ x0: 0, y0: 0, x1: course.w - 1, y1: course.h - 1 });
    }
    return [...keys].map((key) => {
      const [tileX, tileY] = key.split(':').map(Number);
      return {
        x0: tileX * DISCARD_TILE_CELLS,
        y0: tileY * DISCARD_TILE_CELLS,
        x1: Math.min(course.w - 1, (tileX + 1) * DISCARD_TILE_CELLS - 1),
        y1: Math.min(course.h - 1, (tileY + 1) * DISCARD_TILE_CELLS - 1),
      };
    });
  }

  async function refreshDiscardOperations(operations) {
    const list = operations || [];
    const terrainKinds = new Set(['terrain', 'vec', 'stamp']);
    const zoneKinds = new Set(['paint', 'vector-paint', 'vec', 'stamp', 'path']);
    const terrainTiles = discardRefreshTiles(list, terrainKinds, RELIEF_PAD_CELLS);
    const zoneTiles = discardRefreshTiles(list, zoneKinds, PAINT_FIELD_PAD_CELLS, {
      // A material-only path edit has no raster footprint. Rebuilding the path
      // mesh is sufficient and avoids turning that case into a full field pass.
      fullOnMissing: false,
    });
    const hasKind = (predicate) => list.some((operation) => predicate(operation.kind));
    const relief = hasKind((kind) => kind === 'vec' || kind === 'stamp');
    const terrain = terrainTiles.length > 0;
    const paths = hasKind((kind) => kind === 'path' || terrainKinds.has(kind));
    const water = hasKind((kind) => terrainKinds.has(kind));
    const objects = hasKind((kind) => kind.startsWith('object-'));
    const holes = hasKind((kind) => kind === 'hole' || kind.startsWith('hole-') || terrainKinds.has(kind));
    const flow = hasKind((kind) => kind === 'hole' || kind === 'hole-add' || kind === 'hole-delete'
      || kind === 'vec' || kind === 'stamp');

    // Each terrain tile is a separate browser frame. Even a course-wide
    // rollback therefore never turns into the old monolithic 1+ second frame.
    for (let i = 0; i < terrainTiles.length; i++) {
      scene().refreshGround(state(), {
        relief: relief && i === 0,
        terrainRect: terrainTiles[i],
        zones: false,
        turf: false,
      });
      await nextEditorFrame();
    }

    if (water || paths || objects || holes || flow) {
      scene().refreshGround(state(), {
        terrain: false,
        zones: false,
        turf: false,
        water,
        paths,
        objects,
        holes,
        flow,
      });
      await nextEditorFrame();
    }

    for (const rect of zoneTiles) {
      scene().updateZoneField(state(), rect, { padding: 0 });
      scene().updateTurf(state(), rect);
      await nextEditorFrame();
    }
    finishHistoryRefresh();
  }

  async function discardPendingWork() {
    commitObjectControlGesture();
    setSelected(null);
    const result = discardSession(state(), session);
    clearFeatureSelections();
    clearPathSelection();
    await refreshDiscardOperations(result.operations);
    return result;
  }

  function doDiscard() {
    openModal(
      el('div', { class: 'ced-modal-head' }, el('b', { text: 'Discard all pending works?' })),
      el('div', { class: 'ced-note', text: 'Every unbuilt change since your last Build will be rolled back. Nothing already built is touched.' }),
      el('div', { class: 'ced-modal-foot' },
        el('button', { text: 'Keep editing', onclick: closeModal }),
        el('button', {
          class: 'danger',
          text: 'Discard',
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = 'Discarding...';
            try {
              await discardPendingWork();
              closeModal();
              toast(t('editor.pendingWorksDiscarded'));
            } catch (error) {
              console.error('course editor discard refresh failed', error);
              button.disabled = false;
              button.textContent = 'Discard';
              toast(t('editor.theUndoDidNot'), 'warn');
            }
          },
        }),
      ),
    );
  }

  function doUndo() {
    const res = undo(state(), session);
    if (res.ok) {
      clearFeatureSelections();
      clearPathSelection();
      refreshHistoryOp(res);
      toast(t('editor.undid', { what: res.label }));
    }
  }

  function doRedo() {
    const res = redo(state(), session);
    if (res.ok) {
      clearFeatureSelections();
      clearPathSelection();
      refreshHistoryOp(res);
      toast(t('editor.redid', { what: res.label }));
    }
  }

  function finishHistoryRefresh() {
    scene().setEditorFeaturePreview?.(null);
    refreshTop();
    renderToolPanel();
  }

  function refreshHistoryOp({ kind, rect = null }) {
    if (selectedPathId != null && !selectedPath()) clearPathSelection();

    if (kind === 'paint' || kind === 'vector-paint') {
      // Paint changes no geometry, water, objects, paths, hole markers, relief,
      // or flow. Rebuilding all of those made a one-brush undo far more
      // expensive than the edit itself.
      scene().updateZoneField(state(), rect, { padding: PAINT_FIELD_PAD_CELLS });
      scene().updateTurf(state(), rect);
      finishHistoryRefresh();
      return;
    }

    if (kind === 'terrain') {
      const dependencies = terrainRefreshDependencies(rect);
      scene().refreshGround(state(), {
        ...dependencies, zones: false, relief: true, turf: false,
        terrainRect: rect ? {
          x0: rect.x0 - RELIEF_PAD_CELLS, y0: rect.y0 - RELIEF_PAD_CELLS,
          x1: rect.x1 + RELIEF_PAD_CELLS, y1: rect.y1 + RELIEF_PAD_CELLS,
        } : null,
      });
      finishHistoryRefresh();
      return;
    }

    if (kind === 'object-add' || kind === 'object-remove'
      || kind === 'object-move' || kind === 'object-scatter') {
      rebuildObjectVisuals();
      finishHistoryRefresh();
      return;
    }

    if (kind === 'path') {
      scene().refreshGround(state(), {
        paths: true, terrain: false, zoneRect: rect,
      });
      finishHistoryRefresh();
      return;
    }

    if (kind === 'hole-settings' || kind === 'hole-reorder') {
      scene().updateHoles();
      finishHistoryRefresh();
      return;
    }

    if (kind === 'hole' || kind === 'hole-add' || kind === 'hole-delete') {
      scene().updateHoles();
      scene().rebuildFlowField();
      scene().updateTurf(state());
      finishHistoryRefresh();
      return;
    }

    // Vector feature stamps and edits can affect analytical relief, water,
    // paths, hole markers, flow, and the visual field. Keep the broad refresh
    // for those operations, but retain the operation's proven dirty window.
    fullRefresh(rect);
  }

  function refreshObjects() {
    rebuildObjectVisuals();
    refreshTop();
  }

  function rebuildObjectVisuals() {
    scene().rebuildObjects();
    scene().rebuildTrees();
  }

  function fullRefresh(rect = null) {
    if (selectedPathId != null && !selectedPath()) clearPathSelection();
    // relief: true is required here. Undo/redo/discard can revert a green, tee,
    // bunker or water feature, and on vector courses those live in the cached
    // analytic relief sculpt — without invalidating it the data and the surface
    // colours roll back but the old plateau or bowl stays in the terrain mesh.
    //
    // rect is the footprint of the single op being undone or redone, so one
    // undo no longer rebuilds the whole course (measured 848 ms -> 19.5 ms).
    // Discard has its own tiled refresh path; this broad fallback remains for
    // history kinds that cannot provide a component-specific footprint.
    scene().refreshGround(state(), {
      water: true, objects: true, paths: true, holes: true, flow: true, relief: true,
      zoneRect: rect,
      terrainRect: rect ? {
        x0: rect.x0 - RELIEF_PAD_CELLS, y0: rect.y0 - RELIEF_PAD_CELLS,
        x1: rect.x1 + RELIEF_PAD_CELLS, y1: rect.y1 + RELIEF_PAD_CELLS,
      } : null,
    });
    finishHistoryRefresh();
  }

  function requestExit() {
    if (session && sessionDirty(session)) {
      const bill = Math.round(session.bill);
      openModal(
        el('div', { class: 'ced-modal-head' }, el('b', { text: 'Leave the editor?' })),
        el('div', { class: 'ced-note', text: bill > 0 ? `Pending works worth ${formatMoney(bill)} are not built yet.` : 'There are unapplied edits.' }),
        el('div', { class: 'ced-modal-foot' },
          el('button', { text: 'Stay', onclick: closeModal }),
          el('button', {
            class: 'danger',
            text: 'Discard & leave',
            onclick: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              button.textContent = 'Discarding...';
              try {
                await discardPendingWork();
                closeModal();
                hooks.onExit();
              } catch (error) {
                console.error('course editor discard-and-leave refresh failed', error);
                button.disabled = false;
                button.textContent = 'Discard & leave';
                toast(t('editor.theUndoDidNot'), 'warn');
              }
            },
          }),
          el('button', {
            class: 'primary',
            text: 'Build & leave',
            onclick: () => {
              if (doApply()) {
                closeModal();
                hooks.onExit();
              }
            },
          }),
        ),
      );
      return;
    }
    hooks.onExit();
  }

  // ------------------------------------------------------ pointer input ----

  function groundAt(e) {
    return scene() ? scene().raycastGround(e.clientX, e.clientY) : null;
  }

  // Editor ray hits retain the historical cell-centre coordinate (`fx/fy`)
  // used by objects and integer hole markers. Vector features, paths, and
  // brush footprints live on the continuous terrain plane, half a cell ahead.
  // Keep that distinction explicit so the preview, committed vector, surface
  // mask, and rendered geometry occupy the same world position.
  function authoringPoint(g) {
    const offset = state().course.vec ? 0.5 : 0;
    return { x: g.fx + offset, y: g.fy + offset };
  }

  function authoredWorldX(sc, x) {
    return state().course.vec && sc.vectorWorldX ? sc.vectorWorldX(x) : sc.worldX(x);
  }

  function authoredWorldZ(sc, y) {
    return state().course.vec && sc.vectorWorldZ ? sc.vectorWorldZ(y) : sc.worldZ(y);
  }

  function yd2cells(yd) {
    return Math.max(0.5, yd / 8 / 2); // diameter yd → radius cells
  }

  function objectPlacementPoint(g) {
    const cell = snapCoursePoint(g.fx, g.fy, {
      enabled: opt.objects.snapYd > 0,
      incrementYd: opt.objects.snapYd || 1,
    }) || { x: g.fx, y: g.fy };
    return {
      x: cell.x,
      y: cell.y,
      worldX: scene().worldX(cell.x),
      worldZ: scene().worldZ(cell.y),
    };
  }

  // Grow both dirty rects a stroke carries, in cells:
  //   rect     — cumulative, for the commit/undo refresh at stroke end
  //   liveRect — only what changed since the last live refresh
  // The live refresh must use liveRect. Feeding it the cumulative rect makes
  // every tick of a long drag re-scope over everything painted so far, so the
  // work grows with stroke length instead of staying brush-sized.
  function growStrokeRect(point, r) {
    if (!stroke) return;
    for (const key of ['rect', 'liveRect']) {
      const box = stroke[key];
      if (!box) {
        stroke[key] = { x0: point.x - r, y0: point.y - r, x1: point.x + r, y1: point.y + r };
        continue;
      }
      box.x0 = Math.min(box.x0, point.x - r);
      box.y0 = Math.min(box.y0, point.y - r);
      box.x1 = Math.max(box.x1, point.x + r);
      box.y1 = Math.max(box.y1, point.y + r);
    }
  }

  function takeLiveRect() {
    if (!stroke) return null;
    const box = stroke.liveRect || stroke.rect || null;
    stroke.liveRect = null;
    return box;
  }

  // Terrain only (applyTerrainAt is the sole caller).
  function liveRefreshThrottled() {
    const now = performance.now();
    if (now - strokeClock > 80) {
      strokeClock = now;
      // zones: false — sculpting moves land, not surfaces, exactly as the
      // stroke-end refresh already documents. evalPacked never reads elevation,
      // so the zone/distance field cannot change under a terrain brush.
      //
      // This used to pass {}, which defaults zones:true, so every tick of a
      // drag rebuilt the entire 1920x1280 visual field. Measured: ~1452 ms per
      // tick, against ~276 ms with the field skipped — ~81% of the cost of
      // dragging the terrain brush was rebuilding a mask that cannot change.
      //
      // terrainRect then scopes the remaining mesh rebuild to the brush, so a
      // stroke no longer walks all 346,801 vertices per tick either.
      scene().refreshGround(state(), { zones: false, terrainRect: takeLiveRect(), turf: false });
    }
  }

  function editableFeatureEntries(kind) {
    const course = state().course;
    if (kind === 'green') {
      const hole = selectedHole();
      const feature = vectorHoleForRecord(course, hole)?.green;
      return hole && feature
        ? [{ feature, selection: { holeId: hole.id }, closed: true }]
        : [];
    }
    if (kind === 'bunker') {
      const hole = selectedHole();
      const bunkers = vectorHoleForRecord(course, hole)?.bunkers || [];
      return hole ? bunkers.map((feature, index) => ({
        feature,
        selection: { holeId: hole.id, ref: editorFeatureRef(feature, index) },
        closed: true,
      })) : [];
    }
    if (kind === 'water') {
      const waters = (course.vec?.waters || [])
        .map((feature, index) => ({ feature, index }))
        .filter(({ feature }) => feature.kind === 'pond' || feature.kind === 'lake' || !feature.kind)
        .map(({ feature, index }) => ({
          feature,
          selection: { source: 'water', ref: editorFeatureRef(feature, index) },
          source: 'water',
          closed: true,
        }));
      const streams = (course.vec?.streams || []).map((feature, index) => ({
        feature,
        selection: { source: 'stream', ref: editorFeatureRef(feature, index) },
        source: 'stream',
        closed: false,
      }));
      return [...waters, ...streams];
    }
    return [];
  }

  function nearestEditableFeature(entries, x, y, maxDistance) {
    let best = null;
    for (const entry of entries) {
      const distance = entry.closed
        ? editorBoundaryDistance(entry.feature?.pts, x, y)
        : editorPolylineDistance(entry.feature?.pts, x, y);
      if (distance <= maxDistance && (!best || distance < best.distance)) best = { entry, distance };
    }
    return best;
  }

  function nearestEditableControl(entries, x, y, maxDistance) {
    let best = null;
    for (const entry of entries) {
      const nearest = nearestEditorControlPoint(entry.feature?.pts, x, y, maxDistance);
      if (nearest && (!best || nearest.distance < best.distance)) {
        best = { entry, index: nearest.index, distance: nearest.distance };
      }
    }
    return best;
  }

  function beginFeatureBoundaryInteraction(kind, g) {
    const point = authoringPoint(g);
    const entries = editableFeatureEntries(kind);
    const control = nearestEditableControl(entries, point.x, point.y, 0.9);
    const picked = control || nearestEditableFeature(entries, point.x, point.y, 2.5);
    if (!picked) return false;
    const { entry } = picked;
    featureSelection[kind] = entry.selection;
    opt[kind].mode = 'edit';
    if (control) {
      const originalPts = entry.feature.pts.map((point) => ({ x: point.x, y: point.y }));
      featureDrag = {
        kind,
        source: entry.source || null,
        selection: { ...entry.selection },
        pointIndex: control.index,
        originalPts,
        previewPts: originalPts.map((point) => ({ ...point })),
        moved: false,
      };
    } else {
      featureDrag = null;
    }
    renderToolPanel();
    refreshSelectedBoundaryPreview();
    return true;
  }

  function nearestPathControlPoint(paths, x, y, maxDistance) {
    let best = null;
    for (const path of paths) {
      const nearest = nearestEditorControlPoint(path.pts, x, y, maxDistance);
      if (nearest && (!best || nearest.distance < best.distance)) {
        best = { path, index: nearest.index, distance: nearest.distance };
      }
    }
    return best;
  }

  function beginPathEditInteraction(g) {
    const point = authoringPoint(g);
    const paths = state().course.paths || [];
    const control = nearestPathControlPoint(paths, point.x, point.y, 0.9);
    const centerline = control ? null : nearestEditorPolylineFeature(paths, point.x, point.y, 2.5);
    const path = control?.path || centerline?.feature;
    if (!path) return false;
    selectedPathId = path.id;
    opt.paths.mode = 'edit';
    drawingPath = null;
    scene().setMeasureLine(null);
    if (control) {
      const originalPts = path.pts.map((point) => ({ x: point.x, y: point.y }));
      pathDrag = {
        pathId: path.id,
        pointIndex: control.index,
        originalPts,
        previewPts: originalPts.map((point) => ({ ...point })),
        moved: false,
      };
    } else {
      pathDrag = null;
    }
    renderToolPanel();
    refreshSelectedPathPreview();
    return true;
  }

  function onPointerDown(e) {
    if (!active || pt) return;
    if (flyover) {
      // Let the native selector open during flight. Its change handler cancels
      // without restoring the old preset, then applies the user's new choice.
      if (e.target === ui.cameraSel || ui.cameraSel.contains(e.target)) return;
      stopFlyover();
      return;
    }
    if (modalEl) return;
    if (e.target !== scene().renderer.domElement) return;
    const g = groundAt(e);
    if (e.button === 1) {
      scene().clearCourseCameraPreset?.();
      camDrag = { mode: 'pan', x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      // paint's right button IS the eraser (drag to erase) — everywhere else,
      // right button is contextual action on CLICK, camera orbit on DRAG
      if (tool === 'paint' && g && g.inBounds) {
        stroke = { s: beginPaintStroke(), erase: true };
        applyPaintAt(g, true);
        return;
      }
      camDrag = { mode: 'maybe-orbit', x: e.clientX, y: e.clientY, moved: 0 };
      return;
    }
    if (e.button !== 0) return;
    if (!g || !g.inBounds) {
      if (tool === 'select') setSelected(null);
      return;
    }
    switch (tool) {
      case 'select': {
        const obj = scene().pickObject(g.point.x, g.point.z, 3.5);
        setSelected(obj);
        if (obj) {
          draggingObj = {
            kind: 'object',
            gesture: beginObjectGesture(state(), obj.id, 'Move object'),
          };
          draggingObj.gesture.protectPlay = true;
        }
        break;
      }
      case 'terrain': {
        stroke = beginTerrainStroke(state(), session);
        applyTerrainAt(g);
        break;
      }
      case 'paint': {
        stroke = { s: beginPaintStroke(), erase: false };
        applyPaintAt(g, false);
        break;
      }
      case 'tee': {
        const point = authoringPoint(g);
        const hole = holesOf().find((h) => h.id === opt.tee.holeId);
        if (!hole) {
          toast(t('editor.pickAHoleFirst'), 'warn');
          break;
        }
        const markerOffset = state().course.vec ? 0.5 : 0;
        const pinAim = hole.pin
          ? { x: hole.pin.x + markerOffset, y: hole.pin.y + markerOffset }
          : { x: point.x + 4, y: point.y };
        const teeAngle = Math.atan2(pinAim.y - point.y, pinAim.x - point.x)
          + (opt.tee.rot * Math.PI) / 180;
        const aim = { x: point.x + Math.cos(teeAngle) * 4, y: point.y + Math.sin(teeAngle) * 4 };
        const res = stampTee(state(), session, hole.id, opt.tee.teeKey, point.x, point.y, aim.x, aim.y);
        if (!res.ok) toast(res.reason || 'Cannot build here.', 'warn');
        else {
          scene().refreshGround(state(), { holes: true, flow: true, relief: true, zoneRect: zr(point.x, point.y, 6), terrainRect: zr(point.x, point.y, 6 + RELIEF_PAD_CELLS) });
          refreshTop();
          renderToolPanel();
          toast(`${opt.tee.teeKey[0].toUpperCase()}${opt.tee.teeKey.slice(1)} tee built (${formatMoney(res.cost)} pending).`);
        }
        break;
      }
      case 'green': {
        if (opt.green.pin) {
          const hole = selectedHole();
          if (!hole) {
            toast(t('editor.selectAHoleFirst'), 'warn');
            break;
          }
          const res = setPinPosition(state(), session, hole.id, opt.green.pin, g.x, g.y);
          if (!res.ok) toast(res.reason, 'warn');
          else {
            scene().updateHoles();
            scene().rebuildFlowField();
            refreshTop();
            renderToolPanel();
            toast(t('editor.pinSet', { pin: opt.green.pin, hole: hole.name }));
          }
          break;
        }
        if (opt.green.mode === 'edit') {
          beginFeatureBoundaryInteraction('green', g);
          break;
        }
        const hole = selectedHole();
        if (!hole) {
          toast(t('editor.selectAHoleFirst'), 'warn');
          break;
        }
        const point = authoringPoint(g);
        const r = yd2cells(opt.green.sizeYd);
        const res = stampGreen(state(), session, point.x, point.y, {
          r,
          elong: opt.green.shape === 'round' ? 1.02 : 1.35,
          angle: (opt.green.rot * Math.PI) / 180,
          kidney: opt.green.shape === 'kidney',
          holeId: hole.id,
        });
        if (res.ok) {
          scene().refreshGround(state(), { relief: true, holes: true, zoneRect: zr(point.x, point.y, r * 1.8 + 3), terrainRect: zr(point.x, point.y, r * 1.8 + 3 + RELIEF_PAD_CELLS) });
          refreshTop();
          renderToolPanel();
        } else toast(res.reason || 'The green needs open ground.', 'warn');
        break;
      }
      case 'bunker': {
        if (opt.bunker.mode === 'edit') {
          beginFeatureBoundaryInteraction('bunker', g);
          break;
        }
        const hole = selectedHole();
        if (!hole) {
          toast(t('editor.selectAHoleFirst'), 'warn');
          break;
        }
        const point = authoringPoint(g);
        const res = stampBunker(state(), session, point.x, point.y, {
          r: yd2cells(opt.bunker.sizeYd),
          depth: state().course.vec ? Math.max(0.1, opt.bunker.depth - 0.8) : opt.bunker.depth,
          lobes: opt.bunker.shape === 'round' ? 1 : opt.bunker.shape === 'oval' ? 2 : 3,
          stretch: opt.bunker.shape === 'round' ? 1 : opt.bunker.shape === 'oval' ? 1.45 : 1.12,
          angle: (opt.bunker.rot * Math.PI) / 180,
          holeId: hole.id,
        });
        if (res.ok) {
          scene().refreshGround(state(), { relief: true, zoneRect: zr(point.x, point.y, yd2cells(opt.bunker.sizeYd) * 2 + 3), terrainRect: zr(point.x, point.y, yd2cells(opt.bunker.sizeYd) * 2 + 3 + RELIEF_PAD_CELLS) });
          refreshTop();
          renderToolPanel();
        } else {
          toast(res.reason || 'No sand here - bunkers dig into grass.', 'warn');
        }
        break;
      }
      case 'water': {
        if (opt.water.mode === 'edit') {
          beginFeatureBoundaryInteraction('water', g);
          break;
        }
        const point = authoringPoint(g);
        if (opt.water.shape === 'stream') {
          if (!drawingPath) drawingPath = [];
          drawingPath.push(point);
          drawMeasurePreview(drawingPath, 'stream');
          break;
        }
        const res = stampWater(state(), session, point.x, point.y, {
          r: yd2cells(opt.water.sizeYd) * (opt.water.shape === 'lake' ? 1.6 : 1),
          depth: state().course.vec ? Math.max(0.1, opt.water.depth - 2) : opt.water.depth,
          elong: opt.water.shape === 'lake' ? 1.4 : 1.15,
          angle: (opt.water.rot * Math.PI) / 180,
        });
        if (res.ok) {
          scene().refreshGround(state(), { water: true, relief: true, zoneRect: zr(point.x, point.y, yd2cells(opt.water.sizeYd) * 2.4 + 3), terrainRect: zr(point.x, point.y, yd2cells(opt.water.sizeYd) * 2.4 + 3 + RELIEF_PAD_CELLS) });
          refreshTop();
          renderToolPanel();
        } else {
          toast(res.reason || 'The water needs open ground.', 'warn');
        }
        break;
      }
      case 'objects': {
        const target = objectPlacementPoint(g);
        if (opt.objects.assist) {
          const types = OBJECT_CATALOG.filter((o) => o.cat === opt.objects.cat).map((o) => o.type);
          const res = scatterObjects(state(), session, types, target.x, target.y, {
            radius: 4.5, count: opt.objects.assistCount, protectPlay: true,
          });
          if (!res.ok) toast(res.reason, 'warn');
          else {
            refreshObjects();
            toast(t('editor.planted', { count: res.count, cost: formatMoney(res.cost) }));
          }
          break;
        }
        const rot = objectPlacementRotation(
          opt.objects.type, target.x, target.y, opt.objects.randomRot,
        );
        const res = addObject(state(), session, opt.objects.type, target.x, target.y, {
          rot, scale: opt.objects.scale, protectPlay: true,
        });
        if (!res.ok) toast(res.reason, 'warn');
        else refreshObjects();
        break;
      }
      case 'paths': {
        if (opt.paths.mode === 'edit') {
          beginPathEditInteraction(g);
          break;
        }
        if (!drawingPath) drawingPath = [];
        drawingPath.push(authoringPoint(g));
        drawMeasurePreview(drawingPath, 'path');
        break;
      }
      case 'measure': {
        measurePts.push({ x: g.point.x, z: g.point.z, fx: g.fx, fy: g.fy });
        updateMeasure();
        break;
      }
      default:
        break;
    }
  }

  function nearestHoleTo(cx, cy) {
    let best = null;
    let bestD = Infinity;
    for (const h of holesOf()) {
      if (!h.pin) continue;
      const d = Math.hypot(h.pin.x - cx, h.pin.y - cy);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  function applyTerrainAt(g) {
    const point = authoringPoint(g);
    const radius = yd2cells(opt.terrain.radiusYd * 2);
    const strength = (opt.terrain.strength / 100)
      * (TERRAIN_SOFT_MODES.has(opt.terrain.mode) ? 0.8 : 0.55);
    sculptAt(state(), stroke, point.x, point.y, {
      mode: opt.terrain.mode, radius, strength, falloff: opt.terrain.falloff,
      slopePercent: opt.terrain.slopePercent,
      plateauOffsetFt: opt.terrain.plateauOffsetFt,
    });
    if (opt.terrain.autoSmooth && !TERRAIN_SELF_FINISHING_MODES.has(opt.terrain.mode)) {
      sculptAt(state(), stroke, point.x, point.y, {
        mode: 'smooth', radius: radius * 1.15, strength: 0.24, falloff: opt.terrain.falloff,
      });
    }
    // autoSmooth reaches 1.15x the brush; +2 cells covers the ring of shared
    // vertices whose normals move even though their own height did not.
    growStrokeRect(point, radius * 1.15 + 2);
    liveRefreshThrottled();
  }

  function applyPaintAt(g, erase) {
    const point = authoringPoint(g);
    const r = yd2cells(opt.paint.radiusYd * 2);
    paintAt(state(), stroke.s, point.x, point.y, erase ? ZONE.ROUGH : opt.paint.zone, { radius: r });
    stroke.erase = erase;
    // grow the stroke's dirty rects (cells) for visual-field updates
    growStrokeRect(point, r);
    const now = performance.now();
    if (now - strokeClock > 70) {
      strokeClock = now;
      // liveRect, not the cumulative rect: regions updated on an earlier tick
      // are already correct, and updateVisualFieldRegion re-derives its own
      // halo, so the non-local part of the distance field stays right.
      scene().updateZoneField(state(), takeLiveRect(), { padding: PAINT_FIELD_PAD_CELLS });
    }
  }

  function onPointerMove(e) {
    if (!active || pt) return;
    if (camDrag) {
      const dx = e.clientX - camDrag.x;
      const dy = e.clientY - camDrag.y;
      if (camDrag.mode === 'maybe-orbit') {
        camDrag.moved = (camDrag.moved || 0) + Math.abs(dx) + Math.abs(dy);
        if (camDrag.moved > 5) {
          camDrag.mode = 'orbit';
          scene().clearCourseCameraPreset?.();
        }
      }
      if (camDrag.mode === 'orbit') scene().rig.orbit(-dx * 0.0052, dy * 0.0038);
      else if (camDrag.mode === 'pan') scene().rig.pan(dx, dy, window.innerHeight);
      camDrag.x = e.clientX;
      camDrag.y = e.clientY;
      return;
    }
    const g = groundAt(e);
    hover = g;
    scheduleHoverPreview(g);
    if (!g) return;
    if (pathDrag && (e.buttons & 1)) {
      if (g.inBounds) {
        const point = authoringPoint(g);
        const nextPoints = movedEditorControlPoints(pathDrag.originalPts, pathDrag.pointIndex, {
          x: point.x,
          y: point.y,
        });
        if (nextPoints) {
          pathDrag.previewPts = nextPoints;
          pathDrag.moved = Math.hypot(
            point.x - pathDrag.originalPts[pathDrag.pointIndex].x,
            point.y - pathDrag.originalPts[pathDrag.pointIndex].y,
          ) > 1e-5;
          refreshSelectedPathPreview();
        }
      }
      return;
    }
    if (featureDrag && (e.buttons & 1)) {
      if (g.inBounds) {
        const point = authoringPoint(g);
        const nextPoints = movedEditorControlPoints(featureDrag.originalPts, featureDrag.pointIndex, {
          x: point.x,
          y: point.y,
        });
        if (nextPoints) {
          featureDrag.previewPts = nextPoints;
          featureDrag.moved = Math.hypot(
            point.x - featureDrag.originalPts[featureDrag.pointIndex].x,
            point.y - featureDrag.originalPts[featureDrag.pointIndex].y,
          ) > 1e-5;
          refreshSelectedBoundaryPreview();
        }
      }
      return;
    }
    if (stroke && tool === 'terrain' && (e.buttons & 1)) applyTerrainAt(g);
    else if (stroke && tool === 'paint' && (e.buttons & 3)) applyPaintAt(g, !!(e.buttons & 2));
    else if (draggingObj?.kind === 'object' && (e.buttons & 1) && g.inBounds) {
      const target = objectPlacementPoint(g);
      const res = previewObjectGesture(state(), draggingObj.gesture, { x: target.x, y: target.y });
      if (res.ok) rebuildObjectVisuals();
    }
  }

  function refreshHoverPreview() {
    if (!active || pt || !hover) return;
    pendingHoverPreview = null;
    updateHoverVisuals(hover);
  }

  function scheduleHoverPreview(g) {
    pendingHoverPreview = g;
    if (hoverPreviewFrame !== null) return;
    hoverPreviewFrame = requestAnimationFrame(() => {
      hoverPreviewFrame = null;
      const next = pendingHoverPreview;
      pendingHoverPreview = null;
      if (active && !pt) updateHoverVisuals(next);
    });
  }

  function cancelHoverPreview() {
    pendingHoverPreview = null;
    if (hoverPreviewFrame !== null) cancelAnimationFrame(hoverPreviewFrame);
    hoverPreviewFrame = null;
  }

  function updateHoverVisuals(g, e) {
    const sc = scene();
    // Reached from a rAF callback, so it outlives the pointer event that
    // scheduled it and can land after the course has been torn down. This is
    // the throw at the head of the owner's 2026-08-15 crash.log.
    if (!sc) return abandonForLostScene();
    if (refreshSelectedBoundaryPreview() || refreshSelectedPathPreview()) {
      sc.setEditorBrush(null);
      sc.setPlacementGhost(null);
      return;
    }
    if (!g || !g.inBounds) {
      sc.setEditorBrush(null);
      sc.setPlacementGhost(null);
      sc.setEditorFeaturePreview?.(null);
      return;
    }
    sc.setEditorFeaturePreview?.(null);
    if (tool === 'terrain' || tool === 'paint') {
      sc.setPlacementGhost(null);
      sc.setEditorBrush({
        x: g.point.x,
        z: g.point.z,
        radiusYd: tool === 'terrain' ? opt.terrain.radiusYd : opt.paint.radiusYd,
        falloff: tool === 'terrain' ? opt.terrain.falloff : null,
        color: 0xffffff,
      });
    } else if (tool === 'tee') {
      sc.setEditorBrush(null);
      sc.setPlacementGhost(null);
      const point = authoringPoint(g);
      const hole = holesOf().find((candidate) => candidate.id === opt.tee.holeId);
      const markerOffset = state().course.vec ? 0.5 : 0;
      const pinAim = hole?.pin
        ? { x: hole.pin.x + markerOffset, y: hole.pin.y + markerOffset }
        : { x: point.x + 4, y: point.y };
      const teeAngle = Math.atan2(pinAim.y - point.y, pinAim.x - point.x)
        + (opt.tee.rot * Math.PI) / 180;
      const aimCell = { x: point.x + Math.cos(teeAngle) * 4, y: point.y + Math.sin(teeAngle) * 4 };
      const placement = hole
        ? featurePlacementOk(state().course, 'tee', point.x, point.y, {
          holeId: hole.id, aimX: aimCell.x, aimY: aimCell.y,
        })
        : { ok: false, reason: t('editor.pickAHoleFirst') };
      sc.setEditorFeaturePreview?.(buildCourseEditorPreviewGeometry({
        feature: 'tee',
        hoverWorld: { x: g.point.x, z: g.point.z },
        hoverCell: point,
        aimWorld: { x: authoredWorldX(sc, aimCell.x), z: authoredWorldZ(sc, aimCell.y) },
        valid: placement.ok,
        invalidReason: placement.reason,
      }));
    } else if (tool === 'green' && opt.green.mode === 'draw' && !opt.green.pin) {
      sc.setEditorBrush(null);
      sc.setPlacementGhost(null);
      const point = authoringPoint(g);
      const r = yd2cells(opt.green.sizeYd);
      const elong = opt.green.shape === 'round' ? 1.02 : 1.35;
      const angle = (opt.green.rot * Math.PI) / 180;
      const placement = featurePlacementOk(state().course, 'green', point.x, point.y, {
        r, elong, angle, kidney: opt.green.shape === 'kidney',
      });
      sc.setEditorFeaturePreview?.(buildCourseEditorPreviewGeometry({
        feature: 'green', shape: opt.green.shape, sizeYd: opt.green.sizeYd,
        rotationDeg: opt.green.rot, seed: state().course.vec?.nextId,
        hoverWorld: { x: g.point.x, z: g.point.z },
        hoverCell: point,
        valid: placement.ok,
        invalidReason: placement.reason,
      }));
    } else if (tool === 'bunker' && opt.bunker.mode === 'draw') {
      sc.setEditorBrush(null);
      sc.setPlacementGhost(null);
      const point = authoringPoint(g);
      const placement = featurePlacementOk(state().course, 'bunker', point.x, point.y, {
        r: yd2cells(opt.bunker.sizeYd),
        lobes: opt.bunker.shape === 'round' ? 1 : opt.bunker.shape === 'oval' ? 2 : 3,
        stretch: opt.bunker.shape === 'round' ? 1 : opt.bunker.shape === 'oval' ? 1.45 : 1.12,
        angle: (opt.bunker.rot * Math.PI) / 180,
      });
      sc.setEditorFeaturePreview?.(buildCourseEditorPreviewGeometry({
        feature: 'bunker', shape: opt.bunker.shape, sizeYd: opt.bunker.sizeYd,
        rotationDeg: opt.bunker.rot, seed: state().course.vec?.nextId,
        hoverWorld: { x: g.point.x, z: g.point.z },
        hoverCell: point,
        valid: placement.ok,
        invalidReason: placement.reason,
      }));
    } else if (tool === 'water' && opt.water.mode === 'draw' && opt.water.shape !== 'stream') {
      sc.setEditorBrush(null);
      sc.setPlacementGhost(null);
      const point = authoringPoint(g);
      const placement = featurePlacementOk(state().course, 'water', point.x, point.y, {
        r: yd2cells(opt.water.sizeYd) * (opt.water.shape === 'lake' ? 1.6 : 1),
        elong: opt.water.shape === 'lake' ? 1.4 : 1.15,
        angle: (opt.water.rot * Math.PI) / 180,
      });
      sc.setEditorFeaturePreview?.(buildCourseEditorPreviewGeometry({
        feature: 'water', shape: opt.water.shape, sizeYd: opt.water.sizeYd,
        rotationDeg: opt.water.rot, seed: state().course.vec?.nextId,
        hoverWorld: { x: g.point.x, z: g.point.z },
        hoverCell: point,
        valid: placement.ok,
        invalidReason: placement.reason,
      }));
    } else if (tool === 'objects' && !opt.objects.assist) {
      sc.setEditorBrush(null);
      const target = objectPlacementPoint(g);
      const legal = objectPlacementOk(state().course, opt.objects.type, target.x, target.y, {
        scale: opt.objects.scale, protectPlay: true,
      });
      sc.setPlacementGhost(opt.objects.type, target.worldX, target.worldZ, {
        rot: objectPlacementRotation(
          opt.objects.type, target.x, target.y, opt.objects.randomRot,
        ),
        scale: opt.objects.scale,
        valid: legal.ok,
        collisionRadiusYd: objectCollisionRadiusYd(opt.objects.type, opt.objects.scale),
      });
    } else if (tool === 'objects') {
      sc.setPlacementGhost(null);
      const target = objectPlacementPoint(g);
      sc.setEditorBrush({ x: target.worldX, z: target.worldZ, radiusYd: 4.5 * 8, color: 0xb7e39a });
    } else if (tool === 'select' && selected) {
      sc.setEditorBrush({ x: sc.worldX(selected.x), z: sc.worldZ(selected.y), radiusYd: 3, color: 0xffe9a0 });
      sc.setPlacementGhost(null);
    } else {
      sc.setEditorBrush(null);
      sc.setPlacementGhost(null);
    }
  }

  function onPointerUp(e) {
    if (!active || pt) return;
    if (camDrag) {
      const wasClick = camDrag.mode === 'maybe-orbit' && (camDrag.moved || 0) <= 5;
      camDrag = null;
      if (!wasClick) return;
      // right-CLICK contextual actions
      const g = groundAt(e);
      if (!g) return;
      if (tool === 'objects') {
        const obj = scene().pickObject(g.point.x, g.point.z, 3);
        if (obj) {
          removeObject(state(), session, obj.id);
          refreshObjects();
        }
      } else if (tool === 'paint' && stroke) {
        // handled as erase-drag; nothing on click
      } else if (((tool === 'paths' && opt.paths.mode === 'draw')
        || (tool === 'water' && opt.water.mode === 'draw' && opt.water.shape === 'stream')) && drawingPath) {
        finishDrawing();
      } else if (tool === 'measure') {
        measurePts = [];
        updateMeasure();
      }
      return;
    }
    if (pathDrag) {
      const drag = pathDrag;
      pathDrag = null;
      selectedPathId = drag.pathId;
      if (drag.moved) {
        commitSelectedPathEdit({ pts: drag.previewPts }, 'Path reshaped.');
      } else {
        refreshSelectedPathPreview();
      }
      return;
    }
    if (featureDrag) {
      const drag = featureDrag;
      featureDrag = null;
      if (drag.moved) {
        commitSelectedFeatureEdit(drag.kind, { pts: drag.previewPts },
          `${drag.source === 'stream' ? 'Stream' : drag.kind[0].toUpperCase() + drag.kind.slice(1)} reshaped.`);
      } else {
        refreshSelectedBoundaryPreview();
      }
      return;
    }
    if (stroke && tool === 'terrain') {
      const res = endTerrainStroke(state(), session, stroke, 'Terrain');
      // the cumulative rect, not the live one: this single commit refresh has
      // to cover everything the whole stroke touched
      const terrainRect = stroke.rect || null;
      stroke = null;
      // sculpting moves land, not surfaces: skip the visual-field recompute
      scene().refreshGround(state(), {
        ...terrainRefreshDependencies(terrainRect),
        zones: false, terrainRect, turf: false,
      });
      if (res.ok) refreshTop();
    } else if (stroke && tool === 'paint') {
      const pendingVisualRect = stroke.liveRect || null;
      const cumulativeRect = stroke.rect || null;
      const res = endPaintStroke(state(), session, stroke.s, 'Paint');
      stroke = null;
      // Every region consumed during the drag is already current. Only flush
      // the since-last-tick tail; reprocessing the cumulative stroke caused the
      // release hitch on long paint gestures. The coarse turf texture changes
      // only now, after endPaintStroke derives the local simulation cells.
      if (pendingVisualRect) {
        scene().updateZoneField(state(), pendingVisualRect, { padding: PAINT_FIELD_PAD_CELLS });
      }
      if (cumulativeRect) scene().updateTurf(state(), cumulativeRect);
      if (res.ok) refreshTop();
    }
    if (draggingObj?.kind === 'object') {
      const res = endObjectGesture(state(), session, draggingObj.gesture);
      if (res.ok && !res.unchanged) refreshTop();
    }
    draggingObj = false;
  }

  function finishDrawing() {
    if (!drawingPath || drawingPath.length < 2) {
      drawingPath = null;
      scene().setMeasureLine(null);
      return;
    }
    if (tool === 'paths') {
      const res = addPath(state(), session, drawingPath, {
        width: opt.paths.width,
        material: opt.paths.material,
        bridge: authoredBridgeFromOptions(),
      });
      if (res.ok) {
        refreshEditedPath([], drawingPath);
        toast(t('editor.pathLaid', { cost: formatMoney(res.cost) }));
      } else toast(res.reason || 'The path needs a valid open route.', 'warn');
    } else {
      const res = stampStream(state(), session, drawingPath, {
        width: opt.water.streamWidthYd / (CELL_YD * 2),
        depth: state().course.vec ? Math.max(0.1, opt.water.depth - 0.8) : opt.water.depth,
      });
      if (res.ok) {
        const xs = drawingPath.map((q) => q.x);
        const ys = drawingPath.map((q) => q.y);
        const streamRect = {
          x0: Math.min(...xs) - 3, y0: Math.min(...ys) - 3,
          x1: Math.max(...xs) + 3, y1: Math.max(...ys) + 3,
        };
        scene().refreshGround(state(), {
          water: true,
          relief: true,
          zoneRect: streamRect,
          terrainRect: {
            x0: streamRect.x0 - RELIEF_PAD_CELLS, y0: streamRect.y0 - RELIEF_PAD_CELLS,
            x1: streamRect.x1 + RELIEF_PAD_CELLS, y1: streamRect.y1 + RELIEF_PAD_CELLS,
          },
        });
        refreshTop();
        renderToolPanel();
        toast(t('editor.streamCut'));
      } else toast(res.reason || 'The stream needs a valid open route.', 'warn');
    }
    drawingPath = null;
    scene().setMeasureLine(null);
  }

  function drawMeasurePreview(cellPts, kind) {
    const sc = scene();
    sc.setMeasureLine(cellPts.map((p) => ({
      x: authoredWorldX(sc, p.x), z: authoredWorldZ(sc, p.y),
    })), kind === 'path' ? 'path…' : 'stream…');
  }

  function updateMeasure() {
    const sc = scene();
    if (measurePts.length === 0) {
      sc.setMeasureLine(null);
      ui.measureChip.style.display = 'none';
      return;
    }
    let label = null;
    if (measurePts.length >= 2) {
      const a = measurePts[measurePts.length - 2];
      const b = measurePts[measurePts.length - 1];
      const m = measure(state().course, { x: a.fx, y: a.fy }, { x: b.fx, y: b.fy });
      let total = 0;
      for (let i = 1; i < measurePts.length; i++) {
        total += measure(state().course, { x: measurePts[i - 1].fx, y: measurePts[i - 1].fy }, { x: measurePts[i].fx, y: measurePts[i].fy }).yards;
      }
      label = `${m.yards} yd`;
      ui.measureChip.style.display = '';
      const rows = [
        el('div', {}, el('b', { text: `${m.yards} yd` }), el('span', { text: '  last segment' })),
        el('div', { text: `Elevation ${m.elevationFt > 0 ? '+' : ''}${m.elevationFt} ft · Slope ${m.slopeDeg}°` }),
      ];
      if (measurePts.length > 2) rows.push(el('div', { text: `Chain total ${total} yd` }));
      ui.measureChip.replaceChildren(...rows);
    } else {
      ui.measureChip.style.display = '';
      ui.measureChip.replaceChildren(el('div', { text: 'Click the second point…' }));
    }
    sc.setMeasureLine(measurePts, label);
  }

  function onWheel(e) {
    if (!active || modalEl) return;
    if (!scene()) return abandonForLostScene(); // see detachEditorInput's note
    if (e.target !== scene().renderer.domElement) return;
    e.preventDefault();
    scene().clearCourseCameraPreset?.();
    scene().rig.dolly(e.deltaY > 0 ? 1.13 : 1 / 1.13);
  }

  function onKey(e) {
    if (!active) return;
    // The window-level editor listener runs in capture phase. Ignore gameplay
    // shortcuts while the shared pause shell owns focus and keyboard input.
    if (hooks.isPaused?.()) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
      e.stopPropagation();
      return;
    }
    // P is the one shared shortcut: let the bubble-phase application handler
    // open the global pause shell. Every editor-owned key stops here so an
    // Escape that exits the editor cannot also toggle the overview camera.
    if (e.key === 'p' || e.key === 'P') return;
    e.stopPropagation();
    if (pt) {
      onPlaytestKey(e);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      doRedo();
      return;
    }
    const idx = e.key === '0' ? 10 : Number(e.key);
    if (idx >= 1 && idx <= TOOLS.length && !e.ctrlKey && !e.metaKey) {
      setTool(TOOLS[idx - 1].key);
      return;
    }
    switch (e.key) {
      case 'f':
      case 'F': {
        const hole = holesOf().find((h) => h.id === opt.tee.holeId) || holesOf()[0];
        setCameraView('frame-hole', hole);
        break;
      }
      case 'Home':
        setCameraView('course-overview');
        break;
      case 'Tab':
        // main.js blocks Tab from reaching DOM focus in every other mode
        // ("Tab must never reach DOM focus in-game, whatever it is bound to")
        // but returns to this listener before that line when the editor is
        // active, so the editor is the one surface where the browser's focus
        // traversal still ran. Focus then lands on a control in the editor bar
        // and the engine scrolls it into view, which slides the
        // position:absolute canvas up inside an overflow:hidden body and
        // exposes the page's --charcoal background beneath it.
        e.preventDefault();
        break;
      case 'Escape':
        if (flyover) stopFlyover();
        else if (modalEl) closeModal();
        else if (drawingPath) finishDrawing();
        else if (selected) setSelected(null);
        else if (measurePts.length) {
          measurePts = [];
          updateMeasure();
        } else requestExit();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ flyover ----
  // A slow camera ride from tee to green — the classic course-preview shot.
  let flyover = null; // { hole, t, restoreView, statusPercent }

  function renderFlyoverStatus() {
    if (!flyover) return;
    const label = courseCameraFlyoverLabel(flyover);
    ui.flyoverOpt.textContent = label;
    ui.flyoverOpt.hidden = false;
    ui.cameraSel.value = FLYOVER_CAMERA_VIEW;
    ui.cameraSel.title = `${label}; returns to ${flyover.restoreView}`;
  }

  function clearFlyoverState() {
    if (!flyover) return false;
    flyover = null;
    ui.flyoverOpt.textContent = 'Flyover';
    ui.flyoverOpt.hidden = true;
    ui.cameraSel.title = 'Course camera preset';
    return true;
  }

  function startFlyover(hole) {
    if (!hole || !hole.tee || !hole.pin) return;
    const sc = scene();
    if (!sc) return;
    const restoreView = flyover?.restoreView || normalizeCourseCameraView(ui.cameraSel.value);
    clearFlyoverState();
    flyover = beginCourseCameraFlyover(hole, restoreView);
    renderFlyoverStatus();
    sc.flyoverHole(hole, 0);
    hint('Flying the hole - click or press Esc to stop');
    refreshTop(); // the flyover button becomes the stop control while flying
  }

  function stopFlyover() {
    if (!flyover) return;
    const { hole, restoreView } = flyover;
    clearFlyoverState();
    setCameraView(restoreView, hole);
    hint(HINTS[tool] || '');
    refreshTop();
  }

  function stepFlyover(dt) {
    if (!flyover) return;
    const sc = scene();
    const priorStatus = flyover.statusPercent;
    flyover = advanceCourseCameraFlyover(flyover, dt);
    const { hole, t } = flyover;
    if (flyover.statusPercent !== priorStatus) renderFlyoverStatus();
    sc.flyoverHole(hole, t);
    if (t >= 1) stopFlyover();
  }

  // ------------------------------------------------------------ playtest ----

  function enterPlaytest(holeId = null) {
    const holes = holesOf().filter((h) => h.tee && h.pin);
    if (!holes.length) {
      toast(t('editor.noPlayableHoleYet'), 'warn');
      return;
    }
    const sc = scene();
    const hole = holes.find((h) => h.id === (holeId ?? opt.tee.holeId)) || holes[0];
    const wasPlaytesting = !!pt;
    const nextPlaytest = startPlaytest(state(), hole.id, {
      cellToWorld: (p) => ({ x: sc.worldX(p.x), z: sc.worldZ(p.y) }),
      courseToWorld: (p) => ({ x: sc.worldX(p.x - 0.5), z: sc.worldZ(p.y - 0.5) }),
      heightAt: (x, z) => sc.playHeightAt?.(x, z) ?? sc.heightAt(x, z),
      zoneAt: (x, z) => sc.playZoneAtWorld?.(x, z) ?? sc.zoneAtWorld(x, z),
      inBoundsWorld: (x, z) => sc.inBoundsWorld(x, z),
    });
    if (!nextPlaytest) {
      toast(t('editor.thatHoleIsNot'), 'warn');
      return;
    }
    if (!wasPlaytesting) {
      const rig = sc.rig;
      ptReturnCamera = {
        view: normalizeCourseCameraView(ui.cameraSel.value),
        target: { x: rig.target.x, y: rig.target.y, z: rig.target.z },
        yaw: rig.yaw,
        pitch: rig.pitch,
        dist: rig.dist,
      };
    }
    pt = nextPlaytest;
    applyToolCursor(); // playtest is played, not edited — drop the editing cursor
    sc.clearCourseCameraPreset?.();
    sc.setEditorBrush(null);
    sc.setPlacementGhost(null);
    sc.setEditorFeaturePreview?.(null);
    // Ambient golfers communicate live course activity in the editor, but a
    // frozen NPC must never stand over the player's ball or mask a playtest aim.
    sc.setGolfersVisible?.(false);
    ptAim = pt.aimYaw;
    ptClub = null;
    ptPower = null;
    ptLeftAim = null;
    sc.setBallVisual(pt.ball);
    leftCol.style.display = 'none';
    topBar.style.display = 'none';
    ui.ptBar.style.display = '';
    // the reference playtest carries a hole mini-map beside the first-person view
    ui.ptMap.replaceChildren(
      holeMiniCanvas(hole, 128, 176),
      el('div', { class: 'ced-holemeta', text: `${hole.name} · Par ${holePar(hole)}` }),
    );
    ui.ptMap.style.display = '';
    hint('Drag: aim · Hold left button: power · Release: swing · Esc: back to the editor');
    renderPtBar();
    followBallCamera(true);
  }

  function exitPlaytest() {
    pt = null;
    applyToolCursor(); // back to the editing cursor for the active tool
    ptPower = null;
    ptLeftAim = null;
    scene().setGolfersVisible?.(true);
    scene().setBallVisual(null);
    scene().setAimArc(null);
    ui.ptBar.style.display = 'none';
    ui.ptMap.style.display = 'none';
    leftCol.style.display = '';
    topBar.style.display = '';
    hint(HINTS[tool] || '');
    const restore = ptReturnCamera;
    ptReturnCamera = null;
    if (restore) {
      const sc = scene();
      ui.cameraSel.value = restore.view;
      editorPrefs().cameraView = restore.view;
      sc.clearCourseCameraPreset?.();
      sc.rig.target.set(restore.target.x, restore.target.y, restore.target.z);
      sc.rig.yaw = restore.yaw;
      sc.rig.pitch = restore.pitch;
      sc.rig.dist = restore.dist;
      sc.rig.apply();
    } else {
      const hole = selectedHole();
      if (hole) setCameraView('frame-hole', hole);
      else setCameraView('course-overview');
    }
  }

  function renderPtBar() {
    if (!pt) return;
    const hud = playtestHud(pt);
    const n = holeNumber(state().course, pt.holeId);
    ptClub = hud.club; // fresh suggestion for the new lie; the select still overrides
    const clubSel = el('select');
    for (const c of CLUBS) clubSel.append(el('option', { value: c.key, text: c.name }));
    clubSel.value = ptClub.key;
    clubSel.onchange = () => { ptClub = CLUBS.find((c) => c.key === clubSel.value); };
    ui.ptBar.replaceChildren(
      el('span', { class: 'ced-pt-chip', text: `Hole ${n} · Par ${holePar(pt.hole)} · ${hud.remainingYd} yd` }),
      el('span', { class: 'ced-pt-chip', text: hud.lie }),
      el('span', { class: 'ced-pt-chip hot', text: `${hud.strokes} stroke${hud.strokes === 1 ? '' : 's'}` }),
      el('span', { class: 'ced-pt-club' }, el('label', { text: 'Club ' }), clubSel),
      ui.ptPowerBar = el('span', { class: 'ced-pt-power' }, el('span', { class: 'fill' })),
      el('button', { class: 'ced-top-btn', text: '← Editor', onclick: () => exitPlaytest() }),
    );
    if (hud.holed) {
      ui.ptBar.append(el('span', { class: 'ced-pt-chip good', text: pt.events[pt.events.length - 1] || 'Holed!' }));
      ui.ptBar.append(el('button', {
        class: 'ced-top-btn primary',
        text: 'Replay hole',
        onclick: () => enterPlaytest(pt.holeId),
      }));
    }
  }

  function onPlaytestKey(e) {
    if (e.key === 'Escape') exitPlaytest();
  }

  function playtestPointerDown(e) {
    if (!pt || pt.phase !== 'aim' || pt.holedOut) return;
    if (e.target !== scene().renderer.domElement) return;
    if (e.button === 0) {
      ptPower = { t: 0, dir: 1 };
      ptLeftAim = { x: e.clientX, y: e.clientY, moved: 0, aiming: false };
    } else if (e.button === 2) {
      camDrag = { mode: 'aim', x: e.clientX, y: e.clientY };
    }
  }

  function playtestPointerMove(e) {
    if (!pt) return;
    if (ptLeftAim && (e.buttons & 1)) {
      const dx = e.clientX - ptLeftAim.x;
      const dy = e.clientY - ptLeftAim.y;
      ptLeftAim.moved += Math.abs(dx) + Math.abs(dy);
      if (ptLeftAim.moved > 5) {
        ptLeftAim.aiming = true;
        ptPower = null;
        setPowerFill(0);
        ptAim -= dx * 0.004;
      }
      ptLeftAim.x = e.clientX;
      ptLeftAim.y = e.clientY;
    } else if (camDrag && camDrag.mode === 'aim') {
      ptAim -= (e.clientX - camDrag.x) * 0.004;
      camDrag.x = e.clientX;
      camDrag.y = e.clientY;
    }
  }

  function playtestPointerUp(e) {
    if (!pt) return;
    if (camDrag && camDrag.mode === 'aim') {
      camDrag = null;
      return;
    }
    if (e.button === 0 && ptLeftAim?.aiming) {
      ptLeftAim = null;
      ptPower = null;
      setPowerFill(0);
      return;
    }
    if (e.button === 0) ptLeftAim = null;
    if (e.button === 0 && ptPower) {
      const club = ptClub || playtestHud(pt).club;
      strike(pt, club, ptPower.t, ptAim);
      ptPower = null;
      setPowerFill(0);
      renderPtBar();
    }
  }

  function setPowerFill(t) {
    if (!ui.ptPowerBar) return;
    const fill = ui.ptPowerBar.querySelector('.fill');
    if (fill) fill.style.width = `${Math.round(t * 100)}%`;
  }

  function followBallCamera(snap = false) {
    const sc = scene();
    const rig = sc.rig;
    const b = pt.ball;
    if (pt.phase === 'aim') {
      // A true tee-height preview: look through the shot from roughly seven
      // yards behind the ball, not from the old 12-yard-high chase camera.
      const lookAhead = 9.5;
      rig.target.set(
        b.x + Math.sin(ptAim) * lookAhead,
        0,
        b.z + Math.cos(ptAim) * lookAhead,
      );
      rig.yaw = ptAim + Math.PI;
      rig.pitch = 0.11;
      rig.dist = snap ? 16.5 : clamp(rig.dist, 15.5, 19.5);
    } else {
      const speed = Math.hypot(b.vx || 0, b.vz || 0);
      const travelYaw = speed > 0.25 ? Math.atan2(b.vx, b.vz) : ptAim;
      const lookAhead = 14;
      rig.target.set(
        b.x + Math.sin(travelYaw) * lookAhead,
        0,
        b.z + Math.cos(travelYaw) * lookAhead,
      );
      rig.yaw = travelYaw + Math.PI;
      rig.pitch = 0.2;
      rig.dist = clamp(rig.dist, 20, 25);
    }
    rig.apply();
  }

  function aimArcPoints() {
    // A restrained ground guide communicates direction without drawing the
    // old towering debug trajectory through the middle of the hero view.
    const club = ptClub || playtestHud(pt).club;
    const power = ptPower ? ptPower.t : 0.75;
    const carry = club.carry * Math.max(0.15, power);
    const pts = [];
    const sc = scene();
    const guideYd = Math.min(carry, club.key === 'putter' ? 18 : 44);
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const d = guideYd * t;
      const x = pt.ball.x + Math.sin(ptAim) * d;
      const z = pt.ball.z + Math.cos(ptAim) * d;
      const y = (sc.playHeightAt?.(x, z) ?? sc.heightAt(x, z))
        + 0.045 + Math.sin(t * Math.PI) * 0.025;
      pts.push({ x, y, z });
    }
    return pts;
  }

  // ------------------------------------------------------------ lifecycle ----

  let camLimits = null; // the rig's own limits, restored on hide

  function show() {
    active = true;
    session = makeEditSession(state());
    root.style.display = '';
    setTool('select');
    const prefs = editorPrefs();
    lightMode = ['day', 'morning', 'golden', 'overcast'].includes(prefs.lighting)
      ? prefs.lighting
      : 'day';
    ui.lightSel.value = lightMode;
    scene().setLightingOverride(lightMode);
    scene().setEditorShadowFocus?.(true);
    scene().setGolfersFrozen(true);
    // the editor camera never becomes a satellite: cap distance and pitch so
    // the course always reads as a 3D place (reference: 35–55° angles)
    const rig = scene().rig;
    camLimits = {
      maxDist: rig.maxDist,
      maxPitch: rig.maxPitch,
      minDist: rig.minDist,
      minPitch: rig.minPitch,
    };
    rig.maxDist = 700; // enough to frame the property on a 16:9 monitor…
    rig.maxPitch = 1.08; // …but never the flat satellite look (≈62° max)
    rig.minDist = 8;
    rig.minPitch = 0.08;
    // Restore the player's last editing context after reload. Invalid/deleted
    // hole ids fall back safely to the first hole.
    const restoredHole = holesOf().find((h) => h.id === prefs.selectedHoleId) || holesOf()[0] || null;
    selectHole(restoredHole, { frame: false });
    setCameraView(prefs.cameraView || 'frame-hole', restoredHole);
    // The camera snapped above, but the clubhouse visibility gates would
    // otherwise settle across the next few (entry-stretched) frames, and each
    // intermediate light state compiles programs that exist for one frame
    // ever. Settle them now so the first drawn editor frame is the state the
    // prewarm already compiled for.
    scene().settleClubhouseCameraVisibility?.();
    refreshTop();
    applyToolCursor();
    window.addEventListener('pointerdown', pdHandler, true);
    window.addEventListener('pointermove', pmHandler, true);
    window.addEventListener('pointerup', puHandler, true);
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('keydown', onKey, true);
  }

  function hide() {
    if (pt) exitPlaytest();
    cancelHoverPreview();
    clearFlyoverState();
    clearFeatureSelections();
    clearPathSelection();
    active = false;
    applyToolCursor(); // active is false now, so this clears both cursor classes
    closeModal();
    // TEARDOWN BEFORE SCENE TALK. Every scene() line below can throw while the
    // course is mid-rebuild, and this used to run the other way round: one throw
    // at frameCourse() skipped the display:none AND all five removeEventListener
    // calls, so a transient null scene left the editor painted over the game
    // with its capture-phase keyboard hook swallowing every key, permanently.
    root.style.display = 'none';
    detachEditorInput();
    const sc = scene();
    if (camLimits) {
      if (sc) {
        const rig = sc.rig;
        rig.maxDist = camLimits.maxDist;
        rig.maxPitch = camLimits.maxPitch;
        rig.minDist = camLimits.minDist;
        rig.minPitch = camLimits.minPitch;
      }
      camLimits = null;
    }
    if (!sc) return;
    sc.frameCourse();
    sc.setEditorShadowFocus?.(false);
    sc.setLightingOverride(null);
    sc.setGolfersFrozen(false);
    sc.setEditorBrush(null);
    sc.setEditorFeaturePreview?.(null);
    sc.setPlacementGhost(null);
    sc.setMeasureLine(null);
  }

  // THE EDITOR OVER A DEAD SCENE — Playtest 5, P0.
  //
  // `app.scene3d` is null for as long as it takes to tear one course down and
  // build the next: destroyCurrentScene() nulls it, startGameNow() reassigns it,
  // and startGame() can sit between the two for up to the 12 s asset barrier.
  // The editor's own pause shell offers "Load game" and "Reload the game", so
  // that window is reachable with the editor open and its five capture-phase
  // window listeners installed.
  //
  // `groundAt` already guards for it — `scene() ? scene().raycastGround(...) : null`
  // — so tolerating a null scene has been the intent all along. Three consumers
  // one line further on did not: updateHoverVisuals, onPointerDown and onWheel
  // dereference scene() directly. The owner's crash.log for the 2026-08-15
  // playtest session opens with exactly those two throws:
  //
  //   TypeError: Cannot read properties of null (reading 'setEditorBrush')
  //       at updateHoverVisuals (src/ui/courseEditor.js:3288)
  //   TypeError: Cannot read properties of null (reading 'renderer')
  //       at onPointerDown (src/ui/courseEditor.js:2925)
  //
  // A pointerdown that throws on its first line cannot reach a single editor
  // verb, which is "I cannot click anything" verbatim.
  //
  // Swallowing the events silently would be worse than throwing: the editor
  // would stay painted at z-index 8 over whatever replaced it, and onKey stops
  // propagation of every key in capture phase, so the game's whole keyboard
  // would stay dead. It takes ITSELF down instead — DOM and listeners, without
  // touching the scene it no longer has.
  function detachEditorInput() {
    window.removeEventListener('pointerdown', pdHandler, true);
    window.removeEventListener('pointermove', pmHandler, true);
    window.removeEventListener('pointerup', puHandler, true);
    window.removeEventListener('wheel', onWheel, { capture: true });
    window.removeEventListener('keydown', onKey, true);
  }

  function abandonForLostScene() {
    if (!active) return;
    active = false;
    cancelHoverPreview();
    camDrag = null;
    stroke = null;
    root.style.display = 'none';
    detachEditorInput();
  }

  // Every installed listener funnels through here, so the null-scene rule is
  // stated once rather than re-guarded at each of the seven call sites.
  const guarded = (fn) => (e) => {
    if (active && !scene()) {
      abandonForLostScene();
      return undefined;
    }
    return fn(e);
  };

  const pdHandler = guarded((e) => (pt ? playtestPointerDown(e) : onPointerDown(e)));
  const pmHandler = guarded((e) => (pt ? playtestPointerMove(e) : onPointerMove(e)));
  const puHandler = guarded((e) => (pt ? playtestPointerUp(e) : onPointerUp(e)));

  // called from the main frame loop while the editor is open
  function onFrame(dtMs) {
    if (!active) return;
    // compass follows the camera
    const yawDeg = -(scene().rig.yaw * 180) / Math.PI;
    ui.compass.style.transform = `rotate(${yawDeg}deg)`;
    if (flyover) stepFlyover(Math.min(0.05, dtMs / 1000));
    if (pt) {
      const dt = Math.min(0.05, dtMs / 1000);
      if (ptPower) {
        ptPower.t += ptPower.dir * dt * 0.9;
        if (ptPower.t >= 1) {
          ptPower.t = 1;
          ptPower.dir = -1;
        } else if (ptPower.t <= 0) {
          ptPower.t = 0;
          ptPower.dir = 1;
        }
        setPowerFill(ptPower.t);
      }
      const wasMoving = pt.phase === 'flying' || pt.phase === 'rolling';
      if (wasMoving) {
        stepBall(pt, dt);
        scene().setBallVisual(pt.ball);
        if (pt.phase === 'aim' || pt.phase === 'holed') {
          for (const ev of pt.events.splice(0)) toast(ev);
          // the next shot starts aimed at the flag — drag to shape it from there
          ptAim = Math.atan2(pt.pin.x - pt.ball.x, pt.pin.z - pt.ball.z);
          renderPtBar();
        }
      }
      if (pt.phase === 'aim' && !pt.holedOut) {
        scene().setAimArc(aimArcPoints());
      } else {
        scene().setAimArc(null);
      }
      followBallCamera();
      scene().setBallVisual(pt.ball);
    }
  }

  return {
    root,
    show,
    hide,
    onFrame,
    isActive: () => active,
    isPlaytesting: () => !!pt,
    session: () => session,
    qa: {
      playtest: () => pt,
      tool: () => tool,
      setTool,
      power: () => ptPower,
    },
  };
}
