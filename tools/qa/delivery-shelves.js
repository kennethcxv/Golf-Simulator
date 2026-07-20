async (page) => {
  // FULL MUST LOOK FULL. Fill every shelf to its capacity, stand in front of the wall, and count
  // what is actually in the scene graph against what the sim says is on the shelf.
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  const QA_ROOT = (process.env.GOLF_FLIPPER_QA_ROOT || `${process.cwd()}/qa`).replaceAll('\\', '/');
  const OUT = `${QA_ROOT}/delivery`;
  const BASE_URL = process.env.GOLF_FLIPPER_URL || 'http://localhost:8457/';

  await page.goto(BASE_URL);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
  await page.waitForTimeout(1500);

  const counts = await page.evaluate(async () => {
    const slots = await import('/src/data/fixtureSlots.js');
    const shop = await import('/src/sim/shop.js');
    const items = await import('/src/data/shopItems.js');
    const app = window.__fw;
    const st = app.state;

    // FILL EVERY SHELF TO CAPACITY
    const table = [];
    for (const sku of items.SHOP_CATALOG) {
      if (!items.RETAIL_CATS.has(sku.cat)) continue;
      const cap = shop.shelfCapacity(sku);
      st.shop.inventory[sku.id].shelf = cap;
      table.push({ id: sku.id, cap, slots: slots.capacityOf(sku.id) });
    }
    st.shop.unlockedTier = 3;
    app.scene3d.clubhouse().rebuildStock();
    return table;
  });

  await page.waitForTimeout(900);

  // stand at the ball wall and look at it
  // walk.yaw: forward = (-sin yaw, -cos yaw). yaw 0 looks toward -z (the north wall).
  const shots = [
    { name: 'ballwall', x: -6.9, z: -3.9, yaw: 0, pitch: -0.02 },
    { name: 'accessories', x: -3.7, z: -3.9, yaw: 0, pitch: -0.02 },
    { name: 'gloves-socks', x: -0.5, z: -3.9, yaw: 0, pitch: -0.02 },
    { name: 'clubwall', x: -7.4, z: -0.2, yaw: Math.PI / 2, pitch: 0.02 },
    { name: 'apparel', x: -5.9, z: 3.2, yaw: 0, pitch: -0.02 },
    { name: 'hats-rail', x: -2.9, z: 1.8, yaw: 0, pitch: 0.0 },
    { name: 'bags', x: 2.2, z: 0.2, yaw: 0, pitch: -0.05 },
    { name: 'shoes', x: 2.9, z: -0.6, yaw: -Math.PI / 2, pitch: 0 },
  ];
  for (const s of shots) {
    await page.evaluate((sh) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk.state;
      w.x = sh.x + o.x; w.z = sh.z + o.z; w.yaw = sh.yaw; w.pitch = sh.pitch;
    }, s);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/shelf-${s.name}.png` });
  }

  return { counts, errs: errs.slice(0, 6), errCount: errs.length };
}
