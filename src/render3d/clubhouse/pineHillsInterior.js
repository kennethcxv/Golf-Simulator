import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import {
  architecturalDoorScaleForOpening,
  architecturalDoorSpec,
  architecturalDoorTierForQuality,
} from '../../data/architecturalDoors.js';
import { SHOP_CATALOG } from '../../data/shopItems.js';
import {
  CLUBHOUSE_CEILING_PANELS,
  COUNTER_TOP,
  DOOR_STOCK,
  FRONT_DESK,
  FRONT_DESK_ASSETS,
  INTERIOR,
  LOUNGE,
  SHELL,
  STOCKROOM,
  frontDeskPoint,
} from '../../data/shopLayout.js';
import { priceFor } from '../../sim/shop.js';
import { calendarOf, formatDate } from '../../sim/time.js';
import { daySheet, fmtSlot } from '../../sim/reservations.js';
import {
  ARCHITECTURE_COMPONENT_LABELS,
  ARCHITECTURE_FINISH_LABELS,
  ARCHITECTURE_FINISH_OPTIONS,
  ARCHITECTURE_PAINT_COSTS,
  ARCHITECTURE_REPAIR_SKU,
  ceilingCircuitPowered,
  ceilingPanelPromptLabel,
  panelRepairKitAvailable,
  restorationAction,
  restorationSnapshot,
} from '../../sim/clubhouseRestoration.js';
import { availableSupplyUnits } from '../../sim/supplyUnits.js';
import { installedConstructionFinish } from '../../sim/constructionFinishes.js';
import {
  openingDrinksCoolerSnapshot,
  toggleOpeningDrinksCoolerDoor,
} from '../../sim/openingDrinksCooler.js';
import { CachedGLTFLoader } from '../gltfCache.js';
import { roundedBox } from './materials.js';

const METERS_TO_YARDS = 1 / 0.9144;
const CEILING_Y = SHELL.h;
const MODERN_PARTITION_WALL_M = 0.23;
const MODERN_PUBLIC_WIDTH_M = 16.80;
const MODERN_PUBLIC_DEPTH_M = 10.50;
const FRAMED_BOARD_MOUNT_OFFSET_YD = 0.075;
const YARDS_TO_METERS = 0.9144;
const CLUBHOUSE_FLOOR_Y = 0.3;

export const PINE_HILLS_SIGN_DATUM = Object.freeze({
  westInteriorX: -(MODERN_PUBLIC_WIDTH_M * METERS_TO_YARDS) / 2
    + (MODERN_PARTITION_WALL_M * METERS_TO_YARDS) / 2
    + FRAMED_BOARD_MOUNT_OFFSET_YD,
  courseInteriorZ: (MODERN_PUBLIC_DEPTH_M * METERS_TO_YARDS) / 2
    - (MODERN_PARTITION_WALL_M * METERS_TO_YARDS) / 2
    - FRAMED_BOARD_MOUNT_OFFSET_YD,
  courseExteriorZ: (MODERN_PUBLIC_DEPTH_M * METERS_TO_YARDS) / 2
    + (MODERN_PARTITION_WALL_M * METERS_TO_YARDS) / 2
    + FRAMED_BOARD_MOUNT_OFFSET_YD,
  servicePartitionPublicX: 5.35 * METERS_TO_YARDS
    - (MODERN_PARTITION_WALL_M * METERS_TO_YARDS) / 2
    - FRAMED_BOARD_MOUNT_OFFSET_YD,
  serviceDoorSignY: 2.12 * METERS_TO_YARDS + 0.24,
  officePublicZ: 2.0
    + (MODERN_PARTITION_WALL_M * METERS_TO_YARDS) / 2
    + FRAMED_BOARD_MOUNT_OFFSET_YD,
  officeDoorSignY: DOOR_STOCK.h + 0.24,
});

// The public partition has three authored room doors. The old tournament
// poster datum (-4.66) sat directly over the restroom leaf at -4.57 yards, so
// the picture disappeared into the door whenever that leaf moved. Keep this
// board in the clear wall bay between the storage and restroom openings.
export const PINE_HILLS_TOURNAMENT_POSTER_POSE = Object.freeze({
  x: PINE_HILLS_SIGN_DATUM.servicePartitionPublicX,
  y: 1.58,
  z: -2.40,
  ry: -Math.PI / 2,
  width: 0.84,
  height: 1.20,
});

export const PINE_HILLS_INTERIOR_ASSETS = Object.freeze({
  frontDeskReturn: 'vendor/models/clubhouse/pine_hills_front_desk_return_v1.glb',
  openingCooler: 'vendor/models/clubhouse/pine_hills_opening_drinks_cooler_v1.glb',
  golfTv: 'vendor/models/clubhouse/pine_hills_golf_tv_v1.glb',
  waterCooler: 'vendor/models/clubhouse/pine_hills_water_cooler_v1.glb',
  wasteBin: 'vendor/models/clubhouse/pine_hills_public_waste_bin_v1.glb',
  overflowBin: 'vendor/models/clubhouse/pine_hills_public_waste_bin_overflow_v1.glb',
  deskClutter: 'vendor/models/clubhouse/pine_hills_front_desk_clutter_v1.glb',
  loungeLitter: 'vendor/models/clubhouse/pine_hills_lounge_litter_v1.glb',
  fallenFrame: 'vendor/models/clubhouse/pine_hills_fallen_frame_v1.glb',
  floorPlant: 'vendor/models/clubhouse/pine_hills_floor_plant_v1.glb',
  counterPlant: 'vendor/models/clubhouse/pine_hills_counter_plant_v1.glb',
});

// Only immutable dressing belongs in the runtime batch. Restoration targets,
// the fixture-owned drinks cooler, and checkout-owned desk return must retain
// their authored hierarchies and independent visibility/state at all times.
export const PINE_HILLS_STATIC_DRESSING_KEYS = Object.freeze([
  'golfTv',
  'waterCooler',
  'wasteBin',
  'floorPlant',
  'counterPlant',
]);

const interactionAimPoint = new THREE.Vector3();

// Interaction X/Z already pass through the clubhouse's L2W authority. Aim Y
// must make the same local-to-world trip: Pine Hills sits at terrain height in
// the course scene, so a raw authored height otherwise points several yards
// above the physical board and loses first-person focus to nearby furniture.
export function pineHillsInteractionWorldY(interior, localAimY) {
  if (!Number.isFinite(localAimY)) return localAimY;
  interactionAimPoint.set(0, localAimY, 0);
  return interior.localToWorld(interactionAimPoint).y;
}

export const PINE_HILLS_CLEANUP_POSES = Object.freeze({
  'entry:leaves-trash': Object.freeze({ x: -2.72, z: 5.15, radius: 1.05 }),
  // Wall-mounted mess is worked from the neighbouring clear floor patch. The
  // visual poses below remain on the authored walls; these contact zones keep
  // the normal vacuum/spray sockets out of the club racks and lounge furniture.
  'corner:cobweb-nw': Object.freeze({ x: -8.50, z: -4.30, radius: 1.15 }),
  'corner:cobweb-ne': Object.freeze({ x: 2.05, z: -4.55, radius: 1.15 }),
  'wall:scuff-west': Object.freeze({ x: -8.65, z: -1.05, radius: 1.05 }),
  'wall:scuff-east': Object.freeze({ x: 4.15, z: 3.25, radius: 1.05 }),
  'lounge:pizza-box': Object.freeze({ x: LOUNGE.coffee.x - 0.08, z: LOUNGE.coffee.z, radius: 0.92 }),
  'lounge:empty-cups': Object.freeze({ x: LOUNGE.coffee.x + 0.28, z: LOUNGE.coffee.z, radius: 0.92 }),
  'lounge:chair-crooked': Object.freeze({ x: LOUNGE.chairB.x, z: LOUNGE.chairB.z, radius: 1.15 }),
  'wall:fallen-frame': Object.freeze({ x: 4.82, z: -5.16, radius: 1.05 }),
  // Keep the inherited counter mess on the staff return instead of laying it
  // across the scanner, open bag, and paid-goods strip. It remains a visible
  // dirty-checkout cleanup task without obstructing a live transaction.
  'desk:paper-stack': Object.freeze({ ...frontDeskPoint(-1.63, 0.72), radius: 1.05 }),
  // Outside the authored return leg (local x ends at -2.296). The trash bag's
  // normal first-person sweep lands about 1.1 m from the bin when the player is
  // stopped by the counter, so this pickup gets a slightly wider contact zone.
  'desk:overflow-bin': Object.freeze({ ...frontDeskPoint(-2.80, 1.30), radius: 1.35 }),
  'desk:sticky-notes': Object.freeze({ ...frontDeskPoint(-1.36, 0.80), radius: 1.05 }),
});

export const PINE_HILLS_CLEANUP_VISUAL_POSES = Object.freeze({
  'corner:cobweb-nw': Object.freeze({ x: -8.72, z: -5.44 }),
  'corner:cobweb-ne': Object.freeze({ x: 2.05, z: -5.44 }),
  'wall:scuff-west': Object.freeze({ x: -8.89, z: -1.05 }),
  'wall:scuff-east': Object.freeze({ x: 5.35, z: 3.25 }),
});

export function pineHillsRestorationObjectName(targetId) {
  return `RestorationTarget_${String(targetId).replace(/:/g, '_')}`;
}

const ASSET_COLLIDER = /^(?:COL_|COLLISION_|VOLUME_)/i;
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function geometryBatchSignature(geometry) {
  const attributes = Object.entries(geometry.attributes || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, attribute]) => [
      name,
      attribute.itemSize,
      attribute.normalized ? 1 : 0,
      attribute.array?.constructor?.name || '',
      attribute.gpuType || 0,
    ].join(':'))
    .join('|');
  const index = geometry.index;
  return [
    index ? `indexed:${index.array?.constructor?.name || ''}` : 'plain',
    attributes,
  ].join('|');
}

function stableSerializable(value) {
  if (Array.isArray(value)) return value.map(stableSerializable);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (key === 'metadata' || key === 'uuid') continue;
    result[key] = stableSerializable(value[key]);
  }
  return result;
}

function staticMaterialSignature(material) {
  if (!material?.isMeshStandardMaterial || material.visible === false) return null;
  // Embedded texture identity is not proof of equivalent pixels or colour
  // space. Keep all textured, cutout, and translucent authored surfaces on
  // their original draw/material path.
  if (Object.values(material).some((value) => value?.isTexture)
      || material.transparent
      || Number(material.opacity) < 1
      || Number(material.transmission) > 0
      || Number(material.alphaTest) > 0
      || material.alphaHash
      || material.alphaToCoverage
      || material.clippingPlanes?.length) return null;
  return JSON.stringify(stableSerializable(material.toJSON()));
}

function isFullGeometryDraw(geometry) {
  const position = geometry?.getAttribute?.('position');
  if (!position || position.isInterleavedBufferAttribute) return false;
  if (Object.values(geometry.attributes || {}).some((attribute) => attribute.isInterleavedBufferAttribute)) {
    return false;
  }
  if (Object.values(geometry.morphAttributes || {}).some((attributes) => attributes?.length)) return false;
  const available = geometry.index?.count ?? position.count;
  const start = Number(geometry.drawRange?.start) || 0;
  const count = geometry.drawRange?.count;
  return start === 0 && (!Number.isFinite(count) || count >= available);
}

function isDescendantOf(object, parent) {
  let cursor = object;
  while (cursor) {
    if (cursor === parent) return true;
    cursor = cursor.parent;
  }
  return false;
}

function geometryTriangles(geometry) {
  return Math.floor((geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0) / 3);
}

/**
 * Collapse only immutable, opaque Pine Hills dressing while retaining every
 * source Object3D, authored material, socket, and name for diagnostics and
 * future customization. Distinct-but-identical untextured PBR materials are
 * canonicalized only on the generated batch; cached GLB resources stay owned
 * by CachedGLTFLoader and are never disposed here.
 */
export function batchPineHillsStaticDressing(parent, roots = []) {
  if (!parent?.add || !parent?.updateWorldMatrix) {
    throw new TypeError('Pine Hills static dressing batching requires an Object3D parent.');
  }
  parent.updateWorldMatrix(true, true);
  const inverseParent = parent.matrixWorld.clone().invert();
  const candidates = new Set();

  for (const root of Array.isArray(roots) ? roots : [roots]) {
    if (!root?.traverseVisible) continue;
    root.traverseVisible((object) => {
      if (!object.isMesh || candidates.has(object) || !isDescendantOf(object, parent)
          || !object.geometry || !object.material || Array.isArray(object.material)
          || object.layers.mask === 0 || object.isSkinnedMesh || object.isInstancedMesh
          || object.isBatchedMesh || object.customDepthMaterial || object.customDistanceMaterial
          || object.userData?.runtimeCollisionProxyExcluded === true
          || !isFullGeometryDraw(object.geometry)) return;
      const determinant = object.matrixWorld.determinant();
      if (!object.matrixWorld.elements.every(Number.isFinite)
          || !Number.isFinite(determinant) || determinant <= 1e-12) return;
      if (!staticMaterialSignature(object.material)) return;
      candidates.add(object);
    });
  }

  const canonicalMaterials = new Map();
  const buckets = new Map();
  let materialCanonicalizations = 0;
  let sourceTriangles = 0;

  for (const source of candidates) {
    const materialSignature = staticMaterialSignature(source.material);
    let material = canonicalMaterials.get(materialSignature);
    if (!material) {
      material = source.material;
      canonicalMaterials.set(materialSignature, material);
    } else if (material !== source.material) {
      materialCanonicalizations += 1;
    }
    const key = [
      materialSignature,
      geometryBatchSignature(source.geometry),
      source.castShadow ? 1 : 0,
      source.receiveShadow ? 1 : 0,
      source.layers.mask,
      source.renderOrder || 0,
      source.frustumCulled ? 1 : 0,
    ].join('::');
    if (!buckets.has(key)) {
      buckets.set(key, {
        material,
        castShadow: source.castShadow,
        receiveShadow: source.receiveShadow,
        layers: source.layers.mask,
        renderOrder: source.renderOrder || 0,
        frustumCulled: source.frustumCulled,
        sources: [],
      });
    }
    buckets.get(key).sources.push(source);
    sourceTriangles += geometryTriangles(source.geometry);
  }

  const batchRoot = new THREE.Group();
  batchRoot.name = 'RUNTIME_PineHillsStaticDressingBatches';
  batchRoot.userData.runtimeOnly = true;
  const suppressedSources = [];
  const ownedGeometries = new Set();
  const externallyDisposedGeometries = new Set();
  let batchedSourceDrawCalls = 0;
  let batchedDrawCalls = 0;
  let batchedTriangles = 0;

  for (const bucket of buckets.values()) {
    if (bucket.sources.length < 2) continue;
    const geometries = bucket.sources.map((source) => {
      const geometry = source.geometry.clone();
      geometry.applyMatrix4(inverseParent.clone().multiply(source.matrixWorld));
      return geometry;
    });
    let merged = null;
    try {
      merged = mergeGeometries(geometries, false);
    } catch (_) {
      merged = null;
    }
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    merged.addEventListener('dispose', () => externallyDisposedGeometries.add(merged));
    ownedGeometries.add(merged);

    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.name = `BATCH_PineHillsStatic_${batchedDrawCalls + 1}`;
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    mesh.layers.mask = bucket.layers;
    mesh.renderOrder = bucket.renderOrder;
    mesh.frustumCulled = bucket.frustumCulled;
    mesh.userData.pineHillsStaticDressingBatch = true;
    batchRoot.add(mesh);
    for (const source of bucket.sources) {
      suppressedSources.push({ source, layers: source.layers.mask });
      source.layers.mask = 0;
    }
    batchedSourceDrawCalls += bucket.sources.length;
    batchedDrawCalls += 1;
    batchedTriangles += geometryTriangles(merged);
  }

  if (batchedDrawCalls > 0) parent.add(batchRoot);
  let disposed = false;
  return {
    root: batchRoot,
    sourceDrawCalls: candidates.size,
    batchedSourceDrawCalls,
    batchedDrawCalls,
    drawCallsSaved: batchedSourceDrawCalls - batchedDrawCalls,
    sourceTriangles,
    batchedTriangles,
    canonicalMaterials: canonicalMaterials.size,
    materialCanonicalizations,
    dispose() {
      if (disposed) return { geometries: 0, restoredSourceMeshes: 0 };
      disposed = true;
      batchRoot.removeFromParent();
      for (const { source, layers } of suppressedSources) source.layers.mask = layers;
      let geometries = 0;
      for (const geometry of ownedGeometries) {
        if (externallyDisposedGeometries.has(geometry)) continue;
        geometry.dispose();
        geometries += 1;
      }
      ownedGeometries.clear();
      return { geometries, restoredSourceMeshes: suppressedSources.length };
    },
  };
}

function configureAssetRoot(root, name) {
  root.name = name;
  root.traverse((object) => {
    if (!object.isMesh) return;
    if (ASSET_COLLIDER.test(object.name || '') || object.userData?.collision_proxy === true) {
      object.visible = false;
      object.userData.runtimeCollisionProxyExcluded = true;
      return;
    }
    object.castShadow = false;
    object.receiveShadow = true;
  });
  return root;
}

function placeSocketAt(root, target, socketName = 'SOCKET_PLACEMENT') {
  const socket = root.getObjectByName(socketName);
  if (!socket) {
    root.position.copy(target);
    return false;
  }
  root.updateMatrixWorld(true);
  socket.updateWorldMatrix(true, false);
  const at = new THREE.Vector3().setFromMatrixPosition(socket.matrixWorld);
  root.parent?.worldToLocal(at);
  root.position.add(target.clone().sub(at));
  root.updateMatrixWorld(true);
  return true;
}

function mountLocal(parent, root, pose, y = 0, scale = METERS_TO_YARDS) {
  parent.add(root);
  root.scale.setScalar(scale);
  root.rotation.set(0, pose.ry || 0, 0);
  root.position.set(0, 0, 0);
  placeSocketAt(root, new THREE.Vector3(pose.x, y, pose.z));
  return root;
}

function setPatternVisible(root, pattern, visible) {
  root?.traverse((object) => {
    if (pattern.test(object.name || '')) object.visible = visible;
  });
}

function makeCanvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const repaint = (data) => {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    paint(context, data, width, height);
    texture.needsUpdate = true;
  };
  return { canvas, texture, repaint };
}

function addWarmOakPublicFloor(group) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 768;
  const context = canvas.getContext('2d');
  context.fillStyle = '#a9784d';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const rows = 12;
  const rowHeight = canvas.height / rows;
  for (let row = 0; row < rows; row += 1) {
    const stagger = row % 2 ? 96 : 0;
    context.fillStyle = row % 3 === 0 ? '#b98a5d' : row % 3 === 1 ? '#ad7d52' : '#c09265';
    context.fillRect(0, row * rowHeight + 1, canvas.width, rowHeight - 3);
    context.strokeStyle = 'rgba(67, 39, 24, 0.34)';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(0, row * rowHeight + 1);
    context.lineTo(canvas.width, row * rowHeight + 1);
    context.stroke();
    for (let board = -1; board < 5; board += 1) {
      const x = stagger + board * 192;
      context.strokeStyle = 'rgba(66, 37, 23, 0.28)';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x, row * rowHeight + 2);
      context.lineTo(x, (row + 1) * rowHeight - 2);
      context.stroke();
    }
    for (let grain = 0; grain < 7; grain += 1) {
      const y = row * rowHeight + 8 + grain * 7.2;
      context.strokeStyle = `rgba(83, 48, 28, ${0.055 + (grain % 3) * 0.018})`;
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x <= canvas.width; x += 16) {
        const wave = Math.sin((x + row * 43 + grain * 71) * 0.025) * 2.1;
        if (x === 0) context.moveTo(x, y + wave);
        else context.lineTo(x, y + wave);
      }
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'PineHillsWarmOakLaminate';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5.6, 5.2);
  texture.anisotropy = 4;
  const publicMinX = -INTERIOR.w / 2 + 0.08;
  const publicMaxX = STOCKROOM.bounds.minX - 0.04;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(publicMaxX - publicMinX, INTERIOR.d - 0.16),
    new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xf3d2aa,
      roughness: 0.76,
      metalness: 0,
    }),
  );
  floor.name = 'PineHillsWarmOakPublicFloor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((publicMinX + publicMaxX) / 2, 0.012, 0);
  floor.receiveShadow = true;
  group.add(floor);
  return { floor, texture };
}

function fitText(context, text, maxWidth, startSize, weight = 700) {
  let size = startSize;
  do {
    context.font = `${weight} ${size}px system-ui, sans-serif`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 2;
  } while (size > 18);
  return size;
}

function brandLines(value) {
  const words = String(value || 'Pine Hills Municipal Golf').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length < 3) return [words.join(' ')];
  let split = 1;
  let best = Infinity;
  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(' ');
    const right = words.slice(index).join(' ');
    const imbalance = Math.abs(left.length - right.length);
    if (imbalance < best) {
      best = imbalance;
      split = index;
    }
  }
  return [words.slice(0, split).join(' '), words.slice(split).join(' ')];
}

function makeTournamentPosterTexture(clubName, {
  onError = () => {},
  isDisposed = () => false,
} = {}) {
  const width = 720;
  const height = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  const paint = (image = null) => {
    context.clearRect(0, 0, width, height);
    if (image) context.drawImage(image, 0, 0, width, height);
    else {
      context.fillStyle = '#efe1bd';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#244a36';
      context.fillRect(0, height * 0.62, width, height * 0.38);
    }
    context.fillStyle = 'rgba(31, 72, 53, 0.90)';
    context.fillRect(46, 48, width - 92, 310);
    context.strokeStyle = '#c7a75c';
    context.lineWidth = 10;
    context.strokeRect(61, 63, width - 122, 280);
    context.fillStyle = '#fff4dd';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const lines = brandLines(clubName);
    const size = Math.min(...lines.map((line) => fitText(context, line, width - 150, 58, 800)));
    context.font = `800 ${size}px system-ui, sans-serif`;
    const firstY = lines.length === 1 ? 139 : 112;
    lines.forEach((line, index) => context.fillText(line, width / 2, firstY + index * 58));
    context.fillStyle = '#d8bc78';
    context.font = '800 48px system-ui, sans-serif';
    context.fillText('MUNICIPAL OPEN', width / 2, 240);
    context.fillStyle = '#f4e8cc';
    context.font = '700 31px system-ui, sans-serif';
    context.fillText('OPENING CLASSIC  ·  1968', width / 2, 303);
  };

  paint();
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'PineHillsTournamentPosterComposite';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const source = new THREE.TextureLoader().load(
    'public/assets/textures/clubhouse/pine-hills-tournament-poster-background-v1.png',
    (loaded) => {
      if (!isDisposed()) {
        paint(loaded.image);
        texture.needsUpdate = true;
      }
      loaded.dispose();
    },
    undefined,
    (error) => onError(error),
  );
  source.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeFramedBoard(group, {
  name, x, y, z, ry = 0, w, h, canvasW = 1024, canvasH = 640, paint,
}) {
  const board = new THREE.Group();
  board.name = name;
  board.position.set(x, y, z);
  board.rotation.y = ry;
  const backing = new THREE.Mesh(
    roundedBox(w + 0.10, h + 0.10, 0.065, 0.025),
    new THREE.MeshStandardMaterial({ color: 0x5a3828, roughness: 0.58 }),
  );
  backing.name = `${name}_Backing`;
  backing.position.z = -0.035;
  backing.castShadow = true;
  board.add(backing);
  const canvas = makeCanvasTexture(canvasW, canvasH, paint);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map: canvas.texture,
      roughness: 0.78,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  face.position.z = 0.005;
  board.add(face);
  group.add(board);
  return { board, backing, face, ...canvas, signature: null };
}

// The inherited office/stock opening is intentionally wider and taller than
// the municipal door family.  Keep that useful gameplay clearance, but finish
// the unused reveal instead of exposing a dark void around the authored frame.
// The infill follows later door-quality upgrades, so a larger purchased door
// never intersects municipal-only trim.
export function createPineHillsOfficeDoorReveal(group, state) {
  const root = new THREE.Group();
  root.name = 'PineHillsOfficeDoorFinishedReveal';
  const material = new THREE.MeshStandardMaterial({
    color: 0xeee5d4,
    roughness: 0.86,
    metalness: 0,
  });
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const left = new THREE.Mesh(unit, material);
  const right = new THREE.Mesh(unit, material);
  const header = new THREE.Mesh(unit, material);
  left.name = 'PineHillsOfficeReveal_LeftInfill';
  right.name = 'PineHillsOfficeReveal_RightInfill';
  header.name = 'PineHillsOfficeReveal_HeaderInfill';
  root.add(left, right, header);
  group.add(root);

  function refresh() {
    const quality = installedConstructionFinish(state, 'doors')?.qualityId || 'municipal';
    const tier = architecturalDoorTierForQuality(quality);
    const spec = architecturalDoorSpec(tier) || architecturalDoorSpec('basic');
    const scale = architecturalDoorScaleForOpening(
      tier,
      DOOR_STOCK.w * YARDS_TO_METERS,
      DOOR_STOCK.h * YARDS_TO_METERS,
      { allowDownscale: true, maximumDownscale: 0.9 },
    ) || 1;
    const installedWidth = Math.min(DOOR_STOCK.w, spec.openingWidthM * scale * METERS_TO_YARDS);
    const installedHeight = Math.min(DOOR_STOCK.h, spec.openingHeightM * scale * METERS_TO_YARDS);
    const sideWidth = Math.max(0, (DOOR_STOCK.w - installedWidth) / 2);
    const headerHeight = Math.max(0, DOOR_STOCK.h - installedHeight);
    const depth = MODERN_PARTITION_WALL_M * METERS_TO_YARDS + 0.012;

    for (const [mesh, sign] of [[left, -1], [right, 1]]) {
      mesh.visible = sideWidth > 0.002;
      mesh.scale.set(Math.max(0.001, sideWidth), DOOR_STOCK.h, depth);
      mesh.position.set(
        DOOR_STOCK.x + sign * (installedWidth / 2 + sideWidth / 2),
        CLUBHOUSE_FLOOR_Y + DOOR_STOCK.h / 2,
        DOOR_STOCK.z,
      );
    }
    header.visible = headerHeight > 0.002;
    header.scale.set(Math.max(0.001, installedWidth), Math.max(0.001, headerHeight), depth);
    header.position.set(
      DOOR_STOCK.x,
      CLUBHOUSE_FLOOR_Y + installedHeight + headerHeight / 2,
      DOOR_STOCK.z,
    );
    root.userData = {
      doorTier: tier,
      installedWidth,
      installedHeight,
      sideWidth,
      headerHeight,
    };
    return root.userData;
  }

  refresh();
  return { root, refresh };
}

function drawHeader(context, width, title, subtitle = null) {
  context.fillStyle = '#f3ecd9';
  context.fillRect(0, 0, width, context.canvas.height);
  context.fillStyle = '#214835';
  context.fillRect(0, 0, width, 116);
  context.fillStyle = '#c7a75c';
  context.fillRect(0, 108, width, 8);
  context.fillStyle = '#fff7e8';
  const size = fitText(context, title, width - 72, 54, 800);
  context.font = `800 ${size}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(title, width / 2, subtitle ? 46 : 56);
  if (subtitle) {
    context.fillStyle = '#e7dcc3';
    context.font = '600 24px system-ui, sans-serif';
    context.fillText(subtitle, width / 2, 87);
  }
}

function addBackdrop(group) {
  const centre = frontDeskPoint(0, 1.96);
  const root = new THREE.Group();
  root.name = 'PineHillsFrontDeskBackdrop';
  root.position.set(centre.x, 0, centre.z);
  const panel = new THREE.Mesh(
    roundedBox(4.85, 2.48, 0.13, 0.035),
    new THREE.MeshStandardMaterial({ color: 0xeadfc8, roughness: 0.82 }),
  );
  panel.position.y = 1.34;
  panel.receiveShadow = true;
  root.add(panel);
  for (const x of [-2.34, 0, 2.34]) {
    const trim = new THREE.Mesh(
      roundedBox(x === 0 ? 0.035 : 0.075, 2.42, 0.16, 0.012),
      new THREE.MeshStandardMaterial({ color: x === 0 ? 0xb39654 : 0x79503a, roughness: 0.52, metalness: x === 0 ? 0.45 : 0 }),
    );
    trim.position.set(x, 1.34, 0.025);
    root.add(trim);
  }
  group.add(root);
  return root;
}

export function createPineHillsLeafLitter(material) {
  if (!material?.isMaterial) throw new TypeError('Pine Hills leaf litter requires a material.');
  const geometries = [];
  for (let index = 0; index < 18; index += 1) {
    const geometry = new THREE.CircleGeometry(0.07 + (index % 3) * 0.012, 5);
    const leaf = new THREE.Object3D();
    const angle = index * 2.399;
    const radius = 0.12 + (index % 7) * 0.075;
    leaf.position.set(Math.cos(angle) * radius, index * 0.0004, Math.sin(angle) * radius * 0.58);
    leaf.rotation.set(-Math.PI / 2, 0, angle * 0.7);
    leaf.updateMatrix();
    geometry.applyMatrix4(leaf.matrix);
    geometries.push(geometry);
  }
  const geometry = mergeGeometries(geometries, false);
  for (const source of geometries) source.dispose();
  if (!geometry) throw new Error('Pine Hills leaf litter geometry could not be merged.');
  const leaves = new THREE.Mesh(geometry, material);
  leaves.name = 'PineHillsEntryLeafLitter';
  leaves.userData.sourceLeafCount = 18;
  return leaves;
}

function addNeglectVisuals(group) {
  const roots = new Map();
  const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x826331, roughness: 0.96, side: THREE.DoubleSide });
  const entry = new THREE.Group();
  entry.name = pineHillsRestorationObjectName('entry:leaves-trash');
  entry.position.set(PINE_HILLS_CLEANUP_POSES['entry:leaves-trash'].x, 0.018, PINE_HILLS_CLEANUP_POSES['entry:leaves-trash'].z);
  entry.add(createPineHillsLeafLitter(leafMaterial));
  const wrapper = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.025, 0.13),
    new THREE.MeshStandardMaterial({ color: 0xd7c8a9, roughness: 0.86 }),
  );
  wrapper.position.set(0.31, 0.025, -0.18);
  wrapper.rotation.y = 0.38;
  entry.add(wrapper);
  group.add(entry);
  roots.set('entry:leaves-trash', entry);

  const cobweb = (targetId, rotationY = 0) => {
    const pose = PINE_HILLS_CLEANUP_VISUAL_POSES[targetId];
    const vertices = [];
    const radius = 0.56;
    for (let spoke = 0; spoke < 7; spoke += 1) {
      const angle = (spoke / 12) * Math.PI * 2;
      vertices.push(0, 0, 0, Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    }
    for (const ring of [0.22, 0.39, 0.55]) {
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const a = (spoke / 12) * Math.PI * 2;
        const b = ((spoke + 1) / 12) * Math.PI * 2;
        vertices.push(Math.cos(a) * ring, Math.sin(a) * ring, 0, Math.cos(b) * ring, Math.sin(b) * ring, 0);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const web = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xd8d2c5, transparent: true, opacity: 0.62 }),
    );
    web.name = pineHillsRestorationObjectName(targetId);
    web.position.set(pose.x, 2.78, pose.z);
    web.rotation.y = rotationY;
    group.add(web);
    roots.set(targetId, web);
  };
  cobweb('corner:cobweb-nw', 0);
  cobweb('corner:cobweb-ne', 0);

  const scuff = (targetId, rotationY) => {
    const pose = PINE_HILLS_CLEANUP_VISUAL_POSES[targetId];
    const material = new THREE.MeshStandardMaterial({
      color: 0x4b4740,
      transparent: true,
      opacity: 0.54,
      roughness: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.38), material);
    mark.name = pineHillsRestorationObjectName(targetId);
    mark.position.set(pose.x, 1.05, pose.z);
    mark.rotation.y = rotationY;
    group.add(mark);
    roots.set(targetId, mark);
  };
  scuff('wall:scuff-west', Math.PI / 2);
  scuff('wall:scuff-east', -Math.PI / 2);
  return roots;
}

// Interior-local structural work sites. The coordinates intentionally match
// the campaign's repair markers so both modes point the player at the same
// physical damage; only the interaction flow differs by mode.
const STRUCTURAL_WORK_SITES = Object.freeze([
  { id: 'ceiling', x: 7.15, z: 3.55, aimY: 2.35 },
  { id: 'floor', x: -2.1, z: -0.8, aimY: 0.25 },
  { id: 'panels', x: 5.15, z: 0.75, aimY: 1.25 },
  { id: 'trim', x: -2.0, z: 5.72, aimY: 1.0 },
  { id: 'windows', x: 3.0, z: -5.82, aimY: 1.35 },
  { id: 'porch', x: 1.6, z: 7.55, aimY: 0.45 },
  { id: 'shell', x: -10.8, z: 0.1, aimY: 1.3 },
]);

// Holding E repairs a structural component over this many seconds. The sim
// consumes the physical repair components only at the completion edge.
const STRUCTURAL_REPAIR_HOLD_SECONDS = 3.2;

export function createPineHillsInterior({
  interior,
  state,
  addProp,
  removeProp,
  addCol = null,
  L2W = (x, z) => ({ x, z }),
  getFixtureAnchor = () => null,
  getRuntimeAssetRoot = () => null,
  hooks = {},
  onRestoration = () => {},
  onStockSocketsReady = () => {},
  loader = new CachedGLTFLoader(),
} = {}) {
  if (!interior?.add) throw new TypeError('Pine Hills interior requires an Object3D mount.');
  const group = new THREE.Group();
  group.name = 'PineHillsInteriorLayer';
  interior.add(group);
  const assetRoots = new Map();
  const failures = [];

  // A collider fitted to what actually loaded. Same rule as the runtime asset
  // sheet (propPlacement.collisionIsOwnedElsewhere): the box follows the mesh,
  // so a re-export cannot leave a solid standing where nothing is.
  const solidHull = (root, inset = 0.06) => {
    if (typeof addCol !== 'function' || !root) return null;
    root.updateMatrixWorld(true);
    const hull = new THREE.Box3().setFromObject(root, true);
    if (hull.isEmpty() || !Number.isFinite(hull.min.x)) return null;
    const collider = {
      minX: hull.min.x + inset,
      maxX: hull.max.x - inset,
      minZ: hull.min.z + inset,
      maxZ: hull.max.z - inset,
    };
    if (collider.maxX <= collider.minX || collider.maxZ <= collider.minZ) return null;
    addCol(collider);
    return collider;
  };
  const interactionProps = [];
  const boardTextures = [];
  const staticDressingRoots = [];
  const warmOakFloor = addWarmOakPublicFloor(group);
  const neglectRoots = addNeglectVisuals(group);
  addBackdrop(group);
  const officeDoorReveal = createPineHillsOfficeDoorReveal(group, state);
  let disposed = false;
  let coolerRoot = null;
  let coolerFallbacks = [];
  let coolerDoorAngle = 0;
  let coolerDoorTarget = 0;
  let nextBoardRefresh = 0;
  let staticDressingBatch = null;

  const teeBoard = makeFramedBoard(group, {
    name: 'PineHillsTeeTimeBoard',
    x: FRONT_DESK.teeTimeBoard.x,
    y: 1.61,
    z: FRONT_DESK.teeTimeBoard.z + 0.20,
    ry: FRONT_DESK.teeTimeBoard.ry,
    w: 1.38,
    h: 0.96,
    paint(context, data, width) {
      drawHeader(context, width, 'TODAY\'S TEE TIMES', data.date);
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      let y = 148;
      for (const line of data.lines) {
        context.fillStyle = line.booked ? '#214835' : '#716b60';
        context.font = line.booked ? '700 28px system-ui, sans-serif' : '600 26px system-ui, sans-serif';
        context.fillText(line.time, 38, y);
        context.textAlign = 'right';
        context.fillText(line.detail, width - 38, y);
        context.textAlign = 'left';
        context.strokeStyle = '#d0c4ad';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(36, y + 25);
        context.lineTo(width - 36, y + 25);
        context.stroke();
        y += 47;
      }
    },
  });
  staticDressingRoots.push(teeBoard.backing);
  boardTextures.push(teeBoard.texture);

  const logoBoard = makeFramedBoard(group, {
    name: 'PineHillsLogoBackdrop',
    x: FRONT_DESK.logoBackdrop.x,
    y: 1.60,
    z: FRONT_DESK.logoBackdrop.z + 0.20,
    ry: FRONT_DESK.logoBackdrop.ry,
    w: 1.20,
    h: 0.90,
    paint(context, data, width, height) {
      context.fillStyle = '#214835';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = '#c7a75c';
      context.lineWidth = 14;
      context.strokeRect(24, 24, width - 48, height - 48);
      context.fillStyle = '#fff5df';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const lines = brandLines(data.clubName);
      const titleSize = Math.min(...lines.map((line) => fitText(context, line, width - 110, 68, 800)));
      context.font = `800 ${titleSize}px system-ui, sans-serif`;
      if (lines.length === 1) context.fillText(lines[0], width / 2, height * 0.40);
      else {
        context.fillText(lines[0], width / 2, height * 0.34);
        context.fillText(lines[1], width / 2, height * 0.46);
      }
      context.fillStyle = '#c7a75c';
      context.font = '700 32px system-ui, sans-serif';
      context.fillText('PUBLIC CLUBHOUSE', width / 2, height * 0.62);
      context.fillStyle = '#e8deca';
      context.font = '600 24px system-ui, sans-serif';
      context.fillText('WELCOME TO THE FIRST TEE', width / 2, height * 0.75);
    },
  });
  staticDressingRoots.push(logoBoard.backing);
  boardTextures.push(logoBoard.texture);

  const menuBoard = makeFramedBoard(group, {
    name: 'PineHillsRetailMenuBoard',
    x: PINE_HILLS_SIGN_DATUM.westInteriorX,
    y: 1.66,
    z: 2.05,
    ry: Math.PI / 2,
    w: 1.42,
    h: 1.48,
    paint(context, data, width) {
      drawHeader(context, width, 'PRO SHOP', 'PINE HILLS FAVOURITES');
      context.textBaseline = 'middle';
      let y = 158;
      for (const line of data.lines) {
        context.fillStyle = '#293f32';
        context.font = '650 30px system-ui, sans-serif';
        context.textAlign = 'left';
        context.fillText(line.name, 44, y);
        context.textAlign = 'right';
        context.fillText(line.price, width - 44, y);
        context.strokeStyle = '#d3c7af';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(42, y + 27);
        context.lineTo(width - 42, y + 27);
        context.stroke();
        y += 57;
      }
    },
  });
  staticDressingRoots.push(menuBoard.backing);
  boardTextures.push(menuBoard.texture);

  const tournamentPosterTexture = makeTournamentPosterTexture(
    String(state?.clubName || 'Pine Hills Municipal Golf'),
    {
      isDisposed: () => disposed,
      onError: (error) => failures.push({
        key: 'tournamentPoster',
        reason: error?.message || 'texture load failed',
      }),
    },
  );
  const tournamentPoster = new THREE.Group();
  tournamentPoster.name = 'PineHillsOriginalTournamentPoster';
  tournamentPoster.position.set(
    PINE_HILLS_TOURNAMENT_POSTER_POSE.x,
    PINE_HILLS_TOURNAMENT_POSTER_POSE.y,
    PINE_HILLS_TOURNAMENT_POSTER_POSE.z,
  );
  tournamentPoster.rotation.y = PINE_HILLS_TOURNAMENT_POSTER_POSE.ry;
  const tournamentPosterBacking = new THREE.Mesh(
    roundedBox(0.84, 1.20, 0.065, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x583a28, roughness: 0.62 }),
  );
  tournamentPosterBacking.name = 'PineHillsOriginalTournamentPoster_Backboard';
  tournamentPosterBacking.position.z = -0.035;
  tournamentPosterBacking.castShadow = true;
  tournamentPoster.add(tournamentPosterBacking);
  const tournamentPosterFace = new THREE.Mesh(
    new THREE.PlaneGeometry(0.76, 1.12),
    new THREE.MeshStandardMaterial({
      map: tournamentPosterTexture,
      roughness: 0.84,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  tournamentPosterFace.name = 'PineHillsOriginalTournamentPoster_Face';
  tournamentPosterFace.position.z = 0.005;
  tournamentPoster.add(tournamentPosterFace);
  group.add(tournamentPoster);
  staticDressingRoots.push(tournamentPosterBacking);
  boardTextures.push(tournamentPosterTexture);

  const courseBoard = makeFramedBoard(group, {
    name: 'PineHillsCourseExitSign',
    x: 1.47,
    y: 1.70,
    z: PINE_HILLS_SIGN_DATUM.courseInteriorZ,
    ry: Math.PI,
    w: 1.48,
    h: 0.56,
    canvasW: 900,
    canvasH: 320,
    paint(context, _data, width, height) {
      context.fillStyle = '#214835';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = '#c7a75c';
      context.lineWidth = 12;
      context.strokeRect(18, 18, width - 36, height - 36);
      context.fillStyle = '#fff4df';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = '800 54px system-ui, sans-serif';
      context.fillText('COURSE  /  FIRST TEE', width / 2, height * 0.43);
      context.fillStyle = '#d9cdaF';
      context.font = '650 28px system-ui, sans-serif';
      context.fillText('EXIT THROUGH MAIN ENTRANCE', width / 2, height * 0.68);
    },
  });
  staticDressingRoots.push(courseBoard.backing);
  boardTextures.push(courseBoard.texture);
  courseBoard.repaint({});

  // The porch brand board is intentionally high enough to read from the car
  // park. This smaller plaque carries the same route at player eye level, on
  // the existing wall beside the existing double doors.
  const exteriorCoursePlaque = makeFramedBoard(group, {
    name: 'PineHillsExteriorCourseEntrancePlaque',
    x: 1.34,
    y: 1.62,
    z: PINE_HILLS_SIGN_DATUM.courseExteriorZ,
    ry: 0,
    w: 1.48,
    h: 0.52,
    canvasW: 900,
    canvasH: 320,
    paint(context, _data, width, height) {
      context.fillStyle = '#214835';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = '#c7a75c';
      context.lineWidth = 12;
      context.strokeRect(18, 18, width - 36, height - 36);
      context.fillStyle = '#fff4df';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = '800 50px system-ui, sans-serif';
      context.fillText('COURSE  /  FIRST TEE', width / 2, height * 0.42);
      context.fillStyle = '#d9cdaf';
      context.font = '750 32px system-ui, sans-serif';
      context.fillText('MAIN ENTRANCE', width / 2, height * 0.70);
    },
  });
  exteriorCoursePlaque.repaint({});
  staticDressingRoots.push(exteriorCoursePlaque.backing);
  boardTextures.push(exteriorCoursePlaque.texture);

  // Preserve the authored porch/backboard geometry and replace only its baked
  // lettering. The plane sits a few millimetres in front of the original sign
  // face and follows the saved club name, including player-customized names.
  const exteriorCanvas = makeCanvasTexture(1600, 420, (context, data, width, height) => {
    context.clearRect(0, 0, width, height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#fff3dc';
    const titleSize = fitText(context, String(data.clubName || '').toUpperCase(), width - 120, 106, 800);
    context.font = `800 ${titleSize}px system-ui, sans-serif`;
    context.fillText(String(data.clubName || '').toUpperCase(), width / 2, height * 0.35);
    context.fillStyle = '#c7a75c';
    context.font = '700 44px system-ui, sans-serif';
    context.fillText('PUBLIC GOLF CLUB', width / 2, height * 0.62);
    context.fillStyle = '#fff3dc';
    context.font = '750 34px system-ui, sans-serif';
    context.fillText('COURSE / FIRST TEE  ·  MAIN ENTRANCE', width / 2, height * 0.84);
  });
  const exteriorFace = new THREE.Mesh(
    new THREE.PlaneGeometry(5.55 * METERS_TO_YARDS, 0.96 * METERS_TO_YARDS),
    new THREE.MeshStandardMaterial({
      map: exteriorCanvas.texture,
      transparent: true,
      depthWrite: false,
      roughness: 0.7,
      metalness: 0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  exteriorFace.name = 'PineHillsDynamicExteriorSignText';
  exteriorFace.position.set(
    -0.73152 * METERS_TO_YARDS,
    (4.08 - 0.27432) * METERS_TO_YARDS,
    (5.25 + 3.247) * METERS_TO_YARDS,
  );
  group.add(exteriorFace);
  const exteriorSign = { ...exteriorCanvas, face: exteriorFace, signature: null };
  boardTextures.push(exteriorSign.texture);

  // The modern shell ships with three baked service labels whose wording does
  // not match Pine Hills. modernPublicClubhouse suppresses those source meshes;
  // these deterministic signs rename the same existing doors without adding a
  // room or a new exterior opening. OFFICE labels the inherited stock/office
  // cross-door on its public face.
  const serviceSigns = [
    { label: 'EMPLOYEE', x: PINE_HILLS_SIGN_DATUM.servicePartitionPublicX, z: 3.70 * METERS_TO_YARDS, y: PINE_HILLS_SIGN_DATUM.serviceDoorSignY, ry: -Math.PI / 2 },
    { label: 'STORAGE', x: PINE_HILLS_SIGN_DATUM.servicePartitionPublicX, z: -0.20 * METERS_TO_YARDS, y: PINE_HILLS_SIGN_DATUM.serviceDoorSignY, ry: -Math.PI / 2 },
    { label: 'RESTROOM', x: PINE_HILLS_SIGN_DATUM.servicePartitionPublicX, z: -4.18 * METERS_TO_YARDS, y: PINE_HILLS_SIGN_DATUM.serviceDoorSignY, ry: -Math.PI / 2 },
    { label: 'OFFICE', x: 8.90, z: PINE_HILLS_SIGN_DATUM.officePublicZ, y: PINE_HILLS_SIGN_DATUM.officeDoorSignY, ry: 0 },
  ].map((sign) => makeFramedBoard(group, {
    name: `PineHillsDoorSign_${sign.label}`,
    ...sign,
    w: 0.82,
    h: 0.22,
    canvasW: 640,
    canvasH: 180,
    paint(context, data, width, height) {
      context.fillStyle = '#f1e7d3';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#234936';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = '800 58px system-ui, sans-serif';
      context.fillText(data.label, width / 2, height / 2);
    },
  }));
  for (let index = 0; index < serviceSigns.length; index += 1) {
    serviceSigns[index].repaint({ label: ['EMPLOYEE', 'STORAGE', 'RESTROOM', 'OFFICE'][index] });
    staticDressingRoots.push(serviceSigns[index].backing);
    boardTextures.push(serviceSigns[index].texture);
  }

  function refreshBoards(force = false) {
    const cal = calendarOf(state?.clock?.minutes || 0);
    const sheet = daySheet(state, cal.dayAbs);
    const current = cal.minuteOfDay;
    const upcoming = sheet.filter((slot) => slot.minute >= current - 15).slice(0, 9);
    const display = (upcoming.length ? upcoming : sheet.slice(-9)).map((slot) => {
      const reservations = slot.reservations || [];
      const names = reservations.map((reservation) => reservation.party?.holder || reservation.name || 'Reserved');
      const detail = names.length
        ? `${names.slice(0, 1).join('')}  ${slot.reservedSeats}/${slot.capacity}`
        : `OPEN  ${slot.availableSeats}/${slot.capacity}`;
      return { time: fmtSlot(slot.minute), detail, booked: names.length > 0 };
    });
    const teeSignature = JSON.stringify([cal.dayAbs, display]);
    if (force || teeBoard.signature !== teeSignature) {
      teeBoard.signature = teeSignature;
      teeBoard.repaint({ date: formatDate(cal), lines: display });
    }

    const clubName = String(state?.clubName || 'Pine Hills Municipal Golf');
    if (force || logoBoard.signature !== clubName) {
      logoBoard.signature = clubName;
      logoBoard.repaint({ clubName });
    }
    if (force || exteriorSign.signature !== clubName) {
      exteriorSign.signature = clubName;
      exteriorSign.repaint({ clubName });
    }

    const ids = ['balls1', 'tees1', 'cap1', 'visor1', 'water1', 'soda1', 'chips1'];
    const lines = ids.map((id) => SHOP_CATALOG.find((sku) => sku.id === id)).filter(Boolean).map((sku) => {
      const markup = Number.isFinite(state?.shop?.markup?.[sku.cat]) ? state.shop.markup[sku.cat] : 1;
      return { name: sku.name.toUpperCase(), price: `$${priceFor(sku, markup, null).toFixed(2)}` };
    });
    const menuSignature = JSON.stringify(lines);
    if (force || menuBoard.signature !== menuSignature) {
      menuBoard.signature = menuSignature;
      menuBoard.repaint({ lines });
    }
  }

  const addInteraction = ({
    x, z, r = 1.2, label, action, hold = null, aimY = 1.0, focusBias = 0,
  }) => {
    const world = L2W(x, z);
    const prop = {
      x: world.x,
      z: world.z,
      r,
      label,
      action,
      aimY: pineHillsInteractionWorldY(interior, aimY),
      focusBias,
    };
    if (hold) prop.hold = hold;
    addProp?.(prop);
    interactionProps.push(prop);
    return prop;
  };

  const completeTarget = (targetId) => {
    const result = restorationAction(state, { type: 'set-target-progress', targetId, progress: 1 });
    if (result.changed) {
      refresh();
      onRestoration(result);
    }
    return result;
  };

  for (const [targetId, verb] of [
    ['lounge:chair-crooked', 'straighten chair'],
    ['wall:fallen-frame', 'rehang frame'],
    ['desk:paper-stack', 'organize papers'],
    ['desk:sticky-notes', 'clear sticky notes'],
  ]) {
    const pose = PINE_HILLS_CLEANUP_POSES[targetId];
    addInteraction({
      ...pose,
      r: pose.radius,
      label: () => restorationSnapshot(state)?.targetProgress[targetId] < 1
        ? `${verb[0].toUpperCase()}${verb.slice(1)} — [E]`
        : null,
      action: () => completeTarget(targetId),
    });
  }

  for (const panel of CLUBHOUSE_CEILING_PANELS.filter(({ id }) => id === 'panel-02' || id === 'panel-07')) {
    const targetId = `ceiling:${panel.id}`;
    addInteraction({
      x: panel.x,
      z: panel.z,
      r: 1.45,
      aimY: CEILING_Y - 0.08,
      label: () => {
        const snapshot = restorationSnapshot(state);
        if (snapshot?.targetProgress[targetId] >= 1) return null;
        // v1 names the fitting by its station id, which stays true in the dark —
        // no fault word to withhold — so it passes the same name for both cases
        // and comes out byte-identical to the hand-rolled version it replaced.
        const name = panel.id.toUpperCase();
        return ceilingPanelPromptLabel({
          faultName: name,
          unpoweredName: name,
          powered: ceilingCircuitPowered(state),
          kitAvailable: panelRepairKitAvailable(state),
        });
      },
      action: () => {
        if (!ceilingCircuitPowered(state)) {
          hooks.toast?.('The ceiling circuit is dead. Repair the office power and ceiling first.', 'warn');
          return;
        }
        if (!panelRepairKitAvailable(state)) {
          hooks.toast?.('Bring the inherited clubhouse repair kit to service this panel.', 'warn');
          return;
        }
        const result = restorationAction(state, { type: 'repair-light', targetId });
        if (result.changed) {
          refresh();
          onRestoration(result);
        } else if (!result.ok && result.reason) {
          hooks.toast?.(result.reason, 'warn');
        }
      },
    });
  }

  // First-person structural repair and refinishing on the shared damage
  // sites. While the reopening campaign is active its own two-stage flow
  // keeps ownership of these components, so these props go dormant.
  for (const site of STRUCTURAL_WORK_SITES) {
    const siteLabel = ARCHITECTURE_COMPONENT_LABELS[site.id];
    const componentOf = () => (
      restorationSnapshot(state)?.architecture?.components?.[site.id] || null
    );
    const nextFinishOf = (component) => {
      const options = ARCHITECTURE_FINISH_OPTIONS[site.id];
      return options[(options.indexOf(component.finish) + 1) % options.length];
    };
    addInteraction({
      x: site.x,
      z: site.z,
      r: 1.6,
      aimY: site.aimY,
      focusBias: 0.35,
      label: () => {
        const component = componentOf();
        if (!component) return null;
        // While the reopening campaign is active its two-stage flow owns the
        // REPAIR prompt at this site; refinishing a repaired component is
        // available in every mode.
        if (state.campaign?.enabled && !component.restored) return null;
        if (!component.restored) {
          const units = availableSupplyUnits(state, ARCHITECTURE_REPAIR_SKU);
          const progress = restorationSnapshot(state)?.componentRepairProgress?.[site.id] || 0;
          const percent = progress > 0 ? ` (${Math.round(progress * 100)}%)` : '';
          return units > 0
            ? `${siteLabel} — hold [E] to repair${percent} · ${units} repair components ready`
            : `${siteLabel} — bring repair components to fix${percent}`;
        }
        const next = nextFinishOf(component);
        const nextLabel = ARCHITECTURE_FINISH_LABELS[next] || next;
        return `${siteLabel} — [E] refinish: ${nextLabel} ($${ARCHITECTURE_PAINT_COSTS[site.id]})`;
      },
      hold: (dt) => {
        if (state.campaign?.enabled) return;
        const component = componentOf();
        if (!component || component.restored) return;
        // Physical rule: the work only advances with repair components on
        // hand, so the completion edge can always consume one.
        if (availableSupplyUnits(state, ARCHITECTURE_REPAIR_SKU) <= 0) return;
        const current = restorationSnapshot(state)?.componentRepairProgress?.[site.id] || 0;
        const progress = Math.min(1, current + dt / STRUCTURAL_REPAIR_HOLD_SECONDS);
        const result = restorationAction(state, {
          type: 'repair-component', component: site.id, progress,
        });
        if (result.changed && result.restored) {
          refresh();
          onRestoration(result);
        } else if (result.changed && current === 0) {
          // First contact with the damage surfaces the repair lesson without
          // re-running the full restoration hooks on every held frame.
          onRestoration(result);
        } else if (!result.ok && result.reason) {
          hooks.toast?.(result.reason, 'warn');
        }
      },
      action: () => {
        const component = componentOf();
        if (!component || !component.restored) return;
        const result = restorationAction(state, {
          type: 'paint-component', component: site.id, finish: nextFinishOf(component),
        });
        if (result.changed) {
          onRestoration(result);
        } else if (!result.ok && result.reason) {
          hooks.toast?.(result.reason, 'warn');
        }
      },
    });
  }

  addInteraction({
    x: FRONT_DESK.teeTimeBoard.x,
    z: FRONT_DESK.teeTimeBoard.z + 0.20,
    r: 1.55,
    aimY: 1.64,
    // The reception chair sits between the staff approach and this board.
    // A deliberate board aim must win without making the nearby chair's
    // authored swivel impossible from its much tighter interaction radius.
    focusBias: 2.25,
    label: () => 'Today\'s tee-time board — [E] open reservations',
    action: () => hooks.openLaptop?.('reservations'),
  });

  function syncCoolerMount() {
    if (!coolerRoot) return false;
    const anchor = getFixtureAnchor('cold_drinks');
    if (!anchor) {
      coolerRoot.visible = false;
      group.attach(coolerRoot);
      return false;
    }
    if (coolerRoot.parent !== anchor) anchor.add(coolerRoot);
    coolerRoot.scale.setScalar(METERS_TO_YARDS);
    coolerRoot.rotation.set(0, 0, 0);
    coolerRoot.position.set(0, 0, 0);
    placeSocketAt(coolerRoot, new THREE.Vector3(0, 0, 0));
    coolerFallbacks = anchor.children.filter((child) => child !== coolerRoot);
    for (const child of coolerFallbacks) child.visible = false;
    coolerRoot.visible = true;
    onStockSocketsReady();
    return true;
  }

  const coolerFixture = { x: -9.9, z: 5.0 };
  // The fixture-owned prompt combines the physical door verb with stocking;
  // do not register a second collocated interaction in this dressing layer.
  coolerRoot && addInteraction({
    ...coolerFixture,
    r: 1.45,
    aimY: 1.05,
    label: () => {
      const snapshot = openingDrinksCoolerSnapshot(state);
      return snapshot?.door.state === 'open'
        ? 'Cold drinks cooler — [E] close door'
        : 'Cold drinks cooler — [E] open door';
    },
    action: () => {
      const result = toggleOpeningDrinksCoolerDoor(state);
      if (!result.ok) return;
      coolerDoorTarget = result.doorState === 'open' ? THREE.MathUtils.degToRad(-108) : 0;
      hooks.sfx?.(result.doorState === 'open' ? 'open' : 'close');
    },
  });

  const load = (key, path, onLoaded) => new Promise((resolve) => {
    loader.load(path, (gltf) => {
      if (disposed) {
        resolve(false);
        return;
      }
      try {
        const root = configureAssetRoot(gltf.scene, `PineHills_${key}`);
        assetRoots.set(key, [root]);
        onLoaded(root, gltf);
        resolve(true);
      } catch (error) {
        failures.push({ key, reason: error?.message || 'integration failed' });
        resolve(false);
      }
    }, undefined, (error) => {
      failures.push({ key, reason: error?.message || 'load failed' });
      resolve(false);
    });
  });

  const jobs = [
    // These two are owned by the operational checkout/fixture builders.  They
    // count toward the eleven-asset pack without a redundant GLB load here.
    Promise.resolve(true),
    Promise.resolve(true),
    load('golfTv', PINE_HILLS_INTERIOR_ASSETS.golfTv, (root) => {
      mountLocal(group, root, { x: 3.74, z: -6.82, ry: 0 }, 1.54);
    }),
    load('waterCooler', PINE_HILLS_INTERIOR_ASSETS.waterCooler, (root) => {
      mountLocal(group, root, { x: 4.58, z: 4.92, ry: Math.PI }, 0);
      // A 1.5 yd appliance the player walked straight through. Floor plants and
      // the umbrella stand stay walk-through on purpose — soft decor you brush
      // past — but a water cooler is furniture.
      solidHull(root);
    }),
    load('wasteBin', PINE_HILLS_INTERIOR_ASSETS.wasteBin, (root) => {
      mountLocal(group, root, { x: 3.72, z: 5.50, ry: Math.PI }, 0);
    }),
    load('overflowBin', PINE_HILLS_INTERIOR_ASSETS.overflowBin, (root) => {
      const pose = PINE_HILLS_CLEANUP_POSES['desk:overflow-bin'];
      mountLocal(group, root, { ...pose, ry: 0 }, 0);
    }),
    load('deskClutter', PINE_HILLS_INTERIOR_ASSETS.deskClutter, (root) => {
      const pose = PINE_HILLS_CLEANUP_POSES['desk:paper-stack'];
      mountLocal(group, root, { ...pose, ry: 0 }, COUNTER_TOP);
    }),
    load('loungeLitter', PINE_HILLS_INTERIOR_ASSETS.loungeLitter, (root) => {
      mountLocal(group, root, { x: LOUNGE.coffee.x, z: LOUNGE.coffee.z, ry: 0.08 }, 0.48);
    }),
    load('fallenFrame', PINE_HILLS_INTERIOR_ASSETS.fallenFrame, (root) => {
      const pose = PINE_HILLS_CLEANUP_POSES['wall:fallen-frame'];
      mountLocal(group, root, { ...pose, ry: -0.26 }, 0.022);
    }),
    load('floorPlant', PINE_HILLS_INTERIOR_ASSETS.floorPlant, (root) => {
      const poses = [
        { x: 2.55, z: -6.30, ry: 0.20, scale: 0.74 },
        { x: 5.06, z: -6.34, ry: -0.35, scale: 0.74 },
        { x: -3.24, z: 5.82, ry: 0.15, scale: 0.88 },
      ];
      const roots = poses.map((pose, index) => {
        const instance = index === 0 ? root : configureAssetRoot(root.clone(true), `PineHills_floorPlant_${index + 1}`);
        mountLocal(group, instance, pose, 0, METERS_TO_YARDS * pose.scale);
        return instance;
      });
      assetRoots.set('floorPlant', roots);
    }),
    load('counterPlant', PINE_HILLS_INTERIOR_ASSETS.counterPlant, (root) => {
      const pose = frontDeskPoint(-2.17, 0.60);
      mountLocal(group, root, { ...pose, ry: 0 }, COUNTER_TOP, METERS_TO_YARDS * 0.68);
    }),
  ];

  const ready = Promise.all(jobs).then((results) => {
    if (disposed) {
      return Object.freeze({ loaded: results.filter(Boolean).length, failed: failures.length });
    }
    staticDressingBatch = batchPineHillsStaticDressing(group, [
      ...PINE_HILLS_STATIC_DRESSING_KEYS.flatMap((key) => assetRoots.get(key) || []),
      ...staticDressingRoots,
    ]);
    refreshBoards(true);
    refresh();
    return Object.freeze({ loaded: results.filter(Boolean).length, failed: failures.length });
  });

  function refresh() {
    const snapshot = restorationSnapshot(state);
    if (!snapshot) return null;
    for (const [targetId, root] of neglectRoots) {
      const progress = clamp01(snapshot.targetProgress[targetId]);
      root.visible = progress < 1;
      if (targetId === 'entry:leaves-trash') root.scale.setScalar(1 - progress * 0.38);
      if (root.material?.opacity != null) root.material.opacity = Math.max(0, 0.62 * (1 - progress));
    }
    const desk = assetRoots.get('deskClutter')?.[0];
    setPatternVisible(desk, /DeskPhone(?:Base|Handset)/i, false);
    setPatternVisible(desk, /PaperStack_/i, snapshot.targetProgress['desk:paper-stack'] < 1);
    setPatternVisible(desk, /DeskPhoneNote/i, snapshot.targetProgress['desk:sticky-notes'] < 1);
    const overflow = assetRoots.get('overflowBin')?.[0];
    if (overflow) overflow.visible = snapshot.targetProgress['desk:overflow-bin'] < 1;
    const litter = assetRoots.get('loungeLitter')?.[0];
    setPatternVisible(litter, /PizzaBox|LoungeNapkin/i, snapshot.targetProgress['lounge:pizza-box'] < 1);
    setPatternVisible(litter, /EmptyCup/i, snapshot.targetProgress['lounge:empty-cups'] < 1);
    const frame = assetRoots.get('fallenFrame')?.[0];
    if (frame) {
      const repaired = snapshot.targetProgress['wall:fallen-frame'] >= 1;
      frame.position.set(repaired ? 4.58 : PINE_HILLS_CLEANUP_POSES['wall:fallen-frame'].x,
        repaired ? 1.62 : 0.022,
        repaired ? -6.80 : PINE_HILLS_CLEANUP_POSES['wall:fallen-frame'].z);
      frame.rotation.set(repaired ? -Math.PI / 2 : 0, repaired ? 0 : -0.26, 0);
    }
    const chair = getRuntimeAssetRoot(68);
    if (chair) chair.rotation.y = snapshot.targetProgress['lounge:chair-crooked'] >= 1 ? -2.38 : -2.10;
    officeDoorReveal.refresh();
    refreshBoards();
    return snapshot;
  }

  function progressTarget(targetId, progress) {
    const result = restorationAction(state, { type: 'set-target-progress', targetId, progress: clamp01(progress) });
    if (result.changed) {
      refresh();
      onRestoration(result);
    }
    return result;
  }

  function applyCleaningTool(toolId, localX, localZ, dt, options = {}) {
    const snapshot = restorationSnapshot(state);
    if (!snapshot) return { handled: false, did: 0 };
    const candidates = [
      'entry:leaves-trash',
      'corner:cobweb-nw', 'corner:cobweb-ne',
      'wall:scuff-west', 'wall:scuff-east',
      'lounge:pizza-box', 'lounge:empty-cups', 'desk:overflow-bin',
    ];
    for (const targetId of candidates) {
      const pose = PINE_HILLS_CLEANUP_POSES[targetId];
      const current = clamp01(snapshot.targetProgress[targetId]);
      if (current >= 1 || Math.hypot(localX - pose.x, localZ - pose.z) > pose.radius) continue;
      let next = current;
      let reason = null;
      if (targetId === 'entry:leaves-trash') {
        if (toolId === 'broom' && current < 0.66) next = Math.min(0.66, current + Math.max(0.02, dt * 0.55));
        else if (toolId === 'trashbag' && options.bagTied) reason = 'bag-tied';
        else if (toolId === 'trashbag' && !(Number(options.bagSpace) > 0)) reason = 'bag-full';
        else if (toolId === 'trashbag' && current >= 0.55) next = 1;
        else if (toolId === 'trashbag') reason = 'sweep-first';
        else continue;
      } else if (targetId.startsWith('corner:cobweb')) {
        if (toolId !== 'vacuum') continue;
        next = Math.min(1, current + Math.max(0.025, dt * 0.72));
      } else if (targetId.startsWith('wall:scuff')) {
        if (toolId === 'spray') next = Math.max(current, 0.28);
        else if ((toolId === 'cloth' || toolId === 'sponge') && current >= 0.25) {
          next = Math.min(1, current + Math.max(0.025, dt * 0.68));
        } else if (toolId === 'cloth' || toolId === 'sponge') reason = 'spray-first';
        else continue;
      } else {
        if (toolId !== 'trashbag') continue;
        if (options.bagTied) return { handled: true, did: 0, reason: 'bag-tied', targetId };
        if (!(Number(options.bagSpace) > 0)) return { handled: true, did: 0, reason: 'bag-full', targetId };
        next = Math.min(1, current + Math.max(0.05, dt * 1.1));
      }
      if (next <= current) return { handled: true, did: 0, reason, targetId };
      const result = progressTarget(targetId, next);
      return { handled: true, did: next - current, targetId, restoration: result };
    }
    return { handled: false, did: 0 };
  }

  const externalAssetRoot = (key) => {
    if (key === 'frontDeskReturn') return interior.getObjectByName('PineHillsFrontDeskReturn');
    if (key === 'openingCooler') {
      return getFixtureAnchor('cold_drinks')?.getObjectByName('PineHillsOpeningDrinksCooler');
    }
    return null;
  };

  return {
    group,
    ready,
    refresh,
    applyCleaningTool,
    detachFixturePlacements() {},
    syncFixturePlacements: () => !!externalAssetRoot('openingCooler'),
    update(dt) {
      nextBoardRefresh -= Math.max(0, dt || 0);
      if (nextBoardRefresh <= 0) {
        nextBoardRefresh = 1;
        refreshBoards();
      }
    },
    getRoot: (key) => assetRoots.get(key)?.[0] || externalAssetRoot(key) || null,
    roots: () => [...assetRoots.values()].flat(),
    diagnostics: () => ({
      expected: Object.keys(PINE_HILLS_INTERIOR_ASSETS).length,
      loaded: assetRoots.size
        + (externalAssetRoot('frontDeskReturn') ? 1 : 0)
        + (externalAssetRoot('openingCooler') ? 1 : 0),
      failed: failures.length,
      failures: [...failures],
      coolerMounted: !!externalAssetRoot('openingCooler'),
      cleanupTargets: Object.keys(PINE_HILLS_CLEANUP_POSES).length,
      interactions: interactionProps.length,
      staticDressingBatch: staticDressingBatch ? {
        keys: [...PINE_HILLS_STATIC_DRESSING_KEYS],
        sourceDrawCalls: staticDressingBatch.sourceDrawCalls,
        batchedSourceDrawCalls: staticDressingBatch.batchedSourceDrawCalls,
        batchedDrawCalls: staticDressingBatch.batchedDrawCalls,
        drawCallsSaved: staticDressingBatch.drawCallsSaved,
        sourceTriangles: staticDressingBatch.sourceTriangles,
        batchedTriangles: staticDressingBatch.batchedTriangles,
        canonicalMaterials: staticDressingBatch.canonicalMaterials,
        materialCanonicalizations: staticDressingBatch.materialCanonicalizations,
      } : null,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const prop of interactionProps) removeProp?.(prop);
      const staticDressing = staticDressingBatch?.dispose() || null;
      for (const texture of boardTextures) texture.dispose();
      warmOakFloor.texture.dispose();
      warmOakFloor.floor.geometry.dispose();
      warmOakFloor.floor.material.dispose();
      group.removeFromParent();
      assetRoots.clear();
      return { staticDressing };
    },
  };
}
