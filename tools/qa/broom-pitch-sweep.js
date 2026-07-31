async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/broom-round3/pitch');
  fs.mkdirSync(OUT, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const c0 = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await c0.isVisible({ timeout: 1500 }).catch(() => false)) await c0.click();
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
  const out = {};
  for (const p of [0.30, 0.15, 0.0, -0.2, -0.35, -0.5, -0.65, -0.8, -1.0]) {
    await page.evaluate((pv) => { window.__fw.scene3d.walk.state.pitch = pv; }, p);
    await page.waitForTimeout(700);
    const d = await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics());
    out[`pitch_${p}`] = { headNdc: d.headNdc, workBlend: d.workBlend, reach: d.drawReach };
    await page.screenshot({ path: path.join(OUT, `pitch${String(p).replace('.', 'p')}.png`) });
  }
  // The head must stay ON SCREEN across the whole pitch range — the dip in the
  // middle of the carry->work blend was invisible to a two-sample check.
  const all = Object.entries(out);
  const off = all.filter(([, v]) => !(v.headNdc.y > -1 && v.headNdc.y < 1))
    .map(([k, v]) => `${k}: y ${v.headNdc.y}`);
  return { ok: off.length === 0, offScreen: off, ...out };
}
