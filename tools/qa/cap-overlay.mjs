// Two crown half-profiles, normalised to the same band half-width and crown
// height, drawn on one chart. Reference in white, model in red.
import sharp from "sharp";

async function halfProfile(file, { crop, rule, band, W = 0 }) {
  let img = sharp(file);
  if (crop) img = img.extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, C = info.channels;
  const rows = [];
  for (let y = 0; y < h; y++) {
    let lo = -1, hi = -1, run = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * C, R = data[i], G = data[i + 1], B = data[i + 2];
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B), s = mx ? (mx - mn) / mx : 0;
      const on = s >= rule.sat && mx >= rule.minL;
      if (on) { run++; if (run >= 6) { if (lo < 0) lo = x - run + 1; hi = x; } } else run = 0;
    }
    rows.push(lo < 0 ? null : { lo, hi, c: (lo + hi) / 2 });
  }
  const first = rows.findIndex((r) => r && r.hi - r.lo > 6);
  const axis = rows[band].c;
  const bw = rows[band].hi - axis;
  const span = band - first;
  const pts = [];
  for (let i = 0; i <= 200; i++) {
    const hh = i / 200, y = Math.round(band - hh * span);
    pts.push([hh, rows[y] ? (rows[y].hi - axis) / bw : 0]);
  }
  return { pts, span, bw, first, band };
}

const A = await halfProfile("qa/hero/v7/profile/ref-side.png",
  { crop: [60, 18, 610, 620], rule: { sat: 0.30, minL: 62 }, band: 300 });
const B = await halfProfile("qa/hero/v5/cap/side.png",
  { crop: [300, 120, 700, 600], rule: { sat: 0.22, minL: 60 }, band: 542 });

const CW = 760, CH = 620, PAD = 50;
const px = Buffer.alloc(CW * CH * 3, 18);
const dot = (x, y, c) => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const X = Math.round(x) + dx, Y = Math.round(y) + dy;
    if (X >= 0 && X < CW && Y >= 0 && Y < CH) { const i = (Y * CW + X) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
  }
};
// axes
for (let x = PAD; x < CW - PAD; x++) dot(x, CH - PAD, [80, 80, 80]);
for (let y = PAD; y < CH - PAD; y++) dot(PAD, y, [80, 80, 80]);
const X = (r) => PAD + r * (CW - 2 * PAD);
const Y = (h) => CH - PAD - h * (CH - 2 * PAD);
for (const [set, c] of [[A, [235, 235, 235]], [B, [225, 70, 70]]])
  for (const [h, r] of set.pts) dot(X(r), Y(h), c);
// a hemisphere for scale, dim blue
for (let i = 0; i <= 200; i++) { const h = i / 200; dot(X(Math.sqrt(Math.max(0, 1 - h * h))), Y(h), [70, 90, 150]); }
await sharp(px, { raw: { width: CW, height: CH, channels: 3 } }).png()
  .toFile("qa/hero/v7/profile/overlay.png");
const t = (s, n) => s.pts.filter(([h]) => Math.abs(h - n) < 0.003)[0][1].toFixed(2);
console.log("  h        0.50  0.70  0.80  0.90  0.95  1.00");
console.log("  REF  ", [0.5, 0.7, 0.8, 0.9, 0.95, 1.0].map((n) => t(A, n)).join("  "));
console.log("  MINE ", [0.5, 0.7, 0.8, 0.9, 0.95, 1.0].map((n) => t(B, n)).join("  "));
console.log(`  ref crown ${A.span}px tall on ${A.bw.toFixed(0)}px half -> aspect ${(A.span / A.bw).toFixed(2)}`);
console.log(`  mine      ${B.span}px tall on ${B.bw.toFixed(0)}px half -> aspect ${(B.span / B.bw).toFixed(2)}`);
console.log("  white = reference, red = model, blue = hemisphere -> qa/hero/v7/profile/overlay.png");
