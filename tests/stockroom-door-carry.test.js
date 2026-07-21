import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import {
  arriveOrder, boxesOf, cutTape, openFlap, pickUpBox, putDownBox, takeFromBox,
} from '../src/sim/deliveries.js';
import { armsFullForDoor } from '../src/render3d/clubhouse/doors.js';

test('automatic service-door opening recognizes cartons and unpacked stock', () => {
  const state = newGame('relaxed', 817);
  arriveOrder(state, { id: 1, skuId: 'balls1', qty: 3 });
  const box = boxesOf(state)[0];

  assert.equal(pickUpBox(state, box.id).ok, true);
  assert.equal(armsFullForDoor(state), true, 'a carried carton opens the service door');

  assert.equal(putDownBox(state, box.id, 'stock').ok, true);
  cutTape(state, box.id, 1);
  openFlap(state, box.id);
  openFlap(state, box.id);
  openFlap(state, box.id);
  assert.equal(takeFromBox(state, box.id).ok, true);
  assert.equal(armsFullForDoor(state), true, 'unpacked goods in the player hands also open the service door');

  state.shop.carry = null;
  assert.equal(armsFullForDoor(state), false, 'empty hands do not trigger automatic doors');
});
