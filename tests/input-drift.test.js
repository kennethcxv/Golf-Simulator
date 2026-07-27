// The course map must be stationary until the player deliberately moves it.
//
// Two measured mechanisms sent the overview camera sliding right forever:
//   A. a movement key still physically down when the map opened kept driving the camera
//   B. `held.delete(e.key)` was case-sensitive, so a key released while Shift (run) was held
//      arrived as 'D' and never deleted 'd' — stranding it in the set for the rest of the
//      session. Chrome reports KeyboardEvent.key against the live modifier state, so this
//      happens every time a player lets go of a movement key mid-sprint.
//
// Both are input-state bugs, so they are fixed — and pinned — in the input layer.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHeldKeys, overviewCameraDelta, OVERVIEW_KEYS, isTextEntryTarget,
} from '../src/core/heldKeys.js';

test('a key released while Shift is held still clears (the stranded-key bug)', () => {
  const held = createHeldKeys(OVERVIEW_KEYS);
  held.down('d', false);
  assert.equal(held.has('d'), true, 'strafing right');
  // player breaks into a run, then lets go of D — Chrome delivers keyup{key:'D'}
  held.up('D');
  assert.equal(held.has('d'), false, 'the key must not be stranded by its shifted spelling');
  assert.equal(held.size, 0);
});

test('a shifted keydown registers as the same physical key', () => {
  const held = createHeldKeys(OVERVIEW_KEYS);
  held.down('D', false); // pressed while running
  assert.equal(held.has('d'), true);
  held.up('d');
  assert.equal(held.size, 0);
});

test('opening the map clears whatever was down, and auto-repeat cannot resurrect it', () => {
  const held = createHeldKeys(OVERVIEW_KEYS);
  held.down('d', false); // walking right as the player reaches for the map
  held.clear(); // <- the mode transition
  assert.equal(held.size, 0);

  // the key is still physically down, so the browser keeps firing repeat keydowns.
  held.down('d', true);
  held.down('d', true);
  assert.equal(held.has('d'), false, 'a held-over key must not drive the new camera');

  // ...but a deliberate fresh press does move the map.
  held.down('d', false);
  assert.equal(held.has('d'), true, 'fresh input still works');
});

test('auto-repeat on a genuinely held key is harmless', () => {
  const held = createHeldKeys(OVERVIEW_KEYS);
  held.down('a', false);
  held.down('a', true); // the browser repeating while the player holds it
  assert.equal(held.has('a'), true);
  held.up('a');
  assert.equal(held.has('a'), false);
});

test('keys the overview camera does not use are never tracked', () => {
  const held = createHeldKeys(OVERVIEW_KEYS);
  held.down('z', false);
  held.down('Shift', false);
  assert.equal(held.size, 0);
});

test('an empty key set produces exactly zero camera movement', () => {
  const held = createHeldKeys(OVERVIEW_KEYS);
  const d = overviewCameraDelta(held, 16.7);
  assert.equal(d.panX, 0);
  assert.equal(d.panY, 0);
  assert.equal(d.orbit, 0);
  assert.equal(d.moving, false);
});

test('the reported defect: no drift after a stranded key + a map open', () => {
  const held = createHeldKeys(OVERVIEW_KEYS);
  held.down('d', false);
  held.up('D'); // released mid-run — this is what used to strand it
  held.clear(); // the map opens
  // simulate a second of frames with the player's hands off the keyboard
  let total = 0;
  for (let i = 0; i < 60; i++) total += Math.abs(overviewCameraDelta(held, 16.7).panX);
  assert.equal(total, 0, 'the map must not move on its own');
});

test('deliberate input still pans, and in the right direction', () => {
  const held = createHeldKeys(OVERVIEW_KEYS);
  held.down('d', false);
  const d = overviewCameraDelta(held, 16.7);
  assert.ok(d.panX !== 0, 'D pans the map');
  assert.equal(d.moving, true);
  const left = createHeldKeys(OVERVIEW_KEYS);
  left.down('a', false);
  assert.equal(Math.sign(overviewCameraDelta(left, 16.7).panX), -Math.sign(d.panX), 'A and D oppose');
});

// Rule 3: the overview camera keys are plain letters, so typing into any form
// control used to drive the camera. Naming a course "Wasserman" in the editor's
// Save dialog panned the map on w, a and s.
test('keys typed into form controls are text, not camera input', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea', 'select']) {
    assert.equal(isTextEntryTarget({ tagName: tag }), true, `${tag} should swallow the key`);
  }
  assert.equal(isTextEntryTarget({ isContentEditable: true, tagName: 'DIV' }), true);
});

test('keys pressed over the world still reach the camera', () => {
  for (const tag of ['CANVAS', 'DIV', 'BUTTON', 'BODY']) {
    assert.equal(isTextEntryTarget({ tagName: tag }), false, `${tag} must not swallow the key`);
  }
  assert.equal(isTextEntryTarget(null), false);
  assert.equal(isTextEntryTarget(undefined), false);
  assert.equal(isTextEntryTarget({}), false);
});

test('a key released while a field has focus still clears', () => {
  // Only keydown is filtered. If focus moves into a field mid-hold, the keyup
  // must still clear the key or it stays stranded down — the exact drift bug
  // rule 1 exists to prevent, arriving by a different route.
  const keys = createHeldKeys(OVERVIEW_KEYS);
  keys.down('d', false);
  assert.equal(keys.has('d'), true);
  keys.up('d'); // dispatched with an INPUT target; keyup is never filtered
  assert.equal(keys.has('d'), false, 'a stranded key pans the overview forever');
});
