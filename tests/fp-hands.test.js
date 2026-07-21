import test from 'node:test';
import assert from 'node:assert/strict';
import { GRIPS, makeFpHands } from '../src/render3d/fpHands.js';

test('checkout declares one-hand and two-hand grips on the shared rig', () => {
  assert.ok(GRIPS.checkoutPinch.grip);
  assert.equal(GRIPS.checkoutPinch.support, null);
  assert.ok(GRIPS.checkoutCarry.grip);
  assert.ok(GRIPS.checkoutCarry.support);
});

test('first-person hands lower out of view instead of snapping away', () => {
  const hands = makeFpHands();
  hands.setTool('checkoutPinch');
  hands.update(0.2, false);
  assert.equal(hands.root.visible, true);

  hands.setTool(null);
  hands.update(0.01, false);
  assert.equal(hands.root.visible, true);
  assert.equal(hands.getState().tool, null);

  for (let i = 0; i < 20; i++) hands.update(0.1, false);
  assert.equal(hands.root.visible, false);
  hands.dispose();
});
