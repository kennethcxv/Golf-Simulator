// Inventory displays are rebuilt frequently, but some meshes inside them can still
// reference cached merch resources. This tracker makes ownership explicit: callers
// opt in only resources created for the rebuildable stock layer, and replacement
// cleanup never guesses from material/geometry shape or reference count.
export function createOwnedStockResources() {
  const geometries = new WeakSet();
  const materials = new WeakSet();

  const geometry = (resource) => {
    if (resource) geometries.add(resource);
    return resource;
  };

  const material = (resource) => {
    if (resource) materials.add(resource);
    return resource;
  };

  function snapshotGeometries(root) {
    const found = new Set();
    root.traverse((object) => {
      if (object.isMesh && object.geometry) found.add(object.geometry);
    });
    return found;
  }

  function ownNewGeometries(root, priorGeometries) {
    root.traverse((object) => {
      if (object.isMesh && object.geometry && !priorGeometries.has(object.geometry)) {
        geometry(object.geometry);
      }
    });
  }

  function dispose(root) {
    let disposedGeometries = 0;
    let disposedMaterials = 0;
    root.traverse((object) => {
      if (object.geometry && geometries.has(object.geometry)) {
        object.geometry.dispose();
        geometries.delete(object.geometry);
        disposedGeometries++;
      }
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const objectMaterial of objectMaterials) {
        if (!objectMaterial || !materials.has(objectMaterial)) continue;
        objectMaterial.dispose();
        materials.delete(objectMaterial);
        disposedMaterials++;
      }
    });
    return { geometries: disposedGeometries, materials: disposedMaterials };
  }

  return {
    geometry,
    material,
    snapshotGeometries,
    ownNewGeometries,
    dispose,
  };
}
