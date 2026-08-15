import { isDeepStrictEqual } from 'node:util';

export const GOAL24_DOOR_ROUTE_SCHEMA = 'goal24-door-route-camera-v3';
export const GOAL24_DOOR_RENDER_SCHEMA = 'goal24-doorway-render-evidence-v3';
export const GOAL24_DOOR_AGGREGATE_SCHEMA = 'goal24-door-evidence-aggregate-v2';
export const GOAL24_DOOR_DETAIL_CLEARANCE_YARDS = 1.5;

export const GOAL24_DOOR_SCENARIOS = Object.freeze([
  'doorApproach',
  'doorCrossingOutsideToInside',
  'doorCrossingInsideToOutside',
]);

const ROUTE_KIND_BY_SCENARIO = Object.freeze({
  doorApproach: 'approach',
  doorCrossingOutsideToInside: 'outside-in',
  doorCrossingInsideToOutside: 'inside-out',
});
const ROUTE_KINDS = Object.freeze(Object.values(ROUTE_KIND_BY_SCENARIO));

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
  submissionWallMsAbsolute: 1,
});

const FRAME_BOUNDARY_SOURCE = 'shipping-scene3d.render-wrapper';
const COUNTER_SOURCE = 'THREE.WebGLRenderer.info.render-after-shipping-composed-frame';
const SHADOW_SOURCE = 'scene3d.post.stats().shadowBakes';
const COMPOSED_RENDER_SOURCE = 'scene3d.post.stats().composedRenders';
const EPSILON_MS = 0.05;
// readDoor uses the shipping clubhouse's axial inside probe with this margin.
// Positions farther from the doorway plane are therefore unambiguous and can
// be independently checked against the recorded `inside` boolean.
const DOOR_INSIDE_CLASSIFICATION_MARGIN_YARDS = 0.35;
const RENDER_PROVENANCE = Object.freeze({
  boundarySource: FRAME_BOUNDARY_SOURCE,
  counterSource: COUNTER_SOURCE,
  shadowClassificationSource: SHADOW_SOURCE,
  composedRenderSource: COMPOSED_RENDER_SOURCE,
  counterReadPhase: 'after-complete-shipping-scene3d-render-return',
  firstFramePolicy: 'retained-raw-excluded-from-matched-statistic',
  shadowBakePolicy:
    'classified-retained-raw-excluded-from-draw-and-non-shadow-submit-statistics-but-retained-in-all-frame-submit-statistics',
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

function signedDoorDistance(sample, signature) {
  return (sample.x - signature.target.x) * signature.normal.x
    + (sample.z - signature.target.z) * signature.normal.z;
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

function validateDetailVisibilityTransition(transition, label) {
  invariant(transition && typeof transition === 'object' && !Array.isArray(transition),
    `${label} detail-visibility transition is invalid.`);
  invariant(Number.isInteger(transition.sequence) && transition.sequence > 0,
    `${label} detail-visibility transition sequence is invalid.`);
  invariant(finiteFields(transition, [
    'atMs', 'cameraLocalX', 'cameraLocalZ', 'exteriorDistanceYards',
  ]), `${label} detail-visibility transition position/timing is incomplete.`);
  invariant(transition.exteriorDistanceYards >= 0,
    `${label} detail-visibility transition exterior distance is invalid.`);
  invariant(transition.detailClearanceYards === GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
    `${label} detail-visibility transition clearance is not pinned to the production gate.`);
  invariant(typeof transition.from === 'boolean' && typeof transition.to === 'boolean'
    && transition.from !== transition.to,
  `${label} detail-visibility transition states are invalid.`);
}

function validateRuntimeSnapshot(snapshot, label) {
  invariant(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot),
    `${label} runtime snapshot is missing.`);
  invariant(finite(snapshot.capturedAtMs) && snapshot.capturedAtMs >= 0,
    `${label} runtime snapshot timestamp is invalid.`);
  for (const field of [
    'runtimeReadyAtMs', 'staticBatchStartedAtMs', 'staticBatchReadyAtMs',
  ]) {
    invariant(Object.hasOwn(snapshot, field)
      && (snapshot[field] == null || (finite(snapshot[field]) && snapshot[field] >= 0)),
    `${label} ${field} must be a nonnegative timestamp or explicit null.`);
  }
  if (Object.hasOwn(snapshot, 'runtimeCreatedAtMs')) {
    invariant(snapshot.runtimeCreatedAtMs == null
      || (finite(snapshot.runtimeCreatedAtMs) && snapshot.runtimeCreatedAtMs >= 0),
    `${label} runtimeCreatedAtMs must be a nonnegative timestamp or explicit null.`);
  }
  invariant(typeof snapshot.detailedVisible === 'boolean',
    `${label} detailedVisible is missing.`);
  invariant(Number.isInteger(snapshot.detailVisibilitySequence)
    && snapshot.detailVisibilitySequence >= 0,
  `${label} detailVisibilitySequence is invalid.`);
  invariant(Object.hasOwn(snapshot, 'lastDetailVisibilityTransition'),
    `${label} lastDetailVisibilityTransition must be present (explicit null is allowed).`);
  if (snapshot.lastDetailVisibilityTransition != null) {
    validateDetailVisibilityTransition(
      snapshot.lastDetailVisibilityTransition,
      `${label} last`,
    );
    invariant(snapshot.lastDetailVisibilityTransition.sequence
      <= snapshot.detailVisibilitySequence,
    `${label} last detail transition is ahead of its sequence snapshot.`);
  }
}

export function validateGoal24DoorRouteSignature(signature, label = 'door route') {
  invariant(signature?.schema === GOAL24_DOOR_ROUTE_SCHEMA,
    `${label} has no ${GOAL24_DOOR_ROUTE_SCHEMA} route evidence.`);
  invariant(ROUTE_KINDS.includes(signature.routeKind),
    `${label} routeKind must be approach, outside-in, or inside-out.`);
  invariant(signature.detailClearanceYards === GOAL24_DOOR_DETAIL_CLEARANCE_YARDS,
    `${label} detail clearance is not pinned to ${GOAL24_DOOR_DETAIL_CLEARANCE_YARDS} yards.`);
  invariant(finiteFields(signature.startPose, ['x', 'z', 'yaw', 'pitch']),
    `${label} start walk pose is incomplete.`);
  invariant(finiteFields(signature.target, ['x', 'z'])
    && finiteFields(signature.normal, ['x', 'z']), `${label} target/normal is incomplete.`);
  invariant(Math.abs(Math.hypot(signature.normal.x, signature.normal.z) - 1) <= 0.002,
    `${label} door normal is not normalized.`);
  invariant(finiteFields(signature.finishPosition, ['x', 'z']),
    `${label} finish position is incomplete.`);
  validateCamera(signature.startCameraPose, `${label} start`);
  validateCamera(signature.finishCameraPose, `${label} finish`);
  validateRuntimeSnapshot(signature.runtimeStart, `${label} start`);
  validateRuntimeSnapshot(signature.runtimeEnd, `${label} end`);
  invariant(Array.isArray(signature.pathSamples) && signature.pathSamples.length >= 2,
    `${label} requires at least two ordered spatial path samples.`);
  signature.pathSamples.forEach((sample, index) => {
    invariant(sample?.ordinal === index + 1
      && finiteFields(sample, ['atMs', 'x', 'z', 'distanceToDoor'])
      && typeof sample.inside === 'boolean', `${label} path sample ${index + 1} is incomplete.`);
    invariant(sample.atMs >= 0 && sample.distanceToDoor >= 0,
      `${label} path sample ${index + 1} has an invalid timestamp or door distance.`);
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

function transitionGateFailure(transition, routeKind, clearance) {
  if (!transition) return 'production detail-visibility transition is missing';
  const distance = transition.exteriorDistanceYards;
  if (routeKind === 'outside-in' && !(distance < clearance)) {
    return 'outside-in detail-visibility transition did not occur on the interior side of the gate';
  }
  if (routeKind === 'inside-out' && !(distance >= clearance)) {
    return 'inside-out detail-visibility transition did not occur on the exterior side of the gate';
  }
  return null;
}

/**
 * Return causal route/readiness failures without invalidating the raw baseline structure.
 * A pre-fix baseline may therefore be sealed with failures, while comparison explicitly
 * requires every candidate route to pass this projection.
 */
export function goal24DoorRouteSemanticFailures(signature, options = {}) {
  try {
    validateGoal24DoorRouteSignature(signature, options.label || 'door route');
  } catch (error) {
    return [`structure: ${error?.message || error}`];
  }
  const failures = [];
  const expectedRouteKind = options.expectedRouteKind || null;
  if (expectedRouteKind && signature.routeKind !== expectedRouteKind) {
    failures.push(`routeKind ${signature.routeKind} does not match expected ${expectedRouteKind}`);
  }
  const samples = signature.pathSamples;
  const first = samples[0];
  const last = samples.at(-1);
  const clearance = signature.detailClearanceYards;
  const runtimeStart = signature.runtimeStart;
  const runtimeEnd = signature.runtimeEnd;
  const derivedDoorDistance = (sample) => distance2d(sample, signature.target);

  if (Math.abs(runtimeStart.capturedAtMs - first.atMs) > EPSILON_MS
    || Math.abs(runtimeEnd.capturedAtMs - last.atMs) > EPSILON_MS) {
    failures.push('runtime start/end snapshots are not bound to the first/last path samples');
  }
  const readiness = [
    ['runtimeCreatedAtMs', runtimeStart.runtimeCreatedAtMs],
    ['runtimeReadyAtMs', runtimeStart.runtimeReadyAtMs],
    ['staticBatchStartedAtMs', runtimeStart.staticBatchStartedAtMs],
    ['staticBatchReadyAtMs', runtimeStart.staticBatchReadyAtMs],
  ];
  for (const [field, value] of readiness) {
    if (!finite(value) || value > first.atMs) {
      failures.push(`${field} must be finite and no later than the measured route start`);
    }
    if (runtimeEnd[field] !== value) {
      failures.push(`${field} changed between the route start/end snapshots`);
    }
  }
  if (finite(runtimeStart.staticBatchStartedAtMs)
    && finite(runtimeStart.staticBatchReadyAtMs)
    && runtimeStart.staticBatchStartedAtMs > runtimeStart.staticBatchReadyAtMs) {
    failures.push('static batch ready timestamp precedes its start timestamp');
  }
  if (finite(runtimeStart.runtimeCreatedAtMs)
    && finite(runtimeStart.staticBatchStartedAtMs)
    && runtimeStart.runtimeCreatedAtMs > runtimeStart.staticBatchStartedAtMs) {
    failures.push('static batch start timestamp precedes runtime creation');
  }
  if (finite(runtimeStart.staticBatchReadyAtMs)
    && finite(runtimeStart.runtimeReadyAtMs)
    && runtimeStart.staticBatchReadyAtMs > runtimeStart.runtimeReadyAtMs) {
    failures.push('runtime ready timestamp precedes static batch readiness');
  }

  for (const [index, sample] of samples.entries()) {
    const measuredDoorDistance = derivedDoorDistance(sample);
    if (Math.abs(sample.distanceToDoor - measuredDoorDistance) > 0.001) {
      failures.push(`path sample ${index + 1} door distance is not derived from its position`);
    }
    const signedDistance = signedDoorDistance(sample, signature);
    if ((signedDistance > DOOR_INSIDE_CLASSIFICATION_MARGIN_YARDS && sample.inside)
      || (signedDistance < -DOOR_INSIDE_CLASSIFICATION_MARGIN_YARDS && !sample.inside)) {
      failures.push(`path sample ${index + 1} inside state contradicts its recorded position`);
    }
    if (!finite(sample.detailExteriorDistanceYards)
      || sample.detailExteriorDistanceYards < 0
      || typeof sample.detailWithinClearance !== 'boolean'
      || typeof sample.detailedVisible !== 'boolean'
      || !Number.isInteger(sample.detailVisibilitySequence)
      || sample.detailVisibilitySequence < 0) {
      failures.push(`path sample ${index + 1} production detail-gate evidence is missing`);
      continue;
    }
    const derivedWithinClearance = sample.detailExteriorDistanceYards < clearance;
    if (sample.detailWithinClearance !== derivedWithinClearance) {
      failures.push(`path sample ${index + 1} detail-gate classification is inconsistent`);
    }
    if (index > 0
      && sample.detailVisibilitySequence < samples[index - 1].detailVisibilitySequence) {
      failures.push('path detail-visibility sequence moved backwards');
      break;
    }
  }
  if (first.detailedVisible !== runtimeStart.detailedVisible
    || first.detailVisibilitySequence !== runtimeStart.detailVisibilitySequence
    || last.detailedVisible !== runtimeEnd.detailedVisible
    || last.detailVisibilitySequence !== runtimeEnd.detailVisibilitySequence) {
    failures.push('runtime detail snapshots do not match the first/last path samples');
  }
  for (const [label, snapshot] of [
    ['start', runtimeStart], ['end', runtimeEnd],
  ]) {
    const transition = snapshot.lastDetailVisibilityTransition;
    if (snapshot.detailVisibilitySequence > 0
      && (!transition
        || transition.sequence !== snapshot.detailVisibilitySequence
        || transition.atMs > snapshot.capturedAtMs + EPSILON_MS
        || transition.atMs < runtimeStart.runtimeCreatedAtMs - EPSILON_MS
        || transition.to !== snapshot.detailedVisible)) {
      failures.push(`runtime ${label} snapshot does not retain its exact last transition`);
    }
  }

  const visibilityDelta = runtimeEnd.detailVisibilitySequence
    - runtimeStart.detailVisibilitySequence;
  const lastTransition = runtimeEnd.lastDetailVisibilityTransition;
  const zoneTransitions = samples.slice(1).reduce((count, sample, index) => (
    count + (sample.inside !== samples[index].inside ? 1 : 0)
  ), 0);
  const spatialSideTransitions = samples.slice(1).reduce((count, sample, index) => (
    count + ((signedDoorDistance(sample, signature) < 0)
      !== (signedDoorDistance(samples[index], signature) < 0) ? 1 : 0)
  ), 0);
  const detailGateTransitions = samples.slice(1).reduce((count, sample, index) => (
    count + (sample.detailWithinClearance
      !== samples[index].detailWithinClearance ? 1 : 0)
  ), 0);
  const detailedVisibilityTransitions = samples.slice(1).reduce((count, sample, index) => (
    count + (sample.detailedVisible !== samples[index].detailedVisible ? 1 : 0)
  ), 0);
  const detailSequenceEdges = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (current.detailVisibilitySequence === previous.detailVisibilitySequence
      && current.detailedVisible === previous.detailedVisible) continue;
    detailSequenceEdges.push({ previous, current });
    if (current.detailVisibilitySequence !== previous.detailVisibilitySequence + 1
      || current.detailedVisible === previous.detailedVisible) {
      failures.push('path detail-visibility state and sequence did not advance together once');
    }
  }
  const transitionInsideRoute = lastTransition
    && lastTransition.atMs >= first.atMs - EPSILON_MS
    && lastTransition.atMs <= last.atMs + EPSILON_MS;

  if (signature.routeKind === 'approach') {
    if (samples.some((sample) => sample.inside
      || derivedDoorDistance(sample) < clearance
      || signedDoorDistance(sample, signature) < clearance
      || sample.detailWithinClearance
      || sample.detailExteriorDistanceYards < clearance)) {
      failures.push(`approach must remain outside the ${clearance}-yard detail gate`);
    }
    if (samples.some(({ detailedVisible }) => detailedVisible)
      || runtimeStart.detailedVisible || runtimeEnd.detailedVisible
      || visibilityDelta !== 0
      || samples.some(({ detailVisibilitySequence }) => (
        detailVisibilitySequence !== runtimeStart.detailVisibilitySequence
      ))
      || !isDeepStrictEqual(
        runtimeStart.lastDetailVisibilityTransition,
        runtimeEnd.lastDetailVisibilityTransition,
      )) {
      failures.push('approach must remain detail-hidden without a production visibility flip');
    }
  } else {
    const inbound = signature.routeKind === 'outside-in';
    const expectedStartInside = !inbound;
    const expectedEndInside = inbound;
    const startSignedDistance = signedDoorDistance(first, signature);
    const endSignedDistance = signedDoorDistance(last, signature);
    const startBeyondExpectedSide = inbound
      ? startSignedDistance > clearance : startSignedDistance < -clearance;
    const endBeyondExpectedSide = inbound
      ? endSignedDistance < -clearance : endSignedDistance > clearance;
    if (first.inside !== expectedStartInside
      || !(derivedDoorDistance(first) > clearance)
      || !startBeyondExpectedSide) {
      failures.push(`${signature.routeKind} must begin beyond the ${clearance}-yard gate on the expected side`);
    }
    if (last.inside !== expectedEndInside
      || !(derivedDoorDistance(last) > clearance)
      || !endBeyondExpectedSide) {
      failures.push(`${signature.routeKind} must end beyond the ${clearance}-yard gate on the expected side`);
    }
    if (first.detailWithinClearance !== !inbound
      || last.detailWithinClearance !== inbound) {
      failures.push(`${signature.routeKind} detail-gate endpoints are incorrect`);
    }
    if (zoneTransitions !== 1 || spatialSideTransitions !== 1) {
      failures.push(`${signature.routeKind} must cross the doorway exactly once`);
    }
    if (detailGateTransitions !== 1) {
      failures.push(`${signature.routeKind} must cross the detail gate exactly once`);
    }
    if (runtimeStart.detailedVisible !== !inbound
      || runtimeEnd.detailedVisible !== inbound) {
      failures.push(`${signature.routeKind} runtime visibility endpoints are incorrect`);
    }
    if (visibilityDelta !== 1
      || detailedVisibilityTransitions !== 1
      || !lastTransition
      || lastTransition.sequence !== runtimeEnd.detailVisibilitySequence
      || !transitionInsideRoute) {
      failures.push(`${signature.routeKind} requires exactly one production visibility transition inside the measured path time`);
    } else {
      const expectedFrom = !inbound;
      const expectedTo = inbound;
      if (lastTransition.from !== expectedFrom || lastTransition.to !== expectedTo) {
        failures.push(`${signature.routeKind} production visibility transition direction is incorrect`);
      }
      const gateFailure = transitionGateFailure(lastTransition, signature.routeKind, clearance);
      if (gateFailure) failures.push(gateFailure);
      const edge = detailSequenceEdges[0];
      if (detailSequenceEdges.length !== 1
        || !edge
        || lastTransition.atMs < edge.previous.atMs - EPSILON_MS
        || lastTransition.atMs > edge.current.atMs + EPSILON_MS
        || edge.previous.detailedVisible !== lastTransition.from
        || edge.current.detailedVisible !== lastTransition.to
        || edge.current.detailVisibilitySequence !== lastTransition.sequence
        || lastTransition.exteriorDistanceYards
          < Math.min(
            edge.previous.detailExteriorDistanceYards,
            edge.current.detailExteriorDistanceYards,
          ) - 0.1
        || lastTransition.exteriorDistanceYards
          > Math.max(
            edge.previous.detailExteriorDistanceYards,
            edge.current.detailExteriorDistanceYards,
          ) + 0.1) {
        failures.push(`${signature.routeKind} production transition is not correlated to its exact path edge`);
      }
    }
  }
  return failures;
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
  const submissionWallMs = (sample) => (
    sample.productionRenderEndedAtMs - sample.productionRenderStartedAtMs
  );
  const peakSubmission = (samples) => [...samples].sort((left, right) => (
    submissionWallMs(right) - submissionWallMs(left) || left.ordinal - right.ordinal
  ))[0];
  const peakAllSubmission = peakSubmission(frameSamples);
  const peakNonShadowSubmission = peakSubmission(nonShadow);
  const over = (samples, thresholdMs) => samples.filter(
    (sample) => submissionWallMs(sample) > thresholdMs,
  ).length;
  const framesOver33Ms = {
    allFrames: over(frameSamples, 33),
    nonShadowFrames: over(nonShadow, 33),
  };
  const framesOver50Ms = {
    allFrames: over(frameSamples, 50),
    nonShadowFrames: over(nonShadow, 50),
  };
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
      submissionWallMs: submissionWallMs(matchedSample),
      sampleOrdinal: matchedSample.ordinal,
    },
    peak: {
      scope: 'all-non-shadow-frames-including-first',
      calls: Math.max(...nonShadow.map(({ calls }) => calls)),
      triangles: Math.max(...nonShadow.map(({ triangles }) => triangles)),
    },
    submissionWall: {
      source: 'productionRenderEndedAtMs-minus-productionRenderStartedAtMs',
      matched: {
        statistic: 'same-post-first-non-shadow-frame-as-matched-draw-workload',
        durationMs: submissionWallMs(matchedSample),
        sampleOrdinal: matchedSample.ordinal,
      },
      peakAllFrames: {
        scope: 'all-production-render-frames-including-shadow-bakes-and-first-frame',
        durationMs: submissionWallMs(peakAllSubmission),
        sampleOrdinal: peakAllSubmission.ordinal,
        frameClass: peakAllSubmission.frameClass,
      },
      peakNonShadowFrames: {
        scope: 'all-non-shadow-production-render-frames-including-first',
        durationMs: submissionWallMs(peakNonShadowSubmission),
        sampleOrdinal: peakNonShadowSubmission.ordinal,
      },
      framesOver33Ms,
      framesOver50Ms,
      expensiveDrawSubmitStillFires: framesOver50Ms.allFrames > 0,
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
    `${label} doorway renderer draw/submit peak and matched statistics are not derived from raw frames.`);
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
  const matchedSubmission = events.map(({ renderEvidence }) => (
    renderEvidence.statistics.submissionWall.matched.durationMs
  ));
  const peakAllSubmission = events.map(({ renderEvidence }) => (
    renderEvidence.statistics.submissionWall.peakAllFrames.durationMs
  ));
  const peakNonShadowSubmission = events.map(({ renderEvidence }) => (
    renderEvidence.statistics.submissionWall.peakNonShadowFrames.durationMs
  ));
  return {
    eventCount: events.length,
    rawFrameCount: events.reduce((sum, event) => (
      sum + event.renderEvidence.statistics.observedFrameCount
    ), 0),
    matchedDrawCalls: lowerMedian(matchedCalls),
    matchedRenderedTriangles: lowerMedian(matchedTriangles),
    peakDrawCalls: Math.max(...peakCalls),
    peakRenderedTriangles: Math.max(...peakTriangles),
    matchedSubmissionWallMs: lowerMedian(matchedSubmission),
    peakAllSubmissionWallMs: Math.max(...peakAllSubmission),
    peakNonShadowSubmissionWallMs: Math.max(...peakNonShadowSubmission),
    submissionFramesOver33Ms: events.reduce((sum, event) => (
      sum + event.renderEvidence.statistics.submissionWall.framesOver33Ms.allFrames
    ), 0),
    nonShadowSubmissionFramesOver33Ms: events.reduce((sum, event) => (
      sum + event.renderEvidence.statistics.submissionWall.framesOver33Ms.nonShadowFrames
    ), 0),
    submissionFramesOver50Ms: events.reduce((sum, event) => (
      sum + event.renderEvidence.statistics.submissionWall.framesOver50Ms.allFrames
    ), 0),
    nonShadowSubmissionFramesOver50Ms: events.reduce((sum, event) => (
      sum + event.renderEvidence.statistics.submissionWall.framesOver50Ms.nonShadowFrames
    ), 0),
    expensiveDrawSubmitStillFires: events.some((event) => (
      event.renderEvidence.statistics.submissionWall.expensiveDrawSubmitStillFires
    )),
    semanticPass: events.every((event) => event.semantics?.pass === true),
    semanticFailureCount: events.reduce((sum, event) => (
      sum + (event.semantics?.failures?.length || 0)
    ), 0),
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
          semantics: (() => {
            const failures = goal24DoorRouteSemanticFailures(
              event.discriminator.routeSignature,
              { expectedRouteKind: ROUTE_KIND_BY_SCENARIO[scenarioId] },
            );
            return { pass: failures.length === 0, failures };
          })(),
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
      const semanticFailures = goal24DoorRouteSemanticFailures(entry.routeSignature, {
        expectedRouteKind: ROUTE_KIND_BY_SCENARIO[scenarioId],
      });
      invariant(isDeepStrictEqual(entry.semantics, {
        pass: semanticFailures.length === 0,
        failures: semanticFailures,
      }), `${scenarioId} aggregate event ${index + 1} semantic result is not recomputed from its route.`);
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

function submissionTolerance(metric, reference, tolerances) {
  if (metric.toLowerCase().includes('framesover')) return 0;
  return Math.max(tolerances.submissionWallMsAbsolute, reference * tolerances.relative);
}

export function compareGoal24DoorEvidenceAggregates(reference, candidate) {
  validateGoal24DoorEvidenceAggregate(reference);
  validateGoal24DoorEvidenceAggregate(candidate);
  const routeRows = [];
  const drawRows = [];
  const submissionRows = [];
  const semanticRows = [];
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
      const failures = goal24DoorRouteSemanticFailures(afterEntries[index].routeSignature, {
        expectedRouteKind: ROUTE_KIND_BY_SCENARIO[scenarioId],
      });
      semanticRows.push({
        scenarioId,
        eventOrdinal: index + 1,
        candidateRunOrdinal: afterEntries[index].runOrdinal,
        temperature: afterEntries[index].temperature,
        pass: failures.length === 0,
        failures,
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
    const addSubmissionRows = (scope, before, after) => {
      for (const metric of [
        'matchedSubmissionWallMs',
        'peakAllSubmissionWallMs',
        'peakNonShadowSubmissionWallMs',
        'submissionFramesOver33Ms',
        'nonShadowSubmissionFramesOver33Ms',
        'submissionFramesOver50Ms',
        'nonShadowSubmissionFramesOver50Ms',
      ]) {
        const tolerance = submissionTolerance(
          metric,
          before[metric],
          reference.drawRegressionTolerances,
        );
        const delta = after[metric] - before[metric];
        submissionRows.push({
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
    addSubmissionRows('aggregate', reference.byScenario[scenarioId], candidate.byScenario[scenarioId]);
    const beforeProcesses = reference.byScenario[scenarioId].perProcess;
    const afterProcesses = candidate.byScenario[scenarioId].perProcess;
    invariant(beforeProcesses.length === 7 && afterProcesses.length === 7,
      `${scenarioId} baseline/candidate per-process renderer coverage is incomplete.`);
    for (let index = 0; index < 7; index += 1) {
      addDrawRows(`cold-process-${index + 1}`, beforeProcesses[index], afterProcesses[index]);
      addSubmissionRows(
        `cold-process-${index + 1}`,
        beforeProcesses[index],
        afterProcesses[index],
      );
    }
  }
  const candidateSemanticPass = semanticRows.every(({ pass }) => pass);
  const expensiveDrawSubmitScenarios = GOAL24_DOOR_SCENARIOS.filter((scenarioId) => (
    candidate.byScenario[scenarioId].expensiveDrawSubmitStillFires
  ));
  const expensiveDrawSubmitStillFires = expensiveDrawSubmitScenarios.length > 0;
  return {
    routeTolerances: { ...GOAL24_DOOR_ROUTE_TOLERANCES },
    drawRegressionTolerances: { ...GOAL24_DOOR_DRAW_TOLERANCES },
    routeRows,
    drawRows,
    submissionRows,
    semanticRows,
    routeParityPass: routeRows.every(({ ok }) => ok),
    doorwayDrawRegressionPass: drawRows.every(({ pass }) => pass),
    doorwaySubmissionRegressionPass: submissionRows.every(({ pass }) => pass),
    candidateSemanticPass,
    expensiveDrawSubmitStillFires,
    expensiveDrawSubmitScenarios,
    ok: routeRows.every(({ ok }) => ok)
      && drawRows.every(({ pass }) => pass)
      && submissionRows.every(({ pass }) => pass)
      && candidateSemanticPass
      && !expensiveDrawSubmitStillFires,
  };
}
