import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/core/utils.js';
import { holeDistanceYd, holePar } from '../src/sim/course.js';
import { designCourse } from '../src/sim/courseArchitect.js';
import { compileVegetationExclusions, vegetationExclusionAt } from '../src/sim/courseLandscape.js';
import { ZONE } from '../src/sim/constants.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';
import {
  buildRelief, evaluateSurface, getGeom, polygonSDF, reliefAt, sampleClosed, sampleOpen,
} from '../src/sim/courseVec.js';

// Deterministic Willow Creek property seed produced by the browser QA bootstrap
// (newEmpire('relaxed', 424242) -> willow-creek).
const WILLOW_SEED = 276398324;
const PRODUCTION_HOLES_2_TO_9_SHA256 = '35ae75a0eb49182bf545b60a74da5c9de421f62d3cffaf1ddf33b58c8f955e9e';
const PRODUCTION_DOWNSTREAM_SHA256 = '864891ef6c8058371c420557133a3f6607bf91a6274389d727f7a14681603c92';

function willow(opts = {}) {
  return designCourse(makeRng(WILLOW_SEED), { jitter: 0.35, ...opts });
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function downstreamFingerprint(course) {
  return {
    vecSeed: course.vec.seed,
    holes: course.vec.holes.slice(1),
    waters: course.vec.waters,
    // IDs 2 and 3 are H1's route-relative backstop mounds. Their locations are
    // expected to move with the rebuilt approach; all later mounds must not.
    downstreamMounds: course.vec.mounds.filter((mound) => mound.id !== 2 && mound.id !== 3),
    beds: course.vec.beds,
    lawns: course.vec.lawns,
    nextId: course.vec.nextId,
    holeRecords: course.holes.slice(1),
  };
}

test('Opening Drive is the deterministic 412-yard Hole 1 vertical slice', () => {
  const course = willow();
  const hole = course.holes[0];
  const vecHole = course.vec.holes[0];

  assert.equal(hole.name, 'Opening Drive');
  assert.equal(Math.round(holeDistanceYd(hole)), 412);
  assert.equal(holePar(hole), 4);
  assert.equal(hole.handicap, 6);
  assert.equal(hole.vecId, 1);
  assert.equal(vecHole.id, 1);
  assert.equal(vecHole.bunkers.length, 3);
  assert.deepEqual(vecHole.bunkers.map((bunker) => bunker.lip), [1.1, 1.35, 1.25]);
  assert.deepEqual(hole.tee, { x: 21, y: 35 });
  assert.deepEqual(hole.pin, { x: 72, y: 28 });

  assert.deepEqual(vecHole.path, {
    side: 'outward',
    arrivalPull: 0.5,
    fullOffsetFromT: 0.08,
    fullOffsetToT: 0.92,
    minFairwayEdgeClearYd: 26,
  });
  assert.deepEqual(vecHole.vegetation.exclusions, [
    { kind: 'route', t0: 0, t1: 0.18, clearHalfYd: 34 },
    { kind: 'route', t0: 0.18, t1: 0.72, beyondFairwayYd: 6 },
    { kind: 'route', t0: 0.72, t1: 1, clearHalfYd: 26 },
    { kind: 'green', bufferYd: 24 },
    { kind: 'bunker', bufferYd: 8 },
    { kind: 'path', bufferYd: 6 },
  ]);
  assert.equal(vecHole.vegetation.plantings.length, 6);
  assert.deepEqual(vecHole.vegetation.plantings.map((planting) => (
    [planting.side, planting.t0, planting.t1, planting.beyondFairwayYd, planting.spacingYd]
  )), [
    ['left', 0.2, 0.7, 9, 30],
    ['right', 0.22, 0.7, 10, 33],
    ['left', 0.72, 0.93, 17, 25],
    ['right', 0.72, 0.93, 17, 27],
    ['left', 0.16, 0.94, 3, 18],
    ['right', 0.18, 0.92, 4, 20],
  ]);
  assert.deepEqual(vecHole.terrainProfile, {
    relativeFeet: [[0, 0], [0.16, 2.4], [0.34, 6.6], [0.5, 5.0], [0.64, 3.3], [0.82, 7.3], [1, 8.2]],
    landingPlateau: { t0: 0.42, t1: 0.64, maxCrossSlope: 0.025 },
    landingCrown: { t0: 0.2, t1: 0.72, edgeDropFt: 2.6 },
    approachShoulder: { t0: 0.74, t1: 0.94, side: 'right', heightFt: 3.1 },
  });
  assert.equal(vecHole.green.raise, 2.35);
  assert.equal(vecHole.green.tilt, 0.18);
});

test('Opening Drive has no water in or near its line of play', () => {
  const course = willow();
  const route = sampleOpen(course.vec.holes[0].line, 0.25);
  let nearestWaterYd = Infinity;

  for (let y = 0; y < course.h; y++) {
    for (let x = 0; x < course.w; x++) {
      if (course.zones[y * course.w + x] !== ZONE.WATER) continue;
      for (const point of route) {
        nearestWaterYd = Math.min(nearestWaterYd, Math.hypot(x + 0.5 - point.x, y + 0.5 - point.y) * 8);
      }
    }
  }

  assert.ok(Number.isFinite(nearestWaterYd), 'the property fixture should still contain water elsewhere');
  assert.ok(nearestWaterYd > 180, `water is only ${nearestWaterYd.toFixed(1)} yd from H1's centerline`);
});

test('the production nine-hole vector fixture remains deterministic', () => {
  const course = willow();

  assert.deepEqual(course.vec.holes.map((hole) => hole.id), [1, 4, 8, 11, 14, 18, 21, 27, 31]);
  assert.equal(course.vec.nextId, 36);
  assert.equal(sha256(course.vec.holes.slice(1)), PRODUCTION_HOLES_2_TO_9_SHA256);
  assert.equal(sha256(downstreamFingerprint(course)), PRODUCTION_DOWNSTREAM_SHA256);
});

test('fixed Hole 1 bunker does not spend the randomized bunker budget', () => {
  const course = willow({ bunkerBudget: 3 });

  assert.equal(course.vec.holes[0].bunkers.length, 3, 'two budgeted bunkers plus one fixed bunker');
  assert.equal(course.vec.holes[1].bunkers.length, 1, 'the third budgeted bunker remains available to H2');
});

test('Opening Drive green is a smooth asymmetric complex with an open run-up and authored relief', () => {
  const course = willow();
  const vecHole = course.vec.holes[0];
  const green = vecHole.green;
  const previous = vecHole.line.at(-2);
  const target = vecHole.line.at(-1);
  const approachAngle = Math.atan2(target.y - previous.y, target.x - previous.x);
  const forward = { x: Math.cos(approachAngle), y: Math.sin(approachAngle) };
  const right = { x: -forward.y, y: forward.x };
  const local = (point) => {
    const dx = point.x - target.x;
    const dy = point.y - target.y;
    return {
      across: dx * right.x + dy * right.y,
      front: -(dx * forward.x + dy * forward.y),
    };
  };

  assert.equal(green.style, 'opening-drive-angled-pear');
  assert.equal(green.pts.length, 16, 'authored outline replaces the generic ten-point ellipse');
  assert.deepEqual(green.contours.map((contour) => [contour.role, contour.h]), [
    ['back-left-shelf', 0.3],
    ['front-right-feed', -0.12],
  ]);

  const boundary = sampleClosed(green.pts, 0.15);
  const localBoundary = boundary.map(local);
  const frontReach = Math.max(...localBoundary.map((point) => point.front));
  const backReach = -Math.min(...localBoundary.map((point) => point.front));
  const leftReach = -Math.min(...localBoundary.map((point) => point.across));
  const rightReach = Math.max(...localBoundary.map((point) => point.across));
  assert.ok((frontReach - backReach) * 8 > 1.5,
    'the run-up nose reaches materially farther toward play than the rear edge');
  assert.ok((leftReach - rightReach) * 8 > 1,
    'unequal side reaches make the plan visibly asymmetric rather than elliptical');

  let maxTurn = 0;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[(i - 1 + boundary.length) % boundary.length];
    const b = boundary[i];
    const c = boundary[(i + 1) % boundary.length];
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const ul = Math.hypot(ux, uy);
    const vl = Math.hypot(vx, vy);
    const cosine = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (ul * vl)));
    maxTurn = Math.max(maxTurn, Math.acos(cosine));
  }
  assert.ok(maxTurn < 0.3, `sampled boundary contains a ${maxTurn.toFixed(3)}rad corner`);

  const geom = getGeom(course);
  for (const pin of green.pins) {
    assert.ok(polygonSDF(pin.x, pin.y, geom.holes[0].greenPoly) < -0.75,
      'all three persisted pin positions remain safely inside the new outline');
  }

  const surfaceOnApproach = (yardsBeforeCenter) => {
    const cells = yardsBeforeCenter / 8;
    const x = target.x - forward.x * cells;
    const y = target.y - forward.y * cells;
    return evaluateSurface(course, geom, x, y, course.paint || null).zone;
  };
  assert.deepEqual([20, 16, 12].map(surfaceOnApproach), [ZONE.FAIRWAY, ZONE.FRINGE, ZONE.GREEN],
    'the centerline feeds continuously from fairway through fringe onto the putting surface');

  const greensideCenters = vecHole.bunkers.slice(1).map((bunker) => local({
    x: bunker.pts.reduce((sum, point) => sum + point.x, 0) / bunker.pts.length,
    y: bunker.pts.reduce((sum, point) => sum + point.y, 0) / bunker.pts.length,
  }));
  assert.ok(greensideCenters[0].across < 0 && greensideCenters[1].across > 0,
    'greenside sand brackets opposite sides of the open approach');
  assert.ok(greensideCenters.every((point) => point.front > 0),
    'both approach traps remain in front of the putting surface, not behind it');

  const shoulders = course.vec.mounds.filter((mound) => mound.id === 2 || mound.id === 3);
  assert.deepEqual(shoulders.map((mound) => [mound.role, mound.r, mound.h]), [
    ['back-left-shoulder', 2.25, 2.8],
    ['back-right-shoulder', 1.75, 2.1],
  ]);
  assert.ok(shoulders.every((mound) => local(mound).front < 0),
    'unequal framing mounds sit behind the green and leave the run-up unobstructed');

  const relief = buildRelief(course, () => 0);
  const shelf = green.contours.find((contour) => contour.role === 'back-left-shelf');
  const feed = green.contours.find((contour) => contour.role === 'front-right-feed');
  assert.ok(reliefAt(relief, shelf.x, shelf.y, 0) - reliefAt(relief, feed.x, feed.y, 0) > 0.3,
    'the two broad authored rolls produce subtle but readable asymmetric relief');
});

test('Opening Drive outline and relief metadata survive the normal save/load path intact', () => {
  const state = newGame('relaxed', 7319);
  const originalGreen = state.course.vec.holes[0].green;
  const originalShoulders = state.course.vec.mounds.filter((mound) => (
    mound.role === 'back-left-shoulder' || mound.role === 'back-right-shoulder'
  ));
  const restored = deserialize(serialize(state));

  assert.deepEqual(restored.course.vec.holes[0].green, originalGreen);
  assert.deepEqual(restored.course.vec.mounds.filter((mound) => (
    mound.role === 'back-left-shoulder' || mound.role === 'back-right-shoulder'
  )), originalShoulders);
});

test('Opening Drive terrain, path, and canopy metadata affect the generated property', () => {
  const course = willow();
  const vecHole = course.vec.holes[0];
  const route = sampleOpen(vecHole.line, 0.15);
  const at = (point) => {
    const x = Math.max(0, Math.min(course.w - 1, Math.round(point.x - 0.5)));
    const y = Math.max(0, Math.min(course.h - 1, Math.round(point.y - 0.5)));
    return course.elevation[y * course.w + x];
  };

  assert.ok(Math.abs((at(route.at(-1)) - at(route[0])) - 8.2) < 0.05,
    'the nearest terrain vertices finish within 0.6in of the authored 8.2ft rise');
  assert.equal(course.paths[0].width, 2.7, 'cart path is an eight-foot ribbon');

  const tee = vecHole.tees[0];
  const densePath = sampleOpen(course.paths[0].pts, 0.08);
  const nearestPathYd = densePath.reduce((nearest, point) => Math.min(
    nearest, Math.hypot(point.x - tee.x, point.y - tee.y) * 8,
  ), Infinity);
  assert.ok(nearestPathYd >= 34,
    `path stays out of the opening view (${nearestPathYd.toFixed(1)}yd from the back tee)`);

  const teeAmenity = (type) => course.objects.find((object) => object.type === type
    && Math.hypot(object.x - tee.x, object.y - tee.y) * 8 < 12);
  const sign = teeAmenity('tee_sign');
  const washer = teeAmenity('ball_washer');
  assert.ok(sign, 'the opening tee has a nearby hole sign');
  assert.ok(washer, 'the opening tee has a nearby ball washer');
  assert.ok(teeAmenity('bench_course'), 'the hero tee always has a bench');
  assert.ok(teeAmenity('trash_course'), 'the hero tee always has a waste bin');
  assert.ok(Math.hypot(sign.x - tee.x, sign.y - tee.y) * 8 < 5,
    'the sign sits inside the normal tee camera instead of thirteen yards away');
  assert.ok(Math.hypot(washer.x - tee.x, washer.y - tee.y) * 8 < 7,
    'the washer belongs to the tee cluster instead of sitting twenty-two yards away');

  const exclusions = compileVegetationExclusions(course);
  const tallTypes = new Set([
    'fill_a', 'fill_b', 'oak_a', 'oak_b', 'maple_a', 'birch_a', 'shade_a', 'flower_a',
    'pine_a', 'pine_b', 'spruce_a', 'cedar_a',
  ]);
  const blockedTrees = course.objects.filter((object) => (
    tallTypes.has(object.type) && vegetationExclusionAt(exclusions, object.x, object.y)
  ));
  assert.deepEqual(blockedTrees, [], 'no generated tall canopy violates the H1 exclusions');

  const heroPlantTypes = new Set(vecHole.vegetation.plantings.flatMap((planting) => planting.types));
  const heroPlantings = course.objects.filter((object) => heroPlantTypes.has(object.type)).filter((object) => (
    route.some((point) => Math.hypot(object.x - point.x, object.y - point.y) * 8 < 55)
  ));
  assert.ok(heroPlantings.length >= 18,
    `the authored opening corridor should retain at least 18 varied plantings (found ${heroPlantings.length})`);

  const geom = getGeom(course);
  const greensideSandPlantings = course.objects.filter((object) => (
    object.type !== 'rake_prop'
    && Math.hypot(object.x - vecHole.green.cx, object.y - vecHole.green.cy) < 8
    && evaluateSurface(course, geom, object.x, object.y, course.paint || null).zone === ZONE.BUNKER
  ));
  assert.deepEqual(greensideSandPlantings, [],
    'sub-cell greenside bunkers use vector truth and contain no shrubs, rocks, or trees');
});
