// Exact-dimension production contracts for the delivery packaging library.
// Every GLB is parsed through Three's runtime loader; this test deliberately
// validates authored hierarchy/extras instead of accepting filename placeholders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { auditGlb } from '../tools/qa/glb-audit.mjs';
import {
  PACKAGING_LAYOUTS,
  PACKAGING_SHELLS,
  PRODUCT_PACKAGING,
} from '../src/data/productPackaging.js';


const SPECS = Object.freeze({
  delivery_accessory_carton: Object.freeze({
    kind: 'carton', dimensions: [0.42, 0.36, 0.30], segments: 8,
    layouts: Object.freeze({
      ACCESSORY_CARD12: Object.freeze({ capacity: 12, category: 'accessories', grid: [2, 2, 3] }),
      GLOVE8: Object.freeze({ capacity: 8, category: 'apparel:glove', grid: [2, 4, 1] }),
      RANGE4: Object.freeze({ capacity: 4, category: 'accessories:rangefinder', grid: [2, 2, 1] }),
    }),
  }),
  delivery_golf_ball_case: Object.freeze({
    kind: 'ballcase', dimensions: [0.52, 0.42, 0.34], segments: 8,
    layouts: Object.freeze({ BALL12: Object.freeze({ capacity: 12, category: 'balls', grid: [3, 2, 2] }) }),
  }),
  delivery_shoe_carton: Object.freeze({
    kind: 'shoebox', dimensions: [0.58, 0.44, 0.32], segments: 8,
    layouts: Object.freeze({ SHOE4: Object.freeze({ capacity: 4, category: 'apparel:shoes', grid: [2, 2, 1] }) }),
  }),
  delivery_golf_bag_carton: Object.freeze({
    kind: 'bagcarton', dimensions: [0.72, 0.52, 1.05], segments: 12,
    layouts: Object.freeze({ BAG1: Object.freeze({ capacity: 1, category: 'accessories:golf_bag', grid: [1, 1, 1] }) }),
  }),
  delivery_fixture_package: Object.freeze({
    kind: 'fixture', dimensions: [0.62, 0.40, 0.55], segments: 8, fragile: true,
    layouts: Object.freeze({ FIXTURE1: Object.freeze({ capacity: 1, category: 'supplies:fixture', grid: [1, 1, 1] }) }),
  }),
  delivery_furniture_crate: Object.freeze({
    kind: 'crate', dimensions: [1.25, 0.85, 0.98], segments: 12, fragile: true,
    layouts: Object.freeze({ FURNITURE1: Object.freeze({ capacity: 1, category: 'decor:furniture', grid: [1, 1, 1] }) }),
  }),
  delivery_bulk_provisions_carton: Object.freeze({
    kind: 'provisions', dimensions: [0.50, 0.38, 0.30], segments: 8,
    layouts: Object.freeze({
      DRINK12: Object.freeze({ capacity: 12, category: 'provisions:drink', grid: [4, 1, 3] }),
      SNACK12: Object.freeze({ capacity: 12, category: 'provisions:snack', grid: [3, 1, 4] }),
    }),
  }),
  delivery_umbrella_carton: Object.freeze({
    kind: 'umbrella', dimensions: [0.92, 0.38, 0.28], segments: 12,
    layouts: Object.freeze({ UMBRELLA6: Object.freeze({ capacity: 6, category: 'accessories:umbrella', grid: [1, 2, 3] }) }),
  }),
  delivery_iron_set_carton: Object.freeze({
    kind: 'ironset', dimensions: [1.12, 0.24, 0.24], segments: 12, fragile: true,
    layouts: Object.freeze({ IRONSET1: Object.freeze({ capacity: 1, category: 'clubs:iron_set', grid: [1, 1, 1] }) }),
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


const loaded = new Map();

async function loadAsset(id) {
  if (!loaded.has(id)) {
    loaded.set(id, (async () => {
      const url = new URL(`../vendor/models/clubhouse/${id}.glb`, import.meta.url);
      const bytes = await readFile(url);
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const gltf = await new Promise((resolve, reject) => makeLoader().parse(data, '', resolve, reject));
      const root = gltf.scene.getObjectByName(id);
      assert.ok(root, `${id} exposes its exact production root`);
      return { gltf, root, audit: auditGlb(fileURLToPath(url)) };
    })());
  }
  return loaded.get(id);
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


function trianglesOf(root) {
  let triangles = 0;
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    const positions = object.geometry.attributes.position;
    const count = object.geometry.index ? object.geometry.index.count : positions?.count || 0;
    triangles += Math.floor(count / 3);
  });
  return triangles;
}


function parseJsonArray(value, label) {
  assert.equal(typeof value, 'string', `${label} is serialized deterministically`);
  const parsed = JSON.parse(value);
  assert.ok(Array.isArray(parsed), `${label} parses as an array`);
  return parsed;
}


function distinctPositions(sockets, axis) {
  return new Set(sockets.map((socket) => socket.position[axis].toFixed(4))).size;
}


test('every packaging shell has editable source, loadable GLB, exact dimensions and production budgets', async () => {
  for (const [id, spec] of Object.entries(SPECS)) {
    await access(new URL(`../asset_sources/blender/delivery/${id}.blend`, import.meta.url));
    const { gltf, root, audit } = await loadAsset(id);
    assert.ok(gltf.scene, `${id} has a Three.js scene`);

    const data = root.userData || {};
    assert.equal(data.asset_id, id, `${id} asset_id`);
    assert.equal(data.physical_shell_id, id, `${id} physical_shell_id`);
    assert.equal(data.box_kind, spec.kind, `${id} box_kind`);
    assert.match(String(data.units || ''), /^(m|metres?|meters?)$/i, `${id} metre units`);
    assert.equal(data.target_dimensions_order, 'width_depth_height', `${id} metadata dimension order`);
    assert.deepEqual(Array.from(data.target_dimensions_m || [], Number), spec.dimensions, `${id} target dimensions`);
    assert.match(String(data.source || ''), /Original Pinehollow/i, `${id} source provenance`);
    assert.match(String(data.license || ''), /Project-owned/i, `${id} license provenance`);
    assert.deepEqual(parseJsonArray(data.external_assets, `${id} external_assets`), [], `${id} has no external dependency`);

    // glTF is Y-up: metadata [width, depth, height] becomes visible [X, Z, Y].
    const size = visibleBounds(root).getSize(new THREE.Vector3());
    const runtimeExpected = [spec.dimensions[0], spec.dimensions[2], spec.dimensions[1]];
    for (const [index, axis] of ['x', 'y', 'z'].entries()) {
      assert.ok(Math.abs(size[axis] - runtimeExpected[index]) <= 0.009,
        `${id} ${axis} ${size[axis].toFixed(5)}m differs from ${runtimeExpected[index]}m`);
    }

    assert.ok(audit.triangles >= 1500 && audit.triangles <= 15000,
      `${id} triangles ${audit.triangles} stay within production budget`);
    assert.ok(audit.materials >= 5 && audit.materials <= 10,
      `${id} materials ${audit.materials} stay within production budget`);
    assert.equal(audit.textures, 0, `${id} has no missing external texture dependency`);
    assert.ok(audit.nodes >= 50 && audit.nodes <= 150, `${id} node count ${audit.nodes}`);
    assert.equal(audit.cameras, 0, `${id} exports no camera`);
    assert.equal(audit.lights, 0, `${id} exports no light`);

    root.traverse((object) => {
      if (!object.isMesh || isHelper(object)) return;
      assert.ok(object.geometry.attributes.normal, `${id}/${object.name} has normals`);
      assert.ok(object.geometry.attributes.uv, `${id}/${object.name} has UVs`);
      assert.ok(Math.abs(object.scale.x - 1) < 1e-5, `${id}/${object.name} applied X scale`);
      assert.ok(Math.abs(object.scale.y - 1) < 1e-5, `${id}/${object.name} applied Y scale`);
      assert.ok(Math.abs(object.scale.z - 1) < 1e-5, `${id}/${object.name} applied Z scale`);
    });
  }
});


test('every shell exposes independent walls/flaps, segmented tape, permanent insert, labels and simple collisions', async () => {
  for (const [id, spec] of Object.entries(SPECS)) {
    const { root } = await loadAsset(id);
    exactNode(root, 'BOX_BASE');
    for (const side of ['FRONT', 'BACK', 'LEFT', 'RIGHT']) {
      const wall = exactNode(root, `BOX_WALL_${side}`);
      const flap = exactNode(root, `BOX_FLAP_${side}`);
      assert.equal(wall.isMesh, undefined, `${id}/${wall.name} is a pivot`);
      assert.equal(flap.isMesh, undefined, `${id}/${flap.name} is a pivot`);
      directChild(wall, `BOX_${side}`);
      directChild(flap, `FLAP_TOP_${side}`);
      assert.equal(wall.userData.pivot_kind, 'bottom_fold', `${id}/${wall.name} pivot metadata`);
      assert.equal(flap.userData.pivot_kind, 'top_fold', `${id}/${flap.name} pivot metadata`);
      if (side === 'FRONT') {
        assert.ok(Number(wall.userData.open_reveal_angle_deg) >= 80,
          `${id}/${wall.name} can lower the player sightline`);
        assert.equal(wall.userData.reveal_contents, true, `${id}/${wall.name} owns the reveal pose`);
      }
      assert.ok(Math.abs(Number(flap.userData.open_angle_deg)) >= 140,
        `${id}/${flap.name} clears the content view`);
    }

    const tape = exactNode(root, 'TAPE_CENTER');
    assert.equal(Number(tape.userData.segment_count), spec.segments, `${id} tape segment count`);
    for (let index = 1; index <= spec.segments; index += 1) {
      const segment = exactNode(root, `TAPE_CENTER_SEG_${String(index).padStart(2, '0')}`);
      assert.equal(Number(segment.userData.cut_order), index, `${id}/${segment.name} cut order`);
      assert.equal(segment.userData.separable, true, `${id}/${segment.name} separable`);
    }
    for (const name of ['TAPE_SIDE_FRONT', 'TAPE_SIDE_BACK', 'CUT_PATH']) exactNode(root, name);

    for (const name of ['LABEL_MAIN', 'LABEL_CATEGORY_TEXT', 'LABEL_SHIPPING', 'LABEL_DYNAMIC']) {
      exactNode(root, name);
    }
    if (spec.fragile) exactNode(root, 'LABEL_FRAGILE');
    const label = exactNode(root, 'LABEL_DYNAMIC');
    assert.equal(trianglesOf(label), 2, `${id} runtime shipping label remains one quad`);
    assert.ok(label.geometry.attributes.uv?.count === 4, `${id} runtime label has exact UV corners`);

    const insert = exactNode(root, 'INSERT_BOTTOM');
    assert.equal(insert.userData.permanent, true, `${id} bottom insert is permanent`);
    assert.equal(insert.userData.removal_allowed, false, `${id} bottom insert cannot be unpacked as stock`);
    assert.equal(insert.userData.persists_when_empty, true, `${id} bottom insert persists in empty state`);

    for (const name of ['COLLISION_CLOSED', 'COLLISION_OPEN']) {
      const collision = exactNode(root, name);
      assert.ok(collision.isMesh, `${id}/${name} is geometry`);
      assert.ok(trianglesOf(collision) <= 24, `${id}/${name} is a simplified proxy`);
    }
    for (const name of ['VOLUME_CONTENTS', 'INTERACTION_TARGET']) exactNode(root, name);
  }
});


test('content layout roots and exact sockets preserve quantity, fit and depletion metadata', async () => {
  const globalSocketNames = new Set();
  for (const [id, spec] of Object.entries(SPECS)) {
    const { root } = await loadAsset(id);
    const rootLayouts = parseJsonArray(root.userData.content_layouts, `${id} content_layouts`);
    assert.deepEqual(rootLayouts, Object.keys(spec.layouts), `${id} declares only its authored layouts`);

    for (const [layoutId, contract] of Object.entries(spec.layouts)) {
      const layoutRoot = exactNode(root, `CONTENT_LAYOUT_${layoutId}`);
      assert.equal(layoutRoot.isMesh, undefined, `${id}/${layoutId} is a transform group`);
      assert.equal(layoutRoot.parent, root, `${id}/${layoutId} is directly under its physical shell`);
      assert.equal(layoutRoot.userData.layout_id, layoutId, `${id}/${layoutId} id metadata`);
      assert.equal(Number(layoutRoot.userData.capacity), contract.capacity, `${id}/${layoutId} capacity`);
      assert.equal(layoutRoot.userData.allowed_category, contract.category, `${id}/${layoutId} category`);
      assert.ok(parseJsonArray(layoutRoot.userData.allowed_skus, `${id}/${layoutId} allowed_skus`).length > 0,
        `${id}/${layoutId} names its real SKU set`);
      assert.ok(String(layoutRoot.userData.packaging_state || '').length > 4,
        `${id}/${layoutId} packaging state`);
      assert.equal(layoutRoot.userData.selection_rule,
        'exact_sku_category_quantity_dimensions_packaging_state', `${id}/${layoutId} selection contract`);

      const sockets = [];
      for (let index = 1; index <= contract.capacity; index += 1) {
        const name = `CONTENT_SLOT_${layoutId}_${String(index).padStart(2, '0')}`;
        const socket = directChild(layoutRoot, name);
        assert.equal(socket.isMesh, undefined, `${id}/${name} is an authored transform socket`);
        assert.equal(globalSocketNames.has(name), false, `${name} is globally unique by layout id`);
        globalSocketNames.add(name);
        const data = socket.userData || {};
        assert.equal(data.layout_id, layoutId, `${id}/${name} layout id`);
        assert.equal(Number(data.slot_index), index, `${id}/${name} slot index`);
        assert.equal(data.allowed_category, contract.category, `${id}/${name} allowed category`);
        assert.ok(parseJsonArray(data.allowed_skus, `${id}/${name} allowed_skus`).length > 0,
          `${id}/${name} allowed SKU set`);
        assert.ok(String(data.packaging_state || '').length > 4, `${id}/${name} packed state`);
        for (const key of ['max_w', 'max_d', 'max_h']) {
          assert.ok(Number(data[key]) > 0, `${id}/${name} ${key}`);
        }
        assert.match(String(data.display_state || ''), /^opened_/, `${id}/${name} display state`);
        assert.equal(Number(data.stack_order), index, `${id}/${name} stack order`);
        assert.ok(Number.isInteger(Number(data.stack_layer)), `${id}/${name} stack layer`);
        assert.ok(Number(data.visibility_threshold) >= 0 && Number(data.visibility_threshold) <= 1,
          `${id}/${name} visibility threshold`);
        assert.ok(Number.isInteger(Number(data.removal_order)), `${id}/${name} removal order`);
        sockets.push(socket);
      }
      assert.deepEqual(
        [distinctPositions(sockets, 'x'), distinctPositions(sockets, 'y'), distinctPositions(sockets, 'z')],
        contract.grid,
        `${id}/${layoutId} exact runtime X/height/depth grid`,
      );
    }
  }
});


test('authoritative special grids and fit envelopes stay exact', async () => {
  const { root: accessory } = await loadAsset('delivery_accessory_carton');
  const gloveSocket = exactNode(accessory, 'CONTENT_SLOT_GLOVE8_01');
  assert.deepEqual(
    parseJsonArray(gloveSocket.userData.authored_rotation_rad, 'GLOVE8 rotation'),
    [0, 0, 1.570796],
    'flat glove sleeves rotate into the authored 180 mm width / 230 mm depth cell',
  );

  const { root: balls } = await loadAsset('delivery_golf_ball_case');
  const ballSockets = Array.from({ length: 12 }, (_, index) =>
    exactNode(balls, `CONTENT_SLOT_BALL12_${String(index + 1).padStart(2, '0')}`));
  assert.deepEqual([...new Set(ballSockets.map((socket) => socket.position.x.toFixed(3)))], ['-0.160', '0.000', '0.160']);
  assert.deepEqual(new Set(ballSockets.map((socket) => Math.abs(socket.position.z).toFixed(3))), new Set(['0.075']));
  assert.deepEqual([...new Set(ballSockets.map((socket) => socket.position.y.toFixed(3)))], ['0.045', '0.125']);

  const { root: drinks } = await loadAsset('delivery_bulk_provisions_carton');
  const drinkSockets = Array.from({ length: 12 }, (_, index) =>
    exactNode(drinks, `CONTENT_SLOT_DRINK12_${String(index + 1).padStart(2, '0')}`));
  assert.equal(distinctPositions(drinkSockets, 'x'), 4, 'DRINK12 uses four bottle columns');
  assert.equal(distinctPositions(drinkSockets, 'z'), 3, 'DRINK12 uses three bottle rows');
  assert.equal(distinctPositions(drinkSockets, 'y'), 1, 'DRINK12 bottles are one upright layer');
  drinkSockets.forEach((socket) => {
    assert.equal(Number(socket.userData.max_h), 0.23, `${socket.name} accepts the sealed bottle height`);
    assert.equal(socket.userData.display_state, 'opened_upright', `${socket.name} stays upright`);
  });

  const { root: shoes } = await loadAsset('delivery_shoe_carton');
  assert.deepEqual(
    parseJsonArray(exactNode(shoes, 'CONTENT_SLOT_SHOE4_01').userData.authored_rotation_rad, 'SHOE4 rotation'),
    [0, 0, 1.570796],
    'shoe pairs turn lengthwise into their retail cells without scaling',
  );

  const { root: bag } = await loadAsset('delivery_golf_bag_carton');
  const bagSocket = exactNode(bag, 'CONTENT_SLOT_BAG1_01');
  assert.deepEqual(
    parseJsonArray(bagSocket.userData.authored_rotation_rad, 'BAG1 rotation'),
    [0, -1.570796, 0],
    'the full-size bag stands vertically in its fitted carton',
  );
  assert.equal(
    Number(bagSocket.position.y.toFixed(3)),
    0.680,
    'the fitted foam pedestal holds the bag top within 10 mm of the open carton rim',
  );
  assert.equal(exactNode(bag, 'BAG_FOAM_BLOCK_01').userData.support_role, 'bag_base_riser');
  assert.equal(exactNode(bag, 'BAG_FOAM_BLOCK_02').userData.support_role, 'bag_upper_side_restraint');
  assert.equal(exactNode(bag, 'BAG_FOAM_BLOCK_03').userData.support_role, 'bag_upper_side_restraint');
  const bagSpec = PRODUCT_PACKAGING.bag1;
  const bagCenter = bagSocket.getWorldPosition(new THREE.Vector3()).y;
  const bagTop = bagCenter + bagSpec.physicalDimensions.w / 2;
  const bagBottom = bagCenter - bagSpec.physicalDimensions.w / 2;
  const rim = SPECS.delivery_golf_bag_carton.dimensions[2];
  assert.ok(bagTop <= rim && rim - bagTop <= 0.012,
    `BAG1 top clearance ${(rim - bagTop).toFixed(4)}m stays within its fitted rim`);
  const riserTop = visibleBounds(exactNode(bag, 'BAG_FOAM_BLOCK_01')).max.y;
  assert.ok(Math.abs(riserTop - bagBottom) <= 0.003,
    `BAG1 riser meets the bag base within 3 mm (${riserTop.toFixed(4)} vs ${bagBottom.toFixed(4)})`);
  const bagHalfWidth = bagSpec.physicalDimensions.h / 2;
  const leftRestraintInner = visibleBounds(exactNode(bag, 'BAG_FOAM_BLOCK_02')).max.x;
  const rightRestraintInner = visibleBounds(exactNode(bag, 'BAG_FOAM_BLOCK_03')).min.x;
  assert.ok(leftRestraintInner <= -bagHalfWidth && -bagHalfWidth - leftRestraintInner <= 0.012,
    'BAG1 left restraint holds the upper bag with no more than 12 mm clearance');
  assert.ok(rightRestraintInner >= bagHalfWidth && rightRestraintInner - bagHalfWidth <= 0.012,
    'BAG1 right restraint holds the upper bag with no more than 12 mm clearance');

  const { root: umbrella } = await loadAsset('delivery_umbrella_carton');
  for (let index = 1; index <= 6; index += 1) {
    const socket = exactNode(umbrella, `CONTENT_SLOT_UMBRELLA6_${String(index).padStart(2, '0')}`);
    assert.equal(Number(socket.userData.max_w), 0.87, `${socket.name} fits the sleeved .84m umbrella without scaling`);
  }

  const { root: ironSet } = await loadAsset('delivery_iron_set_carton');
  const ironSocket = exactNode(ironSet, 'CONTENT_SLOT_IRONSET1_01');
  assert.ok(Number(ironSocket.userData.max_w) >= 1.04, 'IRONSET1 fits both exact catalog set lengths');
  assert.deepEqual(parseJsonArray(ironSocket.userData.allowed_skus, 'IRONSET1 SKUs'), ['irons1', 'irons2']);
});


test('authored socket envelopes and allowed SKU sets exactly match the packaging contract', async () => {
  const shellByModel = new Map(Object.values(PACKAGING_SHELLS).map((shell) => [shell.modelId, shell]));
  for (const [modelId, spec] of Object.entries(SPECS)) {
    const { root } = await loadAsset(modelId);
    const shell = shellByModel.get(modelId);
    assert.ok(shell, `${modelId} is registered as a packaging shell`);
    for (const layoutId of Object.keys(spec.layouts)) {
      const contract = PACKAGING_LAYOUTS[layoutId];
      assert.ok(contract, `${modelId}/${layoutId} is registered as a packaging layout`);
      assert.equal(contract.shellId, shell.id, `${modelId}/${layoutId} uses its exact physical shell`);
      const expectedSkus = Object.values(PRODUCT_PACKAGING)
        .filter((entry) => entry.layoutId === layoutId)
        .map((entry) => entry.skuId)
        .sort();
      const layoutRoot = exactNode(root, `CONTENT_LAYOUT_${layoutId}`);
      assert.deepEqual(
        parseJsonArray(layoutRoot.userData.allowed_skus, `${layoutId} allowed SKUs`).sort(),
        expectedSkus,
        `${modelId}/${layoutId} names every and only contracted SKU`,
      );
      for (let index = 1; index <= contract.capacity; index += 1) {
        const socket = exactNode(root, `CONTENT_SLOT_${layoutId}_${String(index).padStart(2, '0')}`);
        assert.equal(Number(socket.userData.max_w), contract.slotMaxDimensions.w, `${socket.name} width clearance`);
        assert.equal(Number(socket.userData.max_h), contract.slotMaxDimensions.h, `${socket.name} height clearance`);
        assert.equal(Number(socket.userData.max_d), contract.slotMaxDimensions.d, `${socket.name} depth clearance`);
      }
    }
  }
});
