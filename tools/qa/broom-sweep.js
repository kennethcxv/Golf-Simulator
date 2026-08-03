async (page) => {
  // IS THERE A REAL SWEEP, OR JUST A TWITCH?
  //
  //   node tools/qa/run-playwright.cjs tools/qa/broom-sweep.js
  //
  // The review says "no real sweep animation". That is a claim about MOTION,
  // so it needs motion sampled over time, not a still. This holds the use
  // button with the broom planted and records where the bristle head actually
  // goes, in yards across the floor and in screen space.
  //
  // NEGATIVE CONTROL: the same window is sampled with the button NOT held
  // first. If the head travels the same distance idle as it does sweeping,
  // the number is bob and breathing rather than a stroke, and the "sweep"
  // measured nothing. Idle travel must be a small fraction of swept travel.
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

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4;
    w.state.yaw = -Math.PI / 2;
    w.state.pitch = -0.5; // planted on the boards
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
    document.querySelectorAll('.hud, .hud-min, .shop-lockhint, .notification-center, '
      + '.walk-overlay, .objectives-card, .shed-checklist').forEach((n) => { n.style.display = 'none'; });
  });
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2600);

  // Sample the head for `ms`, optionally with the use button held. Contact
  // world position is what the sim cleans with, so travel is measured there.
  const record = async (ms, holding) => {
    if (holding) await page.mouse.down();
    const samples = [];
    const until = Date.now() + ms;
    while (Date.now() < until) {
      samples.push(await page.evaluate(() => {
        const d = window.__fw.scene3d.walk.broomDiagnostics();
        return { swing: d.swingRad, ndcX: d.assetHeadNdc?.x ?? null, intensity: d.intensity };
      }));
      await page.waitForTimeout(50);
    }
    if (holding) await page.mouse.up();
    const swings = samples.map((s) => s.swing).filter((v) => Number.isFinite(v));
    const xs = samples.map((s) => s.ndcX).filter((v) => Number.isFinite(v));
    const span = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
    // count direction reversals in the swing — a stroke oscillates, a drift does not
    let reversals = 0;
    for (let i = 2; i < swings.length; i += 1) {
      const d1 = swings[i - 1] - swings[i - 2];
      const d2 = swings[i] - swings[i - 1];
      if (d1 !== 0 && d2 !== 0 && Math.sign(d1) !== Math.sign(d2)) reversals += 1;
    }
    return {
      samples: samples.length,
      swingSpanRad: +span(swings).toFixed(4),
      headScreenSpanNdc: +span(xs).toFixed(4),
      reversals,
      peakIntensity: +Math.max(0, ...samples.map((s) => s.intensity || 0)).toFixed(3),
    };
  };

  const idle = await record(2200, false);   // negative control FIRST
  await page.waitForTimeout(400);
  const swept = await record(2600, true);

  const report = {
    idle,
    swept,
    // the control: sweeping must move the head far more than standing still
    idleIsQuiet: idle.swingSpanRad < 0.05 && swept.swingSpanRad > idle.swingSpanRad * 4,
    // a real arc: it must actually reverse direction repeatedly, not drift once
    oscillates: swept.reversals >= 3,
    arcRadUsed: await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics().swingRad !== undefined),
  };
  report.ok = report.idleIsQuiet && report.oscillates && report.swept.swingSpanRad > 0.3;
  fs.writeFileSync(path.join(OUT, 'broom-sweep.json'), JSON.stringify(report, null, 2));
  return report;
}
