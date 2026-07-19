import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { FIXTURES } from '../src/data/shopLayout.js';
import { SNACKRACK_AUTHORED_SLOTS, slotsFor } from '../src/data/fixtureSlots.js';
import { MOVABLE_FIXTURE_CORE_MODELS } from '../src/render3d/clubhouse/fixtureCoreBatching.js';

const fixtureSource = fs.readFileSync(new URL('../src/render3d/clubhouse/fixtures.js', import.meta.url), 'utf8');
const clubhouseSource = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');
const merchSource = fs.readFileSync(new URL('../src/render3d/clubhouse/merch.js', import.meta.url), 'utf8');

test('one movable grab-and-go fixture owns every exact authored shelf socket', () => {
  const racks = FIXTURES.filter((fixture) => fixture.kind === 'snackrack');
  assert.equal(racks.length, 1, 'the shop contains no duplicate static snack shelf');
  assert.equal(racks[0].id, 'snackrack');
  assert.deepEqual(racks[0].skus, ['water1', 'snack1']);

  assert.equal(SNACKRACK_AUTHORED_SLOTS.water1.length, 14);
  assert.equal(SNACKRACK_AUTHORED_SLOTS.snack1.length, 10);
  assert.deepEqual(slotsFor('water1'), SNACKRACK_AUTHORED_SLOTS.water1);
  assert.deepEqual(slotsFor('snack1'), SNACKRACK_AUTHORED_SLOTS.snack1);
  assert.deepEqual(
    SNACKRACK_AUTHORED_SLOTS.water1.map((slot) => slot.socket),
    Array.from({ length: 14 }, (_, index) => `DRINK_SLOT_${String(index + 1).padStart(2, '0')}`),
  );
  assert.deepEqual(
    SNACKRACK_AUTHORED_SLOTS.snack1.map((slot) => slot.socket),
    Array.from({ length: 10 }, (_, index) => `SNACK_SLOT_${String(index + 1).padStart(2, '0')}`),
  );
});

test('the authored snack shelf is instantiated once through the re-layable fixture builder', () => {
  assert.match(fixtureSource, /function snackrackUnit\(f\)/);
  assert.match(fixtureSource, /snackrack: snackrackUnit/);
  assert.equal((fixtureSource.match(/model: 'snack_shelf'/g) || []).length, 1);
  assert.ok(MOVABLE_FIXTURE_CORE_MODELS.includes('snack_shelf'));
  assert.doesNotMatch(fixtureSource, /snack\.position\.set\(-6\.6/);
});

test('shelf stock uses the original water and snack product GLBs, never generic cartons', () => {
  assert.match(clubhouseSource, /id === 'water1' \|\| id === 'snack1'/);
  assert.match(clubhouseSource, /provisions_fairway_spring_water/);
  assert.match(clubhouseSource, /provisions_bunker_bites_chips/);
  assert.match(clubhouseSource, /merch\.instantiateRaw\(model\)/);
  assert.match(merchSource, /'provisions_fairway_spring_water', 'provisions_bunker_bites_chips'/);
});
