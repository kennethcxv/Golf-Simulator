const ownedGeometries = new WeakSet();
const ownedMaterials = new WeakSet();

export function ownGeometry(geometry) {
  if (geometry) ownedGeometries.add(geometry);
  return geometry;
}

export function ownMaterial(material) {
  if (material) ownedMaterials.add(material);
  return material;
}

// Dispose only resources explicitly minted for this dynamic tree. Cached GLB
// primitives and shared material kits can sit alongside them safely.
export function disposeOwnedTree(root) {
  const disposed = { geometries: 0, materials: 0 };
  if (!root || !root.traverse) return disposed;
  root.traverse((node) => {
    const geometry = node.geometry;
    if (geometry && ownedGeometries.has(geometry)) {
      ownedGeometries.delete(geometry);
      geometry.dispose();
      disposed.geometries++;
    }
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material || !ownedMaterials.has(material)) continue;
      ownedMaterials.delete(material);
      material.dispose();
      disposed.materials++;
    }
  });
  return disposed;
}
