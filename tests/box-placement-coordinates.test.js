import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOX_PLACEMENT_RAY_MAX_DISTANCE,
  BOX_PLACEMENT_RAY_MIN_DISTANCE,
  placementPreviewWorldPose,
  raycastBoxPlacementSurface,
  surfaceWorldPlane,
} from '../src/render3d/clubhouse/boxPlacementCoordinates.js';

const close = (actual, expected, epsilon = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be close to ${expected}`);
};

const ordinarySurface = (overrides = {}) => ({
  id: 'fixture:test:top',
  kind: 'fixture-surface',
  worldPose: { x: 2, y: 0.8, z: -3, ry: Math.PI / 2 },
  bounds: { minX: -1, maxX: 1, minZ: -0.5, maxZ: 0.5 },
  ...overrides,
});

test('surfaceWorldPlane adds nonzero clubhouse center and floor elevation', () => {
  assert.deepEqual(surfaceWorldPlane(ordinarySurface(), {
    center: { x: 40, z: -12 },
    floorY: 6.25,
  }), {
    x: 42,
    y: 7.05,
    z: -15,
    ry: Math.PI / 2,
  });
});

test('raycastBoxPlacementSurface exactly inverts a rotated fixture yaw', () => {
  const surface = ordinarySurface();
  const runtime = { center: { x: 10, z: 20 }, floorY: 4, maxDistance: 10 };
  const plane = surfaceWorldPlane(surface, runtime);
  // Local (+0.40, -0.20) rotated by +90 degrees becomes world (-0.20, -0.40).
  const target = { x: plane.x - 0.20, y: plane.y, z: plane.z - 0.40 };
  const hit = raycastBoxPlacementSurface(surface, {
    origin: { x: target.x, y: target.y + 2, z: target.z },
    direction: { x: 0, y: -2, z: 0 },
  }, runtime);
  assert.ok(hit);
  close(hit.distance, 2);
  close(hit.localPoint.x, 0.40);
  close(hit.localPoint.z, -0.20);
  assert.deepEqual(hit.point, target);
  assert.deepEqual(hit.plane, plane);
});

test('raycast rejects invalid rays, out-of-bounds hits, and configurable distances', () => {
  const surface = ordinarySurface({
    worldPose: { x: 0, y: 0, z: 0, ry: 0 },
    bounds: { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 },
  });
  const downward = (height, x = 0) => ({
    origin: { x, y: height, z: 0 },
    direction: { x: 0, y: -1, z: 0 },
  });

  assert.equal(raycastBoxPlacementSurface(surface, downward(
    BOX_PLACEMENT_RAY_MIN_DISTANCE - 0.01,
  )), null);
  assert.equal(raycastBoxPlacementSurface(surface, downward(
    BOX_PLACEMENT_RAY_MAX_DISTANCE + 0.01,
  )), null);
  assert.equal(raycastBoxPlacementSurface(surface, downward(1, 0.51)), null);
  assert.equal(raycastBoxPlacementSurface(surface, {
    origin: { x: 0, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 },
  }), null);
  assert.equal(raycastBoxPlacementSurface(surface, {
    origin: { x: null, y: 1, z: 0 }, direction: { x: 0, y: -1, z: 0 },
  }), null);
  assert.equal(raycastBoxPlacementSurface(surface, downward(1), {
    minDistance: 1.1, maxDistance: 2,
  }), null);
  assert.ok(raycastBoxPlacementSurface(surface, downward(1), {
    minDistance: 0.9, maxDistance: 1.1,
  }));
});

test('placementPreviewWorldPose converts an ordinary preview from clubhouse to scene', () => {
  const result = placementPreviewWorldPose({
    ok: true,
    pose: { x: -1.25, z: 3.5, baseY: 0.955, ry: -0.3 },
  }, ordinarySurface(), {
    center: { x: 100, z: 200 },
    floorY: 8,
  });
  assert.deepEqual(result, { x: 98.75, y: 8.955, z: 203.5, ry: -0.3 });
  assert.equal(placementPreviewWorldPose({ ok: false, pose: {} }, ordinarySurface()), null);
});

test('pallet plane and preview use delivery-pad elevation plus only the coupled lift', () => {
  const coupled = ordinarySurface({
    id: 'pallet:receiving:2',
    kind: 'pallet',
    palletIndex: 2,
    worldPose: { x: 5, y: 0.145, z: -8, ry: 0 },
  });
  const runtime = {
    center: { x: 20, z: 30 },
    floorY: 3,
    deliveryPadSurfaceY: 4.25,
    coupledPalletIndex: 2,
    coupledPalletLiftOffset: 0.115,
  };
  assert.deepEqual(surfaceWorldPlane(coupled, runtime), {
    x: 25,
    y: 4.51,
    z: 22,
    ry: 0,
  });
  assert.deepEqual(placementPreviewWorldPose({
    ok: true,
    pose: { x: 5.2, z: -7.8, baseY: 0.325, ry: Math.PI / 2 },
  }, coupled, runtime), {
    x: 25.2,
    y: 4.69,
    z: 22.2,
    ry: Math.PI / 2,
  });

  const uncoupled = { ...coupled, palletIndex: 1 };
  close(surfaceWorldPlane(uncoupled, runtime).y, 4.395);
});

test('live equipment socket position and quaternion override the deterministic fallback', () => {
  const surface = ordinarySurface({
    id: 'equipment:delivery_hand_truck:LOAD_ORIGIN',
    kind: 'equipment-socket',
    equipmentId: 'delivery_hand_truck',
    socketId: 'LOAD_ORIGIN',
    worldPose: { x: 6.1, y: 0.026, z: -5.78, ry: 0.6 },
  });
  const socketYaw = -0.8;
  const socketPitch = 0.35;
  const cy = Math.cos(socketYaw / 2);
  const sy = Math.sin(socketYaw / 2);
  const cp = Math.cos(socketPitch / 2);
  const sp = Math.sin(socketPitch / 2);
  const runtime = {
    center: { x: 100, z: 100 },
    floorY: 20,
    equipmentSocketPose(equipmentId, socketId) {
      assert.equal(equipmentId, 'delivery_hand_truck');
      assert.equal(socketId, 'LOAD_ORIGIN');
      return {
        position: { x: 7.25, y: 1.4, z: -9.5 },
        // Quaternion for wrapper yaw followed by the hand truck's load-frame
        // pitch. Horizontal heading must remain the wrapper yaw.
        quaternion: { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp },
      };
    },
  };
  const plane = surfaceWorldPlane(surface, runtime);
  assert.deepEqual({ x: plane.x, y: plane.y, z: plane.z }, { x: 7.25, y: 1.4, z: -9.5 });
  close(plane.ry, socketYaw);

  const result = placementPreviewWorldPose({
    ok: true,
    pose: { x: 6.1, z: -5.78, baseY: 0.026, ry: 0.6 + Math.PI / 2, localRy: Math.PI / 2 },
  }, surface, runtime);
  assert.deepEqual({ x: result.x, y: result.y, z: result.z }, {
    x: 7.25, y: 1.4, z: -9.5,
  });
  close(result.ry, socketYaw + Math.PI / 2);
});

test('equipment socket falls back deterministically when its runtime pose is unavailable', () => {
  const surface = ordinarySurface({
    kind: 'equipment-socket',
    equipmentId: 'stocking_cart',
    socketId: 'S1_C1',
  });
  const plane = surfaceWorldPlane(surface, {
    center: { x: 10, z: 20 },
    floorY: 2,
    equipmentSocketPose: () => null,
  });
  assert.deepEqual(plane, { x: 12, y: 2.8, z: 17, ry: Math.PI / 2 });
});
