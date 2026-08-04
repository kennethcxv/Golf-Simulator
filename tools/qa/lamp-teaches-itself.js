// C8 — does fixing a lamp teach itself?
//
// The claim to test is not "the repair works" (it does) but "a first-time
// player, with no overlay and no wiki, can work out WHAT is broken, WHAT it
// needs, WHERE that comes from, and WHAT TO DO — from what is on screen."
//
// So this walks to a faulty ceiling panel in the state a new save actually
// starts in and records the prompt VERBATIM at each gate, plus a screenshot of
// what the player is looking at when they read it. The four questions are then
// scored against the prompt text itself rather than against the source.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/lamp-teaches');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  // The two faults and their world stations, read from the layout rather than
  // typed in, so a moved rig moves this driver with it.
  const stations = await page.evaluate(async () => {
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const rig = layout.CEILING_PANEL_RIG;
    const panels = (rig?.panels || []).filter((p) => p.simId === 'panel-02' || p.simId === 'panel-07');
    return panels.map((p) => ({ id: p.id, simId: p.simId, x: p.x, z: p.z }));
  });

  const gates = await page.evaluate(async () => {
    const mod = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    const s = window.__fw.state;
    return {
      ceilingCircuitPowered: mod.ceilingCircuitPowered ? !!mod.ceilingCircuitPowered(s) : null,
      repairKitAvailable: mod.panelRepairKitAvailable ? !!mod.panelRepairKitAvailable(s) : null,
    };
  });

  const shots = [];
  for (const station of stations) {
    await page.evaluate((st) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk;
      w.clearKeys();
      // Stand a little south of the panel and look up at it.
      w.state.x = o.x + st.x;
      w.state.z = o.z + st.z + 1.1;
      w.state.yaw = Math.PI;
      w.state.pitch = 0.62;
      const c = app.state.clock;
      c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    }, station);
    await page.waitForTimeout(1400);
    // The prompt as the player reads it, straight off the DOM.
    const prompt = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.walk-prompt,.interact-prompt,.reticle-prompt,.prompt,.hud-prompt')]
        .map((n) => n.innerText.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
      return nodes.length ? nodes : null;
    });
    await page.screenshot({ path: path.join(OUT, `${station.simId}.png`) });
    shots.push({ station, prompt });
  }

  // Score the four questions C8 names, against the prompt STRING — not the code.
  const allText = shots.flatMap((s) => s.prompt || []).join(' | ');

  // UNFINISHED, AND IT SAYS SO RATHER THAN SCORING ZERO.
  //
  // 2026-08-04: this driver does not yet stand under a faulty panel. It reads
  // stations from shopLayout's CEILING_PANEL_RIG, which is the pine-hills-V2
  // rig; launched without --clubhouse=pine-hills-v2 it aims at bare ceiling in
  // a different room and captures no prompt at all. The four questions then
  // all score false, which reads exactly like "the lamp teaches the player
  // nothing" — a confident, wrong finding of the precise kind this harness
  // exists to prevent. So a run that never saw a prompt refuses to answer.
  if (!allText) {
    return {
      ok: false,
      inconclusive: true,
      why: 'No interaction prompt was captured at either station, so nothing about what the '
        + 'lamp teaches can be concluded. Likely causes, in order: the run was not launched '
        + 'with --clubhouse=pine-hills-v2 so CEILING_PANEL_RIG does not describe this room; the '
        + 'stand-off/aim misses the 1.45 yd interaction radius; the prompt selector list below '
        + 'does not match the shipping DOM.',
      selectorsTried: ['.walk-prompt', '.interact-prompt', '.reticle-prompt', '.prompt', '.hud-prompt'],
      gates,
      stations,
      shots,
    };
  }

  const teaches = {
    whatIsBroken: /panel|light|lamp|ceiling/i.test(allText),
    whatItNeeds: /kit|circuit|power/i.test(allText),
    whereItComesFrom: /office|stockroom|shelf|bay|desk|counter|from the/i.test(allText),
    whatToDo: /\[E\]|press E|\bE\b/i.test(allText),
  };
  return {
    gates,
    stations,
    shots,
    promptText: allText,
    teaches,
    verdict: Object.entries(teaches).filter(([, v]) => !v).map(([k]) => k),
  };
}
