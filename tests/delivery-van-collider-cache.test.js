import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { createDeliveryEquipment } from '../src/render3d/clubhouse/deliveryEquipment.js';

const VAN_COLLIDER_NAMES = Object.freeze([
  'COL_REAR_CARGO_DOOR_LEFT',
  'COL_REAR_CARGO_DOOR_RIGHT',
  'COL_SLIDING_CARGO_DOOR_RIGHT',
  'COL_VAN_CAB',
  'COL_VAN_CARGO_FLOOR',
  'COL_VAN_CARGO_LEFT_WALL',
  'COL_VAN_CARGO_RIGHT_FRONT_PILLAR',
  'COL_VAN_CARGO_RIGHT_REAR_PILLAR',
  'COL_VAN_CARGO_ROOF',
  'COL_VAN_NOSE',
  'COL_WHEEL_FRONT_LEFT',
  'COL_WHEEL_FRONT_RIGHT',
  'COL_WHEEL_REAR_LEFT',
  'COL_WHEEL_REAR_RIGHT',
]);

let loadedVanScene = null;

async function vanScene() {
  if (!loadedVanScene) {
    loadedVanScene = (async () => {
      const bytes = await readFile(new URL(
        '../vendor/models/clubhouse/delivery_van.glb',
        import.meta.url,
      ));
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const loader = new GLTFLoader();
      loader.register(() => ({
        name: 'delivery-van-collider-test-texture-stub',
        loadTexture: async () => new THREE.Texture(),
      }));
      const gltf = await new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
      return gltf.scene;
    })();
  }
  return loadedVanScene;
}

async function makeVanEquipment(options = {}) {
  const prototype = await vanScene();
  let instance = null;
  const merch = {
    has: (id) => id === 'delivery_van',
    isReady: () => true,
    instantiateRaw(id) {
      if (id !== 'delivery_van') return null;
      instance = prototype.clone(true);
      return instance;
    },
  };
  const equipment = createDeliveryEquipment({
    merch,
    parent: new THREE.Group(),
    localToWorld: (x, z) => ({ x, z }),
    groundYAt: () => 0,
    ...options,
  });
  return { equipment, instance };
}

function assertBoundsEqual(descriptor, expected, label) {
  for (const [axis, actual, value] of [
    ['minX', descriptor.minX, expected.min.x],
    ['maxX', descriptor.maxX, expected.max.x],
    ['minY', descriptor.minY, expected.min.y],
    ['maxY', descriptor.maxY, expected.max.y],
    ['minZ', descriptor.minZ, expected.min.z],
    ['maxZ', descriptor.maxZ, expected.max.z],
  ]) {
    assert.ok(Math.abs(actual - value) <= 1e-12,
      `${label}.${axis} differs from the full world-matrix result`);
  }
}

function descriptorBounds(descriptor) {
  return [
    descriptor.minX, descriptor.maxX,
    descriptor.minY, descriptor.maxY,
    descriptor.minZ, descriptor.maxZ,
  ];
}

function boundsMoved(first, descriptor, epsilon = 1e-6) {
  return descriptorBounds(descriptor).some((value, index) => Math.abs(value - first[index]) > epsilon);
}

test('Ref 41 collider cache preserves all 14 authored helpers and reuses stable descriptors', async () => {
  const { equipment, instance } = await makeVanEquipment();
  const first = equipment.colliderDescriptors('delivery_van');
  const firstMap = equipment.colliderDescriptorMap('delivery_van');
  assert.deepEqual(first.map((entry) => entry.name).sort(), VAN_COLLIDER_NAMES);
  assert.equal(first.length, 14);
  assert.ok(first.every(Object.isFrozen), 'public descriptors retain their immutable contract');
  assert.equal(firstMap.size, 14);

  // Clubhouse player collision omits the authored floor and roof, then reuses
  // the exact floor footprint as one closed/open cargo hull: 14 - 2 + 1 = 13.
  const twoDimensionalShell = first.filter((entry) => (
    entry.name !== 'COL_VAN_CARGO_FLOOR' && entry.name !== 'COL_VAN_CARGO_ROOF'
  ));
  assert.equal(twoDimensionalShell.length + 1, 13);

  const originalUpdateWorldMatrix = instance.updateWorldMatrix;
  const originalBoxClone = THREE.Box3.prototype.clone;
  let rootUpdates = 0;
  let boxClones = 0;
  instance.updateWorldMatrix = function countedUpdateWorldMatrix(...args) {
    rootUpdates += 1;
    return originalUpdateWorldMatrix.apply(this, args);
  };
  THREE.Box3.prototype.clone = function countedBoxClone(...args) {
    boxClones += 1;
    return originalBoxClone.apply(this, args);
  };
  try {
    const before = equipment.colliderCacheDiagnostics('delivery_van');
    for (let index = 0; index < 2_000; index += 1) {
      assert.equal(equipment.colliderDescriptors('van'), first);
      assert.equal(equipment.colliderDescriptorMap('van'), firstMap);
    }
    const after = equipment.colliderCacheDiagnostics('delivery_van');
    assert.equal(after.refreshes, before.refreshes);
    assert.equal(rootUpdates, 0, 'stable reads never update or traverse the GLB root');
    assert.equal(boxClones, 0, 'stable reads never allocate transient Box3 clones');
    assert.equal(first[0], equipment.colliderDescriptors('van')[0]);
  } finally {
    instance.updateWorldMatrix = originalUpdateWorldMatrix;
    THREE.Box3.prototype.clone = originalBoxClone;
    equipment.dispose();
  }
});

test('cached Ref 41 bounds remain exact while the wrapper and three door proxies move', async () => {
  const { equipment, instance } = await makeVanEquipment({
    arrivalDurations: {
      approach: 1,
      settle: 0.25,
      opening: 1,
      openHold: 0.65,
      unloading: 0.5,
      closing: 1,
      departing: 1,
    },
  });
  const handle = equipment.presentArrival({ id: 'collider-cache-motion' });
  const firstCabBounds = descriptorBounds(
    equipment.colliderDescriptorMap('van').get('COL_VAN_CAB'),
  );
  const firstDoorBounds = descriptorBounds(
    equipment.colliderDescriptorMap('van').get('COL_REAR_CARGO_DOOR_LEFT'),
  );
  let cabMoved = false;
  let rearDoorMoved = false;
  let stableOpenHoldReads = 0;
  let previousPhase = null;

  for (let frame = 0; frame < 160 && handle.status !== 'completed'; frame += 1) {
    equipment.update(0.05);
    const phase = equipment.diagnostics().activeArrival?.phase || 'complete';
    const before = equipment.colliderCacheDiagnostics('van');
    const descriptors = equipment.colliderDescriptors('van');
    const after = equipment.colliderCacheDiagnostics('van');

    // This is the former implementation's authoritative calculation. Compare
    // every cached bound against it at every sampled choreography frame.
    instance.updateWorldMatrix(true, true);
    for (const descriptor of descriptors) {
      const expected = descriptor.object.geometry.boundingBox.clone()
        .applyMatrix4(descriptor.object.matrixWorld);
      assertBoundsEqual(descriptor, expected, `${phase}:${descriptor.name}`);
    }

    const byName = equipment.colliderDescriptorMap('van');
    if (boundsMoved(firstCabBounds, byName.get('COL_VAN_CAB'))) cabMoved = true;
    if (boundsMoved(firstDoorBounds, byName.get('COL_REAR_CARGO_DOOR_LEFT'))) {
      rearDoorMoved = true;
    }
    if (phase === 'open-hold' && previousPhase === 'open-hold') {
      stableOpenHoldReads += 1;
      assert.equal(after.refreshes, before.refreshes,
        'fully open dwell must not refresh unchanged collider bounds');
    }
    previousPhase = phase;
  }

  assert.equal(handle.status, 'completed');
  assert.equal(cabMoved, true, 'the cached cab shell follows approach/departure translation');
  assert.equal(rearDoorMoved, true, 'the cached rear-door proxy follows its hinge');
  assert.ok(stableOpenHoldReads >= 5, 'the stable fully-open phase received repeated cache hits');
  equipment.dispose();
});
