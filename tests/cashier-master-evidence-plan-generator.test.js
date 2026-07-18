import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import {
  CAPTURE_REQUIREMENTS,
  MINIMUM_PRODUCTION_BUILD_PATHS,
  validateCashierMasterEvidencePlan,
} from '../tools/qa/assemble-cashier-master-evidence.mjs';
import {
  captureCashierBuildSnapshot,
} from '../tools/qa/cashier-build-snapshot.mjs';
import {
  FINAL_CAPTURE_SOURCES,
  FINAL_RESULT_INPUTS,
  FinalEvidencePlanError,
  generateFinalCashierEvidencePlan,
  validateFinalCashierEvidenceInputs,
  writeFinalCashierEvidencePlan,
} from '../tools/qa/generate-cashier-master-evidence-plan.mjs';

const NOT_BEFORE = '2000-01-01T00:00:00.000Z';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

function png(index, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const uniqueScanline = Buffer.from([
    0, index % 256, (index * 3) % 256, (index * 7) % 256, 255,
  ]);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(uniqueScanline)),
    pngChunk('IEND'),
  ]);
}

function posix(value) {
  return String(value).replaceAll('\\', '/');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function setAtPath(target, dottedPath, value) {
  const keys = dottedPath.split('.');
  let current = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (current[key] == null) current[key] = /^\d+$/.test(keys[index + 1]) ? [] : {};
    current = current[key];
  }
  current[keys.at(-1)] = value;
}

function snapshotEnvelope(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    algorithm: snapshot.algorithm,
    beforeCapturedAt: snapshot.capturedAt,
    afterCapturedAt: snapshot.capturedAt,
    currentVerifiedAt: snapshot.capturedAt,
    beforeAggregateHash: snapshot.aggregateHash,
    afterAggregateHash: snapshot.aggregateHash,
    currentAggregateHash: snapshot.aggregateHash,
    beforeFileCount: snapshot.fileCount,
    afterFileCount: snapshot.fileCount,
    currentFileCount: snapshot.fileCount,
    unchanged: true,
    currentUnchanged: true,
    currentMatchesAuthoritative: true,
    changedFiles: [],
  };
}

function viewportRecord(tag) {
  const [width, height] = tag.split('x').map(Number);
  return { width, height, deviceScaleFactor: 1 };
}

function resultName(definition) {
  if (definition.kind === 'performance') return 'performance-overlay-provenance.json';
  if (definition.kind === 'lifecycle') return 'capture-39-provenance.json';
  return 'latest-result.json';
}

function selectorFilename(mapping) {
  if (mapping.selector.kind === 'basename') return mapping.selector.value;
  if (mapping.selector.kind === 'suffix') return `31${mapping.selector.value}`;
  if (mapping.number === 38) return '38-performance-overlay.png';
  if (mapping.number === 39) return 'lifecycle-metrics.png';
  if (mapping.number === 40) return 'completed-card-second-reload-idempotent.png';
  throw new Error(`No fixture filename for capture #${mapping.number}.`);
}

function baseResult(definition, snapshot, evidence) {
  const common = {
    productionBuildHashes: { ...snapshot.productionBuildHashes },
    productionBuildSnapshot: snapshotEnvelope(snapshot),
  };
  if (definition.kind === 'performance') {
    return {
      ...common,
      gates: {
        authoritativeMasterPass: true,
        authoritativeProductionBuildUnchanged: true,
        currentProductionBuildMatches: true,
        overlayProductionBuildUnchanged: true,
      },
      overlayModel: { verdict: 'PASS', profile: 'master', viewport: definition.viewport },
      evidence,
    };
  }
  if (definition.kind === 'lifecycle') {
    return {
      ...common,
      ok: true,
      verdict: 'PASS',
      captureNumber: 39,
      protocol: { profile: 'master', viewport: definition.viewport },
      gates: {
        lifecyclePass: true,
        everyLifecycleGatePassed: true,
        everyCardinalityPassed: true,
        diagnosticsClean: true,
        captureOverlayPass: true,
        productionBuildUnchanged: true,
        currentProductionBuildMatches: true,
        artifactsValid: true,
        everyReferencedFileHashed: true,
      },
      evidence,
    };
  }
  return {
    ...common,
    ok: true,
    viewport: definition.kind === 'queue'
      ? definition.viewport : viewportRecord(definition.viewport),
    ...(definition.mode ? { mode: definition.mode } : {}),
    gates: { productionBuildUnchanged: true, everyEvidencePngReferenced: true },
    evidence,
  };
}

function makeFixture(t) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cashier-plan-generator-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

  const productionFiles = [
    ...MINIMUM_PRODUCTION_BUILD_PATHS,
    'src/styles.css',
  ];
  for (const [index, productionFile] of productionFiles.entries()) {
    const absolute = path.join(workspaceRoot, ...productionFile.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `fixture production ${index}\n`, 'utf8');
  }
  const snapshot = captureCashierBuildSnapshot({ repositoryRoot: workspaceRoot, files: productionFiles });

  const roleEvidence = Object.fromEntries(Object.keys(FINAL_RESULT_INPUTS).map((role) => [role, []]));
  const captureFiles = {};
  for (const mapping of FINAL_CAPTURE_SOURCES) {
    const relative = posix(path.join('qa', 'runs', mapping.source, selectorFilename(mapping)));
    const absolute = path.join(workspaceRoot, ...relative.split('/'));
    const [width, height] = mapping.dimensions || [720, 260];
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, png(mapping.number, width, height));
    roleEvidence[mapping.source].push(relative);
    captureFiles[mapping.number] = absolute;
  }

  const saveAuxiliary = [1, 2].map((ordinal) => {
    const relative = `qa/runs/saveReload/completed-card-proof-${ordinal}.png`;
    const absolute = path.join(workspaceRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, png(40 + ordinal, 1600, 900));
    roleEvidence.saveReload.unshift(relative);
    return relative;
  });

  const records = {};
  const inputs = {};
  for (const [index, [role, definition]] of Object.entries(FINAL_RESULT_INPUTS).entries()) {
    const directory = path.join(workspaceRoot, 'qa', 'runs', role);
    const resultPath = path.join(directory, resultName(definition));
    const result = baseResult(definition, snapshot, roleEvidence[role]);
    if (definition.kind === 'queue') {
      result.checkpoints = [
        {
          screenshot: posix(path.relative(workspaceRoot, captureFiles[30])),
          state: {
            active: true, workspace: 'monitor', held: 0,
            tx: null, owner: null, txHolders: [], queue: [], first: null, second: null,
          },
        },
        {
          screenshot: posix(path.relative(workspaceRoot, captureFiles[31])),
          state: {
            active: true, tx: { number: 1 }, owner: { role: 'first' },
            txHolders: [{ role: 'first' }], queueRoles: ['first', 'second'],
            queue: [{ customerId: 'first' }, { customerId: 'second' }],
          },
        },
      ];
    }
    if (definition.kind === 'performance') {
      setAtPath(result, 'output.path', roleEvidence[role][0]);
    }
    if (definition.kind === 'lifecycle') {
      setAtPath(result, 'artifacts.lifecycleMetrics.path', roleEvidence[role][0]);
    }
    if (definition.kind === 'save-reload') {
      result.scenarios = {
        completedCard: {
          ok: true,
          evidence: [...saveAuxiliary, roleEvidence.saveReload.at(-1)],
        },
      };
    }
    writeJson(resultPath, result);
    records[role] = { definition, directory, resultPath, result };
    // Exercise both accepted forms: an exact result path and a directory that
    // contains exactly one recognized current-driver result filename.
    inputs[role] = index % 2 === 0 ? directory : resultPath;
  }

  return {
    workspaceRoot,
    productionFiles,
    snapshot,
    inputs,
    records,
    captureFiles,
    options: { workspaceRoot, productionFiles, notBefore: NOT_BEFORE },
  };
}

function errorIds(validation) {
  return new Set(validation.errors.map((entry) => entry.id));
}

test('current driver outputs generate one assembler-consumable exact-40 plan', (t) => {
  const fixture = makeFixture(t);
  const validation = validateFinalCashierEvidenceInputs(fixture.inputs, fixture.options);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
  assert.equal(validation.plan.captures.length, 40);
  assert.deepEqual(validation.plan.captures.map((entry) => entry.name),
    CAPTURE_REQUIREMENTS.map((entry) => entry.name));
  assert.equal(new Set(validation.plan.captures.map((entry) => entry.source)).size, 40);
  assert.equal(new Set(validation.plan.captures.map((entry) => entry.sourceResult)).size,
    Object.keys(FINAL_RESULT_INPUTS).length);
  assert.deepEqual(validation.plan.requiredProductionBuildHashes,
    fixture.snapshot.productionBuildHashes);
  assert.equal(path.basename(validation.plan.captures[19].source),
    '08b-cash-clicked-drawer-opening.png');
  assert.equal(path.basename(validation.plan.captures[29].source),
    '07b-register-reset-empty.png');
  assert.equal(path.basename(validation.plan.captures[35].source),
    '10-received-cash-sorted.png');

  const assembler = validateCashierMasterEvidencePlan(validation.plan, {
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(assembler.ok, true, JSON.stringify(assembler.errors, null, 2));
  assert.equal(assembler.manifest.totals.validated, 40);
  assert.equal(assembler.manifest.totals.distinctImageHashes, 40);
});

test('unavailable authored drawer-opening, reset, and recovery names are reported without fallback', (t) => {
  for (const captureNumber of [15, 20, 30]) {
    const fixture = makeFixture(t);
    fs.rmSync(fixture.captureFiles[captureNumber]);
    const validation = validateFinalCashierEvidenceInputs(fixture.inputs, fixture.options);
    const evidenceError = validation.errors.find(
      (entry) => entry.id === `capture.${captureNumber}.evidence`,
    );
    assert(evidenceError, JSON.stringify(validation.errors, null, 2));
    assert.equal(evidenceError.details.selector.value,
      FINAL_CAPTURE_SOURCES[captureNumber - 1].selector.value);
    assert.equal(validation.plan.captures.some((entry) => entry.number === captureNumber), false);
  }
});

test('failed, stale, and incomplete production-map source results fail closed', (t) => {
  const failed = makeFixture(t);
  failed.records.card1600.result.ok = false;
  writeJson(failed.records.card1600.resultPath, failed.records.card1600.result);
  let validation = validateFinalCashierEvidenceInputs(failed.inputs, failed.options);
  assert.equal(errorIds(validation).has('source.card1600.pass'), true);

  const missingGate = makeFixture(t);
  delete missingGate.records.performance38.result.gates.currentProductionBuildMatches;
  writeJson(missingGate.records.performance38.resultPath,
    missingGate.records.performance38.result);
  validation = validateFinalCashierEvidenceInputs(missingGate.inputs, missingGate.options);
  assert.equal(errorIds(validation).has('source.performance38.pass'), true);

  const stale = makeFixture(t);
  stale.records.queue.result.productionBuildSnapshot.beforeCapturedAt = '1999-01-01T00:00:00.000Z';
  writeJson(stale.records.queue.resultPath, stale.records.queue.result);
  validation = validateFinalCashierEvidenceInputs(stale.inputs, stale.options);
  assert.equal(errorIds(validation).has('source.queue.stale'), true);

  const incomplete = makeFixture(t);
  const missingProductionFile = incomplete.productionFiles[0];
  delete incomplete.records.lifecycle39.result.productionBuildHashes[missingProductionFile];
  writeJson(incomplete.records.lifecycle39.resultPath, incomplete.records.lifecycle39.result);
  validation = validateFinalCashierEvidenceInputs(incomplete.inputs, incomplete.options);
  assert.equal(errorIds(validation).has('source.lifecycle39.productionMap'), true);

  const mismatched = makeFixture(t);
  mismatched.records.performance38.result.productionBuildHashes[
    mismatched.productionFiles[0]
  ] = '0'.repeat(64);
  writeJson(mismatched.records.performance38.resultPath, mismatched.records.performance38.result);
  validation = validateFinalCashierEvidenceInputs(mismatched.inputs, mismatched.options);
  assert.equal(errorIds(validation).has('source.performance38.productionHash'), true);
});

test('a named reset frame without the visibly empty active-monitor state is rejected', (t) => {
  const fixture = makeFixture(t);
  const reset = fixture.records.queue.result.checkpoints.find((checkpoint) => (
    path.basename(checkpoint.screenshot) === '07b-register-reset-empty.png'
  ));
  reset.state.active = false;
  reset.state.workspace = 'cash';
  reset.state.queue.push({ customerId: 'ghost' });
  writeJson(fixture.records.queue.resultPath, fixture.records.queue.result);
  const validation = validateFinalCashierEvidenceInputs(fixture.inputs, fixture.options);
  assert.equal(errorIds(validation).has('capture.30.resetContract'), true,
    JSON.stringify(validation.errors, null, 2));
});

test('distinct paths with duplicate PNG bytes are rejected by the assembler contract', (t) => {
  const fixture = makeFixture(t);
  fs.copyFileSync(fixture.captureFiles[1], fixture.captureFiles[2]);
  const validation = validateFinalCashierEvidenceInputs(fixture.inputs, fixture.options);
  assert.equal(validation.ok, false);
  assert.equal(errorIds(validation).has('assembler.captures.imageHashes.unique'), true,
    JSON.stringify(validation.errors, null, 2));
});

test('the writer emits a fresh plan atomically and refuses to overwrite it', (t) => {
  const fixture = makeFixture(t);
  const outputPath = 'qa/final-plan.json';
  const written = writeFinalCashierEvidencePlan(fixture.inputs, {
    ...fixture.options,
    outputPath,
  });
  assert.equal(written.plan.captures.length, 40);
  const diskPlan = JSON.parse(fs.readFileSync(path.join(fixture.workspaceRoot, outputPath), 'utf8'));
  assert.deepEqual(diskPlan, generateFinalCashierEvidencePlan(fixture.inputs, fixture.options));
  assert.equal(validateCashierMasterEvidencePlan(diskPlan, {
    workspaceRoot: fixture.workspaceRoot,
  }).ok, true);
  assert.throws(() => writeFinalCashierEvidencePlan(fixture.inputs, {
    ...fixture.options,
    outputPath,
  }), (error) => error instanceof FinalEvidencePlanError
      && error.errors.some((entry) => entry.id === 'output.exists'));
});
