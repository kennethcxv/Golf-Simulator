async (page) => {
  // Measure WHERE each tool's contact actually lands relative to the player.
  // Spray deposits solution into the wet grid — spray at a known pose on open
  // floor, then scan the grid for the wettest cell: that cell minus the stand
  // is the true head offset at that pitch. Repeat across pitches.
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

  const STAND = { x: -5.5, z: 0.5 }; // open floor
  const results = [];
  for (const pitch of [-0.10, -0.35, -0.55, -0.78]) {
    await page.evaluate(({ STAND, pitch }) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + STAND.x;
      walk.state.z = origin.z + STAND.z;
      walk.state.yaw = 0; // facing -z
      walk.state.pitch = pitch;
    }, { STAND, pitch });
    await page.waitForTimeout(280);
    await page.evaluate(() => window.__fw.scene3d.walk.setTool('spray'));
    await page.waitForTimeout(260);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const wet = await page.evaluate(async (STAND) => {
      // Rebuild the same grid descriptor the clubhouse uses and read the
      // strongest solution cell directly; wet coordinates are corner-indexed
      // room yards (local + room/2).
      const { wetGridForRoom, solutionLevel } = await import(new URL('src/sim/cleaningWet.js', document.baseURI).href);
      const { RENO } = await import(new URL('src/sim/shop.js', document.baseURI).href);
      const app = window.__fw;
      const grid = wetGridForRoom(RENO.room);
      let best = null;
      for (let dz = -3.0; dz <= 3.0; dz += 0.25) {
        for (let dx = -1.5; dx <= 1.5; dx += 0.25) {
          const wx = STAND.x + dx + RENO.room.w / 2;
          const wz = STAND.z + dz + RENO.room.d / 2;
          const level = solutionLevel(app.state, grid, wx, wz);
          if (Number.isFinite(level) && level > 0.02 && (!best || level > best.level)) {
            best = { dx: +dx.toFixed(2), dz: +dz.toFixed(2), level: +level.toFixed(3) };
          }
        }
      }
      return best;
    }, STAND).catch((error) => ({ error: String(error).slice(0, 160) }));
    results.push({ pitch, wet });
    // Dry the spot between samples so the next pitch reads its own deposit.
    await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
    await page.waitForTimeout(300);
  }
  return { stand: STAND, facing: 'minus-z (yaw 0)', results };
}
