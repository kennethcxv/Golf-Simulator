// THE BOX OPENS ON E, THREE TIMES, AND NOTHING ELSE.
//
// This file replaces tests/walk-box-cutter-drag.test.js, which pinned the
// gesture it describes: equip a box cutter, then DRAG it along a seam projected
// onto the screen, at the right speed, holding the button, with a half-cut state
// persisted if you let go. Every assertion in that file passed while the player
// could not open a box — the previous session's response to "boxes cannot be
// opened" was to add a prompt explaining the gesture, which changed nothing about
// whether it could be performed.
//
// So the pin is inverted. The contract now is that the carton demands NO tool,
// exposes no drag or hold verb, and answers three presses. These are source
// assertions for the same reason the old file used them: the prop is defined
// inside a closure that cannot be constructed in Node.
//
// The live proof — real focus, real E key, real prompts — is
// tools/qa/proshop-box-open-loop.js, which walks all three presses and requires
// each prompt to name the press the player is about to make.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const clubhouseSource = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');

test('a carton demands no tool, and no prop asks for the box cutter at all', () => {
  assert.doesNotMatch(clubhouseSource, /'boxcutter'/,
    'nothing in the clubhouse may request the cutter — that request was the only '
    + 'way a player could ever hold one, so its absence is what retires the item');
  assert.doesNotMatch(clubhouseSource, /toolPathAtProgress\(b\.tape\)/,
    'the projected seam path is the drag gesture and must be gone with it');
});

test('the drag and hold verbs are gone from the carton', () => {
  assert.doesNotMatch(clubhouseSource, /drag: \(amount\) => advanceCut/);
  assert.doesNotMatch(clubhouseSource, /hold: \(dt\) => advanceCut/);
  assert.doesNotMatch(clubhouseSource, /advanceCut/,
    'and the cut-by-degrees helper with them');
  assert.doesNotMatch(clubhouseSource, /\[LMB\] drag along tape/,
    'no prompt may still instruct the player to perform it');
});

test('each press has a prompt naming that press', () => {
  assert.match(clubhouseSource, /\[E\] tear the tape open/);
  assert.match(clubhouseSource, /\[E\] open the other flap/);
  assert.match(clubhouseSource, /\[E\] take an armful/);
});

test('the prompt and the action read the same decision', () => {
  // A prompt offering a step the action will refuse is its own recurring bug.
  // Both sides go through nextBoxStep, so they cannot disagree about what E does.
  assert.match(clubhouseSource, /switch \(nextBoxStep\(b, \{ canUnpack: true, handsFull \}\)\)/);
  assert.match(clubhouseSource, /const step = beginBoxStep\(state, b\.id\);/);
});

test('the flap animation is bounded to the phase its press started', () => {
  // Unbounded, one press ran the whole carton open — silently restoring the
  // single-press behaviour this replaced, with the prompt still promising two
  // more steps. The bound is the difference between three presses and one.
  assert.match(clubhouseSource, /openFlap\(state, id, dt \* 1\.55, \{ stopAfterPhase: target \}\)/);
});

test('each press gets its own sound, because each is its own mechanical event', () => {
  // 2026-07-29: the two generic cues became the dedicated carton pair — adhesive stick-slip
  // for the tearing press, board flex for the folding press. tests/box-open-sound.test.js
  // holds what is inside them; this holds only that the two presses stay distinct.
  assert.match(clubhouseSource, /sfx\(step\.tore \? 'boxTapeTear' : 'boxFlapFold'\)/);
});
