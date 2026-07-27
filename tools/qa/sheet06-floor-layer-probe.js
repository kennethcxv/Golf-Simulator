async (page) => {
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
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
  await page.waitForTimeout(500);

  const audit = await page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    scene.updateMatrixWorld(true);

    const pathOf = (object) => {
      const parts = [];
      for (let node = object; node; node = node.parent) parts.push(node.name || node.type || '(anonymous)');
      return parts.reverse().join('/');
    };
    const transform = (point, elements) => {
      const [x, y, z] = point;
      const w = elements[3] * x + elements[7] * y + elements[11] * z + elements[15];
      return [
        (elements[0] * x + elements[4] * y + elements[8] * z + elements[12]) / w,
        (elements[1] * x + elements[5] * y + elements[9] * z + elements[13]) / w,
        (elements[2] * x + elements[6] * y + elements[10] * z + elements[14]) / w,
      ];
    };
    const worldBounds = (object, instanceIndex = null) => {
      object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox;
      if (!bounds) return null;
      const instance = instanceIndex === null
        ? null
        : Array.from(object.instanceMatrix.array.slice(instanceIndex * 16, instanceIndex * 16 + 16));
      const points = [];
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const local = instance ? transform([x, y, z], instance) : [x, y, z];
            points.push(transform(local, object.matrixWorld.elements));
          }
        }
      }
      return {
        min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))),
        max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))),
      };
    };
    const materialInfo = (object) => (Array.isArray(object.material) ? object.material : [object.material])
      .filter(Boolean)
      .map((material) => ({
        name: material.name || '',
        color: material.color?.getHexString?.() || null,
        roughness: material.roughness ?? null,
        map: material.map?.name || material.map?.source?.data?.currentSrc || material.map?.source?.data?.src || null,
        polygonOffset: material.polygonOffset ?? false,
        polygonOffsetFactor: material.polygonOffsetFactor ?? 0,
        polygonOffsetUnits: material.polygonOffsetUnits ?? 0,
      }));

    const candidates = [];
    scene.traverse((object) => {
      if (!object.isMesh || !object.geometry) return;
      const path = pathOf(object);
      const named = /Floor|Foundation|Slab|Asset_59|ASSET_59/i.test(path);
      const count = object.isInstancedMesh ? object.count : 1;
      const sampleIndexes = object.isInstancedMesh
        ? [...new Set([0, Math.floor(count / 2), Math.max(0, count - 1)])]
        : [null];
      const bounds = sampleIndexes.map((index) => ({ index, bounds: worldBounds(object, index) }));
      const nearWalkPlane = bounds.some(({ bounds: box }) => box && box.max[1] >= 0.25 && box.min[1] <= 0.35);
      if (!named && !nearWalkPlane) return;
      candidates.push({
        name: object.name || '',
        path,
        visible: object.visible,
        ancestorVisible: (() => {
          for (let node = object; node; node = node.parent) if (node.visible === false) return false;
          return true;
        })(),
        isInstancedMesh: object.isInstancedMesh === true,
        count,
        geometryName: object.geometry.name || '',
        localBounds: (() => {
          object.geometry.computeBoundingBox();
          const box = object.geometry.boundingBox;
          return box ? { min: box.min.toArray(), max: box.max.toArray() } : null;
        })(),
        sampledWorldBounds: bounds,
        material: materialInfo(object),
        userData: object.userData || {},
      });
    });

    const floorRoot = production.getAssemblyRoot?.(59) || clubhouse.sheet06Production?.getAssemblyRoot?.(59) || null;
    return {
      production: production.diagnostics(),
      floorRoot: floorRoot ? {
        name: floorRoot.name,
        visible: floorRoot.visible,
        path: pathOf(floorRoot),
        childNames: floorRoot.children.map((child) => child.name),
      } : null,
      candidates,
    };
  });

  return {
    ok: Boolean(audit.floorRoot) && audit.candidates.length > 0,
    capturedAt: new Date().toISOString(),
    ...audit,
  };
}
