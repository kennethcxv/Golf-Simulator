import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOX_LIFECYCLE,
  ensureDeliveries,
  recycleCarriedBox,
} from '../src/sim/deliveries.js';
import { newGame } from '../src/sim/state.js';

function stateWithBox(overrides = {}) {
  const state = newGame('relaxed', 6);
  ensureDeliveries(state);
  state.shop.deliveries.boxes.push({
    id: 701,
    orderId: 'recycling-test',
    skuId: 'tees1',
    box: 'carton',
    qty: 0,
    cap: 12,
    initialQty: 12,
    loc: 'carried',
    flat: true,
    flattenProgress: 1,
    lifecycle: BOX_LIFECYCLE.FLATTENING,
    schemaVersion: 3,
    ...overrides,
  });
  state.shop.deliveries.trash = 1;
  return state;
}

test('the recycling sink atomically consumes carried flattened cardboard', () => {
  const state = stateWithBox();
  const result = recycleCarriedBox(state, 701);

  assert.equal(result.ok, true);
  assert.equal(result.state, BOX_LIFECYCLE.DISCARDED);
  assert.equal(state.shop.deliveries.boxes.length, 0);
  assert.equal(state.shop.deliveries.trash, 0);
  assert.equal(state.shop.deliveries.recycled, 1);
});

test('the recycling sink cannot bypass the carry or flatten requirements', () => {
  const floorState = stateWithBox({ loc: 'world', x: 0, z: 0 });
  assert.equal(recycleCarriedBox(floorState, 701).ok, false);
  assert.equal(floorState.shop.deliveries.boxes.length, 1);

  const sealedState = stateWithBox({ flat: false, flattenProgress: 0 });
  assert.equal(recycleCarriedBox(sealedState, 701).ok, false);
  assert.equal(sealedState.shop.deliveries.boxes.length, 1);
});
