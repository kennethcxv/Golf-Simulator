import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE, HOLE_STATUS } from '../src/sim/constants.js';
import { BALANCE } from '../src/sim/balance.js';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { getZone } from '../src/sim/course.js';
import {
  makeEditSession, sessionDirty,
  beginTerrainStroke, sculptAt, endTerrainStroke,
  beginPaintStroke, paintAt, endPaintStroke,
  stampGreen, stampBunker, stampWater, stampStream, stampTee, setPinPosition, selectPin,
  addObject, removeObject, moveObject, duplicateObject, scatterObjects, objectPlacementOk,
  addPath, editPath, removePath,
  newHole, deleteHole, setHoleSettings, reorderHole,
  undo, redo, applySession, discardSession,
  measure, courseStats, affectedHoles,
} from '../src/sim/courseEditor.js';

function fresh() {
  const st = newGame('relaxed', 4242);
  st.cash = 500000;
  return st;
}

// a quiet corner of scrub far from any hole corridor
const QX = 66;
const QY = 30;

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

test('green stamp paints green + fringe collar and smooths a plateau', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const res = stampGreen(st, s, QX, QY, { r: 2, elong: 1.3, angle: 0.5 });
  assert.equal(res.ok, true);
  assert.equal(getZone(st.course, QX, QY), ZONE.GREEN);
  // a fringe cell must exist adjacent to the green somewhere
  let fringe = 0;
  for (let y = QY - 5; y <= QY + 5; y++) {
    for (let x = QX - 5; x <= QX + 5; x++) {
      if (getZone(st.course, x, y) === ZONE.FRINGE) fringe++;
    }
  }
  assert.ok(fringe >= 6, `fringe collar exists (${fringe} cells)`);
  undo(st, s);
  assert.notEqual(getZone(st.course, QX, QY), ZONE.GREEN);
});

test('bunker stamp digs a lobed depression; water floods a bowl', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const i = QY * st.course.w + QX;
  const elevBefore = st.course.elevation[i];
  const res = stampBunker(st, s, QX, QY, { r: 1.6, depth: 1.5 });
  assert.equal(res.ok, true);
  assert.equal(getZone(st.course, QX, QY), ZONE.BUNKER);
  assert.ok(st.course.elevation[i] < elevBefore - 0.5, 'sand sits below its lip');

  const res2 = stampWater(st, s, QX + 8, QY + 4, { r: 2.2, depth: 2 });
  assert.equal(res2.ok, true);
  assert.equal(getZone(st.course, QX + 8, QY + 4), ZONE.WATER);

  const res3 = stampStream(st, s, [{ x: QX + 4, y: QY + 10 }, { x: QX + 10, y: QY + 12 }, { x: QX + 15, y: QY + 10 }]);
  assert.equal(res3.ok, true);
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

test('objects: place, refuse greens, move, duplicate, remove, scatter, undo chain', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const countBefore = st.course.objects.length;

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
  assert.equal(s.bill, 0);
});

test('paths: add paints pavement, edit reroutes, remove restores, undo is exact', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const zonesBefore = Uint8Array.from(st.course.zones);
  const pathsBefore = st.course.paths.length;

  const res = addPath(st, s, [{ x: QX, y: QY }, { x: QX + 6, y: QY + 2 }, { x: QX + 12, y: QY }], { width: 2.6, material: 'concrete' });
  assert.equal(res.ok, true);
  assert.ok(res.cost > 0, 'new pavement costs money');
  assert.equal(st.course.paths.length, pathsBefore + 1);
  let paved = 0;
  for (let i = 0; i < st.course.zones.length; i++) {
    if (st.course.zones[i] === ZONE.PATH && zonesBefore[i] !== ZONE.PATH) paved++;
  }
  assert.ok(paved >= 8, `pavement painted (${paved} cells)`);

  const pid = res.path.id;
  assert.equal(editPath(st, s, pid, { width: 4 }).ok, true);
  assert.equal(removePath(st, s, pid).ok, true);
  assert.equal(st.course.paths.length, pathsBefore);

  let guard = 0;
  while (s.undo.length && guard++ < 100) undo(st, s);
  assert.deepEqual(Array.from(st.course.zones), Array.from(zonesBefore), 'zones byte-identical after full undo');
});

test('holes: add, settings, reorder, delete — with undo', () => {
  const st = fresh();
  const s = makeEditSession(st);
  const n = st.course.holes.length;
  const res = newHole(st, s);
  assert.equal(res.ok, true);
  assert.equal(st.course.holes.length, n + 1);
  assert.equal(res.cost, BALANCE.newHoleCost);

  const h1 = st.course.holes[0];
  const set = setHoleSettings(st, s, h1.id, { name: 'Opening Drive', handicap: 6, parOverride: 4 });
  assert.equal(set.ok, true);
  assert.equal(h1.name, 'Opening Drive');

  assert.equal(reorderHole(st, s, h1.id, +1).ok, true);
  assert.equal(st.course.holes[1].id, h1.id);

  assert.equal(deleteHole(st, s, res.hole.id).ok, true);
  assert.equal(st.course.holes.length, n);

  let guard = 0;
  while (s.undo.length && guard++ < 100) undo(st, s);
  assert.equal(st.course.holes.length, n);
  assert.equal(st.course.holes[0].id, h1.id, 'order restored');
  assert.notEqual(st.course.holes[0].name, 'Opening Drive');
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
  addObject(st, s, 'bench', QX + 5, QY + 5, { rot: 0.4, scale: 1.1 });
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
