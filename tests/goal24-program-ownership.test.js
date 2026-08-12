import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL24_PROGRAM_OWNERSHIP_SCHEMA,
  createGoal24ProgramOwnershipProbe,
  goal24ProgramOwnershipProbeFactorySource,
} from '../tools/qa/lib/goal24-program-ownership.mjs';

const DOOR_FIXED_PARAMETERS = [
  'highp', 'srgb-linear', 'false', '',
  'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false',
  'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false',
  'false', 'false', 'false', 'false', 'false', 'false', 'false', '',
  'true', 'false', '0', '',
  '1', '3', '0', '0', '1', '0', '1', '0', '0', '0', '0', '1', '0', '0', '0', '0',
];
function doorProgramKey(maskA, maskB, pointLights = 3) {
  const fixed = [...DOOR_FIXED_PARAMETERS];
  fixed[33] = String(pointLights);
  return [
    'physical', 'STANDARD', '', ...fixed, maskA, maskB, 'srgb',
    'onBeforeCompile( /* shaderobject, renderer */ ) {}',
  ].join(',');
}
const STANDARD_VERTEX_COLOR_KEY = doorProgramKey(8389632, 8520707);
const CUTOUT_DOUBLE_SIDED_KEY = doorProgramKey(8390144, 8522755);
const TWO_POINT_LIGHT_REFERENCE_KEY = doorProgramKey(8389632, 8520707, 2);

function node({ id, name, type = 'Group', userData = {}, material = null, geometry = null }) {
  return {
    id,
    uuid: `object-${id}`,
    name,
    type,
    userData,
    material,
    geometry,
    visible: true,
    layers: { mask: 1 },
    children: [],
    parent: null,
    add(...children) {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
    },
    traverse(visitor) {
      visitor(this);
      for (const child of this.children) child.traverse(visitor);
    },
  };
}

test('Three r185 door arrivals decode to alpha-test and double-sided variants', () => {
  const probe = createGoal24ProgramOwnershipProbe();
  const ordinary = probe.decode(STANDARD_VERTEX_COLOR_KEY);
  const cutout = probe.decode(CUTOUT_DOUBLE_SIDED_KEY);

  assert.equal(ordinary.shaderId, 'physical');
  assert.deepEqual(ordinary.defines, { STANDARD: null });
  assert.equal(ordinary.parameters.numDirLights, 1);
  assert.equal(ordinary.parameters.numPointLights, 3);
  assert.deepEqual(ordinary.masks.a.active, ['vertexColors', 'vertexNormals']);
  assert.deepEqual(ordinary.masks.b.active, [
    'fog', 'useFog', 'shadowMapEnabled', 'opaque', 'hasPositionAttribute',
  ]);
  assert.equal(cutout.masks.a.values.alphaTest, true);
  assert.equal(cutout.masks.b.values.doubleSided, true);
  assert.deepEqual(
    probe.compareDecoded(ordinary, cutout).map((entry) => entry.field),
    ['boolean.alphaTest', 'boolean.doubleSided'],
  );
  assert.equal(
    ordinary.customProgramCacheKey,
    'onBeforeCompile( /* shaderobject, renderer */ ) {}',
    'the comma inside the callback must not shift r185 cache-key fields',
  );
});

test('ownership capture joins a program to exact object, material, and runtime ancestors', () => {
  const probe = createGoal24ProgramOwnershipProbe();
  const material = {
    isMaterial: true,
    id: 91,
    uuid: 'material-91',
    name: 'AssetRuntimeBatch_Walnut',
    type: 'MeshStandardMaterial',
    defines: { STANDARD: '' },
    alphaTest: 0,
    side: 0,
    vertexColors: true,
    transparent: false,
    opacity: 1,
    normalMap: null,
    anisotropy: 0,
  };
  const scene = node({ id: 1, name: 'CourseScene', type: 'Scene' });
  const runtime = node({
    id: 2,
    name: 'AssetRuntime_70_trophy_display',
    userData: {
      assetRuntime: {
        assetNumber: 70,
        saveStateKey: 'asset_070',
        performanceTier: 'hero',
      },
    },
  });
  const batch = node({
    id: 3,
    name: 'Assets61to100PlacedStaticBatch',
    userData: { assetRuntimePlacedStaticBatch: true },
  });
  const mesh = node({
    id: 4,
    name: 'MergedWalnutMesh',
    type: 'Mesh',
    material,
    geometry: {
      id: 52,
      uuid: 'geometry-52',
      name: 'MergedWalnutGeometry',
      type: 'BufferGeometry',
      attributes: {
        position: { itemSize: 3 },
        normal: { itemSize: 3 },
        color: { itemSize: 3 },
      },
      morphAttributes: {},
    },
  });
  scene.add(runtime);
  runtime.add(batch);
  batch.add(mesh);

  const arrivalProgram = {
    id: 201,
    cacheKey: STANDARD_VERTEX_COLOR_KEY,
    type: 'MeshStandardMaterial',
    name: material.name,
    usedTimes: 1,
  };
  const referenceProgram = {
    id: 200,
    cacheKey: TWO_POINT_LIGHT_REFERENCE_KEY,
    type: 'MeshStandardMaterial',
    name: material.name,
    usedTimes: 1,
  };
  const materialProperties = new WeakMap([[material, {
    programs: new Map([
      [TWO_POINT_LIGHT_REFERENCE_KEY, referenceProgram],
      [STANDARD_VERTEX_COLOR_KEY, arrivalProgram],
    ]),
  }]]);
  const renderer = {
    info: { programs: [referenceProgram, arrivalProgram] },
    properties: {
      has: (value) => materialProperties.has(value),
      get: (value) => materialProperties.get(value),
    },
  };

  const evidence = probe.capture({
    renderer,
    scene,
    arrivalKeys: [STANDARD_VERTEX_COLOR_KEY],
    referenceKeys: [TWO_POINT_LIGHT_REFERENCE_KEY],
  });

  assert.equal(evidence.schema, GOAL24_PROGRAM_OWNERSHIP_SCHEMA);
  assert.equal(evidence.arrivalCount, 1);
  const arrival = evidence.arrivals[0];
  assert.equal(arrival.attributed, true);
  assert.deepEqual(
    arrival.nearestExisting.differences,
    [{ field: 'parameter.numPointLights', before: 2, after: 3 }],
  );
  assert.equal(arrival.nearestExisting.sameMaterial, true);
  assert.equal(arrival.materialOwners[0].material.name, material.name);
  assert.equal(arrival.materialOwners[0].material.type, 'MeshStandardMaterial');
  assert.equal(arrival.materialOwners[0].matchingOwners.length, 1);
  const owner = arrival.materialOwners[0].matchingOwners[0];
  assert.equal(owner.name, 'MergedWalnutMesh');
  assert.equal(
    owner.path,
    'CourseScene#1/AssetRuntime_70_trophy_display#2/'
      + 'Assets61to100PlacedStaticBatch#3/MergedWalnutMesh#4',
  );
  assert.equal(owner.runtimeAncestors.assetRuntime.metadata.assetNumber, 70);
  assert.equal(owner.runtimeAncestors.placedStaticBatch.objectName,
    'Assets61to100PlacedStaticBatch');
});

test('factory source reconstructs a self-contained page probe', () => {
  const factory = (0, eval)(goal24ProgramOwnershipProbeFactorySource());
  const probe = factory();
  assert.equal(probe.schema, GOAL24_PROGRAM_OWNERSHIP_SCHEMA);
  assert.equal(probe.decode(CUTOUT_DOUBLE_SIDED_KEY).masks.b.values.doubleSided, true);
});
