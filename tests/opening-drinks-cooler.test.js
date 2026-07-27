import test from 'node:test';
import assert from 'node:assert/strict';

import { capacityOf } from '../src/data/fixtureSlots.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';
import {
  OPENING_DRINKS_COOLER_ASSET_PATH,
  OPENING_DRINKS_COOLER_CAPACITY,
  OPENING_DRINKS_COOLER_COLLIDERS,
  OPENING_DRINKS_COOLER_CONTRACT,
  OPENING_DRINKS_COOLER_DOOR,
  OPENING_DRINKS_COOLER_ROOT_NODE,
  OPENING_DRINKS_COOLER_SKU_IDS,
  OPENING_DRINKS_COOLER_SOCKETS,
  closeOpeningDrinksCoolerDoor,
  ensureOpeningDrinksCoolerState,
  openOpeningDrinksCoolerDoor,
  openingDrinksCoolerDoorAction,
  openingDrinksCoolerSnapshot,
  toggleOpeningDrinksCoolerDoor,
} from '../src/sim/openingDrinksCooler.js';

const smallState = () => ({
  shop: {
    reno: {},
    inventory: {
      water1: { shelf: 0, back: 0 },
      sportdrink2: { shelf: 0, back: 0 },
      soda1: { shelf: 0, back: 0 },
    },
    inventoryLifecycle: {
      version: 1,
      lots: [{ id: 'lot-sentinel', skuId: 'water1', quantity: 5 }],
    },
  },
});

test('opening cooler contract maps all 24 authored sockets to the existing 8/8/8 fixture capacity', () => {
  assert.equal(OPENING_DRINKS_COOLER_CONTRACT.fixtureId, 'cold_drinks');
  assert.equal(OPENING_DRINKS_COOLER_ASSET_PATH, 'vendor/models/clubhouse/pine_hills_opening_drinks_cooler_v1.glb');
  assert.equal(OPENING_DRINKS_COOLER_ROOT_NODE, 'A_PINE_HILLS_OPENING_DRINKS_COOLER_V1_ROOT');
  assert.equal(OPENING_DRINKS_COOLER_SOCKETS.length, 24);
  assert.deepEqual(
    OPENING_DRINKS_COOLER_SOCKETS.map(({ name }) => name),
    Array.from({ length: 24 }, (_, index) => `SOCKET_Bottle_${String(index + 1).padStart(2, '0')}`),
  );
  assert.deepEqual(OPENING_DRINKS_COOLER_CAPACITY, {
    total: 24,
    bySku: { water1: 8, sportdrink2: 8, soda1: 8 },
  });
  for (const skuId of OPENING_DRINKS_COOLER_SKU_IDS) {
    assert.equal(capacityOf(skuId), OPENING_DRINKS_COOLER_CAPACITY.bySku[skuId], skuId);
    assert.equal(OPENING_DRINKS_COOLER_SOCKETS.filter((socket) => socket.skuId === skuId).length, 8);
  }
  assert.equal(Object.isFrozen(OPENING_DRINKS_COOLER_CONTRACT), true);
  assert.equal(Object.isFrozen(OPENING_DRINKS_COOLER_SOCKETS[0]), true);
  assert.deepEqual(OPENING_DRINKS_COOLER_SOCKETS[0].gltfPositionMeters, {
    x: -0.30, y: 0.36, z: 0.075,
  });
});

test('opening cooler exposes the authored door articulation and both collider contracts', () => {
  assert.deepEqual(OPENING_DRINKS_COOLER_DOOR, {
    node: 'COOLER_Door',
    pivotNode: 'PIVOT_COOLER_Door',
    hingeAxis: '+Z',
    hingePositionMeters: [-0.420, -0.280, 0],
    gltfHingeAxis: '+Y',
    gltfHingePositionMeters: [-0.420, 0, 0.280],
    closedAngleDegrees: 0,
    openAngleDegrees: -108,
    clips: { open: 'COOLER_Door_Open', close: 'COOLER_Door_Close' },
  });
  assert.deepEqual(OPENING_DRINKS_COOLER_COLLIDERS.map(({ node }) => node), [
    'COL_COOLER_Carcass',
    'COL_COOLER_Door',
  ]);
  assert.deepEqual(OPENING_DRINKS_COOLER_COLLIDERS[0].dimensionsMeters, [0.90, 0.62, 1.90]);
  assert.deepEqual(OPENING_DRINKS_COOLER_COLLIDERS[1].dimensionsMeters, [0.84, 0.035, 1.58]);
  assert.deepEqual(OPENING_DRINKS_COOLER_COLLIDERS[0].gltfDimensionsMeters, [0.90, 1.90, 0.62]);
  assert.deepEqual(OPENING_DRINKS_COOLER_COLLIDERS[1].gltfCenterMetersFromParent, [0.420, 0.910, 0.0175]);
  assert.equal(OPENING_DRINKS_COOLER_COLLIDERS[0].followsDoor, false);
  assert.equal(OPENING_DRINKS_COOLER_COLLIDERS[1].followsDoor, true);
  assert.equal(OPENING_DRINKS_COOLER_COLLIDERS[1].parentNode, 'COOLER_Door');
});

test('door state normalizes once and open/close actions are idempotent while toggle is deterministic', () => {
  const state = smallState();
  const first = ensureOpeningDrinksCoolerState(state);
  assert.deepEqual(first, { version: 1, doorState: 'closed' });
  assert.equal(ensureOpeningDrinksCoolerState(state), first);

  assert.deepEqual(openOpeningDrinksCoolerDoor(state), {
    ok: true,
    changed: true,
    fixtureId: 'cold_drinks',
    action: 'open',
    previousDoorState: 'closed',
    doorState: 'open',
  });
  assert.equal(openOpeningDrinksCoolerDoor(state).changed, false);
  assert.equal(toggleOpeningDrinksCoolerDoor(state).doorState, 'closed');
  assert.equal(toggleOpeningDrinksCoolerDoor(state).doorState, 'open');
  assert.equal(closeOpeningDrinksCoolerDoor(state).changed, true);
  assert.equal(closeOpeningDrinksCoolerDoor(state).changed, false);

  const before = JSON.stringify(state.shop.reno.openingDrinksCooler);
  const invalid = openingDrinksCoolerDoorAction(state, 'jam');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.changed, false);
  assert.equal(JSON.stringify(state.shop.reno.openingDrinksCooler), before);
});

test('snapshot reads authoritative shelf stock, clamps visuals, and never mints or moves inventory', () => {
  const state = smallState();
  state.shop.inventory.water1 = { shelf: 3, back: 7 };
  state.shop.inventory.sportdrink2 = { shelf: 99, back: 4 };
  state.shop.inventory.soda1 = { shelf: -2, back: 6 };
  const inventoryBefore = structuredClone(state.shop.inventory);
  const lifecycleBefore = structuredClone(state.shop.inventoryLifecycle);

  const snapshot = openingDrinksCoolerSnapshot(state);
  assert.equal(snapshot.capacity.total, 24);
  assert.equal(snapshot.visibleTotal, 11);
  assert.deepEqual(snapshot.stock.water1, {
    skuId: 'water1', shelf: 3, back: 7, visible: 3,
    capacity: 8, stockingCapacity: 8, capacityAligned: true,
  });
  assert.equal(snapshot.stock.sportdrink2.shelf, 99);
  assert.equal(snapshot.stock.sportdrink2.visible, 8);
  assert.equal(snapshot.stock.soda1.shelf, 0);
  assert.equal(snapshot.stock.soda1.visible, 0);
  assert.equal(snapshot.sockets.filter(({ occupied }) => occupied).length, 11);
  assert.deepEqual(
    snapshot.sockets.filter((socket) => socket.skuId === 'water1' && socket.occupied).map(({ name }) => name),
    ['SOCKET_Bottle_01', 'SOCKET_Bottle_02', 'SOCKET_Bottle_07'],
  );
  assert.deepEqual(state.shop.inventory, inventoryBefore);
  assert.deepEqual(state.shop.inventoryLifecycle, lifecycleBefore);
});

test('door state survives the existing shop renovation save/load envelope without schema changes', () => {
  const state = newGame('relaxed', 90210);
  state.shop.inventory.water1.shelf = 3;
  state.shop.inventory.sportdrink2.shelf = 2;
  state.shop.inventory.soda1.shelf = 1;
  assert.equal(openOpeningDrinksCoolerDoor(state).changed, true);

  const loaded = deserialize(serialize(state));
  const snapshot = openingDrinksCoolerSnapshot(loaded);
  assert.equal(snapshot.door.state, 'open');
  assert.equal(snapshot.door.targetClip, 'COOLER_Door_Open');
  assert.deepEqual(
    OPENING_DRINKS_COOLER_SKU_IDS.map((skuId) => (
      loaded.shop.inventory[skuId].shelf + loaded.shop.inventory[skuId].back
    )),
    [3, 2, 1],
  );
});
