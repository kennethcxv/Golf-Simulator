// A8 — THE CARRIED HEAD IS ANCHORED TO THE FLOOR, NOT TO YOUR VIEW.
//
// The test this replaces asserted `carryDrop > 0 && carryDrop < 0.8` and passed
// through every round of the defect, because a constant's RANGE cannot express
// the thing that was wrong: the constant was measured from the hands, and the
// hands ride camera.matrixWorld, so looking up lifted the bristles off the
// boards (measured 0.601 yd at level, 1.206 yd at maxPitch).
//
// So this drives the REAL solve — createBroomViewmodel().update() — across the
// pitch range and asserts the invariant: while carried, the drawn contact
// socket's height above the floor does not depend on where you are looking.
//
// The rig is given named sockets so the solve takes its `live` geometry path
// rather than the procedural fallback, whose shaft axis is 126 deg away.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBroomViewmodel } from '../src/render3d/broomViewmodel.js';
import { BROOM_FEEL } from '../src/data/broomFeel.js';

const FLOOR_Y = 0;
const EYE_Y = 1.62;

function makeRig() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.01, 100);
  camera.position.set(0, EYE_Y, 0);

  const broomGroup = new THREE.Group();
  scene.add(broomGroup);
  // A shaft laid along -Z in tool space: bristles at the origin, the gripping
  // hand 1.05 yd back, the support hand between them. Only the RELATIVE
  // placement matters — the solve orients the whole group from it.
  const mk = (name, z) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(0, 0, z);
    broomGroup.add(o);
    return o;
  };
  mk('SOCKET_FloorContact', 0);
  mk('SOCKET_GripSupport', -0.62);
  mk('SOCKET_GripPrimary', -1.05);

  const handsRoot = new THREE.Group();
  for (const n of ['FirstPersonRightHand', 'FirstPersonLeftHand']) {
    const h = new THREE.Group();
    h.name = n;
    handsRoot.add(h);
  }
  scene.add(handsRoot);
  const fpHands = { root: handsRoot };

  const vm = createBroomViewmodel({
    camera,
    renderer: {},          // only render() touches it, and this never renders
    scene,
    broomGroup,
    fpHands,
    colliderQuery: () => null,
    floorY: () => FLOOR_Y,
  });
  vm.setActive(true);
  return { vm, camera, scene };
}

// Settle the solve: reach, the stroke spring and the collision slide are all
// smoothed, so a single frame reports a pose still on its way to the answer.
function settleAt(vm, camera, pitch) {
  camera.rotation.set(pitch, 0, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  for (let i = 0; i < 240; i += 1) {
    vm.update(1 / 60, { pitch, yaw: 0, using: false, moving: false, phase: 0, reducedMotion: true });
  }
  return vm.diagnostics();
}

test('the carried broom head keeps its height above the floor when you look up', () => {
  const { vm, camera } = makeRig();
  const p = BROOM_FEEL.pitch;

  // Both of these are ABOVE carryAbove, so both are the fully carried pose —
  // the regime that had no floor reference at all.
  const level = settleAt(vm, camera, 0);
  const up = settleAt(vm, camera, p.maxPitch);

  assert.equal(level.geomSource, 'live', 'the solve used the socketed rig, not the fallback');
  assert.equal(up.geomSource, 'live');
  assert.equal(level.workBlend, 0, 'level look is the carried pose');
  assert.equal(up.workBlend, 0, 'looking up is the carried pose');

  assert.ok(level.headAboveFloor != null && up.headAboveFloor != null,
    'the rig exposes the drawn head height');

  const lift = up.headAboveFloor - level.headAboveFloor;
  assert.ok(Math.abs(lift) < 0.05,
    `looking up lifted the head ${lift.toFixed(3)} yd off the boards `
    + `(${level.headAboveFloor} -> ${up.headAboveFloor}); the carry pose must be floor-referenced`);
});

test('the carried head rides at carryHover and the planted head at floorKiss', () => {
  const { vm, camera } = makeRig();
  const p = BROOM_FEEL.pitch;

  const carried = settleAt(vm, camera, 0);
  const planted = settleAt(vm, camera, p.minPitch);

  assert.equal(planted.workBlend, 1, 'the steepest down-look is the planted pose');
  // Tolerances are loose because the rigid-handle re-tension moves the head a
  // little off the requested drop; the point is WHICH datum each pose is
  // measured from, not the last centimetre.
  assert.ok(Math.abs(carried.headAboveFloor - BROOM_FEEL.compose.carryHover) < 0.12,
    `carried head ${carried.headAboveFloor} should sit near carryHover `
    + `${BROOM_FEEL.compose.carryHover}`);
  assert.ok(Math.abs(planted.headAboveFloor - BROOM_FEEL.surface.floorKiss) < 0.06,
    `planted head ${planted.headAboveFloor} should kiss the boards at `
    + `${BROOM_FEEL.surface.floorKiss}`);
});

test('carryHover is a height above the boards, so it cannot exceed head height', () => {
  // The old constant was a drop below the hands and had no such bound; this one
  // is a floor clearance, and a broom carried at chest height is the defect.
  const h = BROOM_FEEL.compose.carryHover;
  assert.ok(h > 0, 'the carried head stays above the boards');
  assert.ok(h < 0.8, `carryHover ${h} keeps the carried head below the waist`);
});
