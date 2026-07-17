// Asset Sheet 05, refs 46 and 50: production contracts for the generic
// merchandise carton and its standalone packing-tape companion.
//
// These tests intentionally exercise the shipped GLBs through the same
// GLTFLoader path as the game. They are allowed to lead implementation: a
// missing asset or model-map entry is a useful, explicit failure rather than a
// silent fallback to procedural BoxGeometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { auditGlb } from '../tools/qa/glb-audit.mjs';
import { BOX_KINDS, boxKindFor, boxDims, unitsPerBox } from '../src/data/boxes.js';
import { skuById } from '../src/data/shopItems.js';
import { DELIVERY_MODEL_BY_BOX_KIND } from '../src/render3d/clubhouse/deliveryBoxVisual.js';

const SPECS = Object.freeze({
  carton: Object.freeze({
    id: 'delivery_generic_merchandise_box',
    reference: '46',
    // Three.js is Y-up: width X, height Y, depth Z.
    dimensions: Object.freeze([0.60, 0.40, 0.40]),
    envelope: Object.freeze([
      Object.freeze([0.595, 0.605]),
      Object.freeze([0.395, 0.405]),
      Object.freeze([0.395, 0.405]),
    ]),
    budget: Object.freeze({
      triangles: Object.freeze([1500, 12000]),
      materials: Object.freeze([5, 12]),
      textures: Object.freeze([0, 4]),
      nodes: Object.freeze([55, 120]),
    }),
  }),
  tape: Object.freeze({
    id: 'delivery_packing_tape_roll',
    reference: '50',
    // 10 cm OD in X/Y, 5 cm axial width in Z.
    dimensions: Object.freeze([0.10, 0.10, 0.05]),
    envelope: Object.freeze([
      Object.freeze([0.098, 0.103]),
      Object.freeze([0.098, 0.103]),
      Object.freeze([0.049, 0.052]),
    ]),
    budget: Object.freeze({
      triangles: Object.freeze([500, 8000]),
      materials: Object.freeze([3, 12]),
      textures: Object.freeze([0, 4]),
      nodes: Object.freeze([14, 40]),
    }),
  }),
});

function makeLoader() {
  // Node has no browser image decoder. Geometry, hierarchy, materials and
  // extras still pass through the production loader; only texture allocation
  // is stubbed, matching the checkout/pro-shop asset tests.
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'node-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader;
}

const cache = new Map();

function assetUrl(spec) {
  return new URL(`../vendor/models/clubhouse/${spec.id}.glb`, import.meta.url);
}

function loadAsset(spec) {
  if (!cache.has(spec.id)) {
    cache.set(spec.id, (async () => {
      const url = assetUrl(spec);
      const bytes = await readFile(url);
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const gltf = await new Promise((resolve, reject) => makeLoader().parse(data, '', resolve, reject));
      const root = gltf.scene.getObjectByName(spec.id);
      assert.ok(root, `${spec.id} must expose an exact named asset root`);
      return {
        gltf,
        root,
        audit: auditGlb(fileURLToPath(url)),
      };
    })());
  }
  return cache.get(spec.id);
}

function isHelper(object) {
  return /^(COL_|COLLISION_|VOLUME_)/.test(String(object?.name || ''));
}

function visibleBounds(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry || isHelper(object)) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
  });
  return bounds;
}

function sizeOf(root) {
  return visibleBounds(root).getSize(new THREE.Vector3());
}

function trianglesOf(root, { includeHelpers = false } = {}) {
  let triangles = 0;
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry || (!includeHelpers && isHelper(object))) return;
    const positions = object.geometry.attributes.position;
    const count = object.geometry.index ? object.geometry.index.count : positions?.count || 0;
    triangles += Math.floor(count / 3);
  });
  return triangles;
}

function assertEnvelope(actual, envelope, label) {
  ['x', 'y', 'z'].forEach((axis, index) => {
    const [min, max] = envelope[index];
    assert.ok(
      actual[axis] >= min && actual[axis] <= max,
      `${label} ${axis} ${actual[axis].toFixed(5)}m outside [${min}, ${max}]m`,
    );
  });
}

function exactNode(root, name) {
  const object = root.getObjectByName(name);
  assert.ok(object, `${root.name} missing ${name}`);
  return object;
}

function assertDirectChild(parent, childName) {
  const child = exactNode(parent, childName);
  assert.equal(child.parent, parent, `${childName} must be parented directly to ${parent.name}`);
  return child;
}

function materialSet(root, predicate = () => true) {
  const result = new Set();
  root.traverse((object) => {
    if (!object.isMesh || !predicate(object)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material) result.add(material);
  });
  return result;
}

function assertRootMetadata(root, spec) {
  const data = root.userData || {};
  assert.equal(data.asset_id, spec.id, `${spec.id} asset_id`);
  assert.ok(data.version !== undefined && data.version !== null, `${spec.id} version`);
  assert.match(String(data.units || ''), /^(m|metres?|meters?)$/i, `${spec.id} metre units`);
  assert.equal(String(data.reference_id), spec.reference, `${spec.id} reference_id`);
  assert.ok(String(data.source || '').trim(), `${spec.id} records its source`);
  assert.ok(String(data.license || '').trim(), `${spec.id} records its license`);
  assert.ok(Array.isArray(data.target_dimensions_m), `${spec.id} target_dimensions_m`);
  assert.deepEqual(
    data.target_dimensions_m.map((value) => Number(value)),
    spec.dimensions,
    `${spec.id} target dimensions metadata`,
  );
}

function assertBudget(asset, spec) {
  const { audit } = asset;
  for (const metric of ['triangles', 'materials', 'textures', 'nodes']) {
    const [min, max] = spec.budget[metric];
    assert.ok(
      audit[metric] >= min && audit[metric] <= max,
      `${spec.id} ${metric} ${audit[metric]} outside [${min}, ${max}]`,
    );
  }
  assert.equal(audit.cameras, 0, `${spec.id} exports no camera`);
  assert.equal(audit.lights, 0, `${spec.id} exports no light`);
}

function assertProductionMeshes(root) {
  root.traverse((object) => {
    if (!object.isMesh || isHelper(object)) return;
    assert.ok(object.geometry.attributes.normal, `${root.name}/${object.name} has normals`);
    assert.ok(object.geometry.attributes.uv, `${root.name}/${object.name} has UVs`);
    for (const [axis, value] of Object.entries(object.scale)) {
      if (!['x', 'y', 'z'].includes(axis)) continue;
      assert.ok(Math.abs(value - 1) < 1e-5, `${root.name}/${object.name} applied ${axis} scale`);
    }
  });
}

test('ref 46 and 50 GLBs load with exact metadata, dimensions and production budgets', async () => {
  for (const spec of Object.values(SPECS)) {
    const asset = await loadAsset(spec);
    assert.ok(asset.gltf.scene, `${spec.id} has a Three.js scene`);
    assertRootMetadata(asset.root, spec);
    assertEnvelope(sizeOf(asset.root), spec.envelope, spec.id);
    assertBudget(asset, spec);
    assertProductionMeshes(asset.root);
  }
});

test('generic carton exposes four independent wall and flap hinge hierarchies', async () => {
  const { root } = await loadAsset(SPECS.carton);
  exactNode(root, 'BOX_BASE');
  for (const side of ['FRONT', 'BACK', 'LEFT', 'RIGHT']) {
    const wallPivot = exactNode(root, `BOX_WALL_${side}`);
    const flapPivot = exactNode(root, `BOX_FLAP_${side}`);
    assert.equal(wallPivot.isMesh, undefined, `BOX_WALL_${side} is a pivot, not merged geometry`);
    assert.equal(flapPivot.isMesh, undefined, `BOX_FLAP_${side} is a pivot, not merged geometry`);
    assertDirectChild(wallPivot, `BOX_${side}`);
    assertDirectChild(flapPivot, `FLAP_TOP_${side}`);
  }
});

test('generic carton exposes segmented tape, labels, inserts and eight authored content sockets', async () => {
  const { root } = await loadAsset(SPECS.carton);
  exactNode(root, 'TAPE_CENTER');
  for (let index = 1; index <= 8; index += 1) {
    exactNode(root, `TAPE_CENTER_SEG_${String(index).padStart(2, '0')}`);
  }
  exactNode(root, 'TAPE_SIDE_FRONT');
  exactNode(root, 'TAPE_SIDE_BACK');

  for (const name of ['LABEL_MAIN', 'LABEL_SHIPPING', 'LABEL_DYNAMIC']) exactNode(root, name);
  for (const name of ['INSERT_BOTTOM', 'INSERT_SIDE_LEFT', 'INSERT_SIDE_RIGHT']) exactNode(root, name);

  const sockets = [];
  for (let index = 1; index <= 8; index += 1) {
    const socket = exactNode(root, `CONTENT_SLOT_${String(index).padStart(2, '0')}`);
    assert.equal(socket.isMesh, undefined, `${socket.name} is an authored transform socket`);
    const data = socket.userData || {};
    assert.ok(String(data.allowed_category ?? data.accepts ?? '').trim(), `${socket.name} allowed category`);
    for (const key of ['max_w', 'max_d', 'max_h']) {
      assert.ok(Number(data[key]) > 0 && Number(data[key]) <= 0.20, `${socket.name} ${key} <= 0.20m`);
    }
    assert.ok(Number.isInteger(Number(data.stack_order)), `${socket.name} stack_order`);
    assert.ok(Number(data.visibility_threshold) >= 0 && Number(data.visibility_threshold) <= 1,
      `${socket.name} visibility_threshold`);
    assert.ok(Number.isInteger(Number(data.removal_order)), `${socket.name} removal_order`);
    sockets.push(socket);
  }
  const distinct = (axis) => new Set(sockets.map((socket) => socket.position[axis].toFixed(4))).size;
  assert.equal(distinct('x'), 2, 'content sockets use two columns');
  assert.equal(distinct('y'), 2, 'content sockets use two vertical layers');
  assert.equal(distinct('z'), 2, 'content sockets use two depth rows');
});

test('generic carton exposes simplified collisions, interaction targets and a compact flat bundle', async () => {
  const { root } = await loadAsset(SPECS.carton);
  for (const name of ['COLLISION_CLOSED', 'COLLISION_OPEN']) {
    const collision = exactNode(root, name);
    assert.ok(collision.isMesh, `${name} is exported geometry`);
    assert.ok(trianglesOf(collision, { includeHelpers: true }) <= 24, `${name} remains simplified`);
  }
  for (const name of ['INTERACTION_TARGET', 'CUT_PATH', 'VOLUME_CONTENTS']) exactNode(root, name);

  const bundle = exactNode(root, 'BOX_FLAT_BUNDLE');
  for (const name of ['FLAT_PANEL_BASE', 'FLAT_PANEL_FRONT', 'FLAT_PANEL_BACK',
    'FLAT_PANEL_LEFT', 'FLAT_PANEL_RIGHT', 'FLAT_LABEL']) {
    assertDirectChild(bundle, name);
  }
  const flatSize = sizeOf(bundle);
  assert.ok(flatSize.x >= 0.55 && flatSize.x <= 0.605, `flat bundle width ${flatSize.x}`);
  assert.ok(flatSize.y > 0.005 && flatSize.y <= 0.05, `flat bundle thickness ${flatSize.y}`);
  assert.ok(flatSize.z >= 0.35 && flatSize.z <= 0.405, `flat bundle depth ${flatSize.z}`);
});

test('packing-tape roll exposes wound layers, printed core, loose end, grip and collision', async () => {
  const { root } = await loadAsset(SPECS.tape);
  exactNode(root, 'TAPE_WOUND');
  for (let index = 1; index <= 4; index += 1) {
    exactNode(root, `TAPE_LAYER_${String(index).padStart(2, '0')}`);
    exactNode(root, `CORE_PRINT_${String(index).padStart(2, '0')}`);
  }
  exactNode(root, 'TAPE_CORE');
  exactNode(root, 'TAPE_LOOSE_END');

  const collision = exactNode(root, 'COL_PACKING_TAPE');
  assert.ok(collision.isMesh, 'packing tape collision is exported geometry');
  assert.ok(trianglesOf(collision, { includeHelpers: true }) <= 256, 'packing tape collision stays simplified');
  const grip = exactNode(root, 'TAPE_GRIP_POINT');
  assert.equal(grip.isMesh, undefined, 'TAPE_GRIP_POINT is a transform socket');

  const tapeMaterials = materialSet(root, (object) => /^TAPE_(WOUND|LAYER_|LOOSE_END)/.test(object.name));
  assert.ok(tapeMaterials.size > 0, 'packing tape has an authored material');
  assert.ok([...tapeMaterials].some((material) => material.transparent || material.opacity < 0.99),
    'packing tape material is visibly translucent');
});

test('ref 46 has a distinct merchbox data kind and authored model instead of replacing the small carton', () => {
  const cap = skuById('cap1');
  assert.ok(BOX_KINDS.merchbox, 'ref 46 exposes a distinct merchbox kind');
  assert.strictEqual(boxKindFor(cap), BOX_KINDS.merchbox, 'cap1 ships in the ref 46 merchandise carton');
  assert.deepEqual(boxDims(BOX_KINDS.merchbox), { w: 0.60, h: 0.40, d: 0.40 },
    'merchbox keeps the exact 60 x 40 x 40 cm reference dimensions');
  assert.equal(unitsPerBox(cap), 8, 'one ref 46 cap carton carries eight units');
  assert.notStrictEqual(BOX_KINDS.merchbox, BOX_KINDS.carton,
    'the 42 x 30 x 36 cm small-accessory carton remains independent');
  assert.equal(
    DELIVERY_MODEL_BY_BOX_KIND.merchbox,
    SPECS.carton.id,
    'the live merchandise carton must map to delivery_generic_merchandise_box',
  );
});
