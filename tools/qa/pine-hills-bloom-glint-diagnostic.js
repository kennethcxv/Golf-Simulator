async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const out = path.join(repo, 'qa', 'pine-hills-clubhouse', 'diagnostics', 'bloom-glints');
  fs.mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/');
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  await page.evaluate(async () => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    await Promise.all([
      clubhouse.pineHillsInterior?.ready,
      clubhouse.sheet07Production?.ready,
      clubhouse.modernClubhouse?.ready,
    ].filter(Boolean));
    const origin = clubhouse.interior.position;
    const walk = window.__fw.scene3d.walk;
    walk.state.x = origin.x - 3.3;
    walk.state.z = origin.z + 2.15;
    const dx = -5.25 - (-3.3);
    const dz = 6.25 - 2.15;
    walk.state.yaw = Math.atan2(-dx, -dz);
    walk.state.pitch = Math.atan2(1.68 - 1.62, Math.hypot(dx, dz));
    window.__fw.state.clock.minutes = 14 * 60;
    window.__fw.scene3d.applyTimeWeather?.(14 * 60, window.__fw.state.weather);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, '01-bloom-on.png') });
  const bloom = await page.evaluate(() => {
    const pass = window.__fw.scene3d.post?.bloom;
    const before = { strength: pass?.strength, radius: pass?.radius, threshold: pass?.threshold };
    if (pass) pass.strength = 0;
    return before;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '02-bloom-off.png') });
  const glassMaterials = await page.evaluate(() => {
    const rows = new Map();
    window.__fw.scene3d.scene.traverse((object) => {
      if (!object.isMesh || !/glass|glaz/i.test(`${object.name} ${object.material?.name || ''}`)) return;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material || rows.has(material.uuid)) continue;
        rows.set(material.uuid, {
          object: object.name,
          name: material.name,
          type: material.type,
          roughness: material.roughness,
          metalness: material.metalness,
          opacity: material.opacity,
          transmission: material.transmission,
          envMapIntensity: material.envMapIntensity,
        });
      }
    });
    return [...rows.values()];
  });
  await page.evaluate(() => {
    window.__fw.scene3d.scene.traverse((object) => {
      if (!object.isMesh) return;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (material?.name !== 'MAT_MCP_ClearStorefrontGlass') continue;
        material.roughness = 0.34;
        material.envMapIntensity = 0.20;
        material.needsUpdate = true;
      }
    });
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '03-restrained-storefront-glass.png') });
  const officeReveal = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const origin = clubhouse.interior.position;
    const walk = window.__fw.scene3d.walk;
    walk.state.x = origin.x + 8.9;
    walk.state.z = origin.z + 4.15;
    walk.state.yaw = 0;
    walk.state.pitch = Math.atan2(1.42 - 1.62, 2.15);
    const header = clubhouse.interior.getObjectByName('PineHillsOfficeReveal_HeaderInfill');
    return header ? { depth: header.scale.z, z: header.position.z } : null;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '04-office-reveal-current.png') });
  await page.evaluate(() => {
    const header = window.__fw.scene3d.clubhouse().interior
      .getObjectByName('PineHillsOfficeReveal_HeaderInfill');
    if (header) header.scale.z = 0.42;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '05-office-reveal-flush-header.png') });
  return { ok: true, bloom, glassMaterials, officeReveal };
}
