import { isDeepStrictEqual } from 'node:util';

export const GOAL24_DOOR_ROUTE_SCHEMA = 'goal24-door-route-camera-v2';
export const GOAL24_DOOR_RENDER_SCHEMA = 'goal24-doorway-render-evidence-v2';
export const GOAL24_DOOR_AGGREGATE_SCHEMA = 'goal24-door-evidence-aggregate-v1';

export const GOAL24_DOOR_SCENARIOS = Object.freeze([
  'doorApproach',
  'doorCrossingOutsideToInside',
  'doorCrossingInsideToOutside',
]);

// Movement is sampled every 100 ms and the shipping walk speed is 3.4 yd/s.
// The finish/path allowance is therefore one polling step (0.34 yd) plus 0.06 yd
// for the threshold comparison. Lens values are configuration values and remain
// much tighter; quaternion distance is an angular distance in radians.
export const GOAL24_DOOR_ROUTE_TOLERANCES = Object.freeze({
  stagedStartPositionYards: 0.02,
  targetAndNormalYards: 0.001,
  finishPositionYards: 0.4,
  cameraPositionYards: 0.45,
  cameraQuaternionRadians: 0.035,
  fovDegrees: 0.01,
  aspect: 0.000001,
  resampledPathPositionYards: 0.4,
  pathLengthYards: 0.5,
});

export const GOAL24_DOOR_DRAW_TOLERANCES = Object.freeze({
  relative: 0.02,
  drawCallsAbsolute: 2,
  renderedTrianglesAbsolute: 1000,
});

const FRAME_BOUNDARY_SOURCE = 'shipping-scene3d.render-wrapper';
const COUNTER_SOURCE = 'THREE.WebGLRenderer.info.render-after-shipping-composed-frame';
const SHADOW_SOURCE = 'scene3d.post.stats().shadowBakes';
const COMPOSED_RENDER_SOURCE = 'scene3d.post.stats().composedRenders';
const EPSILON_MS = 0.05;
const RENDER_PROVENANCE = Object.freeze({
  boundarySource: FRAME_BOUNDARY_SOURCE,
  counterSource: COUNTER_SOURCE,
  shadowClassificationSource: SHADOW_SOURCE,
  composedRenderSource: COMPOSED_RENDER_SOURCE,
  counterReadPhase: 'after-complete-shipping-scene3d-render-return',
  firstFramePolicy: 'retained-raw-excluded-from-matched-statistic',
  shadowBakePolicy: 'classified-retained-raw-excluded-from-matched-and-peak-statistics',
});

function invariant(value, message) {
  if (!value) throw new TypeError(message);
}

function finite(value) {
  return Number.isFinite(value);
}

function finiteFields(value, fields) {
  return value && fields.every((field) => finite(value[field]));
}

function distance2d(left, right) {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function distance3d(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function quaternionAngle(left, right) {
  const dot = Math.abs(
    left.qx * right.qx + left.qy * right.qy + left.qz * right.qz + left.qw * right.qw,
  );
  return 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
}

function pathLength(samples) {
  let result = 0;
  for (let index = 1; index < samples.length; index += 1) {
    result += distance2d(samples[index - 1], samples[index]);
  }
  return result;
}

function samplePathAtFraction(samples, fraction) {
  if (fraction <= 0) return samples[0];
  if (fraction >= 1) return samples.at(-1);
  const total = pathLength(samples);
  if (total === 0) return samples[0];
  const wanted = total * fraction;
  let traversed = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const segment = distance2d(samples[index - 1], samples[index]);
    if (traversed + segment >= wanted) {
      const alpha = segment > 0 ? (wanted - traversed) / segment : 0;
      return {
        x: samples[index - 1].x + (samples[index].x - samples[index - 1].x) * alpha,
        z: samples[index - 1].z + (samples[index].z - samples[index - 1].z) * alpha,
      };
    }
    traversed += segment;
  }
  return samples.at(-1);
}

function validateCamera(camera, label) {
  invariant(finiteFields(camera, ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'fov', 'aspect']),
    `${label} camera position/quaternion/FOV/aspect is incomplete.`);
  invariant(camera.fov > 0 && camera.fov < 180, `${label} camera FOV is invalid.`);
  invariant(camera.aspect > 0, `${label} camera aspect is invalid.`);
  const norm = Math.hypot(camera.qx, camera.qy, camera.qz, camera.qw);
  invariant(Math.abs(norm - 1) <= 0.002, `${label} camera quaternion is not normalized.`);
}

export function validateGoal24DoorRouteSignature(signature, label = 'door route') {
  invariant(signature?.schema === GOAL24_DOOR_ROUTE_SCHEMA,
    `${label} has no ${GOAL24_DOOR_ROUTE_SCHEMA} route evidence.`);
  invariant(finiteFields(signature.startPose, ['x', 'z', 'yaw', 'pitch']),
    `${label} start walk pose is incomplete.`);
  invariant(finiteFields(signature.target, ['x', 'z'])
    && finiteFields(signature.normal, ['x', 'z']), `${label} target/normal is incomplete.`);
  invariant(finiteFields(signature.finishPosition, ['x', 'z']),
    `${label} finish position is incomplete.`);
  validateCamera(signature.startCameraPose, `${label} start`);
  validateCamera(signature.finishCameraPose, `${label} finish`);
  invariant(Array.isArray(signature.pathSamples) && signature.pathSamples.length >= 2,
    `${label} requires at least two ordered spatial path samples.`);
  signature.pathSamples.forEach((sample, index) => {
    invariant(sample?.ordinal === index + 1
      && finiteFields(sample, ['atMs', 'x', 'z', 'distanceToDoor'])
      && typeof sample.inside === 'boolean', `${label} path sample ${index + 1} is incomplete.`);
    if (index > 0) {
      invariant(sample.atMs >= signature.pathSamples[index - 1].atMs,
        `${label} path sample timestamps are not ordered.`);
    }
  });
  const first = signature.pathSamples[0];
  const last = signature.pathSamples.at(-1);
  invariant(distance2d(first, signature.startPose) <= 0.001,
    `${label} path does not begin at the recorded start position.`);
  invariant(distance2d(last, signature.finishPosition) <= 0.001,
    `${label} path does not finish at the recorded finish position.`);
  invariant(pathLength(signature.pathSamples) > 0.25,
    `${label} spatial path does not prove movement.`);
  return signature;
}

export function compareGoal24DoorRoutes(reference, candidate, options = {}) {
  const tolerances = { ...GOAL24_DOOR_ROUTE_TOLERANCES, ...(options.tolerances || {}) };
  validateGoal24DoorRouteSignature(reference, options.referenceLabel || 'reference door route');
  validateGoal24DoorRouteSignature(candidate, options.candidateLabel || 'candidate door route');
  const rows = [];
  const row = (metric, before, after, tolerance) => {
    const delta = Math.abs(after - before);
    rows.push({ metric, before, after, absoluteDelta: delta, tolerance, pass: delta <= tolerance });
  };
  row('startPositionYards', 0, distance2d(reference.startPose, candidate.startPose),
    tolerances.stagedStartPositionYards);
  row('startYawRadians', reference.startPose.yaw, candidate.startPose.yaw,
    tolerances.cameraQuaternionRadians);
  row('startPitchRadians', reference.startPose.pitch, candidate.startPose.pitch,
    tolerances.cameraQuaternionRadians);
  row('targetPositionYards', 0, distance2d(reference.target, candidate.target),
    tolerances.targetAndNormalYards);
  row('normalVectorDistance', 0, distance2d(reference.normal, candidate.normal),
    tolerances.targetAndNormalYards);
  row('finishPositionYards', 0, distance2d(reference.finishPosition, candidate.finishPosition),
    tolerances.finishPositionYards);
  for (const phase of ['start', 'finish']) {
    const before = reference[`${phase}CameraPose`];
    const after = candidate[`${phase}CameraPose`];
    row(`${phase}CameraPositionYards`, 0, distance3d(before, after), tolerances.cameraPositionYards);
    row(`${phase}CameraQuaternionRadians`, 0, quaternionAngle(before, after),
      tolerances.cameraQuaternionRadians);
    row(`${phase}CameraFovDegrees`, before.fov, after.fov, tolerances.fovDegrees);
    row(`${phase}CameraAspect`, before.aspect, after.aspect, tolerances.aspect);
  }
  row('pathLengthYards', pathLength(reference.pathSamples), pathLength(candidate.pathSamples),
    tolerances.pathLengthYards);
  for (const fraction of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
    row(`pathPositionYards@${fraction.toFixed(1)}`, 0, distance2d(
      samplePathAtFraction(reference.pathSamples, fraction),
      samplePathAtFraction(candidate.pathSamples, fraction),
    ), tolerances.resampledPathPositionYards);
  }
  return { tolerances, rows, ok: rows.every(({ pass }) => pass) };
}

function lowerMedian(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor((ordered.length - 1) / 2)];
}

function classifyFrame(sample, index, label) {
  invariant(sample?.ordinal === index + 1
    && finiteFields(sample, [
      'productionRenderStartedAtMs', 'productionRenderEndedAtMs',
      'rendererFrameBefore', 'rendererFrameAfter', 'calls', 'triangles',
      'shadowBakesBefore', 'shadowBakesAfter', 'shadowBakeDelta',
      'composedRendersBefore', 'composedRendersAfter', 'composedRenderDelta',
    ]), `${label} renderer frame ${index + 1} is incomplete.`);
  invariant(sample.productionRenderEndedAtMs >= sample.productionRenderStartedAtMs,
    `${label} renderer frame ${index + 1} has reversed boundaries.`);
  invariant(Number.isInteger(sample.rendererFrameBefore)
    && Number.isInteger(sample.rendererFrameAfter)
    && sample.rendererFrameAfter > sample.rendererFrameBefore,
  `${label} renderer frame ${index + 1} did not advance the renderer frame counter.`);
  invariant(Number.isInteger(sample.calls) && sample.calls >= 0
    && Number.isInteger(sample.triangles) && sample.triangles >= 0,
  `${label} renderer frame ${index + 1} calls/triangles are invalid.`);
  invariant(sample.rendererInfoAutoReset === false,
    `${label} renderer frame ${index + 1} was not an accumulated composed-frame sample.`);
  invariant(Number.isInteger(sample.shadowBakesBefore) && Number.isInteger(sample.shadowBakesAfter)
    && sample.shadowBakesAfter >= sample.shadowBakesBefore
    && sample.shadowBakeDelta === sample.shadowBakesAfter - sample.shadowBakesBefore,
  `${label} renderer frame ${index + 1} shadow-bake classification is unavailable or invalid.`);
  invariant(Number.isInteger(sample.composedRendersBefore)
    && Number.isInteger(sample.composedRendersAfter)
    && sample.composedRendersAfter === sample.composedRendersBefore + 1
    && sample.composedRenderDelta === 1,
  `${label} renderer frame ${index + 1} is not one exact shipping composed render.`);
  const expectedClass = sample.shadowBakeDelta > 0 ? 'shadow-bake' : 'non-shadow';
  invariant(sample.frameClass === expectedClass,
    `${label} renderer frame ${index + 1} shadow-bake class is incorrect.`);
  invariant(sample.boundarySource === FRAME_BOUNDARY_SOURCE
    && sample.counterSource === COUNTER_SOURCE
    && sample.shadowClassificationSource === SHADOW_SOURCE
    && sample.composedRenderSource === COMPOSED_RENDER_SOURCE,
  `${label} renderer frame ${index + 1} provenance is missing or drifted.`);
}

function classifyFrameSequence(frameSamples, label) {
  frameSamples.forEach((sample, index) => {
    classifyFrame(sample, index, label);
    if (index > 0) {
      invariant(sample.productionRenderStartedAtMs
        >= frameSamples[index - 1].productionRenderEndedAtMs,
      `${label} renderer frame ${index + 1} overlaps or reverses the preceding frame.`);
      invariant(sample.rendererFrameBefore === frameSamples[index - 1].rendererFrameAfter,
        `${label} renderer frame ${index + 1} is not contiguous with the renderer frame counter.`);
      invariant(sample.composedRendersBefore === frameSamples[index - 1].composedRendersAfter,
        `${label} renderer frame ${index + 1} is not contiguous with the shipping composed-render counter.`);
    }
  });
}

function renderStatistics(frameSamples) {
  const nonShadow = frameSamples.filter(({ frameClass }) => frameClass === 'non-shadow');
  // The first post-arm frame is retained as raw evidence but excluded from the
  // matched statistic. It can still carry one-time visibility/upload work that
  // occurred between recorder arming and the trusted movement input.
  const eligible = nonShadow.filter(({ ordinal }) => ordinal > 1);
  invariant(eligible.length >= 2,
    'Doorway render evidence requires at least two post-first-frame non-shadow samples.');
  const matchedSample = [...eligible].sort((left, right) => (
    left.calls - right.calls
    || left.triangles - right.triangles
    || left.ordinal - right.ordinal
  ))[Math.floor((eligible.length - 1) / 2)];
  return {
    observedFrameCount: frameSamples.length,
    nonShadowFrameCount: nonShadow.length,
    shadowBakeFrameCount: frameSamples.length - nonShadow.length,
    matchedEligibleFrameCount: eligible.length,
    firstMeasuredFrameExcludedFromMatchedStatistic: true,
    matched: {
      statistic: 'lower-median-post-first-non-shadow-frame',
      calls: matchedSample.calls,
      triangles: matchedSample.triangles,
      sampleOrdinal: matchedSample.ordinal,
    },
    peak: {
      scope: 'all-non-shadow-frames-including-first',
      calls: Math.max(...nonShadow.map(({ calls }) => calls)),
      triangles: Math.max(...nonShadow.map(({ triangles }) => triangles)),
    },
  };
}

export function summarizeGoal24DoorwayRenderEvidence(rawWindow, label = 'door interaction') {
  const frameSamples = structuredClone(rawWindow?.renderFrameEvidence || []);
  const cadence = rawWindow?.renderCadenceIntervals;
  invariant(Array.isArray(cadence) && cadence.length === frameSamples.length,
    `${label} renderer samples are not keyed one-for-one to exact render cadence.`);
  classifyFrameSequence(frameSamples, label);
  frameSamples.forEach((sample, index) => {
    invariant(Math.abs(sample.productionRenderStartedAtMs - cadence[index].endAtMs) <= EPSILON_MS,
      `${label} renderer frame ${index + 1} is not bound to its exact cadence endpoint.`);
  });
  return {
    schema: GOAL24_DOOR_RENDER_SCHEMA,
    provenance: { ...RENDER_PROVENANCE },
    frameSamples,
    statistics: renderStatistics(frameSamples),
  };
}

export function validateGoal24DoorwayRenderEvidenceStructure(
  evidence,
  label = 'door interaction',
) {
  invariant(evidence?.schema === GOAL24_DOOR_RENDER_SCHEMA,
    `${label} doorway renderer evidence schema is missing.`);
  invariant(isDeepStrictEqual(evidence.provenance, { ...RENDER_PROVENANCE }),
    `${label} doorway renderer provenance is missing or drifted.`);
  invariant(Array.isArray(evidence.frameSamples),
    `${label} doorway renderer raw frame samples are missing.`);
  classifyFrameSequence(evidence.frameSamples, label);
  invariant(isDeepStrictEqual(evidence.statistics, renderStatistics(evidence.frameSamples)),
    `${label} doorway renderer peak/matched statistics are not derived from raw frames.`);
  return evidence;
}

export function validateGoal24DoorwayRenderEvidence(evidence, rawWindow, label = 'door interaction') {
  validateGoal24DoorwayRenderEvidenceStructure(evidence, label);
  const expected = summarizeGoal24DoorwayRenderEvidence({
    renderFrameEvidence: rawWindow?.renderFrameEvidence,
    renderCadenceIntervals: rawWindow?.renderCadenceIntervals,
  }, label);
  invariant(isDeepStrictEqual(evidence, expected),
    `${label} doorway renderer evidence is not an exact projection of raw cadence/counters.`);
  return evidence;
}

function scenarioEvents(source, scenarioId) {
  return source.contribution?.scenarios?.find(({ id }) => id === scenarioId)?.events || [];
}

export function validateGoal24DoorCohort(sources, { requiredProcessCount = 7 } = {}) {
  invariant(Array.isArray(sources) && sources.length === requiredProcessCount,
    `Door route/render parity requires exactly ${requiredProcessCount} cold process sources.`);
  invariant(new Set(sources.map(({ run }) => run?.id)).size === requiredProcessCount,
    'Door route/render parity requires distinct cold process IDs.');
  for (const scenarioId of GOAL24_DOOR_SCENARIOS) {
    let crossProcessReference = null;
    for (const source of sources) {
      const runId = source.run?.id || '(unknown run)';
      const events = scenarioEvents(source, scenarioId);
      invariant(events.length > 0, `${runId}: ${scenarioId} route evidence is missing.`);
      for (const [index, event] of events.entries()) {
        validateGoal24DoorRouteSignature(
          event?.discriminator?.routeSignature,
          `${runId}: ${scenarioId} event ${index + 1}`,
        );
        invariant(event?.doorwayRenderEvidence?.schema === GOAL24_DOOR_RENDER_SCHEMA,
          `${runId}: ${scenarioId} event ${index + 1} doorway renderer evidence is missing.`);
        validateGoal24DoorwayRenderEvidenceStructure(
          event.doorwayRenderEvidence,
          `${runId}: ${scenarioId} event ${index + 1}`,
        );
      }
      const localReference = events[0].discriminator.routeSignature;
      for (const event of events.slice(1)) {
        const comparison = compareGoal24DoorRoutes(localReference, event.discriminator.routeSignature);
        invariant(comparison.ok,
          `${runId}: ${scenarioId} warmed route/camera start drifted or finish/lens/path outcome drifted.`);
      }
      if (!crossProcessReference) crossProcessReference = localReference;
      const comparison = compareGoal24DoorRoutes(
        crossProcessReference,
        localReference,
      );
      invariant(comparison.ok,
        `${runId}: ${scenarioId} route/camera outcome drifted across cold processes.`);
    }
  }
  return true;
}

function summarizedRenderValues(events) {
  const matchedCalls = events.map(({ renderEvidence }) => renderEvidence.statistics.matched.calls);
  const matchedTriangles = events.map(({ renderEvidence }) => renderEvidence.statistics.matched.triangles);
  const peakCalls = events.map(({ renderEvidence }) => renderEvidence.statistics.peak.calls);
  const peakTriangles = events.map(({ renderEvidence }) => renderEvidence.statistics.peak.triangles);
  return {
    eventCount: events.length,
    rawFrameCount: events.reduce((sum, event) => (
      sum + event.renderEvidence.statistics.observedFrameCount
    ), 0),
    matchedDrawCalls: lowerMedian(matchedCalls),
    matchedRenderedTriangles: lowerMedian(matchedTriangles),
    peakDrawCalls: Math.max(...peakCalls),
    peakRenderedTriangles: Math.max(...peakTriangles),
  };
}

function aggregateEntries(entries) {
  const byScenario = {};
  for (const scenarioId of GOAL24_DOOR_SCENARIOS) {
    const scenarioEntries = entries.filter((entry) => entry.scenarioId === scenarioId);
    const processIds = [...new Set(scenarioEntries.map(({ runId }) => runId))];
    byScenario[scenarioId] = {
      ...summarizedRenderValues(scenarioEntries),
      coldEventCount: scenarioEntries.filter(({ temperature }) => temperature === 'cold').length,
      warmEventCount: scenarioEntries.filter(({ temperature }) => temperature === 'warm').length,
      perProcess: processIds.map((runId) => ({
        runId,
        runOrdinal: scenarioEntries.find((entry) => entry.runId === runId)?.runOrdinal ?? null,
        ...summarizedRenderValues(scenarioEntries.filter((entry) => entry.runId === runId)),
      })).sort((left, right) => left.runOrdinal - right.runOrdinal),
    };
  }
  return byScenario;
}

export function aggregateGoal24DoorEvidence(sources, { requiredProcessCount = 7 } = {}) {
  validateGoal24DoorCohort(sources, { requiredProcessCount });
  const entries = [];
  for (const source of sources) {
    for (const scenarioId of GOAL24_DOOR_SCENARIOS) {
      for (const event of scenarioEvents(source, scenarioId)) {
        entries.push({
          runId: source.run.id,
          runOrdinal: source.run.ordinal,
          scenarioId,
          sequence: event.sequence,
          temperature: event.temperature,
          rawSource: structuredClone(event.rawSource),
          routeSignature: structuredClone(event.discriminator.routeSignature),
          renderEvidence: structuredClone(event.doorwayRenderEvidence),
        });
      }
    }
  }
  return {
    schema: GOAL24_DOOR_AGGREGATE_SCHEMA,
    requiredColdProcessCount: requiredProcessCount,
    sourceProcessCount: sources.length,
    routeTolerances: { ...GOAL24_DOOR_ROUTE_TOLERANCES },
    drawRegressionTolerances: { ...GOAL24_DOOR_DRAW_TOLERANCES },
    entries,
    byScenario: aggregateEntries(entries),
  };
}

export function validateGoal24DoorEvidenceAggregate(aggregate) {
  invariant(aggregate?.schema === GOAL24_DOOR_AGGREGATE_SCHEMA,
    'Goal 24 door aggregate schema is missing.');
  invariant(Number.isInteger(aggregate.requiredColdProcessCount)
    && aggregate.requiredColdProcessCount === 7
    && aggregate.sourceProcessCount === aggregate.requiredColdProcessCount,
  'Goal 24 door aggregate requires all seven cold processes.');
  invariant(isDeepStrictEqual(aggregate.routeTolerances, { ...GOAL24_DOOR_ROUTE_TOLERANCES })
    && isDeepStrictEqual(aggregate.drawRegressionTolerances, { ...GOAL24_DOOR_DRAW_TOLERANCES }),
  'Goal 24 door aggregate tolerance provenance drifted.');
  invariant(Array.isArray(aggregate.entries) && aggregate.entries.length > 0,
    'Goal 24 door aggregate entries are missing.');
  const processIds = new Set(aggregate.entries.map(({ runId }) => runId));
  invariant(processIds.size === 7, 'Goal 24 door aggregate does not contain seven source processes.');
  for (const scenarioId of GOAL24_DOOR_SCENARIOS) {
    const entries = aggregate.entries.filter((entry) => entry.scenarioId === scenarioId);
    invariant(new Set(entries.map(({ runId }) => runId)).size === 7,
      `${scenarioId} aggregate does not cover all seven cold processes.`);
    const reference = entries[0]?.routeSignature;
    for (const [index, entry] of entries.entries()) {
      validateGoal24DoorRouteSignature(entry.routeSignature, `${scenarioId} aggregate event ${index + 1}`);
      invariant(entry.renderEvidence?.schema === GOAL24_DOOR_RENDER_SCHEMA,
        `${scenarioId} aggregate event ${index + 1} renderer evidence is missing.`);
      validateGoal24DoorwayRenderEvidenceStructure(
        entry.renderEvidence,
        `${scenarioId} aggregate event ${index + 1}`,
      );
      invariant(compareGoal24DoorRoutes(reference, entry.routeSignature).ok,
        `${scenarioId} aggregate route/camera outcome parity failed.`);
    }
  }
  invariant(isDeepStrictEqual(aggregate.byScenario, aggregateEntries(aggregate.entries)),
    'Goal 24 door aggregate peak/matched statistics are not derived from its exact events.');
  return aggregate;
}

function drawTolerance(metric, reference, tolerances) {
  const absolute = metric.includes('Triangles')
    ? tolerances.renderedTrianglesAbsolute : tolerances.drawCallsAbsolute;
  return Math.max(absolute, Math.ceil(reference * tolerances.relative));
}

export function compareGoal24DoorEvidenceAggregates(reference, candidate) {
  validateGoal24DoorEvidenceAggregate(reference);
  validateGoal24DoorEvidenceAggregate(candidate);
  const routeRows = [];
  const drawRows = [];
  for (const scenarioId of GOAL24_DOOR_SCENARIOS) {
    const beforeEntries = reference.entries.filter((entry) => entry.scenarioId === scenarioId);
    const afterEntries = candidate.entries.filter((entry) => entry.scenarioId === scenarioId);
    invariant(beforeEntries.length === afterEntries.length,
      `${scenarioId} baseline/candidate door event counts differ.`);
    for (let index = 0; index < beforeEntries.length; index += 1) {
      const routeComparison = compareGoal24DoorRoutes(
        beforeEntries[index].routeSignature,
        afterEntries[index].routeSignature,
      );
      routeRows.push({
        scenarioId,
        eventOrdinal: index + 1,
        referenceRunOrdinal: beforeEntries[index].runOrdinal,
        candidateRunOrdinal: afterEntries[index].runOrdinal,
        temperature: afterEntries[index].temperature,
        ...routeComparison,
        ok: routeComparison.ok,
      });
    }
    const addDrawRows = (scope, before, after) => {
      for (const metric of [
        'matchedDrawCalls', 'peakDrawCalls',
        'matchedRenderedTriangles', 'peakRenderedTriangles',
      ]) {
        const tolerance = drawTolerance(metric, before[metric], reference.drawRegressionTolerances);
        const delta = after[metric] - before[metric];
        drawRows.push({
          scenarioId,
          scope,
          metric,
          before: before[metric],
          after: after[metric],
          absoluteDelta: delta,
          tolerance,
          pass: delta <= tolerance,
        });
      }
    };
    addDrawRows('aggregate', reference.byScenario[scenarioId], candidate.byScenario[scenarioId]);
    const beforeProcesses = reference.byScenario[scenarioId].perProcess;
    const afterProcesses = candidate.byScenario[scenarioId].perProcess;
    invariant(beforeProcesses.length === 7 && afterProcesses.length === 7,
      `${scenarioId} baseline/candidate per-process renderer coverage is incomplete.`);
    for (let index = 0; index < 7; index += 1) {
      addDrawRows(`cold-process-${index + 1}`, beforeProcesses[index], afterProcesses[index]);
    }
  }
  return {
    routeTolerances: { ...GOAL24_DOOR_ROUTE_TOLERANCES },
    drawRegressionTolerances: { ...GOAL24_DOOR_DRAW_TOLERANCES },
    routeRows,
    drawRows,
    routeParityPass: routeRows.every(({ ok }) => ok),
    doorwayDrawRegressionPass: drawRows.every(({ pass }) => pass),
    ok: routeRows.every(({ ok }) => ok) && drawRows.every(({ pass }) => pass),
  };
}
