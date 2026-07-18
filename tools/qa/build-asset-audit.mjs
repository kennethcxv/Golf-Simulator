#!/usr/bin/env node
// Builds the Assets 1-50 handoff audit by joining four independent evidence
// sources: Codex's numbering contract, a fresh transcription of the reference
// sheets, measured GLB geometry, and measured GLB bounding boxes.
//
// Nothing here trusts a filename or a report - every column is derived from a
// file that exists on disk right now.
//
//   node tools/qa/build-asset-audit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS, SHEETS } from './assets-01-50-spec.mjs';

const ROOT = process.cwd();
const OUT = 'qa/assets_01_50_master/claude_handoff';
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const refSpec = read(`${OUT}/reference_spec.json`);
const inventory = read(`${OUT}/glb_inventory.json`);
const dimensions = read(`${OUT}/glb_dimensions.json`);

const invBy = new Map(inventory.map((r) => [r.file, r]));
const dimBy = new Map(dimensions.map((r) => [r.file, r]));
const refBy = new Map(refSpec.assets.map((r) => [r.n, r]));

const exists = (p) => p && fs.existsSync(path.join(ROOT, p));
const pct = (a, b) => (b ? +(((a - b) / b) * 100).toFixed(1) : null);

// intendedDimensions uses metres and varies in shape (w/h/d, diameter, length).
// Normalise to a comparable {w,d,h} in cm, or null where the sheet is silent.
function intendedCm(d) {
  if (!d) return null;
  const cm = (v) => (typeof v === 'number' ? +(v * 100).toFixed(1) : null);
  if (d.diameter != null) return { w: cm(d.diameter), d: cm(d.diameter), h: cm(d.height ?? d.width) };
  // Sheets describe footprint as either width+depth or length+width. Keep all
  // three real extents - collapsing length into width silently drops the long
  // axis and makes long assets (club box, van, cutter) look badly out of spec.
  if (d.length != null) return { w: cm(d.length), d: cm(d.width ?? d.depth), h: cm(d.height) };
  return { w: cm(d.width), d: cm(d.depth ?? d.width), h: cm(d.height) };
}

// The measured box is axis-aligned in the exported orientation, which is not
// guaranteed to match the sheet's W/D/H labelling. Compare as a sorted triple so
// an asset is not failed purely for an axis-naming difference.
function sizeDelta(measured, intended) {
  if (!measured || !intended || measured.empty) return null;
  const m = [measured.width_cm, measured.depth_cm, measured.height_cm].filter((v) => v != null).sort((a, b) => b - a);
  const i = [intended.w, intended.d, intended.h].filter((v) => v != null).sort((a, b) => b - a);
  if (m.length !== i.length || !i.length) return null;
  // Sub-centimetre extents (card/note/receipt thickness) are dominated by
  // rounding: 0.08 cm vs 0.2 cm reads as "150% off" but is 1.2 mm of nothing.
  // Judge those by absolute millimetres instead of ratio.
  const deltas = m.map((v, k) => {
    if (i[k] < 1) return Math.abs(v - i[k]) > 0.5 ? 100 : 0;
    return Math.abs(pct(v, i[k]) ?? 0);
  });
  return { worstPct: +Math.max(...deltas).toFixed(1), measured: m, intended: i };
}

// Codex's contract declares socketExpected for the whole 20-49 range, but
// assets 36/37/39/40 are static lounge and office furniture with no stocking or
// attachment points by design (confirmed against fixtures.js/clubhouse.js).
// Holding them to a socket requirement manufactures findings that are not real.
const STATIC_FURNITURE_NO_SOCKETS = new Set([36, 37, 39, 40]);

const rows = ASSETS.map((a) => {
  const ref = refBy.get(a.assetNumber) || {};
  const runtimeGlb = a.runtimeGlb;
  const canonicalGlb = a.canonicalGlb;
  const inv = invBy.get(runtimeGlb) || invBy.get(canonicalGlb) || null;
  const dim = dimBy.get(runtimeGlb) || dimBy.get(canonicalGlb) || null;

  const budget = Number(String(a.referencePolygonNote).replace(/\D/g, '')) || null;
  // The sheets quote polygons; the inventory counts triangles. For the mostly
  // quad-free, triangulated exports here these are directly comparable, but the
  // ratio is reported rather than asserted so it informs rather than gates.
  const triRatio = inv && budget ? +(inv.tris / budget).toFixed(2) : null;
  const intended = intendedCm(a.intendedDimensions);
  const delta = sizeDelta(dim, intended);

  const findings = [];
  let status = 'Verified complete';
  let grade = 'A';

  if (!exists(runtimeGlb)) {
    status = 'Missing'; grade = 'E';
    findings.push(`runtime GLB absent: ${runtimeGlb}`);
  } else if (inv && inv.error) {
    status = 'Broken'; grade = 'E';
    findings.push(`GLB failed to parse: ${inv.error}`);
  } else {
    if (a.source && !exists(a.source)) findings.push(`blend source missing: ${a.source}`);
    if (canonicalGlb && !exists(canonicalGlb)) findings.push(`canonical GLB missing: ${canonicalGlb}`);
    if (triRatio != null && triRatio < 0.25) {
      status = 'Placeholder'; grade = 'E';
      findings.push(`geometry ${Math.round(triRatio * 100)}% of ~${budget} budget - placeholder-grade`);
    } else if (triRatio != null && triRatio < 0.6) {
      if (grade < 'C') { status = 'Partially complete'; grade = 'C'; }
      findings.push(`geometry ${Math.round(triRatio * 100)}% of ~${budget} budget - visually light`);
    }
    if (delta && delta.worstPct > 25) {
      if (grade < 'C') { status = 'Partially complete'; grade = 'C'; }
      findings.push(`size deviates ${delta.worstPct}% from sheet (${delta.measured.join('x')} vs ${delta.intended.join('x')} cm)`);
    } else if (delta && delta.worstPct > 12) {
      if (grade < 'B') { status = 'Present but unverified'; grade = 'B'; }
      findings.push(`size deviates ${delta.worstPct}% from sheet`);
    }
    if (a.socketExpected && !STATIC_FURNITURE_NO_SOCKETS.has(a.assetNumber) && inv && inv.sockets.length === 0) {
      if (grade < 'B') { status = 'Present but unverified'; grade = 'B'; }
      findings.push('sockets expected by contract but none found in GLB');
    }
    if (inv && (inv.cameras || inv.lights)) {
      status = 'Broken'; grade = 'D';
      findings.push(`ship-gate violation: ${inv.cameras} camera(s), ${inv.lights} light(s)`);
    }
    if (inv && inv.badNames.length) findings.push(`generic mesh names: ${inv.badNames.slice(0, 3).join(', ')}`);
    if (inv && inv.badMats.length) findings.push(`generic material names: ${inv.badMats.slice(0, 3).join(', ')}`);
  }

  const missingRuntime = (a.runtimeIntegrationFiles || []).filter((f) => !exists(f));
  if (missingRuntime.length) findings.push(`runtime file(s) absent: ${missingRuntime.join(', ')}`);

  return {
    assetNumber: a.assetNumber,
    sheet: a.referenceSheet,
    referencePath: a.referenceImagePath,
    referenceName: a.referenceName,
    sheetNameTranscribed: ref.name || null,
    intendedGameplayPurpose: a.intendedGameplayPurpose,
    stem: a.stem,
    blenderSource: a.source,
    blenderSourceExists: exists(a.source),
    canonicalGlb,
    canonicalGlbExists: exists(canonicalGlb),
    runtimeGlb,
    runtimeGlbExists: exists(runtimeGlb),
    runtimeIntegrationFiles: a.runtimeIntegrationFiles,
    fixtureOrPlacementLocation: a.fixtureOrPlacementLocation,
    interactionType: a.interactionType,
    animationRequirements: a.animationRequirements,
    measured: dim && !dim.empty ? { width_cm: dim.width_cm, depth_cm: dim.depth_cm, height_cm: dim.height_cm, baseY_cm: dim.min_y_cm } : null,
    intendedDimensionsCm: intended,
    sizeDeviationPct: delta ? delta.worstPct : null,
    triangles: inv ? inv.tris : null,
    vertices: inv ? inv.verts : null,
    referencePolygonBudget: budget,
    triangleBudgetRatio: triRatio,
    meshes: inv ? inv.meshes : null,
    materials: inv ? inv.materials : null,
    textures: inv ? inv.textures : null,
    textureDimensions: inv ? [...new Set(inv.textureDims)] : null,
    referenceTextureSize: a.referenceTextureSize,
    fileSizeKB: inv ? inv.sizeKB : null,
    sockets: inv ? inv.sockets : null,
    socketCount: inv ? inv.sockets.length : null,
    socketExpected: a.socketExpected,
    collisionExpected: a.collisionExpected,
    animations: inv ? inv.animations : null,
    codexStatus: status,
    grade,
    findings,
    remainingWork: findings.length ? findings : ['reference-vs-runtime visual confirmation outstanding'],
  };
});

fs.mkdirSync(path.join(ROOT, OUT), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT, 'codex_asset_audit.json'), JSON.stringify({
  generated: 'claude-takeover',
  sheets: SHEETS,
  totalAssets: rows.length,
  evidenceSources: [
    'tools/qa/assets-01-50-spec.mjs (Codex numbering contract)',
    `${OUT}/reference_spec.json (independent sheet transcription)`,
    `${OUT}/glb_inventory.json (measured geometry)`,
    `${OUT}/glb_dimensions.json (measured bounding boxes)`,
  ],
  assets: rows,
}, null, 2));

// ---- markdown ----
const byGrade = (g) => rows.filter((r) => r.grade === g);
const L = [];
L.push('# Assets 1-50 - Codex Handoff Audit', '');
L.push('Generated by `tools/qa/build-asset-audit.mjs`. Every column is measured from files on disk,');
L.push('not read from a report. Re-run after any rebuild to refresh.', '');
L.push('## Grade summary', '');
L.push('| Grade | Meaning | Count |');
L.push('|---|---|---|');
L.push(`| A | Production ready, minor polish only | ${byGrade('A').length} |`);
L.push(`| B | Structurally correct but needs verification | ${byGrade('B').length} |`);
L.push(`| C | Visually or dimensionally light | ${byGrade('C').length} |`);
L.push(`| D | Substantial rebuild | ${byGrade('D').length} |`);
L.push(`| E | Placeholder / missing | ${byGrade('E').length} |`);
L.push('', '## Per-asset', '');
L.push('| # | Sheet | Asset | Tris / budget | Measured (WxDxH cm) | Size dev | Sockets | Grade | Status |');
L.push('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const m = r.measured ? `${r.measured.width_cm}x${r.measured.depth_cm}x${r.measured.height_cm}` : '-';
  const tri = r.triangles != null ? `${r.triangles} / ${r.referencePolygonBudget ?? '?'}${r.triangleBudgetRatio ? ` (${Math.round(r.triangleBudgetRatio * 100)}%)` : ''}` : '-';
  L.push(`| ${r.assetNumber} | ${r.sheet} | ${r.referenceName} | ${tri} | ${m} | ${r.sizeDeviationPct != null ? `${r.sizeDeviationPct}%` : '-'} | ${r.socketCount ?? '-'} | ${r.grade} | ${r.codexStatus} |`);
}
L.push('', '## Findings requiring work', '');
for (const r of rows.filter((x) => x.findings.length)) {
  L.push(`### Asset ${r.assetNumber} - ${r.referenceName} (${r.grade})`);
  for (const f of r.findings) L.push(`- ${f}`);
  L.push('');
}
fs.writeFileSync(path.join(ROOT, OUT, 'codex_asset_audit.md'), L.join('\n'));

console.log(`Audited ${rows.length} assets.`);
for (const g of ['A', 'B', 'C', 'D', 'E']) {
  const n = byGrade(g).length;
  if (n) console.log(`  ${g}: ${n}  ${byGrade(g).map((r) => r.assetNumber).join(',')}`);
}
console.log(`\nwrote ${OUT}/codex_asset_audit.json and .md`);
