import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE, HOLE_STATUS } from '../src/sim/constants.js';
import { BALANCE } from '../src/sim/balance.js';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { getZone } from '../src/sim/course.js';
import { deriveZones } from '../src/sim/courseVec.js';
import {
  makeEditSession, sessionDirty,
  beginTerrainStroke, sculptAt, endTerrainStroke,
  beginPaintStroke, paintAt, endPaintStroke,
  stampGreen, stampBunker, stampWater, stampStream, stampTee, setPinPosition, selectPin, selectTee,
  addObject, removeObject, moveObject, beginObjectGesture, previewObjectGesture, endObjectGesture,
  duplicateObject, scatterObjects, objectPlacementOk,
  addPath, editPath, commitPathPointDrag, removePath,
  newHole, deleteHole, setHoleSettings, reorderHole,
  undo, redo, applySession, discardSession,
  measure, courseStats, affectedHoles,
} from '../src/sim/courseEditor.js';

function fresh() {
  const st = newGame('relaxed', 4242);
  st.cash = 500000;
  return st;
}

// A quiet out-of-play scrub cell, clear of authored hole and cart-path corridors.
const QX = 35;
const QY = 22;

test('terrain stroke: raise applies live, undo restores exactly, bill follows', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const i = QY * st.course.w + QX;
  const before = st.course.elevation[i];

  const stroke = beginTerrainStroke(st, s);
  sculptAt(st, stroke, QX, QY, { mode: 'raise', radius: 2, strength: 1 });
  sculptAt(st, stroke, QX, QY, { mode: 'raise', radius: 2, strength: 1 });
  assert.ok(st.course.elevation[i] > before + 1.5, 'live elevation while dragging');
  const res = endTerrainStroke(st, s, stroke);
  assert.equal(res.ok, true);
  assert.ok(res.cost > 0, 'earthworks cost money');
  assert.equal(s.bill, res.cost);
  assert.equal(s.undo.length, 1, 'one drag = one undo step');

  assert.equal(undo(st, s).ok, true);
  assert.ok(Math.abs(st.course.elevation[i] - before) < 1e-6, 'undo restores height');
  assert.equal(s.bill, 0, 'undo refunds the pending bill');
  assert.equal(redo(st, s).ok, true);
  assert.ok(st.course.elevation[i] > before + 1.5, 'redo re-applies');
  assert.equal(s.bill, res.cost);
});

test('undoing to the session baseline is clean even while redo remains available', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const placed = addObject(st, s, 'rock_s', QX, QY);
  assert.equal(placed.ok, true);
  assert.equal(sessionDirty(s), true);
  assert.equal(undo(st, s).ok, true);
  assert.equal(s.undo.length, 0);
  assert.equal(s.redo.length, 1, 'the action can still be redone');
  assert.equal(sessionDirty(s), false, 'history alone is not pending construction');
  assert.equal(applySession(st, s).ok, false, 'there is nothing live to build');
});

test('terrain smooth and flatten converge instead of exploding', () => {
  const st = fresh();
  const s = makeEditSession(st);
  // make a spike, then smooth it
  const stroke1 = beginTerrainStroke(st, s);
  sculptAt(st, stroke1, QX, QY, { mode: 'raise', radius: 1, strength: 6 });
  endTerrainStroke(st, s, stroke1);
  const i = QY * st.course.w + QX;
  const spiked = st.course.elevation[i];
  const stroke2 = beginTerrainStroke(st, s);
  for (let k = 0; k < 12; k++) sculptAt(st, stroke2, QX, QY, { mode: 'smooth', radius: 3, strength: 0.6 });
  endTerrainStroke(st, s, stroke2);
  assert.ok(st.course.elevation[i] < spiked - 2, 'smoothing pulled the spike down');
  // flatten to a target
  const stroke3 = beginTerrainStroke(st, s);
  for (let k = 0; k < 10; k++) sculptAt(st, stroke3, QX, QY, { mode: 'flatten', radius: 3, strength: 0.8, target: 2 });
  endTerrainStroke(st, s, stroke3);
  assert.ok(Math.abs(st.course.elevation[i] - 2) < 0.6, `flatten approaches target, got ${st.course.elevation[i]}`);
});

test('paint stroke converts zones, prices them, undoes, and feeds turf sod', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const stroke = beginPaintStroke();
  paintAt(st, stroke, QX, QY, ZONE.FAIRWAY, { radius: 2 });
  const res = endPaintStroke(st, s, stroke);
  assert.equal(res.ok, true);
  assert.ok(res.cells >= 9, 'a radius-2 brush paints a real area');
  assert.equal(getZone(st.course, QX, QY), ZONE.FAIRWAY);
  const i = QY * st.course.w + QX;
  assert.ok(st.turf.health[i] > 0, 'fresh sod grows in painted turf');
  assert.equal(s.bill, res.cost);
  undo(st, s);
  assert.notEqual(getZone(st.course, QX, QY), ZONE.FAIRWAY, 'undo restores the old surface');
});

test('vector paint commits locally, matches a canonical full derive, and keeps sparse undo data', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const paintBefore = Uint8Array.from(st.course.paint);
  const stroke = beginPaintStroke();
  for (let step = 0; step < 9; step++) {
    paintAt(st, stroke, QX + step * 0.8, QY + Math.sin(step * 0.7), ZONE.FAIRWAY, { radius: 2.4 });
  }

  const res = endPaintStroke(st, s, stroke);
  assert.equal(res.ok, true);
  assert.equal(s.undo.length, 1);
  assert.equal(s.undo[0].kind, 'vector-paint');
  assert.ok(s.undo[0].paintChanges.length > 0);
  assert.equal('paintBefore' in s.undo[0], false, 'history does not clone the full paint field');
  assert.equal('paintAfter' in s.undo[0], false, 'history does not clone the full paint field');

  const locallyDerived = Uint8Array.from(st.course.zones);
  deriveZones(st.course);
  assert.deepEqual(st.course.zones, locallyDerived, 'local cell-centre update is byte-identical to a full derive');

  const paintAfter = Uint8Array.from(st.course.paint);
  const undone = undo(st, s);
  assert.equal(undone.kind, 'vector-paint');
  assert.deepEqual(st.course.paint, paintBefore, 'undo restores every authored paint sample');
  const redone = redo(st, s);
  assert.equal(redone.kind, 'vector-paint');
  assert.deepEqual(st.course.paint, paintAfter, 'redo restores every authored paint sample');
});

test('first vector paint undo and discard restore an absent override layer', () => {
  const st = fresh();
  delete st.course.paint;
  const s = makeEditSession(st);
  const stroke = beginPaintStroke();
  paintAt(st, stroke, QX, QY, ZONE.FAIRWAY, { radius: 2 });
  assert.equal(endPaintStroke(st, s, stroke).ok, true);
  assert.ok(st.course.paint instanceof Uint8Array);

  undo(st, s);
  assert.equal(Object.hasOwn(st.course, 'paint'), false, 'undo restores structural absence');
  redo(st, s);
  assert.ok(st.course.paint instanceof Uint8Array, 'redo recreates the layer');
  discardSession(st, s);
  assert.equal(Object.hasOwn(st.course, 'paint'), false, 'discard restores structural absence');
});

test('green stamp paints green + fringe collar and smooths a plateau', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const res = stampGreen(st, s, QX, QY, { r: 2, elong: 1.3, angle: 0.5 });
  assert.equal(res.ok, true);
  assert.equal(getZone(st.course, QX, QY), ZONE.GREEN);
  // a fringe collar must exist around the green. It is a genuinely narrow
  // real-world collar (~1yd), so the coarse 8-yd sim grid catches only a few
  // cells (the 0.5-yd visual field renders it densely — see visualField.test)
  let fringe = 0;
  for (let y = QY - 6; y <= QY + 6; y++) {
    for (let x = QX - 6; x <= QX + 6; x++) {
      if (getZone(st.course, x, y) === ZONE.FRINGE) fringe++;
    }
  }
  assert.ok(fringe >= 3, `fringe collar exists (${fringe} cells)`);
  undo(st, s);
  assert.notEqual(getZone(st.course, QX, QY), ZONE.GREEN);
});

test('vector green and bunker shape choices author distinct silhouettes', () => {
  const ovalState = fresh();
  const ovalSession = makeEditSession(ovalState);
  stampGreen(ovalState, ovalSession, QX, QY, { r: 2, elong: 1.35, angle: 0.3, kidney: false });
  const ovalGreen = ovalState.course.vec.holes.find((hole) => hole.green?.cx === QX && hole.green?.cy === QY)?.green;

  const kidneyState = fresh();
  const kidneySession = makeEditSession(kidneyState);
  stampGreen(kidneyState, kidneySession, QX, QY, { r: 2, elong: 1.35, angle: 0.3, kidney: true });
  const kidneyGreen = kidneyState.course.vec.holes.find((hole) => hole.green?.cx === QX && hole.green?.cy === QY)?.green;
  assert.ok(ovalGreen && kidneyGreen);
  assert.notDeepEqual(kidneyGreen.pts, ovalGreen.pts, 'Kidney is not a cosmetic alias for Oval');

  const roundState = fresh();
  const roundIds = new Set(roundState.course.vec.holes.flatMap((hole) => hole.bunkers).map((bunker) => bunker.id));
  stampBunker(roundState, makeEditSession(roundState), QX, QY, { r: 1.6, lobes: 1, stretch: 1, angle: 0.2 });
  const roundBunker = roundState.course.vec.holes.flatMap((hole) => hole.bunkers).find((bunker) => !roundIds.has(bunker.id));

  const ovalBunkerState = fresh();
  const ovalIds = new Set(ovalBunkerState.course.vec.holes.flatMap((hole) => hole.bunkers).map((bunker) => bunker.id));
  stampBunker(ovalBunkerState, makeEditSession(ovalBunkerState), QX, QY, { r: 1.6, lobes: 2, stretch: 1.45, angle: 0.2 });
  const ovalBunker = ovalBunkerState.course.vec.holes.flatMap((hole) => hole.bunkers).find((bunker) => !ovalIds.has(bunker.id));
  assert.ok(roundBunker && ovalBunker);
  assert.notDeepEqual(roundBunker.pts, ovalBunker.pts, 'Round is not a cosmetic alias for Oval');
});

test('vector green and bunker stamps honor the explicitly selected hole', () => {
  const greenState = fresh();
  const greenSession = makeEditSession(greenState);
  const firstGreenHole = greenState.course.holes[0];
  const targetGreenHole = greenState.course.holes[1];
  const firstGreenBefore = structuredClone(
    greenState.course.vec.holes.find((hole) => hole.id === firstGreenHole.vecId).green,
  );

  const greenResult = stampGreen(greenState, greenSession, QX, QY, {
    r: 1.8,
    holeId: targetGreenHole.id,
  });
  assert.equal(greenResult.ok, true);
  const targetedGreen = greenState.course.vec.holes.find((hole) => hole.id === targetGreenHole.vecId).green;
  assert.equal(targetedGreen.cx, QX);
  assert.equal(targetedGreen.cy, QY);
  assert.deepEqual(
    greenState.course.vec.holes.find((hole) => hole.id === firstGreenHole.vecId).green,
    firstGreenBefore,
    'a selected-hole stamp must not replace the geographically nearest hole green',
  );
  assert.deepEqual(targetGreenHole.pin, { x: QX, y: QY });

  const bunkerState = fresh();
  const bunkerSession = makeEditSession(bunkerState);
  const firstBunkerHole = bunkerState.course.holes[0];
  const targetBunkerHole = bunkerState.course.holes[1];
  const firstCount = bunkerState.course.vec.holes.find((hole) => hole.id === firstBunkerHole.vecId).bunkers.length;
  const targetBunkers = bunkerState.course.vec.holes.find((hole) => hole.id === targetBunkerHole.vecId).bunkers;
  const targetIds = new Set(targetBunkers.map((bunker) => bunker.id));

  const bunkerResult = stampBunker(bunkerState, bunkerSession, QX, QY, {
    r: 1.4,
    holeId: targetBunkerHole.id,
  });
  assert.equal(bunkerResult.ok, true);
  assert.equal(
    bunkerState.course.vec.holes.find((hole) => hole.id === firstBunkerHole.vecId).bunkers.length,
    firstCount,
  );
  const created = targetBunkers.find((bunker) => !targetIds.has(bunker.id));
  assert.ok(created, 'the bunker is attached to the selected vector hole');
  const bunkerCenter = created.pts.reduce(
    (sum, point) => ({ x: sum.x + point.x / created.pts.length, y: sum.y + point.y / created.pts.length }),
    { x: 0, y: 0 },
  );
  assert.ok(Math.hypot(bunkerCenter.x - QX, bunkerCenter.y - QY) < 0.5, 'the authored outline is at the click');

  const invalidState = fresh();
  const invalid = stampGreen(invalidState, makeEditSession(invalidState), QX, QY, { holeId: 999999 });
  assert.equal(invalid.ok, false);
  assert.match(invalid.reason, /no such hole/i);
});

test('bunker stamp digs a lobed depression; water floods a bowl', () => {
  const st = fresh();
  const s = makeEditSession(st);
  // on a vector course the bowl is analytic (rendered), so the sim truth is the
  // vec feature + the derived BUNKER zone — the renderer sculpts the depression
  const bunkersBefore = st.course.vec.holes.reduce((a, h) => a + (h.bunkers || []).length, 0);
  const res = stampBunker(st, s, QX, QY, { r: 1.6, depth: 1.5 });
  assert.equal(res.ok, true);
  assert.equal(getZone(st.course, QX, QY), ZONE.BUNKER);
  const bunkersAfter = st.course.vec.holes.reduce((a, h) => a + (h.bunkers || []).length, 0);
  assert.equal(bunkersAfter, bunkersBefore + 1, 'a bunker feature was authored');

  const res2 = stampWater(st, s, QX + 8, QY + 4, { r: 2.2, depth: 2 });
  assert.equal(res2.ok, true);
  assert.equal(getZone(st.course, QX + 8, QY + 4), ZONE.WATER);
  assert.ok(st.course.vec.waters.length >= 1, 'a pond feature was authored');

  const res3 = stampStream(st, s, [{ x: QX + 4, y: QY + 10 }, { x: QX + 10, y: QY + 12 }, { x: QX + 15, y: QY + 10 }]);
  assert.equal(res3.ok, true);
  assert.ok(st.course.vec.streams.length >= 1, 'a stream feature was authored');
});

test('tee stamp builds a level pad and sets the hole tee; pins A/B/C work', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const hole = st.course.holes[0];
  const res = stampTee(st, s, hole.id, 'forward', QX, QY, QX + 10, QY, {});
  assert.equal(res.ok, true);
  assert.equal(getZone(st.course, QX, QY), ZONE.TEE);
  assert.equal(hole.activeTee, 'forward');
  assert.deepEqual(hole.tee, { x: QX, y: QY }, 'hole.tee writes through for old systems');

  // pin B on the hole's green
  const pin = hole.pins.A;
  const resB = setPinPosition(st, s, hole.id, 'B', pin.x, pin.y);
  assert.equal(resB.ok, true);
  assert.equal(hole.activePin, 'B');
  const back = selectPin(st, s, hole.id, 'A');
  assert.equal(back.ok, true);
  assert.deepEqual(hole.pin, hole.pins.A);
});

test('selecting an existing tee or pin is dirty, undoable, and free', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const hole = st.course.holes[0];
  const originalPin = hole.activePin;
  const originalTee = hole.activeTee;
  const alternatePin = ['A', 'B', 'C'].find((key) => key !== originalPin && hole.pins[key]);
  const alternateTee = ['back', 'middle', 'forward'].find((key) => key !== originalTee && hole.tees[key]);

  assert.equal(selectPin(st, s, hole.id, alternatePin).ok, true);
  assert.equal(selectTee(st, s, hole.id, alternateTee).ok, true);
  assert.equal(sessionDirty(s), true);
  assert.equal(s.bill, 0);
  assert.equal(hole.activePin, alternatePin);
  assert.equal(hole.activeTee, alternateTee);

  undo(st, s);
  undo(st, s);
  assert.equal(hole.activePin, originalPin);
  assert.equal(hole.activeTee, originalTee);
  assert.equal(sessionDirty(s), false, 'undoing every live choice returns to the clean baseline');
  discardSession(st, s);
  assert.equal(sessionDirty(s), false);
});

test('undo clears the renovation footprint for work no longer pending', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const hole = st.course.holes[0];
  const mx = Math.round((hole.tee.x + hole.pin.x) / 2);
  const my = Math.round((hole.tee.y + hole.pin.y) / 2);
  const stroke = beginPaintStroke();
  paintAt(st, stroke, mx, my, ZONE.BUNKER, { radius: 2 });
  assert.equal(endPaintStroke(st, s, stroke).ok, true);
  assert.ok(s.changedCells.size > 0);

  assert.equal(undo(st, s).ok, true);
  assert.equal(s.changedCells.size, 0);
  assert.deepEqual(affectedHoles(st, s), []);
  assert.equal(applySession(st, s).ok, false, 'fully undone work cannot be built');
  assert.equal(hole.status, HOLE_STATUS.OPEN);
});

test('objects: place, refuse greens, move, duplicate, remove, scatter, undo chain', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const countBefore = st.course.objects.length;
  const nextObjectId = st.course.nextObjectId;

  const bad = addObject(st, s, 'tree_oak', st.course.holes[0].pin.x, st.course.holes[0].pin.y);
  assert.equal(bad.ok, false, 'no trees on the green');
  assert.equal(objectPlacementOk(st.course, 'tree_oak', QX, QY).ok, true);

  const a = addObject(st, s, 'tree_oak', QX, QY);
  assert.equal(a.ok, true);
  assert.equal(st.course.objects.length, countBefore + 1);
  const mv = moveObject(st, s, a.object.id, { x: QX + 2, rot: 1.2 });
  assert.equal(mv.ok, true);
  const dup = duplicateObject(st, s, a.object.id);
  assert.equal(dup.ok, true);
  const rm = removeObject(st, s, dup.object ? dup.object.id : a.object.id);
  assert.equal(rm.ok, true);

  const sc = scatterObjects(st, s, ['bush_round', 'rock_s'], QX, QY + 6, { radius: 3, count: 5, rng: (() => { let k = 1; return () => ((k = (k * 16807) % 2147483647) / 2147483647); })() });
  assert.equal(sc.ok, true);
  assert.ok(sc.count >= 1);

  // unwind everything
  let guard = 0;
  while (s.undo.length && guard++ < 100) undo(st, s);
  assert.equal(st.course.objects.length, countBefore, 'undo chain restores the object list');
  assert.equal(st.course.nextObjectId, nextObjectId, 'undo chain restores the object identity sequence');
  assert.equal(s.bill, 0);
});

test('object placement, move, scale, and duplicate enforce collision footprints', () => {
  const st = fresh();
  st.course.objects = [];
  st.course.nextObjectId = 1;
  const s = makeEditSession(st);
  const tree = addObject(st, s, 'tree_oak', QX, QY, { scale: 1 });
  assert.equal(tree.ok, true);

  const overlap = addObject(st, s, 'bench', QX, QY, { scale: 1 });
  assert.equal(overlap.ok, false);
  assert.equal(overlap.reason, 'Too close to another object.');

  const scaleGesture = beginObjectGesture(st, tree.object.id, 'Scale object');
  assert.equal(previewObjectGesture(st, scaleGesture, { scale: 1.4 }).ok, true,
    'selected-object scale ignores its own footprint');
  assert.equal(endObjectGesture(st, s, scaleGesture).ok, true);

  const rock = addObject(st, s, 'rock_s', QX + 8, QY + 7);
  assert.equal(rock.ok, true);
  const moveGesture = beginObjectGesture(st, tree.object.id, 'Move object');
  const blockedMove = previewObjectGesture(st, moveGesture, { x: rock.object.x, y: rock.object.y });
  assert.equal(blockedMove.ok, false);
  assert.equal(blockedMove.collidesWith, rock.object.id);

  const copy = duplicateObject(st, s, tree.object.id);
  assert.equal(copy.ok, true);
  assert.notDeepEqual(
    { x: copy.object.x, y: copy.object.y },
    { x: tree.object.x, y: tree.object.y },
    'duplicate searches for nearby collision-free ground',
  );
});

test('object drag and transform gestures preview live but commit one undo entry each', () => {
  const cases = [
    {
      label: 'Move object',
      patches: [
        { x: QX + 5, y: QY + 4 },
        { x: QX + 8, y: QY + 7 },
        { x: QX + 10, y: QY + 10 },
      ],
    },
    {
      label: 'Rotate object',
      patches: [{ rot: 0.4 }, { rot: 0.9 }, { rot: 1.3 }],
    },
    {
      label: 'Scale object',
      patches: [{ scale: 1.1 }, { scale: 1.25 }, { scale: 1.4 }],
    },
  ];

  for (const { label, patches } of cases) {
    const st = fresh();
    const setup = makeEditSession(st);
    const placed = addObject(st, setup, 'tree_oak', QX, QY, { rot: 0.1, scale: 1 });
    assert.equal(placed.ok, true);
    assert.equal(applySession(st, setup).ok, true);

    const s = makeEditSession(st);
    const before = { ...placed.object };
    const gesture = beginObjectGesture(st, placed.object.id, label);
    assert.ok(gesture);
    for (const patch of patches) {
      assert.equal(previewObjectGesture(st, gesture, patch).ok, true);
      assert.equal(s.undo.length, 0, `${label} preview does not write history`);
    }
    const after = { ...placed.object };
    assert.notDeepEqual(after, before, `${label} updates the live object`);

    assert.equal(endObjectGesture(st, s, gesture).ok, true);
    assert.equal(s.undo.length, 1, `${label} commits one history entry`);
    assert.equal(s.undo[0].label, label);

    assert.equal(undo(st, s).ok, true);
    assert.deepEqual(placed.object, before, `${label} undo restores the opening pose`);
    assert.equal(redo(st, s).ok, true);
    assert.deepEqual(placed.object, after, `${label} redo restores the final preview`);
  }
});

test('paths: add paints pavement, edit reroutes, remove restores, undo is exact', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const zonesBefore = Uint8Array.from(st.course.zones);
  const pathsBefore = st.course.paths.length;
  const nextPathId = st.course.nextPathId;

  const res = addPath(st, s, [{ x: QX, y: QY }, { x: QX + 6, y: QY + 2 }, { x: QX + 12, y: QY }], { width: 2.6, material: 'concrete' });
  assert.equal(res.ok, true);
  assert.ok(res.cost > 0, 'new pavement costs money');
  assert.equal(st.course.paths.length, pathsBefore + 1);
  let paved = 0;
  for (let i = 0; i < st.course.zones.length; i++) {
    if (st.course.zones[i] === ZONE.PATH && zonesBefore[i] !== ZONE.PATH) paved++;
  }
  // a 2.6-yd ribbon is sub-cell on the 8-yd sim grid, so only the cells its
  // centerline crosses register PATH (the ribbon mesh + shoulder render full width)
  assert.ok(paved >= 3, `pavement painted (${paved} cells)`);

  const pid = res.path.id;
  assert.equal(editPath(st, s, pid, { width: 4 }).ok, true);
  assert.equal(removePath(st, s, pid).ok, true);
  assert.equal(st.course.paths.length, pathsBefore);

  let guard = 0;
  while (s.undo.length && guard++ < 100) undo(st, s);
  assert.deepEqual(Array.from(st.course.zones), Array.from(zonesBefore), 'zones byte-identical after full undo');
  assert.equal(st.course.nextPathId, nextPathId, 'undo restores the path identity sequence');
});

test('path-point live preview commits one exact undoable drag', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const path = st.course.paths[0];
  const pointsBefore = structuredClone(path.pts);
  const zonesBefore = Uint8Array.from(st.course.zones);

  // The UI previews against the live spline while the pointer is held.
  path.pts[0] = { x: pointsBefore[0].x + 3, y: pointsBefore[0].y + 2 };
  const previewPts = structuredClone(path.pts);
  const res = commitPathPointDrag(st, s, path.id, pointsBefore, previewPts);
  const zonesAfter = Uint8Array.from(st.course.zones);

  assert.equal(res.ok, true);
  assert.equal(s.undo.length, 1, 'one pointer drag records one edit');
  assert.deepEqual(st.course.paths.find((p) => p.id === path.id).pts, previewPts,
    'committed spline matches the live preview');

  assert.equal(undo(st, s).ok, true);
  assert.deepEqual(st.course.paths.find((p) => p.id === path.id).pts, pointsBefore,
    'undo restores the captured spline geometry');
  assert.deepEqual(Array.from(st.course.zones), Array.from(zonesBefore), 'undo restores its raster footprint');

  assert.equal(redo(st, s).ok, true);
  assert.deepEqual(st.course.paths.find((p) => p.id === path.id).pts, previewPts,
    'redo restores the dragged geometry');
  assert.deepEqual(Array.from(st.course.zones), Array.from(zonesAfter), 'redo restores its raster footprint');

  discardSession(st, s);
  assert.deepEqual(st.course.paths.find((p) => p.id === path.id).pts, pointsBefore,
    'discard restores the pre-drag geometry');
  assert.deepEqual(Array.from(st.course.zones), Array.from(zonesBefore), 'discard restores the pre-drag raster');
});

test('holes: add, settings, reorder, delete — with undo', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const n = st.course.holes.length;
  const nextHoleId = st.course.nextHoleId;
  const res = newHole(st, s);
  assert.equal(res.ok, true);
  assert.equal(st.course.holes.length, n + 1);
  assert.equal(res.cost, BALANCE.newHoleCost);

  const h1 = st.course.holes[0];
  const originalName = h1.name;
  const set = setHoleSettings(st, s, h1.id, { name: 'Renamed Test Hole', handicap: 6, parOverride: 4 });
  assert.equal(set.ok, true);
  assert.equal(h1.name, 'Renamed Test Hole');

  assert.equal(reorderHole(st, s, h1.id, +1).ok, true);
  assert.equal(st.course.holes[1].id, h1.id);

  assert.equal(deleteHole(st, s, res.hole.id).ok, true);
  assert.equal(st.course.holes.length, n);

  let guard = 0;
  while (s.undo.length && guard++ < 100) undo(st, s);
  assert.equal(st.course.holes.length, n);
  assert.equal(st.course.holes[0].id, h1.id, 'order restored');
  assert.equal(st.course.holes[0].name, originalName, 'name restored by undo');
  assert.equal(st.course.nextHoleId, nextHoleId, 'undo restores the hole identity sequence');
});

test('economics: preview accumulates, apply charges exactly once, insufficient funds refuse', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const cash0 = st.cash;

  const stroke = beginPaintStroke();
  paintAt(st, stroke, QX, QY, ZONE.GREEN, { radius: 2 });
  const res = endPaintStroke(st, s, stroke);
  assert.ok(res.cost > 0);
  assert.equal(st.cash, cash0, 'preview charges nothing');

  const apply = applySession(st, s);
  assert.equal(apply.ok, true);
  assert.equal(st.cash, cash0 - apply.report.cost, 'charged exactly once on apply');
  assert.equal(s.bill, 0);
  assert.equal(sessionDirty(s), false, 'session settles after apply');

  // second apply with nothing pending must be a no-op
  const again = applySession(st, s);
  assert.equal(again.ok, false, 'no double charge');
  assert.equal(st.cash, cash0 - apply.report.cost);

  // refuse when broke
  st.cash = 3;
  const s2 = makeEditSession(st);
  const stroke2 = beginPaintStroke();
  paintAt(st, stroke2, QX + 6, QY + 6, ZONE.GREEN, { radius: 2 });
  endPaintStroke(st, s2, stroke2);
  const refuse = applySession(st, s2);
  assert.equal(refuse.ok, false);
  assert.match(refuse.reason, /Not enough cash/);
  assert.equal(st.cash, 3, 'a refused apply never touches the wallet');
});

test('apply near an open hole schedules renovation; discard restores everything', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const hole = st.course.holes[0];
  assert.equal(hole.status, HOLE_STATUS.OPEN);

  // paint right on hole 1's corridor
  const mx = Math.round((hole.tee.x + hole.pin.x) / 2);
  const my = Math.round((hole.tee.y + hole.pin.y) / 2);
  const stroke = beginPaintStroke();
  paintAt(st, stroke, mx, my, ZONE.BUNKER, { radius: 2 });
  endPaintStroke(st, s, stroke);
  const aff = affectedHoles(st, s);
  assert.ok(aff.some((a) => a.holeId === hole.id), 'edit is detected on the corridor');
  const apply = applySession(st, s);
  assert.equal(apply.ok, true);
  assert.equal(hole.status, HOLE_STATUS.RENOVATION, 'open hole closes for the works');

  // discard: a new session's edits vanish without charge
  const zones0 = Uint8Array.from(st.course.zones);
  const cash0 = st.cash;
  const s2 = makeEditSession(st);
  const stroke2 = beginPaintStroke();
  paintAt(st, stroke2, QX, QY, ZONE.WATER, { radius: 3, over: new Set([ZONE.OUT, ZONE.HEAVY, ZONE.ROUGH]) });
  endPaintStroke(st, s2, stroke2);
  discardSession(st, s2);
  assert.deepEqual(Array.from(st.course.zones), Array.from(zones0), 'discard restores zones');
  assert.equal(st.cash, cash0);
});

test('edits survive serialize/deserialize: objects, paths, hole extras, surfaces', () => {
  const st = fresh();
  const s = makeEditSession(st);
  stampGreen(st, s, QX, QY, { r: 1.8 });
  const bench = addObject(st, s, 'bench', QX + 8, QY + 8, { rot: 0.4, scale: 1.1 });
  assert.equal(bench.ok, true, 'the persisted bench is placed on collision-free ground');
  addPath(st, s, [{ x: QX, y: QY + 8 }, { x: QX + 8, y: QY + 8 }]);
  setHoleSettings(st, s, st.course.holes[0].id, { name: 'The Test', handicap: 3 });
  setPinPosition(st, s, st.course.holes[0].id, 'C', st.course.holes[0].pins.A.x, st.course.holes[0].pins.A.y);
  applySession(st, s);

  const round = deserialize(serialize(st));
  assert.equal(getZone(round.course, QX, QY), ZONE.GREEN);
  assert.ok(round.course.objects.some((o) => o.type === 'bench'), 'bench survives');
  assert.ok(round.course.paths.length >= 2, 'paths survive');
  assert.equal(round.course.holes[0].name, 'The Test');
  assert.equal(round.course.holes[0].activePin, 'C');
  assert.deepEqual(round.course.holes[0].pins.C, st.course.holes[0].pins.C);
});

test('measure reports yards, elevation change, slope', () => {
  const st = fresh();
  const m = measure(st.course, { x: 10, y: 10 }, { x: 20, y: 10 });
  assert.equal(m.yards, 80, '10 cells = 80 yd');
  assert.ok(Number.isFinite(m.elevationFt));
  assert.ok(Number.isFinite(m.slopeDeg));
});

test('course statistics add up and answer the editor', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const stats = courseStats(st, s);
  assert.equal(stats.holes, 9);
  assert.ok(stats.totalPar >= 33 && stats.totalPar <= 38);
  assert.ok(stats.totalYd > 2000);
  assert.ok(stats.fairwayAcres > 5);
  assert.ok(stats.greenAcres > 0.5);
  assert.ok(stats.treeCount > 300, `intentional planting exists (${stats.treeCount})`);
  assert.ok(stats.difficulty >= 1 && stats.difficulty <= 5);
  assert.equal(stats.pendingCost, 0);
});
