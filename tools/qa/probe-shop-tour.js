// Walk the shop floor and screenshot the retail fixtures stocked, to confirm the
// reference fixtures (refs 21-30) are integrated with real product models, not
// placeholder cubes.
async (page) => {
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    // fully stock everything so the fixtures read full
    for (const id of Object.keys(app.state.shop.inventory)) {
      app.state.shop.inventory[id].shelf = Math.max(app.state.shop.inventory[id].shelf || 0, 8);
    }
    app.speedIdx = 0;
    ch.rebuildStock();
  });
  await page.waitForTimeout(1200);

  // a set of interior vantage points (interior-local, offset applied live)
  const spots = [
    { name: 'west-club-wall', x: -6.5, z: 0.0, yaw: -1.57, pitch: -0.02 },
    { name: 'apparel-mid', x: 0.5, z: -1.0, yaw: 0.2, pitch: -0.05 },
    { name: 'ball-accessory-north', x: -2.0, z: -4.5, yaw: 3.0, pitch: -0.05 },
    { name: 'bag-shoe-wall', x: 1.5, z: -3.0, yaw: 1.0, pitch: -0.05 },
    { name: 'snack-rangefinder', x: 3.5, z: -1.0, yaw: -0.6, pitch: -0.05 },
    { name: 'checkout-overview', x: 2.8, z: 2.0, yaw: 0.1, pitch: -0.12 },
  ];
  const shots = [];
  for (const s of spots) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((spot) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk.state;
      w.x = spot.x + o.x; w.z = spot.z + o.z; w.yaw = spot.yaw; w.pitch = spot.pitch;
    }, s);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
    const path = `qa/checkout_assets_steam_ready_final/fixtures/shop-${s.name}.png`;
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path });
    shots.push(path);
  }
  return { shots };
}
