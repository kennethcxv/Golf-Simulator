async (page) => {
  // Identify exactly which meshes and materials render the maroon entrance
  // leaves in the pine-hills dilapidated start.
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  return page.evaluate(async () => {
    const THREE = await import('three');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const origin = clubhouse.interior.position;
    const door = { x: origin.x - 0.8, z: origin.z + 6.0 };
    const hits = [];
    app.scene3d.scene.traverse((node) => {
      if (!node.isMesh || !node.visible) return;
      const box = new THREE.Box3().setFromObject(node);
      if (box.isEmpty()) return;
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      if (Math.hypot(cx - door.x, cz - door.z) > 2.2) return;
      const size = box.getSize(new THREE.Vector3());
      if (size.y < 0.8) return; // leaves are tall
      const material = Array.isArray(node.material) ? node.material[0] : node.material;
      const color = material?.color ? `#${material.color.getHexString()}` : null;
      // Reddish materials only — the maroon suspects.
      hits.push({
        name: node.name || '(anon)',
        parentChain: (() => {
          const chain = [];
          let p = node.parent;
          while (p && chain.length < 5) { chain.push(p.name || '(anon)'); p = p.parent; }
          return chain.join(' < ');
        })(),
        material: material?.name || null,
        color,
        size: { x: +size.x.toFixed(2), y: +size.y.toFixed(2), z: +size.z.toFixed(2) },
      });
    });
    return hits.slice(0, 24);
  });
}
