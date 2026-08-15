// PLAYTEST 4, ITEM 1 — THE AUDITION WINNERS HAVE TO SURVIVE NORMALISATION.
//
// The owner picked four sounds. On a fresh profile the game played a DIFFERENT
// drawer, because `normalizePreferences` built `audio.sfx` from the incoming
// object alone with no fallback to the shipped defaults — the one field in that
// function that did. Every fresh profile normalised to `{}`, `settings().sfx` was
// empty, no pin was applied at boot, and each cue drew at random across its whole
// family. Measured in Electron before the fix: every family `current: NONE`, and
// `drawerOpen` played `drawer-open-2.ogg` rather than the winner.
//
// The second test is the one that keeps the fix honest. "Fall back to defaults"
// and "let the owner turn a pin off" pull against each other: the settings panel
// writes '' to clear a family, so if '' is dropped the default floods back and
// clearing silently does nothing. '' must reach the bank, which declines to pin
// a falsy option.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, normalizePreferences } from '../src/core/preferences.js';

test('a profile with no audio.sfx still carries the audition winners', () => {
  const normalised = normalizePreferences({});
  assert.deepEqual(normalised.audio.sfx, { ...DEFAULT_PREFERENCES.audio.sfx });
  // Named individually so a silent change to one winner cannot hide behind the
  // deepEqual above being updated wholesale.
  assert.equal(normalised.audio.sfx.menuButton, 'felt-tap');
  assert.equal(normalised.audio.sfx.drawerOpen, 'wood-deep');
  assert.equal(normalised.audio.sfx.cashLand, 'paper');
  assert.equal(normalised.audio.sfx.ledgerClose, 'book');
});

test('an explicitly cleared family stays cleared and does not refill from defaults', () => {
  const normalised = normalizePreferences({ audio: { sfx: { drawerOpen: '' } } });
  assert.equal(normalised.audio.sfx.drawerOpen, '', 'clearing a pin must survive normalisation');
  assert.equal(normalised.audio.sfx.menuButton, 'felt-tap', 'clearing one family must not clear the others');
});

test('a stored pin beats the shipped default', () => {
  const normalised = normalizePreferences({ audio: { sfx: { cashLand: 'coins-bright' } } });
  assert.equal(normalised.audio.sfx.cashLand, 'coins-bright');
});

test('the two re-sourced families ship unpinned, so nobody chooses for the owner', () => {
  const normalised = normalizePreferences({});
  assert.equal('ledgerTurn' in normalised.audio.sfx, false);
  assert.equal('ledgerPickup' in normalised.audio.sfx, false);
});

test('junk in the map is still rejected', () => {
  const normalised = normalizePreferences({ audio: { sfx: { drawerOpen: 7, cashLand: { nested: true }, ok: 'fine' } } });
  assert.equal(normalised.audio.sfx.drawerOpen, 'wood-deep', 'a number must not overwrite the default');
  assert.equal(normalised.audio.sfx.cashLand, 'paper', 'an object must not overwrite the default');
  assert.equal(normalised.audio.sfx.ok, 'fine');
});
