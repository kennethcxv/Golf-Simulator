import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { SHED_ROOM, DOOR, WINDOWS } from '../src/data/shedLayout.js';
import { buildShedShell } from '../src/render3d/clubhouse/shedShell.js';

const FLOOR_TOP = 0.3;

// buildShedShell borrows makeSidingTexture (clubhouse/materials.js), which draws
// on a 2D canvas. Stub the DOM canvas so the contract can be exercised in pure
// node with no WebGL — this is geometry/collider math only.
function fakeCanvas() {
  const canvas = { width: 1, height: 1, style: {} };
  const gradient = { addColorStop() {} };
  const known = {
    canvas,
    measureText: (value) => ({ width: String(value ?? '').length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    getImageData: (_x, _y, width = canvas.width, height = canvas.height) => ({
      data: new Uint8ClampedArray(Math.max(0, width * height * 4)), width, height,
    }),
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(Math.max(0, width * height * 4)), width, height,
    }),
  };
  const context = new Proxy(known, {
    get(target, property) { return property in target ? target[property] : () => {}; },
    set(target, property, value) { target[property] = value; return true; },
  });
  canvas.getContext = () => context;
  return canvas;
}

function fakeDocument() {
  return { createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : { style: {} }) };
}

function materials() {
  const material = () => new THREE.MeshStandardMaterial();
  return { concrete: material(), charcoal: material(), rawWood: material(), glass: material() };
}

function buildFixture() {
  const group = new THREE.Group();
  const interior = new THREE.Group();
  const colliders = [];
  const shell = buildShedShell({
    group,
    interior,
    mats: materials(),
    // the mock colBoxAt keeps colliders in local coords (no world offset), so the
    // door interval can be checked against the authored layout directly
    addCol(collider) { colliders.push(collider); return collider; },
    colBoxAt(x, z, w, d) { return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 }; },
    FLOOR_TOP,
  });
  return { group, interior, colliders, shell };
}

const LIGHTING_METHODS = Object.freeze([
  'setShopTier', 'setTimeMood', 'refreshCondition', 'setWindowDirt',
  'setCeilingCircuitPowered', 'isCeilingCircuitPowered', 'refreshRestoration',
  'setCameraLocalPosition', 'panelRenderBudget', 'updateFlicker',
]);

const FALLBACK_KEYS = Object.freeze([
  'exteriorShellStructure', 'apertureTrim', 'porchVisuals', 'windowVisuals',
  'renovatedFloor', 'ceilingVisuals', 'wainscotPanels', 'interiorTrim', 'servicePartitions',
]);

test('buildShedShell wall colliders leave the south doorway open', () => {
  const prev = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const { colliders } = buildFixture();

    // 5 wall spans: south split by the door (2) + north + west + east
    assert.equal(colliders.length, 5, 'expected exactly five shed wall colliders');

    const wallMidZ = SHED_ROOM.d / 2 + 0.11; // room half + wallT/2
    const doorL = DOOR.x - DOOR.w / 2;
    const doorR = DOOR.x + DOOR.w / 2;
    const inside = (c, x, z) => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ;

    // the door centre on the south wall line is NOT inside any collider
    assert.ok(!colliders.some((c) => inside(c, DOOR.x, wallMidZ)), 'the doorway is blocked by a collider');

    // no south-wall collider's x-span overlaps the door interval
    const southCols = colliders.filter((c) => c.minZ < wallMidZ && c.maxZ > wallMidZ);
    assert.ok(southCols.length >= 2, 'south wall should be split into at least two spans');
    // EPS tolerates a collider ending exactly at the door edge (center±half-width
    // rounding) — a sub-ULP touch is not a real overlap of the passable gap.
    const EPS = 1e-6;
    for (const c of southCols) {
      const overlaps = c.maxX > doorL + EPS && c.minX < doorR - EPS;
      assert.ok(!overlaps, `a south-wall collider spans the doorway [${doorL}, ${doorR}] (collider [${c.minX}, ${c.maxX}])`);
    }

    // the solid walls DO block: a point mid-wall on each solid face is inside a collider
    assert.ok(colliders.some((c) => inside(c, 3.0, wallMidZ)), 'south wall (east of door) is not solid');
    assert.ok(colliders.some((c) => inside(c, 0, -wallMidZ)), 'north wall is not solid');
    assert.ok(colliders.some((c) => inside(c, -(SHED_ROOM.w / 2 + 0.11), 0)), 'west wall is not solid');
    assert.ok(colliders.some((c) => inside(c, (SHED_ROOM.w / 2 + 0.11), 1.5)), 'east wall is not solid');
  } finally {
    globalThis.document = prev;
  }
});

test('buildShedShell windowDefs match the layout in order and shape', () => {
  const prev = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const { shell } = buildFixture();
    assert.equal(shell.windowDefs.length, 2, 'two window openings');
    // order = index into reno.windows: 0 = south, 1 = east
    assert.equal(shell.windowDefs[0].wall, 'S');
    assert.equal(shell.windowDefs[1].wall, 'E');
    shell.windowDefs.forEach((wd, i) => {
      assert.ok(wd.holder && wd.holder.isObject3D, `windowDef ${i} holder is an Object3D`);
      assert.equal(wd.w, WINDOWS[i].w, `windowDef ${i} width`);
      assert.equal(wd.h, WINDOWS[i].h, `windowDef ${i} height`);
      assert.equal(wd.insideSign, -1, `windowDef ${i} insideSign faces the interior`);
      assert.ok(Number.isFinite(wd.y), `windowDef ${i} y is finite`);
    });
  } finally {
    globalThis.document = prev;
  }
});

test('buildShedShell lighting facade exposes every method makeClubhouse consumes', () => {
  const prev = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const { shell } = buildFixture();
    for (const method of LIGHTING_METHODS) {
      assert.equal(typeof shell.lighting[method], 'function', `lighting.${method} missing`);
    }
    // the two flag methods behave: powered on by default, toggles cleanly
    assert.equal(shell.lighting.isCeilingCircuitPowered(), true);
    assert.equal(shell.lighting.setCeilingCircuitPowered(false), true); // changed
    assert.equal(shell.lighting.isCeilingCircuitPowered(), false);
    assert.equal(shell.lighting.setCeilingCircuitPowered(false), false); // no change
    // the mood + tier methods do not throw across a day
    shell.lighting.setTimeMood(600);
    shell.lighting.setTimeMood(60);
    shell.lighting.setShopTier();
    shell.lighting.updateFlicker(0.016);
  } finally {
    globalThis.document = prev;
  }
});

test('buildShedShell returns the full consumed shell contract', () => {
  const prev = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const { group, interior, shell } = buildFixture();

    // empty fallback handles with the legacy keys (sheet06 requires getVisible/setVisible/visible)
    assert.deepEqual(Object.keys(shell.productionVisualFallbacks), FALLBACK_KEYS);
    for (const key of FALLBACK_KEYS) {
      const handle = shell.productionVisualFallbacks[key];
      assert.equal(handle.nodeCount, 0, `${key} fallback owns no shed shell nodes`);
      assert.equal(typeof handle.getVisible, 'function');
      assert.equal(typeof handle.setVisible, 'function');
      assert.equal(handle.visible, true);
      assert.doesNotThrow(() => handle.setVisible(false)); // hides nothing — shed shell stays visible
    }

    assert.deepEqual(shell.styleSurfaces, {});
    assert.deepEqual(shell.partitionColliders, []);
    assert.equal(typeof shell.setBusinessOpen, 'function');
    assert.doesNotThrow(() => shell.setBusinessOpen(true));

    // floor + roof meshes exist on the shell root
    const named = (root, name) => { let hit = null; root.traverse((o) => { if (o.name === name) hit = o; }); return hit; };
    assert.ok(named(group, 'ShedFloor')?.isMesh, 'floor slab mesh exists');
    assert.ok(named(group, 'ShedRoof')?.isMesh, 'roof slab mesh exists');
    // ceiling deck sits on the interior root (distance-gated, sun-shadow suppressed)
    assert.ok(named(interior, 'ShedCeiling')?.isMesh, 'ceiling deck mesh exists on interior');
    // one warm bulb + a point light
    let pointLights = 0;
    interior.traverse((o) => { if (o.isPointLight) pointLights++; });
    assert.ok(pointLights >= 1, 'shed has at least one point light (the bulb)');
  } finally {
    globalThis.document = prev;
  }
});
