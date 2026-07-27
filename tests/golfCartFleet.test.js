import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GOLF_CART_TIER_IDS, golfCartTier } from '../src/data/golfCarts.js';
import { dispatchMarshalTask, ensureGolfDay, golfDayTick } from '../src/sim/golfDay.js';
import {
  assignGolfCartToStaff,
  chargeGolfCart,
  golfCartFleetSummary,
  parkGolfCart,
  purchaseGolfCart,
  releaseGolfCartFromStaff,
  repairGolfCart,
  upgradeGolfCart,
} from '../src/sim/golfCartFleet.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';
import { fireStaff, ROLE } from '../src/sim/staff.js';

test('default fleet exposes every authored tier without changing the eight-cart capacity baseline', () => {
  const state = newGame('relaxed', 91001);
  const day = ensureGolfDay(state);
  assert.equal(day.carts.length, 8);
  assert.deepEqual(new Set(day.carts.map((cart) => cart.tierId)), new Set(GOLF_CART_TIER_IDS));
  assert.equal(day.carts.every((cart) => Number.isFinite(cart.batteryPercent)), true);
  assert.equal(day.carts.every((cart) => golfCartTier(cart.tierId).capacity >= 2), true);
});

test('purchase, park, charge, repair, and sequential upgrade mutate the canonical saved fleet', () => {
  const state = newGame('relaxed', 91002);
  state.cash = 250000;
  const day = ensureGolfDay(state);
  const startingCash = state.cash;
  const purchased = purchaseGolfCart(state, 'basic');
  assert.equal(purchased.ok, true);
  assert.equal(day.carts.length, 9);
  assert.equal(state.cash, startingCash - golfCartTier('basic').purchaseCost);

  const cart = purchased.cart;
  cart.condition = 61;
  cart.batteryPercent = 34;
  const repaired = repairGolfCart(state, cart.id);
  assert.equal(repaired.ok, true);
  assert.equal(cart.condition, 100);

  const upgraded = upgradeGolfCart(state, cart.id);
  assert.equal(upgraded.ok, true);
  assert.equal(cart.tierId, 'standard');
  assert.equal(cart.upgrades, 1);

  cart.batteryPercent = 25;
  const charged = chargeGolfCart(state, cart.id);
  assert.equal(charged.ok, true);
  assert.equal(cart.status, 'charging');
  assert.ok(cart.serviceReadyMinute > state.clock.minutes);
  state.clock.minutes = cart.serviceReadyMinute + 0.01;
  golfDayTick(state, state.clock.minutes);
  assert.equal(cart.status, 'available');
  assert.equal(cart.batteryPercent, 100);

  cart.position = { x: 999, z: 999 };
  assert.equal(parkGolfCart(state, cart.id).ok, true);
  assert.notDeepEqual(cart.position, { x: 999, z: 999 });

  const restored = deserialize(serialize(state));
  const restoredCart = ensureGolfDay(restored, { restoring: true }).carts.find((entry) => entry.id === cart.id);
  assert.equal(restoredCart.tierId, 'standard');
  assert.equal(restoredCart.condition, 100);
  assert.equal(restoredCart.batteryPercent, 100);
  assert.equal(restoredCart.upgrades, 1);
});

test('old cart records migrate in place instead of resetting live golf-day state', () => {
  const state = newGame('relaxed', 91003);
  const day = ensureGolfDay(state);
  day.nextEventSequence = 77;
  for (const cart of day.carts) {
    delete cart.tierId;
    delete cart.batteryPercent;
    delete cart.homeSlot;
    delete cart.upgrades;
    delete cart.assignedStaffId;
    delete cart.yaw;
    delete cart.lightsOn;
    delete cart.parkedByPlayer;
    delete cart.drivenDistanceYd;
  }
  const sameDay = ensureGolfDay(state);
  assert.equal(sameDay, day);
  assert.equal(sameDay.nextEventSequence, 77);
  assert.equal(sameDay.carts.every((cart) => GOLF_CART_TIER_IDS.includes(cart.tierId)), true);
  assert.equal(sameDay.carts.every((cart) => cart.batteryPercent === 100), true);
  assert.equal(sameDay.carts.every((cart) => cart.assignedStaffId === null), true);
  assert.equal(sameDay.carts.every((cart) => cart.yaw === 0 && cart.lightsOn === false), true);
  assert.equal(sameDay.carts.every((cart) => cart.parkedByPlayer === false && cart.drivenDistanceYd === 0), true);
  assert.equal(golfCartFleetSummary(state).owned, 8);
});

test('assigned carts cannot be serviced or upgraded through fleet management', () => {
  const state = newGame('relaxed', 91004);
  state.cash = 250000;
  const cart = ensureGolfDay(state).carts[0];
  cart.status = 'assigned';
  cart.assignedPartyId = 'round-live';
  cart.batteryPercent = 20;
  cart.condition = 40;
  assert.equal(chargeGolfCart(state, cart.id).ok, false);
  assert.equal(repairGolfCart(state, cart.id).ok, false);
  assert.equal(upgradeGolfCart(state, cart.id).ok, false);
  assert.equal(parkGolfCart(state, cart.id).ok, false);
});

test('staff assignment reserves one operational cart and accelerates marshal response', () => {
  const state = newGame('relaxed', 91005);
  const day = ensureGolfDay(state);
  const marshal = {
    id: 501,
    name: 'Morgan Reed',
    role: ROLE.MARSHAL,
    skill: 3,
    wage: 115,
    trainingDays: 0,
  };
  state.staff.employees.push(marshal);
  const cart = day.carts[0];
  const secondCart = day.carts[1];
  const assigned = assignGolfCartToStaff(state, cart.id, marshal.id);
  assert.equal(assigned.ok, true);
  assert.equal(cart.status, 'staff-assigned');
  assert.equal(cart.assignedStaffId, marshal.id);
  assert.equal(assignGolfCartToStaff(state, secondCart.id, marshal.id).ok, false);
  assert.equal(golfCartFleetSummary(state).staffAssigned, 1);
  assert.equal(chargeGolfCart(state, cart.id).ok, false);

  day.marshalTasks.push({
    id: 'marshal-test',
    partyId: 'party-test',
    hole: 3,
    status: 'alert',
  });
  const startMinute = state.clock.minutes;
  const batteryBefore = cart.batteryPercent;
  const conditionBefore = cart.condition;
  const tripsBefore = cart.trips;
  const dispatched = dispatchMarshalTask(state, 'marshal-test', {
    minute: startMinute,
    employeeId: marshal.id,
    action: 'pace-reminder',
  });
  assert.equal(dispatched.ok, true);
  assert.equal(dispatched.task.cartId, cart.id);
  assert.equal(dispatched.task.dueMinute, Math.round((startMinute + (2.5 + 3 * 0.2) * 0.68) * 100) / 100);
  assert.equal(cart.trips, tripsBefore + 1);
  assert.equal(cart.batteryPercent, batteryBefore - 0.8);
  assert.equal(cart.condition, conditionBefore - 0.04);

  const restored = deserialize(serialize(state));
  const restoredCart = restored.golfDay.carts.find((entry) => entry.id === cart.id);
  assert.equal(restoredCart.status, 'staff-assigned');
  assert.equal(restoredCart.assignedStaffId, marshal.id);
  assert.equal(releaseGolfCartFromStaff(restored, cart.id).ok, true);
  assert.equal(restoredCart.status, 'available');
  assert.equal(restoredCart.assignedStaffId, null);
});

test('firing staff releases their cart and saving from the driver seat recovers a safe parked vehicle', () => {
  const state = newGame('relaxed', 91006);
  state.cash = 250000;
  const day = ensureGolfDay(state);
  const employee = {
    id: 601,
    name: 'Casey Green',
    role: ROLE.GROUNDSKEEPER,
    skill: 2,
    wage: 105,
    trainingDays: 0,
  };
  state.staff.employees.push(employee);
  const staffCart = day.carts[0];
  assert.equal(assignGolfCartToStaff(state, staffCart.id, employee.id).ok, true);
  assert.equal(fireStaff(state, employee.id).ok, true);
  assert.equal(staffCart.status, 'available');
  assert.equal(staffCart.assignedStaffId, null);

  const drivenCart = day.carts[1];
  Object.assign(drivenCart, {
    status: 'player-driving',
    assignedPartyId: null,
    assignedStaffId: null,
    position: { x: 123.25, z: -47.5 },
    yaw: 1.27,
    lightsOn: true,
    parkedByPlayer: true,
    batteryPercent: 72.4,
    condition: 88.6,
    drivenDistanceYd: 412.75,
  });
  const restored = deserialize(serialize(state));
  const restoredDrivenCart = restored.golfDay.carts.find((entry) => entry.id === drivenCart.id);
  assert.equal(restoredDrivenCart.status, 'available');
  assert.deepEqual(restoredDrivenCart.position, drivenCart.position);
  assert.equal(restoredDrivenCart.yaw, drivenCart.yaw);
  assert.equal(restoredDrivenCart.lightsOn, true);
  assert.equal(restoredDrivenCart.parkedByPlayer, true);
  assert.equal(restoredDrivenCart.batteryPercent, 72.4);
  assert.equal(restoredDrivenCart.condition, 88.6);
  assert.equal(restoredDrivenCart.drivenDistanceYd, 412.75);
});
