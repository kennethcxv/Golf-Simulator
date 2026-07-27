import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { planProductPackaging, productPackagingFor } from '../src/data/productPackaging.js';
import { PRO_SHOP_FURNITURE_SKUS } from '../src/data/proShopFurniture.js';

const REPORT_PATH = 'qa/chairs/blender/blender-validation.json';
const REQUIRED_SEATING_NODES = [
  'ENTRY_POINT_LEFT',
  'ENTRY_POINT_RIGHT',
  'EXIT_POINT_LEFT',
  'EXIT_POINT_RIGHT',
  'FOOT_ANCHOR_LEFT',
  'FOOT_ANCHOR_RIGHT',
  'HAND_ANCHOR_LEFT',
  'HAND_ANCHOR_RIGHT',
  'INTERACTION_POINT',
  'PLACEMENT_FOOTPRINT',
  'SEAT_ANCHOR',
  'SIT_INTERACTION_POINT',
  'SOCKET_PLACEMENT',
  'SOCKET_Seat',
];

const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));

test('the authoritative Blender chair build and fresh GLB re-import pass', () => {
  assert.equal(report.passed, true);
  assert.equal(report.assetCount, 5);
  assert.deepEqual(report.failedAssets, []);
  assert.deepEqual(report.assets.map((asset) => asset.asset), [
    'Chair_Basic',
    'Chair_Standard',
    'Chair_Premium',
    'Chair_HighEnd',
    'Chair_Luxury',
  ]);
  assert.ok(existsSync(report.comparison.preview));
  assert.ok(existsSync(report.comparison.source));

  for (const asset of report.assets) {
    assert.deepEqual(asset.issues, [], asset.asset);
    assert.deepEqual(asset.sourceValidation.issues, [], `${asset.asset} source`);
    assert.deepEqual(asset.reimportValidation.issues, [], `${asset.asset} re-import`);
    for (const path of [asset.source, asset.glb, asset.runtimeGlb, ...Object.values(asset.lods)]) {
      assert.ok(existsSync(path), path);
    }
    for (const path of Object.values(asset.previews)) assert.ok(existsSync(path), path);

    const triangles = asset.sourceValidation.triangles;
    assert.ok(triangles.LOD0 > triangles.LOD1, `${asset.asset} LOD0 > LOD1`);
    assert.ok(triangles.LOD1 > triangles.LOD2, `${asset.asset} LOD1 > LOD2`);
    assert.ok(asset.sourceValidation.collisionMeshes >= 4, `${asset.asset} collision proxies`);
    assert.ok(asset.sourceValidation.materials.length >= 4, `${asset.asset} material set`);
    assert.ok(asset.sourceValidation.textureBackedMaterials.length >= 1, `${asset.asset} texture-backed PBR`);
    for (const name of REQUIRED_SEATING_NODES) {
      assert.ok(asset.sourceValidation.interactionNodes.includes(name), `${asset.asset}: ${name}`);
    }
    assert.equal(asset.sourceValidation.characterValidation.passed, true, asset.asset);
    assert.equal(asset.sourceValidation.characterValidation.entryExitBothSides, true, asset.asset);
    assert.ok(asset.sourceValidation.characterValidation.rigs.every((rig) => rig.passed), asset.asset);
  }
});

test('office chairs retain swivel, caster, height, recline, and desk-fit contracts', () => {
  for (const asset of report.assets.filter((entry) => entry.kind === 'office')) {
    const mechanisms = asset.sourceValidation.mechanismExercise;
    assert.equal(mechanisms.officeMechanismsRequired, true, asset.asset);
    assert.equal(mechanisms.swivel.passed, true, asset.asset);
    assert.equal(mechanisms.height.passed, true, asset.asset);
    assert.equal(mechanisms.castersPassed, true, asset.asset);
    assert.equal(mechanisms.casters.length, 5, asset.asset);
    assert.ok(asset.reimportValidation.animationClips.includes('Swivel_360_Test'), asset.asset);
    assert.ok(asset.reimportValidation.animationClips.includes('Height_Raise'), asset.asset);
    if (asset.sourceValidation.animationClips.includes('Recline_Back')) {
      assert.equal(mechanisms.recline.hingeStayedFixed, true, asset.asset);
      assert.ok(mechanisms.recline.backrestTopTravelM > 0.05, asset.asset);
      assert.ok(asset.reimportValidation.animationClips.includes('Recline_Return'), asset.asset);
    }
    assert.equal(asset.deskCompatibility.passed, true, asset.asset);
    assert.equal(asset.deskCompatibility.results.length, 5, asset.asset);
    assert.ok(asset.deskCompatibility.results.every((desk) => desk.passed), asset.asset);
  }
});

test('club chairs stay stationary while retaining stable seating contracts', () => {
  for (const asset of report.assets.filter((entry) => entry.kind === 'lounge')) {
    assert.equal(asset.sourceValidation.mechanismExercise.stationary, true, asset.asset);
    assert.equal(asset.sourceValidation.mechanismExercise.seatingAnchorStable, true, asset.asset);
    assert.equal(asset.deskCompatibility.applicable, false, asset.asset);
    assert.deepEqual(asset.reimportValidation.animationClips, [], asset.asset);
  }
});

test('all five chair SKUs have exact one-chair supplier packaging contracts', () => {
  const chairs = PRO_SHOP_FURNITURE_SKUS.filter((sku) => sku.furnitureCategory === 'chairs');
  assert.equal(chairs.length, 5);
  for (const sku of chairs) {
    const contract = productPackagingFor(sku.id);
    assert.equal(contract.catalogCategory, 'decor', sku.id);
    assert.equal(contract.unitWeightLb, sku.lb, sku.id);
    assert.equal(contract.unitsPerBox, 1, sku.id);
    assert.equal(contract.packing.allowScale, false, sku.id);
    assert.equal(contract.packing.contentScale, 1, sku.id);
    const shipment = planProductPackaging(sku.id, 1);
    assert.equal(shipment.boxCount, 1, sku.id);
    assert.equal(shipment.boxes[0].units, 1, sku.id);
  }
});
