// A8: "the broom floats when you look up."
//
// broomViewmodel already computes THE number this needs — headAboveFloor, yards
// the DRAWN bristle socket sits above the boards under it — and calls a large
// positive "the head floating (the round-4 defect)". The existing pitch sweep
// reports headNdc and workBlend and never reports it, which is why the float
// survived a green harness.
//
// NEGATIVE CONTROL is built into the sweep rather than bolted on: the run spans
// both pose regimes, so at the steep end (workBlend 1) headAboveFloor must read
// ~floorKiss (0.012 yd). An instrument returning a constant, or reading the
// camera instead of the asset, cannot produce ~0.01 at one end and a large
// positive at the other. If the steep end is NOT ~0.01 the sweep reports
// controlFailed and no float verdict should be believed.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/broom-round6/lookup-float');
  fs.mkdirSync(OUT, { recursive: true });
  const bootUrl = `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`;
  const { clickThroughMenu } = await import(bootUrl);
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    document.querySelectorAll('.hud,.hud-min,.shop-lockhint,.notification-center,.walk-overlay,.objectives-card')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.mouse.click(640, 360);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2600);

  const rows = [];
  // +0.30 is maxPitch (the steepest UP the rig tracks); -1.0 is deep work.
  for (const p of [0.30, 0.20, 0.10, 0.0, -0.10, -0.20, -0.30, -0.40, -0.55, -0.70, -1.0]) {
    await page.evaluate((pv) => { window.__fw.scene3d.walk.state.pitch = pv; }, p);
    await page.waitForTimeout(700);
    const d = await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics());
    rows.push({
      pitch: p,
      headAboveFloor: d.headAboveFloor,
      workBlend: d.workBlend,
      shaftDrop: d.shaftDrop,
      headNdcY: d.assetHeadNdc ? d.assetHeadNdc.y : null,
      geomSource: d.geomSource,
    });
    await page.screenshot({ path: path.join(OUT, `pitch${String(p).replace('.', 'p')}.png`) });
  }

  const steep = rows[rows.length - 1];
  const controlOk = steep.headAboveFloor != null && Math.abs(steep.headAboveFloor) < 0.08;
  const lookUp = rows[0];
  const level = rows.find((r) => r.pitch === 0);

  return {
    controlOk,
    controlNote: controlOk
      ? `steep end reads ${steep.headAboveFloor} yd — the number tracks the asset, not a constant`
      : `CONTROL FAILED: steep end reads ${steep.headAboveFloor}, expected ~0.01. Ignore the verdict.`,
    // THE DEFECT IS THE LIFT, NOT THE HOVER. A carried broom rides some way
    // above the boards by design; what the playtest saw was the head RISING as
    // the view came up, because the carry pose was measured from the hands. So
    // the verdict is the spread across the carried band, not its absolute
    // height — an earlier `headAboveFloor > 0.25` predicate called the fixed
    // 0.60 carry a float and would have gone on failing after the fix.
    liftFromLevelToMaxUp: (lookUp.headAboveFloor != null && level && level.headAboveFloor != null)
      ? +(lookUp.headAboveFloor - level.headAboveFloor).toFixed(3) : null,
    floatsOnLookUp: controlOk
      && lookUp.headAboveFloor != null && level && level.headAboveFloor != null
      && Math.abs(lookUp.headAboveFloor - level.headAboveFloor) > 0.05,
    rows,
  };
}
