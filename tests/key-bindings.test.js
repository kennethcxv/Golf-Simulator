import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BINDABLE_ACTIONS,
  DEFAULT_BINDINGS,
  actionForKey,
  bindingConflicts,
  canonicalKeyName,
  describeKey,
  isBindableKey,
  keyForAction,
  normalizeBindings,
} from '../src/core/keyBindings.js';
import { normalizePreferences } from '../src/core/preferences.js';

// N2/F2 — the one binding table. These tests pin the contract every key read
// path depends on: complete defaults, deterministic healing, and the
// preferences round trip that persistence rides on.

test('the shipped table binds every action exactly once', () => {
  const keys = BINDABLE_ACTIONS.map((action) => DEFAULT_BINDINGS[action.id]);
  assert.equal(keys.length, BINDABLE_ACTIONS.length);
  assert.ok(keys.every(Boolean), 'no action ships unbound');
  assert.equal(new Set(keys).size, keys.length, 'no two actions share a default key');
});

test('canonical key names: characters lowercase, space spelled out, events accepted', () => {
  assert.equal(canonicalKeyName('E'), 'e');
  assert.equal(canonicalKeyName(' '), 'space');
  assert.equal(canonicalKeyName('Shift'), 'shift');
  assert.equal(canonicalKeyName({ key: 'Tab' }), 'tab');
  assert.equal(canonicalKeyName(null), null);
});

test('reserved keys are refused as bindings', () => {
  assert.equal(isBindableKey('escape'), false);
  assert.equal(isBindableKey('Meta'), false);
  assert.equal(isBindableKey('k'), true);
  assert.equal(isBindableKey('space'), true);
});

test('a custom binding survives normalization; junk heals to defaults', () => {
  const healed = normalizeBindings({ interact: 'K', dirtSense: 'Escape', bogusAction: 'y' });
  assert.equal(healed.interact, 'k');
  assert.equal(healed.dirtSense, DEFAULT_BINDINGS.dirtSense, 'a reserved key reverts');
  assert.equal('bogusAction' in healed, false);
  assert.equal(healed.moveForward, 'w', 'untouched actions keep their defaults');
});

test('two actions claiming one key heal deterministically - first in table order keeps it', () => {
  const healed = normalizeBindings({ moveForward: 'k', interact: 'k' });
  assert.equal(healed.moveForward, 'k');
  assert.equal(healed.interact, DEFAULT_BINDINGS.interact);
});

test('resolution is symmetric: actionForKey inverts keyForAction', () => {
  const bindings = normalizeBindings({ interact: 'k' });
  assert.equal(keyForAction(bindings, 'interact'), 'k');
  assert.equal(actionForKey(bindings, 'k'), 'interact');
  assert.equal(actionForKey(bindings, 'K'), 'interact', 'case-insensitive');
  assert.equal(actionForKey(bindings, 'e'), null, 'the old key stops answering');
});

test('conflicts are reported, never silently resolved by the reader', () => {
  const conflicted = { ...DEFAULT_BINDINGS, carry: 'e' }; // duplicates interact
  const conflicts = bindingConflicts(conflicted);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, 'e');
  assert.deepEqual(conflicts[0].actions.sort(), ['carry', 'interact']);
});

test('preferences persist and heal the controls document round trip', () => {
  const raw = {
    controls: { bindings: { interact: 'k', run: 'CapsLock', moveForward: 'ArrowUp' } },
  };
  const normalized = normalizePreferences(raw);
  assert.equal(normalized.controls.bindings.interact, 'k');
  assert.equal(normalized.controls.bindings.run, 'capslock');
  assert.equal(normalized.controls.bindings.moveForward, 'arrowup');
  const rebuilt = normalizePreferences(JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(rebuilt.controls.bindings, normalized.controls.bindings);
});

test('keycaps read like keycaps', () => {
  assert.equal(describeKey('e'), 'E');
  assert.equal(describeKey('space'), 'Space');
  assert.equal(describeKey('arrowup'), 'Up');
  assert.equal(describeKey('shift'), 'Shift');
});
