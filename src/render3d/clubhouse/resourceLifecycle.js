function rootsOf(input) {
  if (!input) return [];
  return Array.isArray(input) ? input.filter(Boolean) : [input];
}

function texturesIn(material, textures) {
  for (const value of Object.values(material || {})) {
    if (value?.isTexture) textures.add(value);
  }
  for (const uniform of Object.values(material?.uniforms || {})) {
    const value = uniform?.value;
    if (value?.isTexture) textures.add(value);
    if (Array.isArray(value)) {
      for (const item of value) if (item?.isTexture) textures.add(item);
    }
  }
}

export function collectMaterialResources(input) {
  const materials = new Set();
  const textures = new Set();
  const pending = Array.isArray(input) ? [...input] : Object.values(input || {});
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...value);
    } else if (value?.isTexture) {
      textures.add(value);
    } else if (value?.isMaterial) {
      materials.add(value);
      texturesIn(value, textures);
    } else if (value && typeof value === 'object') {
      pending.push(...Object.values(value));
    }
  }
  return { geometries: new Set(), materials, textures };
}

export function mergeRenderableResources(...collections) {
  const merged = { geometries: new Set(), materials: new Set(), textures: new Set() };
  for (const collection of collections) {
    for (const key of Object.keys(merged)) {
      for (const resource of collection?.[key] || []) merged[key].add(resource);
    }
  }
  return merged;
}

// A clubhouse is rebuilt in-place when the course structure layer changes.
// Capture every render resource reachable from its roots before those roots are
// detached; otherwise Three's renderer keeps the uploaded geometry and canvas
// textures alive even though the Object3D tree is no longer in the scene.
export function collectRenderableResources(input) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  for (const root of rootsOf(input)) {
    if (typeof root.traverse !== 'function') continue;
    root.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material) continue;
        materials.add(material);
        texturesIn(material, textures);
      }
    });
  }
  return { geometries, materials, textures };
}

export function disposeRenderableResources(resources, protectedResources = null) {
  const protectedGeometries = protectedResources?.geometries || new Set();
  const protectedMaterials = protectedResources?.materials || new Set();
  const protectedTextures = protectedResources?.textures || new Set();
  const disposed = { geometries: 0, materials: 0, textures: 0 };

  for (const texture of resources?.textures || []) {
    if (protectedTextures.has(texture) || typeof texture.dispose !== 'function') continue;
    texture.dispose();
    disposed.textures += 1;
  }
  for (const material of resources?.materials || []) {
    if (protectedMaterials.has(material) || typeof material.dispose !== 'function') continue;
    material.dispose();
    disposed.materials += 1;
  }
  for (const geometry of resources?.geometries || []) {
    if (protectedGeometries.has(geometry) || typeof geometry.dispose !== 'function') continue;
    geometry.dispose();
    disposed.geometries += 1;
  }
  return disposed;
}
