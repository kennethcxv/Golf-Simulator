// One contact sheet over the NON-APPAREL hero assets, so the whole game's prop
// library can be inspected against the apparel bar in a single frame instead of
// twenty-one separate looks.
//
//   node tools/blender/hero/v4/audit_sheet.mjs [out.png] [file ...]
//
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const out = args.shift() || "qa/hero/AUDIT-props.png";
const files = args.length ? args : [];
if (!files.length) {
  console.error("give it some files");
  process.exit(2);
}

const CELL_W = 400;
const CELL_H = 320;
const LABEL = 26;
const COLS = 6;
const PAD = 6;

const cells = [];
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log(`missing ${f}`);
    continue;
  }
  const name = path.basename(path.dirname(f));
  const img = await sharp(f)
    .resize(CELL_W, CELL_H, { fit: "contain",
                              background: { r: 26, g: 26, b: 30 } })
    .toBuffer();
  const text = `<svg width="${CELL_W}" height="${LABEL}">
    <rect width="100%" height="100%" fill="#0d0d10"/>
    <text x="8" y="18" font-family="DejaVu Sans, sans-serif" font-size="15"
      font-weight="bold" fill="#dfe3ea">${name}</text></svg>`;
  cells.push(await sharp({ create: {
      width: CELL_W, height: CELL_H + LABEL, channels: 3,
      background: { r: 13, g: 13, b: 16 } } })
    .composite([{ input: img, top: 0, left: 0 },
                { input: Buffer.from(text), top: CELL_H, left: 0 }])
    .png().toBuffer());
}

const rows = Math.ceil(cells.length / COLS);
const W = COLS * (CELL_W + PAD) + PAD;
const H = rows * (CELL_H + LABEL + PAD) + PAD;
const comp = cells.map((buf, i) => ({
  input: buf,
  top: PAD + Math.floor(i / COLS) * (CELL_H + LABEL + PAD),
  left: PAD + (i % COLS) * (CELL_W + PAD),
}));
await sharp({ create: { width: W, height: H, channels: 3,
                        background: { r: 18, g: 18, b: 22 } } })
  .composite(comp).png().toFile(out);
console.log(`wrote ${out}  (${W} x ${H}, ${cells.length} cells)`);
