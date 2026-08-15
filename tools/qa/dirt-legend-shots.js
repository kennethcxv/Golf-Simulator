// J2 — the reveal as a legend, photographed with every tool held.
//
// Seeds both media near the player (debris piles + the grime field is already
// day-one dirty), holds Q with each of the nine tools, and screenshots the
// frame: the markers must wear the legend colours and the HUD chips must name
// exactly the held tool's media. The in-page asserts are the sim-side truth:
//   - per tool, the overlay's media set equals toolMedia(tool);
//   - the two-media control: a debris-only tool must not light grime markers
//     and vice versa (senseTally splits the counts);
//   - R1#11's organic check: LIVE debris clusters all carry a known kind, so
//     the legend's classes describe what actually spawns, not just what the
//     driver seeded.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/dirt-legend-j2');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = -0.28;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 13 * 60;
    app.speedIdx = 0;
  });
  await page.mouse.click(800, 450);
  await page.waitForTimeout(500);

  // seed debris piles ahead (the grime field is day-one dirty on its own)
  const seeded = await page.evaluate(() => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const spawn = club.debugSpawnDebris || club.spawnDebris || null;
    if (spawn) {
      const w = app.scene3d.walk.state;
      const o = club.interior.position;
      for (const [dx, dz] of [[-1.6, 0], [-2.4, 0.7], [-2.0, -0.8]]) {
        spawn(w.x - o.x + dx, w.z - o.z + dz);
      }
      return 'api';
    }
    return 'organic-only';
  });

  const TOOLS = [null, 'broom', 'mop', 'vacuum', 'dustpan', 'washer', 'spray', 'cloth', 'sponge', 'trashbag'];
  const rows = {};
  for (const tool of TOOLS) {
    await page.evaluate((id) => window.__fw.scene3d.walk.setTool(id), tool);
    await page.waitForTimeout(tool ? 2000 : 600);
    await page.keyboard.down('q');
    await page.waitForTimeout(900);
    const label = tool || 'no-tool';
    await page.screenshot({ path: path.join(OUT, `${label}.png`) });
    const probe = await page.evaluate(async () => {
      const { toolMedia } = await import(new URL('src/data/cleaningTools.js', document.baseURI).href);
      const app = window.__fw;
      const sense = app.scene3d.walk.dirtSense ? app.scene3d.walk.dirtSense() : null;
      const overlay = sense?.overlay || {};
      const tool = app.scene3d.walk.getTool();
      const chips = [...document.querySelectorAll('.dirt-medium-chip')].map((c) => c.textContent.trim());
      return {
        tool,
        expectedMedia: tool ? toolMedia(tool) : ['debris', 'grime'],
        overlayMedia: overlay.media || null,
        tallyDebris: overlay.debrisMarkers ?? null,
        tallyGrime: overlay.grimeMarkers ?? null,
        hiddenByTool: overlay.hiddenByTool ?? null,
        alpha: sense?.alpha ?? 0,
        chips,
      };
    });
    await page.keyboard.up('q');
    await page.waitForTimeout(300);
    rows[label] = probe;
  }

  // R1#11: what actually LIVES in the sim right now
  const organic = await page.evaluate(async () => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const list = (typeof club.debrisState === 'function' ? club.debrisState() : null)
      || app.state.shop?.debris || [];
    const kinds = {};
    let unknown = 0;
    const KNOWN = new Set(['grit', 'litter', 'leaves', 'dust']);
    for (const d of (Array.isArray(list) ? list : [])) {
      if (!d || d.a <= 0.001) continue;
      kinds[d.kind || '(none)'] = (kinds[d.kind || '(none)'] || 0) + 1;
      if (!KNOWN.has(d.kind)) unknown += 1;
    }
    const grime = app.state.shop?.reno?.grime;
    const grimeDirty = grime ? [...grime].filter((v) => v > 0.06).length : null;
    return { kinds, unknown, grimeDirtyCells: grimeDirty };
  });

  const mediaOf = (row) => (row.overlayMedia || []).slice().sort().join(',');
  const checks = {
    revealLitEveryHold: Object.values(rows).every((r) => r.alpha > 0.5),
    // the sim-side truth: overlay media == the tool's own media
    overlayMediaMatchesTool: Object.values(rows).every(
      (r) => mediaOf(r) === (r.expectedMedia || []).slice().sort().join(','),
    ),
    // the two-media control: a debris-only tool lights no grime markers…
    broomShowsNoGrime: (rows.broom?.tallyGrime ?? 9) === 0 && (rows.broom?.tallyDebris ?? 0) > 0,
    // …and a grime-only tool lights no debris markers
    mopShowsNoDebris: (rows.mop?.tallyDebris ?? 9) === 0 && (rows.mop?.tallyGrime ?? 0) > 0,
    // the vacuum is the declared both-media tool
    vacuumShowsBoth: (rows.vacuum?.tallyDebris ?? 0) > 0 && (rows.vacuum?.tallyGrime ?? 0) > 0,
    // the legend chips name the held tool's media
    chipsFollowTheTool: (rows.broom?.chips || []).join()?.includes('Loose debris')
      && !(rows.broom?.chips || []).join()?.includes('grime')
      && (rows.mop?.chips || []).join()?.includes('Ground-in grime'),
    // Organic spawns carry kinds the legend can discriminate. The direct
    // sampler could not reach the debris list from outside (kinds {} with 0
    // sampled — which made the first cut of this check pass VACUOUSLY), so
    // the evidence is behavioural: the trashbag's litter-only filter shows
    // SOME debris markers and hides OTHERS that the broom shows — impossible
    // unless live clusters carry distinct kinds.
    organicKindsDiscriminated: (rows.trashbag?.tallyDebris ?? 0) > 0
      && (rows.trashbag?.tallyDebris ?? 0) < (rows.broom?.tallyDebris ?? 0),
    grimeFieldPresent: (organic.grimeDirtyCells ?? 0) > 0,
    noPageErrors: errs.length === 0,
  };
  const out = { seeded, rows, organic, errs: errs.slice(0, 10), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'dirt-legend.json'), `${JSON.stringify(out, null, 1)}\n`);
  return { seeded, organic, checks, ok: out.ok };
}
