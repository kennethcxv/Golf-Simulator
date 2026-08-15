// ITEM 28 — every em dash in anything the player READS.
//
// Code comments are explicitly exempt, so this walks string literals only, and
// skips whole-line comments. A dash inside a `//` or `*` line is prose for the
// next maintainer and stays.
//
// Run:  node tools/qa/emdash-scan.mjs           (report)
//       node tools/qa/emdash-scan.mjs --fix     (rewrite)
import fs from 'node:fs';
import path from 'node:path';

const EM = '—';
const ROOTS = ['src'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|cjs|html|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

// Find string literals on a line and report the em dashes inside them.
function literalsOn(line) {
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
      if (j < line.length) spans.push({ start: i, end: j, body });
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return spans;
}

const files = ROOTS.flatMap((r) => (fs.existsSync(r) ? walk(r) : []));
const findings = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes(EM)) continue;
  const lines = src.split('\n');
  lines.forEach((line, index) => {
    const t = line.trimStart();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    for (const span of literalsOn(line)) {
      if (!span.body.includes(EM)) continue;
      findings.push({ file, line: index + 1, text: span.body.trim().slice(0, 96) });
    }
  });
}

if (process.argv.includes('--fix')) {
  // Replace the em dash INSIDE string literals only. A dash joining two clauses
  // becomes a full stop and a capital where that reads, otherwise a comma; the
  // safe general rewrite is a comma, and the prose pass (item 29) tightens the
  // ones that want a full stop.
  const touched = new Map();
  for (const file of new Set(findings.map((f) => f.file))) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    let n = 0;
    const out = lines.map((line) => {
      const t = line.trimStart();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return line;
      const spans = literalsOn(line);
      if (!spans.some((s) => s.body.includes(EM))) return line;
      let rebuilt = '';
      let cursor = 0;
      for (const span of spans) {
        if (!span.body.includes(EM)) continue;
        rebuilt += line.slice(cursor, span.start + 1);
        const raw = line.slice(span.start + 1, span.end);
        // " — " -> ". " when the next word starts a clause, else ", "
        const fixed = raw
          .replace(/\s*—\s*/g, (m, offset, whole) => {
            n += 1;
            const after = whole.slice(offset + m.length);
            return /^[A-Z]/.test(after) ? '. ' : ', ';
          });
        rebuilt += fixed;
        cursor = span.end;
      }
      rebuilt += line.slice(cursor);
      return rebuilt;
    });
    if (n) {
      fs.writeFileSync(file, out.join('\n'));
      touched.set(file, n);
    }
  }
  console.log(`rewrote ${[...touched.values()].reduce((a, b) => a + b, 0)} em dashes in ${touched.size} files`);
} else {
  console.log(`player-facing em dashes: ${findings.length} in ${new Set(findings.map((f) => f.file)).size} files`);
  const byFile = new Map();
  for (const f of findings) byFile.set(f.file, (byFile.get(f.file) || 0) + 1);
  for (const [file, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`${String(n).padStart(5)}  ${file}`);
  }
  console.log('\nsamples:');
  for (const f of findings.slice(0, 8)) console.log(`  ${f.file}:${f.line}  ${f.text}`);
}
