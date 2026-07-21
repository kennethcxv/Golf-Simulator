import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditGlbBuffer, parseGlb } from '../tools/qa/asset-footprint-audit.mjs';
import {
  STORE_DISPLAY_CATALOG, STORE_DISPLAY_FAMILIES, STORE_DISPLAY_TIERS, storeDisplayAsset,
} from '../src/data/storeDisplayCatalog.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const diskPath = (repoPath) => path.join(ROOT, ...repoPath.split('/'));

const FAMILIES = [
  'clothing_rack', 'hat_wall', 'shoe_display', 'golf_club_wall', 'ball_display',
  'accessory_rack', 'snack_shelving', 'drink_refrigerator', 'impulse_shelf',
  'checkout_display', 'feature_table', 'window_display', 'luxury_display_island',
  'wall_slat_system', 'built_in_cabinetry', 'glass_display_tower',
  'corner_shelving', 'rotating_display',
];
const QUALITY = ['Basic', 'Standard', 'Premium', 'High-end', 'Luxury'];
const LIGHTS = [0, 1, 2, 3, 5];
const REFERENCE_HASHES = [
  '71837A0D4FBA7FB51F41EB315AC45191265595CF4075EFBD4FAD1D5674834D58',
  'AC8734A60E3DACE03466A4C04255FE9A13F89B7452390DB5FC8075D64E453692',
  '0C0780A1B1162A045D42AC1E77C7514759FED9D9D641903DC8A984C62CEB1A3D',
];

function idFor(family, tier) {
  return `pf_display_${family}_t${tier}`;
}

function manifestFor(family, tier) {
  return JSON.parse(readFileSync(diskPath(
    `Assets/pro_shop/manifests/fragments/${idFor(family, tier)}.json`,
  ), 'utf8'));
}

function glbFor(family, tier) {
  const id = idFor(family, tier);
  const buffer = readFileSync(diskPath(`Assets/pro_shop/glb/fixtures/${id}.glb`));
  return { id, buffer, json: parseGlb(buffer).json };
}

test('the supplied clubhouse references are preserved byte-for-byte', () => {
  const files = [
    'ChatGPT Image Jul 20, 2026, 02_51_59 PM.png',
    'ChatGPT Image Jul 20, 2026, 02_52_25 PM.png',
    'ChatGPT Image Jul 20, 2026, 02_52_34 PM.png',
  ];
  assert.equal(files.length, REFERENCE_HASHES.length);
  files.forEach((file, index) => {
    const bytes = readFileSync(diskPath(`Designs/ClubHouse/${file}`));
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      REFERENCE_HASHES[index]);
  });
});

test('all 18 requested display families ship exactly five authored Blender and GLB assets', () => {
  assert.equal(new Set(FAMILIES).size, 18);
  for (const family of FAMILIES) {
    for (let tier = 1; tier <= 5; tier += 1) {
      const id = idFor(family, tier);
      const blend = diskPath(`Assets/pro_shop/source/fixtures/store_displays/${family}/${id}.blend`);
      const glb = diskPath(`Assets/pro_shop/glb/fixtures/${id}.glb`);
      const manifest = diskPath(`Assets/pro_shop/manifests/fragments/${id}.json`);
      assert.ok(existsSync(blend), `${id} Blender source`);
      assert.ok(existsSync(glb), `${id} GLB export`);
      assert.ok(existsSync(manifest), `${id} manifest`);
      assert.ok(statSync(blend).size > 100_000, `${id} contains real Blender scene data`);
      assert.ok(statSync(glb).size > 10_000, `${id} contains exported geometry`);
    }
  }
});

test('the lazy in-game catalog exposes every asset without adding save-state fields', () => {
  assert.equal(STORE_DISPLAY_FAMILIES.length, 18);
  assert.equal(STORE_DISPLAY_TIERS.length, 5);
  assert.equal(STORE_DISPLAY_CATALOG.length, 90);
  assert.deepEqual(STORE_DISPLAY_FAMILIES.map((family) => family.id), FAMILIES);
  assert.deepEqual(STORE_DISPLAY_TIERS.map((tier) => tier.lights), LIGHTS);
  assert.equal(new Set(STORE_DISPLAY_CATALOG.map((asset) => asset.id)).size, 90);
  for (const asset of STORE_DISPLAY_CATALOG) {
    const manifest = manifestFor(asset.family, asset.tier);
    assert.equal(storeDisplayAsset(asset.family, asset.tier), asset);
    assert.deepEqual(asset.dimensions, manifest.target_dimensions_m, asset.id);
    assert.equal(asset.glb, `Assets/pro_shop/glb/fixtures/${asset.id}.glb`);
    assert.ok(!('state' in asset) && !('save' in asset), `${asset.id} is presentation data only`);
  }
});

test('every family has strict five-tier size, capacity, material, woodwork, light, and complexity progression', () => {
  for (const family of FAMILIES) {
    const manifests = Array.from({ length: 5 }, (_, index) => manifestFor(family, index + 1));
    assert.deepEqual(manifests.map((item) => item.tier), [1, 2, 3, 4, 5], family);
    assert.deepEqual(manifests.map((item) => item.quality), QUALITY, family);
    assert.deepEqual(manifests.map((item) => item.price_band), [1, 2, 3, 4, 5], family);
    assert.deepEqual(manifests.map((item) => item.size_grade), [1, 2, 3, 4, 5], family);
    assert.deepEqual(manifests.map((item) => item.material_grade), [1, 2, 3, 4, 5], family);
    assert.deepEqual(manifests.map((item) => item.custom_woodwork_level), [0, 1, 2, 3, 4], family);
    assert.deepEqual(manifests.map((item) => item.fixture_complexity_grade), [1, 2, 3, 4, 5], family);
    assert.deepEqual(manifests.map((item) => item.integrated_light_count), LIGHTS, family);
    assert.equal(new Set(manifests.map((item) => item.material_story)).size, 5, family);

    for (let index = 1; index < manifests.length; index += 1) {
      const previous = manifests[index - 1];
      const current = manifests[index];
      current.target_dimensions_m.forEach((dimension, axis) => {
        assert.ok(dimension > previous.target_dimensions_m[axis],
          `${family} Tier ${index + 1} axis ${axis} must be larger`);
      });
      assert.ok(current.sockets.length > previous.sockets.length,
        `${family} Tier ${index + 1} must increase stocking/display capacity`);
    }
  }
});

test('all GLBs are self-contained, UV mapped, collision-ready, stockable, and metadata complete', () => {
  for (const family of FAMILIES) {
    for (let tier = 1; tier <= 5; tier += 1) {
      const { id, buffer, json } = glbFor(family, tier);
      const root = json.nodes.find((node) => node.name === id);
      assert.ok(root, `${id} root node`);
      assert.equal(root.extras?.display_family, family, id);
      assert.equal(root.extras?.display_tier, tier, id);
      assert.equal(root.extras?.size_grade, tier, id);
      assert.equal(root.extras?.material_grade, tier, id);
      assert.equal(root.extras?.custom_woodwork_level, tier - 1, id);
      assert.equal(root.extras?.fixture_complexity_grade, tier, id);
      assert.equal(root.extras?.integrated_light_count, LIGHTS[tier - 1], id);
      assert.equal(root.extras?.license, 'Project-owned / UNLICENSED', id);
      assert.match(root.extras?.source || '', /generated in-repository/u, id);
      for (const hash of REFERENCE_HASHES) assert.match(root.extras?.reference_sha256 || '', new RegExp(hash, 'u'), id);

      assert.ok(json.nodes.some((node) => node.name?.startsWith('COL_') && node.extras?.collision_proxy),
        `${id} simplified collision proxy`);
      assert.ok(json.nodes.some((node) => node.extras?.slot === true), `${id} stocking socket`);
      assert.equal(json.nodes.filter((node) => node.name?.startsWith('LIGHT_PUCK_')).length,
        LIGHTS[tier - 1], `${id} authored integrated-light meshes`);
      for (const mesh of json.meshes || []) {
        for (const primitive of mesh.primitives || []) {
          assert.ok(Number.isInteger(primitive.attributes?.TEXCOORD_0), `${id} every mesh primitive has UV0`);
        }
      }
      assert.ok((json.buffers || []).every((item) => !item.uri), `${id} has no external buffer`);
      assert.ok((json.images || []).every((item) => !item.uri), `${id} has no external image`);

      const audit = auditGlbBuffer(buffer, { displayPath: `Assets/pro_shop/glb/fixtures/${id}.glb` });
      assert.deepEqual(audit.warnings, [], `${id} footprint warnings`);
      assert.ok(audit.geometry.triangles > 0, `${id} triangle count`);
      assert.ok(audit.scene.transformedBounds, `${id} transformed scene bounds`);
      assert.equal(audit.animations.length, 0, `${id} has no unintended animation clips`);
      assert.equal(audit.cameras.length, 0, `${id} has no camera`);
      assert.equal(audit.lights.length, 0, `${id} uses emissive meshes, not runtime lights`);
    }
  }
});

test('doors and rotating components retain correct moving-part pivots', () => {
  for (const family of ['drink_refrigerator', 'glass_display_tower', 'rotating_display']) {
    for (let tier = 1; tier <= 5; tier += 1) {
      const { id, json } = glbFor(family, tier);
      assert.ok(json.nodes.some((node) => node.extras?.moving_part === true), `${id} moving pivot`);
    }
  }
  for (let tier = 3; tier <= 5; tier += 1) {
    const { id, json } = glbFor('built_in_cabinetry', tier);
    assert.ok(json.nodes.some((node) => node.extras?.pivot_type === 'hinge'), `${id} cabinet door hinge`);
  }
});

test('factory-clean Blender reimport validates all assets and produces an uncropped sheet per family', () => {
  const report = JSON.parse(readFileSync(diskPath(
    'qa/store_display_assets/clean_reimport/clean-reimport-report.json',
  ), 'utf8'));
  assert.equal(report.summary.familyCount, 18);
  assert.equal(report.summary.assetCount, 90);
  assert.equal(report.summary.errorCount, 0);
  assert.deepEqual(report.summary.errors, []);
  assert.deepEqual(report.families.map((item) => item.family), FAMILIES);
  for (const family of report.families) {
    assert.ok(existsSync(diskPath(family.comparison)), `${family.family} comparison sheet`);
    assert.deepEqual(family.assets.map((asset) => asset.errors), [[], [], [], [], []], family.family);
  }
});
