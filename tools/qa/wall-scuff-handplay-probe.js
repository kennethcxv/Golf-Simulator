async (page) => {
  // Settles CLEAN-SCUFF-001: can a player with FREE CONTINUOUS aim lift a wall
  // scuff (spray, then cloth over the wet swath)? Scripted discrete stands
  // never got the cloth to fire; a human sweeps. This probe holds the mouse
  // while smoothly sweeping yaw/pitch across the scuff zone — first with the
  // spray (saturating a swath), then with the cloth (several passes).
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

  const SCUFF = { id: 'wall:scuff-west', x: -8.65, z: -1.05 };
  const STAND = { x: SCUFF.x + 0.95, z: SCUFF.z }; // close stand: head presses the wall zone

  const setPose = (yaw, pitch) => page.evaluate(({ STAND, yaw, pitch }) => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    walk.state.x = origin.x + STAND.x;
    walk.state.z = origin.z + STAND.z;
    walk.state.yaw = yaw;
    walk.state.pitch = pitch;
  }, { STAND, yaw, pitch });

  const progress = () => page.evaluate(async (id) => {
    const { restorationSnapshot } = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    return restorationSnapshot(window.__fw.state).targetProgress[id] || 0;
  }, SCUFF.id);

  // Facing west from the stand: yaw for -x direction = atan2(1, 0) = PI/2.
  const baseYaw = Math.PI / 2;
  const sweep = async (tool, passes, pitchFrom, pitchTo) => {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), tool);
    await page.waitForTimeout(300);
    await page.mouse.down();
    for (let pass = 0; pass < passes; pass += 1) {
      for (let t = 0; t <= 1; t += 0.08) {
        const yaw = baseYaw + (t - 0.5) * 0.5 * (pass % 2 === 0 ? 1 : -1);
        const pitch = pitchFrom + (pitchTo - pitchFrom) * (pass / Math.max(1, passes - 1));
        await setPose(yaw, pitch);
        await page.waitForTimeout(70);
      }
    }
    await page.mouse.up();
    await page.waitForTimeout(200);
  };

  const start = await progress();
  await sweep('spray', 2, -0.30, -0.62);
  const afterSpray = await progress();
  const wetSwath = await page.evaluate(async ({ SCUFF }) => {
    const { wetGridForRoom, solutionLevel } = await import(new URL('src/sim/cleaningWet.js', document.baseURI).href);
    const { RENO } = await import(new URL('src/sim/shop.js', document.baseURI).href);
    const grid = wetGridForRoom(RENO.room);
    const cells = [];
    for (let dz = -1.2; dz <= 1.2; dz += 0.3) {
      for (let dx = -0.6; dx <= 1.2; dx += 0.3) {
        const level = solutionLevel(window.__fw.state, grid,
          SCUFF.x + dx + RENO.room.w / 2, SCUFF.z + dz + RENO.room.d / 2);
        if (level > 0.05) cells.push({ dx: +dx.toFixed(1), dz: +dz.toFixed(1), level: +level.toFixed(2) });
      }
    }
    return cells;
  }, { SCUFF });
  await sweep('cloth', 3, -0.10, -0.45);
  const afterCloth = await progress();
  await sweep('cloth', 3, -0.30, -0.62);
  const final = await progress();
  return {
    scuff: SCUFF.id,
    start,
    afterSpray,
    wetCellsNearScuff: wetSwath.length,
    wetSample: wetSwath.slice(0, 6),
    afterCloth,
    final,
    verdict: final >= 1 ? 'player-liftable'
      : final > afterSpray ? 'cloth-lifts-slowly'
        : 'cloth-never-lifts (P1 confirmed)',
  };
}
