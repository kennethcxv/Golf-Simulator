// Drive to the open-drawer state and dump the 10 slot screen positions + world
// Y range, so the cash camera can be tuned to frame both rows. Screenshots the
// drawer along the way.
async (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));

  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1000);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(140);

  await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    ch.setOrganicWalkins(false);
    ch.clearWalkins();
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inv = app.state.shop.inventory[id];
      if (['tees1', 'marker1', 'glove1'].includes(id)) inv.shelf = Math.max(inv.shelf, 12);
    }
    app.speedIdx = 0;
    ch.rebuildStock();
    const off = ch.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 + off.x; walk.z = 5.10 + off.z; walk.yaw = 0; walk.pitch = -0.18;
    ch.sendToCounter(['tees1', 'marker1', 'glove1'], 'cash');
  });

  await page.waitForFunction(() => {
    const r = window.__fw.scene3d.clubhouse().register;
    return r.hasTx() && r.getFlow() && r.getFlow().state === 'WaitingForCashier';
  }, null, { timeout: 15000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 5000 });

  // force the price so change is due, then accept the cash to open the drawer
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const prices = [6.90, 9.20, 19.62];
    tx.items.forEach((it, i) => { it.price = prices[i]; it.priceCents = Math.round(prices[i] * 100); });
    tx.rng = () => 0.9;
  });
  // ring up the three items by clicking them
  const items = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid));
  // wait for auto-choose to present cash, then accept via the handful point
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'scanning';
  }, null, { timeout: 5000 });

  const project = async (local) => page.evaluate(async (p) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw; const ch = app.scene3d.clubhouse();
    const v = new THREE.Vector3(p.x + ch.interior.position.x, p.y + ch.interior.position.y, p.z + ch.interior.position.z);
    v.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((-v.y + 1) / 2) * rect.height };
  }, local);

  for (const uid of items) {
    // eslint-disable-next-line no-await-in-loop
    const pt = await page.evaluate(async (id) => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw; const ch = app.scene3d.clubhouse();
      let obj = null;
      ch.interior.traverse((o) => { if (!obj && o.visible && o.userData && o.userData.kind === 'item' && o.userData.uid === id) obj = o; });
      if (!obj) return null;
      const w = obj.getWorldPosition(new THREE.Vector3()); w.project(app.scene3d.camera);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      return { x: rect.left + ((w.x + 1) / 2) * rect.width, y: rect.top + ((-w.y + 1) / 2) * rect.height };
    }, uid);
    if (pt) { await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(700); }
  }

  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'cash-tender';
  }, null, { timeout: 8000 });
  const handful = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint());
  await page.mouse.click(handful.x, handful.y);
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx().drawerOpen, null, { timeout: 5000 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'qa/drawer-frame-probe.png' });

  // dump each slot's screen position + world Y
  const slots = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw; const ch = app.scene3d.clubhouse();
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const out = {};
    ch.interior.traverse((o) => {
      if (o.userData && o.userData.kind === 'drawer-slot') {
        const w = o.getWorldPosition(new THREE.Vector3());
        const wy = w.y;
        const p = w.clone().project(app.scene3d.camera);
        out[o.userData.denom] = {
          sx: Math.round(rect.left + ((p.x + 1) / 2) * rect.width),
          sy: Math.round(rect.top + ((-p.y + 1) / 2) * rect.height),
          inView: p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
          worldY: Math.round(wy * 1000) / 1000,
        };
      }
    });
    const cam = app.scene3d.camera;
    return { slots: out, viewport: { w: rect.width, h: rect.height }, camY: Math.round(cam.position.y * 1000) / 1000 };
  });

  return { slots, errors: errors.slice(0, 5) };
}
