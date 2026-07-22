async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const OUT = path.resolve(process.env.CONSTRUCTION_DOOR_QA_OUT
    || path.join(process.cwd(), 'qa', 'construction-door-purchase'));
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

  const doorSnapshot = () => page.evaluate(() => {
    const app = window.__fw;
    const production = app.scene3d.clubhouse().sheet06Production;
    const selection = app.state.shop.reno.constructionFinishes.installed.doors;
    const root = production.getRoot(53);
    const materials = new Set();
    let selectedMeshCount = 0;
    let visibleLegacyMeshCount = 0;
    root?.traverse?.((node) => {
      if (!node.isMesh) return;
      if (node.userData?.construction_door_legacy_visual === true && node.visible) visibleLegacyMeshCount += 1;
      if (node.userData?.construction_door_variant === root.userData?.sheet06SelectedConstructionDoorVariant
        && node.visible) {
        selectedMeshCount += 1;
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (material?.name) materials.add(material.name);
        }
      }
    });
    const left = root?.getObjectByName?.('PIVOT_DoorLeft');
    const right = root?.getObjectByName?.('PIVOT_DoorRight');
    const persisted = app.state.shop.reno.architecture.doors?.main || null;
    return {
      cash: app.state.cash,
      worksExpense: app.state.ledger?.today?.expense?.works || 0,
      selection: { ...selection },
      owned: app.state.shop.reno.constructionFinishes.owned.includes(`doors:${selection.finishId}:${selection.qualityId}`),
      diagnostics: production.diagnostics().door,
      rootSelectedVariant: root?.userData?.sheet06SelectedConstructionDoorVariant || null,
      selectedMeshCount,
      visibleLegacyMeshCount,
      materials: [...materials].sort(),
      pivots: { left: left?.rotation?.y ?? null, right: right?.rotation?.y ?? null },
      persisted: persisted ? { ...persisted } : null,
    };
  });

  const setDoorCamera = async (near = false) => {
    await page.evaluate((isNear) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      const at = [-0.8, isNear ? 5.15 : 3.45];
      const target = [-0.8, 6.55];
      walk.clearKeys?.();
      walk.state.x = origin.x + at[0];
      walk.state.z = origin.z + at[1];
      walk.state.yaw = Math.atan2(-(target[0] - at[0]), -(target[1] - at[1]));
      walk.state.pitch = 0.0;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    }, near);
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
  const before = await doorSnapshot();
  await setDoorCamera(false);
  await page.screenshot({ path: path.join(OUT, '01-municipal-hollow-core.png') });

  await sitAtLaptop();
  await page.locator('.lt-navbtn').filter({ hasText: 'Upgrades' }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Clubhouse$/ }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Doors$/ }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Luxury country club$/ }).click();
  const doubleEntry = page.locator('.lt-order').filter({
    has: page.locator('.lt-ordername', { hasText: /^Double entry$/ }),
  });
  await doubleEntry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '02-double-entry-offer.png') });
  await doubleEntry.locator('button').filter({ hasText: /^(Buy|Install)/ }).click();
  await page.locator('.lt-confirm .lt-primary').filter({ hasText: /^(Purchase finish|Install it)$/ }).click();
  await page.waitForFunction(() => {
    const selection = window.__fw.state.shop.reno.constructionFinishes.installed.doors;
    const door = window.__fw.scene3d.clubhouse().sheet06Production.diagnostics().door?.construction;
    return selection.finishId === 'double-entry'
      && selection.qualityId === 'luxury'
      && door?.selectedVariant === 'construction_double_entry_luxury';
  }, null, { timeout: 15000 });
  await doubleEntry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '03-double-entry-installed-ui.png') });
  const purchased = await doorSnapshot();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
  await setDoorCamera(false);
  await page.screenshot({ path: path.join(OUT, '04-double-entry-closed-player-camera.png') });

  await setDoorCamera(true);
  await page.waitForFunction(() => /door|entrance|open/i.test(document.querySelector('.shop-prompt')?.textContent || ''), null, { timeout: 10000 });
  const closed = await doorSnapshot();
  await page.keyboard.press('e');
  await page.waitForFunction((leftBefore) => {
    const current = window.__fw.scene3d.clubhouse().sheet06Production.diagnostics().door;
    return Math.abs(current.leftAngle - leftBefore) > 0.15 || current.leftState === 'open';
  }, closed.pivots.left, { timeout: 12000 });
  await page.waitForTimeout(1200);
  const opened = await doorSnapshot();
  await page.screenshot({ path: path.join(OUT, '05-double-entry-open-normal-control.png') });
  await page.evaluate(() => window.__fw.autosave());

  await boot();
  const reloaded = await doorSnapshot();
  await setDoorCamera(false);
  await page.screenshot({ path: path.join(OUT, '06-double-entry-after-reload.png') });
  const cost = before.cash - purchased.cash;
  const selected = 'construction_double_entry_luxury';
  return {
    ok: before.selection.finishId === 'hollow-core'
      && before.selection.qualityId === 'municipal'
      && purchased.selection.finishId === 'double-entry'
      && purchased.selection.qualityId === 'luxury'
      && purchased.diagnostics?.construction?.selectedVariant === selected
      && purchased.rootSelectedVariant === selected
      && purchased.selectedMeshCount >= 4
      && purchased.visibleLegacyMeshCount === 0
      && purchased.materials.some((name) => name.includes('DoubleEntry_Luxury'))
      && purchased.owned === true
      && cost > 0
      && (Math.abs(opened.pivots.left - closed.pivots.left) > 0.15
        || Math.abs(opened.pivots.right - closed.pivots.right) > 0.15)
      && reloaded.selection.finishId === 'double-entry'
      && reloaded.selection.qualityId === 'luxury'
      && reloaded.rootSelectedVariant === selected
      && reloaded.selectedMeshCount >= 4
      && errors.length === 0,
    cost,
    before,
    purchased,
    closed,
    opened,
    reloaded,
    errors,
  };
}
