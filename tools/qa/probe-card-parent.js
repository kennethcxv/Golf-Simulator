async (page) => {
  const VIEWPORT = { width: 1600, height: 900 };
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/');
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);

  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import('/src/data/shopLayout.js');
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inventory = app.state.shop.inventory[id];
      if (['tees1', 'marker1', 'glove1'].includes(id)) inventory.shelf = Math.max(inventory.shelf, 12);
    }
    app.speedIdx = 0;
    clubhouse.rebuildStock();
    const walk = app.scene3d.walk.state;
    const off = clubhouse.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.atan2(1.18 - 1.62, horizontal);
    return { customer: clubhouse.sendToCounter(['tees1', 'marker1', 'glove1'], 'card') };
  });
  if (!fixture.customer) throw new Error('no customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 20000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 5000 });
  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
  ));
  const projectObject = (query) => page.evaluate(async (q) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    let found = null;
    app.scene3d.clubhouse().interior.traverse((o) => {
      if (found || !o.visible || !o.userData) return;
      if (o.userData.kind !== q.kind || (q.uid && o.userData.uid !== q.uid)) return;
      found = o;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = bounds.getCenter(new THREE.Vector3());
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
    };
  }, query);
  for (const uid of uids) {
    let point = await projectObject({ kind: 'item', uid });
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await projectObject({ kind: 'item', uid });
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) { point = next; break; }
      point = next;
    }
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((candidate) => candidate.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 6000 });
    await page.waitForFunction(() => {
      const state = window.__fw.scene3d.clubhouse().register.getFlow()?.state;
      return state === 'WaitingForScan' || state === 'AllProductsScanned';
    }, null, { timeout: 8000 });
  }
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.getTx()?.stage === 'card-ready' && register.presentedCardScreenPoint()?.clickable;
  }, null, { timeout: 12000 });
  const chain = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    let card = null;
    window.__fw.scene3d.scene.traverse((o) => {
      if (!card && o.userData?.kind === 'payment-card') card = o;
    });
    const names = [];
    for (let node = card; node; node = node.parent) {
      names.push(`${node.name || '(anon)'}:${node.userData?.kind || node.type}`);
      if (names.length > 14) break;
    }
    const register = clubhouse.register;
    const tx = register.getTx();
    const cust = register.getCustomer();
    return {
      stage: tx?.stage,
      chain: names,
      workspace: register.workspace(),
      custHasChar: !!cust?.mesh?.userData?.char,
      gripKind: cust?.mesh?.userData?.char?.carryGrip?.('R')?.userData?.kind || null,
    };
  });
  const point = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  const picked = await page.evaluate(({ x, y }) => (
    window.__fw.scene3d.clubhouse().register.debugPickAt(x, y)
  ), point);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    return {
      stage: tx?.stage,
      flow: tx?.checkoutFlow?.state,
      insert: register.insertAt(),
      point: register.presentedCardScreenPoint(),
    };
  });
  await page.screenshot({ path: 'qa/cash-register-production/diagnostics/probe-card-click.png' });
  return { chain, point, picked, after };
}
