// GOLDEN SHIFT PROBE — is a failing golden pose a DIFFERENT PICTURE, or the
// SAME PICTURE TAKEN FROM SOMEWHERE ELSE?
//
// A whole-scene pixel failure has two very different causes and the diff image
// cannot tell them apart: antialiasing/render-target changes light up every
// edge, and so does a camera that moved half a pixel. They call for opposite
// responses — one is a rendering regression to fix, the other is the capture
// standing in the wrong place.
//
// This separates them by brute force. Crop both images inward, slide the
// current one over the golden across a range of integer offsets, and diff at
// each. If some offset collapses the difference, the picture MOVED and the
// offset says how far. If the minimum sits at (0,0), nothing moved and the
// change is in how the pixels were shaded.
//
//   node tools/qa/golden-shift-probe.mjs shop-floor tool-broom
//   node tools/qa/golden-shift-probe.mjs --all
import sharp from 'sharp';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const root = process.cwd();
const W = 1920;
const RANGE = 30;
const STEP = 2;
const norm = async (p) => PNG.sync.read(await sharp(p).resize({ width: W, kernel: 'lanczos3' }).png().toBuffer());

const argv = process.argv.slice(2);
const poses = argv.includes('--all')
  ? readdirSync(resolve(root, 'qa/golden/current')).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))
  : argv;

const summary = [];
for (const pose of poses) {
  const curPath = resolve(root, `qa/golden/current/${pose}.png`);
  const goldPath = resolve(root, `tests/goldens/${pose}.png`);
  const rawCur = await sharp(curPath).metadata();
  const rawGold = await sharp(goldPath).metadata();
  const cur = await norm(curPath);
  const gold = await norm(goldPath);
  if (cur.width !== gold.width || cur.height !== gold.height) {
    summary.push({ pose, verdict: `SIZE MISMATCH ${cur.width}x${cur.height} vs ${gold.width}x${gold.height}` });
    continue;
  }

  const pad = RANGE + 2;
  const cw = cur.width - pad * 2; const chh = cur.height - pad * 2;
  const crop = (png, ox, oy) => {
    const out = new PNG({ width: cw, height: chh });
    for (let y = 0; y < chh; y += 1) {
      for (let x = 0; x < cw; x += 1) {
        const si = ((y + oy + pad) * png.width + (x + ox + pad)) << 2;
        const di = (y * cw + x) << 2;
        out.data[di] = png.data[si]; out.data[di + 1] = png.data[si + 1];
        out.data[di + 2] = png.data[si + 2]; out.data[di + 3] = 255;
      }
    }
    return out;
  };
  const goldC = crop(gold, 0, 0);
  let best = null; let zero = null;
  for (let dy = -RANGE; dy <= RANGE; dy += STEP) {
    for (let dx = -RANGE; dx <= RANGE; dx += STEP) {
      const curC = crop(cur, dx, dy);
      const n = pixelmatch(curC.data, goldC.data, null, cw, chh, { threshold: 0.12 });
      const pct = +((100 * n) / (cw * chh)).toFixed(4);
      if (!best || pct < best.pct) best = { dx, dy, pct };
      if (dx === 0 && dy === 0) zero = { pct };
    }
  }
  summary.push({
    pose,
    raw: `${rawCur.width}x${rawCur.height} vs ${rawGold.width}x${rawGold.height}`,
    noShiftPct: zero.pct,
    bestDx: best.dx,
    bestDy: best.dy,
    bestPct: best.pct,
    verdict: best.pct < zero.pct * 0.5 && (best.dx || best.dy) ? 'MOVED' : 'SHADED DIFFERENTLY',
  });
}
console.table(summary);
