import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const EVIDENCE_OUTPUT_RELATIVE = 'qa/cashier_master_final/evidence/current';
export const MANIFEST_JSON = 'manifest.json';
export const MANIFEST_MARKDOWN = 'manifest.md';

export const MINIMUM_PRODUCTION_BUILD_PATHS = Object.freeze([
  'src/render3d/clubhouse/simplifiedRegisterMode.js',
  'src/render3d/clubhouse.js',
  'src/render3d/clubhouse/fixtures.js',
]);

const CAPTURE_NAMES = Object.freeze([
  'Customer arrival',
  'Products staged',
  'Main checkout view',
  'First product scanned',
  'Mid-bagging',
  'All products bagged',
  'Card in customer hand',
  'Card clicked',
  'Automatic reader motion',
  'Close reader screen',
  'Card inserted',
  'Exact total prefilled',
  'Processing',
  'Approved',
  'Declined',
  'X cancellation',
  'Escape blocked',
  'Cash in customer hand',
  'Cash clicked',
  'Drawer opening',
  'Full drawer',
  'Bill close-up',
  'Coin close-up',
  'Change underpaid',
  'Exact change',
  'Allowed over-change',
  'Receipt printing',
  'Bag handoff',
  'Customer leaving',
  'Register reset',
  'Multiple-customer queue',
  '1280x720 card',
  '1600x900 card',
  '1920x1080 card',
  '1280x720 drawer',
  '1600x900 drawer',
  '1920x1080 drawer',
  'Performance overlay',
  'Long-session resource counts',
  'Save/reload proof',
]);

function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const CAPTURE_REQUIREMENTS = Object.freeze(CAPTURE_NAMES.map((name, index) => {
  const number = index + 1;
  return Object.freeze({
    number,
    name,
    outputFile: `${String(number).padStart(2, '0')}-${slug(name)}.png`,
  });
}));

const REQUIRED_FINAL_CAPTURE_NUMBERS = Object.freeze([38, 39, 40]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_BUILD_HASH_PATHS = Object.freeze([
  'productionBuildHashes',
  'build.productionBuildHashes',
  'build.measuredFiles',
  'authoritativeMetrics.build.measuredFiles',
  'provenance.productionBuildHashes',
  'overlayModel.sourceHashes',
  'evidence.longSessionResourceCounts.productionBuildHashes',
  'evidence.longSessionResourceCounts.overlayModel.productionBuildHashes',
]);

export class EvidenceValidationError extends Error {
  constructor(message, validation) {
    super(message);
    this.name = 'EvidenceValidationError';
    this.validation = validation;
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function posixPath(value) {
  return String(value).replaceAll('\\', '/');
}

function normalizeBuildPath(value) {
  return posixPath(value).replace(/^\.\//, '');
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function addError(errors, id, message, details = null) {
  errors.push({ id, message, ...(details ? { details } : {}) });
}

function getAtPath(value, pathSpec) {
  return String(pathSpec).split('.').reduce((current, key) => current?.[key], value);
}

function normalizeBuildHashMap(value) {
  const output = {};
  if (Array.isArray(value)) {
    for (const entry of value) {
      const buildPath = entry?.path;
      const hash = entry?.sha256;
      if (typeof buildPath === 'string' && typeof hash === 'string') {
        output[normalizeBuildPath(buildPath)] = hash.toLowerCase();
      }
    }
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [buildPath, rawHash] of Object.entries(value)) {
    const hash = typeof rawHash === 'string' ? rawHash : rawHash?.sha256;
    if (typeof hash === 'string') output[normalizeBuildPath(buildPath)] = hash.toLowerCase();
  }
  return output;
}

function extractBuildHashes(result, requiredPaths, explicitPath = null) {
  const candidates = explicitPath ? [explicitPath] : DEFAULT_BUILD_HASH_PATHS;
  let best = null;
  for (const pathSpec of candidates) {
    const hashes = normalizeBuildHashMap(getAtPath(result, pathSpec));
    const matched = requiredPaths.filter((buildPath) => hashes[buildPath]).length;
    if (!best || matched > best.matched) best = { pathSpec, hashes, matched };
    if (matched === requiredPaths.length) return { pathSpec, hashes };
  }
  return best ? { pathSpec: best.pathSpec, hashes: best.hashes } : null;
}

function sourceResultVerdict(result) {
  if (result?.ok === false || result?.gates?.pass === false
      || result?.overlayModel?.verdict === 'FAIL') return { pass: false, field: 'explicit failure' };
  if (result?.ok === true) return { pass: true, field: 'ok' };
  if (result?.gates?.pass === true) return { pass: true, field: 'gates.pass' };
  if (result?.overlayModel?.verdict === 'PASS') {
    return { pass: true, field: 'overlayModel.verdict' };
  }
  if (result?.result === 'PASS' || result?.status === 'PASS') {
    return { pass: true, field: result.result === 'PASS' ? 'result' : 'status' };
  }
  return { pass: false, field: 'no recognized passing field' };
}

function collectStrings(value) {
  const strings = [];
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === 'string') strings.push(current);
    else if (Array.isArray(current)) stack.push(...current);
    else if (current && typeof current === 'object') stack.push(...Object.values(current));
  }
  return strings;
}

function resultReferencesSource(result, resultFile, sourceFile, workspaceRoot) {
  const expected = new Set([pathKey(sourceFile)]);
  try { expected.add(pathKey(fs.realpathSync(sourceFile))); } catch { /* existence is checked elsewhere */ }
  const resultDirectory = path.dirname(resultFile);
  for (const value of collectStrings(result)) {
    if (!value || value.length > 4096) continue;
    const candidates = path.isAbsolute(value)
      ? [value]
      : [path.resolve(resultDirectory, value), path.resolve(workspaceRoot, value)];
    if (candidates.some((candidate) => expected.has(pathKey(candidate)))) return true;
  }
  return false;
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

function readPngMetadata(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('missing the PNG signature or minimum chunk envelope');
  }
  let offset = 8;
  let width = null;
  let height = null;
  let sawIdat = false;
  let sawIend = false;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('has a truncated PNG chunk header');
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (crcOffset + 4 > bytes.length) throw new Error('has a truncated PNG chunk payload');
    const type = bytes.toString('ascii', typeStart, dataStart);
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = pngCrc32(bytes.subarray(typeStart, dataEnd));
    if (expectedCrc !== actualCrc) throw new Error(`${type} has an invalid CRC`);
    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) throw new Error('does not begin with a 13-byte IHDR');
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      if (width < 1 || height < 1) throw new Error('has invalid zero dimensions');
    }
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') {
      if (length !== 0) throw new Error('has a non-empty IEND chunk');
      sawIend = true;
      offset = crcOffset + 4;
      if (offset !== bytes.length) throw new Error('has trailing bytes after IEND');
      break;
    }
    offset = crcOffset + 4;
    chunkIndex += 1;
  }
  if (!sawIdat || !sawIend) throw new Error('is missing IDAT or IEND');
  return { width, height };
}

function resolveWorkspaceFile(workspaceRoot, input, errors, id, label) {
  if (typeof input !== 'string' || !input.trim()) {
    addError(errors, id, `${label} must be a non-empty path.`);
    return null;
  }
  const absolute = path.resolve(workspaceRoot, input);
  if (!insideRoot(workspaceRoot, absolute)) {
    addError(errors, `${id}.workspace`, `${label} must stay inside the workspace.`, { input });
    return null;
  }
  if (!fs.existsSync(absolute)) {
    addError(errors, `${id}.exists`, `${label} does not exist.`, { path: absolute });
    return null;
  }
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) {
    addError(errors, `${id}.file`, `${label} is not a regular file.`, { path: absolute });
    return null;
  }
  const real = fs.realpathSync(absolute);
  if (!insideRoot(workspaceRoot, real)) {
    addError(errors, `${id}.realpath`, `${label} resolves outside the workspace.`, { path: real });
    return null;
  }
  return { absolute, real, stat };
}

function repositoryRelative(workspaceRoot, absolute) {
  return posixPath(path.relative(workspaceRoot, absolute));
}

function validateRequiredBuilds(plan, workspaceRoot, errors) {
  const raw = plan?.requiredProductionBuildHashes;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    addError(errors, 'production.required', 'requiredProductionBuildHashes must be an object.');
    return { expected: {}, current: [] };
  }
  const expected = normalizeBuildHashMap(raw);
  for (const requiredPath of MINIMUM_PRODUCTION_BUILD_PATHS) {
    if (!expected[requiredPath]) {
      addError(errors, `production.required.${slug(requiredPath)}`,
        `Missing mandatory production hash for ${requiredPath}.`);
    }
  }
  const current = [];
  for (const [buildPath, expectedHash] of Object.entries(expected)) {
    const id = slug(buildPath);
    if (path.isAbsolute(buildPath) || normalizeBuildPath(buildPath).startsWith('../')) {
      addError(errors, `production.path.${id}`, 'Production build paths must be workspace-relative.',
        { path: buildPath });
      continue;
    }
    if (!SHA256_PATTERN.test(expectedHash)) {
      addError(errors, `production.hash.${id}`,
        `Production hash for ${buildPath} must be a full lowercase SHA256.`, { expectedHash });
      continue;
    }
    const file = resolveWorkspaceFile(workspaceRoot, buildPath, errors,
      `production.file.${id}`, `Production build ${buildPath}`);
    if (!file) continue;
    const bytes = fs.readFileSync(file.absolute);
    const actualHash = sha256(bytes);
    if (actualHash !== expectedHash) {
      addError(errors, `production.currentHash.${id}`,
        `Current production build ${buildPath} does not match the required final hash.`,
        { expected: expectedHash, actual: actualHash });
    }
    current.push({ path: buildPath, bytes: bytes.length, sha256: actualHash });
  }
  return { expected, current };
}

function duplicateGroups(values, key) {
  const groups = new Map();
  for (const value of values) {
    const groupKey = value?.[key];
    if (!groupKey) continue;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(value.number);
  }
  return [...groups.entries()]
    .filter(([, numbers]) => numbers.length > 1)
    .map(([value, captures]) => ({ value, captures }));
}

function normalizedOutputRoot(workspaceRoot, options, errors) {
  const canonical = path.resolve(workspaceRoot, EVIDENCE_OUTPUT_RELATIVE);
  const requested = path.resolve(options.outputRoot || canonical);
  if (!insideRoot(workspaceRoot, requested)) {
    addError(errors, 'output.workspace', 'Evidence output must stay inside the workspace.',
      { outputRoot: requested });
  }
  if (requested !== canonical && options.allowCustomOutputRoot !== true) {
    addError(errors, 'output.canonical', `Evidence output must be ${EVIDENCE_OUTPUT_RELATIVE}.`,
      { outputRoot: requested });
  }
  return requested;
}

export function createEvidencePlanTemplate() {
  return {
    schemaVersion: 1,
    requiredProductionBuildHashes: Object.fromEntries(
      MINIMUM_PRODUCTION_BUILD_PATHS.map((buildPath) => [buildPath, 'REPLACE_WITH_FULL_SHA256']),
    ),
    captures: CAPTURE_REQUIREMENTS.map(({ number, name }) => ({
      number,
      name,
      source: '',
      sourceResult: '',
    })),
  };
}

export function validateCashierMasterEvidencePlan(plan, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const errors = [];
  const outputRoot = normalizedOutputRoot(workspaceRoot, options, errors);
  if (plan?.schemaVersion !== 1) {
    addError(errors, 'plan.schemaVersion', 'Evidence plan schemaVersion must be 1.',
      { actual: plan?.schemaVersion });
  }
  const captures = Array.isArray(plan?.captures) ? plan.captures : [];
  if (captures.length !== CAPTURE_REQUIREMENTS.length) {
    addError(errors, 'captures.count', 'Evidence plan must contain exactly 40 captures.',
      { actual: captures.length, expected: CAPTURE_REQUIREMENTS.length });
  }
  const presentNumbers = new Set(captures.map((entry) => entry?.number));
  for (const number of REQUIRED_FINAL_CAPTURE_NUMBERS) {
    if (!presentNumbers.has(number)) {
      addError(errors, `capture.${number}.required`, `Required final capture #${number} is missing.`);
    }
  }

  const builds = validateRequiredBuilds(plan, workspaceRoot, errors);
  const requiredBuildPaths = Object.keys(builds.expected);
  const records = [];
  const copyPlan = [];

  for (const requirement of CAPTURE_REQUIREMENTS) {
    const index = requirement.number - 1;
    const entry = captures[index];
    if (!entry) {
      addError(errors, `capture.${requirement.number}.mapping`,
        `Capture #${requirement.number} (${requirement.name}) is absent from its ordered position.`);
      continue;
    }
    if (entry.number !== requirement.number) {
      addError(errors, `capture.${requirement.number}.number`,
        `Ordered capture ${index + 1} must declare number ${requirement.number}.`,
        { actual: entry.number });
    }
    if (entry.name !== requirement.name) {
      addError(errors, `capture.${requirement.number}.name`,
        `Capture #${requirement.number} name must exactly match the master brief.`,
        { expected: requirement.name, actual: entry.name });
    }

    const source = resolveWorkspaceFile(workspaceRoot, entry.source, errors,
      `capture.${requirement.number}.source`, `Capture #${requirement.number} source`);
    let image = null;
    if (source) {
      if (path.extname(source.absolute).toLowerCase() !== '.png') {
        addError(errors, `capture.${requirement.number}.source.extension`,
          `Capture #${requirement.number} must use a .png source.`, { path: source.absolute });
      }
      const bytes = fs.readFileSync(source.absolute);
      try {
        const dimensions = readPngMetadata(bytes);
        image = { bytes, sha256: sha256(bytes), ...dimensions };
      } catch (error) {
        addError(errors, `capture.${requirement.number}.source.png`,
          `Capture #${requirement.number} is not a structurally valid PNG: ${error.message}`,
          { path: source.absolute });
      }
    }

    const sourceResult = resolveWorkspaceFile(workspaceRoot, entry.sourceResult, errors,
      `capture.${requirement.number}.sourceResult`, `Capture #${requirement.number} source result`);
    let resultBytes = null;
    let result = null;
    let verdict = null;
    let resultBuilds = null;
    if (sourceResult) {
      resultBytes = fs.readFileSync(sourceResult.absolute);
      try {
        result = JSON.parse(resultBytes.toString('utf8'));
      } catch (error) {
        addError(errors, `capture.${requirement.number}.sourceResult.json`,
          `Capture #${requirement.number} source result is not valid JSON: ${error.message}`);
      }
    }
    if (result) {
      verdict = sourceResultVerdict(result);
      if (!verdict.pass) {
        addError(errors, `capture.${requirement.number}.sourceResult.pass`,
          `Capture #${requirement.number} source result is not an explicit PASS.`,
          { verdictField: verdict.field });
      }
      if (source && !resultReferencesSource(result, sourceResult.absolute,
        source.absolute, workspaceRoot)) {
        addError(errors, `capture.${requirement.number}.sourceResult.reference`,
          `Capture #${requirement.number} source result does not reference its PNG source.`,
          { source: source.absolute, sourceResult: sourceResult.absolute });
      }
      resultBuilds = extractBuildHashes(result, requiredBuildPaths,
        entry.productionBuildHashesPath || null);
      if (!resultBuilds || !Object.keys(resultBuilds.hashes).length) {
        addError(errors, `capture.${requirement.number}.sourceResult.productionHashes`,
          `Capture #${requirement.number} source result has no recognized production build hashes.`);
      } else {
        for (const buildPath of requiredBuildPaths) {
          const actualHash = resultBuilds.hashes[buildPath];
          const expectedHash = builds.expected[buildPath];
          if (actualHash !== expectedHash) {
            addError(errors, `capture.${requirement.number}.productionHash.${slug(buildPath)}`,
              `Capture #${requirement.number} was not produced from required final ${buildPath}.`,
              { expected: expectedHash, actual: actualHash || null,
                sourceResultField: resultBuilds.pathSpec });
          }
        }
      }
    }

    if (source && image && sourceResult && result && verdict?.pass && resultBuilds) {
      const productionBuildHashes = Object.fromEntries(requiredBuildPaths.map((buildPath) => (
        [buildPath, resultBuilds.hashes[buildPath] || null]
      )));
      records.push({
        number: requirement.number,
        name: requirement.name,
        outputFile: requirement.outputFile,
        sourcePath: repositoryRelative(workspaceRoot, source.absolute),
        sourceAbsolutePath: source.absolute,
        sourceRealPath: source.real,
        sourceResultPath: repositoryRelative(workspaceRoot, sourceResult.absolute),
        sourceResultAbsolutePath: sourceResult.absolute,
        sourceResultSha256: sha256(resultBytes),
        sourceResultVerdictField: verdict.field,
        sourceResultProductionBuildHashesPath: resultBuilds.pathSpec,
        productionBuildHashes,
        width: image.width,
        height: image.height,
        bytes: image.bytes.length,
        sha256: image.sha256,
      });
      copyPlan.push({ source: source.absolute, outputFile: requirement.outputFile });
    }
  }

  const duplicatePaths = duplicateGroups(records.map((record) => ({
    ...record,
    sourcePathKey: pathKey(record.sourceRealPath),
  })), 'sourcePathKey');
  if (duplicatePaths.length) {
    addError(errors, 'captures.sourcePaths.unique',
      'All 40 captures must use unique existing PNG paths; reused paths were found.', duplicatePaths);
  }
  const duplicateHashes = duplicateGroups(records, 'sha256');
  if (duplicateHashes.length) {
    addError(errors, 'captures.imageHashes.unique',
      'All 40 captures must have distinct SHA256 image hashes; reused frames were found.',
      duplicateHashes);
  }

  const publicRecords = records.map(({ sourceRealPath, ...record }) => record);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    kind: 'cashier-master-final-exact-40-evidence',
    ok: errors.length === 0,
    generatedAt,
    outputRoot: repositoryRelative(workspaceRoot, outputRoot),
    planSha256: sha256(Buffer.from(JSON.stringify(plan || null))),
    policy: {
      exactOrderedCaptureCount: 40,
      uniqueExistingPngPaths: true,
      distinctImageSha256: true,
      sourceEvidenceMutation: 'copy only; source evidence is never deleted or moved',
      sourceResultMustPassAndReferenceImage: true,
      sourceResultMustMatchRequiredProductionBuildHashes: true,
      requiredFinalCaptures: [...REQUIRED_FINAL_CAPTURE_NUMBERS],
      minimumProductionBuildPaths: [...MINIMUM_PRODUCTION_BUILD_PATHS],
    },
    requiredProductionBuildHashes: builds.expected,
    verifiedCurrentProductionBuilds: builds.current,
    totals: {
      required: CAPTURE_REQUIREMENTS.length,
      validated: publicRecords.length,
      uniqueSourcePaths: new Set(records.map((record) => pathKey(record.sourceRealPath))).size,
      distinctImageHashes: new Set(records.map((record) => record.sha256)).size,
      totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
    },
    captures: publicRecords,
  };
  return { ok: errors.length === 0, errors, manifest, copyPlan, outputRoot, workspaceRoot };
}

function markdownCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderCashierMasterEvidenceMarkdown(manifest) {
  const lines = [
    '# Cashier master final evidence — exact 40',
    '',
    `- Result: **${manifest.ok ? 'PASS' : 'FAIL'}**`,
    `- Generated: ${markdownCell(manifest.generatedAt)}`,
    `- Output: \`${markdownCell(manifest.outputRoot)}\``,
    `- Captures: ${manifest.totals.validated} / ${manifest.totals.required}`,
    `- Unique source paths: ${manifest.totals.uniqueSourcePaths}`,
    `- Distinct image SHA256 hashes: ${manifest.totals.distinctImageHashes}`,
    '- Policy: sources were copied; no source evidence was deleted or moved.',
    '',
    '## Required final production build hashes',
    '',
    '| Production path | SHA256 | Bytes |',
    '|---|---|---:|',
  ];
  const currentByPath = Object.fromEntries(
    manifest.verifiedCurrentProductionBuilds.map((entry) => [entry.path, entry]),
  );
  for (const [buildPath, hash] of Object.entries(manifest.requiredProductionBuildHashes)) {
    lines.push(`| ${markdownCell(buildPath)} | \`${markdownCell(hash)}\` | ${currentByPath[buildPath]?.bytes ?? 'unavailable'} |`);
  }
  lines.push(
    '',
    '## Ordered capture manifest',
    '',
    '| # | Required capture | Output | Dimensions | Bytes | Image SHA256 | Source path | Source result | Source result SHA256 |',
    '|---:|---|---|---:|---:|---|---|---|---|',
  );
  for (const capture of manifest.captures) {
    lines.push(`| ${capture.number} | ${markdownCell(capture.name)} | ${markdownCell(capture.outputFile)} | ${capture.width}x${capture.height} | ${capture.bytes} | \`${capture.sha256}\` | ${markdownCell(capture.sourcePath)} | ${markdownCell(capture.sourceResultPath)} | \`${capture.sourceResultSha256}\` |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function assembleCashierMasterEvidence(plan, options = {}) {
  const validation = validateCashierMasterEvidencePlan(plan, options);
  if (!validation.ok) {
    throw new EvidenceValidationError(
      `Cashier evidence plan failed ${validation.errors.length} validation check(s).`, validation,
    );
  }
  if (fs.existsSync(validation.outputRoot)) {
    throw new EvidenceValidationError(
      `Refusing to overwrite existing evidence output: ${validation.outputRoot}`,
      { ...validation, ok: false, errors: [{
        id: 'output.exists',
        message: 'Archive or choose a new explicitly approved output before assembling.',
      }] },
    );
  }

  const parent = path.dirname(validation.outputRoot);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, '.current-staging-'));
  try {
    for (const entry of validation.copyPlan) {
      const destination = path.join(staging, entry.outputFile);
      fs.copyFileSync(entry.source, destination, fs.constants.COPYFILE_EXCL);
      const copiedHash = sha256(fs.readFileSync(destination));
      const record = validation.manifest.captures.find(
        (capture) => capture.outputFile === entry.outputFile,
      );
      if (copiedHash !== record.sha256) {
        throw new Error(`Copied image hash changed for ${entry.outputFile}.`);
      }
    }
    fs.writeFileSync(path.join(staging, MANIFEST_JSON),
      `${JSON.stringify(validation.manifest, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(staging, MANIFEST_MARKDOWN),
      renderCashierMasterEvidenceMarkdown(validation.manifest), 'utf8');
    fs.renameSync(staging, validation.outputRoot);
  } catch (error) {
    if (insideRoot(parent, staging) && fs.existsSync(staging)) {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    throw error;
  }
  return validation.manifest;
}

function parseCli(argv) {
  const args = [...argv];
  const assemble = args.includes('--assemble');
  const printTemplate = args.includes('--print-template');
  const positional = args.filter((entry) => !entry.startsWith('--'));
  return { assemble, printTemplate, planPath: positional[0] || null };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (cli.printTemplate) {
    process.stdout.write(`${JSON.stringify(createEvidencePlanTemplate(), null, 2)}\n`);
    return;
  }
  if (!cli.planPath) {
    throw new Error('Pass an evidence plan JSON path, or use --print-template. Add --assemble only after final source freeze.');
  }
  const planFile = path.resolve(cli.planPath);
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (cli.assemble) {
    const manifest = assembleCashierMasterEvidence(plan);
    process.stdout.write(`${JSON.stringify({ ok: true, outputRoot: manifest.outputRoot,
      manifest: MANIFEST_JSON, captures: manifest.totals.validated }, null, 2)}\n`);
    return;
  }
  const validation = validateCashierMasterEvidencePlan(plan);
  process.stdout.write(`${JSON.stringify({ ok: validation.ok, errors: validation.errors,
    totals: validation.manifest.totals }, null, 2)}\n`);
  if (!validation.ok) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    if (error instanceof EvidenceValidationError) {
      process.stderr.write(`${JSON.stringify({ ok: false, errors: error.validation.errors }, null, 2)}\n`);
    } else {
      process.stderr.write(`${error?.stack || error}\n`);
    }
    process.exitCode = 1;
  });
}
