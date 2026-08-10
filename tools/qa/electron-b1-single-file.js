// B1 (Goal 19) — THE LINE FORMS SINGLE FILE, BACK FROM THE DESK, ON SCREEN.
//
// Sends three walk-ins to the desk, lets them reach their slots, then stands
// the player at the default camera in front of the counter and photographs
// the line. Asserts from live actor positions: one behind another (small
// sideways spread, monotone away from the desk), body spacing in the band,
// and NOBODY INSIDE THE DESK SLAB (the image-5 clip).
// NEGATIVE CONTROL: before any walk-in is sent, the queue is empty.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-b1-single-file.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b1-single-file');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  out.setup = await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const ch = app.scene3d.clubhouse();
    const before = ch.frontDeskBridge && (typeof ch.frontDeskBridge === 'function' ? ch.frontDeskBridge() : ch.frontDeskBridge).walkIns().length;
    return { walkInsBefore: before, hasSend: typeof ch.sendWalkInToDesk === 'function' };
  });

  // three walk-ins, a beat apart so the queue orders deterministically
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => { window.__fw.scene3d.clubhouse().sendWalkInToDesk?.(); });
    await page.waitForTimeout(1200);
  }
  // let them walk; wait until three are queued and settled (or 75 s cap)
  await page.waitForFunction(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const bridge = typeof ch.frontDeskBridge === 'function' ? ch.frontDeskBridge() : ch.frontDeskBridge;
    const rows = bridge.walkIns().filter((r) => r.queued);
    return rows.length >= 3 && rows.filter((r) => r.atSlot).length >= 3;
  }, null, { timeout: 75000 }).catch(() => {});
  await page.waitForTimeout(1000);

  out.line = await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const o = ch.interior.position;
    const bridge = typeof ch.frontDeskBridge === 'function' ? ch.frontDeskBridge() : ch.frontDeskBridge;
    const rows = bridge.walkIns().filter((r) => r.queued).sort((a, b) => a.queueIndex - b.queueIndex);
    const actors = rows.map((r) => {
      const c = ch.customers().find((k) => k.customerId === r.customerId);
      return c && c.mesh ? { i: r.queueIndex, atSlot: r.atSlot, x: +(c.mesh.position.x - o.x).toFixed(2), z: +(c.mesh.position.z - o.z).toFixed(2) } : null;
    }).filter(Boolean);
    const f = L.PINE_HILLS_V2_LAYOUT.frame;
    const slab = {
      minX: f.x - L.FRONT_DESK_FRAME.frontLength / 2, maxX: f.x + L.FRONT_DESK_FRAME.frontLength / 2,
      minZ: f.z - L.FRONT_DESK_FRAME.frontDepth / 2, maxZ: f.z + L.FRONT_DESK_FRAME.frontDepth / 2,
    };
    const inSlab = actors.filter((a) => a.x > slab.minX && a.x < slab.maxX && a.z > slab.minZ && a.z < slab.maxZ);
    // stand the player IN FRONT of the line's head, facing the desk, so the
    // frame shows the file from the side the player works
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = f.x - 2.3 + o.x;
    w.state.z = f.z - 2.4 + o.z;
    const lookAt = { x: 3.2 + o.x - w.state.x, z: 1.6 + o.z + f.z - 3.35 - w.state.z };
    const h = Math.hypot(lookAt.x, lookAt.z) || 1;
    w.state.yaw = Math.atan2(-lookAt.x / h, -lookAt.z / h);
    w.state.pitch = -0.12;
    app.speedIdx = 0;
    return { actors, inSlab: inSlab.length, slab };
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'line-default-camera.png') });

  const actors = out.line.actors;
  out.checks = {
    count: actors.length,
    monotoneBack: actors.every((a, idx) => idx === 0 || a.z < actors[idx - 1].z - 0.3),
    sidewaysSpread: actors.length > 1
      ? +Math.max(...actors.map((a) => a.x)) - Math.min(...actors.map((a) => a.x))
      : 0,
    noneInSlab: out.line.inSlab === 0,
    allAtSlot: actors.every((a) => a.atSlot),
  };
  out.ok = out.setup.walkInsBefore === 0
    && out.checks.count >= 3
    && out.checks.monotoneBack
    && out.checks.sidewaysSpread <= 0.5
    && out.checks.noneInSlab;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('B1-LINE', JSON.stringify(out));
  return { ok: out.ok !== false, ...out };
}
