import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { PLACEABLES } from '../../src/data/placeableCatalog.js';
import {
  commitObjectPlacement,
  ensureLayout,
  routesIntact,
  storeObject,
} from '../../src/sim/layout.js';
import {
  ensureInventoryLifecycle,
  reconcileInventory,
  submitPurchaseOrders,
} from '../../src/sim/inventoryLifecycle.js';
import {
  arriveOrder,
  boxesOf,
  cutTape,
  flapsOpen,
  openFlap,
  pickUpBox,
  putDownBox,
  takeFromBox,
} from '../../src/sim/deliveries.js';
import { storeInBack } from '../../src/sim/stocking.js';
import {
  CUSTOMER_INTENT,
  CUSTOMER_STATE,
  MAX_CUSTOMER_HISTORY,
  completeReservationCustomerParty,
  createFixtureCustomer,
  customerSimulationOf,
  despawnCustomer,
  transitionCustomer,
} from '../../src/sim/customerSimulation.js';
import {
  beginReservationPayment,
  bookSlot,
  checkInReservation,
  completeReservationPayment,
  confirmReservation,
  markReservationArrived,
  slotTimes,
} from '../../src/sim/reservations.js';
import {
  SURFACE,
  mowCourseMaintenancePath,
  worldPointForMaintenanceCell,
} from '../../src/sim/courseMaintenance.js';
import { deserialize, newGame, serialize } from '../../src/sim/state.js';

const root = process.cwd();
const output = path.resolve(root, process.env.QA_SOAK_REPORT
  || 'qa/integration-seven/integration-logical-soak.json');
const startedAt = performance.now();
const phaseTimes = {};
const memorySamples = [];

function resources() {
  const counts = {};
  for (const name of process.getActiveResourcesInfo?.() || []) counts[name] = (counts[name] || 0) + 1;
  return counts;
}

function sample(label, state) {
  global.gc?.();
  const memory = process.memoryUsage();
  const sim = state ? customerSimulationOf(state) : null;
  const value = {
    label,
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal,
    rss: memory.rss,
    activeResources: resources(),
    layoutObjects: state ? Object.keys(ensureLayout(state).objects).length : null,
    layoutUndo: state ? ensureLayout(state).history.undo.length : null,
    boxes: state ? boxesOf(state).length : null,
    activeCustomers: sim?.active.length ?? null,
    customerHistory: sim?.history.length ?? null,
    customerTransitions: sim?.transitionEvents.length ?? null,
    reservations: state?.reservations?.booked?.length ?? null,
    reservationFinanceEntries: state?.reservations?.financeEntries?.length ?? null,
    ledgerEntries: state?.ledger?.entries?.length ?? null,
    maintenanceHistory: state?.courseMaintenance?.history?.length ?? null,
  };
  memorySamples.push(value);
  return value;
}

async function phase(name, action) {
  const start = performance.now();
  const value = await action();
  phaseTimes[name] = Math.round((performance.now() - start) * 100) / 100;
  return value;
}

let state = newGame('relaxed', 20260719);
state.cash = 10_000_000;
state.shop.unlockedTier = 3;
state.__qaMode = true;
ensureInventoryLifecycle(state);
sample('initial', state);

const placement = await phase('placements', () => {
  for (const meta of PLACEABLES) {
    if (!meta.requiredObject && !meta.fixture) storeObject(state, meta.id, { history: false });
  }
  ensureLayout(state).history.undo.length = 0;
  ensureLayout(state).history.redo.length = 0;
  for (let index = 0; index < 100; index += 1) {
    const candidate = {
      x: index % 2 ? -4.5 : -4,
      y: 0,
      z: 2,
      ry: index % 4 < 2 ? 0 : Math.PI / 2,
      surface: 'floor',
      attachment: null,
      room: 'sales',
    };
    const result = commitObjectPlacement(state, 'asset-099', candidate, {
      grid: false,
      rotationSnap: false,
    });
    assert.equal(result.ok, true, `placement ${index}: ${result.reason}`);
    assert.deepEqual(result.object.transform, result.candidate);
  }
  assert.equal(routesIntact(state), true);
  assert.ok(ensureLayout(state).history.undo.length <= 40);
  return {
    completed: 100,
    revision: ensureLayout(state).revision,
    undoEntries: ensureLayout(state).history.undo.length,
    routesIntact: true,
  };
});
sample('after-placements', state);

const boxes = await phase('boxes', () => {
  const purchase = submitPurchaseOrders(state, {
    lines: [{ skuId: 'balls2', quantity: 24 }],
    idempotencyKey: 'integration-soak-box-order',
  });
  assert.equal(purchase.ok, true, purchase.reason);
  const delivered = arriveOrder(state, purchase.orders[0]);
  assert.ok(delivered.length > 0);
  const box = delivered[0];
  for (let index = 0; index < 50; index += 1) {
    assert.equal(pickUpBox(state, box.id).ok, true, `box pickup ${index}`);
    assert.equal(putDownBox(state, box.id, 'stock').ok, true, `box putdown ${index}`);
  }
  assert.equal(cutTape(state, box.id, 0.45).ok, true);
  assert.equal(cutTape(state, box.id, 1).ok, true);
  let openingInteractions = 2;
  while (!flapsOpen(box) && openingInteractions < 8) {
    assert.equal(openFlap(state, box.id).ok, true);
    openingInteractions += 1;
  }
  assert.equal(flapsOpen(box), true, 'every authored box flap must be open before unloading');
  let removed = 0;
  while (box.qty > 0) {
    const taken = takeFromBox(state, box.id);
    assert.equal(taken.ok, true, taken.reason);
    removed += taken.taken;
    assert.equal(storeInBack(state).ok, true);
  }
  const invariant = reconcileInventory(state, { qa: true, context: 'integration soak boxes' });
  assert.equal(invariant.ok, true, JSON.stringify(invariant.discrepancies));
  return {
    carryInteractions: 100,
    openingInteractions,
    deliveredBoxes: delivered.length,
    unitsRemovedFromFirstBox: removed,
    inventoryReconciled: true,
  };
});
sample('after-boxes', state);

const customers = await phase('customers', () => {
  for (let index = 0; index < 100; index += 1) {
    const customer = createFixtureCustomer(
      state,
      index % 2 ? CUSTOMER_INTENT.BROWSER : CUSTOMER_INTENT.LOUNGE_VISITOR,
      { name: `Integration soak ${index}` },
    );
    assert.ok(customer, `customer ${index} exceeded the active cap`);
    assert.equal(transitionCustomer(
      state,
      customer,
      CUSTOMER_STATE.LEAVING,
      'integration accelerated lifecycle',
      state.clock.minutes,
      { force: true },
    ).ok, true);
    assert.equal(despawnCustomer(state, customer, { reason: 'integration lifecycle complete' }).ok, true);
  }
  const sim = customerSimulationOf(state);
  assert.equal(sim.active.length, 0);
  assert.equal(sim.serviceQueue.length, 0);
  assert.ok(sim.history.length <= MAX_CUSTOMER_HISTORY);
  assert.ok(sim.transitionEvents.length <= 300);
  return {
    completed: 100,
    active: sim.active.length,
    queue: sim.serviceQueue.length,
    history: sim.history.length,
    transitionEvents: sim.transitionEvents.length,
  };
});
sample('after-customers', state);

const checkIns = await phase('check-ins', () => {
  const today = Math.floor(state.clock.minutes / 1440);
  const times = slotTimes(state);
  const reservations = [];
  for (let index = 0; index < 100; index += 1) {
    const dayAbs = today + 1 + Math.floor(index / times.length);
    const minute = times[index % times.length];
    const booked = bookSlot(state, dayAbs, minute, {
      holder: `Integration golfer ${index}`,
      partySize: 1,
      arrivalOffsetMin: 0,
    });
    assert.equal(booked.ok, true, `booking ${index}: ${booked.reason}`);
    reservations.push(booked.res);
  }
  const cashBefore = state.cash;
  let expectedRevenue = 0;
  for (const reservation of reservations) {
    const atMinute = reservation.dayAbs * 1440 + reservation.minute;
    state.clock.minutes = atMinute;
    assert.equal(markReservationArrived(state, reservation.id, atMinute).ok, true);
    assert.equal(confirmReservation(state, reservation.id, atMinute).ok, true);
    const started = beginReservationPayment(state, reservation.id, 'cash');
    assert.equal(started.ok, true, started.reason);
    const paid = completeReservationPayment(state, reservation.id, {
      transactionId: started.transactionId,
      tendered: started.amount,
    });
    assert.equal(paid.ok, true, paid.reason);
    expectedRevenue += paid.amount;
    assert.equal(checkInReservation(state, reservation.id, { atMinute }).ok, true);
    assert.equal(completeReservationCustomerParty(state, reservation.id, atMinute).ok, true);
  }
  const cashDelta = Math.round((state.cash - cashBefore) * 100) / 100;
  expectedRevenue = Math.round(expectedRevenue * 100) / 100;
  assert.equal(cashDelta, expectedRevenue);
  assert.equal(new Set(state.reservations.financeEntries.map((entry) => entry.id)).size, 100);
  assert.ok(reservations.every((reservation) => reservation.status === 'played'));
  return {
    completed: 100,
    expectedRevenue,
    cashDelta,
    financeEntries: state.reservations.financeEntries.length,
    uniqueFinanceEntries: 100,
    played: reservations.length,
  };
});
sample('after-check-ins', state);

const maintenance = await phase('maintenance-strokes', () => {
  const model = state.courseMaintenance;
  const fairways = model.runtime.activeIndices
    .filter((index) => model.surface[index] === SURFACE.FAIRWAY);
  assert.ok(fairways.length > 0);
  let changedCells = 0;
  for (let index = 0; index < 100; index += 1) {
    const cell = fairways[(index * 17) % fairways.length];
    const stroke = mowCourseMaintenancePath(state, {
      ...worldPointForMaintenanceCell(model, cell),
      radiusYd: 1.1,
      directionRad: (index % 8) * Math.PI / 4,
      speedYdPerSec: 8,
      mowerType: 'fairway-reel',
      bladesEngaged: true,
    });
    assert.equal(stroke.ok, true, `maintenance stroke ${index}: ${stroke.reason}`);
    changedCells += stroke.changed;
  }
  return {
    completed: 100,
    changedCells,
    historyEntries: model.history.length,
    fieldRevision: model.runtime.saveRevision,
  };
});
sample('after-maintenance', state);

const saves = await phase('save-load-cycles', () => {
  const raw = JSON.parse(serialize(state));
  raw.futureSoakProbe = { preserve: true, values: [1, 2, 3] };
  state = deserialize(raw);
  const sizes = [];
  const identity = {
    reservations: state.reservations.booked.map((entry) => entry.id),
    finance: state.reservations.financeEntries.map((entry) => entry.id),
    ledger: state.ledger.entries.map((entry) => entry.id),
    boxes: boxesOf(state).map((entry) => entry.persistentId),
  };
  for (let index = 0; index < 100; index += 1) {
    const json = serialize(state);
    sizes.push(Buffer.byteLength(json));
    state = deserialize(json);
    if (index % 10 === 9) sample(`save-cycle-${index + 1}`, state);
  }
  const finalRaw = JSON.parse(serialize(state));
  assert.deepEqual(finalRaw.futureSoakProbe, raw.futureSoakProbe);
  assert.deepEqual(state.reservations.booked.map((entry) => entry.id), identity.reservations);
  assert.deepEqual(state.reservations.financeEntries.map((entry) => entry.id), identity.finance);
  assert.deepEqual(state.ledger.entries.map((entry) => entry.id), identity.ledger);
  assert.deepEqual(boxesOf(state).map((entry) => entry.persistentId), identity.boxes);
  assert.equal(customerSimulationOf(state).active.length, 0);
  const finalInvariant = reconcileInventory(state, { qa: true, context: 'integration soak final' });
  assert.equal(finalInvariant.ok, true, JSON.stringify(finalInvariant.discrepancies));
  const finalWindow = sizes.slice(-20);
  return {
    completed: 100,
    firstBytes: sizes[0],
    finalBytes: sizes.at(-1),
    minBytes: Math.min(...sizes),
    maxBytes: Math.max(...sizes),
    finalTwentyByteRange: Math.max(...finalWindow) - Math.min(...finalWindow),
    identitiesStable: true,
    unknownDataPreserved: true,
  };
});
const finalSample = sample('final', state);

const initialSample = memorySamples[0];
const report = {
  generatedAt: new Date().toISOString(),
  durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  node: process.version,
  garbageCollectionExposed: typeof global.gc === 'function',
  operations: { placement, boxes, customers, checkIns, maintenance, saves },
  phaseTimesMs: phaseTimes,
  memorySamples,
  stabilization: {
    heapGrowthBytesAfterGc: finalSample.heapUsed - initialSample.heapUsed,
    activeResourceDelta: Object.fromEntries(
      [...new Set([...Object.keys(initialSample.activeResources), ...Object.keys(finalSample.activeResources)])]
        .map((key) => [key, (finalSample.activeResources[key] || 0) - (initialSample.activeResources[key] || 0)]),
    ),
    activeCustomers: finalSample.activeCustomers,
    customerHistoryBounded: finalSample.customerHistory <= MAX_CUSTOMER_HISTORY,
    customerTransitionsBounded: finalSample.customerTransitions <= 300,
    layoutHistoryBounded: finalSample.layoutUndo <= 40,
    saveSizeStable: saves.finalTwentyByteRange <= 4,
  },
};
report.passed = placement.completed === 100
  && boxes.carryInteractions === 100
  && customers.completed === 100
  && checkIns.completed === 100
  && maintenance.completed === 100
  && saves.completed === 100
  && report.stabilization.activeCustomers === 0
  && report.stabilization.customerHistoryBounded
  && report.stabilization.customerTransitionsBounded
  && report.stabilization.layoutHistoryBounded
  && report.stabilization.saveSizeStable
  && Object.values(report.stabilization.activeResourceDelta).every((delta) => delta === 0);

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
