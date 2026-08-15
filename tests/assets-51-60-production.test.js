import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Box3,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';

import {
  ASSETS,
  CATEGORY_BUDGETS,
} from '../tools/qa/assets-51-100-spec.mjs';
import { auditGlbFile } from '../tools/qa/glb-structure-audit.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEET06 = ASSETS.filter(({ assetNumber }) => assetNumber >= 51 && assetNumber <= 60);
const REGISTRATION_ID = 'PINEHOLLOW_CLUBHOUSE_S06_V1';
const MATRIX_EPSILON = 1e-6;
const APPROVED_NODE_PREFIX = /^(?:A_|MESH_|COL_|SOCKET_|PIVOT_|LOD[012]_)/u;

const TARGET_DIMENSIONS_XYZ = Object.freeze({
  51: Object.freeze([16.80, 10.50, 7.13]),
  52: Object.freeze([16.80, 10.50, 7.13]),
  53: Object.freeze([1.80, 0.24, 2.45]),
  54: Object.freeze([11.52, 3.29, 4.02]),
  55: Object.freeze([2.19, 0.23, 1.74]),
  56: Object.freeze([1.20, 0.075, 1.15]),
  57: Object.freeze([2.40, 0.025, 0.14]),
  58: Object.freeze([3.60, 0.20, 0.24]),
  59: Object.freeze([1.00, 1.00, 0.018]),
  60: Object.freeze([1.00, 1.00, 0.035]),
});

const COLLISION_PURPOSES = Object.freeze({
  51: Object.freeze(['blocking', 'walkable']),
  52: Object.freeze(['raycast-only']),
  53: Object.freeze(['animated-blocking', 'blocking']),
  54: Object.freeze(['blocking', 'walkable']),
  55: Object.freeze(['blocking', 'raycast-only']),
  56: Object.freeze(['selection-blocking']),
  57: Object.freeze(['raycast-only']),
  58: Object.freeze(['overhead-blocking']),
  59: Object.freeze(['walkable']),
  60: Object.freeze(['raycast-only']),
});

const TOP_LEVEL_VARIANTS = Object.freeze({
  55: Object.freeze(['arched', 'narrow', 'standard', 'wide']),
  56: Object.freeze(['door_connector', 'inside_corner', 'outside_corner', 'straight', 'window_connector']),
  57: Object.freeze(['baseboard', 'chair_rail', 'crown', 'door_casing', 'end_cap', 'inside_corner', 'junction', 'outside_corner']),
  58: Object.freeze(['ceiling_panel', 'cross_connector', 'end_cap', 'half', 'light_mount', 'straight']),
  59: Object.freeze(['cream_tile', 'dark_wood', 'gray_carpet', 'oak', 'sage_carpet', 'stone_tile', 'walnut']),
  60: Object.freeze(['damaged_carpet', 'damaged_tile', 'damaged_wood']),
});

const parsedCache = new Map();
const auditCache = new Map();

function expectedRootName(asset) {
  return `A_${String(asset.assetNumber).padStart(3, '0')}_${asset.stem.toUpperCase()}_ROOT`;
}

function exactProductionPaths(asset) {
  const id = String(asset.assetNumber).padStart(3, '0');
  const stem = `asset_${id}_${asset.stem}`;
  const expected = {
    source: `asset_sources/blender/assets_51_100/sheet_06/${stem}.blend`,
    canonicalGlb: `Assets/assets_51_100/glb/sheet_06/${stem}.glb`,
    runtimeGlb: `vendor/models/assets_51_100/sheet_06/${stem}.glb`,
  };
  assert.equal(asset.plannedPaths.source, expected.source, `Asset ${id} source path contract`);
  assert.equal(asset.plannedPaths.canonicalGlb, expected.canonicalGlb, `Asset ${id} canonical path contract`);
  assert.equal(asset.plannedPaths.runtimeGlb, expected.runtimeGlb, `Asset ${id} runtime path contract`);
  return expected;
}

function absolute(repoPath) {
  return path.resolve(REPO_ROOT, repoPath);
}

function requireProductionFile(repoPath, label) {
  const filename = absolute(repoPath);
  assert.ok(existsSync(filename), `${label} is not published at exact path ${repoPath}`);
  assert.ok(statSync(filename).isFile(), `${label} must be a regular file: ${repoPath}`);
  assert.ok(statSync(filename).size > 20, `${label} is empty or truncated: ${repoPath}`);
  return filename;
}

function parseGlb(repoPath) {
  if (parsedCache.has(repoPath)) return parsedCache.get(repoPath);
  const bytes = readFileSync(requireProductionFile(repoPath, 'GLB'));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${repoPath} GLB magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${repoPath} GLB version`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${repoPath} declared GLB length`);

  let json = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLength;
    assert.ok(end <= bytes.length, `${repoPath} contains an out-of-bounds GLB chunk`);
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(bytes.subarray(start, end).toString('utf8').replace(/\0+$/u, '').trim());
    }
    offset = end + ((4 - (end % 4)) % 4);
  }
  assert.ok(json, `${repoPath} must contain one JSON chunk`);
  const parsed = { bytes, json };
  parsedCache.set(repoPath, parsed);
  return parsed;
}

function audit(asset, glbPath) {
  const cacheKey = `${asset.assetNumber}:${glbPath}`;
  if (auditCache.has(cacheKey)) return auditCache.get(cacheKey);
  const budget = CATEGORY_BUDGETS[asset.category];
  const result = auditGlbFile({
    root: REPO_ROOT,
    glbPath,
    sourcePath: asset.plannedPaths.source,
    intendedDimensions: asset.intendedDimensions,
    collisionExpected: asset.collisionExpected,
    requiredSockets: asset.requiredSockets,
    requiredAnimations: asset.requiredAnimations,
    budgets: {
      triangleBudget: budget.triangleBudget,
      meshBudget: budget.meshBudget,
      materialBudget: budget.materialBudget,
      textureBudget: budget.textureBudget,
      maxTextureSize: Math.max(...budget.maxTextureSize),
    },
  });
  auditCache.set(cacheKey, result);
  return result;
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

function parentIndices(json) {
  const nodes = json.nodes || [];
  const parents = new Array(nodes.length).fill(-1);
  nodes.forEach((node, parentIndex) => {
    for (const childIndex of node.children || []) {
      assert.equal(parents[childIndex], -1, `Node ${childIndex} cannot have more than one parent`);
      parents[childIndex] = parentIndex;
    }
  });
  return parents;
}

function worldMatrices(json) {
  const nodes = json.nodes || [];
  const parents = parentIndices(json);
  const cache = new Map();
  const visiting = new Set();
  function visit(index) {
    if (cache.has(index)) return cache.get(index);
    assert.ok(!visiting.has(index), `GLB node hierarchy contains a cycle at ${nodes[index]?.name || index}`);
    visiting.add(index);
    const own = localMatrix(nodes[index]);
    const result = parents[index] < 0 ? own : visit(parents[index]).clone().multiply(own);
    visiting.delete(index);
    cache.set(index, result);
    return result;
  }
  nodes.forEach((_, index) => visit(index));
  return cache;
}

function visibleMeshBounds(json, label) {
  const nodes = json.nodes || [];
  const meshes = json.meshes || [];
  const accessors = json.accessors || [];
  const worlds = worldMatrices(json);
  const bounds = new Box3().makeEmpty();
  let primitiveCount = 0;

  nodes.forEach((node, nodeIndexValue) => {
    if (!Number.isInteger(node.mesh) || (node.name || '').startsWith('COL_')) return;
    for (const primitive of meshes[node.mesh]?.primitives || []) {
      const accessor = accessors[primitive.attributes?.POSITION];
      assert.ok(Array.isArray(accessor?.min) && accessor.min.length >= 3,
        `${label} ${node.name} POSITION accessor needs minimum bounds`);
      assert.ok(Array.isArray(accessor?.max) && accessor.max.length >= 3,
        `${label} ${node.name} POSITION accessor needs maximum bounds`);
      primitiveCount += 1;
      for (const x of [accessor.min[0], accessor.max[0]]) {
        for (const y of [accessor.min[1], accessor.max[1]]) {
          for (const z of [accessor.min[2], accessor.max[2]]) {
            bounds.expandByPoint(new Vector3(x, y, z).applyMatrix4(worlds.get(nodeIndexValue)));
          }
        }
      }
    }
  });
  assert.ok(primitiveCount > 0 && !bounds.isEmpty(), `${label} must have measurable visible geometry`);
  return bounds;
}

function namedMeshBounds(json, name, label) {
  const nodes = json.nodes || [];
  const meshes = json.meshes || [];
  const accessors = json.accessors || [];
  const worlds = worldMatrices(json);
  const index = nodeIndex(json, name);
  const node = nodes[index];
  assert.ok(Number.isInteger(node.mesh), `${label} ${name} must be a mesh node`);
  const bounds = new Box3().makeEmpty();
  let primitiveCount = 0;
  for (const primitive of meshes[node.mesh]?.primitives || []) {
    const accessor = accessors[primitive.attributes?.POSITION];
    assert.ok(Array.isArray(accessor?.min) && accessor.min.length >= 3,
      `${label} ${name} POSITION accessor needs minimum bounds`);
    assert.ok(Array.isArray(accessor?.max) && accessor.max.length >= 3,
      `${label} ${name} POSITION accessor needs maximum bounds`);
    primitiveCount += 1;
    for (const x of [accessor.min[0], accessor.max[0]]) {
      for (const y of [accessor.min[1], accessor.max[1]]) {
        for (const z of [accessor.min[2], accessor.max[2]]) {
          bounds.expandByPoint(new Vector3(x, y, z).applyMatrix4(worlds.get(index)));
        }
      }
    }
  }
  assert.ok(primitiveCount > 0 && !bounds.isEmpty(), `${label} ${name} needs measurable geometry`);
  return bounds;
}

function matrixPosition(matrix) {
  return new Vector3().setFromMatrixPosition(matrix);
}

function assertVectorNear(actual, expected, label, epsilon = MATRIX_EPSILON) {
  ['x', 'y', 'z'].forEach((axis, index) => {
    const delta = Math.abs(actual[axis] - expected[index]);
    assert.ok(delta <= epsilon,
      `${label} ${axis} differs by ${delta}; expected ${expected[index]}, received ${actual[axis]}`);
  });
}

function nodeIndex(json, name) {
  const matches = (json.nodes || [])
    .map((node, index) => [node.name, index])
    .filter(([nodeName]) => nodeName === name);
  assert.equal(matches.length, 1, `Expected exactly one GLB node named ${name}`);
  return matches[0][1];
}

function assertMatrixNear(actual, expected, label) {
  for (let index = 0; index < 16; index += 1) {
    const delta = Math.abs(actual.elements[index] - expected.elements[index]);
    assert.ok(delta <= MATRIX_EPSILON, `${label} matrix[${index}] differs by ${delta}, tolerance ${MATRIX_EPSILON}`);
  }
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function expectedMarkers(asset) {
  const result = new Set([...asset.requiredSockets, 'SOCKET_PLACEMENT']);
  if (asset.assetNumber === 51 || asset.assetNumber === 52) {
    for (const exterior of SHEET06.filter(({ assetNumber }) => assetNumber === 51 || assetNumber === 52)) {
      exterior.requiredSockets.forEach((marker) => result.add(marker));
    }
  }
  return sorted(result);
}

function rootRecord(asset, json) {
  const scene = (json.scenes || [])[json.scene || 0];
  assert.ok(scene, `Asset ${asset.assetNumber} must declare a default GLB scene`);
  assert.equal(scene.nodes?.length, 1, `Asset ${asset.assetNumber} must expose one identity root`);
  const rootIndex = scene.nodes[0];
  const root = json.nodes?.[rootIndex];
  assert.equal(root?.name, expectedRootName(asset), `Asset ${asset.assetNumber} identity root`);
  return { root, rootIndex };
}

function assertHierarchyAndMarkers(asset, json, representation) {
  const nodes = json.nodes || [];
  const { root, rootIndex } = rootRecord(asset, json);
  const reachable = new Set();
  const pending = [rootIndex];
  while (pending.length) {
    const index = pending.pop();
    if (reachable.has(index)) continue;
    reachable.add(index);
    pending.push(...(nodes[index]?.children || []));
  }
  assert.equal(reachable.size, nodes.length, `Asset ${asset.assetNumber} ${representation} has orphan GLB nodes`);
  parentIndices(json);

  nodes.forEach((node, index) => {
    assert.ok(node.name, `Asset ${asset.assetNumber} ${representation} node ${index} must be named`);
    assert.match(node.name, APPROVED_NODE_PREFIX, `Asset ${asset.assetNumber} ${representation} node prefix`);
  });

  const markers = nodes.filter((node) => /^(?:SOCKET_|PIVOT_)/u.test(node.name || ''));
  assert.deepEqual(sorted(markers.map(({ name }) => name)), expectedMarkers(asset),
    `Asset ${asset.assetNumber} ${representation} marker contract`);
  for (const marker of markers) {
    const expectedType = marker.name.startsWith('PIVOT_') ? 'pivot' : 'socket';
    assert.equal(marker.extras?.marker_type, expectedType,
      `Asset ${asset.assetNumber} ${representation} ${marker.name} marker_type`);
  }

  const actionNames = (json.animations || []).map((animation) => animation.name);
  assert.deepEqual(sorted(actionNames), sorted(asset.requiredAnimations),
    `Asset ${asset.assetNumber} ${representation} action contract`);

  const identity = new Matrix4();
  assertMatrixNear(localMatrix(root), identity, `Asset ${asset.assetNumber} ${representation} root`);
  return root;
}

function assertRootExtras(asset, root, representation) {
  const extras = root.extras || {};
  const expectedStem = `asset_${String(asset.assetNumber).padStart(3, '0')}_${asset.stem}`;
  assert.equal(extras.asset_number, asset.assetNumber, `Asset ${asset.assetNumber} ${representation} root asset_number`);
  assert.equal(extras.asset_slug, asset.stem, `Asset ${asset.assetNumber} ${representation} root asset_slug`);
  assert.equal(extras.asset_stem, expectedStem, `Asset ${asset.assetNumber} ${representation} root asset_stem`);
  assert.equal(extras.asset_sheet, 6, `Asset ${asset.assetNumber} ${representation} root asset_sheet`);
  assert.equal(extras.first_person_variant, false, `Asset ${asset.assetNumber} is a world asset, not an _FP export`);
  assert.equal(extras.build_schema_version, 1, `Asset ${asset.assetNumber} ${representation} root schema`);
  assert.equal(extras.units, 'meters', `Asset ${asset.assetNumber} ${representation} authored units`);
  assert.equal(extras.up_axis, '+Z', `Asset ${asset.assetNumber} ${representation} authored up axis`);
  assert.equal(extras.front_axis, '-Y', `Asset ${asset.assetNumber} ${representation} authored front axis`);
  assert.equal(extras.license, 'Project-owned', `Asset ${asset.assetNumber} ${representation} license provenance`);
  assert.equal(extras.source, 'Original Pinehollow Golf Flipper asset authored in-repository',
    `Asset ${asset.assetNumber} ${representation} source provenance`);
  assert.equal(typeof extras.target_dimensions_m, 'string', `Asset ${asset.assetNumber} target_dimensions_m extra`);
  assert.deepEqual(JSON.parse(extras.target_dimensions_m), TARGET_DIMENSIONS_XYZ[asset.assetNumber],
    `Asset ${asset.assetNumber} ${representation} target dimensions extra`);
  assert.equal(extras.target_width_m, TARGET_DIMENSIONS_XYZ[asset.assetNumber][0]);
  assert.equal(extras.target_depth_m, TARGET_DIMENSIONS_XYZ[asset.assetNumber][1]);
  assert.equal(extras.target_height_m, TARGET_DIMENSIONS_XYZ[asset.assetNumber][2]);
}

function assertCollisionContract(asset, json, report, representation) {
  const nodesByName = new Map((json.nodes || []).map((node) => [node.name, node]));
  const collisions = report.collisionNodes.map((name) => nodesByName.get(name));
  assert.ok(collisions.length > 0, `Asset ${asset.assetNumber} ${representation} requires authored COL_ helpers`);
  const purposes = new Set();
  for (const collision of collisions) {
    assert.ok(Number.isInteger(collision?.mesh), `Asset ${asset.assetNumber} ${representation} ${collision?.name} must be a mesh`);
    assert.equal(collision.extras?.collision_proxy, true,
      `Asset ${asset.assetNumber} ${representation} ${collision.name} collision_proxy extra`);
    assert.match(collision.extras?.collision_shape || '', /^(?:box|cylinder|convex_hull)$/u,
      `Asset ${asset.assetNumber} ${representation} ${collision.name} collision shape`);
    assert.equal(typeof collision.extras?.collision_purpose, 'string',
      `Asset ${asset.assetNumber} ${representation} ${collision.name} collision purpose`);
    purposes.add(collision.extras.collision_purpose);
  }
  assert.deepEqual(sorted(purposes), sorted(COLLISION_PURPOSES[asset.assetNumber]),
    `Asset ${asset.assetNumber} ${representation} collision purposes`);

  for (const node of json.nodes || []) {
    if (node.extras?.collision_proxy === true) assert.match(node.name || '', /^COL_/u);
    if ((node.name || '').startsWith('COL_')) assert.equal(node.extras?.collision_proxy, true);
  }
}

function assertCleanAudit(asset, report, representation) {
  const budget = CATEGORY_BUDGETS[asset.category];
  assert.equal(report.exists, true, `Asset ${asset.assetNumber} ${representation} GLB exists`);
  assert.equal(report.sourceExists, true, `Asset ${asset.assetNumber} Blender source exists`);
  assert.equal(report.error, null, `Asset ${asset.assetNumber} ${representation} parses cleanly`);
  assert.deepEqual(report.flags, [], `Asset ${asset.assetNumber} ${representation} structural audit flags`);
  assert.deepEqual(report.budgetViolations, [], `Asset ${asset.assetNumber} ${representation} budget violations`);
  assert.deepEqual(report.genericNames, [], `Asset ${asset.assetNumber} ${representation} generic nodes`);
  assert.deepEqual(report.duplicateNodeNames, [], `Asset ${asset.assetNumber} ${representation} duplicate nodes`);
  assert.deepEqual(report.duplicateMaterialNames, [], `Asset ${asset.assetNumber} ${representation} duplicate materials`);
  assert.deepEqual(report.suspiciousTransforms, [], `Asset ${asset.assetNumber} ${representation} unapplied mesh transforms`);
  assert.deepEqual(report.missingTextureReferences, [], `Asset ${asset.assetNumber} ${representation} missing textures`);
  assert.deepEqual(report.hiddenNodes, [], `Asset ${asset.assetNumber} ${representation} hidden ship nodes`);
  assert.equal(report.cameraCount, 0, `Asset ${asset.assetNumber} ${representation} exports no camera`);
  assert.equal(report.lightCount, 0, `Asset ${asset.assetNumber} ${representation} exports no light`);
  assert.ok(report.meshCount > 0 && report.triangleCount > 0,
    `Asset ${asset.assetNumber} ${representation} contains production geometry`);
  assert.ok(report.triangleCount <= budget.triangleBudget);
  assert.ok(report.meshCount <= budget.meshBudget);
  assert.ok(report.materialCount <= budget.materialBudget);
  assert.ok(report.textureCount <= budget.textureBudget);
  assert.ok(report.fileSizeBytes <= budget.maxFileBytes,
    `Asset ${asset.assetNumber} ${representation} exceeds ${budget.maxFileBytes} bytes`);
  for (const texture of report.textureDimensions) {
    assert.ok(texture.width != null && texture.height != null,
      `Asset ${asset.assetNumber} ${representation} ${texture.image} dimensions must be measurable`);
    assert.ok(texture.width <= budget.maxTextureSize[0] && texture.height <= budget.maxTextureSize[1],
      `Asset ${asset.assetNumber} ${representation} ${texture.image} exceeds texture budget`);
  }
}

assert.deepEqual(SHEET06.map(({ assetNumber }) => assetNumber), [51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);

for (const asset of SHEET06) {
  test(`Asset ${asset.assetNumber} source and byte-identical GLBs pass the Sheet-6 production gate`, () => {
    const paths = exactProductionPaths(asset);
    requireProductionFile(paths.source, `Asset ${asset.assetNumber} Blender source`);

    const canonicalReport = audit(asset, paths.canonicalGlb);
    const runtimeReport = audit(asset, paths.runtimeGlb);
    assertCleanAudit(asset, canonicalReport, 'canonical');
    assertCleanAudit(asset, runtimeReport, 'runtime');
    assert.equal(canonicalReport.sha256, runtimeReport.sha256,
      `Asset ${asset.assetNumber} canonical/runtime SHA-256 must match until a measured optimizer exists`);
    assert.equal(canonicalReport.fileSizeBytes, runtimeReport.fileSizeBytes);

    for (const [representation, repoPath, report] of [
      ['canonical', paths.canonicalGlb, canonicalReport],
      ['runtime', paths.runtimeGlb, runtimeReport],
    ]) {
      const { json } = parseGlb(repoPath);
      const root = assertHierarchyAndMarkers(asset, json, representation);
      assertRootExtras(asset, root, representation);
      assertCollisionContract(asset, json, report, representation);
    }
  });
}

test('Assets 51 and 52 share registration matrices while only Asset 51 owns structure/navigation', () => {
  const finished = SHEET06.find(({ assetNumber }) => assetNumber === 51);
  const damaged = SHEET06.find(({ assetNumber }) => assetNumber === 52);
  for (const representation of ['canonicalGlb', 'runtimeGlb']) {
    const finishedJson = parseGlb(exactProductionPaths(finished)[representation]).json;
    const damagedJson = parseGlb(exactProductionPaths(damaged)[representation]).json;
    const finishedRoot = rootRecord(finished, finishedJson).root;
    const damagedRoot = rootRecord(damaged, damagedJson).root;
    const finishedExtras = finishedRoot.extras || {};
    const damagedExtras = damagedRoot.extras || {};

    assert.equal(finishedExtras.registration_id, REGISTRATION_ID);
    assert.equal(damagedExtras.registration_id, REGISTRATION_ID);
    assert.equal(finishedExtras.structural_role, 'CANONICAL_STRUCTURAL_AUTHORITY');
    assert.equal(finishedExtras.structural_authority, true);
    assert.equal(damagedExtras.structural_role, 'ADDITIVE_DAMAGE_VISUALS');
    assert.equal(damagedExtras.structural_authority, false);
    assert.equal(damagedExtras.additive_damage_only, true);
    assert.equal(damagedExtras.owns_navigation_collision, false);
    assert.equal(damagedExtras.canonical_structure_asset, 51);
    assert.equal(damagedExtras.structural_collision, false);
    assert.equal(finishedExtras.registration_manifest_json, damagedExtras.registration_manifest_json);
    assert.equal(finishedExtras.registration_manifest_sha256, damagedExtras.registration_manifest_sha256);
    assert.equal(createHash('sha256').update(finishedExtras.registration_manifest_json).digest('hex'),
      finishedExtras.registration_manifest_sha256);

    for (const node of damagedJson.nodes || []) {
      const extras = node.extras || {};
      assert.notEqual(extras.structural_authority, true, `${node.name} cannot claim structural authority`);
      assert.notEqual(extras.structural_geometry, true, `${node.name} cannot duplicate canonical structure`);
      assert.notEqual(extras.collision_authority, true, `${node.name} cannot claim collision authority`);
      assert.notEqual(extras.owns_navigation_collision, true, `${node.name} cannot own navigation collision`);
      assert.notEqual(extras.structural_role, 'CANONICAL_STRUCTURAL_AUTHORITY');
      if ((node.name || '').startsWith('COL_')) {
        assert.equal(extras.collision_purpose, 'raycast-only', `${node.name} must remain non-blocking damage selection`);
      }
    }

    const finishedSockets = new Set((finishedJson.nodes || [])
      .map(({ name }) => name)
      .filter((name) => name?.startsWith('SOCKET_')));
    const damagedSockets = new Set((damagedJson.nodes || [])
      .map(({ name }) => name)
      .filter((name) => name?.startsWith('SOCKET_')));
    const sharedSockets = sorted([...finishedSockets].filter((name) => damagedSockets.has(name)));
    assert.ok(sharedSockets.length >= 3, 'Assets 51/52 must share their registration datums');
    for (const required of ['SOCKET_MainEntrance', 'SOCKET_Porch', 'SOCKET_ClubSign']) {
      assert.ok(sharedSockets.includes(required), `Assets 51/52 share ${required}`);
    }

    const finishedWorld = worldMatrices(finishedJson);
    const damagedWorld = worldMatrices(damagedJson);
    for (const socket of sharedSockets) {
      const finishedIndex = nodeIndex(finishedJson, socket);
      const damagedIndex = nodeIndex(damagedJson, socket);
      assertMatrixNear(localMatrix(finishedJson.nodes[finishedIndex]), localMatrix(damagedJson.nodes[damagedIndex]),
        `${representation} ${socket} local`);
      assertMatrixNear(finishedWorld.get(finishedIndex), damagedWorld.get(damagedIndex),
        `${representation} ${socket} world`);
    }
  }
});

test('Asset 53 exports exactly two hinge pivots and four correctly targeted door actions', () => {
  const door = SHEET06.find(({ assetNumber }) => assetNumber === 53);
  for (const representation of ['canonicalGlb', 'runtimeGlb']) {
    const { json } = parseGlb(exactProductionPaths(door)[representation]);
    const pivots = (json.nodes || []).filter(({ name }) => name?.startsWith('PIVOT_'));
    assert.deepEqual(sorted(pivots.map(({ name }) => name)), ['PIVOT_DoorLeft', 'PIVOT_DoorRight']);
    const actions = json.animations || [];
    assert.deepEqual(sorted(actions.map(({ name }) => name)),
      ['DoorLeft_Close', 'DoorLeft_Open', 'DoorRight_Close', 'DoorRight_Open']);

    for (const action of actions) {
      const expectedPivot = action.name.includes('Left') ? 'PIVOT_DoorLeft' : 'PIVOT_DoorRight';
      const expectedIndex = nodeIndex(json, expectedPivot);
      assert.ok((action.channels || []).length > 0, `${action.name} contains keyed channels`);
      assert.ok(action.channels.some(({ target }) => target?.path === 'rotation'),
        `${action.name} must rotate its physical hinge pivot`);
      for (const channel of action.channels) {
        assert.equal(channel.target?.node, expectedIndex, `${action.name} may only target ${expectedPivot}`);
      }
    }
  }
});

test('Assets 53 and 55 use alpha-blended glazing without per-pane scene transmission passes', () => {
  for (const assetNumber of [53, 55]) {
    const asset = SHEET06.find((candidate) => candidate.assetNumber === assetNumber);
    for (const representation of ['canonicalGlb', 'runtimeGlb']) {
      const { json } = parseGlb(exactProductionPaths(asset)[representation]);
      const glass = (json.materials || []).find(({ name }) => name === 'MAT_S06_ClearWindowGlass');
      assert.ok(glass, `Asset ${assetNumber} ${representation} publishes its glass material`);
      assert.equal(glass.alphaMode, 'BLEND');
      assert.equal(glass.doubleSided, true);
      assert.ok(Math.abs(glass.pbrMetallicRoughness?.baseColorFactor?.[3] - 0.30) <= MATRIX_EPSILON);
      assert.equal(glass.extensions?.KHR_materials_transmission, undefined,
        `Asset ${assetNumber} ${representation} must not rerender the scene once per pane`);
      assert.equal((json.extensionsUsed || []).includes('KHR_materials_transmission'), false);
    }
  }
});

test('Asset 54 deck and entrance socket compose exactly onto Asset 51 porch/floor datum', () => {
  const finished = SHEET06.find(({ assetNumber }) => assetNumber === 51);
  const porch = SHEET06.find(({ assetNumber }) => assetNumber === 54);
  const metersToYards = 1 / 0.9144;
  const expectedFloorMeters = 0.27432;
  const expectedFrontMeters = 5.25;
  const expectedFrontYards = expectedFrontMeters * metersToYards;
  const porchPlacementYards = new Vector3(-1, 0, expectedFrontYards);

  for (const representation of ['canonicalGlb', 'runtimeGlb']) {
    const finishedJson = parseGlb(exactProductionPaths(finished)[representation]).json;
    const porchJson = parseGlb(exactProductionPaths(porch)[representation]).json;
    const finishedWorlds = worldMatrices(finishedJson);
    const porchWorlds = worldMatrices(porchJson);
    const finishedSocket = matrixPosition(
      finishedWorlds.get(nodeIndex(finishedJson, 'SOCKET_Porch')),
    );
    const porchSocket = matrixPosition(
      porchWorlds.get(nodeIndex(porchJson, 'SOCKET_MainEntrance')),
    );

    assertVectorNear(finishedSocket, [-0.9144, expectedFloorMeters, expectedFrontMeters],
      `Asset 51 ${representation} SOCKET_Porch authored metres`);
    assertVectorNear(porchSocket, [0, expectedFloorMeters, 0],
      `Asset 54 ${representation} SOCKET_MainEntrance authored metres`);

    const finishedRuntime = finishedSocket.clone().multiplyScalar(metersToYards);
    const porchRuntime = porchSocket.clone().multiplyScalar(metersToYards).add(porchPlacementYards);
    assertVectorNear(finishedRuntime, [-1, 0.3, expectedFrontYards],
      `Asset 51 ${representation} runtime porch datum`);
    assertVectorNear(porchRuntime, [-1, 0.3, expectedFrontYards],
      `Asset 54 ${representation} runtime entrance datum`);
    assert.ok(finishedRuntime.distanceTo(porchRuntime) <= MATRIX_EPSILON,
      `Asset 54 ${representation} entrance must compose onto Asset 51 SOCKET_Porch`);

    const deckBounds = namedMeshBounds(porchJson, 'MESH_OakDeckBoards',
      `Asset 54 ${representation}`);
    assert.ok(Math.abs(deckBounds.max.y - expectedFloorMeters) <= MATRIX_EPSILON,
      `Asset 54 ${representation} deck top ${deckBounds.max.y}m must equal ${expectedFloorMeters}m`);

    const root = rootRecord(porch, porchJson).root;
    assert.equal(root.extras?.deck_surface_z_m, expectedFloorMeters);
    assert.equal(root.extras?.main_entrance_alignment_z_m, expectedFloorMeters);
    assert.equal(root.extras?.stair_rise_count, 2);
  }
});

test('Assets 55-60 export separable top-level runtime variants with exactly one default', () => {
  for (const asset of SHEET06.filter(({ assetNumber }) => assetNumber >= 55)) {
    for (const representation of ['canonicalGlb', 'runtimeGlb']) {
      const { json } = parseGlb(exactProductionPaths(asset)[representation]);
      const { root } = rootRecord(asset, json);
      const variants = (root.children || [])
        .map((index) => json.nodes?.[index])
        .filter((node) => node && !Number.isInteger(node.mesh) && node.extras?.runtime_variant === true);
      assert.deepEqual(sorted(variants.map((node) => node.extras.variant_id)), TOP_LEVEL_VARIANTS[asset.assetNumber],
        `Asset ${asset.assetNumber} ${representation} top-level variant contract`);
      assert.equal(variants.filter((node) => node.extras.variant_default === true).length, 1,
        `Asset ${asset.assetNumber} ${representation} must identify exactly one default variant`);
      for (const variant of variants) {
        assert.equal(typeof variant.extras.runtime_visibility_contract, 'string',
          `Asset ${asset.assetNumber} ${representation} ${variant.extras.variant_id} visibility contract`);
        assert.ok((variant.children || []).some((index) => Number.isInteger(json.nodes?.[index]?.mesh)),
          `Asset ${asset.assetNumber} ${representation} ${variant.extras.variant_id} needs renderable geometry`);
      }
    }
  }
});

test('Asset 52 has no boarded apertures - deleted 2026-07-29, and it stays deleted', () => {
  // Reported: "Still walk-through, and I do not want them at all. Delete the
  // boarded-aperture geometry rather than giving it a collider."
  //
  // The module boarded the west window, the middle window and the MAIN DOOR aperture. The
  // door set is what made it indefensible: boards fixed to an aperture do not swing, so
  // once both leaves opened, three planks hung across an empty doorway (measured movedYd
  // 0.000 with the leaves held at 1.745 rad). This test exists because the geometry comes
  // out of a Blender builder — the deletion lives in tools/blender/build_assets_51_60.py,
  // and without an assertion here the next rebuild could quietly restore it.
  const exteriorDamage = SHEET06.find(({ assetNumber }) => assetNumber === 52);
  for (const representation of ['canonicalGlb', 'runtimeGlb']) {
    const { json } = parseGlb(exactProductionPaths(exteriorDamage)[representation]);
    const names = (json.nodes || []).map((node) => node.name || '');
    const boarding = names.filter((name) => /Board(ed|Fastener)/i.test(name));
    assert.deepEqual(boarding, [], `asset 52 ${representation} still ships boarding: ${boarding.join(', ')}`);
    // Nothing may carry the damage kinds either — a renamed node with the same extras is
    // the same geometry.
    const kinds = (json.nodes || []).map((node) => node.extras?.damage_kind).filter(Boolean);
    assert.equal(kinds.includes('boarded_aperture'), false);
    assert.equal(kinds.includes('board_fastener'), false);
    // The rest of the dilapidated overlay is untouched: only the boarding was removed.
    for (const kept of ['MESH_HeavyRoofMoss', 'MESH_AlignedRoofMoldPatches', 'MESH_WarpedMissingTrim']) {
      assert.ok(names.some((name) => name === kept), `${kept} must survive the boarding deletion`);
    }
  }
});

test('Asset 56 publishes one repairable sparse panel-wear overlay with deterministic runtime sampling', () => {
  const wallPanels = SHEET06.find(({ assetNumber }) => assetNumber === 56);
  for (const representation of ['canonicalGlb', 'runtimeGlb']) {
    const { json } = parseGlb(exactProductionPaths(wallPanels)[representation]);
    const wear = json.nodes[nodeIndex(json, 'MESH_PanelDamageWear')];
    assert.equal(wear.extras?.variant_id, 'straight');
    assert.equal(wear.extras?.damage_overlay, true);
    assert.equal(wear.extras?.repairable, true);
    assert.equal(wear.extras?.damage_kind, 'sparse_panel_scuff');
    assert.equal(wear.extras?.damage_sample_stride, 7);
    assert.equal(wear.extras?.damage_sample_offset, 2);
    assert.match(wear.extras?.runtime_sampling_contract || '', /one of every seven/u);
  }
});

test('Asset 60 damaged wood reads as missing Y-aligned boards, not a replacement floor field', () => {
  const damagedFloor = SHEET06.find(({ assetNumber }) => assetNumber === 60);
  for (const representation of ['canonicalGlb', 'runtimeGlb']) {
    const { json } = parseGlb(exactProductionPaths(damagedFloor)[representation]);
    const pocket = json.nodes[nodeIndex(json, 'MESH_DamagedWoodSubfloorPocket')];
    const brokenBoards = json.nodes[nodeIndex(json, 'MESH_DamagedWoodUnevenPlankField')];
    const splinters = json.nodes[nodeIndex(json, 'MESH_DamagedWoodChips')];
    assert.equal(pocket.extras?.damage_kind, 'jagged_subfloor_reveal');
    assert.equal(pocket.extras?.missing_board_count, 3);
    assert.equal(pocket.extras?.grain_axis, 'Y');
    assert.equal(pocket.extras?.full_replacement_field, false);
    assert.equal(brokenBoards.extras?.grain_axis, 'Y');
    assert.equal(brokenBoards.extras?.localized_fragment_count, 3);
    assert.equal(brokenBoards.extras?.full_replacement_field, false);
    assert.equal(splinters.extras?.damage_kind, 'splinter');

    const woodBounds = new Box3().makeEmpty();
    for (const name of [
      'MESH_DamagedWoodChips',
      'MESH_DamagedWoodCrackNetwork',
      'MESH_DamagedWoodLiftedFragments',
      'MESH_DamagedWoodSubfloorPocket',
      'MESH_DamagedWoodUnevenPlankField',
    ]) {
      woodBounds.union(namedMeshBounds(json, name, `Asset 60 ${representation}`));
    }
    assert.ok(Math.abs(woodBounds.min.y - 0.018) <= MATRIX_EPSILON,
      `Asset 60 ${representation} damaged-wood datum must be 0.018m, received ${woodBounds.min.y}`);
    assert.ok(woodBounds.max.y <= 0.035 + MATRIX_EPSILON,
      `Asset 60 ${representation} damaged-wood top exceeds 0.035m: ${woodBounds.max.y}`);
    assert.ok((woodBounds.max.y - woodBounds.min.y) <= 0.017 + MATRIX_EPSILON,
      `Asset 60 ${representation} damaged-wood relief exceeds 0.017m`);
  }
});

test('Asset 60 visible damage relief never exceeds the authored 0.035 metre envelope', () => {
  const damagedFloor = SHEET06.find(({ assetNumber }) => assetNumber === 60);
  for (const representation of ['canonicalGlb', 'runtimeGlb']) {
    const { json } = parseGlb(exactProductionPaths(damagedFloor)[representation]);
    const bounds = visibleMeshBounds(json, `Asset 60 ${representation}`);
    const relief = bounds.max.y - bounds.min.y; // glTF is Y-up; Blender-authored relief is Z.
    assert.ok(bounds.min.y >= -MATRIX_EPSILON,
      `Asset 60 ${representation} visible geometry falls below the floor datum: ${bounds.min.y}m`);
    assert.ok(relief > 0 && relief <= 0.035 + MATRIX_EPSILON,
      `Asset 60 ${representation} visible relief is ${relief}m; maximum is 0.035m`);
  }
});
