/**
 * The ten-asset contact sheet.
 *
 * "I want to be able to look at the contact sheet for five seconds and think:
 * those are clothes from a real retail store."
 *
 *   node tools/blender/hero/v4/contact.mjs [--v3]
 *
 * With --v3 it builds the same sheet from the v3 renders, so the two can be
 * put side by side.
 */
import sharp from "sharp";
import fs from "node:fs";

const V3 = process.argv.includes("--v3");
const CELL_W = 470;
const CELL_H = 470;
const PAD = 10;
const COLS = 5;
const LABEL = 34;
const BG = { r: 20, g: 21, b: 24, alpha: 1 };

const ASSETS = [
  "hoodie-hung", "trousers-hung", "cap", "polo-hung", "tee-hung",
  "hoodie-folded", "trousers-folded", "polo-folded", "tee-folded", "cap-peg",
];

// v3 called the peg state "cap-hung"; v4 calls it what it is.
const V3_NAME = { "cap-peg": "cap-hung" };

function pick(name) {
  if (V3) {
    const dir = `qa/hero/v3/apparel/${V3_NAME[name] || name}`;
    const stem = V3_NAME[name] || name;
    for (const f of [`${stem}-eevee-hero.png`, `${stem}-eevee-front.png`]) {
      if (fs.existsSync(`${dir}/${f}`)) return `${dir}/${f}`;
    }
    return null;
  }
  const dir = `qa/hero/v4/${name}`;
  for (const f of [`${name}-v4-compare.png`, `${name}-v4-hero.png`,
                   `${name}-v4-front.png`]) {
    if (fs.existsSync(`${dir}/${f}`)) return `${dir}/${f}`;
  }
  return null;
}

function caption(text) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(
    `<svg width="${CELL_W}" height="${LABEL}">
       <rect width="100%" height="100%" fill="#000" fill-opacity="0.62"/>
       <text x="12" y="24" font-family="DejaVu Sans, Arial, sans-serif"
             font-size="19" font-weight="600" fill="#cfd6e2">${esc}</text>
     </svg>`,
  );
}

const layers = [];
let missing = 0;
for (let i = 0; i < ASSETS.length; i += 1) {
  const name = ASSETS[i];
  const file = pick(name);
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const x = PAD + col * (CELL_W + PAD);
  const y = PAD + row * (CELL_H + PAD);
  if (!file) {
    missing += 1;
    layers.push({ input: caption(`${name}  -- MISSING`), left: x,
                  top: y + CELL_H - LABEL });
    continue;
  }
  const img = await sharp(file)
    .flatten({ background: BG })
    .resize({ width: CELL_W, height: CELL_H, fit: "contain",
              background: BG })
    .png()
    .toBuffer();
  layers.push({ input: img, left: x, top: y });
  layers.push({ input: caption(name), left: x, top: y + CELL_H - LABEL });
}

const W = PAD + COLS * (CELL_W + PAD);
const HH = PAD + 2 * (CELL_H + PAD);
const out = V3 ? "qa/hero/v4/CONTACT-v3.png" : "qa/hero/v4/CONTACT-v4.png";
await sharp({ create: { width: W, height: HH, channels: 4, background: BG } })
  .composite(layers)
  .png()
  .toFile(out);
console.log(`wrote ${out}  (${W} x ${HH})${missing ? `  MISSING ${missing}` : ""}`);
