// ORCA — the guarantee, checked as a guarantee.
//
// The old crowd tests assert PROPERTIES OF ONE CALL: "the pair sees a threat",
// "the heading acquires a lateral component". Every one of them passed while the
// owner watched people rub against each other, because a heading that bends is
// not the same claim as a pair that never touches. So these tests SIMULATE —
// they step bodies forward at a real frame rate, with no positional separation
// pass of any kind, and assert the one thing that matters: the minimum distance
// any pair ever reached.
//
// THE NEGATIVE CONTROL SHIPS WITH THE INSTRUMENT. The first test drives the
// identical scenario through the OLD heading-bend heuristic (`avoidanceHeading`
// plus the walker loop's crowdSlow bands, which is exactly what the game ran)
// and asserts that it DOES produce contact. Without it, "ORCA never touched" is
// a claim about a scenario that might have been impossible to fail — and this
// repository has shipped that mistake often enough to have a file about it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_RADIUS, avoidanceHeading, CROWD_DEFAULTS } from '../src/render3d/clubhouse/crowd.js';
import { orcaVelocity, ORCA_DEFAULTS } from '../src/render3d/clubhouse/orca.js';

const TOUCHING = BODY_RADIUS * 2; // 0.62 — bodies interpenetrating
const DT = 1 / 60;

/**
 * Step a set of goal-seeking bodies with the given solver. Velocities for the
 * whole set are computed from ONE snapshot and applied together, because
 * reciprocity means both parties reason about the same instant — resolving in
 * array order is the fault the crowd module was written to remove.
 */
function simulate(agents, solve, { seconds = 12, dt = DT } = {}) {
  const steps = Math.round(seconds / dt);
  let minDistance = Infinity;
  let firstContactAt = null;
  const next = agents.map(() => ({ vx: 0, vz: 0 }));
  // Scanned at the TOP of each step and once after the last one, so the starting
  // configuration is inside the window. Scanning only after the step hid the
  // opening state, which made the deliberately-overlapped case read as clean.
  const scan = (at) => {
    for (let i = 0; i < agents.length; i += 1) {
      for (let j = i + 1; j < agents.length; j += 1) {
        const d = Math.hypot(agents[i].x - agents[j].x, agents[i].z - agents[j].z);
        if (d < minDistance) minDistance = d;
        if (d < TOUCHING && firstContactAt === null) firstContactAt = +at.toFixed(2);
      }
    }
  };
  for (let s = 0; s < steps; s += 1) {
    scan(s * dt);
    for (let i = 0; i < agents.length; i += 1) {
      const others = agents.filter((_, j) => j !== i);
      const v = solve(agents[i], others, dt);
      next[i].vx = v.vx;
      next[i].vz = v.vz;
    }
    for (let i = 0; i < agents.length; i += 1) {
      const a = agents[i];
      a.vx = next[i].vx;
      a.vz = next[i].vz;
      a.x += a.vx * dt;
      a.z += a.vz * dt;
    }
  }
  scan(seconds);
  const shortfall = agents.map((a) => (a.goalX === undefined
    ? 0 : Math.hypot(a.goalX - a.x, a.goalZ - a.z)));
  return { minDistance, firstContactAt, seconds, worstShortfall: Math.max(...shortfall) };
}

const preferred = (a, dt) => {
  const gx = a.goalX - a.x;
  const gz = a.goalZ - a.z;
  const d = Math.hypot(gx, gz);
  if (!(d > 1e-6)) return { x: 0, z: 0, dist: 0 };
  const speed = Math.min(a.maxSpeed, d / dt);
  return { x: (gx / d) * speed, z: (gz / d) * speed, dist: d };
};

const orcaSolveWith = (options) => (a, others, dt) => {
  const pref = preferred(a, dt);
  const r = orcaVelocity(
    { x: a.x, z: a.z, vx: a.vx, vz: a.vz, radius: BODY_RADIUS, maxSpeed: a.maxSpeed },
    others,
    pref.x, pref.z,
    { timeStep: dt, ...options },
  );
  return { vx: r.vx, vz: r.vz, infeasible: r.infeasible };
};
const orcaSolve = orcaSolveWith({});

// The game as it shipped: avoidanceHeading bends the heading, and the walker
// loop scales the step by urgency band. Transcribed from clubhouse.js ~12607.
const legacySolve = (a, others, dt) => {
  const pref = preferred(a, dt);
  if (!(pref.dist > 1e-6)) return { vx: 0, vz: 0 };
  const speed = Math.hypot(pref.x, pref.z);
  const h = avoidanceHeading(
    { x: a.x, z: a.z, vx: a.vx, vz: a.vz },
    others, pref.x, pref.z, speed,
  );
  let slow = 1;
  if (h.avoided) {
    const urgency = h.threat?.urgency ?? 0;
    if (urgency >= 2) slow = 0.35;
    else if (urgency > 1.2) slow = 0.6;
  }
  return { vx: h.x * speed * slow, vz: h.z * speed * slow };
};

const ring = (n, radius, maxSpeed = 1.2) => Array.from({ length: n }, (_, i) => {
  const angle = (i / n) * Math.PI * 2;
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    vx: 0,
    vz: 0,
    maxSpeed,
    goalX: -Math.cos(angle) * radius,
    goalZ: -Math.sin(angle) * radius,
  };
});

// --- the negative control ---------------------------------------------------

test('NEGATIVE CONTROL: the shipped heading-bend heuristic collides in this scenario', () => {
  const result = simulate(ring(5, 3.5), legacySolve, { seconds: 12 });
  assert.ok(result.minDistance < TOUCHING,
    'the crossing scenario must be capable of producing contact, or "ORCA never touched" '
    + `proves nothing. Legacy closest approach was ${result.minDistance.toFixed(3)} yd.`);
});

test('NEGATIVE CONTROL: the shipped heuristic also STRANDS them in this scenario', () => {
  // The other absolute needs its own control, or "nobody gets stuck" is a claim
  // about a scenario in which nobody could have been. Under the old rule the
  // worst walker finishes about 4 yd short of a 7 yd crossing.
  const result = simulate(ring(5, 3.5), legacySolve, { seconds: 14 });
  assert.ok(result.worstShortfall > 2,
    'the crossing scenario must be capable of stranding a walker; the old rule left the worst '
    + `one ${result.worstShortfall.toFixed(2)} yd short`);
});

// --- the guarantee ----------------------------------------------------------

test('five crossing walkers never touch, with no separation pass at all', () => {
  const agents = ring(5, 3.5);
  const result = simulate(agents, orcaSolve, { seconds: 14 });
  assert.ok(result.minDistance > TOUCHING,
    `closest approach ${result.minDistance.toFixed(3)} yd is inside touching (${TOUCHING}) `
    + `at t=${result.firstContactAt}s`);
  // ...and the comfort margin is real, not a suggestion something else enforces.
  const held = BODY_RADIUS * 2 + ORCA_DEFAULTS.comfort;
  assert.ok(result.minDistance > held - 0.02,
    `pairs must be held at the full comfort distance ${held}, got ${result.minDistance.toFixed(3)}`);
});

test('nobody gets stuck: every crossing walker reaches its goal', () => {
  const agents = ring(5, 3.5);
  simulate(agents, orcaSolve, { seconds: 16 });
  for (const a of agents) {
    const d = Math.hypot(a.goalX - a.x, a.goalZ - a.z);
    assert.ok(d < 0.35, `a walker finished ${d.toFixed(2)} yd short of its goal`);
  }
});

test('the keep-to-one-side lean is what breaks perfect symmetry, and it is load-bearing', () => {
  // CONTROL FIRST: pure ORCA, bias off. It is contact-free — the theorem holds —
  // and every walker is stranded. This is the measurement that put the lean in
  // the module, and it stays here so that removing the lean fails loudly rather
  // than quietly reintroducing a deadlock the overlap counters would call clean.
  const unbiased = simulate(ring(5, 3.5), orcaSolveWith({ bias: 0 }), { seconds: 14 });
  assert.ok(unbiased.minDistance > TOUCHING,
    'pure ORCA must still be contact-free — the deadlock is a progress failure, not a contact one');
  assert.ok(unbiased.worstShortfall > 2,
    `perfect symmetry must deadlock without the lean; worst shortfall ${unbiased.worstShortfall.toFixed(2)} yd`);

  const biased = simulate(ring(5, 3.5), orcaSolve, { seconds: 14 });
  assert.ok(biased.worstShortfall < 0.05,
    `with the lean every walker must arrive; worst shortfall ${biased.worstShortfall.toFixed(3)} yd`);
  assert.ok(biased.minDistance > TOUCHING,
    `and the lean must not cost the guarantee; closest ${biased.minDistance.toFixed(3)} yd`);
});

test('the solver holds pairs FURTHER apart than the separation pass demands', () => {
  // The band between the two thresholds is where the shoving lived. ORCA held
  // 0.72 yd; separate() called anything under 0.78 a violation and pushed. Every
  // pair the solver held perfectly legally in that six centimetres was corrected
  // by the pass behind it — measured under a staged pinch as legacy 2.20
  // shoves/s versus ORCA 2.38, i.e. the velocity solver doing no good at all,
  // for a reason that had nothing to do with the velocities.
  const separateWants = BODY_RADIUS * 2 + CROWD_DEFAULTS.comfort;
  const orcaHolds = BODY_RADIUS * 2 + ORCA_DEFAULTS.comfort;
  assert.ok(orcaHolds > separateWants,
    `ORCA holds pairs at ${orcaHolds.toFixed(3)} yd but separate() demands ${separateWants.toFixed(3)} — `
    + 'every pair in between gets shoved by a pass that should have had nothing to do');
});

test('the lean does not bend a walker who has the room to itself', () => {
  const r = orcaVelocity({ x: 0, z: 0, vx: 1, vz: 0, maxSpeed: 1.2 }, [], 1.2, 0, { timeStep: DT });
  assert.equal(+r.vz.toFixed(9), 0, 'an empty room must return the wanted velocity exactly');
});

test('two walking straight at each other pass, and pass wide', () => {
  const pair = [
    { x: -3, z: 0, vx: 0, vz: 0, maxSpeed: 1.2, goalX: 3, goalZ: 0 },
    { x: 3, z: 0.02, vx: 0, vz: 0, maxSpeed: 1.2, goalX: -3, goalZ: 0.02 },
  ];
  const result = simulate(pair, orcaSolve, { seconds: 10 });
  assert.ok(result.minDistance > TOUCHING,
    `head-on pair closed to ${result.minDistance.toFixed(3)} yd`);
  for (const a of pair) {
    assert.ok(Math.hypot(a.goalX - a.x, a.goalZ - a.z) < 0.35, 'head-on pair must still get past');
  }
});

test('a neighbour that does not reciprocate is avoided entirely by the other party', () => {
  // The player walks a straight line and never dodges. The walker must clear
  // them alone — this is the case where taking half the correction is wrong.
  const walker = { x: 0, z: -3, vx: 0, vz: 0, maxSpeed: 1.2, goalX: 0, goalZ: 3 };
  const player = { x: 0, z: 3, vx: 0, vz: -1.2, radius: 0.4, reciprocal: false };
  let minDistance = Infinity;
  for (let s = 0; s < 60 * 8; s += 1) {
    const pref = preferred(walker, DT);
    const r = orcaVelocity(
      { x: walker.x, z: walker.z, vx: walker.vx, vz: walker.vz, radius: BODY_RADIUS, maxSpeed: 1.2 },
      [player], pref.x, pref.z, { timeStep: DT },
    );
    walker.vx = r.vx;
    walker.vz = r.vz;
    walker.x += walker.vx * DT;
    walker.z += walker.vz * DT;
    player.x += (player.vx || 0) * DT;
    player.z += player.vz * DT;
    if (player.z < -3) player.vz = 0;
    minDistance = Math.min(minDistance, Math.hypot(walker.x - player.x, walker.z - player.z));
  }
  assert.ok(minDistance > BODY_RADIUS + 0.4,
    `walker closed to ${minDistance.toFixed(3)} yd of a player who never dodged`);
});

test('an empty room returns exactly the velocity that was wanted', () => {
  const r = orcaVelocity({ x: 0, z: 0, vx: 0, vz: 0, maxSpeed: 1.4 }, [], 0.9, -0.4, { timeStep: DT });
  assert.equal(+r.vx.toFixed(6), 0.9);
  assert.equal(+r.vz.toFixed(6), -0.4);
  assert.equal(r.lines, 0);
  assert.equal(r.infeasible, false);
  assert.equal(+r.yielded.toFixed(6), 0);
});

test('the max speed is never exceeded, however hard the crowd pushes', () => {
  const crowd = [
    { x: 0.4, z: 0, vx: -1.2, vz: 0, reciprocal: false },
    { x: -0.4, z: 0, vx: 1.2, vz: 0, reciprocal: false },
    { x: 0, z: 0.4, vx: 0, vz: -1.2, reciprocal: false },
    { x: 0, z: -0.4, vx: 0, vz: 1.2, reciprocal: false },
  ];
  const r = orcaVelocity({ x: 0, z: 0, vx: 0, vz: 0, maxSpeed: 1.2 }, crowd, 1.2, 0, { timeStep: DT });
  assert.ok(Number.isFinite(r.vx) && Number.isFinite(r.vz), `NaN velocity: ${r.vx}, ${r.vz}`);
  assert.ok(Math.hypot(r.vx, r.vz) <= 1.2 + 1e-6,
    `speed ${Math.hypot(r.vx, r.vz).toFixed(3)} exceeds the body's maximum`);
});

test('a boxed-in body reports the jam instead of returning a velocity that pretends', () => {
  // Four non-reciprocating bodies pressed in on every side. There is no velocity
  // that satisfies all four; the honest answer is the least-bad one, flagged.
  const crowd = [
    { x: 0.45, z: 0, vx: -0.8, vz: 0, reciprocal: false },
    { x: -0.45, z: 0, vx: 0.8, vz: 0, reciprocal: false },
    { x: 0, z: 0.45, vx: 0, vz: -0.8, reciprocal: false },
    { x: 0, z: -0.45, vx: 0, vz: 0.8, reciprocal: false },
  ];
  const r = orcaVelocity({ x: 0, z: 0, vx: 0, vz: 0, maxSpeed: 1.2 }, crowd, 1.2, 0, { timeStep: DT });
  assert.equal(r.infeasible, true, 'a body with no safe velocity must say so');
  assert.ok(r.penetration > 0, 'and must report how deep the contact already is');
  assert.ok(Number.isFinite(r.vx) && Number.isFinite(r.vz));
});

test('the answer does not depend on the order neighbours arrive in', () => {
  const self = { x: 0, z: 0, vx: 0.8, vz: 0.1, radius: BODY_RADIUS, maxSpeed: 1.2 };
  const near = [
    { x: 1.4, z: 0.2, vx: -0.9, vz: 0 },
    { x: 1.1, z: -0.9, vx: -0.4, vz: 0.6 },
    { x: -0.9, z: 0.7, vx: 0.7, vz: -0.3 },
  ];
  const a = orcaVelocity(self, near, 1.2, 0, { timeStep: DT });
  const first = { vx: a.vx, vz: a.vz };
  const b = orcaVelocity(self, [near[2], near[0], near[1]], 1.2, 0, { timeStep: DT });
  assert.ok(Math.hypot(first.vx - b.vx, first.vz - b.vz) < 1e-9,
    `reordering the neighbours changed the answer: (${first.vx}, ${first.vz}) vs (${b.vx}, ${b.vz})`);
});

test('overlapping bodies are separated by the VELOCITY, within a frame', () => {
  // The guarantee is supposed to make this unreachable in play; it is here
  // because a solver with no answer for its own failure case cannot be trusted,
  // and because spawns and the recovery ladder can still place a body inside
  // somebody.
  const a = { x: 0, z: 0, vx: 0, vz: 0, maxSpeed: 1.2, goalX: 0, goalZ: 0 };
  const b = { x: 0.2, z: 0, vx: 0, vz: 0, maxSpeed: 1.2, goalX: 0.2, goalZ: 0 };
  const result = simulate([a, b], orcaSolve, { seconds: 2 });
  const finalGap = Math.hypot(a.x - b.x, a.z - b.z);
  assert.ok(finalGap > TOUCHING,
    `bodies started inside each other and were still at ${finalGap.toFixed(3)} yd after 2 s`);
  assert.ok(result.minDistance <= 0.2 + 1e-6, 'the run must actually have started overlapped');
});
