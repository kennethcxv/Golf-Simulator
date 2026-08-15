// Money artwork: three ATLASES, so variety costs texture cells and not materials.
//
// A customer handing over the identical card every time reads as fake, but ten
// card MODELS cost ten materials and ten programs, and a parallel session is
// cutting this game from 349 materials to under 40. So every design here is a
// CELL in a shared atlas: one mesh, one material, a UV offset per instance.
//
// Everything is generic by construction -- invented marks, no issuer names, no
// real note reproduced.
//
//   node tools/blender/hero/make_money_art.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('Assets/models/hero/textures');
fs.mkdirSync(OUT, { recursive: true });

const CARD_COLS = 4, CARD_ROWS = 3;      // 12 card faces
const NOTE_COLS = 4, NOTE_ROWS = 2;      // 6 denominations + 2 wear variants
const COIN_COLS = 2, COIN_ROWS = 2;      // 4 coin faces

// What a real wallet varies: dark navy, matte black, silver, warm red,
// bank-blue, green, a plain white one.
const CARDS = [
  ['#16203a', '#c8cddb'], ['#111113', '#8f9298'], ['#b9bec6', '#2a2d33'],
  ['#8c2b25', '#ecd9cf'], ['#1d4676', '#cfe0f2'], ['#1c5340', '#d6e8dc'],
  ['#f0eee9', '#3a3f47'], ['#3b2a52', '#ded3ef'], ['#6b4a17', '#f0e2c4'],
  ['#25303a', '#b9c6d2'], ['#701f3c', '#f0d2de'], ['#2f3b22', '#d8e2c8'],
];
const NOTES = [
  ['1', '#5d7a5c'], ['5', '#7a6a5c'], ['10', '#5c6a7a'],
  ['20', '#6a5c7a'], ['50', '#7a5c5c'], ['100', '#4f6b6b'],
];
const COINS = [
  ['25c', '#c9ccd2'], ['10c', '#c9ccd2'], ['5c', '#c3c6cc'], ['1c', '#b0763f'],
];

function cardCell(w, h, [bg, ink], i) {
  return `<g>
    <rect width="${w}" height="${h}" rx="${h * 0.075}" fill="${bg}"/>
    <rect x="${w * 0.07}" y="${h * 0.34}" width="${w * 0.145}" height="${h * 0.20}"
          rx="${h * 0.030}" fill="#d9b451"/>
    <path d="M ${w * 0.07} ${h * 0.44} H ${w * 0.215} M ${w * 0.142} ${h * 0.34}
             V ${h * 0.54}" stroke="#8d7128" stroke-width="${h * 0.010}"/>
    <g fill="${ink}" font-family="Helvetica, Arial, sans-serif">
      <text x="${w * 0.07}" y="${h * 0.755}" font-size="${h * 0.115}"
            letter-spacing="${h * 0.020}">•••• •••• •••• ${1000 + i * 7}</text>
      <text x="${w * 0.07}" y="${h * 0.895}" font-size="${h * 0.070}"
            letter-spacing="${h * 0.012}" opacity="0.85">CARDHOLDER</text>
      <text x="${w * 0.70}" y="${h * 0.895}" font-size="${h * 0.070}"
            opacity="0.85">${String(2 + (i % 8)).padStart(2, '0')}/3${i % 9}</text>
      <circle cx="${w * 0.845}" cy="${h * 0.24}" r="${h * 0.085}" opacity="0.55"/>
      <circle cx="${w * 0.905}" cy="${h * 0.24}" r="${h * 0.085}" opacity="0.32"/>
    </g>
  </g>`;
}

function noteCell(w, h, [value, tint], wear) {
  const guilloche = Array.from({ length: 9 }, (_, k) =>
    `<circle cx="${w * 0.5}" cy="${h * 0.5}" r="${h * (0.14 + k * 0.038)}"
             fill="none" stroke="${tint}" stroke-width="0.9" opacity="0.30"/>`).join('');
  return `<g>
    <rect width="${w}" height="${h}" fill="#ddd8c6"/>
    <rect x="${w * 0.02}" y="${h * 0.05}" width="${w * 0.96}" height="${h * 0.90}"
          fill="none" stroke="${tint}" stroke-width="${h * 0.018}" opacity="0.8"/>
    ${guilloche}
    <circle cx="${w * 0.28}" cy="${h * 0.5}" r="${h * 0.28}" fill="${tint}" opacity="0.16"/>
    <g font-family="Georgia, serif" fill="${tint}">
      <text x="${w * 0.28}" y="${h * 0.60}" font-size="${h * 0.34}"
            text-anchor="middle" font-weight="bold">${value}</text>
      <text x="${w * 0.66}" y="${h * 0.38}" font-size="${h * 0.115}"
            text-anchor="middle" letter-spacing="${h * 0.020}">UNITS</text>
      <text x="${w * 0.66}" y="${h * 0.72}" font-size="${h * 0.075}"
            text-anchor="middle" letter-spacing="${h * 0.014}"
            opacity="0.8">LEGAL TENDER</text>
    </g>
    ${wear ? `<rect width="${w}" height="${h}" fill="#6b5f43" opacity="${wear * 0.18}"/>` : ''}
  </g>`;
}

function coinCell(w, h, [value, tone]) {
  const r = Math.min(w, h) * 0.46;
  const reeds = Array.from({ length: 48 }, (_, k) => {
    const a = (k / 48) * Math.PI * 2;
    return `<line x1="${w / 2 + Math.cos(a) * r * 0.90}" y1="${h / 2 + Math.sin(a) * r * 0.90}"
                  x2="${w / 2 + Math.cos(a) * r}" y2="${h / 2 + Math.sin(a) * r}"
                  stroke="#000" stroke-width="1.1" opacity="0.20"/>`;
  }).join('');
  return `<g>
    <rect width="${w}" height="${h}" fill="${tone}"/>
    <circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="${tone}"/>
    <circle cx="${w / 2}" cy="${h / 2}" r="${r * 0.84}" fill="none"
            stroke="#000" stroke-width="${r * 0.035}" opacity="0.22"/>
    ${reeds}
    <g text-anchor="middle" font-family="Georgia, serif" fill="#000" opacity="0.45">
      <text x="${w / 2}" y="${h * 0.58}" font-size="${r * 0.62}"
            font-weight="bold">${value}</text>
    </g>
  </g>`;
}

function atlas(cols, rows, cellW, cellH, cells) {
  const W = cols * cellW, H = rows * cellH;
  const body = cells.map((svg, i) => {
    const cx = (i % cols) * cellW;
    const cy = Math.floor(i / cols) * cellH;
    return `<g transform="translate(${cx} ${cy})">${svg}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#2a2a2a"/>${body}</svg>`;
}

const cardCells = CARDS.map((c, i) => cardCell(512, 323, c, i));
const noteCells = [
  ...NOTES.map((n) => noteCell(512, 218, n, 0)),
  noteCell(512, 218, NOTES[2], 1),
  noteCell(512, 218, NOTES[3], 2),
];
const coinCells = COINS.map((c) => coinCell(256, 256, c));

for (const [name, svg] of [
  ['money_cards.png', atlas(CARD_COLS, CARD_ROWS, 512, 323, cardCells)],
  ['money_notes.png', atlas(NOTE_COLS, NOTE_ROWS, 512, 218, noteCells)],
  ['money_coins.png', atlas(COIN_COLS, COIN_ROWS, 256, 256, coinCells)],
]) {
  const file = path.join(OUT, name);
  await sharp(Buffer.from(svg)).png().toFile(file);
  const m = await sharp(file).metadata();
  console.log(`${name}  ${m.width}x${m.height}  ${fs.statSync(file).size} bytes`);
}
