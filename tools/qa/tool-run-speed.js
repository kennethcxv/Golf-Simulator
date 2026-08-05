// I2 — the measured yd/s, from the running build, before/after being the
// point: empty-handed run vs broom-out run in the same open lane.
async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  // OUTDOORS. The first run measured 0.507/0.490/0.499 yd/s on all three legs
  // — the shop floor has no 1.6-second runway anywhere, so every leg was a
  // shuffle against fixtures (the exact wall-not-dead-input conflation the
  // withdrawn hold-W finding taught). The fairway south of the porch is open
  // ground for tens of yards.
  const lane = () => page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x; w.state.z = o.z + 26; w.state.yaw = Math.PI; w.state.pitch = 0;
  });
  await lane();
  await page.mouse.click(640, 360);
  await page.waitForTimeout(500);

  const runLeg = async (tool) => {
    await page.evaluate((id) => window.__fw.scene3d.walk.setTool(id), tool);
    await page.waitForTimeout(tool ? 2200 : 600);
    await lane();
    await page.waitForTimeout(300);
    const a = await page.evaluate(() => ({ x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z, t: performance.now() }));
    await page.keyboard.down('Shift');
    await page.keyboard.down('w');
    await page.waitForTimeout(1600);
    const b = await page.evaluate(() => ({ x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z, t: performance.now() }));
    await page.keyboard.up('w');
    await page.keyboard.up('Shift');
    return +((Math.hypot(b.x - a.x, b.z - a.z) / ((b.t - a.t) / 1000))).toFixed(3);
  };

  const emptyRun = await runLeg(null);
  const broomRun = await runLeg('broom');
  const mopRun = await runLeg('mop');
  const out = {
    emptyRunYdS: emptyRun,
    broomRunYdS: broomRun,
    mopRunYdS: mopRun,
    checks: {
      emptyRunNearAuthority: Math.abs(emptyRun - 6.12) < 0.6,
      toolRunNearAuthority: Math.abs(broomRun - 4.25) < 0.5 && Math.abs(mopRun - 4.25) < 0.5,
      toolRunActuallySlower: broomRun < emptyRun - 1.0,
    },
  };
  out.ok = Object.values(out.checks).every(Boolean);
  return out;
}
