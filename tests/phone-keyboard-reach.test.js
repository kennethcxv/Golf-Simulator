// C2 (Goal 20) — the phone's arrow keys must reach whatever an app renders.
//
// This is the claim Verifier 2 DISPROVED. The calls app grew actionable rows;
// the shell still believed a list view contained exactly one button ("the back
// action"), so ArrowDown computed (0 + 1 + 1) % 1 = 0 and never moved, and
// Enter clicked the only thing wearing the focus class — Back — which left the
// app. The rows worked perfectly by mouse, which is why every check I wrote
// passed: I tested the sim verbs and asserted the wiring, and nobody pressed
// the keys the phone tells you to press.
//
// The live proof is tools/qa/electron-c2-phone-keyboard.js, which drives it
// with a real keyboard. This is the cheap guard that fails the moment the shell
// goes back to assuming a list is one button.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const phone = fs.readFileSync(new URL('../src/ui/phone.js', import.meta.url), 'utf8');
const focusables = phone.slice(phone.indexOf('function focusables()'), phone.indexOf('function render()'));

test('a list view counts the rows its app rendered, not one', () => {
  assert.ok(focusables.length > 60, 'found the focusables() body');
  assert.match(focusables, /view\.startsWith\('app:'\)/,
    'list views need their own branch, or every app is stuck on Back');
  assert.match(focusables, /\.phone-list button/,
    'the count must come from the live DOM, so the shell need not know what an app renders');
  assert.match(focusables, /rows \+ 1/, 'the rows, and then Back');
  // the exact line that caused it: a flat 1 for every list view
  assert.doesNotMatch(focusables, /return 1; \/\/ list views/,
    'the flat count is back');
});

test('focus is assigned across the rows and then Back', () => {
  // Assigning by DOM order over whatever the app produced is what gives the
  // next app keyboard reach for free — the registry seam was the whole point.
  assert.match(phone, /const rowButtons = \[\.\.\.list\.querySelectorAll\('button'\)\]/);
  assert.match(phone, /const order = \[\.\.\.rowButtons, backButton\]\.filter\(Boolean\)/);
  assert.match(phone, /order\.forEach\(\(btn, index\) => btn\.classList\.toggle\('focus', index === focus\)\)/);
  // Back must no longer hard-code itself as focus 0, or it competes with row 0
  assert.doesNotMatch(phone, /phone-back \$\{focus === 0 \? 'focus' : ''\}/,
    'Back still claims focus 0 and will steal Enter from the first row');
});
