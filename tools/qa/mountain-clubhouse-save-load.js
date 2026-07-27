async (page) => {
  // Normal-controls save/load acceptance for the Course-3 mountain clubhouse.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const out = path.join(repo, 'qa', 'mountain-clubhouse', 'save-load');
  fs.mkdirSync(out, { recursive: true });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('requestfailed', (request) => errors.push(
    `request: ${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  ));

  const waitForMountain = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().mountainLodge?.diagnostics?.().status === 'ready'
    ), null, { timeout: 120000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none'
        || Number(getComputedStyle(veil).opacity || 1) <= 0.01;
    }, null, { timeout: 90000 });
  };

  const snapshot = () => page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const mountain = clubhouse.mountainLodge.diagnostics();
    return {
      cash: app.state.cash,
      inventorySkuCount: Object.keys(app.state.shop?.inventory || {}).length,
      registerState: JSON.stringify(app.state.shop?.register ?? null),
      conditionedAreaSquareFeet: mountain.conditionedAreaSquareFeet,
      interiorPolicy: mountain.interiorPolicy,
      batchDrawCallsSaved: mountain.batching?.drawCallsSaved,
      pivotCount: mountain.pivotCount,
      lightCount: mountain.runtimeLightCount,
      loaded: mountain.loaded,
      source: clubhouse.mountainLodge.root()?.userData?.source || null,
      license: clubhouse.mountainLodge.root()?.userData?.license || null,
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
      if (await pause.waitFor({ state: 'visible', timeout: 1800 })
        .then(() => true).catch(() => false)) return;
    }
    throw new Error('Pause menu did not open through Escape.');
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  const url = new URL(process.env.QA_BASE_URL || 'http://localhost:8457/');
  url.searchParams.set('clubhouse', 'mountain-lodge');
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByText('Continue', { exact: true }).click();
  await waitForMountain();
  const before = await snapshot();

  await openPause();
  await page.getByRole('button', { name: 'Save game', exact: true }).click();
  await page.getByRole('button', { name: 'Save here', exact: true }).first().click();
  await page.waitForFunction(() => localStorage.getItem('golfempire:slot1') !== null, null, {
    timeout: 5000,
  });
  await page.getByRole('button', { name: 'Resume', exact: true }).click();

  await openPause();
  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  await page.evaluate(() => { window.__mountainClubhouseStateBeforeLoad = window.__fw.state; });
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
    window.__fw?.state && window.__fw.state !== window.__mountainClubhouseStateBeforeLoad
  ), null, { timeout: 90000 });
  await waitForMountain();
  const after = await snapshot();

  await page.evaluate(() => {
    const app = window.__fw;
    const center = app.scene3d.clubhouse().group.position;
    app.scene3d.walk.clearKeys();
    app.scene3d.walk.state.x = center.x;
    app.scene3d.walk.state.z = center.z + 35;
    app.scene3d.walk.state.yaw = 0;
    app.scene3d.walk.state.pitch = 0.055;
  });
  await page.waitForTimeout(600);
  const screenshot = path.join(out, 'mountain-clubhouse-after-slot1-load.png');
  await page.screenshot({ path: screenshot });

  const stable = JSON.stringify(before) === JSON.stringify(after);
  return {
    ok: stable && errors.length === 0 && after.loaded
      && after.conditionedAreaSquareFeet === 3000.71
      && after.interiorPolicy === 'INTENTIONALLY_EMPTY_PLAYER_FURNISHES',
    route: ['Continue', 'Escape', 'Save game', 'Save here', 'Resume', 'Escape', 'Load game', 'Load'],
    before,
    after,
    stable,
    errors,
    screenshot,
  };
}
