import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { METERS_TO_YARDS } from './assets51to100/units.js';

export const COURSE1_MUNICIPAL_ASSETS = Object.freeze({
  architecture: 'vendor/models/course1_municipal/course1_municipal_clubhouse_architecture.glb',
  property: 'vendor/models/course1_municipal/course1_municipal_property.glb',
});

// The legacy clubhouse placed its finished floor 0.30 yd above the course
// datum. The authored municipal floor is 0.20 m above its origin, so this lift
// keeps every existing interior-local interaction on the exact same walk plane
// while also keeping the parking asphalt clear of the course terrain.
export const COURSE1_MUNICIPAL_ROOT_LIFT_YARDS = 0.30 - 0.20 * METERS_TO_YARDS;

const COLLISION_PREFIX = 'COL_';
const LARGE_SHADOW_CASTER = /(?:ROOF|WALL|GABLE|CHIMNEY|PORCH_(?:COLUMN|BEAM)|CANOPY|SHED_(?:WALL|ROOF)|DUMPSTER_BODY)/i;
const MOVING_ROOT = /^(?:DOOR_|SHED_DOOR_|DUMPSTER_(?:GATE_|LID$))/i;
const ARCHITECTURE_COLLIDER = /^COL_(?:WALL_|PARTITION_)/i;
const AUXILIARY_DOORS = Object.freeze([
  ['DOOR_SERVICE_EAST', 'Service entrance'],
  ['DOOR_MAINTENANCE_BACK', 'Maintenance entrance'],
  ['DOOR_INTERIOR_EMPLOYEE', 'Employee room door'],
  ['DOOR_INTERIOR_OFFICE', 'Office door'],
  ['DOOR_INTERIOR_RESTROOM', 'Restroom door'],
  ['DOOR_INTERIOR_STORAGE', 'Storage room door'],
]);

function disposeLoadedRoot(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root?.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const source = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of source) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
  for (const texture of textures) texture.dispose?.();
}

function configureRoot(root, kind) {
  root.name = kind === 'architecture'
    ? 'Course1MunicipalClubhouseArchitecture'
    : 'Course1MunicipalProperty';
  root.scale.setScalar(METERS_TO_YARDS);
  root.position.y = COURSE1_MUNICIPAL_ROOT_LIFT_YARDS;
  root.userData.course1MunicipalRoot = true;
  root.userData.units = 'authored_meters_runtime_yards';
  root.userData.source = COURSE1_MUNICIPAL_ASSETS[kind];
  root.traverse((object) => {
    // The standalone Blender scene includes a graded lawn for review and reuse.
    // In the live course the continuous terrain already owns that surface; a
    // second rectangular lawn produces a hard property boundary, so only the
    // authored asphalt, paths, weeds, and practice green remain visible here.
    if (kind === 'property' && object.name === 'SITE_GRADED_LAWN') {
      object.visible = false;
      object.userData.course1MunicipalStandaloneSurface = true;
      return;
    }
    if (String(object.name || '').startsWith(COLLISION_PREFIX)
      || object.userData?.collision_proxy === true) {
      object.visible = false;
      object.userData.course1MunicipalCollisionProxy = true;
      return;
    }
    if (!object.isMesh) return;
    object.receiveShadow = true;
    object.castShadow = LARGE_SHADOW_CASTER.test(object.name || '');
  });
  return root;
}

function geometrySignature(geometry) {
  return Object.entries(geometry.attributes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, attribute]) => (
      `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:${attribute.array?.constructor?.name || ''}`
    ))
    .join('|');
}

function beneathMovingRoot(object, root) {
  for (let cursor = object; cursor && cursor !== root; cursor = cursor.parent) {
    if (MOVING_ROOT.test(String(cursor.name || ''))) return true;
  }
  return false;
}

/**
 * Runtime-only batching. The .blend and GLB retain every reusable module and
 * pivot; the browser combines only motionless meshes that share an identical
 * material/attribute contract. Doors, gates, lids, and collision proxies stay
 * independently addressable.
 */
function batchStaticMeshes(root, kind) {
  root.updateWorldMatrix(true, true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const groups = new Map();
  const movingTransforms = [];
  let sourceMeshes = 0;
  root.traverse((object) => {
    if (MOVING_ROOT.test(String(object.name || ''))) {
      movingTransforms.push({
        object,
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });
    }
    if (!object.isMesh || object.visible === false || beneathMovingRoot(object, root)) return;
    if (Array.isArray(object.material) || !object.material || object.geometry?.morphAttributes?.position) return;
    sourceMeshes++;
    const key = [
      object.material.uuid,
      geometrySignature(object.geometry),
      object.castShadow ? 1 : 0,
      object.receiveShadow ? 1 : 0,
    ].join('::');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(object);
  });

  let batchCount = 0;
  let batchedMeshes = 0;
  for (const objects of groups.values()) {
    if (objects.length < 2) continue;
    const geometries = objects.map((object) => {
      const geometry = object.geometry.clone();
      const relative = inverseRoot.clone().multiply(object.matrixWorld);
      geometry.applyMatrix4(relative);
      return geometry;
    });
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, objects[0].material);
    mesh.name = `Course1Municipal_${kind}_Batch_${String(batchCount).padStart(2, '0')}`;
    mesh.castShadow = objects[0].castShadow;
    mesh.receiveShadow = objects[0].receiveShadow;
    mesh.userData.course1MunicipalRuntimeBatch = true;
    mesh.userData.sourceModuleCount = objects.length;
    root.add(mesh);
    for (const object of objects) object.removeFromParent();
    batchCount++;
    batchedMeshes += objects.length;
  }
  // Removing hundreds of sibling meshes must never alter a moving module's
  // authored local datum. Restore the captured values explicitly and fail the
  // diagnostics if a loader/browser regression ever makes one non-finite.
  let invalidMovingTransforms = 0;
  for (const entry of movingTransforms) {
    entry.object.position.copy(entry.position);
    entry.object.quaternion.copy(entry.quaternion);
    entry.object.scale.copy(entry.scale);
    if (![...entry.object.position.toArray(), ...entry.object.quaternion.toArray(), ...entry.object.scale.toArray()]
      .every(Number.isFinite)) invalidMovingTransforms++;
  }
  root.updateWorldMatrix(true, true);
  return Object.freeze({
    sourceMeshes,
    batchedMeshes,
    batchCount,
    movingRootCount: movingTransforms.length,
    invalidMovingTransforms,
  });
}

function loadGlb(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

/**
 * Owns the Course 1 municipal environment replacement. The original
 * procedural shell remains alive as a zero-network collision/interaction
 * fallback, but its visuals are leased off as soon as this owner is created.
 * Furniture stays under the separate interior root so player customization is
 * not baked into the architecture asset.
 */
export function createCourse1MunicipalEnvironment({
  group,
  interior,
  shell,
  doorApi,
  sheet06Production,
  addCollider,
  removeCollider,
  addProp,
  registeredColliders = null,
  registeredProps = null,
  removeProp = null,
  hooks = null,
  fixtureAnchors = null,
  defaultFixtureIds = null,
  loader = new GLTFLoader(),
} = {}) {
  if (!group?.isObject3D) throw new TypeError('Course 1 municipal environment requires a clubhouse group.');

  let disposed = false;
  let architectureRoot = null;
  let propertyRoot = null;
  let error = null;
  let architectureBatching = null;
  let propertyBatching = null;
  const registeredPropertyColliders = [];
  const registeredArchitectureColliders = [];
  const registeredDoorColliders = [];
  const registeredDoorProps = [];
  const auxiliaryDoorControllers = [];
  const mainDoorLeaves = [];
  const roots = new Set();
  const defaultFixtureIdSet = defaultFixtureIds instanceof Set
    ? defaultFixtureIds
    : new Set(defaultFixtureIds || []);

  // Hide every procedural structural layer immediately. This is an exact
  // visual lease only: analytic navigation, the register, save state, and
  // player-placeable furniture remain authoritative and untouched.
  for (const handle of Object.values(shell?.productionVisualFallbacks || {})) {
    handle.setVisible?.(false);
  }
  const hideLegacyGroupChildren = () => {
    for (const child of group.children) {
      // The interior root remains the ownership boundary for leased campaign
      // props and player furniture. Its children are filtered separately;
      // hiding the parent made every explicitly preserved child invisible.
      if (child !== interior && !roots.has(child)) child.visible = false;
    }
  };
  hideLegacyGroupChildren();
  const hideLegacyInteriorChildren = () => {
    const customFixtureRoots = new Set();
    if (fixtureAnchors instanceof Map) {
      for (const [fixtureId, root] of fixtureAnchors) {
        if (!defaultFixtureIdSet.has(fixtureId)) customFixtureRoots.add(root);
      }
    }
    for (const child of interior?.children || []) {
      if (customFixtureRoots.has(child)
        || child.userData?.preserveInMunicipal
        || /^Course1MunicipalFixtureBuild(?:Ghost|Halo)$/.test(child.name || '')) continue;
      if (child.name === 'Course1MunicipalCustomFixtureStock') {
        let hasCustomStock = false;
        for (const stock of child.children) {
          const fixtureId = stock.userData?.fixtureLayoutId;
          if (fixtureId && defaultFixtureIdSet.has(fixtureId)) stock.visible = false;
          else if (fixtureId) hasCustomStock = true;
        }
        child.visible = hasCustomStock;
        continue;
      }
      child.visible = false;
    }
  };
  hideLegacyInteriorChildren();

  // The authored proxy set is the only navigation authority. Furniture, the
  // oversized legacy envelope, old door slabs, yard dressing, checkout props,
  // and delivery staging must not leave invisible obstacles or prompts in the
  // intentionally empty municipal shell. Transaction/save data itself remains
  // untouched, ready for a later furnishing migration.
  function pruneLegacyRegistrations() {
    if (Array.isArray(registeredColliders)) {
      for (const collider of [...registeredColliders]) {
        if (String(collider?.id || '').startsWith('course1-municipal-')) continue;
        if (collider?.preserveInMunicipal) continue;
        if (collider?.fixtureLayoutId && !defaultFixtureIdSet.has(collider.fixtureLayoutId)) continue;
        removeCollider?.(collider);
      }
    }
    if (Array.isArray(registeredProps)) {
      for (const prop of [...registeredProps]) {
        if (String(prop?.id || '').startsWith('course1-municipal-')) continue;
        if (prop?.preserveInMunicipal) continue;
        if (prop?.fixtureLayoutId && !defaultFixtureIdSet.has(prop.fixtureLayoutId)) continue;
        removeProp?.(prop);
      }
    }
  }
  pruneLegacyRegistrations();

  function suppressSheet06() {
    for (let number = 51; number <= 60; number++) {
      const direct = sheet06Production?.getRoot?.(number);
      const assembly = sheet06Production?.getAssemblyRoot?.(number);
      if (direct) direct.visible = false;
      if (assembly) assembly.visible = false;
    }
  }

  function registerShedCollision(root) {
    if (typeof addCollider !== 'function') return;
    root.updateWorldMatrix(true, true);
    root.traverse((object) => {
      if (!/^COL_SHED_/i.test(object.name || '')) return;
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) return;
      const collider = addCollider({
        id: `course1-municipal-${object.name.toLowerCase()}`,
        kind: 'course1-municipal-property',
        minX: bounds.min.x,
        maxX: bounds.max.x,
        minZ: bounds.min.z,
        maxZ: bounds.max.z,
      });
      registeredPropertyColliders.push(collider);
    });
  }

  function setColliderFromObject(collider, object) {
    object.updateWorldMatrix?.(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return false;
    collider.minX = bounds.min.x;
    collider.maxX = bounds.max.x;
    collider.minZ = bounds.min.z;
    collider.maxZ = bounds.max.z;
    return [collider.minX, collider.maxX, collider.minZ, collider.maxZ].every(Number.isFinite);
  }

  function addObjectCollider(object, id, kind, collection, { door = false } = {}) {
    if (typeof addCollider !== 'function') return null;
    const collider = { id, kind, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    if (!setColliderFromObject(collider, object)) return null;
    if (door) collider.door = true;
    addCollider(collider);
    collection.push(collider);
    return collider;
  }

  function registerArchitectureCollision(root) {
    root.updateWorldMatrix(true, true);
    root.traverse((object) => {
      const name = String(object.name || '');
      if (!ARCHITECTURE_COLLIDER.test(name) || /_HEADER_/i.test(name)) return;
      addObjectCollider(
        object,
        `course1-municipal-${name.toLowerCase()}`,
        'course1-municipal-architecture',
        registeredArchitectureColliders,
      );
    });
  }

  function registerDoorProp(prop) {
    if (typeof addProp !== 'function') return null;
    const registered = addProp(prop);
    registeredDoorProps.push(registered || prop);
    return registered || prop;
  }

  function setupMainDoorCollisionAndInteraction(root) {
    const left = root.getObjectByName('DOOR_MAIN_LEFT');
    const right = root.getObjectByName('DOOR_MAIN_RIGHT');
    if (!left || !right) return;
    for (const leaf of [left, right]) {
      const collider = addObjectCollider(
        leaf,
        `course1-municipal-${leaf.name.toLowerCase()}`,
        'course1-municipal-door',
        registeredDoorColliders,
        { door: true },
      );
      if (collider) mainDoorLeaves.push({ root: leaf, collider });
    }
    const bounds = new THREE.Box3().setFromObject(left).union(new THREE.Box3().setFromObject(right));
    const centre = bounds.getCenter(new THREE.Vector3());
    registerDoorProp({
      id: 'course1-municipal-main-door-interaction',
      kind: 'course1-municipal-door',
      x: centre.x,
      z: centre.z,
      r: 2.1,
      label: () => `Shop door — [E] ${doorApi?.mainEntranceIsOpen?.() ? 'close' : 'open'}`,
      action: () => doorApi?.toggleMainEntrance?.(),
    });
  }

  function setupAuxiliaryDoorControllers(root) {
    for (const [name, label] of AUXILIARY_DOORS) {
      const leaf = root.getObjectByName(name);
      if (!leaf) continue;
      const collider = addObjectCollider(
        leaf,
        `course1-municipal-${name.toLowerCase()}`,
        'course1-municipal-door',
        registeredDoorColliders,
        { door: true },
      );
      if (!collider) continue;
      const baseAngle = leaf.rotation.y;
      const exteriorSign = Number(leaf.userData?.exterior_sign) || 1;
      const axisRunsAlongZ = Math.abs(Math.sin(baseAngle)) > 0.5;
      const openDelta = THREE.MathUtils.degToRad(100)
        * (axisRunsAlongZ ? -exteriorSign : exteriorSign);
      const initialBounds = new THREE.Box3().setFromObject(leaf);
      const centre = initialBounds.getCenter(new THREE.Vector3());
      const controller = {
        name,
        label,
        root: leaf,
        collider,
        baseAngle,
        openDelta,
        angle: 0,
        open: false,
        interactionX: centre.x,
        interactionZ: centre.z,
      };
      auxiliaryDoorControllers.push(controller);
      leaf.userData.course1MunicipalLiveDoor = true;
      registerDoorProp({
        id: `course1-municipal-${name.toLowerCase()}-interaction`,
        kind: 'course1-municipal-door',
        x: centre.x,
        z: centre.z,
        r: 1.75,
        label: () => `${label} — [E] ${controller.open ? 'close' : 'open'}`,
        action: () => {
          controller.open = !controller.open;
          hooks?.sfx?.(controller.open ? 'doorSwing' : 'doorShut');
          return true;
        },
      });
    }
  }

  function updateAuthoredDoors(dt) {
    for (const entry of mainDoorLeaves) setColliderFromObject(entry.collider, entry.root);
    const step = Math.min(1, Math.max(0, Number(dt) || 0) * 5.5);
    for (const controller of auxiliaryDoorControllers) {
      const target = controller.open ? controller.openDelta : 0;
      controller.angle += (target - controller.angle) * step;
      controller.root.rotation.y = controller.baseAngle + controller.angle;
      controller.root.updateMatrix?.();
      controller.root.matrixWorldNeedsUpdate = true;
      setColliderFromObject(controller.collider, controller.root);
    }
  }

  const ready = Promise.all([
    loadGlb(loader, COURSE1_MUNICIPAL_ASSETS.architecture),
    loadGlb(loader, COURSE1_MUNICIPAL_ASSETS.property),
  ]).then(([architecture, property]) => {
    if (disposed) {
      disposeLoadedRoot(architecture);
      disposeLoadedRoot(property);
      return null;
    }
    architectureRoot = configureRoot(architecture, 'architecture');
    propertyRoot = configureRoot(property, 'property');
    architectureBatching = batchStaticMeshes(architectureRoot, 'Architecture');
    propertyBatching = batchStaticMeshes(propertyRoot, 'Property');
    roots.add(architectureRoot);
    roots.add(propertyRoot);
    group.add(propertyRoot, architectureRoot);
    group.updateWorldMatrix(true, true);
    registerShedCollision(propertyRoot);
    const mainDoorBinding = doorApi?.bindMainEntranceVisual?.(architectureRoot) || null;
    registerArchitectureCollision(architectureRoot);
    setupMainDoorCollisionAndInteraction(architectureRoot);
    setupAuxiliaryDoorControllers(architectureRoot);
    suppressSheet06();
    hideLegacyGroupChildren();
    hideLegacyInteriorChildren();
    pruneLegacyRegistrations();
    return Object.freeze({ architectureRoot, propertyRoot, mainDoorBinding });
  }).catch((reason) => {
    error = reason instanceof Error ? reason : new Error(String(reason));
    console.error('Course 1 municipal environment failed to load', error);
    return null;
  });

  function update(dt = 0) {
    if (disposed) return;
    suppressSheet06();
    hideLegacyGroupChildren();
    hideLegacyInteriorChildren();
    pruneLegacyRegistrations();
    updateAuthoredDoors(dt);
  }

  function diagnostics() {
    const customFixtureCount = fixtureAnchors instanceof Map
      ? [...fixtureAnchors.keys()].filter((id) => !defaultFixtureIdSet.has(id)).length
      : 0;
    return Object.freeze({
      ready: Boolean(architectureRoot && propertyRoot),
      architectureLoaded: Boolean(architectureRoot),
      propertyLoaded: Boolean(propertyRoot),
      error: error ? String(error.message || error) : null,
      scaleMetersToYards: METERS_TO_YARDS,
      rootLiftYards: COURSE1_MUNICIPAL_ROOT_LIFT_YARDS,
      propertyColliderCount: registeredPropertyColliders.length,
      architectureColliderCount: registeredArchitectureColliders.length,
      doorColliderCount: registeredDoorColliders.length,
      doorInteractionCount: registeredDoorProps.length,
      interiorLease: Object.freeze({
        intentionallyEmptyDefaults: defaultFixtureIdSet.size,
        customFixtureCount,
        futureFixtureVisualsEnabled: true,
      }),
      auxiliaryDoors: auxiliaryDoorControllers.map((door) => Object.freeze({
        name: door.name,
        open: door.open,
        angle: door.angle,
        interactionX: door.interactionX,
        interactionZ: door.interactionZ,
      })),
      architectureBatching,
      propertyBatching,
      mainDoor: doorApi?.mainEntranceDiagnostics?.() || null,
    });
  }

  function dispose() {
    if (disposed) return diagnostics();
    disposed = true;
    for (const prop of registeredDoorProps.splice(0).reverse()) {
      try { removeProp?.(prop); } catch { /* teardown remains best effort */ }
    }
    for (const collider of [
      ...registeredDoorColliders.splice(0),
      ...registeredArchitectureColliders.splice(0),
      ...registeredPropertyColliders.splice(0),
    ].reverse()) {
      try { removeCollider?.(collider); } catch { /* teardown remains best effort */ }
    }
    return diagnostics();
  }

  return Object.freeze({ ready, update, diagnostics, dispose });
}

export default createCourse1MunicipalEnvironment;
