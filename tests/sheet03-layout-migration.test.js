import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FIXTURES, FIXTURE_HALF, fixtureRect } from '../src/data/shopLayout.js';
import { placedFixtures, validatePlacement } from '../src/sim/layout.js';
import {
  FIXTURE_FOOTPRINT_SAVE_VERSION,
  SAVE_VERSION,
  deserialize,
  newGame,
  serialize,
} from '../src/sim/state.js';

const fixtureById = (id) => FIXTURES.find((fixture) => fixture.id === id);

test('apparel table render and placement share the authored 1.60 by 0.90 footprint', () => {
  assert.deepEqual(FIXTURE_HALF.table, [0.80, 0.45]);

  const table = fixtureById('table_polos');
  const flat = fixtureRect({ ...table, ry: 0 });
  assert.ok(Math.abs((flat.maxX - flat.minX) - 1.60) < 1e-9);
  assert.ok(Math.abs((flat.maxZ - flat.minZ) - 0.90) < 1e-9);

  const turned = fixtureRect({ ...table, ry: Math.PI / 2 });
  assert.ok(Math.abs((turned.maxX - turned.minX) - 0.90) < 1e-9);
  assert.ok(Math.abs((turned.maxZ - turned.minZ) - 1.60) < 1e-9);

  const source = readFileSync(
    new URL('../src/render3d/clubhouse/fixtures.js', import.meta.url),
    'utf8',
  );
  const tableBuilder = source.slice(
    source.indexOf('function tableUnit(f)'),
    source.indexOf('function railUnit(f)'),
  );
  assert.match(tableBuilder, /addFixtureCollider\(f\)/,
    'the rendered collider must derive from fixtureRect through the shared helper');
  assert.doesNotMatch(tableBuilder, /colBoxAt\(f\.x,\s*f\.z,\s*1\.70,\s*1\.00\)/,
    'the stale hand-authored collider cannot return');
});

test('pre-current saves restore only invalid moved poses under repaired footprints', () => {
  const state = newGame('relaxed', 30310);
  const validTablePose = { x: -5.5, z: 1.5, ry: 0 };
  assert.equal(
    validatePlacement(
      state,
      'table_polos',
      validTablePose.x,
      validTablePose.z,
      validTablePose.ry,
    ).ok,
    true,
    'the retained control pose starts legal',
  );

  const raw = JSON.parse(serialize(state));
  raw.version = FIXTURE_FOOTPRINT_SAVE_VERSION - 1;
  raw.shop.layout.moved.table_polos = validTablePose;
  // The old symmetric shoerack half-box fit here. Its repaired asymmetric
  // footprint extends through the west wall, so v10 must fall back to default.
  raw.shop.layout.moved.shoerack = { x: -9.4, z: 4.5, ry: -Math.PI / 2 };
  assert.equal(
    validatePlacement(
      { ...state, shop: { ...state.shop, layout: structuredClone(raw.shop.layout) } },
      'shoerack',
      -9.4,
      4.5,
      -Math.PI / 2,
    ).ok,
    false,
    'the repaired shoe-wall footprint rejects the legacy wall overlap',
  );
  const inventoryBefore = structuredClone(raw.shop.inventory);

  const migrated = deserialize(JSON.stringify(raw));
  assert.equal(migrated.version, SAVE_VERSION);
  assert.deepEqual(migrated.shop.layout.moved.table_polos, validTablePose,
    'a valid player move survives the footprint migration');
  assert.equal(migrated.shop.layout.moved.shoerack, undefined,
    'only the invalid legacy override is removed');
  assert.deepEqual(
    placedFixtures(migrated).find((fixture) => fixture.id === 'shoerack'),
    fixtureById('shoerack'),
    'the invalid shoe wall resolves to its safe authored pose',
  );
  assert.deepEqual(migrated.shop.inventory, inventoryBefore,
    'pose repair does not mint, discard, or relocate inventory');

  const loadedAgain = deserialize(serialize(migrated));
  assert.deepEqual(loadedAgain.shop.layout.moved, migrated.shop.layout.moved,
    'current-schema round trips do not re-run or broaden the legacy repair');
  assert.deepEqual(loadedAgain.shop.inventory, migrated.shop.inventory);
});
