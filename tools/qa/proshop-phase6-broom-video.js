async (page) => {
  // PRO-SHOP PHASE 6 — the rebuilt broom, recorded on the SAME beats as the
  // Phase 0 baseline so the two clips cut together directly:
  //
  //   VIDEO_DIR=<dir> node tools/qa/run-playwright.cjs tools/qa/proshop-phase6-broom-video.js
  //   (rename the produced .webm to Designs/ProShop/Baseline/video/phase6-broom-interaction.webm)
  //
  // Beat list (baseline order, one addition): idle-hands-free, equip-broom,
  // idle-holding, walking, begin-surface-contact, continuous-sweeping,
  // direction-changes, cleaning-near-wall, sweeping-table-edge (Phase 6 brief
  // beat — the baseline had no table), stop-use, unequip.
  //
  // Same two API-driven exceptions as the baseline, for the same reasons:
  // equip via walk.setTool (the belt is gated on the cleaning kit) and look
  // via walk.state.yaw/pitch (pointer-lock look is not automatable). Movement
  // is real WASD; use is real left-mouse.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const dataOut = path.resolve(process.env.BASELINE_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Baseline', 'data'));
  fs.mkdirSync(dataOut, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const MINUTE_OF_DAY = 13 * 60;

  const beats = [];
  let t0 = Date.now();
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

  // 1.35 not the baseline's 1.6: the eased working reach settles near 1.12,
  // and the sweep radius (0.66) must cover the cluster from first contact.
  const SWEEP_STANDOFF = 1.35;
  const SWEEP_PITCH = -0.82;
  // Derive the sweep lane from the LIVE debris and the LIVE colliders — the
  // baseline's hardcoded strip predates the v2 relayout, and standing there
  // now faces the counter: the clamp (correctly) pulled the head to the feet
  // and the whole working section swept the wrong spot.
  const lane = await page.evaluate(({ minuteOfDay, pitch, standoff }) => {
    const app = window.__fw;
    const s3 = app.scene3d;
    const o = s3.clubhouse().interior.position;
    const w = s3.walk;
    w.clearKeys();
    app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + minuteOfDay;
    s3.applyTimeWeather(minuteOfDay, app.state.weather);
    const debris = app.state.shop.reno.debris || [];
    const directions = [
      { dx: 0, dz: 1, yaw: 0 }, { dx: 0, dz: -1, yaw: Math.PI },
      { dx: 1, dz: 0, yaw: Math.PI / 2 }, { dx: -1, dz: 0, yaw: -Math.PI / 2 },
    ];
    for (const cluster of debris) {
      for (const direction of directions) {
        const sx = cluster.x + direction.dx * standoff;
        const sz = cluster.z + direction.dz * standoff;
        const stanceFree = w.isFree(o.x + sx, o.z + sz, 0.4);
        const headFree = [0.5, 1.0, 1.4].every((ahead) => w.isFree(
          o.x + sx - direction.dx * ahead, o.z + sz - direction.dz * ahead, 0.25,
        ));
        if (stanceFree && headFree) {
          w.state.x = o.x + sx; w.state.z = o.z + sz;
          w.state.yaw = direction.yaw;
          w.state.pitch = pitch;
          return {
            cluster: { x: +cluster.x.toFixed(2), z: +cluster.z.toFixed(2), kind: cluster.kind },
            stance: { x: +sx.toFixed(2), z: +sz.toFixed(2), yaw: +direction.yaw.toFixed(2) },
          };
        }
      }
    }
    return null;
  }, { minuteOfDay: MINUTE_OF_DAY, pitch: SWEEP_PITCH, standoff: SWEEP_STANDOFF });
  if (!lane) throw new Error('No debris cluster has an open approach lane; cannot stage the sweep beats.');
  await page.waitForTimeout(1500);
  await page.mouse.click(800, 450);

  t0 = Date.now();
  const pre = await page.evaluate(async () => {
    const { vacuumOwned } = await import('/src/sim/shop.js');
    const app = window.__fw;
    return {
      cleaningKitOwned: !!vacuumOwned(app.state),
      toolAtStart: app.scene3d.walk.getTool(),
      debrisCount: app.scene3d.clubhouse().debrisCount(),
      debrisTotal: +app.scene3d.clubhouse().debrisTotal().toFixed(3),
    };
  });

  const samples = [];
  const sampleCleaning = async (label) => {
    const s = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk;
      const d = w.cleaningDiagnostics();
      const o = window.__fw.scene3d.clubhouse().interior.position;
      const broom = w.broomDiagnostics ? w.broomDiagnostics() : null;
      return {
        tool: d.tool,
        using: d.using,
        did: d.result ? +Number(d.result.did || 0).toFixed(4) : null,
        blocked: d.result ? !!d.result.blocked : null,
        reason: d.result ? d.result.reason || null : null,
        targetLocal: d.target ? [+(d.target[0] - o.x).toFixed(2), +(d.target[2] - o.z).toFixed(2)] : null,
        broom,
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
  await page.waitForTimeout(3200);

  // ---- 3. idle holding the broom -------------------------------------------------
  mark('idle-holding');
  await page.waitForTimeout(2000);
  // Phase 6 acceptance: at LEVEL pitch the head stays in frame — the old rig
  // put it at NDC y −1.55 until ~23° of down-look. Sampled, not asserted, so
  // the clip keeps rolling either way and the report carries the number.
  await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = 0; });
  await page.waitForTimeout(900);
  await sampleCleaning('level-pitch-hold');
  await page.evaluate((pitch) => { window.__fw.scene3d.walk.state.pitch = pitch; }, SWEEP_PITCH);
  await page.waitForTimeout(600);

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
  // A push broom PUSHES the pile forward — short forward presses drive the
  // head through the cluster and keep the pile in reach, where the baseline's
  // long strafe (authored for the old debris ROW) walks off a lone cluster.
  mark('continuous-sweeping');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.down('w');
    await page.waitForTimeout(650);
    await page.keyboard.up('w');
    await page.waitForTimeout(650);
    await sampleCleaning(`sweep-push-${i}`);
  }
  await page.waitForTimeout(900);

  // ---- 7. direction changes ------------------------------------------------------
  mark('direction-changes');
  for (const yaw of [0.55, -0.55, 0.3, 0]) {
    await page.evaluate((y) => { window.__fw.scene3d.walk.state.yaw = y; }, yaw);
    await page.waitForTimeout(1500);
    await sampleCleaning(`turn-${yaw}`);
  }

  // ---- 8. cleaning against a wall ------------------------------------------------
  mark('cleaning-near-wall');
  await page.mouse.up();
  await page.evaluate(({ standoff, pitch }) => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 7.6 + standoff; w.state.z = o.z + 4.6;
    w.state.yaw = Math.PI / 2;
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

  // ---- 9. sweeping up to a table edge (Phase 6 brief beat) ------------------------
  // Walk the head INTO the nearest fixture face: the clamp must stop the
  // bristles at the face — never through it — and the head should tilt to the
  // blocking surface.
  mark('sweeping-table-edge');
  await page.mouse.up();
  const tableApproach = await page.evaluate(({ pitch }) => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    // counters/desks may register as structures rather than props; search both
    const groups = app.scene3d.colliders || {};
    const cols = [...(groups.props || []), ...(groups.structures || [])];
    const seed = { x: -1.0, z: 0.6 };
    let best = null;
    for (const col of cols) {
      if (col.minX === undefined) continue;
      const w2 = col.maxX - col.minX;
      const d2 = col.maxZ - col.minZ;
      if (w2 < 0.6 || d2 < 0.3) continue;
      const cx = (col.minX + col.maxX) / 2 - o.x;
      const cz = (col.minZ + col.maxZ) / 2 - o.z;
      const dist = Math.hypot(cx - seed.x, cz - seed.z);
      if (!best || dist < best.dist) best = { dist, cx, cz, minZ: col.minZ - o.z, maxZ: col.maxZ - o.z };
    }
    if (!best) return null;
    w.clearKeys();
    // stand south of the face, walk the sweep into it
    w.state.x = best.cx + o.x;
    w.state.z = best.maxZ + 2.2 + o.z;
    w.state.yaw = 0; // forward = (0,-1): face the fixture
    w.state.pitch = pitch;
    return { face: { x: +best.cx.toFixed(2), z: +best.maxZ.toFixed(2) } };
  }, { pitch: SWEEP_PITCH });
  await page.waitForTimeout(800);
  await page.mouse.down();
  await page.keyboard.down('w');
  await page.waitForTimeout(1800);
  await page.keyboard.up('w');
  await sampleCleaning('table-edge');
  await page.waitForTimeout(1200);

  // ---- 10. stop using ------------------------------------------------------------
  mark('stop-use');
  await page.mouse.up();
  await page.waitForTimeout(2600);

  // ---- 11. unequip ---------------------------------------------------------------
  mark('unequip');
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
  await page.waitForTimeout(3000);
  mark('end');

  const post = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const S = (fn) => { try { return fn(); } catch (e) { return `ERR:${e.message}`; } };
    return {
      toolAtEnd: app.scene3d.walk.getTool(),
      debrisCount: ch.debrisCount(),
      debrisTotal: +ch.debrisTotal().toFixed(3),
      toolViewmodel: S(() => app.scene3d.walk.toolViewmodelDiagnostics()),
      broom: S(() => (app.scene3d.walk.broomDiagnostics ? app.scene3d.walk.broomDiagnostics() : null)),
    };
  });

  const report = {
    durationMs: Date.now() - t0,
    viewport: { width: 1600, height: 900 },
    minuteOfDay: MINUTE_OF_DAY,
    beatsMirrorBaseline: true,
    tableApproach,
    cleaningLanded: samples.some((s) => (s.did || 0) > 0),
    pre,
    post,
    samples,
    beats,
  };
  fs.writeFileSync(path.join(dataOut, 'phase6-broom-video.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
