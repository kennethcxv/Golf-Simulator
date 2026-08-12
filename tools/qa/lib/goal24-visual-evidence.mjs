import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

export const GOAL24_VISUAL_EVIDENCE_SCHEMA = 'golf-flipper/goal24-visual-evidence/v2';
export const GOAL24_VISUAL_MARKER_SCHEMA = 'golf-flipper/goal24-visual-marker/v2';
export const GOAL24_VISUAL_MARKER_GRID_SIZE = 20;

const FRAME_BOUNDARY_SOURCE = 'shipping-scene3d.render-wrapper';
const RENDER_COUNTER_SOURCE = 'THREE.WebGLRenderer.info.render-after-shipping-composed-frame';
const SHADOW_COUNTER_SOURCE = 'scene3d.post.stats().shadowBakes';
const COMPOSED_RENDER_SOURCE = 'scene3d.post.stats().composedRenders';
const CLOCK_EPSILON_MS = 0.05;

const MARKER_COLORS = Object.freeze({
  zero: Object.freeze([18, 28, 23, 255]),
  one: Object.freeze([245, 237, 218, 255]),
  topLeft: Object.freeze([226, 76, 75, 255]),
  topRight: Object.freeze([86, 179, 92, 255]),
  bottomLeft: Object.freeze([79, 135, 210, 255]),
  bottomRight: Object.freeze([216, 170, 73, 255]),
});

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function roundMetric(value) {
  return Number.isFinite(value) ? +value.toFixed(3) : null;
}

function percentile(sorted, fraction) {
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
    : null;
}

function metricStatistics(values, label) {
  required(Array.isArray(values) && values.length > 0,
    `${label}: visual evidence requires non-empty raw samples.`);
  required(values.every((value) => Number.isFinite(value) && value >= 0),
    `${label}: visual evidence raw samples must be finite and nonnegative.`);
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const slowCount = Math.max(1, Math.ceil(values.length * 0.01));
  const slowMean = [...values].sort((left, right) => right - left)
    .slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
  return {
    samples: values.length,
    meanMs: roundMetric(mean),
    medianMs: roundMetric(percentile(sorted, 0.5)),
    p95Ms: roundMetric(percentile(sorted, 0.95)),
    p99Ms: roundMetric(percentile(sorted, 0.99)),
    worstMs: roundMetric(sorted.at(-1)),
    over33: values.filter((value) => value > 33).length,
    over50: values.filter((value) => value > 50).length,
    averageFps: mean > 0 ? roundMetric(1000 / mean) : null,
    onePercentLowFps: slowMean > 0 ? roundMetric(1000 / slowMean) : null,
  };
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function metricProjection(event, {
  metricName, samplesName, cadenceName = null, scenario,
}) {
  const samples = event?.[samplesName];
  const label = `${scenario}/${event?.id} ${metricName}`;
  const statistics = metricStatistics(samples, label);
  required(isDeepStrictEqual(event?.metrics?.[metricName], statistics),
    `${label}: claimed metrics are not an exact recomputation of raw samples.`);
  let cadenceSha256 = null;
  if (cadenceName) {
    const cadence = event?.[cadenceName];
    const coveragePrefix = metricName === 'displayRaf' ? 'display' : 'render';
    const firstOffsetKey = `${coveragePrefix}FirstBoundaryOffsetMs`;
    const lastGapKey = `${coveragePrefix}LastBoundaryBeforeEndMs`;
    const priorBoundaryKey = `measurementPrior${coveragePrefix[0].toUpperCase()}${coveragePrefix.slice(1)}BoundaryMs`;
    required(Array.isArray(cadence) && cadence.length === samples.length,
      `${label}: cadence evidence is not one-for-one with raw samples.`);
    cadence.forEach((interval, index) => {
      required(Number.isFinite(interval?.startAtMs) && Number.isFinite(interval?.endAtMs)
        && interval.endAtMs >= interval.startAtMs
        && Math.abs(interval.durationMs - samples[index]) <= CLOCK_EPSILON_MS
        && Math.abs(interval.endAtMs - interval.startAtMs - interval.durationMs)
          <= CLOCK_EPSILON_MS,
      `${label}: cadence interval ${index + 1} is invalid or does not match its raw sample.`);
      required(interval.endAtMs >= event.startedAtMs - 33
        && interval.endAtMs <= event.endedAtMs + CLOCK_EPSILON_MS
        && (index === 0 || interval.endAtMs >= event.startedAtMs - CLOCK_EPSILON_MS),
      `${label}: cadence interval ${index + 1} ends outside the measured interaction `
        + `[${event.startedAtMs}, ${event.endedAtMs}] at ${interval.endAtMs}.`);
      if (index > 0) required(interval.startAtMs
        >= cadence[index - 1].endAtMs - CLOCK_EPSILON_MS,
      `${label}: cadence interval ${index + 1} reverses the preceding interval.`);
    });
    const firstOffsetMs = cadence[0].endAtMs - event.startedAtMs;
    const lastGapMs = event.endedAtMs - cadence.at(-1).endAtMs;
    required(Number.isFinite(event.sampleCoverage?.[firstOffsetKey])
      && Math.abs(event.sampleCoverage[firstOffsetKey] - firstOffsetMs) <= CLOCK_EPSILON_MS
      && Number.isFinite(event.sampleCoverage?.[lastGapKey])
      && Math.abs(event.sampleCoverage[lastGapKey] - lastGapMs) <= CLOCK_EPSILON_MS
      && Number.isFinite(event.sampleCoverage?.[priorBoundaryKey])
      && Math.abs(event.sampleCoverage[priorBoundaryKey] - cadence[0].startAtMs)
        <= CLOCK_EPSILON_MS,
    `${label}: cadence boundaries do not match recorder-owned coverage/provenance.`);
    cadenceSha256 = sha256Json(cadence);
  }
  return {
    ...statistics,
    rawSamplesSha256: sha256Json(samples),
    cadenceSha256,
  };
}

function rendererProjection(event, scenario) {
  const frames = event?.renderFrameEvidence;
  required(Array.isArray(frames) && frames.length > 0,
    `${scenario}/${event?.id}: visual evidence requires composed-render frame evidence.`);
  const canonical = frames.map((frame, index) => {
    required(Number.isInteger(frame?.ordinal) && frame.ordinal === index + 1,
      `${scenario}/${event.id}: render-frame ordinals are not contiguous.`);
    required(Number.isFinite(frame.productionRenderStartedAtMs)
      && Number.isFinite(frame.productionRenderEndedAtMs)
      && frame.productionRenderEndedAtMs >= frame.productionRenderStartedAtMs,
    `${scenario}/${event.id}: render-frame ${index + 1} timing is invalid.`);
    required(frame.productionRenderStartedAtMs >= event.startedAtMs - CLOCK_EPSILON_MS
      && frame.productionRenderEndedAtMs <= event.endedAtMs + CLOCK_EPSILON_MS,
    `${scenario}/${event.id}: render-frame ${index + 1} lies outside the measured interaction.`);
    required(Number.isInteger(frame.rendererFrameBefore)
      && Number.isInteger(frame.rendererFrameAfter)
      && frame.rendererFrameAfter > frame.rendererFrameBefore,
    `${scenario}/${event.id}: render-frame ${index + 1} renderer counter is invalid.`);
    required(Number.isInteger(frame.calls) && frame.calls >= 0
      && Number.isInteger(frame.triangles) && frame.triangles >= 0,
    `${scenario}/${event.id}: render-frame ${index + 1} workload is invalid.`);
    required(frame.rendererInfoAutoReset === false,
      `${scenario}/${event.id}: renderer.info.autoReset must be false.`);
    required(Number.isInteger(frame.shadowBakesBefore)
      && Number.isInteger(frame.shadowBakesAfter)
      && frame.shadowBakesAfter >= frame.shadowBakesBefore
      && frame.shadowBakeDelta === frame.shadowBakesAfter - frame.shadowBakesBefore
      && frame.shadowBakeDelta >= 0 && frame.shadowBakeDelta <= 1,
    `${scenario}/${event.id}: render-frame ${index + 1} shadow classification is invalid.`);
    required(frame.frameClass === (frame.shadowBakeDelta === 0 ? 'non-shadow' : 'shadow-bake'),
      `${scenario}/${event.id}: render-frame ${index + 1} shadow class contradicts its counter.`);
    required(Number.isInteger(frame.composedRendersBefore)
      && Number.isInteger(frame.composedRendersAfter)
      && frame.composedRendersAfter === frame.composedRendersBefore + 1
      && frame.composedRenderDelta === 1,
    `${scenario}/${event.id}: render-frame ${index + 1} is not one shipping composed render.`);
    required(frame.boundarySource === FRAME_BOUNDARY_SOURCE
      && frame.counterSource === RENDER_COUNTER_SOURCE
      && frame.shadowClassificationSource === SHADOW_COUNTER_SOURCE
      && frame.composedRenderSource === COMPOSED_RENDER_SOURCE,
    `${scenario}/${event.id}: render-frame ${index + 1} provenance is missing or drifted.`);
    if (index > 0) {
      const previous = frames[index - 1];
      required(frame.productionRenderStartedAtMs
        >= previous.productionRenderEndedAtMs - CLOCK_EPSILON_MS,
      `${scenario}/${event.id}: render-frame ${index + 1} overlaps or reverses its predecessor.`);
      required(frame.rendererFrameBefore === previous.rendererFrameAfter,
        `${scenario}/${event.id}: render-frame ${index + 1} renderer counter is not contiguous.`);
      required(frame.shadowBakesBefore === previous.shadowBakesAfter,
        `${scenario}/${event.id}: render-frame ${index + 1} shadow counter is not contiguous.`);
      required(frame.composedRendersBefore === previous.composedRendersAfter,
        `${scenario}/${event.id}: render-frame ${index + 1} composed counter is not contiguous.`);
    }
    return {
      ordinal: frame.ordinal,
      productionRenderStartedAtMs: frame.productionRenderStartedAtMs,
      productionRenderEndedAtMs: frame.productionRenderEndedAtMs,
      rendererFrameBefore: frame.rendererFrameBefore,
      rendererFrameAfter: frame.rendererFrameAfter,
      calls: frame.calls,
      triangles: frame.triangles,
      shadowBakesBefore: frame.shadowBakesBefore,
      shadowBakesAfter: frame.shadowBakesAfter,
      shadowBakeDelta: frame.shadowBakeDelta,
      composedRendersBefore: frame.composedRendersBefore,
      composedRendersAfter: frame.composedRendersAfter,
      composedRenderDelta: frame.composedRenderDelta,
      frameClass: frame.frameClass,
    };
  });
  const nonShadow = canonical.filter(({ frameClass }) => frameClass === 'non-shadow');
  required(nonShadow.length > 0,
    `${scenario}/${event.id}: visual evidence has no non-shadow production frame.`);
  const peakDraw = [...nonShadow].sort((left, right) => (
    right.calls - left.calls || right.triangles - left.triangles || left.ordinal - right.ordinal
  ))[0];
  const peakTriangles = [...nonShadow].sort((left, right) => (
    right.triangles - left.triangles || right.calls - left.calls || left.ordinal - right.ordinal
  ))[0];
  return {
    evidenceSha256: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
    observedFrameCount: canonical.length,
    nonShadowFrameCount: nonShadow.length,
    shadowBakeFrameCount: canonical.length - nonShadow.length,
    peakNonShadowDrawCalls: peakDraw.calls,
    peakNonShadowDrawCallFrameOrdinal: peakDraw.ordinal,
    peakNonShadowRenderedTriangles: peakTriangles.triangles,
    peakNonShadowTriangleFrameOrdinal: peakTriangles.ordinal,
    firstProductionRenderStartedAtMs: canonical[0].productionRenderStartedAtMs,
    lastProductionRenderEndedAtMs: canonical.at(-1).productionRenderEndedAtMs,
    firstComposedRenderCounter: canonical[0].composedRendersBefore,
    lastComposedRenderCounter: canonical.at(-1).composedRendersAfter,
  };
}

function exactMarker(event, label, expectedAtMs, scenario) {
  const matches = event?.markers?.filter((marker) => marker?.label === label) || [];
  required(matches.length === 1 && Number.isFinite(matches[0].atMs)
    && Math.abs(matches[0].atMs - expectedAtMs) <= CLOCK_EPSILON_MS,
  `${scenario}/${event?.id}: ${label} is missing or not bound to its discriminator timestamp.`);
  return matches[0].atMs;
}

/**
 * Build the exact, fixed-order event payload rendered into a diagnostic frame.
 * Every value comes from the already-closed interaction window, so the marker
 * cannot silently describe a rolling overlay or a later unrelated frame.
 */
export function goal24VisualEvidencePayload(event, source) {
  required(event && typeof event === 'object', 'Visual evidence requires an interaction event.');
  const scenario = source?.scenario;
  required(typeof scenario === 'string' && scenario.length > 0 && event.scenario === scenario,
    'Visual evidence source scenario must exactly match the raw interaction event.');
  required(typeof event.id === 'string' && event.id.length > 0,
    `${scenario}: visual evidence requires an interaction ID.`);
  required(source?.interactionId === event.id && Number.isInteger(source?.eventIndex)
    && source.eventIndex >= 0,
  `${scenario}/${event.id}: visual evidence requires its exact raw source coordinate.`);
  for (const field of ['sessionId', 'runId', 'launchId', 'videoNonce']) {
    required(typeof source?.[field] === 'string' && source[field].length > 0,
      `${scenario}/${event.id}: visual evidence source lacks ${field}.`);
  }
  required(/^[a-f0-9-]{16,}$/iu.test(source.videoNonce),
    `${scenario}/${event.id}: visual evidence video nonce is invalid.`);
  required(['cold', 'warm'].includes(event.thermalState)
    && Number.isInteger(event.repetition) && event.repetition > 0,
  `${scenario}/${event.id}: visual evidence thermal state or repetition is invalid.`);
  required(Number.isFinite(event.startedAtMs) && Number.isFinite(event.endedAtMs)
    && event.endedAtMs > event.startedAtMs
    && Number.isFinite(event.recordingStoppedAtMs)
    && event.recordingStoppedAtMs >= event.endedAtMs
    && Number.isFinite(event.durationMs)
    && Math.abs(event.durationMs - (event.endedAtMs - event.startedAtMs)) <= CLOCK_EPSILON_MS,
  `${scenario}/${event.id}: visual evidence interaction boundaries are invalid.`);
  const observedAtMs = event.discriminator?.outcomeObservedAtMs;
  const productionMarkerAtMs = event.discriminator?.productionOutcomeMarkerAtMs;
  const contractMarkerAtMs = event.discriminator?.contractOutcomeMarkerAtMs;
  required(Number.isFinite(observedAtMs) && Number.isFinite(productionMarkerAtMs)
    && Number.isFinite(contractMarkerAtMs)
    && observedAtMs >= event.startedAtMs - CLOCK_EPSILON_MS
    && productionMarkerAtMs >= observedAtMs
    && contractMarkerAtMs >= productionMarkerAtMs
    && Math.abs(contractMarkerAtMs - event.endedAtMs) <= CLOCK_EPSILON_MS,
  `${scenario}/${event.id}: visual evidence outcome markers are missing or unordered.`);
  exactMarker(event, 'production-outcome-observed', productionMarkerAtMs, scenario);
  exactMarker(event, 'post-outcome-render-boundary', contractMarkerAtMs, scenario);
  required(event.sampleCoverage?.complete === true
    && event.droppedSamples?.display === 0
    && event.droppedSamples?.render === 0
    && event.droppedSamples?.submission === 0,
  `${scenario}/${event.id}: visual evidence requires complete undropped measurement coverage.`);
  required(Number.isInteger(event.renderStarts)
    && event.renderStarts === event.renderFrameEvidence?.length,
  `${scenario}/${event.id}: production render count ${event.renderStarts} is not bound to `
    + `renderer frame evidence length ${event.renderFrameEvidence?.length}.`);
  const displayRaf = metricProjection(event, {
    metricName: 'displayRaf', samplesName: 'displayFrameIntervalsMs',
    cadenceName: 'displayCadenceIntervals', scenario,
  });
  const actualRender = metricProjection(event, {
    metricName: 'actualRender', samplesName: 'renderFrameIntervalsMs',
    cadenceName: 'renderCadenceIntervals', scenario,
  });
  const renderSubmissionWall = metricProjection(event, {
    metricName: 'renderSubmissionWall', samplesName: 'renderSubmissionWallMs', scenario,
  });
  required(event.renderCadenceIntervals.length === event.renderFrameEvidence.length,
    `${scenario}/${event.id}: render cadence and frame evidence are not one-for-one.`);
  event.renderFrameEvidence.forEach((frame, index) => required(
    Math.abs(frame.productionRenderStartedAtMs
      - event.renderCadenceIntervals[index].endAtMs) <= CLOCK_EPSILON_MS,
    `${scenario}/${event.id}: render-frame ${index + 1} is not tied to its cadence endpoint.`,
  ));
  return {
    schema: GOAL24_VISUAL_EVIDENCE_SCHEMA,
    source: {
      sessionId: source.sessionId,
      runId: source.runId,
      launchId: source.launchId,
      videoNonce: source.videoNonce,
      scenario,
      eventIndex: source.eventIndex,
      interactionId: event.id,
    },
    thermalState: event.thermalState,
    repetition: event.repetition,
    startedAtMs: event.startedAtMs,
    endedAtMs: event.endedAtMs,
    recordingStoppedAtMs: event.recordingStoppedAtMs,
    durationMs: event.durationMs,
    outcomeObservedAtMs: observedAtMs,
    productionOutcomeMarkerAtMs: productionMarkerAtMs,
    contractOutcomeMarkerAtMs: contractMarkerAtMs,
    metrics: {
      displayRaf,
      actualRender,
      renderSubmissionWall,
    },
    renderer: rendererProjection(event, scenario),
    coverageSha256: sha256Json({
      sampleCoverage: event.sampleCoverage,
      droppedSamples: event.droppedSamples,
      markers: event.markers,
    }),
  };
}

export function goal24VisualEvidenceDigest(payload) {
  required(payload?.schema === GOAL24_VISUAL_EVIDENCE_SCHEMA,
    'Visual evidence payload schema is missing or unsupported.');
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function bitStreamForDigest(digest) {
  required(/^[a-f0-9]{64}$/u.test(digest), 'Visual evidence digest must be lowercase SHA-256.');
  const primary = Buffer.from(digest, 'hex');
  const expansion = createHash('sha512').update(`${GOAL24_VISUAL_MARKER_SCHEMA}\0${digest}`).digest();
  const bytes = Buffer.concat([primary, expansion]);
  const bits = [];
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit -= 1) bits.push((byte >>> bit) & 1);
  }
  return bits;
}

function markerCellKind(x, y, bits) {
  const last = GOAL24_VISUAL_MARKER_GRID_SIZE - 1;
  if (x === 0 && y === 0) return 'topLeft';
  if (x === last && y === 0) return 'topRight';
  if (x === 0 && y === last) return 'bottomLeft';
  if (x === last && y === last) return 'bottomRight';
  if (y === 0 || y === last) return x % 2 === 0 ? 'one' : 'zero';
  if (x === 0 || x === last) return y % 2 === 0 ? 'one' : 'zero';
  const interiorWidth = GOAL24_VISUAL_MARKER_GRID_SIZE - 2;
  const index = (y - 1) * interiorWidth + (x - 1);
  return bits[index] === 1 ? 'one' : 'zero';
}

export function goal24VisualMarkerDefinition(payload) {
  const digest = goal24VisualEvidenceDigest(payload);
  const bits = bitStreamForDigest(digest);
  const cells = [];
  for (let y = 0; y < GOAL24_VISUAL_MARKER_GRID_SIZE; y += 1) {
    for (let x = 0; x < GOAL24_VISUAL_MARKER_GRID_SIZE; x += 1) {
      const kind = markerCellKind(x, y, bits);
      cells.push([...MARKER_COLORS[kind]]);
    }
  }
  return {
    schema: GOAL24_VISUAL_MARKER_SCHEMA,
    digest,
    gridSize: GOAL24_VISUAL_MARKER_GRID_SIZE,
    cells,
  };
}

function colorDistance(actual, expected) {
  return Math.hypot(
    actual[0] - expected[0],
    actual[1] - expected[1],
    actual[2] - expected[2],
    actual[3] - expected[3],
  );
}

function samplePixel(png, x, y) {
  const offset = (y * png.width + x) * 4;
  return [
    png.data[offset],
    png.data[offset + 1],
    png.data[offset + 2],
    png.data[offset + 3],
  ];
}

/**
 * Decode the high-contrast marker from screenshot pixels and compare every
 * module with the event-derived expectation. The four colored corner anchors
 * also catch a mirrored, cropped, shifted, or synthetic stripe rectangle.
 */
export function validateGoal24VisualMarkerPixels({
  png,
  markerRect,
  devicePixelRatio,
  payload,
}) {
  required(png?.data && Number.isInteger(png.width) && Number.isInteger(png.height),
    'Visual marker validation requires decoded RGBA pixels.');
  required(Number.isFinite(devicePixelRatio) && devicePixelRatio > 0,
    'Visual marker validation requires a positive devicePixelRatio.');
  for (const key of ['x', 'y', 'width', 'height']) {
    required(Number.isFinite(Number(markerRect?.[key])), `Visual marker rectangle lacks ${key}.`);
  }
  const definition = goal24VisualMarkerDefinition(payload);
  required(markerRect.width >= 200 && markerRect.height >= 200,
    'Visual marker rectangle is too small to be human-inspectable.');
  const physical = {
    x: Number(markerRect.x) * devicePixelRatio,
    y: Number(markerRect.y) * devicePixelRatio,
    width: Number(markerRect.width) * devicePixelRatio,
    height: Number(markerRect.height) * devicePixelRatio,
  };
  required(physical.x >= 0 && physical.y >= 0
    && physical.x + physical.width <= png.width + 0.5
    && physical.y + physical.height <= png.height + 0.5,
  'Visual marker rectangle lies outside the screenshot.');
  const rounded = Object.fromEntries(Object.entries(physical)
    .map(([key, value]) => [key, Math.round(value)]));
  required(Object.keys(physical).every((key) => Math.abs(physical[key] - rounded[key]) <= 0.01),
    'Visual marker rectangle must be integer-aligned in physical screenshot pixels.');
  required(rounded.width === rounded.height
    && rounded.width % definition.gridSize === 0,
  'Visual marker must be a square with an integer number of pixels per module.');
  const moduleSize = rounded.width / definition.gridSize;
  required(moduleSize >= 5,
    'Visual marker modules are too small for exact screenshot validation.');

  const maximumColorDistance = 12;
  const minimumCellMatchFraction = 0.995;
  const minimumGlobalMatchFraction = 0.999;
  let matches = 0;
  let sampledPixels = 0;
  let worstDistance = 0;
  const mismatches = [];
  const cells = [];
  for (let y = 0; y < definition.gridSize; y += 1) {
    for (let x = 0; x < definition.gridSize; x += 1) {
      const expected = definition.cells[y * definition.gridSize + x];
      let cellMatches = 0;
      let cellPixels = 0;
      // Ignore only the outermost physical pixel of each module. The canvas is
      // rendered at an exact integer scale, while this one-pixel inset makes
      // the proof stable if Chromium rasterizes a CSS edge on a half-open bound.
      for (let py = 1; py < moduleSize - 1; py += 1) {
        for (let px = 1; px < moduleSize - 1; px += 1) {
          const actual = samplePixel(
            png,
            rounded.x + x * moduleSize + px,
            rounded.y + y * moduleSize + py,
          );
          const distance = colorDistance(actual, expected);
          worstDistance = Math.max(worstDistance, distance);
          sampledPixels += 1;
          cellPixels += 1;
          if (distance <= maximumColorDistance) {
            matches += 1;
            cellMatches += 1;
          } else if (mismatches.length < 12) {
            mismatches.push({ x, y, px, py, actual, expected, distance });
          }
        }
      }
      const cellMatchFraction = cellMatches / cellPixels;
      const corner = (x === 0 || x === definition.gridSize - 1)
        && (y === 0 || y === definition.gridSize - 1);
      required(cellMatchFraction >= (corner ? 1 : minimumCellMatchFraction),
        `Visual marker cell ${x},${y}${corner ? ' orientation anchor' : ''} is invalid `
          + `(${cellMatches}/${cellPixels} pixels matched).`);
      cells.push({ x, y, matchedPixels: cellMatches, sampledPixels: cellPixels, cellMatchFraction });
    }
  }
  const matchFraction = matches / sampledPixels;
  required(matchFraction >= minimumGlobalMatchFraction,
    `Visual marker pixels do not encode the closed interaction (${matches}/${sampledPixels} matched; `
      + `first mismatches ${JSON.stringify(mismatches)}).`);
  return {
    schema: GOAL24_VISUAL_MARKER_SCHEMA,
    digest: definition.digest,
    matchedPixels: matches,
    sampledPixels,
    matchedCells: cells.filter(({ cellMatchFraction }) => cellMatchFraction >= minimumCellMatchFraction).length,
    totalCells: definition.gridSize ** 2,
    matchFraction: +matchFraction.toFixed(6),
    worstColorDistance: +worstDistance.toFixed(3),
    physicalRect: physical,
  };
}

function readElementId(buffer, offset) {
  required(offset < buffer.length, 'Unexpected end of EBML element ID.');
  const first = buffer[offset];
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (first & mask) === 0) {
    length += 1;
    mask >>>= 1;
  }
  required(length <= 4 && offset + length <= buffer.length, 'Malformed EBML element ID.');
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + buffer[offset + index];
  return { value, length };
}

function readVint(buffer, offset, { retainMarker = false } = {}) {
  required(offset < buffer.length, 'Unexpected end of EBML variable integer.');
  const first = buffer[offset];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length += 1;
    mask >>>= 1;
  }
  required(length <= 8 && offset + length <= buffer.length, 'Malformed EBML variable integer.');
  let value = BigInt(retainMarker ? first : first & (mask - 1));
  for (let index = 1; index < length; index += 1) value = (value << 8n) | BigInt(buffer[offset + index]);
  const valueBits = BigInt(7 * length);
  const unknown = !retainMarker && value === (1n << valueBits) - 1n;
  required(unknown || value <= BigInt(Number.MAX_SAFE_INTEGER), 'EBML element size exceeds safe integer range.');
  return { value: unknown ? null : Number(value), length, unknown };
}

function elementAt(buffer, offset, limit) {
  const id = readElementId(buffer, offset);
  const size = readVint(buffer, offset + id.length);
  const dataStart = offset + id.length + size.length;
  const dataEnd = size.unknown ? limit : dataStart + size.value;
  required(dataEnd >= dataStart && dataEnd <= limit, 'EBML element exceeds its parent boundary.');
  return { id: id.value, offset, dataStart, dataEnd, next: dataEnd, unknownSize: size.unknown };
}

function children(buffer, start, end) {
  const entries = [];
  let cursor = start;
  while (cursor < end) {
    // Matroska permits trailing zero padding only through a Void element, not
    // naked zero bytes. Fail closed instead of scanning for magic markers.
    const entry = elementAt(buffer, cursor, end);
    entries.push(entry);
    required(entries.length <= 1_000_000,
      'EBML parent contains an unsafe number of child elements.');
    required(entry.next > cursor, 'EBML parser made no forward progress.');
    cursor = entry.next;
  }
  required(cursor === end, 'EBML children do not exactly fill their parent.');
  return entries;
}

function unsignedValue(buffer, entry) {
  const length = entry.dataEnd - entry.dataStart;
  required(length >= 1 && length <= 8, 'EBML unsigned integer has an invalid width.');
  let value = 0n;
  for (let cursor = entry.dataStart; cursor < entry.dataEnd; cursor += 1) {
    value = (value << 8n) | BigInt(buffer[cursor]);
  }
  required(value <= BigInt(Number.MAX_SAFE_INTEGER), 'EBML integer exceeds safe range.');
  return Number(value);
}

function stringValue(buffer, entry) {
  return buffer.subarray(entry.dataStart, entry.dataEnd).toString('utf8').replace(/\0+$/u, '');
}

function floatValue(buffer, entry) {
  const length = entry.dataEnd - entry.dataStart;
  if (length === 4) return buffer.readFloatBE(entry.dataStart);
  if (length === 8) return buffer.readDoubleBE(entry.dataStart);
  throw new Error('EBML float has an invalid width.');
}

function parseTracks(buffer, entry) {
  const tracks = [];
  for (const child of children(buffer, entry.dataStart, entry.dataEnd)) {
    if (child.id !== 0xae) continue;
    const track = { number: null, type: null, codecId: null, width: null, height: null };
    for (const field of children(buffer, child.dataStart, child.dataEnd)) {
      if (field.id === 0xd7) track.number = unsignedValue(buffer, field);
      else if (field.id === 0x83) track.type = unsignedValue(buffer, field);
      else if (field.id === 0x86) track.codecId = stringValue(buffer, field);
      else if (field.id === 0xe0) {
        for (const videoField of children(buffer, field.dataStart, field.dataEnd)) {
          if (videoField.id === 0xb0) track.width = unsignedValue(buffer, videoField);
          else if (videoField.id === 0xba) track.height = unsignedValue(buffer, videoField);
        }
      }
    }
    tracks.push(track);
  }
  return tracks;
}

function parseBlock(buffer, entry, clusterTimecode, blockGroup = false) {
  const track = readVint(buffer, entry.dataStart, { retainMarker: false });
  const header = entry.dataStart + track.length;
  required(header + 3 <= entry.dataEnd, 'WebM block header is truncated.');
  const relativeTimecode = buffer.readInt16BE(header);
  const flags = buffer[header + 2];
  const payloadStart = header + 3;
  required(payloadStart < entry.dataEnd, 'WebM block has no encoded frame payload.');
  return {
    trackNumber: track.value,
    relativeTimecode,
    absoluteTimecode: clusterTimecode + relativeTimecode,
    keyframeFlag: blockGroup ? null : (flags & 0x80) !== 0,
    invisible: (flags & 0x08) !== 0,
    lacing: (flags >>> 1) & 0x03,
    payloadStart,
    payloadEnd: entry.dataEnd,
  };
}

function parseCluster(buffer, entry) {
  const entries = children(buffer, entry.dataStart, entry.dataEnd);
  const timecodeEntry = entries.find((child) => child.id === 0xe7);
  required(timecodeEntry, 'WebM Cluster is missing Timecode.');
  const clusterTimecode = unsignedValue(buffer, timecodeEntry);
  const blocks = [];
  for (const child of entries) {
    if (child.id === 0xa3) blocks.push(parseBlock(buffer, child, clusterTimecode));
    if (child.id === 0xa0) {
      const group = children(buffer, child.dataStart, child.dataEnd);
      const block = group.find((field) => field.id === 0xa1);
      if (block) blocks.push(parseBlock(buffer, block, clusterTimecode, true));
    }
  }
  return { clusterTimecode, blocks };
}

function shannonEntropy(buffer) {
  if (!buffer.length) return 0;
  const frequencies = new Uint32Array(256);
  for (const byte of buffer) frequencies[byte] += 1;
  let entropy = 0;
  for (const count of frequencies) {
    if (!count) continue;
    const probability = count / buffer.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function codecMarkerEvidence(codecId, frame) {
  if (codecId === 'V_VP8') {
    const keyframe = frame.length >= 10 && (frame[0] & 1) === 0
      && frame[3] === 0x9d && frame[4] === 0x01 && frame[5] === 0x2a;
    return {
      recognizable: frame.length >= 3,
      keyframe,
      width: keyframe ? frame.readUInt16LE(6) & 0x3fff : null,
      height: keyframe ? frame.readUInt16LE(8) & 0x3fff : null,
    };
  }
  if (codecId === 'V_VP9') {
    return { recognizable: frame.length >= 2 && (frame[0] & 0xc0) === 0x80, keyframe: null };
  }
  if (codecId === 'V_AV1') {
    return { recognizable: frame.length >= 2 && (frame[0] & 0x80) === 0, keyframe: null };
  }
  return { recognizable: false, keyframe: null };
}

/**
 * Parse the WebM hierarchy and prove that the Playwright artifact contains a
 * sustained, changing encoded video track. This intentionally does not accept
 * a magic header plus a Cluster byte sequence as video evidence.
 */
export function analyzeGoal24Webm(file, {
  minimumFrames = 30,
  minimumDurationMs = 5_000,
  minimumEncodedBytes = 128 * 1024,
  minimumUniqueFrames = 10,
  minimumEntropyBitsPerByte = 4,
  maximumInterFrameGapMs = 2_000,
  expectedWidth = null,
  expectedHeight = null,
} = {}) {
  const stat = fs.statSync(file);
  required(stat.isFile() && stat.size >= 16 * 1024 && stat.size <= 1024 * 1024 * 1024,
    'Video artifact is missing or too small to contain a gameplay stream.');
  minimumFrames = Math.max(30, Number(minimumFrames) || 0);
  minimumDurationMs = Math.max(5_000, Number(minimumDurationMs) || 0);
  minimumEncodedBytes = Math.max(128 * 1024, Number(minimumEncodedBytes) || 0);
  minimumUniqueFrames = Math.max(10, Number(minimumUniqueFrames) || 0);
  minimumEntropyBitsPerByte = Math.max(4, Number(minimumEntropyBitsPerByte) || 0);
  const allowedMaximumInterFrameGapMs = Math.max(
    2_000,
    Number(maximumInterFrameGapMs) || 0,
  );
  const buffer = fs.readFileSync(file);
  const top = children(buffer, 0, buffer.length);
  const ebml = top.find((entry) => entry.id === 0x1a45dfa3);
  const segment = top.find((entry) => entry.id === 0x18538067);
  required(ebml && segment, 'Video artifact is not a structured EBML WebM file.');
  const docTypeEntry = children(buffer, ebml.dataStart, ebml.dataEnd)
    .find((entry) => entry.id === 0x4282);
  required(docTypeEntry && stringValue(buffer, docTypeEntry).toLowerCase() === 'webm',
    'EBML artifact is not declared as WebM.');

  const segmentChildren = children(buffer, segment.dataStart, segment.dataEnd);
  const tracksEntry = segmentChildren.find((entry) => entry.id === 0x1654ae6b);
  required(tracksEntry, 'WebM artifact has no Tracks element.');
  const tracks = parseTracks(buffer, tracksEntry);
  required(tracks.length > 0 && tracks.length <= 8,
    'WebM track count is missing or exceeds the locked safety bound.');
  const supportedCodecs = new Set(['V_VP8', 'V_VP9', 'V_AV1']);
  const videoTracks = tracks.filter((track) => track.type === 1 && supportedCodecs.has(track.codecId));
  required(videoTracks.length === 1, 'WebM must contain exactly one supported video track.');
  const videoTrack = videoTracks[0];
  required(Number.isInteger(videoTrack.number) && videoTrack.number > 0,
    'WebM video track has no valid track number.');
  required(Number.isInteger(videoTrack.width) && videoTrack.width >= 640
    && Number.isInteger(videoTrack.height) && videoTrack.height >= 360,
  'WebM video track dimensions are missing or implausible.');
  if (expectedWidth != null) required(videoTrack.width === expectedWidth,
    `WebM width ${videoTrack.width} differs from captured viewport width ${expectedWidth}.`);
  if (expectedHeight != null) required(videoTrack.height === expectedHeight,
    `WebM height ${videoTrack.height} differs from captured viewport height ${expectedHeight}.`);

  let timecodeScaleNs = 1_000_000;
  let declaredDurationTicks = null;
  const info = segmentChildren.find((entry) => entry.id === 0x1549a966);
  if (info) {
    for (const field of children(buffer, info.dataStart, info.dataEnd)) {
      if (field.id === 0x2ad7b1) timecodeScaleNs = unsignedValue(buffer, field);
      else if (field.id === 0x4489) declaredDurationTicks = floatValue(buffer, field);
    }
  }
  required(Number.isFinite(timecodeScaleNs) && timecodeScaleNs > 0,
    'WebM TimecodeScale is invalid.');

  const clusters = segmentChildren.filter((entry) => entry.id === 0x1f43b675)
    .map((entry) => parseCluster(buffer, entry));
  required(clusters.length > 0 && clusters.length <= 100_000,
    'WebM Cluster count is missing or exceeds the locked safety bound.');
  required(clusters.every((cluster, index) => index === 0
    || cluster.clusterTimecode >= clusters[index - 1].clusterTimecode),
  'WebM Cluster timeline is not monotonic.');
  const blocks = clusters.flatMap((cluster) => cluster.blocks)
    .filter((block) => block.trackNumber === videoTrack.number);
  required(blocks.length <= 1_000_000,
    'WebM frame count exceeds the locked safety bound.');
  required(blocks.length >= minimumFrames,
    `WebM contains only ${blocks.length} video frames; ${minimumFrames} required.`);
  required(blocks.every((block) => block.lacing === 0),
    'WebM video evidence uses lacing that this validator cannot bind frame-by-frame.');
  required(blocks.every((block) => block.invisible === false),
    'WebM video evidence contains invisible frames and is not a presented gameplay timeline.');

  const frameTimesMs = blocks.map((block) => block.absoluteTimecode * timecodeScaleNs / 1_000_000);
  required(frameTimesMs.every((value, index) => Number.isFinite(value) && value >= 0
    && (index === 0 || value >= frameTimesMs[index - 1])),
  'WebM video frame timeline is negative, non-finite, or non-monotonic.');
  let observedMaximumInterFrameGapMs = 0;
  for (let index = 1; index < frameTimesMs.length; index += 1) {
    observedMaximumInterFrameGapMs = Math.max(
      observedMaximumInterFrameGapMs,
      frameTimesMs[index] - frameTimesMs[index - 1],
    );
  }
  required(observedMaximumInterFrameGapMs <= allowedMaximumInterFrameGapMs,
    `WebM has a ${observedMaximumInterFrameGapMs.toFixed(1)} ms frame gap; `
      + `${allowedMaximumInterFrameGapMs.toFixed(1)} ms is the raw-derived limit.`);
  const durationMs = frameTimesMs.at(-1) - frameTimesMs[0];
  required(durationMs >= minimumDurationMs,
    `WebM video spans only ${durationMs.toFixed(1)} ms; ${minimumDurationMs} ms required.`);
  const averagePresentedFps = (blocks.length - 1) * 1000 / durationMs;
  required(averagePresentedFps >= 5 && averagePresentedFps <= 240,
    `WebM average frame rate ${averagePresentedFps.toFixed(3)} is implausible for gameplay.`);
  const encodedBytes = blocks.reduce((sum, block) => sum + block.payloadEnd - block.payloadStart, 0);
  required(encodedBytes >= minimumEncodedBytes,
    `WebM video contains only ${encodedBytes} encoded bytes; ${minimumEncodedBytes} required.`);

  const hashes = new Set();
  const entropyParts = [];
  let entropyBytes = 0;
  let recognizableFrames = 0;
  let codecKeyframes = 0;
  let keyframeDimensionsMatch = 0;
  for (const block of blocks) {
    const frame = buffer.subarray(block.payloadStart, block.payloadEnd);
    hashes.add(createHash('sha256').update(frame).digest('hex'));
    const marker = codecMarkerEvidence(videoTrack.codecId, frame);
    if (marker.recognizable) recognizableFrames += 1;
    if (marker.keyframe === true) codecKeyframes += 1;
    if (marker.keyframe === true
      && marker.width === videoTrack.width && marker.height === videoTrack.height) {
      keyframeDimensionsMatch += 1;
    }
    if (entropyBytes < 1024 * 1024) {
      const slice = frame.subarray(0, Math.min(frame.length, 1024 * 1024 - entropyBytes));
      entropyParts.push(slice);
      entropyBytes += slice.length;
    }
  }
  required(hashes.size >= minimumUniqueFrames,
    `WebM video contains only ${hashes.size} unique encoded frames; ${minimumUniqueFrames} required.`);
  required(recognizableFrames >= Math.ceil(blocks.length * 0.9),
    'WebM frame payloads do not match the declared video codec framing.');
  if (videoTrack.codecId === 'V_VP8') {
    required(codecKeyframes >= 1, 'VP8 WebM has no recognizable encoded keyframe.');
    required(keyframeDimensionsMatch >= 1,
      'VP8 keyframe dimensions do not match the declared video track.');
  }
  const entropy = shannonEntropy(Buffer.concat(entropyParts));
  required(entropy >= minimumEntropyBitsPerByte,
    `WebM encoded payload entropy ${entropy.toFixed(3)} is too low for captured gameplay.`);

  const declaredDurationMs = Number.isFinite(declaredDurationTicks)
    ? declaredDurationTicks * timecodeScaleNs / 1_000_000 : null;
  if (declaredDurationMs != null) {
    required(declaredDurationMs + 1_000 >= durationMs,
      'WebM declared duration is shorter than its parsed frame timeline.');
  }
  return {
    format: 'webm',
    bytes: stat.size,
    codecId: videoTrack.codecId,
    width: videoTrack.width,
    height: videoTrack.height,
    clusterCount: clusters.length,
    videoFrameCount: blocks.length,
    uniqueEncodedFrameCount: hashes.size,
    encodedVideoBytes: encodedBytes,
    durationMs: +durationMs.toFixed(3),
    maximumInterFrameGapMs: +observedMaximumInterFrameGapMs.toFixed(3),
    maximumAllowedInterFrameGapMs: +allowedMaximumInterFrameGapMs.toFixed(3),
    averagePresentedFps: +averagePresentedFps.toFixed(3),
    declaredDurationMs: declaredDurationMs == null ? null : +declaredDurationMs.toFixed(3),
    codecRecognizableFrameCount: recognizableFrames,
    codecKeyframeCount: codecKeyframes,
    keyframeDimensionsMatchCount: keyframeDimensionsMatch,
    sampledPayloadEntropyBitsPerByte: +entropy.toFixed(4),
    structuredMediaDataPresent: true,
  };
}
