// G1 — SHOES POINT FORWARD, NO SLAB. Spawns counter-bound customers and
// frames their feet from the player camera mid-walk. The toe must lead the
// direction of travel and nothing pale may rim out under the sole.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-g1-shoes.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/g1-shoes');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const app = window.__fw;
    // organic browsers walk the OPEN floor - their feet are not hidden by
    // the counter the way sendToCounter head-of-queue spawns are
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    app.scene3d.clubhouse().setOrganicWalkins(true);
  });
  await page.waitForFunction(() => {
    const list = window.__fw.scene3d.clubhouse().customers();
    return list.some((c) => c.checkoutPhase === 'shopping' && c.mesh);
  }, null, { timeout: 120000 }).catch(() => {});
  const canvas = await page.$('#game');
  for (let shot = 0; shot < 6; shot += 1) {
    await page.waitForTimeout(shot < 3 ? 450 : 1600);
    const posed = await page.evaluate(() => {
      const app = window.__fw;
      const list = app.scene3d.clubhouse().customers();
      // prefer whoever is still WALKING (far from where they are heading)
      const walking = list.find((k) => k.checkoutPhase === 'shopping' || k.checkoutPhase === 'placing');
      const c = walking || list[list.length - 1] || list[0];
      if (!c || !c.mesh) return false;
      const w = app.scene3d.walk.state;
      const m = c.mesh.position;
      // stand 1.6 m from the customer, look at the feet
      const yawTo = Math.atan2(w.x - m.x, w.z - m.z);
      w.x = m.x + Math.sin(yawTo) * 1.6;
      w.z = m.z + Math.cos(yawTo) * 1.6;
      const dx = m.x - w.x;
      const dz = m.z - w.z;
      const h = Math.hypot(dx, dz) || 0.001;
      w.yaw = Math.atan2(-dx / h, -dz / h);
      w.pitch = -0.55;
      return { customer: c.name || c.id, type: c.customerType || null };
    });
    await page.waitForTimeout(250);
    await (canvas || page).screenshot({ path: path.join(OUT, `feet-${shot}.png`) });
    console.log('shot', shot, JSON.stringify(posed));
  }
}
