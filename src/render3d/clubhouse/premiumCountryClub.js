import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { METERS_TO_YARDS } from '../assets51to100/units.js';

export const PREMIUM_COUNTRY_CLUB_URL = 'vendor/models/premium_clubhouse/premium_clubhouse_architecture.glb';
export const PREMIUM_COUNTRY_CLUB_AREA_SQUARE_FEET = 6888.9;
export const PREMIUM_COUNTRY_CLUB_WIDTH_METERS = 32;
export const PREMIUM_COUNTRY_CLUB_DEPTH_METERS = 10;
export const PREMIUM_COUNTRY_CLUB_SITE_WIDTH_METERS = 100;
export const PREMIUM_COUNTRY_CLUB_SITE_DEPTH_METERS = 112;
export const PREMIUM_COUNTRY_CLUB_METERS_TO_YARDS = METERS_TO_YARDS;

// Blender's -Y facade becomes +Z in glTF. The member doors are flush with the
// authored facade plane and the finished ground floor is 0.30 m above datum.
const AUTHORED_FACADE_Z_METERS = 5;
const AUTHORED_FLOOR_HEIGHT_METERS = 0.30;
const MAX_RUNTIME_LIGHTS = 12;
const REPLACED_SHEET06_ASSETS = Object.freeze([51, 52, 53, 54, 55, 58]);
const REPLACED_FALLBACK_KEYS = Object.freeze([
  'exteriorShellStructure',
  'apertureTrim',
  'porchVisuals',
  'windowVisuals',
  'ceilingVisuals',
]);
const COLLISION_NODE = /^(?:COL(?:_|$)|.*Collision(?:_|$))/i;

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

function pivotNodes(root) {
  const nodes = new Set();
  root.traverse((node) => {
    if (!String(node.name || '').startsWith('PIVOT_')) return;
    node.traverse((child) => nodes.add(child));
  });
  return nodes;
}

/**
 * Preserve the full modular source GLB while reducing the production render
 * submission count. Only immutable presentation meshes are merged; all named
 * pivots, sockets, collision proxies, and source metadata remain in the tree.
 */
export function batchPremiumCountryClubStaticGeometry(root) {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const dynamicNodes = pivotNodes(root);
  const buckets = new Map();
  let sourceDrawCalls = 0;
  let sourceTriangles = 0;
  let hiddenCollisionCount = 0;

  root.traverse((node) => {
    if (!node.isMesh || !node.geometry || !node.material) return;
    if (collisionNode(node)) {
      node.visible = false;
      node.userData.runtimeCollisionActive = false;
      hiddenCollisionCount += 1;
      return;
    }
    node.geometry.computeBoundingBox();
    const localSize = node.geometry.boundingBox?.getSize(new THREE.Vector3()) || new THREE.Vector3();
    const flatSiteSurface = hasAncestorName(node, /ARCH_ClubhouseSite/i)
      && localSize.y * Math.abs(node.scale.y) <= 0.45
      && Math.max(localSize.x * Math.abs(node.scale.x), localSize.z * Math.abs(node.scale.z)) >= 0.8;
    node.castShadow = !flatSiteSurface;
    node.receiveShadow = true;
    node.frustumCulled = true;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (dynamicNodes.has(node) || materials.length !== 1 || node.geometry.morphAttributes?.position) {
      if (node.material?.transparent) {
        node.material.depthWrite = false;
        node.material.side = THREE.DoubleSide;
      }
      return;
    }

    const material = materials[0];
    const signature = `${material.uuid}|cast:${node.castShadow ? 1 : 0}|${geometrySignature(node.geometry)}`;
    let bucket = buckets.get(signature);
    if (!bucket) {
      bucket = { material, geometries: [], sources: [], castShadow: node.castShadow };
      buckets.set(signature, bucket);
    }
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(inverseRoot.clone().multiply(node.matrixWorld));
    bucket.geometries.push(geometry);
    bucket.sources.push(node);
    sourceDrawCalls += 1;
    sourceTriangles += geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count || 0) / 3;
  });

  const batchRoot = new THREE.Group();
  batchRoot.name = 'RUNTIME_PremiumCountryClubStaticBatches';
  batchRoot.userData.runtimeOnly = true;
  let batchedDrawCalls = 0;
  let batchedTriangles = 0;

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
    mesh.name = `BATCH_Premium_${String(bucket.material.name || 'Material').replace(/[^a-z0-9_-]+/gi, '_')}`;
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    if (bucket.material.transparent) {
      bucket.material.depthWrite = false;
      bucket.material.side = THREE.DoubleSide;
    }
    batchRoot.add(mesh);
    for (const source of bucket.sources) {
      source.visible = false;
      source.userData.premiumRuntimeBatchSuppressed = true;
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
    preservedPivotNodeCount: dynamicNodes.size,
    hiddenCollisionCount,
  });
}

function hasAncestorName(node, pattern) {
  for (let current = node; current; current = current.parent) {
    if (pattern.test(String(current.name || ''))) return true;
  }
  return false;
}

function findMemberDoorPivots(root) {
  const pivots = { left: null, right: null };
  root.traverse((node) => {
    if (!String(node.name || '').startsWith('PIVOT_')) return;
    if (!hasAncestorName(node, /Front_Ground_Center_MemberEntrance/i)) return;
    if (/LeftLeaf/i.test(node.name)) pivots.left = node;
    if (/RightLeaf/i.test(node.name)) pivots.right = node;
  });
  return pivots;
}

function installCappedLights(root) {
  const candidates = [];
  root.traverse((node) => {
    if (!String(node.name || '').startsWith('SOCKET_')) return;
    if (!/(?:Light|WaterJet)/i.test(String(node.name || ''))) return;
    const ancestor = (pattern) => hasAncestorName(node, pattern);
    let priority = 0;
    let category = 'other';
    if (ancestor(/Front_Facade_Sconce/i)) {
      priority = 100;
      category = 'front';
    }
    else if (ancestor(/Rear_Facade_Sconce/i)) {
      priority = 90;
      category = 'rear';
    }
    else if (ancestor(/PremiumFountain/i)) {
      priority = 85;
      category = 'fountain';
    }
    else if (ancestor(/ARCH_EmptyInterior/i)) {
      priority = 75;
      category = 'interior';
    }
    else if (ancestor(/Facade_Sconce/i)) {
      priority = 70;
      category = 'side';
    }
    else if (ancestor(/Parking_.*_Light/i)) {
      priority = 65;
      category = 'parking';
    }
    if (priority) candidates.push({ node, priority, category });
  });
  candidates.sort((left, right) => right.priority - left.priority || left.node.name.localeCompare(right.node.name));
  const selected = [];
  const selectedNodes = new Set();
  const reserveSpread = (category, count) => {
    const matches = candidates.filter((candidate) => candidate.category === category);
    for (let index = 0; index < Math.min(count, matches.length); index++) {
      const candidate = matches[Math.floor(index * matches.length / count)];
      if (!candidate || selectedNodes.has(candidate.node)) continue;
      selected.push(candidate);
      selectedNodes.add(candidate.node);
    }
  };
  reserveSpread('front', 4);
  reserveSpread('rear', 2);
  reserveSpread('fountain', 2);
  reserveSpread('parking', 2);
  reserveSpread('interior', 2);
  for (const candidate of candidates) {
    if (selected.length >= MAX_RUNTIME_LIGHTS) break;
    if (selectedNodes.has(candidate.node)) continue;
    selected.push(candidate);
    selectedNodes.add(candidate.node);
  }
  const lights = [];
  for (const { node, priority, category } of selected) {
    const fountain = category === 'fountain';
    const parking = category === 'parking';
    const interior = category === 'interior';
    const facade = category === 'front' || category === 'rear' || category === 'side';
    const light = new THREE.PointLight(
      fountain ? 0x82c9b5 : 0xffc27b,
      parking ? 6.0 : fountain ? 4.5 : interior ? 3.5 : facade ? 8.5 : 5.0,
      (parking ? 18 : fountain ? 10 : interior ? 9 : 13) * METERS_TO_YARDS,
      2,
    );
    light.name = `RUNTIME_${node.name}`;
    light.castShadow = false;
    light.userData.runtimeOnly = true;
    light.userData.socketPriority = priority;
    light.userData.category = category;
    light.userData.baseIntensity = light.intensity;
    node.add(light);
    lights.push(light);
  }
  return lights;
}

function registerPremiumColliders({ addCollider, removeCollider, colBoxAt, entranceCenterX, facadeDoorZ }) {
  if (typeof addCollider !== 'function' || typeof colBoxAt !== 'function') return [];
  if (!Number.isFinite(entranceCenterX) || !Number.isFinite(facadeDoorZ)) return [];
  const s = METERS_TO_YARDS;
  const wallT = 0.34 * s;
  const centerZ = facadeDoorZ - AUTHORED_FACADE_Z_METERS * s;
  const colliders = [];
  const add = (lx, lz, width, depth, kind) => {
    const collider = { ...colBoxAt(lx, lz, width, depth), kind, premiumCountryClub: true };
    colliders.push(addCollider(collider));
  };
  const xWorld = (meters) => entranceCenterX + meters * s;
  const frontSegments = [[-16, -11.4], [-8.6, -1.8], [1.8, 8.6], [11.4, 16]];
  const rearSegments = [[-16, -15.6], [-12.4, 4.6], [7.4, 16]];
  for (const [min, max] of frontSegments) add(xWorld((min + max) / 2), facadeDoorZ, (max - min) * s, wallT, 'premium-front-wall');
  for (const [min, max] of rearSegments) add(xWorld((min + max) / 2), centerZ - 5 * s, (max - min) * s, wallT, 'premium-rear-wall');
  const side = (x, intervals, kind) => {
    for (const [min, max] of intervals) {
      const z = centerZ - ((min + max) / 2) * s;
      add(xWorld(x), z, wallT, (max - min) * s, kind);
    }
  };
  side(-16, [[-5, 0], [2, 5]], 'premium-west-wall');
  side(16, [[-5, -4], [-2, 5]], 'premium-east-wall');
  // A conservative square proxy keeps the player out of the fountain basin;
  // modular source collision geometry remains available for a future physics backend.
  add(xWorld(0), centerZ + 34 * s, 8.2 * s, 8.2 * s, 'premium-fountain');
  return colliders.map((collider) => ({ collider, remove: () => removeCollider?.(collider) }));
}

/** Mount the Course-5 premium private club without replacing simulation state. */
export function createPremiumCountryClub({
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
  url = PREMIUM_COUNTRY_CLUB_URL,
  loader = new GLTFLoader(),
} = {}) {
  if (!group?.add) throw new TypeError('Premium country club requires the clubhouse shell group.');
  let disposed = false;
  let root = null;
  let status = enabled ? 'loading' : 'inactive';
  let error = null;
  let batch = null;
  let pivots = { left: null, right: null };
  let runtimeLights = [];
  let lightMoodMinute = 12 * 60;
  let colliderHandles = [];
  const hiddenSheet06 = new Set();
  const hiddenFallbacks = new Set();
  const hiddenCompetingRoots = new Map();
  const hiddenLegacyGroupChildren = new Map();
  const hiddenLegacyInteriorChildren = new Map();

  function practicalLightFactor(minuteOfDay) {
    const minute = ((Number(minuteOfDay) % 1440) + 1440) % 1440;
    const smooth = (value) => value * value * (3 - 2 * value);
    if (minute < 6 * 60 || minute >= 20 * 60) return 1;
    if (minute < 8 * 60) return 1 - smooth((minute - 6 * 60) / (2 * 60)) * 0.92;
    if (minute < 18 * 60) return 0.08;
    return 0.08 + smooth((minute - 18 * 60) / (2 * 60)) * 0.92;
  }

  function syncRuntimeLightMood() {
    const factor = practicalLightFactor(lightMoodMinute);
    for (const light of runtimeLights) {
      light.intensity = (Number(light.userData.baseIntensity) || 0) * factor;
    }
    return factor;
  }

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

  function hideReplacedVisuals() {
    if (!root || disposed) return;
    for (const candidate of group.children) {
      if (!candidate?.isObject3D || candidate === root) continue;
      if (!hiddenLegacyGroupChildren.has(candidate)) {
        hiddenLegacyGroupChildren.set(candidate, candidate.visible);
      }
      candidate.visible = false;
    }
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
    for (const candidate of competingPresentationRoots()) {
      if (!candidate?.isObject3D || candidate === root) continue;
      if (!hiddenCompetingRoots.has(candidate)) hiddenCompetingRoots.set(candidate, candidate.visible);
      candidate.visible = false;
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
        root.name = 'PremiumCountryClub_6889sqft';
        root.scale.setScalar(METERS_TO_YARDS);
        root.position.y = floorTop - AUTHORED_FLOOR_HEIGHT_METERS * METERS_TO_YARDS;
        if (Number.isFinite(entranceCenterX)) root.position.x = entranceCenterX;
        if (Number.isFinite(facadeDoorZ)) root.position.z = facadeDoorZ - AUTHORED_FACADE_Z_METERS * METERS_TO_YARDS;
        root.userData.conditionedAreaSquareFeet = PREMIUM_COUNTRY_CLUB_AREA_SQUARE_FEET;
        root.userData.interiorPolicy = 'INTENTIONALLY_EMPTY_PLAYER_FURNISHES';
        root.userData.source = 'asset_sources/blender/premium_clubhouse/premium_clubhouse_architecture.blend';
        root.userData.license = 'Project-owned original geometry and textures; no external assets';
        batch = batchPremiumCountryClubStaticGeometry(root);
        pivots = findMemberDoorPivots(root);
        runtimeLights = installCappedLights(root);
        syncRuntimeLightMood();
        group.add(root);
        root.updateMatrixWorld(true);
        colliderHandles = registerPremiumColliders({
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
        console.warn('premium country club load failed; retaining the established presentation', error);
        resolve({ ok: false, error, url });
      },
    );
  }) : Promise.resolve({ ok: true, inactive: true, url });

  if (enabled) void Promise.resolve(sheet06Production?.ready).then(() => hideReplacedVisuals());

  return Object.freeze({
    ready,
    update() {
      if (!root || disposed) return;
      hideReplacedVisuals();
      syncDoorPivots();
    },
    setTimeMood(minuteOfDay) {
      lightMoodMinute = Number.isFinite(minuteOfDay) ? minuteOfDay : lightMoodMinute;
      return syncRuntimeLightMood();
    },
    root: () => root,
    diagnostics: () => Object.freeze({
      status,
      enabled,
      url,
      loaded: Boolean(root),
      conditionedAreaSquareFeet: PREMIUM_COUNTRY_CLUB_AREA_SQUARE_FEET,
      dimensionsMeters: Object.freeze({
        width: PREMIUM_COUNTRY_CLUB_WIDTH_METERS,
        depth: PREMIUM_COUNTRY_CLUB_DEPTH_METERS,
        siteWidth: PREMIUM_COUNTRY_CLUB_SITE_WIDTH_METERS,
        siteDepth: PREMIUM_COUNTRY_CLUB_SITE_DEPTH_METERS,
      }),
      interiorPolicy: 'INTENTIONALLY_EMPTY_PLAYER_FURNISHES',
      modularSourcePreserved: true,
      runtimeBatch: batch ? Object.freeze({
        sourceDrawCalls: batch.sourceDrawCalls,
        batchedDrawCalls: batch.batchedDrawCalls,
        drawCallsSaved: batch.drawCallsSaved,
        sourceTriangles: batch.sourceTriangles,
        batchedTriangles: batch.batchedTriangles,
        preservedPivotNodeCount: batch.preservedPivotNodeCount,
        hiddenCollisionCount: batch.hiddenCollisionCount,
      }) : null,
      runtimeLightCount: runtimeLights.length,
      runtimeLightCap: MAX_RUNTIME_LIGHTS,
      runtimeLightNames: Object.freeze(runtimeLights.map((light) => light.name)),
      runtimeLightFactor: practicalLightFactor(lightMoodMinute),
      colliderCount: colliderHandles.length,
      pivotCount: Object.values(pivots).filter(Boolean).length,
      hiddenSheet06Assets: Object.freeze([...hiddenSheet06].sort((a, b) => a - b)),
      hiddenFallbacks: Object.freeze([...hiddenFallbacks].sort()),
      hiddenCompetingPresentationCount: hiddenCompetingRoots.size,
      hiddenLegacyGroupChildCount: hiddenLegacyGroupChildren.size,
      hiddenLegacyInteriorChildCount: hiddenLegacyInteriorChildren.size,
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

export default createPremiumCountryClub;
