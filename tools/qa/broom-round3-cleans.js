async (page) => {
  // Does the rebuilt broom still CLEAN? The round-3 solve moved the sim contact
  // point from "camera + forward*reach + right*stroke" to the rig's own solved
  // bristle position, so this is the regression that would matter most: a broom
  // that looks right and sweeps nothing.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/broom-round3-cleans.js
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/broom-round3');
  fs.mkdirSync(OUT, { recursive: true });
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
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.mouse.click(640, 360);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2400);

  // Stand at a pile, facing it, looking down at the work.
  const setup = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk;
    const list = app.state.shop.reno.debris.filter((d) => d && d.a > 0.001);
    if (!list.length) return { ok: false };
    const o = ch.interior.position;
    // the pile with the most in it — the clearest signal
    const t = list.slice().sort((a, b) => b.a - a.a)[0];
    w.state.x = o.x + t.x;
    w.state.z = o.z + t.z + 1.25;
    w.state.yaw = 0;
    w.state.pitch = -0.85;
    return {
      ok: true,
      before: list.map((d) => ({ x: +d.x.toFixed(3), z: +d.z.toFixed(3), a: +d.a.toFixed(3) })),
      total: +list.reduce((s, d) => s + d.a, 0).toFixed(3),
    };
  });
  await page.waitForTimeout(800);

  // sweep
  await page.mouse.down();
  await page.waitForTimeout(4500);
  await page.mouse.up();
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => {
    const app = window.__fw;
    const list = app.state.shop.reno.debris.filter((d) => d && d.a > 0.001);
    return {
      after: list.map((d) => ({ x: +d.x.toFixed(3), z: +d.z.toFixed(3), a: +d.a.toFixed(3) })),
      total: +list.reduce((s, d) => s + d.a, 0).toFixed(3),
      diag: app.scene3d.walk.broomDiagnostics(),
    };
  });

  // Ground truth is DISPLACEMENT: a push broom moves debris, it never deletes
  // it, so "total unchanged" is correct and "nothing moved" is the failure.
  const before = setup.before || [];
  let moved = 0;
  let maxShift = 0;
  for (const b of before) {
    let best = Infinity;
    for (const a of after.after) {
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < best) best = d;
    }
    if (best > 0.02 && Number.isFinite(best)) { moved += 1; maxShift = Math.max(maxShift, best); }
  }
  const out = {
    ok: moved > 0,
    clustersBefore: before.length,
    clustersAfter: after.after.length,
    totalBefore: setup.total,
    totalAfter: after.total,
    clustersDisplaced: moved,
    maxShiftYd: +maxShift.toFixed(3),
    seatError: after.diag.seatError,
    reach: after.diag.drawReach,
  };
  fs.writeFileSync(path.join(OUT, 'cleans.json'), JSON.stringify(out, null, 2));
  if (!out.ok) throw new Error(`the broom swept nothing: ${JSON.stringify(out)}`);
  return out;
}
