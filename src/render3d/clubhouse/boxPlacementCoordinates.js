// Renderer coordinate adapters for simulation-owned box placement surfaces.
//
// Placement rules operate in clubhouse-local coordinates. These helpers are
// the deliberately small boundary that adds scene/world elevation, raycasts a
// horizontal support plane, and follows live equipment sockets. They contain
// no Three.js types so the math remains deterministic and cheap to unit test.

export const BOX_PLACEMENT_RAY_MIN_DISTANCE = 0.35;
export const BOX_PLACEMENT_RAY_MAX_DISTANCE = 3.2;

const EPSILON = 1e-9;

const finite = (value, fallback = null) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

function runtimeCenter(runtime) {
  return {
    x: finite(runtime?.center?.x, 0),
    z: finite(runtime?.center?.z, 0),
  };
}

function floorY(runtime) {
  return finite(runtime?.floorY, 0);
}

function deliveryPadY(runtime) {
  return finite(runtime?.deliveryPadSurfaceY, floorY(runtime));
}

function coupledPalletLift(surface, runtime) {
  if (!Number.isInteger(surface?.palletIndex)
    || surface.palletIndex !== runtime?.coupledPalletIndex) return 0;
  return finite(
    runtime?.coupledPalletLiftOffset
      ?? runtime?.coupledDeliveryPalletLiftOffset
      ?? runtime?.coupledPalletLift
      ?? runtime?.coupledLiftOffset,
    0,
  );
}

function quaternionYaw(quaternion) {
  const x = finite(quaternion?.x);
  const y = finite(quaternion?.y);
  const z = finite(quaternion?.z);
  const w = finite(quaternion?.w);
  if (x === null || y === null || z === null || w === null) return null;
  // Heading of the socket's local +Z axis projected onto Three's horizontal
  // XZ plane. Unlike a pure-yaw shortcut, this remains exact when a hand truck
  // socket inherits pitch from its tilted load frame.
  return Math.atan2(
    2 * (w * y + x * z),
    1 - 2 * (x * x + y * y),
  );
}

function normalizeSocketPose(value, fallbackRy = 0) {
  if (!value || typeof value !== 'object') return null;
  const position = value.position || value.worldPosition || value;
  const x = finite(position?.x);
  const y = finite(position?.y);
  const z = finite(position?.z);
  if (x === null || y === null || z === null) return null;
  const quaternion = value.quaternion || value.worldQuaternion || position?.quaternion;
  const ry = finite(
    value.ry ?? value.rotationY ?? position?.ry ?? position?.rotationY,
    quaternionYaw(quaternion) ?? fallbackRy,
  );
  return { x, y, z, ry };
}

function isEquipmentSurface(surface) {
  return surface?.kind === 'equipment-socket'
    || surface?.parent?.kind === 'equipment'
    || (typeof surface?.equipmentId === 'string' && typeof surface?.socketId === 'string');
}

function equipmentSocketWorldPose(surface, runtime) {
  if (!isEquipmentSurface(surface) || typeof runtime?.equipmentSocketPose !== 'function') {
    return null;
  }
  const equipmentId = surface.equipmentId || surface.parent?.id;
  const socketId = surface.socketId;
  if (!equipmentId || !socketId) return null;
  let value = null;
  try {
    value = runtime.equipmentSocketPose(equipmentId, socketId);
  } catch {
    return null;
  }
  return normalizeSocketPose(value, finite(surface?.worldPose?.ry, 0));
}

/**
 * Resolve a placement support plane into scene/world coordinates.
 *
 * `surface.worldPose` is simulation-owned and clubhouse-local. Equipment
 * sockets may override it with their authored live world transform; if an
 * asset is unavailable, the stable simulation pose remains the fallback.
 */
export function surfaceWorldPlane(surface, runtime = {}) {
  const pose = surface?.worldPose;
  if (!pose || finite(pose.x) === null || finite(pose.y) === null
    || finite(pose.z) === null || finite(pose.ry) === null) return null;

  const socketPose = equipmentSocketWorldPose(surface, runtime);
  if (socketPose) return socketPose;

  const center = runtimeCenter(runtime);
  const pallet = surface?.kind === 'pallet' || Number.isInteger(surface?.palletIndex);
  const baseY = pallet ? deliveryPadY(runtime) : floorY(runtime);
  return {
    x: center.x + pose.x,
    y: baseY + pose.y + (pallet ? coupledPalletLift(surface, runtime) : 0),
    z: center.z + pose.z,
    ry: pose.ry,
  };
}

function rayDistanceLimit(runtime, kind, fallback) {
  const capitalized = kind === 'min' ? 'Min' : 'Max';
  return finite(
    runtime?.[`${kind}Distance`]
      ?? runtime?.[`${kind}RayDistance`]
      ?? runtime?.[`ray${capitalized}Distance`]
      ?? runtime?.rayDistance?.[kind]
      ?? runtime?.[`boxPlacement${capitalized}Distance`]
      ?? runtime?.[`${kind}PlacementDistance`],
    fallback,
  );
}

/**
 * Raycast one horizontal placement support and return both world and
 * surface-local hit coordinates. Direction need not be normalized.
 */
export function raycastBoxPlacementSurface(surface, ray, runtime = {}) {
  const plane = surfaceWorldPlane(surface, runtime);
  const origin = ray?.origin;
  const direction = ray?.direction;
  const ox = finite(origin?.x);
  const oy = finite(origin?.y);
  const oz = finite(origin?.z);
  const dx = finite(direction?.x);
  const dy = finite(direction?.y);
  const dz = finite(direction?.z);
  if (!plane || ox === null || oy === null || oz === null
    || dx === null || dy === null || dz === null || Math.abs(dy) <= EPSILON) return null;

  const directionLength = Math.hypot(dx, dy, dz);
  if (!(directionLength > EPSILON)) return null;
  const parameter = (plane.y - oy) / dy;
  if (!Number.isFinite(parameter) || parameter < 0) return null;
  const distance = parameter * directionLength;
  const minDistance = rayDistanceLimit(
    runtime,
    'min',
    BOX_PLACEMENT_RAY_MIN_DISTANCE,
  );
  const maxDistance = rayDistanceLimit(
    runtime,
    'max',
    BOX_PLACEMENT_RAY_MAX_DISTANCE,
  );
  if (!(minDistance >= 0) || !(maxDistance >= minDistance)
    || distance < minDistance - EPSILON || distance > maxDistance + EPSILON) return null;

  const point = {
    x: ox + dx * parameter,
    y: plane.y,
    z: oz + dz * parameter,
  };
  const offsetX = point.x - plane.x;
  const offsetZ = point.z - plane.z;
  const cosine = Math.cos(plane.ry);
  const sine = Math.sin(plane.ry);
  const localPoint = {
    x: cosine * offsetX - sine * offsetZ,
    z: sine * offsetX + cosine * offsetZ,
  };
  const bounds = surface?.bounds;
  if (!bounds || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX)
    || !Number.isFinite(bounds.minZ) || !Number.isFinite(bounds.maxZ)
    || localPoint.x < bounds.minX - EPSILON || localPoint.x > bounds.maxX + EPSILON
    || localPoint.z < bounds.minZ - EPSILON || localPoint.z > bounds.maxZ + EPSILON) {
    return null;
  }
  return { distance, point, localPoint, plane };
}

/**
 * Convert a successful pure preview pose to the scene transform used by the
 * reusable green/red placement ghost.
 */
export function placementPreviewWorldPose(preview, surface, runtime = {}) {
  if (preview?.ok !== true || !preview.pose || !surface) return null;
  const pose = preview.pose;
  const poseX = finite(pose.x);
  const poseZ = finite(pose.z);
  const baseY = finite(pose.baseY ?? pose.y);
  const poseRy = finite(pose.ry);
  if (poseX === null || poseZ === null || baseY === null || poseRy === null) return null;

  if (isEquipmentSurface(surface)) {
    const plane = surfaceWorldPlane(surface, runtime);
    if (!plane) return null;
    const surfaceRy = finite(surface?.worldPose?.ry, 0);
    const localRy = finite(pose.localRy, poseRy - surfaceRy);
    return {
      x: plane.x,
      y: plane.y,
      z: plane.z,
      ry: plane.ry + localRy,
    };
  }

  const center = runtimeCenter(runtime);
  const pallet = surface.kind === 'pallet' || Number.isInteger(surface.palletIndex);
  return {
    x: center.x + poseX,
    y: (pallet ? deliveryPadY(runtime) : floorY(runtime))
      + baseY
      + (pallet ? coupledPalletLift(surface, runtime) : 0),
    z: center.z + poseZ,
    ry: poseRy,
  };
}
