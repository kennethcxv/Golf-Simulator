// Enter/exit the front desk many times and run several full transactions, then
// confirm listeners, scene nodes, geometries and textures have not grown — the
// register must not leak across repeated use.
async (page) => {
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    window.__L = {};
    const add = window.addEventListener.bind(window); const rm = window.removeEventListener.bind(window);
    window.addEventListener = (t, f, o) => { window.__L[t] = (window.__L[t] || 0) + 1; return add(t, f, o); };
    window.removeEventListener = (t, f, o) => { window.__L[t] = (window.__L[t] || 0) - 1; return rm(t, f, o); };
    const app = window.__fw; const ch = app.scene3d.clubhouse();
    ch.setOrganicWalkins(false); ch.clearWalkins();
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inv = app.state.shop.inventory[id];
      if (['tees1', 'marker1', 'glove1'].includes(id)) inv.shelf = Math.max(inv.shelf, 40);
    }
    app.speedIdx = 0; ch.rebuildStock();
    const o = ch.interior.position; const w = app.scene3d.walk.state;
    w.x = 2.80 + o.x; w.z = 5.10 + o.z; w.yaw = 0; w.pitch = -0.18;
  });
  await page.waitForTimeout(400);

  const snap = () => page.evaluate(() => {
    const app = window.__fw; const ch = app.scene3d.clubhouse();
    let nodes = 0; ch.interior.traverse(() => { nodes += 1; });
    const info = app.scene3d.renderer.info;
    return {
      nodes,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      listeners: Object.entries(window.__L).reduce((s, [, v]) => s + Math.max(0, v), 0),
    };
  });

  // warm up (first entry builds one-time things), then measure the stable baseline
  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => window.__fw.scene3d.clubhouse().register.enter());
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(60);
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave());
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(60);
  }
  const before = await snap();

  // 40 enter/exit cycles
  for (let i = 0; i < 40; i++) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => window.__fw.scene3d.clubhouse().register.enter());
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(30);
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave());
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(500);
  const after = await snap();

  const delta = {
    nodes: after.nodes - before.nodes,
    geometries: after.geometries - before.geometries,
    textures: after.textures - before.textures,
    listeners: after.listeners - before.listeners,
  };
  return { before, after, delta, errs: errs.slice(0, 6) };
}
