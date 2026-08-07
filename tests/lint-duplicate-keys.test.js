// G1 — THE DUPLICATE KEY, CAUGHT BY THE SUITE.
//
// "28 instrument faults and no linter. It would have caught the duplicate
// customers key that killed two drivers silently."
//
// A duplicate key in an object literal is LEGAL JavaScript. Nothing throws,
// nothing warns; the second one silently wins and the first is dead code that
// looks alive. That is exactly the shape of the faults this project keeps
// finding: something that reads correct, runs, and means nothing.
//
// This session hit it twice more before this file existed:
//   * src/data/cleaningTools.js declared `tone:` twice on the pressure washer.
//     The first — a low, broad pressurised hit, with a comment explaining it —
//     was overwritten by a wetter, quieter one and had never been heard.
//   * A script of mine gave DEFAULT_PREFERENCES.display two `postProcessing`
//     keys while editing the quality presets.
//
// NO NEW DEPENDENCY. Adding eslint is not this brief's call to make and an
// install may not be available, so this is a scanner: strip comments, strings,
// templates and regex literals, then walk the braces tracking which are object
// literals and which are blocks, and collect `key:` at each object's own depth.
//
// IT IS DELIBERATELY CONSERVATIVE. Anything it cannot read confidently it
// SKIPS rather than guesses at, because a lint that cries wolf gets switched
// off. What it must never do is miss a real one, so it is asserted against
// fixtures carrying known duplicates before it is trusted on the tree.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Replace every comment, string, template and regex body with spaces of the
// same length, so offsets and line numbers survive.
function blankLiterals(source) {
  const out = source.split('');
  let i = 0;
  const n = source.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  // a `/` starts a regex only where a value may begin
  const regexAllowedAfter = /[=(,:[!&|?{};+\-*%~^<>]|return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await$/;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      let j = i + 2;
      while (j < n && source[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++;
      blank(i, Math.min(n, j + 2)); i = j + 2; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c) { if (source[j] === '\\') j++; j++; }
      blank(i, Math.min(n, j + 1)); i = j + 1; continue;
    }
    if (c === '`') {
      // template literals nest ${ }, and those can contain more templates
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === '$' && source[j + 1] === '{') { depth++; j += 2; continue; }
        if (source[j] === '}' && depth > 0) { depth--; j++; continue; }
        if (source[j] === '`' && depth === 0) break;
        j++;
      }
      blank(i, Math.min(n, j + 1)); i = j + 1; continue;
    }
    if (c === '/') {
      const before = source.slice(Math.max(0, i - 12), i).trimEnd();
      if (regexAllowedAfter.test(before) || before === '') {
        let j = i + 1;
        let inClass = false;
        while (j < n && source[j] !== '\n') {
          if (source[j] === '\\') { j += 2; continue; }
          if (source[j] === '[') inClass = true;
          else if (source[j] === ']') inClass = false;
          else if (source[j] === '/' && !inClass) break;
          j++;
        }
        if (j < n && source[j] === '/') { blank(i, j + 1); i = j + 1; continue; }
      }
    }
    i++;
  }
  return out.join('');
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

// Walk the braces. A `{` is an OBJECT LITERAL if the last meaningful character
// before it is one of `=(,:[?&|` or a fat arrow — otherwise it is a block, a
// class body or a function body and its `label:` is a labelled statement.
export function findDuplicateKeys(source) {
  const code = blankLiterals(source);
  const stack = [];
  const found = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '{') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(code[j])) j--;
      const prev = j >= 0 ? code[j] : '';
      const prev2 = j >= 1 ? code[j - 1] : '';
      const isObject = '=(,:[?&|'.includes(prev) || (prev === '>' && prev2 === '=');
      stack.push(isObject ? { keys: new Map(), ternary: 0 } : null);
      continue;
    }
    if (c === '}') { stack.pop(); continue; }
    const frame = stack[stack.length - 1];
    if (!frame) continue;
    // A TERNARY'S COLON IS NOT A KEY, and this is what the first version got
    // wrong: `selected: a === b ? true : null` reads as a key `true` followed by
    // a colon, so every conditional property in the tree reported `true`, `null`
    // or `undefined` as a duplicate. Count the `?`s owed a `:` at this depth and
    // spend them before believing a colon.
    if (c === '?' && code[i + 1] !== '.' && code[i + 1] !== '?') { frame.ternary++; continue; }
    if (c === ':' && frame.ternary > 0) { frame.ternary--; continue; }
    // a comma at this depth ends the property, and with it any unmatched `?`
    if (c === ',') { frame.ternary = 0; continue; }
    const top = frame.keys;
    // a key is an identifier or a quoted name (already blanked, so only bare
    // identifiers are readable) followed by a colon, at this object's own depth
    if (!/[A-Za-z_$]/.test(c)) continue;
    if (i > 0 && /[A-Za-z0-9_$.]/.test(code[i - 1])) continue;
    let j = i;
    while (j < code.length && /[A-Za-z0-9_$]/.test(code[j])) j++;
    const name = code.slice(i, j);
    let k = j;
    while (k < code.length && /\s/.test(code[k])) k++;
    if (code[k] !== ':') { i = j - 1; continue; }
    // ...and a colon that a `?` is still owed belongs to that `?`
    if (frame.ternary > 0) { frame.ternary--; i = k; continue; }
    // `default:` and `case x:` inside a switch, and `a ? b : c`, are not keys.
    // A ternary's colon is preceded by a `?` earlier on the line, which the
    // object-literal test above already excludes at this depth.
    if (name === 'default' || name === 'case') { i = j - 1; continue; }
    if (top.has(name)) {
      found.push({ key: name, first: top.get(name), second: lineOf(source, i) });
    } else {
      top.set(name, lineOf(source, i));
    }
    i = k;
  }
  return found;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

// ---- the scanner must be proved before it is trusted -----------------------

test('the duplicate-key scanner catches the real ones it was written for', () => {
  // The exact shape of the pressure washer's two `tone:` declarations.
  const washer = `
    export const TOOLS = {
      washer: {
        id: 'washer',
        // a pressurised hit, low and broad
        tone: { startHz: 900, stopHz: 520 },
        // wetter and rounder than the cloth
        tone: { startHz: 1900, stopHz: 1150 },
        audio: { loop: 'washerLoop' },
      },
    };`;
  const hits = findDuplicateKeys(washer);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].key, 'tone');

  // ...and the one a script of mine introduced, nested two objects deep.
  const prefs = `
    export const DEFAULT = Object.freeze({
      display: Object.freeze({
        quality: 'high',
        postProcessing: true,
        renderScale: 1,
        shadowQuality: 'medium',
        postProcessing: true,
        resolution: 'native',
      }),
    });`;
  assert.equal(findDuplicateKeys(prefs).map((h) => h.key).join(), 'postProcessing');

  // and the one the brief names
  const customers = `const model = { golfers: [], customers: 1, staff: 0, customers: 2 };`;
  assert.equal(findDuplicateKeys(customers).map((h) => h.key).join(), 'customers');
});

test('the scanner does not cry wolf on the things that are not duplicate keys', () => {
  // Same key at DIFFERENT depths is fine, and extremely common here.
  assert.deepEqual(findDuplicateKeys('const a = { x: { color: 1 }, y: { color: 2 } };'), []);
  // Labelled statements, switch cases and ternaries are not object keys.
  assert.deepEqual(findDuplicateKeys(`
    function f(v) {
      outer: for (;;) { break outer; }
      switch (v) { case 1: return 1; default: return 0; }
      const t = v ? 1 : 2;
      outer2: for (;;) { break outer2; }
      return t;
    }`), []);
  // A key that only LOOKS repeated because it appears in a string, a comment,
  // a template or a regex.
  assert.deepEqual(findDuplicateKeys(`
    const a = {
      tone: 1,
      /* tone: 2, */
      label: 'tone: 3',
      hint: \`tone: 4\`,
      match: /tone:/,
    };`), []);
  // Object methods and shorthand are not colon keys at all.
  assert.deepEqual(findDuplicateKeys('const a = { run() {}, run2() {}, x, y };'), []);
  // A class body is not an object literal.
  assert.deepEqual(findDuplicateKeys('class C { get x() { return 1; } set x(v) {} }'), []);
});

test('no object literal in src/ declares the same key twice', () => {
  const files = walk(path.join(ROOT, 'src'));
  assert.ok(files.length > 40, `expected a real tree, found ${files.length} files`);
  const offences = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const hit of findDuplicateKeys(source)) {
      offences.push(`${path.relative(ROOT, file)}:${hit.second} - '${hit.key}' was already set on line ${hit.first}`);
    }
  }
  assert.deepEqual(offences, [], 'duplicate object keys');
});
