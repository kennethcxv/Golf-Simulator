#!/usr/bin/env node
// Emit the Sheets 7-10 runtime manifests from the contract and the shipped binaries.
//
// The socket and animation lists in a runtime binding have to match the GLB exactly. Typed
// by hand across forty assets they would not, and the failure is quiet: a binding that
// names SOCKET_Handle when the export says SOCKET_Handel loads fine and resolves nothing.
//
// So they are not typed by hand. Names, purposes and dimensions come from
// assets-51-100-spec.mjs; root names, sockets, pivots, animations and the authored mount
// come from the clean-reimport reports, which were produced by opening each GLB in a
// Blender scene that had never seen the builder. Placement intent is derived from the
// contract's own placement text rather than invented here.
//
// The generated files are committed as source: they are what the game loads, and a
// reviewer should be able to read them without running anything. Re-run after any asset
// rebuild, then let tests/assets-61-100-runtime-bindings.test.js confirm they still match.
//
// Usage:
//   node tools/qa/generate-runtime-bindings.mjs          # print what would change
//   node tools/qa/generate-runtime-bindings.mjs --write

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ASSETS } from './assets-51-100-spec.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE = join(REPO_ROOT, 'qa', 'assets_51_100_master', 'claude_completion');
const OUT_DIR = join(REPO_ROOT, 'src', 'render3d', 'assets51to100');
const SHEETS = [7, 8, 9, 10];

function loadReimports(sheet) {
  const file = join(EVIDENCE, `sheet_${String(sheet).padStart(2, '0')}`, 'clean_reimport.json');
  if (!existsSync(file)) {
    throw new Error(`missing clean-reimport evidence for sheet ${sheet}: ${file}\n`
      + 'run tools/blender/verify_assets_reimport.py for this sheet first');
  }
  const byGlb = new Map();
  for (const result of JSON.parse(readFileSync(file, 'utf8')).results || []) {
    const posix = result.glb.replace(/\\/g, '/');
    const index = posix.indexOf('vendor/models/');
    if (index >= 0) byGlb.set(posix.slice(index), result);
  }
  return byGlb;
}

/** A stable uppercase token for the contract's free-text placement location. */
function placementDatum(text) {
  return String(text)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

const ORIGIN_BY_SURFACE = {
  floor: 'FOOTPRINT_CENTER_ON_FLOOR_CONTACT',
  wall: 'WALL_MOUNT_POINT_WITH_BODY_HANGING_BELOW',
  ceiling: 'CEILING_MOUNT_POINT_WITH_BODY_HANGING_BELOW',
  surface: 'FOOTPRINT_CENTER_ON_SUPPORTING_SURFACE',
};

function camel(stem) {
  return stem.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function bindingFor(asset, reimports) {
  const planned = asset.plannedPaths;
  const world = reimports.get(planned.runtimeGlb);
  if (!world) throw new Error(`asset ${asset.assetNumber}: no reimport record for ${planned.runtimeGlb}`);

  const extras = world.stats.rootExtras || {};
  const surface = extras.mount || 'floor';
  if (!ORIGIN_BY_SURFACE[surface]) {
    throw new Error(`asset ${asset.assetNumber}: unknown authored mount "${surface}"`);
  }
  // Only the washer machine and its wand live outside; everything else is clubhouse
  // interior. Read from the contract's own placement text rather than a list here.
  const outside = /exterior|cart path|outdoor/i.test(asset.fixtureOrPlacementLocation);

  let firstPerson = null;
  if (asset.representations.includes('first-person')) {
    const fp = reimports.get(planned.firstPersonRuntimeGlb);
    if (!fp) throw new Error(`asset ${asset.assetNumber}: no reimport record for its viewmodel`);
    firstPerson = {
      runtimeGlb: planned.firstPersonRuntimeGlb,
      source: planned.firstPersonSource,
      rootName: fp.stats.root,
      requiredSockets: [...fp.stats.sockets],
      requiredPivots: [...fp.stats.pivots],
      requiredAnimations: [...fp.stats.animationNames],
      collisionExpected: false,
    };
  }

  return {
    registrationId: `SHEET_REGISTRATIONS[${asset.referenceSheet}]`,
    assetNumber: asset.assetNumber,
    assetId: world.stats.root.replace(/_ROOT$/, ''),
    rootName: world.stats.root,
    sheet: asset.referenceSheet,
    stem: asset.stem,
    name: asset.referenceName,
    referenceImagePath: asset.referenceImagePath,
    intendedUse: asset.intendedGameplayPurpose,
    paths: {
      source: planned.source,
      canonicalGlb: planned.canonicalGlb,
      runtimeGlb: planned.runtimeGlb,
      integrationModule: `src/render3d/assets51to100/sheet${String(asset.referenceSheet).padStart(2, '0')}Manifest.js`,
    },
    dimensionsMeters: { ...asset.intendedDimensions },
    runtimeScale: 'METERS_TO_YARDS',
    requiredSockets: [...world.stats.sockets],
    requiredPivots: [...world.stats.pivots],
    requiredAnimations: [...world.stats.animationNames],
    firstPerson,
    mount: {
      root: outside ? 'exterior' : 'interior',
      surface,
      placementDatum: placementDatum(asset.fixtureOrPlacementLocation),
      authoredOrigin: ORIGIN_BY_SURFACE[surface],
      scaleExactlyOnce: true,
    },
    fallbackKey: `sheet${String(asset.referenceSheet).padStart(2, '0')}.asset${String(asset.assetNumber).padStart(3, '0')}.${camel(asset.stem)}`,
    collision: {
      authoredCollisionExpected: asset.collisionExpected,
      runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
      glbNavigationAuthority: 'NONE',
      activateGlbCollision: false,
      contract: asset.collisionRequirements,
    },
  };
}

/** Render a value as JS source, leaving bare identifiers unquoted. */
function render(value, indent) {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return value === 'METERS_TO_YARDS' || value.startsWith('SHEET_REGISTRATIONS[')
      ? value
      : JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const parts = value.map((entry) => JSON.stringify(entry));
    const oneLine = `[${parts.join(', ')}]`;
    if (oneLine.length + pad.length <= 96) return oneLine;
    return `[\n${parts.map((p) => `${inner}${p}`).join(',\n')},\n${pad}]`;
  }
  const entries = Object.entries(value)
    .map(([key, entry]) => `${inner}${key}: ${render(entry, indent + 1)}`);
  return `{\n${entries.join(',\n')},\n${pad}}`;
}

function manifestSource(sheet, bindings) {
  const pad = String(sheet).padStart(2, '0');
  const constNames = bindings.map((b) => `ASSET_${String(b.assetNumber).padStart(3, '0')}`);
  const lines = [];
  lines.push(`// Sheet ${sheet} runtime bindings — assets ${bindings[0].assetNumber}-${bindings[bindings.length - 1].assetNumber}.`);
  lines.push('//');
  lines.push('// GENERATED by tools/qa/generate-runtime-bindings.mjs. Socket, pivot and animation');
  lines.push('// lists are read out of the shipped GLBs by clean reimport, so they describe what the');
  lines.push('// binaries actually contain rather than what anyone believes they contain. Re-run the');
  lines.push('// generator after rebuilding this sheet; do not hand-edit the lists.');
  lines.push('');
  lines.push("import { METERS_TO_YARDS } from './units.js';");
  lines.push("import { SHEET_REGISTRATIONS, defineBinding, validateSheetManifest } from './bindings.js';");
  lines.push('');
  bindings.forEach((binding, index) => {
    lines.push(`export const ${constNames[index]} = defineBinding(${render(binding, 0)});`);
    lines.push('');
  });
  lines.push(`export const SHEET${pad}_ASSETS = Object.freeze([`);
  for (const name of constNames) lines.push(`  ${name},`);
  lines.push(']);');
  lines.push('');
  lines.push(`validateSheetManifest(SHEET${pad}_ASSETS, ${sheet});`);
  lines.push('');
  lines.push(`export default SHEET${pad}_ASSETS;`);
  lines.push('');
  return lines.join('\n');
}

const write = process.argv.includes('--write');
let changed = 0;

for (const sheet of SHEETS) {
  const reimports = loadReimports(sheet);
  const assets = ASSETS.filter((a) => a.referenceSheet === sheet);
  if (assets.length !== 10) throw new Error(`sheet ${sheet} has ${assets.length} assets, expected 10`);
  const bindings = assets.map((asset) => bindingFor(asset, reimports));
  const source = manifestSource(sheet, bindings);
  const file = join(OUT_DIR, `sheet${String(sheet).padStart(2, '0')}Manifest.js`);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current === source) {
    console.log(`sheet ${sheet}: unchanged`);
    continue;
  }
  changed += 1;
  if (write) {
    writeFileSync(file, source);
    console.log(`sheet ${sheet}: wrote ${file} (${bindings.length} bindings, `
      + `${bindings.filter((b) => b.firstPerson).length} with viewmodels)`);
  } else {
    console.log(`sheet ${sheet}: WOULD CHANGE ${file}`);
  }
}

if (!write && changed) {
  console.log(`\n${changed} manifest(s) would change. Re-run with --write.`);
  process.exitCode = 1;
}
