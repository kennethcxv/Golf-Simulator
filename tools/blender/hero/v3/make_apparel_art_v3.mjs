// The apparel atlas: 24 cells, ONE material, every colourway and every print a
// texture.
//
// The brief: "More colourways and more variety. These are shop stock -- a rail
// of eight identical navy garments is not a shop." And: "Prints and logos on
// the texture: a chest logo, a sleeve badge, a printed tee front. That is what
// makes fabric read as merchandise rather than cloth." And: "Ribbed collars and
// cuffs should show as ribbing, not as smooth trim."
//
// So the sheet is four rows:
//
//   row 0-1   twelve garment colourways, knitted
//   row 2     six CONTRAST partners -- a cap's brim, a polo's collar and cuffs.
//             Contrast trim is most of what stops a garment reading as a blank.
//   row 3     the PRINTS: a chest roundel, a tee front, a sleeve badge, a cap
//             monogram, a ribbing strip, and plain trim white.
//
// The knit is not decoration. Rendered flat, every garment read as moulded
// plastic whatever its shape, because real cloth breaks up light at a scale the
// eye resolves at 18 inches.
//
//   node tools/blender/hero/make_apparel_art.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join('Assets', 'models', 'hero', 'textures');
mkdirSync(OUT, { recursive: true });

const CELL = 256;
const COLS = 6;
// A FIFTH ROW for apparel v2. The cap needs four surfaces the first four rows
// did not have -- an embroidered CREST that lands on a shaped patch, a darker
// UNDERBRIM (the underside of a bill is never the colour of its top), a pale
// cotton SWEATBAND, and a PLASTIC for the snapback.
//
// Growing the sheet downward is safe: cell n always sits at image row
// floor(n / COLS), and cell_offset derives v as (ROWS - 1 - row) / ROWS, so
// every existing cell keeps exactly the pixels it had. ATLAS_ROWS in
// build_apparel.py and build_cap.py must match this number.
// SIX ROWS. Growing the sheet downward is safe -- cell n always sits at image
// row floor(n / COLS) and cell_offset derives v as (ROWS - 1 - row) / ROWS, so
// every existing cell keeps exactly the pixels it had. ATLAS_ROWS in the three
// builders moves with it.
const ROWS = 6;

const WAY = [
  ['navy', [38, 52, 84], [22, 30, 52]],
  ['white', [232, 232, 228], [176, 178, 176]],
  ['fairway', [46, 84, 62], [26, 50, 38]],
  ['sky', [126, 166, 196], [70, 104, 134]],
  ['sand', [196, 178, 146], [140, 124, 96]],
  ['burgundy', [104, 40, 52], [62, 22, 30]],
  ['charcoal', [64, 66, 70], [36, 38, 42]],
  ['coral', [206, 116, 100], [150, 72, 60]],
  ['stone', [162, 160, 152], [110, 108, 102]],
  ['forest', [34, 60, 48], [18, 36, 28]],
  ['butter', [222, 206, 150], [166, 150, 100]],
  ['cream', [230, 222, 204], [172, 164, 146]],
];

function knit(w, h, base, seed) {
  const px = Buffer.alloc(w * h * 3);
  let s = seed * 9781 + 1;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const G = 16;
  const grid = Array.from({ length: (G + 1) * (G + 1) }, () => rnd() - 0.5);
  const at = (i, j) => grid[Math.min(G, j) * (G + 1) + Math.min(G, i)];
  // a second, much finer octave -- the nap, as opposed to the mottle
  const G2 = 96;
  const grid2 = Array.from({ length: (G2 + 1) * (G2 + 1) }, () => rnd() - 0.5);
  const g2 = (i, j) => grid2[((j % G2) + G2) % G2 * (G2 + 1) + ((i % G2) + G2) % G2];
  const at2 = (fx2, fy2) => {
    const i = Math.floor(fx2), j = Math.floor(fy2);
    const a = fx2 - i, b = fy2 - j;
    return (g2(i, j) * (1 - a) + g2(i + 1, j) * a) * (1 - b)
      + (g2(i, j + 1) * (1 - a) + g2(i + 1, j + 1) * a) * b;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * G, gy = (y / h) * G;
      const i = Math.floor(gx), j = Math.floor(gy);
      const fx = gx - i, fy = gy - j;
      const mottle = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy)
        + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
      // FINER. At 0.78 the diamonds came out about 3 mm across on a cap panel
      // and the crown read as a quilted jacket rather than as cloth -- the
      // texture was announcing its own scale. Doubling the frequency and
      // easing the amplitude puts the weave below the size the eye resolves as
      // a pattern and leaves only the light-breakup it is there for.
      // A PERFECT LATTICE IS WHY IT READS AS MOULDED. sin(x)*sin(y) is a
      // ruler-straight diamond grid, and a grid at any amplitude announces
      // itself as a manufactured pattern rather than as cloth. The macro
      // reference (hoodie-flat.jpg) shows the opposite: a fine IRREGULAR nap
      // with broad soft gradients over it, and wales that wander.
      //
      // So the knit keeps its wales and courses -- they are real -- but their
      // PHASE is jittered by the noise field, so no two runs line up, and the
      // fine grain carries more of the weight than the periodic part does.
      const fine = (at2(x * 0.42, y * 0.42) - 0.0) * 2.0;
      const wale = Math.sin(x * 1.74 + fine * 2.6) * 0.42;
      const course = Math.sin(y * 2.35 + fine * 1.7) * 0.20;
      const k = wale + course;
      const grain = (rnd() - 0.5) * 0.6;
      const f = 1 + (k * 0.030) + (mottle * 0.075) + (grain * 0.052)
        + (fine * 0.026);
      const o = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        px[o + c] = Math.max(0, Math.min(255, Math.round(base[c] * f)));
      }
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// ---- the prints -----------------------------------------------------------
function flagMark(cx, cy, sc, col) {
  return `<g stroke="${col}" fill="none" stroke-width="${5 * sc}"
      stroke-linecap="round">
      <path d="M${cx - 2 * sc},${cy + 26 * sc} L${cx - 2 * sc},${cy - 28 * sc}"/>
      <path d="M${cx - 2 * sc},${cy - 26 * sc} L${cx + 26 * sc},${cy - 15 * sc}
               L${cx - 2 * sc},${cy - 5 * sc}" fill="${col}"/>
    </g>
    <ellipse cx="${cx}" cy="${cy + 27 * sc}" rx="${17 * sc}" ry="${5 * sc}"
             fill="none" stroke="${col}" stroke-width="${3.4 * sc}"/>`;
}

function chestRoundel() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}">
    <circle cx="128" cy="112" r="62" fill="none" stroke="#e6e0cc" stroke-width="5"/>
    <circle cx="128" cy="112" r="53" fill="none" stroke="#e6e0cc" stroke-width="2"/>
    ${flagMark(128, 108, 1.05, '#e6e0cc')}
    <text x="128" y="206" text-anchor="middle" font-family="Georgia,serif"
          font-size="27" letter-spacing="4" fill="#e6e0cc">PINE HILLS</text>
    <text x="128" y="232" text-anchor="middle" font-family="Helvetica,Arial"
          font-size="15" letter-spacing="7" fill="#b9c8ad">GOLF CLUB</text>
  </svg>`;
}

// THE PRINT IS INK ON THE SHIRT, so this cell has NO BACKGROUND OF ITS OWN.
// It used to open with a flat #e8e8e4 rectangle, and that near-white field on
// a #e6decc cream shirt is precisely why the print read as a card stuck to the
// front -- T1 on the tee comparison, and the item the brief lists as "the tee
// print UV'd onto the cloth instead of a decal card".
//
// The cell is composited over a knit tile built from the SAME base colour and
// the SAME seed as the shirt's own cell, so the field is not merely a close
// match, it is the identical texture. There is no rim to find because there is
// no edge between two materials -- only ink, and cloth.
function teeFront() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}">
    <g stroke="#1d3326" stroke-width="7" stroke-linecap="round" fill="none">
      <path d="M70,182 L150,74"/><path d="M186,182 L106,74"/>
      <path d="M64,186 q10,12 22,4" /><path d="M192,186 q-10,12 -22,4"/>
    </g>
    <circle cx="128" cy="60" r="11" fill="#1d3326"/>
    <text x="128" y="216" text-anchor="middle" font-family="Georgia,serif"
          font-size="26" letter-spacing="3" fill="#1d3326">PINE HILLS</text>
    <text x="128" y="240" text-anchor="middle" font-family="Helvetica,Arial"
          font-size="13" letter-spacing="6" fill="#4d6a55">EST. 1962</text>
  </svg>`;
}

function sleeveBadge() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}">
    <rect x="26" y="52" width="204" height="152" rx="16" fill="none"
          stroke="#d9c88a" stroke-width="5"/>
    ${flagMark(128, 116, 1.25, '#d9c88a')}
    <text x="128" y="188" text-anchor="middle" font-family="Georgia,serif"
          font-size="24" letter-spacing="5" fill="#d9c88a">P H</text>
  </svg>`;
}

function sizeBand() {
  // A printed paper band. Warm off-white rather than pure white: paper next to
  // cloth is never brighter than the cloth around it, and the pure white one
  // was reading as a plastic strap laid over the garment.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}">
    <rect width="${CELL}" height="${CELL}" fill="#e8e4da"/>
    <rect x="0" y="18" width="${CELL}" height="5" fill="#c2bcae"/>
    <rect x="0" y="233" width="${CELL}" height="5" fill="#c2bcae"/>
    <text x="128" y="104" text-anchor="middle" font-family="Helvetica,Arial"
          font-size="66" font-weight="bold" fill="#2f3540">M</text>
    <text x="128" y="150" text-anchor="middle" font-family="Helvetica,Arial"
          font-size="21" letter-spacing="5" fill="#4a525e">PINE HILLS</text>
    <text x="128" y="184" text-anchor="middle" font-family="Helvetica,Arial"
          font-size="15" letter-spacing="3" fill="#7d8590">CLASSIC FIT</text>
  </svg>`;
}

function hangTag() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}">
    <rect width="${CELL}" height="${CELL}" fill="#f0ece1"/>
    <rect x="10" y="10" width="236" height="236" fill="none"
          stroke="#b9b1a0" stroke-width="4"/>
    ${flagMark(128, 86, 1.05, '#1f4a34')}
    <text x="128" y="152" text-anchor="middle" font-family="Georgia,serif"
          font-size="27" letter-spacing="4" fill="#1f4a34">PINE HILLS</text>
    <text x="128" y="190" text-anchor="middle" font-family="Helvetica,Arial"
          font-size="34" font-weight="bold" fill="#2f3540">48</text>
    <circle cx="128" cy="32" r="11" fill="none" stroke="#b9b1a0" stroke-width="5"/>
  </svg>`;
}

function capMonogram() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}">
    <rect width="${CELL}" height="${CELL}" fill="#5c2230"/>
    <text x="128" y="150" text-anchor="middle" font-family="Georgia,serif"
          font-size="96" font-weight="bold" letter-spacing="2"
          fill="#efe6d2">PH</text>
    <path d="M52,176 L204,176" stroke="#efe6d2" stroke-width="4"/>
    <text x="128" y="208" text-anchor="middle" font-family="Helvetica,Arial"
          font-size="16" letter-spacing="6" fill="#efe6d2">PINE HILLS</text>
  </svg>`;
}

function ribbing() {
  const bars = Array.from({ length: 32 }, (_, i) =>
    `<rect x="${i * 8}" y="0" width="4" height="${CELL}" fill="#000"
           opacity="${i % 2 ? 0.10 : 0.18}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}">
    <rect width="${CELL}" height="${CELL}" fill="#3a4a5e"/>${bars}</svg>`;
}

// ---- apparel v2: the four surfaces the cap needed --------------------------

function twill(w, h, base, seed, pitch = 5, strength = 0.10) {
  // A DIAGONAL weave, not a mottle. A bill's underside and a plastic strap are
  // woven or moulded, and the knit function's soft blobs read as neither.
  const px = Buffer.alloc(w * h * 3);
  let s = seed * 7717 + 3;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const diag = ((x + y) % pitch) / pitch;
      const rib = Math.sin(diag * Math.PI * 2) * strength;
      const grain = (rnd() - 0.5) * 0.035;
      const f = 1 + rib + grain;
      const o = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        px[o + c] = Math.max(0, Math.min(255, Math.round(base[c] * f)));
      }
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// The CREST is drawn to fill its cell, because the patch it lands on is already
// shield-shaped GEOMETRY: the mesh clips the corners, the texture supplies the
// embroidery. So the content is kept in a centred column and the bottom fifth
// is left plain -- down there the shield has narrowed to its point and anything
// drawn in the corners is cut away by the outline.
function capCrest() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}">
    <rect width="${CELL}" height="${CELL}" fill="#12301f"/>
    <path d="M18,14 H238 V150 Q238,206 128,246 Q18,206 18,150 Z" fill="none"
          stroke="#d8c68c" stroke-width="7" stroke-linejoin="round"/>
    <path d="M30,26 H226 V148 Q226,196 128,231 Q30,196 30,148 Z" fill="none"
          stroke="#d8c68c" stroke-width="2.5" stroke-linejoin="round"/>
    ${flagMark(128, 84, 1.15, '#e8dcae')}
    <path d="M46,124 H210" stroke="#d8c68c" stroke-width="3"/>
    <text x="128" y="156" text-anchor="middle" font-family="Georgia,serif"
          font-size="31" font-weight="bold" letter-spacing="2"
          fill="#f2ead2">PINE HILLS</text>
    <text x="128" y="182" text-anchor="middle" font-family="Helvetica,Arial"
          font-size="15" letter-spacing="7" fill="#b8cba6">GOLF CLUB</text>
  </svg>`;
}

// ---------------------------------------------------------------------------
const composite = [];
let idx = 0;
const names = [];
async function place(buf, name) {
  composite.push({
    input: buf,
    left: (idx % COLS) * CELL,
    top: Math.floor(idx / COLS) * CELL,
  });
  names.push(`${idx}:${name}`);
  idx++;
}

for (let i = 0; i < 12; i++) {
  await place(await knit(CELL, CELL, WAY[i][1], i + 1), WAY[i][0]);
}
for (let i = 0; i < 6; i++) {
  await place(await knit(CELL, CELL, WAY[i][2], 40 + i), `${WAY[i][0]}-dark`);
}
// TWO CHEST CELLS, ONE PER SHIRT COLOUR. The roundel used to carry its own
// dark-green field, which on the fairway polo is a tonal patch and on the navy
// one is a green square stuck to a blue shirt. It is ink now, over the shirt's
// own knit -- the same fix as the tee print, and it needs one cell per
// colourway because a cell cannot know which garment will wear it.
await place(await sharp(await sharp(await knit(Math.round(CELL * 2.2),
    Math.round(CELL * 2.2), WAY[2][1], 3)).resize(CELL, CELL).png().toBuffer())
  .composite([{ input: Buffer.from(chestRoundel()) }]).png().toBuffer(), 'chest');
// cell 11 is cream, placed above with seed (11 + 1); same base, same seed.
// AND AT THE SHIRT'S OWN TEXEL SCALE. The cloth maps one cell across the whole
// garment; the print patch maps one cell across a third of it, so a knit tile
// built at cell resolution comes out about 2.6x coarser inside the print than
// outside it -- which showed as a faint pale rectangle exactly where the card
// used to be. Building the tile 2.6x larger and resampling down puts the nap
// at the same size in world terms on both sides of the boundary.
const teeNap = await sharp(await knit(Math.round(CELL * 2.6),
                                      Math.round(CELL * 2.6), WAY[11][1], 12))
  .resize(CELL, CELL).png().toBuffer();
await place(await sharp(teeNap)
  .composite([{ input: Buffer.from(teeFront()) }]).png().toBuffer(),
  'teefront');
await place(await sharp(Buffer.from(sleeveBadge())).png().toBuffer(), 'badge');
await place(await sharp(Buffer.from(capMonogram())).png().toBuffer(), 'capmono');
await place(await sharp(Buffer.from(ribbing())).png().toBuffer(), 'ribbing');
await place(await knit(CELL, CELL, [236, 236, 232], 99), 'trim');

// row 4 -- apparel v2
await place(await sharp(Buffer.from(capCrest())).png().toBuffer(), 'crest');
await place(await twill(CELL, CELL, [56, 58, 62], 7, 5, 0.11), 'underbrim');
await place(await twill(CELL, CELL, [214, 206, 186], 8, 3, 0.055), 'sweatband');
await place(await twill(CELL, CELL, [42, 44, 48], 9, 9, 0.030), 'plastic');
await place(await knit(CELL, CELL, [40, 84, 88], 61), 'teal');
await place(await knit(CELL, CELL, [140, 76, 48], 62), 'rust');

// row 5 -- v3. SHOP GOODS, not blanks. "A rail of eight unmarked navy garments
// is not a shop": the printed size band and the hang tag are the two cues that
// say stock rather than laundry, and nearly every garment in the reference
// carries at least one of them.
await place(await sharp(Buffer.from(sizeBand())).png().toBuffer(), 'sizeband');
await place(await sharp(Buffer.from(hangTag())).png().toBuffer(), 'hangtag');
await place(await sharp(await sharp(await knit(Math.round(CELL * 2.2),
    Math.round(CELL * 2.2), WAY[0][1], 1)).resize(CELL, CELL).png().toBuffer())
  .composite([{ input: Buffer.from(chestRoundel()) }]).png().toBuffer(),
  'chest-navy');
// and the tee print on WHITE, for the hung tee. One print cell cannot serve
// two shirt colours once the print is ink rather than a card: on the white
// tee the cream-backed cell reads as a cream rectangle with a cut corner,
// which is the same sticker fault in a paler shade.
await place(await sharp(await sharp(await knit(Math.round(CELL * 2.6),
    Math.round(CELL * 2.6), WAY[1][1], 2)).resize(CELL, CELL).png().toBuffer())
  .composite([{ input: Buffer.from(teeFront()) }]).png().toBuffer(),
  'teefront-white');
// and the cap monogram on the cap's own burgundy, for the same reason: it
// carried a navy field of its own and sat on a burgundy crown as a navy card.
await place(await sharp(await sharp(await knit(Math.round(CELL * 2.4),
    Math.round(CELL * 2.4), WAY[5][1], 6)).resize(CELL, CELL).png().toBuffer())
  .composite([{ input: Buffer.from(capMonogram()) }]).png().toBuffer(),
  'capmono-burgundy');

const out = path.join(OUT, 'apparel_atlas_v3.png');
await sharp({
  create: { width: COLS * CELL, height: ROWS * CELL, channels: 3,
            background: { r: 0, g: 0, b: 0 } },
}).composite(composite).png().toFile(out);

console.log(`${out}  ${COLS * CELL}x${ROWS * CELL}  ${idx} cells`);
console.log(names.join('  '));
