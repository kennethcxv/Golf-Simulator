// THE CHARACTER IS ONE CONNECTED, FLOOR-PLANTED PERSON.
//
// makeCharacter builds a jointed figure from primitives. Two things it must never regress:
// the body has to be vertically CONTINUOUS (no floating head, no detached limbs — the defect
// the whole connected-body pass exists to kill), and the feet have to sit at model y≈0 so a
// character placed with its root on the floor plants its soles instead of hovering above them.
// The animation rig pivots and carry grips must also survive, because checkout and the customer
// flow key off them by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { makeCharacter } from '../src/render3d/characterAsset.js';

// world-space vertical [min,max] of every mesh under a root
function meshYSpans(root) {
  root.updateMatrixWorld(true);
  const spans = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const box = new THREE.Box3().setFromObject(o);
    if (Number.isFinite(box.min.y) && Number.isFinite(box.max.y)) spans.push([box.min.y, box.max.y]);
  });
  return spans;
}

test('the feet plant at the floor: the lowest point sits at model y ~= 0', () => {
  const character = makeCharacter();
  character.setMode('Idle');
  character.update(0.4);
  const spans = meshYSpans(character.root);
  const footY = Math.min(...spans.map((s) => s[0]));
  // the game puts the root exactly on the floor; feet within +-2 cm of it read as planted
  assert.ok(footY > -0.03 && footY < 0.03, `feet should sit at ~0, got ${footY.toFixed(3)}`);
  character.dispose();
});

test('the standing figure is ~1.9 m tall with a real head above the shoulders', () => {
  const character = makeCharacter();
  character.setMode('Idle');
  character.update(0.4);
  const spans = meshYSpans(character.root);
  const top = Math.max(...spans.map((s) => s[1]));
  assert.ok(top > 1.7 && top < 2.1, `head-top should be ~1.9 m, got ${top.toFixed(3)}`);
  character.dispose();
});

test('the body is vertically continuous - no floating head, no detached limbs', () => {
  const character = makeCharacter();
  character.setMode('Idle');
  character.update(0.4);
  const spans = meshYSpans(character.root);
  const top = Math.max(...spans.map((s) => s[1]));
  // every 2 cm from the ankle up to just under the crown must be filled by SOME mesh; a gap
  // wider than the sampling step means a piece is floating (the old neck/shoulder/hip gaps).
  const covered = (y) => spans.some(([lo, hi]) => y >= lo - 0.005 && y <= hi + 0.005);
  const holes = [];
  for (let y = 0.08; y <= top - 0.06; y += 0.02) if (!covered(y)) holes.push(+y.toFixed(2));
  assert.equal(holes.length, 0, `vertical gaps in the body at y=${holes.join(', ')} - a part is floating`);
  character.dispose();
});

test('the rig pivots and carry grips survive by name', () => {
  const character = makeCharacter();
  for (const side of ['L', 'R']) {
    assert.ok(character.hand(side), `hand ${side} exists`);
    assert.ok(character.carryGrip(side), `carry grip ${side} exists`);
    assert.equal(character.carryGrip(side).userData.kind, 'customer-carry-grip');
  }
  // the carry grip tracks the hand it was cloned from (checkout parents products here)
  character.root.updateMatrixWorld(true);
  const hand = character.hand('R').getWorldPosition(new THREE.Vector3());
  const grip = character.carryGrip('R').getWorldPosition(new THREE.Vector3());
  assert.ok(hand.distanceTo(grip) < 0.12, 'the carry grip stays inside the palm');
  character.dispose();
});

test('every animation mode updates to a finite, floor-respecting pose without throwing', () => {
  const character = makeCharacter();
  const MODES = ['Idle', 'Walk', 'WalkBag', 'Swing', 'Browse', 'Checkout', 'Present', 'Receive', 'ReceiveBag', 'Declined', 'Impatient'];
  for (const mode of MODES) {
    character.setMode(mode);
    for (let i = 0; i < 6; i++) character.update(0.12);
    const spans = meshYSpans(character.root);
    for (const [lo, hi] of spans) {
      assert.ok(Number.isFinite(lo) && Number.isFinite(hi), `${mode}: finite bounds`);
    }
    // a moving character may lift a foot, but nothing should sink far through the floor
    const footY = Math.min(...spans.map((s) => s[0]));
    assert.ok(footY > -0.12, `${mode}: no limb punches deep through the floor (got ${footY.toFixed(3)})`);
  }
  character.dispose();
});
