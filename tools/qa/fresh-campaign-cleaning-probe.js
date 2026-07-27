async (page) => {
  // Minimal isolation probe: on a genuinely fresh Relaxed campaign, does the
  // broom/dustpan spray path mutate reno.debris at all? Mirrors the seeded
  // debris-ring fixture from cleaning-tools-acceptance.js, which passes on the
  // bootstrap profile — a pass here means the starter-loop driver's geometry
  // is wrong; a fail here means fresh campaigns cannot clean, a P0.
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
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(640, 360);

  const PLAYER_LOCAL = { x: -2.0, z: 0.5 };
  await page.evaluate((P) => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.state.x = origin.x + P.x;
    walk.state.z = origin.z + P.z;
    // yaw 0 faces -z in this engine (atan2(-dx, -dz) convention). The seeded
    // ring sits at z-0.75, i.e. IN FRONT of a yaw-0 player. The original
    // yaw=PI run faced away from the ring and misread "tools do nothing".
    walk.state.yaw = 0;
    walk.state.pitch = -0.55;
    const list = app.state.shop.reno.debris;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      list.push({
        x: +(P.x + Math.cos(a) * 0.42).toFixed(3),
        z: +(P.z - 0.75 + Math.sin(a) * 0.42).toFixed(3),
        a: 0.22,
      });
    }
  }, PLAYER_LOCAL);
  await page.waitForTimeout(300);

  const snap = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return {
      total: +ch.debrisTotal().toFixed(3),
      count: ch.debrisCount(),
      pan: +(Number(window.__fw.state.shop.reno.pan) || 0).toFixed(3),
      tool: window.__fw.scene3d.walk.getTool?.() || null,
      spraying: window.__fw.scene3d.walk.isSpraying?.() ?? null,
      campaignEnabled: !!window.__fw.state.campaign?.enabled,
    };
  });

  const before = await snap();
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
  await page.waitForTimeout(2200);
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
  const afterBroom = await snap();
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('dustpan'));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
  const afterPan = await snap();
  return { before, afterBroom, afterPan };
}
