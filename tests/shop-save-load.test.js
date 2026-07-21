import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { FIXTURES, fixtureSockets, shopLightingTier } from '../src/data/shopLayout.js';
import { capacityOf } from '../src/data/fixtureSlots.js';
import {
  activeFixtures, commitPlacement, ensureLayout, fixtureById, routesIntact, validatePlacement,
} from '../src/sim/layout.js';

function legalMove(state, id) {
  for (let x = -7.5; x <= 4.5; x += 0.5) {
    for (let z = -4.5; z <= 4.5; z += 0.5) {
      const result = validatePlacement(state, id, x, z, 0);
      if (result.ok) return { x, z, ry: 0 };
    }
  }
  return null;
}

test('premium layout, tier, sockets and partial shelf states round-trip exactly', () => {
  const state = newGame('relaxed', 909);
  ensureLayout(state);
  state.shop.unlockedTier = 3;
  state.shop.progression.tier = 'premium';

  const movedId = 'hatstand';
  const move = legalMove(state, movedId);
  assert.ok(move, 'the floor offers a legal authored fixture move');
  assert.equal(commitPlacement(state, movedId, move.x, move.z, move.ry).id, movedId);

  state.shop.inventory.balls1.shelf = 0;
  state.shop.inventory.polo1.shelf = Math.floor(capacityOf('polo1') / 2);
  state.shop.inventory.bag1.shelf = capacityOf('bag1');
  const inventoryBefore = JSON.parse(JSON.stringify(state.shop.inventory));
  const socketBefore = fixtureSockets(fixtureById(state, movedId), 'browse');
  const fixtureIdsBefore = activeFixtures(state).map((f) => f.id).sort();

  const loaded = deserialize(serialize(state));
  ensureLayout(loaded);
  const fixtureIdsAfter = activeFixtures(loaded).map((f) => f.id).sort();

  assert.equal(loaded.shop.unlockedTier, 3);
  assert.deepEqual(loaded.shop.inventory, inventoryBefore, 'no shelf or backroom stock is lost or duplicated');
  assert.deepEqual(fixtureIdsAfter, fixtureIdsBefore, 'the same fixture set returns');
  assert.equal(new Set(fixtureIdsAfter).size, fixtureIdsAfter.length, 'no fixture is duplicated');
  assert.deepEqual(fixtureSockets(fixtureById(loaded, movedId), 'browse'), socketBefore, 'moved product sockets return with their fixture');
  assert.equal(routesIntact(loaded), true, 'the reloaded floor keeps all doors and destinations reachable');
  assert.equal(shopLightingTier(loaded.shop.unlockedTier).key, 'premium', 'lighting tier derives from persisted ownership');
  assert.equal(fixtureIdsAfter.includes('fittingroom'), true);
  assert.equal(fixtureIdsAfter.includes('putting_demo'), true);
  assert.equal(FIXTURES.some((f) => f.id === 'placeholder'), false, 'no legacy placeholder fixture is authored');
});
