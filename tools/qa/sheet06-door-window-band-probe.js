async (page) => {
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.scene, null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    if (!production) return false;
    try { await production.ready; } catch { return false; }
    return production.diagnostics?.().activationStatus === 'active';
  }, null, { timeout: 90000 });

  return page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const pathOf = (object) => {
      const parts = [];
      for (let node = object; node; node = node.parent) parts.push(node.name || node.type || '(anonymous)');
      return parts.reverse().join('/');
    };
    const visibilityChain = (object) => {
      const result = [];
      for (let node = object; node; node = node.parent) {
        result.push({ name: node.name || node.type || '(anonymous)', visible: node.visible });
      }
      return result.reverse();
    };
    const meshRecord = (object) => {
      object.geometry?.computeBoundingBox?.();
      return {
        name: object.name,
        path: pathOf(object),
        visible: object.visible,
        effectivelyVisible: visibilityChain(object).every((entry) => entry.visible),
        visibilityChain: visibilityChain(object),
        material: (Array.isArray(object.material) ? object.material : [object.material])
          .filter(Boolean)
          .map((material) => ({
            name: material.name,
            type: material.type,
            color: material.color?.toArray?.() || null,
            roughness: material.roughness ?? null,
            metalness: material.metalness ?? null,
          })),
        localBounds: object.geometry?.boundingBox ? {
          min: object.geometry.boundingBox.min.toArray(),
          max: object.geometry.boundingBox.max.toArray(),
        } : null,
        worldMatrix: object.matrixWorld?.toArray?.() || null,
        userData: object.userData || {},
      };
    };
    const matchingMeshes = (root, predicate) => {
      const result = [];
      root?.updateMatrixWorld?.(true);
      root?.traverse?.((object) => {
        if (object.isMesh && predicate(object)) result.push(meshRecord(object));
      });
      return result;
    };

    const damageRoot = production.getRoot(52);
    const doorRoot = production.getRoot(53);
    const windowRoot = production.getAssemblyRoot(55);
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      architecture: JSON.parse(JSON.stringify(app.state.shop.reno.architecture)),
      production: production.diagnostics(),
      asset52BoardedApertures: matchingMeshes(
        damageRoot,
        (object) => object.name === 'MESH_BoardedApertureDamage',
      ),
      asset53GlazingStructure: matchingMeshes(
        doorRoot,
        (object) => /(?:Glass|Muntins|Sash|WalnutStructure)$/.test(object.name),
      ),
      asset55StandardWindowStructure: matchingMeshes(
        windowRoot,
        (object) => /WindowStandard_(?:UpperLowerGlass|WalnutDoubleSashes|WalnutMuntinGrid)$/.test(object.name),
      ),
    };
  });
}
