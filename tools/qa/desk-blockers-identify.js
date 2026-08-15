// C5 — name the two anonymous colliders that seal the staff strip's west end.
// walk.colliders carries no owner, so the objects are identified by walking the
// interior's scene graph and matching world-XZ footprints against the two boxes.
async (page) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3500);

  return page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three/three.module.js', document.baseURI).href)
      .catch(() => import(new URL('node_modules/three/build/three.module.js', document.baseURI).href));
    const app = window.__fw;
    const interior = app.scene3d.clubhouse().interior;
    const origin = interior.position;
    const targets = [
      { name: 'blockerA', minX: 0.51, maxX: 1.41, minZ: 4.49, maxZ: 5.39 },
      { name: 'blockerB', minX: 1.94, maxX: 2.66, minZ: 4.04, maxZ: 4.76 },
    ];
    const hits = [];
    const box = new THREE.Box3();
    interior.traverse((node) => {
      if (!node.isMesh && !node.isGroup) return;
      if (!node.name) return;
      box.setFromObject(node);
      if (box.isEmpty()) return;
      const lminX = box.min.x - origin.x; const lmaxX = box.max.x - origin.x;
      const lminZ = box.min.z - origin.z; const lmaxZ = box.max.z - origin.z;
      for (const t of targets) {
        const cx = (t.minX + t.maxX) / 2; const cz = (t.minZ + t.maxZ) / 2;
        if (cx < lminX - 0.05 || cx > lmaxX + 0.05) continue;
        if (cz < lminZ - 0.05 || cz > lmaxZ + 0.05) continue;
        const span = (lmaxX - lminX) * (lmaxZ - lminZ);
        if (span > 6) continue; // skip the room-sized parents
        hits.push({
          target: t.name,
          name: node.name,
          parent: node.parent?.name || null,
          grandparent: node.parent?.parent?.name || null,
          local: {
            minX: +lminX.toFixed(2), maxX: +lmaxX.toFixed(2),
            minZ: +lminZ.toFixed(2), maxZ: +lmaxZ.toFixed(2),
            minY: +box.min.y.toFixed(2), maxY: +box.max.y.toFixed(2),
          },
        });
      }
    });
    return { hits: hits.slice(0, 40) };
  });
}
