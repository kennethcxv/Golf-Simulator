// DATA-DRIVEN CLUBHOUSE PLACEABLE VISUALS.
//
// Assets are loaded once and cloned for the room and for placement previews. The
// same authored socket-to-transform function is used by both paths, which makes
// "what you see" and "what gets saved" the same transform instead of two almost
// matching implementations. Collision remains analytic and comes from the catalog;
// authored COL_ meshes are audit evidence, not a second physics system.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { PLACEABLES, placeableById } from '../../data/placeableCatalog.js';
import { placedObjects, placementBounds } from '../../sim/layout.js';

export const PLACEABLE_SELECTION_LAYER = 31;

const VALID = new THREE.Color(0x62d48c);
const INVALID = new THREE.Color(0xf06f68);
const VARIANT_TINT = Object.freeze({
  'golf-green': 0x31553c,
  'muted-sage': 0x9baa8a,
  'warm-charcoal': 0x4b4945,
});

const loader = new GLTFLoader();
const templateJobs = new Map();
const sharedCatalogMaterials = new Map();

function shareCatalogMaterials(root, path) {
  if (!String(path).includes('vendor/models/furniture/catalog/')) return;
  const replacements = new Map();
  root.traverse((object) => {
    if (!object.isMesh) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    const next = list.map((material) => {
      if (!material?.name) return material;
      if (!replacements.has(material)) {
        const shared = sharedCatalogMaterials.get(material.name);
        if (shared) replacements.set(material, shared);
        else {
          sharedCatalogMaterials.set(material.name, material);
          replacements.set(material, material);
        }
      }
      return replacements.get(material);
    });
    object.material = Array.isArray(object.material) ? next : next[0];
  });
  for (const [original, shared] of replacements) {
    if (original !== shared) original.dispose();
  }
}

function isCollisionProxy(object, root) {
  let current = object;
  while (current && current !== root) {
    if (/^(COL_|UCX_|UBX_|USP_|UCP_)/i.test(current.name || '')) return true;
    current = current.parent;
  }
  return false;
}

function loadTemplate(path) {
  if (!templateJobs.has(path)) {
    templateJobs.set(path, new Promise((resolve, reject) => {
      loader.load(path, (gltf) => {
        shareCatalogMaterials(gltf.scene, path);
        gltf.scene.updateMatrixWorld(true);
        resolve(gltf);
      }, undefined, reject);
    }));
  }
  return templateJobs.get(path);
}

function cloneMaterials(root) {
  const made = new Map();
  root.traverse((object) => {
    if (!object.isMesh) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    const next = list.map((material) => {
      if (!material) return material;
      if (!made.has(material)) made.set(material, material.clone());
      return made.get(material);
    });
    object.material = Array.isArray(object.material) ? next : next[0];
  });
  return [...made.values()];
}

function tintVariant(root, variant) {
  const tint = VARIANT_TINT[variant];
  if (!tint) return;
  const color = new THREE.Color(tint);
  let matched = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material?.color || !/(fabric|leather|upholst|seat|cushion)/i.test(material.name || '')) continue;
      material.color.copy(color);
      matched += 1;
    }
  });
  // Some verified exports use intentionally generic material names. In that case
  // tint the first dielectric surface, never glass or metal.
  if (!matched) {
    let done = false;
    root.traverse((object) => {
      if (done || !object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const material = materials.find((entry) => entry?.color && !entry.transparent && (entry.metalness || 0) < 0.45);
      if (material) {
        material.color.copy(color);
        done = true;
      }
    });
  }
}

function markRenderable(root, id) {
  root.userData.placeableId = id;
  root.traverse((object) => {
    if (object.isMesh) {
      object.userData.placeableId = id;
      object.castShadow = false;
      object.receiveShadow = false;
      if (isCollisionProxy(object, root)) object.visible = false;
    }
  });
}

function moveToSelectionLayer(root) {
  root.traverse((object) => object.layers.set(PLACEABLE_SELECTION_LAYER));
}

const MATERIAL_TEXTURE_KEYS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
  'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap',
];

function materialHasTexture(material) {
  return MATERIAL_TEXTURE_KEYS.some((key) => material?.[key]);
}

function materialPaletteKind(material) {
  const emissive = material?.emissive;
  if (emissive && emissive.getHex() !== 0) {
    if (emissive.r > emissive.g * 1.35) return 'emissive-red';
    if (emissive.g > emissive.r * 1.12) return 'emissive-green';
    return 'emissive-warm';
  }
  if (material?.transparent || (material?.opacity ?? 1) < 0.98) return 'glass';
  if ((material?.metalness || 0) >= 0.45) return 'metal';
  const color = material?.color;
  const luminance = color ? color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722 : 1;
  if ((material?.roughness || 0) >= 0.82 && luminance < 0.12) return 'rubber';
  return 'matte';
}

function addMaterialColor(geometry, material) {
  const position = geometry.attributes.position;
  if (!position || !material?.color) return;
  const data = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    data[index * 3] = material.color.r;
    data[index * 3 + 1] = material.color.g;
    data[index * 3 + 2] = material.color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(data, 3));
}

function geometryBatchKey(geometry) {
  const attributes = Object.entries(geometry.attributes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, attribute]) => [name, attribute.itemSize, attribute.normalized, attribute.gpuType || null]);
  return JSON.stringify({ indexed: !!geometry.index, attributes });
}

function authoredVisible(object, root) {
  let current = object;
  while (current && current !== root) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function socketName(meta) {
  return meta.render?.mountSocket || meta.snapPoints?.[0] || 'SOCKET_PLACEMENT';
}

/** Align an authored mount socket to a saved candidate in parent-local yards. */
export function applyPlaceableTransform(root, meta, candidate) {
  root.scale.setScalar(meta.render?.scale || 1);
  root.rotation.set(0, candidate.ry || 0, 0);
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const socket = root.getObjectByName(socketName(meta)) || root.getObjectByName('SOCKET_PLACEMENT');
  const target = new THREE.Vector3(candidate.x, candidate.y || 0, candidate.z);
  if (!socket || socket === root) {
    root.position.copy(target);
    root.updateMatrixWorld(true);
    return false;
  }
  const at = socket.getWorldPosition(new THREE.Vector3());
  root.parent?.worldToLocal(at);
  root.position.add(target.sub(at));
  root.updateMatrixWorld(true);
  return true;
}

function fallbackRoot(meta) {
  const geometry = new THREE.BoxGeometry(meta.bounds.width, meta.bounds.height, meta.bounds.depth);
  const material = new THREE.MeshStandardMaterial({
    color: 0x786b58, roughness: 0.86, transparent: true, opacity: 0.72,
  });
  const mesh = new THREE.Mesh(geometry, material);
  if (meta.defaultTransform.surface === 'wall') mesh.position.y = 0;
  else if (meta.defaultTransform.surface === 'ceiling') mesh.position.y = -meta.bounds.height / 2;
  else mesh.position.y = meta.bounds.height / 2;
  const root = new THREE.Group();
  root.name = `PlaceableFallback_${meta.id}`;
  root.add(mesh);
  return root;
}

async function modelClone(meta, { preview = false, variant = null } = {}) {
  let root;
  let loadError = null;
  try {
    const gltf = await loadTemplate(meta.render.path);
    root = cloneSkinned(gltf.scene);
  } catch (error) {
    loadError = error;
    root = fallbackRoot(meta);
  }
  root.name = `${preview ? 'PlaceablePreview' : 'Placeable'}_${meta.id}`;
  markRenderable(root, meta.id);
  if (preview || VARIANT_TINT[variant]) {
    const materials = cloneMaterials(root);
    root.userData.ownedMaterials = materials;
  }
  if (VARIANT_TINT[variant]) tintVariant(root, variant);
  if (loadError) root.userData.loadError = String(loadError?.message || loadError);
  return root;
}

function previewMaterials(root) {
  const result = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material || result.has(material)) continue;
      material.transparent = true;
      material.opacity = 0.62;
      material.depthWrite = false;
      material.emissive ??= new THREE.Color();
      material.userData.previewBaseEmissive = material.emissive.clone();
      result.add(material);
    }
  });
  return [...result];
}

function releaseOwnedMaterials(root) {
  for (const material of root?.userData?.ownedMaterials || []) material.dispose();
}

function worldCollider(B, object) {
  if (!object.collision?.blocksPlayer && !object.collision?.blocksCustomers) return null;
  const bounds = placementBounds(B.state, object.id, object.transform);
  if (!bounds || !Number.isFinite(bounds.minX)) return null;
  const min = B.L2W(bounds.minX, bounds.minZ);
  const max = B.L2W(bounds.maxX, bounds.maxZ);
  return { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z, furnitureId: object.id };
}

export function buildPlaceables(B, { fixtureAnchors, fallbackWelcomeMat = null } = {}) {
  const { interior, state, addCol, removeCol } = B;
  const group = new THREE.Group();
  group.name = 'ClubhousePlaceables';
  interior.add(group);

  // Final placed props are static until a placement command succeeds. Keep
  // their authored clones as non-rendering selection/pivot sources and rebuild
  // this compact render layer after each committed layout change. That avoids
  // replaying 100+ tiny meshes through every AO/post pass while preserving the
  // exact geometry, materials, sockets, and preview path.
  const renderBatch = new THREE.Group();
  renderBatch.name = 'ClubhousePlaceableRenderBatches';
  group.add(renderBatch);

  const paletteMaterials = new Map();
  function paletteMaterial(kind, source) {
    const key = `${kind}:${source.side}:${source.depthTest}:${source.depthWrite}`;
    if (paletteMaterials.has(key)) return paletteMaterials.get(key);
    const common = {
      name: `Placeable palette ${kind}`,
      color: 0xffffff,
      vertexColors: true,
      side: source.side,
      depthTest: source.depthTest,
      depthWrite: source.depthWrite,
    };
    let material;
    if (kind === 'metal') {
      material = new THREE.MeshStandardMaterial({ ...common, roughness: 0.36, metalness: 0.84 });
    } else if (kind === 'rubber') {
      material = new THREE.MeshStandardMaterial({ ...common, roughness: 0.92, metalness: 0 });
    } else if (kind === 'glass') {
      material = new THREE.MeshPhysicalMaterial({
        ...common,
        roughness: 0.12,
        metalness: 0,
        transparent: true,
        opacity: Math.min(0.32, source.opacity ?? 0.22),
      });
    } else if (kind.startsWith('emissive-')) {
      const emissive = kind === 'emissive-red' ? 0xff5945
        : kind === 'emissive-green' ? 0x76f398 : 0xffeabc;
      material = new THREE.MeshStandardMaterial({
        ...common, roughness: 0.28, metalness: 0, emissive, emissiveIntensity: 1,
      });
    } else {
      material = new THREE.MeshStandardMaterial({ ...common, roughness: 0.64, metalness: 0 });
    }
    paletteMaterials.set(key, material);
    return material;
  }

  const roots = new Map();
  const colliders = new Map();
  const failures = new Map();
  let rebuildToken = 0;
  let disposed = false;

  function clearRenderBatch() {
    for (const child of [...renderBatch.children]) {
      if (child.geometry?.userData?.placeableBatchOwned) child.geometry.dispose();
      child.removeFromParent();
    }
  }

  function rebuildRenderBatch() {
    clearRenderBatch();
    if (disposed || !roots.size) return;
    group.updateMatrixWorld(true);
    const toGroup = group.matrixWorld.clone().invert();
    const buckets = new Map();
    const loose = [];

    for (const [id, root] of roots) {
      if (root.userData.batchVisible === false) continue;
      root.updateMatrixWorld(true);
      root.traverse((object) => {
        if (!object.isMesh || object.isSkinnedMesh || !object.geometry
          || isCollisionProxy(object, root) || !authoredVisible(object, root)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const geometry = object.geometry.clone();
        geometry.applyMatrix4(toGroup.clone().multiply(object.matrixWorld));
        geometry.userData.placeableBatchOwned = true;
        if (materials.length !== 1 || !materials[0] || geometry.groups.length > 1) {
          loose.push({ geometry, material: object.material, ids: [id] });
          return;
        }
        const sourceMaterial = materials[0];
        const usePalette = !root.userData.loadError && !materialHasTexture(sourceMaterial);
        const kind = usePalette ? materialPaletteKind(sourceMaterial) : null;
        const batchMaterial = usePalette ? paletteMaterial(kind, sourceMaterial) : sourceMaterial;
        if (usePalette) addMaterialColor(geometry, sourceMaterial);
        const materialKey = usePalette
          ? `palette:${kind}:${sourceMaterial.side}:${sourceMaterial.depthTest}:${sourceMaterial.depthWrite}`
          : `material:${sourceMaterial.uuid}`;
        const key = `${materialKey}|${geometryBatchKey(geometry)}`;
        if (!buckets.has(key)) buckets.set(key, { material: batchMaterial, geometries: [], ids: [] });
        const bucket = buckets.get(key);
        bucket.geometries.push(geometry);
        bucket.ids.push(id);
      });
    }

    for (const bucket of [...buckets.values(), ...loose]) {
      let geometry = bucket.geometries?.length === 1 ? bucket.geometries[0] : null;
      if (!geometry && bucket.geometries?.length) {
        try {
          geometry = mergeGeometries(bucket.geometries, false);
        } catch {
          geometry = null;
        }
        if (geometry) {
          geometry.userData.placeableBatchOwned = true;
          for (const source of bucket.geometries) source.dispose();
        }
      }
      if (!geometry) {
        for (const source of bucket.geometries || []) {
          const mesh = new THREE.Mesh(source, bucket.material);
          mesh.name = 'PlaceableBatchFallback';
          mesh.userData.placeableIds = [...new Set(bucket.ids || [])];
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          renderBatch.add(mesh);
        }
        if (bucket.geometry) {
          const mesh = new THREE.Mesh(bucket.geometry, bucket.material);
          mesh.name = 'PlaceableBatchLoose';
          mesh.userData.placeableIds = bucket.ids;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          renderBatch.add(mesh);
        }
        continue;
      }
      const mesh = new THREE.Mesh(geometry, bucket.material);
      mesh.name = 'PlaceableMaterialBatch';
      mesh.userData.placeableIds = [...new Set(bucket.ids)];
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      renderBatch.add(mesh);
    }
  }

  function tagFixtureAnchors() {
    for (const [id, anchor] of fixtureAnchors) markRenderable(anchor, id);
  }

  function clearCollider(id) {
    const collider = colliders.get(id);
    if (collider) removeCol(collider);
    colliders.delete(id);
  }

  function syncCollider(object) {
    clearCollider(object.id);
    const collider = worldCollider(B, object);
    if (collider) {
      addCol(collider);
      colliders.set(object.id, collider);
    }
  }

  function removeRoot(id) {
    const root = roots.get(id);
    if (!root) return;
    root.removeFromParent();
    releaseOwnedMaterials(root);
    roots.delete(id);
  }

  async function addRoot(object, token) {
    const meta = placeableById(object.id);
    if (!meta?.render?.path) return null;
    const root = await modelClone(meta, { variant: object.variant });
    if (disposed || token !== rebuildToken || !placedObjects(state).some((entry) => entry.id === object.id)) {
      releaseOwnedMaterials(root);
      return null;
    }
    group.add(root);
    applyPlaceableTransform(root, meta, object.transform);
    root.userData.placeableVariant = object.variant;
    root.userData.batchVisible = true;
    // Preserve the exact authored hierarchy for picking and BoxHelper bounds,
    // while keeping it outside every gameplay camera and post-processing pass.
    // The compact meshes on layer 0 are the sole rendered copies.
    moveToSelectionLayer(root);
    root.visible = true;
    roots.set(object.id, root);
    if (root.userData.loadError) failures.set(object.id, root.userData.loadError);
    if (object.id === 'asset-100' && fallbackWelcomeMat) fallbackWelcomeMat.visible = false;
    rebuildRenderBatch();
    return root;
  }

  function rebuild() {
    const token = ++rebuildToken;
    const objects = placedObjects(state);
    const wanted = new Map(objects.filter((object) => object.render?.kind === 'glb').map((object) => [object.id, object]));
    for (const id of [...roots.keys()]) if (!wanted.has(id)) removeRoot(id);
    for (const id of [...colliders.keys()]) if (!wanted.has(id)) clearCollider(id);
    for (const object of wanted.values()) {
      syncCollider(object);
      let root = roots.get(object.id);
      if (root && root.userData.placeableVariant !== object.variant) {
        removeRoot(object.id);
        root = null;
      }
      if (root) {
        applyPlaceableTransform(root, object, object.transform);
        root.userData.batchVisible = true;
        moveToSelectionLayer(root);
        root.visible = true;
      } else addRoot(object, token);
    }
    rebuildRenderBatch();
    if (fallbackWelcomeMat && !wanted.has('asset-100')) fallbackWelcomeMat.visible = true;
    tagFixtureAnchors();
  }

  async function previewFor(id) {
    const meta = placeableById(id);
    if (!meta) return null;
    let root;
    if (meta.render?.kind === 'fixture-anchor') {
      const source = fixtureAnchors.get(id);
      if (!source) return null;
      root = cloneSkinned(source);
      root.name = `PlaceablePreview_${id}`;
      root.visible = true;
      markRenderable(root, id);
      root.userData.ownedMaterials = cloneMaterials(root);
    } else if (meta.render?.kind === 'glb') {
      root = await modelClone(meta, { preview: true, variant: state.shop.layout?.objects?.[id]?.variant || meta.defaultVariant });
    } else {
      root = fallbackRoot(meta);
      markRenderable(root, id);
      root.userData.ownedMaterials = cloneMaterials(root);
    }
    root.userData.previewMaterials = previewMaterials(root);
    return root;
  }

  function setPreviewValidity(root, ok) {
    if (!root || root.userData.previewValid === ok) return;
    root.userData.previewValid = ok;
    const tint = ok ? VALID : INVALID;
    for (const material of root.userData.previewMaterials || []) {
      const base = material.userData.previewBaseEmissive || new THREE.Color();
      material.emissive.copy(base).lerp(tint, 0.58);
      material.emissiveIntensity = ok ? 0.42 : 0.62;
    }
  }

  function setObjectVisible(id, visible) {
    const root = roots.get(id);
    if (root) {
      root.userData.batchVisible = visible;
      rebuildRenderBatch();
      return;
    }
    const fixture = fixtureAnchors.get(id);
    if (fixture) fixture.visible = visible;
  }

  function rootForObject(id) {
    return roots.get(id) || fixtureAnchors.get(id) || null;
  }

  function selectableRoots() {
    return [
      ...fixtureAnchors.values().filter((root) => root.visible),
      ...roots.values().filter((root) => root.userData.batchVisible !== false),
    ];
  }

  function releasePreview(root) {
    if (!root) return;
    root.removeFromParent();
    releaseOwnedMaterials(root);
  }

  rebuild();

  return {
    group,
    renderBatch,
    rebuild,
    previewFor,
    setPreviewValidity,
    setObjectVisible,
    rootForObject,
    selectableRoots,
    releasePreview,
    diagnostics: () => ({
      expectedPlacedModels: placedObjects(state).filter((object) => object.render?.kind === 'glb').length,
      renderedModels: roots.size,
      colliders: colliders.size,
      failures: [...failures.entries()].map(([id, reason]) => ({ id, reason })),
      cachedTemplates: templateJobs.size,
      sharedCatalogMaterials: sharedCatalogMaterials.size,
      catalogAssets: PLACEABLES.filter((entry) => entry.render?.kind === 'glb').length,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      rebuildToken += 1;
      for (const id of [...colliders.keys()]) clearCollider(id);
      for (const id of [...roots.keys()]) removeRoot(id);
      clearRenderBatch();
      for (const material of paletteMaterials.values()) material.dispose();
      paletteMaterials.clear();
      group.removeFromParent();
    },
  };
}
