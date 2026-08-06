// Asset Sheet 03, ref 27: the authored retail shoe box stocked on the shoe wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { auditGlb } from '../tools/qa/glb-audit.mjs';

const SPEC = Object.freeze({
  id: 'checkout_product_shoe_box',
  authorDimensions: Object.freeze([0.310, 0.190, 0.115]),
  runtimeDimensions: Object.freeze([0.310, 0.115, 0.190]),
});

let loaded;

async function loadAsset() {
  if (!loaded) {
    loaded = (async () => {
      const url = new URL(`../vendor/models/clubhouse/${SPEC.id}.glb`, import.meta.url);
      const bytes = await readFile(url);
      assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'runtime export is a binary glTF');
      assert.equal(bytes.readUInt32LE(4), 2, 'runtime export uses glTF 2');
      assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB header length covers the complete file');
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
      const root = gltf.scene.getObjectByName(SPEC.id);
      assert.ok(root, 'exact named product root survives runtime reimport');
      return { gltf, root, audit: auditGlb(fileURLToPath(url)) };
    })();
  }
  return loaded;
}

function exactNode(root, name) {
  const object = root.getObjectByName(name);
  assert.ok(object, `${SPEC.id} missing ${name}`);
  return object;
}

function visibleBounds(root) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry || object.name.startsWith('COL_')) return;
    object.geometry.computeBoundingBox?.();
    if (object.geometry.boundingBox) {
      bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return bounds;
}

test('ref 27 retail shoe box ships exact scale, provenance, pivot and production budgets', async () => {
  const { gltf, root, audit } = await loadAsset();
  assert.ok(gltf.scene);
  assert.equal(root.userData.asset_id, SPEC.id);
  // v3: the 2026-08-06 rebuild that removed the twelve printed barcode bars
  assert.equal(root.userData.asset_version, 3);
  assert.equal(root.userData.units, 'meters');
  assert.deepEqual(Array.from(root.userData.target_dimensions_m || [], Number), SPEC.authorDimensions);
  assert.equal(root.userData.fictional_brand, 'Fairhollow Golf');
  assert.equal(root.userData.product_kind, 'retail shoe box');
  assert.equal(root.userData.separate_lid, true);
  assert.equal(root.userData.pivot, undefined, 'reserved GLTFLoader pivot metadata is not repurposed');
  assert.equal(root.userData.pivot_description, 'base-centre shelf contact at local Z=0');
  assert.match(String(root.userData.source || ''), /generated in-repository/i);
  assert.match(String(root.userData.license || ''), /project-owned/i);

  const bounds = visibleBounds(root);
  const size = bounds.getSize(new THREE.Vector3()).toArray();
  size.forEach((value, index) => assert.ok(
    Math.abs(value - SPEC.runtimeDimensions[index]) <= 0.0015,
    `runtime axis ${index} is ${value.toFixed(5)}m instead of ${SPEC.runtimeDimensions[index]}m`,
  ));
  assert.ok(Math.abs(bounds.min.y) <= 0.0005, 'base-contact pivot rests on runtime Y=0');

  assert.ok(audit.triangles >= 1200 && audit.triangles <= 3500,
    `${audit.triangles} triangles remains suitable for repeated shelf stock`);
  // 24..34 counted the twelve printed barcode bars as purposeful nodes; with
  // the code removed the box is 16 nodes of actual packaging.
  assert.ok(audit.nodes >= 14 && audit.nodes <= 24, `${audit.nodes} purposeful nodes`);
  assert.ok(audit.materials >= 4 && audit.materials <= 7, `${audit.materials} palette materials`);
  assert.equal(audit.textures, 0, 'geometric label adds no repeated texture allocation');
  assert.equal(audit.animations, 0);
  assert.equal(audit.cameras, 0);
  assert.equal(audit.lights, 0);
  assert.deepEqual(audit.flags, []);
});

test('ref 27 keeps a separate lid, Fairhollow label, barcode, grip and collision contracts', async () => {
  const { root } = await loadAsset();
  const base = exactNode(root, 'ShoeBoxBase');
  const lid = exactNode(root, 'ShoeBoxLid');
  const label = exactNode(root, 'ShoeBoxFrontLabel');
  const sizeBadge = exactNode(root, 'ShoeBoxSizeBadge');
  assert.equal(base.parent, root);
  assert.equal(base.userData.component, 'retail_carton_base');
  assert.equal(lid.parent, root);
  assert.equal(lid.userData.component, 'removable_lid');
  assert.equal(label.userData.label_role, 'brand_size');
  assert.equal(label.userData.label_facing, '-Y');
  assert.equal(sizeBadge.userData.size_us, '10');
  for (const node of ['ShoeBoxLidTopPanel', 'ShoeBoxLidCrest_L', 'ShoeBoxLidCrest_R',
    'ShoeBoxBrand', 'ShoeBoxModel', 'ShoeBoxFit', 'ShoeBoxSize']) exactNode(root, node);
  // TAGS (2026-08-06): this used to REQUIRE twelve printed barcode bars on the
  // shoe box's front label. That is the same shape of assertion that let the
  // checkout sticker survive two "tags removed" reports — a test written to
  // demand the thing being removed. Inverted: no printed code, by any name.
  for (let index = 1; index <= 12; index += 1) {
    assert.equal(root.getObjectByName(`ShoeBoxBarcodeBar_${String(index).padStart(2, '0')}`),
      undefined, 'the shoe box carries no printed barcode bars');
  }

  const barcode = exactNode(root, 'ANCHOR_ProductBarcode');
  assert.equal(barcode.userData.anchor, true);
  assert.equal(barcode.userData.anchor_kind, 'barcode');
  assert.equal(barcode.userData.surface, 'carton-side');
  assert.equal(Number(barcode.userData.label_width_m), 0.068);
  assert.equal(Number(barcode.userData.label_height_m), 0.034);
  assert.ok(barcode.position.toArray().every(Number.isFinite));

  const grip = exactNode(root, 'ANCHOR_ProductGripPrimary');
  assert.equal(grip.userData.anchor_kind, 'grip');
  assert.equal(grip.userData.hand, 'primary');
  const collision = exactNode(root, 'COL_Product');
  assert.equal(collision.userData.collision_proxy, true);
  assert.equal(collision.userData.shape, 'box');

  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    assert.ok(object.matrixWorld.elements.every(Number.isFinite), `${object.name} has a finite world matrix`);
    if (!object.isMesh) return;
    assert.deepEqual(object.scale.toArray(), [1, 1, 1], `${object.name} exports applied scale`);
    assert.ok(object.geometry.attributes.position, `${object.name} has positions`);
    assert.ok(object.geometry.attributes.normal, `${object.name} has normals`);
    assert.ok(object.geometry.attributes.uv, `${object.name} has UVs`);
  });
});

test('ref 27 generated source, studio preview, and runtime loader registration are present', async () => {
  const [blend, preview, merchSource] = await Promise.all([
    readFile(new URL('../asset_sources/blender/cash_register/checkout_product_shoe_box.blend', import.meta.url)),
    readFile(new URL('../Assets/checkout/previews/checkout_product_shoe_box.png', import.meta.url)),
    readFile(new URL('../src/render3d/clubhouse/merch.js', import.meta.url), 'utf8'),
  ]);
  assert.ok(blend.length > 100_000, 'compressed editable Blender source is non-empty');
  assert.deepEqual(Array.from(preview.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], 'preview is PNG');
  assert.equal(preview.readUInt32BE(16), 1100);
  assert.equal(preview.readUInt32BE(20), 1100);
  assert.equal([...merchSource.matchAll(/'checkout_product_shoe_box'/g)].length, 1,
    'runtime merchandise preload registers the shoe box exactly once');
});
