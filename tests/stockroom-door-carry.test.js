import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { arriveOrder, boxesOf, cutTape, openFlap, takeFromBox } from '../src/sim/deliveries.js';
import { armsFullForDoor } from '../src/render3d/clubhouse/doors.js';

test('automatic service-door opening recognizes cartons and unpacked stock', () => {
  const state = newGame('relaxed', 817);
  arriveOrder(state, { id: 1, skuId: 'balls1', qty: 3 });
  const box = boxesOf(state)[0];

  box.loc = 'carried';
  assert.equal(armsFullForDoor(state), true, 'a carried carton opens the service door');

  box.loc = 'world';
  cutTape(state, box.id, 1);
  for (let flap = 0; flap < 4; flap += 1) openFlap(state, box.id);
  assert.equal(takeFromBox(state, box.id).ok, true);
  assert.equal(armsFullForDoor(state), true, 'unpacked goods in the player hands also open the service door');

  state.shop.carry = null;
  assert.equal(armsFullForDoor(state), false, 'empty hands do not trigger automatic doors');
});
