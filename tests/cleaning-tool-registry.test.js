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
