// Dependency-free contracts for the two nonretail FURNITURE1 packed products.
// CI parses the shipped GLB hierarchy and extras using Node built-ins only, so
// these truth/scale/anchor checks do not depend on Blender, WebGL, or Three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';


const QA_DIR = new URL('../qa/box_system_master/nonretail_furniture_packed/pass-01/', import.meta.url);

const SPECS = Object.freeze({
  packed_product_rug1: Object.freeze({
    logicalSku: 'rug1',
    productName: 'Pine lounge rug',
    authorDimensions: Object.freeze([1.18, 0.24, 0.24]),
    runtimeDimensions: Object.freeze([1.18, 0.24, 0.24]),
    physicalRuntimeDimensions: Object.freeze([2.40, 0.018, 1.60]),
    packedState: 'rolled-on-core-with-end-blocks',
    packedOrientation: 'roll-lengthwise',
    unitWeightLb: 24,
    longProduct: true,
    collision: 'COL_PACKED_RUG1',
    triangleRange: Object.freeze([4000, 18000]),
    materialRange: Object.freeze([5, 10]),
    required: Object.freeze([
      'RUG_PACKED_ASSEMBLY',
      'RUG_ROLL_BODY',
      'RUG_CORE',
      'RUG_END_BLOCK_WEST_FRONT_BOTTOM',
      'RUG_END_BLOCK_EAST_REAR_TOP',
      'RUG_BAND_WEST',
      'RUG_BAND_EAST',
      'RUG_LABEL_BACKING',
      'RUG_LABEL_TEXT',
      'PICKUP_TARGET',
      'PLACEMENT_TARGET',
      'SHELF_TARGET',
      'COL_PACKED_RUG1',
    ]),
  }),
  packed_product_lounge1: Object.freeze({
    logicalSku: 'lounge1',
    productName: 'Lounge set',
    authorDimensions: Object.freeze([1.18, 0.78, 0.80]),
    runtimeDimensions: Object.freeze([1.18, 0.80, 0.78]),
    physicalRuntimeDimensions: Object.freeze([2.10, 0.90, 0.85]),
    packedState: 'flat-packed-frame-cushions-compressed',
    packedOrientation: 'panels-lengthwise',
    unitWeightLb: 110,
    longProduct: false,
    collision: 'COL_PACKED_LOUNGE1',
    triangleRange: Object.freeze([5000, 18000]),
    materialRange: Object.freeze([7, 10]),
    required: Object.freeze([
      'LOUNGE_PACKED_ASSEMBLY',
      'LOUNGE_BASE_PANEL',
      'LOUNGE_BACK_PANEL',
      'LOUNGE_SIDE_PANEL_WEST',
      'LOUNGE_SIDE_PANEL_EAST',
      'LOUNGE_TABLE_TOP_PANEL',
      'LOUNGE_COMPRESSED_CUSHION_01',
      'LOUNGE_COMPRESSED_CUSHION_02',
      'LOUNGE_COMPRESSED_CUSHION_03',
      'LOUNGE_STRAP_WEST_FRONT',
      'LOUNGE_STRAP_EAST_TOP',
      'LOUNGE_HARDWARE_POUCH',
      'PICKUP_TARGET',
      'PLACEMENT_TARGET',
      'SHELF_TARGET',
      'COL_PACKED_LOUNGE1',
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
  assert.ok(json, `${assetId} has a JSON chunk`);
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
    (1 - 2 * (yy + zz)) * sx,
    (2 * (xy + zw)) * sx,
    (2 * (xz - yw)) * sx,
    0,
    (2 * (xy - zw)) * sy,
    (1 - 2 * (xx + zz)) * sy,
    (2 * (yz + xw)) * sy,
    0,
    (2 * (xz + yw)) * sz,
    (2 * (yz - xw)) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
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
      assert.equal(primitive.mode ?? 4, 4, `${node.name} uses triangle primitives`);
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


function byName(json) {
  return new Map(json.nodes.map((node) => [node.name, node]));
}


const parsed = new Map(Object.keys(SPECS).map((assetId) => [assetId, parseGlb(assetId)]));


test('FURNITURE1 packed GLBs expose exact roots, SKU truth, dimensions, and provenance', () => {
  for (const [assetId, spec] of Object.entries(SPECS)) {
    const { json } = parsed.get(assetId);
    const rootIndex = json.nodes.findIndex((node) => node.name === assetId);
    assert.notEqual(rootIndex, -1, `${assetId} exact root`);
    const metadata = json.nodes[rootIndex].extras || {};
    assert.equal(metadata.asset_id, assetId);
    assert.equal(metadata.logical_sku, spec.logicalSku);
    assert.equal(metadata.product_name, spec.productName);
    assert.equal(metadata.asset_type, 'nonretail_furniture_packed_product');
    assert.equal(metadata.layout_id, 'FURNITURE1');
    assert.equal(metadata.units_per_box, 1);
    assert.equal(metadata.packed_state, spec.packedState);
    assert.equal(metadata.packed_orientation, spec.packedOrientation);
    assert.equal(metadata.unit_weight_lb, spec.unitWeightLb);
    assert.equal(metadata.long_product, spec.longProduct);
    assert.equal(metadata.allow_runtime_scale, false);
    assert.equal(metadata.raw_sources_modified, false);
    assert.equal(metadata.source_geometry_copied, false);
    assert.equal(metadata.external_assets, 0);
    assert.equal(metadata.license, 'Project-owned / UNLICENSED');
    assert.match(metadata.source_references, /\.(blend|jpeg)(;|$)/);
    assert.doesNotThrow(() => JSON.parse(metadata.source_hashes_json));
    assertNearArray(metadata.target_dimensions_m, spec.authorDimensions, 1e-9, `${assetId} author metadata`);
    assertNearArray(metadata.runtime_dimensions_m, spec.runtimeDimensions, 1e-9, `${assetId} runtime metadata`);
    assertNearArray(metadata.physical_dimensions_runtime_m, spec.physicalRuntimeDimensions, 1e-9,
      `${assetId} unpacked physical metadata`);
    assertNearArray(visibleBounds(json).dimensions, spec.runtimeDimensions, 0.00075,
      `${assetId} shipped visible dimensions`);
  }
});


test('FURNITURE1 packed GLBs retain direct interaction/placement sockets and simple collisions', () => {
  for (const [assetId, spec] of Object.entries(SPECS)) {
    const { json } = parsed.get(assetId);
    const nodes = byName(json);
    for (const name of spec.required) assert.ok(nodes.has(name), `${assetId} missing ${name}`);
    const rootIndex = json.nodes.findIndex((node) => node.name === assetId);
    const children = new Set((json.nodes[rootIndex].children || []).map((index) => json.nodes[index].name));
    for (const anchorName of ['PICKUP_TARGET', 'PLACEMENT_TARGET', 'SHELF_TARGET']) {
      assert.ok(children.has(anchorName), `${assetId}/${anchorName} is a direct root socket`);
      const socket = nodes.get(anchorName);
      assert.equal(socket.mesh, undefined, `${assetId}/${anchorName} is transform-only`);
      assert.equal(socket.extras?.anchor, true, `${assetId}/${anchorName} anchor metadata`);
    }
    assert.equal(nodes.get('SHELF_TARGET').extras?.semantic_alias, 'PLACEMENT_TARGET');
    const collision = nodes.get(spec.collision);
    assert.equal(collision.extras?.collision_proxy, true);
    assert.equal(collision.extras?.simplified, true);
    const collisionTriangles = triangleCount(json, (node) => node.name === spec.collision);
    assert.ok(collisionTriangles > 0 && collisionTriangles <= 24,
      `${assetId}/${spec.collision} remains a <=24-triangle proxy`);
  }
});


test('rug1 visibly encodes one core roll, eight end blocks, and two removable bands', () => {
  const { json } = parsed.get('packed_product_rug1');
  const nodes = byName(json);
  assert.equal(nodes.get('RUG_ROLL_BODY').extras?.component, 'rolled_wool_rug');
  assert.equal(nodes.get('RUG_ROLL_BODY').extras?.product_identity, 'Pine lounge rug');
  assert.equal(nodes.get('RUG_ROLL_BODY').extras?.compressed, true);
  assert.equal(nodes.get('RUG_CORE').extras?.component, 'rug_roll_core');
  assert.equal(nodes.get('RUG_CORE').extras?.separate_component, true);
  const endBlocks = json.nodes.filter((node) => /^RUG_END_BLOCK_/.test(node.name || ''));
  assert.equal(endBlocks.length, 8, 'rug has four protective end blocks at each end');
  assert.ok(endBlocks.every((node) => node.extras?.component === 'moulded_pulp_end_block'));
  const bands = json.nodes.filter((node) => /^RUG_BAND_(WEST|EAST)$/.test(node.name || ''));
  assert.equal(bands.length, 2);
  assert.ok(bands.every((node) => node.extras?.removable === true));
  assert.equal(nodes.get('RUG_LABEL_BACKING').extras?.text, 'PINE LOUNGE RUG');
});


test('lounge1 visibly encodes flat-pack panels, three compressed cushions, straps, and hardware', () => {
  const { json } = parsed.get('packed_product_lounge1');
  const nodes = byName(json);
  for (const name of [
    'LOUNGE_BASE_PANEL', 'LOUNGE_BACK_PANEL',
    'LOUNGE_SIDE_PANEL_WEST', 'LOUNGE_SIDE_PANEL_EAST',
  ]) {
    assert.equal(nodes.get(name).extras?.component, 'flat_pack_frame_panel', `${name} panel truth`);
    assert.equal(nodes.get(name).extras?.source_scale, 1);
  }
  assert.equal(nodes.get('LOUNGE_TABLE_TOP_PANEL').extras?.component, 'flat_pack_table_panel');
  const cushions = json.nodes.filter((node) => /^LOUNGE_COMPRESSED_CUSHION_\d\d$/.test(node.name || ''));
  assert.equal(cushions.length, 3, 'three-seat lounge identity survives compression');
  assert.ok(cushions.every((node) => node.extras?.component === 'vacuum_compressed_cushion'));
  assert.ok(cushions.every((node) => node.extras?.compressed === true));
  assert.ok(cushions.every((node) => node.extras?.compression_ratio === 0.38));
  const strapSegments = json.nodes.filter((node) => /^LOUNGE_STRAP_(WEST|EAST)_(FRONT|REAR|TOP|BOTTOM)$/.test(node.name || ''));
  assert.equal(strapSegments.length, 8, 'two complete four-segment freight straps');
  assert.ok(strapSegments.every((node) => node.extras?.tensioned === true && node.extras?.removable === true));
  assert.equal(nodes.get('LOUNGE_HARDWARE_POUCH').extras?.component, 'labelled_hardware_pouch');
  assert.match(nodes.get('LOUNGE_HARDWARE_POUCH').extras?.contents, /bolts.*washers.*hex key/);
});


test('packed furniture meshes retain UVs/normals, applied scale, and runtime budgets', () => {
  for (const [assetId, spec] of Object.entries(SPECS)) {
    const { json } = parsed.get(assetId);
    for (const node of json.nodes) {
      if (node.mesh === undefined || /^(COL_|COLLISION_|VOLUME_)/.test(node.name || '')) continue;
      const matrix = localMatrix(node);
      for (let axis = 0; axis < 3; axis += 1) {
        const length = Math.hypot(matrix[axis * 4], matrix[axis * 4 + 1], matrix[axis * 4 + 2]);
        assert.ok(Math.abs(length - 1) <= 1e-5, `${assetId}/${node.name} applied axis ${axis} scale`);
      }
      for (const primitive of json.meshes[node.mesh].primitives || []) {
        assert.notEqual(primitive.attributes.NORMAL, undefined, `${assetId}/${node.name} normals`);
        assert.notEqual(primitive.attributes.TEXCOORD_0, undefined, `${assetId}/${node.name} UV0`);
      }
    }
    const triangles = triangleCount(json);
    assert.ok(triangles >= spec.triangleRange[0] && triangles <= spec.triangleRange[1],
      `${assetId} triangles ${triangles} outside ${spec.triangleRange}`);
    const materials = json.materials?.length || 0;
    assert.ok(materials >= spec.materialRange[0] && materials <= spec.materialRange[1],
      `${assetId} materials ${materials} outside ${spec.materialRange}`);
    assert.equal(json.images?.length || 0, 0, `${assetId} has no borrowed raster payload`);
    assert.equal(json.animations?.length || 0, 0, `${assetId} no animation payload`);
    assert.equal(json.cameras?.length || 0, 0, `${assetId} no exported camera`);
    assert.equal(json.extensions?.KHR_lights_punctual?.lights?.length || 0, 0, `${assetId} no exported light`);
  }
});


test('clean Blender reimports preserve packed dimensions, nodes, sockets, and source lineage', () => {
  const buildReport = JSON.parse(readFileSync(new URL('nonretail_furniture_packed_build_report.json', QA_DIR), 'utf8'));
  assert.equal(buildReport.builder, 'tools/blender/build_nonretail_furniture_packed_products.py');
  assert.equal(buildReport.asset_target, 'all');
  assert.deepEqual(buildReport.external_assets, []);
  assert.equal(buildReport.project_owned_references_unchanged, true);
  assert.equal(buildReport.raw_sources_modified, false);
  assert.equal(buildReport.assets.length, 2);
  assert.equal(buildReport.reimports.length, 2);

  for (const [assetId, spec] of Object.entries(SPECS)) {
    const report = JSON.parse(readFileSync(new URL(`${assetId}_reimport.json`, QA_DIR), 'utf8'));
    assert.equal(report.asset_id, assetId);
    assert.equal(report.logical_sku, spec.logicalSku);
    assert.equal(report.packed_state, spec.packedState);
    assert.equal(report.root_metadata_preserved, true);
    assert.equal(report.required_nodes_preserved, true);
    assert.equal(report.anchors_preserved, true);
    assert.equal(report.packed_state_preserved, true);
    assert.equal(report.no_runtime_scale, true);
    assert.equal(report.no_camera, true);
    assert.equal(report.no_light, true);
    assert.equal(report.clean_reimport, true);
    assertNearArray(report.visible_dimensions_runtime, spec.runtimeDimensions, 0.00075,
      `${assetId} reimport runtime dimensions`);
  }
});
