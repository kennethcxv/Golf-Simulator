// The apparel atlas: twelve cells, one material, every colourway a texture.
//
// The brief is explicit -- "Colours and patterns are TEXTURES on shared meshes,
// not new models" -- and the material budget is the hard one: the parallel
// session measured ~70 ms of cold compile per program, so a colourway that
// costs a material costs a slice of the owner's first load.
//
// The knit is the point as much as the colour. Rendered flat, every garment in
// the set read as moulded plastic whatever its shape, because real cloth breaks
// up light at a scale you can see at 18 inches. This lays down a pique-style
// cross-hatch plus low-frequency cloth noise, both subtle enough to survive a
// player-camera downscale without turning into moire.
//
//   node tools/blender/hero/make_apparel_art.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join('Assets', 'models', 'hero', 'textures');
mkdirSync(OUT, { recursive: true });

const CELL = 256;
const COLS = 4;
const ROWS = 3;

// Golf-shop colourways. Nothing here is a brand; they are the colours a pro
// shop actually stocks.
const CELLS = [
  { name: 'navy', rgb: [38, 52, 84] },
  { name: 'white', rgb: [232, 232, 228] },
  { name: 'fairway', rgb: [46, 84, 62] },
  { name: 'sky', rgb: [126, 166, 196] },
  { name: 'sand', rgb: [196, 178, 146] },
  { name: 'burgundy', rgb: [104, 40, 52] },
  { name: 'charcoal', rgb: [64, 66, 70] },
  { name: 'coral', rgb: [206, 116, 100] },
  { name: 'stone', rgb: [162, 160, 152] },
  { name: 'forest', rgb: [34, 60, 48] },
  { name: 'butter', rgb: [222, 206, 150] },
  { name: 'trim', rgb: [236, 236, 232] },   // buttons, hanger, eyelets
];

function knit(w, h, base, seed) {
  const px = Buffer.alloc(w * h * 3);
  let s = seed * 9781 + 1;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // low-frequency cloth mottle, precomputed on a coarse grid and interpolated
  const G = 16;
  const grid = Array.from({ length: (G + 1) * (G + 1) }, () => rnd() - 0.5);
  const at = (i, j) => grid[Math.min(G, j) * (G + 1) + Math.min(G, i)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * G, gy = (y / h) * G;
      const i = Math.floor(gx), j = Math.floor(gy);
      const fx = gx - i, fy = gy - j;
      const mottle = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy)
        + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
      // pique cross-hatch: two out-of-phase ripples make a knit cell, not stripes
      const k = Math.sin(x * 0.78) * Math.sin(y * 0.78) * 0.5
        + Math.sin((x + y) * 0.42) * 0.22;
      const grain = (rnd() - 0.5) * 0.6;
      const f = 1 + (k * 0.055) + (mottle * 0.085) + (grain * 0.020);
      const o = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        px[o + c] = Math.max(0, Math.min(255, Math.round(base[c] * f)));
      }
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

const composite = [];
for (let i = 0; i < CELLS.length; i++) {
  const buf = await knit(CELL, CELL, CELLS[i].rgb, i + 1);
  composite.push({
    input: buf,
    left: (i % COLS) * CELL,
    top: Math.floor(i / COLS) * CELL,
  });
}

const out = path.join(OUT, 'apparel_atlas.png');
await sharp({
  create: { width: COLS * CELL, height: ROWS * CELL, channels: 3,
            background: { r: 0, g: 0, b: 0 } },
}).composite(composite).png().toFile(out);

console.log(`${out}  ${COLS * CELL}x${ROWS * CELL}  ${CELLS.length} cells: `
  + CELLS.map((c) => c.name).join(', '));
