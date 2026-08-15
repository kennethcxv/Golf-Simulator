// Golden world-Y pin, step 1: MEASURE what varies between boots. Records the
// interior origin, the walk eye, and the camera Y at the shop-floor pose.
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const bootMode = await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  const probe = await page.evaluate(() => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const o = app.scene3d.clubhouse().interior.position;
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    return null;
  });
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const cam = app.scene3d.camera;
    return {
      interiorY: +o.y.toFixed(5),
      interiorX: +o.x.toFixed(5),
      interiorZ: +o.z.toFixed(5),
      camY: +cam.position.y.toFixed(5),
      camX: +cam.position.x.toFixed(5),
      camZ: +cam.position.z.toFixed(5),
      walkY: Number.isFinite(app.scene3d.walk.state.y) ? +app.scene3d.walk.state.y.toFixed(5) : null,
      seed: app.state.seed,
      day: Math.floor(app.state.clock.minutes / 1440),
      cash: Math.round(app.state.cash),
    };
  });
  out.bootMode = bootMode;
  console.log('GOLDPIN-Y', JSON.stringify(out));
  void probe;
}
