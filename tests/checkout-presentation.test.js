// THE CUSTOMER'S HAND HOLDS THE CASH, AND THE PRINTER GETS ITS OWN SHOT.
//
// Reported 2026-07-29 (§5 checkout presentation): "Cash is floating: the customer's hand must
// be attached to the cash as it is placed" and "The receipt: move it close to the player so
// printing and handing over are actually visible."
//
// The renders are held by the cash acceptance run (qa/.../acceptance/cash/08-cash-presented,
// 12c-receipt-printing-closeup). What a headless test can hold is the wiring that made them:
// the pay modes exist in the character rig, both controllers agree on them, the print phase
// owns a derived camera, and the receipt texture turns in place rather than the mesh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const character = readFileSync(new URL('../src/render3d/characterAsset.js', import.meta.url), 'utf8');
const customers = readFileSync(new URL('../src/render3d/clubhouse/customers.js', import.meta.url), 'utf8');
const register = readFileSync(new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url), 'utf8');

test('PayCash and PayCard are real poses, not names that fall through to slack arms', () => {
  // customers.js has set these two modes on every PAYING frame since checkout shipped, and
  // neither existed in the rig — the unknown name fell to the default pose, so the tender fan
  // hung in the air beside a customer whose arms were at their sides.
  assert.match(character, /char\.mode === 'PayCash' \|\| char\.mode === 'PayCard'/);
  assert.match(customers, /setMode\(entity\.payMethod === 'cash' \? 'PayCash' : 'PayCard'\)/);
  // The register presents with the SAME modes, or the two controllers stomp each other's
  // arms every other frame.
  assert.match(register, /poseCustomerForCheckout\('PayCash'\)/);
  assert.match(register, /poseCustomerForCheckout\('PayCard'\)/);
  assert.ok(!/poseCustomerForCheckout\('Present'\)/.test(register),
    'the register must not present with a mode the customer controller will overwrite');
});

test('the held reach does not breathe, because the fan is laid out once at the grip', () => {
  const start = character.indexOf("char.mode === 'PayCash'");
  const end = character.indexOf("char.mode === 'Receive'", start);
  const branch = character.slice(start, end);
  assert.match(branch, /shR = -1\.12;/, 'the arm reaches');
  assert.ok(!branch.includes('Math.sin'), 'and holds still — a bobbing wrist detaches the cash');
});

test('the checkout camera holds one frame; only the drawer and check-in move it', () => {
  // Playtest 2026-07-30 reversed the 2026-07-29 derived-pose work: "there is
  // too much movement going on... it makes the player dizzy." poseKey may now
  // return only cash / checkin / overview — no fulfilment pan, no receipt
  // close-up, no card-terminal cut. The reader floats to the player instead,
  // and its anchor freezes at lift-off with the cursor sway disabled, because
  // a floated device that chases the head cannot be clicked.
  const poseKey = register.slice(register.indexOf('function poseKey()'), register.indexOf('function derivedCheckinPose'));
  for (const gone of ["'fulfillment'", "'receiptPrint'", "'cardTake'", "return 'card'", "'scan'"]) {
    assert.ok(!poseKey.includes(gone), `poseKey still routes to ${gone}`);
  }
  assert.match(poseKey, /return 'cash'/);
  assert.match(poseKey, /return 'checkin'/);
  assert.match(poseKey, /return 'overview'/);
  assert.match(register, /function updateTerminalFloat\(/);
  assert.match(register, /terminalFloatAnchor/, 'the float anchor freezes at lift-off');
  assert.match(register, /\|\| terminalShouldFloat\(\)/, 'cursor sway is disabled while the reader floats');
});

test('there is no physical receipt: the paperwork files silently, the bag is the delivery', () => {
  // Playtest 2026-07-30 round 2: "just remove the whole receipt thing." The sim
  // contract survives — printReceipt/takeReceipt/packReceipt still run so
  // canComplete holds and reloads recover — but nothing prints, nothing is
  // handed, and the delivery machine goes straight to the bag.
  const begin = register.slice(register.indexOf('function beginAutomaticReceipt'), register.indexOf('function finishAutomaticFulfillment'));
  assert.match(begin, /printReceipt\(tx\)/, 'the sim receipt still files');
  assert.match(begin, /finishAutomaticFulfillment\(\)/, 'and hands straight to fulfilment');
  assert.ok(!begin.includes('ensureReceiptMesh'), 'no paper mesh is created');
  assert.ok(!begin.includes("deliveryPhase = 'receipt-print'"), 'no print phase runs');
  const fulfil = register.slice(register.indexOf('function finishAutomaticFulfillment'), register.indexOf('function setBagPickable'));
  assert.match(fulfil, /beginBagDeliveryOrRelease\(\)/, 'fulfilment lands on the bag transfer');
  assert.ok(!fulfil.includes("deliveryPhase = 'receipt-ready'"), 'no receipt-ready leg');
});
