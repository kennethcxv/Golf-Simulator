import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('manual load slots are discovered from save keys instead of optional metadata', () => {
  assert.match(mainSource, /loadDataWithStatus, listData/);
  assert.match(mainSource, /const availableSaves = listData\(\)\.catch\(\(\) => \[\]\)/);
  assert.match(mainSource, /const hasSave = keys\.includes\(slot\)/);
  assert.match(mainSource, /if \(mode === 'load'\) act\.disabled = !hasSave/);
  assert.match(mainSource, /Save found — details unavailable/);
});

test('successful load recovery notices wait until the opaque prewarm veil clears', () => {
  assert.match(mainSource, /const loadNotices = new WeakMap\(\)/);
  assert.match(mainSource, /loadNotices\.set\(loaded\.empire,/);
  assert.match(mainSource, /startGame\(st, loadNotice\)/);
  assert.match(mainSource, /veil\.hide\(\);[\s\S]*toast\(loadNotice, 'warn'\)/);
});
