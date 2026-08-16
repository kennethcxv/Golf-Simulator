// Printed artwork for the checkout bag and the customer basket.
//
// A paper grocery sack is PRINTED, not tinted: one or two inks on kraft, a
// wordmark, a mark, and the small legal print near the base. Modelling the bag
// and leaving it a flat brown gives you a shape with no product on it, which is
// what "very plain" means.
//
// Drawn as SVG and rasterised, so the marks are vector-crisp at 1024 and the
// source is editable text rather than a baked image nobody can change.
//
// The bag art leaves the middle of the front panel CLEAR: the game drops a
// dynamic brand plane there at runtime (CHECKOUT_DISPLAY_BRAND_PRESENTATION
// .bagPanel, 0.176 x 0.118 at y 0.150), and printing under it would show two
// shop names stacked on each other.
//
//   node tools/blender/hero/make_bag_art.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('Assets/models/hero/textures');
fs.mkdirSync(OUT, { recursive: true });

const KRAFT = '#7a5230';
const KRAFT_DARK = '#6b4629';
const INK = '#1f3a2b';          // a single dark green ink
const INK_SOFT = '#2d4a37';

/** A golf roundel: flagstick on a green, inside a ring. */
function roundel(cx, cy, r) {
  return `
    <g transform="translate(${cx} ${cy})">
      <circle r="${r}" fill="none" stroke="${INK}" stroke-width="${r * 0.075}"/>
      <circle r="${r * 0.86}" fill="none" stroke="${INK}" stroke-width="${r * 0.022}"/>
      <path d="M ${-r * 0.55} ${r * 0.30}
               q ${r * 0.55} ${-r * 0.26} ${r * 1.10} 0
               q ${-r * 0.55} ${r * 0.20} ${-r * 1.10} 0 Z"
            fill="${INK}" opacity="0.92"/>
      <rect x="${r * 0.06}" y="${-r * 0.56}" width="${r * 0.055}" height="${r * 0.88}" fill="${INK}"/>
      <path d="M ${r * 0.115} ${-r * 0.54} L ${r * 0.56} ${-r * 0.40}
               L ${r * 0.115} ${-r * 0.26} Z" fill="${INK}"/>
      <circle cx="${-r * 0.30}" cy="${r * 0.20}" r="${r * 0.055}" fill="#f2ede2"/>
    </g>`;
}

function bagPrint() {
  // THE CANVAS IS NOT SQUARE. u wraps the whole 1.0555 yd perimeter while v
  // covers 0.4722 yd of height, so a square sheet is stretched 2.24x vertically
  // on the bag and every circle in the artwork became a wide ellipse.
  const ASPECT = (2 * (0.33333 + 0.19444)) / 0.47222;
  const W = 1600;
  const H = Math.round(W / ASPECT);
  // PANEL BOUNDS ARE DERIVED, not guessed. The wrap is arc-length parameterised
  // from the first corner, so the front panel's share of the perimeter is
  // exactly its width over the perimeter -- placing art by eye put the wordmark
  // half off the left edge of the sheet.
  const WIDTH = 0.33333;
  const DEPTH = 0.19444;
  const P = 2 * (WIDTH + DEPTH);
  const fw = WIDTH / P;              // a long panel's share
  const dw = DEPTH / P;              // a short panel's share
  const front = { u0: 0.0, u1: fw };
  const back = { u0: fw + dw, u1: fw + dw + fw };
  const px = (u) => u * W;
  const frontCx = px((front.u0 + front.u1) / 2);
  const frontW = px(front.u1 - front.u0);
  const backCx = px((back.u0 + back.u1) / 2);
  // text-anchor="middle" centres the ADVANCE WIDTH, which includes the trailing
  // letter-space, so a letterspaced wordmark sits half a space left of where it
  // looks like it should. Correcting it here rather than nudging by eye.
  const nudge = (ls) => ls / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="k" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#835838"/>
        <stop offset="0.5" stop-color="${KRAFT}"/>
        <stop offset="1" stop-color="${KRAFT_DARK}"/>
      </linearGradient>
      <pattern id="fibre" width="9" height="9" patternUnits="userSpaceOnUse">
        <rect width="9" height="9" fill="none"/>
        <path d="M0 2 H9 M0 6 H9" stroke="#906138" stroke-width="0.9" opacity="0.34"/>
        <path d="M4 0 V9" stroke="#684325" stroke-width="0.8" opacity="0.26"/>
      </pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#k)"/>
    <rect width="${W}" height="${H}" fill="url(#fibre)"/>

    <!-- FRONT PANEL. Mark and wordmark high; the middle band is deliberately
         empty because the game drops a dynamic brand plane at 32% height. -->
    ${roundel(frontCx, H * 0.235, frontW * 0.155)}
    <g text-anchor="middle" fill="${INK}" font-family="Georgia, 'Times New Roman', serif">
      <text x="${frontCx + nudge(frontW * 0.014)}" y="${H * 0.455}"
            font-size="${frontW * 0.112}" letter-spacing="${frontW * 0.014}"
            font-weight="bold">PINE HILLS</text>
      <text x="${frontCx + nudge(frontW * 0.032)}" y="${H * 0.520}"
            font-size="${frontW * 0.045}" letter-spacing="${frontW * 0.032}"
            fill="${INK_SOFT}">GOLF CLUB</text>
    </g>
    <path d="M ${frontCx - frontW * 0.30} ${H * 0.560} H ${frontCx + frontW * 0.30}"
          stroke="${INK}" stroke-width="2.5" opacity="0.75"/>
    <path d="M ${frontCx - frontW * 0.22} ${H * 0.578} H ${frontCx + frontW * 0.22}"
          stroke="${INK}" stroke-width="1.2" opacity="0.55"/>
    <g text-anchor="middle" fill="${INK_SOFT}"
       font-family="Helvetica, Arial, sans-serif" opacity="0.82">
      <text x="${frontCx + nudge(frontW * 0.006)}" y="${H * 0.905}"
            font-size="${frontW * 0.030}" letter-spacing="${frontW * 0.006}">100% RECYCLED KRAFT</text>
      <text x="${frontCx + nudge(frontW * 0.010)}" y="${H * 0.960}"
            font-size="${frontW * 0.028}" letter-spacing="${frontW * 0.010}">PLEASE REUSE</text>
    </g>

    <!-- BACK PANEL: the mark alone, smaller. -->
    ${roundel(backCx, H * 0.295, frontW * 0.105)}
    <g text-anchor="middle" fill="${INK_SOFT}"
       font-family="Georgia, 'Times New Roman', serif">
      <text x="${backCx + nudge(frontW * 0.020)}" y="${H * 0.500}"
            font-size="${frontW * 0.058}" letter-spacing="${frontW * 0.020}">PINE HILLS</text>
    </g>

    <!-- Fold rules on the gusset boundaries, where the printed sack's own
         creases fall. -->
    ${[front.u1, back.u0, back.u1].map((u) =>
      `<path d="M ${px(u)} 0 V ${H}" stroke="${INK}" stroke-width="1.1" opacity="0.22"/>`
    ).join('')}
  </svg>`;
}

function basketArt() {
  // A PLAQUE, not a panel: this maps to the moulded badge on the basket's front
  // face, so the sheet is the badge's own shape rather than a square with a
  // badge floating in it.
  const W = 1024;
  const H = 320;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="p" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1c4c31"/>
        <stop offset="1" stop-color="#143725"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#p)"/>
    <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="14" fill="none"
          stroke="#7fa98c" stroke-width="3" opacity="0.55"/>
    ${roundel(W * 0.145, H * 0.50, H * 0.31).replace(/#1f3a2b/g, '#dfe8dc')
      .replace(/#f2ede2/g, '#1c4c31')}
    <g font-family="Helvetica, Arial, sans-serif">
      <!-- Sized to FIT. At 0.36H starting at 0.295W the wordmark ran 765 px
           across a 1024 px plate, overflowed the sheet, and the clipped
           letterforms came out as a white blob band above the badge. -->
      <text x="${W * 0.275}" y="${H * 0.47}" font-size="${H * 0.255}" fill="#f0e9d8"
            font-weight="bold" letter-spacing="${H * 0.020}">PINE HILLS</text>
      <text x="${W * 0.280}" y="${H * 0.80}" font-size="${H * 0.130}" fill="#b6cdbc"
            letter-spacing="${H * 0.072}">PRO SHOP</text>
    </g>
  </svg>`;
}

function ledgerPage() {
  // A LEDGER, not a sketchbook. The player studies this one, and what makes it
  // read as an account book rather than blank paper is the ruling: a red
  // margin, blue feint lines, and money columns at the right.
  const W = 1024;
  const H = 1400;
  const PAPER = '#d9cfb4';
  // HEAVIER AND DARKER. At 1.6 px and 0.55 opacity over a 230 mm page, under
  // AgX at -0.9 EV, the ruling rendered as blank paper -- and the ruling is the
  // entire reason this object is a ledger rather than a sketchbook. The owner
  // studies this one at reading distance.
  const FEINT = '#5d6f85';
  const RED = '#93392f';
  const rows = 34;
  let lines = '';
  for (let i = 0; i < rows; i += 1) {
    const y = H * 0.115 + i * ((H * 0.855) / rows);
    lines += `<path d="M ${W * 0.055} ${y} H ${W * 0.955}" stroke="${FEINT}"
                    stroke-width="3.0" opacity="0.88"/>`;
  }
  let cols = '';
  for (const x of [0.145, 0.660, 0.760, 0.860]) {
    cols += `<path d="M ${W * x} ${H * 0.075} V ${H * 0.975}" stroke="${FEINT}"
                   stroke-width="3.6" opacity="0.92"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${PAPER}"/>
    ${lines}${cols}
    <path d="M ${W * 0.105} 0 V ${H}" stroke="${RED}" stroke-width="5.0" opacity="0.92"/>
    <path d="M ${W * 0.055} ${H * 0.085} H ${W * 0.955}" stroke="${FEINT}"
          stroke-width="5.4" opacity="0.95"/>
    <g font-family="Georgia, serif" fill="#33301f" opacity="0.95">
      <text x="${W * 0.165}" y="${H * 0.062}" font-size="${W * 0.028}">DATE / PARTICULARS</text>
      <text x="${W * 0.672}" y="${H * 0.062}" font-size="${W * 0.024}">DR</text>
      <text x="${W * 0.772}" y="${H * 0.062}" font-size="${W * 0.024}">CR</text>
      <text x="${W * 0.872}" y="${H * 0.062}" font-size="${W * 0.024}">BAL</text>
    </g>
  </svg>`;
}

/** The pasted title label on the closed ledger's front board. */
function ledgerLabel() {
  const W = 768, H = 384;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#efeade"/>
    <rect x="${W * 0.035}" y="${H * 0.055}" width="${W * 0.930}" height="${H * 0.890}"
          fill="none" stroke="${INK}" stroke-width="${H * 0.020}"/>
    <rect x="${W * 0.058}" y="${H * 0.095}" width="${W * 0.884}" height="${H * 0.810}"
          fill="none" stroke="${INK_SOFT}" stroke-width="${H * 0.008}" opacity="0.7"/>
    <g text-anchor="middle" font-family="Georgia, serif" fill="${INK}">
      <text x="${W / 2}" y="${H * 0.325}" font-size="${H * 0.185}"
            letter-spacing="${H * 0.028}">DAY BOOK</text>
      <text x="${W / 2}" y="${H * 0.475}" font-size="${H * 0.078}"
            letter-spacing="${H * 0.030}" opacity="0.82">PINE HILLS GOLF CLUB</text>
      <text x="${W / 2}" y="${H * 0.855}" font-size="${H * 0.070}"
            letter-spacing="${H * 0.022}" opacity="0.72">ACCOUNTS &#183; SEASON I</text>
    </g>
    <path d="M${W * 0.30} ${H * 0.560} H${W * 0.70}" stroke="${INK}"
          stroke-width="${H * 0.011}" opacity="0.75"/>
    <path d="M${W * 0.24} ${H * 0.700} H${W * 0.76}" stroke="${INK_SOFT}"
          stroke-width="${H * 0.007}" opacity="0.55"/>
    <path d="M${W * 0.24} ${H * 0.745} H${W * 0.76}" stroke="${INK_SOFT}"
          stroke-width="${H * 0.007}" opacity="0.55"/>
  </svg>`;
}

for (const [name, svg, size] of [
  ['ledger_page.png', ledgerPage(), null],
  ['ledger_label.png', ledgerLabel(), null],
  ['checkout_bag_print.png', bagPrint(), null],
  ['customer_basket_print.png', basketArt(), null],
]) {
  const file = path.join(OUT, name);
  const img = sharp(Buffer.from(svg));
  await (size ? img.resize(size, size) : img).png().toFile(file);
  const meta = await sharp(file).metadata();
  console.log(`${name}  ${meta.width}x${meta.height}  ${fs.statSync(file).size} bytes`);
}
