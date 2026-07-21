import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ASSETS as ASSETS_01_50 } from './assets-01-50-spec.mjs';
import { ASSETS as ASSETS_51_100 } from './assets-51-100-spec.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(MODULE_DIR, '..', '..');

const posix = (value) => String(value).replaceAll('\\', '/');

function relativeToRoot(absolute, repositoryRoot) {
  return posix(path.relative(repositoryRoot, absolute));
}

function insideRoot(absolute, repositoryRoot) {
  const relative = path.relative(repositoryRoot, absolute);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolveRepositoryPath(value, repositoryRoot) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const absolute = path.resolve(repositoryRoot, ...posix(value).split('/'));
  return insideRoot(absolute, repositoryRoot) ? absolute : null;
}

function fileHash(absolute) {
  return crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
}

function integrationFiles(asset) {
  if (Array.isArray(asset.runtimeIntegrationFiles)) return asset.runtimeIntegrationFiles;
  return [];
}

function recordPath(asset, field, value, repositoryRoot) {
  if (!value) return null;
  const absolute = resolveRepositoryPath(value, repositoryRoot);
  return {
    assetNumber: asset.assetNumber,
    field,
    path: posix(value),
    insideRepository: !!absolute,
    exists: !!absolute && fs.existsSync(absolute) && fs.statSync(absolute).isFile(),
  };
}

export function auditManifestRange({
  assets,
  first,
  last,
  repositoryRoot = REPOSITORY_ROOT,
}) {
  const expectedNumbers = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const actualNumbers = assets.map((asset) => asset.assetNumber);
  const duplicateNumbers = actualNumbers.filter((number, index) => actualNumbers.indexOf(number) !== index);
  const duplicateStems = assets
    .map((asset) => asset.stem)
    .filter((stem, index, values) => values.indexOf(stem) !== index);
  const pathRecords = [];

  for (const asset of assets) {
    for (const [field, value] of [
      ['referenceImagePath', asset.referenceImagePath],
      ['source', asset.source],
      ['canonicalGlb', asset.canonicalGlb],
      ['runtimeGlb', asset.runtimeGlb],
    ]) {
      const record = recordPath(asset, field, value, repositoryRoot);
      if (record) pathRecords.push(record);
    }
    for (const value of integrationFiles(asset)) {
      const record = recordPath(asset, 'runtimeIntegrationFiles', value, repositoryRoot);
      if (record) pathRecords.push(record);
    }
  }

  const missing = pathRecords.filter((record) => !record.exists);
  const escaped = pathRecords.filter((record) => !record.insideRepository);
  const missingByField = Object.groupBy(missing, (record) => record.field);
  const identity = [];
  for (const asset of assets) {
    if (!asset.canonicalGlb || !asset.runtimeGlb) continue;
    const canonical = resolveRepositoryPath(asset.canonicalGlb, repositoryRoot);
    const runtime = resolveRepositoryPath(asset.runtimeGlb, repositoryRoot);
    if (!canonical || !runtime || !fs.existsSync(canonical) || !fs.existsSync(runtime)) continue;
    const canonicalSha256 = fileHash(canonical);
    const runtimeSha256 = fileHash(runtime);
    identity.push({
      assetNumber: asset.assetNumber,
      canonicalGlb: posix(asset.canonicalGlb),
      runtimeGlb: posix(asset.runtimeGlb),
      byteIdentical: canonicalSha256 === runtimeSha256,
      canonicalSha256,
      runtimeSha256,
    });
  }

  const structuralOk = JSON.stringify(actualNumbers) === JSON.stringify(expectedNumbers)
    && duplicateNumbers.length === 0
    && duplicateStems.length === 0;
  const requiredArtifactFields = new Set(['referenceImagePath', 'source', 'runtimeGlb']);
  const requiredArtifactsMissing = missing.filter((record) => requiredArtifactFields.has(record.field));
  const runtimeBindingsMissing = missingByField.runtimeIntegrationFiles || [];

  return {
    range: [first, last],
    recordCount: assets.length,
    expectedNumbers,
    actualNumbers,
    duplicateNumbers: [...new Set(duplicateNumbers)],
    duplicateStems: [...new Set(duplicateStems)],
    pathCount: pathRecords.length,
    missing,
    escaped,
    requiredArtifactsMissing,
    runtimeBindingsMissing,
    canonicalRuntimeIdentity: {
      compared: identity.length,
      mismatches: identity.filter((record) => !record.byteIdentical),
      records: identity,
      advisory: 'A mismatch is reported for review, not failed automatically; optimized or intentionally substituted runtime candidates can differ from canonical GLBs.',
    },
    checks: {
      orderedCompleteRange: structuralOk,
      pathsStayInsideRepository: escaped.length === 0,
      requiredArtifactsPresent: requiredArtifactsMissing.length === 0,
      runtimeBindingsPresent: runtimeBindingsMissing.length === 0,
    },
    ok: structuralOk
      && escaped.length === 0
      && requiredArtifactsMissing.length === 0
      && runtimeBindingsMissing.length === 0,
  };
}

function walkSourceFiles(repositoryRoot) {
  const roots = ['src', 'index.html'];
  const files = [];
  const visit = (absolute) => {
    const stat = fs.statSync(absolute);
    if (stat.isFile()) {
      if (/\.(?:js|css|html)$/iu.test(absolute)) files.push(absolute);
      return;
    }
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (/\.(?:js|css|html)$/iu.test(entry.name)) files.push(child);
    }
  };
  for (const root of roots) {
    const absolute = path.join(repositoryRoot, root);
    if (fs.existsSync(absolute)) visit(absolute);
  }
  return files.sort();
}

export function auditLiteralRuntimePaths({ repositoryRoot = REPOSITORY_ROOT } = {}) {
  const extensions = '(?:glb|gltf|bin|png|jpe?g|webp|svg|json|wav|mp3|ogg|woff2)';
  const quoted = new RegExp(`(['\"\\x60])([^'\"\\x60\\r\\n]+\\.${extensions}(?:\\?[^'\"\\x60\\r\\n]*)?)\\1`, 'giu');
  const references = [];
  for (const sourceFile of walkSourceFiles(repositoryRoot)) {
    const source = fs.readFileSync(sourceFile, 'utf8');
    for (const match of source.matchAll(quoted)) {
      let value = match[2];
      if (value.includes('${') || /^(?:https?:|data:|blob:)/iu.test(value)) continue;
      value = value.split('?')[0].split('#')[0];
      let absolute = null;
      if (value.startsWith('/')) absolute = path.resolve(repositoryRoot, `.${value}`);
      else if (value.startsWith('./') || value.startsWith('../')) {
        absolute = path.resolve(path.dirname(sourceFile), value);
      } else if (/^(?:Assets|Designs|asset_sources|src|vendor)\//u.test(value)) {
        absolute = path.resolve(repositoryRoot, ...value.split('/'));
      }
      if (!absolute || !insideRoot(absolute, repositoryRoot)) continue;
      references.push({
        source: relativeToRoot(sourceFile, repositoryRoot),
        path: posix(value),
        resolved: relativeToRoot(absolute, repositoryRoot),
        exists: fs.existsSync(absolute) && fs.statSync(absolute).isFile(),
      });
    }
  }
  const unique = [...new Map(references.map((record) => (
    [`${record.source}\0${record.path}`, record]
  ))).values()];
  return {
    referenceCount: unique.length,
    missing: unique.filter((record) => !record.exists),
    references: unique,
    ok: unique.every((record) => record.exists),
  };
}

export function auditAssetManifests({ repositoryRoot = REPOSITORY_ROOT } = {}) {
  const assets01to50 = auditManifestRange({
    assets: ASSETS_01_50,
    first: 1,
    last: 50,
    repositoryRoot,
  });
  const assets51to100 = auditManifestRange({
    assets: ASSETS_51_100,
    first: 51,
    last: 100,
    repositoryRoot,
  });
  const literalRuntimePaths = auditLiteralRuntimePaths({ repositoryRoot });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repositoryRoot,
    assets01to50,
    assets51to100,
    literalRuntimePaths,
    gates: {
      assets01to50Manifest: assets01to50.ok,
      assets51to100Manifest: assets51to100.ok,
      runtimeAssetPaths: literalRuntimePaths.ok,
    },
    ok: assets01to50.ok && assets51to100.ok && literalRuntimePaths.ok,
  };
}

export function selectAuditGate(report, selectedGate = 'all') {
  const gateResults = {
    all: report.ok,
    'assets-1-50': report.gates.assets01to50Manifest,
    'assets-51-100': report.gates.assets51to100Manifest,
    'runtime-paths': report.gates.runtimeAssetPaths,
  };
  if (!(selectedGate in gateResults)) {
    throw new Error(`Unknown --gate value: ${selectedGate}`);
  }
  const selectedOk = gateResults[selectedGate];
  return {
    ...report,
    aggregateOk: report.ok,
    selectedGate: { id: selectedGate, ok: selectedOk },
    ok: selectedOk,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file:///${posix(path.resolve(process.argv[1]))}`).href;
if (isMain) {
  const aggregateReport = auditAssetManifests();
  const output = argument('--out');
  const selectedGate = argument('--gate') || 'all';
  const report = selectAuditGate(aggregateReport, selectedGate);
  if (output) {
    const absolute = path.resolve(output);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
