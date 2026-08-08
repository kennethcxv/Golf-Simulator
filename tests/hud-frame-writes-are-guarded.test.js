// THE HUD'S PER-FRAME update() MUST NOT TOUCH THE DOM WITHOUT A REASON.
//
// `hud.js`'s `update()` runs every frame. Its own comment states the rule —
// "this runs every frame — only touch the DOM when the number actually moved" —
// and every text write obeys it. One line did not: `root.style.display` was
// assigned unconditionally, on the HUD ROOT, dirtying style resolution for the
// whole overlay subtree in order to set it to the value it already had.
//
// It matters more than it looks. Measured with tools/qa/electron-a1-hud-cost.js:
// hiding the entire DOM overlay indoors takes frames over 16.7 ms from 23.3% to
// 17.0%, so the overlay is ~6.7 of invariant 1's ~23 points — the largest single
// cause found — and it costs zero draw calls because the renderer never draws
// it. Guarding this one write took that to 5.0, reproduced twice.
//
// This test exists because the rule is a convention, and a convention with no
// check is a convention that lasts until the next hurried edit.
//
// WATCHED FAILING: with the guard removed and the bare assignment restored, the
// first assertion fails naming the line.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
// Comments quote the old line to explain the fix, so a scan that does not strip
// them matches its own explanation and can never fail.
const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

// The body of update(), from its declaration to the next top-level function.
const start = code.indexOf('function update()');
assert.ok(start >= 0, 'hud.js no longer declares update()');
const rest = code.slice(start + 'function update()'.length);
const nextFn = rest.search(/\n {2}(?:function|const [A-Za-z]+ = \()/);
const body = nextFn > 0 ? rest.slice(0, nextFn) : rest;

test('update() does not assign root.style.display on every frame', () => {
  // The guarded form assigns a variable first and writes inside an `if`. The
  // unguarded form assigns the ternary straight to the property.
  assert.doesNotMatch(body, /root\.style\.display\s*=\s*quiet\s*\?/,
    'root.style.display is assigned unconditionally in a per-frame function; '
    + 'this dirties style for the whole overlay subtree every frame. Compare the '
    + 'value first, the way every textContent write in this function already does.');
});

test('the root display write is behind a change check', () => {
  // Positive form, so deleting the write entirely does not silently "pass" the
  // negative test above.
  assert.match(body, /root\.style\.display/,
    'the HUD root must still be hidden in quiet modes — the write should be '
    + 'guarded, not removed');
  assert.match(body, /!==\s*lastRootDisplay|lastRootDisplay\s*!==/,
    'the display write must sit behind a comparison against the last value');
});

test('every textContent write in update() is still guarded', () => {
  // The convention this file already followed, pinned so the new guard is not
  // the only one and a future edit cannot quietly drop an old one.
  const writes = [...body.matchAll(/(\w+)\.textContent\s*=/g)].map((m) => m[1]);
  assert.ok(writes.length >= 2, `expected several textContent writes, found ${writes.length}`);
  for (const el of new Set(writes)) {
    // Each write must appear after some `if (` in the same function; the cheap
    // structural proxy is that the function contains a comparison mentioning a
    // `last*` cache, which is how this file has always done it.
    assert.match(body, /\blast[A-Z]\w*/,
      `${el}.textContent is written with no last-value cache in sight`);
  }
});
