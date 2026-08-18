// The cap beside the cap it was built from, in the SAME THREE VIEWS.
//
// side_by_side.mjs makes one strip, which is fine for two images and useless
// for a matched set: a comparison you cannot line up is a comparison nobody
// makes. The reference row and the render row are stacked here so front sits
// over front and rear over rear, which is the only arrangement in which the
// crown profile is arguable.
//
//   node tools/blender/hero/cap_vs_ref.mjs [way]
import sharp from 'sharp';
import path from 'node:path';
import { existsSync } from 'node:fs';

const way = process.argv[2] || 'cream';
const REF = path.join('ref', 'apparel');
const OUT = path.join('qa', 'hero', 'apparel_v2', 'cap');
const R = path.join(OUT, way);

const COLS = [
  ['front', 'cap-bfp-front.jpg', `cap-${way}-front.png`],
  ['side', 'cap-bfp-left.jpg', `cap-${way}-side.png`],
  ['rear', 'cap-bfp-rear.jpg', `cap-${way}-rear.png`],
];

const W = 620, H = 620, GAP = 10, LABEL = 34;

async function tile(file, label) {
  const buf = await sharp(file)
    .resize({ width: W, height: H, fit: 'contain',
              background: { r: 22, g: 22, b: 24 } })
    .png().toBuffer();
  const cap = Buffer.from(
    `<svg width="${W}" height="${LABEL}"><rect width="${W}" height="${LABEL}"
     fill="#16161a"/><text x="10" y="24" font-family="Helvetica,Arial"
     font-size="17" fill="#c8c8c4">${label}</text></svg>`);
  return sharp({ create: { width: W, height: H + LABEL, channels: 3,
                           background: { r: 22, g: 22, b: 24 } } })
    .composite([{ input: cap, left: 0, top: 0 }, { input: buf, left: 0, top: LABEL }])
    .png().toBuffer();
}

const comp = [];
for (let i = 0; i < COLS.length; i++) {
  const [name, ref, render] = COLS[i];
  const rp = path.join(R, render);
  if (!existsSync(rp)) throw new Error(`missing render ${rp}`);
  comp.push({ input: await tile(path.join(REF, ref), `REFERENCE  ${name}`),
              left: i * (W + GAP), top: 0 });
  comp.push({ input: await tile(rp, `V2  ${name}`),
              left: i * (W + GAP), top: H + LABEL + GAP });
}

const out = path.join(OUT, `cap-vs-ref-${way}.png`);
await sharp({ create: { width: COLS.length * W + (COLS.length - 1) * GAP,
                        height: 2 * (H + LABEL) + GAP, channels: 3,
                        background: { r: 12, g: 12, b: 14 } } })
  .composite(comp).png().toFile(out);
console.log(out);

// and the one that answers "was this worth starting over": v1 beside v2
const v1 = path.join('qa', 'hero', 'apparel', 'cap', 'cap-hero.png');
if (existsSync(v1)) {
  const pair = [
    { input: await tile(v1, 'V1  hero  (7,064 tris)'), left: 0, top: 0 },
    { input: await tile(path.join(R, `cap-${way}-threequarter.png`),
                        'V2  three-quarter  (11,874 tris)'),
      left: W + GAP, top: 0 },
  ];
  const o2 = path.join(OUT, 'v1-vs-v2.png');
  await sharp({ create: { width: 2 * W + GAP, height: H + LABEL, channels: 3,
                          background: { r: 12, g: 12, b: 14 } } })
    .composite(pair).png().toFile(o2);
  console.log(o2);
}
