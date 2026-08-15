// F3 and F4 (Goal 20) — the ledger's keys.
//
// These are source assertions, and the reason is worth stating rather than
// apologising for: the ledger's key handler is installed inside enterLedger()
// on a live clubhouse with a book mesh in hand, so there is no seam a headless
// test can reach without standing up the whole 3D scene. What CAN be pinned
// headlessly is the thing that actually regressed: which bindings the handler
// branches on, and what the footer teaches. Both faults in the brief were of
// exactly that kind -- a branch nobody meant to leave in, and a footer naming
// the wrong key. An Electron driver still owns "does pressing Q shut it".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
// the ledger key handler, from its declaration to the click handler below it
const handler = main.slice(
  main.indexOf('ledgerKeyHandler = (event) => {'),
  main.indexOf('ledgerClickHandler = (event) => {'),
);

test('F3: Q closes the book, and the footer teaches Q rather than Esc', () => {
  assert.ok(handler.length > 200, 'found the ledger key handler');
  assert.match(handler, /key === 'escape' \|\| action === 'dirtSense'/,
    'the close branch must accept the dirtSense binding (Q)');
  // the footer is what the player reads, so it is the half that must not lie
  assert.match(main, /key\('dirtSense', 'Q'\)\} put the book away/);
  assert.match(main, /key\('dirtSense', 'Q'\)\} put it back/);
  assert.doesNotMatch(main, /Esc put the book away/, 'the footer still teaches Esc');
  assert.doesNotMatch(main, /Esc put it back/, 'the footer still teaches Esc');
  // and setControlLabels must hand the book the same key the footer shows
  assert.doesNotMatch(main, /close: 'Esc',/, "the book's own label still says Esc");
});

test('F4: only E turns forward, and D does nothing in the book', () => {
  assert.match(handler, /action === 'interact'/, 'E must still turn forward');
  assert.doesNotMatch(handler, /action === 'moveRight'/,
    'the moveRight binding (D) must not turn pages: E is the forward key');
  // A still turns BACK, which is the direction E cannot express
  assert.match(handler, /action === 'moveLeft'/);
  // the arrows are the pair nobody has to be taught
  assert.match(handler, /key === 'arrowright'/);
  assert.match(handler, /key === 'arrowleft'/);
});
