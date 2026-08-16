// THE MONEY, rebuilt from reference.
//
// Reference: ref/money/note20.jpg and note1.jpg -- Bank of Canada 1935 series,
// public domain. What a real note actually has, which the old art had none of:
//
//   a PORTRAIT in an oval frame, off to one side, engraved
//   a GUILLOCHE border -- dense interlaced line work, not a plain rule
//   CORNER NUMERALS in ornate boxes, all four corners
//   an arched BANK NAME band across the top
//   a SEAL, round, on the opposite side to the portrait
//   a SERIAL BAND in a contrasting ink, twice
//   a scrolled VALUE BANNER along the bottom
//   two SIGNATURE lines with titles under them
//   and a TINT: one flat colour behind black engraving, DIFFERENT PER
//   DENOMINATION. That last one is the fault the owner named -- every note in
//   the old set was the same green at the same size, so a stack read as
//   photocopied.
//
// Every denomination here gets its own tint, its own device in the oval, its
// own guilloche rosette count, and its own numeral placement.
//
// Generic currency. No real note is reproduced and no issuer is named; the
// unit is UNITS, which is what the game already calls its money.
//
//   node tools/blender/hero/make_money_art2.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join('Assets', 'models', 'hero', 'textures');
mkdirSync(OUT, { recursive: true });

const NW = 660, NH = 300;          // one note cell
const COLS = 3, ROWS = 2;

// ---------------------------------------------------------------------------
// guilloche: interlaced spirograph line work, the thing that says "banknote"

function guilloche(cx, cy, R, r, d, turns, stroke, width = 0.7, op = 0.55) {
  const pts = [];
  const steps = Math.round(turns * 140);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * 2 * Math.PI;
    const k = (R - r) / r;
    pts.push([
      (cx + (R - r) * Math.cos(t) + d * Math.cos(k * t)).toFixed(1),
      (cy + (R - r) * Math.sin(t) - d * Math.sin(k * t)).toFixed(1),
    ]);
  }
  return `<polyline points="${pts.map((p) => p.join(',')).join(' ')}"
    fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${op}"/>`;
}

function arcText(text, cx, cy, r, spanDeg, size, fill, opacity = 1,
                 family = 'Georgia,serif', up = true) {
  // Characters placed and rotated one at a time. <textPath> is the obvious way
  // and this build's rasteriser silently drops it -- the issuer band and the
  // coin legend both came out blank, which is the kind of miss that survives
  // because nothing errors.
  const n = text.length;
  const start = -spanDeg / 2;
  let out = '';
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (ch === ' ') continue;
    const a = (start + (spanDeg * (i + 0.5)) / n) * Math.PI / 180;
    const x = cx + Math.sin(a) * r;
    const y = cy - Math.cos(a) * r * (up ? 1 : -1);
    const rot = (a * 180) / Math.PI * (up ? 1 : -1);
    out += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle"
      font-family="${family}" font-size="${size}" fill="${fill}"
      opacity="${opacity}" transform="rotate(${rot.toFixed(2)} ${x.toFixed(1)} ${y.toFixed(1)})"
      >${ch}</text>`;
  }
  return out;
}

function lathe(x, y, w, h, n, stroke, op = 0.4) {
  // the woven band that runs behind a serial number
  let s = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    s += `<path d="M${x + w * t},${y} Q${x + w * t + w * 0.04},${y + h / 2}
      ${x + w * t},${y + h}" fill="none" stroke="${stroke}"
      stroke-width="0.6" opacity="${op}"/>`;
  }
  return s;
}

// the device in the portrait oval -- a different one per denomination, drawn
// as engraved line work rather than a flat silhouette
const DEVICES = {
  flag: (c) => `<path d="M0,26 L0,-26 M0,-24 L26,-15 L0,-6" fill="none"
      stroke="${c}" stroke-width="2.4"/>
    <ellipse cx="0" cy="27" rx="17" ry="4.5" fill="none" stroke="${c}" stroke-width="1.6"/>`,
  clubhouse: (c) => `<path d="M-26,16 L-26,-4 L0,-20 L26,-4 L26,16 Z" fill="none"
      stroke="${c}" stroke-width="2.2"/>
    <path d="M-9,16 L-9,0 L9,0 L9,16" fill="none" stroke="${c}" stroke-width="1.6"/>
    <path d="M-30,16 L30,16" stroke="${c}" stroke-width="2.4"/>`,
  bridge: (c) => `<path d="M-30,8 Q0,-20 30,8" fill="none" stroke="${c}" stroke-width="2.4"/>
    <path d="M-30,16 L30,16" stroke="${c}" stroke-width="2"/>
    ${[-20, -10, 0, 10, 20].map((x) => `<path d="M${x},16 L${x},${8 - (900 - x * x) / 90}"
      stroke="${c}" stroke-width="1.2"/>`).join('')}`,
  oak: (c) => `<path d="M0,26 L0,2" stroke="${c}" stroke-width="2.6"/>
    <circle cx="0" cy="-8" r="20" fill="none" stroke="${c}" stroke-width="2"/>
    <circle cx="-12" cy="2" r="11" fill="none" stroke="${c}" stroke-width="1.6"/>
    <circle cx="12" cy="2" r="11" fill="none" stroke="${c}" stroke-width="1.6"/>`,
  trophy: (c) => `<path d="M-13,-18 L13,-18 L10,6 L-10,6 Z" fill="none"
      stroke="${c}" stroke-width="2.2"/>
    <path d="M-13,-12 Q-24,-8 -13,0 M13,-12 Q24,-8 13,0" fill="none" stroke="${c}" stroke-width="1.8"/>
    <path d="M0,6 L0,18 M-12,22 L12,22 L10,18 L-10,18 Z" fill="none" stroke="${c}" stroke-width="2"/>`,
  lighthouse: (c) => `<path d="M-11,24 L-7,-14 L7,-14 L11,24 Z" fill="none"
      stroke="${c}" stroke-width="2.2"/>
    <path d="M-10,-14 L10,-14 M-9,-20 L9,-20 L7,-14 L-7,-14 Z" fill="none" stroke="${c}" stroke-width="1.8"/>
    <path d="M-20,24 L20,24" stroke="${c}" stroke-width="2.2"/>
    <path d="M-22,-22 L-13,-19 M22,-22 L13,-19" stroke="${c}" stroke-width="1.4"/>`,
};

const NOTES = [
  { v: 1, word: 'ONE', tint: '#b9c3a8', ink: '#22301f', accent: '#5c6b4a',
    device: 'flag', rosettes: 7, centreNumeral: false, portrait: 'left' },
  { v: 5, word: 'FIVE', tint: '#a8bdd0', ink: '#1a2c3e', accent: '#3a5f86',
    device: 'clubhouse', rosettes: 9, centreNumeral: true, portrait: 'left' },
  { v: 10, word: 'TEN', tint: '#c0b0cc', ink: '#2e2038', accent: '#6a4b86',
    device: 'bridge', rosettes: 11, centreNumeral: false, portrait: 'right' },
  { v: 20, word: 'TWENTY', tint: '#e0b39c', ink: '#3b1f16', accent: '#a04a28',
    device: 'oak', rosettes: 13, centreNumeral: true, portrait: 'left' },
  { v: 50, word: 'FIFTY', tint: '#cbb692', ink: '#332714', accent: '#8a6a2c',
    device: 'trophy', rosettes: 15, centreNumeral: false, portrait: 'right' },
  { v: 100, word: 'ONE HUNDRED', tint: '#9dc4bb', ink: '#12302b', accent: '#2f7a68',
    device: 'lighthouse', rosettes: 17, centreNumeral: true, portrait: 'left' },
];

function note(N, serial) {
  const { ink, accent, tint } = N;
  const px = N.portrait === 'left' ? 128 : NW - 128;
  const sx = N.portrait === 'left' ? NW - 128 : 128;   // seal opposite
  const num = String(N.v);
  const corner = (x, y, ax, ay) => `
    <g transform="translate(${x},${y})">
      <rect x="-27" y="-19" width="54" height="38" rx="4" fill="none"
            stroke="${ink}" stroke-width="1.4" opacity="0.85"/>
      ${guilloche(0, 0, 20, 7, 9, 7, accent, 0.5, 0.75)}
      <text x="0" y="9" text-anchor="middle" font-family="Georgia,serif"
            font-size="26" font-weight="bold" fill="${ink}">${num}</text>
    </g>`;

  return `
  <rect width="${NW}" height="${NH}" fill="${tint}"/>
  <!-- the guilloche field: rosettes along the note, different count per value -->
  ${Array.from({ length: N.rosettes }, (_, i) =>
    guilloche(30 + (i * (NW - 60)) / (N.rosettes - 1), NH / 2,
      62, 17, 26, 9, accent, 0.45, 0.30)).join('')}
  <rect x="10" y="10" width="${NW - 20}" height="${NH - 20}" fill="none"
        stroke="${ink}" stroke-width="2.5"/>
  <rect x="17" y="17" width="${NW - 34}" height="${NH - 34}" fill="none"
        stroke="${ink}" stroke-width="0.9" opacity="0.8"/>

  <!-- arched issuer band -->
  ${arcText('FAIRWAY RESERVE', NW / 2, 286, 240, 48, 26, ink)}
  <text x="${NW / 2}" y="97" text-anchor="middle" font-family="Georgia,serif"
        font-size="11" letter-spacing="3" fill="${ink}"
        opacity="0.85">LEGAL TENDER FOR ALL DEBTS</text>

  <!-- portrait oval, engraved -->
  <g transform="translate(${px},${NH / 2 + 14})">
    <ellipse rx="60" ry="72" fill="${tint}" stroke="${ink}" stroke-width="2.2"/>
    <ellipse rx="53" ry="65" fill="none" stroke="${ink}" stroke-width="0.8" opacity="0.7"/>
    ${Array.from({ length: 13 }, (_, i) =>
      `<path d="M-52,${-58 + i * 10} Q0,${-52 + i * 10} 52,${-58 + i * 10}"
        fill="none" stroke="${ink}" stroke-width="0.7" opacity="0.55"/>`).join('')}
    <g transform="scale(1.25)">${DEVICES[N.device](ink)}</g>
  </g>

  <!-- seal -->
  <g transform="translate(${sx},${NH / 2 + 22})">
    <circle r="38" fill="none" stroke="${ink}" stroke-width="2"/>
    ${guilloche(0, 0, 33, 11, 15, 11, ink, 0.5, 0.5)}
    <circle r="21" fill="none" stroke="${ink}" stroke-width="1.1"/>
    <text y="7" text-anchor="middle" font-family="Georgia,serif" font-size="19"
          fill="${ink}">${num}</text>
  </g>

  ${N.centreNumeral ? `
    <text x="${NW / 2}" y="${NH / 2 + 40}" text-anchor="middle"
          font-family="Georgia,serif" font-size="96" font-weight="bold"
          fill="${accent}" opacity="0.30">${num}</text>` : ''}

  <!-- serial bands, twice, in the accent ink -->
  <g>${lathe(NW / 2 - 96, 104, 192, 20, 26, ink, 0.30)}</g>
  <text x="${NW / 2}" y="120" text-anchor="middle" font-family="Courier New,monospace"
        font-size="17" letter-spacing="2" fill="${accent}">${serial}</text>
  <text x="${NW - 34}" y="${NH - 54}" text-anchor="end"
        font-family="Courier New,monospace" font-size="13" letter-spacing="2"
        fill="${accent}" opacity="0.9">${serial}</text>

  <!-- value banner -->
  <g transform="translate(${NW / 2},${NH - 46})">
    <path d="M-150,-19 L150,-19 L162,0 L150,19 L-150,19 L-162,0 Z"
          fill="${ink}" opacity="0.92"/>
    <text y="8" text-anchor="middle" font-family="Georgia,serif"
          font-size="${N.word.length > 8 ? 19 : 25}"
          letter-spacing="${N.word.length > 8 ? 3 : 6}"
          fill="${tint}">${N.word} ${N.v === 1 ? 'UNIT' : 'UNITS'}</text>
  </g>

  <!-- signatures -->
  <text x="118" y="${NH - 22}" text-anchor="middle" font-family="Georgia,serif"
        font-size="10" letter-spacing="1" fill="${ink}" opacity="0.8">KEEPER OF THE GREEN</text>
  <text x="${NW - 118}" y="${NH - 22}" text-anchor="middle" font-family="Georgia,serif"
        font-size="10" letter-spacing="1" fill="${ink}" opacity="0.8">CLUB TREASURER</text>
  <path d="M62,${NH - 30} L174,${NH - 30} M${NW - 174},${NH - 30} L${NW - 62},${NH - 30}"
        stroke="${ink}" stroke-width="0.8" opacity="0.6"/>

  ${corner(52, 52)}${corner(NW - 52, 52)}
  ${corner(52, NH - 52)}${corner(NW - 52, NH - 52)}`;
}

const SERIALS = ['AF 4210773', 'BK 7715204', 'CQ 3380916', 'DR 9024631',
  'EM 5567148', 'FT 1893450'];

const svgNotes = `<svg xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${NW * COLS}" height="${NH * ROWS}">
  ${NOTES.map((N, i) => `<g transform="translate(${(i % COLS) * NW},${Math.floor(i / COLS) * NH})">
      ${note(N, SERIALS[i])}</g>`).join('')}
</svg>`;

await sharp(Buffer.from(svgNotes)).png()
  .toFile(path.join(OUT, 'money_notes.png'));
console.log(`money_notes.png  ${NW * COLS}x${NH * ROWS}  `
  + NOTES.map((n) => `${n.v}:${n.tint}`).join(' '));

// ---------------------------------------------------------------------------
// COINS: a readable device, a beaded rim, a legend ring, a denomination

const CS = 320;
const COINS = [
  { name: 'quarter', v: '25', word: 'QUARTER UNIT', device: 'flag', metal: '#c9ccd0' },
  { name: 'dime', v: '10', word: 'TENTH UNIT', device: 'oak', metal: '#c4c7cb' },
  { name: 'nickel', v: '5', word: 'FIFTH UNIT', device: 'clubhouse', metal: '#bdbfc2' },
  { name: 'penny', v: '1', word: 'ONE HUNDREDTH', device: 'trophy', metal: '#b07a4e' },
];

function coinFace(C) {
  const ink = C.name === 'penny' ? '#6b421f' : '#6e7278';
  const r = CS / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg"
    xmlns:xlink="http://www.w3.org/1999/xlink" width="${CS}" height="${CS}">
    <rect width="${CS}" height="${CS}" fill="${C.metal}"/>
    <circle cx="${r}" cy="${r}" r="${r - 6}" fill="none" stroke="${ink}"
            stroke-width="3" opacity="0.55"/>
    ${Array.from({ length: 96 }, (_, i) => {
      const a = (2 * Math.PI * i) / 96;
      return `<circle cx="${(r + Math.cos(a) * (r - 16)).toFixed(1)}"
        cy="${(r + Math.sin(a) * (r - 16)).toFixed(1)}" r="2.6" fill="${ink}"
        opacity="0.45"/>`;
    }).join('')}
    ${arcText(C.word, r, r, r - 34, 190, 23, ink, 0.9)}
    <g transform="translate(${r},${r + 6}) scale(2.0)">${DEVICES[C.device](ink)}</g>
    <text x="${r}" y="${CS - 44}" text-anchor="middle" font-family="Georgia,serif"
          font-size="34" font-weight="bold" fill="${ink}">${C.v}</text>
  </svg>`;
}

for (const C of COINS) {
  await sharp(Buffer.from(coinFace(C))).png()
    .toFile(path.join(OUT, `coin_${C.name}.png`));
}
console.log(`coin_*.png  ${CS}x${CS} x ${COINS.length}: `
  + COINS.map((c) => c.name).join(', '));
