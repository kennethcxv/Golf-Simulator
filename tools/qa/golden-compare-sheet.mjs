// GOLDEN COMPARE SHEET — put the committed golden and the current capture on
// one page at the SAME scale, one above the other, so a person can see what
// actually changed. A diff image says WHERE pixels differ; it cannot say
// whether the room moved, the light changed, or something stopped drawing.
//
//   node tools/qa/golden-compare-sheet.mjs shop-floor [--a DIR] [--out FILE]
import sharp from 'sharp';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const pose = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--a' && args[args.indexOf(a) - 1] !== '--out') || 'shop-floor';
const W = 1400;
const root = process.cwd();
const curDir = opt('--a', 'qa/golden/current');
const out = resolve(root, opt('--out', `qa/golden/compare/${pose}.png`));
mkdirSync(dirname(out), { recursive: true });

const scale = async (p) => sharp(resolve(root, p)).resize({ width: W, kernel: 'lanczos3' }).png().toBuffer();
const gold = await scale(`tests/goldens/${pose}.png`);
const cur = await scale(`${curDir}/${pose}.png`);
const gh = (await sharp(gold).metadata()).height;
const ch = (await sharp(cur).metadata()).height;
const label = (text, w) => Buffer.from(
  `<svg width="${w}" height="34"><rect width="${w}" height="34" fill="#101410"/>`
  + `<text x="10" y="23" font-family="monospace" font-size="17" fill="#cfe0c4">${text}</text></svg>`,
);

await sharp({ create: { width: W, height: gh + ch + 68, channels: 3, background: '#101410' } })
  .composite([
    { input: label(`GOLDEN  tests/goldens/${pose}.png`, W), top: 0, left: 0 },
    { input: gold, top: 34, left: 0 },
    { input: label(`CURRENT  ${curDir}/${pose}.png`, W), top: gh + 34, left: 0 },
    { input: cur, top: gh + 68, left: 0 },
  ])
  .png()
  .toFile(out);
console.log(out);
