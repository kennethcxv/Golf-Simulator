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
import fs from 'node:fs';
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
  assert.ok(!branch.includes('Math.sin'), 'and holds still - a bobbing wrist detaches the cash');
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

test('the receipt files silently and payment flows straight into the bag transfer', () => {
  // Round 7 (2026-07-31, reversing 2026-07-30's visible print): "please
  // completely remove the receipt." No paper is modelled and no delivery beat
  // runs for it — but printReceipt/takeReceipt/packReceipt still file inside
  // the same durable flow states so canComplete holds and reloads recover.
  const begin = register.slice(register.indexOf('function beginAutomaticReceipt'), register.indexOf('function finishAutomaticFulfillment'));
  assert.match(begin, /printReceipt\(tx\)/, 'the sim receipt still files');
  assert.ok(!begin.includes('ensureReceiptMesh'), 'no paper strip is modelled');
  assert.match(begin, /return finishAutomaticFulfillment\(\)/,
    'payment flows straight into fulfilment - there is no hand-over beat to wait for');
  const delivery = register.slice(register.indexOf('function updateDelivery'), register.indexOf('function updateCashMotions'));
  assert.ok(!delivery.includes('receipt-deliver'), 'no receipt travel leg survives');
  assert.match(delivery, /deliveryPhase === 'bag-deliver'/, 'the bag transfer is the one physical delivery');
  const fulfil = register.slice(register.indexOf('function finishAutomaticFulfillment'), register.indexOf('function setBagPickable'));
  assert.match(fulfil, /packReceipt\(tx\)/, 'the paperwork still packs on the sim side');
  assert.match(fulfil, /beginBagDeliveryOrRelease\(\)/, 'fulfilment lands on the bag transfer');
});

// A5 — THE CHECKOUT STATUS PANEL (2026-08-03). Reported three sessions running:
// "'Ready for next' sits flush against the bottom with no margin, and the panel
// reads cluttered."
//
// The cause was that every block in the summary column was a literal y plus a
// stack of hand-added corrections (`choiceOffset` when the customer had picked
// a method, `taxOffset` because the sales-tax line arrived later), so the
// column's height depended on which optional rows happened to be present and
// nothing knew where the bottom landed. With a payment choice showing, the
// action grid solved to y=604 with height 38 — 642 on a 640-tall canvas.
//
// tools/qa/checkout-monitor-layout.js renders the real canvas for the states
// the report names plus a deliberately over-stuffed control and measures the
// lowest drawn pixel. These pin the layout POLICY that makes that possible.
test('the checkout summary column is laid out from its panel, not from literals', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/frontDeskMonitorUi.js', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  const start = source.indexOf('  function drawCheckoutSummary(data) {');
  const end = source.indexOf('\n  function drawCheckout(', start);
  assert.ok(start >= 0 && end > start, 'drawCheckoutSummary still exists');
  const column = source.slice(start, end);

  assert.ok(!column.includes('choiceOffset') && !column.includes('taxOffset'),
    'the per-optional-row offsets are gone; blocks move the cursor instead');
  assert.match(column, /const floor = SUMMARY\.y \+ SUMMARY\.h - SUMMARY\.pad;/,
    'the column knows where its own bottom padding is');
  assert.match(column, /const actionsY = floor - actionHeight;/,
    'the controls are anchored to that padding, so the bottom margin is guaranteed');
  // …and the middle cannot collide, which anchoring alone does not give you:
  // the whole column is solved before a pixel of it is painted.
  assert.match(column, /const available = floor - top;/, 'the column knows its own budget');
  assert.ok(column.includes('for (const concede of concessions)'),
    'and gives ground in a defined order rather than drawing over itself');
  assert.ok(column.includes('if (fit.pitch === 25) { fit.pitch = 22; return true; }'),
    'tighter rows before anything is lost');
  assert.ok(column.includes('if (fit.lines > 1) { fit.lines = 1; return true; }'),
    'a shorter instruction before a number disappears');
  assert.ok(column.includes('if (fit.tail[index].keep < fit.tail[weakest].keep) weakest = index;'),
    'and when a tender row must go it is the LEAST load-bearing one - dropping '
    + 'the topmost lost CHANGE DUE while SELECTED survived, on the one screen '
    + 'where the player is counting change');
  assert.match(column, /if \(discount > 0\) breakdown\.push/,
    'a DISCOUNT $0.00 row on every sale is the clutter, not the spacing');
});

test('a control the player cannot read is not a control', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/frontDeskMonitorUi.js', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  // Two buttons split across 308px rendered "Ready for the next customer" as
  // "READY FOR T...". One per row while there are two or fewer.
  assert.match(source, /const actionColumns = actionCount <= 2 \? 1 : 2;/,
    'the narrow summary column stacks its buttons');
  assert.match(source, /function drawActionGrid\(actions, x, y, width, height, forcedColumns = null\)/,
    'and the grid accepts that instruction');
  assert.match(source, /for \(const size of \[19, 18, 17, 16, 15\]\)/,
    'the status heading shrinks before it truncates - "TRANSACTION COMPLETE" is the longest');
});
