import test from 'node:test';
import assert from 'node:assert/strict';

import { ASSETS as PRODUCTION_ASSET_SPEC } from '../tools/qa/assets-51-100-spec.mjs';
import {
  METERS_TO_YARDS,
  SHEET06_REGISTRATION_ID,
  metersToYards,
} from '../src/render3d/assets51to100/units.js';
import {
  SHEET06_ASSETS,
  SHEET06_BY_NUMBER,
  validateSheet06Manifest,
} from '../src/render3d/assets51to100/sheet06Manifest.js';
import asset051Default, {
  ASSET_051_FINISHED_CLUBHOUSE_EXTERIOR,
} from '../src/render3d/assets51to100/asset_051_finished_clubhouse_exterior.js';
import asset052Default, {
  ASSET_052_DILAPIDATED_CLUBHOUSE_EXTERIOR,
} from '../src/render3d/assets51to100/asset_052_dilapidated_clubhouse_exterior.js';
import asset053Default, {
  ASSET_053_MAIN_ENTRANCE_DOUBLE_DOOR,
} from '../src/render3d/assets51to100/asset_053_main_entrance_double_door.js';
import asset054Default, {
  ASSET_054_EXTERIOR_PORCH_AND_STEPS,
} from '../src/render3d/assets51to100/asset_054_exterior_porch_and_steps.js';
import asset055Default, {
  ASSET_055_CLUBHOUSE_WINDOWS_SET,
} from '../src/render3d/assets51to100/asset_055_clubhouse_windows_set.js';
import asset056Default, {
  ASSET_056_INTERIOR_WALL_PANEL_KIT,
} from '../src/render3d/assets51to100/asset_056_interior_wall_panel_kit.js';
import asset057Default, {
  ASSET_057_INTERIOR_TRIM_AND_BASEBOARD_KIT,
} from '../src/render3d/assets51to100/asset_057_interior_trim_and_baseboard_kit.js';
import asset058Default, {
  ASSET_058_CEILING_AND_BEAM_KIT,
} from '../src/render3d/assets51to100/asset_058_ceiling_and_beam_kit.js';
import asset059Default, {
  ASSET_059_RENOVATED_FLOORING_SET,
} from '../src/render3d/assets51to100/asset_059_renovated_flooring_set.js';
import asset060Default, {
  ASSET_060_DAMAGED_FLOORING_SET,
} from '../src/render3d/assets51to100/asset_060_damaged_flooring_set.js';

const SPEC = PRODUCTION_ASSET_SPEC.filter(({ assetNumber }) => assetNumber >= 51 && assetNumber <= 60);
const MODULE_EXPORTS = [
  [asset051Default, ASSET_051_FINISHED_CLUBHOUSE_EXTERIOR],
  [asset052Default, ASSET_052_DILAPIDATED_CLUBHOUSE_EXTERIOR],
  [asset053Default, ASSET_053_MAIN_ENTRANCE_DOUBLE_DOOR],
  [asset054Default, ASSET_054_EXTERIOR_PORCH_AND_STEPS],
  [asset055Default, ASSET_055_CLUBHOUSE_WINDOWS_SET],
  [asset056Default, ASSET_056_INTERIOR_WALL_PANEL_KIT],
  [asset057Default, ASSET_057_INTERIOR_TRIM_AND_BASEBOARD_KIT],
  [asset058Default, ASSET_058_CEILING_AND_BEAM_KIT],
  [asset059Default, ASSET_059_RENOVATED_FLOORING_SET],
  [asset060Default, ASSET_060_DAMAGED_FLOORING_SET],
];

const EXPECTED_MOUNTS = Object.freeze([
  ['group', 'CLUBHOUSE_FINISHED_FLOOR_ORIGIN'],
  ['group', 'ASSET_051_CANONICAL_ORIGIN'],
  ['group', 'MAIN_ENTRANCE_THRESHOLD_CENTER'],
  ['group', 'ASSET_051_SOCKET_Porch'],
  ['group', 'SHOP_LAYOUT_STABLE_WINDOW_DATUMS'],
  ['interior', 'INTERIOR_FINISHED_FLOOR_WALL_GRID'],
  ['interior', 'INTERIOR_FINISHED_FLOOR_TRIM_GRID'],
  ['interior', 'INTERIOR_CEILING_GRID'],
  ['interior', 'INTERIOR_FINISHED_FLOOR_ORIGIN'],
  ['interior', 'ASSET_059_CANONICAL_WALK_PLANE'],
]);

test('Sheet-6 manifest is frozen, ordered, indexed, and registered as one version', () => {
  assert.equal(METERS_TO_YARDS, 1.0936133);
  assert.equal(metersToYards(2.5), 2.5 * 1.0936133);
  assert.equal(SHEET06_REGISTRATION_ID, 'PINEHOLLOW_CLUBHOUSE_S06_V1');
  assert.deepEqual(SHEET06_ASSETS.map(({ assetNumber }) => assetNumber), [51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
  assert.equal(validateSheet06Manifest(SHEET06_ASSETS), true);
  assert.equal(Object.isFrozen(SHEET06_ASSETS), true);
  assert.equal(Object.isFrozen(SHEET06_BY_NUMBER), true);

  for (const asset of SHEET06_ASSETS) {
    assert.equal(SHEET06_BY_NUMBER[asset.assetNumber], asset);
    assert.equal(asset.registrationId, SHEET06_REGISTRATION_ID);
  }
});

test('all ten modules expose the same deeply frozen binding as named and default exports', () => {
  MODULE_EXPORTS.forEach(([defaultExport, namedExport], index) => {
    const manifestAsset = SHEET06_ASSETS[index];
    assert.equal(defaultExport, namedExport);
    assert.equal(defaultExport, manifestAsset);
    for (const value of [
      manifestAsset,
      manifestAsset.paths,
      manifestAsset.dimensionsMeters,
      manifestAsset.requiredSockets,
      manifestAsset.requiredPivots,
      manifestAsset.requiredAnimations,
      manifestAsset.mount,
      manifestAsset.collision,
    ]) {
      assert.equal(Object.isFrozen(value), true, `Asset ${manifestAsset.assetNumber} contract must be frozen`);
    }
  });
});

test('bindings reproduce the authoritative Sheet-6 names, dimensions, paths, sockets, pivots, and animations', () => {
  assert.equal(SPEC.length, 10);

  SHEET06_ASSETS.forEach((binding, index) => {
    const spec = SPEC[index];
    const id = String(spec.assetNumber).padStart(3, '0');
    const logicalId = `A_${id}_${spec.stem.toUpperCase()}`;

    assert.equal(binding.assetNumber, spec.assetNumber);
    assert.equal(binding.name, spec.referenceName);
    assert.equal(binding.stem, spec.stem);
    assert.equal(binding.referenceImagePath, spec.referenceImagePath);
    assert.deepEqual(binding.dimensionsMeters, spec.intendedDimensions);
    assert.deepEqual(binding.paths, {
      source: spec.plannedPaths.source,
      canonicalGlb: spec.plannedPaths.canonicalGlb,
      runtimeGlb: spec.plannedPaths.runtimeGlb,
      integrationModule: spec.plannedPaths.runtimeIntegrationFile,
    });
    assert.equal(binding.assetId, logicalId);
    assert.equal(binding.rootName, `${logicalId}_ROOT`);
    assert.deepEqual(binding.requiredSockets, spec.requiredSockets);
    assert.deepEqual(binding.requiredPivots, spec.requiredSockets.filter((marker) => marker.startsWith('PIVOT_')));
    assert.deepEqual(binding.requiredAnimations, spec.requiredAnimations);
    assert.equal(binding.runtimeScale, METERS_TO_YARDS);
    assert.equal(binding.mount.root, EXPECTED_MOUNTS[index][0]);
    assert.equal(binding.mount.placementDatum, EXPECTED_MOUNTS[index][1]);
    assert.equal(binding.mount.scaleExactlyOnce, true);
    assert.match(binding.fallbackKey, new RegExp(`^sheet06\\.asset${id}\\.`));
  });
});

test('GLB collision stays authored metadata while runtime navigation remains analytic', () => {
  for (const asset of SHEET06_ASSETS) {
    assert.equal(asset.collision.runtimeNavigationAuthority, 'ANALYTIC_LAYOUT');
    assert.equal(asset.collision.glbNavigationAuthority, 'NONE');
    assert.equal(asset.collision.activateGlbCollision, false);
    assert.equal('ownsNavigationCollision' in asset.collision, false);
  }

  const finished = SHEET06_BY_NUMBER[51];
  const damaged = SHEET06_BY_NUMBER[52];
  assert.equal(finished.collision.authoredCollisionDesignAuthority, true);
  assert.equal(finished.structuralContract.role, 'CANONICAL_STRUCTURAL_AUTHORITY');
  assert.equal(finished.structuralContract.structuralAuthority, true);
  assert.equal(finished.structuralContract.ownsCanonicalStructure, true);
  assert.equal(finished.structuralContract.duplicateFullShellAllowed, false);

  assert.equal(damaged.structuralContract.role, 'ADDITIVE_DAMAGE_VISUALS');
  assert.equal(damaged.structuralContract.structuralAuthorityAssetNumber, 51);
  assert.equal(damaged.structuralContract.additiveDamageOnly, true);
  assert.equal(damaged.structuralContract.ownsCanonicalStructure, false);
  assert.equal(damaged.structuralContract.ownsNavigationCollision, false);
  assert.equal(damaged.structuralContract.duplicateFullShellAllowed, false);
});

test('validator rejects reordered assets, duplicate IDs or paths, and unsafe loader contracts', () => {
  const reordered = [...SHEET06_ASSETS];
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => validateSheet06Manifest(reordered), /exact 51-60 order/);

  const duplicateId = [...SHEET06_ASSETS];
  duplicateId[1] = { ...duplicateId[1], assetId: duplicateId[0].assetId, rootName: `${duplicateId[0].assetId}_ROOT` };
  assert.throws(() => validateSheet06Manifest(duplicateId), /assetId must be unique/);

  const duplicatePath = [...SHEET06_ASSETS];
  duplicatePath[1] = {
    ...duplicatePath[1],
    paths: { ...duplicatePath[1].paths, runtimeGlb: duplicatePath[0].paths.runtimeGlb },
  };
  assert.throws(() => validateSheet06Manifest(duplicatePath), /runtimeGlb must be unique/);

  const unsafeCollision = [...SHEET06_ASSETS];
  unsafeCollision[2] = {
    ...unsafeCollision[2],
    collision: { ...unsafeCollision[2].collision, activateGlbCollision: true },
  };
  assert.throws(() => validateSheet06Manifest(unsafeCollision), /analytic runtime navigation authority/);
});
