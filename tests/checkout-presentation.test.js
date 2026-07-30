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

test('the print phase owns a derived printer close-up, and the drag returns to fulfilment', () => {
  const poseKey = register.slice(register.indexOf('function poseKey()'), register.indexOf('function derivedCheckinPose'));
  assert.match(poseKey, /'receipt-print', 'receipt-ready', 'receipt-ready-manual'/);
  assert.match(poseKey, /return 'receiptPrint'/);
  assert.match(register, /function derivedReceiptPrintPose\(\)/);
  const start = register.indexOf('function derivedReceiptPrintPose()');
  const next = register.indexOf('\n  function ', start);
  const derived = register.slice(start, next > start ? next : undefined);
  assert.match(derived, /printerOutputSocket \|\| printerRoll/, 'derived from the printer hardware itself');
  assert.match(derived, /fulfillmentHandoffPose/, 'with the fulfilment frame as the fallback');
});

test('the receipt content turns in place; the mesh anchor and the handoff stay authored', () => {
  // Measured 2026-07-30: the strip rendered as a coherent receipt rotated 180° in its own
  // plane. Rotating the MESH cannot fix that — the geometry anchors at its bottom edge, so
  // any in-plane flip swings the paper down into the printer. The texture rotates instead.
  assert.match(register, /texture\.center\.set\(0\.5, 0\.5\);\s*\n\s*texture\.rotation = Math\.PI;/);
  assert.match(register, /RECEIPT_PRINTER_QUATERNION = frontDeskQuaternion\(-0\.42, 0, 0\)\.multiply\(/);
  assert.match(register, /RECEIPT_HANDOFF_QUATERNION = frontDeskQuaternion\(-0\.12, 0\.5, -0\.28\)/,
    'the handoff turn to the customer is unchanged');
});
