import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DRIVER_PATH = 'tools/qa/pine-hills-legacy-save-migration-acceptance.js';
const source = fs.readFileSync(DRIVER_PATH, 'utf8');
const run = Function(`"use strict"; return (${source});`)();

test('Pine Hills legacy-save browser matrix is a runnable lock-runner callback', () => {
  assert.equal(typeof run, 'function');
  assert.match(source, /run-playwright\.cjs tools\/qa\/pine-hills-legacy-save-migration-acceptance\.js/);
  assert.match(source, /PINE_HILLS_LEGACY_SAVE_OUT/);
  assert.match(source, /QA_RESULT_PATH/);
  assert.match(source, /result\.json/);
});

test('matrix names the four locked migration cases exactly once', () => {
  const expected = [
    'pre-opening-legacy',
    'already-opened-legacy',
    'custom-name-legacy',
    'already-furnished-current',
  ];
  for (const id of expected) {
    assert.equal(source.split(`id: '${id}'`).length - 1, 1, id);
  }
  assert.match(source, /historical:\s*true/);
  assert.match(source, /historical:\s*false/);
});

test('fixture and replay use production storage plus visible Continue and pause-menu slot controls', () => {
  assert.match(source, /Empire\.newEmpire\(/);
  assert.match(source, /Empire\.buyProperty\(/);
  assert.match(source, /Empire\.empireSnapshot\(/);
  assert.match(source, /Storage\.saveData\('autosave', raw\)/);
  assert.match(source, /getByText\('Continue', \{ exact: true \}\)\.first\(\)/);
  assert.match(source, /\.menu-action-label/);
  assert.match(source, /page\.keyboard\.press\('Escape'\)/);
  assert.match(source, /name: 'Save game', exact: true/);
  assert.match(source, /name: 'Save here', exact: true/);
  assert.match(source, /name: 'Load game', exact: true/);
  assert.match(source, /name: 'Load', exact: true/);
  assert.match(source, /name: 'Load slot 1\?', exact: true/);
  assert.match(source, /Load game confirmation/);
  assert.doesNotMatch(source, /window\.__fw\.autosave\(/);
  assert.doesNotMatch(source, /page\.reload\(/);
  assert.doesNotMatch(source, /document\.exitPointerLock\(/);
  assert.doesNotMatch(source, /\.deserializeEmpire(?:WithReport)?\(/);
});

test('acceptance retains strict migration, inventory, visual, and diagnostic evidence', () => {
  for (const contract of [
    'custom-and-default-names',
    'furnished-fixtures-placed',
    'single-runtime-asset-instance',
    'inventory-authority-preserved',
    'starter-entitlement-no-loss-or-duplication',
    'inventory-projection-conserved',
    'starter-carton-specs-exact',
    'existing-starter-cartons-preserved',
    'generic-cleanup-not-redirtied',
    'reputation-no-replay',
    'paid-order-preserved',
    'obsolete-order-retired',
    'idempotence:runtime-snapshot',
    'diagnostics:console-errors',
    'diagnostics:page-errors',
    'evidence:screenshot-count',
  ]) assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /matrix\.length \* 4/);
});

test('legacy expectations preserve authority while allowing only the missing starter entitlement', () => {
  assert.match(source, /qa-pine-hills-legacy-sale-/);
  assert.match(source, /to: Inventory\.INVENTORY_STAGE\.SOLD/);
  assert.match(source, /actual\[field\] < baseline\[field\]/);
  assert.match(source, /Math\.max\(\s*baselinePresent,/);
  assert.match(source, /actualPresent !== expectedPresent/);
  assert.match(source, /actual\.shelfProjection !== actual\.shelf/);
  assert.match(source, /actual\.backProjection !== actual\.reserve/);
  assert.doesNotMatch(source, /same\(snapshot\.stock, expected\.stock\)/);
  assert.doesNotMatch(source, /same\(snapshot\.starterCartons, expected\.starterCartons\)/);
});

test('simulation is frozen before slow asset readiness waits on both load passes', () => {
  const firstLoad = source.indexOf("phase = `${definition.id}:first-load`");
  const firstFreeze = source.indexOf('await freezeRuntimeSoon();', firstLoad);
  const firstWait = source.indexOf('await waitForRuntime();', firstLoad);
  assert.ok(firstLoad >= 0 && firstFreeze > firstLoad && firstFreeze < firstWait);

  const manualLoad = source.indexOf('async function pauseMenuLoadSlotOne');
  const replayFreeze = source.indexOf('await freezeRuntimeSoon();', manualLoad);
  const replayWait = source.indexOf('await waitForRuntime();', manualLoad);
  assert.ok(manualLoad >= 0 && replayFreeze > manualLoad && replayFreeze < replayWait);
});
