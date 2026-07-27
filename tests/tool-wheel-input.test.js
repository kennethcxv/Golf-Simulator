import test from 'node:test';
import assert from 'node:assert/strict';
import { nextAvailableToolIndex, toolShortcutIndex } from '../src/ui/toolWheel.js';

test('tool wheel letter shortcuts select the visible binding', () => {
  const entries = [
    { id: null, shortcut: 'X' },
    { id: 'vacuum', shortcut: 'V' },
    { id: 'mop', shortcut: 'M' },
  ];
  assert.equal(toolShortcutIndex(entries, 'v'), 1);
  assert.equal(toolShortcutIndex(entries, 'M'), 2);
  assert.equal(toolShortcutIndex(entries, 'q'), -1);
});

test('tool wheel scrolling wraps and skips unavailable tools', () => {
  const entries = [
    { id: null },
    { id: 'locked', available: false },
    { id: 'vacuum' },
    { id: 'mop' },
  ];
  assert.equal(nextAvailableToolIndex(entries, 0, 1), 2);
  assert.equal(nextAvailableToolIndex(entries, 2, 1), 3);
  assert.equal(nextAvailableToolIndex(entries, 3, 1), 0);
  assert.equal(nextAvailableToolIndex(entries, 0, -1), 3);
});
