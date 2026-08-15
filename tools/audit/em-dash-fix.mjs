// O1 — rewrite em dashes INSIDE string literals only, across src/.
//
// ' — ' becomes ' - ' (what a person actually types); a bare '—' between word
// characters becomes '-'. Comments keep their em dashes: the sweep walks the
// same lexical states the auditor (em-dash-strings.mjs) scans with, so the
// two tools cannot disagree about what counts as a player string.
//
//   node tools/audit/em-dash-fix.mjs          # rewrite src/ in place

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(js|mjs)$/.test(entry)) yield full;
  }
}

const regexPrefix = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '']);

export function fixSource(src) {
  let out = '';
  let i = 0;
  let state = 'code';
  let inClass = false;
  let lastSig = '';
  let replaced = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    let emit = ch;
    switch (state) {
      case 'code':
        if (ch === '/' && next === '/') state = 'lc';
        else if (ch === '/' && next === '*') state = 'bc';
        else if (ch === '/' && (regexPrefix.has(lastSig)
          || /\b(?:return|typeof|case|in|of|do|else)$/.test(src.slice(Math.max(0, i - 8), i).trim()))) {
          state = 'rx'; inClass = false;
        } else if (ch === "'") state = 's1';
        else if (ch === '"') state = 's2';
        else if (ch === '`') state = 't';
        if (!/\s/.test(ch)) lastSig = ch;
        break;
      case 'lc':
        if (ch === '\n') state = 'code';
        break;
      case 'bc':
        if (ch === '*' && next === '/') { out += ch; i += 1; out += src[i]; state = 'code'; i += 1; continue; }
        break;
      case 'rx':
        if (ch === '\\') { out += ch; i += 1; out += src[i] ?? ''; i += 1; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { state = 'code'; lastSig = '/'; }
        else if (ch === '\n') state = 'code';
        break;
      case 's1': case 's2': case 't': {
        const closer = state === 's1' ? "'" : state === 's2' ? '"' : '`';
        if (ch === '\\') { out += ch; i += 1; out += src[i] ?? ''; i += 1; continue; }
        if (ch === closer) { state = 'code'; lastSig = closer; }
        else if (ch === '—') { emit = '-'; replaced += 1; }
        break;
      }
      default:
        break;
    }
    out += emit;
    i += 1;
  }
  return { out, replaced };
}

const invokedDirectly = process.argv[1]
  && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
if (invokedDirectly) {
  let files = 0;
  let total = 0;
  for (const file of walk(path.join(repo, 'src'))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('—')) continue;
    const { out, replaced } = fixSource(src);
    if (out !== src && replaced > 0) {
      writeFileSync(file, out);
      files += 1;
      total += replaced;
    }
  }
  console.log(JSON.stringify({ filesTouched: files, replacedInStrings: total }));
}
