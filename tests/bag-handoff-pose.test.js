// C4 — "the customer still LIFTS their hands — the bag goes to their LOWER
// hand, taken at hip height."
//
// The bag attaches to carryGrip('L') (clubhouse.js onCustomerPaid). ReceiveBag
// raised the RIGHT shoulder to -1.00 and left the left arm hanging, so the
// customer reached with one hand and received in the other; WalkBag then held
// the LEFT shoulder at -1.18 for the whole walk out, carrying a shop bag at
// waist height like a lantern.
//
// Nothing checked either. These drive the real char.update() and measure where
// the receiving grip ends up on the character's OWN body, so a taller or
// shorter customer does not change the verdict.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeCharacter } from '../src/render3d/characterAsset.js';

// Where the bag goes. If this ever moves, the pose has to move with it, and the
// first test below is what says so.
const BAG_SIDE = 'L';

function posed(mode, seconds = 0) {
  const character = makeCharacter();
  character.setMode(mode);
  // WalkBag eases over 0.55 s; sample the settled end of it, not frame one.
  const steps = Math.max(1, Math.round(seconds / (1 / 60)));
  for (let i = 0; i < steps; i += 1) character.update(1 / 60);
  if (seconds === 0) character.update(0);
  character.root.updateMatrixWorld(true);
  const world = (o) => o.getWorldPosition(new THREE.Vector3());
  const head = character.root.getObjectByName('headJoint');
  const root = world(character.root);
  const top = world(head).y;
  const height = Math.max(0.01, top - root.y);
  const gripOf = (side) => {
    const p = world(character.carryGrip(side));
    return {
      // fraction of the character's own standing height
      heightFraction: +((p.y - root.y) / height).toFixed(3),
      // how far in front of the body the hand is, in the character's own frame
      forward: +character.root.worldToLocal(p.clone()).z.toFixed(3),
    };
  };
  return { character, height, left: gripOf('L'), right: gripOf('R') };
}

// A standing adult's hip sits near 0.52 of their own height, the shoulder near
// 0.82. These are the only two numbers the thresholds below come from.
const HIP = 0.52;
const SHOULDER = 0.82;

test('the arm that moves to receive the bag is the arm the bag attaches to', () => {
  const idle = posed('Idle');
  const receiving = posed('ReceiveBag');
  const other = BAG_SIDE === 'L' ? 'right' : 'left';
  const bagSide = BAG_SIDE === 'L' ? 'left' : 'right';

  const reached = receiving[bagSide].forward - idle[bagSide].forward;
  const otherMoved = receiving[other].forward - idle[other].forward;
  assert.ok(reached > 0.06,
    `the ${bagSide} hand — the one the bag attaches to — only came forward ${reached.toFixed(3)} yd`);
  assert.ok(reached > Math.abs(otherMoved) * 2,
    `the ${other} hand moved ${otherMoved.toFixed(3)} against the receiving hand's `
    + `${reached.toFixed(3)}: the wrong arm is doing the reaching`);
});

test('receiving the bag does not lift either hand toward the shoulder', () => {
  const receiving = posed('ReceiveBag');
  for (const side of ['left', 'right']) {
    assert.ok(receiving[side].heightFraction < (HIP + SHOULDER) / 2,
      `the ${side} hand sits at ${receiving[side].heightFraction} of standing height, `
      + `which is above the hip — "taken at hip height" is the whole request`);
  }
  const bagSide = BAG_SIDE === 'L' ? 'left' : 'right';
  assert.ok(Math.abs(receiving[bagSide].heightFraction - HIP) < 0.14,
    `the receiving hand is at ${receiving[bagSide].heightFraction}, not near the hip (${HIP})`);
});

test('the bag is carried at the side on the way out, not held up at the waist', () => {
  // Settled WalkBag: the ease runs 0.55 s, so sample past it.
  const walking = posed('WalkBag', 1.2);
  const bagSide = BAG_SIDE === 'L' ? 'left' : 'right';
  assert.ok(walking[bagSide].heightFraction < HIP + 0.06,
    `the carried hand rides at ${walking[bagSide].heightFraction} of standing height; `
    + 'a shop bag hangs at the hip');
});
