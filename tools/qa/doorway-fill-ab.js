async (page) => {
  // THE DOORWAY A/B — one fixed pose, half a yard outside, looking in.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/doorway-fill-ab.js
  //
  // Play-test: "The dark interior only applies once I step inside. Standing
  // outside with the door open and looking in, the room is noticeably lighter."
  // The fill keyed off the player's position crossing the threshold, so this
  // captures the same pose with the new view-coverage term OFF (the old
  // behaviour, exactly) and ON, plus the luma of the interior the camera sees.
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

  // Find the threshold: march along +z from inside until isInside flips.
  const threshold = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const o = ch.interior.position;
    const inside = ch.isInside;
    const x = o.x - 0.8;
    // walk outward in 0.1 yd steps from a known-interior z
    let zIn = o.z + 4.2;
    if (!inside(x, zIn, 0)) {
      for (let d = 0; d < 12; d += 0.1) {
        if (inside(x, o.z + d, 0)) { zIn = o.z + d; break; }
      }
    }
    let zEdge = zIn;
    for (let d = 0; d < 14; d += 0.05) {
      const z = zIn + d;
      if (!inside(x, z, 0)) { zEdge = z; break; }
    }
    return { x, zEdge, ox: o.x, oz: o.z };
  });

  const shots = [];
  const runVariant = async (viewBlend, tag) => {
    await page.evaluate((cfg) => {
      const app = window.__fw;
      const w = app.scene3d.walk;
      w.clearKeys();
      // half a yard OUTSIDE the threshold, looking back in
      w.state.x = cfg.x;
      w.state.z = cfg.zEdge + 0.5;
      // forward is (-sin yaw, -cos yaw), so yaw 0 looks toward -z — back at
      // the building we just walked out of. (yaw PI faces the car park.)
      w.state.yaw = 0;
      w.state.pitch = -0.02;
      app.speedIdx = 0;
      const c = app.state.clock;
      c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
      app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
      app.scene3d.interiorFill.setViewBlend(cfg.viewBlend);
      document.querySelectorAll('.hud, .hud-min, .shop-lockhint, .notification-center, '
        + '.walk-overlay, .objectives-card, .shed-checklist')
        .forEach((n) => { n.style.display = 'none'; });
    }, { ...threshold, viewBlend });
    // let the ease settle (0.12/frame ≈ 0.25 s) — and confirm it HAS settled
    await page.waitForTimeout(1400);
    const readings = await page.evaluate(() => {
      const f = window.__fw.scene3d.interiorFill;
      return {
        factor: +f.factor().toFixed(4),
        viewFraction: +f.viewFraction().toFixed(4),
        hemiIntensity: +f.hemiIntensity().toFixed(4),
        viewBlendEnabled: f.viewBlendEnabled(),
      };
    });
    const file = path.join(OUT, `doorway-${tag}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    // mean luma of the middle of frame, which is the room seen through the door
    const luma = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const g = document.createElement('canvas');
      g.width = 160; g.height = 90;
      const ctx = g.getContext('2d');
      ctx.drawImage(canvas, 0, 0, 160, 90);
      const d = ctx.getImageData(40, 22, 80, 46).data; // centre half
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      }
      return +(sum / (d.length / 4)).toFixed(2);
    });
    return { ...readings, centreLuma: luma, shot: file };
  };

  const before = await runVariant(false, 'before-position-only');
  const after = await runVariant(true, 'after-view-blend');
  // restore
  await page.evaluate(() => window.__fw.scene3d.interiorFill.setViewBlend(true));

  const out = {
    ok: true,
    pose: { x: +threshold.x.toFixed(2), z: +(threshold.zEdge + 0.5).toFixed(2), facing: 'into the shop' },
    before,
    after,
    lumaDrop: +(before.centreLuma - after.centreLuma).toFixed(2),
    lumaDropPct: before.centreLuma > 0
      ? +(((before.centreLuma - after.centreLuma) / before.centreLuma) * 100).toFixed(1) : 0,
    shots,
  };
  fs.writeFileSync(path.join(OUT, 'doorway-fill-ab.json'), JSON.stringify(out, null, 2));
  return out;
}
