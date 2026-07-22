import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CASHIER_PRODUCTION_SOURCE_FILES,
  CASHIER_REPOSITORY_ROOT,
  cashierProductionFileManifest,
  captureCashierBuildSnapshot,
  compareCashierBuildSnapshots,
  finalizeCashierQaResult,
} from '../tools/qa/cashier-build-snapshot.mjs';

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function recursiveFiles(relativeRoot) {
  const root = path.join(CASHIER_REPOSITORY_ROOT, relativeRoot);
  const pending = [root];
  const files = [];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push(path.relative(CASHIER_REPOSITORY_ROOT, absolute).replaceAll('\\', '/'));
    }
  }
  return files.sort();
}

test('cashier production manifest covers checkout sources, counter, trays, and runtime GLBs', () => {
  const manifest = cashierProductionFileManifest();
  assert.deepEqual(manifest, [...new Set(manifest)].sort(), 'manifest must be unique and sorted');
  for (const required of [
    'index.html',
    'src/main.js',
    'src/styles.css',
    'src/ui/laptop.js',
    'src/render3d/clubhouse/simplifiedRegisterMode.js',
    'src/render3d/clubhouse.js',
    'src/render3d/clubhouse/fixtures.js',
    'src/render3d/clubhouse/interiorShadowPolicy.js',
    'src/render3d/clubhouse/resourceLifecycle.js',
    'src/render3d/clubhouse/sharedTexturePool.js',
    'src/render3d/courseScene.js',
    'src/render3d/disposeSceneResources.js',
    'src/render3d/clubhouse/catalogProductVisual.js',
    'src/render3d/clubhouse/merch.js',
    'src/data/fixtureSlots.js',
    'src/data/shopLayout.js',
    'src/sim/checkout.js',
    'src/sim/paymentBag.js',
    'src/sim/register.js',
    'src/sim/registerFlow.js',
    'src/sim/state.js',
    'src/sim/checkoutPreferences.js',
    'src/render3d/clubhouse/registerCameraPoses.js',
    'src/render3d/clubhouse/frontDeskMonitorUi.js',
    'src/render3d/clubhouse/customerPaidBag.js',
    'src/render3d/characterAsset.js',
    'vendor/addons/loaders/GLTFLoader.js',
    'vendor/addons/objects/Water.js',
    'vendor/three.module.js',
    'vendor/models/clubhouse/checkout_counter.glb',
    'vendor/models/clubhouse/checkout_product_staging_tray.glb',
    'vendor/models/clubhouse/checkout_change_handoff_tray.glb',
    'vendor/models/checkout/pos_monitor.glb',
    'vendor/models/checkout/payment_terminal.glb',
    'vendor/models/checkout/cash_drawer.glb',
    'vendor/models/checkout/receipt_printer.glb',
    'vendor/models/checkout/shopping_bag.glb',
    'vendor/models/clubhouse/delivery_box_cutter.glb',
    'vendor/models/clubhouse/delivery_van.glb',
    'vendor/models/clubhouse/polo_hanging.glb',
    'vendor/textures/roof_nor.jpg',
    'vendor/textures/siding_nor.jpg',
  ]) {
    assert.ok(manifest.includes(required), `missing cashier production file ${required}`);
    assert.ok(fs.statSync(path.join(CASHIER_REPOSITORY_ROOT, required)).isFile(), required);
  }
  assert.ok(CASHIER_PRODUCTION_SOURCE_FILES.every((file) => manifest.includes(file)));
  assert.ok(manifest.some((file) => file.includes('/checkout_product_')),
    'authored checkout product GLBs must be fingerprinted');
  assert.ok(manifest.some((file) => file.includes('/provisions_')),
    'provisions product GLBs must be fingerprinted');
  assert.deepEqual(
    manifest.filter((file) => file.startsWith('vendor/')),
    recursiveFiles('vendor'),
    'every runtime vendor script, model, manifest, and texture must be fingerprinted',
  );
});

test('cashier build snapshot publishes exact per-file SHA-256 hashes and one aggregate', () => {
  const snapshot = captureCashierBuildSnapshot();
  assert.equal(snapshot.algorithm, 'sha256');
  assert.equal(snapshot.fileCount, snapshot.files.length);
  assert.match(snapshot.aggregateHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.keys(snapshot.productionBuildHashes).length, snapshot.fileCount);
  for (const relative of [
    'src/render3d/clubhouse/simplifiedRegisterMode.js',
    'src/render3d/clubhouse.js',
    'vendor/models/clubhouse/checkout_counter.glb',
  ]) {
    assert.equal(
      snapshot.productionBuildHashes[relative],
      sha256(path.join(CASHIER_REPOSITORY_ROOT, relative)),
      relative,
    );
  }
});

test('cashier build comparison identifies modified, added, and removed files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cashier-build-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'a.txt'), 'alpha');
  fs.writeFileSync(path.join(root, 'b.txt'), 'bravo');
  const before = captureCashierBuildSnapshot({ repositoryRoot: root, files: ['a.txt', 'b.txt'] });

  fs.writeFileSync(path.join(root, 'a.txt'), 'alpha changed');
  fs.rmSync(path.join(root, 'b.txt'));
  fs.writeFileSync(path.join(root, 'c.txt'), 'charlie');
  const after = captureCashierBuildSnapshot({ repositoryRoot: root, files: ['a.txt', 'c.txt'] });
  const comparison = compareCashierBuildSnapshots(before, after);
  assert.equal(comparison.unchanged, false);
  assert.deepEqual(
    comparison.changedFiles.map(({ path: file, change }) => [file, change]),
    [['a.txt', 'modified'], ['b.txt', 'removed'], ['c.txt', 'added']],
  );
});

test('result finalization passes when the recorded and on-disk PNG inventories match exactly', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cashier-result-provenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'production.js'), 'export const stable = true;\n');
  const nested = path.join(root, 'evidence', 'nested');
  fs.mkdirSync(nested, { recursive: true });
  const firstPng = path.join(root, 'evidence', '01.png');
  const secondPng = path.join(nested, '02.png');
  fs.writeFileSync(firstPng, 'png-one');
  fs.writeFileSync(secondPng, 'png-two');
  const before = captureCashierBuildSnapshot({
    repositoryRoot: root,
    files: ['production.js'],
  });
  const after = captureCashierBuildSnapshot({
    repositoryRoot: root,
    files: ['production.js'],
  });
  const finalized = finalizeCashierQaResult({
    result: { ok: true, evidence: [firstPng, secondPng] },
    beforeSnapshot: before,
    afterSnapshot: after,
    evidencePngs: [firstPng, secondPng],
    evidenceRoot: path.join(root, 'evidence'),
    repositoryRoot: root,
  });
  assert.equal(finalized.ok, true);
  assert.equal(finalized.gates.productionBuildUnchanged, true);
  assert.equal(finalized.gates.everyEvidencePngReferenced, true);
  assert.equal(finalized.evidenceCoverage.complete, true);
  assert.deepEqual(
    finalized.evidencePngs,
    [firstPng, secondPng].map((file) => path.resolve(file)).sort(),
  );
  assert.equal(finalized.evidenceCoverage.diskPngCount, 2);
  assert.deepEqual(finalized.evidenceCoverage.unreferencedEvidencePngs, []);
  assert.deepEqual(finalized.evidenceCoverage.recordedEvidencePngsOutsideRoot, []);
  assert.deepEqual(finalized.productionBuildHashes, before.productionBuildHashes);
});

test('result finalization fails closed on an unrecorded stale PNG under the evidence root', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cashier-result-stale-png-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'production.js'), 'export const stable = true;\n');
  const evidenceRoot = path.join(root, 'evidence');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const recordedPng = path.join(evidenceRoot, '01-recorded.png');
  const stalePng = path.join(evidenceRoot, '99-stale.png');
  fs.writeFileSync(recordedPng, 'recorded');
  fs.writeFileSync(stalePng, 'stale');
  const before = captureCashierBuildSnapshot({ repositoryRoot: root, files: ['production.js'] });
  const after = captureCashierBuildSnapshot({ repositoryRoot: root, files: ['production.js'] });

  const finalized = finalizeCashierQaResult({
    result: { ok: true },
    beforeSnapshot: before,
    afterSnapshot: after,
    evidencePngs: [recordedPng],
    evidenceRoot,
    repositoryRoot: root,
  });

  assert.equal(finalized.ok, false);
  assert.equal(finalized.gates.everyEvidencePngReferenced, false);
  assert.deepEqual(finalized.evidencePngs, [path.resolve(recordedPng)]);
  assert.deepEqual(finalized.evidenceCoverage.unreferencedEvidencePngs, [path.resolve(stalePng)]);
  assert.match(finalized.provenanceBlockers.join('\n'), /Unrecorded PNGs exist/);
});

test('result finalization fails closed when a recorded PNG is missing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cashier-result-missing-png-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'production.js'), 'export const stable = true;\n');
  const evidenceRoot = path.join(root, 'evidence');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const missingPng = path.join(evidenceRoot, '01-missing.png');
  const before = captureCashierBuildSnapshot({ repositoryRoot: root, files: ['production.js'] });
  const after = captureCashierBuildSnapshot({ repositoryRoot: root, files: ['production.js'] });

  const finalized = finalizeCashierQaResult({
    result: { ok: true },
    beforeSnapshot: before,
    afterSnapshot: after,
    evidencePngs: [missingPng],
    evidenceRoot,
    repositoryRoot: root,
  });

  assert.equal(finalized.ok, false);
  assert.equal(finalized.gates.everyEvidencePngReferenced, false);
  assert.deepEqual(finalized.evidenceCoverage.missingEvidencePngs, [path.resolve(missingPng)]);
  assert.deepEqual(finalized.evidenceCoverage.unreferencedEvidencePngs, []);
  assert.match(finalized.provenanceBlockers.join('\n'), /Evidence PNGs are missing/);
});

test('result finalization without an evidence root preserves driver-recorded PNG behavior', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cashier-result-no-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'production.js'), 'export const stable = true;\n');
  const recordedPng = path.join(root, '01-recorded.png');
  const unrelatedPng = path.join(root, '99-unrelated.png');
  fs.writeFileSync(recordedPng, 'recorded');
  fs.writeFileSync(unrelatedPng, 'unrelated');
  const before = captureCashierBuildSnapshot({ repositoryRoot: root, files: ['production.js'] });
  const after = captureCashierBuildSnapshot({ repositoryRoot: root, files: ['production.js'] });

  const finalized = finalizeCashierQaResult({
    result: { ok: true },
    beforeSnapshot: before,
    afterSnapshot: after,
    evidencePngs: [recordedPng],
    repositoryRoot: root,
  });

  assert.equal(finalized.ok, true);
  assert.equal(finalized.evidenceCoverage.scope, 'driver-recorded PNG files');
  assert.equal(finalized.evidenceCoverage.evidenceRoot, null);
  assert.equal(finalized.evidenceCoverage.diskPngCount, 0);
  assert.deepEqual(finalized.evidencePngs, [path.resolve(recordedPng)]);
  assert.deepEqual(finalized.evidenceCoverage.unreferencedEvidencePngs, []);
});
