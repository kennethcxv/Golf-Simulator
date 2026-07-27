import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { FIXTURES } from '../src/data/shopLayout.js';
import { slotsFor } from '../src/data/fixtureSlots.js';
import {
  OPENING_DRINKS_COOLER_CAPACITY, OPENING_DRINKS_COOLER_SOCKETS,
} from '../src/sim/openingDrinksCooler.js';

const fixtureSource = fs.readFileSync(new URL('../src/render3d/clubhouse/fixtures.js', import.meta.url), 'utf8');
const clubhouseSource = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');
const merchSource = fs.readFileSync(new URL('../src/render3d/clubhouse/merch.js', import.meta.url), 'utf8');

test('one cooler and one snack rack own their exact, non-overlapping stock lines', () => {
  const coolers = FIXTURES.filter((fixture) => fixture.id === 'cold_drinks');
  const racks = FIXTURES.filter((fixture) => fixture.kind === 'snackrack');
  assert.equal(coolers.length, 1, 'the shop contains one inventory-backed drinks cooler');
  assert.equal(racks.length, 1, 'the shop contains no duplicate static snack shelf');
  assert.equal(racks[0].id, 'snackrack');
  assert.deepEqual(coolers[0].skus, ['water1', 'sportdrink2', 'soda1']);
  assert.deepEqual(racks[0].skus, ['chips1', 'bar2', 'crackers1', 'snack1']);

  assert.equal(OPENING_DRINKS_COOLER_SOCKETS.length, 24);
  assert.equal(OPENING_DRINKS_COOLER_CAPACITY.bySku.water1, 8);
  assert.deepEqual(
    slotsFor('water1').map((slot) => slot.socketName),
    OPENING_DRINKS_COOLER_SOCKETS
      .filter((socket) => socket.skuId === 'water1')
      .map((socket) => socket.name),
  );
  assert.equal(slotsFor('snack1').length, 8);
});

test('the authored snack rack is instantiated once through the re-layable fixture builder', () => {
  assert.match(fixtureSource, /function snackrackUnit\(f\)/);
  assert.match(fixtureSource, /snackrack: snackrackUnit/);
  assert.equal((fixtureSource.match(/assetUnit\(f, 'snack_rack'/g) || []).length, 1);
  assert.doesNotMatch(fixtureSource, /snack\.position\.set\(-6\.6/);
});

test('the opening cooler mounts its authored GLB and redraws stock on named sockets', () => {
  assert.match(fixtureSource, /function fridgeUnit\(f\)/);
  assert.match(fixtureSource, /pine_hills_opening_drinks_cooler_v1/);
  assert.match(fixtureSource, /instantiateRaw\?\.\(modelName\)/);
  assert.match(fixtureSource, /openingDrinksCoolerSnapshot\(state\)/);
  assert.match(fixtureSource, /B\.rebuildStock\(\)/);
});

test('shelf stock uses the original water and snack product GLBs, never generic cartons', () => {
  assert.match(clubhouseSource, /id === 'water1' \|\| id === 'snack1'/);
  assert.match(clubhouseSource, /provisions_fairway_spring_water/);
  assert.match(clubhouseSource, /provisions_bunker_bites_chips/);
  assert.match(clubhouseSource, /merch\.instantiateRaw\(model\)/);
  assert.match(merchSource, /'provisions_fairway_spring_water', 'provisions_bunker_bites_chips'/);
});
