async (page) => {
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForTimeout(1600);
  return page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const clubhouse = window.__fw.scene3d.clubhouse();
    const offset = clubhouse.interior.position;
    clubhouse.interior.updateMatrixWorld(true);
    const rows = [];
    clubhouse.interior.traverse((object) => {
      if (!object.isMesh || !object.visible) return;
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3()).sub(offset);
      const size = box.getSize(new THREE.Vector3());
      if (center.x < 2.10 || center.x > 4.20 || center.z < 3.55 || center.z > 4.85) return;
      if (center.y < 0.92 || center.y > 1.30 || size.y > 0.28) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      rows.push({
        name: object.name,
        parent: object.parent?.name || '',
        grandparent: object.parent?.parent?.name || '',
        kind: object.userData?.kind || '',
        center: { x: center.x, y: center.y, z: center.z },
        size: { x: size.x, y: size.y, z: size.z },
        colors: materials.map((material) => material?.color ? `#${material.color.getHexString()}` : null),
      });
    });
    return rows.sort((a, b) => b.size.x * b.size.z - a.size.x * a.size.z);
  });
}
