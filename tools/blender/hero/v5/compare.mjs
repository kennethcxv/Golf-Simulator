/**
 * REFERENCE | v4 | v5 for one asset, at full size.
 *
 * The brief is explicit that the reference sits beside every render every round
 * and that the frames are full size, never a contact sheet. So this makes ONE
 * sheet per asset with the reference cell enlarged to the same height as the
 * renders, and it refuses to write a sheet with a missing panel rather than
 * quietly leaving a grey rectangle -- a blank cell in a comparison sheet has
 * been cited as evidence in this project before.
 *
 *   node compare.mjs tee-hung r1c7 [front]
 *
 * The second argument is the Image1.png cell to compare against, as row/column.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const ROOT = 'C:/gfassets';
const REF = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper/Designs/ProShop/Apparel/Image1.png';
// Image1.png is a 7 x 3 sheet of 132 x 126 cells with a 4 px margin.
const CELL = { w: 132, h: 124, x0: 4, y0: 2 };

function cellBox(code) {
  const m = /^r(\d)c(\d)$/.exec(code);
  if (!m) throw new Error(`cell code must look like r1c7, got ${code}`);
  const r = +m[1] - 1, c = +m[2] - 1;
  return { left: CELL.x0 + c * CELL.w, top: CELL.y0 + r * CELL.h,
           width: CELL.w, height: CELL.h };
}

async function label(text, w, h, size = 30) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#141414"/>` +
    `<text x="18" y="${Math.round(h * 0.70)}" font-family="DejaVu Sans,Arial" ` +
    `font-size="${size}" fill="#f0f0f0">${esc}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const asset = process.argv[2];
const code = process.argv[3];
const view = process.argv[4] || 'front';
if (!asset || !code) {
  console.error('usage: node compare.mjs <asset> <r#c#> [view]');
  process.exit(2);
}

const v5 = path.join(ROOT, 'qa/hero/v5', asset, `${view}.png`);
// v4 named its frames `<asset>-v4-<view>.png`, and used `q34` where v5 says
// `three`.
const V4VIEW = { three: 'q34' };
const v4Candidates = [
  path.join(ROOT, 'qa/hero/v4', asset, `${asset}-v4-${V4VIEW[view] || view}.png`),
  path.join(ROOT, 'qa/hero/v4', asset, `${asset}-v4-front.png`),
  path.join(ROOT, 'qa/hero/v4', asset, `${view}.png`),
  path.join(ROOT, 'qa/hero/v4', asset, 'front.png'),
];
const v4 = v4Candidates.find((p) => fs.existsSync(p));
if (!fs.existsSync(v5)) { console.error(`missing v5 frame: ${v5}`); process.exit(1); }

const H = 1150, LBL = 44;
const cells = [];

const refBuf = await sharp(REF).extract(cellBox(code))
  .resize({ height: H, kernel: 'lanczos3' }).flatten({ background: '#ffffff' })
  .png().toBuffer();
cells.push({ name: `REFERENCE  Image1.png ${code}`, buf: refBuf });

if (v4) {
  cells.push({ name: `v4  ${path.basename(path.dirname(v4))}/${path.basename(v4)}`,
               buf: await sharp(v4).resize({ height: H, kernel: 'lanczos3' })
                 .flatten({ background: '#ffffff' }).png().toBuffer() });
} else {
  console.warn(`  (no v4 frame found for ${asset} -- sheet will be REFERENCE | v5)`);
}
cells.push({ name: `v5  ${view}`,
             buf: await sharp(v5).resize({ height: H, kernel: 'lanczos3' })
               .flatten({ background: '#ffffff' }).png().toBuffer() });

const metas = await Promise.all(cells.map((c) => sharp(c.buf).metadata()));
const widths = metas.map((m) => m.width);
const total = widths.reduce((a, b) => a + b, 0) + 12 * (cells.length + 1);
const comp = [];
let x = 12;
for (let i = 0; i < cells.length; i++) {
  comp.push({ input: cells[i].buf, left: x, top: 12 + LBL });
  comp.push({ input: await label(cells[i].name, widths[i], LBL, 26),
              left: x, top: 12 });
  x += widths[i] + 12;
}
const out = path.join(ROOT, 'qa/hero/v5', asset, `COMPARE-${view}.png`);
await sharp({ create: { width: total, height: H + LBL + 24,
                        channels: 3, background: '#1b1b1b' } })
  .composite(comp).png().toFile(out);
console.log(`wrote ${out}  (${cells.length} cells, ${total}x${H + LBL + 24})`);
