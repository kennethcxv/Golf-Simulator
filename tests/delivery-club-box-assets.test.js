// Asset Sheet 05, ref 48: production contract for the long golf-club carton.
// The shipped GLB is loaded through Three's production loader so hierarchy,
// dimensions, metadata and runtime routing cannot be satisfied by a placeholder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { auditGlb } from '../tools/qa/glb-audit.mjs';
import { BOX_KINDS, boxDims, boxKindFor, unitsPerBox } from '../src/data/boxes.js';
import { skuById } from '../src/data/shopItems.js';
import { DELIVERY_MODEL_BY_BOX_KIND } from '../src/render3d/clubhouse/deliveryBoxVisual.js';

const SPEC = Object.freeze({
  id: 'delivery_golf_club_box',
  reference: '48',
  // Three.js is Y-up: 1.25 m length X, .18 m height Y, .18 m depth Z.
  dimensions: Object.freeze([1.25, 0.18, 0.18]),
  envelope: Object.freeze([
    Object.freeze([1.244, 1.256]),
    Object.freeze([0.174, 0.186]),
    Object.freeze([0.174, 0.186]),
  ]),
  budget: Object.freeze({
    triangles: Object.freeze([1500, 12000]),
    materials: Object.freeze([5, 12]),
    textures: Object.freeze([0, 4]),
    nodes: Object.freeze([50, 120]),
  }),
});

function makeLoader() {
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'node-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader;
}

let loaded;

async function loadAsset() {
  if (!loaded) {
    loaded = (async () => {
      const url = new URL(`../vendor/models/clubhouse/${SPEC.id}.glb`, import.meta.url);
      const bytes = await readFile(url);
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const gltf = await new Promise((resolve, reject) => makeLoader().parse(data, '', resolve, reject));
      const root = gltf.scene.getObjectByName(SPEC.id);
      assert.ok(root, `${SPEC.id} exposes an exact named asset root`);
      return { gltf, root, audit: auditGlb(fileURLToPath(url)) };
    })();
  }
  return loaded;
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

function exactNode(root, name) {
  const object = root.getObjectByName(name);
  assert.ok(object, `${root.name} missing ${name}`);
  return object;
}

function directChild(parent, name) {
  const child = exactNode(parent, name);
  assert.equal(child.parent, parent, `${name} must be parented directly to ${parent.name}`);
  return child;
}

function trianglesOf(object) {
  let triangles = 0;
  object.traverse((candidate) => {
    if (!candidate.isMesh || !candidate.geometry) return;
    const positions = candidate.geometry.attributes.position;
    const count = candidate.geometry.index ? candidate.geometry.index.count : positions?.count || 0;
    triangles += Math.floor(count / 3);
  });
  return triangles;
}

function assertMetadata(root) {
  const data = root.userData || {};
  assert.equal(data.asset_id, SPEC.id, 'asset_id');
  assert.ok(data.version !== undefined && data.version !== null, 'version');
  assert.match(String(data.units || ''), /^(m|metres?|meters?)$/i, 'metre units');
  assert.equal(String(data.reference_id), SPEC.reference, 'reference_id');
  assert.ok(String(data.source || '').trim(), 'source provenance');
  assert.ok(String(data.license || '').trim(), 'license provenance');
  assert.deepEqual(
    Array.from(data.target_dimensions_m || [], Number),
    SPEC.dimensions,
    'target_dimensions_m',
  );
}

function assertDimensions(root) {
  const size = visibleBounds(root).getSize(new THREE.Vector3());
  ['x', 'y', 'z'].forEach((axis, index) => {
    const [min, max] = SPEC.envelope[index];
    assert.ok(size[axis] >= min && size[axis] <= max,
      `${SPEC.id} ${axis} ${size[axis].toFixed(5)}m outside [${min}, ${max}]m`);
  });
}

function assertProductionMeshes(root) {
  root.traverse((object) => {
    if (!object.isMesh || isHelper(object)) return;
    assert.ok(object.geometry.attributes.normal, `${object.name} has normals`);
    assert.ok(object.geometry.attributes.uv, `${object.name} has UVs`);
    assert.ok(Math.abs(object.scale.x - 1) < 1e-5, `${object.name} applied X scale`);
    assert.ok(Math.abs(object.scale.y - 1) < 1e-5, `${object.name} applied Y scale`);
    assert.ok(Math.abs(object.scale.z - 1) < 1e-5, `${object.name} applied Z scale`);
  });
}

test('ref 48 GLB loads with exact metadata, dimensions and production budgets', async () => {
  const { gltf, root, audit } = await loadAsset();
  assert.ok(gltf.scene, 'Three.js scene exists');
  assertMetadata(root);
  assertDimensions(root);
  assertProductionMeshes(root);
  for (const metric of ['triangles', 'materials', 'textures', 'nodes']) {
    const [min, max] = SPEC.budget[metric];
    assert.ok(audit[metric] >= min && audit[metric] <= max,
      `${SPEC.id} ${metric} ${audit[metric]} outside [${min}, ${max}]`);
  }
  assert.equal(audit.cameras, 0, 'no exported camera');
  assert.equal(audit.lights, 0, 'no exported light');
});

test('ref 48 keeps every wall and flap on an independent authored pivot', async () => {
  const { root } = await loadAsset();
  exactNode(root, 'BOX_BASE');
  for (const side of ['FRONT', 'BACK', 'LEFT', 'RIGHT']) {
    const wall = exactNode(root, `BOX_WALL_${side}`);
    const flap = exactNode(root, `BOX_FLAP_${side}`);
    assert.equal(wall.isMesh, undefined, `${wall.name} is a transform pivot`);
    assert.equal(flap.isMesh, undefined, `${flap.name} is a transform pivot`);
    directChild(wall, `BOX_${side}`);
    directChild(flap, `FLAP_TOP_${side}`);
  }
});

test('ref 48 exposes cut tape, club-care labels, reinforcement and two long sockets', async () => {
  const { root } = await loadAsset();
  exactNode(root, 'TAPE_CENTER');
  for (let index = 1; index <= 12; index += 1) {
    exactNode(root, `TAPE_CENTER_SEG_${String(index).padStart(2, '0')}`);
  }
  const endTape = [];
  root.traverse((object) => { if (/^TAPE_(END|SIDE)_/.test(object.name || '')) endTape.push(object); });
  assert.ok(endTape.length >= 2, 'top tape has at least two end returns');

  for (const name of [
    'LABEL_MAIN', 'LABEL_SHIPPING', 'LABEL_DYNAMIC',
    'INSERT_BOTTOM', 'INSERT_SIDE_FRONT', 'INSERT_SIDE_BACK',
    'END_PADDING_LEFT', 'END_PADDING_RIGHT',
    'SHAFT_SUPPORT_01', 'SHAFT_SUPPORT_02', 'HEAD_SUPPORT_01', 'HEAD_SUPPORT_02',
  ]) exactNode(root, name);

  for (let index = 1; index <= 2; index += 1) {
    const slot = exactNode(root, `CONTENT_SLOT_${String(index).padStart(2, '0')}`);
    assert.equal(slot.isMesh, undefined, `${slot.name} is a transform socket`);
    const data = slot.userData || {};
    assert.match(String(data.allowed_category || ''), /clubs?/i, `${slot.name} accepts clubs`);
    assert.ok(Number(data.max_w) >= 1.18 && Number(data.max_w) <= 1.25, `${slot.name} long capacity`);
    assert.ok(Number(data.max_d) > 0 && Number(data.max_d) <= 0.16, `${slot.name} depth capacity`);
    assert.ok(Number(data.max_h) > 0 && Number(data.max_h) <= 0.16, `${slot.name} height capacity`);
    assert.ok(Number.isInteger(Number(data.stack_order)), `${slot.name} stack_order`);
    assert.ok(Number(data.visibility_threshold) >= 0 && Number(data.visibility_threshold) <= 1,
      `${slot.name} visibility_threshold`);
    assert.ok(Number.isInteger(Number(data.removal_order)), `${slot.name} removal_order`);
  }
});

test('ref 48 exposes simplified collisions, interactions and a long flat bundle', async () => {
  const { root } = await loadAsset();
  for (const name of ['COLLISION_CLOSED', 'COLLISION_OPEN']) {
    const collision = exactNode(root, name);
    assert.ok(collision.isMesh, `${name} is geometry`);
    assert.ok(trianglesOf(collision) <= 24, `${name} remains simplified`);
  }
  for (const name of ['INTERACTION_TARGET', 'CUT_PATH', 'VOLUME_CONTENTS']) exactNode(root, name);

  const flat = exactNode(root, 'BOX_FLAT_BUNDLE');
  for (const name of [
    'FLAT_PANEL_BASE', 'FLAT_PANEL_FRONT', 'FLAT_PANEL_BACK',
    'FLAT_PANEL_LEFT', 'FLAT_PANEL_RIGHT', 'FLAT_LABEL',
  ]) directChild(flat, name);
  const size = visibleBounds(flat).getSize(new THREE.Vector3());
  assert.ok(size.x >= 1.18 && size.x <= 1.256, `flat length ${size.x}`);
  assert.ok(size.y > 0.005 && size.y <= 0.05, `flat thickness ${size.y}`);
  assert.ok(size.z >= 0.14 && size.z <= 0.186, `flat depth ${size.z}`);
});

test('club shipment data and live model routing match exact ref 48 dimensions', () => {
  const driver = skuById('driver1');
  assert.strictEqual(boxKindFor(driver), BOX_KINDS.clubbox, 'drivers use clubbox');
  assert.deepEqual(boxDims(BOX_KINDS.clubbox), { w: 1.25, h: 0.18, d: 0.18 },
    'clubbox uses exact 125 x 18 x 18 cm dimensions');
  assert.equal(unitsPerBox(driver), 2, 'a standard club carton has two club sockets');
  assert.equal(DELIVERY_MODEL_BY_BOX_KIND.clubbox, SPEC.id,
    'live long cartons use delivery_golf_club_box');
});
