// O1 — find every em dash the PLAYER can read.
//
// Comments keep their em dashes; the sweep is about strings that reach the
// screen: prompts, toasts, menus, laptop copy, item descriptions, tooltips,
// error messages, canvas-drawn text. This walks src/, strips comments, and
// reports every remaining string literal (or template) containing U+2014,
// with file:line and the literal itself.
//
//   node tools/audit/em-dash-strings.mjs             # list hits, exit 1 if any
//   node tools/audit/em-dash-strings.mjs --count     # per-file counts only
//
// Negative control: run against a pre-fix revision (git show > tmp; --file) —
// an auditor that reports zero hits before the fix is broken.
//
//   node tools/audit/em-dash-strings.mjs --file <path>   # audit one file

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EM = '—';

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(js|mjs)$/.test(entry)) yield full;
  }
}

// Token-ish scan that tracks comment and string state so an em dash in a
// comment never counts and one in a string always does. Template literals
// count including their expressions' surrounding text. Regex literals get a
// real state: without one, the quote inside `replace(/'/g, …)` opens a phantom
// string that swallows real code (the first run's audio.js false positive).
export function emDashStringHits(source) {
  const hits = [];
  let line = 1;
  let i = 0;
  const n = source.length;
  let state = 'code'; // code | line-comment | block-comment | single | double | template | regex
  let literalStart = 0;
  let literalLine = 0;
  let hasEm = false;
  let inCharClass = false;
  let lastSignificant = '';
  const push = (end) => {
    if (hasEm) hits.push({ line: literalLine, literal: source.slice(literalStart, end + 1).slice(0, 160) });
    hasEm = false;
  };
  // `/` after these characters (or at file start) begins a regex, not division.
  // Identifier characters are deliberately NOT in this set — `len/2` is
  // division — and the keyword case (`return /…/`) is the word check below.
  const regexPrefix = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '']);
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '\n') line += 1;
    switch (state) {
      case 'code':
        if (ch === '/' && next === '/') { state = 'line-comment'; i += 1; }
        else if (ch === '/' && next === '*') { state = 'block-comment'; i += 1; }
        else if (ch === '/' && (regexPrefix.has(lastSignificant) || /\b(?:return|typeof|case|in|of|do|else)$/.test(source.slice(Math.max(0, i - 8), i).trim()))) {
          state = 'regex'; inCharClass = false;
        } else if (ch === "'") { state = 'single'; literalStart = i; literalLine = line; hasEm = false; }
        else if (ch === '"') { state = 'double'; literalStart = i; literalLine = line; hasEm = false; }
        else if (ch === '`') { state = 'template'; literalStart = i; literalLine = line; hasEm = false; }
        if (!/\s/.test(ch)) lastSignificant = ch;
        break;
      case 'regex':
        if (ch === '\\') i += 1;
        else if (ch === '[') inCharClass = true;
        else if (ch === ']') inCharClass = false;
        else if (ch === '/' && !inCharClass) { state = 'code'; lastSignificant = '/'; }
        else if (ch === '\n') { state = 'code'; } // not a regex after all; bail safely
        break;
      case 'line-comment':
        if (ch === '\n') state = 'code';
        break;
      case 'block-comment':
        if (ch === '*' && next === '/') { state = 'code'; i += 1; }
        break;
      case 'single':
        if (ch === '\\') i += 1;
        else if (ch === EM) hasEm = true;
        else if (ch === "'") { push(i); state = 'code'; }
        break;
      case 'double':
        if (ch === '\\') i += 1;
        else if (ch === EM) hasEm = true;
        else if (ch === '"') { push(i); state = 'code'; }
        break;
      case 'template':
        if (ch === '\\') i += 1;
        else if (ch === EM) hasEm = true;
        else if (ch === '`') { push(i); state = 'code'; }
        break;
      default:
        break;
    }
    i += 1;
  }
  return hits;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
if (invokedDirectly) {
  const fileArg = process.argv.indexOf('--file');
  const targets = fileArg >= 0
    ? [process.argv[fileArg + 1]]
    : [...walk(path.join(repo, 'src'))];
  const countOnly = process.argv.includes('--count');
  let total = 0;
  const perFile = [];
  for (const file of targets) {
    const hits = emDashStringHits(readFileSync(file, 'utf8'));
    if (!hits.length) continue;
    total += hits.length;
    const rel = path.relative(repo, file).replace(/\\/g, '/');
    perFile.push({ file: rel, count: hits.length });
    if (!countOnly) {
      for (const h of hits) console.log(`${rel}:${h.line}: ${h.literal}`);
    }
  }
  if (countOnly) {
    perFile.sort((a, b) => b.count - a.count);
    for (const row of perFile) console.log(`${String(row.count).padStart(4)}  ${row.file}`);
  }
  console.log(`\n${total} player-string em dash${total === 1 ? '' : 'es'} across ${perFile.length} files`);
  process.exit(total ? 1 : 0);
}
