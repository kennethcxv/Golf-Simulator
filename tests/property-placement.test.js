import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import {
  importLegacyStoredPlaceables,
  ownedPlaceableItem,
  placedPropertyItems,
} from '../src/sim/propertyInventory.js';
import {
  moveDecorPlacement,
  placeDecorFree,
  removeDecorPlacement,
  sellStoredDecor,
} from '../src/sim/shop.js';
import {
  placeableFootprint,
  snapPlaceablePose,
  validatePlaceablePlacement,
} from '../src/sim/propertyPlacement.js';

function storeUnits(state, skuId, quantity) {
  state.shop.inventory[skuId].back = quantity;
  importLegacyStoredPlaceables(state, skuId, quantity);
}

test('floor, wall, and ceiling items snap to their authored mount class', () => {
  const floor = snapPlaceablePose('plant1', { x: -8.87, z: -5.88 }, 0.13);
  const wall = snapPlaceablePose('poster1', { x: -3, z: 6.35 }, 2.2);
  const ceiling = snapPlaceablePose('light1', { x: -8.87, z: -5.88 }, 0.13);

  assert.deepEqual(
    { mount: floor.mount, x: floor.x, z: floor.z, surface: floor.surfaceId },
    { mount: 'floor', x: -8.75, z: -6, surface: 'clubhouse:floor' },
  );
  assert.equal(wall.mount, 'wall');
  assert.match(wall.surfaceId, /^wall:/);
  assert.ok(validatePlaceablePlacement(newGame('relaxed', 701), 'poster1', wall).ok);
  assert.deepEqual(
    { mount: ceiling.mount, x: ceiling.x, z: ceiling.z, ry: ceiling.ry },
    { mount: 'ceiling', x: -8.75, z: -6, ry: 0.13 },
  );
});

test('the lounge uses its asymmetric sofa-and-table footprint through rotation', () => {
  const pose = { x: 0, z: 0, ry: 0, mount: 'floor' };
  const straight = placeableFootprint('lounge1', pose);
  const turned = placeableFootprint('lounge1', { ...pose, ry: Math.PI / 2 });
  assert.deepEqual(straight, { minX: -1.1, maxX: 1.1, minZ: -0.475, maxZ: 1.35 });
  assert.ok(Math.abs((turned.maxX - turned.minX) - 1.825) < 1e-9);
  assert.ok(Math.abs((turned.maxZ - turned.minZ) - 2.2) < 1e-9);
});

test('placement rejects fixtures, doors, partitions, and other blocking property items', () => {
  const state = newGame('relaxed', 702);
  assert.match(
    validatePlaceablePlacement(state, 'plant1', snapPlaceablePose('plant1', { x: -5.9, z: 1.25 })).reasons[0],
    /overlaps/i,
    'the apparel area is occupied by a fixture',
  );
  assert.match(
    validatePlaceablePlacement(state, 'plant1', snapPlaceablePose('plant1', { x: -1, z: 5 })).reasons.join(' '),
    /door/i,
  );
  assert.match(
    validatePlaceablePlacement(state, 'lounge1', snapPlaceablePose('lounge1', { x: 5.7, z: -1 })).reasons.join(' '),
    /interior wall/i,
  );
  assert.match(
    validatePlaceablePlacement(state, 'poster1', snapPlaceablePose('poster1', { x: 0, z: -6.35 })).reasons.join(' '),
    /hide that wall item/i,
    'wall decor cannot disappear behind a merchandising fixture',
  );

  storeUnits(state, 'plant1', 2);
  const firstPose = snapPlaceablePose('plant1', { x: -9, z: -5.5 });
  assert.ok(validatePlaceablePlacement(state, 'plant1', firstPose).ok);
  const first = placeDecorFree(state, 'plant1', firstPose);
  assert.ok(first.ok);
  assert.match(validatePlaceablePlacement(state, 'plant1', firstPose).reasons[0], /plant/i);
  assert.ok(validatePlaceablePlacement(state, 'plant1', firstPose, {
    exceptPlacementId: first.placement.id,
  }).ok, 'moving a placement does not collide with its saved pose');
});

test('a rug can sit beneath solid decor while duplicate rugs do not z-fight', () => {
  const state = newGame('relaxed', 703);
  storeUnits(state, 'rug1', 2);
  storeUnits(state, 'plant1', 1);
  const pose = snapPlaceablePose('rug1', { x: -8.5, z: -5 });
  assert.ok(placeDecorFree(state, 'rug1', pose).ok);
  assert.match(validatePlaceablePlacement(state, 'rug1', pose).reasons[0], /rug/i);
  assert.ok(validatePlaceablePlacement(state, 'plant1', {
    ...snapPlaceablePose('plant1', { x: -8.5, z: -5 }),
  }).ok, 'a nonblocking rug is a valid furnishing layer beneath a plant');
});

test('normal free place, move, store, and sell keep both inventory authorities reconciled', () => {
  const state = newGame('relaxed', 704);
  storeUnits(state, 'plant1', 2);
  const start = snapPlaceablePose('plant1', { x: -9, z: -5.5 });
  const placed = placeDecorFree(state, 'plant1', start);
  assert.ok(placed.ok);
  assert.deepEqual(
    { back: state.shop.inventory.plant1.back, stored: ownedPlaceableItem(state, 'plant1').quantityStored },
    { back: 1, stored: 1 },
  );

  const movedPose = snapPlaceablePose('plant1', { x: -9, z: -4.5 });
  assert.ok(validatePlaceablePlacement(state, 'plant1', movedPose, {
    exceptPlacementId: placed.placement.id,
  }).ok);
  const moved = moveDecorPlacement(state, placed.placement.id, movedPose);
  assert.ok(moved.ok);
  assert.deepEqual(placedPropertyItems(state)[0].pose, movedPose);

  const stored = removeDecorPlacement(state, placed.placement.id);
  assert.ok(stored.ok);
  assert.equal(placedPropertyItems(state).length, 0);
  assert.equal(state.shop.inventory.plant1.back, 2);
  assert.equal(ownedPlaceableItem(state, 'plant1').quantityStored, 2);

  const cashBefore = state.cash;
  const sold = sellStoredDecor(state, 'plant1', 'property-ui-sale:704');
  assert.ok(sold.ok);
  assert.equal(state.cash, cashBefore + sold.payout);
  assert.equal(state.shop.inventory.plant1.back, 1);
  assert.equal(ownedPlaceableItem(state, 'plant1').quantityStored, 1);
  const replay = sellStoredDecor(state, 'plant1', 'property-ui-sale:704');
  assert.ok(replay.ok && replay.replay);
  assert.equal(state.shop.inventory.plant1.back, 1, 'idempotent replay does not decrement the physical mirror');
});
