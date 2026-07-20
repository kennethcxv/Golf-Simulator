import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import { ZONE } from '../src/sim/constants.js';
import { buildCourseRouteNetwork, zoneAtWorld } from '../src/sim/golfRoutes.js';
import { chooseShotType, planGolfShot, sampleBallPosition, SHOT_TYPE } from '../src/sim/golfShots.js';

function planned(state, overrides = {}) {
  const hole = buildCourseRouteNetwork(state.course).holes[3];
  return planGolfShot({
    course: state.course,
    partyId: 'round-test',
    golfer: { id: 1, name: 'Test Golfer', skill: 14 },
    holeIndex: 3,
    shotNumber: 1,
    start: hole.tee,
    target: hole.pin,
    startMinute: 500,
    context: { seed: state.seed, courseCondition: 70, greenQuality: 0.7, greenSpeed: 9 },
    ...overrides,
  });
}

test('club choice responds to lie, distance, and shot number', () => {
  assert.equal(chooseShotType(280, { kind: 'tee' }, 1), SHOT_TYPE.DRIVER);
  assert.equal(chooseShotType(210, { kind: 'fairway' }, 2), SHOT_TYPE.FAIRWAY_WOOD);
  assert.equal(chooseShotType(130, { kind: 'rough' }, 2), SHOT_TYPE.IRON);
  assert.equal(chooseShotType(70, { kind: 'fairway' }, 3), SHOT_TYPE.WEDGE);
  assert.equal(chooseShotType(22, { kind: 'rough' }, 3), SHOT_TYPE.CHIP);
  assert.equal(chooseShotType(40, { kind: 'bunker' }, 2), SHOT_TYPE.BUNKER);
  assert.equal(chooseShotType(8, { kind: 'green' }, 3), SHOT_TYPE.PUTT);
});

test('shot planning is deterministic and never deliberately stops in hazards or structures', () => {
  const state = newGame('relaxed', 32001);
  const a = planned(state);
  const b = planned(state);
  assert.deepEqual(a, b);
  assert.ok(![ZONE.WATER, ZONE.OUT].includes(zoneAtWorld(state.course, a.stop)));
  const cellX = (a.stop.x + state.course.w * 4) / 8;
  const cellY = (a.stop.z + state.course.h * 4) / 8;
  assert.ok(!state.course.structures.some((structure) => (
    cellX >= structure.x && cellX < structure.x + structure.w
    && cellY >= structure.y && cellY < structure.y + structure.h
  )));
  assert.ok(a.endMinute > a.flightEndMinute);
  assert.ok(a.distanceYd > 0);
});

test('one trajectory supplies launch, airborne, bounce/roll, and stopped presentation', () => {
  const state = newGame('relaxed', 32002);
  const shot = planned(state);
  assert.equal(sampleBallPosition(shot, shot.startMinute).phase, 'launch');
  const airborne = sampleBallPosition(shot, (shot.startMinute + shot.flightEndMinute) / 2);
  assert.equal(airborne.phase, 'flight');
  assert.ok(airborne.y > shot.start.y);
  assert.ok(['bounce', 'roll'].includes(sampleBallPosition(shot, shot.flightEndMinute + 0.005).phase));
  assert.equal(sampleBallPosition(shot, shot.endMinute + 1).phase, 'stopped');
});

test('handicap-like skill changes real club carry rather than only changing a score label', () => {
  const state = newGame('relaxed', 32003);
  const strong = planned(state, { golfer: { id: 1, name: 'Same Seed', skill: 5 } });
  const developing = planned(state, { golfer: { id: 1, name: 'Same Seed', skill: 27 } });
  assert.ok(strong.distanceYd > developing.distanceYd + 10, `${strong.distanceYd} should exceed ${developing.distanceYd}`);
});

test('wind and occupied landing zones produce deterministic, separated targets', () => {
  const state = newGame('relaxed', 32004);
  const baseline = planned(state);
  const context = {
    seed: state.seed,
    courseCondition: 70,
    greenQuality: 0.7,
    greenSpeed: 9,
    windMph: 18,
    windDirectionRad: 1.2,
    avoidPositions: [{ x: baseline.landing.x, z: baseline.landing.z }],
    minimumSeparationYd: 70,
  };
  const adjusted = planned(state, { context });
  assert.deepEqual(adjusted, planned(state, { context }));
  assert.ok(Math.hypot(
    adjusted.landing.x - baseline.landing.x,
    adjusted.landing.z - baseline.landing.z,
  ) >= 70);
  assert.equal(adjusted.wind.mph, 18);
  assert.equal(adjusted.wind.directionRad, 1.2);
});

test('the sampled arc clears the course terrain between launch and landing', () => {
  const state = newGame('relaxed', 32005);
  const shot = planned(state);
  for (let index = 1; index < 20; index++) {
    const minute = shot.startMinute + (shot.flightEndMinute - shot.startMinute) * (index / 20);
    const point = sampleBallPosition(shot, minute);
    const cellX = Math.max(0, Math.min(state.course.w - 1, Math.floor((point.x + state.course.w * 4) / 8)));
    const cellY = Math.max(0, Math.min(state.course.h - 1, Math.floor((point.z + state.course.h * 4) / 8)));
    const groundY = state.course.elevation[cellY * state.course.w + cellX] * 0.5;
    assert.ok(point.y > groundY, `flight sample ${index} must clear terrain`);
  }
});
