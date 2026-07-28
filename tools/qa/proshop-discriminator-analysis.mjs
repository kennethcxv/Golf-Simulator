// Which measured property of a pro-shop asset predicts how good it looks?
//
//   node tools/qa/proshop-discriminator-analysis.mjs
//
// Inputs, all produced before this runs and none of them by this script:
//   Designs/ProShop/Discriminator/data/construction.json   (proshop-construction-audit.mjs)
//   Designs/ProShop/Discriminator/data/screen-time.json    (proshop-screen-time.js)
//   Designs/ProShop/Discriminator/data/visual-ranking.json  (by eye, from the portraits)
//
// Spearman rank correlation, because the visual ranking is ordinal and nothing here is
// expected to be linear. Sign convention: rank 1 is best, so a property that makes assets
// look better correlates NEGATIVELY with rank. That is inverted on output -- rho is
// reported so that POSITIVE means "more of this goes with looking better" -- otherwise
// every result reads backwards.
//
// Two-sided p from the t approximation t = rho * sqrt((n-2)/(1-rho^2)) on n-2 df, which is
// adequate at n = 40. Properties are reported in full, including the ones that fail:
// the question is which property discriminates, and that cannot be answered by a table
// containing only the ones that did.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'Designs', 'ProShop', 'Discriminator', 'data');
const read = (f) => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));

const construction = read('construction.json');
const screenTime = read('screen-time.json');
const ranking = read('visual-ranking.json');
const contactSheet = read('contact-sheet.json');

const byNumber = new Map();
for (const a of construction.assets) byNumber.set(a.n, { ...a });
for (const s of screenTime.assets) Object.assign(byNumber.get(s.n) || {}, {
  meanScreenPct: s.meanScreenPct,
  peakScreenPct: s.peakScreenPct,
  visibleInPosesPct: s.visibleInPosesPct,
  drawnFromGlobalBatch: s.drawnFromGlobalBatch,
  placement: s.placement,
});
for (const s of contactSheet.shots) {
  const row = byNumber.get(s.n);
  if (!row) continue;
  row.edgeDensityMean = s.edgeDensityMean;
  row.edgeDensityMax = s.edgeDensityMax;
  row.compactnessMean = s.compactnessMean;
  row.portraitAzimuthDeg = s.azimuthDeg;
}
for (const r of ranking.ranking) {
  const row = byNumber.get(r.n);
  if (!row) throw new Error(`ranked asset ${r.n} has no construction record`);
  row.rank = r.rank;
  row.assetName = r.asset;
  row.why = r.why;
}

const rows = [...byNumber.values()].filter((r) => r.rank != null);
if (rows.length !== ranking.ranking.length) {
  throw new Error(`${ranking.ranking.length} ranked but ${rows.length} matched`);
}

// Derived, scale-free properties. Raw counts are confounded by size -- a sofa has more
// triangles than a clipboard because it is bigger, not because it is better made -- so
// each count is also reported per unit of surface area and per unit of length.
for (const r of rows) {
  r.shellsPerPart = r.mergeFactor;
  r.trianglesPerM2 = r.surfaceAreaM2 ? +(r.triangles / r.surfaceAreaM2).toFixed(1) : null;
  r.partsPerM2 = r.surfaceAreaM2 ? +(r.parts / r.surfaceAreaM2).toFixed(2) : null;
  r.shellsPerM2 = r.surfaceAreaM2 ? +(r.shells / r.surfaceAreaM2).toFixed(2) : null;
  r.bevelsPerM2 = r.surfaceAreaM2 ? +(r.bevelCorners / r.surfaceAreaM2).toFixed(2) : null;
  r.partsPerMetre = r.longestM ? +(r.parts / r.longestM).toFixed(2) : null;
  r.bytesPerM2 = r.surfaceAreaM2 ? +(r.bytes / r.surfaceAreaM2).toFixed(0) : null;
  // Bevel width relative to the object: a 3 mm chamfer on a clipboard is generous and on
  // a sofa is invisible.
  r.bevelWidthRelative = (r.bevelWidthMedianMm && r.longestM)
    ? +((r.bevelWidthMedianMm / 1000) / r.longestM * 1000).toFixed(3) : null;
  r.articulated = (r.animations || 0) > 0 ? 1 : 0;
  r.batched = r.drawnFromGlobalBatch ? 1 : 0;
}

function rankOf(values) {
  // Average ranks for ties, which matters here: several properties are near-constant.
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    const mean = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[idx[k][1]] = mean;
    i = j + 1;
  }
  return out;
}

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return (da && db) ? num / Math.sqrt(da * db) : 0;
}

// Two-sided p from Student's t, via a continued-fraction incomplete beta.
function betacf(a, b, x) {
  const MAXIT = 200; const EPS = 3e-12; const FPMIN = 1e-300;
  const qab = a + b; const qap = a + 1; const qam = a - 1;
  let c = 1; let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function lgamma(z) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z; let y = z; let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j += 1) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
// Abramowitz & Stegun 7.1.26 error function, good to ~1.5e-7 -- ample for a p value.
function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
    + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function pValue(rho, n) {
  if (Math.abs(rho) >= 1) return 0;
  const df = n - 2;
  const t = rho * Math.sqrt(df / (1 - rho * rho));
  return betai(df / 2, 0.5, df / (df + t * t));
}

const PROPERTIES = [
  ['edgeDensityMean', 'visible detail density (rendered, mean of 12 angles)'],
  ['edgeDensityMax', 'visible detail density (best angle)'],
  ['compactnessMean', 'silhouette indentation (1.0 = a disc)'],
  ['flatAreaShare', 'share of surface that is flat plane'],
  ['largestFaceShare', 'share held by the single largest face'],
  ['flatRegions', 'distinct flat regions'],
  ['lumaSpreadSd', 'within-asset lightness spread (sRGB code values)'],
  ['lumaSpreadRange', 'within-asset lightness range'],
  ['accentMaterials', 'accent materials (under 8% of the surface)'],
  ['emissiveMaterials', 'emissive materials'],
  ['parts', 'separable parts (mesh nodes)'],
  ['shells', 'connected shells (physical pieces)'],
  ['mergeFactor', 'merge factor (shells per part)'],
  ['triangles', 'triangle count'],
  ['trianglesPerPart', 'triangles per part'],
  ['trianglesPerM2', 'triangle density (per m2 of surface)'],
  ['partsPerM2', 'parts per m2 of surface'],
  ['shellsPerM2', 'shells per m2 of surface'],
  ['partsPerMetre', 'parts per metre of longest side'],
  ['materials', 'distinct materials'],
  ['texturedMaterials', 'textured materials'],
  ['bevelCorners', 'bevelled corners'],
  ['bevelsPerM2', 'bevelled corners per m2'],
  ['hardCorners', 'bare hard corners'],
  ['bevelWidthMedianMm', 'median bevel width (mm)'],
  ['bevelWidthRelative', 'bevel width relative to object size'],
  ['animations', 'authored animations'],
  ['articulated', 'has moving parts (0/1)'],
  ['sockets', 'sockets'],
  ['meanScreenPct', 'mean screen time (% of frame)'],
  ['peakScreenPct', 'peak screen share (%)'],
  ['visibleInPosesPct', 'share of poses it appears in (%)'],
  ['bytes', 'file size (bytes)'],
  ['bytesPerM2', 'file size per m2'],
  ['longestM', 'longest dimension (m)'],
  ['surfaceAreaM2', 'surface area (m2)'],
  ['batched', 'drawn from the global static batch (0/1)'],
];

const rankValues = rows.map((r) => r.rank);
const rankRanks = rankOf(rankValues);
const results = [];
for (const [key, label] of PROPERTIES) {
  const usable = rows.filter((r) => Number.isFinite(r[key]));
  if (usable.length < 10) { results.push({ key, label, n: usable.length, rho: null, note: 'too few values' }); continue; }
  const subRank = rankOf(usable.map((r) => r.rank));
  const subProp = rankOf(usable.map((r) => r[key]));
  // Negate: rank 1 is best, so a helpful property correlates negatively with rank.
  const rho = -pearson(subRank, subProp);
  const distinct = new Set(usable.map((r) => r[key])).size;
  results.push({
    key,
    label,
    n: usable.length,
    distinctValues: distinct,
    rho: +rho.toFixed(3),
    p: +pValue(rho, usable.length).toFixed(4),
  });
}
results.sort((a, b) => Math.abs(b.rho ?? 0) - Math.abs(a.rho ?? 0));

// Rank correlation over all forty is diluted by a large, undifferentiated middle: most of
// these assets are neither good nor bad and their ordering is close to arbitrary. The
// question asked is about the GAP between the good ones and the bad ones, so each
// property is also tested on the top ten against the bottom ten, where the ordering is
// something anyone would agree with. Mann-Whitney U, exact-enough normal approximation.
const pad = (v, w) => String(v ?? '-').padEnd(w);
const sorted = [...rows].sort((a, b) => a.rank - b.rank);
const TOP = sorted.slice(0, 10);
const BOTTOM = sorted.slice(-10);
const medianOf = (a) => {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const deciles = [];
for (const [key, label] of PROPERTIES) {
  const top = TOP.map((r) => r[key]).filter(Number.isFinite);
  const bottom = BOTTOM.map((r) => r[key]).filter(Number.isFinite);
  if (top.length < 8 || bottom.length < 8) continue;
  const all = [...top.map((v) => [v, 1]), ...bottom.map((v) => [v, 0])].sort((a, b) => a[0] - b[0]);
  const ranks = rankOf(all.map((e) => e[0]));
  let rankSumTop = 0;
  all.forEach((e, i) => { if (e[1]) rankSumTop += ranks[i]; });
  const n1 = top.length; const n2 = bottom.length;
  const u = rankSumTop - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = sigma ? (u - mu) / sigma : 0;
  // Common-language effect size: probability a top-ten asset scores above a bottom-ten one.
  const auc = (n1 * n2) ? u / (n1 * n2) : 0.5;
  deciles.push({
    key,
    label,
    topMedian: medianOf(top),
    bottomMedian: medianOf(bottom),
    auc: +auc.toFixed(3),
    p: +(2 * (1 - normalCdf(Math.abs(z)))).toFixed(4),
  });
}
deciles.sort((a, b) => Math.abs(b.auc - 0.5) - Math.abs(a.auc - 0.5));

console.log('\nTop ten against bottom ten. AUC is the chance a top-ten asset scores higher');
console.log('than a bottom-ten one on that property; 0.5 is no separation, 1.0 is perfect.\n');
console.log(`${pad('property', 46)}${pad('top med', 10)}${pad('bot med', 10)}${pad('AUC', 7)}${pad('p', 8)}`);
console.log('-'.repeat(81));
for (const d of deciles.slice(0, 18)) {
  const stars = d.p < 0.001 ? ' ***' : d.p < 0.01 ? ' **' : d.p < 0.05 ? ' *' : '';
  console.log(`${pad(d.label.slice(0, 45), 46)}${pad(d.topMedian, 10)}${pad(d.bottomMedian, 10)}${pad(d.auc, 7)}${pad(d.p, 8)}${stars}`);
}

// The best and worst UNTEXTURED assets, which is the pair the budget question turns on.
const untextured = rows.filter((r) => !r.texturedMaterials).sort((a, b) => a.rank - b.rank);
const bestUntextured = untextured[0];
const worstUntextured = untextured[untextured.length - 1];

console.log(`n = ${rows.length} assets, ranked 1 (best) to ${rows.length} (worst)\n`);
console.log(`${pad('property', 40)}${pad('rho', 8)}${pad('p', 10)}${pad('distinct', 9)}`);
console.log('-'.repeat(67));
for (const r of results) {
  const stars = r.p == null ? '' : r.p < 0.001 ? ' ***' : r.p < 0.01 ? ' **' : r.p < 0.05 ? ' *' : '';
  console.log(`${pad(r.label, 40)}${pad(r.rho, 8)}${pad(r.p, 10)}${pad(r.distinctValues, 9)}${stars}`);
}
console.log('\nrho > 0 means more of the property goes with looking BETTER.');
console.log('* p<0.05  ** p<0.01  *** p<0.001\n');

console.log('Best-ranked untextured asset :', bestUntextured.rank, bestUntextured.n, bestUntextured.assetName);
console.log('Worst-ranked untextured asset:', worstUntextured.rank, worstUntextured.n, worstUntextured.assetName);

const report = {
  generatedBy: 'tools/qa/proshop-discriminator-analysis.mjs',
  n: rows.length,
  method: 'Spearman rank correlation, sign inverted so positive rho = property goes with a better rank; two-sided p from the t approximation on n-2 df',
  correlations: results,
  topVsBottomDecile: deciles,
  bestUntextured: { n: bestUntextured.n, rank: bestUntextured.rank, asset: bestUntextured.assetName },
  worstUntextured: { n: worstUntextured.n, rank: worstUntextured.rank, asset: worstUntextured.assetName },
  assets: rows.sort((a, b) => a.rank - b.rank).map((r) => ({
    rank: r.rank,
    n: r.n,
    asset: r.assetName,
    parts: r.parts,
    shells: r.shells,
    mergeFactor: r.mergeFactor,
    triangles: r.triangles,
    trianglesPerM2: r.trianglesPerM2,
    surfaceAreaM2: r.surfaceAreaM2,
    materials: r.materials,
    texturedMaterials: r.texturedMaterials,
    bevelCorners: r.bevelCorners,
    bevelsPerM2: r.bevelsPerM2,
    hardCorners: r.hardCorners,
    bevelWidthMedianMm: r.bevelWidthMedianMm,
    animations: r.animations,
    sockets: r.sockets,
    meanScreenPct: r.meanScreenPct,
    peakScreenPct: r.peakScreenPct,
    visibleInPosesPct: r.visibleInPosesPct,
    drawnFromGlobalBatch: r.drawnFromGlobalBatch,
    bytes: r.bytes,
    longestM: r.longestM,
    why: r.why,
  })),
};
mkdirSync(DATA, { recursive: true });
writeFileSync(path.join(DATA, 'correlation.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log('\nwrote Designs/ProShop/Discriminator/data/correlation.json');
