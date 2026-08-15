async (page) => {
  // PRO-SHOP PHASE 0 BASELINE — recorded broom interaction footage.
  //
  //   VIDEO_DIR=<dir> HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-broom-video.js
  //
  // Playwright's context recorder writes the .webm when the context closes, so the
  // caller supplies VIDEO_DIR and renames the single produced file. The beat list is
  // the one the Phase 0 brief asks for: equip, idle, walking, first surface contact,
  // continuous sweeping, direction changes, cleaning against a wall, stop, unequip.
  //
  // Nothing about the broom, the floor, the dirt model or the room is changed here.
  // Movement uses the real keyboard path and tool use uses the real left-mouse path
  // (main.js:1886 sets spraying from pointerdown). Only two things are driven through
  // the API rather than the UI, and both are recorded in the returned report:
  //   * equip — the F belt hides cleaning tools until the cleaning kit is ordered
  //     (main.js:1718 `available: inside && cleaningKitOwned`), and the in-world route
  //     is [E] on the stockroom broom prop; setTool is the QA equivalent of both.
  //   * look  — pointer-lock mouse look is not reliable under automation, so yaw is
  //     driven directly, exactly as every other camera harness in tools/qa does.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const dataOut = path.resolve(process.env.BASELINE_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Baseline', 'data'));
  fs.mkdirSync(dataOut, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const MINUTE_OF_DAY = 13 * 60;

  const beats = [];
  const mark = (name, detail) => beats.push({ name, atMs: Date.now() - t0, ...(detail ? { detail } : {}) });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // Stand in the debris strip in front of the counter, facing along it.
  //
  // The aim is a floor-plane projection (clubhouse.js:5198), so the contact point sits
  // `eyeHeight / tan(-pitch)` ahead of the player and is discarded past the tool's reach
  // (broom: 2.4). SWEEP_STANDOFF/SWEEP_PITCH are the matched pair that lands the broom
  // head on the debris row rather than short of it — an earlier route missed every
  // cluster and produced 45 s of footage in which nothing was ever cleaned.
  const SWEEP_STANDOFF = 1.6;
  const SWEEP_PITCH = -0.82;
  await page.evaluate(({ minuteOfDay, pitch, standoff }) => {
    const app = window.__fw;
    const s3 = app.scene3d;
    const o = s3.clubhouse().interior.position;
    const w = s3.walk;
    w.clearKeys();
    // The seeded debris row runs across the room at roughly z = +2.8 local.
    w.state.x = o.x - 5.6; w.state.z = o.z + 2.8 + standoff;
    w.state.yaw = 0; // forward = (0,-1): face the row
    w.state.pitch = pitch;
    app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + minuteOfDay;
    s3.applyTimeWeather(minuteOfDay, app.state.weather);
  }, { minuteOfDay: MINUTE_OF_DAY, pitch: SWEEP_PITCH, standoff: SWEEP_STANDOFF });
  await page.waitForTimeout(1500);
  await page.mouse.click(800, 450); // focus the canvas the way a player does

  const t0 = Date.now();
  const pre = await page.evaluate(async () => {
    const { vacuumOwned } = await import(new URL('src/sim/shop.js', document.baseURI).href);
    const app = window.__fw;
    return {
      cleaningKitOwned: !!vacuumOwned(app.state),
      toolAtStart: app.scene3d.walk.getTool(),
      debrisCount: app.scene3d.clubhouse().debrisCount(),
      debrisTotal: +app.scene3d.clubhouse().debrisTotal().toFixed(3),
      debrisLocal: app.state.shop.reno.debris
        .map((d) => ({ x: +d.x.toFixed(2), z: +d.z.toFixed(2), a: +d.a.toFixed(3), kind: d.kind })),
    };
  });

  // Sampled while the broom is actually being worked, so the report can prove the
  // stroke landed rather than asserting it.
  const samples = [];
  const sampleCleaning = async (label) => {
    const s = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk;
      const d = w.cleaningDiagnostics();
      const o = window.__fw.scene3d.clubhouse().interior.position;
      return {
        tool: d.tool,
        using: d.using,
        did: d.result ? +Number(d.result.did || 0).toFixed(4) : null,
        blocked: d.result ? !!d.result.blocked : null,
        reason: d.result ? d.result.reason || null : null,
        targetLocal: d.target ? [+(d.target[0] - o.x).toFixed(2), +(d.target[2] - o.z).toFixed(2)] : null,
      };
    });
    samples.push({ label, ...s });
  };

  // ---- 1. idle, hands free -------------------------------------------------------
  mark('idle-hands-free');
  await page.waitForTimeout(3000);

  // ---- 2. equip ------------------------------------------------------------------
  mark('equip-broom');
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(3200); // Broom_Equip clip + procedural rise/settle

  // ---- 3. idle holding the broom -------------------------------------------------
  mark('idle-holding');
  await page.waitForTimeout(3500);

  // ---- 4. walking ----------------------------------------------------------------
  mark('walking');
  await page.keyboard.down('d');
  await page.waitForTimeout(1600);
  await page.keyboard.up('d');
  await page.waitForTimeout(500);
  await page.keyboard.down('a');
  await page.waitForTimeout(1400);
  await page.keyboard.up('a');
  await page.waitForTimeout(900);

  // ---- 5. first surface contact --------------------------------------------------
  mark('begin-surface-contact');
  await page.mouse.down();
  await page.waitForTimeout(1400);
  await sampleCleaning('first-contact');
  await page.waitForTimeout(1200);

  // ---- 6. continuous sweeping ----------------------------------------------------
  // Strafe along the seeded debris row so the head crosses cluster after cluster.
  mark('continuous-sweeping');
  await page.keyboard.down('d');
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(1100);
    await sampleCleaning(`sweep-strafe-${i}`);
  }
  await page.keyboard.up('d');
  await page.waitForTimeout(1200);

  // ---- 7. direction changes ------------------------------------------------------
  mark('direction-changes');
  for (const yaw of [0.55, -0.55, 0.3, 0]) {
    await page.evaluate((y) => { window.__fw.scene3d.walk.state.yaw = y; }, yaw);
    await page.waitForTimeout(1500);
    await sampleCleaning(`turn-${yaw}`);
  }

  // ---- 8. cleaning against a wall / edge -----------------------------------------
  // The west-wall cluster sits at local (-7.6, 4.6); stand one stand-off back of it
  // facing -x so the head works into the wall corner.
  mark('cleaning-near-wall');
  await page.mouse.up();
  await page.evaluate(({ standoff, pitch }) => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 7.6 + standoff; w.state.z = o.z + 4.6;
    w.state.yaw = Math.PI / 2; // forward = (-1,0): face the west wall
    w.state.pitch = pitch;
  }, { standoff: SWEEP_STANDOFF, pitch: SWEEP_PITCH });
  await page.waitForTimeout(900);
  await page.mouse.down();
  await page.waitForTimeout(1600);
  await sampleCleaning('near-wall');
  await page.waitForTimeout(1400);
  await page.evaluate(() => { window.__fw.scene3d.walk.state.yaw = Math.PI / 2 - 0.6; });
  await page.waitForTimeout(1600);
  await sampleCleaning('near-wall-turned');
  await page.waitForTimeout(1000);

  // ---- 9. stop using -------------------------------------------------------------
  mark('stop-use');
  await page.mouse.up();
  await page.waitForTimeout(3000);

  // ---- 10. unequip ---------------------------------------------------------------
  mark('unequip');
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
  await page.waitForTimeout(3200);
  mark('end');

  const post = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const S = (fn) => { try { return fn(); } catch (e) { return `ERR:${e.message}`; } };
    return {
      toolAtEnd: app.scene3d.walk.getTool(),
      debrisCount: ch.debrisCount(),
      debrisTotal: +ch.debrisTotal().toFixed(3),
      cleaningStatus: S(() => ch.cleaningStatus()),
      grimeMean: +(app.state.shop.reno.grime.reduce((a, v) => a + v, 0)
        / app.state.shop.reno.grime.length).toFixed(4),
      toolViewmodel: S(() => app.scene3d.walk.toolViewmodelDiagnostics()),
      cleaningDiagnostics: S(() => app.scene3d.walk.cleaningDiagnostics()),
      campaignToolsUsed: S(() => app.state.campaign?.cleaningToolsUsed),
    };
  });

  const report = {
    durationMs: Date.now() - t0,
    viewport: { width: 1600, height: 900 },
    minuteOfDay: MINUTE_OF_DAY,
    equipRoute: 'walk.setTool("broom") — see header note for the two in-game routes',
    useRoute: 'real left-mouse down/up (main.js:1886)',
    moveRoute: 'real W/S keyboard',
    lookRoute: 'walk.state.yaw written directly (pointer-lock look is not automatable)',
    sweepGeometry: { standoffYd: SWEEP_STANDOFF, pitchRad: SWEEP_PITCH },
    cleaningLanded: samples.some((s) => (s.did || 0) > 0),
    pre,
    post,
    samples,
    beats,
  };
  fs.writeFileSync(path.join(dataOut, 'baseline-broom-video.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
