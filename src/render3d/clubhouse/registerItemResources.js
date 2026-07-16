// Transaction item meshes mix short-lived fallback resources with shared GLB,
// barcode, material and texture caches. Track only identities created for one
// register item so cleanup cannot evict anything owned by the merch pipeline.
export function createRegisterItemResources() {
  const ownedGeometries = new WeakSet();
  const ownedMaterials = new WeakSet();
  const disposedGeometries = new WeakSet();
  const disposedMaterials = new WeakSet();

  return {
    geometry(resource) {
      if (resource) ownedGeometries.add(resource);
      return resource;
    },

    material(resource) {
      if (resource) ownedMaterials.add(resource);
      return resource;
    },

    dispose(root) {
      if (!root || typeof root.traverse !== 'function') return { geometries: 0, materials: 0 };
      const geometries = new Set();
      const materials = new Set();
      root.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) if (material) materials.add(material);
      });

      let geometryCount = 0;
      let materialCount = 0;
      for (const geometry of geometries) {
        if (!ownedGeometries.has(geometry) || disposedGeometries.has(geometry)) continue;
        disposedGeometries.add(geometry);
        geometry.dispose();
        geometryCount++;
      }
      for (const material of materials) {
        if (!ownedMaterials.has(material) || disposedMaterials.has(material)) continue;
        disposedMaterials.add(material);
        material.dispose();
        materialCount++;
      }
      return { geometries: geometryCount, materials: materialCount };
    },
  };
}
