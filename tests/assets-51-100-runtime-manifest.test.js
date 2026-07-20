import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROP_PLACEMENTS, RUNTIME_ASSET_MANIFEST, RUNTIME_ASSET_MANIFEST_BY_NUMBER,
} from '../src/render3d/assets51to100/runtimeManifest.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_FIELDS = Object.freeze([
  'glbPath', 'blenderSource', 'placementCategory', 'defaultTransform', 'collisionMode',
  'mountType', 'interactionSockets', 'animationClips', 'saveStateKey', 'restorationState',
  'cleaningState', 'visibilityRules', 'performanceTier',
]);

test('the runtime manifest completely describes assets 51 through 100', () => {
  assert.equal(RUNTIME_ASSET_MANIFEST.length, 50);
  for (let number = 51; number <= 100; number += 1) {
    const record = RUNTIME_ASSET_MANIFEST_BY_NUMBER[number];
    assert.ok(record, `asset ${number} is absent`);
    assert.equal(record.assetNumber, number);
    for (const field of REQUIRED_FIELDS) {
      assert.notEqual(record[field], undefined, `asset ${number} is missing ${field}`);
      assert.notEqual(record[field], null, `asset ${number} has null ${field}`);
    }
    assert.ok(existsSync(join(ROOT, record.glbPath)), `asset ${number} runtime GLB is absent`);
    assert.ok(existsSync(join(ROOT, record.blenderSource)), `asset ${number} Blender source is absent`);
    assert.equal(record.defaultTransform.position.length, 3);
    assert.equal(record.defaultTransform.rotation.length, 3);
    assert.equal(record.defaultTransform.scale.length, 3);
    if (number >= 61) {
      assert.ok(record.interactionSockets.includes('SOCKET_PLACEMENT'),
        `asset ${number} does not expose its placement socket`);
    }
    assert.ok(record.saveStateKey.length > 8);
    assert.ok(['hero-architecture', 'standard-interior', 'lightweight-dressing']
      .includes(record.performanceTier));
  }
});

test('all forty Sheet 7–10 assets are mounted by the running clubhouse layer', () => {
  assert.deepEqual(
    PROP_PLACEMENTS.map((placement) => placement.n),
    Array.from({ length: 40 }, (_, index) => index + 61),
  );
  for (const placement of PROP_PLACEMENTS) {
    const runtime = RUNTIME_ASSET_MANIFEST_BY_NUMBER[placement.n];
    assert.equal(runtime.placement, placement);
    assert.equal(runtime.mountType, placement.mount);
  }
});

test('movable authored furniture is attached to persisted fixture identities', () => {
  assert.deepEqual(RUNTIME_ASSET_MANIFEST_BY_NUMBER[62].placement.fixtureIds, ['backcounter']);
  assert.deepEqual(
    RUNTIME_ASSET_MANIFEST_BY_NUMBER[64].placement.fixtureIds,
    ['backshelf_n', 'backshelf_e2'],
  );
  assert.equal(RUNTIME_ASSET_MANIFEST_BY_NUMBER[62].visibilityRules.hiddenWhenFixtureStored, true);
  assert.equal(RUNTIME_ASSET_MANIFEST_BY_NUMBER[64].visibilityRules.hiddenWhenFixtureStored, true);
});

test('cleaning pickups remain adapters to the existing tool architecture', () => {
  const tools = new Set();
  for (const placement of PROP_PLACEMENTS.filter((entry) => entry.n >= 71 && entry.n <= 80)) {
    if (placement.tool) tools.add(placement.tool);
    for (const tool of placement.tools || []) tools.add(tool.tool);
    assert.match(RUNTIME_ASSET_MANIFEST_BY_NUMBER[placement.n].cleaningState.authority, /^shop\.reno/);
  }
  assert.deepEqual(
    [...tools].sort(),
    ['broom', 'cloth', 'dustpan', 'mop', 'sponge', 'spray', 'trashbag', 'vacuum', 'washer'],
  );
});

test('world and first-person animation clips are both recorded', () => {
  assert.deepEqual(
    RUNTIME_ASSET_MANIFEST_BY_NUMBER[70].animationClips.world,
    ['DisplayDoorLeft_Close', 'DisplayDoorLeft_Open', 'DisplayDoorRight_Close', 'DisplayDoorRight_Open'],
  );
  assert.ok(RUNTIME_ASSET_MANIFEST_BY_NUMBER[71].animationClips.firstPerson.includes('Vacuum_Equip'));
  assert.ok(RUNTIME_ASSET_MANIFEST_BY_NUMBER[79].animationClips.firstPerson.includes('WasherWand_TriggerDown'));
});

test('world interactions aim at authored reachable sockets', () => {
  for (const placement of PROP_PLACEMENTS.filter((entry) => entry.interaction && !entry.tool)) {
    assert.match(placement.interaction.socket || '', /^SOCKET_/u,
      `asset ${placement.n} interaction does not name an authored focus socket`);
    assert.ok(
      RUNTIME_ASSET_MANIFEST_BY_NUMBER[placement.n].interactionSockets
        .includes(placement.interaction.socket),
      `asset ${placement.n} focus socket is absent from its runtime contract`,
    );
  }
});
