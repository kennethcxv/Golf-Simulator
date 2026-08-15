// G7 — CASH AND CARD ARE DIFFERENT GESTURES.
//
// "Cash: they lay it on the desk and take their hand back. They do not stand
//  holding it out.
//  Card: they hold it up and keep holding it until I take it."
//
// They were the same gesture, in the most literal way available: one branch in
// the character rig handled both.
//
//     } else if (char.mode === 'PayCash' || char.mode === 'PayCard') {
//
// The pose that does the right thing for cash already existed - `CashLaid`, arm
// back, waiting for change, written for Goal 16 F6 - and the AMBIENT customer
// simulation already used it. The register the player actually operates never
// did. Worse, it wrote `PayCash` every frame the tender was on the counter, so
// even a correct pose set from elsewhere would have been overwritten before it
// was seen. The customer stood with an arm held out over money that was already
// lying on the desk: the card gesture, performed with cash.
//
// Source-reading, because the pose lives inside a closure over live 3D state.
// Recorded as the weaker instrument; the report keeps this UNCONFIRMED until it
// is seen at the player's camera. Comments are stripped before scanning, because
// a test that matches its own prose cannot fail - which happened twice in this
// section already.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const strip = (text) => text.replace(/\/\/.*$/gm, '');

const register = strip(fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
));
const rig = strip(fs.readFileSync(
  new URL('../src/render3d/characterAsset.js', import.meta.url),
  'utf8',
));

test('the rig still distinguishes a laid-down payment from a held-out one', () => {
  assert.match(rig, /char\.mode === 'CashLaid'/,
    'the arm-back pose exists');
  assert.match(rig, /char\.mode === 'PayCard'/,
    'the held-out pose exists');
});

test('the laid pose is genuinely a different arm, not a relabel', () => {
  // If CashLaid resolved to the same shoulder angle as PayCash the split would
  // be cosmetic. The held-out reach is about -1.12; the withdrawn arm is far
  // shallower.
  const held = /char\.mode === 'PayCash' \|\| char\.mode === 'PayCard'\)[\s\S]{0,400}?shR = (-?[\d.]+)/
    .exec(rig);
  const laid = /char\.mode === 'CashLaid'\)[\s\S]{0,400}?shR = (-?[\d.]+)/.exec(rig);
  assert.ok(held && laid, 'both poses set a shoulder angle');
  const heldReach = Math.abs(Number(held[1]));
  const laidReach = Math.abs(Number(laid[1]));
  assert.ok(heldReach - laidReach > 0.5,
    `the laid arm must be clearly withdrawn: held ${heldReach}, laid ${laidReach}`);
});

test('the till stops forcing the held-out pose once the cash is down', () => {
  // The defect: `poseCustomerForCheckout('PayCash')` written unconditionally on
  // every frame of the cash-tender stage.
  // Anchored on the whole per-frame condition. "cash-tender" alone appears many
  // times in this file, and indexOf finds the FIRST - which is not this block.
  // That is the third time in this section an imprecise anchor made a test read
  // code that was never its subject.
  const at = register.indexOf("tx.method === 'cash' && tx.stage === 'cash-tender'");
  assert.ok(at > 0, 'the per-frame cash pose block is still there');
  const block = register.slice(at, at + 400);
  assert.match(block, /CashLaid/,
    'the register reaches the laid pose, not only the held-out one');
  assert.doesNotMatch(block, /poseCustomerForCheckout\('PayCash'\);\s*\n\s*\}/,
    'it must not write the held-out pose unconditionally');
});

test('the hand stays on the money long enough to have placed it', () => {
  const m = /const CASH_LAY_SECONDS = ([\d.]+)/.exec(register);
  assert.ok(m, 'the placing window is a named constant');
  const seconds = Number(m[1]);
  assert.ok(seconds > 0.2 && seconds < 1.2,
    `long enough to read as placing, short enough not to be holding it out: ${seconds}`);
});

test('the placing timer resets where every tender must pass', () => {
  // There are two routes that present cash - the normal one and the one after a
  // card decline. Resetting at the call sites means one of them can be missed,
  // and a stale timer starts the customer with their hand already withdrawn
  // from money they have not put down yet.
  const at = register.indexOf('function createTender()');
  assert.ok(at > 0, 'createTender is still the single tender factory');
  assert.match(register.slice(at, at + 400), /cashLaidTimer = 0/,
    'the timer resets inside createTender, not at its call sites');
});

test('the card gesture is unchanged - held until it is taken', () => {
  const at = register.indexOf("tx.method === 'cash' && tx.stage === 'cash-tender'");
  const cardBlock = register.slice(Math.max(0, at - 200), at);
  assert.doesNotMatch(cardBlock, /CashLaid/,
    'nothing in the card path lays the card down');
});
