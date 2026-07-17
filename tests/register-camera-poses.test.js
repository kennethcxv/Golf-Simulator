// Framing invariants for the card-payment camera. These pin the exact
// complaints the rebuild addresses: the handoff must frame the CUSTOMER (not
// the empty counter the reader used to sit on), the entry must frame the reader
// at its RAISED height (not aimed low at the countertop), and the camera must
// not spin between the two.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardHandoffPose, cardTerminalPose } from '../src/render3d/clubhouse/registerCameraPoses.js';

const COUNTER_TOP = 1.055;
const TERM_LIFT = 0.26;
const STATION = { x: 3.00, z: 4.04 };
// customers stand on the south (low-z) side; the staff/camera side is high z
const CUSTOMER = { x: 2.42, z: 3.15 };

test('handoff frames the customer across the counter, not the counter surface', () => {
  const p = cardHandoffPose(CUSTOMER, COUNTER_TOP);
  // eye on the staff side (behind the counter), at standing height
  assert.ok(p.eye.z > 4.2, `eye is on the staff side (z=${p.eye.z})`);
  assert.ok(p.eye.y > 1.4 && p.eye.y < 1.8, `eye at standing height (y=${p.eye.y})`);
  // looking SOUTH toward the customer, and at chest height — not down at the desk
  assert.ok(p.look.z < p.eye.z, 'looks south toward the customer');
  assert.ok(Math.abs(p.look.z - CUSTOMER.z) < 0.6, 'look point is at the customer, not mid-counter');
  assert.ok(p.look.y > COUNTER_TOP + 0.15, `look point is at chest height, not the countertop (y=${p.look.y})`);
  // the aim is only gently downward — the customer's torso is in frame
  const dropAngle = Math.atan2(p.eye.y - p.look.y, Math.hypot(p.eye.x - p.look.x, p.eye.z - p.look.z));
  assert.ok(dropAngle < 0.35, `handoff is not a steep look-down (${dropAngle.toFixed(2)} rad)`);
});

test('handoff keeps the customer in frame no matter where they stand', () => {
  for (const cx of [1.4, 2.0, 2.5, 3.0, 3.8]) {
    const p = cardHandoffPose({ x: cx, z: 3.1 }, COUNTER_TOP);
    assert.ok(p.look.x >= 2.15 - 1e-9 && p.look.x <= 3.15 + 1e-9,
      `look x clamped into the frame for cx=${cx} (got ${p.look.x})`);
  }
});

test('terminal entry aims at the RAISED reader and rises with it', () => {
  const seated = cardTerminalPose(STATION, COUNTER_TOP, TERM_LIFT, 0);
  const lifted = cardTerminalPose(STATION, COUNTER_TOP, TERM_LIFT, 1);
  // the look point climbs as the reader floats up — the old bug aimed low and stayed low
  assert.ok(lifted.look.y > seated.look.y + 0.2, `look rises with the float (${seated.look.y} -> ${lifted.look.y})`);
  assert.ok(lifted.eye.y > seated.eye.y + 0.2, 'eye rises with the float too');
  // fully lifted, the aim sits at the floated reader, well above the countertop
  assert.ok(lifted.look.y > COUNTER_TOP + TERM_LIFT - 0.05, 'look point reaches the raised reader');
  // eye stays above the look point (a readable downward glance at the keypad), never below the counter
  assert.ok(lifted.eye.y > lifted.look.y, 'eye above the look point (keypad readable)');
  assert.ok(seated.eye.y > COUNTER_TOP, 'eye never dips below the counter');
  // on the staff side, looking south at the reader
  assert.ok(lifted.eye.z > STATION.z, 'eye is on the staff side of the terminal');
  assert.ok(lifted.look.z < lifted.eye.z, 'looks south at the terminal');
});

test('handoff and terminal poses both look south — no 180 spin between them', () => {
  const handoff = cardHandoffPose(CUSTOMER, COUNTER_TOP);
  const terminal = cardTerminalPose(STATION, COUNTER_TOP, TERM_LIFT, 1);
  // both look vectors point toward lower z (south); the yaw never flips around
  assert.ok(handoff.look.z - handoff.eye.z < 0, 'handoff looks south');
  assert.ok(terminal.look.z - terminal.eye.z < 0, 'terminal looks south');
  // and they are laterally close (a pan, not a whip across the room)
  assert.ok(Math.abs(handoff.eye.x - terminal.eye.x) < 1.2, 'eyes are near each other in x');
});

test('float clamps: absurd float values never throw the framing off', () => {
  const under = cardTerminalPose(STATION, COUNTER_TOP, TERM_LIFT, -3);
  const over = cardTerminalPose(STATION, COUNTER_TOP, TERM_LIFT, 9);
  assert.equal(under.look.y, cardTerminalPose(STATION, COUNTER_TOP, TERM_LIFT, 0).look.y);
  assert.equal(over.look.y, cardTerminalPose(STATION, COUNTER_TOP, TERM_LIFT, 1).look.y);
});
