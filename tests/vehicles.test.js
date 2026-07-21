import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  VEHICLE_SAVE_SCHEMA,
  VEHICLE_SPECS,
  ensureVehicles,
  mountVehicle,
  parkVehicle,
  setVehiclePose,
  storeVehicleCargo,
  takeVehicleCargo,
  toggleVehicleLights,
  vehicleById,
  vehiclesOf,
} from '../src/sim/vehicles.js';

test('a property starts with one stable tractor and one stable golf cart', () => {
  const state = newGame('relaxed', 512);
  assert.equal(state.vehicles.schema, VEHICLE_SAVE_SCHEMA);
  assert.deepEqual(vehiclesOf(state).map(({ id, type }) => ({ id, type })), [
    { id: 'tractor-1', type: 'tractor' },
    { id: 'golf-cart-1', type: 'golf_cart' },
  ]);
  assert.equal(new Set(vehiclesOf(state).map((vehicle) => vehicle.id)).size, 2);
});

test('broken tractor cannot mount while the golf cart can drive and park', () => {
  const state = newGame('relaxed', 513);
  assert.deepEqual(mountVehicle(state, 'tractor-1'), { ok: false, reason: 'tractor-broken' });
  assert.equal(mountVehicle(state, 'golf-cart-1').ok, true);
  assert.equal(state.vehicles.activeId, 'golf-cart-1');
  assert.equal(setVehiclePose(state, 'golf-cart-1', { x: 12, z: -8, yaw: 0.75 }, 18.5).ok, true);
  assert.equal(parkVehicle(state, 'golf-cart-1', { x: 13, z: -7, yaw: 0.9 }).ok, true);
  const cart = vehicleById(state, 'golf-cart-1');
  assert.equal(cart.engineOn, false);
  assert.equal(cart.parked, true);
  assert.equal(cart.odometerYd, 18.5);
  assert.equal(state.vehicles.activeId, null);
});

test('vehicle pose, lights, energy, condition, cargo, and odometer survive save/load', () => {
  const state = newGame('realistic', 514);
  const cart = vehicleById(state, 'golf-cart-1');
  cart.energy = 63.5;
  cart.condition = 82;
  toggleVehicleLights(state, cart.id);
  setVehiclePose(state, cart.id, { x: -21.25, z: 17.75, yaw: -1.2 }, 44);
  storeVehicleCargo(state, cart.id, { id: 'bag:member-4', kind: 'golf-bag', quantity: 1 });
  storeVehicleCargo(state, cart.id, { id: 'cooler:1', kind: 'refreshments', quantity: 3 });
  mountVehicle(state, cart.id);

  const loaded = deserialize(serialize(state));
  const after = vehicleById(loaded, cart.id);
  assert.equal(loaded.vehicles.activeId, null, 'loading never resumes hidden active driving input');
  assert.equal(after.engineOn, false);
  assert.equal(after.parked, true);
  assert.deepEqual({ x: after.x, z: after.z, yaw: after.yaw }, { x: -21.25, z: 17.75, yaw: -1.2 });
  assert.equal(after.lightsOn, true);
  assert.equal(after.condition, 82 - 44 / 5000);
  assert.equal(after.cleanliness, 100 - 44 / 900);
  assert.equal(after.energy, 63.5 - 44 / 320);
  assert.equal(after.odometerYd, 44);
  assert.deepEqual(after.cargo, [
    { id: 'bag:member-4', kind: 'golf-bag', quantity: 1 },
    { id: 'cooler:1', kind: 'refreshments', quantity: 3 },
  ]);
});

test('migration heals duplicate records once without losing the first saved pose', () => {
  const state = newGame('relaxed', 515);
  state.vehicles = {
    schema: 0,
    activeId: 'tractor-1',
    records: [
      { id: 'tractor-1', type: 'tractor', x: 4, z: 5, yaw: 0.4, condition: 61 },
      { id: 'tractor-1', type: 'tractor', x: 99, z: 99, yaw: 2.2, condition: 1 },
      { id: 'golf-cart-1', type: 'golf_cart', x: -2, z: -3, yaw: -0.2 },
    ],
  };
  ensureVehicles(state);
  assert.equal(state.vehicles.schema, VEHICLE_SAVE_SCHEMA);
  assert.equal(state.vehicles.activeId, null);
  assert.equal(vehiclesOf(state).filter((vehicle) => vehicle.id === 'tractor-1').length, 1);
  assert.deepEqual(
    (({ x, z, yaw, condition }) => ({ x, z, yaw, condition }))(vehicleById(state, 'tractor-1')),
    { x: 4, z: 5, yaw: 0.4, condition: 61 },
  );
});

test('null parked poses stay unset until the property scene assigns a home', () => {
  const state = newGame('relaxed', 517);
  state.vehicles = {
    schema: VEHICLE_SAVE_SCHEMA,
    activeId: null,
    records: [
      { id: 'tractor-1', type: 'tractor', x: null, z: null, yaw: null },
      { id: 'golf-cart-1', type: 'golf_cart', x: null, z: null, yaw: null },
    ],
  };

  ensureVehicles(state, { recoverActive: true });

  for (const record of state.vehicles.records) {
    assert.equal(record.x, null);
    assert.equal(record.z, null);
    assert.equal(record.yaw, null);
  }
});

test('vehicle storage enforces authored slots and conserves quantities', () => {
  const state = newGame('relaxed', 516);
  const tractor = vehicleById(state, 'tractor-1');
  const slots = VEHICLE_SPECS.tractor.storageSlots;
  assert.equal(slots, 2);
  assert.equal(storeVehicleCargo(state, tractor.id, { id: 'fuel-can', quantity: 1 }).ok, true);
  assert.equal(storeVehicleCargo(state, tractor.id, { id: 'belt-kit', quantity: 2 }).ok, true);
  assert.deepEqual(storeVehicleCargo(state, tractor.id, { id: 'third-item' }), {
    ok: false,
    reason: 'storage-full',
  });
  assert.equal(storeVehicleCargo(state, tractor.id, { id: 'fuel-can', quantity: 2 }).stacked, true);
  const first = takeVehicleCargo(state, tractor.id, 'fuel-can', 2);
  assert.equal(first.taken, 2);
  assert.equal(vehicleById(state, tractor.id).cargo.find((entry) => entry.id === 'fuel-can').quantity, 1);
  const second = takeVehicleCargo(state, tractor.id, 'fuel-can', 8);
  assert.equal(second.taken, 1);
  assert.equal(vehicleById(state, tractor.id).cargo.some((entry) => entry.id === 'fuel-can'), false);
});
