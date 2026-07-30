// THE SEARCH FIELD MUST SURVIVE A STATUS REFRESH.
//
// Reported 2026-07-29: "I see no search bar at all. Either it did not ship or it is not
// rendering." Measured (Designs/ProShop/Greybox/data/laptop-search.json): the laptop opened,
// the status bar rendered 746 px wide with seven children, and .lt-search was not among
// them. It shipped, it was constructed, it was appended — and refreshStatus() then called
// statusbar.replaceChildren(...) with a list that omitted it, deleting it on the first
// frame. A third answer to a two-way question.
//
// Re-adding it to that list is NOT the fix: refreshStatus runs on every render, render runs
// on every keystroke in the field, and replaceChildren detaches its children — so the field
// would lose focus after one character. It sits in its own slot instead, between two that
// are rebuilt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const laptop = readFileSync(new URL('../src/ui/laptop.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// CODE ONLY. The comment above statusbar's construction quotes the call that caused the bug,
// and the first version of the check below matched that prose — a test asserting on its own
// explanation, red while the code was correct.
const laptopCode = laptop
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

test('the search field is a child of the status bar', () => {
  assert.match(laptop, /class: 'lt-search'/);
  assert.match(
    laptop,
    /const statusbar = el\('div', \{ class: 'lt-status' \}, statusLead, searchInput, statusTrail\);/,
  );
});

test('nothing ever replaces the status bar wholesale', () => {
  // This is the exact call that deleted the field. Any future refresh that reaches for the
  // whole bar takes the search field with it.
  assert.doesNotMatch(
    laptopCode,
    /statusbar\.replaceChildren/,
    'refreshing the whole status bar removes the search field',
  );
});

test('the refresh rebuilds the two slots either side of it', () => {
  const refresh = laptop.slice(
    laptop.indexOf('function refreshStatus()'),
    laptop.indexOf('function campaignOpeningCard'),
  );
  assert.ok(refresh.length > 200, 'could not locate refreshStatus');
  assert.match(refresh, /statusLead\.replaceChildren\(/);
  assert.match(refresh, /statusTrail\.replaceChildren\(/);
  assert.doesNotMatch(refresh, /searchInput/, 'the field must not be rebuilt by the refresh');
});

test('the field keeps its own state across renders', () => {
  // Created once, with its own listeners and value. Re-creating it per render would clear
  // what the player typed on the render their typing triggered.
  const construction = laptop.slice(
    laptop.indexOf("const searchInput = el('input'"),
    laptop.indexOf('const statusLead'),
  );
  assert.match(construction, /searchInput\.addEventListener\('input'/);
  assert.match(construction, /searchInput\.addEventListener\('keydown'/);
  // Typing 'w' in a search box is text, not a walk key.
  assert.match(construction, /e\.stopPropagation\(\)/);
});

test('both slots and the field are laid out, not left unstyled', () => {
  assert.match(styles, /\.lt-statusslot \{[^}]*display: flex/);
  assert.match(styles, /\.lt-statustrail \{[^}]*flex: 1 1 auto/);
  assert.match(styles, /\.lt-search \{/);
});
