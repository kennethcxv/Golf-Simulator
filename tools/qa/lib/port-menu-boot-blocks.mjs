// SECOND PASS: the if/else menu-boot blocks, matched by braces rather than by
// regex. Each of these files says "click Continue if it is enabled, otherwise
// start a new game" — which is exactly clickThroughMenu's contract, written out
// longhand and, in several cases, against menu labels that have since changed.
//
// Files whose else-branch does MORE than start a game are listed as MANUAL and
// left alone; laptop-tour.js is one (it also buys the first course).
//
// Run: node tools/qa/lib/port-menu-boot-blocks.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');
const BOOT = "const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);";

// file -> why it is safe to collapse
const TARGETS = new Map([
  ['tools/qa/customer-simulation-functional.mjs', 'else-branch is the polished New game -> Relaxed -> confirm flow'],
  ['tools/qa/customer-simulation-performance.mjs', 'else-branch is the polished New game -> Relaxed -> confirm flow'],
  ['tools/qa/customer-simulation-visual.mjs', 'else-branch is the polished New game -> Relaxed -> confirm flow'],
  ['tools/qa/structural-work-acceptance.js', 'else-branch clicks "New Empire — Relaxed", a label the menu no longer uses'],
  ['tools/qa/register-acceptance-driver.mjs', 'else-branch starts the relaxed fixture'],
  ['tools/qa/resolution-fov-performance.js', 'else-branch starts the relaxed fixture'],
]);

const report = { ported: [], skipped: [] };
for (const [rel, reason] of TARGETS) {
  const file = path.resolve(rel);
  if (!fs.existsSync(file)) { report.skipped.push({ file: rel, reason: 'missing' }); continue; }
  const source = fs.readFileSync(file, 'utf8');
  const declMatch = /([ \t]*)const\s+(\w+)\s*=\s*page\.getByText\('Continue',\s*\{\s*exact:\s*true\s*\}\)\s*;/.exec(source);
  if (!declMatch) { report.skipped.push({ file: rel, reason: 'no Continue declaration' }); continue; }
  const indent = declMatch[1];
  const ifStart = source.indexOf('if', declMatch.index + declMatch[0].length);
  const openBrace = source.indexOf('{', ifStart);
  if (ifStart < 0 || openBrace < 0) { report.skipped.push({ file: rel, reason: 'no if-block' }); continue; }
  // walk braces to the end of the if, then of any else
  let index = openBrace;
  let depth = 0;
  let end = -1;
  while (index < source.length) {
    const ch = source[index];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const after = source.slice(index + 1, index + 12);
        if (/^\s*else\b/.test(after)) {
          index = source.indexOf('{', index + 1);
          if (index < 0) break;
          continue;
        }
        end = index + 1;
        break;
      }
    }
    index += 1;
  }
  if (end < 0) { report.skipped.push({ file: rel, reason: 'unbalanced block' }); continue; }
  const next = source.slice(0, declMatch.index)
    + `${indent}${BOOT}\n${indent}await clickThroughMenu(page);`
    + source.slice(end);
  if (next.includes("getByText('Continue'")) {
    report.skipped.push({ file: rel, reason: 'a second Continue reference survives — needs a look' });
    continue;
  }
  report.ported.push({ file: rel, reason });
  if (WRITE) fs.writeFileSync(file, next);
}
console.log(JSON.stringify({ wrote: WRITE, ...report }, null, 2));
