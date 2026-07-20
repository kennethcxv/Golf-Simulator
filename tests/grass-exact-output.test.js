import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { CELL_YD, ZONE } from '../src/sim/constants.js';
import {
  GRASS_ZONE_SPECS,
  buildGrassStructureBounds,
  configureGrassInstanceBuffers,
  grassSpecForZone,
  markGrassInstanceBuffersUpdated,
  pointInsideGrassStructureBounds,
} from '../src/render3d/courseScene.js';
import { pointInsideClubhouseInterior } from '../src/render3d/clubhouse.js';

const courseSceneSource = fs.readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);
const clubhouseSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
);

const EXPECTED_GRASS_SPECS = new Map([
  [ZONE.OUT, { h: 0.25, r: 0.34, g: 0.43, b: 0.17 }],
  [ZONE.ROUGH, { h: 0.14, r: 0.29, g: 0.50, b: 0.17 }],
  [ZONE.FAIRWAY, { h: 0.035, r: 0.32, g: 0.57, b: 0.19 }],
  [ZONE.TEE, { h: 0.025, r: 0.31, g: 0.55, b: 0.19 }],
  [ZONE.FRINGE, { h: 0.03, r: 0.30, g: 0.53, b: 0.18 }],
  [ZONE.HEAVY, { h: 0.32, r: 0.36, g: 0.45, b: 0.17 }],
  [ZONE.BED, { h: 0.12, r: 0.25, g: 0.37, b: 0.14 }],
  [ZONE.SEMI, { h: 0.065, r: 0.29, g: 0.51, b: 0.17 }],
]);

function legacyInsideStructure(structures, worldXAt, worldZAt, wx, wz) {
  for (const structure of structures || []) {
    const x0 = worldXAt(structure.x) - CELL_YD * 0.5 - 1.5;
    const x1 = worldXAt(structure.x + structure.w - 1) + CELL_YD * 0.5 + 1.5;
    const z0 = worldZAt(structure.y) - CELL_YD * 0.5 - 1.5;
    const z1 = worldZAt(structure.y + structure.h - 1) + CELL_YD * 0.5 + 1.5;
    if (wx >= x0 && wx <= x1 && wz >= z0 && wz <= z1) return true;
  }
  return false;
}

function legacyFiveProbeInside(
  wx,
  wz,
  centerX,
  centerZ,
  halfWidth,
  halfDepth,
  margin,
) {
  const legacyInside = (x, z) => {
    const local = { x: x - centerX, z: z - centerZ };
    return Math.abs(local.x) < halfWidth && Math.abs(local.z) < halfDepth;
  };
  return legacyInside(wx, wz)
    || legacyInside(wx + margin, wz)
    || legacyInside(wx - margin, wz)
    || legacyInside(wx, wz + margin)
    || legacyInside(wx, wz - margin);
}

test('grass zone specs are cached immutable scalars with the authored production values', () => {
  assert.equal(Object.isFrozen(GRASS_ZONE_SPECS), true);
  for (const [zone, expected] of EXPECTED_GRASS_SPECS) {
    const first = grassSpecForZone(zone);
    assert.strictEqual(first, grassSpecForZone(zone), `zone ${zone} reuses its record`);
    assert.strictEqual(first, GRASS_ZONE_SPECS[zone]);
    assert.equal(Object.isFrozen(first), true);
    assert.deepEqual(first, expected);
    assert.equal('c' in first, false, 'the tint is scalar, not a per-call array');
  }

  for (const zone of [ZONE.GREEN, ZONE.BUNKER, ZONE.WATER, ZONE.PATH, ZONE.DIRT, 99, null]) {
    assert.equal(grassSpecForZone(zone), null, `zone ${zone} remains blade-free`);
  }
  assert.equal(grassSpecForZone(String(ZONE.OUT)), null, 'strict switch lookup is preserved');
});

test('cached grass structure bounds match the legacy calculation, including inclusive edges', () => {
  const structures = [
    { x: 3, y: 4, w: 5, h: 2 },
    { x: 18, y: 11, w: 2, h: 6 },
  ];
  const worldXAt = (cell) => cell * CELL_YD - 63.25;
  const worldZAt = (cell) => cell * CELL_YD - 41.75;
  const bounds = buildGrassStructureBounds(structures, worldXAt, worldZAt);

  assert.equal(bounds instanceof Float64Array, true);
  assert.deepEqual([...bounds], [
    worldXAt(3) - 5.5,
    worldXAt(7) + 5.5,
    worldZAt(4) - 5.5,
    worldZAt(5) + 5.5,
    worldXAt(18) - 5.5,
    worldXAt(19) + 5.5,
    worldZAt(11) - 5.5,
    worldZAt(16) + 5.5,
  ]);

  for (let x = -50; x <= 120; x += 0.5) {
    for (let z = -20; z <= 120; z += 0.5) {
      assert.equal(
        pointInsideGrassStructureBounds(bounds, x, z),
        legacyInsideStructure(structures, worldXAt, worldZAt, x, z),
        `structure membership at ${x}, ${z}`,
      );
    }
  }

  for (let offset = 0; offset < bounds.length; offset += 4) {
    const [x0, x1, z0, z1] = bounds.slice(offset, offset + 4);
    const centerX = (x0 + x1) / 2;
    const centerZ = (z0 + z1) / 2;
    assert.equal(pointInsideGrassStructureBounds(bounds, x0, centerZ), true);
    assert.equal(pointInsideGrassStructureBounds(bounds, x1, centerZ), true);
    assert.equal(pointInsideGrassStructureBounds(bounds, centerX, z0), true);
    assert.equal(pointInsideGrassStructureBounds(bounds, centerX, z1), true);
    assert.equal(pointInsideGrassStructureBounds(bounds, x0 - 1e-9, centerZ), false);
    assert.equal(pointInsideGrassStructureBounds(bounds, centerX, z0 - 1e-9), false);
  }
});

test('structure-bound snapshots change only when rebuilt and rebuildStructures refreshes them', () => {
  const structures = [{ x: 2, y: 2, w: 2, h: 2 }];
  const worldXAt = (cell) => cell * CELL_YD;
  const worldZAt = (cell) => cell * CELL_YD;
  const before = buildGrassStructureBounds(structures, worldXAt, worldZAt);
  const oldCenter = { x: worldXAt(2.5), z: worldZAt(2.5) };

  structures[0].x = 20;
  assert.equal(pointInsideGrassStructureBounds(before, oldCenter.x, oldCenter.z), true);
  const after = buildGrassStructureBounds(structures, worldXAt, worldZAt);
  assert.equal(pointInsideGrassStructureBounds(after, oldCenter.x, oldCenter.z), false);
  assert.equal(pointInsideGrassStructureBounds(after, worldXAt(20.5), oldCenter.z), true);

  const rebuildStart = courseSceneSource.indexOf('function rebuildStructures()');
  const rebuildEnd = courseSceneSource.indexOf('// --- hole furniture', rebuildStart);
  const rebuildSource = courseSceneSource.slice(rebuildStart, rebuildEnd);
  assert.match(
    rebuildSource,
    /function rebuildStructures\(\) \{\s*grassStructureBounds = buildGrassStructureBounds\(course\.structures, worldX, worldZ\);/,
  );
});

test('clubhouse axial margin is exactly equivalent to the legacy five-probe union', () => {
  const centerX = 17.375;
  const centerZ = -31.625;
  const halfWidth = 10.25;
  const halfDepth = 6.5;
  for (const margin of [0, 0.25, 1, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    for (let ix = -52; ix <= 52; ix += 1) {
      for (let iz = -38; iz <= 38; iz += 1) {
        const wx = centerX + ix * 0.25;
        const wz = centerZ + iz * 0.25;
        assert.equal(
          pointInsideClubhouseInterior(
            wx, wz, centerX, centerZ, halfWidth, halfDepth, margin,
          ),
          legacyFiveProbeInside(
            wx, wz, centerX, centerZ, halfWidth, halfDepth, margin,
          ),
          `five-probe equivalence at ${wx}, ${wz} with margin ${margin}`,
        );
      }
    }
  }
});

test('clubhouse axial margin keeps strict wall edges and cross-shaped corners', () => {
  const centerX = 3;
  const centerZ = -5;
  const halfWidth = 10;
  const halfDepth = 6;
  const margin = 1;
  const inside = (x, z, m = margin) => pointInsideClubhouseInterior(
    x, z, centerX, centerZ, halfWidth, halfDepth, m,
  );

  assert.equal(inside(centerX + halfWidth, centerZ, 0), false, 'wall boundary stays strict');
  assert.equal(inside(centerX + halfWidth + margin, centerZ), false, 'outer margin edge stays strict');
  assert.equal(inside(centerX + halfWidth + margin - 1e-9, centerZ), true);
  assert.equal(inside(centerX, centerZ + halfDepth + margin - 1e-9), true);
  assert.equal(
    inside(centerX + halfWidth + 0.5, centerZ + halfDepth + 0.5),
    false,
    'the axial union does not fill diagonal corners',
  );

  const predicateStart = clubhouseSource.indexOf('const isInside = (wx, wz, axialMargin = 0)');
  const predicateEnd = clubhouseSource.indexOf('const onPorch', predicateStart);
  const predicateSource = clubhouseSource.slice(predicateStart, predicateEnd);
  assert.match(predicateSource, /pointInsideClubhouseInterior\(/);
  assert.doesNotMatch(predicateSource, /W2L\(/, 'the runtime predicate does not allocate local points');
});

test('grass instance buffers use dynamic draw and component-count update ranges', () => {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, 12);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(12 * 3), 3);

  try {
    configureGrassInstanceBuffers(mesh);
    assert.equal(mesh.instanceMatrix.usage, THREE.DynamicDrawUsage);
    assert.equal(mesh.instanceColor.usage, THREE.DynamicDrawUsage);

    const matrixVersion = mesh.instanceMatrix.version;
    const colorVersion = mesh.instanceColor.version;
    markGrassInstanceBuffersUpdated(mesh, 5);
    assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 0, count: 5 * 16 }]);
    assert.deepEqual(mesh.instanceColor.updateRanges, [{ start: 0, count: 5 * 3 }]);
    assert.equal(mesh.instanceMatrix.version, matrixVersion + 1);
    assert.equal(mesh.instanceColor.version, colorVersion + 1);

    mesh.instanceMatrix.addUpdateRange(190, 1);
    mesh.instanceColor.addUpdateRange(34, 1);
    markGrassInstanceBuffersUpdated(mesh, 2);
    assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 0, count: 2 * 16 }]);
    assert.deepEqual(mesh.instanceColor.updateRanges, [{ start: 0, count: 2 * 3 }]);
  } finally {
    geometry.dispose();
    material.dispose();
    mesh.dispose();
  }
});

test('late grass hashes retain their exact formulas and output staging', () => {
  const updateStart = courseSceneSource.indexOf('function updateGrass(camX, camZ, force)');
  const updateEnd = courseSceneSource.indexOf('function setGrassActive(on)', updateStart);
  const updateSource = courseSceneSource.slice(updateStart, updateEnd);
  const structureGate = updateSource.indexOf('if (insideStructure(wx, wz)) continue;');
  const clubhouseGate = updateSource.indexOf('if (clubhouseApi.isInside(wx, wz, M)) continue;');
  const s3 = updateSource.indexOf(
    'const s3 = (((hk * 2246822519) ^ (hk >>> 11)) >>> 0) / 4294967296;',
  );
  const densityGate = updateSource.indexOf(
    'if (distN > 0.52 && s3 < (distN - 0.52) / 0.68) continue;',
  );
  const heightGate = updateSource.indexOf("if (hh < 0.018) continue;");
  const s4 = updateSource.indexOf(
    'const s4 = (((hk * 3266489917) ^ (hk >>> 15)) >>> 0) / 4294967296;',
  );
  const compose = updateSource.indexOf('grassMesh.setMatrixAt(n, _gm);');

  for (const [name, index] of Object.entries({
    structureGate, clubhouseGate, s3, densityGate, heightGate, s4, compose,
  })) assert.notEqual(index, -1, `${name} remains present`);
  assert.ok(s3 > structureGate && s3 > clubhouseGate && s3 < densityGate);
  assert.ok(s4 > heightGate && s4 < compose);
  assert.match(updateSource, /grassMesh\.setMatrixAt\(n, _gm\);/);
  assert.match(updateSource, /grassMesh\.setColorAt\(n, _gc\);/);
  assert.doesNotMatch(updateSource, /instance(?:Matrix|Color)\.array\s*\[/);
});
