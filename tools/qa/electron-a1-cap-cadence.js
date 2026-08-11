// A1 (Goal 23) — DOES THE FRAME CAP PACE, OR DOES IT JUDDER?
//
// "It never feels smooth" is not a frame-RATE complaint, it is a frame-TIME
// complaint, and average fps cannot see the difference. A cap that cannot
// divide the panel's refresh interval has to alternate between one and two
// vsyncs to hit its average, and the result is a sawtooth that reads as
// stutter at any average you like.
//
// So every rung reports three things:
//   * achieved fps (the average, which is what has been reported so far)
//   * ON CADENCE % — intervals within 20% of the rung's own target
//   * the 1% LOW — the p99 interval, which is what a hitch actually is
//
// Uncapped is measured against the PANEL's own interval rather than against
// nothing, because "uncapped" on a vsynced display is not uncapped: it is
// capped at the refresh rate, and it either paces cleanly there or it does not.
//
// AND IT READS THE PLAYER'S OWN SETTINGS FIRST. The golden gate spent a week
// failing because a persisted preference on this machine differed from the
// shipped default and nothing ever looked. The complaint is about how the game
// feels ON THIS MACHINE, so what this machine is set to is evidence.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-cap-cadence.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-cap-cadence');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], rungs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  // BEFORE the menu: what is stored in this profile, untouched by the harness.
  await page.waitForFunction(() => !!document.querySelector('button, .menu-screen'), null, { timeout: 120000 }).catch(() => {});
  out.storedPreferences = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('golfempire:preferences:v1');
      if (!raw) return { present: false };
      const doc = JSON.parse(raw);
      return { present: true, camera: doc.camera, display: doc.display, accessibility: doc.accessibility };
    } catch (e) { return { present: false, why: String(e.message || e) }; }
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(6000);

  out.placed = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    const ip = ch.interior.position;
    fw.state.clock.minutes = Math.floor(fw.state.clock.minutes / 1440) * 1440 + 14 * 60;
    fw.speedIdx = 0;
    st.x = ip.x; st.z = ip.z; st.pitch = -0.05;
    return { inside: !!ch.isInside(st.x, st.z, 0.35) };
  });

  // The panel's own interval: rAF ticks with the frame body irrelevant. This is
  // the ceiling every rung is measured against.
  out.panel = await page.evaluate(() => new Promise((resolve) => {
    const ts = [];
    const t0 = performance.now();
    const tick = (t) => { ts.push(t); if (t - t0 < 2500) requestAnimationFrame(tick); else {
      const d = []; for (let i = 1; i < ts.length; i += 1) d.push(ts[i] - ts[i - 1]);
      d.sort((a, b) => a - b);
      const m = d[Math.floor(d.length / 2)];
      resolve({ rafMedianMs: +m.toFixed(3), hz: +(1000 / m).toFixed(1) });
    } };
    requestAnimationFrame(tick);
  }));

  const measure = (ms) => page.evaluate((dur) => new Promise((resolve) => {
    const info = window.__fw.scene3d.renderer.info;
    const intervals = [];
    let lastFrame = info.render.frame; let lastTs = performance.now();
    const t0 = lastTs;
    const tick = (ts) => {
      const f = info.render.frame;
      if (f !== lastFrame) { intervals.push(ts - lastTs); lastTs = ts; lastFrame = f; }
      if (ts - t0 < dur) requestAnimationFrame(tick); else resolve(intervals);
    };
    requestAnimationFrame(tick);
  }), ms);

  for (const cap of [60, 120, 144, 0]) {
    await page.evaluate((c) => window.__fw.preferences.set('display.fpsCap', c), cap);
    await page.waitForTimeout(1000);
    const raw = await measure(7000);
    const v = raw.slice(8).sort((a, b) => a - b);
    const at = (q) => (v.length ? +v[Math.min(v.length - 1, Math.floor(v.length * q))].toFixed(2) : null);
    const median = at(0.5);
    // uncapped's target is the panel, because a vsynced display is the cap
    const target = cap > 0 ? 1000 / cap : out.panel.rafMedianMs;
    const onCadence = v.length ? (100 * v.filter((i) => Math.abs(i - target) <= target * 0.2).length) / v.length : null;
    // EVENNESS is the number that matches what a person feels. A cap that
    // cannot reach its requested rate is not thereby juddering — since Goal 23
    // it deliberately delivers the nearest rate the panel can present, and the
    // question that remains is whether it delivers it EVENLY. Cadence-vs-target
    // and evenness-vs-delivered answer two different questions and both belong
    // in the table, or "120 achieved 90.9" reads as a failure instead of a fix.
    const evenness = v.length && median
      ? (100 * v.filter((i) => Math.abs(i - median) <= median * 0.2).length) / v.length : null;
    out.rungs.push({
      cap,
      targetMs: +target.toFixed(2),
      achievedFps: median ? +(1000 / median).toFixed(1) : null,
      onCadencePct: onCadence == null ? null : +onCadence.toFixed(1),
      evennessPct: evenness == null ? null : +evenness.toFixed(1),
      medianMs: median,
      onePercentLowMs: at(0.99),
      worstMs: v.length ? +v[v.length - 1].toFixed(2) : null,
      frames: v.length,
    });
    console.log('CAP', cap, JSON.stringify(out.rungs[out.rungs.length - 1]));
  }
  await page.evaluate(() => window.__fw.preferences.set('display.fpsCap', 60));

  const byCap = Object.fromEntries(out.rungs.map((r) => [r.cap, r]));
  out.verdict = {
    panelHz: out.panel.hz,
    // The instrument's own control: a cap that reads ABOVE its own target is
    // not being applied at all, and its cadence number is meaningless.
    capsActuallyApplied: out.rungs.filter((r) => r.cap > 0 && r.achievedFps <= r.cap * 1.1).map((r) => r.cap),
    capsIgnored: out.rungs.filter((r) => r.cap > 0 && r.achievedFps > r.cap * 1.1).map((r) => r.cap),
    // A cap divides the panel cleanly or it cannot pace. Reported as the ratio.
    panelRatio: Object.fromEntries(out.rungs.filter((r) => r.cap > 0)
      .map((r) => [r.cap, +(out.panel.hz / r.cap).toFixed(3)])),
    bestPacing: out.rungs.slice().sort((a, b) => (b.onCadencePct ?? -1) - (a.onCadencePct ?? -1))[0],
    uncappedFps: byCap[0]?.achievedFps ?? null,
    uncappedOnCadencePct: byCap[0]?.onCadencePct ?? null,
    defaultIsSixtyOnA: `${out.panel.hz} Hz panel`,
  };
  fs.writeFileSync(path.join(OUT, 'cap-cadence.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-CADENCE', JSON.stringify({ stored: out.storedPreferences, verdict: out.verdict }, null, 2));
  return out;
}
