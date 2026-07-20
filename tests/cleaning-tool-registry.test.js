// The registry is the single source of truth for every cleaning tool.
//
// Before it, a tool was spread across five hardcoded lists — heldGroups, GRIPS, the belt array,
// the toast strings and the audio switch — and it was entirely possible to ship a tool you could
// equip but not hold, or hold but not hear. These tests assert the registry is complete enough
// that no such half-tool can exist.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CLEANING_TOOLS, TOOL_IDS, BELT_ORDER, TOOL_CLASS, DIRT, toolDef, toolHandles,
} from '../src/data/cleaningTools.js';
import { buildToolViewmodels } from '../src/render3d/toolViewmodel.js';
import { socketWorld } from '../src/render3d/toolSockets.js';
import { makeFpHands } from '../src/render3d/fpHands.js';

const CLASSES = new Set(Object.values(TOOL_CLASS));
const DIRTS = new Set(Object.values(DIRT));

test('every tool is completely specified', () => {
  assert.ok(TOOL_IDS.length >= 9, `expected the full cleaning set, got ${TOOL_IDS.length}`);
  for (const id of TOOL_IDS) {
    const t = CLEANING_TOOLS[id];
    assert.equal(t.id, id, `${id}: id must match its key`);
    assert.ok(t.label && t.label.length > 2, `${id}: needs a human label`);
    assert.ok(CLASSES.has(t.toolClass), `${id}: bad toolClass '${t.toolClass}'`);
    assert.ok(Array.isArray(t.dirt) && t.dirt.length, `${id}: must declare what it cleans`);
    for (const d of t.dirt) assert.ok(DIRTS.has(d), `${id}: unknown dirt class '${d}'`);
    assert.ok(t.reach > 0 && t.reach <= 8, `${id}: implausible reach ${t.reach}`);
    assert.ok(t.radius > 0 && t.radius <= 1, `${id}: implausible radius ${t.radius}`);
    assert.ok(t.strength > 0, `${id}: needs a strength`);
    assert.ok(t.grip && Array.isArray(t.grip.pos), `${id}: needs a grip pose`);
    assert.ok(t.audio && t.audio.loop, `${id}: needs at least a loop sound`);
    assert.ok(t.equipToast, `${id}: needs an equip line`);
    assert.ok(t.sockets && Object.keys(t.sockets).length,
      `${id}: needs at least one socket — effects must come out of the tool`);
  }
});

test('every tool declares the socket its own class needs', () => {
  // A jet or a spray emits; a stroke, sweep, scoop or carry tool touches. Either way the point on
  // the tool is authored, never guessed from the camera.
  const needs = {
    [TOOL_CLASS.JET]: 'nozzle',
    [TOOL_CLASS.SPRAY]: 'nozzle',
    [TOOL_CLASS.SUCTION]: 'nozzle',
    [TOOL_CLASS.STROKE]: 'contact',
    [TOOL_CLASS.SWEEP]: 'contact',
    [TOOL_CLASS.SCOOP]: 'contact',
    [TOOL_CLASS.CARRY]: 'contact',
  };
  for (const id of TOOL_IDS) {
    const t = CLEANING_TOOLS[id];
    const want = needs[t.toolClass];
    assert.ok(t.sockets[want], `${id} (${t.toolClass}) must author a '${want}' socket`);
  }
});

test('the belt cycles through real tools and an empty hand', () => {
  assert.equal(BELT_ORDER[0], null, 'the belt must include putting the tools away');
  const seen = new Set();
  for (const id of BELT_ORDER) {
    if (id === null) continue;
    assert.ok(CLEANING_TOOLS[id], `belt lists '${id}', which is not a tool`);
    assert.ok(!seen.has(id), `belt lists '${id}' twice`);
    seen.add(id);
  }
  for (const id of TOOL_IDS) {
    if (CLEANING_TOOLS[id].belt) assert.ok(seen.has(id), `${id} is a belt tool but is not on the belt`);
  }
});

test('every tool builds into real geometry with resolvable sockets', () => {
  const built = buildToolViewmodels();
  try {
    for (const id of TOOL_IDS) {
      const def = toolDef(id);
      const g = built.groups[id];
      assert.ok(g, `${id}: no viewmodel group`);
      if (def.external) continue; // geometry authored elsewhere; sockets still checked below

      let meshes = 0;
      g.traverse((o) => { if (o.isMesh) meshes++; });
      assert.ok(meshes > 0, `${id}: built no meshes`);

      // Sockets must resolve without throwing once the group has a world matrix.
      g.updateMatrixWorld(true);
      for (const name of Object.keys(def.sockets)) {
        const p = socketWorld(g, name, new THREE.Vector3());
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z),
          `${id}: socket '${name}' resolved to a non-finite point`);
      }
    }
  } finally {
    built.dispose();
  }
});

test('a held tool is a sane size and sits in front of the camera', () => {
  const built = buildToolViewmodels();
  try {
    for (const id of TOOL_IDS) {
      const def = toolDef(id);
      if (def.external || !def.parts) continue;
      const g = built.groups[id];
      g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g);
      const size = bb.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z);
      // A mop is long; a sponge is not. The ceiling allows for a floor tool whose head is a stride
      // and a half ahead AND whose hose trails back past the player — the vacuum is legitimately
      // ~2.8 yd end to end. Anything past 3 is a scale error, not a long tool.
      assert.ok(longest > 0.05, `${id}: ${longest.toFixed(3)} across — too small to read`);
      assert.ok(longest < 3.0, `${id}: ${longest.toFixed(3)} across — that is a scale error`);
      // In front of the camera, which looks down -Z.
      assert.ok(bb.max.z < 1.4, `${id}: geometry reaches z=${bb.max.z.toFixed(2)}, behind the eye`);
    }
  } finally {
    built.dispose();
  }
});

test('tool viewmodels share materials and geometry rather than duplicating them', () => {
  const built = buildToolViewmodels();
  try {
    const mats = new Set();
    const geos = new Set();
    let meshes = 0;
    for (const id of TOOL_IDS) {
      built.groups[id].traverse((o) => {
        if (!o.isMesh) return;
        meshes++;
        mats.add(o.material.uuid);
        geos.add(o.geometry.uuid);
      });
    }
    assert.ok(meshes > 30, `expected a real tool set, got ${meshes} meshes`);
    assert.ok(mats.size < meshes, 'materials must be shared across tools, not one per mesh');
  } finally {
    built.dispose();
  }
});

test('tool/dirt matching is honest', () => {
  assert.ok(toolHandles('vacuum', DIRT.DUST), 'the vacuum takes dust');
  assert.ok(!toolHandles('vacuum', DIRT.BONDED), 'a vacuum does not shift bonded algae');
  assert.ok(toolHandles('washer', DIRT.BONDED), 'the washer shifts bonded grime (with soap)');
  assert.ok(!toolHandles('washer', DIRT.DUST), 'you do not pressure-wash indoor dust');
  assert.ok(toolHandles('broom', DIRT.DEBRIS), 'the broom moves loose debris');
  assert.ok(!toolHandles('broom', DIRT.SMEAR), 'a broom does not wipe a smear');
  assert.equal(toolDef('nope'), null, 'unknown tools resolve to null, not undefined behaviour');
});

test('the mop is wet work and refuses carpet; the vacuum is the one that takes carpet', () => {
  assert.equal(CLEANING_TOOLS.mop.wets, true);
  assert.ok(CLEANING_TOOLS.mop.rejects.includes('carpet'),
    'mopping carpet must be rejected, not silently allowed');
  assert.ok(toolHandles('vacuum', DIRT.DUST));
});

test('the cloth needs solution first, so spray-then-wipe is a real sequence', () => {
  assert.equal(CLEANING_TOOLS.cloth.needsSolution, true);
  assert.equal(CLEANING_TOOLS.spray.loosens, true,
    'the spray must loosen rather than clean, or the cloth is pointless');
});

test('authored spray animation keeps its trigger attached to the named hinge', async () => {
  const built = buildToolViewmodels();
  const loader = {
    load(url, onLoad) {
      const scene = new THREE.Group();
      const held = new THREE.Group();
      scene.add(held);
      const animations = [];
      if (url.includes('asset_076_')) {
        const socket = new THREE.Object3D();
        socket.name = 'SOCKET_Trigger';
        socket.position.set(0.01, 0.21, 0.03);
        held.add(socket);
        const pivot = new THREE.Object3D();
        pivot.name = 'PIVOT_Trigger';
        pivot.position.set(-0.2, -0.4, 0.7); // the broken exported rest pose
        pivot.rotation.set(0.4, -0.2, 0.1);
        held.add(pivot);
        animations.push(new THREE.AnimationClip('SprayBottle_Trigger', 0.2, [
          new THREE.QuaternionKeyframeTrack(
            'PIVOT_Trigger.quaternion', [0, 0.2], [0, 0, 0, 1, 0.15, 0, 0, 0.9887],
          ),
        ]));
      }
      onLoad({ scene, animations });
    },
  };

  try {
    const results = await built.adoptAuthored(loader);
    assert.ok(results.every((result) => result.ok), 'the fixture loader should adopt every tool');
    const root = built.groups.spray.getObjectByName('PIVOT_Trigger');
    const socket = built.groups.spray.getObjectByName('SOCKET_Trigger');
    assert.ok(root && socket);
    assert.deepEqual(root.position.toArray(), socket.position.toArray(),
      'the pivot must be restored to the authored trigger socket');
    assert.deepEqual(root.quaternion.toArray(), [0, 0, 0, 1]);
    assert.equal(built.setUsing('spray', true), true, 'the real trigger clip should play');
    built.update(0.1);
    assert.deepEqual(built.diagnostics().playing, ['spray']);
    built.setUsing('spray', false);
    assert.deepEqual(built.diagnostics().playing, []);
  } finally {
    built.dispose();
  }
});

test('authored grip positions follow the animated socket hierarchy', async () => {
  const built = buildToolViewmodels();
  const loader = {
    load(url, onLoad) {
      const scene = new THREE.Group();
      if (url.includes('asset_074_')) {
        const grip = new THREE.Object3D();
        grip.name = 'SOCKET_GripPrimary';
        grip.position.set(0.04, 0.16, 0.12);
        scene.add(grip);
      }
      onLoad({ scene, animations: [] });
    },
  };
  try {
    await built.adoptAuthored(loader);
    const before = built.gripsFor('broom').grip.pos;
    const socket = built.groups.broom.getObjectByName('SOCKET_GripPrimary');
    socket.position.y += 0.3;
    const after = built.gripsFor('broom').grip.pos;
    assert.ok(after[1] > before[1] + 0.25,
      `animated grip should move with its socket (${before[1]} -> ${after[1]})`);
  } finally {
    built.dispose();
  }
});

test('repeated equip and unequip clips do not blend stale clamped poses', async () => {
  const built = buildToolViewmodels();
  const loader = {
    load(url, onLoad) {
      const scene = new THREE.Group();
      const grip = new THREE.Object3D();
      grip.name = 'SOCKET_GripPrimary';
      scene.add(grip);
      const animations = url.includes('asset_074_') ? [
        new THREE.AnimationClip('Broom_Equip', 0.2, [
          new THREE.VectorKeyframeTrack(
            'SOCKET_GripPrimary.position', [0, 0.2], [0, 0, 0, 0, 1, 0],
          ),
        ]),
        new THREE.AnimationClip('Broom_Unequip', 0.2, [
          new THREE.VectorKeyframeTrack(
            'SOCKET_GripPrimary.position', [0, 0.2], [0, 1, 0, 0, -1, 0],
          ),
        ]),
      ] : [];
      onLoad({ scene, animations });
    },
  };
  try {
    await built.adoptAuthored(loader);
    const advanceClip = () => {
      // Runtime clamps each mixer step to 100 ms, so advance a 200 ms fixture clip in two frames.
      built.update(0.1);
      built.update(0.1);
    };
    assert.equal(built.setEquipped('broom', true), true);
    advanceClip();
    assert.equal(built.setEquipped('broom', false), true);
    advanceClip();
    assert.equal(built.setEquipped('broom', true), true);
    advanceClip();
    const grip = built.groups.broom.getObjectByName('SOCKET_GripPrimary');
    assert.ok(grip.position.y > 0.90,
      `re-equipped socket should reach the equip endpoint, got y=${grip.position.y}`);
  } finally {
    built.dispose();
  }
});

test('first-person hands resample live authored grip positions without changing pose', () => {
  const hands = makeFpHands();
  try {
    hands.setTool('broom', {
      grip: { ...CLEANING_TOOLS.broom.grip, pos: [0.1, 0.2, 0.3] },
      support: { ...CLEANING_TOOLS.broom.support, pos: [-0.1, 0.0, -0.4] },
    });
    hands.syncGrips({
      grip: { ...CLEANING_TOOLS.broom.grip, pos: [0.2, -0.1, 0.5] },
      support: { ...CLEANING_TOOLS.broom.support, pos: [-0.2, -0.3, -0.6] },
    });
    assert.deepEqual(hands.root.getObjectByName('FirstPersonRightHand').position.toArray(), [0.2, -0.1, 0.5]);
    assert.deepEqual(hands.root.getObjectByName('FirstPersonLeftHand').position.toArray(), [-0.2, -0.3, -0.6]);
  } finally {
    hands.dispose();
  }
});
