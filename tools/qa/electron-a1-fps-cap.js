// A1 — DOES THE FRAMERATE CAP ACTUALLY PACE THE GAME?
//
// Achieved RENDER rate, not rAF rate: the gate schedules rAF on every vsync
// tick and skips the frame body, so counting rAF would read 240 whatever the
// cap does. renderer.info.render.frame increments only when the game draws —
// deltas of that counter across rAF ticks are the real cadence.
//
// Both failure directions are covered live (golf-qa law 1):
//   - cap 60 must read ~60: on a build without the gate this leg reads ~200+
//     (the unfixed shape, watched fail before the gate landed)
//   - cap 0 must read near panel rate: a gate stuck ON would fail this leg
// Cadence quality is reported as the % of render intervals within 20% of the
// requested interval — the "without missing cadence" number A1's default rests on.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-fps-cap.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-fps-cap');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], runs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const fw = window.__fw;
    fw.state.clock.minutes = Math.floor(fw.state.clock.minutes / 1440) * 1440 + 14 * 60;
    fw.speedIdx = 0;
  });

  const measure = (ms) => page.evaluate((dur) => new Promise((resolve) => {
    const info = window.__fw.scene3d.renderer.info;
    const intervals = [];
    let lastFrame = info.render.frame;
    let lastTs = performance.now();
    const t0 = lastTs;
    const tick = (ts) => {
      const f = info.render.frame;
      if (f !== lastFrame) {
        intervals.push(ts - lastTs);
        lastTs = ts;
        lastFrame = f;
      }
      if (ts - t0 < dur) requestAnimationFrame(tick);
      else resolve(intervals);
    };
    requestAnimationFrame(tick);
  }), ms);

  const setCap = (cap) => page.evaluate((c) => {
    window.__fw.preferences.set('display.fpsCap', c);
    return window.__fw.preferences.values.display.fpsCap;
  }, cap);

  for (const cap of [60, 120, 144, 0]) {
    const applied = await setCap(cap);
    await page.waitForTimeout(800);
    const intervals = await measure(6000);
    const v = intervals.slice(5).sort((a, b) => a - b);
    const median = v[Math.floor(v.length / 2)] ?? 0;
    const fps = median > 0 ? 1000 / median : 0;
    const want = cap > 0 ? 1000 / cap : null;
    const onCadence = want
      ? v.filter((i) => Math.abs(i - want) <= want * 0.2).length / v.length
      : null;
    out.runs.push({
      cap, applied, n: v.length,
      medianIntervalMs: +median.toFixed(2),
      achievedFps: +fps.toFixed(1),
      onCadencePct: onCadence == null ? null : +(onCadence * 100).toFixed(1),
    });
  }
  await setCap(120);

  const r = Object.fromEntries(out.runs.map((x) => [x.cap, x]));
  out.verdict = {
    cap60Holds: r[60].achievedFps > 55 && r[60].achievedFps < 66 && r[60].onCadencePct > 80,
    // Facts, not gates: 120/144 do not hold today (CPU submit is the wall,
    // see electron-a1-cpu-split.js). Reported so the day 120 starts pacing,
    // this driver says so and the default gets flipped.
    cap120Fps: r[120].achievedFps,
    cap120OnCadencePct: r[120].onCadencePct,
    cap144Fps: r[144].achievedFps,
    uncappedFps: r[0].achievedFps,
    // The gate must not be stuck on: uncapped must clearly exceed the 60 rung.
    uncappedClearsCap60: r[0].achievedFps > 80,
    pass: null,
  };
  out.verdict.pass = out.verdict.cap60Holds && out.verdict.uncappedClearsCap60;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('A1-FPSCAP', JSON.stringify(out.verdict));
  for (const x of out.runs) console.log(' ', JSON.stringify(x));
}
