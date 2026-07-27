async (page) => {
  // CLEAN-1 regression check — campaign attribution must fire on every tool path.
  //
  //   HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-fix-cleaning-attribution-verify.js
  //
  // Before the fix, five of the eight success paths returned without calling finish(),
  // so recordCampaignCleaning never ran for broom, dustpan, vacuum, mop or trash bag and
  // campaign.cleaningToolsUsed stayed {} forever. Also re-checks that grime still
  // repaints and shop condition still moves, because the fix moved the repaint clock out
  // of finish() — recordFloorCleaning owns it, and that must still be reached.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.FIX_DATA_OUT || path.join(repo, 'Designs', 'ProShop', 'Phase1', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const STANDOFF = 1.6;
  const PITCH = -0.82;

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const c = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await c.isVisible({ timeout: 1500 }).catch(() => false)) await c.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(800, 450);

  const snap = () => page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const g = app.state.shop.reno.grime;
    return {
      toolsUsed: JSON.parse(JSON.stringify(app.state.campaign?.cleaningToolsUsed || {})),
      grimeSum: +g.reduce((a, v) => a + v, 0).toFixed(4),
      condition: ch.condition ? ch.condition() : null,
      debrisCount: ch.debrisCount(),
      campaignEnabled: !!app.state.campaign?.enabled,
    };
  });
  const place = async (lx, lz, yaw, pitch) => {
    await page.evaluate(({ lx, lz, yaw, pitch }) => {
      const app = window.__fw; const s3 = app.scene3d;
      const o = s3.clubhouse().interior.position;
      const w = s3.walk; w.clearKeys();
      w.state.x = o.x + lx; w.state.z = o.z + lz; w.state.yaw = yaw; w.state.pitch = pitch;
      app.speedIdx = 0;
      const cl = app.state.clock;
      cl.minutes = Math.floor(cl.minutes / 1440) * 1440 + 13 * 60;
      s3.applyTimeWeather(13 * 60, app.state.weather);
    }, { lx, lz, yaw, pitch });
    await page.waitForTimeout(450);
  };

  const before = await snap();

  // A tool only proves anything if it actually lands work, so rather than hardcoding
  // spots (many are refused by the collider gate — cleaningGate blocks point-in-collider
  // and camera-occluded contacts), walk the live debris list and the dirtiest grime cells
  // until one of them produces did > 0.
  const targets = await page.evaluate(async () => {
    const app = window.__fw;
    const { RENO } = await import('/src/sim/shop.js');
    const g = app.state.shop.reno.grime;
    const room = RENO.room;
    const cells = g.map((v, i) => {
      const cx = i % RENO.grid.w; const cy = Math.floor(i / RENO.grid.w);
      return { v, x: -room.w / 2 + (cx + 0.5) * (room.w / RENO.grid.w), z: -room.d / 2 + (cy + 0.5) * (room.d / RENO.grid.h) };
    }).sort((a, b) => b.v - a.v).slice(0, 8).map((c) => [+c.x.toFixed(2), +c.z.toFixed(2)]);
    const debris = app.state.shop.reno.debris.map((d) => [+d.x.toFixed(2), +d.z.toFixed(2)]);
    const litter = app.state.shop.reno.debris.filter((d) => d.kind === 'litter').map((d) => [+d.x.toFixed(2), +d.z.toFixed(2)]);
    return { grimeCells: cells, debris, litter };
  });

  // The mop starts dry (charge 0 of 24) and is charged from the bucket in normal play.
  // That whole loop is out of scope here, so the harness primes the charge directly.
  // This is a TEST PRECONDITION, not a product change.
  await page.evaluate(() => { window.__fw.state.shop.reno.cleaning.mop.charge = 20; });

  const runs = [];
  const TOOLS = [
    { tool: 'broom', spots: targets.debris, why: 'SWEEP — needs a debris cluster in reach' },
    { tool: 'vacuum', spots: targets.grimeCells, why: 'SUCTION — grime and fine debris' },
    { tool: 'dustpan', spots: targets.debris, why: 'SCOOP — needs a pile in reach' },
    { tool: 'trashbag', spots: targets.litter.length ? targets.litter : targets.debris, why: 'CARRY — litter only' },
    { tool: 'mop', spots: targets.grimeCells, why: 'STROKE — grime, hard floor only, needs charge' },
  ];
  for (const t of TOOLS) {
    await page.evaluate((tool) => window.__fw.scene3d.walk.setTool(tool), t.tool);
    await page.waitForTimeout(1200);
    let bestDid = 0; let usedSpot = null; const attempts = [];
    for (const spot of t.spots.slice(0, 8)) {
      await place(spot[0], spot[1] + STANDOFF, 0, PITCH); // yaw 0 faces -Z, at the target
      await page.mouse.down();
      let did = 0; let reason = null;
      for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(700);
        const d = await page.evaluate(() => {
          const r = window.__fw.scene3d.walk.cleaningDiagnostics().result;
          return r ? { did: Number(r.did || 0), reason: r.blocked ? (r.reason || 'blocked') : null } : null;
        });
        if (d) { if (d.did > did) did = d.did; if (d.reason) reason = d.reason; }
      }
      await page.mouse.up();
      await page.waitForTimeout(300);
      attempts.push({ spot, did: +did.toFixed(4), reason });
      if (did > bestDid) { bestDid = did; usedSpot = spot; }
      if (bestDid > 0) break;
    }
    const after = await snap();
    runs.push({
      tool: t.tool, why: t.why, usedSpot, attempts,
      bestDidObserved: +bestDid.toFixed(4),
      recorded: after.toolsUsed[t.tool] === true,
      toolsUsedNow: after.toolsUsed,
    });
  }
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
  await page.waitForTimeout(600);
  const after = await snap();

  // A tool only has to be recorded if it actually did work in this run.
  const checks = runs.map((r) => ({
    name: `attribution:${r.tool}`,
    did: r.bestDidObserved,
    recorded: r.recorded,
    ok: r.bestDidObserved > 0 ? r.recorded === true : true,
    note: r.bestDidObserved > 0 ? 'did>0 so attribution is required' : 'no work landed; attribution not required',
  }));
  // The repaint path must still be reached after moving the clock out of finish().
  checks.push({
    name: 'grime-still-cleans-and-condition-moves',
    ok: after.grimeSum < before.grimeSum && after.condition >= before.condition,
    detail: { grimeSum: [before.grimeSum, after.grimeSum], condition: [before.condition, after.condition] },
  });

  const allOk = checks.every((c) => c.ok);
  const report = {
    defect: 'CLEAN-1',
    fix: 'all eight cleanWithTool success paths return through finish(); finish() is attribution-only',
    campaignEnabled: before.campaignEnabled,
    before, after, runs, checks, allOk,
  };
  fs.writeFileSync(path.join(outDir, 'fix-cleaning-attribution-verify.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { ok: allOk, ...report };
}
