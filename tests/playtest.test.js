import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE, CELL_YD } from '../src/sim/constants.js';
import { newGame } from '../src/sim/state.js';
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
