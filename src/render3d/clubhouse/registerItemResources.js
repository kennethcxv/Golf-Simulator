// Transaction item meshes mix short-lived fallback resources with shared GLB,
// barcode, material and texture caches. Track only identities created for one
// register item so cleanup cannot evict anything owned by the merch pipeline.
export function createRegisterItemResources() {
  const ownedGeometries = new WeakSet();
  const ownedMaterials = new WeakSet();
  const ownedTextures = new WeakSet();
  const disposedGeometries = new WeakSet();
  const disposedMaterials = new WeakSet();
  const disposedTextures = new WeakSet();
  // Only failed identities are held strongly. Customer removal is allowed to
  // drop its product root after an AggregateError; these sets preserve the
  // exact retry authority until a later cleanup or register teardown succeeds.
  const retainedGeometries = new Set();
  const retainedMaterials = new Set();
  const retainedTextures = new Set();
  let disposalErrors = 0;

  const status = () => ({
    retainedGeometries: retainedGeometries.size,
    retainedMaterials: retainedMaterials.size,
    retainedTextures: retainedTextures.size,
    retainedResources: retainedGeometries.size + retainedMaterials.size + retainedTextures.size,
    disposalErrors,
  });

  const dispose = (root, { onError = null } = {}) => {
    const hasRoot = root && typeof root.traverse === 'function';
    if (!hasRoot && status().retainedResources === 0) return { geometries: 0, materials: 0 };
    const geometries = new Set(retainedGeometries);
    const materials = new Set(retainedMaterials);
    const textures = new Set(retainedTextures);
    if (hasRoot) root.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });

    let geometryCount = 0;
    let materialCount = 0;
    const failures = [];
    const release = (kind, resource, retained, disposedSet, operation) => {
      try {
        operation();
        retained.delete(resource);
        disposedSet.add(resource);
        return true;
      } catch (error) {
        disposalErrors += 1;
        retained.add(resource);
        const failure = { kind, resource, error };
        failures.push(failure);
        if (typeof onError === 'function') {
          // Reporting is diagnostic, not part of the ownership operation. A
          // broken reporter must not turn one failed disposal into abandoned
          // siblings, so contain it in the local failure journal as well.
          try {
            onError(failure);
          } catch (reportError) {
            failures.push({ kind: 'onError', resource, error: reportError, cause: error });
          }
        }
        return false;
      }
    };
    for (const geometry of geometries) {
      if (!ownedGeometries.has(geometry) || disposedGeometries.has(geometry)) {
        retainedGeometries.delete(geometry);
        continue;
      }
      if (release(
        'geometry', geometry, retainedGeometries, disposedGeometries, () => geometry.dispose(),
      )) geometryCount++;
    }
    for (const material of materials) {
      if (!ownedMaterials.has(material) || disposedMaterials.has(material)) {
        retainedMaterials.delete(material);
        continue;
      }
      if (release(
        'material', material, retainedMaterials, disposedMaterials, () => material.dispose(),
      )) materialCount++;
    }
    for (const texture of textures) {
      if (!ownedTextures.has(texture) || disposedTextures.has(texture)) {
        retainedTextures.delete(texture);
        continue;
      }
      release('texture', texture, retainedTextures, disposedTextures, () => texture.dispose());
    }
    if (failures.length && typeof onError !== 'function') {
      throw new AggregateError(
        failures.map((failure) => failure.error),
        'Register item resource disposal failed after exhausting owned siblings.',
      );
    }
    return { geometries: geometryCount, materials: materialCount };
  };

  return {
    geometry(resource) {
      if (resource) ownedGeometries.add(resource);
      return resource;
    },

    material(resource) {
      if (resource) ownedMaterials.add(resource);
      return resource;
    },

    texture(resource) {
      if (resource) ownedTextures.add(resource);
      return resource;
    },

    dispose,
    retry: (options = {}) => dispose(null, options),
    status,
  };
}
