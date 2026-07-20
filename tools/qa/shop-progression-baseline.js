async (page) => {
  const out = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper-property-expansion-world-overhaul/qa/property-expansion-world-overhaul/shop-progression/before';

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push({ kind: 'console:error', message: message.text() });
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));

  await page.setViewportSize({ width: 1600, height: 900 });
  if (!page.url().startsWith('http://127.0.0.1:8467')) {
    await page.goto('http://127.0.0.1:8467/', { waitUntil: 'domcontentloaded' });
  }
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    return (!clubhouse.assetsReady || clubhouse.assetsReady())
      && (!clubhouse.deliveryEquipmentReady || clubhouse.deliveryEquipmentReady());
  }, null, { timeout: 90000 });

  const fixture = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
    };
    app.state.weather.locked = true;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    return {
      cash: app.state.cash,
      unlockedSupplierTier: app.state.shop.unlockedTier,
      layout: app.state.shop.layout || null,
      inventoryShelfUnits: Object.values(app.state.shop.inventory)
        .reduce((total, entry) => total + (entry?.shelf || 0), 0),
      renderer: {
        geometries: app.scene3d.renderer.info.memory.geometries,
        textures: app.scene3d.renderer.info.memory.textures,
      },
    };
  });
  await page.waitForTimeout(1000);

  const cameras = [
    { id: '01-entry-full-retail', x: -0.7, z: 5.5, tx: -4.2, tz: -1.6, pitch: -0.08 },
    { id: '02-center-full-retail', x: 1.1, z: 2.3, tx: -5.4, tz: -4.0, pitch: -0.04 },
    { id: '03-premium-lounge-from-day-one', x: 0.8, z: -2.7, tx: 4.0, tz: -5.0, pitch: -0.04 },
  ];
  for (const shot of cameras) {
    await page.evaluate((camera) => {
      const app = window.__fw;
      const walk = app.scene3d.walk.state;
      const origin = app.scene3d.clubhouse().interior.position;
      walk.x = origin.x + camera.x;
      walk.z = origin.z + camera.z;
      const dx = origin.x + camera.tx - walk.x;
      const dz = origin.z + camera.tz - walk.z;
      const distance = Math.hypot(dx, dz) || 1;
      walk.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.pitch = camera.pitch;
    }, shot);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${shot.id}.png` });
  }

  const frames = await page.evaluate(() => new Promise((resolve) => {
    const values = [];
    let prior = performance.now();
    const start = prior;
    function tick(now) {
      values.push(now - prior);
      prior = now;
      if (now - start >= 3000) resolve(values.slice(1));
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }));
  const sorted = frames.filter((value) => value > 0).sort((a, b) => a - b);
  const duration = sorted.reduce((sum, value) => sum + value, 0);
  const result = {
    fixture,
    performance: {
      frames: sorted.length,
      fps: sorted.length / (duration / 1000),
      meanMs: duration / sorted.length,
      p99Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))],
    },
    diagnostics,
  };
  return result;
}
