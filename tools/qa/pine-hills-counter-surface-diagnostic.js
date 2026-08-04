async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const outDir = path.join(repoRoot, 'qa', 'pine-hills-clubhouse', 'diagnostics');
  fs.mkdirSync(outDir, { recursive: true });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(baseUrl);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 45000 });
  await page.evaluate(async () => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    await Promise.all([
      clubhouse.pineHillsInterior?.ready,
      clubhouse.assets51to100Runtime?.ready,
    ].filter(Boolean));
  });
  await page.waitForTimeout(1000);

  const result = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = window.__fw.scene3d.clubhouse();
    const interior = clubhouse.interior;
    interior.updateMatrixWorld(true);

    const lineage = (object) => {
      const names = [];
      let current = object;
      while (current && current !== interior.parent) {
        if (current.name) names.push(current.name);
        current = current.parent;
      }
      return names;
    };
    const materials = (object) => (Array.isArray(object.material)
      ? object.material
      : [object.material]).filter(Boolean).map((material) => ({
      name: material.name || null,
      type: material.type,
      color: material.color?.getHexString?.() || null,
      polygonOffset: !!material.polygonOffset,
      polygonOffsetFactor: material.polygonOffsetFactor || 0,
      polygonOffsetUnits: material.polygonOffsetUnits || 0,
    }));

    const probes = [];
    for (const localX of [-2.05, -1.55, -1.05, -0.55, 0, 0.55, 1.05, 1.55, 2.05]) {
      const deskPoint = layout.frontDeskPoint(localX, 0);
      const rayOrigin = new THREE.Vector3(deskPoint.x, 4, deskPoint.z);
      interior.localToWorld(rayOrigin);
      const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, 8);
      const intersections = raycaster.intersectObject(interior, true)
        .map((hit) => ({ hit, local: interior.worldToLocal(hit.point.clone()) }))
        .filter(({ local }) => local.y >= 0.80 && local.y <= 1.25)
        .map(({ hit, local }) => ({
          object: hit.object.name || '(unnamed)',
          lineage: lineage(hit.object),
          localPoint: [local.x, local.y, local.z],
          distance: hit.distance,
          renderOrder: hit.object.renderOrder || 0,
          materials: materials(hit.object),
        }));
      probes.push({ localX, localZ: 0, intersections });
    }

    const counterNodes = [];
    interior.traverse((object) => {
      const chain = lineage(object).join('/');
      if (!/counter|front.?desk|checkout.?task|staging|handoff/i.test(chain)) return;
      counterNodes.push({
        name: object.name || '(unnamed)',
        type: object.type,
        visible: object.visible,
        layers: object.layers?.mask ?? null,
        lineage: lineage(object),
        materials: object.isMesh ? materials(object) : [],
      });
    });

    return {
      probes,
      counterNodes,
      propDiagnostics: clubhouse.assets51to100Runtime?.diagnostics?.() || null,
    };
  });

  fs.writeFileSync(
    path.join(outDir, 'counter-surface-diagnostic.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
}
