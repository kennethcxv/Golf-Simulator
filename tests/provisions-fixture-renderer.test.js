import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { FIXTURES } from '../src/data/shopLayout.js';
import { capacityOf, homeFixture, slotsFor } from '../src/data/fixtureSlots.js';

const fixtureSource = fs.readFileSync(new URL('../src/render3d/clubhouse/fixtures.js', import.meta.url), 'utf8');
const clubhouseSource = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');
const merchSource = fs.readFileSync(new URL('../src/render3d/clubhouse/merch.js', import.meta.url), 'utf8');

test('the production refreshment fixtures own separate exact physical facings', () => {
  const fixtures = FIXTURES.filter((fixture) => ['cold_drinks', 'snack_rack'].includes(fixture.id));
  assert.deepEqual(fixtures.map((fixture) => fixture.id), ['cold_drinks', 'snack_rack']);
  assert.equal(homeFixture('water1').id, 'cold_drinks');
  assert.equal(homeFixture('snack1').id, 'snack_rack');
  assert.equal(capacityOf('water1'), 8);
  assert.equal(capacityOf('snack1'), 8);
  assert.equal(new Set(slotsFor('water1').map(({ x, y, z }) => `${x}:${y}:${z}`)).size, 8);
  assert.equal(new Set(slotsFor('snack1').map(({ x, y, z }) => `${x}:${y}:${z}`)).size, 8);
});

test('the authored fridge and snack rack are instantiated through the re-layable fixture builder', () => {
  assert.match(fixtureSource, /function fridgeUnit\(f\)/);
  assert.match(fixtureSource, /fridge: fridgeUnit/);
  assert.match(fixtureSource, /assetUnit\(f, 'drinks_fridge'/);
  assert.match(fixtureSource, /assetUnit\(f, 'snack_rack'/);
  assert.doesNotMatch(fixtureSource, /snack\.position\.set\(-6\.6/);
});

test('shelf stock uses the original water and snack product GLBs, never generic cartons', () => {
  assert.match(clubhouseSource, /id === 'water1' \|\| id === 'snack1'/);
  assert.match(clubhouseSource, /provisions_fairway_spring_water/);
  assert.match(clubhouseSource, /provisions_bunker_bites_chips/);
  assert.match(clubhouseSource, /merch\.instantiateRaw\(model\)/);
  assert.match(merchSource, /'provisions_fairway_spring_water', 'provisions_bunker_bites_chips'/);
});
