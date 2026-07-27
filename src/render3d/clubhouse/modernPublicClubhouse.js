import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import {
  collectRenderableResources,
  disposeRenderableResources,
} from './resourceLifecycle.js';
import { SWING } from '../../data/doorMath.js';
import { MODERN_PUBLIC_RESTROOM } from '../../data/shopLayout.js';

export const MODERN_CLUBHOUSE_METERS_TO_YARDS = 1 / 0.9144;
export const MODERN_CLUBHOUSE_BUILDING_WIDTH_METERS = 16.80;
export const MODERN_CLUBHOUSE_BUILDING_DEPTH_METERS = 10.50;
export const MODERN_CLUBHOUSE_MAIN_DOOR_X_METERS = -0.73152;
export const MODERN_CLUBHOUSE_SERVICE_DOOR_WIDTH_METERS = 1.3716;
export const MODERN_CLUBHOUSE_CART_BARN_X_METERS = 24.50;

export const MODERN_CLUBHOUSE_ROOM_DOORS = Object.freeze([
  Object.freeze({
    key: 'employee', name: 'Employee door', pivotName: 'PIVOT_Interior_EmployeeRoom',
    centerXM: 5.35, centerYM: -3.70, widthM: 0.92, heightM: 2.12,
  }),
  Object.freeze({
    key: 'storage', name: 'Storage door', pivotName: 'PIVOT_Interior_Storage',
    centerXM: 5.35, centerYM: 0.20, widthM: 0.92, heightM: 2.12,
  }),
  Object.freeze({
    key: 'restroom', name: 'Restroom door', pivotName: 'PIVOT_Interior_Irrigation',
    centerXM: 5.35, centerYM: 4.18, widthM: 0.92, heightM: 2.12,
  }),
]);

function modernRoomDoorBindings() {
  const s = MODERN_CLUBHOUSE_METERS_TO_YARDS;
  return MODERN_CLUBHOUSE_ROOM_DOORS.map((spec) => Object.freeze({
    key: spec.key,
    name: spec.name,
    pivotName: spec.pivotName,
    cx: spec.centerXM * s,
    // Blender +Y exports to runtime -Z.
    cz: -spec.centerYM * s,
    width: spec.widthM * s,
    height: spec.heightM * s,
    along: 'z',
    closedSign: -1,
    hingeLx: spec.centerXM * s,
    hingeLz: (-spec.centerYM + spec.widthM / 2) * s,
    // Park the leaf inside the eastern service room, out of the public aisle.
    fixedSwing: -SWING,
  }));
}

const BUILDING_URL = 'vendor/models/clubhouse/modern_public_clubhouse_v1.glb';
const SITE_URL = 'vendor/models/clubhouse/modern_public_clubhouse_site_v1.glb';
const DIRECT_REPLACEMENTS = Object.freeze([51, 52, 53, 54]);
const ASSEMBLY_REPLACEMENTS = Object.freeze([55, 56, 57, 58, 59, 60]);
const FALLBACK_REPLACEMENTS = Object.freeze([
  'exteriorShellStructure',
  'apertureTrim',
  'porchVisuals',
  'windowVisuals',
  'renovatedFloor',
  'ceilingVisuals',
  'wainscotPanels',
  'interiorTrim',
  // The modern GLB owns a three-door service spine. Leaving the older solid
  // two-room partition visible 0.15 yd in front of it hides the walnut leaves,
  // brass hardware and Pine Hills room signs behind what looks like blank wall.
  'servicePartitions',
]);
const NAMED_PRESENTATION_REPLACEMENTS = Object.freeze([
  'LegacyApproachWalk_1',
  'LegacyApproachWalk_2',
  'LegacyApproachWalk_3',
  'LegacyApproachWalk_4',
  'LegacyClubApproachSign',
  'LegacyBusinessHoursSign',
  'ShopTierStatusSign',
  'LegacyWindowDirtFilm_0',
  'LegacyWindowDirtFilm_1',
  'LegacyWindowDirtFilm_2',
  'LegacyWindowDirtFilm_3',
]);
const BUILT_IN_DOOR_PRESENTATION_NAMES = Object.freeze([
  'LOD0_MainEntranceFrame',
  'LOD0_MODULE_MainEntranceDoors',
  'LOD0_RearServiceDoorFrame',
  // Keep direct-pivot fallbacks for older exports and focused test fixtures.
  'PIVOT_MainEntranceLeft',
  'PIVOT_MainEntranceRight',
  'PIVOT_RearServiceDoor',
]);

function normalizeError(error) {
  return {
    name: String(error?.name || 'Error'),
    message: String(error?.message || error || 'Unknown modern clubhouse load error.'),
  };
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

// The authored transmission stays intact, but a near-mirror storefront turns
// the outdoor sun into repeated white pin lights at every pane from the player
// camera. Restrain only the municipal shell glass; cooler/display glass keeps
// its product-specific material response.
export function restrainModernStorefrontGlass(root) {
  if (!root?.traverse) return 0;
  const materials = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (material?.name === 'MAT_MCP_ClearStorefrontGlass') materials.add(material);
    }
  });
  for (const material of materials) {
    material.roughness = Math.max(0.34, Number(material.roughness) || 0);
    material.envMapIntensity = Math.min(0.20, Number.isFinite(material.envMapIntensity)
      ? material.envMapIntensity
      : 1);
    material.needsUpdate = true;
  }
  return materials.size;
}

/**
 * Preserve the complete modular hierarchy but collapse immutable meshes for
 * rendering. Hidden sources remain addressable for future customization tools;
 * all moving pivots, transparent glazing, and collision proxies stay separate.
 */
export function batchModernClubhouseStaticGeometry(root, kind = 'asset') {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const moving = movingNodes(root);
  const buckets = new Map();
  let sourceDrawCalls = 0;
  let sourceTriangles = 0;

  root.traverse((object) => {
    if (!object.isMesh || !object.geometry || !object.material) return;
    if (object.userData?.runtimePresentationSuppressed === true) return;
    const collision = object.name.startsWith('COL_') || object.userData?.collision_proxy === true;
    if (collision) {
      object.visible = false;
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const matrixElements = object.matrixWorld.elements;
    const determinant = object.matrixWorld.determinant();
    const finiteTransform = matrixElements.every(Number.isFinite)
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
  batchRoot.name = `RUNTIME_ModernClubhouseStaticBatches_${kind}`;
  batchRoot.userData.runtimeOnly = true;
  let batchedDrawCalls = 0;
  let batchedTriangles = 0;
  let batchedSourceDrawCalls = 0;

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
    mesh.name = `BATCH_Modern_${kind}_${String(bucket.material.name || 'Material').replace(/[^a-z0-9_-]+/gi, '_')}`;
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    mesh.frustumCulled = true;
    batchRoot.add(mesh);
    for (const source of bucket.sources) {
      source.visible = false;
      source.userData.modernRuntimeBatchSuppressed = true;
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

function configureRoot(root, name) {
  root.name = name;
  root.scale.setScalar(MODERN_CLUBHOUSE_METERS_TO_YARDS);
  root.userData.restrainedStorefrontMaterials = restrainModernStorefrontGlass(root);
  root.traverse((object) => {
    if (/^PIVOT_(?:MainEntranceLeft|MainEntranceRight|RearServiceDoor)$/.test(object.name)) {
      object.userData.modernClosedAngleY = object.rotation.y;
    }
    if (!object.isMesh) return;
    if (/Interior_(?:EmployeeRoom|Storage|Irrigation)_Label|CeilingLight_|Sign_(?:Pinehollow|GolfClub)/i.test(object.name || '')) {
      object.visible = false;
      object.userData.runtimePresentationSuppressed = true;
      return;
    }
    const collision = object.name.startsWith('COL_') || object.userData?.collision_proxy === true;
    object.visible = !collision;
    object.castShadow = !collision && !/Parking_Asphalt|Sidewalk|Patio_Paver|FloorSlab/i.test(object.name);
    object.receiveShadow = !collision;
  });
  root.updateMatrixWorld(true);
  return root;
}

function suppressBuiltInDoorPresentation(root) {
  const suppressed = new Set();
  for (const name of BUILT_IN_DOOR_PRESENTATION_NAMES) {
    const node = root.getObjectByName(name);
    if (!node) continue;
    node.traverse((object) => {
      object.visible = false;
      object.userData.runtimePresentationSuppressed = true;
      suppressed.add(object);
    });
  }
  return suppressed.size;
}

function uniqueRoots(sheet06) {
  const nodes = [
    ...DIRECT_REPLACEMENTS.map((number) => sheet06?.getRoot?.(number)),
    ...ASSEMBLY_REPLACEMENTS.map((number) => sheet06?.getAssemblyRoot?.(number)),
  ].filter(Boolean);
  return [...new Set(nodes)];
}

/**
 * Loads the original modern-public-course building and site as one atomic
 * presentation replacement.  The established Sheet-6 geometry remains the
 * functional fallback and retains save/door/navigation authority.
 */
export function createModernPublicClubhouse({
  group,
  legacyInterior,
  sheet06,
  shellFallbacks,
  legacyPartitionColliders = [],
  doors,
  doorApi = null,
  addCollider,
  removeCollider,
  colBoxAt,
  replacementDoorPresentation = false,
  loader = new GLTFLoader(),
} = {}) {
  if (!group?.add || !group?.remove) throw new TypeError('Modern clubhouse requires a group mount.');
  if (typeof addCollider !== 'function' || typeof removeCollider !== 'function') {
    throw new TypeError('Modern clubhouse requires collider registration callbacks.');
  }
  if (typeof colBoxAt !== 'function') throw new TypeError('Modern clubhouse requires colBoxAt().');

  const staging = new group.constructor();
  staging.name = 'MODERN_PUBLIC_CLUBHOUSE_STAGING';
  group.add(staging);

  const roots = new Map();
  const errors = new Map();
  const visibilityRecords = [];
  const fallbackVisibilityRecords = [];
  const namedVisibilityRecords = [];
  const removedPresentationColliders = [];
  const registeredColliders = [];
  const removedLegacyPartitionColliders = [];
  const batches = new Map();
  let disposed = false;
  let suppressionApplied = false;
  let suppressedBuiltInDoorNodes = 0;
  let modernRoomDoorBinding = null;

  function load(kind, url, runtimeName) {
    return new Promise((resolve) => {
      loader.load(
        url,
        (gltf) => {
          const root = configureRoot(gltf.scene, runtimeName);
          if (kind === 'building' && replacementDoorPresentation) {
            suppressedBuiltInDoorNodes = suppressBuiltInDoorPresentation(root);
          }
          if (disposed) {
            disposeRenderableResources(collectRenderableResources(root));
            resolve(null);
            return;
          }
          staging.add(root);
          roots.set(kind, root);
          batches.set(kind, batchModernClubhouseStaticGeometry(root, kind));
          resolve(root);
        },
        undefined,
        (error) => {
          errors.set(kind, normalizeError(error));
          resolve(null);
        },
      );
    });
  }

  function registerColliders(entries, kindForIndex) {
    entries.forEach((collider, index) => {
      collider.kind = kindForIndex(index);
      collider.modernClubhouse = true;
      registeredColliders.push(addCollider(collider) || collider);
    });
  }

  function registerBuildingColliders() {
    const s = MODERN_CLUBHOUSE_METERS_TO_YARDS;
    const width = MODERN_CLUBHOUSE_BUILDING_WIDTH_METERS * s;
    const depth = MODERN_CLUBHOUSE_BUILDING_DEPTH_METERS * s;
    const wall = 0.23 * s;
    const halfW = width / 2;
    const halfD = depth / 2;
    const mainCenter = MODERN_CLUBHOUSE_MAIN_DOOR_X_METERS * s;
    const mainHalf = 0.90 * s;
    const serviceCenter = -3.29184 * s;
    const serviceHalf = MODERN_CLUBHOUSE_SERVICE_DOOR_WIDTH_METERS * s / 2;
    const segment = (axis, fixed, start, end) => axis === 'x'
      ? colBoxAt((start + end) / 2, fixed, end - start, wall)
      : colBoxAt(fixed, (start + end) / 2, wall, end - start);
    registerColliders([
      segment('x', halfD, -halfW, mainCenter - mainHalf),
      segment('x', halfD, mainCenter + mainHalf, halfW),
      colBoxAt(0, -halfD, width, wall),
      colBoxAt(-halfW, 0, wall, depth),
      segment('z', halfW, -halfD, serviceCenter - serviceHalf),
      segment('z', halfW, serviceCenter + serviceHalf, halfD),
    ], () => 'modern-clubhouse-wall');
  }

  function replaceInteriorPartitionColliders() {
    if (removedLegacyPartitionColliders.length || registeredColliders.some(
      (collider) => collider.kind === 'modern-clubhouse-partition',
    )) return;
    for (const collider of legacyPartitionColliders) {
      if (!collider) continue;
      removeCollider(collider);
      removedLegacyPartitionColliders.push(collider);
    }

    const s = MODERN_CLUBHOUSE_METERS_TO_YARDS;
    const wall = 0.23 * s;
    const halfW = MODERN_CLUBHOUSE_BUILDING_WIDTH_METERS * s / 2;
    const halfD = MODERN_CLUBHOUSE_BUILDING_DEPTH_METERS * s / 2;
    const spineX = 5.35 * s;
    const segmentZ = (start, end) => colBoxAt(
      spineX,
      (start + end) / 2,
      wall,
      end - start,
    );
    const roomOpenings = modernRoomDoorBindings()
      // Match makeDoor's analytic rough opening rather than the narrower leaf.
      // This preserves comfortable clearance even when a nearby fixture guides
      // the player's 0.68 yd capsule slightly off the aperture centreline.
      .map((door) => [door.cz - (door.width + 0.18) / 2, door.cz + (door.width + 0.18) / 2])
      .sort((left, right) => left[0] - right[0]);
    const entries = [];
    let cursor = -halfD + wall / 2;
    for (const [start, end] of roomOpenings) {
      if (start > cursor) entries.push(segmentZ(cursor, start));
      cursor = end;
    }
    if (cursor < halfD - wall / 2) entries.push(segmentZ(cursor, halfD - wall / 2));

    const officeCenterX = 7.55 * s;
    const officeWidth = 1.3;
    const crossStartX = spineX + wall / 2;
    const crossEndX = halfW - wall / 2;
    const frontCrossZ = 2.0;
    const segmentX = (start, end, z) => colBoxAt(
      (start + end) / 2,
      z,
      end - start,
      wall,
    );
    entries.push(
      segmentX(crossStartX, officeCenterX - officeWidth / 2, frontCrossZ),
      segmentX(officeCenterX + officeWidth / 2, crossEndX, frontCrossZ),
      segmentX(crossStartX, crossEndX, -2.25 * s),
    );
    const restroom = MODERN_PUBLIC_RESTROOM;
    const restroomDepth = Math.abs(restroom.northWallZ - restroom.southWallZ);
    entries.push(
      colBoxAt(
        restroom.eastWallX,
        (restroom.northWallZ + restroom.southWallZ) / 2,
        restroom.wallThickness,
        restroomDepth,
      ),
      colBoxAt(
        restroom.crossWallCenterX,
        restroom.southWallZ,
        restroom.crossWallWidth,
        restroom.wallThickness,
      ),
      colBoxAt(
        restroom.crossWallCenterX,
        restroom.northWallZ,
        restroom.crossWallWidth,
        restroom.wallThickness,
      ),
    );
    registerColliders(entries, () => 'modern-clubhouse-partition');
    registerColliders([
      colBoxAt(
        restroom.toilet.x,
        restroom.toilet.z,
        restroom.toilet.w,
        restroom.toilet.d,
      ),
      colBoxAt(
        restroom.sink.x,
        restroom.sink.z,
        restroom.sink.w,
        restroom.sink.d,
      ),
    ], () => 'modern-restroom-fixture');
  }

  function registerSiteColliders() {
    const s = MODERN_CLUBHOUSE_METERS_TO_YARDS;
    const entries = [
      // Cart barn side and rear walls; the five south-facing bays remain open.
      colBoxAt((MODERN_CLUBHOUSE_CART_BARN_X_METERS - 6.0) * s, -4.50 * s, 0.23 * s, 8.40 * s),
      colBoxAt((MODERN_CLUBHOUSE_CART_BARN_X_METERS + 6.0) * s, -4.50 * s, 0.23 * s, 8.40 * s),
      colBoxAt(MODERN_CLUBHOUSE_CART_BARN_X_METERS * s, -8.70 * s, 12.0 * s, 0.23 * s),
      // Loading-bay safety bollards.
      colBoxAt(10.05 * s, 2.25 * s, 0.30 * s, 0.30 * s),
      colBoxAt(10.05 * s, -2.55 * s, 0.30 * s, 0.30 * s),
    ];
    registerColliders(entries, (index) => (
      index < 3 ? 'modern-cart-barn' : 'modern-loading-bollard'
    ));
  }

  function suppressLegacyPresentation() {
    if (suppressionApplied || disposed) return;
    const nodes = uniqueRoots(sheet06);
    for (const node of nodes) {
      visibilityRecords.push({ node, visible: node.visible });
      node.visible = false;
    }
    for (const key of FALLBACK_REPLACEMENTS) {
      const fallback = shellFallbacks?.[key];
      if (!fallback) continue;
      const visible = fallback.visible !== false;
      fallbackVisibilityRecords.push({ fallback, visible });
      if (typeof fallback.setVisible === 'function') fallback.setVisible(false);
      else fallback.visible = false;
    }
    for (const name of NAMED_PRESENTATION_REPLACEMENTS) {
      const node = group.getObjectByName(name) || legacyInterior?.getObjectByName?.(name);
      if (!node) continue;
      namedVisibilityRecords.push({ node, visible: node.visible });
      node.visible = false;
      const collider = node.userData?.presentationCollider;
      if (collider) {
        removeCollider(collider);
        removedPresentationColliders.push(collider);
      }
    }
    suppressionApplied = nodes.length > 0
      || fallbackVisibilityRecords.length > 0
      || namedVisibilityRecords.length > 0;
  }

  function syncDoorPivots() {
    const building = roots.get('building');
    if (!building || !Array.isArray(doors)) return;
    const mainLeft = doors.find((door) => door.mainLeaf === 'left');
    const mainRight = doors.find((door) => door.mainLeaf === 'right');
    const receiving = doors.find((door) => door.name === 'Receiving door');
    const mainLeftPivot = building.getObjectByName('PIVOT_MainEntranceLeft');
    const mainRightPivot = building.getObjectByName('PIVOT_MainEntranceRight');
    const servicePivot = building.getObjectByName('PIVOT_RearServiceDoor');
    const sync = (pivot, door) => {
      if (!pivot || !door) return;
      pivot.rotation.y = (Number(pivot.userData.modernClosedAngleY) || 0) + door.angle;
    };
    sync(mainLeftPivot, mainLeft);
    sync(mainRightPivot, mainRight);
    sync(servicePivot, receiving);
  }

  const buildingReady = load('building', BUILDING_URL, 'MODERN_PUBLIC_CLUBHOUSE_BUILDING');
  const siteReady = load('site', SITE_URL, 'MODERN_PUBLIC_CLUBHOUSE_SITE');
  const ready = Promise.all([buildingReady, siteReady, sheet06?.ready || Promise.resolve()])
    .then(([building, site]) => {
      if (disposed) return diagnostics();
      if (building) {
        suppressLegacyPresentation();
        registerBuildingColliders();
        replaceInteriorPartitionColliders();
        syncDoorPivots();
        modernRoomDoorBinding = doorApi?.bindModernRoomDoorVisuals?.(
          building,
          modernRoomDoorBindings(),
        ) || null;
      }
      if (site) registerSiteColliders();
      return diagnostics();
    });

  function diagnostics() {
    const building = roots.get('building') || null;
    const site = roots.get('site') || null;
    return Object.freeze({
      lifecycle: disposed ? 'disposed' : (building && site ? 'active' : errors.size ? 'partial' : 'loading'),
      buildingLoaded: !!building,
      siteLoaded: !!site,
      sourcePaths: Object.freeze({ building: BUILDING_URL, site: SITE_URL }),
      footprintSquareMeters: 176.4,
      footprintSquareFeet: 1898.8,
      parkingSpaces: 52,
      interiorFurnishedByAsset: false,
      permanentRestroomFitout: true,
      modularConstruction: true,
      suppressionApplied,
      suppressedSheet06Roots: visibilityRecords.length,
      suppressedFallbackSets: fallbackVisibilityRecords.length,
      suppressedNamedPresentationNodes: namedVisibilityRecords.length,
      suppressedPresentationColliders: removedPresentationColliders.length,
      suppressedBuiltInDoorNodes,
      registeredColliderCount: registeredColliders.length,
      replacedLegacyPartitionColliders: removedLegacyPartitionColliders.length,
      interiorPartitionColliderCount: registeredColliders.filter(
        (collider) => collider.kind === 'modern-clubhouse-partition',
      ).length,
      restroomFixtureColliderCount: registeredColliders.filter(
        (collider) => collider.kind === 'modern-restroom-fixture',
      ).length,
      synchronizedDoorPivots: building
        ? ['PIVOT_MainEntranceLeft', 'PIVOT_MainEntranceRight', 'PIVOT_RearServiceDoor']
          .filter((name) => building.getObjectByName(name)).length
        : 0,
      modernRoomDoorBinding,
      runtimeBatches: Object.freeze(Object.fromEntries(batches)),
      errors: Object.freeze(Object.fromEntries(errors)),
    });
  }

  function dispose() {
    if (disposed) return Object.freeze({ alreadyDisposed: true });
    disposed = true;
    const modernRoomDoors = doorApi?.unbindModernRoomDoorVisuals?.() || null;
    for (const collider of [...registeredColliders].reverse()) removeCollider(collider);
    registeredColliders.length = 0;
    for (const collider of removedLegacyPartitionColliders) addCollider(collider);
    removedLegacyPartitionColliders.length = 0;
    for (const record of visibilityRecords) record.node.visible = record.visible;
    visibilityRecords.length = 0;
    for (const record of fallbackVisibilityRecords) {
      if (typeof record.fallback.setVisible === 'function') record.fallback.setVisible(record.visible);
      else record.fallback.visible = record.visible;
    }
    fallbackVisibilityRecords.length = 0;
    for (const record of namedVisibilityRecords) record.node.visible = record.visible;
    namedVisibilityRecords.length = 0;
    for (const collider of removedPresentationColliders) addCollider(collider);
    removedPresentationColliders.length = 0;
    suppressionApplied = false;
    const resources = collectRenderableResources([...roots.values()]);
    staging.remove(...roots.values());
    group.remove(staging);
    roots.clear();
    batches.clear();
    return Object.freeze({
      alreadyDisposed: false,
      modernRoomDoors,
      resources: disposeRenderableResources(resources),
    });
  }

  return Object.freeze({
    ready,
    update: syncDoorPivots,
    roots: () => Object.freeze(Object.fromEntries(roots)),
    diagnostics,
    dispose,
  });
}

export default createModernPublicClubhouse;
