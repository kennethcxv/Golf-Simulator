import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE } from '../src/sim/constants.js';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { ROLE } from '../src/sim/staff.js';
import {
  createWorkOrder, assignWorkOrder, canAutomateOrder, recordManualWork,
  tickMaintenanceOrders,
} from '../src/sim/maintenanceOrders.js';

function sectionOf(state, zone, minSize = 1) {
  return state.sections.find((section) => section.zone === zone && section.size >= minSize);
}

test('planning a maintenance order is inert and free until it is assigned', () => {
  const state = newGame('realistic', 4101);
  const fairway = sectionOf(state, ZONE.FAIRWAY, 20);
  const cash = state.cash;
  const height = fairway.cells.map((i) => state.turf.heightMm[i]);
  const result = createWorkOrder(state, 'mow', fairway);
  assert.equal(result.ok, true);
  assert.equal(result.order.status, 'open');
  assert.equal(result.order.assignment, 'player');
  assert.equal(state.cash, cash, 'planning reserves no money');
  assert.deepEqual(fairway.cells.map((i) => state.turf.heightMm[i]), height, 'planning changes no turf');
});

test('staff assignment costs money, consumes game time, then applies the result once', () => {
  const state = newGame('realistic', 4102);
  state.staff.employees.push({
    id: 901, name: 'Morgan Test', role: ROLE.GROUNDSKEEPER, skill: 3, wage: 120, trainingDays: 0,
  });
  const fairway = sectionOf(state, ZONE.FAIRWAY, 20);
  for (const i of fairway.cells) state.turf.heightMm[i] = 40;
  const { order } = createWorkOrder(state, 'mow', fairway);
  const cash = state.cash;
  const assigned = assignWorkOrder(state, order.id, 'staff');
  assert.equal(assigned.ok, true);
  assert.ok(state.cash < cash, 'paid labor is reserved at assignment');

  tickMaintenanceOrders(state, order.durationMinutes * 0.25);
  assert.equal(order.status, 'in_progress');
  assert.equal(state.turf.heightMm[fairway.cells[0]], 40, 'partial progress grants no instant turf result');
  tickMaintenanceOrders(state, order.durationMinutes * 2);
  assert.equal(order.status, 'complete');
  assert.ok(state.turf.heightMm[fairway.cells[0]] < 40);
  const after = state.turf.heightMm[fairway.cells[0]];
  tickMaintenanceOrders(state, order.durationMinutes * 2);
  assert.equal(state.turf.heightMm[fairway.cells[0]], after, 'completed orders never apply twice');
});

test('automation is progression-gated and sprinkler work reaches covered cells only', () => {
  const state = newGame('realistic', 4103);
  const green = sectionOf(state, ZONE.FAIRWAY, 20);
  for (const i of green.cells) state.turf.moisture[i] = 20;
  const { order } = createWorkOrder(state, 'water', green);
  assert.equal(canAutomateOrder(state, order), false);
  assert.equal(assignWorkOrder(state, order.id, 'automation').ok, false);

  state.progression.unlocks.smartIrrigation = 0;
  const covered = green.cells[0];
  state.course.irrigationHeads.push({ x: covered % state.course.w, y: Math.floor(covered / state.course.w) });
  assert.equal(assignWorkOrder(state, order.id, 'automation').ok, true);
  tickMaintenanceOrders(state, order.durationMinutes * 2);
  assert.equal(order.status, 'complete');
  assert.ok(order.result.changed > 0);
  assert.ok(order.result.missed > 0, 'one head does not claim whole-course coverage');
  assert.ok(state.turf.moisture[covered] > 20, 'covered turf was watered');
  const distant = green.cells.find((i) => {
    const x = i % state.course.w;
    const y = Math.floor(i / state.course.w);
    return Math.hypot(x - state.course.irrigationHeads[0].x, y - state.course.irrigationHeads[0].y) > 5;
  });
  if (distant !== undefined) assert.equal(state.turf.moisture[distant], 20, 'uncovered turf was not watered');
});

test('manual tracking records only physically touched cells and never grants the rest', () => {
  const state = newGame('realistic', 4104);
  const tee = sectionOf(state, ZONE.TEE);
  const { order } = createWorkOrder(state, 'repairDivots', tee);
  const before = Array.from(state.turf.divots);
  const touched = tee.cells[0];
  assert.equal(recordManualWork(state, 'repairDivots', touched).ok, true);
  assert.equal(order.manualCells.length, 1);
  assert.equal(order.status, 'open');
  assert.deepEqual(Array.from(state.turf.divots), before, 'tracker does not impersonate the physical tool');
  assert.equal(recordManualWork(state, 'repairDivots', touched).ok, false, 'same cell cannot farm progress');
});

test('mid-order save/load resumes exact progress without acceleration', () => {
  const state = newGame('realistic', 4105);
  state.staff.employees.push({
    id: 902, name: 'Casey Test', role: ROLE.GROUNDSKEEPER, skill: 2, wage: 110, trainingDays: 0,
  });
  const rough = sectionOf(state, ZONE.ROUGH, 20);
  const { order } = createWorkOrder(state, 'mow', rough);
  assignWorkOrder(state, order.id, 'staff');
  tickMaintenanceOrders(state, 30);
  const loaded = deserialize(serialize(state));
  const resumed = loaded.maintenance.orders.find((entry) => entry.id === order.id);
  assert.equal(resumed.status, order.status);
  assert.equal(resumed.progressMinutes, order.progressMinutes);
  tickMaintenanceOrders(state, 30);
  tickMaintenanceOrders(loaded, 30);
  assert.equal(resumed.progressMinutes, order.progressMinutes);
  assert.equal(resumed.status, order.status);
});
