import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOAL24_DOOR_RENDER_SCHEMA,
  GOAL24_DOOR_ROUTE_SCHEMA,
  GOAL24_DOOR_SCENARIOS,
  aggregateGoal24DoorEvidence,
  compareGoal24DoorEvidenceAggregates,
  compareGoal24DoorRoutes,
  summarizeGoal24DoorwayRenderEvidence,
  validateGoal24DoorCohort,
  validateGoal24DoorEvidenceAggregate,
  validateGoal24DoorwayRenderEvidence,
} from '../tools/qa/lib/goal24-door-evidence.mjs';

const camera = (z, overrides = {}) => ({
  x: 40, y: 1.7, z,
  qx: 0, qy: 1, qz: 0, qw: 0,
  fov: 60, aspect: 16 / 9,
  ...overrides,
});

function route({ side = 'outside', distance = 6.5, finishZ = 21.7 } = {}) {
  const startZ = side === 'outside' ? 20 + distance : 20 - distance;
  const points = Array.from({ length: 8 }, (_, index) => {
    const alpha = index / 7;
    const z = startZ + (finishZ - startZ) * alpha;
    return {
      ordinal: index + 1,
      atMs: 100 + index * 100,
      x: 40,
      z,
      distanceToDoor: Math.abs(z - 20),
      inside: z < 20,
    };
  });
  return {
    schema: GOAL24_DOOR_ROUTE_SCHEMA,
    startPose: { x: 40, z: startZ, yaw: side === 'outside' ? Math.PI : 0, pitch: -0.05 },
    target: { x: 40, z: 20 },
    normal: { x: 0, z: 1 },
    startCameraPose: camera(startZ),
    finishPosition: { x: 40, z: finishZ },
    finishCameraPose: camera(finishZ),
    pathSamples: points,
  };
}

function rawWindow({ calls = [900, 120, 124, 122], triangles = [900_000, 250_000, 252_000, 251_000] } = {}) {
  const starts = [106, 112, 118, 124];
  const renderCadenceIntervals = starts.map((endAtMs) => ({
    startAtMs: endAtMs - 6, endAtMs, durationMs: 6,
  }));
  return {
    renderCadenceIntervals,
    renderFrameEvidence: starts.map((productionRenderStartedAtMs, index) => ({
      ordinal: index + 1,
      productionRenderStartedAtMs,
      productionRenderEndedAtMs: productionRenderStartedAtMs + 2,
      rendererFrameBefore: 10 + index,
      rendererFrameAfter: 11 + index,
      calls: calls[index],
      triangles: triangles[index],
      rendererInfoAutoReset: false,
      shadowBakesBefore: index < 2 ? 4 : 5,
      shadowBakesAfter: index === 1 ? 5 : index < 2 ? 4 : 5,
      shadowBakeDelta: index === 1 ? 1 : 0,
      composedRendersBefore: 30 + index,
      composedRendersAfter: 31 + index,
      composedRenderDelta: 1,
      frameClass: index === 1 ? 'shadow-bake' : 'non-shadow',
      boundarySource: 'shipping-scene3d.render-wrapper',
      counterSource: 'THREE.WebGLRenderer.info.render-after-shipping-composed-frame',
      shadowClassificationSource: 'scene3d.post.stats().shadowBakes',
      composedRenderSource: 'scene3d.post.stats().composedRenders',
    })),
  };
}

function renderEvidence(options) {
  const raw = rawWindow(options);
  return { raw, evidence: summarizeGoal24DoorwayRenderEvidence(raw) };
}

function source(runIndex) {
  return {
    run: { id: `cold-${runIndex}`, ordinal: runIndex },
    contribution: {
      scenarios: GOAL24_DOOR_SCENARIOS.map((id) => {
        const spec = id === 'doorApproach'
          ? { distance: 6.5, finishZ: 21.7 }
          : id === 'doorCrossingOutsideToInside'
            ? { distance: 1.35, finishZ: 18.3 }
            : { side: 'inside', distance: 1.35, finishZ: 21.7 };
        const temperatures = id === 'doorCrossingInsideToOutside'
          ? ['warm', 'warm', 'warm'] : ['cold', 'warm', 'warm', 'warm'];
        return {
          id,
          events: temperatures.map((temperature, index) => ({
            sequence: index + 1,
            temperature,
            rawSource: { scenario: id, id: `${id}-${index + 1}`, eventIndex: index },
            discriminator: { routeSignature: route(spec) },
            doorwayRenderEvidence: renderEvidence().evidence,
          })),
        };
      }),
    },
  };
}

test('doorway draw evidence is exact-cadence, shadow-classified, and retains first frame in peak', () => {
  const { raw, evidence } = renderEvidence();
  assert.equal(evidence.schema, GOAL24_DOOR_RENDER_SCHEMA);
  assert.equal(evidence.statistics.matched.calls, 122);
  assert.equal(evidence.statistics.matched.triangles, 251_000);
  assert.equal(evidence.statistics.matched.sampleOrdinal, 4);
  assert.equal(evidence.statistics.peak.calls, 900);
  assert.equal(evidence.statistics.peak.triangles, 900_000);
  assert.equal(evidence.statistics.peak.scope, 'all-non-shadow-frames-including-first');
  assert.equal(validateGoal24DoorwayRenderEvidence(evidence, raw), evidence);

  const driftedCadence = structuredClone(raw);
  driftedCadence.renderCadenceIntervals[2].endAtMs += 1;
  assert.throws(
    () => summarizeGoal24DoorwayRenderEvidence(driftedCadence),
    /exact cadence endpoint/,
  );
  const missingShadow = structuredClone(raw);
  missingShadow.renderFrameEvidence[2].shadowBakesAfter = null;
  assert.throws(
    () => summarizeGoal24DoorwayRenderEvidence(missingShadow),
    /incomplete|shadow-bake classification/,
  );
});

test('route comparison rejects finish, camera quaternion, FOV, aspect, and path drift', () => {
  const baseline = route();
  assert.equal(compareGoal24DoorRoutes(baseline, structuredClone(baseline)).ok, true);
  for (const mutate of [
    (candidate) => { candidate.finishPosition.x += 0.5; candidate.pathSamples.at(-1).x += 0.5; },
    (candidate) => {
      candidate.finishCameraPose.qy = Math.cos(0.05);
      candidate.finishCameraPose.qw = Math.sin(0.05);
    },
    (candidate) => { candidate.finishCameraPose.fov += 0.1; },
    (candidate) => { candidate.finishCameraPose.aspect += 0.01; },
    (candidate) => { candidate.pathSamples[4].x += 0.6; },
  ]) {
    const candidate = structuredClone(baseline);
    mutate(candidate);
    assert.equal(compareGoal24DoorRoutes(baseline, candidate).ok, false);
  }
});

test('seven-process cohort and aggregate fail closed on warm/cold route and doorway draw drift', () => {
  const sources = Array.from({ length: 7 }, (_, index) => source(index + 1));
  assert.equal(validateGoal24DoorCohort(sources), true);
  const baseline = aggregateGoal24DoorEvidence(sources);
  assert.equal(validateGoal24DoorEvidenceAggregate(baseline), baseline);

  const warmDrift = structuredClone(sources);
  warmDrift[0].contribution.scenarios[0].events[1].discriminator
    .routeSignature.finishCameraPose.fov += 1;
  assert.throws(() => validateGoal24DoorCohort(warmDrift), /finish\/lens\/path outcome drifted/);

  const processDrift = structuredClone(sources);
  for (const event of processDrift[6].contribution.scenarios[1].events) {
    event.discriminator.routeSignature.finishCameraPose.aspect += 0.1;
  }
  assert.throws(() => validateGoal24DoorCohort(processDrift), /across cold processes/);

  const coherentCandidateRouteDrift = structuredClone(sources);
  for (const sourceEntry of coherentCandidateRouteDrift) {
    for (const event of sourceEntry.contribution.scenarios[0].events) {
      event.discriminator.routeSignature.startCameraPose.fov += 0.1;
      event.discriminator.routeSignature.finishCameraPose.fov += 0.1;
    }
  }
  const routeComparison = compareGoal24DoorEvidenceAggregates(
    baseline,
    aggregateGoal24DoorEvidence(coherentCandidateRouteDrift),
  );
  assert.equal(routeComparison.routeParityPass, false);
  assert.equal(routeComparison.ok, false);

  const candidateSources = structuredClone(sources);
  for (const sourceEntry of candidateSources) {
    for (const event of sourceEntry.contribution.scenarios[1].events) {
      event.doorwayRenderEvidence = renderEvidence({
        calls: [930, 150, 154, 152],
        triangles: [930_000, 280_000, 282_000, 281_000],
      }).evidence;
    }
  }
  const comparison = compareGoal24DoorEvidenceAggregates(
    baseline,
    aggregateGoal24DoorEvidence(candidateSources),
  );
  assert.equal(comparison.ok, false);
  assert.equal(comparison.routeParityPass, true);
  assert.equal(comparison.doorwayDrawRegressionPass, false);
  assert.ok(comparison.drawRows.some(({ metric, pass }) => (
    metric === 'peakRenderedTriangles' && pass === false
  )));
});
