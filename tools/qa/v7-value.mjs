// HOW DARK IS IT, ACTUALLY?
//
// "It looks black" is not a number and cannot be driven to a target. Every
// garment in this set was authored at a plausible albedo -- the polo's is
// linear 0.217, which is sRGB 0.50, a mid grey -- and every one of them
// arrives on screen as a silhouette. Something between the albedo and the
// pixel is eating roughly a stop and a half, and the candidates (baked vertex
// occlusion, the normal map, the room's light) are only separable by turning
// them off one at a time and MEASURING.
//
// So: mean value of the garment's own pixels, against the same measure taken
// on the reference photograph. The garment is centred in frame by the
// acceptance driver, so a centre window is the garment; the window is kept
// small enough to miss the staging board and the wall.
//
//   node tools/qa/v7-value.mjs polo-hung tee-hung trousers-hung
//   node tools/qa/v7-value.mjs --ab polo-hung        # base vs -no-ao vs -no-normal
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const IN = path.resolve("qa/hero/v7/ingame");
const REF = path.resolve("Designs/ProShop/Apparel/v6");

// A window at the centre of the frame, as a fraction of the shorter side.
const WIN = 0.16;

async function value(file, { win = WIN } = {}) {
  if (!fs.existsSync(file)) return null;
  const img = sharp(file);
  const m = await img.metadata();
  const side = Math.round(Math.min(m.width, m.height) * win);
  const { data, info } = await img
    .extract({
      left: Math.round(m.width / 2 - side / 2),
      top: Math.round(m.height / 2 - side / 2),
      width: side,
      height: side,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let r = 0, g = 0, b = 0, lmin = 255, lmax = 0;
  for (let i = 0; i < n; i++) {
    const R = data[i * info.channels], G = data[i * info.channels + 1], B = data[i * info.channels + 2];
    r += R; g += G; b += B;
    // Rec.709 luma on the sRGB values -- this is about what the eye reads off
    // the screen, not about linear radiometry.
    const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    if (L < lmin) lmin = L;
    if (L > lmax) lmax = L;
  }
  r /= n; g /= n; b /= n;
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return {
    L: +L.toFixed(1),
    pct: +(L / 2.55).toFixed(1),
    rgb: [r, g, b].map((v) => Math.round(v)),
    sat: +(mx ? (mx - mn) / mx : 0).toFixed(3),
    range: [Math.round(lmin), Math.round(lmax)],
    px: n,
  };
}

const REF_FOR = {
  "polo-hung": "polo/shop-colourways.jpg",
  "polo-folded": "polo/folded-stack.jpg",
  "tee-hung": "tee/shop-shelf.jpg",
  "tee-folded": "tee/plain-2.jpg",
  "hoodie-hung": "hoodie/shop-display.jpg",
  "hoodie-folded": "hoodie/retail-stacks.jpg",
  "trousers-hung": "trousers/isolated.jpg",
  "trousers-folded": "trousers/press-crease.jpg",
  cap: "cap/on-table.jpg",
  "cap-peg": "cap/side.jpg",
  towel: "towel/folded-pair.jpg",
};

const argv = process.argv.slice(2);
const AB = argv[0] === "--ab";
const names = (AB ? argv.slice(1) : argv);

const fmt = (v) => v
  ? `${String(v.pct).padStart(5)}%  rgb(${v.rgb.join(",").padEnd(11)})  sat ${v.sat.toFixed(2)}  range ${v.range[0]}-${v.range[1]}`
  : "     -  (no frame)";

console.log("");
if (AB) {
  console.log("A/B: what is eating the value");
  console.log("".padEnd(76, "="));
  for (const n of names) {
    for (const tag of ["", "-no-ao", "-no-normal", "-no-normalao"]) {
      const f = path.join(IN, `${n}-browse${tag}.png`);
      if (!fs.existsSync(f)) continue;
      console.log(`  ${(n + (tag || " (as shipped)")).padEnd(28)} ${fmt(await value(f))}`);
    }
  }
} else {
  console.log("garment value in game, against the reference photograph");
  console.log("".padEnd(96, "="));
  console.log(`  ${"subject".padEnd(18)} ${"IN GAME".padEnd(46)} REFERENCE`);
  for (const n of names.length ? names : Object.keys(REF_FOR)) {
    const g = await value(path.join(IN, `${n}-browse.png`));
    const r = REF_FOR[n] ? await value(path.join(REF, REF_FOR[n]), { win: 0.30 }) : null;
    const gap = g && r ? (r.pct - g.pct) : null;
    console.log(`  ${n.padEnd(18)} ${fmt(g)}   ${r ? `${String(r.pct).padStart(5)}%` : "    -"}`
      + (gap !== null ? `   gap ${gap > 0 ? "+" : ""}${gap.toFixed(1)} pts` : ""));
  }
}
console.log("");
