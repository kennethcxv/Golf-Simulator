// H5 — the golden suite's negative control, runnable any time:
// flip ONE pixel of one golden, run the differ in --strict mode against the
// untouched capture set, and demand a FAILURE. If the mutated golden passes,
// the instrument is not reading pixels and every green diff is void.
//
//   node tools/golden-control.mjs   (exits 0 when the control FAILS the diff, as it must)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDENS = join(root, 'tests', 'goldens');
const STAGE = join(root, 'qa', 'golden', 'control-stage');

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
const poses = readdirSync(GOLDENS).filter((f) => f.endsWith('.png'));
if (!poses.length) {
  console.error('no goldens to control against');
  process.exit(2);
}
for (const f of poses) copyFileSync(join(GOLDENS, f), join(STAGE, f));

// Flip one pixel dead centre of the first pose (outside every ignore rect).
const target = join(STAGE, poses[0]);
const png = PNG.sync.read(readFileSync(target));
const i = (png.width * Math.floor(png.height / 2) + Math.floor(png.width / 4)) << 2;
png.data[i] = 255 - png.data[i];
png.data[i + 1] = 255 - png.data[i + 1];
png.data[i + 2] = 255 - png.data[i + 2];
writeFileSync(target, PNG.sync.write(png));

let failedAsRequired = false;
try {
  execFileSync(process.execPath, [join(root, 'tools', 'golden-diff.mjs'), '--a', STAGE, '--b', GOLDENS, '--strict'], { stdio: 'pipe' });
} catch {
  failedAsRequired = true;
}
rmSync(STAGE, { recursive: true, force: true });
if (failedAsRequired) {
  console.log(`CONTROL OK: one flipped pixel in ${poses[0]} FAILED the strict diff, as it must.`);
  process.exit(0);
}
console.error('CONTROL VOID: a mutated golden passed the strict diff — the instrument is not reading pixels.');
process.exit(1);
