import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DRIVER_PATH = 'tools/qa/pine-hills-starter-stock-cooler-acceptance.js';
const source = fs.readFileSync(DRIVER_PATH, 'utf8');
const run = Function(`"use strict"; return (${source});`)();

test('Pine Hills stock and cooler acceptance is a runnable lock-runner callback', () => {
  assert.equal(typeof run, 'function');
  assert.match(source, /run-playwright\.cjs tools\/qa\/pine-hills-starter-stock-cooler-acceptance\.js --bootstrap/);
  assert.match(source, /PINE_HILLS_STOCK_PHASE/);
  assert.match(source, /PINE_HILLS_STOCK_ITERATION/);
  assert.match(source, /PINE_HILLS_STOCK_COOLER_OUT/);
  assert.match(source, /QA_RESULT_PATH/);
});

test('cooler and mid-restock persistence use the visible pause menu confirmations', () => {
  assert.match(source, /page\.keyboard\.press\('Escape'\)/);
  assert.match(source, /name: 'Save game', exact: true/);
  assert.match(source, /name: 'Save here', exact: true/);
  assert.match(source, /waitForOptionalDialog\('Replace slot 1\?'\)/);
  assert.match(source, /name: 'Replace and save', exact: true/);
  assert.match(source, /requireOverwrite: true/);
  assert.match(source, /name: 'Load game', exact: true/);
  assert.match(source, /name: 'Load', exact: true/);
  assert.match(source, /name: 'Load slot 1\?', exact: true/);
  assert.match(source, /Load game confirmation/);
  assert.match(source, /cooler-state-survives-pause-menu-load/);
  assert.match(source, /mid-restock-pause-load-inventory-conserved/);
  assert.doesNotMatch(source, /window\.__fw\.autosave\(/);
  assert.doesNotMatch(source, /page\.reload\(/);
  assert.doesNotMatch(source, /document\.exitPointerLock\(/);
});

test('normal-control carton and cooler evidence remains strict', () => {
  for (const contract of [
    'exactly-three-starter-cartons',
    'three-cartons-player-reachable',
    'cooler-opened-with-e',
    'cooler-closed-with-e',
    'all-three-starter-cartons-opened-and-emptied',
    'all-six-restock-groups-complete',
    'inventory-conserved-before-after',
    'two-audio-bearing-gameplay-segments-span-mid-restock-load',
  ]) assert.match(source, new RegExp(contract));
  assert.match(source, /entry\.kind === 'console:warning'/);
  assert.match(source, /PCFSoftShadowMap has been deprecated/);
});
