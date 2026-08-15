// G (Goal 20) — a customer changes course BEFORE contact.
//
// What this replaces is penetration resolution: the actor took its step, and if
// the new position was inside a collider it was pushed back out through the
// nearest face. That can never avoid anything, because it only runs once the
// actor is already in the box. Underneath it sat a one-second blocked timer,
// which reacts later still. Both stay; this is the half that was missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { steerAround, STEER_DEFAULTS } from '../src/render3d/clubhouse/steerAhead.js';

// a hand-drawn room: axis-aligned boxes, the same shape the clubhouse uses
const boxes = (...list) => (px, pz) => list.some(
  (b) => px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ,
);
const clearRoom = () => false;

test('an empty line ahead is walked straight down', () => {
  const s = steerAround(0, 0, 1, 0, 5, clearRoom);
  assert.equal(s.steered, false);
  assert.equal(s.trapped, false);
  assert.ok(Math.abs(s.x - 1) < 1e-9 && Math.abs(s.z) < 1e-9, 'heading is unchanged');
});

test('a box straight ahead is walked around, by the smallest turn that clears', () => {
  // a crate dead ahead, well inside the probe reach, with open floor either side
  const blocked = boxes({ minX: 0.5, maxX: 1.1, minZ: -0.35, maxZ: 0.35 });
  const s = steerAround(0, 0, 1, 0, 5, blocked);
  assert.equal(s.steered, true, 'the actor must turn before it reaches the crate');
  assert.ok(Math.abs(s.turnedDeg) >= 18, 'it turned');
  assert.ok(Math.abs(s.turnedDeg) <= 56, `turned ${s.turnedDeg} degrees, further than needed`);
  // and the new heading is genuinely clear at the probe distance
  const d = STEER_DEFAULTS.distance;
  assert.equal(blocked(s.x * d, s.z * d), false, 'the chosen heading still runs into it');
  assert.equal(blocked(s.x * d * 0.5, s.z * d * 0.5), false);
});

test('it takes the open side when only one side is open', () => {
  // a wall on the left, a crate ahead: the only way through is right
  const blocked = boxes(
    { minX: 0.4, maxX: 1.2, minZ: -0.4, maxZ: 0.4 },
    { minX: -1, maxX: 2, minZ: -3, maxZ: -0.5 },
  );
  const s = steerAround(0, 0, 1, 0, 5, blocked);
  assert.equal(s.steered, true);
  assert.ok(s.z > 0, `steered to z=${s.z}, into the wall side`);
});

test('another person counts as something to walk around', () => {
  // the fault the brief names is "a box, a fixture, the counter or ANOTHER
  // PERSON", and a person is a radius rather than a box
  const other = { x: 0.7, z: 0 };
  const blocked = (px, pz) => Math.hypot(px - other.x, pz - other.z) < 0.62;
  const s = steerAround(0, 0, 1, 0, 5, blocked);
  assert.equal(s.steered, true, 'walked straight into somebody');
});

test('it does not swerve around the thing it came to stand at', () => {
  // arriving at a browse socket, a shelf-end right in front: at close range the
  // probe must not reach past the destination, or shoppers circle the fixture
  // they wanted to look at forever
  const shelf = boxes({ minX: 0.45, maxX: 2, minZ: -1, maxZ: 1 });
  const arriving = steerAround(0, 0, 1, 0, 0.4, shelf);
  assert.equal(arriving.steered, false, 'a short approach must not steer');
  // the same geometry from further out DOES steer, so the guard above is a
  // range rule and not a blanket refusal
  const approaching = steerAround(0, 0, 1, 0, 5, shelf);
  assert.ok(approaching.steered || approaching.trapped);
});

test('a dead end holds the line and leaves it to the recovery underneath', () => {
  // boxed in on every side: inventing a heading here would walk the actor
  // somewhere it has no reason to be
  const blocked = () => true;
  const s = steerAround(0, 0, 1, 0, 5, blocked);
  assert.equal(s.trapped, true);
  assert.equal(s.steered, false);
  assert.ok(Math.abs(s.x - 1) < 1e-9, 'it keeps its intended heading for the timer to catch');
});

test('a zero-length heading cannot produce NaN', () => {
  const s = steerAround(0, 0, 0, 0, 5, clearRoom);
  assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
});

test('every returned heading is a unit vector', () => {
  const blocked = boxes({ minX: 0.5, maxX: 1.1, minZ: -0.35, maxZ: 0.35 });
  for (const [dx, dz] of [[1, 0], [0, 1], [-3, 4], [0.2, -0.1]]) {
    const s = steerAround(0, 0, dx, dz, 5, blocked);
    assert.ok(Math.abs(Math.hypot(s.x, s.z) - 1) < 1e-9, `heading was not unit for ${dx},${dz}`);
  }
});
