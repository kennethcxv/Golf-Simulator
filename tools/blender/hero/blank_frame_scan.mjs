// Measure "does this frame contain a subject?" across every hero render, so a
// threshold can be chosen from the DATA rather than guessed.
//
// The statistic: the 99.9th percentile of the local gradient magnitude on a
// greyscale downsample. A frame containing any object has hard edges somewhere.
// A frame that is only the world gradient plus a flat backdrop card has none:
// both are smooth by construction.
//
//   node tools/blender/hero/blank_frame_scan.mjs [dir]
import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'qa/hero';
const W = 240;

export async function edgeScore(file) {
  const { data, info } = await sharp(file)
    .greyscale()
    .resize({ width: W, fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const g = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = data[i + 1] - data[i - 1];
      const gy = data[i + w] - data[i - w];
      g.push(Math.hypot(gx, gy));
    }
  }
  g.sort((a, b) => a - b);
  return {
    p999: g[Math.floor(g.length * 0.999)],
    p99: g[Math.floor(g.length * 0.99)],
    max: g[g.length - 1],
  };
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.endsWith('.png')) out.push(p);
  }
  return out;
}

// The floor `hero_lib.assert_frame_has_subject` uses. Kept in step by hand and
// cross-checked by control_blank_guard.py, which scores the same files through
// the Blender path.
const BLANK_EDGE_MIN = 8.0;

if (process.argv[1] && process.argv[1].endsWith('blank_frame_scan.mjs')) {
  const gate = process.argv.includes('--gate');
  const files = walk(ROOT).filter((f) => !f.includes('_control'));
  const rows = [];
  for (const f of files) rows.push({ f, ...(await edgeScore(f)) });
  rows.sort((a, b) => a.p999 - b.p999);
  const blank = rows.filter((r) => r.p999 < BLANK_EDGE_MIN);

  if (gate) {
    for (const r of blank) {
      console.log(`BLANK  ${r.p999.toFixed(2).padStart(6)}  ${path.relative(ROOT, r.f)}`);
    }
    const lowestReal = rows.find((r) => r.p999 >= BLANK_EDGE_MIN);
    console.log(`${rows.length} frames scanned, ${blank.length} contain no subject ` +
      `(floor ${BLANK_EDGE_MIN}; lowest real frame ${lowestReal ? lowestReal.p999.toFixed(1) : 'n/a'})`);
    if (blank.length) {
      console.log('\nA frame with no subject in it must never be citable as evidence.');
      console.log('Rebuild the asset: hero_lib now hides the backdrop for under-views');
      console.log('and fails the build rather than writing an empty frame.');
      process.exit(1);
    }
    process.exit(0);
  }

  console.log('p999   p99    max    file            (sorted: blankest first)');
  for (const r of rows.slice(0, 24)) {
    console.log(`${r.p999.toFixed(1).padStart(5)}  ${r.p99.toFixed(1).padStart(5)}  ` +
      `${r.max.toFixed(0).padStart(5)}  ${path.relative(ROOT, r.f)}`);
  }
  console.log(`...\n${rows.length} frames. Highest p999: ${rows[rows.length - 1].p999.toFixed(1)}`);
}
