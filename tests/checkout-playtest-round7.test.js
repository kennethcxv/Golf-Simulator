// CHECKOUT PLAYTEST, ROUND 7 (2026-07-31). The reported items, held as
// contracts so they cannot drift back. Whether they LOOK right is held by
// tools/qa/checkout-round7-renders.js against the 2026-07-31 TCG screenshot
// (dark counter edge, glowing device bay, reader + pin pad standing in it);
// these are the invariants underneath:
//   1 "make the screen a little bigger and more to the left so it's more
//     visible" — the POS pulls toward frame centre and scales up
//   2 "the items in the middle of the counter … literally just goes in by
//     sliding to the left" — staging shares the laid bag's line and the slide
//     target keeps counter height
//   3 "remove the lamp on the desk" — asset 83 serves the office now
//   4 "fix the dollar sign colors, make it how they were before" — one dollar
//     green per note, identity carried by numerals and tags
//   5 "we can't see the number currency for $1, $5" — bill tags STAND at the
//     divider, tilted to the cash camera
//   6 "completely remove the receipt" — no paper, no printer, sim paperwork
//     silent
//   7 "the money goes on the desk" — tender lies flat on the counter
//   8 "the card reader is centered and directly in front of the user's face …
//     not colliding with any desk" — centred float with a counter clamp
//   9 "add a space in the desk for the card reader" — the device bay
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CHECKOUT_TERMINAL_BAY,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';
import { COUNTER_TOP, OFFICE, REGISTER, frontDeskLocalPoint } from '../src/data/shopLayout.js';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const source = read('../src/render3d/clubhouse/simplifiedRegisterMode.js');
const fixturesSource = read('../src/render3d/clubhouse/fixtures.js');
const clubhouseSource = read('../src/render3d/clubhouse.js');
const paymentSource = read('../src/render3d/clubhouse/checkoutPaymentPresentation.js');
const manifestSource = read('../src/render3d/assets51to100/runtimeManifest.js');

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} has an unterminated body`);
}

// --- 1: the POS is bigger and pulled toward frame centre ---------------------

test('the monitor stands nearer frame centre at a larger scale', () => {
  const local = frontDeskLocalPoint(REGISTER.monitor.x, REGISTER.monitor.z);
  assert.ok(local.x <= 0.40, `monitor local x ${local.x.toFixed(2)} — 0.52 ran the glass off the frame edge`);
  assert.ok(local.x >= 0.20, 'but it stays right of the goods (the space contract)');
  const scale = /const POS_HARDWARE_SCALE = ([\d.]+)/.exec(source);
  assert.ok(Number(scale[1]) >= 1.5, `POS scale ${scale[1]} — the screen reads at working distance`);
});

// --- 2: goods stage on the bag's own line and slide level --------------------

test('the staging strip shares the laid bag line so the ring-up is one lateral slide', () => {
  const staging = REGISTER.staging;
  const corners = [
    frontDeskLocalPoint(staging.minX, staging.minZ),
    frontDeskLocalPoint(staging.maxX, staging.maxZ),
  ];
  const zs = corners.map((corner) => corner.z);
  const bag = frontDeskLocalPoint(REGISTER.bag.x, REGISTER.bag.z);
  const stagingMidZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  assert.ok(Math.abs(stagingMidZ - bag.z) <= 0.16,
    `staging mid z ${stagingMidZ.toFixed(2)} runs beside bag z ${bag.z.toFixed(2)} — the slide is along the counter`);
  const product = functionBody('bagProduct');
  assert.match(product, /mouth\.y = REST_Y/, 'the slide target keeps the resting height — no climb');
});

// --- 3: the desk lamp serves the office --------------------------------------

test('the task lamp left the checkout counter for the office desk', () => {
  const entry = /\{ n: 83,[\s\S]{0,400}?\},/.exec(manifestSource)[0];
  assert.doesNotMatch(entry, /FRONT_DESK\.deskLamp/, 'the lamp no longer reads the checkout datum');
  const x = Number(/x: ([\d.]+)/.exec(entry)[1]);
  const z = Number(/z: ([\d.]+)/.exec(entry)[1]);
  assert.ok(x >= OFFICE.bounds.minX && z >= OFFICE.bounds.minZ,
    `lamp at (${x}, ${z}) sits in the office, off the checkout sightline`);
});

// --- 4: every note is a dollar green -----------------------------------------

test('bill tints are one green family; coins keep copper and silver', () => {
  const block = /const MONEY_TINT = \{[\s\S]+?\};/.exec(source)[0];
  for (const denom of [1, 5, 10, 20, 50]) {
    const hex = new RegExp(`\\b${denom}: (0x[0-9a-fA-F]{6})`).exec(block)[1];
    const value = Number(hex);
    const r = (value >> 16) & 255; const g = (value >> 8) & 255; const b = value & 255;
    assert.ok(g > r && r > b, `$${denom} tint ${hex} must read dollar green (g > r > b)`);
  }
  assert.match(block, /0\.01: 0xc06a2c/, 'the penny stays copper');
});

// --- 5: bill tags stand where the cash camera can read them ------------------

test('bill tags stand tilted at the divider; coin tags stay flat on the lip', () => {
  assert.match(source, /const BILL_TAG_TILT = /);
  const build = functionBody('buildSlotFurniture');
  assert.match(build, /tag\.rotation\.x = -Math\.PI \/ 2 \+ BILL_TAG_TILT/,
    'bills: a standing plate, not a floor decal the stack buries');
  assert.match(build, /slot\.y \+ meta\.wall_h \+ 0\.010/, 'proud of the divider wall');
  const refill = functionBody('refillDrawerMoney');
  assert.match(refill, /if \(tag && !bill\)/, 'refill re-seats only the coin tags');
});

// --- 6: the receipt is gone entirely -----------------------------------------

test('no receipt exists anywhere in the presentation', () => {
  for (const banned of ['receiptMesh', 'receiptContentTexture', 'buildReceiptGeometry',
    'ensureReceiptMesh', 'attachPrinter', 'printerPaper', 'RECEIPT_PRINTER_QUATERNION']) {
    assert.ok(!source.includes(banned), `simplifiedRegisterMode still mentions ${banned}`);
  }
  assert.doesNotMatch(fixturesSource, /placeKit\('receipt_printer'/, 'fixtures no longer place the printer');
  assert.doesNotMatch(clubhouseSource, /instantiateKit\('loose_receipt'/, 'no paper rides in the departure bag');
  // the sim paperwork still runs so exact-once banking keeps its contract
  assert.match(functionBody('beginAutomaticReceipt'), /printReceipt\(tx\)/);
  assert.match(functionBody('finishAutomaticFulfillment'), /packReceipt\(tx\)/);
});

// --- 7: the tender lies on the desk ------------------------------------------

test('presented cash lies flat on the counter, each piece its own target', () => {
  assert.match(source, /function tenderCounterPoint\(\)/);
  assert.match(functionBody('tenderCounterPoint'), /COUNTER_TOP/, 'the pile anchors to the counter top');
  assert.match(functionBody('tenderPose'), /tenderCounterPoint\(\)/,
    'the layout anchors to the desk, not to the held-out hand');
  // the layout module lays notes FLAT: no held-fan pitch remains
  const layout = /export function presentedTenderLayout[\s\S]+?\n\}/.exec(paymentSource)[0];
  assert.doesNotMatch(layout, /frontDeskRotation\(1\.04/, 'the held-up fan pitch is gone');
  assert.match(layout, /frontDeskRotation\(0, -0\.10/, 'notes rest flat with a loose fan yaw');
});

// --- 8: the reader floats centred and clear of the desk ----------------------

test('the floated reader is dead centre and clamped above the counter', () => {
  assert.match(source, /const TERMINAL_FLOAT_LEFT = 0;/, 'no centre-left offset survives');
  const float = functionBody('updateTerminalFloat');
  assert.match(float, /Math\.max\(anchorLocal\.y, COUNTER_TOP \+ TERMINAL_FLOAT_COUNTER_CLEARANCE\)/,
    'the base clamps above the counter top wherever the view axis lands');
});

// --- 9: the device bay --------------------------------------------------------

test('the desk carries the glowing device bay and the reader parks in it', () => {
  assert.ok(CHECKOUT_TERMINAL_BAY.width > 0.4, 'wide enough for reader and pin pad');
  assert.ok(CHECKOUT_TERMINAL_BAY.belowTop > 0 && CHECKOUT_TERMINAL_BAY.belowTop < 0.4,
    'the bay hangs just under the counter top');
  assert.ok(CHECKOUT_TERMINAL_BAY.seatPitch < 0, 'the parked reader leans back against the glow');
  assert.match(source, /terminalBay\.name = 'CheckoutTerminalBay'/);
  assert.match(source, /toneMapped: false \}\);\s*\n\s*const terminalBay/,
    'the back panel is a pure-white light box, reference-style');
  assert.doesNotMatch(source, /TERMINAL_PARK_DEPTH/, 'the under-counter hiding place is gone');
  const attach = functionBody('attachTerm');
  assert.match(attach, /BAY\.seatPitch/, 'the seat pose comes from the bay');
});

// --- and finishing a sale keeps you at the till -------------------------------

test('banking a sale never exits the cashier view', () => {
  const finalize = functionBody('finalizeTransaction');
  assert.doesNotMatch(finalize, /\bleave\(/, 'finalize must not leave the station');
  const actions = functionBody('checkoutActions');
  assert.match(actions, /Ready for the next customer/,
    'the post-sale screen leads with staying at the till');
  const post = functionBody('clearPostSale');
  assert.doesNotMatch(post, /\bleave\(/, 'clearing the summary keeps the view too');
});
