async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const screenshot = path.resolve(process.env.CONSTRUCTION_FLOOR_VISUAL_OUT
    || path.join(process.cwd(), 'qa', 'construction-floor-visual.png'));
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(async () => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const production = clubhouse?.sheet06Production;
    if (!production) return false;
    try { await production.ready; } catch { return false; }
    return production.diagnostics().activationStatus === 'active';
  }, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const app = window.__fw;
    app.state.cash = 10_000_000;
    const construction = await import('/src/sim/constructionFinishes.js');
    construction.purchaseConstructionFinish(app.state, 'flooring', 'herringbone', 'luxury');
    app.scene3d.clubhouse().rebuildReno();
  });
  await page.waitForFunction(() => {
    const production = window.__fw.scene3d.clubhouse().sheet06Production;
    const floor = production.diagnostics().assembly?.floor;
    return floor?.selectedVariant === 'construction_herringbone_luxury' && floor.damageVisible === false;
  }, null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const origin = clubhouse.interior.position;
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.state.x = origin.x - 0.35;
    walk.state.z = origin.z + 2.4;
    walk.state.yaw = 0;
    walk.state.pitch = -0.55;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
  });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: screenshot });
  return page.evaluate((screenshotPath) => {
    const production = window.__fw.scene3d.clubhouse().sheet06Production;
    const floor = production.getAssemblyRoot(59)?.children?.find((node) => node.isInstancedMesh);
    return {
      ok: production.diagnostics().activationStatus === 'active'
        && production.diagnostics().assembly?.floor?.selectedVariant === 'construction_herringbone_luxury',
      screenshot: screenshotPath,
      diagnostics: production.diagnostics().assembly?.floor,
      material: (Array.isArray(floor?.material) ? floor.material : [floor?.material]).filter(Boolean).map((entry) => ({
        name: entry.name,
        color: entry.color?.getHexString?.() || null,
        roughness: entry.roughness,
      })),
    };
  }, screenshot);
}
