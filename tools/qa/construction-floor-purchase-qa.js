async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const OUT = process.env.CONSTRUCTION_FLOOR_QA_OUT
    ? path.resolve(process.env.CONSTRUCTION_FLOOR_QA_OUT)
    : path.join(process.cwd(), 'qa', 'construction-floor-purchase');
  fs.mkdirSync(OUT, { recursive: true });

  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText || 'unknown';
    // The --bootstrap navigation intentionally abandons the bootstrap page's
    // in-flight optional model requests before the real acceptance boot.
    if (reason !== 'net::ERR_ABORTED') errors.push(`requestfailed: ${request.url()} (${reason})`);
  });

  const boot = async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(1200);
    await page.getByText('Continue', { exact: true }).click().catch(() => {});
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
    await page.waitForFunction(async () => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      const production = typeof clubhouse?.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse?.sheet06Production;
      if (!production) return false;
      try { await production.ready; } catch { return false; }
      return production.diagnostics?.().activationStatus === 'active';
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || getComputedStyle(veil).opacity === '0' || veil.style.display === 'none';
    }, null, { timeout: 40000 });
    await page.waitForTimeout(900);
  };

  const floorSnapshot = () => page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const construction = app.state.shop.reno.constructionFinishes;
    const floorRoot = production.getAssemblyRoot(59);
    const renderMesh = floorRoot?.children?.find((node) => node.isInstancedMesh)
      || floorRoot?.children?.find((node) => node.isMesh);
    const materials = (Array.isArray(renderMesh?.material) ? renderMesh.material : [renderMesh?.material])
      .filter(Boolean)
      .map((material) => ({ name: material.name, color: material.color?.getHexString?.() || null, roughness: material.roughness }));
    const floorLayers = [];
    clubhouse.group.traverse((node) => {
      if (!node.isMesh) return;
      let effectiveVisible = true;
      for (let cursor = node; cursor; cursor = cursor.parent) {
        if (cursor.visible === false) effectiveVisible = false;
        if (cursor === clubhouse.group) break;
      }
      if (!effectiveVisible) return;
      const parameters = node.geometry?.parameters || {};
      const largeHorizontal = Number(parameters.width) > 5
        && (Number(parameters.depth) > 5 || Number(parameters.height) > 5);
      if (!largeHorizontal && !/(floor|grime|ground|asset_59)/i.test(node.name || '')) return;
      const layerMaterials = (Array.isArray(node.material) ? node.material : [node.material])
        .filter(Boolean).map((material) => material.name || '');
      floorLayers.push({
        name: node.name,
        parent: node.parent?.name || '',
        visible: effectiveVisible,
        y: node.position.y,
        renderOrder: node.renderOrder,
        geometryType: node.geometry?.type || '',
        parameters,
        materials: layerMaterials,
      });
    });
    return {
      cash: app.state.cash,
      worksExpense: app.state.ledger?.today?.expense?.works || 0,
      installed: construction.installed.flooring,
      owned: [...construction.owned],
      architecture: { ...app.state.shop.reno.architecture.components.floor },
      diagnostics: production.diagnostics().assembly?.floor || null,
      runtime: {
        hiddenFallbackCount: production.diagnostics().hiddenFallbackCount,
        suppressionCount: production.diagnostics().suppressionCount,
      },
      renderMesh: {
        geometry: renderMesh?.geometry?.name || null,
        vertices: renderMesh?.geometry?.attributes?.position?.count || 0,
        indices: renderMesh?.geometry?.index?.count || 0,
        materials,
      },
      floorLayers,
    };
  });

  const setCamera = async () => {
    await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const origin = clubhouse.interior.position;
      const walk = app.scene3d.walk;
      const at = [-0.35, 2.4];
      const target = [-0.35, -2.45];
      walk.clearKeys?.();
      walk.state.x = origin.x + at[0];
      walk.state.z = origin.z + at[1];
      walk.state.yaw = Math.atan2(-(target[0] - at[0]), -(target[1] - at[1]));
      walk.state.pitch = -0.55;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    });
    await page.waitForTimeout(2200);
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
  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const construction = await import('/src/sim/constructionFinishes.js');
    construction.ensureConstructionFinishes(app.state);
    app.state.cash = Math.max(app.state.cash, 1_000_000);
    return { cash: app.state.cash };
  });
  const before = await floorSnapshot();

  // The purchase itself follows the player's normal laptop interaction: sit,
  // press E, navigate, choose the quality, click the package, and confirm.
  await sitAtLaptop();
  await page.locator('.lt-navbtn').filter({ hasText: 'Upgrades' }).click();
  await page.locator('.lt-tab').filter({ hasText: /^Clubhouse$/ }).click();
  await page.screenshot({ path: path.join(OUT, '01-construction-catalog-municipal.png') });
  await page.locator('.lt-tab').filter({ hasText: /^Luxury country club$/ }).click();
  const herringbone = page.locator('.lt-order').filter({ has: page.locator('.lt-ordername', { hasText: /^Herringbone$/ }) });
  await herringbone.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '02-luxury-herringbone-offer.png') });
  const purchaseButton = herringbone.locator('button').filter({ hasText: /^(Buy|Install)/ });
  await purchaseButton.click();
  await page.locator('.lt-confirm .lt-primary').filter({ hasText: /^(Purchase finish|Install it)$/ }).click();
  await page.waitForFunction(() => {
    const selection = window.__fw.state.shop.reno.constructionFinishes.installed.flooring;
    return selection.finishId === 'herringbone' && selection.qualityId === 'luxury';
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const floor = production.diagnostics().assembly?.floor;
    return floor?.selectedVariant === 'construction_herringbone_luxury' && floor.damageVisible === false;
  }, null, { timeout: 10000 });
  await herringbone.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '03-luxury-herringbone-installed-ui.png') });
  const purchased = await floorSnapshot();

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
  await setCamera();
  await page.screenshot({ path: path.join(OUT, '04-luxury-herringbone-player-camera.png') });
  await page.evaluate(() => window.__fw.autosave());

  await boot();
  const reloaded = await floorSnapshot();
  await setCamera();
  await page.screenshot({ path: path.join(OUT, '05-luxury-herringbone-after-reload.png') });

  const expectedCost = before.cash - purchased.cash;
  return {
    ok: purchased.installed.finishId === 'herringbone'
      && purchased.installed.qualityId === 'luxury'
      && purchased.diagnostics.selectedVariant === 'construction_herringbone_luxury'
      && purchased.diagnostics.damageVisible === false
      && purchased.architecture.restored === true
      && expectedCost > 0
      && purchased.owned.includes('flooring:herringbone:luxury')
      && reloaded.installed.finishId === 'herringbone'
      && reloaded.installed.qualityId === 'luxury'
      && reloaded.diagnostics.selectedVariant === 'construction_herringbone_luxury'
      && reloaded.diagnostics.damageVisible === false
      && errors.length === 0,
    fixture,
    expectedCost,
    before,
    purchased,
    reloaded,
    errors,
    screenshots: [
      '01-construction-catalog-municipal.png',
      '02-luxury-herringbone-offer.png',
      '03-luxury-herringbone-installed-ui.png',
      '04-luxury-herringbone-player-camera.png',
      '05-luxury-herringbone-after-reload.png',
    ].map((name) => path.join(OUT, name)),
  };
}
