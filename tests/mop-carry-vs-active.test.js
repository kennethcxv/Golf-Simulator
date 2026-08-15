// 5.2 (Goal 26) — CARRIED AND MOPPING ARE NOT THE SAME MOP.
//
// "The strings fly everywhere. It must feel HEAVY. Carried: they barely move, a
// sharp turn produces a small slow response, no flailing, no jitter at rest.
// Actively mopping: they drag, compress, lag and recover, and settle smoothly
// when the stroke stops. SEPARATE CARRY AND ACTIVE PARAMETERS -- one solver
// tuning cannot do both."
//
// The single tuning that shipped before this is the reason both halves were
// wrong at once: it was loose enough for the yarn to whip when merely walking,
// and that same looseness is what a mopping stroke needs in order to trail. You
// cannot move one number and fix both, which is exactly what he said.
//
// These tests drive the SAME head motion through both modes and require the
// results to differ in the direction the brief names. Driving identical input is
// the whole point: if the two modes were the same table under two names, every
// assertion below would collapse, and the run against the pre-fix file is what
// proves they do.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVerletMopStrands, CARRY_FEEL, ACTIVE_FEEL } from '../src/render3d/mopVerlet.js';

const LENGTH = 0.30;
const RADIUS = 0.115;

function makeRig() {
  const material = new THREE.MeshBasicMaterial();
  const rig = createVerletMopStrands({
    THREE, material, count: 48, segments: 4, radius: RADIUS, length: LENGTH,
  });
  const head = new THREE.Group();
  head.add(rig.root);
  head.position.set(0, 1, 0);
  head.updateMatrixWorld(true);
  return { rig, head };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const lagOf = (rig, head) => {
  const tips = rig.tipsWorld();
  return Math.hypot(
    mean(tips.map((t) => t.x)) - head.position.x,
    mean(tips.map((t) => t.z)) - head.position.z,
  );
};

// Settle first, then run one identical sweep, sampling how far the tip cloud
// trails the head. The mode is set BEFORE the settle so the blend has finished
// long before the sweep begins -- otherwise this measures the transition rather
// than the mode.
function sweep(active) {
  const { rig, head } = makeRig();
  rig.setActive(active);
  for (let f = 0; f < 200; f += 1) { head.updateMatrixWorld(true); rig.update(1 / 60, null); }
  // A steady 1.0 yd/s draw, which is a mopping stroke -- not a 1.9 yd/s whip.
  // At the whip speed the chain saturates against its own length and both modes
  // read the same, which is a measurement of the strand length, not the tuning.
  const lags = [];
  for (let f = 0; f < 90; f += 1) {
    head.position.x += 1.0 / 60;
    head.updateMatrixWorld(true);
    rig.update(1 / 60, 0.0);
    if (f > 30) lags.push(lagOf(rig, head));
  }
  // and the recovery once the head stops
  const settle = [];
  for (let f = 0; f < 120; f += 1) {
    head.updateMatrixWorld(true);
    rig.update(1 / 60, 0.0);
    settle.push(lagOf(rig, head));
  }
  return { peakLag: Math.max(...lags), meanLag: mean(lags), settled: settle[settle.length - 1] };
}

test('the two tunings are actually different tables, not one table twice', () => {
  // If someone later "simplifies" these into one object, every behavioural
  // assertion below still passes trivially -- so the tables get their own check.
  const differing = ['damping', 'floorFriction', 'iterations', 'buckle', 'stiffness']
    .filter((k) => CARRY_FEEL[k] !== ACTIVE_FEEL[k]);
  assert.ok(differing.length >= 3,
    `carry and active must differ in more than a token field; differ in ${JSON.stringify(differing)}`);
  // Deliberately the direction that reads wrong until you have run the sweep in
  // mopVerlet.js's comment: `damping` is velocity KEPT, and a node that keeps
  // the velocity it inherited from the head travels with the head, so HIGH
  // damping is the tight carried mop and LOW damping is the one that trails.
  assert.ok(CARRY_FEEL.damping > ACTIVE_FEEL.damping,
    'carried yarn keeps more of its inherited velocity, which is what keeps it under the head');
});

test('carried, the same sweep produces far less swing than mopping does', () => {
  const carried = sweep(false);
  const mopping = sweep(true);
  // "they barely move" vs "they drag, compress, lag"
  assert.ok(mopping.peakLag > carried.peakLag * 1.6,
    `mopping should trail visibly further than carrying: mop ${mopping.peakLag.toFixed(4)} vs carry ${carried.peakLag.toFixed(4)}`);
  assert.ok(carried.peakLag < LENGTH * 0.45,
    `carried lag ${carried.peakLag.toFixed(4)} is flailing for a 1 yd/s draw`);
});

test('both modes come back to rest, and the carried one gets there', () => {
  for (const active of [false, true]) {
    const r = sweep(active);
    assert.ok(r.settled < 0.02,
      `${active ? 'mopping' : 'carried'} yarn never settled: ${r.settled.toFixed(4)} off-axis after 2s still`);
  }
});

test('the mode switch is blended, so nothing pops on the frame the button lifts', () => {
  const { rig, head } = makeRig();
  rig.setActive(true);
  for (let f = 0; f < 120; f += 1) { head.updateMatrixWorld(true); rig.update(1 / 60, null); }
  const before = rig.feel().damping;
  rig.setActive(false);
  head.updateMatrixWorld(true);
  rig.update(1 / 60, null);
  const oneFrameLater = rig.feel().damping;
  assert.ok(Math.abs(oneFrameLater - before) < Math.abs(CARRY_FEEL.damping - ACTIVE_FEEL.damping) * 0.5,
    `one frame moved damping ${before} -> ${oneFrameLater}; that is a snap, not a blend`);
  // ...and it does arrive
  for (let f = 0; f < 60; f += 1) { head.updateMatrixWorld(true); rig.update(1 / 60, null); }
  assert.equal(rig.feel().damping, CARRY_FEEL.damping, 'the blend never reached the carry tuning');
  assert.equal(rig.isActive(), false);
});
