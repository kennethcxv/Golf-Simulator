import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import { OBJECT_CATALOG } from '../src/sim/courseEditor.js';

const manifest = JSON.parse(readFileSync(new URL('../vendor/models/flora/_manifest.json', import.meta.url), 'utf8'));
const variants = new Map(manifest.variants.map((variant) => [variant.id, variant]));

const PLACEABLE = [
  'oak_a', 'maple_a', 'pine_a', 'cedar_a', 'birch_a', 'cypress_a', 'palm_a',
  'acacia_a', 'eucalyptus_a', 'flower_a', 'ornamental_small_a', 'bush_native',
  'hedge_a', 'grass_clump', 'reed_clump', 'groundcover_a', 'flower_bed_a',
];

const NEW_ASSETS = [
  'cypress_a', 'cypress_far', 'palm_a', 'palm_far', 'acacia_a', 'acacia_far',
  'eucalyptus_a', 'eucalyptus_far', 'ornamental_small_a', 'deciduous_far',
  'hedge_a', 'groundcover_a', 'flower_bed_a',
];

test('landscaping catalog exposes the requested production flora, not migration aliases', () => {
  const byType = new Map(OBJECT_CATALOG.map((entry) => [entry.type, entry]));
  for (const id of PLACEABLE) {
    const entry = byType.get(id);
    assert.ok(entry, `${id} is player-placeable`);
    assert.ok(entry.climate, `${id} states climate compatibility`);
    assert.ok(entry.rootRadiusYd > 0, `${id} states root clearance`);
    assert.ok(entry.canopyRadiusYd > 0, `${id} states canopy/use clearance`);
  }
  for (const legacy of ['tree_oak', 'tree_default', 'hedge', 'flowers', 'bush_round']) {
    assert.equal(byType.has(legacy), false, `${legacy} remains migration-only`);
  }
});

test('new original flora exports satisfy the one-mesh production contract', () => {
  assert.equal(manifest.asset_origin, 'Original procedural geometry generated in-repository; no external assets.');
  for (const id of NEW_ASSETS) {
    const variant = variants.get(id);
    assert.ok(variant, `${id} is manifested`);
    assert.equal(variant.mesh_count, 1, `${id} is one instancing mesh`);
    assert.equal(variant.material_count, 1, `${id} uses one shared vertex-color material`);
    assert.equal(variant.vertex_color_attribute, 'Col');
    assert.deepEqual(variant.origin, [0, 0, 0]);
    assert.ok(variant.tris > 0 && variant.tris <= variant.triangle_budget, `${id} honors triangle budget`);
    const glb = new URL(`../vendor/models/flora/${id}.glb`, import.meta.url);
    const blend = new URL(`../asset_sources/blender/flora/${id}.blend`, import.meta.url);
    assert.ok(existsSync(glb), `${id} GLB exists`);
    assert.ok(existsSync(blend), `${id} Blender source exists`);
    assert.ok(statSync(glb).size > 1_000, `${id} GLB is nonempty`);
  }
});
