// THE CROWN'S SILHOUETTE, AS A NUMBER.
//
// "The crown is rounder than the reference" is an impression, and an impression
// cannot be aimed at. What a crown IS, in silhouette, is a half-width that falls
// off with height: r(h), h = 0 at the band and 1 at the button, r normalised to
// the half-width at the band. A hemisphere is r = sqrt(1 - h^2) and every cap
// photographed for this asset is flatter than that -- the sides run nearly
// straight up out of the band and the fall-off is packed into a shoulder near
// the top.
//
// Two scalars carry the whole difference:
//   SHOULDER  the highest h still at 90% of the band width. Hemisphere 0.436.
//             The higher this is, the straighter the walls.
//   FILL      the area under r(h) dh. Hemisphere pi/4 = 0.785. A cylinder is
//             1.000. This is "how much of the bounding box the crown occupies",
//             which is exactly what "round vs flat" means.
//
// The subject is separated from the background by SATURATION, not brightness:
// every reference here is a coloured cap on a neutral ground, and a brightness
// rule picks up the cyc and the table. Rows are measured from the widest row
// (the band) up to the top; the visor is excluded by cutting at the widest row,
// because on a cap the crown's widest point IS the band.
//
//   node tools/qa/cap-profile.mjs <img> [--crop l,t,w,h] [--sat 0.18] [--label x]
//   node tools/qa/cap-profile.mjs --control        # hemisphere + flat-top
import fs from "node:fs";
import sharp from "sharp";

const H_SAMPLES = [0.10, 0.25, 0.40, 0.55, 0.70, 0.80, 0.85, 0.90, 0.95];

// r(h) for a mask, band at the widest row. Returns {r:[], shoulder, fill, rows}
// `half` picks the side of the crown AWAY from the visor, and `bandRow` names
// the row where the crown meets the band. Both are needed on a side elevation:
// the visor merges into the crown's silhouette, so the widest row is the visor
// tip and the full width below the peak is crown+visor. Measuring one half
// against a stated band row is the only reading that means the same thing on a
// photograph and on a render.
function profile(mask, W, Hh, { half = null, bandRow = null, axisRow = null } = {}) {
  const rows = [];
  for (let y = 0; y < Hh; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (lo < 0) lo = x; hi = x; }
    rows.push(lo < 0 ? null : { lo, hi, w: hi - lo + 1, c: (lo + hi) / 2 });
  }
  const solid = rows.map((r, y) => ({ r, y })).filter((o) => o.r && o.r.w > 3);
  if (solid.length < 20) return null;
  const top = solid[0].y;
  let band = solid[0].y, bw = 0;
  for (const o of solid) if (o.r.w >= bw) { bw = o.r.w; band = o.y; }
  if (bandRow !== null) { band = bandRow; bw = rows[band]?.w ?? bw; }
  // half-width from the crown's own axis, taken at the band
  // THE AXIS MUST COME FROM CROWN ROWS ONLY. Taking it from the band row put
  // the visor's leading edge in the average, dragged the centre toward the
  // visor, and inflated every right-half width by the amount of the drag --
  // which then divided into every reading as a too-large band width. Pass
  // --axisrow at a height where both edges are crown.
  const ar = axisRow !== null ? axisRow : band;
  const axis = rows[ar] ? rows[ar].c : W / 2;
  const hw = (y) => {
    const r = rows[y];
    if (!r) return 0;
    if (half === "right") return r.hi - axis;
    if (half === "left") return axis - r.lo;
    return r.w / 2;
  };
  // NORMALISE WITH THE SAME FUNCTION THAT MEASURES. Guarding this with
  // `if (half)` left the full-width path dividing half-widths by a full width,
  // and every control halved: hemisphere fill 0.789 -> 0.395. The reader and
  // the normaliser must be one function or they drift apart silently.
  bw = hw(band);
  const span = band - top;
  if (span < 20) return null;
  // r at a given h, by linear interpolation between rows
  const at = (h) => {
    const y = band - h * span;
    const y0 = Math.floor(y), y1 = Math.min(band, y0 + 1), t = y - y0;
    const a = hw(y0), b = hw(y1);
    return (a * (1 - t) + b * t) / bw;
  };
  let fill = 0;
  const N = 400;
  for (let i = 0; i < N; i++) fill += at((i + 0.5) / N) / N;
  let shoulder = 0;
  for (let i = N; i > 0; i--) { const h = i / N; if (at(h) >= 0.90) { shoulder = h; break; } }
  return { at, shoulder, fill, band, top, span, bw, samples: H_SAMPLES.map(at) };
}

// Which rule separates subject from ground depends on the photograph, and the
// only way to know it worked is --dump and LOOK. `sat` is a coloured cap on a
// neutral ground; `blue`/`dark` are for the two references where sat fails --
// all-views is a dark cap on dark cloth (crown edge rgb 19,24,44 against a
// ground of 35,28,22: same brightness, same saturation, unseparable).
async function maskOf(file, { crop, sat = 0.18, minL = 26, blue = 0, dark = 0, open = 0 } = {}) {
  let img = sharp(file);
  if (crop) img = img.extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: Hh, channels: C } = info;
  const m = new Uint8Array(W * Hh);
  for (let i = 0; i < W * Hh; i++) {
    const R = data[i * C], G = data[i * C + 1], B = data[i * C + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    const s = mx ? (mx - mn) / mx : 0;
    // a RATIO, not a difference: shadow scales all three channels together, so
    // B/R survives the shadowed side of a cap where B-R does not (the first cut
    // lost the whole left half of the on-table reference to its own shadow).
    if (blue) { if (B >= blue * (R || 1) && B >= 1.12 * (G || 1) && B > 40) m[i] = 1; }
    else if (dark) { if (0.2126 * R + 0.7152 * G + 0.0722 * B <= dark) m[i] = 1; }
    else if (s >= sat && mx >= minL) m[i] = 1;
  }
  // OPEN, radius `open`. min/max-x per row means ONE speckle pixel of JPEG
  // noise at the crop edge sets the width for that row -- the all-views ground
  // is peppered with them. Erode then dilate kills anything thinner than the
  // radius and leaves the cap untouched.
  return { m: openMask(m, W, Hh, open), W, H: Hh };
}

function openMask(m, W, Hh, r) {
  if (!r) return m;
  const pass = (src, want) => {
    const out = new Uint8Array(W * Hh);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      let n = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < Hh && xx >= 0 && xx < W && src[yy * W + xx]) n++;
      }
      const full = (2 * r + 1) ** 2;
      out[y * W + x] = want === "erode" ? (n === full ? 1 : 0) : (n > 0 ? 1 : 0);
    }
    return out;
  };
  return pass(pass(m, "erode"), "dilate");
}

// ---- the negative control -------------------------------------------------
// Two masks whose profile is known in closed form. If the reader cannot tell
// these two apart, it cannot tell a dome from a cap either.
function controlMask(kind, W = 400, Hh = 300) {
  const m = new Uint8Array(W * Hh);
  const cx = W / 2, base = Hh - 10, span = 250, R = 150;
  for (let y = 0; y < Hh; y++) {
    const h = (base - y) / span;
    if (h < 0 || h > 1) continue;
    let r;
    if (kind === "hemisphere") r = Math.sqrt(Math.max(0, 1 - h * h));
    else if (kind === "cylinder") r = 1;
    else r = h < 0.62 ? 1 : Math.sqrt(Math.max(0, 1 - ((h - 0.62) / 0.38) ** 2)); // flat-top
    for (let x = Math.round(cx - R * r); x <= Math.round(cx + R * r); x++)
      if (x >= 0 && x < W) m[y * W + x] = 1;
  }
  return { m, W, H: Hh };
}

const fmt = (p, label) =>
  `  ${label.padEnd(22)} shoulder ${p.shoulder.toFixed(3)}  fill ${p.fill.toFixed(3)}   `
  + H_SAMPLES.map((h, i) => p.samples[i].toFixed(2)).join(" ");

const argv = process.argv.slice(2);
console.log("");
console.log(`  ${"subject".padEnd(22)} ${"".padEnd(32)}r at h = ` + H_SAMPLES.join("  "));
console.log("".padEnd(112, "="));

if (argv[0] === "--control") {
  for (const k of ["hemisphere", "flat-top", "cylinder"]) {
    const { m, W, H: Hh } = controlMask(k);
    console.log(fmt(profile(m, W, Hh), "CONTROL " + k));
  }
  console.log("\n  expected: hemisphere shoulder 0.436 fill 0.785 | cylinder 1.000 1.000");
} else {
  let file = null, crop = null, sat = 0.18, label = null, minL = 26, dump = null, blue = 0, dark = 0, open = 0, half = null, bandRow = null, axisRow = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--crop") crop = argv[++i].split(",").map(Number);
    else if (argv[i] === "--sat") sat = +argv[++i];
    else if (argv[i] === "--minl") minL = +argv[++i];
    else if (argv[i] === "--label") label = argv[++i];
    else if (argv[i] === "--dump") dump = argv[++i];
    else if (argv[i] === "--blue") blue = +argv[++i];
    else if (argv[i] === "--dark") dark = +argv[++i];
    else if (argv[i] === "--open") open = +argv[++i];
    else if (argv[i] === "--half") half = argv[++i];
    else if (argv[i] === "--band") bandRow = +argv[++i];
    else if (argv[i] === "--axisrow") axisRow = +argv[++i];
    else file = argv[i];
  }
  if (!file || !fs.existsSync(file)) { console.error("no such file: " + file); process.exit(2); }
  const { m, W, H: Hh } = await maskOf(file, { crop, sat, minL, blue, dark, open });
  const p = profile(m, W, Hh, { half, bandRow, axisRow });
  if (!p) { console.error("no subject found in " + file); process.exit(2); }
  // LOOK AT WHAT WAS SEGMENTED. A threshold nobody has seen is a guess.
  if (dump) {
    const px = Buffer.alloc(W * Hh * 3);
    for (let i = 0; i < W * Hh; i++) {
      const y = Math.floor(i / W);
      const on = m[i], band = y === p.band, top = y === p.top;
      px[i * 3] = band ? 255 : on ? 210 : 20;
      px[i * 3 + 1] = top ? 255 : on ? 210 : 20;
      px[i * 3 + 2] = on ? 210 : 20;
    }
    await sharp(px, { raw: { width: W, height: Hh, channels: 3 } }).png().toFile(dump);
    console.log("  mask -> " + dump);
  }
  console.log(fmt(p, label || file.split(/[\/]/).pop()));
  console.log(`\n  band row ${p.band}, top row ${p.top}, ${p.span} px tall, ${p.bw} px wide  (aspect ${(p.span / p.bw).toFixed(3)})`);
}
console.log("");
