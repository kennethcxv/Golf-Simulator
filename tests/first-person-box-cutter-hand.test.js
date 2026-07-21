import test from 'node:test';
import assert from 'node:assert/strict';

import { GRIPS, makeFpHands } from '../src/render3d/fpHands.js';

test('the delivery box cutter uses a compact physical pinching hand', () => {
  assert.equal(GRIPS.boxcutter.grip.pose, 'pinch');
  assert.equal(GRIPS.boxcutter.support, null);
  assert.ok(GRIPS.boxcutter.handScale > 0.7 && GRIPS.boxcutter.handScale < 0.8);
  assert.ok(GRIPS.boxcutter.grip.pos[2] >= 0.10,
    'the grip stays behind the blade contact instead of covering it');

  const hands = makeFpHands();
  hands.setTool('boxcutter');
  hands.update(1, false);

  const right = hands.root.getObjectByName('FirstPersonRightHand');
  const left = hands.root.getObjectByName('FirstPersonLeftHand');
  const forearm = hands.root.getObjectByName('FirstPersonRightForearm');
  const cuff = hands.root.getObjectByName('FirstPersonRightCuff');
  assert.equal(hands.root.visible, true);
  assert.equal(right.visible, true);
  assert.equal(left.visible, false);
  assert.equal(forearm.visible, false);
  assert.equal(cuff.visible, false);
  assert.equal(hands.root.scale.x, GRIPS.boxcutter.handScale);
  assert.deepEqual(right.position.toArray(), GRIPS.boxcutter.grip.pos);
  hands.dispose();
});
