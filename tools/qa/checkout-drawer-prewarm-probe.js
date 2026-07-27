async (page) => {
  await page.reload();
  await page.waitForTimeout(900);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });

  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    app.speedIdx = 0;
    for (const skuId of ['tees1', 'marker1', 'glove1']) {
      app.state.shop.inventory[skuId].shelf = Math.max(12, app.state.shop.inventory[skuId].shelf || 0);
    }
    clubhouse.rebuildStock();
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 + clubhouse.interior.position.x;
    walk.z = 5.35 + clubhouse.interior.position.z;
    walk.yaw = 0;
    walk.pitch = -0.18;
    if (!clubhouse.sendToCounter(['tees1', 'marker1', 'glove1'], 'cash')) {
      throw new Error('Could not create the deterministic cash prewarm customer.');
    }
  });
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx()?.items.length === 3, null, { timeout: 15000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });

  const samples = [];
  for (let index = 0; index < 30; index += 1) {
    samples.push(await page.evaluate(() => {
      const app = window.__fw;
      const register = app.scene3d.clubhouse().register;
      const status = register.drawerPrewarmStatus();
      return {
        atMs: Math.round(performance.now()),
        status,
        cashGpuPrewarm: register.cashGpuPrewarmStatus(),
        renderer: { ...app.scene3d.renderer.info.memory },
      };
    }));
    if (samples.at(-1).status?.complete) break;
    await page.waitForTimeout(50);
  }
  return { ok: samples.at(-1)?.status?.complete === true, samples };
}
