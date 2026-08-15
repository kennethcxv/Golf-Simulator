import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
  GOAL24_DOOR_RENDER_SCHEMA,
  GOAL24_DOOR_ROUTE_SCHEMA,
  GOAL24_DOOR_SCENARIOS,
  aggregateGoal24DoorEvidence,
  compareGoal24DoorEvidenceAggregates,
  compareGoal24DoorRoutes,
  goal24DoorRouteSemanticFailures,
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
  const routeKind = side === 'inside'
    ? 'inside-out'
    : finishZ < 20 ? 'outside-in' : 'approach';
  const startZ = side === 'outside' ? 20 + distance : 20 - distance;
  const startedDetailed = routeKind === 'inside-out';
  const endedDetailed = routeKind === 'outside-in';
  const startSequence = routeKind === 'inside-out' ? 1 : 0;
  const endSequence = routeKind === 'approach' ? startSequence : startSequence + 1;
  const transitionAtMs = routeKind === 'inside-out' ? 850 : 250;
  const points = Array.from({ length: 10 }, (_, index) => {
    const alpha = index / 9;
    const z = startZ + (finishZ - startZ) * alpha;
    const atMs = 100 + index * 100;
    const detailExteriorDistanceYards = z < 20 ? 0 : Math.abs(z - 20);
    const transitioned = routeKind !== 'approach' && atMs >= transitionAtMs;
    return {
      ordinal: index + 1,
      atMs,
      x: 40,
      z,
      distanceToDoor: Math.abs(z - 20),
      detailExteriorDistanceYards,
      detailWithinClearance:
        detailExteriorDistanceYards < GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
      detailedVisible: transitioned ? endedDetailed : startedDetailed,
      detailVisibilitySequence: startSequence + Number(transitioned),
      inside: z < 20,
    };
  });
  const lastDetailVisibilityTransition = routeKind === 'approach' ? null : {
    sequence: endSequence,
    atMs: transitionAtMs,
    from: startedDetailed,
    to: endedDetailed,
    cameraLocalX: 0,
    cameraLocalZ: routeKind === 'outside-in' ? 5.6 : 7.1,
    exteriorDistanceYards: routeKind === 'outside-in' ? 1.45 : 1.55,
    detailClearanceYards: GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
  };
  const priorDetailVisibilityTransition = routeKind === 'inside-out' ? {
    sequence: startSequence,
    atMs: 90,
    from: false,
    to: true,
    cameraLocalX: 0,
    cameraLocalZ: 5.5,
    exteriorDistanceYards: 0,
    detailClearanceYards: GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
  } : null;
  const runtimeSnapshot = (
    capturedAtMs,
    detailedVisible,
    detailVisibilitySequence,
    lastTransition,
  ) => ({
    capturedAtMs,
    runtimeCreatedAtMs: 40,
    runtimeReadyAtMs: 90,
    staticBatchStartedAtMs: 60,
    staticBatchReadyAtMs: 80,
    detailedVisible,
    detailVisibilitySequence,
    lastDetailVisibilityTransition: lastTransition,
  });
  return {
    schema: GOAL24_DOOR_ROUTE_SCHEMA,
    routeKind,
    detailClearanceYards: GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
    startPose: { x: 40, z: startZ, yaw: side === 'outside' ? Math.PI : 0, pitch: -0.05 },
    target: { x: 40, z: 20 },
    normal: { x: 0, z: 1 },
    startCameraPose: camera(startZ),
    finishPosition: { x: 40, z: finishZ },
    finishCameraPose: camera(finishZ),
    pathSamples: points,
    runtimeStart: runtimeSnapshot(
      points[0].atMs,
      startedDetailed,
      startSequence,
      priorDetailVisibilityTransition,
    ),
    runtimeEnd: runtimeSnapshot(
      points.at(-1).atMs,
      endedDetailed,
      endSequence,
      lastDetailVisibilityTransition,
    ),
  };
}

function rawWindow({
  calls = [900, 120, 124, 122],
  triangles = [900_000, 250_000, 252_000, 251_000],
  submissionWallMs = [2, 2, 2, 2],
} = {}) {
  let cursor = 106;
  const starts = submissionWallMs.map((duration) => {
    const start = cursor;
    cursor += duration + 4;
    return start;
  });
  const renderCadenceIntervals = starts.map((endAtMs) => ({
    startAtMs: endAtMs - 6, endAtMs, durationMs: 6,
  }));
  return {
    renderCadenceIntervals,
    renderFrameEvidence: starts.map((productionRenderStartedAtMs, index) => ({
      ordinal: index + 1,
      productionRenderStartedAtMs,
      productionRenderEndedAtMs: productionRenderStartedAtMs + submissionWallMs[index],
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
            ? { distance: 2, finishZ: 18 }
            : { side: 'inside', distance: 2, finishZ: 22 };
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
  assert.equal(evidence.statistics.matched.submissionWallMs, 2);
  assert.equal(evidence.statistics.matched.sampleOrdinal, 4);
  assert.equal(evidence.statistics.peak.calls, 900);
  assert.equal(evidence.statistics.peak.triangles, 900_000);
  assert.equal(evidence.statistics.peak.scope, 'all-non-shadow-frames-including-first');
  assert.equal(evidence.statistics.submissionWall.peakAllFrames.durationMs, 2);
  assert.equal(evidence.statistics.submissionWall.peakNonShadowFrames.durationMs, 2);
  assert.deepEqual(evidence.statistics.submissionWall.framesOver33Ms, {
    allFrames: 0, nonShadowFrames: 0,
  });
  assert.deepEqual(evidence.statistics.submissionWall.framesOver50Ms, {
    allFrames: 0, nonShadowFrames: 0,
  });
  assert.equal(evidence.statistics.submissionWall.expensiveDrawSubmitStillFires, false);
  assert.equal(validateGoal24DoorwayRenderEvidence(evidence, raw), evidence);

  const overBudget = summarizeGoal24DoorwayRenderEvidence(rawWindow({
    submissionWallMs: [40, 2, 2, 2],
  }));
  assert.deepEqual(overBudget.statistics.submissionWall.framesOver33Ms, {
    allFrames: 1, nonShadowFrames: 1,
  });
  assert.deepEqual(overBudget.statistics.submissionWall.framesOver50Ms, {
    allFrames: 0, nonShadowFrames: 0,
  });

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

test('door route semantics fail old inside-gate starts and missing readiness or transition proof', () => {
  const approach = route();
  const inbound = route({ distance: 2, finishZ: 18 });
  const outbound = route({ side: 'inside', distance: 2, finishZ: 22 });
  assert.deepEqual(goal24DoorRouteSemanticFailures(approach, {
    expectedRouteKind: 'approach',
  }), []);
  assert.deepEqual(goal24DoorRouteSemanticFailures(inbound, {
    expectedRouteKind: 'outside-in',
  }), []);
  assert.deepEqual(goal24DoorRouteSemanticFailures(outbound, {
    expectedRouteKind: 'inside-out',
  }), []);

  const oldInsideGateStart = route({ distance: 1.35, finishZ: 18 });
  assert.match(goal24DoorRouteSemanticFailures(oldInsideGateStart).join('\n'),
    /must begin beyond the 1\.5-yard gate/);

  const missingTransition = structuredClone(inbound);
  missingTransition.runtimeEnd.lastDetailVisibilityTransition = null;
  assert.match(goal24DoorRouteSemanticFailures(missingTransition).join('\n'),
    /requires exactly one production visibility transition/);

  const wrongTransition = structuredClone(inbound);
  wrongTransition.runtimeEnd.lastDetailVisibilityTransition.from = true;
  wrongTransition.runtimeEnd.lastDetailVisibilityTransition.to = false;
  assert.match(goal24DoorRouteSemanticFailures(wrongTransition).join('\n'),
    /transition direction is incorrect/);

  const missingReadiness = structuredClone(inbound);
  missingReadiness.runtimeStart.runtimeReadyAtMs = null;
  missingReadiness.runtimeEnd.runtimeReadyAtMs = null;
  assert.match(goal24DoorRouteSemanticFailures(missingReadiness).join('\n'),
    /runtimeReadyAtMs must be finite/);

  const missingCreation = structuredClone(inbound);
  delete missingCreation.runtimeStart.runtimeCreatedAtMs;
  delete missingCreation.runtimeEnd.runtimeCreatedAtMs;
  assert.match(goal24DoorRouteSemanticFailures(missingCreation).join('\n'),
    /runtimeCreatedAtMs must be finite/);

  const lateStaticBatch = structuredClone(inbound);
  lateStaticBatch.runtimeStart.staticBatchReadyAtMs = 101;
  lateStaticBatch.runtimeEnd.staticBatchReadyAtMs = 101;
  assert.match(goal24DoorRouteSemanticFailures(lateStaticBatch).join('\n'),
    /staticBatchReadyAtMs must be finite and no later than the measured route start/);

  const impossibleReadinessOrder = structuredClone(inbound);
  impossibleReadinessOrder.runtimeStart.runtimeReadyAtMs = 70;
  impossibleReadinessOrder.runtimeEnd.runtimeReadyAtMs = 70;
  assert.match(goal24DoorRouteSemanticFailures(impossibleReadinessOrder).join('\n'),
    /runtime ready timestamp precedes static batch readiness/);

  const lateCreation = structuredClone(inbound);
  lateCreation.runtimeStart.runtimeCreatedAtMs = 70;
  lateCreation.runtimeEnd.runtimeCreatedAtMs = 70;
  assert.match(goal24DoorRouteSemanticFailures(lateCreation).join('\n'),
    /static batch start timestamp precedes runtime creation/);

  const staleStartTransition = structuredClone(outbound);
  staleStartTransition.runtimeStart.lastDetailVisibilityTransition = null;
  assert.match(goal24DoorRouteSemanticFailures(staleStartTransition).join('\n'),
    /runtime start snapshot does not retain its exact last transition/);

  const approachEnteredGate = route({ finishZ: 21.4 });
  assert.match(goal24DoorRouteSemanticFailures(approachEnteredGate).join('\n'),
    /approach must remain outside the 1\.5-yard detail gate/);

  const forgedGateClassification = structuredClone(approach);
  forgedGateClassification.pathSamples[0].detailWithinClearance = true;
  assert.match(goal24DoorRouteSemanticFailures(forgedGateClassification).join('\n'),
    /detail-gate classification is inconsistent/);

  const forgedDoorDistance = structuredClone(inbound);
  forgedDoorDistance.pathSamples[0].distanceToDoor = 2.5;
  assert.match(goal24DoorRouteSemanticFailures(forgedDoorDistance).join('\n'),
    /door distance is not derived from its position/);

  const forgedInside = structuredClone(inbound);
  forgedInside.pathSamples[0].inside = true;
  assert.match(goal24DoorRouteSemanticFailures(forgedInside).join('\n'),
    /inside state contradicts its recorded position/);

  const uncorrelatedTransition = structuredClone(inbound);
  uncorrelatedTransition.runtimeEnd.lastDetailVisibilityTransition
    .exteriorDistanceYards = 0.2;
  assert.match(goal24DoorRouteSemanticFailures(uncorrelatedTransition).join('\n'),
    /production transition is not correlated to its exact path edge/);
});

test('seven-process cohort and aggregate fail closed on warm/cold route and doorway draw drift', () => {
  const sources = Array.from({ length: 7 }, (_, index) => source(index + 1));
  assert.equal(validateGoal24DoorCohort(sources), true);
  const baseline = aggregateGoal24DoorEvidence(sources);
  assert.equal(validateGoal24DoorEvidenceAggregate(baseline), baseline);
  assert.ok(baseline.entries.every(({ semantics }) => semantics.pass));
  assert.ok(Object.values(baseline.byScenario).every(({ semanticPass }) => semanticPass));
  assert.ok(Object.values(baseline.byScenario).every((summary) => (
    summary.nonShadowSubmissionFramesOver33Ms === 0
    && summary.nonShadowSubmissionFramesOver50Ms === 0
  )));

  const semanticProjectionDrift = structuredClone(baseline);
  semanticProjectionDrift.entries[0].semantics = { pass: false, failures: ['invented'] };
  assert.throws(
    () => validateGoal24DoorEvidenceAggregate(semanticProjectionDrift),
    /semantic result is not recomputed/,
  );

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
  assert.equal(comparison.candidateSemanticPass, true);
  assert.equal(comparison.expensiveDrawSubmitStillFires, false);
  assert.ok(comparison.drawRows.some(({ metric, pass }) => (
    metric === 'peakRenderedTriangles' && pass === false
  )));
});

test('semantically failing baselines remain structurally valid while candidates must pass', () => {
  const baselineSources = Array.from({ length: 7 }, (_, index) => source(index + 1));
  for (const sourceEntry of baselineSources) {
    const inbound = sourceEntry.contribution.scenarios.find(
      ({ id }) => id === 'doorCrossingOutsideToInside',
    );
    for (const event of inbound.events) {
      event.discriminator.routeSignature = route({ distance: 1.35, finishZ: 18 });
    }
  }
  const baseline = aggregateGoal24DoorEvidence(baselineSources);
  assert.equal(validateGoal24DoorEvidenceAggregate(baseline), baseline);
  assert.equal(baseline.byScenario.doorCrossingOutsideToInside.semanticPass, false);

  const candidate = aggregateGoal24DoorEvidence(
    Array.from({ length: 7 }, (_, index) => source(index + 1)),
  );
  const comparison = compareGoal24DoorEvidenceAggregates(baseline, candidate);
  assert.equal(comparison.candidateSemanticPass, true);
  assert.equal(comparison.ok, false, 'spatial parity still rejects a different before/after route');

  const failingCandidate = compareGoal24DoorEvidenceAggregates(baseline, baseline);
  assert.equal(failingCandidate.candidateSemanticPass, false);
  assert.equal(failingCandidate.ok, false);
});

test('a production render submission over 50 ms is explicit and fails candidate comparison', () => {
  const baselineSources = Array.from({ length: 7 }, (_, index) => source(index + 1));
  const candidateSources = structuredClone(baselineSources);
  for (const sourceEntry of candidateSources) {
    const inbound = sourceEntry.contribution.scenarios.find(
      ({ id }) => id === 'doorCrossingOutsideToInside',
    );
    inbound.events[0].doorwayRenderEvidence = renderEvidence({
      submissionWallMs: [60, 2, 2, 2],
    }).evidence;
  }
  const comparison = compareGoal24DoorEvidenceAggregates(
    aggregateGoal24DoorEvidence(baselineSources),
    aggregateGoal24DoorEvidence(candidateSources),
  );
  assert.equal(comparison.expensiveDrawSubmitStillFires, true);
  assert.deepEqual(comparison.expensiveDrawSubmitScenarios, [
    'doorCrossingOutsideToInside',
  ]);
  assert.equal(comparison.doorwaySubmissionRegressionPass, false);
  assert.equal(comparison.ok, false);
  assert.equal(
    comparison.submissionRows.find(({ scenarioId, scope, metric }) => (
      scenarioId === 'doorCrossingOutsideToInside'
      && scope === 'aggregate'
      && metric === 'nonShadowSubmissionFramesOver50Ms'
    ))?.after,
    7,
  );
  assert.ok(comparison.submissionRows.some(({ metric, after, pass }) => (
    metric === 'submissionFramesOver50Ms' && after > 0 && pass === false
  )));
});
