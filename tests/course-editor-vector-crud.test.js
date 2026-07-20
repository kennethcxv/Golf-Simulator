import test from 'node:test';
import assert from 'node:assert/strict';

import { ZONE } from '../src/sim/constants.js';
import { makeCourse } from '../src/sim/course.js';
import {
  emptyVec, deriveZones, invalidateGeom, getGeom, evaluateSurface,
} from '../src/sim/courseVec.js';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  makeEditSession,
  editVectorGreen,
  editVectorBunker, deleteVectorBunker,
  editVectorWater, deleteVectorWater,
  editVectorStream, deleteVectorStream,
  addPath, editPath, removePath,
  undo, redo, discardSession, applySession,
} from '../src/sim/courseEditor.js';

function fresh() {
  return newGame('relaxed', 24680);
}

function vecHoleFor(state, hole) {
  return state.course.vec.holes.find((candidate) => candidate.id === hole.vecId);
}

function cloneCourseTruth(state) {
  return {
    vec: structuredClone(state.course.vec),
    holes: structuredClone(state.course.holes),
    paths: structuredClone(state.course.paths),
    zones: Uint8Array.from(state.course.zones),
  };
}

function assertCourseTruth(state, expected, message) {
  assert.deepEqual(state.course.vec, expected.vec, `${message}: vector truth`);
  assert.deepEqual(state.course.holes, expected.holes, `${message}: hole records`);
  assert.deepEqual(state.course.paths, expected.paths, `${message}: paths`);
  assert.deepEqual(Array.from(state.course.zones), Array.from(expected.zones), `${message}: derived zones`);
}

test('green boundary, transform, apron, and sculpt metadata are one exact history operation', () => {
  const state = fresh();
  const session = makeEditSession(state);
  const hole = state.course.holes[0];
  const vectorHole = vecHoleFor(state, hole);
  const before = cloneCourseTruth(state);
  const boundary = vectorHole.green.pts.map((point, index) => ({
    x: point.x + (index === 0 ? 0.18 : 0),
    y: point.y + (index === 0 ? -0.08 : 0),
  }));
  const contours = [{
    role: 'editor-roll',
    x: vectorHole.green.cx,
    y: vectorHole.green.cy,
    r: 0.72,
    h: -0.18,
  }];

  const result = editVectorGreen(state, session, hole.id, {
    pts: boundary,
    transform: { dx: 0.35, dy: -0.2, rotate: 0.04, scaleX: 1.03, scaleY: 0.97 },
    fringe: 1.4,
    apron: 4.5,
    sculpt: { raise: 2.15, tilt: 0.31, tiltA: 1.15, contours },
  });

  assert.equal(result.ok, true);
  assert.equal(session.undo.length, 1, 'one committed edit produces one history entry');
  assert.equal(result.green.fringe, 1.4);
  assert.equal(result.green.apron, 4.5);
  assert.equal(result.green.raise, 2.15);
  assert.deepEqual(result.green.contours, contours);
  assert.notDeepEqual(state.course.holes[0].pins, before.holes[0].pins, 'pin sockets follow the green transform');
  const after = cloneCourseTruth(state);

  assert.equal(undo(state, session).ok, true);
  assertCourseTruth(state, before, 'undo');
  assert.equal(redo(state, session).ok, true);
  assertCourseTruth(state, after, 'redo');
  assert.equal(discardSession(state, session).ok, true);
  assertCourseTruth(state, before, 'discard');
});

test('bunker edit/delete keeps its id and is exactly undoable, redoable, and discardable', () => {
  const state = fresh();
  const hole = state.course.holes[0];
  const vectorHole = vecHoleFor(state, hole);
  // Simulate a feature created by the editor or a newer authored save. Legacy
  // id-less bunkers remain addressable with { index } and are never renumbered.
  vectorHole.bunkers[0].id = 9001;
  state.course.vec.nextId = Math.max(state.course.vec.nextId, 9002);
  const session = makeEditSession(state);
  const before = cloneCourseTruth(state);

  const edited = editVectorBunker(state, session, hole.id, { id: 9001 }, {
    transform: { dx: 0.22, dy: 0.15, rotate: -0.08, scale: 1.06 },
    depth: 3.75,
    lip: 1.2,
  });
  assert.equal(edited.ok, true);
  assert.equal(edited.bunker.id, 9001, 'edit never changes the feature id');
  assert.equal(session.undo.length, 1);
  const afterEdit = cloneCourseTruth(state);

  const removed = deleteVectorBunker(state, session, hole.id, { id: 9001 });
  assert.equal(removed.ok, true);
  assert.equal(session.undo.length, 2);
  assert.equal(vecHoleFor(state, hole).bunkers.some((bunker) => bunker.id === 9001), false);

  assert.equal(undo(state, session).ok, true);
  assertCourseTruth(state, afterEdit, 'undo delete');
  assert.equal(undo(state, session).ok, true);
  assertCourseTruth(state, before, 'undo edit');
  assert.equal(redo(state, session).ok, true);
  assert.equal(redo(state, session).ok, true);
  assert.equal(discardSession(state, session).ok, true);
  assertCourseTruth(state, before, 'discard edit/delete chain');
});

test('water and path production metadata edit/delete through exact history', () => {
  const state = fresh();
  const session = makeEditSession(state);
  const water = state.course.vec.waters[0];
  const path = state.course.paths[0];
  const before = cloneCourseTruth(state);

  const waterEdit = editVectorWater(state, session, { id: water.id }, {
    transform: { dx: -0.25, dy: 0.2, rotate: 0.03, scaleX: 1.04, scaleY: 0.96 },
    depth: 5.4,
    shoreline: { style: 'reeds', widthYd: 3.25, softness: 0.7 },
  });
  assert.equal(waterEdit.ok, true);
  assert.equal(waterEdit.water.id, water.id);
  assert.equal(waterEdit.water.surface, 'outline', 'edited geometry uses the exact authored water plane');
  assert.deepEqual(waterEdit.water.shoreline, { style: 'reeds', widthYd: 3.25, softness: 0.7 });

  const pathEdit = editPath(state, session, path.id, {
    width: path.width + 0.6,
    material: 'gravel',
    bridge: {
      enabled: true,
      startT: 0.2,
      endT: 0.72,
      deckHeightFt: 2.5,
      clearanceFt: 1.25,
      supportSpacingYd: 9,
      railings: true,
      deckMaterial: 'timber',
    },
  });
  assert.equal(pathEdit.ok, true);
  assert.equal(session.undo.length, 2, 'each API call is exactly one operation');
  assert.equal(state.course.paths.find((candidate) => candidate.id === path.id).material, 'gravel');
  const afterEdit = cloneCourseTruth(state);

  assert.equal(deleteVectorWater(state, session, { id: water.id }).ok, true);
  assert.equal(removePath(state, session, path.id).ok, true);
  assert.equal(state.course.vec.waters.some((candidate) => candidate.id === water.id), false);
  assert.equal(state.course.paths.some((candidate) => candidate.id === path.id), false);

  assert.equal(undo(state, session).ok, true);
  assert.equal(undo(state, session).ok, true);
  assertCourseTruth(state, afterEdit, 'undo deletes');
  assert.equal(discardSession(state, session).ok, true);
  assertCourseTruth(state, before, 'discard water/path edits');
});

test('stream control points, width, and depth edit/delete through exact history', () => {
  const state = fresh();
  state.course.vec.streams.push({
    id: 98765,
    pts: [{ x: 18, y: 18 }, { x: 21, y: 19 }, { x: 24, y: 18.5 }],
    w: 8,
    depth: 2.4,
  });
  invalidateGeom(state.course);
  deriveZones(state.course);
  const session = makeEditSession(state);
  const original = structuredClone(state.course.vec.streams[0]);
  const ref = original.id === undefined ? { index: 0 } : { id: original.id };
  const pts = original.pts.map((point, index) => ({
    x: point.x + (index === 1 ? 0.5 : 0),
    y: point.y + (index === 1 ? 0.25 : 0),
  }));
  const width = (original.w || 8) + 1.5;
  const depth = (original.depth || 2) + 0.4;

  const edited = editVectorStream(state, session, ref, { pts, width, depth });
  assert.equal(edited.ok, true);
  assert.deepEqual(edited.stream.pts, pts);
  assert.equal(edited.stream.w, width);
  assert.equal(edited.stream.depth, depth);
  assert.equal(session.undo.at(-1).label, 'Edit stream');

  assert.equal(deleteVectorStream(state, session, edited.ref).ok, true);
  assert.equal(session.undo.at(-1).label, 'Delete stream');
  assert.equal(undo(state, session).ok, true);
  assert.deepEqual(state.course.vec.streams[0].pts, pts);
  assert.equal(undo(state, session).ok, true);
  assert.deepEqual(state.course.vec.streams[0], original);
  assert.equal(redo(state, session).ok, true);
  assert.equal(redo(state, session).ok, true);
  assert.equal(state.course.vec.streams.length, 0);
  discardSession(state, session);
  assert.deepEqual(state.course.vec.streams[0], original);
});

test('no-op and invalid feature edits are atomic and never dirty history', () => {
  const state = fresh();
  const session = makeEditSession(state);
  const hole = state.course.holes[0];
  const vectorHole = vecHoleFor(state, hole);
  const bunker = vectorHole.bunkers[0];
  const water = state.course.vec.waters[0];
  const path = state.course.paths[0];
  const before = cloneCourseTruth(state);

  assert.equal(editVectorGreen(state, session, hole.id, {}).unchanged, true);
  assert.equal(editVectorBunker(state, session, hole.id, { index: 0 }, { depth: bunker.depth }).unchanged, true);
  assert.equal(editVectorWater(state, session, { id: water.id }, { depth: water.depth }).unchanged, true);
  assert.equal(editPath(state, session, path.id, { width: path.width, material: path.material }).unchanged, true);
  assert.equal(session.undo.length, 0);

  const invalid = [
    editVectorGreen(state, session, hole.id, { transform: { scale: 0 } }),
    editVectorGreen(state, session, hole.id, { apron: -1 }),
    editVectorBunker(state, session, hole.id, { index: 0 }, { depth: 0 }),
    editVectorWater(state, session, { id: water.id }, {
      pts: [{ x: 1, y: 1 }, { x: Number.NaN, y: 2 }, { x: 2, y: 3 }],
    }),
    editVectorWater(state, session, { id: water.id }, { shoreline: { style: 'vinyl' } }),
    editPath(state, session, path.id, { width: 0 }),
    editPath(state, session, path.id, { material: 'rubber' }),
    editPath(state, session, path.id, { bridge: { supportSpacingYd: 0 } }),
  ];
  assert.ok(invalid.every((result) => result.ok === false));
  assert.equal(session.undo.length, 0);
  assert.equal(session.redo.length, 0);
  assertCourseTruth(state, before, 'invalid calls');
});

test('legacy grid courses refuse vector/path CRUD without changing persisted truth', () => {
  const state = fresh();
  delete state.course.vec;
  const session = makeEditSession(state);
  const before = {
    holes: structuredClone(state.course.holes),
    paths: structuredClone(state.course.paths),
    zones: Uint8Array.from(state.course.zones),
  };
  const holeId = state.course.holes[0].id;
  const pathId = state.course.paths[0].id;
  const calls = [
    editVectorGreen(state, session, holeId, { apron: 3 }),
    editVectorBunker(state, session, holeId, { index: 0 }, { depth: 2 }),
    deleteVectorBunker(state, session, holeId, { index: 0 }),
    editVectorWater(state, session, { index: 0 }, { depth: 3 }),
    deleteVectorWater(state, session, { index: 0 }),
    addPath(state, session, [{ x: 2, y: 2 }, { x: 3, y: 3 }]),
    editPath(state, session, pathId, { width: 4 }),
    removePath(state, session, pathId),
  ];

  assert.ok(calls.every((result) => result.ok === false && result.unsupported === true));
  assert.equal(session.undo.length, 0);
  assert.deepEqual(state.course.holes, before.holes);
  assert.deepEqual(state.course.paths, before.paths);
  assert.deepEqual(Array.from(state.course.zones), Array.from(before.zones));
  assert.equal(state.course.vec, undefined);
});

test('green, bunker, water, and path metadata survive apply plus save/load exactly', () => {
  const state = fresh();
  const session = makeEditSession(state);
  const hole = state.course.holes[0];
  const vectorHole = vecHoleFor(state, hole);
  vectorHole.bunkers[0].id = 9101;
  const waterId = state.course.vec.waters[0].id;
  const pathId = state.course.paths[0].id;

  assert.equal(editVectorGreen(state, session, hole.id, {
    fringe: 1.25,
    apron: 5.5,
    sculpt: {
      raise: 2.4,
      tilt: 0.28,
      tiltA: 0.75,
      contours: [{ role: 'save-roll', x: vectorHole.green.cx, y: vectorHole.green.cy, r: 0.65, h: 0.2 }],
    },
  }).ok, true);
  assert.equal(editVectorBunker(state, session, hole.id, { id: 9101 }, { depth: 3.6, lip: 1.15 }).ok, true);
  assert.equal(editVectorWater(state, session, { id: waterId }, {
    depth: 6.25,
    shoreline: { style: 'mown', widthYd: 2.5, softness: 0.45 },
  }).ok, true);
  assert.equal(editPath(state, session, pathId, {
    width: 3.8,
    material: 'concrete',
    bridge: { enabled: true, startT: 0.1, endT: 0.4, supportSpacingYd: 8, deckMaterial: 'steel' },
  }).ok, true);
  assert.equal(applySession(state, session).ok, true);

  const round = deserialize(serialize(state));
  const roundHole = round.course.holes.find((candidate) => candidate.id === hole.id);
  const roundVectorHole = vecHoleFor(round, roundHole);
  assert.equal(roundVectorHole.green.fringe, 1.25);
  assert.equal(roundVectorHole.green.apron, 5.5);
  assert.equal(roundVectorHole.green.raise, 2.4);
  assert.deepEqual(roundVectorHole.green.contours,
    [{ role: 'save-roll', x: vectorHole.green.cx, y: vectorHole.green.cy, r: 0.65, h: 0.2 }]);
  assert.equal(roundVectorHole.bunkers.find((bunker) => bunker.id === 9101).lip, 1.15);
  assert.deepEqual(round.course.vec.waters.find((candidate) => candidate.id === waterId).shoreline,
    { style: 'mown', widthYd: 2.5, softness: 0.45 });
  assert.deepEqual(round.course.paths.find((candidate) => candidate.id === pathId).bridge,
    { enabled: true, startT: 0.1, endT: 0.4, supportSpacingYd: 8, deckMaterial: 'steel' });
});

function apronCourse(apron) {
  const course = makeCourse(24, 24);
  course.vec = emptyVec(77);
  course.vec.holes.push({
    id: 1,
    line: [{ x: 5, y: 11 }, { x: 11, y: 11 }],
    width: null,
    roughW: 18,
    tees: [],
    bunkers: [],
    green: {
      cx: 11,
      cy: 11,
      pts: [
        { x: 9.8, y: 9.8 }, { x: 12.2, y: 9.8 },
        { x: 12.2, y: 12.2 }, { x: 9.8, y: 12.2 },
      ],
      fringe: 1,
      ...(apron === undefined ? {} : { apron }),
      pins: [],
    },
  });
  return course;
}

test('green apron is a real SEMI band in evaluator and derived zones, defaulting to zero', () => {
  const legacyShape = apronCourse(undefined);
  deriveZones(legacyShape);
  assert.equal(legacyShape.zones.includes(ZONE.SEMI), false, 'missing apron preserves old surface classification');

  const withApron = apronCourse(8);
  deriveZones(withApron);
  const semiIndex = withApron.zones.indexOf(ZONE.SEMI);
  assert.notEqual(semiIndex, -1, 'an eight-yard apron reaches the coarse sim grid');
  const x = semiIndex % withApron.w;
  const y = Math.floor(semiIndex / withApron.w);
  const evaluated = evaluateSurface(withApron, getGeom(withApron), x + 0.5, y + 0.5, null);
  assert.equal(evaluated.zone, ZONE.SEMI, 'high-resolution evaluator agrees with deriveZones');

  withApron.vec.holes[0].green.apron = 0;
  invalidateGeom(withApron);
  deriveZones(withApron);
  assert.equal(withApron.zones.includes(ZONE.SEMI), false, 'zero apron is the compatibility default');
});
