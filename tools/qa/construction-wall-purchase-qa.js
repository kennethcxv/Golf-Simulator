async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const OUT = path.resolve(process.env.CONSTRUCTION_WALL_QA_OUT
    || path.join(process.cwd(), 'qa', 'construction-wall-purchase'));
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

  const wallSnapshot = () => page.evaluate(() => {
    const app = window.__fw;
    const production = app.scene3d.clubhouse().sheet06Production;
    const selection = app.state.shop.reno.constructionFinishes.installed.walls;
    const wallRoot = production.getAssemblyRoot(56);
    const panelBatches = wallRoot?.children?.filter((node) => node.userData?.sheet06Variant === 'straight') || [];
    const activePanel = panelBatches.find((node) => node.userData?.sheet06SelectedVariant);
    const connectors = wallRoot?.children?.filter((node) => (
      ['inside_corner', 'outside_corner', 'door_connector', 'window_connector']
        .includes(node.userData?.sheet06Variant)
    )) || [];
    return {
      cash: app.state.cash,
      worksExpense: app.state.ledger?.today?.expense?.works || 0,
      selection: { ...selection },
      owned: app.state.shop.reno.constructionFinishes.owned.includes(`walls:${selection.finishId}:${selection.qualityId}`),
      architecture: { ...app.state.shop.reno.architecture.components.panels },
      diagnostics: production.diagnostics().assembly?.walls || null,
      panel: {
        selectedVariant: activePanel?.userData?.sheet06SelectedVariant || null,
        visibleBatchCount: panelBatches.filter((node) => node.visible).length,
        instanceCount: activePanel?.count || 0,
        materials: (Array.isArray(activePanel?.material) ? activePanel.material : [activePanel?.material])
          .filter(Boolean).map((entry) => entry.name),
      },
      connectorBatchCount: connectors.length,
      connectorsVisible: connectors.length > 0 && connectors.every((node) => node.visible === true),
    };
  });

  const setWallCamera = async () => {
    await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      const at = [1.35, -3.65];
      const target = [5.62, -3.65];
      walk.clearKeys?.();
      walk.state.x = origin.x + at[0];
      walk.state.z = origin.z + at[1];
      walk.state.yaw = Math.atan2(-(target[0] - at[0]), -(target[1] - at[1]));
      walk.state.pitch = -0.10;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    });
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

  await boot();
  await page.evaluate(() => { window.__fw.state.cash = Math.max(window.__fw.state.cash, 1_000_000); });
  const before = await wallSnapshot();
  await setWallCamera();
  await page.screenshot({ path: path.join(OUT, '01-municipal-drywall.png') });

  await sitAtLaptop();
  await page.locator('.lt-navbtn').filter({ hasText: 'Upgrades' }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Clubhouse$/ }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Walls$/ }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Luxury country club$/ }).click();
  const moulding = page.locator('.lt-order').filter({
    has: page.locator('.lt-ordername', { hasText: /^Luxury moulding$/ }),
  });
  await moulding.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '02-luxury-moulding-offer.png') });
  await moulding.locator('button').filter({ hasText: /^(Buy|Install)/ }).click();
  await page.locator('.lt-confirm .lt-primary').filter({ hasText: /^(Purchase finish|Install it)$/ }).click();
  await page.waitForFunction(() => {
    const selection = window.__fw.state.shop.reno.constructionFinishes.installed.walls;
    const walls = window.__fw.scene3d.clubhouse().sheet06Production.diagnostics().assembly?.walls;
    return selection.finishId === 'luxury-moulding'
      && selection.qualityId === 'luxury'
      && walls?.selectedVariant === 'construction_luxury_moulding_luxury'
      && walls.walnutJoineryVisible === true;
  }, null, { timeout: 15000 });
  await moulding.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '03-luxury-moulding-installed-ui.png') });
  const purchased = await wallSnapshot();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
  await setWallCamera();
  await page.screenshot({ path: path.join(OUT, '04-luxury-moulding-player-camera.png') });
  await page.evaluate(() => window.__fw.autosave());

  await boot();
  const reloaded = await wallSnapshot();
  await setWallCamera();
  await page.screenshot({ path: path.join(OUT, '05-luxury-moulding-after-reload.png') });
  const cost = before.cash - purchased.cash;
  return {
    ok: before.selection.finishId === 'drywall'
      && before.selection.qualityId === 'municipal'
      && purchased.selection.finishId === 'luxury-moulding'
      && purchased.selection.qualityId === 'luxury'
      && purchased.diagnostics?.selectedVariant === 'construction_luxury_moulding_luxury'
      && purchased.diagnostics?.walnutJoineryVisible === true
      && purchased.panel.selectedVariant === 'construction_luxury_moulding_luxury'
      && purchased.panel.visibleBatchCount === 1
      && purchased.panel.instanceCount > 0
      && purchased.architecture.restored === true
      && purchased.owned === true
      && cost > 0
      && reloaded.selection.finishId === 'luxury-moulding'
      && reloaded.selection.qualityId === 'luxury'
      && reloaded.diagnostics?.selectedVariant === 'construction_luxury_moulding_luxury'
      && reloaded.panel.selectedVariant === 'construction_luxury_moulding_luxury'
      && errors.length === 0,
    cost,
    before,
    purchased,
    reloaded,
    errors,
  };
}
