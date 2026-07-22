import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  PRO_SHOP_EQUIPMENT_CATALOG,
  PRO_SHOP_EQUIPMENT_FAMILIES,
} from '../src/data/proShopEquipment.js';


const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'vendor', 'models', 'pro_shop_equipment', '_manifest.json');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const byId = new Map(manifest.assets.map((entry) => [entry.id, entry]));


test('the shipped manifest covers all 120 catalog entries exactly once', () => {
  assert.equal(PRO_SHOP_EQUIPMENT_CATALOG.length, 120);
  assert.equal(manifest.assets.length, 120);
  assert.equal(byId.size, 120);
  assert.deepEqual(
    [...byId.keys()].sort(),
    PRO_SHOP_EQUIPMENT_CATALOG.map((entry) => entry.id).sort(),
  );
  assert.deepEqual(manifest.available, [...byId.keys()].sort());
});


test('every family keeps its editable Blender source and all five nonempty GLBs', () => {
  for (const family of PRO_SHOP_EQUIPMENT_FAMILIES) {
    const source = join(ROOT, 'asset_sources', 'blender', 'pro_shop_equipment', `${family.id}.blend`);
    assert.ok(existsSync(source), `missing source: ${family.id}`);
    assert.ok(statSync(source).size > 50_000, `source is unexpectedly small: ${family.id}`);
    const entries = PRO_SHOP_EQUIPMENT_CATALOG.filter((entry) => entry.familyId === family.id);
    assert.equal(entries.length, 5, `${family.id} does not have five tiers`);
    for (const catalogEntry of entries) {
      const manifestEntry = byId.get(catalogEntry.id);
      assert.ok(manifestEntry, `missing manifest entry: ${catalogEntry.id}`);
      const glb = join(ROOT, manifestEntry.glb);
      assert.ok(existsSync(glb), `missing GLB: ${catalogEntry.id}`);
      assert.ok(statSync(glb).size > 10_000, `GLB is unexpectedly small: ${catalogEntry.id}`);
      assert.equal(readFileSync(glb).subarray(0, 4).toString('ascii'), 'glTF', `bad GLB header: ${catalogEntry.id}`);
    }
  }
});


test('manifest metadata matches the data catalog and production budgets', () => {
  for (const catalogEntry of PRO_SHOP_EQUIPMENT_CATALOG) {
    const built = byId.get(catalogEntry.id);
    assert.equal(built.familyId, catalogEntry.familyId);
    assert.equal(built.tierId, catalogEntry.tierId);
    assert.equal(built.qualityLevel, catalogEntry.qualityLevel);
    assert.equal(built.license, 'Project-owned / UNLICENSED');
    assert.deepEqual(
      built.targetDimensionsM,
      [catalogEntry.dimensionsM.w, catalogEntry.dimensionsM.d, catalogEntry.dimensionsM.h],
      `dimension drift: ${catalogEntry.id}`,
    );
    assert.ok(built.triangles > 0 && built.triangles <= 20_000, `triangle budget: ${catalogEntry.id}`);
    assert.ok(built.nodes >= 4, `insufficient hierarchy: ${catalogEntry.id}`);
    assert.ok(built.collisionNodes.length >= 1, `missing collision contract: ${catalogEntry.id}`);
  }
});
