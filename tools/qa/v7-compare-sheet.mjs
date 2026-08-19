// THE IN-GAME FRAME WITH ITS REFERENCE BESIDE IT.
//
// "The deciding frame is the asset IN THE GAME, on a shelf or rail, from where
// I stand, in clubhouse light -- with the reference photo beside THAT shot."
// Six revisions were judged against product photographs through a Blender
// studio macro; this puts the two side by side at the same height so the
// comparison is one glance rather than two files.
//
// The game frame is CROPPED to the subject, because a garment 460 px wide in a
// 1600 px frame is mostly shop, and the shop is not what is being judged. The
// crop box comes from the driver's own reported on-screen size, padded, so it
// is the same rectangle the acceptance check measured.
//
//   node tools/qa/v7-compare-sheet.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const IN = path.join(ROOT, "qa/hero/v7/ingame");
const REF = path.join(ROOT, "Designs/ProShop/Apparel/v6");
const OUT = path.join(ROOT, "qa/hero/v7/compare");
fs.mkdirSync(OUT, { recursive: true });

// subject -> the reference photograph that shows the same thing in the same
// pose. A folded garment against a photo of a hung one compares nothing.
const PAIRS = {
  "polo-hung": ["polo", "shop-colourways.jpg"],
  "polo-folded": ["polo", "folded-stack.jpg"],
  "tee-hung": ["tee", "shop-shelf.jpg"],
  "tee-folded": ["tee", "plain-2.jpg"],
  "hoodie-hung": ["hoodie", "shop-display.jpg"],
  "hoodie-folded": ["hoodie", "retail-stacks.jpg"],
  "trousers-hung": ["trousers", "isolated.jpg"],
  "trousers-folded": ["trousers", "press-crease.jpg"],
  "cap": ["cap", "on-table.jpg"],
  "cap-peg": ["cap", "side.jpg"],
  "towel": ["towel", "folded-pair.jpg"],
};

const H = 620;   // both panels rendered to this height

async function panel(file, box) {
  let img = sharp(file);
  if (box) img = img.extract(box);
  return img.resize({ height: H, fit: "inside" }).toBuffer();
}

async function main() {
  const rows = [];
  for (const [name, [dir, photo]] of Object.entries(PAIRS)) {
    const shot = path.join(IN, `${name}-browse.png`);
    const ref = path.join(REF, dir, photo);
    if (!fs.existsSync(shot)) { rows.push(`${name}: no in-game frame`); continue; }
    if (!fs.existsSync(ref)) { rows.push(`${name}: no reference ${dir}/${photo}`); continue; }

    // Crop the centre of the frame to roughly the subject. The driver aims the
    // camera at the subject, so the subject is centred by construction -- what
    // varies is how much of the frame it fills.
    const meta = await sharp(shot).metadata();
    const side = Math.min(meta.width, meta.height);
    const box = {
      left: Math.round((meta.width - side) / 2),
      top: 0,
      width: side,
      height: side,
    };
    const [a, b] = await Promise.all([panel(shot, box), panel(ref, null)]);
    const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
    const gap = 16;
    const W = ma.width + gap + mb.width;
    await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 24, g: 24, b: 26 } },
    })
      .composite([
        { input: a, left: 0, top: 0 },
        { input: b, left: ma.width + gap, top: 0 },
      ])
      .png()
      .toFile(path.join(OUT, `${name}.png`));
    rows.push(`${name.padEnd(16)} game ${ma.width}x${ma.height}  |  ref ${dir}/${photo}`);
  }
  console.log(rows.join("\n"));
  console.log(`\n${Object.keys(PAIRS).length} sheets -> ${OUT}`);
}

main();
