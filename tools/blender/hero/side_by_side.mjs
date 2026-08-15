// Put the reference beside the render, in one image.
//
// The brief asks for the reference next to the result every round, and a
// reference that lives in a different file is a reference nobody looks at. This
// pads both to the same height and writes one strip, so the comparison is
// unavoidable rather than optional.
//
//   node tools/blender/hero/side_by_side.mjs <out.png> <left.png> <right.png> [...]
import sharp from 'sharp';
import path from 'node:path';

const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length < 2) {
  console.error('usage: side_by_side.mjs <out.png> <a.png> <b.png> [...]');
  process.exit(2);
}

const HEIGHT = 760;
const GAP = 12;

const tiles = [];
for (const file of inputs) {
  const buf = await sharp(file)
    .resize({ height: HEIGHT, fit: 'contain', background: { r: 24, g: 24, b: 26 } })
    .png()
    .toBuffer();
  const meta = await sharp(buf).metadata();
  tiles.push({ buf, width: meta.width, file });
}

const width = tiles.reduce((n, t) => n + t.width, 0) + GAP * (tiles.length - 1);
let x = 0;
const composite = [];
for (const t of tiles) {
  composite.push({ input: t.buf, left: x, top: 0 });
  x += t.width + GAP;
}

await sharp({
  create: { width, height: HEIGHT, channels: 3, background: { r: 24, g: 24, b: 26 } },
}).composite(composite).png().toFile(out);

console.log(`${path.basename(out)}  ${width}x${HEIGHT}  <- ${inputs.map((f) => path.basename(f)).join(' | ')}`);
