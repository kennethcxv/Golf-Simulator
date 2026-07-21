async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(async () => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const municipal = clubhouse?.course1Municipal;
    if (!municipal || (clubhouse.assetsReady && !clubhouse.assetsReady())) return false;
    try { await municipal.ready; } catch { return false; }
    return municipal.diagnostics?.().ready === true;
  }, null, { timeout: 90000 });

  async function pose(camera) {
    await page.evaluate((shot) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const origin = app.scene3d.clubhouse().interior.position;
      walk.clearKeys?.();
      walk.state.x = origin.x + shot.x;
      walk.state.z = origin.z + shot.z;
      const dx = origin.x + shot.tx - walk.state.x;
      const dz = origin.z + shot.tz - walk.state.z;
      const distance = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.state.pitch = shot.pitch || 0;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.state.weather.today = { tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5 };
      app.state.weather.locked = true;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      app.scene3d.clubhouse().setOrganicWalkins?.(false);
      app.scene3d.clubhouse().clearWalkins?.();
    }, camera);
  }

  await pose({ x: -1.0, z: 10.2, tx: -1.0, tz: 5.4, pitch: 0.01 });
  await page.waitForTimeout(1600);
  await page.locator('#game').click({ position: { x: 800, y: 450 }, force: true });
  const start = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  await page.keyboard.down('w');
  await page.waitForTimeout(1050);
  await page.keyboard.up('w');
  await page.keyboard.press('e');
  await page.waitForTimeout(550);
  await page.keyboard.down('w');
  await page.waitForTimeout(1850);
  await page.keyboard.up('w');
  await page.waitForTimeout(1200);
  const routeEnd = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));

  await pose({ x: -4.8, z: -4.0, tx: -1.0, tz: 5.4, pitch: 0.02 });
  await page.waitForTimeout(1800);
  await pose({ x: 1.8, z: 2.8, tx: 5.2, tz: -1.8, pitch: 0.02 });
  await page.waitForTimeout(2200);
  await pose({ x: -15.2, z: 14.2, tx: -1.2, tz: 2.0, pitch: 0.05 });
  await page.waitForTimeout(2400);
  await pose({ x: 18.5, z: 4.0, tx: 7.5, tz: -0.4, pitch: 0.04 });
  await page.waitForTimeout(2400);

  const end = await page.evaluate(() => ({
    walk: { ...window.__fw.scene3d.walk.state },
    municipal: window.__fw.scene3d.clubhouse().course1Municipal.diagnostics(),
  }));
  return {
    ok: end.municipal.ready === true,
    media: 'Playwright 1600x900 WebM; normal W-E-W entrance followed by fixed property review views',
    routeDistanceBeforeReviewCuts: Math.hypot(routeEnd.x - start.x, routeEnd.z - start.z),
    municipal: end.municipal,
  };
}
