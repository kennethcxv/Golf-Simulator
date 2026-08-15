// GOLDEN SCALE PROBE — fit the vertical map between two captures of the same
// pose. A camera that changed LENS scales the picture about the vanishing
// point; a camera that MOVED translates it; a camera at a different height
// does both. One number each, so the cause can be named instead of guessed.
//
// Finds strong horizontal edges (wall/ceiling junction, wainscot line, skirting)
// down a vertical strip of each image, pairs them in order, and least-squares
// fits y_current = a * y_golden + b. `a` is the magnification.
//
//   node tools/qa/golden-scale-probe.mjs stockroom-wall [--a DIR] [--x 700]
import sharp from 'sharp';
import { PNG } from 'pngjs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const pose = args[0];
const W = 1920;
const root = process.cwd();
const curDir = opt('--a', 'qa/golden/current');
const stripX = Number(opt('--x', 800));
const stripW = Number(opt('--w', 120));

const norm = async (p) => PNG.sync.read(await sharp(resolve(root, p)).resize({ width: W, kernel: 'lanczos3' }).png().toBuffer());

// mean luminance per row across a vertical strip, then the rows where it jumps
const edges = (png) => {
  const lum = [];
  for (let y = 0; y < png.height; y += 1) {
    let s = 0;
    for (let x = stripX; x < stripX + stripW; x += 1) {
      const i = (y * png.width + x) << 2;
      s += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
    }
    lum.push(s / stripW);
  }
  const found = [];
  for (let y = 3; y < lum.length - 3; y += 1) {
    const d = Math.abs(lum[y + 2] - lum[y - 2]);
    if (d < 12) continue;
    // keep the local maximum of the gradient only
    let peak = true;
    for (let k = -4; k <= 4; k += 1) {
      if (k === 0) continue;
      const yy = y + k;
      if (yy < 3 || yy >= lum.length - 3) continue;
      if (Math.abs(lum[yy + 2] - lum[yy - 2]) > d) { peak = false; break; }
    }
    if (peak) found.push({ y, jump: +d.toFixed(1), dir: lum[y + 2] > lum[y - 2] ? 'up' : 'down' });
  }
  return found;
};

const gold = await norm(`tests/goldens/${pose}.png`);
const cur = await norm(`${curDir}/${pose}.png`);
const eg = edges(gold); const ec = edges(cur);
console.log(`\n=== ${pose} === strip x ${stripX}..${stripX + stripW}, height ${gold.height}`);
console.log('GOLDEN  edges:', eg.map((e) => `${e.y}(${e.dir} ${e.jump})`).join('  '));
console.log('CURRENT edges:', ec.map((e) => `${e.y}(${e.dir} ${e.jump})`).join('  '));

// pair by direction in order; only fit when the counts agree
if (eg.length === ec.length && eg.length >= 2 && eg.every((e, i) => e.dir === ec[i].dir)) {
  const n = eg.length;
  const sx = eg.reduce((s, e) => s + e.y, 0);
  const sy = ec.reduce((s, e) => s + e.y, 0);
  const sxx = eg.reduce((s, e) => s + e.y * e.y, 0);
  const sxy = eg.reduce((s, e, i) => s + e.y * ec[i].y, 0);
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const b = (sy - a * sx) / n;
  console.log(`\nFIT  y_current = ${a.toFixed(4)} * y_golden + ${b.toFixed(2)}`);
  console.log(`magnification ${a.toFixed(4)}   fixed point y=${(b / (1 - a)).toFixed(1)} (image centre is ${(gold.height / 2).toFixed(1)})`);
  const impliedGoldFov = (curFov) => 2 * (180 / Math.PI) * Math.atan(Math.tan((curFov * Math.PI) / 360) * a);
  for (const f of [46, 52, 66, 74, 78]) {
    console.log(`  if current vertical fov is ${f}, golden was ${impliedGoldFov(f).toFixed(2)}`);
  }
} else {
  console.log('\nedge sets do not correspond — inspect the lists above by hand');
}
