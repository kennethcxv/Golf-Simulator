async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8469/';
  const OUT = path.resolve(process.env.CONSTRUCTION_LIGHTING_QA_OUT
    || path.join(process.cwd(), 'qa', 'construction-lighting-purchase'));
  fs.mkdirSync(OUT, { recursive: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText || 'unknown';
    if (reason !== 'net::ERR_ABORTED') errors.push(`requestfailed: ${request.url()} (${reason})`);
  });

  const boot = async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(1000);
    await page.getByText('Continue', { exact: true }).click().catch(() => {});
    await page.waitForFunction(async () => {
      const production = window.__fw?.scene3d?.clubhouse?.()?.sheet06Production;
      if (!production) return false;
      try { await production.ready; } catch { return false; }
      return production.diagnostics().activationStatus === 'active';
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
  };

  const lightingSnapshot = () => page.evaluate(() => {
    const app = window.__fw;
    const production = app.scene3d.clubhouse().sheet06Production;
    const selection = app.state.shop.reno.constructionFinishes.installed.lighting;
    const indoorRoot = production.getAssemblyRoot(58);
    const exteriorRoot = production.getRoot(51);
    const diagnostics = production.diagnostics();
    const indoorMaterials = new Set();
    let visibleIndoorBatchCount = 0;
    let visibleIndoorPlacementCount = 0;
    indoorRoot?.traverse?.((node) => {
      if (!node.isMesh || !node.visible
        || node.userData?.sheet06SelectedVariant !== diagnostics.assembly?.lighting?.selectedVariant) return;
      let ancestor = node.parent;
      while (ancestor) {
        if (ancestor.visible === false) return;
        ancestor = ancestor.parent;
      }
      visibleIndoorBatchCount += 1;
      visibleIndoorPlacementCount = Math.max(visibleIndoorPlacementCount, node.count || 1);
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (material?.name) indoorMaterials.add(material.name);
      }
    });
    const landscapeMaterials = new Set();
    let visibleLandscapeMeshCount = 0;
    exteriorRoot?.traverse?.((node) => {
      if (!node.isMesh || !node.visible) return;
      let ancestor = node;
      let variant = null;
      while (ancestor) {
        if (ancestor.visible === false) return;
        if (!variant && ancestor.userData?.construction_lighting_variant) {
          variant = ancestor.userData.construction_lighting_variant;
        }
        ancestor = ancestor.parent;
      }
      if (!variant) return;
      visibleLandscapeMeshCount += 1;
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (material?.name) landscapeMaterials.add(material.name);
      }
    });
    return {
      cash: app.state.cash,
      worksExpense: app.state.ledger?.today?.expense?.works || 0,
      selection: { ...selection },
      owned: app.state.shop.reno.constructionFinishes.owned
        .includes(`lighting:${selection.finishId}:${selection.qualityId}`),
      indoor: diagnostics.assembly?.lighting || null,
      landscape: diagnostics.landscapeLighting || null,
      visibleIndoorBatchCount,
      visibleIndoorPlacementCount,
      visibleLandscapeMeshCount,
      indoorMaterials: [...indoorMaterials].sort(),
      landscapeMaterials: [...landscapeMaterials].sort(),
    };
  });

  const setCamera = async (mode) => {
    await page.evaluate((cameraMode) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      if (cameraMode === 'ceiling') {
        walk.state.x = origin.x - 0.6;
        walk.state.z = origin.z + 2.6;
        walk.state.yaw = 0;
        walk.state.pitch = 0.44;
      } else if (cameraMode === 'wall') {
        const at = [0, -1.2];
        const target = [0, -6.2];
        walk.state.x = origin.x + at[0];
        walk.state.z = origin.z + at[1];
        walk.state.yaw = Math.atan2(-(target[0] - at[0]), -(target[1] - at[1]));
        walk.state.pitch = 0.12;
      } else {
        const at = [-1.5, 13.5];
        const target = [-1.5, 6.65];
        walk.state.x = origin.x + at[0];
        walk.state.z = origin.z + at[1];
        walk.state.yaw = Math.atan2(-(target[0] - at[0]), -(target[1] - at[1]));
        walk.state.pitch = 0.02;
      }
      const minutes = cameraMode === 'landscape' ? 17 * 60 : 14 * 60;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + minutes;
      app.scene3d.applyTimeWeather?.(minutes, app.state.weather);
    }, mode);
    await page.waitForTimeout(1800);
  };

  const sitAtLaptop = async () => {
    await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + 8.45;
      walk.state.z = origin.z + 4.5;
      walk.state.yaw = -Math.PI / 2;
      walk.state.pitch = -0.05;
    });
    await page.waitForFunction(() => /laptop/i.test(document.querySelector('.shop-prompt')?.textContent || ''), null, { timeout: 10000 });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
    await page.waitForFunction(() => document.querySelector('.lt-frame')?.getBoundingClientRect().width > 100, null, { timeout: 15000 });
  };

  const purchase = async (finishLabel, finishId, expectedVariant, offerScreenshot) => {
    await sitAtLaptop();
    await page.locator('.lt-navbtn').filter({ hasText: 'Upgrades' }).click();
    await page.locator('.lt-tab').filter({ hasText: /^Clubhouse$/ }).click();
    await page.locator('.lt-tab').filter({ hasText: /^Lighting$/ }).click();
    await page.locator('.lt-tab').filter({ hasText: /^Luxury country club$/ }).click();
    const order = page.locator('.lt-order').filter({
      has: page.locator('.lt-ordername', { hasText: new RegExp(`^${finishLabel}$`) }),
    });
    await order.scrollIntoViewIfNeeded();
    if (offerScreenshot) await page.screenshot({ path: path.join(OUT, offerScreenshot) });
    await order.locator('button').filter({ hasText: /^(Buy|Install)/ }).click();
    await page.locator('.lt-confirm .lt-primary').filter({ hasText: /^(Purchase finish|Install it)$/ }).click();
    await page.waitForFunction(({ id, variant }) => {
      const app = window.__fw;
      const selection = app.state.shop.reno.constructionFinishes.installed.lighting;
      const lighting = app.scene3d.clubhouse().sheet06Production.diagnostics().assembly?.lighting;
      return selection.finishId === id && selection.qualityId === 'luxury'
        && lighting?.selectedVariant === variant;
    }, { id: finishId, variant: expectedVariant }, { timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
  };

  await boot();
  await page.evaluate(() => { window.__fw.state.cash = Math.max(window.__fw.state.cash, 1_000_000); });
  const before = await lightingSnapshot();
  await setCamera('ceiling');
  await page.screenshot({ path: path.join(OUT, '01-municipal-led-panels.png') });

  await purchase('Luxury chandeliers', 'luxury-chandeliers', 'construction_luxury_chandeliers_luxury', '02-chandelier-offer.png');
  const chandelier = await lightingSnapshot();
  await setCamera('ceiling');
  await page.screenshot({ path: path.join(OUT, '03-luxury-chandeliers.png') });

  await purchase('Wall sconces', 'wall-sconces', 'construction_wall_sconces_luxury', '04-sconce-offer.png');
  const sconces = await lightingSnapshot();
  await setCamera('wall');
  await page.screenshot({ path: path.join(OUT, '05-luxury-wall-sconces.png') });

  await purchase('Landscape lighting', 'landscape-lighting', 'construction_landscape_lighting_luxury', '06-landscape-offer.png');
  const landscape = await lightingSnapshot();
  await setCamera('landscape');
  await page.screenshot({ path: path.join(OUT, '07-luxury-landscape-lighting.png') });
  await page.evaluate(() => window.__fw.autosave());

  await boot();
  const reloaded = await lightingSnapshot();
  await setCamera('landscape');
  await page.screenshot({ path: path.join(OUT, '08-landscape-lighting-after-reload.png') });
  const totalCost = before.cash - landscape.cash;
  return {
    ok: before.selection.finishId === 'led-panels'
      && before.selection.qualityId === 'municipal'
      && before.indoor?.selectedVariant === 'construction_led_panels_municipal'
      && before.indoor?.mountKind === 'ceiling'
      && before.visibleIndoorPlacementCount === 8
      && chandelier.selection.finishId === 'luxury-chandeliers'
      && chandelier.indoor?.mountKind === 'ceiling'
      && chandelier.visibleIndoorPlacementCount === 2
      && chandelier.indoor?.activeFixtureCount === 2
      && chandelier.indoorMaterials.some((name) => name.includes('LuxuryChandeliers_Luxury'))
      && sconces.selection.finishId === 'wall-sconces'
      && sconces.indoor?.mountKind === 'wall'
      && sconces.visibleIndoorPlacementCount === 10
      && sconces.indoor?.activeFixtureCount === 10
      && sconces.indoorMaterials.some((name) => name.includes('WallSconces_Luxury'))
      && landscape.selection.finishId === 'landscape-lighting'
      && landscape.indoor?.mountKind === 'landscape'
      && landscape.visibleIndoorPlacementCount === 0
      && landscape.landscape?.active === true
      && landscape.landscape?.selectedVariant === 'construction_landscape_lighting_luxury'
      && landscape.landscape?.lightSourcesActive === true
      && landscape.visibleLandscapeMeshCount >= 2
      && landscape.landscapeMaterials.some((name) => name.includes('LandscapeLighting_Luxury'))
      && reloaded.selection.finishId === 'landscape-lighting'
      && reloaded.selection.qualityId === 'luxury'
      && reloaded.indoor?.mountKind === 'landscape'
      && reloaded.landscape?.active === true
      && reloaded.visibleLandscapeMeshCount >= 2
      && totalCost > 0
      && errors.length === 0,
    totalCost,
    before,
    chandelier,
    sconces,
    landscape,
    reloaded,
    errors,
  };
}
