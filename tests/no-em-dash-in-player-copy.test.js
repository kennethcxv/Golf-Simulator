// ITEM 28 — "Remove every em dash from anything the player reads: prompts,
// toasts, menus, laptop, item text, errors. Not code comments."
//
// The exemption is the whole difficulty: src/ carries 1,771 em dashes and all
// but two of them were prose written for the next maintainer. So this walks
// STRING LITERALS only, and skips both line comments and block comments —
// including the continuation lines of a block comment, which do not start with
// a star and fooled the first version of this scan into reporting eleven false
// hits in styles.css.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const EM = '—';
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|cjs|html|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

// String literals on one line, with escapes honoured.
export function literalsOn(line) {
  const spans = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      let body = '';
      while (j < line.length) {
        if (line[j] === '\\') { body += line[j + 1] ?? ''; j += 2; continue; }
        if (line[j] === quote) break;
        body += line[j];
        j += 1;
      }
      if (j < line.length) spans.push(body);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return spans;
}

function scan(root) {
  const found = [];
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes(EM)) continue;
    let inBlock = false;
    src.split('\n').forEach((line, index) => {
      const t = line.trimStart();
      const wasInBlock = inBlock;
      const opens = line.lastIndexOf('/*');
      const closes = line.lastIndexOf('*/');
      if (opens >= 0 && opens > closes) inBlock = true;
      else if (closes >= 0 && closes > opens) inBlock = false;
      if (wasInBlock || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const body of literalsOn(line)) {
        if (body.includes(EM)) found.push(`${file}:${index + 1}  ${body.trim().slice(0, 90)}`);
      }
    });
  }
  return found;
}

test('the em-dash scan can actually see one', () => {
  // The control. A scan that reports zero because it cannot parse a string
  // literal is indistinguishable from a clean repo, and this whole item is
  // about not trusting a green result on its own.
  assert.deepEqual(
    literalsOn(`const s = "clean"; const t = 'has ${EM} one';`).filter((b) => b.includes(EM)).length,
    1,
  );
  assert.equal(literalsOn('// a comment ' + EM + ' with a dash').length, 0);
});

test('no em dash appears in any string the player reads', () => {
  const found = scan(path.resolve('src'));
  assert.deepEqual(found, [], `player-facing em dashes:\n${found.join('\n')}`);
});
