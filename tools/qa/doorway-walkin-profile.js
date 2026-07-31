async (page) => {
  // THE WALK-IN PROFILE. "You can see the room get noticeably darker once I
  // walk in. The room should be dark even when viewing it outside the door."
  //
  //   node tools/qa/run-playwright.cjs tools/qa/doorway-walkin-profile.js
  //
  // A single A/B render at the threshold proved the doorway pose; it cannot
  // prove there is no STEP. This samples the fill along an approach — from well
  // outside, through the door, to well inside — always facing in, and reports
  // the biggest frame-to-frame jump. A smooth profile that is already dark
  // outside is the pass; a cliff anywhere is the bug the player can see.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/doorway-fill');
  fs.mkdirSync(OUT, { recursive: true });
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
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  const threshold = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const o = ch.interior.position;
    const inside = ch.isInside;
    const x = o.x - 0.8;
    let zIn = o.z + 4.2;
    if (!inside(x, zIn, 0)) {
      for (let d = 0; d < 12; d += 0.1) if (inside(x, o.z + d, 0)) { zIn = o.z + d; break; }
    }
    let zEdge = zIn;
    for (let d = 0; d < 14; d += 0.05) {
      const z = zIn + d;
      if (!inside(x, z, 0)) { zEdge = z; break; }
    }
    return { x, zEdge };
  });

  // offsets relative to the threshold: negative = inside, positive = outside
  const OFFSETS = [-3.0, -2.0, -1.2, -0.6, -0.2, 0.2, 0.6, 1.2, 2.0, 3.0, 4.5, 6.0, 8.0];
  const samples = [];
  for (const off of OFFSETS) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((cfg) => {
      const app = window.__fw;
      const w = app.scene3d.walk;
      w.clearKeys();
      w.state.x = cfg.x;
      w.state.z = cfg.zEdge + cfg.off;
      w.state.yaw = 0;       // forward is -z: back toward the building
      w.state.pitch = -0.02;
      app.speedIdx = 0;
      // main.js re-applies time/weather EVERY frame from the sim clock, so a
      // one-shot applyTimeWeather here is overwritten before the shot lands —
      // the earlier renders came out at the 6 AM start and told us nothing
      // about the daylight cost. Move the clock itself.
      const c = app.state.clock;
      c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
      app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
      document.querySelectorAll('.hud, .hud-min, .shop-lockhint, .notification-center, '
        + '.walk-overlay, .objectives-card').forEach((n) => { n.style.display = 'none'; });
    }, { ...threshold, off });
    // Wait for the EASE to converge, not for a fixed wall-clock delay. The fill
    // is eased per FRAME, and headless frame rate right after boot is a few fps
    // — a flat 1.5 s let the first stance report a half-settled 0.376 and read
    // as a game bug when it was a measurement artifact.
    // eslint-disable-next-line no-await-in-loop
    await page.waitForFunction(() => {
      const f = window.__fw.scene3d.interiorFill;
      const now = f.factor();
      const prev = window.__fillPrev;
      window.__fillPrev = now;
      return prev !== undefined && Math.abs(now - prev) < 0.002;
    }, null, { timeout: 20000, polling: 250 }).catch(() => {});
    // eslint-disable-next-line no-await-in-loop
    const r = await page.evaluate(() => {
      const app = window.__fw;
      const f = app.scene3d.interiorFill;
      const w = app.scene3d.walk;
      // ask the game whether this stance is inside, rather than inferring it
      // from the sign of an offset — the interior is not a simple slab
      const ch = app.scene3d.clubhouse();
      return {
        factor: +f.factor().toFixed(3),
        viewFraction: +f.viewFraction().toFixed(3),
        hemi: +f.hemiIntensity().toFixed(3),
        reallyInside: !!ch.isInside(w.state.x, w.state.z, 0),
      };
    });
    samples.push({ offsetYd: off, ...r });
    // three stances the player actually walks through, for the eye test: well
    // outside looking in, right at the door, and inside. They must match.
    if ([3.0, 0.6, -2.0].includes(off)) {
      const tag = off > 0 ? `out-${off}` : `in-${Math.abs(off)}`;
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({ path: path.join(OUT, `walkin-${tag}.png`) });
    }
  }

  let maxStep = 0;
  let stepAt = null;
  for (let i = 1; i < samples.length; i += 1) {
    const d = Math.abs(samples[i].factor - samples[i - 1].factor);
    if (d > maxStep) { maxStep = d; stepAt = `${samples[i - 1].offsetYd} -> ${samples[i].offsetYd}`; }
  }
  // Judge only the stances that matter: everything genuinely inside, plus the
  // approach out to 4.5 yd. Beyond that the doorway is a small feature of the
  // frame and a global lever legitimately has to let go.
  const near = samples.filter((s) => s.reallyInside || (s.offsetYd > 0 && s.offsetYd <= 4.5));
  let nearStep = 0;
  for (let i = 1; i < near.length; i += 1) {
    nearStep = Math.max(nearStep, Math.abs(near[i].factor - near[i - 1].factor));
  }
  const out = {
    ok: nearStep <= 0.12 && Math.min(...near.map((s) => s.factor)) >= 0.9,
    nearStep: +nearStep.toFixed(3),
    insideMin: +Math.min(...samples.filter((s) => s.reallyInside).map((s) => s.factor)).toFixed(3),
    maxStep: +maxStep.toFixed(3),
    stepAt,
    minFactorNearDoor: +Math.min(...near.map((s) => s.factor)).toFixed(3),
    samples,
  };
  fs.writeFileSync(path.join(OUT, 'walkin-profile.json'), JSON.stringify(out, null, 2));
  return out;
}
