async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const OUT = path.resolve(process.env.CONSTRUCTION_CEILING_QA_OUT
    || path.join(process.cwd(), 'qa', 'construction-ceiling-purchase'));
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

  const ceilingSnapshot = () => page.evaluate(() => {
    const app = window.__fw;
    const production = app.scene3d.clubhouse().sheet06Production;
    const selection = app.state.shop.reno.constructionFinishes.installed.ceilings;
    const ceilingRoot = production.getAssemblyRoot(58);
    const panel = ceilingRoot?.children?.find((node) => node.userData?.sheet06Variant === 'ceiling_panel');
    const beams = ceilingRoot?.children?.filter((node) => node.userData?.sheet06Variant === 'straight') || [];
    return {
      cash: app.state.cash,
      worksExpense: app.state.ledger?.today?.expense?.works || 0,
      selection: { ...selection },
      owned: app.state.shop.reno.constructionFinishes.owned.includes(`ceilings:${selection.finishId}:${selection.qualityId}`),
      architecture: { ...app.state.shop.reno.architecture.components.ceiling },
      diagnostics: production.diagnostics().assembly?.ceiling || null,
      panel: {
        selectedVariant: panel?.userData?.sheet06SelectedVariant || null,
        material: (Array.isArray(panel?.material) ? panel.material : [panel?.material]).filter(Boolean).map((entry) => entry.name),
      },
      beamBatches: beams.length,
      beamsVisible: beams.every((beam) => beam.visible === true),
    };
  });

  const setCeilingCamera = async () => {
    await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x - 0.6;
      walk.state.z = origin.z + 2.6;
      walk.state.yaw = 0;
      walk.state.pitch = 0.62;
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
  const before = await ceilingSnapshot();
  await setCeilingCamera();
  await page.screenshot({ path: path.join(OUT, '01-municipal-drop-ceiling.png') });

  await sitAtLaptop();
  await page.locator('.lt-navbtn').filter({ hasText: 'Upgrades' }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Clubhouse$/ }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Ceilings$/ }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Luxury country club$/ }).click();
  const coffered = page.locator('.lt-order').filter({ has: page.locator('.lt-ordername', { hasText: /^Luxury coffered$/ }) });
  await coffered.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '02-luxury-coffered-offer.png') });
  await coffered.locator('button').filter({ hasText: /^(Buy|Install)/ }).click();
  await page.locator('.lt-confirm .lt-primary').filter({ hasText: /^(Purchase finish|Install it)$/ }).click();
  await page.waitForFunction(() => {
    const selection = window.__fw.state.shop.reno.constructionFinishes.installed.ceilings;
    const ceiling = window.__fw.scene3d.clubhouse().sheet06Production.diagnostics().assembly?.ceiling;
    return selection.finishId === 'luxury-coffered'
      && selection.qualityId === 'luxury'
      && ceiling?.selectedVariant === 'construction_luxury_coffered_luxury'
      && ceiling.architecturalBeamsVisible === true;
  }, null, { timeout: 15000 });
  await coffered.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '03-luxury-coffered-installed-ui.png') });
  const purchased = await ceilingSnapshot();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
  await setCeilingCamera();
  await page.screenshot({ path: path.join(OUT, '04-luxury-coffered-player-camera.png') });
  await page.evaluate(() => window.__fw.autosave());

  await boot();
  const reloaded = await ceilingSnapshot();
  await setCeilingCamera();
  await page.screenshot({ path: path.join(OUT, '05-luxury-coffered-after-reload.png') });
  const cost = before.cash - purchased.cash;
  return {
    ok: before.selection.finishId === 'drop-ceiling'
      && before.selection.qualityId === 'municipal'
      && purchased.selection.finishId === 'luxury-coffered'
      && purchased.selection.qualityId === 'luxury'
      && purchased.diagnostics?.selectedVariant === 'construction_luxury_coffered_luxury'
      && purchased.diagnostics?.architecturalBeamsVisible === true
      && purchased.panel.selectedVariant === 'construction_luxury_coffered_luxury'
      && purchased.beamBatches > 0
      && purchased.beamsVisible === true
      && purchased.architecture.restored === true
      && purchased.owned === true
      && cost > 0
      && reloaded.selection.finishId === 'luxury-coffered'
      && reloaded.selection.qualityId === 'luxury'
      && reloaded.diagnostics?.selectedVariant === 'construction_luxury_coffered_luxury'
      && reloaded.beamBatches > 0
      && reloaded.beamsVisible === true
      && errors.length === 0,
    cost,
    before,
    purchased,
    reloaded,
    errors,
  };
}
