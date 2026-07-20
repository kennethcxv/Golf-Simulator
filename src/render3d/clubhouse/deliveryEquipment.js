import * as THREE from 'three';
import { STOCKROOM } from '../../data/shopLayout.js';

// Refs 41-45 stay articulated at runtime. In particular, do not pass these
// roots through merch.bake(): the van doors, wheels, cart casters, hand-truck
// wheels, and pallet-jack lift/steering pivots are part of their game contract.
export const DELIVERY_EQUIPMENT_ASSETS = Object.freeze({
  delivery_van: Object.freeze({
    id: 'delivery_van', alias: 'van', reference: '41', zone: 'exterior', static: false,
    interactionNode: 'RIGHT_DOOR_LOADING_ANCHOR',
  }),
  delivery_hand_truck: Object.freeze({
    id: 'delivery_hand_truck', alias: 'handTruck', reference: '42', zone: 'interior', static: true,
    interactionNode: 'INTERACTION_TARGET',
  }),
  delivery_stocking_cart: Object.freeze({
    id: 'delivery_stocking_cart', alias: 'stockingCart', reference: '43', zone: 'interior', static: true,
    interactionNode: 'INTERACTION_TARGET',
  }),
  delivery_pallet_jack: Object.freeze({
    id: 'delivery_pallet_jack', alias: 'palletJack', reference: '45', zone: 'exterior', static: true,
    interactionNode: 'HANDLE_GRIP_TARGET',
  }),
});

// Clubhouse-local metres/yards are currently treated one-for-one by the world
// renderer. Exterior positions can be converted through localToWorld and
// grounded through exteriorGroundY/groundYAt when the exterior root is parented
// directly to the course scene. Interior props normally remain under the
// clubhouse interior root at local y=0.
export const DELIVERY_EQUIPMENT_DEFAULT_LAYOUT = Object.freeze({
  delivery_van: Object.freeze({ x: 16.5, y: 0, z: 0, ry: -Math.PI / 2 }),
  delivery_hand_truck: Object.freeze({
    x: STOCKROOM.handTruck.x, y: 0, z: STOCKROOM.handTruck.z, ry: 0.6,
  }),
  delivery_stocking_cart: Object.freeze({ x: 6.35, y: 0, z: -3.4, ry: 0 }),
  // Safe pre-coupling fallback for Ref 45. Once both authored assets are ready,
  // couplePalletJackToPallet() replaces this pose by mapping the jack's -X fork
  // direction onto Ref 44's PALLET_JACK_ENTRY -> pallet-centre direction and by
  // snapping PALLET_COUPLING_SOCKET horizontally to that centre.
  delivery_pallet_jack: Object.freeze({ x: 14.35, y: 0, z: 0.895, ry: -Math.PI / 2 }),
});

export const DELIVERY_VAN_ROUTE = Object.freeze({
  approachOffset: Object.freeze({ x: 0, y: 0, z: 9 }),
  departureOffset: Object.freeze({ x: 0, y: 0, z: -9 }),
});

export const DELIVERY_VAN_ARRIVAL_DURATIONS = Object.freeze({
  approach: 3.8,
  settle: 0.25,
  opening: 0.85,
  openHold: 0.65,
  // Nine dimension-aware cartons use a 1.35 s piecewise rear-aperture path
  // with 0.11 s stagger; keep the doors fully open until the final pallet seat.
  unloading: 2.35,
  closing: 0.75,
  departing: 3.0,
});

export const DELIVERY_HAND_TRUCK_TILT_ACTION = Object.freeze({
  tipBack: 0.28,
  hold: 0.16,
  return: 0.34,
  tiltDegrees: -18,
  wheelSpinRadians: 0.9,
});

export const DELIVERY_PALLET_JACK_PUMP_ACTION = Object.freeze({
  handleDown: 0.24,
  lift: 0.30,
  handleReturn: 0.28,
  // The authored Blender stroke is -28 degrees around +Y. In glTF/Three that
  // is the same signed rotation around local -Z, so the Euler-Z delta is +28.
  authoredHandleDegrees: -28,
});

export const DELIVERY_VAN_BEATS = Object.freeze({
  QUEUED: 'queued',
  APPROACH: 'approach',
  PARKED: 'parked',
  DOORS_OPENING: 'doors-opening',
  CARGO_OPEN: 'cargo-open',
  UNLOAD: 'unload',
  DOORS_CLOSING: 'doors-closing',
  DEPARTING: 'departing',
  COMPLETE: 'complete',
});

const SPECS = Object.values(DELIVERY_EQUIPMENT_ASSETS);
const VAN_ID = DELIVERY_EQUIPMENT_ASSETS.delivery_van.id;
const STOCKING_CART_ID = DELIVERY_EQUIPMENT_ASSETS.delivery_stocking_cart.id;
const PALLET_JACK_ID = DELIVERY_EQUIPMENT_ASSETS.delivery_pallet_jack.id;
const STOCKING_CART_LOGICAL_BOX_SOCKET = 'STOCK_BOX_SOCKET_TOP';
const STATIC_IDS = SPECS.filter((spec) => spec.static).map((spec) => spec.id);
const HELPER_NAME = /^(?:COL_|COLLISION_|VOLUME_)/i;
const SOCKET_MESH_NAME = /(?:^|_)(?:SOCKET|ANCHOR|TARGET)(?:_|$)/i;
const VAN_WHEELS = Object.freeze([
  'WHEEL_FRONT_LEFT_PIVOT', 'WHEEL_FRONT_RIGHT_PIVOT',
  'WHEEL_REAR_LEFT_PIVOT', 'WHEEL_REAR_RIGHT_PIVOT',
]);
const VAN_STEERING = Object.freeze([
  'WHEEL_FRONT_LEFT_STEER_PIVOT', 'WHEEL_FRONT_RIGHT_STEER_PIVOT',
]);
const VAN_DOORS = Object.freeze({
  sliding: 'SLIDING_CARGO_DOOR_RIGHT_PIVOT',
  rearLeft: 'REAR_CARGO_DOOR_LEFT_HINGE_PIVOT',
  rearRight: 'REAR_CARGO_DOOR_RIGHT_HINGE_PIVOT',
});
const HAND_TRUCK_WHEELS = Object.freeze(['WHEEL_LEFT_PIVOT', 'WHEEL_RIGHT_PIVOT']);
const EMPTY_COLLIDER_DESCRIPTORS = Object.freeze([]);
const EMPTY_COLLIDER_DESCRIPTOR_MAP = new Map();

function runtimeAxis(value, fallback) {
  const normalized = String(value || fallback).toUpperCase().replace(/[^XYZ+-]/g, '');
  const match = normalized.match(/([+-]?)([XYZ])/);
  if (!match) return runtimeAxis(fallback, '+Y');
  return {
    label: `${match[1] === '-' ? '-' : '+'}${match[2]}`,
    property: match[2].toLowerCase(),
    sign: match[1] === '-' ? -1 : 1,
  };
}

function runtimeDirection(value, fallback = '-X') {
  const text = String(value || '');
  const runtime = text.match(/runtime[^+\-XYZ]*([+\-])\s*([XYZ])/i);
  const direct = text.match(/([+\-])\s*([XYZ])/i);
  const match = runtime || direct || String(fallback).match(/([+\-])\s*([XYZ])/i);
  const direction = new THREE.Vector3();
  const axis = String(match?.[2] || 'X').toUpperCase();
  direction[axis.toLowerCase()] = match?.[1] === '+' ? 1 : -1;
  return {
    label: `${match?.[1] === '+' ? '+' : '-'}${axis}`,
    direction,
  };
}

function normalizedYaw(value) {
  return THREE.MathUtils.euclideanModulo(value + Math.PI, Math.PI * 2) - Math.PI;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smooth(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function cloneLayout(layout) {
  return {
    x: Number(layout?.x) || 0,
    y: Number(layout?.y) || 0,
    z: Number(layout?.z) || 0,
    ry: Number(layout?.ry ?? layout?.rotationY) || 0,
    visible: layout?.visible !== false,
  };
}

function mergeLayout(previous, input) {
  const position = input?.position;
  const px = Array.isArray(position) ? position[0] : position?.x;
  const py = Array.isArray(position) ? position[1] : position?.y;
  const pz = Array.isArray(position) ? position[2] : position?.z;
  return {
    x: Number.isFinite(Number(input?.x ?? px)) ? Number(input?.x ?? px) : previous.x,
    y: Number.isFinite(Number(input?.y ?? py)) ? Number(input?.y ?? py) : previous.y,
    z: Number.isFinite(Number(input?.z ?? pz)) ? Number(input?.z ?? pz) : previous.z,
    ry: Number.isFinite(Number(input?.ry ?? input?.rotationY))
      ? Number(input?.ry ?? input?.rotationY) : previous.ry,
    visible: input?.visible == null ? previous.visible : !!input.visible,
  };
}

function assetIdFor(value) {
  const key = typeof value === 'string' ? value : value?.id;
  if (!key) return null;
  if (DELIVERY_EQUIPMENT_ASSETS[key]) return key;
  const lower = String(key).toLowerCase().replace(/[\s_-]/g, '');
  return SPECS.find((spec) => (
    spec.alias.toLowerCase() === String(key).toLowerCase()
    || spec.alias.toLowerCase().replace(/[\s_-]/g, '') === lower
    || spec.id.toLowerCase().replace(/[\s_-]/g, '') === lower
  ))?.id || null;
}

function authoringHelper(object) {
  return !!(
    object?.userData?.helper
    || object?.userData?.collision_proxy
    || HELPER_NAME.test(String(object?.name || ''))
  );
}

function socketLike(object) {
  return !!(
    object?.userData?.anchor_kind
    || SOCKET_MESH_NAME.test(String(object?.name || ''))
  );
}

function hideAuthoringGeometry(root) {
  root?.traverse?.((object) => {
    if (authoringHelper(object)) object.visible = false;
    if (object.isMesh && socketLike(object)) object.visible = false;
    if (object.isMesh && !authoringHelper(object) && !socketLike(object)) {
      object.castShadow = true;
      object.receiveShadow = false;
    }
  });
}

function indexNamedNodes(root) {
  const nodes = new Map();
  root?.traverse?.((object) => {
    if (object.name && !nodes.has(object.name)) nodes.set(object.name, object);
  });
  return nodes;
}

function resourcesIn(roots) {
  const resources = { geometries: new Set(), materials: new Set(), textures: new Set() };
  for (const root of roots) {
    root?.traverse?.((object) => {
      if (object.geometry) resources.geometries.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        resources.materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) resources.textures.add(value);
        }
      }
    });
  }
  return resources;
}

function snapshotResources(resources) {
  return {
    geometries: new Set(resources?.geometries || []),
    materials: new Set(resources?.materials || []),
    textures: new Set(resources?.textures || []),
  };
}

function durationTable(overrides = null) {
  const out = {};
  for (const [phase, fallback] of Object.entries(DELIVERY_VAN_ARRIVAL_DURATIONS)) {
    // The diagnostic phase is deliberately human-readable (`open-hold`),
    // while the public duration table follows the existing camelCase option
    // style. Accept the hyphenated spelling too so a caller can key an
    // override directly from diagnostics without breaking older overrides.
    const supplied = phase === 'openHold'
      ? overrides?.openHold ?? overrides?.['open-hold']
      : overrides?.[phase];
    const value = Number(supplied);
    out[phase] = Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  return out;
}

function arrivalPhaseDuration(entry, phase = entry?.phase) {
  const key = phase === 'open-hold' ? 'openHold' : phase;
  return Math.max(0, Number(entry?.durations?.[key]) || 0);
}

function callbackFor(container, beat) {
  if (!container || typeof container !== 'object') return null;
  return typeof container[beat] === 'function' ? container[beat] : null;
}

/**
 * Build articulated delivery props from a createMerch-compatible loader.
 *
 * `parents.interior` should normally be the clubhouse interior Object3D.
 * `parents.exterior` may be a zero-origin course root, or callers can supply
 * localToWorld(lx, lz) and groundYAt(wx, wz) to place clubhouse-local exterior
 * poses directly into the world scene.
 */
export function createDeliveryEquipment({
  merch,
  parent = null,
  parents = null,
  layout = null,
  localToWorld = null,
  groundYAt = null,
  exteriorGroundY = null,
  arrivalDurations = null,
  handTruckAction = null,
  palletJackAction = null,
  onBeat = null,
  onUnload = null,
  onAssetsReady = null,
  onError = null,
} = {}) {
  if (!merch || (typeof merch.instantiateRaw !== 'function' && typeof merch.instantiate !== 'function')) {
    throw new TypeError('createDeliveryEquipment requires a createMerch-compatible loader');
  }

  const interiorRoot = new THREE.Group();
  interiorRoot.name = 'DeliveryEquipmentInteriorRoot';
  const exteriorRoot = new THREE.Group();
  exteriorRoot.name = 'DeliveryEquipmentExteriorRoot';
  (parents?.interior || parent)?.add?.(interiorRoot);
  (parents?.exterior || parent)?.add?.(exteriorRoot);

  const wrappers = new Map();
  const modelRoots = new Map();
  const renderedInstances = new Map();
  const namedNodes = new Map();
  const colliderCaches = new Map();
  const layouts = new Map();
  const readyCallbacks = new Set();
  const pendingOrderCounts = new Map();
  const arrivalQueue = [];
  const arrivalsById = new Map();
  const beatHistory = [];
  const callbackErrors = [];
  let publicApi = null;
  let ready = false;
  let disposed = false;
  let disposalSummary = null;
  let activeArrival = null;
  let autoArrivalId = 0;
  let vanRig = null;
  let handTruckRig = null;
  let palletJackRig = null;
  let palletJackCoupling = null;
  const handTruckState = {
    active: false, phase: 'idle', elapsed: 0, progress: 0, cycles: 0,
  };
  const palletJackState = {
    active: false, phase: 'idle', elapsed: 0, progress: 0,
    liftProgress: 0, raised: false, targetRaised: false, cycles: 0,
  };
  const handTruckConfig = {
    ...DELIVERY_HAND_TRUCK_TILT_ACTION,
    ...(handTruckAction || {}),
  };
  const palletJackConfig = {
    ...DELIVERY_PALLET_JACK_PUMP_ACTION,
    ...(palletJackAction || {}),
  };
  for (const key of ['tipBack', 'hold', 'return']) {
    const value = Number(handTruckConfig[key]);
    handTruckConfig[key] = Number.isFinite(value) && value >= 0
      ? value : DELIVERY_HAND_TRUCK_TILT_ACTION[key];
  }
  for (const key of ['handleDown', 'lift', 'handleReturn']) {
    const value = Number(palletJackConfig[key]);
    palletJackConfig[key] = Number.isFinite(value) && value >= 0
      ? value : DELIVERY_PALLET_JACK_PUMP_ACTION[key];
  }

  if (typeof onAssetsReady === 'function') readyCallbacks.add(onAssetsReady);

  for (const spec of SPECS) {
    const authored = mergeLayout(
      cloneLayout(DELIVERY_EQUIPMENT_DEFAULT_LAYOUT[spec.id]),
      layout?.[spec.id] || layout?.[spec.alias] || null,
    );
    layouts.set(spec.id, authored);
    const wrapper = new THREE.Group();
    wrapper.name = `DeliveryEquipmentRoot_${spec.id}`;
    wrapper.userData.deliveryEquipmentId = spec.id;
    wrapper.userData.referenceId = spec.reference;
    wrapper.userData.zone = spec.zone;
    wrapper.userData.staticProp = spec.static;
    wrappers.set(spec.id, wrapper);
    (spec.zone === 'interior' ? interiorRoot : exteriorRoot).add(wrapper);
  }

  function resolvedPose(spec, localPose) {
    let x = localPose.x;
    let z = localPose.z;
    if (spec.zone === 'exterior' && typeof localToWorld === 'function') {
      const converted = localToWorld(localPose.x, localPose.z, spec.id) || {};
      if (Number.isFinite(Number(converted.x))) x = Number(converted.x);
      if (Number.isFinite(Number(converted.z))) z = Number(converted.z);
    }
    let y = localPose.y;
    if (spec.zone === 'exterior') {
      if (typeof groundYAt === 'function') {
        const grounded = Number(groundYAt(x, z, spec.id));
        if (Number.isFinite(grounded)) y = grounded + localPose.y;
      } else if (Number.isFinite(Number(exteriorGroundY))) {
        y = Number(exteriorGroundY) + localPose.y;
      }
    }
    return { x, y, z, ry: localPose.ry, visible: localPose.visible };
  }

  function applyWrapperPose(spec, pose) {
    const wrapper = wrappers.get(spec.id);
    const resolved = resolvedPose(spec, pose);
    const moved = wrapper.position.x !== resolved.x
      || wrapper.position.y !== resolved.y
      || wrapper.position.z !== resolved.z
      || wrapper.rotation.x !== 0
      || wrapper.rotation.y !== resolved.ry
      || wrapper.rotation.z !== 0;
    wrapper.position.set(resolved.x, resolved.y, resolved.z);
    wrapper.rotation.set(0, resolved.ry, 0);
    wrapper.visible = spec.id === VAN_ID ? false : resolved.visible;
    if (moved) markColliderPoseDirty(spec.id);
    return wrapper;
  }

  for (const spec of SPECS) applyWrapperPose(spec, layouts.get(spec.id));

  function node(asset, name) {
    const id = assetIdFor(asset);
    return id ? namedNodes.get(id)?.get(name) || null : null;
  }

  function markColliderPoseDirty(asset) {
    const id = assetIdFor(asset);
    const cache = id ? colliderCaches.get(id) : null;
    if (cache) cache.poseRevision += 1;
  }

  function buildColliderCache(id, root) {
    const helpers = [];
    const matrixNodeSet = new Set();
    root.traverse((object) => {
      if (!object.isMesh || !object.geometry || !authoringHelper(object)) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox?.();
      if (!object.geometry.boundingBox) return;

      const bounds = new THREE.Box3();
      const descriptor = Object.freeze({
        equipmentId: id,
        name: object.name,
        kind: 'delivery-equipment',
        get minX() { return bounds.min.x; },
        get maxX() { return bounds.max.x; },
        get minY() { return bounds.min.y; },
        get maxY() { return bounds.max.y; },
        get minZ() { return bounds.min.z; },
        get maxZ() { return bounds.max.z; },
        object,
      });
      helpers.push({ object, localBounds: object.geometry.boundingBox, bounds, descriptor });

      // Cache only the authored branches that lead to collision helpers. A
      // refresh updates these nodes in parent-first order instead of walking
      // every visible mesh in the GLB (121 nodes for Ref 41).
      for (let cursor = object; cursor && cursor !== root; cursor = cursor.parent) {
        matrixNodeSet.add(cursor);
      }
    });

    const depthFromRoot = (object) => {
      let depth = 0;
      for (let cursor = object; cursor && cursor !== root; cursor = cursor.parent) depth += 1;
      return depth;
    };
    const matrixNodes = [...matrixNodeSet]
      .sort((first, second) => depthFromRoot(first) - depthFromRoot(second));
    const descriptors = Object.freeze(helpers.map((entry) => entry.descriptor));
    const byName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
    colliderCaches.set(id, {
      id,
      root,
      helpers,
      matrixNodes,
      descriptors,
      byName,
      poseRevision: 0,
      boundsRevision: -1,
      refreshes: 0,
    });
  }

  function refreshColliderCache(cache) {
    if (!cache || cache.boundsRevision === cache.poseRevision) return cache;
    cache.root.updateWorldMatrix(true, false);
    for (const object of cache.matrixNodes) object.updateWorldMatrix(false, false);
    for (const entry of cache.helpers) {
      entry.bounds.copy(entry.localBounds).applyMatrix4(entry.object.matrixWorld);
    }
    cache.boundsRevision = cache.poseRevision;
    cache.refreshes += 1;
    return cache;
  }

  function captureVanRig() {
    const sliding = node(VAN_ID, VAN_DOORS.sliding);
    const rearLeft = node(VAN_ID, VAN_DOORS.rearLeft);
    const rearRight = node(VAN_ID, VAN_DOORS.rearRight);
    const wheels = VAN_WHEELS.map((name) => node(VAN_ID, name)).filter(Boolean);
    const steering = VAN_STEERING.map((name) => node(VAN_ID, name)).filter(Boolean);
    vanRig = {
      sliding,
      rearLeft,
      rearRight,
      wheels,
      steering,
      slidingBase: sliding?.position.clone() || null,
      slidingTravel: Number(sliding?.userData?.travel_m) || 1.32,
      rearLeftBase: rearLeft?.rotation.clone() || null,
      rearRightBase: rearRight?.rotation.clone() || null,
      rearLeftAngle: THREE.MathUtils.degToRad(Number(rearLeft?.userData?.open_angle_degrees) || 78),
      rearRightAngle: THREE.MathUtils.degToRad(Number(rearRight?.userData?.open_angle_degrees) || -78),
      wheelBases: wheels.map((pivot) => pivot.rotation.clone()),
      steeringBases: steering.map((pivot) => pivot.rotation.clone()),
    };
  }

  function ensureLogicalStockingCartSocket(instance, authoredRoot) {
    const indexed = indexNamedNodes(instance);
    if (indexed.has(STOCKING_CART_LOGICAL_BOX_SOCKET)) return;
    const left = indexed.get('STOCK_SOCKET_05');
    const right = indexed.get('STOCK_SOCKET_06');
    if (!left || !right || !authoredRoot) return;

    // The saved placement contract includes one 0.62 x 0.42 m sealed-carton
    // position spanning both small top-deck item sockets. It intentionally is
    // not extra Blender geometry. Derive a stable Object3D at their world-space
    // midpoint so callers can resolve every persisted socket ID through the
    // same renderer query without inventing an unrelated coordinate.
    authoredRoot.updateWorldMatrix(true, true);
    const leftPosition = left.getWorldPosition(new THREE.Vector3());
    const rightPosition = right.getWorldPosition(new THREE.Vector3());
    const midpoint = leftPosition.add(rightPosition).multiplyScalar(0.5);
    const worldQuaternion = left.getWorldQuaternion(new THREE.Quaternion());
    const worldMatrix = new THREE.Matrix4().compose(midpoint, worldQuaternion, new THREE.Vector3(1, 1, 1));
    const localMatrix = authoredRoot.matrixWorld.clone().invert().multiply(worldMatrix);
    const logical = new THREE.Group();
    logical.name = STOCKING_CART_LOGICAL_BOX_SOCKET;
    localMatrix.decompose(logical.position, logical.quaternion, logical.scale);
    Object.assign(logical.userData, {
      anchor_kind: 'stocking_cart_box_socket',
      allowed_category: 'delivery_box',
      logical: true,
      derived_from: 'STOCK_SOCKET_05,STOCK_SOCKET_06',
      max_w: 0.62,
      max_d: 0.42,
      max_h: 0.50,
    });
    authoredRoot.add(logical);
    logical.updateWorldMatrix(true, false);
  }

  function captureHandTruckRig() {
    const wrapper = wrappers.get(DELIVERY_EQUIPMENT_ASSETS.delivery_hand_truck.id);
    const instance = renderedInstances.get(DELIVERY_EQUIPMENT_ASSETS.delivery_hand_truck.id);
    const axle = node('delivery_hand_truck', 'AXLE_ASSEMBLY');
    const wheels = HAND_TRUCK_WHEELS.map((name) => node('delivery_hand_truck', name)).filter(Boolean);
    if (!wrapper || !instance || !axle || wheels.length !== HAND_TRUCK_WHEELS.length) return;

    wrapper.updateWorldMatrix(true, true);
    const axleAt = axle.getWorldPosition(new THREE.Vector3());
    wrapper.worldToLocal(axleAt);
    const tiltPivot = new THREE.Group();
    tiltPivot.name = 'DeliveryHandTruckOperationalTiltPivot';
    tiltPivot.userData.runtimeOperationalPivot = true;
    tiltPivot.position.copy(axleAt);
    wrapper.add(tiltPivot);
    // Preserve the instance's world transform while inserting the operational
    // wheel-axle pivot above it. No authored child is reparented or baked.
    tiltPivot.attach(instance);
    handTruckRig = {
      tiltPivot,
      tiltBase: tiltPivot.rotation.clone(),
      wheels,
      wheelBases: wheels.map((wheel) => wheel.rotation.clone()),
    };
  }

  function capturePalletJackRig() {
    const handle = node('delivery_pallet_jack', 'HANDLE_TILT_PIVOT');
    const lift = node('delivery_pallet_jack', 'FORK_LIFT_SLIDE');
    const coupling = node('delivery_pallet_jack', 'PALLET_COUPLING_SOCKET');
    if (!handle || !lift || !coupling) return;
    // Only explicit runtime-axis metadata is trusted. The current export has
    // Blender-axis labels, so use the known glTF conversion fallbacks: handle
    // +Y -> Three -Z, fork lift +Z -> Three +Y.
    const handleAxis = runtimeAxis(
      handle.userData?.rotation_axis_runtime || handle.userData?.pump_axis_runtime,
      '-Z',
    );
    const liftAxis = runtimeAxis(
      lift.userData?.motion_axis_runtime || lift.userData?.lift_axis_runtime,
      '+Y',
    );
    const minimum = Number(
      lift.userData?.minimum_runtime_y_m
      ?? lift.userData?.minimum_runtime_m
      ?? lift.userData?.minimum_y_m
      ?? lift.userData?.minimum_z_m,
    );
    const maximum = Number(
      lift.userData?.maximum_runtime_y_m
      ?? lift.userData?.maximum_runtime_m
      ?? lift.userData?.maximum_y_m
      ?? lift.userData?.maximum_z_m,
    );
    palletJackRig = {
      handle,
      lift,
      coupling,
      handleAxis,
      liftAxis,
      handleBase: handle.rotation.clone(),
      liftBase: lift.position.clone(),
      liftRange: Number.isFinite(minimum) && Number.isFinite(maximum) && maximum > minimum
        ? maximum - minimum : 0.12,
    };
  }

  function palletJackLiftOffset() {
    if (!palletJackRig) return 0;
    const axis = palletJackRig.liftAxis;
    const delta = palletJackRig.lift.position[axis.property]
      - palletJackRig.liftBase[axis.property];
    const offset = delta * axis.sign;
    return Math.abs(offset) < 1e-12 ? 0 : offset;
  }

  function palletJackCouplingStatus() {
    if (!palletJackCoupling || !palletJackRig || disposed) return null;
    const wrapper = wrappers.get(PALLET_JACK_ID);
    const target = palletJackCoupling.palletRoot.getWorldPosition(new THREE.Vector3());
    const socket = palletJackRig.coupling.getWorldPosition(new THREE.Vector3());
    const worldFork = palletJackCoupling.localForkDirection.clone()
      .applyQuaternion(wrapper.getWorldQuaternion(new THREE.Quaternion()));
    worldFork.y = 0;
    if (worldFork.lengthSq() > 1e-12) worldFork.normalize();
    const channel = palletJackCoupling.channelDirection;
    const alignment = THREE.MathUtils.clamp(worldFork.dot(channel), -1, 1);
    const socketHorizontalError = Math.hypot(socket.x - target.x, socket.z - target.z);
    return Object.freeze({
      coupledPalletIndex: palletJackCoupling.palletIndex,
      palletEntryNode: palletJackCoupling.entry.name,
      palletCouplingSocket: palletJackRig.coupling.name,
      authoredForkDirection: palletJackCoupling.localForkLabel,
      channelDirection: palletJackCoupling.channelLabel,
      channelAlignmentDot: alignment,
      channelAlignmentErrorDegrees: THREE.MathUtils.radToDeg(Math.acos(alignment)),
      channelAligned: alignment >= 0.9999,
      socketHorizontalError,
      rootGroundY: wrapper.getWorldPosition(new THREE.Vector3()).y,
      surfaceY: palletJackCoupling.surfaceY,
      liftOffset: palletJackLiftOffset(),
    });
  }

  // Ref 44 exposes PALLET_JACK_ENTRY on the open side of its +/-Z channels.
  // Ref 45 exposes PALLET_COUPLING_SOCKET with pallet-centre semantics. This
  // routine consumes those authored transforms instead of placing the two
  // assets independently and hoping their silhouettes overlap.
  function couplePalletJackToPallet({
    palletRoot,
    palletIndex = null,
    entryName = 'PALLET_JACK_ENTRY',
    surfaceY = null,
  } = {}) {
    if (disposed || !palletJackRig || !palletRoot?.isObject3D) {
      return Object.freeze({ ok: false, reason: 'pallet-jack-or-pallet-unavailable' });
    }
    const entry = palletRoot.getObjectByName?.(entryName) || null;
    const coupling = palletJackRig.coupling;
    if (!entry || entry.userData?.anchor_kind !== 'pallet_jack_entry') {
      return Object.freeze({ ok: false, reason: 'authored-pallet-entry-missing' });
    }
    if (coupling.userData?.target_semantics !== 'pallet_center'
      || coupling.userData?.approach_anchor !== entryName) {
      return Object.freeze({ ok: false, reason: 'authored-coupling-semantics-mismatch' });
    }

    palletRoot.updateWorldMatrix(true, true);
    const target = palletRoot.getWorldPosition(new THREE.Vector3());
    const entryWorld = entry.getWorldPosition(new THREE.Vector3());
    const channelDirection = target.clone().sub(entryWorld);
    channelDirection.y = 0;
    if (channelDirection.lengthSq() <= 1e-12) {
      return Object.freeze({ ok: false, reason: 'authored-pallet-entry-has-no-direction' });
    }
    channelDirection.normalize();

    const modelRoot = modelRoots.get(PALLET_JACK_ID);
    const authoredFork = runtimeDirection(
      coupling.userData?.fork_direction_runtime
        || modelRoot?.userData?.fork_direction_runtime
        || modelRoot?.userData?.front,
      '-X',
    );
    authoredFork.direction.y = 0;
    authoredFork.direction.normalize();
    const localAngle = Math.atan2(authoredFork.direction.z, authoredFork.direction.x);
    const channelAngle = Math.atan2(channelDirection.z, channelDirection.x);
    const worldYaw = normalizedYaw(localAngle - channelAngle);

    const wrapper = wrappers.get(PALLET_JACK_ID);
    const wrapperParent = wrapper.parent;
    wrapperParent?.updateWorldMatrix?.(true, false);
    const parentWorldRotation = wrapperParent
      ? wrapperParent.getWorldQuaternion(new THREE.Quaternion())
      : new THREE.Quaternion();
    const desiredWorldRotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      worldYaw,
    );
    wrapper.quaternion.copy(parentWorldRotation.invert().multiply(desiredWorldRotation));

    const resolvedSurfaceY = Number.isFinite(Number(surfaceY))
      ? Number(surfaceY) : target.y;
    const provisionalWorld = new THREE.Vector3(target.x, resolvedSurfaceY, target.z);
    wrapper.position.copy(wrapperParent
      ? wrapperParent.worldToLocal(provisionalWorld.clone())
      : provisionalWorld);
    wrapper.updateWorldMatrix(true, true);
    const socketWorld = coupling.getWorldPosition(new THREE.Vector3());
    const rootWorld = wrapper.getWorldPosition(new THREE.Vector3());
    rootWorld.x += target.x - socketWorld.x;
    rootWorld.z += target.z - socketWorld.z;
    rootWorld.y = resolvedSurfaceY;
    wrapper.position.copy(wrapperParent
      ? wrapperParent.worldToLocal(rootWorld.clone())
      : rootWorld);
    wrapper.visible = true;
    wrapper.updateWorldMatrix(true, true);
    markColliderPoseDirty(PALLET_JACK_ID);

    const runtimeChannel = runtimeDirection(entry.userData?.entry_direction_runtime, '-Z');
    palletJackCoupling = {
      palletRoot,
      palletIndex: Number.isInteger(palletIndex) ? palletIndex : null,
      entry,
      surfaceY: resolvedSurfaceY,
      localForkDirection: authoredFork.direction.clone(),
      localForkLabel: authoredFork.label,
      channelDirection: channelDirection.clone(),
      channelLabel: runtimeChannel.label,
    };
    const status = palletJackCouplingStatus();
    return Object.freeze({ ok: true, ...status });
  }

  function setVanDoors(progress) {
    if (!vanRig) return;
    const t = smooth(progress);
    let moved = false;
    if (vanRig.sliding && vanRig.slidingBase) {
      const x = vanRig.slidingBase.x + vanRig.slidingTravel * t;
      const { y, z } = vanRig.slidingBase;
      if (vanRig.sliding.position.x !== x
        || vanRig.sliding.position.y !== y
        || vanRig.sliding.position.z !== z) {
        vanRig.sliding.position.set(x, y, z);
        moved = true;
      }
    }
    if (vanRig.rearLeft && vanRig.rearLeftBase) {
      const x = vanRig.rearLeftBase.x;
      const y = vanRig.rearLeftBase.y + vanRig.rearLeftAngle * t;
      const z = vanRig.rearLeftBase.z;
      const order = vanRig.rearLeftBase.order;
      if (vanRig.rearLeft.rotation.x !== x
        || vanRig.rearLeft.rotation.y !== y
        || vanRig.rearLeft.rotation.z !== z
        || vanRig.rearLeft.rotation.order !== order) {
        vanRig.rearLeft.rotation.set(x, y, z, order);
        moved = true;
      }
    }
    if (vanRig.rearRight && vanRig.rearRightBase) {
      const x = vanRig.rearRightBase.x;
      const y = vanRig.rearRightBase.y + vanRig.rearRightAngle * t;
      const z = vanRig.rearRightBase.z;
      const order = vanRig.rearRightBase.order;
      if (vanRig.rearRight.rotation.x !== x
        || vanRig.rearRight.rotation.y !== y
        || vanRig.rearRight.rotation.z !== z
        || vanRig.rearRight.rotation.order !== order) {
        vanRig.rearRight.rotation.set(x, y, z, order);
        moved = true;
      }
    }
    if (moved) markColliderPoseDirty(VAN_ID);
  }

  function setVanWheelTravel(distance, steerProgress = 0) {
    if (!vanRig) return;
    for (let index = 0; index < vanRig.wheels.length; index += 1) {
      const pivot = vanRig.wheels[index];
      const radius = Math.max(0.05, Number(pivot.userData?.wheel_radius_m) || 0.405);
      pivot.rotation.copy(vanRig.wheelBases[index]);
      // Blender +Y becomes glTF/Three local -Z in this authored hierarchy.
      pivot.rotation.z -= distance / radius;
    }
    for (let index = 0; index < vanRig.steering.length; index += 1) {
      const pivot = vanRig.steering[index];
      pivot.rotation.copy(vanRig.steeringBases[index]);
      pivot.rotation.y += Math.sin(clamp01(steerProgress) * Math.PI) * 0.08;
    }
  }

  function resetVanRig() {
    setVanDoors(0);
    setVanWheelTravel(0, 0);
  }

  function setHandTruckPose(progress) {
    if (!handTruckRig) return;
    const amount = clamp01(progress);
    const tilt = THREE.MathUtils.degToRad(Number(handTruckConfig.tiltDegrees) || -18) * amount;
    const wheelSpin = (Number(handTruckConfig.wheelSpinRadians) || 0.9) * amount;
    handTruckRig.tiltPivot.rotation.copy(handTruckRig.tiltBase);
    handTruckRig.tiltPivot.rotation.x += tilt;
    for (let index = 0; index < handTruckRig.wheels.length; index += 1) {
      handTruckRig.wheels[index].rotation.copy(handTruckRig.wheelBases[index]);
      handTruckRig.wheels[index].rotation.x += wheelSpin;
    }
    markColliderPoseDirty('delivery_hand_truck');
  }

  function resetHandTruckRig() {
    setHandTruckPose(0);
    handTruckState.active = false;
    handTruckState.phase = 'idle';
    handTruckState.elapsed = 0;
    handTruckState.progress = 0;
  }

  function setPalletJackPose(handleProgress, liftProgress) {
    if (!palletJackRig) return;
    const handleAmount = clamp01(handleProgress);
    const liftAmount = clamp01(liftProgress);
    const authoredAngle = THREE.MathUtils.degToRad(
      Number(palletJackConfig.authoredHandleDegrees) || -28,
    );
    const handleDelta = authoredAngle * palletJackRig.handleAxis.sign * handleAmount;
    palletJackRig.handle.rotation.copy(palletJackRig.handleBase);
    palletJackRig.handle.rotation[palletJackRig.handleAxis.property] += handleDelta;
    palletJackRig.lift.position.copy(palletJackRig.liftBase);
    palletJackRig.lift.position[palletJackRig.liftAxis.property]
      += palletJackRig.liftAxis.sign * palletJackRig.liftRange * liftAmount;
    markColliderPoseDirty(PALLET_JACK_ID);
  }

  function resetPalletJackRig() {
    setPalletJackPose(0, 0);
    palletJackState.active = false;
    palletJackState.phase = 'idle';
    palletJackState.elapsed = 0;
    palletJackState.progress = 0;
    palletJackState.liftProgress = 0;
    palletJackState.raised = false;
    palletJackState.targetRaised = false;
  }

  function checkReady() {
    const next = SPECS.every((spec) => modelRoots.has(spec.id));
    if (!next) return;
    ready = true;
    if (!publicApi) return;
    const callbacks = [...readyCallbacks];
    readyCallbacks.clear();
    for (const callback of callbacks) safeCall(callback, [publicApi], 'assets-ready');
    maybeStartArrival();
  }

  function instantiateAsset(spec) {
    if (disposed || modelRoots.has(spec.id)) return modelRoots.get(spec.id) || null;
    if (typeof merch.has === 'function' && !merch.has(spec.id)) return null;
    const instance = merch.instantiateRaw?.(spec.id) || merch.instantiate?.(spec.id) || null;
    if (!instance) return null;
    hideAuthoringGeometry(instance);
    const authoredRoot = instance.name === spec.id
      ? instance
      : instance.getObjectByName?.(spec.id) || instance;
    wrappers.get(spec.id).add(instance);
    renderedInstances.set(spec.id, instance);
    modelRoots.set(spec.id, authoredRoot);
    if (spec.id === STOCKING_CART_ID) ensureLogicalStockingCartSocket(instance, authoredRoot);
    namedNodes.set(spec.id, indexNamedNodes(instance));
    if (spec.id === VAN_ID) {
      captureVanRig();
      resetVanRig();
    } else if (spec.id === DELIVERY_EQUIPMENT_ASSETS.delivery_hand_truck.id) {
      captureHandTruckRig();
      resetHandTruckRig();
    } else if (spec.id === DELIVERY_EQUIPMENT_ASSETS.delivery_pallet_jack.id) {
      capturePalletJackRig();
      resetPalletJackRig();
    }
    buildColliderCache(spec.id, instance);
    checkReady();
    return authoredRoot;
  }

  function mountAll() {
    if (disposed) return false;
    for (const spec of SPECS) instantiateAsset(spec);
    checkReady();
    maybeStartArrival();
    return ready;
  }

  function safeCall(callback, args, label) {
    if (typeof callback !== 'function' || disposed) return;
    try {
      callback(...args);
    } catch (error) {
      const detail = { label, message: String(error?.message || error) };
      callbackErrors.push(detail);
      if (callbackErrors.length > 16) callbackErrors.shift();
      if (typeof onError === 'function') {
        try { onError(error, detail); } catch { /* frame callbacks must remain isolated */ }
      }
    }
  }

  function arrivalEvent(entry, beat) {
    return Object.freeze({
      id: entry.id,
      orderId: entry.orderId,
      beat,
      payload: entry.payload,
      root: wrappers.get(VAN_ID),
      modelRoot: modelRoots.get(VAN_ID) || null,
      pendingOrder: entry.orderId != null && pendingOrderCounts.has(entry.orderId),
    });
  }

  function emitBeat(entry, beat) {
    if (disposed) return;
    const event = arrivalEvent(entry, beat);
    beatHistory.push({ id: entry.id, orderId: entry.orderId, beat });
    if (beatHistory.length > 48) beatHistory.shift();
    safeCall(onBeat, [beat, event], `global:${beat}`);
    safeCall(entry.onBeat, [beat, event], `arrival:${entry.id}:${beat}`);
    safeCall(callbackFor(entry.callbacks, beat), [event], `arrival-map:${entry.id}:${beat}`);
  }

  function localRoutePose(base, supplied, offset) {
    if (supplied) return mergeLayout(base, supplied);
    return mergeLayout(base, {
      x: base.x + (Number(offset?.x) || 0),
      y: base.y + (Number(offset?.y) || 0),
      z: base.z + (Number(offset?.z) || 0),
    });
  }

  function routeFor(entry) {
    const spec = DELIVERY_EQUIPMENT_ASSETS[VAN_ID];
    const base = mergeLayout(layouts.get(VAN_ID), entry.options.park || null);
    const startLocal = localRoutePose(base, entry.options.start, entry.options.approachOffset || DELIVERY_VAN_ROUTE.approachOffset);
    const endLocal = localRoutePose(base, entry.options.end, entry.options.departureOffset || DELIVERY_VAN_ROUTE.departureOffset);
    const start = resolvedPose(spec, startLocal);
    const park = resolvedPose(spec, base);
    const end = resolvedPose(spec, endLocal);
    return {
      start: new THREE.Vector3(start.x, start.y, start.z),
      park: new THREE.Vector3(park.x, park.y, park.z),
      end: new THREE.Vector3(end.x, end.y, end.z),
      startLocalY: startLocal.y,
      parkLocalY: base.y,
      endLocalY: endLocal.y,
      rotationY: park.ry,
      approachDistance: Math.hypot(park.x - start.x, park.y - start.y, park.z - start.z),
      departureDistance: Math.hypot(end.x - park.x, end.y - park.y, end.z - park.z),
    };
  }

  function startArrival(entry) {
    const wrapper = wrappers.get(VAN_ID);
    entry.status = 'active';
    entry.phase = 'approach';
    entry.elapsed = 0;
    entry.route = routeFor(entry);
    entry.durations = durationTable(entry.options.durations || arrivalDurations);
    entry.callbackErrorStart = callbackErrors.length;
    wrapper.position.copy(entry.route.start);
    wrapper.rotation.set(0, entry.route.rotationY, 0);
    wrapper.visible = true;
    resetVanRig();
    markColliderPoseDirty(VAN_ID);
    activeArrival = entry;
    emitBeat(entry, DELIVERY_VAN_BEATS.APPROACH);
  }

  function maybeStartArrival() {
    if (disposed || activeArrival || !modelRoots.has(VAN_ID) || !arrivalQueue.length) return false;
    const next = arrivalQueue.shift();
    startArrival(next);
    return true;
  }

  function registerPendingOrder(entry) {
    if (!entry || entry.pendingRegistered || entry.orderId == null) return;
    entry.pendingRegistered = true;
    pendingOrderCounts.set(entry.orderId, (pendingOrderCounts.get(entry.orderId) || 0) + 1);
  }

  function clearPendingOrder(entry) {
    if (!entry?.pendingRegistered || entry.orderId == null) return;
    entry.pendingRegistered = false;
    const remaining = (pendingOrderCounts.get(entry.orderId) || 0) - 1;
    if (remaining > 0) pendingOrderCounts.set(entry.orderId, remaining);
    else pendingOrderCounts.delete(entry.orderId);
  }

  function revealOrder(entry) {
    if (entry.unloaded) return;
    entry.unloaded = true;
    clearPendingOrder(entry);
    emitBeat(entry, DELIVERY_VAN_BEATS.UNLOAD);
    const event = arrivalEvent(entry, DELIVERY_VAN_BEATS.UNLOAD);
    safeCall(onUnload, [entry.orderId, event], `global-unload:${entry.id}`);
    safeCall(entry.onUnload, [entry.orderId, event], `arrival-unload:${entry.id}`);
  }

  function releaseArrivalReferences(entry) {
    // A caller may retain a completed handle indefinitely. Keep that handle's
    // status/result useful without retaining an order payload, callback graph,
    // or the Vector3 route through its closure.
    entry.payload = null;
    entry.options = null;
    entry.onBeat = null;
    entry.onUnload = null;
    entry.callbacks = null;
    entry.route = null;
    entry.durations = null;
    entry.handle = null;
    entry.resolve = null;
  }

  function finishArrival(entry) {
    const wrapper = wrappers.get(VAN_ID);
    const keepVan = entry.options.keepVan === true;
    const leaveDoorsOpen = keepVan && entry.options.leaveDoorsOpen === true;
    clearPendingOrder(entry);
    wrapper.position.copy(entry.route.park);
    wrapper.rotation.set(0, entry.route.rotationY, 0);
    wrapper.visible = keepVan;
    setVanDoors(leaveDoorsOpen ? 1 : 0);
    setVanWheelTravel(0, 0);
    markColliderPoseDirty(VAN_ID);
    arrivalsById.delete(entry.id);
    activeArrival = null;
    entry.status = 'completed';
    emitBeat(entry, DELIVERY_VAN_BEATS.COMPLETE);
    const result = Object.freeze({
      id: entry.id,
      orderId: entry.orderId,
      status: 'completed',
      unloaded: entry.unloaded,
      callbackErrors: Math.max(0, callbackErrors.length - entry.callbackErrorStart),
    });
    const resolve = entry.resolve;
    resolve(result);
    releaseArrivalReferences(entry);
    if (!disposed) maybeStartArrival();
  }

  function enterNextPhase(entry) {
    entry.elapsed = 0;
    if (entry.phase === 'approach') {
      entry.phase = 'settle';
      emitBeat(entry, DELIVERY_VAN_BEATS.PARKED);
    } else if (entry.phase === 'settle') {
      entry.phase = 'opening';
      emitBeat(entry, DELIVERY_VAN_BEATS.DOORS_OPENING);
    } else if (entry.phase === 'opening') {
      entry.phase = 'open-hold';
      setVanDoors(1);
      emitBeat(entry, DELIVERY_VAN_BEATS.CARGO_OPEN);
    } else if (entry.phase === 'open-hold') {
      entry.phase = 'unloading';
      revealOrder(entry);
    } else if (entry.phase === 'unloading') {
      if (entry.options.depart === false) {
        entry.options.keepVan = true;
        entry.options.leaveDoorsOpen = true;
        finishArrival(entry);
      } else {
        entry.phase = 'closing';
        emitBeat(entry, DELIVERY_VAN_BEATS.DOORS_CLOSING);
      }
    } else if (entry.phase === 'closing') {
      entry.phase = 'departing';
      emitBeat(entry, DELIVERY_VAN_BEATS.DEPARTING);
    } else if (entry.phase === 'departing') {
      finishArrival(entry);
    }
  }

  function applyArrivalFrame(entry) {
    const wrapper = wrappers.get(VAN_ID);
    const previousX = wrapper.position.x;
    const previousY = wrapper.position.y;
    const previousZ = wrapper.position.z;
    const duration = arrivalPhaseDuration(entry);
    const p = duration <= 0 ? 1 : clamp01(entry.elapsed / duration);
    const eased = smooth(p);
    const groundMovingVan = (fromLocalY, toLocalY) => {
      if (typeof groundYAt !== 'function') return;
      const grounded = Number(groundYAt(wrapper.position.x, wrapper.position.z, VAN_ID));
      if (!Number.isFinite(grounded)) return;
      wrapper.position.y = grounded + THREE.MathUtils.lerp(fromLocalY, toLocalY, eased);
    };
    if (entry.phase === 'approach') {
      wrapper.position.lerpVectors(entry.route.start, entry.route.park, eased);
      groundMovingVan(entry.route.startLocalY, entry.route.parkLocalY);
      setVanWheelTravel(entry.route.approachDistance * eased, p);
      setVanDoors(0);
    } else if (entry.phase === 'settle') {
      wrapper.position.copy(entry.route.park);
      setVanWheelTravel(entry.route.approachDistance, 1);
      setVanDoors(0);
    } else if (entry.phase === 'opening') {
      wrapper.position.copy(entry.route.park);
      setVanDoors(p);
    } else if (entry.phase === 'open-hold' || entry.phase === 'unloading') {
      wrapper.position.copy(entry.route.park);
      setVanDoors(1);
    } else if (entry.phase === 'closing') {
      wrapper.position.copy(entry.route.park);
      setVanDoors(1 - p);
    } else if (entry.phase === 'departing') {
      wrapper.position.lerpVectors(entry.route.park, entry.route.end, eased);
      groundMovingVan(entry.route.parkLocalY, entry.route.endLocalY);
      setVanDoors(0);
      setVanWheelTravel(
        entry.route.approachDistance + entry.route.departureDistance * eased,
        p,
      );
    }
    if (wrapper.position.x !== previousX
      || wrapper.position.y !== previousY
      || wrapper.position.z !== previousZ) {
      markColliderPoseDirty(VAN_ID);
    }
  }

  function triggerHandTruckTilt() {
    if (disposed || !handTruckRig || handTruckState.active) return false;
    resetHandTruckRig();
    handTruckState.active = true;
    handTruckState.phase = 'tip-back';
    return true;
  }

  function updateHandTruckTilt(dt) {
    if (!handTruckState.active || !handTruckRig) return false;
    const tipEnd = handTruckConfig.tipBack;
    const holdEnd = tipEnd + handTruckConfig.hold;
    const total = holdEnd + handTruckConfig.return;
    handTruckState.elapsed = Math.min(total, handTruckState.elapsed + dt);
    handTruckState.progress = total > 0 ? clamp01(handTruckState.elapsed / total) : 1;
    let amount = 0;
    if (handTruckState.elapsed < tipEnd && tipEnd > 0) {
      handTruckState.phase = 'tip-back';
      amount = smooth(handTruckState.elapsed / tipEnd);
    } else if (handTruckState.elapsed < holdEnd || handTruckConfig.return <= 0) {
      handTruckState.phase = 'hold';
      amount = 1;
    } else if (handTruckState.elapsed < total && handTruckConfig.return > 0) {
      handTruckState.phase = 'return';
      amount = 1 - smooth((handTruckState.elapsed - holdEnd) / handTruckConfig.return);
    }
    setHandTruckPose(amount);
    if (handTruckState.elapsed + 1e-9 >= total) {
      const cycles = handTruckState.cycles + 1;
      resetHandTruckRig();
      handTruckState.cycles = cycles;
      return false;
    }
    return true;
  }

  function triggerPalletJackPump() {
    if (disposed || !palletJackRig || palletJackState.active) return false;
    palletJackState.active = true;
    palletJackState.phase = 'handle-down';
    palletJackState.elapsed = 0;
    palletJackState.progress = 0;
    palletJackState.sourceLift = palletJackState.liftProgress;
    palletJackState.targetRaised = !palletJackState.raised;
    palletJackState.targetLift = palletJackState.targetRaised ? 1 : 0;
    setPalletJackPose(0, palletJackState.sourceLift);
    return true;
  }

  function updatePalletJackPump(dt) {
    if (!palletJackState.active || !palletJackRig) return false;
    const downEnd = palletJackConfig.handleDown;
    const liftEnd = downEnd + palletJackConfig.lift;
    const total = liftEnd + palletJackConfig.handleReturn;
    palletJackState.elapsed = Math.min(total, palletJackState.elapsed + dt);
    palletJackState.progress = total > 0 ? clamp01(palletJackState.elapsed / total) : 1;
    let handleAmount = 0;
    let liftAmount = palletJackState.sourceLift;
    if (palletJackState.elapsed < downEnd && downEnd > 0) {
      palletJackState.phase = 'handle-down';
      handleAmount = smooth(palletJackState.elapsed / downEnd);
    } else if (palletJackState.elapsed < liftEnd && palletJackConfig.lift > 0) {
      palletJackState.phase = 'lift';
      handleAmount = 1;
      const p = smooth((palletJackState.elapsed - downEnd) / palletJackConfig.lift);
      liftAmount = THREE.MathUtils.lerp(
        palletJackState.sourceLift,
        palletJackState.targetLift,
        p,
      );
    } else if (palletJackState.elapsed < total && palletJackConfig.handleReturn > 0) {
      palletJackState.phase = 'handle-return';
      handleAmount = 1 - smooth((palletJackState.elapsed - liftEnd) / palletJackConfig.handleReturn);
      liftAmount = palletJackState.targetLift;
    } else {
      liftAmount = palletJackState.targetLift;
    }
    palletJackState.liftProgress = liftAmount;
    setPalletJackPose(handleAmount, liftAmount);
    if (palletJackState.elapsed + 1e-9 >= total) {
      palletJackState.liftProgress = palletJackState.targetLift;
      palletJackState.raised = palletJackState.targetRaised;
      palletJackState.active = false;
      palletJackState.phase = 'idle';
      palletJackState.elapsed = 0;
      palletJackState.progress = 0;
      palletJackState.cycles += 1;
      setPalletJackPose(0, palletJackState.liftProgress);
      return false;
    }
    return true;
  }

  function update(dt) {
    if (disposed) return false;
    maybeStartArrival();
    const delta = Math.max(0, Math.min(0.25, Number(dt) || 0));
    updateHandTruckTilt(delta);
    updatePalletJackPump(delta);
    let remaining = delta;
    let guard = 0;
    while (activeArrival && guard++ < 24) {
      const entry = activeArrival;
      const duration = arrivalPhaseDuration(entry);
      const needed = Math.max(0, duration - entry.elapsed);
      const step = Math.min(remaining, needed);
      entry.elapsed += step;
      remaining -= step;
      applyArrivalFrame(entry);
      if (entry.elapsed + 1e-9 < duration) break;
      enterNextPhase(entry);
      if (disposed || !activeArrival) break;
      if (remaining <= 0 && arrivalPhaseDuration(activeArrival) > 0) break;
    }
    return !!activeArrival || handTruckState.active || palletJackState.active;
  }

  function cancelEntry(entry, reason = 'cancelled', { startNext = true } = {}) {
    if (!entry || entry.status === 'completed' || entry.status === 'cancelled') return false;
    const queuedIndex = arrivalQueue.indexOf(entry);
    if (queuedIndex >= 0) arrivalQueue.splice(queuedIndex, 1);
    if (activeArrival === entry) {
      activeArrival = null;
      const wrapper = wrappers.get(VAN_ID);
      const spec = DELIVERY_EQUIPMENT_ASSETS[VAN_ID];
      applyWrapperPose(spec, layouts.get(VAN_ID));
      resetVanRig();
    }
    clearPendingOrder(entry);
    arrivalsById.delete(entry.id);
    entry.status = 'cancelled';
    const resolve = entry.resolve;
    resolve(Object.freeze({ id: entry.id, orderId: entry.orderId, status: 'cancelled', reason }));
    releaseArrivalReferences(entry);
    if (startNext) maybeStartArrival();
    return true;
  }

  function presentArrival(request = {}) {
    if (disposed) return null;
    const options = typeof request === 'string' ? { id: request, orderId: request } : { ...request };
    const id = String(options.id ?? options.arrivalId ?? options.orderId ?? `delivery-arrival-${++autoArrivalId}`);
    const existing = arrivalsById.get(id);
    if (existing) return existing.handle;
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const entry = {
      id,
      orderId: options.orderId == null ? null : String(options.orderId),
      payload: options.payload,
      options,
      onBeat: options.onBeat,
      onUnload: options.onUnload,
      callbacks: options.callbacks,
      resolve,
      promise,
      status: 'queued',
      unloaded: false,
      pendingRegistered: false,
    };
    const handle = Object.freeze({
      id,
      orderId: entry.orderId,
      promise,
      get status() { return entry.status; },
      cancel: (reason = 'cancelled') => cancelEntry(entry, reason),
    });
    entry.handle = handle;
    arrivalsById.set(id, entry);
    arrivalQueue.push(entry);
    registerPendingOrder(entry);
    emitBeat(entry, DELIVERY_VAN_BEATS.QUEUED);
    maybeStartArrival();
    return handle;
  }

  function getLayout(asset) {
    const id = assetIdFor(asset);
    return id ? { ...layouts.get(id) } : null;
  }

  function setLayout(asset, next) {
    const id = assetIdFor(asset);
    if (!id || disposed) return null;
    const merged = mergeLayout(layouts.get(id), next || {});
    layouts.set(id, merged);
    if (id !== VAN_ID || !activeArrival) {
      applyWrapperPose(DELIVERY_EQUIPMENT_ASSETS[id], merged);
    }
    return wrappers.get(id);
  }

  function rootFor(asset) {
    const id = assetIdFor(asset);
    return id ? wrappers.get(id) || null : null;
  }

  function modelRootFor(asset) {
    const id = assetIdFor(asset);
    return id ? modelRoots.get(id) || null : null;
  }

  function anchorNodes(asset, { socketsOnly = false } = {}) {
    const id = assetIdFor(asset);
    const nodes = id ? namedNodes.get(id) : null;
    if (!nodes) return [];
    return [...nodes.values()].filter((object) => {
      if (socketsOnly) return /SOCKET/i.test(object.name) || /socket/i.test(String(object.userData?.anchor_kind || ''));
      return socketLike(object);
    });
  }

  function nodeWorldPose(asset, name) {
    const object = node(asset, name);
    if (!object) return null;
    object.updateWorldMatrix(true, false);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    object.matrixWorld.decompose(position, quaternion, scale);
    return { object, matrix: object.matrixWorld.clone(), position, quaternion, scale };
  }

  function colliderDescriptors(asset) {
    const id = assetIdFor(asset);
    const cache = id ? refreshColliderCache(colliderCaches.get(id)) : null;
    return cache?.descriptors || EMPTY_COLLIDER_DESCRIPTORS;
  }

  function colliderDescriptorMap(asset) {
    const id = assetIdFor(asset);
    const cache = id ? refreshColliderCache(colliderCaches.get(id)) : null;
    return cache?.byName || EMPTY_COLLIDER_DESCRIPTOR_MAP;
  }

  function colliderRevision(asset) {
    const id = assetIdFor(asset);
    return id ? colliderCaches.get(id)?.poseRevision ?? -1 : -1;
  }

  function colliderCacheDiagnostics(asset) {
    const id = assetIdFor(asset);
    const cache = id ? colliderCaches.get(id) : null;
    if (!cache) return null;
    return Object.freeze({
      equipmentId: id,
      helpers: cache.helpers.length,
      matrixNodes: cache.matrixNodes.length,
      poseRevision: cache.poseRevision,
      boundsRevision: cache.boundsRevision,
      refreshes: cache.refreshes,
    });
  }

  function staticPropRoots() {
    return STATIC_IDS.map((id) => {
      const spec = DELIVERY_EQUIPMENT_ASSETS[id];
      return Object.freeze({
        id,
        reference: spec.reference,
        zone: spec.zone,
        root: wrappers.get(id),
        modelRoot: modelRoots.get(id) || null,
        interactionTarget: node(id, spec.interactionNode),
        colliders: colliderDescriptors(id),
      });
    });
  }

  function metrics() {
    const materials = new Set();
    const textures = new Set();
    let visibleMeshes = 0;
    let triangles = 0;
    for (const model of renderedInstances.values()) {
      model.traverse((object) => {
        if (!object.isMesh || !object.visible || authoringHelper(object) || socketLike(object)) return;
        visibleMeshes += 1;
        const count = object.geometry?.index?.count || object.geometry?.attributes?.position?.count || 0;
        triangles += Math.floor(count / 3);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          if (!material) continue;
          materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
    }
    return Object.freeze({
      assets: renderedInstances.size,
      visibleMeshes,
      triangles,
      materials: materials.size,
      textures: textures.size,
    });
  }

  function diagnostics() {
    const coupling = palletJackCouplingStatus();
    return {
      disposed,
      ready,
      missingAssets: SPECS.filter((spec) => !modelRoots.has(spec.id)).map((spec) => spec.id),
      activeArrival: activeArrival ? {
        id: activeArrival.id,
        orderId: activeArrival.orderId,
        phase: activeArrival.phase,
        progress: arrivalPhaseDuration(activeArrival) <= 0
          ? 1 : clamp01(activeArrival.elapsed / arrivalPhaseDuration(activeArrival)),
      } : null,
      queuedArrivals: arrivalQueue.map((entry) => entry.id),
      pendingOrderIds: [...pendingOrderCounts.keys()],
      pendingOrderCounts: Object.fromEntries(pendingOrderCounts),
      handTruck: {
        available: !!handTruckRig && !disposed,
        active: handTruckState.active,
        phase: handTruckState.phase,
        progress: handTruckState.progress,
        cycles: handTruckState.cycles,
        runtimeTiltAxis: '+X',
      },
      palletJack: {
        available: !!palletJackRig && !disposed,
        active: palletJackState.active,
        phase: palletJackState.phase,
        progress: palletJackState.progress,
        liftProgress: palletJackState.liftProgress,
        raised: palletJackState.raised,
        targetRaised: palletJackState.targetRaised,
        cycles: palletJackState.cycles,
        runtimeHandleAxis: palletJackRig?.handleAxis?.label || '-Z',
        runtimeLiftAxis: palletJackRig?.liftAxis?.label || '+Y',
        liftOffset: palletJackLiftOffset(),
        coupledPalletIndex: coupling?.coupledPalletIndex ?? null,
        channelAlignmentDot: coupling?.channelAlignmentDot ?? null,
        channelAligned: coupling?.channelAligned ?? false,
        socketHorizontalError: coupling?.socketHorizontalError ?? null,
        coupling,
      },
      callbackErrors: callbackErrors.map((entry) => ({ ...entry })),
      beatHistory: beatHistory.map((entry) => ({ ...entry })),
    };
  }

  function dispose() {
    if (disposed) return { ...disposalSummary, alreadyDisposed: true };
    disposed = true;
    ready = false;
    const cancelledOperationalActions = Number(handTruckState.active) + Number(palletJackState.active);
    // Restore every authored/runtime base transform before the roots are
    // detached. Retained debug references never observe a half-tilted prop.
    resetHandTruckRig();
    resetPalletJackRig();
    readyCallbacks.clear();
    const entries = [...arrivalsById.values()];
    for (const entry of entries) cancelEntry(entry, 'disposed', { startNext: false });
    arrivalQueue.length = 0;
    activeArrival = null;
    pendingOrderCounts.clear();
    const detachedModels = renderedInstances.size;
    interiorRoot.removeFromParent();
    exteriorRoot.removeFromParent();
    renderedInstances.clear();
    modelRoots.clear();
    namedNodes.clear();
    colliderCaches.clear();
    vanRig = null;
    handTruckRig = null;
    palletJackRig = null;
    palletJackCoupling = null;
    disposalSummary = Object.freeze({
      detachedModels,
      cancelledArrivals: entries.length,
      cancelledOperationalActions,
      resourcesDisposed: Object.freeze({ geometries: 0, materials: 0, textures: 0 }),
    });
    return { ...disposalSummary, alreadyDisposed: false };
  }

  publicApi = {
    interiorRoot,
    exteriorRoot,
    roots: Object.freeze(Object.fromEntries(SPECS.map((spec) => [spec.id, wrappers.get(spec.id)]))),
    update,
    presentArrival,
    triggerHandTruckTilt,
    triggerPalletJackPump,
    couplePalletJackToPallet,
    palletJackLiftOffset,
    isOrderPending: (orderId) => pendingOrderCounts.has(String(orderId)),
    pendingOrderIds: () => new Set(pendingOrderCounts.keys()),
    isReady: () => ready && !disposed,
    missingAssets: () => SPECS.filter((spec) => !modelRoots.has(spec.id)).map((spec) => spec.id),
    onReady(callback) {
      if (typeof callback !== 'function' || disposed) return () => {};
      if (ready) safeCall(callback, [publicApi], 'assets-ready-late');
      else readyCallbacks.add(callback);
      return () => readyCallbacks.delete(callback);
    },
    getLayout,
    setLayout,
    applyLayout(next = {}) {
      for (const spec of SPECS) {
        const value = next[spec.id] || next[spec.alias];
        if (value) setLayout(spec.id, value);
      }
      return publicApi;
    },
    rootFor,
    modelRootFor,
    node,
    anchors: (asset) => anchorNodes(asset),
    sockets: (asset) => anchorNodes(asset, { socketsOnly: true }),
    nodeWorldPose,
    socketWorldPose: nodeWorldPose,
    colliderDescriptors,
    colliderDescriptorMap,
    colliderRevision,
    colliderCacheDiagnostics,
    staticPropRoots,
    metrics,
    diagnostics,
    // Every rendered resource is borrowed from createMerch's prototype cache.
    // This module creates transform wrappers only and never releases those
    // shared identities; outer scene teardown can protect this snapshot.
    borrowedResources: () => resourcesIn(renderedInstances.values()),
    ownedResources: () => snapshotResources(null),
    dispose,
  };

  if (merch.isReady?.()) mountAll();
  else if (typeof merch.onReady === 'function') merch.onReady(mountAll);
  else mountAll();
  if (ready) checkReady();
  return publicApi;
}
