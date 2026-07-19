import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  DELIVERY_EQUIPMENT_DEFAULT_LAYOUT,
  DELIVERY_VAN_ARRIVAL_DURATIONS,
  DELIVERY_VAN_BEATS,
  createDeliveryEquipment,
} from '../src/render3d/clubhouse/deliveryEquipment.js';

function makeMesh(name, geometry, material, userData = null) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  if (userData) Object.assign(mesh.userData, userData);
  return mesh;
}

function addAnchor(root, name, position, anchorKind, { mesh = false } = {}) {
  const anchor = mesh
    ? makeMesh(name, new THREE.BoxGeometry(0.02, 0.02, 0.02), root.userData.sharedMaterial)
    : new THREE.Group();
  anchor.name = name;
  anchor.position.fromArray(position);
  anchor.userData.anchor_kind = anchorKind;
  root.add(anchor);
  return anchor;
}

function addCollider(root, name, size = [0.4, 0.5, 0.6], position = [0, 0.25, 0]) {
  const collider = makeMesh(
    name,
    new THREE.BoxGeometry(...size),
    root.userData.sharedMaterial,
    { helper: true, collision_proxy: true },
  );
  collider.position.fromArray(position);
  root.add(collider);
  return collider;
}

function makeVan(material) {
  const root = new THREE.Group();
  root.name = 'delivery_van';
  root.userData.sharedMaterial = material;
  root.add(makeMesh('VAN_BODY_SHELL', new THREE.BoxGeometry(5.5, 2.4, 2), material));

  const sliding = new THREE.Group();
  sliding.name = 'SLIDING_CARGO_DOOR_RIGHT_PIVOT';
  sliding.position.set(0.52, 1.36, 0.92);
  sliding.userData.travel_m = 1.32;
  root.add(sliding);
  sliding.add(makeMesh('SLIDING_CARGO_DOOR_RIGHT', new THREE.BoxGeometry(1.7, 1.7, 0.05), material));

  for (const [label, z, degrees] of [['LEFT', -0.835, 78], ['RIGHT', 0.835, -78]]) {
    const pivot = new THREE.Group();
    pivot.name = `REAR_CARGO_DOOR_${label}_HINGE_PIVOT`;
    pivot.position.set(2.635, 1.35, z);
    pivot.userData.open_angle_degrees = degrees;
    root.add(pivot);
    const panel = makeMesh(`REAR_CARGO_DOOR_${label}`, new THREE.BoxGeometry(0.05, 1.7, 0.82), material);
    panel.position.z = label === 'LEFT' ? 0.42 : -0.42;
    pivot.add(panel);
  }

  for (const label of ['FRONT_LEFT', 'FRONT_RIGHT', 'REAR_LEFT', 'REAR_RIGHT']) {
    const steering = label.startsWith('FRONT') ? new THREE.Group() : root;
    if (steering !== root) {
      steering.name = `WHEEL_${label}_STEER_PIVOT`;
      root.add(steering);
    }
    const pivot = new THREE.Group();
    pivot.name = `WHEEL_${label}_PIVOT`;
    pivot.userData.wheel_radius_m = 0.405;
    steering.add(pivot);
    pivot.add(makeMesh(`WHEEL_${label}_TIRE`, new THREE.CylinderGeometry(0.4, 0.4, 0.15), material));
  }

  addAnchor(root, 'CARGO_BOX_SOCKET_01', [0.1, 0.5, -0.4], 'delivery_box_socket', { mesh: true });
  addAnchor(root, 'RIGHT_DOOR_LOADING_ANCHOR', [0.52, 0.58, 1], 'van_side_loading');
  addCollider(root, 'COL_VAN_CARGO_BODY', [3.2, 2.1, 1.8], [1, 1.05, 0]);
  return root;
}

function makeHandTruck(material) {
  const root = new THREE.Group();
  root.name = 'delivery_hand_truck';
  root.userData.sharedMaterial = material;
  const axle = new THREE.Group();
  axle.name = 'AXLE_ASSEMBLY';
  axle.position.set(0, 0.135, -0.015);
  axle.userData.axis_runtime = '+X';
  root.add(axle);
  for (const label of ['LEFT', 'RIGHT']) {
    const pivot = new THREE.Group();
    pivot.name = `WHEEL_${label}_PIVOT`;
    pivot.position.x = label === 'LEFT' ? -0.218 : 0.218;
    pivot.userData.spin_axis_runtime = '+X';
    axle.add(pivot);
    pivot.add(makeMesh(`WHEEL_${label}_TIRE`, new THREE.CylinderGeometry(0.11, 0.11, 0.05), material));
  }
  root.add(makeMesh('FRAME_ASSEMBLY', new THREE.BoxGeometry(0.4, 1, 0.08), material));
  addAnchor(root, 'INTERACTION_TARGET', [0, 0.72, -0.05], 'hand_truck_interaction');
  addCollider(root, 'COL_HAND_TRUCK_FRAME');
  return root;
}

function makeStockingCart(material, { authoredTopSocket = false } = {}) {
  const root = new THREE.Group();
  root.name = 'delivery_stocking_cart';
  root.userData.sharedMaterial = material;
  root.add(makeMesh('CART_FRAME', new THREE.BoxGeometry(1, 0.7, 0.5), material));
  for (let index = 1; index <= 6; index += 1) {
    addAnchor(
      root,
      `STOCK_SOCKET_${String(index).padStart(2, '0')}`,
      [(index % 2 ? -1 : 1) * 0.2, index <= 2 ? 0.24 : index <= 4 ? 0.5 : 0.78, 0],
      'stocking_cart_item_socket',
    );
  }
  if (authoredTopSocket) {
    const top = addAnchor(root, 'STOCK_BOX_SOCKET_TOP', [0, 0.78, 0], 'stocking_cart_box_socket');
    top.userData.authored = true;
  }
  const handle = new THREE.Group();
  handle.name = 'HANDLE_PIVOT';
  root.add(handle);
  handle.add(makeMesh('HANDLE_GRIP', new THREE.BoxGeometry(0.05, 0.05, 0.4), material));
  addAnchor(root, 'INTERACTION_TARGET', [-0.38, 0.82, -0.26], 'stocking_cart_interaction');
  addCollider(root, 'COL_CART_BODY', [1, 0.7, 0.5], [0, 0.35, 0]);
  return root;
}

function makePalletJack(material) {
  const root = new THREE.Group();
  root.name = 'delivery_pallet_jack';
  root.userData.sharedMaterial = material;
  root.userData.front = 'runtime -X fork tips';
  const lift = new THREE.Group();
  lift.name = 'FORK_LIFT_SLIDE';
  Object.assign(lift.userData, {
    motion_axis: '+Z', motion_axis_runtime: '+Y',
    minimum_z_m: 0, maximum_z_m: 0.12,
    minimum_runtime_y_m: 0, maximum_runtime_y_m: 0.12,
  });
  root.add(lift);
  lift.add(makeMesh('FORK_FRAME', new THREE.BoxGeometry(1.2, 0.1, 0.6), material));
  const steering = new THREE.Group();
  steering.name = 'STEERING_YAW_PIVOT';
  root.add(steering);
  const handle = new THREE.Group();
  handle.name = 'HANDLE_TILT_PIVOT';
  Object.assign(handle.userData, {
    rotation_axis: '+/-Y', rotation_axis_runtime: '+/-Z', working_range_degrees: [-52, 18],
  });
  steering.add(handle);
  handle.add(makeMesh('HANDLE_GRIP', new THREE.BoxGeometry(0.08, 0.5, 0.3), material));
  addAnchor(handle, 'HANDLE_GRIP_TARGET', [0.61, 1.175, 0], 'operator_grip');
  const coupling = addAnchor(root, 'PALLET_COUPLING_SOCKET', [-0.235, 0.094, 0], 'pallet_coupling');
  coupling.userData.target_semantics = 'pallet_center';
  coupling.userData.approach_anchor = 'PALLET_JACK_ENTRY';
  addAnchor(root, 'INTERACTION_TARGET', [0.515, 0.44, 0.48], 'pallet_jack_interaction');
  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'COLLISION_PROXIES';
  collisionGroup.userData.helper = true;
  root.add(collisionGroup);
  addCollider(collisionGroup, 'COL_FORK_LEFT', [1.1, 0.1, 0.15], [-0.2, 0.05, -0.2]);
  addCollider(collisionGroup, 'COL_FORK_RIGHT', [1.1, 0.1, 0.15], [-0.2, 0.05, 0.2]);
  return root;
}

function makePallet(material, position = [8, 3, 4]) {
  const root = new THREE.Group();
  root.name = 'delivery_wooden_pallet';
  root.position.fromArray(position);
  root.add(makeMesh('PALLET_DECK', new THREE.BoxGeometry(1.2, 0.14, 1), material));
  const entry = addAnchor(root, 'PALLET_JACK_ENTRY', [0, 0.058, 0.56], 'pallet_jack_entry');
  entry.userData.entry_direction_runtime = '-Z';
  return root;
}

function makeFakeMerch({ ready = true, authoredTopSocket = false } = {}) {
  const material = new THREE.MeshStandardMaterial({ color: 0x3f5f3b });
  const sceneFor = (root) => {
    const scene = new THREE.Group();
    scene.name = `${root.name}_GLTFScene`;
    scene.add(root);
    return scene;
  };
  const prototypes = new Map([
    ['delivery_van', sceneFor(makeVan(material))],
    ['delivery_hand_truck', sceneFor(makeHandTruck(material))],
    ['delivery_stocking_cart', sceneFor(makeStockingCart(material, { authoredTopSocket }))],
    ['delivery_pallet_jack', sceneFor(makePalletJack(material))],
  ]);
  const callbacks = [];
  const calls = { instantiateRaw: 0, instantiate: 0, bake: 0 };
  let isReady = ready;
  return {
    material,
    prototypes,
    calls,
    has: (name) => prototypes.has(name),
    isReady: () => isReady,
    instantiateRaw(name) {
      calls.instantiateRaw += 1;
      return prototypes.get(name)?.clone(true) || null;
    },
    instantiate(name) {
      calls.instantiate += 1;
      return prototypes.get(name)?.clone(true) || null;
    },
    bake(group) {
      calls.bake += 1;
      return group;
    },
    onReady(callback) { callbacks.push(callback); },
    resolveReady() {
      isReady = true;
      for (const callback of callbacks.splice(0)) callback();
    },
  };
}

function advanceUntil(equipment, predicate, limit = 300) {
  for (let index = 0; index < limit; index += 1) {
    equipment.update(0.05);
    if (predicate()) return;
  }
  assert.fail('delivery-equipment choreography did not reach the expected state');
}

test('delivery equipment mounts all authored hierarchies without baking and hides authoring meshes', () => {
  const merch = makeFakeMerch();
  const interior = new THREE.Group();
  const exterior = new THREE.Group();
  const equipment = createDeliveryEquipment({
    merch,
    parents: { interior, exterior },
    localToWorld: (x, z) => ({ x: x + 100, z: z - 50 }),
    groundYAt: () => 7,
  });

  assert.equal(equipment.isReady(), true);
  assert.equal(merch.calls.instantiateRaw, 4);
  assert.equal(merch.calls.instantiate, 0);
  assert.equal(merch.calls.bake, 0, 'moving delivery assets must never enter the bake path');
  assert.equal(equipment.interiorRoot.parent, interior);
  assert.equal(equipment.exteriorRoot.parent, exterior);

  const handTruck = equipment.rootFor('handTruck');
  assert.deepEqual(handTruck.position.toArray(), [8.35, 0, -3.95]);
  assert.equal(handTruck.rotation.y, 0.6);
  const van = equipment.rootFor('delivery_van');
  assert.deepEqual(van.position.toArray(), [116.5, 7, -50]);
  assert.equal(van.visible, false, 'van is revealed only by an arrival presentation');

  const sliding = equipment.node('van', 'SLIDING_CARGO_DOOR_RIGHT_PIVOT');
  assert.equal(equipment.node('van', 'SLIDING_CARGO_DOOR_RIGHT').parent, sliding);
  assert.equal(equipment.node('handTruck', 'WHEEL_LEFT_PIVOT').parent.name, 'AXLE_ASSEMBLY');
  assert.equal(equipment.node('palletJack', 'HANDLE_TILT_PIVOT').parent.name, 'STEERING_YAW_PIVOT');
  assert.equal(equipment.node('van', 'COL_VAN_CARGO_BODY').visible, false);
  assert.equal(equipment.node('van', 'CARGO_BOX_SOCKET_01').visible, false, 'socket meshes remain transform-only');

  const sockets = equipment.sockets('stockingCart');
  assert.equal(sockets.length, 7, 'lookup combines authored sockets with the logical top-box transform');
  const topBoxSocket = sockets.find((socket) => socket.name === 'STOCK_BOX_SOCKET_TOP');
  assert.equal(topBoxSocket?.userData?.logical, true);
  assert.equal(topBoxSocket?.userData?.derived_from, 'STOCK_SOCKET_05,STOCK_SOCKET_06');
  const leftTop = equipment.nodeWorldPose('stockingCart', 'STOCK_SOCKET_05').position;
  const rightTop = equipment.nodeWorldPose('stockingCart', 'STOCK_SOCKET_06').position;
  const expectedTop = leftTop.clone().add(rightTop).multiplyScalar(0.5);
  assert.ok(equipment.socketWorldPose('stockingCart', 'STOCK_BOX_SOCKET_TOP').position.distanceTo(expectedTop) < 1e-9);
  const pose = equipment.socketWorldPose('stockingCart', 'STOCK_SOCKET_06');
  assert.ok(pose?.matrix?.isMatrix4);
  assert.ok(pose?.position?.isVector3);

  const props = equipment.staticPropRoots();
  assert.deepEqual(props.map((prop) => prop.id), [
    'delivery_hand_truck', 'delivery_stocking_cart', 'delivery_pallet_jack',
  ]);
  assert.ok(props.every((prop) => prop.root && prop.modelRoot && prop.interactionTarget));
  assert.equal(
    props.find((prop) => prop.id === 'delivery_pallet_jack').interactionTarget.name,
    'HANDLE_GRIP_TARGET',
    'the pallet jack is focused at the authored operator grip rather than its fork frame',
  );
  assert.ok(props.every((prop) => prop.colliders.length >= 1));
  assert.ok(equipment.colliderDescriptors('delivery_van')[0].minX > 100);

  const borrowed = equipment.borrowedResources();
  assert.ok(borrowed.geometries.size > 0);
  assert.equal(borrowed.materials.has(merch.material), true);
  assert.equal(equipment.ownedResources().geometries.size, 0);
  assert.equal(equipment.metrics().assets, 4);

  let geometryDisposals = 0;
  let materialDisposals = 0;
  for (const geometry of borrowed.geometries) geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
  merch.material.addEventListener('dispose', () => { materialDisposals += 1; });
  const first = equipment.dispose();
  const second = equipment.dispose();
  assert.equal(first.alreadyDisposed, false);
  assert.equal(second.alreadyDisposed, true);
  assert.deepEqual(first.resourcesDisposed, { geometries: 0, materials: 0, textures: 0 });
  assert.equal(geometryDisposals, 0, 'createMerch retains sole ownership of shared geometry');
  assert.equal(materialDisposals, 0, 'createMerch retains sole ownership of shared material');
  assert.equal(interior.children.length, 0);
  assert.equal(exterior.children.length, 0);
});

test('an authored top-box socket is indexed directly without adding a duplicate logical transform', () => {
  const merch = makeFakeMerch({ authoredTopSocket: true });
  const equipment = createDeliveryEquipment({ merch, parent: new THREE.Group() });
  const matches = equipment.sockets('stockingCart')
    .filter((socket) => socket.name === 'STOCK_BOX_SOCKET_TOP');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].userData.authored, true);
  assert.notEqual(matches[0].userData.logical, true);
  assert.equal(equipment.modelRootFor('stockingCart').getObjectsByProperty('name', 'STOCK_BOX_SOCKET_TOP').length, 1);
  equipment.dispose();
});

test('arrival requests dedupe, queue, animate authored pivots, and reveal orders only at unload', async () => {
  const merch = makeFakeMerch();
  const beats = [];
  const unloaded = [];
  const equipment = createDeliveryEquipment({
    merch,
    parent: new THREE.Group(),
    arrivalDurations: {
      approach: 0.2, settle: 0.05, opening: 0.1,
      openHold: 0.15, unloading: 0.1, closing: 0.1, departing: 0.2,
    },
    onBeat: (beat, event) => beats.push(`${event.id}:${beat}`),
    onUnload: (orderId) => unloaded.push(orderId),
  });

  let firstArrivalUnloadCallbacks = 0;
  const first = equipment.presentArrival({
    id: 'arrival-a',
    orderId: 'order-a',
    onUnload: () => { firstArrivalUnloadCallbacks += 1; },
  });
  const duplicate = equipment.presentArrival({ id: 'arrival-a', orderId: 'order-a' });
  const second = equipment.presentArrival({ id: 'arrival-b', orderId: 'order-b' });
  assert.equal(duplicate, first, 'same arrival id returns the exact in-flight handle');
  assert.equal(equipment.isOrderPending('order-a'), true);
  assert.equal(equipment.isOrderPending('order-b'), true);
  assert.deepEqual(equipment.diagnostics().queuedArrivals, ['arrival-b']);

  const van = equipment.rootFor('van');
  const wheel = equipment.node('van', 'WHEEL_FRONT_LEFT_PIVOT');
  const door = equipment.node('van', 'SLIDING_CARGO_DOOR_RIGHT_PIVOT');
  const closedDoorX = door.position.x;
  const startZ = van.position.z;
  equipment.update(0.05);
  assert.notEqual(van.position.z, startZ, 'approach advances the van along the route');
  assert.notEqual(wheel.rotation.z, 0, 'authored wheel pivot spins with distance travelled');

  advanceUntil(equipment, () => equipment.diagnostics().activeArrival?.phase === 'open-hold');
  let arrivalDiagnostic = equipment.diagnostics().activeArrival;
  assert.equal(arrivalDiagnostic.phase, 'open-hold');
  assert.ok(arrivalDiagnostic.progress < 1e-12);
  assert.ok(Math.abs(door.position.x - (closedDoorX + 1.32)) < 1e-6, 'authored sliding door reaches full travel');
  assert.ok(Math.abs(equipment.node('van', 'REAR_CARGO_DOOR_LEFT_HINGE_PIVOT').rotation.y
    - THREE.MathUtils.degToRad(78)) < 1e-6, 'rear hinge opens around the authored runtime axis');
  assert.equal(equipment.isOrderPending('order-a'), true,
    'the first order stays pending for the fully-open cargo dwell');
  assert.equal(equipment.isOrderPending('order-b'), true, 'queued order remains hidden');
  assert.deepEqual(unloaded, []);
  assert.equal(firstArrivalUnloadCallbacks, 0);
  assert.equal(beats.filter((beat) => beat === 'arrival-a:unload').length, 0,
    'neither the unload beat nor callbacks fire at cargo-open');

  equipment.update(0.1);
  arrivalDiagnostic = equipment.diagnostics().activeArrival;
  assert.equal(arrivalDiagnostic.phase, 'open-hold');
  assert.ok(Math.abs(arrivalDiagnostic.progress - (2 / 3)) < 1e-9);
  assert.equal(equipment.isOrderPending('order-a'), true);
  assert.deepEqual(unloaded, []);
  assert.equal(firstArrivalUnloadCallbacks, 0);

  equipment.update(0.05);
  assert.equal(equipment.diagnostics().activeArrival?.phase, 'unloading');
  assert.equal(equipment.isOrderPending('order-a'), false, 'the order reveals only after the open hold ends');
  assert.deepEqual(unloaded, ['order-a']);
  assert.equal(firstArrivalUnloadCallbacks, 1);
  assert.equal(beats.filter((beat) => beat === 'arrival-a:unload').length, 1);

  advanceUntil(equipment, () => first.status === 'completed' && second.status === 'completed');
  const firstResult = await first.promise;
  const secondResult = await second.promise;
  assert.equal(firstResult.status, 'completed');
  assert.equal(secondResult.status, 'completed');
  assert.deepEqual(unloaded, ['order-a', 'order-b']);
  assert.equal(firstArrivalUnloadCallbacks, 1, 'arrival unload callback remains exactly-once');
  assert.equal(equipment.pendingOrderIds().size, 0);
  assert.equal(van.visible, false);

  for (const id of ['arrival-a', 'arrival-b']) {
    const names = beats.filter((beat) => beat.startsWith(`${id}:`)).map((beat) => beat.slice(id.length + 1));
    assert.deepEqual(names, [
      DELIVERY_VAN_BEATS.QUEUED,
      DELIVERY_VAN_BEATS.APPROACH,
      DELIVERY_VAN_BEATS.PARKED,
      DELIVERY_VAN_BEATS.DOORS_OPENING,
      DELIVERY_VAN_BEATS.CARGO_OPEN,
      DELIVERY_VAN_BEATS.UNLOAD,
      DELIVERY_VAN_BEATS.DOORS_CLOSING,
      DELIVERY_VAN_BEATS.DEPARTING,
      DELIVERY_VAN_BEATS.COMPLETE,
    ]);
  }
  equipment.dispose();
});

test('numbered loads for one paid order remain pending until the final van unload', async () => {
  const equipment = createDeliveryEquipment({
    merch: makeFakeMerch(),
    parent: new THREE.Group(),
    arrivalDurations: {
      approach: 0.05, settle: 0, opening: 0.05,
      openHold: 0.05, unloading: 0.05, closing: 0.05, departing: 0.05,
    },
  });
  const first = equipment.presentArrival({ id: 'multi-load-01', orderId: 'order-multi' });
  const second = equipment.presentArrival({ id: 'multi-load-02', orderId: 'order-multi' });
  assert.deepEqual(equipment.diagnostics().pendingOrderCounts, { 'order-multi': 2 });

  advanceUntil(equipment, () => first.status === 'completed');
  assert.equal(equipment.isOrderPending('order-multi'), true,
    'the queued second load keeps the shared order pending after load one reveals');
  assert.deepEqual(equipment.diagnostics().pendingOrderCounts, { 'order-multi': 1 });

  advanceUntil(equipment, () => second.status === 'completed');
  assert.equal((await first.promise).unloaded, true);
  assert.equal((await second.promise).unloaded, true);
  assert.equal(equipment.isOrderPending('order-multi'), false);
  assert.deepEqual(equipment.diagnostics().pendingOrderCounts, {});
  equipment.dispose();
});

test('the default fully-open dwell is 0.65s and keeps legacy duration overrides intact', async () => {
  assert.equal(DELIVERY_VAN_ARRIVAL_DURATIONS.openHold, 0.65);
  const merch = makeFakeMerch();
  const beats = [];
  let unloadCallbacks = 0;
  const equipment = createDeliveryEquipment({
    merch,
    parent: new THREE.Group(),
    // These are all of the duration keys available before openHold was added.
    // Their zero-duration behavior remains intact while the new dwell takes
    // its documented default.
    arrivalDurations: {
      approach: 0, settle: 0, opening: 0,
      unloading: 0, closing: 0, departing: 0,
    },
    onBeat: (beat) => beats.push(beat),
    onUnload: () => { unloadCallbacks += 1; },
  });
  const handle = equipment.presentArrival({ id: 'default-open-hold', orderId: 'default-order' });

  equipment.update(0);
  assert.deepEqual(equipment.diagnostics().activeArrival, {
    id: 'default-open-hold', orderId: 'default-order', phase: 'open-hold', progress: 0,
  });
  assert.equal(equipment.isOrderPending('default-order'), true);
  assert.equal(beats.filter((beat) => beat === DELIVERY_VAN_BEATS.CARGO_OPEN).length, 1);
  assert.equal(beats.filter((beat) => beat === DELIVERY_VAN_BEATS.UNLOAD).length, 0);

  equipment.update(0.25);
  equipment.update(0.25);
  equipment.update(0.149);
  assert.equal(equipment.diagnostics().activeArrival?.phase, 'open-hold');
  assert.ok(equipment.diagnostics().activeArrival.progress > 0.99);
  assert.equal(equipment.isOrderPending('default-order'), true);
  assert.equal(unloadCallbacks, 0);

  equipment.update(0.001);
  const result = await handle.promise;
  assert.equal(result.status, 'completed');
  assert.equal(result.unloaded, true);
  assert.equal(unloadCallbacks, 1);
  assert.equal(beats.filter((beat) => beat === DELIVERY_VAN_BEATS.CARGO_OPEN).length, 1);
  assert.equal(beats.filter((beat) => beat === DELIVERY_VAN_BEATS.UNLOAD).length, 1);
  equipment.dispose();
});

test('cancelling and disposing arrivals during the open hold cannot reveal pending orders', async () => {
  const merch = makeFakeMerch();
  const unloaded = [];
  const mappedUnloadCallbacks = [];
  const equipment = createDeliveryEquipment({
    merch,
    parent: new THREE.Group(),
    arrivalDurations: {
      approach: 0, settle: 0, opening: 0, openHold: 1,
      unloading: 0, closing: 0, departing: 0,
    },
    onUnload: (orderId) => unloaded.push(orderId),
  });
  const callbackMap = (label) => ({
    [DELIVERY_VAN_BEATS.UNLOAD]: () => mappedUnloadCallbacks.push(label),
  });
  const first = equipment.presentArrival({
    id: 'cancel-open-hold-a', orderId: 'cancel-order-a', callbacks: callbackMap('a'),
  });
  const second = equipment.presentArrival({
    id: 'cancel-open-hold-b', orderId: 'cancel-order-b', callbacks: callbackMap('b'),
  });

  equipment.update(0);
  assert.equal(equipment.diagnostics().activeArrival?.phase, 'open-hold');
  assert.deepEqual(equipment.diagnostics().queuedArrivals, ['cancel-open-hold-b']);
  assert.equal(equipment.isOrderPending('cancel-order-a'), true);
  assert.equal(equipment.isOrderPending('cancel-order-b'), true);
  assert.equal(first.cancel('player-left-bay'), true);
  assert.equal(first.cancel('duplicate-cancel'), false);
  const firstResult = await first.promise;
  assert.deepEqual(firstResult, {
    id: 'cancel-open-hold-a', orderId: 'cancel-order-a',
    status: 'cancelled', reason: 'player-left-bay',
  });
  assert.equal(equipment.isOrderPending('cancel-order-a'), false);
  assert.equal(equipment.isOrderPending('cancel-order-b'), true);
  assert.equal(equipment.diagnostics().activeArrival?.id, 'cancel-open-hold-b',
    'cancelling an active dwell immediately advances the queued arrival');

  equipment.update(0);
  assert.equal(equipment.diagnostics().activeArrival?.phase, 'open-hold');
  const summary = equipment.dispose();
  const secondResult = await second.promise;
  assert.equal(summary.cancelledArrivals, 1);
  assert.equal(secondResult.status, 'cancelled');
  assert.equal(secondResult.reason, 'disposed');
  assert.deepEqual(unloaded, []);
  assert.deepEqual(mappedUnloadCallbacks, []);
  assert.equal(equipment.pendingOrderIds().size, 0);
  assert.equal(equipment.update(0), false);
});

test('hand-truck operational tilt pivots around its axle, spins authored wheels, and settles exactly', () => {
  const merch = makeFakeMerch();
  const equipment = createDeliveryEquipment({
    merch,
    parent: new THREE.Group(),
    handTruckAction: { tipBack: 0.1, hold: 0.05, return: 0.1 },
  });
  const model = equipment.modelRootFor('handTruck');
  const operationalPivot = equipment.rootFor('handTruck')
    .getObjectByName('DeliveryHandTruckOperationalTiltPivot');
  const axle = equipment.node('handTruck', 'AXLE_ASSEMBLY');
  const wheelLeft = equipment.node('handTruck', 'WHEEL_LEFT_PIVOT');
  const wheelRight = equipment.node('handTruck', 'WHEEL_RIGHT_PIVOT');
  const pivotBase = operationalPivot.rotation.clone();
  const wheelLeftBase = wheelLeft.rotation.clone();
  const wheelRightBase = wheelRight.rotation.clone();
  const axleWorldBase = axle.getWorldPosition(new THREE.Vector3());

  assert.equal(operationalPivot.name, 'DeliveryHandTruckOperationalTiltPivot');
  assert.equal(equipment.triggerHandTruckTilt(), true);
  assert.equal(equipment.triggerHandTruckTilt(), false, 'active action dedupes repeated interaction');
  equipment.update(0.05);
  assert.ok(operationalPivot.rotation.x < pivotBase.x, 'tip-back uses the physical local X axle');
  assert.ok(wheelLeft.rotation.x > wheelLeftBase.x);
  assert.ok(wheelRight.rotation.x > wheelRightBase.x);
  assert.ok(axle.getWorldPosition(new THREE.Vector3()).distanceTo(axleWorldBase) < 1e-9,
    'the axle stays planted while the frame tips around it');
  assert.deepEqual(equipment.diagnostics().handTruck, {
    available: true,
    active: true,
    phase: 'tip-back',
    progress: 0.2,
    cycles: 0,
    runtimeTiltAxis: '+X',
  });

  advanceUntil(equipment, () => !equipment.diagnostics().handTruck.active);
  assert.ok(operationalPivot.rotation.equals(pivotBase));
  assert.ok(wheelLeft.rotation.equals(wheelLeftBase));
  assert.ok(wheelRight.rotation.equals(wheelRightBase));
  assert.equal(equipment.diagnostics().handTruck.cycles, 1);
  assert.equal(equipment.triggerHandTruckTilt(), true, 'action can be triggered again after settling');
  advanceUntil(equipment, () => !equipment.diagnostics().handTruck.active);
  assert.equal(equipment.diagnostics().handTruck.cycles, 2);
  equipment.dispose();
});

test('pallet-jack pump uses explicit Three axes and toggles the authored lift between min and max', () => {
  const merch = makeFakeMerch();
  const equipment = createDeliveryEquipment({
    merch,
    parent: new THREE.Group(),
    palletJackAction: { handleDown: 0.1, lift: 0.1, handleReturn: 0.1 },
  });
  const handle = equipment.node('palletJack', 'HANDLE_TILT_PIVOT');
  const lift = equipment.node('palletJack', 'FORK_LIFT_SLIDE');
  const handleBase = handle.rotation.clone();
  const liftBase = lift.position.clone();
  assert.equal(equipment.triggerPalletJackPump(), true);
  assert.equal(equipment.triggerPalletJackPump(), false, 'active pump stroke cannot be stacked');
  equipment.update(0.05);
  assert.ok(handle.rotation.z > handleBase.z,
    'authored Blender -Y stroke maps through runtime -Z to positive Euler Z');
  assert.equal(handle.rotation.x, handleBase.x);
  assert.equal(handle.rotation.y, handleBase.y);
  assert.ok(lift.position.equals(liftBase), 'fork remains at minimum during handle-down');
  let status = equipment.diagnostics().palletJack;
  assert.equal(status.runtimeHandleAxis, '-Z');
  assert.equal(status.runtimeLiftAxis, '+Y');
  assert.equal(status.targetRaised, true);

  advanceUntil(equipment, () => equipment.diagnostics().palletJack.phase === 'lift');
  equipment.update(0.05);
  assert.ok(lift.position.y > liftBase.y, 'fork carriage translates on runtime +Y');
  assert.equal(lift.position.x, liftBase.x);
  assert.equal(lift.position.z, liftBase.z);
  advanceUntil(equipment, () => !equipment.diagnostics().palletJack.active);
  status = equipment.diagnostics().palletJack;
  assert.equal(status.raised, true);
  assert.equal(status.liftProgress, 1);
  assert.equal(status.cycles, 1);
  assert.ok(Math.abs(lift.position.y - (liftBase.y + 0.12)) < 1e-9,
    'runtime min/max metadata takes precedence over Blender-Z fallback values');
  assert.ok(handle.rotation.equals(handleBase), 'handle restores its exact base transform');

  assert.equal(equipment.triggerPalletJackPump(), true);
  assert.equal(equipment.diagnostics().palletJack.targetRaised, false);
  advanceUntil(equipment, () => !equipment.diagnostics().palletJack.active);
  status = equipment.diagnostics().palletJack;
  assert.equal(status.raised, false);
  assert.equal(status.liftProgress, 0);
  assert.equal(status.cycles, 2);
  assert.ok(lift.position.equals(liftBase), 'second stroke lowers to the authored minimum');
  equipment.dispose();
});

test('pallet jack derives Ref 44 coupling from authored entry/socket semantics and reports exact lift', () => {
  const merch = makeFakeMerch();
  const parent = new THREE.Group();
  const pallet = makePallet(merch.material);
  parent.add(pallet);
  const equipment = createDeliveryEquipment({
    merch,
    parent,
    palletJackAction: { handleDown: 0.1, lift: 0.1, handleReturn: 0.1 },
    // Deliberately hostile terrain proves coupling uses the apron surface.
    groundYAt: () => -6,
  });

  const result = equipment.couplePalletJackToPallet({
    palletRoot: pallet,
    palletIndex: 2,
    surfaceY: 3,
  });
  assert.equal(result.ok, true);
  assert.equal(result.coupledPalletIndex, 2);
  assert.equal(result.authoredForkDirection, '-X');
  assert.equal(result.channelDirection, '-Z');
  assert.equal(result.channelAligned, true);
  assert.ok(result.channelAlignmentDot > 0.999999);
  assert.ok(result.socketHorizontalError < 1e-9);
  assert.equal(result.rootGroundY, 3);
  assert.equal(result.surfaceY, 3);
  assert.equal(result.liftOffset, 0);

  const jack = equipment.rootFor('palletJack');
  assert.ok(Math.abs(jack.rotation.y + Math.PI / 2) < 1e-9,
    'local -X forks rotate onto the pallet entry-to-centre -Z channel');
  const coupling = equipment.nodeWorldPose('palletJack', 'PALLET_COUPLING_SOCKET').position;
  const centre = pallet.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.hypot(coupling.x - centre.x, coupling.z - centre.z) < 1e-9);

  assert.equal(equipment.triggerPalletJackPump(), true);
  advanceUntil(equipment, () => !equipment.diagnostics().palletJack.active);
  let status = equipment.diagnostics().palletJack;
  assert.equal(status.coupledPalletIndex, 2);
  assert.equal(status.channelAligned, true);
  assert.ok(status.socketHorizontalError < 1e-9);
  assert.ok(Math.abs(status.liftOffset - 0.12) < 1e-9);
  assert.ok(Math.abs(equipment.palletJackLiftOffset() - 0.12) < 1e-9);

  assert.equal(equipment.triggerPalletJackPump(), true);
  advanceUntil(equipment, () => !equipment.diagnostics().palletJack.active);
  status = equipment.diagnostics().palletJack;
  assert.equal(status.liftOffset, 0, 'lowering restores the exact authored rest pose');
  assert.ok(status.socketHorizontalError < 1e-9);
  equipment.dispose();
});

test('disposing mid-operation restores hand-truck and pallet-jack base transforms and disables triggers', () => {
  const merch = makeFakeMerch();
  const equipment = createDeliveryEquipment({ merch, parent: new THREE.Group() });
  const handModel = equipment.modelRootFor('handTruck');
  const tiltPivot = equipment.rootFor('handTruck')
    .getObjectByName('DeliveryHandTruckOperationalTiltPivot');
  const handWheel = equipment.node('handTruck', 'WHEEL_LEFT_PIVOT');
  const jackHandle = equipment.node('palletJack', 'HANDLE_TILT_PIVOT');
  const jackLift = equipment.node('palletJack', 'FORK_LIFT_SLIDE');
  const bases = {
    tilt: tiltPivot.rotation.clone(),
    wheel: handWheel.rotation.clone(),
    handle: jackHandle.rotation.clone(),
    lift: jackLift.position.clone(),
  };
  assert.equal(equipment.triggerHandTruckTilt(), true);
  assert.equal(equipment.triggerPalletJackPump(), true);
  equipment.update(0.12);
  assert.equal(equipment.diagnostics().handTruck.active, true);
  assert.equal(equipment.diagnostics().palletJack.active, true);

  const summary = equipment.dispose();
  assert.equal(summary.cancelledOperationalActions, 2);
  assert.ok(tiltPivot.rotation.equals(bases.tilt));
  assert.ok(handWheel.rotation.equals(bases.wheel));
  assert.ok(jackHandle.rotation.equals(bases.handle));
  assert.ok(jackLift.position.equals(bases.lift));
  assert.equal(equipment.triggerHandTruckTilt(), false);
  assert.equal(equipment.triggerPalletJackPump(), false);
  assert.equal(equipment.update(0.2), false);
  assert.equal(equipment.diagnostics().handTruck.available, false);
  assert.equal(equipment.diagnostics().palletJack.available, false);
});

test('layout overrides stay queryable and exterior grounding follows the whole van route', () => {
  const merch = makeFakeMerch();
  const nonlinearGround = (x, z) => 1 + x * x * 0.004 + z * z * 0.002;
  const equipment = createDeliveryEquipment({
    merch,
    parent: new THREE.Group(),
    layout: { palletJack: { x: 12, z: 3, ry: 0.4 } },
    localToWorld: (x, z) => ({ x: x + 10, z: z + 20 }),
    groundYAt: nonlinearGround,
    arrivalDurations: {
      approach: 1, settle: 0, opening: 0,
      openHold: 0, unloading: 0, closing: 0, departing: 1,
    },
  });
  assert.deepEqual(equipment.getLayout('palletJack'), { x: 12, y: 0, z: 3, ry: 0.4, visible: true });
  equipment.setLayout('stockingCart', { position: [7, 0.1, -3], rotationY: 0.25 });
  assert.deepEqual(equipment.getLayout('delivery_stocking_cart'), {
    x: 7, y: 0.1, z: -3, ry: 0.25, visible: true,
  });
  assert.deepEqual(equipment.rootFor('stockingCart').position.toArray(), [7, 0.1, -3]);
  const expected = DELIVERY_EQUIPMENT_DEFAULT_LAYOUT.delivery_van;
  const van = equipment.rootFor('van');
  assert.equal(van.position.x, expected.x + 10);
  assert.equal(van.position.y, nonlinearGround(van.position.x, van.position.z));

  equipment.presentArrival({ id: 'nonlinear-ground-route' });
  equipment.update(0.25);
  equipment.update(0.25);
  assert.equal(equipment.diagnostics().activeArrival?.phase, 'approach');
  assert.ok(
    Math.abs(van.position.y - nonlinearGround(van.position.x, van.position.z)) < 1e-9,
    'approaching van samples terrain at its current route position instead of interpolating endpoint heights',
  );

  equipment.update(0.25);
  equipment.update(0.25);
  assert.equal(equipment.diagnostics().activeArrival?.phase, 'departing');
  equipment.update(0.25);
  equipment.update(0.25);
  assert.ok(
    Math.abs(van.position.y - nonlinearGround(van.position.x, van.position.z)) < 1e-9,
    'departing van samples terrain at its current route position instead of interpolating endpoint heights',
  );
  equipment.dispose();
});

test('dispose is async-safe before merch readiness and settles queued arrival handles', async () => {
  const merch = makeFakeMerch({ ready: false });
  const parent = new THREE.Group();
  const equipment = createDeliveryEquipment({ merch, parent });
  const handle = equipment.presentArrival({ id: 'late-arrival', orderId: 'late-order' });
  assert.equal(equipment.isReady(), false);
  assert.equal(equipment.isOrderPending('late-order'), true);
  const summary = equipment.dispose();
  const result = await handle.promise;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'disposed');
  assert.equal(summary.cancelledArrivals, 1);
  assert.equal(parent.children.length, 0);

  merch.resolveReady();
  assert.equal(merch.calls.instantiateRaw, 0, 'late loader callback cannot mount into a disposed scene');
  assert.equal(equipment.update(1), false);
  assert.equal(equipment.presentArrival({ id: 'after-dispose' }), null);
});

test('arrival callback failures are isolated from the frame loop and reported', async () => {
  const merch = makeFakeMerch();
  let reported = 0;
  const equipment = createDeliveryEquipment({
    merch,
    parent: new THREE.Group(),
    arrivalDurations: {
      approach: 0, settle: 0, opening: 0, openHold: 0,
      unloading: 0, closing: 0, departing: 0,
    },
    onBeat(beat) {
      if (beat === DELIVERY_VAN_BEATS.PARKED) throw new Error('beat failure');
    },
    onError: () => { reported += 1; },
  });
  const handle = equipment.presentArrival({ id: 'callback-error', orderId: 'order-error' });
  equipment.update(0);
  const result = await handle.promise;
  assert.equal(result.status, 'completed');
  assert.equal(reported, 1);
  assert.equal(equipment.diagnostics().callbackErrors.length, 1);
  equipment.dispose();
});
