import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('manual load slots inspect save recovery independently from optional metadata', () => {
  assert.match(mainSource, /inspectData, loadDataWithStatus, saveData, summarizeSave/);
  assert.match(mainSource, /Promise\.all\(\[inspectData\(scopedKey\(slot\), SAVE_LIMITS\), inspectData\(scopedKey\(`\$\{slot\}-meta`\)\)\]\)/);
  assert.match(mainSource, /record\.data \? summarizeSave\(record\.data, metadata\.data\) : null/);
  assert.match(mainSource, /action\.disabled = mode === 'load' && !\['ok', 'recovered'\]\.includes\(record\.status\)/);
  assert.match(mainSource, /Unreadable - saving here will preserve the damaged copy as a backup/);
});

test('successful load recovery notices wait until the opaque prewarm veil clears', () => {
  assert.match(mainSource, /const loadNotices = new WeakMap\(\)/);
  assert.match(mainSource, /loadNotices\.set\(loaded\.empire,/);
  assert.match(mainSource, /startGame\(st, loadNotice\)/);
  assert.match(mainSource, /veil\.hide\(\);[\s\S]*toast\(loadNotice, 'warn'\)/);
});
