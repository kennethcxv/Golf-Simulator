import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import { reconcileInventory } from '../src/sim/inventoryLifecycle.js';
import { shopDailyAccrual } from '../src/sim/shop.js';

function passiveSaleState(seed = 1) {
  const state = newGame('relaxed', seed);
  for (const inventory of Object.values(state.shop.inventory)) {
    inventory.shelf = 0;
    inventory.back = 0;
  }
  state.shop.inventory.balls1.shelf = 20;
  state.shop.unlockedTier = 3;
  state.shop.markup.balls = 0.1;
  state.club.lastRounds = 180;
  state.club.reputation = 100;
  state.shop.rentalFleet.sets = 0;
  return state;
}

test('passive sales move exact shelf lots to sold before projecting stock and books', () => {
  const state = passiveSaleState();
  const cashBefore = state.cash;

  const accrual = shopDailyAccrual(state);

  assert.ok(accrual.units > 0, 'the deterministic scenario completed passive sales');
  assert.equal(state.shop.inventory.balls1.shelf, 20 - accrual.units);
  assert.equal(reconcileInventory(state, { qa: true, context: 'passive-sales' }).ok, true);
  assert.equal(
    state.shop.inventoryLifecycle.lots.reduce(
      (total, lot) => total + (lot.skuId === 'balls1' ? lot.buckets.sold : 0),
      0,
    ),
    accrual.units,
  );
  assert.equal(state.cash, Math.round((cashBefore + accrual.revenue) * 100) / 100);
  assert.ok(state.ledger.processedIds['shop-simulation:0:sales']);
  assert.ok(state.ledger.processedIds['shop-simulation:0:cogs']);
});

test('an incomplete ledger checkpoint refuses passive sales before stock or cash changes', () => {
  const state = passiveSaleState();
  state.ledger.processedIds['shop-simulation:0:sales'] = 'missing-ledger-entry';
  const inventoryBefore = structuredClone(state.shop.inventory);
  const cashBefore = state.cash;
  const entriesBefore = state.ledger.entries.length;

  const accrual = shopDailyAccrual(state);

  assert.equal(accrual.ok, false);
  assert.match(accrual.diagnostic || accrual.reason, /checkpoint is incomplete/i);
  assert.deepEqual(state.shop.inventory, inventoryBefore);
  assert.equal(state.cash, cashBefore);
  assert.equal(state.ledger.entries.length, entriesBefore);
  assert.equal(state.shop.inventoryLifecycle, undefined,
    'failed preflight does not even bootstrap or mutate the lot authority');
});
