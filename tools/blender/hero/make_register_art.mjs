// The register's screens. "The screen now that emission is wired: give it
// something on it. A till interface, even simple, reads a hundred times better
// than a lit rectangle."
//
// Two cells in one sheet: the cashier's till screen and the customer-facing
// card terminal. Both are drawn as a real POS would draw them -- a header bar,
// a line-item list with prices right-aligned, a total block, and a row of
// function keys -- because that layout is what makes a lit rectangle read as a
// screen rather than as a light.
//
//   node tools/blender/hero/make_register_art.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join('Assets', 'models', 'hero', 'textures');
mkdirSync(OUT, { recursive: true });

const W = 1024, H = 640;

const LINES = [
  ['KESTREL X-1 TOUR  dz', '54.00'],
  ['GLOVE  CABRETTA  M', '22.50'],
  ['TEES  WOOD 70mm  x50', '6.75'],
  ['POLO  FAIRWAY  L', '48.00'],
  ['CAP  PINE HILLS', '24.00'],
];

function till() {
  const rows = LINES.map((l, i) => `
    <text x="34" y="${168 + i * 46}" font-family="Helvetica,Arial"
          font-size="25" fill="#d7e6dd">${l[0]}</text>
    <text x="${W - 34}" y="${168 + i * 46}" text-anchor="end"
          font-family="Courier New,monospace" font-size="26"
          fill="#f2f7f3">${l[1]}</text>
    <line x1="34" y1="${180 + i * 46}" x2="${W - 34}" y2="${180 + i * 46}"
          stroke="#2e5b48" stroke-width="1.4"/>`).join('');
  const keys = ['VOID', 'DISC', 'CARD', 'CASH'].map((k, i) => `
    <rect x="${36 + i * 244}" y="${H - 92}" width="220" height="62" rx="9"
          fill="${i === 3 ? '#2f7a46' : '#1b3a2e'}" stroke="#4b8f6d"
          stroke-width="2"/>
    <text x="${146 + i * 244}" y="${H - 50}" text-anchor="middle"
          font-family="Helvetica,Arial" font-size="26" letter-spacing="3"
          fill="#eaf4ee">${k}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#0b1f18"/>
    <rect x="0" y="0" width="${W}" height="74" fill="#17422f"/>
    <text x="30" y="50" font-family="Georgia,serif" font-size="34"
          letter-spacing="3" fill="#eaf4ee">PINE HILLS PRO SHOP</text>
    <text x="${W - 30}" y="50" text-anchor="end" font-family="Helvetica,Arial"
          font-size="24" fill="#9fd0b6">TILL 1</text>
    ${rows}
    <rect x="${W - 430}" y="${H - 196}" width="396" height="78" rx="8"
          fill="#123528" stroke="#2f7a46" stroke-width="2"/>
    <text x="${W - 410}" y="${H - 143}" font-family="Helvetica,Arial"
          font-size="30" letter-spacing="4" fill="#9fd0b6">TOTAL</text>
    <text x="${W - 52}" y="${H - 140}" text-anchor="end"
          font-family="Courier New,monospace" font-size="44" font-weight="bold"
          fill="#f4fbf6">155.25</text>
    ${keys}
  </svg>`;
}

function terminal() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#08131f"/>
    <rect x="0" y="0" width="${W}" height="86" fill="#12324f"/>
    <text x="${W / 2}" y="58" text-anchor="middle" font-family="Helvetica,Arial"
          font-size="34" letter-spacing="5" fill="#dceaf6">PINE HILLS</text>
    <text x="${W / 2}" y="192" text-anchor="middle" font-family="Helvetica,Arial"
          font-size="34" letter-spacing="6" fill="#8fb6d6">AMOUNT DUE</text>
    <text x="${W / 2}" y="300" text-anchor="middle"
          font-family="Courier New,monospace" font-size="96" font-weight="bold"
          fill="#f0f7fd">155.25</text>
    <g stroke="#7fc9a8" stroke-width="9" fill="none" stroke-linecap="round">
      <path d="M${W / 2 - 96},${H - 190} a44,44 0 0 1 0,86"/>
      <path d="M${W / 2 - 118},${H - 206} a70,70 0 0 1 0,118"/>
      <path d="M${W / 2 - 140},${H - 222} a96,96 0 0 1 0,150"/>
      <circle cx="${W / 2 - 158}" cy="${H - 147}" r="9" fill="#7fc9a8"/>
    </g>
    <text x="${W / 2 + 40}" y="${H - 136}" font-family="Helvetica,Arial"
          font-size="32" letter-spacing="3" fill="#9fd0b6">TAP OR INSERT</text>
    <rect x="${W / 2 - 210}" y="${H - 76}" width="420" height="50" rx="8"
          fill="#12324f"/>
    <text x="${W / 2}" y="${H - 40}" text-anchor="middle"
          font-family="Helvetica,Arial" font-size="24" letter-spacing="4"
          fill="#8fb6d6">CARD ACCEPTED HERE</text>
  </svg>`;
}

// one sheet, two cells stacked: 0 = till, 1 = terminal
const a = await sharp(Buffer.from(till())).png().toBuffer();
const b = await sharp(Buffer.from(terminal())).png().toBuffer();
const out = path.join(OUT, 'register_screens.png');
await sharp({ create: { width: W, height: H * 2, channels: 3,
                        background: { r: 0, g: 0, b: 0 } } })
  .composite([{ input: a, left: 0, top: 0 }, { input: b, left: 0, top: H }])
  .png().toFile(out);
console.log(`${out}  ${W}x${H * 2}  cell 0 = till, cell 1 = card terminal`);
