async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const OUT = path.resolve(process.env.CONSTRUCTION_WINDOW_QA_OUT
    || path.join(process.cwd(), 'qa', 'construction-window-purchase'));
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

  const windowSnapshot = () => page.evaluate(() => {
    const app = window.__fw;
    const production = app.scene3d.clubhouse().sheet06Production;
    const selection = app.state.shop.reno.constructionFinishes.installed.windows;
    const root = production.getAssemblyRoot(55);
    const materialNames = new Set();
    let meshCount = 0;
    root?.traverse?.((node) => {
      if (!node.isMesh) return;
      meshCount += 1;
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (material?.name) materialNames.add(material.name);
      }
    });
    return {
      cash: app.state.cash,
      worksExpense: app.state.ledger?.today?.expense?.works || 0,
      selection: { ...selection },
      owned: app.state.shop.reno.constructionFinishes.owned.includes(`windows:${selection.finishId}:${selection.qualityId}`),
      architecture: { ...app.state.shop.reno.architecture.components.windows },
      diagnostics: production.diagnostics().assembly?.windows || null,
      instances: root?.children?.map((instance) => ({
        id: instance.userData?.sheet06PlacementId || null,
        selectedVariant: instance.userData?.sheet06SelectedVariant || null,
        broken: instance.userData?.sheet06WindowBroken,
        film: instance.userData?.sheet06WindowFilm,
      })) || [],
      meshCount,
      materials: [...materialNames].sort(),
    };
  });

  const setWindowCamera = async () => {
    await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      const at = [0.7, -1.75];
      const target = [3.0, -6.55];
      walk.clearKeys?.();
      walk.state.x = origin.x + at[0];
      walk.state.z = origin.z + at[1];
      walk.state.yaw = Math.atan2(-(target[0] - at[0]), -(target[1] - at[1]));
      walk.state.pitch = 0.02;
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
  const before = await windowSnapshot();
  await setWindowCamera();
  await page.screenshot({ path: path.join(OUT, '01-municipal-aluminum.png') });

  await sitAtLaptop();
  await page.locator('.lt-navbtn').filter({ hasText: 'Upgrades' }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Clubhouse$/ }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Windows$/ }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Luxury country club$/ }).click();
  const luxury = page.locator('.lt-order').filter({
    has: page.locator('.lt-ordername', { hasText: /^Luxury country club$/ }),
  });
  await luxury.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '02-luxury-window-offer.png') });
  await luxury.locator('button').filter({ hasText: /^(Buy|Install)/ }).click();
  await page.locator('.lt-confirm .lt-primary').filter({ hasText: /^(Purchase finish|Install it)$/ }).click();
  await page.waitForFunction(() => {
    const selection = window.__fw.state.shop.reno.constructionFinishes.installed.windows;
    const windows = window.__fw.scene3d.clubhouse().sheet06Production.diagnostics().assembly?.windows;
    return selection.finishId === 'luxury-country-club'
      && selection.qualityId === 'luxury'
      && windows?.selectedVariant === 'construction_luxury_country_club_luxury';
  }, null, { timeout: 15000 });
  await luxury.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '03-luxury-window-installed-ui.png') });
  const purchased = await windowSnapshot();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
  await setWindowCamera();
  await page.screenshot({ path: path.join(OUT, '04-luxury-window-player-camera.png') });
  await page.evaluate(() => window.__fw.autosave());

  await boot();
  const reloaded = await windowSnapshot();
  await setWindowCamera();
  await page.screenshot({ path: path.join(OUT, '05-luxury-window-after-reload.png') });
  const cost = before.cash - purchased.cash;
  const selected = 'construction_luxury_country_club_luxury';
  return {
    ok: before.selection.finishId === 'cheap-aluminum'
      && before.selection.qualityId === 'municipal'
      && purchased.selection.finishId === 'luxury-country-club'
      && purchased.selection.qualityId === 'luxury'
      && purchased.diagnostics?.selectedVariant === selected
      && purchased.instances.length === 4
      && purchased.instances.every((instance) => instance.selectedVariant === selected && instance.broken === false)
      && purchased.meshCount >= 8
      && purchased.materials.some((name) => name.includes('LuxuryCountryClub_Luxury'))
      && purchased.architecture.restored === true
      && purchased.owned === true
      && cost > 0
      && reloaded.selection.finishId === 'luxury-country-club'
      && reloaded.selection.qualityId === 'luxury'
      && reloaded.diagnostics?.selectedVariant === selected
      && reloaded.instances.every((instance) => instance.selectedVariant === selected)
      && errors.length === 0,
    cost,
    before,
    purchased,
    reloaded,
    errors,
  };
}
