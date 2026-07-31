async (page) => {
  // Static frame with the solve's own points drawn, so "the hands are not on
  // the shaft" becomes a measurement instead of an impression.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/broom-round3-markers.js
  //
  // Red   = the asset's FloorContact socket (where the rig puts the bristles)
  // Green = the asset's GripPrimary socket  (where the upper hand is seated)
  // Blue  = the asset's GripSupport socket  (the lower hand)
  // Yellow= the right hand group's own origin
  // If red/green/blue are collinear along the drawn handle and yellow sits on
  // green, the rig is correct and any remaining complaint is composition.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/broom-round3/markers');
  fs.mkdirSync(OUT, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4;
    w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
    document.querySelectorAll('.hud, .hud-min, .shop-lockhint, .notification-center, '
      + '.walk-overlay, .objectives-card, .shed-checklist').forEach((n) => { n.style.display = 'none'; });
  });
  await page.waitForTimeout(1000);
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2600);

  const markAndShoot = async (pitch, name) => {
    await page.evaluate((pv) => { window.__fw.scene3d.walk.state.pitch = pv; }, pitch);
    await page.waitForTimeout(700);
    const info = await page.evaluate(() => {
      const app = window.__fw;
      let tool = null;
      app.scene3d.scene.traverse((o) => { if (o.name === 'Tool_broom') tool = o; });
      if (!tool) return null;
      // drop marker spheres (once) onto the viewmodel layer
      const Vec3 = tool.position.constructor;
      const mk = (name2, hex, target) => {
        let m = tool.getObjectByName(name2);
        if (!m) {
          const src = tool.getObjectByName('SOCKET_FloorContact') || tool;
          const geoOwner = [];
          tool.traverse((o) => { if (o.isMesh) geoOwner.push(o); });
          const proto = geoOwner[0];
          if (!proto) return null;
          m = new proto.constructor(
            new proto.geometry.constructor(0.035, 10, 8),
            new proto.material.constructor({ color: hex }),
          );
          m.name = name2;
          m.layers.set(29);
          tool.add(m);
          void src;
        }
        m.position.copy(target);
        m.layers.set(29);
        return m;
      };
      const local = (n) => {
        const o = tool.getObjectByName(n);
        if (!o) return null;
        const v = new Vec3();
        tool.updateWorldMatrix(true, true);
        const inv = tool.matrixWorld.clone().invert();
        o.getWorldPosition(v).applyMatrix4(inv);
        return v;
      };
      const contact = local('SOCKET_FloorContact');
      const gp = local('SOCKET_GripPrimary');
      const gs = local('SOCKET_GripSupport');
      if (contact) mk('DBG_contact', 0xff2020, contact);
      if (gp) mk('DBG_gripPrimary', 0x20ff20, gp);
      if (gs) mk('DBG_gripSupport', 0x2060ff, gs);
      // the right hand's own origin, expressed in tool-local
      let rh = null;
      app.scene3d.scene.traverse((o) => { if (o.name === 'FirstPersonRightHand') rh = o; });
      if (rh) {
        const v = new Vec3();
        tool.updateWorldMatrix(true, true);
        const inv = tool.matrixWorld.clone().invert();
        rh.getWorldPosition(v).applyMatrix4(inv);
        mk('DBG_rightHand', 0xffe020, v);
        return {
          contact: contact?.toArray().map((n) => +n.toFixed(3)),
          gripPrimary: gp?.toArray().map((n) => +n.toFixed(3)),
          rightHandLocal: v.toArray().map((n) => +n.toFixed(3)),
          offsetFromGrip: gp ? +v.distanceTo(gp).toFixed(4) : null,
        };
      }
      return null;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, name) });
    return info;
  };

  const level = await markAndShoot(0, '01-level-markers.png');
  const work = await markAndShoot(-0.75, '02-working-markers.png');
  return { ok: true, level, work };
}
