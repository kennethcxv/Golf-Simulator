// CROWD — the properties the owner's screenshot says are missing.
//
// He photographed a shopper mid-stride passing THROUGH the body of the person in
// front of them in the queue, and reported "the npc running into the line"
// across several rounds. The tests below are written from that picture: two
// people must not end up inside each other, a queue must not be shoved out of
// shape by someone walking past it, and none of it may depend on which actor the
// pool happens to update first.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_RADIUS, avoidanceHeading, separate, makeStuckWatch, STUCK_ACTION,
} from '../src/render3d/clubhouse/crowd.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const TOUCHING = BODY_RADIUS * 2;

test('two people walking straight at each other both turn, and not into each other', () => {
  const a = { x: -2, z: 0, vx: 1.2, vz: 0 };
  const b = { x: 2, z: 0, vx: -1.2, vz: 0 };
  const ha = avoidanceHeading(a, [b], 1, 0, 1.2);
  const hb = avoidanceHeading(b, [a], -1, 0, 1.2);
  assert.equal(ha.avoided, true, 'the closing pair must be seen as a threat');
  assert.equal(hb.avoided, true);
  // They must pick OPPOSITE lateral directions, or they mirror and re-collide.
  assert.ok(ha.z * hb.z < 0,
    `head-on pair must pass on the same side: got ${ha.z.toFixed(3)} and ${hb.z.toFixed(3)}`);
});

test('someone walking past is not treated as a threat', () => {
  // Crossing well clear, behind. Reacting here is what makes a room look nervous.
  const self = { x: 0, z: 0, vx: 1.2, vz: 0 };
  const other = { x: -3, z: 3, vx: 0, vz: -1.2 };
  const h = avoidanceHeading(self, [other], 1, 0, 1.2);
  assert.equal(h.avoided, false, 'a neighbour that never gets close must be ignored');
  assert.equal(h.x, 1);
});

test('a moving actor goes around a PINNED queue member instead of through it', () => {
  const walker = { x: 0, z: -2, vx: 0, vz: 1.4 };
  const queuer = { x: 0, z: 0, vx: 0, vz: 0, pinned: true };
  const h = avoidanceHeading(walker, [queuer], 0, 1, 1.4);
  assert.equal(h.avoided, true);
  assert.ok(Math.abs(h.x) > 0.2,
    `must acquire lateral heading to clear a standing person, got x=${h.x.toFixed(3)}`);
});

test('separation pulls an overlapping pair apart, and is symmetric', () => {
  const a = { x: -0.1, z: 0 };
  const b = { x: 0.1, z: 0 };
  const overlaps = separate([a, b]);
  assert.equal(overlaps, 1);
  assert.ok(dist(a, b) > TOUCHING,
    `pair still interpenetrating at ${dist(a, b).toFixed(3)} (touching is ${TOUCHING.toFixed(3)})`);
  // symmetric: both moved by the same amount, in opposite directions
  assert.ok(Math.abs(Math.abs(a.x - -0.1) - Math.abs(b.x - 0.1)) < 1e-9,
    'both bodies must take an equal share of the correction');
});

test('the result does not depend on actor order — the old resolution did', () => {
  const build = () => ([
    { x: 0, z: 0 }, { x: 0.18, z: 0.05 }, { x: -0.12, z: 0.09 }, { x: 0.05, z: -0.15 },
  ]);
  const forward = build();
  separate(forward);
  const backward = build().reverse();
  separate(backward);
  backward.reverse();
  for (let i = 0; i < forward.length; i += 1) {
    assert.ok(dist(forward[i], backward[i]) < 1e-9,
      `body ${i} resolved differently depending on order: ${JSON.stringify(forward[i])} vs ${JSON.stringify(backward[i])}`);
  }
});

test('a pinned body is never shoved out of the line by someone walking into it', () => {
  const queue = [
    { x: 0, z: 0, pinned: true },
    { x: 0, z: 0.7, pinned: true },
    { x: 0, z: 1.4, pinned: true },
  ];
  const before = queue.map((q) => ({ ...q }));
  const barger = { x: 0, z: 0.72 }; // standing right on top of the second in line
  separate([...queue, barger]);
  for (let i = 0; i < queue.length; i += 1) {
    assert.ok(dist(queue[i], before[i]) < 1e-9,
      `queue member ${i} was pushed out of the line`);
  }
  assert.ok(dist(barger, before[1]) > TOUCHING,
    'and the one who barged in is the one that gets moved');
});

test('a whole clump untangles, with nobody left inside anybody', () => {
  const bodies = [];
  for (let i = 0; i < 9; i += 1) bodies.push({ x: (i % 3) * 0.14, z: Math.floor(i / 3) * 0.14 });
  separate(bodies, { iterations: 12 });
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      assert.ok(dist(bodies[i], bodies[j]) > TOUCHING * 0.95,
        `bodies ${i} and ${j} still overlap at ${dist(bodies[i], bodies[j]).toFixed(3)}`);
    }
  }
});

test('two bodies at exactly the same point still separate', () => {
  const a = { x: 1, z: 1 };
  const b = { x: 1, z: 1 };
  separate([a, b], { iterations: 12 });
  assert.ok(dist(a, b) > 0.01, 'coincident bodies must not stay coincident');
});

test('separation never pushes a body through a wall the clamp defends', () => {
  // A wall at x = 0.5: nothing may end up past it.
  const clampToWorld = (x, z, r) => ({ x: Math.min(x, 0.5 - r), z });
  const a = { x: 0.1, z: 0 };
  const b = { x: 0.2, z: 0 };
  separate([a, b], { iterations: 8 }, clampToWorld);
  for (const body of [a, b]) {
    assert.ok(body.x <= 0.5 - BODY_RADIUS + 1e-9,
      `body pushed through the wall to x=${body.x.toFixed(3)}`);
  }
});

test('stuck escalation goes nudge, then repath, then unstick, once each', () => {
  const watch = makeStuckWatch();
  const seen = [];
  for (let i = 0; i < 300; i += 1) {
    const action = watch.tick(0, 1 / 60, true);
    if (action !== STUCK_ACTION.NONE) seen.push(action);
  }
  assert.deepEqual(seen, [STUCK_ACTION.NUDGE, STUCK_ACTION.REPATH, STUCK_ACTION.UNSTICK],
    'each remedy fires once, in order, rather than sixty times a second');
});

test('an actor that is deliberately standing still is never called stuck', () => {
  const watch = makeStuckWatch();
  for (let i = 0; i < 600; i += 1) {
    assert.equal(watch.tick(0, 1 / 60, false), STUCK_ACTION.NONE,
      'queueing and being served must not trip the stuck timer');
  }
});

test('movement clears the stall, so a slow shuffle is not an emergency', () => {
  const watch = makeStuckWatch();
  for (let i = 0; i < 200; i += 1) {
    const action = watch.tick(0.5 * (1 / 60), 1 / 60, true); // 0.5 yd/s
    assert.equal(action, STUCK_ACTION.NONE);
  }
});
