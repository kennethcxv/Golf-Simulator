import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  deliveryVanCargoRestPose, makeClubhouse, planPendingDeliveryVanCargo,
} from '../src/render3d/clubhouse.js';
import { arriveOrder, PAD_CAPACITY } from '../src/sim/deliveries.js';
import { newGame } from '../src/sim/state.js';

test('pending van cargo exposes the first deterministic measured Ref 41 load', () => {
  const boxes = Array.from({ length: PAD_CAPACITY + 2 }, (_, index) => ({
    id: PAD_CAPACITY + 2 - index,
    box: 'clubbox',
  }));
  const plan = planPendingDeliveryVanCargo(boxes);

  assert.equal(plan.length, PAD_CAPACITY);
  assert.deepEqual(plan.map((entry) => entry.boxId), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(plan.every((entry) => entry.loadId === 'ref41-load-01'
    && entry.withinBounds && entry.support.valid && entry.clearance.minimum >= 0.02));
  assert.equal(new Set(plan.map((entry) => (
    `${entry.localPosition.x}:${entry.localPosition.y}:${entry.localPosition.z}`
  ))).size, plan.length);
  assert.equal(plan.some((entry) => entry.boxId > PAD_CAPACITY), false,
    'legacy overflow is diagnosed rather than represented by invented cargo');
});

test('cargo rest poses keep long and tall families low and longitudinal inside Ref 41', () => {
  const club = deliveryVanCargoRestPose('clubbox');
  assert.equal(club.profile, 'longitudinal-low');
  assert.equal(club.rotationY, 0);
  assert.equal(club.footprintLength, 1.25);
  assert.equal(club.footprintWidth, 0.18);

  const bag = deliveryVanCargoRestPose('bagcarton');
  const crate = deliveryVanCargoRestPose('crate');
  assert.equal(bag.profile, 'side-rest-longitudinal');
  assert.equal(crate.profile, 'broad-side-rest');
  assert.ok(bag.packedHeight * 2 + 0.02 <= 1.74);
  assert.ok(crate.packedHeight * 2 + 0.02 <= 1.74);
});

function fakeCanvas() {
  const canvas = {
    width: 1600, height: 900, style: {},
    addEventListener() {}, removeEventListener() {}, requestPointerLock() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }),
  };
  const gradient = { addColorStop() {} };
  const context = new Proxy({
    canvas,
    measureText: (value) => ({ width: String(value ?? '').length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    getImageData: (_x, _y, width = 1, height = 1) => ({
      data: new Uint8ClampedArray(width * height * 4), width, height,
    }),
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(width * height * 4), width, height,
    }),
  }, {
    get(target, property) { return property in target ? target[property] : () => {}; },
    set(target, property, value) { target[property] = value; return true; },
  });
  canvas.getContext = () => context;
  return canvas;
}

function fakeDocument(canvas) {
  const classList = { add() {}, remove() {}, toggle() {} };
  const image = () => ({
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, crossOrigin: null, src: '',
  });
  return {
    body: { classList }, pointerLockElement: null,
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : {
      style: {}, classList, addEventListener() {}, removeEventListener() {}, appendChild() {},
    }),
    createElementNS: () => image(),
    querySelector: (selector) => (selector === 'canvas' ? canvas : null),
    addEventListener() {}, removeEventListener() {}, exitPointerLock() {}, hasFocus: () => true,
  };
}

function fakeLoadedAsset(id, geometry, material) {
  const root = new THREE.Group();
  root.name = id;
  root.add(new THREE.Mesh(geometry, material));
  if (id === 'delivery_van') {
    let socket = 1;
    for (const x of [0.10, 1.05, 2.00]) {
      for (const z of [-0.39, 0.39]) {
        const anchor = new THREE.Group();
        anchor.name = `CARGO_BOX_SOCKET_${String(socket).padStart(2, '0')}`;
        anchor.position.set(x, 0.50, z);
        anchor.userData.anchor_kind = 'delivery_box_socket';
        root.add(anchor);
        socket += 1;
      }
    }
    const rear = new THREE.Group();
    rear.name = 'REAR_LOADING_ANCHOR';
    rear.position.set(2.72, 0.58, 0);
    rear.userData.anchor_kind = 'van_loading';
    root.add(rear);
  }
  return root;
}

test('two concurrent paid arrivals mount only active-order cargo and transfer before interaction', async () => {
  const canvas = fakeCanvas();
  const previousDocument = globalThis.document;
  globalThis.document = fakeDocument(canvas);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const originalLoad = GLTFLoader.prototype.load;
  const geometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const material = new THREE.MeshStandardMaterial({ color: 0xb8905f });
  material.name = 'M_tape';
  const pendingLoads = [];
  GLTFLoader.prototype.load = function loadFixture(url, onLoad) {
    pendingLoads.push(() => {
      const id = String(url).split('/').pop().replace(/\.glb$/i, '');
      onLoad({ scene: fakeLoadedAsset(id, geometry, material), animations: [] });
    });
    return this;
  };

  let clubhouse = null;
  let first = null;
  let second = null;
  try {
    const state = newGame('relaxed', 4141);
    const firstBoxes = arriveOrder(state, { id: 'cargo-a', skuId: 'driver1', qty: 4 });
    const secondBoxes = arriveOrder(state, { id: 'cargo-b', skuId: 'driver1', qty: 4 });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 500);
    scene.add(camera);
    const walkProps = [];
    clubhouse = makeClubhouse({
      scene, camera, state, center: { x: 0, z: 0 }, heightAt: () => 0,
      walkProps, propColliders: [],
      walk: { x: 0, z: 0, yaw: 0, pitch: 0, eye: 1.65, radius: 0.35, active: false, moving: false },
      hooks: {}, canvas, focusOn() {}, clearFocus() {},
    });
    for (const finishLoad of pendingLoads.splice(0)) finishLoad();
    await Promise.resolve();
    assert.equal(clubhouse.deliveryEquipmentReady(), true);

    first = clubhouse.presentDeliveryArrival({ orderId: 'cargo-a', boxCount: 999 });
    second = clubhouse.presentDeliveryArrival({ orderId: 'cargo-b', boxCount: 999 });
    let diagnostics = clubhouse.deliveryBoxPresentationDiagnostics();
    assert.equal(diagnostics.quantityAuthority, 'state.shop.deliveries.boxes');
    assert.equal(diagnostics.cargoOrderId, 'cargo-a');
    assert.deepEqual(diagnostics.cargo.map((entry) => entry.boxId), firstBoxes.map((box) => box.id));
    assert.ok(diagnostics.cargo.every((entry) => entry.state === 'van-cargo-pending'
      && !entry.interactionEnabled && !entry.colliderEnabled));
    const queued = diagnostics.pending.filter((entry) => entry.orderId === 'cargo-b');
    assert.equal(queued.length, secondBoxes.length);
    assert.ok(queued.every((entry) => !entry.activeCargo && !entry.viewMounted
      && !entry.interactionEnabled && !entry.colliderEnabled));
    assert.ok(secondBoxes.every((box) => !scene.getObjectByName(`DeliveryBox_${box.id}`)));

    const firstRoot = scene.getObjectByName(`DeliveryBox_${firstBoxes[0].id}`);
    assert.equal(firstRoot.parent.name, 'DeliveryEquipmentRoot_delivery_van');
    assert.ok(diagnostics.cargo.every((entry) => entry.mounted
      && entry.clearanceSafe && entry.clearance.minimum >= 0.02));
    assert.ok(firstRoot.userData.deliveryCargoAnchorError < 1e-8);

    for (let step = 0; step < 70; step += 1) {
      clubhouse.update(100);
      diagnostics = clubhouse.deliveryBoxPresentationDiagnostics();
      if (diagnostics.transfers.length) break;
    }
    assert.equal(diagnostics.transfers.length, firstBoxes.length);
    assert.ok(diagnostics.transfers.every((entry) => entry.state === 'unloading-transfer'
      && entry.reparentError < 1e-8 && !entry.interactionEnabled && !entry.colliderEnabled),
    JSON.stringify(diagnostics.transfers));
    assert.ok(diagnostics.pending.filter((entry) => entry.orderId === 'cargo-b')
      .every((entry) => !entry.viewMounted && !entry.interactionEnabled));

    for (let step = 0; step < 80; step += 1) {
      clubhouse.update(100);
      diagnostics = clubhouse.deliveryBoxPresentationDiagnostics();
      if (clubhouse.deliveryEquipmentDiagnostics().activeArrival?.orderId === 'cargo-b'
        && diagnostics.cargoOrderId === 'cargo-b') break;
    }
    assert.equal(clubhouse.deliveryEquipmentDiagnostics().activeArrival?.orderId, 'cargo-b');
    assert.equal(diagnostics.cargoOrderId, 'cargo-b');
    assert.deepEqual(diagnostics.cargo.map((entry) => entry.boxId), secondBoxes.map((box) => box.id));
    assert.equal(diagnostics.recentTransfers.length, firstBoxes.length);
    assert.ok(diagnostics.recentTransfers.every((entry) => (
      entry.pathMode === 'rear-aperture-piecewise'
      && entry.waypoints.aperture.length === 3
      && entry.waypoints.outside.length === 3
    )));
    assert.ok(firstBoxes.every((box) => {
      const root = scene.getObjectByName(`DeliveryBox_${box.id}`);
      return root?.parent?.name === 'DeliveryBoxWorldRoot'
        && root.userData.deliveryPresentationState === 'pallet-ready'
        && root.userData.deliveryInteractionEnabled === true;
    }));
  } finally {
    if (clubhouse) clubhouse.dispose();
    if (first) await first.promise;
    if (second) await second.promise;
    GLTFLoader.prototype.load = originalLoad;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

function sortedIds(values) {
  return [...values].sort((a, b) => Number(a) - Number(b));
}

function deliveryBoxRoot(scene, boxId) {
  return scene.getObjectByName(`DeliveryBox_${boxId}`)
    || scene.getObjectByName(`DeliveryBoxFallback_${boxId}`);
}

function deliverySnapshot(clubhouse) {
  return {
    equipment: clubhouse.deliveryEquipmentDiagnostics(),
    presentation: clubhouse.deliveryBoxPresentationDiagnostics(),
  };
}

function advanceUntil(clubhouse, predicate, label, maxSteps = 650) {
  for (let step = 0; step <= maxSteps; step += 1) {
    const snapshot = deliverySnapshot(clubhouse);
    if (predicate(snapshot)) return snapshot;
    clubhouse.update(100);
  }
  assert.fail(`Timed out waiting for ${label}: ${JSON.stringify(deliverySnapshot(clubhouse))}`);
}

function completeActiveLoadTransfers(clubhouse, expectedBoxIds) {
  const expected = new Set(expectedBoxIds);
  const phasesByBox = new Map(expectedBoxIds.map((boxId) => [boxId, new Set()]));
  for (let step = 0; step <= 90; step += 1) {
    const diagnostics = clubhouse.deliveryBoxPresentationDiagnostics();
    for (const transfer of diagnostics.transfers) {
      if (expected.has(transfer.boxId)) phasesByBox.get(transfer.boxId).add(transfer.phase);
    }
    const completed = diagnostics.recentTransfers.filter((entry) => expected.has(entry.boxId));
    if (completed.length === expected.size) {
      return { diagnostics, completed, phasesByBox };
    }
    clubhouse.update(100);
  }
  assert.fail(`Timed out completing cargo load ${JSON.stringify(expectedBoxIds)}`);
}

test('one 20-box paid arrival makes three exact Ref 41 loads without losing authority', async () => {
  const canvas = fakeCanvas();
  const previousDocument = globalThis.document;
  globalThis.document = fakeDocument(canvas);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const originalLoad = GLTFLoader.prototype.load;
  const geometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const material = new THREE.MeshStandardMaterial({ color: 0xb8905f });
  material.name = 'M_tape';
  const pendingLoads = [];
  GLTFLoader.prototype.load = function loadFixture(url, onLoad) {
    pendingLoads.push(() => {
      const id = String(url).split('/').pop().replace(/\.glb$/i, '');
      onLoad({ scene: fakeLoadedAsset(id, geometry, material), animations: [] });
    });
    return this;
  };

  let clubhouse = null;
  let arrival = null;
  try {
    const state = newGame('relaxed', 4242);
    const delivered = arriveOrder(state, {
      id: 'cargo-twenty',
      skuId: 'driver1',
      qty: 20,
      manifest: {
        supplierId: 'qa-fixture',
        supplier: 'QA Fixture Supply',
        boxes: Array.from({ length: 20 }, () => ({
          kind: 'carton', qty: 1, lb: 1, fragile: false,
        })),
      },
    });
    assert.equal(delivered.length, 20);
    const authorityBefore = delivered.map((box) => ({
      id: box.id,
      qty: box.qty,
      initialQty: box.initialQty,
      cap: box.cap,
      skuId: box.skuId,
      orderId: box.orderId,
      box: box.box,
      loc: box.loc,
    }));
    const expectedLoads = [
      delivered.slice(0, 9).map((box) => box.id),
      delivered.slice(9, 18).map((box) => box.id),
      delivered.slice(18).map((box) => box.id),
    ];

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 500);
    scene.add(camera);
    clubhouse = makeClubhouse({
      scene, camera, state, center: { x: 0, z: 0 }, heightAt: () => 0,
      walkProps: [], propColliders: [],
      walk: { x: 0, z: 0, yaw: 0, pitch: 0, eye: 1.65, radius: 0.35, active: false, moving: false },
      hooks: {}, canvas, focusOn() {}, clearFocus() {},
    });
    for (const finishLoad of pendingLoads.splice(0)) finishLoad();
    await Promise.resolve();
    assert.equal(clubhouse.deliveryEquipmentReady(), true);

    arrival = clubhouse.presentDeliveryArrival({ orderId: 'cargo-twenty', boxCount: 999 });
    assert.ok(arrival);
    assert.equal(arrival.id, 'delivery-order-cargo-twenty');
    assert.equal(arrival.orderId, 'cargo-twenty');
    assert.equal(arrival.loadCount, 3);

    const transferredAcrossTrips = [];
    for (let loadIndex = 0; loadIndex < expectedLoads.length; loadIndex += 1) {
      const expectedBoxIds = expectedLoads[loadIndex];
      const futureBoxIds = expectedLoads.slice(loadIndex + 1).flat();
      const expectedArrivalId = `delivery-order-cargo-twenty-load-${String(loadIndex + 1).padStart(2, '0')}`;
      const mounted = advanceUntil(
        clubhouse,
        ({ equipment, presentation }) => (
          equipment.activeArrival?.id === expectedArrivalId
          && presentation.cargoLoadIndex === loadIndex
          && presentation.cargo.length === expectedBoxIds.length
        ),
        `load ${loadIndex + 1} to mount`,
      );

      assert.equal(mounted.equipment.pendingOrderCounts['cargo-twenty'], 3 - loadIndex,
        'the order must remain pending while this or a later trip still exists');
      assert.equal(mounted.presentation.cargoLoadCount, 3);
      assert.deepEqual(mounted.presentation.cargo.map((entry) => entry.boxId), expectedBoxIds);
      assert.deepEqual(mounted.presentation.overflowBoxIds, futureBoxIds);
      assert.ok(mounted.presentation.cargo.every((entry) => (
        entry.loadIndex === loadIndex
        && entry.state === 'van-cargo-pending'
        && entry.mounted
        && !entry.interactionEnabled
        && !entry.colliderEnabled
      )), JSON.stringify(mounted.presentation.cargo));

      const pendingById = new Map(mounted.presentation.pending.map((entry) => [entry.boxId, entry]));
      assert.deepEqual(sortedIds(pendingById.keys()), sortedIds([...expectedBoxIds, ...futureBoxIds]));
      assert.ok(expectedBoxIds.every((boxId) => (
        pendingById.get(boxId)?.activeCargo
        && pendingById.get(boxId)?.viewMounted
        && !pendingById.get(boxId)?.interactionEnabled
        && !pendingById.get(boxId)?.colliderEnabled
      )));
      assert.ok(futureBoxIds.every((boxId) => {
        const pending = pendingById.get(boxId);
        return pending && !pending.activeCargo && !pending.viewMounted
          && !pending.interactionEnabled && !pending.colliderEnabled
          && !deliveryBoxRoot(scene, boxId);
      }), 'only the exact active load may be visible in the van');

      const unloading = advanceUntil(
        clubhouse,
        ({ presentation }) => (
          presentation.transfers.length === expectedBoxIds.length
          && expectedBoxIds.every((boxId) => (
            presentation.transfers.some((entry) => entry.boxId === boxId)
          ))
        ),
        `load ${loadIndex + 1} to begin unloading`,
      );
      assert.ok(unloading.presentation.transfers.every((entry) => (
        entry.loadIndex === loadIndex
        && entry.pathMode === 'rear-aperture-piecewise'
        && entry.state === 'unloading-transfer'
        && entry.reparentError < 1e-8
        && !entry.interactionEnabled
        && !entry.colliderEnabled
      )), JSON.stringify(unloading.presentation.transfers));
      assert.deepEqual(
        sortedIds(unloading.presentation.pending.map((entry) => entry.boxId)),
        sortedIds(futureBoxIds),
        'unloading may release only this trip; later trip identities stay pending',
      );
      assert.ok(unloading.presentation.pending.every((entry) => (
        !entry.activeCargo && !entry.viewMounted
        && !entry.interactionEnabled && !entry.colliderEnabled
      )));

      const completed = completeActiveLoadTransfers(clubhouse, expectedBoxIds);
      assert.deepEqual(sortedIds(completed.completed.map((entry) => entry.boxId)), sortedIds(expectedBoxIds));
      assert.ok(completed.completed.every((entry) => (
        entry.loadIndex === loadIndex
        && entry.pathMode === 'rear-aperture-piecewise'
        && entry.waypoints.aperture.length === 3
        && entry.waypoints.outside.length === 3
        && entry.reparentError < 1e-8
      )));
      for (const boxId of expectedBoxIds) {
        const phases = completed.phasesByBox.get(boxId);
        assert.ok(phases.has('cargo-to-aperture'), `box ${boxId} never left its cargo rest`);
        assert.ok(phases.has('through-aperture'), `box ${boxId} never traversed the rear aperture`);
        assert.ok(phases.has('outside-to-pallet'), `box ${boxId} never cleared the van`);
        assert.ok(phases.has('pallet-settle'), `box ${boxId} never settled onto the pallet`);
        const root = deliveryBoxRoot(scene, boxId);
        assert.equal(root?.parent?.name, 'DeliveryBoxWorldRoot');
        assert.equal(root?.userData.deliveryPresentationState, 'pallet-ready');
        assert.equal(root?.userData.deliveryInteractionEnabled, true);
      }
      transferredAcrossTrips.push(...completed.completed.map((entry) => entry.boxId));
    }

    const final = advanceUntil(
      clubhouse,
      ({ equipment }) => (
        !equipment.activeArrival
        && equipment.queuedArrivals.length === 0
        && !('cargo-twenty' in equipment.pendingOrderCounts)
      ),
      'the final load to depart and clear pending state',
    );
    const result = await arrival.promise;
    assert.equal(result.status, 'completed');
    assert.equal(result.unloaded, true);
    assert.equal(result.loadCount, 3);
    assert.equal(result.results.length, 3);
    assert.ok(result.results.every((entry) => entry.status === 'completed' && entry.unloaded));
    assert.deepEqual(final.equipment.pendingOrderIds, []);
    assert.deepEqual(final.presentation.pending, []);

    assert.deepEqual(sortedIds(transferredAcrossTrips), sortedIds(delivered.map((box) => box.id)));
    assert.equal(new Set(transferredAcrossTrips).size, 20, 'no identity may unload twice');
    const history = clubhouse.deliveryBoxPresentationDiagnostics().recentTransfers;
    assert.equal(history.length, 20);
    assert.deepEqual(sortedIds(history.map((entry) => entry.boxId)), sortedIds(delivered.map((box) => box.id)));
    assert.ok(history.every((entry) => entry.pathMode === 'rear-aperture-piecewise'));

    const authorityAfter = state.shop.deliveries.boxes
      .filter((box) => box.orderId === 'cargo-twenty')
      .map((box) => ({
        id: box.id,
        qty: box.qty,
        initialQty: box.initialQty,
        cap: box.cap,
        skuId: box.skuId,
        orderId: box.orderId,
        box: box.box,
        loc: box.loc,
      }));
    assert.deepEqual(authorityAfter, authorityBefore, 'presentation cannot mutate ids, quantity, or pad authority');
  } finally {
    if (clubhouse) clubhouse.dispose();
    if (arrival) await arrival.promise;
    GLTFLoader.prototype.load = originalLoad;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
