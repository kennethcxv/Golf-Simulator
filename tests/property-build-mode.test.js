import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { buildBuildMode } from '../src/render3d/clubhouse/buildMode.js';
import { importLegacyStoredPlaceables, ownedPlaceableItem, placedPropertyItems } from '../src/sim/propertyInventory.js';
import { newGame } from '../src/sim/state.js';

function propertyModeHarness(quantity = 2) {
  const state = newGame('relaxed', 8101);
  state.shop.inventory.plant1.back = quantity;
  importLegacyStoredPlaceables(state, 'plant1', quantity);
  const rebuilds = [];
  const visibility = [];
  const toasts = [];
  const walk = { x: -9, z: -5.5, yaw: 0, pitch: -Math.PI / 2, eye: 1.6 };
  const mode = buildBuildMode({
    interior: new THREE.Group(),
    state,
    hooks: { toast: (...args) => toasts.push(args) },
    walk,
    W2L: (x, z) => ({ x, z }),
    L2W: (x, z) => ({ x, z }),
    FLOOR_TOP: 0,
  }, {
    rebuildLayout: () => {},
    rebuildDecor: () => rebuilds.push('decor'),
    fixtureAnchors: new Map(),
    setDecorPlacementVisible: (...args) => visibility.push(args),
  });
  return { mode, state, walk, rebuilds, visibility, toasts };
}

test('normal build controls browse storage and place the selected physical item', () => {
  const { mode, state, rebuilds } = propertyModeHarness();
  mode.enter();
  assert.ok(mode.toggleInventory());
  assert.match(mode.inventoryText(), /PROPERTY STORAGE/);
  assert.match(mode.inventoryText(), /Potted plant/);
  assert.match(mode.inventoryText(), /Stored 2/);

  assert.ok(mode.interact(), 'E selects the highlighted stored item');
  assert.equal(mode.isInventoryOpen(), false);
  assert.equal(mode.isCarrying(), 'plant1');
  mode.update();
  assert.equal(mode.diagnostics().validation.ok, true);
  assert.ok(mode.interact(), 'E commits the exact green preview');

  assert.equal(mode.isCarrying(), null);
  assert.equal(placedPropertyItems(state).length, 1);
  assert.equal(state.shop.inventory.plant1.back, 1);
  assert.deepEqual(
    { stored: ownedPlaceableItem(state, 'plant1').quantityStored, placed: ownedPlaceableItem(state, 'plant1').quantityPlaced },
    { stored: 1, placed: 1 },
  );
  assert.equal(rebuilds.length, 1);
});

test('placed property items move, store, and undo through build-mode verbs', () => {
  const { mode, state, walk, visibility, rebuilds } = propertyModeHarness(1);
  mode.enter();
  mode.toggleInventory();
  mode.interact();
  mode.update();
  mode.interact();
  const firstId = placedPropertyItems(state)[0].id;

  mode.update();
  assert.ok(mode.interact(), 'looking at placed decor picks it up');
  assert.equal(mode.isCarrying(), firstId);
  assert.deepEqual(visibility.at(-1), [firstId, false]);
  walk.z = -4.5;
  mode.update();
  assert.ok(mode.interact(), 'E commits the move');
  assert.equal(placedPropertyItems(state)[0].pose.z, -4.5);

  mode.update();
  assert.ok(mode.interact(), 'the moved item can immediately be picked up again');
  assert.ok(mode.stow(), 'X returns it to storage');
  assert.equal(placedPropertyItems(state).length, 0);
  assert.equal(state.shop.inventory.plant1.back, 1);
  assert.ok(mode.undo(), 'Z restores the last stored placement');
  assert.equal(placedPropertyItems(state).length, 1);
  assert.equal(placedPropertyItems(state)[0].pose.z, -4.5);
  assert.ok(rebuilds.length >= 4);
});

test('right-click cancellation restores a hidden moved item without mutating its pose', () => {
  const { mode, state, visibility } = propertyModeHarness(1);
  mode.enter();
  mode.toggleInventory();
  mode.interact();
  mode.update();
  mode.interact();
  const placement = placedPropertyItems(state)[0];
  const before = structuredClone(placement.pose);
  mode.update();
  mode.interact();
  assert.ok(mode.cancel());
  assert.deepEqual(placement.pose, before);
  assert.deepEqual(visibility.slice(-2), [[placement.id, false], [placement.id, true]]);
});

test('stored resale requires a deliberate second delete press and pays once', () => {
  const { mode, state, toasts } = propertyModeHarness(1);
  const cash = state.cash;
  mode.enter();
  mode.toggleInventory();
  assert.ok(mode.sellSelected());
  assert.equal(state.cash, cash);
  assert.match(toasts.at(-1)[0], /again to sell/i);
  assert.ok(mode.sellSelected());
  assert.ok(state.cash > cash);
  assert.equal(state.shop.inventory.plant1.back, 0);
  assert.equal(ownedPlaceableItem(state, 'plant1').quantityOwned, 0);
});
