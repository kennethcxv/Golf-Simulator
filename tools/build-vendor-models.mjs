// Builds the GENERATED portion of vendor/models/ from Assets/ — H4.
//
// Reality check (hash census, 2026-08-09): vendor/models holds 539 files.
// Only 126 of them are byte-exact copies of Assets/ files (the kit exports:
// checkout, ceiling_lights, shed, premium_clubhouse, and parts of
// assets_51_100 / pro_shop_furniture). The other 413 are exported DIRECTLY
// into vendor/models by the Blender build scripts and have no Assets/
// counterpart — they stay tracked in git and are NOT touched here.
//
// The 126 are listed in tools/vendor-models.manifest.json, gitignored via
// vendor/models/.generated.gitignore entries, and rebuilt by this script.
//
//   node tools/build-vendor-models.mjs          copy any missing/stale file
//   node tools/build-vendor-models.mjs --check  verify all 126 exist + hash-match (no writes)
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'tools/vendor-models.manifest.json'), 'utf8'));
const check = process.argv.includes('--check');
const sha1 = (p) => createHash('sha1').update(readFileSync(p)).digest('hex');

let copied = 0;
let ok = 0;
const problems = [];
for (const { from, to, sha1: expect } of manifest) {
  const src = join(root, from);
  const dst = join(root, to);
  if (!existsSync(src)) {
    problems.push(`source missing: ${from}`);
    continue;
  }
  if (sha1(src) !== expect) {
    problems.push(`source drifted from manifest hash: ${from} (re-run the manifest generator if intentional)`);
    continue;
  }
  if (existsSync(dst) && sha1(dst) === expect) {
    ok++;
    continue;
  }
  if (check) {
    problems.push(`generated file missing or stale: ${to}`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied++;
}
console.log(`vendor/models generated set: ${ok} up to date, ${copied} copied, ${problems.length} problems`);
for (const p of problems) console.error('  ' + p);
process.exit(problems.length ? 1 : 0);
