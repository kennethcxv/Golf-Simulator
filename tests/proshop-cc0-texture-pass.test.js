// The 19-file CC0 texture pass, pinned so it cannot quietly come undone.
//
// Why this test exists. The pass is applied by ONE keyword per material slot in the
// Blender builders, and the maps only reach a GLB if that keyword survives and the
// builder is re-run. Nothing else fails when it does not: the build succeeds, the
// asset validator passes, the geometry is identical, and the only symptom is that a
// surface goes back to being flat plastic. That is invisible in review and invisible
// in a diff of a binary GLB.
//
// So this reads the shipped GLBs and asserts three things the pass is FOR:
//
//   1. every asset in sheets 07 and 08 carries maps at all
//   2. every textured material records WHICH family it drew from and WHY it is in
//      albedo or surface mode, so a later reader can audit the decision
//   3. a material carrying an albedo map still ships a baseColorFactor, because
//      Blender's exporter drops that silently — the separate
//      `proshop-basecolor-factor` test owns that rule; this one owns its inputs
//
// Rebuild with:
//   blender --background --factory-startup --python tools/blender/build_assets_61_70.py -- --asset 61
//   node tools/blender/pack_ktx2.mjs --in <glb> --out <glb> --max-size 512 --no-compress

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SHEETS = ['sheet_07', 'sheet_08'];

// Every family the pass may draw from, and what each is for. A family added without a
// line here is a family nobody stated a purpose for.
const FAMILIES = new Map([
  ['Wood051', 'light oak — worktops, shelf boards'],
  ['Wood062', 'dark walnut — casework, tool handles'],
  ['Metal032', 'brass and powder-coat'],
  ['Leather011', 'upholstery leather'],
  ['Fabric030', 'woven cloth — curtain, mop yarn, bristle, microfibre'],
  ['Rubber004', 'hose, matte mouldings, polythene'],
  ['PaintedMetal001', 'painted service equipment'],
  ['Foam001', 'sponge'],
]);

function glbJson(path) {
  const buf = readFileSync(path);
  assert.strictEqual(buf.readUInt32LE(0), 0x46546c67, `${path} is not a GLB`);
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
}

function runtimeGlbs() {
  const out = [];
  for (const sheet of SHEETS) {
    const dir = join(REPO, 'vendor', 'models', 'assets_51_100', sheet);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.glb')) out.push({ sheet, file, path: join(dir, file) });
    }
  }
  return out;
}

test('every pro-shop runtime asset carries texture maps', () => {
  const files = runtimeGlbs();
  assert.ok(files.length >= 20, `expected the sheet_07/08 runtime set, found ${files.length}`);
  const bare = [];
  for (const { sheet, file, path } of files) {
    const json = glbJson(path);
    if (!(json.images || []).length) bare.push(`${sheet}/${file}`);
  }
  assert.deepStrictEqual(bare, [], `these assets ship with no textures at all: ${bare.join(', ')}`);
});

test('every textured material records the family it drew from and why', () => {
  const problems = [];
  for (const { file, path } of runtimeGlbs()) {
    const json = glbJson(path);
    for (const material of json.materials || []) {
      const pbr = material.pbrMetallicRoughness || {};
      const textured = Boolean(pbr.baseColorTexture || material.normalTexture
        || pbr.metallicRoughnessTexture);
      if (!textured) continue;
      const extras = material.extras || {};
      // asset_065 predates the shared factory and carries its own per-asset manifest.
      if (file.startsWith('asset_065')) continue;
      const where = `${file}::${material.name}`;
      if (!extras.cc0_family) { problems.push(`${where} has maps but names no CC0 family`); continue; }
      if (!FAMILIES.has(extras.cc0_family)) {
        problems.push(`${where} draws from unlisted family ${extras.cc0_family}`);
      }
      if (!['albedo', 'surface'].includes(extras.cc0_mode)) {
        problems.push(`${where} has no recorded mode`);
      }
      if (!extras.cc0_reason) problems.push(`${where} records no reason for its mode`);
      // Surface mode exists so a slot that cannot carry an albedo still gets relief.
      // A surface-mode material shipping a base-colour map means the mode was ignored.
      if (extras.cc0_mode === 'surface' && pbr.baseColorTexture) {
        problems.push(`${where} is surface mode but ships a baseColorTexture`);
      }
      if (extras.cc0_mode === 'albedo' && !pbr.baseColorTexture) {
        problems.push(`${where} is albedo mode but ships no baseColorTexture`);
      }
    }
  }
  assert.deepStrictEqual(problems, [], problems.join('\n'));
});

test('the CC0 sources the builders read are present and attributed', () => {
  const dir = join(REPO, 'asset_sources', 'textures', 'cc0_spike');
  const manifest = JSON.parse(readFileSync(join(dir, 'SOURCES.json'), 'utf8'));
  for (const family of FAMILIES.keys()) {
    assert.ok(
      existsSync(join(dir, `${family}_1K-JPG_Color.jpg`)),
      `${family} albedo is missing — run tools/blender/fetch_cc0.py ${family}`,
    );
  }
  // Wood051/Wood062/Metal032 predate the manifest (the 065 spike sourced them), so the
  // rule is that anything the manifest DOES record is recorded completely.
  for (const [id, entry] of Object.entries(manifest.families || {})) {
    assert.match(entry.licence || '', /CC0/, `${id} is not recorded as CC0`);
    assert.ok(entry.sourceUrl, `${id} has no source URL`);
  }
});

test('the family statistics the builders solve against are on disk', () => {
  const stats = JSON.parse(readFileSync(
    join(REPO, 'asset_sources', 'textures', 'cc0_calibrated', 'family_stats.json'), 'utf8',
  ));
  for (const family of FAMILIES.keys()) {
    const entry = stats.families?.[family];
    assert.ok(entry, `${family} has no measured statistics`);
    // These four are what the builder's tint and roughness solves divide by. A zero
    // would silently produce a tint of Infinity and a black or white surface.
    for (const key of ['meanLuma', 'lumaP10', 'lumaP90', 'lumaP99']) {
      assert.ok(entry[key] > 0, `${family}.${key} is not a usable measurement`);
    }
  }
});
