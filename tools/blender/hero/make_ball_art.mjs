// Golf ball packaging art, laid out FOR THE BOX IT IS PRINTED ON.
//
// The brief: "MAKE THE NAMES FIT THE BOX. Right now they do not sit properly on
// the packaging. Lay the type out for the box it is actually printed on -- a
// sleeve of three and a dozen box are different shapes and need different
// layouts."
//
// A sleeve is a tall narrow tube: the brand runs across a short width, so it is
// set small and stacked, with the model name beneath and a colour band at the
// foot. A dozen box is a wide shallow slab: the brand is the whole front, set
// large across the long axis, with the model name as a strapline. Same words,
// two completely different settings -- which is the point.
//
// Reference: ref/balls/ball-boxes.jpg -- glossy dark card, metallic type,
// colour blocking, a feature list in a ruled column, a ball photograph.
//
// Names are invented. Nothing here is a golf brand, a near-miss of one, or a
// real course.
//
//   node tools/blender/hero/make_ball_art.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join('Assets', 'models', 'hero', 'textures');
mkdirSync(OUT, { recursive: true });

const LINES = [
  { brand: 'KESTREL', model: 'X-1 TOUR', tag: 'THREE PIECE URETHANE',
    ink: '#e8c877', dark: '#12161c', accent: '#b8341f' },
  { brand: 'LONGSPUR', model: 'SOFT FEEL', tag: 'TWO PIECE IONOMER',
    ink: '#f0f0ea', dark: '#16303c', accent: '#4aa3c4' },
  { brand: 'VANTAGE', model: 'DISTANCE', tag: 'HIGH LAUNCH CORE',
    ink: '#1d2126', dark: '#e6e2d6', accent: '#2f7a46' },
  { brand: 'HALCYON', model: 'LADY 55', tag: 'LOW COMPRESSION',
    ink: '#3a2030', dark: '#f2e3ea', accent: '#c0567f' },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// --- a sleeve of three: 4 side panels in a row, 256 x 768 each -------------
function sleeveWrap(L) {
  const W = 256, H = 768;
  const panel = (main) => `
    <rect width="${W}" height="${H}" fill="${L.dark}"/>
    <rect x="0" y="${H - 150}" width="${W}" height="150" fill="${L.accent}"/>
    <rect x="0" y="${H - 156}" width="${W}" height="6" fill="${L.ink}" opacity="0.75"/>
    ${main ? `
      <text x="${W / 2}" y="118" text-anchor="middle" font-family="Georgia,serif"
            font-size="46" letter-spacing="3" fill="${L.ink}">${esc(L.brand)}</text>
      <line x1="42" y1="146" x2="${W - 42}" y2="146" stroke="${L.ink}"
            stroke-width="2" opacity="0.6"/>
      <text x="${W / 2}" y="196" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
            font-size="27" letter-spacing="6" fill="${L.accent}">${esc(L.model)}</text>
      <circle cx="${W / 2}" cy="382" r="86" fill="#f4f4f0"/>
      ${dimpleDots(W / 2, 382, 86)}
      <text x="${W / 2}" y="${H - 88}" text-anchor="middle"
            font-family="Helvetica,Arial,sans-serif" font-size="52"
            font-weight="bold" letter-spacing="2" fill="${L.dark}">3</text>
      <text x="${W / 2}" y="${H - 46}" text-anchor="middle"
            font-family="Helvetica,Arial,sans-serif" font-size="21"
            letter-spacing="5" fill="${L.dark}">BALLS</text>
    ` : `
      <text x="${W / 2}" y="${H / 2}" text-anchor="middle"
            font-family="Georgia,serif" font-size="30" letter-spacing="10"
            fill="${L.ink}" opacity="0.85"
            transform="rotate(-90 ${W / 2} ${H / 2})">${esc(L.brand)}</text>
    `}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 4}" height="${H}">
    <g>${panel(true)}</g>
    <g transform="translate(${W},0)">${panel(false)}</g>
    <g transform="translate(${W * 2},0)">${panel(true)}</g>
    <g transform="translate(${W * 3},0)">${panel(false)}</g>
  </svg>`;
}

// a ring of dimple shadows, so the printed ball reads as a golf ball
function dimpleDots(cx, cy, r) {
  let s = '';
  for (let ring = 1; ring <= 4; ring++) {
    const rr = (r * 0.86) * (ring / 4.4);
    const n = 6 + ring * 5;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n + ring * 0.31;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.062).toFixed(1)}"
             fill="#000" opacity="0.10"/>`;
    }
  }
  return s;
}

// --- a dozen box: front, top, end, in one 1024 x 512 sheet -----------------
function dozenSheet(L) {
  const W = 1024, H = 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${L.dark}"/>

    <!-- FRONT face, 0,0 - 640,256: the brand runs the long axis, set large -->
    <rect x="0" y="0" width="640" height="256" fill="${L.dark}"/>
    <rect x="0" y="214" width="640" height="42" fill="${L.accent}"/>
    <text x="34" y="112" font-family="Georgia,serif" font-size="76"
          letter-spacing="6" fill="${L.ink}">${esc(L.brand)}</text>
    <line x1="34" y1="136" x2="606" y2="136" stroke="${L.ink}" stroke-width="3"
          opacity="0.55"/>
    <text x="34" y="182" font-family="Helvetica,Arial,sans-serif" font-size="34"
          letter-spacing="9" fill="${L.accent}">${esc(L.model)}</text>
    <text x="34" y="245" font-family="Helvetica,Arial,sans-serif" font-size="19"
          letter-spacing="4" fill="${L.dark}">${esc(L.tag)}</text>
    <text x="606" y="245" text-anchor="end" font-family="Helvetica,Arial,sans-serif"
          font-size="22" font-weight="bold" letter-spacing="3"
          fill="${L.dark}">12 BALLS</text>
    <circle cx="536" cy="86" r="52" fill="#f4f4f0"/>
    ${dimpleDots(536, 86, 52)}

    <!-- TOP face, 640,0 - 1024,256 -->
    <rect x="640" y="0" width="384" height="256" fill="${L.dark}"/>
    <text x="832" y="118" text-anchor="middle" font-family="Georgia,serif"
          font-size="52" letter-spacing="4" fill="${L.ink}">${esc(L.brand)}</text>
    <text x="832" y="162" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
          font-size="24" letter-spacing="7" fill="${L.accent}">${esc(L.model)}</text>
    <rect x="700" y="196" width="264" height="30" fill="${L.accent}"/>
    <text x="832" y="218" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
          font-size="19" letter-spacing="5" fill="${L.dark}">ONE DOZEN</text>

    <!-- BACK face, 0,256 - 768,512. Laid out for a 768x256 panel. -->
    <rect x="0" y="256" width="768" height="256" fill="${L.dark}"/>
    <text x="384" y="330" text-anchor="middle" font-family="Georgia,serif"
          font-size="38" letter-spacing="7" fill="${L.ink}"
          opacity="0.9">${esc(L.brand)} &#183; ${esc(L.model)}</text>
    ${[0, 1, 2].map((i) => `
      <line x1="120" y1="${372 + i * 40}" x2="648" y2="${372 + i * 40}"
            stroke="${L.ink}" stroke-width="2" opacity="0.28"/>
      <text x="120" y="${366 + i * 40}" font-family="Helvetica,Arial,sans-serif"
            font-size="17" letter-spacing="2" fill="${L.ink}" opacity="0.65">
        ${['DRIVER DISTANCE', 'COVER DURABILITY', 'SCORING CONTROL'][i]}</text>
      <rect x="${520}" y="${352 + i * 40}" width="${[104, 80, 92][i]}" height="10"
            fill="${L.accent}" opacity="0.9"/>`).join('')}

    <!-- END face, 768,256 - 1024,392. ITS OWN PANEL at ITS OWN ASPECT (1.88),
         because the end of a dozen box is 92 x 49 mm and type laid out for the
         768-wide back arrives on it cropped: the square-on render read
         "STREL . X-1 TOU". -->
    <rect x="768" y="256" width="256" height="136" fill="${L.dark}"/>
    <rect x="768" y="374" width="256" height="18" fill="${L.accent}"/>
    <text x="896" y="304" text-anchor="middle" font-family="Georgia,serif"
          font-size="30" letter-spacing="3" fill="${L.ink}">${esc(L.brand)}</text>
    <text x="896" y="336" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
          font-size="16" letter-spacing="4" fill="${L.accent}">${esc(L.model)}</text>
    <text x="896" y="366" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
          font-size="17" font-weight="bold" letter-spacing="3"
          fill="${L.ink}">12 BALLS</text>
    <rect x="768" y="392" width="256" height="120" fill="${L.dark}"/>
  </svg>`;
}

for (let i = 0; i < LINES.length; i++) {
  const L = LINES[i];
  const tag = L.brand.toLowerCase();
  await sharp(Buffer.from(sleeveWrap(L))).png()
    .toFile(path.join(OUT, `ball_sleeve_${tag}.png`));
  await sharp(Buffer.from(dozenSheet(L))).png()
    .toFile(path.join(OUT, `ball_dozen_${tag}.png`));
  console.log(`${L.brand} ${L.model}: sleeve 1024x768, dozen 1024x512`);
}
