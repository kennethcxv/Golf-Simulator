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

test('the desk carries the lit device bay and the reader parks in it', () => {
  assert.ok(CHECKOUT_TERMINAL_BAY.width > 0.4, 'wide enough for reader and pin pad');
  assert.ok(CHECKOUT_TERMINAL_BAY.belowTop > 0 && CHECKOUT_TERMINAL_BAY.belowTop < 0.4,
    'the bay hangs just under the counter top');
  assert.ok(CHECKOUT_TERMINAL_BAY.seatPitch < 0, 'the parked reader leans back against the glow');
  assert.match(source, /terminalBay\.name = 'CheckoutTerminalBay'/);
  // Round 8: a CLOSED alcove — back panel plus four walls — not four loose
  // rails around a floating white slab.
  assert.match(source, /const walls = \[/, 'the alcove has real floor, ceiling and jambs');
  assert.match(source, /bayGlowMaterial = new THREE\.MeshStandardMaterial\(\{[^}]*emissive/s,
    'the lit back is an emissive surface, not an unlit pure-white sheet');
  assert.doesNotMatch(source, /TERMINAL_PARK_DEPTH/, 'the under-counter hiding place is gone');
  const attach = functionBody('attachTerm');
  assert.match(attach, /BAY\.seatPitch/, 'the seat pose comes from the bay');
});

test('nothing parked in the bay can phase through its walls', () => {
  const bay = CHECKOUT_TERMINAL_BAY;
  // The parked reader is the tallest occupant: the kit terminal measures
  // 0.405 at working scale, and it stands on the alcove floor leaning back by
  // seatPitch about its own base.
  const readerWorkingHeight = 0.405;
  const parked = readerWorkingHeight * bay.parkScale;
  const rise = parked * Math.cos(bay.seatPitch);
  const setBack = parked * Math.abs(Math.sin(bay.seatPitch));
  assert.ok(rise < bay.height,
    `leaned reader stands ${rise.toFixed(3)} in a ${bay.height} opening — its head clears the ceiling`);
  const baseZ = bay.reach * bay.seatDepthFrac;
  assert.ok(baseZ - setBack > 0.008,
    `leaned reader tips back to z ${(baseZ - setBack).toFixed(3)} — it must stay in front of the lit panel`);
  assert.ok(baseZ < bay.reach,
    'and its base stands inside the alcove, not proud of the opening');
  // The alcove must be deeper than the reader's own measured depth sweep
  // (0.153, probed in the bay frame by tools/qa/checkout-bay-probe.js) or the
  // device's face hangs out of the opening however it is seated.
  assert.ok(bay.reach >= 0.17,
    `a ${bay.reach} alcove cannot contain the parked reader's 0.153 depth sweep with margin`);
});

// --- ROUND 8 (2026-08-02) ------------------------------------------------------

test('the working frame is composed once and never re-solves mid-shift', () => {
  const solve = functionBody('derivedWorkingPose');
  // "After the transaction is over it moves the screen to the right." The
  // cache key must not carry anything that disappears with a sale.
  const key = /const key = ([^;]+);/.exec(solve)[1];
  for (const transient of ['itemMeshes', 'tx', 'customer']) {
    assert.ok(!key.includes(transient),
      `the pose cache key still varies with ${transient}, so the frame re-composes`);
  }
  assert.match(key, /screenPlane/, 'the only key input is which POS reference the solve had');
});

test('the customer wears no floating target during the automatic handoff', () => {
  const palm = functionBody('updateCustomerPalmTarget');
  // "When the user purchases their item they have a grey white circle around
  // one of their arms." The translucent sphere is a DROP TARGET; the bag
  // handoff is automatic, so it has nothing to aim at.
  assert.match(palm, /customerPalm\.visible = wantsChange \|\| wantsOversize;/,
    'the palm shows only for the manual oversize drag');
  assert.ok(!/customerPalm\.visible = .*handingBag/.test(palm),
    'BagHandoff must not raise a target the player cannot use');
  assert.match(palm, /setBagPickable\(/, 'the bag stays grabbable on its own terms');
});

test('the reader comes close enough that its physical keys are real targets', () => {
  const distance = Number(/const TERMINAL_FLOAT_DISTANCE = ([\d.]+)/.exec(source)[1]);
  assert.ok(distance <= 0.85,
    `the floated reader sits ${distance} m out — the reference holds it at arm's length`);
  assert.ok(distance >= 0.5, 'but not so close it clips the near plane or looms');
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
