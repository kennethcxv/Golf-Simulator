// Framing invariants for the card-payment camera. The handoff frames the
// customer, then the entry camera moves close enough to read a reader that stays
// physically seated on the counter. The reader itself never rises or floats.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  cardHandoffPose, cardTerminalPose, fulfillmentHandoffPose,
} from '../src/render3d/clubhouse/registerCameraPoses.js';
import { receiptGeometryUsesFeedAxis } from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

const COUNTER_TOP = 1.055;
const STATION = { x: 3.00, z: 4.04 };
// Customers stand on the south (low-z) side; the staff/camera side is high z.
const CUSTOMER = { x: 2.42, z: 3.15 };
const registerSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} has an unterminated body`);
}

test('handoff frames the customer across the counter, not the counter surface', () => {
  const p = cardHandoffPose(CUSTOMER, COUNTER_TOP);
  // Eye on the staff side (behind the counter), at standing height.
  assert.ok(p.eye.z > 4.2, `eye is on the staff side (z=${p.eye.z})`);
  assert.ok(p.eye.y > 1.4 && p.eye.y < 1.8, `eye at standing height (y=${p.eye.y})`);
  // Look south toward the customer at chest height, not down at the desk.
  assert.ok(p.look.z < p.eye.z, 'looks south toward the customer');
  assert.ok(Math.abs(p.look.z - CUSTOMER.z) < 0.6, 'look point is at the customer, not mid-counter');
  assert.ok(p.look.y > COUNTER_TOP + 0.15, `look point is at chest height, not the countertop (y=${p.look.y})`);
  // The aim is only gently downward so the customer's torso remains in frame.
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

test('terminal entry frames the fixed reader with a close downward view', () => {
  const terminal = cardTerminalPose(STATION, COUNTER_TOP);
  assert.equal(cardTerminalPose.length, 2, 'the fixed pose has no lift or float parameters');
  // Aim stays at the seated device, only slightly above the physical countertop.
  assert.ok(terminal.look.y >= COUNTER_TOP, 'look point is not below the counter');
  assert.ok(terminal.look.y < COUNTER_TOP + 0.15, 'look point stays on the seated reader');
  // Eye is close and above the keypad for a readable, natural downward glance.
  assert.ok(terminal.eye.y > terminal.look.y, 'eye is above the reader');
  assert.ok(terminal.eye.y < COUNTER_TOP + 0.60, 'eye stays close instead of simulating a reader lift');
  const distance = Math.hypot(
    terminal.eye.x - terminal.look.x,
    terminal.eye.y - terminal.look.y,
    terminal.eye.z - terminal.look.z,
  );
  assert.ok(distance < 1.1, `reader view is close enough to read (${distance.toFixed(2)})`);
  // On the staff side, looking south at the reader.
  assert.ok(terminal.eye.z > STATION.z, 'eye is on the staff side of the terminal');
  assert.ok(terminal.look.z < terminal.eye.z, 'looks south at the terminal');
});

test('handoff and terminal poses both look south with no 180 spin between them', () => {
  const handoff = cardHandoffPose(CUSTOMER, COUNTER_TOP);
  const terminal = cardTerminalPose(STATION, COUNTER_TOP);
  assert.ok(handoff.look.z - handoff.eye.z < 0, 'handoff looks south');
  assert.ok(terminal.look.z - terminal.eye.z < 0, 'terminal looks south');
  assert.ok(Math.abs(handoff.eye.x - terminal.eye.x) < 1.2, 'eyes are near each other in x');
});

test('card pickup keeps the customer-facing pose until the physical grip delay ends', () => {
  const poseKey = functionBody(registerSource, 'poseKey');
  assert.match(
    poseKey,
    /cardPickupDelay\s*>\s*0/,
    'the pickup delay remains part of the card-take camera condition',
  );
  assert.match(
    poseKey,
    /return waiting \? 'cardTake' : 'card'/,
    'the camera moves to the terminal only after the customer handoff clears',
  );
});

test('declined-card cash fallback presents tender before opening the drawer camera', () => {
  const switchToCash = functionBody(registerSource, 'switchDeclinedCardToCash');
  const createTender = switchToCash.indexOf('createTender()');
  const presentationWorkspace = switchToCash.indexOf("setWorkspace('monitor')");
  assert.ok(createTender >= 0, 'switching to cash creates the customer tender');
  assert.ok(
    createTender < presentationWorkspace,
    'the shared monitor presentation workspace is selected only after tender exists',
  );
  assert.doesNotMatch(
    switchToCash,
    /setWorkspace\('cash'\)/,
    'switching payment cannot skip directly to the drawer camera',
  );

  const acceptCash = functionBody(registerSource, 'acceptPresentedCash');
  const sortTender = acceptCash.indexOf('sortReceivedCash()');
  const drawerWorkspace = acceptCash.indexOf("setWorkspace('cash')");
  assert.ok(sortTender >= 0, 'accepting the tender sorts it into the drawer');
  assert.ok(
    sortTender < drawerWorkspace,
    'the cash/drawer workspace opens only after the presented cash is accepted',
  );
  assert.doesNotMatch(
    acceptCash,
    /setWorkspace\('monitor'\)/,
    'cash acceptance stays in the drawer workspace',
  );
});

test('the live reader has no state-driven lift or float mutation', () => {
  assert.doesNotMatch(registerSource, /\bTERM_FLOAT_LIFT\b/, 'reader lift constant must stay removed');
  assert.doesNotMatch(registerSource, /\btermFloat\b/, 'reader position must not depend on checkout state');
  assert.doesNotMatch(registerSource, /termObject\.position\.y\s*=/, 'reader y-position must not animate after attachment');
});

test('product scanning keeps a fixed camera while edge products are clicked', () => {
  const updateLookTarget = functionBody(registerSource, 'updateLookTarget');
  assert.match(
    updateLookTarget,
    /accessibilityPrefs\.reducedCameraMotion \|\| workspace === 'scan'/,
    'scan pointer movement cannot steer the working camera',
  );

  const updateCamera = functionBody(registerSource, 'updateCamera');
  assert.match(
    updateCamera,
    /if \(workspace === 'scan'\) \{[\s\S]*?lookYaw = 0;[\s\S]*?lookTargetYaw = 0;/,
    'entering or remaining in scan view clears any prior cursor sway immediately',
  );
});

test('receipt printing accepts only geometry whose long edge follows the feed axis', () => {
  assert.equal(
    receiptGeometryUsesFeedAxis({ x: 0.075, y: 0.185, z: 0.0356 }),
    true,
    'the rebuilt upright receipt uses its authored geometry',
  );
  assert.equal(
    receiptGeometryUsesFeedAxis({ x: 0.068, y: 0.0366, z: 0.1515 }),
    false,
    'the legacy Z-long receipt falls back to the printable owned strip',
  );
  assert.equal(receiptGeometryUsesFeedAxis({ x: 0.075, y: Number.NaN, z: 0.03 }), false);
});

test('fulfilment frames the right-side printer and customer palms from the staff side', () => {
  const pose = fulfillmentHandoffPose(CUSTOMER, { x: 3.98, z: 4.48 }, COUNTER_TOP);
  assert.ok(pose.eye.z > 5.4, 'the wider fulfilment eye stays behind the working counter');
  assert.ok(pose.look.z < pose.eye.z, 'the view looks south across the counter');
  assert.ok(pose.look.x > CUSTOMER.x && pose.look.x < 3.98,
    'the aim sits between the receiving customer and printer');
  assert.ok(pose.look.y > COUNTER_TOP && pose.look.y < COUNTER_TOP + 0.30,
    'the aim follows the receipt and handoff height');
  assert.ok(pose.fov >= 48, 'the printer and both customer grips fit the same frame');
});
