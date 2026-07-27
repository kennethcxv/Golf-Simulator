async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.join(process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'premium-clubhouse', 'save-load');
  fs.mkdirSync(out, { recursive: true });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('requestfailed', (request) => errors.push(
    `request: ${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  ));

  const waitForPremium = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().premiumCountryClub?.diagnostics?.().status === 'ready'
    ), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || Number(getComputedStyle(veil).opacity || 1) <= 0.01;
    }, null, { timeout: 90000 });
  };

  const snapshot = () => page.evaluate(() => {
    const app = window.__fw;
    const premium = app.scene3d.clubhouse().premiumCountryClub.diagnostics();
    return {
      tier: app.state.property?.tierId,
      cash: app.state.cash,
      inventorySkuCount: Object.keys(app.state.shop?.inventory || {}).length,
      registerState: JSON.stringify(app.state.shop?.register ?? null),
      conditionedAreaSquareFeet: premium.conditionedAreaSquareFeet,
      interiorPolicy: premium.interiorPolicy,
      batchDrawCallsSaved: premium.runtimeBatch?.drawCallsSaved,
      colliderCount: premium.colliderCount,
      pivotCount: premium.pivotCount,
      lightCount: premium.runtimeLightCount,
      loaded: premium.loaded,
      source: app.scene3d.clubhouse().premiumCountryClub.root()?.userData?.source || null,
    };
  });

  const openPause = async () => {
    if (await page.evaluate(() => Boolean(document.pointerLockElement))) {
      await page.evaluate(() => document.exitPointerLock());
      await page.waitForFunction(() => !document.pointerLockElement, null, { timeout: 3000 });
    }
    const pause = page.locator('.pause-veil-ui');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await pause.count()) return;
      await page.keyboard.press('Escape');
      if (await pause.waitFor({ state: 'visible', timeout: 1800 }).then(() => true).catch(() => false)) return;
    }
    throw new Error('Pause menu did not open through Escape.');
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    const holding = raw.holdings.find((entry) => entry.property.id === raw.activeId) || raw.holdings[0];
    holding.property.tierId = 'premiumPrivate';
    holding.state.property.tierId = 'premiumPrivate';
    holding.state.tutorial.complete = true;
    holding.state.tutorial.hidden = true;
    localStorage.setItem('golfempire:autosave', JSON.stringify(raw));
  });
  await page.getByText('Continue', { exact: true }).click();
  await waitForPremium();
  const before = await snapshot();

  await openPause();
  await page.getByRole('button', { name: 'Save game', exact: true }).click();
  await page.getByRole('button', { name: 'Save here', exact: true }).first().click();
  await page.waitForFunction(() => localStorage.getItem('golfempire:slot1') !== null, null, { timeout: 5000 });
  await page.getByRole('button', { name: 'Resume', exact: true }).click();

  await openPause();
  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  await page.evaluate(() => { window.__premiumClubhouseStateBeforeLoad = window.__fw.state; });
  const load = page.getByRole('button', { name: 'Load', exact: true }).first();
  await load.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((entry) => entry.textContent.trim() === 'Load');
    return Boolean(button && !button.disabled);
  }, null, { timeout: 5000 });
  await load.click();
  const confirm = page.getByRole('button', { name: 'Load game', exact: true }).last();
  await confirm.waitFor({ state: 'visible', timeout: 5000 });
  await confirm.click();
  await page.waitForFunction(() => (
    window.__fw?.state && window.__fw.state !== window.__premiumClubhouseStateBeforeLoad
  ), null, { timeout: 90000 });
  await waitForPremium();
  const after = await snapshot();

  await page.evaluate(() => {
    const app = window.__fw;
    const group = app.scene3d.clubhouse().group;
    const walk = app.scene3d.walk;
    walk.clearKeys();
    walk.state.x = group.position.x;
    walk.state.z = group.position.z + 57;
    walk.state.yaw = 0;
    walk.state.pitch = 0.055;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
  });
  await page.waitForTimeout(500);
  const screenshot = path.join(out, 'premium-clubhouse-after-slot1-load.png');
  await page.screenshot({ path: screenshot });

  const stable = JSON.stringify(before) === JSON.stringify(after);
  return {
    ok: stable && errors.length === 0 && after.loaded && after.tier === 'premiumPrivate',
    route: ['Continue', 'Escape', 'Save game', 'Save here', 'Resume', 'Escape', 'Load game', 'Load'],
    before,
    after,
    stable,
    errors,
    screenshot,
  };
}
