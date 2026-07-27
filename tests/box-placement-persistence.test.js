import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPAREL_TABLE_BOX_SURFACE_ID,
  FLOOR_BOX_SURFACE_ID,
  PACKING_STATION_BOX_SURFACE_ID,
} from '../src/data/boxPlacementSurfaces.js';
import {
  BOX_LIFECYCLE,
  arriveOrder,
  boxesOf,
  ensureDeliveries,
  pickUpBox,
  putDownBox,
} from '../src/sim/deliveries.js';
import { resolveBoxPose } from '../src/sim/boxPlacement.js';
import { newGame } from '../src/sim/state.js';

function landed(seed = 901) {
  const state = newGame('relaxed', seed);
  arriveOrder(state, { id: `placement-${seed}`, skuId: 'tees1', qty: 12 });
  return { state, box: boxesOf(state)[0] };
}

const surfaceTarget = (surfaceId, x = 0, z = 0, ry = 0) => ({
  kind: 'surface', surfaceId, x, z, ry,
});

test('an exact fixture-local placement persists and resolves identically after JSON reload', () => {
  const { state, box } = landed();
  box.cutProgress = 0.42;
  box.tape = 0.42;
  box.lifecycle = BOX_LIFECYCLE.CUTTING;
  assert.ok(pickUpBox(state, box.id).ok);

  const target = surfaceTarget(APPAREL_TABLE_BOX_SURFACE_ID, 0.25, 0, Math.PI / 2);
  const placed = putDownBox(state, box.id, target);
  assert.equal(placed.ok, true, placed.reason);
  assert.deepEqual(
    { loc: box.loc, surfaceId: box.surfaceId, x: box.x, z: box.z, ry: box.ry },
    { loc: 'world', surfaceId: APPAREL_TABLE_BOX_SURFACE_ID, x: 0.25, z: 0, ry: Math.PI / 2 },
  );
  const beforePose = resolveBoxPose(state, box);
  assert.equal(beforePose.ok, true, beforePose.reason);

  const loaded = JSON.parse(JSON.stringify(state));
  ensureDeliveries(loaded);
  const restored = boxesOf(loaded).find((entry) => entry.id === box.id);
  const afterPose = resolveBoxPose(loaded, restored);
  assert.equal(afterPose.ok, true, afterPose.reason);
  assert.deepEqual(afterPose.pose, beforePose.pose);
  assert.equal(restored.qty, 12);
  assert.equal(restored.cutProgress, 0.42);
  assert.equal(restored.lifecycle, BOX_LIFECYCLE.CUTTING);
});

test('authoritative commit rejection leaves every carried-box field unchanged', () => {
  const { state, box } = landed(902);
  assert.ok(pickUpBox(state, box.id).ok);
  const before = JSON.stringify(box);

  const result = putDownBox(
    state,
    box.id,
    surfaceTarget(FLOOR_BOX_SURFACE_ID, 0, -99, 0),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'wall');
  assert.equal(JSON.stringify(box), before);
  assert.equal(box.loc, 'carried');
});

test('pickup clears stale surface ownership before the next exact placement', () => {
  const { state, box } = landed(903);
  assert.ok(pickUpBox(state, box.id).ok);
  assert.ok(putDownBox(
    state,
    box.id,
    surfaceTarget(PACKING_STATION_BOX_SURFACE_ID, 0, 0, 0),
  ).ok);
  assert.ok(pickUpBox(state, box.id).ok);
  assert.equal(box.surfaceId, undefined);
  assert.equal(box.x, undefined);
  assert.equal(box.z, undefined);
  assert.equal(box.ry, undefined);
});

test('schema-v3 floor boxes gain the identity surface without changing their transform', () => {
  const { state, box } = landed(904);
  Object.assign(box, {
    schemaVersion: 3,
    loc: 'world',
    x: 0,
    z: -4,
  });
  delete box.surfaceId;
  delete box.ry;

  ensureDeliveries(state);
  assert.equal(box.loc, 'world');
  assert.equal(box.surfaceId, FLOOR_BOX_SURFACE_ID);
  assert.deepEqual({ x: box.x, z: box.z, ry: box.ry }, { x: 0, z: -4, ry: 0 });
});

test('unknown and stored-fixture surfaces heal visibly without losing box identity or state', () => {
  for (const [seed, surfaceId, prepare] of [
    [905, 'fixture:deleted:top', () => {}],
    [906, APPAREL_TABLE_BOX_SURFACE_ID, (state) => {
      state.shop.layout = { moved: {}, stored: ['table_polos'], extra: [] };
    }],
  ]) {
    const { state, box } = landed(seed);
    Object.assign(box, {
      loc: 'world',
      surfaceId,
      x: 0,
      z: 0,
      ry: 0,
      qty: 7,
      cutProgress: 0.5,
      tape: 0.5,
      lifecycle: BOX_LIFECYCLE.CUTTING,
    });
    prepare(state);
    ensureDeliveries(state);
    assert.equal(box.loc, 'stock');
    assert.equal(box.id, 1);
    assert.equal(box.qty, 7);
    assert.equal(box.cutProgress, 0.5);
    assert.equal(box.lifecycle, BOX_LIFECYCLE.CUTTING);
    assert.equal(box.surfaceId, undefined);
  }
});

test('an explicit pallet target persists its exact safe lane', () => {
  const { state, box } = landed(907);
  assert.ok(pickUpBox(state, box.id).ok);
  const result = putDownBox(state, box.id, { kind: 'pallet', palletIndex: 4 });
  assert.equal(result.ok, true, result.reason);
  assert.equal(box.loc, 'pad');
  assert.equal(box.padPalletIndex, 4);

  const loaded = JSON.parse(JSON.stringify(state));
  ensureDeliveries(loaded);
  assert.equal(boxesOf(loaded)[0].padPalletIndex, 4);
});
