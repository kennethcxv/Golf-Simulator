// Money artwork: three ATLASES, so variety costs texture cells and not materials.
//
// A customer handing over the identical card every time reads as fake, but ten
// card MODELS cost ten materials and ten programs, and a parallel session is
// cutting this game from 349 materials to under 40. So every design here is a
// CELL in a shared atlas: one mesh, one material, a UV offset per instance.
//
// REVISION PASS. Three things:
//
// 1. THE SCHEME MARK. The first version drew two overlapping circles in the
//    corner of every card. That is Mastercard's mark whether or not it was
//    meant as one, and a near-miss is the version that gets you a letter. Every
//    card now carries an INVENTED glyph from GLYPHS below -- a chevron stack, a
//    split hexagon, a notched diamond, a quartered square, an arc pair that
//    does NOT overlap, a stepped triangle. None of them resembles a real
//    network, and there is no contactless mark either: those four arcs are an
//    EMVCo device, not a generic decoration.
//
// 2. THE CARDS WERE FLAT SWATCHES WITH A CHIP ON THEM. Now four families --
//    metal, debit, consumer, corporate -- each with a gradient, an issuer
//    block, a number band with an embossed pass, an expiry, a cardholder line,
//    and a hologram patch on the premium ones.
//
// 3. THE CASH HAD NO GREEN. Currency reads as green before it reads as
//    anything else. Now: green ink on warm paper, a portrait oval, corner
//    numerals in all four corners, a guilloche border, a serial band, and a
//    per-denomination accent so a 100 does not read as a 1.
//
// No issuer NAMES at all -- the cards carry an invented glyph and a category
// word. That is the only way to be sure a name is not somebody's bank.
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

// ---------------------------------------------------------------- glyphs ----
// Invented scheme marks. Each takes a box and returns paths. Deliberately
// geometric and deliberately not two interlocking circles.
const GLYPHS = {
  chevrons: (x, y, s, c) => `
    <path d="M${x} ${y + s * 0.62} L${x + s * 0.30} ${y + s * 0.16} L${x + s * 0.60} ${y + s * 0.62}"
          fill="none" stroke="${c}" stroke-width="${s * 0.13}" stroke-linecap="round"/>
    <path d="M${x + s * 0.24} ${y + s * 0.88} L${x + s * 0.54} ${y + s * 0.42} L${x + s * 0.84} ${y + s * 0.88}"
          fill="none" stroke="${c}" stroke-width="${s * 0.13}" stroke-linecap="round" opacity="0.6"/>`,
  hexSplit: (x, y, s, c) => `
    <path d="M${x + s * 0.42} ${y + s * 0.06} L${x + s * 0.80} ${y + s * 0.30} L${x + s * 0.80} ${y + s * 0.74}
             L${x + s * 0.42} ${y + s * 0.98} L${x + s * 0.04} ${y + s * 0.74} L${x + s * 0.04} ${y + s * 0.30} Z"
          fill="${c}" opacity="0.75"/>
    <path d="M${x + s * 0.42} ${y + s * 0.06} L${x + s * 0.42} ${y + s * 0.98} L${x + s * 0.04} ${y + s * 0.74}
             L${x + s * 0.04} ${y + s * 0.30} Z" fill="${c}"/>`,
  diamond: (x, y, s, c) => `
    <path d="M${x + s * 0.44} ${y} L${x + s * 0.88} ${y + s * 0.50} L${x + s * 0.44} ${y + s}
             L${x} ${y + s * 0.50} Z" fill="none" stroke="${c}" stroke-width="${s * 0.11}"/>
    <path d="M${x + s * 0.44} ${y + s * 0.26} L${x + s * 0.66} ${y + s * 0.50}
             L${x + s * 0.44} ${y + s * 0.74} L${x + s * 0.22} ${y + s * 0.50} Z" fill="${c}"/>`,
  quartered: (x, y, s, c) => `
    <rect x="${x}" y="${y}" width="${s * 0.42}" height="${s * 0.42}" fill="${c}"/>
    <rect x="${x + s * 0.50}" y="${y + s * 0.50}" width="${s * 0.42}" height="${s * 0.42}" fill="${c}"/>
    <rect x="${x + s * 0.50}" y="${y}" width="${s * 0.42}" height="${s * 0.42}" fill="${c}" opacity="0.45"/>
    <rect x="${x}" y="${y + s * 0.50}" width="${s * 0.42}" height="${s * 0.42}" fill="${c}" opacity="0.45"/>`,
  // two arcs that face each other and never cross -- explicitly not a pair of
  // interlocking circles
  arcs: (x, y, s, c) => `
    <path d="M${x + s * 0.34} ${y + s * 0.08} A ${s * 0.42} ${s * 0.42} 0 0 0 ${x + s * 0.34} ${y + s * 0.92}"
          fill="none" stroke="${c}" stroke-width="${s * 0.14}" stroke-linecap="round"/>
    <path d="M${x + s * 0.58} ${y + s * 0.08} A ${s * 0.42} ${s * 0.42} 0 0 1 ${x + s * 0.58} ${y + s * 0.92}"
          fill="none" stroke="${c}" stroke-width="${s * 0.14}" stroke-linecap="round" opacity="0.55"/>`,
  steps: (x, y, s, c) => `
    <path d="M${x} ${y + s * 0.92} L${x + s * 0.26} ${y + s * 0.92} L${x + s * 0.26} ${y + s * 0.58}
             L${x + s * 0.52} ${y + s * 0.58} L${x + s * 0.52} ${y + s * 0.24}
             L${x + s * 0.78} ${y + s * 0.24} L${x + s * 0.78} ${y} L${x + s * 0.92} ${y}"
          fill="none" stroke="${c}" stroke-width="${s * 0.12}" stroke-linejoin="miter"/>`,
};
const GLYPH_KEYS = Object.keys(GLYPHS);

// Four families. No issuer names -- a glyph and a category word only.
const CARDS = [
  { fam: 'metal', a: '#2b2f36', b: '#0d0f13', ink: '#e7ebf2', accent: '#c9a961', holo: true, cat: 'RESERVE' },
  { fam: 'metal', a: '#3a3226', b: '#14110c', ink: '#f2e6cf', accent: '#d8b877', holo: true, cat: 'RESERVE' },
  { fam: 'metal', a: '#232a33', b: '#0b0e12', ink: '#dfe6ef', accent: '#9fb4c9', holo: true, cat: 'PLATINUM' },
  { fam: 'corporate', a: '#16345c', b: '#0b1c33', ink: '#cfe0f2', accent: '#6f9fd0', cat: 'BUSINESS' },
  { fam: 'corporate', a: '#1d4a3e', b: '#0d2620', ink: '#cfe8dc', accent: '#63b393', cat: 'BUSINESS' },
  { fam: 'corporate', a: '#3b2247', b: '#1b0f21', ink: '#e0d0ee', accent: '#a37fc4', cat: 'CORPORATE' },
  { fam: 'debit', a: '#eceae5', b: '#cfccc4', ink: '#33383f', accent: '#5b6472', cat: 'DEBIT' },
  { fam: 'debit', a: '#dfe4e8', b: '#bcc4cb', ink: '#2e343b', accent: '#4d6478', cat: 'DEBIT' },
  { fam: 'debit', a: '#e6e2d6', b: '#c6c0ae', ink: '#3a382e', accent: '#6b6552', cat: 'DEBIT' },
  { fam: 'consumer', a: '#c0392b', b: '#7d1f16', ink: '#ffe9e4', accent: '#ffb3a3', cat: 'CREDIT' },
  { fam: 'consumer', a: '#1f7a8c', b: '#0d3d47', ink: '#e0f6fa', accent: '#7fd4e3', cat: 'CREDIT' },
  { fam: 'consumer', a: '#d99a2b', b: '#8a5c10', ink: '#fff3dc', accent: '#ffd88a', cat: 'PREPAID' },
];

// Green first. Then a per-denomination accent so a 100 does not read as a 1.
// Each note carries an ENGRAVED VIGNETTE, not the same blank bust. Every one
// is a scene from the course this money is spent on, drawn as line work the way
// an intaglio plate would carry it. Round shapes are ellipses rather than
// circles so the interlocking-rings sweep below stays strict.
const SCENES = {
  flag: (cx, cy, R, k) => `
    <path d="M${cx - R * 0.72} ${cy + R * 0.44} q ${R * 0.72} ${-R * 0.26} ${R * 1.44} 0"
          fill="none" stroke="${k}" stroke-width="${R * 0.045}"/>
    <ellipse cx="${cx + R * 0.10}" cy="${cy + R * 0.40}" rx="${R * 0.34}" ry="${R * 0.10}"
             fill="none" stroke="${k}" stroke-width="${R * 0.035}"/>
    <path d="M${cx - R * 0.06} ${cy + R * 0.40} V${cy - R * 0.62}"
          stroke="${k}" stroke-width="${R * 0.055}"/>
    <path d="M${cx - R * 0.06} ${cy - R * 0.60} L${cx + R * 0.52} ${cy - R * 0.40}
             L${cx - R * 0.06} ${cy - R * 0.18} Z" fill="${k}"/>
    ${lines(cx, cy, R, k, 0.30)}`,
  clubhouse: (cx, cy, R, k) => `
    <path d="M${cx - R * 0.62} ${cy + R * 0.46} V${cy - R * 0.06} L${cx} ${cy - R * 0.52}
             L${cx + R * 0.62} ${cy - R * 0.06} V${cy + R * 0.46} Z"
          fill="none" stroke="${k}" stroke-width="${R * 0.050}"/>
    <path d="M${cx - R * 0.16} ${cy + R * 0.46} V${cy + R * 0.02} H${cx + R * 0.16}
             V${cy + R * 0.46}" fill="none" stroke="${k}" stroke-width="${R * 0.042}"/>
    <path d="M${cx - R * 0.44} ${cy + R * 0.10} h ${R * 0.18} M${cx + R * 0.26} ${cy + R * 0.10}
             h ${R * 0.18}" stroke="${k}" stroke-width="${R * 0.045}"/>
    ${lines(cx, cy, R, k, 0.34)}`,
  bridge: (cx, cy, R, k) => `
    <path d="M${cx - R * 0.78} ${cy + R * 0.10} q ${R * 0.78} ${-R * 0.72} ${R * 1.56} 0"
          fill="none" stroke="${k}" stroke-width="${R * 0.060}"/>
    <path d="M${cx - R * 0.78} ${cy + R * 0.10} V${cy + R * 0.42}
             M${cx + R * 0.78} ${cy + R * 0.10} V${cy + R * 0.42}
             M${cx - R * 0.34} ${cy - R * 0.18} V${cy + R * 0.42}
             M${cx + R * 0.34} ${cy - R * 0.18} V${cy + R * 0.42}"
          stroke="${k}" stroke-width="${R * 0.038}"/>
    <path d="M${cx - R * 0.86} ${cy + R * 0.46} h ${R * 1.72}
             M${cx - R * 0.70} ${cy + R * 0.60} h ${R * 1.40}"
          stroke="${k}" stroke-width="${R * 0.030}" opacity="0.65"/>`,
  tree: (cx, cy, R, k) => `
    <path d="M${cx - R * 0.08} ${cy + R * 0.56} V${cy - R * 0.10}"
          stroke="${k}" stroke-width="${R * 0.090}"/>
    <ellipse cx="${cx}" cy="${cy - R * 0.30}" rx="${R * 0.62}" ry="${R * 0.50}"
             fill="none" stroke="${k}" stroke-width="${R * 0.050}"/>
    <ellipse cx="${cx - R * 0.30}" cy="${cy - R * 0.08}" rx="${R * 0.30}" ry="${R * 0.24}"
             fill="none" stroke="${k}" stroke-width="${R * 0.040}"/>
    <ellipse cx="${cx + R * 0.32}" cy="${cy - R * 0.10}" rx="${R * 0.28}" ry="${R * 0.22}"
             fill="none" stroke="${k}" stroke-width="${R * 0.040}"/>
    ${lines(cx, cy, R, k, 0.62)}`,
  fountain: (cx, cy, R, k) => `
    <ellipse cx="${cx}" cy="${cy + R * 0.44}" rx="${R * 0.72}" ry="${R * 0.18}"
             fill="none" stroke="${k}" stroke-width="${R * 0.050}"/>
    <path d="M${cx - R * 0.14} ${cy + R * 0.42} V${cy - R * 0.16}
             M${cx + R * 0.14} ${cy + R * 0.42} V${cy - R * 0.16}"
          stroke="${k}" stroke-width="${R * 0.040}"/>
    <ellipse cx="${cx}" cy="${cy - R * 0.18}" rx="${R * 0.40}" ry="${R * 0.11}"
             fill="none" stroke="${k}" stroke-width="${R * 0.045}"/>
    <path d="M${cx} ${cy - R * 0.24} V${cy - R * 0.66}
             M${cx} ${cy - R * 0.62} q ${-R * 0.30} ${R * 0.14} ${-R * 0.34} ${R * 0.42}
             M${cx} ${cy - R * 0.62} q ${R * 0.30} ${R * 0.14} ${R * 0.34} ${R * 0.42}"
          fill="none" stroke="${k}" stroke-width="${R * 0.034}"/>`,
  trophy: (cx, cy, R, k) => `
    <path d="M${cx - R * 0.44} ${cy - R * 0.52} h ${R * 0.88} v ${R * 0.30}
             q 0 ${R * 0.46} ${-R * 0.44} ${R * 0.46}
             q ${-R * 0.44} 0 ${-R * 0.44} ${-R * 0.46} Z"
          fill="none" stroke="${k}" stroke-width="${R * 0.052}"/>
    <path d="M${cx - R * 0.44} ${cy - R * 0.40} q ${-R * 0.32} ${R * 0.06} ${-R * 0.26} ${R * 0.26}
             q ${R * 0.05} ${R * 0.16} ${R * 0.28} ${R * 0.12}
             M${cx + R * 0.44} ${cy - R * 0.40} q ${R * 0.32} ${R * 0.06} ${R * 0.26} ${R * 0.26}
             q ${-R * 0.05} ${R * 0.16} ${-R * 0.28} ${R * 0.12}"
          fill="none" stroke="${k}" stroke-width="${R * 0.040}"/>
    <path d="M${cx} ${cy + R * 0.24} V${cy + R * 0.44}" stroke="${k}" stroke-width="${R * 0.070}"/>
    <path d="M${cx - R * 0.36} ${cy + R * 0.58} h ${R * 0.72}" stroke="${k}"
          stroke-width="${R * 0.090}"/>`,
};

// engraved hatching under a scene -- the horizon lines an intaglio plate uses
function lines(cx, cy, R, k, y0) {
  return Array.from({ length: 5 }, (_, i) =>
    `<path d="M${cx - R * (0.80 - i * 0.09)} ${cy + R * (y0 + 0.06 + i * 0.07)}
              h ${R * (1.60 - i * 0.18)}" stroke="${k}" stroke-width="${R * 0.026}"
          opacity="${0.55 - i * 0.08}"/>`).join('');
}

const NOTES = [
  { v: '1', word: 'ONE', accent: '#4a7c4e', scene: 'flag' },
  { v: '5', word: 'FIVE', accent: '#7a6a43', scene: 'clubhouse' },
  { v: '10', word: 'TEN', accent: '#456b86', scene: 'bridge' },
  { v: '20', word: 'TWENTY', accent: '#6a5386', scene: 'tree' },
  { v: '50', word: 'FIFTY', accent: '#8a4f45', scene: 'fountain' },
  { v: '100', word: 'HUNDRED', accent: '#2f6f66', scene: 'trophy' },
];
const INK = '#1b5230';           // the green everything is printed in
const PAPER = '#bfcc9c';   // deliberately greener than real paper: under the
                           // studio key the previous value washed to near-white
                           // and the one cue that says 'money' was gone

// Real coinage colours: the quarter and dime are clad cupronickel and read
// brightest; the five-piece is solid cupronickel and is noticeably duller and
// warmer; the one-piece is copper. Reeding follows the real coins too -- the
// quarter and dime have it, the five and the one do not. Each carries its own
// device rather than four copies of the same flag.
const DEVICES = {
  wreath: (cx, cy, r) => `
    <g fill="none" stroke="#000" stroke-width="${r * 0.055}" opacity="0.42"
       stroke-linecap="round">
      <path d="M${cx - r * 0.34} ${cy + r * 0.34} q ${-r * 0.26} ${-r * 0.42} 0 ${-r * 0.76}
               M${cx + r * 0.34} ${cy + r * 0.34} q ${r * 0.26} ${-r * 0.42} 0 ${-r * 0.76}"/>
      ${Array.from({ length: 4 }, (_, i) => `
        <path d="M${cx - r * 0.40} ${cy + r * (0.20 - i * 0.16)} l ${-r * 0.20} ${-r * 0.10}
                 M${cx + r * 0.40} ${cy + r * (0.20 - i * 0.16)} l ${r * 0.20} ${-r * 0.10}"/>`).join('')}
      <path d="M${cx} ${cy + r * 0.30} V${cy - r * 0.44}" stroke-width="${r * 0.070}"/>
      <path d="M${cx} ${cy - r * 0.42} L${cx + r * 0.30} ${cy - r * 0.28}
               L${cx} ${cy - r * 0.14} Z" fill="#000" stroke-width="${r * 0.03}"/>
    </g>`,
  torch: (cx, cy, r) => `
    <g fill="none" stroke="#000" stroke-width="${r * 0.060}" opacity="0.42"
       stroke-linecap="round">
      <path d="M${cx} ${cy + r * 0.46} V${cy - r * 0.10}"/>
      <path d="M${cx - r * 0.16} ${cy - r * 0.10} h ${r * 0.32}"/>
      <path d="M${cx} ${cy - r * 0.14} q ${-r * 0.22} ${-r * 0.18} ${-r * 0.06} ${-r * 0.44}
               q ${r * 0.10} ${r * 0.14} ${r * 0.06} ${-r * 0.06}
               q ${r * 0.20} ${r * 0.20} ${r * 0.02} ${r * 0.50}" stroke-width="${r * 0.045}"/>
      <path d="M${cx - r * 0.46} ${cy + r * 0.40} q ${r * 0.20} ${-r * 0.24} ${r * 0.34} ${-r * 0.06}
               M${cx + r * 0.46} ${cy + r * 0.40} q ${-r * 0.20} ${-r * 0.24} ${-r * 0.34} ${-r * 0.06}"
            stroke-width="${r * 0.040}"/>
    </g>`,
  hall: (cx, cy, r) => `
    <g fill="none" stroke="#000" stroke-width="${r * 0.055}" opacity="0.42">
      <path d="M${cx - r * 0.52} ${cy + r * 0.40} V${cy - r * 0.06} L${cx} ${cy - r * 0.44}
               L${cx + r * 0.52} ${cy - r * 0.06} V${cy + r * 0.40} Z"/>
      <path d="M${cx - r * 0.52} ${cy + r * 0.40} h ${r * 1.04}" stroke-width="${r * 0.070}"/>
      ${Array.from({ length: 3 }, (_, i) => `
        <path d="M${cx + r * (-0.30 + i * 0.30)} ${cy + r * 0.40} V${cy + r * 0.02}"/>`).join('')}
    </g>`,
  shield: (cx, cy, r) => `
    <g fill="none" stroke="#000" stroke-width="${r * 0.060}" opacity="0.44">
      <path d="M${cx - r * 0.40} ${cy - r * 0.44} h ${r * 0.80} v ${r * 0.36}
               q 0 ${r * 0.42} ${-r * 0.40} ${r * 0.60}
               q ${-r * 0.40} ${-r * 0.18} ${-r * 0.40} ${-r * 0.60} Z"/>
      <path d="M${cx - r * 0.40} ${cy - r * 0.18} h ${r * 0.80}"
            stroke-width="${r * 0.045}"/>
      <path d="M${cx - r * 0.26} ${cy + r * 0.10} L${cx} ${cy - r * 0.06}
               L${cx + r * 0.26} ${cy + r * 0.10}" stroke-width="${r * 0.050}"/>
      <path d="M${cx - r * 0.26} ${cy + r * 0.30} L${cx} ${cy + r * 0.14}
               L${cx + r * 0.26} ${cy + r * 0.30}" stroke-width="${r * 0.050}"/>
    </g>`,
};

const COINS = [
  { v: '25', word: 'QUARTER', tone: '#cdd1d7', reeded: true, device: 'wreath' },
  { v: '10', word: 'DIME', tone: '#c7cbd1', reeded: true, device: 'torch' },
  { v: '5', word: 'NICKEL', tone: '#b6b8b1', reeded: false, device: 'hall' },
  { v: '1', word: 'PENNY', tone: '#b06a35', reeded: false, device: 'shield' },
];

// ----------------------------------------------------------------- cards ----
function cardCell(w, h, spec, i) {
  const g = GLYPHS[GLYPH_KEYS[i % GLYPH_KEYS.length]];
  const num = `${4000 + i * 7} ${1200 + i * 31} ${8800 - i * 13} ${1000 + i * 17}`;
  const holo = spec.holo ? `
    <rect x="${w * 0.70}" y="${h * 0.30}" width="${w * 0.12}" height="${h * 0.20}"
          rx="${h * 0.02}" fill="url(#holo${i})" opacity="0.85"/>` : '';
  // brushed streaks on the metal family; a soft sheen band on the rest
  const texture = spec.fam === 'metal'
    ? Array.from({ length: 26 }, (_, k) =>
      `<rect x="0" y="${(k / 26) * h}" width="${w}" height="${h * 0.016}"
             fill="#ffffff" opacity="${0.020 + (k % 3) * 0.010}"/>`).join('')
    : `<path d="M0 ${h} L${w * 0.62} 0 L${w * 0.86} 0 L0 ${h * 0.72} Z"
             fill="#ffffff" opacity="0.055"/>`;
  return `<g>
    <defs>
      <linearGradient id="cg${i}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${spec.a}"/><stop offset="1" stop-color="${spec.b}"/>
      </linearGradient>
      <linearGradient id="holo${i}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8fd8ff"/><stop offset="0.33" stop-color="#c9a9ff"/>
        <stop offset="0.66" stop-color="#9dffc4"/><stop offset="1" stop-color="#ffe08f"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" rx="${h * 0.075}" fill="url(#cg${i})"/>
    ${texture}
    <!-- EMV chip: a generic contact plate, on every card ever issued -->
    <rect x="${w * 0.075}" y="${h * 0.32}" width="${w * 0.135}" height="${h * 0.195}"
          rx="${h * 0.028}" fill="${spec.accent}"/>
    <g stroke="${spec.b}" stroke-width="${h * 0.011}" opacity="0.65">
      <path d="M${w * 0.075} ${h * 0.417} H${w * 0.21}"/>
      <path d="M${w * 0.1425} ${h * 0.32} V${h * 0.515}"/>
      <path d="M${w * 0.107} ${h * 0.32} V${h * 0.515}"/>
      <path d="M${w * 0.178} ${h * 0.32} V${h * 0.515}"/>
    </g>
    ${holo}
    <!-- The scheme mark moved UP, out of the card number. At 0.640h its box
         spanned 0.53h-0.75h and the number's cap height starts at 0.68h, so the
         two overlapped on every card. Top right, opposite the category. -->
    ${g(w * 0.800, h * 0.255, h * 0.225, spec.accent)}
    <g fill="${spec.ink}" font-family="Helvetica, Arial, sans-serif">
      <text x="${w * 0.075}" y="${h * 0.20}" font-size="${h * 0.088}"
            letter-spacing="${h * 0.030}" opacity="0.9">${spec.cat}</text>
      <!-- embossed pass: a dark offset copy under the light numerals -->
      <text x="${w * 0.072}" y="${h * 0.772}" font-size="${h * 0.112}"
            letter-spacing="${h * 0.007}" fill="${spec.b}" opacity="0.7">${num}</text>
      <text x="${w * 0.070}" y="${h * 0.765}" font-size="${h * 0.112}"
            letter-spacing="${h * 0.007}">${num}</text>
      <text x="${w * 0.070}" y="${h * 0.912}" font-size="${h * 0.050}"
            letter-spacing="${h * 0.010}" opacity="0.62">VALID THRU</text>
      <text x="${w * 0.352}" y="${h * 0.912}" font-size="${h * 0.058}"
            opacity="0.9">${String(1 + (i % 12)).padStart(2, '0')}/3${i % 9}</text>
    </g>
  </g>`;
}

// ----------------------------------------------------------------- notes ----
function noteCell(w, h, spec, wear) {
  const R = h * 0.30;
  const guilloche = Array.from({ length: 11 }, (_, k) =>
    `<circle cx="${w * 0.255}" cy="${h * 0.50}" r="${R * (0.30 + k * 0.075)}"
             fill="none" stroke="${INK}" stroke-width="0.8" opacity="0.22"/>`).join('');
  const border = `
    <rect x="${w * 0.022}" y="${h * 0.055}" width="${w * 0.956}" height="${h * 0.89}"
          fill="none" stroke="${INK}" stroke-width="${h * 0.020}" opacity="0.85"/>
    <rect x="${w * 0.040}" y="${h * 0.090}" width="${w * 0.920}" height="${h * 0.820}"
          fill="none" stroke="${spec.accent}" stroke-width="${h * 0.008}" opacity="0.75"/>`;
  const lathe = Array.from({ length: 40 }, (_, k) =>
    `<line x1="${w * 0.040 + k * (w * 0.92 / 40)}" y1="${h * 0.090}"
           x2="${w * 0.040 + k * (w * 0.92 / 40)}" y2="${h * 0.145}"
           stroke="${INK}" stroke-width="0.7" opacity="0.28"/>`).join('');
  const corners = [[0.10, 0.235], [0.90, 0.235], [0.10, 0.845], [0.90, 0.845]]
    .map(([cx, cy]) => `<text x="${w * cx}" y="${h * cy}" font-size="${h * 0.145}"
           text-anchor="middle" font-family="Georgia, serif" font-weight="bold"
           fill="${INK}">${spec.v}</text>`).join('');
  return `<g>
    <rect width="${w}" height="${h}" fill="${PAPER}"/>
    <rect width="${w}" height="${h}" fill="${spec.accent}" opacity="0.16"/>
    <rect width="${w}" height="${h}" fill="#2f6b3d" opacity="0.18"/>
    ${border}${lathe}${guilloche}
    <!-- portrait oval: a plate, not a person -->
    <ellipse cx="${w * 0.255}" cy="${h * 0.50}" rx="${R * 0.70}" ry="${R * 0.95}"
             fill="#f2f4e2" opacity="0.42"/>
    <ellipse cx="${w * 0.255}" cy="${h * 0.50}" rx="${R * 0.70}" ry="${R * 0.95}"
             fill="none" stroke="${INK}" stroke-width="${h * 0.012}" opacity="0.8"/>
    <g opacity="0.95">${SCENES[spec.scene](w * 0.255, h * 0.50, R * 0.62, INK)}</g>
    <g font-family="Georgia, serif" fill="${INK}">
      <text x="${w * 0.635}" y="${h * 0.395}" font-size="${h * 0.150}"
            text-anchor="middle" letter-spacing="${h * 0.028}">UNITS</text>
      <text x="${w * 0.635}" y="${h * 0.615}" font-size="${h * 0.230}"
            text-anchor="middle" font-weight="bold">${spec.word}</text>
      <text x="${w * 0.655}" y="${h * 0.760}" font-size="${h * 0.060}"
            text-anchor="middle" letter-spacing="${h * 0.008}"
            opacity="0.8">LEGAL TENDER FOR ALL DEBTS</text>
    </g>
    <!-- serial band -->
    <g font-family="Courier New, monospace" fill="${spec.accent}">
      <text x="${w * 0.400}" y="${h * 0.885}" font-size="${h * 0.085}"
            letter-spacing="${h * 0.012}">${String.fromCharCode(65 + (+spec.v % 7))}${
              String(1043 + (+spec.v) * 977).padStart(8, '0')}${
              String.fromCharCode(72 + (+spec.v % 5))}</text>
    </g>
    ${corners}
    ${wear ? `<rect width="${w}" height="${h}" fill="#6b5f43" opacity="${wear * 0.16}"/>
      <path d="M0 ${h * 0.34} Q ${w * 0.5} ${h * 0.30} ${w} ${h * 0.37}"
            stroke="#6b5f43" stroke-width="${h * 0.014}" fill="none" opacity="0.30"/>` : ''}
  </g>`;
}

// ----------------------------------------------------------------- coins ----
function coinCell(w, h, spec) {
  const r = Math.min(w, h) * 0.46;
  const cx = w / 2, cy = h / 2;
  const reeds = spec.reeded ? Array.from({ length: 72 }, (_, k) => {
    const a = (k / 72) * Math.PI * 2;
    return `<line x1="${cx + Math.cos(a) * r * 0.905}" y1="${cy + Math.sin(a) * r * 0.905}"
                  x2="${cx + Math.cos(a) * r}" y2="${cy + Math.sin(a) * r}"
                  stroke="#000" stroke-width="1.3" opacity="0.26"/>`;
  }).join('') : '';
  const device = DEVICES[spec.device](cx, cy, r);
  const legend = Array.from({ length: 26 }, (_, k) => {
    const a = (k / 26) * Math.PI * 2 - Math.PI / 2;
    return `<circle cx="${cx + Math.cos(a) * r * 0.74}" cy="${cy + Math.sin(a) * r * 0.74}"
                    r="${r * 0.015}" fill="#000" opacity="0.28"/>`;
  }).join('');
  return `<g>
    <rect width="${w}" height="${h}" fill="${spec.tone}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${spec.tone}"/>
    <!-- raised rim: a bright ring inside a dark one -->
    <circle cx="${cx}" cy="${cy}" r="${r * 0.94}" fill="none" stroke="#000"
            stroke-width="${r * 0.055}" opacity="0.20"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.885}" fill="none" stroke="#fff"
            stroke-width="${r * 0.030}" opacity="0.30"/>
    ${reeds}${legend}${device}
    <g text-anchor="middle" font-family="Georgia, serif" fill="#000">
      <text x="${cx}" y="${cy + r * 0.60}" font-size="${r * 0.22}"
            letter-spacing="${r * 0.03}" opacity="0.42">${spec.word}</text>
      <text x="${cx - r * 0.60}" y="${cy + r * 0.12}" font-size="${r * 0.34}"
            font-weight="bold" opacity="0.45">${spec.v}</text>
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

// A blunt sweep for the thing that got us here. Any near-miss of a real scheme
// mark is a letter, so the check is mechanical rather than a memory of having
// been careful.
const banned = /mastercard|visa|amex|american express|maestro|discover|unionpay|jcb|interlock/i;
for (const [name, cells] of [['cards', cardCells], ['notes', noteCells], ['coins', coinCells]]) {
  const joined = cells.join('');
  if (banned.test(joined)) throw new Error(`${name}: a real scheme name is in the artwork`);
  const circles = [...joined.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/g)]
    .map((m) => m.slice(1).map(Number));
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const [ax, ay, ar] = circles[i], [bx, by, br] = circles[j];
      const d = Math.hypot(ax - bx, ay - by);
      // overlapping but not concentric = interlocking rings
      if (d > 1e-6 && d < ar + br && d > Math.abs(ar - br)) {
        throw new Error(
          `${name}: two circles at (${ax},${ay}) r${ar} and (${bx},${by}) r${br} ` +
          `overlap without being concentric — that is the Mastercard shape`);
      }
    }
  }
  console.log(`${name}: no scheme name, ${circles.length} circles, none interlocking`);
}

// CARDS ONLY. The notes and coins this file used to emit are superseded by
// make_money_art2.mjs, which builds them from the 1935-series reference -- six
// denominations with their own tint, device and rosette count, and coins with a
// real device, a beaded rim and a legend ring. Leaving the old writers here
// meant whichever generator ran last won, and the old flat-green notes kept
// coming back.
for (const [name, svg] of [
  ['money_cards.png', atlas(CARD_COLS, CARD_ROWS, 512, 323, cardCells)],
]) {
  const file = path.join(OUT, name);
  await sharp(Buffer.from(svg)).png().toFile(file);
  const m = await sharp(file).metadata();
  console.log(`${name}  ${m.width}x${m.height}  ${fs.statSync(file).size} bytes`);
}
