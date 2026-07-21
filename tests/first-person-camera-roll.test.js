// The first-person camera owns yaw and pitch and NOTHING ELSE. It must never
// carry roll, because roll tilts the entire view: the horizon, the treeline and
// the ground all slant, and no amount of mouse movement straightens them.
//
// This is a regression test for a real tilt. The management camera is an orbit
// rig that poses itself with camera.lookAt(). lookAt() writes a quaternion, and
// three.js re-derives the Euler in whatever order the camera CURRENTLY has —
// the default XYZ. In XYZ order a perfectly roll-free orbit pose still lands a
// non-zero .z, because XYZ's third angle is not "roll about the view axis".
// That value is harmless while the order stays XYZ.
//
// Walking then switched the order to YXZ and assigned only .x and .y. Under
// YXZ the third angle IS roll about the view axis, so the leftover .z stopped
// being a decomposition artifact and became a literal 4.85-degree tilt that
// survived into every first-person frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setFirstPersonOrientation } from '../src/render3d/mouseLook.js';

// How far the camera's own +X axis leaves the world horizontal plane. This is
// the number a player sees as a slanted horizon; it is zero for an upright view.
function rollDegrees(camera) {
  camera.updateMatrixWorld(true);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  return Math.asin(Math.max(-1, Math.min(1, right.y))) * (180 / Math.PI);
}

// Pose a camera exactly the way the orbit rig does (src/render3d/cameraRig.js).
function orbitPosed(yaw = 0.12, pitch = 0.78, dist = 210) {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  const target = new THREE.Vector3(0, 0, 0);
  const cp = Math.cos(pitch);
  camera.position.copy(target).add(new THREE.Vector3(
    Math.sin(yaw) * cp * dist,
    Math.sin(pitch) * dist,
    Math.cos(yaw) * cp * dist,
  ));
  camera.lookAt(target);
  return camera;
}

test('the orbit rig leaves a non-zero rotation.z that is NOT roll', () => {
  // Guards the premise: if three.js ever stopped doing this the bug below could
  // not recur, and this test would be pinning a scenario that no longer exists.
  const camera = orbitPosed();
  assert.equal(camera.rotation.order, 'XYZ', 'cameras start in three.js default XYZ order');
  assert.ok(Math.abs(camera.rotation.z) > 0.01, `orbit lookAt leaves a real .z (${camera.rotation.z})`);
  assert.ok(Math.abs(rollDegrees(camera)) < 1e-9, 'but the orbit view itself is upright');
});

test('going first-person from an orbit pose leaves the view upright', () => {
  const camera = orbitPosed();
  setFirstPersonOrientation(camera, Math.PI, 0); // the walk spawn pose: yaw PI, level
  assert.ok(
    Math.abs(rollDegrees(camera)) < 1e-9,
    `horizon must be level, got ${rollDegrees(camera).toFixed(4)} degrees of tilt`,
  );
});

test('the view stays upright at every yaw and pitch the player can reach', () => {
  for (const yaw of [-Math.PI, -1.3, 0, 0.7, Math.PI]) {
    for (const pitch of [-1.35, -0.4, 0, 0.9, 1.35]) { // mouseLook clamps pitch to +/-1.35
      const camera = orbitPosed();
      setFirstPersonOrientation(camera, yaw, pitch);
      assert.ok(
        Math.abs(rollDegrees(camera)) < 1e-9,
        `yaw ${yaw} pitch ${pitch} tilted the view by ${rollDegrees(camera).toFixed(4)} degrees`,
      );
    }
  }
});

test('yaw and pitch are actually applied, in YXZ order', () => {
  const camera = orbitPosed();
  setFirstPersonOrientation(camera, 0.6, -0.25);
  assert.equal(camera.rotation.order, 'YXZ', 'first-person needs yaw-then-pitch order');
  assert.equal(camera.rotation.y, 0.6);
  assert.equal(camera.rotation.x, -0.25);
  assert.equal(camera.rotation.z, 0, 'no roll component is left behind');

  // and the camera really is looking where the yaw/pitch say it is
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  assert.ok(Math.abs(forward.y - Math.sin(-0.25)) < 1e-9, 'pitch aims the view up/down correctly');
});

test('repeated first-person writes never accumulate roll', () => {
  const camera = orbitPosed();
  for (let i = 0; i < 50; i++) setFirstPersonOrientation(camera, i * 0.1, Math.sin(i) * 0.5);
  assert.ok(Math.abs(rollDegrees(camera)) < 1e-9, 'roll stays at zero frame after frame');
});
