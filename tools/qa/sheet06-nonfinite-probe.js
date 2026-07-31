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
  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const parked = new Set(['rug1', 'plant1', 'poster1', 'board1', 'light1', 'lounge1', 'vac1']);
    for (const [id, entry] of Object.entries(app.state.shop.inventory || {})) {
      if (!entry || typeof entry !== 'object') continue;
      if (parked.has(id)) {
        entry.shelf = 0;
        entry.back = 0;
      } else {
        entry.shelf = Math.max(12, Number(entry.shelf) || 0);
        entry.back = Math.max(6, Number(entry.back) || 0);
      }
    }
    clubhouse.rebuildStock?.();
    clubhouse.rebuildReno?.();
  });
  await page.waitForTimeout(1800);

  const audit = await page.evaluate(() => {
    const scene = window.__fw.scene3d.scene;
    const nonFinite = [];
    const seenGeometries = new Set();
    const firstBad = (array, limit = 12) => {
      const found = [];
      if (!array) return found;
      for (let index = 0; index < array.length && found.length < limit; index += 1) {
        if (!Number.isFinite(array[index])) found.push({ index, value: String(array[index]) });
      }
      return found;
    };
    const pathOf = (object) => {
      const parts = [];
      for (let node = object; node; node = node.parent) parts.push(node.name || node.type || '(anonymous)');
      return parts.reverse().join('/');
    };
    const ancestorsOf = (object) => {
      const values = [];
      for (let node = object; node; node = node.parent) {
        values.push({
          name: node.name || '', type: node.type, uuid: node.uuid,
          position: node.position?.toArray?.() || null,
          rotation: node.rotation?.toArray?.() || null,
          scale: node.scale?.toArray?.() || null,
          userData: node.userData || {},
        });
      }
      return values.reverse();
    };

    scene.traverse((object) => {
      const geometry = object.geometry;
      const attributes = geometry?.attributes || {};
      const attributeFailures = [];
      for (const [name, attribute] of Object.entries(attributes)) {
        const failures = firstBad(attribute?.array);
        if (failures.length) attributeFailures.push({ name, itemSize: attribute.itemSize, count: attribute.count, failures });
      }
      const morphFailures = [];
      for (const [name, entries] of Object.entries(geometry?.morphAttributes || {})) {
        entries.forEach((attribute, index) => {
          const failures = firstBad(attribute?.array);
          if (failures.length) morphFailures.push({ name, index, itemSize: attribute.itemSize, count: attribute.count, failures });
        });
      }
      const matrixFailures = firstBad(object.matrix?.elements);
      const worldMatrixFailures = firstBad(object.matrixWorld?.elements);
      const instanceMatrixFailures = firstBad(object.instanceMatrix?.array);
      if (attributeFailures.length || morphFailures.length || matrixFailures.length
        || worldMatrixFailures.length || instanceMatrixFailures.length) {
        nonFinite.push({
          objectName: object.name,
          objectType: object.type,
          objectUuid: object.uuid,
          path: pathOf(object),
          visible: object.visible,
          isInstancedMesh: object.isInstancedMesh === true,
          instanceCount: object.count ?? null,
          geometryName: geometry?.name || null,
          geometryUuid: geometry?.uuid || null,
          geometryFirstSeen: geometry ? !seenGeometries.has(geometry.uuid) : null,
          material: (Array.isArray(object.material) ? object.material : [object.material])
            .filter(Boolean)
            .map((material) => ({ name: material.name, type: material.type, uuid: material.uuid, userData: material.userData })),
          ancestors: ancestorsOf(object),
          attributeFailures,
          morphFailures,
          matrixFailures,
          worldMatrixFailures,
          instanceMatrixFailures,
          userData: object.userData,
        });
      }
      if (geometry) seenGeometries.add(geometry.uuid);
    });
    return {
      sceneUuid: scene.uuid,
      nonFinite,
      production: (() => {
        const clubhouse = window.__fw.scene3d.clubhouse();
        const production = typeof clubhouse.sheet06Production === 'function'
          ? clubhouse.sheet06Production()
          : clubhouse.sheet06Production;
        return production.diagnostics();
      })(),
    };
  });
  return {
    ok: audit.nonFinite.length === 0,
    capturedAt: new Date().toISOString(),
    ...audit,
  };
}
