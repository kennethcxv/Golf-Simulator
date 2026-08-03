// ONE-SHOT CODEMOD: port QA drivers onto the shared menu boot.
//
// Background (tools/qa/lib/qa-boot.mjs): dozens of harnesses boot with a raw
//   await page.getByText('Continue', { exact: true }).click();
// which presumes a saved profile. run-playwright.cjs launches an EPHEMERAL
// context, so on a clean run "Continue" renders DISABLED and those drivers
// either hang on the load veil or fall through a .catch and hang on their first
// in-game wait instead. clickThroughMenu() resumes when Continue is actually
// clickable and starts a fresh Relaxed game when it is not — which is strictly
// more robust than the raw click in every one of these files, including the
// save/reload drivers that click Continue again after a reload.
//
// This rewrites the recognised shapes and REPORTS the rest rather than guessing
// at them. Run:  node tools/qa/lib/port-menu-boot.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('tools/qa');
const WRITE = process.argv.includes('--write');

const BOOT_IMPORT = "const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);";

const BOOT_REPLACEMENT = `${BOOT_IMPORT}\n  await clickThroughMenu(page);`;
const RE_ISENABLED = /const\s+(\w+)\s*=\s*page\.getByText\('Continue',\s*\{\s*exact:\s*true\s*\}\);\s*\n\s*if\s*\(await\s+\1\.isEnabled\(\)\.catch\(\(\)\s*=>\s*false\)\)\s*await\s+\1\.click\(\);/g;
const RE_FIRST_WAITFOR = /const\s+(\w+)\s*=\s*page\.getByText\('Continue',\s*\{\s*exact:\s*true\s*\}\)\.first\(\);\s*\n\s*await\s+\1\.waitFor\(\{[^}]*\}\);\s*\n\s*await\s+\1\.click\(\);/g;

// Each shape is [name, RegExp, replacement]. They are deliberately anchored on
// the whole statement group so a partial match cannot leave a dangling handle.
const SHAPES = [
  [
    'count-guarded-click',
    /const\s+(\w+)\s*=\s*page\.getByText\('Continue',\s*\{\s*exact:\s*true\s*\}\);\s*\n\s*if\s*\(await\s+\1\.count\(\)\)\s*await\s+\1\.click\(\)\.catch\(\(\)\s*=>\s*\{\s*\}\);/g,
    `${BOOT_IMPORT}\n  await clickThroughMenu(page);`,
  ],
  [
    'waitFor-then-click',
    /const\s+(\w+)\s*=\s*page\.getByText\('Continue',\s*\{\s*exact:\s*true\s*\}\);\s*\n\s*await\s+\1\.waitFor\(\{[^}]*\}\);\s*\n\s*await\s+\1\.click\(\);/g,
    `${BOOT_IMPORT}\n    await clickThroughMenu(page);`,
  ],
  [
    'isEnabled-guard-single-line',
    RE_ISENABLED,
    BOOT_REPLACEMENT,
  ],
  [
    'first-waitFor-then-click',
    RE_FIRST_WAITFOR,
    BOOT_REPLACEMENT,
  ],
  [
    'bare-click-with-catch',
    /await\s+page\.getByText\('Continue',\s*\{\s*exact:\s*true\s*\}\)\.click\(\)\.catch\(\(\)\s*=>\s*\{?\s*\}?\);/g,
    `${BOOT_IMPORT}\n  await clickThroughMenu(page);`,
  ],
  [
    'bare-click',
    /await\s+page\.getByText\('Continue',\s*\{\s*exact:\s*true\s*\}\)\.click\(\);/g,
    `${BOOT_IMPORT}\n  await clickThroughMenu(page);`,
  ],
];

const candidates = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'archive' || entry.name === 'lib') continue;
      walk(full);
      continue;
    }
    if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue;
    const source = fs.readFileSync(full, 'utf8');
    if (!source.includes("getByText('Continue'")) continue;
    if (source.includes('qa-boot.mjs')) continue;
    candidates.push({ file: full, source });
  }
};
walk(ROOT);

const ported = [];
const unhandled = [];
for (const entry of candidates) {
  let next = entry.source;
  let shape = null;
  for (const [name, pattern, replacement] of SHAPES) {
    if (!pattern.test(next)) continue;
    pattern.lastIndex = 0;
    next = next.replace(pattern, replacement);
    shape = name;
    break;
  }
  if (!shape || next.includes("getByText('Continue'")) {
    unhandled.push(path.relative(process.cwd(), entry.file));
    continue;
  }
  ported.push({ file: path.relative(process.cwd(), entry.file), shape });
  if (WRITE) fs.writeFileSync(entry.file, next);
}

console.log(JSON.stringify({
  candidates: candidates.length,
  ported: ported.length,
  unhandled: unhandled.length,
  wrote: WRITE,
  byShape: ported.reduce((acc, entry) => {
    acc[entry.shape] = (acc[entry.shape] || 0) + 1;
    return acc;
  }, {}),
  unhandledFiles: unhandled,
}, null, 2));
