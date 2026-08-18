// THE FREEZE ATE THE CURSOR.
//
// "I see the thing for cursor when editing the terrain or paint however it
// doesn't move according to the user's cursor, it just stays there."
//
// Measured in Electron on his own save (qa/editor-follow/watchedfail.json): the
// stability freeze took 3,117 objects at frame 900 of walk, the brush ring
// among them, and from that moment the ring drew at ONE pixel — (1280, 685) —
// at every pointer position, up to 830 px from the mouse. `editorCursorState()`
// reported it tracking perfectly, because `position` still took every write.
// Only `matrixWorld` stopped.
//
// Two contracts hold the fix, and both are testable without a renderer:
//
//   1. an object marked `liveVisualHierarchy` is never enrolled, so the editor
//      overlays keep auto matrices for the whole session;
//   2. the watchdog thaws a frozen object the moment a verb writes to it — the
//      safety net for every overlay nobody has thought to mark yet.
//
// The renderer half — that the watchdog now ticks outside walk.active — is a
// call-site gate in courseScene.render and is proved by the Electron A/B, not
// here. A test that does not launch the game cannot certify it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  stabilityFreeze, matrixFreezeSnapshot, matrixFreezeWatchdogTick,
  matrixFreezeDiagnostics, matrixFreezeReset,
} from '../src/render3d/matrixFreeze.js';

function sceneWith(...objects) {
  const scene = new THREE.Scene();
  scene.add(...objects);
  return scene;
}

function stillMesh(name) {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  m.name = name;
  m.visible = false; // the overlays sit hidden and still for the whole walk
  return m;
}

test('a hidden, perfectly still overlay IS frozen when nothing marks it', () => {
  matrixFreezeReset();
  const plain = stillMesh('editor-brush-ring');
  const scene = sceneWith(plain);
  const snap = matrixFreezeSnapshot(scene);
  const out = stabilityFreeze(scene, snap);
  assert.equal(out.frozen, 1, 'this is the defect: bit-stable is not the same as static');
  assert.equal(plain.matrixAutoUpdate, false);
});

test('the same overlay marked liveVisualHierarchy is never enrolled', () => {
  matrixFreezeReset();
  const live = stillMesh('editor-brush-ring');
  live.userData.liveVisualHierarchy = true;
  const scene = sceneWith(live);
  const out = stabilityFreeze(scene, matrixFreezeSnapshot(scene));
  assert.equal(out.frozen, 0);
  assert.equal(live.matrixAutoUpdate, true, 'the ring must still be able to move');
  assert.equal(out.skippedReasons['live-visual-hierarchy'], 1);
  assert.equal(matrixFreezeDiagnostics().watchdogEnrolled, 0);
});

test('the mark covers a whole overlay group, not just the node carrying it', () => {
  matrixFreezeReset();
  const group = new THREE.Group();
  group.name = 'editor-placement-ghost';
  group.userData.liveVisualHierarchy = true;
  const disc = stillMesh('ghost-disc');
  const body = stillMesh('ghost-body');
  group.add(disc, body);
  const scene = sceneWith(group);
  const out = stabilityFreeze(scene, matrixFreezeSnapshot(scene));
  assert.equal(out.frozen, 0, 'children of a live group move with it and must not freeze');
  assert.equal(disc.matrixAutoUpdate, true);
  assert.equal(body.matrixAutoUpdate, true);
});

test('a frozen object that is later written to is thawed by the watchdog', () => {
  matrixFreezeReset();
  const surprise = stillMesh('an-overlay-nobody-marked');
  const scene = sceneWith(surprise);
  stabilityFreeze(scene, matrixFreezeSnapshot(scene));
  assert.equal(surprise.matrixAutoUpdate, false);
  // the write the editor makes on the first pointer move
  surprise.position.set(12, 0.25, -7);
  matrixFreezeWatchdogTick();
  assert.equal(surprise.matrixAutoUpdate, true, 'the write has to reach the renderer');
  assert.equal(matrixFreezeDiagnostics().watchdogThawed, 1);
  // and once thawed it stays thawed — a re-freeze mid-session would restage the bug
  matrixFreezeWatchdogTick();
  assert.equal(surprise.matrixAutoUpdate, true);
});

test('a scale-only write thaws too — a brush ring resizes without moving', () => {
  matrixFreezeReset();
  const ring = stillMesh('editor-brush-ring');
  const scene = sceneWith(ring);
  stabilityFreeze(scene, matrixFreezeSnapshot(scene));
  ring.scale.setScalar(20); // the size slider, with the pointer standing still
  matrixFreezeWatchdogTick();
  assert.equal(ring.matrixAutoUpdate, true);
});

test('the watchdog leaves a genuinely static object frozen', () => {
  matrixFreezeReset();
  const wall = stillMesh('a-wall');
  const scene = sceneWith(wall);
  stabilityFreeze(scene, matrixFreezeSnapshot(scene));
  for (let i = 0; i < 5; i += 1) matrixFreezeWatchdogTick();
  assert.equal(wall.matrixAutoUpdate, false, 'the freeze must keep paying for the static set');
  assert.equal(matrixFreezeDiagnostics().watchdogThawed, 0);
});
