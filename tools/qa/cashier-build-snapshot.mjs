import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION = 2;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CASHIER_REPOSITORY_ROOT = path.resolve(MODULE_DIR, '..', '..');

// Required checkout roots. The manifest below also discovers the complete
// shared browser source tree; this explicit minimum makes accidental routing or
// directory-discovery regressions fail loudly in focused tests.
export const CASHIER_PRODUCTION_SOURCE_FILES = Object.freeze([
  'index.html',
  'src/core/audio.js',
  'src/core/storage.js',
  'src/core/utils.js',
  'src/data/fixtureSlots.js',
  'src/data/shopItems.js',
  'src/data/shopLayout.js',
  'src/main.js',
  'src/render3d/characterAsset.js',
  'src/render3d/clubhouse.js',
  'src/render3d/clubhouse/catalogProductVisual.js',
  'src/render3d/clubhouse/customerFlow.js',
  'src/render3d/clubhouse/customerPaidBag.js',
  'src/render3d/clubhouse/fixtureCoreBatching.js',
  'src/render3d/clubhouse/fixtures.js',
  'src/render3d/clubhouse/frontDeskMonitorUi.js',
  'src/render3d/clubhouse/interiorShadowPolicy.js',
  'src/render3d/clubhouse/materials.js',
  'src/render3d/clubhouse/merch.js',
  'src/render3d/clubhouse/nav.js',
  'src/render3d/clubhouse/registerCameraPoses.js',
  'src/render3d/clubhouse/registerItemResources.js',
  'src/render3d/clubhouse/resourceLifecycle.js',
  'src/render3d/clubhouse/scopedBooleanOverride.js',
  'src/render3d/clubhouse/sharedTexturePool.js',
  'src/render3d/clubhouse/simplifiedRegisterMode.js',
  'src/render3d/clubhouse/stockResources.js',
  'src/render3d/courseScene.js',
  'src/render3d/disposeSceneResources.js',
  'src/sim/checkout.js',
  'src/sim/checkoutPreferences.js',
  'src/sim/economy.js',
  'src/sim/paymentBag.js',
  'src/sim/register.js',
  'src/sim/registerFlow.js',
  'src/sim/shop.js',
  'src/sim/state.js',
  'src/styles.css',
  'src/ui/laptop.js',
  'src/ui/ui.js',
].sort());

function posixPath(value) {
  return String(value).replaceAll('\\', '/');
}

function directoryRuntimeSources(repositoryRoot, relativeDirectory, predicate) {
  const directory = path.resolve(repositoryRoot, relativeDirectory);
  if (!fs.existsSync(directory)) {
    throw new Error(`Cashier production source directory is missing: ${posixPath(relativeDirectory)}`);
  }
  const discovered = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile()) {
        const relative = posixPath(path.relative(repositoryRoot, absolute));
        if (predicate(relative)) discovered.push(relative);
      }
    }
  }
  return discovered.sort();
}

export function cashierProductionFileManifest({
  repositoryRoot = CASHIER_REPOSITORY_ROOT,
} = {}) {
  // Checkout executes inside the shared browser application. Camera, renderer,
  // lifecycle, save, UI, and newly imported modules can change the measured
  // result even when the register file itself is untouched. Discover the full
  // runtime source tree so new modules fail closed instead of escaping a
  // hand-maintained checkout-only list.
  const applicationSources = directoryRuntimeSources(
    repositoryRoot,
    'src',
    (relative) => /\.(?:js|css)$/i.test(relative),
  );
  // The checkout route enters the shared clubhouse/course application. Those
  // modules eagerly or asynchronously load merchandise, delivery, Sheet-06,
  // course, flora, and texture files from vendor/. Fingerprint the complete
  // runtime vendor tree so a GLB, JSON manifest, or normal-map rebuild cannot
  // silently change the measured browser build while preserving this aggregate.
  const vendorRuntimeFiles = directoryRuntimeSources(
    repositoryRoot,
    'vendor',
    () => true,
  );
  return [...new Set([
    ...CASHIER_PRODUCTION_SOURCE_FILES,
    ...applicationSources,
    ...vendorRuntimeFiles,
  ])].sort();
}

function resolveManifestFile(repositoryRoot, relativePath) {
  const root = path.resolve(repositoryRoot);
  const normalized = posixPath(relativePath).replace(/^\.\//, '');
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (!relative || relative === '.') {
    throw new Error(`Cashier production manifest entry must name a file: ${normalized}`);
  }
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Cashier production manifest entry escapes the repository: ${normalized}`);
  }
  return { absolute, relative: posixPath(relative) };
}

function sha256File(absolutePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
}

export function captureCashierBuildSnapshot({
  repositoryRoot = CASHIER_REPOSITORY_ROOT,
  files = null,
  allowMissing = false,
} = {}) {
  const manifest = [...new Set((files || cashierProductionFileManifest({ repositoryRoot }))
    .map(posixPath))].sort();
  if (manifest.length === 0) throw new Error('Cashier production manifest is empty.');

  const entries = manifest.map((manifestPath) => {
    const resolved = resolveManifestFile(repositoryRoot, manifestPath);
    if (!fs.existsSync(resolved.absolute)) {
      if (allowMissing) {
        return { path: resolved.relative, bytes: null, sha256: null, missing: true };
      }
      throw new Error(`Cashier production file is missing: ${resolved.relative}`);
    }
    const stat = fs.statSync(resolved.absolute);
    if (!stat.isFile()) throw new Error(`Cashier production entry is not a file: ${resolved.relative}`);
    return {
      path: resolved.relative,
      bytes: stat.size,
      sha256: sha256File(resolved.absolute),
    };
  });
  const productionBuildHashes = Object.fromEntries(
    entries.map((entry) => [entry.path, entry.sha256]),
  );
  const aggregateHash = crypto.createHash('sha256')
    .update(entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join(''))
    .digest('hex');

  return {
    schemaVersion: CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION,
    algorithm: 'sha256',
    capturedAt: new Date().toISOString(),
    fileCount: entries.length,
    aggregateHash,
    productionBuildHashes,
    files: entries,
  };
}

export function compareCashierBuildSnapshots(before, after) {
  if (!before || !after) throw new Error('Both cashier build snapshots are required.');
  const beforeFiles = new Map((before.files || []).map((entry) => [entry.path, entry]));
  const afterFiles = new Map((after.files || []).map((entry) => [entry.path, entry]));
  const changedFiles = [];
  for (const filePath of [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].sort()) {
    const previous = beforeFiles.get(filePath) || null;
    const current = afterFiles.get(filePath) || null;
    const previousExists = !!previous && !previous.missing;
    const currentExists = !!current && !current.missing;
    if (previousExists && currentExists
        && previous.sha256 === current.sha256 && previous.bytes === current.bytes) continue;
    changedFiles.push({
      path: filePath,
      change: !previousExists ? 'added' : !currentExists ? 'removed' : 'modified',
      before: previousExists ? { bytes: previous.bytes, sha256: previous.sha256 } : null,
      after: currentExists ? { bytes: current.bytes, sha256: current.sha256 } : null,
    });
  }
  const unchanged = before.schemaVersion === after.schemaVersion
    && before.algorithm === after.algorithm
    && before.aggregateHash === after.aggregateHash
    && changedFiles.length === 0;
  return {
    unchanged,
    beforeAggregateHash: before.aggregateHash,
    afterAggregateHash: after.aggregateHash,
    beforeFileCount: Number(before.fileCount || beforeFiles.size),
    afterFileCount: Number(after.fileCount || afterFiles.size),
    changedFiles,
  };
}

function collectEvidencePngs(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  const found = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) found.push(absolute);
    }
  };
  visit(path.resolve(directory));
  return found.sort((left, right) => posixPath(left).localeCompare(posixPath(right)));
}

function evidencePathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function uniqueEvidencePngs(entries) {
  const unique = new Map();
  for (const entry of entries || []) {
    if (typeof entry !== 'string' || !entry.toLowerCase().endsWith('.png')) continue;
    const resolved = path.resolve(entry);
    if (!unique.has(evidencePathKey(resolved))) unique.set(evidencePathKey(resolved), resolved);
  }
  return [...unique.values()]
    .sort((left, right) => posixPath(left).localeCompare(posixPath(right)));
}

function evidencePngInventory(evidencePngs, evidenceRoot) {
  const recorded = uniqueEvidencePngs(evidencePngs);
  const onDisk = evidenceRoot ? uniqueEvidencePngs(collectEvidencePngs(evidenceRoot)) : [];
  const recordedKeys = new Set(recorded.map(evidencePathKey));
  const diskKeys = new Set(onDisk.map(evidencePathKey));
  const missingEvidencePngs = recorded.filter((file) => {
    try {
      return !fs.statSync(file).isFile();
    } catch {
      return true;
    }
  });
  const missingKeys = new Set(missingEvidencePngs.map(evidencePathKey));
  const unreferencedEvidencePngs = evidenceRoot
    ? onDisk.filter((file) => !recordedKeys.has(evidencePathKey(file)))
    : [];
  const recordedEvidencePngsOutsideRoot = evidenceRoot
    ? recorded.filter((file) => (
      !missingKeys.has(evidencePathKey(file)) && !diskKeys.has(evidencePathKey(file))
    ))
    : [];
  return {
    recorded,
    onDisk,
    missingEvidencePngs,
    unreferencedEvidencePngs,
    recordedEvidencePngsOutsideRoot,
  };
}

export function finalizeCashierQaResult({
  result,
  beforeSnapshot,
  afterSnapshot = null,
  evidencePngs = [],
  evidenceRoot = null,
  repositoryRoot = CASHIER_REPOSITORY_ROOT,
} = {}) {
  if (!result || typeof result !== 'object') throw new Error('A cashier QA result object is required.');
  const after = afterSnapshot || captureCashierBuildSnapshot({ repositoryRoot, allowMissing: true });
  const buildComparison = compareCashierBuildSnapshots(beforeSnapshot, after);
  const evidenceInventory = evidencePngInventory(evidencePngs, evidenceRoot);
  const pngs = evidenceInventory.recorded;
  const {
    missingEvidencePngs,
    unreferencedEvidencePngs,
    recordedEvidencePngsOutsideRoot,
  } = evidenceInventory;
  const evidenceComplete = missingEvidencePngs.length === 0
    && unreferencedEvidencePngs.length === 0
    && recordedEvidencePngsOutsideRoot.length === 0;
  const provenanceBlockers = [];
  if (!buildComparison.unchanged) {
    provenanceBlockers.push(`Production build changed during QA: ${buildComparison.changedFiles
      .map((entry) => `${entry.change}:${entry.path}`).join(', ') || 'aggregate mismatch'}`);
  }
  if (missingEvidencePngs.length) {
    provenanceBlockers.push(`Evidence PNGs are missing: ${missingEvidencePngs.join(', ')}`);
  }
  if (unreferencedEvidencePngs.length) {
    provenanceBlockers.push(`Unrecorded PNGs exist under the evidence root: ${unreferencedEvidencePngs.join(', ')}`);
  }
  if (recordedEvidencePngsOutsideRoot.length) {
    provenanceBlockers.push(`Recorded PNGs are outside the evidence root: ${recordedEvidencePngsOutsideRoot.join(', ')}`);
  }
  const gates = {
    ...(result.gates || {}),
    productionBuildUnchanged: buildComparison.unchanged,
    everyEvidencePngReferenced: evidenceComplete,
  };

  return {
    ...result,
    ok: result.ok !== false && buildComparison.unchanged && evidenceComplete,
    productionBuildHashes: { ...beforeSnapshot.productionBuildHashes },
    productionBuildSnapshot: {
      schemaVersion: beforeSnapshot.schemaVersion,
      algorithm: beforeSnapshot.algorithm,
      beforeCapturedAt: beforeSnapshot.capturedAt,
      afterCapturedAt: after.capturedAt,
      ...buildComparison,
    },
    evidencePngs: pngs,
    evidenceCoverage: {
      scope: evidenceRoot
        ? 'all PNG files under the evidence root at result finalization'
        : 'driver-recorded PNG files',
      evidenceRoot: evidenceRoot ? path.resolve(evidenceRoot) : null,
      pngCount: pngs.length,
      diskPngCount: evidenceInventory.onDisk.length,
      missingEvidencePngs,
      unreferencedEvidencePngs,
      recordedEvidencePngsOutsideRoot,
      complete: evidenceComplete,
    },
    gates,
    ...(provenanceBlockers.length ? { provenanceBlockers } : {}),
  };
}
