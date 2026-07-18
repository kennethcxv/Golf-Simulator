// Dependency-free production contracts for the two planned provisions products.
// The GLB container and glTF hierarchy are parsed with Node built-ins only so CI
// verifies shipped geometry/extras without a browser, WebGL, Blender, or Three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';


const SPECS = Object.freeze({
  provisions_fairway_spring_water: Object.freeze({
    logicalSku: 'water1',
    authorDimensions: Object.freeze([0.068, 0.068, 0.218]),
    runtimeDimensions: Object.freeze([0.068, 0.218, 0.068]),
    dimensionTolerance: 0.001,
    triangleRange: Object.freeze([2500, 12000]),
    materialRange: Object.freeze([5, 12]),
    textureRange: Object.freeze([0, 0]),
    collision: 'COL_PROVISIONS_WATER',
    required: Object.freeze([
      'WATER_BOTTLE_PET',
      'WATER_LIQUID',
      'WATER_LABEL_WRAP',
      'WATER_LABEL_FRONT_FIELD',
      'WATER_TAMPER_BAND',
      'WATER_CAP',
      'WATER_BARCODE_BACKING',
      'BARCODE_AREA',
      'PICKUP_TARGET',
      'SHELF_TARGET',
      'COL_PROVISIONS_WATER',
    ]),
  }),
  provisions_bunker_bites_chips: Object.freeze({
    logicalSku: 'snack1',
    authorDimensions: Object.freeze([0.160, 0.0715, 0.195]),
    runtimeDimensions: Object.freeze([0.160, 0.195, 0.0715]),
    dimensionTolerance: 0.0002,
    triangleRange: Object.freeze([100, 1000]),
    materialRange: Object.freeze([2, 4]),
    textureRange: Object.freeze([1, 2]),
    collision: 'COL_PROVISIONS_SNACK',
    required: Object.freeze([
      'SNACK_POUCH_BODY',
      'SNACK_SOURCE_DERIVATION',
      'BARCODE_AREA',
      'PICKUP_TARGET',
      'SHELF_TARGET',
      'COL_PROVISIONS_SNACK',
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


const parsed = new Map(Object.keys(SPECS).map((assetId) => [assetId, parseGlb(assetId)]));


test('provisions GLBs expose exact roots, SKU metadata, dimensions, and no runtime scaling', () => {
  for (const [assetId, spec] of Object.entries(SPECS)) {
    const { json } = parsed.get(assetId);
    const rootIndex = json.nodes.findIndex((node) => node.name === assetId);
    assert.notEqual(rootIndex, -1, `${assetId} exact root`);
    const metadata = json.nodes[rootIndex].extras || {};
    assert.equal(metadata.asset_id, assetId);
    assert.equal(metadata.logical_sku, spec.logicalSku);
    assert.equal(metadata.asset_type, 'retail_provisions_product');
    assert.match(String(metadata.units || ''), /^(m|metres?|meters?)$/i);
    assert.equal(metadata.allow_runtime_scale, false, `${assetId} stays at 1:1 product scale`);
    assert.equal(metadata.license, 'Project-owned / UNLICENSED');
    assert.equal(metadata.external_assets, 0);
    assertNearArray(metadata.target_dimensions_m, spec.authorDimensions, 1e-9, `${assetId} author metadata`);
    assertNearArray(metadata.runtime_dimensions_m, spec.runtimeDimensions, 1e-9, `${assetId} runtime metadata`);
    assertNearArray(visibleBounds(json).dimensions, spec.runtimeDimensions, spec.dimensionTolerance,
      `${assetId} shipped visible dimensions`);
  }
});


test('provisions GLBs retain production hierarchy, direct transform anchors, and simplified collisions', () => {
  for (const [assetId, spec] of Object.entries(SPECS)) {
    const { json } = parsed.get(assetId);
    const names = new Set(json.nodes.map((node) => node.name));
    for (const name of spec.required) assert.ok(names.has(name), `${assetId} missing ${name}`);
    const rootIndex = json.nodes.findIndex((node) => node.name === assetId);
    const directChildren = new Set((json.nodes[rootIndex].children || []).map((index) => json.nodes[index].name));
    for (const anchorName of ['BARCODE_AREA', 'PICKUP_TARGET', 'SHELF_TARGET']) {
      assert.ok(directChildren.has(anchorName), `${assetId}/${anchorName} is a direct root socket`);
      const anchorNode = json.nodes.find((node) => node.name === anchorName);
      assert.equal(anchorNode.mesh, undefined, `${assetId}/${anchorName} is not visible geometry`);
      assert.equal(anchorNode.extras?.anchor, true, `${assetId}/${anchorName} anchor metadata`);
    }
    const collisionTriangles = triangleCount(json, (node) => node.name === spec.collision);
    assert.ok(collisionTriangles > 0 && collisionTriangles <= 24,
      `${assetId}/${spec.collision} remains a simple <=24-triangle proxy`);
  }
});


test('provisions meshes have normals/UVs and stay inside product runtime budgets', () => {
  for (const [assetId, spec] of Object.entries(SPECS)) {
    const { json } = parsed.get(assetId);
    for (const node of json.nodes) {
      if (node.mesh === undefined || /^(COL_|COLLISION_|VOLUME_)/.test(node.name || '')) continue;
      for (const primitive of json.meshes[node.mesh].primitives || []) {
        assert.notEqual(primitive.attributes.NORMAL, undefined, `${assetId}/${node.name} normals`);
        assert.notEqual(primitive.attributes.TEXCOORD_0, undefined, `${assetId}/${node.name} UV0`);
      }
      assert.deepEqual(node.scale || [1, 1, 1], [1, 1, 1], `${assetId}/${node.name} applied scale`);
    }
    const triangles = triangleCount(json);
    assert.ok(triangles >= spec.triangleRange[0] && triangles <= spec.triangleRange[1],
      `${assetId} triangles ${triangles} outside ${spec.triangleRange}`);
    const materials = json.materials?.length || 0;
    assert.ok(materials >= spec.materialRange[0] && materials <= spec.materialRange[1],
      `${assetId} materials ${materials} outside ${spec.materialRange}`);
    const textures = json.textures?.length || 0;
    assert.ok(textures >= spec.textureRange[0] && textures <= spec.textureRange[1],
      `${assetId} textures ${textures} outside ${spec.textureRange}`);
    assert.equal(json.animations?.length || 0, 0, `${assetId} no animation payload`);
    assert.equal(json.cameras?.length || 0, 0, `${assetId} no exported camera`);
    assert.equal(json.extensions?.KHR_lights_punctual?.lights?.length || 0, 0, `${assetId} no exported light`);
  }
});


test('water is a recognisable separate PET/liquid/label/cap package and snack preserves embedded brand art', () => {
  const water = parsed.get('provisions_fairway_spring_water').json;
  const byName = new Map(water.nodes.map((node) => [node.name, node]));
  assert.equal(byName.get('WATER_BOTTLE_PET').extras?.component, 'clear_pet_bottle');
  assert.equal(byName.get('WATER_LIQUID').extras?.component, 'liquid_fill');
  assert.equal(byName.get('WATER_LABEL_WRAP').extras?.component, 'paper_label');
  assert.equal(byName.get('WATER_TAMPER_BAND').extras?.component, 'tamper_band');
  assert.equal(byName.get('WATER_TAMPER_BAND').extras?.sealed, true);
  assert.equal(byName.get('WATER_CAP').extras?.component, 'cap');
  assert.equal(byName.get('WATER_CAP').extras?.separate_component, true);
  assert.ok((water.materials || []).filter((material) => material.alphaMode === 'BLEND').length >= 2,
    'water retains clear-ish PET and visible liquid materials');

  const snack = parsed.get('provisions_bunker_bites_chips').json;
  const snackRoot = snack.nodes.find((node) => node.name === 'provisions_bunker_bites_chips');
  assert.match(snackRoot.extras?.product_name || '', /Bunker Bites/i);
  assert.match(snackRoot.extras?.flavor || '', /sour cream and chive/i);
  assert.equal(snackRoot.extras?.allow_runtime_scale, false);
  assert.match(snackRoot.extras?.derivation || '', /1:1 scale/i);
  assert.equal(snack.images?.length, 1, 'project-owned Bunker Bites label image remains embedded');
  assert.ok(snack.images[0].bufferView !== undefined, 'snack label is embedded in the GLB, not a network dependency');
});


test('pass-02 clean-reimport report records immutable project-owned snack sources unchanged', () => {
  const reportPath = fileURLToPath(new URL(
    '../qa/box_system_master/provisions_assets/pass-02/provisions_products_build_report.json',
    import.meta.url,
  ));
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.builder, 'tools/blender/build_provisions_products.py');
  assert.deepEqual(report.external_assets, []);
  assert.equal(report.immutable_sources_unchanged, true);
  assert.deepEqual(report.immutable_source_hashes_before, report.immutable_source_hashes_after);
  assert.equal(report.assets.length, 2);
  assert.equal(report.reimports.length, 2);
  for (const reimport of report.reimports) {
    assert.equal(reimport.clean_reimport, true, `${reimport.asset_id} clean reimport`);
    assert.equal(reimport.root_metadata_preserved, true, `${reimport.asset_id} metadata`);
    assert.equal(reimport.required_nodes_preserved, true, `${reimport.asset_id} hierarchy`);
    assert.equal(reimport.anchors_preserved, true, `${reimport.asset_id} anchors`);
    assert.equal(reimport.no_runtime_scale, true, `${reimport.asset_id} 1:1 scale`);
  }
});
