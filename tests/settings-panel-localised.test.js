// G5 — THE SETTINGS SCREEN READS IN THE PLAYER'S LANGUAGE.
//
// "Item 18: the t() migration. Not the locales."
//
// Report 14 measured the whole codebase at 1,551 hardcoded player strings
// against 59 going through t(), and declined the migration as too large to do
// safely in one pass. That was an honest measurement and a reasonable decline,
// but it left the WORST surface untranslated: the settings screen is where a
// player goes to change the language, and it was asking them to do that in
// English.
//
// So that surface is migrated, and this holds it. It is a guard, not a survey:
// it fails when a NEW hardcoded player string appears in settingsPanel.js, so
// the migration cannot quietly unwind.
//
// WHAT IS ALLOWED TO BE A LITERAL, and why each one is not player copy:
//   * CSS classes, element tags, attribute names, preference paths, action ids
//   * On/Off style toggle words that already come from t() at the call site
//   * Anything inside a comment
// The check is deliberately narrow — a sentence of prose, in quotes, reaching a
// `text:`, `message:`, `label` or `row(...)` argument. A broad "no capitalised
// strings anywhere" rule would flag half the file and be switched off.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { englishKeys, t, setLocale } from '../src/core/i18n.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PANEL = path.join(ROOT, 'src/ui/settingsPanel.js');

// strip comments so a sentence in a note is never mistaken for copy
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

// A player-facing literal: a quoted string of at least two words containing a
// lowercase letter, sitting where the panel puts copy.
function hardcodedCopy(source) {
  const code = withoutComments(source);
  const hits = new Set();
  const patterns = [
    /\btext:\s*'([^']{6,})'/g,
    /\bmessage:\s*'([^']{6,})'/g,
    /\b(?:row|section)\(\s*'([^']{6,})'/g,
    /\b(?:row|section)\(\s*[^,]+,\s*'([^']{6,})'/g,
    /\bdescription\(\s*'([^']{6,})'/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const value = match[1];
      if (!/[a-z]/.test(value)) continue; // ALL CAPS is a token, not a sentence
      if (!/\s/.test(value)) continue; // one word is a class or an id
      if (/^[a-z-]+$/.test(value)) continue; // kebab class name
      hits.add(value);
    }
  }
  return [...hits];
}

test('the guard can see a hardcoded string when there is one (control)', () => {
  // THE CONTROL. Without it this test passes on any regex that matches nothing,
  // which is exactly how a lint gets to be decorative.
  const planted = "el('div', { text: 'Reading the display now' });";
  assert.deepEqual(hardcodedCopy(planted), ['Reading the display now']);
  // ...and it does not flag the things that are allowed
  assert.deepEqual(hardcodedCopy("el('div', { class: 'setting-row' });"), []);
  assert.deepEqual(hardcodedCopy("// text: 'this is a comment and not copy'"), []);
  assert.deepEqual(hardcodedCopy("el('span', { text: 'EXIT' });"), []);
});

test('the settings panel has no hardcoded player copy left', () => {
  const source = fs.readFileSync(PANEL, 'utf8');
  assert.deepEqual(hardcodedCopy(source), [], 'strings the settings screen cannot translate');
});

test('every key the panel asks for exists in English', () => {
  const source = fs.readFileSync(PANEL, 'utf8');
  const keys = [...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 40, `expected the panel to be translated, found ${keys.length} keys`);
  const known = new Set(englishKeys());
  const missing = keys.filter((key) => !known.has(key));
  assert.deepEqual(missing, [], 'keys the English table does not define');
});

test('a key with no translation still draws English rather than the key', () => {
  setLocale('ja'); // registered, empty table
  const drawn = t('settings.reset.button');
  assert.equal(drawn, 'Reset to defaults');
  setLocale('en');
});
