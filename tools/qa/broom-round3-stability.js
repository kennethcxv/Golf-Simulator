async (page) => {
  // Is the rig STILL at rest? Sample the same numbers repeatedly at level
  // pitch with nothing held down. The round-3 solve reads the tool's sockets
  // every frame, and those sockets are driven by the authored equip/work
  // clips — if those clips keep moving, the rig chases them and the frame
  // pumps, which is why a measurement and a screenshot 200 ms apart disagreed.
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    w.clearKeys(); w.state.pitch = 0;
  });
  await page.mouse.click(640, 360);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(3000);

  const sample = () => page.evaluate(() => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const d = w.broomDiagnostics();
    let tool = null;
    app.scene3d.scene.traverse((o) => { if (o.name === 'Tool_broom') tool = o; });
    const gp = tool?.getObjectByName('SOCKET_GripPrimary');
    const Vec3 = tool.position.constructor;
    let socketLocal = null;
    if (gp) {
      const v = new Vec3();
      tool.updateWorldMatrix(true, true);
      const inv = tool.matrixWorld.clone().invert();
      gp.getWorldPosition(v).applyMatrix4(inv);
      socketLocal = v.toArray().map((n) => +n.toFixed(3));
    }
    return {
      headNdc: d.headNdc,
      gripUpper: d.gripUpper,
      toolPos: tool.position.toArray().map((n) => +n.toFixed(3)),
      socketLocal,
    };
  });

  const samples = [];
  for (let i = 0; i < 8; i += 1) {
    samples.push(await sample());
    await page.waitForTimeout(220);
  }
  const ys = samples.map((s) => s.headNdc.y);
  return {
    ok: true,
    headNdcYSpread: +(Math.max(...ys) - Math.min(...ys)).toFixed(3),
    samples,
  };
}
