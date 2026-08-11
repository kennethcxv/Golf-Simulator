// A NUMBERED CONTACT SHEET, for a decision that belongs to the owner.
//
// "Sweep that one value at the default player camera, screenshot each
// candidate, and give me a numbered contact sheet. I will pick."
//
// Thirteen separate PNGs are not a contact sheet — nobody compares thirteen
// files by opening them one at a time, and the whole point of a sweep is
// side-by-side. Each tile is cropped to the region of interest (a full 4K frame
// of mostly grass hides the thing being judged), captioned with its number and
// its value, and laid out in a grid.
//
//   node tools/qa/contact-sheet.mjs qa/electron/e-broom-roll/broom-roll-sweep.json \
//     --out qa/electron/e-broom-roll/CONTACT-SHEET.png --cols 4 --crop 0.34
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const manifestPath = resolve(process.cwd(), args[0]);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const dir = dirname(manifestPath);
const out = resolve(process.cwd(), opt('--out', join(dir, 'CONTACT-SHEET.png')));
const cols = Number(opt('--cols', 4));
const cropFrac = Number(opt('--crop', 0.34)); // keep this fraction of the frame, centred
const tileW = Number(opt('--tile', 460));
// where the region of interest sits, as a fraction of the frame. A held tool is
// not in the middle of the picture, and cropping to the centre is how the first
// sheet came back as thirteen pictures of grass.
const cx = Number(opt('--cx', 0.5));
const cy = Number(opt('--cy', 0.5));
const CAPTION = 34;

const rows = manifest.candidates || manifest.items || [];
if (!rows.length) { console.error('no candidates in', manifestPath); process.exit(1); }

const tiles = [];
for (const row of rows) {
  const src = join(dir, row.file);
  const meta = await sharp(src).metadata();
  const cw = Math.round(meta.width * cropFrac);
  const chh = Math.round(meta.height * cropFrac);
  const buf = await sharp(src)
    .extract({
      left: Math.max(0, Math.min(meta.width - cw, Math.round(meta.width * cx - cw / 2))),
      top: Math.max(0, Math.min(meta.height - chh, Math.round(meta.height * cy - chh / 2))),
      width: cw,
      height: chh,
    })
    .resize({ width: tileW })
    .png()
    .toBuffer();
  tiles.push({ row, buf, h: (await sharp(buf).metadata()).height });
}

const tileH = Math.max(...tiles.map((t) => t.h));
const gridRows = Math.ceil(tiles.length / cols);
const W = cols * tileW;
const H = gridRows * (tileH + CAPTION);

const label = (text, sub) => Buffer.from(
  `<svg width="${tileW}" height="${CAPTION}">`
  + `<rect width="${tileW}" height="${CAPTION}" fill="#0d120d"/>`
  + `<text x="9" y="24" font-family="monospace" font-size="19" font-weight="bold" fill="#e8f0e0">${text}</text>`
  + `<text x="${tileW - 9}" y="24" text-anchor="end" font-family="monospace" font-size="16" fill="#9fbb92">${sub}</text>`
  + '</svg>',
);

const composite = [];
tiles.forEach((t, i) => {
  const cx = (i % cols) * tileW;
  const cy = Math.floor(i / cols) * (tileH + CAPTION);
  composite.push({ input: label(`#${t.row.n}`, `${t.row.degrees}°  (${t.row.radians} rad)`), top: cy, left: cx });
  composite.push({ input: t.buf, top: cy + CAPTION, left: cx });
});

await sharp({ create: { width: W, height: H, channels: 3, background: '#0d120d' } })
  .composite(composite)
  .png()
  .toFile(out);
console.log(`${out}  ${tiles.length} candidates, ${cols} across`);
