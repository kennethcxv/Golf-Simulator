// H5 — golden-image diff. pixelmatch current captures against committed
// goldens; fail above per-pose thresholds.
//
//   node tools/golden-diff.mjs                 diff qa/golden/current vs tests/goldens
//   node tools/golden-diff.mjs --accept        copy current -> tests/goldens (rebaseline)
//   node tools/golden-diff.mjs --a DIR --b DIR diff two arbitrary capture dirs
//
// Captures are stored and compared at half resolution (1920-wide, lanczos3):
// a rake, a hat through a face, or a book inside its own covers is plainly
// visible at 1920; full-res goldens would put ~40 MB per rebaseline into git.
//
// Threshold model: pixelmatch threshold 0.12 per pixel; a pose FAILS when more
// than maxDiffPct of pixels differ (default 0.35%, overridable per pose in
// tests/goldens/thresholds.json). The floor exists because GTAO accumulation
// and shadow cadence leave a measured two-run noise of ~0.0-0.1%.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

const CURRENT = resolve(root, opt('--a', 'qa/golden/current'));
const GOLDENS = resolve(root, opt('--b', 'tests/goldens'));
const DIFFOUT = resolve(root, 'qa/golden/diff');
const WIDTH = 1920;

const normalize = async (p) => {
  const buf = await sharp(p).resize({ width: WIDTH, kernel: 'lanczos3' }).png().toBuffer();
  return PNG.sync.read(buf);
};

const poseNames = readdirSync(CURRENT).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4));

if (flag('--accept')) {
  mkdirSync(GOLDENS, { recursive: true });
  for (const name of poseNames) {
    const png = await sharp(join(CURRENT, `${name}.png`)).resize({ width: WIDTH, kernel: 'lanczos3' }).png().toBuffer();
    writeFileSync(join(GOLDENS, `${name}.png`), png);
  }
  console.log(`accepted ${poseNames.length} goldens into tests/goldens/ at ${WIDTH}w`);
  process.exit(0);
}

// thresholds.json: { "<pose>": { "maxDiffPct": 0.35, "ignore": [[x,y,w,h], ...] } }
// ignore rects (in 1920-wide space) are blacked out in BOTH images before the
// compare. They exist for measured nondeterminism that is not the subject:
// the window view of animated outdoor content, and the loose box whose landing
// spot varies per boot. A mask is honest only while it is listed here and
// visible in the stored diff images.
const thresholdsPath = join(GOLDENS, 'thresholds.json');
const thresholds = existsSync(thresholdsPath) ? JSON.parse(readFileSync(thresholdsPath, 'utf8')) : {};
mkdirSync(DIFFOUT, { recursive: true });

const maskRects = (png, rects) => {
  for (const [rx, ry, rw, rh] of rects) {
    for (let y = ry; y < Math.min(ry + rh, png.height); y++) {
      for (let x = rx; x < Math.min(rx + rw, png.width); x++) {
        const i = (png.width * y + x) << 2;
        png.data[i] = 0; png.data[i + 1] = 0; png.data[i + 2] = 0; png.data[i + 3] = 255;
      }
    }
  }
};

let failed = 0;
const rows = [];
for (const name of poseNames) {
  const goldenPath = join(GOLDENS, `${name}.png`);
  if (!existsSync(goldenPath)) {
    rows.push({ pose: name, verdict: 'NO GOLDEN (run --accept after review)' });
    failed++;
    continue;
  }
  const [cur, gold] = await Promise.all([normalize(join(CURRENT, `${name}.png`)), normalize(goldenPath)]);
  if (cur.width !== gold.width || cur.height !== gold.height) {
    rows.push({ pose: name, verdict: `SIZE MISMATCH ${cur.width}x${cur.height} vs ${gold.width}x${gold.height}` });
    failed++;
    continue;
  }
  const conf = thresholds[name] ?? {};
  const ignore = conf.ignore ?? thresholds['*']?.ignore ?? [];
  if (ignore.length) { maskRects(cur, ignore); maskRects(gold, ignore); }
  const diff = new PNG({ width: cur.width, height: cur.height });
  const n = pixelmatch(cur.data, gold.data, diff.data, cur.width, cur.height, { threshold: 0.12 });
  const pct = (100 * n) / (cur.width * cur.height);
  // --strict: budget 0 — the one-pixel control mode. A single flipped pixel
  // must FAIL here, proving the differ reads real pixels end to end.
  const maxPct = flag('--strict') ? 0 : (conf.maxDiffPct ?? 0.35);
  const ok = pct <= maxPct;
  if (!ok) {
    failed++;
    writeFileSync(join(DIFFOUT, `${name}.png`), PNG.sync.write(diff));
  }
  rows.push({ pose: name, diffPct: +pct.toFixed(4), maxPct, verdict: ok ? 'ok' : `FAIL (diff written to qa/golden/diff/${name}.png)` });
}
console.table(rows);
process.exit(failed ? 1 : 0);
