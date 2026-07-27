import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Box3,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';

import { FRONT_DESK_ASSETS } from '../src/data/shopLayout.js';
import { ASSET_061, ASSET_062 } from '../src/render3d/assets51to100/sheet07Manifest.js';
import { PINE_HILLS_INTERIOR_ASSETS } from '../src/render3d/clubhouse/pineHillsInterior.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_MAGIC = 0x46546c67;
const EPSILON = 1e-6;

function parseGlbJson(repoPath) {
  const bytes = readFileSync(join(REPO_ROOT, repoPath));
  assert.equal(bytes.readUInt32LE(0), GLB_MAGIC, `${repoPath} GLB magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${repoPath} GLB version`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${repoPath} declared GLB length`);

  let json = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLength;
    assert.ok(end <= bytes.length, `${repoPath} contains an out-of-bounds GLB chunk`);
    if (chunkType === GLB_JSON_CHUNK) {
      json = JSON.parse(bytes.subarray(start, end).toString('utf8').replace(/\0+$/u, '').trim());
    }
    offset = end + ((4 - (end % 4)) % 4);
  }

  assert.ok(json, `${repoPath} must contain a JSON chunk`);
  return json;
}

function localMatrix(node = {}) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return new Matrix4().fromArray(node.matrix);
  }
  return new Matrix4().compose(
    new Vector3().fromArray(node.translation || [0, 0, 0]),
    new Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
    new Vector3().fromArray(node.scale || [1, 1, 1]),
  );
}

function nodeWorldMatrices(json) {
  const nodes = json.nodes || [];
  const parents = new Array(nodes.length).fill(-1);
  nodes.forEach((node, parentIndex) => {
    for (const childIndex of node.children || []) {
      assert.equal(parents[childIndex], -1, `GLB node ${childIndex} cannot have two parents`);
      parents[childIndex] = parentIndex;
    }
  });

  const matrices = new Map();
  const visiting = new Set();
  function visit(index) {
    if (matrices.has(index)) return matrices.get(index);
    assert.ok(!visiting.has(index), `GLB node hierarchy contains a cycle at ${index}`);
    visiting.add(index);
    const matrix = localMatrix(nodes[index]);
    if (parents[index] >= 0) matrix.premultiply(visit(parents[index]));
    visiting.delete(index);
    matrices.set(index, matrix);
    return matrix;
  }
  nodes.forEach((_, index) => visit(index));
  return matrices;
}

function uniqueNodeIndex(json, name) {
  const matches = (json.nodes || [])
    .map((node, index) => [node.name, index])
    .filter(([nodeName]) => nodeName === name);
  assert.equal(matches.length, 1, `expected exactly one GLB node named ${name}`);
  return matches[0][1];
}

function rootPoseMatrix(pose, scale, position = new Vector3(pose.x, 0, pose.z)) {
  return new Matrix4().compose(
    position,
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), pose.ry || 0),
    new Vector3(scale, scale, scale),
  );
}

function socketAlignedRootMatrix(json, matrices, pose, scale) {
  const target = new Vector3(pose.x, 0, pose.z);
  const orientation = rootPoseMatrix(pose, scale, new Vector3());
  const placement = new Vector3().setFromMatrixPosition(
    matrices.get(uniqueNodeIndex(json, 'SOCKET_PLACEMENT')),
  ).applyMatrix4(orientation);
  return rootPoseMatrix(pose, scale, target.sub(placement));
}

function visibleWorldBounds(json, matrices, runtimeRoot) {
  const bounds = new Box3().makeEmpty();
  let primitiveCount = 0;

  (json.nodes || []).forEach((node, nodeIndex) => {
    if (!node.name?.startsWith('MESH_') || !Number.isInteger(node.mesh)) return;
    const world = runtimeRoot.clone().multiply(matrices.get(nodeIndex));
    for (const primitive of json.meshes?.[node.mesh]?.primitives || []) {
      const accessor = json.accessors?.[primitive.attributes?.POSITION];
      assert.ok(Array.isArray(accessor?.min) && Array.isArray(accessor?.max),
        `${node.name} POSITION accessor must publish bounds`);
      primitiveCount += 1;
      for (const x of [accessor.min[0], accessor.max[0]]) {
        for (const y of [accessor.min[1], accessor.max[1]]) {
          for (const z of [accessor.min[2], accessor.max[2]]) {
            bounds.expandByPoint(new Vector3(x, y, z).applyMatrix4(world));
          }
        }
      }
    }
  });

  assert.ok(primitiveCount > 0 && !bounds.isEmpty(), 'Asset 61 must expose measurable visible geometry');
  return bounds;
}

function namedNodeBounds(json, matrices, name) {
  const nodeIndex = uniqueNodeIndex(json, name);
  const node = json.nodes[nodeIndex];
  assert.ok(Number.isInteger(node.mesh), `${name} must own a mesh`);
  const bounds = new Box3().makeEmpty();
  for (const primitive of json.meshes?.[node.mesh]?.primitives || []) {
    const accessor = json.accessors?.[primitive.attributes?.POSITION];
    assert.ok(Array.isArray(accessor?.min) && Array.isArray(accessor?.max),
      `${name} POSITION accessor must publish bounds`);
    for (const x of [accessor.min[0], accessor.max[0]]) {
      for (const y of [accessor.min[1], accessor.max[1]]) {
        for (const z of [accessor.min[2], accessor.max[2]]) {
          bounds.expandByPoint(new Vector3(x, y, z).applyMatrix4(matrices.get(nodeIndex)));
        }
      }
    }
  }
  assert.equal(bounds.isEmpty(), false, `${name} must expose measurable geometry`);
  return bounds;
}

function assertNear(actual, expected, label) {
  const delta = Math.abs(actual - expected);
  assert.ok(delta <= EPSILON,
    `${label} differs by ${delta}; expected ${expected}, received ${actual}`);
}

test('the shipped front-desk return join socket lands on Asset 61 world-east seam', () => {
  const asset61Json = parseGlbJson(ASSET_061.paths.runtimeGlb);
  const returnJson = parseGlbJson(PINE_HILLS_INTERIOR_ASSETS.frontDeskReturn);
  const asset61Matrices = nodeWorldMatrices(asset61Json);
  const returnMatrices = nodeWorldMatrices(returnJson);

  // Asset 61 is socket-aligned by its runtime adapter. The return module is
  // mounted by its root pose in fixtures.js, so reproduce both live transforms.
  const asset61Runtime = socketAlignedRootMatrix(
    asset61Json,
    asset61Matrices,
    FRONT_DESK_ASSETS.asset61,
    FRONT_DESK_ASSETS.scale,
  );
  const returnRuntime = rootPoseMatrix(
    FRONT_DESK_ASSETS.returnModule,
    FRONT_DESK_ASSETS.scale,
  );

  const asset61Bounds = visibleWorldBounds(asset61Json, asset61Matrices, asset61Runtime);
  const canonicalEastSeam = new Vector3(
    asset61Bounds.max.x,
    asset61Bounds.min.y,
    (asset61Bounds.min.z + asset61Bounds.max.z) / 2,
  );
  const returnJoin = new Vector3().setFromMatrixPosition(
    returnRuntime.clone().multiply(
      returnMatrices.get(uniqueNodeIndex(returnJson, 'SOCKET_JoinAsset61_Right')),
    ),
  );

  assertNear(returnJoin.x, canonicalEastSeam.x, 'join socket world-east coordinate');
  assertNear(returnJoin.y, canonicalEastSeam.y, 'join socket floor coordinate');
  assertNear(returnJoin.z, canonicalEastSeam.z, 'join socket seam-centre coordinate');
  assert.ok(returnJoin.distanceTo(canonicalEastSeam) <= EPSILON,
    `join socket ${returnJoin.toArray()} must land on Asset 61 seam ${canonicalEastSeam.toArray()}`);
});

test('the shipped oak return inlays sit above their walnut tops without coplanar faces', () => {
  const json = parseGlbJson(PINE_HILLS_INTERIOR_ASSETS.frontDeskReturn);
  const matrices = nodeWorldMatrices(json);
  for (const [topName, inlayName] of [
    ['MESH_ReturnFrontTop', 'MESH_ReturnFrontTopInlay'],
    ['MESH_ReturnLegTop', 'MESH_ReturnLegTopInlay'],
  ]) {
    const top = namedNodeBounds(json, matrices, topName);
    const inlay = namedNodeBounds(json, matrices, inlayName);
    const relief = inlay.max.y - top.max.y;
    assert.ok(relief >= 0.007 && relief <= 0.012,
      `${inlayName} needs 7-12 mm of clean relief; received ${relief.toFixed(6)} m`);
    assert.ok(inlay.min.y < top.max.y,
      `${inlayName} must remain seated in the top instead of floating`);
  }
});

test('Asset 61 checkout inlay has a clean two-millimetre relief above its walnut top', () => {
  const json = parseGlbJson(ASSET_061.paths.runtimeGlb);
  const matrices = nodeWorldMatrices(json);
  const top = namedNodeBounds(json, matrices, 'MESH_CounterTop');
  const inlay = namedNodeBounds(json, matrices, 'MESH_CounterTopInlay');
  const relief = inlay.max.y - top.max.y;
  assert.ok(relief >= 0.0015 && relief <= 0.0025,
    `MESH_CounterTopInlay needs 2 mm of clean relief; received ${relief.toFixed(6)} m`);
  assert.ok(inlay.min.y < top.max.y,
    'MESH_CounterTopInlay must remain seated in the top instead of floating');
});

test('Asset 62 leaves the Pine Hills board bay open while retaining cabinet animation', () => {
  const json = parseGlbJson(ASSET_062.paths.runtimeGlb);
  const nodeNames = new Set((json.nodes || []).map((node) => node.name));
  for (const name of [
    'MESH_OpenHutchUprightSet',
    'MESH_AnimatedBaseCabinetDoor',
    'MESH_AnimatedBaseDrawer',
    'PIVOT_CabinetDoor',
    'PIVOT_CabinetDrawer',
  ]) assert.ok(nodeNames.has(name), `${name} must ship in the open-hutch GLB`);
  assert.equal(nodeNames.has('MESH_WallCabinetCarcass'), false,
    'an opaque upper carcass must not mask the tee sheet and club mark');
  assert.equal(nodeNames.has('MESH_AnimatedWallCabinetDoor'), false,
    'the animated door belongs in the usable base cabinet');
  assert.deepEqual(
    (json.animations || []).map((clip) => clip.name).sort(),
    ['CabinetDoor_Close', 'CabinetDoor_Open', 'CabinetDrawer_Close', 'CabinetDrawer_Open'],
  );
});
