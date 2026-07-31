import test from 'node:test';
import assert from 'node:assert/strict';

import { BROOM_FEEL } from '../src/data/broomFeel.js';

// Phase 6's tuning surface. Feel itself is judged from renders and clips —
// these pin the CONTRACT: the values live in one frozen config, and the few
// hard ceilings the review set are numbers a test can hold.

test('every feel value lives in the one frozen config', () => {
  assert.ok(Object.isFrozen(BROOM_FEEL), 'the config object is frozen');
  for (const [key, section] of Object.entries(BROOM_FEEL)) {
    assert.equal(typeof section, 'object', `${key} is a section`);
    assert.ok(Object.isFrozen(section), `${key} is frozen`);
  }
});

test('the camera response stays under the review ceiling of 2 degrees', () => {
  assert.ok(BROOM_FEEL.cameraKick.maxDeg > 0, 'there IS a contact response');
  assert.ok(BROOM_FEEL.cameraKick.maxDeg < 2, 'and it stays under 2 degrees');
  assert.ok(BROOM_FEEL.cameraKick.inTime > 0 && BROOM_FEEL.cameraKick.outTime > 0,
    'eased in and out, never a snap');
});

test('the walk bob is locked to the characters\' stride rate', () => {
  // 8.7 rad/s is the stride rate the whole game animates at (courseScene
  // bobPhase). A held tool bobbing at any other rate reads as detached.
  assert.equal(BROOM_FEEL.walk.bobRate, 8.7);
});

test('the viewmodel pass owns its own lens and layer', () => {
  assert.notEqual(BROOM_FEEL.camera.fov, 66, 'not hostage to the walk FOV');
  assert.ok(BROOM_FEEL.camera.near < 0.15, 'arms live inside the world near plane');
  assert.notEqual(BROOM_FEEL.camera.layer, 30, 'distinct from the delivery-carry overlay layer');
});

test('every duration and rate is a positive finite number', () => {
  const timings = [
    BROOM_FEEL.equip.duration, BROOM_FEEL.equip.settleTime,
    BROOM_FEEL.unequip.duration,
    BROOM_FEEL.stroke.rate, BROOM_FEEL.stroke.span,
    BROOM_FEEL.pitch.followRate, BROOM_FEEL.surface.tiltRate,
    BROOM_FEEL.collision.slideRate, BROOM_FEEL.audio.stopTail,
  ];
  for (const value of timings) {
    assert.ok(Number.isFinite(value) && value > 0, `${value} is a positive number`);
  }
});

test('contact particles answer both interior surface kinds', () => {
  // cleaningSurfaceAt reports 'carpet' | 'hard-floor'; a missing entry would
  // silently fall back to one look for every material.
  assert.ok(BROOM_FEEL.particles.surface['hard-floor'], 'hard-floor styled');
  assert.ok(BROOM_FEEL.particles.surface.carpet, 'carpet styled');
});

test('the audio loop answers both interior surface kinds', () => {
  assert.ok(BROOM_FEEL.audio.surface['hard-floor'], 'hard-floor voiced');
  assert.ok(BROOM_FEEL.audio.surface.carpet, 'carpet voiced');
  assert.ok(BROOM_FEEL.audio.surface.carpet.hz < BROOM_FEEL.audio.surface['hard-floor'].hz,
    'carpet is the duller drag, boards the bright bristle');
});

test('the debris push beats the walk speed — dirt recedes, it is not overrun', () => {
  // Walking is 2.2 yd/s. A push slower than that walks OVER its own pile and
  // the debris pops out behind the bristles — the round-1 "dirt lag".
  assert.ok(BROOM_FEEL.dirt.pushSpeed > 2.2,
    `pushSpeed ${BROOM_FEEL.dirt.pushSpeed} must beat the 2.2 yd/s walk`);
  assert.ok(BROOM_FEEL.dirt.maxStep > 0 && BROOM_FEEL.dirt.maxStep < 1,
    'a stroke still cannot fling debris across the room');
});

test('the head-follow spring is under-damped — it settles, it does not snap', () => {
  assert.ok(BROOM_FEEL.weight.lagHz > 0, 'the spring has a natural frequency');
  assert.ok(BROOM_FEEL.weight.lagDamping > 0 && BROOM_FEEL.weight.lagDamping < 1,
    'damping < 1 gives the visible overshoot-and-settle');
});

test('a jam stalls the broom proud instead of folding it vertical', () => {
  // Round 1 pulled the carry pitch down 0.55 rad at a full clamp — a
  // vertical stick at the feet. The stall keeps it a working tool.
  assert.ok(BROOM_FEEL.collision.carrySteepen < 0.4, 'the jam no longer folds the shaft');
  assert.ok(BROOM_FEEL.collision.stallSquash > 0 && BROOM_FEEL.collision.stallSquash < 1,
    'the stroke visibly stalls while jammed');
  assert.ok(BROOM_FEEL.collision.poseReachFloor >= 0.4,
    'the drawn pose never solves into the feet');
});

test('the sweep keeps the sim-preserving contact duty it shipped with', () => {
  // duty = (2/PI)*acos(contactCos) — the fraction of each pass in contact.
  const duty = (2 / Math.PI) * Math.acos(BROOM_FEEL.stroke.contactCos);
  assert.ok(duty > 0.45 && duty < 0.75, `duty ${duty.toFixed(3)} stays near the tuned 0.606`);
});
