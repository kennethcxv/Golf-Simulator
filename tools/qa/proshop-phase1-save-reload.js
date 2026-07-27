async (page) => {
  // PRO-SHOP PHASE 1 — save/reload reality check for the systems the slice touches.
  //
  //   HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-phase1-save-reload.js
  //
  // Phase 0 never exercised a save/reload cycle, and the anti-slop checklist requires
  // "Cleaning progress survives save and reload" plus route and laptop state survival.
  // This mutates the world through the real tool path, autosaves, reloads through the
  // real Continue control, and diffs the restored state against what was saved.
  //
  // Inspection only. Nothing is fixed.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const dataOut = path.resolve(process.env.PHASE1_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Phase1', 'data'));
  fs.mkdirSync(dataOut, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const MINUTE_OF_DAY = 13 * 60;

  // The floor-plane aim lands eyeHeight/tan(-pitch) ahead of the player, so this pair
  // puts the tool head on the floor about 1.6 yd out. See BASELINE_TEST_PROTOCOL 7.2.
  const STANDOFF = 1.6;
  const PITCH = -0.82;

  const fingerprint = () => page.evaluate(() => {
    const app = window.__fw;
    const st = app.state;
    const ch = app.scene3d.clubhouse();
    const S = (fn, d = null) => { try { const v = fn(); return v === undefined ? d : v; } catch (e) { return `ERR:${e.message}`; } };
    const reno = st.shop.reno;
    const sum = (a) => a.reduce((x, v) => x + v, 0);
    return {
      grime: { len: reno.grime.length, sum: +sum(reno.grime).toFixed(4), mean: +(sum(reno.grime) / reno.grime.length).toFixed(5) },
      debris: {
        count: reno.debris.length,
        totalMass: +sum(reno.debris.map((d) => d.a)).toFixed(4),
        positions: reno.debris.map((d) => `${d.x.toFixed(2)},${d.z.toFixed(2)},${d.kind}`).sort(),
      },
      wetSum: S(() => +sum(reno.wet || []).toFixed(3)),
      solutionSum: S(() => +sum(reno.solution || []).toFixed(3)),
      cleaning: S(() => JSON.parse(JSON.stringify(reno.cleaning))),
      clutter: reno.clutter.map((c) => `${c.x},${c.z},${c.cleared}`),
      windows: [...reno.windows],
      architecture: Object.fromEntries(Object.entries(reno.architecture.components).map(([k, v]) => [k, v.restored])),
      lightPanels: S(() => JSON.parse(JSON.stringify(reno.lightPanels))),
      targetProgress: S(() => JSON.parse(JSON.stringify(reno.targetProgress))),
      cleanupMilestones: S(() => JSON.parse(JSON.stringify(reno.cleanupMilestones))),
      condition: S(() => ch.condition && ch.condition()),
      cash: st.cash,
      inventoryShelfTotal: Object.values(st.shop.inventory).reduce((a, v) => a + (v.shelf || 0), 0),
      inventoryBackTotal: Object.values(st.shop.inventory).reduce((a, v) => a + (v.back || 0), 0),
      drawerTotal: S(() => JSON.stringify(st.shop.drawer)),
      heldCount: st.shop.held.length,
      campaignToolsUsed: S(() => JSON.parse(JSON.stringify(st.campaign?.cleaningToolsUsed || {}))),
      campaignFacilities: S(() => JSON.parse(JSON.stringify(st.campaign?.facilities || {}))),
      uiPrefs: S(() => JSON.parse(JSON.stringify(st.uiPrefs || {}))),
      saveVersion: st.version,
    };
  });

  const bootFresh = async () => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /New game/i }).click();
    await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
    const c = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
    if (await c.isVisible({ timeout: 1500 }).catch(() => false)) await c.click();
    await settle();
  };
  const settle = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 120000 });
    await page.waitForTimeout(2500);
  };
  const place = async (lx, lz, yaw, pitch) => {
    await page.evaluate(({ lx, lz, yaw, pitch, m }) => {
      const app = window.__fw;
      const s3 = app.scene3d;
      const o = s3.clubhouse().interior.position;
      const w = s3.walk; w.clearKeys();
      w.state.x = o.x + lx; w.state.z = o.z + lz; w.state.yaw = yaw; w.state.pitch = pitch;
      app.speedIdx = 0;
      const c = app.state.clock;
      c.minutes = Math.floor(c.minutes / 1440) * 1440 + m;
      s3.applyTimeWeather(m, app.state.weather);
    }, { lx, lz, yaw, pitch, m: MINUTE_OF_DAY });
    await page.waitForTimeout(450);
  };

  await bootFresh();
  const before = await fingerprint();

  // ---- mutate the world through the real tool path --------------------------------
  // The vacuum is the one tool that touches BOTH grime and debris (SUCTION ->
  // suckAt + cleanGrimeAt), so a single pass moves two independent save fields.
  await page.mouse.click(800, 450);
  const mutations = [];
  for (const spot of [[-4.13, 0.69 + STANDOFF], [-6.88, -2.06 + STANDOFF], [1.38, -2.06 + STANDOFF]]) {
    await place(spot[0], spot[1], 0, PITCH); // yaw 0 = face -Z, toward the dirty cell
    await page.evaluate(() => window.__fw.scene3d.walk.setTool('vacuum'));
    await page.waitForTimeout(1100);
    await page.mouse.down();
    await page.waitForTimeout(4200);
    const s = await page.evaluate(() => {
      const d = window.__fw.scene3d.walk.cleaningDiagnostics();
      return { did: d.result ? +Number(d.result.did || 0).toFixed(4) : null, blocked: d.result ? !!d.result.blocked : null, reason: d.result?.reason || null };
    });
    await page.mouse.up();
    mutations.push({ spot, ...s });
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
  await page.waitForTimeout(800);

  const afterMutation = await fingerprint();

  // ---- save through the app's own autosave ----------------------------------------
  const saveResult = await page.evaluate(async () => {
    const app = window.__fw;
    if (typeof app.autosave !== 'function') return { ok: false, reason: 'app.autosave is not a function' };
    try { await app.autosave(); return { ok: true }; } catch (e) { return { ok: false, reason: e.message }; }
  });
  await page.waitForTimeout(1500);
  const savedRaw = await page.evaluate(() => {
    const raw = localStorage.getItem('golfempire:autosave');
    return { present: !!raw, bytes: raw ? raw.length : 0 };
  });

  // ---- reload through the real Continue control ------------------------------------
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const menuButtons = await page.evaluate(() => [...document.querySelectorAll('button')]
    .map((b) => b.textContent.trim()).filter(Boolean).slice(0, 8));
  const continueBtn = page.getByRole('button', { name: /^Continue/ }).first();
  const continueVisible = await continueBtn.isVisible({ timeout: 8000 }).catch(() => false);
  let reloaded = false;
  if (continueVisible) {
    await continueBtn.click();
    await settle();
    reloaded = true;
  }
  const afterReload = reloaded ? await fingerprint() : null;

  // ---- diff -------------------------------------------------------------------------
  const diff = [];
  if (afterReload) {
    const walk = (a, b, prefix = '') => {
      const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
      for (const k of keys) {
        const av = a?.[k]; const bv = b?.[k];
        const p = prefix ? `${prefix}.${k}` : k;
        if (av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(av)) { walk(av, bv, p); continue; }
        const as = JSON.stringify(av); const bs = JSON.stringify(bv);
        if (as !== bs) diff.push({ field: p, saved: as?.slice(0, 160), restored: bs?.slice(0, 160) });
      }
    };
    walk(afterMutation, afterReload);
  }

  const report = {
    note: 'Phase 1 save/reload reality check. Inspection only; nothing was fixed.',
    mutations,
    saveResult,
    savedRaw,
    menuButtonsAfterReload: menuButtons,
    continueVisible,
    reloaded,
    changedByCleaning: {
      grimeSum: [before.grime.sum, afterMutation.grime.sum],
      debrisCount: [before.debris.count, afterMutation.debris.count],
      debrisMass: [before.debris.totalMass, afterMutation.debris.totalMass],
      condition: [before.condition, afterMutation.condition],
      campaignToolsUsed: [before.campaignToolsUsed, afterMutation.campaignToolsUsed],
    },
    survivedReload: afterReload ? diff.length === 0 : null,
    diffCount: diff.length,
    diff,
    before,
    afterMutation,
    afterReload,
  };
  fs.writeFileSync(path.join(dataOut, 'phase1-save-reload.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
