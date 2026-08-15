import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// A3 (Goal 17) — THE LIGHT THAT CAME AND WENT.
//
// The ledger's reading light used to enter and leave the scene's light list as
// the book rose (`readingLight.visible = intensity > 0.001`). three bakes the
// light counts into every program's cache key, so the frame where that flag
// flipped invalidated every lit material on screen and recompiled them inside
// that frame: measured 209 -> 241 programs, 1140 -> 1509 draw calls and 5.09M
// -> 6.42M triangles in a single 1571.6 ms frame, all of it gone again the next
// frame. Press-to-ink was 1624 ms and the camera did not move at all while it
// happened.
//
// The behaviour is proven in Electron by tools/qa/electron-a3-ledger.js (press
// to ink 123 ms, worst frame 24.1 ms, camera free). This is the contract that
// stops the mechanism coming back, because it is one word.

const ledger = fs.readFileSync(
  new URL('../src/render3d/clubhouse/ledgerBook.js', import.meta.url), 'utf8',
);
// The comment above the fix QUOTES the broken line, so a naive scan finds the
// prose and reports the defect that is no longer there. Statements only.
const ledgerCode = ledger.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

test('the reading light never leaves the scene light list', () => {
  // The whole defect in one assertion: any expression here that can evaluate
  // false at runtime puts the light in and out of the list and takes the room's
  // shaders with it.
  const assignments = [...ledgerCode.matchAll(/readingLight\.visible\s*=\s*([^;]+);/g)]
    .map((m) => m[1].trim());
  assert.ok(assignments.length > 0, 'the light visibility is set somewhere');
  for (const rhs of assignments) {
    assert.equal(
      rhs, 'true',
      `readingLight.visible must be the literal true, found "${rhs}" - a light that `
      + 'comes and goes recompiles every lit material in view on the frame it changes',
    );
  }
});

test('the light is still dimmed to nothing when the book is shut', () => {
  // Keeping it in the list must not mean lighting the desk from a closed book:
  // the intensity is what animates now.
  assert.match(
    ledger,
    /readingLight\.intensity\s*=\s*lightWant \* READING_LIGHT_MAX/,
    'intensity still rides the open/close curve',
  );
  assert.match(
    ledger,
    /const lightWant = bookState === 'open' \? 1/,
    'and that curve is still zero while the book is closed',
  );
});

test('the first-visibility warm-up exists and is reachable from the scene', () => {
  assert.match(ledger, /function prewarmVisual\(renderer, camera, scene\)/,
    'the book can warm its own page faces');
  assert.match(ledger, /prewarmVisual,/, 'and it is on the API the scene calls');
  const courseScene = fs.readFileSync(
    new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8',
  );
  assert.match(
    courseScene,
    /ledgerBook\?\.prewarmVisual\?\.\(renderer, camera, scene\)/,
    'the load-time prewarm calls it, behind the veil',
  );
});
