import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import { ZONE } from '../src/sim/constants.js';
import {
  buildCourseRouteNetwork,
  ensureCourseRouteNetwork,
  findCourseRoute,
  gridPoint,
  routeDistance,
  zoneAtWorld,
} from '../src/sim/golfRoutes.js';

test('course route network is deterministic, cached, and covers every live hole', () => {
  const state = newGame('relaxed', 31001);
  const first = buildCourseRouteNetwork(state.course);
  const second = buildCourseRouteNetwork(state.course);
  assert.deepEqual(first, second);
  assert.equal(ensureCourseRouteNetwork(state.course, first), first, 'unchanged course retains cached network');
  assert.equal(first.holes.length, state.course.holes.length);
  assert.ok(first.facilities.clubhouse);
  assert.equal(first.facilities.range.bays.length, 6);
  assert.equal(first.facilities.putting.positions.length, 6);
  assert.equal(first.facilities.chipping.positions.length, 4);
  assert.ok(first.holes.every((hole) => routeDistance(hole.play.walk) > 0));
  assert.ok(first.holes.every((hole) => routeDistance(hole.play.cart) > 0));
});

test('walking and cart routes honor the actual course surface restrictions', () => {
  const state = newGame('relaxed', 31002);
  const hole = state.course.holes[3];
  const walk = findCourseRoute(state.course, hole.tee, hole.pin, 'walk');
  const cart = findCourseRoute(state.course, hole.tee, hole.pin, 'cart', { parkNearGoal: true });
  assert.ok(walk.length >= 2);
  assert.ok(cart.length >= 2);
  assert.ok(walk.every((point) => zoneAtWorld(state.course, point) !== ZONE.WATER));
  assert.ok(cart.every((point) => ![ZONE.WATER, ZONE.GREEN, ZONE.BUNKER].includes(zoneAtWorld(state.course, point))));
});

test('an edited routing surface invalidates the cache without mutating the course', () => {
  const state = newGame('relaxed', 31003);
  const before = buildCourseRouteNetwork(state.course);
  const point = before.holes[0].play.walk[Math.floor(before.holes[0].play.walk.length / 2)];
  const cell = gridPoint(state.course, point);
  const index = cell.y * state.course.w + cell.x;
  const prior = state.course.zones[index];
  state.course.zones[index] = prior === ZONE.PATH ? ZONE.ROUGH : ZONE.PATH;
  const after = ensureCourseRouteNetwork(state.course, before);
  assert.notEqual(after, before);
  assert.notEqual(after.revision, before.revision);
  assert.equal(state.course.zones[index], prior === ZONE.PATH ? ZONE.ROUGH : ZONE.PATH);
});
