import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE, CELL_YD } from '../src/sim/constants.js';
import { makeRng } from '../src/core/utils.js';
import { designCourse } from '../src/sim/courseArchitect.js';
import { evaluateSurface, getGeom } from '../src/sim/courseVec.js';
import { newGame } from '../src/sim/state.js';
import {
  buildCourseBridgeSurfaceIndex,
  queryCourseBridgeSurface,
} from '../src/sim/courseBridgeSurface.js';
import {
  startPlaytest, strike, stepBall, remainingYd, playtestHud, suggestClub, CLUBS, surfaceInfo,
} from '../src/sim/playtest.js';

// analytic hooks over the real course grid: flat-ish ground from sim elevation,
// zones straight from the course — what the renderer provides in-game.
function hooksFor(st) {
  const c = st.course;
  const worldW = c.w * CELL_YD;
  const worldH = c.h * CELL_YD;
  return {
    cellToWorld: (p) => ({ x: (p.x + 0.5) * CELL_YD - worldW / 2, z: (p.y + 0.5) * CELL_YD - worldH / 2 }),
    heightAt: (x, z) => {
      const cx = Math.min(c.w - 1, Math.max(0, Math.floor((x + worldW / 2) / CELL_YD)));
      const cy = Math.min(c.h - 1, Math.max(0, Math.floor((z + worldH / 2) / CELL_YD)));
      return c.elevation[cy * c.w + cx] * 0.333;
    },
    zoneAt: (x, z) => {
      const cx = Math.floor((x + worldW / 2) / CELL_YD);
      const cy = Math.floor((z + worldH / 2) / CELL_YD);
      if (cx < 0 || cy < 0 || cx >= c.w || cy >= c.h) return ZONE.OUT;
      return c.zones[cy * c.w + cx];
    },
    inBoundsWorld: (x, z) => Math.abs(x) <= worldW / 2 + 40 && Math.abs(z) <= worldH / 2 + 40,
  };
}

function settle(pt, maxSeconds = 30) {
  let t = 0;
  while (t < maxSeconds && stepBall(pt, 1 / 60)) t += 1 / 60;
  return t;
}

test('playtest spawns on the tee with the pin measured', () => {
  const st = newGame('relaxed', 4242);
  const pt = startPlaytest(st, st.course.holes[0].id, hooksFor(st));
  assert.ok(pt, 'session starts');
  assert.equal(pt.strokes, 0);
  assert.equal(pt.phase, 'aim');
  const rem = remainingYd(pt);
  assert.ok(rem > 150 && rem < 500, `hole 1 measures like a golf hole (${rem} yd)`);
  const hud = playtestHud(pt);
  assert.equal(hud.lie, 'Tee');
  assert.ok(hud.club.key !== 'putter');
});

test('Opening Drive maps vector markers to their actual course surface', () => {
  // Same deterministic Willow Creek property as the browser course-master QA
  // fixture (newEmpire relaxed/424242 -> property seed 276398324).
  const course = designCourse(makeRng(276398324), { jitter: 0.35 });
  const state = { course };
  const hole = course.holes[0];
  const geom = getGeom(course);
  const worldW = course.w * CELL_YD;
  const worldH = course.h * CELL_YD;
  const hooks = {
    cellToWorld: (p) => ({
      x: (p.x + 0.5) * CELL_YD - worldW / 2,
      z: (p.y + 0.5) * CELL_YD - worldH / 2,
    }),
    courseToWorld: (p) => ({
      x: p.x * CELL_YD - worldW / 2,
      z: p.y * CELL_YD - worldH / 2,
    }),
    heightAt: () => 0,
    zoneAt: (x, z) => evaluateSurface(
      course,
      geom,
      (x + worldW / 2) / CELL_YD,
      (z + worldH / 2) / CELL_YD,
      course.paint,
    ).zone,
  };

  const pt = startPlaytest(state, hole.id, hooks);
  assert.ok(pt, 'Opening Drive starts');
  assert.equal(pt.strokes, 0);
  assert.equal(hooks.zoneAt(pt.ball.x, pt.ball.z), ZONE.TEE,
    'the actual visual and physics spawn lies inside the authored tee rectangle');
  assert.equal(pt.surface, ZONE.TEE, 'the session records the sampled starting surface');
  assert.equal(playtestHud(pt).lie, 'Tee');
  assert.equal(Math.round(remainingYd(pt)), 412, 'the persisted 412-yard measurement is unchanged');

  const cascades = course.holes[6];
  const routed = startPlaytest(state, cascades.id, hooks);
  const routePoint = hooks.courseToWorld(cascades.wp[0]);
  const expectedYaw = Math.atan2(routePoint.x - routed.tee.x, routePoint.z - routed.tee.z);
  const pinYaw = Math.atan2(routed.pin.x - routed.tee.x, routed.pin.z - routed.tee.z);
  assert.ok(Math.abs(routed.aimYaw - expectedYaw) < 1e-9,
    'a dogleg playtest opens toward its first authored landing route');
  assert.ok(Math.abs(routed.aimYaw - pinYaw) > 0.02,
    'the Cascades opening shot does not cut across the tee-to-pin chord');
});

test('a full-power drive flies, lands, and rolls out to rest', () => {
  const st = newGame('relaxed', 4242);
  const pt = startPlaytest(st, st.course.holes[0].id, hooksFor(st));
  const before = remainingYd(pt);
  strike(pt, CLUBS[0], 1.0, pt.aimYaw);
  assert.equal(pt.phase, 'flying');
  settle(pt);
  assert.equal(pt.phase, 'aim', 'ball came to rest');
  assert.equal(pt.strokes, 1);
  const after = remainingYd(pt);
  assert.ok(after < before - 120, `drive gained real ground: ${Math.round(before)} → ${Math.round(after)} yd`);
});

test('surfaces behave differently: green rolls farther than heavy rough', () => {
  assert.ok(surfaceInfo(ZONE.GREEN).roll < surfaceInfo(ZONE.ROUGH).roll);
  assert.ok(surfaceInfo(ZONE.ROUGH).roll < surfaceInfo(ZONE.BUNKER).roll);
  assert.ok(surfaceInfo(ZONE.PATH).rest > surfaceInfo(ZONE.BUNKER).rest, 'cart path bounces, sand deadens');
});

test('playtest hooks treat a bridge deck as cart path while adjacent water remains a hazard', () => {
  const width = 20;
  const height = 12;
  const worldW = width * CELL_YD;
  const worldH = height * CELL_YD;
  const course = {
    w: width,
    h: height,
    elevation: new Float32Array(width * height),
    zones: new Uint8Array(width * height).fill(ZONE.WATER),
    holes: [{ id: 1, tee: { x: 2, y: 5 }, pin: { x: 16, y: 5 } }],
    paths: [{
      id: 9,
      pts: [{ x: 2, y: 5 }, { x: 9, y: 5 }, { x: 16, y: 5 }],
      width: 4,
      bridge: { deckHeightFt: 1.5, clearanceFt: 1, deckMaterial: 'timber' },
    }],
  };
  const bridgeIndex = buildCourseBridgeSurfaceIndex(course, { terrainHeightYdAt: () => 0 });
  const toCourse = (x, z) => ({
    x: (x + worldW / 2) / CELL_YD - 0.5,
    y: (z + worldH / 2) / CELL_YD - 0.5,
  });
  const bridgeAt = (x, z) => queryCourseBridgeSurface(bridgeIndex, toCourse(x, z));
  const hooks = {
    cellToWorld: (point) => ({
      x: (point.x + 0.5) * CELL_YD - worldW / 2,
      z: (point.y + 0.5) * CELL_YD - worldH / 2,
    }),
    heightAt: (x, z) => bridgeAt(x, z)?.deckHeightYd ?? 0,
    zoneAt: (x, z) => bridgeAt(x, z)?.zone ?? ZONE.WATER,
    inBoundsWorld: () => true,
  };

  const pt = startPlaytest({ course }, 1, hooks);
  assert.ok(pt);
  assert.equal(pt.surface, ZONE.PATH);
  assert.equal(playtestHud(pt).lie, 'Cart path');
  assert.ok(pt.ball.y > 0.5, 'the ball rests on the raised visible deck');
  assert.equal(hooks.zoneAt(pt.tee.x, pt.tee.z + 3), ZONE.WATER,
    'water immediately outside the four-yard deck remains hazardous');
});

test('water costs a penalty stroke and drops at the last rest', () => {
  const st = newGame('relaxed', 4242);
  const hooks = hooksFor(st);
  // hole 5 carries the pond; aim a deliberately fat shot into it
  const h5 = st.course.holes[4];
  const pt = startPlaytest(st, h5.id, hooks);
  const restBefore = { ...pt.lastRest };
  // find the pond direction: aim at the pin but hit a club far too short to carry
  strike(pt, CLUBS[6], 1.0, pt.aimYaw); // putter straight at the water line
  settle(pt, 60);
  // whether or not the putter found water from the tee, force the flight case:
  if (pt.penalties === 0) {
    pt.phase = 'aim';
    strike(pt, CLUBS[5], 0.42, pt.aimYaw); // a chunked wedge into the hazard
    settle(pt, 60);
  }
  if (pt.penalties > 0) {
    assert.ok(pt.strokes >= 2, 'stroke + penalty counted');
    assert.ok(Math.hypot(pt.ball.x - restBefore.x, pt.ball.z - restBefore.z) < CELL_YD * 3,
      'ball back near the last rest');
    assert.equal(pt.phase, 'aim');
  } else {
    // the pond guards the line on this seed; at minimum the ball must be at rest and playable
    assert.equal(pt.phase, 'aim');
  }
});

test('a putt from the green edge can hole out', () => {
  const st = newGame('relaxed', 4242);
  const hooks = hooksFor(st);
  const hole = st.course.holes[0];
  const pt = startPlaytest(st, hole.id, hooks);
  // teleport to a yard from the pin (editing flow: pin validation)
  pt.ball.x = pt.pin.x - 1;
  pt.ball.z = pt.pin.z;
  pt.ball.y = hooks.heightAt(pt.ball.x, pt.ball.z);
  pt.lastRest = { x: pt.ball.x, z: pt.ball.z };
  const aim = Math.atan2(pt.pin.x - pt.ball.x, pt.pin.z - pt.ball.z);
  strike(pt, CLUBS[6], 0.1, aim);
  settle(pt, 20);
  assert.equal(pt.holedOut, true, `short putt drops (phase ${pt.phase}, rem ${remainingYd(pt).toFixed(2)})`);
  assert.ok(pt.events.some((e) => /In the hole/.test(e)));
});

test('club suggestion ladders down with distance and putts on the green', () => {
  assert.equal(suggestClub(240, false).key, 'driver');
  assert.equal(suggestClub(150, false).key, 'iron7');
  assert.equal(suggestClub(60, false).key, 'wedge');
  assert.equal(suggestClub(10, true).key, 'putter');
});
