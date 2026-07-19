import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  auditLiteralRuntimePaths,
  auditManifestRange,
} from '../tools/qa/validate-asset-manifests.mjs';

function fixtureAsset(number, root) {
  const touch = (name) => {
    const absolute = path.join(root, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, name);
    return name.replaceAll('\\', '/');
  };
  return {
    assetNumber: number,
    stem: `asset_${number}`,
    referenceImagePath: touch(`refs/${number}.png`),
    source: touch(`sources/${number}.blend`),
    canonicalGlb: touch(`canonical/${number}.glb`),
    runtimeGlb: touch(`runtime/${number}.glb`),
    runtimeIntegrationFiles: [touch(`src/${number}.js`)],
  };
}

test('manifest audit fails closed on missing runtime bindings without conflating GLB identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-flipper-assets-'));
  try {
    const assets = [fixtureAsset(1, root), fixtureAsset(2, root)];
    for (const asset of assets) {
      fs.copyFileSync(path.join(root, asset.canonicalGlb), path.join(root, asset.runtimeGlb));
    }
    fs.rmSync(path.join(root, assets[1].runtimeIntegrationFiles[0]));
    fs.writeFileSync(path.join(root, assets[0].runtimeGlb), 'optimized-runtime');
    const report = auditManifestRange({ assets, first: 1, last: 2, repositoryRoot: root });
    assert.equal(report.checks.orderedCompleteRange, true);
    assert.equal(report.checks.requiredArtifactsPresent, true);
    assert.equal(report.checks.runtimeBindingsPresent, false);
    assert.equal(report.runtimeBindingsMissing.length, 1);
    assert.equal(report.runtimeBindingsMissing[0].assetNumber, 2);
    assert.equal(report.canonicalRuntimeIdentity.mismatches.length, 1,
      'intentional optimized variants remain reviewable rather than silently ignored');
    assert.equal(report.ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('literal runtime-path audit resolves root and module-relative assets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-flipper-paths-'));
  try {
    fs.mkdirSync(path.join(root, 'src', 'feature'), { recursive: true });
    fs.mkdirSync(path.join(root, 'vendor', 'models'), { recursive: true });
    fs.writeFileSync(path.join(root, 'vendor', 'models', 'exists.glb'), 'glb');
    fs.writeFileSync(path.join(root, 'src', 'feature', 'local.png'), 'png');
    fs.writeFileSync(path.join(root, 'src', 'feature', 'paths.js'), [
      "export const a = '/vendor/models/exists.glb';",
      "export const b = './local.png';",
      "export const missing = '/vendor/models/missing.glb';",
    ].join('\n'));
    const report = auditLiteralRuntimePaths({ repositoryRoot: root });
    assert.equal(report.referenceCount, 3);
    assert.deepEqual(report.missing.map((entry) => entry.resolved), ['vendor/models/missing.glb']);
    assert.equal(report.ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
