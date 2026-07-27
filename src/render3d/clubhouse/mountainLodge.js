import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { METERS_TO_YARDS } from '../assets51to100/units.js';

export const MOUNTAIN_LODGE_URL = 'vendor/models/clubhouse/mountain_clubhouse_3000sqft.glb';
export const MOUNTAIN_LODGE_METERS_TO_YARDS = METERS_TO_YARDS;
export const MOUNTAIN_LODGE_BUILDING_WIDTH_METERS = 21.0;
export const MOUNTAIN_LODGE_BUILDING_DEPTH_METERS = 13.275;

const REPLACED_SHEET06_ASSETS = Object.freeze([51, 52, 53, 54, 55, 58]);
const REPLACED_FALLBACK_KEYS = Object.freeze([
  'exteriorShellStructure',
  'apertureTrim',
  'porchVisuals',
  'windowVisuals',
  'ceilingVisuals',
]);
const REPLACED_LEGACY_OBJECTS = Object.freeze([
  'LegacyClubApproachSign',
  'LegacyBusinessHoursSign',
  'DeliveryReceivingExteriorSign',
]);
const COLLISION_NODE = /^(?:COL(?:_|$)|.*Collision(?:_|$))/i;
const NON_SHADOW_DETAIL_FAMILIES = new Set([
  'natural_fieldstone',
  'cedar_batten',
  'standing_seam_rib',
  'porch_deck_board',
  'patio_paver',
  'patio_step',
  'patio_baluster',
  'patio_guardrail',
  'window_frame',
  'window_mullion',
  'window_stone_sill',
  'gable_window_frame',
  'gable_window_mullion',
  'stone_pier_cap',
  'stone_pier_return',
  'pine_bark_collar',
  'cart_parking_line',
  'parking_wheel_stop',
  'road_edge_module',
  'gravel_road_shoulder',
  'sidewalk_module',
  'pendant_stem',
  'rustic_pendant_cage',
  'rustic_light_arm',
  'rustic_light_backplate',
  'rustic_light_shade',
  'warm_lamp_bulb',
]);

function collisionNode(node) {
  const data = node?.userData || {};
  return COLLISION_NODE.test(String(node?.name || ''))
    || data.collision_proxy === true
    || data.collisionProxy === true
    || data.glb_collision === true
    || data.glbCollision === true;
}

function configureRenderTree(root) {
  root.traverse((node) => {
    if (collisionNode(node)) {
      node.visible = false;
      node.userData.runtimeCollisionActive = false;
      return;
    }
    if (!node.isMesh) return;
    node.castShadow = !NON_SHADOW_DETAIL_FAMILIES.has(node.userData?.module_family);
    node.receiveShadow = true;
    node.frustumCulled = true;
    if (node.material?.transparent) {
      node.material.depthWrite = false;
      node.material.side = THREE.DoubleSide;
    }
  });
}

function releaseDetachedTree(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root?.traverse?.((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (!material) continue;
      materials.add(material);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        if (material[key]) textures.add(material[key]);
      }
    }
  });
  for (const texture of textures) texture.dispose?.();
  for (const material of materials) material.dispose?.();
  for (const geometry of geometries) geometry.dispose?.();
}

function geometrySignature(geometry) {
  const attributes = Object.entries(geometry.attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, attribute]) => (
      `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:${attribute.array.constructor.name}`
    ))
    .join('|');
  return `${geometry.index ? 'indexed' : 'plain'}|${attributes}`;
}

function movingNodes(root) {
  const nodes = new Set();
  root.traverse((object) => {
    if (!object.name.startsWith('PIVOT_')) return;
    object.traverse((descendant) => nodes.add(descendant));
  });
  return nodes;
}

/**
 * Collapse immutable opaque modules for runtime rendering while leaving every
 * Blender-authored source node addressable for future customization. Door
 * pivots, glazing, sockets, collision proxies, and the modular hierarchy stay
 * separate; only their static visible draw work is replaced by merged batches.
 */
export function batchMountainLodgeStaticGeometry(root) {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const moving = movingNodes(root);
  const buckets = new Map();
  let sourceDrawCalls = 0;
  let sourceTriangles = 0;

  root.traverse((object) => {
    if (!object.isMesh || !object.geometry || !object.material) return;
    if (collisionNode(object)) {
      object.visible = false;
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const elements = object.matrixWorld.elements;
    const determinant = object.matrixWorld.determinant();
    const finiteTransform = elements.every(Number.isFinite)
      && Number.isFinite(determinant)
      && Math.abs(determinant) > 1e-12;
    if (moving.has(object) || materials.length !== 1 || materials[0]?.transparent
      || object.geometry.morphAttributes?.position || !finiteTransform) return;
    const material = materials[0];
    const signature = [
      material.uuid,
      geometrySignature(object.geometry),
      object.castShadow ? 1 : 0,
      object.receiveShadow ? 1 : 0,
    ].join('|');
    if (!buckets.has(signature)) {
      buckets.set(signature, {
        material,
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow,
        geometries: [],
        sources: [],
      });
    }
    const bucket = buckets.get(signature);
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(inverseRoot.clone().multiply(object.matrixWorld));
    bucket.geometries.push(geometry);
    bucket.sources.push(object);
    sourceDrawCalls += 1;
    sourceTriangles += geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count || 0) / 3;
  });

  const batchRoot = new THREE.Group();
  batchRoot.name = 'RUNTIME_MountainLodgeStaticBatches';
  batchRoot.userData.runtimeOnly = true;
  let batchedSourceDrawCalls = 0;
  let batchedDrawCalls = 0;
  let batchedTriangles = 0;

  for (const bucket of buckets.values()) {
    if (bucket.geometries.length < 2) {
      for (const geometry of bucket.geometries) geometry.dispose();
      continue;
    }
    let merged = null;
    try {
      merged = mergeGeometries(bucket.geometries, false);
    } catch (_) {
      merged = null;
    }
    if (!merged) {
      for (const geometry of bucket.geometries) geometry.dispose();
      continue;
    }
    for (const geometry of bucket.geometries) if (geometry !== merged) geometry.dispose();
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.name = `BATCH_Mountain_${String(bucket.material.name || 'Material').replace(/[^a-z0-9_-]+/gi, '_')}`;
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    mesh.frustumCulled = true;
    mesh.userData.runtimeOnly = true;
    mesh.userData.batchedSourceCount = bucket.sources.length;
    batchRoot.add(mesh);
    for (const source of bucket.sources) {
      source.visible = false;
      source.userData.mountainRuntimeBatchSuppressed = true;
    }
    batchedSourceDrawCalls += bucket.sources.length;
    batchedDrawCalls += 1;
    batchedTriangles += merged.index
      ? merged.index.count / 3
      : (merged.getAttribute('position')?.count || 0) / 3;
  }

  root.add(batchRoot);
  return Object.freeze({
    sourceDrawCalls,
    batchedSourceDrawCalls,
    batchedDrawCalls,
    drawCallsSaved: batchedSourceDrawCalls - batchedDrawCalls,
    sourceTriangles: Math.round(sourceTriangles),
    batchedTriangles: Math.round(batchedTriangles),
    preservedMovingNodeCount: moving.size,
  });
}

function warmArchitecturalLights(root) {
  const lights = [];
  root.traverse((node) => {
    if (node.isLight || !String(node.name || '').startsWith('SOCKET_Light_')) return;
    const point = new THREE.PointLight(0xffd59a, 0.18, 6 * METERS_TO_YARDS, 1.8);
    point.name = `${node.name}_RuntimePointLight`;
    node.add(point);
    lights.push(point);
  });
  return lights;
}

/**
 * Mounts the final mountain lodge over the legacy restoration shell while
 * retaining the old analytic navigation, interaction, transaction, and save
 * authorities. The GLB's named door pivots mirror the already-proven door
 * state machine, so normal controls continue to own motion and persistence.
 */
export function createMountainLodge({
  group,
  shellFallbacks,
  sheet06Production,
  doors,
  getMinuteOfDay = () => 12 * 60,
  loader = new GLTFLoader(),
} = {}) {
  if (!group) throw new TypeError('Mountain lodge requires the clubhouse shell group.');
  let disposed = false;
  let root = null;
  let status = 'loading';
  let error = null;
  let lights = [];
  let batching = null;
  const pivots = Object.create(null);
  const hiddenSheet06 = new Set();
  const hiddenFallbacks = new Set();
  const hiddenLegacyObjects = new Set();

  function syncArchitecturalLights() {
    const minute = ((Number(getMinuteOfDay?.()) || 0) % 1440 + 1440) % 1440;
    const daylight = minute >= 7 * 60 && minute < 18 * 60;
    const twilight = (minute >= 6 * 60 && minute < 7 * 60)
      || (minute >= 18 * 60 && minute < 20 * 60);
    const intensity = daylight ? 0.18 : (twilight ? 1.35 : 2.45);
    for (const light of lights) light.intensity = intensity;
  }

  function hideReplacedVisuals() {
    if (!root || disposed) return;
    for (const number of REPLACED_SHEET06_ASSETS) {
      const authored = sheet06Production?.getRoot?.(number);
      if (authored) {
        authored.visible = false;
        hiddenSheet06.add(number);
      }
    }
    for (const key of REPLACED_FALLBACK_KEYS) {
      const fallback = shellFallbacks?.[key];
      if (!fallback) continue;
      if (typeof fallback.setVisible === 'function') fallback.setVisible(false);
      else fallback.visible = false;
      hiddenFallbacks.add(key);
    }
    for (const name of REPLACED_LEGACY_OBJECTS) {
      const legacy = group.getObjectByName(name);
      if (!legacy) continue;
      legacy.visible = false;
      hiddenLegacyObjects.add(name);
    }
  }

  function cachePivots() {
    pivots.mainLeft = root.getObjectByName('PIVOT_MainEntranceLeft');
    pivots.mainRight = root.getObjectByName('PIVOT_MainEntranceRight');
    pivots.deliveryNorth = root.getObjectByName('PIVOT_DeliveryEntranceNorth');
    pivots.deliverySouth = root.getObjectByName('PIVOT_DeliveryEntranceSouth');
    pivots.employee = root.getObjectByName('PIVOT_EmployeeEntrance');
  }

  function syncDoorPivots() {
    if (!root || disposed || !Array.isArray(doors)) return;
    const mainLeft = doors.find((door) => door.mainLeaf === 'left');
    const mainRight = doors.find((door) => door.mainLeaf === 'right');
    const receiving = doors.find((door) => door.name === 'Receiving door');
    if (pivots.mainLeft && mainLeft) pivots.mainLeft.rotation.y = mainLeft.angle;
    if (pivots.mainRight && mainRight) pivots.mainRight.rotation.y = mainRight.angle;
    if (receiving) {
      if (pivots.deliveryNorth) pivots.deliveryNorth.rotation.y = receiving.angle;
      if (pivots.deliverySouth) pivots.deliverySouth.rotation.y = -receiving.angle;
    }
  }

  const ready = new Promise((resolve) => {
    loader.load(
      MOUNTAIN_LODGE_URL,
      (gltf) => {
        if (disposed) {
          releaseDetachedTree(gltf.scene);
          resolve({ ok: false, disposed: true, url: MOUNTAIN_LODGE_URL });
          return;
        }
        root = gltf.scene;
        root.name = 'MountainLodgeClubhouse_3000sqft';
        root.scale.setScalar(METERS_TO_YARDS);
        root.userData.conditionedAreaSquareFeet = 3000.71;
        root.userData.interiorPolicy = 'INTENTIONALLY_EMPTY_PLAYER_FURNISHES';
        root.userData.source = 'asset_sources/blender/clubhouse/mountain_clubhouse_3000sqft.blend';
        root.userData.license = 'Project-owned; no external assets or textures';
        configureRenderTree(root);
        batching = batchMountainLodgeStaticGeometry(root);
        cachePivots();
        lights = warmArchitecturalLights(root);
        syncArchitecturalLights();
        group.add(root);
        root.updateMatrixWorld(true);
        hideReplacedVisuals();
        syncDoorPivots();
        status = 'ready';
        resolve({ ok: true, root, url: MOUNTAIN_LODGE_URL });
      },
      undefined,
      (cause) => {
        status = 'fallback';
        error = cause instanceof Error ? cause : new Error(String(cause || 'unknown load failure'));
        console.warn('mountain clubhouse load failed; retaining the production restoration shell', error);
        resolve({ ok: false, error, url: MOUNTAIN_LODGE_URL });
      },
    );
  });

  // Sheet-6 loads in parallel. Reassert the lodge lease once that pipeline has
  // finished so a late Asset-51/54/55 mount never draws through the new shell.
  void Promise.resolve(sheet06Production?.ready).then(() => hideReplacedVisuals());

  return Object.freeze({
    ready,
    update() {
      if (!root || disposed) return;
      hideReplacedVisuals();
      syncDoorPivots();
      syncArchitecturalLights();
    },
    root: () => root,
    diagnostics: () => Object.freeze({
      status,
      url: MOUNTAIN_LODGE_URL,
      loaded: Boolean(root),
      conditionedAreaSquareFeet: 3000.71,
      interiorPolicy: 'INTENTIONALLY_EMPTY_PLAYER_FURNISHES',
      scaleMetersToGameYards: METERS_TO_YARDS,
      hiddenSheet06Assets: Object.freeze([...hiddenSheet06].sort((a, b) => a - b)),
      hiddenFallbacks: Object.freeze([...hiddenFallbacks].sort()),
      hiddenLegacyObjects: Object.freeze([...hiddenLegacyObjects].sort()),
      pivotCount: Object.values(pivots).filter(Boolean).length,
      runtimeLightCount: lights.length,
      batching,
      error: error?.message || null,
    }),
    dispose() {
      if (disposed) return Object.freeze({ alreadyDisposed: true });
      disposed = true;
      lights = [];
      // The root remains under `group`: clubhouse teardown's normal owned-
      // resource collector releases it exactly once with the other shell art.
      return Object.freeze({ alreadyDisposed: false, loaded: Boolean(root) });
    },
  });
}

export default createMountainLodge;
