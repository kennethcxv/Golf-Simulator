import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION,
  CASHIER_REPOSITORY_ROOT,
  cashierProductionFileManifest,
  captureCashierBuildSnapshot,
  compareCashierBuildSnapshots,
} from './cashier-build-snapshot.mjs';

export const CAPTURE_39_PROVENANCE_SCHEMA_VERSION = 1;
export const CAPTURE_39_PROVENANCE_FILE = 'capture-39-provenance.json';

const TOOL_PATH = fileURLToPath(import.meta.url);
const LIFECYCLE_DRIVER_PATH = path.join(path.dirname(TOOL_PATH),
  'simplified-register-lifecycle-stress.mjs');
const BUILD_SNAPSHOT_TOOL_PATH = path.join(path.dirname(TOOL_PATH), 'cashier-build-snapshot.mjs');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPECTED_ARTIFACT_NAMES = Object.freeze({
  lifecycleResult: 'lifecycle-result.json',
  lifecycleSummary: 'lifecycle-summary.md',
  lifecycleResourceDetails: 'lifecycle-resource-details.json',
  lifecycleMetrics: 'lifecycle-metrics.png',
  runnerResult: 'runner-result.json',
  buildBeforeSnapshot: 'build-before.json',
  buildAfterSnapshot: 'build-after.json',
});

export class Capture39ProvenanceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Capture39ProvenanceError';
  }
}

function fail(message) {
  throw new Capture39ProvenanceError(message);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function posixPath(value) {
  return String(value).replaceAll('\\', '/');
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

function repositoryPath(repositoryRoot, absolutePath) {
  if (!insideRoot(repositoryRoot, absolutePath)) return posixPath(absolutePath);
  return posixPath(path.relative(repositoryRoot, absolutePath));
}

function readRequiredFile(absolutePath, label) {
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    fail(`${label} is missing: ${absolutePath}`);
  }
  if (!stat.isFile() || stat.size === 0) fail(`${label} must be a non-empty file: ${absolutePath}`);
  const bytes = fs.readFileSync(absolutePath);
  return { bytes, stat };
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function artifactRecord(absolutePath, bytes, repositoryRoot, extra = {}) {
  return {
    path: repositoryPath(repositoryRoot, absolutePath),
    bytes: bytes.length,
    sha256: sha256(bytes),
    ...extra,
  };
}

function resolveExactLifecycleArtifact(lifecycleRoot, reference, expectedName, label) {
  if (typeof reference !== 'string' || reference.trim() === '') {
    fail(`${label} does not contain a file reference.`);
  }
  const absolute = path.resolve(path.isAbsolute(reference)
    ? reference
    : path.join(lifecycleRoot, reference));
  const expected = path.resolve(lifecycleRoot, expectedName);
  if (!insideRoot(lifecycleRoot, absolute) || pathKey(absolute) !== pathKey(expected)) {
    fail(`${label} must reference ${expectedName} in the lifecycle root; got ${reference}.`);
  }
  return absolute;
}

let crcTable = null;

function pngCrc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readPngMetadata(bytes, label) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail(`${label} is not a structurally valid PNG.`);
  }
  let offset = 8;
  let width = null;
  let height = null;
  let sawIdat = false;
  let sawIend = false;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail(`${label} has a truncated PNG chunk header.`);
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (crcOffset + 4 > bytes.length) fail(`${label} has a truncated PNG chunk payload.`);
    const type = bytes.toString('ascii', typeStart, dataStart);
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = pngCrc32(bytes.subarray(typeStart, dataEnd));
    if (expectedCrc !== actualCrc) fail(`${label} has an invalid ${type} CRC.`);
    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) fail(`${label} does not begin with a valid IHDR.`);
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      if (width < 1 || height < 1) fail(`${label} has invalid dimensions.`);
    }
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') {
      if (length !== 0) fail(`${label} has a non-empty IEND chunk.`);
      sawIend = true;
      offset = crcOffset + 4;
      if (offset !== bytes.length) fail(`${label} has trailing bytes after IEND.`);
      break;
    }
    offset = crcOffset + 4;
    chunkIndex += 1;
  }
  if (!sawIdat || !sawIend) fail(`${label} is missing IDAT or IEND.`);
  return { width, height };
}

function validateIsoTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail(`${label} must be an ISO timestamp.`);
  }
  return Date.parse(value);
}

function validateBuildSnapshot(snapshot, label, expectedFiles) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    fail(`${label} must be a JSON object.`);
  }
  if (snapshot.schemaVersion !== CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION) {
    fail(`${label} must use cashier build snapshot schema v${CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION}.`);
  }
  if (snapshot.algorithm !== 'sha256') fail(`${label} must use SHA-256.`);
  validateIsoTimestamp(snapshot.capturedAt, `${label}.capturedAt`);
  if (!SHA256_PATTERN.test(snapshot.aggregateHash || '')) {
    fail(`${label}.aggregateHash is not a lowercase SHA-256.`);
  }
  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0) {
    fail(`${label}.files must be a non-empty array.`);
  }
  if (snapshot.fileCount !== snapshot.files.length) {
    fail(`${label}.fileCount does not match its files array.`);
  }
  if (!snapshot.productionBuildHashes || typeof snapshot.productionBuildHashes !== 'object'
      || Array.isArray(snapshot.productionBuildHashes)) {
    fail(`${label}.productionBuildHashes must be an object.`);
  }

  const normalizedExpected = [...new Set(expectedFiles.map(posixPath))].sort();
  const actualPaths = snapshot.files.map((entry) => entry?.path);
  if (JSON.stringify(actualPaths) !== JSON.stringify(normalizedExpected)) {
    fail(`${label} does not contain the exact full cashier production manifest.`);
  }
  if (Object.keys(snapshot.productionBuildHashes).sort().join('\0') !== normalizedExpected.join('\0')) {
    fail(`${label}.productionBuildHashes does not contain the exact full manifest.`);
  }

  for (const entry of snapshot.files) {
    if (!entry || entry.missing || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
        || !SHA256_PATTERN.test(entry.sha256 || '')) {
      fail(`${label} has an invalid or missing file entry for ${entry?.path || 'unknown'}.`);
    }
    if (snapshot.productionBuildHashes[entry.path] !== entry.sha256) {
      fail(`${label}.productionBuildHashes disagrees with files for ${entry.path}.`);
    }
  }
  const expectedAggregate = crypto.createHash('sha256')
    .update(snapshot.files.map((entry) => (
      `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`
    )).join(''))
    .digest('hex');
  if (snapshot.aggregateHash !== expectedAggregate) {
    fail(`${label}.aggregateHash does not match its file entries.`);
  }
}

function validateLifecycleResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    fail('lifecycle-result.json must contain an object.');
  }
  if (result.ok !== true || result.blocker) fail('Capture #39 requires an explicit lifecycle PASS.');
  if (result.protocol?.profile !== 'master') {
    fail(`Capture #39 requires the master lifecycle profile; got ${result.protocol?.profile || 'missing'}.`);
  }
  if (result.protocol?.viewport !== '1600x900' || result.protocol?.deviceScaleFactor !== 1) {
    fail('Capture #39 requires the exact 1600x900 viewport at deviceScaleFactor 1.');
  }
  if (result.protocol?.requestedCycles !== 200 || result.protocol?.completedCycles !== 200
      || !Array.isArray(result.cycles) || result.cycles.length !== 200) {
    fail('Capture #39 master evidence requires exactly 200 requested and completed sales.');
  }
  if (result.gates?.ok !== true || result.gates?.stabilityEnforced !== true
      || !Array.isArray(result.gates?.checks) || result.gates.checks.length === 0
      || result.gates.checks.some((entry) => entry?.ok !== true)) {
    fail('Capture #39 requires every enforced lifecycle/resource gate to pass.');
  }
  const cardinality = Object.values(result.cardinality || {});
  if (cardinality.length === 0 || cardinality.some((entry) => entry?.ok !== true)) {
    fail('Capture #39 requires every lifecycle cardinality gate to pass.');
  }
  for (const diagnostic of ['consoleErrors', 'pageErrors', 'nonAbortedFailedRequests']) {
    if (!Array.isArray(result.diagnostics?.[diagnostic])
        || result.diagnostics[diagnostic].length !== 0) {
      fail(`Capture #39 requires zero ${diagnostic}.`);
    }
  }

  const capture = result.evidence?.longSessionResourceCounts;
  const overlay = capture?.overlayModel;
  const overlayProvenance = overlay?.provenance;
  const captureProvenance = capture?.provenance;
  if (capture?.captureNumber !== 39
      || capture?.requirement !== 'long-session resource counts'
      || capture?.status !== 'captured'
      || overlay?.captureNumber !== 39
      || overlay?.result !== 'PASS'
      || overlay?.ok !== true
      || overlay?.profile !== 'master'
      || overlay?.viewport !== '1600x900'
      || overlay?.gates?.failed !== 0
      || overlay?.gates?.stabilityEnforced !== true
      || overlayProvenance?.kind !== 'qa-only DOM overlay'
      || overlayProvenance?.injectedBy !== 'tools/qa/simplified-register-lifecycle-stress.mjs'
      || overlayProvenance?.overlayElementId !== 'register-lifecycle-metrics'
      || overlayProvenance?.presentationOnly !== true
      || overlayProvenance?.rawJsonAuthoritative !== true
      || overlayProvenance?.gameplaySourceModified !== false
      || captureProvenance?.injectedBy !== overlayProvenance.injectedBy
      || captureProvenance?.rawJsonAuthoritative !== true
      || captureProvenance?.gameplaySourceModified !== false) {
    fail('Capture #39 lifecycle overlay provenance is missing, incomplete, or not PASS.');
  }
  return capture;
}

function validateResourceDetails(resourceDetails) {
  if (!resourceDetails || typeof resourceDetails !== 'object' || Array.isArray(resourceDetails)
      || !Array.isArray(resourceDetails.phaseMarks)
      || !resourceDetails.resources || typeof resourceDetails.resources !== 'object'
      || !resourceDetails.animationMixers || typeof resourceDetails.animationMixers !== 'object') {
    fail('lifecycle-resource-details.json is missing required lifecycle probe data.');
  }
}

function validateMarkdown(bytes) {
  const markdown = bytes.toString('utf8');
  for (const required of [
    '# Simplified register lifecycle stress',
    '- Result: **PASS**',
    '- Profile: `master`',
    '- Viewport: `1600x900`',
    '## Capture #39 provenance',
    '- Capture status: **captured**',
    '- Gameplay source modified by overlay: **no**',
  ]) {
    if (!markdown.includes(required)) fail(`lifecycle-summary.md is missing: ${required}`);
  }
}

function exactArtifactPaths(lifecycleRoot, result, capture) {
  const paths = {
    lifecycleResult: resolveExactLifecycleArtifact(
      lifecycleRoot, result.evidence?.json,
      EXPECTED_ARTIFACT_NAMES.lifecycleResult, 'evidence.json',
    ),
    lifecycleSummary: resolveExactLifecycleArtifact(
      lifecycleRoot, result.evidence?.markdown,
      EXPECTED_ARTIFACT_NAMES.lifecycleSummary, 'evidence.markdown',
    ),
    lifecycleResourceDetails: resolveExactLifecycleArtifact(
      lifecycleRoot, result.evidence?.resourceDetails,
      EXPECTED_ARTIFACT_NAMES.lifecycleResourceDetails, 'evidence.resourceDetails',
    ),
    lifecycleMetrics: resolveExactLifecycleArtifact(
      lifecycleRoot, result.evidence?.screenshot,
      EXPECTED_ARTIFACT_NAMES.lifecycleMetrics, 'evidence.screenshot',
    ),
  };
  const aliases = [
    [capture.screenshot, paths.lifecycleMetrics, 'Capture #39 screenshot'],
    [capture.authoritativeRawJson, paths.lifecycleResult, 'Capture #39 authoritative raw JSON'],
    [capture.authoritativeResourceDetails, paths.lifecycleResourceDetails,
      'Capture #39 authoritative resource details'],
  ];
  for (const [reference, expected, label] of aliases) {
    const resolved = path.resolve(path.isAbsolute(reference || '')
      ? reference
      : path.join(lifecycleRoot, reference || ''));
    if (pathKey(resolved) !== pathKey(expected)) fail(`${label} does not match the evidence envelope.`);
  }
  return paths;
}

export function writeCashierBuildSnapshotFile({
  outputPath,
  repositoryRoot = CASHIER_REPOSITORY_ROOT,
  files = null,
} = {}) {
  if (!outputPath) fail('Snapshot outputPath is required.');
  const absoluteOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  const snapshot = captureCashierBuildSnapshot({ repositoryRoot, files });
  const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(absoluteOutput, bytes);
  return {
    outputPath: absoluteOutput,
    sha256: sha256(bytes),
    snapshot,
  };
}

export function generateCapture39LifecycleProvenance({
  lifecycleRoot,
  beforeSnapshotPath = null,
  afterSnapshotPath = null,
  outputPath = null,
  repositoryRoot = CASHIER_REPOSITORY_ROOT,
  productionFiles = null,
} = {}) {
  if (!lifecycleRoot) fail('lifecycleRoot is required.');
  const root = path.resolve(lifecycleRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    fail(`Lifecycle root is missing: ${root}`);
  }
  const resultPath = path.join(root, EXPECTED_ARTIFACT_NAMES.lifecycleResult);
  const beforePath = path.resolve(beforeSnapshotPath
    || path.join(root, EXPECTED_ARTIFACT_NAMES.buildBeforeSnapshot));
  const afterPath = path.resolve(afterSnapshotPath
    || path.join(root, EXPECTED_ARTIFACT_NAMES.buildAfterSnapshot));
  const provenancePath = path.resolve(outputPath || path.join(root, CAPTURE_39_PROVENANCE_FILE));
  for (const [candidate, label] of [
    [beforePath, 'Before snapshot'],
    [afterPath, 'After snapshot'],
    [provenancePath, 'Capture #39 provenance output'],
  ]) {
    if (!insideRoot(root, candidate)) fail(`${label} must stay inside the lifecycle root.`);
  }
  if (pathKey(provenancePath) !== pathKey(path.join(root, CAPTURE_39_PROVENANCE_FILE))) {
    fail(`Capture #39 provenance output must be named ${CAPTURE_39_PROVENANCE_FILE}.`);
  }
  if ([resultPath, beforePath, afterPath].some((entry) => pathKey(entry) === pathKey(provenancePath))) {
    fail('Capture #39 provenance output cannot overwrite an input artifact.');
  }

  const resultFile = readRequiredFile(resultPath, 'lifecycle-result.json');
  const result = parseJson(resultFile.bytes, 'lifecycle-result.json');
  const capture = validateLifecycleResult(result);
  const evidencePaths = exactArtifactPaths(root, result, capture);

  const evidenceFiles = {
    lifecycleResult: resultFile,
    lifecycleSummary: readRequiredFile(evidencePaths.lifecycleSummary, 'lifecycle-summary.md'),
    lifecycleResourceDetails: readRequiredFile(
      evidencePaths.lifecycleResourceDetails, 'lifecycle-resource-details.json',
    ),
    lifecycleMetrics: readRequiredFile(evidencePaths.lifecycleMetrics, 'lifecycle-metrics.png'),
    runnerResult: readRequiredFile(
      path.join(root, EXPECTED_ARTIFACT_NAMES.runnerResult), 'runner-result.json',
    ),
  };
  validateMarkdown(evidenceFiles.lifecycleSummary.bytes);
  const resourceDetails = parseJson(
    evidenceFiles.lifecycleResourceDetails.bytes, 'lifecycle-resource-details.json',
  );
  validateResourceDetails(resourceDetails);
  const runnerResult = parseJson(evidenceFiles.runnerResult.bytes, 'runner-result.json');
  if (runnerResult?.ok !== true
      || !evidenceFiles.runnerResult.bytes.equals(evidenceFiles.lifecycleResult.bytes)) {
    fail('runner-result.json must be an explicit PASS and byte-identical to lifecycle-result.json.');
  }
  const png = readPngMetadata(evidenceFiles.lifecycleMetrics.bytes, 'lifecycle-metrics.png');
  if (png.width !== 1600 || png.height !== 900) {
    fail(`Capture #39 PNG must be exactly 1600x900; got ${png.width}x${png.height}.`);
  }
  if (fs.existsSync(path.join(root, 'lifecycle-failure.png'))) {
    fail('A lifecycle-failure.png artifact exists in the purported PASS evidence root.');
  }

  const beforeFile = readRequiredFile(beforePath, 'build-before.json');
  const afterFile = readRequiredFile(afterPath, 'build-after.json');
  const before = parseJson(beforeFile.bytes, 'build-before.json');
  const after = parseJson(afterFile.bytes, 'build-after.json');
  const expectedProductionFiles = productionFiles
    ? [...new Set(productionFiles.map(posixPath))].sort()
    : cashierProductionFileManifest({ repositoryRoot });
  validateBuildSnapshot(before, 'build-before.json', expectedProductionFiles);
  validateBuildSnapshot(after, 'build-after.json', expectedProductionFiles);
  const buildComparison = compareCashierBuildSnapshots(before, after);
  if (!buildComparison.unchanged) {
    fail(`Production build changed during lifecycle QA: ${buildComparison.changedFiles
      .map((entry) => `${entry.change}:${entry.path}`).join(', ') || 'aggregate mismatch'}.`);
  }

  const runStartedAt = validateIsoTimestamp(result.timings?.run?.startedAt, 'timings.run.startedAt');
  const runFinishedAt = validateIsoTimestamp(result.timings?.run?.finishedAt, 'timings.run.finishedAt');
  const beforeCapturedAt = validateIsoTimestamp(before.capturedAt, 'build-before.json.capturedAt');
  const afterCapturedAt = validateIsoTimestamp(after.capturedAt, 'build-after.json.capturedAt');
  if (runStartedAt > runFinishedAt || beforeCapturedAt > runStartedAt
      || afterCapturedAt < runFinishedAt || beforeCapturedAt > afterCapturedAt) {
    fail('Build snapshots do not bracket the authoritative lifecycle run.');
  }

  const current = captureCashierBuildSnapshot({
    repositoryRoot,
    files: expectedProductionFiles,
  });
  validateBuildSnapshot(current, 'current cashier build', expectedProductionFiles);
  const currentComparison = compareCashierBuildSnapshots(after, current);
  if (!currentComparison.unchanged) {
    fail(`Current production build no longer matches lifecycle QA: ${currentComparison.changedFiles
      .map((entry) => `${entry.change}:${entry.path}`).join(', ') || 'aggregate mismatch'}.`);
  }

  const artifactPaths = {
    lifecycleResult: resultPath,
    lifecycleSummary: evidencePaths.lifecycleSummary,
    lifecycleResourceDetails: evidencePaths.lifecycleResourceDetails,
    lifecycleMetrics: evidencePaths.lifecycleMetrics,
    runnerResult: path.join(root, EXPECTED_ARTIFACT_NAMES.runnerResult),
    buildBeforeSnapshot: beforePath,
    buildAfterSnapshot: afterPath,
    generatorTool: TOOL_PATH,
    lifecycleDriver: LIFECYCLE_DRIVER_PATH,
    buildSnapshotTool: BUILD_SNAPSHOT_TOOL_PATH,
  };
  const toolFile = readRequiredFile(TOOL_PATH, 'Capture #39 provenance generator');
  const lifecycleDriverFile = readRequiredFile(
    LIFECYCLE_DRIVER_PATH, 'Capture #39 lifecycle driver',
  );
  const buildSnapshotToolFile = readRequiredFile(
    BUILD_SNAPSHOT_TOOL_PATH, 'Cashier build snapshot helper',
  );
  const artifacts = {
    lifecycleResult: artifactRecord(resultPath, evidenceFiles.lifecycleResult.bytes,
      repositoryRoot, { mediaType: 'application/json' }),
    lifecycleSummary: artifactRecord(evidencePaths.lifecycleSummary,
      evidenceFiles.lifecycleSummary.bytes, repositoryRoot, { mediaType: 'text/markdown' }),
    lifecycleResourceDetails: artifactRecord(evidencePaths.lifecycleResourceDetails,
      evidenceFiles.lifecycleResourceDetails.bytes, repositoryRoot,
      { mediaType: 'application/json' }),
    lifecycleMetrics: artifactRecord(evidencePaths.lifecycleMetrics,
      evidenceFiles.lifecycleMetrics.bytes, repositoryRoot,
      { mediaType: 'image/png', width: png.width, height: png.height }),
    runnerResult: artifactRecord(artifactPaths.runnerResult,
      evidenceFiles.runnerResult.bytes, repositoryRoot, { mediaType: 'application/json' }),
    buildBeforeSnapshot: artifactRecord(beforePath, beforeFile.bytes,
      repositoryRoot, { mediaType: 'application/json' }),
    buildAfterSnapshot: artifactRecord(afterPath, afterFile.bytes,
      repositoryRoot, { mediaType: 'application/json' }),
    generatorTool: artifactRecord(TOOL_PATH, toolFile.bytes,
      repositoryRoot, { mediaType: 'text/javascript' }),
    lifecycleDriver: artifactRecord(LIFECYCLE_DRIVER_PATH, lifecycleDriverFile.bytes,
      repositoryRoot, { mediaType: 'text/javascript' }),
    buildSnapshotTool: artifactRecord(BUILD_SNAPSHOT_TOOL_PATH, buildSnapshotToolFile.bytes,
      repositoryRoot, { mediaType: 'text/javascript' }),
  };
  if (Object.keys(artifacts).length !== Object.keys(artifactPaths).length
      || Object.values(artifacts).some((entry) => !SHA256_PATTERN.test(entry.sha256))) {
    fail('Not every referenced Capture #39 file has a SHA-256 record.');
  }

  const provenance = {
    schemaVersion: CAPTURE_39_PROVENANCE_SCHEMA_VERSION,
    kind: 'cashier-capture-39-lifecycle-provenance',
    ok: true,
    captureNumber: 39,
    requirement: 'Long-session resource counts',
    verdict: 'PASS',
    generatedAt: new Date().toISOString(),
    authority: 'lifecycle-result.json is authoritative; lifecycle-metrics.png is its same-run QA-only presentation; this sidecar binds both to unchanged production source.',
    protocol: {
      profile: result.protocol.profile,
      viewport: result.protocol.viewport,
      deviceScaleFactor: result.protocol.deviceScaleFactor,
      requestedCycles: result.protocol.requestedCycles,
      completedCycles: result.protocol.completedCycles,
    },
    gates: {
      lifecyclePass: true,
      everyLifecycleGatePassed: true,
      everyCardinalityPassed: true,
      diagnosticsClean: true,
      captureOverlayPass: true,
      artifactsValid: true,
      productionBuildUnchanged: true,
      currentProductionBuildMatches: true,
      everyReferencedFileHashed: true,
    },
    productionBuildHashes: { ...before.productionBuildHashes },
    productionBuildSnapshot: {
      schemaVersion: before.schemaVersion,
      algorithm: before.algorithm,
      beforeCapturedAt: before.capturedAt,
      afterCapturedAt: after.capturedAt,
      currentVerifiedAt: current.capturedAt,
      beforeAggregateHash: before.aggregateHash,
      afterAggregateHash: after.aggregateHash,
      currentAggregateHash: current.aggregateHash,
      beforeFileCount: before.fileCount,
      afterFileCount: after.fileCount,
      currentFileCount: current.fileCount,
      unchanged: true,
      currentUnchanged: true,
      changedFiles: [],
    },
    artifacts,
    evidence: {
      longSessionResourceCounts: {
        captureNumber: 39,
        requirement: capture.requirement,
        status: capture.status,
        screenshot: artifacts.lifecycleMetrics.path,
        authoritativeRawJson: artifacts.lifecycleResult.path,
        authoritativeResourceDetails: artifacts.lifecycleResourceDetails.path,
        overlayModel: capture.overlayModel,
        provenance: capture.provenance,
      },
    },
    artifactHashCount: Object.keys(artifacts).length,
  };
  const outputBytes = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
  const outputSha256 = sha256(outputBytes);

  // Keep this as the final filesystem operation. A failed validation must never
  // create or partially refresh the Capture #39 source-result sidecar.
  fs.writeFileSync(provenancePath, outputBytes);
  return { outputPath: provenancePath, sha256: outputSha256, provenance };
}

function parseCli(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail(`Unknown argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`Argument ${token} requires a value.`);
    if (Object.hasOwn(values, key)) fail(`Argument ${token} was provided more than once.`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function cliUsage() {
  return [
    'Usage:',
    '  node tools/qa/capture-39-lifecycle-provenance.mjs snapshot --output <build-before-or-after.json> [--repository-root <path>]',
    '  node tools/qa/capture-39-lifecycle-provenance.mjs finalize --lifecycle-root <path> [--before <path>] [--after <path>] [--output <path>] [--repository-root <path>]',
  ].join('\n');
}

async function main(argv) {
  const [command = 'finalize', ...rawOptions] = argv;
  const options = parseCli(rawOptions);
  const repositoryRoot = path.resolve(options['repository-root'] || CASHIER_REPOSITORY_ROOT);
  if (command === 'snapshot') {
    const result = writeCashierBuildSnapshotFile({
      outputPath: options.output,
      repositoryRoot,
    });
    console.log(JSON.stringify({
      ok: true,
      outputPath: result.outputPath,
      sha256: result.sha256,
      aggregateHash: result.snapshot.aggregateHash,
      fileCount: result.snapshot.fileCount,
    }));
    return;
  }
  if (command !== 'finalize') fail(`Unknown command: ${command}\n${cliUsage()}`);
  const result = generateCapture39LifecycleProvenance({
    lifecycleRoot: options['lifecycle-root'],
    beforeSnapshotPath: options.before,
    afterSnapshotPath: options.after,
    outputPath: options.output,
    repositoryRoot,
  });
  console.log(JSON.stringify({
    ok: true,
    outputPath: result.outputPath,
    sha256: result.sha256,
    aggregateHash: result.provenance.productionBuildSnapshot.beforeAggregateHash,
    fileCount: result.provenance.productionBuildSnapshot.beforeFileCount,
  }));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Capture #39 provenance failed: ${error.message}`);
    console.error(cliUsage());
    process.exitCode = 1;
  });
}
