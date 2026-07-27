import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ARCHITECTURAL_DOOR_LOD_DISTANCES_M,
  METERS_TO_YARDS,
  architecturalDoorPath,
  architecturalDoorSpec,
} from '../../data/architecturalDoors.js';

const COLLISION_NODE = /^(?:COLLISION_|COL_|UCX_|UBX_|USP_|UCP_)/i;
const LOD_NODE = /^LOD([012])_/i;
const HANDLE_PIVOT = /^PIVOT_Handle(?:_(Left|Right))?_(Exterior|Interior)$/;
const LATCH_PIVOT = /^PIVOT_LatchBolt(?:_(Left|Right))?$/;
const FLUSH_BOLT_PIVOT = /^PIVOT_FlushBolt_Right_(Top|Bottom)$/;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (value) => value * value * (3 - 2 * value);

function geometryBatchKey(geometry) {
  const attributes = Object.entries(geometry.attributes || {})
    .map(([name, attribute]) => (
      `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:${attribute.array?.constructor?.name || ''}`
    ))
    .sort()
    .join(',');
  return `${geometry.index ? 'indexed' : 'plain'}|${attributes}`;
}

function ownLodLevel(node) {
  const explicit = Number(node?.userData?.lod_level);
  if (Number.isInteger(explicit) && explicit >= 0 && explicit <= 2) return explicit;
  const match = String(node?.name || '').match(LOD_NODE);
  return match ? Number(match[1]) : null;
}

function nearestLodRoot(node) {
  let cursor = node;
  while (cursor) {
    if (ownLodLevel(cursor) !== null) return cursor;
    cursor = cursor.parent;
  }
  return null;
}

function underCollisionNode(node) {
  let cursor = node;
  while (cursor) {
    if (COLLISION_NODE.test(String(cursor.name || '')) || cursor.userData?.collision_proxy) return true;
    cursor = cursor.parent;
  }
  return false;
}

// The Blender sources deliberately retain every named piece for inspection.
// At runtime, pieces sharing a material and articulation owner can become one
// mesh without losing a single pivot or changing the authored appearance.
export function batchArchitecturalDoorMeshes(root) {
  const lodRoots = [];
  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    if (ownLodLevel(node) !== null) lodRoots.push(node);
  });

  const summary = {
    sourceMeshes: 0,
    batchedMeshes: 0,
    reducedBy: 0,
    levels: [0, 1, 2].map((level) => ({ level, roots: 0, sourceMeshes: 0, batchedMeshes: 0, reducedBy: 0 })),
  };

  for (const lodRoot of lodRoots) {
    const level = ownLodLevel(lodRoot);
    const levelSummary = summary.levels[level];
    levelSummary.roots += 1;
    lodRoot.updateWorldMatrix(true, true);
    const toRoot = lodRoot.matrixWorld.clone().invert();
    const buckets = new Map();

    lodRoot.traverse((object) => {
      if (!object.isMesh || nearestLodRoot(object) !== lodRoot || underCollisionNode(object)
          || object.isSkinnedMesh || object.isInstancedMesh || !object.geometry
          || Array.isArray(object.material) || !object.material
          || Object.keys(object.geometry.morphAttributes || {}).length) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(toRoot.clone().multiply(object.matrixWorld));
      const key = `${object.material.uuid}|${geometryBatchKey(geometry)}`;
      if (!buckets.has(key)) buckets.set(key, {
        material: object.material,
        geometries: [],
        sources: [],
        castShadow: false,
        receiveShadow: false,
        renderOrder: object.renderOrder || 0,
      });
      const bucket = buckets.get(key);
      bucket.geometries.push(geometry);
      bucket.sources.push(object);
      bucket.castShadow ||= object.castShadow;
      bucket.receiveShadow ||= object.receiveShadow;
      bucket.renderOrder = Math.max(bucket.renderOrder, object.renderOrder || 0);
    });

    for (const bucket of buckets.values()) {
      if (bucket.sources.length < 2) {
        bucket.geometries[0]?.dispose();
        continue;
      }
      let merged = null;
      try {
        merged = mergeGeometries(bucket.geometries, false);
      } catch {
        merged = null;
      }
      for (const geometry of bucket.geometries) geometry.dispose();
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.name = `BATCH_Door_LOD${level}_${levelSummary.batchedMeshes + 1}`;
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = bucket.receiveShadow;
      mesh.renderOrder = bucket.renderOrder;
      lodRoot.add(mesh);
      for (const source of bucket.sources) source.removeFromParent();
      levelSummary.sourceMeshes += bucket.sources.length;
      levelSummary.batchedMeshes += 1;
      levelSummary.reducedBy += bucket.sources.length - 1;
    }
  }

  for (const level of summary.levels) {
    summary.sourceMeshes += level.sourceMeshes;
    summary.batchedMeshes += level.batchedMeshes;
    summary.reducedBy += level.reducedBy;
  }

  // Distant doors retain their full authored silhouette and receive lighting,
  // but do not need to redraw every mesh into the clubhouse shadow maps. Keep
  // hero LOD0 shadows for first-person inspection and interaction.
  for (const lodRoot of lodRoots) {
    if (ownLodLevel(lodRoot) === 0) continue;
    lodRoot.traverse((object) => {
      if (object.isMesh && nearestLodRoot(object) === lodRoot) object.castShadow = false;
    });
  }

  return Object.freeze({
    ...summary,
    levels: Object.freeze(summary.levels.map((entry) => Object.freeze({ ...entry }))),
  });
}

function configureTemplate(scene) {
  scene.traverse((node) => {
    if (underCollisionNode(node)) node.visible = false;
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const translucent = materials.some((material) => material?.transparent || material?.transmission > 0);
    node.castShadow = !translucent;
    node.receiveShadow = true;
  });
  const batch = batchArchitecturalDoorMeshes(scene);
  scene.userData.architecturalDoorBatch = batch;
  return batch;
}

function setDoorLodLevel(rig, requestedLevel) {
  const level = Math.max(0, Math.min(2, Math.round(Number(requestedLevel) || 0)));
  if (rig.lodLevel === level) return false;
  for (let index = 0; index < rig.lodRoots.length; index += 1) {
    for (const root of rig.lodRoots[index]) root.visible = index === level;
  }
  rig.lodLevel = level;
  return true;
}

function lodLevelForDistance(distanceM, distancesM = ARCHITECTURAL_DOOR_LOD_DISTANCES_M) {
  const distance = Math.max(0, Number(distanceM) || 0);
  if (distance >= distancesM[2]) return 2;
  if (distance >= distancesM[1]) return 1;
  return 0;
}

function collectRig(modelRoot, tier, batch) {
  const spec = architecturalDoorSpec(tier);
  const byName = {};
  const lodRoots = [[], [], []];
  const handles = [];
  const latches = [];
  const flushBolts = [];
  modelRoot.traverse((node) => {
    if (node.name) byName[node.name] = node;
    const level = ownLodLevel(node);
    if (level !== null) lodRoots[level].push(node);
    let match = String(node.name || '').match(HANDLE_PIVOT);
    if (match) {
      handles.push({
        node,
        side: (match[1] || 'Single').toLowerCase(),
        face: match[2].toLowerCase(),
        restQuaternion: node.quaternion.clone(),
      });
    }
    match = String(node.name || '').match(LATCH_PIVOT);
    if (match) {
      const axis = String(node.userData?.translation_axis || '+X');
      latches.push({
        node,
        side: (match[1] || 'Single').toLowerCase(),
        restPosition: node.position.clone(),
        retractX: axis.startsWith('-') ? 0.018 : -0.018,
      });
    }
    match = String(node.name || '').match(FLUSH_BOLT_PIVOT);
    if (match) {
      flushBolts.push({
        node,
        position: match[1].toLowerCase(),
        restPosition: node.position.clone(),
        retractY: match[1] === 'Top' ? -0.018 : 0.018,
      });
    }
  });

  const leafPivots = spec.leafCount === 2
    ? { left: byName.PIVOT_Door_Left || null, right: byName.PIVOT_Door_Right || null }
    : { single: byName.PIVOT_Door || null };
  const rig = {
    tier,
    spec,
    modelRoot,
    byName,
    leafPivots,
    handles,
    latches,
    flushBolts,
    lodRoots,
    lodLevel: -1,
    handleTime: 0,
    handleSide: 'single',
    flushBlend: 0,
    flushTarget: 0,
    batch,
  };
  setDoorLodLevel(rig, 0);
  return rig;
}

function handleApplies(entry, side) {
  return side === 'both' || entry.side === side || (side === 'single' && entry.side === 'single');
}

function applyHardwarePose(rig) {
  const duration = 0.34;
  const normalized = clamp01(rig.handleTime / duration);
  const pulse = normalized <= 0.5 ? normalized * 2 : (1 - normalized) * 2;
  const pressed = smoothstep(clamp01(pulse));
  const rotation = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 0, 1);
  for (const handle of rig.handles) {
    const amount = handleApplies(handle, rig.handleSide) ? pressed : 0;
    const sign = handle.face === 'exterior' ? 1 : -1;
    rotation.setFromAxisAngle(axis, THREE.MathUtils.degToRad(28 * sign * amount));
    handle.node.quaternion.copy(handle.restQuaternion).multiply(rotation);
    handle.node.matrixWorldNeedsUpdate = true;
  }
  for (const latch of rig.latches) {
    const amount = handleApplies(latch, rig.handleSide) ? pressed : 0;
    latch.node.position.copy(latch.restPosition);
    latch.node.position.x += latch.retractX * amount;
    latch.node.matrixWorldNeedsUpdate = true;
  }
  for (const bolt of rig.flushBolts) {
    bolt.node.position.copy(bolt.restPosition);
    bolt.node.position.y += bolt.retractY * rig.flushBlend;
    bolt.node.matrixWorldNeedsUpdate = true;
  }
}

function createRigController(rig) {
  return Object.freeze({
    rig,
    triggerHandle(side = rig.spec.leafCount === 2 ? 'left' : 'single') {
      rig.handleSide = String(side || 'single').toLowerCase();
      rig.handleTime = 0.0001;
      applyHardwarePose(rig);
    },
    setInactiveLeafOpen(open) {
      rig.flushTarget = open ? 1 : 0;
    },
    setLod(level) {
      return setDoorLodLevel(rig, level);
    },
    update(dt, distanceM = 0) {
      const seconds = Math.max(0, Number(dt) || 0);
      if (rig.handleTime > 0) {
        rig.handleTime = Math.min(0.34, rig.handleTime + seconds);
        if (rig.handleTime >= 0.34) rig.handleTime = 0;
      }
      rig.flushBlend += (rig.flushTarget - rig.flushBlend) * Math.min(1, seconds * 8);
      applyHardwarePose(rig);
      setDoorLodLevel(rig, lodLevelForDistance(distanceM));
    },
    diagnostics() {
      return Object.freeze({
        tier: rig.tier,
        leafPivotCount: Object.values(rig.leafPivots).filter(Boolean).length,
        handlePivotCount: rig.handles.length,
        latchPivotCount: rig.latches.length,
        flushBoltPivotCount: rig.flushBolts.length,
        lodRoots: rig.lodRoots.map((roots) => roots.length),
        lodLevel: rig.lodLevel,
        batch: rig.batch,
      });
    },
  });
}

function collectResources(root, resources) {
  root?.traverse?.((node) => {
    if (node.geometry) resources.geometries.add(node.geometry);
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      resources.materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) resources.textures.add(value);
      }
    }
  });
  return resources;
}

export function createArchitecturalDoorVisualRuntime({ loader = new GLTFLoader() } = {}) {
  const templates = new Map();
  const holders = new Set();
  let disposed = false;

  function templateFor(tier) {
    if (!architecturalDoorSpec(tier)) return Promise.reject(new Error(`Unknown architectural door tier: ${tier}`));
    if (!templates.has(tier)) {
      const path = architecturalDoorPath(tier);
      templates.set(tier, new Promise((resolve, reject) => {
        loader.load(path, (gltf) => {
          const batch = configureTemplate(gltf.scene);
          const template = { scene: gltf.scene, animations: gltf.animations || [], batch, path };
          if (disposed) {
            const resources = collectResources(template.scene, {
              geometries: new Set(), materials: new Set(), textures: new Set(),
            });
            for (const geometry of resources.geometries) geometry.dispose();
            for (const texture of resources.textures) texture.dispose();
            for (const material of resources.materials) material.dispose();
          }
          resolve(template);
        }, undefined, reject);
      }));
    }
    return templates.get(tier);
  }

  function instantiate(tier, {
    parent = null,
    name = `ArchitecturalDoor_${tier}`,
    scale = METERS_TO_YARDS,
    position = null,
    rotationY = 0,
    visible = true,
  } = {}) {
    const holder = new THREE.Group();
    holder.name = name;
    holder.visible = visible;
    holder.position.copy(position || new THREE.Vector3());
    holder.rotation.y = rotationY;
    holder.scale.setScalar(scale);
    holder.userData.architecturalDoorTier = tier;
    holder.userData.loaded = false;
    holder.userData.disposed = false;
    if (parent) parent.add(holder);
    holders.add(holder);
    holder.userData.ready = templateFor(tier).then((template) => {
      if (disposed || holder.userData.disposed) return holder;
      const model = template.scene.clone(true);
      model.name = `${name}_Model`;
      holder.add(model);
      const rig = collectRig(model, tier, template.batch);
      const controller = createRigController(rig);
      holder.userData.modelRoot = model;
      holder.userData.rig = rig;
      holder.userData.controller = controller;
      holder.userData.animations = template.animations.map((clip) => clip.name);
      holder.userData.loaded = true;
      return holder;
    }).catch((error) => {
      holder.userData.loadError = String(error?.message || error);
      return holder;
    });
    return holder;
  }

  function ownedResources() {
    const resources = { geometries: new Set(), materials: new Set(), textures: new Set() };
    for (const holder of holders) collectResources(holder, resources);
    return resources;
  }

  function diagnostics() {
    const instances = [...holders].map((holder) => Object.freeze({
      name: holder.name,
      tier: holder.userData.architecturalDoorTier,
      loaded: holder.userData.loaded,
      loadError: holder.userData.loadError || null,
      visible: holder.visible,
      rig: holder.userData.controller?.diagnostics?.() || null,
    }));
    return Object.freeze({
      disposed,
      templateCount: templates.size,
      instanceCount: holders.size,
      loadedCount: instances.filter((entry) => entry.loaded).length,
      failedCount: instances.filter((entry) => entry.loadError).length,
      instances: Object.freeze(instances),
    });
  }

  function dispose() {
    if (disposed) return Object.freeze({ alreadyDisposed: true });
    disposed = true;
    for (const holder of holders) {
      holder.userData.disposed = true;
      holder.removeFromParent();
    }
    const resources = ownedResources();
    for (const geometry of resources.geometries) geometry.dispose();
    for (const texture of resources.textures) texture.dispose();
    for (const material of resources.materials) material.dispose();
    const result = Object.freeze({
      alreadyDisposed: false,
      instances: holders.size,
      geometries: resources.geometries.size,
      materials: resources.materials.size,
      textures: resources.textures.size,
    });
    holders.clear();
    templates.clear();
    return result;
  }

  return Object.freeze({ instantiate, ownedResources, diagnostics, dispose });
}

export { lodLevelForDistance };
