import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import {
  CAPTURE_39_PROVENANCE_FILE,
  Capture39ProvenanceError,
  generateCapture39LifecycleProvenance,
  writeCashierBuildSnapshotFile,
} from '../tools/qa/capture-39-lifecycle-provenance.mjs';
import { captureCashierBuildSnapshot } from '../tools/qa/cashier-build-snapshot.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

let pngCrcTable = null;
function pngCrc32(bytes) {
  if (!pngCrcTable) {
    pngCrcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      pngCrcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = pngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  typeBytes.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, payload])), payload.length + 8);
  return chunk;
}

function makePng(width = 1600, height = 900) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND'),
  ]);
}

function writeJson(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  fs.writeFileSync(file, bytes);
  return bytes;
}

function fixtureResult(root) {
  const evidence = {
    json: path.join(root, 'lifecycle-result.json'),
    markdown: path.join(root, 'lifecycle-summary.md'),
    resourceDetails: path.join(root, 'lifecycle-resource-details.json'),
    screenshot: path.join(root, 'lifecycle-metrics.png'),
  };
  const overlayProvenance = {
    kind: 'qa-only DOM overlay',
    injectedBy: 'tools/qa/simplified-register-lifecycle-stress.mjs',
    overlayElementId: 'register-lifecycle-metrics',
    presentationOnly: true,
    gameplaySourceModified: false,
    rawJsonAuthoritative: true,
    authoritativeRawJson: 'lifecycle-result.json',
    authoritativeResourceDetails: 'lifecycle-resource-details.json',
  };
  const overlayModel = {
    schemaVersion: 1,
    captureNumber: 39,
    title: 'Long-session resource counts',
    ok: true,
    result: 'PASS',
    profile: 'master',
    viewport: '1600x900',
    gates: { passed: 2, total: 2, failed: 0, stabilityEnforced: true },
    provenance: overlayProvenance,
  };
  return {
    ok: true,
    blocker: null,
    protocol: {
      profile: 'master',
      viewport: '1600x900',
      deviceScaleFactor: 1,
      requestedCycles: 200,
      completedCycles: 200,
    },
    cycles: Array.from({ length: 200 }, (_, index) => ({ cycle: index + 1 })),
    cardinality: {
      frontDeskEnterExits: { ok: true },
      cardTransactions: { ok: true },
      cashTransactions: { ok: true },
      preAuthorizationXCancellations: { ok: true },
      declinesWithRecovery: { ok: true },
      drawerOpenCloses: { ok: true },
      customerSpawnsRemovals: { ok: true },
    },
    gates: {
      ok: true,
      stabilityEnforced: true,
      checks: [{ id: 'resource-stability', ok: true }, { id: 'completed-cycle-count', ok: true }],
    },
    diagnostics: { consoleErrors: [], pageErrors: [], nonAbortedFailedRequests: [] },
    timings: {
      run: {
        startedAt: '2026-01-02T00:00:00.000Z',
        finishedAt: '2026-01-02T01:00:00.000Z',
        elapsedMs: 3600000,
      },
    },
    evidence: {
      ...evidence,
      longSessionResourceCounts: {
        captureNumber: 39,
        requirement: 'long-session resource counts',
        status: 'captured',
        screenshot: evidence.screenshot,
        authoritativeRawJson: evidence.json,
        authoritativeResourceDetails: evidence.resourceDetails,
        overlayModel,
        provenance: overlayProvenance,
      },
    },
  };
}

function makeFixture() {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-39-provenance-'));
  const lifecycleRoot = path.join(repositoryRoot, 'qa', 'lifecycle', 'master-final');
  fs.mkdirSync(path.join(repositoryRoot, 'src'), { recursive: true });
  fs.mkdirSync(lifecycleRoot, { recursive: true });
  const productionFiles = ['src/game.js', 'src/register.js'];
  fs.writeFileSync(path.join(repositoryRoot, productionFiles[0]), 'export const game = true;\n');
  fs.writeFileSync(path.join(repositoryRoot, productionFiles[1]), 'export const register = true;\n');

  const before = captureCashierBuildSnapshot({ repositoryRoot, files: productionFiles });
  before.capturedAt = '2026-01-01T23:59:00.000Z';
  const after = captureCashierBuildSnapshot({ repositoryRoot, files: productionFiles });
  after.capturedAt = '2026-01-02T01:01:00.000Z';
  writeJson(path.join(lifecycleRoot, 'build-before.json'), before);
  writeJson(path.join(lifecycleRoot, 'build-after.json'), after);

  fs.writeFileSync(path.join(lifecycleRoot, 'lifecycle-metrics.png'), makePng());
  writeJson(path.join(lifecycleRoot, 'lifecycle-resource-details.json'), {
    phaseMarks: [],
    resources: { geometry: {}, material: {}, texture: {} },
    animationMixers: { count: 0, updateCalls: 0 },
  });
  fs.writeFileSync(path.join(lifecycleRoot, 'lifecycle-summary.md'), [
    '# Simplified register lifecycle stress',
    '- Result: **PASS**',
    '- Profile: `master`',
    '- Viewport: `1600x900`',
    '## Capture #39 provenance',
    '- Capture status: **captured**',
    '- Gameplay source modified by overlay: **no**',
    '',
  ].join('\n'));
  const result = fixtureResult(lifecycleRoot);
  const resultBytes = writeJson(path.join(lifecycleRoot, 'lifecycle-result.json'), result);
  fs.writeFileSync(path.join(lifecycleRoot, 'runner-result.json'), resultBytes);
  return {
    repositoryRoot,
    lifecycleRoot,
    productionFiles,
    result,
    before,
    after,
    output: path.join(lifecycleRoot, CAPTURE_39_PROVENANCE_FILE),
  };
}

function rewriteResult(fixture) {
  const bytes = writeJson(path.join(fixture.lifecycleRoot, 'lifecycle-result.json'), fixture.result);
  fs.writeFileSync(path.join(fixture.lifecycleRoot, 'runner-result.json'), bytes);
}

test('Capture #39 sidecar binds valid master artifacts to the complete unchanged build map', (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true }));

  const generated = generateCapture39LifecycleProvenance({
    lifecycleRoot: fixture.lifecycleRoot,
    repositoryRoot: fixture.repositoryRoot,
    productionFiles: fixture.productionFiles,
  });
  const outputBytes = fs.readFileSync(fixture.output);
  const sidecar = JSON.parse(outputBytes);

  assert.equal(generated.outputPath, fixture.output);
  assert.equal(generated.sha256, sha256(outputBytes));
  assert.equal(sidecar.ok, true);
  assert.equal(sidecar.captureNumber, 39);
  assert.equal(sidecar.verdict, 'PASS');
  assert.equal(sidecar.protocol.profile, 'master');
  assert.equal(sidecar.protocol.viewport, '1600x900');
  assert.equal(sidecar.gates.productionBuildUnchanged, true);
  assert.equal(sidecar.gates.currentProductionBuildMatches, true);
  assert.equal(sidecar.gates.everyReferencedFileHashed, true);
  assert.deepEqual(sidecar.productionBuildHashes, fixture.before.productionBuildHashes);
  assert.equal(
    Object.keys(sidecar.productionBuildHashes).length,
    fixture.productionFiles.length,
    'the complete map must survive instead of being reduced to selected checkout files',
  );
  assert.equal(sidecar.productionBuildSnapshot.beforeAggregateHash, fixture.before.aggregateHash);
  assert.equal(sidecar.productionBuildSnapshot.afterAggregateHash, fixture.after.aggregateHash);
  assert.equal(sidecar.productionBuildSnapshot.currentAggregateHash, fixture.after.aggregateHash);
  assert.equal(sidecar.artifactHashCount, 11);

  const expectedArtifacts = {
    lifecycleResult: path.join(fixture.lifecycleRoot, 'lifecycle-result.json'),
    lifecycleSummary: path.join(fixture.lifecycleRoot, 'lifecycle-summary.md'),
    lifecycleResourceDetails: path.join(fixture.lifecycleRoot, 'lifecycle-resource-details.json'),
    lifecycleMetrics: path.join(fixture.lifecycleRoot, 'lifecycle-metrics.png'),
    runnerResult: path.join(fixture.lifecycleRoot, 'runner-result.json'),
    buildBeforeSnapshot: path.join(fixture.lifecycleRoot, 'build-before.json'),
    buildAfterSnapshot: path.join(fixture.lifecycleRoot, 'build-after.json'),
    generatorTool: new URL('../tools/qa/capture-39-lifecycle-provenance.mjs', import.meta.url),
    lifecycleDriver: new URL('../tools/qa/simplified-register-lifecycle-stress.mjs', import.meta.url),
    lifecycleWrapper: new URL('../tools/qa/simplified-register-lifecycle-stress.js', import.meta.url),
    buildSnapshotTool: new URL('../tools/qa/cashier-build-snapshot.mjs', import.meta.url),
  };
  for (const [name, file] of Object.entries(expectedArtifacts)) {
    const absolute = file instanceof URL ? file : path.resolve(file);
    const bytes = fs.readFileSync(absolute);
    assert.equal(sidecar.artifacts[name].bytes, bytes.length, name);
    assert.equal(sidecar.artifacts[name].sha256, sha256(bytes), name);
  }
  assert.deepEqual(
    { width: sidecar.artifacts.lifecycleMetrics.width,
      height: sidecar.artifacts.lifecycleMetrics.height },
    { width: 1600, height: 900 },
  );
  const latestInputMtime = Math.max(...Object.values(expectedArtifacts)
    .filter((entry) => !(entry instanceof URL))
    .map((entry) => fs.statSync(entry).mtimeMs));
  assert.ok(fs.statSync(fixture.output).mtimeMs >= latestInputMtime,
    'the provenance sidecar must be written after its referenced run artifacts');
});

test('Capture #39 sidecar fails closed without writing output for invalid authority', async (t) => {
  const cases = [
    ['non-PASS result', (fixture) => { fixture.result.ok = false; rewriteResult(fixture); }],
    ['wrong viewport', (fixture) => {
      fixture.result.protocol.viewport = '1280x720';
      rewriteResult(fixture);
    }],
    ['wrong PNG dimensions', (fixture) => {
      fs.writeFileSync(path.join(fixture.lifecycleRoot, 'lifecycle-metrics.png'), makePng(1280, 720));
    }],
    ['missing resource details', (fixture) => {
      fs.rmSync(path.join(fixture.lifecycleRoot, 'lifecycle-resource-details.json'));
    }],
    ['non-identical runner result', (fixture) => {
      fs.appendFileSync(path.join(fixture.lifecycleRoot, 'runner-result.json'), ' ');
    }],
    ['failure screenshot present', (fixture) => {
      fs.writeFileSync(path.join(fixture.lifecycleRoot, 'lifecycle-failure.png'), makePng());
    }],
    ['snapshots do not bracket run', (fixture) => {
      fixture.after.capturedAt = '2026-01-02T00:30:00.000Z';
      writeJson(path.join(fixture.lifecycleRoot, 'build-after.json'), fixture.after);
    }],
    ['production build changed', (fixture) => {
      fs.writeFileSync(path.join(fixture.repositoryRoot, 'src/register.js'),
        'export const register = false;\n');
      const changed = captureCashierBuildSnapshot({
        repositoryRoot: fixture.repositoryRoot,
        files: fixture.productionFiles,
      });
      changed.capturedAt = fixture.after.capturedAt;
      writeJson(path.join(fixture.lifecycleRoot, 'build-after.json'), changed);
    }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, (subtest) => {
      const fixture = makeFixture();
      subtest.after(() => fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true }));
      mutate(fixture);
      assert.throws(() => generateCapture39LifecycleProvenance({
        lifecycleRoot: fixture.lifecycleRoot,
        repositoryRoot: fixture.repositoryRoot,
        productionFiles: fixture.productionFiles,
      }), Capture39ProvenanceError);
      assert.equal(fs.existsSync(fixture.output), false,
        'a failed audit must not create capture-39-provenance.json');
    });
  }
});

test('snapshot mode writes the same schema-v2 full build envelope consumed by finalization', (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true }));
  const output = path.join(fixture.lifecycleRoot, 'snapshot-mode.json');
  const written = writeCashierBuildSnapshotFile({
    outputPath: output,
    repositoryRoot: fixture.repositoryRoot,
    files: fixture.productionFiles,
  });
  const bytes = fs.readFileSync(output);
  const parsed = JSON.parse(bytes);
  assert.equal(written.sha256, sha256(bytes));
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.algorithm, 'sha256');
  assert.equal(parsed.fileCount, parsed.files.length);
  assert.deepEqual(parsed.productionBuildHashes, written.snapshot.productionBuildHashes);
});
