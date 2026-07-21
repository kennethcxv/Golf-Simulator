import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CLEANING_TOOLS } from '../src/data/cleaningTools.js';
import { buildToolViewmodels } from '../src/render3d/toolViewmodel.js';
import { auditGlbFile } from '../tools/qa/glb-structure-audit.mjs';

const motionNames = (motion) => [
  motion?.equip,
  motion?.unequip,
  motion?.useStart,
  ...(motion?.useLoop || []),
  motion?.useStop,
].filter(Boolean);

test('every authored cleaning viewmodel maps its reusable motion states to real GLB clips', () => {
  for (const def of Object.values(CLEANING_TOOLS)) {
    if (!def.fp?.glb) continue;
    assert.ok(def.fp.motion, `${def.id} declares the shared equip/use/unequip motion contract`);
    assert.ok(def.fp.motion.equip, `${def.id} has an equip clip`);
    assert.ok(def.fp.motion.unequip, `${def.id} has an unequip clip`);
    assert.ok((def.fp.motion.useLoop || []).length > 0, `${def.id} has a looping use gesture`);
    const report = auditGlbFile({ root: process.cwd(), glbPath: def.fp.glb });
    const available = new Set(report.animationNames);
    for (const name of motionNames(def.fp.motion)) {
      assert.ok(available.has(name), `${def.id} runtime GLB contains configured clip ${name}`);
    }
  }
});

test('motion requests made before asynchronous GLB adoption are replayed when the asset arrives', async () => {
  const viewmodels = buildToolViewmodels();
  viewmodels.setEquipped('broom', true);
  viewmodels.setUsing('broom', true);

  const loader = {
    load(url, onLoad) {
      const def = Object.values(CLEANING_TOOLS).find((item) => item.fp?.glb === url);
      const scene = new THREE.Group();
      scene.name = `Fake_${def.id}`;
      for (const socketName of Object.values(def.fp.sockets || {})) {
        const socket = new THREE.Group();
        socket.name = socketName;
        scene.add(socket);
      }
      for (const socketName of Object.values(def.fp.grips || {}).filter(Boolean)) {
        if (scene.getObjectByName(socketName)) continue;
        const socket = new THREE.Group();
        socket.name = socketName;
        scene.add(socket);
      }
      onLoad({
        scene,
        animations: motionNames(def.fp.motion).map((name) => new THREE.AnimationClip(name, 0.1, [])),
      });
    },
  };

  const result = await viewmodels.adoptAuthored(loader);
  assert.equal(result.find((entry) => entry.id === 'broom').ok, true);
  const broom = viewmodels.motionDiagnostics().find((entry) => entry.id === 'broom');
  assert.equal(broom.equipped, true);
  assert.equal(broom.using, true);
  assert.equal(broom.activeClip, 'Broom_SweepLeft');

  viewmodels.update(0.12);
  assert.equal(
    viewmodels.motionDiagnostics().find((entry) => entry.id === 'broom').activeClip,
    'Broom_SweepRight',
    'multi-clip use loops alternate without per-tool animation code',
  );

  viewmodels.setUsing('broom', false);
  assert.equal(viewmodels.motionDiagnostics().find((entry) => entry.id === 'broom').using, false);
  viewmodels.setEquipped('broom', false);
  assert.equal(
    viewmodels.motionDiagnostics().find((entry) => entry.id === 'broom').activeClip,
    'Broom_Unequip',
  );
  viewmodels.dispose();
});

test('authored viewmodels load on first equip boundary and share one in-flight request', async () => {
  const viewmodels = buildToolViewmodels();
  const requested = [];
  let finishLoad;
  const loader = {
    load(url, onLoad) {
      requested.push(url);
      finishLoad = () => {
        const def = Object.values(CLEANING_TOOLS).find((item) => item.fp?.glb === url);
        const scene = new THREE.Group();
        for (const socketName of Object.values(def.fp.sockets || {})) {
          const socket = new THREE.Group();
          socket.name = socketName;
          scene.add(socket);
        }
        onLoad({
          scene,
          animations: motionNames(def.fp.motion).map((name) => new THREE.AnimationClip(name, 0.1, [])),
        });
      };
    },
  };

  assert.equal(viewmodels.authoredCount(), 0, 'building the shared framework does not load hidden tools');
  const first = viewmodels.ensureAuthored('mop', loader);
  const duplicate = viewmodels.ensureAuthored('mop', loader);
  assert.equal(requested.length, 1, 'rapid repeated equips reuse the same request');
  assert.equal(viewmodels.authoredCount(), 0, 'the fallback remains usable while the GLB is pending');
  finishLoad();
  const [a, b] = await Promise.all([first, duplicate]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(viewmodels.authoredCount(), 1);
  assert.match(requested[0], /asset_072_mop_fp\.glb$/);
  viewmodels.dispose();
});

test('unequip interrupts a looping use animation without leaking the using state', async () => {
  const viewmodels = buildToolViewmodels();
  const loader = {
    load(url, onLoad) {
      const def = Object.values(CLEANING_TOOLS).find((item) => item.fp?.glb === url);
      const scene = new THREE.Group();
      for (const socketName of Object.values(def.fp.sockets || {})) {
        const socket = new THREE.Group();
        socket.name = socketName;
        scene.add(socket);
      }
      onLoad({
        scene,
        animations: motionNames(def.fp.motion).map((name) => new THREE.AnimationClip(name, 0.1, [])),
      });
    },
  };
  await viewmodels.ensureAuthored('vacuum', loader);
  viewmodels.setEquipped('vacuum', true);
  viewmodels.setUsing('vacuum', true);
  assert.equal(viewmodels.motionDiagnostics()[0].using, true);
  viewmodels.setEquipped('vacuum', false);
  const interrupted = viewmodels.motionDiagnostics()[0];
  assert.equal(interrupted.using, false);
  assert.equal(interrupted.equipped, false);
  assert.equal(interrupted.activeClip, 'Vacuum_Unequip');
  viewmodels.dispose();
});

test('cached hidden viewmodels do not advance animation mixers', async () => {
  const viewmodels = buildToolViewmodels();
  const loader = {
    load(url, onLoad) {
      const def = Object.values(CLEANING_TOOLS).find((item) => item.fp?.glb === url);
      onLoad({
        scene: new THREE.Group(),
        animations: motionNames(def.fp.motion).map((name) => new THREE.AnimationClip(name, 1, [])),
      });
    },
  };
  await viewmodels.ensureAuthored('mop', loader);
  viewmodels.setEquipped('mop', true);
  viewmodels.update(0.25);
  const activeTime = viewmodels.motionDiagnostics()[0].mixerTime;
  assert.ok(activeTime >= 0.25, 'the equipped tool advances');

  viewmodels.setEquipped('mop', false);
  const hiddenTime = viewmodels.motionDiagnostics()[0].mixerTime;
  viewmodels.update(0.5);
  assert.equal(
    viewmodels.motionDiagnostics()[0].mixerTime,
    hiddenTime,
    'the cached mixer stays frozen after the tool is hidden',
  );
  viewmodels.dispose();
});
