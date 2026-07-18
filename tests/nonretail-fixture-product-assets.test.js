// Dependency-free contracts for the five packed, nonretail FIXTURE1 products.
// Node parses the GLB container and glTF hierarchy directly so CI verifies the
// shipped geometry, dimensions, sockets, packing semantics, and provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { productPackagingFor } from '../src/data/productPackaging.js';


const SPECS = Object.freeze({
  delivery_fixture_product_vacuum: Object.freeze({
    logicalSku: 'vac1',
    authorDimensions: Object.freeze([0.58, 0.37, 0.36]),
    runtimeDimensions: Object.freeze([0.58, 0.36, 0.37]),
    physicalDimensions: Object.freeze([0.42, 0.68, 0.38]),
    packingState: 'hose-and-wand-detached-in-moulded-insert',
    packingOrientation: 'motor-base-on-side',
    placementFixture: 'restoration-bay',
    fragile: false,
    collision: 'COL_VAC1_PACKED',
    required: Object.freeze([
      'VAC_MOULDED_INSERT',
      'VAC_MOTOR_CANISTER_SIDE_PACKED',
      'VAC_DETACHED_WAND',
      'VAC_HOSE_COIL',
      'VAC_CREVICE_NOZZLE',
      'VAC_TOP_END_BRACE',
      'VAC_TOP_END_BRACE_NECK',
    ]),
  }),
  delivery_fixture_product_plant: Object.freeze({
    logicalSku: 'plant1',
    authorDimensions: Object.freeze([0.34, 0.34, 0.28]),
    runtimeDimensions: Object.freeze([0.34, 0.28, 0.34]),
    physicalDimensions: Object.freeze([0.35, 0.65, 0.35]),
    packingState: 'crown-netted-and-pot-braced',
    packingOrientation: 'pot-upright',
    placementFixture: 'decor-floor',
    fragile: false,
    collision: 'COL_PLANT1_PACKED',
    required: Object.freeze([
      'PLANT_POT',
      'PLANT_CROWN_COMPRESSED',
      'PLANT_CROWN_NET',
      'PLANT_POT_BRACE_RING',
      'PLANT_MOULDED_INSERT',
    ]),
  }),
  delivery_fixture_product_poster: Object.freeze({
    logicalSku: 'poster1',
    authorDimensions: Object.freeze([0.56, 0.37, 0.07]),
    runtimeDimensions: Object.freeze([0.56, 0.07, 0.37]),
    physicalDimensions: Object.freeze([0.52, 0.04, 0.36]),
    packingState: 'framed-face-protected-with-corner-blocks',
    packingOrientation: 'frame-on-edge',
    placementFixture: 'decor-wall',
    fragile: true,
    collision: 'COL_POSTER1_PACKED',
    required: Object.freeze([
      'POSTER_FRAME',
      'POSTER_COURSE_ART',
      'POSTER_FACE_PROTECTOR',
      'POSTER_CORNER_PROTECTOR_NW',
      'POSTER_CORNER_PROTECTOR_NE',
      'POSTER_CORNER_PROTECTOR_SW',
      'POSTER_CORNER_PROTECTOR_SE',
    ]),
  }),
  delivery_fixture_product_events_board: Object.freeze({
    logicalSku: 'board1',
    authorDimensions: Object.freeze([0.58, 0.36, 0.10]),
    runtimeDimensions: Object.freeze([0.58, 0.10, 0.36]),
    physicalDimensions: Object.freeze([0.58, 0.06, 0.42]),
    packingState: 'rail-detached-with-corner-blocks',
    packingOrientation: 'board-on-edge',
    placementFixture: 'decor-wall',
    fragile: false,
    collision: 'COL_BOARD1_PACKED',
    required: Object.freeze([
      'EVENTS_BOARD',
      'EVENTS_BOARD_CORK_FACE',
      'BOARD_DETACHED_RAIL',
      'BOARD_CORNER_BLOCK_NW',
      'BOARD_CORNER_BLOCK_NE',
      'BOARD_CORNER_BLOCK_SW',
      'BOARD_CORNER_BLOCK_SE',
    ]),
  }),
  delivery_fixture_product_pendant: Object.freeze({
    logicalSku: 'light1',
    authorDimensions: Object.freeze([0.36, 0.36, 0.32]),
    runtimeDimensions: Object.freeze([0.36, 0.32, 0.36]),
    physicalDimensions: Object.freeze([0.36, 0.48, 0.36]),
    packingState: 'stem-detached-shade-in-foam-ring',
    packingOrientation: 'shade-upright',
    placementFixture: 'decor-ceiling',
    fragile: true,
    collision: 'COL_LIGHT1_PACKED',
    required: Object.freeze([
      'PENDANT_SHADE',
      'PENDANT_SHADE_RIM',
      'PENDANT_FOAM_RING',
      'PENDANT_DETACHED_STEM',
      'PENDANT_CEILING_CANOPY',
      'PENDANT_TOP_FOAM_BRACE',
      'PENDANT_STEM_END_CLIP',
    ]),
  }),
});


function glbPath(assetId) {
  return fileURLToPath(new URL(`../vendor/models/clubhouse/${assetId}.glb`, import.meta.url));
}


function parseGlb(assetId) {
  const bytes = readFileSync(glbPath(assetId));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${assetId} GLB magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${assetId} glTF version`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${assetId} complete GLB length`);
  let json = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(bytes.subarray(offset + 8, offset + 8 + chunkLength).toString('utf8'));
    }
    offset += 8 + chunkLength;
  }
  assert.ok(json, `${assetId} JSON chunk`);
  return { bytes, json };
}


function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}


function localMatrix(node) {
  if (node.matrix) return [...node.matrix];
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const xx = x * x; const yy = y * y; const zz = z * z;
  const xy = x * y; const xz = x * z; const yz = y * z;
  const xw = x * w; const yw = y * w; const zw = z * w;
  return [
    (1 - 2 * (yy + zz)) * sx, (2 * (xy + zw)) * sx, (2 * (xz - yw)) * sx, 0,
    (2 * (xy - zw)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + xw)) * sy, 0,
    (2 * (xz + yw)) * sz, (2 * (yz - xw)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}


function multiply(a, b) {
  const result = Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[column * 4 + row] += a[index * 4 + row] * b[column * 4 + index];
      }
    }
  }
  return result;
}


function transformPoint(matrix, [x, y, z]) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}


function worldMatrices(json) {
  const result = new Map();
  const roots = json.scenes?.[json.scene || 0]?.nodes || [];
  function visit(index, parentMatrix) {
    const world = multiply(parentMatrix, localMatrix(json.nodes[index]));
    result.set(index, world);
    for (const child of json.nodes[index].children || []) visit(child, world);
  }
  for (const index of roots) visit(index, identity());
  return result;
}


function visibleBounds(json) {
  const matrices = worldMatrices(json);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  json.nodes.forEach((node, nodeIndex) => {
    if (node.mesh === undefined || /^(COL_|COLLISION_|VOLUME_)/.test(node.name || '')) return;
    const matrix = matrices.get(nodeIndex);
    assert.ok(matrix, `${node.name} belongs to the exported scene`);
    for (const primitive of json.meshes[node.mesh].primitives || []) {
      const accessor = json.accessors[primitive.attributes.POSITION];
      assert.ok(accessor?.min && accessor?.max, `${node.name} POSITION bounds`);
      for (const x of [accessor.min[0], accessor.max[0]]) {
        for (const y of [accessor.min[1], accessor.max[1]]) {
          for (const z of [accessor.min[2], accessor.max[2]]) {
            const point = transformPoint(matrix, [x, y, z]);
            for (let axis = 0; axis < 3; axis += 1) {
              min[axis] = Math.min(min[axis], point[axis]);
              max[axis] = Math.max(max[axis], point[axis]);
            }
          }
        }
      }
    }
  });
  return { min, max, dimensions: max.map((value, axis) => value - min[axis]) };
}


function triangleCount(json, predicate = () => true) {
  let triangles = 0;
  json.nodes.forEach((node) => {
    if (node.mesh === undefined || !predicate(node)) return;
    for (const primitive of json.meshes[node.mesh].primitives || []) {
      assert.equal(primitive.mode ?? 4, 4, `${node.name} triangle primitive`);
      const count = primitive.indices === undefined
        ? json.accessors[primitive.attributes.POSITION].count
        : json.accessors[primitive.indices].count;
      triangles += Math.floor(count / 3);
    }
  });
  return triangles;
}


function assertNearArray(actual, expected, tolerance, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= tolerance,
      `${label}[${index}] ${value.toFixed(6)} outside ${expected[index]} +/- ${tolerance}`);
  });
}


const parsed = new Map(Object.keys(SPECS).map((assetId) => [assetId, parseGlb(assetId)]));


test('nonretail fixture products expose exact SKU roots and truthful 1:1 packed dimensions', () => {
  for (const [assetId, spec] of Object.entries(SPECS)) {
    const { json } = parsed.get(assetId);
    const packaging = productPackagingFor(spec.logicalSku);
    assert.equal(packaging.layoutId, 'FIXTURE1', `${spec.logicalSku} remains a FIXTURE1 product`);
    assert.equal(packaging.packing.allowScale, false);
    assert.equal(packaging.packing.contentScale, 1);
    assertNearArray(
      [packaging.packing.dimensions.w, packaging.packing.dimensions.d, packaging.packing.dimensions.h],
      spec.authorDimensions,
      1e-9,
      `${spec.logicalSku} author dimensions match productPackaging.js`,
    );
    assertNearArray(
      [packaging.packing.dimensions.w, packaging.packing.dimensions.h, packaging.packing.dimensions.d],
      spec.runtimeDimensions,
      1e-9,
      `${spec.logicalSku} runtime dimensions match productPackaging.js`,
    );
    assertNearArray(
      [packaging.physicalDimensions.w, packaging.physicalDimensions.h, packaging.physicalDimensions.d],
      spec.physicalDimensions,
      1e-9,
      `${spec.logicalSku} physical dimensions match productPackaging.js`,
    );
    const root = json.nodes.find((node) => node.name === assetId);
    assert.ok(root, `${assetId} exact root`);
    const metadata = root.extras || {};
    assert.equal(metadata.asset_id, assetId);
    assert.equal(metadata.logical_sku, spec.logicalSku);
    assert.equal(metadata.asset_type, 'nonretail_fixture_product_packed');
    assert.equal(metadata.allow_runtime_scale, false);
    assert.equal(metadata.content_scale, 1);
    assert.equal(metadata.license, 'Project-owned / UNLICENSED');
    assert.equal(metadata.external_assets, 0);
    assert.equal(metadata.packing_state, spec.packingState);
    assert.equal(metadata.packing_orientation, spec.packingOrientation);
    assert.equal(metadata.placement_fixture, spec.placementFixture);
    assert.equal(metadata.fragile, spec.fragile);
    assertNearArray(metadata.packed_dimensions_author_m, spec.authorDimensions, 1e-9, `${assetId} author metadata`);
    assertNearArray(metadata.runtime_dimensions_m, spec.runtimeDimensions, 1e-9, `${assetId} runtime metadata`);
    assertNearArray(metadata.physical_dimensions_runtime_m, spec.physicalDimensions, 1e-9, `${assetId} physical metadata`);
    const bounds = visibleBounds(json);
    assertNearArray(bounds.dimensions, spec.runtimeDimensions, 0.001, `${assetId} shipped visible dimensions`);
    assert.ok(Math.abs(bounds.min[1]) <= 0.001, `${assetId} rests on runtime Y=0`);
  }
});


test('nonretail fixture products retain required packed components, direct sockets, and simple collisions', () => {
  for (const [assetId, spec] of Object.entries(SPECS)) {
    const { json } = parsed.get(assetId);
    const byName = new Map(json.nodes.map((node) => [node.name, node]));
    for (const name of spec.required) assert.ok(byName.has(name), `${assetId} missing ${name}`);
    const rootIndex = json.nodes.findIndex((node) => node.name === assetId);
    const directChildren = new Set((json.nodes[rootIndex].children || []).map((index) => json.nodes[index].name));
    for (const socketName of ['BARCODE_AREA', 'PICKUP_TARGET', 'PLACEMENT_TARGET']) {
      assert.ok(directChildren.has(socketName), `${assetId}/${socketName} direct root socket`);
      const socket = byName.get(socketName);
      assert.equal(socket.mesh, undefined, `${assetId}/${socketName} transform-only socket`);
      assert.equal(socket.extras?.anchor, true, `${assetId}/${socketName} anchor metadata`);
    }
    assert.equal(byName.get('PLACEMENT_TARGET').extras?.fixture_id, spec.placementFixture);
    const collision = byName.get(spec.collision);
    assert.ok(collision, `${assetId} collision`);
    assert.equal(collision.extras?.collision_proxy, true);
    assert.equal(collision.extras?.simplified, true);
    assert.equal(collision.extras?.packed_envelope, true);
    assert.ok(triangleCount(json, (node) => node.name === spec.collision) <= 24,
      `${assetId} collision remains a simple box`);
  }
});


test('nonretail fixture meshes have normals and UVs with applied transforms and runtime-safe budgets', () => {
  for (const [assetId] of Object.entries(SPECS)) {
    const { bytes, json } = parsed.get(assetId);
    for (const node of json.nodes) {
      if (node.mesh === undefined) continue;
      assert.deepEqual(node.scale || [1, 1, 1], [1, 1, 1], `${assetId}/${node.name} applied scale`);
      for (const primitive of json.meshes[node.mesh].primitives || []) {
        assert.notEqual(primitive.attributes.NORMAL, undefined, `${assetId}/${node.name} normals`);
        assert.notEqual(primitive.attributes.TEXCOORD_0, undefined, `${assetId}/${node.name} UV0`);
      }
    }
    const triangles = triangleCount(json);
    assert.ok(triangles >= 1800 && triangles <= 6000, `${assetId} triangles ${triangles}`);
    const materials = json.materials?.length || 0;
    assert.ok(materials >= 5 && materials <= 14, `${assetId} materials ${materials}`);
    assert.equal(json.textures?.length || 0, 0, `${assetId} no texture dependency`);
    assert.equal(json.animations?.length || 0, 0, `${assetId} no animation payload`);
    assert.equal(json.cameras?.length || 0, 0, `${assetId} no camera payload`);
    assert.equal(json.extensions?.KHR_lights_punctual?.lights?.length || 0, 0, `${assetId} no light payload`);
    assert.ok(bytes.length <= 350_000, `${assetId} compact GLB ${bytes.length} bytes`);
  }
});


test('each SKU is visibly represented by its explicit packed-state components', () => {
  const vacuum = parsed.get('delivery_fixture_product_vacuum').json;
  const vacuumNodes = new Map(vacuum.nodes.map((node) => [node.name, node]));
  assert.equal(vacuumNodes.get('VAC_MOTOR_CANISTER_SIDE_PACKED').extras?.packing_role, 'motor_base_on_side');
  assert.equal(vacuumNodes.get('VAC_DETACHED_WAND').extras?.detached_for_packing, true);
  assert.equal(vacuumNodes.get('VAC_HOSE_COIL').extras?.detached_for_packing, true);

  const plant = parsed.get('delivery_fixture_product_plant').json;
  const plantNodes = new Map(plant.nodes.map((node) => [node.name, node]));
  assert.equal(plantNodes.get('PLANT_POT').extras?.component, 'terracotta_pot');
  assert.equal(plantNodes.get('PLANT_CROWN_NET').extras?.component, 'protective_crown_net');
  assert.equal(plantNodes.get('PLANT_CROWN_NET').extras?.removable, true);
  assert.equal(plantNodes.get('PLANT_POT_BRACE_RING').extras?.packing_role, 'pot_braced');

  const poster = parsed.get('delivery_fixture_product_poster').json;
  const posterNodes = new Map(poster.nodes.map((node) => [node.name, node]));
  assert.equal(posterNodes.get('POSTER_COURSE_ART').extras?.fictional_brand, 'Pinehollow Golf');
  assert.equal(posterNodes.get('POSTER_FACE_PROTECTOR').extras?.removable, true);
  assert.equal(posterNodes.get('POSTER_FACE_PROTECTOR').extras?.protects_fragile_glazing, true);

  const board = parsed.get('delivery_fixture_product_events_board').json;
  const boardNodes = new Map(board.nodes.map((node) => [node.name, node]));
  assert.equal(boardNodes.get('EVENTS_BOARD').extras?.rail_detached, true);
  assert.equal(boardNodes.get('BOARD_DETACHED_RAIL').extras?.detached_for_packing, true);
  assert.equal(boardNodes.get('EVENTS_BOARD_CORK_FACE').extras?.pin_ready, true);

  const pendant = parsed.get('delivery_fixture_product_pendant').json;
  const pendantNodes = new Map(pendant.nodes.map((node) => [node.name, node]));
  const pendantRoot = pendantNodes.get('delivery_fixture_product_pendant');
  assert.equal(pendantNodes.get('PENDANT_SHADE').extras?.packing_role, 'shade_upright_in_ring');
  assert.equal(pendantNodes.get('PENDANT_DETACHED_STEM').extras?.detached_for_packing, true);
  assert.equal(pendantNodes.get('PENDANT_FOAM_RING').extras?.removable, true);
  assert.equal(pendantRoot.extras?.reference_imported_into_build, false);
  assert.match(pendantRoot.extras?.reference_sha256 || '', /^[0-9a-f]{64}$/);
  assert.equal(pendantRoot.extras?.source, 'vendor/models/clubhouse/pendant.glb');
});


test('pass-02 report records five clean reimports and unchanged project-owned reference', () => {
  const reportPath = fileURLToPath(new URL(
    '../qa/box_system_master/nonretail_fixture_products/pass-02/nonretail_fixture_products_build_report.json',
    import.meta.url,
  ));
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.builder, 'tools/blender/build_nonretail_fixture_products.py');
  assert.equal(report.dimension_contract, 'src/data/productPackaging.js');
  assert.deepEqual(report.external_assets, []);
  assert.equal(report.project_owned_reference, 'vendor/models/clubhouse/pendant.glb');
  assert.equal(report.project_owned_reference_unchanged, true);
  assert.equal(report.project_owned_reference_sha256_before, report.project_owned_reference_sha256_after);
  assert.equal(report.raw_sources_modified, false);
  assert.equal(report.assets.length, 5);
  assert.equal(report.reimports.length, 5);
  for (const reimport of report.reimports) {
    assert.equal(reimport.clean_reimport, true, `${reimport.asset_id} clean reimport`);
    assert.equal(reimport.root_metadata_preserved, true, `${reimport.asset_id} root metadata`);
    assert.equal(reimport.logical_sku_preserved, true, `${reimport.asset_id} logical SKU`);
    assert.equal(reimport.required_nodes_preserved, true, `${reimport.asset_id} hierarchy`);
    assert.equal(reimport.anchors_preserved, true, `${reimport.asset_id} sockets`);
    assert.equal(reimport.no_runtime_scale, true, `${reimport.asset_id} 1:1 scale`);
    assert.equal(reimport.no_cameras_or_lights, true, `${reimport.asset_id} clean scene payload`);
  }
});
