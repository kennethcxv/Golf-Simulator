async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8469/';
  const OUT = path.resolve(process.env.CONSTRUCTION_GARAGE_QA_OUT
    || path.join(process.cwd(), 'qa', 'construction-garage-purchase'));
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

  const garageSnapshot = () => page.evaluate(() => {
    const app = window.__fw;
    const production = app.scene3d.clubhouse().sheet06Production;
    const selection = app.state.shop.reno.constructionFinishes.installed['garage-doors'];
    const root = production.getRoot(51);
    const selected = root?.userData?.sheet06SelectedConstructionGarageVariant || null;
    const materials = new Set();
    let selectedMeshCount = 0;
    let nonSelectedVisibleMeshCount = 0;
    root?.traverse?.((node) => {
      if (!node.isMesh || !node.visible) return;
      let visibility = node.parent;
      while (visibility) {
        if (visibility.visible === false) return;
        visibility = visibility.parent;
      }
      let authority = node;
      while (authority && !authority.userData?.construction_garage_variant) authority = authority.parent;
      const variant = authority?.userData?.construction_garage_variant;
      if (!variant) return;
      if (variant === selected) {
        selectedMeshCount += 1;
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (material?.name) materials.add(material.name);
        }
      } else {
        nonSelectedVisibleMeshCount += 1;
      }
    });
    return {
      cash: app.state.cash,
      worksExpense: app.state.ledger?.today?.expense?.works || 0,
      selection: { ...selection },
      owned: app.state.shop.reno.constructionFinishes.owned
        .includes(`garage-doors:${selection.finishId}:${selection.qualityId}`),
      diagnostics: production.diagnostics().garageDoor,
      rootSelectedVariant: selected,
      selectedMeshCount,
      nonSelectedVisibleMeshCount,
      materials: [...materials].sort(),
    };
  });

  const setGarageCamera = async () => {
    await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      const at = [16.0, 0.25];
      const target = [9.65, 0.25];
      walk.clearKeys?.();
      walk.state.x = origin.x + at[0];
      walk.state.z = origin.z + at[1];
      walk.state.yaw = Math.atan2(-(target[0] - at[0]), -(target[1] - at[1]));
      walk.state.pitch = 0.01;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 11 * 60;
      app.scene3d.applyTimeWeather?.(11 * 60, app.state.weather);
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
  const before = await garageSnapshot();
  await setGarageCamera();
  await page.screenshot({ path: path.join(OUT, '01-municipal-ribbed-steel.png') });

  await sitAtLaptop();
  await page.locator('.lt-navbtn').filter({ hasText: 'Upgrades' }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Clubhouse$/ }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Garage doors$/ }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Luxury country club$/ }).click();
  const garageDoor = page.locator('.lt-order').filter({
    has: page.locator('.lt-ordername', { hasText: /^Garage door$/ }),
  });
  await garageDoor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '02-luxury-garage-offer.png') });
  await garageDoor.locator('button').filter({ hasText: /^(Buy|Install)/ }).click();
  await page.locator('.lt-confirm .lt-primary').filter({ hasText: /^(Purchase finish|Install it)$/ }).click();
  await page.waitForFunction(() => {
    const app = window.__fw;
    const selection = app.state.shop.reno.constructionFinishes.installed['garage-doors'];
    const garage = app.scene3d.clubhouse().sheet06Production.diagnostics().garageDoor;
    return selection.finishId === 'garage-door'
      && selection.qualityId === 'luxury'
      && garage?.selectedVariant === 'construction_garage_door_luxury';
  }, null, { timeout: 15000 });
  await garageDoor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '03-luxury-garage-installed-ui.png') });
  const purchased = await garageSnapshot();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
  await setGarageCamera();
  await page.screenshot({ path: path.join(OUT, '04-luxury-country-club-garage.png') });
  await page.evaluate(() => window.__fw.autosave());

  await boot();
  const reloaded = await garageSnapshot();
  await setGarageCamera();
  await page.screenshot({ path: path.join(OUT, '05-luxury-garage-after-reload.png') });
  const cost = before.cash - purchased.cash;
  const selected = 'construction_garage_door_luxury';
  return {
    ok: before.selection.finishId === 'garage-door'
      && before.selection.qualityId === 'municipal'
      && purchased.selection.finishId === 'garage-door'
      && purchased.selection.qualityId === 'luxury'
      && purchased.diagnostics?.selectedVariant === selected
      && purchased.rootSelectedVariant === selected
      && purchased.selectedMeshCount >= 2
      && purchased.nonSelectedVisibleMeshCount === 0
      && purchased.materials.some((name) => name.includes('GarageDoor_Luxury'))
      && purchased.owned === true
      && cost > 0
      && reloaded.selection.finishId === 'garage-door'
      && reloaded.selection.qualityId === 'luxury'
      && reloaded.rootSelectedVariant === selected
      && reloaded.selectedMeshCount >= 2
      && reloaded.nonSelectedVisibleMeshCount === 0
      && errors.length === 0,
    cost,
    before,
    purchased,
    reloaded,
    errors,
  };
}
