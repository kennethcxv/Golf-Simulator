// Boxes are physical objects: setting one down on a registered, clear support
// places THAT box at the exact validated transform, and it stays there through
// pick-up/put-down cycles and save/load. A box must never vanish or teleport.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initDeliveries, arriveOrder, boxesOf, pickUpBox, putDownBox, carriedBox,
  cutTape, openFlap, takeFromBox, flattenBox, recycleBox,
  tapePartlyCut, tapeCut, flapsOpen,
} from '../src/sim/deliveries.js';
import { FLOOR_BOX_SURFACE_ID } from '../src/data/boxPlacementSurfaces.js';
import { carriedGoods, storeInBack } from '../src/sim/stocking.js';

const floorTarget = (x, z, ry = 0) => ({
  kind: 'surface', surfaceId: FLOOR_BOX_SURFACE_ID, x, z, ry,
});

function freshState() {
  const state = { shop: { inventory: { balls2: { back: 0, shelf: 0 } }, carry: null } };
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
  const res = putDownBox(state, box.id, floorTarget(9, -5, 0.7));
  assert.ok(res.ok);
  assert.equal(box.loc, 'world');
  assert.equal(box.surfaceId, FLOOR_BOX_SURFACE_ID);
  assert.equal(box.x, 9);
  assert.equal(box.z, -5);
  assert.equal(box.ry, 0.7);
});

test('pick-up/set-down cycles never lose or duplicate a box', () => {
  const state = freshState();
  const box = boxesOf(state)[0];
  for (let i = 0; i < 10; i++) {
    assert.ok(pickUpBox(state, box.id).ok, `cycle ${i} pickup`);
    // Reuse one known-clear floor support: pickup releases its occupancy before
    // the next placement, while rotation still exercises ten exact transforms.
    const spot = floorTarget(9, -5, i * 0.3);
    assert.ok(putDownBox(state, box.id, spot).ok, `cycle ${i} setdown`);
    assert.equal(boxesOf(state).length, 1, `cycle ${i} count`);
    assert.equal(boxesOf(state)[0].id, box.id, `cycle ${i} identity`);
    assert.equal(boxesOf(state)[0].surfaceId, FLOOR_BOX_SURFACE_ID, `cycle ${i} surface`);
    assert.equal(boxesOf(state)[0].x, spot.x, `cycle ${i} x`);
    assert.equal(boxesOf(state)[0].z, spot.z, `cycle ${i} z`);
  }
});

test('world boxes and their positions survive a save/load round trip', () => {
  const state = freshState();
  const box = boxesOf(state)[0];
  assert.ok(pickUpBox(state, box.id).ok);
  assert.ok(putDownBox(state, box.id, floorTarget(9, -5, 1.1)).ok);
  const loaded = JSON.parse(JSON.stringify(state));
  const again = boxesOf(loaded)[0];
  assert.equal(again.id, box.id);
  assert.equal(again.loc, 'world');
  assert.equal(again.surfaceId, FLOOR_BOX_SURFACE_ID);
  assert.equal(again.x, 9);
  assert.equal(again.z, -5);
  assert.equal(again.ry, 1.1);
});

test('opening is physical: cut the tape, open the flaps, take armfuls, flatten the empty', () => {
  // The old version of this test cut the box with ONE call and the contents landed straight in the
  // backroom. Both of those are exactly what the brief says must not happen — the full loop lives
  // in tests/unboxing.test.js; this holds the physical-object half of it.
  const state = freshState();
  const box = boxesOf(state)[0]; // 12 dozen balls, in one case
  assert.equal(takeFromBox(state, box.id).ok, false, 'a sealed box refuses');

  cutTape(state, box.id, 0.5);
  assert.ok(tapePartlyCut(box), 'half-cut is a state, not a step on the way to one');
  assert.equal(openFlap(state, box.id).ok, false, 'the flaps will not lift through tape');
  cutTape(state, box.id, 0.5);
  assert.ok(tapeCut(box));
  assert.equal(cutTape(state, box.id, 1).ok, false, 'tape cuts once');

  openFlap(state, box.id);
  openFlap(state, box.id);
  openFlap(state, box.id);
  assert.ok(flapsOpen(box));

  const t1 = takeFromBox(state, box.id);
  assert.ok(t1.ok);
  assert.equal(t1.taken, 6, 'an armful, not the whole case');
  assert.equal(box.qty, 6, 'half remains — a partial box');
  assert.equal(state.shop.inventory.balls2.back, 0, 'and it went into your ARMS, not the backroom');
  assert.equal(carriedGoods(state).qty, 6);

  // a half-emptied, flaps-open box survives a save/load round trip exactly as it stood
  const loaded = JSON.parse(JSON.stringify(state));
  const again = boxesOf(loaded)[0];
  assert.equal(again.tape, 1);
  assert.deepEqual(again.flaps, [1, 1]);
  assert.equal(again.qty, 6);
  assert.equal(carriedGoods(loaded).qty, 6, 'and so does what is in your hands');

  storeInBack(state);
  takeFromBox(state, box.id);
  storeInBack(state);
  assert.equal(box.qty, 0);
  assert.equal(state.shop.inventory.balls2.back, 12, 'every ball accounted for');
  assert.equal(boxesOf(state).length, 1, 'the empty carton is still standing there');

  assert.equal(flattenBox(state, box.id).ok, true);
  assert.equal(boxesOf(state).length, 1, 'flattened is not gone');
  assert.equal(state.shop.deliveries.trash, 1, 'flattened cardboard waiting for the bin');
  assert.ok(recycleBox(state, box.id).ok);
  assert.equal(boxesOf(state).length, 0, 'NOW it is gone');
});

test('a carried box cannot be cut or emptied mid-air', () => {
  const state = freshState();
  const box = boxesOf(state)[0];
  assert.ok(pickUpBox(state, box.id).ok);
  assert.equal(cutTape(state, box.id, 1).ok, false);
  assert.ok(putDownBox(state, box.id, floorTarget(1, 1)).ok);
  assert.ok(cutTape(state, box.id, 1).ok);
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
