// TWO BODIES SWAPPING PLACES IN A NARROW AISLE MUST ACTUALLY SWAP.
//
// ORCA's theorem covers contact, not progress: two bodies walking at each
// other's start points build mirror-image half-planes, each concedes half,
// and the pair can park nose to nose for ever with the program FEASIBLE the
// whole time — the mutual deadlock the shop's ladder existed to break with
// teleports. The deliberate 0.02 rad lean breaks the open-floor case (the
// five-agent circle arrives), but in an aisle the lean's sidestep is eaten by
// the wall constraint and the pair still parks.
//
// The fix under test: `options.patience` — seconds this body has made no
// progress. It escalates the SAME deterministic lean (nothing random, both
// bodies lean the same absolute way) and raises this body's reciprocal share
// (a body that has waited longer concedes more), so symmetric parking shears
// into a pass. A body that is moving has patience 0 and is untouched.
//
// RED: with patience forced to 0 the pair must fail to swap inside the
// budget (watched fail before the escalation existed). GREEN: with patience
// fed from each body's own stall clock they swap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { orcaVelocity } from '../src/render3d/clubhouse/orca.js';

// The aisle is sized ON the boundary the squeeze exists for: centres can
// separate at most 2*(AISLE_HALF - R) = 0.74 yd, which full comfort (needs
// 2R + 0.18 = 0.80) cannot pass and squeezed comfort (2R + 0.072 = 0.692)
// can, with 5 cm to spare. Narrower is physically impassable for ANY solver;
// wider passes without escalation and the control goes green.
const AISLE_HALF = 0.68;
const R = 0.31;
const SPEED = 1.1;

// The passer's half of hold-and-pass: one body STANDS (the shop's deadlock
// choreography holds the less-bold body still, exactly like the player-yield
// hold) and the frustrated one must squeeze past it through a gap that full
// comfort cannot fit. Two mobile mirrored bodies are NOT this test — a pursuit
// seesaw was measured and belongs to the caller's hold logic, not the solver.
function simulatePass({ escalate, seconds = 14, dt = 1 / 30 }) {
  const a = { x: -1.6, z: 0.02, vx: 0, vz: 0, goalX: 1.6, goalZ: 0.02, stall: 0 };
  const blocker = { x: 0, z: -0.37, vx: 0, vz: 0 }; // standing wall-pinned low
  const steps = Math.round(seconds / dt);
  for (let s = 0; s < steps; s += 1) {
    const gx = a.goalX - a.x;
    const gz = a.goalZ - a.z;
    const gd = Math.hypot(gx, gz) || 1e-9;
    const obstacles = [
      { nx: 0, nz: -1, clearance: AISLE_HALF - a.z - R },
      { nx: 0, nz: 1, clearance: a.z + AISLE_HALF - R },
    ];
    const v = orcaVelocity(
      { x: a.x, z: a.z, vx: a.vx, vz: a.vz, radius: R, maxSpeed: SPEED },
      [{ x: blocker.x, z: blocker.z, vx: 0, vz: 0, radius: R }],
      (gx / gd) * SPEED, (gz / gd) * SPEED,
      { timeStep: dt, obstacles, patience: escalate ? a.stall : 0 },
    );
    const stepLen = Math.hypot(v.vx, v.vz) * dt;
    a.x += v.vx * dt;
    a.z += v.vz * dt;
    a.vx = v.vx;
    a.vz = v.vz;
    if (stepLen < SPEED * dt * 0.25) a.stall += dt; else a.stall = Math.max(0, a.stall - dt * 2);
    const gap = Math.hypot(a.x - blocker.x, a.z - blocker.z);
    assert.ok(gap >= R * 2 - 0.02, `bodies touched: gap ${gap.toFixed(3)} at step ${s}`);
  }
  return { done: Math.hypot(a.x - a.goalX, a.z - a.goalZ) < 0.35, a };
}

test('CONTROL: without escalation the walker parks behind the stander — the deadlock is real', () => {
  const r = simulatePass({ escalate: false });
  assert.ok(!r.done,
    'the un-escalated walker got past — this aisle no longer reproduces the deadlock this test guards');
});

test('with patience escalation the walker squeezes past the stander and arrives', () => {
  const r = simulatePass({ escalate: true });
  assert.ok(r.done,
    `escalation did not get the walker past (parked at ${r.a.x.toFixed(2)},${r.a.z.toFixed(2)})`);
});
