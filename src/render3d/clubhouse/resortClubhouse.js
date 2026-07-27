import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { METERS_TO_YARDS } from '../assets51to100/units.js';

export const RESORT_CLUBHOUSE_URL = 'vendor/models/clubhouse/clubhouse_resort_4000.glb';
export const RESORT_CLUBHOUSE_AREA_SQUARE_FEET = 4004.17;
export const RESORT_CLUBHOUSE_WIDTH_METERS = 24;
export const RESORT_CLUBHOUSE_DEPTH_METERS = 15.5;
export const RESORT_CLUBHOUSE_METERS_TO_YARDS = METERS_TO_YARDS;

// Blender's -Y facade becomes +Z in glTF. The authored leaves sit 0.17 m
// proud of the facade so the walnut doors clear their limestone casing.
const AUTHORED_DOOR_PLANE_Z_METERS = 7.75 + 0.17;
const AUTHORED_DOOR_CENTER_X_METERS = -1;
const AUTHORED_FLOOR_HEIGHT_METERS = 0.18;
const REPLACED_SHEET06_ASSETS = Object.freeze([51, 52, 53, 54, 55, 58]);
const REPLACED_FALLBACK_KEYS = Object.freeze([
  'exteriorShellStructure',
  'apertureTrim',
  'porchVisuals',
  'windowVisuals',
  'ceilingVisuals',
]);
const COLLISION_NODE = /^(?:COL(?:_|$)|.*Collision(?:_|$))/i;
const SHADOW_FREE_MATERIAL = /(?:PalmLeaf|MutedSage|Bougainvillea|Water_|WindowGlass|ArchitecturalGlow)/i;
const DOUBLE_SIDED_MATERIAL = /(?:PalmLeaf|Bougainvillea)/i;

export function resortMaterialCastsShadow(material) {
  return !SHADOW_FREE_MATERIAL.test(String(material?.name || ''));
}

export function resortMaterialIsDoubleSided(material) {
  return DOUBLE_SIDED_MATERIAL.test(String(material?.name || ''));
}

function configureResortMaterial(material) {
  if (!material) return;
  if (material.transparent) material.depthWrite = false;
  // Palm fronds and bougainvillea are authored as thin botanical planes. They
  // must remain visible from below and from both sides of the arrival route;
  // otherwise mature crowns collapse into skeletal lines at player height.
  if (material.transparent || resortMaterialIsDoubleSided(material)) {
    material.side = THREE.DoubleSide;
  }
}

function collisionNode(node) {
  const data = node?.userData || {};
  return COLLISION_NODE.test(String(node?.name || ''))
    || data.collision_proxy === true
    || data.collisionProxy === true
    || data.glb_collision === true
    || data.glbCollision === true;
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

function dynamicDoorNodes(root) {
  const nodes = new Set();
  for (const name of ['PIVOT_DoorLeft', 'PIVOT_DoorRight']) {
    root.getObjectByName(name)?.traverse((node) => nodes.add(node));
  }
  return nodes;
}

function registerResortColliders({
  addCollider,
  removeCollider,
  colBoxAt,
  entranceCenterX,
  facadeDoorZ,
}) {
  if (typeof addCollider !== 'function' || typeof colBoxAt !== 'function') return [];
  if (!Number.isFinite(entranceCenterX) || !Number.isFinite(facadeDoorZ)) return [];
  const s = METERS_TO_YARDS;
  const wallT = 0.30 * s;
  const xWorld = (meters) => entranceCenterX
    + (meters - AUTHORED_DOOR_CENTER_X_METERS) * s;
  const zWorld = (meters) => facadeDoorZ
    - (AUTHORED_DOOR_PLANE_Z_METERS + meters) * s;
  const handles = [];
  const add = (xMeters, yMeters, widthMeters, depthMeters, kind) => {
    const collider = {
      ...colBoxAt(
        xWorld(xMeters),
        zWorld(yMeters),
        widthMeters * s,
        depthMeters * s,
      ),
      kind,
      resortClubhouse: true,
    };
    addCollider(collider);
    handles.push({ collider, remove: () => removeCollider?.(collider) });
  };

  // The authored facade is split around the real double-door clear opening.
  add(-7.10, -7.75, 9.80, 0.30, 'resort-front-wall-west');
  add(6.10, -7.75, 11.80, 0.30, 'resort-front-wall-east');
  add(0, 7.75, 24, 0.30, 'resort-rear-wall');
  add(-12, 0, 0.30, 15.5, 'resort-west-wall');
  add(12, 0, 0.30, 15.5, 'resort-east-wall');
  add(-5.8, -15.75, 4.8, 4.8, 'resort-entrance-fountain');
  add(-9.0, -24.85, 4.2, 1.0, 'resort-monument-sign');
  for (const [index, [x, y]] of [
    [4.7, -12.9], [10.8, -12.9], [4.7, -18.3], [10.8, -18.3],
  ].entries()) add(x, y, 0.72, 0.72, `resort-bag-drop-column-${index + 1}`);
  for (const [index, x] of [-10.0, -6.6, -3.2, 1.2, 4.6, 8.0].entries()) {
    add(x, -10.67, 0.74, 0.74, `resort-arcade-column-${index + 1}`);
  }
  for (const [index, [x, y]] of [
    [11.25, -11.05], [18.35, -11.05], [11.25, -6.50], [18.35, -6.50],
  ].entries()) add(x, y, 0.44, 0.44, `resort-cart-staging-post-${index + 1}`);
  for (const [index, [x, y]] of [
    [-9.6, 8.40], [-9.6, 12.70], [-6.0, 8.40], [-6.0, 12.70],
    [-2.4, 8.40], [-2.4, 12.70], [1.2, 8.40], [1.2, 12.70],
  ].entries()) add(x, y, 0.48, 0.48, `resort-pergola-column-${index + 1}`);
  return handles;
}

/**
 * The source remains fully modular in Blender and in the shipped GLB. At run
 * time only, immutable meshes are collapsed by material/vertex layout. Named
 * sockets and both physical door hierarchies stay intact for interactions and
 * future expansion tools.
 */
export function batchResortStaticGeometry(root) {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const dynamicNodes = dynamicDoorNodes(root);
  const buckets = new Map();
  let sourceDrawCalls = 0;
  let sourceTriangles = 0;

  root.traverse((node) => {
    if (!node.isMesh || !node.geometry || !node.material) return;
    if (collisionNode(node)) {
      node.visible = false;
      node.userData.runtimeCollisionActive = false;
      return;
    }
    node.castShadow = true;
    node.receiveShadow = true;
    node.frustumCulled = true;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (dynamicNodes.has(node) || materials.length !== 1 || node.geometry.morphAttributes?.position) {
      for (const material of materials) configureResortMaterial(material);
      return;
    }

    const material = materials[0];
    const signature = `${material.uuid}|${geometrySignature(node.geometry)}`;
    let bucket = buckets.get(signature);
    if (!bucket) {
      bucket = { material, geometries: [], sources: [] };
      buckets.set(signature, bucket);
    }
    const geometry = node.geometry.clone();
    const relative = inverseRoot.clone().multiply(node.matrixWorld);
    geometry.applyMatrix4(relative);
    bucket.geometries.push(geometry);
    bucket.sources.push(node);
    sourceDrawCalls += 1;
    sourceTriangles += geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count || 0) / 3;
  });

  const batchRoot = new THREE.Group();
  batchRoot.name = 'RUNTIME_ResortStaticBatches';
  batchRoot.userData.runtimeOnly = true;
  let batchedDrawCalls = 0;
  let batchedTriangles = 0;
  let shadowCasterMeshCount = 0;

  for (const bucket of buckets.values()) {
    let merged = null;
    try {
      merged = bucket.geometries.length === 1
        ? bucket.geometries[0]
        : mergeGeometries(bucket.geometries, false);
    } catch (_) {
      merged = null;
    }
    if (!merged) {
      for (const geometry of bucket.geometries) geometry.dispose();
      continue;
    }
    for (const geometry of bucket.geometries) if (geometry !== merged) geometry.dispose();
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.name = `BATCH_Resort_${String(bucket.material.name || 'Material').replace(/[^a-z0-9_-]+/gi, '_')}`;
    mesh.castShadow = resortMaterialCastsShadow(bucket.material);
    if (mesh.castShadow) shadowCasterMeshCount += 1;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    configureResortMaterial(bucket.material);
    batchRoot.add(mesh);
    for (const source of bucket.sources) {
      source.visible = false;
      source.userData.resortRuntimeBatchSuppressed = true;
    }
    batchedDrawCalls += 1;
    batchedTriangles += merged.index
      ? merged.index.count / 3
      : (merged.getAttribute('position')?.count || 0) / 3;
  }

  root.add(batchRoot);
  return Object.freeze({
    batchRoot,
    sourceDrawCalls,
    batchedDrawCalls,
    sourceTriangles: Math.round(sourceTriangles),
    batchedTriangles: Math.round(batchedTriangles),
    drawCallsSaved: sourceDrawCalls - batchedDrawCalls,
    preservedDoorNodeCount: dynamicNodes.size,
    shadowCasterMeshCount,
    offlineOptimized: false,
  });
}

function configureOfflineOptimizedTree(root) {
  const dynamicNodes = dynamicDoorNodes(root);
  let drawCalls = 0;
  let triangles = 0;
  let shadowCasterMeshCount = 0;
  root.traverse((node) => {
    if (collisionNode(node)) {
      node.visible = false;
      node.userData.runtimeCollisionActive = false;
      return;
    }
    if (!node.isMesh || !node.geometry) return;
    drawCalls += Array.isArray(node.material) ? node.material.length : 1;
    triangles += node.geometry.index
      ? node.geometry.index.count / 3
      : (node.geometry.getAttribute('position')?.count || 0) / 3;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    node.castShadow = materials.some((material) => resortMaterialCastsShadow(material));
    if (node.castShadow) shadowCasterMeshCount += 1;
    node.receiveShadow = true;
    node.frustumCulled = true;
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      configureResortMaterial(material);
    }
  });
  return Object.freeze({
    batchRoot: null,
    sourceDrawCalls: drawCalls,
    batchedDrawCalls: drawCalls,
    sourceTriangles: Math.round(triangles),
    batchedTriangles: Math.round(triangles),
    drawCallsSaved: 0,
    preservedDoorNodeCount: dynamicNodes.size,
    shadowCasterMeshCount,
    offlineOptimized: true,
  });
}

/**
 * Mount the Course-4 resort presentation while leaving the existing analytic
 * checkout, door, navigation, save, and player-decoration authorities intact.
 */
export function createResortClubhouse({
  group,
  legacyInterior = null,
  shellFallbacks,
  sheet06Production,
  doors,
  enabled = true,
  floorTop = 0.3,
  facadeDoorZ = null,
  entranceCenterX = null,
  competingRoots = [],
  addCollider = null,
  removeCollider = null,
  colBoxAt = null,
  url = RESORT_CLUBHOUSE_URL,
  loader = new GLTFLoader(),
} = {}) {
  if (!group?.add) throw new TypeError('Resort clubhouse requires the clubhouse shell group.');
  let disposed = false;
  let root = null;
  let status = enabled ? 'loading' : 'inactive';
  let error = null;
  let batch = null;
  let waterPhase = 0;
  let colliderHandles = [];
  const pivots = Object.create(null);
  const waterMaterials = new Set();
  const hiddenSheet06 = new Set();
  const hiddenFallbacks = new Set();
  const hiddenCompetingRoots = new Map();
  const hiddenLegacyGroupChildren = new Map();
  const hiddenLegacyInteriorChildren = new Map();

  function competingPresentationRoots() {
    return competingRoots.flatMap((entry) => {
      const value = typeof entry === 'function' ? entry() : entry;
      if (!value) return [];
      if (Array.isArray(value)) return value.filter(Boolean);
      if (value instanceof Map) return [...value.values()].filter(Boolean);
      if (typeof value === 'object' && !value.isObject3D) return Object.values(value).filter(Boolean);
      return [value];
    });
  }

  function suppressCompetingPresentations() {
    if (!root || disposed) return;
    for (const candidate of competingPresentationRoots()) {
      if (!candidate?.isObject3D || candidate === root) continue;
      if (!hiddenCompetingRoots.has(candidate)) hiddenCompetingRoots.set(candidate, candidate.visible);
      candidate.visible = false;
    }
  }

  function hideReplacedVisuals() {
    if (!root || disposed) return;
    for (const candidate of group.children) {
      if (!candidate?.isObject3D || candidate === root) continue;
      if (!hiddenLegacyGroupChildren.has(candidate)) {
        hiddenLegacyGroupChildren.set(candidate, candidate.visible);
      }
      candidate.visible = false;
    }
    // The resort GLB owns the architectural shell and begins empty. Keep only
    // furniture the player has placed through the existing layout/save system;
    // fixed legacy checkout, lounge, stock, grime, and office dressing belong
    // to the smaller clubhouse presentation and otherwise bleed through the
    // resort's large arched windows.
    for (const candidate of legacyInterior?.children || []) {
      if (!candidate?.isObject3D || candidate.userData?.playerPlacedFurniture === true) continue;
      if (!hiddenLegacyInteriorChildren.has(candidate)) {
        hiddenLegacyInteriorChildren.set(candidate, candidate.visible);
      }
      candidate.visible = false;
    }
    for (const number of REPLACED_SHEET06_ASSETS) {
      const authored = sheet06Production?.getRoot?.(number);
      if (!authored) continue;
      authored.visible = false;
      hiddenSheet06.add(number);
    }
    for (const key of REPLACED_FALLBACK_KEYS) {
      const fallback = shellFallbacks?.[key];
      if (!fallback) continue;
      if (typeof fallback.setVisible === 'function') fallback.setVisible(false);
      else fallback.visible = false;
      hiddenFallbacks.add(key);
    }
    suppressCompetingPresentations();
  }

  function cachePivots() {
    pivots.left = root.getObjectByName('PIVOT_DoorLeft');
    pivots.right = root.getObjectByName('PIVOT_DoorRight');
  }

  function cacheWaterMaterials() {
    root?.traverse?.((node) => {
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (!material || !/Water_ResortBlue/i.test(String(material.name || ''))) continue;
        if (!Number.isFinite(material.userData.resortBaseOpacity)) {
          material.userData.resortBaseOpacity = material.opacity;
          material.userData.resortBaseRoughness = material.roughness;
        }
        waterMaterials.add(material);
      }
    });
  }

  function animateWater(dt = 0) {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    waterPhase = (waterPhase + step) % (Math.PI * 2);
    const shimmer = Math.sin(waterPhase * 1.85);
    for (const material of waterMaterials) {
      const baseOpacity = material.userData.resortBaseOpacity;
      const baseRoughness = material.userData.resortBaseRoughness;
      if (Number.isFinite(baseOpacity)) material.opacity = baseOpacity * (0.96 + shimmer * 0.035);
      if (Number.isFinite(baseRoughness)) material.roughness = Math.max(0.04, baseRoughness + shimmer * 0.025);
    }
  }

  function syncDoorPivots() {
    if (!root || disposed || !Array.isArray(doors)) return;
    const left = doors.find((door) => door.mainLeaf === 'left');
    const right = doors.find((door) => door.mainLeaf === 'right');
    if (pivots.left && left) pivots.left.rotation.y = left.angle;
    if (pivots.right && right) pivots.right.rotation.y = right.angle;
  }

  const ready = enabled ? new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => {
        if (disposed) {
          releaseDetachedTree(gltf.scene);
          resolve({ ok: false, disposed: true, url });
          return;
        }
        root = gltf.scene;
        root.name = 'ResortClubhouse_4000sqft';
        root.scale.setScalar(METERS_TO_YARDS);
        root.position.y = floorTop - AUTHORED_FLOOR_HEIGHT_METERS * METERS_TO_YARDS;
        if (Number.isFinite(entranceCenterX)) {
          root.position.x = entranceCenterX - AUTHORED_DOOR_CENTER_X_METERS * METERS_TO_YARDS;
        }
        if (Number.isFinite(facadeDoorZ)) {
          root.position.z = facadeDoorZ - AUTHORED_DOOR_PLANE_Z_METERS * METERS_TO_YARDS;
        }
        root.userData.conditionedAreaSquareFeet = RESORT_CLUBHOUSE_AREA_SQUARE_FEET;
        root.userData.interiorPolicy = 'INTENTIONALLY_EMPTY_PLAYER_FURNISHES';
        root.userData.source = 'asset_sources/blender/clubhouse_resort_4000/clubhouse_resort_4000.blend';
        root.userData.license = 'Project-owned original geometry; no external assets or textures';
        const authoredRoot = root.getObjectByName('ROOT_ClubhouseResort4000') || root;
        batch = authoredRoot.userData.runtime_optimized === true
          ? configureOfflineOptimizedTree(root)
          : batchResortStaticGeometry(root);
        cachePivots();
        cacheWaterMaterials();
        group.add(root);
        root.updateMatrixWorld(true);
        colliderHandles = registerResortColliders({
          addCollider, removeCollider, colBoxAt, entranceCenterX, facadeDoorZ,
        });
        hideReplacedVisuals();
        syncDoorPivots();
        status = 'ready';
        resolve({ ok: true, root, url, batch });
      },
      undefined,
      (cause) => {
        status = 'fallback';
        error = cause instanceof Error ? cause : new Error(String(cause || 'unknown load failure'));
        console.warn('resort clubhouse load failed; retaining the established presentation', error);
        resolve({ ok: false, error, url });
      },
    );
  }) : Promise.resolve({ ok: true, inactive: true, url });

  if (enabled) void Promise.resolve(sheet06Production?.ready).then(() => hideReplacedVisuals());

  return Object.freeze({
    ready,
    enabled: () => enabled,
    update(dt = 0) {
      if (!root || disposed) return;
      hideReplacedVisuals();
      syncDoorPivots();
      animateWater(dt);
    },
    root: () => root,
    diagnostics: () => Object.freeze({
      status,
      enabled,
      url,
      loaded: Boolean(root),
      conditionedAreaSquareFeet: RESORT_CLUBHOUSE_AREA_SQUARE_FEET,
      dimensionsMeters: Object.freeze({
        width: RESORT_CLUBHOUSE_WIDTH_METERS,
        depth: RESORT_CLUBHOUSE_DEPTH_METERS,
      }),
      interiorPolicy: 'INTENTIONALLY_EMPTY_PLAYER_FURNISHES',
      modularSourcePreserved: true,
      runtimeBatch: batch ? Object.freeze({
        sourceDrawCalls: batch.sourceDrawCalls,
        batchedDrawCalls: batch.batchedDrawCalls,
        drawCallsSaved: batch.drawCallsSaved,
        sourceTriangles: batch.sourceTriangles,
        batchedTriangles: batch.batchedTriangles,
        preservedDoorNodeCount: batch.preservedDoorNodeCount,
        shadowCasterMeshCount: batch.shadowCasterMeshCount,
        offlineOptimized: batch.offlineOptimized,
      }) : null,
      hiddenSheet06Assets: Object.freeze([...hiddenSheet06].sort((a, b) => a - b)),
      hiddenFallbacks: Object.freeze([...hiddenFallbacks].sort()),
      hiddenCompetingPresentationCount: hiddenCompetingRoots.size,
      hiddenLegacyGroupChildCount: hiddenLegacyGroupChildren.size,
      hiddenLegacyInteriorChildCount: hiddenLegacyInteriorChildren.size,
      legacyInteriorAttached: Boolean(legacyInterior?.parent),
      colliderCount: colliderHandles.length,
      pivotCount: Object.values(pivots).filter(Boolean).length,
      animatedWaterMaterialCount: waterMaterials.size,
      error: error?.message || null,
    }),
    dispose() {
      if (disposed) return Object.freeze({ alreadyDisposed: true });
      disposed = true;
      for (const handle of colliderHandles) handle.remove();
      colliderHandles = [];
      for (const [candidate, visible] of hiddenCompetingRoots) candidate.visible = visible;
      hiddenCompetingRoots.clear();
      for (const [candidate, visible] of hiddenLegacyGroupChildren) candidate.visible = visible;
      hiddenLegacyGroupChildren.clear();
      for (const [candidate, visible] of hiddenLegacyInteriorChildren) candidate.visible = visible;
      hiddenLegacyInteriorChildren.clear();
      return Object.freeze({ alreadyDisposed: false, loaded: Boolean(root) });
    },
  });
}

export default createResortClubhouse;
