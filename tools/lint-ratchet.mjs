// ESLint ratchet — H7. The owner ruled "autofix NOTHING" on the 2026-08-09
// breakdown (333 findings), so the regression gate cannot demand zero. It
// demands NO NEW DEBT instead: fail when the count rises above the recorded
// baseline; when the count drops, say so and require the baseline be lowered
// to match (shrink-only, same philosophy as the glTF whitelist).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadESLint } from 'eslint';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'tools', 'lint-baseline.json');

const ESLint = await loadESLint({ useFlatConfig: true });
const eslint = new ESLint({ cwd: root });
const results = await eslint.lintFiles(['src']);
const total = results.reduce((s, f) => s + f.errorCount + f.warningCount, 0);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).total;

if (process.argv.includes('--rebase')) {
  writeFileSync(baselinePath, JSON.stringify({ total, notedAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
  console.log(`lint baseline set to ${total}`);
  process.exit(0);
}
if (total > baseline) {
  console.error(`LINT RATCHET FAIL: ${total} findings vs baseline ${baseline} — new debt was added. Run npm run lint to see it.`);
  process.exit(1);
}
if (total < baseline) {
  console.error(`LINT RATCHET: count dropped to ${total} (baseline ${baseline}). Lower the ratchet: node tools/lint-ratchet.mjs --rebase`);
  process.exit(1);
}
console.log(`lint ratchet ok: ${total} findings (frozen baseline, owner decision pending on the breakdown)`);
