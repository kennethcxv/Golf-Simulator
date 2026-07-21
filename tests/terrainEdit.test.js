import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE, HOLE_STATUS } from '../src/sim/constants.js';
import { BALANCE } from '../src/sim/balance.js';
import { makeCourse, setZone, getZone, addHole, labelSections } from '../src/sim/course.js';
import {
  makePlan, planPaintZone, planAdjustElev, planToggleIrrigation, planCost, planAffectedHoles,
  applyPlan, worksSetTee, worksSetPin, tickRenovationsDaily,
} from '../src/sim/terrainEdit.js';

function makeState(cash = 1000000, mode = 'realistic') {
  const course = makeCourse();
  return { mode, cash, course, sections: labelSections(course) };
}

test('plan paint adds cells, skips no-ops, and merges repaints', () => {
  const st = makeState();
  const plan = makePlan();
  planPaintZone(plan, st.course, 10, 10, 0, ZONE.FAIRWAY);
  assert.equal(plan.cells.size, 1);
  // repaint same cell to another zone replaces, not duplicates
  planPaintZone(plan, st.course, 10, 10, 0, ZONE.GREEN);
  assert.equal(plan.cells.size, 1);
  assert.equal([...plan.cells.values()][0].zone, ZONE.GREEN);
  // painting back to what the course already has removes the entry entirely
  planPaintZone(plan, st.course, 10, 10, 0, ZONE.OUT);
  assert.equal(plan.cells.size, 0);
});

test('radius-1 brush paints a 5-cell plus shape', () => {
  const st = makeState();
  const plan = makePlan();
  planPaintZone(plan, st.course, 20, 20, 1, ZONE.ROUGH);
  assert.equal(plan.cells.size, 5);
});

test('elevation edits accumulate and cancel to nothing', () => {
  const st = makeState();
  const plan = makePlan();
  planAdjustElev(plan, st.course, 5, 5, 0, +0.5);
  planAdjustElev(plan, st.course, 5, 5, 0, +0.5);
  assert.equal(plan.cells.size, 1);
  planAdjustElev(plan, st.course, 5, 5, 0, -1.0);
  assert.equal(plan.cells.size, 0, 'net-zero elevation edit should vanish from the plan');
});

test('irrigation heads are paid construction: inert in plan, persistent on confirm, removable', () => {
  const st = makeState(10000);
  const c = st.course;
  setZone(c, 20, 20, ZONE.FAIRWAY);
  const plan = makePlan();
  assert.equal(planToggleIrrigation(plan, c, 20, 20, true).ok, true);
  assert.equal((c.irrigationHeads || []).length, 0, 'planning does not build the head');
  assert.equal(planCost(plan, c).total, BALANCE.irrigationHeadCost);
  const placed = applyPlan(st, plan);
  assert.equal(placed.ok, true);
  assert.deepEqual(c.irrigationHeads, [{ x: 20, y: 20 }]);
  assert.equal(placed.report.headsPlaced, 1);

  const remove = makePlan();
  assert.equal(planToggleIrrigation(remove, c, 20, 20, false).ok, true);
  assert.equal(planCost(remove, c).total, BALANCE.irrigationHeadRemoveCost);
  assert.equal(applyPlan(st, remove).report.headsRemoved, 1);
  assert.deepEqual(c.irrigationHeads, []);

  const invalid = makePlan();
  assert.equal(planToggleIrrigation(invalid, c, 1, 1, true).ok, false, 'heads cannot be built into out-of-play ground');
});

test('planCost prices zone conversions and elevation by the book', () => {
  const st = makeState();
  const plan = makePlan();
  planPaintZone(plan, st.course, 10, 10, 0, ZONE.GREEN);
  planPaintZone(plan, st.course, 11, 10, 0, ZONE.GREEN);
  planAdjustElev(plan, st.course, 30, 30, 0, +2);
  const cost = planCost(plan, st.course, st.mode);
  const expected = 2 * BALANCE.zoneCost.green + 2 * BALANCE.elevationCostPerFoot;
  assert.equal(cost.total, expected);
});

test('edits near an open hole flag it for renovation; distant edits do not', () => {
  const st = makeState();
  const c = st.course;
  // a simple open hole straight down the map
  for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) setZone(c, x, y, ZONE.TEE);
  for (let y = 38; y <= 42; y++) for (let x = 8; x <= 12; x++) setZone(c, x, y, ZONE.GREEN);
  const h = addHole(c);
  h.tee = { x: 10, y: 10 };
  h.pin = { x: 10, y: 40 };
  h.status = HOLE_STATUS.OPEN;

  const near = makePlan();
  planPaintZone(near, c, 12, 25, 0, ZONE.BUNKER); // 2 cells off the tee→pin line
  const affectedNear = planAffectedHoles(near, c, st.mode);
  assert.equal(affectedNear.length, 1);
  assert.equal(affectedNear[0].holeId, h.id);
  assert.ok(affectedNear[0].days >= BALANCE.renovation.realistic.minDays);

  const far = makePlan();
  planPaintZone(far, c, 60, 25, 0, ZONE.BUNKER);
  assert.equal(planAffectedHoles(far, c, st.mode).length, 0);
});

test('applyPlan refuses when cash is short and changes nothing', () => {
  const st = makeState(100); // broke
  const plan = makePlan();
  planPaintZone(plan, st.course, 10, 10, 0, ZONE.GREEN);
  const res = applyPlan(st, plan);
  assert.equal(res.ok, false);
  assert.equal(st.cash, 100);
  assert.equal(getZone(st.course, 10, 10), ZONE.OUT);
});

test('applyPlan applies zones + elevation, charges cash, relabels sections, triggers renovation', () => {
  const st = makeState(50000);
  const c = st.course;
  for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) setZone(c, x, y, ZONE.TEE);
  for (let y = 38; y <= 42; y++) for (let x = 8; x <= 12; x++) setZone(c, x, y, ZONE.GREEN);
  const h = addHole(c);
  h.tee = { x: 10, y: 10 };
  h.pin = { x: 10, y: 40 };
  h.status = HOLE_STATUS.OPEN;
  st.sections = labelSections(c);

  const plan = makePlan();
  planPaintZone(plan, c, 12, 25, 1, ZONE.BUNKER); // 5 cells near the line
  planAdjustElev(plan, c, 12, 25, 0, +1.5);
  const cost = planCost(plan, c, st.mode).total;
  const res = applyPlan(st, plan);
  assert.equal(res.ok, true);
  assert.equal(st.cash, 50000 - cost);
  assert.equal(getZone(c, 12, 25), ZONE.BUNKER);
  assert.equal(h.status, HOLE_STATUS.RENOVATION);
  assert.ok(h.daysLeft >= 2);
  assert.ok(st.sections.some((s) => s.zone === ZONE.BUNKER), 'sections must be relabeled after apply');
  assert.equal(plan.cells.size, 0, 'plan is consumed on apply');
});

test('tee/pin placement costs money, validates target zone, and renovates open holes', () => {
  const st = makeState(10000);
  const c = st.course;
  for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) setZone(c, x, y, ZONE.TEE);
  for (let y = 38; y <= 42; y++) for (let x = 8; x <= 12; x++) setZone(c, x, y, ZONE.GREEN);
  const h = addHole(c);

  // invalid: pin not on a green
  const bad = worksSetPin(st, h.id, 30, 30);
  assert.equal(bad.ok, false);
  assert.equal(st.cash, 10000);

  const t = worksSetTee(st, h.id, 10, 10);
  assert.equal(t.ok, true);
  assert.equal(st.cash, 10000 - BALANCE.holeMoveCost);
  assert.equal(h.status, HOLE_STATUS.UNBUILT, 'still missing a pin');

  const p = worksSetPin(st, h.id, 10, 40);
  assert.equal(p.ok, true);
  assert.equal(h.status, HOLE_STATUS.CONSTRUCTION, 'newly completed hole must be built before opening');
  assert.equal(h.daysLeft, BALANCE.newHoleConstructionDays.realistic);

  // open it, then move the pin — that's a renovation
  h.status = HOLE_STATUS.OPEN;
  h.daysLeft = 0;
  h.everOpen = true;
  const p2 = worksSetPin(st, h.id, 11, 41);
  assert.equal(p2.ok, true);
  assert.equal(h.status, HOLE_STATUS.RENOVATION);
  assert.equal(h.daysLeft, BALANCE.renovation.realistic.teePinMoveDays);
});

test('tickRenovationsDaily counts down and reopens only valid holes', () => {
  const st = makeState();
  const c = st.course;
  for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) setZone(c, x, y, ZONE.TEE);
  for (let y = 38; y <= 42; y++) for (let x = 8; x <= 12; x++) setZone(c, x, y, ZONE.GREEN);
  const h = addHole(c);
  h.tee = { x: 10, y: 10 };
  h.pin = { x: 10, y: 40 };
  h.status = HOLE_STATUS.RENOVATION;
  h.daysLeft = 2;

  tickRenovationsDaily(st);
  assert.equal(h.status, HOLE_STATUS.RENOVATION);
  assert.equal(h.daysLeft, 1);
  tickRenovationsDaily(st);
  assert.equal(h.status, HOLE_STATUS.OPEN);
  assert.equal(h.everOpen, true);

  // a hole whose green was destroyed cannot reopen — it falls back to unbuilt
  const h2 = addHole(c);
  h2.tee = { x: 10, y: 10 };
  h2.pin = { x: 50, y: 50 }; // nothing there
  h2.status = HOLE_STATUS.RENOVATION;
  h2.daysLeft = 1;
  tickRenovationsDaily(st);
  assert.equal(h2.status, HOLE_STATUS.UNBUILT);
});
