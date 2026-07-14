// Boxes are physical objects: setting one down places THAT box exactly where
// the player stands — anywhere in the world — and it stays there through
// pick-up/put-down cycles and save/load. A box must never vanish or teleport.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initDeliveries, arriveOrder, boxesOf, pickUpBox, putDownBox, carriedBox,
} from '../src/sim/deliveries.js';

function freshState() {
  const state = { shop: { inventory: { balls2: { back: 0, shelf: 0 } } } };
  initDeliveries(state);
  arriveOrder(state, { id: 1, skuId: 'balls2', qty: 12 });
  return state;
}

test('a box set down in the world keeps its identity and exact spot', () => {
  const state = freshState();
  const box = boxesOf(state)[0];
  assert.equal(box.loc, 'pad');
  assert.ok(pickUpBox(state, box.id).ok);
  assert.equal(carriedBox(state).id, box.id);
  const res = putDownBox(state, box.id, { x: 3.25, z: -1.5, ry: 0.7 });
  assert.ok(res.ok);
  assert.equal(box.loc, 'world');
  assert.equal(box.x, 3.25);
  assert.equal(box.z, -1.5);
  assert.equal(box.ry, 0.7);
});

test('pick-up/set-down cycles never lose or duplicate a box', () => {
  const state = freshState();
  const box = boxesOf(state)[0];
  for (let i = 0; i < 10; i++) {
    assert.ok(pickUpBox(state, box.id).ok, `cycle ${i} pickup`);
    const spot = { x: -8 + i * 1.7, z: 5 - i * 0.9, ry: i * 0.3 };
    assert.ok(putDownBox(state, box.id, spot).ok, `cycle ${i} setdown`);
    assert.equal(boxesOf(state).length, 1, `cycle ${i} count`);
    assert.equal(boxesOf(state)[0].id, box.id, `cycle ${i} identity`);
    assert.equal(boxesOf(state)[0].x, spot.x, `cycle ${i} x`);
    assert.equal(boxesOf(state)[0].z, spot.z, `cycle ${i} z`);
  }
});

test('world boxes and their positions survive a save/load round trip', () => {
  const state = freshState();
  const box = boxesOf(state)[0];
  pickUpBox(state, box.id);
  putDownBox(state, box.id, { x: 12.4, z: -3.6, ry: 1.1 });
  const loaded = JSON.parse(JSON.stringify(state));
  const again = boxesOf(loaded)[0];
  assert.equal(again.id, box.id);
  assert.equal(again.loc, 'world');
  assert.equal(again.x, 12.4);
  assert.equal(again.z, -3.6);
  assert.equal(again.ry, 1.1);
});

test('legacy zone set-down still works for old callers', () => {
  const state = freshState();
  const box = boxesOf(state)[0];
  pickUpBox(state, box.id);
  assert.ok(putDownBox(state, box.id, 'stock').ok);
  assert.equal(box.loc, 'stock');
  assert.equal(box.x, undefined);
  pickUpBox(state, box.id);
  assert.ok(putDownBox(state, box.id, 'pad').ok);
  assert.equal(box.loc, 'pad');
});
