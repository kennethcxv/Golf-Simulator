// D3 — hold-to-reveal answers the tool in your hands.
//
// Four states, driven through the REAL key (Q held down), not by calling
// setDirtReveal directly: bare-handed, broom, mop, vacuum. Each gets a
// screenshot at the player's camera and the reveal's own tally.
//
// The acceptance is a DIVERGENCE, not a count: bare hands and the vacuum must
// show both media, the broom must show debris and no grime, and the mop must
// show grime and no debris. A filter that silently did nothing would produce
// four identical rows, and a filter that hid everything would produce four
// empty ones — so the pass condition cannot be met by either failure mode.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/dirt-reveal');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  // Stand in the middle of the sales floor looking down the room, so both a
  // debris field and a grime field are in frame at once.
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 4.2; w.state.z = o.z + 5.0; w.state.yaw = -Math.PI / 2; w.state.pitch = -0.34;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    document.querySelectorAll('.hud,.hud-min,.shop-lockhint,.notification-center,.walk-overlay,.objectives-card')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.mouse.click(800, 450);
  await page.waitForTimeout(600);

  // What is actually on the floor to find. If either medium is absent the whole
  // run is uninformative, so this is reported rather than assumed.
  const floor = await page.evaluate(() => {
    const app = window.__fw;
    const grime = app.state.shop?.reno?.grime || [];
    return {
      grimeCellsOverThreshold: grime.filter((g) => g > 0.06).length,
      grimeCells: grime.length,
      condition: app.scene3d.clubhouse().dirtSenseDiagnostics?.().totalDebris ?? null,
    };
  });

  const rows = [];
  for (const [label, tool] of [['bare-hands', null], ['broom', 'broom'], ['mop', 'mop'], ['vacuum', 'vacuum']]) {
    await page.evaluate((t) => { window.__fw.scene3d.walk.setTool(t); }, tool);
    // walk.setTool does NOT take effect on the calling frame — it runs a holster
    // and an equip first, and a fixed sleep here produced a clean off-by-one in
    // which the row labelled "mop" was measured while the broom was still out.
    // Wait for the reveal to actually report the tool instead of guessing how
    // long that takes.
    await page.waitForFunction(
      (t) => (window.__fw.scene3d.clubhouse().dirtSenseDiagnostics().tool ?? null) === t,
      tool, { timeout: 20000 },
    );
    await page.waitForTimeout(500);
    const probe = () => page.evaluate(() => ({
      revealTool: window.__fw.scene3d.clubhouse().dirtSenseDiagnostics().tool ?? null,
      walkTool: window.__fw.scene3d.walk.getTool?.() ?? window.__fw.scene3d.walk.state?.tool ?? 'n/a',
    }));
    const afterEquip = await probe();
    // Hold the real key. The reveal rises at 8/s, so a third of a second is
    // already saturated; a full second leaves no doubt.
    await page.keyboard.down('q');
    await page.waitForTimeout(1000);
    const duringHold = await probe();
    const d = await page.evaluate(() => window.__fw.scene3d.clubhouse().dirtSenseDiagnostics());
    d.trace = { afterEquip, duringHold };
    await page.screenshot({ path: path.join(OUT, `${label}.png`) });
    await page.keyboard.up('q');
    await page.waitForTimeout(2600); // clear the linger before the next state
    rows.push({
      label,
      tool: d.tool,
      media: d.media,
      alpha: d.alpha,
      markers: d.markers,
      debrisMarkers: d.debrisMarkers,
      grimeMarkers: d.grimeMarkers,
      hiddenByTool: d.hiddenByTool,
      perInstanceColour: d.perInstanceColour,
      trace: d.trace,
    });
  }

  const at = (l) => rows.find((r) => r.label === l) || {};
  const bare = at('bare-hands');
  const broom = at('broom');
  const mop = at('mop');
  const vac = at('vacuum');

  const checks = {
    revealActuallyRose: rows.every((r) => r.alpha > 0.9),
    bothMediaExistToFilter: bare.debrisMarkers > 0 && bare.grimeMarkers > 0,
    broomShowsDebrisOnly: broom.debrisMarkers > 0 && broom.grimeMarkers === 0,
    mopShowsGrimeOnly: mop.grimeMarkers > 0 && mop.debrisMarkers === 0,
    vacuumShowsBoth: vac.debrisMarkers > 0 && vac.grimeMarkers > 0,
    // The negative control: if the filter were a no-op every row would match
    // bare hands exactly.
    filterIsNotANoOp: broom.markers !== bare.markers && mop.markers !== bare.markers,
    coloursAreCarriedPerInstance: rows.every((r) => r.perInstanceColour === true),
  };
  return { floor, rows, checks, ok: Object.values(checks).every(Boolean) };
}
