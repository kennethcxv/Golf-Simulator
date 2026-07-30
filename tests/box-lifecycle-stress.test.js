// Delivery-carton lifecycle soak.
//
// The renderer owns animation and input listeners; the simulation owns every durable fact below.
// Running one carton at a time makes retained-state leaks obvious: there may be one live box and
// one live shipment during a cycle, then neither after recycling. The only intentionally growing
// structures are the conserved inventory, lifetime counters, arrived-order ids, and the bounded
// notification feed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  BOX_LIFECYCLE,
  arriveOrder,
  boxesOf,
  shipmentsOf,
  boxLifecycleState,
  cutTape,
  openFlap,
  takeFromBox,
  flattenBox,
  pickUpBox,
  recycleBox,
  recycleCarriedBox,
} from '../src/sim/deliveries.js';
import { storeInBack } from '../src/sim/stocking.js';
import { NOTIF_CAP } from '../src/sim/notifications.js';

const BOX_COUNT = 20;
const SKU_ID = 'polo1';
const ORDER_ID_BASE = 72_000;
const SAVE_GROWTH_BUDGET = 32 * 1024;

function clearStartingStock(state) {
  for (const inventory of Object.values(state.shop.inventory)) {
    inventory.shelf = 0;
    inventory.back = 0;
  }
}

function inventoryUnits(state) {
  return Object.values(state.shop.inventory).reduce(
    (sum, inventory) => sum + inventory.shelf + inventory.back,
    0,
  );
}

function conservedUnits(state) {
  const boxed = boxesOf(state).reduce((sum, box) => sum + box.qty, 0);
  const carried = state.shop.carry?.qty || 0;
  return inventoryUnits(state) + boxed + carried;
}

function persistentLifecycleState(state) {
  return JSON.parse(JSON.stringify({
    deliveries: state.shop.deliveries,
    inventory: state.shop.inventory,
    carry: state.shop.carry,
    notifications: state.notifications,
  }));
}

function checkpoint(state, label, sizeSamples) {
  const before = persistentLifecycleState(state);
  const json = serialize(state);
  sizeSamples.push(json.length);
  const loaded = deserialize(json);
  assert.deepEqual(
    persistentLifecycleState(loaded),
    before,
    `${label}: delivery, inventory, carry, and event-feed state survive save/load exactly`,
  );
  return loaded;
}

function currentBox(state, id) {
  const box = boxesOf(state).find((candidate) => candidate.id === id);
  assert.ok(box, `box ${id} remains the same physical carton`);
  return box;
}

function assertRetainedState(state, {
  arrivals,
  completed,
  liveBoxes,
  liveShipments = liveBoxes,
  carryQty = 0,
  trash = 0,
}) {
  const deliveries = state.shop.deliveries;
  const boxes = boxesOf(state);
  const notifications = state.notifications.items;

  assert.equal(boxes.length, liveBoxes, 'processed cartons do not accumulate in the save');
  assert.equal(new Set(boxes.map((box) => box.id)).size, boxes.length, 'live box ids stay unique');
  assert.equal(shipmentsOf(state).length, liveShipments, 'retired shipments do not accumulate');
  assert.equal(deliveries.trash, trash, 'only flattened cardboard waiting for the bin is retained');
  assert.equal(deliveries.recycled, completed, 'each carton is recycled exactly once');
  const emptiedLiveBoxes = boxes.filter((box) => box.qty <= 0).length;
  assert.equal(deliveries.openedTotal || 0, completed + emptiedLiveBoxes,
    'empty-box lifetime count advances only when the last product is removed');
  assert.equal(deliveries.arrivedOrderIds.length, arrivals, 'one arrival id is retained per order');
  assert.equal(new Set(deliveries.arrivedOrderIds).size, arrivals, 'arrival ids never duplicate');
  assert.equal(deliveries.nextBoxId, arrivals + 1, 'box identity advances once per physical carton');
  assert.equal(state.shop.carry?.qty || 0, carryQty, 'carry state is bounded by one ordered unit');
  assert.equal(conservedUnits(state), arrivals, 'every ordered unit exists in exactly one place');

  assert.equal(notifications.length, arrivals,
    'lifecycle actions add no listener-like retained events beyond one arrival fact');
  assert.ok(notifications.length <= NOTIF_CAP, 'the persistent event feed remains bounded');
  assert.equal(new Set(notifications.map((item) => item.id)).size, notifications.length,
    'retained event ids stay unique');
  assert.equal(new Set(notifications.map((item) => item.dedupeKey)).size, notifications.length,
    'retained arrival events stay deduplicated');

  const transientControllerKeys = Object.keys(deliveries)
    .filter((key) => /listeners?|subscribers?|callbacks?|handlers?|timers?|queue/i.test(key));
  assert.deepEqual(transientControllerKeys, [],
    'animation/listener/controller residue never enters durable delivery state');
}

test('20 cartons survive progressive unboxing, save/reload, flattening, and recycling without growth or duplication', {
  timeout: 15_000,
}, (t) => {
  let state = newGame('relaxed', 20_720);
  clearStartingStock(state);

  const baselineSaveBytes = serialize(state).length;
  const sizeSamples = [baselineSaveBytes];
  const listenerEvents = ['warning', 'unhandledRejection', 'uncaughtException'];
  const listenerBaseline = listenerEvents.map((event) => process.listenerCount(event));

  for (let index = 0; index < BOX_COUNT; index += 1) {
    const arrivals = index + 1;
    const order = { id: ORDER_ID_BASE + index, skuId: SKU_ID, qty: 1 };
    const made = arriveOrder(state, order);
    assert.equal(made.length, 1, `cycle ${arrivals}: one order produces one carton`);
    let box = made[0];
    const boxId = box.id;

    assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.SEALED);
    assert.equal(box.qty, 1);
    assert.equal(box.initialQty, 1);

    const duplicateArrival = arriveOrder(state, order);
    assert.deepEqual(duplicateArrival.map((candidate) => candidate.id), [boxId],
      `cycle ${arrivals}: replaying arrival resolves the existing carton`);
    assertRetainedState(state, { arrivals, completed: index, liveBoxes: 1 });

    assert.equal(cutTape(state, boxId, 0.22).ok, true);
    assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.CUTTING);
    assert.equal(box.cutProgress, 0.22);
    state = checkpoint(state, `cycle ${arrivals} partial cut`, sizeSamples);
    box = currentBox(state, boxId);

    assert.equal(cutTape(state, boxId, 0.38).ok, true);
    assert.equal(cutTape(state, boxId, 0.20).ok, true);
    assert.equal(cutTape(state, boxId, 0.20).done, true);
    assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.CUT_COMPLETE);
    assert.equal(box.cutProgress, 1);
    state = checkpoint(state, `cycle ${arrivals} cut complete`, sizeSamples);
    box = currentBox(state, boxId);

    // Two phases since 2026-07-29, and the WIDE facing pair first since the third pass
    // that day: LEFT+RIGHT, then FRONT+BACK. Half the lid moves per press. Partial
    // amounts still persist mid-arc, which is what this stress run is really pinning.
    assert.equal(openFlap(state, boxId, 0.5).ok, true);
    assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.OPENING);
    assert.deepEqual(box.flapProgress, [0, 0, 0.5, 0.5]);
    state = checkpoint(state, `cycle ${arrivals} opening the first half`, sizeSamples);
    box = currentBox(state, boxId);

    assert.equal(openFlap(state, boxId, 0.5).ok, true);
    assert.equal(openFlap(state, boxId, 0.5).ok, true);
    assert.deepEqual(box.flapProgress, [0.5, 0.5, 1, 1]);
    state = checkpoint(state, `cycle ${arrivals} opening the second half`, sizeSamples);
    box = currentBox(state, boxId);

    assert.equal(openFlap(state, boxId, 0.5).done, true);
    assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.OPEN);
    assert.deepEqual(box.flapProgress, [1, 1, 1, 1]);

    const removal = takeFromBox(state, boxId, 1);
    assert.deepEqual(
      { ok: removal.ok, taken: removal.taken, left: removal.left, carrying: removal.carrying },
      { ok: true, taken: 1, left: 0, carrying: 1 },
    );
    assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.EMPTY);
    const beforeDuplicateTake = persistentLifecycleState(state);
    assert.equal(takeFromBox(state, boxId, 1).ok, false, 'an empty carton cannot mint a second unit');
    assert.deepEqual(persistentLifecycleState(state), beforeDuplicateTake,
      'duplicate product removal is a no-op');
    assertRetainedState(state, {
      arrivals,
      completed: index,
      liveBoxes: 1,
      carryQty: 1,
    });
    state = checkpoint(state, `cycle ${arrivals} product in hands`, sizeSamples);
    box = currentBox(state, boxId);

    const stored = storeInBack(state, 1);
    assert.deepEqual({ ok: stored.ok, moved: stored.moved, left: stored.left },
      { ok: true, moved: 1, left: 0 });
    assert.equal(state.shop.inventory[SKU_ID].back, arrivals);
    assert.equal(state.shop.carry, null);

    assert.equal(flattenBox(state, boxId, 0.35).done, false);
    assert.equal(boxLifecycleState(box), BOX_LIFECYCLE.FLATTENING);
    assert.equal(box.flattenProgress, 0.35);
    const beforeEarlyRecycle = persistentLifecycleState(state);
    assert.equal(recycleBox(state, boxId).ok, false, 'partly folded cardboard cannot be recycled');
    assert.deepEqual(persistentLifecycleState(state), beforeEarlyRecycle,
      'an early recycle attempt changes no persistent state');
    state = checkpoint(state, `cycle ${arrivals} partial flatten`, sizeSamples);
    box = currentBox(state, boxId);

    assert.equal(flattenBox(state, boxId, 0.65).done, true);
    assert.equal(box.flat, true);
    assert.equal(box.flattenProgress, 1);
    assertRetainedState(state, {
      arrivals,
      completed: index,
      liveBoxes: 1,
      trash: 1,
    });
    assert.equal(pickUpBox(state, boxId).ok, true, 'the flat carton can be carried to the bin');
    state = checkpoint(state, `cycle ${arrivals} flat carton carried`, sizeSamples);
    box = currentBox(state, boxId);
    assert.equal(box.loc, 'carried');

    const recycled = recycleCarriedBox(state, boxId);
    assert.equal(recycled.ok, true);
    assert.equal(recycled.state, BOX_LIFECYCLE.DISCARDED);
    assert.equal(recycled.box.lifecycle, BOX_LIFECYCLE.DISCARDED);
    const afterRecycle = persistentLifecycleState(state);
    assert.equal(recycleCarriedBox(state, boxId).ok, false, 'the carried-box sink is idempotent');
    assert.equal(recycleBox(state, boxId).ok, false, 'the generic sink cannot discard it twice');
    assert.deepEqual(persistentLifecycleState(state), afterRecycle,
      'duplicate recycle attempts change no counters or inventory');
    assertRetainedState(state, {
      arrivals,
      completed: arrivals,
      liveBoxes: 0,
      liveShipments: 0,
    });
    state = checkpoint(state, `cycle ${arrivals} recycled`, sizeSamples);
  }

  assert.equal(state.shop.inventory[SKU_ID].back, BOX_COUNT);
  assert.equal(inventoryUnits(state), BOX_COUNT);
  assert.equal(boxesOf(state).length, 0);
  assert.equal(shipmentsOf(state).length, 0);
  assert.equal(state.shop.carry, null);
  assert.equal(state.shop.deliveries.trash, 0);
  assert.equal(state.shop.deliveries.recycled, BOX_COUNT);
  assert.equal(state.shop.deliveries.openedTotal, BOX_COUNT);
  assert.deepEqual(
    listenerEvents.map((event) => process.listenerCount(event)),
    listenerBaseline,
    'the headless lifecycle installs no process-level listeners across repeated use',
  );

  const maximumSaveGrowth = Math.max(...sizeSamples) - baselineSaveBytes;
  assert.ok(maximumSaveGrowth < SAVE_GROWTH_BUDGET,
    `save growth stays below ${SAVE_GROWTH_BUDGET} bytes (observed ${maximumSaveGrowth})`);
  t.diagnostic(`maximum serialized-state growth: ${maximumSaveGrowth} bytes across ${sizeSamples.length - 1} reload checkpoints`);
});
