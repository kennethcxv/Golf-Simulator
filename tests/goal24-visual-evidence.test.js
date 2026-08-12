import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';

import {
  GOAL24_VISUAL_EVIDENCE_SCHEMA,
  analyzeGoal24Webm,
  goal24VisualEvidenceDigest,
  goal24VisualEvidencePayload,
  goal24VisualMarkerDefinition,
  validateGoal24VisualMarkerPixels,
} from '../tools/qa/lib/goal24-visual-evidence.mjs';
import { validateGoal24DecodedVideo } from '../tools/qa/lib/goal24-video-decode.mjs';

function eventFixture() {
  const stats = (values) => {
    const sorted = [...values].sort((left, right) => left - right);
    const percentile = (fraction) => sorted[Math.floor((sorted.length - 1) * fraction)];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const slowCount = Math.max(1, Math.ceil(values.length * 0.01));
    const slowMean = [...values].sort((left, right) => right - left)
      .slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
    const round = (value) => +value.toFixed(3);
    return {
      samples: values.length,
      meanMs: round(mean),
      medianMs: round(percentile(0.5)),
      p95Ms: round(percentile(0.95)),
      p99Ms: round(percentile(0.99)),
      worstMs: round(sorted.at(-1)),
      over33: values.filter((value) => value > 33).length,
      over50: values.filter((value) => value > 50).length,
      averageFps: round(1000 / mean),
      onePercentLowFps: round(1000 / slowMean),
    };
  };
  const displayFrameIntervalsMs = [8, 16, 18];
  const renderFrameIntervalsMs = [6, 16, 16];
  const renderSubmissionWallMs = [8, 6, 7];
  const cadence = (ends, values) => ends.map((endAtMs, index) => ({
    startAtMs: endAtMs - values[index],
    endAtMs,
    durationMs: values[index],
  }));
  return {
    id: 'door-approach-1',
    scenario: 'doorApproach',
    thermalState: 'cold',
    repetition: 1,
    startedAtMs: 1500,
    endedAtMs: 1544.25,
    recordingStoppedAtMs: 1545,
    durationMs: 44.25,
    discriminator: {
      productionOutcomeMarkerAtMs: 1512.5,
      contractOutcomeMarkerAtMs: 1544.25,
      outcomeObservedAtMs: 1509,
    },
    markers: [
      { label: 'production-outcome-observed', atMs: 1512.5 },
      { label: 'post-outcome-render-boundary', atMs: 1544.25 },
    ],
    displayFrameIntervalsMs,
    displayCadenceIntervals: cadence([1508, 1524, 1542], displayFrameIntervalsMs),
    renderFrameIntervalsMs,
    renderCadenceIntervals: cadence([1500, 1516, 1532], renderFrameIntervalsMs),
    renderSubmissionWallMs,
    metrics: {
      displayRaf: stats(displayFrameIntervalsMs),
      actualRender: stats(renderFrameIntervalsMs),
      renderSubmissionWall: stats(renderSubmissionWallMs),
    },
    renderStarts: 3,
    droppedSamples: { display: 0, render: 0, submission: 0 },
    sampleCoverage: {
      complete: true,
      displayFirstBoundaryOffsetMs: 8,
      displayLastBoundaryBeforeEndMs: 2.25,
      renderFirstBoundaryOffsetMs: 0,
      renderLastBoundaryBeforeEndMs: 12.25,
      measurementPriorDisplayBoundaryMs: 1500,
      measurementPriorRenderBoundaryMs: 1494,
    },
    renderFrameEvidence: [
      {
        ordinal: 1,
        productionRenderStartedAtMs: 1500,
        productionRenderEndedAtMs: 1508,
        rendererFrameBefore: 100,
        rendererFrameAfter: 101,
        calls: 640,
        triangles: 4_800_000,
        rendererInfoAutoReset: false,
        shadowBakesBefore: 8,
        shadowBakesAfter: 9,
        shadowBakeDelta: 1,
        composedRendersBefore: 50,
        composedRendersAfter: 51,
        composedRenderDelta: 1,
        frameClass: 'shadow-bake',
        boundarySource: 'shipping-scene3d.render-wrapper',
        counterSource: 'THREE.WebGLRenderer.info.render-after-shipping-composed-frame',
        shadowClassificationSource: 'scene3d.post.stats().shadowBakes',
        composedRenderSource: 'scene3d.post.stats().composedRenders',
      },
      {
        ordinal: 2,
        productionRenderStartedAtMs: 1516,
        productionRenderEndedAtMs: 1522,
        rendererFrameBefore: 101,
        rendererFrameAfter: 102,
        calls: 575,
        triangles: 4_700_000,
        rendererInfoAutoReset: false,
        shadowBakesBefore: 9,
        shadowBakesAfter: 9,
        shadowBakeDelta: 0,
        composedRendersBefore: 51,
        composedRendersAfter: 52,
        composedRenderDelta: 1,
        frameClass: 'non-shadow',
        boundarySource: 'shipping-scene3d.render-wrapper',
        counterSource: 'THREE.WebGLRenderer.info.render-after-shipping-composed-frame',
        shadowClassificationSource: 'scene3d.post.stats().shadowBakes',
        composedRenderSource: 'scene3d.post.stats().composedRenders',
      },
      {
        ordinal: 3,
        productionRenderStartedAtMs: 1532,
        productionRenderEndedAtMs: 1539,
        rendererFrameBefore: 102,
        rendererFrameAfter: 103,
        calls: 590,
        triangles: 4_650_000,
        rendererInfoAutoReset: false,
        shadowBakesBefore: 9,
        shadowBakesAfter: 9,
        shadowBakeDelta: 0,
        composedRendersBefore: 52,
        composedRendersAfter: 53,
        composedRenderDelta: 1,
        frameClass: 'non-shadow',
        boundarySource: 'shipping-scene3d.render-wrapper',
        counterSource: 'THREE.WebGLRenderer.info.render-after-shipping-composed-frame',
        shadowClassificationSource: 'scene3d.post.stats().shadowBakes',
        composedRenderSource: 'scene3d.post.stats().composedRenders',
      },
    ],
  };
}

function sourceFixture(event = eventFixture()) {
  return {
    sessionId: 'session-2026-08-11',
    runId: 'run-video-1',
    launchId: 'launch-8b4f1c4a',
    videoNonce: 'a589fc6e-5519-4f26-8d50-63a4d9825b2b',
    scenario: event.scenario,
    eventIndex: 0,
    interactionId: event.id,
  };
}

function renderMarkerPng(definition, { moduleSize = 10, x = 12, y = 16 } = {}) {
  const width = x * 2 + definition.gridSize * moduleSize;
  const height = y * 2 + definition.gridSize * moduleSize;
  const png = new PNG({ width, height });
  png.data.fill(127);
  for (let cellY = 0; cellY < definition.gridSize; cellY += 1) {
    for (let cellX = 0; cellX < definition.gridSize; cellX += 1) {
      const color = definition.cells[cellY * definition.gridSize + cellX];
      for (let py = 0; py < moduleSize; py += 1) {
        for (let px = 0; px < moduleSize; px += 1) {
          const offset = ((y + cellY * moduleSize + py) * width
            + x + cellX * moduleSize + px) * 4;
          png.data.set(color, offset);
        }
      }
    }
  }
  return {
    png,
    rect: { x, y, width: definition.gridSize * moduleSize, height: definition.gridSize * moduleSize },
  };
}

test('visual payload has fixed event-derived fields and its digest changes with timing', () => {
  const event = eventFixture();
  const source = sourceFixture(event);
  const payload = goal24VisualEvidencePayload(event, source);
  assert.equal(payload.schema, GOAL24_VISUAL_EVIDENCE_SCHEMA);
  assert.equal(payload.source.scenario, 'doorApproach');
  assert.equal(payload.metrics.actualRender.p95Ms, 16);
  assert.equal(payload.renderer.peakNonShadowDrawCalls, 590);
  assert.equal(payload.renderer.peakNonShadowRenderedTriangles, 4_700_000);
  assert.match(payload.renderer.evidenceSha256, /^[a-f0-9]{64}$/u);
  const digest = goal24VisualEvidenceDigest(payload);
  assert.match(digest, /^[a-f0-9]{64}$/u);
  const mutated = structuredClone(event);
  mutated.metrics.actualRender.p95Ms += 0.001;
  assert.throws(() => goal24VisualEvidencePayload(mutated, source), /exact recomputation/);

  const sampleMutation = structuredClone(event);
  sampleMutation.displayFrameIntervalsMs[2] += 1;
  sampleMutation.displayCadenceIntervals[2].startAtMs -= 1;
  sampleMutation.displayCadenceIntervals[2].durationMs += 1;
  sampleMutation.metrics.displayRaf = eventFixture().metrics.displayRaf;
  assert.throws(() => goal24VisualEvidencePayload(sampleMutation, source), /exact recomputation/);

  const workloadMutation = structuredClone(event);
  workloadMutation.renderFrameEvidence[2].calls += 1;
  assert.notEqual(
    goal24VisualEvidenceDigest(goal24VisualEvidencePayload(workloadMutation, source)),
    digest,
  );
});

test('screenshot marker pixels bind the exact closed interaction and reject stripes or relabels', () => {
  const event = eventFixture();
  const payload = goal24VisualEvidencePayload(event, sourceFixture(event));
  const definition = goal24VisualMarkerDefinition(payload);
  const rendered = renderMarkerPng(definition);
  const result = validateGoal24VisualMarkerPixels({
    png: rendered.png,
    markerRect: rendered.rect,
    devicePixelRatio: 1,
    payload,
  });
  assert.equal(result.digest, definition.digest);
  assert.equal(result.matchFraction, 1);

  const relabelled = structuredClone(payload);
  relabelled.source.scenario = 'ledgerOpen';
  assert.throws(() => validateGoal24VisualMarkerPixels({
    png: rendered.png,
    markerRect: rendered.rect,
    devicePixelRatio: 1,
    payload: relabelled,
  }), /Visual marker cell|do not encode the closed interaction/);

  const striped = new PNG({ width: rendered.png.width, height: rendered.png.height });
  for (let index = 0; index < striped.data.length; index += 4) {
    const shade = 18 + ((index / 4) % 31);
    striped.data[index] = shade;
    striped.data[index + 1] = shade + 10;
    striped.data[index + 2] = shade + 5;
    striped.data[index + 3] = 255;
  }
  assert.throws(() => validateGoal24VisualMarkerPixels({
    png: striped,
    markerRect: rendered.rect,
    devicePixelRatio: 1,
    payload,
  }), /Visual marker cell|do not encode the closed interaction/);
});

test('visual payload rejects relabels, missing metrics, and fabricated renderer provenance', () => {
  const event = eventFixture();
  const source = sourceFixture(event);
  assert.throws(() => goal24VisualEvidencePayload(event, {
    ...source,
    scenario: 'npcNavActivation',
  }), /must exactly match/);

  const noMetrics = structuredClone(event);
  noMetrics.metrics.actualRender = null;
  assert.throws(() => goal24VisualEvidencePayload(noMetrics, source), /exact recomputation/);

  const fabricatedFrame = structuredClone(event);
  Object.assign(fabricatedFrame.renderFrameEvidence[1], {
    productionRenderStartedAtMs: 999999,
    rendererFrameBefore: null,
    shadowBakesBefore: 12,
    shadowBakesAfter: 11,
    shadowBakeDelta: 1,
    frameClass: 'non-shadow',
  });
  assert.throws(() => goal24VisualEvidencePayload(fabricatedFrame, source),
    /cadence endpoint|outside the measured interaction|renderer counter|shadow/);

  const identityMutation = goal24VisualEvidencePayload(event, {
    ...source,
    videoNonce: 'b589fc6e-5519-4f26-8d50-63a4d9825b2b',
  });
  assert.notEqual(
    goal24VisualEvidenceDigest(identityMutation),
    goal24VisualEvidenceDigest(goal24VisualEvidencePayload(event, source)),
  );
});

test('visual marker rejects sparse center-pixel forgeries and invalid corner anchors', () => {
  const event = eventFixture();
  const payload = goal24VisualEvidencePayload(event, sourceFixture(event));
  const definition = goal24VisualMarkerDefinition(payload);
  const sparse = renderMarkerPng(definition);
  const moduleSize = sparse.rect.width / definition.gridSize;
  for (let py = sparse.rect.y; py < sparse.rect.y + sparse.rect.height; py += 1) {
    for (let px = sparse.rect.x; px < sparse.rect.x + sparse.rect.width; px += 1) {
      sparse.png.data.set([255, 0, 255, 255], (py * sparse.png.width + px) * 4);
    }
  }
  for (let y = 0; y < definition.gridSize; y += 1) {
    for (let x = 0; x < definition.gridSize; x += 1) {
      const centerX = sparse.rect.x + x * moduleSize + Math.floor(moduleSize / 2);
      const centerY = sparse.rect.y + y * moduleSize + Math.floor(moduleSize / 2);
      sparse.png.data.set(
        definition.cells[y * definition.gridSize + x],
        (centerY * sparse.png.width + centerX) * 4,
      );
    }
  }
  assert.throws(() => validateGoal24VisualMarkerPixels({
    png: sparse.png,
    markerRect: sparse.rect,
    devicePixelRatio: 1,
    payload,
    maximumColorDistance: Infinity,
    minimumMatchFraction: 0,
  }), /Visual marker cell/);

  const badCorners = renderMarkerPng(definition);
  for (const [x, y] of [[0, 0], [19, 0], [0, 19], [19, 19]]) {
    for (let py = 0; py < moduleSize; py += 1) {
      for (let px = 0; px < moduleSize; px += 1) {
        const offset = ((badCorners.rect.y + y * moduleSize + py) * badCorners.png.width
          + badCorners.rect.x + x * moduleSize + px) * 4;
        badCorners.png.data.set([255, 0, 255, 255], offset);
      }
    }
  }
  assert.throws(() => validateGoal24VisualMarkerPixels({
    png: badCorners.png,
    markerRect: badCorners.rect,
    devicePixelRatio: 1,
    payload,
  }), /orientation anchor/);
});

function idBytes(id) {
  const bytes = [];
  let value = id;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return Buffer.from(bytes);
}

function sizeBytes(size) {
  for (let length = 1; length <= 8; length += 1) {
    const maximum = 2 ** (7 * length) - 2;
    if (size <= maximum && Number.isSafeInteger(maximum)) {
      const bytes = Buffer.alloc(length);
      let remaining = size;
      for (let index = length - 1; index >= 0; index -= 1) {
        bytes[index] = remaining & 0xff;
        remaining = Math.floor(remaining / 256);
      }
      bytes[0] |= 1 << (8 - length);
      return bytes;
    }
  }
  throw new Error('fixture EBML size is too large');
}

function element(id, data) {
  return Buffer.concat([idBytes(id), sizeBytes(data.length), data]);
}

function uint(value, width = null) {
  let bytes = width || 1;
  while (value >= 2 ** (8 * bytes)) bytes += 1;
  const result = Buffer.alloc(bytes);
  let remaining = value;
  for (let index = bytes - 1; index >= 0; index -= 1) {
    result[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return result;
}

function seededPayload(index, length = 5000) {
  const payload = Buffer.alloc(length);
  let state = (0x9e3779b9 ^ index) >>> 0;
  for (let cursor = 0; cursor < payload.length; cursor += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    payload[cursor] = state & 0xff;
  }
  // A valid VP8 uncompressed keyframe header marker. The test is structural,
  // not a claim that the synthetic payload decodes as a complete frame.
  payload[0] &= 0xfe;
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload[6] = 0x00;
  payload[7] = 0x05; // 1280
  payload[8] = 0xd0;
  payload[9] = 0x02; // 720
  return payload;
}

function webmFixture({
  frameCount = 40,
  repeated = false,
  invisible = false,
  secondClusterTimecode = 3000,
} = {}) {
  const ebml = element(0x1a45dfa3, Buffer.concat([
    element(0x4282, Buffer.from('webm')),
  ]));
  const video = element(0xe0, Buffer.concat([
    element(0xb0, uint(1280, 2)),
    element(0xba, uint(720, 2)),
  ]));
  const track = element(0xae, Buffer.concat([
    element(0xd7, uint(1)),
    element(0x83, uint(1)),
    element(0x86, Buffer.from('V_VP8')),
    video,
  ]));
  const tracks = element(0x1654ae6b, track);
  const info = element(0x1549a966, element(0x2ad7b1, uint(1_000_000, 3)));
  const clusters = [];
  for (let clusterIndex = 0; clusterIndex < 2; clusterIndex += 1) {
    const timecode = clusterIndex === 0 ? 0 : secondClusterTimecode;
    const blocks = [];
    for (let index = 0; index < frameCount / 2; index += 1) {
      const relative = index * 150;
      const header = Buffer.from([
        0x81,
        (relative >>> 8) & 0xff,
        relative & 0xff,
        invisible ? 0x88 : 0x80,
      ]);
      blocks.push(element(0xa3, Buffer.concat([
        header,
        seededPayload(repeated ? 1 : clusterIndex * frameCount + index),
      ])));
    }
    clusters.push(element(0x1f43b675, Buffer.concat([
      element(0xe7, uint(timecode, 2)),
      ...blocks,
    ])));
  }
  return Buffer.concat([ebml, element(0x18538067, Buffer.concat([info, tracks, ...clusters]))]);
}

test('WebM validation parses tracks, clusters, changing codec frames, duration, and entropy', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-webm-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'capture.webm');
  fs.writeFileSync(file, webmFixture());
  const result = analyzeGoal24Webm(file, { minimumDurationMs: 5_000 });
  assert.equal(result.codecId, 'V_VP8');
  assert.equal(result.width, 1280);
  assert.equal(result.height, 720);
  assert.equal(result.clusterCount, 2);
  assert.equal(result.videoFrameCount, 40);
  assert.equal(result.uniqueEncodedFrameCount, 40);
  assert.ok(result.durationMs >= 5_000);
  assert.ok(result.sampledPayloadEntropyBitsPerByte >= 4);
});

test('WebM validation rejects the old zero-filled marker fake and repeated-frame streams', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-webm-adversarial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'fake.webm');
  const oldFake = Buffer.alloc(20 * 1024);
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(oldFake, 0);
  Buffer.from('webm').copy(oldFake, 16);
  Buffer.from([0x1f, 0x43, 0xb6, 0x75]).copy(oldFake, 10 * 1024);
  fs.writeFileSync(file, oldFake);
  assert.throws(() => analyzeGoal24Webm(file), /structured EBML WebM|Malformed EBML|exceeds its parent/);

  fs.writeFileSync(file, webmFixture({ repeated: true }));
  assert.throws(() => analyzeGoal24Webm(file), /unique encoded frames/);

  fs.writeFileSync(file, webmFixture({ invisible: true }));
  assert.throws(() => analyzeGoal24Webm(file), /invisible frames/);

  fs.writeFileSync(file, webmFixture({ secondClusterTimecode: 6000 }));
  assert.throws(() => analyzeGoal24Webm(file), /frame gap|not sustained/);
});

test('Chromium decode gate rejects random VP8-shaped payloads that pass structural parsing', {
  timeout: 45_000,
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal24-webm-decode-adversarial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'synthetic-structural.webm');
  fs.writeFileSync(file, webmFixture());
  assert.equal(analyzeGoal24Webm(file).structuredMediaDataPresent, true);
  const screenshot = path.join(root, 'paired.png');
  fs.writeFileSync(screenshot, PNG.sync.write(new PNG({ width: 1280, height: 720 })));
  const payload = {
    schema: GOAL24_VISUAL_EVIDENCE_SCHEMA,
    source: { scenario: 'doorApproach', interactionId: 'door-approach-1' },
  };
  await assert.rejects(validateGoal24DecodedVideo({
    file,
    expectedMarkers: [{
      payload,
      digest: goal24VisualEvidenceDigest(payload),
      markerRect: { x: 1000, y: 20, width: 200, height: 200 },
      panelRect: { x: 980, y: 0, width: 240, height: 260 },
      screenshot,
    }],
    outputDirectory: path.join(root, 'proofs'),
    expectedWidth: 1280,
    expectedHeight: 720,
    minimumDurationMs: 5_000,
  }), /decode|PIPELINE|media|ended|Timed out/iu);
});
