import { closeTextureImages } from './clubhouse/resourceLifecycle.js';

function emptyResources() {
  return {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
    instancedMeshes: new Set(),
    skeletons: new Set(),
    renderTargets: new Set(),
  };
}

function collectUniformTextures(value, textures) {
  if (!value) return;
  if (value.isTexture) {
    textures.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectUniformTextures(entry, textures);
  }
}

function collectMaterial(material, resources) {
  if (!material) return;
  resources.materials.add(material);
  for (const value of Object.values(material)) if (value?.isTexture) resources.textures.add(value);
  if (material.uniforms) {
    for (const uniform of Object.values(material.uniforms)) {
      collectUniformTextures(uniform?.value, resources.textures);
    }
  }
}

export function collectSceneResources(root, resources = emptyResources()) {
  if (!root) return resources;
  if (root.background?.isTexture) resources.textures.add(root.background);
  if (root.environment?.isTexture) resources.textures.add(root.environment);
  root.traverse?.((object) => {
    if (object.geometry) resources.geometries.add(object.geometry);
    if (object.isInstancedMesh && typeof object.dispose === 'function') resources.instancedMeshes.add(object);
    if (object.skeleton && typeof object.skeleton.dispose === 'function') resources.skeletons.add(object.skeleton);
    if (object.renderTarget?.isWebGLRenderTarget) resources.renderTargets.add(object.renderTarget);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) collectMaterial(material, resources);
  });
  return resources;
}

export function mergeSceneResources(...collections) {
  const merged = emptyResources();
  for (const collection of collections) {
    for (const key of Object.keys(merged)) {
      for (const resource of collection?.[key] || []) merged[key].add(resource);
    }
  }
  return merged;
}

function targetTextures(targets) {
  const textures = new Set();
  for (const target of targets) {
    if (target?.texture) {
      const list = Array.isArray(target.texture) ? target.texture : [target.texture];
      for (const texture of list) textures.add(texture);
    }
    if (target?.depthTexture) textures.add(target.depthTexture);
  }
  return textures;
}

export function disposeSceneResources(root, {
  protectedResources = null,
  extraResources = null,
} = {}) {
  const resources = mergeSceneResources(collectSceneResources(root), extraResources);
  const protectedSets = mergeSceneResources(protectedResources);
  const disposed = {
    geometries: 0,
    materials: 0,
    textures: 0,
    imageBitmaps: 0,
    instancedMeshes: 0,
    skeletons: 0,
    renderTargets: 0,
  };

  for (const object of resources.instancedMeshes) {
    if (protectedSets.instancedMeshes.has(object) || typeof object.dispose !== 'function') continue;
    object.dispose();
    disposed.instancedMeshes += 1;
  }
  for (const skeleton of resources.skeletons) {
    if (protectedSets.skeletons.has(skeleton) || typeof skeleton.dispose !== 'function') continue;
    skeleton.dispose();
    disposed.skeletons += 1;
  }

  const ownedTargets = new Set();
  for (const target of resources.renderTargets) {
    if (protectedSets.renderTargets.has(target) || typeof target.dispose !== 'function') continue;
    ownedTargets.add(target);
    target.dispose();
    disposed.renderTargets += 1;
  }
  const renderTargetTextures = targetTextures(ownedTargets);
  const protectedTargetTextures = targetTextures(protectedSets.renderTargets);
  const closedImages = new Set();
  for (const texture of resources.textures) {
    if (protectedSets.textures.has(texture) || protectedTargetTextures.has(texture)
      || renderTargetTextures.has(texture) || typeof texture.dispose !== 'function') continue;
    disposed.imageBitmaps += closeTextureImages(texture, closedImages);
    texture.dispose();
    disposed.textures += 1;
  }
  for (const material of resources.materials) {
    if (protectedSets.materials.has(material) || typeof material.dispose !== 'function') continue;
    material.dispose();
    disposed.materials += 1;
  }
  for (const geometry of resources.geometries) {
    if (protectedSets.geometries.has(geometry) || typeof geometry.dispose !== 'function') continue;
    geometry.dispose();
    disposed.geometries += 1;
  }
  return disposed;
}
