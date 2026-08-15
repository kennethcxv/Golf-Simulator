// E2 — the three floor tools, at the player's camera.
//
// The audit numbers say mop, vacuum and dustpan now sit on the boards and hold
// there across the look range. A number is not a picture, and this project has
// shipped three fixes that measured right and looked wrong, so this is the
// picture: each tool at the pose you work in and at the pose you walk in.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/floor-tools');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    document.querySelectorAll('.hud,.hud-min,.shop-lockhint,.notification-center,.walk-overlay,.objectives-card')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.mouse.click(800, 450);
  await page.waitForTimeout(600);

  const rows = [];
  for (const [id, workPitch] of [['mop', -0.62], ['vacuum', -0.60], ['dustpan', -0.66]]) {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), id);
    await page.waitForTimeout(1800);

    // MID-USE, MEASURED SEPARATELY FROM AT-REST.
    //
    // The floor solve runs early in the frame; the use-motion driver writes x
    // and z later, and on a pitched group a z change moves the contact socket
    // vertically by z*sin(pitch). So "on the boards while idle" and "on the
    // boards while working" are two different claims, and only the second one
    // is the one a player is looking at. Sampled over a full stroke cycle
    // rather than once, because a single frame can land on a zero crossing.
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, workPitch);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
    const inUse = await page.evaluate(async () => {
      const w = window.__fw.scene3d.walk;
      const seen = [];
      const started = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          const g = w.heldToolGeometry();
          if (g && g.contactAboveFloor != null) seen.push(g.contactAboveFloor);
          if (performance.now() - started >= 2200) { resolve(); return; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return seen;
    });
    await page.screenshot({ path: path.join(OUT, `${id}-inuse.png`) });
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
    await page.waitForTimeout(700);
    rows.push({
      tool: id,
      pose: 'in-use',
      pitch: workPitch,
      file: `${id}-inuse.png`,
      frames: inUse.length,
      contactAboveFloor: inUse.length ? +(inUse.reduce((a, b) => a + b, 0) / inUse.length).toFixed(4) : null,
      inUseMin: inUse.length ? +Math.min(...inUse).toFixed(4) : null,
      inUseMax: inUse.length ? +Math.max(...inUse).toFixed(4) : null,
    });

    for (const [label, pitch] of [['work', workPitch], ['level', 0], ['up', 0.7]]) {
      await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
      await page.waitForTimeout(650);
      const g = await page.evaluate(() => window.__fw.scene3d.walk.heldToolGeometry());
      const solve = await page.evaluate(() => window.__fw.scene3d.walk.floorAnchorDiagnostics());
      const file = `${id}-${label}.png`;
      await page.screenshot({ path: path.join(OUT, file) });
      rows.push({
        tool: id,
        pose: label,
        pitch,
        file,
        contactAboveFloor: g?.contactAboveFloor ?? null,
        contactNdc: g?.contactNdc ?? null,
        applied: solve.tools?.[id]?.applied ?? null,
        // the proof the correction landed rather than merely being computed
        residual: solve.tools?.[id]?.residual ?? null,
        saturated: solve.tools?.[id]?.saturated ?? null,
      });
    }
  }
  const checks = {
    // the claim that matters: the head is on the boards WHILE YOU WORK
    onTheBoardsMidUse: rows.filter((r) => r.pose === 'in-use')
      .every((r) => r.inUseMax != null && Math.abs(r.inUseMax) <= 0.05 && Math.abs(r.inUseMin) <= 0.05),
    everyToolOnTheBoards: rows.filter((r) => r.pose === 'work')
      .every((r) => r.contactAboveFloor != null && Math.abs(r.contactAboveFloor) <= 0.03),
    holdsAcrossTheLookRange: ['mop', 'vacuum', 'dustpan'].every((t) => {
      const hs = rows.filter((r) => r.tool === t && r.pose !== 'in-use').map((r) => r.contactAboveFloor);
      return Math.max(...hs) - Math.min(...hs) <= 0.03;
    }),
    // if the decomposition into the group's own frame were wrong, this is where
    // it would show: the solve would compute a correction that does not arrive
    correctionLands: rows.filter((r) => r.pose !== 'in-use')
      .every((r) => r.residual != null && Math.abs(r.residual) <= 0.01),
    neverSaturates: rows.filter((r) => r.pose !== 'in-use').every((r) => r.saturated === false),
    contactStaysOnScreenWhileWorking: rows.filter((r) => r.pose === 'work')
      .every((r) => r.contactNdc && Math.abs(r.contactNdc.x) <= 1 && Math.abs(r.contactNdc.y) <= 1),
  };
  fs.writeFileSync(path.join(OUT, 'floor-tools.json'), `${JSON.stringify({ rows, checks }, null, 1)}\n`);
  return { rows, checks, ok: Object.values(checks).every(Boolean) };
}
