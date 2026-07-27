import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCeilingLightController } from './ceilingLightVisuals.js';

const loader = new GLTFLoader();
const templates = new Map();
const sharedFurnitureMaterials = new WeakMap();
const SHARED_FURNITURE_RESOURCE = 'golfFlipperSharedPropertyFurnitureResource';
const FUNCTIONAL_NODE_NAME = /^(?:HANG_ZONE_|SHELF_ZONE_|STORAGE_ZONE_|LIGHT_|INTERACT_|SOCKET_|INTERACTION_POINT$|SIT_INTERACTION_POINT$|PLACEMENT_FOOTPRINT(?:_MIN|_MAX)?$|CHAIR_ANCHOR$|SEAT_ANCHOR$|FOOT_ANCHOR_|HAND_ANCHOR_|ENTRY_POINT_|EXIT_POINT_|FRONT_DIRECTION$|WALL_SNAP_ANCHOR$|WALL_CLEARANCE_BACK$|FLOOR_CONTACT_CENTER$|DESK_ALIGNMENT_ANCHOR$|DESK_WORK_POSITION$|SWIVEL_CENTER$)/;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (value) => value * value * (3 - 2 * value);

function hierarchyIsVisible(object, stopAt = null) {
  let cursor = object;
  while (cursor && cursor !== stopAt) {
    if (cursor.visible === false) return false;
    cursor = cursor.parent;
  }
  return true;
}

function visibleMeshBounds(root) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  const transformed = new THREE.Box3();
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry || !hierarchyIsVisible(node, root.parent)) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    if (!node.geometry.boundingBox) return;
    transformed.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
    bounds.union(transformed);
  });
  if (bounds.isEmpty()) return null;
  return {
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    dimensions: bounds.getSize(new THREE.Vector3()).toArray(),
  };
}

// Recessed fixtures deliberately retain their service can, spring clips, and
// junction hardware in the production GLB.  The clubhouse ceiling is a thin
// render surface rather than a solid slab, so those above-ceiling parts must be
// explicitly concealed at installation time.  This keeps the asset complete
// for future cutaway/maintenance views while guaranteeing that the normal
// player camera sees only the trim, dark aperture, reflector, and lens.
function configureCeilingInstallation(root, sku, lodIndex) {
  if (sku?.furnitureCategory !== 'ceiling-lights') return null;
  const concealedNames = [];
  const cutoutNames = [];
  root.traverse((node) => {
    const name = String(node.name || '');
    const aboveCeiling = node.userData?.above_ceiling === true
      || node.userData?.above_ceiling === 1
      // Safe fallback for pre-cachebuster Premium GLBs that may have lost
      // custom extras while still retaining the stable authored names.
      || /Downlight_\d+_(?:RoughInHousing|JunctionBox|SpringClip_|ThermalFin_)/i.test(name);
    if (aboveCeiling) {
      node.visible = false;
      node.userData.concealedByCeiling = true;
      concealedNames.push(name);
    }
    if (/CEILING_CUTOUT$/i.test(name)) {
      node.visible = false;
      cutoutNames.push(name);
    }
  });
  const bounds = visibleMeshBounds(root);
  const ceilingY = Number(sku.mountYOffset) || 0;
  return {
    lodIndex,
    concealedNames: concealedNames.sort(),
    hiddenAboveCeilingCount: concealedNames.length,
    cutoutNames: cutoutNames.sort(),
    cutoutCount: cutoutNames.length,
    recessDepthM: Number(sku.recessDepthM) || 0,
    visibleBounds: bounds,
    visibleDrop: bounds ? Math.max(0, ceilingY - bounds.min[1]) : null,
    ceilingOvershoot: bounds ? Math.max(0, bounds.max[1] - ceilingY) : null,
  };
}

function readableComponentName(name) {
  return String(name || 'Furniture component')
    .replace(/^(Drawer|CabinetDoor)_/, '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function templateFor(path) {
  if (!templates.has(path)) {
    templates.set(path, new Promise((resolve, reject) => {
      loader.load(path, (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }), undefined, reject);
    }));
  }
  return templates.get(path);
}

function deskEmissiveIntensity(materialName) {
  if (/^Desk_Basic_Surface$/i.test(materialName)) return 0.26;
  if (/^Desk_Basic_Body$/i.test(materialName)) return 0.22;
  if (/^Desk_Basic_InteriorOak$/i.test(materialName)) return 0.30;
  if (/^Desk_Standard_(?:Body|Surface)$/i.test(materialName)) return 0.30;
  if (/^Desk_Premium_(?:Body|Surface)$/i.test(materialName)) return 0.22;
  if (/^Desk_HighEnd_(?:Body|Surface)$/i.test(materialName)) return 0.22;
  if (/^Desk_Luxury_(?:Body|Surface)$/i.test(materialName)) return 0.28;
  if (/^Desk_Luxury_Leather$/i.test(materialName)) return 0.20;
  if (/InteriorOak$/i.test(materialName)) return 0.36;
  return 0.05;
}

function chairEmissiveIntensity(materialName) {
  if (/^Chair_Basic_(?:Leather|LeatherBody|MoldedPlastic)$/i.test(materialName)) return 0.18;
  if (/^Chair_Standard_(?:Leather|LeatherBody|MoldedPlastic)$/i.test(materialName)) return 0.14;
  if (/^Chair_Premium_(?:Leather|LeatherBody|MoldedPlastic)$/i.test(materialName)) return 0.15;
  if (/^Chair_HighEnd_(?:Leather|LeatherBody)$/i.test(materialName)) return 0.10;
  if (/^Chair_Luxury_(?:Leather|LeatherBody)$/i.test(materialName)) return 0.08;
  return 0;
}

function ownedClone(template, ghostMaterial, {
  groundedShadows = false,
  interiorReadability = false,
  chairShadows = false,
  shareGeometry = false,
  shareMaterials = false,
} = {}) {
  const root = template.clone(true);
  const ownedMaterials = new Map();
  const ownMaterial = (material) => {
    if (!material) return material;
    const shareThisMaterial = typeof shareMaterials === 'function'
      ? !!shareMaterials(material)
      : !!shareMaterials;
    if (shareThisMaterial && sharedFurnitureMaterials.has(material)) {
      return sharedFurnitureMaterials.get(material);
    }
    if (!ownedMaterials.has(material)) {
      const clone = material.clone();
      const materialName = clone.name || '';
      const deskFill = groundedShadows
        && /_(?:Body|Surface|Leather|InteriorOak)$/i.test(materialName);
      const shelfFill = interiorReadability
        && /^GF_Shelf_/i.test(materialName)
        && !/(?:CollisionHidden|DarkHardware|Recess|WarmIntegratedLight)/i.test(materialName);
      const chairFill = chairShadows && chairEmissiveIntensity(materialName) > 0;
      if (clone.map && (deskFill || shelfFill)) {
        // The legacy clubhouse has intentionally warm, low interior lighting.
        // A restrained albedo-matched fill keeps the authored wood grain and
        // laminate readable without turning the furniture into a light source.
        clone.emissive.set(/^Desk_Basic_/i.test(materialName) ? 0xfff3e5 : 0xffffff);
        clone.emissiveMap = clone.map;
        clone.emissiveIntensity = shelfFill
          ? (/(?:Walnut|Mahogany|Composite|CabinetInterior)/i.test(materialName) ? 0.09 : 0.035)
          : deskEmissiveIntensity(materialName);
      }
      if (chairFill) {
        // Dark charcoal office upholstery still needs to retain cushion seams
        // and molded-shell separation in the clubhouse's warm low light. The
        // authored albedo now carries the body value; this restrained matched
        // fill only protects detail at the darkest player-camera angles.
        if (clone.map) {
          clone.emissive.set(0xffffff);
          clone.emissiveMap = clone.map;
        } else if (clone.color) {
          clone.emissive.copy(clone.color);
        }
        clone.emissiveIntensity = chairEmissiveIntensity(materialName);
      }
      // Texture objects remain owned by the cached GLB template even when a
      // material clone is instance-local. Mark them so packing/removing one
      // furniture item cannot invalidate another instance or the cache.
      for (const value of Object.values(clone)) {
        if (value?.isTexture) value.userData[SHARED_FURNITURE_RESOURCE] = true;
      }
      if (shareThisMaterial) {
        clone.userData[SHARED_FURNITURE_RESOURCE] = true;
        sharedFurnitureMaterials.set(material, clone);
      }
      ownedMaterials.set(material, clone);
    }
    return ownedMaterials.get(material);
  };
  root.traverse((object) => {
    if (ghostMaterial && object.isLight) object.visible = false;
    if (!object.isMesh) return;
    if (object.geometry) {
      if (shareGeometry) {
        object.geometry.userData[SHARED_FURNITURE_RESOURCE] = true;
      } else {
        object.geometry = object.geometry.clone();
      }
    }
    if (ghostMaterial) object.material = ghostMaterial;
    else if (Array.isArray(object.material)) object.material = object.material.map(ownMaterial);
    else object.material = ownMaterial(object.material);
    if (/^(COLLISION_|COL_|UCX_|UBX_|USP_|UCP_)/i.test(object.name || '')) {
      object.visible = false;
      return;
    }
    object.castShadow = groundedShadows && (
      /^BATCH_(?:Body|Desktop|ModestyPanel)_/i.test(object.name || '')
      || (chairShadows && /^(?:SeatCushion|BackrestUpholstery|TuftedBackrest|UpholsteredBase)/i.test(object.name || ''))
    );
    object.receiveShadow = groundedShadows;
  });
  return root;
}

// Convert the three Blender-authored hierarchy roots into a real Three.js LOD.
// Distances are authored in metres but the clubhouse world uses yards, so the
// caller's model scale is also applied to the switch thresholds.
export function createAuthoredFurnitureLod(root, {
  distancesM = [0, 8, 18],
  modelScale = 1,
} = {}) {
  const objects = ['LOD0', 'LOD1', 'LOD2'].map((name) => root.getObjectByName(name));
  if (objects.some((object) => !object)) return null;
  const parent = objects[0].parent;
  if (!parent || objects.some((object) => object.parent !== parent)) return null;

  const lod = new THREE.LOD();
  lod.name = `${parent.name || 'Furniture'}_RuntimeLOD`;
  lod.autoUpdate = true;
  for (let index = 0; index < objects.length; index += 1) {
    parent.remove(objects[index]);
    lod.addLevel(objects[index], Math.max(0, Number(distancesM[index]) || 0) * modelScale);
    objects[index].visible = index === 0;
  }
  parent.add(lod);
  lod.userData.authoredDistancesM = [...distancesM];
  lod.userData.runtimeDistances = lod.levels.map((level) => level.distance);
  return lod;
}

export function createExternalFurnitureLod(roots, {
  distancesM = [0, 8, 18],
  modelScale = 1,
} = {}) {
  if (!Array.isArray(roots) || roots.length !== distancesM.length || roots.some((root) => !root)) {
    return null;
  }
  const lod = new THREE.LOD();
  lod.name = `${roots[0].name || 'Furniture'}_RuntimeLOD`;
  lod.autoUpdate = true;
  roots.forEach((root, index) => {
    lod.addLevel(root, Math.max(0, Number(distancesM[index]) || 0) * modelScale);
    root.visible = index === 0;
  });
  lod.userData.authoredDistancesM = [...distancesM];
  lod.userData.runtimeDistances = lod.levels.map((level) => level.distance);
  return lod;
}

function geometryBatchKey(geometry) {
  const attributes = Object.entries(geometry.attributes || {})
    .map(([name, attribute]) => (
      `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:${attribute.array?.constructor?.name || ''}`
    ))
    .sort()
    .join(',');
  return `${geometry.index ? 'indexed' : 'plain'}|${attributes}`;
}

// Preserve the authored Blender/GLB component hierarchy on disk, but collapse
// static runtime pieces that share a material inside each LOD. Callers can
// exclude moving meshes (for example cabinet leaves) so their authored pivots
// remain independently addressable.
export function batchStaticFurnitureLodMeshes(lod, {
  name = 'FurnitureLodBatch',
  excludeMesh = null,
} = {}) {
  if (!lod?.isLOD) return null;
  const summary = { sourceMeshes: 0, batchedMeshes: 0, reducedBy: 0, levels: [] };

  for (let levelIndex = 0; levelIndex < lod.levels.length; levelIndex += 1) {
    const levelRoot = lod.levels[levelIndex].object;
    levelRoot.updateWorldMatrix(true, true);
    const toLevel = levelRoot.matrixWorld.clone().invert();
    const buckets = new Map();

    levelRoot.traverse((object) => {
      if (!object.isMesh || !object.visible || object.isSkinnedMesh || object.isInstancedMesh
          || !object.geometry || Array.isArray(object.material) || !object.material
          || Object.keys(object.geometry.morphAttributes || {}).length
          || object.userData?.collision_proxy
          || /^(?:COL_|COLLISION_|UCX_|UBX_|USP_|UCP_)/i.test(object.name || '')
          || /CollisionHidden/i.test(object.material.name || '')
          || (typeof excludeMesh === 'function' && excludeMesh(object))) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(toLevel.clone().multiply(object.matrixWorld));
      const key = `${object.material.uuid}|${geometryBatchKey(geometry)}`;
      if (!buckets.has(key)) buckets.set(key, {
        material: object.material,
        geometries: [],
        sources: [],
        castShadow: false,
        receiveShadow: false,
      });
      const bucket = buckets.get(key);
      bucket.geometries.push(geometry);
      bucket.sources.push(object);
      bucket.castShadow ||= object.castShadow;
      bucket.receiveShadow ||= object.receiveShadow;
    });

    const levelSummary = { name: levelRoot.name, sourceMeshes: 0, batchedMeshes: 0, reducedBy: 0 };
    for (const bucket of buckets.values()) {
      if (bucket.sources.length < 2) {
        bucket.geometries[0]?.dispose();
        continue;
      }
      let merged = null;
      try {
        merged = mergeGeometries(bucket.geometries, false);
      } catch (_) {
        merged = null;
      }
      for (const geometry of bucket.geometries) geometry.dispose();
      if (!merged) continue;

      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.name = `${name}_${levelIndex}_${levelSummary.batchedMeshes + 1}`;
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = bucket.receiveShadow;
      levelRoot.add(mesh);
      for (const source of bucket.sources) {
        source.removeFromParent();
        source.geometry.dispose();
      }
      levelSummary.sourceMeshes += bucket.sources.length;
      levelSummary.batchedMeshes += 1;
      levelSummary.reducedBy += bucket.sources.length - 1;
    }
    summary.sourceMeshes += levelSummary.sourceMeshes;
    summary.batchedMeshes += levelSummary.batchedMeshes;
    summary.reducedBy += levelSummary.reducedBy;
    summary.levels.push(levelSummary);
  }
  lod.userData.runtimeBatch = summary;
  return summary;
}

export function collectFurnitureFunctionalNodes(root) {
  const byName = {};
  root.traverse((node) => {
    if (FUNCTIONAL_NODE_NAME.test(node.name || '')) byName[node.name] = node;
  });
  const names = Object.keys(byName).sort();
  return {
    names,
    byName,
    hangNodes: names.filter((name) => name.startsWith('HANG_ZONE_')),
    shelfNodes: names.filter((name) => name.startsWith('SHELF_ZONE_')),
    storageNodes: names.filter((name) => name.startsWith('STORAGE_ZONE_')),
    lightNodes: names.filter((name) => name.startsWith('LIGHT_')),
    interactionPoint: byName.INTERACTION_POINT || null,
    placementFootprint: byName.PLACEMENT_FOOTPRINT || null,
    wallSnapAnchor: byName.WALL_SNAP_ANCHOR || null,
    floorContactCenter: byName.FLOOR_CONTACT_CENTER || null,
    lightControl: byName.INTERACT_ShelfLights || null,
    chairAnchor: byName.CHAIR_ANCHOR || null,
    seatAnchor: byName.SEAT_ANCHOR || null,
    sitInteractionPoint: byName.SIT_INTERACTION_POINT || null,
    footAnchors: [byName.FOOT_ANCHOR_LEFT, byName.FOOT_ANCHOR_RIGHT].filter(Boolean),
    handAnchors: [byName.HAND_ANCHOR_LEFT, byName.HAND_ANCHOR_RIGHT].filter(Boolean),
    entryPoints: [byName.ENTRY_POINT_LEFT, byName.ENTRY_POINT_RIGHT].filter(Boolean),
    exitPoints: [byName.EXIT_POINT_LEFT, byName.EXIT_POINT_RIGHT].filter(Boolean),
    deskAlignmentAnchor: byName.DESK_ALIGNMENT_ANCHOR || null,
    deskWorkPosition: byName.DESK_WORK_POSITION || null,
    swivelCenter: byName.SWIVEL_CENTER || null,
    heightAdjustmentPivot: root.getObjectByName('HeightAdjustmentPivot') || null,
    swivelPivot: root.getObjectByName('SwivelPivot') || null,
    backrestTiltPivot: root.getObjectByName('BackrestTiltPivot') || null,
    casterPivots: Array.from({ length: 5 }, (_, index) => (
      root.getObjectByName(`Caster_${String(index + 1).padStart(2, '0')}`)
    )).filter(Boolean),
  };
}

function configureClothingRackLights(root, sku, modelScale) {
  if (sku.furnitureCategory !== 'clothing-racks') return [];
  const lights = [];
  const attachmentNodes = [];
  root.traverse((node) => {
    if (/^LIGHT_POINT_\d{2}$/.test(node.name || '')) attachmentNodes.push(node);
    // Keep old saves/exports safe while cached pre-migration GLBs age out.
    if (!node.isLight) return;
    const cove = /^RuntimeCoveLight_/i.test(node.name || '');
    node.intensity = Math.min(node.intensity, cove ? 0.40 : 2.50);
    node.distance = (cove ? 1.35 : 3.0) * modelScale;
    node.decay = 2;
    node.castShadow = false;
    lights.push(node);
  });
  if (lights.length) return lights;
  // New exports carry data-only attachment nodes so the GLB stays free of
  // KHR_lights_punctual payloads.  Recreate the authored accents under the
  // identity FunctionalNodes parent; this avoids inheriting the Blender arrow
  // display rotation while preserving the node's exact local position.
  for (const node of attachmentNodes) {
    const data = node.userData || {};
    const kind = data.runtime_light_kind;
    if (kind !== 'spot' && kind !== 'point') continue;
    const colorValues = Array.isArray(data.runtime_color_linear)
      ? data.runtime_color_linear : [1, 0.72, 0.46];
    const color = new THREE.Color(colorValues[0], colorValues[1], colorValues[2]);
    const intensity = Number(data.runtime_intensity) || 0;
    const distance = (Number(data.runtime_distance_m) || 3) * modelScale;
    const decay = Number(data.runtime_decay) || 2;
    const light = kind === 'spot'
      ? new THREE.SpotLight(
        color, intensity, distance,
        Number(data.runtime_angle_rad) || Math.PI / 2.5,
        Number(data.runtime_penumbra) || 0.72, decay,
      )
      : new THREE.PointLight(color, intensity, distance, decay);
    const index = node.name.slice(-2);
    const coveIndex = String(Number(index) - 3).padStart(2, '0');
    light.name = kind === 'spot' ? `RuntimeLight_${index}` : `RuntimeCoveLight_${coveIndex}`;
    light.castShadow = false;
    light.userData.attachmentNode = node.name;
    const offset = Array.isArray(data.light_offset_m) ? data.light_offset_m : [0, 0, 0];
    light.position.set(
      node.position.x + Number(offset[0] || 0),
      node.position.y + Number(offset[1] || 0),
      node.position.z + Number(offset[2] || 0),
    );
    const parent = node.parent || root;
    parent.add(light);
    if (kind === 'spot') {
      const targetOffset = Array.isArray(data.target_offset_m)
        ? data.target_offset_m : [0, 0.28, -0.80];
      const target = new THREE.Object3D();
      target.name = `${light.name}_Target`;
      target.position.set(
        node.position.x + Number(targetOffset[0] || 0),
        node.position.y + Number(targetOffset[1] || 0),
        node.position.z + Number(targetOffset[2] || 0),
      );
      parent.add(target);
      light.target = target;
    }
    lights.push(light);
  }
  return lights;
}

function configureRetailShelfLights(root, sku, modelScale, ghostMaterial) {
  if (ghostMaterial || sku.furnitureCategory !== 'freestanding-shelving') return [];
  const lights = [];
  root.traverse((node) => {
    if (!/^LIGHT_POINT_Bay\d{2}$/.test(node.name || '')) return;
    const light = new THREE.SpotLight(0xffd1a1, 16, 2.6 * modelScale, Math.PI / 3.4, 0.72, 2);
    light.name = `Runtime_${node.name}`;
    light.castShadow = false;
    const target = new THREE.Object3D();
    target.name = `${light.name}_Target`;
    target.position.set(0, -0.95 * modelScale, 0.18 * modelScale);
    node.add(light, target);
    light.target = target;
    lights.push(light);
  });
  return lights;
}

function componentTypeFor(object) {
  const type = object?.userData?.interactionType;
  return type === 'drawer' || type === 'cabinet-door' ? type : null;
}

function applyComponentPose(controller) {
  const eased = smoothstep(clamp01(controller.progress));
  controller.node.position.lerpVectors(controller.closedPosition, controller.openPosition, eased);
  controller.node.quaternion.slerpQuaternions(
    controller.closedQuaternion,
    controller.openQuaternion,
    eased,
  );
  controller.node.updateMatrix();
  controller.node.matrixWorldNeedsUpdate = true;
}

// Turn Blender-authored component roots into small independent runtime
// controllers.  The GLB's closed transform is authoritative; the movement
// distance/hinge angle comes from exported custom properties.  This keeps the
// animation deterministic, permits several drawers to move at once, and makes
// the open/closed state straightforward to save.
export function createFurnitureComponentControllers(root, {
  componentStates = {},
  onComponentStateChange = null,
} = {}) {
  const controllers = [];
  root.traverse((node) => {
    const type = componentTypeFor(node);
    // INTERACT_* nodes repeat the type but point at a component; only the
    // transform roots carry authored motion metadata.
    if (!type || node.userData?.component || !node.userData?.closedLocation) return;

    const closedPosition = node.position.clone();
    const openPosition = closedPosition.clone();
    const closedQuaternion = node.quaternion.clone();
    const openQuaternion = closedQuaternion.clone();
    if (type === 'drawer') {
      // Blender's -Y/front direction is glTF/Three +Z after axis conversion.
      openPosition.z += Number(node.userData.openDistance) || 0;
    } else {
      const angle = THREE.MathUtils.degToRad(Number(node.userData.openAngle) || 0);
      openQuaternion.multiply(new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        angle,
      ));
    }

    const startsOpen = componentStates?.[node.name] === true;
    const controller = {
      name: node.name,
      label: readableComponentName(node.name),
      type,
      node,
      interactionNode: root.getObjectByName(`INTERACT_${node.name}`) || node,
      soundCategory: node.userData.interactionSoundCategory || 'furniture',
      storageCapacity: Number(node.userData.storageCapacity) || 0,
      closedPosition,
      openPosition,
      closedQuaternion,
      openQuaternion,
      duration: type === 'drawer' ? 0.34 : 0.46,
      progress: startsOpen ? 1 : 0,
      target: startsOpen ? 1 : 0,
      isOpen: () => controller.target >= 0.5,
      setOpen(open, { immediate = false, notify = true } = {}) {
        const nextTarget = open ? 1 : 0;
        const changed = controller.target !== nextTarget;
        controller.target = nextTarget;
        if (immediate) {
          controller.progress = nextTarget;
          applyComponentPose(controller);
        }
        if (changed && notify && typeof onComponentStateChange === 'function') {
          onComponentStateChange({
            name: controller.name,
            open: nextTarget === 1,
            type: controller.type,
            soundCategory: controller.soundCategory,
          });
        }
        return nextTarget === 1;
      },
      toggle(options) {
        return controller.setOpen(!controller.isOpen(), options);
      },
      update(dt) {
        if (controller.progress === controller.target) return false;
        const step = Math.max(0, Number(dt) || 0) / controller.duration;
        if (controller.progress < controller.target) {
          controller.progress = Math.min(controller.target, controller.progress + step);
        } else {
          controller.progress = Math.max(controller.target, controller.progress - step);
        }
        applyComponentPose(controller);
        return true;
      },
    };
    applyComponentPose(controller);
    controllers.push(controller);
  });
  return controllers.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildPropertyFurnitureVisual(sku, {
  ghostMaterial = null,
  componentStates = {},
  onComponentStateChange = null,
  lightState = null,
  circuitPowered = () => true,
  onLightPowerChange = null,
  onSpotlightAimChange = null,
} = {}) {
  const group = new THREE.Group();
  group.name = `PropertyFurniture_${sku.id}`;
  group.userData.modelPath = sku.modelPath;
  group.userData.interactiveComponents = [];
  group.userData.interactiveLights = [];
  group.userData.update = () => false;
  const requestedLodPaths = sku.authoredLodModelPaths || sku.modelLodPaths;
  const externalLodPaths = Array.isArray(requestedLodPaths)
    && requestedLodPaths.length === 3
    ? requestedLodPaths : null;
  const templateRequest = externalLodPaths
    ? Promise.all(externalLodPaths.map((path) => templateFor(path)))
    : templateFor(sku.modelPath).then((template) => [template]);
  group.userData.ready = templateRequest.then((loadedTemplates) => {
    if (group.userData.disposed) return group;
    const template = loadedTemplates[0];
    const chairShadows = !ghostMaterial && sku.furnitureCategory === 'chairs';
    const shareChairResources = sku.furnitureCategory === 'chairs';
    const shareCeilingGeometry = sku.furnitureCategory === 'ceiling-lights';
    const shareCeilingStaticMaterial = shareCeilingGeometry
      ? (material) => !/(?:Emitter|Emissive|FrostedDiffuser)/i.test(material?.name || '')
      : false;
    const groundedShadows = !ghostMaterial
      && ['chairs', 'office-desks'].includes(sku.furnitureCategory);
    const interiorReadability = !ghostMaterial && sku.furnitureCategory === 'freestanding-shelving';
    const root = ownedClone(template.scene, ghostMaterial, {
      groundedShadows,
      interiorReadability,
      chairShadows,
      shareGeometry: shareChairResources || shareCeilingGeometry,
      shareMaterials: shareChairResources || shareCeilingStaticMaterial,
    });
    const modelScale = sku.modelScale || 1;
    root.scale.setScalar(modelScale);
    root.position.y = sku.mountYOffset || 0;
    const ceilingInstallations = [configureCeilingInstallation(root, sku, 0)];
    const runtimeLights = [
      ...configureClothingRackLights(root, sku, modelScale),
      ...configureRetailShelfLights(root, sku, modelScale, ghostMaterial),
    ];
    const functionalNodes = collectFurnitureFunctionalNodes(root);
    let authoredLod = null;
    let visualRoots = [root];
    if (externalLodPaths) {
      visualRoots = [root, ...loadedTemplates.slice(1).map((lodTemplate) => {
        const lodRoot = ownedClone(lodTemplate.scene, ghostMaterial, {
          groundedShadows,
          interiorReadability,
          chairShadows,
          shareGeometry: shareChairResources || shareCeilingGeometry,
          shareMaterials: shareChairResources || shareCeilingStaticMaterial,
        });
        lodRoot.scale.setScalar(modelScale);
        lodRoot.position.y = sku.mountYOffset || 0;
        ceilingInstallations.push(configureCeilingInstallation(
          lodRoot, sku, ceilingInstallations.length,
        ));
        runtimeLights.push(...configureClothingRackLights(lodRoot, sku, modelScale));
        return lodRoot;
      })];
      visualRoots.forEach((lodRoot, index) => {
        lodRoot.name = `${sku.id}_LOD${index}`;
      });
      authoredLod = createExternalFurnitureLod(visualRoots, {
        distancesM: sku.authoredLodDistancesM || sku.modelLodDistancesM,
        modelScale,
      });
      group.add(authoredLod);
    } else {
      authoredLod = Array.isArray(sku.authoredLodDistancesM)
        ? createAuthoredFurnitureLod(root, {
          distancesM: sku.authoredLodDistancesM,
          modelScale,
        })
        : null;
      group.add(root);
    }
    const runtimeBatch = !ghostMaterial && authoredLod
      && ['clothing-racks', 'freestanding-shelving'].includes(sku.furnitureCategory)
      ? batchStaticFurnitureLodMeshes(authoredLod, {
        name: sku.furnitureCategory === 'clothing-racks'
          ? `ClothingRackBatch_${sku.tier}`
          : `RetailShelfBatch_${sku.tier}`,
        // Shelf cabinet leaves remain separate moving geometry. Their parent
        // carries the authored hinge metadata even when the visible mesh is a
        // child, so inspect the complete ancestry up to the LOD root.
        excludeMesh: sku.furnitureCategory === 'freestanding-shelving'
          ? (mesh) => {
            let cursor = mesh;
            while (cursor && cursor !== authoredLod) {
              if (['drawer', 'cabinet-door'].includes(cursor.userData?.interactionType)) return true;
              cursor = cursor.parent;
            }
            return false;
          }
          : null,
      })
      : null;
    const controllers = ghostMaterial ? [] : createFurnitureComponentControllers(root, {
      componentStates,
      onComponentStateChange,
    });
    const lightController = ghostMaterial ? null : createCeilingLightController(visualRoots, sku, {
      lightState,
      circuitPowered,
      onPowerStateChange: onLightPowerChange,
      onAimStateChange: onSpotlightAimChange,
    });
    group.userData.modelRoot = root;
    group.userData.lodRoots = visualRoots;
    group.userData.functionalNodes = functionalNodes;
    group.userData.authoredLod = authoredLod;
    group.userData.runtimeBatch = runtimeBatch;
    group.userData.animations = template.animations.map((clip) => clip.name);
    group.userData.animationClips = [...template.animations];
    group.userData.interactiveComponents = controllers;
    group.userData.runtimeLights = runtimeLights;
    group.userData.ceilingInstallation = ceilingInstallations.filter(Boolean);
    group.userData.ceilingLightController = lightController;
    group.userData.interactiveLights = lightController?.headControllers || [];
    group.userData.update = (dt) => {
      let changed = false;
      for (const controller of controllers) changed = controller.update(dt) || changed;
      changed = lightController?.update(dt) || changed;
      return changed;
    };
    group.userData.loaded = true;
    return group;
  }).catch((error) => {
    group.userData.loadError = String(error?.message || error);
    return group;
  });
  return group;
}
