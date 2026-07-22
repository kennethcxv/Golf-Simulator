import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = path.join(
  REPO_ROOT, 'qa', 'assets_51_100_master', 'sheet_06', 'clean_reimport.json',
);
const MARKDOWN_PATH = path.join(
  REPO_ROOT, 'qa', 'assets_51_100_master', 'sheet_06', 'clean_reimport.md',
);

const EXPECTED_CHECKS = Object.freeze([
  'artifactIntegrity',
  'cleanSceneImport',
  'identityRoot',
  'hierarchyAndNames',
  'markers',
  'animations',
  'noCamerasOrLights',
  'metricDimensionsAndGroundContact',
  'collisionContract',
  'materialsAndUvs',
  'meshTransforms',
  'assetSpecific',
]);

const EXPECTED_STEMS = Object.freeze([
  'finished_clubhouse_exterior',
  'dilapidated_clubhouse_exterior',
  'main_entrance_double_door',
  'exterior_porch_and_steps',
  'clubhouse_windows_set',
  'interior_wall_panel_kit',
  'interior_trim_and_baseboard_kit',
  'ceiling_and_beam_kit',
  'renovated_flooring_set',
  'damaged_flooring_set',
]);

function assertNoSkipped(value, trail = 'report') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSkipped(entry, `${trail}[${index}]`));
    return;
  }
  if (value == null || typeof value !== 'object') return;
  assert.equal(Object.hasOwn(value, 'skipped'), false, `${trail} may not contain a skipped result`);
  for (const [key, entry] of Object.entries(value)) assertNoSkipped(entry, `${trail}.${key}`);
}

test('Sheet-6 clean-Blender reimport evidence is complete and production-green', () => {
  assert.ok(existsSync(REPORT_PATH),
    'Run Blender with tools/blender/verify_assets_51_60_reimport.py before this gate.');
  assert.ok(existsSync(MARKDOWN_PATH), 'Clean-reimport Markdown evidence is missing.');
  const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  const markdown = readFileSync(MARKDOWN_PATH, 'utf8');

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.reportKind, 'sheet06-clean-blender-reimport');
  assert.match(report.blenderVersion, /^5\.1(?:\.|$)/u,
    'Sheet-6 evidence must come from the pinned Blender 5.1 line.');
  assert.deepEqual(report.assetRange, [51, 60]);
  assert.equal(report.units, 'meters');
  assert.deepEqual(report.requiredCheckNames, EXPECTED_CHECKS);
  assertNoSkipped(report);

  assert.equal(report.assets.length, 10);
  assert.deepEqual(report.assets.map(({ assetNumber }) => assetNumber),
    [51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
  assert.deepEqual(report.assets.map(({ stem }) => stem), EXPECTED_STEMS);
  assert.equal(report.summary.assetCount, 10);
  assert.equal(report.summary.totalChecks, 10 * EXPECTED_CHECKS.length);
  assert.equal(report.summary.crossAssetCheckCount, 2);

  for (const asset of report.assets) {
    assert.equal(asset.importedRepresentation, 'canonicalGlb');
    assert.deepEqual(Object.keys(asset.checks), EXPECTED_CHECKS,
      `Asset ${asset.assetNumber} mandatory reimport checks`);
    for (const [name, check] of Object.entries(asset.checks)) {
      assert.equal(typeof check.ok, 'boolean', `Asset ${asset.assetNumber} ${name} ok`);
      assert.ok(Array.isArray(check.issues), `Asset ${asset.assetNumber} ${name} issues`);
      assert.equal(typeof check.measurements, 'object', `Asset ${asset.assetNumber} ${name} measurements`);
    }
    const artifact = asset.checks.artifactIntegrity.measurements;
    assert.match(artifact.canonicalSha256 || '', /^[a-f0-9]{64}$/u);
    assert.equal(artifact.canonicalSha256, artifact.runtimeSha256,
      `Asset ${asset.assetNumber} canonical/runtime SHA identity`);
    assert.equal(artifact.byteIdentical, true);
  }

  const exterior = report.crossAssetChecks.exteriorRegistrationAndAuthority;
  const alignment = report.crossAssetChecks.asset54MainEntranceToAsset51PorchAlignment;
  assert.equal(typeof exterior?.ok, 'boolean');
  assert.equal(typeof alignment?.ok, 'boolean');
  assert.equal(exterior.measurements.registrationId, 'PINEHOLLOW_CLUBHOUSE_S06_V1');
  assert.equal(exterior.measurements.sharedMarkerCount, 8);

  const asset53 = report.assets.find(({ assetNumber }) => assetNumber === 53);
  assert.deepEqual(asset53.checks.animations.measurements.actualActions,
    ['DoorLeft_Close', 'DoorLeft_Open', 'DoorRight_Close', 'DoorRight_Open']);
  assert.equal(asset53.checks.animations.measurements.targetsMatchPivots, true);

  const asset54 = report.assets.find(({ assetNumber }) => assetNumber === 54);
  assert.deepEqual(asset54.checks.assetSpecific.measurements.mainEntranceLocationMeters,
    [0, 0, 0.27432],
    'Asset 54 must be republished with the revised finished-floor entrance datum.');
  assert.equal(asset54.checks.assetSpecific.measurements.deckSurfaceTopMeters, 0.27432,
    'The reimported OakDeckBoards surface must share the revised entrance datum.');
  assert.deepEqual(asset54.checks.assetSpecific.measurements.actualRootExtras, {
    deck_surface_z_m: 0.27432,
    main_entrance_alignment_z_m: 0.27432,
    stair_rise_count: 2,
  });
  assert.equal(asset54.checks.assetSpecific.measurements.stairMeshRiseCount, 2);
  assert.deepEqual(alignment.measurements.translationResidualMeters, [0, 0, 0]);

  const asset60 = report.assets.find(({ assetNumber }) => assetNumber === 60);
  const relief = asset60.checks.assetSpecific.measurements.visibleReliefMeters;
  assert.ok(relief > 0 && relief <= 0.035,
    `Asset 60 visible relief ${relief}m exceeds the authored envelope.`);

  const computedOk = report.assets.every(({ ok }) => ok)
    && Object.values(report.crossAssetChecks).every(({ ok }) => ok)
    && report.summary.failedChecks === 0;
  assert.equal(report.ok, computedOk, 'Overall status must be derived from every mandatory check.');
  assert.equal(report.ok, true,
    'Clean-Blender evidence cannot turn green until every revised Sheet-6 artifact is republished.');
  assert.equal(report.summary.passedAssets, 10);
  assert.equal(report.summary.failedAssets, 0);
  assert.equal(report.summary.passedChecks, report.summary.totalChecks);
  assert.equal(report.summary.passedCrossAssetChecks, 2);
  assert.match(markdown, /Overall: \*\*PASS\*\*/u);
  assert.match(markdown, /Assets passed: 10\/10/u);
});
