async (page) => {
  // WHERE IS THE BROOM ACTUALLY POINTING?
  //
  //   node tools/qa/run-playwright.cjs tools/qa/broom-aim.js
  //
  // The play-test report is "the broom points at the CEILING, not the floor".
  // That is a claim about the DRAWN MESH, and the rig's existing diagnostics
  // cannot settle it: every number in there is computed in the frame the solve
  // believes in, so if the solve is working from the wrong shaft axis the
  // numbers agree with each other and still describe a broom aimed upward.
  //
  // So this driver reads two things the solve does not own:
  //
  //   shaftDrop   yards the asset's own FloorContact socket hangs BELOW its
  //               GripPrimary socket, in world space, after the pose. A broom
  //               sweeps the floor, so this must be solidly NEGATIVE.
  //   geomSource  whether the solve measured the live GLB ('live') or silently
  //               fell back to FALLBACK_GEOM ('fallback'), whose axis is 126
  //               degrees away from the authored asset's.
  //
  // ...and it takes pictures, because the acceptance is visual.
  //
  // NEGATIVE CONTROLS, run before any reading is trusted:
  //   1. the viewmodel must report vmActive — otherwise we are photographing a
  //      broom that was never equipped and every number below is of nothing;
  //   2. the three pitch samples must actually DIFFER — if setting pitch does
  //      not move the rig, all three frames are the same frame and the sweep
  //      across the look range measured nothing.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/broom-aim');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // Stand in open floor facing a clear span, midday, world paused so the frame
  // is reproducible, HUD out of the way.
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
  await page.waitForTimeout(800);
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2800);

  const sample = async (pitch, name) => {
    await page.evaluate((pv) => { window.__fw.scene3d.walk.state.pitch = pv; }, pitch);
    await page.waitForTimeout(800);
    // the rig's diagnostics hang off the WALK api, not scene3d directly
    const d = await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics?.() ?? null);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    return { pitch, name, d };
  };

  const shots = [];
  shots.push(await sample(0, 'pitch-level'));
  shots.push(await sample(-0.45, 'pitch-down-mid'));
  shots.push(await sample(-1.0, 'pitch-down-steep'));

  // --- negative control 1: was anything equipped at all? --------------------
  const vmActive = shots.every((s) => s.d && s.d.vmActive === true);

  // --- negative control 2: did the pitch sweep actually move the rig? -------
  // If the three samples are identical the driver photographed one pose three
  // times and learned nothing about the look range.
  const ndcYs = shots.map((s) => s.d?.headNdc?.y ?? null);
  const distinctPoses = new Set(ndcYs.map((v) => (v == null ? 'null' : v.toFixed(2)))).size > 1;

  const report = {
    vmActive,
    distinctPoses,
    controlsPassed: vmActive && distinctPoses,
    samples: shots.map((s) => ({
      name: s.name,
      pitch: s.pitch,
      // the two readings that do not depend on the solve being right
      geomSource: s.d?.geomSource ?? null,
      shaftDrop: s.d?.shaftDrop ?? null,
      shaftDropUnit: s.d?.shaftDropUnit ?? null,
      // the acceptance number for "riding the floor"
      headAboveFloor: s.d?.headAboveFloor ?? null,
      assetHeadNdc: s.d?.assetHeadNdc ?? null,
      // the rig's own view of itself, for comparison
      headNdc: s.d?.headNdc ?? null,
      workBlend: s.d?.workBlend ?? null,
      drawReach: s.d?.drawReach ?? null,
      seatError: s.d?.seatError ?? null,
    })),
  };
  // The verdict the play-test asked about: is the head below the hands at
  // every pitch? Reported per sample so a pose that only fails when you look
  // down cannot hide behind an average.
  report.pointsAtFloor = report.samples.every((s) => s.shaftDrop != null && s.shaftDrop < -0.2);
  report.pointsAtCeiling = report.samples.filter((s) => s.shaftDrop != null && s.shaftDrop > 0)
    .map((s) => s.name);
  fs.writeFileSync(path.join(OUT, 'broom-aim.json'), JSON.stringify(report, null, 2));
  return { ok: report.controlsPassed && report.pointsAtFloor, ...report };
}
