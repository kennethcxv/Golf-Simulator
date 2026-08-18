/**
 * REAL REFERENCE | CURRENT (v3) | NEW (v4) -- the sheet the brief actually asks
 * for.
 *
 * "Do not only compare v3 against v2. A terrible v2 makes 'beats v2'
 * meaningless." So the reference photograph goes in the same row, at the same
 * height, and the question is which of the two renders you would mistake for
 * it across a shop.
 *
 *   node tools/blender/hero/v4/compare.mjs <name> [ref.jpg] [v3.png] [v4.png]
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const H = 900;
const PAD = 18;
const BG = { r: 24, g: 25, b: 28, alpha: 1 };
const LABEL = 46;

function caption(text, width, colour) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(
    `<svg width="${width}" height="${LABEL}">
       <rect width="100%" height="100%" fill="#000" fill-opacity="0.55"/>
       <text x="14" y="31" font-family="DejaVu Sans, Arial, sans-serif"
             font-size="23" font-weight="600" fill="${colour}">${esc}</text>
     </svg>`,
  );
}

async function panel(file, label, colour, doTrim = true) {
  if (!fs.existsSync(file)) throw new Error(`missing panel: ${file}`);
  // Trim the studio backdrop so the three garments are compared at the same
  // SIZE, not at whatever each render happened to frame them at.
  //
  // NOT on the v4 panel. Trim removes everything close to the corner colour,
  // and a navy garment's shadow side is closer to a dark backdrop than the
  // threshold is -- it ate the hem and the hoodie appeared to stop at the
  // pocket. The v4 frame is already shot tight (margin 1.015), so it needs no
  // trimming; the two it does trim are a photograph and a v3 render, both of
  // which sit on backgrounds far lighter than their subject.
  let trimmed = await sharp(file).flatten({ background: BG }).toBuffer();
  if (doTrim) {
    trimmed = await sharp(trimmed).trim({ threshold: 12 }).toBuffer();
  }
  const img = sharp(trimmed).resize({ height: H, fit: "inside" });
  const buf = await img.toBuffer();
  const meta = await sharp(buf).metadata();
  return sharp({
    create: {
      width: meta.width, height: H, channels: 4, background: BG,
    },
  })
    .composite([
      { input: buf, left: 0, top: 0 },
      { input: caption(label, meta.width, colour), left: 0, top: H - LABEL },
    ])
    .png()
    .toBuffer();
}

const [name, ...rest] = process.argv.slice(2);
if (!name) throw new Error("usage: compare.mjs <name> [ref] [v3] [v4]");
const ref = rest[0] || `qa/hero/v4/ref/${name}-ref1.jpg`;
const v3 = rest[1] || `qa/hero/v3/apparel/${name}/${name}-eevee-front.png`;
const v4 = rest[2] || `qa/hero/v4/${name}/${name}-v4-compare.png`;

const panels = await Promise.all([
  panel(ref, "REAL REFERENCE", "#7fe38a"),
  panel(v3, "CURRENT  (v3)", "#e2b45c"),
  panel(v4, "NEW  (v4)", "#78b8ff", false),
]);
const metas = await Promise.all(panels.map((p) => sharp(p).metadata()));
const W = metas.reduce((a, m) => a + m.width, 0) + PAD * 4;

let x = PAD;
const layers = [];
for (let i = 0; i < panels.length; i += 1) {
  layers.push({ input: panels[i], left: x, top: PAD });
  x += metas[i].width + PAD;
}
const out = path.join("qa/hero/v4", name, `${name}-REF-v3-v4.png`);
fs.mkdirSync(path.dirname(out), { recursive: true });
await sharp({
  create: { width: W, height: H + PAD * 2, channels: 4, background: BG },
})
  .composite(layers)
  .png()
  .toFile(out);
console.log(`wrote ${out}  (${W} x ${H + PAD * 2})`);
