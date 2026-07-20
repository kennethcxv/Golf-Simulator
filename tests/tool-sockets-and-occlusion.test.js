// A tool's effects come OUT OF THE TOOL, and stop at the first thing in the way.
//
// Two defects this locks down, both of which shipped:
//
// 1. The jet was emitted from a hand-tuned camera-local constant —
//    `camera.localToWorld(0.24, -0.24, -1.25)` — that only approximated the lance tip and ignored
//    `heldRoot` entirely. `heldRoot` is animated every frame (gait bob, and a -0.42y equip ease),
//    so for the first quarter-second after equipping, water came out up to 42 cm from the nozzle.
//    The fix is a real socket on the tool: whatever the viewmodel does, the water starts at the tip.
//
// 2. `washAim` intersected ONLY the five grime planes. Nothing else was in the set, so the porch
//    roof, the walls and the building itself were not occluders — you could stand inside the
//    clubhouse and wash the south siding through it.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { attachSocket, socketWorld, socketWorldDirection } from '../src/render3d/toolSockets.js';

// A stand-in for the real held rig: camera -> heldRoot -> tool group -> parts.
// The numbers are the shipped washer's: group at (0.24,-0.34,-0.60), tip at (0,0.075,-0.7).
function rig() {
  const camera = new THREE.PerspectiveCamera();
  const heldRoot = new THREE.Group();
  camera.add(heldRoot);
  const tool = new THREE.Group();
  tool.position.set(0.24, -0.34, -0.60);
  tool.rotation.set(0.06, -0.13, 0);
  heldRoot.add(tool);
  return { camera, heldRoot, tool };
}

test('a socket resolves to the authored point on the tool, not a guessed camera offset', () => {
  const { camera, tool } = rig();
  attachSocket(tool, 'nozzle', [0, 0.075, -0.7]);
  camera.updateMatrixWorld(true);

  const got = socketWorld(tool, 'nozzle', new THREE.Vector3());

  // Independently: the same local point pushed through the tool's own world matrix.
  const want = new THREE.Vector3(0, 0.075, -0.7).applyMatrix4(tool.matrixWorld);
  assert.ok(got.distanceTo(want) < 1e-9, `socket ${got.toArray()} != authored ${want.toArray()}`);

  // And it is NOT where the old hardcoded constant put it.
  const legacy = camera.localToWorld(new THREE.Vector3(0.24, -0.24, -1.25));
  assert.ok(got.distanceTo(legacy) > 0.05,
    'the socket must not silently reproduce the constant it replaces');
});

test('the socket follows the viewmodel when the rig animates', () => {
  const { camera, heldRoot, tool } = rig();
  attachSocket(tool, 'nozzle', [0, 0.075, -0.7]);

  camera.updateMatrixWorld(true);
  const atRest = socketWorld(tool, 'nozzle', new THREE.Vector3());

  // the equip ease drops the whole rig 42 cm — the exact case the constant got wrong
  heldRoot.position.y = -0.42;
  camera.updateMatrixWorld(true);
  const equipping = socketWorld(tool, 'nozzle', new THREE.Vector3());

  assert.ok(Math.abs((atRest.y - equipping.y) - 0.42) < 1e-9,
    'the nozzle must track heldRoot; a camera-space constant does not');
});

test('a socket reports the direction the tool is actually pointing', () => {
  const { camera, tool } = rig();
  attachSocket(tool, 'nozzle', [0, 0.075, -0.7]);
  camera.updateMatrixWorld(true);

  const dir = socketWorldDirection(tool, 'nozzle', new THREE.Vector3());
  assert.ok(Math.abs(dir.length() - 1) < 1e-9, 'direction must be normalised');

  // the tool is yawed -0.13 rad, so its forward is NOT the camera's forward
  const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  assert.ok(dir.dot(camFwd) < 0.9999, 'the tool aims where the tool points, not where the camera does');
});

test('missing sockets fail loudly instead of silently emitting from the origin', () => {
  const { tool } = rig();
  assert.throws(() => socketWorld(tool, 'nozzle', new THREE.Vector3()), /nozzle/,
    'a typo in a socket name must not degrade into emitting from the tool origin');
});

// --- occlusion ---------------------------------------------------------------------------------

import { firstUnoccludedHit } from '../src/render3d/toolSockets.js';

function plane(name, z, id) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
  m.name = name;
  m.position.z = z;
  m.userData.washId = id;
  m.updateMatrixWorld(true);
  return m;
}

test('an occluder between the nozzle and the surface blocks the jet', () => {
  const target = plane('siding', -5, 'sidingSE');
  const wall = plane('interiorWall', -2, null); // stands between the player and the siding

  const origin = new THREE.Vector3(0, 0, 0);
  const dir = new THREE.Vector3(0, 0, -1);

  const clear = firstUnoccludedHit(origin, dir, [target], [], 7);
  assert.equal(clear && clear.object.userData.washId, 'sidingSE', 'with nothing in the way it hits');

  const blocked = firstUnoccludedHit(origin, dir, [target], [wall], 7);
  assert.equal(blocked, null, 'you must not be able to wash a wall through another wall');
});

test('an occluder BEHIND the surface does not block it', () => {
  const target = plane('siding', -3, 'sidingSE');
  const behind = plane('backdrop', -6, null);
  const hit = firstUnoccludedHit(
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1), [target], [behind], 7,
  );
  assert.equal(hit && hit.object.userData.washId, 'sidingSE',
    'only geometry in FRONT of the surface occludes it');
});

test('the jet has a finite reach', () => {
  const target = plane('siding', -20, 'sidingSE');
  const hit = firstUnoccludedHit(
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1), [target], [], 7,
  );
  assert.equal(hit, null, 'a surface beyond the tool reach is not washable');
});
