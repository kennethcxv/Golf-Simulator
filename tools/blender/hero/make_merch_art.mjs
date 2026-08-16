// MERCHANDISE ATLASES. Variety comes from TEXTURES, not from models.
//
// One golf-ball-box mesh with three brand faces costs ONE material and ONE
// program. Three box models cost three of each -- and a parallel session is
// cutting this game from 349 materials to under 40 because that is what stands
// between the owner and a 70-second load.
//
// Every SKU here is a CELL. The mesh picks its cell with a UV offset.
//
// Brands are invented. The catalogue's names are the game's own
// (Range-rock, Tour-soft, Pro-V, Clubhouse cola...) so nothing here is a real
// product, and the scheme-mark sweep from the money generator runs over the
// output for the same reason it does there.
//
//   node tools/blender/hero/make_merch_art.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('Assets/models/hero/textures');
fs.mkdirSync(OUT, { recursive: true });

const INK = '#16321f';

// ---- golf ball boxes: 3 SKUs from SHOP_CATALOG ------------------------------
const BALL_SKUS = [
  { top: 'RANGE-ROCK', sub: 'PRACTICE  DOZEN', a: '#d8a13a', b: '#8a5f14', ink: '#2b1c05' },
  { top: 'TOUR-SOFT', sub: 'DISTANCE  DOZEN', a: '#2f6f9e', b: '#123c5c', ink: '#e6f1f8' },
  { top: 'PRO-V', sub: 'TOUR  DOZEN', a: '#f0ece2', b: '#c9c3b4', ink: '#20301f' },
];

function ballBox(w, h, s) {
  return `<g>
    <defs><linearGradient id="bg${s.top}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${s.a}"/><stop offset="1" stop-color="${s.b}"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#bg${s.top})"/>
    <rect x="${w * 0.05}" y="${h * 0.08}" width="${w * 0.90}" height="${h * 0.84}"
          fill="none" stroke="${s.ink}" stroke-width="${h * 0.014}" opacity="0.5"/>
    <g text-anchor="middle" fill="${s.ink}" font-family="Helvetica, Arial, sans-serif">
      <text x="${w / 2}" y="${h * 0.40}" font-size="${h * 0.190}"
            font-weight="bold" letter-spacing="${h * 0.012}">${s.top}</text>
      <text x="${w / 2}" y="${h * 0.545}" font-size="${h * 0.072}"
            letter-spacing="${h * 0.030}">${s.sub}</text>
    </g>
    <g opacity="0.85">
      ${[0.30, 0.50, 0.70].map((cx) => `
        <circle cx="${w * cx}" cy="${h * 0.760}" r="${h * 0.088}"
                fill="#ffffff" stroke="${s.ink}" stroke-width="${h * 0.010}"/>
        ${Array.from({ length: 7 }, (_, k) => {
          const a = (k / 7) * Math.PI * 2;
          return `<circle cx="${w * cx + Math.cos(a) * h * 0.048}"
                          cy="${h * 0.760 + Math.sin(a) * h * 0.048}"
                          r="${h * 0.014}" fill="${s.ink}" opacity="0.30"/>`;
        }).join('')}`).join('')}
    </g>
  </g>`;
}

// ---- drinks and snacks: 7 SKUs ----------------------------------------------
const LABELS = [
  { n: 'CLUBHOUSE', d: 'COLA', a: '#8e1c1c', b: '#4a0d0d', ink: '#ffe9d6' },
  { n: 'CADDIE', d: 'CITRUS', a: '#c8a512', b: '#7d6406', ink: '#2b2405' },
  { n: 'FAIRWAY', d: 'SPRING WATER', a: '#3f92c4', b: '#17557e', ink: '#eaf6ff' },
  { n: 'SEA-SALT', d: 'KETTLE CHIPS', a: '#2f5f3a', b: '#173420', ink: '#eaf3e8' },
  { n: 'BUNKER', d: 'BITES', a: '#c96a1e', b: '#7a3c0c', ink: '#fff0dd' },
  { n: 'BACK-NINE', d: 'OAT BAR', a: '#6b4a22', b: '#3a2710', ink: '#f6ead6' },
  { n: 'CHEDDAR', d: 'CLUB CRACKERS', a: '#c98a16', b: '#7d520a', ink: '#2f2205' },
];

function label(w, h, s) {
  return `<g>
    <defs><linearGradient id="lg${s.n}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${s.b}"/><stop offset="0.5" stop-color="${s.a}"/>
      <stop offset="1" stop-color="${s.b}"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#lg${s.n})"/>
    <rect x="0" y="${h * 0.14}" width="${w}" height="${h * 0.020}" fill="${s.ink}" opacity="0.5"/>
    <rect x="0" y="${h * 0.84}" width="${w}" height="${h * 0.020}" fill="${s.ink}" opacity="0.5"/>
    <g text-anchor="middle" fill="${s.ink}" font-family="Helvetica, Arial, sans-serif">
      <text x="${w / 2}" y="${h * 0.46}" font-size="${h * 0.180}" font-weight="bold"
            letter-spacing="${h * 0.020}">${s.n}</text>
      <text x="${w / 2}" y="${h * 0.63}" font-size="${h * 0.098}"
            letter-spacing="${h * 0.038}">${s.d}</text>
      <text x="${w / 2}" y="${h * 0.775}" font-size="${h * 0.056}"
            letter-spacing="${h * 0.020}" opacity="0.75">PINE HILLS GOLF CLUB</text>
    </g>
  </g>`;
}

function atlas(cols, rows, cw, ch, cells) {
  const W = cols * cw, H = rows * ch;
  const body = cells.map((svg, i) =>
    `<g transform="translate(${(i % cols) * cw} ${Math.floor(i / cols) * ch})">${svg}</g>`
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#2a2a2a"/>${body}</svg>`;
}

const boxCells = BALL_SKUS.map((s) => ballBox(512, 384, s));
const labelCells = LABELS.map((s) => label(512, 256, s));
// pad the label atlas to a full 4x2 grid so the UV maths stays a clean divide
while (labelCells.length < 8) labelCells.push(`<rect width="512" height="256" fill="#3a3a3a"/>`);

// the same blunt sweep the money generator carries, for the same reason
const banned = /nike|titleist|callaway|taylormade|srixon|pepsi|coca[- ]?cola|lay'?s|doritos/i;
for (const [name, cells] of [['boxes', boxCells], ['labels', labelCells]]) {
  if (banned.test(cells.join(''))) {
    throw new Error(`${name}: a real brand name is in the artwork`);
  }
  console.log(`${name}: no real brand name, ${cells.length} cells`);
}

for (const [name, svg] of [
  ['merch_ball_boxes.png', atlas(3, 1, 512, 384, boxCells)],
  ['merch_labels.png', atlas(4, 2, 512, 256, labelCells)],
]) {
  const file = path.join(OUT, name);
  await sharp(Buffer.from(svg)).png().toFile(file);
  const m = await sharp(file).metadata();
  console.log(`${name}  ${m.width}x${m.height}  ${fs.statSync(file).size} bytes`);
}
