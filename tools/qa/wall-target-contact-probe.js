async (page) => {
  // Why do the four wall/corner cleaning targets (entry leaves, NW cobweb,
  // both wall scuffs) never advance under driver tool bursts? Capture the
  // game's own refusal toasts and the focus prompt while bursting each pose
  // from its most open floor side.
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

  const cases = [
    { id: 'entry:leaves-trash', x: -2.72, z: 5.15, tool: 'broom', standDx: 0, standDz: -0.85 },
    { id: 'corner:cobweb-nw', x: -8.50, z: -4.30, tool: 'vacuum', standDx: 0.85, standDz: 0.85 },
    { id: 'wall:scuff-west', x: -8.65, z: -1.05, tool: 'spray', standDx: 0.85, standDz: 0 },
    { id: 'wall:scuff-east', x: 4.15, z: 3.25, tool: 'spray', standDx: -0.85, standDz: 0 },
  ];
  const results = [];
  for (const c of cases) {
    await page.evaluate(({ x, z, fx, fz }) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + x;
      walk.state.z = origin.z + z;
      const dx = fx - x; const dz = fz - z;
      const L = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / L, -dz / L);
      walk.state.pitch = -0.55;
    }, { x: c.x + c.standDx, z: c.z + c.standDz, fx: c.x, fz: c.z });
    await page.waitForTimeout(280);
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), c.tool);
    await page.waitForTimeout(260);
    const before = await page.evaluate(async (id) => {
      const { restorationSnapshot } = await import('/src/sim/clubhouseRestoration.js');
      return {
        progress: restorationSnapshot(window.__fw.state).targetProgress[id] || 0,
        focus: window.__fw.scene3d.walk.getFocusLabel?.() || '',
        tool: window.__fw.scene3d.walk.getTool?.() || null,
      };
    }, c.id);
    await page.evaluate(() => { document.querySelectorAll('.toast, [class*=toast]').forEach((n) => { n.dataset.qaSeen = '1'; }); });
    await page.mouse.down();
    await page.waitForTimeout(1400);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await page.evaluate(async (id) => {
      const { restorationSnapshot } = await import('/src/sim/clubhouseRestoration.js');
      const toasts = [...document.querySelectorAll('.toast, [class*=toast]')]
        .filter((n) => !n.dataset.qaSeen)
        .map((n) => n.textContent.trim()).filter(Boolean).slice(0, 4);
      return {
        progress: restorationSnapshot(window.__fw.state).targetProgress[id] || 0,
        toasts,
        allToastText: (document.querySelector('#toasts, .toasts, [class*=toast]')?.textContent || '').slice(0, 240),
      };
    }, c.id);
    results.push({ id: c.id, tool: c.tool, before, after });
    await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
  }
  return results;
}
