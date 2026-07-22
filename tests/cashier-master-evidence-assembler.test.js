import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  assembleCashierMasterEvidence,
  CAPTURE_REQUIREMENTS,
  EVIDENCE_OUTPUT_RELATIVE,
  EvidenceValidationError,
  MANIFEST_JSON,
  MANIFEST_MARKDOWN,
  MINIMUM_PRODUCTION_BUILD_PATHS,
  validateCashierMasterEvidencePlan,
} from '../tools/qa/assemble-cashier-master-evidence.mjs';

const EXPECTED_CAPTURE_NAMES = [
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
  'Exact total entered',
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
];

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

let crcTable = null;

function crc32(bytes) {
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

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function png(index) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanline = Buffer.from([0, index, (index * 3) % 256, (index * 7) % 256, 255]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(scanline)),
    pngChunk('IEND'),
  ]);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeFixture(t) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cashier-exact-40-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

  const requiredProductionBuildHashes = {};
  for (const [index, buildPath] of MINIMUM_PRODUCTION_BUILD_PATHS.entries()) {
    const absolute = path.join(workspaceRoot, ...buildPath.split('/'));
    const bytes = Buffer.from(`production build ${index}\n`, 'utf8');
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
    requiredProductionBuildHashes[buildPath] = hash(bytes);
  }

  const sourcePaths = CAPTURE_REQUIREMENTS.map((requirement, index) => {
    const relative = `qa/source-evidence/source-${String(index + 1).padStart(2, '0')}.png`;
    const absolute = path.join(workspaceRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, png(index + 1));
    return relative;
  });
  const sourceResult = 'qa/source-evidence/latest-result.json';
  const result = {
    ok: true,
    build: {
      measuredFiles: Object.entries(requiredProductionBuildHashes).map(([buildPath, sha256]) => ({
        path: buildPath,
        sha256,
      })),
    },
    evidence: sourcePaths,
  };
  writeJson(path.join(workspaceRoot, ...sourceResult.split('/')), result);
  const plan = {
    schemaVersion: 1,
    requiredProductionBuildHashes,
    captures: CAPTURE_REQUIREMENTS.map(({ number, name }, index) => ({
      number,
      name,
      source: sourcePaths[index],
      sourceResult,
    })),
  };
  return { workspaceRoot, plan, sourcePaths, sourceResult, result };
}

function errorIds(validation) {
  return new Set(validation.errors.map((entry) => entry.id));
}

test('the ordered mapping exactly matches all 40 master-brief capture names', () => {
  assert.equal(CAPTURE_REQUIREMENTS.length, 40);
  assert.deepEqual(CAPTURE_REQUIREMENTS.map((entry) => entry.number),
    Array.from({ length: 40 }, (_, index) => index + 1));
  assert.deepEqual(CAPTURE_REQUIREMENTS.map((entry) => entry.name), EXPECTED_CAPTURE_NAMES);
  assert.deepEqual(CAPTURE_REQUIREMENTS.slice(37).map((entry) => entry.name), [
    'Performance overlay', 'Long-session resource counts', 'Save/reload proof',
  ]);
});

test('a valid exact-40 plan copies sources and writes JSON plus Markdown manifests', (t) => {
  const fixture = makeFixture(t);
  const options = {
    workspaceRoot: fixture.workspaceRoot,
    generatedAt: '2026-07-18T12:00:00.000Z',
  };
  const validation = validateCashierMasterEvidencePlan(fixture.plan, options);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.deepEqual(validation.manifest.totals, {
    required: 40,
    validated: 40,
    uniqueSourcePaths: 40,
    distinctImageHashes: 40,
    totalBytes: validation.manifest.captures.reduce((sum, capture) => sum + capture.bytes, 0),
  });
  assert.equal(validation.manifest.captures[38].name, 'Long-session resource counts');
  assert.equal(validation.manifest.captures[38].productionBuildHashes[
    MINIMUM_PRODUCTION_BUILD_PATHS[0]
  ], fixture.plan.requiredProductionBuildHashes[MINIMUM_PRODUCTION_BUILD_PATHS[0]]);

  const manifest = assembleCashierMasterEvidence(fixture.plan, options);
  const outputRoot = path.join(fixture.workspaceRoot, ...EVIDENCE_OUTPUT_RELATIVE.split('/'));
  assert.equal(manifest.ok, true);
  assert.equal(fs.readdirSync(outputRoot).length, 42);
  assert.equal(fs.existsSync(path.join(outputRoot, MANIFEST_JSON)), true);
  assert.equal(fs.existsSync(path.join(outputRoot, MANIFEST_MARKDOWN)), true);
  for (const source of fixture.sourcePaths) {
    assert.equal(fs.existsSync(path.join(fixture.workspaceRoot, ...source.split('/'))), true,
      `source evidence must remain untouched: ${source}`);
  }
  const diskManifest = JSON.parse(fs.readFileSync(path.join(outputRoot, MANIFEST_JSON), 'utf8'));
  assert.equal(diskManifest.captures.length, 40);
  assert.equal(new Set(diskManifest.captures.map((capture) => capture.sha256)).size, 40);
  const markdown = fs.readFileSync(path.join(outputRoot, MANIFEST_MARKDOWN), 'utf8');
  assert.match(markdown, /\| 38 \| Performance overlay \|/);
  assert.match(markdown, /\| 39 \| Long-session resource counts \|/);
  assert.match(markdown, /\| 40 \| Save\/reload proof \|/);
  assert.throws(() => assembleCashierMasterEvidence(fixture.plan, options),
    (error) => error instanceof EvidenceValidationError
      && error.validation.errors.some((entry) => entry.id === 'output.exists'));
});

test('count, order, exact names, and required captures 38 through 40 fail closed', (t) => {
  const missing = makeFixture(t);
  missing.plan.captures = missing.plan.captures.slice(0, 37);
  const missingValidation = validateCashierMasterEvidencePlan(missing.plan, {
    workspaceRoot: missing.workspaceRoot,
  });
  const missingIds = errorIds(missingValidation);
  assert.equal(missingIds.has('captures.count'), true);
  for (const number of [38, 39, 40]) {
    assert.equal(missingIds.has(`capture.${number}.required`), true, `missing #${number}`);
  }

  const unordered = makeFixture(t);
  [unordered.plan.captures[0], unordered.plan.captures[1]] = [
    unordered.plan.captures[1], unordered.plan.captures[0],
  ];
  unordered.plan.captures[2].name = 'Almost the right checkout name';
  const orderValidation = validateCashierMasterEvidencePlan(unordered.plan, {
    workspaceRoot: unordered.workspaceRoot,
  });
  const orderIds = errorIds(orderValidation);
  assert.equal(orderIds.has('capture.1.number'), true);
  assert.equal(orderIds.has('capture.2.number'), true);
  assert.equal(orderIds.has('capture.3.name'), true);
});

test('reused source paths and reused image bytes are rejected independently', (t) => {
  const reusedPath = makeFixture(t);
  reusedPath.plan.captures[1].source = reusedPath.plan.captures[0].source;
  let validation = validateCashierMasterEvidencePlan(reusedPath.plan, {
    workspaceRoot: reusedPath.workspaceRoot,
  });
  let ids = errorIds(validation);
  assert.equal(ids.has('captures.sourcePaths.unique'), true);
  assert.equal(ids.has('captures.imageHashes.unique'), true);

  const reusedFrame = makeFixture(t);
  const first = path.join(reusedFrame.workspaceRoot, ...reusedFrame.sourcePaths[0].split('/'));
  const second = path.join(reusedFrame.workspaceRoot, ...reusedFrame.sourcePaths[1].split('/'));
  fs.copyFileSync(first, second);
  validation = validateCashierMasterEvidencePlan(reusedFrame.plan, {
    workspaceRoot: reusedFrame.workspaceRoot,
  });
  ids = errorIds(validation);
  assert.equal(ids.has('captures.sourcePaths.unique'), false);
  assert.equal(ids.has('captures.imageHashes.unique'), true);
});

test('current-build drift and stale source-result production hashes are rejected', (t) => {
  const currentDrift = makeFixture(t);
  const buildPath = MINIMUM_PRODUCTION_BUILD_PATHS[0];
  currentDrift.plan.requiredProductionBuildHashes[buildPath] = '0'.repeat(64);
  let validation = validateCashierMasterEvidencePlan(currentDrift.plan, {
    workspaceRoot: currentDrift.workspaceRoot,
  });
  let ids = errorIds(validation);
  assert.equal(ids.has(`production.currentHash.${buildPath.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`),
    true);
  assert.equal([...ids].some((id) => id.startsWith('capture.1.productionHash.')), true);

  const staleResult = makeFixture(t);
  staleResult.result.build.measuredFiles[0].sha256 = 'f'.repeat(64);
  writeJson(path.join(staleResult.workspaceRoot, ...staleResult.sourceResult.split('/')),
    staleResult.result);
  validation = validateCashierMasterEvidencePlan(staleResult.plan, {
    workspaceRoot: staleResult.workspaceRoot,
  });
  ids = errorIds(validation);
  assert.equal([...ids].some((id) => id.startsWith('capture.1.productionHash.')), true);
  assert.equal(validation.ok, false);
});

test('non-PNG content cannot pass even when the file is named .png', (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.workspaceRoot, ...fixture.sourcePaths[4].split('/'));
  fs.writeFileSync(source, Buffer.from('not a png', 'utf8'));
  const validation = validateCashierMasterEvidencePlan(fixture.plan, {
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(errorIds(validation).has('capture.5.source.png'), true);
  assert.equal(validation.ok, false);
});
