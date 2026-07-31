async (page) => {
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });

  const customerName = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    if (typeof ch.setOrganicWalkins === 'function') ch.setOrganicWalkins(false);
    if (typeof ch.clearWalkins === 'function') ch.clearWalkins();
    app.speedIdx = 0;
    app.state.shop.inventory.tees1.shelf = Math.max(10, app.state.shop.inventory.tees1.shelf || 0);
    ch.rebuildStock();
    const eye = { x: 2.78, y: 1.68, z: 5.24 };
    const at = { x: 2.52, y: 1.04, z: 4.02 };
    const dx = at.x - eye.x;
    const dz = at.z - eye.z;
    const dh = Math.hypot(dx, dz);
    const walk = app.scene3d.walk.state;
    walk.x = eye.x + ch.interior.position.x;
    walk.z = eye.z + ch.interior.position.z;
    walk.yaw = Math.atan2(-dx / dh, -dz / dh);
    walk.pitch = Math.atan2(at.y - eye.y, dh);
    const name = ch.sendToCounter(['tees1'], 'card');
    const customers = typeof ch.customers === 'function' ? ch.customers() : [];
    const customer = customers.find((entry) => entry.name === name);
    if (customer) customer.patience = 300;
    return name;
  });
  if (!customerName) throw new Error('Interaction smoke could not create fixture customer.');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.hasTx(), null,
    { timeout: 20000 });

  const snapshot = () => page.evaluate(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return {
      active: register.isActive(),
      hasTx: register.hasTx(),
      flow: register.getFlow()?.state || null,
      stage: register.getTx()?.stage || null,
    };
  });
  const enter = async (label) => {
    await page.keyboard.press('e');
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      return register.isActive() && register.getFlow()?.state === 'WaitingForScan';
    }, null, { timeout: 5000 }).catch(async (error) => {
      throw new Error(`${label}: ${error.message}; state=${JSON.stringify(await snapshot())}`);
    });
  };
  const leave = async (label) => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null,
      { timeout: 5000 }).catch(async (error) => {
      throw new Error(`${label}: ${error.message}; state=${JSON.stringify(await snapshot())}`);
    });
  };

  const checkpoints = [];
  await enter('initial enter');
  checkpoints.push({ step: 'initial-enter', ...(await snapshot()) });
  for (let cycle = 1; cycle <= 3; cycle++) {
    await leave(`cycle ${cycle} leave`);
    checkpoints.push({ step: `cycle-${cycle}-leave`, ...(await snapshot()) });
    await enter(`cycle ${cycle} enter`);
    checkpoints.push({ step: `cycle-${cycle}-enter`, ...(await snapshot()) });
  }
  return { ok: true, customerName, checkpoints };
}
