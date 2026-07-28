// A material carrying an albedo map must also ship a baseColorFactor.
//
// Why this test exists. Blender 5.1's glTF exporter recognises a base-colour tint only
// from one exact node pattern — `ShaderNodeMix`, data_type RGBA, blend_type MULTIPLY,
// Factor constant at 1.0. A `ShaderNodeMixRGB` renders identically in the viewport and
// exports with NO `pbrMetallicRoughness.baseColorFactor` at all, which glTF defines as
// (1,1,1,1). The surface then ships as the raw untinted source photograph.
//
// Nothing catches that. The build succeeds, the asset validator passes, the .blend looks
// correct, and the only symptom is that the asset is off palette by an amount nobody can
// attribute. It is what put `Spike/TEXTURE_VALIDATION.md` Arm F off palette, and it was
// found by reading GLB bytes rather than by any check. This is that check.
//
// Scope. The rule applies to materials the pro-shop slice owns. Sheet 06 predates the
// slice and carries twenty materials with the same defect; they are listed explicitly
// below rather than excluded by pattern, so the debt has a size and clearing an entry
// means deleting a line here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SHEETS = ['sheet_06', 'sheet_07', 'sheet_08'];

// Known-defective materials that predate the pro-shop slice. Every one of these ships a
// baseColorTexture with no factor, so every one is currently untinted. They belong to
// sheet 06 (the clubhouse exterior and interior kit), which the slice does not rebuild.
//
// This list may only ever shrink. Adding to it means shipping a new untinted asset.
const KNOWN_UNTINTED = new Set([
  'asset_051_finished_clubhouse_exterior.glb::MAT_S06_charcoal_shingle',
  'asset_051_finished_clubhouse_exterior.glb::MAT_S06_siding_green',
  'asset_051_finished_clubhouse_exterior.glb::MAT_S06_fieldstone',
  'asset_052_dilapidated_clubhouse_exterior.glb::MAT_S06_damaged_wood',
  'asset_053_main_entrance_double_door.glb::MAT_S06_walnut',
  'asset_054_exterior_porch_and_steps.glb::MAT_S06_fieldstone',
  'asset_054_exterior_porch_and_steps.glb::MAT_S06_damaged_wood',
  'asset_054_exterior_porch_and_steps.glb::MAT_S06_oak',
  'asset_055_clubhouse_windows_set.glb::MAT_S06_walnut',
  'asset_056_interior_wall_panel_kit.glb::MAT_S06_architectural_walnut',
  'asset_057_interior_trim_and_baseboard_kit.glb::MAT_S06_walnut',
  'asset_058_ceiling_and_beam_kit.glb::MAT_S06_architectural_walnut',
  'asset_059_renovated_flooring_set.glb::MAT_S06_cream_tile',
  'asset_059_renovated_flooring_set.glb::MAT_S06_dark_wood',
  'asset_059_renovated_flooring_set.glb::MAT_S06_gray_carpet',
  'asset_059_renovated_flooring_set.glb::MAT_S06_floor_oak',
  'asset_059_renovated_flooring_set.glb::MAT_S06_sage_carpet',
  'asset_059_renovated_flooring_set.glb::MAT_S06_stone_tile',
  'asset_059_renovated_flooring_set.glb::MAT_S06_walnut',
  'asset_060_damaged_flooring_set.glb::MAT_S06_damaged_carpet',
  'asset_060_damaged_flooring_set.glb::MAT_S06_damaged_tile',
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

/** Every material in the sheets that carries a base-colour texture. */
function texturedMaterials() {
  const out = [];
  for (const { sheet, file, path } of runtimeGlbs()) {
    const json = glbJson(path);
    for (const material of json.materials || []) {
      const pbr = material.pbrMetallicRoughness || {};
      if (!pbr.baseColorTexture) continue;
      out.push({
        sheet,
        file,
        id: `${file}::${material.name || '(unnamed)'}`,
        name: material.name || '(unnamed)',
        factor: pbr.baseColorFactor || null,
      });
    }
  }
  return out;
}

test('there are textured materials to check', () => {
  const materials = texturedMaterials();
  assert.ok(materials.length > 0, 'no material in sheets 06-08 carries a baseColorTexture');
});

test('a material with an albedo map ships a baseColorFactor', () => {
  const offenders = texturedMaterials()
    .filter((m) => !m.factor && !KNOWN_UNTINTED.has(m.id))
    .map((m) => `${m.sheet}/${m.id}`);

  assert.deepStrictEqual(
    offenders, [],
    'These materials carry a base-colour texture with no baseColorFactor, so glTF\n'
    + 'defaults them to (1,1,1,1) and they ship as the raw untinted source image.\n'
    + 'In Blender the tint must come from a ShaderNodeMix (NOT ShaderNodeMixRGB) with\n'
    + 'data_type RGBA, blend_type MULTIPLY and Factor pinned to exactly 1.0 — see\n'
    + 'tools/blender/build_assets_61_70.py and ART_BIBLE.md §7.4.1.\n'
    + offenders.join('\n'),
  );
});

test('the known-untinted list has not grown stale', () => {
  // A name in the list that no longer exists means the list is describing a GLB that
  // has moved on, and the exemption is silently covering something else.
  const present = new Set(texturedMaterials().map((m) => m.id));
  const gone = [...KNOWN_UNTINTED].filter((id) => !present.has(id));
  assert.deepStrictEqual(
    gone, [],
    `these exemptions no longer match any shipped material — delete them:\n${gone.join('\n')}`,
  );
});

test('asset_065 ships the calibrated factors solved by cc0_calibrate.py', () => {
  // The end-to-end check: the number in the manifest is the number in the GLB. This is
  // what proves the export path carries a tint at all, rather than that a tint was
  // authored somewhere.
  const manifestPath = join(
    REPO, 'asset_sources', 'textures', 'cc0_calibrated', 'asset_065_calibration.json',
  );
  if (!existsSync(manifestPath)) return; // regenerate with: cc0_calibrate.py --emit 065
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const json = glbJson(join(
    REPO, 'vendor', 'models', 'assets_51_100', 'sheet_07',
    'asset_065_stockroom_worktable.glb',
  ));
  const byName = new Map(
    (json.materials || []).map((m) => [m.name, m.pbrMetallicRoughness?.baseColorFactor || null]),
  );

  for (const entry of manifest.materials) {
    const name = `MAT_CC065_${entry.name}`;
    const factor = byName.get(name);
    assert.ok(factor, `${name} has no baseColorFactor — the tint was dropped on export`);
    entry.tintLinear.forEach((expected, i) => {
      assert.ok(
        Math.abs(factor[i] - expected) < 1e-4,
        `${name} channel ${i}: GLB has ${factor[i]}, manifest solved ${expected}`,
      );
    });
  }
});
