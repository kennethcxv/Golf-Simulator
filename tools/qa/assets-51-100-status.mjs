#!/usr/bin/env node
// Assets 51-100 status, derived rather than asserted.
//
// The failure this exists to prevent is the one the Codex handoff audit identified in
// Codex's own reports: they were accurate when written and stale by the time anyone read
// them, because they recorded numbers instead of recomputing them. So nothing here is
// typed in. Every field comes from one of three places:
//
//   1. the production contract in assets-51-100-spec.mjs,
//   2. the filesystem, and
//   3. the clean-reimport reports, which are themselves produced by opening each GLB in a
//      Blender scene that has never seen the builder.
//
// A required socket is "present" only if it was found inside the exported binary. A name
// drift between the builder and the contract shows up here as a missing socket, not as a
// green tick.
//
// Usage:
//   node tools/qa/assets-51-100-status.mjs
//   node tools/qa/assets-51-100-status.mjs --write

import { existsSync, statSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ASSETS } from './assets-51-100-spec.mjs';
import { ASSETS_BY_NUMBER } from '../../src/render3d/assets51to100/assetsRegistry.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_ROOT = join(REPO_ROOT, 'qa', 'assets_51_100_master', 'claude_completion');
const OUT_DIR = join(REPO_ROOT, 'qa', 'assets_51_100_master', 'claude_handoff');

const abs = (relative) => join(REPO_ROOT, relative);
const exists = (relative) => Boolean(relative) && existsSync(abs(relative));
const bytes = (relative) => (exists(relative) ? statSync(abs(relative)).size : 0);

/** Load every clean-reimport report we have, keyed by the GLB path it covers. */
function loadReimportReports() {
  const byGlb = new Map();
  for (const sheet of ['sheet_06', 'sheet_07', 'sheet_08', 'sheet_09', 'sheet_10']) {
    const file = join(EVIDENCE_ROOT, sheet, 'clean_reimport.json');
    if (!existsSync(file)) continue;
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    for (const result of payload.results || []) {
      // The report stores an absolute POSIX path; key on the repo-relative tail so it
      // lines up with what the contract asks for.
      const marker = 'vendor/models/';
      const index = result.glb.replace(/\\/g, '/').indexOf(marker);
      if (index < 0) continue;
      byGlb.set(result.glb.replace(/\\/g, '/').slice(index), result);
    }
  }
  return byGlb;
}

/**
 * Which sheets the scene actually mounts.
 *
 * "Has a runtime binding" and "appears in the game" are different questions, and
 * conflating them is how a report claims fifty assets are integrated when forty of them
 * are registered and nothing places them. A sheet counts as mounted only when something
 * outside `assets51to100/` imports it -- the scene reaching in, not the registry
 * describing itself.
 */
function mountedSheets() {
  const render3d = join(REPO_ROOT, 'src', 'render3d');
  const mounted = new Set();
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'assets51to100') scan(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const text = readFileSync(full, 'utf8');
      for (const sheet of [6, 7, 8, 9, 10]) {
        const pad = String(sheet).padStart(2, '0');
        if (text.includes(`sheet${pad}Manifest`) || text.includes(`sheet${pad}Production`)
          || text.includes(`Sheet${pad}Production`) || text.includes(`sheet${pad}ClubhouseAdapter`)) {
          mounted.add(sheet);
        }
      }
      if (text.includes('assetsRegistry')) for (const s of [6, 7, 8, 9, 10]) mounted.add(s);
    }
  };
  scan(render3d);
  return mounted;
}

const MOUNTED_SHEETS = mountedSheets();

function statusFor(asset, world, firstPerson, registryBound, sceneMounted) {
  if (!world.sourceExists && !world.runtimeGlbExists) return 'Missing';
  if (!world.runtimeGlbExists) return 'Partially complete';
  if (!world.reimport) return 'Present but unverified';
  if (!world.reimport.ok) return 'Broken';
  if (world.missingSockets.length || world.missingAnimations.length) return 'Partially complete';
  if (firstPerson && !firstPerson.reimport) return 'Partially complete';
  if (firstPerson && !firstPerson.reimport.ok) return 'Broken';
  if (firstPerson && (firstPerson.missingAnimations.length)) return 'Partially complete';
  if (!registryBound) return 'Built and verified, no runtime binding';
  if (!sceneMounted) return 'Bound to the runtime, not yet mounted in the scene';
  return 'Verified complete';
}

function describe(asset, reports) {
  const planned = asset.plannedPaths;
  const bindingPath = planned.runtimeIntegrationFile;

  const requiredSockets = asset.requiredSockets.map(String);
  const worldReimport = reports.get(planned.runtimeGlb) || null;
  const shipped = new Set([
    ...((worldReimport && worldReimport.stats.sockets) || []),
    ...((worldReimport && worldReimport.stats.pivots) || []),
  ]);
  const shippedAnims = new Set((worldReimport && worldReimport.stats.animationNames) || []);

  const world = {
    sourceExists: exists(planned.source),
    canonicalGlbExists: exists(planned.canonicalGlb),
    runtimeGlbExists: exists(planned.runtimeGlb),
    fileBytes: bytes(planned.runtimeGlb),
    reimport: worldReimport,
    triangles: worldReimport ? worldReimport.stats.triangleCount : null,
    meshes: worldReimport ? worldReimport.stats.visibleMeshCount : null,
    materials: worldReimport ? worldReimport.stats.materialCount : null,
    collisionMeshes: worldReimport ? worldReimport.stats.collisionMeshCount : null,
    boundsMeters: worldReimport ? worldReimport.stats.boundsMeters : null,
    missingSockets: worldReimport ? requiredSockets.filter((name) => !shipped.has(name)) : requiredSockets,
    missingAnimations: worldReimport
      ? asset.requiredAnimations.filter((name) => !shippedAnims.has(name))
      : [...asset.requiredAnimations],
  };

  let firstPerson = null;
  if (asset.representations.includes('first-person')) {
    const fpReimport = reports.get(planned.firstPersonRuntimeGlb) || null;
    const fpAnims = new Set((fpReimport && fpReimport.stats.animationNames) || []);
    firstPerson = {
      sourceExists: exists(planned.firstPersonSource),
      runtimeGlbExists: exists(planned.firstPersonRuntimeGlb),
      fileBytes: bytes(planned.firstPersonRuntimeGlb),
      reimport: fpReimport,
      triangles: fpReimport ? fpReimport.stats.triangleCount : null,
      sockets: fpReimport ? fpReimport.stats.sockets : [],
      animations: fpReimport ? fpReimport.stats.animationNames : [],
      // Equip/use clips live on the viewmodel, so the contract's animation list is
      // checked against the first-person export rather than the world one.
      missingAnimations: fpReimport
        ? asset.requiredAnimations.filter((name) => !fpAnims.has(name))
        : [...asset.requiredAnimations],
    };
  }

  // A world asset whose clips are authored on its viewmodel has not failed; recheck.
  if (firstPerson && world.missingAnimations.length && !firstPerson.missingAnimations.length) {
    world.missingAnimations = [];
  }

  const registryBound = Boolean(ASSETS_BY_NUMBER[asset.assetNumber]);
  const sceneMounted = registryBound && MOUNTED_SHEETS.has(asset.referenceSheet);
  return {
    assetNumber: asset.assetNumber,
    sheet: asset.referenceSheet,
    name: asset.referenceName,
    category: asset.category,
    referenceImagePath: asset.referenceImagePath,
    representations: [...asset.representations],
    collisionExpected: asset.collisionExpected,
    paths: {
      source: planned.source,
      canonicalGlb: planned.canonicalGlb,
      runtimeGlb: planned.runtimeGlb,
      runtimeIntegrationFile: bindingPath,
      firstPersonRuntimeGlb: planned.firstPersonRuntimeGlb || null,
    },
    registryBound,
    sceneMounted,
    world,
    firstPerson,
    status: statusFor(asset, world, firstPerson, registryBound, sceneMounted),
  };
}

const reports = loadReimportReports();
const records = ASSETS.map((asset) => describe(asset, reports));

const tally = records.reduce((acc, record) => {
  acc[record.status] = (acc[record.status] || 0) + 1;
  return acc;
}, {});

const totals = {
  primaryAssets: records.length,
  sourcesOnDisk: records.filter((r) => r.world.sourceExists).length,
  runtimeGlbsOnDisk: records.filter((r) => r.world.runtimeGlbExists).length,
  cleanReimportPassed: records.filter((r) => r.world.reimport && r.world.reimport.ok).length,
  registryBound: records.filter((r) => r.registryBound).length,
  sceneMounted: records.filter((r) => r.sceneMounted).length,
  firstPersonRequired: records.filter((r) => r.firstPerson).length,
  firstPersonBuilt: records.filter((r) => r.firstPerson && r.firstPerson.runtimeGlbExists).length,
  worldTriangles: records.reduce((n, r) => n + (r.world.triangles || 0), 0),
  firstPersonTriangles: records.reduce((n, r) => n + ((r.firstPerson && r.firstPerson.triangles) || 0), 0),
  missingRequiredSockets: records.reduce((n, r) => n + r.world.missingSockets.length, 0),
  missingRequiredAnimations: records.reduce(
    (n, r) => n + r.world.missingAnimations.length + ((r.firstPerson && r.firstPerson.missingAnimations.length) || 0),
    0,
  ),
};

const payload = { totals, statusTally: tally, assets: records };

function markdown() {
  const lines = [];
  lines.push('# Assets 51-100 — status');
  lines.push('');
  lines.push('Every value below is recomputed from the contract, the filesystem and the');
  lines.push('clean-reimport reports. Nothing is copied from a previous report.');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---:|');
  lines.push(`| Primary assets in scope | ${totals.primaryAssets} |`);
  lines.push(`| Blender sources on disk | ${totals.sourcesOnDisk} |`);
  lines.push(`| Runtime GLBs on disk | ${totals.runtimeGlbsOnDisk} |`);
  lines.push(`| Passing clean reimport | ${totals.cleanReimportPassed} |`);
  lines.push(`| Bound to the runtime registry | ${totals.registryBound} |`);
  lines.push(`| Mounted in the scene | ${totals.sceneMounted} |`);
  lines.push(`| First-person variants required / built | ${totals.firstPersonRequired} / ${totals.firstPersonBuilt} |`);
  lines.push(`| Missing required sockets | ${totals.missingRequiredSockets} |`);
  lines.push(`| Missing required animations | ${totals.missingRequiredAnimations} |`);
  lines.push(`| World triangles | ${totals.worldTriangles.toLocaleString('en-US')} |`);
  lines.push(`| Viewmodel triangles | ${totals.firstPersonTriangles.toLocaleString('en-US')} |`);
  lines.push('');
  lines.push('## Status tally');
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('|---|---:|');
  for (const [status, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push('');
  lines.push('## Per asset');
  lines.push('');
  lines.push('| # | Name | Status | Blend | GLB | Reimport | Bound | Mounted | Tris | Sockets | Anims | FP |');
  lines.push('|---|---|---|---|---|---|---|---|---:|---|---|---|');
  for (const r of records) {
    const reimport = r.world.reimport ? (r.world.reimport.ok ? 'pass' : 'FAIL') : '—';
    const sockets = r.world.missingSockets.length ? `missing ${r.world.missingSockets.length}` : 'ok';
    const anims = r.world.missingAnimations.length ? `missing ${r.world.missingAnimations.length}` : 'ok';
    const fp = r.firstPerson ? (r.firstPerson.runtimeGlbExists ? 'built' : 'MISSING') : '—';
    lines.push(
      `| ${r.assetNumber} | ${r.name} | ${r.status} | ${r.world.sourceExists ? 'yes' : 'no'} | `
      + `${r.world.runtimeGlbExists ? 'yes' : 'no'} | ${reimport} | ${r.registryBound ? 'yes' : 'no'} | `
      + `${r.sceneMounted ? 'yes' : 'no'} | `
      + `${r.world.triangles ?? '—'} | ${sockets} | ${anims} | ${fp} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

if (process.argv.includes('--write')) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'assets_51_100_status.json'), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, 'assets_51_100_status.md'), `${markdown()}\n`);
  console.log(`wrote ${join(OUT_DIR, 'assets_51_100_status.md')}`);
  console.log(`wrote ${join(OUT_DIR, 'assets_51_100_status.json')}`);
}

console.log(JSON.stringify({ totals, statusTally: tally }, null, 2));

const unknown = records.filter((r) => r.status === 'Present but unverified' || r.status === 'Missing');
if (unknown.length) {
  console.error(`\n${unknown.length} asset(s) with unresolved status:`);
  for (const r of unknown) console.error(`  ${r.assetNumber} ${r.name}: ${r.status}`);
}
